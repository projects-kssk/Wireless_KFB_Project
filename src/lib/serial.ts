// src/lib/serial.ts
import { SerialPort } from "serialport";
import { ReadlineParser } from "@serialport/parser-readline";
import { setLastScan } from "@/lib/scannerMemory";
import { broadcast, DeviceInfo } from "@/lib/bus";

/* ────────────────────────────────────────────────────────────────────────────
   ESP helpers
   ──────────────────────────────────────────────────────────────────────────── */

export async function sendAndReceive(cmd: string, timeout = 10_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const port = new SerialPort({
      path: process.env.ESP_TTY_PATH ?? "/dev/ttyUSB0",
      baudRate: 115200,
      lock: false,
      autoOpen: false,
    });
    const parser = port.pipe(new ReadlineParser({ delimiter: "\n" }));

    let timer: NodeJS.Timeout;
    const cleanup = () => {
      clearTimeout(timer);
      try { parser.removeAllListeners(); } catch {}
      try { port.close(() => {}); } catch {}
    };

    parser.on("data", (raw) => {
      const line = String(raw).trim();
      console.log("⟵ [ESP line]", line);
      const up = line.toUpperCase();
      if (up.includes("SUCCESS") || up.includes("OK") || up.includes("FAIL") || up.startsWith("ERROR")) {
        cleanup();
        resolve(line);
      }
    });

    timer = setTimeout(() => { cleanup(); reject(new Error("ESP response timed out")); }, timeout);

    port.open((err) => {
      if (err) return reject(err);
      port.write(cmd + "\r\n", (werr) => {
        if (werr) return reject(werr);
        port.drain();
      });
    });

    port.on("error", (e) => { cleanup(); reject(e); });
  });
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

/** Presence check: treat server "online" if the ESP device node exists */
export async function isEspPresent(
  path = process.env.ESP_TTY_PATH ?? "/dev/ttyUSB0"
): Promise<boolean> {
  const list = await SerialPort.list();
  return list.some((d) => d.path === path);
}

/** Optional ping (templated) — only used if ESP_PING_CMD is non-empty */
export async function pingEsp(): Promise<{ ok: boolean; raw: string }> {
  const tmpl = (process.env.ESP_PING_CMD ?? "PING").trim(); // e.g. "PING {mac} {payload}"
  const mac = process.env.ESP_MAC ?? "";                    // real MAC if firmware requires it
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

/** Combined health:
 *  - If ESP_PING_CMD is blank => Online = presence only (no ping)
 *  - Else => Online = presence && ping OK
 */
export async function espHealth(): Promise<{ present: boolean; ok: boolean; raw: string }> {
  const present = await isEspPresent();
  const tmpl = (process.env.ESP_PING_CMD ?? "").trim();

  if (!present) return { present, ok: false, raw: "not present" };
  if (!tmpl) return { present, ok: true, raw: "present (no ping)" };

  const { ok, raw } = await pingEsp();
  return { present, ok, raw };
}

export async function sendToEsp(cmd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const port = new SerialPort({
      path: process.env.ESP_TTY_PATH ?? "/dev/ttyUSB0",
      baudRate: 115200,
      lock: false,
      autoOpen: false,
    });
    const parser = port.pipe(new ReadlineParser({ delimiter: "\n" }));
    parser.on("data", (l) => console.log("⟵ [ESP]", String(l).trim()));

    port.open((err) => {
      if (err) return reject(err);
      port.write(cmd + "\r\n", (werr) => {
        if (werr) return reject(werr);
        port.drain((derr) => {
          if (derr) return reject(derr);
          port.close(() => { console.log("⟶ [you]", cmd); resolve(); });
        });
      });
    });

    port.on("error", (e) => { console.error("SerialPort error", e); reject(e); });
  });
}

/* ────────────────────────────────────────────────────────────────────────────
   Multi-scanner singleton (per path) with per-port cooldown/backoff
   (unchanged from your version)
   ──────────────────────────────────────────────────────────────────────────── */

type ScannerPerPath = {
  port: SerialPort | null;
  parser: ReadlineParser | null;
  starting: Promise<void> | null;
};

type RetryState = {
  nextAttemptAt: number;
  retryMs: number;
  lastError: string | null;
  lastErrSentAt: number;
};

type Runtime = { state: ScannerPerPath; retry: RetryState };

const GG = globalThis as any;
if (!GG.__scanners) GG.__scanners = new Map<string, Runtime>();
const scanners: Map<string, Runtime> = GG.__scanners;

function getRuntime(path: string): Runtime {
  let rt = scanners.get(path);
  if (!rt) {
    rt = {
      state: { port: null, parser: null, starting: null },
      retry: { nextAttemptAt: 0, retryMs: 2000, lastError: null, lastErrSentAt: 0 },
    };
    scanners.set(path, rt);
  }
  return rt;
}

const now = () => Date.now();
const inCooldown = (r: RetryState) => now() < r.nextAttemptAt;
const bumpCooldown = (r: RetryState, ms?: number) => {
  r.retryMs = Math.min(ms ?? Math.ceil(r.retryMs * 1.7), 60_000);
  r.nextAttemptAt = now() + r.retryMs;
};
const resetCooldown = (r: RetryState) => { r.retryMs = 2000; r.nextAttemptAt = 0; };

function broadcastScannerErrorOnce(r: RetryState, msg: string) {
  const t = now();
  if (r.lastError !== msg || t - r.lastErrSentAt > 5000) {
    r.lastError = msg;
    r.lastErrSentAt = t;
    broadcast({ type: "scanner/error", error: msg });
  }
}

function attachScannerHandlers(path: string, state: ScannerPerPath, retry: RetryState, port: SerialPort, parser: ReadlineParser) {
  parser.on("data", (raw) => {
    const code = String(raw).trim();
    console.log(`[serial:${path}] "${raw}" -> "${code}"`);
    if (code) {
      setLastScan(code);
      broadcast({ type: "scan", code });
    }
  });

  port.on("close", () => {
    console.warn(`[scanner:${path}] port closed`);
    broadcast({ type: "scanner/close" });
    state.port = null;
    state.parser = null;
    state.starting = null;
  });

  port.on("error", (e) => {
    console.error(`[scanner:${path}] port error`, e);
    broadcastScannerErrorOnce(retry, String(e?.message ?? e));
    try { port.close(() => {}); } catch {}
    state.port = null;
    state.parser = null;
    state.starting = null;
    bumpCooldown(retry);
  });
}

export async function ensureScannerForPath(path: string, baudRate = 115200): Promise<void> {
  const { state, retry } = getRuntime(path);
  if (state.port?.isOpen) return;
  if (state.starting) return state.starting;
  if (inCooldown(retry)) throw new Error(`SCANNER_COOLDOWN ${path} until ${new Date(retry.nextAttemptAt).toISOString()}`);

  const devices = await listSerialDevices();
  if (!devices.some((d) => d.path === path)) {
    const msg = `Scanner port not present: ${path}`;
    broadcastScannerErrorOnce(retry, msg);
    bumpCooldown(retry, 10_000);
    throw new Error(msg);
  }

  state.starting = new Promise<void>((resolve, reject) => {
    console.log(`[scanner:${path}] Opening at ${baudRate}...`);
    const port = new SerialPort({ path, baudRate, autoOpen: false, lock: false });
    const parser = port.pipe(new ReadlineParser({ delimiter: "\n" }));

    port.open((err) => {
      if (err) {
        console.error(`[scanner:${path}] open error`, err);
        broadcastScannerErrorOnce(retry, String(err?.message ?? err));
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
      broadcast({ type: "scanner/open" });
      state.starting = null;
      resolve();
    });
  });

  return state.starting;
}

export async function ensureScanners(pathsInput?: string | string[], baudRate = 115200): Promise<void> {
  const paths = Array.isArray(pathsInput)
    ? pathsInput
    : (pathsInput ?? process.env.SCANNER_TTY_PATHS ?? process.env.SCANNER_TTY_PATH ?? "/dev/ttyACM0")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

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
  const paths = pathsInput.split(",").map((s) => s.trim()).filter(Boolean);
  let anyPresent = false;
  for (const p of paths) {
    const present = devices.some((d) => d.path === p);
    if (present) {
      const { retry } = getRuntime(p);
      resetCooldown(retry);
      anyPresent = true;
    }
  }
  return anyPresent;
}

/** Optional: ESP line stream singleton */
let espPort: SerialPort | null = null;
let espParser: ReadlineParser | null = null;

export function getEspLineStream(
  path = process.env.ESP_TTY_PATH ?? "/dev/ttyUSB0",
  baudRate = 115200
): { port: SerialPort; parser: ReadlineParser } {
  if (espPort && espParser) return { port: espPort, parser: espParser };
  espPort = new SerialPort({ path, baudRate, autoOpen: true, lock: false });
  espParser = espPort.pipe(new ReadlineParser({ delimiter: "\n" }));
  espPort.on("error", (e) => {
    console.error("[ESP port error]", e);
    espPort = null;
    espParser = null;
  });
  return { port: espPort, parser: espParser };
}

/** Dev-cleanup on exit */
function closeAllScanners() {
  for (const [, rt] of scanners.entries()) {
    const p = rt.state.port;
    if (p) p.close(() => {});
    rt.state.port = null;
    rt.state.parser = null;
    rt.state.starting = null;
  }
}
process.on("SIGINT", () => { closeAllScanners(); if (espPort) espPort.close(() => {}); process.exit(); });
process.on("SIGTERM", () => { closeAllScanners(); if (espPort) espPort.close(() => {}); process.exit(); });
process.on("uncaughtException", () => { closeAllScanners(); if (espPort) espPort.close(() => {}); process.exit(1); });

export default {
  sendAndReceive,
  sendToEsp,
  pingEsp,
  espHealth,
  isEspPresent,
  listSerialDevices,
  ensureScanner,
  ensureScannerForPath,
  ensureScanners,
  getScannerStatus,
  considerDevicesForScanner,
  getEspLineStream,
};
