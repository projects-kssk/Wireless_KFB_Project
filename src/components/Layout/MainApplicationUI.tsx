'use client';

import React, { useState, useEffect, useCallback, useRef, FormEvent } from 'react';
import dynamic from 'next/dynamic';
import { m, AnimatePresence } from 'framer-motion';

import { BranchDisplayData, KfbInfo, TestStatus } from '@/types/types';
import { Header } from '@/components/Header/Header';
import { BranchControlSidebar } from '@/components/Program/BranchControlSidebar';
import { SettingsPageContent } from '@/components/Settings/SettingsPageContent';
import { SettingsBranchesPageContent } from '@/components/Settings/SettingsBranchesPageContent';
import BranchDashboardMainContent from '@/components/Program/BranchDashboardMainContent';
import { useSerialEvents } from '@/components/Header/useSerialEvents';

import SettingsRightSidebar from '@/components/Settings/SettingsRightSidebar';

const SIDEBAR_WIDTH = '24rem';
type MainView = 'dashboard' | 'settingsConfiguration' | 'settingsBranches';
type OverlayKind = 'success' | 'error' | 'scanning';

// Accept any ttyACM<N> and common by-id variants
const isAcmPath = (p?: string | null) =>
  !p
  || /(^|\/)ttyACM\d+$/.test(p)
  || /(^|\/)ACM\d+($|[^0-9])/.test(p)
  || /\/by-id\/.*ACM\d+/i.test(p);

function compileRegex(src: string | undefined, fallback: RegExp): RegExp {
  if (!src) return fallback;
  try {
    if (src.startsWith('/') && src.lastIndexOf('/') > 0) {
      const i = src.lastIndexOf('/');
      return new RegExp(src.slice(1, i), src.slice(i + 1));
    }
    return new RegExp(src);
  } catch (e) {
    console.warn('Invalid NEXT_PUBLIC_KFB_REGEX. Using fallback.', e);
    return fallback;
  }
}

// ENV-configurable KFB regex (fallback: 4 alphanumerics)
const KFB_REGEX = compileRegex(process.env.NEXT_PUBLIC_KFB_REGEX, /^[A-Z0-9]{4}$/);
const MAC_ONLY_REGEX = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i;

const MainApplicationUI: React.FC = () => {
  // UI state
  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(false);
  const [isSettingsSidebarOpen, setIsSettingsSidebarOpen] = useState(false);
  const [mainView, setMainView] = useState<MainView>('dashboard');

  // Data / process state
  const [branchesData, setBranchesData] = useState<BranchDisplayData[]>([]);
  const [kfbNumber, setKfbNumber] = useState('');
  const [kfbInfo, setKfbInfo] = useState<KfbInfo | null>(null);
  const [macAddress, setMacAddress] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Check flow
  const [checkFailures, setCheckFailures] = useState<number[] | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [awaitingRelease, setAwaitingRelease] = useState(false);
  const [showRemoveCable, setShowRemoveCable] = useState(false);

  // Settings flow
  const [currentConfigIdForProgram, setCurrentConfigIdForProgram] = useState<number | null>(null);

  // KFB input (from scanner or manual)
  const [kfbInput, setKfbInput] = useState('');
  const kfbInputRef = useRef(kfbInput);
  const isScanningRef = useRef(isScanning);
  useEffect(() => { kfbInputRef.current = kfbInput; }, [kfbInput]);
  useEffect(() => { isScanningRef.current = isScanning; }, [isScanning]);

  // Overlay
  const [overlay, setOverlay] = useState<{ open: boolean; kind: OverlayKind; code: string }>({
    open: false, kind: 'success', code: ''
  });
  const showOverlay = (kind: OverlayKind, code: string) => setOverlay({ open: true, kind, code });
  const hideOverlaySoon = () => { const t = setTimeout(() => setOverlay(o => ({ ...o, open: false })), 1200); return () => clearTimeout(t); };
  const lastScanRef = useRef('');

  // Serial events (SSE)
  const serial = useSerialEvents();
  const lastScan = serial.lastScan;
  const lastScanPath = (serial as any).lastScanPath as string | null | undefined;
  const DASH_SCANNER_INDEX = Number(process.env.NEXT_PUBLIC_SCANNER_INDEX_DASHBOARD ?? '0');
  const pathsEqual = (a?: string | null, b?: string | null) => {
    if (!a || !b) return false;
    if (a === b) return true;
    const ta = a.split('/').pop() || a;
    const tb = b.split('/').pop() || b;
    return ta === tb || a.endsWith(tb) || b.endsWith(ta);
  };
  const resolveDesiredPath = (): string | null => {
    const list = serial.scannerPaths || [];
    if (list[DASH_SCANNER_INDEX]) return list[DASH_SCANNER_INDEX] || null;
    return `/dev/ttyACM${DASH_SCANNER_INDEX}`;
  };
  const desiredPath = resolveDesiredPath();
  const desiredTail = (desiredPath || '').split('/').pop() || desiredPath || '';
  const desiredPortState = (() => {
    const map = serial.scannerPorts || {} as any;
    const key = Object.keys(map).find((k) => pathsEqual(k, desiredPath || ''));
    return key ? (map as any)[key] as { open: boolean; present: boolean } : null;
  })();

  // De-bounce duplicate scans
  const lastHandledScanRef = useRef<string>('');

  const handleResetKfb = () => {
    setKfbNumber('');
    setKfbInfo(null);
    setBranchesData([]);
    setKfbInput('');
  };

  // Narrowing guard
  const isTestablePin = (b: BranchDisplayData): b is BranchDisplayData & { pinNumber: number } =>
    !b.notTested && typeof b.pinNumber === 'number';

  // ----- RUN CHECK ON DEMAND OR AFTER EACH SCAN -----
  const runCheck = useCallback(
    async (mac: string) => {
      if (!mac) return;

      setIsChecking(true);
      setCheckFailures(null);
      setShowRemoveCable(false);
      setAwaitingRelease(false);

      try {
        const res = await fetch('/api/serial/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mac }),
        });
        const result = await res.json();

        if (res.ok) {
          const failures: number[] = result.failures || [];
          const unknown = result?.unknownFailure === true;
          setCheckFailures(failures);
          setBranchesData(data => {
            // If we already have branches, update their statuses
            if (data.length > 0) {
              return data.map(b => {
                if (typeof b.pinNumber !== 'number' || b.notTested) return b;
                return failures.includes(b.pinNumber)
                  ? { ...b, testStatus: 'nok' as TestStatus }
                  : { ...b, testStatus: 'ok' as TestStatus };
              });
            }
            // Otherwise, build branch list from Setup-provided pin aliases
            let aliases: Record<string,string> = {};
            try { aliases = JSON.parse(localStorage.getItem(`PIN_ALIAS::${mac.toUpperCase()}`) || '{}') || {}; } catch {}
            const pins = Object.keys(aliases).map(n => Number(n)).filter(n => Number.isFinite(n));
            pins.sort((a,b)=>a-b);
            return pins.map(pin => ({
              id: String(pin),
              branchName: aliases[String(pin)] || `PIN ${pin}`,
              testStatus: failures.includes(pin) ? 'nok' as TestStatus : 'ok' as TestStatus,
              pinNumber: pin,
              kfbInfoValue: undefined,
            }));
          });

          if (!unknown && failures.length === 0) {
            showOverlay('success', lastScanRef.current);
            setAwaitingRelease(true); // only wait for release on full success
          } else {
            const msg = unknown ? 'CHECK failure (no pin list)' : `Failures: ${failures.join(', ')}`;
            showOverlay('error', msg);
            setAwaitingRelease(false);
          }
          hideOverlaySoon();
        } else {
          console.error('CHECK error:', result);
          showOverlay('error', 'CHECK failed');
          setAwaitingRelease(false);
          hideOverlaySoon();
        }
      } catch (err) {
        console.error('CHECK error', err);
        showOverlay('error', 'CHECK exception');
        setAwaitingRelease(false);
        hideOverlaySoon();
      } finally {
        setIsChecking(false);
      }
    },
    []
  );

  // ----- LOAD + MONITOR + AUTO-CHECK FOR A SCAN -----
  const loadBranchesData = useCallback(async (value?: string) => {
    const kfbRaw = (value ?? kfbInputRef.current).trim();
    if (!kfbRaw) return;

    const normalized = kfbRaw.toUpperCase();
    // Accept MAC directly for production run; otherwise require KFB pattern
    const isMac = MAC_ONLY_REGEX.test(normalized);
    if (!isMac && !KFB_REGEX.test(normalized)) {
      showOverlay('error', `Invalid code: ${normalized}`);
      console.warn('[SCAN] rejected by patterns', { normalized });
      hideOverlaySoon();
      return;
    }

    // show SCANNING immediately
    lastScanRef.current = normalized;
    showOverlay('scanning', normalized);

    setIsScanning(true);
    setErrorMsg(null);
    setBranchesData([]);
    setKfbInfo(null);
    setKfbNumber('');
    setMacAddress('');
    setCheckFailures(null);
    setShowRemoveCable(false);
    setAwaitingRelease(false);

    try {
      // MAC-first flow: build branch list from Setup pin aliases and run CHECK-only
      const mac = isMac ? normalized : normalized; // if KFB code equals MAC form, treat as MAC
      setKfbNumber(mac);
      setMacAddress(mac);

      // build from aliases if present
      let aliases: Record<string,string> = {};
      try { aliases = JSON.parse(localStorage.getItem(`PIN_ALIAS::${mac}`) || '{}') || {}; } catch {}
      const pins = Object.keys(aliases).map(n => Number(n)).filter(n => Number.isFinite(n)).sort((a,b)=>a-b);
      if (pins.length) {
        setBranchesData(pins.map(pin => ({
          id: String(pin),
          branchName: aliases[String(pin)] || `PIN ${pin}`,
          testStatus: 'not_tested' as TestStatus,
          pinNumber: pin,
          kfbInfoValue: undefined,
        })));
      } else {
        setBranchesData([]);
      }

      await runCheck(mac);
    } catch (e) {
      console.error('Load/MONITOR error:', e);
      setKfbNumber('');
      setKfbInfo(null);
      setMacAddress('');
      setErrorMsg('Failed to load setup data. Please run Setup or scan MAC again.');
      showOverlay('error', 'Load failed');
      hideOverlaySoon();
    } finally {
      setIsScanning(false);
    }
  }, [runCheck]);

  // Single entry for new scans (used by SSE + polling)
  const handleScan = useCallback(async (raw: string) => {
    const normalized = (raw || '').trim().toUpperCase();
    if (!normalized) return;

    // De-bounce identical value while idle, but allow new scan once previous finished
    if (normalized === lastHandledScanRef.current && !isScanningRef.current) {
      // allow manual re-check by clearing lastHandledScanRef if desired
    }
    lastHandledScanRef.current = normalized;

    // keep fields in sync
    if (normalized !== kfbInputRef.current) {
      setKfbInput(normalized);
      setKfbNumber(normalized);
    }

    if (!KFB_REGEX.test(normalized)) {
      showOverlay('error', normalized);
      hideOverlaySoon();
      return;
    }

    if (isScanningRef.current) return; // avoid overlapping flows
    await loadBranchesData(normalized);
  }, [loadBranchesData]);

  // SSE → handle scans (gate by view and settings sidebar)
 useEffect(() => {
   if (mainView !== 'dashboard') return;
   if (isSettingsSidebarOpen) return;
   if (!serial.lastScanTick) return;              // no event yet
   if (lastScanPath && !isAcmPath(lastScanPath)) return;
   const want = resolveDesiredPath();
   if (want && lastScanPath && !pathsEqual(lastScanPath, want)) return; // ignore other scanner paths
   const code = serial.lastScan;                   // the latest payload
   if (!code) return;
   void handleScan(code);
   // optional: echo code for visibility
   // console.debug('[SSE scan]', { code, path: lastScanPath, tick: serial.lastScanTick });
 // depend on the tick, not the string
 }, [serial.lastScanTick, lastScanPath, handleScan, mainView, isSettingsSidebarOpen]);

  // Polling fallback (filters to ACM via returned path and gates by view + settings)
  useEffect(() => {
    if (mainView !== 'dashboard') return;
    if (isSettingsSidebarOpen) return;
    if ((serial as any).sseConnected) return; // don't poll if SSE is healthy

    let stopped = false;
    let lastPollAt = 0;
    // guard against duplicate pollers in StrictMode / re-renders
    const key = '__scannerPollActive__';
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
        const url = want ? `/api/serial/scanner?path=${encodeURIComponent(want)}` : '/api/serial/scanner';
       const res = await fetch(url, { cache: 'no-store', signal: ctrl.signal });
        if (res.ok) {
           const { code, path, error, retryInMs } = await res.json();
           try { if (typeof retryInMs === 'number') (window as any).__scannerRetry = retryInMs; } catch {}
          const raw = typeof code === 'string' ? code.trim() : '';
          if (raw) {
            if (path && !isAcmPath(path)) return;
            if (want && path && !pathsEqual(path, want)) return;
            await handleScan(raw);
          }
              else if (error) {
     setErrorMsg(String(error));
     console.warn('[SCANNER] poll error', error);
              }
        }
      } catch (e) {
        if (!(e instanceof DOMException && e.name === 'AbortError')) {
          console.error('[SCANNER] poll error', e);
        }
      } finally {
        const now = Date.now();
        const delay = typeof (window as any).__scannerRetry === 'number' ? (window as any).__scannerRetry : undefined;
        let nextMs = (typeof delay === 'number' && delay > 0) ? delay : 1800;
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
      try { delete (window as any)[key]; } catch {}
      if (timer) window.clearTimeout(timer);
      if (ctrl) ctrl.abort();
    };
  }, [mainView, isSettingsSidebarOpen, handleScan]);

  // Listen for UI cues + SUCCESS after a CHECK until release
  useEffect(() => {
    if (!awaitingRelease || !macAddress) return;
    let cancel = false;

    const loop = async () => {
      while (!cancel && awaitingRelease) {
        try {
          const r = await fetch(`/api/serial/ui?mac=${encodeURIComponent(macAddress)}&t=${Date.now()}`, { cache: 'no-store' });
          if (r.ok) {
            const { cue, result } = await r.json();

            const cueNorm = String(cue || '').toUpperCase().replace(/\s+/g, ':');
            if (cueNorm === 'UI:REMOVE_CABLE' || cueNorm === 'REMOVE_CABLE') {
              setShowRemoveCable(true);

              setCheckFailures([]);
              setBranchesData(d =>
                d.map(b =>
                  (typeof b.pinNumber === 'number' && !b.notTested)
                    ? { ...b, testStatus: 'ok' as TestStatus }
                    : b
                )
              );
            }

            if (typeof result === 'string' && /^SUCCESS\b/i.test(result)) {
              setShowRemoveCable(false);
              setAwaitingRelease(false);
            }
          }
        } catch {}
        await new Promise(r => setTimeout(r, 600));
      }
    };

    void loop();
    return () => { cancel = true; };
  }, [awaitingRelease, macAddress]);

  // Manual submit from a form/input
  const handleKfbSubmit = (e: FormEvent) => {
    e.preventDefault();
    void loadBranchesData(kfbInputRef.current);
  };

  const handleManualSubmit = (submittedNumber: string) => {
    const val = submittedNumber.trim().toUpperCase();
    if (!val) return;
    if (!KFB_REGEX.test(val)) {
      showOverlay('error', val);
      hideOverlaySoon();
      return;
    }
    setKfbInput(val);
    setKfbNumber(val);
    void loadBranchesData(val);
  };

  // Layout helpers
  const actualHeaderHeight = mainView === 'dashboard' ? '4rem' : '0rem';
  const leftOffset = mainView === 'dashboard' && isLeftSidebarOpen ? SIDEBAR_WIDTH : '0';
  const appCurrentViewType = (mainView === 'settingsConfiguration' || mainView === 'settingsBranches') ? 'settings' : 'main';

  const toggleLeftSidebar = () => setIsLeftSidebarOpen(v => !v);
  const toggleSettingsSidebar = () => setIsSettingsSidebarOpen(v => !v);
  const showDashboard = () => setMainView('dashboard');
  const showConfig = () => { setMainView('settingsConfiguration'); setIsLeftSidebarOpen(false); };
  const showBranchesSettings = (id?: number) => { if (id != null) setCurrentConfigIdForProgram(id); setMainView('settingsBranches'); setIsLeftSidebarOpen(false); };

  const handleHeaderClick = () => {
    if (appCurrentViewType === 'settings') { showDashboard(); setIsSettingsSidebarOpen(false); }
    else { toggleSettingsSidebar(); }
  };

  return (
    <div className="relative flex min-h-screen bg-slate-100 dark:bg-slate-900">
      {mainView === 'dashboard' && (
        <BranchControlSidebar
          isOpen={isLeftSidebarOpen}
          toggleSidebar={toggleLeftSidebar}
          branches={branchesData}
          onSetStatus={(id, status) =>
            setBranchesData(data => data.map(b => (b.id === id ? { ...b, testStatus: status } : b)))
          }
          sidebarWidthProvided={SIDEBAR_WIDTH}
          appHeaderHeight={actualHeaderHeight}
        />
      )}

      <div className="flex flex-1 flex-col transition-all" style={{ marginLeft: leftOffset }}>
        {mainView === 'dashboard' && (
          <Header
            onSettingsClick={handleHeaderClick}
            currentView={appCurrentViewType}
            isSidebarOpen={isLeftSidebarOpen}
            onToggleSidebar={toggleLeftSidebar}
          />
        )}

        <main className="flex-1 overflow-auto bg-gray-50 dark:bg-slate-900">
          {mainView === 'dashboard' ? (
            <>
              {desiredTail && (
                <div className="px-4 pt-2">
                  {(() => {
                    const present = !!desiredPortState?.present;
                    const badgeBase = 'inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-[13px] font-extrabold';
                    const badgeColor = present
                      ? 'border border-emerald-300 bg-emerald-50 text-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-200'
                      : 'border border-red-300 bg-red-50 text-red-900 dark:bg-red-900/20 dark:text-red-200';
                    return (
                      <span className={`${badgeBase} ${badgeColor}`}>
                        Scanner: {desiredTail}
                        <span className={present ? 'text-emerald-700' : 'text-red-700'}>
                          {present ? 'detected' : 'not detected'}
                        </span>
                      </span>
                    );
                  })()}
                </div>
              )}
              {showRemoveCable && (
                <div className="px-8 pt-3">
                  <div className="flex items-center gap-3 rounded-xl bg-amber-100 text-amber-900 px-5 py-3 font-extrabold shadow">
                    <span className="inline-block h-3 w-3 rounded-full bg-amber-600 animate-pulse" />
                    REMOVE CABLE
                  </div>
                </div>
              )}

              {errorMsg && <div className="px-8 pt-2 text-sm text-red-600">{errorMsg}</div>}

              <BranchDashboardMainContent
                appHeaderHeight={actualHeaderHeight}
                onManualSubmit={handleManualSubmit}
                onScanAgainRequest={() => loadBranchesData()}
                branchesData={branchesData}
                kfbNumber={kfbNumber}
                kfbInfo={kfbInfo}
                isScanning={isScanning}
                macAddress={macAddress}
                onResetKfb={handleResetKfb}
              />

              {/* Hidden form target if you submit manually elsewhere */}
              <form onSubmit={handleKfbSubmit} className="hidden" />
            </>
          ) : mainView === 'settingsConfiguration' ? (
            <SettingsPageContent onNavigateBack={showDashboard} onShowProgramForConfig={showBranchesSettings} />
          ) : (
            <SettingsBranchesPageContent onNavigateBack={showDashboard} configId={currentConfigIdForProgram} />
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

      {/* SCANNING / OK / ERROR overlay */}
      <AnimatePresence>
        {overlay.open && (
          <m.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(2,6,23,0.64)',
              backdropFilter: 'blur(4px)',
              display: 'grid',
              placeItems: 'center',
              zIndex: 9999,
            }}
            aria-live="assertive"
            aria-label={
              overlay.kind === 'success' ? 'OK' :
              overlay.kind === 'error' ? 'ERROR' : 'SCANNING'
            }
          >
            <m.div
              initial={{ scale: 0.98, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.98, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 260, damping: 20 }}
              style={{ display: 'grid', justifyItems: 'center', gap: 8 }}
            >
              <m.div
                initial={{ y: 6, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.22 }}
                style={{
                  fontSize: 128,
                  fontWeight: 900,
                  letterSpacing: '0.02em',
                  color:
                    overlay.kind === 'success' ? '#10b981' :
                    overlay.kind === 'error' ? '#ef4444' :
                    '#60a5fa',
                  textShadow: '0 8px 24px rgba(0,0,0,0.45)',
                  fontFamily:
                    'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Apple Color Emoji", "Segoe UI Emoji"',
                }}
              >
                {overlay.kind === 'success' ? 'OK' :
                 overlay.kind === 'error' ? 'ERROR' : 'SCANNING'}
              </m.div>
              {overlay.code && (
                <m.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.05 }}
                  style={{
                    fontSize: 16,
                    color: '#f1f5f9',
                    opacity: 0.95,
                    wordBreak: 'break-all',
                    textAlign: 'center',
                    maxWidth: 640,
                  }}
                >
                  {overlay.code}
                </m.div>
              )}
            </m.div>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default MainApplicationUI;
