
'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { XMarkIcon, SettingsHomeIcon, SettingsCogIcon, SettingsCubeIcon } from '@/components/Icons/Icons';
import { appConfig } from '@/components/config/appConfig';


/* ────────────────────────────────────────────────────────────────────────────
   Types
   ──────────────────────────────────────────────────────────────────────────── */
type SettingsSectionId = 'MAIN_S' | 'CONFIG_S' | 'BRANCHES_S';

interface SettingsRightSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  appHeaderHeight: string; // API compatibility
  onShowConfigurationInMain: () => void;
  onShowBranchesSettingsInMain: () => void;
}

/* ────────────────────────────────────────────────────────────────────────────
   Styles (no viewport blur, lighter shadows, no transform hover)
   ──────────────────────────────────────────────────────────────────────────── */
const SheetGlass =
  'bg-[linear-gradient(145deg,rgba(255,255,255,0.92),rgba(246,248,255,0.78))] ' +
  'dark:bg-[linear-gradient(145deg,rgba(10,16,28,0.9),rgba(15,23,42,0.78))] ' +
  'backdrop-blur-xl border border-white/60 dark:border-white/10 ' +
  'shadow-[0_20px_60px_rgba(2,6,23,0.40)]';

const TileGlass =
  'bg-[linear-gradient(180deg,rgba(255,255,255,0.9),rgba(245,247,255,0.76))] ' +
  'dark:bg-[linear-gradient(180deg,rgba(30,41,59,0.8),rgba(30,41,59,0.64))] ' +
  'backdrop-blur-xl border border-white/60 dark:border-white/10 ' +
  'shadow-[0_12px_36px_-10px_rgba(2,6,23,0.40)]';

const Aura =
  'pointer-events-none absolute inset-0 rounded-[36px] ' +
  'bg-[radial-gradient(900px_560px_at_50%_35%,rgba(99,102,241,0.10),transparent_60%),' +
  'radial-gradient(800px_520px_at_50%_85%,rgba(56,189,248,0.10),transparent_70%)]';

/* ────────────────────────────────────────────────────────────────────────────
   Locks (no global 1s parent ticker)
   ──────────────────────────────────────────────────────────────────────────── */
const LOCK_MS = 5 * 60 * 1000;
const LOCK_STORAGE_KEY = 'settingsLocksV1';
type LockMap = Record<SettingsSectionId, number | null>;

function fmtClock(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m.toString().padStart(2, '0')}:${r.toString().padStart(2, '0')}`;
}

/* ────────────────────────────────────────────────────────────────────────────
   Component
   ──────────────────────────────────────────────────────────────────────────── */
export default function SettingsRightSidebar({
  isOpen,
  onClose,
  appHeaderHeight: _appHeaderHeight, // API compatibility
  onShowConfigurationInMain,
  onShowBranchesSettingsInMain,
}: SettingsRightSidebarProps) {
  if (!isOpen) return null;

  const otpLength = appConfig?.otpLength ?? 4;
  const [activeSection, setActiveSection] = useState<SettingsSectionId>('MAIN_S');


  // Locks
  const [locks, setLocks] = useState<LockMap>({ MAIN_S: null, CONFIG_S: null, BRANCHES_S: null });
  const expiryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // PIN
  const [pinMode, setPinMode] = useState(false);
  const [pinTarget, setPinTarget] = useState<SettingsSectionId | null>(null);
  const [attemptsLeft, setAttemptsLeft] = useState(3);
  const [pinError, setPinError] = useState('');

  // No local lock persistence; in-memory only

  // Schedule a single timeout for the next expiry
  const scheduleNextExpiry = useCallback((map: LockMap) => {
    if (expiryTimerRef.current) {
      clearTimeout(expiryTimerRef.current);
      expiryTimerRef.current = null;
    }
    const now = Date.now();
    const upcoming = (Object.values(map).filter(Boolean) as number[]).map((t) => Math.max(0, t - now));
    if (upcoming.length === 0) return;
    const nextIn = Math.min(...upcoming);
    expiryTimerRef.current = setTimeout(() => {
      setLocks((prev) => {
        const n = Date.now();
        const next: LockMap = { ...prev };
        (Object.keys(prev) as SettingsSectionId[]).forEach((k) => {
          const until = prev[k];
          if (until && until <= n) next[k] = null;
        });
        scheduleNextExpiry(next);
        return next;
      });
    }, nextIn + 5);
  }, []);

  useEffect(() => {
    scheduleNextExpiry(locks);
    return () => {
      if (expiryTimerRef.current) clearTimeout(expiryTimerRef.current);
    };
  }, [locks, scheduleNextExpiry]);

  // ESC to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const isLocked = (id: SettingsSectionId) => {
    const until = locks[id];
    return !!(until && until > Date.now());
  };
  const lockUntil = (id: SettingsSectionId) => locks[id];

  const goToPin = (target: SettingsSectionId) => {
    if (isLocked(target)) return;
    setPinTarget(target);
    setAttemptsLeft(3);
    setPinError('');
    setPinMode(true);
  };

  const handleTileClick = (sectionId: SettingsSectionId) => {
    if (sectionId === 'MAIN_S') {
      setActiveSection('MAIN_S');
      setPinMode(false);
      setPinTarget(null);
      return;
    }
    goToPin(sectionId);
  };

  const lockTarget = (target: SettingsSectionId) => {
    const until = Date.now() + LOCK_MS;
    setLocks((prev) => ({ ...prev, [target]: until }));
  };

  const handlePinSubmit = (code: string) => {
    if (code === appConfig.correctOtp) {
      if (pinTarget === 'CONFIG_S') {
        setActiveSection('CONFIG_S');
        onShowConfigurationInMain();
        onClose();
      } else if (pinTarget === 'BRANCHES_S') {
        setActiveSection('BRANCHES_S');
        onShowBranchesSettingsInMain();
        onClose();
      }
      setPinMode(false);
      setPinTarget(null);
      setPinError('');
      return;
    }
    const next = attemptsLeft - 1;
    setAttemptsLeft(next);
    setPinError(next > 0 ? `Incorrect PIN. ${next} attempt${next === 1 ? '' : 's'} left.` : 'Too many incorrect attempts. Access denied.');
    if (next <= 0 && pinTarget) {
      lockTarget(pinTarget);
      setTimeout(() => {
        setPinMode(false);
        setPinTarget(null);
        setPinError('');
        setAttemptsLeft(3);
      }, 200);
    }
  };

  return (
    <>
      {/* Backdrop: no blur, no animation */}
      <div
        className="fixed inset-0 z-[70] bg-slate-950/55"
        onClick={onClose}
        aria-hidden
      />

      {/* Static sheet: no entrance animation */}
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="fixed inset-0 z-[75] flex items-center justify-center p-4 md:p-8"
      >
        <div className={['relative w-full max-w-[1640px]', SheetGlass, 'rounded-[36px] p-6 md:p-8 lg:p-10'].join(' ')}>
          <div className={Aura} aria-hidden />

          {/* Header */}
          <div className="flex items-end justify-between gap-4 pb-5 border-b border-white/60 dark:border-white/10">
            <div>
              <h2 className="text-[34px] md:text-[42px] lg:text-[50px] leading-none font-extrabold tracking-tight text-slate-900 dark:text-white">
                {pinMode && pinTarget ? `Unlock “${pinTarget === 'CONFIG_S' ? 'KFB CONFIG' : 'PROGRAM'}”` : 'Settings'}
              </h2>
            </div>

            <div className="flex gap-3">
              {pinMode && (
                <button
                  onClick={() => { setPinMode(false); setPinTarget(null); setPinError(''); }}
                  className="inline-flex h-11 md:h-12 px-5 items-center justify-center rounded-full bg-white/85 dark:bg-slate-800/70 border border-white/60 dark:border-white/10 shadow text-sm font-semibold text-slate-900 dark:text-slate-100"
                >
                  Back
                </button>
              )}
              <button
                onClick={onClose}
                className="inline-flex h-11 md:h-12 w-11 md:w-12 items-center justify-center rounded-full bg-white/92 dark:bg-slate-800/70 border border-white/60 dark:border-white/10 shadow"
                aria-label="Close settings"
              >
                <XMarkIcon className="h-6 w-6 text-slate-800 dark:text-slate-100" />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="mt-6 md:mt-8">
            {!pinMode && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
                <Tile
                  active={activeSection === 'MAIN_S'}
                  label="Main"
                  accent="sky"
                  Icon={SettingsHomeIcon}
                  badgeNum={1}
                  locked={isLocked('MAIN_S')}
                  lockUntil={lockUntil('MAIN_S')}
                  onClick={() => handleTileClick('MAIN_S')}
                />
                <Tile
                  active={activeSection === 'CONFIG_S'}
                  label="KFB Config"
                  accent="violet"
                  Icon={SettingsCogIcon}
                  badgeNum={2}
                  locked={isLocked('CONFIG_S')}
                  lockUntil={lockUntil('CONFIG_S')}
                  onClick={() => handleTileClick('CONFIG_S')}
                />
                <Tile
                  active={activeSection === 'BRANCHES_S'}
                  label="Program"
                  accent="emerald"
                  Icon={SettingsCubeIcon}
                  badgeNum={3}
                  locked={isLocked('BRANCHES_S')}
                  lockUntil={lockUntil('BRANCHES_S')}
                  onClick={() => handleTileClick('BRANCHES_S')}
                />
              </div>
            )}

            {pinMode && pinTarget && (
              <PinForm
                otpLength={otpLength}
                sectionLabel={pinTarget === 'CONFIG_S' ? 'KFB CONFIG' : 'PROGRAM'}
                attemptsLeft={attemptsLeft}
                errorMessage={pinError}
                onSubmit={handlePinSubmit}
              />
            )}
          </div>
        </div>
      </section>
    </>
  );
};

/* ────────────────────────────────────────────────────────────────────────────
   Tile (no scale on hover, no motion libs)
   ──────────────────────────────────────────────────────────────────────────── */
const accentMap = {
  sky: {
    ringBase: 'ring-sky-300/70',
    ringHover: 'hover:ring-sky-400/90',
    dot: 'bg-sky-50',
    icon: 'text-sky-600',
    badge: 'from-sky-50 to-white',
    borderGlow: 'shadow-[0_0_0_3px_rgba(14,165,233,0.30),0_20px_40px_-16px_rgba(14,165,233,0.35)]',
    badgeChip: 'bg-gradient-to-b from-sky-400 to-sky-600 text-white',
  },
  violet: {
    ringBase: 'ring-violet-300/70',
    ringHover: 'hover:ring-violet-400/90',
    dot: 'bg-violet-50',
    icon: 'text-violet-600',
    badge: 'from-violet-50 to-white',
    borderGlow: 'shadow-[0_0_0_3px_rgba(139,92,246,0.30),0_20px_40px_-16px_rgba(139,92,246,0.35)]',
    badgeChip: 'bg-gradient-to-b from-violet-400 to-violet-600 text-white',
  },
  emerald: {
    ringBase: 'ring-emerald-300/70',
    ringHover: 'hover:ring-emerald-400/90',
    dot: 'bg-emerald-50',
    icon: 'text-emerald-600',
    badge: 'from-emerald-50 to-white',
    borderGlow: 'shadow-[0_0_0_3px_rgba(16,185,129,0.30),0_20px_40px_-16px_rgba(16,185,129,0.35)]',
    badgeChip: 'bg-gradient-to-b from-emerald-400 to-emerald-600 text-white',
  },
} as const;

type TileProps = {
  label: string;
  active?: boolean;
  onClick: () => void;
  Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  accent: 'sky' | 'violet' | 'emerald';
  badgeNum: 1 | 2 | 3;
  locked?: boolean;
  lockUntil?: number | null;
};

const Tile: React.FC<TileProps> = React.memo(
  ({ label, active, onClick, Icon, accent, badgeNum, locked, lockUntil }) => {
    const acc = accentMap[accent];
    const disabled = !!locked;

    return (
      <button
        onClick={() => !disabled && onClick()}
        className={[
          'group relative w-full min-h-[240px] md:min-h-[300px] lg:min-h-[340px] rounded-[28px] p-7 lg:p-9 text-left',
          TileGlass,
          active ? `ring-2 ${acc.ringBase}` : 'ring-1 ring-white/55 dark:ring-white/10',
          acc.ringHover, // ring color only; no scale
          'ring-offset-1 ring-offset-white/60 dark:ring-offset-slate-900/40',
          'transition-[ring,box-shadow,background-color] duration-200 ease-out',
          disabled ? 'pointer-events-auto cursor-not-allowed' : '',
        ].join(' ')}
        aria-pressed={active}
        aria-disabled={disabled}
      >
        {/* Step badge */}
        <span
          className={[
            'absolute right-5 top-5 h-12 min-w-12 px-2 rounded-3xl',
            'grid place-items-center text-lg font-extrabold tracking-tight shadow',
            'ring-2 ring-white/60',
            acc.badgeChip,
          ].join(' ')}
          aria-hidden
        >
          {badgeNum}
        </span>

        {/* Hover glow without transforms */}
        <span
          aria-hidden
          className={`pointer-events-none absolute inset-0 rounded-[28px] opacity-0 ${acc.borderGlow} transition-opacity duration-200 group-hover:opacity-100`}
        />

        {/* LOCKED overlay */}
        {locked && (
          <>
            <div
              className="absolute inset-0 z-10 rounded-[28px] pointer-events-none"
              style={{
                background:
                  'linear-gradient(180deg,rgba(2,6,23,0.20),rgba(2,6,23,0.30)), radial-gradient(100% 140% at 50% 20%, rgba(255,255,255,0.05), rgba(255,255,255,0) 60%)',
                backdropFilter: 'blur(1.5px)',
              }}
            />
            <div
              className="absolute inset-0 z-[11] rounded-[28px] pointer-events-none mix-blend-overlay"
              style={{
                backgroundImage:
                  'repeating-linear-gradient(135deg, rgba(255,255,255,0.08) 0px, rgba(255,255,255,0.08) 12px, rgba(255,255,255,0) 12px, rgba(255,255,255,0) 24px)',
              }}
            />
          </>
        )}

        {/* Content */}
        <div className="relative z-[12] flex h-full flex-col items-center justify-center gap-8 lg:gap-10">
          {/* Icon badge */}
          <div
            className={[
              'rounded-3xl border border-white/70 dark:border-white/10 h-[110px] w-[110px] lg:h-[128px] lg:w-[128px] grid place-items-center shadow-inner',
              'bg-gradient-to-b',
              acc.badge,
              acc.dot,
              locked ? 'opacity-60 saturate-75' : '',
            ].join(' ')}
          >
            <Icon className={`h-16 w-16 lg:h-[72px] lg:w-[72px] ${acc.icon}`} />
          </div>

          {/* Title */}
          <div className={`relative z-[20] text-center ${locked ? 'blur-[1px] opacity-85' : ''}`}>
            <div className="text-4xl lg:text-5xl font-extrabold tracking-tight text-slate-900 dark:text-white">
              {label.toUpperCase()}
            </div>
            {active && (
              <div className="mt-3 inline-flex items-center rounded-full px-4 py-1.5 text-base font-semibold bg-black/5 dark:bg-white/10 text-slate-900 dark:text-slate-100">
                Selected
              </div>
            )}
          </div>
        </div>

        {/* BIG lock badge with isolated ticking label */}
        {locked && (
          <div className="absolute z-[22] left-1/2 -translate-x-1/2 top-6 pointer-events-none">
            <div className="flex items-center gap-3 md:gap-4 rounded-full px-6 py-3 md:px-7 md:py-3.5 bg-slate-900/92 text-white ring-1 ring-white/10 shadow">
              <LockGlyph className="h-5 w-5 md:h-6 md:w-6 opacity-95" />
              <span className="uppercase tracking-[0.18em] text-[11px] md:text-[12px] font-semibold">Locked</span>
              <span className="h-[6px] w-[6px] rounded-full bg-white/85" />
              <CountdownLabel until={lockUntil ?? Date.now()} />
            </div>
          </div>
        )}
      </button>
    );
  }
);
Tile.displayName = 'Tile';

const LockGlyph: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden>
    <path
      d="M12 1.75a5.25 5.25 0 00-5.25 5.25v2.25H5.5A2.75 2.75 0 002.75 12v7.25A2.75 2.75 0 005.5 22h13a2.75 2.75 0 002.75-2.75V12A2.75 2.75 0 0018.5 9.25h-1.25V7A5.25 5.25 0 0012 1.75zm-3.75 7.5V7A3.75 3.75 0 0112 3.25 3.75 3.75 0 0115.75 7v2.25h-7.5z"
      fill="currentColor"
    />
  </svg>
);

/* Re-renders only itself every second */
const CountdownLabel: React.FC<{ until: number }> = React.memo(({ until }) => {
  const [msLeft, setMsLeft] = useState(() => Math.max(0, until - Date.now()));
  useEffect(() => {
    if (until <= Date.now()) {
      setMsLeft(0);
      return;
    }
    const i = setInterval(() => setMsLeft(Math.max(0, until - Date.now())), 1000);
    return () => clearInterval(i);
  }, [until]);
  return <span className="tabular-nums text-xl md:text-2xl font-extrabold">{fmtClock(msLeft)}</span>;
});
CountdownLabel.displayName = 'CountdownLabel';

/* ────────────────────────────────────────────────────────────────────────────
   PIN form
   ──────────────────────────────────────────────────────────────────────────── */
type PinFormProps = {
  otpLength: number;
  sectionLabel: string;
  attemptsLeft: number;
  errorMessage?: string;
  onSubmit: (pin: string) => void;
};

const PinForm: React.FC<PinFormProps> = React.memo(
  ({ otpLength, sectionLabel, attemptsLeft, errorMessage, onSubmit }) => {
    const inputsRef = useRef<Array<HTMLInputElement | null>>([]);
    const [values, setValues] = useState<string[]>(() => Array.from({ length: otpLength }, () => ''));

    useEffect(() => {
      inputsRef.current[0]?.focus();
    }, []);

    const codeWith = (nextValues: string[]) => nextValues.join('');

    const setChar = (index: number, val: string) => {
      const v = val.replace(/\D/g, '').slice(0, 1);
      if (!v) return;
      setValues((prev) => {
        const next = [...prev];
        next[index] = v;
        if (index === otpLength - 1 && next.every(Boolean)) {
          const code = codeWith(next);
          setTimeout(() => onSubmit(code), 40);
        } else {
          inputsRef.current[index + 1]?.focus();
        }
        return next;
      });
    };

    const onKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Backspace') {
        e.preventDefault();
        setValues((prev) => {
          const next = [...prev];
          if (next[index]) {
            next[index] = '';
            return next;
          }
          const prevIdx = Math.max(0, index - 1);
          inputsRef.current[prevIdx]?.focus();
          next[prevIdx] = '';
          return next;
        });
      } else if (e.key === 'ArrowLeft') {
        inputsRef.current[Math.max(0, index - 1)]?.focus();
      } else if (e.key === 'ArrowRight') {
        inputsRef.current[Math.min(otpLength - 1, index + 1)]?.focus();
      }
    };

    const onPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
      const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, otpLength);
      if (!pasted) return;
      e.preventDefault();
      const chars = pasted.split('');
      setValues((prev) => {
        const next = [...prev];
        chars.forEach((c, i) => (next[i] = c));
        if (next.every(Boolean)) setTimeout(() => onSubmit(codeWith(next)), 30);
        else inputsRef.current[Math.min(chars.length, otpLength - 1)]?.focus();
        return next;
      });
    };

    return (
      <div className="flex flex-col items-center text-center">
        <div className="flex items-center justify-center gap-3 flex-wrap">
          <p className="text-lg md:text-xl text-slate-700/95 dark:text-slate-200/95">
            Enter PIN for <span className="font-semibold text-slate-900 dark:text-white">{sectionLabel}</span>
          </p>
          <span
            className={[
              'rounded-full px-3 py-1 text-sm font-semibold',
              attemptsLeft === 1
                ? 'bg-rose-500/10 text-rose-700 dark:text-rose-300'
                : 'bg-black/5 dark:bg-white/10 text-slate-900 dark:text-slate-100',
            ].join(' ')}
          >
            Attempts left: <span className="font-extrabold">{attemptsLeft}</span>
          </span>
        </div>

        <div className="mt-6 md:mt-8 flex gap-4 md:gap-5">
          {Array.from({ length: otpLength }).map((_, i) => (
            <div key={i} className="relative">
              <input
                ref={(el) => { inputsRef.current[i] = el; }}
                value={values[i]}
                onChange={(e) => setChar(i, e.target.value)}
                onKeyDown={(e) => onKeyDown(i, e)}
                onPaste={onPaste}
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="one-time-code"
                autoCorrect="off"
                autoCapitalize="none"
                name={`otp-digit-${i}`}
                data-lpignore="true"
                data-1p-ignore=""
                className={[
                  'h-[86px] w-[72px] md:h-[100px] md:w-[86px] lg:h-[116px] lg:w-[100px]',
                  'text-3xl md:text-4xl lg:text-5xl text-center font-extrabold tracking-widest',
                  'text-slate-900 dark:text-white placeholder-slate-400',
                  'rounded-2xl md:rounded-3xl border',
                  'bg-white/96 dark:bg-slate-900/90',
                  'border-white/70 dark:border-white/10',
                  'shadow-[inset_0_2px_8px_rgba(2,6,23,0.06),0_12px_28px_-10px_rgba(2,6,23,0.35)]',
                  'focus:outline-none focus:ring-4 focus:ring-sky-300/55',
                ].join(' ')}
                aria-label={`PIN digit ${i + 1}`}
              />
              <span className="pointer-events-none absolute inset-0 rounded-2xl md:rounded-3xl ring-1 ring-white/60 dark:ring-white/10" />
            </div>
          ))}
        </div>

        {errorMessage && (
          <div className="mt-4 text-lg md:text-xl font-semibold text-rose-600 dark:text-rose-400">{errorMessage}</div>
        )}
      </div>
    );
  }
);
PinForm.displayName = 'PinForm';

