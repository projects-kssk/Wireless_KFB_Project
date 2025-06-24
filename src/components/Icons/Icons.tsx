import React from 'react';

// For simplicity in this example, IconProps is defined once.
// This one is used by PencilSquareIcon, TrashIcon, ExclamationTriangleIcon
interface IconPropsSPS extends React.SVGProps<SVGSVGElement> { /* Allow any SVG props */ }

// This generic prop type is used by XMarkIcon, MenuIcon, etc. and the new ones I'm adding.
// You could consolidate to use IconPropsSPS for all if desired.
interface IconPropsGeneric extends React.SVGProps<SVGSVGElement> {}

// --- Icons from your initial request and existing definitions ---

export const PencilSquareIcon: React.FC<IconPropsSPS> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" {...props}>
    <path d="M21.731 2.269a2.625 2.625 0 0 0-3.712 0l-1.157 1.157 3.712 3.712 1.157-1.157a2.625 2.625 0 0 0 0-3.712ZM19.513 8.199l-3.712-3.712-8.4 8.4a5.25 5.25 0 0 0-1.32 2.214l-.8 2.685a.75.75 0 0 0 .933.933l2.685-.8a5.25 5.25 0 0 0 2.214-1.32l8.4-8.4Z" />
    <path d="M5.25 5.25a3 3 0 0 0-3 3v10.5a3 3 0 0 0 3 3h10.5a3 3 0 0 0 3-3V13.5a.75.75 0 0 0-1.5 0v5.25a1.5 1.5 0 0 1-1.5 1.5H5.25a1.5 1.5 0 0 1-1.5-1.5V8.25a1.5 1.5 0 0 1 1.5-1.5h5.25a.75.75 0 0 0 0-1.5H5.25Z" />
  </svg>
);

export const TrashIcon: React.FC<IconPropsSPS> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" {...props}>
    <path fillRule="evenodd" d="M16.5 4.478v.227a48.816 48.816 0 0 1 3.878.512.75.75 0 1 1-.256 1.478l-.209-.035-1.005 13.07a3 3 0 0 1-2.991 2.77H8.084a3 3 0 0 1-2.991-2.77L4.087 6.66l-.209.035a.75.75 0 0 1-.256-1.478A48.567 48.567 0 0 1 7.5 4.705v-.227c0-1.564 1.213-2.9 2.816-2.951a52.662 52.662 0 0 1 3.369 0c1.603.051 2.815 1.387 2.815 2.951Zm-6.136-1.452a51.196 51.196 0 0 1 3.273 0C14.39 3.05 15 3.684 15 4.478v.113a49.488 49.488 0 0 0-6 0v-.113c0-.794.609-1.428 1.364-1.452Zm-.355 5.945a.75.75 0 1 0-1.5.058l.347 9a.75.75 0 1 0 1.499-.058l-.347-9Zm5.48.058a.75.75 0 1 0-1.498-.058l-.347 9a.75.75 0 0 0 1.499.058l.346-9Z" clipRule="evenodd" />
  </svg>
);

export const ExclamationTriangleIcon: React.FC<IconPropsSPS> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
    </svg>
);

export const XMarkIcon: React.FC<IconPropsGeneric> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
);

export const MenuIcon: React.FC<IconPropsGeneric> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
  </svg>
);

export const SettingsHomeIcon: React.FC<IconPropsGeneric> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h7.5" /></svg>
);

export const SettingsCogIcon: React.FC<IconPropsGeneric> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}><path strokeLinecap="round" strokeLinejoin="round" d="M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93L15.6 7.21c.796.317 1.272 1.26A1.5 1.5 0 0115.04 9h-6.08a1.5 1.5 0 01-1.04-2.21l1.03-1.636a1.125 1.125 0 00.78-.93l.149-.894zM12 15.75a3.75 3.75 0 100-7.5 3.75 3.75 0 000 7.5zM21.75 10.5a1.125 1.125 0 00-1.125-1.125h-2.006a1.125 1.125 0 010-2.25h2.006c.621 0 1.125-.504 1.125-1.125S21.121 3.75 20.5 3.75h-2.005a1.125 1.125 0 010-2.25H20.5a1.125 1.125 0 001.125-1.125 1.125 1.125 0 00-1.125-1.125h-.794a1.125 1.125 0 01-1.03-.62l-.149-.893a1.125 1.125 0 00-1.11-.94h-1.094a1.125 1.125 0 00-1.11.94l-.149.893a1.125 1.125 0 01-1.03.62H12a1.125 1.125 0 00-1.125 1.125 1.125 1.125 0 001.125 1.125h.794a1.125 1.125 0 011.03.62l.149.894a1.125 1.125 0 001.11.94h1.094a1.125 1.125 0 001.11-.94l.149-.894a1.125 1.125 0 011.03-.62h2.005c.621 0 1.125.504 1.125 1.125s-.504 1.125-1.125 1.125h-2.005a1.125 1.125 0 010 2.25H20.5c.621 0 1.125.504 1.125 1.125z" /></svg>
);

export const SettingsCubeIcon: React.FC<IconPropsGeneric> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}><path strokeLinecap="round" strokeLinejoin="round" d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" /></svg>
);

export const RefreshCwIcon: React.FC<IconPropsGeneric> = (props) => (<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/></svg>);

export const CheckCircleIcon: React.FC<IconPropsGeneric> = (props) => (<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>);


// --- Newly Declared Icons based on your request ---

// AlertTriangleIcon (using the same SVG as ExclamationTriangleIcon)
export const AlertTriangleIcon: React.FC<IconPropsGeneric> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
    </svg>
);

// SettingsIcon (using the same SVG as SettingsCogIcon)
export const SettingsIcon: React.FC<IconPropsGeneric> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}><path strokeLinecap="round" strokeLinejoin="round" d="M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93L15.6 7.21c.796.317 1.272 1.26A1.5 1.5 0 0115.04 9h-6.08a1.5 1.5 0 01-1.04-2.21l1.03-1.636a1.125 1.125 0 00.78-.93l.149-.894zM12 15.75a3.75 3.75 0 100-7.5 3.75 3.75 0 000 7.5zM21.75 10.5a1.125 1.125 0 00-1.125-1.125h-2.006a1.125 1.125 0 010-2.25h2.006c.621 0 1.125-.504 1.125-1.125S21.121 3.75 20.5 3.75h-2.005a1.125 1.125 0 010-2.25H20.5a1.125 1.125 0 001.125-1.125 1.125 1.125 0 00-1.125-1.125h-.794a1.125 1.125 0 01-1.03-.62l-.149-.893a1.125 1.125 0 00-1.11-.94h-1.094a1.125 1.125 0 00-1.11.94l-.149.893a1.125 1.125 0 01-1.03.62H12a1.125 1.125 0 00-1.125 1.125 1.125 1.125 0 001.125 1.125h.794a1.125 1.125 0 011.03.62l.149.894a1.125 1.125 0 001.11.94h1.094a1.125 1.125 0 001.11-.94l.149-.894a1.125 1.125 0 011.03-.62h2.005c.621 0 1.125.504 1.125 1.125s-.504 1.125-1.125 1.125h-2.005a1.125 1.125 0 010 2.25H20.5c.621 0 1.125.504 1.125 1.125z" /></svg>
);

// XCircleIcon (New SVG)
export const XCircleIcon: React.FC<IconPropsGeneric> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);
