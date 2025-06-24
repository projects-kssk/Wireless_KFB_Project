import React, { useState, useEffect } from 'react';
import { XMarkIcon } from '@/components/Icons/Icons';
import { EspPinMapping } from '@/types/types';

interface BranchSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  pinNumber: string | null;
  currentPinAssignment?: string;
  availableBranches: string[];
  onAssignBranch: (pin: string, branch: string) => void;
  onUnassignBranch: (pin: string) => void;
  espPinMappings: EspPinMapping;
}
export const BranchSelectorModal: React.FC<BranchSelectorModalProps> = ({
  isOpen, onClose, pinNumber, currentPinAssignment, availableBranches, onAssignBranch, onUnassignBranch, espPinMappings,
}) => {
  const [filter, setFilter] = useState('');
  useEffect(() => { if (isOpen) setFilter(''); }, [isOpen]);
  if (!isOpen || !pinNumber) return null;
  const filteredBranches = availableBranches.filter(branch => branch.toLowerCase().includes(filter.toLowerCase()));
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-lg p-6">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl p-10 sm:p-12 w-full max-w-3xl lg:max-w-4xl relative">
        <button onClick={onClose} className="absolute top-6 right-6 text-slate-600 hover:text-slate-800 dark:text-slate-300 dark:hover:text-slate-100" aria-label="Close modal"><XMarkIcon className="w-12 h-12" /></button>
        <h3 className="text-5xl font-semibold text-slate-800 dark:text-slate-100 mb-6">Assign Branch to Pin {pinNumber}</h3>
        {currentPinAssignment && <p className="text-3xl text-slate-600 dark:text-slate-300 mb-10">Currently assigned: <span className="font-bold">{currentPinAssignment}</span></p>}
        {!currentPinAssignment && <p className="text-3xl text-slate-600 dark:text-slate-300 mb-10">Currently unassigned.</p>}
        <input type="text" placeholder="Filter branches..." value={filter} onChange={(e) => setFilter(e.target.value)} className="mt-2 block w-full px-6 py-5 bg-white dark:bg-slate-700 border-2 border-slate-400 dark:border-slate-600 rounded-xl text-3xl shadow-md placeholder-slate-400 dark:placeholder-slate-500 text-slate-900 dark:text-white focus:outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500 mb-10" />
        {availableBranches.length === 0 && <p className="text-3xl text-slate-500 dark:text-slate-400 my-10 text-center">No branches selected. Please add branches in the main form first.</p>}
        <div className="max-h-[400px] overflow-y-auto space-y-5 pr-3">
          {filteredBranches.map(branch => {
            const isAssignedToOtherPin = Object.entries(espPinMappings).some(([p, b]) => b === branch && p !== pinNumber);
            return (
              <div key={branch} className={`flex justify-between items-center p-6 rounded-xl ${branch === currentPinAssignment ? 'bg-sky-100 dark:bg-sky-700/60 ring-2 ring-sky-500' : 'bg-slate-100 dark:bg-slate-700/40 hover:bg-slate-200 dark:hover:bg-slate-600/60'}`}>
                <span className="text-3xl text-slate-700 dark:text-slate-200">{branch}{isAssignedToOtherPin && <span className="text-2xl text-orange-500 dark:text-orange-400 ml-4">(assigned to another pin)</span>}</span>
                <button onClick={() => onAssignBranch(pinNumber, branch)} disabled={branch === currentPinAssignment} className="px-7 py-4 text-2xl font-medium text-white bg-sky-600 hover:bg-sky-700 rounded-xl shadow-md disabled:bg-slate-500 dark:disabled:bg-slate-600 disabled:cursor-not-allowed">{branch === currentPinAssignment ? 'Assigned' : 'Assign'}</button>
              </div>
            );
          })}
          {filteredBranches.length === 0 && availableBranches.length > 0 && <p className="text-3xl text-slate-500 dark:text-slate-400 my-10 text-center">No branches match your filter.</p>}
        </div>
        <div className="mt-12 flex justify-end space-x-6">
          {currentPinAssignment && <button type="button" onClick={() => onUnassignBranch(pinNumber)} className="px-8 py-4 text-2xl font-medium text-white bg-red-600 hover:bg-red-700 rounded-xl shadow-md">Unassign from Pin {pinNumber}</button>}
          <button type="button" onClick={onClose} className="px-8 py-4 text-2xl font-medium text-white bg-green-600 hover:bg-green-700 rounded-xl shadow-md">Save & Close</button>
        </div>
      </div>
    </div>
  );
};