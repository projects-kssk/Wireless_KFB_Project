import React from 'react';
import { BranchDisplayData, TestStatus } from '@/types/types';
import { SIDEBAR_WIDTH } from '@/components/config/appConfig';

interface BranchControlSidebarProps {
  isOpen: boolean;
  toggleSidebar: () => void;
  branches: BranchDisplayData[];
  onSetStatus: (branchId: string, newStatus: TestStatus) => void;
  sidebarWidthProvided?: string;
  appHeaderHeight: string;
}

// Optional: map statuses to human-friendly labels
const STATUS_LABELS: Record<TestStatus, string> = {
  ok: 'OK',
  nok: 'NOT OK',
  not_tested: 'NOT TESTED',
};

export const BranchControlSidebar: React.FC<BranchControlSidebarProps> = ({
  isOpen,
  toggleSidebar,
  branches,
  onSetStatus,
  sidebarWidthProvided = SIDEBAR_WIDTH,
  appHeaderHeight,
}) => {
  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/30 backdrop-blur-sm z-30 lg:hidden"
          onClick={toggleSidebar}
        />
      )}
      <div
        className={`fixed left-0 bg-white dark:bg-slate-800 shadow-lg transform transition-transform duration-300 ease-in-out flex flex-col border-r border-gray-200 dark:border-slate-700`}
        style={{
          top: 0,
          height: '100vh',
          width: sidebarWidthProvided,
          transform: isOpen ? 'translateX(0)' : `translateX(-${sidebarWidthProvided})`,
          zIndex: 40,
        }}
      >
        <div style={{ height: appHeaderHeight, flexShrink: 0 }} />

        <div className="p-4 border-b border-gray-200 dark:border-slate-700 flex-shrink-0">
          <h2 className="text-lg font-semibold text-gray-700 dark:text-slate-200">
            Branch Controls
          </h2>
        </div>

        <ul className="flex-grow overflow-y-auto p-4 space-y-3">
          {branches.map((branch) => {
            // Safely pull status
            const statusKey = branch.testStatus as TestStatus | undefined;
            const label = statusKey ? STATUS_LABELS[statusKey] : 'UNKNOWN';
            const badgeColor =
              statusKey === 'ok'
                ? 'bg-green-500 text-white'
                : statusKey === 'nok'
                ? 'bg-red-500 text-white'
                : 'bg-gray-400 text-white';

            return (
              <li
                key={branch.id}
                className="p-4 bg-white dark:bg-slate-700 rounded-lg shadow-md hover:shadow-lg transition-shadow duration-200 border border-gray-200 dark:border-slate-600"
              >
                <div className="flex justify-between items-center mb-3">
                  <span className="text-md font-semibold text-gray-700 dark:text-slate-200 break-all">
                    {branch.branchName}
                  </span>
                  <span
                    className={`px-2.5 py-1 text-xs font-bold rounded-full shadow-sm ${badgeColor}`}
                  >
                    {label}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => onSetStatus(branch.id, 'ok')}
                    className="px-3 py-2 text-sm font-medium bg-green-100 hover:bg-green-200 text-green-700 border border-green-300 rounded-md disabled:opacity-60 disabled:cursor-not-allowed"
                    disabled={branch.testStatus === 'ok'}
                  >
                    OK
                  </button>

                  <button
                    onClick={() => onSetStatus(branch.id, 'nok')}
                    className="px-3 py-2 text-sm font-medium bg-red-100 hover:bg-red-200 text-red-700 border border-red-300 rounded-md disabled:opacity-60 disabled:cursor-not-allowed"
                    disabled={branch.testStatus === 'nok'}
                  >
                    Not OK
                  </button>

                  <button
                    onClick={() => onSetStatus(branch.id, 'not_tested')}
                    className="px-3 py-2 text-sm font-medium bg-gray-100 hover:bg-gray-200 text-gray-700 border border-gray-300 rounded-md disabled:opacity-60 disabled:cursor-not-allowed"
                    disabled={branch.testStatus === 'not_tested'}
                  >
                    Reset
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
};
