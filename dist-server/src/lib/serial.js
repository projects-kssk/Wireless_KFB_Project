// src/lib/serial.ts
import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';
import { setLastScan } from './scannerMemory';
/** ----------------- ESP command helpers (you already had these) ----------------- */
export async function sendAndReceive(cmd, timeout = 10000) {
    return new Promise((resolve, reject) => {
        const port = new SerialPort({
            path: '/dev/ttyUSB0',
            baudRate: 115200,
            lock: false,
            autoOpen: false,
        });
        const parser = port.pipe(new ReadlineParser({ delimiter: '\r\n' }));
        let timer;
        const cleanup = () => {
            clearTimeout(timer);
            parser.removeAllListeners();
            port.close(() => { });
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
            if (err)
                return reject(err);
            port.write(cmd + '\r\n', werr => {
                if (werr)
                    return reject(werr);
                port.drain(); // parser will pick up the reply
            });
        });
        port.on('error', e => {
            cleanup();
            reject(e);
        });
    });
}
export async function sendToEsp(cmd) {
    return new Promise((resolve, reject) => {
        const port = new SerialPort({
            path: '/dev/ttyUSB0',
            baudRate: 115200,
            lock: false,
            autoOpen: false,
        });
        const parser = port.pipe(new ReadlineParser({ delimiter: '\r\n' }));
        parser.on('data', l => console.log('⟵ [ESP]', String(l).trim()));
        port.open(err => {
            if (err)
                return reject(err);
            port.write(cmd + '\r\n', werr => {
                if (werr)
                    return reject(werr);
                port.drain(derr => {
                    if (derr)
                        return reject(derr);
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
/** ----------------- Scanner helpers (you already had these) ----------------- */
let scannerPort = null;
let scannerParser = null;
let scannerStarted = false;
export function listenScanner({ path = '/dev/ttyACM0', baudRate = 9600, onScan, }) {
    if (scannerPort)
        return scannerPort;
    console.log(`[scanner] Opening serial port ${path} at baud ${baudRate}...`);
    scannerPort = new SerialPort({ path, baudRate, autoOpen: true });
   
// AFTER – accept "\n" or "\r\n"
scannerParser = scannerPort.pipe(
  new ReadlineParser({ delimiter: /\r?\n/ })  // <— key change
);
    scannerParser.on('data', raw => {
        const code = String(raw).trim();
  console.log(`[serial] Raw data received: "${raw}" (trimmed: "${code}")`);
  if (code) setLastScan(code);    // unchanged
        if (code)
            onScan(code);
    });
    scannerPort.on('error', e => {
        console.error('SerialPort error', e);
        scannerPort = null;
        scannerParser = null;
        scannerStarted = false;
    });
    return scannerPort;
}
export function ensureScanner() {
    if (scannerStarted && scannerPort?.isOpen)
        return;
    scannerStarted = true;
    listenScanner({ path: '/dev/ttyACM0', baudRate: 9600, onScan: setLastScan });
}
export function closeScanner() {
    if (scannerPort) {
        scannerPort.close(err => {
            if (err)
                console.error('Error closing scanner port:', err);
        });
        scannerPort = null;
        scannerParser = null;
        scannerStarted = false;
    }
}
/** ----------------- NEW: Singleton ESP line stream for WS broadcast ----------------- */
let espPort = null;
let espParser = null;
export function getEspLineStream(path = '/dev/ttyUSB0', baudRate = 115200) {
    if (espPort && espParser)
        return { port: espPort, parser: espParser };
    espPort = new SerialPort({ path, baudRate, autoOpen: true });
    espParser = espPort.pipe(new ReadlineParser({ delimiter: '\r\n' }));
    espPort.on('error', e => {
        console.error('[ESP port error]', e);
        espPort = null;
        espParser = null;
    });
    return { port: espPort, parser: espParser };
}
/** Optional: cleanup on exit (dev convenience) */
process.on('SIGINT', () => {
    closeScanner();
    if (espPort)
        espPort.close(() => { });
    process.exit();
});
process.on('SIGTERM', () => {
    closeScanner();
    if (espPort)
        espPort.close(() => { });
    process.exit();
});
process.on('uncaughtException', () => {
    closeScanner();
    if (espPort)
        espPort.close(() => { });
    process.exit(1);
});
export default {
    sendAndReceive,
    sendToEsp,
    listenScanner,
    ensureScanner,
    getEspLineStream,
};
//# sourceMappingURL=serial.js.map