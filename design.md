import React, { useState, useMemo } from 'react';

// --- SVG Icons ---
// Using inline SVGs for portability. In a real app, you might use a library like lucide-react.

const CheckCircleIcon = ({ className = "w-5 h-5" }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
    <polyline points="22 4 12 14.01 9 11.01"></polyline>
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

// --- Helper Function for Status ---
// This function centralizes the logic for status styles, icons, and text.
const getStatusInfo = (status) => {
  switch (status) {
    case 'ok':
      return {
        Icon: CheckCircleIcon,
        text: 'OK',
        color: 'text-emerald-600 dark:text-emerald-400',
        bgColor: 'bg-emerald-500/10',
        borderColor: 'border-emerald-500/0',
      };
    case 'nok':
      return {
        Icon: XCircleIcon,
        text: 'NOK',
        color: 'text-red-600 dark:text-red-400',
        bgColor: 'bg-red-500/10',
        borderColor: 'border-red-500/80',
      };
    case 'in_progress':
      return {
        Icon: ClockIcon,
        text: 'In Progress',
        color: 'text-blue-600 dark:text-blue-400',
        bgColor: 'bg-blue-500/10',
        borderColor: 'border-blue-500/0',
      };
    default: // not_tested
      return {
        Icon: HelpCircleIcon,
        text: 'Not Tested',
        color: 'text-slate-600 dark:text-slate-400',
        bgColor: 'bg-slate-500/10',
        borderColor: 'border-slate-500/0',
      };
  }
};


// --- The Redesigned Branch Card Component ---
const BranchCard = ({ branch }) => {
  const statusInfo = useMemo(() => getStatusInfo(branch.testStatus), [branch.testStatus]);

  return (
    <div
      key={branch.id}
      className={`group relative rounded-xl bg-white dark:bg-slate-800/50 backdrop-blur-sm shadow-lg hover:shadow-2xl border-2 border-transparent hover:border-blue-500 dark:border-slate-700 dark:hover:border-blue-500 transition-all duration-300 transform hover:-translate-y-2`}
    >
      {/* Optional: A subtle colored border for specific statuses */}
      {branch.testStatus === 'nok' && <div className="absolute top-0 left-0 w-full h-1 bg-red-500 rounded-t-lg"></div>}
      
      <div className="p-6 flex flex-col justify-between h-full">
        <div>
          {/* Top section with status and PIN */}
          <div className="flex justify-between items-start mb-4">
            <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold ${statusInfo.bgColor} ${statusInfo.color}`}>
              <statusInfo.Icon className="w-4 h-4" />
              <span>{statusInfo.text}</span>
            </div>
            {branch.pinNumber != null && (
              <div className="px-2.5 py-1 bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 text-xs font-mono rounded-full">
                PIN: {branch.pinNumber}
              </div>
            )}
          </div>

          {/* Branch Name */}
          <h3 className="text-3xl font-bold text-slate-700 dark:text-slate-200 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors duration-300">
            {branch.branchName}
          </h3>
        </div>

        {/* You could add more details here if needed */}
        <div className="mt-4 text-right">
             <a href="#" className="text-sm font-semibold text-blue-600 dark:text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                View Details &rarr;
             </a>
        </div>
      </div>
    </div>
  );
};


// --- Main App Component to display the grid ---
export default function App() {
  const [isDarkMode, setIsDarkMode] = useState(false);

  // Sample data to showcase the different card states
  const branches = [
    { id: 1, branchName: 'CL_5304', testStatus: 'not_tested', pinNumber: 'B' },
    { id: 2, branchName: 'CL_5301', testStatus: 'ok', pinNumber: null },
    { id: 3, branchName: 'CL_5307', testStatus: 'nok', pinNumber: null },
    { id: 4, branchName: 'TU_5300', testStatus: 'in_progress', pinNumber: 'G' },
    { id: 5, branchName: 'CL_1800', testStatus: 'ok', pinNumber: null },
    { id: 6, branchName: 'CL_1801', testStatus: 'ok', pinNumber: null },
    { id: 7, branchName: 'CL_1802', testStatus: 'not_tested', pinNumber: 'H' },
    { id: 8, branchName: 'CL_1808', testStatus: 'ok', pinNumber: null },
  ];

  return (
    <div className={isDarkMode ? 'dark' : ''}>
      <main className="bg-slate-100 dark:bg-slate-900 min-h-screen p-4 sm:p-8 transition-colors duration-300 font-sans">
        <div className="max-w-7xl mx-auto">
          {/* Header and Theme Toggle */}
          <div className="flex justify-between items-center mb-8">
            <div>
                <h1 className="text-4xl font-bold text-slate-800 dark:text-white">Branch Status</h1>
                <p className="text-slate-500 dark:text-slate-400 mt-1">Live overview of integration branches.</p>
            </div>
            <button
              onClick={() => setIsDarkMode(!isDarkMode)}
              className="px-4 py-2 rounded-lg bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 shadow-md hover:shadow-lg transition-all"
            >
              {isDarkMode ? 'Light Mode' : 'Dark Mode'}
            </button>
          </div>

          {/* The Grid of Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8 w-full">
            {branches.map((branch) => (
              <BranchCard key={branch.id} branch={branch} />
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
