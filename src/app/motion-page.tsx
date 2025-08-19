// app/motion-page.tsx
'use client'

import { m, useReducedMotion } from 'framer-motion'
import { usePathname } from 'next/navigation'
import { ReactNode } from 'react'

export default function MotionPage({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const reduce = useReducedMotion()

  const variants = {
    initial: { opacity: 0, y: reduce ? 0 : 8 },
    enter:   { opacity: 1, y: 0 },
    exit:    { opacity: 0, y: reduce ? 0 : -4 },
  }

  return (
    <m.div
      key={pathname}
      initial="initial"
      animate="enter"
      exit="exit"
      variants={variants}
      transition={{ type: 'tween', duration: 0.18 }}
    >
      {children}
    </m.div>
  )
}
