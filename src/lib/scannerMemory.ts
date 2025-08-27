export type Scan = { code: string; path: string | null; at: number };

const GG = globalThis as any;
if (!GG.__lastScan) GG.__lastScan = null as Scan | null;
if (!GG.__lastScanByPath) GG.__lastScanByPath = new Map<string, Scan | null>();

function normPath(p: string | null | undefined): string | null {
  const s = String(p ?? "").trim();
  return s ? s : null;
}

export function setLastScan(code: string, path: string | null) {
  const clean = String(code ?? '').trim();
  if (!clean) return;
  const at = Date.now();
  const p = normPath(path);
  GG.__lastScan = { code: clean, path: p, at };
  if (p) GG.__lastScanByPath.set(p, { code: clean, path: p, at });
}

export function getLastScanAndClear(): Scan | null {
  const s: Scan | null = GG.__lastScan;
  GG.__lastScan = null;
  return s;
}

export function peekLastScan(): Scan | null {
  return GG.__lastScan as Scan | null;
}

export function getLastScanAndClearFor(path: string): string | null {
  const p = normPath(path);
  if (!p) return null;
  const s: Scan | null = GG.__lastScanByPath.get(p) ?? null;
  GG.__lastScanByPath.delete(p);
  return s?.code ?? null;
}

export function peekLastScanFor(path: string): Scan | null {
  const p = normPath(path);
  if (!p) return null;
  const s: Scan | null = GG.__lastScanByPath.get(p) ?? null;
  return s ?? null;
}
