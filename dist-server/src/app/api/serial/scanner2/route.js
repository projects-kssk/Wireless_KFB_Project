// src/app/api/serial/scanner2/route.ts
import { NextResponse } from 'next/server';
import { getLastScanAndClearFor } from '@/lib/scannerMemory';
import { ensureScannerForPath, getScannerStatus } from '@/lib/serial';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
function pickStatus(path) {
    const all = getScannerStatus();
    return all[path] ?? { open: false, inCooldown: false, nextAttemptAt: 0, lastError: null };
}
const SECONDARY_PATH = process.env.SCANNER2_TTY_PATH ||
    process.env.SECOND_SCANNER_TTY_PATH ||
    '/dev/ttyACM1'; // your stated default
let NEXT_ENSURE_AT = 0;
const ENSURE_INTERVAL_MS = 1000;
const CLIENT_RETRY_MS = 250;
export async function GET() {
    try {
        const now = Date.now();
        if (now >= NEXT_ENSURE_AT) {
            NEXT_ENSURE_AT = now + ENSURE_INTERVAL_MS;
            await ensureScannerForPath(SECONDARY_PATH, Number(process.env.SCANNER2_BAUD ?? process.env.SCANNER_BAUD ?? 115200));
        }
        const st = pickStatus(SECONDARY_PATH);
        const code = getLastScanAndClearFor(SECONDARY_PATH);
        return NextResponse.json({
            code,
            error: !st.open && st.inCooldown ? st.lastError ?? 'cooldown' : null,
            retryInMs: CLIENT_RETRY_MS,
            path: SECONDARY_PATH,
        });
    }
    catch (err) {
        const message = err?.message ?? String(err);
        return NextResponse.json({ code: null, error: message, retryInMs: CLIENT_RETRY_MS }, { status: 200 });
    }
}
