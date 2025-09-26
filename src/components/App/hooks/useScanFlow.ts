import { Dispatch, SetStateAction, useCallback, startTransition } from "react";
import { BranchDisplayData, TestStatus, KfbInfo } from "@/types/types";
import { canonicalMac, extractMac, macKey } from "../utils/mac";
import { KFB_REGEX } from "../utils/regex";
import { mergeAliasesFromItems } from "../utils/merge";
import { ScanResultState } from "./useHud";

/** React 19-friendly ref shape */
export type RefLike<T> = { current: T };

export type ScanTrigger = "sse" | "poll";

export const NO_SETUP_MSG = "No setup data available for this MAC";

export type UseScanFlowParams = {
  CFG: {
    CHECK_CLIENT_MS: number;
    RETRIES: number;
    FINALIZED_RESCAN_BLOCK_MS: number;
    RETRY_COOLDOWN_MS: number;
  };
  FLAGS: {
    REHYDRATE_ON_LOAD: boolean;
    USE_LOCKS: boolean;
  };
  schedule: (key: string, fn: () => void, ms: number) => void;
  cancel: (key: string) => void;
  computeActivePins: (
    items:
      | Array<{
          ksk?: string;
          kssk?: string;
          normalPins?: number[];
          latchPins?: number[];
        } | null>
      | undefined,
    activeIds: string[] | undefined
  ) => { normal: number[]; latch: number[] };
  finalizeOkForMac: (mac: string) => Promise<void>;
  handleResetKfb: () => void;
  clearScanOverlayTimeout: () => void;
  hasSetupForCurrentMac: () => boolean;

  setIsChecking: Dispatch<SetStateAction<boolean>>;
  setSuppressLive: Dispatch<SetStateAction<boolean>>;
  setScanResult: Dispatch<SetStateAction<ScanResultState>>;
  setCheckFailures: Dispatch<SetStateAction<number[] | null>>;
  setBranchesData: Dispatch<SetStateAction<BranchDisplayData[]>>;
  setGroupedBranches: Dispatch<
    SetStateAction<Array<{ ksk: string; branches: BranchDisplayData[] }>>
  >;
  setActiveKssks: Dispatch<SetStateAction<string[]>>;
  setNameHints: Dispatch<SetStateAction<Record<string, string> | undefined>>;
  setNormalPins: Dispatch<SetStateAction<number[] | undefined>>;
  setLatchPins: Dispatch<SetStateAction<number[] | undefined>>;
  setDisableOkAnimation: Dispatch<SetStateAction<boolean>>;
  setIsScanning: Dispatch<SetStateAction<boolean>>;
  setShowScanUi: Dispatch<SetStateAction<boolean>>;
  setKfbNumber: Dispatch<SetStateAction<string>>;
  setMacAddress: Dispatch<SetStateAction<string>>;
  setShouldShowHeader?: Dispatch<SetStateAction<boolean>>;
  setOkFlashTick: Dispatch<SetStateAction<number>>;
  setOkSystemNote: Dispatch<SetStateAction<string | null>>;
  setErrorMsg: Dispatch<SetStateAction<string | null>>;
  setKfbInfo: Dispatch<SetStateAction<KfbInfo | null>>;

  // Refs (use RefLike instead of MutableRefObject)
  isCheckingRef: RefLike<boolean>;
  scanResultTimerRef: RefLike<number | null>;
  lastRunHadFailuresRef: RefLike<boolean>;
  lastActiveIdsRef: RefLike<string[]>;
  itemsAllFromAliasesRef: RefLike<any[]>;
  lastScanRef: RefLike<string>;
  blockedMacRef: RefLike<Set<string>>;
  lastFinalizedMacRef: RefLike<string | null>;
  lastFinalizedAtRef: RefLike<number>;
  idleCooldownUntilRef: RefLike<number>;
  simulateCooldownUntilRef: RefLike<number>;
  pendingSimulateRef: RefLike<{ target: string; tick: number } | null>;
  tryRunPendingSimulateRef: RefLike<() => void>;
  okFlashAllowedRef: RefLike<boolean>;
  okShownOnceRef: RefLike<boolean>;
  lastScanTokenRef: RefLike<string>;
  noSetupCooldownRef: RefLike<{ mac: string; until: number } | null>;
  checkTokenRef: RefLike<string | null>;

  activeKssks: string[];
  latchPinsValue: number[] | undefined;
};

export type UseScanFlowResult = {
  runCheck: (mac: string, attempt?: number, pins?: number[], token?: string) => Promise<void>;
  loadBranchesData: (value?: string, trigger?: ScanTrigger) => Promise<void>;
  handleScan: (raw: string, trigger?: ScanTrigger) => Promise<void>;
};

export const useScanFlow = ({
  CFG,
  FLAGS,
  schedule,
  cancel,
  computeActivePins,
  finalizeOkForMac,
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
  noSetupCooldownRef,
  activeKssks,
  latchPinsValue,
  checkTokenRef,
}: UseScanFlowParams): UseScanFlowResult => {
  const updateHeaderVisibility = setShouldShowHeader ?? (() => {});
  const runCheck = useCallback(
    async (mac: string, attempt: number = 0, pins?: number[], token?: string) => {
      if (!mac) return;
      if (token && checkTokenRef.current && checkTokenRef.current !== token) return;

      setIsChecking(true);
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

      const scheduleFailureReset = (message: string) => {
        okFlashAllowedRef.current = false;
        setDisableOkAnimation(true);
        clearScanOverlayTimeout();
        checkTokenRef.current = null;
        try {
          blockedMacRef.current.clear();
        } catch {}
        if (message) {
          if (scanResultTimerRef.current) {
            clearTimeout(scanResultTimerRef.current);
            scanResultTimerRef.current = null;
          }
          setScanResult({ text: message, kind: "error" });
          scanResultTimerRef.current = window.setTimeout(() => {
            setScanResult(null);
            scanResultTimerRef.current = null;
          }, 2600);
        }
        setTimeout(() => {
          handleResetKfb();
          setGroupedBranches([]);
          setActiveKssks([]);
          setNameHints(undefined);
        }, 1300);
      };

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

          let pinsUsedSafe: number[] = [];
          try {
            const toPinArray = (value: unknown): number[] | undefined => {
              if (!Array.isArray(value)) return undefined;
              const pins = (value as Array<number | string>)
                .map((n) => Number(n))
                .filter((n) => Number.isFinite(n) && n > 0);
              return pins.length ? pins : undefined;
            };

            const pinsUsedRaw = toPinArray((result as any)?.pinsUsed);
            pinsUsedSafe = Array.isArray(pinsUsedRaw) ? pinsUsedRaw : [];
            const normalPinsFromResult = toPinArray(result?.normalPins);
            const latchPinsFromResult = toPinArray(result?.latchPins);

            const resolvedNormalPins =
              (normalPinsFromResult && normalPinsFromResult.length
                ? normalPinsFromResult
              : pinsUsedSafe) || undefined;

            setNormalPins(resolvedNormalPins);
            setLatchPins(latchPinsFromResult);
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

          const latchPins = latchPinsValue || [];

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
              const aliasPins = Object.keys(aliases)
                .map((n) => Number(n))
                .filter((n) => Number.isFinite(n) && n > 0);
              const pinsCombined = new Set<number>(aliasPins);
              for (const pin of pinsUsedSafe) pinsCombined.add(pin);
              for (const pin of failures)
                if (Number.isFinite(pin) && pin > 0) pinsCombined.add(pin);
              const pinsAll = Array.from(pinsCombined).sort((a, b) => a - b);

              const contactless = new Set<number>(
                (Array.isArray(result?.latchPins)
                  ? (result.latchPins as number[])
                  : latchPins
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
                      : latchPins
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
            const finalizePromise = finalizeOkForMac(mac);
            if (okFlashAllowedRef.current && !okShownOnceRef.current) {
              okShownOnceRef.current = true;
              setOkFlashTick((t) => t + 1);
            }
            try {
              await finalizePromise;
            } catch (err) {
              console.warn("[FLOW][CHECK] finalizeOkForMac failed", err);
            }
            return;
          }

          if (!setupReadyRef) {
            setGroupedBranches([]);
          }

          if (unknown) {
            const text = "CHECK ERROR (no pin list)";
            setScanResult({ text, kind: "error" });
            if (scanResultTimerRef.current)
              clearTimeout(scanResultTimerRef.current);
            scanResultTimerRef.current = window.setTimeout(() => {
              setScanResult(null);
              scanResultTimerRef.current = null;
            }, 2200);
          } else {
            if (scanResultTimerRef.current) {
              clearTimeout(scanResultTimerRef.current);
              scanResultTimerRef.current = null;
            }
            setScanResult(null);
          }

          setIsChecking(false);
          setSuppressLive(false);
          okFlashAllowedRef.current = false;
        } else {
          if (res.status === 429 && attempt < CFG.RETRIES) {
            schedule(
              "checkRetry",
              () => void runCheck(mac, attempt + 1, pins, token),
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
                () => void runCheck(mac, attempt + 1, pins, token),
                250
              );
            } else {
              scheduleFailureReset("Retry limit reached — please rescan");
            }
            cancel("checkWatchdog");
          } else {
            scheduleFailureReset("Unexpected CHECK error — please rescan");
            cancel("checkWatchdog");
          }
        }
      } catch (err) {
        if ((err as any)?.name === "AbortError" && attempt < CFG.RETRIES) {
          schedule(
            "checkRetry",
            () => void runCheck(mac, attempt + 1, pins, token),
            300
          );
        } else {
          scheduleFailureReset("Connection lost — please rescan");
        }
        cancel("checkWatchdog");
      } finally {
        cancel("checkWatchdog");
        const now = Date.now();
        if (!lastRunHadFailuresRef.current) {
          setIsChecking(false);
          idleCooldownUntilRef.current = now + 2500;
        } else {
          idleCooldownUntilRef.current = 0;
        }
        simulateCooldownUntilRef.current = Math.max(
          simulateCooldownUntilRef.current,
          now + 2500
        );
        if (pendingSimulateRef.current) tryRunPendingSimulateRef.current();
        if (token && checkTokenRef.current === token) checkTokenRef.current = null;
      }
    },
    [
      CFG.CHECK_CLIENT_MS,
      CFG.RETRIES,
      cancel,
      clearScanOverlayTimeout,
      finalizeOkForMac,
      handleResetKfb,
      hasSetupForCurrentMac,
      schedule,
      setActiveKssks,
      setBranchesData,
      setCheckFailures,
      setDisableOkAnimation,
      setGroupedBranches,
      setIsChecking,
      setLatchPins,
      setNameHints,
      setNormalPins,
      setScanResult,
      setSuppressLive,
      setOkFlashTick,
      lastActiveIdsRef,
      itemsAllFromAliasesRef,
      activeKssks,
      latchPinsValue,
    ]
  );

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
      lastScanRef.current = macKey(rawCode);

      setIsScanning(true);
      setErrorMsg(null);
      setKfbInfo(null);
      setCheckFailures(null);

      const pendingMac = isMac ? (macCanon as string) : "KFB";

      const blockKey = macKey(pendingMac);
      if (blockedMacRef.current.has(blockKey)) return;
      // Always require a fresh scan if setup data is missing; no cooldown loop.
      noSetupCooldownRef.current = null;

      updateHeaderVisibility(false);

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

      setKfbNumber(pendingMac);
      setMacAddress(pendingMac);

      const hasPins = Array.isArray(pins) && pins.length > 0;
      const hasAliases = Object.keys(aliases).length > 0;
      const hasActive = activeIds.length > 0;
      if (!hasPins && !hasAliases && !hasActive) {
        okFlashAllowedRef.current = false;
        setScanResult({ text: NO_SETUP_MSG, kind: "info" });
        setIsScanning(false);
        setShowScanUi(false);
        setKfbNumber("");
        setMacAddress("");
        idleCooldownUntilRef.current = 0;
        noSetupCooldownRef.current = null;
        try {
          blockedMacRef.current.clear();
          blockedMacRef.current.add(blockKey);
        } catch {}
        if (scanResultTimerRef.current)
          window.clearTimeout(scanResultTimerRef.current);
        const hideDelay = 2000;
        scanResultTimerRef.current = window.setTimeout(() => {
          setScanResult(null);
          scanResultTimerRef.current = null;
        }, hideDelay);
        return;
      }

      noSetupCooldownRef.current = null;
      okFlashAllowedRef.current = true;
      updateHeaderVisibility(true);

      const runToken = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
      checkTokenRef.current = runToken;
      await runCheck(pendingMac, 0, pins, runToken);
      setIsScanning(false);
      setShowScanUi(false);
    },
    [
      FLAGS.REHYDRATE_ON_LOAD,
      FLAGS.USE_LOCKS,
      computeActivePins,
      runCheck,
      setActiveKssks,
      setBranchesData,
      setCheckFailures,
      setErrorMsg,
      setIsScanning,
      setKfbInfo,
      setMacAddress,
      setKfbNumber,
      setNameHints,
      setNormalPins,
      setLatchPins,
      setDisableOkAnimation,
      setOkSystemNote,
      setShowScanUi,
      setShouldShowHeader,
    ]
  );

  const handleScan = useCallback(
    async (raw: string, trig: ScanTrigger = "sse") => {
      if (trig !== "poll" && Date.now() < (idleCooldownUntilRef.current || 0))
        return;
      const now = Date.now();
      const trimmed = (raw || "").trim();
      if (!trimmed) return;

      const key = macKey(trimmed);
      const token = `${key}:${Math.floor(now / 1500)}`;
      if (lastScanTokenRef.current === token) return;
      lastScanTokenRef.current = token;

      if (blockedMacRef.current.has(key)) return;
      try {
        const lastMac = (lastFinalizedMacRef.current || "").toUpperCase();
        const lastAt = Number(lastFinalizedAtRef.current || 0);
        if (
          CFG.FINALIZED_RESCAN_BLOCK_MS &&
          lastMac &&
          key === macKey(lastMac) &&
          Date.now() - lastAt < CFG.FINALIZED_RESCAN_BLOCK_MS
        )
          return;
      } catch {}

      if (
        !(
          canonicalMac(trimmed) ||
          extractMac(trimmed) ||
          KFB_REGEX.test(trimmed)
        )
      ) {
        console.warn("[SCAN] invalid code format", { code: trimmed });
        return;
      }

      await loadBranchesData(trimmed, trig);
    },
    [
      CFG.FINALIZED_RESCAN_BLOCK_MS,
      idleCooldownUntilRef,
      blockedMacRef,
      lastFinalizedAtRef,
      lastFinalizedMacRef,
      lastScanTokenRef,
      loadBranchesData,
    ]
  );

  return { runCheck, loadBranchesData, handleScan };
};

export default useScanFlow;
