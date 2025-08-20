import { onSerialEvent } from '@/lib/bus';
import { setLastScan } from '@/lib/scannerMemory';

let wired = false;

export function wireScanSink() {
  if (wired) return;
  wired = true;
  onSerialEvent((e) => {
    if (e && e.type === 'scan' && e.code) {
      setLastScan(String(e.code), (e as any).path ?? null);
    }
  });
}

// auto-wire on import
wireScanSink();
