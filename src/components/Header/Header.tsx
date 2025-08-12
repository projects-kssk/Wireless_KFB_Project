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
// Softer Cupertino glass: lighter blur, inset highlight, softer shadow
const Glass = [
  "bg-white/70 dark:bg-slate-900/40",
  "backdrop-blur-3xl",
  "border border-white/50 dark:border-white/10",
  "shadow-[0_12px_28px_rgba(2,6,23,0.10)]",
  "ring-1 ring-white/40 dark:ring-white/5",
  "shadow-[inset_0_1px_0_rgba(255,255,255,0.65),_0_12px_28px_rgba(2,6,23,0.10)]"
].join(" ");


const DividerHairline =
  "after:absolute after:inset-y-1.5 after:left-[72px] after:w-px after:bg-white/60 dark:after:bg-white/10";

/* ────────────────────────────────────────────────────────────────────────────
   Support pill (scaled for TV)
   ──────────────────────────────────────────────────────────────────────────── */
const SupportPill: React.FC<{ count?: number }> = ({ count = 0 }) => {
  const display = Number.isFinite(count) ? Number(count) : 0;
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={[
        "relative inline-flex items-center rounded-full",
        "h-[64px] 2xl:h-[72px] min-[1920px]:h-[88px] min-[2560px]:h-[108px]",
        "pl-[76px] pr-6 sm:pr-7 2xl:pl-[84px] 2xl:pr-8",
        "w-full",
        Glass,
        DividerHairline,
      ].join(" ")}
      style={{ overflow: "hidden" }}
      aria-live="polite"
    >
      {/* Left numeric badge */}
      <div className="absolute left-3 top-1/2 -translate-y-1/2">
        <div
          className={[
            "relative inline-flex items-center justify-center rounded-full",
            "h-11 w-11 2xl:h-12 2xl:w-12 min-[1920px]:h-14 min-[1920px]:w-14 min-[2560px]:h-[68px] min-[2560px]:w-[68px]",
            "text-base 2xl:text-lg min-[1920px]:text-2xl min-[2560px]:text-3xl font-bold tabular-nums",
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

      <span className="text-xl 2xl:text-2xl min-[1920px]:text-4xl min-[2560px]:text-5xl font-extrabold tracking-tight text-slate-900 dark:text-white">
        Support
      </span>
    </motion.div>
  );
};

/* ────────────────────────────────────────────────────────────────────────────
   LED capsule (title + optional number chip + right status) — TV sizing
   ──────────────────────────────────────────────────────────────────────────── */
const LedPill: React.FC<{
  title: string;
  sub?: string | null;
  color: "green" | "amber" | "red";
  suffix?: string | number;
}> = ({ title, sub, color, suffix }) => {
  const reduceMotion = useReducedMotion();

  // Pastel, low-saturation palette + soft ring
  const cfg =
    color === "green"
      ? {
          dotA: "#34d399", // teal-400
          dotB: "#10b981", // emerald-500
          rim: "rgba(16,185,129,.55)",
          chipBg: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/70",
        }
      : color === "amber"
      ? {
          dotA: "#fbbf24", // amber-400
          dotB: "#f59e0b", // amber-500
          rim: "rgba(245,158,11,.55)",
          chipBg: "bg-amber-50 text-amber-800 ring-1 ring-amber-200/70",
        }
      : {
          dotA: "#fb7185", // rose-400
          dotB: "#ef4444", // red-500 (soften via blend)
          rim: "rgba(244,63,94,.55)",
          chipBg: "bg-rose-50 text-rose-700 ring-1 ring-rose-200/70",
        };

  return (
    <motion.div
      layout
      className={[
        "relative inline-flex items-center rounded-full w-full",
        "h-[64px] 2xl:h-[72px] min-[1920px]:h-[88px] min-[2560px]:h-[108px]",
        "px-7 2xl:px-8 min-[1920px]:px-10 min-[2560px]:px-12",
        Glass,
      ].join(" ")}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      style={{ overflow: "hidden" }}
    >
      {/* LED — flatter, Cupertino-style */}
      <div className="relative mr-4 2xl:mr-5 shrink-0">
        <span
          aria-hidden
          className="block rounded-full h-12 w-12 2xl:h-14 2xl:w-14 min-[1920px]:h-16 min-[1920px]:w-16 min-[2560px]:h-20 min-[2560px]:w-20"
          style={{
            // soft rim + inner shadow (subtle)
            boxShadow:
              `0 0 0 6px ${cfg.rim}, 0 10px 22px rgba(2,6,23,.12), inset 0 -2px 6px rgba(0,0,0,.10), inset 0 2px 4px rgba(255,255,255,.65)`,
            background: `
              radial-gradient(120% 120% at 28% 24%, rgba(255,255,255,.92) 0%, rgba(255,255,255,0) 42%),
              radial-gradient(85% 85% at 50% 60%, ${cfg.dotA} 0%, ${cfg.dotB} 70%)
            `,
          }}
        />
        {/* top-left specular glint */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-full"
          style={{
            WebkitMask:
              "radial-gradient(50% 50% at 30% 28%, rgba(0,0,0,.75) 0%, rgba(0,0,0,0) 60%)",
            background:
              "linear-gradient(180deg, rgba(255,255,255,.9), rgba(255,255,255,0))",
            mixBlendMode: "screen",
          }}
        />
        {/* gentle breathing glow */}
        {!reduceMotion && (
          <motion.span
            aria-hidden
            className="absolute inset-0 rounded-full"
            style={{ boxShadow: `0 0 0 0 ${cfg.rim}` }}
            animate={{ boxShadow: [`0 0 0 0 ${cfg.rim}`, `0 0 0 10px transparent`] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
          />
        )}
      </div>

      {/* Title + number chip (less heavy, more iOS) */}
      <div className="flex items-center gap-2 2xl:gap-3">
        <span className="text-2xl 2xl:text-3xl min-[1920px]:text-4xl min-[2560px]:text-5xl font-bold tracking-tight text-slate-900 dark:text-white">
          {title}
        </span>
        {suffix !== undefined && (
          <span
            className={[
              "inline-flex items-center justify-center rounded-full",
              "h-7 w-7 2xl:h-8 2xl:w-8 min-[1920px]:h-10 min-[1920px]:w-10 min-[2560px]:h-12 min-[2560px]:w-12",
              "text-sm 2xl:text-base min-[1920px]:text-xl min-[2560px]:text-2xl font-bold",
              cfg.chipBg,
            ].join(" ")}
          >
            {suffix}
          </span>
        )}
      </div>

      {/* Right-aligned status chip (pastel, subtle ring) */}
      {sub && (
        <span
          className={[
            "ml-auto inline-flex items-center rounded-full",
            "px-3 py-1 2xl:px-3.5 2xl:py-1.5 min-[1920px]:px-4 min-[1920px]:py-2",
            "text-xs 2xl:text-sm min-[1920px]:text-xl min-[2560px]:text-2xl font-semibold",
            cfg.chipBg,
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
      if (cfg.path && !String(d.path).includes(String(cfg.path))) return false;
      if (usbAllow) {
        const p = pair(d.vendorId, d.productId);
        if (!p || !usbAllow.includes(p)) return false;
      }
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

  // Slight “float/offset” for the X when sidebar is open
  const sidebarBtnOpenMods =
    "ring-1 ring-white/70 dark:ring-white/10 translate-y-[-2px] -translate-x-[2px] shadow-[0_12px_24px_rgba(2,6,23,0.18)]";

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
          className="flex items-center justify-between w-full h-full px-6 sm:px-8 2xl:px-12 min-[1920px]:px-16 min-[2560px]:px-24"
          style={{ paddingTop: "env(safe-area-inset-top)" }}
        >
          {/* Left: Sidebar toggle */}
          {currentView === "main" && (
            <motion.button
              onClick={onToggleSidebar}
              aria-label={isSidebarOpen ? "Close Sidebar" : "Open Sidebar"}
              whileTap={{ scale: 0.92 }}
              className={[
                "h-14 w-14 2xl:h-16 2xl:w-16 min-[1920px]:h-20 min-[1920px]:w-20 min-[2560px]:h-24 min-[2560px]:w-24",
                "flex items-center justify-center",
                "rounded-full border border-white/60 dark:border-white/10",
                "bg-white/75 dark:bg-slate-800/55 backdrop-blur-xl",
                "text-slate-700 dark:text-slate-100",
                "shadow-[0_8px_24px_rgba(0,0,0,0.08)] active:shadow-inner",
                isSidebarOpen ? sidebarBtnOpenMods : "",
              ].join(" ")}
            >
              {isSidebarOpen ? (
                <XMarkIcon className="h-9 w-9 2xl:h-10 2xl:w-10 min-[1920px]:h-12 min-[1920px]:w-12 min-[2560px]:h-14 min-[2560px]:w-14" />
              ) : (
                <MenuIcon className="h-9 w-9 2xl:h-10 2xl:w-10 min-[1920px]:h-12 min-[1920px]:w-12 min-[2560px]:h-14 min-[2560px]:w-14" />
              )}
            </motion.button>
          )}

          {/* Middle: Support + LED capsules — turn into a 4-col grid that fills width on TVs */}
          <div className={`flex-1 ${widgetsDynamicClass} items-center h-full ml-4 sm:ml-6 2xl:ml-8`}>
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 2xl:gap-8 min-[1920px]:gap-10 min-[2560px]:gap-12 w-full">
              <SupportPill count={(appConfig as any).callSupportInfo?.count ?? 0} />
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
              "h-[64px] 2xl:h-[72px] min-[1920px]:h-[88px] min-[2560px]:h-[108px]",
              "px-6 2xl:px-8 min-[1920px]:px-10 min-[2560px]:px-12",
              "rounded-full font-semibold",
              "text-xl 2xl:text-2xl min-[1920px]:text-4xl min-[2560px]:text-5xl tracking-tight",
              "text-slate-900 dark:text-slate-50",
              Glass,
            ].join(" ")}
          >
            <span aria-hidden className="text-2xl 2xl:text-3xl min-[1920px]:text-5xl min-[2560px]:text-6xl leading-none">⚙️</span>
            <span>{mainButtonText}</span>
          </motion.button>
        </div>
      </motion.header>
    </AnimatePresence>
  );
};

export default Header;
