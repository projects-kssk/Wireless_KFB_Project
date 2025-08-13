'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  PencilSquareIcon,
  TrashIcon,
  ExclamationTriangleIcon,
  PlusIcon,
  XMarkIcon,
  PlayIcon,
} from '@heroicons/react/24/outline';
import { motion, AnimatePresence, type Transition } from 'framer-motion';

import { BranchSelectorModal } from '@/components/Modals/BranchSelectorModal';
import { Branch, EspPinMapping } from '@/types/types';
import { SettingsCogIcon } from '@/components/Icons/Icons';

/* ────────────────────────────────────────────────────────────────────────────
 * Types
 * ──────────────────────────────────────────────────────────────────────────── */
interface Configuration extends Omit<ConfigurationFormData, 'branchPins'> {
  id: number;
  kfb: string;
  mac_address: string;
  branchPins: Branch[];
  espPinMappings: EspPinMapping;
  kfbInfo: string[];
}
interface ConfigurationFormData {
  id?: number;
  kfb: string;
  mac_address: string;
  branchPins: string[];
  espPinMappings: EspPinMapping;
  kfbInfo: string[];
}
interface NotificationType {
  message: string | null;
  type: 'success' | 'error' | 'info' | null;
}
interface SettingsPageContentProps {
  onNavigateBack?: () => void;
  onShowProgramForConfig: (configId: number) => void;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Constants & helpers
 * ──────────────────────────────────────────────────────────────────────────── */
const initialFormState: ConfigurationFormData = {
  kfb: '',
  mac_address: '',
  branchPins: [],
  espPinMappings: {},
  kfbInfo: [''],
};

const sheetCard =
  'bg-white/80 dark:bg-slate-900/70 backdrop-blur-2xl ring-1 ring-white/60 dark:ring-white/10 shadow-[0_24px_60px_rgba(2,6,23,0.18)]';
const tileCard =
  'bg-white/85 dark:bg-slate-800/60 backdrop-blur-2xl ring-1 ring-white/60 dark:ring-white/10 shadow-[0_12px_36px_-12px_rgba(2,6,23,0.25)]';
const inputBase =
  'block w-full rounded-2xl px-5 py-4 text-[17px] bg-white/80 dark:bg-slate-800/70 ring-1 ring-slate-200/80 dark:ring-white/10 placeholder:text-slate-400 dark:placeholder:text-slate-500 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-400 focus:ring-offset-2 focus:ring-offset-white/60 dark:focus:ring-offset-slate-900/40 shadow-inner transition-all';

const headerSpring: Transition = { type: 'spring', stiffness: 520, damping: 40 };
const cardSpring: Transition = { type: 'spring', stiffness: 520, damping: 45 };
const fade: Transition = { type: 'tween', duration: 0.18 };

/* Anchor rect (spotlights & hole) */
function useAnchorRect<T extends HTMLElement>(active: boolean, ref: React.RefObject<T | null>) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    if (!active) return;
    const calc = () => {
      const el = ref.current;
      if (!el) return setRect(null);
      setRect(el.getBoundingClientRect());
    };
    calc();
    window.addEventListener('resize', calc);
    window.addEventListener('scroll', calc, true);
    (window.visualViewport ?? window).addEventListener?.('resize', calc as any);
    return () => {
      window.removeEventListener('resize', calc);
      window.removeEventListener('scroll', calc, true);
      (window.visualViewport ?? window).removeEventListener?.('resize', calc as any);
    };
  }, [active, ref]);
  return rect;
}

  // Flash a field for `ms` when its value changes
function useFlashOnChange<T>(value: T, ms = 1400) {
  const [flash, setFlash] = React.useState(false);
  const prev = React.useRef(value);

  React.useEffect(() => {
    // compare by value (works for strings, numbers, small arrays)
    if (JSON.stringify(prev.current) !== JSON.stringify(value)) {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), ms);
      prev.current = value;
      return () => clearTimeout(t);
    }
  }, [value, ms]);

  return flash;
}


/* ────────────────────────────────────────────────────────────────────────────
 * Component
 * ──────────────────────────────────────────────────────────────────────────── */
export const SettingsPageContent: React.FC<SettingsPageContentProps> = ({
  onNavigateBack,
  onShowProgramForConfig,
}) => {
  const [currentConfig, setCurrentConfig] = useState<ConfigurationFormData>(initialFormState);
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [configurations, setConfigurations] = useState<Configuration[]>([]);
  const [formNotification, setFormNotification] = useState<NotificationType>({ message: null, type: null });
  const [isLoading, setIsLoading] = useState(true);
  const [filterText, setFilterText] = useState('');

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [configToDelete, setConfigToDelete] = useState<number | null>(null);

  // Discover ESP modal state
  const [discoverOpen, setDiscoverOpen] = React.useState(false);
  const [discoverStatus, setDiscoverStatus] = useState<'idle' | 'searching' | 'success' | 'error'>('idle');
  const [foundMac, setFoundMac] = useState<string | null>(null);
  const [discoverError, setDiscoverError] = useState<string | null>(null);

  // TEST button call state
  const [testStatus, setTestStatus] = useState<'idle' | 'calling' | 'ok' | 'error'>('idle');
  const [testMsg, setTestMsg] = useState<string | null>(null);

  const [showEspBranchModal, setShowEspBranchModal] = useState(false);
  const [pinToAssign, setPinToAssign] = useState<string | null>(null);
  const [deleteAnchor, setDeleteAnchor] = useState<DOMRect | null>(null);
  const delModalRef = useRef<HTMLDivElement>(null);

  /* Fetch */
  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setFormNotification({ message: null, type: null });
    try {
      const res = await fetch('/api/configurations', { cache: 'no-store' });
      if (!res.ok) throw new Error(`Error ${res.status}: ${await res.text()}`);
      const configs: Configuration[] = await res.json();
      setConfigurations(configs);
    } catch (err: any) {
      console.error(err);
      setFormNotification({ message: err.message, type: 'error' });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (editingId !== null) {
      const hit = configurations.find((c) => c.id === editingId);
      if (hit) {
        setCurrentConfig({
          id: hit.id,
          kfb: hit.kfb,
          mac_address: hit.mac_address,
          branchPins: hit.branchPins.map((b) => b.name),
          espPinMappings: { ...hit.espPinMappings },
          kfbInfo: hit.kfbInfo.length ? [...hit.kfbInfo] : [''],
        });
        setIsEditing(true);
        setFormNotification({ message: null, type: null });
      }
    } else {
      setCurrentConfig(initialFormState);
      setIsEditing(false);
    }
  }, [editingId, configurations]);

  /* Form handlers */
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setCurrentConfig((prev) => ({ ...prev, [name]: value }));
    setFormNotification({ message: null, type: null });
  };

  const handleKfbInfoChange = (index: number, value: string) => {
    setCurrentConfig((prev) => {
      const next = [...prev.kfbInfo];
      next[index] = value;
      return { ...prev, kfbInfo: next };
    });
    setFormNotification({ message: null, type: null });
  };

  const handleAddKfbInfo = () => setCurrentConfig((prev) => ({ ...prev, kfbInfo: [...prev.kfbInfo, ''] }));
  const handleRemoveKfbInfo = (index: number) => {
    setCurrentConfig((prev) => {
      const next = prev.kfbInfo.filter((_, i) => i !== index);
      return { ...prev, kfbInfo: next.length ? next : [''] };
    });
  };

  /* Save / Delete */
  const handleSaveConfiguration = async () => {
    const payload = {
      kfb: currentConfig.kfb,
      mac_address: currentConfig.mac_address,
      kfbInfo: currentConfig.kfbInfo.filter((s) => s.trim() !== ''),
      branchPins: currentConfig.branchPins,
      espPinMappings: currentConfig.espPinMappings,
    };

    setFormNotification({ message: null, type: null });
    setIsLoading(true);

    try {
      const url = isEditing ? `/api/configurations/${currentConfig.id}` : '/api/configurations';
      const method = isEditing ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Error ${res.status}: ${await res.text()}`);

      setFormNotification({
        message: `Configuration ${isEditing ? 'updated' : 'saved'}!`,
        type: 'success',
      });
      setCurrentConfig(initialFormState);
      setIsEditing(false);
      setEditingId(null);
      await fetchData();
    } catch (err: any) {
      console.error(err);
      setFormNotification({ message: err.message, type: 'error' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleModify = (config: Configuration) => {
    setEditingId(config.id);
    setFormNotification({ message: null, type: null });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const requestDelete = (id: number, e?: React.MouseEvent<HTMLButtonElement>) => {
    setConfigToDelete(id);
    setDeleteAnchor(e ? (e.currentTarget as HTMLElement).getBoundingClientRect() : null);
    setShowDeleteModal(true);
  };

  const confirmDelete = async () => {
    if (configToDelete == null) return;
    setFormNotification({ message: null, type: null });
    setIsLoading(true);
    try {
      const res = await fetch(`/api/configurations/${configToDelete}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Error ${res.status}: ${await res.text()}`);
      setFormNotification({ message: 'Configuration deleted.', type: 'success' });
      setShowDeleteModal(false);
      setConfigToDelete(null);
      await fetchData();
    } catch (err: any) {
      console.error(err);
      setFormNotification({ message: err.message, type: 'error' });
    } finally {
      setIsLoading(false);
    }
  };
  const cancelDelete = () => { setShowDeleteModal(false); setConfigToDelete(null); };

  /* ESP mapping */
  const handleOpenEspBranchModal = (pinNumber: string) => { setPinToAssign(pinNumber); setShowEspBranchModal(true); };
  const handleAssignBranchToEspPin = (pin: string, branch: string) => {
    setCurrentConfig((prev) => ({ ...prev, espPinMappings: { ...(prev.espPinMappings || {}), [pin]: branch } }));
  };
  const handleUnassignBranchFromEspPin = (pin: string) => {
    setCurrentConfig((prev) => {
      const next = { ...(prev.espPinMappings || {}) };
      delete next[pin];
      return { ...prev, espPinMappings: next };
    });
  };

  /* Filter */
  const filteredConfigurations = useMemo(() => {
    if (!filterText.trim()) return configurations;
    const q = filterText.toLowerCase();
    return configurations.filter(
      (c) =>
        c.kfb.toLowerCase().includes(q) ||
        c.mac_address.toLowerCase().includes(q) ||
        c.kfbInfo.some((info) => info.toLowerCase().includes(q)),
    );
  }, [configurations, filterText]);

  /* Spotlights / hole */
  const formRef = useRef<HTMLDivElement>(null);
  const editRect = useAnchorRect(isEditing, formRef);

  const macWrapperRef = useRef<HTMLDivElement>(null);
  const discoverRect = useAnchorRect(discoverOpen, macWrapperRef);

  const startDiscover = async () => {
    setDiscoverOpen(true);
    setDiscoverStatus('searching');
    setDiscoverError(null);
    setFoundMac(null);
    setTestStatus('idle');
    setTestMsg(null);
    try {
      const res = await fetch('/api/esp/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kfb: currentConfig.kfb || undefined }),
      });
      if (!res.ok) throw new Error(await res.text());
      const raw = (await res.json()) as { macAddress?: string; error?: string };
      const mac = raw.macAddress;
      if (!mac) throw new Error(raw.error || 'No MAC returned');
      setFoundMac(mac);
      setCurrentConfig((prev) => ({ ...prev, mac_address: mac }));
      setDiscoverStatus('success');
    } catch (e: any) {
      setDiscoverStatus('error');
      setDiscoverError(e?.message || 'Discovery failed');
    }
  };

  const retryDiscover = async () => {
    setDiscoverStatus('searching');
    setDiscoverError(null);
    setFoundMac(null);
    setTestStatus('idle');
    setTestMsg(null);
    try {
      const res = await fetch('/api/esp/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kfb: currentConfig.kfb || undefined }),
      });
      if (!res.ok) throw new Error(await res.text());
      const raw = (await res.json()) as { macAddress?: string; error?: string };
      const mac = raw.macAddress;
      if (!mac) throw new Error(raw.error || 'No MAC returned');
      setFoundMac(mac);
      setCurrentConfig((prev) => ({ ...prev, mac_address: mac }));
      setDiscoverStatus('success');
    } catch (e: any) {
      setDiscoverStatus('error');
      setDiscoverError(e?.message || 'Discovery failed');
    }
  };

  // TEST action (calls API)
  const handleTest = async () => {
    if (!foundMac) return;
    try {
      setTestStatus('calling');
      setTestMsg(null);
      const res = await fetch('/api/esp/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mac: foundMac, kfb: currentConfig.kfb || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Test failed');
      setTestStatus('ok');
      setTestMsg(data?.message || 'Test command sent.');
    } catch (e: any) {
      setTestStatus('error');
      setTestMsg(e?.message ?? 'Failed to send test.');
    }
  };
const macFlash = useFlashOnChange(currentConfig.mac_address, 1400);

  /* Loading screen */
  if (isLoading && configurations.length === 0 && !formNotification.message) {
    return (
      <div className="flex-grow w-full min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-10">
        <motion.p initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={headerSpring} className="text-slate-700 dark:text-slate-300 text-[22px] font-medium">
          Loading configurations…
        </motion.p>
      </div>
    );
  }





  const needsKfb = isEditing && !currentConfig.kfb.trim();
  const needsInfo = isEditing && currentConfig.kfbInfo.every((s) => !s.trim());
  const macPulseActive = discoverOpen && discoverStatus === 'success';


  return (
    <div className="flex-grow w-full min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900  p-4 flex flex-col">
      {/* Header */}
      <motion.header
        initial={{ y: -8, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={headerSpring}
        className={`sticky top-0 z-30 ${sheetCard} rounded-2xl px-4 sm:px-5 py-3 mb-4`}
      >
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <div className="justify-self-start">
            {onNavigateBack && (
              <button
                onClick={onNavigateBack}
                className="inline-flex items-center gap-2 rounded-full bg-white/90 dark:bg-slate-800/70 px-4 py-2 text-[15px] font-semibold text-slate-800 dark:text-slate-100 ring-1 ring-slate-200 dark:ring-white/10 hover:bg-white shadow-sm active:scale-[0.99]"
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                GO BACK TO MAIN
              </button>
            )}
          </div>
          <h1 className="justify-self-center flex items-center gap-3 text-xl md:text-xl lg:text-xl font-extrabold tracking-tight text-slate-900 dark:text-white">
            <SettingsCogIcon className="h-6 w-6 md:h-7 md:w-7 lg:h-8 lg:w-8 text-slate-700/90 dark:text-white/80" aria-hidden />
            <span className="whitespace-nowrap">KFB CONFIG</span>
          </h1>
          <div className="justify-self-end" />
        </div>
      </motion.header>

      {/* Editing spotlight overlay */}
      <AnimatePresence>
        {isEditing && editRect && (
          <>
            <motion.div key="spot-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={fade} className="fixed inset-0 z-[35] bg-black/50 backdrop-blur-sm" />
            <motion.div
              key="spot-ring"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={cardSpring}
              className="pointer-events-none fixed z-[60] rounded-3xl ring-2 ring-sky-500 shadow-[0_0_0_8px_rgba(56,189,248,0.25)]"
              style={{
                top: Math.max(8, editRect.top - 8),
                left: Math.max(8, editRect.left - 8),
                width: editRect.width + 16,
                height: editRect.height + 16,
              }}
            />
          </>
        )}
      </AnimatePresence>

      {/* Form */}
      <motion.section
        ref={formRef}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={cardSpring}
        className={`${tileCard} relative z-[70] rounded-3xl p-6 sm:p-8 mb-6 ${isEditing ? 'ring-2 ring-sky-400 ring-offset-2 ring-offset-sky-50' : ''}`}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
            {isEditing ? 'Edit KFB' : 'New KFB'}
          </h2>
        </div>

        <AnimatePresence>
          {formNotification.message && (
            <motion.div
              key="notice"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={fade}
              className={[
                'mb-6 rounded-2xl p-4 text-[15px] ring-1',
                formNotification.type === 'error'
                  ? 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-900/40 dark:text-red-200 dark:ring-red-800/60'
                  : formNotification.type === 'success'
                  ? 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-200 dark:ring-emerald-800/60'
                  : 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-900/40 dark:text-sky-200 dark:ring-sky-800/60',
              ].join(' ')}
            >
              {formNotification.message}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="grid gap-5 md:grid-cols-2 mb-6">
          {/* KFB */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">KFB Number</label>
            <input
              type="text"
              name="kfb"
              id="kfb"
              value={currentConfig.kfb}
              onChange={handleInputChange}
              className={`${inputBase}`}
              placeholder="IW12345678"
            />
          </div>

          {/* MAC + Discover */}
          <div ref={macWrapperRef} className="space-y-2 relative">
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">MAC Address</label>
            <div className="flex items-center gap-2">
           <input
  type="text"
  name="mac_address"
  value={currentConfig.mac_address}
  onChange={handleInputChange}
  // expose a data attribute we can target with Tailwind variants
  data-flash={macFlash || (discoverOpen && discoverStatus === 'success')}
  className={[
    inputBase,
    // stronger, obvious highlight when data-flash="true"
    'transition-[background-color,box-shadow,outline-color,ring-color,ring-width]',
    'data-[flash=true]:bg-emerald-50',
    'data-[flash=true]:ring-2 data-[flash=true]:ring-emerald-500',
    'data-[flash=true]:outline data-[flash=true]:outline-2 data-[flash=true]:outline-emerald-200',
    'data-[flash=true]:shadow-[0_0_0_6px_rgba(16,185,129,.22)]',
    'data-[flash=true]:animate-pulse', // optional: quick pulse
  ].join(' ')}
  placeholder="XX:XX:XX:XX:XX:XX"
/>

              <button
                type="button"
                onClick={startDiscover}
                className="shrink-0 rounded-full bg-indigo-600 px-4 py-2 text-[14px] font-semibold text-white ring-1 ring-indigo-700/30 hover:bg-indigo-700 active:scale-[0.99]"
              >
                Discover ESP
              </button>
            </div>
          </div>
        </div>

        {/* KFB INFO */}
        <div className="mb-6">
          <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3">KFB Info</label>
          <div className="space-y-3">
            {currentConfig.kfbInfo.map((info, idx) => (
              <motion.div key={`kfb-${idx}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={cardSpring} className="flex items-center gap-3">
                <input
                  type="text"
                  value={info}
                  onChange={(e) => handleKfbInfoChange(idx, e.target.value)}
                  className={`${inputBase} flex-1 ${needsInfo ? 'ring-sky-400/80 focus:ring-sky-500' : ''}`}
                  placeholder="e.g., 83AUDAU40X02-70"
                />
                {currentConfig.kfbInfo.length > 1 && (
                  <button
                    type="button"
                    onClick={() => handleRemoveKfbInfo(idx)}
                    className="inline-flex h-11 px-3 items-center justify-center rounded-xl text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 ring-1 ring-transparent hover:ring-red-200 active:scale-95"
                    title="Remove"
                  >
                    <XMarkIcon className="w-6 h-6" />
                  </button>
                )}
              </motion.div>
            ))}
          </div>

          <button
            type="button"
            onClick={handleAddKfbInfo}
            className="mt-4 inline-flex items-center gap-2 rounded-full bg-sky-600 px-5 py-2.5 text-[15px] font-semibold text-white shadow-lg ring-1 ring-sky-700/30 hover:bg-sky-700 active:scale-[0.99]"
          >
            <PlusIcon className="h-5 w-5" />
            Add KFB Info
          </button>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3">
          {(isEditing ||
            Object.values(currentConfig).some((val) =>
              Array.isArray(val)
                ? val.length > 0 && !(val.length === 1 && val[0] === '')
                : typeof val === 'object' && val !== null
                ? Object.keys(val).length > 0
                : typeof val === 'string' && val !== '',
            )) && (
            <button
              type="button"
              onClick={() => {
                setCurrentConfig(initialFormState);
                setIsEditing(false);
                setEditingId(null);
                setFormNotification({ message: null, type: null });
              }}
              className="rounded-full bg-white/90 px-6 py-3 text-[15px] font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-white active:scale-[0.99]"
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            onClick={handleSaveConfiguration}
            disabled={isLoading}
            className="rounded-full bg-sky-600 px-7 py-3.5 text-[15px] font-semibold text-white shadow-lg ring-1 ring-sky-700/30 hover:bg-sky-700 active:scale-[0.99] disabled:opacity-60"
          >
            {isLoading && isEditing ? 'Updating…' : isLoading ? 'Saving…' : isEditing ? 'Update' : 'Save'}
          </button>
        </div>
      </motion.section>

      {/* Overview (unchanged) */}
      <motion.section initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={cardSpring} className={`${tileCard} rounded-3xl overflow-hidden`}>
        <div className="bg-white/80 dark:bg-slate-900/60 backdrop-blur border-b border-slate-200/70 dark:border-slate-700/60 px-6 py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white">Overview</h2>
            <input type="text" value={filterText} onChange={(e) => setFilterText(e.target.value)} placeholder="Search KFB, MAC, info…" className={`${inputBase} w-full sm:w-[28rem] max-w-full`} />
          </div>
        </div>
        <div className="max-h-[60vh] overflow-auto">
          <table className="min-w-full table-fixed text-[15px] border-separate border-spacing-0">
            <colgroup>
              <col className="w-[18rem]" />
              <col className="w-[16rem]" />
              <col />
              <col className="w-[15rem]" />
              <col className="w-[12rem]" />
            </colgroup>
            <thead className="sticky top-0 z-10">
              <tr>
                {['KFB Number', 'MAC Address', 'KFB Info', 'Actions', 'Program'].map((h) => (
                  <th key={h} className="bg-white/90 dark:bg-slate-900/70 backdrop-blur text-left text-slate-600 dark:text-slate-300 font-semibold px-6 py-3 border-b border-slate-200/80 dark:border-slate-700/60">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredConfigurations.length > 0 ? (
                filteredConfigurations.map((config, idx) => {
                  const zebra = idx % 2 === 0 ? 'bg-white/70 dark:bg-slate-900/40' : 'bg-white/60 dark:bg-slate-900/30';
                  return (
                    <tr key={config.id} className={`${zebra} hover:bg-sky-50/70 dark:hover:bg-slate-800/70 transition-colors align-top`}>
                      <td className="px-6 py-4 text-slate-800 dark:text-slate-100 border-b border-slate-200/70 dark:border-slate-700/60">{config.kfb}</td>
                      <td className="px-6 py-4 text-slate-800 dark:text-slate-100 border-b border-slate-200/70 dark:border-slate-700/60">{config.mac_address || <span className="text-slate-400">—</span>}</td>
                      <td className="px-6 py-3 border-b border-slate-200/70 dark:border-slate-700/60">
                        {config.kfbInfo?.length ? (
                          <div className="flex flex-wrap gap-2">
                            {config.kfbInfo.map((info, i) => (
                              <span
                                key={i}
                                className="inline-flex items-center rounded-full px-3 py-1.5 text-[13px] font-medium bg-slate-100 text-slate-700 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700"
                                title={info}
                              >
                                <span className="mr-2 block h-1.5 w-1.5 rounded-full bg-slate-400 dark:bg-slate-300" />
                                <span className="truncate max-w-[22rem]">{info}</span>
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4 border-b border-slate-200/70 dark:border-slate-700/60">
                        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-row sm:gap-2">
                          <button
                            onClick={() => handleModify(config)}
                            className="inline-flex items-center justify-center gap-2 rounded-full w-[120px] px-4 py-2.5 text-[14px] font-semibold text-white bg-sky-600 ring-1 ring-sky-700/30 hover:bg-sky-700 active:scale-[0.99]"
                            title="Edit"
                          >
                            <PencilSquareIcon className="h-5 w-5" />
                            Edit
                          </button>
                          <button
                            onClick={(e) => requestDelete(config.id, e)}
                            className="inline-flex items-center justify-center gap-2 rounded-full w-[120px] px-4 py-2.5 text-[14px] font-semibold text-white bg-red-600 ring-1 ring-red-700/30 hover:bg-red-700 active:scale-[0.99]"
                            title="Delete"
                          >
                            <TrashIcon className="h-5 w-5" />
                            Delete
                          </button>
                        </div>
                      </td>
                      <td className="px-6 py-4 border-b border-slate-200/70 dark:border-slate-700/60">
                        <button
                          onClick={() => onShowProgramForConfig(config.id)}
                          className="inline-flex items-center gap-2 rounded-full w-[120px] justify-center px-4 py-2.5 text-[14px] font-semibold text-white bg-emerald-600 ring-1 ring-emerald-700/30 hover:bg-emerald-700 active:scale-[0.99]"
                          title="Program"
                        >
                          <PlayIcon className="h-5 w-5" />
                          Program
                        </button>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-slate-500 dark:text-slate-400">
                    No configurations{filterText ? ' match your filter' : ''}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </motion.section>

      {/* Delete Confirmation Modal (anchored) */}
      <AnimatePresence>
        {showDeleteModal && deleteAnchor && (
          <>
            <motion.svg className="fixed inset-0 z-[80] w-screen h-screen" width="100%" height="100%" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={fade} onClick={cancelDelete}>
              <defs>
                <mask id="del-cutout" x="0" y="0" width="100%" height="100%" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse">
                  <rect x="0" y="0" width="100%" height="100%" fill="white" />
                  <rect
                    x={Math.max(8, Math.min(window.innerWidth - 520 - 8, deleteAnchor.right - 520)) - 8}
                    y={Math.min(window.innerHeight - 16, deleteAnchor.bottom + 12) - 8}
                    width={520 + 16}
                    height={220}
                    rx={16}
                    ry={16}
                    fill="black"
                  />
                </mask>
              </defs>
              <rect x="0" y="0" width="100%" height="100%" fill="rgba(0,0,0,.6)" mask="url(#del-cutout)" />
            </motion.svg>

            <motion.div
              ref={delModalRef}
              key="del-pop"
              initial={{ opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={cardSpring}
              className={`${sheetCard} fixed z-[90] rounded-2xl p-6 sm:p-7 shadow-2xl`}
              style={{
                top: Math.min(window.innerHeight - 16, deleteAnchor.bottom + 12),
                left: Math.max(8, Math.min(window.innerWidth - 520 - 8, deleteAnchor.right - 520)),
                width: 520,
              }}
              role="dialog"
              aria-modal="true"
            >
              <div className="absolute -top-2 right-8 h-4 w-4 rotate-45 bg-white dark:bg-slate-900 ring-1 ring-black/5" />
              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/50">
                  <ExclamationTriangleIcon className="h-6 w-6 text-red-600 dark:text-red-400" />
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Delete Configuration</h3>
                  <p className="mt-1 text-[14px] text-slate-600 dark:text-slate-300">
                    Are you sure you want to delete this configuration? This action cannot be undone.
                  </p>
                </div>
              </div>

              <div className="mt-5 flex justify-end gap-3">
                <button type="button" onClick={cancelDelete} className="rounded-full bg-white/90 px-5 py-2.5 text-[14px] font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-white active:scale-[0.99]">
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmDelete}
                  disabled={isLoading}
                  className="rounded-full bg-red-600 px-5 py-2.5 text-[14px] font-semibold text-white shadow-lg ring-1 ring-red-700/30 hover:bg-red-700 active:scale-[0.99] disabled:opacity-60"
                >
                  {isLoading ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Discover ESP modal + overlay */}
      <AnimatePresence>
        {discoverOpen && (
          <>
            {discoverRect ? (
              <>
                <motion.div className="fixed left-0 right-0 z-[80] bg-black/60 backdrop-blur-md" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={fade} style={{ top: 0, height: Math.max(0, discoverRect.top - 12) }} onClick={() => setDiscoverOpen(false)} />
                <motion.div
                  className="fixed top-0 z-[80] bg-black/60 backdrop-blur-md"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={fade}
                  style={{ top: Math.max(0, discoverRect.top - 12), left: 0, width: Math.max(0, discoverRect.left - 12), height: discoverRect.height + 24 }}
                  onClick={() => setDiscoverOpen(false)}
                />
                <motion.div
                  className="fixed top-0 right-0 z-[80] bg-black/60 backdrop-blur-md"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={fade}
                  style={{ top: Math.max(0, discoverRect.top - 12), left: discoverRect.left + discoverRect.width + 12, height: discoverRect.height + 24 }}
                  onClick={() => setDiscoverOpen(false)}
                />
                <motion.div
                  className="fixed left-0 right-0 bottom-0 z-[80] bg-black/60 backdrop-blur-md"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={fade}
                  style={{ top: discoverRect.top + discoverRect.height + 12 }}
                  onClick={() => setDiscoverOpen(false)}
                />
              </>
            ) : (
              <motion.div className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-md" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={fade} onClick={() => setDiscoverOpen(false)} />
            )}

            <DiscoverEspModal
              open={discoverOpen}
              status={discoverStatus}
              mac={foundMac}
              error={discoverError}
              onClose={() => setDiscoverOpen(false)}
              onRetry={retryDiscover}
              onTest={handleTest}
              testStatus={testStatus}
              testMsg={testMsg}
            />
          </>
        )}
      </AnimatePresence>

      {/* Branch selector */}
      <BranchSelectorModal
        isOpen={showEspBranchModal}
        onClose={() => setShowEspBranchModal(false)}
        pinNumber={pinToAssign}
        currentPinAssignment={pinToAssign ? currentConfig.espPinMappings?.[pinToAssign] : undefined}
        availableBranches={currentConfig.branchPins}
        onAssignBranch={handleAssignBranchToEspPin}
        onUnassignBranchFromEspPin={handleUnassignBranchFromEspPin}
        espPinMappings={currentConfig.espPinMappings || {}}
      />
    </div>
  );
};

export default SettingsPageContent;



/* ────────────────────────────────────────────────────────────────────────────
 * Discover ESP Modal (taller boards + labels + centered TEST)
 * ──────────────────────────────────────────────────────────────────────────── */
function DiscoverEspModal({
  open,
  onClose,
  onRetry,
  onTest,
  status,
  mac,
  error,
  testStatus,
  testMsg,
}: {
  open: boolean;
  onClose: () => void;
  onRetry: () => void;
  onTest: () => void;
  status: 'idle' | 'searching' | 'success' | 'error';
  mac: string | null;
  error: string | null;
  testStatus: 'idle' | 'calling' | 'ok' | 'error';
  testMsg: string | null;
}) {
  const SHEET: Transition = { type: 'spring', stiffness: 520, damping: 42, mass: 0.9 };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="esp-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Discover ESP"
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={SHEET}
            className="fixed inset-0 z-[100] flex items-center justify-center p-3"
          >
            {/* Bigger modal canvas */}
            <div className="relative h-[min(80vh,750px)] w-[min(98vw,1600px)] overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-black/5">
              {/* Title bar */}
              <div className="flex items-center justify-between px-6 py-4">
                <h3 className="text-[18px] font-semibold text-slate-900">Discover ESP</h3>
                <div className="flex items-center gap-3">
                  {status !== 'searching' && (
                    <button onClick={onRetry} className="rounded-full bg-indigo-600 px-6 py-2.5 text-[14px] font-semibold text-white ring-1 ring-indigo-700/30 hover:bg-indigo-700 active:scale-[0.99]">
                      Retry
                    </button>
                  )}
                  <button onClick={onClose} className="rounded-full bg-white px-5 py-2.5 text-[14px] font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 active:scale-95">
                    Close
                  </button>
                </div>
              </div>

              {/* Status banner */}
              <StatusBanner status={status} mac={mac} error={error} />

              {/* Animation panel */}
              <div className="px-6 pb-6">
                <div className="relative mt-4 overflow-hidden rounded-3xl bg-slate-50 p-4 ring-1 ring-slate-200">
                  <EspLinkAnimation searching={status === 'searching'} success={status === 'success'} big />

                  {/* Centered TEST button (always perfectly centered) */}
                  {status === 'success' && (
                    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3">
                      <motion.div
                        className="absolute h-64 w-64 rounded-full border-4 border-emerald-300"
                        initial={{ scale: 0.95, opacity: 0.6 }}
                        animate={{ scale: [0.95, 1.05, 0.95], opacity: [0.6, 0.25, 0.6] }}
                        transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
                      />
                      <motion.button
                        onClick={onTest}
                        whileHover={{ scale: 1.03 }}
                        whileTap={{ scale: 0.98 }}
                        disabled={testStatus === 'calling'}
                        className="group relative h-48 w-48 md:h-56 md:w-56 rounded-full select-none text-white font-extrabold text-3xl md:text-4xl tracking-wide focus:outline-none ring-2 ring-emerald-300 shadow-[0_20px_60px_rgba(16,185,129,.45)] bg-gradient-to-b from-emerald-400 to-emerald-600 disabled:opacity-70"
                        aria-label="Run TEST"
                      >
                        <span className="pointer-events-none absolute inset-x-8 top-4 h-8 rounded-full bg-white/30 blur-[2px] opacity-70" />
                        <span className="drop-shadow-sm">
                          {testStatus === 'calling' ? 'Testing…' : testStatus === 'ok' ? 'AGAIN' : 'TEST'}
                        </span>
                      </motion.button>

                      {!!testMsg && (
                        <div
                          className={`rounded-full px-4 py-1.5 text-sm font-semibold ring-1 ${
                            testStatus === 'ok'
                              ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                              : testStatus === 'error'
                              ? 'bg-red-50 text-red-700 ring-red-200'
                              : 'bg-white text-slate-600 ring-slate-200'
                          }`}
                        >
                          {testMsg}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </motion.div>

          {/* CSS keyframes for packet/glow animation */}
          <style
            dangerouslySetInnerHTML={{
              __html: `
              @keyframes packet {
                0% { offset-distance: 0%; opacity: .0; }
                6% { opacity: 1; }
                94% { opacity: 1; }
                100% { offset-distance: 100%; opacity: .0; }
              }
              @keyframes packetReverse {
                0% { offset-distance: 100%; opacity: .0; }
                6% { opacity: 1; }
                94% { opacity: 1; }
                100% { offset-distance: 0%; opacity: .0; }
              }
              @keyframes glider {
                0% { offset-distance: 0%; opacity: .0; transform: scale(.9); }
                8% { opacity: .95; }
                92% { opacity: .95; }
                100% { offset-distance: 100%; opacity: 0; transform: scale(1.05); }
              }
              @keyframes gliderReverse {
                0% { offset-distance: 100%; opacity: .0; transform: scale(.9); }
                8% { opacity: .95; }
                92% { opacity: .95; }
                100% { offset-distance: 0%; opacity: 0; transform: scale(1.05); }
              }`,
            }}
          />
        </>
      )}
    </AnimatePresence>
  );
}

function StatusBanner({
  status,
  mac,
  error,
}: {
  status: 'idle' | 'searching' | 'success' | 'error';
  mac: string | null;
  error: string | null;
}) {
  if (status === 'success') {
    return (
      <div className="mx-6 rounded-2xl bg-emerald-50 px-4 py-4 text-center ring-1 ring-emerald-200">
        <div className="text-[13px] font-semibold uppercase tracking-widest text-emerald-600">Found ESP</div>
        <div className="mt-1 text-2xl md:text-3xl font-mono font-bold text-emerald-700">{mac}</div>
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className="mx-6 rounded-2xl bg-red-50 px-4 py-3 text-center text-[15px] font-medium text-red-700 ring-1 ring-red-200">
        {error || 'Discovery failed.'}
      </div>
    );
  }
  return (
    <div className="mx-6 rounded-2xl bg-white px-4 py-3 text-center text-[15px] font-medium text-slate-700 ring-1 ring-slate-200">
      <div className="flex items-center justify-center gap-3">
        <span>Connecting to ESP over Wi-Fi…</span>
        <LoadingDots />
      </div>
    </div>
  );
}

function LoadingDots() {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="h-2 w-2 animate-bounce rounded-full bg-indigo-400 [animation-delay:-200ms]" />
      <span className="h-2 w-2 animate-bounce rounded-full bg-indigo-400 [animation-delay:-100ms]" />
      <span className="h-2 w-2 animate-bounce rounded-full bg-indigo-400" />
    </span>
  );
}

/* Diagram (taller boards, labels, richer Wi-Fi) */
function EspLinkAnimation({ searching, success, big = false }: { searching: boolean; success: boolean; big?: boolean }) {
  // Canvas
  const W = big ? 1400 : 760;
  const H = big ? 520 : 280;

  // Board size (taller than before)
  const BOARD_W = big ? 240 : 170;
  const BOARD_H = big ? 300 : 210;

  // Layout
  const leftMargin = big ? 140 : 90;
  const rightMargin = leftMargin; // keep symmetrical
  const yMid = H / 2;

  // Link path from board edges (so button sits exactly between)
  const xStart = leftMargin + BOARD_W;
  const xEnd = W - rightMargin - BOARD_W;
  const arc = big ? 140 : 82;
  const linkPath = `M ${xStart} ${yMid} C ${W / 2 - 200} ${yMid - arc}, ${W / 2 + 200} ${yMid - arc}, ${xEnd} ${yMid}`;
  const linkColor = success ? 'rgba(16,185,129,.9)' : 'rgba(99,102,241,.85)';

  return (
    <div className="relative mx-auto w-full overflow-hidden rounded-xl bg-gradient-to-b from-white to-slate-50">
      <svg viewBox={`0 0 ${W} ${H}`} className={`block w-full ${big ? 'h-[520px]' : 'h-[280px]'}`}>
        <defs>
          <pattern id="grid" width="16" height="16" patternUnits="userSpaceOnUse">
            <path d="M 16 0 L 0 0 0 16" fill="none" stroke="rgba(2,6,23,.06)" strokeWidth="1" />
          </pattern>
          <radialGradient id="glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={success ? 'rgba(16,185,129,.6)' : 'rgba(99,102,241,.55)'} />
            <stop offset="100%" stopColor="rgba(0,0,0,0)" />
          </radialGradient>
          <filter id="boardShadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="10" stdDeviation="10" floodColor="rgba(2,6,23,.18)" />
          </filter>
        </defs>

        <rect x="0" y="0" width={W} height={H} fill="url(#grid)" />

        {/* Link */}
        <motion.path
          d={linkPath}
          fill="none"
          stroke={linkColor}
          strokeWidth={big ? 6 : 4.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={success ? '0 0' : '16 18'}
          animate={searching ? { strokeDashoffset: [0, -72] } : { strokeDashoffset: 0 }}
          transition={{ duration: searching ? 1.1 : 0.35, repeat: searching ? Infinity : 0, ease: 'linear' }}
        />

        {/* Boards */}
        <g transform={`translate(${leftMargin}, ${yMid - BOARD_H / 2})`} filter="url(#boardShadow)">
          <EspBoard big={big} active={searching || success} />
        </g>
        <g transform={`translate(${W - rightMargin - BOARD_W}, ${yMid - BOARD_H / 2})`} filter="url(#boardShadow)">
          <EspBoard big={big} active={success} right />
        </g>

        {/* Labels */}
        <text
          x={leftMargin + BOARD_W / 2}
          y={yMid + BOARD_H / 2 + 48}
          textAnchor="middle"
          fontFamily="ui-sans-serif"
          fontWeight={700}
          fontSize={big ? 32 : 24}
          fill="rgba(2,6,23,.65)"
        >
          STATION
        </text>
        <text
          x={W - rightMargin - BOARD_W / 2}
          y={yMid + BOARD_H / 2 + 48}
          textAnchor="middle"
          fontFamily="ui-sans-serif"
          fontWeight={700}
          fontSize={big ? 32 : 24}
          fill="rgba(2,6,23,.65)"
        >
          KFB BOARD
        </text>

        {/* Wi-Fi pings near connectors */}
        <WifiPulse x={xStart} y={yMid} searching={searching} success={success} />
        <WifiPulse x={xEnd} y={yMid} right searching={searching} success={success} />

        {/* endpoint glows */}
        <circle cx={xStart} cy={yMid} r={big ? 36 : 24} fill="url(#glow)" />
        <circle cx={xEnd} cy={yMid} r={big ? 36 : 24} fill="url(#glow)" />
      </svg>

      {/* Moving glow */}
      <MovingGlow path={linkPath} duration={2.4} size={big ? 22 : 16} color={linkColor} />
      <MovingGlow path={linkPath} duration={2.7} size={big ? 18 : 14} color={linkColor} reverse />

      {/* Dots only while searching */}
      {searching && (
        <>
          <PacketStream path={linkPath} duration={2.6} count={4} />
          <PacketStream path={linkPath} duration={2.8} count={4} reverse />
        </>
      )}

{/* Bottom status chip */}
<div className="pointer-events-none absolute inset-x-0 bottom-5 flex justify-center">
  <div
    className={[
      // shape + layout
      'inline-flex items-center gap-2 md:gap-3 rounded-full',
      'px-4 py-2 md:px-5 md:py-2.5',
      'text-[20px] md:text-[26px] font-semibold leading-none',
      // glass / shadow / ring
      'backdrop-blur-md shadow-[0_8px_24px_rgba(2,6,23,.15)] ring-1',
      // state colors
      success
        ? 'bg-emerald-50/90 text-emerald-700 ring-emerald-200'
        : 'bg-indigo-50/90 text-indigo-700 ring-indigo-200',
    ].join(' ')}
  >
    {success ? (
      <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
    ) : (
      <span className="inline-flex items-center gap-1">
        <span className="h-2 w-2 animate-bounce rounded-full bg-indigo-400 [animation-delay:-200ms]" />
        <span className="h-2 w-2 animate-bounce rounded-full bg-indigo-400 [animation-delay:-100ms]" />
        <span className="h-2 w-2 animate-bounce rounded-full bg-indigo-400" />
      </span>
    )}

    <span>{success ? 'Connected' : 'Searching the new KFB BOARD'}</span>
  </div>
</div>

    </div>
  );
}

/** Taller ESP32-style board */
function EspBoard({ big = false, active = false }: { big?: boolean; active?: boolean }) {
  const w = big ? 240 : 170;
  const h = big ? 300 : 210; // << taller

  const pcb = '#0b1220';
  const silk = 'rgba(255,255,255,.28)';
  const pinGold = '#d4af37';

  const holeR = big ? 5.5 : 4;
  const headerPins = big ? 22 : 18;

  const shieldW = w * 0.72;
  const shieldH = h * 0.32;
  const shieldX = (w - shieldW) / 2;
  const shieldY = h * 0.07;

  const btnW = w * 0.11;
  const btnH = h * 0.07;
  const btnY = h * 0.58;

  const usbW = w * 0.18;
  const usbH = h * 0.09;

  const ledY = h * 0.63;
  const ledR = big ? 5.2 : 4.2;

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      {/* PCB */}
      <rect x="2" y="2" width={w - 4} height={h - 4} rx="16" fill={pcb} stroke="rgba(255,255,255,.06)" strokeWidth="2" />

      {/* Mounting holes */}
      <circle cx="14" cy="14" r={holeR} fill="#cbd5e1" />
      <circle cx={w - 14} cy="14" r={holeR} fill="#cbd5e1" />
      <circle cx="14" cy={h - 14} r={holeR} fill="#cbd5e1" />
      <circle cx={w - 14} cy={h - 14} r={holeR} fill="#cbd5e1" />

      {/* Headers */}
      {Array.from({ length: headerPins }).map((_, i) => {
        const y = 20 + i * ((h - 40) / headerPins);
        return <rect key={`lp-${i}`} x="8" y={y} width="6" height="6" rx="1.5" fill={pinGold} />;
      })}
      {Array.from({ length: headerPins }).map((_, i) => {
        const y = 20 + i * ((h - 40) / headerPins);
        return <rect key={`rp-${i}`} x={w - 14} y={y} width="6" height="6" rx="1.5" fill={pinGold} />;
      })}

      {/* Module shield */}
      <defs>
        <linearGradient id="shield" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#e5e7eb" />
          <stop offset="100%" stopColor="#9ca3af" />
        </linearGradient>
        <linearGradient id="usb" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="#9ca3af" />
          <stop offset="100%" stopColor="#e5e7eb" />
        </linearGradient>
      </defs>
      <rect x={shieldX} y={shieldY} width={shieldW} height={shieldH} rx="6" fill="url(#shield)" stroke="#6b7280" />
      {/* Antenna meander */}
      <path
        d={`M ${shieldX + 6} ${shieldY + 6} h ${shieldW * 0.34} v ${shieldH * 0.14} h -${shieldW * 0.08} v ${shieldH * 0.12} h ${shieldW * 0.08} v ${
          shieldH * 0.15
        } h -${shieldW * 0.08} v ${shieldH * 0.12} h ${shieldW * 0.08}`}
        fill="none"
        stroke="#384152"
        strokeWidth={big ? 2.4 : 2}
      />

      {/* EN / BOOT */}
      <rect x={w * 0.12} y={btnY} width={btnW} height={btnH} rx="3" fill="#1f2937" stroke={silk} />
      <rect x={w - w * 0.12 - btnW} y={btnY} width={btnW} height={btnH} rx="3" fill="#1f2937" stroke={silk} />
      <text x={w * 0.12 + btnW / 2} y={btnY + btnH + (big ? 18 : 14)} fontSize={big ? 10.5 : 8.5} fill={silk} textAnchor="middle" fontFamily="ui-sans-serif">
        EN
      </text>
      <text x={w - (w * 0.12 + btnW / 2)} y={btnY + btnH + (big ? 18 : 14)} fontSize={big ? 10.5 : 8.5} fill={silk} textAnchor="middle" fontFamily="ui-sans-serif">
        BOOT
      </text>

      {/* USB */}
      <rect x={w / 2 - usbW / 2} y={h - usbH - 12} width={usbW} height={usbH} rx="3" fill="url(#usb)" stroke="#6b7280" />
      <rect x={w / 2 - (usbW * 0.55) / 2} y={h - usbH / 2 - 9} width={usbW * 0.55} height={usbH * 0.3} rx="1" fill="#374151" />

      {/* LEDs */}
      <circle cx={w * 0.36} cy={ledY} r={ledR} fill={active ? '#22c55e' : '#64748b'} />
      <circle cx={w * 0.64} cy={ledY} r={ledR} fill={active ? '#818cf8' : '#64748b'} />

      {/* silk bar */}
      <rect x={shieldX} y={h * 0.76} width={shieldW} height={big ? 6 : 4} rx="1.5" fill="rgba(255,255,255,.06)" />
    </svg>
  );
}

function WifiPulse({
  x,
  y,
  right = false,
  searching,
  success,
}: {
  x: number;
  y: number;
  right?: boolean;
  searching: boolean;
  success: boolean;
}) {
  const dir = right ? -1 : 1;
  const color1 = success ? 'rgba(16,185,129,.55)' : 'rgba(99,102,241,.55)';
  const color2 = success ? 'rgba(16,185,129,.40)' : 'rgba(99,102,241,.40)';
  const color3 = success ? 'rgba(16,185,129,.25)' : 'rgba(99,102,241,.25)';
  const base = `M ${x} ${y} q ${30 * dir} -20 ${60 * dir} 0`;
  const mid = `M ${x} ${y} q ${48 * dir} -32 ${96 * dir} 0`;
  const big = `M ${x} ${y} q ${66 * dir} -44 ${132 * dir} 0`;

  const dur = searching ? 1.5 : 2.4;

  return (
    <>
      <motion.path d={base} fill="none" stroke={color1} strokeWidth="2" initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 0] }} transition={{ duration: dur, repeat: Infinity }} />
      <motion.path d={mid} fill="none" stroke={color2} strokeWidth="2" initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 0] }} transition={{ duration: dur, repeat: Infinity, delay: 0.18 }} />
      <motion.path d={big} fill="none" stroke={color3} strokeWidth="2" initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 0] }} transition={{ duration: dur, repeat: Infinity, delay: 0.36 }} />

      {/* Soft expanding ping */}
      <motion.circle
        cx={x + (right ? -4 : 4)}
        cy={y - 2}
        r={6}
        initial={{ r: 0, opacity: 0.4 }}
        animate={{ r: [0, 18, 26], opacity: [0.4, 0.2, 0] }}
        transition={{ duration: searching ? 1.6 : 2.8, repeat: Infinity, ease: 'easeOut' }}
        fill={success ? 'rgba(16,185,129,.25)' : 'rgba(99,102,241,.25)'}
      />
    </>
  );
}

function MovingGlow({
  path,
  duration = 2.4,
  reverse = false,
  size = 18,
  color = 'rgba(99,102,241,1)',
}: {
  path: string;
  duration?: number;
  reverse?: boolean;
  size?: number;
  color?: string;
}) {
  return (
    <span
      className="pointer-events-none absolute"
      style={
        {
          width: size,
          height: size,
          borderRadius: '9999px',
          boxShadow: `0 0 ${size * 1.4}px ${Math.max(6, size * 0.3)}px ${color}`,
          background: color,
          // @ts-ignore
          offsetPath: `path('${path}')`,
          offsetRotate: '0deg',
          animation: `${reverse ? 'gliderReverse' : 'glider'} ${duration}s linear 0s infinite`,
        } as React.CSSProperties
      }
    />
  );
}

function PacketStream({ path, duration = 2.6, count = 3, reverse = false }: { path: string; duration?: number; count?: number; reverse?: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-0">
      {Array.from({ length: count }).map((_, i) => (
        <span
          key={i}
          className="absolute h-2 w-2 rounded-full shadow-[0_0_0_5px_rgba(99,102,241,.15)]"
          style={
            {
              background: 'rgb(99 102 241)',
              // @ts-ignore
              offsetPath: `path('${path}')`,
              offsetRotate: '0deg',
              animation: `${reverse ? 'packetReverse' : 'packet'} ${duration}s linear ${i * (duration / count)}s infinite`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
