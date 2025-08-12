'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Transition } from 'framer-motion';
import { XMarkIcon } from '@heroicons/react/24/outline';

type DiscoverEspModalProps = {
  open: boolean;
  onClose: () => void;
  statusText?: string; // e.g., "Scanning for ESPs…" / "Connecting to ESP over Wi-Fi…"
};

const SHEET: Transition = { type: 'spring', stiffness: 520, damping: 42, mass: 0.9 };
// keep fade simple to avoid TS complaints
const FADE: Transition = { duration: 0.22 };

export default function DiscoverEspModal({ open, onClose, statusText = 'Connecting to ESP over Wi-Fi…' }: DiscoverEspModalProps) {
  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="esp-backdrop"
            className="fixed inset-0 z-[70] bg-black/55 backdrop-blur-md"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={FADE}
            onClick={onClose}
          />

          {/* Sheet */}
          <motion.div
            key="esp-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Discover ESP"
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={SHEET}
            className="fixed inset-0 z-[80] flex items-start justify-center p-5"
          >
            <div className="relative w-full max-w-3xl overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/5">
              {/* Title bar */}
              <div className="flex items-center justify-between px-5 py-4">
                <h3 className="text-[18px] font-semibold text-slate-900">Discover ESP</h3>
                <button
                  onClick={onClose}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full ring-1 ring-slate-200 hover:bg-slate-100 active:scale-95"
                  aria-label="Close"
                >
                  <XMarkIcon className="h-5 w-5 text-slate-600" />
                </button>
              </div>

              {/* Content */}
              <div className="px-5 pb-5">
                <StatusCard text={statusText} />
                <div className="mt-6 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
                  <EspLinkAnimation />
                </div>
              </div>
            </div>
          </motion.div>

          {/* keyframes for packet animation */}
          <style
            // styled-jsx (Next) – animations for packets using offset-path
            dangerouslySetInnerHTML={{
              __html: `
              @keyframes packet {
                0% { offset-distance: 0%; opacity: .0; }
                5% { opacity: 1; }
                95% { opacity: 1; }
                100% { offset-distance: 100%; opacity: .0; }
              }
              @keyframes packetReverse {
                0% { offset-distance: 100%; opacity: .0; }
                5% { opacity: 1; }
                95% { opacity: 1; }
                100% { offset-distance: 0%; opacity: .0; }
              }
              `
            }}
          />
        </>
      )}
    </AnimatePresence>
  );
}

/* ———————————————————————————————— */
/* UI bits                                                               */
/* ———————————————————————————————— */

function StatusCard({ text }: { text: string }) {
  return (
    <div className="rounded-2xl bg-white px-4 py-3 text-center text-[15px] font-medium text-slate-700 ring-1 ring-slate-200">
      <div className="flex items-center justify-center gap-3">
        <span>{text}</span>
        <LoadingDots />
      </div>
    </div>
  );
}

function LoadingDots() {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="h-2 w-2 animate-bounce rounded-full bg-indigo-400 [animation-delay:-200ms]" />
      <span className="h-2 w-2 animate-bounce rounded-full bg-indigo-400 [animation-delay:-100ms]" />
      <span className="h-2 w-2 animate-bounce rounded-full bg-indigo-400" />
    </span>
  );
}

/* ———————————————————————————————— */
/* The Animation                                                         */
/* ———————————————————————————————— */

function EspLinkAnimation() {
  // drawing area
  const W = 720;
  const H = 230;

  // path string used both by SVG dashed line and CSS offset-path for packets
  const linkPath = `M 140 ${H / 2} C ${W / 2 - 80} ${H / 2 - 70}, ${W / 2 + 80} ${H / 2 - 70}, ${W - 140} ${H / 2}`;

  return (
    <div className="relative mx-auto w-full overflow-hidden rounded-xl bg-gradient-to-b from-slate-50 to-white">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-[230px] w-full">
        {/* subtle grid */}
        <defs>
          <pattern id="grid" width="16" height="16" patternUnits="userSpaceOnUse">
            <path d="M 16 0 L 0 0 0 16" fill="none" stroke="rgba(2,6,23,.06)" strokeWidth="1" />
          </pattern>
          <radialGradient id="glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(59,130,246,.65)" />
            <stop offset="100%" stopColor="rgba(59,130,246,0)" />
          </radialGradient>
        </defs>
        <rect x="0" y="0" width={W} height={H} fill="url(#grid)" />

        {/* connection line (marching dash) */}
        <motion.path
          d={linkPath}
          fill="none"
          stroke="rgba(59,130,246,.55)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="8 10"
          animate={{ strokeDashoffset: [0, -36] }}
          transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}
        />

        {/* boards */}
        <g transform={`translate(60, ${H / 2 - 48})`}><EspBoard /></g>
        <g transform={`translate(${W - 60 - 120}, ${H / 2 - 48})`}><EspBoard /></g>

        {/* wifi pulses near boards */}
        <WifiPulse x={120} y={H / 2 - 6} />
        <WifiPulse x={W - 120} y={H / 2 - 6} right />

        {/* end glows */}
        <circle cx="140" cy={H / 2} r="22" fill="url(#glow)" />
        <circle cx={W - 140} cy={H / 2} r="22" fill="url(#glow)" />
      </svg>

      {/* Packets traveling along the path – left→right & right→left */}
      <PacketStream path={linkPath} duration={2.6} count={3} />
      <PacketStream path={linkPath} duration={2.8} count={3} reverse />

      {/* helper text */}
      <div className="pointer-events-none absolute inset-x-0 bottom-2 text-center text-[12px] text-slate-500">
        Searching nearby boards…
      </div>
    </div>
  );
}

/* ESP board (simplified SVG) */
function EspBoard() {
  return (
    <svg width="120" height="96" viewBox="0 0 120 96">
      <rect x="2" y="2" width="116" height="92" rx="8" className="fill-white" />
      <rect x="2" y="2" width="116" height="92" rx="8" className="fill-none" stroke="rgba(2,6,23,.12)" strokeWidth="2" />
      {/* header bar */}
      <rect x="2" y="2" width="116" height="16" rx="8" className="fill-slate-100" />
      {/* module can */}
      <rect x="12" y="24" width="52" height="48" rx="4" className="fill-slate-200" />
      <rect x="12" y="24" width="52" height="48" rx="4" className="fill-none" stroke="rgba(2,6,23,.18)" />
      {/* MCU + passives */}
      <rect x="72" y="26" width="30" height="22" rx="3" className="fill-slate-300" />
      <rect x="72" y="52" width="14" height="10" rx="2" className="fill-slate-300" />
      <rect x="88" y="52" width="14" height="10" rx="2" className="fill-slate-300" />
      <rect x="72" y="66" width="10" height="6" rx="2" className="fill-slate-300" />
      <rect x="84" y="66" width="18" height="6" rx="2" className="fill-slate-300" />
      {/* pins */}
      {Array.from({ length: 14 }).map((_, i) => (
        <rect key={`l-${i}`} x="0" y={18 + i * 5} width="4" height="3" className="fill-slate-200" />
      ))}
      {Array.from({ length: 14 }).map((_, i) => (
        <rect key={`r-${i}`} x="116" y={18 + i * 5} width="4" height="3" className="fill-slate-200" />
      ))}
    </svg>
  );
}

/* Wi-Fi pulse arcs */
function WifiPulse({ x, y, right = false }: { x: number; y: number; right?: boolean }) {
  const dir = right ? -1 : 1;
  const base = `M ${x} ${y} q ${12 * dir} -10 ${24 * dir} 0`;
  const mid = `M ${x} ${y} q ${18 * dir} -16 ${36 * dir} 0`;
  const big = `M ${x} ${y} q ${24 * dir} -22 ${48 * dir} 0`;
  return (
    <>
      <motion.path d={base} fill="none" stroke="rgba(59,130,246,.55)" strokeWidth="2"
        initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 0] }} transition={{ duration: 1.6, repeat: Infinity }} />
      <motion.path d={mid} fill="none" stroke="rgba(59,130,246,.4)" strokeWidth="2"
        initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 0] }} transition={{ duration: 1.6, repeat: Infinity, delay: .2 }} />
      <motion.path d={big} fill="none" stroke="rgba(59,130,246,.25)" strokeWidth="2"
        initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 0] }} transition={{ duration: 1.6, repeat: Infinity, delay: .4 }} />
    </>
  );
}

/* Packets along the link using CSS offset-path (works great for curves) */
function PacketStream({
  path,
  duration = 2.6,
  count = 3,
  reverse = false
}: { path: string; duration?: number; count?: number; reverse?: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-0">
      {Array.from({ length: count }).map((_, i) => (
        <span
          key={i}
          className="absolute h-2 w-2 rounded-full shadow-[0_0_0_4px_rgba(59,130,246,.15)]"
          style={{
            background: 'rgb(59 130 246)', // blue-500
            // @ts-ignore vendor prefix handled by browser
            offsetPath: `path('${path}')`,
            animation: `${reverse ? 'packetReverse' : 'packet'} ${duration}s linear ${i * (duration / count)}s infinite`
          }}
        />
      ))}
    </div>
  );
}
