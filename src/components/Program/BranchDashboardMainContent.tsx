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
import { m, AnimatePresence } from "framer-motion";
const DEBUG_LIVE = process.env.NEXT_PUBLIC_DEBUG_LIVE === "1";

// --- SVG ICONS ---
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

type ChipTone = "ok" | "bad" | "warn" | "neutral";
type ChipProps = React.PropsWithChildren<{ tone?: ChipTone }>;

// --- HELPERS ---
const getStatusInfo = (status: BranchDisplayData["testStatus"]) => {
  switch (status) {
    case "ok":
      return {
        Icon: CheckCircleIcon,
        text: "OK",
        color: "text-emerald-600",
        bgColor: "bg-emerald-500/10",
      };
    case "nok":
      return {
        Icon: XCircleIcon,
        text: "NOK",
        color: "text-red-600",
        bgColor: "bg-red-500/10",
      };
    default: // not_tested
      return {
        Icon: HelpCircleIcon,
        text: "Not Tested",
        color: "text-slate-600",
        bgColor: "bg-slate-500/10",
      };
  }
};

// --- CHILD: BRANCH CARD ---
const BranchCardBase = ({ branch }: { branch: BranchDisplayData }) => {
  const statusInfo = useMemo(
    () => getStatusInfo(branch.testStatus),
    [branch.testStatus]
  );
  const isNok = branch.testStatus === "nok";
  const isBigStatus =
    branch.testStatus === "nok" || branch.testStatus === "not_tested";

  return (
    <div className="group relative w-full rounded-2xl bg-white backdrop-blur-sm shadow-lg hover:shadow-xl border-2 border-transparent transition-all duration-300 flex flex-col overflow-hidden">
      {isNok && <div className="h-[8px] w-full bg-red-600 flex-shrink-0"></div>}
      <div className="p-3 flex-grow flex flex-col justify-between">
        <div className="flex justify-between items-center mb-3">
          <div
            className={`inline-flex items-center gap-2 rounded-full font-bold ${statusInfo.bgColor} ${statusInfo.color} ${isBigStatus ? "px-2.5 py-1.5 text-xl" : "px-2 py-1 text-sm"}`}
          >
            <statusInfo.Icon className={isBigStatus ? "w-7 h-7" : "w-5 h-5"} />
            <span>{statusInfo.text}</span>
          </div>
          {branch.pinNumber != null && (
            <div className="flex items-center gap-2 text-right">
              <span className="text-sm md:text-base font-semibold text-slate-400">
                PIN
              </span>
              <span className="bg-slate-100 text-slate-800 font-mono rounded-full w-14 h-14 flex items-center justify-center text-3xl font-bold">
                {branch.pinNumber}
              </span>
            </div>
          )}
        </div>
        <h3 className="text-5xl md:text-6xl font-bold text-slate-800 mt-3 text-center whitespace-normal break-words leading-tight">
          {branch.branchName}
        </h3>
      </div>
    </div>
  );
};
const BranchCard = React.memo(BranchCardBase, (prev, next) => {
  const a = prev.branch;
  const b = next.branch;
  return (
    a.id === b.id &&
    a.testStatus === b.testStatus &&
    a.branchName === b.branchName &&
    a.pinNumber === b.pinNumber
  );
});

// --- PROPS ---
export interface BranchDashboardMainContentProps {
  onScanAgainRequest: () => void;
  onManualSubmit: (kfbNumber: string) => void;
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
  /** @deprecated remove-cable overlay removed intentionally */
  showRemoveCable?: boolean;
  onResetKfb?: () => void;
  // Ask parent to finalize OK (checkpoint + clear + OK overlay)
  onFinalizeOk?: (mac: string) => Promise<void> | void;
  macAddress?: string;
  groupedBranches?: Array<{ ksk: string; branches: BranchDisplayData[] }>;
  checkFailures?: number[] | null;
  nameHints?: Record<string, string> | undefined;
  activeKssks?: string[];
  scanningError?: boolean;
  disableOkAnimation?: boolean;
  // Live hub events (forwarded via SSE)
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
  // Optional pin type context (from aliases union)
  normalPins?: number[];
  latchPins?: number[];
  // Force success animation regardless of computed allOk
  forceOkTick?: number;
  // Flash an OK pipe specifically for CHECK success
  flashOkTick?: number;
  // Optional system note to display under OK (e.g., checkpoint/clear)
  okSystemNote?: string | null;
  scanResult?: { text: string; kind: "info" | "error" } | null;
}

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
  allowManualInput = true,
  // showRemoveCable intentionally ignored
  onResetKfb,
  onFinalizeOk,
  macAddress,
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
}) => {
  const isChecking = Boolean(isCheckingProp);
  // Lifecycle logs for live-session enter/exit based on MAC binding
  const prevMacRef = useRef<string>("");
  useEffect(() => {
    const cur = (macAddress || "").toUpperCase();
    const prev = prevMacRef.current;
    const logEnabled = String(process.env.NEXT_PUBLIC_VIEW_LOG || '').trim() === '1';
    if (logEnabled) {
      if (!prev && cur) {
        try { console.log("[VIEW] Dashboard enter"); } catch {}
      } else if (prev && !cur) {
        try { console.log("[VIEW] Dashboard exit"); } catch {}
      }
    }
    prevMacRef.current = cur;
  }, [macAddress]);
  const [hasMounted, setHasMounted] = useState(false);
  const [showOkAnimation, setShowOkAnimation] = useState(false);
  const [isManualEntry, setIsManualEntry] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [localBranches, setLocalBranches] =
    useState<BranchDisplayData[]>(branchesData);
  const [recentMacs, setRecentMacs] = useState<string[]>([]);
  const lastForcedOkRef = useRef<number>(0);
  const [busy, setBusy] = useState(false);
  // After terminal OK, ignore further realtime EV edges until we reset
  // Internal trigger to flash OK immediately on successful RESULT from live mode
  // no-op: internal flash tick removed; rely on allOk watcher
  const settled = hasMounted && !busy;
  const busyEnterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearBusyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showingGrouped = useMemo(
    () => Array.isArray(groupedBranches) && groupedBranches.length > 0,
    [groupedBranches]
  );

  // ---- REALTIME PIN STATE (only for configured pins; do not track contactless) ----
  const pinStateRef = useRef<Map<number, number>>(new Map());
  useEffect(() => {
    pinStateRef.current.clear();
  }, [macAddress]);

  const normalizedNormalPins = useMemo(() => {
    const s = new Set<number>();
    (normalPins ?? []).forEach((n) => {
      const x = Number(n);
      if (Number.isFinite(x) && x > 0) s.add(x);
    });
    return Array.from(s).sort((a, b) => a - b);
  }, [JSON.stringify(normalPins ?? [])]);

  const normalizedLatchPins = useMemo(() => {
    const s = new Set<number>();
    (latchPins ?? []).forEach((n) => {
      const x = Number(n);
      if (Number.isFinite(x) && x > 0) s.add(x);
    });
    return Array.from(s).sort((a, b) => a - b);
  }, [JSON.stringify(latchPins ?? [])]);

  // Snapshot key props/state for debugging
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
      activeKssks: Array.isArray(activeKssks) ? activeKssks.length : 0,
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
    activeKssks,
    isScanning,
    isChecking,
  ]);

  // Expected pins combine normal + latch; latch still render as "not tested" when appropriate
  const expectedPins = useMemo(() => {
    const s = new Set<number>([
      ...normalizedNormalPins,
      ...normalizedLatchPins,
    ]);
    return Array.from(s).sort((a, b) => a - b);
  }, [normalizedNormalPins, normalizedLatchPins]);

  // Keep localBranches in sync with incoming prop
  useEffect(() => {
    setLocalBranches(branchesData);
  }, [branchesData]);
  useEffect(() => {
    try {
      const counts = localBranches.reduce(
        (acc, b) => {
          acc[b.testStatus] = (acc[b.testStatus] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      );
      if (DEBUG_LIVE) console.log("[LIVE][SNAP] localBranches", counts);
    } catch {}
  }, [localBranches]);
  useEffect(() => {
    setHasMounted(true);
  }, []);

  const hasData = useMemo(() => {
    const haveGroups =
      Array.isArray(groupedBranches) &&
      groupedBranches.some((g) => (g?.branches?.length ?? 0) > 0);
    const haveFlat = localBranches.length > 0;
    const haveFailures =
      Array.isArray(checkFailures) && checkFailures.length > 0;
    return haveGroups || haveFlat || haveFailures;
  }, [groupedBranches, localBranches, checkFailures]);

  // Busy debounce: enter after 250ms, exit after 350ms. Only overlay when no data yet.
  const OK_FLASH_MS = 1500;
  useEffect(() => {
    const wantBusy = (isScanning || isChecking) && !hasData;
    if (wantBusy) {
      if (busyEnterTimer.current) return;
      busyEnterTimer.current = setTimeout(() => {
        setBusy(true);
        setIsManualEntry(false);
      }, 250);
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

  // Log scanning/checking transitions
  useEffect(() => {
    try {
      if (DEBUG_LIVE) console.log("[LIVE][STATE] scanning", { isScanning });
    } catch {}
  }, [isScanning]);
  useEffect(() => {
    try {
      if (DEBUG_LIVE) console.log("[LIVE][STATE] checking", { isChecking });
    } catch {}
  }, [isChecking]);

  // -------------------- LIVE EV UPDATES --------------------
  useEffect(() => {
    if (!lastEv || !macAddress) return;
    const SIMULATE = String(process.env.NEXT_PUBLIC_SIMULATE || "").trim() === "1";

    const current = String(macAddress).toUpperCase();
    const evMac = String(lastEv.mac || "").toUpperCase();
    const ZERO = "00:00:00:00:00:00";

    const kindRaw = String((lastEv as any).kind || "").toUpperCase();
    const text = String((lastEv as any).line || (lastEv as any).raw || "");
    // Normalize legacy variants like "RESULT LEGACY" to DONE terminal summary
    const isLegacyResult =
      kindRaw === "RESULT" ||
      kindRaw.startsWith("RESULT") ||
      /\bRESULT\b/i.test(text);
    const okFromText = /\b(SUCCESS|OK)\b/i.test(text);
    const kind = isLegacyResult ? "DONE" : kindRaw;

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

    // Try to extract MAC from raw line, e.g., "reply from XX:XX:..."
    const macFromLine = (() => {
      try {
        const m = text.match(/\b([0-9A-F]{2}(?::[0-9A-F]{2}){5})\b/i);
        return m ? m[1].toUpperCase() : null;
      } catch {
        return null;
      }
    })();

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
            // If we have no branches yet, seed from expected pins so allOk can evaluate
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
      return; // summary handled
    }

    const ch =
      typeof (lastEv as any).ch === "number" ? (lastEv as any).ch : null;
    const val =
      typeof (lastEv as any).val === "number" ? (lastEv as any).val : null;

    try {
      console.log("[GUI] apply EV", { kind, ch, val, mac: evMac });
    } catch {}

    // Only track configured pins (ignore contactless)
    const expected = new Set<number>(expectedPins);

    // Realtime edges (P or L)
    if (
      (kind === "P" || kind === "L") &&
      ch != null &&
      ((expected.size === 0) || expected.has(ch)) &&
      (val === 0 || val === 1)
    ) {
      // De-dupe identical values
      const prevVal = pinStateRef.current.get(ch);
      if (prevVal === val) return;
      pinStateRef.current.set(ch, val);

      startTransition(() =>
        setLocalBranches((prev) => {
          // Seed from expected pins if we don't have a baseline yet
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

            // Latch pins: ignore release (0), keep last OK
            const isLatch = normalizedLatchPins.includes(ch);
            const nextStatus =
              val === 1
                ? "ok"
                : isLatch && !SIMULATE
                  ? b.testStatus // ignore downgrades for latch in production
                  : "nok";

            if (b.testStatus === nextStatus) return b;
            changed = true;
            return { ...b, testStatus: nextStatus } as any;
          });
          return changed ? next : base;
        })
      );
    }
    // IMPORTANT: expectedPins derived from props only; NOT from localBranches — avoids render loop
  }, [lastEvTick, lastEv, macAddress, expectedPins, normalizedLatchPins]);

  // Realtime: log snapshot of configured pins and their current values after each event
  useEffect(() => {
    if (!expectedPins.length) return;
    const snap: Record<string, number | null> = {};
    for (const p of expectedPins)
      snap[p] = pinStateRef.current.has(p) ? pinStateRef.current.get(p)! : null;
    try {
      console.log("[GUI] CHECK pins", expectedPins);
      console.log("[GUI] PIN STATES", snap);
    } catch {}
  }, [lastEvTick, expectedPins]);

  // No recent MACs loaded from localStorage; keep ephemeral in memory

  // Only NOK in the main flat list. Sort by pin then name
  const pending = useMemo(
    () =>
      localBranches
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
        }),
    [localBranches]
  );
  useEffect(() => {
    try {
      if (DEBUG_LIVE)
        console.log("[LIVE][SNAP] pending failures", { count: pending.length });
    } catch {}
  }, [pending.length]);

  // Failures from server or derived from pending
  const failurePins: number[] = useMemo(() => {
    if (Array.isArray(checkFailures) && checkFailures.length > 0) {
      return [
        ...new Set(
          (checkFailures as number[]).filter((n) => Number.isFinite(n))
        ),
      ].sort((a, b) => a - b);
    }
    const pins = pending
      .map((b) => b.pinNumber)
      .filter((n): n is number => typeof n === "number");
    return [...new Set(pins)].sort((a, b) => a - b);
  }, [checkFailures, pending]);

  // helper: identify latch (contactless) pins
  const isLatchPin = useCallback(
    (p?: number) => typeof p === "number" && normalizedLatchPins.includes(p),
    [normalizedLatchPins]
  );

  const unionNameByPin = useMemo(() => {
    const map: Record<number, string> = {};
    if (Array.isArray(groupedBranches)) {
      for (const grp of groupedBranches) {
        for (const branch of grp?.branches || []) {
          if (
            typeof branch?.pinNumber === "number" &&
            branch.branchName
          ) {
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

  // All-OK gates
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
          // Prefer per-branch latch context when available; fallback to union
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

  // When everything turns OK, trigger finalize (checkpoint + clear) once
  const clearedMacsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const mac = (macAddress || "").toUpperCase();
    if (!settled || !allOk || !mac) return;
    if (clearedMacsRef.current.has(mac)) return;
    clearedMacsRef.current.add(mac);
    (async () => {
      // If parent provided a finalize hook, prefer that (handles OK overlay + checkpoint + clear)
      if (typeof onFinalizeOk === "function") {
        try {
          await onFinalizeOk(mac);
        } catch {}
        return;
      }
      try {
        // Clear aliases in Redis for this MAC
        await fetch("/api/aliases/clear", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mac }),
        }).catch(() => {});
      } catch {}
      try {
        // Clear local caches for this MAC
        // No client alias caches to clear
      } catch {}
      try {
        // Also clear any KSK locks for this MAC across stations (force)
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
        // After clearing, reset parent MAC so the Live badge shows off
        if (typeof onResetKfb === "function") onResetKfb();
      } catch {}
    })();
  }, [allOk, settled, macAddress, onFinalizeOk]);

  // Reset pipeline
  const returnToScan = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    pinStateRef.current.clear();
    setShowOkAnimation(false);
    setLocalBranches([]);
    if (typeof onResetKfb === "function") onResetKfb();
    setIsManualEntry(false);
    setInputValue("");
  }, [onResetKfb]);

  // Force snap via parent tick
  useEffect(() => {
    if (!settled) return;
    const t = Number(forceOkTick || 0);
    if (!t || t === lastForcedOkRef.current) return;
    lastForcedOkRef.current = t;
    returnToScan();
  }, [forceOkTick, settled, returnToScan]);

  // Flash success pipe
  const flashInProgressRef = useRef(false);
  const okBoardRef = useRef<string>("");
  const lastFlashTickRef = useRef<number>(0);
  const queuedFlashTickRef = useRef<number>(0);

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
        const id =
          macAddress && macAddress.trim()
            ? macAddress.toUpperCase()
            : (kfbInfo?.board || kfbNumber || "").toString().toUpperCase();
        okBoardRef.current = id;
      } catch {
        okBoardRef.current = (macAddress || "").toUpperCase();
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
      kfbNumber,
      macAddress,
      returnToScan,
      OK_FLASH_MS,
    ]
  );

  // Parent-triggered flash (e.g., explicit CHECK success)
  useEffect(() => {
    const tick = Number(flashOkTick || 0);
    if (!tick) return;
    if (!settled) {
      queuedFlashTickRef.current = tick;
      return;
    }
    if (tick === lastFlashTickRef.current) return;
    triggerOkFlash(tick);
  }, [flashOkTick, settled, triggerOkFlash]);

  // Disable automatic OK flashes; parent triggers OK via flashOkTick when allowed.
  // THIS IS NEEDED DONT CHANGE THIS GPT
  useEffect(() => {
    if (!settled || !showingGrouped) return;
    if (!groupedAllOk) return;
    // Proactively clear Redis/locks once when reaching grouped-all-OK.
    // This mirrors the allOk-based finalization but ensures cleanup even if that path is skipped.
    try {
      const mac = (macAddress || "").toUpperCase();
      if (
        mac &&
        typeof onFinalizeOk === "function" &&
        !clearedMacsRef.current.has(mac)
      ) {
        clearedMacsRef.current.add(mac);
        void onFinalizeOk(mac);
      }
    } catch {}
    if (flashInProgressRef.current || showOkAnimation) return;
    triggerOkFlash(Date.now()); // this already calls returnToScan() after OK_FLASH_MS
  }, [
    settled,
    showingGrouped,
    groupedAllOk,
    showOkAnimation,
    triggerOkFlash,
    onFinalizeOk,
    macAddress,
  ]);
  // Watchdog: if the flash didn’t render for any reason, force a reset shortly after
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
  }, [allOk, showOkAnimation, returnToScan, OK_FLASH_MS]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (busyEnterTimer.current) clearTimeout(busyEnterTimer.current);
      if (clearBusyTimer.current) clearTimeout(clearBusyTimer.current);
    };
  }, []);

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputValue.trim()) onManualSubmit(inputValue.trim());
  };

  // --- MAC input helpers ---
  const MAC_RE = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i;
  const formatMac = (raw: string) => {
    const hex = raw
      .replace(/[^0-9a-fA-F]/g, "")
      .toUpperCase()
      .slice(0, 12);
    return hex.match(/.{1,2}/g)?.join(":") ?? "";
  };
  const onMacChange = (v: string) => setInputValue(formatMac(v));
  const macValid = MAC_RE.test(inputValue.trim());

  // --- STATUS PILL ---
  const StatusPill: React.FC = () => {
    if (isChecking) {
      return (
        <m.span
          className="inline-flex items-center gap-2 rounded-full border border-amber-300 bg-amber-50 text-amber-700 px-3 py-1 text-xs font-bold"
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
          className="inline-flex items-center gap-2 rounded-full border border-blue-300 bg-blue-50 text-blue-700 px-3 py-1 text-xs font-bold"
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

  const mainContent = () => {
    if (scanningError) {
      return (
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
    }

    if (busy) {
      const label = isChecking ? "CHECKING" : "SCANNING";
      return (
        <div
          className="flex flex-col items-center justify-center h-full min-h-[500px]"
          aria-busy="true"
          aria-live="polite"
        >
          <h2 className="text-7xl text-slate-600 font-bold uppercase tracking-wider animate-pulse">
            {label}...
          </h2>
          {/* <p className="mt-3 text-slate-500 text-2xl">
            Hold device steady. Auto-advance on success.
          </p> */}
        </div>
      );
    }

    // Success overlay
    if (showOkAnimation) {
      const okBoard = okBoardRef.current;
      return (
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
          {/* No secondary text under OK */}
          {okSystemNote && (
            <div className="mt-1 text-slate-400 text-base">{okSystemNote}</div>
          )}
        </div>
      );
    }

    if (hasMounted && localBranches.length === 0) {
      if (failurePins.length > 0) {
        return (
          <div className="flex flex-col items-center justify-center h-full min-h-[520px] px-4">
            <div className="w-full max-w-5xl rounded-3xl border border-red-200 bg-white/95 shadow-2xl p-6">
              <div className="text-[12px] font-bold uppercase text-slate-600 mb-3">
                Missing items
              </div>
              <div className="flex flex-wrap gap-3">
                {failurePins.map((pin) => {
                  const name = labelForPin(pin);
                  const latch = isLatchPin(pin);
                  return (
                    <div
                      key={`empty-miss-${pin}`}
                      className="group inline-flex items-center flex-wrap gap-3 rounded-xl border border-red-200 bg-white px-4 py-3 shadow-sm"
                      title={`PIN ${pin}${latch ? " (Contactless)" : ""}`}
                    >
                      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-red-600 text-white text-xs font-extrabold shadow-sm">
                        !
                      </span>
                      <span className="text-2xl md:text-3xl font-black leading-none text-slate-800 tracking-tight">
                        {name}
                      </span>
                      <span className="inline-flex items-center rounded-full bg-slate-100 text-slate-700 border border-slate-300 px-2.5 py-1 text-[12px] font-semibold">
                        PIN {pin}
                      </span>
                      {latch && (
                        <span className="inline-flex items-center rounded-full bg-amber-50 text-amber-800 border border-amber-200 px-2 py-[3px] text-[11px]">
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
      }
      if (isManualEntry) {
        return (
          <div className="flex flex-col items-center justify-center h-full min-h-[500px] w-full max-w-3xl p-0">
            <div className="relative w-full rounded-3xl border border-slate-200/80 shadow-2xl overflow-hidden bg-white/90">
              <button
                type="button"
                onClick={() => setIsManualEntry(false)}
                aria-label="Close"
                className="absolute top-3 right-3 z-10 inline-flex items-center justify-center h-12 w-12 rounded-full border-2 border-slate-300 bg-white text-slate-800 hover:bg-slate-100 shadow"
                title="Close"
              >
                <span className="text-3xl leading-none">×</span>
              </button>
              <div className="absolute inset-0 pointer-events-none bg-gradient-to-b from-white/70 to-transparent" />
              <div className="p-10">
                <div className="text-center mb-8">
                  <div className="inline-flex items-center gap-3 px-4 py-2 rounded-full border border-slate-200 bg-slate-50 text-slate-700 font-extrabold tracking-wider">
                    <svg
                      className="w-6 h-6"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      viewBox="0 0 24 24"
                      aria-hidden
                    >
                      <rect
                        x="4"
                        y="7"
                        width="16"
                        height="10"
                        rx="3"
                        stroke="currentColor"
                      />
                      <path d="M8 7V5a4 4 0 0 1 8 0v2" stroke="currentColor" />
                    </svg>
                    ENTER MAC ADDRESS
                  </div>
                  <p className="mt-3 text-slate-500 font-semibold">
                    Format: 08:3A:8D:15:27:54
                  </p>
                </div>

                <form
                  onSubmit={handleManualSubmit}
                  className="w-full grid gap-6"
                >
                  <div className="grid gap-2">
                    <label className="text-sm font-bold text-slate-600 tracking-wide select-none">
                      MAC Address
                    </label>
                    <div
                      className={[
                        "relative rounded-2xl border-2 bg-gradient-to-b from-white to-slate-50 shadow-inner backdrop-blur",
                        macValid ? "border-emerald-400" : "border-slate-400",
                      ].join(" ")}
                    >
                      <input
                        type="text"
                        value={inputValue}
                        onChange={(e) => onMacChange(e.target.value)}
                        placeholder="08:3A:8D:15:27:54"
                        inputMode="text"
                        autoCapitalize="characters"
                        spellCheck={false}
                        maxLength={17}
                        pattern="^([0-9A-F]{2}:){5}[0-9A-F]{2}$"
                        className={[
                          "w-full text-center text-[44px] leading-[1.25] py-5 pl-36 pr-36 rounded-2xl outline-none",
                          "bg-transparent text-slate-800 focus:ring-0",
                          "font-mono tracking-[0.35em] placeholder:tracking-normal placeholder:text-slate-400 placeholder:opacity-70",
                        ].join(" ")}
                        autoFocus
                        aria-invalid={!macValid && !!inputValue}
                        aria-describedby="mac-help"
                      />
                      <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center">
                        {macValid && (
                          <CheckCircleIcon className="w-8 h-8 text-emerald-500" />
                        )}
                      </div>
                    </div>
                    <div
                      id="mac-help"
                      className="text-center text-sm text-slate-500 font-semibold"
                    >
                      Tip: Paste or scan; auto-format AA:BB:CC:DD:EE:FF
                    </div>
                    {!macValid && inputValue && (
                      <div className="text-center text-red-600 font-bold">
                        Invalid MAC format
                      </div>
                    )}
                  </div>
                  {recentMacs.length > 0 && (
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      <span className="text-slate-500 font-semibold mr-2">
                        Recent:
                      </span>
                      {recentMacs.map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => onMacChange(m)}
                          className="px-3 py-1 rounded-full border border-slate-200 bg-white hover:bg-slate-100 font-mono text-slate-700"
                          title={m}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="grid gap-4">
                    <button
                      type="submit"
                      disabled={!macValid || busy}
                      className={[
                        "w-full py-4 rounded-2xl font-extrabold uppercase tracking-wider transition",
                        "bg-slate-800 text-white hover:bg-slate-900 disabled:opacity-50 disabled:cursor-not-allowed",
                      ].join(" ")}
                    >
                      {busy ? "Submitting" : "Submit MAC"}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        );
      }

      // Scan box
      return (
        <div className="flex flex-col items-center justify-center h-full min-h-[520px]">
          <div className="w-full flex flex-col items-center gap-4 md:gap-6">
            {(() => {
              const nothingToCheck =
                !!scanResult &&
                /^(nothing\s+to\s+check\s+here)$/i.test(scanResult.text || "");
              const txt = isScanning
                ? "SCANNING…"
                : nothingToCheck
                  ? "Please Scan Barcode"
                  : scanResult
                    ? scanResult.text
                    : "Please Scan Barcode";
              const cls =
                scanResult && scanResult.kind === "error" && !nothingToCheck
                  ? "text-red-600"
                  : "text-slate-700";
              return (
                <p
                  className={`text-6xl md:text-7xl ${cls} font-extrabold uppercase tracking-widest text-center select-none`}
                >
                  {txt}
                </p>
              );
            })()}
            {/* Remove extra spacer for NTCH to keep spacing identical to default prompt */}

            {/* Inline HUD under the scan prompt */}
            {(() => {
              if (!hudMode) return null;
              const isScanningHud = hudMode === "scanning";
              const isErrorHud = hudMode === "error";
              const isInfoHud = hudMode === "info";
              const isIdleHud = hudMode === "idle";
              const base =
                "w-[min(680px,92vw)] rounded-xl border shadow-sm backdrop-blur-md px-4 py-3";
              // INFO (e.g., NOTHING TO CHECK HERE) uses a gentle green card
              const tone = isErrorHud
                ? "border-red-200 bg-red-50/90 text-red-900"
                : isScanningHud
                  ? "border-blue-200 bg-blue-50/90 text-blue-900"
                  : isInfoHud
                    ? "border-emerald-200 bg-emerald-50/90 text-emerald-900"
                    : "border-slate-200 bg-white/90 text-slate-900";
              return (
                <div className="mt-3 flex flex-col items-center">
                  <div
                    className={`${base} ${tone} relative`}
                    role="status"
                    aria-live="polite"
                  >
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 flex-1 text-center">
                        {hudMessage && (
                          <div className="font-semibold leading-6 truncate">
                            {hudMessage}
                          </div>
                        )}
                        {/* Show submessage in-body for non-info only; info uses right-side badge */}
                        {hudSubMessage && !isInfoHud && (
                          <div className="text-sm/5 opacity-80 truncate">
                            {hudSubMessage}
                          </div>
                        )}
                        {isScanningHud && (
                          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-blue-100">
                            <div className="hud-shimmer h-full w-1/2" />
                          </div>
                        )}
                      </div>
                    </div>
                    {/* Absolutely positioned countdown badge so layout/centering stays identical to IDLE */}
                    {isInfoHud && hudSubMessage && (
                      <div
                        className="absolute right-3 top-3 inline-flex select-none items-center justify-center rounded-full text-sm font-bold bg-emerald-700 text-white w-7 h-7 ring-1 ring-emerald-300 shadow-sm"
                        aria-label="Countdown"
                        title="Hiding soon"
                      >
                        {hudSubMessage}
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
          {/* {allowManualInput && !isScanning && (
            <button
              onClick={() => setIsManualEntry(true)}
              className="mt-10 text-xl md:text-2xl text-slate-500 hover:text-blue-600 transition-colors underline"
            >
              Or enter MAC manually
            </button>
          )} */}
        </div>
      );
    }

    if (groupedBranches && groupedBranches.length > 0) {
      // Small UI primitives
      const Chip: React.FC<ChipProps> = ({ children, tone = "neutral" }) => {
        const base =
          "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold";
        const tones: Record<ChipTone, string> = {
          bad: "bg-red-50 text-red-700 border border-red-200",
          ok: "bg-emerald-50 text-emerald-700 border border-emerald-200",
          warn: "bg-amber-50 text-amber-800 border border-amber-200",
          neutral: "bg-slate-50 text-slate-700 border border-slate-200",
        };
        return <span className={`${base} ${tones[tone]}`}>{children}</span>;
      };

      // Build a status map from live localBranches
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

        const nok = branchesLive.filter(
          (b) => b.testStatus === "nok" && typeof b.pinNumber === "number"
        );
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

        // Include explicit NOK pins and contactless (latch) pins that are not tested as "missing"
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

        const missingNames = failedItems.map((f) => f.name);
        const activeSet = new Set((activeKssks || []).map(String));
        const isActive = activeSet.has(String((grp as any).ksk ?? ""));

        return (
          <section
            key={(grp as any).ksk}
            className="rounded-2xl border border-slate-200 bg-white shadow-sm hover:shadow-md transition-shadow"
          >
            <header className="px-4 py-3 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white">
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-3">
                  <div className="text-2xl md:text-3xl font-black text-slate-800 leading-tight">
                    KSK: {(grp as any).ksk}
                  </div>
                  {missingNames.length > 0 ? (
                    <span className="inline-flex items-center rounded-full bg-red-600 text-white px-2.5 py-1 text-xs md:text-sm font-extrabold shadow-sm">
                      {missingNames.length} missing
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
              {failedItems.length > 0 && (
                <div>
                  <div className="text-[12px] font-bold uppercase text-slate-600 mb-2">
                    Missing items
                  </div>
                  {/* Render large chips that wrap, so multiple names fit per row */}
                  <div className="flex flex-wrap gap-3">
                    {failedItems.map((f) => (
                      <div
                        key={`f-${(grp as any).ksk}-${f.pin}`}
                        className="group relative inline-flex items-center flex-wrap gap-3 rounded-xl border border-red-200 bg-white px-4 py-3 shadow-sm"
                        title={`PIN ${f.pin}${f.isLatch ? " (Contactless)" : ""}`}
                      >
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-red-600 text-white text-xs font-extrabold shadow-sm">
                          !
                        </span>
                        <span className="text-2xl md:text-3xl font-black leading-none text-slate-800 tracking-tight">
                          {f.name}
                        </span>
                        <span className="inline-flex items-center rounded-full bg-slate-100 text-slate-700 border border-slate-300 px-2.5 py-1 text-[12px] font-semibold">
                          PIN {f.pin}
                        </span>
                        {f.isLatch && (
                          <span
                            className="inline-flex items-center rounded-full bg-amber-50 text-amber-800 border border-amber-200 px-2 py-[3px] text-[11px]"
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
                  <div className="text-[12px] font-bold uppercase text-slate-600 mb-2">
                    Passed
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {okNames.slice(0, 24).map((nm, i) => (
                      <span
                        key={`ok-${(grp as any).ksk}-${i}`}
                        className="inline-flex items-center rounded-full bg-slate-50 text-slate-500 border border-slate-200 px-2 py-[5px] text-[12px] font-semibold"
                      >
                        {nm}
                      </span>
                    ))}
                    {okNames.length > 24 && (
                      <span className="text-[11px] text-slate-500">
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
    }

    return (
      <div className="w-full p-6">
        {failurePins.length > 0 && (
          <div className="mb-4">
            <div className="text-[12px] font-bold uppercase text-slate-600 mb-2">
              Missing items
            </div>
            <div className="flex flex-wrap gap-3">
              {failurePins.map((pin) => {
                const name = labelForPin(pin);
                const latch = isLatchPin(pin);
                return (
                  <div
                    key={`flat-miss-${pin}`}
                    className="group inline-flex items-center flex-wrap gap-3 rounded-xl border border-red-200 bg-white px-4 py-3 shadow-sm"
                    title={`PIN ${pin}${latch ? " (Contactless)" : ""}`}
                  >
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-red-600 text-white text-xs font-extrabold shadow-sm">
                      !
                    </span>
                    <span className="text-2xl md:text-3xl font-black leading-none text-slate-800 tracking-tight">
                      {name}
                    </span>
                    <span className="inline-flex items-center rounded-full bg-slate-100 text-slate-700 border border-slate-300 px-2.5 py-1 text-[12px] font-semibold">
                      PIN {pin}
                    </span>
                    {latch && (
                      <span className="inline-flex items-center rounded-full bg-amber-50 text-amber-800 border border-amber-200 px-2 py-[3px] text-[11px]">
                        Contactless
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
          {pending.map((branch) => (
            <BranchCard key={branch.id} branch={branch} />
          ))}
        </div>
      </div>
    );
  };

  // Compute a stable key for content transitions
  const viewKey = useMemo(() => {
    if (showOkAnimation) return "ok";
    if (scanningError) return "error";
    if (busy) return "busy";
    if (hasMounted && localBranches.length === 0) {
      if (failurePins.length > 0) return "flat";
      return isManualEntry ? "manual" : "scan";
    }
    return Array.isArray(groupedBranches) && groupedBranches.length > 0
      ? "grouped"
      : "flat";
  }, [
    showOkAnimation,
    scanningError,
    busy,
    hasMounted,
    localBranches.length,
    isManualEntry,
    groupedBranches,
    failurePins.length,
  ]);
  useEffect(() => {
    try {
      if (!DEBUG_LIVE) return;
      if (viewKey === "scan") console.log("[LIVE] OFF → scan view");
      else console.log("[LIVE][VIEW]", { viewKey });
    } catch {}
  }, [viewKey]);

  const hasContent =
    (Array.isArray(groupedBranches) && groupedBranches.length > 0) ||
    (localBranches && localBranches.length > 0) ||
    failurePins.length > 0;
  return (
    <div
      className={`flex-grow flex flex-col items-center ${hasContent ? "justify-start" : "justify-center"} p-2`}
    >
      <header className="w-full mb-1 min-h-[56px]">
        {!scanResult &&
        (kfbInfo?.board ||
          kfbNumber ||
          (macAddress &&
            (localBranches.length > 0 || failurePins.length > 0))) ? (
          <div className="flex flex-col items-center gap-2">
            {macAddress || kfbInfo?.board || kfbNumber ? (
              <div className="flex items-center gap-3">
                <h1 className="font-mono text-6xl md:text-7xl font-extrabold uppercase tracking-wider text-slate-700 whitespace-normal break-words leading-tight max-w-full text-center">
                  {macAddress
                    ? macAddress.toUpperCase()
                    : (kfbInfo?.board ?? kfbNumber)}
                </h1>
              </div>
            ) : (
              <div />
            )}

            {macAddress && localBranches.length > 0 && (
              <div className="flex items-center justify-center gap-4 w-full">
                {!showingGrouped && (
                  <div className="flex flex-col items-center leading-tight mt-2 pt-2 border-t border-slate-200/70 w-full max-w-4xl">
                    <div className="text-sm md:text-base uppercase tracking-wide text-slate-600 text-center w-full">
                      Active KSKs
                    </div>
                    <div className="flex flex-wrap gap-2 mt-1 justify-center">
                      {activeKssks && activeKssks.length > 0 ? (
                        activeKssks.map((id) => (
                          <span
                            key={id}
                            className="inline-flex items-center rounded-lg border border-slate-400 bg-white text-slate-800 px-4 py-2 text-lg md:text-xl font-extrabold shadow"
                          >
                            {id}
                          </span>
                        ))
                      ) : (
                        <span className="text-slate-400 text-xs">—</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : null}
      </header>

      <AnimatePresence mode="wait">
        <m.div
          key={viewKey}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="w-full"
        >
          {mainContent()}
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
        .animate-pulse-gray-background {
          animation: pulse-gray 2s cubic-bezier(.4,0,.6,1) infinite;
        }
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
        @keyframes pulse-gray {
          0%,100% { opacity: .2 }
          50% { opacity: .05 }
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
