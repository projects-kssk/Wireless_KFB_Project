import React, { useMemo } from "react";
import { CheckCircleIcon, XCircleIcon, AlertTriangleIcon, SettingsIcon } from '@/components/Icons/Icons';
import { StatusType } from "@/types/types"; // Use this line if using a central types file
const StatusLightWithIcon = ({ status }) => {
    const statusConfig = useMemo(() => {
        const baseIconClass = "w-4 h-4 sm:w-4 sm:h-4";
        switch (status) {
            case 'connected':
            case 'active':
                return { textColor: 'text-green-600 dark:text-green-400', icon: <CheckCircleIcon className={`${baseIconClass} text-green-500 dark:text-green-300`}/>, dotColor: 'bg-green-500', pulseClass: '', label: 'Online' };
            case 'error':
            case 'offline':
                return { textColor: 'text-red-600 dark:text-red-400', icon: <XCircleIcon className={`${baseIconClass} text-red-500 dark:text-red-300`}/>, dotColor: 'bg-red-500', pulseClass: 'animate-pulse-red', label: 'Error' };
            case 'warning':
            case 'degraded':
                return { textColor: 'text-yellow-600 dark:text-yellow-400', icon: <AlertTriangleIcon className={`${baseIconClass} text-yellow-500 dark:text-yellow-300`}/>, dotColor: 'bg-yellow-500', pulseClass: 'animate-pulse-yellow', label: 'Warning' };
            case 'maintenance':
                return { textColor: 'text-blue-600 dark:text-blue-400', icon: <SettingsIcon className={`${baseIconClass} text-blue-500 dark:text-blue-300`}/>, dotColor: 'bg-blue-500', pulseClass: '', label: 'Maintenance' };
            default:
                return { textColor: 'text-slate-500 dark:text-slate-400', icon: <SettingsIcon className={`${baseIconClass} text-slate-500 dark:text-slate-300`}/>, dotColor: 'bg-slate-500', pulseClass: '', label: 'Unknown' };
        }
    }, [status]);
    return (<div className="flex items-center space-x-1.5 sm:space-x-2">
        {statusConfig.icon}
        <div className={`w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full ${statusConfig.dotColor} ${statusConfig.pulseClass} transition-all duration-300 ease-in-out shadow-sm border border-white/30 dark:border-black/30`} aria-label={`Status: ${statusConfig.label}`}></div>
        <span className={`hidden sm:inline text-[10px] sm:text-xs font-medium ${statusConfig.textColor}`}>{statusConfig.label}</span>
      </div>);
};
export default StatusLightWithIcon;
