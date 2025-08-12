'use client'

import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  FormEvent,
} from 'react'
import {
  XMarkIcon,
  CheckCircleIcon,
  PencilSquareIcon,
  PlusIcon,
  ArrowPathIcon,
  ExclamationTriangleIcon,
  TrashIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  MagnifyingGlassIcon,
  CheckIcon,
  ChevronDownIcon,
  ArrowLeftIcon,
} from '@heroicons/react/24/solid'
import { motion, AnimatePresence, PanInfo } from 'framer-motion'
import type { Transition } from 'framer-motion'

/* ─────────────────────────────────────────────────────────────────────────────
 * Types
 * ──────────────────────────────────────────────────────────────────────────── */
interface Configuration {
  id: number
  kfb: string
  mac_address: string
  kfbInfo: string[]
}
interface Branch { id: number; name: string }
interface BranchApiResponse { id: string; branchName: string; [key: string]: any }
interface EspPinMappingRow { branch_id: number; pin_number: number }
interface ConfigBranchRow { branch_id: number; not_tested?: boolean }

/* ─────────────────────────────────────────────────────────────────────────────
 * Helpers
 * ──────────────────────────────────────────────────────────────────────────── */
async function fetchJSON<T>(url: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(url, { cache: 'no-store', ...opts })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as any).error || res.statusText || `Request failed with status ${res.status}`)
  }
  return res.json()
}
function clsx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}
type SortKey = 'index' | 'name' | 'pin' | 'not' | 'loose'
type SortDir = 'asc' | 'desc'

/* ─────────────────────────────────────────────────────────────────────────────
 * UI Bits: Switch
 * ──────────────────────────────────────────────────────────────────────────── */
const IOSwitch: React.FC<{ checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }> = ({
  checked,
  onChange,
  disabled,
}) => (
  <button
    type="button"
    aria-pressed={checked}
    disabled={disabled}
    onClick={() => !disabled && onChange(!checked)}
    className={clsx(
      'relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200',
      checked ? 'bg-emerald-500' : 'bg-slate-300',
      disabled && 'opacity-50 cursor-not-allowed'
    )}
  >
    <span
      className={clsx(
        'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform duration-200',
        checked ? 'translate-x-5' : 'translate-x-1'
      )}
    />
  </button>
)

// Option A: explicit annotation
const SHEET_SPRING: Transition = { type: 'spring', stiffness: 520, damping: 42, mass: 0.9 }
const BACKDROP_SPRING: Transition = { type: 'spring', stiffness: 280, damping: 28 }

/* ─────────────────────────────────────────────────────────────────────────────
 * BottomSheet (mobile fallback)
 * ──────────────────────────────────────────────────────────────────────────── */
const BottomSheet: React.FC<{
  isOpen: boolean
  onClose: () => void
  title?: string
  size?: 'md' | 'lg' | 'xl'
  fullscreen?: boolean
  children: React.ReactNode
}> = ({ isOpen, onClose, title, size = 'lg', fullscreen = false, children }) => {
  // Close on ESC
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  // Lock body scroll when open
  useEffect(() => {
    if (!isOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [isOpen])

  const heightClass = fullscreen
    ? 'h-[100svh]'
    : size === 'xl'
      ? 'h-[90svh]'
      : size === 'lg'
        ? 'h-[75svh]'
        : 'h-[60svh]'

  const handleDragEnd = (_: any, info: PanInfo) => {
    if (info.offset.y > 120 || info.velocity.y > 800) onClose()
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={BACKDROP_SPRING}
            onClick={onClose}
            className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-md md:backdrop-blur-lg saturate-125"
          />
          <motion.div
            key="sheet"
            role="dialog"
            aria-modal="true"
            aria-label={title ?? 'Bottom Sheet'}
            initial={{ y: fullscreen ? 0 : '100%' }}
            animate={{ y: 0 }}
            exit={{ y: fullscreen ? 0 : '100%' }}
            transition={SHEET_SPRING}
            drag={fullscreen ? false : 'y'}
            dragElastic={0.18}
            dragConstraints={{ top: 0, bottom: 0 }}
            onDragEnd={handleDragEnd}
            className={clsx(
              'fixed inset-x-0 z-[80] flex flex-col bg-white text-slate-900 shadow-2xl',
              fullscreen
                ? 'inset-0 rounded-none'
                : `bottom-0 ${heightClass} rounded-t-[28px] sm:left-1/2 sm:right-auto sm:bottom-6 sm:-translate-x-1/2 sm:w-[560px] sm:rounded-3xl`
            )}
            style={{ paddingBottom: fullscreen ? undefined : 'max(env(safe-area-inset-bottom), 12px)' }}
          >
            {!fullscreen && <div className="mx-auto mt-2 h-1.5 w-12 rounded-full bg-slate-200" />}

            {/* header: spacer • centered title • close on right */}
<div className="relative px-4 py-3">
  {title && (
    <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[15px] font-semibold tracking-wide">
      {title}
    </div>
  )}

  <button
    onClick={onClose}
    aria-label="Close"
    className="absolute right-4 top-1/2 -translate-y-1/2 inline-flex h-8 w-8 items-center justify-center rounded-full ring-1 ring-slate-200 hover:bg-slate-100 active:scale-95"
  >
    <XMarkIcon className="h-5 w-5 text-slate-600" />
  </button>
</div>            

            <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
              {children}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Desktop anchored popover + spotlight backdrop
 * ──────────────────────────────────────────────────────────────────────────── */
function useIsDesktop() {
  const [isDesk, set] = useState(false)
  useEffect(() => {
    const m = window.matchMedia('(min-width: 768px)')
    const on = () => set(m.matches)
    on()
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return isDesk
}

function useAnchorRect(open: boolean,  anchorRef: React.RefObject<HTMLElement | null>) {
  const [rect, setRect] = useState<DOMRect | null>(null)
  useEffect(() => {
    if (!open) return
    const calc = () => {
      const el = anchorRef.current
      if (!el) return setRect(null)
      const r = el.getBoundingClientRect()
      setRect(r)
    }
    calc()
    window.addEventListener('resize', calc)
    window.addEventListener('scroll', calc, true)
    ;(window.visualViewport ?? window).addEventListener?.('resize', calc)
    return () => {
      window.removeEventListener('resize', calc)
      window.removeEventListener('scroll', calc, true)
      ;(window.visualViewport ?? window).removeEventListener?.('resize', calc as any)
    }
  }, [open, anchorRef])
  return rect
}

const SpotlightBackdrop: React.FC<{
  rect: DOMRect
  onClick: () => void
}> = ({ rect, onClick }) => {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 0
  const vh = typeof window !== 'undefined' ? window.innerHeight : 0
  const blurCls = 'bg-black/60 backdrop-blur-md md:backdrop-blur-lg saturate-125'
  return (
    <>
      {/* TOP */}
      <div
        onClick={onClick}
        className={clsx('fixed left-0 top-0 z-[70]', blurCls)}
        style={{ width: vw, height: Math.max(0, rect.top) }}
      />
      {/* BOTTOM */}
      <div
        onClick={onClick}
        className={clsx('fixed left-0 z-[70]', blurCls)}
        style={{ top: rect.bottom, width: vw, height: Math.max(0, vh - rect.bottom) }}
      />
      {/* LEFT */}
      <div
        onClick={onClick}
        className={clsx('fixed z-[70]', blurCls)}
        style={{ top: rect.top, left: 0, width: Math.max(0, rect.left), height: rect.height }}
      />
      {/* RIGHT */}
      <div
        onClick={onClick}
        className={clsx('fixed z-[70]', blurCls)}
        style={{ top: rect.top, left: rect.right, width: Math.max(0, vw - rect.right), height: rect.height }}
      />
    </>
  )
}

const AnchoredPopover: React.FC<{
  isOpen: boolean
  onClose: () => void
  title?: string
    anchorRef: React.RefObject<HTMLElement | null>   // ← widen here
  width?: number
  children: React.ReactNode
}> = ({ isOpen, onClose, title, anchorRef, width = 560, children }) => {
  const rect = useAnchorRect(isOpen, anchorRef)
  const [coords, setCoords] = useState<{ top: number; left: number; w: number }>({ top: 100, left: 100, w: Math.min(560, (typeof window !== 'undefined' ? window.innerWidth : 560) - 24) })

  useEffect(() => {
    if (!isOpen) return
    const update = () => {
      const vw = window.innerWidth
      const maxW = Math.min(width, vw - 24)
      if (rect) {
        const top = Math.round(rect.bottom + 10)
        const left = Math.round(
          Math.max(12, Math.min(vw - maxW - 12, rect.left + rect.width / 2 - maxW / 2))
        )
        setCoords({ top, left, w: maxW })
      } else {
        setCoords({ top: 100, left: (vw - maxW) / 2, w: maxW })
      }
    }
    update()
  }, [rect, isOpen, width])

  // ESC to close
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  return (
    <AnimatePresence>
      {isOpen && rect && (
        <>
          <SpotlightBackdrop rect={rect} onClick={onClose} />
          <motion.div
            key="panel"
            role="dialog"
            aria-modal="true"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={SHEET_SPRING}
            className="fixed z-[80] overflow-hidden rounded-2xl bg-white text-slate-900 shadow-2xl ring-1 ring-white/10"
            style={{ top: coords.top, left: coords.left, width: coords.w }}
          >
          <div className="relative flex items-center justify-between px-4 py-3">
  {title && (
    <div className="text-[15px] font-semibold tracking-wide text-slate-900">
      {title}
    </div>
  )}

  <button
    onClick={onClose}
    aria-label="Close"
    // centered with a small downward offset (3px). tweak 1–4px to taste.
    className="absolute right-4 top-[calc(50%+3px)] -translate-y-1/2 inline-flex h-8 w-8 items-center justify-center rounded-full ring-1 ring-slate-200 hover:bg-slate-100 active:scale-95"
  >
    <XMarkIcon className="h-5 w-5 text-slate-600" />
  </button>
</div>

            <div className="max-h-[70vh] overflow-auto px-4 pb-4">{children}</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

/* Desktop fullscreen overlay for Create dialog */
const DesktopFullscreenOverlay: React.FC<{
  isOpen: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
}> = ({ isOpen, onClose, title, children }) => (
  <AnimatePresence>
    {isOpen && (
      <>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={BACKDROP_SPRING}
          onClick={onClose}
          className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-md md:backdrop-blur-lg saturate-125"
        />
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={SHEET_SPRING}
          className="fixed inset-0 z-[80] flex items-start justify-center p-6"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={title ?? 'Dialog'}
            className="w-full max-w-3xl overflow-hidden rounded-2xl bg-white text-slate-900 shadow-2xl ring-1 ring-white/10"
          >
            {/* Header: left spacer • centered title • close on right */}
            <div className="grid grid-cols-[1fr_auto_1fr] items-center px-4 py-3">
              <div className="h-8 w-8" />
              {title && (
                <div className="justify-self-center text-[15px] font-semibold tracking-wide">
                  {title}
                </div>
              )}
              <button
                onClick={onClose}
                aria-label="Close"
                className="justify-self-end inline-flex h-8 w-8 items-center justify-center rounded-full ring-1 ring-slate-200 hover:bg-slate-100 active:scale-95"
              >
                <XMarkIcon className="h-5 w-5 text-slate-600" />
              </button>
            </div>

            <div className="max-h-[calc(100vh-6rem)] overflow-auto px-4 pb-4">
              {children}
            </div>
          </div>
        </motion.div>
      </>
    )}
  </AnimatePresence>
)


/* ─────────────────────────────────────────────────────────────────────────────
 * AdaptiveSheet
 * ──────────────────────────────────────────────────────────────────────────── */
const AdaptiveSheet: React.FC<{
  isOpen: boolean
  onClose: () => void
  title?: string
    anchorRef: React.RefObject<HTMLElement | null>   // ← widen here
  mobileSize?: 'md' | 'lg' | 'xl'
  mobileFullscreen?: boolean
  width?: number
  desktopFullscreen?: boolean
  children: React.ReactNode
}> = ({ isOpen, onClose, title, anchorRef, mobileSize = 'lg', mobileFullscreen = false, width = 560, desktopFullscreen = false, children }) => {
  const isDesktop = useIsDesktop()
  if (typeof window === 'undefined') return null
  return isDesktop ? (
    desktopFullscreen ? (
      <DesktopFullscreenOverlay isOpen={isOpen} onClose={onClose} title={title}>
        {children}
      </DesktopFullscreenOverlay>
    ) : (
      <AnchoredPopover isOpen={isOpen} onClose={onClose} title={title} anchorRef={anchorRef} width={width}>
        {children}
      </AnchoredPopover>
    )
  ) : (
    <BottomSheet isOpen={isOpen} onClose={onClose} title={title} size={mobileSize} fullscreen={mobileFullscreen}>
      {children}
    </BottomSheet>
  )
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Picker List
 * ──────────────────────────────────────────────────────────────────────────── */
const PickerList: React.FC<{
  options: string[]
  selected?: string | null
  onSelect: (v: string) => void
  placeholder?: string
}> = ({ options, selected, onSelect, placeholder }) => {
  const [q, setQ] = useState('')
  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return options
    return options.filter(o => o.toLowerCase().includes(s))
  }, [q, options])

  return (
    <div className="mx-auto w-full max-w-xl space-y-4">
      {/* Sticky iOS-style search bar */}
      <div className="-mx-4 sticky top-0 z-10 bg-white/90 backdrop-blur px-4 pb-3 pt-2">
<div className="flex items-center gap-3 rounded-full bg-white px-4 py-2.5 shadow-md
                ring-1 ring-slate-200 outline-none
                focus-within:outline-none focus-within:ring-2 focus-within:ring-blue-400
                focus-within:ring-offset-2 focus-within:ring-offset-white">
          <MagnifyingGlassIcon className="h-5 w-5 shrink-0 text-slate-500" />
          <input
            placeholder={placeholder ?? 'Search'}
            value={q}
            onChange={e => setQ(e.target.value)}
     className="w-full appearance-none rounded-full bg-transparent text-[16px] lg:text-[17px]
             outline-none focus:outline-none placeholder:text-slate-400"
/>
          {q && (
            <button
              onClick={() => setQ('')}
              className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-200/80 active:scale-95"
              aria-label="Clear"
            >
              <XMarkIcon className="h-4 w-4 text-slate-700" />
            </button>
          )}
        </div>
      </div>

      {/* Card container with soft border + shadow */}
      <ul className="overflow-hidden rounded-3xl bg-white ring-1 ring-black/5 shadow-sm">
        {list.map((opt, idx) => {
          const isSel = selected?.toLowerCase() === opt.toLowerCase()
          const isLast = idx === list.length - 1
        return (
          <li key={`${opt}-${idx}`} className="relative">
            <button
              onClick={() => onSelect(opt)}
              className="group flex w-full items-center justify-between px-4 py-4 text-left text-[16px] active:bg-slate-100/80 transition-colors"
              aria-selected={isSel}
              role="option"
            >
              <span className="truncate font-medium text-slate-900">{opt}</span>

              <AnimatePresence initial={false}>
                {isSel && (
                  <motion.span
                    key="tick"
                    initial={{ scale: 0.6, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.6, opacity: 0 }}
                    transition={SHEET_SPRING}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500 text-white ring-1 ring-emerald-300/60"
                  >
                    <CheckIcon className="h-4 w-4" />
                  </motion.span>
                )}
              </AnimatePresence>
            </button>

            {/* inset divider like iOS (hidden on last) */}
            {!isLast && (
              <div className="pointer-events-none absolute bottom-0 left-4 right-4 h-px bg-slate-200/80" />
            )}
          </li>
        )})}

        {list.length === 0 && (
          <li className="px-4 py-8 text-center text-sm text-slate-500">No matches</li>
        )}
      </ul>
    </div>
  )
}


/* ─────────────────────────────────────────────────────────────────────────────
 * Create Branch
 * ──────────────────────────────────────────────────────────────────────────── */
type CreateDraft = { name: string; pinNumber: number | null; loose: boolean; not: boolean }

const CreateBranchPanel: React.FC<{
  isOpen: boolean
  onClose: () => void
  initialName?: string
  usedPins: number[]
  onCreate: (draft: CreateDraft) => Promise<void>
    anchorRef: React.RefObject<HTMLElement | null>   // ← widen here
}> = ({ isOpen, onClose, initialName, usedPins, onCreate, anchorRef }) => {
  const [name, setName] = useState(initialName ?? '')
  const [pin, setPin] = useState<number | null>(null)
  const [loose, setLoose] = useState(false)
  const [notTested, setNotTested] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => setName(initialName ?? ''), [initialName])

  const takenPins = useMemo(() => new Set(usedPins ?? []), [usedPins])
  const MIN_PIN = 1
  const MAX_PIN = 40
  const clamp = (n: number) => Math.max(MIN_PIN, Math.min(MAX_PIN, n))
  const isPinTaken = pin != null && takenPins.has(pin)

  const canSubmit = name.trim().length > 0 && !isPinTaken

  const submit = async () => {
    if (!canSubmit || saving) return
    setSaving(true)
    try {
      await onCreate({ name: name.trim(), pinNumber: pin, loose, not: notTested })
      onClose()
      setName('')
      setPin(null)
      setLoose(false)
      setNotTested(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <AdaptiveSheet
      isOpen={isOpen}
      onClose={onClose}
      title="Create Branch"
      anchorRef={anchorRef}
      mobileSize="xl"
      mobileFullscreen
      desktopFullscreen
      width={560}
    >
     <div className="mx-auto w-full max-w-xl space-y-6 text-slate-900">
  <div className="grid gap-6 md:grid-cols-2">
    {/* Branch name */}
    <div className="space-y-2">
      <label className="text-sm font-medium text-slate-700">Branch name</label>
      <input
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="e.g. CL_3001"
        className="w-full rounded-xl bg-slate-50 px-4 py-3 text-[15px] text-slate-900 placeholder:text-slate-400 outline-none ring-1 ring-slate-200 focus:bg-white focus:ring-2 focus:ring-emerald-400/60 transition"
      />
    </div>

    {/* Assign PIN (free input 1..40) */}
    <div className="space-y-2">
      <label className="text-sm font-medium text-slate-700">Assign PIN (optional)</label>
      <div className="flex items-center gap-2">
        <input
          type="number"
          inputMode="numeric"
          min={MIN_PIN}
          max={MAX_PIN}
          step={1}
          placeholder="1–40"
          value={pin ?? ''}
          onChange={e => {
            const v = e.target.value
            if (v === '') return setPin(null)
            const n = clamp(parseInt(v, 10))
            setPin(Number.isNaN(n) ? null : n)
          }}
          aria-invalid={isPinTaken}
          className={clsx(
            "w-28 rounded-xl bg-slate-50 px-3 py-2.5 text-[15px] text-slate-900 placeholder:text-slate-400 outline-none ring-1 transition",
            isPinTaken ? "ring-red-300 focus:ring-2 focus:ring-red-400/70" : "ring-slate-200 focus:bg-white focus:ring-2 focus:ring-emerald-400/60"
          )}
        />
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setPin(p => (p == null ? MIN_PIN : clamp(p - 1)))}
            className="rounded-xl bg-white px-3 py-2 text-sm ring-1 ring-slate-200 hover:bg-slate-50 active:scale-95"
          >
            −
          </button>
          <button
            type="button"
            onClick={() => setPin(p => (p == null ? MIN_PIN : clamp(p + 1)))}
            className="rounded-xl bg-white px-3 py-2 text-sm ring-1 ring-slate-200 hover:bg-slate-50 active:scale-95"
          >
            +
          </button>
          {pin != null && (
            <button
              type="button"
              onClick={() => setPin(null)}
              className="ml-1 rounded-xl bg-white px-3 py-2 text-sm ring-1 ring-slate-200 hover:bg-slate-50 active:scale-95"
            >
              Clear
            </button>
          )}
        </div>
      </div>
      {isPinTaken ? (
        <p className="text-xs text-red-600">This PIN is already in use. Choose another.</p>
      ) : (
        <p className="text-xs text-slate-500">Any value from {MIN_PIN} to {MAX_PIN}. Example: 39 or 40.</p>
      )}
    </div>
  </div>

  {/* Flags */}
  <div className="grid gap-4 md:grid-cols-2">
    <div className="flex items-center justify-between rounded-xl bg-white px-4 py-3 ring-1 ring-slate-200">
      <span className="text-sm text-slate-700">Loose contact</span>
      <IOSwitch checked={loose} onChange={setLoose} />
    </div>
    <div className="flex items-center justify-between rounded-xl bg-white px-4 py-3 ring-1 ring-slate-200">
      <span className="text-sm text-slate-700">Not tested</span>
      <IOSwitch checked={notTested} onChange={setNotTested} />
    </div>
  </div>

  {/* Submit */}
  <div className="pt-2">
    <button
      onClick={submit}
      disabled={!canSubmit || saving}
      className={clsx(
        "w-full rounded-xl px-4 py-3 text-[15px] font-semibold active:scale-[0.99] transition",
        canSubmit && !saving
          ? "bg-emerald-500 text-white hover:bg-emerald-600 shadow-[0_6px_20px_-8px_rgba(16,185,129,0.55)]"
          : "bg-slate-100 text-slate-400"
      )}
    >
      {saving ? "Creating…" : "Create"}
    </button>
  </div>
</div>

    </AdaptiveSheet>
  )
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Main Page
 * ──────────────────────────────────────────────────────────────────────────── */
const SettingsBranchesPageContent: React.FC<{
  onNavigateBack: () => void
  configId: number | null
}> = ({ onNavigateBack, configId }) => {
  // STATE
  const [configs, setConfigs] = useState<Configuration[]>([])
  const [selectedConfig, setSelectedConfig] = useState<Configuration | null>(null)
  const [loadingConfigs, setLoadingConfigs] = useState(true)

  const [selectedKfbInfo, setSelectedKfbInfo] = useState<string | null>(null)
  const [kfbInfoDetails, setKfbInfoDetails] = useState<{ id: number; kfb_info_value: string }[]>([])

  const [unifiedInput, setUnifiedInput] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)

  const [allBranches, setAllBranches] = useState<Branch[]>([])
  const [linkedBranches, setLinkedBranches] = useState<Branch[]>([])
  const [loadingBranches, setLoadingBranches] = useState(false)

  const [pinMap, setPinMap] = useState<Record<number, number | null>>({})
  const [loadingPinMap, setLoadingPinMap] = useState<Record<number, boolean>>({})
  const [newPinInputs, setNewPinInputs] = useState<Record<number, string>>({})
  const [notTestedMap, setNotTestedMap] = useState<Record<number, boolean>>({})
  const [looseContactMap, setLooseContactMap] = useState<Record<number, boolean>>({})

  const [editingBranchId, setEditingBranchId] = useState<number | null>(null)
  const [editBranchInputs, setEditBranchInputs] = useState<Record<number, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)

  // UI state
  const [sortKey, setSortKey] = useState<SortKey>('index')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [dense, setDense] = useState(true)

  // Sheets open state
  const [showKfbSheet, setShowKfbSheet] = useState(false)
  const [showInfoSheet, setShowInfoSheet] = useState(false)
  const [showCreateSheet, setShowCreateSheet] = useState(false)
  const [createDraftName, setCreateDraftName] = useState<string>('')

  // ANCHORS
  const kfbBtnRef = useRef<HTMLButtonElement | null>(null)
  const infoBtnRef = useRef<HTMLButtonElement | null>(null)
  const searchContainerRef = useRef<HTMLDivElement | null>(null)

  // EFFECTS: configs
  useEffect(() => {
    setLoadingConfigs(true)
    setError(null)
    fetchJSON<Configuration[]>('/api/configurations')
      .then(data => setConfigs(data))
      .catch(err => setError(`Failed to load configurations: ${err.message}`))
      .finally(() => setLoadingConfigs(false))
  }, [])

  useEffect(() => {
    if (!loadingConfigs && configId !== null) {
      const found = configs.find(c => c.id === configId) ?? null
      setSelectedConfig(found)
      setSelectedKfbInfo(null)
      setLinkedBranches([])
      setPinMap({})
      setNotTestedMap({})
      setLooseContactMap({})
      setUnifiedInput('')
      setEditingBranchId(null)
    }
  }, [configs, loadingConfigs, configId])

  // EFFECTS: KFB info list for selected config
  useEffect(() => {
    if (!selectedConfig) {
      setKfbInfoDetails([])
      return
    }
    setError(null)
    fetchJSON<{ id: number; kfb_info_value: string }[]>(
      `/api/kfb_info_details?configId=${selectedConfig.id}`
    )
      .then(rows => setKfbInfoDetails(rows))
      .catch(err => setError(`Failed to load KFB info details: ${err.message}`))
  }, [selectedConfig])

  // EFFECTS: all branches for suggestions
  useEffect(() => {
    if (!selectedConfig) {
      setAllBranches([])
      return
    }
    setError(null)
    fetchJSON<BranchApiResponse[]>(`/api/branches?kfb=${selectedConfig.kfb}`)
      .then(data => {
        const adapted: Branch[] = data.map(b => ({ id: Number(b.id), name: b.branchName }))
        setAllBranches(adapted)
      })
      .catch(err => setError(`Failed to load branch list: ${err.message}`))
  }, [selectedConfig])

  // EFFECTS: linked branches + pin map when info changes
  useEffect(() => {
    if (!selectedConfig || !selectedKfbInfo) {
      setLinkedBranches([])
      setPinMap({})
      setNotTestedMap({})
      setLooseContactMap({})
      return
    }
    const detail = kfbInfoDetails.find(d => d.kfb_info_value === selectedKfbInfo)
    if (!detail) return

    setLoadingBranches(true)
    setError(null)

    const run = async () => {
      try {
        const configBranchRows = await fetchJSON<ConfigBranchRow[]>(
          `/api/config_branches?configId=${selectedConfig.id}&detailId=${detail.id}`
        )

        const notMap: Record<number, boolean> = {}
        const branchIds = configBranchRows.map(r => {
          notMap[r.branch_id] = r.not_tested ?? false
          return r.branch_id
        })
        setNotTestedMap(notMap)

        if (branchIds.length === 0) {
          setLinkedBranches([])
          setPinMap({})
          setLooseContactMap({})
          setLoadingBranches(false)
          return
        }

        const linked = await fetchJSON<BranchApiResponse[]>(
          `/api/branches?ids=${branchIds.join(',')}`
        )
        const adaptedLinked: Branch[] = linked.map(b => ({ id: Number(b.id), name: b.branchName }))

        // ✅ de-duplicate by id to avoid duplicate React keys
        const uniqueLinked = Array.from(new Map(adaptedLinked.map(b => [b.id, b])).values())
        setLinkedBranches(uniqueLinked)

        const loose: Record<number, boolean> = {}
        linked.forEach(b => {
          loose[Number(b.id)] = !!b.looseContact
        })
        setLooseContactMap(loose)

        const pinRows = await fetchJSON<EspPinMappingRow[]>(
          `/api/esp_pin_mappings?detailId=${detail.id}`
        )
        const newPinMap: Record<number, number | null> = {}
        uniqueLinked.forEach(b => (newPinMap[b.id] = null))
        pinRows.forEach(r => {
          newPinMap[r.branch_id] = r.pin_number
        })
        setPinMap(newPinMap)
      } catch (err: any) {
        setError(`Failed to load branch data: ${err.message}`)
        setLinkedBranches([])
        setPinMap({})
        setNotTestedMap({})
        setLooseContactMap({})
      } finally {
        setLoadingBranches(false)
      }
    }
    run()
  }, [selectedConfig, selectedKfbInfo, kfbInfoDetails, refreshKey])

  // Suggestions & filters
  const suggestionsToLink = useMemo(() => {
    const term = unifiedInput.trim().toLowerCase()
    if (!term || !selectedConfig || !selectedKfbInfo) return []
    const linkedIds = new Set(linkedBranches.map(b => b.id))
    return allBranches
      .filter(b => !linkedIds.has(b.id) && b.name.toLowerCase().includes(term))
      .slice(0, 8)
  }, [allBranches, linkedBranches, unifiedInput, selectedConfig, selectedKfbInfo])

  const filteredLinkedBranches = useMemo(() => {
    const term = unifiedInput.trim().toLowerCase()
    if (!term) return linkedBranches
    return linkedBranches.filter(b => b.name.toLowerCase().includes(term))
  }, [linkedBranches, unifiedInput])

  const areAllNotTested = useMemo(() => {
    if (filteredLinkedBranches.length === 0) return false
    return filteredLinkedBranches.every(b => notTestedMap[b.id])
  }, [filteredLinkedBranches, notTestedMap])

  const displayRows = useMemo(() => {
    const rows = filteredLinkedBranches.map((b, idx) => ({
      index: idx + 1,
      id: b.id,
      name: b.name,
      pin: pinMap[b.id] ?? null,
      not: !!notTestedMap[b.id],
      loose: !!looseContactMap[b.id],
    }))
    const dir = sortDir === 'asc' ? 1 : -1
    rows.sort((a, b) => {
      switch (sortKey) {
        case 'name':
          return a.name.localeCompare(b.name) * dir
        case 'pin':
          return ((a.pin ?? Number.POSITIVE_INFINITY) - (b.pin ?? Number.POSITIVE_INFINITY)) * dir
        case 'not':
          return (Number(a.not) - Number(b.not)) * dir
        case 'loose':
          return (Number(a.loose) - Number(b.loose)) * dir
        default:
          return (a.index - b.index) * dir
      }
    })
    return rows
  }, [filteredLinkedBranches, pinMap, notTestedMap, looseContactMap, sortKey, sortDir])

  const triggerRefresh = () => setRefreshKey(k => k + 1)

  // SELECTION handlers
  const handleSelectConfig = useCallback(
    (id: number) => {
      const c = configs.find(x => x.id === id) ?? null
      setSelectedConfig(c)
      setSelectedKfbInfo(null)
      setLinkedBranches([])
      setUnifiedInput('')
    },
    [configs]
  )
  const handleSelectKfbInfo = useCallback((val: string) => {
    setSelectedKfbInfo(val)
    setUnifiedInput('')
  }, [])

  // Toggles
  const handleToggleNotTested = useCallback(
    async (branchId: number) => {
      const detail = kfbInfoDetails.find(d => d.kfb_info_value === selectedKfbInfo)
      if (!detail) return
      const oldState = notTestedMap[branchId] || false
      const newState = !oldState
      setNotTestedMap(m => ({ ...m, [branchId]: newState }))
      try {
        await fetchJSON(`/api/config_branches/${detail.id}/${branchId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ not_tested: newState }),
        })
      } catch (err: any) {
        setError(err.message)
        setNotTestedMap(m => ({ ...m, [branchId]: oldState }))
      }
    },
    [selectedKfbInfo, kfbInfoDetails, notTestedMap]
  )
  const handleToggleAllNotTested = useCallback(async () => {
    const detail = kfbInfoDetails.find(d => d.kfb_info_value === selectedKfbInfo)
    if (!detail || filteredLinkedBranches.length === 0) return
    const newGlobalState = filteredLinkedBranches.some(b => !notTestedMap[b.id])
    const originalMap = { ...notTestedMap }
    const newMap = { ...notTestedMap }
    filteredLinkedBranches.forEach(b => { newMap[b.id] = newGlobalState })
    setNotTestedMap(newMap)
    try {
      await Promise.all(
        filteredLinkedBranches.map(b =>
          fetchJSON(`/api/config_branches/${detail.id}/${b.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ not_tested: newGlobalState }),
          })
        )
      )
    } catch (err: any) {
      setError(`Failed to update all branches: ${err.message}. Reverting.`)
      setNotTestedMap(originalMap)
    }
  }, [filteredLinkedBranches, notTestedMap, kfbInfoDetails, selectedKfbInfo])

  const handleToggleLooseContact = useCallback(
    async (branchId: number) => {
      const detail = kfbInfoDetails.find(d => d.kfb_info_value === selectedKfbInfo)
      if (!detail) return
      const oldLoose = looseContactMap[branchId]
      const newLoose = !oldLoose
      const currentNot = notTestedMap[branchId] ?? false
      setLooseContactMap(m => ({ ...m, [branchId]: newLoose }))
      try {
        await fetchJSON(`/api/config_branches/${detail.id}/${branchId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ loose_contact: newLoose, not_tested: currentNot }),
        })
      } catch (err: any) {
        setError(err.message)
        setLooseContactMap(m => ({ ...m, [branchId]: oldLoose }))
      }
    },
    [looseContactMap, notTestedMap, kfbInfoDetails, selectedKfbInfo]
  )
  const handleToggleAllLooseContact = useCallback(async () => {
    const detail = kfbInfoDetails.find(d => d.kfb_info_value === selectedKfbInfo)
    if (!detail || filteredLinkedBranches.length === 0) return
    const newLoose = filteredLinkedBranches.some(b => !looseContactMap[b.id])
    const origLoose = { ...looseContactMap }
    setLooseContactMap(m => {
      filteredLinkedBranches.forEach(b => (m[b.id] = newLoose))
      return { ...m }
    })
    try {
      await Promise.all(
        filteredLinkedBranches.map(b =>
          fetchJSON(`/api/config_branches/${detail.id}/${b.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ loose_contact: newLoose, not_tested: notTestedMap[b.id] ?? false }),
          })
        )
      )
    } catch (err: any) {
      setError(`Failed to update loose-contact: ${err.message}`)
      setLooseContactMap(origLoose)
    }
  }, [filteredLinkedBranches, looseContactMap, notTestedMap, kfbInfoDetails, selectedKfbInfo])

  // Editing branch name
  const handleEditBranch = useCallback((b: Branch) => {
    setEditingBranchId(b.id)
    setEditBranchInputs(m => ({ ...m, [b.id]: b.name }))
  }, [])
  const handleSaveBranchName = useCallback(async (branchId: number) => {
    const newName = (editBranchInputs[branchId] ?? '').trim()
    if (!newName) { setEditingBranchId(null); return }
    const old = linkedBranches.find(b => b.id === branchId)?.name
    if (newName === old) { setEditingBranchId(null); return }
    try {
      await fetchJSON(`/api/branches/${branchId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName }),
      })
      setLinkedBranches(list => list.map(b => (b.id === branchId ? { ...b, name: newName } : b)))
      setEditingBranchId(null)
    } catch (err: any) {
      setError(`Rename failed: ${err.message}`)
    }
  }, [editBranchInputs, linkedBranches])

  // Linking / creating
  const linkExistingBranch = async (b: Branch) => {
    const detail = kfbInfoDetails.find(d => d.kfb_info_value === selectedKfbInfo)
    if (!selectedConfig || !detail) return setError('A KFB and Info must be selected.')
    if (linkedBranches.some(x => x.id === b.id)) return
    try {
      await fetchJSON('/api/config_branches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config_id: selectedConfig.id,
          kfb_info_detail_id: detail.id,
          branch_id: b.id,
        }),
      })
      setUnifiedInput('')
      setShowSuggestions(false)
      triggerRefresh()
    } catch (err: any) {
      setError(`Failed to link branch: ${err.message}`)
    }
  }

  const createBranchViaSheet = () => {
    const name = unifiedInput.trim()
    if (!name) return setError('Branch name cannot be empty.')
    if (allBranches.some(b => b.name.toLowerCase() === name.toLowerCase())) {
      return setError('A branch with this name already exists. Select it from suggestions to link.')
    }
    setCreateDraftName(name)
    setShowCreateSheet(true)
  }

  const handleCreateDraft = async (draft: CreateDraft) => {
    const detail = kfbInfoDetails.find(d => d.kfb_info_value === selectedKfbInfo)
    if (!selectedConfig || !detail) throw new Error('Selection missing')

    // 1) Create branch
    const newBranchData = await fetchJSON<BranchApiResponse>('/api/branches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: draft.name }),
    })
    const newBranch = { id: Number(newBranchData.id), name: newBranchData.branchName }
    setAllBranches(a => [...a, newBranch])

    // 2) Link to config/detail
    await fetchJSON('/api/config_branches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        config_id: selectedConfig.id,
        kfb_info_detail_id: detail.id,
        branch_id: newBranch.id,
      }),
    })

    // 3) Optional PIN
    if (draft.pinNumber != null) {
      // guard against used pin just in case
      if (Object.values(pinMap).includes(draft.pinNumber)) {
        throw new Error('PIN already in use.')
      }
      await fetchJSON('/api/esp_pin_mappings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config_id: selectedConfig.id,
          kfb_info_detail_id: detail.id,
          branch_id: newBranch.id,
          pin_number: draft.pinNumber,
        }),
      })
    }

    // 4) Initial flags
    if (draft.loose || draft.not) {
      await fetchJSON(`/api/config_branches/${detail.id}/${newBranch.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loose_contact: draft.loose, not_tested: draft.not }),
      })
    }

    setUnifiedInput('')
    setShowSuggestions(false)
    triggerRefresh()
  }

  // compute once per render
  const usedPins = useMemo(() => {
    const nums = Object.values(pinMap).filter((n): n is number => typeof n === 'number')
    return Array.from(new Set(nums)).sort((a, b) => a - b)
  }, [pinMap])

  // Add/Remove PIN (inline)
  const handleAddPin = useCallback(async (branchId: number) => {
    const detail = kfbInfoDetails.find(d => d.kfb_info_value === selectedKfbInfo)
    if (!detail || !selectedConfig) return
    const raw = (newPinInputs[branchId] ?? '').trim()
    if (!/^\d+$/.test(raw)) return setError('PIN must be a number.')
    const n = Math.max(1, Math.min(40, parseInt(raw, 10)))

    // prevent reuse
    if (usedPins.includes(n)) return setError(`PIN ${n} is already in use.`)

    setLoadingPinMap(m => ({ ...m, [branchId]: true }))
    try {
      await fetchJSON('/api/esp_pin_mappings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config_id: selectedConfig.id,
          kfb_info_detail_id: detail.id,
          branch_id: branchId,
          pin_number: n,
        }),
      })
      setPinMap(m => ({ ...m, [branchId]: n }))
      setNewPinInputs(m => ({ ...m, [branchId]: '' }))
    } catch (err: any) {
      setError(`Failed to add PIN: ${err.message}`)
    } finally {
      setLoadingPinMap(m => ({ ...m, [branchId]: false }))
    }
  }, [newPinInputs, kfbInfoDetails, selectedKfbInfo, selectedConfig, usedPins])

  const handleDeletePin = useCallback(async (branchId: number) => {
    const detail = kfbInfoDetails.find(d => d.kfb_info_value === selectedKfbInfo)
    if (!detail) return
    setLoadingPinMap(m => ({ ...m, [branchId]: true }))
    try {
      await fetchJSON(`/api/esp_pin_mappings/${detail.id}/${branchId}`, { method: 'DELETE' })
      setPinMap(m => ({ ...m, [branchId]: null }))
    } catch (err: any) {
      setError(`Failed to remove PIN: ${err.message}`)
    } finally {
      setLoadingPinMap(m => ({ ...m, [branchId]: false }))
    }
  }, [kfbInfoDetails, selectedKfbInfo])

  // ✅ Unlink handler that was missing
  const handleUnlinkBranch = useCallback(async (branchId: number) => {
    const detail = kfbInfoDetails.find(d => d.kfb_info_value === selectedKfbInfo)
    if (!detail) return
    try {
      await fetchJSON(`/api/config_branches/${detail.id}/${branchId}`, { method: 'DELETE' })
      setConfirmDeleteId(null)
      triggerRefresh()
    } catch (err: any) {
      setError(`Failed to unlink branch: ${err.message}`)
    }
  }, [kfbInfoDetails, selectedKfbInfo])

  // Suggestions click-away
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  // RENDER: loading
  if (loadingConfigs) {
    return (
      <div className="flex h-screen items-center justify-center bg-gradient-to-b from-slate-50 to-slate-100 text-gray-800">
        <ArrowPathIcon className="mr-3 h-6 w-6 animate-spin text-slate-500" />
        <p className="text-[15px] font-medium">Loading configurations…</p>
      </div>
    )
  }

  const headerCell =
    'px-3 py-2 text-[12px] md:text-[13px] font-medium text-slate-700 bg-slate-50/95 backdrop-blur border-b border-slate-200 sticky top-0 z-10'
  const cellBase = clsx(
    'px-3',
    dense ? 'py-1.5' : 'py-2.5',
    'text-[13px] bg-white border-b border-slate-200'
  )

  const SortIcon = ({ active }: { active: boolean }) =>
    active
      ? (sortDir === 'asc'
          ? <ArrowUpIcon className="ml-1 h-3.5 w-3.5 opacity-70" />
          : <ArrowDownIcon className="ml-1 h-3.5 w-3.5 opacity-70" />)
      : <span className="ml-1 inline-block w-3.5" />

  const clickSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  return (
    <div className="flex min-h-screen w-screen flex-col bg-gradient-to-b from-slate-50 to-slate-100 text-slate-900">
      {/* Sticky header */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex w-full items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2">
            <button
              onClick={onNavigateBack}
              className="inline-flex items-center gap-1 rounded-2xl bg-slate-100 px-2 py-1.5 text-sm text-slate-700 ring-1 ring-slate-200 hover:bg-slate-200"
            >
              <ArrowLeftIcon className="h-4 w-4" />
              Back
            </button>
            <h1 className="ml-1 text-base font-semibold md:text-lg">Branch Configuration</h1>
          </div>
          <label className="inline-flex items-center gap-2 text-[13px] text-slate-600">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300"
              checked={dense}
              onChange={() => setDense(v => !v)}
            />
            Compact rows
          </label>
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto flex w-full flex-1 flex-col gap-4 px-4 py-4">
        {/* Pickers */}
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            ref={kfbBtnRef}
            onClick={() => setShowKfbSheet(true)}
            className="group flex items-center justify-between rounded-2xl bg-white px-4 py-3 text-left shadow-sm ring-1 ring-slate-200 transition hover:shadow active:scale-[0.997]"
          >
            <div>
              <div className="text-[11px] uppercase tracking-wider text-slate-500">1. Select KFB Number</div>
              <div className="truncate text-[15px] font-semibold text-slate-900">
                {selectedConfig ? selectedConfig.kfb : 'Choose…'}
              </div>
            </div>
            <ChevronDownIcon className="h-5 w-5 text-slate-500 transition group-hover:translate-y-0.5" />
          </button>

          <button
            ref={infoBtnRef}
            onClick={() => selectedConfig && setShowInfoSheet(true)}
            className={clsx(
              'group flex items-center justify-between rounded-2xl px-4 py-3 text-left shadow-sm transition active:scale-[0.997]',
              selectedConfig
                ? 'bg-white ring-1 ring-slate-200 hover:shadow'
                : 'cursor-not-allowed bg-slate-100 ring-1 ring-slate-200/60'
            )}
          >
            <div>
              <div className="text-[11px] uppercase tracking-wider text-slate-500">2. Select KFB Info</div>
              <div className="truncate text-[15px] font-semibold text-slate-900">
                {selectedKfbInfo || (selectedConfig ? (kfbInfoDetails.length ? 'Choose…' : 'No info available') : 'Select KFB first')}
              </div>
            </div>
            <ChevronDownIcon className="h-5 w-5 text-slate-500 transition group-hover:translate-y-0.5" />
          </button>
        </div>

        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            <div className="flex items-start gap-2">
              <ExclamationTriangleIcon className="mt-0.5 h-5 w-5" />
              <div className="flex-1">
                <div className="font-medium">An error occurred</div>
                <div>{error}</div>
              </div>
              <button onClick={() => setError(null)} className="text-red-600 hover:text-red-800">
                &times;
              </button>
            </div>
          </div>
        )}

        {/* Grid */}
        {selectedConfig && selectedKfbInfo ? (
          <section className="flex min-h-0 flex-1 flex-col">
            {/* Filter / create — bigger input + bigger dropdown */}
            <div className="relative mb-4 mx-auto w-full " ref={searchContainerRef}>
              <form
                onSubmit={(e: FormEvent) => {
                  e.preventDefault()
                  createBranchViaSheet()
                }}
              >
<div className="flex items-center gap-3 rounded-full bg-white px-4 py-2.5 shadow-md
                ring-1 ring-slate-200 outline-none
                focus-within:outline-none focus-within:ring-2 focus-within:ring-blue-400
                focus-within:ring-offset-2 focus-within:ring-offset-white">
                  <MagnifyingGlassIcon className="h-5 w-5 text-slate-500" />
                  <input
                    type="text"
                     className="w-full appearance-none rounded-full bg-transparent text-[16px] lg:text-[17px]
             outline-none focus:outline-none placeholder:text-slate-400"
                    placeholder="Filter, link, or create branch…"
                    value={unifiedInput}
                    onChange={e => {
                      setUnifiedInput(e.target.value)
                      setShowSuggestions(true)
                    }}
                    onFocus={() => setShowSuggestions(true)}
                  />
                </div>

                {showSuggestions && (
                  <div
                    className="absolute top-full left-0 right-0 z-[60] mt-2 max-h-[60vh] overflow-auto rounded-2xl border border-slate-200 bg-white shadow-xl ring-1 ring-slate-200/60"
                    role="listbox"
                  >
                    {suggestionsToLink.map(b => (
                      <div
                        key={b.id}
                        role="option"
                        className="cursor-pointer px-4 py-3 text-[15px] hover:bg-blue-50"
                        onClick={() => linkExistingBranch(b)}
                      >
                        Link existing: <span className="font-medium">{b.name}</span>
                      </div>
                    ))}

                    {unifiedInput.trim() &&
                      !suggestionsToLink.some(
                        s => s.name.toLowerCase() === unifiedInput.trim().toLowerCase()
                      ) && (
                        <div className="border-t border-slate-200 bg-slate-50/60 px-4 py-3 text-center">
                          <button
                            type="submit"
                            className="inline-flex items-center justify-center rounded-xl px-3 py-2 text-[15px] font-medium text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50"
                          >
                            Create new branch: “<strong className="ml-1">{unifiedInput}</strong>”
                          </button>
                        </div>
                      )}
                  </div>
                )}
              </form>
            </div>


            <div className="relative min-h-0 flex-1 overflow-auto rounded-2xl border border-slate-200 bg-white">
              <table className="min-w-full table-fixed text-[13px]">
                <colgroup>
                  <col className="w-14" />
                  <col />
                  <col className="w-36" />
                  <col className="w-40" />
                  <col className="w-40" />
                  <col className="w-44" />
                </colgroup>
                <thead>
                  <tr className="select-none">
                    <th className={headerCell}>
                      <button type="button" onClick={() => clickSort('index')} className="inline-flex items-center" title="Sort by row #">
                        # <SortIcon active={sortKey === 'index'} />
                      </button>
                    </th>
                    <th className={headerCell}>
                      <button type="button" onClick={() => clickSort('name')} className="inline-flex items-center" title="Sort by branch">
                        Branch <SortIcon active={sortKey === 'name'} />
                      </button>
                    </th>
                    <th className={headerCell}>
                      <label className="flex items-center justify-center gap-2">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-slate-300"
                          checked={areAllNotTested}
                          onChange={handleToggleAllNotTested}
                          disabled={filteredLinkedBranches.length === 0}
                          title="Toggle all (filtered)"
                        />
                        <span className="inline-flex items-center">
                          Not tested
                          <button type="button" onClick={() => clickSort('not')} className="ml-1 inline-flex items-center" title="Sort by Not tested">
                            <SortIcon active={sortKey === 'not'} />
                          </button>
                        </span>
                      </label>
                    </th>
                    <th className={headerCell}>
                      <label className="flex items-center justify-center gap-2">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-slate-300"
                          checked={filteredLinkedBranches.length > 0 && filteredLinkedBranches.every(b => looseContactMap[b.id])}
                          onChange={handleToggleAllLooseContact}
                          disabled={filteredLinkedBranches.length === 0}
                          title="Toggle all (filtered)"
                        />
                        <span className="inline-flex items-center">
                          Loose contact
                          <button type="button" onClick={() => clickSort('loose')} className="ml-1 inline-flex items-center" title="Sort by Loose contact">
                            <SortIcon active={sortKey === 'loose'} />
                          </button>
                        </span>
                      </label>
                    </th>
                    <th className={headerCell}>
                      <button type="button" onClick={() => clickSort('pin')} className="inline-flex items-center" title="Sort by PIN">
                        PIN <SortIcon active={sortKey === 'pin'} />
                      </button>
                    </th>
                    <th className={headerCell}>Actions</th>
                  </tr>
                </thead>

                <tbody className="[&_tr:nth-child(odd)]:bg-slate-50/40">
                  {loadingBranches ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-500">
                        <ArrowPathIcon className="mr-2 inline h-5 w-5 animate-spin text-slate-400" />
                        Loading branches…
                      </td>
                    </tr>
                  ) : displayRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-10 text-center text-slate-500">
                        No branches linked. Use the input above to add one.
                      </td>
                    </tr>
                  ) : (
                    displayRows.map((r, idx) => (
                      <tr key={`${r.id}-${idx}`} className="transition-colors hover:bg-emerald-50/70">
                        <td className={clsx(cellBase, 'pr-4 text-right font-mono text-slate-500')}>{r.index}</td>
                        <td className={clsx(cellBase, 'align-middle')}>
                          {editingBranchId === r.id ? (
                            <div className="flex items-center gap-2">
                              <input
                                className="w-full rounded-2xl px-2 py-1 text-[13px] ring-1 ring-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                value={editBranchInputs[r.id] ?? ''}
                                onChange={e => setEditBranchInputs(m => ({ ...m, [r.id]: e.target.value }))}
                                onKeyDown={e => e.key === 'Enter' && handleSaveBranchName(r.id)}
                                onBlur={() => setEditingBranchId(null)}
                                autoFocus
                              />
                              <button onClick={() => handleSaveBranchName(r.id)} className="text-green-600 hover:text-green-500" title="Save">
                                <CheckCircleIcon className="h-5 w-5" />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <span className="truncate">{r.name}</span>
                              <button onClick={() => handleEditBranch({ id: r.id, name: r.name })} className="text-slate-400 hover:text-slate-700" title="Rename">
                                <PencilSquareIcon className="h-4 w-4" />
                              </button>
                            </div>
                          )}
                        </td>

                        <td className={clsx(cellBase, 'text-center')}>
                          <IOSwitch checked={r.not} onChange={() => handleToggleNotTested(r.id)} />
                        </td>

                        <td className={clsx(cellBase, 'text-center')}>
                          <IOSwitch checked={r.loose} onChange={() => handleToggleLooseContact(r.id)} />
                        </td>

                        <td className={clsx(cellBase, 'text-center font-mono')}>
                          {loadingPinMap[r.id] ? (
                            <ArrowPathIcon className="mx-auto h-4 w-4 animate-spin text-slate-400" />
                          ) : r.pin != null ? (
                            <div className="inline-flex items-center gap-2">
                              <code className="rounded-2xl bg-slate-100 px-2 py-0.5 ring-1 ring-slate-200">PIN {r.pin}</code>
                              <button onClick={() => handleDeletePin(r.id)} className="text-red-600 hover:text-red-700" title="Remove PIN">
                                <XMarkIcon className="h-4 w-4" />
                              </button>
                            </div>
                          ) : (
                            <form
                              onSubmit={e => {
                                e.preventDefault()
                                handleAddPin(r.id)
                              }}
                              className="inline-flex items-center gap-1"
                            >
                              <input
                                type="text"
                                className="w-16 rounded-2xl border border-slate-300 bg-white px-2 py-1 text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="Add"
                                value={newPinInputs[r.id] || ''}
                                onChange={e => setNewPinInputs(m => ({ ...m, [r.id]: e.target.value }))}
                              />
                              <button type="submit" className="text-emerald-600 hover:text-emerald-500" title="Add PIN">
                                <PlusIcon className="h-5 w-5" />
                              </button>
                            </form>
                          )}
                        </td>

                        <td className={clsx(cellBase, 'text-center')}>
                          {confirmDeleteId === r.id ? (
                            <div className="inline-flex items-center gap-2">
                              <span className="font-medium text-amber-700">Unlink?</span>
                              <button onClick={() => handleUnlinkBranch(r.id)} className="rounded-2xl bg-red-600 px-2 py-1 text-[12px] text-white hover:bg-red-500">
                                Yes
                              </button>
                              <button onClick={() => setConfirmDeleteId(null)} className="rounded-2xl bg-slate-200 px-2 py-1 text-[12px] text-slate-800 hover:bg-slate-300">
                                No
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setConfirmDeleteId(r.id)}
                              className="mx-auto inline-flex items-center gap-1.5 rounded-2xl border border-red-200 bg-red-50 px-3 py-1.5 text-[12px] font-medium text-red-700 hover:bg-red-100"
                            >
                              <TrashIcon className="h-4 w-4" /> Unlink
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            
          </section>
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center">
             
              <p className="text-xl text-slate-600">Choose a KFB and KFB Info to manage branches.</p>
            </div>
          </div>
        )}
      </main>

      {/* Sheets */}
      <AdaptiveSheet
        isOpen={showKfbSheet}
        onClose={() => setShowKfbSheet(false)}
        title="Select KFB Number"
        anchorRef={kfbBtnRef}
        mobileSize="lg"
      >
        <PickerList
          options={configs.map(c => c.kfb)}
          selected={selectedConfig?.kfb}
          onSelect={v => {
            const chosen = configs.find(c => c.kfb === v)
            if (chosen) handleSelectConfig(chosen.id)
            setShowKfbSheet(false)
          }}
          placeholder="Search KFB…"
        />
      </AdaptiveSheet>

      <AdaptiveSheet
        isOpen={showInfoSheet}
        onClose={() => setShowInfoSheet(false)}
        title="Select KFB Info"
        anchorRef={infoBtnRef}
        mobileSize="lg"
      >
        <PickerList
          options={kfbInfoDetails.map(d => d.kfb_info_value)}
          selected={selectedKfbInfo ?? undefined}
          onSelect={v => {
            handleSelectKfbInfo(v)
            setShowInfoSheet(false)
          }}
          placeholder="Search info…"
        />
      </AdaptiveSheet>

      <CreateBranchPanel
        isOpen={showCreateSheet}
        onClose={() => setShowCreateSheet(false)}
        initialName={createDraftName}
        usedPins={usedPins}
        onCreate={handleCreateDraft}
        anchorRef={searchContainerRef}
      />

      {/* Floating add action (mobile) */}
      {selectedConfig && selectedKfbInfo && (
        <button
          onClick={() => {
            setCreateDraftName('')
            setShowCreateSheet(true)
          }}
          className="fixed bottom-5 right-5 inline-flex items-center justify-center rounded-2xl bg-emerald-600 p-3 text-white shadow-2xl ring-1 ring-emerald-700/20 hover:scale-[1.02] active:scale-[0.98] md:hidden"
          aria-label="Add Branch"
        >
          <PlusIcon className="h-5 w-5" />
        </button>
      )}
    </div>
  )
}

export { SettingsBranchesPageContent }
export default SettingsBranchesPageContent
