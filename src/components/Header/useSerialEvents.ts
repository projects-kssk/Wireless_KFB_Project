
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
  | { type: "redis"; ready: boolean; status?: string; detail?: { status?: string; lastEvent?: string; lastError?: string | null; lastAt?: number } }
  | { type: "scan"; code: string; path?: string }
  | { type: "scanner/open"; path?: string }
  | { type: "scanner/close"; path?: string }
  | { type: "scanner/error"; error: string; path?: string }
  | { type: "scanner/paths"; paths: string[] }
  | { type: "ev"; kind: 'P'|'L'|'DONE'; ch: number | null; val: number | null; ok?: boolean; mac?: string | null; raw?: string; ts?: number }
  | { type: "aliases/union"; mac: string; names?: Record<string,string>; normalPins?: number[]; latchPins?: number[] };

type ScannerPortState = {
  present: boolean;
  open: boolean;
  lastError: string | null;
  lastScanTs: number | null;
};

const SSE_PATH = "/api/serial/events";

export function useSerialEvents(macFilter?: string) {
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [server, setServer] = useState<SimpleStatus>("offline");
  const [netIface, setNetIface] = useState<string | null>(null);
  const [netIp, setNetIp] = useState<string | null>(null);
  const [netPresent, setNetPresent] = useState<boolean>(false);
  const [netUp, setNetUp] = useState<boolean>(false);

  const [lastScan, setLastScan] = useState<string | null>(null);
  const [lastScanPath, setLastScanPath] = useState<string | null>(null);
  const [lastScanTick, setLastScanTick] = useState(0);
  const [lastScanAt, setLastScanAt] = useState<number | null>(null);

  const [scannerError, setScannerError] = useState<string | null>(null);
  const [paths, setPaths] = useState<string[]>([]);
  const [ports, setPorts] = useState<Record<string, ScannerPortState>>({});
  const [redisReady, setRedisReady] = useState<boolean>(false);
  const [redisDetail, setRedisDetail] = useState<{ status?: string; lastEvent?: string; lastError?: string | null; lastAt?: number } | null>(null);
  const [lastEv, setLastEv] = useState<any>(null);
  const [lastEvTick, setLastEvTick] = useState(0);
  const [evCount, setEvCount] = useState(0);
  const [lastUnion, setLastUnion] = useState<{ mac: string; normalPins?: number[]; latchPins?: number[]; names?: Record<string,string> } | null>(null);

  const [sseConnected, setSseConnected] = useState<boolean>(false);

  const tickRef = useRef(0);
  const esRef = useRef<EventSource | null>(null);
  const unloadingRef = useRef<boolean>(false);
  const espOkRef = useRef(false);
  const netUpRef = useRef(false);
  const redisOkRef = useRef(false);
  const pendingRef = useRef<{ scan?: { code: string; path?: string }; ev?: any } | null>(null);
  const rafRef = useRef<number | null>(null);

  const flush = () => {
    const p = pendingRef.current;
    pendingRef.current = null;
    rafRef.current = null;
    if (!p) return;
    if (p.scan) {
      const { code, path } = p.scan;
      tickRef.current += 1;
      setLastScan(String(code));
      setLastScanPath(path ?? null);
      setLastScanAt(Date.now());
      setLastScanTick(tickRef.current);
      if (path) up(path, { lastScanTs: Date.now(), open: true, lastError: null });
    }
    if (p.ev) {
      try {
        if ((process.env.NEXT_PUBLIC_EV_LOG || '') === '1') console.log('[GUI] EV', p.ev);
      } catch {}
      setLastEv(p.ev);
      tickRef.current += 1;
      setLastEvTick(tickRef.current);
      setEvCount((c) => c + 1);
    }
  };
  const schedule = (patch: (p: any) => void) => {
    if (!pendingRef.current) pendingRef.current = {} as any;
    patch(pendingRef.current);
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(flush);
  };

  useEffect(() => {
    setServer(espOkRef.current && redisOkRef.current ? "connected" : "offline");
  }, []);

  const up = (p: string, patch: Partial<ScannerPortState>) =>
    setPorts((prev) => {
      const cur: ScannerPortState =
        prev[p] ?? { present: false, open: false, lastError: null, lastScanTs: null };
      return { ...prev, [p]: { ...cur, ...patch } };
    });

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

  useEffect(() => {
    const markUnloading = () => {
      unloadingRef.current = true;
      try { esRef.current?.close(); } catch {}
      esRef.current = null;
    };
    window.addEventListener('beforeunload', markUnloading);
    window.addEventListener('pagehide', markUnloading);
    return () => {
      window.removeEventListener('beforeunload', markUnloading);
      window.removeEventListener('pagehide', markUnloading);
    };
  }, []);

  useEffect(() => {
    if (esRef.current) {
      try { esRef.current.close(); } catch {}
      esRef.current = null;
    }

    const url = macFilter && macFilter.trim()
      ? `${SSE_PATH}?mac=${encodeURIComponent(macFilter.trim().toUpperCase())}`
      : SSE_PATH;
    const es = new EventSource(url);
    esRef.current = es;
    setEvCount(0);

    es.onopen = () => setSseConnected(true);

    es.onmessage = (ev) => {
      let msg: SerialEvent | null = null;
      try { msg = JSON.parse(ev.data); } catch { return; }
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
          const upNow = Boolean((msg as any).up);
          netUpRef.current = upNow;
          setNetIface((msg as any).iface ?? null);
          setNetIp((msg as any).ip ?? null);
          setNetPresent(Boolean((msg as any).present));
          setNetUp(upNow);
          break;
        }
        case "redis": {
          const ready = Boolean((msg as any).ready);
          redisOkRef.current = ready;
          setServer(espOkRef.current && redisOkRef.current ? "connected" : "offline");
          setRedisReady(ready);
          try { setRedisDetail((msg as any).detail ?? { status: (msg as any).status }); } catch {}
          break;
        }
        case "scanner/paths": {
          const list = Array.isArray(msg.paths) ? msg.paths.filter(Boolean) : [];
          setPaths((prev) => {
            const uniq = Array.from(new Set([...prev, ...list]));
            for (const p of uniq) up(p, {});
            return uniq;
          });
          break;
        }
        case "scanner/open": {
          if ((msg as any).path) up((msg as any).path!, { open: true, lastError: null });
          else {
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
          if ((msg as any).path) up((msg as any).path!, { open: false });
          else {
            setPorts((prev) => {
              const next = { ...prev };
              for (const k of Object.keys(next)) next[k] = { ...next[k], open: false };
              return next;
            });
          }
          break;
        }
        case "scanner/error": {
          const err = String((msg as any).error || "Scanner error");
          setScannerError(err);
          if ((msg as any).path) up((msg as any).path!, { lastError: err });
          break;
        }
        case "ev": {
          schedule((p) => { (p as any).ev = msg; });
          break;
        }
        case "aliases/union": {
          const m = msg as any;
          setLastUnion({ mac: String(m.mac||'').toUpperCase(), normalPins: Array.isArray(m.normalPins)?m.normalPins:undefined, latchPins: Array.isArray(m.latchPins)?m.latchPins:undefined, names: (m.names&&typeof m.names==='object')?m.names:undefined });
          break;
        }
        case "scan": {
          schedule((p) => { (p as any).scan = { code: String((msg as any).code), path: (msg as any).path ?? null }; });
          break;
        }
        default:
          break;
      }
    };

    es.onerror = () => {
      if (!unloadingRef.current) setSseConnected(false);
    };

    return () => {
      try { es.close(); } catch {}
      esRef.current = null;
      setSseConnected(false);
    };
  }, [macFilter]);

  const scannersDetected = useMemo(
    () => paths.filter((p) => ports[p]?.present).length,
    [paths, ports]
  );
  const scannersOpen = useMemo(
    () => paths.filter((p) => ports[p]?.open).length,
    [paths, ports]
  );

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
    lastScanTick,
    lastScanAt,

    scannerError,

    scannerPaths: paths,
    scannerPorts: ports,
    scannersDetected,
    scannersOpen,

    clearLastScan,

    redisReady,
    redisDetail,

    lastEv,
    lastEvTick,

    evCount,

    lastUnion,
  };
}

