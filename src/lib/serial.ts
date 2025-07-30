// src/lib/serial.ts
import { SerialPort } from 'serialport'
import { ReadlineParser } from '@serialport/parser-readline'
import { setLastScan } from './scannerMemory'
/**
 * Send a command, ignore echoes/extra chatter,
 * then resolve on the first line containing OK, SUCCESS or any FAIL.
 */

let scannerPort: SerialPort | null = null
let scannerParser: ReadlineParser | null = null
let scannerStarted = false
export async function sendAndReceive(cmd: string, timeout = 10000): Promise<string> {
  return new Promise((resolve, reject) => {
    const port = new SerialPort({
      path: '/dev/ttyUSB0',
      baudRate: 115200,
      lock: false,
      autoOpen: false,
    })
    const parser = port.pipe(new ReadlineParser({ delimiter: '\r\n' }))

    let timer: NodeJS.Timeout
    const cleanup = () => {
      clearTimeout(timer)
      parser.removeAllListeners()
      port.close(() => {})
    }

    parser.on('data', raw => {
      const line = raw.trim()
      console.log('⟵ [ESP line]', line)
      const up = line.toUpperCase()

      // Accept SUCCESS or OK anywhere, or anything containing FAIL
      if (up.includes('SUCCESS') || up.includes('OK') || up.includes('FAIL')) {
        cleanup()
        resolve(line)
      }
      // otherwise keep waiting
    })

    timer = setTimeout(() => {
      cleanup()
      reject(new Error('ESP response timed out'))
    }, timeout)

    port.open(err => {
      if (err) return reject(err)
      port.write(cmd + '\r\n', werr => {
        if (werr) return reject(werr)
        port.drain() // parser will pick up the reply
      })
    })

    port.on('error', e => {
      cleanup()
      reject(e)
    })
  })
}

/**
 * Fire-and-forget a command, with console echo of any incoming lines.
 */
export async function sendToEsp(cmd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const port = new SerialPort({
      path: '/dev/ttyUSB0',
      baudRate: 115200,
      lock: false,
      autoOpen: false,
    })
    const parser = port.pipe(new ReadlineParser({ delimiter: '\r\n' }))
    parser.on('data', l => console.log('⟵ [ESP]', l.trim()))

    port.open(err => {
      if (err) return reject(err)
      port.write(cmd + '\r\n', werr => {
        if (werr) return reject(werr)
        port.drain(derr => {
          if (derr) return reject(derr)
          port.close(() => {
            console.log('⟶ [you]', cmd)
            resolve()
          })
        })
      })
    })

    port.on('error', e => {
      console.error('SerialPort error', e)
      reject(e)
    })
  })
}


export function listenScanner({
  path = '/dev/ttyACM0',
  baudRate = 9600,
  onScan,
}: {
  path?: string
  baudRate?: number
  onScan: (barcode: string) => void
}) {
  if (scannerPort) {
    // Remove or comment out this log to avoid spam:
    // console.log(`[scanner] Already started on ${scannerPort.path}, not opening again.`);
    return scannerPort;
  }
  console.log(`[scanner] Opening serial port ${path} at baud ${baudRate}...`);
  scannerPort = new SerialPort({ path, baudRate, autoOpen: true });
  scannerParser = scannerPort.pipe(new ReadlineParser({ delimiter: '\r\n' }));
  scannerParser.on('data', raw => {
    const code = raw.trim();
    console.log(`[serial] Raw data received: "${raw}" (trimmed: "${code}")`);
    if (code) onScan(code);
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
  if (scannerStarted && scannerPort?.isOpen) return
  scannerStarted = true
  listenScanner({
    path: '/dev/ttyACM0',
    baudRate: 9600,
    onScan: setLastScan
  })
}

// Optional: add manual close (useful for dev/hot-reload)
export function closeScanner() {
  if (scannerPort) {
    scannerPort.close(err => {
      if (err) console.error('Error closing scanner port:', err)
    })
    scannerPort = null
    scannerParser = null
    scannerStarted = false
  }
}

// Cleanup on exit (not perfect, but helps in dev)
process.on('SIGINT', () => {
  closeScanner()
  process.exit()
})
process.on('SIGTERM', () => {
  closeScanner()
  process.exit()
})
process.on('uncaughtException', () => {
  closeScanner()
  process.exit(1)
})

export default { sendAndReceive, sendToEsp, listenScanner, ensureScanner }

