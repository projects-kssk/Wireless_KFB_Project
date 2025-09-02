// src/app/api/aliases/route.ts
import { NextResponse } from 'next/server';
import { getRedis } from '@/lib/redis';
import { broadcast } from '@/lib/bus';
import { LOG } from '@/lib/logger';
const log = LOG.tag('aliases');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAC_RE = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i;

function keyFor(mac: string) { return `kfb:aliases:${mac.toUpperCase()}`; }
function keyForKsk(mac: string, ksk: string) { return `kfb:aliases:${mac.toUpperCase()}:${ksk}`; }
function indexKey(mac: string) { return `kfb:aliases:index:${mac.toUpperCase()}`; }

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const macRaw = String(url.searchParams.get('mac') || '').toUpperCase();
    if (!MAC_RE.test(macRaw)) return NextResponse.json({ error: 'invalid-mac' }, { status: 400 });
    const all = url.searchParams.get('all') === '1';
    const r: any = getRedis();
    log.info('GET aliases', { mac: macRaw, all });
    if (all) {
      // Graceful guard: if Redis is temporarily unavailable, don't throw 500 — return empty list
      try { if (typeof r.status === 'string' && r.status !== 'ready') await (r.connect?.().catch(()=>{})); } catch {}
      // Return all KSK-specific alias bundles we know for this MAC
      let members: string[] = await r.smembers(indexKey(macRaw)).catch(() => []);
      // Fallback/augment: scan keys if index is empty or incomplete
      try {
        const pattern = `${keyForKsk(macRaw, '*')}`;
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
      const rows = await Promise.all(
        members.map(async (ksk) => {
          try {
            const raw = await r.get(keyForKsk(macRaw, ksk));
            if (!raw) return null;
            const data = JSON.parse(raw);
            return {
              ksk,
              kssk: ksk,
              aliases: data?.names || data?.aliases || {},
              normalPins: Array.isArray(data?.normalPins) ? data.normalPins : [],
              latchPins: Array.isArray(data?.latchPins) ? data.latchPins : [],
              ts: data?.ts || null,
            };
          } catch { return null; }
        })
      );
      const items = rows.filter(Boolean);
      log.info('GET aliases items', { mac: macRaw, count: items.length });
      return NextResponse.json({ items });
    }
    // Guard non-ready redis for single get as well
    try { if (typeof r.status === 'string' && r.status !== 'ready') await (r.connect?.().catch(()=>{})); } catch {}
    const raw = await r.get(keyFor(macRaw)).catch(() => null as any);
    if (!raw) return NextResponse.json({ aliases: {}, normalPins: [], latchPins: [] });
    let data: any = {};
    try { data = JSON.parse(raw); } catch { data = {}; }
    const aliases = data?.names || data?.aliases || {};
    const normalPins = Array.isArray(data?.normalPins) ? data.normalPins : [];
    const latchPins = Array.isArray(data?.latchPins) ? data.latchPins : [];
    log.info('GET aliases single', { mac: macRaw, normal: normalPins.length, latch: latchPins.length });
    return NextResponse.json({ aliases, normalPins, latchPins, ts: data?.ts || null });
  } catch (e: any) {
    log.error('GET aliases error', { error: String(e?.message ?? e) });
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const mac = String(body?.mac || '').toUpperCase();
    if (!MAC_RE.test(mac)) return NextResponse.json({ error: 'invalid-mac' }, { status: 400 });
    let aliases: Record<string,string> = body?.aliases && typeof body.aliases === 'object' ? body.aliases : {};
    let normalPins = Array.isArray(body?.normalPins) ? body.normalPins as number[] : [];
    let latchPins = Array.isArray(body?.latchPins) ? body.latchPins as number[] : [];
    const ksk = ((body as any)?.ksk ? String((body as any).ksk) : ((body as any)?.kssk ? String((body as any).kssk) : '')).trim();
    const xml = typeof body?.xml === 'string' && body.xml.trim() ? String(body.xml) : null;
    const hints = body?.hints && typeof body.hints === 'object' ? body.hints : undefined;
    // Server-side guardrail: if XML is provided, re-derive pins from XML (default-only) to avoid client-side drift
    if (xml) {
      try {
        const parsePos = (pos: string) => {
          const parts = String(pos || '').split(',').map(s => s.trim());
          if (parts.length < 2) return { pin: NaN, isLatch: false };
          let isLatch = false;
          if (parts.at(-1)?.toUpperCase() === 'C') { isLatch = true; parts.pop(); }
          if (parts.length < 2) return { pin: NaN, isLatch };
          const last = parts.at(-1) || '';
          const pinNum = Number(String(last).replace(/\D+/g, ''));
          return { pin: Number.isFinite(pinNum) ? pinNum : NaN, isLatch };
        };
        const ex = (() => {
          const names: Record<string,string> = {};
          const normal: number[] = [];
          const latch: number[] = [];
          try {
            const re = /<sequence\b([^>]*)>([\s\S]*?)<\/sequence>/gi;
            let m: RegExpExecArray | null;
            while ((m = re.exec(xml))) {
              const attrs = m[1] || '';
              const bodyS = m[2] || '';
              // Strict: only measType="default" or <measType>default</measType>
              const mt = (attrs.match(/\bmeasType=\"([^\"]*)\"/i)?.[1] || bodyS.match(/<measType>([^<]*)<\/measType>/i)?.[1] || '').toLowerCase();
              if (mt !== 'default') continue;
              const pos = bodyS.match(/<objPos>([^<]+)<\/objPos>/i)?.[1] || '';
              if (!pos) continue;
              const { pin, isLatch } = parsePos(pos);
              if (!Number.isFinite(pin)) continue;
              (isLatch ? latch : normal).push(pin);
              const label = String(pos.split(',')[0] || '').trim();
              if (label) names[String(pin)] = label;
            }
          } catch {}
          const uniq = (xs: number[]) => Array.from(new Set(xs));
          return { names, normalPins: uniq(normal), latchPins: uniq(latch) };
        })();
        if (ex.normalPins.length || ex.latchPins.length) {
          normalPins = ex.normalPins;
          latchPins = ex.latchPins;
          // Also prefer names derived from XML when available
          if (ex.names && Object.keys(ex.names).length) aliases = ex.names;
        }
      } catch {}
    }
    const value = JSON.stringify({ names: aliases, normalPins, latchPins, ...(hints?{hints}:{}) , ts: Date.now() });
    const r = getRedis();
    try { await r.set(keyFor(mac), value); }
    catch (e: any) { log.error('POST aliases set mac failed', { mac, error: String(e?.message ?? e) }); }
    if (ksk) {
      try { await r.set(keyForKsk(mac, ksk), value); }
      catch (e: any) { log.error('POST aliases set ksk failed', { mac, ksk, error: String(e?.message ?? e) }); }
      try { await r.sadd(indexKey(mac), ksk); }
      catch (e: any) { log.error('POST aliases index sadd failed', { mac, ksk, error: String(e?.message ?? e) }); }
      if (xml) {
        try { await r.set(`kfb:aliases:xml:${mac}:${ksk}`, xml); }
        catch (e: any) { log.error('POST aliases xml set failed', { mac, ksk, error: String(e?.message ?? e) }); }
      }
      // Also persist a lightweight last-pins snapshot for tooling/watchers
      try {
        const ts = Date.now();
        await r.set(`kfb:lastpins:${mac}:${ksk}`, JSON.stringify({ normalPins, latchPins, ts }));
      } catch (e: any) {
        log.error('POST aliases lastpins set failed', { mac, ksk, error: String(e?.message ?? e) });
      }
    }
    log.info('POST aliases saved', { mac, ksk: ksk || null, normalPins: normalPins.length, latchPins: latchPins.length });
    // Rebuild union for MAC key from all KSK entries so UI has complete map
    try {
      // Rehydrate index by scanning keys and SADD any missing KSKs
      const curMembers: string[] = await r.smembers(indexKey(mac)).catch(() => []);
      let foundIds: string[] = [];
      try {
        const pattern = `${keyForKsk(mac, '*')}`;
        if (typeof (r as any).scan === 'function') {
          let cursor = '0';
          const keys: string[] = [];
          do {
            const res = await (r as any).scan(cursor, 'MATCH', pattern, 'COUNT', 300);
            cursor = res[0];
            const chunk: string[] = res[1] || [];
            keys.push(...chunk);
          } while (cursor !== '0');
          foundIds = keys.map(k => String(k).split(':').pop()!).filter(Boolean);
        } else {
          const keys: string[] = await (r as any).keys(pattern).catch(() => []);
          foundIds = keys.map(k => String(k).split(':').pop()!).filter(Boolean);
        }
      } catch {}
      // Union sets and ensure index contains all discovered ids
      const setAll = new Set([...(curMembers||[]), ...foundIds]);
      const allMembers = Array.from(setAll);
      const toAdd = allMembers.filter(id => !(curMembers||[]).includes(id));
      if (toAdd.length) {
        try { await r.sadd(indexKey(mac), ...toAdd); log.info('POST aliases rehydrate index', { mac, added: toAdd.length }); } catch {}
      }

      const members: string[] = allMembers;
      const merged: Record<string,string> = {};
      let allN: number[] = [];
      let allL: number[] = [];
      let unionHints: Record<string,string> = {};
      for (const id of members) {
        try {
          const raw = await r.get(keyForKsk(mac, id));
          if (!raw) continue;
          const d = JSON.parse(raw);
          const names = d?.names || d?.aliases || {};
          for (const [pin, name] of Object.entries(names)) {
            if (!merged[pin]) merged[pin] = name as string;
            else if (merged[pin] !== name) merged[pin] = `${merged[pin]} / ${name}`;
          }
          if (d?.hints && typeof d.hints === 'object') {
            for (const [pin, name] of Object.entries(d.hints as Record<string,string>)) {
              if (!unionHints[pin]) unionHints[pin] = name as string;
            }
          }
          if (Array.isArray(d?.normalPins)) allN = Array.from(new Set([...allN, ...d.normalPins]));
          if (Array.isArray(d?.latchPins)) allL = Array.from(new Set([...allL, ...d.latchPins]));
        } catch {}
      }
      const unionVal = JSON.stringify({ names: merged, normalPins: allN, latchPins: allL, ...(Object.keys(unionHints).length?{hints: unionHints}:{}) , ts: Date.now() });
      try { await r.set(keyFor(mac), unionVal); }
      catch (e: any) { log.error('POST aliases union set failed', { mac, error: String(e?.message ?? e) }); }
      log.info('POST aliases union rebuilt', { mac, kskCount: members.length, unionNormal: allN.length, unionLatch: allL.length });
      try { broadcast({ type: 'aliases/union', mac, names: merged, normalPins: allN, latchPins: allL }); } catch {}
    } catch {}
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    log.error('POST aliases error', { error: String(e?.message ?? e) });
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
