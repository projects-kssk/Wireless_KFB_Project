import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'; // Added useRef
import type { TestStatus, SubStatus } from '@/types/types';
import type { BranchDisplayData } from '@/types/types'

// Mock CheckCircleIcon component (no longer directly used in the OK animation, but kept for type safety if needed elsewhere)
const CheckCircleIcon = (props: React.SVGProps<SVGSVGElement>) => (
<svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor" // The circle will be filled with the current text color
    {...props} // Spreads props like className, width, height, etc.
  >
    {/* The outer circle */}
    <path
      fillRule="evenodd"
      d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z"
      clipRule="evenodd"
    />
    {/* The checkmark path is part of the main path now, but if you wanted it separate (e.g. different color) you'd do this:
    <path stroke="#FFF" stroke-width="2" d="M9.75 12.5l2 2 4.5-4.5" />
    The above path is a simplified representation. The complex one is better for a single color fill.
    The path used in the component combines both shapes for easier coloring.
     */}
  </svg>
);

// BarcodeIcon component
const BarcodeIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg {...props} viewBox="0 0 100 50" fill="none" xmlns="http://www.w3.org/2000/svg">
    {/* Background card-like shape for the barcode, pulsing opacity */}
    <rect x="0" y="0" width="100" height="50" rx="5" fill="currentColor" className="animate-pulse-gray-background" />

    {/* Barcode lines - simplified for SVG representation, now more prominent */}
    <g fill="currentColor"> {/* Use currentColor for the lines and text */}
      <rect x="10" y="10" width="2" height="30" />
      <rect x="14" y="10" width="1" height="30" />
      <rect x="17" y="10" width="3" height="30" />
      <rect x="22" y="10" width="2" height="30" />
      <rect x="26" y="10" width="1" height="30" />
      <rect x="29" y="10" width="3" height="30" />
      <rect x="34" y="10" width="2" height="30" />
      <rect x="38" y="10" width="1" height="30" />
      <rect x="41" y="10" width="3" height="30" />
      <rect x="46" y="10" width="2" height="30" />
      <rect x="50" y="10" width="1" height="30" />
      <rect x="53" y="10" width="3" height="30" />
      <rect x="58" y="10" width="2" height="30" />
      <rect x="62" y="10" width="1" height="30" />
      <rect x="65" y="10" width="3" height="30" />
      <rect x="70" y="10" width="2" height="30" />
      <rect x="74" y="10" width="1" height="30" />
      <rect x="77" y="10" width="3" height="30" />
      <rect x="82" y="10" width="2" height="30" />
      <rect x="86" y="10" width="1" height="30" />

      {/* Placeholder numbers below the barcode */}
      <text x="50" y="47" fontSize="5" textAnchor="middle">
        1 7 2 3 6 4 8 5
      </text>
    </g>
  </svg>
);


interface BranchDashboardMainContentProps {
  appHeaderHeight: string;
  onScanAgainRequest: () => void;
  // New props for data management, passed from App.tsx
  branchesData: BranchDisplayData[];
  kfbNumber: string;
  isScanning: boolean; // Indicates if a scan is in progress
}

/**
 * Determines the background color class for a given test status.
 * @param status The test status ('ok', 'nok', 'not_tested').
 * @returns Tailwind CSS class for background color.
 */
const getStatusBgColor = (status: TestStatus): string => {
  switch (status) {
    case 'ok': return 'bg-green-500 hover:bg-green-600';
    case 'nok': return 'bg-red-500 hover:bg-red-600';
    case 'not_tested': return 'bg-gray-400 hover:bg-gray-500';
    default: return 'bg-gray-300';
  }
};

/**
 * Renders the main content of the Branch Dashboard, displaying branch statuses,
 * KFB number, battery, and a scan button.
 *
 * @param appHeaderHeight - The height of the app header for padding.
 * @param onScanAgainRequest - Callback to request a new scan.
 * @param branchesData - The array of branch display data.
 * @param kfbNumber - The KFB number to display.
 * @param isScanning - Boolean indicating if a scan operation is in progress.
 */
export const BranchDashboardMainContent: React.FC<BranchDashboardMainContentProps> = ({
  appHeaderHeight,
  onScanAgainRequest,
  branchesData, // Destructure branchesData from props
  kfbNumber,    // Destructure kfbNumber from props
  isScanning,   // Destructure isScanning from props
}) => {
  // `hasMounted` state is kept for potential future use related to initial render checks
  const [hasMounted, setHasMounted] = useState(false);
  // State to control the visibility of the "OK" animation
  const [showOkAnimation, setShowOkAnimation] = useState(false);
  // Ref to store the timeout ID for clearing it if needed
  const okAnimationTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // State for conditional display of Battery and KFB Number
  // Default to 0 and '---' to show empty state on load, as per new requirements.
  const [displayBattery, setDisplayBattery] = useState(0);
  const [displayKfbNumber, setDisplayKfbNumber] = useState('---');


  // Set hasMounted to true after the component mounts
  useEffect(() => { setHasMounted(true); }, []);

  /**
   * Filters and sorts the branches data for display.
   * Only shows branches that are 'nok' or 'not_tested', sorted by status,
   * and limits to the first 40 entries.
   */
  const displayedBranches = useMemo(
    () => branchesData.filter(b => b.testStatus !== 'ok')
      .sort((a,b) => ({nok:0,not_tested:1,ok:2}[a.testStatus] - {nok:0,not_tested:1,ok:2}[b.testStatus]))
      .slice(0,40),
    [branchesData]
  );

  /**
   * Determines if all branches are 'ok' based on the `displayedBranches` array.
   * This is true if the component has mounted, there are no non-'ok' branches displayed,
   * and there is at least one branch overall.
   */
  const allBranchesOk = useMemo(
    () => hasMounted && displayedBranches.length === 0 && branchesData.length > 0,
    [hasMounted, displayedBranches, branchesData]
  );

  // Effect to manage the "OK" animation visibility and clear/restore battery/KFB
  useEffect(() => {
    // Clear any existing timeout when allBranchesOk status changes
    if (okAnimationTimeoutRef.current) {
      clearTimeout(okAnimationTimeoutRef.current);
      okAnimationTimeoutRef.current = null;
    }

    if (allBranchesOk) {
      // If all branches are OK, show the animation and set a timeout to hide it
      setShowOkAnimation(true);
      // Restore battery and KFB number
      setDisplayBattery(80); // Static 80% as in original code
      setDisplayKfbNumber(kfbNumber);

      okAnimationTimeoutRef.current = setTimeout(() => {
        setShowOkAnimation(false);
        // Clear battery and KFB number when "OK" animation disappears
        setDisplayBattery(0); // Set to 0 to show empty battery/gray
        setDisplayKfbNumber('---'); // Clear KFB number
      }, 5000); // Hide after 5 seconds
    } else {
      // If not all branches are OK, ensure animation is hidden
      setShowOkAnimation(false);
      // Clear battery and KFB number immediately if not OK, or on initial load
      setDisplayBattery(0);
      setDisplayKfbNumber('---');
    }

    // Cleanup function to clear timeout on unmount or dependency change
    return () => {
      if (okAnimationTimeoutRef.current) {
        clearTimeout(okAnimationTimeoutRef.current);
      }
    };
  }, [allBranchesOk, hasMounted, kfbNumber]); // Re-run when allBranchesOk, hasMounted, or kfbNumber changes

  /**
   * This function is now only called when the "PLEASE SCAN" area is clicked.
   * It initiates a scan and clears the displayed data.
   */
  const handleScanRequest = useCallback(() => {
    setShowOkAnimation(false); // Hide "OK" animation immediately on scan request
    if (okAnimationTimeoutRef.current) {
        clearTimeout(okAnimationTimeoutRef.current); // Clear existing timeout
        okAnimationTimeoutRef.current = null;
    }
    // Clear battery and KFB number when scan is initiated
    setDisplayBattery(0);
    setDisplayKfbNumber('---');
    onScanAgainRequest(); // Trigger the scan request
  }, [onScanAgainRequest]);


  return (
    <div
      className="w-full h-full bg-gray-50 dark:bg-slate-900 text-gray-800 dark:text-slate-100 flex flex-col p-5 sm:p-6 lg:p-8 overflow-y-auto"
      style={{ paddingTop: appHeaderHeight }}
    >
      <header className="mb-6 sm:mb-10 flex flex-col sm:flex-row justify-between items-center bg-gray-100 dark:bg-slate-800 p-4 sm:p-6 rounded-lg shadow">
        {/* Battery Indicator Section - Made bigger and enhanced */}
        <div className="flex flex-col items-center sm:items-start flex-1 mb-4 sm:mb-0">
          <span className="text-lg sm:text-2xl text-blue-600 dark:text-blue-400 uppercase font-semibold">Battery</span>
          <div className="w-40 h-16 border-4 border-gray-500 dark:border-gray-400 rounded-lg flex overflow-hidden relative mt-2 shadow-inner"> {/* Added shadow-inner */}
            <div
              className={`${displayBattery > 0 ? 'bg-green-400' : 'bg-gray-300 dark:bg-gray-600'} transition-all duration-500 ease-in-out`}
              style={{ width: `${displayBattery > 0 ? displayBattery : 0}%` }} // Only fill if displayBattery > 0
            />
            {/* Battery "cap" */}
            <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-6 bg-gray-500 dark:bg-gray-400 rounded-r-sm shadow-md"></div> {/* Added shadow-md */}
          </div>
          <span className="text-3xl font-bold mt-2">{displayBattery > 0 ? `${displayBattery}%` : '---'}</span>
        </div>

        {/* KFB Number Section - Made bigger and enhanced */}
        <div className="flex flex-col items-center flex-1">
          <span className="text-lg sm:text-2xl text-blue-600 dark:text-blue-400 uppercase font-semibold">KFB Number</span>
          <span className="text-5xl sm:text-6xl font-bold uppercase tracking-wider mt-2">{displayKfbNumber}</span>
        </div>

        {/* Removed the Scan Again Button as per instructions */}
      </header>

      <main className="flex-grow flex flex-col items-center justify-center">
        {/* Conditional rendering for "OK" animation or branch grid */}
        {showOkAnimation ? ( // Use showOkAnimation state
          <div className="bg-white dark:bg-slate-800 p-6 sm:p-10 text-center flex-grow w-full flex flex-col items-center justify-center">
            <div className="flex flex-col items-center justify-center space-y-6 sm:space-y-8">
              <div className="relative">
                {/* Outer pulsating green circle */}
                <div className="w-80 h-80 sm:w-[350px] sm:h-[350px] bg-green-100 dark:bg-green-700/30 rounded-full flex items-center justify-center animate-pulse">
                  {/* Inner white circle */}
                    {/* White Pipe */}
                      <CheckCircleIcon className="w-150 h-150 sm:w-160 sm:h-160 text-green-600 dark:text-green-400" />  {/* CheckCircleIcon with adjusted size */}
                </div>
              </div>
              {/* "OK" text is back and adjusted font size */}
              <h3 className="font-black text-green-600 dark:text-green-400 uppercase tracking-wider" style={{ fontSize: 'clamp(2rem, 12vw, 350px)', lineHeight: 1 }}>OK</h3>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 sm:gap-8 w-full">
            {hasMounted && displayedBranches.length === 0 && ( // Condition for "PLEASE SCAN"
              <div
                className="col-span-1 sm:col-span-2 lg:col-span-3 xl:col-span-4 flex flex-col items-center justify-center h-full min-h-[300px] bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 shadow-sm p-6 text-center cursor-pointer transition-all duration-300 ease-in-out hover:shadow-lg"
                onClick={handleScanRequest} // Make the entire area clickable
              >
                  {/* BarcodeIcon with darker base color */}
                  <BarcodeIcon className="w-96 h-48 sm:w-[500px] sm:h-64 text-gray-900 dark:text-gray-100 mb-6" /> {/* Text color sets barcode lines color */}
                  {/* Made text 7xl */}
                  <p className="text-7xl text-gray-600 dark:text-slate-300 font-bold uppercase tracking-wider">PLEASE SCAN</p>
                  {isScanning && <p className="text-gray-500 dark:text-slate-400 mt-2 text-lg">Scanning...</p>}
              </div>
            )}
            {hasMounted && displayedBranches.length > 0 && ( // Display branches if available and not showing OK animation
              displayedBranches.map((branch) => (
                <div key={branch.id} className={`rounded-lg shadow-2xl hover:shadow-[0_35px_60px_-15px_rgba(0,0,0,0.2)] flex flex-col overflow-hidden transition-all duration-300 ease-in-out bg-white dark:bg-slate-800 ${branch.testStatus === 'nok' ? 'border-4 border-red-500 dark:border-red-400' : 'border-4 border-gray-300 dark:border-slate-600 hover:border-sky-400 dark:hover:border-sky-500'}`}>
                  <div className="bg-white dark:bg-slate-800 p-4 sm:p-5 flex-grow flex items-center justify-center min-h-[180px] sm:min-h-[220px] border-b border-gray-100 dark:border-slate-700">
                    <h3 className="text-6xl sm:text-6xl font-semibold text-center text-gray-800 dark:text-slate-100 break-words leading-tight">{branch.branchName}</h3>
                  </div>
                  <div className={`p-3 text-white flex flex-col justify-center items-center min-h-[50px] sm:min-h-[60px] transition-colors duration-150 ${getStatusBgColor(branch.testStatus)}`}>
                    <div className="text-xl sm:text-xl font-bold uppercase text-center tracking-wider">{branch.testStatus === 'nok' ? 'NOT OK' : 'NOT TESTED'}</div>
                  </div>
                  {/* Pin Number display from previous version, added back in */}
                  {branch.pinNumber != null && (
                    <div className="p-2 text-center text-sm bg-gray-200 dark:bg-slate-700">
                      PIN: {branch.pinNumber}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </main>
      {/* Animation for pulse effect and new gray pulse for barcode background */}
      <style>{`
        .animate-pulse {animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .5; } }
        /* New pulse for barcode background */
        .animate-pulse-gray-background { animation: pulse-gray-background 2s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
        @keyframes pulse-gray-background { 0%, 100% { opacity: 0.2; } 50% { opacity: 0.05; } } /* Adjusted for subtle background pulse */
      `}</style>
    </div>
  );
};

export default BranchDashboardMainContent;
