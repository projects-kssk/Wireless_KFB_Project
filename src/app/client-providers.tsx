// app/client-providers.tsx
'use client'

import { LazyMotion, AnimatePresence } from 'framer-motion'
import { ThemeProvider } from './theme-provider'
import { ReactNode } from 'react'

type ClientProvidersProps = {
  children: ReactNode
  initialTheme?: 'light' | 'dark'
}

// Lazy-load only the minimal features bundle
const loadFeatures = () => import('./framer-features').then(m => m.default)

export default function ClientProviders({ children, initialTheme = 'light' }: ClientProvidersProps) {
  return (
    <LazyMotion features={loadFeatures} strict>
      <ThemeProvider defaultTheme={initialTheme} initialTheme={initialTheme}>
        {/* Scope route transitions here only if you actually need exit animations */}
        <AnimatePresence mode="wait" initial={false}>
          {children}
        </AnimatePresence>
      </ThemeProvider>
    </LazyMotion>
  )
}
