// server.ts
import next from 'next';
import path from 'node:path';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
// ⬇️ keep real file imports with .js for NodeNext ESM
import { getEspLineStream, sendAndReceive } from './src/lib/serial.js';
import { LOG } from './src/lib/logger.js';
// Determine runtime context: packaged Electron vs local dev
const isElectronPackaged = Boolean(process.resourcesPath) && process.env.NODE_ENV !== 'development';
const dev = !isElectronPackaged && process.env.NODE_ENV !== 'production';
// In packaged mode, point Next to the asar mount (resources/app.asar)
const dir = isElectronPackaged
    ? path.join(process.resourcesPath, 'app.asar')
    : process.cwd();
// TypeScript NodeNext typing workaround: cast to callable
const app = next({ dev, dir });
const handle = app.getRequestHandler();
const PORT = parseInt(process.env.PORT || '3003', 10);
app.prepare().then(() => {
    const server = createServer((req, res) => handle(req, res));
    const wss = new WebSocketServer({ noServer: true });
    const log = LOG.tag('ws-server');
    server.on('upgrade', (req, socket, head) => {
        if (req.url === '/api/thread-ws') {
            wss.handleUpgrade(req, socket, head, (ws) => {
                wss.emit('connection', ws, req);
            });
        }
        else {
            socket.destroy();
        }
    });
    // single shared serial stream for all clients
    const { parser } = getEspLineStream();
    wss.on('connection', (ws) => {
        log.info('WS client connected');
        const onData = (raw) => {
            const line = String(raw).trim();
            ws.send(JSON.stringify({ type: 'event', data: line }));
        };
        parser.on('data', onData);
        ws.on('message', async (raw) => {
            let msg;
            try {
                msg = JSON.parse(raw.toString());
            }
            catch {
                return;
            }
            if (msg.type === 'command' && msg.cmd) {
                try {
                    const result = await sendAndReceive(msg.cmd);
                    ws.send(JSON.stringify({ type: 'response', success: true, result }));
                }
                catch (err) {
                    const message = err instanceof Error ? err.message : typeof err === 'string' ? err : String(err);
                    ws.send(JSON.stringify({ type: 'response', success: false, error: message }));
                }
            }
        });
        ws.on('close', () => {
            parser.off('data', onData);
            log.info('WS client disconnected');
        });
    });
    server.listen(PORT, () => log.info(`Ready on http://localhost:${PORT}`));
});
