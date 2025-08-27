"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  | { type: "esp"; ok: boolean; raw?: string; error?: string; present?: boolean }
  | { type: "net"; iface: string; present: boolean; up: boolean; ip?: string | null; oper?: string | null }
  | { type: "redis"; ready: boolean }
  | { type: "scan"; code: string; path?: string }
  | { type: "scanner/open"; path?: string }
  | { type: "scanner/close"; path?: string }
  | { type: "scanner/error"; error: string; path?: string }
  | { type: "scanner/paths"; paths: string[] };

type ScannerPortState = {
  present: boolean;          // from SerialPort.list()
  open: boolean;             // runtime opened
  lastError: string | null;  // last error for this path
  lastScanTs: number | null; // last scan ts
};

const SSE_PATH = "/api/serial/events";

export function useSerialEvents() {
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [server, setServer] = useState<SimpleStatus>("offline");
  const [netIface, setNetIface] = useState<string | null>(null);
  const [netIp, setNetIp] = useState<string | null>(null);
  const [netPresent, setNetPresent] = useState<boolean>(false);
  const [netUp, setNetUp] = useState<boolean>(false);

  const [lastScan, setLastScan] = useState<string | null>(null);
  const [lastScanPath, setLastScanPath] = useState<string | null>(null);
  const [lastScanTick, setLastScanTick] = useState(0);     // ← increments every scan (even same code)
  const [lastScanAt, setLastScanAt] = useState<number | null>(null);

  const [scannerError, setScannerError] = useState<string | null>(null);
  const [paths, setPaths] = useState<string[]>([]);
  const [ports, setPorts] = useState<Record<string, ScannerPortState>>({});

  const [sseConnected, setSseConnected] = useState<boolean>(false);

  // internal refs
  const tickRef = useRef(0);
  const esRef = useRef<EventSource | null>(null);
  const espOkRef = useRef(false);
  const netUpRef = useRef(false);
  const redisOkRef = useRef(false);

  // derive server status from esp+redis (both must be OK)
  useEffect(() => {
    setServer(espOkRef.current && redisOkRef.current ? "connected" : "offline");
  }, []); // initial

  // helper: upsert a port record
  const up = (p: string, patch: Partial<ScannerPortState>) =>
    setPorts((prev) => {
      const cur: ScannerPortState =
        prev[p] ?? { present: false, open: false, lastError: null, lastScanTs: null };
      return { ...prev, [p]: { ...cur, ...patch } };
    });

  // sync presence for configured paths when device list changes
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

  // SSE wire-up (guard against StrictMode double-mounts)
  useEffect(() => {
    // close any existing (should be null normally)
    if (esRef.current) {
      try { esRef.current.close(); } catch {}
      esRef.current = null;
    }

    const es = new EventSource(SSE_PATH);
    esRef.current = es;

    es.onopen = () => setSseConnected(true);

    es.onmessage = (ev) => {
      let msg: SerialEvent | null = null;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (!msg || typeof msg !== "object" || !("type" in msg)) return;

      switch (msg.type) {
        case "devices":
          setDevices(Array.isArray(msg.devices) ? msg.devices : []);
          break;

        case "esp": {
          const ok = Boolean((msg as any).ok) || Boolean((msg as any).present);
          espOkRef.current = ok;
          setServer(espOkRef.current && redisOkRef.current ? "connected" : "offline");
          break;
        }

        case "net": {
          const upNow = Boolean(msg.up);
          netUpRef.current = upNow;
          // update last-known net snapshot
          setNetIface((msg as any).iface ?? null);
          setNetIp((msg as any).ip ?? null);
          setNetPresent(Boolean((msg as any).present));
          setNetUp(Boolean((msg as any).up));
          break;
        }

        case "redis": {
          const ready = Boolean((msg as any).ready);
          redisOkRef.current = ready;
          setServer(espOkRef.current && redisOkRef.current ? "connected" : "offline");
          break;
        }

        case "scanner/paths": {
          const list = Array.isArray(msg.paths) ? msg.paths.filter(Boolean) : [];
          setPaths((prev) => {
            const uniq = Array.from(new Set([...prev, ...list]));
            // ensure we have entries for each
            for (const p of uniq) up(p, {});
            return uniq;
          });
          break;
        }

        case "scanner/open": {
          if (msg.path) {
            up(msg.path, { open: true, lastError: null });
          } else {
            // mark first present-but-closed as open if path omitted
            setPorts((prev) => {
              const next = { ...prev };
              const key = Object.keys(next).find((k) => next[k].present && !next[k].open);
              if (key) next[key] = { ...next[key], open: true, lastError: null };
              return next;
            });
          }
          break;
        }

        case "scanner/close": {
          if (msg.path) {
            up(msg.path, { open: false });
          } else {
            // mark all closed if path omitted
            setPorts((prev) => {
              const next = { ...prev };
              for (const k of Object.keys(next)) next[k] = { ...next[k], open: false };
              return next;
            });
          }
          break;
        }

        case "scanner/error": {
          const err = String(msg.error || "Scanner error");
          setScannerError(err);
          if ((msg as any).path) up((msg as any).path!, { lastError: err });
          break;
        }

        case "scan": {
          // always advance tick so identical codes still trigger UI effects
          tickRef.current += 1;
          setLastScan(String(msg.code));
          setLastScanPath(msg.path ?? null);
          setLastScanAt(Date.now());
          setLastScanTick(tickRef.current);
          if (msg.path) up(msg.path, { lastScanTs: Date.now(), open: true, lastError: null });
          break;
        }

        default:
          // ignore
          break;
      }
    };

    es.onerror = () => {
      setSseConnected(false);
      // EventSource will auto-retry; we keep the instance open.
    };

    return () => {
      try { es.close(); } catch {}
      esRef.current = null;
      setSseConnected(false);
    };
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

  // small helper if caller wants to clear the last scan manually
  const clearLastScan = () => {
    setLastScan(null);
    setLastScanPath(null);
    setLastScanAt(null);
  };

  return {
    devices,
    server,
    netIface,
    netIp,
    netPresent,
    netUp,
    sseConnected,

    lastScan,
    lastScanPath,
    lastScanTick,  // ← use this in effects to react to every scan
    lastScanAt,

    scannerError,

    scannerPaths: paths,
    scannerPorts: ports, // map[path] -> ScannerPortState
    scannersDetected,
    scannersOpen,

    clearLastScan,
  };
}
