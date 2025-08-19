'use client';

import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
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
   Strict header chrome
   ──────────────────────────────────────────────────────────────────────────── */
const StrictHeaderBg = [
  "bg-[radial-gradient(140%_140%_at_0%_-20%,#f6f8ff_0%,#ffffff_60%,#fafafe_100%)]",
  "dark:bg-[radial-gradient(160%_160%_at_0%_-30%,#0b1220_0%,#0b1220_70%,#070d19_100%)]",
  'border-b border-slate-200/70 dark:border-slate-800',
].join(' ');

/* ────────────────────────────────────────────────────────────────────────────
   Support CTA — strict
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
  labelsHidden?: boolean;
}> = ({ supportNumber = 621, onCall, className, labelsHidden }) => {
  const reduce = useReducedMotion();
  const number = String(supportNumber ?? 621);
  const call = () => {
    if (onCall) return onCall();
    try {
      window.location.href = `tel:${number}`;
    } catch {}
  };

  return (
    <motion.button
      type="button"
      onClick={call}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={[
        'relative inline-flex items-center w-full h-full px-4 text-left group',
        'bg-transparent',
        className ?? '',
      ].join(' ')}
      style={{ overflow: 'hidden', willChange: 'transform,opacity' }}
    >
      <div className="mr-3 shrink-0">
        <div
          className={[
            'relative flex items-center justify-center rounded-full',
            'h-10 w-10 2xl:h-12 2xl:w-12',
            'text-white',
            'bg-gradient-to-br from-violet-500 via-fuchsia-500 to-indigo-500',
          ].join(' ')}
        >
          <SupportIcon className="h-5 w-5 2xl:h-6 2xl:w-6 opacity-95" />

          {/* GPU-friendly pulse: scale + fade, not box-shadow */}
          {!reduce && (
            <motion.span
              className="pointer-events-none absolute inset-0 rounded-full"
              style={{ border: '2px solid rgba(168,85,247,.35)' }}
              initial={{ scale: 1, opacity: 0.7 }}
              animate={{ scale: [1, 1.35], opacity: [0.7, 0] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: 'easeOut' }}
            />
          )}
        </div>
      </div>

      {labelsHidden ? (
        <span className="text-[20px] 2xl:text-[22px] font-extrabold tracking-tight text-slate-900 dark:text-white leading-none">
          {number}
        </span>
      ) : (
        <div className="min-w-0">
          <div className="text-[12px] font-semibold text-slate-600 dark:text-slate-300 leading-tight">Support</div>
          <div className="flex items-baseline gap-2">
            <span className="truncate text-[20px] 2xl:text-[22px] font-extrabold tracking-tight text-slate-900 dark:text-white leading-none">
              Call {number}
            </span>
          </div>
        </div>
      )}
    </motion.button>
  );
};

/* ────────────────────────────────────────────────────────────────────────────
   LEDs
   ──────────────────────────────────────────────────────────────────────────── */
type LedColor = 'green' | 'amber' | 'red';
const ledCfg = (c: LedColor) =>
  c === 'green'
    ? { a: '#34d399', b: '#10b981', rim: 'rgba(16,185,129,.45)' }
    : c === 'amber'
    ? { a: '#fbbf24', b: '#f59e0b', rim: 'rgba(245,158,11,.45)' }
    : { a: '#fb7185', b: '#ef4444', rim: 'rgba(244,63,94,.45)' };

const LedBallBase: React.FC<{ color: LedColor; size?: number; title?: string }> = ({ color, size = 34, title }) => {
  const reduce = useReducedMotion();
  const cfg = ledCfg(color);
  const px = `${size}px`;
  return (
    <div className="relative shrink-0" title={title}>
      <span
        aria-hidden
        className="block rounded-full"
        style={{
          height: px,
          width: px,
          boxShadow: `0 0 0 4px ${cfg.rim}`, // static, cheap
          background: `
            radial-gradient(120% 120% at 28% 24%, rgba(255,255,255,.92) 0%, rgba(255,255,255,0) 42%),
            radial-gradient(85% 85% at 50% 60%, ${cfg.a} 0%, ${cfg.b} 70%)
          `,
        }}
      />
      {/* GPU-friendly halo instead of animated box-shadow */}
      {!reduce && (
        <motion.span
          aria-hidden
          className="absolute inset-0 rounded-full"
          style={{ border: `2px solid ${cfg.rim}`, willChange: 'transform,opacity' }}
          initial={{ scale: 1, opacity: 0.6 }}
          animate={{ scale: [1, 1.4], opacity: [0.6, 0] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeOut' }}
        />
      )}
    </div>
  );
};
const LedBall = memo(LedBallBase);

/* ────────────────────────────────────────────────────────────────────────────
   Status cells
   ──────────────────────────────────────────────────────────────────────────── */
type Row = { title: string; sub?: string | null; color: LedColor; suffix?: string | number };

const StatusCellBase: React.FC<Row & { labelsHidden?: boolean }> = ({ title, sub, color, suffix, labelsHidden }) => {
  return (
    <div className="flex items-center h-full px-3 py-2">
      <LedBall color={color} />
      {!labelsHidden && (
        <div className="ml-3 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            {suffix !== undefined && (
              <span className="px-2 py-0.5 rounded-full text-[12px] font-semibold ring-1 ring-slate-200 bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900">
                {suffix}
              </span>
            )}
            {sub && (
              <span className="px-2 py-0.5 rounded-full text-[12px] font-semibold ring-1 ring-slate-200 text-slate-700 bg-slate-50 dark:text-slate-200 dark:bg-slate-800">
                {sub}
              </span>
            )}
          </div>
          <span className="truncate text-[15px] 2xl:text-[16px] font-extrabold tracking-tight text-slate-900 dark:text-white">
            {title}
          </span>
        </div>
      )}
    </div>
  );
};
const StatusCell = memo(StatusCellBase);

const StatusRow: React.FC<{ cells: Row[]; className?: string; labelsHidden?: boolean }> = ({
  cells,
  className,
  labelsHidden,
}) => {
  return (
    <div className={['w-full h-full p-0', className ?? ''].join(' ')} style={{ overflow: 'hidden' }}>
      <div className="grid grid-cols-3 gap-3 h-full">
        {cells.slice(0, 3).map((c, i) => (
          <div key={i} className="flex">
            <StatusCell {...c} labelsHidden={labelsHidden} />
          </div>
        ))}
      </div>
    </div>
  );
};

/* ────────────────────────────────────────────────────────────────────────────
   iOS-like Settings glyph (tight, layered rings + spokes)
   ──────────────────────────────────────────────────────────────────────────── */
const IOSSettingsGlyph: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 64 64" className={className} role="img" aria-label="Settings">
    <defs>
      <linearGradient id="g-alum" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0%" stopColor="#cfd4dc" />
        <stop offset="100%" stopColor="#9aa3ae" />
      </linearGradient>
      <linearGradient id="g-dark" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0%" stopColor="#47515d" />
        <stop offset="100%" stopColor="#1f2937" />
      </linearGradient>
      <linearGradient id="g-rim" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0%" stopColor="#a6adb7" />
        <stop offset="100%" stopColor="#6b7280" />
      </linearGradient>
    </defs>

    {/* outer rim */}
    <circle cx="32" cy="32" r="24" fill="url(#g-alum)" />
    <circle cx="32" cy="32" r="23.3" fill="none" stroke="url(#g-rim)" strokeWidth="1.4" />

    {/* big tooth ring */}
    <circle
      cx="32"
      cy="32"
      r="20"
      fill="none"
      stroke="url(#g-alum)"
      strokeWidth="5.8"
      strokeLinecap="round"
      strokeDasharray="1.35 2.9"
      transform="rotate(-6 32 32)"
      opacity="0.95"
    />

    {/* middle tooth ring */}
    <circle
      cx="32"
      cy="32"
      r="13.5"
      fill="none"
      stroke="url(#g-alum)"
      strokeWidth="4.6"
      strokeLinecap="round"
      strokeDasharray="1.1 2.3"
      transform="rotate(8 32 32)"
      opacity="0.95"
    />

    {/* inner rim */}
    <circle cx="32" cy="32" r="11.6" fill="none" stroke="url(#g-rim)" strokeWidth="2" opacity="0.9" />

    {/* three spokes */}
    <g stroke="url(#g-alum)" strokeWidth="3.1" strokeLinecap="round" strokeLinejoin="round" opacity="0.95">
      <path d="M32 32 L32 17" />
      <path d="M32 32 L46 40" transform="rotate(120 32 32)" />
      <path d="M32 32 L46 40" transform="rotate(240 32 32)" />
    </g>

    {/* hub */}
    <circle cx="32" cy="32" r="6.4" fill="url(#g-dark)" />
    <circle cx="32" cy="32" r="3.6" fill="#e7e9ee" />
  </svg>
);

/* ────────────────────────────────────────────────────────────────────────────
   Settings button
   ──────────────────────────────────────────────────────────────────────────── */
const SettingsIconButtonBase: React.FC<{
  size: number;
  label: string;
  onClick: () => void;
  showLabel: boolean;
}> = ({ size, label, onClick, showLabel }) => {
  const fontPx = Math.round(Math.max(14, Math.min(size * 0.13, 22)));
  return (
    <motion.button
      type="button"
      aria-label={label}
      onClick={onClick}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.98 }}
      className="hidden lg:flex flex-col items-center justify-center bg-transparent"
      style={{ width: size, height: size, willChange: 'transform' }}
    >
      <IOSSettingsGlyph className="h-[72%] w-[72%]" />
      {showLabel && (
        <span className="mt-1 font-semibold tracking-tight text-slate-900 dark:text-slate-50" style={{ fontSize: fontPx }}>
          {label}
        </span>
      )}
    </motion.button>
  );
};
const SettingsIconButton = memo(SettingsIconButtonBase);

/* ────────────────────────────────────────────────────────────────────────────
   Helpers
   ──────────────────────────────────────────────────────────────────────────── */
const normHex = (s?: string | null) => (s ?? '').replace(/^0x/i, '').padStart(4, '0').toLowerCase();
const pair = (vid?: string | null, pid?: string | null) => (vid && pid ? `${normHex(vid)}:${normHex(pid)}` : null);

/* ────────────────────────────────────────────────────────────────────────────
   Header
   ──────────────────────────────────────────────────────────────────────────── */
interface HeaderProps {
  onSettingsClick: () => void;
  currentView: 'main' | 'settings';
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
  /** Hide all text. Show only LEDs, settings icon, and call number. */
  labelsHidden?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  onSettingsClick,
  currentView,
  isSidebarOpen,
  onToggleSidebar,
  labelsHidden = false,
}) => {
  const [isHeaderVisible, setIsHeaderVisible] = useState(true);
  const [settingsSize, setSettingsSize] = useState<number>(150);

  // rAF-throttled scroll/resize
  const lastScrollY = useRef(0);
  const isHeaderVisibleRef = useRef(true);
  const rafId = useRef<number | null>(null);
  const resizeRafId = useRef<number | null>(null);

  const { devices, server } = useSerialEvents();

  const showSidebarToggle = Boolean(
    (appConfig as any)?.showSidebarToggle ?? (appConfig as any)?.ui?.showSidebarToggle ?? false,
  );

  const scanners = useMemo(
    () =>
      (appConfig as any).scanners?.length
        ? (appConfig as any).scanners
        : [{ name: 'Scanner', path: '' }, { name: 'Scanner', path: '' }],
    [],
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
    const threshold = 8; // dampen flicker
    const onScroll = () => {
      if (rafId.current != null) return;
      rafId.current = window.requestAnimationFrame(() => {
        rafId.current = null;
        const y = window.scrollY || 0;

        const scrolledUp = y < lastScrollY.current - threshold;
        const nearTop = y <= 10;
        const nextVisible = scrolledUp || nearTop;

        if (nextVisible !== isHeaderVisibleRef.current) {
          isHeaderVisibleRef.current = nextVisible;
          setIsHeaderVisible(nextVisible);
        }
        lastScrollY.current = y;
      });
    };

    const onResize = () => {
      if (resizeRafId.current != null) return;
      resizeRafId.current = window.requestAnimationFrame(() => {
        resizeRafId.current = null;
        const vw = typeof window !== 'undefined' ? window.innerWidth : 1600;
        const size = Math.max(120, Math.min(vw * 0.09, 160)); // clamp(120px, 9vw, 160px)
        setSettingsSize(Math.round(size));
      });
    };

    // init
    onResize();

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      if (rafId.current) cancelAnimationFrame(rafId.current);
      if (resizeRafId.current) cancelAnimationFrame(resizeRafId.current);
    };
  }, []);

  if ((appConfig as any).hideHeader) return null;

  const mainButtonText = currentView === 'settings' ? 'Dashboard' : 'Settings';

  const barVariants: Variants = {
    shown: {
      y: 0,
      transition: { type: 'spring', stiffness: 420, damping: 42, mass: 0.8 },
    },
    hidden: {
      y: -120,
      transition: { type: 'tween', duration: 0.18, ease: [0.22, 1, 0.36, 1] },
    },
  };

  return (
    <AnimatePresence initial={false}>
      <motion.header
        key="single-row-header"
        variants={barVariants}
        initial="shown"
        animate={isHeaderVisible ? 'shown' : 'hidden'}
        className={['w-full sticky top-0 z-30', StrictHeaderBg].join(' ')}
        style={{
          height: `calc(${settingsSize}px + env(safe-area-inset-top))`,
          minHeight: `calc(${BASE_HEADER_MIN_HEIGHT} + env(safe-area-inset-top))`,
          willChange: 'transform',
          backfaceVisibility: 'hidden',
          transform: 'translateZ(0)',
        }}
      >
        <div
          className="flex items-center w-full h-full px-4 sm:px-6 2xl:px-10"
          style={{ paddingTop: 'env(safe-area-inset-top)' }}
        >
          {/* Left cluster: Call + 3 LEDs */}
          <div className="flex items-stretch gap-3">
            <div style={{ width: 210, height: settingsSize }}>
              <SupportPillSM
                className="h-full"
                supportNumber={(appConfig as any).callSupportInfo?.count ?? 621}
                onCall={(appConfig as any).callSupportInfo?.onCta}
                labelsHidden={labelsHidden}
              />
            </div>

            <div style={{ width: 'clamp(360px, 34vw, 720px)', height: settingsSize }}>
              <StatusRow
                cells={[
                  { title: 'Scanner', suffix: 1, color: s1Color, sub: s1Sub },
                  { title: 'Scanner', suffix: 2, color: s2Color, sub: s2Sub },
                  { title: 'Server', color: serverColor, sub: serverSub },
                ]}
                className="h-full"
                labelsHidden={labelsHidden}
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
                'ml-3 lg:hidden h-[44px] w-[44px] flex items-center justify-center rounded-full',
                'bg-transparent text-slate-700 dark:text-slate-100',
              ].join(' ')}
              style={{ willChange: 'transform' }}
            >
              {isSidebarOpen ? <XMarkIcon className="h-6 w-6" /> : <MenuIcon className="h-6 w-6" />}
            </motion.button>
          )}

          <div className="flex-1" />

          {/* Right: Settings icon only, optional label */}
          <SettingsIconButton
            size={settingsSize}
            label={mainButtonText}
            onClick={onSettingsClick}
            showLabel={!labelsHidden}
          />
        </div>
      </motion.header>
    </AnimatePresence>
  );
};

export default Header;
