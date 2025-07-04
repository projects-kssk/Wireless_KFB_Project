import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  FormEvent,
} from 'react';

// --- TYPE DEFINITIONS ---
type TestStatus = 'ok' | 'nok' | 'not_tested' | 'in_progress';

interface BranchDisplayData {
  id: string;
  branchName: string;
  testStatus: TestStatus;
  pinNumber?: number | null;
}

interface KfbInfo {
    board: string;
    projectName: string;
    kfbId: string;
}

// --- SVG ICONS ---
const CheckCircleIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      {...props}
    >
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
       <text x="50" y="47" fontSize="6" textAnchor="middle" fill="currentColor">IW15387663458</text>
    </g>
  </svg>
);

// --- HELPER FUNCTIONS ---
const getStatusInfo = (status: TestStatus) => {
  switch (status) {
    case 'ok':
      return { Icon: CheckCircleIcon, text: 'OK', color: 'text-emerald-600', bgColor: 'bg-emerald-500/10' };
    case 'nok':
      return { Icon: XCircleIcon, text: 'NOK', color: 'text-red-600', bgColor: 'bg-red-500/10' };
    case 'in_progress':
      return { Icon: ClockIcon, text: 'In Progress', color: 'text-blue-600', bgColor: 'bg-blue-500/10' };
    default: // not_tested
      return { Icon: HelpCircleIcon, text: 'Not Tested', color: 'text-slate-600', bgColor: 'bg-slate-500/10' };
  }
};

// --- CHILD COMPONENT: BRANCH CARD ---
const BranchCard = ({ branch }: { branch: BranchDisplayData }) => {
  const statusInfo = useMemo(() => getStatusInfo(branch.testStatus), [branch.testStatus]);
  const isNok = branch.testStatus === 'nok';
  const isBigStatus = branch.testStatus === 'nok' || branch.testStatus === 'not_tested';

  return (
    <div
      key={branch.id}
      className="group relative w-full max-w-[520px] rounded-2xl bg-white backdrop-blur-sm shadow-xl hover:shadow-2xl border-2 border-transparent hover:border-blue-500 transition-all duration-300 transform hover:-translate-y-2 flex flex-col overflow-hidden"
    >
      {/* Conditionally add a 5px red bar at the top for 'nok' status. */}
      {isNok && <div className="h-[5px] w-full bg-red-600 flex-shrink-0"></div>}
      
      <div className="p-8 flex-grow flex flex-col justify-between">
        <div className="flex justify-between items-center mb-6">
          {/* Status display */}
          <div className={`inline-flex items-center gap-4 rounded-full font-bold ${statusInfo.bgColor} ${statusInfo.color} ${isBigStatus ? 'p-5 text-4xl' : 'px-4 py-2 text-lg'}`}>
            <statusInfo.Icon className={isBigStatus ? "w-12 h-12" : "w-6 h-6"} />
            <span>{statusInfo.text}</span>
          </div>
          
          {/* Improved PIN Display */}
          {branch.pinNumber != null && (
            <div className="flex items-center gap-3 text-right">
                <span className="text-3xl font-medium text-slate-400">PIN</span>
                <span className="bg-slate-100 text-slate-800 font-mono rounded-full w-20 h-20 flex items-center justify-center text-5xl font-bold">
                    {branch.pinNumber}
                </span>
            </div>
          )}
        </div>
        <h3 className="text-7xl font-bold text-slate-800 group-hover:text-blue-600 transition-colors duration-300 mt-6 text-center">
          {branch.branchName}
        </h3>
      </div>
    </div>
  );
};


// --- CHILD COMPONENT: BRANCH DASHBOARD MAIN CONTENT ---
interface DashboardProps {
  onScanAgainRequest: () => void;
  branchesData: BranchDisplayData[];
  isScanning: boolean;
  kfbNumber: string;
  kfbInfo: KfbInfo | null;
}

export const BranchDashboardMainContent: React.FC<DashboardProps> = ({
  onScanAgainRequest,
  branchesData,
  isScanning,
  kfbNumber,
  kfbInfo,
}) => {
  const [hasMounted, setHasMounted] = useState(false);
  const [showOkAnimation, setShowOkAnimation] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => { setHasMounted(true) }, []);

  const pending = useMemo(() =>
    branchesData
      .filter((b) => b.testStatus !== 'ok')
      .sort((a,b) => ({nok:0,not_tested:1,in_progress: 2, ok:3}[a.testStatus] - ({nok:0,not_tested:1,in_progress: 2, ok:3}[b.testStatus])))
      .slice(0,40),
  [branchesData]);

  const allOk = useMemo(
    () => hasMounted && pending.length === 0 && branchesData.length > 0,
    [hasMounted, pending, branchesData]
  );

  useEffect(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (allOk) {
      setShowOkAnimation(true);
      // The parent component now handles the reset, so we just control the animation visibility
      timeoutRef.current = setTimeout(() => setShowOkAnimation(false), 5000);
    } else {
      setShowOkAnimation(false);
    }
    return () => { if (timeoutRef.current) clearTimeout(timeoutRef.current) };
  }, [allOk]);

  const handleScan = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setShowOkAnimation(false);
    onScanAgainRequest();
  }, [onScanAgainRequest]);

  const mainContent = () => {
    // 1. When the check is actively running (isScanning is true after an initial load)
    if (isScanning && branchesData.length > 0) {
      return (
        <div className="flex flex-col items-center justify-center h-full min-h-[500px]">
          <h2 className="text-7xl text-slate-600 font-bold uppercase tracking-wider animate-pulse">
            SELF CHECKING...
          </h2>
        </div>
      );
    }

    // 2. When the check is complete and all are OK, show the success animation
    if (showOkAnimation) {
      return (
        <div className="p-10 text-center w-full flex flex-col items-center justify-center">
            <div className="relative">
            {/* Outer pulsating green circle */}
            <div className="relative">
                {/* Outer pulsating green circle */}
                <div className="w-80 h-80 sm:w-[350px] sm:h-[350px] bg-green-100 dark:bg-green-700/30 rounded-full flex items-center justify-center animate-pulse">
                  {/* Inner white circle */}
                    {/* White Pipe */}
                      <CheckCircleIcon className="w-150 h-150 sm:w-160 sm:h-160 text-green-600 dark:text-green-400" />  {/* CheckCircleIcon with adjusted size */}
                </div>
              </div>
            </div>
            <h3 className="p-10 font-black text-green-500 uppercase tracking-widest text-8xl sm:text-9xl">
                OK
            </h3>
        </div>
      );
    }

    // 3. Initial state, before the first scan
    if (hasMounted && branchesData.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center h-full min-h-[500px] bg-white/50 rounded-2xl border-4 border-dashed border-slate-400 p-10 cursor-pointer hover:border-blue-500 hover:bg-white transition-all duration-300" onClick={handleScan}>
          <BarcodeIcon className="w-[500px] h-[250px] text-slate-400 mb-8" />
          <p className="text-7xl text-slate-500 font-bold uppercase tracking-wider">
            Please Scan KFB BOARD
          </p>
          {isScanning && <p className="text-slate-500 mt-4 text-6xl animate-pulse">Scanning…</p>}
        </div>
      );
    }
    
    // 4. Default view: show the list of branches with failures or not tested
    return (
      <div className="flex flex-wrap justify-center items-start gap-8 w-full">
        {pending.map((branch) => (
          <BranchCard key={branch.id} branch={branch} />
        ))}
      </div>
    );
  };

  return (
    <div className="flex-grow flex flex-col items-center justify-start p-8">
        <header className="w-full text-center mb-12 min-h-[108px]"> {/* Added min-height to prevent layout shift */}
            <h1 className="text-9xl font-bold uppercase tracking-wider text-slate-700">
            {kfbInfo?.board ?? kfbNumber}
            </h1>
        </header>
             {mainContent()}
      <style>{`.animate-pulse-gray-background { animation: pulse-gray 2s cubic-bezier(.4,0,.6,1) infinite; } @keyframes pulse-gray { 0%,100%{ opacity:.2 } 50%{ opacity:.05 } }`}</style>
    </div>
  );
};

// --- MAIN APPLICATION COMPONENT ---
const App: React.FC = () => {
  // Function to get initial KFB value from URL. Runs only once.
  const getInitialKfbFromUrl = () => {
    if (typeof window === 'undefined') {
      return '';
    }
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('kfb') || '';
  };

  const [branchesData, setBranchesData] = useState<BranchDisplayData[]>([]);
  const [kfbNumber, setKfbNumber] = useState<string>('');
  const [kfbInfo, setKfbInfo] = useState<KfbInfo | null>(null);
  const [macAddress, setMacAddress] = useState<string>('');
  const [isScanning, setIsScanning] = useState(false);
  // Initialize state directly with the value from the URL.
  const [kfbInput, setKfbInput] = useState<string>(getInitialKfbFromUrl());

  const handleKfbSubmit = (e: FormEvent) => {
    e.preventDefault();
    loadBranchesData();
  };

  const loadBranchesData = useCallback(async () => {
    if (!kfbInput) return;
    setIsScanning(true);
    setBranchesData([]);
    setKfbNumber('');
    setMacAddress('');
    setKfbInfo(null);

    try {
      // a) Fetch branches
      const brResponse = await fetch(`/api/branches?kfb=${encodeURIComponent(kfbInput)}`);
      if (!brResponse.ok) throw new Error(`Failed to fetch branches: ${await brResponse.text()}`);
      const branches: BranchDisplayData[] = await brResponse.json();
      
      // b) Fetch config (MAC and KFB Info)
      const cfgResponse = await fetch(`/api/configurations?kfb=${encodeURIComponent(kfbInput)}`);
      if (!cfgResponse.ok) throw new Error(`Failed to fetch configuration: ${await cfgResponse.text()}`);
      const { mac_address, kfb_info } = await cfgResponse.json();

      setBranchesData(branches);
      setKfbNumber(kfbInput);
      setMacAddress(mac_address);
      setKfbInfo(kfb_info);

      // c) Extract pins for monitoring
      const pins = branches
        .map((b) => b.pinNumber)
        .filter((p): p is number => typeof p === 'number');

      console.log('▶️ MONITOR pins:', pins, 'MAC:', mac_address);

      // d) POST to serial for monitoring
      await fetch('/api/serial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pins, mac: mac_address }),
      });

    } catch (err: any) {
      console.error('Load/MONITOR error:', err);
      // Clear all data on failure to allow for a new scan
      setBranchesData([]);
      setKfbNumber('');
      setMacAddress('');
      setKfbInfo(null);
    } finally {
      setTimeout(() => setIsScanning(false), 500);
    }
  }, [kfbInput]);
  
  const handleCheck = useCallback(async () => {
    if (!macAddress) return;
    setIsScanning(true);
    try {
      const pins = branchesData.map(b => b.pinNumber).filter((p): p is number => p != null);
      const res = await fetch('/api/serial/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pins, mac: macAddress }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { failures }: { failures: number[] } = await res.json();

      if (failures.length === 0) {
        // On success, first update the status to trigger the 'allOk' animation
        setBranchesData(prev => prev.map(b => ({ ...b, testStatus: 'ok' as TestStatus })));

        // After the animation duration, reset the entire application state
        setTimeout(() => {
          setBranchesData([]);
          setKfbNumber('');
          setKfbInfo(null);
          setMacAddress('');
          setKfbInput(''); // Clear the input field for the next scan
        }, 5000); // This must match the animation timeout

      } else {
        setBranchesData(prev => prev.map(b => ({
          ...b,
          testStatus: failures.includes(b.pinNumber ?? -1) ? 'nok' : 'ok',
        })));
      }
    } catch (err) {
      console.error('CHECK error:', err);
    } finally {
      setTimeout(() => setIsScanning(false), 500);
    }
  }, [branchesData, macAddress]);

  // This useEffect now handles the initial data load since kfbInput is set from the start.
  useEffect(() => {
    if(kfbInput) {
        loadBranchesData();
    }
  }, [kfbInput, loadBranchesData]);

  return (
      <div className="min-h-screen w-full bg-slate-200 flex flex-col overflow-hidden font-sans">
        <div className="p-3 bg-white border-b border-slate-300 flex-shrink-0 backdrop-blur-sm shadow-sm z-10">
          <form onSubmit={handleKfbSubmit} className="flex flex-wrap gap-4 items-center">
            <div className="flex items-center gap-2">
              <label className="font-semibold text-slate-600">KFB:</label>
              <input
                type="text"
                value={kfbInput}
                onChange={(e) => setKfbInput(e.target.value)}
                placeholder="Scan or enter KFB..."
                className="px-3 py-2 w-48 bg-slate-100 text-slate-900 border-2 border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
              />
              <button type="submit" disabled={isScanning} className="px-4 py-2 font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed shadow-md hover:shadow-lg transition-all">
                {isScanning && branchesData.length === 0 ? 'Loading…' : 'Load'}
              </button>
              <button type="button" onClick={handleCheck} disabled={isScanning || !macAddress} className="px-4 py-2 font-semibold bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-60 disabled:cursor-not-allowed shadow-md hover:shadow-lg transition-all">
                {isScanning && branchesData.length > 0 ? 'Checking…' : 'Check'}
              </button>
            </div>
            {kfbInfo && (
              <div className="flex items-center gap-x-6 gap-y-2 flex-wrap border-l-2 pl-4 ml-2 border-slate-300">
                  <div className="flex items-baseline space-x-2">
                      <span className="font-bold text-sm text-slate-500">BOARD:</span>
                      <span className="text-slate-800 font-medium">{kfbInfo.board}</span>
                  </div>
                   <div className="flex items-baseline space-x-2">
                      <span className="font-bold text-sm text-slate-500">NAME:</span>
                      <span className="text-slate-800 font-medium">{kfbInfo.projectName}</span>
                  </div>
                   <div className="flex items-baseline space-x-2">
                      <span className="font-bold text-sm text-slate-500">KFB-ID:</span>
                      <span className="text-slate-800 font-medium">{kfbInfo.kfbId}</span>
                  </div>
              </div>
            )}
          </form>
        </div>

        <div className="flex-1 bg-slate-200 overflow-y-auto">
          <BranchDashboardMainContent
            branchesData={branchesData}
            onScanAgainRequest={loadBranchesData}
            isScanning={isScanning}
            kfbNumber={kfbNumber}
            kfbInfo={kfbInfo}
          />
        </div>
      </div>
  );
};

export default App;
