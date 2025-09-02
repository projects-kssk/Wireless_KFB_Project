'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'

type Props = { children: React.ReactNode }
type DisplayMode = 'auto' | 'pc' | 'tv'

const canUseDOM = typeof window !== 'undefined'
const BASE_W = 1440
const BASE_H = 900

export default function ViewportScaler({ children }: Props) {
  const [mode, setMode] = useState<DisplayMode>('auto')
  const [scale, setScale] = useState(1)
  const [activeTV, setActiveTV] = useState(false)       // true = we are scaling now
  const lastZoomScale = useRef(1)
  const resizeRAF = useRef(0 as number | 0)
  const debTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const getQueryMode = (): DisplayMode | null => {
    if (!canUseDOM) return null
    const q = new URLSearchParams(window.location.search)
    const m = (q.get('mode') || '').toLowerCase()
    return m === 'tv' || m === 'pc' || m === 'auto' ? (m as DisplayMode) : null
  }
  const getStoredMode = (): DisplayMode | null => null
  const isTVLike = () => {
    if (!canUseDOM) return false
    const vw = window.innerWidth
    const vh = window.innerHeight
    const big = vw >= 1920 && vh >= 1080
    const ua = navigator.userAgent || ''
    const tvUA = /(smarttv|tizen|netcast|appletv|googletv|hbbtv|viera|bravia|firetv|android\s*tv)/i.test(ua)
    return big || tvUA
  }
  const resolveMode = (m: DisplayMode): DisplayMode => (m === 'auto' ? (isTVLike() ? 'tv' : 'pc') : m)

  // initial mode
  useEffect(() => {
    const initial = getQueryMode() ?? getStoredMode() ?? 'pc'
    setMode(initial)
  }, [])

  // attributes + scaling logic
  useEffect(() => {
    if (!canUseDOM) return
    const html = document.documentElement
    html.setAttribute('data-display', mode)
    html.setAttribute('data-tv', resolveMode(mode) === 'tv' ? '1' : '0')
    // no localStorage: rely on query param or in-memory state only

    const calc = () => {
      if (resizeRAF.current) return
      resizeRAF.current = requestAnimationFrame(() => {
        resizeRAF.current = 0

        const target = resolveMode(mode)
        // Page zoom/pinch state (1 == not zoomed)
        const pageScale = window.visualViewport?.scale ?? 1
        lastZoomScale.current = pageScale

        // If the user has zoomed the page (pinch or browser zoom), we STOP scaling.
        if (target !== 'tv' || Math.abs(pageScale - 1) > 0.01) {
          setActiveTV(false)
          setScale(1)
          return
        }

        const vw = window.innerWidth
        const vh = window.innerHeight
        const next = Math.min(vw / BASE_W, vh / BASE_H)
        setScale(next)
        setActiveTV(true)
      })
    }

    const debouncedCalc = () => {
      // Burst events (iOS pinch throws many); settle for 80ms
      if (debTimer.current) clearTimeout(debTimer.current)
      debTimer.current = setTimeout(calc, 80)
    }

    // first run
    calc()

    window.addEventListener('resize', debouncedCalc, { passive: true })
    window.addEventListener('orientationchange', debouncedCalc, { passive: true })
    // visualViewport: no 'scroll' listener → it janks during pinch-zoom
    window.visualViewport?.addEventListener('resize', debouncedCalc, { passive: true })

    return () => {
      if (resizeRAF.current) cancelAnimationFrame(resizeRAF.current)
      if (debTimer.current) clearTimeout(debTimer.current)
      window.removeEventListener('resize', debouncedCalc as EventListener)
      window.removeEventListener('orientationchange', debouncedCalc as EventListener)
      window.visualViewport?.removeEventListener('resize', debouncedCalc as EventListener)
    }
  }, [mode])

  // Outer wrapper letterboxes & centers when TV scaling is active.
  const wrapperStyle = useMemo<React.CSSProperties>(() => {
    if (!activeTV) return {}
    return {
      position: 'fixed',
      inset: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    }
  }, [activeTV])

  // Inner "canvas" is a fixed base size scaled to fit.
  const canvasStyle = useMemo<React.CSSProperties>(() => {
    if (!activeTV) return {}
    return {
      width: BASE_W,
      height: BASE_H,
      transform: `scale(${scale})`,
      transformOrigin: 'center center',
      willChange: 'transform',
      contain: 'layout paint size style',
    }
  }, [activeTV, scale])

  return activeTV ? (
    <div style={wrapperStyle}>
      <div style={canvasStyle}>{children}</div>
    </div>
  ) : (
    <>{children}</>
  )
}
