// server.ts
import next from 'next'
import path from 'node:path'
import { createServer, IncomingMessage, ServerResponse } from 'http'
import type { Socket } from 'net'
import { WebSocketServer } from 'ws'
import type { RawData } from 'ws'
import type { WebSocket } from 'ws'

// ⬇️ keep real file imports with .js for NodeNext ESM
import { getEspLineStream, sendAndReceive } from './src/lib/serial.js'
import { getRedis } from './src/lib/redis.js'
import { LOG } from './src/lib/logger.js'

// Determine runtime context: packaged Electron vs local dev
const isElectronPackaged = Boolean((process as any).resourcesPath) && process.env.NODE_ENV !== 'development'
const dev = !isElectronPackaged && process.env.NODE_ENV !== 'production'

// In packaged mode, point Next to the asar mount (resources/app.asar)
const dir = isElectronPackaged
  ? path.join((process as any).resourcesPath, 'app.asar')
  : process.cwd()

// Suppress noisy Next.js request/fetch logs for aliases & ksk-lock endpoints.
const SUPPRESS_LOG_PATTERNS = [
  /\b\/?api\/aliases\b/i,
  /\[aliases\]/i,
  /\b\/?api\/ksk-lock\b/i,
  /\[ksk-lock\]/i,
];

const wrapConsole = <K extends "log" | "info">(key: K) => {
  const original = console[key].bind(console);
  console[key] = (...args: unknown[]) => {
    try {
      const merged = args
        .filter((value): value is string => typeof value === "string")
        .join(" ");
      if (merged && SUPPRESS_LOG_PATTERNS.some((re) => re.test(merged))) return;
    } catch {}
    original(...args);
  };
};

wrapConsole("log");
wrapConsole("info");

// TypeScript NodeNext typing workaround: cast to callable
const app = (next as unknown as (opts: any) => any)({ dev, dir })
const handle = app.getRequestHandler()
const PORT = parseInt(process.env.PORT || '3003', 10)

app.prepare().then(() => {
  const redis = getRedis();
  void redis;

  const server = createServer((req: IncomingMessage, res: ServerResponse) => handle(req, res))
  const wss = new WebSocketServer({ noServer: true })
  const log = LOG.tag('ws-server')

  server.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
    if (req.url === '/api/thread-ws') {
      wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
        wss.emit('connection', ws, req)
      })
    } else {
      socket.destroy()
    }
  })

  // single shared serial stream for all clients
  const { parser } = getEspLineStream()

  wss.on('connection', (ws: WebSocket) => {
    log.info('WS client connected')

    const onData = (raw: unknown) => {
      const line = String(raw).trim()
      ws.send(JSON.stringify({ type: 'event', data: line }))
    }
    parser.on('data', onData)

    ws.on('message', async (raw: RawData) => {
      let msg: { type: string; cmd?: string }
      try {
        msg = JSON.parse(raw.toString())
      } catch {
        return
      }

      if (msg.type === 'command' && msg.cmd) {
        try {
          const result = await sendAndReceive(msg.cmd)
          ws.send(JSON.stringify({ type: 'response', success: true, result }))
        } catch (err: unknown) {
          const message =
            err instanceof Error ? err.message : typeof err === 'string' ? err : String(err)
          ws.send(JSON.stringify({ type: 'response', success: false, error: message }))
        }
      }
    })

    ws.on('close', () => {
      parser.off('data', onData)
      log.info('WS client disconnected')
    })
  })

  server.listen(PORT, () => log.info(`Ready on http://localhost:${PORT}`))
})
