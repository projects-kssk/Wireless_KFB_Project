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

  // Settings flow
  const [currentConfigIdForProgram, setCurrentConfigIdForProgram] = useState<number|null>(null);

  // KFB input
  const [kfbInput, setKfbInput] = useState('IWTESTBOARD');
  const handleKfbSubmit = (e: FormEvent) => {
    e.preventDefault();
    loadBranchesData();
  };

  // Mock / Fetch logic
  const loadBranchesData = useCallback(async () => {
    if (!kfbInput) return;
    setIsScanning(true);
    try {
      // simulate delay
      await new Promise(r => setTimeout(r, 1000));

      // stub data
      const mock: BranchDisplayData[] = [
        { id: '1', branchName: 'BRANCH_1', testStatus: 'nok', pinNumber: 1 },
        { id: '2', branchName: 'BRANCH_2', testStatus: 'not_tested', pinNumber: 2 },
        { id: '3', branchName: 'BRANCH_3', testStatus: 'not_tested', pinNumber: 3 },
      ];
      const mockInfo: KfbInfo = {
        board: 'PNL_A52',
        projectName: 'Main Board Rev 2',
        kfbId: '78A4-11B3',
      };
      const mockMac = '00:1B:44:11:3A:B7';

      setBranchesData(mock);
      setKfbNumber(kfbInput);
      setKfbInfo(mockInfo);
      setMacAddress(mockMac);
    } catch {
      setBranchesData([]);
      setKfbNumber('');
      setMacAddress('');
      setKfbInfo(null);
    } finally {
      setTimeout(() => setIsScanning(false), 500);
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
              onScanAgainRequest={loadBranchesData}
              branchesData={branchesData}
              kfbNumber={kfbNumber}
              kfbInfo={kfbInfo}
              isScanning={isScanning}
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
