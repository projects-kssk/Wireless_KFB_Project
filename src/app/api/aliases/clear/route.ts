// src/app/api/aliases/clear/route.ts
import { NextResponse } from 'next/server';
import { getRedis } from '@/lib/redis';
import { LOG } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = LOG.tag('aliases:clear');
const MAC_RE = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i;

function keyFor(mac: string) { return `kfb:aliases:${mac.toUpperCase()}`; }
function keyForKssk(mac: string, kssk: string) { return `kfb:aliases:${mac.toUpperCase()}:${kssk}`; }
function indexKey(mac: string) { return `kfb:aliases:index:${mac.toUpperCase()}`; }

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const mac = String((body as any)?.mac || '').toUpperCase();
    if (!MAC_RE.test(mac)) return NextResponse.json({ error: 'invalid-mac' }, { status: 400 });
    const r = getRedis();
    // Get all KSSK IDs from index and from scanning keys
    let members: string[] = await r.smembers(indexKey(mac)).catch(() => []);
    try {
      const pattern = `${keyForKssk(mac, '*')}`;
      if (typeof (r as any).scan === 'function') {
        let cursor = '0';
        const keys: string[] = [];
        do {
          const res = await (r as any).scan(cursor, 'MATCH', pattern, 'COUNT', 300);
          cursor = res[0];
          const chunk: string[] = res[1] || [];
          keys.push(...chunk);
        } while (cursor !== '0');
        const ids = keys.map(k => String(k).split(':').pop()!).filter(Boolean);
        const set = new Set([...(members||[]), ...ids]);
        members = Array.from(set);
      } else {
        const keys: string[] = await (r as any).keys(pattern).catch(() => []);
        const ids = keys.map(k => String(k).split(':').pop()!).filter(Boolean);
        const set = new Set([...(members||[]), ...ids]);
        members = Array.from(set);
      }
    } catch {}
    // Delete union and each KSSK entry; clear the index
    const delKeys: string[] = [keyFor(mac), ...members.map(id => keyForKssk(mac, id))];
    let deleted = 0;
    try { if (delKeys.length) deleted = await (r as any).del(...delKeys).catch(() => 0); } catch {}
    try { await r.del(indexKey(mac)).catch(() => {}); } catch {}
    log.info('cleared aliases', { mac, members: members.length, deleted });
    return NextResponse.json({ ok: true, mac, members, deleted });
  } catch (e: any) {
    log.error('clear error', { error: String(e?.message ?? e) });
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}

