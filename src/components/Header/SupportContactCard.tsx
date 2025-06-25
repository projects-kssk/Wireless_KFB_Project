// src/components/Header/SupportContactCard.tsxNew KFB Configuration

import React from "react";

interface SupportContactCardProps {
  supportInfo: {
    title:string;
    phone: string;
  };
}

/**
 * We increase padding, border thickness, width/height, and bump all text up one step:
 *  - Container goes from w-48 to w-64 (16rem → 24rem) and a fixed height (e.g. h-40)
 *  - “Call Support” label: text-lg (instead of text-sm)
 *  - Phone/hours: text-md (instead of text-xs)
 */
export const SupportContactCard: React.FC<SupportContactCardProps> = ({
  supportInfo,
}) => (
  <div className="flex flex-col items-center justify-center p-4 h-full bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 rounded-xl shadow-lg border border-slate-200 dark:border-slate-700">
    <span className="text-sm font-bold tracking-wider uppercase text-slate-500 dark:text-slate-400">{supportInfo.title}</span>
    <span className="text-4xl font-extrabold text-slate-900 dark:text-slate-50">{supportInfo.phone}</span>
  </div>

);
