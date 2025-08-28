
// src/components/Program/BranchDashboardMainContent.tsx
import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from 'react';
import { BranchDisplayData, KfbInfo } from '@/types/types';

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

const BarcodeIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg {...props} viewBox="0 0 100 50" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="0" width="100" height="50" rx="5" fill="currentColor" className="animate-pulse-gray-background"/>
    <g fill="currentColor">
      {[10,14,17,22,26,29,34,38,41,46,50,53,58,62,65,70,74,77,82,86].map((x,i) => (
        <rect key={i} x={x} y="10" width={i%3===2?3:i%2===1?1:2} height="30" />
      ))}
      <text x="50" y="47" fontSize="6" textAnchor="middle" fill="currentColor">IWTESTBOARD</text>
    </g>
  </svg>
);

// --- HELPER FUNCTIONS ---
const getStatusInfo = (status: BranchDisplayData['testStatus']) => {
  switch (status) {
    case 'ok':
      return { Icon: CheckCircleIcon, text: 'OK', color: 'text-emerald-600', bgColor: 'bg-emerald-500/10' };
    case 'nok':
      return { Icon: XCircleIcon, text: 'NOK', color: 'text-red-600', bgColor: 'bg-red-500/10' };

    default: // not_tested
      return { Icon: HelpCircleIcon, text: 'Not Tested', color: 'text-slate-600', bgColor: 'bg-slate-500/10' };
  }
};

// --- CHILD COMPONENT: BRANCH CARD ---
const BranchCard = ({ branch, kssk }: { branch: BranchDisplayData; kssk?: string }) => {
  const statusInfo = useMemo(() => getStatusInfo(branch.testStatus), [branch.testStatus]);
  const isNok = branch.testStatus === 'nok';
  const isBigStatus = branch.testStatus === 'nok' || branch.testStatus === 'not_tested';

  return (
    <div
      key={branch.id}
      className="group relative w-full rounded-2xl bg-white backdrop-blur-sm shadow-lg hover:shadow-xl border-2 border-transparent transition-all duration-300 flex flex-col overflow-hidden"
    >
      {isNok && <div className="h-[8px] w-full bg-red-600 flex-shrink-0"></div>}
      <div className="p-3 flex-grow flex flex-col justify-between">
        <div className="flex justify-between items-center mb-3">
          <div className={`inline-flex items-center gap-2 rounded-full font-bold ${statusInfo.bgColor} ${statusInfo.color} ${isBigStatus ? 'px-2.5 py-1.5 text-xl' : 'px-2 py-1 text-sm'}`}>
            <statusInfo.Icon className={isBigStatus ? "w-7 h-7" : "w-4.5 h-4.5"} />
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
        {/* KSSK badge intentionally omitted in card view */}
        <h3 className="text-5xl md:text-6xl font-bold text-slate-800 group-hover:text-blue-600 transition-colors duration-300 mt-3 text-center whitespace-normal break-words leading-tight">
          {branch.branchName}
        </h3>
      </div>
    </div>
  );
};

export interface BranchDashboardMainContentProps {
  onScanAgainRequest: () => void;
  onManualSubmit: (kfbNumber: string) => void;
  appHeaderHeight: string;
  branchesData: BranchDisplayData[];
  isScanning: boolean;
  kfbNumber: string;
  kfbInfo: KfbInfo | null;
  allowManualInput?: boolean;
  showRemoveCable?: boolean; 
    onResetKfb?: () => void; // <-- add this
  macAddress?: string; // optional: needed for CHECK
  groupedBranches?: Array<{ kssk: string; branches: BranchDisplayData[] }>;
  checkFailures?: number[] | null;
  nameHints?: Record<string,string> | undefined;
  activeKssks?: string[];
  scanningError?: boolean;
  disableOkAnimation?: boolean;
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
  showRemoveCable = false,
    onResetKfb, 
  macAddress,
  groupedBranches = [],
  checkFailures = null,
  nameHints,
  activeKssks = [],
  scanningError = false,
  disableOkAnimation = false,
}) => {
  const [hasMounted, setHasMounted] = useState(false);
  const [showOkAnimation, setShowOkAnimation] = useState(false);
  const [isManualEntry, setIsManualEntry] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [localBranches, setLocalBranches] = useState<BranchDisplayData[]>(branchesData);
  const [recentMacs, setRecentMacs] = useState<string[]>([]);

  useEffect(() => { setLocalBranches(branchesData); }, [branchesData]);

  useEffect(() => { setHasMounted(true); }, []);

  // load recent macs list (if any)
  useEffect(() => {
    try {
      const raw = localStorage.getItem('RECENT_MACS') || '[]';
      const list = JSON.parse(raw);
      if (Array.isArray(list)) setRecentMacs(list.filter((s) => typeof s === 'string'));
    } catch {}
  }, []);

  // Only show NOK branches in the main list
  const pending = useMemo(() =>
    localBranches
      .filter((b) => b.testStatus === 'nok')
      .sort((a, b) => 0),
  [localBranches]);

  // Build current failure pin list from props or from pending branches
  const failurePins: number[] = useMemo(() => {
    if (Array.isArray(checkFailures) && checkFailures.length > 0) {
      return [...new Set((checkFailures as number[]).filter((n) => Number.isFinite(n)))].sort((a,b)=>a-b);
    }
    const pins = pending.map((b) => b.pinNumber).filter((n): n is number => typeof n === 'number');
    return [...new Set(pins)].sort((a,b)=>a-b);
  }, [checkFailures, pending]);

 const allOk = useMemo(() => {
   // If caller reports any failed pins from CHECK, never show OK animation
   if (Array.isArray(checkFailures) && checkFailures.length > 0) return false;
   if (disableOkAnimation) return false;
   return (
     hasMounted &&
     !isScanning && !isChecking &&
     localBranches.length > 0 &&
     localBranches.every(b => b.testStatus === 'ok')
   );
 }, [hasMounted, isScanning, isChecking, localBranches, checkFailures, disableOkAnimation]);

useEffect(() => {
  if (timeoutRef.current) clearTimeout(timeoutRef.current);
  if (allOk) {
    setShowOkAnimation(true);
    timeoutRef.current = setTimeout(() => {
      setShowOkAnimation(false);
      // --- Add this to trigger the reset in parent
      if (typeof onResetKfb === 'function') onResetKfb();
      setIsManualEntry(false); // also reset manual entry mode in this component
      setInputValue(''); // clear the manual input field
    }, 5000); // your OK duration
  } else {
    setShowOkAnimation(false);
  }
  return () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); };
}, [allOk, onResetKfb]);


  const handleScan = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
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
      // store to recent list
      try {
        const mac = macAddress.toUpperCase();
        const now = [mac, ...recentMacs.filter((m) => m !== mac)].slice(0, 5);
        localStorage.setItem('RECENT_MACS', JSON.stringify(now));
        setRecentMacs(now);
      } catch {}
      // update local statuses
      setLocalBranches(prev => prev.map(b => {
        if (typeof b.pinNumber !== 'number' || b.notTested) return b;
        return failures.includes(b.pinNumber)
          ? { ...b, testStatus: 'nok' }
          : { ...b, testStatus: 'ok' };
      }));
    } catch (e: any) {
      setCheckError(e?.message || 'CHECK failed');
    } finally {
      setIsChecking(false);
    }
  }, [macAddress, localBranches]);
  
  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputValue.trim()) {
      onManualSubmit(inputValue.trim());
    }
  };

  // --- MAC input helpers (format + validate like Setup) ---
  const MAC_RE = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i;
  const formatMac = (raw: string) => {
    const hex = raw.replace(/[^0-9a-fA-F]/g, '').toUpperCase().slice(0, 12);
    return hex.match(/.{1,2}/g)?.join(':') ?? '';
  };
  const onMacChange = (v: string) => setInputValue(formatMac(v));
  const macValid = MAC_RE.test(inputValue.trim());

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
        </div>
      );
    }
    if (isScanning && localBranches.length > 0) {
      return (
        <div className="flex flex-col items-center justify-center h-full min-h-[500px]">
          <h2 className="text-7xl text-slate-600 font-bold uppercase tracking-wider animate-pulse">
            SELF CHECKING...
          </h2>
        </div>
      );
    }

    if (showOkAnimation) {
      return (
        <div className="p-10 text-center w-full flex flex-col items-center justify-center">
          <div className="relative">
            <div className="w-80 h-80 sm:w-[350px] sm:h-[350px] bg-green-100 dark:bg-green-700/30 rounded-full flex items-center justify-center animate-pulse">
              <CheckCircleIcon className="w-150 h-150 sm:w-160 sm:h-160 text-green-600 dark:text-green-400" />
            </div>
          </div>
          <h3 className="p-10 font-black text-green-500 uppercase tracking-widest text-8xl sm:text-9xl">
            OK
          </h3>
        </div>
      );
    }

    if (hasMounted && localBranches.length === 0) {
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
                          'w-full text-center text-[44px] leading-[1.25] py-5 pl-36 pr-36 rounded-2xl outline-none',
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
                      Tip: Paste or scan; we auto-format as AA:BB:CC:DD:EE:FF
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
                      disabled={!macValid || isScanning}
                      className="w-full py-4 rounded-2xl text-white font-extrabold text-2xl shadow-lg disabled:bg-slate-400 disabled:cursor-not-allowed bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 hover:from-blue-700 hover:via-indigo-700 hover:to-blue-800"
                    >
                      {isScanning ? 'Submitting…' : 'Submit MAC'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        );
      }

      // Scan box styled like Setup page
      const ScanBox = ({ ariaLabel, height = 220 }: { ariaLabel: string; height?: number }) => {
        const slabH = Math.max(120, Math.min(Math.round(height * 0.6), 140));
        return (
          <div aria-label={ariaLabel} className="w-full max-w-4xl">
            <div
              style={{
                position: 'relative',
                width: '100%',
                height,
                borderRadius: 18,
                overflow: 'hidden',
                background: '#0b1220',
                border: '1px solid #1f2937',
                boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.06), 0 10px 24px rgba(0,0,0,.25)'
              }}
            >
              <div aria-hidden style={{ position: 'absolute', inset: 0, opacity: .22, backgroundImage: 'repeating-linear-gradient(90deg, rgba(148,163,184,.28) 0 1px, transparent 1px 12px)', backgroundSize: '120px 100%' }} />
              {(['tl','tr','bl','br'] as const).map(pos => (
                <div key={pos} aria-hidden style={{ position: 'absolute', width: 18, height: 18, ...(pos==='tl' && { left:10, top:10, borderLeft:'2px solid #e5e7eb', borderTop:'2px solid #e5e7eb' }), ...(pos==='tr' && { right:10, top:10, borderRight:'2px solid #e5e7eb', borderTop:'2px solid #e5e7eb' }), ...(pos==='bl' && { left:10, bottom:10, borderLeft:'2px solid #e5e7eb', borderBottom:'2px solid #e5e7eb' }), ...(pos==='br' && { right:10, bottom:10, borderRight:'2px solid #e5e7eb', borderBottom:'2px solid #e5e7eb' }), opacity:.7, borderRadius:2 }} />
              ))}
              <div aria-hidden style={{ position: 'absolute', left:'50%', top:'50%', transform:'translate(-50%,-50%)', width: 'min(100%, 1100px)', height: slabH, borderRadius: 12, background: 'repeating-linear-gradient(90deg, rgba(255,255,255,.96) 0 7px, transparent 7px 15px)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,.25), inset 0 -1px 0 rgba(255,255,255,.18)' }}>
                <div style={{ position:'absolute', inset:0, borderRadius: 12, background: 'linear-gradient(90deg, rgba(11,18,32,1) 0, rgba(11,18,32,0) 8%, rgba(11,18,32,0) 92%, rgba(11,18,32,1) 100%)', pointerEvents:'none' }} />
              </div>
              <div aria-label="KFB WIRELESS" style={{ position:'absolute', left:0, right:0, bottom:0, paddingBottom: 6, display:'flex', justifyContent:'center', pointerEvents:'none' }}>
                <span style={{ fontFamily:'Inter, ui-sans-serif, system-ui, "Segoe UI", Roboto, Helvetica, Arial', textTransform:'uppercase', letterSpacing: 3, fontWeight: 700, fontSize: 12, color:'#ffffff', opacity:.6, textShadow: '0 1px 0 rgba(0,0,0,.35)', userSelect:'none' }}>KFB WIRELESS</span>
              </div>
            </div>
          </div>
        );
      };

      return (
        <div className="flex flex-col items-center justify-center h-full min-h-[520px]">
          <div className="w-full flex flex-col items-center gap-8">
            <ScanBox ariaLabel="Scan MAC or KFB" />
            <p className="text-6xl md:text-7xl text-slate-600 font-extrabold uppercase tracking-widest text-center select-none">Please Scan KFB Board</p>
            {isScanning && <p className="text-slate-500 text-4xl md:text-5xl animate-pulse text-center">Scanning…</p>}
          </div>
          {allowManualInput && (
            <button onClick={() => setIsManualEntry(true)} className="mt-10 text-xl md:text-2xl text-slate-500 hover:text-blue-600 transition-colors underline">
              Or enter MAC manually
            </button>
          )}
        </div>
      );
    }

    if (groupedBranches && groupedBranches.length > 0) {
      return (
        <div className="flex flex-col gap-3 w-full mt-0">
          <div className="flex flex-wrap items-center gap-2 px-1">
            <span className="text-slate-800 font-black tracking-wide text-4xl">KSSKs:</span>
            {(() => {
              const activeSet = new Set((activeKssks || []).map(String));
              return groupedBranches.map((g) => {
                const isActive = activeSet.has(String(g.kssk));
                return (
                  <span
                    key={`kssk-pill-${g.kssk}`}
                    className={[
                      "inline-flex items-center gap-3 px-4 py-2 rounded-full border-2 text-2xl md:text-3xl font-black tracking-wide",
                      isActive ? "bg-blue-600 text-white border-blue-600" : "bg-blue-50 text-blue-700 border-blue-200",
                    ].join(" ")}
                  >
                    {g.kssk}
                  </span>
                );
              });
            })()}
          </div>
          {/* Groups remain separate; lay multiple groups per row; show ALL NOK pins */}
          {(() => {
            const colClass = (n: number) => {
              const cols = Math.min(6, Math.max(1, n));
              const map: Record<number, string> = {
                1: 'grid-cols-1',
                2: 'grid-cols-2',
                3: 'grid-cols-3',
                4: 'grid-cols-4',
                5: 'grid-cols-5',
                6: 'grid-cols-6',
              };
              return map[cols];
            };
            return (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
                {groupedBranches.map((grp) => {
                  const onlyNok = grp.branches.filter((b) => b.testStatus === 'nok');
                  if (onlyNok.length === 0) return null;
                  const visible = onlyNok; // show all NOK pins for this group
                  const gridCols = colClass(visible.length);
                  return (
            <section key={grp.kssk} className="rounded-3xl border-2 border-blue-400 bg-white shadow-lg overflow-hidden">
              <header className="px-3 py-2 bg-gradient-to-r from-blue-50 to-white border-b border-blue-200 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-blue-500 text-white font-extrabold shadow">{String(grp.kssk).slice(-2)}</span>
                  <h2 className="text-3xl font-black tracking-wide text-blue-700">{grp.kssk}</h2>
                </div>
                <span className="text-xs md:text-sm font-extrabold text-blue-600">{onlyNok.length} NOK</span>
              </header>
              <div className="p-3">
                <div className="flex flex-col w-full gap-1">
                  {visible.map((b) => (
                    <div key={b.id} className="w-full">
                      <BranchCard branch={b} />
                    </div>
                  ))}
                </div>
              </div>
            </section>
                  );
                })}
              </div>
            );
          })()}
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

  return (
    <div className="flex-grow flex flex-col items-center justify-start p-8" style={{ paddingTop: appHeaderHeight }}>
     <header className="w-full mb-1 min-h-[56px]">
      {(kfbInfo?.board || kfbNumber || (macAddress && localBranches.length > 0)) ? (
        <div className="flex items-center justify-between gap-1">
          {(kfbInfo?.board || kfbNumber) ? (
            <h1 className="text-5xl md:text-6xl font-bold uppercase tracking-wider text-slate-700 truncate">
              {kfbInfo?.board ?? kfbNumber}
            </h1>
          ) : <div />}
          {macAddress && localBranches.length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-slate-700 font-black text-3xl md:text-4xl tracking-wider uppercase whitespace-nowrap">
                Scan again to re-check
              </span>
              {checkError && <span className="text-red-600 text-xl md:text-2xl font-bold whitespace-nowrap">{checkError}</span>}
            </div>
          )}
        </div>
      ) : null}
      {failurePins.length > 0 && macAddress && (
        <div className="mt-0.5 px-1 flex items-center justify-between gap-2">
          <span className="text-red-700 font-extrabold text-xl md:text-2xl whitespace-normal">
            RESULT FAILURE MISSING {failurePins.join(', ')}
          </span>
          <span className="text-slate-600 font-extrabold text-lg md:text-xl whitespace-nowrap">
            {macAddress.toUpperCase()}
          </span>
        </div>
      )}
      {activeKssks.length > 0 && (
        <div className="mt-0 flex items-center justify-center gap-2">
          <span className="text-slate-600 font-extrabold tracking-wide text-sm">Active KSSKs:</span>
          {activeKssks.map((id) => (
            <span key={`active-kssk-${id}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-blue-200 bg-blue-50 text-blue-700 text-xs font-extrabold">
              {id}
            </span>
          ))}
        </div>
      )}
    </header>

      {mainContent()}
      <style>{`
        .animate-pulse-gray-background {
          animation: pulse-gray 2s cubic-bezier(.4,0,.6,1) infinite;
        }
        @keyframes pulse-gray {
          0%,100% { opacity: .2 }
          50% { opacity: .05 }
        }
          
      `}</style>

      {showRemoveCable && (
  <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/60">
    <div className="relative">
      <div className="w-80 h-80 sm:w-[350px] sm:h-[350px] bg-yellow-100 dark:bg-yellow-700/30 rounded-full flex items-center justify-center plug-wiggle text-yellow-700 dark:text-yellow-300">
        <svg width="180" height="120" viewBox="0 0 180 120" aria-hidden="true">
          <rect x="10" y="45" width="70" height="30" rx="6" fill="currentColor"></rect>
          <rect x="70" y="48" width="8" height="10" fill="currentColor"></rect>
          <rect x="70" y="62" width="8" height="10" fill="currentColor"></rect>
          <path d="M80 60 C110 60, 130 40, 170 20" stroke="currentColor" strokeWidth="6" fill="none"></path>
        </svg>
      </div>
    </div>
    <h3 className="p-10 font-black text-yellow-200 uppercase tracking-widest text-7xl sm:text-8xl drop-shadow">
      REMOVE CABLE
    </h3>
  </div>
)}
    </div>
  );
};

export default BranchDashboardMainContent;
