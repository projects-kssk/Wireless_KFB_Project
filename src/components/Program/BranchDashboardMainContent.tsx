// src/components/Program/BranchDashboardMainContent.tsx
import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from 'react';
import { BranchDisplayData, KfbInfo } from '@/types/types';

// --- SVG ICONS ---
const CheckCircleIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" {...props}>
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
const getStatusInfo = (status: BranchDisplayData['testStatus']) => {
  switch (status) {
    case 'ok':
      return { Icon: CheckCircleIcon, text: 'OK', color: 'text-emerald-600', bgColor: 'bg-emerald-500/10' };
    case 'nok':
      return { Icon: XCircleIcon, text: 'NOK', color: 'text-red-600', bgColor: 'bg-red-500/10' };

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
      {isNok && <div className="h-[5px] w-full bg-red-600 flex-shrink-0"></div>}
      <div className="p-8 flex-grow flex flex-col justify-between">
        <div className="flex justify-between items-center mb-6">
          <div className={`inline-flex items-center gap-4 rounded-full font-bold ${statusInfo.bgColor} ${statusInfo.color} ${isBigStatus ? 'p-5 text-4xl' : 'px-4 py-2 text-lg'}`}>
            <statusInfo.Icon className={isBigStatus ? "w-12 h-12" : "w-6 h-6"} />
            <span>{statusInfo.text}</span>
          </div>
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

/** rename this so it matches your component */
export interface BranchDashboardMainContentProps {
  onScanAgainRequest: () => void;
  /** height of the header bar so content can offset beneath it */
  appHeaderHeight: string;
  branchesData: BranchDisplayData[];
  isScanning: boolean;
  kfbNumber: string;
  kfbInfo: KfbInfo | null;
}

const BranchDashboardMainContent: React.FC<BranchDashboardMainContentProps> = ({
  appHeaderHeight,
  onScanAgainRequest,
  branchesData,
  isScanning,
  kfbNumber,
  kfbInfo,
}) => {
  const [hasMounted, setHasMounted] = useState(false);
  const [showOkAnimation, setShowOkAnimation] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => { setHasMounted(true); }, []);

  const pending = useMemo(() =>
    branchesData
      .filter((b) => b.testStatus !== 'ok')
      .sort((a, b) =>
        ({ nok: 0, not_tested: 1, in_progress: 2, ok: 3 }[a.testStatus] -
         { nok: 0, not_tested: 1, in_progress: 2, ok: 3 }[b.testStatus])
      )
      .slice(0, 40),
  [branchesData]);

  const allOk = useMemo(
    () => hasMounted && pending.length === 0 && branchesData.length > 0,
    [hasMounted, pending, branchesData]
  );

  useEffect(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (allOk) {
      setShowOkAnimation(true);
      timeoutRef.current = setTimeout(() => setShowOkAnimation(false), 5000);
    } else {
      setShowOkAnimation(false);
    }
    return () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); };
  }, [allOk]);

  const handleScan = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setShowOkAnimation(false);
    onScanAgainRequest();
  }, [onScanAgainRequest]);

  const mainContent = () => {
    if (isScanning && branchesData.length > 0) {
      return (
        <div className="flex flex-col items-center justify-center h-full min-h-[500px]">
          <h2 className="text-7xl text-slate-600 font-bold uppercase tracking-wider animate-pulse">
            SELF CHECKING...
          </h2>
        </div>
      );
    }

    if (showOkAnimation) {
      return (
        <div className="p-10 text-center w-full flex flex-col items-center justify-center">
          <div className="relative">
            <div className="w-80 h-80 sm:w-[350px] sm:h-[350px] bg-green-100 dark:bg-green-700/30 rounded-full flex items-center justify-center animate-pulse">
              <CheckCircleIcon className="w-150 h-150 sm:w-160 sm:h-160 text-green-600 dark:text-green-400" />
            </div>
          </div>
          <h3 className="p-10 font-black text-green-500 uppercase tracking-widest text-8xl sm:text-9xl">
            OK
          </h3>
        </div>
      );
    }

    if (hasMounted && branchesData.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center h-full min-h-[500px] bg-white/50 rounded-2xl border-4 border-dashed border-slate-400 p-10 cursor-pointer hover:border-blue-500 hover:bg-white transition-all duration-300" onClick={handleScan}>
          <BarcodeIcon className="w-[500px] h-[250px] text-slate-400 mb-8" />
          <p className="text-7xl text-slate-500 font-semibold uppercase tracking-wider">
            Please Scan KFB BOARD
          </p>
          {isScanning && <p className="text-slate-500 mt-4 text-6xl animate-pulse">Scanning…</p>}
        </div>
      );
    }

    return (
      <div className="flex flex-wrap justify-center items-start gap-8 w-full">
        {pending.map((branch) => (
          <BranchCard key={branch.id} branch={branch} />
        ))}
      </div>
    );
  };

  return (
    <div className="flex-grow flex flex-col items-center justify-start p-8" style={{ paddingTop: appHeaderHeight }}>
      <header className="w-full text-center mb-12 min-h-[108px]">
        <h1 className="text-9xl font-bold uppercase tracking-wider text-slate-700">
          {kfbInfo?.board ?? kfbNumber}
        </h1>
      </header>
      {mainContent()}
      <style>{`
        .animate-pulse-gray-background {
          animation: pulse-gray 2s cubic-bezier(.4,0,.6,1) infinite;
        }
        @keyframes pulse-gray {
          0%,100% { opacity: .2 }
          50% { opacity: .05 }
        }
      `}</style>
    </div>
  );
};

export default BranchDashboardMainContent;
