// src/app/api/serial/scanner/route.ts
import { NextResponse } from "next/server";
import { getLastScanAndClear } from "@/lib/scannerMemory";
import { ensureScanners, getScannerStatus } from "@/lib/serial";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ScannerStatus = {
  open: boolean;
  inCooldown: boolean;
  nextAttemptAt: number;
  lastError: string | null;
};

// Normalize getScannerStatus() to an array (supports old/new shapes)
function normalizeStatuses(st: unknown): ScannerStatus[] {
  if (!st) return [];
  if (typeof st === "object" && st !== null) {
    // New shape: map of path -> status
    const maybeMap = st as Record<string, unknown>;
    const values = Object.values(maybeMap);
    if (values.length && typeof values[0] === "object") {
      return values as ScannerStatus[];
    }
    // Old shape: single status object
    const maybeSingle = st as ScannerStatus;
    if (
      "open" in maybeSingle &&
      "inCooldown" in maybeSingle &&
      "nextAttemptAt" in maybeSingle
    ) {
      return [maybeSingle];
    }
  }
  return [];
}

// 5s server-side soft rate limit (global)
let NEXT_OK_AT = 0;
const MIN_INTERVAL_MS = 5_000;


export async function GET() {
  try {
    // throttle
    const now = Date.now();
    if (now < NEXT_OK_AT) {
      const retryInMs = NEXT_OK_AT - now;
      return NextResponse.json({ code: null, error: "poll-too-soon", retryInMs }, { status: 200 });
    }
    NEXT_OK_AT = now + MIN_INTERVAL_MS;

    const statuses = normalizeStatuses(getScannerStatus());
    const anyOpen = statuses.some((s) => s.open);
    const anyCooldown = statuses.some((s) => s.inCooldown);
    const lastError = statuses.map((s) => s.lastError).find(Boolean) ?? null;

    const nexts = statuses.map((s) => Number(s.nextAttemptAt)).filter((n) => Number.isFinite(n) && n > 0);
    const earliestNext = nexts.length ? Math.min(...nexts) : 0;
    const retryInMs = earliestNext > 0 ? Math.max(0, earliestNext - Date.now()) : 0;

    if (!anyOpen && anyCooldown) {
      return NextResponse.json({ code: null, error: lastError ?? "cooldown", retryInMs }, { status: 200 });
    }

    await ensureScanners();

    const code = getLastScanAndClear();
    if (code) console.log(`[SCANNER] Scanned code: ${code}`);

    return NextResponse.json({ code, retryInMs: MIN_INTERVAL_MS });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : typeof err === "string" ? err : String(err);
    const isBusy = /BUSY|lock|COOLDOWN/i.test(message);
    const status = isBusy ? 503 : 200;
    return NextResponse.json({ code: null, error: message }, { status });
  }
}
