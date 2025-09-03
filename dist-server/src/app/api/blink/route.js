// app/api/blink/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const Body = z.object({ mac: z.string().min(1), count: z.number().int().min(1).max(20).optional() });
export async function POST(req) {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success)
        return NextResponse.json({ error: 'Expected { mac, count? }' }, { status: 400 });
    const { mac, count = 3 } = parsed.data;
    let sendToEsp;
    let waitForLine;
    try {
        const mod = await import('@/lib/serial');
        const helper = mod.default ?? mod;
        sendToEsp = helper.sendToEsp;
        waitForLine = helper.waitForLine;
    }
    catch {
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
    try {
        const waiter = waitForLine((s) => /\bBLINK-OK\b/i.test(s), req.signal, 5000);
        await sendToEsp(`BLINK ${count} ${mac}`);
        await waiter;
        return NextResponse.json({ ok: true });
    }
    catch (e) {
        const msg = String(e?.message ?? e);
        const status = msg === 'client-abort' ? 499 : msg === 'timeout' ? 504 : 500;
        return new NextResponse(JSON.stringify({ error: msg }), {
            status, headers: { 'Content-Type': 'application/json' },
        });
    }
}
//# sourceMappingURL=route.js.map