// app/api/test/route.ts
import { NextResponse } from 'next/server';
import { getEspLineStream, isEspPresent } from '@/lib/serial';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const normMac = (s) => (s || '')
    .toUpperCase()
    .replace(/[^0-9A-F]/g, '')
    .match(/.{1,2}/g)
    ?.slice(0, 6)
    .join(':') ?? s;
export async function POST(req) {
    try {
        const { mac, kfb } = (await req.json());
        if (!mac || typeof mac !== 'string')
            return NextResponse.json({ error: 'Missing or invalid "mac".' }, { status: 400 });
        const present = await isEspPresent().catch(() => false);
        if (!present)
            return NextResponse.json({ error: 'serial-not-present' }, { status: 428 });
        const { port, parser } = getEspLineStream();
        if (!port?.write)
            return NextResponse.json({ error: 'serial-not-open' }, { status: 503 });
        // ── THE TEST COMMAND (no WELCOME) ────────────────────────────────────────
        // If your hub expects KFB too, it will be appended; otherwise mac-only.
        const cmd = kfb ? `TEST ${mac} ${kfb}\n` : `TEST ${mac}\n`;
        // Write to the station serial
        await new Promise((resolve, reject) => {
            port.write(cmd, (err) => (err ? reject(err) : resolve()));
        });
        // Optionally listen briefly for READY/OK to give immediate feedback
        const ready = await new Promise((resolve) => {
            let done = false;
            const cleanup = (fn) => {
                try {
                    parser?.off?.('data', fn);
                }
                catch { }
            };
            const onData = (b) => {
                const line = String(b).trim().toUpperCase();
                if (/^(READY|OK)\b/.test(line)) {
                    if (!done) {
                        done = true;
                        cleanup(onData);
                        clearTimeout(t);
                        resolve(true);
                    }
                }
            };
            const t = setTimeout(() => {
                if (!done) {
                    done = true;
                    cleanup(onData);
                    resolve(false);
                }
            }, 2500);
            parser?.on?.('data', onData);
        });
        return NextResponse.json({
            ok: true,
            mac: normMac(mac),
            ready,
            message: ready
                ? 'READY received. Test OK.'
                : `Test command sent for ${normMac(mac)}${kfb ? ` (KFB ${kfb})` : ''}.`,
        });
    }
    catch (e) {
        return NextResponse.json({ error: e?.message || 'Unexpected error.' }, { status: 500 });
    }
}
//# sourceMappingURL=route.js.map