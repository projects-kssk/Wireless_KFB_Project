// next.config.ts
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  images: {
    unoptimized: true,
  },

  // Prevent Webpack from bundling the native serialport addon:
  webpack(config, { isServer }) {
    if (isServer) {
      // `config.externals` can be an array or a function; we cast to `any[]` for simplicity
      const existing = Array.isArray(config.externals)
        ? config.externals
        : [config.externals as any]

      config.externals = [
        ...existing,
        // these two modules will now be loaded via `require(...)` at runtime
        'serialport',
        '@serialport/parser-readline',
      ]
    }
    return config
  },
}

export default nextConfig
