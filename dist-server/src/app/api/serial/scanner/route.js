// src/app/api/serial/scanner/route.ts
import { NextResponse } from 'next/server';
import { getLastScanAndClear, getLastScanAndClearFor, peekLastScanFor } from '@/lib/scannerMemory';
import { ensureScanners, getScannerStatus } from '@/lib/serial';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
function envScannerPaths() {
    const base = process.env.SCANNER_TTY_PATHS ?? process.env.SCANNER_TTY_PATH ?? '/dev/ttyACM0';
    const list = base.split(',').map(s => s.trim()).filter(Boolean);
    const s2 = (process.env.SCANNER2_TTY_PATH ?? process.env.SECOND_SCANNER_TTY_PATH ?? '').trim();
    if (s2 && !list.includes(s2))
        list.push(s2);
    return Array.from(new Set(list));
}
// accept ttyACM<N> and common by-id ACM<N>
const isAcmPath = (p) => !!p &&
    (/(^|\/)ttyACM\d+$/.test(p) || /\/by-id\/.*ACM\d+/i.test(p) || /(\/|^)ACM\d+($|[^0-9])/.test(p));
function pickStatus(raw, allowed) {
    if (!raw || typeof raw !== 'object')
        return null;
    const obj = raw;
    // prefer exact env paths
    for (const path of allowed)
        if (obj[path])
            return obj[path];
    // fallback: any ACM device
    for (const [k, v] of Object.entries(obj))
        if (isAcmPath(k))
            return v;
    // legacy single object
    const maybe = raw;
    if ('open' in maybe && 'inCooldown' in maybe && 'nextAttemptAt' in maybe)
        return maybe;
    return null;
}
// simple server-side cache so peeks don't lose events
let SCAN_CACHE = null;
function readScan(peek) {
    // serve cached first
    if (SCAN_CACHE) {
        if (peek)
            return SCAN_CACHE;
        const s = SCAN_CACHE;
        SCAN_CACHE = null;
        return s;
    }
    // pull from memory once
    const s = getLastScanAndClear();
    if (!s || !s.code)
        return null;
    const val = { code: String(s.code), path: s.path ?? null };
    if (peek) {
        SCAN_CACHE = val; // keep for the real consumer
        return SCAN_CACHE;
    }
    return val;
}
// Keep ensure() cheap but frequent
let NEXT_ENSURE_AT = 0;
const ENSURE_INTERVAL_MS = Number(process.env.SCANNER_ENSURE_INTERVAL_MS ?? 2000);
const CLIENT_RETRY_MS = Number(process.env.SCANNER_CLIENT_RETRY_MS ?? 1800);
export async function GET(req) {
    try {
        const url = new URL(req.url);
        const consume = url.searchParams.get('consume') === '1'; // default: peek
        const wantedPath = (url.searchParams.get('path') || '').trim();
        const now = Date.now();
        if (now >= NEXT_ENSURE_AT) {
            NEXT_ENSURE_AT = now + ENSURE_INTERVAL_MS;
            await ensureScanners(envScannerPaths());
        }
        const statusRaw = getScannerStatus();
        const status = pickStatus(statusRaw, envScannerPaths());
        // Per-path mode (if query param provided)
        if (wantedPath) {
            const data = consume ? getLastScanAndClearFor(wantedPath) : (peekLastScanFor(wantedPath)?.code ?? null);
            const code = data ?? null;
            const path = code ? wantedPath : null;
            let error = null;
            if (!code) {
                const st = statusRaw[wantedPath];
                if (!st)
                    error = 'disconnected:not_present';
                else if (st.inCooldown)
                    error = st.lastError || 'cooldown';
            }
            const advise = CLIENT_RETRY_MS;
            return NextResponse.json({ code, path, error, retryInMs: advise }, { headers: { 'Cache-Control': 'no-store' } });
        }
        const scan = readScan(!consume); // peek unless explicitly consuming
        const code = scan?.code ?? null;
        const path = scan?.path ?? null;
        let error = null;
        // Optional: convey a hint about state in error (for logs/debug)
        if (!code) {
            if (!status)
                error = 'disconnected:not_present';
            else if (!status.open)
                error = 'closed:not_open';
            else if (status.inCooldown)
                error = status.lastError || 'cooldown';
        }
        // Adaptive client retry suggestion
        let advise = CLIENT_RETRY_MS;
        if (!code) {
            if (!status)
                advise = Math.max(advise, 2500);
            else if (!status.open)
                advise = Math.max(advise, 2000);
            else if (status.inCooldown)
                advise = Math.max(advise, 2000);
            else
                advise = Math.max(advise, 1500);
        }
        return NextResponse.json({ code, path, error, retryInMs: advise }, { headers: { 'Cache-Control': 'no-store' } });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const busy = /BUSY|lock|COOLDOWN/i.test(message);
        return NextResponse.json({ code: null, path: null, error: message, retryInMs: CLIENT_RETRY_MS }, { status: busy ? 503 : 200, headers: { 'Cache-Control': 'no-store' } });
    }
}
