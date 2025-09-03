const GG = globalThis;
if (!GG.__lastScan)
    GG.__lastScan = null;
if (!GG.__lastScanByPath)
    GG.__lastScanByPath = new Map();
function normPath(p) {
    const s = String(p ?? "").trim();
    return s ? s : null;
}
export function setLastScan(code, path) {
    const clean = String(code ?? '').trim();
    if (!clean)
        return;
    const at = Date.now();
    const p = normPath(path);
    GG.__lastScan = { code: clean, path: p, at };
    if (p)
        GG.__lastScanByPath.set(p, { code: clean, path: p, at });
}
export function getLastScanAndClear() {
    const s = GG.__lastScan;
    GG.__lastScan = null;
    return s;
}
export function peekLastScan() {
    return GG.__lastScan;
}
export function getLastScanAndClearFor(path) {
    const p = normPath(path);
    if (!p)
        return null;
    const s = GG.__lastScanByPath.get(p) ?? null;
    GG.__lastScanByPath.delete(p);
    return s?.code ?? null;
}
export function peekLastScanFor(path) {
    const p = normPath(path);
    if (!p)
        return null;
    const s = GG.__lastScanByPath.get(p) ?? null;
    return s ?? null;
}
