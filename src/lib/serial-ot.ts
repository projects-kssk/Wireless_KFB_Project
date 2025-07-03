// lib/serial-ot.ts
import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';

const port = new SerialPort({
  path: '/dev/ttyUSB0',
  baudRate: 115200,
  autoOpen: true,
  // rtscts: true,
});

const parser = port.pipe(new ReadlineParser({ delimiter: '\r\n' }));
type QueueItem = {
  cmd: string;
  resolve: (lines: string[]) => void;
  reject: (err: Error) => void;
  buffer: string[];
};

const commandQueue: QueueItem[] = [];
let busy = false;

parser.on('data', (line: string) => {
  console.log('⟵', line);
  if (!busy || commandQueue.length === 0) return;
  const current = commandQueue[0];
  current.buffer.push(line);

  if (line === 'Done' || line.startsWith('Error')) {
    commandQueue.shift();
    busy = false;

    if (line === 'Done') {
      current.resolve(current.buffer.filter(l => l !== 'Done'));
    } else {
      current.reject(new Error(current.buffer.join('\n')));
    }

    processQueue();
  }
});

function processQueue() {
  if (busy || commandQueue.length === 0) return;

  busy = true;
  const { cmd, reject } = commandQueue[0];
  console.log('⟶', cmd);
  port.write(cmd + '\r\n', err => {
    if (err) {
      commandQueue.shift();
      busy = false;
      reject(err);
      processQueue();
    }
  });
}

/**
 * Send a Thread CLI command over serial and get back the lines (minus "Done").
 */
export function sendOtCommand(cmd: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    commandQueue.push({ cmd, resolve, reject, buffer: [] });
    processQueue();
  });
}

// Export parser if you want raw-line events in your WS server:
export { parser };
