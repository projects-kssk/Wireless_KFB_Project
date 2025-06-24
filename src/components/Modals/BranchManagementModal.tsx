import React, { useState, useEffect, ChangeEvent } from 'react';

// Placeholder for XMarkIcon - replace with your actual import
const XMarkIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
);

// Corrected Branch interface: id is now number
// Ideally, import this from your central types file (e.g., '@/types/types')
export interface Branch {
  id: number; // Changed from string to number to match the error
  name: string;
  // Add other properties if your Branch type has them
}

// Placeholder for NotificationType - replace with your actual import from '@/types/types'
export interface NotificationType {
  message: string | null;
  type: 'success' | 'error' | 'info' | null;
}

interface BranchManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  allGlobalBranches: Branch[]; // This now expects Branch with id: number
  configSelectedBranches: string[];
  onToggleBranchForConfig: (branchName: string) => void;
  onAddNewGlobalBranch: (branchName: string) => Promise<Branch | null>; // Ensure this promise resolves with Branch where id is number
}

export const BranchManagementModal: React.FC<BranchManagementModalProps> = ({
  isOpen,
  onClose,
  allGlobalBranches,
  configSelectedBranches,
  onToggleBranchForConfig,
  onAddNewGlobalBranch,
}) => {
  const [filter, setFilter] = useState('');
  const [newBranchName, setNewBranchName] = useState('');
  const [modalNotification, setModalNotification] = useState<NotificationType>({ message: null, type: null });
  const [isAdding, setIsAdding] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setFilter('');
      setNewBranchName('');
      setModalNotification({ message: null, type: null });
      setIsAdding(false); // Reset adding state when modal opens
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleAddNewBranch = async () => {
    setModalNotification({ message: null, type: null });
    const trimmedBranchName = newBranchName.trim();

    if (!trimmedBranchName) {
      setModalNotification({ message: "Branch name cannot be empty.", type: 'error' });
      return;
    }

    // Check if branch name exists in allGlobalBranches (which now have id: number)
    if (allGlobalBranches.some(b => b.name.toLowerCase() === trimmedBranchName.toLowerCase())) {
      setModalNotification({ message: `Branch "${trimmedBranchName}" already exists in the master list.`, type: 'info' });
      if (!configSelectedBranches.includes(trimmedBranchName)) {
        onToggleBranchForConfig(trimmedBranchName);
      }
      setNewBranchName('');
      return;
    }

    setIsAdding(true);
    try {
      // Ensure onAddNewGlobalBranch returns a Branch object where id is a number
      const addedBranch = await onAddNewGlobalBranch(trimmedBranchName);
      if (addedBranch) {
        // Ensure addedBranch.id is a number if it's used elsewhere, though here only name is used.
        onToggleBranchForConfig(addedBranch.name); 
        setNewBranchName('');
        setModalNotification({ message: `Branch "${addedBranch.name}" added and selected for this configuration.`, type: 'success' });
      } else {
        setModalNotification({ message: `Failed to add branch "${trimmedBranchName}". It might already exist or another issue occurred.`, type: 'error' });
      }
    } catch (error) {
      console.error("Error adding new branch:", error);
      setModalNotification({ message: `An error occurred while adding branch "${trimmedBranchName}".`, type: 'error' });
    } finally {
      setIsAdding(false);
    }
  };

  const handleNewBranchNameChange = (e: ChangeEvent<HTMLInputElement>) => {
    console.log('Event target:', e.target);
    console.log('Event currentTarget:', e.currentTarget);
    console.log('Value from currentTarget:', e.currentTarget.value);
    console.log('Type of value:', typeof e.currentTarget.value);
    setNewBranchName(e.currentTarget.value);
  };
  
  const handleFilterChange = (e: ChangeEvent<HTMLInputElement>) => {
    console.log('Event target:', e.target);
    console.log('Event currentTarget:', e.currentTarget);
    console.log('Value from currentTarget:', e.currentTarget.value);
    console.log('Type of value:', typeof e.currentTarget.value);
    setFilter(e.currentTarget.value);
  };
  

  const filteredGlobalBranches = allGlobalBranches.filter(branch =>
    branch.name.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-lg p-6">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl px-6 sm:px-12 py-10 sm:py-14 w-full max-w-3xl lg:max-w-4xl relative border-4 border-slate-300 dark:border-slate-700">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 sm:top-7 sm:right-7 text-slate-600 hover:text-slate-800 dark:text-slate-300 dark:hover:text-slate-100"
          aria-label="Close modal"
        >
          <XMarkIcon className="w-10 h-10 sm:w-14 sm:h-14" />
        </button>
        <h3 className="text-3xl sm:text-5xl font-semibold text-slate-800 dark:text-slate-100 mb-8 sm:mb-12 border-b-4 border-orange-500 pb-3 w-fit mx-auto px-4 bg-orange-50 dark:bg-orange-900/40 rounded-xl text-center">
          Manage Branch Names
        </h3>

        {modalNotification.message && (
          <div
            className={`p-4 sm:p-6 mb-6 sm:mb-10 rounded-xl text-lg sm:text-3xl ${
              modalNotification.type === 'error'
                ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-200'
                : modalNotification.type === 'success'
                ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-200'
                : 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-200'
            }`}
          >
            {modalNotification.message}
          </div>
        )}

        <div className="mb-8 sm:mb-12 p-4 sm:p-8 border-2 border-slate-300 dark:border-slate-600 rounded-2xl shadow-lg">
          <label htmlFor="newGlobalBranchName" className="block text-xl sm:text-3xl font-medium text-slate-700 dark:text-slate-300 mb-3 sm:mb-4">
            Add New Branch to Master List
          </label>
          <div className="flex flex-col sm:flex-row space-y-4 sm:space-y-0 sm:space-x-6">
            <input
              type="text"
              id="newGlobalBranchName"
              value={newBranchName}
              onChange={handleNewBranchNameChange}
              placeholder="Enter new branch name"
              className="block w-full px-5 sm:px-7 py-4 sm:py-6 bg-white dark:bg-slate-700 border-2 border-slate-400 dark:border-slate-600 rounded-xl text-xl sm:text-3xl shadow-md placeholder-slate-400 dark:placeholder-slate-500 text-slate-900 dark:text-white focus:outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500"
              disabled={isAdding}
            />
            <button
              onClick={handleAddNewBranch}
              className="px-6 sm:px-10 py-4 sm:py-6 text-lg sm:text-2xl font-medium text-white bg-sky-600 hover:bg-sky-700 rounded-xl shadow-md whitespace-nowrap disabled:opacity-60"
              disabled={isAdding}
            >
              {isAdding ? 'Adding...' : 'Add Branch'}
            </button>
          </div>
        </div>

        <input
          type="text"
          placeholder="Filter existing branches..."
          value={filter}
          onChange={handleFilterChange}
          className="block w-full px-5 sm:px-7 py-4 sm:py-6 bg-white dark:bg-slate-700 border-2 border-slate-400 dark:border-slate-600 rounded-xl text-xl sm:text-3xl shadow-md placeholder-slate-400 dark:placeholder-slate-500 text-slate-900 dark:text-white focus:outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500 mb-8 sm:mb-12"
        />

        <div className="max-h-[300px] sm:max-h-[500px] overflow-y-auto space-y-4 sm:space-y-7 pr-2 sm:pr-3 border-t-4 border-slate-300 dark:border-slate-700 pt-8 sm:pt-12 mt-4">
          {allGlobalBranches.length === 0 && (
            <p className="text-xl sm:text-3xl text-slate-500 dark:text-slate-400 my-10 text-center">
              No branches in master list. Add one above.
            </p>
          )}
          {/* Key prop can be number or string, so branch.id (now number) is fine here */}
          {filteredGlobalBranches.map(branch => {
            const isSelectedForConfig = configSelectedBranches.includes(branch.name);
            return (
              <div
                key={branch.id} 
                className={`flex flex-col sm:flex-row justify-between items-start sm:items-center p-4 sm:p-8 rounded-2xl border-4 border-sky-300 dark:border-sky-800 bg-sky-50 dark:bg-sky-900/40 shadow ${
                  isSelectedForConfig ? 'ring-2 ring-offset-2 dark:ring-offset-slate-800 ring-sky-500' : ''
                } mx-1 sm:mx-2`}
              >
                <span className="text-xl sm:text-3xl text-slate-700 dark:text-slate-200 font-semibold tracking-wide mb-3 sm:mb-0">
                  {branch.name}
                </span>
                <button
                  onClick={() => onToggleBranchForConfig(branch.name)}
                  className={`w-full sm:w-auto px-6 sm:px-10 py-3 sm:py-5 text-lg sm:text-2xl font-medium rounded-xl shadow-md whitespace-nowrap ${
                    isSelectedForConfig
                      ? 'bg-red-500 hover:bg-red-600 text-white'
                      : 'bg-green-500 hover:bg-green-600 text-white'
                  }`}
                >
                  {isSelectedForConfig ? 'Remove from Config' : 'Add to Config'}
                </button>
              </div>
            );
          })}
          {filteredGlobalBranches.length === 0 && allGlobalBranches.length > 0 && (
            <p className="text-xl sm:text-3xl text-slate-500 dark:text-slate-400 my-10 text-center">
              No branches match your filter.
            </p>
          )}
        </div>

        <div className="mt-10 sm:mt-16 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-6 sm:px-10 py-3 sm:py-5 text-lg sm:text-2xl bg-green-600 font-medium text-slate-100 hover:bg-green-700 dark:text-slate-100 dark:bg-slate-600 dark:hover:bg-slate-500 rounded-xl shadow-md"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

// Example of how you might use it (for testing purposes)
// const App = () => {
//   const [isOpen, setIsOpen] = useState(true);
//   const [globalBranches, setGlobalBranches] = useState<Branch[]>([ // Branch[] here would use the updated interface
//     { id: 1, name: 'main' }, // id is now number
//     { id: 2, name: 'develop' }, // id is now number
//     { id: 3, name: 'feature/new-login' }, // id is now number
//   ]);
//   const [configBranches, setConfigBranches] = useState<string[]>(['main']);

//   const handleAddNewGlobalBranch = async (branchName: string): Promise<Branch | null> => {
//     console.log('Adding new global branch:', branchName);
//     // Simulate API call
//     return new Promise(resolve => {
//       setTimeout(() => {
//         if (globalBranches.some(b => b.name.toLowerCase() === branchName.toLowerCase())) {
//           resolve(null); // Branch already exists
//         } else {
//           const newBranch: Branch = { id: Date.now(), name: branchName }; // id is now number
//           setGlobalBranches(prev => [...prev, newBranch]);
//           resolve(newBranch);
//         }
//       }, 500);
//     });
//   };

//   const handleToggleBranch = (branchName: string) => {
//     console.log('Toggling branch for config:', branchName);
//     setConfigBranches(prev =>
//       prev.includes(branchName) ? prev.filter(b => b !== branchName) : [...prev, branchName]
//     );
//   };

//   return (
//     <div>
//       <button onClick={() => setIsOpen(true)} className="p-2 bg-blue-500 text-white">Open Modal</button>
//       <BranchManagementModal
//         isOpen={isOpen}
//         onClose={() => setIsOpen(false)}
//         allGlobalBranches={globalBranches}
//         configSelectedBranches={configBranches}
//         onToggleBranchForConfig={handleToggleBranch}
//         onAddNewGlobalBranch={handleAddNewGlobalBranch}
//       />
//     </div>
//   );
// };

// export default App; // If you were to run this as a standalone app.
