'use client';
import React, { useState, useEffect, useCallback, useMemo, useRef, FormEvent, } from 'react';
import { XMarkIcon, CheckCircleIcon, PencilSquareIcon, PlusIcon, ArrowPathIcon, ExclamationTriangleIcon, TrashIcon, ArrowUpIcon, ArrowDownIcon, MagnifyingGlassIcon, CheckIcon, ChevronDownIcon, } from '@heroicons/react/24/solid';
import { m, AnimatePresence, PanInfo } from 'framer-motion';
import { SettingsCubeIcon } from "@/components/Icons/Icons";
/* ─────────────────────────────────────────────────────────────────────────────
 * Helpers
 * ──────────────────────────────────────────────────────────────────────────── */
async function fetchJSON(url, opts = {}) {
    const res = await fetch(url, { cache: 'no-store', ...opts });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || res.statusText || `Request failed with status ${res.status}`);
    }
    return res.json();
}
function clsx(...parts) {
    return parts.filter(Boolean).join(' ');
}
/* ─────────────────────────────────────────────────────────────────────────────
 * Display mode hook
 * ──────────────────────────────────────────────────────────────────────────── */
function useDisplayMode() {
    const [mode, setMode] = useState('auto');
    useEffect(() => {
        const sync = () => {
            const a = document.documentElement.getAttribute('data-display');
            if (a === 'auto' || a === 'pc' || a === 'tv')
                setMode(a);
        };
        const mo = new MutationObserver(sync);
        mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-display'] });
        sync();
        return () => mo.disconnect();
    }, []);
    const set = (m) => {
        window.dispatchEvent(new CustomEvent('display-mode-change', { detail: m }));
    };
    return [mode, set];
}
/* ─────────────────────────────────────────────────────────────────────────────
 * UI Bits: Switch
 * ──────────────────────────────────────────────────────────────────────────── */
const IOSwitch = ({ checked, onChange, disabled, }) => (<button type="button" aria-pressed={checked} disabled={disabled} onClick={() => !disabled && onChange(!checked)} className={clsx('relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200', checked ? 'bg-emerald-500' : 'bg-slate-300', disabled && 'opacity-50 cursor-not-allowed')}>
    <span className={clsx('inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform duration-200', checked ? 'translate-x-5' : 'translate-x-1')}/>
  </button>);
const SHEET_SPRING = { type: 'spring', stiffness: 520, damping: 42, mass: 0.9 };
const BACKDROP_SPRING = { type: 'spring', stiffness: 280, damping: 28 };
const headerSpring = { type: 'spring', stiffness: 520, damping: 40 };
const sheetCard = 'bg-white/80 dark:bg-slate-900/70 backdrop-blur-2xl ring-1 ring-white/60 dark:ring-white/10 shadow-[0_24px_60px_rgba(2,6,23,0.18)]';
/* ─────────────────────────────────────────────────────────────────────────────
 * BottomSheet (mobile)
 * ──────────────────────────────────────────────────────────────────────────── */
const BottomSheet = ({ isOpen, onClose, title, size = 'lg', fullscreen = false, children }) => {
    useEffect(() => {
        if (!isOpen)
            return;
        const onKey = (e) => e.key === 'Escape' && onClose();
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [isOpen, onClose]);
    useEffect(() => {
        if (!isOpen)
            return;
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = prev; };
    }, [isOpen]);
    const heightClass = fullscreen
        ? 'h-[100svh]'
        : size === 'xl'
            ? 'h-[90svh]'
            : size === 'lg'
                ? 'h-[75svh]'
                : 'h-[60svh]';
    const handleDragEnd = (_, info) => {
        if (info.offset.y > 120 || info.velocity.y > 800)
            onClose();
    };
    return (<AnimatePresence>
      {isOpen && (<>
          <m.div key="backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={BACKDROP_SPRING} onClick={onClose} className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-md md:backdrop-blur-lg saturate-125"/>
          <m.div key="sheet" role="dialog" aria-modal="true" aria-label={title ?? 'Bottom Sheet'} initial={{ y: fullscreen ? 0 : '100%' }} animate={{ y: 0 }} exit={{ y: fullscreen ? 0 : '100%' }} transition={SHEET_SPRING} drag={fullscreen ? false : 'y'} dragElastic={0.18} dragConstraints={{ top: 0, bottom: 0 }} onDragEnd={handleDragEnd} className={clsx('fixed inset-x-0 z-[80] flex flex-col bg-white text-slate-900 shadow-2xl', fullscreen
                ? 'inset-0 rounded-none'
                : `bottom-0 ${heightClass} rounded-t-[28px] sm:left-1/2 sm:right-auto sm:bottom-6 sm:-translate-x-1/2 sm:w-[560px] sm:rounded-3xl`)} style={{ paddingBottom: fullscreen ? undefined : 'max(env(safe-area-inset-bottom), 12px)' }}>
            {!fullscreen && <div className="mx-auto mt-2 h-1.5 w-12 rounded-full bg-slate-200"/>}

            <div className="relative px-4 py-3">
              {title && (<div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[15px] font-semibold tracking-wide">
                  {title}
                </div>)}

              <button onClick={onClose} aria-label="Close" className="absolute right-4 top-1/35 -translate-y-1/2 inline-flex h-8 w-8 items-center justify-center rounded-full ring-1 ring-slate-200 hover:bg-slate-100 active:scale-95">
                <XMarkIcon className="h-5 w-5 text-slate-600"/>
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
              {children}
            </div>
          </m.div>
        </>)}
    </AnimatePresence>);
};
/* ─────────────────────────────────────────────────────────────────────────────
 * Desktop anchored popover + spotlight backdrop
 * ──────────────────────────────────────────────────────────────────────────── */
function useIsDesktop() {
    const [isDesk, set] = useState(false);
    useEffect(() => {
        const m = window.matchMedia('(min-width: 768px)');
        const on = () => set(m.matches);
        on();
        m.addEventListener('change', on);
        return () => m.removeEventListener('change', on);
    }, []);
    return isDesk;
}
function useAnchorRect(open, anchorRef) {
    const [rect, setRect] = useState(null);
    useEffect(() => {
        if (!open)
            return;
        const calc = () => {
            const el = anchorRef.current;
            if (!el)
                return setRect(null);
            const r = el.getBoundingClientRect();
            setRect(r);
        };
        calc();
        window.addEventListener('resize', calc);
        window.addEventListener('scroll', calc, true);
        (window.visualViewport ?? window).addEventListener?.('resize', calc);
        return () => {
            window.removeEventListener('resize', calc);
            window.removeEventListener('scroll', calc, true);
            (window.visualViewport ?? window).removeEventListener?.('resize', calc);
        };
    }, [open, anchorRef]);
    return rect;
}
const SpotHighlightBackdrop = ({ rect, onClick, pad = 6, radius = 14 }) => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const top = Math.max(0, Math.round(rect.top - pad));
    const left = Math.max(0, Math.round(rect.left - pad));
    const width = Math.min(vw - left, Math.round(rect.width + pad * 2));
    const height = Math.min(vh - top, Math.round(rect.height + pad * 2));
    const backdropCls = 'bg-black/60 backdrop-blur-md md:backdrop-blur-lg saturate-125';
    return (<>
      <div onClick={onClick} className={`fixed inset-0 z-[70] ${backdropCls}`}/>
      <m.div className="pointer-events-none fixed z-[95]" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }} transition={{ type: 'spring', stiffness: 520, damping: 42, mass: 0.9 }} style={{
            top, left, width, height,
            borderRadius: radius,
            boxShadow: `0 0 0 2px rgba(59,130,246,1), 0 0 0 8px rgba(59,130,246,0.25)`,
        }}/>
    </>);
};
const AnchoredPopover = ({ isOpen, onClose, title, anchorRef, width = 560, children }) => {
    const rect = useAnchorRect(isOpen, anchorRef);
    const [coords, setCoords] = useState({ top: 100, left: 100, w: Math.min(560, (typeof window !== 'undefined' ? window.innerWidth : 560) - 24) });
    useEffect(() => {
        if (!isOpen)
            return;
        const update = () => {
            const vw = window.innerWidth;
            const maxW = Math.min(width, vw - 24);
            if (rect) {
                const top = Math.round(rect.bottom + 10);
                const left = Math.round(Math.max(12, Math.min(vw - maxW - 12, rect.left + rect.width / 2 - maxW / 2)));
                setCoords({ top, left, w: maxW });
            }
            else {
                setCoords({ top: 100, left: (vw - maxW) / 2, w: maxW });
            }
        };
        update();
    }, [rect, isOpen, width]);
    useEffect(() => {
        if (!isOpen)
            return;
        const onKey = (e) => e.key === 'Escape' && onClose();
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [isOpen, onClose]);
    return (<AnimatePresence>
      {isOpen && rect && (<>
          <SpotHighlightBackdrop rect={rect} onClick={onClose}/>
          <m.div key="panel" role="dialog" aria-modal="true" initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.98 }} transition={SHEET_SPRING} className="fixed z-[90] overflow-hidden rounded-2xl bg-white text-slate-900 shadow-2xl ring-1 ring-white/10" style={{ top: coords.top, left: coords.left, width: coords.w }}>
            <div className="relative flex items-center justify-between px-4 py-3">
              {title && (<div className="text-[15px] font-semibold tracking-wide text-slate-900">
                  {title}
                </div>)}
              <button onClick={onClose} aria-label="Close" className="absolute right-4 top-[calc(50%+2px)] -translate-y-1/2 inline-flex h-8 w-8 items-center justify-center rounded-full ring-1 ring-slate-200 hover:bg-slate-100 active:scale-95">
                <XMarkIcon className="h-5 w-5 text-slate-600"/>
              </button>
            </div>
            <div className="max-h-[70vh] overflow-auto px-4 pb-4">{children}</div>
          </m.div>
        </>)}
    </AnimatePresence>);
};
/* Desktop fullscreen overlay for Create dialog */
const DesktopFullscreenOverlay = ({ isOpen, onClose, title, children }) => (<AnimatePresence>
    {isOpen && (<>
        <m.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={BACKDROP_SPRING} onClick={onClose} className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-md md:backdrop-blur-lg saturate-125"/>
        <m.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={SHEET_SPRING} className="fixed inset-0 z-[80] flex items-start justify-center p-6">
          <div role="dialog" aria-modal="true" aria-label={title ?? 'Dialog'} className="w-full max-w-3xl overflow-hidden rounded-2xl bg-white text-slate-900 shadow-2xl ring-1 ring-white/10">
            <div className="grid grid-cols-[1fr_auto_1fr] items-center px-4 py-3">
              <div className="h-8 w-8"/>
              {title && (<div className="justify-self-center text-[15px] font-semibold tracking-wide">
                  {title}
                </div>)}
              <button onClick={onClose} aria-label="Close" className="justify-self-end inline-flex h-8 w-8 items-center justify-center rounded-full ring-1 ring-slate-200 hover:bg-slate-100 active:scale-95">
                <XMarkIcon className="h-5 w-5 text-slate-600"/>
              </button>
            </div>
            <div className="max-h-[calc(100vh-6rem)] overflow-auto px-4 pb-4">
              {children}
            </div>
          </div>
        </m.div>
      </>)}
  </AnimatePresence>);
/* ─────────────────────────────────────────────────────────────────────────────
 * AdaptiveSheet
 * ──────────────────────────────────────────────────────────────────────────── */
const AdaptiveSheet = ({ isOpen, onClose, title, anchorRef, mobileSize = 'lg', mobileFullscreen = false, width = 560, desktopFullscreen = false, children }) => {
    const isDesktop = useIsDesktop();
    if (typeof window === 'undefined')
        return null;
    return isDesktop ? (desktopFullscreen ? (<DesktopFullscreenOverlay isOpen={isOpen} onClose={onClose} title={title}>
        {children}
      </DesktopFullscreenOverlay>) : (<AnchoredPopover isOpen={isOpen} onClose={onClose} title={title} anchorRef={anchorRef} width={width}>
        {children}
      </AnchoredPopover>)) : (<BottomSheet isOpen={isOpen} onClose={onClose} title={title} size={mobileSize} fullscreen={mobileFullscreen}>
      {children}
    </BottomSheet>);
};
/* ─────────────────────────────────────────────────────────────────────────────
 * Picker List (used inside sheets)
 * ──────────────────────────────────────────────────────────────────────────── */
const PickerList = ({ options, selected, onSelect, placeholder }) => {
    const [q, setQ] = useState('');
    const list = useMemo(() => {
        const s = q.trim().toLowerCase();
        if (!s)
            return options;
        return options.filter(o => o.toLowerCase().includes(s));
    }, [q, options]);
    return (<div className="mx-auto w-full max-w-xl space-y-4">
      <div className="-mx-4 sticky top-0 z-10 bg-white/90 backdrop-blur px-4 pb-3 pt-2">
        <div className="flex items-center gap-3 rounded-full bg-white px-4 py-2.5 shadow-md ring-1 ring-slate-200 focus-within:ring-2 focus-within:ring-blue-400 focus-within:ring-offset-2 focus-within:ring-offset-white">
          <MagnifyingGlassIcon className="h-5 w-5 shrink-0 text-slate-500"/>
          <input placeholder={placeholder ?? 'Search'} value={q} onChange={e => setQ(e.target.value)} className="w-full appearance-none rounded-full bg-transparent text-[16px] lg:text-[17px] outline-none placeholder:text-slate-400"/>
          {q && (<button onClick={() => setQ('')} className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-200/80 active:scale-95" aria-label="Clear">
              <XMarkIcon className="h-4 w-4 text-slate-700"/>
            </button>)}
        </div>
      </div>

      <ul className="rounded-3xl bg-white ring-1 ring-black/5 shadow-sm p-2 isolate">
        {list.map((opt, idx) => {
            const isSel = selected?.toLowerCase() === opt.toLowerCase();
            const isLast = idx === list.length - 1;
            return (<li key={`${opt}-${idx}`} className="relative">
              <button onClick={() => onSelect(opt)} className="group relative flex w-full items-center rounded-2xl px-4 py-4 pr-12 text-left text-[16px] leading-tight transition ring-1 ring-transparent hover:ring-2 hover:ring-blue-400 hover:ring-offset-2 hover:ring-offset-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white hover:z-10 focus-visible:z-10" aria-selected={isSel} role="option">
                <span className="truncate font-semibold text-slate-900">{opt}</span>
                <AnimatePresence initial={false}>
                  {isSel && (<m.span key="tick" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }} transition={SHEET_SPRING} className="absolute right-4 top-1/35 -translate-y-1/2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500 text-white ring-1 ring-emerald-300/60">
                      <CheckIcon className="h-4 w-4"/>
                    </m.span>)}
                </AnimatePresence>
              </button>

              {!isLast && (<div className="pointer-events-none absolute bottom-0 left-3 right-3 h-px bg-slate-200/80 transition-opacity group-hover:opacity-0"/>)}
            </li>);
        })}

        {list.length === 0 && (<li className="px-4 py-8 text-center text-sm text-slate-500">No matches</li>)}
      </ul>
    </div>);
};
const CreateBranchPanel = ({ isOpen, onClose, initialName, usedPins, onCreate, anchorRef }) => {
    const [name, setName] = useState(initialName ?? '');
    const [pin, setPin] = useState(null);
    const [loose, setLoose] = useState(false);
    const [notTested, setNotTested] = useState(false);
    const [saving, setSaving] = useState(false);
    useEffect(() => setName(initialName ?? ''), [initialName]);
    const takenPins = useMemo(() => new Set(usedPins ?? []), [usedPins]);
    const MIN_PIN = 1;
    const MAX_PIN = 40;
    const clamp = (n) => Math.max(MIN_PIN, Math.min(MAX_PIN, n));
    const isPinTaken = pin != null && takenPins.has(pin);
    const canSubmit = name.trim().length > 0 && !isPinTaken;
    const submit = async () => {
        if (!canSubmit || saving)
            return;
        setSaving(true);
        try {
            await onCreate({ name: name.trim(), pinNumber: pin, loose, not: notTested });
            onClose();
            setName('');
            setPin(null);
            setLoose(false);
            setNotTested(false);
        }
        finally {
            setSaving(false);
        }
    };
    return (<AdaptiveSheet isOpen={isOpen} onClose={onClose} title="Create Branch" anchorRef={anchorRef} mobileSize="xl" mobileFullscreen desktopFullscreen width={560}>
      <div className="mx-auto w-full max-w-xl space-y-6 text-slate-900">
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700">Branch name</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. CL_3001" className="w-full rounded-xl bg-slate-50 px-4 py-3 text-[15px] text-slate-900 placeholder:text-slate-400 outline-none ring-1 ring-slate-200 focus:bg-white focus:ring-2 focus:ring-emerald-400/60 transition"/>
          </div>

          {/* Assign PIN (optional) */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700">Assign PIN (optional)</label>
            <div className="flex items-center gap-2">
              <input type="number" inputMode="numeric" min={MIN_PIN} max={MAX_PIN} step={1} placeholder="1–40" value={pin ?? ''} onChange={e => {
            const v = e.target.value;
            if (v === '')
                return setPin(null);
            const n = clamp(parseInt(v, 10));
            setPin(Number.isNaN(n) ? null : n);
        }} aria-invalid={isPinTaken} className={clsx("w-28 rounded-xl bg-slate-50 px-3 py-2.5 text-[15px] text-slate-900 placeholder:text-slate-400 outline-none ring-1 transition", isPinTaken
            ? "ring-red-300 focus:ring-2 focus:ring-red-400/70"
            : "ring-slate-200 focus:bg-white focus:ring-2 focus:ring-emerald-400/60")}/>
              <div className="flex items-center gap-1.5">
                <button type="button" onClick={() => setPin(p => (p == null ? MIN_PIN : clamp(p - 1)))} className="rounded-xl bg-white px-3 py-2 text-sm ring-1 ring-slate-200 hover:bg-slate-50 active:scale-95">−</button>
                <button type="button" onClick={() => setPin(p => (p == null ? MIN_PIN : clamp(p + 1)))} className="rounded-xl bg-white px-3 py-2 text-sm ring-1 ring-slate-200 hover:bg-slate-50 active:scale-95">+</button>
                {pin != null && (<button type="button" onClick={() => setPin(null)} className="ml-1 rounded-xl bg-white px-3 py-2 text-sm ring-1 ring-slate-200 hover:bg-slate-50 active:scale-95">Clear</button>)}
              </div>
            </div>
            {isPinTaken
            ? <p className="text-xs text-red-600">This PIN is already in use. Choose another.</p>
            : <p className="text-xs text-slate-500">Any value from {MIN_PIN} to {MAX_PIN}. Example: 39 or 40.</p>}

            {/* Always show used pins */}
            {usedPins.length > 0 && (<div className="mt-1.5 flex flex-wrap items-center gap-1.5" aria-live="polite">
                <span className="text-xs text-slate-500 mr-1">Pins in use:</span>
                {usedPins.map(n => (<code key={n} className={clsx("rounded-lg px-2 py-0.5 text-[12px] ring-1", isPinTaken && pin === n
                    ? "bg-red-100 ring-red-300 text-red-700"
                    : "bg-slate-100 ring-slate-200 text-slate-700")} title={`PIN ${n} is taken`}>
                    {n}
                  </code>))}
              </div>)}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex items-center justify-between rounded-xl bg-white px-4 py-3 ring-1 ring-slate-200">
            <span className="text-sm text-slate-700">Loose contact</span>
            <IOSwitch checked={loose} onChange={setLoose}/>
          </div>
          <div className="flex items-center justify-between rounded-xl bg-white px-4 py-3 ring-1 ring-slate-200">
            <span className="text-sm text-slate-700">Not tested</span>
            <IOSwitch checked={notTested} onChange={setNotTested}/>
          </div>
        </div>

        <div className="pt-2">
          <button onClick={submit} disabled={!canSubmit || saving} className={clsx("w-full rounded-xl px-4 py-3 text-[15px] font-semibold active:scale-[0.99] transition", canSubmit && !saving
            ? "bg-emerald-500 text-white hover:bg-emerald-600 shadow-[0_6px_20px_-8px_rgba(16,185,129,0.55)]"
            : "bg-slate-100 text-slate-400")}>
            {saving ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </AdaptiveSheet>);
};
/* ─────────────────────────────────────────────────────────────────────────────
 * Main Page
 * ──────────────────────────────────────────────────────────────────────────── */
const SettingsBranchesPageContent = ({ onNavigateBack = () => (typeof window !== 'undefined' ? window.history.back() : undefined), configId = null }) => {
    // STATE
    const [configs, setConfigs] = useState([]);
    const [selectedConfig, setSelectedConfig] = useState(null);
    const [loadingConfigs, setLoadingConfigs] = useState(true);
    const [selectedKfbInfo, setSelectedKfbInfo] = useState(null);
    const [kfbInfoDetails, setKfbInfoDetails] = useState([]);
    const [unifiedInput, setUnifiedInput] = useState('');
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [isSearchFocused, setIsSearchFocused] = useState(false); // spotlight toggle
    const [allBranches, setAllBranches] = useState([]);
    const [linkedBranches, setLinkedBranches] = useState([]);
    const [loadingBranches, setLoadingBranches] = useState(false);
    const [pinMap, setPinMap] = useState({});
    const [loadingPinMap, setLoadingPinMap] = useState({});
    const [newPinInputs, setNewPinInputs] = useState({});
    const [notTestedMap, setNotTestedMap] = useState({});
    const [looseContactMap, setLooseContactMap] = useState({});
    const [editingBranchId, setEditingBranchId] = useState(null);
    const [editBranchInputs, setEditBranchInputs] = useState({});
    const [error, setError] = useState(null);
    const [refreshKey, setRefreshKey] = useState(0);
    const [confirmDeleteId, setConfirmDeleteId] = useState(null);
    // UI state
    const [sortKey, setSortKey] = useState('index');
    const [sortDir, setSortDir] = useState('asc');
    const [dense, setDense] = useState(false);
    // Sheets
    const [showKfbSheet, setShowKfbSheet] = useState(false);
    const [showInfoSheet, setShowInfoSheet] = useState(false);
    const [showCreateSheet, setShowCreateSheet] = useState(false);
    const [createDraftName, setCreateDraftName] = useState('');
    // ANCHORS
    const kfbBtnRef = useRef(null);
    const infoBtnRef = useRef(null);
    const searchContainerRef = useRef(null);
    // Display mode
    const [displayMode] = useDisplayMode();
    // EFFECTS: configs
    useEffect(() => {
        setLoadingConfigs(true);
        setError(null);
        fetchJSON('/api/configurations')
            .then(data => setConfigs(data))
            .catch(err => setError(`Failed to load configurations: ${err.message}`))
            .finally(() => setLoadingConfigs(false));
    }, []);
    useEffect(() => {
        if (!loadingConfigs && configId !== null) {
            const found = configs.find(c => c.id === configId) ?? null;
            setSelectedConfig(found);
            setSelectedKfbInfo(null);
            setLinkedBranches([]);
            setPinMap({});
            setNotTestedMap({});
            setLooseContactMap({});
            setUnifiedInput('');
            setEditingBranchId(null);
        }
    }, [configs, loadingConfigs, configId]);
    // EFFECTS: KFB info list for selected config
    useEffect(() => {
        if (!selectedConfig) {
            setKfbInfoDetails([]);
            return;
        }
        setError(null);
        fetchJSON(`/api/kfb_info_details?configId=${selectedConfig.id}`)
            .then(rows => setKfbInfoDetails(rows))
            .catch(err => setError(`Failed to load KFB info details: ${err.message}`));
    }, [selectedConfig]);
    // EFFECTS: all branches for suggestions
    useEffect(() => {
        if (!selectedConfig) {
            setAllBranches([]);
            return;
        }
        setError(null);
        fetchJSON(`/api/branches?kfb=${selectedConfig.kfb}`)
            .then(data => {
            const adapted = data.map(b => ({ id: Number(b.id), name: b.branchName }));
            setAllBranches(adapted);
        })
            .catch(err => setError(`Failed to load branch list: ${err.message}`));
    }, [selectedConfig]);
    // EFFECTS: linked branches + pin map when info changes
    useEffect(() => {
        if (!selectedConfig || !selectedKfbInfo) {
            setLinkedBranches([]);
            setPinMap({});
            setNotTestedMap({});
            setLooseContactMap({});
            return;
        }
        const detail = kfbInfoDetails.find(d => d.kfb_info_value === selectedKfbInfo);
        if (!detail)
            return;
        setLoadingBranches(true);
        setError(null);
        const run = async () => {
            try {
                const configBranchRows = await fetchJSON(`/api/config_branches?configId=${selectedConfig.id}&detailId=${detail.id}`);
                const notMap = {};
                const branchIds = configBranchRows.map(r => {
                    notMap[r.branch_id] = r.not_tested ?? false;
                    return r.branch_id;
                });
                setNotTestedMap(notMap);
                if (branchIds.length === 0) {
                    setLinkedBranches([]);
                    setPinMap({});
                    setLooseContactMap({});
                    setLoadingBranches(false);
                    return;
                }
                const linked = await fetchJSON(`/api/branches?ids=${branchIds.join(',')}`);
                const adaptedLinked = linked.map(b => ({ id: Number(b.id), name: b.branchName }));
                const uniqueLinked = Array.from(new Map(adaptedLinked.map(b => [b.id, b])).values());
                setLinkedBranches(uniqueLinked);
                const loose = {};
                linked.forEach(b => { loose[Number(b.id)] = !!b.looseContact; });
                setLooseContactMap(loose);
                const pinRows = await fetchJSON(`/api/esp_pin_mappings?detailId=${detail.id}`);
                const newPinMap = {};
                uniqueLinked.forEach(b => (newPinMap[b.id] = null));
                pinRows.forEach(r => { newPinMap[r.branch_id] = r.pin_number; });
                setPinMap(newPinMap);
            }
            catch (err) {
                setError(`Failed to load branch data: ${err.message}`);
                setLinkedBranches([]);
                setPinMap({});
                setNotTestedMap({});
                setLooseContactMap({});
            }
            finally {
                setLoadingBranches(false);
            }
        };
        run();
    }, [selectedConfig, selectedKfbInfo, kfbInfoDetails, refreshKey]);
    // Suggestions & filters
    const linkedIds = useMemo(() => new Set(linkedBranches.map(b => b.id)), [linkedBranches]);
    const suggestionsAllMatches = useMemo(() => {
        const term = unifiedInput.trim().toLowerCase();
        if (!term || !selectedConfig || !selectedKfbInfo)
            return [];
        return allBranches.filter(b => b.name.toLowerCase().includes(term));
    }, [allBranches, unifiedInput, selectedConfig, selectedKfbInfo]);
    const suggestionsUnlinked = useMemo(() => suggestionsAllMatches.filter(b => !linkedIds.has(b.id)).slice(0, 8), [suggestionsAllMatches, linkedIds]);
    const exactMatchInAll = useMemo(() => {
        const term = unifiedInput.trim().toLowerCase();
        if (!term)
            return null;
        return allBranches.find(b => b.name.toLowerCase() === term) ?? null;
    }, [unifiedInput, allBranches]);
    const filteredLinkedBranches = useMemo(() => {
        const term = unifiedInput.trim().toLowerCase();
        if (!term)
            return linkedBranches;
        return linkedBranches.filter(b => b.name.toLowerCase().includes(term));
    }, [linkedBranches, unifiedInput]);
    const areAllNotTested = useMemo(() => {
        if (filteredLinkedBranches.length === 0)
            return false;
        return filteredLinkedBranches.every(b => notTestedMap[b.id]);
    }, [filteredLinkedBranches, notTestedMap]);
    const displayRows = useMemo(() => {
        const rows = filteredLinkedBranches.map((b, idx) => ({
            index: idx + 1,
            id: b.id,
            name: b.name,
            pin: pinMap[b.id] ?? null,
            not: !!notTestedMap[b.id],
            loose: !!looseContactMap[b.id],
        }));
        const dir = sortDir === 'asc' ? 1 : -1;
        rows.sort((a, b) => {
            switch (sortKey) {
                case 'name': return a.name.localeCompare(b.name) * dir;
                case 'pin': return ((a.pin ?? Number.POSITIVE_INFINITY) - (b.pin ?? Number.POSITIVE_INFINITY)) * dir;
                case 'not': return (Number(a.not) - Number(b.not)) * dir;
                case 'loose': return (Number(a.loose) - Number(b.loose)) * dir;
                default: return (a.index - b.index) * dir;
            }
        });
        return rows;
    }, [filteredLinkedBranches, pinMap, notTestedMap, looseContactMap, sortKey, sortDir]);
    const triggerRefresh = () => setRefreshKey(k => k + 1);
    // SELECTION handlers
    const handleSelectConfig = useCallback((id) => {
        const c = configs.find(x => x.id === id) ?? null;
        setSelectedConfig(c);
        setSelectedKfbInfo(null);
        setLinkedBranches([]);
        setUnifiedInput('');
    }, [configs]);
    const handleSelectKfbInfo = useCallback((val) => {
        setSelectedKfbInfo(val);
        setUnifiedInput('');
    }, []);
    // Toggles
    const handleToggleNotTested = useCallback(async (branchId) => {
        const detail = kfbInfoDetails.find(d => d.kfb_info_value === selectedKfbInfo);
        if (!detail)
            return;
        const oldState = notTestedMap[branchId] || false;
        const newState = !oldState;
        setNotTestedMap(m => ({ ...m, [branchId]: newState }));
        try {
            await fetchJSON(`/api/config_branches/${detail.id}/${branchId}`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ not_tested: newState }),
            });
        }
        catch (err) {
            setError(err.message);
            setNotTestedMap(m => ({ ...m, [branchId]: oldState }));
        }
    }, [selectedKfbInfo, kfbInfoDetails, notTestedMap]);
    const handleToggleAllNotTested = useCallback(async () => {
        const detail = kfbInfoDetails.find(d => d.kfb_info_value === selectedKfbInfo);
        if (!detail || filteredLinkedBranches.length === 0)
            return;
        const newGlobal = filteredLinkedBranches.some(b => !notTestedMap[b.id]);
        const originalMap = { ...notTestedMap };
        const next = { ...notTestedMap };
        filteredLinkedBranches.forEach(b => { next[b.id] = newGlobal; });
        setNotTestedMap(next);
        try {
            await Promise.all(filteredLinkedBranches.map(b => fetchJSON(`/api/config_branches/${detail.id}/${b.id}`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ not_tested: newGlobal }),
            })));
        }
        catch (err) {
            setError(`Failed to update all branches: ${err.message}. Reverting.`);
            setNotTestedMap(originalMap);
        }
    }, [filteredLinkedBranches, notTestedMap, kfbInfoDetails, selectedKfbInfo]);
    const handleToggleLooseContact = useCallback(async (branchId) => {
        const detail = kfbInfoDetails.find(d => d.kfb_info_value === selectedKfbInfo);
        if (!detail)
            return;
        const oldLoose = looseContactMap[branchId];
        const newLoose = !oldLoose;
        const currentNot = notTestedMap[branchId] ?? false;
        setLooseContactMap(m => ({ ...m, [branchId]: newLoose }));
        try {
            await fetchJSON(`/api/config_branches/${detail.id}/${branchId}`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ loose_contact: newLoose, not_tested: currentNot }),
            });
        }
        catch (err) {
            setError(err.message);
            setLooseContactMap(m => ({ ...m, [branchId]: oldLoose }));
        }
    }, [looseContactMap, notTestedMap, kfbInfoDetails, selectedKfbInfo]);
    const handleToggleAllLooseContact = useCallback(async () => {
        const detail = kfbInfoDetails.find(d => d.kfb_info_value === selectedKfbInfo);
        if (!detail || filteredLinkedBranches.length === 0)
            return;
        const newLoose = filteredLinkedBranches.some(b => !looseContactMap[b.id]);
        const origLoose = { ...looseContactMap };
        setLooseContactMap(m => {
            filteredLinkedBranches.forEach(b => (m[b.id] = newLoose));
            return { ...m };
        });
        try {
            await Promise.all(filteredLinkedBranches.map(b => fetchJSON(`/api/config_branches/${detail.id}/${b.id}`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ loose_contact: newLoose, not_tested: notTestedMap[b.id] ?? false }),
            })));
        }
        catch (err) {
            setError(`Failed to update loose-contact: ${err.message}`);
            setLooseContactMap(origLoose);
        }
    }, [filteredLinkedBranches, looseContactMap, notTestedMap, kfbInfoDetails, selectedKfbInfo]);
    // Rename
    const handleEditBranch = useCallback((b) => {
        setEditingBranchId(b.id);
        setEditBranchInputs(m => ({ ...m, [b.id]: b.name }));
    }, []);
    const handleSaveBranchName = useCallback(async (branchId) => {
        const newName = (editBranchInputs[branchId] ?? '').trim();
        if (!newName) {
            setEditingBranchId(null);
            return;
        }
        const old = linkedBranches.find(b => b.id === branchId)?.name;
        if (newName === old) {
            setEditingBranchId(null);
            return;
        }
        try {
            await fetchJSON(`/api/branches/${branchId}`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newName }),
            });
            setLinkedBranches(list => list.map(b => (b.id === branchId ? { ...b, name: newName } : b)));
            setEditingBranchId(null);
        }
        catch (err) {
            setError(`Rename failed: ${err.message}`);
        }
    }, [editBranchInputs, linkedBranches]);
    // Link / Create
    const linkExistingBranch = async (b) => {
        const detail = kfbInfoDetails.find(d => d.kfb_info_value === selectedKfbInfo);
        if (!selectedConfig || !detail)
            return setError('A KFB and Info must be selected.');
        if (linkedBranches.some(x => x.id === b.id))
            return;
        try {
            await fetchJSON('/api/config_branches', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ config_id: selectedConfig.id, kfb_info_detail_id: detail.id, branch_id: b.id }),
            });
            setUnifiedInput('');
            setShowSuggestions(false);
            triggerRefresh();
        }
        catch (err) {
            setError(`Failed to link branch: ${err.message}`);
        }
    };
    const createBranchViaSheet = () => {
        const name = unifiedInput.trim();
        if (!name)
            return setError('Branch name cannot be empty.');
        if (allBranches.some(b => b.name.toLowerCase() === name.toLowerCase())) {
            return setError('A branch with this name already exists.');
        }
        setCreateDraftName(name);
        setShowCreateSheet(true);
    };
    const handleCreateDraft = async (draft) => {
        const detail = kfbInfoDetails.find(d => d.kfb_info_value === selectedKfbInfo);
        if (!selectedConfig || !detail)
            throw new Error('Selection missing');
        const newBranchData = await fetchJSON('/api/branches', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: draft.name }),
        });
        const newBranch = { id: Number(newBranchData.id), name: newBranchData.branchName };
        setAllBranches(a => [...a, newBranch]);
        await fetchJSON('/api/config_branches', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ config_id: selectedConfig.id, kfb_info_detail_id: detail.id, branch_id: newBranch.id }),
        });
        if (draft.pinNumber != null) {
            if (Object.values(pinMap).includes(draft.pinNumber)) {
                throw new Error('PIN already in use.');
            }
            await fetchJSON('/api/esp_pin_mappings', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ config_id: selectedConfig.id, kfb_info_detail_id: detail.id, branch_id: newBranch.id, pin_number: draft.pinNumber }),
            });
        }
        if (draft.loose || draft.not) {
            await fetchJSON(`/api/config_branches/${detail.id}/${newBranch.id}`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ loose_contact: draft.loose, not_tested: draft.not }),
            });
        }
        setUnifiedInput('');
        setShowSuggestions(false);
        triggerRefresh();
    };
    const usedPins = useMemo(() => {
        const nums = Object.values(pinMap).filter((n) => typeof n === 'number');
        return Array.from(new Set(nums)).sort((a, b) => a - b);
    }, [pinMap]);
    const handleAddPin = useCallback(async (branchId) => {
        const detail = kfbInfoDetails.find(d => d.kfb_info_value === selectedKfbInfo);
        if (!detail || !selectedConfig)
            return;
        const raw = (newPinInputs[branchId] ?? '').trim();
        if (!/^\d+$/.test(raw))
            return setError('PIN must be a number.');
        const n = Math.max(1, Math.min(40, parseInt(raw, 10)));
        if (usedPins.includes(n))
            return setError(`PIN ${n} is already in use.`);
        setLoadingPinMap(m => ({ ...m, [branchId]: true }));
        try {
            await fetchJSON('/api/esp_pin_mappings', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ config_id: selectedConfig.id, kfb_info_detail_id: detail.id, branch_id: branchId, pin_number: n }),
            });
            setPinMap(m => ({ ...m, [branchId]: n }));
            setNewPinInputs(m => ({ ...m, [branchId]: '' }));
        }
        catch (err) {
            setError(`Failed to add PIN: ${err.message}`);
        }
        finally {
            setLoadingPinMap(m => ({ ...m, [branchId]: false }));
        }
    }, [newPinInputs, kfbInfoDetails, selectedKfbInfo, selectedConfig, usedPins]);
    const handleDeletePin = useCallback(async (branchId) => {
        const detail = kfbInfoDetails.find(d => d.kfb_info_value === selectedKfbInfo);
        if (!detail)
            return;
        setLoadingPinMap(m => ({ ...m, [branchId]: true }));
        try {
            await fetchJSON(`/api/esp_pin_mappings/${detail.id}/${branchId}`, { method: 'DELETE' });
            setPinMap(m => ({ ...m, [branchId]: null }));
        }
        catch (err) {
            setError(`Failed to remove PIN: ${err.message}`);
        }
        finally {
            setLoadingPinMap(m => ({ ...m, [branchId]: false }));
        }
    }, [kfbInfoDetails, selectedKfbInfo]);
    const handleUnlinkBranch = useCallback(async (branchId) => {
        const detail = kfbInfoDetails.find(d => d.kfb_info_value === selectedKfbInfo);
        if (!detail)
            return;
        try {
            await fetchJSON(`/api/config_branches/${detail.id}/${branchId}`, { method: 'DELETE' });
            setConfirmDeleteId(null);
            triggerRefresh();
        }
        catch (err) {
            setError(`Failed to unlink branch: ${err.message}`);
        }
    }, [kfbInfoDetails, selectedKfbInfo]);
    useEffect(() => {
        const onDocClick = (e) => {
            if (searchContainerRef.current && !searchContainerRef.current.contains(e.target)) {
                setShowSuggestions(false);
                setIsSearchFocused(false);
            }
        };
        document.addEventListener('mousedown', onDocClick);
        return () => document.removeEventListener('mousedown', onDocClick);
    }, []);
    // Spotlight logic
    const term = unifiedInput.trim().toLowerCase();
    const hasAnyMatch = term ? allBranches.some(b => b.name.toLowerCase().includes(term)) : false;
    const showCreateCTA = Boolean(term) && !hasAnyMatch; // only when totally new (no partial matches)
    // RENDER
    if (loadingConfigs) {
        return (<div className="flex h-screen items-center justify-center bg-gradient-to-b from-slate-50 to-slate-100 text-gray-800">
        <ArrowPathIcon className="mr-3 h-6 w-6 animate-spin text-slate-500"/>
        <p className="text-[15px] font-medium">Loading configurations…</p>
      </div>);
    }
    const headerCell = 'px-3 py-2 text-[12px] md:text-[13px] font-semibold text-slate-700 bg-slate-50/95 backdrop-blur border-b border-slate-200 sticky top-0 z-10';
    const cellBase = clsx('px-3', dense ? 'py-2' : 'py-3', 'text-[14px] bg-white border-b border-slate-200');
    const SortIcon = ({ active }) => active
        ? (sortDir === 'asc'
            ? <ArrowUpIcon className="ml-1 h-3.5 w-3.5 opacity-70"/>
            : <ArrowDownIcon className="ml-1 h-3.5 w-3.5 opacity-70"/>)
        : <span className="ml-1 inline-block w-3.5"/>;
    const clickSort = (key) => {
        if (sortKey === key)
            setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
        else {
            setSortKey(key);
            setSortDir('asc');
        }
    };
    const isSpotlightOn = isSearchFocused || showSuggestions || Boolean(term);
    return (<div className="flex min-h-screen w-screen flex-col bg-gradient-to-b from-slate-50 to-slate-100 text-slate-900">

  {/* Header */}
       <m.header initial={{ y: -8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={headerSpring} className={`sticky top-0 z-30 ${sheetCard} rounded-2xl px-4 sm:px-5 py-3 mb-4`}>
   {/* Left: back */}
 <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
   {/* left: back */}
   <div className="justify-self-start">
     {onNavigateBack && (<button onClick={onNavigateBack} className="inline-flex items-center gap-2 rounded-full bg-white/90 dark:bg-slate-800/70 px-4 py-2 text-[15px] font-semibold text-slate-800 dark:text-slate-100 ring-1 ring-slate-200 dark:ring-white/10 hover:bg-white shadow-sm active:scale-[0.99]">
         <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
           <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/>
         </svg>
         GO BACK TO MAIN
       </button>)}
   </div>
 
   {/* center: real H1 with icon */}
   <h1 className="
       justify-self-center flex items-center gap-3
       text-xl md:text-xl lg:text-xl font-extrabold tracking-tight
       text-slate-900 dark:text-white
     ">
     <SettingsCubeIcon className="h-6 w-6 md:h-7 md:w-7 lg:h-8 lg:w-8 text-slate-700/90 dark:text-white/80" aria-hidden/>
     <span className="whitespace-nowrap">PROGRAM</span>
   </h1>
   <div className="justify-self-end"/>
   </div>
       </m.header>

      {/* Global spotlight overlay */}
      <AnimatePresence>
        {isSpotlightOn && (<m.div key="search-spotlight" className="fixed inset-0 z-[30] bg-black/40 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => { setShowSuggestions(false); setIsSearchFocused(false); }} transition={BACKDROP_SPRING}/>)}
      </AnimatePresence>

      {/* Content */}
      <main className="mx-auto flex w-full flex-1 flex-col gap-4 px-4 py-4">
        {/* Pickers */}
        <div className="grid gap-3 sm:grid-cols-2">
    {/* STEP 1 (highlight when no KFB selected) */}
    <button ref={kfbBtnRef} onMouseDown={(e) => e.preventDefault()} onClick={() => setShowKfbSheet(true)} aria-expanded={showKfbSheet} data-open={showKfbSheet ? 'true' : 'false'} className={clsx('group relative overflow-hidden flex items-center justify-between rounded-2xl px-4 py-3 text-left shadow-sm transition active:scale-[0.997]', !selectedConfig
            ? 'bg-white ring-2 ring-emerald-500'
            : 'bg-white ring-1 ring-slate-200 hover:shadow hover:ring-2 hover:ring-blue-400 hover:ring-offset-2 hover:ring-offset-white', 'outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white', showKfbSheet && 'z-[92]')}>
  <div>
    <div className="text-[11px] uppercase tracking-wider text-slate-500">1. Select KFB Number</div>
    <div className="truncate text-[16px] font-semibold text-slate-900">
      {selectedConfig ? selectedConfig.kfb : 'Choose…'}
    </div>
  </div>
  <ChevronDownIcon className="h-5 w-5 text-slate-500 transition group-hover:translate-y-0.5"/>
    </button>

    {/* STEP 2 (highlight when KFB chosen but Info not yet) */}
    <button ref={infoBtnRef} onMouseDown={(e) => e.preventDefault()} onClick={() => selectedConfig && setShowInfoSheet(true)} aria-expanded={showInfoSheet} data-open={showInfoSheet ? 'true' : 'false'} aria-disabled={!selectedConfig} className={clsx('group relative overflow-hidden flex items-center justify-between rounded-2xl px-4 py-3 text-left shadow-sm transition active:scale-[0.997]', selectedConfig && !selectedKfbInfo
            ? 'bg-white ring-2 ring-emerald-500'
            : selectedConfig
                ? 'bg-white ring-1 ring-slate-200 hover:shadow hover:ring-2 hover:ring-blue-400 hover:ring-offset-2 hover:ring-offset-white'
                : 'cursor-not-allowed bg-slate-100 ring-1 ring-slate-200/60', 'outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white', showInfoSheet && 'z-[92]')}>
  <div>
    <div className="text-[11px] uppercase tracking-wider text-slate-500">2. Select KFB Info</div>
    <div className="truncate text-[16px] font-semibold text-slate-900">
      {selectedKfbInfo ||
            (selectedConfig ? (kfbInfoDetails.length ? 'Choose…' : 'No info available') : 'Select KFB first')}
    </div>
  </div>
  <ChevronDownIcon className="h-5 w-5 text-slate-500 transition group-hover:translate-y-0.5"/>
    </button>

        </div>

        {error && (<div className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 z-[50]">
            <div className="flex items-start gap-2">
              <ExclamationTriangleIcon className="mt-0.5 h-5 w-5"/>
              <div className="flex-1">
                <div className="font-medium">An error occurred</div>
                <div>{error}</div>
              </div>
              <button onClick={() => setError(null)} className="text-red-600 hover:text-red-800">&times;</button>
            </div>
          </div>)}

        {/* Filter / Suggestions */}
        {selectedConfig && selectedKfbInfo ? (<section className="flex min-h-0 flex-1 flex-col">
            <div className={clsx("relative mb-4 mx-auto w-full", isSpotlightOn && "z-[40]")} ref={searchContainerRef}>
              <form onSubmit={(e) => {
                e.preventDefault();
                if (showCreateCTA)
                    createBranchViaSheet();
            }}>
                <div className="flex items-center gap-3 rounded-full bg-white px-4 py-2.5 shadow-md ring-1 ring-slate-200 focus-within:ring-2 focus-within:ring-blue-400 focus-within:ring-offset-2 focus-within:ring-offset-white">
                  <MagnifyingGlassIcon className="h-5 w-5 text-slate-500"/>
                  <input type="text" className="w-full appearance-none rounded-full bg-transparent text-[16px] lg:text-[17px] outline-none placeholder:text-slate-400" placeholder="Filter, link, or create branch…" value={unifiedInput} onChange={e => { setUnifiedInput(e.target.value); setShowSuggestions(true); }} onFocus={() => { setShowSuggestions(true); setIsSearchFocused(true); }} onKeyDown={(e) => {
                if (e.key === 'Escape') {
                    setShowSuggestions(false);
                    setIsSearchFocused(false);
                }
            }}/>
                </div>

                {/* Suggestions dropdown (hidden when create CTA is visible) */}
                {showSuggestions && !showCreateCTA && (<div className="absolute top-full left-0 right-0 z-[60] mt-2 max-h-[60vh] overflow-auto rounded-2xl border border-slate-200 bg-white shadow-xl ring-1 ring-slate-200/60 p-2" role="listbox">
                    {exactMatchInAll && linkedIds.has(exactMatchInAll.id) && (<div role="option" aria-disabled className="flex w-full items-center justify-between rounded-xl px-4 py-3 text-left text-[15px] text-slate-500 bg-slate-50 ring-1 ring-slate-200">
                        <span className="truncate">
                          Already linked: <span className="font-medium">{exactMatchInAll.name}</span>
                        </span>
                      </div>)}

                    {suggestionsUnlinked.map(b => (<button key={b.id} type="button" role="option" onMouseDown={(e) => e.preventDefault()} onClick={() => linkExistingBranch(b)} className="group flex w-full items-center justify-between rounded-xl px-4 py-3 text-left text-[15px] transition ring-1 ring-transparent hover:ring-2 hover:ring-blue-400 hover:ring-offset-2 hover:ring-offset-white hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white">
                        <span className="truncate">Link existing: <span className="font-semibold">{b.name}</span></span>
                        <CheckIcon className="h-4 w-4 opacity-0 group-hover:opacity-100 transition"/>
                      </button>))}

                    {suggestionsUnlinked.length === 0 && (<div className="px-4 py-3 text-center text-sm text-slate-500">No linkable matches</div>)}
                  </div>)}
              </form>
            </div>

            {/* Big Create CTA (inside "excel" area). Shows only when name is totally new */}
          {showCreateCTA && (<div className="relative z-[60] mt-2 rounded-2xl bg-emerald-50/70 p-2 ring-1 ring-emerald-200">
    <button type="button" onClick={createBranchViaSheet} className="w-full flex flex-col items-center justify-center gap-2 rounded-[22px] bg-white px-6 py-6 text-[17px] font-semibold text-emerald-700 shadow-lg ring-2 ring-emerald-300 hover:bg-white active:scale-[0.99]">
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500 text-white">
        <PlusIcon className="h-7 w-7"/>
      </span>
      <span className="truncate max-w-[90%]">Create “{unifiedInput}”</span>
    </button>
  </div>)}
        


            {/* Grid (kept above overlay only when not in create-CTA mode) */}
            <div className={clsx("relative min-h-0 flex-1 overflow-auto rounded-2xl border border-slate-200 bg-white", isSpotlightOn && !showCreateCTA && "z-[40]")}>
              <table className="min-w-full table-fixed">
                <colgroup>
                  <col className="w-14"/>
                  <col />
                  <col className="w-40"/>
                  <col className="w-44"/>
                  <col className="w-44"/>
                  <col className="w-44"/>
                </colgroup>
                <thead>
                  <tr className="select-none">
                    <th className={headerCell}>
                      <button type="button" onClick={() => clickSort('index')} className="inline-flex items-center" title="Sort by row #">
                        # <SortIcon active={sortKey === 'index'}/>
                      </button>
                    </th>
                    <th className={headerCell}>
                      <button type="button" onClick={() => clickSort('name')} className="inline-flex items-center" title="Sort by branch">
                        Branch <SortIcon active={sortKey === 'name'}/>
                      </button>
                    </th>
                    <th className={headerCell}>
                      <label className="flex items-center justify-center gap-2">
                        <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={areAllNotTested} onChange={handleToggleAllNotTested} disabled={filteredLinkedBranches.length === 0} title="Toggle all (filtered)"/>
                        <span className="inline-flex items-center">
                          Not tested
                          <button type="button" onClick={() => clickSort('not')} className="ml-1 inline-flex items-center" title="Sort by Not tested">
                            <SortIcon active={sortKey === 'not'}/>
                          </button>
                        </span>
                      </label>
                    </th>
                    <th className={headerCell}>
                      <label className="flex items-center justify-center gap-2">
                        <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={filteredLinkedBranches.length > 0 && filteredLinkedBranches.every(b => looseContactMap[b.id])} onChange={handleToggleAllLooseContact} disabled={filteredLinkedBranches.length === 0} title="Toggle all (filtered)"/>
                        <span className="inline-flex items-center">
                          Loose contact
                          <button type="button" onClick={() => clickSort('loose')} className="ml-1 inline-flex items-center" title="Sort by Loose contact">
                            <SortIcon active={sortKey === 'loose'}/>
                          </button>
                        </span>
                      </label>
                    </th>
                    <th className={headerCell}>
                      <button type="button" onClick={() => clickSort('pin')} className="inline-flex items-center" title="Sort by PIN">
                        PIN <SortIcon active={sortKey === 'pin'}/>
                      </button>
                    </th>
                    <th className={headerCell}>Actions</th>
                  </tr>
                </thead>

                <tbody className="[&_tr:nth-child(odd)]:bg-slate-50/40">
                  {loadingBranches ? (<tr>
                      <td colSpan={6} className="py-10 text-center text-slate-500">
                        <ArrowPathIcon className="mr-2 inline h-5 w-5 animate-spin text-slate-400"/>
                        Loading branches…
                      </td>
                    </tr>) : displayRows.length === 0 ? (<tr>
                      <td colSpan={6} className="py-12 text-center text-slate-500">
                        No branches linked. Use the input above to add one.
                      </td>
                    </tr>) : (displayRows.map((r, idx) => (<tr key={`${r.id}-${idx}`} className="transition-colors hover:bg-emerald-50/70">
                        <td className={clsx(cellBase, 'pr-4 text-right font-mono text-slate-500')}>{r.index}</td>
                        <td className={clsx(cellBase, 'align-middle')}>
                          {editingBranchId === r.id ? (<div className="flex items-center gap-2">
                              <input className="w-full rounded-2xl px-2 py-1 text-[14px] ring-1 ring-blue-400 focus:outline-none focus:ring-2 focus:ring-white-500" value={editBranchInputs[r.id] ?? ''} onChange={e => setEditBranchInputs(m => ({ ...m, [r.id]: e.target.value }))} onKeyDown={e => e.key === 'Enter' && handleSaveBranchName(r.id)} onBlur={() => setEditingBranchId(null)} autoFocus/>
                              <button onClick={() => handleSaveBranchName(r.id)} className="text-green-600 hover:text-green-500" title="Save">
                                <CheckCircleIcon className="h-5 w-5"/>
                              </button>
                            </div>) : (<div className="flex items-center gap-2">
                              <span className="truncate text-[15px] font-semibold">{r.name}</span>
                              <button onClick={() => handleEditBranch({ id: r.id, name: r.name })} className="text-slate-400 hover:text-slate-700" title="Rename">
                                <PencilSquareIcon className="h-4 w-4"/>
                              </button>
                            </div>)}
                        </td>

                        <td className={clsx(cellBase, 'text-center')}>
                          <IOSwitch checked={r.not} onChange={() => handleToggleNotTested(r.id)}/>
                        </td>

                        <td className={clsx(cellBase, 'text-center')}>
                          <IOSwitch checked={r.loose} onChange={() => handleToggleLooseContact(r.id)}/>
                        </td>

                        <td className={clsx(cellBase, 'text-center font-mono')}>
                          {loadingPinMap[r.id] ? (<ArrowPathIcon className="mx-auto h-4 w-4 animate-spin text-slate-400"/>) : r.pin != null ? (<div className="inline-flex items-center gap-2">
                              <code className="rounded-2xl bg-slate-100 px-2 py-0.5 ring-1 ring-slate-200">PIN {r.pin}</code>
                              <button onClick={() => handleDeletePin(r.id)} className="text-red-600 hover:text-red-700" title="Remove PIN">
                                <XMarkIcon className="h-4 w-4"/>
                              </button>
                            </div>) : (<form onSubmit={e => {
                        e.preventDefault();
                        handleAddPin(r.id);
                    }} className="inline-flex items-center gap-1">
                              <input type="text" className="w-16 rounded-2xl border border-slate-300 bg-white px-2 py-1 text-center focus:outline-none focus:ring-2 focus:ring-white-500" placeholder="Add" value={newPinInputs[r.id] || ''} onChange={e => setNewPinInputs(m => ({ ...m, [r.id]: e.target.value }))}/>
                              <button type="submit" className="text-emerald-600 hover:text-emerald-500" title="Add PIN">
                                <PlusIcon className="h-5 w-5"/>
                              </button>
                            </form>)}
                        </td>

                        <td className={clsx(cellBase, 'text-center')}>
                          {confirmDeleteId === r.id ? (<div className="inline-flex items-center gap-2">
                              <span className="font-medium text-amber-700">Unlink?</span>
                              <button onClick={() => handleUnlinkBranch(r.id)} className="rounded-2xl bg-red-600 px-2 py-1 text-[12px] text-white hover:bg-red-500">
                                Yes
                              </button>
                              <button onClick={() => setConfirmDeleteId(null)} className="rounded-2xl bg-slate-200 px-2 py-1 text-[12px] text-slate-800 hover:bg-slate-300">
                                No
                              </button>
                            </div>) : (<button onClick={() => setConfirmDeleteId(r.id)} className="mx-auto inline-flex items-center gap-1.5 rounded-2xl border border-red-200 bg-red-50 px-3 py-1.5 text-[12px] font-medium text-red-700 hover:bg-red-100">
                              <TrashIcon className="h-4 w-4"/> Unlink
                            </button>)}
                        </td>
                      </tr>)))}
                </tbody>
              </table>
            </div>
          </section>) : (<div className="w-full max-w-6xl mx-auto px-3">
  {/* Row 1: Step 1 & Step 2 */}


   

  {/* Row 2: Step 3 area */}
  <div className="mt-6">
    <div className="rounded-3xl border-2 border-dashed border-slate-300 bg-white/80 p-8 text-center text-slate-600">
      <div className="text-base font-semibold">3. Linked branches</div>
      <div className="mt-1 text-sm">After completing steps 1 &amp; 2, your list will appear here.</div>
    </div>
  </div>
        </div>)}
      </main>

      {/* Sheets */}
      <AdaptiveSheet isOpen={showKfbSheet} onClose={() => setShowKfbSheet(false)} title="Select KFB Number" anchorRef={kfbBtnRef} mobileSize="lg">
        <PickerList options={configs.map(c => c.kfb)} selected={selectedConfig?.kfb} onSelect={v => {
            const chosen = configs.find(c => c.kfb === v);
            if (chosen)
                handleSelectConfig(chosen.id);
            setShowKfbSheet(false);
        }} placeholder="Search KFB…"/>
      </AdaptiveSheet>

      <AdaptiveSheet isOpen={showInfoSheet} onClose={() => setShowInfoSheet(false)} title="Select KFB Info" anchorRef={infoBtnRef} mobileSize="lg">
        <PickerList options={kfbInfoDetails.map(d => d.kfb_info_value)} selected={selectedKfbInfo ?? undefined} onSelect={v => {
            handleSelectKfbInfo(v);
            setShowInfoSheet(false);
        }} placeholder="Search info…"/>
      </AdaptiveSheet>

      <CreateBranchPanel isOpen={showCreateSheet} onClose={() => setShowCreateSheet(false)} initialName={createDraftName} usedPins={usedPins} onCreate={handleCreateDraft} anchorRef={searchContainerRef}/>

      {/* Floating add (mobile) */}
      {selectedConfig && selectedKfbInfo && (<button onClick={() => {
                setCreateDraftName('');
                setShowCreateSheet(true);
            }} className="fixed bottom-5 right-5 inline-flex items-center justify-center rounded-2xl bg-emerald-600 p-3 text-white shadow-2xl ring-1 ring-emerald-700/20 hover:scale-[1.02] active:scale-[0.98] md:hidden" aria-label="Add Branch">
          <PlusIcon className="h-5 w-5"/>
        </button>)}
    </div>);
};
export { SettingsBranchesPageContent };
export default SettingsBranchesPageContent;
