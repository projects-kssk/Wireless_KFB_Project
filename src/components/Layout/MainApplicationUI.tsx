"use client";

import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  FormEvent,
  startTransition,
  useMemo,
} from "react";
import { BranchDisplayData, KfbInfo, TestStatus } from "@/types/types";
import { Header } from "@/components/Header/Header";
import { BranchControlSidebar } from "@/components/Program/BranchControlSidebar";
import { SettingsPageContent } from "@/components/Settings/SettingsPageContent";
import { SettingsBranchesPageContent } from "@/components/Settings/SettingsBranchesPageContent";
import BranchDashboardMainContent from "@/components/Program/BranchDashboardMainContent";
import { useSerialEvents } from "@/components/Header/useSerialEvents";

const DEBUG_LIVE = process.env.NEXT_PUBLIC_DEBUG_LIVE === "1";

/* --------------------------------------------------------------------------------
 * Small, dependency-free HUD for Scan/Idle/Toast states
 * -------------------------------------------------------------------------------*/

type HudMode = "idle" | "scanning" | "info" | "error";

/* --------------------------------------------------------------------------------
 * Existing app logic
 * -------------------------------------------------------------------------------*/

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
const isAcmPath = (p?: string | null) =>
  !p ||
  /(^|\/)ttyACM\d+$/.test(p) ||
  /(^|\/)ACM\d+($|[^0-9])/.test(p) ||
  /\/by-id\/.*ACM\d+/i.test(p);

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

// Merge aliases helper shared by runCheck and loadBranchesData
function mergeAliasesFromItems(
  items?: Array<{ aliases?: Record<string, string> }> | null
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!Array.isArray(items)) return out;
  for (const it of items) {
    const a = (it && typeof it.aliases === "object" && it.aliases) || {};
    for (const [pin, name] of Object.entries(a)) {
      out[pin] = out[pin] && out[pin] !== name ? `${out[pin]} / ${name}` : name;
    }
  }
  return out;
}

const MainApplicationUI: React.FC = () => {
  // Centralized config constants
  const CFG = {
    OVERLAY_MS: Math.max(
      1000,
      Number(process.env.NEXT_PUBLIC_SCAN_OVERLAY_MS ?? 3000)
    ),
    STUCK_MS: Math.max(
      4000,
      Number(process.env.NEXT_PUBLIC_SCAN_STUCK_MS ?? 7000)
    ),
    OK_MS: Math.max(400, Number(process.env.NEXT_PUBLIC_OK_OVERLAY_MS ?? 1200)),
    CHECK_CLIENT_MS: Math.max(
      1000,
      Number(process.env.NEXT_PUBLIC_CHECK_CLIENT_TIMEOUT_MS ?? 5000)
    ),
    RETRIES: Math.max(
      0,
      Number(process.env.NEXT_PUBLIC_CHECK_RETRY_COUNT ?? 1)
    ),
    RETRY_COOLDOWN_MS: Math.max(
      2000,
      Number(process.env.NEXT_PUBLIC_RETRY_COOLDOWN_MS ?? 5000)
    ),
  } as const;

  // Feature flags (default off unless explicitly enabled)
  const FLAGS = {
    USE_LOCKS: String(process.env.NEXT_PUBLIC_USE_LOCKS || '').trim() === '1',
    REHYDRATE_ON_LOAD:
      String(process.env.NEXT_PUBLIC_REHYDRATE_ON_LOAD || '').trim() === '1',
    REHYDRATE_ON_RECOVERY:
      String(process.env.NEXT_PUBLIC_REHYDRATE_ON_RECOVERY || '').trim() === '1',
    STATION_WARMUP:
      String(process.env.NEXT_PUBLIC_STATION_WARMUP || '').trim() === '1',
    SCANNER_POLL:
      String(process.env.NEXT_PUBLIC_SCANNER_POLL_ENABLED || '').trim() ===
      '1',
    HINT_ON_EMPTY:
      String(process.env.NEXT_PUBLIC_HINT_ON_EMPTY || '').trim() === '1',
    CHECK_ON_EMPTY:
      String(process.env.NEXT_PUBLIC_CHECK_ON_EMPTY || '').trim() === '1',
  } as const;

  // UI state
  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(false);
  const [isSettingsSidebarOpen, setIsSettingsSidebarOpen] = useState(false);
  const [mainView, setMainView] = useState<MainView>("dashboard");

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
  const [scanResult, setScanResult] = useState<{
    text: string;
    kind: "info" | "error";
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [nameHints, setNameHints] = useState<
    Record<string, string> | undefined
  >(undefined);
  const [normalPins, setNormalPins] = useState<number[] | undefined>(undefined);
  const [latchPins, setLatchPins] = useState<number[] | undefined>(undefined);
  const [activeKssks, setActiveKssks] = useState<string[]>([]);
  // removed: scanningError (unused UI state)

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

  // Throttle repeated cleanup calls per MAC (avoid bursts of clear/delete)
  const recentCleanupRef = useRef<Map<string, number>>(new Map());

  // Check flow
  const [checkFailures, setCheckFailures] = useState<number[] | null>(null);
  const [isChecking, setIsChecking] = useState(false);

  // Reflect isChecking in a ref for async handlers
  const isCheckingRef = useRef(false);
  useEffect(() => {
    isCheckingRef.current = isChecking;
  }, [isChecking]);

  // Central timer scheduler
  // Timer registry; use window's timer types to avoid Node vs DOM mismatch
  const timers = useRef<Map<string, ReturnType<typeof window.setTimeout>>>(new Map());
  const mountedRef = useRef(true);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const schedule = useCallback((key: string, fn: () => void, ms: number) => {
    const prev = timers.current.get(key);
    if (prev) {
      try { window.clearTimeout(prev as any); } catch {}
      timers.current.delete(key);
    }
    const id = window.setTimeout(
      () => {
        try {
          timers.current.delete(key);
        } catch {}
        try {
          fn();
        } catch {}
      },
      Math.max(0, ms)
    );
    // In some envs Node typings leak; ensure we store the correct timer type
    timers.current.set(key, id as unknown as ReturnType<typeof window.setTimeout>);
  }, []);
  const cancel = useCallback((key: string) => {
    const prev = timers.current.get(key);
    if (prev) {
      try { window.clearTimeout(prev as any); } catch {}
      timers.current.delete(key);
    }
  }, []);
  useEffect(
    () => () => {
      try {
        for (const id of timers.current.values()) window.clearTimeout(id as any);
        timers.current.clear();
      } catch {}
    },
    []
  );

  // Ensure transient hint timers are cleared on unmount
  useEffect(() => {
    return () => {
      try {
        if (scanResultTimerRef.current) {
          clearTimeout(scanResultTimerRef.current);
          scanResultTimerRef.current = null;
        }
        if (scanOverlayTimerRef.current != null) {
          clearTimeout(scanOverlayTimerRef.current);
          scanOverlayTimerRef.current = null;
        }
      } catch {}
    };
  }, []);

  // Cooldown to ignore rapid re-triggers after reset
  const idleCooldownUntilRef = useRef<number>(0);
  // Track temporarily blocked MACs (e.g., after nothing-to-check)
  const blockedMacRef = useRef<Set<string>>(new Set());
  // Timer for transient scan result hint text
  const scanResultTimerRef = useRef<number | null>(null);
  // One-shot guard to skip STOP-path cleanup when we intentionally soft-reset
  const skipStopCleanupNextRef = useRef<boolean>(false);

  // Helper: compute active pins strictly from items for the currently active KSK ids
  const computeActivePins = useCallback(
    (
      items:
        | Array<{
            ksk?: string;
            kssk?: string;
            normalPins?: number[];
            latchPins?: number[];
          }>
        | undefined,
      activeIds: string[] | undefined
    ): { normal: number[]; latch: number[] } => {
      const ids = new Set((activeIds || []).map((s) => String(s).trim()));
      const n = new Set<number>();
      const l = new Set<number>();
      if (Array.isArray(items) && ids.size) {
        for (const it of items) {
          const id = String(
            ((it as any)?.ksk ?? (it as any)?.kssk) || ""
          ).trim();
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

  // Deprecated flags preserved for compatibility
  const [awaitingRelease, setAwaitingRelease] = useState(false);
  const [showRemoveCable, setShowRemoveCable] = useState(false);

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

  const lastScanRef = useRef("");
  // Fallback: if scanning gets stuck with NO DATA, show a soft hint (no reset)
  const hasLiveData = useMemo(() => {
    const anyGroups = Array.isArray(groupedBranches) && groupedBranches.some((g) => (g?.branches?.length ?? 0) > 0);
    const anyFlat = Array.isArray(branchesData) && branchesData.length > 0;
    return anyGroups || anyFlat;
  }, [groupedBranches, branchesData]);

  const hasUnion = useMemo(() => {
    const names = nameHints ? Object.keys(nameHints).length : 0;
    const np = Array.isArray(normalPins) ? normalPins.length : 0;
    const lp = Array.isArray(latchPins) ? latchPins.length : 0;
    return np > 0 || lp > 0 || names > 0;
  }, [normalPins, latchPins, nameHints]);

  useEffect(() => {
    if (!isScanning) return;
    // Do not trigger while a check is running or when live/union data is present
    if (isChecking) return;
    if (hasLiveData || hasUnion) return;
    if (Array.isArray(checkFailures) && checkFailures.length > 0) return;
    let cancelled = false;
    const STUCK_MS = CFG.STUCK_MS;
    const t = window.setTimeout(() => {
      if (cancelled) return;
      // Gentle hint only; do NOT reset or disable live
      try {
        setScanResult({ text: "Waiting for device/live data…", kind: "info" });
        if (scanResultTimerRef.current)
          clearTimeout(scanResultTimerRef.current);
        scanResultTimerRef.current = window.setTimeout(() => {
          setScanResult(null);
          scanResultTimerRef.current = null;
        }, 1800);
      } catch {}
    }, STUCK_MS);
    return () => {
      cancelled = true;
      try {
        clearTimeout(t);
      } catch {}
    };
  }, [isScanning, isChecking, macAddress, hasLiveData, hasUnion, checkFailures]);

  const [okFlashTick, setOkFlashTick] = useState(0);
  const [okSystemNote, setOkSystemNote] = useState<string | null>(null);
  const [disableOkAnimation, setDisableOkAnimation] = useState(false);
  const okShownOnceRef = useRef<boolean>(false);
  const okFlashAllowedRef = useRef<boolean>(false);
  const [suppressLive, setSuppressLive] = useState(false);

  const clearRetryTimer = () => {
    cancel("checkRetry");
  };
  const scanOverlayTimerRef = useRef<number | null>(null);
  const scanStartedAtRef = useRef<number | null>(null);
  const MIN_SCAN_UI_MS = Math.max(
    500,
    Number(process.env.NEXT_PUBLIC_MIN_SCAN_UI_MS ?? "1000")
  );

  const startScanOverlayTimeout = (
    ms = Math.max(
      1000,
      Number(process.env.NEXT_PUBLIC_SCAN_OVERLAY_MS ?? "3000")
    )
  ) => {
    if (scanOverlayTimerRef.current != null) {
      try {
        clearTimeout(scanOverlayTimerRef.current);
      } catch {}
      scanOverlayTimerRef.current = null;
    }
    scanOverlayTimerRef.current = window.setTimeout(() => {
      scanOverlayTimerRef.current = null;
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

  /* Live serial */
  const serial = useSerialEvents(
    suppressLive || !(macAddress && macAddress.trim())
      ? undefined
      : (macAddress || "").toUpperCase(),
    { disabled: suppressLive || mainView !== "dashboard", base: true }
  );

  // Log live state
  const liveStateRef = useRef<string>("off");
  const lastLiveMacRef = useRef<string | null>(null);
  useEffect(() => {
    const hasMac = !!(macAddress && macAddress.trim());
    const on = hasMac && !suppressLive && mainView === "dashboard";
    const next = on ? "on" : "off";
    if (next !== liveStateRef.current) {
      liveStateRef.current = next;
      try {
        if (on) {
          lastLiveMacRef.current = (macAddress || "").toUpperCase();
          if (DEBUG_LIVE)
            console.log("[LIVE] START", { mac: lastLiveMacRef.current });
        } else {
          if (DEBUG_LIVE) console.log("[LIVE] STOP");
          if (skipStopCleanupNextRef.current) {
            // One-shot: skip STOP cleanup after intentional soft reset
            skipStopCleanupNextRef.current = false;
            lastLiveMacRef.current = null;
            return;
          }
          const target = lastLiveMacRef.current;
          if (target && !(macAddress && macAddress.trim())) {
            (async () => {
              try {
                // Do not send checkpoint on STOP path; only clean Redis/locks
                await fetch("/api/aliases/clear", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ mac: target }),
                }).catch(() => {});
                await clearKskLocksFully(target).catch(() => {});
                try {
                  console.log("[CLEANUP] Done for MAC", { mac: target });
                } catch {}
              } finally {
                lastLiveMacRef.current = null;
              }
            })();
          }
        }
      } catch {}
    }
  }, [macAddress, suppressLive, mainView]);

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
    return ta === tb || a.endsWith(tb) || b.endsWith(ta);
  };
  const resolveDesiredPath = (): string | null => {
    const list = (serial as any).scannerPaths || [];
    if (list[DASH_SCANNER_INDEX]) return list[DASH_SCANNER_INDEX] || null;
    return null;
  };

  const prevRedisReadyRef = useRef<boolean | null>(null);
  const [redisDegraded, setRedisDegraded] = useState(false);
  const redisReadyRef = useRef<boolean>(false);
  const redisDropTimerRef = useRef<number | null>(null);
  const lastRedisDropAtRef = useRef<number | null>(null);
  const macRef = useRef<string>("");
  // Polling refs (replace window globals)
  const pollActiveRef = useRef(false);
  const pollRetryMsRef = useRef<number | undefined>(undefined);
  const pollBlockUntilRef = useRef<number>(0);
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
      const DEBOUNCE_MS = Math.max(
        300,
        Number(process.env.NEXT_PUBLIC_REDIS_DROP_DEBOUNCE_MS ?? "900")
      );
      if (prev === true && ready === false) {
        if (redisDropTimerRef.current == null) {
          lastRedisDropAtRef.current = Date.now();
          const detail = (serial as any).redisDetail || {};
          console.warn("[REDIS] redisReady dropped", {
            debounceMs: DEBOUNCE_MS,
            detail,
          });
          redisDropTimerRef.current = window.setTimeout(() => {
            redisDropTimerRef.current = null;
            if (!redisReadyRef.current) {
              const ms = lastRedisDropAtRef.current
                ? Date.now() - lastRedisDropAtRef.current
                : undefined;
              console.warn("[REDIS] degraded mode ON (redisReady=false)", {
                waitedMs: ms,
                lastEvent: (serial as any).redisDetail?.lastEvent,
                lastError: (serial as any).redisDetail?.lastError,
              });
              setRedisDegraded(true);
            } else {
              console.log(
                "[REDIS] recovered before debounce window; staying normal"
              );
            }
          }, DEBOUNCE_MS);
        }
      }
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
        console.log("[REDIS] redisReady back to true (degraded OFF)", {
          downMs: msDown,
          lastEvent: (serial as any).redisDetail?.lastEvent,
        });
        setRedisDegraded(false);
      }
    } catch {}
  }, [(serial as any).redisReady, macAddress]);

  // SSE union listener (restricted when degraded)
  useEffect(() => {
    const u = (serial as any).lastUnion as {
      mac?: string;
      normalPins?: number[];
      latchPins?: number[];
      names?: Record<string, string>;
    } | null;
    if (!u) return;
    if (suppressLive) return;
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
        if (DEBUG_LIVE)
          console.log("[SSE][UNION] skipped empty union during degraded mode");
        return;
      }
      if (DEBUG_LIVE)
        console.log("[SSE][UNION] update for current MAC", {
          normalPins: np,
          latchPins: lp,
          names: nm,
        });
      // Restrict pins to active KSKs
      const actIds =
        lastActiveIdsRef.current && lastActiveIdsRef.current.length
          ? lastActiveIdsRef.current
          : activeKssks;
      const fromItems = computeActivePins(
        itemsAllFromAliasesRef.current as any,
        actIds
      );
      setNormalPins(fromItems.normal);
      setLatchPins(fromItems.latch);
      if (u.names && typeof u.names === "object") setNameHints(u.names as any);
    } catch {}
  }, [
    (serial as any).lastUnion,
    macAddress,
    redisDegraded,
    suppressLive,
    activeKssks,
    computeActivePins,
  ]);

  // On recovery, rehydrate + union refresh (opt-in, rate-limited, active session only)
  const rehydrateBlockUntilRef = useRef<number>(0);
  useEffect(() => {
    if (!FLAGS.REHYDRATE_ON_RECOVERY) return;
    if (redisDegraded) return;
    if (suppressLive) return;
    const mac = (macAddress || "").toUpperCase();
    if (!mac) return;
    // Only while scanning or checking; avoid chatter when idle
    if (!isScanning && !isChecking) return;
    // Rate limit to avoid repeated network calls when state flaps
    const now = Date.now();
    if (now < (rehydrateBlockUntilRef.current || 0)) return;
    rehydrateBlockUntilRef.current = now + 30000; // 30s cooldown
    (async () => {
      try {
        if (DEBUG_LIVE)
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
          if (Array.isArray(j?.normalPins)) setNormalPins(j.normalPins as number[]);
          if (Array.isArray(j?.latchPins)) setLatchPins(j.latchPins as number[]);
          if (j?.aliases && typeof j.aliases === "object") setNameHints(j.aliases as Record<string, string>);
        }
      } catch {}
    })();
  }, [redisDegraded, macAddress, suppressLive]);

  // Auto-success when all branches OK
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
        if (macMatch && (isDoneFail || (isResult && isFailText))) return;
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
      okForcedRef.current = true;
      setSuppressLive(true);
      setOkFlashTick((t) => t + 1);
      const macUp = (macAddress || "").toUpperCase();
      if (macUp) {
        void finalizeOkForMac(macUp);
        return;
      }
      console.log("[FLOW][SUCCESS] no mac bound; skipping finalize/reset");
      return;
    }
  }, [branchesData, groupedBranches, checkFailures, isScanning, isChecking]);

  // Warm up KSK locks (station): poll sparingly and only when relevant (opt-in)
  useEffect(() => {
    if (!FLAGS.STATION_WARMUP) return;
    const stationId = (process.env.NEXT_PUBLIC_STATION_ID || "").trim();
    // Only poll when on dashboard, not in settings, and an active MAC session is present
    const hasMac = !!(macAddress && macAddress.trim());
    if (!stationId || mainView !== "dashboard" || isSettingsSidebarOpen) return;
    if (!hasMac || suppressLive) return;
    // Only during an active CHECK session
    if (!isChecking) return;
    // Respect global idle cooldown after success to avoid immediate polling
    try {
      const until = pollBlockUntilRef.current as number | undefined;
      if (typeof until === 'number' && Date.now() < until) return;
    } catch {}
    let stop = false;
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
          setActiveKssks((prev) => Array.from(new Set<string>([...prev, ...ids])));
        }
      } catch {}
    };
    tick();
    const h = setInterval(tick, 20000); // 20s backoff to reduce noise
    return () => {
      stop = true;
      clearInterval(h);
    };
  }, [mainView, isSettingsSidebarOpen, macAddress, suppressLive, isChecking]);

  const lastHandledScanRef = useRef<string>("");
  const scanDebounceRef = useRef<number>(0);
  const scanInFlightRef = useRef<boolean>(false);
  const okForcedRef = useRef<boolean>(false);
  const lastRunHadFailuresRef = useRef<boolean>(false);
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

  const handleResetKfb = useCallback(() => {
    clearRetryTimer();
    clearScanOverlayTimeout();

    setOkFlashTick(0);
    setOkSystemNote(null);
    setDisableOkAnimation(false);

    setErrorMsg(null);

    setKfbNumber("");
    setKfbInfo(null);
    setBranchesData([]);
    setGroupedBranches([]);
    setActiveKssks([]);
    setNameHints(undefined);
    setNormalPins(undefined);
    setLatchPins(undefined);

    setMacAddress("");
    setSuppressLive(false);

    okFlashAllowedRef.current = false;

    pendingScansRef.current = [];
    scanInFlightRef.current = false;
    okForcedRef.current = false;
    isCheckingRef.current = false;
    setIsChecking(false);
    setIsScanning(false);

    lastHandledScanRef.current = "";
    scanDebounceRef.current = 0;
    lastScanRef.current = "";
    try {
      finalizeOkGuardRef.current.clear();
    } catch {}

    // No session key bump; view resets via state above
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
  const lastActiveIdsRef = useRef<string[]>([]);

  const sendCheckpointForMac = useCallback(
    async (mac: string, onlyIds?: string[]): Promise<boolean> => {
      const MAC = mac.toUpperCase();
      if (Date.now() < (checkpointBlockUntilTsRef.current || 0)) {
        try {
          console.warn(
            "[FLOW][CHECKPOINT] suppressed due to recent failure backoff"
          );
        } catch {}
        return false;
      }
      if (checkpointMacSentRef.current.has(MAC)) return false;
      if (checkpointMacPendingRef.current.has(MAC)) return false;
      checkpointMacPendingRef.current.add(MAC);
      try {
        try {
          console.log("[FLOW][CHECKPOINT] preparing", {
            mac: MAC,
            onlyIds: onlyIds && onlyIds.length ? onlyIds : undefined,
          });
        } catch {}
        const rList = await fetch(
          `/api/aliases?mac=${encodeURIComponent(MAC)}&all=1`,
          { cache: "no-store" }
        );
        if (!rList.ok) return false;
        const j = await rList.json();
        const items: any[] = Array.isArray(j?.items) ? j.items : [];
        let ids = items
          .map((it) => String((it.ksk ?? it.kssk) || "").trim())
          .filter(Boolean);

        if (onlyIds && onlyIds.length) {
          const want = new Set(onlyIds.map((s) => s.toUpperCase()));
          ids = ids.filter((id) => want.has(id.toUpperCase()));
          if (ids.length === 0 && items.length) {
            const firstId = String(
              (items[0] as any)?.ksk ?? (items[0] as any)?.kssk ?? ""
            ).trim();
            ids = [firstId].filter(Boolean) as string[];
          }
        } else if (ids.length > 1) {
          ids = [ids[0]];
        }

        let sent = false;
        for (const id of ids) {
          if (checkpointSentRef.current.has(id)) continue;
          let workingDataXml: string | null = null;
          try {
            const rXml = await fetch(
              `/api/aliases/xml?mac=${encodeURIComponent(MAC)}&kssk=${encodeURIComponent(id)}`,
              { cache: "no-store" }
            );
            if (rXml.ok) workingDataXml = await rXml.text();
          } catch {}
          // If XML not found or empty, skip sending checkpoint for this id
          if (!workingDataXml || !workingDataXml.trim()) {
            try {
              console.log("[FLOW][CHECKPOINT] skip (no XML)", { mac: MAC, ksk: id });
            } catch {}
            continue;
          }
          const payload = { requestID: "1", workingDataXml } as any;
          payload.forceResult = true;

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
              if (resp.status >= 500) {
                checkpointBlockUntilTsRef.current = Date.now() + 120_000;
                try {
                  console.warn(
                    "[FLOW][CHECKPOINT] server error; enabling backoff",
                    { status: resp.status }
                  );
                } catch {}
              }
            } else {
              checkpointSentRef.current.add(id);
              sent = true;
              try {
                console.log("[FLOW][CHECKPOINT] sent OK checkpoint", {
                  mac: MAC,
                  ksk: id,
                });
              } catch {}
            }
          } catch (e) {
            checkpointBlockUntilTsRef.current = Date.now() + 60_000;
            try {
              console.warn("[FLOW][CHECKPOINT] network error; backoff enabled");
            } catch {}
          }
        }
        if (sent) checkpointMacSentRef.current.add(MAC);
        return sent;
      } finally {
        checkpointMacPendingRef.current.delete(MAC);
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
      const mac = String(rawMac || "")
        .trim()
        .toUpperCase();
      if (!mac) {
        handleResetKfb();
        return;
      }
      if (finalizeOkGuardRef.current.has(mac)) return;
      try {
        const last =
          (recentCleanupRef.current as Map<string, number> | undefined)?.get?.(
            mac
          ) || 0;
        if (Date.now() - last < 5000) return;
      } catch {}
      finalizeOkGuardRef.current.add(mac);

      try {
        setSuppressLive(true);
        try {
          if (DEBUG_LIVE)
            console.log("[LIVE] OFF → OK latched; suppressing live updates");
        } catch {}

        // We are intentionally clearing MAC; skip the STOP-path cleanup once.
        skipStopCleanupNextRef.current = true;

        // Block this MAC from re-triggering via residual scans for a short window
        try {
          if (mac) {
            blockedMacRef.current.add(mac);
            idleCooldownUntilRef.current = Date.now() + CFG.RETRY_COOLDOWN_MS;
            window.setTimeout(() => {
              try { blockedMacRef.current.delete(mac); } catch {}
            }, CFG.RETRY_COOLDOWN_MS);
          }
        } catch {}

        setMacAddress("");
        setKfbNumber("");

        try {
          lastFinalizedMacRef.current = mac;
          lastFinalizedAtRef.current = Date.now();
        } catch {}

        const hasSetup = await hasSetupDataForMac(mac).catch(() => false);
        if (hasSetup) {
          const ids =
            lastActiveIdsRef.current && lastActiveIdsRef.current.length
              ? lastActiveIdsRef.current
              : activeKssks || [];
          try {
            console.log("[FLOW][CHECKPOINT] finalising with ids", ids);
          } catch {}
          const sent = await sendCheckpointForMac(mac, ids).catch(() => false);
          setOkSystemNote(sent ? "Checkpoint sent; cache cleared" : "Cache cleared");
        } else {
          try {
            console.log(
              "[FLOW][CHECKPOINT] skip (no setup data found for MAC)"
            );
          } catch {}
          setOkSystemNote("Cache cleared");
        }

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
        try {
          const sid = (process.env.NEXT_PUBLIC_STATION_ID || "").trim();
          if (sid) {
            await fetch("/api/ksk-lock", {
              method: "DELETE",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ stationId: sid, mac, force: 1 }),
            }).catch(() => {});
          }
        } catch {}

        try {
          const maxTry = 5;
          for (let i = 0; i < maxTry; i++) {
            const r = await fetch(
              `/api/aliases?mac=${encodeURIComponent(mac)}&all=1`,
              { cache: "no-store" }
            ).catch(() => null);
            const ok = !!r && r.ok;
            const j = ok ? await r!.json().catch(() => null) : null;
            const items = Array.isArray(j?.items) ? j.items : [];
            if (ok && items.length === 0) break;
            await tryClearAliases();
            await new Promise((res) => setTimeout(res, 300));
          }
        } catch {}
      } finally {
        try {
          (recentCleanupRef.current as Map<string, number>).set(
            mac,
            Date.now()
          );
        } catch {}
        finalizeOkGuardRef.current.delete(mac);
        handleResetKfb();
      }
    },
    [
      hasSetupDataForMac,
      sendCheckpointForMac,
      handleResetKfb,
      clearKskLocksFully,
      activeKssks,
    ]
  );

  // Declare before any effect that reads it
  const lastFinalizedMacRef = useRef<string | null>(null);
  const lastFinalizedAtRef = useRef<number>(0);

  // Post-reset sanity cleanup
  useEffect(() => {
    const mac = lastFinalizedMacRef.current;
    if (!mac) return;
    const onScanView =
      mainView === "dashboard" && !(macAddress && macAddress.trim());
    if (!onScanView) return;
    if (isScanning || isChecking) return;
    try {
      const last =
        (recentCleanupRef.current as Map<string, number> | undefined)?.get?.(
          mac
        ) || 0;
      if (Date.now() - last < 5000) {
        lastFinalizedMacRef.current = null;
        return;
      }
    } catch {}
    (async () => {
      try {
        console.log("[REDIS][SANITY] post-reset cleanup for", mac);
        await fetch("/api/aliases/clear", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mac }),
        }).catch(() => {});
        await clearKskLocksFully(mac).catch(() => {});
      } finally {
        lastFinalizedMacRef.current = null;
      }
    })();
  }, [mainView, macAddress, isScanning, isChecking]);

  // Finalization on RESULT/DONE:OK
  useEffect(() => {
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
    if (kind === "START") {
      const current = (macAddress || "").toUpperCase();
      const evMac = String(ev.mac || "").toUpperCase();
      if (!current || (evMac && current === evMac)) {
        setIsChecking(true);
        okFlashAllowedRef.current = true;
      }
    }
    const ok =
      (/\bRESULT\b/i.test(raw) && /\b(SUCCESS|OK)\b/i.test(raw)) ||
      String(ev.ok).toLowerCase() === "true";
    const ZERO = "00:00:00:00:00:00";
    const current = (macAddress || "").toUpperCase();

    let evMac = String(ev.mac || "").toUpperCase();
    if (!evMac || evMac === ZERO) {
      const macs =
        raw.toUpperCase().match(/([0-9A-F]{2}(?::[0-9A-F]{2}){5})/g) || [];
      evMac = macs.find((m) => m !== ZERO) || current;
    }

    const matches = !!current && evMac === current;
    const liveAllowed =
      okFlashAllowedRef.current === true && isCheckingRef.current === true;

    if ((kind === "RESULT" || kind === "DONE") && ok && matches && liveAllowed) {
      // Block idle poller briefly after success to avoid immediate scanner polling
      try { pollBlockUntilRef.current = Date.now() + 15000; } catch {}
      setBranchesData((prev) =>
        prev.map((b) => ({ ...b, testStatus: "ok" as const }))
      );
      setCheckFailures([]);
      setIsChecking(false);
      setIsScanning(false);
      if (okFlashAllowedRef.current === true && !okShownOnceRef.current) {
        okShownOnceRef.current = true;
        setOkFlashTick((t) => t + 1);
      }
      finalizeOkForMac(evMac || current);
    }
  }, [(serial as any).lastEvTick, macAddress, suppressLive, finalizeOkForMac]);

  // Enter live mode on RESULT/DONE failures as a fallback (e.g., missed START)
  useEffect(() => {
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
    const ZERO = "00:00:00:00:00:00";
    const current = (macAddress || "").toUpperCase();
    if (!current) return;

    let evMac = String(ev.mac || "").toUpperCase();
    if (!evMac || evMac === ZERO) {
      const macs = raw.toUpperCase().match(/([0-9A-F]{2}(?::[0-9A-F]{2}){5})/g) || [];
      evMac = macs.find((m) => m !== ZERO) || current;
    }
    const matches = evMac === current;

    const isResultish = kind === "DONE" || kind === "RESULT" || /\bRESULT\b/i.test(raw);
    const isFailure =
      String(ev.ok).toLowerCase() === "false" || /\bFAIL(?:URE)?\b/i.test(raw);

    // If we got a failure event for the current MAC, but we're not in checking state,
    // switch into live/checking mode so the UI shows live updates and failures.
    if (matches && isResultish && isFailure && !isCheckingRef.current) {
      try {
        if (DEBUG_LIVE) console.log("[LIVE] Fallback enter on failure event", { raw });
      } catch {}
      setIsChecking(true);
      okFlashAllowedRef.current = true;

      // Best-effort parse of missing pins like: "MISSING 1,10,14,15"
      try {
        const m = raw.match(/MISSING\s+([0-9 ,]+)/i);
        if (m && m[1]) {
          const pins = m[1]
            .split(/[, ]+/)
            .map((s) => Number(s))
            .filter((n) => Number.isFinite(n));
          if (pins.length) {
            setCheckFailures(pins);
            // Mark known branches as failed where possible
            setBranchesData((prev) =>
              prev.map((b) =>
                pins.includes(Number(b.pinNumber))
                  ? { ...b, testStatus: "nok" as const }
                  : b
              )
            );
          }
        }
      } catch {}
    }
  }, [(serial as any).lastEvTick, macAddress, suppressLive]);

  const runCheck = useCallback(
    async (mac: string, attempt: number = 0, pins?: number[]) => {
      if (!mac) return;

      setIsChecking(true);
      // Safety: if device never sends final RESULT/DONE, auto-unstick
      schedule("checkWatchdog", () => {
        if (isCheckingRef.current) {
          try { console.warn("[FLOW][CHECK] watchdog fired; un-sticking"); } catch {}
          setIsChecking(false);
          setSuppressLive(false);
          setScanResult({ text: "Check timed out", kind: "error" });
          try { if (scanResultTimerRef.current) clearTimeout(scanResultTimerRef.current); } catch {}
          scanResultTimerRef.current = window.setTimeout(() => {
            setScanResult(null);
            scanResultTimerRef.current = null;
          }, 1800);
        }
      }, CFG.CHECK_CLIENT_MS + 1200);
      try { lastRunHadFailuresRef.current = false; } catch {}
      setCheckFailures(null);
      setShowRemoveCable(false);
      setAwaitingRelease(false);

      try {
        console.log("[FLOW][CHECK] start", {
          mac,
          attempt,
          pinsCount: pins?.length || 0,
        });
        try {
          console.log("[FLOW] State → checking");
        } catch {}
        const clientBudget = CFG.CHECK_CLIENT_MS;
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
        let result: any = {};
        try {
          const ct = res.headers.get("content-type") || "";
          if (ct.includes("application/json")) {
            result = await res.json();
          } else {
            const txt = await res.text();
            try {
              result = txt ? JSON.parse(txt) : {};
            } catch {}
          }
        } catch {}
        if (res.ok) {
          if (DEBUG_LIVE)
            console.log("[FLOW][CHECK] response OK", {
              failures: (result?.failures || []).length,
              unknownFailure: !!result?.unknownFailure,
            });
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
            if (DEBUG_LIVE && activeIds.length)
              console.log("[FLOW][CHECK] cached active KSKs", activeIds);
          } catch {}
          clearRetryTimer();
          const failures: number[] = result.failures || [];
          const unknown = result?.unknownFailure === true;
          try { lastRunHadFailuresRef.current = unknown || failures.length > 0; } catch {}
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
                aliases = mergeAliasesFromItems(
                  itemsPref as Array<{ aliases?: Record<string, string> }>
                );
              }
              if (!aliases || Object.keys(aliases).length === 0) {
                let merged: Record<string, string> = {};
                if (result?.items && Array.isArray(result.items)) {
                  merged = mergeAliasesFromItems(
                    result.items as Array<{ aliases?: Record<string, string> }>
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
              const activeSet = new Set<string>(
                (activeKssks || []).map((s) => String(s).trim())
              );
              const filt = (arr: any[]) =>
                activeSet.size
                  ? arr.filter((it) =>
                      activeSet.has(
                        String(
                          ((it as any).ksk ?? (it as any).kssk) || ""
                        ).trim()
                      )
                    )
                  : arr;
              const itemsActiveArrF = filt(itemsActiveArr);
              const itemsAllArrF = filt(itemsAllArr);

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
                const groupsRaw: Array<{
                  ksk: string;
                  branches: BranchDisplayData[];
                }> = [];
                for (const it of items) {
                  const a = it.aliases || {};
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
                  const contactless = new Set<number>(
                    (Array.isArray((it as any)?.latchPins)
                      ? (it as any).latchPins
                      : latchPins || []
                    ).filter((n: number) => Number.isFinite(n)) as number[]
                  );
                  const idStr = String(
                    ((it as any).ksk ?? (it as any).kssk) || ""
                  );
                  const branchesG = pinsG.map((pin) => {
                    const nameRaw =
                      a[String(pin)] || aliases[String(pin)] || "";
                    const name = nameRaw ? String(nameRaw) : `PIN ${pin}`;
                    return {
                      id: `${idStr}:${pin}`,
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
                  groupsRaw.push({ ksk: idStr, branches: branchesG });
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
                const prev = lastGroupsRef.current || [];
                const have = new Set(groups.map((g) => g.ksk));
                const mergedGroups = [...groups];
                for (const g of prev) {
                  if (!have.has(g.ksk)) mergedGroups.push(g);
                }
                setGroupedBranches(mergedGroups);
                setActiveKssks(mergedGroups.map((g) => g.ksk).filter(Boolean));

                const unionMap: Record<number, string> = {};
                for (const g of groups)
                  for (const b of g.branches)
                    if (typeof b.pinNumber === "number")
                      unionMap[b.pinNumber] = b.branchName;
                const unionPins = Object.keys(unionMap)
                  .map((n) => Number(n))
                  .sort((x, y) => x - y);
                const contactless2 = new Set<number>(
                  (latchPins || []).filter((n) =>
                    Number.isFinite(n)
                  ) as number[]
                );
                return unionPins.map((pin) => ({
                  id: String(pin),
                  branchName: unionMap[pin] || `PIN ${pin}`,
                  testStatus: failures.includes(pin)
                    ? ("nok" as TestStatus)
                    : contactless2.has(pin)
                      ? ("not_tested" as TestStatus)
                      : ("ok" as TestStatus),
                  pinNumber: pin,
                  kfbInfoValue: undefined,
                }));
              } else {
                setGroupedBranches([]);
                setActiveKssks([]);
              }
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
            clearScanOverlayTimeout();
            setSuppressLive(true);
            if (okFlashAllowedRef.current && !okShownOnceRef.current) {
              okShownOnceRef.current = true;
              okForcedRef.current = true;
              setOkFlashTick((t) => t + 1);
            }
            try {
              pollBlockUntilRef.current = Date.now() + 15000; // block idle poll ~15s after success
            } catch {}
            cancel("checkWatchdog");
            await finalizeOkForMac(mac);
            return;
          } else {
            const text = unknown
              ? "CHECK ERROR (no pin list)"
              : `${failures.length} failure${failures.length === 1 ? "" : "s"}`;
            setScanResult({ text, kind: unknown ? "error" : "info" });
            try {
              if (scanResultTimerRef.current)
                clearTimeout(scanResultTimerRef.current);
            } catch {}
            scanResultTimerRef.current = window.setTimeout(() => {
              setScanResult(null);
              scanResultTimerRef.current = null;
            }, 2000);
            setAwaitingRelease(false);
          }
        } else {
          try {
            console.warn("[FLOW][CHECK] non-OK status", { status: res.status });
          } catch {}
          const maxRetries = CFG.RETRIES;
          if (res.status === 429) {
            if (attempt < maxRetries) {
              clearRetryTimer();
              schedule(
                "checkRetry",
                () => {
                  void runCheck(mac, attempt + 1, pins);
                },
                350
              );
            } else {
              console.warn("CHECK busy (429) too many retries");
            }
          } else if (
            res.status === 504 ||
            result?.pending === true ||
            String(result?.code || "").toUpperCase() === "NO_RESULT"
          ) {
            if (attempt < maxRetries) {
              clearRetryTimer();
              schedule(
                "checkRetry",
                () => {
                  void runCheck(mac, attempt + 1, pins);
                },
                250
              );
            } else {
              console.warn("CHECK pending/no-result");
              setDisableOkAnimation(true);
              clearScanOverlayTimeout();
              setTimeout(() => {
                handleResetKfb();
                setGroupedBranches([]);
                setActiveKssks([]);
                setNameHints(undefined);
              }, 1300);
            }
            cancel("checkWatchdog");
          } else {
            console.error("CHECK error:", result);
            setDisableOkAnimation(true);
            clearScanOverlayTimeout();
            setTimeout(() => {
              handleResetKfb();
              setGroupedBranches([]);
              setActiveKssks([]);
              setNameHints(undefined);
            }, 1300);
            cancel("checkWatchdog");
          }
          setAwaitingRelease(false);
        }
      } catch (err) {
        if ((err as any)?.name === "AbortError") {
          if (attempt < CFG.RETRIES) {
            clearRetryTimer();
            schedule(
              "checkRetry",
              () => {
                void runCheck(mac, attempt + 1, pins);
              },
              300
            );
          } else {
            clearScanOverlayTimeout();
            setTimeout(() => {
              handleResetKfb();
              setGroupedBranches([]);
              setActiveKssks([]);
              setNameHints(undefined);
            }, 1300);
          }
          cancel("checkWatchdog");
        } else {
          console.error("CHECK error", err);
          setDisableOkAnimation(true);
          clearScanOverlayTimeout();
          setTimeout(() => {
            handleResetKfb();
            setGroupedBranches([]);
            setActiveKssks([]);
            setNameHints(undefined);
          }, 1300);
          cancel("checkWatchdog");
        }
      } finally {
        if (!mountedRef.current) return;
          if (DEBUG_LIVE) console.log("[FLOW][CHECK] end");
        clearRetryTimer();
        cancel("checkWatchdog");
        // Keep live/checking state if failures occurred, so EV stream remains visible.
        try {
          if (!lastRunHadFailuresRef.current) setIsChecking(false);
        } catch {
          setIsChecking(false);
        }
        // Short cooldown so stray duplicate scans don’t retrigger immediately
        try { idleCooldownUntilRef.current = Date.now() + CFG.RETRY_COOLDOWN_MS; } catch {}
        // Block re-triggers for the same MAC for a short window unless user explicitly scans again
        try {
          const macUp = String(mac).toUpperCase();
          if (macUp) {
            blockedMacRef.current.add(macUp);
            window.setTimeout(() => {
              try { blockedMacRef.current.delete(macUp); } catch {}
            }, 8000);
          }
        } catch {}
      }
    },
    [
      clearRetryTimer,
      schedule,
      finalizeOkForMac,
      latchPins,
      activeKssks,
      handleResetKfb,
    ]
  );

  // ----- LOAD + MONITOR + AUTO-CHECK FOR A SCAN -----
  const loadBranchesData = useCallback(
    async (
      value?: string,
      source: "scan" | "manual" = "scan",
      trigger: ScanTrigger = "sse"
    ) => {
      try {
        console.log("[FLOW][LOAD] start", {
          source,
          value: (value ?? kfbInputRef.current).trim(),
        });
      } catch {}
      setOkFlashTick(0);
      setDisableOkAnimation(false);
      try {
        console.log("[FLOW] State → scanning");
      } catch {}
      const kfbRaw = (value ?? kfbInputRef.current).trim();
      if (!kfbRaw) return;
      const normalized = kfbRaw.toUpperCase();
      const macCanon = canonicalMac(normalized);
      const isMac = !!macCanon;
      if (!isMac && !KFB_REGEX.test(normalized)) {
        if (source === "manual") {
          setErrorMsg("Invalid code. Expected MAC like AA:BB:CC:DD:EE:FF");
        }
        console.warn("[FLOW][SCAN] rejected by patterns", { normalized });
        return;
      }
      lastScanRef.current = normalized;
      if (source === "scan") {
        setShowScanUi(true);
        try {
          scanStartedAtRef.current = Date.now();
        } catch {}
      }
      setIsScanning(true);
      try {
        console.log("[FLOW] State → scanning");
      } catch {}
      setErrorMsg(null);
      setKfbInfo(null);
      setCheckFailures(null);

      try {
        const mac = isMac ? (macCanon as string) : normalized;

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

        let activeIds: string[] = await (async () => {
          if (!FLAGS.USE_LOCKS) return [] as string[];
          try {
            const r = await fetch("/api/ksk-lock", { cache: "no-store" });
            if (!r.ok) return [] as string[];
            const j = await r.json();
            const rows: Array<{ ksk?: string; kssk?: string; mac?: string }> =
              Array.isArray(j?.locks) ? j.locks : [];
            const MAC = mac.toUpperCase();
            const list = rows
              .filter((l) => String(l?.mac || "").toUpperCase() === MAC)
              .map((l) => String((l as any).ksk ?? (l as any).kssk).trim())
              .filter(Boolean);
            const uniq = Array.from(new Set(list));
            if (DEBUG_LIVE)
              console.log("[ACTIVE] KSK ids from locks", { mac: MAC, ids: uniq });
            return uniq;
          } catch {
            return [] as string[];
          }
        })();
        if (activeIds.length > 3) activeIds = activeIds.slice(0, 3);
        if (activeIds.length) setActiveKssks(activeIds);
        {
            try {
              if (FLAGS.REHYDRATE_ON_LOAD) {
                if (DEBUG_LIVE)
                  console.log("[FLOW][LOAD] POST /api/aliases/rehydrate", {
                    mac,
                  });
                await fetch("/api/aliases/rehydrate", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ mac }),
                }).catch(() => {});
                if (DEBUG_LIVE) console.log("[FLOW][LOAD] rehydrate done");
              }
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

              const itemsFiltered = activeIds.length
                ? items.filter((it: any) =>
                    activeIds.includes(String((it.ksk ?? it.kssk) || "").trim())
                  )
                : [];

              if (itemsFiltered.length) {
                try {
                  console.log("[FLOW][LOAD] aliases snapshot items", {
                    count: itemsFiltered.length,
                  });
                } catch {}
                const groupsRaw = itemsFiltered.map((it: any) => {
                  const a = it.aliases || {};
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
                    const nameRaw =
                      a[String(pin)] || aliases[String(pin)] || "";
                    const name = nameRaw ? String(nameRaw) : `PIN ${pin}`;
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
                    // Fallback: derive aliases from items if union lacks them
                    if (Object.keys(aliases).length === 0) {
                      aliases = mergeAliasesFromItems(itemsFiltered as any);
                    }
                    try {
                      const filtered = computeActivePins(
                        itemsFiltered as any,
                        activeIds
                      );
                      setNormalPins(filtered.normal);
                      setLatchPins(filtered.latch);
                      pins = Array.from(
                        new Set([...filtered.normal, ...filtered.latch])
                      ).sort((a, b) => a - b);
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
        // Even if there are no aliases/pins/groups yet, proceed to CHECK.
        // The server can merge pins (union/client) and return failures/union pins we can render.

        setBranchesData([]);

        try {
          console.log("[FLOW][LOAD] final pins for CHECK", pins);
        } catch {}

        const hasRealData =
          (Array.isArray(pins) && pins.length > 0) ||
          (Array.isArray(activeIds) && activeIds.length > 0) ||
          (aliases && Object.keys(aliases).length > 0);
        if (trigger === "poll" && !hasRealData) {
          if (DEBUG_LIVE)
            console.log("[FLOW][LOAD] drop poll-trigger with no data");
          setIsScanning(false);
          setShowScanUi(false);
          return;
        }

        // Explicit scans with no Redis data
        if (!hasRealData && (trigger === "sse" || trigger === "manual")) {
          // If configured, show hint and abort quickly back to idle; otherwise, proceed to CHECK anyway
          if (!FLAGS.CHECK_ON_EMPTY) {
            try {
              setScanResult({ text: "NOTHING TO CHECK HERE", kind: "info" });
              if (scanResultTimerRef.current) clearTimeout(scanResultTimerRef.current);
              const HINT_MS = 1200;
              scanResultTimerRef.current = window.setTimeout(() => {
                setScanResult(null);
                scanResultTimerRef.current = null;
                try {
                  // Avoid STOP-path cleanup thrash since we're bailing intentionally
                  skipStopCleanupNextRef.current = true;
                  handleResetKfb();
                } catch {}
                // Clear cooldown fully after reset so next scan binds immediately
                try { idleCooldownUntilRef.current = 0; } catch {}
              }, HINT_MS);
              const macUp = (mac || "").toUpperCase();
              if (macUp) {
                // Briefly block this MAC so we don't re-trigger a loop
                blockedMacRef.current.add(macUp);
                window.setTimeout(() => {
                  try { blockedMacRef.current.delete(macUp); } catch {}
                }, 1800);
              }
              // Do NOT arm next scan automatically; require a fresh user action
              // Pause polling briefly
              try { pollBlockUntilRef.current = Date.now() + 1500; } catch {}
            } catch {}
            setIsScanning(false);
            setShowScanUi(false);
            return;
          } else if (FLAGS.HINT_ON_EMPTY) {
            try {
              setScanResult({ text: "NOTHING TO CHECK HERE — running check…", kind: "info" });
              if (scanResultTimerRef.current) clearTimeout(scanResultTimerRef.current);
              scanResultTimerRef.current = window.setTimeout(() => {
                setScanResult(null);
                scanResultTimerRef.current = null;
              }, 1500);
            } catch {}
          }
        }

        // Proceed to CHECK (supports server-side pin merge)
        await runCheck(mac, 0, pins);
      } catch (e) {
        console.error("Load/MONITOR error:", e);
        setKfbNumber("");
        setKfbInfo(null);
        const msg =
          "Failed to load setup data. Please run Setup or scan MAC again.";
        setErrorMsg(msg);
        setDisableOkAnimation(true);
      } finally {
        setIsScanning(false);
        setShowScanUi(false);
      }
    },
    [runCheck]
  );

  type ScanTrigger = "sse" | "poll" | "manual";

  const handleScan = useCallback(
    async (raw: string, trig: ScanTrigger = "sse") => {
      // Global cooldown after a check completes or stuck-scan path (but allow manual/armed scans)
      if (trig !== "manual" && Date.now() < (idleCooldownUntilRef.current || 0)) return;
      const normalized = (raw || "").trim().toUpperCase();
      if (!normalized) return;
      // Drop stale codes immediately after finalize to avoid phantom re-triggers
      const recentlyFinalized = (() => {
        try {
          const lastMac = (lastFinalizedMacRef.current || "").toUpperCase();
          const lastAt = Number((lastFinalizedAtRef as any)?.current || 0);
          return !!(lastMac && normalized === lastMac && Date.now() - lastAt < 2 * 60_000);
        } catch {
          return false;
        }
      })();
      if (trig !== "manual" && recentlyFinalized) {
        if (DEBUG_LIVE)
          console.log("[FLOW][SCAN] drop: recently finalized", { normalized });
        return;
      }
      if (
        blockedMacRef.current.has(normalized) ||
        (canonicalMac(normalized) &&
          blockedMacRef.current.has(canonicalMac(normalized)!.toUpperCase()))
      ) {
        try {
          console.log("[FLOW][SCAN] blocked (cooldown)", { normalized });
        } catch {}
        return;
      }
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
        try {
          console.warn("[FLOW][SCAN] invalid format", { normalized });
        } catch {}
        return;
      }

      if (isScanningRef.current || scanInFlightRef.current) return;
      scanInFlightRef.current = true;
      try {
        console.log("[FLOW][SCAN] starting load");
        await loadBranchesData(normalized, trig === "manual" ? "manual" : "scan", trig);
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

  // Consume SSE scanner events (gated by desired port); ignore background scans when no MAC unless armedOnce
  useEffect(() => {
    if (mainView !== "dashboard") return;
    if (isSettingsSidebarOpen) return;
    if (!(serial as any).lastScanTick) return;
    // Allow a one-shot arm to treat next scan as an explicit user action (e.g., Dev Simulate Run Check)
    const armedOnce = (() => {
      try { return !!(window as any).__armScanOnce__; } catch { return false; }
    })();
    // If no MAC is active and we're not armed, ignore background scans
    if (!(macAddress && macAddress.trim()) && !armedOnce) return;
    const want = resolveDesiredPath();
    const seen = lastScanPath;
    if (!armedOnce && want && seen && !pathsEqual(seen, want)) {
      const noDevices = !((serial as any).scannersDetected > 0);
      if (!noDevices) return;
    }
    const code = (serial as any).lastScan;
    if (!code) return;
    // Ignore incoming scans while a CHECK is active or while we're already scanning
    if (isCheckingRef.current || isScanningRef.current) return;
    const norm = String(code).trim().toUpperCase();
    if (!norm) return;
    // If armed for a one-shot scan, treat as manual and bypass cooldown/blocks
    if (armedOnce) {
      try { delete (window as any).__armScanOnce__; } catch {}
      void handleScan(norm, "manual");
      return;
    }
    // Respect global scan cooldown
    if (Date.now() < (idleCooldownUntilRef.current || 0)) return;
    // Sticky MAC: ignore repeats of the current MAC until reset
    const curMac = (macRef.current || "").toUpperCase();
    if (curMac && norm === curMac) return;
    // Ignore if MAC is temporarily blocked (post-success or stuck)
    if (blockedMacRef.current.has(norm)) return;
    // Also ignore if this matches a recently finalized MAC
    try {
      const lastMac = (lastFinalizedMacRef.current || "").toUpperCase();
      const lastAt = Number(lastFinalizedAtRef.current || 0);
      if (lastMac && norm === lastMac && Date.now() - lastAt < 2 * 60_000) return;
    } catch {}
    void handleScan(norm, "sse");
  }, [
    (serial as any).lastScanTick,
    lastScanPath,
    handleScan,
    mainView,
    isSettingsSidebarOpen,
  ]);

  // Polling fallback (explicit opt-in). Poll when SSE is disconnected OR when last scan is stale.
  useEffect(() => {
    if (!FLAGS.SCANNER_POLL) return;
    if (mainView !== "dashboard") return;
    if (isSettingsSidebarOpen) return;
    // Only poll when truly idle on the scan screen (no active MAC and not checking/scanning)
    if (suppressLive) return;
    if (macAddress && macAddress.trim()) return;
    if (isCheckingRef.current) return;
    if (isScanningRef.current) return;
    // Cooldown after a successful check/finalize to avoid immediate polling
    try {
      const until = pollBlockUntilRef.current as number | undefined;
      if (typeof until === 'number' && Date.now() < until) return;
    } catch {}
    const STALE_MS_RAW = Number(
      process.env.NEXT_PUBLIC_SCANNER_POLL_IF_STALE_MS ?? "4000"
    );
    const STALE_MS = isFinite(STALE_MS_RAW) ? STALE_MS_RAW : 4000;
    if (STALE_MS <= 0) return; // disabled by config
    const lastAt = (serial as any).lastScanAt as number | null | undefined;
    const stale =
      !(typeof lastAt === "number" && isFinite(lastAt)) ||
      Date.now() - (lastAt as number) > STALE_MS;
    // If SSE is connected but stale, allow polling to consume simulated scans.

    let stopped = false;
    let lastPollAt = 0;
    if (pollActiveRef.current) return;
    pollActiveRef.current = true;
    let timer: number | null = null;
    let ctrl: AbortController | null = null;

    const tick = async () => {
      try {
        try {
          const until = pollBlockUntilRef.current as number | undefined;
          if (typeof until === 'number' && Date.now() < until) {
            stopped = true;
            pollActiveRef.current = false;
            return;
          }
        } catch {}
        // Stop polling if SSE becomes healthy and scan activity is fresh while we are running
        const lastAtNow = (serial as any).lastScanAt as
          | number
          | null
          | undefined;
        const sseOkNow = !!(serial as any).sseConnected;
        const staleNow =
          !(typeof lastAtNow === "number" && isFinite(lastAtNow)) ||
          Date.now() - (lastAtNow as number) > STALE_MS;
        if (sseOkNow && !staleNow) {
          stopped = true;
          pollActiveRef.current = false;
          return;
        }
        if (isScanningRef.current) {
          if (!stopped) timer = window.setTimeout(tick, 500);
          return;
        }
        ctrl = new AbortController();
        const want = resolveDesiredPath();
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
            if (typeof retryInMs === "number") pollRetryMsRef.current = retryInMs;
          } catch {}
          const raw = typeof code === "string" ? code.trim() : "";
          if (raw) {
            const norm = raw.toUpperCase();
            if (path && !isAcmPath(path)) return;
            if (want && path && !pathsEqual(path, want)) return;
            // Sticky MAC: ignore repeats of the current MAC
            const curMac = (macRef.current || "").toUpperCase();
            if (curMac && norm === curMac) return;
            // Require explicit arm when idle (no bound MAC)
            if (!curMac) {
              let armedOnce = false;
              try { armedOnce = !!(window as any).__armScanOnce__; } catch {}
              if (!armedOnce) return;
              try { delete (window as any).__armScanOnce__; } catch {}
            }
            // Respect global cooldown and blocked list
            if (Date.now() < (idleCooldownUntilRef.current || 0)) return;
            if (blockedMacRef.current.has(norm)) return;
            // Also ignore if recently finalized
            try {
              const lastMac = (lastFinalizedMacRef.current || "").toUpperCase();
              const lastAt = Number(lastFinalizedAtRef.current || 0);
              if (lastMac && norm === lastMac && Date.now() - lastAt < 2 * 60_000) return;
            } catch {}
            if (isCheckingRef.current) enqueueScan(norm);
            else await handleScan(norm, "manual");
          } else if (error) {
            const str = String(error);
            const lower = str.toLowerCase();
            const isNotPresent =
              lower.includes("scanner port not present") ||
              lower.includes("disconnected:not_present") ||
              lower.includes("not present") ||
              lower.includes("not_present");
            if (!isNotPresent) {
              setScanResult({ text: str, kind: "error" });
              try { if (scanResultTimerRef.current) clearTimeout(scanResultTimerRef.current); } catch {}
              scanResultTimerRef.current = window.setTimeout(() => {
                setScanResult(null);
                scanResultTimerRef.current = null;
              }, 2000);
              console.warn("[SCANNER] poll error", error);
            } else {
              setErrorMsg(null);
            }
          }
        }
      } catch (e) {
        if (!(e instanceof DOMException && e.name === "AbortError")) {
          console.error("[SCANNER] poll error", e);
        }
      } finally {
        const now = Date.now();
        const delay =
          typeof pollRetryMsRef.current === "number"
            ? pollRetryMsRef.current
            : undefined;
        let nextMs = typeof delay === "number" && delay > 0 ? delay : 1800;
        const elapsed = now - lastPollAt;
        if (elapsed < nextMs) nextMs = Math.max(nextMs, 1800 - elapsed);
        lastPollAt = now + nextMs;
        if (!stopped) timer = window.setTimeout(tick, nextMs);
      }
    };

    tick();
    return () => {
      stopped = true;
      pollActiveRef.current = false;
      if (timer) window.clearTimeout(timer);
      if (ctrl) ctrl.abort();
    };
  }, [
    mainView,
    isSettingsSidebarOpen,
    handleScan,
    macAddress,
    suppressLive,
    (serial as any).lastScanAt,
    (serial as any).sseConnected,
  ]);

  // Process most recent queued scan after CHECK ends (guarded)
  useEffect(() => {
    if (!isChecking) {
      const t = setTimeout(() => {
        const q = pendingScansRef.current;
        if (!q.length) return;
        const next = q[q.length - 1]!;
        pendingScansRef.current = [];
        try {
          // Cooldown: avoid immediate re-run and ignore duplicates for current MAC
          if (Date.now() < (idleCooldownUntilRef.current || 0)) return;
          const cur = (macAddress || "").toUpperCase();
          if (cur && next.toUpperCase() === cur) return;
          void handleScanRef.current(next);
        } catch {}
      }, 50);
      return () => clearTimeout(t);
    }
  }, [isChecking]);

  // Manual submit
  const handleKfbSubmit = (e: FormEvent) => {
    e.preventDefault();
    try {
      console.log("[FLOW][MANUAL] submit", { value: kfbInputRef.current });
    } catch {}
    void loadBranchesData(kfbInputRef.current, "manual", "manual");
  };

  const handleManualSubmit = (submittedNumber: string) => {
    const val = submittedNumber.trim().toUpperCase();
    if (!val) return;
    if (!(canonicalMac(val) || KFB_REGEX.test(val))) {
      setErrorMsg("Invalid code. Expected MAC like AA:BB:CC:DD:EE:FF");
      return;
    }
    const mac = canonicalMac(val);
    const next = mac || val;
    setKfbInput(next);
    setKfbNumber(next);
    void loadBranchesData(next, "manual", "manual");
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

  // Derived HUD state (idle / scanning / toast)
  const scannerDetected = useMemo(() => {
    try {
      return (
        (serial as any).scannersDetected > 0 || !!(serial as any).sseConnected
      );
    } catch {
      return false;
    }
  }, [(serial as any).scannersDetected, (serial as any).sseConnected]);

  const hudMode: HudMode | null = useMemo(() => {
    if (mainView !== "dashboard") return null;
    if (isScanning && showScanUi) return "scanning";
    if (scanResult) return scanResult.kind;
    const hasMac = !!(macAddress && macAddress.trim());
    if (!hasMac) return "idle";
    return null;
  }, [mainView, isScanning, showScanUi, scanResult, macAddress]);

  // When HUD returns to idle, allow immediate scan by clearing cooldown/blocks
  useEffect(() => {
    if (hudMode === "idle") {
      try { idleCooldownUntilRef.current = 0; } catch {}
      try { blockedMacRef.current.clear(); } catch {}
    }
  }, [hudMode]);

  const hudMessage = useMemo(() => {
    if (hudMode === "scanning") return "Scanning…";
    if (hudMode === "error") return scanResult?.text || "Error";
    if (hudMode === "info") return scanResult?.text || "Notice";
    if (hudMode === "idle") return "Scan a barcode to begin";
    return undefined;
  }, [hudMode, scanResult?.text]);

  const hudSubMessage = useMemo(() => {
    if (hudMode === "scanning") return "Hold steady for a moment";
    if (hudMode === "idle") {
      return scannerDetected
        ? "Use the scanner."
        : "Scanner not detected. You can still enter a MAC address.";
    }
    if (hudMode === "info" && redisDegraded)
      return "Live cache recently degraded—retry if needed.";
    return undefined;
  }, [hudMode, scannerDetected, redisDegraded]);

  // Stable empty collections to reduce child re-renders
  const EMPTY_BRANCHES: ReadonlyArray<BranchDisplayData> = useMemo(
    () => Object.freeze([] as BranchDisplayData[]),
    []
  );
  const EMPTY_GROUPS: ReadonlyArray<{
    ksk: string;
    branches: BranchDisplayData[];
  }> = useMemo(
    () =>
      Object.freeze(
        [] as Array<{ ksk: string; branches: BranchDisplayData[] }>
      ),
    []
  );
  const EMPTY_IDS: ReadonlyArray<string> = useMemo(
    () => Object.freeze([] as string[]),
    []
  );

  // Memoized derived props for the dashboard content
  const derived = useMemo(() => {
    const hasMac = !!(macAddress && macAddress.trim());
    return {
      effBranches: hasMac
        ? branchesData
        : (EMPTY_BRANCHES as BranchDisplayData[]),
      effGroups: hasMac
        ? groupedBranches
        : (EMPTY_GROUPS as Array<{
            ksk: string;
            branches: BranchDisplayData[];
          }>),
      effFailures: hasMac ? checkFailures : null,
      effActiveKssks: hasMac ? activeKssks : (EMPTY_IDS as string[]),
      effNormalPins: hasMac ? normalPins : undefined,
      effLatchPins: hasMac ? latchPins : undefined,
    };
  }, [
    macAddress,
    branchesData,
    groupedBranches,
    checkFailures,
    activeKssks,
    normalPins,
    latchPins,
    EMPTY_BRANCHES,
    EMPTY_GROUPS,
    EMPTY_IDS,
  ]);

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
            serial={serial}
            onSettingsClick={handleHeaderClick}
            currentView={appCurrentViewType}
            isSidebarOpen={isLeftSidebarOpen}
            onToggleSidebar={toggleLeftSidebar}
          />
        )}

        {/* Inline HUD moved into scan view (below the prompt) */}

        <main className="flex-1 overflow-auto bg-white">
          {mainView === "dashboard" ? (
            <>
              {/* Scanner badges removed; errors handled inline */}
              <BranchDashboardMainContent
                appHeaderHeight={actualHeaderHeight}
                onManualSubmit={handleManualSubmit}
                onScanAgainRequest={loadBranchesData}
                hudMode={hudMode}
                hudMessage={hudMessage}
                hudSubMessage={hudSubMessage}
                onHudDismiss={
                  scanResult ? () => setScanResult(null) : undefined
                }
                branchesData={derived.effBranches}
                groupedBranches={derived.effGroups}
                checkFailures={derived.effFailures}
                nameHints={nameHints}
                kfbNumber={kfbNumber}
                kfbInfo={kfbInfo}
                isScanning={isScanning && showScanUi}
                macAddress={macAddress}
                activeKssks={derived.effActiveKssks}
                lastEv={suppressLive ? null : (serial as any).lastEv}
                lastEvTick={suppressLive ? 0 : (serial as any).lastEvTick}
                normalPins={suppressLive ? undefined : derived.effNormalPins}
                latchPins={suppressLive ? undefined : derived.effLatchPins}
                onResetKfb={handleResetKfb}
                onFinalizeOk={finalizeOkForMac}
                flashOkTick={okFlashTick}
                okSystemNote={okSystemNote}
                disableOkAnimation={disableOkAnimation}
                scanResult={scanResult}
              />

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

      <style>{`
        /* Subtle entrance */
        .hud-enter {
          transform: translateY(-6px);
          opacity: 0;
          animation: hudIn 220ms ease-out forwards;
        }
        @keyframes hudIn {
          to { transform: translateY(0); opacity: 1; }
        }

        /* Pulse ring around the barcode icon */
        .hud-pulse-circle {
          position: relative;
          width: 40px;
          height: 40px;
          display: grid;
          place-items: center;
          border-radius: 9999px;
          background: radial-gradient(closest-side, white 75%, transparent 76%);
          overflow: visible;
        }
        .hud-pulse-circle::before, .hud-pulse-circle::after {
          content: "";
          position: absolute;
          inset: 0;
          border-radius: 9999px;
          border: 2px solid rgba(15, 23, 42, 0.15);
          transform: scale(1);
          opacity: 1;
          animation: hudPulse 1500ms ease-out infinite;
        }
        .hud-pulse-circle::after {
          animation-delay: 300ms;
        }
        .hud-pulse-blue::before,
        .hud-pulse-blue::after {
          border-color: rgba(29, 78, 216, 0.25);
        }
        @media (prefers-reduced-motion: reduce) {
          .hud-pulse-circle::before,
          .hud-pulse-circle::after { animation: none; opacity: .6; }
        }
        @keyframes hudPulse {
          from { transform: scale(1); opacity: .9; }
          to   { transform: scale(1.5); opacity: 0; }
        }

        /* Shimmer progress for scanning */
        .hud-shimmer {
          background: linear-gradient(90deg, rgba(59,130,246,.0) 0%, rgba(59,130,246,.35) 50%, rgba(59,130,246,.0) 100%);
          background-size: 200% 100%;
          animation: hudShimmer 1.25s linear infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .hud-shimmer { animation: none; }
        }
        @keyframes hudShimmer {
          from { background-position: -200% 0; }
          to   { background-position: 200% 0; }
        }

        .hud-icon-wrap {
          width: 40px; height: 40px; display: grid; place-items: center;
          border-radius: 9999px; background: white;
        }

        /* Scanner dots (unused currently, handy for future) */
        .hud-dot {
          display: inline-block; width: 6px; height: 6px; margin-right: 6px;
          border-radius: 9999px; background: currentColor; opacity: .75;
          animation: hudDots 900ms ease-in-out infinite;
        }
        .hud-dot:nth-child(2) { animation-delay: 150ms; }
        .hud-dot:nth-child(3) { animation-delay: 300ms; }
        @keyframes hudDots {
          0%, 100% { transform: translateY(0); opacity: .6; }
          50% { transform: translateY(-2px); opacity: 1; }
        }

        /* Existing */
        .plug-wiggle { animation: wiggle 1s ease-in-out infinite; }
        @keyframes wiggle { 0%,100% { transform: translateX(0) } 50% { transform: translateX(8px) } }
      `}</style>
    </div>
  );
};

export default MainApplicationUI;
