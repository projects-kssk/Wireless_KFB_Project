"use client"
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

export function useSerialEvents() {
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [server, setServer] = useState<SimpleStatus>("offline");
  const [lastScan, setLastScan] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    // Point this at your SSE route path (the one returning text/event-stream)
    const url = `${window.location.origin}/api/serial/sse`; // ← adjust if your route differs
    const es = new EventSource(url);

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    es.onmessage = (ev) => {
      // server also sends ": ping" comments; EventSource ignores those
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
          // other events are informational
        }
      } catch {
        // ignore malformed frames
      }
    };

    return () => es.close();
  }, []);

  return { devices, server, lastScan, sseConnected: connected };
}
