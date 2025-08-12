'use client'

import React, { useEffect, useMemo, useState } from 'react'

type Props = { children: React.ReactNode }
type DisplayMode = 'auto' | 'pc' | 'tv'

const canUseDOM = typeof window !== 'undefined' && typeof document !== 'undefined'

export default function ViewportScaler({ children }: Props) {
  const [mode, setMode] = useState<DisplayMode>('auto')
  const [scale, setScale] = useState(1)
  const [vvw, setVVW] = useState<number | null>(null)
  const [vvh, setVVH] = useState<number | null>(null)

  const baseW = 1440
  const baseH = 900

  const getQueryMode = (): DisplayMode | null => {
    if (!canUseDOM) return null
    const q = new URLSearchParams(window.location.search)
    const m = (q.get('mode') || '').toLowerCase()
    if (m === 'tv' || m === 'pc' || m === 'auto') return m as DisplayMode
    if (q.get('tv') === '1') return 'tv'
    if (q.get('tv') === '0') return 'auto'
    if (q.get('pc') === '1') return 'pc'
    return null
  }

  const getStoredMode = (): DisplayMode | null => {
    if (!canUseDOM) return null
    const stored = (localStorage.getItem('displayMode') || '').toLowerCase()
    if (stored === 'tv' || stored === 'pc' || stored === 'auto') return stored as DisplayMode
    const legacy = localStorage.getItem('tvMode')
    if (legacy === 'true') return 'tv'
    if (legacy === 'false') return 'auto'
    return null
  }

  const isTVLike = (): boolean => {
    if (!canUseDOM) return false
    const vw = window.visualViewport?.width ?? window.innerWidth
    const vh = window.visualViewport?.height ?? window.innerHeight
    const big = vw >= 1920 && vh >= 900
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : ''
    const tvUA = /(smarttv|tizen|netcast|appletv|googletv|hbbtv|viera|bravia|firetv|android\s*tv)/i.test(ua)
    return big || tvUA
  }

  const resolveActiveMode = (m: DisplayMode): DisplayMode => {
    if (!canUseDOM) return m === 'tv' ? 'pc' : (m === 'auto' ? 'pc' : m)
    return m === 'auto' ? (isTVLike() ? 'tv' : 'pc') : m
  }

  // initial mode (client)
  useEffect(() => {
    const initial = getQueryMode() ?? getStoredMode() ?? (isTVLike() ? 'tv' : 'pc')
    setMode(initial)
  }, [])

  // listen to external changes
  useEffect(() => {
    if (!canUseDOM) return
    const onDisplayMode = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail === 'tv' || detail === 'pc' || detail === 'auto') setMode(detail)
      else if (detail && typeof detail === 'object') {
        const m = (detail as any).mode
        if (m === 'tv' || m === 'pc' || m === 'auto') setMode(m)
      }
    }
    window.addEventListener('display-mode-change', onDisplayMode as EventListener)
    return () => window.removeEventListener('display-mode-change', onDisplayMode as EventListener)
  }, [])

  // apply attrs + persist + compute scale on any viewport change
  useEffect(() => {
    if (!canUseDOM) return

    const applyAttrs = (m: DisplayMode) => {
      const el = document.documentElement
      el.setAttribute('data-display', m)
      el.setAttribute('data-tv', m === 'tv' ? '1' : '0') // legacy
      localStorage.setItem('displayMode', m)
      localStorage.setItem('tvMode', String(m === 'tv'))
    }

    let raf = 0
    const calc = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const vw = window.visualViewport?.width ?? window.innerWidth
        const vh = window.visualViewport?.height ?? window.innerHeight
        setVVW(vw); setVVH(vh)

        const active = resolveActiveMode(mode)
        if (active !== 'tv') { setScale(1); return }
        setScale(Math.min(vw / baseW, vh / baseH))
      })
    }

    applyAttrs(mode)
    calc()

    const vv = window.visualViewport
    window.addEventListener('resize', calc, { passive: true })
    window.addEventListener('orientationchange', calc, { passive: true })
    vv?.addEventListener('resize', calc, { passive: true })
    vv?.addEventListener('scroll', calc, { passive: true })
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', calc as EventListener)
      window.removeEventListener('orientationchange', calc as EventListener)
      vv?.removeEventListener('resize', calc as EventListener)
      vv?.removeEventListener('scroll', calc as EventListener)
    }
  }, [mode])

  const style = useMemo<React.CSSProperties>(() => {
    const active = resolveActiveMode(mode)
    if (active !== 'tv') return {}
    if (!canUseDOM || vvw == null || vvh == null) return {}
    return {
      transform: `scale(${scale})`,
      transformOrigin: 'top left',
      width: `${vvw / scale}px`,
      height: `${vvh / scale}px`,
      overflow: 'hidden',
    }
  }, [mode, scale, vvw, vvh])

  return <div style={style}>{children}</div>
}
