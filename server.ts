// server.ts
import next from 'next';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { WebSocketServer } from 'ws';
import { sendOtCommand, parser } from './lib/serial-ot';
const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();
const PORT = parseInt(process.env.PORT || '3000', 10);

app.prepare().then(() => {
  const server = createServer((req: IncomingMessage, res: ServerResponse) =>
    handle(req, res)
  );

  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    if (req.url === '/api/thread-ws') {
      wss.handleUpgrade(req, socket, head, ws => {
        wss.emit('connection', ws, req);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on('connection', ws => {
    console.log('WS client connected');

    // stream serial lines as events
    parser.on('data', (line: string) => {
      ws.send(JSON.stringify({ type: 'event', data: line }));
    });

    ws.on('message', async raw => {
      let msg: { type: string; cmd?: string };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (msg.type === 'command' && msg.cmd) {
        try {
          const lines = await sendOtCommand(msg.cmd);
          ws.send(
            JSON.stringify({ type: 'response', success: true, result: lines })
          );
        } catch (err: any) {
          ws.send(
            JSON.stringify({
              type: 'response',
              success: false,
              error: err.message,
            })
          );
        }
      }
    });

    ws.on('close', () => console.log('WS client disconnected'));
  });

  server.listen(PORT, () =>
    console.log(`> Ready on http://localhost:${PORT}`)
  );
});
