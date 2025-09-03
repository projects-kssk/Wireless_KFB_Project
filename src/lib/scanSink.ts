import { onSerialEvent } from './bus.js';
import { setLastScan } from './scannerMemory.js';

let wired = false;

export function wireScanSink() {
  if (wired) return;
  wired = true;
  onSerialEvent((e: any) => {
    if (e && e.type === 'scan' && e.code) {
      setLastScan(String(e.code), (e as any).path ?? null);
    }
  });
}

// auto-wire on import
wireScanSink();
