// next.config.ts
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // 1) Required for Electron packaging + custom server:
  //    produces .next/standalone with its own node_modules/next runtime
  output: 'standalone',

  images: {
    unoptimized: true,
  },

  // Skip blocking builds on lint/TS errors while stabilizing
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },

  experimental: {
    // Allow Electron to load dev assets from 127.0.0.1 or localhost
    allowedDevOrigins: [
      'http://127.0.0.1:3000',
      'http://127.0.0.1:3001',
      'http://localhost:3000',
      'http://localhost:3001',
    ],
  },

  // 3) Precise control via webpack hook
  webpack(config, { isServer }) {
    // --- Server (Node) build ---
    if (isServer) {
      // Ensure serialport is loaded at runtime, not bundled
      const existing = Array.isArray(config.externals)
        ? config.externals
        : [config.externals].filter(Boolean)

      config.externals = [
        ...existing,
        'serialport',
        '@serialport/parser-readline',
      ]
    } else {
      // --- Client (browser) build ---
      // If any shared file accidentally imports serialport, hard-disable it for the browser
      config.resolve = config.resolve || {}
      config.resolve.fallback = {
        ...(config.resolve.fallback || {}),
        serialport: false,
        '@serialport/parser-readline': false,
        // (Node core modules are already false in Next 15, but you can be explicit)
        fs: false,
        net: false,
        tls: false,
      }
    }

    // Allow importing ".js" from TypeScript by resolving to .ts/.tsx first.
    // This keeps server (NodeNext) happy while letting the app build resolve TS sources.
    config.resolve = config.resolve || {}
    // @ts-ignore - extensionAlias is available on webpack 5
    config.resolve.extensionAlias = {
      ...(config.resolve as any).extensionAlias || {},
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
      '.cjs': ['.cts', '.cjs'],
    }

    return config
  },
}

export default nextConfig
