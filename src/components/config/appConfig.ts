// src/components/config/appConfig.ts
import type { StatusType } from "@/types/types"; // 'connected' | 'error' | 'offline' | 'default'

// OTP / layout constants
export const OTP_FROM_ENV = process.env.OTP_FROM_ENV ?? "1234";
export const RIGHT_SETTINGS_SIDEBAR_WIDTH = "28rem";
export const SIDEBAR_WIDTH = "24rem";

/** A scanner may be addressed via API endpoint and/or identified by USB path/VID:PID. */
export type ScannerConfig = {
  name: string;
  endpoint?: string;     // e.g. "/api/serial/scanner?device=1"
  path?: string;         // e.g. "ttyACM0" (substring match)
  usb?: string[];        // e.g. ["1a86:7523"] VID:PID allowlist (lowercase)
};

export interface AppConfig {
  correctOtp: string;
  otpLength: number;
  hideHeader: boolean;

  /** Show hamburger toggle (the header also checks ui?.showSidebarToggle). */
  showSidebarToggle?: boolean;
  ui?: {
    showSidebarToggle?: boolean;
  };

  initialStatuses: {
    scanner1: StatusType;
    scanner2: StatusType;
    server: StatusType;
  };

  demoMode: {
    enabled: boolean;
    initialDelay: { scanner1: number; scanner2: number; server: number };
    statusChangeIntervals: { scanner1: number; scanner2: number; server: number };
  };

  indicatorLabels: {
    scanner1: string;
    scanner2: string;
    server: string;
  };

  /** Config entries for each physical scanner. */
  scanners: ScannerConfig[];

  /** Support pill content */
  callSupportInfo: {
    count?: number;
    subtitle?: string;
    ctaText?: string;
    onCta?: () => void;
  };
}

export const appConfig: AppConfig = {
  correctOtp: OTP_FROM_ENV,
  otpLength: OTP_FROM_ENV.length,

  hideHeader: false,

  // Hidden by default; set true to show the hamburger.
  showSidebarToggle: false,

  initialStatuses: {
    scanner1: "default",
    scanner2: "default",
    server: "default",
  },

  demoMode: {
    enabled: true,
    initialDelay: { scanner1: 1000, scanner2: 1500, server: 2000 },
    statusChangeIntervals: { scanner1: 5000, scanner2: 6000, server: 7000 },
  },

  indicatorLabels: {
    scanner1: "SCANNER 1",
    scanner2: "Scanner 2",
    server: "Server Status",
  },

  // If you only have one API route now, keep endpoints;
  // add 'path' later if you want precise USB presence mapping.
  scanners: [
    { name: "Scanner 1", endpoint: "/api/serial/scanner?device=1", path: "ttyACM0" },
    { name: "Scanner 2", endpoint: "/api/serial/scanner?device=2", path: "ttyACM1" },
  ],

  callSupportInfo: {
    count: 621,

    onCta: () => {
      if (typeof window !== "undefined") {
        window.location.href = "tel:+18001234567";
      }
    },
  },
};

export default appConfig;
