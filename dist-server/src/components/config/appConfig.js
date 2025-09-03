// OTP / layout constants
export const OTP_FROM_ENV = process.env.OTP_FROM_ENV ?? "1234";
export const RIGHT_SETTINGS_SIDEBAR_WIDTH = "28rem";
export const SIDEBAR_WIDTH = "24rem";
export const appConfig = {
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
    scanners: [{ name: 'Scanner', path: '/dev/ttyACM0' },
        { name: 'Scanner', path: '/dev/ttyACM1' }],
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
