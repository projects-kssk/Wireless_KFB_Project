'use client';

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence, type Variants } from "framer-motion";
import { XMarkIcon } from "@/components/Icons/Icons";
import {
  SettingsHomeIcon,
  SettingsCogIcon,   // now a Sliders/Tuning icon under the hood
  SettingsCubeIcon,
} from "@/components/Icons/Icons";
import { FlexibleOtpModal } from "@/components/Modals/FlexibleOtpModal";
import { appConfig, RIGHT_SETTINGS_SIDEBAR_WIDTH } from "@/components/config/appConfig";

type SettingsSectionId = "MAIN_S" | "CONFIG_S" | "BRANCHES_S";

interface SettingsRightSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  appHeaderHeight: string; // kept for API compatibility
  onShowConfigurationInMain: () => void;
  onShowBranchesSettingsInMain: () => void;
}

/* Glass styles */
const SheetGlass =
  "bg-white/85 dark:bg-slate-900/80 backdrop-blur-2xl border border-white/70 dark:border-white/10 shadow-[0_24px_60px_rgba(2,6,23,0.28)]";

const TileGlass =
  "bg-white/80 dark:bg-slate-800/60 backdrop-blur-2xl border border-white/60 dark:border-white/10 shadow-[0_12px_36px_-14px_rgba(2,6,23,0.35)]";

/* Motion */
const panelVariants: Variants = {
  hidden: { x: 24, opacity: 0 },
  shown:  { x: 0, opacity: 1, transition: { type: "spring", stiffness: 600, damping: 45 } },
  exit:   { x: 24, opacity: 0, transition: { duration: 0.18 } },
};
const overlayVariants: Variants = {
  hidden: { opacity: 0 },
  shown:  { opacity: 1, transition: { duration: 0.18 } },
  exit:   { opacity: 0, transition: { duration: 0.15 } },
};

export const SettingsRightSidebar: React.FC<SettingsRightSidebarProps> = ({
  isOpen,
  onClose,
  appHeaderHeight, // eslint-disable-line @typescript-eslint/no-unused-vars
  onShowConfigurationInMain,
  onShowBranchesSettingsInMain,
}) => {
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("MAIN_S");
  const [showInternalPinModal, setShowInternalPinModal] = useState(false);
  const [internalPinTarget, setInternalPinTarget] = useState<SettingsSectionId | null>(null);
  const [internalPinAttempts, setInternalPinAttempts] = useState(3);
  const [internalPinErrorMessage, setInternalPinErrorMessage] = useState("");

  useEffect(() => {
    if (isOpen && !showInternalPinModal && !internalPinTarget) setActiveSection("MAIN_S");
    if (!isOpen) {
      setActiveSection("MAIN_S");
      setShowInternalPinModal(false);
      setInternalPinTarget(null);
      setInternalPinErrorMessage("");
    }
  }, [isOpen, showInternalPinModal, internalPinTarget]);

  const handleTileClick = (sectionId: SettingsSectionId) => {
    if (sectionId === "MAIN_S") {
      setActiveSection("MAIN_S");
      setShowInternalPinModal(false);
      return;
    }
    if (activeSection === sectionId && showInternalPinModal && internalPinTarget === sectionId) return;
    setInternalPinTarget(sectionId);
    setInternalPinAttempts(3);
    setInternalPinErrorMessage("");
    setShowInternalPinModal(true);
  };

  const handleInternalPinSubmit = (enteredOtp: string) => {
    if (enteredOtp === appConfig.correctOtp) {
      if (internalPinTarget === "CONFIG_S") {
        setActiveSection("CONFIG_S");
        onShowConfigurationInMain();
        onClose();
      } else if (internalPinTarget === "BRANCHES_S") {
        setActiveSection("BRANCHES_S");
        onShowBranchesSettingsInMain();
        onClose();
      }
      setShowInternalPinModal(false);
      setInternalPinTarget(null);
      setInternalPinErrorMessage("");
    } else {
      const next = internalPinAttempts - 1;
      setInternalPinAttempts(next);
      setInternalPinErrorMessage(
        next > 0 ? `Incorrect PIN. ${next} attempt${next === 1 ? "" : "s"} left.` : "Too many incorrect attempts. Access denied."
      );
      if (next <= 0) {
        setTimeout(() => {
          setShowInternalPinModal(false);
          setInternalPinTarget(null);
        }, 1400);
      }
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Overlay */}
          <motion.div
            key="settings-overlay"
            variants={overlayVariants}
            initial="hidden"
            animate="shown"
            exit="exit"
            className="fixed inset-0 z-40 bg-slate-900/40"
            onClick={onClose}
            aria-hidden
          />

          {/* Sheet */}
          <motion.aside
            key="settings-panel"
            variants={panelVariants}
            initial="hidden"
            animate="shown"
            exit="exit"
            role="dialog"
            aria-modal="true"
            aria-label="Settings"
            className={`fixed top-0 right-0 z-50 h-svh ${SheetGlass} flex flex-col`}
            style={{
              width: RIGHT_SETTINGS_SIDEBAR_WIDTH,
              paddingTop: "calc(env(safe-area-inset-top) + 6px)", // tight to top, keeps safe area
            }}
          >
            {/* Header */}
            <div className="px-5 pt-1 pb-2 sticky top-0 z-10 bg-gradient-to-b from-white/90 via-white/45 to-transparent dark:from-slate-900/85 dark:via-slate-900/45 shadow-[inset_0_-1px_0_rgba(2,6,23,0.08)]">
              <div className="flex items-center justify-between">
                <h2 className="text-[28px] leading-none font-extrabold tracking-tight text-slate-900 dark:text-white">
                  Settings
                </h2>
                <button
                  onClick={onClose}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/80 dark:bg-slate-800/70 border border-white/60 dark:border-white/10 shadow-md hover:shadow-lg transition"
                  aria-label="Close settings"
                >
                  <XMarkIcon className="h-6 w-6 text-slate-800 dark:text-slate-100" />
                </button>
              </div>
            </div>

            {/* Tiles (extra top padding so the first card’s top border is visible) */}
            <div className="flex-1 overflow-y-auto px-5 pt-3 pb-6">
              <div className="flex h-full flex-col gap-5">
                <Tile
                  active={activeSection === "MAIN_S"}
                  label="Main"
                  accent="sky"
                  Icon={SettingsHomeIcon}
                  onClick={() => handleTileClick("MAIN_S")}
                />
                <Tile
                  active={activeSection === "CONFIG_S"}
                  label="KFB Config"
                  accent="violet"
                  Icon={SettingsCogIcon}     // sliders icon
                  onClick={() => handleTileClick("CONFIG_S")}
                  spinOnHover
                />
                <Tile
                  active={activeSection === "BRANCHES_S"}
                  label="Program"
                  accent="emerald"
                  Icon={SettingsCubeIcon}
                  onClick={() => handleTileClick("BRANCHES_S")}
                />
              </div>
            </div>
          </motion.aside>

          {/* OTP modal */}
          <FlexibleOtpModal
            isOpen={showInternalPinModal && internalPinTarget !== null}
            onClose={() => {
              setShowInternalPinModal(false);
              setInternalPinTarget(null);
              setInternalPinErrorMessage("");
              setActiveSection("MAIN_S");
            }}
            onSubmit={handleInternalPinSubmit}
            attemptsLeft={internalPinAttempts}
            errorMessage={internalPinErrorMessage}
            otpLength={appConfig.otpLength}
            title={`Unlock “${
              internalPinTarget === "CONFIG_S"
                ? "KFB CONFIG"
                : internalPinTarget === "BRANCHES_S"
                ? "PROGRAM"
                : ""
            }”`}
            promptText={`Enter your PIN to access the ${
              internalPinTarget === "CONFIG_S"
                ? "KFB CONFIG"
                : internalPinTarget === "BRANCHES_S"
                ? "PROGRAM"
                : ""
            } section.`}
          />
        </>
      )}
    </AnimatePresence>
  );
};

/* ────────────────────────────────────────────────────────────────────────────
   Tile — iOS glass card with lively hover/active rings & subtle glow
   ──────────────────────────────────────────────────────────────────────────── */
type TileProps = {
  label: string;
  active?: boolean;
  onClick: () => void;
  Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  accent: "sky" | "violet" | "emerald";
  spinOnHover?: boolean;
};

const accentMap = {
  sky: {
    ringBase:  "ring-sky-300/70",
    ringHover: "group-hover:ring-sky-400/90",
    dot:       "bg-sky-50",
    icon:      "text-sky-600",
    badge:     "from-sky-50 to-white",
    borderGlow:"shadow-[0_0_0_3px_rgba(14,165,233,0.35),0_28px_58px_-18px_rgba(14,165,233,0.45)]",
  },
  violet: {
    ringBase:  "ring-violet-300/70",
    ringHover: "group-hover:ring-violet-400/90",
    dot:       "bg-violet-50",
    icon:      "text-violet-600",
    badge:     "from-violet-50 to-white",
    borderGlow:"shadow-[0_0_0_3px_rgba(139,92,246,0.35),0_28px_58px_-18px_rgba(139,92,246,0.45)]",
  },
  emerald: {
    ringBase:  "ring-emerald-300/70",
    ringHover: "group-hover:ring-emerald-400/90",
    dot:       "bg-emerald-50",
    icon:      "text-emerald-600",
    badge:     "from-emerald-50 to-white",
    borderGlow:"shadow-[0_0_0_3px_rgba(16,185,129,0.35),0_28px_58px_-18px_rgba(16,185,129,0.45)]",
  },
};

const Tile: React.FC<TileProps> = ({ label, active, onClick, Icon, accent, spinOnHover }) => {
  const acc = accentMap[accent];

  return (
    <motion.button
      onClick={onClick}
      whileHover={{ y: -3, scale: 1.005 }}
      whileTap={{ scale: 0.995 }}
      className={[
        "group relative flex-1 min-h-[28vh] w-full rounded-3xl p-6 text-left transition-all duration-200",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/80",
        TileGlass,
        active ? `ring-2 ${acc.ringBase}` : "ring-1 ring-white/55 dark:ring-white/10",
        "ring-offset-1 ring-offset-white/60 dark:ring-offset-slate-900/40",
      ].join(" ")}
      aria-pressed={active}
    >
      {/* Hover/active border glow overlay */}
      <span
        aria-hidden
        className={`pointer-events-none absolute inset-0 rounded-3xl opacity-0 ${acc.borderGlow} ${acc.ringHover} transition-opacity duration-200 group-hover:opacity-100`}
      />

      <div className="relative z-[1] flex h-full flex-col items-center justify-center gap-6">
        {/* Icon badge */}
        <div
          className={[
            "rounded-2xl border border-white/70 dark:border-white/10 h-24 w-24 grid place-items-center shadow-inner",
            "bg-gradient-to-b",
            acc.badge,
            acc.dot,
          ].join(" ")}
        >
          <motion.div
            animate={{ rotate: 0 }}
            whileHover={spinOnHover ? { rotate: 22 } : undefined}
            transition={{ type: "spring", stiffness: 250, damping: 18 }}
          >
            <Icon className={`h-12 w-12 ${acc.icon}`} />
          </motion.div>
        </div>

        {/* Label + selected pill */}
        <div className="text-center">
          <div className="text-4xl font-extrabold tracking-tight text-slate-900 dark:text-white">
            {label.toUpperCase()}
          </div>
          {active && (
            <div className="mt-2 inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold bg-black/5 dark:bg-white/10 text-slate-700 dark:text-slate-200">
              Selected
            </div>
          )}
        </div>
      </div>
    </motion.button>
  );
};

export default SettingsRightSidebar;
