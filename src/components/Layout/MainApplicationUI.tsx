// src/components/MainApplicationUI.tsx
import React, {
  useState,
  useEffect,
  useCallback,
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
const [checkFailures, setCheckFailures] = useState<number[] | null>(null);
const [isChecking, setIsChecking] = useState(false);
  const [latchPinFailures, setLatchPinFailures] = useState<number[]>([]);
  // Data state
  
  const [branchesData, setBranchesData] = useState<BranchDisplayData[]>([]);
  const [kfbNumber, setKfbNumber] = useState('');
  const [kfbInfo, setKfbInfo] = useState<KfbInfo | null>(null);
  const [macAddress, setMacAddress] = useState('');
  const [isScanning, setIsScanning] = useState(false);
const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // Settings flow
  const [currentConfigIdForProgram, setCurrentConfigIdForProgram] = useState<number|null>(null);
const handleResetKfb = () => {
  setKfbNumber('');
  setKfbInfo(null);
  setBranchesData([]);
  setKfbInput('');
};

  // KFB input
  const [kfbInput, setKfbInput] = useState('');
  const handleKfbSubmit = (e: FormEvent) => {
    e.preventDefault();
    loadBranchesData();
  };
const loadBranchesData = useCallback(async () => {
  if (!kfbInput) return;
  setIsScanning(true);
  setErrorMsg(null);
  setBranchesData([]);
  setKfbInfo(null);
  setKfbNumber('');
  setMacAddress('');
  setLatchPinFailures([]); // Reset on every scan

  try {
    // a) Fetch branches
    const res = await fetch(`/api/branches?kfb=${encodeURIComponent(kfbInput)}`);
    if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
    const data: BranchDisplayData[] = await res.json();
    setBranchesData(data);
    setKfbNumber(kfbInput.toUpperCase());

    // b) Fetch config (MAC, KFB Info)
    const cfgRes = await fetch(`/api/configurations?kfb=${encodeURIComponent(kfbInput)}`);
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
    setBranchesData(data =>
      data.map(b => {
        if (typeof b.pinNumber !== 'number') return b;
        if (failures.includes(b.pinNumber)) {
          return { ...b, testStatus: 'nok' as TestStatus };
        }
        return { ...b, testStatus: 'ok' as TestStatus };
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
    setTimeout(() => setIsScanning(false), 300);
  }
}, [kfbInput, setLatchPinFailures]);

const handleCheck = useCallback(async () => {
  if (!branchesData.length || !macAddress) return;
  setIsChecking(true);
  setCheckFailures(null);

  try {
    const pins = branchesData
      .map(b => b.pinNumber)
      .filter((p): p is number => typeof p === 'number');

    const res = await fetch("/api/serial/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pins, mac: macAddress }),
    });
    const result = await res.json();

    if (res.ok) {
      const failures: number[] = result.failures || [];
      setCheckFailures(failures);

      setBranchesData(data =>
        data.map(b => {
          if (typeof b.pinNumber !== "number") return b;
          if (failures.includes(b.pinNumber)) {
            return { ...b, testStatus: "nok" as TestStatus };
          }
          return { ...b, testStatus: "ok" as TestStatus };
        })
      );
    }
  } catch (err: any) {
    // handle error if needed
  } finally {
    setIsChecking(false);
  }
}, [branchesData, macAddress]);





  const handleSetBranchStatus = useCallback((id: string, status: TestStatus) => {
    setBranchesData(data =>
      data.map(b => b.id === id ? { ...b, testStatus: status } : b)
    );
  }, []);

  // Layout helpers
  const actualHeaderHeight = '4rem';
  const leftOffset =
    mainView === 'dashboard' && isLeftSidebarOpen
      ? SIDEBAR_WIDTH
      : '0';

  const appCurrentViewType =
    mainView === 'settingsConfiguration' || mainView === 'settingsBranches'
      ? 'settings'
      : 'main';
const handleManualSubmit = (submittedNumber: string) => {
  setKfbInput(submittedNumber);
  setKfbNumber(submittedNumber);
  loadBranchesData();
};

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
          onSetStatus={handleSetBranchStatus}
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
            {isChecking ? "Checking..." : "CHECK"}
          </button>
          {checkFailures && (
            <span className="ml-6 text-lg text-red-600">
              {checkFailures.length
                ? `Failures: ${checkFailures.join(", ")}`
                : "All pins OK"}
            </span>
          )}
        </div>
        <BranchDashboardMainContent
          appHeaderHeight={actualHeaderHeight}
          onManualSubmit={handleManualSubmit}
          onScanAgainRequest={loadBranchesData}
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
