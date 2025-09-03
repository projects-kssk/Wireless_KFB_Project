"use client"

import React, { useEffect, useMemo, useState } from "react"

type Pos = "tr" | "tl" | "br" | "bl"

export default function ZoomControls({
  initial = 1,
  min = 0.5,
  max = 2,
  step = 0.1,
  position = "tr",
  label,
  value,
  onChange,
  applyToBody = false,
}: {
  initial?: number
  min?: number
  max?: number
  step?: number
  position?: Pos
  label?: string
  value?: number
  onChange?: (z: number) => void
  applyToBody?: boolean
}) {
  const [internal, setInternal] = useState<number>(() => {
    const z = Number(initial)
    return Number.isFinite(z) && z > 0 ? z : 1
  })
  const zoom = typeof value === 'number' ? value : internal

  const pct = Math.round(zoom * 100)
  const canDec = zoom > min + 1e-6
  const canInc = zoom < max - 1e-6

  useEffect(() => {
    if (!applyToBody) return
    try { document.body.style.zoom = String(zoom) } catch {}
    return () => {}
  }, [zoom, applyToBody])

  const posClass = useMemo(() => {
    const base = "fixed z-[9999] m-3 select-none"
    switch (position) {
      case "tr":
        return `${base} right-0 top-0`
      case "tl":
        return `${base} left-0 top-0`
      case "br":
        return `${base} right-0 bottom-0`
      case "bl":
        return `${base} left-0 bottom-0`
      default:
        return `${base} right-0 top-0`
    }
  }, [position])

  const btn =
    "inline-flex items-center justify-center h-8 w-8 rounded-md border border-slate-300 bg-white text-slate-800 shadow-sm hover:bg-slate-50 active:scale-[.98] disabled:opacity-40 disabled:pointer-events-none"

  return (
    <div className={posClass} role="group" aria-label="Zoom controls">
      <div className="flex items-center gap-1 rounded-md bg-white/90 p-1 shadow-xl ring-1 ring-black/5 backdrop-blur">
        {label ? (
          <span className="px-2 text-[11px] font-semibold text-slate-600">
            {label}
          </span>
        ) : null}
        <button
          type="button"
          className={btn}
          onClick={() => {
            const next = Math.max(min, Math.round((zoom - step) * 100) / 100)
            if (onChange) onChange(next); else setInternal(next)
          }}
          disabled={!canDec}
          title="Zoom out"
        >
          −
        </button>
        <span className="mx-1 w-[58px] text-center text-xs font-bold tabular-nums text-slate-700">
          {pct}%
        </span>
        <button
          type="button"
          className={btn}
          onClick={() => {
            const next = Math.min(max, Math.round((zoom + step) * 100) / 100)
            if (onChange) onChange(next); else setInternal(next)
          }}
          disabled={!canInc}
          title="Zoom in"
        >
          +
        </button>
        <button
          type="button"
          className={`${btn} ml-1 w-auto px-2 text-[11px] font-semibold`}
          onClick={() => { if (onChange) onChange(1); else setInternal(1) }}
          title="Reset zoom"
        >
          Reset
        </button>
      </div>
    </div>
  )
}
