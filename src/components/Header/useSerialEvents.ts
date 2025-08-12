// src/components/Header/useSerialEvents.ts
import { useEffect, useState } from "react";
import type { SimpleStatus } from "@/components/Header/StatusIndicatorCard";

type DeviceInfo = {
  path: string;
  vendorId: string | null;
  productId: string | null;
  manufacturer: string | null;
  serialNumber: string | null;
};

type SerialEvent =
  | { type: "devices"; devices: DeviceInfo[] }
  | { type: "esp"; ok: boolean; raw?: string; error?: string }
  | { type: "scan"; code: string }
  | { type: "scanner/open" }
  | { type: "scanner/close" }
  | { type: "scanner/error"; error: string };

const SSE_PATH = "/api/serial/events";

export function useSerialEvents() {
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [server, setServer] = useState<SimpleStatus>("offline");
  const [lastScan, setLastScan] = useState<string | null>(null);
  const [scannerError, setScannerError] = useState<string | null>(null);

  useEffect(() => {
    const es = new EventSource(SSE_PATH);

    es.onmessage = (ev) => {
      try {
        const msg: SerialEvent = JSON.parse(ev.data);
        switch (msg.type) {
          case "devices":
            setDevices(Array.isArray(msg.devices) ? msg.devices : []);
            break;
          case "esp":
            setServer(msg.ok ? "connected" : "offline");
            break;
          case "scan":
            setLastScan(String(msg.code));
            break;
          case "scanner/error":
            setScannerError(String(msg.error || "Scanner error"));
            break;
        }
      } catch {
        /* ignore */
      }
    };

    es.onerror = () => {
      // keep UI calm; EventSource will retry automatically
    };

    return () => es.close();
  }, []);

  return { devices, server, lastScan, scannerError };
}
