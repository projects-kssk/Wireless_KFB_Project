// src/components/Program/BranchDashboardMainContent.tsx
import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  startTransition,
} from 'react';
import { BranchDisplayData, KfbInfo } from '@/types/types';
import { m, AnimatePresence } from 'framer-motion';

// --- SVG ICONS ---
const CheckCircleIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" {...props}>
    <path
      fillRule="evenodd"
      d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z"
      clipRule="evenodd"
    />
  </svg>
);

const XCircleIcon = ({ className = "w-5 h-5" }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="12" cy="12" r="10"></circle>
    <line x1="15" y1="9" x2="9" y2="15"></line>
    <line x1="9" y1="9" x2="15" y2="15"></line>
  </svg>
);

const ClockIcon = ({ className = "w-5 h-5" }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="12" cy="12" r="10"></circle>
    <polyline points="12 6 12 12 16 14"></polyline>
  </svg>
);

const HelpCircleIcon = ({ className = "w-5 h-5" }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="12" cy="12" r="10"></circle>
    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
    <line x1="12" y1="17" x2="12.01" y2="17"></line>
  </svg>
);

// Removed decorative barcode SVG icon per request

// --- HELPERS ---
type ChipTone = 'ok' | 'bad' | 'warn' | 'neutral';
type ChipProps = React.PropsWithChildren<{ tone?: ChipTone }>;

const getStatusInfo = (status: BranchDisplayData['testStatus']) => {
  switch (status) {
    case 'ok':
      return { Icon: CheckCircleIcon, text: 'OK', color: 'text-emerald-600', bgColor: 'bg-emerald-500/10' };
    case 'nok':
      return { Icon: XCircleIcon, text: 'NOK', color: 'text-red-600', bgColor: 'bg-red-500/10' };
    default:
      return { Icon: HelpCircleIcon, text: 'Not Tested', color: 'text-slate-600', bgColor: 'bg-slate-500/10' };
  }
};

// --- CHILD: BRANCH CARD ---
const BranchCardBase = ({ branch }: { branch: BranchDisplayData }) => {
  const statusInfo = useMemo(() => getStatusInfo(branch.testStatus), [branch.testStatus]);
  const isNok = branch.testStatus === 'nok';
  const isBigStatus = branch.testStatus === 'nok' || branch.testStatus === 'not_tested';

  return (
    <div className="group relative w-full rounded-2xl bg-white backdrop-blur-sm shadow-lg hover:shadow-xl border-2 border-transparent transition-all duration-300 flex flex-col overflow-hidden">
      {isNok && <div className="h-[8px] w-full bg-red-600 flex-shrink-0"></div>}
      <div className="p-3 flex-grow flex flex-col justify-between">
        <div className="flex justify-between items-center mb-3">
          <div className={`inline-flex items-center gap-2 rounded-full font-bold ${statusInfo.bgColor} ${statusInfo.color} ${isBigStatus ? 'px-2.5 py-1.5 text-xl' : 'px-2 py-1 text-sm'}`}>
            <statusInfo.Icon className={isBigStatus ? "w-7 h-7" : "w-5 h-5"} />
            <span>{statusInfo.text}</span>
          </div>
          {branch.pinNumber != null && (
            <div className="flex items-center gap-2 text-right">
              <span className="text-sm md:text-base font-semibold text-slate-400">PIN</span>
              <span className="bg-slate-100 text-slate-800 font-mono rounded-full w-14 h-14 flex items-center justify-center text-3xl font-bold">
                {branch.pinNumber}
              </span>
            </div>
          )}
        </div>
        <h3 className="text-5xl md:text-6xl font-bold text-slate-800 group-hover:text-blue-600 transition-colors duration-300 mt-3 text-center whitespace-normal break-words leading-tight">
          {branch.branchName}
        </h3>
      </div>
    </div>
  );
};

const BranchCard = React.memo(
  BranchCardBase,
  (prev, next) => {
    const a = prev.branch; const b = next.branch;
    return a.id === b.id && a.testStatus === b.testStatus && a.branchName === b.branchName && a.pinNumber === b.pinNumber;
  }
);

// --- PROPS ---
export interface BranchDashboardMainContentProps {
  onScanAgainRequest: () => void;
  onManualSubmit: (kfbNumber: string) => void;
  appHeaderHeight: string;
  branchesData: BranchDisplayData[];
  isScanning: boolean;
  kfbNumber: string;
  kfbInfo: KfbInfo | null;
  allowManualInput?: boolean;
  /** @deprecated remove-cable overlay removed intentionally */
  showRemoveCable?: boolean;
  onResetKfb?: () => void;
  macAddress?: string;
  groupedBranches?: Array<{ kssk: string; branches: BranchDisplayData[] }>;
  checkFailures?: number[] | null;
  nameHints?: Record<string, string> | undefined;
  activeKssks?: string[];
  scanningError?: boolean;
  disableOkAnimation?: boolean;
  // Live hub events (forwarded via SSE)
  lastEv?: { kind?: string; ch?: number | null; val?: number | null; ok?: boolean; mac?: string | null; raw?: string; line?: string; ts?: number } | null;
  lastEvTick?: number;
  // Optional pin type context (from aliases union)
  normalPins?: number[];
  latchPins?: number[];
  // Force success animation regardless of computed allOk
  forceOkTick?: number;
  // Flash an OK pipe specifically for CHECK success
  flashOkTick?: number;
}

const BranchDashboardMainContent: React.FC<BranchDashboardMainContentProps> = ({
  appHeaderHeight,
  onScanAgainRequest,
  onManualSubmit,
  branchesData,
  isScanning,
  kfbNumber,
  kfbInfo,
  allowManualInput = true,
  // showRemoveCable intentionally ignored
  onResetKfb,
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
}) => {
  // --- Refs and core state
  const [hasMounted, setHasMounted] = useState(false);
  const [showOkAnimation, setShowOkAnimation] = useState(false);
  const [isManualEntry, setIsManualEntry] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [localBranches, setLocalBranches] = useState<BranchDisplayData[]>(branchesData);
  const [recentMacs, setRecentMacs] = useState<string[]>([]);
  const lastForcedOkRef = useRef<number>(0);
  const [busy, setBusy] = useState(false);
  const settled = hasMounted && !busy;
  const initialPaintRef = useRef(true);
  const prevAllOkRef = useRef(false);
  const busyEnterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearBusyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Flash management refs (declare before any effect that reads them)
  const flashInProgressRef = useRef(false);
  const okBoardRef = useRef<string>("");
  const lastFlashTickRef = useRef(0);

  // --- Lifecycles
  useEffect(() => { setLocalBranches(branchesData); }, [branchesData]);
  useEffect(() => { setHasMounted(true); }, []);
  useEffect(() => { initialPaintRef.current = false; }, []);

  // --- Data presence
  const hasData = useMemo(() => {
    if (Array.isArray(groupedBranches) && groupedBranches.some(g => (g?.branches?.length ?? 0) > 0)) return true;
    return localBranches.length > 0;
  }, [groupedBranches, localBranches]);

  // --- Busy debounce: enter after 250ms, exit after 350ms. Overlay only when no content yet.
  useEffect(() => {
    const wantBusy = (isScanning || isChecking) && !hasData;
    if (wantBusy) {
      if (!busyEnterTimer.current) {
        busyEnterTimer.current = setTimeout(() => {
          setBusy(true);
          setIsManualEntry(false);
        }, 250);
      }
    } else {
      if (busyEnterTimer.current) { clearTimeout(busyEnterTimer.current); busyEnterTimer.current = null; }
      if (clearBusyTimer.current) clearTimeout(clearBusyTimer.current);
      clearBusyTimer.current = setTimeout(() => setBusy(false), 350);
    }
    return () => {
      if (busyEnterTimer.current) { clearTimeout(busyEnterTimer.current); busyEnterTimer.current = null; }
      if (clearBusyTimer.current) { clearTimeout(clearBusyTimer.current); clearBusyTimer.current = null; }
    };
  }, [isScanning, isChecking, hasData]);

  // --- Live hub events
  useEffect(() => {
    if (!lastEv || !macAddress) return;

    const current = String(macAddress).toUpperCase();
    const evMac = String(lastEv.mac || '').toUpperCase();
    const ZERO = '00:00:00:00:00:00';

    const kindRaw = String(lastEv.kind || '').toUpperCase();
    const text = String(lastEv.line || lastEv.raw || '');
    const isLegacyResult = kindRaw === 'RESULT' || /\bRESULT\b/i.test(text);
    const okFromText = /\b(SUCCESS|OK)\b/i.test(text);
    const kind = isLegacyResult ? 'DONE' : kindRaw;

    // Parse failure pins robustly from free-form strings
    const parseFailures = (s: string): number[] => {
      const out = new Set<number>();
      const cleaned = s
        .replace(/\b([0-9A-F]{2}(?::[0-9A-F]{2}){5})\b/gi, '') // strip MACs
        .replace(/\[|\]|\(|\)/g, ' ');
      const patterns = [
        /MISSING\s*:?\s*([0-9,\s]+)/i,
        /FAILURES?\s*:?\s*([0-9,\s]+)/i,
        /FAILED\s+PINS?\s*:?\s*([0-9,\s]+)/i,
        /OPEN\s+PINS?\s*:?\s*([0-9,\s]+)/i,
        /BAD\s+PINS?\s*:?\s*([0-9,\s]+)/i,
        /\bPINS?\s*:?\s*([0-9,\s]+)/i,
      ];
      let captured: string | null = null;
      for (const rx of patterns) {
        const m = cleaned.match(rx);
        if (m?.[1]) { captured = m[1]; break; }
      }
      const add = (n: unknown) => {
        const x = Number(n);
        if (Number.isFinite(x) && x > 0) out.add(x);
      };
      const source = captured ?? (cleaned.match(/\b\d{1,4}\b/g)?.join(' ') || '');
      source.split(/[\s,]+/).forEach(add);
      return Array.from(out).sort((a, b) => a - b);
    };

    if (kind === 'DONE') {
      const matchMac = !evMac || evMac === ZERO || evMac === current;
      if (!matchMac) return;
      const okFlag = lastEv.ok === true || okFromText;
      if (okFlag) {
        setLocalBranches(prev =>
          prev.map(b => (typeof b.pinNumber === 'number' ? { ...b, testStatus: 'ok' } : b))
        );
      } else {
        const fails = parseFailures(text);
        if (fails.length) {
          const failSet = new Set<number>(fails);
          setLocalBranches(prev => prev.map(b => {
            if (typeof b.pinNumber !== 'number') return b;
            return failSet.has(b.pinNumber) ? { ...b, testStatus: 'nok' } : { ...b, testStatus: 'ok' };
          }));
        }
      }
    }

    const ch = typeof lastEv.ch === 'number' ? lastEv.ch : null;
    const val = typeof lastEv.val === 'number' ? lastEv.val : null;

    try { console.log('[GUI] apply EV', { kind, ch, val, mac: evMac }); } catch {}

    const normSet = new Set<number>((normalPins || []).filter((n) => Number.isFinite(n)) as number[]);
    const latchSet = new Set<number>((latchPins || []).filter((n) => Number.isFinite(n)) as number[]);

    startTransition(() => setLocalBranches((prev) => {
      let changed = false;
      const next = prev.map((b) => {
        if (typeof b.pinNumber !== 'number') return b;

        // Accept L or P with val=1 as OK for snappy UX
        if ((kind === 'L' || kind === 'P') && ch != null && b.pinNumber === ch && val === 1) {
          changed = true;
          return { ...b, testStatus: 'ok' } as BranchDisplayData;
        }
        // For NORMAL channels, treat release as missing
        if (kind === 'P' && ch != null && b.pinNumber === ch && val === 0) {
          if (normSet.has(ch)) { changed = true; return { ...b, testStatus: 'nok' } as BranchDisplayData; }
        }
        // Latch channels are sticky by design; no revert to nok on release
        if (kind === 'L' && ch != null && b.pinNumber === ch && val === 0) {
          if (latchSet.has(ch)) return b;
        }
        return b;
      });
      return changed ? next : prev;
    }));
  }, [lastEvTick, lastEv, macAddress, normalPins, latchPins]);

  // --- Recent MACs
  useEffect(() => {
    try {
      const raw = localStorage.getItem('RECENT_MACS') || '[]';
      const list = JSON.parse(raw);
      if (Array.isArray(list)) setRecentMacs(list.filter((s) => typeof s === 'string'));
    } catch {}
  }, []);

  // --- Derived views
  const pending = useMemo(
    () =>
      localBranches
        .filter((b) => b.testStatus === 'nok')
        .sort((a, b) => {
          const ap = typeof a.pinNumber === 'number' ? a.pinNumber : Number.POSITIVE_INFINITY;
          const bp = typeof b.pinNumber === 'number' ? b.pinNumber : Number.POSITIVE_INFINITY;
          if (ap !== bp) return ap - bp;
          return String(a.branchName).localeCompare(String(b.branchName));
        }),
    [localBranches]
  );

  const flatAllOk = useMemo(
    () => settled && localBranches.length > 0 && localBranches.every((b) => b.testStatus === 'ok'),
    [settled, localBranches]
  );

  const groupedAllOk = useMemo(() => {
    if (!settled) return false;
    if (!Array.isArray(groupedBranches) || groupedBranches.length === 0) return false;

    const byPin = new Map<number, BranchDisplayData['testStatus']>();
    for (const b of localBranches) {
      if (typeof b.pinNumber === 'number') byPin.set(b.pinNumber, b.testStatus);
    }

    return groupedBranches.every((g) =>
      g.branches.length > 0 &&
      g.branches.every((b) => {
        const s = (typeof b.pinNumber === 'number' ? byPin.get(b.pinNumber) : undefined) ?? b.testStatus;
        return s === 'ok';
      })
    );
  }, [settled, groupedBranches, localBranches]);

  const allOk = useMemo(() => {
    if (disableOkAnimation) return false;
    if (Array.isArray(checkFailures) && checkFailures.length > 0) return false;
    return flatAllOk || groupedAllOk;
  }, [disableOkAnimation, checkFailures, flatAllOk, groupedAllOk]);

  // --- Reset helper
  const returnToScan = useCallback(() => {
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
    setShowOkAnimation(false);
    setLocalBranches([]);
    if (typeof onResetKfb === 'function') onResetKfb();
    // Keep manual entry mode and input value to persist MAC across flow
  }, [onResetKfb]);

  // --- Auto transition on all OK
  useEffect(() => {
    if (initialPaintRef.current) { prevAllOkRef.current = allOk; return; }
    if (!allOk || prevAllOkRef.current) { prevAllOkRef.current = allOk; return; }
    if (flashInProgressRef.current) { prevAllOkRef.current = allOk; return; }

    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
    if (disableOkAnimation) {
      returnToScan();
    } else {
      setShowOkAnimation(true);
      timeoutRef.current = setTimeout(() => {
        setShowOkAnimation(false);
        returnToScan();
      }, 1500);
    }
    prevAllOkRef.current = allOk;
    return () => { if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; } };
  }, [allOk, disableOkAnimation, returnToScan]);

  // --- External force OK
  useEffect(() => {
    if (!settled) return;
    const t = Number(forceOkTick || 0);
    if (!t || t === lastForcedOkRef.current) return;
    lastForcedOkRef.current = t;
    returnToScan();
  }, [forceOkTick, settled, returnToScan]);

  // --- Flash success pipe for CHECK success
  useEffect(() => {
    const tick = Number(flashOkTick || 0);
    if (!settled || !tick) return;
    if (localBranches.length === 0 && !macAddress && !kfbNumber) return;
    if (tick === lastFlashTickRef.current) return;
    lastFlashTickRef.current = tick;

    if (disableOkAnimation) { returnToScan(); return; }

    flashInProgressRef.current = true;
    try {
      const id = (macAddress && macAddress.trim())
        ? macAddress.toUpperCase()
        : (kfbInfo?.board || kfbNumber || '').toString().toUpperCase();
      okBoardRef.current = id;
    } catch { okBoardRef.current = (macAddress || '').toUpperCase(); }

    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
    setShowOkAnimation(true);
    timeoutRef.current = setTimeout(() => {
      setShowOkAnimation(false);
      flashInProgressRef.current = false;
      returnToScan();
    }, 1500);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flashOkTick, disableOkAnimation]);

  // --- Actions
  const handleScan = useCallback(() => {
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
    setShowOkAnimation(false);
    onScanAgainRequest();
  }, [onScanAgainRequest]);

  const runCheck = useCallback(async () => {
    if (!macAddress) {
      setCheckError('Missing MAC address for CHECK');
      return;
    }
    setIsChecking(true);
    setCheckError(null);
    try {
      const res = await fetch('/api/serial/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mac: macAddress.toUpperCase() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || String(res.status));
      const failures: number[] = Array.isArray(data?.failures) ? data.failures : [];

      // recent MACs
      try {
        const mac = macAddress.toUpperCase();
        const now = [mac, ...recentMacs.filter((m) => m !== mac)].slice(0, 5);
        localStorage.setItem('RECENT_MACS', JSON.stringify(now));
        setRecentMacs(now);
      } catch {}

      // update local statuses
      startTransition(() => setLocalBranches(prev => prev.map(b => {
        if (typeof b.pinNumber !== 'number') return b;
        return failures.includes(b.pinNumber) ? { ...b, testStatus: 'nok' } : { ...b, testStatus: 'ok' };
      })));
    } catch (e: any) {
      setCheckError(e?.message || 'CHECK failed');
    } finally {
      setIsChecking(false);
    }
  }, [macAddress, recentMacs]);

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputValue.trim()) onManualSubmit(inputValue.trim());
  };

  // --- MAC input helpers ---
  const MAC_RE = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i;
  const formatMac = (raw: string) => {
    const hex = raw.replace(/[^0-9a-fA-F]/g, '').toUpperCase().slice(0, 12);
    return hex.match(/.{1,2}/g)?.join(':') ?? '';
  };
  const onMacChange = (v: string) => setInputValue(formatMac(v));
  const macValid = MAC_RE.test(inputValue.trim());

  // Auto-trigger flow when a valid MAC is scanned/typed
  const lastSubmittedRef = useRef<string>("");
  useEffect(() => {
    const v = inputValue.trim().toUpperCase();
    if (!v || !macValid) return;
    if (isChecking || isScanning) return;
    if (localBranches.length > 0) return;
    if (lastSubmittedRef.current === v) return;
    lastSubmittedRef.current = v;
    // Emulate manual submit so it follows the same path
    try { onManualSubmit(v); } catch {}
  }, [inputValue, macValid, isChecking, isScanning, localBranches.length, onManualSubmit]);

  // Keyboard-wedge capture: accept digits/hex and ':' even if input is not focused
  useEffect(() => {
    if (!hasMounted) return;
    if (localBranches.length > 0) return; // only on scan screen
    const onKey = (e: KeyboardEvent) => {
      const k = e.key;
      if (k === 'Enter') {
        // submit current input if valid
        if (MAC_RE.test(inputValue.trim())) {
          e.preventDefault();
          try { onManualSubmit(inputValue.trim()); } catch {}
        }
        return;
      }
      // collect hex digits and ':'
      if (/^[0-9a-fA-F:]$/.test(k)) {
        e.preventDefault();
        const next = (inputValue + k.toUpperCase()).slice(0, 17);
        setInputValue(next);
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => { window.removeEventListener('keydown', onKey, { capture: true } as any); };
  }, [hasMounted, localBranches.length, inputValue, onManualSubmit]);

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
            transition={{ repeat: Infinity, duration: 1.2, ease: 'easeInOut' }}
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
            transition={{ repeat: Infinity, duration: 1.2, ease: 'easeInOut' }}
          />
          SCANNING
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
                <path d="M18 18l20 20M38 18l-20 20" stroke="#fff" strokeWidth="6" strokeLinecap="round" />
              </svg>
            </div>
          </div>
          <h3 className="p-10 font-black text-red-500 uppercase tracking-widest text-6xl sm:text-7xl">
            SCANNING ERROR
          </h3>
          {checkError && <p className="mt-2 text-red-600 font-semibold">{checkError}</p>}
        </div>
      );
    }

    if (busy) {
      const label = isChecking ? 'CHECKING' : 'SCANNING';
      return (
        <div className="flex flex-col items-center justify-center h-full min-h-[500px]" aria-busy="true" aria-live="polite">
          <h2 className="text-7xl text-slate-600 font-bold uppercase tracking-wider animate-pulse">
            {label}
          </h2>
          <p className="mt-3 text-slate-500 text-2xl">Hold device steady. Auto-advance on success.</p>
        </div>
      );
    }

    // Success overlay — flashes ~1.5s on success
    if (showOkAnimation) {
      return (
        <div className="p-10 text-center w-full flex flex-col items-center justify-center select-none">
          <div className="relative">
            <m.div
              className="relative w-80 h-80 sm:w-[360px] sm:h-[360px] rounded-full flex items-center justify-center"
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 240, damping: 22 }}
            >
              <div className="absolute inset-0 rounded-full bg-emerald-500/10" />
              <div className="absolute inset-[10%] rounded-full border-2 border-emerald-400/70" />
              <CheckCircleIcon className="relative w-56 h-56 sm:w-60 sm:h-60 text-emerald-600" />
            </m.div>
          </div>
          <div className="mt-6">
            <h3 className="font-extrabold text-emerald-700 tracking-widest text-7xl sm:text-8xl">OK</h3>
          </div>
        </div>
      );
    }

    if (hasMounted && localBranches.length === 0) {
      if (isManualEntry) {
        return (
          <div className="fixed inset-0 z-50 flex items-start justify-center pt-14 md:pt-16" role="dialog" aria-modal="true">
            <div className="absolute inset-0 bg-black/40" onClick={() => setIsManualEntry(false)} aria-hidden />
            <div className="relative w-[min(92vw,48rem)] max-w-3xl mx-4 rounded-2xl border border-slate-200/80 shadow-2xl overflow-hidden bg-white">
              <button
                type="button"
                onClick={() => setIsManualEntry(false)}
                aria-label="Close"
                className="absolute top-3 right-3 z-10 inline-flex items-center justify-center h-12 w-12 rounded-full border-2 border-slate-300 bg-white text-slate-800 hover:bg-slate-100 shadow"
                title="Close"
              >
                <span className="text-3xl leading-none">×</span>
              </button>
              <div className="p-8 md:p-10">
                <div className="text-center mb-8">
                  <div className="inline-flex items-center gap-3 px-4 py-2 rounded-full border border-blue-200 bg-blue-50 text-blue-700 font-extrabold tracking-wider">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
                      <rect x="4" y="7" width="16" height="10" rx="3" stroke="currentColor" />
                      <path d="M8 7V5a4 4 0 0 1 8 0v2" stroke="currentColor" />
                    </svg>
                    ENTER MAC ADDRESS
                  </div>
                  <p className="mt-3 text-slate-500 font-semibold">Format: 08:3A:8D:15:27:54</p>
                </div>

                <form onSubmit={handleManualSubmit} className="w-full grid gap-6">
                  <div className="grid gap-2">
                    <label className="text-sm font-bold text-slate-600 tracking-wide select-none">MAC Address</label>
                    <div className={[
                      'relative rounded-2xl border-2 bg-gradient-to-b from-white to-slate-50 shadow-inner backdrop-blur',
                      macValid ? 'border-emerald-400' : 'border-blue-400',
                    ].join(' ')}>
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
                          'w-full text-center text-[40px] md:text-[44px] leading-[1.25] py-5 px-6 md:px-12 rounded-2xl outline-none',
                          'bg-transparent text-slate-800 focus:ring-0',
                          'font-mono tracking-[0.35em] placeholder:tracking-normal placeholder:text-slate-400 placeholder:opacity-70',
                        ].join(' ')}
                        autoFocus
                        aria-invalid={!macValid && !!inputValue}
                        aria-describedby="mac-help"
                      />
                      <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center">
                        {macValid && <CheckCircleIcon className="w-8 h-8 text-emerald-500" />}
                      </div>
                    </div>
                    <div id="mac-help" className="text-center text-sm text-slate-500 font-semibold">
                      Tip: Paste or scan; auto-format AA:BB:CC:DD:EE:FF
                    </div>
                    {!macValid && inputValue && (
                      <div className="text-center text-red-600 font-bold">Invalid MAC format</div>
                    )}
                  </div>
                  {recentMacs.length > 0 && (
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      <span className="text-slate-500 font-semibold mr-2">Recent:</span>
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
                        'w-full py-4 rounded-2xl font-extrabold uppercase tracking-wider transition',
                        'bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed'
                      ].join(' ')}
                    >
                      {busy ? 'Submitting' : 'Submit MAC'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        );
      }

      // Removed decorative scan box (barcode-like stripes) per request

      return (
        <div className="flex flex-col items-center justify-center h-full min-h-[520px]">
          <div className="w-full flex flex-col items-center gap-8">
            <p className="text-6xl md:text-7xl text-slate-700 font-extrabold uppercase tracking-widest text-center select-none">Please Scan Barcode</p>
            {isScanning && (
              <div className="flex flex-col items-center gap-3">
                <p className="text-slate-600 text-3xl md:text-4xl font-bold tracking-wide">SCANNING</p>
                <m.div
                  className="h-1 w-56 md:w-72 rounded-full bg-slate-300/50 overflow-hidden"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.2 }}
                >
                  <m.div
                    className="h-full w-1/3 bg-blue-500"
                    animate={{ x: ['-20%', '100%'] }}
                    transition={{ repeat: Infinity, duration: 1.2, ease: 'easeInOut' }}
                  />
                </m.div>
              </div>
            )}
          </div>
          {allowManualInput && !isScanning && (
            <button onClick={() => setIsManualEntry(true)} className="mt-10 text-xl md:text-2xl text-slate-500 hover:text-blue-600 transition-colors underline">
              Or enter MAC manually
            </button>
          )}
        </div>
      );
    }

    if (groupedBranches && groupedBranches.length > 0) {
      const Chip: React.FC<ChipProps> = ({ children, tone = 'neutral' }) => {
        const base = 'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold';
        const tones: Record<ChipTone, string> = {
          bad: 'bg-red-50 text-red-700 border border-red-200',
          ok: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
          warn: 'bg-amber-50 text-amber-800 border border-amber-200',
          neutral: 'bg-slate-50 text-slate-700 border border-slate-200',
        };
        return <span className={`${base} ${tones[tone]}`}>{children}</span>;
      };

      // Map live status by pin so socket events collapse items as they pass
      const statusByPin = new Map<number, 'ok' | 'nok' | 'not_tested'>();
      for (const b of localBranches) if (typeof b.pinNumber === 'number') statusByPin.set(b.pinNumber, b.testStatus as any);

      const ksskCards = groupedBranches.map((grp) => {
        const branchesLive = grp.branches.map((b) => {
          if (typeof b.pinNumber !== 'number') return b;
          const s = statusByPin.get(b.pinNumber);
          return s ? { ...b, testStatus: s } : b;
        });

        const nok = branchesLive.filter(b => b.testStatus === 'nok' && typeof b.pinNumber === 'number');
        const okBranches = branchesLive.filter(b => b.testStatus === 'ok' && typeof b.pinNumber === 'number');
        const okNames = okBranches
          .map(b => (nameHints && b.pinNumber!=null && nameHints[String(b.pinNumber)]) ? nameHints[String(b.pinNumber)] : b.branchName)
          .filter(Boolean);

        const failedItems = nok
          .map(b => ({
            pin: b.pinNumber as number,
            name: (nameHints && b.pinNumber!=null && nameHints[String(b.pinNumber)]) ? nameHints[String(b.pinNumber)] : b.branchName,
          }))
          .sort((a,b)=> a.name.localeCompare(b.name));

        const missingNames = failedItems.map(f => f.name);
        const activeSet = new Set((activeKssks || []).map(String));
        const isActive = activeSet.has(String(grp.kssk));

        return (
          <section key={grp.kssk} className="rounded-2xl border border-slate-200 bg-white shadow-sm hover:shadow-md transition-shadow">
            <header className="px-4 py-3 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className={`inline-flex items-center justify-center w-10 h-10 rounded-full ${isActive?'bg-blue-600':'bg-blue-500'} text-white font-extrabold shadow`}>{String(grp.kssk).slice(-2)}</span>
                <div className="flex flex-col">
                  <div className="text-xl font-black text-slate-800 leading-tight">{grp.kssk}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {missingNames.length > 0 ? <Chip tone="bad">{missingNames.length} missing</Chip> : <Chip tone="ok">OK</Chip>}
              </div>
            </header>
            <div className="p-4 grid gap-4">
              {failedItems.length > 0 && (
                <div>
                  <div className="text-[12px] font-bold uppercase text-slate-600 mb-2">Missing</div>
                  <div className="grid gap-2">
                    {failedItems.map((f) => (
                      <div key={`f-${grp.kssk}-${f.pin}`} className="rounded-xl border border-red-200 bg-red-50/40 p-3">
                        <div className="text-3xl md:text-4xl font-black text-slate-800 leading-tight">{f.name}</div>
                        <div className="mt-1 flex items-center gap-2">
                          <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold bg-red-50 text-red-700 border border-red-200">NOK</span>
                          <span className="inline-flex items-center rounded-full bg-slate-50 text-slate-600 border border-slate-200 px-2 py-[3px] text-[11px]">PIN {f.pin}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {okNames.length > 0 && (
                <div>
                  <div className="text-[12px] font-bold uppercase text-slate-600 mb-2">Passed</div>
                  <div className="flex flex-wrap gap-1.5">
                    {okNames.slice(0, 24).map((nm, i) => (
                      <span key={`ok-${grp.kssk}-${i}`} className="inline-flex items-center rounded-full bg-slate-50 text-slate-500 border border-slate-200 px-2 py-[5px] text-[12px] font-semibold">{nm}</span>
                    ))}
                    {okNames.length > 24 && (
                      <span className="text-[11px] text-slate-500">+{okNames.length-24} more</span>
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
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
          {pending.map((branch) => (
            <BranchCard key={branch.id} branch={branch} />
          ))}
        </div>
      </div>
    );
  };

  // --- Stable key for content transitions
  const viewKey = useMemo(() => {
    if (showOkAnimation) return 'ok';
    if (scanningError) return 'error';
    if (busy) return 'busy';
    if (hasMounted && localBranches.length === 0) return isManualEntry ? 'manual' : 'scan';
    return (Array.isArray(groupedBranches) && groupedBranches.length > 0) ? 'grouped' : 'flat';
  }, [showOkAnimation, scanningError, busy, hasMounted, localBranches.length, isManualEntry, groupedBranches]);

  return (
    <div className="flex-grow flex flex-col items-center justify-start p-2" style={{ paddingTop: appHeaderHeight }}>
      <header className="w-full mb-1 min-h-[56px]">
        {(kfbInfo?.board || kfbNumber || (macAddress && localBranches.length > 0)) ? (
          <div className="flex items-center justify-between gap-1">
            {(macAddress || kfbInfo?.board || kfbNumber) ? (
              <div className="flex items-center gap-3">
                <h1 className="font-mono text-4xl md:text-5xl font-extrabold uppercase tracking-wider text-slate-700 whitespace-normal break-words leading-tight max-w-full">
                  {macAddress ? macAddress.toUpperCase() : (kfbInfo?.board ?? kfbNumber)}
                </h1>
                <StatusPill />
              </div>
            ) : <div />}

            {!showOkAnimation && (
              <div className="flex items-center gap-2">
                {macAddress && localBranches.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={runCheck}
                      disabled={isChecking}
                      className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-bold"
                      title="Re-run check"
                    >
                      <ClockIcon className="w-4 h-4" />
                      CHECK NOW
                    </button>
                    <button
                      type="button"
                      onClick={handleScan}
                      className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-blue-600 bg-blue-600 hover:bg-blue-700 text-white font-bold"
                      title="Scan another"
                    >
                      SCAN AGAIN
                    </button>
                  </>
                )}
                {/* Active KSSKs */}
                {macAddress && localBranches.length > 0 && (
                  <div className="ml-4 flex flex-col items-end leading-tight">
                    <div className="text-sm md:text-base uppercase tracking-wide text-slate-600">Active KSSKs</div>
                    <div className="flex flex-wrap gap-2 mt-1 justify-end">
                      {(activeKssks && activeKssks.length > 0) ? (
                        activeKssks.map((id) => (
                          <span
                            key={`used-${id}`}
                            className="inline-flex items-center rounded-lg border border-slate-400 bg-white text-slate-800 px-3 py-1.5 text-sm md:text-base font-extrabold shadow"
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
          transition={{ duration: 0.18, ease: 'easeOut' }}
          className="w-full"
        >
          {mainContent()}
        </m.div>
      </AnimatePresence>

      {/* SR-only live region for status changes */}
      <div className="sr-only" aria-live="polite">
        {isChecking ? 'Checking in progress' : isScanning ? 'Scanning in progress' : 'Idle'}
      </div>

      <style>{`
        .animate-pulse-gray-background {
          animation: pulse-gray 2s cubic-bezier(.4,0,.6,1) infinite;
        }
        @keyframes pulse-gray {
          0%,100% { opacity: .2 }
          50% { opacity: .05 }
        }
      `}</style>
    </div>
  );
};

export default BranchDashboardMainContent;
