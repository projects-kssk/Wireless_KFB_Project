'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import type { Variants } from 'framer-motion';
import { MenuIcon, XMarkIcon } from '@/components/Icons/Icons';
import { appConfig } from '@/components/config/appConfig';
import { useSerialEvents } from './useSerialEvents';

/* ────────────────────────────────────────────────────────────────────────────
   Config
   ──────────────────────────────────────────────────────────────────────────── */
const BASE_HEADER_MIN_HEIGHT = '5.25rem';

/* ────────────────────────────────────────────────────────────────────────────
   Types
   ──────────────────────────────────────────────────────────────────────────── */
type DeviceInfo = {
  path: string;
  vendorId: string | null;
  productId: string | null;
  manufacturer: string | null;
  serialNumber: string | null;
};

/* ────────────────────────────────────────────────────────────────────────────
   Tokens
   ──────────────────────────────────────────────────────────────────────────── */
const WidgetGlass = [
  'bg-white/80 dark:bg-slate-900/55',
  'backdrop-blur-2xl',
  'border border-white/60 dark:border-white/10',
  'ring-1 ring-white/50 dark:ring-white/10',
  'shadow-[inset_0_1px_0_rgba(255,255,255,.75),_0_10px_26px_rgba(2,6,23,.10)]',
  'rounded-2xl',
].join(' ');

const SoftChip = 'px-2 py-0.5 rounded-full text-[12px] font-semibold ring-1';

const HeaderChrome = [
  "bg-[radial-gradient(140%_140%_at_0%_-20%,#f1f5ff_0%,#ffffff_52%,#fbfbff_90%)]",
  "dark:bg-[radial-gradient(160%_160%_at_0%_-30%,#020617_0%,#0b1220_60%,#0b1220_100%)]",
  'supports-[backdrop-filter]:bg-white/55',
  'border-b border-white/60 dark:border-white/10',
].join(' ');

/* ────────────────────────────────────────────────────────────────────────────
   Support CTA — compact
   ──────────────────────────────────────────────────────────────────────────── */
const SupportIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 48 48" className={className} aria-hidden>
    <g fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 21a14 14 0 0128 0" />
      <path d="M9 23a4 4 0 018 0v6a4 4 0 01-8 0z" />
      <path d="M31 23a4 4 0 018 0v6a4 4 0 01-8 0z" />
      <path d="M24 35c0 3 2 5 5 5h5" />
      <path d="M18 40l6-10 6 10" />
    </g>
  </svg>
);

const SupportPillSM: React.FC<{
  supportNumber?: string | number;
  onCall?: () => void;
  className?: string;
}> = ({ supportNumber = 621, onCall, className }) => {
  const reduce = useReducedMotion();
  const number = String(supportNumber ?? 621);
  const call = () => {
    if (onCall) return onCall();
    try { window.location.href = `tel:${number}`; } catch {}
  };

  return (
    <motion.button
      type="button"
      onClick={call}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={[
        'relative inline-flex items-center w-full h-full',
        'px-4 text-left group',
        WidgetGlass,
        className ?? '',
      ].join(' ')}
      style={{ overflow: 'hidden' }}
    >
      <div className="mr-3 shrink-0">
        <div
          className={[
            'relative flex items-center justify-center rounded-full',
            'h-10 w-10 2xl:h-12 2xl:w-12',
            'text-white',
            'bg-gradient-to-br from-violet-500 via-fuchsia-500 to-indigo-500',
            'ring-1 ring-white/50 dark:ring-white/10',
          ].join(' ')}
        >
          <SupportIcon className="h-5 w-5 2xl:h-6 2xl:w-6 opacity-95" />
          {!reduce && (
            <motion.span
              className="pointer-events-none absolute inset-0 rounded-full"
              style={{ boxShadow: '0 0 0 0 rgba(168,85,247,.45)' }}
              animate={{ boxShadow: ['0 0 0 0 rgba(168,85,247,.45)', '0 0 0 12px rgba(168,85,247,0)'] }}
              transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
            />
          )}
        </div>
      </div>
      <div className="min-w-0">
        <div className="text-[12px] font-semibold text-slate-600 dark:text-slate-300 leading-tight">Support</div>
        <div className="flex items-baseline gap-2">
          <span className="truncate text-[20px] 2xl:text-[22px] font-extrabold tracking-tight text-slate-900 dark:text-white leading-none">
            Call {number}
          </span>
        </div>
      </div>
      <svg viewBox="0 0 24 24" className="ml-auto h-5 w-5 opacity-70 group-hover:translate-x-0.5 transition-transform" aria-hidden>
        <path fill="currentColor" d="M9 6l6 6-6 6" />
      </svg>
    </motion.button>
  );
};

/* ────────────────────────────────────────────────────────────────────────────
   LEDs
   ──────────────────────────────────────────────────────────────────────────── */
type LedColor = 'green' | 'amber' | 'red';
const ledCfg = (c: LedColor) =>
  c === 'green'
    ? { a: '#34d399', b: '#10b981', rim: 'rgba(16,185,129,.5)', soft: 'bg-emerald-50 text-emerald-700 ring-emerald-200/70', strong: 'bg-emerald-600 text-white' }
    : c === 'amber'
    ? { a: '#fbbf24', b: '#f59e0b', rim: 'rgba(245,158,11,.55)', soft: 'bg-amber-50 text-amber-800 ring-amber-200/70', strong: 'bg-amber-600 text-white' }
    : { a: '#fb7185', b: '#ef4444', rim: 'rgba(244,63,94,.55)', soft: 'bg-rose-50 text-rose-700 ring-rose-200/70', strong: 'bg-rose-600 text-white' };

const LedBall: React.FC<{ color: LedColor; size?: number; title?: string }> = ({ color, size = 34, title }) => {
  const reduce = useReducedMotion();
  const cfg = ledCfg(color);
  const px = `${size}px`;
  return (
    <div className="relative shrink-0" title={title}>
      <span
        aria-hidden
        className="block rounded-full"
        style={{
          height: px, width: px,
          boxShadow: `0 0 0 4px ${cfg.rim}, 0 8px 18px rgba(2,6,23,.10), inset 0 -2px 5px rgba(0,0,0,.10), inset 0 2px 3px rgba(255,255,255,.65)`,
          background: `
            radial-gradient(120% 120% at 28% 24%, rgba(255,255,255,.92) 0%, rgba(255,255,255,0) 42%),
            radial-gradient(85% 85% at 50% 60%, ${cfg.a} 0%, ${cfg.b} 70%)
          `,
        }}
      />
      {!reduce && (
        <motion.span
          aria-hidden
          className="absolute inset-0 rounded-full"
          style={{ boxShadow: `0 0 0 0 ${cfg.rim}` }}
          animate={{ boxShadow: [`0 0 0 0 ${cfg.rim}`, `0 0 0 12px transparent`] }}
          transition={{ duration: 2.0, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}
    </div>
  );
};

/* ────────────────────────────────────────────────────────────────────────────
   Status cells in a single row (Scanner 1 | Scanner 2 | Server)
   ──────────────────────────────────────────────────────────────────────────── */
type Row = { title: string; sub?: string | null; color: LedColor; suffix?: string | number };

const StatusCell: React.FC<Row> = ({ title, sub, color, suffix }) => {
  const cfg = ledCfg(color);
  return (
    <div className="flex items-center h-full px-3 py-2">
      <LedBall color={color} />
      <div className="ml-3 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          {suffix !== undefined && <span className={[SoftChip, cfg.strong].join(' ')}>{suffix}</span>}
          {sub && <span className={[SoftChip, cfg.soft].join(' ')}>{sub}</span>}
        </div>
        <span className="truncate text-[15px] 2xl:text-[16px] font-extrabold tracking-tight text-slate-900 dark:text-white">
          {title}
        </span>
      </div>
    </div>
  );
};

const StatusRow: React.FC<{ cells: Row[]; className?: string }> = ({ cells, className }) => {
  return (
    <div className={[WidgetGlass, 'w-full h-full p-0', className ?? ''].join(' ')} style={{ overflow: 'hidden' }}>
      <div className="grid grid-cols-3 gap-3 h-full">
        {cells.slice(0, 3).map((c, i) => (
          <div key={i} className="flex">
            <StatusCell {...c} />
          </div>
        ))}
      </div>
    </div>
  );
};

/* ────────────────────────────────────────────────────────────────────────────
   Helpers
   ──────────────────────────────────────────────────────────────────────────── */
const normHex = (s?: string | null) => (s ?? '').replace(/^0x/i, '').padStart(4, '0').toLowerCase();
const pair = (vid?: string | null, pid?: string | null) => (vid && pid ? `${normHex(vid)}:${normHex(pid)}` : null);

/* ────────────────────────────────────────────────────────────────────────────
   Header (single row, fixed height from Settings cube)
   ──────────────────────────────────────────────────────────────────────────── */
interface HeaderProps {
  onSettingsClick: () => void;
  currentView: 'main' | 'settings';
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  onSettingsClick,
  currentView,
  isSidebarOpen,
  onToggleSidebar,
}) => {
  const [isHeaderVisible, setIsHeaderVisible] = useState(true);
  const [settingsSize, setSettingsSize] = useState<number>(150);
  const lastScrollY = useRef(0);

  const { devices, server, lastScan } = useSerialEvents();

  const showSidebarToggle = Boolean(
    (appConfig as any)?.showSidebarToggle ?? (appConfig as any)?.ui?.showSidebarToggle ?? false
  );

  const scanners = useMemo(
    () =>
      (appConfig as any).scanners?.length
        ? (appConfig as any).scanners
        : [{ name: 'Scanner', path: '' }, { name: 'Scanner', path: '' }],
    []
  );

  const isPresentFor = (idx: number) => {
    const cfg = (scanners as any)[idx] ?? {};
    const usbAllow = Array.isArray(cfg.usb) ? (cfg.usb as string[]).map((p) => p.toLowerCase()) : null;

    return devices.some((d: DeviceInfo) => {
      if (cfg.path && !String(d.path).includes(String(cfg.path))) return false;
      if (usbAllow) {
        const p = pair(d.vendorId, d.productId);
        if (!p || !usbAllow.includes(p)) return false;
      }
      return true;
    });
  };

  const s1 = isPresentFor(0);
  const s2 = isPresentFor(1);

  const s1Color: LedColor = s1 ? 'green' : 'red';
  const s2Color: LedColor = s2 ? 'green' : 'red';
  const s1Sub = s1 ? 'Ready' : 'Not detected';
  const s2Sub = s2 ? 'Ready' : 'Not detected';

  const serverColor: LedColor = server === 'connected' ? 'green' : 'red';
  const serverSub = server === 'connected' ? 'Online' : 'Offline';

  useEffect(() => {
    const handleScroll = () => {
      const y = window.scrollY;
      setIsHeaderVisible(y < lastScrollY.current || y <= 10);
      lastScrollY.current = y;
    };
    window.addEventListener('scroll', handleScroll, { passive: true });

    const handleResize = () => {
      const vw = typeof window !== 'undefined' ? window.innerWidth : 1600;
      const size = Math.max(120, Math.min(vw * 0.09, 160)); // clamp(120px, 9vw, 160px)
      setSettingsSize(Math.round(size));
    };
    handleResize();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  if ((appConfig as any).hideHeader) return null;

  const mainButtonText = currentView === 'settings' ? 'Dashboard' : 'Settings';

  const barVariants: Variants = {
    shown: { y: 0, transition: { type: 'spring', stiffness: 650, damping: 40 } },
    hidden: { y: -120, transition: { type: 'tween', duration: 0.25 } },
  };

  const sidebarBtnOpenMods =
    'ring-1 ring-white/70 dark:ring-white/10 translate-y-[-2px] -translate-x-[2px] shadow-[0_12px_24px_rgba(2,6,23,.18)]';

  return (
    <AnimatePresence initial={false}>
      <motion.header
        key="single-row-header"
        variants={barVariants}
        initial="shown"
        animate={isHeaderVisible ? 'shown' : 'hidden'}
        className={['w-full sticky top-0 z-30', HeaderChrome].join(' ')}
        style={{
          height: `calc(${settingsSize}px + env(safe-area-inset-top))`,
          minHeight: `calc(${BASE_HEADER_MIN_HEIGHT} + env(safe-area-inset-top))`,
        }}
      >
        <div
          className="flex items-center w-full h-full px-4 sm:px-6 2xl:px-10"
          style={{ paddingTop: 'env(safe-area-inset-top)' }}
        >
          {/* Left cluster: Call + 3 status cells in one row */}
          <div className="flex items-stretch gap-3">
            <div style={{ width: 210, height: settingsSize }}>
              <SupportPillSM
                className="h-full"
                supportNumber={(appConfig as any).callSupportInfo?.count ?? 621}
                onCall={(appConfig as any).callSupportInfo?.onCta}
              />
            </div>

            {/* Three cells wide; ensure enough room so nothing wraps */}
            <div
              style={{
                width: 'clamp(480px, 38vw, 720px)',
                height: settingsSize,
              }}
            >
              <StatusRow
                cells={[
                  { title: 'Scanner', suffix: 1, color: s1Color, sub: s1Sub },
                  { title: 'Scanner', suffix: 2, color: s2Color, sub: s2Sub },
                  { title: 'Server', color: serverColor, sub: serverSub },
                ]}
                className="h-full"
              />
            </div>
          </div>

          {/* Optional hamburger for small screens */}
          {currentView === 'main' && showSidebarToggle && (
            <motion.button
              onClick={onToggleSidebar}
              aria-label={isSidebarOpen ? 'Close Sidebar' : 'Open Sidebar'}
              whileTap={{ scale: 0.92 }}
              className={[
                'ml-3 lg:hidden',
                'h-[44px] w-[44px]',
                'flex items-center justify-center',
                'rounded-full border border-white/60 dark:border-white/10',
                'bg-white/80 dark:bg-slate-800/55 backdrop-blur-xl',
                'text-slate-700 dark:text-slate-100',
                'shadow-[0_8px_18px_rgba(0,0,0,.08)] active:shadow-inner',
                isSidebarOpen ? sidebarBtnOpenMods : '',
              ].join(' ')}
            >
              {isSidebarOpen ? <XMarkIcon className="h-6 w-6" /> : <MenuIcon className="h-6 w-6" />}
            </motion.button>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Right: Settings cube */}
          <motion.button
            type="button"
            aria-label={mainButtonText}
            onClick={onSettingsClick}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.98 }}
            className={[
              'hidden lg:flex flex-col items-center justify-center',
              'font-semibold tracking-tight',
              'text-slate-900 dark:text-slate-50',
              WidgetGlass,
            ].join(' ')}
            style={{ width: settingsSize, height: settingsSize }}
          >
            <div
              aria-hidden
              className="flex items-center justify-center rounded-2xl h-[82%] w-[82%] bg-gradient-to-b from-slate-50 to-white ring-1 ring-slate-200/70 shadow-inner mb-1"
            >
              <svg viewBox="0 0 48 48" className="h-[72%] w-[72%]" role="img" aria-label="Settings">
                <defs>
                  <radialGradient id="gearBg" cx="50%" cy="45%" r="60%">
                    <stop offset="0%" stopColor="#3f3f46" />
                    <stop offset="100%" stopColor="#1f2937" />
                  </radialGradient>
                  <linearGradient id="tooth" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#d1d5db" />
                    <stop offset="100%" stopColor="#9ca3af" />
                  </linearGradient>
                  <linearGradient id="rim" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#9ca3af" />
                    <stop offset="100%" stopColor="#6b7280" />
                  </linearGradient>
                </defs>
                <circle cx="24" cy="24" r="17.5" fill="url(#gearBg)" />
                <circle cx="24" cy="24" r="17" fill="none" stroke="url(#rim)" strokeWidth="2" opacity="0.9" />
                <circle cx="24" cy="24" r="16" fill="none" stroke="url(#tooth)" strokeWidth="5" strokeLinecap="round" strokeDasharray="1.4 3.1" transform="rotate(-8 24 24)" opacity="0.95" />
                <circle cx="24" cy="24" r="9.5" fill="none" stroke="url(#rim)" strokeWidth="2.2" opacity="0.9" />
                <g stroke="url(#tooth)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" opacity="0.95">
                  <path d="M24 24 L24 12.5" />
                  <path d="M24 24 L34.392 30.25" transform="rotate(120 24 24)" />
                  <path d="M24 24 L34.392 30.25" transform="rotate(240 24 24)" />
                </g>
                <circle cx="24" cy="24" r="3.2" fill="#e5e7eb" />
              </svg>
            </div>
            <span className="text-lg 2xl:text-xl">{mainButtonText}</span>
          </motion.button>
        </div>
      </motion.header>
    </AnimatePresence>
  );
};

export default Header;
