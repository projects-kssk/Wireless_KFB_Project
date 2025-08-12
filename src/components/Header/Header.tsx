// src/components/Header/Header.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import type { SimpleStatus } from "@/components/Header/StatusIndicatorCard";
import { MenuIcon, XMarkIcon } from "@/components/Icons/Icons";
import { appConfig } from "@/components/config/appConfig";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useSerialEvents } from "./useSerialEvents";

/* ────────────────────────────────────────────────────────────────────────────
   Config
   ──────────────────────────────────────────────────────────────────────────── */
const CUSTOM_HEADER_HEIGHT = "7rem";

/* ────────────────────────────────────────────────────────────────────────────
   Types used locally (mirrors server payloads)
   ──────────────────────────────────────────────────────────────────────────── */
type DeviceInfo = {
  path: string;
  vendorId: string | null;
  productId: string | null;
  manufacturer: string | null;
  serialNumber: string | null;
};

/* ────────────────────────────────────────────────────────────────────────────
   Style tokens (soft glass, crisper LED, cleaner shadows)
   ──────────────────────────────────────────────────────────────────────────── */
const Glass = [
  "bg-white/85 dark:bg-slate-800/60",
  "backdrop-blur-2xl",
  "border border-white/60 dark:border-white/10",
  "shadow-[0_10px_30px_-16px_rgba(2,6,23,0.28),_0_6px_14px_rgba(2,6,23,0.12)]",
].join(" ");

const DividerHairline =
  "after:absolute after:inset-y-1.5 after:left-[72px] after:w-px after:bg-white/60 dark:after:bg-white/10";

/* ────────────────────────────────────────────────────────────────────────────
   Support (more iOS-y, calmer)
   ──────────────────────────────────────────────────────────────────────────── */
const SupportPill: React.FC<{ count?: number }> = ({ count = 0 }) => {
  const display = Number.isFinite(count) ? Number(count) : 0;
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={[
        "relative inline-flex items-center h-14 2xl:h-16 rounded-full pl-[72px] pr-6",
        Glass,
        DividerHairline,
      ].join(" ")}
      style={{ overflow: "hidden" }}
      aria-live="polite"
    >
      {/* left numeric badge */}
      <div className="absolute left-2 top-1/2 -translate-y-1/2">
        <div
          className={[
            "relative inline-flex items-center justify-center rounded-full",
            "h-10 w-10 2xl:h-12 2xl:w-12 text-base 2xl:text-lg font-bold tabular-nums",
            "bg-sky-600 text-white ring-2 ring-white/80 dark:ring-white/10",
            "shadow-[0_10px_24px_rgba(2,132,199,0.35)]",
          ].join(" ")}
          title="Open support items"
        >
          {display}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-full"
            style={{
              background:
                "radial-gradient(40% 40% at 28% 28%, rgba(255,255,255,.9), rgba(255,255,255,0) 60%)",
            }}
          />
        </div>
      </div>

      <span className="text-xl 2xl:text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white">
        Support
      </span>
    </motion.div>
  );
};

/* ────────────────────────────────────────────────────────────────────────────
   LED capsule (title + optional number chip + right status)
   ──────────────────────────────────────────────────────────────────────────── */
const LedPill: React.FC<{
  title: string;
  sub?: string | null;
  color: "green" | "amber" | "red";
  suffix?: string | number;
}> = ({ title, sub, color, suffix }) => {
  const reduceMotion = useReducedMotion();

  const cfg =
    color === "green"
      ? {
          core: "#22c55e",
          mid: "#16a34a",
          dark: "#0f7a3b",
          ring: "ring-emerald-200/80",
          halo: "0 0 0 10px rgba(16,185,129,.18), 0 16px 36px rgba(16,185,129,.35)",
          chipBg: "bg-emerald-600 text-white",
          subBg: "bg-emerald-100 text-emerald-700",
        }
      : color === "amber"
      ? {
          core: "#f59e0b",
          mid: "#d97706",
          dark: "#b45309",
          ring: "ring-amber-200/80",
          halo: "0 0 0 10px rgba(245,158,11,.18), 0 16px 36px rgba(245,158,11,.32)",
          chipBg: "bg-amber-600 text-white",
          subBg: "bg-amber-100 text-amber-800",
        }
      : {
          core: "#f43f5e",
          mid: "#e11d48",
          dark: "#be123c",
          ring: "ring-rose-200/80",
          halo: "0 0 0 10px rgba(244,63,94,.18), 0 16px 36px rgba(244,63,94,.32)",
          chipBg: "bg-rose-600 text-white",
          subBg: "bg-rose-100 text-rose-700",
        };

  return (
    <motion.div
      layout
      className={[
        "relative inline-flex items-center rounded-full",
        "h-18 2xl:h-20 px-6 2xl:px-8",
        "min-w-[300px]",
        Glass,
      ].join(" ")}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      style={{ overflow: "hidden" }}
    >
      {/* LED */}
      <div className="relative mr-4 shrink-0">
        <motion.span
          aria-hidden
          className={`block rounded-full ${cfg.ring} ring-4 h-14 w-14 2xl:h-16 2xl:w-16 shadow-md`}
          style={{
            background: `
              radial-gradient(52% 52% at 32% 28%, rgba(255,255,255,.95) 0%, rgba(255,255,255,0) 42%),
              radial-gradient(80% 80% at 50% 60%, ${cfg.core} 0%, ${cfg.mid} 60%, ${cfg.dark} 100%)
            `,
            boxShadow: cfg.halo,
          }}
          animate={reduceMotion ? undefined : { scale: [1, 1.015, 1] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
        />
        {/* crisp inner specular rim */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-full"
          style={{ boxShadow: "inset 0 2px 6px rgba(0,0,0,.16), inset 0 -2px 4px rgba(0,0,0,.10)" }}
        />
      </div>

      {/* Title + number chip */}
      <div className="flex items-center gap-2">
        <span className="text-2xl 2xl:text-3xl font-extrabold text-slate-900 dark:text-white">
          {title}
        </span>
        {suffix !== undefined && (
          <span
            className={[
              "inline-flex items-center justify-center rounded-full",
              "h-7 w-7 2xl:h-8 2xl:w-8 text-sm 2xl:text-base font-bold",
              cfg.chipBg,
              "shadow-sm",
            ].join(" ")}
          >
            {suffix}
          </span>
        )}
      </div>

      {/* Right-aligned status */}
      {sub && (
        <span
          className={[
            "ml-auto inline-flex items-center rounded-full px-2.5 py-0.5",
            "text-xs 2xl:text-sm font-semibold",
            cfg.subBg,
            "shadow-[0_1px_0_rgba(255,255,255,.6)_inset]",
          ].join(" ")}
        >
          {sub}
        </span>
      )}
    </motion.div>
  );
};

/* ────────────────────────────────────────────────────────────────────────────
   Props
   ──────────────────────────────────────────────────────────────────────────── */
interface HeaderProps {
  onSettingsClick: () => void;
  currentView: "main" | "settings";
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
}

/* ────────────────────────────────────────────────────────────────────────────
   Helpers for VID:PID normalization
   ──────────────────────────────────────────────────────────────────────────── */
const normHex = (s?: string | null) =>
  (s ?? "").replace(/^0x/i, "").padStart(4, "0").toLowerCase();
const pair = (vid?: string | null, pid?: string | null) =>
  vid && pid ? `${normHex(vid)}:${normHex(pid)}` : null;

/* ────────────────────────────────────────────────────────────────────────────
   Header (SSE-driven LEDs)
   ──────────────────────────────────────────────────────────────────────────── */
export const Header: React.FC<HeaderProps> = ({
  onSettingsClick,
  currentView,
  isSidebarOpen,
  onToggleSidebar,
}) => {
  const [windowWidth, setWindowWidth] = useState<number>(0);
  const [isClient, setIsClient] = useState<boolean>(false);
  const [isHeaderVisible, setIsHeaderVisible] = useState(true);
  const lastScrollY = useRef(0);

  // live data from /api/serial/events (SSE)
  const { devices, server, lastScan } = useSerialEvents();

  // Scanners from config (tie pills to physical devices by path and/or VID:PID)
  const scanners = useMemo(
    () =>
      (appConfig as any).scanners?.length
        ? (appConfig as any).scanners
        : [
            { name: "Scanner", path: "" },
            { name: "Scanner", path: "" },
          ],
    []
  );

  // Presence check for each configured scanner
  const isPresentFor = (idx: number) => {
    const cfg = (scanners as any)[idx] ?? {};
    const usbAllow = Array.isArray(cfg.usb)
      ? (cfg.usb as string[]).map((p) => p.toLowerCase())
      : null;

    return devices.some((d: DeviceInfo) => {
      // path match, if configured
      if (cfg.path && !String(d.path).includes(String(cfg.path))) return false;
      // VID:PID match, if configured
      if (usbAllow) {
        const p = pair(d.vendorId, d.productId);
        if (!p || !usbAllow.includes(p)) return false;
      }
      // if neither filter provided, any device satisfies
      return true;
    });
  };

  // Derive LED states
  const s1 = isPresentFor(0);
  const s2 = isPresentFor(1);

  const s1Color: "green" | "red" = s1 ? "green" : "red";
  const s2Color: "green" | "red" = s2 ? "green" : "red";
  const s1Sub = s1 ? (lastScan ? `Last: ${lastScan}` : "Ready") : "Not detected";
  const s2Sub = s2 ? (lastScan ? `Last: ${lastScan}` : "Ready") : "Not detected";

  const serverColor: "green" | "amber" | "red" = server === "connected" ? "green" : "red";
  const serverSub = server === "connected" ? "Online" : "Offline";

  useEffect(() => {
    setIsClient(true);

    const handleResize = () => setWindowWidth(window.innerWidth);
    handleResize();
    window.addEventListener("resize", handleResize);

    const handleScroll = () => {
      const y = window.scrollY;
      setIsHeaderVisible(y < lastScrollY.current || y <= 10);
      lastScrollY.current = y;
    };
    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  if ((appConfig as any).hideHeader) return null;

  const widgetsDynamicClass =
    isClient &&
    currentView === "main" &&
    isSidebarOpen &&
    windowWidth < 1536 &&
    windowWidth > 0
      ? "hidden 2xl:flex"
      : "flex";

  const mainButtonText = currentView === "settings" ? "Dashboard" : "Settings";

  const barVariants = {
    shown: { y: 0, transition: { type: "spring", stiffness: 650, damping: 40 } },
    hidden: { y: "-100%", transition: { type: "tween", duration: 0.25 } },
  };

  return (
    <AnimatePresence initial={false}>
      <motion.header
        key="ios-header"
        variants={barVariants}
        initial="shown"
        animate={isHeaderVisible ? "shown" : "hidden"}
        className={[
          "w-full sticky top-0 z-30",
          "bg-white/55 dark:bg-slate-900/35",
          "backdrop-blur-2xl supports-[backdrop-filter]:bg-white/55",
          "border-b border-white/60 dark:border-white/10",
        ].join(" ")}
        style={{ height: `calc(${CUSTOM_HEADER_HEIGHT} + env(safe-area-inset-top))` }}
      >
        <div
          className="flex items-center justify-between w-full h-full px-4 sm:px-6 2xl:px-10"
          style={{ paddingTop: "env(safe-area-inset-top)" }}
        >
          {/* Left: Sidebar toggle */}
          {currentView === "main" && (
            <motion.button
              onClick={onToggleSidebar}
              aria-label={isSidebarOpen ? "Close Sidebar" : "Open Sidebar"}
              whileTap={{ scale: 0.92 }}
              className={[
                "h-14 w-14 2xl:h-16 2xl:w-16 flex items-center justify-center",
                "rounded-full border border-white/60 dark:border-white/10",
                "bg-white/75 dark:bg-slate-800/55 backdrop-blur-xl",
                "text-slate-700 dark:text-slate-100",
                "shadow-[0_8px_24px_rgba(0,0,0,0.08)] active:shadow-inner",
              ].join(" ")}
            >
              {isSidebarOpen ? (
                <XMarkIcon className="h-9 w-9 2xl:h-10 2xl:w-10" />
              ) : (
                <MenuIcon className="h-9 w-9 2xl:h-10 2xl:w-10" />
              )}
            </motion.button>
          )}

          {/* Middle: Support + LED capsules */}
          <div className={`flex-1 flex items-center h-full ${widgetsDynamicClass}`}>
            <SupportPill count={(appConfig as any).callSupportInfo?.count ?? 0} />

            <div className="hidden lg:flex items-center gap-6 2xl:gap-8 ml-5">
              <LedPill title="Scanner" suffix={1} color={s1Color} sub={s1Sub} />
              <LedPill title="Scanner" suffix={2} color={s2Color} sub={s2Sub} />
              <LedPill title="Server Status" color={serverColor} sub={serverSub} />
            </div>
          </div>

          {/* Right: Settings/Dashboard */}
          <motion.button
            type="button"
            aria-label={mainButtonText}
            onClick={onSettingsClick}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.96 }}
            className={[
              "inline-flex items-center gap-3",
              "h-14 2xl:h-16 px-6 2xl:px-8",
              "rounded-full font-semibold",
              "text-xl 2xl:text-2xl tracking-tight",
              "text-slate-900 dark:text-slate-50",
              Glass,
            ].join(" ")}
          >
            <span aria-hidden className="text-2xl 2xl:text-3xl leading-none">⚙️</span>
            <span>{mainButtonText}</span>
          </motion.button>
        </div>
      </motion.header>
    </AnimatePresence>
  );
};

export default Header;
