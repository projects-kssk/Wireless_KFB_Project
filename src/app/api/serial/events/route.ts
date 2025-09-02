import os from 'os';
import { promises as fs } from 'fs';
import { onSerialEvent } from '@/lib/bus';
import {
  listSerialDevices,
  ensureScanners,
  considerDevicesForScanner,
  espHealth,
} from '@/lib/serial';
import { getRedis, redisDetail } from '@/lib/redis';
import serial from '@/lib/serial';

// Lightweight log de-dupe to avoid spamming identical RESULT/EV lines
const __LAST_LOG = {
  map: new Map<string, number>(),
  shouldLog(key: string, windowMs = 1500) {
    const now = Date.now();
    const last = this.map.get(key) || 0;
    if (now - last < windowMs) return false;
    this.map.set(key, now);
    return true;
  }
};

// Ensure bus → memory is wired once per process
import '@/lib/scanSink';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0 as const;
// Prevent caching at the framework layer
export const fetchCache = 'force-no-store';

function envScannerPaths(): string[] {
  const base =
    process.env.SCANNER_TTY_PATHS ??
    process.env.SCANNER_TTY_PATH ??
    '/dev/ttyACM0';
  const list = base.split(',').map(s => s.trim()).filter(Boolean);
  const s2 =
    (process.env.SCANNER2_TTY_PATH ??
      process.env.SECOND_SCANNER_TTY_PATH ??
      '').trim();
  if (s2 && !list.includes(s2)) list.push(s2);
  return Array.from(new Set(list));
}

const isLikelySerialPath = (p: string) =>
  /\/dev\/(tty(ACM|USB)\d+|tty\.usb|cu\.usb)/i.test(p);

function netIfaceName() {
  return (process.env.NET_IFACE || 'eth0').trim();
}

async function ethStatus() {
  const iface = netIfaceName();
  const ifaces = os.networkInterfaces();
  const present = !!ifaces[iface];

  let oper: string | null = null;
  let carrier: string | null = null;
  try { oper = (await fs.readFile(`/sys/class/net/${iface}/operstate`, 'utf8')).trim(); } catch {}
  try { carrier = (await fs.readFile(`/sys/class/net/${iface}/carrier`, 'utf8')).trim(); } catch {}

  const ip =
    (ifaces[iface] || [])
      .filter((x: any) => x.family === 'IPv4' && !x.internal)
      .map((x: any) => x.address)[0] ?? null;

  const up = oper === 'up' || carrier === '1' || !!ip;
  return { iface, present, up, ip, oper };
}

export async function GET(req: Request) {
  const encoder = new TextEncoder();
  const urlObj = new URL(req.url);
  const macParam = (urlObj.searchParams.get('mac') || '').trim();
  const macFilter = macParam.toUpperCase();
  const macSet: Set<string> | null = macFilter
    ? new Set(macFilter.split(',').map(s => s.trim()).filter(Boolean))
    : null;
  const macAllowed = (m?: string | null) => {
    if (!macSet) return true; // no filter → allow all
    const up = String(m || '').toUpperCase();
    return up && macSet.has(up);
  };
  const EV_STRICT = (process.env.EV_STRICT ?? '0') === '1';
  let closed = false;
  let heartbeat: NodeJS.Timeout | null = null;
  let pollTimer: NodeJS.Timeout | null = null;
  let unsubscribe: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        if (pollTimer) clearInterval(pollTimer);
        if (unsubscribe) try { unsubscribe(); } catch {}
        try { controller.close(); } catch {}
      };

      try { (req as any).signal?.addEventListener('abort', cleanup); } catch {}

      const push = (s: string) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(s)); } catch { cleanup(); }
      };
      const send = (obj: unknown) => push(`data: ${JSON.stringify(obj)}\n\n`);
      const comment = (txt: string) => push(`: ${txt}\n\n`);

      // Make EventSource happy immediately
      push('retry: 2000\n\n');      // reconnection advice
      comment('open');               // first byte flush

      // Heartbeat to keep proxies from buffering
      heartbeat = setInterval(() => comment('ping'), 15_000);

      // Relay bus events
      unsubscribe = onSerialEvent(e => send(e));

      // Initial payloads
      try { send({ type: 'net', ...(await ethStatus()) }); } catch {}
      try { const r: any = getRedis(); const d = redisDetail(); send({ type: 'redis', ready: !!(r && (r.status === 'ready')), status: r?.status, detail: d }); } catch {}

      const configured = envScannerPaths();
      let allPaths = configured.slice();
      send({ type: 'scanner/paths', paths: allPaths });

      try {
        const devices = await listSerialDevices();
        send({ type: 'devices', devices });

        const discovered = devices
          .map(d => d.path)
          .filter(Boolean)
          .filter(isLikelySerialPath) as string[];

        allPaths = Array.from(new Set([...allPaths, ...discovered]));
        if (allPaths.length) send({ type: 'scanner/paths', paths: allPaths });

        considerDevicesForScanner(devices, allPaths.join(','));
        ensureScanners(allPaths).catch((err: any) => {
          send({ type: 'scanner/error', error: String(err?.message ?? err) });
        });
      } catch {}

      // One-time ESP snapshot
      try {
        const { present, ok, raw } = await espHealth();
        send({ type: 'esp', ok, raw, present });
      } catch (err: any) {
        send({ type: 'esp', ok: false, error: String(err?.message ?? err) });
      }

      // Wire ESP line stream → parse EV lines and forward as SSE
      try {
        const s: any = (serial as any).getEspLineStream?.();
        const onLine = (buf: Buffer | string) => {
          try {
            const line = String(buf).trim();
            if (!line) return;
            // EV protocol parsing
            // EV P <ch> <0|1> <mac>
            // EV L <ch> <0|1> <mac>
            // EV DONE <SUCCESS|FAILURE> <mac>
            // Legacy: RESULT SUCCESS|FAILURE ... <mac>
            let m: RegExpMatchArray | null = null;
            // Relaxed: allow timestamps/prefix before EV
            if ((m = line.match(/\bEV\s+([PL])\s+(\d{1,3})\s+([01])\s+([0-9A-F:]{17})/i))) {
              const kind = m[1].toUpperCase();
              const ch = Number(m[2]);
              const val = Number(m[3]);
              let mac = m[4].toUpperCase();
              // If EV embeds zero MAC, prefer the first MAC token in the line (e.g., "reply from <MAC> ...")
              if (!mac || mac === '00:00:00:00:00:00') {
                const firstMac = line.toUpperCase().match(/([0-9A-F]{2}(?::[0-9A-F]{2}){5})/);
                if (firstMac && firstMac[1]) mac = firstMac[1];
              }
              if (!macAllowed(mac)) {
                if (EV_STRICT || !macSet) return;
                // Permissive mode: remap P/L to the first requested MAC
                const first = macSet.values().next();
                if (first && !first.done) mac = first.value as string;
              }
              try { console.log('[events] EV', { kind, ch, val, mac, line }); } catch {}
              send({ type: 'ev', kind, ch, val, mac, raw: line, ts: Date.now() });
              return;
            }
            if ((m = line.match(/\bEV\s+DONE\s+(SUCCESS|FAILURE)\s+([0-9A-F:]{17})/i))) {
              const ok = /^SUCCESS$/i.test(m[1]);
              const mac = m[2].toUpperCase();
              if (macAllowed(mac)) {
                try {
                  const key = `EV_DONE:${ok ? '1' : '0'}:${mac}`;
                  if (__LAST_LOG.shouldLog(key)) console.log('[events] EV DONE', { ok, mac, line });
                } catch {}
                send({ type: 'ev', kind: 'DONE', ok, ch: null, val: null, mac, raw: line, ts: Date.now() });
              }
              return;
            }
            // Legacy RESULT — pick the LAST MAC token on the line (target), else null
            if (/\bRESULT\s+(SUCCESS|FAILURE)\b/i.test(line)) {
              const matches = Array.from(line.toUpperCase().matchAll(/([0-9A-F]{2}(?::[0-9A-F]{2}){5})/g));
              const mac = matches.length ? matches[matches.length - 1]![1] : null;
              const ok = /\bSUCCESS\b/i.test(line);
              if (macAllowed(mac || undefined)) {
                try {
                  const key = `RESULT:${ok ? '1' : '0'}:${mac || 'NONE'}`;
                  if (__LAST_LOG.shouldLog(key)) console.log('[events] EV DONE', { ok, mac, line });
                } catch {}
                send({ type: 'ev', kind: 'DONE', ok, ch: null, val: null, mac, raw: line, ts: Date.now() });
              }
              return;
            }
          } catch {}
        };
        s?.parser?.on?.('data', onLine);
        // ensure we remove listener on cleanup
        const oldCleanup = (controller as any).__cleanup;
        (controller as any).__cleanup = () => {
          try { s?.parser?.off?.('data', onLine); } catch {}
          if (typeof oldCleanup === 'function') oldCleanup();
        };
      } catch {}

      // Periodic rollups
      pollTimer = setInterval(async () => {
        try {
          const { present, ok, raw } = await espHealth();
          send({ type: 'esp', ok, raw, present });
        } catch (err: any) {
          send({ type: 'esp', ok: false, error: String(err?.message ?? err) });
        }

        try { send({ type: 'net', ...(await ethStatus()) }); } catch {}
        try { const r: any = getRedis(); const d = redisDetail(); send({ type: 'redis', ready: !!(r && (r.status === 'ready')), status: r?.status, detail: d }); } catch {}

        try {
          const devices = await listSerialDevices();
          send({ type: 'devices', devices });

          const discoveredNow = devices
            .map(d => d.path)
            .filter(Boolean)
            .filter(isLikelySerialPath) as string[];
          const nextAll = Array.from(new Set([...allPaths, ...discoveredNow]));
          if (nextAll.length !== allPaths.length) {
            allPaths = nextAll;
            send({ type: 'scanner/paths', paths: allPaths });
          }

          if (considerDevicesForScanner(devices, allPaths.join(','))) {
            ensureScanners(allPaths).catch(() => {});
          }
        } catch {}
      }, 5_000);

      // Keep a reference for cleanup
      (controller as any).__cleanup = cleanup;
    },

    cancel() {
      const cleanup = (this as any).__cleanup as undefined | (() => void);
      if (cleanup) cleanup();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Transfer-Encoding': 'chunked',
    },
  });
}
