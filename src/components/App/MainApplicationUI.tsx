"use client";

import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  type SetStateAction,
} from "react";
import { BranchDisplayData, KfbInfo } from "@/types/types";
import { Header } from "@/components/Header/Header";
import BranchDashboardMainContent from "@/components/Program/BranchDashboardMainContent";
import { readScanScope, subscribeScanScope } from "@/lib/scanScope";
import { UnionEffect } from "./components/UnionEffect";
import { AutoFinalizeEffect } from "./components/AutoFinalizeEffect";
import { DeviceEventsEffect } from "./components/DeviceEventsEffect";
import { PollingEffect } from "./components/PollingEffect";
import { PostResetSanityEffect } from "./components/PostResetSanityEffect";
import { RedisHealthEffect } from "./components/RedisHealthEffect";
import { ScannerEffect } from "./components/ScannerEffect";
import { maskSimMac } from "@/lib/macDisplay";
import useConfig from "./hooks/useConfig";
import useTimers from "./hooks/useTimers";
import useHud, { ScanResultState } from "./hooks/useHud";
import useSerialLive from "./hooks/useSerialLive";
import useFinalize from "./hooks/useFinalize";
import useScanFlow, { ScanTrigger, NO_SETUP_MSG } from "./hooks/useScanFlow";
import { canonicalMac, macKey, MAC_ONLY_REGEX } from "./utils/mac";
import {
  isAcmPath,
  pathsEqual as pathsEqualUtil,
  resolveDesiredPath as resolveDesiredPathUtil,
} from "./utils/paths";
import { computeActivePins as computeActivePinsUtil } from "./utils/merge";
import { AnimatePresence, m } from "framer-motion";
import { useTheme } from "next-themes";
import { useInitialTheme } from "@/app/theme-provider";

/* =================================================================================
 * Constants & helpers
 * ================================================================================= */

const ZERO_MAC = "00:00:00:00:00:00" as const;

type MainView = "dashboard" | "settingsConfiguration" | "settingsBranches";

/** How long info banners should stay visible (ms) */
const INFO_AUTO_HIDE_MS = Math.max(
  1200,
  Number(process.env.NEXT_PUBLIC_INFO_HIDE_MS ?? "4500")
);

/** Default cooldown between simulator retries (ms) */
const SIMULATE_COOLDOWN_BASE_MS = Math.max(
  500,
  Number(process.env.NEXT_PUBLIC_SIMULATE_MIN_COOLDOWN_MS ?? 500)
);

const SIMULATE_COOLDOWN_FLOOR_MS = 500;

/** Small framer-motion variants shared by banners */
const bannerVariants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.22 } },
  exit: { opacity: 0, y: -8, transition: { duration: 0.18 } },
};

const dedupeCasePreserving = (
  values?: Iterable<string | null | undefined>
): string[] => {
  if (!values) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const original = String(raw || "").trim();
    if (!original) continue;
    const key = original.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(original);
  }
  return out;
};

class CaseInsensitiveSet extends Set<string> {
  add(value: string): this {
    return super.add(
      String(value || "")
        .trim()
        .toUpperCase()
    );
  }

  has(value: string): boolean {
    return super.has(
      String(value || "")
        .trim()
        .toUpperCase()
    );
  }
}

/* =================================================================================
 * Small UI: Animated HUD Banner
 * ================================================================================= */

type BannerKind = "idle" | "info" | "error" | "success";

interface BannerState {
  key: string;
  title: string;
  subtitle?: string;
  kind: BannerKind;
}

/** A minimal, centered, animated banner overlay. */
const HudBanner: React.FC<{ banner: BannerState | null }> = ({ banner }) => {
  return (
    <div className="pointer-events-none absolute inset-0 z-[12] flex items-center justify-center">
      <AnimatePresence mode="wait">
        {banner && (
          <m.div
            key={banner.key}
            variants={bannerVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="text-center"
          >
            <div
              className={[
                "rounded-xl border px-6 py-4 shadow-sm",
                banner.kind === "error"
                  ? "border-rose-200 bg-rose-50/80"
                  : banner.kind === "success"
                    ? "border-emerald-200 bg-emerald-50/80"
                    : banner.kind === "info"
                      ? "border-sky-200 bg-sky-50/80"
                      : "border-slate-200/70 bg-white/70",
              ].join(" ")}
              style={{ backdropFilter: "saturate(1.2) blur(2px)" }}
            >
              {/* Title */}
              <div
                className={
                  banner.kind === "idle"
                    ? "text-4xl font-semibold tracking-[0.2em] text-slate-700 md:text-5xl"
                    : "text-xl font-medium text-slate-700 md:text-2xl"
                }
                style={
                  banner.kind === "idle" ? { letterSpacing: "0.18em" } : {}
                }
              >
                {banner.title}
              </div>

              {/* Subtitle */}
              {banner.subtitle && (
                <div className="mt-2 text-sm text-slate-500 md:text-base">
                  {banner.subtitle}
                </div>
              )}
            </div>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
};

/* =================================================================================
 * Main Component
 * ================================================================================= */

const MainApplicationUI: React.FC = () => {
  const { CFG, FLAGS, ASSUME_REDIS_READY } = useConfig();
  const { resolvedTheme, theme, setTheme } = useTheme();
  const initialTheme = useInitialTheme();
  const [themeMounted, setThemeMounted] = useState(false);
  useEffect(() => setThemeMounted(true), []);
  const effectiveTheme = (() => {
    if (!themeMounted) return initialTheme;
    if (resolvedTheme) return resolvedTheme;
    if (theme === "dark" || theme === "light") return theme;
    return initialTheme;
  })();
  const isDarkMode = effectiveTheme === "dark";
  const gradientLight =
    "radial-gradient(160% 160% at 0% -35%, #eef3ff 0%, #f6f9ff 55%, #ffffff 100%)";
  const gradientDark = "#222222";
  const appBackground = isDarkMode ? gradientDark : gradientLight;
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!themeMounted) return;
    const nextTheme =
      resolvedTheme ||
      (theme === "dark" || theme === "light" ? theme : undefined) ||
      initialTheme;
    if (!nextTheme) return;
    const normalized = nextTheme === "dark" ? "dark" : "light";
    const root = document.documentElement;
    if (normalized === "dark") {
      root.classList.add("dark");
      root.classList.remove("light");
    } else {
      root.classList.remove("dark");
      root.classList.add("light");
    }
  }, [resolvedTheme, theme, themeMounted, initialTheme]);
  const mainSurfaceBg = "transparent";
  const mainSurfaceBorder = isDarkMode
    ? "rgba(255,255,255,0.06)"
    : "rgba(15,23,42,0.06)";

  const simulateCooldownMs = useMemo(() => {
    const cfgMs = Number.isFinite(CFG.RETRY_COOLDOWN_MS)
      ? CFG.RETRY_COOLDOWN_MS
      : SIMULATE_COOLDOWN_BASE_MS;
    const limited = Math.min(cfgMs, SIMULATE_COOLDOWN_BASE_MS);
    return Math.max(SIMULATE_COOLDOWN_FLOOR_MS, limited);
  }, [CFG.RETRY_COOLDOWN_MS]);

  /* -----------------------------------------------------------------------------
   * Basic UI state
   * ---------------------------------------------------------------------------*/
  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(false);
  const [isSettingsSidebarOpen, setIsSettingsSidebarOpen] = useState(false);
  const [mainView, setMainView] = useState<MainView>("dashboard");

  const [setupScanActive, setSetupScanActive] = useState<boolean>(() =>
    readScanScope("setup")
  );
  useEffect(() => {
    const unsubscribe = subscribeScanScope("setup", setSetupScanActive);
    return () => {
      try {
        unsubscribe();
      } catch {}
    };
  }, []);

  const [simSetupOverride, setSimSetupOverride] = useState(false);
  const simOverrideTimerRef = useRef<number | null>(null);
  const clearSimOverrideTimer = useCallback(() => {
    if (simOverrideTimerRef.current != null) {
      try {
        if (typeof window !== "undefined")
          window.clearTimeout(simOverrideTimerRef.current);
      } catch {}
      simOverrideTimerRef.current = null;
    }
  }, []);
  const disableSimOverride = useCallback(() => {
    clearSimOverrideTimer();
    setSimSetupOverride(false);
  }, [clearSimOverrideTimer]);
  const enableSimOverride = useCallback(
    (ms = 300_000) => {
      setSimSetupOverride(true);
      clearSimOverrideTimer();
      if (typeof window !== "undefined") {
        simOverrideTimerRef.current = window.setTimeout(() => {
          setSimSetupOverride(false);
          simOverrideTimerRef.current = null;
        }, ms);
      }
    },
    [clearSimOverrideTimer]
  );
  useEffect(() => {
    if (!setupScanActive) disableSimOverride();
  }, [setupScanActive, disableSimOverride]);
  useEffect(() => () => disableSimOverride(), [disableSimOverride]);
  const setupGateActive = setupScanActive && !simSetupOverride;

  /* -----------------------------------------------------------------------------
   * Process state
   * ---------------------------------------------------------------------------*/
  const [branchesData, setBranchesData] = useState<BranchDisplayData[]>([]);
  const [groupedBranches, setGroupedBranches] = useState<
    Array<{ ksk: string; branches: BranchDisplayData[] }>
  >([]);
  const [kfbNumber, setKfbNumber] = useState(""); // last scanned code (MAC or KFB)
  const [kfbInfo, setKfbInfo] = useState<KfbInfo | null>(null);
  const [shouldShowHeader, setShouldShowHeader] = useState(false);

  const [macAddress, setMacAddress] = useState("");
  const macRef = useRef<string>("");
  useEffect(() => {
    macRef.current = (macAddress || "").toUpperCase();
  }, [macAddress]);
  const displayMacAddress = useMemo(() => maskSimMac(macAddress), [macAddress]);

  const [isScanning, setIsScanning] = useState(false);
  const [showScanUi, setShowScanUi] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResultState>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [nameHints, setNameHints] = useState<
    Record<string, string> | undefined
  >(undefined);
  const [normalPins, setNormalPins] = useState<number[] | undefined>(undefined);
  const [latchPins, setLatchPins] = useState<number[] | undefined>(undefined);
  const [activeKssksInternal, setActiveKssksInternal] = useState<string[]>([]);
  const activeKssks = activeKssksInternal;
  const setActiveKssks = useCallback((next: SetStateAction<string[]>) => {
    setActiveKssksInternal((prev) => {
      const raw =
        typeof next === "function"
          ? (next as (value: string[]) => string[])(prev)
          : next;
      const canonical = dedupeCasePreserving(raw);
      if (
        canonical.length === prev.length &&
        canonical.every((value, idx) => value === prev[idx])
      ) {
        return prev;
      }
      return canonical;
    });
  }, []);

  const [checkFailures, setCheckFailures] = useState<number[] | null>(null);
  const [isChecking, setIsChecking] = useState(false);

  const isCheckingRef = useRef(false);
  useEffect(() => {
    isCheckingRef.current = isChecking;
  }, [isChecking]);

  const itemsAllFromAliasesRef = useRef<
    Array<{
      ksk: string;
      aliases?: Record<string, string>;
      normalPins?: number[];
      latchPins?: number[];
    }>
  >([]);

  /* Live gating — allow live union/finalize only when we actually have setup data */
  const hasSetupForCurrentMac = useCallback(() => {
    const active = (activeKssks?.length ?? 0) > 0;
    const anyItems = (itemsAllFromAliasesRef.current?.length ?? 0) > 0;
    const havePins =
      (Array.isArray(normalPins) ? normalPins.length : 0) > 0 ||
      (Array.isArray(latchPins) ? latchPins.length : 0) > 0;
    return active || anyItems || havePins;
  }, [activeKssks, normalPins, latchPins]);

  const lastGroupsRef = useRef<
    Array<{ ksk: string; branches: BranchDisplayData[] }>
  >([]);
  useEffect(() => {
    lastGroupsRef.current = groupedBranches;
  }, [groupedBranches]);

  const xmlReadBlockUntilRef = useRef<Map<string, number>>(new Map());
  const finalizeOkGuardRef = useRef<Map<string, number>>(new Map());
  const recentCleanupRef = useRef<Map<string, number>>(new Map());

  const okFlashTickRef = useRef(0);
  const [okFlashTick, setOkFlashTick] = useState(0);
  const [okSystemNote, setOkSystemNote] = useState<string | null>(null);
  const [disableOkAnimation, setDisableOkAnimation] = useState(false);
  const okShownOnceRef = useRef<boolean>(false);
  const okFlashAllowedRef = useRef<boolean>(false);
  const [suppressLive, setSuppressLive] = useState(false);

  const [redisDegraded, setRedisDegraded] = useState(false);
  const prevRedisReadyRef = useRef<boolean | null>(null);
  const redisDropTimerRef = useRef<number | null>(null);
  const lastRedisDropAtRef = useRef<number | null>(null);

  const lastScanRef = useRef("");
  const idleCooldownUntilRef = useRef<number>(0);
  const blockedMacRef = useRef<Set<string>>(new Set());
  const scanResultTimerRef = useRef<number | null>(null);
  const scanOverlayTimerRef = useRef<number | null>(null);
  const lastFinalizedMacRef = useRef<string | null>(null);
  const lastFinalizedAtRef = useRef<number>(0);
  const lastRunHadFailuresRef = useRef<boolean>(false);
  const pendingScansRef = useRef<string[]>([]);
  const lastScanTokenRef = useRef<string>("");
  const lastSimulateCheckTickRef = useRef<number>(0);
  const simulateCooldownUntilRef = useRef<number>(0);
  const pendingSimulateRef = useRef<{ target: string; tick: number } | null>(
    null
  );
  const tryRunPendingSimulateRef = useRef<() => void>(() => {});
  const simulateRetryTimerRef = useRef<number | null>(null);
  const currentCheckTokenRef = useRef<{ mac: string; token: string } | null>(
    null
  );

  const infoTimerRef = useRef<number | null>(null);
  const [infoHideAt, setInfoHideAt] = useState<number | null>(null);

  const { schedule, cancel } = useTimers();

  useEffect(
    () => () => {
      try {
        if (scanResultTimerRef.current) {
          clearTimeout(scanResultTimerRef.current);
          scanResultTimerRef.current = null;
        }
        if (scanOverlayTimerRef.current != null) {
          clearTimeout(scanOverlayTimerRef.current);
          scanOverlayTimerRef.current = null;
        }
        if (infoTimerRef.current) {
          window.clearInterval(infoTimerRef.current);
          infoTimerRef.current = null;
        }
      } catch {}
    },
    []
  );

  // HUD derived
  const hasLiveData = useMemo(() => {
    const anyGroups =
      Array.isArray(groupedBranches) &&
      groupedBranches.some((g) => (g?.branches?.length ?? 0) > 0);
    const anyFlat = Array.isArray(branchesData) && branchesData.length > 0;
    return anyGroups || anyFlat;
  }, [groupedBranches, branchesData]);

  const hasUnion = useMemo(() => {
    const names = nameHints ? Object.keys(nameHints).length : 0;
    const np = Array.isArray(normalPins) ? normalPins.length : 0;
    const lp = Array.isArray(latchPins) ? latchPins.length : 0;
    return np > 0 || lp > 0 || names > 0;
  }, [normalPins, latchPins, nameHints]);

  // Small overlay timing helper
  const startScanOverlayTimeout = useCallback(
    (
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
    },
    []
  );
  const clearScanOverlayTimeout = useCallback(() => {
    if (scanOverlayTimerRef.current != null) {
      try {
        clearTimeout(scanOverlayTimerRef.current);
      } catch {}
      scanOverlayTimerRef.current = null;
    }
  }, []);

  /* -----------------------------------------------------------------------------
   * Serial live
   * ---------------------------------------------------------------------------*/
  const { serial, redisReadyRef } = useSerialLive({
    macAddress,
    setupGateActive,
    suppressLive,
    simulateEnabled: FLAGS.SIMULATE,
    mainView,
  });

  /* -----------------------------------------------------------------------------
   * Core helpers
   * ---------------------------------------------------------------------------*/
  const computeActivePins = useCallback(
    (
      items:
        | Array<{
            ksk?: string;
            kssk?: string;
            normalPins?: number[];
            latchPins?: number[];
          } | null>
        | undefined,
      activeIds: string[] | undefined
    ): { normal: number[]; latch: number[] } =>
      computeActivePinsUtil(items, activeIds),
    []
  );

  // ===== Krosy checkpoint integration =====
  const { OFFLINE_MODE, CHECKPOINT_URL } = useMemo(() => {
    const online =
      String(process.env.NEXT_PUBLIC_KROSY_ONLINE || "")
        .trim()
        .toLowerCase() === "true";
    const sim = String(process.env.NEXT_PUBLIC_SIMULATE || "").trim() === "1";
    const onlineUrl =
      process.env.NEXT_PUBLIC_KROSY_URL_CHECKPOINT_ONLINE ||
      "/api/krosy/checkpoint";
    const offlineUrl =
      process.env.NEXT_PUBLIC_KROSY_URL_CHECKPOINT_OFFLINE ||
      "/api/krosy-offline/checkpoint";

    const selectedUrl = !online || sim ? offlineUrl : onlineUrl;
    const offlineMode =
      (!online || sim) && offlineUrl.includes("/api/krosy-offline/checkpoint");

    return {
      OFFLINE_MODE: offlineMode,
      CHECKPOINT_URL: selectedUrl,
    } as const;
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      (window as any).__KROSY_CHECKPOINT_URL__ = CHECKPOINT_URL;
    }
  }, [CHECKPOINT_URL]);
  const CLIENT_RESULT_URL = (
    process.env.NEXT_PUBLIC_KROSY_RESULT_URL || ""
  ).trim();

  const checkpointSentRef = useRef<Set<string>>(new CaseInsensitiveSet());
  const checkpointMacPendingRef = useRef<Set<string>>(new Set());
  const checkpointBlockUntilTsRef = useRef<number>(0);
  const finalizeInFlightRef = useRef<Map<string, Promise<void>>>(new Map());
  const lastActiveIdsRef = useRef<string[]>([]);
  useEffect(() => {
    lastActiveIdsRef.current = dedupeCasePreserving(activeKssksInternal);
  }, [activeKssksInternal]);
  const noSetupCooldownRef = useRef<{
    mac: string;
    until: number;
    requireManual?: boolean;
  } | null>(null);
  const handleResetKfb = useCallback(() => {
    const clearRetryTimer = () => cancel("checkRetry");
    clearRetryTimer();
    clearScanOverlayTimeout();
    finalizeInFlightRef.current.clear();

    setErrorMsg(null);
    setKfbNumber("");
    setKfbInfo(null);
    setShouldShowHeader(false);
    setBranchesData([]);
    setGroupedBranches([]);
    setActiveKssks([]);
    setNameHints(undefined);
    setNormalPins(undefined);
    setLatchPins(undefined);
    itemsAllFromAliasesRef.current = [];
    lastGroupsRef.current = [];
    lastActiveIdsRef.current = [];
    pendingSimulateRef.current = null;
    simulateCooldownUntilRef.current = 0;
    noSetupCooldownRef.current = null;
    try {
      blockedMacRef.current?.clear();
    } catch {}
    try {
      currentCheckTokenRef.current = null;
    } catch {}
    if (simulateRetryTimerRef.current != null) {
      try {
        window.clearTimeout(simulateRetryTimerRef.current);
      } catch {}
      simulateRetryTimerRef.current = null;
    }

    setMacAddress("");
    setSuppressLive(false);
    disableSimOverride();

    okShownOnceRef.current = false;
    okFlashAllowedRef.current = false;
    setIsChecking(false);
    setIsScanning(false);

    pendingScansRef.current = [];
    lastScanRef.current = "";
    try {
      const now = Date.now();
      for (const [mac, until] of finalizeOkGuardRef.current.entries()) {
        if (!until || until <= now) finalizeOkGuardRef.current.delete(mac);
      }
    } catch {}
  }, [cancel, clearScanOverlayTimeout, disableSimOverride]);

  const prepareForSimulateRun = useCallback(() => {
    setBranchesData([]);
    setGroupedBranches([]);
    setActiveKssks([]);
    setNameHints(undefined);
    setNormalPins(undefined);
    setLatchPins(undefined);
    lastActiveIdsRef.current = [];
  }, [
    setBranchesData,
    setGroupedBranches,
    setActiveKssks,
    setNameHints,
    setNormalPins,
    setLatchPins,
  ]);

  const handleFailuresCleared = useCallback(() => {
    if (lastRunHadFailuresRef.current) {
      lastRunHadFailuresRef.current = false;
    }
    setCheckFailures([]);
  }, [setCheckFailures]);

  const ensureActiveIdsForFinalize = useCallback((): string[] => {
    const adopt = (next: string[]) => {
      lastActiveIdsRef.current = next;
      return next;
    };

    const current = adopt(dedupeCasePreserving(lastActiveIdsRef.current));
    if (current.length) return current;

    const fromState = adopt(dedupeCasePreserving(activeKssks));
    if (fromState.length) return fromState;

    const aliasSnapshot = Array.isArray(itemsAllFromAliasesRef.current)
      ? (itemsAllFromAliasesRef.current as Array<{
          ksk?: string | null;
          kssk?: string | null;
        }>)
      : [];
    const fromAliases = adopt(
      dedupeCasePreserving(
        aliasSnapshot.map((item) => (item?.ksk ?? item?.kssk) || "")
      )
    );
    return fromAliases;
  }, [activeKssks]);

  const { finalizeOkForMac, clearKskLocksFully } = useFinalize({
    cfgRetryCooldownMs: CFG.RETRY_COOLDOWN_MS,
    activeKssks,
    setOkSystemNote,
    setMacAddress,
    setKfbNumber,
    setSuppressLive,
    handleResetKfb,
    lastRunHadFailuresRef,
    finalizeOkGuardRef,
    recentCleanupRef,
    blockedMacRef,
    lastScanRef,
    lastFinalizedMacRef,
    lastFinalizedAtRef,
    lastActiveIdsRef,
    itemsAllFromAliasesRef,
    checkpointSentRef,
    checkpointMacPendingRef,
    checkpointBlockUntilTsRef,
    xmlReadBlockUntilRef,
    offlineMode: OFFLINE_MODE,
    checkpointUrl: CHECKPOINT_URL,
    clientResultUrl: CLIENT_RESULT_URL,
  });

  const awaitFinalizeForMac = useCallback(
    async (rawMac: string) => {
      const mac = String(rawMac || "")
        .trim()
        .toUpperCase();
      if (!mac || !MAC_ONLY_REGEX.test(mac)) return;
      ensureActiveIdsForFinalize();
      const existing = finalizeInFlightRef.current.get(mac);
      if (existing) {
        try {
          await existing;
        } catch {
          // ignore errors; caller will handle retry through normal flow
        }
      }
    },
    [ensureActiveIdsForFinalize]
  );

  const finalizeMacOnce = useCallback(
    (rawMac: string): Promise<void> => {
      const mac = String(rawMac || "")
        .trim()
        .toUpperCase();
      if (!mac || !MAC_ONLY_REGEX.test(mac)) return Promise.resolve();

      ensureActiveIdsForFinalize();
      const existing = finalizeInFlightRef.current.get(mac);
      if (existing) return existing;

      const task = (async () => {
        try {
          await finalizeOkForMac(mac);
        } finally {
          finalizeInFlightRef.current.delete(mac);
        }
      })();
      finalizeInFlightRef.current.set(mac, task);
      return task;
    },
    [ensureActiveIdsForFinalize, finalizeOkForMac]
  );

  const finalizeMacFromUi = useCallback(
    (rawMac: string) => {
      lastRunHadFailuresRef.current = false;
      return finalizeMacOnce(rawMac);
    },
    [finalizeMacOnce]
  );

  const { runCheck, loadBranchesData, handleScan } = useScanFlow({
    CFG: {
      CHECK_CLIENT_MS: CFG.CHECK_CLIENT_MS,
      RETRIES: CFG.RETRIES,
      FINALIZED_RESCAN_BLOCK_MS: CFG.FINALIZED_RESCAN_BLOCK_MS,
      RETRY_COOLDOWN_MS: CFG.RETRY_COOLDOWN_MS,
    },
    FLAGS: {
      REHYDRATE_ON_LOAD: FLAGS.REHYDRATE_ON_LOAD,
      USE_LOCKS: FLAGS.USE_LOCKS,
    },
    schedule,
    cancel,
    computeActivePins,
    finalizeOkForMac: finalizeMacOnce,
    handleResetKfb,
    clearScanOverlayTimeout,
    hasSetupForCurrentMac,
    setIsChecking,
    setSuppressLive,
    setScanResult,
    setCheckFailures,
    setBranchesData,
    setGroupedBranches,
    setActiveKssks,
    setNameHints,
    setNormalPins,
    setLatchPins,
    setDisableOkAnimation,
    setIsScanning,
    setShowScanUi,
    setKfbNumber,
    setMacAddress,
    setShouldShowHeader,
    setOkFlashTick,
    setOkSystemNote,
    setErrorMsg,
    setKfbInfo,
    noSetupCooldownRef,
    isCheckingRef,
    scanResultTimerRef,
    lastRunHadFailuresRef,
    lastActiveIdsRef,
    itemsAllFromAliasesRef,
    lastScanRef,
    blockedMacRef,
    lastFinalizedMacRef,
    lastFinalizedAtRef,
    idleCooldownUntilRef,
    simulateCooldownUntilRef,
    pendingSimulateRef,
    tryRunPendingSimulateRef,
    okFlashAllowedRef,
    okShownOnceRef,
    lastScanTokenRef,
    activeKssks,
    latchPinsValue: latchPins,
    checkTokenRef: currentCheckTokenRef,
    awaitFinalizeForMac,
  });

  const resolveDesiredPath = useCallback(
    (): string | null =>
      resolveDesiredPathUtil((serial as any).scannerPaths || []),
    [serial]
  );

  const pathsEqual = useCallback(
    (a?: string | null, b?: string | null) => pathsEqualUtil(a, b),
    []
  );

  /* -----------------------------------------------------------------------------
   * Load + Check on SCAN (no manual)
   * ---------------------------------------------------------------------------*/
  const handleScanRef = useRef<
    ((raw: string, trig?: ScanTrigger) => Promise<void>) | null
  >(null);
  useEffect(() => {
    handleScanRef.current = handleScan;
  }, [handleScan]);

  const tryRunPendingSimulate = useCallback(() => {
    const pending = pendingSimulateRef.current;
    if (!pending) return;
    if (Array.isArray(checkFailures) && checkFailures.length > 0) {
      pendingSimulateRef.current = null;
      return;
    }
    if (!FLAGS.SIM_AUTORUN) {
      pendingSimulateRef.current = null;
      return;
    }
    const now = Date.now();
    const scheduleRetry = (delay = 250) => {
      if (simulateRetryTimerRef.current != null) return;
      simulateRetryTimerRef.current = window.setTimeout(
        () => {
          simulateRetryTimerRef.current = null;
          tryRunPendingSimulate();
        },
        Math.max(0, delay)
      );
    };

    if (isCheckingRef.current || isScanning) {
      scheduleRetry();
      return;
    }
    if (now < simulateCooldownUntilRef.current) {
      scheduleRetry(simulateCooldownUntilRef.current - now + 10);
      return;
    }
    if (simulateRetryTimerRef.current != null) {
      try {
        window.clearTimeout(simulateRetryTimerRef.current);
      } catch {}
      simulateRetryTimerRef.current = null;
    }
    const targetRaw = pending.target || "";
    const targetKey = macKey(targetRaw);
    const target = targetKey || targetRaw.toUpperCase();
    const lastFinalizedKey = macKey(lastFinalizedMacRef.current || "");
    const lastFinalizedAt = lastFinalizedAtRef.current || 0;
    if (
      lastFinalizedKey &&
      targetKey === lastFinalizedKey &&
      CFG.FINALIZED_RESCAN_BLOCK_MS > 0 &&
      Date.now() - lastFinalizedAt < CFG.FINALIZED_RESCAN_BLOCK_MS
    ) {
      pendingSimulateRef.current = null;
      return;
    }
    const lastScannedKey = macKey(lastScanRef.current || "");
    if (lastScannedKey && targetKey === lastScannedKey) {
      pendingSimulateRef.current = null;
      return;
    }
    const noSetupCooldown = noSetupCooldownRef.current;
    if (noSetupCooldown && noSetupCooldown.mac === targetKey) {
      const requireManual = noSetupCooldown.requireManual !== false;
      if (requireManual) {
        pendingSimulateRef.current = null;
        if (Date.now() < noSetupCooldown.until) {
          scheduleRetry(noSetupCooldown.until - Date.now() + 10);
        }
        return;
      }
      if (Date.now() < noSetupCooldown.until) {
        scheduleRetry(noSetupCooldown.until - Date.now() + 10);
        return;
      }
    }
    pendingSimulateRef.current = null;
    prepareForSimulateRun();
    simulateCooldownUntilRef.current = now + simulateCooldownMs;
    if (setupGateActive) enableSimOverride();
    void handleScanRef.current?.(pending.target, "simulate");
  }, [
    CFG.FINALIZED_RESCAN_BLOCK_MS,
    simulateCooldownMs,
    enableSimOverride,
    isScanning,
    checkFailures,
    lastFinalizedAtRef,
    lastFinalizedMacRef,
    lastScanRef,
    noSetupCooldownRef,
    FLAGS.SIM_AUTORUN,
    setupGateActive,
    prepareForSimulateRun,
  ]);

  useEffect(() => {
    tryRunPendingSimulateRef.current = tryRunPendingSimulate;
  }, [tryRunPendingSimulate]);

  useEffect(() => {
    const tick = Number(serial.simulateCheckTick || 0);
    if (!tick || tick === lastSimulateCheckTickRef.current) return;
    lastSimulateCheckTickRef.current = tick;

    if (!FLAGS.SIM_AUTORUN) {
      pendingSimulateRef.current = null;
      return;
    }

    const macFromEvent = String(serial.simulateCheckMac || "").trim();
    const fallback = (macRef.current || "").trim();
    const targetRaw = macFromEvent || fallback;
    const targetKey = macKey(targetRaw || "");
    const target = targetKey || (targetRaw || "").toUpperCase();
    if (!target) {
      pendingSimulateRef.current = null;
      return;
    }

    const blockKey = targetKey;
    const cooldown = noSetupCooldownRef.current;
    if (cooldown && cooldown.mac === blockKey) {
      if (cooldown.requireManual !== false) return;
      if (Date.now() < cooldown.until) return;
    }

    const lastFinalizedKey = macKey(lastFinalizedMacRef.current || "");
    const lastFinalizedAt = lastFinalizedAtRef.current || 0;
    if (
      lastFinalizedKey &&
      blockKey === lastFinalizedKey &&
      CFG.FINALIZED_RESCAN_BLOCK_MS > 0 &&
      Date.now() - lastFinalizedAt < CFG.FINALIZED_RESCAN_BLOCK_MS
    ) {
      return;
    }

    const lastScannedKey = macKey(lastScanRef.current || "");
    if (lastScannedKey && lastScannedKey === blockKey) {
      return;
    }

    pendingSimulateRef.current = { target, tick };
    tryRunPendingSimulate();
  }, [
    CFG.FINALIZED_RESCAN_BLOCK_MS,
    lastFinalizedAtRef,
    lastFinalizedMacRef,
    lastScanRef,
    noSetupCooldownRef,
    serial.simulateCheckTick,
    serial.simulateCheckMac,
    FLAGS.SIM_AUTORUN,
    tryRunPendingSimulate,
  ]);

  useEffect(() => {
    tryRunPendingSimulate();
  }, [tryRunPendingSimulate, isScanning, isChecking]);

  useEffect(
    () => () => {
      if (simulateRetryTimerRef.current != null) {
        try {
          window.clearTimeout(simulateRetryTimerRef.current);
        } catch {}
        simulateRetryTimerRef.current = null;
      }
    },
    []
  );

  /* =================================================================================
   * Effect Components (modularized side-effects)
   * ================================================================================= */

  // Allow Dev simulator "Run Check" events to behave like physical scans.
  useEffect(() => {
    const onSimScan = (ev: Event) => {
      const detail = (ev as CustomEvent)?.detail as
        | { code?: string; allowDuringSetup?: boolean }
        | undefined;
      const code = String(detail?.code || "").trim();
      if (!code) return;
      const allowDuringSetup = detail?.allowDuringSetup === true;
      if (setupScanActive && allowDuringSetup) enableSimOverride();
      if (setupGateActive && !allowDuringSetup) return;
      if (mainView !== "dashboard") return;
      if (isSettingsSidebarOpen) return;
      if (isScanning) return;
      if (isCheckingRef.current) return;
      void handleScanRef.current?.(code, "sse");
    };
    try {
      window.addEventListener("kfb:sim-scan", onSimScan as EventListener);
    } catch {}
    return () => {
      try {
        window.removeEventListener("kfb:sim-scan", onSimScan as EventListener);
      } catch {}
    };
  }, [
    setupGateActive,
    setupScanActive,
    mainView,
    isSettingsSidebarOpen,
    isScanning,
    enableSimOverride,
  ]);

  /* -----------------------------------------------------------------------------
   * Post-reset cleanups
   * ---------------------------------------------------------------------------*/
  const handleHudIdle = useCallback(() => {
    const cooldown = noSetupCooldownRef.current;
    if (cooldown) {
      if (Date.now() < cooldown.until) return;
      noSetupCooldownRef.current = null;
    }
    idleCooldownUntilRef.current = 0;
    blockedMacRef.current.clear();
  }, []);

  const hasBoardData = useMemo(() => {
    if (scanResult?.text === NO_SETUP_MSG) return false;
    if (macAddress && macAddress.trim()) return true;
    if (kfbNumber && kfbNumber.trim()) return true;
    if (Array.isArray(branchesData) && branchesData.length > 0) return true;
    if (Array.isArray(groupedBranches) && groupedBranches.length > 0)
      return true;
    if (Array.isArray(normalPins) && normalPins.length > 0) return true;
    if (Array.isArray(latchPins) && latchPins.length > 0) return true;
    if (Array.isArray(activeKssks) && activeKssks.length > 0) return true;
    return false;
  }, [
    macAddress,
    kfbNumber,
    branchesData,
    groupedBranches,
    normalPins,
    latchPins,
    activeKssks,
    scanResult,
  ]);

  const { hudMode, hudMessage, hudSubMessage } = useHud({
    mainView,
    isScanning,
    showScanUi,
    scanResult,
    macAddress,
    hasBoardData,
    serial,
    redisDegraded,
    infoHideAt,
    onIdle: handleHudIdle,
  });

  // stable empties
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

  /* =================================================================================
   * Improved: Info banner control (auto-hide) + "no setup" detection
   * ================================================================================= */

  /** Show a transient info banner with auto-hide. */
  const showInfo = useCallback(
    (text: string, ms = INFO_AUTO_HIDE_MS, subtitle?: string) => {
      setScanResult({ text, kind: "info" });
      const hideAt = Date.now() + Math.max(1200, ms);
      setInfoHideAt(hideAt);

      if (infoTimerRef.current) {
        window.clearInterval(infoTimerRef.current);
        infoTimerRef.current = null;
      }
      infoTimerRef.current = window.setInterval(() => {
        if (Date.now() >= hideAt) {
          setScanResult(null);
          setInfoHideAt(null);
          if (infoTimerRef.current) {
            window.clearInterval(infoTimerRef.current);
            infoTimerRef.current = null;
          }
        }
      }, 250);
    },
    []
  );

  /* =================================================================================
   * Render
   * ================================================================================= */
  const actualHeaderHeight = mainView === "dashboard" ? "4rem" : "0rem";
  const leftOffset = "0";
  const appCurrentViewType =
    mainView === "settingsConfiguration" || mainView === "settingsBranches"
      ? "settings"
      : "main";

  const headerMac = useMemo(() => maskSimMac(macAddress), [macAddress]);

  const toggleLeftSidebar = () => setIsLeftSidebarOpen((v) => !v);
  const toggleSettingsSidebar = () => setIsSettingsSidebarOpen((v) => !v);
  const showDashboard = () => setMainView("dashboard");
  const handleHeaderClick = () => {
    if (appCurrentViewType === "settings") {
      showDashboard();
      setIsSettingsSidebarOpen(false);
    } else {
      toggleSettingsSidebar();
    }
  };

  /** Compute the animated banner to display (idle + info only). */
  const banner: BannerState | null = useMemo(() => {
    if (mainView !== "dashboard") return null;
    if (scanResult?.kind === "info" && scanResult.text !== NO_SETUP_MSG) {
      return {
        key: `info-${scanResult.text}`,
        kind: "info",
        title: scanResult.text,
      };
    }
    return null;
  }, [scanResult, mainView]);

  return (
    <div
      className={[
        "relative flex min-h-screen w-full",
        "text-[#1f2937]",
        "dark:text-[#f8fafc]",
        "transition-colors",
      ].join(" ")}
      style={{ background: appBackground }}
    >
      {/* --- Effect components (side-effect orchestration) --- */}
      <UnionEffect
        serial={serial}
        suppressLive={suppressLive}
        hasSetupForCurrentMac={hasSetupForCurrentMac}
        macRef={macRef}
        redisDegraded={redisDegraded}
        lastActiveIdsRef={lastActiveIdsRef}
        activeKssks={activeKssks}
        computeActivePins={computeActivePins}
        itemsAllFromAliasesRef={itemsAllFromAliasesRef}
        setNormalPins={setNormalPins}
        setLatchPins={setLatchPins}
        setNameHints={setNameHints}
      />
      <RedisHealthEffect
        serial={serial}
        assumeRedisReady={ASSUME_REDIS_READY}
        redisDegraded={redisDegraded}
        setRedisDegraded={setRedisDegraded}
        redisReadyRef={redisReadyRef}
        prevRedisReadyRef={prevRedisReadyRef}
        redisDropTimerRef={redisDropTimerRef}
        lastRedisDropAtRef={lastRedisDropAtRef}
        rehydrateOnRecovery={FLAGS.REHYDRATE_ON_RECOVERY}
        suppressLive={suppressLive}
        macRef={macRef}
        macRegex={MAC_ONLY_REGEX}
        isScanning={isScanning}
        isChecking={isChecking}
        setNormalPins={setNormalPins}
        setLatchPins={setLatchPins}
        setNameHints={setNameHints}
      />
      <DeviceEventsEffect
        serial={serial}
        setupGateActive={setupGateActive}
        suppressLive={suppressLive}
        zeroMac={ZERO_MAC}
        retryCooldownMs={CFG.RETRY_COOLDOWN_MS}
        hasSetupForCurrentMac={hasSetupForCurrentMac}
        macRef={macRef}
        lastScanRef={lastScanRef}
        blockedMacRef={blockedMacRef}
        lastFinalizedAtRef={lastFinalizedAtRef}
        isCheckingRef={isCheckingRef}
        okFlashAllowedRef={okFlashAllowedRef}
        okShownOnceRef={okShownOnceRef}
        lastRunHadFailuresRef={lastRunHadFailuresRef}
        clearFailureFlag={() => {
          lastRunHadFailuresRef.current = false;
        }}
        setOkFlashTick={setOkFlashTick}
        setMacAddress={setMacAddress}
        setKfbNumber={setKfbNumber}
        setIsChecking={setIsChecking}
        setIsScanning={setIsScanning}
        setBranchesData={setBranchesData}
        setCheckFailures={setCheckFailures}
        finalizeOkForMac={finalizeMacOnce}
      />
      <ScannerEffect
        serial={serial}
        mainView={mainView}
        isSettingsSidebarOpen={isSettingsSidebarOpen}
        isScanning={isScanning}
        isCheckingRef={isCheckingRef}
        idleCooldownUntilRef={idleCooldownUntilRef}
        blockedMacRef={blockedMacRef}
        resolveDesiredPath={resolveDesiredPath}
        pathsEqual={pathsEqual}
        isAcmPath={isAcmPath}
        handleScan={handleScan}
      />
      <PollingEffect
        serial={serial}
        scannerPollEnabled={FLAGS.SCANNER_POLL}
        mainView={mainView}
        isSettingsSidebarOpen={isSettingsSidebarOpen}
        suppressLive={suppressLive}
        macRef={macRef}
        isCheckingRef={isCheckingRef}
        isScanning={isScanning}
        idleCooldownUntilRef={idleCooldownUntilRef}
        blockedMacRef={blockedMacRef}
        scanResultTimerRef={scanResultTimerRef}
        resolveDesiredPath={resolveDesiredPath}
        pathsEqual={pathsEqual}
        isAcmPath={isAcmPath}
        handleScan={handleScan}
        setScanResult={setScanResult}
      />
      <AutoFinalizeEffect
        isScanning={isScanning}
        isChecking={isChecking}
        okFlashAllowedRef={okFlashAllowedRef}
        checkFailures={checkFailures}
        branchesData={branchesData}
        groupedBranches={groupedBranches}
        macRef={macRef}
        finalizeGuardRef={lastRunHadFailuresRef}
        finalizeOkForMac={finalizeMacFromUi}
      />
      <PostResetSanityEffect
        lastFinalizedMacRef={lastFinalizedMacRef}
        mainView={mainView}
        macRef={macRef}
        isScanning={isScanning}
        isChecking={isChecking}
        clearKskLocksFully={clearKskLocksFully}
      />

      <div
        className="flex flex-1 flex-col transition-all"
        style={{ marginLeft: leftOffset }}
      >
        {mainView === "dashboard" && (
          <Header
            serial={serial}
            displayMac={headerMac}
            onSettingsClick={handleHeaderClick}
            currentView={appCurrentViewType}
            isSidebarOpen={isLeftSidebarOpen}
            onToggleSidebar={() => setIsLeftSidebarOpen((v) => !v)}
          />
        )}

        <main
          className="relative flex-1 overflow-auto backdrop-blur-sm transition-colors"
          style={{
            background: mainSurfaceBg,
            borderTop: `1px solid ${mainSurfaceBorder}`,
          }}
        >
          {/* Animated banner overlay for idle + transient info */}
          <HudBanner banner={banner} />

          {mainView === "dashboard" ? (
            <BranchDashboardMainContent
              appHeaderHeight={actualHeaderHeight}
              /* allow child to re-trigger a scan if it calls this; we simply re-run last scanned code if any */
              onScanAgainRequest={(val?: string) => {
                const code = (val || lastScanRef.current || "").trim();
                if (code) void loadBranchesData(code, "sse");
              }}
              hudMode={hudMode}
              hudMessage={hudMessage}
              hudSubMessage={hudSubMessage}
              onHudDismiss={scanResult ? () => setScanResult(null) : undefined}
              branchesData={derived.effBranches}
              groupedBranches={derived.effGroups}
              checkFailures={derived.effFailures}
              nameHints={nameHints}
              kfbNumber={kfbNumber}
              kfbInfo={kfbInfo}
              isScanning={isScanning && showScanUi}
              macAddress={macAddress}
              displayMac={displayMacAddress}
              activeKssks={derived.effActiveKssks}
              lastEv={(serial as any).lastEv}
              lastEvTick={(serial as any).lastEvTick}
              normalPins={
                FLAGS.SIMULATE
                  ? derived.effNormalPins
                  : suppressLive
                    ? undefined
                    : derived.effNormalPins
              }
              latchPins={
                FLAGS.SIMULATE
                  ? derived.effLatchPins
                  : suppressLive
                    ? undefined
                    : derived.effLatchPins
              }
              onResetKfb={handleResetKfb}
              onFinalizeOk={finalizeMacFromUi}
              onFailuresCleared={handleFailuresCleared}
              flashOkTick={okFlashTick}
              okSystemNote={okSystemNote}
              disableOkAnimation={disableOkAnimation}
              scanResult={scanResult}
              shouldShowHeader={shouldShowHeader}
            />
          ) : (
            <div className="p-6 text-slate-600">Settings view is disabled.</div>
          )}
        </main>
      </div>
    </div>
  );
};

export default MainApplicationUI;
