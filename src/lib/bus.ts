// src/lib/bus.ts

export type DeviceInfo = {
  path: string;
  vendorId: string | null;
  productId: string | null;
  manufacturer: string | null;
  serialNumber: string | null;
};

// ⬇︎ make path optional on scanner events and scan
export type SerialEvent =
  | { type: "devices"; devices: DeviceInfo[] }
  | { type: "esp"; ok: boolean; raw?: string; present?: boolean; error?: string }
  | { type: "scan"; code: string; path?: string }
  | { type: "scanner/open"; path?: string }
  | { type: "scanner/close"; path?: string }
  | { type: "scanner/error"; error: string; path?: string };

// simple pub/sub
type Sub = (e: SerialEvent) => void;
const subs = new Set<Sub>();

export function onSerialEvent(fn: Sub): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function broadcast(e: SerialEvent): void {
  for (const s of subs) {
    try { s(e); } catch {}
  }
}
