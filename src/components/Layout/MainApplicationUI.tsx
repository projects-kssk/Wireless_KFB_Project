// src/components/MainApplicationUI.tsx
import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  FormEvent,
} from 'react';
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

  // Manual check state
  const [checkFailures, setCheckFailures] = useState<number[] | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [latchPinFailures, setLatchPinFailures] = useState<number[]>([]);

  // Settings flow
  const [currentConfigIdForProgram, setCurrentConfigIdForProgram] = useState<number | null>(null);

  // KFB input (from scanner or manual)
  const [kfbInput, setKfbInput] = useState('');

  // Refs to avoid dependency churn in effects
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
    setLatchPinFailures([]); // Reset on every scan

    try {
      // a) Fetch branches
      const res = await fetch(`/api/branches?kfb=${encodeURIComponent(kfb)}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
      const data: BranchDisplayData[] = await res.json();
      setBranchesData(data);
      setKfbNumber(kfb.toUpperCase());

      // b) Fetch config (MAC, KFB Info)
      const cfgRes = await fetch(`/api/configurations?kfb=${encodeURIComponent(kfb)}`, { cache: 'no-store' });
      if (!cfgRes.ok) throw new Error(`Failed to fetch configuration: ${cfgRes.status}`);
      const { mac_address, kfb_info } = await cfgRes.json();
      setMacAddress(mac_address);
      setKfbInfo(kfb_info);

      // c) Extract pins for monitoring from *data*, not branchesData!
      const latchPins = data
        .filter(b => b.looseContact && !b.notTested && typeof b.pinNumber === 'number')
        .map(b => b.pinNumber);

      const normalPins = data
        .filter(b => !b.looseContact && !b.notTested && typeof b.pinNumber === 'number')
        .map(b => b.pinNumber);

      const pins = [...latchPins, ...normalPins];

      // d) POST to serial for monitoring (send to ESP)
      const serialRes = await fetch('/api/serial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ normalPins, latchPins, mac: mac_address }),
      });
      if (!serialRes.ok) {
        throw new Error(`Serial POST failed: ${await serialRes.text()}`);
      }

      // e) Initial check for ALL pins (normal + latch)
      const initialRes = await fetch('/api/serial/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pins, mac: mac_address }),
      });
      const initialResult = await initialRes.json();
      const failures: number[] = initialResult.failures || [];

      // Save latch pin failures for later re-checks
      setLatchPinFailures(failures.filter(p => latchPins.includes(p)));

      // Set branch statuses for UI
      setBranchesData(d =>
        d.map(b => {
          if (typeof b.pinNumber !== 'number') return b;
          return failures.includes(b.pinNumber)
            ? { ...b, testStatus: 'nok' as TestStatus }
            : { ...b, testStatus: 'ok' as TestStatus };
        })
      );
    } catch (error: any) {
      setBranchesData([]);
      setKfbNumber('');
      setKfbInfo(null);
      setMacAddress('');
      setLatchPinFailures([]);
      setErrorMsg('No branches found or failed to load.');
      console.error('Load/MONITOR error:', error);
    } finally {
      // small delay for UX
      setTimeout(() => setIsScanning(false), 300);
    }
  }, []);

  // Poll the scanner endpoint for new codes (server clears after each read)
  useEffect(() => {
    if (mainView !== 'dashboard') return;

    let stopped = false;
    let timer: number | null = null;

    const tick = async () => {
      try {
        // Avoid overlapping scans
        if (isScanningRef.current) {
          // try again shortly
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
        } else {
          // Non-200 from scanner endpoint — surface a hint (optional)
          // const txt = await res.text();
          // setErrorMsg(`Scanner endpoint error: ${res.status}`);
        }
      } catch (e) {
        console.error('[SCANNER] poll error', e);
      } finally {
        if (!stopped) timer = window.setTimeout(tick, 250);
      }
    };

    tick(); // start polling immediately
    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [mainView, loadBranchesData]);

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

    try {
      const pins = branchesData
        .map(b => b.pinNumber)
        .filter((p): p is number => typeof p === 'number');

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
            if (failures.includes(b.pinNumber)) {
              return { ...b, testStatus: 'nok' as TestStatus };
            }
            return { ...b, testStatus: 'ok' as TestStatus };
          })
        );
      }
    } catch (err: any) {
      // optionally surface error
    } finally {
      setIsChecking(false);
    }
  }, [branchesData, macAddress]);

  // Layout helpers
  const actualHeaderHeight = '4rem';
  const leftOffset =
    mainView === 'dashboard' && isLeftSidebarOpen ? SIDEBAR_WIDTH : '0';

  const appCurrentViewType =
    mainView === 'settingsConfiguration' || mainView === 'settingsBranches'
      ? 'settings'
      : 'main';

  const toggleLeftSidebar = () => setIsLeftSidebarOpen(v => !v);
  const toggleSettingsSidebar = () => setIsSettingsSidebarOpen(v => !v);
  const showDashboard = () => setMainView('dashboard');
  const showConfig = () => {
    setMainView('settingsConfiguration');
    setIsLeftSidebarOpen(false);
  };
  const showBranchesSettings = (id?: number) => {
    if (id != null) setCurrentConfigIdForProgram(id);
    setMainView('settingsBranches');
    setIsLeftSidebarOpen(false);
  };

  const handleHeaderClick = () => {
    if (appCurrentViewType === 'settings') {
      showDashboard();
      setIsSettingsSidebarOpen(false);
    } else {
      toggleSettingsSidebar();
    }
  };

  return (
    <div className="relative flex min-h-screen bg-slate-100 dark:bg-slate-900">
      {mainView === 'dashboard' && (
        <BranchControlSidebar
          isOpen={isLeftSidebarOpen}
          toggleSidebar={toggleLeftSidebar}
          branches={branchesData}
          onSetStatus={(id, status) =>
            setBranchesData(data =>
              data.map(b => (b.id === id ? { ...b, testStatus: status } : b))
            )
          }
          sidebarWidthProvided={SIDEBAR_WIDTH}
          appHeaderHeight={actualHeaderHeight}
        />
      )}

      <div
        className="flex flex-1 flex-col transition-all"
        style={{ marginLeft: leftOffset }}
      >
        <Header
          onSettingsClick={handleHeaderClick}
          currentView={appCurrentViewType}
          isSidebarOpen={isLeftSidebarOpen && mainView === 'dashboard'}
          onToggleSidebar={toggleLeftSidebar}
        />

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
                    {checkFailures.length
                      ? `Failures: ${checkFailures.join(', ')}`
                      : 'All pins OK'}
                  </span>
                )}
              </div>

              {errorMsg && (
                <div className="px-8 pt-2 text-sm text-red-600">
                  {errorMsg}
                </div>
              )}

              <BranchDashboardMainContent
                appHeaderHeight={actualHeaderHeight}
                onManualSubmit={handleManualSubmit}
                onScanAgainRequest={() => loadBranchesData()} // uses ref-backed current value
                branchesData={branchesData}
                kfbNumber={kfbNumber}
                kfbInfo={kfbInfo}
                isScanning={isScanning}
                onResetKfb={handleResetKfb}
              />
            </>
          ) : mainView === 'settingsConfiguration' ? (
            <SettingsPageContent
              onNavigateBack={showDashboard}
              onShowProgramForConfig={showBranchesSettings}
            />
          ) : (
            <SettingsBranchesPageContent
              onNavigateBack={showDashboard}
              configId={currentConfigIdForProgram}
            />
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
    </div>
  );
};

export default MainApplicationUI;
