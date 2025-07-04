// src/lib/serial.ts
import { SerialPort } from 'serialport'
import { ReadlineParser } from '@serialport/parser-readline'

/**
 * Send a command, ignore echoes/extra chatter,
 * then resolve on the first line containing OK, SUCCESS or any FAIL.
 */
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

export default { sendAndReceive, sendToEsp }
