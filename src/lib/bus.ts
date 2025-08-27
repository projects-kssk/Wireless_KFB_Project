export type DeviceInfo = {
  path: string;
  vendorId: string | null;
  productId: string | null;
  manufacturer: string | null;
  serialNumber: string | null;
};

export type SerialEvent =
  | { type: 'devices'; devices: DeviceInfo[] }
  | { type: 'esp'; ok: boolean; raw?: string; present?: boolean; error?: string }
  | { type: 'net'; iface: string; present: boolean; up: boolean; ip?: string | null; oper?: string | null }
  | { type: 'redis'; ready: boolean }
  | { type: 'scan'; code: string; path?: string }
  | { type: 'scanner/open'; path?: string }
  | { type: 'scanner/close'; path?: string }
  | { type: 'scanner/error'; error: string; path?: string }
  | { type: 'scanner/paths'; paths: string[] };

type Sub = (e: SerialEvent) => void;

const GG = globalThis as any;
if (!GG.__busSubs) GG.__busSubs = new Set<Sub>();
const subs: Set<Sub> = GG.__busSubs;

export function onSerialEvent(fn: Sub): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function broadcast(e: SerialEvent): void {
  for (const s of subs) {
    try { s(e); } catch {}
  }
}
