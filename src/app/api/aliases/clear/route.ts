// src/app/api/aliases/clear/route.ts
import { NextResponse } from 'next/server';
import { getRedis } from '@/lib/redis';
import { LOG } from '@/lib/logger';
import crypto from 'node:crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = LOG.tag('aliases:clear');

const MAC_RE = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i;
const REQUIRE_REDIS = ((process.env.KSK_REQUIRE_REDIS ?? process.env.KSSK_REQUIRE_REDIS) ?? '0') === '1';

function rid(): string {
  const id = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
  return id.replace(/-/g, '').slice(0, 8);
}

async function connectIfNeeded(r: any, timeoutMs = 400): Promise<boolean> {
  if (!r) return false;
  const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));
  try {
    // node-redis v4
    if (typeof r.isOpen === 'boolean') {
      if (!r.isOpen) {
        try {
          const p = r.connect();
          await Promise.race([p, sleep(timeoutMs)]);
        } catch {}
      }
      return r.isOpen === true;
    }
    // ioredis
    if (typeof r.status === 'string') {
      if (r.status === 'ready') return true;
      if (['connecting', 'connect', 'reconnecting'].includes(r.status)) {
        await Promise.race([
          new Promise<void>((resolve) => {
            const done = () => {
              r.off?.('ready', done);
              r.off?.('error', done);
              r.off?.('end', done);
              resolve();
            };
            r.once?.('ready', done);
            r.once?.('error', done);
            r.once?.('end', done);
          }),
          sleep(timeoutMs),
        ]);
        return r.status === 'ready';
      }
      try { await r.connect?.().catch(() => {}); } catch {}
      await Promise.race([
        new Promise<void>((resolve) => {
          const done = () => { r.off?.('ready', done); r.off?.('error', done); resolve(); };
          r.once?.('ready', done);
          r.once?.('error', done);
        }),
        sleep(timeoutMs),
      ]);
      return r.status === 'ready';
    }
  } catch {}
  return false;
}

function keyFor(mac: string) { return `kfb:aliases:${mac.toUpperCase()}`; }
function keyForKssk(mac: string, kssk: string) { return `kfb:aliases:${mac.toUpperCase()}:${kssk}`; }
function indexKey(mac: string) { return `kfb:aliases:index:${mac.toUpperCase()}`; }

export async function POST(req: Request) {
  const id = rid();
  try {
    const body = await req.json().catch(() => ({} as any));
    const mac = String((body as any)?.mac || '').toUpperCase();
    if (!MAC_RE.test(mac)) {
      const resp = NextResponse.json({ error: 'invalid-mac' }, { status: 400 });
      resp.headers.set('X-Req-Id', id);
      return resp;
    }

    const r: any = getRedis();
    const haveRedis = r && await connectIfNeeded(r);

    if (REQUIRE_REDIS && !haveRedis) {
      const resp = NextResponse.json({ error: 'redis_unavailable' }, { status: 503 });
      resp.headers.set('X-Req-Id', id);
      resp.headers.set('X-KSK-Mode', 'redis');
      return resp;
    }

    if (!haveRedis) {
      log.info('clear noop (redis_unavailable)', { mac, rid: id });
      const resp = NextResponse.json({ ok: true, mac, members: 0, deleted: 0, mode: 'noop' });
      resp.headers.set('X-Req-Id', id);
      resp.headers.set('X-KSK-Mode', 'noop');
      return resp;
    }

    // Get all KSK IDs from index and from scanning keys
    let members: string[] = await r.smembers(indexKey(mac)).catch(() => []);
    try {
      const pattern = `${keyForKssk(mac, '*')}`;
      if (typeof r.scan === 'function') {
        let cursor = '0';
        const keys: string[] = [];
        do {
          const res = await r.scan(cursor, 'MATCH', pattern, 'COUNT', 300);
          cursor = res[0];
          const chunk: string[] = res[1] || [];
          keys.push(...chunk);
        } while (cursor !== '0');
        const ids = keys.map((k: string) => String(k).split(':').pop()!).filter(Boolean);
        const set = new Set([...(members || []), ...ids]);
        members = Array.from(set);
      } else {
        const keys: string[] = await r.keys(pattern).catch(() => []);
        const ids = keys.map((k: string) => String(k).split(':').pop()!).filter(Boolean);
        const set = new Set([...(members || []), ...ids]);
        members = Array.from(set);
      }
    } catch {}

    // Delete union and each KSK entry; clear the index
    const delKeys: string[] = [keyFor(mac), ...members.map(id => keyForKssk(mac, id))];
    let deleted = 0;
    try { if (delKeys.length) deleted = await r.del(...delKeys).catch(() => 0); } catch {}
    try { await r.del(indexKey(mac)).catch(() => {}); } catch {}

    log.info('cleared aliases', { mac, members: members.length, deleted, rid: id });
    const resp = NextResponse.json({ ok: true, mac, members, deleted });
    resp.headers.set('X-Req-Id', id);
    resp.headers.set('X-KSK-Mode', 'redis');
    return resp;
  } catch (e: any) {
    log.error('clear error', { error: String(e?.message ?? e), rid: id });
    const resp = NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
    resp.headers.set('X-Req-Id', id);
    return resp;
  }
}
