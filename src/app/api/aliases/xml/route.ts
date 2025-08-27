// src/app/api/aliases/xml/route.ts
import { NextResponse } from 'next/server';
import { getRedis } from '@/lib/redis';
import { LOG } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = LOG.tag('aliases');
const MAC_RE = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i;

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const mac = String(url.searchParams.get('mac') || '').toUpperCase();
    const kssk = String(url.searchParams.get('kssk') || '').trim();
    const listAll = url.searchParams.get('all') === '1';
    if (!MAC_RE.test(mac)) return NextResponse.json({ error: 'invalid-mac' }, { status: 400 });

    const r = getRedis();

    if (listAll) {
      const members: string[] = await r.smembers(`kfb:aliases:index:${mac}`).catch(() => []);
      const rows = await Promise.all(members.map(async (id) => {
        try {
          const xml = await r.get(`kfb:aliases:xml:${mac}:${id}`);
          return { kssk: id, xml: xml || null };
        } catch { return { kssk: id, xml: null }; }
      }));
      log.info('GET aliases xml all', { mac, count: rows.length });
      return NextResponse.json({ items: rows });
    }

    if (!kssk) return NextResponse.json({ error: 'kssk is required' }, { status: 400 });
    const xml = await r.get(`kfb:aliases:xml:${mac}:${kssk}`);
    log.info('GET aliases xml one', { mac, kssk, ok: !!xml });
    if (!xml) return NextResponse.json({ error: 'not-found' }, { status: 404 });
    return new NextResponse(xml, { status: 200, headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
  } catch (e: any) {
    log.error('GET aliases xml error', { error: String(e?.message ?? e) });
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}

