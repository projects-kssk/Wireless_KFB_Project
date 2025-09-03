// src/components/Header/StatusIndicatorCard.tsx
import React from "react";
/**
 * Enlarged StatusIndicatorCard:
 *  - Card container: w-60 h-48, p-6, rounded-xl, shadow-xl
 *  - Label: text-2xl sm:text-3xl
 *  - Status pill: text-3xl sm:text-4xl
 */
export const StatusIndicatorCard = ({ label, status, }) => {
    // Determine pill color based on the three‐state status
    let pillClasses = "";
    switch (status) {
        case "connected":
            pillClasses = "bg-green-500 text-white";
            break;
        case "error":
            pillClasses = "bg-red-500 text-white";
            break;
        case "offline":
            pillClasses = "bg-red-500 text-white";
            break;
        default:
            // (this default is unreachable because of our SimpleStatus type)
            pillClasses = "bg-slate-400 text-white";
            break;
    }
    return (<div className="
        w-120 
        p-6
        border-2 border-slate-300 dark:border-slate-600
        rounded-xl shadow-xl
        bg-white dark:bg-slate-700
        flex flex-col justify-center items-center
      ">
      {/* Larger label */}
      <p className="text-2xl sm:text-3xl font-semibold text-slate-700 dark:text-slate-200 mb-2 text-center">
        {label}
      </p>

      {/* Bigger status pill */}
      <span className={`
          px-4 py-2
          text-3xl sm:text-4xl font-bold
          rounded-full shadow-md
          ${pillClasses}
        `}>
        {status.toUpperCase()}
      </span>
    </div>);
};
