let lastScan: string | null = null;

export function setLastScan(barcode: string) {
  console.log('[SCANNER] Scanned:', barcode);   // <--- This is the log line you want
  lastScan = barcode;
}
export function getLastScanAndClear(): string | null {
  const code = lastScan;
  lastScan = null;
  return code;
}
