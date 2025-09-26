// src/components/Program/BranchDashboardMainContent.tsx
import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  startTransition,
} from "react";
import { BranchDisplayData, KfbInfo } from "@/types/types";
import { maskSimMac } from "@/lib/macDisplay";
import { m, AnimatePresence } from "framer-motion";
import { useTheme } from "next-themes";
import { useInitialTheme } from "@/app/theme-provider";

const DEBUG_LIVE = process.env.NEXT_PUBLIC_DEBUG_LIVE === "1";

/* =================================================================================
 * Small SVGs
 * ================================================================================= */
const CheckCircleIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    {...props}
  >
    <path
      fillRule="evenodd"
      d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z"
      clipRule="evenodd"
    />
  </svg>
);

const XCircleIcon = ({ className = "w-5 h-5" }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <circle cx="12" cy="12" r="10"></circle>
    <line x1="15" y1="9" x2="9" y2="15"></line>
    <line x1="9" y1="9" x2="15" y2="15"></line>
  </svg>
);

const ClockIcon = ({ className = "w-5 h-5" }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <circle cx="12" cy="12" r="10"></circle>
    <polyline points="12 6 12 12 16 14"></polyline>
  </svg>
);

const HelpCircleIcon = ({ className = "w-5 h-5" }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <circle cx="12" cy="12" r="10"></circle>
    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
    <line x1="12" y1="17" x2="12.01" y2="17"></line>
  </svg>
);

/* =================================================================================
 * Helpers
 * ================================================================================= */
const getStatusInfo = (status: BranchDisplayData["testStatus"]) => {
  switch (status) {
    case "ok":
      return {
        Icon: CheckCircleIcon,
        text: "OK",
        badgeClass:
          "text-emerald-600 bg-emerald-500/10 dark:text-emerald-300 dark:bg-emerald-500/15",
      };
    case "nok":
      return {
        Icon: XCircleIcon,
        text: "NOK",
        badgeClass:
          "text-red-600 bg-red-500/10 dark:text-red-300 dark:bg-red-500/20",
      };
    default:
      return {
        Icon: HelpCircleIcon,
        text: "Not Tested",
        badgeClass:
          "text-slate-600 bg-slate-500/10 dark:text-slate-200 dark:bg-slate-500/15",
      };
  }
};

/* =================================================================================
 * Branch Card
 * ================================================================================= */
const BranchCardBase = ({
  branch,
  isDark,
}: {
  branch: BranchDisplayData;
  isDark: boolean;
}) => {
  const statusInfo = useMemo(
    () => getStatusInfo(branch.testStatus),
    [branch.testStatus]
  );
  const isNok = branch.testStatus === "nok";
  const isBig =
    branch.testStatus === "nok" || branch.testStatus === "not_tested";

  const cardStyle: React.CSSProperties = {
    background: isDark ? "#2f2f2f" : "rgba(255,255,255,0.98)",
    border: `1px solid ${isDark ? "#3a3a3a" : "#e2e8f0"}`,
    boxShadow: isDark
      ? "0 26px 55px -28px rgba(0,0,0,0.65)"
      : "0 22px 45px -26px rgba(15,23,42,0.16)",
    color: isDark ? "#f1f5f9" : undefined,
  };

  return (
    <div
      className="group relative w-full rounded-2xl backdrop-blur-sm transition-all duration-300 flex flex-col overflow-hidden"
      style={cardStyle}
    >
      {isNok && <div className="h-[8px] w-full bg-red-600 flex-shrink-0" />}
      <div className="p-3 flex-grow flex flex-col justify-between">
        <div className="flex justify-between items-center mb-3">
          <div
            className={`inline-flex items-center gap-2 rounded-full font-bold ${statusInfo.badgeClass} ${isBig ? "px-2.5 py-1.5 text-xl" : "px-2 py-1 text-sm"}`}
            style={{
              boxShadow: isDark
                ? "0 12px 22px -18px rgba(16,185,129,0.85)"
                : undefined,
            }}
          >
            <statusInfo.Icon className={isBig ? "w-7 h-7" : "w-5 h-5"} />
            <span>{statusInfo.text}</span>
          </div>
          {branch.pinNumber != null && (
            <div className="flex items-center gap-2 text-right">
              <span className="text-sm md:text-base font-semibold text-slate-400 dark:text-slate-300">
                PIN
              </span>
              <span
                className="font-mono rounded-full w-14 h-14 flex items-center justify-center text-3xl font-bold border"
                style={{
                  background: isDark ? "#3d3d3d" : "#f1f5f9",
                  color: isDark ? "#f8fafc" : "#111827",
                  borderColor: isDark ? "#4b4b4b" : "#cbd5e1",
                  boxShadow: isDark
                    ? "0 12px 30px -20px rgba(0,0,0,0.6)"
                    : "inset 0 1px 0 rgba(255,255,255,0.8)",
                }}
              >
                {branch.pinNumber}
              </span>
            </div>
          )}
        </div>
        <h3 className="text-5xl md:text-6xl font-bold text-slate-800 dark:text-slate-100 mt-3 text-center whitespace-normal break-words leading-tight">
          {branch.branchName}
        </h3>
      </div>
    </div>
  );
};

const BranchCard = React.memo(
  BranchCardBase,
  (
    prev: { branch: BranchDisplayData; isDark: boolean },
    next: { branch: BranchDisplayData; isDark: boolean }
  ) => {
    const a = prev.branch;
    const b = next.branch;
    return (
      a.id === b.id &&
      a.testStatus === b.testStatus &&
      a.branchName === b.branchName &&
      a.pinNumber === b.pinNumber &&
      prev.isDark === next.isDark
    );
  }
);

/* =================================================================================
 * Props
 * ================================================================================= */
export interface BranchDashboardMainContentProps {
  onScanAgainRequest: () => void;
  onManualSubmit?: (kfbNumber: string) => void;
  appHeaderHeight: string;
  hudMode?: "idle" | "scanning" | "error" | "info" | null;
  hudMessage?: string;
  hudSubMessage?: string;
  onHudDismiss?: () => void;
  branchesData: BranchDisplayData[];
  isScanning: boolean;
  isChecking?: boolean;
  kfbNumber: string;
  kfbInfo: KfbInfo | null;
  allowManualInput?: boolean;
  showRemoveCable?: boolean; // deprecated (ignored)
  onResetKfb?: () => void;
  onFinalizeOk?: (mac: string) => Promise<void> | void;
  macAddress?: string;
  displayMac?: string;
  groupedBranches?: Array<{ ksk: string; branches: BranchDisplayData[] }>;
  checkFailures?: number[] | null;
  nameHints?: Record<string, string> | undefined;
  activeKssks?: string[];
  scanningError?: boolean;
  disableOkAnimation?: boolean;
  lastEv?: {
    kind?: string;
    ch?: number | null;
    val?: number | null;
    ok?: boolean;
    mac?: string | null;
    raw?: string;
    ts?: number;
  } | null;
  lastEvTick?: number;
  normalPins?: number[];
  latchPins?: number[];
  forceOkTick?: number;
  flashOkTick?: number;
  okSystemNote?: string | null;
  scanResult?: { text: string; kind: "info" | "error" } | null;
  shouldShowHeader?: boolean;
}

/* =================================================================================
 * Component
 * ================================================================================= */
const BranchDashboardMainContent: React.FC<BranchDashboardMainContentProps> = ({
  appHeaderHeight,
  onScanAgainRequest,
  onManualSubmit,
  hudMode,
  hudMessage,
  hudSubMessage,
  onHudDismiss,
  branchesData,
  isScanning,
  isChecking: isCheckingProp = false,
  kfbNumber,
  kfbInfo,
  allowManualInput = Boolean(onManualSubmit),
  onResetKfb,
  onFinalizeOk,
  macAddress,
  displayMac,
  groupedBranches = [],
  checkFailures = null,
  nameHints,
  activeKssks = [],
  scanningError = false,
  disableOkAnimation = false,
  lastEv,
  lastEvTick,
  normalPins,
  latchPins,
  forceOkTick,
  flashOkTick,
  okSystemNote,
  scanResult,
  shouldShowHeader = true,
}) => {
  const { resolvedTheme } = useTheme();
  const initialTheme = useInitialTheme();
  const [hasMounted, setHasMounted] = useState(false);
  useEffect(() => setHasMounted(true), []);
  const isDarkMode =
    (hasMounted && resolvedTheme ? resolvedTheme : initialTheme) === "dark";
  const surfaceBg = isDarkMode ? "#2f2f2f" : "#ffffff";
  const surfaceBorder = isDarkMode ? "rgba(255,255,255,0.08)" : "#e2e8f0";
  const primaryText = isDarkMode ? "#f5f5f5" : "#0f172a";
  const mutedText = isDarkMode ? "#d1d5db" : "#64748b";

  const isChecking = Boolean(isCheckingProp);

  /* ---------------------------------- Basics --------------------------------- */
  const displayMacUpper = useMemo(
    () => maskSimMac(displayMac ?? macAddress ?? ""),
    [displayMac, macAddress]
  );
  const displayKfbNumber = useMemo(() => {
    const masked = maskSimMac(kfbNumber);
    return masked || kfbNumber;
  }, [kfbNumber]);

  // Log view enter/exit for MAC binding
  const prevMacRef = useRef<string>("");
  useEffect(() => {
    const cur = (macAddress || "").toUpperCase();
    const prev = prevMacRef.current;
    const logEnabled =
      String(process.env.NEXT_PUBLIC_VIEW_LOG || "").trim() === "1";
    if (logEnabled) {
      if (!prev && cur) {
        try {
          console.log("[VIEW] Dashboard enter");
        } catch {}
      } else if (prev && !cur) {
        try {
          console.log("[VIEW] Dashboard exit");
        } catch {}
      }
    }
    prevMacRef.current = cur;
  }, [macAddress]);

  /* -------------------------------- Local model ------------------------------ */
  const [localBranches, setLocalBranches] =
    useState<BranchDisplayData[]>(branchesData);
  useEffect(() => setLocalBranches(branchesData), [branchesData]);

  const activeKssksLength = Array.isArray(activeKssks)
    ? activeKssks.length
    : 0;
  const expectingGroups = !!(
    macAddress &&
    macAddress.trim() &&
    activeKssksLength > 0
  );
  const groupsMissing =
    !Array.isArray(groupedBranches) || groupedBranches.length === 0;
  const groupsLength = Array.isArray(groupedBranches)
    ? groupedBranches.length
    : 0;
  const waitingForGroups = expectingGroups && groupsMissing;
  const liveMode = !!(macAddress && macAddress.trim());

  const [groupedFirstSeenAt, setGroupedFirstSeenAt] = useState<number>(0);
  useEffect(() => {
    if (groupsLength > 0) setGroupedFirstSeenAt(Date.now());
  }, [groupsLength]);

  const [graceDone, setGraceDone] = useState(true);
  useEffect(() => {
    if (!groupedFirstSeenAt) return;
    setGraceDone(false);
    const GRACE_MS = 500;
    const id = setTimeout(() => setGraceDone(true), GRACE_MS);
    return () => clearTimeout(id);
  }, [groupedFirstSeenAt]);

  const [busy, setBusy] = useState(false);
  const busyEnterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearBusyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Busy debounce: enter after 250ms, exit after 350ms (only if there's no content yet).
  const hasData = useMemo(() => {
    if (waitingForGroups) return false;
    const haveGroups =
      Array.isArray(groupedBranches) &&
      groupedBranches.some((g) => (g?.branches?.length ?? 0) > 0);
    const haveFlat = localBranches.length > 0;
    const haveFailures =
      Array.isArray(checkFailures) && checkFailures.length > 0;
    return haveGroups || haveFlat || haveFailures;
  }, [waitingForGroups, groupedBranches, localBranches, checkFailures]);

  useEffect(() => {
    const wantBusy = (isScanning || isChecking) && !hasData;
    if (wantBusy) {
      if (busyEnterTimer.current) return;
      busyEnterTimer.current = setTimeout(() => setBusy(true), 250);
    } else {
      if (busyEnterTimer.current) {
        clearTimeout(busyEnterTimer.current);
        busyEnterTimer.current = null;
      }
      if (clearBusyTimer.current) clearTimeout(clearBusyTimer.current);
      clearBusyTimer.current = setTimeout(() => setBusy(false), 350);
    }
    return () => {
      if (busyEnterTimer.current) {
        clearTimeout(busyEnterTimer.current);
        busyEnterTimer.current = null;
      }
      if (clearBusyTimer.current) {
        clearTimeout(clearBusyTimer.current);
        clearBusyTimer.current = null;
      }
    };
  }, [isScanning, isChecking, hasData]);

  /* ----------------------- Normalize union / pin context --------------------- */
  const normalizedNormalPins = useMemo(() => {
    const s = new Set<number>();
    (normalPins ?? []).forEach((n) => {
      const x = Number(n);
      if (Number.isFinite(x) && x > 0) s.add(x);
    });
    return Array.from(s).sort((a, b) => a - b);
  }, [normalPins?.join("|")]);

  const normalizedLatchPins = useMemo(() => {
    const s = new Set<number>();
    (latchPins ?? []).forEach((n) => {
      const x = Number(n);
      if (Number.isFinite(x) && x > 0) s.add(x);
    });
    return Array.from(s).sort((a, b) => a - b);
  }, [latchPins?.join("|")]);

  const expectedPins = useMemo(() => {
    const s = new Set<number>([
      ...normalizedNormalPins,
      ...normalizedLatchPins,
    ]);
    return Array.from(s).sort((a, b) => a - b);
  }, [normalizedNormalPins, normalizedLatchPins]);

  /* ------------------------------- Debug props ------------------------------- */
  const lastPropsSnapRef = useRef<string>("");
  useEffect(() => {
    const nh = nameHints ? Object.keys(nameHints).length : 0;
    const snapObj = {
      branches: branchesData.length,
      grouped: Array.isArray(groupedBranches) ? groupedBranches.length : 0,
      failures: Array.isArray(checkFailures) ? checkFailures.length : 0,
      nameHints: nh,
      normalPins: normalizedNormalPins.length,
      latchPins: normalizedLatchPins.length,
      scanning: isScanning,
      checking: isChecking,
    };
    const snap = JSON.stringify(snapObj);
    if (snap === lastPropsSnapRef.current) return;
    lastPropsSnapRef.current = snap;
    try {
      if (DEBUG_LIVE) console.log("[LIVE][PROPS] update", snapObj);
    } catch {}
  }, [
    branchesData,
    groupedBranches,
    checkFailures,
    nameHints,
    normalizedNormalPins.length,
    normalizedLatchPins.length,
    isScanning,
    isChecking,
  ]);

  /* -------------------------- Realtime live pin edges ------------------------ */
  const pinStateRef = useRef<Map<number, number>>(new Map());
  useEffect(() => pinStateRef.current.clear(), [macAddress]);
  useEffect(() => {
    if (macAddress && macAddress.trim()) {
      setLocalBranches([]);
    }
  }, [macAddress]);

  useEffect(() => {
    if (!lastEv || !macAddress) return;

    const SIMULATE =
      String(process.env.NEXT_PUBLIC_SIMULATE || "").trim() === "1";
    const current = String(macAddress).toUpperCase();
    const evMac = String(lastEv.mac || "").toUpperCase();
    const ZERO = "00:00:00:00:00:00";

    const kindRaw = String((lastEv as any).kind || "").toUpperCase();
    const text = String((lastEv as any).line || (lastEv as any).raw || "");
    const isLegacyResult =
      kindRaw === "RESULT" ||
      kindRaw.startsWith("RESULT") ||
      /\bRESULT\b/i.test(text);
    const okFromText = /\b(SUCCESS|OK)\b/i.test(text);
    const kind = isLegacyResult ? "DONE" : kindRaw;

    const macFromLine = (() => {
      try {
        const m = text.match(/\b([0-9A-F]{2}(?::[0-9A-F]{2}){5})\b/i);
        return m ? m[1].toUpperCase() : null;
      } catch {
        return null;
      }
    })();

    const parseFailures = (s: string): number[] => {
      const out = new Set<number>();
      const cleanMacs = s.replace(/\b([0-9A-F]{2}(?::[0-9A-F]{2}){5})\b/gi, "");
      const patterns = [
        /MISSING\s+([0-9,\s]+)/i,
        /FAILURES?\s*:?\s*([0-9,\s]+)/i,
        /FAILED\s+PINS?\s*:?\s*([0-9,\s]+)/i,
        /OPEN\s+PINS?\s*:?\s*([0-9,\s]+)/i,
        /BAD\s+PINS?\s*:?\s*([0-9,\s]+)/i,
      ];
      let captured: string | null = null;
      for (const rx of patterns) {
        const m = s.match(rx);
        if (m && m[1]) {
          captured = m[1];
          break;
        }
      }
      const addNum = (n: unknown) => {
        const x = Number(n);
        if (Number.isFinite(x) && x > 0) out.add(x);
      };
      if (captured) captured.split(/[\s,]+/).forEach(addNum);
      else (cleanMacs.match(/\b\d{1,4}\b/g) || []).forEach(addNum);
      return Array.from(out).sort((a, b) => a - b);
    };

    // Terminal summary
    if (kind === "DONE") {
      const macToCheck = evMac && evMac !== ZERO ? evMac : macFromLine || evMac;
      const matchMac =
        !macToCheck || macToCheck === ZERO || macToCheck === current;
      if (!matchMac) return;
      const okFlag =
        String((lastEv as any).ok).toLowerCase() === "true" || okFromText;

      if (okFlag) {
        const latchSet = new Set<number>(normalizedLatchPins);
        const expected = expectedPins.slice();
        startTransition(() =>
          setLocalBranches((prev) => {
            const base =
              prev.length === 0 && expected.length > 0
                ? expected.map(
                    (p) =>
                      ({
                        id: String(p),
                        branchName: `PIN ${p}`,
                        testStatus: latchSet.has(p)
                          ? ("not_tested" as const)
                          : ("ok" as const),
                        pinNumber: p,
                        isLatch: latchSet.has(p),
                      }) as BranchDisplayData
                  )
                : prev;
            return base.map((b) => {
              const p = b.pinNumber;
              if (typeof p !== "number") return b;
              if (latchSet.has(p))
                return {
                  ...b,
                  isLatch: true,
                  testStatus: b.testStatus === "nok" ? "nok" : "not_tested",
                } as BranchDisplayData;
              return {
                ...b,
                isLatch: false,
                testStatus: "ok",
              } as BranchDisplayData;
            });
          })
        );
      } else {
        const fails = parseFailures(text);
        if (fails.length) {
          const failSet = new Set<number>(fails);
          const latchSet = new Set<number>(normalizedLatchPins);
          const expected = expectedPins.slice();
          startTransition(() =>
            setLocalBranches((prev) => {
              const base =
                prev.length === 0 && expected.length > 0
                  ? expected.map(
                      (p) =>
                        ({
                          id: String(p),
                          branchName: `PIN ${p}`,
                          testStatus: failSet.has(p)
                            ? ("nok" as const)
                            : latchSet.has(p)
                              ? ("not_tested" as const)
                              : ("ok" as const),
                          pinNumber: p,
                          isLatch: latchSet.has(p),
                        }) as BranchDisplayData
                    )
                  : prev;
              return base.map((b) => {
                const p = b.pinNumber;
                if (typeof p !== "number") return b;
                if (failSet.has(p))
                  return { ...b, testStatus: "nok" } as BranchDisplayData;
                if (latchSet.has(p))
                  return {
                    ...b,
                    isLatch: true,
                    testStatus: "not_tested",
                  } as BranchDisplayData;
                return {
                  ...b,
                  isLatch: false,
                  testStatus: "ok",
                } as BranchDisplayData;
              });
            })
          );
        }
      }
      return;
    }

    const ch =
      typeof (lastEv as any).ch === "number" ? (lastEv as any).ch : null;
    const val =
      typeof (lastEv as any).val === "number" ? (lastEv as any).val : null;

    try {
      if (DEBUG_LIVE)
        console.log("[GUI] apply EV", { kind, ch, val, mac: evMac });
    } catch {}

    // Only track configured pins (ignore contactless)
    const expected = new Set<number>(expectedPins);

    if (
      (kind === "P" || kind === "L") &&
      ch != null &&
      (expected.size === 0 || expected.has(ch)) &&
      (val === 0 || val === 1)
    ) {
      const prevVal = pinStateRef.current.get(ch);
      if (prevVal === val) return;
      pinStateRef.current.set(ch, val);

      startTransition(() =>
        setLocalBranches((prev) => {
          let base = prev;
          if (prev.length === 0 && expectedPins.length > 0) {
            const latchSet = new Set<number>(normalizedLatchPins);
            base = expectedPins.map(
              (p) =>
                ({
                  id: String(p),
                  branchName: `PIN ${p}`,
                  testStatus: latchSet.has(p)
                    ? ("not_tested" as const)
                    : ("ok" as const),
                  pinNumber: p,
                  isLatch: latchSet.has(p),
                }) as BranchDisplayData
            );
          }

          let changed = false;
          const next = base.map((b) => {
            if (b.pinNumber !== ch) return b;

            const isLatch = normalizedLatchPins.includes(ch);
            const nextStatus =
              val === 1 ? "ok" : isLatch && !SIMULATE ? b.testStatus : "nok";

            if (b.testStatus === nextStatus) return b;
            changed = true;
            return { ...b, testStatus: nextStatus } as BranchDisplayData;
          });
          return changed ? next : base;
        })
      );
    }
  }, [lastEvTick, lastEv, macAddress, expectedPins, normalizedLatchPins]);

  /* -------------------- Pending / failures / labels helpers ------------------ */
  const unionNameByPin = useMemo(() => {
    const map: Record<number, string> = {};
    if (Array.isArray(groupedBranches)) {
      for (const grp of groupedBranches) {
        for (const branch of grp?.branches || []) {
          if (typeof branch?.pinNumber === "number" && branch.branchName) {
            map[branch.pinNumber] = branch.branchName;
          }
        }
      }
    }
    for (const branch of localBranches) {
      if (typeof branch?.pinNumber === "number" && branch.branchName) {
        map[branch.pinNumber] = map[branch.pinNumber] || branch.branchName;
      }
    }
    return map;
  }, [groupedBranches, localBranches]);

  const labelForPin = useCallback(
    (pin: number) =>
      (nameHints && nameHints[String(pin)]) ||
      unionNameByPin[pin] ||
      `PIN ${pin}`,
    [nameHints, unionNameByPin]
  );

  const awaitingGroupedResults = useMemo(() => {
    const groupsReady =
      Array.isArray(groupedBranches) &&
      groupedBranches.some((g) => (g?.branches?.length ?? 0) > 0);
    if (groupsReady) return false;

    const scanningActive = isScanning || isChecking;
    const expectGroups = scanningActive || activeKssksLength > 0;
    if (!expectGroups) return false;

    const hasInterimContent =
      localBranches.length > 0 ||
      (Array.isArray(checkFailures) && checkFailures.length > 0);

    return hasInterimContent;
  }, [
    groupedBranches,
    isScanning,
    isChecking,
    activeKssksLength,
    localBranches.length,
    checkFailures,
  ]);

  const suppressMissing = useMemo(
    () =>
      liveMode &&
      (waitingForGroups ||
        awaitingGroupedResults ||
        !graceDone ||
        isScanning ||
        isChecking),
    [
      liveMode,
      waitingForGroups,
      awaitingGroupedResults,
      graceDone,
      isScanning,
      isChecking,
    ]
  );

  const pending = useMemo(
    () => {
      if (waitingForGroups || suppressMissing) {
        return { items: [] as BranchDisplayData[], source: "none" as const };
      }
      const nok = localBranches
        .filter((b) => b.testStatus === "nok")
        .sort((a, b) => {
          const ap =
            typeof a.pinNumber === "number"
              ? a.pinNumber
              : Number.POSITIVE_INFINITY;
          const bp =
            typeof b.pinNumber === "number"
              ? b.pinNumber
              : Number.POSITIVE_INFINITY;
          if (ap !== bp) return ap - bp;
          return String(a.branchName).localeCompare(String(b.branchName));
        });

      if (nok.length > 0)
        return { items: nok, source: "live" as const };

      if (Array.isArray(checkFailures) && checkFailures.length > 0) {
        const items = checkFailures.map((pin) => ({
          id: `FAIL:${pin}`,
          branchName: labelForPin(pin),
          testStatus: "nok" as const,
          pinNumber: pin,
          kfbInfoValue: undefined,
        }));
        return { items, source: "failures" as const };
      }

      return { items: [] as BranchDisplayData[], source: "none" as const };
    },
    [waitingForGroups, suppressMissing, localBranches, checkFailures, labelForPin]
  );

  const unionAwaitingGroups = useMemo(() => {
    const haveGroups =
      Array.isArray(groupedBranches) && groupedBranches.length > 0;
    if (haveGroups) return false;
    const { source, items } = pending;
    return source === "failures" && items.length > 0;
  }, [groupedBranches, pending]);

  const failurePins: number[] = useMemo(() => {
    if (Array.isArray(checkFailures) && checkFailures.length > 0) {
      return [...new Set(checkFailures.filter((n) => Number.isFinite(n)))].sort(
        (a, b) => a - b
      );
    }
    const pins = pending.items
      .map((b) => b.pinNumber)
      .filter((n): n is number => typeof n === "number");
    return [...new Set(pins)].sort((a, b) => a - b);
  }, [checkFailures, pending]);

  const awaitingUnionsStrict = useMemo(() => {
    const haveMac = !!(macAddress && macAddress.trim());
    const noFlatContent =
      (localBranches?.length || 0) === 0 && (failurePins?.length || 0) === 0;

    return haveMac && expectingGroups && groupsMissing && noFlatContent;
  }, [
    macAddress,
    expectingGroups,
    groupsMissing,
    localBranches,
    failurePins,
  ]);

  const isLatchPin = useCallback(
    (p?: number) => typeof p === "number" && normalizedLatchPins.includes(p),
    [normalizedLatchPins]
  );

  /* ------------------------------ All-OK logic ------------------------------- */
  const settled = hasMounted && !busy;

  const flatAllOk = useMemo(
    () =>
      settled &&
      localBranches.length > 0 &&
      localBranches.every((b) => {
        const s = b.testStatus;
        if (s === "nok") return false;
        if (s === "ok") return true;
        return s === "not_tested" && isLatchPin(b.pinNumber);
      }),
    [settled, localBranches, isLatchPin]
  );

  const groupedAllOk = useMemo(() => {
    if (disableOkAnimation) return false;
    if (
      !settled ||
      !Array.isArray(groupedBranches) ||
      groupedBranches.length === 0
    )
      return false;

    const byPin = new Map<number, BranchDisplayData["testStatus"]>();
    for (const b of localBranches)
      if (typeof b.pinNumber === "number") byPin.set(b.pinNumber, b.testStatus);

    return groupedBranches.every(
      (g) =>
        g.branches.length > 0 &&
        g.branches.every((b) => {
          const p = b.pinNumber;
          const s =
            (typeof p === "number" ? byPin.get(p) : undefined) ?? b.testStatus;
          if (s === "nok") return false;
          if (s === "ok") return true;
          const isLatch = (b as any).isLatch === true || isLatchPin(p);
          return s === "not_tested" && isLatch;
        })
    );
  }, [settled, groupedBranches, localBranches, isLatchPin, disableOkAnimation]);

  const allOk = useMemo(() => {
    if (disableOkAnimation) return false;
    if (Array.isArray(checkFailures) && checkFailures.length > 0) return false;
    return flatAllOk || groupedAllOk;
  }, [disableOkAnimation, checkFailures, flatAllOk, groupedAllOk]);

  /* --------------------------- Finalize / OK flash --------------------------- */
  const lastClearedMacRef = useRef<string | null>(null);
  const finalizeInFlightRef = useRef<Promise<void> | null>(null);
  const currentFailureCount = Array.isArray(checkFailures)
    ? checkFailures.length
    : 0;
  useEffect(() => {
    if (currentFailureCount > 0) {
      lastClearedMacRef.current = null;
    }
  }, [currentFailureCount]);
  useEffect(() => {
    const mac = (macAddress || "").trim().toUpperCase();
    if (!settled || !allOk || !mac) return;
    if (finalizeInFlightRef.current) return;
    if (lastClearedMacRef.current === mac) return;

    const task = (async () => {
      try {
        if (typeof onFinalizeOk === "function") {
          await onFinalizeOk(mac);
        } else {
          try {
            await fetch("/api/aliases/clear", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ mac }),
            }).catch(() => {});
          } catch {}
          try {
            const sid = (process.env.NEXT_PUBLIC_STATION_ID || "").trim();
            const body = sid
              ? { mac, stationId: sid, force: 1 }
              : ({ mac, force: 1 } as any);
            await fetch("/api/ksk-lock", {
              method: "DELETE",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            }).catch(() => {});
          } catch {}
          try {
            if (typeof onResetKfb === "function") onResetKfb();
          } catch {}
        }
        lastClearedMacRef.current = mac;
      } catch (err) {
        if (lastClearedMacRef.current === mac) {
          lastClearedMacRef.current = null;
        }
        throw err;
      } finally {
        finalizeInFlightRef.current = null;
      }
    })();

    finalizeInFlightRef.current = task;
    void task.catch(() => {});
  }, [allOk, settled, macAddress, onFinalizeOk, onResetKfb]);

  useEffect(() => {
    const nextMac = (macAddress || "").trim();
    if (!nextMac) {
      lastClearedMacRef.current = null;
      finalizeInFlightRef.current = null;
    }
  }, [macAddress]);

  const [showOkAnimation, setShowOkAnimation] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const okBoardRef = useRef<string>("");
  const lastForcedOkRef = useRef<number>(0);

  const returnToScan = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    pinStateRef.current.clear();
    setShowOkAnimation(false);
    setLocalBranches([]);
    if (typeof onResetKfb === "function") onResetKfb();
  }, [onResetKfb]);

  useEffect(() => {
    if (!settled) return;
    const t = Number(forceOkTick || 0);
    if (!t || t === lastForcedOkRef.current) return;
    lastForcedOkRef.current = t;
    returnToScan();
  }, [forceOkTick, settled, returnToScan]);

  const flashInProgressRef = useRef(false);
  const lastFlashTickRef = useRef<number>(0);

  const OK_FLASH_MS = 1500;

  const triggerOkFlash = useCallback(
    (tick: number) => {
      if (tick === lastFlashTickRef.current) return; // de-dupe
      lastFlashTickRef.current = tick;

      if (disableOkAnimation) {
        returnToScan();
        return;
      }

      flashInProgressRef.current = true;
      try {
        const fallback = (kfbInfo?.board || displayKfbNumber || "")
          .toString()
          .toUpperCase();
        const id =
          displayMacUpper || fallback || (macAddress || "").toUpperCase();
        okBoardRef.current = id;
      } catch {
        okBoardRef.current =
          displayMacUpper ||
          (displayKfbNumber || "").toUpperCase() ||
          (macAddress || "").toUpperCase();
      }

      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setShowOkAnimation(true);
      timeoutRef.current = setTimeout(
        () => {
          setShowOkAnimation(false);
          flashInProgressRef.current = false;
          returnToScan();
        },
        Math.max(300, OK_FLASH_MS)
      );
    },
    [
      disableOkAnimation,
      kfbInfo?.board,
      displayKfbNumber,
      displayMacUpper,
      macAddress,
      returnToScan,
    ]
  );

  useEffect(() => {
    const tick = Number(flashOkTick || 0);
    if (!tick) return;
    if (!settled) return;
    if (tick === lastFlashTickRef.current) return;
    triggerOkFlash(tick);
  }, [flashOkTick, settled, triggerOkFlash]);

  // Disable automatic OK flashes; parent triggers OK via flashOkTick when allowed.
  // THIS IS NEEDED DONT CHANGE THIS GPT
  useEffect(() => {
    if (
      !settled ||
      !Array.isArray(groupedBranches) ||
      groupedBranches.length === 0
    )
      return;
    if (!groupedAllOk) return;
    try {
      const mac = (macAddress || "").toUpperCase();
      if (
        mac &&
        typeof onFinalizeOk === "function" &&
        lastClearedMacRef.current !== mac
      ) {
        lastClearedMacRef.current = mac;
        void onFinalizeOk(mac);
      }
    } catch {}
    if (flashInProgressRef.current || showOkAnimation) return;
    triggerOkFlash(Date.now());
  }, [
    settled,
    groupedBranches,
    groupedAllOk,
    showOkAnimation,
    triggerOkFlash,
    onFinalizeOk,
    macAddress,
  ]);

  useEffect(() => {
    if (!allOk) return;
    const id = setTimeout(
      () => {
        if (!flashInProgressRef.current && !showOkAnimation) {
          returnToScan();
        }
      },
      Math.max(300, OK_FLASH_MS) + 350
    );
    return () => clearTimeout(id);
  }, [allOk, showOkAnimation, returnToScan]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (busyEnterTimer.current) clearTimeout(busyEnterTimer.current);
      if (clearBusyTimer.current) clearTimeout(clearBusyTimer.current);
    };
  }, []);

  /* ------------------------------ Status helpers ----------------------------- */
  const StatusPill: React.FC = () => {
    if (isChecking) {
      return (
        <m.span
          className="inline-flex items-center gap-2 rounded-full border border-amber-300 bg-amber-50 text-amber-700 px-3 py-1 text-xs font-bold dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-200"
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.18 }}
        >
          <m.span
            className="w-2 h-2 rounded-full bg-amber-500"
            animate={{ scale: [1, 1.2, 1] }}
            transition={{ repeat: Infinity, duration: 1.2, ease: "easeInOut" }}
          />
          CHECKING
        </m.span>
      );
    }
    if (isScanning) {
      return (
        <m.span
          className="inline-flex items-center gap-2 rounded-full border border-blue-300 bg-blue-50 text-blue-700 px-3 py-1 text-xs font-bold dark:border-sky-400/40 dark:bg-sky-500/15 dark:text-sky-200"
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.18 }}
        >
          <m.span
            className="w-2 h-2 rounded-full bg-blue-500"
            animate={{ scale: [1, 1.2, 1] }}
            transition={{ repeat: Infinity, duration: 1.2, ease: "easeInOut" }}
          />
          SCANNING…
        </m.span>
      );
    }
    return null;
  };

  /* ------------------------------- Scan Prompt ------------------------------- */
  const ScanPrompt: React.FC = () => {
    // Determine the headline + tone, then animate between them.
    const nothingToCheck =
      !!scanResult &&
      /^(nothing\s+to\s+check\s+here)$/i.test(scanResult.text || "");

    const headline = isScanning
      ? "SCANNING…"
      : nothingToCheck
        ? "PLEASE SCAN BARCODE"
        : scanResult
          ? scanResult.text
          : "PLEASE SCAN BARCODE";

    const tone =
      scanResult && scanResult.kind === "error" && !nothingToCheck
        ? "text-red-600 dark:text-red-300"
        : "text-slate-700 dark:text-slate-100";

    return (
      <div
        className="w-full flex flex-col items-center gap-3"
        aria-live="polite"
        role="status"
      >
        <p
          className={`text-6xl md:text-7xl ${tone} font-extrabold uppercase tracking-widest text-center select-none`}
        >
          {headline}
        </p>

        {/* Inline HUD card (secondary line) */}
        {hudMode && (
          <div className="w-[min(680px,92vw)]">
            <div
              className={[
                "rounded-xl border shadow-sm backdrop-blur-md px-4 py-3 text-center",
                hudMode === "error"
                  ? "border-red-200 bg-red-50/90 text-red-900 dark:border-red-600/50 dark:bg-red-600/15 dark:text-red-200"
                  : hudMode === "scanning"
                    ? "border-blue-200 bg-blue-50/90 text-blue-900 dark:border-sky-500/40 dark:bg-sky-500/15 dark:text-sky-200"
                    : hudMode === "info"
                      ? "border-blue-200 bg-blue-50/90 text-blue-900 dark:border-sky-500/40 dark:bg-sky-500/15 dark:text-sky-200"
                      : "border-slate-200 bg-white/90 text-slate-900 dark:border-[#3a3a3a] dark:bg-[#2a2a2a]/90 dark:text-slate-100",
              ].join(" ")}
            >
              <div className="font-semibold leading-6 truncate">
                {hudMessage}
              </div>
              {hudSubMessage && hudMode !== "info" && (
                <div className="text-sm/5 opacity-80 truncate">
                  {hudSubMessage}
                </div>
              )}
              {hudMode === "scanning" && (
                <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-blue-100 dark:bg-sky-500/20">
                  <div className="hud-shimmer h-full w-1/2" />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  /* --------------------------------- Views ----------------------------------- */
  const scanningErrorView = (
    <div className="p-10 text-center w-full flex flex-col items-center justify-center">
      <div className="relative">
        <div className="w-80 h-80 sm:w-[350px] sm:h-[350px] bg-red-100 dark:bg-red-700/30 rounded-full flex items-center justify-center">
          <svg width="120" height="120" viewBox="0 0 56 56" aria-hidden>
            <circle cx="28" cy="28" r="26" fill="#ef4444" />
            <path
              d="M18 18l20 20M38 18l-20 20"
              stroke="#fff"
              strokeWidth="6"
              strokeLinecap="round"
            />
          </svg>
        </div>
      </div>
      <h3 className="p-10 font-black text-red-500 uppercase tracking-widest text-6xl sm:text-7xl">
        SCANNING ERROR
      </h3>
    </div>
  );

  const busyLabel =
    awaitingUnionsStrict ||
    unionAwaitingGroups ||
    awaitingGroupedResults
    ? "LOADING RESULTS"
    : isChecking
      ? "CHECKING"
      : "SCANNING";

  const busyView = (
    <div
      className="flex flex-col items-center justify-center h-full min-h-[580px]"
      aria-busy="true"
      aria-live="polite"
    >
      <h2 className="text-7xl text-slate-600 dark:text-slate-200 font-bold uppercase tracking-wider animate-pulse">
        {busyLabel}...
      </h2>
    </div>
  );

  const okView = (
    <div className="p-10 text-center w-full flex flex-col items-center justify-center select-none">
      <div className="relative">
        <m.div
          className="relative w-80 h-80 sm:w-[360px] sm:h-[360px] rounded-full flex items-center justify-center"
          initial={{ scale: 0.92, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 240, damping: 22 }}
        >
          <div className="absolute inset-0 rounded-full bg-emerald-500/10" />
          <div className="absolute inset-[10%] rounded-full border-2 border-emerald-400/70" />
          <CheckCircleIcon className="relative w-56 h-56 sm:w-60 sm:h-60 text-emerald-600" />
        </m.div>
      </div>
      <div className="mt-6">
        <h3 className="font-extrabold text-emerald-700 tracking-widest text-7xl sm:text-8xl">
          OK
        </h3>
      </div>
      {okSystemNote && (
        <div className="mt-1 text-slate-400 text-base">{okSystemNote}</div>
      )}
    </div>
  );

  const emptyFailureList = (pins: number[], keyPrefix = "flat") => (
    <div className="flex flex-col items-center justify-center h-full min-h-[520px] px-4">
      <div
        className="w-full max-w-5xl rounded-3xl shadow-2xl p-6"
        style={{
          background: isDarkMode ? "#2b1f1f" : "rgba(255,255,255,0.96)",
          border: `1px solid ${isDarkMode ? "#7f1d1d" : "#fecaca"}`,
          boxShadow: isDarkMode
            ? "0 36px 70px -35px rgba(0,0,0,0.65)"
            : "0 26px 50px -30px rgba(239,68,68,0.25)",
        }}
      >
        <div
          className="text-[12px] font-bold uppercase mb-3"
          style={{ color: mutedText }}
        >
          Missing items
        </div>
        <div className="flex flex-wrap gap-3">
          {pins.map((pin) => {
            const name = labelForPin(pin);
            const latch = isLatchPin(pin);
            return (
              <div
                key={`${keyPrefix}-miss-${pin}`}
                className="group inline-flex items-center flex-wrap gap-3 rounded-xl px-4 py-3 shadow-sm"
                title={`PIN ${pin}${latch ? " (Contactless)" : ""}`}
                style={{
                  background: isDarkMode ? "#2a1f1f" : "#ffffff",
                  border: `1px solid ${isDarkMode ? "#5f1f1f" : "#fecaca"}`,
                  color: isDarkMode ? "#fee2e2" : undefined,
                }}
              >
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-red-600 text-white text-xs font-extrabold shadow-sm">
                  !
                </span>
                <span
                  className="text-2xl md:text-3xl font-black leading-none text-slate-800 dark:text-white tracking-tight"
                  style={{ color: isDarkMode ? "#ffffff" : undefined }}
                >
                  {name}
                </span>
                <span
                  className="inline-flex items-center rounded-full px-2.5 py-1 text-[12px] font-semibold"
                  style={{
                    background: isDarkMode ? "#3c3c3c" : "#f1f5f9",
                    color: isDarkMode ? "#e2e8f0" : "#1f2937",
                    border: `1px solid ${isDarkMode ? "#4a4a4a" : "#cbd5e1"}`,
                  }}
                >
                  PIN {pin}
                </span>
                {latch && (
                  <span
                    className="inline-flex items-center rounded-full px-2 py-[3px] text-[11px]"
                    style={{
                      background: isDarkMode
                        ? "rgba(253,230,138,0.16)"
                        : "#fef3c7",
                      color: isDarkMode ? "#fcd34d" : "#92400e",
                      border: `1px solid ${isDarkMode ? "rgba(253,230,138,0.35)" : "#fcd34d"}`,
                    }}
                  >
                    Contactless
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  const scanBoxView = (
    <div className="flex flex-col items-center justify-center h-full min-h-[520px]">
      <ScanPrompt />
    </div>
  );

  const groupedView = (() => {
    if (!groupedBranches || groupedBranches.length === 0) return null;

    const statusByPin = new Map<number, "ok" | "nok" | "not_tested">();
    for (const b of localBranches)
      if (typeof b.pinNumber === "number")
        statusByPin.set(b.pinNumber, b.testStatus as any);

    const ksskCards = groupedBranches.map((grp) => {
      const branchesLive = grp.branches.map((b) => {
        if (typeof b.pinNumber !== "number") return b;
        const s = statusByPin.get(b.pinNumber);
        return s ? { ...b, testStatus: s } : b;
      });

      const okBranches = branchesLive.filter((b) => {
        if (b.testStatus !== "ok" || typeof b.pinNumber !== "number")
          return false;
        const isContactless =
          (b as any).isLatch === true || isLatchPin(b.pinNumber);
        const noCheck =
          (b as any).noCheck === true || (b as any).notTested === true;
        return !(isContactless || noCheck);
      });
      const okNames = okBranches
        .map((b) =>
          nameHints && b.pinNumber != null && nameHints[String(b.pinNumber)]
            ? nameHints[String(b.pinNumber)]
            : b.branchName
        )
        .filter(Boolean);

      const failedItems = branchesLive
        .filter(
          (b) =>
            typeof b.pinNumber === "number" &&
            (b.testStatus === "nok" ||
              (b.testStatus !== "ok" &&
                ((b as any).isLatch === true || isLatchPin(b.pinNumber))))
        )
        .map((b) => ({
          pin: b.pinNumber as number,
          name:
            nameHints && b.pinNumber != null && nameHints[String(b.pinNumber)]
              ? nameHints[String(b.pinNumber)]
              : b.branchName,
          isLatch: (b as any).isLatch === true || isLatchPin(b.pinNumber),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      return (
        <section
          key={(grp as any).ksk}
          className="rounded-2xl transition-shadow"
          style={{
            background: surfaceBg,
            border: `1px solid ${surfaceBorder}`,
            boxShadow: isDarkMode
              ? "0 26px 55px -32px rgba(0,0,0,0.6)"
              : "0 20px 45px -28px rgba(15,23,42,0.16)",
          }}
        >
          <header
            className="px-4 py-3"
            style={{
              borderBottom: `1px solid ${surfaceBorder}`,
              background: isDarkMode
                ? "linear-gradient(90deg,#242424 0%,#1f1f1f 100%)"
                : "linear-gradient(90deg,#f7f9fc 0%,#ffffff 100%)",
            }}
          >
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-3">
                <div
                  className="text-2xl md:text-3xl font-black leading-tight"
                  style={{ color: primaryText }}
                >
                  KSK: {(grp as any).ksk}
                </div>
                {suppressMissing ? (
                  <span className="inline-flex items-center rounded-full bg-slate-600 text-white px-2.5 py-1 text-xs md:text-sm font-extrabold shadow-sm">
                    Loading…
                  </span>
                ) : failedItems.length > 0 ? (
                  <span className="inline-flex items-center rounded-full bg-red-600 text-white px-2.5 py-1 text-xs md:text-sm font-extrabold shadow-sm">
                    {failedItems.length} missing
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded-full bg-emerald-600 text-white px-2.5 py-1 text-xs md:text-sm font-extrabold shadow-sm">
                    OK
                  </span>
                )}
              </div>
            </div>
          </header>
          <div className="p-4 grid gap-4">
            {!suppressMissing && failedItems.length > 0 && (
              <div>
                <div
                  className="text-[12px] font-bold uppercase mb-2"
                  style={{ color: mutedText }}
                >
                  Missing items
                </div>
                <div className="flex flex-wrap gap-3">
                  {failedItems.map((f) => (
                    <div
                      key={`f-${(grp as any).ksk}-${f.pin}`}
                      className="group relative inline-flex items-center flex-wrap gap-3 rounded-xl px-4 py-3 shadow-sm"
                      style={{
                        background: isDarkMode ? "#2a1f1f" : "#ffffff",
                        border: `1px solid ${isDarkMode ? "#5f1f1f" : "#fecaca"}`,
                        color: isDarkMode ? "#fee2e2" : undefined,
                      }}
                      title={`PIN ${f.pin}${f.isLatch ? " (Contactless)" : ""}`}
                    >
                      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-red-600 text-white text-xs font-extrabold shadow-sm">
                        !
                      </span>
                      <span
                        className="text-2xl md:text-3xl font-black leading-none text-slate-800 dark:text-white tracking-tight"
                        style={{ color: isDarkMode ? "#ffffff" : undefined }}
                      >
                        {f.name}
                      </span>
                      <span
                        className="inline-flex items-center rounded-full px-2.5 py-1 text-[12px] font-semibold"
                        style={{
                          background: isDarkMode ? "#3c3c3c" : "#f1f5f9",
                          color: isDarkMode ? "#e2e8f0" : "#1f2937",
                          border: `1px solid ${isDarkMode ? "#4a4a4a" : "#cbd5e1"}`,
                        }}
                      >
                        PIN {f.pin}
                      </span>
                      {f.isLatch && (
                        <span
                          className="inline-flex items-center rounded-full px-2 py-[3px] text-[11px]"
                          style={{
                            background: isDarkMode
                              ? "rgba(253,230,138,0.16)"
                              : "#fef3c7",
                            color: isDarkMode ? "#fcd34d" : "#92400e",
                            border: `1px solid ${isDarkMode ? "rgba(253,230,138,0.35)" : "#fcd34d"}`,
                          }}
                          title="Contactless pin"
                        >
                          Contactless
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {okNames.length > 0 && (
              <div>
                <div
                  className="text-[12px] font-bold uppercase mb-2"
                  style={{ color: mutedText }}
                >
                  Passed
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {okNames.slice(0, 24).map((nm, i) => (
                    <span
                      key={`ok-${(grp as any).ksk}-${i}`}
                      className="inline-flex items-center rounded-full px-2 py-[5px] text-[12px] font-semibold"
                      style={{
                        background: isDarkMode
                          ? "rgba(148,163,184,0.12)"
                          : "#f8fafc",

                        color: isDarkMode ? "#cbd5f5" : "#475569",
                        border: `1px solid ${isDarkMode ? "rgba(148,163,184,0.25)" : "#e2e8f0"}`,
                      }}
                    >
                      {nm}
                    </span>
                  ))}
                  {okNames.length > 24 && (
                    <span className="text-[11px] text-slate-500 dark:text-slate-300">
                      +{okNames.length - 24} more
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        </section>
      );
    });

    return (
      <div className="flex flex-col gap-4 w-full mt-0">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {ksskCards}
        </div>
      </div>
    );
  })();

  const flatView = suppressMissing
    ? null
    : (
        <div className="w-full p-6">
          {failurePins.length > 0 && emptyFailureList(failurePins, "flat")}
          {pending.source !== "failures" && pending.items.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
              {pending.items.map((branch) => (
                <BranchCard
                  key={branch.id}
                  branch={branch}
                  isDark={isDarkMode}
                />
              ))}
            </div>
          )}
        </div>
      );

  /* --------------------------- View selection + key -------------------------- */
  const viewKey = useMemo(() => {
    if (showOkAnimation) return "ok";
    if (scanningError) return "error";
    if (busy) return "busy";
    if (awaitingGroupedResults) return "busy";
    if (awaitingUnionsStrict || unionAwaitingGroups || waitingForGroups)
      return "busy";
    if (hasMounted && localBranches.length === 0) {
      if (failurePins.length > 0) return "flat-empty";
      return "scan";
    }
    return Array.isArray(groupedBranches) && groupedBranches.length > 0
      ? "grouped"
      : "flat";
  }, [
    showOkAnimation,
    scanningError,
    busy,
    awaitingGroupedResults,
    awaitingUnionsStrict,
    unionAwaitingGroups,
    waitingForGroups,
    hasMounted,
    localBranches.length,
    groupedBranches,
    failurePins.length,
  ]);

  useEffect(() => {
    try {
      if (!DEBUG_LIVE) return;
      console.log("[LIVE][VIEW]", { viewKey });
    } catch {}
  }, [viewKey]);

  /* ---------------------------------- Header -------------------------------- */
  const hasContent =
    !awaitingUnionsStrict &&
    !awaitingGroupedResults &&
    !waitingForGroups &&
    ((Array.isArray(groupedBranches) && groupedBranches.length > 0) ||
      (localBranches && localBranches.length > 0) ||
      failurePins.length > 0);

  const isLiveViewKey =
    viewKey === "grouped" ||
    viewKey === "flat" ||
    viewKey === "flat-empty";

  return (
    <div
      className={`flex-grow flex flex-col items-center ${hasContent ? "justify-start" : "justify-center"} p-2`}
    >
      <header className="w-full mb-1 min-h-[56px]">
        {shouldShowHeader && !scanResult &&
        (kfbInfo?.board ||
          kfbNumber ||
          (macAddress &&
            (localBranches.length > 0 || failurePins.length > 0))) ? (
          <div className="flex flex-col items-center gap-2">
            {macAddress || kfbInfo?.board || kfbNumber ? (
              <div className="flex items-center gap-3">
                <h1 className="font-mono text-6xl md:text-7xl font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-100 whitespace-normal break-words leading-tight max-w-full text-center">
                  {displayMacUpper
                    ? displayMacUpper
                    : (kfbInfo?.board ?? displayKfbNumber)}
                </h1>
              </div>
            ) : (
              <div />
            )}
            {macAddress &&
            !awaitingUnionsStrict &&
            localBranches.length > 0 &&
            !(Array.isArray(groupedBranches) && groupedBranches.length > 0) &&
            activeKssks &&
            activeKssks.length > 0 ? (
              <div className="flex items-center justify-center gap-4 w-full">
                <div
                  className="flex flex-col items-center leading-tight mt-2 pt-2 w-full max-w-4xl"
                  style={{
                    borderTop: `1px solid ${surfaceBorder}`,
                  }}
                >
                  <div
                    className="text-sm md:text-base uppercase tracking-wide text-center w-full"
                    style={{ color: mutedText }}
                  >
                    Active KSKs
                  </div>
                  <div className="flex flex-wrap gap-2 mt-1 justify-center">
                    {activeKssks.map((id) => (
                      <span
                        key={id}
                        className="inline-flex items-center rounded-lg px-4 py-2 text-lg md:text-xl font-extrabold shadow"
                        style={{
                          background: isDarkMode ? "#2a2a2a" : "#ffffff",
                          color: isDarkMode ? "#f1f5f9" : "#1f2937",
                          border: `1px solid ${isDarkMode ? "#3f3f3f" : "#cbd5f5"}`,
                          boxShadow: isDarkMode
                            ? "0 12px 30px -22px rgba(0,0,0,0.6)"
                            : "0 4px 12px rgba(15,23,42,0.08)",
                        }}
                      >
                        {id}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </header>

      {/* Content with subtle cross-fade */}
      <AnimatePresence mode="wait" initial={false}>
        <m.div
          key={viewKey}
          initial={isLiveViewKey ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={isLiveViewKey ? { opacity: 0 } : { opacity: 0, y: -8 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="w-full"
        >
          {viewKey === "error"
            ? scanningErrorView
            : viewKey === "busy"
              ? busyView
              : viewKey === "ok"
                ? okView
                : viewKey === "scan"
                  ? scanBoxView
                  : groupedView || flatView}
        </m.div>
      </AnimatePresence>

      {/* SR-only live region for status changes */}
      <div className="sr-only" aria-live="polite">
        {isChecking
          ? "Checking in progress"
          : isScanning
            ? "Scanning in progress"
            : "Idle"}
      </div>

      <style>{`
        .hud-shimmer {
          animation: hud-shimmer 1.6s infinite linear;
          background: linear-gradient(
            90deg,
            rgba(59, 130, 246, 0),
            rgba(59, 130, 246, 0.45),
            rgba(59, 130, 246, 0)
          );
          transform: translateX(-80%);
          will-change: transform;
        }
        @keyframes hud-shimmer {
          0% { transform: translateX(-80%); }
          100% { transform: translateX(200%); }
        }
      `}</style>
    </div>
  );
};

export default BranchDashboardMainContent;
