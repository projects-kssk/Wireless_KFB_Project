// src/components/Header/Header.tsx

import React, { useState, useEffect, useRef } from "react";
import {
  StatusIndicatorCard,
  SimpleStatus,
} from "@/components/Header/StatusIndicatorCard";
import { SupportContactCard } from "@/components/Header/SupportContactCard";
import { MenuIcon, XMarkIcon } from "@/components/Icons/Icons";
import { appConfig } from "@/components/config/appConfig";

const CUSTOM_HEADER_HEIGHT = "12rem";

interface HeaderProps {
  onSettingsClick: () => void;
  currentView: "main" | "settings";
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  onSettingsClick,
  currentView,
  isSidebarOpen,
  onToggleSidebar,
}) => {
  // Clamp any string to our three allowed statuses
  const clampStatus = (s: string): SimpleStatus => {
    if (s === "connected") return "connected";
    if (s === "error") return "error";
    // Everything else becomes "offline"
    return "offline";
  };

  // Initialize each indicator to a SimpleStatus
  const [scanner1Status, setScanner1Status] = useState<SimpleStatus>(
    clampStatus(appConfig.initialStatuses.scanner1)
  );
  const [scanner2Status, setScanner2Status] = useState<SimpleStatus>(
    clampStatus(appConfig.initialStatuses.scanner2)
  );
  const [serverStatus, setServerStatus] = useState<SimpleStatus>(
    clampStatus(appConfig.initialStatuses.server)
  );

  // Track window width (for responsive hiding)
  const [windowWidth, setWindowWidth] = useState<number>(0);
  const [isClient, setIsClient] = useState<boolean>(false);

  // State and ref for auto-hiding header on scroll
  const [isHeaderVisible, setIsHeaderVisible] = useState(true);
  const lastScrollY = useRef(0);


  // Demo mode: randomly flip between connected/error/offline
  useEffect(() => {
    if (!appConfig.demoMode.enabled) return;

    const statuses: SimpleStatus[] = ["connected", "error", "offline"];
    const getRandomStatus = (): SimpleStatus =>
      statuses[Math.floor(Math.random() * statuses.length)];

    const { initialDelay, statusChangeIntervals } = appConfig.demoMode;

    // Schedule initial updates
    const initialTimers = [
      setTimeout(() => setScanner1Status(getRandomStatus()), initialDelay.scanner1),
      setTimeout(() => setScanner2Status(getRandomStatus()), initialDelay.scanner2),
      setTimeout(() => setServerStatus(getRandomStatus()), initialDelay.server),
    ];

    // Schedule recurring updates
    const intervalTimers = [
      setInterval(() => setScanner1Status(getRandomStatus()), statusChangeIntervals.scanner1),
      setInterval(() => setScanner2Status(getRandomStatus()), statusChangeIntervals.scanner2),
      setInterval(() => setServerStatus(getRandomStatus()), statusChangeIntervals.server),
    ];

    return () => {
      initialTimers.forEach(clearTimeout);
      intervalTimers.forEach(clearInterval);
    };
  }, []);

  // Effect for client-side logic: window listeners (resize and scroll)
  useEffect(() => {
    setIsClient(true);

    // --- Window Resize Logic ---
    const handleResize = () => {
      setWindowWidth(window.innerWidth);
    };
    handleResize();
    window.addEventListener("resize", handleResize);

    // --- Scroll Logic for Auto-Hiding Header ---
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      // Show header if scrolling up or at the very top of the page
      if (currentScrollY < lastScrollY.current || currentScrollY <= 10) {
        setIsHeaderVisible(true);
      } else {
      // Hide header if scrolling down
        setIsHeaderVisible(false);
      }
      // Update the last scroll position
      lastScrollY.current = currentScrollY;
    };
    // Use passive listener for better scroll performance
    window.addEventListener("scroll", handleScroll, { passive: true });


    // --- Cleanup ---
    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("scroll", handleScroll);
    };
  }, []); // Empty dependency array ensures this runs only once on mount

  // If header is hidden by config, return null
  if (appConfig.hideHeader) return null;

  // Hide status cards on smaller screens when sidebar is open
  const widgetsDynamicClass =
    isClient &&
    currentView === "main" &&
    isSidebarOpen &&
    windowWidth < 1280 &&
    windowWidth > 0
      ? "hidden xl:flex"
      : "flex";

  const mainButtonText = currentView === "settings" ? "Dashboard" : "Settings";

  return (
    <header
      className={`w-full bg-slate-100 dark:bg-slate-900 shadow-lg sticky top-0 z-30 transition-transform duration-300 ease-in-out ${isHeaderVisible ? "translate-y-0" : "-translate-y-full"}`}
      style={{ height: CUSTOM_HEADER_HEIGHT }}
    >
      <div className="flex items-stretch justify-between w-full h-full px-6 sm:px-8 md:px-10 ">
        <div className="flex items-center flex-shrink-0">
          {/* Only show “hamburger / close” on dashboard */}
          {currentView === "main" && (
            <button
              onClick={onToggleSidebar}
              className="p-3 sm:p-4 mr-3 md:mr-5 text-slate-700 dark:text-slate-200 hover:text-sky-600 dark:hover:text-sky-400 focus:outline-none rounded-full hover:bg-slate-200 dark:hover:bg-slate-700"
              aria-label={isSidebarOpen ? "Close Sidebar" : "Open Sidebar"}
            >
              {isSidebarOpen ? (
                <XMarkIcon className="w-9 h-9 sm:w-10 sm:h-10" />
              ) : (
                <MenuIcon className="w-9 h-9 sm:w-10 sm:h-10" />
              )}
            </button>
          )}

          {/* Three status cards + support (visible/hide logic via widgetsDynamicClass) */}
          <div className={`items-stretch space-x-6 py-3 ${widgetsDynamicClass}`}>
            <StatusIndicatorCard
              label={appConfig.indicatorLabels.scanner1}
              status={scanner1Status}
            />
            <StatusIndicatorCard
              label={appConfig.indicatorLabels.scanner2}
              status={scanner2Status}
            />
            <StatusIndicatorCard
              label={appConfig.indicatorLabels.server}
              status={serverStatus}
            />
            <SupportContactCard supportInfo={appConfig.callSupportInfo} />
          </div>
        </div>

        <div className="flex items-center ml-auto flex-shrink-0 px-6 sm:px-6 md:px-8 mt-5 mb-5 pt-2">
          <button
            type="button"
            aria-label={mainButtonText}
            className="h-full flex items-center px-8 sm:px-10 md:px-12 py-4 sm:py-5 text-lg sm:text-xl lg:text-2xl font-bold uppercase tracking-wider text-sky-100 dark:text-sky-100 bg-sky-600 hover:bg-sky-700 dark:bg-sky-700 dark:hover:bg-sky-600 rounded-xl shadow-xl hover:shadow-2xl focus:outline-none focus:ring-4 focus:ring-sky-400 dark:focus:ring-sky-500 transition-all duration-200 ease-in-out transform hover:scale-105 active:scale-95"
            onClick={onSettingsClick}
          >
            {mainButtonText}
          </button>
        </div>
      </div>

      {/* (Optional) Keyframes for pulsating animations */}
      <style>
        {`
          @keyframes pulse-red {
            0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7); }
            70% { box-shadow: 0 0 0 10px rgba(239, 68, 68, 0); }
          }
          .animate-pulse-red {
            animation: pulse-red 2s infinite cubic-bezier(0.66, 0, 0, 1);
          }
        `}
      </style>
    </header>
  );
};

export default Header;
