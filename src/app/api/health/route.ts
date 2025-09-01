import { NextResponse } from 'next/server';
import net from 'node:net';
import { getRedis } from '@/lib/redis';
import { isEspPresent } from '@/lib/serial';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function probeRedis() {
  const r: any = getRedis();
  const start = Date.now();
  let ready = false; let latencyMs: number | null = null;
  try {
    if (r) {
      if (typeof r.status === 'string') {
        // ioredis style
        ready = r.status === 'ready';
        if (r.ping) { await r.ping(); }
        latencyMs = Date.now() - start;
      } else if (typeof r.isOpen === 'boolean') {
        // node-redis v4 style
        if (!r.isOpen) { try { await r.connect?.(); } catch {} }
        ready = !!r.isOpen;
        try { await r.ping?.(); } catch {}
        latencyMs = Date.now() - start;
      }
    }
  } catch {}
  return { ready, latencyMs };
}

function parseHostPort(raw?: string | null, defPort = 10080) {
  if (!raw) return { host: null as string | null, port: null as number | null };
  const m = raw.match(/^\[?([^\]]+)\]:(\d+)$/);
  if (m) return { host: m[1], port: Number(m[2]) };
  return { host: raw, port: defPort };
}

async function probeTcp(host: string, port: number, timeoutMs = 1500): Promise<{ ok: boolean; used: string; error?: string } > {
  return new Promise((resolve) => {
    const used = `tcp://${host}:${port}`;
    const s = new net.Socket();
    let done = false;
    const finish = (ok: boolean, error?: string) => { if (done) return; done = true; try { s.destroy(); } catch {} resolve({ ok, used, error }); };
    s.setNoDelay(true);
    s.setTimeout(timeoutMs);
    s.once('connect', () => finish(true));
    s.once('timeout', () => finish(false, 'timeout'));
    s.once('error', (e) => finish(false, (e as any)?.message || 'tcp error'));
    try { s.connect(port, host); } catch (e: any) { finish(false, e?.message || 'connect error'); }
  });
}

export async function GET() {
  const ts = new Date().toISOString();
  // Redis
  const redis = await probeRedis();

  // Krosy TCP (only when online mode is enabled)
  const online = String(process.env.NEXT_PUBLIC_KROSY_ONLINE || '').trim().toLowerCase() === 'true';
  let krosy: { onlineConfigured: boolean; ok: boolean | null; used?: string; error?: string } = { onlineConfigured: online, ok: null };
  if (online) {
    const raw = (process.env.KROSY_CONNECT_HOST || '172.26.192.1:10080').trim();
    const { host, port } = parseHostPort(raw, Number(process.env.KROSY_TCP_PORT || 10080));
    if (host && port) {
      try { const res = await probeTcp(host, port, Number(process.env.KROSY_TCP_TIMEOUT_MS || 1500)); krosy = { onlineConfigured: online, ok: res.ok, used: res.used, error: res.error }; }
      catch { krosy = { onlineConfigured: online, ok: false, used: `tcp://${host}:${port}`, error: 'probe failed' }; }
    } else {
      krosy = { onlineConfigured: online, ok: false, error: 'invalid KROSY_CONNECT_HOST' };
    }
  }

  // Serial presence (ESP)
  let serial = { present: false };
  try { serial.present = await isEspPresent(); } catch {}

  // SSE availability: endpoint exists; active connections not tracked server-side
  const sse = { available: true };

  // Station locks count
  const stationId = (process.env.STATION_ID || process.env.NEXT_PUBLIC_STATION_ID || '').trim();
  let stationLocks: { stationId: string | null; active: number | null } = { stationId: stationId || null, active: null };
  if (redis.ready && stationId) {
    try {
      const r: any = getRedis();
      const key = `ksk:station:${stationId}`;
      const members: string[] = await r.smembers?.(key)?.catch?.(() => []) ?? [];
      stationLocks.active = Array.isArray(members) ? members.length : 0;
    } catch { stationLocks.active = null; }
  }

  const body = { ts, redis, krosy, serial, sse, stationLocks };
  return NextResponse.json(body, { status: 200, headers: { 'Cache-Control': 'no-store' } });
}
