import { NextResponse } from 'next/server';
import { z } from 'zod';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const CheckBody = z.object({
    pins: z.array(z.number().int()),
    mac: z.string().min(1),
});
export async function POST(request) {
    let body;
    try {
        const json = await request.json();
        const parsed = CheckBody.safeParse(json);
        if (!parsed.success) {
            return NextResponse.json({ error: 'Expected { pins: number[], mac: string }' }, { status: 400 });
        }
        body = parsed.data;
    }
    catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    const { pins, mac } = body;
    let sendAndReceive;
    try {
        const mod = await import('@/lib/serial');
        const helper = mod.default ?? mod;
        if (typeof helper.sendAndReceive !== 'function')
            throw new Error('sendAndReceive not found');
        sendAndReceive = helper.sendAndReceive;
    }
    catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        console.error('Failed to load serial helper:', err);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
    const cmd = `CHECK ${pins.join(',')} ${mac}`;
    try {
        const raw = await sendAndReceive(cmd);
        const text = raw.trim().replace(/^.*:\s*/, '').trim();
        if (text === 'SUCCESS' || text === 'OK')
            return NextResponse.json({ failures: [] });
        if (text.startsWith('FAILURES:')) {
            const failures = text.slice('FAILURES:'.length)
                .split(',').map(n => parseInt(n, 10)).filter(n => !Number.isNaN(n));
            return NextResponse.json({ failures });
        }
        if (text.startsWith('FAILURE MISSING')) {
            const rest = text.slice('FAILURE MISSING'.length).replace(/^[\s:]+/, '').replace(/,+$/, '');
            const failures = rest.split(',').map(n => parseInt(n, 10)).filter(n => !Number.isNaN(n));
            return NextResponse.json({ failures });
        }
        console.error('Unexpected ESP response:', text);
        return NextResponse.json({ error: `Unexpected ESP response: ${text}` }, { status: 500 });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown';
        console.error('POST /api/serial/check error:', err);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
//# sourceMappingURL=route.js.map