// src/components/config/appConfig.ts
import type { StatusType } from "@/types/types"; // 'connected' | 'error' | 'offline' | 'default'

// OTP / layout constants
export const OTP_FROM_ENV = process.env.OTP_FROM_ENV ?? "1234";
export const RIGHT_SETTINGS_SIDEBAR_WIDTH = "28rem";
export const SIDEBAR_WIDTH = "24rem";

// Optional helper types
export type ScannerConfig = {
  name: string;
  endpoint: string;
};

export interface AppConfig {
  correctOtp: string;
  otpLength: number;
  hideHeader: boolean;

  // initial statuses (your UI clamps 'default' -> 'offline')
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

  // endpoints for each physical scanner; adjust as needed
  scanners: ScannerConfig[];

  // support pill content
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

  initialStatuses: {
    scanner1: "default" as StatusType,
    scanner2: "default" as StatusType,
    server: "default" as StatusType,
  },

  demoMode: {
    enabled: true,
    initialDelay: { scanner1: 1000, scanner2: 1500, server: 2000 },
    statusChangeIntervals: { scanner1: 5000, scanner2: 6000, server: 7000 },
  },

  indicatorLabels: {
    scanner1: "Scanner 1",
    scanner2: "Scanner 2",
    server: "Server Status",
  },

  // If you only have one API route right now, point both to "/api/serial/scanner".
  scanners: [
    { name: "Scanner 1", endpoint: "/api/serial/scanner?device=1" },
    { name: "Scanner 2", endpoint: "/api/serial/scanner?device=2" },
  ],

  callSupportInfo: {
    count: 621,
    subtitle: "24/7 Hotline",
    ctaText: "Call",
    onCta: () => {
      if (typeof window !== "undefined") {
        // Replace with your support number
        window.location.href = "tel:+18001234567";
      }
    },
  },
};

export default appConfig;
