// src/lib/serial.ts
import { SerialPort } from "serialport";
import { ReadlineParser } from "@serialport/parser-readline";
import { setLastScanFor } from "@/lib/scannerMemory";
import { broadcast, DeviceInfo } from "@/lib/bus";

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
  console.log(`[ESP] opening ${path} @${baudRate}`);

  const port = new SerialPort({ path, baudRate, autoOpen: true, lock: false });
  const parser = port.pipe(new ReadlineParser({ delimiter: "\n" }));
  const ring: string[] = [];
  const ringIds: number[] = [];
  let nextId = 1;
  const subs = new Set<SubFn>();

  parser.on("data", (buf: Buffer | string) => {
    const s = String(buf).trim();
    if (!s) return;

    if (process.env.ESP_DEBUG) console.log(`[ESP:${path}] ${s}`);

    ring.push(s);
    ringIds.push(nextId++);
    if (ring.length > 400) {
      ring.shift();
      ringIds.shift();
    }

    subs.forEach((fn) => {
      try { fn(s, ringIds[ringIds.length - 1]!); } catch {}
    });
  });

  port.on("error", (e) => {
    console.error(`[ESP:${path}] error`, e?.message ?? e);
  });

  port.on("close", () => {
    GBL.__ESP_STREAM = undefined; // allow re-open later
  });

  GBL.__ESP_STREAM = { port, parser, ring, ringIds, nextId, subs };
  return GBL.__ESP_STREAM;
}

export function getEspLineStream(): EspLineStream { return armEsp(); }
export function mark(): number {
  const { ringIds } = armEsp();
  return ringIds.length ? ringIds[ringIds.length - 1]! : 0;
}
export function flushHistory(): number { return mark(); }

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
  if (process.env.ESP_DEBUG) console.log(`⟶ [you] ${line}`);
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
export async function espHealth(): Promise<{ present: boolean; ok: boolean; raw: string }> {
  const present = await isEspPresent();
  if (!present) return { present, ok: false, raw: "not present" };
  const tmpl = (process.env.ESP_PING_CMD ?? "").trim();
  if (!tmpl) return { present, ok: true, raw: "present (no ping)" };
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
  r.retryMs = Math.min(ms ?? Math.ceil(r.retryMs * 1.7), 60_000);
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
  parser.on("data", (raw) => {
    const code = String(raw).trim();
    if (!code) return;
    setLastScanFor(path, code);
    broadcast({ type: "scan", code, path });
  });

  port.on("close", () => {
    console.warn(`[scanner:${path}] port closed`);
    broadcast({ type: "scanner/close", path });
    state.port = null;
    state.parser = null;
    state.starting = null;
  });

  port.on("error", (e) => {
    console.error(`[scanner:${path}] port error`, e);
    broadcast({ type: "scanner/error", error: String(e?.message ?? e), path });
    try { port.close(() => {}); } catch {}
    state.port = null;
    state.parser = null;
    state.starting = null;
    bumpCooldown(retry);
  });
}

export async function ensureScannerForPath(path: string, baudRate = 115200): Promise<void> {
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

  const devices = await SerialPort.list();
  if (!devices.some((d) => d.path === path)) {
    const msg = `Scanner port not present: ${path}`;
    broadcastScannerErrorOnce(retry, msg, path);
    bumpCooldown(retry, 10_000);
    throw new Error(msg);
  }

  state.starting = new Promise<void>((resolve, reject) => {
    console.log(`[scanner:${path}] Opening @${baudRate}…`);
    const port = new SerialPort({ path, baudRate, autoOpen: false, lock: false });
    const parser = port.pipe(new ReadlineParser({ delimiter: "\n" }));

    port.open((err) => {
      if (err) {
        console.error(`[scanner:${path}] open error`, err);
        broadcastScannerErrorOnce(retry, String(err?.message ?? err), path);
        state.port = null;
        state.parser = null;
        state.starting = null;
        bumpCooldown(retry);
        return reject(err);
      }
      console.log(`[scanner:${path}] opened`);
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

process.on("SIGINT", () => { closeAllScanners(); closeEsp(); process.exit(); });
process.on("SIGTERM", () => { closeAllScanners(); closeEsp(); process.exit(); });
process.on("uncaughtException", () => { closeAllScanners(); closeEsp(); process.exit(1); });

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
