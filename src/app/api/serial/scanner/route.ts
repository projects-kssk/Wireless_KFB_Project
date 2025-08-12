// src/app/api/serial/scanner/route.ts
import { NextResponse } from 'next/server';
import { getLastScanAndClear } from '@/lib/scannerMemory';
import { ensureScanner, getScannerStatus } from '@/lib/serial';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const st = getScannerStatus();
    if (!st.open && st.inCooldown) {
      // Do not try to open during cooldown — tell client when to retry
      return NextResponse.json({
        code: null,
        error: st.lastError ?? "cooldown",
        retryInMs: Math.max(0, st.nextAttemptAt - Date.now()),
      }, { status: 200 });
    }

    // Try to open (guarded by ensureScanner itself)
    await ensureScanner();

    const code = getLastScanAndClear();
    if (code) console.log(`[SCANNER] Scanned code: ${code}`);
    return NextResponse.json({ code });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message :
      typeof err === 'string' ? err : String(err);

    // 503 only for transient/busy; otherwise 200 with error to avoid spammy errors
    const isBusy = /BUSY|lock|COOLDOWN/i.test(message);
    const status = isBusy ? 503 : 200;
    return NextResponse.json({ code: null, error: message }, { status });
  }
}
