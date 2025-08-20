export type Scan = { code: string; path: string | null; at: number };

const GG = globalThis as any;
if (!GG.__lastScan) GG.__lastScan = null as Scan | null;

export function setLastScan(code: string, path: string | null) {
  const clean = String(code ?? '').trim();
  if (!clean) return;
  GG.__lastScan = { code: clean, path: path ?? null, at: Date.now() };
}

export function getLastScanAndClear(): Scan | null {
  const s: Scan | null = GG.__lastScan;
  GG.__lastScan = null;
  return s;
}

export function peekLastScan(): Scan | null {
  return GG.__lastScan as Scan | null;
}
