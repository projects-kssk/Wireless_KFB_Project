let lastScan = null;
export function setLastScan(code) {
    console.log(`[scannerMemory] setLastScan called with: "${code}"`);
    lastScan = code;
}
export function getLastScanAndClear() {
    const temp = lastScan;
    lastScan = null;
    return temp;
}
//# sourceMappingURL=scannerMemory.js.map