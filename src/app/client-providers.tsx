// app/client-providers.tsx
'use client'

import { LazyMotion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { ThemeProvider } from './theme-provider'
import { ReactNode } from 'react'

// Lazy-load only the minimal features bundle
const loadFeatures = () => import('./framer-features').then(m => m.default)

export default function ClientProviders({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={loadFeatures} strict>
      <ThemeProvider>
        {/* Scope route transitions here only if you actually need exit animations */}
        <AnimatePresence mode="wait" initial={false}>
          {children}
        </AnimatePresence>
      </ThemeProvider>
    </LazyMotion>
  )
}
