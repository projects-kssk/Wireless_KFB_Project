// src/lib/scannerMemory.ts
type ScanMem = { last: string | null; ts: number };

const g = globalThis as unknown as { __scanMem?: ScanMem };
if (!g.__scanMem) g.__scanMem = { last: null, ts: 0 };

export function setLastScan(s: string) {
  g.__scanMem!.last = s?.trim() || null;
  g.__scanMem!.ts = Date.now();
}

export function getLastScanAndClear() {
  const v = g.__scanMem!.last;
  g.__scanMem!.last = null;
  return v;
}

export function peekLastScan() {
  return g.__scanMem!.last;
}
