// src/lib/serial.ts
import { SerialPort } from "serialport";
import { ReadlineParser } from "@serialport/parser-readline";
import { setLastScan } from "@/lib/scannerMemory";
import { broadcast, DeviceInfo } from "@/lib/bus";

/** ────────────────────────────────────────────────────────────────────────────
 * ESP command helpers (unchanged)
 * ────────────────────────────────────────────────────────────────────────────
 */
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
      try {
        parser.removeAllListeners();
      } catch {}
      try {
        port.close(() => {});
      } catch {}
    };

    parser.on("data", (raw) => {
      const line = String(raw).trim();
      console.log("⟵ [ESP line]", line);
      const up = line.toUpperCase();
      if (up.includes("SUCCESS") || up.includes("OK") || up.includes("FAIL")) {
        cleanup();
        resolve(line);
      }
    });

    timer = setTimeout(() => {
      cleanup();
      reject(new Error("ESP response timed out"));
    }, timeout);

    port.open((err) => {
      if (err) return reject(err);
      port.write(cmd + "\r\n", (werr) => {
        if (werr) return reject(werr);
        port.drain();
      });
    });

    port.on("error", (e) => {
      cleanup();
      reject(e);
    });
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
          port.close(() => {
            console.log("⟶ [you]", cmd);
            resolve();
          });
        });
      });
    });

    port.on("error", (e) => {
      console.error("SerialPort error", e);
      reject(e);
    });
  });
}

/** ────────────────────────────────────────────────────────────────────────────
 * Scanner singleton
 * ────────────────────────────────────────────────────────────────────────────
 */
type ScannerState = {
  port: SerialPort | null;
  parser: ReadlineParser | null;
  starting: Promise<void> | null;
};

const G = globalThis as unknown as {
  __scannerState?: ScannerState;
  __scannerRetry?: RetryState;
};
if (!G.__scannerState) G.__scannerState = { port: null, parser: null, starting: null };
const scannerState = G.__scannerState;

/** Retry/cooldown state persisted across HMR */
type RetryState = {
  nextAttemptAt: number; // epoch ms
  retryMs: number; // backoff ms
  lastError: string | null;
  lastErrSentAt: number; // epoch ms (for throttling error events)
};
if (!G.__scannerRetry)
  G.__scannerRetry = { nextAttemptAt: 0, retryMs: 2000, lastError: null, lastErrSentAt: 0 };
const retry = G.__scannerRetry;

const now = () => Date.now();
const inCooldown = () => now() < retry.nextAttemptAt;
const bumpCooldown = (ms?: number) => {
  retry.retryMs = Math.min(ms ?? Math.ceil(retry.retryMs * 1.7), 60_000);
  retry.nextAttemptAt = now() + retry.retryMs;
};
const resetCooldown = () => {
  retry.retryMs = 2000;
  retry.nextAttemptAt = 0;
};

function broadcastScannerErrorOnce(msg: string) {
  const t = now();
  if (retry.lastError !== msg || t - retry.lastErrSentAt > 5000) {
    retry.lastError = msg;
    retry.lastErrSentAt = t;
    broadcast({ type: "scanner/error", error: msg });
  }
}

function attachScannerHandlers(port: SerialPort, parser: ReadlineParser) {
  parser.on("data", (raw) => {
    const code = String(raw).trim();
    console.log(`[serial] Raw data received: "${raw}" (trimmed: "${code}")`);
    if (code) {
      setLastScan(code);
      broadcast({ type: "scan", code });
    }
  });

  port.on("close", () => {
    console.warn("[scanner] port closed");
    broadcast({ type: "scanner/close" });
    scannerState.port = null;
    scannerState.parser = null;
    scannerState.starting = null;
  });

  port.on("error", (e) => {
    console.error("[scanner] port error", e);
    broadcastScannerErrorOnce(String(e?.message ?? e));
    try {
      port.close(() => {});
    } catch {}
    scannerState.port = null;
    scannerState.parser = null;
    scannerState.starting = null;
    bumpCooldown(); // back off on error
  });
}

/** Public: lightweight status for API routes/UI */
export function getScannerStatus() {
  return {
    open: !!scannerState.port?.isOpen,
    inCooldown: inCooldown(),
    nextAttemptAt: retry.nextAttemptAt,
    lastError: retry.lastError,
  };
}

/** Public: called by SSE route when it sees devices; resets cooldown if desired path appears */
export function considerDevicesForScanner(
  devices: DeviceInfo[],
  desiredPath = process.env.SCANNER_TTY_PATH ?? "/dev/ttyACM0"
) {
  const present = devices.some((d) => d.path === desiredPath);
  if (present) resetCooldown();
  return present;
}

export async function ensureScanner(
  path = process.env.SCANNER_TTY_PATH ?? "/dev/ttyACM0",
  baudRate = 115200
): Promise<void> {
  if (scannerState.port?.isOpen) return;
  if (scannerState.starting) return scannerState.starting;
  if (inCooldown()) {
    throw new Error(`SCANNER_COOLDOWN until ${new Date(retry.nextAttemptAt).toISOString()}`);
  }

  // Only attempt to open if the target device path is present right now
  const devices = await listSerialDevices();
  const present = devices.some((d) => d.path === path);
  if (!present) {
    const msg = `Scanner port not present: ${path}`;
    broadcastScannerErrorOnce(msg);
    bumpCooldown(10_000); // wait at least 10s before the next try
    throw new Error(msg);
  }

  scannerState.starting = new Promise<void>((resolve, reject) => {
    console.log(`[scanner] Opening serial port ${path} at baud ${baudRate}...`);
    const port = new SerialPort({ path, baudRate, autoOpen: false, lock: false });
    const parser = port.pipe(new ReadlineParser({ delimiter: "\n" }));

    port.open((err) => {
      if (err) {
        console.error("[scanner] open error", err);
        broadcastScannerErrorOnce(String(err?.message ?? err));
        scannerState.port = null;
        scannerState.parser = null;
        scannerState.starting = null;
        bumpCooldown();
        return reject(err);
      }
      console.log("[scanner] port opened");
      resetCooldown(); // success clears backoff
      scannerState.port = port;
      scannerState.parser = parser;
      attachScannerHandlers(port, parser);
      broadcast({ type: "scanner/open" });
      resolve();
      // allow future re-opens if it closes later
      scannerState.starting = null;
    });
  });

  return scannerState.starting;
}

export function closeScanner() {
  if (scannerState.port) {
    scannerState.port.close((err) => {
      if (err) console.error("Error closing scanner port:", err);
    });
  }
  scannerState.port = null;
  scannerState.parser = null;
  scannerState.starting = null;
}

/** ────────────────────────────────────────────────────────────────────────────
 * Optional: ESP line stream singleton
 * ────────────────────────────────────────────────────────────────────────────
 */
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
process.on("SIGINT", () => {
  closeScanner();
  if (espPort) espPort.close(() => {});
  process.exit();
});
process.on("SIGTERM", () => {
  closeScanner();
  if (espPort) espPort.close(() => {});
  process.exit();
});
process.on("uncaughtException", () => {
  closeScanner();
  if (espPort) espPort.close(() => {});
  process.exit(1);
});

export default {
  sendAndReceive,
  sendToEsp,
  ensureScanner,
  closeScanner,
  getEspLineStream,
  listSerialDevices,
  getScannerStatus,
  considerDevicesForScanner,
};
