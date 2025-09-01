// src/lib/serial.ts
import { SerialPort } from "serialport";
import { LOG } from '@/lib/logger';

import { broadcast, DeviceInfo } from "@/lib/bus";
import { Transform } from "stream";
import { ReadlineParser } from "@serialport/parser-readline";

/* ────────────────────────────────────────────────────────────────────────────
   ESP line stream — singleton with ring buffer + subscriber fan-out
   Adds cursoring so callers can fence reads to “future-only”.
   ──────────────────────────────────────────────────────────────────────────── */

type SubFn = (s: string, id: number) => void;

type EspLineStream = {
  port: SerialPort;
  parser: ReadlineParser;
  ring: string[];
  ringIds: number[];
  nextId: number;
  subs: Set<SubFn>;
  lastSeenAt: number;
  lastLine?: string;
};

type G = typeof globalThis & { __ESP_STREAM?: EspLineStream };
const GBL = globalThis as G;

function espPath(): string {
  return process.env.ESP_TTY ?? process.env.ESP_TTY_PATH ?? "/dev/ttyUSB1";
}
function espBaud(): number {
  const b = Number(process.env.ESP_BAUD ?? 115200);
  return Number.isFinite(b) && b > 0 ? b : 115200;
}

function armEsp(): EspLineStream {
  if (GBL.__ESP_STREAM) return GBL.__ESP_STREAM;

  const path = espPath();
  const baudRate = espBaud();
  const log = LOG.tag('esp');
  log.info(`opening ${path} @${baudRate}`);

  const port = new SerialPort({ path, baudRate, autoOpen: true, lock: false });

  // Normalize CRLF/CR to LF and accept any newline as delimiter
  const normalizer = new Transform({
    transform(chunk, _enc, cb) {
      const s = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
      cb(null, Buffer.from(s.replace(/\r\n/g, "\n").replace(/\r/g, "\n")));
    }
  });

  const parser = port
    .pipe(normalizer)
    .pipe(new ReadlineParser({ delimiter: "\n" }));

  const ring: string[] = [];
  const ringIds: number[] = [];
  let nextId = 1;
  const subs = new Set<SubFn>();
  let lastSeenAt = 0;

  // --- update the data handler
  parser.on("data", (buf: unknown) => {
    const s = String(buf).trim();
    if (!s) return;

    if (process.env.ESP_DEBUG) LOG.tag('esp').debug(`[${path}] ${s}`);

    ring.push(s);
    ringIds.push(nextId++);
    if (ring.length > 400) {
      ring.shift();
      ringIds.shift();
    }

    // passive liveness
    lastSeenAt = Date.now();
    GBL.__ESP_STREAM!.lastSeenAt = lastSeenAt;
    GBL.__ESP_STREAM!.lastLine = s;

    subs.forEach((fn) => {
      try { fn(s, ringIds[ringIds.length - 1]!); } catch {}
    });
  });

  port.on("error", (e) => {
    LOG.tag('esp').error(`error on ${path}`, e?.message ?? e);
  });

  port.on("close", () => {
    GBL.__ESP_STREAM = undefined; // allow re-open later
  });

  GBL.__ESP_STREAM = { port, parser, ring, ringIds, nextId, subs, lastSeenAt, lastLine: undefined };
  return GBL.__ESP_STREAM;
}

export function getEspLineStream(): EspLineStream { return armEsp(); }
export function mark(): number {
  const { ringIds } = armEsp();
  return ringIds.length ? ringIds[ringIds.length - 1]! : 0;
}
export function flushHistory(): number { return mark(); }

// --- convenience accessor
export function getEspActivity(): { lastSeenAt: number | null; ageMs: number | null; lastLine?: string } {
  const s = getEspLineStream();
  if (!s.lastSeenAt) return { lastSeenAt: null, ageMs: null, lastLine: undefined };
  const ageMs = Date.now() - s.lastSeenAt;
  return { lastSeenAt: s.lastSeenAt, ageMs, lastLine: s.lastLine };
}

async function waitUntilOpen(port: SerialPort): Promise<void> {
  if ((port as any).isOpen) return;
  await new Promise<void>((resolve, reject) => {
    const onOpen = () => { cleanup(); resolve(); };
    const onErr = (e: any) => { cleanup(); reject(e); };
    const cleanup = () => { port.off("open", onOpen); port.off("error", onErr); };
    port.on("open", onOpen);
    port.on("error", onErr);
  });
}

async function writeLine(line: string): Promise<void> {
  const { port } = armEsp();
  await waitUntilOpen(port);
  const out = line.endsWith("\n") || line.endsWith("\r") ? line : `${line}\r\n`;
  await new Promise<void>((resolve, reject) =>
    port.write(out, (err) => {
      if (err) return reject(err);
      port.drain((derr) => (derr ? reject(derr) : resolve()));
    })
  );
  if (process.env.ESP_DEBUG) LOG.tag('esp').debug(`⟶ [you] ${line}`);
}

export function waitForLine(
  matcher: ((s: string) => boolean) | RegExp,
  signal?: AbortSignal,
  timeoutMs = 12_000,
  opts: { since?: number } = {}
): Promise<string> {
  const { ring, ringIds, subs } = armEsp();
  const isMatch = typeof matcher === "function" ? matcher : (s: string) => (matcher as RegExp).test(s);
  const since = opts.since ?? undefined;

  return new Promise<string>((resolve, reject) => {
    for (let i = ring.length - 1; i >= 0; i--) {
      if (since && ringIds[i] <= since) break;
      const s = ring[i];
      if (isMatch(s)) return resolve(s);
    }

    let done = false;
    let timer: NodeJS.Timeout | null = null;
    const finish = (err?: any, val?: string) => {
      if (done) return;
      done = true;
      subs.delete(onLine);
      if (timer) clearTimeout(timer);
      if (signal) try { signal.removeEventListener("abort", onAbort); } catch {}
      err ? reject(err) : resolve(val as string);
    };

    const onLine: SubFn = (s, id) => { if (since && id <= since) return; if (isMatch(s)) finish(undefined, s); };
    const onAbort = () => finish(new Error("client-abort"));
    const onTimeout = () => finish(new Error("timeout"));

    subs.add(onLine);
    if (signal) {
      if (signal.aborted) return onAbort();
      signal.addEventListener("abort", onAbort, { once: true });
    }
    timer = setTimeout(onTimeout, timeoutMs);
  });
}

export function waitForNextLine(
  matcher: ((s: string) => boolean) | RegExp,
  signal?: AbortSignal,
  timeoutMs = 12_000
): Promise<string> {
  return waitForLine(matcher, signal, timeoutMs, { since: mark() });
}

export async function sendToEsp(cmd: string): Promise<void> { await writeLine(cmd); }
export async function sendAndReceive(cmd: string, timeout = 10_000): Promise<string> {
  const RX_OK_STRICT = /^\s*(?:>>\s*)?(?:RESULT\s+)?(?:SUCCESS|OK)\s*$/i;
  const matcher = (line: string) => {
    const up = line.toUpperCase();
    if (up.startsWith("ERROR")) return true;
    if (/\bFAIL(?:URE|URES)\b/.test(up)) return true;
    return RX_OK_STRICT.test(line);
  };
  const since = mark();
  const p = waitForLine(matcher, undefined, timeout, { since });
  await writeLine(cmd);
  return p;
}

export async function isEspPresent(path = espPath()): Promise<boolean> {
  const list = await SerialPort.list();
  return list.some((d) => d.path === path);
}

export async function pingEsp(): Promise<{ ok: boolean; raw: string }> {
  const tmpl = (process.env.ESP_PING_CMD ?? "PING").trim();
  if (!tmpl) return { ok: true, raw: "present (no ping)" };

  const mac = process.env.ESP_MAC ?? "";
  const payload = Math.floor(Date.now() / 1000).toString();
  const cmd = tmpl.replace(/\{mac\}/gi, mac).replace(/\{payload\}/gi, payload);

  try {
    const raw = await sendAndReceive(cmd, 3000);
    const ok = /(^OK\b|SUCCESS)/i.test(raw) && !/^ERROR/i.test(raw);
    return { ok, raw };
  } catch (e: any) {
    return { ok: false, raw: String(e?.message ?? e) };
  }
}

// --- replace espHealth to avoid pinging by default
export async function espHealth(opts?: {
  probe?: "never" | "if-stale" | "always";
  staleMs?: number;
}): Promise<{ present: boolean; ok: boolean; raw: string; ageMs?: number; lastLine?: string }> {
  const probeEnv = (process.env.ESP_HEALTH_PROBE ?? "never").toLowerCase() as "never" | "if-stale" | "always";
  const probe = opts?.probe ?? probeEnv;
  const staleMs = opts?.staleMs ?? Number(process.env.ESP_HEALTH_STALE_MS ?? 15000);

  const present = await isEspPresent();
  if (!present) return { present, ok: false, raw: "not present" };

  const act = getEspActivity();
  const ageMs = act.ageMs ?? Number.POSITIVE_INFINITY;

  // Passive-only success path
  if (probe === "never") {
    return { present, ok: true, raw: act.ageMs == null ? "present (no activity yet)" : `passive ${ageMs}ms`, ageMs: act.ageMs ?? undefined, lastLine: act.lastLine };
  }

  // If-stale only probes when no recent traffic
  if (probe === "if-stale" && ageMs < staleMs) {
    return { present, ok: true, raw: `passive ${ageMs}ms`, ageMs, lastLine: act.lastLine };
  }

  // Explicit probe, but only if a ping template is configured
  const tmpl = (process.env.ESP_PING_CMD ?? "").trim();
  if (!tmpl) {
    return { present, ok: true, raw: act.ageMs == null ? "present (probe disabled)" : `passive ${ageMs}ms`, ageMs: act.ageMs ?? undefined, lastLine: act.lastLine };
  }

  const { ok, raw } = await pingEsp();
  return { present, ok, raw };
}

export async function listSerialDevicesRaw(): Promise<Awaited<ReturnType<typeof SerialPort.list>>> {
  return SerialPort.list();
}
export async function listSerialDevices(): Promise<DeviceInfo[]> {
  const list = await SerialPort.list();
  return list.map((d) => ({
    path: d.path,
    vendorId: d.vendorId ?? null,
    productId: d.productId ?? null,
    manufacturer: d.manufacturer ?? null,
    serialNumber: d.serialNumber ?? null,
  }));
}

/* ────────────────────────────────────────────────────────────────────────────
   Multi-scanner singleton (per path) with per-port cooldown/backoff
   ──────────────────────────────────────────────────────────────────────────── */

type ScannerPerPath = { port: SerialPort | null; parser: ReadlineParser | null; starting: Promise<void> | null; };
type RetryState = { nextAttemptAt: number; retryMs: number; lastError: string | null; lastErrSentAt: number; };
type Runtime = { state: ScannerPerPath; retry: RetryState };

const GG = globalThis as any;
if (!GG.__scanners) GG.__scanners = new Map<string, Runtime>();
const scanners: Map<string, Runtime> = GG.__scanners;

const now = () => Date.now();
const inCooldown = (r: RetryState) => now() < r.nextAttemptAt;
const bumpCooldown = (r: RetryState, ms?: number) => {
  const base = ms ?? Math.ceil(r.retryMs * 1.7);
  const jitter = Math.floor(Math.random() * 300);
  r.retryMs = Math.min(base + jitter, 60_000);
  r.nextAttemptAt = now() + r.retryMs;
};
const resetCooldown = (r: RetryState) => { r.retryMs = 2000; r.nextAttemptAt = 0; };

function broadcastScannerErrorOnce(r: RetryState, msg: string, path?: string) {
  const t = now();
  if (r.lastError !== msg || t - r.lastErrSentAt > 5000) {
    r.lastError = msg;
    r.lastErrSentAt = t;
    broadcast({ type: "scanner/error", error: msg, ...(path ? { path } : {}) });
  }
}

function attachScannerHandlers(
  path: string,
  state: ScannerPerPath,
  retry: RetryState,
  port: SerialPort,
  parser: ReadlineParser
) {
  // Line-oriented payloads
  parser.on("data", (raw: unknown) => {
    let code = String(raw);
    code = code.replace(/[\r\n\0]+/g, "");
    if ((process.env.SCANNER_PRINTABLE_ONLY ?? "1") !== "0")
      code = code.replace(/[^\x20-\x7E]/g, "");
    const maxLen = Number(process.env.SCANNER_MAX_LINE ?? 256);
    if (code.length > maxLen) code = code.slice(0, maxLen);
    if (!code) return;
    const acceptAny = (process.env.SCANNER_ACCEPT_ANY ?? '0') === '1';
    let out = code;
    if (!acceptAny) {
      // Accept AA:BB... or AA-BB... or AABB...
      const m = code.match(/([0-9A-F]{2}(?:[:\-]?[0-9A-F]{2}){5})/i);
      if (!m) return; // not a MAC-like payload
      out = m[1].replace(/[^0-9A-F]/gi, "").match(/.{2}/g)!.join(":").toUpperCase();
    }

    try {
      if ((process.env.SCAN_LOG ?? '0') === '1') LOG.tag('scanner').info('scan', { code: out, path });
      // concise monitor line
      LOG.tag('monitor').info(`SCAN ${out}${path ? ` @ ${path}` : ''}`);
    } catch {}
    broadcast({ type: "scan", code: out, path });
  });

  // Optional fallback: some scanners emit raw 6-byte payloads (MAC address) with no newline.
  // Enable with SCANNER_ALLOW_RAW_MAC=1 to parse fixed-length frames and broadcast as AA:BB:CC:DD:EE:FF
if ((process.env.SCANNER_ALLOW_ASCII_NO_NL ?? '0') === '1') {
  let asciiBuf = '';
  let t: NodeJS.Timeout | null = null;
  const idleMs = Number(process.env.SCANNER_IDLE_FLUSH_MS ?? 40);

  const flushAscii = () => {
    const payload = asciiBuf;
    asciiBuf = '';
    if (!payload) return;

    let code = payload.replace(/[\r\n\0]+/g, "");
    if ((process.env.SCANNER_PRINTABLE_ONLY ?? "1") !== "0")
      code = code.replace(/[^\x20-\x7E]/g, "");
    const maxLen = Number(process.env.SCANNER_MAX_LINE ?? 256);
    if (code.length > maxLen) code = code.slice(0, maxLen);
    if (!code) return;

    const acceptAny = (process.env.SCANNER_ACCEPT_ANY ?? '0') === '1';
    let out = code;
    if (!acceptAny) {
      const m = code.match(/([0-9A-F]{2}(?:[:\-]?[0-9A-F]{2}){5})/i);
      if (!m) return;
      out = m[1].replace(/[^0-9A-F]/gi, "").match(/.{2}/g)!.join(":").toUpperCase();
    }
    try { if ((process.env.SCAN_LOG ?? '0') === '1') LOG.tag('scanner').info('scan(ascii-no-nl)', { code: out, path }); } catch {}
    broadcast({ type: "scan", code: out, path });
  };

  const asciiHandler = (chunk: Buffer) => {
    try {
      const asStr = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : Buffer.from(chunk as any).toString('utf8');
      asciiBuf += asStr;
      if (t) clearTimeout(t);
      t = setTimeout(flushAscii, idleMs);
    } catch {}
  };

  try { (port as any).on('data', asciiHandler); } catch {}
  try {
    (port as any).once('close', () => {
      try { (port as any).off?.('data', asciiHandler); } catch {}
      if (t) clearTimeout(t);
      asciiBuf = '';
    });
  } catch {}
}



  // Optional ASCII-without-newline fallback using idle timer
  if ((process.env.SCANNER_ALLOW_ASCII_NO_NL ?? '0') === '1') {
    let asciiBuf = '';
    let t: NodeJS.Timeout | null = null;
    const idleMs = Number(process.env.SCANNER_IDLE_FLUSH_MS ?? 40);

    const flushAscii = () => {
      const payload = asciiBuf;
      asciiBuf = '';
      if (!payload) return;
      // Reuse the same parsing path as line mode
      let code = payload.replace(/[\r\n\0]+/g, "");
      if ((process.env.SCANNER_PRINTABLE_ONLY ?? "1") !== "0")
        code = code.replace(/[^\x20-\x7E]/g, "");
      const maxLen = Number(process.env.SCANNER_MAX_LINE ?? 256);
      if (code.length > maxLen) code = code.slice(0, maxLen);
      if (!code) return;
      const acceptAny = (process.env.SCANNER_ACCEPT_ANY ?? '0') === '1';
      let out = code;
      if (!acceptAny) {
        const m = code.match(/([0-9A-F]{2}(?:[:\-]?[0-9A-F]{2}){5})/i);
        if (!m) return;
        out = m[1].replace(/[^0-9A-F]/gi, "").match(/.{2}/g)!.join(":").toUpperCase();
      }
      try { if ((process.env.SCAN_LOG ?? '0') === '1') LOG.tag('scanner').info('scan(ascii-no-nl)', { code: out, path }); } catch {}
      broadcast({ type: "scan", code: out, path });
    };

    const asciiHandler = (chunk: Uint8Array) => {
      try {
        const asStr = Buffer.from(chunk).toString('utf8');
        asciiBuf += asStr;
        if (t) clearTimeout(t);
        t = setTimeout(flushAscii, idleMs);
      } catch {}
    };

    try { (port as any).on('data', asciiHandler); } catch {}
    try { (port as any).once('close', () => { try { (port as any).off?.('data', asciiHandler); } catch {}; if (t) clearTimeout(t); asciiBuf=''; }); } catch {}
  }

  port.on("close", () => {
    LOG.tag('scanner').warn(`port closed ${path}`);
    broadcast({ type: "scanner/close", path });
    state.port = null;
    state.parser = null;
    state.starting = null;
    bumpCooldown(retry, 2000);
  });

  port.on("error", (e) => {
    LOG.tag('scanner').error(`port error ${path}`, e);
    broadcast({ type: "scanner/error", error: String(e?.message ?? e), path });
    try { port.close(() => {}); } catch {}
    state.port = null;
    state.parser = null;
    state.starting = null;
    bumpCooldown(retry);
  });
}

export async function ensureScannerForPath(path: string, baudRate = 115200): Promise<void> {
  const ALLOW_USB_SCANNER = (process.env.ALLOW_USB_SCANNER ?? "0") === "1";
  if (!ALLOW_USB_SCANNER && /\/ttyUSB\d+$/i.test(path)) {
    const espPath = process.env.ESP_TTY ?? process.env.ESP_TTY_PATH ?? "";
    const LOG_SKIPS = (process.env.LOG_SCANNER_SKIPS ?? "0") === "1";
    if (LOG_SKIPS) {
      if (espPath && path === espPath) LOG.tag('scanner').info(`skip scanner on ESP path ${path}`);
      else LOG.tag('scanner').warn(`skip scanner open on USB path ${path} (set ALLOW_USB_SCANNER=1 to allow)`);
    }
    throw new Error(`SCANNER_SKIP_USB ${path}`);
  }

  let rt = scanners.get(path);
  if (!rt) {
    rt = {
      state: { port: null, parser: null, starting: null },
      retry: { nextAttemptAt: 0, retryMs: 2000, lastError: null, lastErrSentAt: 0 },
    };
    scanners.set(path, rt);
  }
  const { state, retry } = rt;

  if (state.port?.isOpen) return;
  if (state.starting) return state.starting;
  if (inCooldown(retry)) throw new Error(`SCANNER_COOLDOWN ${path} until ${new Date(retry.nextAttemptAt).toISOString()}`);

  function looksLikeSamePath(candidate: string, wanted: string) {
    if (candidate === wanted) return true;
    const tail = (wanted.split("/").pop() || wanted).toLowerCase();
    const m = tail.match(/^ttyacm(\d+)$/i);
    if (m) {
      const idx = m[1];
      return candidate.toLowerCase().endsWith(tail)
          || (/\/by-id\//i.test(candidate) && new RegExp(`acm${idx}(\\D|$)`, "i").test(candidate));
    }
    return candidate.toLowerCase().endsWith(tail);
  }

  const devices = await SerialPort.list();
  if (!devices.some((d) => looksLikeSamePath(d.path, path))) {
    const msg = `Scanner port not present: ${path}`;
    broadcastScannerErrorOnce(retry, msg, path);
    bumpCooldown(retry, 10_000);
    throw new Error(msg);
  }

  state.starting = new Promise<void>((resolve, reject) => {
    const effBaud = Number(process.env.SCANNER_BAUD ?? baudRate ?? 9600) || 9600;
    LOG.tag('scanner').info(`opening ${path} @${effBaud}`);
    const port = new SerialPort({ path, baudRate: effBaud, autoOpen: false, lock: false });

    const normalizer = new Transform({
      transform(chunk, _enc, cb) {
        const s = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
        // collapse CRLF/CR to LF so Readline sees '\n'
        cb(null, Buffer.from(s.replace(/\r\n/g, "\n").replace(/\r/g, "\n")));
      }
    });

    const parser = port
      .pipe(normalizer)
      .pipe(new ReadlineParser({ delimiter: /[\r\n]+/ } as any));

    // Watchdog: detect stuck-open (no callback) and surface an error
    let opened = false;
    const watchdogMs = Number(process.env.SCANNER_OPEN_TIMEOUT_MS ?? 4000);
    const watchdog = setTimeout(() => {
      if (opened) return;
      const msg = `open timeout ${path} after ${watchdogMs}ms`;
      LOG.tag('scanner').error(msg);
      broadcastScannerErrorOnce(retry, msg, path);
      try { port.close(() => {}); } catch {}
      state.port = null;
      state.parser = null;
      state.starting = null;
      bumpCooldown(retry);
      reject(new Error(msg));
    }, watchdogMs);

    // Helper: assert DTR/RTS to wake scanners that require it
    const assertControlLines = () => {
      try {
        port.set({ dtr: true, rts: true }, (err) => {
          if (err) LOG.tag('scanner').warn(`control-lines set failed ${path}`, err?.message ?? err);
          else LOG.tag('scanner').info(`control-lines asserted ${path} (DTR=1, RTS=1)`);
        });
      } catch (e: any) {
        LOG.tag('scanner').warn(`control-lines set exception ${path}`, e?.message ?? e);
      }
    };

    // Also log on 'open' event for visibility and (re)assert control lines
    port.on('open', () => {
      opened = true;
      try { clearTimeout(watchdog); } catch {}
      LOG.tag('scanner').info(`opened ${path}`);
      try { LOG.tag('monitor').info(`SCANNER OPEN ${path}`); } catch {}
      assertControlLines();
    });

    port.open((err) => {
      if (err) {
        LOG.tag('scanner').error(`open error ${path}`, err);
        broadcastScannerErrorOnce(retry, String(err?.message ?? err), path);
        state.port = null;
        state.parser = null;
        state.starting = null;
        bumpCooldown(retry);
        return reject(err);
      }
      opened = true;
      try { clearTimeout(watchdog); } catch {}
      LOG.tag('scanner').info(`opened ${path}`);
      try { LOG.tag('monitor').info(`SCANNER OPEN ${path}`); } catch {}
      assertControlLines();
      resetCooldown(retry);
      state.port = port;
      state.parser = parser;
      attachScannerHandlers(path, state, retry, port, parser);
      broadcast({ type: "scanner/open", path });
      state.starting = null;
      resolve();
    });
  });

  return state.starting;
}

export async function ensureScanners(pathsInput?: string | string[], baudRate = 115200): Promise<void> {
  const base =
    pathsInput ??
    process.env.SCANNER_TTY_PATHS ??
    process.env.SCANNER_TTY_PATH ??
    "/dev/ttyACM0";
  const paths = (Array.isArray(base) ? base : base.split(","))
    .map((s) => s.trim())
    .filter(Boolean);

  // include explicit secondary override if provided
  const s2 = (process.env.SCANNER2_TTY_PATH ?? process.env.SECOND_SCANNER_TTY_PATH ?? "").trim();
  if (s2 && !paths.includes(s2)) paths.push(s2);

  // Auto-discover additional ACM devices if present (helps when device index changes)
  try {
    const list = await SerialPort.list();
    const hex = (v?: string) => String(v || '').toLowerCase().replace(/^0x/, '');
    const acmPaths = list
      .map((d) => d.path)
      .filter((p): p is string => typeof p === 'string' && p.length > 0)
      .filter((p) => /(^|\/)ttyACM\d+$/.test(p) || /\/by-id\/.*ACM\d+/i.test(p));
    for (const p of acmPaths) if (!paths.includes(p)) paths.push(p);
    // Prefer Honeywell vendor (0x0C2E) when available to survive ACM index churn
    try {
      const honey = list
        .filter((d) => hex(d.vendorId) === '0c2e')
        .map((d) => d.path)
        .filter((p): p is string => typeof p === 'string' && p.length > 0);
      for (const p of honey) if (!paths.includes(p)) paths.push(p);
    } catch {}
    // Optionally include ttyUSB devices when allowed
    const allowUsb = (process.env.ALLOW_USB_SCANNER ?? "0") === "1";
    if (allowUsb) {
      const usbPaths = list
        .map((d) => d.path)
        .filter((p): p is string => typeof p === 'string' && p.length > 0)
        .filter((p) => /(^|\/)ttyUSB\d+$/i.test(p));
      for (const p of usbPaths) if (!paths.includes(p)) paths.push(p);
    }
  } catch {}

  await Promise.all(paths.map((p) => ensureScannerForPath(p, baudRate).catch(() => {})));
}

export async function ensureScanner(
  path = (process.env.SCANNER_TTY_PATHS ?? process.env.SCANNER_TTY_PATH ?? "/dev/ttyACM0")
    .split(",")[0]
    .trim(),
  baudRate = 115200
): Promise<void> {
  return ensureScannerForPath(path, baudRate);
}

export function getScannerStatus() {
  const obj: Record<string, { open: boolean; inCooldown: boolean; nextAttemptAt: number; lastError: string | null }> = {};
  for (const [path, rt] of scanners.entries()) {
    obj[path] = {
      open: !!rt.state.port?.isOpen,
      inCooldown: inCooldown(rt.retry),
      nextAttemptAt: rt.retry.nextAttemptAt,
      lastError: rt.retry.lastError,
    };
  }
  return obj;
}

export function considerDevicesForScanner(
  devices: DeviceInfo[],
  pathsInput = process.env.SCANNER_TTY_PATHS ?? process.env.SCANNER_TTY_PATH ?? "/dev/ttyACM0"
) {
  const extra = (process.env.SCANNER2_TTY_PATH ?? process.env.SECOND_SCANNER_TTY_PATH ?? "").trim();
  const paths = [
    ...pathsInput.split(",").map((s) => s.trim()).filter(Boolean),
    ...(extra ? [extra] : []),
  ];
  let anyPresent = false;
  for (const p of paths) {
    const present = devices.some((d) => d.path === p);
    if (present) {
      let rt = scanners.get(p);
      if (!rt) {
        rt = {
          state: { port: null, parser: null, starting: null },
          retry: { nextAttemptAt: 0, retryMs: 2000, lastError: null, lastErrSentAt: 0 },
        };
        scanners.set(p, rt);
      }
      resetCooldown(rt.retry);
      anyPresent = true;
    }
  }
  return anyPresent;
}

/* ────────────────────────────────────────────────────────────────────────────
   Dev cleanup
   ──────────────────────────────────────────────────────────────────────────── */

function closeAllScanners() {
  for (const [, rt] of scanners.entries()) {
    const p = rt.state.port;
    if (p) p.close(() => {});
    rt.state.port = null;
    rt.state.parser = null;
    rt.state.starting = null;
  }
}
function closeEsp() {
  const s = GBL.__ESP_STREAM?.port;
  if (s) try { s.close(() => {}); } catch {}
  GBL.__ESP_STREAM = undefined;
}

// Install process signal handlers only once (avoid MaxListeners warnings in dev/hot-reload)
const __g = globalThis as any;
if (!__g.__serial_sig_handlers_installed) {
  try { process.setMaxListeners?.(Math.max(20, process.getMaxListeners?.() ?? 10)); } catch {}
  process.on("SIGINT", () => { closeAllScanners(); closeEsp(); process.exit(); });
  process.on("SIGTERM", () => { closeAllScanners(); closeEsp(); process.exit(); });
  process.on("uncaughtException", () => { closeAllScanners(); closeEsp(); process.exit(1); });
  __g.__serial_sig_handlers_installed = true;
}

export default {
  // ESP core
  getEspLineStream,
  waitForLine,
  waitForNextLine,
  sendAndReceive,
  sendToEsp,
  pingEsp,
  espHealth,
  isEspPresent,
  listSerialDevices,
  listSerialDevicesRaw,
  // history fencing helpers
  mark,
  flushHistory,
  // Scanner fleet
  ensureScanner,
  ensureScannerForPath,
  ensureScanners,
  getScannerStatus,
  considerDevicesForScanner,
};
