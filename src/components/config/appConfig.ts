// appConfig.ts

import type { StatusType } from '@/types/types'; // Adjust the path as needed

// If OTP_FROM_ENV is imported from env, do that here, e.g.:
export const OTP_FROM_ENV = process.env.OTP_FROM_ENV || '1234';
export const RIGHT_SETTINGS_SIDEBAR_WIDTH = "28rem";
export const SIDEBAR_WIDTH = "24rem";

export const appConfig = {
  correctOtp: OTP_FROM_ENV,
  otpLength: OTP_FROM_ENV.length,
  hideHeader: false,
  initialStatuses: {
    scanner1: 'default' as StatusType,
    scanner2: 'default' as StatusType,
    server: 'default' as StatusType,
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
  callSupportInfo: {
    phone: "453",
  },
};




export default appConfig;
