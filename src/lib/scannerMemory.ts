let lastScan: string | null = null;
const RING: string[] = [];
const MAX = 100;

export function setLastScan(code: string) {
  lastScan = code;
  const line = `${new Date().toISOString()} ${code}`;
  RING.push(line);
  if (RING.length > MAX) RING.shift();
}

export function getLastScanAndClear() {
  const c = lastScan;
  lastScan = null;
  return c;
}

export function getScanLog() {
  // newest first
  return [...RING].reverse();
}
