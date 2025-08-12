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

export async function GET() {
  try {
    const statuses = normalizeStatuses(getScannerStatus());

    const anyOpen = statuses.some((s) => s.open);
    const anyCooldown = statuses.some((s) => s.inCooldown);
    const lastError =
      statuses.map((s) => s.lastError).find((e) => !!e) ?? null;

    // earliest nextAttemptAt across scanners
    const nexts = statuses
      .map((s) => Number(s.nextAttemptAt))
      .filter((n) => Number.isFinite(n) && n > 0);
    const earliestNext = nexts.length ? Math.min(...nexts) : 0;
    const retryInMs =
      earliestNext > 0 ? Math.max(0, earliestNext - Date.now()) : 0;

    if (!anyOpen && anyCooldown) {
      // Respect cooldown; don't hammer ports
      return NextResponse.json(
        {
          code: null,
          error: lastError ?? "cooldown",
          retryInMs,
        },
        { status: 200 }
      );
    }

    // Try to (re)open all configured scanners (internally guarded/cooldown-aware)
    await ensureScanners();

    const code = getLastScanAndClear();
    if (code) console.log(`[SCANNER] Scanned code: ${code}`);

    return NextResponse.json({ code });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : typeof err === "string" ? err : String(err);

    // 503 only for transient/busy; otherwise 200 with error to reduce log noise
    const isBusy = /BUSY|lock|COOLDOWN/i.test(message);
    const status = isBusy ? 503 : 200;
    return NextResponse.json({ code: null, error: message }, { status });
  }
}
