const nextConfig = {
    // 1) Required for Electron packaging + custom server:
    //    produces .next/standalone with its own node_modules/next runtime
    output: 'standalone',
    images: {
        unoptimized: true,
    },
    // Optional: if ESLint blocks your CI builds
    // eslint: { ignoreDuringBuilds: true },
    // 3) Precise control via webpack hook
    webpack(config, { isServer }) {
        // --- Server (Node) build ---
        if (isServer) {
            // Ensure serialport is loaded at runtime, not bundled
            const existing = Array.isArray(config.externals)
                ? config.externals
                : [config.externals].filter(Boolean);
            config.externals = [
                ...existing,
                'serialport',
                '@serialport/parser-readline',
            ];
        }
        else {
            // --- Client (browser) build ---
            // If any shared file accidentally imports serialport, hard-disable it for the browser
            config.resolve = config.resolve || {};
            config.resolve.fallback = {
                ...(config.resolve.fallback || {}),
                serialport: false,
                '@serialport/parser-readline': false,
                // (Node core modules are already false in Next 15, but you can be explicit)
                fs: false,
                net: false,
                tls: false,
            };
        }
        return config;
    },
};
export default nextConfig;
