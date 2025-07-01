// next.config.ts
import { NextConfig } from 'next'

const nextConfig: NextConfig = {
  images: {
    unoptimized: true,
  },
  // no `output: 'export'` here
}

export default nextConfig
