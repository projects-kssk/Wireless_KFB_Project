// src/components/Layout/MainApplicationUI.tsx

import React, {
  useState,
  useEffect,
  useCallback,
  FormEvent,
} from 'react';

import type { TestStatus, BranchDisplayData }        from '@/types/types';

import { appConfig }                  from '@/components/config/appConfig';
import { Header }                     from '@/components/Header/Header';
import { SettingsRightSidebar }       from '@/components/Settings/SettingsRightSidebar';
import { SettingsPageContent }        from '@/components/Settings/SettingsPageContent';
import { SettingsBranchesPageContent }from '@/components/Settings/SettingsBranchesPageContent';
import { BranchControlSidebar }       from '@/components/Program/BranchControlSidebar';
import { BranchDashboardMainContent } from '@/components/Program/BranchDashboardMainContent';

const SIDEBAR_WIDTH = '24rem';
type MainView = 'dashboard' | 'settingsConfiguration' | 'settingsBranches';

const MainApplicationUI: React.FC = () => {
  // ---- UI State ----
  const [isLeftSidebarOpen,     setIsLeftSidebarOpen]     = useState(false);
  const [isSettingsSidebarOpen, setIsSettingsSidebarOpen] = useState(false);
  const [mainView,              setMainView]              = useState<MainView>('dashboard');

  // ---- Data State ----
  const [branchesData, setBranchesData] = useState<BranchDisplayData[]>([]);
  const [kfbNumber,   setKfbNumber]     = useState<string>('');
  const [isScanning,  setIsScanning]    = useState(false);

  // For settings → branches page
  const [currentConfigIdForProgram, setCurrentConfigIdForProgram] =
    useState<number | null>(null);

  // ---- KFB Input State ----
  const [kfbInput, setKfbInput] = useState<string>('IW0160029');

  // ---- Load Branches for current KFB ----
  const loadBranchesData = useCallback(async () => {
    if (!kfbInput) return;
    setIsScanning(true);

    try {
      const res = await fetch(`/api/branches?kfb=${encodeURIComponent(kfbInput)}`);
      if (!res.ok) {
        throw new Error(`API error ${res.status}: ${await res.text()}`);
      }
      const data: BranchDisplayData[] = await res.json();

      // We expect each item to have:
      // { id: string, branchName: string, testStatus: TestStatus, pinNumber?: number }
      setBranchesData(data);
      setKfbNumber(kfbInput);
    } catch (err) {
      console.error('Failed to load branch data:', err);
      setBranchesData([]);
      setKfbNumber('');
    } finally {
      // keep the spinner for a moment for UX
      setTimeout(() => setIsScanning(false), 500);
    }
  }, [kfbInput]);

  // Reload whenever the KFB changes
  useEffect(() => {
    loadBranchesData();
  }, [loadBranchesData]);

  // ---- Handlers ----
  const handleSetBranchStatus = useCallback(
    (branchId: string, newStatus: TestStatus) => {
      setBranchesData(prev =>
        prev.map(b => (b.id === branchId ? { ...b, testStatus: newStatus } : b))
      );
    },
    []
  );

  const handleKfbSubmit = (e: FormEvent) => {
    e.preventDefault();
    loadBranchesData();
  };

  // Sidebar / View navigation
  const toggleLeftSidebar     = () => setIsLeftSidebarOpen(o => !o);
  const toggleSettingsSidebar = () => setIsSettingsSidebarOpen(o => !o);
  const showDashboard         = () => setMainView('dashboard');
  const showConfigurationInMain = () => {
    setMainView('settingsConfiguration');
    setIsLeftSidebarOpen(false);
  };
  const showBranchesSettingsInMain = (configId?: number) => {
    if (typeof configId === 'number') setCurrentConfigIdForProgram(configId);
    setMainView('settingsBranches');
    setIsLeftSidebarOpen(false);
  };

  // Responsive layout
  const [windowWidth, setWindowWidth] = useState(0);
  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const appCurrentViewType =
    mainView === 'settingsConfiguration' || mainView === 'settingsBranches'
      ? 'settings'
      : 'main';

  const handleHeaderMainButtonClick = () => {
    if (appCurrentViewType === 'settings') {
      showDashboard();
      setIsSettingsSidebarOpen(false);
    } else {
      toggleSettingsSidebar();
    }
  };

  const actualHeaderHeight           = appConfig.hideHeader ? '0rem' : '0rem';
  const shouldLeftSidebarAffectLayout =
    mainView === 'dashboard' && isLeftSidebarOpen && windowWidth >= 1024;

  return (
    <div className="relative min-h-screen w-full bg-slate-100 dark:bg-slate-900 flex overflow-hidden">
      {/* Left-slideout branch control */}
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

      {/* Main area */}
      <div
        className="flex flex-1 flex-col transition-all duration-300 ease-in-out overflow-hidden"
        style={{ marginLeft: shouldLeftSidebarAffectLayout ? SIDEBAR_WIDTH : 0 }}
      >
        {/* Top header */}
        <Header
          onSettingsClick={handleHeaderMainButtonClick}
          currentView={appCurrentViewType}
          isSidebarOpen={isLeftSidebarOpen && mainView === 'dashboard'}
          onToggleSidebar={toggleLeftSidebar}
        />

        {/* KFB entry form */}
        {mainView === 'dashboard' && (
        <form
        onSubmit={handleKfbSubmit}
        className="p-4 bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700 flex gap-2 items-center"
      >
        <label className="font-medium text-gray-700 dark:text-slate-200">
          KFB:
        </label>
      
        <input
          type="text"
          value={kfbInput}
          onChange={e => setKfbInput(e.target.value)}
          placeholder="IW0160029"
          className="
            px-2 py-1
            bg-gray-100 dark:bg-slate-700    /* light gray bg in light mode */
            text-gray-900 dark:text-gray-100 /* dark text on that bg */
            border border-gray-300 dark:border-slate-600
            rounded-md 
            focus:outline-none focus:ring-2 focus:ring-blue-500
            placeholder-gray-500
          "
        />
      
        <button
          type="submit"
          className="px-3 py-1 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-60"
          disabled={isScanning}
        >
          {isScanning ? 'Loading…' : 'Load'}
        </button>
      
        <span className="ml-auto font-semibold text-gray-700 dark:text-slate-200">
          Loaded KFB: {kfbNumber || '—'}
        </span>
      </form>
   
       
        )}

        {/* Content */}
        <main
          className="flex-1 bg-gray-50 dark:bg-slate-900 overflow-y-auto"
          style={{ overflowX: 'hidden' }}
        >
          {mainView === 'dashboard' ? (
            <BranchDashboardMainContent
              appHeaderHeight={actualHeaderHeight}
              branchesData={branchesData}
              kfbNumber={kfbNumber}
              onScanAgainRequest={loadBranchesData}
              isScanning={isScanning}
            />
          ) : mainView === 'settingsConfiguration' ? (
            <SettingsPageContent
              onNavigateBack={showDashboard}
              onShowProgramForConfig={showBranchesSettingsInMain}
            />
          ) : (
            <SettingsBranchesPageContent
              onNavigateBack={showDashboard}
              configId={currentConfigIdForProgram}
            />
          )}
        </main>
      </div>

      {/* Right “Settings” sidebar */}
      <SettingsRightSidebar
        isOpen={isSettingsSidebarOpen}
        onClose={() => setIsSettingsSidebarOpen(false)}
        appHeaderHeight={actualHeaderHeight}
        onShowConfigurationInMain={showConfigurationInMain}
        onShowBranchesSettingsInMain={() => showBranchesSettingsInMain()}
      />
    </div>
  );
};

export default MainApplicationUI;
