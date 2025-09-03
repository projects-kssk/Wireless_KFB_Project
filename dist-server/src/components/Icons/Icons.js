import React from "react";
/* Existing icons (kept) */
export const PencilSquareIcon = (props) => (<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" {...props}>
    <path d="M21.731 2.269a2.625 2.625 0 0 0-3.712 0l-1.157 1.157 3.712 3.712 1.157-1.157a2.625 2.625 0 0 0 0-3.712ZM19.513 8.199l-3.712-3.712-8.4 8.4a5.25 5.25 0 0 0-1.32 2.214l-.8 2.685a.75.75 0 0 0 .933.933l2.685-.8a5.25 5.25 0 0 0 2.214-1.32l8.4-8.4Z"/>
    <path d="M5.25 5.25a3 3 0 0 0-3 3v10.5a3 3 0 0 0 3 3h10.5a3 3 0 0 0 3-3V13.5a.75.75 0 0 0-1.5 0v5.25a1.5 1.5 0 0 1-1.5 1.5H5.25a1.5 1.5 0 0 1-1.5-1.5V8.25a1.5 1.5 0 0 1 1.5-1.5h5.25a.75.75 0 0 0 0-1.5H5.25Z"/>
  </svg>);
export const TrashIcon = (props) => (<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" {...props}>
    <path fillRule="evenodd" d="M16.5 4.478v.227a48.816 48.816 0 0 1 3.878.512.75.75 0 1 1-.256 1.478l-.209-.035-1.005 13.07a3 3 0 0 1-2.991 2.77H8.084a3 3 0 0 1-2.991-2.77L4.087 6.66l-.209.035a.75.75 0 0 1-.256-1.478A48.567 48.567 0 0 1 7.5 4.705v-.227c0-1.564 1.213-2.9 2.816-2.951a52.662 52.662 0 0 1 3.369 0c1.603.051 2.815 1.387 2.815 2.951Zm-6.136-1.452a51.196 51.196 0 0 1 3.273 0C14.39 3.05 15 3.684 15 4.478v.113a49.488 49.488 0 0 0-6 0v-.113c0-.794.609-1.428 1.364-1.452Zm-.355 5.945a.75.75 0 1 0-1.5.058l.347 9a.75.75 0 1 0 1.499-.058l-.347-9Zm5.48.058a.75.75 0 1 0-1.498-.058l-.347 9a.75.75 0 0 0 1.499.058l.346-9Z" clipRule="evenodd"/>
  </svg>);
export const ExclamationTriangleIcon = (props) => (<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"/>
  </svg>);
/* Essentials */
export const XMarkIcon = (props) => (<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
  </svg>);
export const MenuIcon = (props) => (<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.5 6.75h17M3.5 12h17M3.5 17.25h17"/>
  </svg>);
/* ───────────────── Better, friendlier system icons ───────────────── */
/** House with rounded doorway (softer look) */
export const SettingsHomeIcon = (props) => (<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 10.5l8.485-7.07a1.25 1.25 0 0 1 1.67 0L21 10.5M5.25 9.75V19a2 2 0 0 0 2 2H9a.5.5 0 0 0 .5-.5V16a2 2 0 0 1 2-2h1a2 2 0 0 1 2 2v4.5a.5.5 0 0 0 .5.5h1.75a2 2 0 0 0 2-2V9.75"/>
  </svg>);
/** Sliders/Tuning icon (used as SettingsCogIcon for KFB CONFIG) */
export const SettingsCogIcon = (props) => (<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4 7.5h7m9 0h-5M7.5 7.5v0m0 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM4 16.5h5m9 0h2M12.5 16.5v0m0 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"/>
  </svg>);
/** Rounded 3D cube with consistent proportions */
export const SettingsCubeIcon = (props) => (<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 3.5 5.25 7.25v9.5L12 20.5l6.75-3.75v-9.5L12 3.5Z"/>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 3.5v17M5.25 7.25 12 11l6.75-3.75"/>
  </svg>);
/* Misc you already had */
export const RefreshCwIcon = (props) => (<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
    <path d="M21 3v5h-5"/>
    <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>
    <path d="M3 21v-5h5"/>
  </svg>);
export const CheckCircleIcon = (props) => (<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/>
  </svg>);
/* Newly declared (kept for compatibility) */
export const AlertTriangleIcon = (props) => (<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"/>
  </svg>);
export const SettingsIcon = (props) => (
/* kept for external use if needed; cog style */
<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.75h4.5l.7 2.1a2 2 0 0 0 1.19 1.22l2.15.82v4.24l-2.15.82a2 2 0 0 0-1.19 1.22l-.7 2.1h-4.5l-.7-2.1a2 2 0 0 0-1.19-1.22l-2.15-.82V7.97l2.15-.82a2 2 0 0 0 1.19-1.22l.7-2.18Z"/>
    <circle cx="12" cy="12" r="2.75"/>
  </svg>);
export const XCircleIcon = (props) => (<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 9.75l4.5 4.5m0-4.5-4.5 4.5M21 12A9 9 0 1 1 3 12a9 9 0 0 1 18 0Z"/>
  </svg>);
