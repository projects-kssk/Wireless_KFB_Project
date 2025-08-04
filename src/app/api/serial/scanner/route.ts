// src/app/api/serial/scanner/route.ts
import { NextResponse } from 'next/server';
import { getLastScanAndClear } from '@/lib/scannerMemory';
import { ensureScanner } from '@/lib/serial';

const SCAN_LOG: string[] = [];

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Ensure scanner is opened once (singleton)
    await ensureScanner();

    const code = getLastScanAndClear();
    if (code) {
      SCAN_LOG.push(code);
      console.log(`[SCANNER] Scanned code: ${code}`);
    }

    return NextResponse.json({ code });
  } catch (err: unknown) {
    console.error('[SCANNER ERROR]', err);

    const message =
      err instanceof Error ? err.message :
      typeof err === 'string' ? err :
      String(err);

    // Surface a 503 on "busy/locked" so the client can back off
    const status = /BUSY|lock/i.test(message) ? 503 : 500;
    return NextResponse.json({ code: null, error: message }, { status });
  }
}
