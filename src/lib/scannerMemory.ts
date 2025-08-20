// src/lib/scannerMemory.ts

type ScanMem = { last: string | null; ts: number };
type ScanMap = Map<string, ScanMem>;

type LastScanObj = { code: string; path: string | null } | null;

const GG = globalThis as unknown as {
  __scanMemV2?: ScanMap;
  __lastScanObj?: LastScanObj;
};

if (!GG.__scanMemV2) GG.__scanMemV2 = new Map<string, ScanMem>();
if (GG.__lastScanObj === undefined) GG.__lastScanObj = null;

const DEFAULT_KEY = "default";

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

/** New unified object API (code + path) */
export function recordScan(code: string, path?: string | null) {
  const clean = String(code ?? "").trim();
  if (!clean) return;
  GG.__lastScanObj = { code: clean, path: path ?? null };
}

export function getLastScanAndClear(): { code: string; path: string | null } | null {
  const v = GG.__lastScanObj ?? null;
  GG.__lastScanObj = null;
  return v;
}

/** Per-port string-only ring buffer (multi-source helpers) */
export function setLastScanFor(source: string, code: string) {
  const s = slot(source);
  s.last = (code ?? "").trim() || null;
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

/** Legacy single-scanner aliases (string-only). Kept for back-compat.
 *  NOTE: names are *different* so they DON'T SHADOW the object API above.
 */
export const setLastScanLegacy = (code: string) => setLastScanFor(DEFAULT_KEY, code);
export const getLastScanAndClearLegacy = () => getLastScanAndClearFor(DEFAULT_KEY);
export const peekLastScanLegacy = () => peekLastScanFor(DEFAULT_KEY);
