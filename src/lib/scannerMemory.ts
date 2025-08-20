// src/lib/scannerMemory.ts

type ScanMem = { last: string | null; ts: number };
type ScanMap = Map<string, ScanMem>;

const GG = globalThis as unknown as { __scanMemV2?: ScanMap };
if (!GG.__scanMemV2) GG.__scanMemV2 = new Map<string, ScanMem>();

const DEFAULT_KEY = 'default';

/** Internal: get or init entry */
function slot(key: string): ScanMem {
  const k = key || DEFAULT_KEY;
  let v = GG.__scanMemV2!.get(k);
  if (!v) {
    v = { last: null, ts: 0 };
    GG.__scanMemV2!.set(k, v);
  }
  return v;
}

/** Per-port API */
export function setLastScanFor(source: string, code: string) {
  const s = slot(source);
  s.last = (code ?? '').trim() || null;
  s.ts = Date.now();
}

export function getLastScanAndClearFor(source: string): string | null {
  const s = slot(source);
  const v = s.last;
  s.last = null;
  return v;
}

export function peekLastScanFor(source: string): string | null {
  return slot(source).last;
}

export function clearScanFor(source: string) {
  slot(source).last = null;
}

/** Optional: purge all entries */
export function clearAllScans() {
  GG.__scanMemV2!.clear();
}

/** Optional: TTL-based sweep (no-op if ttlMs <= 0) */
export function sweep(ttlMs = 0) {
  if (!ttlMs || ttlMs <= 0) return;
  const now = Date.now();
  for (const [k, v] of GG.__scanMemV2!) {
    if (!v.last && now - v.ts > ttlMs) GG.__scanMemV2!.delete(k);
  }
}

/** Back-compat single-scanner API */
export const setLastScan = (code: string) => setLastScanFor(DEFAULT_KEY, code);
export const getLastScanAndClear = () => getLastScanAndClearFor(DEFAULT_KEY);
export const peekLastScan = () => peekLastScanFor(DEFAULT_KEY);
