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
  const [kfbInput, setKfbInput] = useState('IWTESTBOARD');
  const handleKfbSubmit = (e: FormEvent) => {
    e.preventDefault();
    loadBranchesData();
  };

const loadBranchesData = useCallback(async () => {
  if (!kfbInput) return;
  setIsScanning(true);
  setErrorMsg(null);
  setBranchesData([]);
  try {
    const res = await fetch(`/api/branches?kfb=${encodeURIComponent(kfbInput)}`);
    if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
    const data: BranchDisplayData[] = await res.json();
    setBranchesData(data);
    setKfbNumber(kfbInput.toUpperCase());
  } catch (error: any) {
    setBranchesData([]);
    setKfbNumber('');
    setErrorMsg('No branches found or failed to load.');
  } finally {
    setTimeout(() => setIsScanning(false), 300);
  }
}, [kfbInput]);


  useEffect(() => { loadBranchesData(); }, [loadBranchesData]);

  const handleCheck = useCallback(async () => {
    // … your check logic here …
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
            <BranchDashboardMainContent
              appHeaderHeight={actualHeaderHeight}
                onManualSubmit={handleManualSubmit} // <-- make sure this is present
              onScanAgainRequest={loadBranchesData}
              branchesData={branchesData}
              kfbNumber={kfbNumber}
              kfbInfo={kfbInfo}
              isScanning={isScanning}
              onResetKfb={handleResetKfb}   // <-- add this line
            />
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
