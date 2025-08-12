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

function useAnchorRect<T extends HTMLElement>(
  active: boolean,
  ref: React.RefObject<T | null>
) {
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


/* ────────────────────────────────────────────────────────────────────────────
 * Component
 * ──────────────────────────────────────────────────────────────────────────── */
export const SettingsPageContent: React.FC<SettingsPageContentProps> = ({
  onNavigateBack,
  onShowProgramForConfig,
}) => {
  const [currentConfig, setCurrentConfig] =
    useState<ConfigurationFormData>(initialFormState);
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [configurations, setConfigurations] = useState<Configuration[]>([]);
  const [formNotification, setFormNotification] = useState<NotificationType>({
    message: null,
    type: null,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [filterText, setFilterText] = useState('');

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [configToDelete, setConfigToDelete] = useState<number | null>(null);

  // Discover ESP modal state
  const [discoverOpen, setDiscoverOpen] = React.useState(false);
  const [discoverStatus, setDiscoverStatus] = useState<'idle' | 'searching' | 'success' | 'error'>('idle');
  const [foundMac, setFoundMac] = useState<string | null>(null);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [autoCloseEnabled, setAutoCloseEnabled] = useState(true);
  const [countdown, setCountdown] = useState<number | null>(null);

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
      const hit = configurations.find(c => c.id === editingId);
      if (hit) {
        setCurrentConfig({
          id: hit.id,
          kfb: hit.kfb,
          mac_address: hit.mac_address,
          branchPins: hit.branchPins.map(b => b.name),
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
  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setCurrentConfig(prev => ({ ...prev, [name]: value }));
    setFormNotification({ message: null, type: null });
  };

  const handleKfbInfoChange = (index: number, value: string) => {
    setCurrentConfig(prev => {
      const next = [...prev.kfbInfo];
      next[index] = value;
      return { ...prev, kfbInfo: next };
    });
    setFormNotification({ message: null, type: null });
  };

  const handleAddKfbInfo = () => {
    setCurrentConfig(prev => ({ ...prev, kfbInfo: [...prev.kfbInfo, ''] }));
  };

  const handleRemoveKfbInfo = (index: number) => {
    setCurrentConfig(prev => {
      const next = prev.kfbInfo.filter((_, i) => i !== index);
      return { ...prev, kfbInfo: next.length ? next : [''] };
    });
  };

  /* Save / Delete */
  const handleSaveConfiguration = async () => {
    const payload = {
      kfb: currentConfig.kfb,
      mac_address: currentConfig.mac_address,
      kfbInfo: currentConfig.kfbInfo.filter(s => s.trim() !== ''),
      branchPins: currentConfig.branchPins,
      espPinMappings: currentConfig.espPinMappings,
    };

    setFormNotification({ message: null, type: null });
    setIsLoading(true);

    try {
      const url = isEditing
        ? `/api/configurations/${currentConfig.id}`
        : '/api/configurations';
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
    setCurrentConfig(prev => ({ ...prev, espPinMappings: { ...(prev.espPinMappings || {}), [pin]: branch } }));
  };
  const handleUnassignBranchFromEspPin = (pin: string) => {
    setCurrentConfig(prev => {
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
      c =>
        c.kfb.toLowerCase().includes(q) ||
        c.mac_address.toLowerCase().includes(q) ||
        c.kfbInfo.some(info => info.toLowerCase().includes(q))
    );
  }, [configurations, filterText]);

    /* Spotlights / hole */
    const formRef = useRef<HTMLDivElement>(null);
    const editRect = useAnchorRect(isEditing, formRef);

    const macWrapperRef = useRef<HTMLDivElement>(null);
    const discoverRect = useAnchorRect(discoverOpen, macWrapperRef);


  const startDiscover = async () => {
    setAutoCloseEnabled(true);
    setCountdown(null);
    setDiscoverOpen(true);
    setDiscoverStatus('searching');
    setDiscoverError(null);
    setFoundMac(null);
    try {
      const res = await fetch('/api/esp/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kfb: currentConfig.kfb || undefined }),
      });
      if (!res.ok) throw new Error(await res.text());

      const raw = (await res.json()) as { macAddress?: string; error?: string };
      const mac = raw.macAddress;                // <- take into a local
      if (!mac) throw new Error(raw.error || 'No MAC returned');

      setFoundMac(mac);
      setCurrentConfig(prev => ({ ...prev, mac_address: mac })); // <- mac is string
      setDiscoverStatus('success');
    } catch (e: any) {
      setDiscoverStatus('error');
      setDiscoverError(e?.message || 'Discovery failed');
    }
  };

  const retryDiscover = async () => {
    setAutoCloseEnabled(false);
    setCountdown(null);
    setDiscoverStatus('searching');
    setDiscoverError(null);
    setFoundMac(null);
    try {
      const res = await fetch('/api/esp/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kfb: currentConfig.kfb || undefined }),
      });
      if (!res.ok) throw new Error(await res.text());

      const raw = (await res.json()) as { macAddress?: string; error?: string };
      const mac = raw.macAddress;                // <- take into a local
      if (!mac) throw new Error(raw.error || 'No MAC returned');

      setFoundMac(mac);
      setCurrentConfig(prev => ({ ...prev, mac_address: mac })); // <- mac is string
      setDiscoverStatus('success');
    } catch (e: any) {
      setDiscoverStatus('error');
      setDiscoverError(e?.message || 'Discovery failed');
    }
  };

  // Auto-close when success + enabled
  useEffect(() => {
    if (!discoverOpen) return;
    if (discoverStatus !== 'success' || !autoCloseEnabled) return;

    setCountdown(3); // keep your current 3-second close
    const id = setInterval(() => {
      setCountdown(prev => {
        if (prev == null) return null;
        if (prev <= 1) {
          clearInterval(id);
          setDiscoverOpen(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [discoverOpen, discoverStatus, autoCloseEnabled]);

  /* Loading screen */
  if (isLoading && configurations.length === 0 && !formNotification.message) {
    return (
      <div className="flex-grow w-full min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-10">
        <motion.p
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={headerSpring}
          className="text-slate-700 dark:text-slate-300 text-[22px] font-medium"
        >
          Loading configurations…
        </motion.p>
      </div>
    );
  }

  const needsKfb = isEditing && !currentConfig.kfb.trim();
  const needsMac = isEditing && !currentConfig.mac_address.trim();
  const needsInfo = isEditing && currentConfig.kfbInfo.every(s => !s.trim());

  const macPulseActive = discoverOpen && discoverStatus === 'success';

  return (
    <div className="flex-grow w-full min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 p-4 sm:p-6 lg:p-6 flex flex-col">

      {/* Header */}
      <motion.header
        initial={{ y: -8, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={headerSpring}
        className={`sticky top-0 z-30 ${sheetCard} rounded-2xl px-4 sm:px-5 py-3 mb-4`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {onNavigateBack && (
              <button
                onClick={onNavigateBack}
                className="inline-flex items-center gap-2 rounded-full bg-white/90 dark:bg-slate-800/70 px-4 py-2 text-[15px] font-semibold text-slate-800 dark:text-slate-100 ring-1 ring-slate-200 dark:ring-white/10 hover:bg-white shadow-sm active:scale-[0.99]"
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                Dashboard
              </button>
            )}
            <h1 className="ml-1 text-lg font-semibold text-slate-900 dark:text-white">
              KFB Configurations
            </h1>
          </div>
 
        </div>
      </motion.header>

      {/* Editing spotlight overlay */}
      <AnimatePresence>
        {isEditing && editRect && (
          <>
            <motion.div
              key="spot-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={fade}
              className="fixed inset-0 z-[35] bg-black/50 backdrop-blur-sm"
            />
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
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">
              KFB Number
            </label>
            <input
              type="text"
              name="kfb"
              id="kfb"
              value={currentConfig.kfb}
              onChange={handleInputChange}
              className={`${inputBase} ${needsKfb ? 'ring-sky-400/80 focus:ring-sky-500' : ''}`}
              placeholder="IW12345678"
            />
          </div>

          {/* MAC + Discover */}
          <div ref={macWrapperRef} className="space-y-2 relative">
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">
              MAC Address
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                name="mac_address"
                value={currentConfig.mac_address}
                onChange={handleInputChange}
                className={`${inputBase} ${
                  macPulseActive
                    ? 'bg-emerald-50 ring-emerald-400 shadow-[0_0_0_4px_rgba(16,185,129,.18)]'
                    : ''
                }`}
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
          <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3">
            KFB Info
          </label>
          <div className="space-y-3">
            {currentConfig.kfbInfo.map((info, idx) => (
              <motion.div
                key={`kfb-${idx}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={cardSpring}
                className="flex items-center gap-3"
              >
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
                : typeof val === 'string' && val !== ''
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

      {/* Overview */}
      <motion.section
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={cardSpring}
        className={`${tileCard} rounded-3xl overflow-hidden`}
      >
       <div className="bg-white/80 dark:bg-slate-900/60 backdrop-blur border-b border-slate-200/70 dark:border-slate-700/60 px-6 py-4">
  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
    <h2 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white">
      Overview
    </h2>

    <input
      type="text"
      value={filterText}
      onChange={(e) => setFilterText(e.target.value)}
      placeholder="Search KFB, MAC, info…"
      className={`${inputBase} w-full sm:w-[28rem] max-w-full`}
    />
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
                  <th
                    key={h}
                    className="bg-white/90 dark:bg-slate-900/70 backdrop-blur text-left text-slate-600 dark:text-slate-300 font-semibold px-6 py-3 border-b border-slate-200/80 dark:border-slate-700/60"
                  >
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
                      <td className="px-6 py-4 text-slate-800 dark:text-slate-100 border-b border-slate-200/70 dark:border-slate-700/60">
                        {config.kfb}
                      </td>
                      <td className="px-6 py-4 text-slate-800 dark:text-slate-100 border-b border-slate-200/70 dark:border-slate-700/60">
                        {config.mac_address || <span className="text-slate-400">—</span>}
                      </td>
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

      {/* Delete Confirmation Modal */}
     {/* Delete Confirmation Popover (anchored) */}
<AnimatePresence>
  {showDeleteModal && deleteAnchor && (
    <>
      {/* Backdrop with a cutout around the popover */}
      {(() => {
        // popover layout
        const POPOVER_W = 520;
        const margin = 12;
        const top = Math.min(
          window.innerHeight - 16,
          deleteAnchor.bottom + margin
        );
        const left = Math.max(
          8,
          Math.min(window.innerWidth - POPOVER_W - 8, deleteAnchor.right - POPOVER_W)
        );

        return (
          <>
            {/* Masked overlay (shadows everything except the popover rect) */}
         <motion.svg
          className="fixed inset-0 z-[80] w-screen h-screen"
          width="100%"
          height="100%"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={fade}
          onClick={cancelDelete}
        >
          <defs>
            <mask
              id="del-cutout"
              x="0" y="0" width="100%" height="100%"
              maskUnits="userSpaceOnUse"
              maskContentUnits="userSpaceOnUse"  // <-- important
            >
              <rect x="0" y="0" width="100%" height="100%" fill="white" />
              <rect
                x={left - 8}
                y={top - 8}
                width={POPOVER_W + 16}
                height={220}
                rx={16}
                ry={16}
                fill="black"
              />
            </mask>
          </defs>

          <rect x="0" y="0" width="100%" height="100%" fill="rgba(0,0,0,.6)" mask="url(#del-cutout)" />
        </motion.svg>


            {/* Popover card */}
            <motion.div
              ref={delModalRef}
              key="del-pop"
              initial={{ opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={cardSpring}
              className={`${sheetCard} fixed z-[90] rounded-2xl p-6 sm:p-7 shadow-2xl`}
              style={{ top, left, width: POPOVER_W }}
              role="dialog"
              aria-modal="true"
            >
              {/* little caret */}
              <div
                className="absolute -top-2 right-8 h-4 w-4 rotate-45 bg-white dark:bg-slate-900 ring-1 ring-black/5"
              />
              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/50">
                  <ExclamationTriangleIcon className="h-6 w-6 text-red-600 dark:text-red-400" />
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                    Delete Configuration
                  </h3>
                  <p className="mt-1 text-[14px] text-slate-600 dark:text-slate-300">
                    Are you sure you want to delete this configuration? This action cannot be undone.
                  </p>
                </div>
              </div>

              <div className="mt-5 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={cancelDelete}
                  className="rounded-full bg-white/90 px-5 py-2.5 text-[14px] font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-white active:scale-[0.99]"
                >
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
        );
      })()}
    </>
  )}
</AnimatePresence>


      {/* Discover ESP modal + rounded hole overlay */}
      <AnimatePresence>
        {discoverOpen && (
          <>
            {/* Rounded HOLE overlay (no highlighted square corners) */}
          {/* Blur + darken everything except the MAC field (4-strip cutout) */}
{discoverRect ? (
  <>
    {/* top */}
    <motion.div
      className="fixed left-0 right-0 z-[80] bg-black/60 backdrop-blur-md"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={fade}
      style={{ top: 0, height: Math.max(0, discoverRect.top - 12) }}
      onClick={() => setDiscoverOpen(false)}
    />
    {/* left */}
    <motion.div
      className="fixed top-0 z-[80] bg-black/60 backdrop-blur-md"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={fade}
      style={{
        top: Math.max(0, discoverRect.top - 12),
        left: 0,
        width: Math.max(0, discoverRect.left - 12),
        height: discoverRect.height + 24,
      }}
      onClick={() => setDiscoverOpen(false)}
    />
    {/* right */}
    <motion.div
      className="fixed top-0 right-0 z-[80] bg-black/60 backdrop-blur-md"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={fade}
      style={{
        top: Math.max(0, discoverRect.top - 12),
        left: discoverRect.left + discoverRect.width + 12,
        height: discoverRect.height + 24,
      }}
      onClick={() => setDiscoverOpen(false)}
    />
    {/* bottom */}
    <motion.div
      className="fixed left-0 right-0 bottom-0 z-[80] bg-black/60 backdrop-blur-md"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={fade}
      style={{ top: discoverRect.top + discoverRect.height + 12 }}
      onClick={() => setDiscoverOpen(false)}
    />
  </>
) : (
  <motion.div
    className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-md"
    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={fade}
    onClick={() => setDiscoverOpen(false)}
  />
)}


            {/* Highlight ring/pulse on success */}
            {discoverRect && (
              <>
                <motion.div
                  key="disc-ring"
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={cardSpring}
                  className={`pointer-events-none fixed z-[95] rounded-2xl ring-2 ${
                    discoverStatus === 'success' ? 'ring-emerald-500' : 'ring-indigo-500'
                  } ${discoverStatus === 'success' ? 'shadow-[0_0_0_10px_rgba(16,185,129,0.22)]' : 'shadow-[0_0_0_8px_rgba(99,102,241,0.25)]'}`}
                  style={{
                    top: Math.max(8, discoverRect.top - 8),
                    left: Math.max(8, discoverRect.left - 8),
                    width: discoverRect.width + 16,
                    height: discoverRect.height + 16,
                  }}
                />
                {discoverStatus === 'success' && (
                  <motion.div
                    key="disc-ring-pulse"
                    className="pointer-events-none fixed z-[94] rounded-3xl"
                    style={{
                      top: Math.max(8, discoverRect.top - 16),
                      left: Math.max(8, discoverRect.left - 16),
                      width: discoverRect.width + 32,
                      height: discoverRect.height + 32,
                      boxShadow: '0 0 0 0 rgba(16,185,129,0.18)',
                    }}
                    initial={{ scale: 0.98, opacity: 0.6 }}
                    animate={{ scale: [0.98, 1.06, 0.98], opacity: [0.6, 0.18, 0.6] }}
                    transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
                  />
                )}
              </>
            )}

            <DiscoverEspModal
              open={discoverOpen}
              status={discoverStatus}
              mac={foundMac}
              error={discoverError}
              countdown={countdown}
              autoCloseEnabled={autoCloseEnabled}
              onClose={() => setDiscoverOpen(false)}
              onRetry={retryDiscover}
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
 * Discover ESP Modal (bigger MAC banner, improved countdown with ripples)
 * ──────────────────────────────────────────────────────────────────────────── */

function DiscoverEspModal({
  open,
  onClose,
  onRetry,
  status,
  mac,
  error,
  countdown,
  autoCloseEnabled,
}: {
  open: boolean;
  onClose: () => void;
  onRetry: () => void;
  status: 'idle' | 'searching' | 'success' | 'error';
  mac: string | null;
  error: string | null;
  countdown: number | null;
  autoCloseEnabled: boolean;
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
            <div className="relative h-[min(88vh,820px)] w-[min(96vw,1400px)] overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-black/5">
              {/* Title bar */}
              <div className="flex items-center justify-between px-6 py-4">
                <h3 className="text-[18px] font-semibold text-slate-900">Discover ESP</h3>
                <div className="flex items-center gap-3">
                  {status !== 'searching' && (
                    <button
                      onClick={onRetry}
                      className="rounded-full bg-indigo-600 px-6 py-2.5 text-[14px] font-semibold text-white ring-1 ring-indigo-700/30 hover:bg-indigo-700 active:scale-[0.99]"
                    >
                      Retry
                    </button>
                  )}
                  <button
                    onClick={onClose}
                    className="rounded-full bg-white px-5 py-2.5 text-[14px] font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 active:scale-95"
                  >
                    Close
                  </button>
                </div>
              </div>

              {/* Status: bigger MAC banner on success */}
              <StatusBanner status={status} mac={mac} error={error} />

              {/* Animation panel */}
              <div className="px-6 pb-6">
                <div className="relative mt-4 overflow-hidden rounded-3xl bg-slate-50 p-4 ring-1 ring-slate-200">
                  <EspLinkAnimation
                    searching={status === 'searching'}
                    success={status === 'success'}
                    big
                  />

                  {/* Improved number-only countdown + CLOSING under it */}
                  {status === 'success' && autoCloseEnabled && countdown !== null && (
                    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
                      <div className="relative -mt-2 flex flex-col items-center">
                        {/* ripple ring burst each tick */}
                        <motion.div
                          key={`r1-${countdown}`}
                          initial={{ scale: 0.7, opacity: 0.35 }}
                          animate={{ scale: 1.5, opacity: 0 }}
                          transition={{ duration: 0.9, ease: 'easeOut' }}
                          className="absolute mx-auto -z-[1] h-[220px] w-[220px] rounded-full border-[6px] border-emerald-400/50 md:h-[300px] md:w-[300px] lg:h-[360px] lg:w-[360px]"
                        />
                        <motion.div
                          key={`r2-${countdown}`}
                          initial={{ scale: 0.5, opacity: 0.25 }}
                          animate={{ scale: 1.8, opacity: 0 }}
                          transition={{ duration: 1.1, ease: 'easeOut' }}
                          className="absolute mx-auto -z-[1] h-[180px] w-[180px] rounded-full border-[4px] border-emerald-300/40 md:h-[240px] md:w-[240px] lg:h-[300px] lg:w-[300px]"
                        />

                        <motion.span
                          key={`count-${countdown}`}
                          initial={{ y: 16, opacity: 0, scale: 0.9 }}
                          animate={{ y: 0, opacity: 1, scale: 1 }}
                          transition={{ type: 'spring', stiffness: 700, damping: 32 }}
                          className="select-none text-[8rem] md:text-[11rem] lg:text-[12rem] font-black leading-none tracking-tight text-emerald-600 drop-shadow-[0_10px_30px_rgba(16,185,129,.25)]"
                        >
                          {countdown}
                        </motion.span>

                        <motion.div
                          key={`closing-${countdown}`}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                          className="mt-4 rounded-full bg-emerald-500/15 px-6 py-2 text-[14px] md:text-[16px] font-extrabold uppercase tracking-[0.24em] text-emerald-700 ring-1 ring-emerald-300"
                        >
                          Closing
                        </motion.div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </motion.div>

          {/* CSS keyframes for packet animation */}
          <style
            dangerouslySetInnerHTML={{
              __html: `
              @keyframes packet {
                0% { offset-distance: 0%; opacity: .0; }
                5% { opacity: 1; }
                95% { opacity: 1; }
                100% { offset-distance: 100%; opacity: .0; }
              }
              @keyframes packetReverse {
                0% { offset-distance: 100%; opacity: .0; }
                5% { opacity: 1; }
                95% { opacity: 1; }
                100% { offset-distance: 0%; opacity: .0; }
              }
              `,
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
}: { status: 'idle' | 'searching' | 'success' | 'error'; mac: string | null; error: string | null }) {
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

/* Diagram */
function EspLinkAnimation({
  searching,
  success,
  big = false,
}: { searching: boolean; success: boolean; big?: boolean }) {
  const W = big ? 1200 : 720;
  const H = big ? 420 : 230;

  const linkPath = `M 160 ${H / 2} C ${W / 2 - 120} ${H / 2 - (big ? 110 : 70)}, ${W / 2 + 120} ${H / 2 - (big ? 110 : 70)}, ${W - 160} ${H / 2}`;

  return (
    <div className="relative mx-auto w-full overflow-hidden rounded-xl bg-gradient-to-b from-white to-slate-50">
      <svg viewBox={`0 0 ${W} ${H}`} className={`block w-full ${big ? 'h-[420px] md:h-[420px]' : 'h-[230px]'}`}>
        <defs>
          <pattern id="grid" width="16" height="16" patternUnits="userSpaceOnUse">
            <path d="M 16 0 L 0 0 0 16" fill="none" stroke="rgba(2,6,23,.06)" strokeWidth="1" />
          </pattern>
          <radialGradient id="glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(99,102,241,.55)" />
            <stop offset="100%" stopColor="rgba(99,102,241,0)" />
          </radialGradient>
        </defs>
        <rect x="0" y="0" width={W} height={H} fill="url(#grid)" />

        <motion.path
          d={linkPath}
          fill="none"
          stroke={success ? 'rgba(16,185,129,.8)' : 'rgba(99,102,241,.75)'}
          strokeWidth={big ? 4 : 3}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="12 14"
          animate={searching ? { strokeDashoffset: [0, -56] } : { strokeDashoffset: 0 }}
          transition={{ duration: 1.2, repeat: searching ? Infinity : 0, ease: 'linear' }}
        />

        <g transform={`translate(80, ${H / 2 - (big ? 80 : 48)})`}><EspBoard big={big} /></g>
        <g transform={`translate(${W - (big ? 200 : 60) - (big ? 160 : 120)}, ${H / 2 - (big ? 80 : 48)})`}><EspBoard big={big} /></g>

        <WifiPulse x={big ? 200 : 120} y={H / 2 - (big ? 10 : 6)} />
        <WifiPulse x={W - (big ? 200 : 120)} y={H / 2 - (big ? 10 : 6)} right />

        <circle cx={big ? 160 : 140} cy={H / 2} r={big ? 28 : 22} fill="url(#glow)" />
        <circle cx={W - (big ? 160 : 140)} cy={H / 2} r={big ? 28 : 22} fill="url(#glow)" />
      </svg>

      {searching && (
        <>
          <PacketStream path={linkPath} duration={2.6} count={4} />
          <PacketStream path={linkPath} duration={2.8} count={4} reverse />
        </>
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-[12px] text-slate-500">
        {success ? 'Connected' : 'Searching nearby boards…'}
      </div>
    </div>
  );
}

function EspBoard({ big = false }: { big?: boolean }) {
  const w = big ? 160 : 120;
  const h = big ? 128 : 96;
  const pinCount = big ? 18 : 14;

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <rect x="2" y="2" width={w - 4} height={h - 4} rx="10" className="fill-white" />
      <rect x="2" y="2" width={w - 4} height={h - 4} rx="10" className="fill-none" stroke="rgba(2,6,23,.12)" strokeWidth="2" />
      <rect x="2" y="2" width={w - 4} height={big ? 20 : 16} rx="10" className="fill-slate-100" />
      <rect x="12" y={big ? 28 : 24} width={big ? 72 : 52} height={big ? 68 : 48} rx="5" className="fill-slate-200" />
      <rect x="12" y={big ? 28 : 24} width={big ? 72 : 52} height={big ? 68 : 48} rx="5" className="fill-none" stroke="rgba(2,6,23,.18)" />
      <rect x={big ? 92 : 72} y={big ? 30 : 26} width={big ? 42 : 30} height={big ? 30 : 22} rx="4" className="fill-slate-300" />
      <rect x={big ? 92 : 72} y={big ? 64 : 52} width={big ? 20 : 14} height={big ? 14 : 10} rx="3" className="fill-slate-300" />
      <rect x={big ? 116 : 88} y={big ? 64 : 52} width={big ? 20 : 14} height={big ? 14 : 10} rx="3" className="fill-slate-300" />
      <rect x={big ? 92 : 72} y={big ? 84 : 66} width={big ? 14 : 10} height={big ? 10 : 6} rx="3" className="fill-slate-300" />
      <rect x={big ? 110 : 84} y={big ? 84 : 66} width={big ? 26 : 18} height={big ? 10 : 6} rx="3" className="fill-slate-300" />
      {Array.from({ length: pinCount }).map((_, i) => (
        <rect key={`l-${i}`} x="0" y={(big ? 22 : 18) + i * (big ? 6 : 5)} width="4" height={big ? 4 : 3} className="fill-slate-200" />
      ))}
      {Array.from({ length: pinCount }).map((_, i) => (
        <rect key={`r-${i}`} x={w - 4} y={(big ? 22 : 18) + i * (big ? 6 : 5)} width="4" height={big ? 4 : 3} className="fill-slate-200" />
      ))}
    </svg>
  );
}

function WifiPulse({ x, y, right = false }: { x: number; y: number; right?: boolean }) {
  const dir = right ? -1 : 1;
  const base = `M ${x} ${y} q ${18 * dir} -14 ${36 * dir} 0`;
  const mid = `M ${x} ${y} q ${26 * dir} -22 ${52 * dir} 0`;
  const big = `M ${x} ${y} q ${34 * dir} -30 ${68 * dir} 0`;
  return (
    <>
      <motion.path d={base} fill="none" stroke="rgba(99,102,241,.55)" strokeWidth="2"
        initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 0] }} transition={{ duration: 1.6, repeat: Infinity }} />
      <motion.path d={mid} fill="none" stroke="rgba(99,102,241,.4)" strokeWidth="2"
        initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 0] }} transition={{ duration: 1.6, repeat: Infinity, delay: .2 }} />
      <motion.path d={big} fill="none" stroke="rgba(99,102,241,.25)" strokeWidth="2"
        initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 0] }} transition={{ duration: 1.6, repeat: Infinity, delay: .4 }} />
    </>
  );
}

function PacketStream({
  path,
  duration = 2.6,
  count = 3,
  reverse = false
}: { path: string; duration?: number; count?: number; reverse?: boolean }) {
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
              animation: `${reverse ? 'packetReverse' : 'packet'} ${duration}s linear ${i * (duration / count)}s infinite`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
