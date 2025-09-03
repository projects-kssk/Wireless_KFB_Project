import { onSerialEvent } from './bus.js';
import { setLastScan } from './scannerMemory.js';
let wired = false;
export function wireScanSink() {
    if (wired)
        return;
    wired = true;
    onSerialEvent((e) => {
        if (e && e.type === 'scan' && e.code) {
            setLastScan(String(e.code), e.path ?? null);
        }
    });
}
// auto-wire on import
wireScanSink();
