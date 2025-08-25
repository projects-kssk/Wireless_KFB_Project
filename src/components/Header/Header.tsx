'use client';

import React, { memo, useEffect, useRef, useState } from 'react';
import { m, AnimatePresence, useReducedMotion } from 'framer-motion';
import type { Variants } from 'framer-motion';
import { appConfig } from '@/components/config/appConfig';
import { useSerialEvents } from './useSerialEvents';

/* ────────────────────────────────────────────────────────────────────────────
   Config
   ──────────────────────────────────────────────────────────────────────────── */
const BASE_HEADER_MIN_HEIGHT = '5.25rem';
const scanners = appConfig.scanners as any[];

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

type LedColor = 'green' | 'amber' | 'red';

type StatusCellProps = {
  title: string;
  sub?: React.ReactNode;
  suffix?: React.ReactNode;
  color: LedColor;
  labelsHidden?: boolean;
  className?: string;
  align?: 'left' | 'center' | 'right';
};

/* add this type once near the top */
type Row = { title: string; sub?: string | null; color: LedColor; suffix?: string | number };


/* ────────────────────────────────────────────────────────────────────────────
   Header chrome
   ──────────────────────────────────────────────────────────────────────────── */
const StrictHeaderBg = [
  'bg-[radial-gradient(140%_140%_at_0%_-20%,#f6f8ff_0%,#ffffff_60%,#fafafe_100%)]',
  'dark:bg-[radial-gradient(160%_160%_at_0%_-30%,#0b1220_0%,#0b1220_70%,#070d19_100%)]',
  'border-b border-slate-200/70 dark:border-slate-800',
].join(' ');

/* ────────────────────────────────────────────────────────────────────────────
   Support CTA
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
    <m.button
      type="button"
      onClick={call}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={['relative inline-flex items-center w-full h-full px-4 text-left group', 'bg-transparent', className ?? ''].join(' ')}
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
          {!reduce && (
            <m.span
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
    </m.button>
  );
};

/* ────────────────────────────────────────────────────────────────────────────
   LEDs
   ──────────────────────────────────────────────────────────────────────────── */
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
          boxShadow: `0 0 0 4px ${cfg.rim}`,
          background: `
            radial-gradient(120% 120% at 28% 24%, rgba(255,255,255,.92) 0%, rgba(255,255,255,0) 42%),
            radial-gradient(85% 85% at 50% 60%, ${cfg.a} 0%, ${cfg.b} 70%)
          `,
        }}
      />
      {!reduce && (
        <m.span
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
const Pill: React.FC<{ variant?: 'primary' | 'muted'; children: React.ReactNode }> = ({ variant = 'muted', children }) => (
  <span
    className={[
      'px-2 py-0.5 rounded-full text-[12px] font-semibold ring-1 ring-slate-200',
      variant === 'primary'
        ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900'
        : 'text-slate-700 bg-slate-50 dark:text-slate-200 dark:bg-slate-800',
    ].join(' ')}
  >
    {children}
  </span>
);

// StatusCell: full-height, centered
const StatusCellBase: React.FC<Row & { labelsHidden?: boolean }> = ({
  title, sub, color, suffix, labelsHidden,
}) => (
  <div className="flex h-full items-center gap-3 px-3">
    <div className="shrink-0 overflow-hidden rounded-full">
      <LedBall color={color} />
    </div>
    {!labelsHidden && (
      <div className="min-w-0">
        <div className="mb-0.5 flex items-center gap-2">
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

const StatusCell = memo(StatusCellBase);

// StatusRow: flex = full width, equal columns, clip halo overflow
const StatusRow: React.FC<{ cells: Row[]; className?: string; labelsHidden?: boolean }> = ({
  cells, className, labelsHidden,
}) => (
  <div className={['w-full h-full p-0 min-w-0', className ?? ''].join(' ')}>
    <div className="flex h-full  ">
      {cells.slice(0, 3).map((c, i) => (
        <div key={i} className="flex-1 min-w-0 flex items-center overflow-hidden">
          <StatusCell {...c} labelsHidden={labelsHidden} />
        </div>
      ))}
    </div>
  </div>
);


/* ────────────────────────────────────────────────────────────────────────────
   iOS-like Settings glyph
   ──────────────────────────────────────────────────────────────────────────── */
type SettingsIconProps = { size?: number | string; className?: string; title?: string; animate?: boolean };

export const IOSSettingsIconPro: React.FC<SettingsIconProps> = ({ size = 64, className, title = 'Settings' }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width={size} height={size} className={className} role="img" aria-label={title}>
    <defs>
      <radialGradient id="bg" cx="28%" cy="20%" r="85%">
        <stop offset="0%" stopColor="#eef1f6" />
        <stop offset="55%" stopColor="#cfd5de" />
        <stop offset="100%" stopColor="#9aa3ae" />
      </radialGradient>
      <linearGradient id="bg-stroke" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0%" stopColor="#ffffff" stopOpacity="0.8" />
        <stop offset="100%" stopColor="#6b7280" stopOpacity="0.7" />
      </linearGradient>
      <linearGradient id="metal" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0%" stopColor="#cfd4dc" />
        <stop offset="100%" stopColor="#9aa3ae" />
      </linearGradient>
      <linearGradient id="rim" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0%" stopColor="#a7aeb9" />
        <stop offset="100%" stopColor="#68707e" />
      </linearGradient>
      <linearGradient id="dial" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0%" stopColor="#4a5563" />
        <stop offset="100%" stopColor="#111827" />
      </linearGradient>
      <radialGradient id="hub" cx="50%" cy="40%" r="65%">
        <stop offset="0%" stopColor="#f2f4f8" />
        <stop offset="100%" stopColor="#bfc5cf" />
      </radialGradient>
      <filter id="innerShadow" x="-20%" y="-20%" width="140%" height="140%">
        <feOffset dx="0" dy="1" />
        <feGaussianBlur stdDeviation="1.2" result="b" />
        <feComposite in="SourceGraphic" in2="b" operator="arithmetic" k2="-1" k3="1" />
        <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .35 0" />
      </filter>
      <filter id="softDrop" x="-30%" y="-30%" width="160%" height="160%">
        <feDropShadow dx="0" dy="1.2" stdDeviation="1.2" floodOpacity="0.35" />
      </filter>
      <mask id="squircleMask">
        <rect x="2" y="2" width="60" height="60" rx="14" fill="#fff" />
      </mask>
    </defs>

    <rect x="2" y="2" width="60" height="60" rx="14" fill="url(#bg)" />
    <rect x="2.5" y="2.5" width="59" height="59" rx="13.5" fill="none" stroke="url(#bg-stroke)" />

    <g mask="url(#squircleMask)">
      <circle cx="32" cy="32" r="23.5" fill="url(#dial)" filter="url(#innerShadow)" />
      <circle cx="32" cy="32" r="22.8" fill="none" stroke="url(#rim)" strokeWidth="1.6" opacity="0.9" />
      <g filter="url(#softDrop)">
        <circle
          cx="32"
          cy="32"
          r="19.2"
          fill="none"
          stroke="url(#metal)"
          strokeWidth="5.6"
          strokeLinecap="round"
          strokeDasharray="1.25 2.6"
          transform="rotate(-8 32 32)"
          opacity="0.96"
        />
        <circle
          cx="32"
          cy="32"
          r="13.2"
          fill="none"
          stroke="url(#metal)"
          strokeWidth="4.4"
          strokeLinecap="round"
          strokeDasharray="1.05 2.15"
          transform="rotate(10 32 32)"
          opacity="0.96"
        />
        <circle cx="32" cy="32" r="11.2" fill="none" stroke="url(#rim)" strokeWidth="1.9" opacity="0.92" />
        <g stroke="url(#metal)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" opacity="0.96">
          <path d="M32 32 L32 17.2" />
          <path d="M32 32 L46 40" transform="rotate(120 32 32)" />
          <path d="M32 32 L46 40" transform="rotate(240 32 32)" />
        </g>
        <circle cx="32" cy="32" r="6.6" fill="url(#dial)" />
        <circle cx="32" cy="32" r="3.8" fill="url(#hub)" />
        <path d="M18 20 A20 20 0 0 1 28 12" fill="none" stroke="#fff" strokeOpacity="0.35" strokeWidth="1.2" />
        <path d="M40 52 A20 20 0 0 0 50 42" fill="none" stroke="#000" strokeOpacity="0.15" strokeWidth="1.2" />
      </g>
    </g>
  </svg>
);

/* ────────────────────────────────────────────────────────────────────────────
   Settings button
   ──────────────────────────────────────────────────────────────────────────── */
const SettingsIconButtonBase: React.FC<{ size: number; label: string; onClick: () => void; showLabel: boolean }> = ({
  size,
  label,
  onClick,
  showLabel,
}) => {
  const fontPx = Math.round(Math.max(14, Math.min(size * 0.13, 22)));
  return (
    <m.button
      type="button"
      aria-label={label}
      onClick={onClick}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.98 }}
      className="hidden lg:flex flex-col items-center justify-center bg-transparent"
      style={{ width: size, height: size, willChange: 'transform' }}
    >
      <IOSSettingsIconPro className="h-[72%] w-[72%]" size="100%" title={label} />
      {showLabel && (
        <span className="mt-1 font-semibold tracking-tight text-slate-900 dark:text-slate-50" style={{ fontSize: fontPx }}>
          {label}
        </span>
      )}
    </m.button>
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
  labelsHidden?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  onSettingsClick,
  currentView,
  isSidebarOpen: _isSidebarOpen, // reserved for future mobile sidebar
  onToggleSidebar: _onToggleSidebar,
  labelsHidden = false,
}) => {
  const [isHeaderVisible, setIsHeaderVisible] = useState(true);
  const [settingsSize, setSettingsSize] = useState<number>(150);

  const lastScrollY = useRef(0);
  const isHeaderVisibleRef = useRef(true);
  const rafId = useRef<number | null>(null);
  const resizeRafId = useRef<number | null>(null);

  const { devices, server, scannerPorts: ports } = useSerialEvents();

  type SlotState = { present: boolean; open: boolean };
  const slotState = (idx: number): SlotState => {
    const cfg = (scanners as any)[idx] ?? {};
    const wantPath = String(cfg.path ?? '').trim();
    const usbAllow = Array.isArray(cfg.usb) ? (cfg.usb as string[]).map((p) => p.toLowerCase()) : null;

    const matchDevice = (d: DeviceInfo) => {
      if (wantPath && String(d.path).trim() !== wantPath) return false;
      if (usbAllow) {
        const p = pair(d.vendorId, d.productId);
        if (!p || !usbAllow.includes(p)) return false;
      }
      return true;
    };

    const present = devices.some(matchDevice);
    let open = false;
    if (wantPath && ports[wantPath]) open = !!ports[wantPath].open;
    return { present, open };
  };

  const s1 = slotState(0);
  const s2 = slotState(1);

  const colorFor = (s: SlotState): LedColor => (s.open ? 'green' : s.present ? 'green' : 'red');
  const subFor = (s: SlotState) => (s.open ? 'Ready' : s.present ? 'Detected' : 'Not detected');

  const s1Color: LedColor = colorFor(s1);
  const s1Sub = subFor(s1);
  const s2Color: LedColor = colorFor(s2);
  const s2Sub = subFor(s2);

  const serverColor: LedColor = server === 'connected' ? 'green' : 'red';
  const serverSub = server === 'connected' ? 'Online' : 'Offline';

  useEffect(() => {
    const threshold = 8;
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
        const size = Math.max(120, Math.min(vw * 0.09, 160)); // clamp
        setSettingsSize(Math.round(size));
      });
    };

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
    shown: { y: 0, transition: { type: 'spring', stiffness: 420, damping: 42, mass: 0.8 } },
    hidden: { y: -120, transition: { type: 'tween', duration: 0.18, ease: [0.22, 1, 0.36, 1] } },
  };

  return (
    <AnimatePresence initial={false}>
      <m.header
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
  className="grid w-full h-full items-center gap-3 px-4 sm:px-6 2xl:px-10"
  style={{ paddingTop: 'env(safe-area-inset-top)', gridTemplateColumns: 'minmax(190px,220px) 1fr minmax(120px,160px)' }}
>
  {/* 1) Support (fixed) */}
  <div className="h-full">
    <SupportPillSM
      className="h-full"
      supportNumber={(appConfig as any).callSupportInfo?.count ?? 621}
      onCall={(appConfig as any).callSupportInfo?.onCta}
      labelsHidden={labelsHidden}
    />
  </div>

  {/* 2) Status (fills remaining width) */}
  <div className="h-full min-w-0">
    <StatusRow
      cells={[
        { title: 'Scanner Check', suffix: 1, color: s1Color, sub: s1Sub },
        { title: 'Scanner Setup', suffix: 2, color: s2Color, sub: s2Sub },
        { title: 'Server', color: serverColor, sub: serverSub },
      ]}
      className="h-full"
      labelsHidden={labelsHidden}
    />
  </div>

  {/* 3) Settings (auto) */}
  {!process.env.NEXT_PUBLIC_HIDE_SETTINGS && (
    <SettingsIconButton
      size={settingsSize}
      label={currentView === 'settings' ? 'Dashboard' : 'Settings'}
      onClick={onSettingsClick}
      showLabel={!labelsHidden}
    />
  )}
</div>

      </m.header>
    </AnimatePresence>
  );
};

export default Header;
