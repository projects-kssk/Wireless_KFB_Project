const GG = globalThis;
if (!GG.__busSubs)
    GG.__busSubs = new Set();
const subs = GG.__busSubs;
export function onSerialEvent(fn) {
    subs.add(fn);
    return () => subs.delete(fn);
}
export function broadcast(e) {
    for (const s of subs) {
        try {
            s(e);
        }
        catch { }
    }
}
//# sourceMappingURL=bus.js.map