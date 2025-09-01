// src/app/api/aliases/rehydrate/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getRedis } from '@/lib/redis';
import { LOG } from '@/lib/logger';
import { broadcast } from '@/lib/bus';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = LOG.tag('aliases');

const MAC_RE = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const mac = String(body?.mac || '').toUpperCase();
    if (!MAC_RE.test(mac)) return NextResponse.json({ error: 'invalid-mac' }, { status: 400 });
    const r: any = getRedis();

    // Scan per-KSSK entries (tolerate Redis errors → behave like empty)
    const pattern = `kfb:aliases:${mac}:*`;
    let cursor = '0';
    const keys: string[] = [];
    try {
      if (typeof r.scan === 'function') {
        do {
          const res = await r.scan(cursor, 'MATCH', pattern, 'COUNT', 300);
          cursor = res[0];
          keys.push(...(res[1] || []));
        } while (cursor !== '0');
      } else {
        const raw = await r.keys(pattern).catch(() => []);
        keys.push(...raw);
      }
    } catch (e) {
      log.error('rehydrate: scan failed', { error: String((e as any)?.message ?? e) });
    }
    const unionNames: Record<string, string> = {};
    const nSet = new Set<number>();
    const lSet = new Set<number>();
    const ids: string[] = [];
    await Promise.all(keys.map(async (k) => {
      try {
        const id = String(k).split(':').pop()!;
        if (id) ids.push(id);
        const raw = await r.get(k);
        if (!raw) return;
        const d = JSON.parse(raw);
        const names = d?.names || d?.aliases || {};
        for (const [pin, nm] of Object.entries(names)) if (!unionNames[pin]) unionNames[pin] = String(nm);
        if (Array.isArray(d?.normalPins)) for (const p of d.normalPins) { const x=Number(p); if (Number.isFinite(x)&&x>0) nSet.add(x); }
        if (Array.isArray(d?.latchPins)) for (const p of d.latchPins) { const x=Number(p); if (Number.isFinite(x)&&x>0) lSet.add(x); }
      } catch {}
    }));

    // Rebuild union payload
    const keyUnion = `kfb:aliases:${mac}`;
    const prevRaw = await r.get(keyUnion).catch(() => null);
    let prev: any = null; try { prev = prevRaw ? JSON.parse(prevRaw) : null; } catch {}
    const hints = (prev?.hints && typeof prev.hints === 'object') ? prev.hints : undefined;
    const out = {
      names: Object.keys(unionNames).length ? unionNames : (prev?.names || {}),
      normalPins: Array.from(nSet).sort((a,b)=>a-b),
      latchPins: Array.from(lSet).sort((a,b)=>a-b),
      ...(hints ? { hints } : {}),
      ts: Date.now(),
    };
    await r.set(keyUnion, JSON.stringify(out)).catch(()=>{});
    if (ids.length) await r.sadd(`kfb:aliases:index:${mac}`, ...ids).catch(()=>{});
    log.info('POST aliases rehydrate', { mac, items: ids.length, normal: out.normalPins.length, latch: out.latchPins.length });

    // Notify SSE subscribers
    try { broadcast({ type: 'aliases/union', mac, names: out.names, normalPins: out.normalPins, latchPins: out.latchPins }); } catch {}

    return NextResponse.json({ ok: true, mac, items: ids.length, union: { normalPins: out.normalPins, latchPins: out.latchPins } });
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    log.error('POST aliases rehydrate error', { error: msg });
    const status = /ECONNREFUSED|ETIMEDOUT|redis/i.test(msg) ? 503 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
