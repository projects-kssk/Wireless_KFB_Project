// src/components/Settings/SettingsRightSidebar.tsx

import React, { useState, useEffect } from "react";
import { XMarkIcon } from "@/components/Icons/Icons";
import {
  SettingsHomeIcon,
  SettingsCogIcon,
  SettingsCubeIcon,
} from "@/components/Icons/Icons";
import { FlexibleOtpModal } from "@/components/Modals/FlexibleOtpModal";
import { appConfig } from "@/components/config/appConfig";
import { RIGHT_SETTINGS_SIDEBAR_WIDTH } from "@/components/config/appConfig";

type SettingsSectionId = "MAIN_S" | "CONFIG_S" | "BRANCHES_S";

interface SettingsRightSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  appHeaderHeight: string;
  onShowConfigurationInMain: () => void;
  onShowBranchesSettingsInMain: () => void;
}

export const SettingsRightSidebar: React.FC<SettingsRightSidebarProps> = ({
  isOpen,
  onClose,
  appHeaderHeight,
  onShowConfigurationInMain,
  onShowBranchesSettingsInMain,
}) => {
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("MAIN_S");
  const [showInternalPinModal, setShowInternalPinModal] = useState(false);
  const [internalPinTarget, setInternalPinTarget] = useState<SettingsSectionId | null>(null);
  const [internalPinAttempts, setInternalPinAttempts] = useState(3);
  const [internalPinErrorMessage, setInternalPinErrorMessage] = useState("");

  useEffect(() => {
    if (isOpen && !showInternalPinModal) {
      if (!internalPinTarget) {
        setActiveSection("MAIN_S");
      }
    }
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
      if (showInternalPinModal) setShowInternalPinModal(false);
      return;
    }

    if (
      activeSection === sectionId &&
      showInternalPinModal &&
      internalPinTarget === sectionId
    ) {
      return;
    }

    setInternalPinTarget(sectionId);
    setInternalPinAttempts(3);
    setInternalPinErrorMessage("");
    setShowInternalPinModal(true);
  };

  const handleInternalPinSubmit = (enteredOtp: string) => {
    if (enteredOtp === appConfig.correctOtp) {
      if (internalPinTarget) {
        setActiveSection(internalPinTarget);

        if (internalPinTarget === "CONFIG_S") {
          onShowConfigurationInMain();
          onClose();
        } else if (internalPinTarget === "BRANCHES_S") {
          onShowBranchesSettingsInMain();
          onClose();
        }
      }
      setShowInternalPinModal(false);
      setInternalPinTarget(null);
      setInternalPinErrorMessage("");
    } else {
      const newAttempts = internalPinAttempts - 1;
      setInternalPinAttempts(newAttempts);
      if (newAttempts > 0) {
        setInternalPinErrorMessage(`Incorrect PIN. ${newAttempts} attempts left.`);
      } else {
        setInternalPinErrorMessage("Too many incorrect attempts. Access denied.");
        setTimeout(() => {
          setShowInternalPinModal(false);
          setInternalPinTarget(null);
        }, 2000);
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="
        fixed top-0 right-0 h-full
        bg-white dark:bg-slate-900/95
        border-slate-300 dark:border-slate-700
        shadow-2xl
        flex flex-col
        transition-transform duration-300 ease-in-out
        z-40
      "
      style={{
        width: RIGHT_SETTINGS_SIDEBAR_WIDTH,
        transform: isOpen
          ? "translateX(0)"
          : `translateX(${RIGHT_SETTINGS_SIDEBAR_WIDTH})`,
        paddingTop: appHeaderHeight,
      }}
    >
      {/* ─────────── HEADER ─────────── */}
      <div className="flex justify-between items-center px-6 py-4 border-b border-slate-300 dark:border-slate-700 flex-shrink-0">
        <h2 className="text-6xl font-semibold text-slate-800 dark:text-slate-100">
          Settings
        </h2>
        <button
          onClick={onClose}
          className="p-2 rounded-md hover:bg-slate-200 dark:hover:bg-slate-600"
          aria-label="Close settings"
        >
          <XMarkIcon className="w-16 h-16 text-slate-700 dark:text-slate-200" />
        </button>
      </div>

      {/* ─────────── THREE VERTICAL TILES ─────────── */}
      <main className="flex flex-col flex-grow h-full">
        {/* Tile: MAIN */}
        <button
          onClick={() => handleTileClick("MAIN_S")}
          className={`
            flex-1 flex flex-col items-center justify-center
            bg-white dark:bg-slate-700 rounded-2xl border border-slate-300 dark:border-slate-600 m-4 shadow-2xl
            transition-transform transform hover:scale-105
            ${activeSection === "MAIN_S" ? "ring-4 ring-sky-500" : ""}
          `}
        >
          <SettingsHomeIcon className="w-20 h-20 text-sky-600 dark:text-sky-400 mb-4" />
          <span className="text-6xl font-semibold text-slate-800 dark:text-slate-100">
            MAIN
          </span>
        </button>

        {/* Tile: KFB CONFIG */}
        <button
          onClick={() => handleTileClick("CONFIG_S")}
          className={`
            flex-1 flex flex-col items-center justify-center
            bg-white dark:bg-slate-700 rounded-2xl border border-slate-300 dark:border-slate-600 m-4 shadow-2xl
            transition-transform transform hover:scale-105
            ${activeSection === "CONFIG_S" ? "ring-4 ring-sky-500" : ""}
          `}
        >
          <SettingsCogIcon className="w-20 h-20 text-sky-600 dark:text-sky-400 mb-4" />
          <span className="text-6xl font-semibold text-slate-800 dark:text-slate-100">
            KFB CONFIG
          </span>
        </button>

        {/* Tile: PROGRAM */}
        <button
          onClick={() => handleTileClick("BRANCHES_S")}
          className={`
            flex-1 flex flex-col items-center justify-center
            bg-white dark:bg-slate-700 rounded-2xl border border-slate-300 dark:border-slate-600 m-4 shadow-2xl
            transition-transform transform hover:scale-105
            ${activeSection === "BRANCHES_S" ? "ring-4 ring-sky-500" : ""}
          `}
        >
          <SettingsCubeIcon className="w-20 h-20 text-sky-600 dark:text-sky-400 mb-4" />
          <span className="text-6xl font-semibold text-slate-800 dark:text-slate-100">
            PROGRAM
          </span>
        </button>
      </main>

      {/* ─────────── OTP PIN MODAL ─────────── */}
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
    </div>
  );
};

export default SettingsRightSidebar;
