"use client";
import { useEffect, useMemo, useRef, useState } from "react";
const SSE_PATH = "/api/serial/events";
export function useSerialEvents(macFilter) {
    const [devices, setDevices] = useState([]);
    const [server, setServer] = useState("offline");
    const [netIface, setNetIface] = useState(null);
    const [netIp, setNetIp] = useState(null);
    const [netPresent, setNetPresent] = useState(false);
    const [netUp, setNetUp] = useState(false);
    const [lastScan, setLastScan] = useState(null);
    const [lastScanPath, setLastScanPath] = useState(null);
    const [lastScanTick, setLastScanTick] = useState(0);
    const [lastScanAt, setLastScanAt] = useState(null);
    const [scannerError, setScannerError] = useState(null);
    const [paths, setPaths] = useState([]);
    const [ports, setPorts] = useState({});
    const [redisReady, setRedisReady] = useState(false);
    const [redisDetail, setRedisDetail] = useState(null);
    const [lastEv, setLastEv] = useState(null);
    const [lastEvTick, setLastEvTick] = useState(0);
    const [evCount, setEvCount] = useState(0);
    const [lastUnion, setLastUnion] = useState(null);
    const [sseConnected, setSseConnected] = useState(false);
    const tickRef = useRef(0);
    const esRef = useRef(null);
    const unloadingRef = useRef(false);
    const espOkRef = useRef(false);
    const netUpRef = useRef(false);
    const redisOkRef = useRef(false);
    const pendingRef = useRef(null);
    const rafRef = useRef(null);
    const flush = () => {
        const p = pendingRef.current;
        pendingRef.current = null;
        rafRef.current = null;
        if (!p)
            return;
        if (p.scan) {
            const { code, path } = p.scan;
            tickRef.current += 1;
            setLastScan(String(code));
            setLastScanPath(path ?? null);
            setLastScanAt(Date.now());
            setLastScanTick(tickRef.current);
            if (path)
                up(path, { lastScanTs: Date.now(), open: true, lastError: null });
        }
        if (p.ev) {
            try {
                if ((process.env.NEXT_PUBLIC_EV_LOG || '') === '1')
                    console.log('[GUI] EV', p.ev);
            }
            catch { }
            setLastEv(p.ev);
            tickRef.current += 1;
            setLastEvTick(tickRef.current);
            setEvCount((c) => c + 1);
        }
    };
    const schedule = (patch) => {
        if (!pendingRef.current)
            pendingRef.current = {};
        patch(pendingRef.current);
        if (rafRef.current != null)
            return;
        rafRef.current = requestAnimationFrame(flush);
    };
    useEffect(() => {
        setServer(espOkRef.current && redisOkRef.current ? "connected" : "offline");
    }, []);
    const up = (p, patch) => setPorts((prev) => {
        const cur = prev[p] ?? { present: false, open: false, lastError: null, lastScanTs: null };
        return { ...prev, [p]: { ...cur, ...patch } };
    });
    useEffect(() => {
        if (!paths.length)
            return;
        const present = new Set(devices.map((d) => d.path));
        setPorts((prev) => {
            const next = { ...prev };
            for (const p of paths) {
                const cur = next[p] ?? { present: false, open: false, lastError: null, lastScanTs: null };
                next[p] = { ...cur, present: present.has(p) };
            }
            return next;
        });
    }, [devices, paths]);
    useEffect(() => {
        const markUnloading = () => {
            unloadingRef.current = true;
            try {
                esRef.current?.close();
            }
            catch { }
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
            try {
                esRef.current.close();
            }
            catch { }
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
            let msg = null;
            try {
                msg = JSON.parse(ev.data);
            }
            catch {
                return;
            }
            if (!msg || typeof msg !== "object" || !("type" in msg))
                return;
            switch (msg.type) {
                case "devices":
                    setDevices(Array.isArray(msg.devices) ? msg.devices : []);
                    break;
                case "esp": {
                    const ok = Boolean(msg.ok) || Boolean(msg.present);
                    espOkRef.current = ok;
                    setServer(espOkRef.current && redisOkRef.current ? "connected" : "offline");
                    break;
                }
                case "net": {
                    const upNow = Boolean(msg.up);
                    netUpRef.current = upNow;
                    setNetIface(msg.iface ?? null);
                    setNetIp(msg.ip ?? null);
                    setNetPresent(Boolean(msg.present));
                    setNetUp(upNow);
                    break;
                }
                case "redis": {
                    const ready = Boolean(msg.ready);
                    redisOkRef.current = ready;
                    setServer(espOkRef.current && redisOkRef.current ? "connected" : "offline");
                    setRedisReady(ready);
                    try {
                        setRedisDetail(msg.detail ?? { status: msg.status });
                    }
                    catch { }
                    break;
                }
                case "scanner/paths": {
                    const list = Array.isArray(msg.paths) ? msg.paths.filter(Boolean) : [];
                    setPaths((prev) => {
                        const uniq = Array.from(new Set([...prev, ...list]));
                        for (const p of uniq)
                            up(p, {});
                        return uniq;
                    });
                    break;
                }
                case "scanner/open": {
                    if (msg.path)
                        up(msg.path, { open: true, lastError: null });
                    else {
                        setPorts((prev) => {
                            const next = { ...prev };
                            const key = Object.keys(next).find((k) => next[k].present && !next[k].open);
                            if (key)
                                next[key] = { ...next[key], open: true, lastError: null };
                            return next;
                        });
                    }
                    break;
                }
                case "scanner/close": {
                    if (msg.path)
                        up(msg.path, { open: false });
                    else {
                        setPorts((prev) => {
                            const next = { ...prev };
                            for (const k of Object.keys(next))
                                next[k] = { ...next[k], open: false };
                            return next;
                        });
                    }
                    break;
                }
                case "scanner/error": {
                    const err = String(msg.error || "Scanner error");
                    setScannerError(err);
                    if (msg.path)
                        up(msg.path, { lastError: err });
                    break;
                }
                case "ev": {
                    schedule((p) => { p.ev = msg; });
                    break;
                }
                case "aliases/union": {
                    const m = msg;
                    setLastUnion({ mac: String(m.mac || '').toUpperCase(), normalPins: Array.isArray(m.normalPins) ? m.normalPins : undefined, latchPins: Array.isArray(m.latchPins) ? m.latchPins : undefined, names: (m.names && typeof m.names === 'object') ? m.names : undefined });
                    break;
                }
                case "scan": {
                    schedule((p) => { p.scan = { code: String(msg.code), path: msg.path ?? null }; });
                    break;
                }
                default:
                    break;
            }
        };
        es.onerror = () => {
            if (!unloadingRef.current)
                setSseConnected(false);
        };
        return () => {
            try {
                es.close();
            }
            catch { }
            esRef.current = null;
            setSseConnected(false);
        };
    }, [macFilter]);
    const scannersDetected = useMemo(() => paths.filter((p) => ports[p]?.present).length, [paths, ports]);
    const scannersOpen = useMemo(() => paths.filter((p) => ports[p]?.open).length, [paths, ports]);
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
//# sourceMappingURL=useSerialEvents.js.map