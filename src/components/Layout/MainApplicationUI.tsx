"use client";

import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  FormEvent,
  startTransition,
} from "react";
import { m, AnimatePresence, useReducedMotion } from "framer-motion";
import type { Transition, Variants } from "framer-motion";
import { BranchDisplayData, KfbInfo, TestStatus } from "@/types/types";
import { Header } from "@/components/Header/Header";
import { BranchControlSidebar } from "@/components/Program/BranchControlSidebar";
import { SettingsPageContent } from "@/components/Settings/SettingsPageContent";
import { SettingsBranchesPageContent } from "@/components/Settings/SettingsBranchesPageContent";
import BranchDashboardMainContent from "@/components/Program/BranchDashboardMainContent";
import { useSerialEvents } from "@/components/Header/useSerialEvents";
import SettingsRightSidebar from "@/components/Settings/SettingsRightSidebar";
const DEBUG_LIVE = process.env.NEXT_PUBLIC_DEBUG_LIVE === '1'

async function hasSetupDataForMac(mac: string): Promise<boolean> {
  try {
    const rAll = await fetch(
      `/api/aliases?mac=${encodeURIComponent(mac)}&all=1`,
      { cache: "no-store" }
    );
    if (rAll.ok) {
      const j = await rAll.json();
      const items: Array<{
        aliases?: Record<string, string>;
        normalPins?: number[];
        latchPins?: number[];
      }> = Array.isArray(j?.items) ? j.items : [];
      const any = items.some((it) => {
        const a =
          it.aliases &&
          typeof it.aliases === "object" &&
          Object.keys(it.aliases).length > 0;
        const np = Array.isArray(it.normalPins) && it.normalPins.length > 0;
        const lp = Array.isArray(it.latchPins) && it.latchPins.length > 0;
        return !!(a || np || lp);
      });
      if (any) return true;
    }
    const rOne = await fetch(`/api/aliases?mac=${encodeURIComponent(mac)}`, {
      cache: "no-store",
    });
    if (rOne.ok) {
      const ju = await rOne.json();
      const a =
        ju &&
        typeof ju.aliases === "object" &&
        Object.keys(ju.aliases || {}).length > 0;
      const np = Array.isArray(ju?.normalPins) && ju.normalPins.length > 0;
      const lp = Array.isArray(ju?.latchPins) && ju.latchPins.length > 0;
      return !!(a || np || lp);
    }
  } catch {}
  return false;
}
const SIDEBAR_WIDTH = "24rem";
type MainView = "dashboard" | "settingsConfiguration" | "settingsBranches";
type OverlayKind = "success" | "error" | "scanning";
const isAcmPath = (p?: string | null) =>
  !p ||
  // Accept both ACM and USB-style serial paths
  /(^|\/)tty(ACM|USB)\d+$/.test(p) ||
  /(^|\/)(ACM|USB)\d+($|[^0-9])/.test(p) ||
  /\/by-id\/.*(ACM|USB)\d+/i.test(p);

function compileRegex(src: string | undefined, fallback: RegExp): RegExp {
  if (!src) return fallback;
  try {
    if (src.startsWith("/") && src.lastIndexOf("/") > 0) {
      const i = src.lastIndexOf("/");
      return new RegExp(src.slice(1, i), src.slice(i + 1));
    }
    return new RegExp(src);
  } catch (e) {
    console.warn("Invalid NEXT_PUBLIC_KFB_REGEX. Using fallback.", e);
    return fallback;
  }
}
const KFB_REGEX = compileRegex(
  process.env.NEXT_PUBLIC_KFB_REGEX,
  /^[A-Z0-9]{4}$/
);

const MAC_ONLY_REGEX = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i;
const canonicalMac = (raw: string): string | null => {
  const s = String(raw || "").trim();
  if (!s) return null;
  const hex = s.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
  if (hex.length !== 12) return null;
  const mac = hex.match(/.{1,2}/g)?.join(":") || "";
  return MAC_ONLY_REGEX.test(mac) ? mac : null;
};

const MainApplicationUI: React.FC = () => {
  const reduce = useReducedMotion();
  const fadeTransition: Transition = { duration: reduce ? 0 : 0.18 };
  const cardTransition: Transition = reduce
    ? { duration: 0 }
    : { type: "spring", stiffness: 260, damping: 20 };

  const bg: Variants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: fadeTransition },
    exit: { opacity: 0, transition: fadeTransition },
  };
  const card: Variants = {
    hidden: { scale: reduce ? 1 : 0.98, opacity: 0 },
    visible: {
      scale: 1,
      opacity: 1,
      transition: cardTransition,
    },
    exit: { scale: reduce ? 1 : 0.98, opacity: 0 },
  };
  const heading: Variants = {
    hidden: { y: reduce ? 0 : 6, opacity: 0 },
    visible: { y: 0, opacity: 1, transition: { duration: reduce ? 0 : 0.22 } },
  };

  const KIND_STYLES: Record<OverlayKind, string> = {
    error: "#ef4444",
    scanning: "#60a5fa",
    success: "#22c55e",
  };
  // UI state
  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(false);
  const [isSettingsSidebarOpen, setIsSettingsSidebarOpen] = useState(false);
  const [mainView, setMainView] = useState<MainView>("dashboard");
  const [session, setSession] = useState(0);
  const bumpSession = () => setSession((s) => s + 1);
  // Data / process state
  const [branchesData, setBranchesData] = useState<BranchDisplayData[]>([]);
  const [groupedBranches, setGroupedBranches] = useState<
    Array<{ ksk: string; branches: BranchDisplayData[] }>
  >([]);
  const [kfbNumber, setKfbNumber] = useState("");
  const [kfbInfo, setKfbInfo] = useState<KfbInfo | null>(null);
  const [macAddress, setMacAddress] = useState("");
  const [isScanning, setIsScanning] = useState(false);
  const [showScanUi, setShowScanUi] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<{ text: string; kind: 'info'|'error' } | null>(null);
  const scanResultTimerRef = useRef<number | null>(null);
  const showScanResult = (text: string, kind: 'info'|'error' = 'info', ms: number = 3000) => {
    try { if (scanResultTimerRef.current) clearTimeout(scanResultTimerRef.current); } catch {}
    setScanResult({ text, kind });
    scanResultTimerRef.current = window.setTimeout(() => { setScanResult(null); scanResultTimerRef.current = null; }, Math.max(0, ms));
  };
  const [nameHints, setNameHints] = useState<
    Record<string, string> | undefined
  >(undefined);
  const [normalPins, setNormalPins] = useState<number[] | undefined>(undefined);
  const [latchPins, setLatchPins] = useState<number[] | undefined>(undefined);
  const [activeKssks, setActiveKssks] = useState<string[]>([]);
  const [scanningError, setScanningError] = useState(false);
  const itemsAllFromAliasesRef = useRef<
    Array<{
      ksk: string;
      aliases?: Record<string, string>;
      normalPins?: number[];
      latchPins?: number[];
    }>
  >([]);
  const lastGroupsRef = useRef<
    Array<{ ksk: string; branches: BranchDisplayData[] }>
  >([]);
  useEffect(() => {
    lastGroupsRef.current = groupedBranches;
  }, [groupedBranches]);
  const finalizeOkGuardRef = useRef<Set<string>>(new Set());
  // Check flow
  const [checkFailures, setCheckFailures] = useState<number[] | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  // Reflect isChecking in a ref for async handlers
  const isCheckingRef = useRef(false);
  useEffect(() => {
    isCheckingRef.current = isChecking;
  }, [isChecking]);

  // Helper: compute active pins strictly from items for the currently active KSK ids
  const computeActivePins = useCallback(
    (
      items: Array<{ ksk?: string; kssk?: string; normalPins?: number[]; latchPins?: number[] }> | undefined,
      activeIds: string[] | undefined
    ): { normal: number[]; latch: number[] } => {
      const ids = new Set((activeIds || []).map((s) => String(s).trim()));
      const n = new Set<number>();
      const l = new Set<number>();
      if (Array.isArray(items) && ids.size) {
        for (const it of items) {
          const id = String(((it as any)?.ksk ?? (it as any)?.kssk) || '').trim();
          if (!id || !ids.has(id)) continue;
          if (Array.isArray(it.normalPins))
            for (const p of it.normalPins) {
              const x = Number(p);
              if (Number.isFinite(x) && x > 0) n.add(x);
            }
          if (Array.isArray(it.latchPins))
            for (const p of it.latchPins) {
              const x = Number(p);
              if (Number.isFinite(x) && x > 0) l.add(x);
            }
        }
      }
      const norm = Array.from(n).sort((a, b) => a - b);
      const lat = Array.from(l).sort((a, b) => a - b);
      return { normal: norm, latch: lat };
    },
    []
  );
  // Simplified flow: no UI polling; show OK for a few seconds, then hide
  const [awaitingRelease, setAwaitingRelease] = useState(false); // deprecated
  const [showRemoveCable, setShowRemoveCable] = useState(false); // deprecated

  // Settings flow
  const [currentConfigIdForProgram, setCurrentConfigIdForProgram] = useState<
    number | null
  >(null);

  // KFB input (from scanner or manual)
  const [kfbInput, setKfbInput] = useState("");
  const kfbInputRef = useRef(kfbInput);
  const isScanningRef = useRef(isScanning);
  useEffect(() => {
    kfbInputRef.current = kfbInput;
  }, [kfbInput]);
  useEffect(() => {
    isScanningRef.current = isScanning;
  }, [isScanning]);

  // Overlay
  const [overlay, setOverlay] = useState<{
    open: boolean;
    kind: OverlayKind;
    code: string;
  }>({
    open: false,
    kind: "success",
    code: "",
  });
  const showOverlay = (kind: OverlayKind, code: string) => {
    if (kind === "error") { setErrorMsg(code || "Error"); return; }
    if (kind === "scanning") { return; }
    setOverlay({ open: true, kind, code });
  };
  const hideOverlaySoon = (ms = 700) => {
    const t = setTimeout(() => setOverlay((o) => ({ ...o, open: false })), ms);
    return () => clearTimeout(t);
  };
  const OK_OVERLAY_MS = Math.max(
    400,
    Number(process.env.NEXT_PUBLIC_OK_OVERLAY_MS ?? "1200")
  );
  const lastScanRef = useRef("");
  const [okOverlayActive, setOkOverlayActive] = useState(false);
  const [okAnimationTick, setOkAnimationTick] = useState(0);

  const okResetTimerRef = useRef<number | null>(null);
  const scheduleOkReset = (ms = 1500) => {
    if (okResetTimerRef.current) clearTimeout(okResetTimerRef.current);
    okResetTimerRef.current = window.setTimeout(() => {
      handleResetKfb();
      okResetTimerRef.current = null;
    }, ms + 100);
  };
  // Forced reset path that cannot be canceled by cancelOkReset()
  const forceResetDoneRef = useRef(false);
  const forceResetTimer1Ref = useRef<number | null>(null);
  const forceResetTimer2Ref = useRef<number | null>(null);
  const forceResetOnce = (primaryMs = 700, fallbackMs = 2200) => {
    if (forceResetDoneRef.current) return;
    const fire = () => {
      if (forceResetDoneRef.current) return;
      forceResetDoneRef.current = true;
      try {
        setOverlay((o) => ({ ...o, open: false }));
      } catch {}
      handleResetKfb();
      if (forceResetTimer1Ref.current)
        clearTimeout(forceResetTimer1Ref.current);
      if (forceResetTimer2Ref.current)
        clearTimeout(forceResetTimer2Ref.current);
      forceResetTimer1Ref.current = null;
      forceResetTimer2Ref.current = null;
    };
    if (forceResetTimer1Ref.current == null)
      forceResetTimer1Ref.current = window.setTimeout(
        fire,
        Math.max(0, primaryMs)
      );
    if (forceResetTimer2Ref.current == null)
      forceResetTimer2Ref.current = window.setTimeout(
        fire,
        Math.max(primaryMs + 500, fallbackMs)
      );
  };
  const cancelOkReset = () => {
    if (okResetTimerRef.current) {
      clearTimeout(okResetTimerRef.current);
      okResetTimerRef.current = null;
    }
  };

  const [okFlashTick, setOkFlashTick] = useState(0);
  const [okSystemNote, setOkSystemNote] = useState<string | null>(null);
  const [disableOkAnimation, setDisableOkAnimation] = useState(false);
  const [suppressLive, setSuppressLive] = useState(false);
  const retryTimerRef = useRef<number | null>(null);
  const clearRetryTimer = () => {
    if (retryTimerRef.current != null) {
      try {
        clearTimeout(retryTimerRef.current);
      } catch {}
      retryTimerRef.current = null;
    }
  };
  const scanOverlayTimerRef = useRef<number | null>(null);
  const startScanOverlayTimeout = (ms = Math.max(1000, Number(process.env.NEXT_PUBLIC_SCAN_OVERLAY_MS ?? '3000'))) => {
    if (scanOverlayTimerRef.current != null) {
      try {
        clearTimeout(scanOverlayTimerRef.current);
      } catch {}
      scanOverlayTimerRef.current = null;
    }
    scanOverlayTimerRef.current = window.setTimeout(() => {
      scanOverlayTimerRef.current = null;
      setOverlay((o) => ({ ...o, open: false }));
    }, ms);
  };
  const clearScanOverlayTimeout = () => {
    if (scanOverlayTimerRef.current != null) {
      try {
        clearTimeout(scanOverlayTimerRef.current);
      } catch {}
      scanOverlayTimerRef.current = null;
    }
  };

  const serial = useSerialEvents(
    suppressLive || !(macAddress && macAddress.trim())
      ? "00:00:00:00:00:00"
      : (macAddress || "").toUpperCase()
  );

  // Log when live stream starts/stops based on mac + suppression
  const liveStateRef = useRef<string>("off");
  const lastLiveMacRef = useRef<string | null>(null);
  useEffect(() => {
    const hasMac = !!(macAddress && macAddress.trim());
    const on = hasMac && !suppressLive && mainView === 'dashboard';
    const next = on ? 'on' : 'off';
    if (next !== liveStateRef.current) {
      liveStateRef.current = next;
      try {
        if (on) {
          lastLiveMacRef.current = (macAddress || '').toUpperCase();
          if (DEBUG_LIVE) console.log('[LIVE] START', { mac: lastLiveMacRef.current });
        } else {
          if (DEBUG_LIVE) console.log('[LIVE] STOP');
          // On STOP, best-effort clear for the last live MAC if we didn't finalise
          const target = lastLiveMacRef.current;
          if (target && !(macAddress && macAddress.trim())) {
            (async () => {
              try {
                // Send checkpoint for all KSKs before clearing Redis
                try {
                  const r = await fetch(`/api/aliases?mac=${encodeURIComponent(target)}&all=1`, { cache: 'no-store' });
                  if (r.ok) {
                    const j = await r.json();
                    const items: any[] = Array.isArray(j?.items) ? j.items : [];
                    const ids = Array.from(new Set(items
                      .map((it: any) => String(((it?.ksk ?? it?.kssk) || '')).trim())
                      .filter(Boolean)));
                    if (ids.length) {
                      try { console.log('[FLOW][CHECKPOINT] STOP path: sending for all ids', { mac: target, count: ids.length }); } catch {}
                      await sendCheckpointForMac(target, ids).catch(() => {});
                    } else {
                      try { console.log('[FLOW][CHECKPOINT] STOP path: no ids found; skipping'); } catch {}
                    }
                  }
                } catch {}
                await fetch('/api/aliases/clear', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ mac: target }),
                }).catch(() => {});
                await clearKskLocksFully(target).catch(() => {});
                try { console.log('[CLEANUP] Done for MAC', { mac: target }); } catch {}
              } finally {
                lastLiveMacRef.current = null;
              }
            })();
          }
        }
      } catch {}
    }
  }, [macAddress, suppressLive, mainView]);
  const lastScan = serial.lastScan;
  const lastScanPath = (serial as any).lastScanPath as
    | string
    | null
    | undefined;
  const DASH_SCANNER_INDEX = Number(
    process.env.NEXT_PUBLIC_SCANNER_INDEX_DASHBOARD ?? "0"
  );
  const pathsEqual = (a?: string | null, b?: string | null) => {
    if (!a || !b) return false;
    if (a === b) return true;
    const ta = a.split("/").pop() || a;
    const tb = b.split("/").pop() || b;
    if (ta === tb || a.endsWith(tb) || b.endsWith(ta)) return true;
    // Heuristic: match ACM/USB numeric suffixes (e.g., ttyACM1 vs by-id/...ACM1)
    const num = (s: string) => {
      const m = s.match(/(ACM|USB)(\d+)/i);
      return m ? `${m[1].toUpperCase()}${m[2]}` : null;
    };
    const na = num(a) || num(ta);
    const nb = num(b) || num(tb);
    return !!(na && nb && na === nb);
  };
  const resolveDesiredPath = (): string | null => {
    const list = serial.scannerPaths || [];
    if (list[DASH_SCANNER_INDEX]) return list[DASH_SCANNER_INDEX] || null;
    return null;
  };
  const desiredPath = resolveDesiredPath();
  const desiredTail = (desiredPath || "").split("/").pop() || desiredPath || "";
  const desiredPortState = (() => {
    const map = serial.scannerPorts || ({} as any);
    const key = Object.keys(map).find((k) => pathsEqual(k, desiredPath || ""));
    return key
      ? ((map as any)[key] as { open: boolean; present: boolean })
      : null;
  })();

  const prevRedisReadyRef = useRef<boolean | null>(null);
  const [redisDegraded, setRedisDegraded] = useState(false);
  const redisReadyRef = useRef<boolean>(false);
  const redisDropTimerRef = useRef<number | null>(null);
  const lastRedisDropAtRef = useRef<number | null>(null);
  const macRef = useRef<string>("");
  useEffect(() => {
    redisReadyRef.current = !!(serial as any).redisReady;
  }, [(serial as any).redisReady]);
  useEffect(() => {
    macRef.current = (macAddress || "").toUpperCase();
  }, [macAddress]);
  useEffect(() => {
    try {
      const ready = !!(serial as any).redisReady;
      const prev = prevRedisReadyRef.current;
      prevRedisReadyRef.current = ready;
      if (prev === null) return; // first sample
      // Debounce drops: configurable and faster by default
      const DEBOUNCE_MS = Math.max(300, Number(process.env.NEXT_PUBLIC_REDIS_DROP_DEBOUNCE_MS ?? '900'));
      if (prev === true && ready === false) {
        if (redisDropTimerRef.current == null) {
          lastRedisDropAtRef.current = Date.now();
          const detail = (serial as any).redisDetail || {};
          console.warn('[REDIS] redisReady dropped', { debounceMs: DEBOUNCE_MS, detail });
          redisDropTimerRef.current = window.setTimeout(() => {
            redisDropTimerRef.current = null;
            if (!redisReadyRef.current) {
              const ms = lastRedisDropAtRef.current
                ? Date.now() - lastRedisDropAtRef.current
                : undefined;
              console.warn('[REDIS] degraded mode ON (redisReady=false)', { waitedMs: ms, lastEvent: (serial as any).redisDetail?.lastEvent, lastError: (serial as any).redisDetail?.lastError });
              setRedisDegraded(true);
            } else {
              console.log(
                "[REDIS] recovered before debounce window; staying normal"
              );
            }
          }, DEBOUNCE_MS);
        }
      }
      // Recovery: clear any pending timer, log recovery
      if (prev === false && ready === true) {
        if (redisDropTimerRef.current != null) {
          try {
            clearTimeout(redisDropTimerRef.current);
          } catch {}
          redisDropTimerRef.current = null;
        }
        const msDown = lastRedisDropAtRef.current
          ? Date.now() - lastRedisDropAtRef.current
          : undefined;
        lastRedisDropAtRef.current = null;
        console.log('[REDIS] redisReady back to true (degraded OFF)', { downMs: msDown, lastEvent: (serial as any).redisDetail?.lastEvent });
        setRedisDegraded(false);
      }
    } catch {}
  }, [(serial as any).redisReady, macAddress]);

  const CLEAR_LOCAL_ALIAS =
    String(process.env.NEXT_PUBLIC_ALIAS_CLEAR_ON_READY || "").trim() === "1";
  useEffect(() => {
    const u = (serial as any).lastUnion as {
      mac?: string;
      normalPins?: number[];
      latchPins?: number[];
      names?: Record<string, string>;
    } | null;
    if (!u) return;
    if (suppressLive) return; // hard gate: ignore union updates after OK
    const cur = (macAddress || "").toUpperCase();
    if (!cur || String(u.mac || "").toUpperCase() !== cur) return;
    try {
      const np = Array.isArray(u.normalPins) ? u.normalPins.length : 0;
      const lp = Array.isArray(u.latchPins) ? u.latchPins.length : 0;
      const nm =
        u.names && typeof u.names === "object"
          ? Object.keys(u.names).length
          : 0;
      if (redisDegraded && np === 0 && lp === 0 && nm === 0) {
        console.log("[SSE][UNION] skipped empty union during degraded mode");
        return;
      }
      console.log("[SSE][UNION] update for current MAC", {
        normalPins: np,
        latchPins: lp,
        names: nm,
      });
      // IMPORTANT: restrict pins to currently active KSKs (stations locks)
      const actIds = (lastActiveIdsRef.current && lastActiveIdsRef.current.length)
        ? lastActiveIdsRef.current
        : activeKssks;
      const fromItems = computeActivePins(itemsAllFromAliasesRef.current as any, actIds);
      setNormalPins(fromItems.normal);
      setLatchPins(fromItems.latch);
      if (u.names && typeof u.names === "object") setNameHints(u.names as any);
    } catch {}
  }, [serial.lastUnion, macAddress, redisDegraded, suppressLive, activeKssks, computeActivePins]);

  // On recovery from degraded mode, rehydrate and refresh union for current MAC
  useEffect(() => {
    if (redisDegraded) return;
    if (suppressLive) return; // hard gate during post-OK
    const mac = (macAddress || "").toUpperCase();
    if (!mac) return;
    (async () => {
      try {
        console.log("[REDIS] recovery: rehydrate + union refresh", { mac });
        await fetch("/api/aliases/rehydrate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mac }),
        }).catch(() => {});
        const r = await fetch(`/api/aliases?mac=${encodeURIComponent(mac)}`, {
          cache: "no-store",
        });
        if (r.ok) {
          const j = await r.json();
          if (Array.isArray(j?.normalPins))
            setNormalPins(j.normalPins as number[]);
          if (Array.isArray(j?.latchPins))
            setLatchPins(j.latchPins as number[]);
          if (j?.aliases && typeof j.aliases === "object")
            setNameHints(j.aliases as Record<string, string>);
        }
      } catch {}
    })();
  }, [redisDegraded, macAddress, suppressLive]);

  useEffect(() => {
    if (suppressLive) return; // hard gate: ignore SSE after OK is latched
    const ev = (serial as any).lastEv as {
      kind?: string;
      mac?: string | null;
      line?: string;
      raw?: string;
      ok?: any;
    } | null;
    if (!ev) return;

    const raw = String(ev.line ?? ev.raw ?? "");
    const kind = String(ev.kind || "").toUpperCase();
    const ok =
      (/\bRESULT\b/i.test(raw) && /\b(SUCCESS|OK)\b/i.test(raw)) ||
      String(ev.ok).toLowerCase() === "true";
    const ZERO = "00:00:00:00:00:00";
    const current = (macAddress || "").toUpperCase();
    let evMac = String(ev.mac || "").toUpperCase();
    if (!evMac || evMac === ZERO) {
      const macs =
        raw.toUpperCase().match(/([0-9A-F]{2}(?::[0-9A-F]{2}){5})/g) || [];
      evMac = macs.find((m) => m !== ZERO) || "";
    }
    const matches = !evMac || evMac === ZERO || evMac === current;
    try {
      if (matches || kind === "DONE") {
        console.log("[SSE] event", {
          kind,
          ok,
          evMac,
          matches,
          line: raw?.slice(0, 120),
        });
      }
    } catch {}

    if ((kind === "RESULT" || kind === "DONE") && ok && matches) {
      try {
        console.log("[FLOW][SUCCESS] SSE RESULT/DONE ok for current MAC", {
          evMac,
          kind,
        });
      } catch {}
      setSuppressLive(true);
      setBranchesData((prev) =>
        prev.map((b) => ({ ...b, testStatus: "ok" as const }))
      );
      setCheckFailures([]);
      setIsChecking(false);
      setIsScanning(false);
      setOkFlashTick((t) => t + 1);
      setOverlay((o) => ({ ...o, open: false }));
      const mac = (macAddress || "").toUpperCase();
      if (mac) {
        void finalizeOkForMac(mac);
      }
    }
  }, [serial.lastEvTick, macAddress, suppressLive]);

  useEffect(() => {
    if (isScanning || isChecking) {
      okForcedRef.current = false;
      return;
    }
    try {
      const ev: any = (serial as any).lastEv;
      const cur = (macAddress || "").toUpperCase();
      if (ev && cur) {
        const evMac = String(ev.mac || "").toUpperCase();
        const ZERO = "00:00:00:00:00:00";
        const raw = String(ev.line || ev.raw || "");
        const kindRaw = String(ev.kind || "").toUpperCase();
        const isResult = /\bRESULT\b/i.test(raw) || kindRaw === "RESULT";
        const isFailText = /\bFAIL(?:URE)?\b/i.test(raw);
        const isDoneFail =
          kindRaw === "DONE" && String(ev.ok).toLowerCase() === "false";
        const macMatch =
          !evMac ||
          evMac === ZERO ||
          evMac === cur ||
          /reply\s+from\s+([0-9A-F]{2}(?::[0-9A-F]{2}){5})/i.test(raw);
        if (macMatch && (isDoneFail || (isResult && isFailText))) return; // abort force OK
      }
    } catch {}
    if (okForcedRef.current) return;
    const anyFailures =
      Array.isArray(checkFailures) && checkFailures.length > 0;
    if (anyFailures) return;
    const flatOk =
      Array.isArray(branchesData) &&
      branchesData.length > 0 &&
      branchesData.every((b) => b.testStatus === "ok");
    const groupedOk =
      Array.isArray(groupedBranches) &&
      groupedBranches.length > 0 &&
      groupedBranches.every(
        (g) =>
          g.branches.length > 0 &&
          g.branches.every((b) => b.testStatus === "ok")
      );
    if (flatOk || groupedOk) {
      try {
        console.log("[FLOW][SUCCESS] derived success path (no failures)");
      } catch {}
      clearScanOverlayTimeout();
      setOverlay((o) => ({ ...o, open: false }));
      okForcedRef.current = true;
      setSuppressLive(true);
      setOkFlashTick((t) => t + 1);
      const macUp = (macAddress || "").toUpperCase();
      if (macUp) {
        void finalizeOkForMac(macUp);
        return;
      }
      // No MAC available to finalize; skip clearing/reset to avoid losing Redis state
      console.log("[FLOW][SUCCESS] no mac bound; skipping finalize/reset");
      return;
    }
  }, [branchesData, groupedBranches, checkFailures, isScanning, isChecking]);

  useEffect(() => {
    let stop = false;
    const stationId = (process.env.NEXT_PUBLIC_STATION_ID || "").trim();
    if (!stationId) return;
    const tick = async () => {
      try {
        const r = await fetch(
          `/api/ksk-lock?stationId=${encodeURIComponent(stationId)}&include=aliases`,
          { cache: "no-store" }
        );
        if (!r.ok) return;
        const j = await r.json();
        const rows: Array<{
          ksk?: string;
          kssk?: string;
          mac?: string;
          aliases?: Record<string, string>;
          normalPins?: number[];
          latchPins?: number[];
        }> = Array.isArray(j?.locks) ? j.locks : [];
        const ids: string[] = rows
          .map((l) => String((l as any).ksk ?? (l as any).kssk))
          .filter(Boolean);
        if (!stop && ids.length) {
          setActiveKssks((prev) =>
            Array.from(new Set<string>([...prev, ...ids]))
          );
        }
      } catch {}
    };
    tick();
    const h = setInterval(tick, 5000);
    return () => {
      stop = true;
      clearInterval(h);
    };
  }, []);

  const lastHandledScanRef = useRef<string>("");
  const scanDebounceRef = useRef<number>(0);
  const lastErrorStampRef = useRef<number>(0);
  const scanInFlightRef = useRef<boolean>(false);
  const okForcedRef = useRef<boolean>(false);
  const pendingScansRef = useRef<string[]>([]);
  const enqueueScan = useCallback((raw: string) => {
    const code = String(raw || "")
      .trim()
      .toUpperCase();
    if (!code) return;
    const q = pendingScansRef.current;
    if (q.length === 0 || q[q.length - 1] !== code) q.push(code);
    if (q.length > 5) q.splice(0, q.length - 5);
  }, []);
  const handleScanRef = useRef<(code: string) => void | Promise<void>>(
    () => {}
  );

  // Clears all timers and resets state after OK finalisation.
  const handleResetKfb = useCallback(() => {
    // Cancel forced reset timers
    forceResetDoneRef.current = false;
    if (forceResetTimer1Ref.current) {
      clearTimeout(forceResetTimer1Ref.current);
      forceResetTimer1Ref.current = null;
    }
    if (forceResetTimer2Ref.current) {
      clearTimeout(forceResetTimer2Ref.current);
      forceResetTimer2Ref.current = null;
    }
    // Cancel OK overlay auto-reset
    cancelOkReset?.();
    // Cancel any retry or scan overlay timers
    clearRetryTimer();
    clearScanOverlayTimeout();

    // Close overlay
    setOverlay((o) => ({ ...o, open: false }));
    // Reset flashing OK and system note
    setOkFlashTick(0);
    setOkSystemNote(null);
    setDisableOkAnimation(false);
    // Clear error/scanning state
    setErrorMsg(null);
    setScanningError(false);

    // Clear the UI data
    setKfbNumber("");
    setKfbInfo(null);
    setBranchesData([]);
    setGroupedBranches([]);
    setActiveKssks([]);
    setNameHints(undefined);
    setNormalPins(undefined);
    setLatchPins(undefined);

    // Reset MAC and re-enable live updates
    setMacAddress("");
    setSuppressLive(false);

    // Reset pending scans and flags
    pendingScansRef.current = [];
    scanInFlightRef.current = false;
    okForcedRef.current = false;
    isCheckingRef.current = false;
    setIsChecking(false);
    setIsScanning(false);

    // Reset tracking variables
    lastHandledScanRef.current = "";
    scanDebounceRef.current = 0;
    lastScanRef.current = "";
    finalizeOkGuardRef.current.clear?.();
    skippedFirstSseRef.current = false;

    // Bump session to force re-render; this puts us back in the "Please scan barcode" state.
    bumpSession();
  }, []);

  // ===== Krosy checkpoint integration =====
  const CHECKPOINT_URL =
    process.env.NEXT_PUBLIC_KROSY_URL_CHECKPOINT_ONLINE ||
    "/api/krosy/checkpoint";
  const KROSY_TARGET = process.env.NEXT_PUBLIC_KROSY_XML_TARGET || "ksskkfb01";
  const KROSY_SOURCE =
    process.env.NEXT_PUBLIC_KROSY_SOURCE_HOSTNAME || KROSY_TARGET;
  const IP_ONLINE = (process.env.NEXT_PUBLIC_KROSY_IP_ONLINE || "").trim();
  const IP_OFFLINE = (process.env.NEXT_PUBLIC_KROSY_IP_OFFLINE || "").trim();
  const [krosyLive, setKrosyLive] = useState(
    String(process.env.NEXT_PUBLIC_KROSY_ONLINE) === "true"
  );
  useEffect(() => {
    (async () => {
      try {
        const idUrl =
          process.env.NEXT_PUBLIC_KROSY_IDENTITY_URL || "/api/krosy/checkpoint";
        const r = await fetch(idUrl, {
          headers: { Accept: "application/json" },
          cache: "no-store",
        });
        if (!r.ok) return;
        const j = await r.json();
        const ip = String(j?.ip || "").trim();
        if (ip && IP_ONLINE && ip === IP_ONLINE) setKrosyLive(true);
        else if (ip && IP_OFFLINE && ip === IP_OFFLINE) setKrosyLive(false);
      } catch {}
    })();
  }, []);
  const checkpointSentRef = useRef<Set<string>>(new Set());
  const checkpointMacSentRef = useRef<Set<string>>(new Set());
  const checkpointMacPendingRef = useRef<Set<string>>(new Set());
  const checkpointBlockUntilTsRef = useRef<number>(0);
  // Track last active KSK ids from CHECK
  const lastActiveIdsRef = useRef<string[]>([]);

  const sendCheckpointForMac = useCallback(
    async (mac: string, onlyIds?: string[]) => {
      const MAC = mac.toUpperCase();
      // Backoff if the checkpoint endpoint recently failed
      if (Date.now() < (checkpointBlockUntilTsRef.current || 0)) {
        try {
          console.warn('[FLOW][CHECKPOINT] suppressed due to recent failure backoff');
        } catch {}
        return;
      }
      if (checkpointMacSentRef.current.has(MAC)) return;
      if (checkpointMacPendingRef.current.has(MAC)) return; // NEW
      checkpointMacPendingRef.current.add(MAC); // NEW
      try {
        try {
          console.log('[FLOW][CHECKPOINT] preparing', { mac: MAC, onlyIds: onlyIds && onlyIds.length ? onlyIds : undefined });
        } catch {}
        const rList = await fetch(
          `/api/aliases?mac=${encodeURIComponent(MAC)}&all=1`,
          { cache: "no-store" }
        );
        if (!rList.ok) return;
        const j = await rList.json();
        const items: any[] = Array.isArray(j?.items) ? j.items : [];
        let ids = items
          .map((it) => String((it.ksk ?? it.kssk) || "").trim())
          .filter(Boolean);

        if (onlyIds && onlyIds.length) {
          const want = new Set(onlyIds.map((s) => s.toUpperCase()));
          ids = ids.filter((id) => want.has(id.toUpperCase()));
          if (ids.length === 0 && items.length) {
            // fallback to first discovered id
            const firstId = String((((items[0] as any)?.ksk ?? (items[0] as any)?.kssk) ?? '')).trim();
            ids = [firstId].filter(Boolean) as string[];
          }
        } else if (ids.length > 1) {
          ids = [ids[0]]; // simplest: only first when no active list
        }

        let sent = false;
        for (const id of ids) {
          if (checkpointSentRef.current.has(id)) continue;
          // try to include workingDataXml if available
          let workingDataXml: string | null = null;
          try {
            const rXml = await fetch(
              `/api/aliases/xml?mac=${encodeURIComponent(MAC)}&kssk=${encodeURIComponent(id)}`,
              { cache: "no-store" }
            );
            if (rXml.ok) workingDataXml = await rXml.text();
          } catch {}
          const payload =
            workingDataXml && workingDataXml.trim()
              ? { requestID: "1", workingDataXml }
              : {
                  requestID: "1",
                  intksk: id,
                  sourceHostname: KROSY_SOURCE,
                  targetHostName: KROSY_TARGET,
                };
          // Force an OK result so checkpoint logs reflect success
          (payload as any).forceResult = true;

          try {
            const resp = await fetch(CHECKPOINT_URL, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
              },
              body: JSON.stringify(payload),
            });
            if (!resp.ok) {
              // Backoff on 5xx errors to avoid repeated noisy posts
              if (resp.status >= 500) {
                checkpointBlockUntilTsRef.current = Date.now() + 120_000; // 2 minutes
                try {
                  console.warn('[FLOW][CHECKPOINT] server error; enabling backoff', { status: resp.status });
                } catch {}
              }
            } else {
              checkpointSentRef.current.add(id);
              sent = true;
              try {
                console.log('[FLOW][CHECKPOINT] sent OK checkpoint', { mac: MAC, ksk: id });
              } catch {}
            }
          } catch (e) {
            // Network error — enable backoff briefly
            checkpointBlockUntilTsRef.current = Date.now() + 60_000; // 1 minute
            try { console.warn('[FLOW][CHECKPOINT] network error; backoff enabled'); } catch {}
          }
        }
        if (sent) checkpointMacSentRef.current.add(MAC);
      } finally {
        checkpointMacPendingRef.current.delete(MAC); // NEW
      }
    },
    [CHECKPOINT_URL, KROSY_SOURCE, KROSY_TARGET]
  );
  async function clearKskLocksFully(mac: string): Promise<boolean> {
    const MAC = mac.toUpperCase();
    const qs = (o: Record<string, string>) => new URLSearchParams(o).toString();

    for (let i = 0; i < 3; i++) {
      try {
        console.log("[REDIS][LOCKS] pass", i + 1, "DELETE /api/ksk-lock?", {
          mac: MAC,
          force: 1,
        });
      } catch {}
      await fetch(`/api/ksk-lock?${qs({ mac: MAC, force: "1" })}`, {
        method: "DELETE",
      }).catch(() => {});
      await new Promise((r) => setTimeout(r, 150));
      const v = await fetch(`/api/ksk-lock`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      const left = Array.isArray(v?.locks)
        ? v.locks.filter((x: any) => String(x?.mac || "").toUpperCase() === MAC)
            .length
        : 0;
      try {
        console.log("[REDIS][LOCKS] remaining for MAC", { mac: MAC, left });
      } catch {}
      if (left === 0) return true;
    }
    return false;
  }

  const finalizeOkForMac = useCallback(
    async (rawMac: string) => {
      // Normalise and guard against double-finalising
      const mac = String(rawMac || "")
        .trim()
        .toUpperCase();
      if (!mac) {
        handleResetKfb();
        return;
      }
      if (finalizeOkGuardRef.current.has(mac)) return;
      finalizeOkGuardRef.current.add(mac);

      try {
        // Show the OK overlay and disable live updates
        setOverlay({ open: true, kind: "success", code: "" });
        setSuppressLive(true);
        try { if (DEBUG_LIVE) console.log('[LIVE] OFF → OK latched; suppressing live updates'); } catch {}

        // Drop any displayed identifiers to avoid stale "Live: on" badges
        setMacAddress("");
        setKfbNumber("");

        // Remember this MAC for a post-reset sanity cleanup
        try { lastFinalizedMacRef.current = mac; } catch {}

        // If we have setup data for this MAC, send a checkpoint even in offline mode
        const hasSetup = await hasSetupDataForMac(mac).catch(() => false);
        if (hasSetup) {
          const ids = (lastActiveIdsRef.current && lastActiveIdsRef.current.length)
            ? lastActiveIdsRef.current
            : (activeKssks || []);
          try { console.log('[FLOW][CHECKPOINT] finalising with ids', ids); } catch {}
          await sendCheckpointForMac(mac, ids).catch(
            () => {}
          );
          setOkSystemNote("Checkpoint sent; cache cleared");
        } else {
          try { console.log('[FLOW][CHECKPOINT] skip (no setup data found for MAC)'); } catch {}
          setOkSystemNote("Cache cleared");
        }

        // Clear aliases and KSK locks with retries
        const tryClearAliases = async () => {
          await fetch("/api/aliases/clear", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mac }),
          }).catch(() => {});
        };
        const verifyAliasesEmpty = async (): Promise<boolean> => {
          try {
            const r = await fetch(
              `/api/aliases?mac=${encodeURIComponent(mac)}&all=1`,
              {
                cache: "no-store",
              }
            );
            if (!r.ok) return false;
            const j = await r.json();
            return Array.isArray(j?.items) ? j.items.length === 0 : false;
          } catch {
            return false;
          }
        };
        await tryClearAliases();
        let clearOk = await verifyAliasesEmpty();
        for (let i = 0; !clearOk && i < 2; i++) {
          await new Promise((res) => setTimeout(res, 250));
          await tryClearAliases();
          clearOk = await verifyAliasesEmpty();
        }

        // Clear KSK locks
        let locksCleared = await clearKskLocksFully(mac);
        for (let i = 0; !locksCleared && i < 2; i++) {
          await new Promise((res) => setTimeout(res, 250));
          locksCleared = await clearKskLocksFully(mac);
        }
        // Fallback: if stationId is configured, also clear station-wide locks
        try {
          const sid = (process.env.NEXT_PUBLIC_STATION_ID || process.env.STATION_ID || '').trim();
          if (sid) {
            await fetch('/api/ksk-lock', {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ stationId: sid, mac, force: 1 }),
            }).catch(() => {});
          }
        } catch {}

        // Final verification loop: ensure aliases are empty
        try {
          const maxTry = 5;
          for (let i = 0; i < maxTry; i++) {
            const r = await fetch(`/api/aliases?mac=${encodeURIComponent(mac)}&all=1`, { cache: 'no-store' }).catch(() => null);
            const ok = !!r && r.ok;
            const j = ok ? await r!.json().catch(() => null) : null;
            const items = Array.isArray(j?.items) ? j.items : [];
            if (ok && items.length === 0) break;
            await tryClearAliases();
            await new Promise((res) => setTimeout(res, 300));
          }
        } catch {}
      } finally {
        // Always reset UI at the end
        finalizeOkGuardRef.current.delete(mac);
        handleResetKfb();
      }
    },
    [
      hasSetupDataForMac,
      krosyLive,
      sendCheckpointForMac,
      handleResetKfb,
      clearKskLocksFully,
    ]
  );

  // Post-reset sanity cleanup: when on scan view and idle, ensure Redis state is empty for lastFinalizedMac
  useEffect(() => {
    const mac = lastFinalizedMacRef.current;
    if (!mac) return;
    const onScanView = mainView === 'dashboard' && !(macAddress && macAddress.trim());
    if (!onScanView) return;
    if (isScanning || isChecking) return;
    (async () => {
      try {
        console.log('[REDIS][SANITY] post-reset cleanup for', mac);
        await fetch('/api/aliases/clear', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mac }),
        }).catch(() => {});
        await clearKskLocksFully(mac).catch(() => {});
      } finally {
        lastFinalizedMacRef.current = null;
      }
    })();
  }, [mainView, macAddress, isScanning, isChecking]);

  // After returning to scan view, perform one last sanity clear for the last finalised MAC
  const lastFinalizedMacRef = useRef<string | null>(null);
  useEffect(() => {
    // Update lastFinalizedMacRef when finalisation starts
    // (We hook this in via finalizeOkForMac by setting ref there)
  }, []);


  // Add this useEffect inside MainApplicationUI, near other useEffects
  useEffect(() => {
    // Ignore events while suppressLive is true, which happens during finalisation.
    if (suppressLive) return;
    const ev = (serial as any).lastEv as {
      kind?: string;
      mac?: string | null;
      line?: string;
      raw?: string;
      ok?: any;
    } | null;
    if (!ev) return;

    const raw = String(ev.line ?? ev.raw ?? "");
    const kind = String(ev.kind || "").toUpperCase();
    const ok =
      (/\bRESULT\b/i.test(raw) && /\b(SUCCESS|OK)\b/i.test(raw)) ||
      String(ev.ok).toLowerCase() === "true";
    const ZERO = "00:00:00:00:00:00";
    const current = (macAddress || "").toUpperCase();
    let evMac = String(ev.mac || "").toUpperCase();
    if (!evMac || evMac === ZERO) {
      // Parse MAC from the raw line if not provided
      const macs =
        raw.toUpperCase().match(/([0-9A-F]{2}(?::[0-9A-F]{2}){5})/g) || [];
      evMac = macs.find((m) => m !== ZERO) || "";
    }
    const matches = !evMac || evMac === ZERO || evMac === current;

    if ((kind === "RESULT" || kind === "DONE") && ok && matches) {
      // Mark all branches OK and stop scanning/checking
      setBranchesData((prev) =>
        prev.map((b) => ({ ...b, testStatus: "ok" as const }))
      );
      setCheckFailures([]);
      setIsChecking(false);
      setIsScanning(false);
      setOkFlashTick((t) => t + 1);
      setOverlay((o) => ({ ...o, open: false }));
      // Immediately finalise and reset the UI
      finalizeOkForMac(evMac || current);
    }
  }, [serial.lastEvTick, macAddress, suppressLive, finalizeOkForMac]);

  // Trigger finalisation immediately on a successful RESULT or DONE event.
  useEffect(() => {
    // Ignore events during finalisation (we disable live updates with suppressLive).
    if (suppressLive) return;
    const ev = (serial as any).lastEv as {
      kind?: string;
      mac?: string | null;
      line?: string;
      raw?: string;
      ok?: any;
    } | null;
    if (!ev) return;

    const raw = String(ev.line ?? ev.raw ?? "");
    const kind = String(ev.kind || "").toUpperCase();
    // An event is considered OK if the "ok" field is truthy or the line contains "SUCCESS" or "OK".
    const ok =
      (/\bRESULT\b/i.test(raw) && /\b(SUCCESS|OK)\b/i.test(raw)) ||
      String(ev.ok).toLowerCase() === "true";
    const ZERO = "00:00:00:00:00:00";
    const current = (macAddress || "").toUpperCase();

    // Determine the MAC for the event; fallback to parsing from the raw line if needed.
    let evMac = String(ev.mac || "").toUpperCase();
    if (!evMac || evMac === ZERO) {
      const macs =
        raw.toUpperCase().match(/([0-9A-F]{2}(?::[0-9A-F]{2}){5})/g) || [];
      evMac = macs.find((m) => m !== ZERO) || "";
    }

    // Only act if the MAC matches the current device or is empty/zero.
    const matches = !evMac || evMac === ZERO || evMac === current;

    if ((kind === "RESULT" || kind === "DONE") && ok && matches) {
      // Mark all displayed branches as OK and stop scanning/checking.
      setBranchesData((prev) =>
        prev.map((b) => ({ ...b, testStatus: "ok" as const }))
      );
      setCheckFailures([]);
      setIsChecking(false);
      setIsScanning(false);
      setOkFlashTick((t) => t + 1);
      setOverlay((o) => ({ ...o, open: false }));

      // Immediately finalise the MAC (clears Redis, sends checkpoint, resets the UI).
      finalizeOkForMac(evMac || current);
    }
  }, [serial.lastEvTick, macAddress, suppressLive, finalizeOkForMac]);

  const runCheck = useCallback(
    async (mac: string, attempt: number = 0, pins?: number[]) => {
      if (!mac) return;

      setIsChecking(true);
      setScanningError(false);
      setCheckFailures(null);
      setShowRemoveCable(false);
      setAwaitingRelease(false);

      try {
        console.log("[FLOW][CHECK] start", {
          mac,
          attempt,
          pinsCount: pins?.length || 0,
        });
        try { console.log('[FLOW] State → checking'); } catch {}
        const clientBudget = Number(
          process.env.NEXT_PUBLIC_CHECK_CLIENT_TIMEOUT_MS ?? "5000"
        );
        const ctrl = new AbortController();
        const tAbort = setTimeout(
          () => ctrl.abort(),
          Math.max(1000, clientBudget)
        );

        const res = await fetch("/api/serial/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(pins && pins.length ? { mac, pins } : { mac }),
          signal: ctrl.signal,
        });
        clearTimeout(tAbort);
        const result = await res.json();
        try {
          if (Array.isArray((result as any)?.pinsUsed))
            console.log(
              "[FLOW][CHECK] used pins",
              (result as any).pinsUsed,
              "mode",
              (result as any)?.sendMode
            );
        } catch {}

        if (res.ok) {
          console.log("[FLOW][CHECK] response OK", {
            failures: (result?.failures || []).length,
            unknownFailure: !!result?.unknownFailure,
          });
          // Cache active KSK IDs for targeted checkpoint
          try {
            const activeIds: string[] = Array.isArray(
              (result as any)?.itemsActive
            )
              ? (result as any).itemsActive
                  .map((it: any) =>
                    String(((it as any).ksk ?? (it as any).kssk) || "").trim()
                  )
                  .filter(Boolean)
              : [];
            lastActiveIdsRef.current = activeIds;
            if (activeIds.length)
              console.log("[FLOW][CHECK] cached active KSKs", activeIds);
          } catch {}
          clearRetryTimer();
          const failures: number[] = result.failures || [];
          const unknown = result?.unknownFailure === true;
          const hints =
            result?.nameHints && typeof result.nameHints === "object"
              ? (result.nameHints as Record<string, string>)
              : undefined;
          setNameHints(hints);
          try {
            const n = Array.isArray(result?.normalPins)
              ? (result.normalPins as number[])
              : undefined;
            const l = Array.isArray(result?.latchPins)
              ? (result.latchPins as number[])
              : undefined;
            setNormalPins(n);
            setLatchPins(l);
          } catch {}
          setCheckFailures(failures);
          startTransition(() =>
            setBranchesData((_prev) => {
              const macUp = mac.toUpperCase();
              let aliases: Record<string, string> = {};
              const itemsPref = Array.isArray((result as any)?.itemsActive)
                ? (result as any).itemsActive
                : Array.isArray((result as any)?.items)
                  ? (result as any).items
                  : null;
              if (itemsPref) {
                const mergeAliases = (
                  items: Array<{ aliases: Record<string, string> }>
                ) => {
                  const merged: Record<string, string> = {};
                  for (const it of items) {
                    for (const [pin, name] of Object.entries(
                      it.aliases || {}
                    )) {
                      if (!merged[pin]) merged[pin] = name;
                      else if (merged[pin] !== name)
                        merged[pin] = `${merged[pin]} / ${name}`;
                    }
                  }
                  return merged;
                };
                aliases = mergeAliases(
                  itemsPref as Array<{ aliases: Record<string, string> }>
                );
              }
              if (!aliases || Object.keys(aliases).length === 0) {
                const mergeAliases = (
                  items: Array<{ aliases: Record<string, string> }>
                ) => {
                  const merged: Record<string, string> = {};
                  for (const it of items) {
                    for (const [pin, name] of Object.entries(
                      it.aliases || {}
                    )) {
                      if (!merged[pin]) merged[pin] = name;
                      else if (merged[pin] !== name)
                        merged[pin] = `${merged[pin]} / ${name}`;
                    }
                  }
                  return merged;
                };
                let merged: Record<string, string> = {};
                if (result?.items && Array.isArray(result.items)) {
                  merged = mergeAliases(
                    result.items as Array<{ aliases: Record<string, string> }>
                  );
                } else if (
                  result?.aliases &&
                  typeof result.aliases === "object"
                ) {
                  merged = result.aliases as Record<string, string>;
                }
                aliases = merged;
              }
              const pins = Object.keys(aliases)
                .map((n) => Number(n))
                .filter((n) => Number.isFinite(n));
              pins.sort((a, b) => a - b);
              const contactless = new Set<number>(
                (Array.isArray(result?.latchPins)
                  ? (result.latchPins as number[])
                  : latchPins || []
                ).filter((n: number) => Number.isFinite(n)) as number[]
              );
              const flat = pins.map((pin) => ({
                id: String(pin),
                branchName: aliases[String(pin)] || `PIN ${pin}`,
                testStatus: failures.includes(pin)
                  ? ("nok" as TestStatus)
                  : contactless.has(pin)
                    ? ("not_tested" as TestStatus)
                    : ("ok" as TestStatus),
                pinNumber: pin,
                kfbInfoValue: undefined,
                isLatch: contactless.has(pin),
              }));
          const itemsActiveArr = Array.isArray((result as any)?.itemsActive)
            ? ((result as any).itemsActive as Array<{
                ksk?: string;
                kssk?: string;
                aliases: Record<string, string>;
                latchPins?: number[];
              }>)
            : [];
          let itemsAllArr = Array.isArray((result as any)?.items)
            ? ((result as any).items as Array<{
                ksk?: string;
                kssk?: string;
                aliases: Record<string, string>;
                normalPins?: number[];
                latchPins?: number[];
              }>)
            : [];
          // Restrict to currently active KSK ids when available
          const activeSet = new Set<string>((activeKssks || []).map((s) => String(s).trim()))
          const filt = (arr: any[]) =>
            activeSet.size
              ? arr.filter((it) => activeSet.has(String(((it as any).ksk ?? (it as any).kssk) || '').trim()))
              : arr;
          const itemsActiveArrF = filt(itemsActiveArr);
          const itemsAllArrF = filt(itemsAllArr);
          // If there are no active KSKs, avoid showing any passed groups or unions
          if (activeSet.size === 0) {
            setGroupedBranches([]);
            setActiveKssks([]);
          }
              const byIdMap = new Map<
                string,
                {
                  ksk: string;
                  aliases: Record<string, string>;
                  normalPins?: number[];
                  latchPins?: number[];
                }
              >();
              for (const it of [...itemsAllArrF, ...itemsActiveArrF]) {
                const id = String(
                  ((it as any).ksk ?? (it as any).kssk) || ""
                ).trim();
                if (!id) continue;
                if (!byIdMap.has(id))
                  byIdMap.set(id, {
                    ksk: id,
                    aliases: it.aliases || {},
                    normalPins: (it as any).normalPins,
                    latchPins: (it as any).latchPins,
                  });
              }
              for (const it of itemsAllFromAliasesRef.current || []) {
                const id = String(
                  ((it as any).ksk ?? (it as any).kssk) || ""
                ).trim();
                if (!id || byIdMap.has(id)) continue;
                byIdMap.set(id, {
                  ksk: id,
                  aliases: (it.aliases as any) || {},
                  normalPins: it.normalPins,
                  latchPins: it.latchPins,
                });
              }
              const items = Array.from(byIdMap.values());
              if (items.length) {
                // Build raw groups and then de-duplicate by KSK and pin
                const groupsRaw: Array<{
                  ksk: string;
                  branches: BranchDisplayData[];
                }> = [];
                for (const it of items) {
                  const a = it.aliases || {};
                  // Strictly use explicit active pin arrays
                  const set = new Set<number>();
                  if (Array.isArray((it as any)?.normalPins))
                    for (const n of (it as any).normalPins) {
                      const x = Number(n);
                      if (Number.isFinite(x) && x > 0) set.add(x);
                    }
                  if (Array.isArray((it as any)?.latchPins))
                    for (const n of (it as any).latchPins) {
                      const x = Number(n);
                      if (Number.isFinite(x) && x > 0) set.add(x);
                    }
                  const pinsG = Array.from(set).sort((x, y) => x - y);
                  // Use group-specific latchPins when present
                  const contactless = new Set<number>(
                    (Array.isArray((it as any)?.latchPins)
                      ? (it as any).latchPins
                      : latchPins || []
                    ).filter((n: number) => Number.isFinite(n)) as number[]
                  );
                  const branchesG = pinsG.map((pin) => {
                    const nameRaw = a[String(pin)] || aliases[String(pin)] || '';
                    const name = String(nameRaw || '').startsWith('CL_')
                      ? String(nameRaw)
                      : `PIN ${pin}`;
                    return {
                      id: `${it.ksk}:${pin}`,
                      branchName: name,
                      testStatus: failures.includes(pin)
                        ? ("nok" as TestStatus)
                        : contactless.has(pin)
                          ? ("not_tested" as TestStatus)
                          : ("ok" as TestStatus),
                      pinNumber: pin,
                      kfbInfoValue: undefined,
                      isLatch: contactless.has(pin),
                    } as BranchDisplayData;
                  });
                  groupsRaw.push({
                    ksk: String(((it as any).ksk ?? (it as any).kssk) || ""),
                    branches: branchesG,
                  });
                }
                const byId = new Map<string, BranchDisplayData[]>();
                for (const g of groupsRaw) {
                  const id = String(g.ksk).trim().toUpperCase();
                  const prev = byId.get(id) || [];
                  const merged = [...prev, ...g.branches];
                  const seen = new Set<number>();
                  const dedup = merged.filter((b) => {
                    const p =
                      typeof b.pinNumber === "number" ? b.pinNumber : NaN;
                    if (!Number.isFinite(p)) return true;
                    if (seen.has(p)) return false;
                    seen.add(p);
                    return true;
                  });
                  byId.set(id, dedup);
                }
                const groups: Array<{
                  ksk: string;
                  branches: BranchDisplayData[];
                }> = Array.from(byId.entries())
                  .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
                  .map(([k, branches]) => ({ ksk: k, branches }));
                // Add any failure pins that are not present in any group as an extra synthetic group
                const knownPinsSet = new Set<number>();
                for (const g of groups)
                  for (const b of g.branches)
                    if (typeof b.pinNumber === "number")
                      knownPinsSet.add(b.pinNumber);
                const extraPins = failures.filter(
                  (p: number) => Number.isFinite(p) && !knownPinsSet.has(p)
                );
                if (extraPins.length) {
                  const extraBranches = extraPins.map(
                    (pin) =>
                      ({
                        id: `CHECK:${pin}`,
                        branchName: `PIN ${pin}`,
                        testStatus: "nok" as TestStatus,
                        pinNumber: pin,
                        kfbInfoValue: undefined,
                      }) as BranchDisplayData
                  );
                  groups.push({ ksk: "CHECK", branches: extraBranches });
                }
                // Merge with any previously shown groups if API dropped some
                const prev = lastGroupsRef.current || [];
                const have = new Set(groups.map((g) => g.ksk));
                const mergedGroups = [...groups];
                for (const g of prev) {
                  if (!have.has(g.ksk)) mergedGroups.push(g);
                }
                setGroupedBranches(mergedGroups);
                setActiveKssks(mergedGroups.map((g) => g.ksk).filter(Boolean));
                // Also use union of all group pins for flat list
                const unionMap: Record<number, string> = {};
                for (const g of groups)
                  for (const b of g.branches)
                    if (typeof b.pinNumber === "number")
                      unionMap[b.pinNumber] = b.branchName;
                const unionPins = Object.keys(unionMap)
                  .map((n) => Number(n))
                  .sort((x, y) => x - y);
                const contactless = new Set<number>(
                  (latchPins || []).filter((n) =>
                    Number.isFinite(n)
                  ) as number[]
                );
                return unionPins.map((pin) => ({
                  id: String(pin),
                  branchName: unionMap[pin] || `PIN ${pin}`,
                  testStatus: failures.includes(pin)
                    ? ("nok" as TestStatus)
                    : contactless.has(pin)
                      ? ("not_tested" as TestStatus)
                      : ("ok" as TestStatus),
                  pinNumber: pin,
                  kfbInfoValue: undefined,
                }));
              } else {
                setGroupedBranches([]);
                setActiveKssks([]);
              }
              // No grouped items: include any failure pins not in alias map as synthetic entries
              const knownFlat = new Set<number>(pins);
              const extras = failures.filter(
                (p: number) => Number.isFinite(p) && !knownFlat.has(p)
              );
              return extras.length
                ? [
                    ...flat,
                    ...extras.map(
                      (pin: number) =>
                        ({
                          id: String(pin),
                          branchName: `PIN ${pin}`,
                          testStatus: "nok" as TestStatus,
                          pinNumber: pin,
                          kfbInfoValue: undefined,
                        }) as BranchDisplayData
                    ),
                  ]
                : flat;
            })
          );

          if (!unknown && failures.length === 0) {
            // Success: close SCANNING overlay immediately and flash OK
            clearScanOverlayTimeout();
            setOverlay((o) => ({ ...o, open: false }));
            okForcedRef.current = true;
            setSuppressLive(true);
            setOkFlashTick((t) => t + 1); // show OK in child
            // Run finalization (checkpoint if live + clear Redis/locks + Live off)
            await finalizeOkForMac(mac);
            return;
          } else {
            const rawLine =
              typeof (result as any)?.raw === "string"
                ? String((result as any).raw)
                : null;
            const msg =
              rawLine ||
              (unknown
                ? "CHECK failure (no pin list)"
                : `Failures: ${failures.join(", ")}`);
            const nowErr = Date.now();
            if (nowErr - lastErrorStampRef.current > 800) {
              showOverlay("error", msg);
              lastErrorStampRef.current = nowErr;
            }
            setAwaitingRelease(false);
          }
          if (!(failures.length === 0 && !unknown)) hideOverlaySoon();
        } else {
          try {
            console.warn("[FLOW][CHECK] non-OK status", { status: res.status });
          } catch {}
          // Distinguish no-result timeouts from other errors
          const maxRetries = Math.max(
            0,
            Number(process.env.NEXT_PUBLIC_CHECK_RETRY_COUNT ?? "1")
          );
          if (res.status === 429) {
            // Server busy (per-MAC lock). Retry shortly without showing an error.
            if (attempt < maxRetries + 2) {
              clearRetryTimer();
              retryTimerRef.current = window.setTimeout(() => {
                retryTimerRef.current = null;
                void runCheck(mac, attempt + 1, pins);
              }, 350);
            } else {
              console.warn("CHECK busy (429) too many retries");
            }
          } else if (
            res.status === 504 ||
            result?.pending === true ||
            String(result?.code || "").toUpperCase() === "NO_RESULT"
          ) {
            // Quick retry a couple of times to shave latency without long waits
            // Quick retry a couple of times to shave latency without long waits
            if (attempt < maxRetries) {
              clearRetryTimer();
              retryTimerRef.current = window.setTimeout(() => {
                retryTimerRef.current = null;
                void runCheck(mac, attempt + 1, pins);
              }, 250);
            } else {
              console.warn("CHECK pending/no-result");
              setScanningError(true);
              setDisableOkAnimation(true);
              showScanResult("ERROR", "error", 3000);
              clearScanOverlayTimeout();
              // Reset view back to default scan state shortly after showing error (preserve MAC)
              setTimeout(() => {
                handleResetKfb();
                setGroupedBranches([]);
                setActiveKssks([]);
                setNameHints(undefined);
              }, 1300);
            }
          } else {
            console.error("CHECK error:", result);
            setScanningError(true);
            setDisableOkAnimation(true);
            showScanResult("ERROR", "error", 3000);
            clearScanOverlayTimeout();
            // Reset view back to default scan state shortly after showing error (preserve MAC)
            setTimeout(() => {
              handleResetKfb();
              setGroupedBranches([]);
              setActiveKssks([]);
              setNameHints(undefined);
            }, 1300);
          }
          setAwaitingRelease(false);
          if (!(res.status === 504 && attempt < 2)) hideOverlaySoon();
        }
      } catch (err) {
        if ((err as any)?.name === "AbortError") {
          const maxRetries = Math.max(
            0,
            Number(process.env.NEXT_PUBLIC_CHECK_RETRY_COUNT ?? "1")
          );
          if (attempt < 1 || attempt < maxRetries) {
            clearRetryTimer();
            retryTimerRef.current = window.setTimeout(() => {
              retryTimerRef.current = null;
              void runCheck(mac, attempt + 1, pins);
            }, 300);
          } else {
            setScanningError(true);
            showScanResult("ERROR", "error", 3000);
            clearScanOverlayTimeout();
            hideOverlaySoon();
            setTimeout(() => {
              handleResetKfb();
              setGroupedBranches([]);
              setActiveKssks([]);
              setNameHints(undefined);
            }, 1300);
          }
        } else {
          console.error("CHECK error", err);
          showScanResult("ERROR", "error", 3000);
          setDisableOkAnimation(true);
          setAwaitingRelease(false);
          clearScanOverlayTimeout();
          hideOverlaySoon();
          setTimeout(() => {
            handleResetKfb();
            setGroupedBranches([]);
            setActiveKssks([]);
            setNameHints(undefined);
          }, 1300);
        }
      } finally {
        console.log("[FLOW][CHECK] end");
        clearRetryTimer();
        setIsChecking(false);
      }
    },
    []
  );

  // ----- LOAD + MONITOR + AUTO-CHECK FOR A SCAN -----
  const loadBranchesData = useCallback(
    async (value?: string, source: "scan" | "manual" = "scan") => {
      try {
        console.log("[FLOW][LOAD] start", {
          source,
          value: (value ?? kfbInputRef.current).trim(),
        });
      } catch {}
      cancelOkReset();
      setOkFlashTick(0);
      setDisableOkAnimation(false);
      try { console.log('[FLOW] State → scanning'); } catch {}
      const kfbRaw = (value ?? kfbInputRef.current).trim();
      if (!kfbRaw) return;
      const normalized = kfbRaw.toUpperCase();
      const macCanon = canonicalMac(normalized);
      const isMac = !!macCanon;
      if (!isMac && !KFB_REGEX.test(normalized)) {
        // For scans, avoid intrusive overlays; surface as inline error
        setErrorMsg(
          source === "manual"
            ? "Invalid code. Expected MAC like AA:BB:CC:DD:EE:FF"
            : `Invalid code: ${normalized}`
        );
        console.warn("[FLOW][SCAN] rejected by patterns", { normalized });
        return;
      }
      lastScanRef.current = normalized;
      if (source === "scan") {
        // No intrusive scanning overlay; keep UI minimal
        setShowScanUi(true);
      }
      setIsScanning(true);
      try { console.log('[FLOW] State → scanning'); } catch {}
      setErrorMsg(null);
      setKfbInfo(null);
      setCheckFailures(null);
      setShowRemoveCable(false);
      setAwaitingRelease(false);

      try {
        const mac = isMac ? (macCanon as string) : normalized; // use normalized MAC when available
        // If switching to a new MAC, best-effort clear previous MAC leftovers
        try {
          const prevMac = (macAddress || "").toUpperCase();
          const nextMac = String(mac).toUpperCase();
          if (prevMac && prevMac !== nextMac) {
            console.log("[FLOW][SCAN] switching MAC; clearing previous", {
              prevMac,
            });
            await fetch("/api/aliases/clear", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ mac: prevMac }),
            }).catch(() => {});
            await clearKskLocksFully(prevMac).catch(() => {});
            try {
              setActiveKssks([]);
            } catch {}
            try {
              itemsAllFromAliasesRef.current = [];
            } catch {}
            try {
              lastActiveIdsRef.current = [];
            } catch {}
          }
        } catch {}
        try {
          console.log("[FLOW][LOAD] accepted input", {
            type: isMac ? "mac" : "kfb",
            macOrKfb: mac,
          });
        } catch {}
        setKfbNumber(mac);
        setMacAddress(mac);

        let aliases: Record<string, string> = {};
        let hadGroups = false;
        let pins: number[] = [];
        // Determine the currently active KSK ids for this MAC from Redis locks
        let activeIds: string[] = await (async () => {
          try {
            const r = await fetch('/api/ksk-lock', { cache: 'no-store' });
            if (!r.ok) return [] as string[];
            const j = await r.json();
            const rows: Array<{ ksk?: string; kssk?: string; mac?: string }> = Array.isArray(j?.locks) ? j.locks : [];
            const MAC = mac.toUpperCase();
            const list = rows
              .filter((l) => String(l?.mac || '').toUpperCase() === MAC)
              .map((l) => String((l as any).ksk ?? (l as any).kssk).trim())
              .filter(Boolean);
            const uniq = Array.from(new Set(list));
            try { console.log('[ACTIVE] KSK ids from locks', { mac: MAC, ids: uniq }); } catch {}
            return uniq;
          } catch {
            return [] as string[];
          }
        })();
        // Respect per-MAC max three; if more leak in, keep first three deterministically
        if (activeIds.length > 3) activeIds = activeIds.slice(0, 3);
        if (activeIds.length) setActiveKssks(activeIds);
        {
          try {
            try {
              console.log("[FLOW][LOAD] POST /api/aliases/rehydrate", { mac });
              await fetch("/api/aliases/rehydrate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ mac }),
              }).catch(() => {});
              console.log("[FLOW][LOAD] rehydrate done");
            } catch {}
            const rAll = await fetch(
              `/api/aliases?mac=${encodeURIComponent(mac)}&all=1`,
              { cache: "no-store" }
            );
            if (rAll.ok) {
              const jAll = await rAll.json();
              const items = Array.isArray(jAll?.items)
                ? (jAll.items as Array<{
                    aliases?: Record<string, string>;
                    normalPins?: number[];
                    latchPins?: number[];
                    ksk?: string;
                    kssk?: string;
                  }>)
                : [];
              try {
                itemsAllFromAliasesRef.current = items as any;
              } catch {}

              // Filter items strictly to currently active KSK ids; when none, treat as none
              const itemsFiltered = activeIds.length
                ? items.filter((it: any) => activeIds.includes(String((it.ksk ?? it.kssk) || '').trim()))
                : [];

              if (itemsFiltered.length) {
                try {
                  console.log("[FLOW][LOAD] aliases snapshot items", {
                    count: itemsFiltered.length,
                  });
                } catch {}
                const groupsRaw = itemsFiltered.map((it: any) => {
                  const a = it.aliases || {};
                  // Strictly use explicit active pin arrays (normal + latch)
                  const set = new Set<number>();
                  if (Array.isArray(it.normalPins))
                    for (const n of it.normalPins) {
                      const x = Number(n);
                      if (Number.isFinite(x) && x > 0) set.add(x);
                    }
                  if (Array.isArray(it.latchPins))
                    for (const n of it.latchPins) {
                      const x = Number(n);
                      if (Number.isFinite(x) && x > 0) set.add(x);
                    }
                  const pins = Array.from(set).sort((a, b) => a - b);
                  const idStr = String(
                    ((it as any).ksk ?? (it as any).kssk) || ""
                  );
                  const branches = pins.map((pin) => {
                    const nameRaw = a[String(pin)] || aliases[String(pin)] || '';
                    const name = String(nameRaw || '').startsWith('CL_')
                      ? String(nameRaw)
                      : `PIN ${pin}`;
                    return {
                      id: `${idStr}:${pin}`,
                      branchName: name,
                      testStatus: "not_tested" as TestStatus,
                      pinNumber: pin,
                      kfbInfoValue: undefined,
                    } as BranchDisplayData;
                  });
                  return { ksk: idStr, branches };
                });
                const byId = new Map<string, BranchDisplayData[]>();
                for (const g of groupsRaw) {
                  const id = String(g.ksk).trim().toUpperCase();
                  const prev = byId.get(id) || [];
                  const merged = [...prev, ...g.branches];
                  const seen = new Set<number>();
                  const dedup = merged.filter((b) => {
                    const p =
                      typeof b.pinNumber === "number" ? b.pinNumber : NaN;
                    if (!Number.isFinite(p)) return true;
                    if (seen.has(p)) return false;
                    seen.add(p);
                    return true;
                  });
                  byId.set(id, dedup);
                }
                const groups = Array.from(byId.entries())
                  .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
                  .map(([k, branches]) => ({ ksk: k, branches }));
                setGroupedBranches(groups);
                // Do NOT derive active ids from aliases; only trust locks
                hadGroups = groups.length > 0;
                try {
                  console.log("[FLOW][LOAD] groupedBranches built", {
                    groups: groups.map((g) => ({
                      ksk: g.ksk,
                      pins: g.branches.map((b) => b.pinNumber),
                    })),
                  });
                } catch {}
              }

              const pinSet = new Set<number>();
              for (const it of itemsFiltered) {
                if (Array.isArray(it.normalPins))
                  for (const n of it.normalPins)
                    if (Number.isFinite(n) && n > 0) pinSet.add(Number(n));
                if (Array.isArray(it.latchPins))
                  for (const n of it.latchPins)
                    if (Number.isFinite(n) && n > 0) pinSet.add(Number(n));
              }
              if (pinSet.size && pins.length === 0)
                pins = Array.from(pinSet).sort((x, y) => x - y);
              // Do not include global union when no active KSKs; only trust active maps
              if (activeIds.length) {
                try {
                  console.log("[FLOW][LOAD] GET union /api/aliases", { mac });
                  const rUnion = await fetch(
                    `/api/aliases?mac=${encodeURIComponent(mac)}`,
                    { cache: "no-store" }
                  );
                  if (rUnion.ok) {
                    const jU = await rUnion.json();
                    const aU =
                      jU?.aliases && typeof jU.aliases === "object"
                        ? (jU.aliases as Record<string, string>)
                        : {};
                    if (Object.keys(aU).length) {
                      aliases = aU;
                    }
                    try {
                      // Restrict pins strictly to active KSKs
                      const filtered = computeActivePins(itemsFiltered as any, activeIds);
                      setNormalPins(filtered.normal);
                      setLatchPins(filtered.latch);
                      pins = Array.from(new Set([...filtered.normal, ...filtered.latch])).sort((a, b) => a - b);
                      console.log("[FLOW][LOAD] active pins (filtered)", {
                        normalPins: filtered.normal.length,
                        latchPins: filtered.latch.length,
                        totalPins: pins.length,
                      });
                    } catch {}
                  }
                } catch {}
              }
            }
          } catch {}
        }
        const noAliases = !aliases || Object.keys(aliases).length === 0;
        const noPins = !Array.isArray(pins) || pins.length === 0;
        const noGroups = !hadGroups;
        if (noAliases && noPins && noGroups) {
          try {
            console.log("[FLOW][LOAD] nothing to check", {
              noAliases,
              noPins,
              noGroups,
            });
          } catch {}
          clearScanOverlayTimeout();
          const reason = activeIds.length === 0 ? " (no active KSK lock for this MAC)" : "";
          showScanResult("NOTHING TO CHECK HERE", "info", 3000);
          setGroupedBranches([]);
          setActiveKssks([]);
          setIsScanning(false);
          setShowScanUi(false);
          setDisableOkAnimation(true);
          // Also reset MAC and live state shortly so badge goes off
          setTimeout(() => {
            handleResetKfb();
          }, 900);
          return;
        }

        setBranchesData([]);

        try {
          console.log("[FLOW][LOAD] final pins for CHECK", pins);
        } catch {}
        await runCheck(mac, 0, pins);
      } catch (e) {
        console.error("Load/MONITOR error:", e);
        setKfbNumber("");
        setKfbInfo(null);
        const msg =
          "Failed to load setup data. Please run Setup or scan MAC again.";
        setErrorMsg(msg);
        setDisableOkAnimation(true);
        if (source === "scan") {
          showScanResult("ERROR", "error", 3000);
        }
        // Reset to scan state and clear MAC/live shortly after error is shown
        setTimeout(() => {
          handleResetKfb();
        }, 900);
      } finally {
        setIsScanning(false);
        setShowScanUi(false);
      }
    },
    [runCheck]
  );

  const handleScan = useCallback(
    async (raw: string) => {
      const normalized = (raw || "").trim().toUpperCase();
      if (!normalized) return;
      try {
        console.log("[FLOW][SCAN] received", { raw, normalized });
      } catch {}

      const nowDeb = Date.now();
      if (
        normalized === lastHandledScanRef.current &&
        nowDeb < scanDebounceRef.current
      ) {
        try {
          console.log("[FLOW][SCAN] debounced duplicate", { normalized });
        } catch {}
        return;
      }
      lastHandledScanRef.current = normalized;
      scanDebounceRef.current = nowDeb + 2000;

      if (normalized !== kfbInputRef.current) {
        setKfbInput(normalized);
        setKfbNumber(normalized);
      }

      if (!(canonicalMac(normalized) || KFB_REGEX.test(normalized))) {
        // Avoid overlay highlight for invalid scans; surface inline
        setErrorMsg(`Invalid code: ${normalized}`);
        try {
          console.warn("[FLOW][SCAN] invalid format", { normalized });
        } catch {}
        return;
      }

      if (isScanningRef.current || scanInFlightRef.current) return; // avoid overlapping flows
      scanInFlightRef.current = true;
      try {
        console.log("[FLOW][SCAN] starting load");
        await loadBranchesData(normalized);
      } finally {
        setTimeout(() => {
          scanInFlightRef.current = false;
          try {
            console.log("[FLOW][SCAN] finished load");
          } catch {}
        }, 300);
      }
    },
    [loadBranchesData]
  );

  useEffect(() => {
    handleScanRef.current = handleScan;
  }, [handleScan]);

  const skippedFirstSseRef = useRef(false);
  useEffect(() => {
    if (mainView !== "dashboard") return;
    if (isSettingsSidebarOpen) return;
    if (!serial.lastScanTick) return; // no event yet
    const want = resolveDesiredPath();
    const seen = lastScanPath;
    if (want && seen && !pathsEqual(seen, want)) return; // ignore scans from other scanner paths
    const code = serial.lastScan; // the latest payload
    if (!code) return;
    if (isCheckingRef.current) {
      enqueueScan(code);
    } else {
      void handleScan(code);
    }
  }, [
    serial.lastScanTick,
    lastScanPath,
    handleScan,
    mainView,
    isSettingsSidebarOpen,
  ]);

  // Polling fallback (filters to ACM via returned path and gates by view + settings).
  useEffect(() => {
    if (mainView !== "dashboard") return;
    if (isSettingsSidebarOpen) return;
    // If SSE is connected but stale (no recent scans), allow polling as a safety net
    const STALE_MS = Number(
      process.env.NEXT_PUBLIC_SCANNER_POLL_IF_STALE_MS ?? "4000"
    );
    const lastAt = (serial as any).lastScanAt as number | null | undefined;
    const sseOk = !!(serial as any).sseConnected;
    const stale =
      !(typeof lastAt === "number" && isFinite(lastAt)) ||
      Date.now() - (lastAt as number) > STALE_MS;
    if (sseOk && !stale) return; // healthy SSE path — skip polling

    let stopped = false;
    let lastPollAt = 0;
    // guard against duplicate pollers in StrictMode / re-renders
    const key = "__scannerPollActive__";
    if ((window as any)[key]) return;
    (window as any)[key] = true;
    let timer: number | null = null;
    let ctrl: AbortController | null = null;

    const tick = async () => {
      try {
        if (isScanningRef.current) {
          if (!stopped) timer = window.setTimeout(tick, 500);
          return;
        }
        ctrl = new AbortController();
        const want = resolveDesiredPath();
        // Only poll the desired scanner path; if unknown, wait and try again
        if (!want) {
          if (!stopped) timer = window.setTimeout(tick, 1200);
          return;
        }
        const url = `/api/serial/scanner?path=${encodeURIComponent(want)}&consume=1`;
        const res = await fetch(url, {
          cache: "no-store",
          signal: ctrl.signal,
        });
        if (res.ok) {
          const { code, path, error, retryInMs } = await res.json();
          try {
            if (typeof retryInMs === "number")
              (window as any).__scannerRetry = retryInMs;
          } catch {}
          const raw = typeof code === "string" ? code.trim() : "";
          if (raw) {
            if (path && !isAcmPath(path)) return;
            if (want && path && !pathsEqual(path, want)) return;
            if (isCheckingRef.current) enqueueScan(raw);
            else await handleScan(raw);
          } else if (error) {
            const str = String(error);
            const lower = str.toLowerCase();
            // Suppress noisy "not present/disconnected" class of errors; badge already reflects state
            const isNotPresent =
              lower.includes("scanner port not present") ||
              lower.includes("disconnected:not_present") ||
              lower.includes("not present") ||
              lower.includes("not_present");
            if (isNotPresent) {
              setErrorMsg(null);
            } else {
              setErrorMsg(str);
            }
            console.warn("[SCANNER] poll error", error);
          }
        }
      } catch (e) {
        if (!(e instanceof DOMException && e.name === "AbortError")) {
          console.error("[SCANNER] poll error", e);
        }
      } finally {
        const now = Date.now();
        const delay =
          typeof (window as any).__scannerRetry === "number"
            ? (window as any).__scannerRetry
            : undefined;
        let nextMs = typeof delay === "number" && delay > 0 ? delay : 1800;
        // enforce a minimum spacing between polls
        const elapsed = now - lastPollAt;
        if (elapsed < nextMs) nextMs = Math.max(nextMs, 1800 - elapsed);
        lastPollAt = now + nextMs;
        if (!stopped) timer = window.setTimeout(tick, nextMs);
      }
    };

    tick();
    return () => {
      stopped = true;
      try {
        delete (window as any)[key];
      } catch {}
      if (timer) window.clearTimeout(timer);
      if (ctrl) ctrl.abort();
    };
  }, [mainView, isSettingsSidebarOpen, handleScan]);

  // When CHECK finishes, process the most recent queued scan (if any)
  useEffect(() => {
    if (!isChecking) {
      // small delay allows UI state to settle
      const t = setTimeout(() => {
        const q = pendingScansRef.current;
        if (!q.length) return;
        const next = q[q.length - 1]!; // most recent
        pendingScansRef.current = [];
        try {
          void handleScanRef.current(next);
        } catch {}
      }, 50);
      return () => clearTimeout(t);
    }
  }, [isChecking]);

  // Removed UI polling; success overlay auto-hides after 3s.

  // Manual submit from a form/input
  const handleKfbSubmit = (e: FormEvent) => {
    e.preventDefault();
    try {
      console.log("[FLOW][MANUAL] submit", { value: kfbInputRef.current });
    } catch {}
    void loadBranchesData(kfbInputRef.current, "manual");
  };

  const handleManualSubmit = (submittedNumber: string) => {
    const val = submittedNumber.trim().toUpperCase();
    if (!val) return;
    // For manual entry, avoid intrusive overlays; show subtle inline message
    if (!(canonicalMac(val) || KFB_REGEX.test(val))) {
      setErrorMsg("Invalid code. Expected MAC like AA:BB:CC:DD:EE:FF");
      return;
    }
    const mac = canonicalMac(val);
    const next = mac || val;
    setKfbInput(next);
    setKfbNumber(next);
    void loadBranchesData(next, "manual");
  };

  // Layout helpers
  const actualHeaderHeight = mainView === "dashboard" ? "4rem" : "0rem";
  const leftOffset =
    mainView === "dashboard" && isLeftSidebarOpen ? SIDEBAR_WIDTH : "0";
  const appCurrentViewType =
    mainView === "settingsConfiguration" || mainView === "settingsBranches"
      ? "settings"
      : "main";

  const toggleLeftSidebar = () => setIsLeftSidebarOpen((v) => !v);
  const toggleSettingsSidebar = () => setIsSettingsSidebarOpen((v) => !v);
  const showDashboard = () => setMainView("dashboard");
  const showConfig = () => {
    setMainView("settingsConfiguration");
    setIsLeftSidebarOpen(false);
  };
  const showBranchesSettings = (id?: number) => {
    if (id != null) setCurrentConfigIdForProgram(id);
    setMainView("settingsBranches");
    setIsLeftSidebarOpen(false);
  };

  const handleHeaderClick = () => {
    if (appCurrentViewType === "settings") {
      showDashboard();
      setIsSettingsSidebarOpen(false);
    } else {
      toggleSettingsSidebar();
    }
  };

  return (
    <div className="relative flex min-h-screen bg-white">
      {mainView === "dashboard" && (
        <BranchControlSidebar
          isOpen={isLeftSidebarOpen}
          toggleSidebar={toggleLeftSidebar}
          branches={branchesData}
          onSetStatus={(id, status) =>
            setBranchesData((data) =>
              data.map((b) => (b.id === id ? { ...b, testStatus: status } : b))
            )
          }
          sidebarWidthProvided={SIDEBAR_WIDTH}
          appHeaderHeight={actualHeaderHeight}
        />
      )}

      <div
        className="flex flex-1 flex-col transition-all"
        style={{ marginLeft: leftOffset }}
      >
        {mainView === "dashboard" && (
          <Header
            onSettingsClick={handleHeaderClick}
            currentView={appCurrentViewType}
            isSidebarOpen={isLeftSidebarOpen}
            onToggleSidebar={toggleLeftSidebar}
          />
        )}

        <main className="flex-1 overflow-auto bg-white">
          {mainView === "dashboard" ? (
            <>
              {desiredTail && (
                <div className="px-2 pt-0 flex flex-wrap gap-2">
                  {/* Primary desired scanner badge (bigger) */}
                  {desiredTail &&
                    (() => {
                      const present = !!desiredPortState?.present;
                      const badgeBase =
                        "inline-flex items-center gap-1 rounded-full px-3 py-1 text-[12px] md:text-[13px] font-extrabold";
                      const badgeColor = present
                        ? "border border-emerald-300 bg-emerald-50 text-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-200"
                        : "border border-red-300 bg-red-50 text-red-900 dark:bg-red-900/20 dark:text-red-200";
                      return (
                        <span className={`${badgeBase} ${badgeColor}`}>
                          Scanner: {desiredTail}
                          <span
                            className={
                              present ? "text-emerald-700" : "text-red-700"
                            }
                          >
                            {present ? "detected" : "not detected"}
                          </span>
                        </span>
                      );
                    })()}
                  {(() => {
                    const ready = !!(serial as any).redisReady;
                    const badgeBase =
                      "inline-flex items-center gap-1 rounded-full px-3 py-1 text-[12px] md:text-[13px] font-extrabold";
                    const badgeColor = ready
                      ? "border border-emerald-300 bg-emerald-50 text-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-200"
                      : "border border-red-300 bg-red-50 text-red-900 dark:bg-red-900/20 dark:text-red-200";
                    return (
                      <span className={`${badgeBase} ${badgeColor}`}>
                        Redis:
                        <span
                          className={
                            ready ? "text-emerald-700" : "text-red-700"
                          }
                        >
                          {ready ? "connected" : "offline"}
                        </span>
                      </span>
                    );
                  })()}
                  {(() => {
                    const mac = (macAddress || "").toUpperCase();
                    const on = !!((serial as any).sseConnected && mac);
                    const cnt = Number((serial as any).evCount || 0);
                    const badgeBase =
                      "inline-flex items-center gap-1 rounded-full px-3 py-1 text-[12px] md:text-[13px] font-extrabold";
                    const badgeColor = on
                      ? "border border-emerald-300 bg-emerald-50 text-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-200"
                      : "border border-slate-300 bg-slate-50 text-slate-700 dark:bg-slate-800/40 dark:text-slate-200";
                    return (
                      <span
                        className={`${badgeBase} ${badgeColor}`}
                        title={mac ? `MAC ${mac}` : "inactive"}
                      >
                        Live:
                        <span
                          className={on ? "text-emerald-700" : "text-slate-600"}
                        >
                          {on ? `on (EV ${cnt})` : "off"}
                        </span>
                      </span>
                    );
                  })()}
                </div>
              )}
   
              {(() => {
                const hasMac = !!(macAddress && macAddress.trim());
                const effBranches = hasMac ? branchesData : [];
                const effGroups = hasMac ? groupedBranches : [];
                const effFailures = hasMac ? checkFailures : null;
                const effActiveKssks = hasMac ? activeKssks : [];
                const effNormalPins = hasMac ? normalPins : undefined;
                const effLatchPins = hasMac ? latchPins : undefined;
                // Avoid noisy console logs when no MAC is active
                return (
              <BranchDashboardMainContent
                key={session}
                appHeaderHeight={actualHeaderHeight}
                onManualSubmit={handleManualSubmit}
                onScanAgainRequest={() => loadBranchesData()}
                branchesData={effBranches}
                groupedBranches={effGroups}
                checkFailures={effFailures}
                nameHints={nameHints}
                kfbNumber={kfbNumber}
                kfbInfo={kfbInfo}
                isScanning={isScanning && showScanUi}
                macAddress={macAddress}
                activeKssks={effActiveKssks}
                lastEv={suppressLive ? null : (serial as any).lastEv}
                lastEvTick={suppressLive ? 0 : (serial as any).lastEvTick}
                normalPins={suppressLive ? undefined : effNormalPins}
                latchPins={suppressLive ? undefined : effLatchPins}
                onResetKfb={handleResetKfb}
                onFinalizeOk={finalizeOkForMac}
                flashOkTick={okFlashTick}
                okSystemNote={okSystemNote}
                disableOkAnimation={disableOkAnimation}
                scanResult={scanResult}
              />
                );
              })()}

              <form onSubmit={handleKfbSubmit} className="hidden" />
            </>
          ) : mainView === "settingsConfiguration" ? (
            <SettingsPageContent
              onNavigateBack={showDashboard}
              onShowProgramForConfig={showBranchesSettings}
            />
          ) : (
            <SettingsBranchesPageContent
              onNavigateBack={showDashboard}
              configId={currentConfigIdForProgram}
            />
          )}
        </main>
      </div>

      <SettingsRightSidebar
        isOpen={isSettingsSidebarOpen}
        onClose={() => setIsSettingsSidebarOpen(false)}
        appHeaderHeight={actualHeaderHeight}
        onShowConfigurationInMain={showConfig}
        onShowBranchesSettingsInMain={() => showBranchesSettings()}
      />

      <style>{`
        .plug-wiggle { animation: wiggle 1s ease-in-out infinite; }
        @keyframes wiggle { 0%,100% { transform: translateX(0) } 50% { transform: translateX(8px) } }
      `}</style>

      {/* Only OK overlay; suppress scanning/error overlays */}
      <AnimatePresence>
        {overlay.open && overlay.kind === "success" && (
          <m.div
            variants={bg}
            initial="hidden"
            animate="visible"
            exit="exit"
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(2,6,23,0.64)",
              backdropFilter: "blur(4px)",
              display: "grid",
              placeItems: "center",
              zIndex: 9999,
            }}
            aria-live="assertive"
            aria-label={
              overlay.kind.toUpperCase()
            }
          >
            <m.div
              variants={card}
              initial="hidden"
              animate="visible"
              exit="exit"
              style={{ display: "grid", justifyItems: "center", gap: 8 }}
            >
              {overlay.kind === "success" ? (
                <>
                  <m.div
                    initial={{ scale: reduce ? 1 : 0.95, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 260, damping: 20 }}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{
                        width: 160,
                        height: 160,
                        color: KIND_STYLES.success,
                      }}
                    >
                      <circle cx="12" cy="12" r="10" />
                      <path d="M9 12l2 2 4-4" />
                    </svg>
                  </m.div>
                  <m.div
                    variants={heading}
                    style={{
                      fontSize: 56,
                      fontWeight: 900,
                      letterSpacing: "0.02em",
                      color: KIND_STYLES.success,
                      textShadow: "0 6px 18px rgba(0,0,0,0.45)",
                    }}
                  >
                    OK
                  </m.div>
                </>
              ) : null}
            </m.div>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default MainApplicationUI;
