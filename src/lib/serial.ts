// src/lib/serial.ts
import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';
import { setLastScan } from '@/lib/scannerMemory';
import { serialBus, broadcast, DeviceInfo } from "@/lib/bus";
/** ────────────────────────────────────────────────────────────────────────────
 * ESP command helpers (unchanged)
 * ────────────────────────────────────────────────────────────────────────────
 */
export async function sendAndReceive(cmd: string, timeout = 10_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const port = new SerialPort({
      path: process.env.ESP_TTY_PATH ?? '/dev/ttyUSB0',
      baudRate: 115200,
      lock: false,
      autoOpen: false,
    });
    const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));

    let timer: NodeJS.Timeout;
    const cleanup = () => {
      clearTimeout(timer);
      parser.removeAllListeners();
      port.close(() => {});
    };

    parser.on('data', raw => {
      const line = String(raw).trim();
      console.log('⟵ [ESP line]', line);
      const up = line.toUpperCase();
      if (up.includes('SUCCESS') || up.includes('OK') || up.includes('FAIL')) {
        cleanup();
        resolve(line);
      }
    });

    timer = setTimeout(() => {
      cleanup();
      reject(new Error('ESP response timed out'));
    }, timeout);

    port.open(err => {
      if (err) return reject(err);
      port.write(cmd + '\r\n', werr => {
        if (werr) return reject(werr);
        port.drain();
      });
    });

    port.on('error', e => {
      cleanup();
      reject(e);
    });
  });
}

export async function listSerialDevices(): Promise<DeviceInfo[]> {
  const list = await SerialPort.list();
  return list.map(d => ({
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
      path: process.env.ESP_TTY_PATH ?? '/dev/ttyUSB0',
      baudRate: 115200,
      lock: false,
      autoOpen: false,
    });
    const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));
    parser.on('data', l => console.log('⟵ [ESP]', String(l).trim()));

    port.open(err => {
      if (err) return reject(err);
      port.write(cmd + '\r\n', werr => {
        if (werr) return reject(werr);
        port.drain(derr => {
          if (derr) return reject(derr);
          port.close(() => {
            console.log('⟶ [you]', cmd);
            resolve();
          });
        });
      });
    });

    port.on('error', e => {
      console.error('SerialPort error', e);
      reject(e);
    });
  });
}

/** ────────────────────────────────────────────────────────────────────────────
 * Scanner singleton (now at 115200 baud)
 * ────────────────────────────────────────────────────────────────────────────
 */
type ScannerState = {
  port: SerialPort | null;
  parser: ReadlineParser | null;
  starting: Promise<void> | null;
};

const g = globalThis as unknown as { __scannerState?: ScannerState };
if (!g.__scannerState) {
  g.__scannerState = { port: null, parser: null, starting: null };
}
const scannerState = g.__scannerState;

function attachScannerHandlers(port: SerialPort, parser: ReadlineParser) {
  parser.on("data", raw => {
    const code = String(raw).trim();
    console.log(`[serial] Raw data received: "${raw}" (trimmed: "${code}")`);
    if (code) {
      setLastScan(code);
      broadcast({ type: "scan", code });     // NEW: push scans live
    }
  });

  port.on("close", () => {
    console.warn("[scanner] port closed");
    broadcast({ type: "scanner/close" });     // NEW
    scannerState.port = null;
    scannerState.parser = null;
    scannerState.starting = null;
  });

  port.on("error", e => {
    console.error("[scanner] port error", e);
    broadcast({ type: "scanner/error", error: String(e?.message ?? e) }); // NEW
    try { port.close(() => {}); } catch {}
    scannerState.port = null;
    scannerState.parser = null;
    scannerState.starting = null;
  });
}

export async function ensureScanner(
  path = process.env.SCANNER_TTY_PATH ?? "/dev/ttyACM0",
  baudRate = 115200
): Promise<void> {
  if (scannerState.port?.isOpen) return;
  if (scannerState.starting) return scannerState.starting;

  scannerState.starting = new Promise<void>((resolve, reject) => {
    console.log(`[scanner] Opening serial port ${path} at baud ${baudRate}...`);
    const port = new SerialPort({ path, baudRate, autoOpen: false, lock: false });
    const parser = port.pipe(new ReadlineParser({ delimiter: "\n" }));

    port.open(err => {
      if (err) {
        console.error("[scanner] open error", err);
        scannerState.port = null;
        scannerState.parser = null;
        scannerState.starting = null;
        return reject(err);
      }
      console.log("[scanner] port opened");
      scannerState.port = port;
      scannerState.parser = parser;
      attachScannerHandlers(port, parser);
      broadcast({ type: "scanner/open" });    // NEW
      resolve();
    });
  });

  return scannerState.starting;
}


export function closeScanner() {
  if (scannerState.port) {
    scannerState.port.close(err => {
      if (err) console.error('Error closing scanner port:', err);
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
  path = process.env.ESP_TTY_PATH ?? '/dev/ttyUSB0',
  baudRate = 115200
): { port: SerialPort; parser: ReadlineParser } {
  if (espPort && espParser) return { port: espPort, parser: espParser };
  espPort = new SerialPort({ path, baudRate, autoOpen: true, lock: false });
  espParser = espPort.pipe(new ReadlineParser({ delimiter: '\n' }));
  espPort.on('error', e => {
    console.error('[ESP port error]', e);
    espPort = null;
    espParser = null;
  });
  return { port: espPort, parser: espParser };
}

/** Dev-cleanup on exit */
process.on('SIGINT', () => { closeScanner(); if (espPort) espPort.close(() => {}); process.exit(); });
process.on('SIGTERM', () => { closeScanner(); if (espPort) espPort.close(() => {}); process.exit(); });
process.on('uncaughtException', () => { closeScanner(); if (espPort) espPort.close(() => {}); process.exit(1); });

export default {
  sendAndReceive,
  sendToEsp,
  ensureScanner,
  closeScanner,
  getEspLineStream,
};
