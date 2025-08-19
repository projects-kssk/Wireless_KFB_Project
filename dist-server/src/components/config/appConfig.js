// appConfig.ts
// If OTP_FROM_ENV is imported from env, do that here, e.g.:
export const OTP_FROM_ENV = process.env.OTP_FROM_ENV || '1234';
export const RIGHT_SETTINGS_SIDEBAR_WIDTH = "28rem";
export const SIDEBAR_WIDTH = "24rem";
export const appConfig = {
    correctOtp: OTP_FROM_ENV,
    otpLength: OTP_FROM_ENV.length,
    hideHeader: false,
    initialStatuses: {
        scanner1: 'default',
        scanner2: 'default',
        server: 'default',
    },
    demoMode: {
        enabled: true,
        initialDelay: { scanner1: 1000, scanner2: 1500, server: 2000 },
        statusChangeIntervals: { scanner1: 5000, scanner2: 6000, server: 7000 },
    },
    indicatorLabels: {
        scanner1: "Scanner CHECK",
        scanner2: "Scanner SETUP",
        server: "Server Status",
    },
    callSupportInfo: {
        title: "SUPPORT:",
        phone: "453",
    },
};
export default appConfig;
//# sourceMappingURL=appConfig.js.map