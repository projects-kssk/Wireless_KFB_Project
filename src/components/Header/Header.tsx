"use client";

import React, { memo, useEffect, useRef, useState } from "react";
import {
  m,
  AnimatePresence,
  useReducedMotion,
  type Variants,
} from "framer-motion";
import type { Transition } from "framer-motion";
import { appConfig } from "@/components/config/appConfig";
import { useSerialEvents, type SerialState } from "./useSerialEvents";
import ThemeToggle from "./ThemeToggle";

/* ────────────────────────────────────────────────────────────────────────────
   Config
   ──────────────────────────────────────────────────────────────────────────── */
const BASE_HEADER_MIN_HEIGHT = "6.25rem";
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

type LedColor = "green" | "amber" | "red";

type Row = {
  title: string;
  sub?: string | null;
  color: LedColor;
  suffix?: string | number;
};

/* Discover/Test states */
type DiscoverState = "idle" | "searching" | "success" | "error";
type TestState = "idle" | "calling" | "ok" | "error";

/* ────────────────────────────────────────────────────────────────────────────
   Header chrome
   ──────────────────────────────────────────────────────────────────────────── */
const StrictHeaderBg = [
  "bg-[radial-gradient(170%_170%_at_0%_-42%,#f1f4ff_0%,#f8faff_56%,#ffffff_100%)]",
  "dark:bg-[radial-gradient(160%_160%_at_0%_-30%,#0b1220_0%,#0b1220_70%,#070d19_100%)]",
  "border-b border-slate-200/70 dark:border-slate-800",
].join(" ");

/* ────────────────────────────────────────────────────────────────────────────
   Support CTA
   ──────────────────────────────────────────────────────────────────────────── */
const SupportIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 48 48" className={className} aria-hidden>
    <g
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
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
    <m.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={[
        "relative inline-flex items-center w-full h-full px-7 py-4 text-left group rounded-2xl",
        "bg-transparent",
        className ?? "",
      ].join(" ")}
      style={{ overflow: "hidden", willChange: "transform,opacity" }}
      aria-label={`Support ${number}`}
    >
      <div className="mr-4 shrink-0">
        <div
          className={[
            "relative flex items-center justify-center rounded-full",
            "h-12 w-12 2xl:h-14 2xl:w-14",
            "text-white",
            "bg-gradient-to-br from-violet-500 via-fuchsia-500 to-indigo-500",
          ].join(" ")}
        >
          <SupportIcon className="h-6 w-6 2xl:h-7 2xl:w-7 opacity-95" />
          {!reduce && (
            <m.span
              className="pointer-events-none absolute inset-0 rounded-full"
              style={{ border: "2px solid rgba(168,85,247,.35)" }}
              initial={{ scale: 1, opacity: 0.7 }}
              animate={{ scale: [1, 1.35], opacity: [0.7, 0] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }}
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
          <div className="text-[12px] font-extrabold text-slate-700 dark:text-slate-300 leading-tight uppercase">
            Support
          </div>
          <div className="flex items-center gap-3 mt-0.5">
            <span className="truncate text-[22px] 2xl:text-[24px] font-black tracking-tight text-slate-900 dark:text-white leading-none">
              {number}
            </span>
            <a
              href={`tel:${number}`}
              className="px-3 py-1 rounded-full text-[11px] font-bold bg-violet-600 text-white hover:bg-violet-700"
            >
              Call
            </a>
          </div>
        </div>
      )}
    </m.div>
  );
};

/* ────────────────────────────────────────────────────────────────────────────
   LEDs
   ──────────────────────────────────────────────────────────────────────────── */
const ledCfg = (c: LedColor) =>
  c === "green"
    ? { a: "#34d399", b: "#10b981", rim: "rgba(16,185,129,.45)" }
    : c === "amber"
      ? { a: "#fbbf24", b: "#f59e0b", rim: "rgba(245,158,11,.45)" }
      : { a: "#fb7185", b: "#ef4444", rim: "rgba(244,63,94,.45)" };

const LedBallBase: React.FC<{
  color: LedColor;
  size?: number;
  title?: string;
}> = ({ color, size = 34, title }) => {
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
          style={{
            border: `2px solid ${cfg.rim}`,
            willChange: "transform,opacity",
          }}
          initial={{ scale: 1, opacity: 0.6 }}
          animate={{ scale: [1, 1.4], opacity: [0.6, 0] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }}
        />
      )}
    </div>
  );
};
const LedBall = memo(LedBallBase);

/* ────────────────────────────────────────────────────────────────────────────
   Status cells
   ──────────────────────────────────────────────────────────────────────────── */
const StatusCellBase: React.FC<Row & { labelsHidden?: boolean }> = ({
  title,
  sub,
  color,
  suffix,
  labelsHidden,
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

const StatusRow: React.FC<{
  cells: Row[];
  className?: string;
  labelsHidden?: boolean;
}> = ({ cells, className, labelsHidden }) => (
  <div className={["w-full h-full p-0 min-w-0", className ?? ""].join(" ")}>
    <div className="flex h-full">
      {cells.map((c, i) => (
        <div
          key={i}
          className="flex-1 min-w-0 flex items-center overflow-hidden"
        >
          <StatusCell {...c} labelsHidden={labelsHidden} />
        </div>
      ))}
    </div>
  </div>
);

/* ────────────────────────────────────────────────────────────────────────────
   iOS-like Settings glyph + button
   ──────────────────────────────────────────────────────────────────────────── */
type SettingsIconProps = {
  size?: number | string;
  className?: string;
  title?: string;
};
export const IOSSettingsIconPro: React.FC<SettingsIconProps> = ({
  size = 64,
  className,
  title = "Settings",
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 64 64"
    width={size}
    height={size}
    className={className}
    role="img"
    aria-label={title}
  >
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
        <feComposite
          in="SourceGraphic"
          in2="b"
          operator="arithmetic"
          k2="-1"
          k3="1"
        />
        <feColorMatrix
          type="matrix"
          values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .35 0"
        />
      </filter>
      <filter id="softDrop" x="-30%" y="-30%" width="160%" height="160%">
        <feDropShadow dx="0" dy="1.2" stdDeviation="1.2" floodOpacity="0.35" />
      </filter>
      <mask id="squircleMask">
        <rect x="2" y="2" width="60" height="60" rx="14" fill="#fff" />
      </mask>
    </defs>
    <rect x="2" y="2" width="60" height="60" rx="14" fill="url(#bg)" />
    <rect
      x="2.5"
      y="2.5"
      width="59"
      height="59"
      rx="13.5"
      fill="none"
      stroke="url(#bg-stroke)"
    />
    <g mask="url(#squircleMask)">
      <circle
        cx="32"
        cy="32"
        r="23.5"
        fill="url(#dial)"
        filter="url(#innerShadow)"
      />
      <circle
        cx="32"
        cy="32"
        r="22.8"
        fill="none"
        stroke="url(#rim)"
        strokeWidth="1.6"
        opacity="0.9"
      />
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
        <circle
          cx="32"
          cy="32"
          r="11.2"
          fill="none"
          stroke="url(#rim)"
          strokeWidth="1.9"
          opacity="0.92"
        />
        <g
          stroke="url(#metal)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.96"
        >
          <path d="M32 32 L32 17.2" />
          <path d="M32 32 L46 40" transform="rotate(120 32 32)" />
          <path d="M32 32 L46 40" transform="rotate(240 32 32)" />
        </g>
        <circle cx="32" cy="32" r="6.6" fill="url(#dial)" />
        <circle cx="32" cy="32" r="3.8" fill="url(#hub)" />
        <path
          d="M18 20 A20 20 0 0 1 28 12"
          fill="none"
          stroke="#fff"
          strokeOpacity="0.35"
          strokeWidth="1.2"
        />
        <path
          d="M40 52 A20 20 0 0 0 50 42"
          fill="none"
          stroke="#000"
          strokeOpacity="0.15"
          strokeWidth="1.2"
        />
      </g>
    </g>
  </svg>
);

const SettingsIconButtonBase: React.FC<{
  size: number;
  label: string;
  onClick: () => void;
  showLabel: boolean;
}> = ({ size, label, onClick, showLabel }) => {
  const fontPx = Math.round(Math.max(14, Math.min(size * 0.13, 22)));
  return (
    <m.button
      type="button"
      aria-label={label}
      onClick={onClick}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.98 }}
      className="hidden lg:flex flex-col items-center justify-center bg-transparent"
      style={{ width: size, height: size, willChange: "transform" }}
    >
      <IOSSettingsIconPro
        className="h-[72%] w-[72%]"
        size="100%"
        title={label}
      />
      {showLabel && (
        <span
          className="mt-1 font-semibold tracking-tight text-slate-900 dark:text-slate-50"
          style={{ fontSize: fontPx }}
        >
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
const normHex = (s?: string | null) =>
  (s ?? "").replace(/^0x/i, "").padStart(4, "0").toLowerCase();
const pair = (vid?: string | null, pid?: string | null) =>
  vid && pid ? `${normHex(vid)}:${normHex(pid)}` : null;

/* ────────────────────────────────────────────────────────────────────────────
   ESP UI bits (icon + status strip + wiring)
   ──────────────────────────────────────────────────────────────────────────── */
const ESPIcon: React.FC<{ className?: string; title?: string }> = ({
  className,
  title = "ESP",
}) => (
  <svg viewBox="0 0 64 64" className={className} role="img" aria-label={title}>
    <defs>
      <linearGradient id="chipBody" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0%" stopColor="#1f2937" />
        <stop offset="100%" stopColor="#0b1220" />
      </linearGradient>
      <linearGradient id="pin" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0%" stopColor="#d1d5db" />
        <stop offset="100%" stopColor="#9ca3af" />
      </linearGradient>
    </defs>
    {/* pins left */}
    {Array.from({ length: 6 }).map((_, i) => (
      <rect
        key={`pl-${i}`}
        x={10}
        y={12 + i * 8}
        width={6}
        height={4}
        rx={1}
        fill="url(#pin)"
      />
    ))}
    {/* pins right */}
    {Array.from({ length: 6 }).map((_, i) => (
      <rect
        key={`pr-${i}`}
        x={48}
        y={12 + i * 8}
        width={6}
        height={4}
        rx={1}
        fill="url(#pin)"
      />
    ))}
    {/* chip body */}
    <rect
      x={16}
      y={8}
      width={32}
      height={48}
      rx={6}
      fill="url(#chipBody)"
      stroke="#111827"
      strokeWidth={1.2}
    />
    {/* antenna/wifi mark */}
    <g fill="none" stroke="#60a5fa" strokeWidth={2.5} strokeLinecap="round">
      <path d="M28 20a8 8 0 0116 0" />
      <path d="M31 23a5 5 0 0110 0" />
      <circle cx={36} cy={27} r={2} fill="#60a5fa" />
    </g>
    {/* label bars */}
    <g stroke="#334155" strokeWidth={2}>
      <path d="M22 34h20" />
      <path d="M22 39h20" />
      <path d="M22 44h14" />
    </g>
  </svg>
);

function StatusStrip({
  tone,
  text,
}: {
  tone: "indigo" | "emerald" | "sky" | "slate";
  text: string;
}) {
  const toneMap = {
    emerald: {
      ring: "ring-emerald-300/70",
      text: "text-emerald-700 dark:text-emerald-400",
      dot: "bg-emerald-500 shadow-[0_0_0_6px_rgba(16,185,129,.18)]",
      gloss: "from-white/70 to-transparent dark:from-white/10",
      tint: "from-emerald-50/80 to-emerald-100/30 dark:from-emerald-400/10 dark:to-transparent",
    },
    indigo: {
      ring: "ring-indigo-300/70",
      text: "text-indigo-700 dark:text-indigo-400",
      dot: "bg-indigo-500 shadow-[0_0_0_6px_rgba(99,102,241,.18)]",
      gloss: "from-white/70 to-transparent dark:from-white/10",
      tint: "from-indigo-50/70 to-indigo-100/25 dark:from-indigo-400/10 dark:to-transparent",
    },
    sky: {
      ring: "ring-sky-300/70",
      text: "text-sky-700 dark:text-sky-400",
      dot: "bg-sky-500 shadow-[0_0_0_6px_rgba(14,165,233,.18)]",
      gloss: "from-white/70 to-transparent dark:from-white/10",
      tint: "from-sky-50/70 to-sky-100/25 dark:from-sky-400/10 dark:to-transparent",
    },
    slate: {
      ring: "ring-slate-300/60",
      text: "text-slate-700 dark:text-slate-300",
      dot: "bg-slate-500 shadow-[0_0_0_6px_rgba(100,116,139,.18)]",
      gloss: "from-white/70 to-transparent dark:from-white/10",
      tint: "from-slate-50/70 to-slate-100/20 dark:from-white/5 dark:to-transparent",
    },
  }[tone];

  return (
    <div
      className={[
        "relative mt-4 w-full overflow-hidden select-none",
        "rounded-[22px] bg-white/85 dark:bg-[#121212]/85",
        "backdrop-blur-xl ring-1",
        toneMap.ring,
        "shadow-[0_8px_28px_rgba(2,6,23,.10)]",
      ].join(" ")}
    >
      <div
        className={`pointer-events-none absolute inset-0 rounded-[22px] bg-gradient-to-b ${toneMap.gloss}`}
      />
      <div
        className={`pointer-events-none absolute inset-0 rounded-[22px] bg-gradient-to-br ${toneMap.tint}`}
      />
      <div className="pointer-events-none absolute inset-0 rounded-[22px] ring-1 ring-white/60 dark:ring-white/5" />
      <div
        className={[
          "relative flex items-center justify-center gap-3 px-6 py-4 font-semibold text-2xl tracking-tight",
          toneMap.text,
        ].join(" ")}
      >
        <span className={["h-3.5 w-3.5 rounded-full", toneMap.dot].join(" ")} />
        <span className="leading-none">{text}</span>
      </div>
    </div>
  );
}

function SimpleLinkAnimation({
  searching,
  success,
}: {
  searching: boolean;
  success: boolean;
}) {
  const W = 760,
    H = 280,
    BOARD_W = 170,
    BOARD_H = 210,
    margin = 80,
    yMid = H / 2;
  const xStart = margin + BOARD_W,
    xEnd = W - margin - BOARD_W,
    arc = 64;
  const linkPath = `M ${xStart} ${yMid} C ${W / 2 - 160} ${yMid - arc}, ${W / 2 + 160} ${yMid - arc}, ${xEnd} ${yMid}`;
  const idle = "rgba(100,116,139,.85)",
    ok = "rgba(16,185,129,.90)";
  return (
    <div className="relative mx-auto w-full overflow-hidden rounded-xl bg-gradient-to-b from-white to-slate-50">
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full h-[280px]">
        <defs>
          <pattern
            id="grid-lite"
            width="20"
            height="20"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 20 0 L 0 0 0 20"
              fill="none"
              stroke="rgba(2,6,23,.045)"
              strokeWidth="1"
            />
          </pattern>
          <filter id="iosShadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow
              dx="0"
              dy="10"
              stdDeviation="12"
              floodColor="rgba(2,6,23,.12)"
            />
          </filter>
        </defs>
        <rect x="0" y="0" width={W} height={H} fill="url(#grid-lite)" />
        <m.path
          d={linkPath}
          fill="none"
          stroke={success ? ok : idle}
          strokeWidth={4.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={searching ? "10 12" : "0 1"}
          animate={
            searching ? { strokeDashoffset: [0, -44] } : { strokeDashoffset: 0 }
          }
          transition={{
            duration: 2.2,
            repeat: searching ? Infinity : 0,
            ease: "linear",
          }}
        />
        <circle
          cx={xStart}
          cy={yMid}
          r={5.5}
          fill="white"
          stroke="rgba(2,6,23,.15)"
        />
        <circle
          cx={xEnd}
          cy={yMid}
          r={5.5}
          fill="white"
          stroke="rgba(2,6,23,.15)"
        />
        <g
          transform={`translate(${margin}, ${yMid - BOARD_H / 2})`}
          filter="url(#iosShadow)"
        >
          <MonoBoard
            w={BOARD_W}
            h={BOARD_H}
            label="STATION ESP32"
            active={searching || success}
          />
        </g>
        <g
          transform={`translate(${W - margin - BOARD_W}, ${yMid - BOARD_H / 2})`}
          filter="url(#iosShadow)"
        >
          <MonoBoard
            w={BOARD_W}
            h={BOARD_H}
            label="KFB BOARD ESP32"
            active={success}
          />
        </g>
      </svg>
    </div>
  );
}

function MonoBoard({
  w,
  h,
  label,
  active,
}: {
  w: number;
  h: number;
  label: string;
  active: boolean;
}) {
  const pcb = "#22211d",
    edge = "#2d2b26",
    silk = "#e5e7eb",
    pin = "#9ca3af",
    ledOn = "#22c55e",
    ledOn2 = "#6366f1",
    ledOff = "#475569";
  const holeR = 4,
    headerPins = 16,
    shieldW = w * 0.72,
    shieldH = h * 0.3,
    shieldX = (w - shieldW) / 2,
    shieldY = h * 0.08;
  const btnW = w * 0.12,
    btnH = h * 0.07,
    btnY = h * 0.6,
    usbW = w * 0.18,
    usbH = h * 0.09,
    ledY = h * 0.66,
    ledR = 4,
    labelY = h + 40;

  return (
    <svg width={w} height={h + 52} viewBox={`0 0 ${w} ${h + 52}`}>
      <defs>
        <linearGradient id="shieldMetal" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#e5e7eb" />
          <stop offset="100%" stopColor="#9ca3af" />
        </linearGradient>
        <linearGradient id="usbGrad" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="#9ca3af" />
          <stop offset="100%" stopColor="#d1d5db" />
        </linearGradient>
      </defs>
      <rect
        x="2"
        y="2"
        width={w - 4}
        height={h - 4}
        rx="16"
        fill={pcb}
        stroke={edge}
        strokeWidth="2"
      />
      <circle cx="14" cy="14" r={holeR} fill="#0f172a" stroke="#475569" />
      <circle cx={w - 14} cy="14" r={holeR} fill="#0f172a" stroke="#475569" />
      <circle cx="14" cy={h - 14} r={holeR} fill="#0f172a" stroke="#475569" />
      <circle
        cx={w - 14}
        cy={h - 14}
        r={holeR}
        fill="#0f172a"
        stroke="#475569"
      />
      {Array.from({ length: headerPins }).map((_, i) => (
        <rect
          key={`lp-${i}`}
          x="8"
          y={20 + i * ((h - 40) / headerPins)}
          width="6"
          height="6"
          rx="1.5"
          fill={pin}
        />
      ))}
      {Array.from({ length: headerPins }).map((_, i) => (
        <rect
          key={`rp-${i}`}
          x={w - 14}
          y={20 + i * ((h - 40) / headerPins)}
          width="6"
          height="6"
          rx="1.5"
          fill={pin}
        />
      ))}
      <rect
        x={shieldX}
        y={shieldY}
        width={shieldW}
        height={shieldH}
        rx="6"
        fill="url(#shieldMetal)"
        stroke="#6b7280"
      />
      <path
        d={`M ${shieldX + 8} ${shieldY + 8} h ${shieldW * 0.34} v ${shieldH * 0.14} h -${shieldW * 0.08} v ${shieldH * 0.12} h ${shieldW * 0.08} v ${shieldH * 0.15} h -${shieldW * 0.08} v ${shieldH * 0.12} h ${shieldW * 0.08}`}
        fill="none"
        stroke="#374151"
        strokeOpacity="0.9"
        strokeWidth={1.8}
      />
      <rect
        x={w * 0.12}
        y={btnY}
        width={btnW}
        height={btnH}
        rx="3"
        fill="#0f172a"
        stroke="#475569"
      />
      <rect
        x={w - w * 0.12 - btnW}
        y={btnY}
        width={btnW}
        height={btnH}
        rx="3"
        fill="#0f172a"
        stroke="#475569"
      />
      <text
        x={w * 0.12 + btnW / 2}
        y={btnY + btnH + 14}
        fontSize={8.5}
        fill={silk}
        textAnchor="middle"
        fontFamily="ui-sans-serif"
      >
        EN
      </text>
      <text
        x={w - (w * 0.12 + btnW / 2)}
        y={btnY + btnH + 14}
        fontSize={8.5}
        fill={silk}
        textAnchor="middle"
        fontFamily="ui-sans-serif"
      >
        BOOT
      </text>
      <rect
        x={w / 2 - usbW / 2}
        y={h - usbH - 12}
        width={usbW}
        height={usbH}
        rx="3"
        fill="url(#usbGrad)"
        stroke="#6b7280"
      />
      <rect
        x={w / 2 - (usbW * 0.55) / 2}
        y={h - usbH / 2 - 9}
        width={usbW * 0.55}
        height={usbH * 0.3}
        rx="1"
        fill="#111827"
      />
      <circle cx={w * 0.36} cy={ledY} r={ledR} fill={active ? ledOn : ledOff} />
      <circle
        cx={w * 0.64}
        cy={ledY}
        r={ledR}
        fill={active ? ledOn2 : ledOff}
      />
      <rect
        x={shieldX}
        y={h * 0.76}
        width={shieldW}
        height={4}
        rx="1.5"
        fill="#334155"
      />
      <text
        x={w / 2}
        y={labelY}
        textAnchor="middle"
        fontFamily="ui-sans-serif"
        fontWeight={700}
        fontSize={16}
        fill="rgba(255,255,255,.85)"
      >
        {label}
      </text>
    </svg>
  );
}

function StatusBanner({
  status,
  mac,
  error,
}: {
  status: DiscoverState;
  mac: string | null;
  error: string | null;
}) {
  const base =
    "mx-6 mt-4 rounded-2xl backdrop-blur-xl ring-1 shadow-[0_10px_30px_rgba(2,6,23,.06)] px-5 py-4 text-center";
  if (status === "success") {
    return (
      <div className={`${base} bg-white/80 ring-emerald-200`}>
        <div className="text-[12px] font-semibold uppercase tracking-[0.18em] text-emerald-600">
          Connected
        </div>
        <div className="mt-1 text-2xl md:text-[28px] font-semibold text-slate-800">
          {mac}
        </div>
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className={`${base} bg-white/80 ring-red-200`}>
        <div className="text-[12px] font-semibold uppercase tracking-[0.18em] text-red-600">
          Error
        </div>
        <div className="mt-1 text-[17px] text-red-700">
          {error || "Discovery failed."}
        </div>
      </div>
    );
  }
  return (
    <div className={`${base} bg-white/80 ring-slate-200`}>
      <div className="grid gap-2 place-items-center">
        <div className="mx-auto inline-flex items-center gap-2 text-[20px] md:text-[24px] font-extrabold text-slate-800">
          <span className="h-2.5 w-2.5 rounded-full bg-sky-500 animate-pulse" />
          <span>Waiting for ESP</span>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full bg-slate-50 px-3 py-1 text-[12px] font-semibold text-slate-600 ring-1 ring-slate-200">
          <span className="inline-block h-2 w-2 rounded-full bg-indigo-500" />
          <span>Press the BUTTON on the ESP to connect</span>
        </div>
        {mac && (
          <div className="text-xs font-bold text-slate-500">
            Last MAC: {mac}
          </div>
        )}
      </div>
    </div>
  );
}

function DiscoverEspModal({
  open,
  onClose,
  onRetry,
  onTest,
  onPinTest,
  status,
  mac,
  error,
  testStatus,
  testMsg,
}: {
  open: boolean;
  onClose: () => void;
  onRetry: () => void;
  onTest: () => void;
  onPinTest: () => void;
  status: DiscoverState;
  mac: string | null;
  error: string | null;
  testStatus: TestState;
  testMsg: string | null;
}) {
  const SHEET: Transition = {
    type: "spring",
    stiffness: 360,
    damping: 42,
    mass: 0.9,
  };
  const showSuccess = status === "success" && testStatus === "ok";
  const stripText =
    status === "searching"
      ? "Press the button on the ESP"
      : status === "success"
        ? "CONNECTED"
        : "CONNECTING…";
  const stripTone: "indigo" | "emerald" | "sky" | "slate" =
    status === "searching"
      ? "indigo"
      : showSuccess
        ? "emerald"
        : status === "success"
          ? "sky"
          : "slate";

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop overlay: dim + blur underlying content */}
          <m.div
            key="esp-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-[95] bg-slate-900/55 backdrop-blur-sm"
            aria-hidden
          />

          {/* Modal sheet */}
          <m.div
            key="esp-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Discover ESP"
            initial={{ opacity: 0, y: 12, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.99 }}
            transition={SHEET}
            className="fixed inset-0 z-[100] flex items-center justify-center p-3"
          >
            <div className="relative h-[min(92vh,860px)] w-[min(98vw,1600px)] overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-black/5">
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
                <h3 className="text-[18px] font-semibold text-slate-900">
                  Discover ESP
                </h3>
                <div className="flex items-center gap-3">
                  {status !== "searching" && (
                    <button
                      onClick={onRetry}
                      className="rounded-full bg-indigo-600 px-6 py-2.5 text-[14px] font-semibold text-white ring-1 ring-indigo-700/30 hover:bg-indigo-700 active:scale-[0.99]"
                    >
                      Retry
                    </button>
                  )}
                  <button
                    onClick={onClose}
                    className="rounded-full bg-white px-5 py-2.5 text-[14px] font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 active:scale-95"
                  >
                    Close
                  </button>
                </div>
              </div>

              <StatusBanner status={status} mac={mac} error={error} />

              <div className="px-6 pb-6">
                <div className="relative mt-4 overflow-hidden rounded-3xl bg-slate-50 p-4 ring-1 ring-slate-200">
                  <SimpleLinkAnimation
                    searching={status === "searching"}
                    success={status === "success"}
                  />

                  {status === "success" && (
                    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4">
                      <div className="flex items-center justify-center gap-6">
                        <button
                          onClick={onTest}
                          disabled={testStatus === "calling"}
                          className="h-44 w-44 md:h-52 md:w-52 rounded-full select-none text-white font-extrabold text-3xl md:text-4xl tracking-wide focus:outline-none ring-2 ring-emerald-300 shadow-[0_20px_60px_rgba(16,185,129,.25)] bg-gradient-to-b from-emerald-400 to-emerald-600 disabled:opacity-70"
                          aria-label="Run TEST"
                        >
                          {testStatus === "calling"
                            ? "Testing…"
                            : testStatus === "ok"
                              ? "AGAIN"
                              : "TEST"}
                        </button>
                        <button
                          onClick={onPinTest}
                          className="h-44 w-44 md:h-52 md:w-52 rounded-full select-none text-white font-extrabold text-3xl md:text-4xl tracking-wide focus:outline-none ring-2 ring-amber-300 shadow-[0_20px_60px_rgba(245,158,11,.25)] bg-gradient-to-b from-amber-400 to-amber-600"
                          aria-label="PIN TEST"
                          title="Send MONITOR for pins 1–40 to this ESP"
                        >
                          PIN TEST
                        </button>
                      </div>
                      <div className="flex items-center gap-6 text-[12px] font-semibold text-slate-600">
                        <span className="inline-flex items-center gap-1">
                          <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
                          TEST: Send handshake + test
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <span className="inline-block h-2 w-2 rounded-full bg-amber-400" />
                          PIN TEST: Toggle pins 1–40
                        </span>
                      </div>
                      {!!testMsg && (
                        <div
                          className={`rounded-full px-4 py-1.5 text-sm font-semibold ring-1 ${
                            testStatus === "ok"
                              ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                              : testStatus === "error"
                                ? "bg-red-50 text-red-700 ring-red-200"
                                : "bg-white text-slate-600 ring-slate-200"
                          }`}
                        >
                          {testMsg}
                        </div>
                      )}
                    </div>
                  )}

                  <StatusStrip tone={stripTone} text={stripText} />
                </div>
              </div>
            </div>
          </m.div>
        </>
      )}
    </AnimatePresence>
  );
}

/* Compact ESP button for header */
const EspDiscoverButton: React.FC<{
  onClick: () => void;
  busy: boolean;
  mac?: string | null;
}> = ({ onClick, busy, mac }) => (
  <m.button
    type="button"
    onClick={onClick}
    whileHover={{ y: -2 }}
    whileTap={{ scale: 0.98 }}
    className="inline-flex flex-col items-center gap-2 rounded-2xl px-4 pt-5 pb-3 bg-transparent"
    title="Discover ESP and read MAC"
  >
    <ESPIcon className="h-[64px] w-[64px]" />
    <span className="text-[12px] leading-none font-extrabold tracking-tight text-slate-900 dark:text-slate-100">
      {busy ? "Discovering…" : "ESP FIND MAC"}
    </span>
    {mac && (
      <span className="mt-1 px-2 py-0.5 rounded-full text-[11px] font-bold ring-1 ring-emerald-300/60 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
        {mac}
      </span>
    )}
  </m.button>
);

/* ────────────────────────────────────────────────────────────────────────────
   Header
   ──────────────────────────────────────────────────────────────────────────── */
interface HeaderProps {
  onSettingsClick: () => void;
  currentView: "main" | "settings";
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
  labelsHidden?: boolean;
  serial?: SerialState;
  displayMac?: string;
}

export const Header: React.FC<HeaderProps> = ({
  onSettingsClick,
  currentView,
  isSidebarOpen: _isSidebarOpen,
  onToggleSidebar: _onToggleSidebar,
  labelsHidden = false,
  serial: injectedSerial,
  displayMac: _displayMac,
}) => {
  const [isHeaderVisible, setIsHeaderVisible] = useState(true);
  const [settingsSize, setSettingsSize] = useState<number>(150);

  const lastScrollY = useRef(0);
  const isHeaderVisibleRef = useRef(true);
  const rafId = useRef<number | null>(null);
  const resizeRafId = useRef<number | null>(null);

  const serialUsed = injectedSerial ?? useSerialEvents(undefined);
  const {
    devices,
    server,
    scannerPorts: ports,
    netIface,
    netIp,
    netPresent,
    netUp,
  } = serialUsed;

  type SlotState = { present: boolean; open: boolean };
  const slotState = (idx: number): SlotState => {
    const cfg = (scanners as any)[idx] ?? {};
    const wantPath = String(cfg.path ?? "").trim();
    const usbAllow = Array.isArray(cfg.usb)
      ? (cfg.usb as string[]).map((p) => p.toLowerCase())
      : null;

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

  const colorFor = (s: SlotState): LedColor =>
    s.open ? "green" : s.present ? "green" : "red";
  const subFor = (s: SlotState) =>
    s.open ? "Ready" : s.present ? "Detected" : "Not detected";

  const s1Color: LedColor = colorFor(s1);
  const s1Sub = subFor(s1);
  const s2Color: LedColor = colorFor(s2);
  const s2Sub = subFor(s2);

  const serverColor: LedColor = server === "connected" ? "green" : "red";
  const serverSub = server === "connected" ? "ESP + Redis" : "Needs ESP+Redis";

  // KROSY: consider live/online when on eth* with ONLINE IP; otherwise offline/no-conn
  const IP_ONLINE = (process.env.NEXT_PUBLIC_KROSY_IP_ONLINE || "").trim();
  const IP_OFFLINE = (process.env.NEXT_PUBLIC_KROSY_IP_OFFLINE || "").trim();
  const krosyEth = (netIface ?? "").toLowerCase().startsWith("eth");
  const hasNet = Boolean(netPresent && netUp && krosyEth && (netIp ?? ""));
  const isOnlineIp = Boolean(IP_ONLINE && (netIp ?? "") === IP_ONLINE);
  const isOfflineIp = Boolean(IP_OFFLINE && (netIp ?? "") === IP_OFFLINE);
  const krosyOnline = Boolean(hasNet && isOnlineIp);
  const krosyColor: LedColor = krosyOnline ? "green" : "red";
  const krosySub = !hasNet
    ? "No connection"
    : isOnlineIp
      ? "Online"
      : "Offline";

  /* ESP discover/test state */
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const [discoverStatus, setDiscoverStatus] = useState<DiscoverState>("idle");
  const [foundMac, setFoundMac] = useState<string | null>(null);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<TestState>("idle");
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const discoverAbortRef = useRef<AbortController | null>(null);

  const openDiscover = async () => {
    setDiscoverOpen(true);
    setDiscoverStatus("searching");
    setDiscoverError(null);
    setTestStatus("idle");
    setTestMsg(null);

    discoverAbortRef.current?.abort();
    const ctrl = new AbortController();
    discoverAbortRef.current = ctrl;
    try {
      const res = await fetch("/api/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(await res.text());
      const raw = (await res.json()) as { macAddress?: string; error?: string };
      const mac = raw.macAddress;
      if (!mac) throw new Error(raw.error || "No MAC returned");
      setFoundMac(mac);
      setDiscoverStatus("success");
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      setDiscoverStatus("error");
      setDiscoverError(e?.message || "Discovery failed");
    }
  };

  const retryDiscover = async () => {
    discoverAbortRef.current?.abort();
    await openDiscover();
  };

  const closeDiscover = () => {
    discoverAbortRef.current?.abort();
    setDiscoverOpen(false);
    setDiscoverStatus("idle"); // <- stop "Discovering…"
    setDiscoverError(null);
    setTestStatus("idle");
    setTestMsg(null);
  };

  const runPinTest = async () => {
    try {
      const body = foundMac ? { mac: foundMac } : {};
      await fetch("/api/serial/pin-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        keepalive: true,
      });
    } catch {}
  };

  const runTest = async () => {
    if (!foundMac) return;
    try {
      setTestStatus("calling");
      setTestMsg("Sending WELCOME…");

      // 1) Handshake
      const w = await fetch("/api/welcome", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mac: foundMac }),
      });
      const wj = await w.json();
      if (!w.ok) throw new Error(wj?.error || "WELCOME failed");

      setTestMsg("WELCOME READY. Sending TEST…");

      // 2) Actual test
      const t = await fetch("/api/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mac: foundMac }),
      });
      const tj = await t.json();
      if (!t.ok) throw new Error(tj?.error || "TEST failed");

      setTestStatus("ok");
      setTestMsg(
        tj.ready
          ? "READY received. Test OK."
          : tj.message || "Test command sent."
      );
    } catch (e: any) {
      setTestStatus("error");
      setTestMsg(e?.message ?? "Failed to run test.");
    }
  };

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
        const vw = typeof window !== "undefined" ? window.innerWidth : 1600;
        const size = Math.max(136, Math.min(vw * 0.1, 172));
        setSettingsSize(Math.round(size));
      });
    };

    onResize();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      if (rafId.current) cancelAnimationFrame(rafId.current);
      if (resizeRafId.current) cancelAnimationFrame(resizeRafId.current);
      discoverAbortRef.current?.abort();
    };
  }, []);

  if ((appConfig as any).hideHeader) return null;

  const barVariants: Variants = {
    shown: {
      y: 0,
      transition: { type: "spring", stiffness: 420, damping: 42, mass: 0.8 },
    },
    hidden: {
      y: -120,
      transition: { type: "tween", duration: 0.18, ease: [0.22, 1, 0.36, 1] },
    },
  };

  return (
    <>
      <AnimatePresence initial={false}>
        <m.header
          key="single-row-header"
          variants={barVariants}
          initial="shown"
          animate={isHeaderVisible ? "shown" : "hidden"}
          className={["w-full sticky top-0 z-30", StrictHeaderBg].join(" ")}
          style={{
            height: `calc(${settingsSize}px + env(safe-area-inset-top))`,
            minHeight: `calc(${BASE_HEADER_MIN_HEIGHT} + env(safe-area-inset-top))`,
            willChange: "transform",
            backfaceVisibility: "hidden",
            transform: "translateZ(0)",
          }}
        >
          <div
            className="grid w-full h-full items-center gap-5 xl:gap-8 px-4 sm:px-6 2xl:px-10"
            style={{
              paddingTop: "env(safe-area-inset-top)",
              gridTemplateColumns:
                "minmax(260px,340px) 1fr minmax(260px,320px)",
            }}
          >
            {/* 1) Support + Version */}
            <div className="h-full flex items-center gap-3 pr-2 md:pr-4">
              {(() => {
                const raw = String(
                  process.env.NEXT_PUBLIC_APP_VERSION ||
                    process.env.NEXT_PUBLIC_VERSION ||
                    "0.8.0"
                ).trim();
                const clean = raw.replace(/^v/i, "");
                const label = `Version: ${clean}`;
                return (
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-flex items-center rounded-xl border border-slate-300 bg-white px-3 py-1 text-xs font-bold text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                      title={label}
                    >
                      {label}
                    </span>
                    <ThemeToggle />
                  </div>
                );
              })()}
              <SupportPillSM
                className="h-full"
                supportNumber={(appConfig as any).callSupportInfo?.count ?? 621}
                onCall={(appConfig as any).callSupportInfo?.onCta}
                labelsHidden={labelsHidden}
              />
            </div>

            {/* 2) Status */}
            <div className="h-full min-w-0">
              <StatusRow
                cells={[
                  {
                    title: "Scanner Check",
                    suffix: 1,
                    color: s1Color,
                    sub: s1Sub,
                  },
                  {
                    title: "Scanner Setup",
                    suffix: 2,
                    color: s2Color,
                    sub: s2Sub,
                  },
                  { title: "Local Server", color: serverColor, sub: serverSub },
                  { title: "Krosy Server", color: krosyColor, sub: krosySub },
                  // Removed Last MAC indicator per request; status rows now focus on live infrastructure only.
                ]}
                className="h-full"
                labelsHidden={labelsHidden}
              />
            </div>

            {/* 3) ESP + Settings */}
            <div className="h-full flex items-center justify-end gap-3">
              <EspDiscoverButton
                onClick={openDiscover}
                busy={discoverStatus === "searching"}
                mac={foundMac}
              />
              {!process.env.NEXT_PUBLIC_HIDE_SETTINGS && (
                <SettingsIconButton
                  size={settingsSize}
                  label={currentView === "settings" ? "Dashboard" : "Settings"}
                  onClick={onSettingsClick}
                  showLabel={!labelsHidden}
                />
              )}
            </div>
          </div>
        </m.header>
      </AnimatePresence>

      {/* Modal */}
      <DiscoverEspModal
        open={discoverOpen}
        status={discoverStatus}
        mac={foundMac}
        error={discoverError}
        onClose={closeDiscover}
        onRetry={retryDiscover}
        onTest={runTest}
        onPinTest={runPinTest}
        testStatus={testStatus}
        testMsg={testMsg}
      />
    </>
  );
};

export default Header;
