// src/components/Header/useSerialEvents.ts
"use client";

import { useEffect, useMemo, useState } from "react";
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
  | { type: "scan"; code: string; path?: string }
  | { type: "scanner/open"; path?: string }
  | { type: "scanner/close"; path?: string }
  | { type: "scanner/error"; error: string; path?: string }
  | { type: "scanner/paths"; paths: string[] };

type ScannerPortState = {
  present: boolean;          // enumerated by SerialPort.list()
  open: boolean;             // scanner runtime opened
  lastError: string | null;  // last error for this path
  lastScanTs: number | null; // last scan ts
};

const SSE_PATH = "/api/serial/events";

export function useSerialEvents() {
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [server, setServer] = useState<SimpleStatus>("offline");
  const [lastScan, setLastScan] = useState<string | null>(null);
  const [scannerError, setScannerError] = useState<string | null>(null);

  const [paths, setPaths] = useState<string[]>([]);
  const [ports, setPorts] = useState<Record<string, ScannerPortState>>({});

  // upsert a port record
  const up = (p: string, patch: Partial<ScannerPortState>) =>
    setPorts((prev) => {
      const cur: ScannerPortState =
        prev[p] ?? { present: false, open: false, lastError: null, lastScanTs: null };
      return { ...prev, [p]: { ...cur, ...patch } };
    });

  // update presence from device list
  useEffect(() => {
    if (!paths.length) return;
    const present = new Set(devices.map((d) => d.path));
    setPorts((prev) => {
      const next = { ...prev };
      for (const p of paths) {
        const cur: ScannerPortState =
          next[p] ?? { present: false, open: false, lastError: null, lastScanTs: null };
        next[p] = { ...cur, present: present.has(p) };
      }
      return next;
    });
  }, [devices, paths]);

  // SSE wire-up
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

          case "scanner/paths": {
            const list = Array.isArray(msg.paths) ? msg.paths.filter(Boolean) : [];
            setPaths((prev) => {
              const uniq = Array.from(new Set([...prev, ...list]));
              for (const p of uniq) up(p, {});
              return uniq;
            });
            break;
          }

          case "scanner/open":
            if (msg.path) up(msg.path, { open: true, lastError: null });
            break;

          case "scanner/close":
            if (msg.path) up(msg.path, { open: false });
            break;

          case "scanner/error":
            setScannerError(String(msg.error || "Scanner error"));
            if (msg.path) up(msg.path, { lastError: String(msg.error || "error") });
            break;

          case "scan":
            setLastScan(String(msg.code));
            if (msg.path) up(msg.path, { lastScanTs: Date.now(), open: true });
            break;
        }
      } catch {
        /* ignore malformed frames */
      }
    };

    es.onerror = () => {
      /* EventSource will retry */
    };

    return () => es.close();
  }, []);

  // roll-ups
  const scannersDetected = useMemo(
    () => paths.filter((p) => ports[p]?.present).length,
    [paths, ports]
  );
  const scannersOpen = useMemo(
    () => paths.filter((p) => ports[p]?.open).length,
    [paths, ports]
  );

  return {
    devices,
    server,
    lastScan,
    scannerError,
    scannerPaths: paths,
    scannerPorts: ports, // map[path] -> state
    scannersDetected,
    scannersOpen,
  };
}
