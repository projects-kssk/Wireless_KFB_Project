"use client";

import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  startTransition,
  FormEvent, // kept only for type completeness; no forms used
} from "react";
import { BranchDisplayData, KfbInfo, TestStatus } from "@/types/types";
import { Header } from "@/components/Header/Header";
import BranchDashboardMainContent from "@/components/Program/BranchDashboardMainContent";
import { useSerialEvents } from "@/components/Header/useSerialEvents";
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
import useHud, { HudMode, ScanResultState } from "./hooks/useHud";
import { canonicalMac, extractMac, MAC_ONLY_REGEX } from "./utils/mac";
import { KFB_REGEX } from "./utils/regex";
import {
  isAcmPath,
  pathsEqual as pathsEqualUtil,
  resolveDesiredPath as resolveDesiredPathUtil,
} from "./utils/paths";
import {
  mergeAliasesFromItems,
  computeActivePins as computeActivePinsUtil,
} from "./utils/merge";

/* =================================================================================
 * Constants & helpers
 * ================================================================================= */

const DEBUG_LIVE = process.env.NEXT_PUBLIC_DEBUG_LIVE === "1";
const ZERO_MAC = "00:00:00:00:00:00" as const;

type MainView = "dashboard" | "settingsConfiguration" | "settingsBranches";
type ScanTrigger = "sse" | "poll";

/* =================================================================================
 * Main Component
 * ================================================================================= */

const MainApplicationUI: React.FC = () => {
  const { CFG, FLAGS, ASSUME_REDIS_READY, ALLOW_IDLE_SCANS } = useConfig();

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
  const [activeKssks, setActiveKssks] = useState<string[]>([]);
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

  /* -------------------------------------------------------------------------- */
  /* Live mode gating
   * EN: Live mode is only permitted when we actually have setup data for this MAC.
   * HU: Csak akkor engedjük a live módot (unió/ellenőrzés/finalize), ha van aktív KSK vagy alias/setup adat Redisben.
   */
  /* -------------------------------------------------------------------------- */
  const hasSetupForCurrentMac = useCallback(() => {
    const active = (activeKssks?.length ?? 0) > 0;
    const anyItems = (itemsAllFromAliasesRef.current?.length ?? 0) > 0;
    return active || anyItems;
  }, [activeKssks]);
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
  const redisReadyRef = useRef<boolean>(false);
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

  const infoTimerRef = useRef<ReturnType<typeof window.setInterval> | null>(
    null
  );
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
          window.clearInterval(infoTimerRef.current as any);
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
  const serial = useSerialEvents(
    // In simulation, keep SSE active even while suppressLive so pin toggles reflect immediately.
    setupGateActive || (suppressLive && !FLAGS.SIMULATE)
      ? undefined
      : (macAddress || "").toUpperCase(),
    {
      disabled:
        setupGateActive ||
        (suppressLive && !FLAGS.SIMULATE) ||
        mainView !== "dashboard",
      base: !setupGateActive,
    }
  );
  useEffect(() => {
    redisReadyRef.current = !!(serial as any).redisReady;
  }, [(serial as any).redisReady]);

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

  const clearKskLocksFully = useCallback(
    async (mac: string): Promise<boolean> => {
      const MAC = mac.toUpperCase();
      const qs = (o: Record<string, string>) =>
        new URLSearchParams(o).toString();
      for (let i = 0; i < 3; i++) {
        await fetch(`/api/ksk-lock?${qs({ mac: MAC, force: "1" })}`, {
          method: "DELETE",
        }).catch(() => {});
        await new Promise((r) => setTimeout(r, 150));
        const v = await fetch(`/api/ksk-lock`, { cache: "no-store" })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null);
        const left = Array.isArray(v?.locks)
          ? v.locks.filter(
              (x: any) => String(x?.mac || "").toUpperCase() === MAC
            ).length
          : 0;
        if (left === 0) return true;
      }
      return false;
    },
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
  const isHttpUrl = (u?: string | null) => !!u && /^(https?:)\/\//i.test(u);

  const checkpointSentRef = useRef<Set<string>>(new Set());
  const checkpointMacPendingRef = useRef<Set<string>>(new Set());
  const checkpointBlockUntilTsRef = useRef<number>(0);
  const lastActiveIdsRef = useRef<string[]>([]);

  const sendCheckpointForMac = useCallback(
    async (mac: string, onlyIds?: string[]): Promise<boolean> => {
      const MAC = mac.toUpperCase();
      if (checkpointMacPendingRef.current.has(MAC)) return false;
      checkpointMacPendingRef.current.add(MAC);
      try {
        let ids: string[] = [];
        let items: any[] = [];
        try {
          const rList = await fetch(
            `/api/aliases?mac=${encodeURIComponent(MAC)}&all=1`,
            { cache: "no-store" }
          );
          if (rList.ok) {
            const j = await rList.json();
            items = Array.isArray(j?.items) ? j.items : [];
            ids = items
              .map((it) => String((it.ksk ?? it.kssk) || "").trim())
              .filter(Boolean);
          }
        } catch {}
        if ((!ids || ids.length === 0) && onlyIds && onlyIds.length) {
          ids = [
            ...new Set(onlyIds.map((s) => String(s).trim()).filter(Boolean)),
          ];
        }
        if (onlyIds && onlyIds.length) {
          const want = new Set(onlyIds.map((s) => s.toUpperCase()));
          ids = ids.filter((id) => want.has(id.toUpperCase()));
          if (ids.length === 0 && items.length) {
            const firstId = String(
              (items[0] as any)?.ksk ?? (items[0] as any)?.kssk ?? ""
            ).trim();
            ids = [firstId].filter(Boolean) as string[];
          }
        }

        let sentAny = false;
        for (const id of ids) {
          if (checkpointSentRef.current.has(id)) continue;

          // Try to read XML; 404 => try ensure once and retry
          let workingDataXml: string | null = null;
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              const blockUntil = xmlReadBlockUntilRef.current.get(MAC) || 0;
              if (Date.now() < blockUntil) break;
              const rXml = await fetch(
                `/api/aliases/xml?mac=${encodeURIComponent(MAC)}&kssk=${encodeURIComponent(id)}`,
                { cache: "no-store" }
              );
              if (rXml.ok) {
                workingDataXml = await rXml.text();
                break;
              }
              if (rXml.status === 404 && attempt === 0) {
                const ensure = await fetch("/api/aliases/xml/ensure", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    mac: MAC,
                    ksk: id,
                    requestID: `${Date.now()}_${id}`,
                  }),
                }).catch(() => null);
                if (ensure && ensure.ok) {
                  const r2 = await fetch(
                    `/api/aliases/xml?mac=${encodeURIComponent(MAC)}&kssk=${encodeURIComponent(id)}`,
                    { cache: "no-store" }
                  ).catch(() => null);
                  if (r2 && r2.ok) {
                    workingDataXml = await r2.text();
                    break;
                  }
                }
                break;
              }
            } catch {}
            await new Promise((res) => setTimeout(res, 250));
          }

          const payload: any = workingDataXml
            ? { requestID: `${Date.now()}_${id}`, workingDataXml, intksk: id }
            : { requestID: `${Date.now()}_${id}`, intksk: id };
          payload.forceResult = true;
          if (OFFLINE_MODE && isHttpUrl(CLIENT_RESULT_URL)) {
            payload.checkpointUrl = CLIENT_RESULT_URL;
          }

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
              }
            } else {
              checkpointSentRef.current.add(id);
              sentAny = true;
            }
          } catch {
            checkpointBlockUntilTsRef.current = Date.now() + 60_000;
          }
        }
        return sentAny;
      } finally {
        checkpointMacPendingRef.current.delete(MAC);
      }
    },
    [CHECKPOINT_URL, OFFLINE_MODE, CLIENT_RESULT_URL]
  );

  const handleResetKfb = useCallback(() => {
    const clearRetryTimer = () => cancel("checkRetry");
    clearRetryTimer();
    clearScanOverlayTimeout();

    setErrorMsg(null);
    setKfbNumber("");
    setKfbInfo(null);
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

  const clearAliasesVerify = useCallback(async (mac: string) => {
    await fetch("/api/aliases/clear", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mac }),
    }).catch(() => {});
    const verify = async (): Promise<boolean> => {
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
    let ok = await verify();
    for (let i = 0; !ok && i < 2; i++) {
      await new Promise((res) => setTimeout(res, 250));
      await fetch("/api/aliases/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mac }),
      }).catch(() => {});
      ok = await verify();
    }
  }, []);
  /* -------------------------------------------------------------------------- */
  /* [HU] finalizeOkForMac(mac)
   *   - Csak akkor fut, ha az utolsó futásban NINCS hiba (guard a dupla hívások elkerülésére).
   *   - Küldi a "checkpoint"-ot (ha van KSK id), majd törli az aliasokat és a lockokat.
   *   - Ideiglenesen blokkolja az ugyanarra a MAC-re érkező gyors újrascan-t (phantom olvasások ellen).
   *   - A végén reseteli a lokális UI állapotot (mac, kfb, csoportok, stb.).
   */
  /* -------------------------------------------------------------------------- */
  const finalizeOkForMac = useCallback(
    async (rawMac: string) => {
      const mac = String(rawMac || "")
        .trim()
        .toUpperCase();
      if (!mac) {
        handleResetKfb();
        return;
      }
      if (lastRunHadFailuresRef.current) return;

      const guardWindowMs = Math.max(2000, CFG.RETRY_COOLDOWN_MS);
      const guard = finalizeOkGuardRef.current;
      const guardUntil = guard.get(mac) || 0;
      const nowTs = Date.now();
      if (guardUntil && nowTs < guardUntil) return;
      guard.set(mac, nowTs + guardWindowMs);
      try {
        const last = recentCleanupRef.current.get(mac) || 0;
        if (Date.now() - last < 5000) return;
      } catch {}

      try {
        setSuppressLive(true);
        // one-shot skip stop cleanup
        // (we don't clear on STOP path; only here on finalize-ok)

        // Block this MAC shortly after finalize to avoid phantom rescans
        try {
          blockedMacRef.current.add(mac);
          window.setTimeout(() => {
            try {
              blockedMacRef.current.delete(mac);
            } catch {}
          }, CFG.RETRY_COOLDOWN_MS);
          const last = (lastScanRef.current || "").toUpperCase();
          if (last && last !== mac) {
            blockedMacRef.current.add(last);
            window.setTimeout(() => {
              try {
                blockedMacRef.current.delete(last);
              } catch {}
            }, CFG.RETRY_COOLDOWN_MS);
          }
        } catch {}

        setMacAddress("");
        setKfbNumber("");
        lastFinalizedMacRef.current = mac;
        lastFinalizedAtRef.current = Date.now();

        // Determine KSK ids
        let ids =
          lastActiveIdsRef.current && lastActiveIdsRef.current.length
            ? [...lastActiveIdsRef.current]
            : [...(activeKssks || [])];
        let hadAliases = false;
        let hadLocksForMac = false;
        if (ids.length) {
          hadLocksForMac = true;
        }

        if (!ids.length) {
          try {
            const r = await fetch(
              `/api/aliases?mac=${encodeURIComponent(mac)}&all=1`,
              {
                cache: "no-store",
              }
            );
            if (r.ok) {
              const j = await r.json();
              const items: any[] = Array.isArray(j?.items) ? j.items : [];
              ids = Array.from(
                new Set(
                  items
                    .map((it) => String((it?.ksk ?? it?.kssk) || "").trim())
                    .filter(Boolean)
                )
              );
              if (items.length) hadAliases = true;
            }
          } catch {}
          if (!ids.length) {
            try {
              const rLocks = await fetch(`/api/ksk-lock`, {
                cache: "no-store",
              }).catch(() => null);
              if (rLocks && rLocks.ok) {
                const jL = await rLocks.json().catch(() => null);
                const locks: any[] = Array.isArray(jL?.locks) ? jL.locks : [];
                const wantMac = (mac || "").toUpperCase();
                const fromLocks = locks
                  .filter(
                    (row: any) =>
                      String(row?.mac || "").toUpperCase() === wantMac
                  )
                  .map((row: any) =>
                    String((row?.ksk ?? row?.kssk) || "").trim()
                  )
                  .filter(Boolean);
                if (fromLocks.length) {
                  ids = Array.from(new Set(fromLocks));
                  hadLocksForMac = true;
                }
              }
            } catch {}
          }
          if (!ids.length) {
            try {
              const snapshot = itemsAllFromAliasesRef.current || [];
              if (snapshot.length) {
                const fromSnap = Array.from(
                  new Set(
                    snapshot
                      .map((it: any) =>
                        String((it.ksk ?? (it as any).kssk) || "").trim()
                      )
                      .filter(Boolean)
                  )
                );
                if (fromSnap.length) {
                  ids = fromSnap;
                  hadAliases = true;
                }
              }
            } catch {}
          }
        }

        // Send checkpoint per KSK id (best-effort)
        let hasSetup = ids.length > 0;
        let okNote = "";
        if (hasSetup) {
          const sent = await sendCheckpointForMac(mac, ids).catch(() => false);
          okNote = sent ? "Checkpoint sent; cache cleared" : "Cache cleared";
        } else {
          okNote = "Cache cleared";
        }

        // Clear aliases + locks
        const snapshotCount = Array.isArray(itemsAllFromAliasesRef.current)
          ? itemsAllFromAliasesRef.current.length
          : 0;
        const shouldClearAliases = hadAliases || snapshotCount > 0;
        if (shouldClearAliases) await clearAliasesVerify(mac);

        const shouldClearLocks =
          hadLocksForMac || (activeKssks?.length ?? 0) > 0 || hasSetup;
        if (shouldClearLocks) {
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
        }

        if (!hasSetup && !shouldClearAliases && !shouldClearLocks) {
          okNote = "Nothing to clear";
        }
        setOkSystemNote(okNote);
      } finally {
        try {
          checkpointSentRef.current.clear();
        } catch {}
        try {
          xmlReadBlockUntilRef.current.set(mac, Date.now() + 60_000);
          recentCleanupRef.current.set(mac, Date.now());
          finalizeOkGuardRef.current.set(
            mac,
            Date.now() + Math.max(2000, CFG.RETRY_COOLDOWN_MS)
          );
        } catch {}
        handleResetKfb();
      }
    },
    [
      CFG.RETRY_COOLDOWN_MS,
      activeKssks,
      clearAliasesVerify,
      clearKskLocksFully,
      handleResetKfb,
      sendCheckpointForMac,
    ]
  );
  /* -------------------------------------------------------------------------- */
  /* [HU] runCheck(mac, attempt, pins)
   *   - A teszt kliens meghívása a megadott MAC-re (opcionálisan megadott pinekkel).
   *   - Watchdoggal védi a folyamatot (timeout esetén hiba).
   *   - Eredmény alapján: nameHints, normal/latch pin frissítés, hibás pinek jelölése.
   *   - Ha nincs hiba (0 failure), automatikusan finalize -> cleanup -> új scan jöhet.
   *   - 429/504/státusz kódoknál visszatérő próbálkozás (CFG.RETRIES, cooldown).
   */
  /* -------------------------------------------------------------------------- */
  const runCheck = useCallback(
    async (mac: string, attempt: number = 0, pins?: number[]) => {
      if (!mac) return;

      setIsChecking(true);
      // watchdog to unstick
      schedule(
        "checkWatchdog",
        () => {
          if (isCheckingRef.current) {
            setIsChecking(false);
            setSuppressLive(false);
            setScanResult({ text: "Check timed out", kind: "error" });
            if (scanResultTimerRef.current)
              clearTimeout(scanResultTimerRef.current);
            scanResultTimerRef.current = window.setTimeout(() => {
              setScanResult(null);
              scanResultTimerRef.current = null;
            }, 1800);
          }
        },
        CFG.CHECK_CLIENT_MS + 1200
      );

      try {
        lastRunHadFailuresRef.current = false;
        setCheckFailures(null);

        const ctrl = new AbortController();
        const tAbort = setTimeout(
          () => ctrl.abort(),
          Math.max(1000, CFG.CHECK_CLIENT_MS)
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
          if (ct.includes("application/json")) result = await res.json();
          else {
            const txt = await res.text();
            try {
              result = txt ? JSON.parse(txt) : {};
            } catch {}
          }
        } catch {}

        if (res.ok) {
          const failures: number[] = Array.isArray(result?.failures)
            ? (result.failures as number[])
                .map((n) => Number(n))
                .filter((n) => Number.isFinite(n))
            : [];
          const unknown = result?.unknownFailure === true;
          lastRunHadFailuresRef.current = unknown || failures.length > 0;

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

          const hasAliasesFromResult =
            (Array.isArray((result as any)?.itemsActive) &&
              ((result as any).itemsActive as any[]).length > 0) ||
            (Array.isArray((result as any)?.items) &&
              ((result as any).items as any[]).length > 0) ||
            (result?.aliases &&
              typeof result.aliases === "object" &&
              Object.keys(result.aliases).length > 0);

          const setupReadyRef = hasSetupForCurrentMac() || hasAliasesFromResult;

          const shouldExposeFailures = setupReadyRef || failures.length > 0;
          setCheckFailures(shouldExposeFailures ? failures : []);

          // build branches (flat + grouped) from items
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
              const pinsAll = Object.keys(aliases)
                .map((n) => Number(n))
                .filter((n) => Number.isFinite(n))
                .sort((a, b) => a - b);

              const contactless = new Set<number>(
                (Array.isArray(result?.latchPins)
                  ? (result.latchPins as number[])
                  : latchPins || []
                ).filter((n: number) => Number.isFinite(n)) as number[]
              );

              const setupReadyWithAliases =
                setupReadyRef || Object.keys(aliases).length > 0;

              const flat = pinsAll.map((pin) => ({
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

              if (!setupReadyWithAliases) {
                setGroupedBranches([]);
                lastActiveIdsRef.current = [];
                return flat;
              }

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
                  const contactlessG = new Set<number>(
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
                        : contactlessG.has(pin)
                          ? ("not_tested" as TestStatus)
                          : ("ok" as TestStatus),
                      pinNumber: pin,
                      kfbInfoValue: undefined,
                      isLatch: contactlessG.has(pin),
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
                const groups = Array.from(byId.entries())
                  .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
                  .map(([k, branches]) => ({ ksk: k, branches }));
                setGroupedBranches(groups);
                if (activeSet.size)
                  setActiveKssks(groups.map((g) => g.ksk).filter(Boolean));
                lastActiveIdsRef.current = groups
                  .map((g) => g.ksk)
                  .filter(Boolean);

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
                  setGroupedBranches((prev) => [
                    ...groups,
                    { ksk: "CHECK", branches: extraBranches },
                  ]);
                }
              } else {
                setGroupedBranches([]);
                if (!activeSet.size) setActiveKssks([]);
                if (!activeSet.size) lastActiveIdsRef.current = [];
              }

              const knownFlat = new Set<number>(pinsAll);
              const extras = failures.filter(
                (p: number) => Number.isFinite(p) && !knownFlat.has(p)
              );
              if (!setupReadyWithAliases) return flat;
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

          if (!unknown && failures.length === 0 && setupReadyRef) {
            clearScanOverlayTimeout();
            setSuppressLive(true);
            cancel("checkWatchdog");
            await finalizeOkForMac(mac);
            if (okFlashAllowedRef.current && !okShownOnceRef.current) {
              okShownOnceRef.current = true;
              setOkFlashTick((t) => t + 1);
            }
            return;
          } else {
            if (!setupReadyRef) {
              setGroupedBranches([]);
              setScanResult(null);
              return;
            }
            const text = unknown
              ? "CHECK ERROR (no pin list)"
              : `${failures.length} failure${failures.length === 1 ? "" : "s"}`;
            setScanResult({ text, kind: unknown ? "error" : "info" });
            if (scanResultTimerRef.current)
              clearTimeout(scanResultTimerRef.current);
            scanResultTimerRef.current = window.setTimeout(() => {
              setScanResult(null);
              scanResultTimerRef.current = null;
            }, 2000);
          }
        } else {
          if (res.status === 429 && attempt < CFG.RETRIES) {
            schedule(
              "checkRetry",
              () => void runCheck(mac, attempt + 1, pins),
              350
            );
          } else if (
            res.status === 504 ||
            result?.pending === true ||
            String(result?.code || "").toUpperCase() === "NO_RESULT"
          ) {
            if (attempt < CFG.RETRIES) {
              schedule(
                "checkRetry",
                () => void runCheck(mac, attempt + 1, pins),
                250
              );
            } else {
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
        }
      } catch (err) {
        if ((err as any)?.name === "AbortError" && attempt < CFG.RETRIES) {
          schedule(
            "checkRetry",
            () => void runCheck(mac, attempt + 1, pins),
            300
          );
        } else {
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
      } finally {
        cancel("checkWatchdog");
        const now = Date.now();
        if (!lastRunHadFailuresRef.current) {
          setIsChecking(false);
          idleCooldownUntilRef.current = now + 2500;
        } else {
          idleCooldownUntilRef.current = 0; // allow immediate re-scan on failure
        }
        simulateCooldownUntilRef.current = Math.max(
          simulateCooldownUntilRef.current,
          now + 2500
        );
        if (pendingSimulateRef.current) tryRunPendingSimulateRef.current();
      }
    },
    [
      CFG.CHECK_CLIENT_MS,
      CFG.RETRIES,
      cancel,
      clearScanOverlayTimeout,
      finalizeOkForMac,
      handleResetKfb,
      latchPins,
      schedule,
      hasSetupForCurrentMac,
    ]
  );

  /* -------------------------------------------------------------------------- */
  /* HU: resolveDesiredPath leírás
   *   - Először az ACM0, majd az USB0 portot részesíti előnyben.
   *   - Végül a dashboard index alapján választ fallback útvonalat.
   *   - Bizonytalan esetben null-t ad vissza.
   */
  /* -------------------------------------------------------------------------- */
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
  const loadBranchesData = useCallback(
    async (value?: string, trigger: ScanTrigger = "sse") => {
      setOkSystemNote(null);
      setDisableOkAnimation(false);

      const rawCode = String(value ?? "").trim();
      if (!rawCode) return;
      const macCanon = canonicalMac(rawCode) || extractMac(rawCode);
      const isMac = !!macCanon;
      if (!isMac && !KFB_REGEX.test(rawCode)) {
        console.warn("[FLOW][SCAN] rejected by patterns", { raw: rawCode });
        return;
      }
      lastScanRef.current = rawCode.toUpperCase();

      setIsScanning(true);
      setErrorMsg(null);
      setKfbInfo(null);
      setCheckFailures(null);

      const pendingMac = isMac ? (macCanon as string) : "KFB";

      // Load aliases snapshot
      let aliases: Record<string, string> = {};
      let pins: number[] = [];
      let activeIds: string[] = [];

      if (FLAGS.USE_LOCKS) {
        try {
          const r = await fetch("/api/ksk-lock", { cache: "no-store" });
          if (r.ok) {
            const j = await r.json();
            const rows: Array<{ ksk?: string; kssk?: string; mac?: string }> =
              Array.isArray(j?.locks) ? j.locks : [];
            const MAC = pendingMac.toUpperCase();
            activeIds = Array.from(
              new Set(
                rows
                  .filter((l) => String(l?.mac || "").toUpperCase() === MAC)
                  .map((l) => String((l as any).ksk ?? (l as any).kssk).trim())
                  .filter(Boolean)
              )
            );
          }
        } catch {}
      }
      if (activeIds.length > 3) activeIds = activeIds.slice(0, 3);
      if (activeIds.length) {
        setActiveKssks(activeIds);
        lastActiveIdsRef.current = [...activeIds];
      } else {
        setActiveKssks([]);
        lastActiveIdsRef.current = [];
      }

      try {
        if (FLAGS.REHYDRATE_ON_LOAD) {
          await fetch("/api/aliases/rehydrate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mac: pendingMac }),
          }).catch(() => {});
        }
        const rAll = await fetch(
          `/api/aliases?mac=${encodeURIComponent(pendingMac)}&all=1`,
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
          itemsAllFromAliasesRef.current = items as any;

          const itemsFiltered = activeIds.length
            ? items.filter((it: any) =>
                activeIds.includes(String((it.ksk ?? it.kssk) || "").trim())
              )
            : items;

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

          try {
            const rUnion = await fetch(
              `/api/aliases?mac=${encodeURIComponent(pendingMac)}`,
              { cache: "no-store" }
            );
            if (rUnion.ok) {
              const jU = await rUnion.json();
              const aU =
                jU?.aliases && typeof jU.aliases === "object"
                  ? (jU.aliases as Record<string, string>)
                  : {};
              if (Object.keys(aU).length) aliases = aU;
            }
          } catch {}

          if (Object.keys(aliases).length === 0) {
            aliases = mergeAliasesFromItems(itemsFiltered as any);
          }

          try {
            const idsForPins =
              activeIds && activeIds.length
                ? activeIds
                : Array.from(
                    new Set(
                      itemsFiltered
                        .map((it: any) =>
                          String((it.ksk ?? it.kssk) || "").trim()
                        )
                        .filter(Boolean)
                    )
                  );
            const filtered = computeActivePins(
              itemsFiltered as any,
              idsForPins
            );
            setNormalPins(filtered.normal);
            setLatchPins(filtered.latch);
            const mergedPins = Array.from(
              new Set([...(filtered.normal || []), ...(filtered.latch || [])])
            ).sort((a, b) => a - b);
            if (mergedPins.length) pins = mergedPins;
          } catch {}
        }
      } catch {}

      setBranchesData([]);

      // Bind MAC and run check
      setKfbNumber(pendingMac);
      setMacAddress(pendingMac);
      okFlashAllowedRef.current = true;

      await runCheck(pendingMac, 0, pins);
      setIsScanning(false);
      setShowScanUi(false);
    },
    [
      FLAGS.REHYDRATE_ON_LOAD,
      FLAGS.USE_LOCKS,
      computeActivePins,
      runCheck,
      setIsScanning,
      setShowScanUi,
    ]
  );

  const handleScan = useCallback(
    async (raw: string, trig: ScanTrigger = "sse") => {
      if (trig !== "poll" && Date.now() < (idleCooldownUntilRef.current || 0))
        return;
      const now = Date.now();
      const trimmed = (raw || "").trim();
      if (!trimmed) return;
      const macFromAny = extractMac(trimmed);
      const normalized = (macFromAny || trimmed).toUpperCase();

      /* ---------------------------------------------------------------------- */
      /* HU: Token ablak (~1.5s) megakadályozza, hogy ugyanaz a kód duplán fusson (SSE vs. poll). */
      /* EN: Coalesce within ~1.5s to avoid duplicate runs (SSE + poll). */
      /* ---------------------------------------------------------------------- */
      const token = `${normalized}:${Math.floor(now / 1500)}`;
      if (lastScanTokenRef.current === token) return;
      lastScanTokenRef.current = token;

      /* ---------------------------------------------------------------------- */
      /* HU: Finalize után blokkolt MAC-et átugorjuk, amíg a guard le nem jár. */
      /* ---------------------------------------------------------------------- */
      if (blockedMacRef.current.has(normalized)) return;
      try {
        const lastMac = (lastFinalizedMacRef.current || "").toUpperCase();
        const lastAt = Number(lastFinalizedAtRef.current || 0);
        if (
          CFG.FINALIZED_RESCAN_BLOCK_MS &&
          lastMac &&
          normalized === lastMac &&
          Date.now() - lastAt < CFG.FINALIZED_RESCAN_BLOCK_MS
        )
          return;
      } catch {}

      /* ---------------------------------------------------------------------- */
      /* HU: Csak szabályos MAC vagy engedélyezett KFB kód mehet tovább; minden más elutasítva logolódik. */
      /* ---------------------------------------------------------------------- */
      if (!(canonicalMac(trimmed) || macFromAny || KFB_REGEX.test(trimmed))) {
        console.warn("[SCAN] invalid code format", { code: trimmed });
        return;
      }

      await loadBranchesData(macFromAny || trimmed, trig);
    },
    [CFG.FINALIZED_RESCAN_BLOCK_MS, loadBranchesData]
  );

  const handleScanRef = useRef<
    ((raw: string, trig?: ScanTrigger) => Promise<void>) | null
  >(null);
  useEffect(() => {
    handleScanRef.current = handleScan;
  }, [handleScan]);

  const tryRunPendingSimulate = useCallback(() => {
    const pending = pendingSimulateRef.current;
    if (!pending) return;
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
    pendingSimulateRef.current = null;
    simulateCooldownUntilRef.current = now + 2500;
    if (setupGateActive) enableSimOverride();
    void handleScanRef.current?.(pending.target, "sse");
  }, [enableSimOverride, isScanning, setupGateActive]);

  useEffect(() => {
    tryRunPendingSimulateRef.current = tryRunPendingSimulate;
  }, [tryRunPendingSimulate]);

  useEffect(() => {
    const tick = Number(serial.simulateCheckTick || 0);
    if (!tick || tick === lastSimulateCheckTickRef.current) return;
    lastSimulateCheckTickRef.current = tick;

    const macFromEvent = String(serial.simulateCheckMac || "").trim();
    const fallback = (macRef.current || "").trim();
    const target = (macFromEvent || fallback).toUpperCase();
    if (!target) {
      pendingSimulateRef.current = null;
      return;
    }

    pendingSimulateRef.current = { target, tick };
    tryRunPendingSimulate();
  }, [
    serial.simulateCheckTick,
    serial.simulateCheckMac,
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

  /* -------------------------------------------------------------------------- */
  /* [HU] UnionEffect
   *   - Élő union (nevek + pin lista) feldolgozása CSAK aktív MAC esetén.
   *   - Redis "degraded" módban az üres/uninformációs uniont ignorálja.
   *   - Az aktív KSK-k alapján korlátozza a pineket (computeActivePins).
   */
  /* [HU] RedisHealthEffect
   *   - Figyeli a redisReady flaget, drop esetén "degraded" állapotot kapcsol.
   *   - Helyreállás után (opcionális) rehydrate, ha épp fut check/scan aktív MAC-re.
   *   - Rövid debouncolás, hogy a villanásokat/ingadozásokat kiszűrje.
   */
  /* -------------------------------------------------------------------------- */
  /* -------------------------------------------------------------------------- */
  /* [HU] AutoFinalizeEffect
   *   - Ha minden megjelenített ág OK és nincs épp check/scanning,
   *     a jelenlegi MAC-re meghívja a finalize-t (felhasználó nélkül is).
   */
  /* -------------------------------------------------------------------------- */
  /** Auto-success if everything in view is OK (no failures) */
  /** START / RESULT / DONE device events
   *  IMPORTANT CHANGE:
   *  - If we have an active scanned MAC, treat events as for that MAC even if device mac is ZERO or mismatched.
   *  - ZERO_MAC is substituted with the active MAC; ignored only if there's no active MAC.
   */
  /* -------------------------------------------------------------------------- */
  /* [HU] DeviceEventsEffect
   *   - START: ha van ev.mac és még nincs aktív MAC, beállítja; mindig "checking" állapotba lép.
   *   - RESULT/DONE + OK: ha van AKTÍV MAC, minden ágat OK-ra állít és finalize-t kér.
   *   - FONTOS: a "00:00:00:00:00:00" (ZERO_MAC) esetén az aktív MAC-re helyettesítünk;
   *             ha nincs aktív MAC, a ZERO_MAC-et figyelmen kívül hagyjuk.
   *   - FAIL eseménynél, ha épp nem checkelünk, belép "checking" módba.
   */
  /* -------------------------------------------------------------------------- */
  /* ========================================================================== */
  /* [HU] ScannerEffect lépései
   *   1. SSE esemény szűrése: preferált olvasó útvonal (ACM0/USB0/index) ellenőrzése.
   *   2. Ütközésvédelem: aktív check/scanning és throttling blokkolja a feldolgozást.
   *   3. Koaleszcencia: token ablak (~1.5s) megakadályozza a dupla olvasást.
   */
  /* ========================================================================== */

  /* ========================================================================== */
  /* [HU] PollingEffect lépései
   *   1. SSE inaktivitás figyelése: stale időküszöb elérésekor lép működésbe.
   *   2. Feltételes poll: csak tétlen állapotban (nincs MAC, nincs check) indít kérést.
   *   3. Stabilizáció: útvonal-ellenőrzés és reentrancia gátak biztosítják a hibatűrést.
   */
  /* ========================================================================== */

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

  /* -------------------------------------------------------------------------- */
  /* [HU] PostResetSanityEffect
   *   - Finalize után (amikor már nincs aktív MAC) még egyszer óvatosan törli az aliasokat/lockokat,
   *     így elkerülhető bármilyen "szennyezett" állapot a következő scan előtt.
   */
  /* -------------------------------------------------------------------------- */
  /** Post-reset sanity cleanup for last finalized mac */
  /* -----------------------------------------------------------------------------
   * HUD derived info
   * ---------------------------------------------------------------------------*/
  /* -------------------------------------------------------------------------- */
  /* [HU] HUD (hudMode/hudMessage/hudSubMessage)
   *   - "idle" -> vár a scannelésre (scannerDetected alapján kieg. üzenet).
   *   - "scanning" -> rövid várakozás.
   *   - "info"/"error" -> átmeneti státuszok (pl. részleges hibalista, timeout).
   */
  /* -------------------------------------------------------------------------- */
  const handleHudIdle = useCallback(() => {
    idleCooldownUntilRef.current = 0;
    blockedMacRef.current.clear();
  }, []);

  const { hudMode, hudMessage, hudSubMessage, scannerDetected } = useHud({
    mainView,
    isScanning,
    showScanUi,
    scanResult,
    macAddress,
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

  /* -----------------------------------------------------------------------------
   * Render
   * ---------------------------------------------------------------------------*/
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

  return (
    <div className="relative flex min-h-screen bg-white">
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
        setOkFlashTick={setOkFlashTick}
        setMacAddress={setMacAddress}
        setKfbNumber={setKfbNumber}
        setIsChecking={setIsChecking}
        setIsScanning={setIsScanning}
        setBranchesData={setBranchesData}
        setCheckFailures={setCheckFailures}
        finalizeOkForMac={finalizeOkForMac}
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
        finalizeOkForMac={finalizeOkForMac}
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
            onToggleSidebar={toggleLeftSidebar}
          />
        )}

        <main className="flex-1 overflow-auto bg-white">
          {mainView === "dashboard" ? (
            <>
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
                onFinalizeOk={finalizeOkForMac}
                flashOkTick={okFlashTick}
                okSystemNote={okSystemNote}
                disableOkAnimation={disableOkAnimation}
                scanResult={scanResult}
              />
            </>
          ) : (
            <div className="p-6 text-slate-600">Settings view is disabled.</div>
          )}
        </main>
      </div>
    </div>
  );
};

export default MainApplicationUI;
