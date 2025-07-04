import React, {
  useState,
  useEffect,
  useCallback,
  FormEvent,
} from 'react';

// --- TYPE IMPORTS ---
// Import shared types from a central location to ensure consistency across components.
// This resolves the error by using the same type definition as BranchControlSidebar.
import { BranchDisplayData, KfbInfo, TestStatus } from '@/types/types';

import { Header } from '@/components/Header/Header';
import { BranchControlSidebar } from '@/components/Program/BranchControlSidebar';
import { SettingsRightSidebar } from '@/components/Settings/SettingsRightSidebar';
import { SettingsPageContent } from '@/components/Settings/SettingsPageContent';
import { SettingsBranchesPageContent } from '@/components/Settings/SettingsBranchesPageContent';
import BranchDashboardMainContent from '@/components/Program/BranchDashboardMainContent';

// --- MAIN COMPONENTS ---

// The local definitions for TestStatus, BranchDisplayData, and KfbInfo have been removed.
// They are now imported from '@/types/types' to match the types expected by child components.

const BarcodeIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg {...props} viewBox="0 0 100 50" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="0" width="100" height="50" rx="5" fill="currentColor" className="animate-pulse-gray-background"/>
    <g fill="currentColor">
      {[10,14,17,22,26,29,34,38,41,46,50,53,58,62,65,70,74,77,82,86].map((x,i) => (
        <rect key={i} x={x} y="10" width={i%3===2?3:i%2===1?1:2} height="30" />
      ))}
      <text x="50" y="47" fontSize="5" textAnchor="middle">1 7 2 3 6 4 8 5</text>
    </g>
  </svg>
);

// Props interface for the main dashboard content area.
interface DashboardProps {
  appHeaderHeight: string;
  onScanAgainRequest: () => void;
  branchesData: BranchDisplayData[];
  kfbNumber: string;
  kfbInfo: KfbInfo | null;
  isScanning: boolean;
}

const SIDEBAR_WIDTH = '24rem';
type MainView = 'dashboard' | 'settingsConfiguration' | 'settingsBranches';

const MainApplicationUI: React.FC = () => {
  // navigation
  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(false);
  const [isSettingsSidebarOpen, setIsSettingsSidebarOpen] = useState(false);
  const [mainView, setMainView] = useState<MainView>('dashboard');

  // data - Now correctly typed using the imported BranchDisplayData
  const [branchesData, setBranchesData] = useState<BranchDisplayData[]>([]);
  const [kfbNumber, setKfbNumber] = useState<string>('');
  const [kfbInfo, setKfbInfo] = useState<KfbInfo | null>(null);
  const [macAddress, setMacAddress] = useState<string>('');
  const [isScanning, setIsScanning] = useState(false);

  // settings
  const [currentConfigIdForProgram, setCurrentConfigIdForProgram] = useState<number | null>(null);

  // KFB input
  const [kfbInput, setKfbInput] = useState<string>('IWTESTBOARD');
  const handleKfbSubmit = (e: FormEvent) => {
    e.preventDefault();
    loadBranchesData();
  };

  const loadBranchesData = useCallback(async () => {
    if (!kfbInput) return;
    setIsScanning(true);
    try {
      console.log(`Fetching data for KFB: ${kfbInput}`);
      // MOCK API CALLS
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Mock fetching branches - this data is compatible with the stricter, imported type
      const mockBranches: BranchDisplayData[] = [
        { id: '1', branchName: 'BRANCH_1', testStatus: 'nok', pinNumber: 1 },
        { id: '2', branchName: 'BRANCH_2', testStatus: 'not_tested', pinNumber: 2 },
        { id: '3', branchName: 'BRANCH_3', testStatus: 'not_tested', pinNumber: 3 },
      ];
      
      // Mock fetching KFB info
      const mockKfbInfo: KfbInfo = { 
          board: "PNL_A52", 
          projectName: "Main Board Rev 2", 
          kfbId: "78A4-11B3" 
      };

      // Mock fetching MAC address
      const mockMacAddress = "00:1B:44:11:3A:B7";
      
      setBranchesData(mockBranches);
      setKfbNumber(kfbInput);
      setKfbInfo(mockKfbInfo);
      setMacAddress(mockMacAddress);

    } catch (err: any) {
      console.error('Load/MONITOR error:', err);
      setBranchesData([]);
      setKfbNumber('');
      setMacAddress('');
      setKfbInfo(null);
    } finally {
      setTimeout(() => setIsScanning(false), 500);
    }
  }, [kfbInput]);
  
  useEffect(() => { loadBranchesData(); }, [loadBranchesData]);

  const handleCheck = useCallback(async () => { /* ... check logic ... */ }, [branchesData, macAddress]);
  const handleSetBranchStatus = useCallback((branchId: string, newStatus: TestStatus) => { /* ... status logic ... */ }, []);

  // navigation handlers
  const toggleLeftSidebar = () => setIsLeftSidebarOpen((v) => !v);
  const toggleSettingsSidebar = () => setIsSettingsSidebarOpen((v) => !v);
  const showDashboard = () => setMainView('dashboard');
  const showConfigurationInMain = () => {
    setMainView('settingsConfiguration');
    setIsLeftSidebarOpen(false);
  };
  const showBranchesSettingsInMain = (configId?: number) => {
    if (typeof configId === 'number') setCurrentConfigIdForProgram(configId);
    setMainView('settingsBranches');
    setIsLeftSidebarOpen(false);
  };

  const [windowWidth, setWindowWidth] = useState(0);
  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const appCurrentViewType = mainView === 'settingsConfiguration' || mainView === 'settingsBranches' ? 'settings' : 'main';
  const handleHeaderMainButtonClick = () => {
    if (appCurrentViewType === 'settings') {
      showDashboard();
      setIsSettingsSidebarOpen(false);
    } else {
      toggleSettingsSidebar();
    }
  };

  const actualHeaderHeight = '4rem'; // Height of the Header component
  const leftOffset = mainView === 'dashboard' && isLeftSidebarOpen && windowWidth >= 1024 ? SIDEBAR_WIDTH : 0;

  return (
    <div className="relative min-h-screen w-full bg-slate-100 dark:bg-slate-900 flex overflow-hidden">
      {mainView === 'dashboard' && (
        <BranchControlSidebar
          isOpen={isLeftSidebarOpen}
          toggleSidebar={toggleLeftSidebar}
          branches={branchesData} // This prop no longer causes a type error
          onSetStatus={handleSetBranchStatus}
          sidebarWidthProvided={SIDEBAR_WIDTH}
          appHeaderHeight={actualHeaderHeight}
        />
      )}

      <div className="flex flex-1 flex-col transition-all duration-300 ease-in-out" style={{ marginLeft: leftOffset, height: '100vh', overflow: 'hidden' }}>
        <Header
          onSettingsClick={handleHeaderMainButtonClick}
          currentView={appCurrentViewType}
          isSidebarOpen={isLeftSidebarOpen && mainView === 'dashboard'}
          onToggleSidebar={toggleLeftSidebar}
        />

        <div className="flex flex-col flex-1 overflow-hidden">
            <main className="flex-1 bg-gray-50 dark:bg-slate-900 overflow-y-auto" style={{ overflowX: 'hidden' }}>
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
                <SettingsPageContent onNavigateBack={showDashboard} onShowProgramForConfig={showBranchesSettingsInMain} />
              ) : (
                <SettingsBranchesPageContent onNavigateBack={showDashboard} configId={currentConfigIdForProgram} />
              )}
            </main>
        </div>
      </div>

      <SettingsRightSidebar
        isOpen={isSettingsSidebarOpen}
        onClose={() => setIsSettingsSidebarOpen(false)}
        appHeaderHeight={actualHeaderHeight}
        onShowConfigurationInMain={showConfigurationInMain}
        onShowBranchesSettingsInMain={() => showBranchesSettingsInMain()}
      />
    </div>
  )
}

export default MainApplicationUI;
