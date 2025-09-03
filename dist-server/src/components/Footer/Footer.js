'use client';
import React from "react";
const Footer = () => {
    const copyrightText = `© ${new Date().getFullYear()} Kromberg Schubert s.r.o. All rights reserved.`;
    return (<footer className="w-full py-6 px-4 sm:px-6 bg-slate-100 dark:bg-slate-800/50 border-t border-slate-200 dark:border-slate-700 text-center">
            <p className="text-sm text-slate-600 dark:text-slate-400">
                {copyrightText}
            </p>
        </footer>);
};
export default Footer;
