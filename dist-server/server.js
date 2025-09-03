// server.ts
import next from 'next';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { WebSocketServer, RawData } from 'ws';
// ⬇️ keep real file imports with .js for NodeNext ESM
import { getEspLineStream, sendAndReceive } from './src/lib/serial.js';
import { LOG } from './src/lib/logger.js';
const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
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
