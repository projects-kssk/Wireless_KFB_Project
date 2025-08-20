// src/app/api/serial/scanner/route.ts
import { NextResponse } from 'next/server';
import { getLastScanAndClear } from '@/lib/scannerMemory';
import { ensureScanners, getScannerStatus } from '@/lib/serial';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ScannerStatus = {
  open: boolean;
  inCooldown: boolean;
  nextAttemptAt: number;
  lastError: string | null;
};

// Normalize getScannerStatus() to an array (supports old/new shapes)
function normalizeStatuses(st: unknown): ScannerStatus[] {
  if (!st) return [];
  if (typeof st === 'object' && st !== null) {
    const maybeMap = st as Record<string, unknown>;
    const values = Object.values(maybeMap);
    if (values.length && typeof values[0] === 'object') {
      return values as ScannerStatus[];
    }
    const maybeSingle = st as ScannerStatus;
    if (
      'open' in maybeSingle &&
      'inCooldown' in maybeSingle &&
      'nextAttemptAt' in maybeSingle
    ) {
      return [maybeSingle];
    }
  }
  return [];
}

// Throttle only expensive reopen logic, never suppress a scanned code
let NEXT_ENSURE_AT = 0;
const ENSURE_INTERVAL_MS = 1000; // was 5000
const CLIENT_RETRY_MS = 250;     // match client poll

export async function GET() {
  try {
    const now = Date.now();

    // Read current status
    const statuses = normalizeStatuses(getScannerStatus());
    const anyOpen = statuses.some((s) => s.open);
    const anyCooldown = statuses.some((s) => s.inCooldown);
    const lastError =
      statuses.map((s) => s.lastError).find(Boolean) ?? null;

    // Throttle only the expensive ensure
    if (now >= NEXT_ENSURE_AT) {
      NEXT_ENSURE_AT = now + ENSURE_INTERVAL_MS;
      await ensureScanners();
    }

    // Always deliver latest scan if present
    const code = getLastScanAndClear();
    return NextResponse.json({
      code,
      error: !anyOpen && anyCooldown ? lastError ?? 'cooldown' : null,
      retryInMs: CLIENT_RETRY_MS,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : String(err);
    const busy = /BUSY|lock|COOLDOWN/i.test(message);
    return NextResponse.json(
      { code: null, error: message, retryInMs: CLIENT_RETRY_MS },
      { status: busy ? 503 : 200 }
    );
  }
}
