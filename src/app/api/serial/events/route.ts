// src/app/api/serial/events/route.ts
import os from 'os';
import { promises as fs } from 'fs';
import { onSerialEvent } from '@/lib/bus';
import { getLastScanAndClear } from '@/lib/scannerMemory';
import {
  listSerialDevices,
  ensureScanners,
  considerDevicesForScanner,
  espHealth,
} from '@/lib/serial';
import { getRedis, redisDetail } from '@/lib/redis';
import serial from '@/lib/serial';
import '@/lib/scanSink';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;                 // ← remove `as const`
export const fetchCache = 'force-no-store';  // segment-level opt-out is valid

      const encoder = new TextEncoder();

// dedupe RESULT/EV logs
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

const isLikelySerialPath = (p: string) =>
  /\/dev\/(tty(ACM|USB)\d+|tty\.usb|cu\.usb)/i.test(p);

const ZERO_MAC = '00:00:00:00:00:00';

function netIfaceName() {
  return (process.env.NET_IFACE || 'eth0').trim();
}

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
  // parse MAC filter up front
  const urlObj = new URL(req.url);
  const macParam = (urlObj.searchParams.get('mac') || '').trim();
  const macFilter = macParam.toUpperCase();
  const macSet: Set<string> | null = macFilter
    ? new Set(macFilter.split(',').map(s => s.trim()).filter(Boolean))
    : null;
  const macAllowed = (m?: string | null) => {
    if (!macSet) return true;
    const up = String(m || '').toUpperCase();
    return up && macSet.has(up);
  };
  const EV_STRICT = (process.env.EV_STRICT ?? '0') === '1';

  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let scanTimer: ReturnType<typeof setInterval> | null = null;
  let unsubscribe: (() => void) | null = null;

  // single cleanup path
  const cleanup = () => {
    if (closed) return;
    closed = true;
    try { heartbeat?.unref?.(); } catch {}
    try { pollTimer?.unref?.(); } catch {}
    if (heartbeat) clearInterval(heartbeat);
    if (pollTimer) clearInterval(pollTimer);
    if (scanTimer) clearInterval(scanTimer);
    try { unsubscribe?.(); } catch {}
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // close helper
      const push = (s: string) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(s)); } catch { cleanup(); try { controller.close(); } catch {} }
      };
      const send = (obj: unknown) => push(`data: ${JSON.stringify(obj)}\n\n`);
      const comment = (txt: string) => push(`: ${txt}\n\n`);

      try { (req as any).signal?.addEventListener('abort', () => { cleanup(); try { controller.close(); } catch {} }); } catch {}

      // SSE preamble
      push('retry: 2000\n\n');
      comment('open');

      // heartbeats
      heartbeat = setInterval(() => comment('ping'), 15_000);
      heartbeat.unref?.();

      // bus → SSE
      unsubscribe = onSerialEvent(e => send(e));

      // initial payloads
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

      // ESP snapshot
      try {
        const { present, ok, raw } = await espHealth();
        send({ type: 'esp', ok, raw, present });
      } catch (err: any) {
        send({ type: 'esp', ok: false, error: String(err?.message ?? err) });
      }

      // ESP line stream wiring
      try {
        const s: any = (serial as any).getEspLineStream?.();
        const onLine = (buf: Buffer | string) => {
          try {
            const line = String(buf).trim();
            if (!line) return;

            let m: RegExpMatchArray | null = null;

            if ((m = line.match(/\bEV\s+([PL])\s+(\d{1,3})\s+([01])\s+([0-9A-F:]{17})/i))) {
              const kind = m[1].toUpperCase();
              const ch = Number(m[2]);
              const val = Number(m[3]);
              let mac = m[4].toUpperCase();
              if (!mac || mac === '00:00:00:00:00:00') {
                const firstMac = line.toUpperCase().match(/([0-9A-F]{2}(?::[0-9A-F]{2}){5})/);
                if (firstMac && firstMac[1]) mac = firstMac[1];
              }
              if (!macAllowed(mac)) {
                if (EV_STRICT || !macSet) return;
                const first = macSet.values().next();
                if (!first.done) mac = first.value as string;
              }
              try { console.log('[events] EV', { kind, ch, val, mac, line }); } catch {}
              send({ type: 'ev', kind, ch, val, mac, raw: line, ts: Date.now() });
              return;
            }

            // Monitor session start signal from hub
            if (/\bMONITOR-START\b/i.test(line)) {
              let mac: string | null = null;
              const matches = Array.from(line.toUpperCase().matchAll(/([0-9A-F]{2}(?::[0-9A-F]{2}){5})/g));
              mac = matches.length ? matches[matches.length - 1]![1] : null;
              if (!macAllowed(mac || undefined)) {
                if (macSet && !EV_STRICT) {
                  const first = macSet.values().next();
                  if (!first.done) mac = first.value as string;
                } else {
                  return;
                }
              }
              try { console.log('[events] EV START', { mac, line }); } catch {}
              send({ type: 'ev', kind: 'START', ch: null, val: null, mac, raw: line, ts: Date.now() });
              return;
            }

            if ((m = line.match(/\bEV\s+DONE\s+(SUCCESS|FAILURE)\s+([0-9A-F:]{17})/i))) {
              const ok = /^SUCCESS$/i.test(m[1]);
              let mac = m[2].toUpperCase();
              // Align behavior with RESULT: remap to requested MAC when EV_STRICT is off
              if (!macAllowed(mac || undefined)) {
                if (macSet && !EV_STRICT) {
                  const first = macSet.values().next();
                  if (!first.done) mac = first.value as string;
                } else {
                  return; // drop when strict or no filter is set
                }
              }
              if (!mac || mac === ZERO_MAC) {
                const matches = Array.from(line.toUpperCase().matchAll(/([0-9A-F]{2}(?::[0-9A-F]{2}){5})/g));
                mac = matches.find((match) => match[1] !== ZERO_MAC)?.[1] ?? matches[0]?.[1] ?? mac;
              }
              if (macAllowed(mac)) {
                try {
                  const key = `EV_DONE:${ok ? '1' : '0'}:${mac}`;
                  if (__LAST_LOG.shouldLog(key)) console.log('[events] EV DONE', { ok, mac, line });
                } catch {}
                send({ type: 'ev', kind: 'DONE', ok, ch: null, val: null, mac, raw: line, ts: Date.now() });
              }
              return;
            }

            if (/\bRESULT\s+(SUCCESS|FAILURE)\b/i.test(line)) {
              const matches = Array.from(line.toUpperCase().matchAll(/([0-9A-F]{2}(?::[0-9A-F]{2}){5})/g));
              let mac = matches.find((match) => match[1] !== ZERO_MAC)?.[1] ?? matches[0]?.[1] ?? null;
              const ok = /\bSUCCESS\b/i.test(line);
              // If a MAC filter is provided and the line's MAC doesn't match (e.g., hub MAC),
              // remap to the requested MAC unless EV_STRICT is enabled.
              if (!macAllowed(mac || undefined)) {
                if (macSet && !EV_STRICT) {
                  const first = macSet.values().next();
                  if (!first.done) mac = first.value as string;
                } else {
                  return; // drop when strict or no filter is set
                }
              }
              try {
                const key = `RESULT:${ok ? '1' : '0'}:${mac || 'NONE'}`;
                if (__LAST_LOG.shouldLog(key)) console.log('[events] EV DONE', { ok, mac, line });
              } catch {}
              send({ type: 'ev', kind: 'DONE', ok, ch: null, val: null, mac, raw: line, ts: Date.now() });
              return;
            }
          } catch {}
        };

        s?.parser?.on?.('data', onLine);

        // ensure listener removal on close
        req.signal?.addEventListener('abort', () => {
          try { s?.parser?.off?.('data', onLine); } catch {}
        });
      } catch {}

      // periodic rollups
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

          const nextAll = Array.from(new Set([...(envScannerPaths()), ...discoveredNow]));
          // update once to prevent drift
          if (nextAll.length !== allPaths.length) {
            allPaths = nextAll;
            send({ type: 'scanner/paths', paths: allPaths });
          }

          if (considerDevicesForScanner(devices, allPaths.join(','))) {
            ensureScanners(allPaths).catch(() => {});
          }
        } catch {}
      }, 5_000);
      pollTimer.unref?.();

      // fast lane: forward scans from scanner memory to SSE clients
      scanTimer = setInterval(() => {
        try {
          const s = getLastScanAndClear();
          if (s && s.code) {
            send({ type: 'scan', code: s.code, path: s.path ?? undefined });
          }
        } catch {}
      }, 350);
      scanTimer.unref?.();
    },

    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Transfer-Encoding': 'chunked',
    },
  });
}
