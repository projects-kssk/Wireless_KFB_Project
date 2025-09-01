import { onSerialEvent } from '@/lib/bus';
import { setLastScan } from '@/lib/scannerMemory';
import { LOG } from '@/lib/logger';

const log = LOG.tag('scan:sink');
let wired = false;

export function wireScanSink() {
  if (wired) return;
  wired = true;
  onSerialEvent((e) => {
    if (e && e.type === 'scan' && e.code) {
      const mac  = String(e.code).trim();
      const path = (e as any).path ?? null;
      log.info('scan->memory', { mac, path });
      setLastScan(mac, path);
    }
  });
}

// auto-wire on import
wireScanSink();
