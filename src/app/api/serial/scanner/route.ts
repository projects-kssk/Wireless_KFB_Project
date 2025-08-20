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

function envScannerPaths(): string[] {
  const base =
    process.env.SCANNER_TTY_PATHS ??
    process.env.SCANNER_TTY_PATH ??
    "/dev/ttyACM0";
  const list = base.split(",").map((s) => s.trim()).filter(Boolean);
  const s2 =
    (process.env.SCANNER2_TTY_PATH ??
      process.env.SECOND_SCANNER_TTY_PATH ??
      "").trim();
  if (s2 && !list.includes(s2)) list.push(s2);
  return Array.from(new Set(list));
}

const ACM_ONLY = "/dev/ttyACM0";
const isAcm0Path = (p?: string | null) =>
  !!p &&
  (p === ACM_ONLY ||
    /(^|\/)ttyACM0$/.test(p) ||
    /\/by-id\/.*ACM0/i.test(p));

function pickAcm0Status(raw: unknown): ScannerStatus | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, ScannerStatus>;
  // exact key
  if (obj[ACM_ONLY]) return obj[ACM_ONLY];
  // fuzzy match
  for (const [k, v] of Object.entries(obj)) {
    if (isAcm0Path(k)) return v as ScannerStatus;
  }
  // if legacy single status object
  const maybe = raw as ScannerStatus;
  if (
    "open" in maybe &&
    "inCooldown" in maybe &&
    "nextAttemptAt" in maybe
  ) return maybe;
  return null;
}

// Keep ensure() cheap but frequent
let NEXT_ENSURE_AT = 0;
const ENSURE_INTERVAL_MS = 800;
const CLIENT_RETRY_MS = 250;

export async function GET() {
  try {
    const now = Date.now();
    if (now >= NEXT_ENSURE_AT) {
      NEXT_ENSURE_AT = now + ENSURE_INTERVAL_MS;
      await ensureScanners(envScannerPaths());
    }

    const rawStatus = getScannerStatus();
    const s = pickAcm0Status(rawStatus); // focus on ACM0

    // scan object
    const scan = getLastScanAndClear();
    const code = scan?.code ?? null;
    const path = scan?.path ?? null;

    let error: string | null = null;
    // If no code, report connection state
    if (!code) {
      if (!s) {
        error = "disconnected:not_present";
      } else if (!s.open) {
        error = "closed:not_open";
      } else if (s.inCooldown) {
        error = s.lastError || "cooldown";
      }
    }

    return NextResponse.json({
      code,
      path,
      error,
      retryInMs: CLIENT_RETRY_MS,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { code: null, path: null, error: message, retryInMs: CLIENT_RETRY_MS },
      { status: /BUSY|lock|COOLDOWN/i.test(message) ? 503 : 200 }
    );
  }
}
