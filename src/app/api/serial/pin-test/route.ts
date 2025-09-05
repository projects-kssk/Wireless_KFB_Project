// src/app/api/serial/pin-test/route.ts
import { NextResponse } from 'next/server';
import serial from '@/lib/serial';
import { LOG } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = LOG.tag('api:serial/pin-test');

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as any;
    const macRaw = typeof body?.mac === 'string' ? body.mac : '';
    const mac = macRaw ? String(macRaw).trim().toUpperCase() : '';
    if (!mac) {
      return NextResponse.json({ error: 'mac_required' }, { status: 400 });
    }
    const maxPin = Math.max(1, Math.min(200, Number(body?.max ?? 40)));
    const fromPin = Math.max(1, Number(body?.from ?? 1));
    const toPin = Math.max(fromPin, Number(body?.to ?? maxPin));
    const pins: number[] = [];
    for (let i = fromPin; i <= toPin; i++) pins.push(i);

    const { sendToEsp } = serial as any;
    if (typeof sendToEsp !== 'function') throw new Error('serial-helpers-missing');

    const cmd = pins.length ? `MONITOR ${pins.join(',')} ${mac}` : `MONITOR ${mac}`;

    try { log.info('PIN-TEST send', { mac, pinCount: pins.length, from: fromPin, to: toPin, cmd }); } catch {}
    // Fire-and-forget: do not await handshake or results
    await sendToEsp(cmd);

    return NextResponse.json({ ok: true, sent: { mac: mac || null, pins, cmd } }, { status: 202 });
  } catch (e: any) {
    const msg = e?.message || String(e);
    try { log.error('PIN-TEST error', { error: msg }); } catch {}
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
