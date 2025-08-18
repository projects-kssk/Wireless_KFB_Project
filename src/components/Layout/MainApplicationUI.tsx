'use client';

import React, { useState, useEffect, useCallback, useRef, FormEvent } from 'react';
import { BranchDisplayData, KfbInfo, TestStatus } from '@/types/types';

import { Header } from '@/components/Header/Header';
import { BranchControlSidebar } from '@/components/Program/BranchControlSidebar';
import { SettingsRightSidebar } from '@/components/Settings/SettingsRightSidebar';
import { SettingsPageContent } from '@/components/Settings/SettingsPageContent';
import { SettingsBranchesPageContent } from '@/components/Settings/SettingsBranchesPageContent';
import BranchDashboardMainContent from '@/components/Program/BranchDashboardMainContent';

const SIDEBAR_WIDTH = '24rem';
type MainView = 'dashboard' | 'settingsConfiguration' | 'settingsBranches';

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
  const [awaitingRelease, setAwaitingRelease] = useState(false); // ← keep listening for SUCCESS
  const [showRemoveCable, setShowRemoveCable] = useState(false);

  // Settings flow
  const [currentConfigIdForProgram, setCurrentConfigIdForProgram] = useState<number | null>(null);

  // KFB input (from scanner or manual)
  const [kfbInput, setKfbInput] = useState('');
  const kfbInputRef = useRef(kfbInput);
  const isScanningRef = useRef(isScanning);
  useEffect(() => { kfbInputRef.current = kfbInput; }, [kfbInput]);
  useEffect(() => { isScanningRef.current = isScanning; }, [isScanning]);

  const handleResetKfb = () => {
    setKfbNumber('');
    setKfbInfo(null);
    setBranchesData([]);
    setKfbInput('');
  };

  const loadBranchesData = useCallback(async (value?: string) => {
    const kfb = (value ?? kfbInputRef.current).trim();
    if (!kfb) return;

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
      const res = await fetch(`/api/branches?kfb=${encodeURIComponent(kfb)}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
      const data: BranchDisplayData[] = await res.json();
     setBranchesData(data.map(b => ({ ...b, testStatus: 'not_tested' as TestStatus })));
      setKfbNumber(kfb.toUpperCase());

      // b) configuration (mac + info)
      const cfgRes = await fetch(`/api/configurations?kfb=${encodeURIComponent(kfb)}`, { cache: 'no-store' });
      if (!cfgRes.ok) throw new Error(`Failed to fetch configuration: ${cfgRes.status}`);
      const { mac_address, kfb_info } = await cfgRes.json();
      setMacAddress(mac_address);
      setKfbInfo(kfb_info);

      // c) classify pins
      const latchPins = data.filter(b => b.looseContact && !b.notTested && typeof b.pinNumber === 'number').map(b => b.pinNumber);
      const normalPins = data.filter(b => !b.looseContact && !b.notTested && typeof b.pinNumber === 'number').map(b => b.pinNumber);
      const pins = [...latchPins, ...normalPins];

      // d) MONITOR
      const serialRes = await fetch('/api/serial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ normalPins, latchPins, mac: mac_address }),
      });
      if (!serialRes.ok) throw new Error(`Serial POST failed: ${await serialRes.text()}`);

      // e) quick CHECK (sync failures for UI mapping)
      const initialRes = await fetch('/api/serial/check', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pins, mac: mac_address }),
      });
      const initialResult = await initialRes.json();
      const failures: number[] = initialResult.failures || [];

      setBranchesData(d => d.map(b => {
        if (typeof b.pinNumber !== 'number') return b;
        return failures.includes(b.pinNumber)
          ? { ...b, testStatus: 'nok' as TestStatus }
          : { ...b, testStatus: 'ok' as TestStatus };
      }));
      setIsScanning(false);               // <-- HERE: after mapping statuses
    } catch (e) {
        setIsScanning(false); 
      setKfbNumber('');
      setKfbInfo(null);
      setMacAddress('');
      setErrorMsg('No branches found or failed to load.');
      console.error('Load/MONITOR error:', e);
    } 
  }, []);

  // Scanner polling
  useEffect(() => {
    if (mainView !== 'dashboard') return;
    let stopped = false;
    let timer: number | null = null;

    const tick = async () => {
      try {
        if (isScanningRef.current) {
          if (!stopped) timer = window.setTimeout(tick, 250);
          return;
        }
        const res = await fetch('/api/serial/scanner', { cache: 'no-store' });
        if (res.ok) {
          const { code } = await res.json();
          const val = typeof code === 'string' ? code.trim() : '';
          if (val && val !== kfbInputRef.current) {
            setKfbInput(val);
            setKfbNumber(val);
            await loadBranchesData(val);
          }
        }
      } catch (e) {
        console.error('[SCANNER] poll error', e);
      } finally {
        if (!stopped) timer = window.setTimeout(tick, 250);
      }
    };

    tick();
    return () => { stopped = true; if (timer) window.clearTimeout(timer); };
  }, [mainView, loadBranchesData]);

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

          // normalize cue ("UI REMOVE_CABLE", "UI:REMOVE_CABLE", "REMOVE_CABLE")
          const cueNorm = String(cue || '').toUpperCase().replace(/\s+/g, ':');
          if (cueNorm === 'UI:REMOVE_CABLE' || cueNorm === 'REMOVE_CABLE') {
            setShowRemoveCable(true);

            // clear any transient failures: mark tested pins OK
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

  loop();
  return () => { cancel = true; };
}, [awaitingRelease, macAddress]);

  // Manual submit from a form/input
  const handleKfbSubmit = (e: FormEvent) => {
    e.preventDefault();
    loadBranchesData(kfbInputRef.current);
  };

  const handleManualSubmit = (submittedNumber: string) => {
    const val = submittedNumber.trim();
    if (!val) return;
    setKfbInput(val);
    setKfbNumber(val);
    loadBranchesData(val);
  };

  const handleCheck = useCallback(async () => {
    if (!branchesData.length || !macAddress) return;

    setIsChecking(true);
    setCheckFailures(null);
    setShowRemoveCable(false);
    setAwaitingRelease(true); // start watching for REMOVE_CABLE + SUCCESS

    try {
      const pins = branchesData
        .filter(b => !b.notTested && typeof b.pinNumber === 'number')
        .map(b => b.pinNumber);

      const res = await fetch('/api/serial/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pins, mac: macAddress }),
      });

      const result = await res.json();
      if (res.ok) {
        const failures: number[] = result.failures || [];
        setCheckFailures(failures);

        setBranchesData(data =>
          data.map(b => {
            if (typeof b.pinNumber !== 'number') return b;
            return failures.includes(b.pinNumber)
              ? { ...b, testStatus: 'nok' as TestStatus }
              : { ...b, testStatus: 'ok' as TestStatus };
          })
        );
      }
    } catch (err) {
      console.error('CHECK error', err);
    } finally {
      setIsChecking(false); // keep awaitingRelease until SUCCESS arrives
    }
  }, [branchesData, macAddress]);

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
              <div className="flex justify-end items-center px-8 pt-4">
                <button
                  className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl px-8 py-3 font-bold shadow-lg disabled:opacity-60 transition"
                  onClick={handleCheck}
                  disabled={isChecking || !branchesData.length || !macAddress}
                >
                  {isChecking ? 'Checking...' : 'CHECK'}
                </button>
                {checkFailures && (
                  <span className="ml-6 text-lg text-red-600">
                    {checkFailures.length ? `Failures: ${checkFailures.join(', ')}` : 'All pins OK'}
                  </span>
                )}
              </div>

              {/* NEW non-modal cue */}
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

      {/* small global style for the cable animation */}
      <style>{`
        .plug-wiggle { animation: wiggle 1s ease-in-out infinite; }
        @keyframes wiggle { 0%,100% { transform: translateX(0) } 50% { transform: translateX(8px) } }
      `}</style>
    </div>
  );
};

export default MainApplicationUI;
