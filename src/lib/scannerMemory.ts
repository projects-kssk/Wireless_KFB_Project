let lastScan: string | null = null;

export function setLastScan(code: string) {
  console.log(`[scannerMemory] setLastScan called with: "${code}"`);
  lastScan = code;
}

export function getLastScanAndClear() {
  const temp = lastScan;
  lastScan = null;
  return temp;
}
