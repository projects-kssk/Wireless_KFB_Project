// esp.js
import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';
import readline from 'readline';

// — Serial setup —
const port = new SerialPort({ path: '/dev/ttyUSB0', baudRate: 115200 });
const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));

parser.on('data', line => {
  console.log('⟵', line.trim());
});

// — Read from stdin —
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: 'CMD> ',
});

port.on('open', () => {
  console.log('Serial open. Type commands below:');
  rl.prompt();
});

rl.on('line', input => {
  const cmd = input.trim();
  if (cmd) {
    console.log('⟶', cmd);
    port.write(cmd + '\n');
  }
  rl.prompt();
});

port.on('error', err => {
  console.error('Serial error:', err);
  process.exit(1);
});
