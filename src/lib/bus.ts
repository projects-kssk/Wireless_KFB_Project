import { EventEmitter } from "events";

export type DeviceInfo = {
  path: string;
  vendorId: string | null;
  productId: string | null;
  manufacturer: string | null;
  serialNumber: string | null;
};

export type SerialEvent =
  | { type: "scan"; code: string }
  | { type: "scanner/open" }
  | { type: "scanner/close" }
  | { type: "scanner/error"; error: string }
  | { type: "devices"; devices: DeviceInfo[] }
  | { type: "esp"; ok: boolean; raw?: string; error?: string };

const g = globalThis as any;
if (!g.__serialBus) g.__serialBus = new EventEmitter();

export const serialBus: EventEmitter = g.__serialBus;

export function broadcast(e: SerialEvent) {
  serialBus.emit("event", e);
}

export function onSerialEvent(cb: (e: SerialEvent) => void) {
  serialBus.on("event", cb);
  return () => serialBus.off("event", cb);
}
