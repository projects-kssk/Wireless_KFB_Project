// src/components/Header/SupportContactCard.tsxNew KFB Configuration

import React from "react";

interface SupportContactCardProps {
  supportInfo: {
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
  <div
    className="
      p-6
      border-2 border-slate-300 dark:border-slate-600
      rounded-xl shadow-xl
      bg-white dark:bg-slate-700
      w-64 h-40
      flex flex-col justify-center items-center
    "
  >
    <p className="text-2xl font-bold text-slate-700 dark:text-slate-200 mb-2">
      SUPPORT CALL
    </p>
    <p className="text-4xl text-slate-800 dark:text-slate-800 mb-1 font-bold">
      {supportInfo.phone}
    </p>

  </div>
);
