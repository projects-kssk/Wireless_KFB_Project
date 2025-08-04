// src/app/api/serial/scanner/route.ts
import { NextResponse } from 'next/server';
import { getLastScanAndClear } from '@/lib/scannerMemory';
import { ensureScanner } from '@/lib/serial';
const SCAN_LOG = [];
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
    try {
        ensureScanner();
        const code = getLastScanAndClear();
        if (code) {
            SCAN_LOG.push(code);
            console.log(`[SCANNER] Scanned code: ${code}`);
        }
        return NextResponse.json({ code });
    }
    catch (err) {
        console.error('[SCANNER ERROR]', err);
        const message = err instanceof Error
            ? err.message
            : typeof err === 'string'
                ? err
                : String(err);
        return NextResponse.json({ code: null, error: message }, { status: 500 });
    }
}
//# sourceMappingURL=route.js.map