'use client';

import React, { useState, useEffect, useCallback, useRef, FormEvent } from 'react';
import { BranchDisplayData, KfbInfo, TestStatus } from '@/types/types';

import { Header } from '@/components/Header/Header';
import { BranchControlSidebar } from '@/components/Program/BranchControlSidebar';
import { SettingsPageContent } from '@/components/Settings/SettingsPageContent';
import { SettingsBranchesPageContent } from '@/components/Settings/SettingsBranchesPageContent';
import BranchDashboardMainContent from '@/components/Program/BranchDashboardMainContent';

import dynamic from 'next/dynamic';
import { m, AnimatePresence } from 'framer-motion';
import { useSerialEvents } from '@/components/Header/useSerialEvents';

const SIDEBAR_WIDTH = '24rem';
type MainView = 'dashboard' | 'settingsConfiguration' | 'settingsBranches';
type OverlayKind = 'success' | 'error' | 'scanning';
const ACM_ONLY = '/dev/ttyACM0';
const isAcm0Path = (p?: string | null) =>
  !p // if server didn’t include path, accept (single scanner mode)
  || p === ACM_ONLY
  || /(^|\/)ttyACM0$/.test(p)
  || /(^|\/)ACM0($|[^0-9])/.test(p)
  || /\/by-id\/.*ACM0/i.test(p);

function compileRegex(src: string | undefined, fallback: RegExp): RegExp {
  if (!src) return fallback;
  try {
    const m = src.match(/^\/(.+)\/([gimsuy]*)$/);
    return m ? new RegExp(m[1], m[2]) : new RegExp(src);
  } catch {
    return fallback;
  }
}

// ENV-configurable KFB regex (fallback: 4 alphanumerics)
const KFB_REGEX = compileRegex(process.env.NEXT_PUBLIC_KFB_REGEX, /^[A-Z0-9]{4}$/);

const MainApplicationUI: React.FC = () => {
  // UI state
  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(false);
  const [isSettingsSidebarOpen, setIsSettingsSidebarOpen] = useState(false);
  const [mainView, setMainView] = useState<MainView>('dashboard');
  const SettingsRightSidebar = dynamic(() => import('@/components/Settings/SettingsRightSidebar'), { ssr: false });

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
    async (pins: number[], mac: string) => {
      if (!pins.length || !mac) return;

      setIsChecking(true);
      setCheckFailures(null);
      setShowRemoveCable(false);
      setAwaitingRelease(true);

      try {
        const res = await fetch('/api/serial/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pins, mac }),
        });
        const result = await res.json();

        if (res.ok) {
          const failures: number[] = result.failures || [];
          setCheckFailures(failures);
          setBranchesData(data =>
            data.map(b => {
              if (typeof b.pinNumber !== 'number' || b.notTested) return b;
              return failures.includes(b.pinNumber)
                ? { ...b, testStatus: 'nok' as TestStatus }
                : { ...b, testStatus: 'ok' as TestStatus };
            })
          );

          if (failures.length === 0) {
            showOverlay('success', lastScanRef.current);
          } else {
            showOverlay('error', `Failures: ${failures.join(', ')}`);
          }
          hideOverlaySoon();
        } else {
          console.error('CHECK error:', result);
          showOverlay('error', 'CHECK failed');
          hideOverlaySoon();
        }
      } catch (err) {
        console.error('CHECK error', err);
        showOverlay('error', 'CHECK exception');
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
    if (!KFB_REGEX.test(normalized)) {
      showOverlay('error', normalized);
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
      // a) branches
      const res = await fetch(`/api/branches?kfb=${encodeURIComponent(normalized)}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
      const data: BranchDisplayData[] = await res.json();
      setBranchesData(data.map(b => ({ ...b, testStatus: 'not_tested' as TestStatus })));
      setKfbNumber(normalized);

      // b) configuration (mac + info)
      const cfgRes = await fetch(`/api/configurations?kfb=${encodeURIComponent(normalized)}`, { cache: 'no-store' });
      if (!cfgRes.ok) throw new Error(`Failed to fetch configuration: ${cfgRes.status}`);
      const { mac_address, kfb_info } = await cfgRes.json();
      setMacAddress(mac_address);
      setKfbInfo(kfb_info);

      // c) classify pins
      const testable = data.filter(isTestablePin);
      const latchPins: number[] = testable.filter(b => b.looseContact).map(b => b.pinNumber);
      const normalPins: number[] = testable.filter(b => !b.looseContact).map(b => b.pinNumber);
      const pins: number[] = [...latchPins, ...normalPins];

      // d) MONITOR
      const serialRes = await fetch('/api/serial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ normalPins, latchPins, mac: mac_address }),
      });
      if (!serialRes.ok) throw new Error(`Serial POST failed: ${await serialRes.text()}`);

      // e) AUTO-CHECK on every scan
      await runCheck(pins, mac_address);
    } catch (e) {
      setKfbNumber('');
      setKfbInfo(null);
      setMacAddress('');
      setErrorMsg('No branches found or failed to load.');
      console.error('Load/MONITOR error:', e);
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
      // still allow if you want re-checks; otherwise keep this guard
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

  // SSE → handle scans (only ACM0 if path is available)
  useEffect(() => {
    if (!lastScan) return;
    if (lastScanPath && !isAcm0Path(lastScanPath)) return;
    void handleScan(lastScan);
  }, [lastScan, lastScanPath, handleScan]);

  // Polling fallback (filters to ACM0 via returned path)
  useEffect(() => {
    if (mainView !== 'dashboard') return;
    let stopped = false;
    let timer: number | null = null;
    let ctrl: AbortController | null = null;

    const tick = async () => {
      try {
        if (isScanningRef.current) {
          if (!stopped) timer = window.setTimeout(tick, 250);
          return;
        }
        ctrl = new AbortController();
        const res = await fetch('/api/serial/scanner', { cache: 'no-store', signal: ctrl.signal });
        if (res.ok) {
          const { code, path } = await res.json();
          const raw = typeof code === 'string' ? code.trim() : '';
        if (raw) {
          if (path && !isAcm0Path(path)) return;   // use the robust matcher
          await handleScan(raw);
        }

        }
      } catch (e) {
        if (!(e instanceof DOMException && e.name === 'AbortError')) {
          console.error('[SCANNER] poll error', e);
        }
      } finally {
        if (!stopped) timer = window.setTimeout(tick, 250);
      }
    };

    tick();
    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
      if (ctrl) ctrl.abort();
    };
  }, [mainView, handleScan]);

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
        await new Promise(r => setTimeout(r, 250));
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
                onResetKfb={handleResetKfb}
              />
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
            onAnimationStart={() => {
              if (overlay.kind !== 'scanning') hideOverlaySoon();
            }}
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
