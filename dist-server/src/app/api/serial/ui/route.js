// app/api/serial/ui/route.ts
import { NextResponse } from 'next/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const last = {};
let wired = false;
function attach(getEspLineStream) {
    if (wired)
        return;
    const { parser } = getEspLineStream();
    parser.on('data', (buf) => {
        try {
            const s = String(buf).trim();
            if (!s)
                return;
            let m;
            // Station format: "UI REMOVE_CABLE AA:BB:CC:DD:EE:FF"
            m = s.match(/^\s*UI\s+([A-Z_]+)\s+([0-9A-F:]{17})\s*$/i);
            if (m) {
                const cue = `UI:${m[1].toUpperCase()}`;
                const mac = m[2].toUpperCase();
                last[mac] = { ...(last[mac] || { ts: 0 }), cue, ts: Date.now() };
                return;
            }
            // Station (alternative): "UI:REMOVE_CABLE AA:BB:CC:DD:EE:FF"
            m = s.match(/^\s*UI:([A-Z_]+)\s+([0-9A-F:]{17})\s*$/i);
            if (m) {
                const cue = `UI:${m[1].toUpperCase()}`;
                const mac = m[2].toUpperCase();
                last[mac] = { ...(last[mac] || { ts: 0 }), cue, ts: Date.now() };
                return;
            }
            // Hub echo format: "← reply from <MAC>: UI:REMOVE_CABLE"
            m = s.match(/reply\s+from\s+([0-9A-F:]{17})\s*:\s*(UI:[A-Z_]+)/i);
            if (m) {
                const mac = m[1].toUpperCase();
                const cue = m[2].toUpperCase();
                last[mac] = { ...(last[mac] || { ts: 0 }), cue, ts: Date.now() };
                return;
            }
            // Result format: "RESULT SUCCESS ... <MAC>" or "RESULT FAILURE ... <MAC>"
            m = s.match(/^\s*RESULT\s+(.+?)\s+([0-9A-F:]{17})\s*$/i);
            if (m) {
                const payload = m[1].toUpperCase();
                const mac = m[2].toUpperCase();
                last[mac] = { ...(last[mac] || { ts: 0 }), result: payload, ts: Date.now() };
                return;
            }
        }
        catch {
            /* ignore parse errors */
        }
    });
    wired = true;
}
export async function GET(request) {
    try {
        const url = new URL(request.url);
        const mac = (url.searchParams.get('mac') || '').toUpperCase();
        if (!mac)
            return NextResponse.json({ error: 'mac is required' }, { status: 400 });
        const mod = await import('@/lib/serial');
        const helper = mod.default ?? mod;
        const { getEspLineStream } = helper;
        if (typeof getEspLineStream !== 'function') {
            return NextResponse.json({ error: 'serial-helpers-missing' }, { status: 500 });
        }
        attach(getEspLineStream);
        const entry = last[mac] || { ts: 0 };
        const cue = entry.cue ?? null;
        const result = entry.result ?? null;
        // one-shot consumption
        if (cue)
            delete entry.cue;
        if (result)
            delete entry.result;
        last[mac] = entry;
        return NextResponse.json({ cue, result });
    }
    catch (e) {
        return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
    }
}
