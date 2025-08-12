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
  'block w-full rounded-2xl px-5 py-4 text-[17px] bg-white/80 dark:bg-slate-800/70 ring-1 ring-slate-200/80 dark:ring-white/10 placeholder:text-slate-400 dark:placeholder:text-slate-500 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-400 focus:ring-offset-2 focus:ring-offset-white/60 dark:focus:ring-offset-slate-900/40 shadow-inner';

/* Framer transitions (typed, so no TS error) */
const headerSpring: Transition = { type: 'spring', stiffness: 520, damping: 40 };
const cardSpring: Transition = { type: 'spring', stiffness: 520, damping: 45 };
const fade: Transition = { type: 'tween', duration: 0.18 };

/* Highlight a DOMRect (used for edit + discover spotlights) */
function useAnchorRect(active: boolean, ref: React.RefObject<HTMLElement>) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    if (!active) return;
    const calc = () => {
      if (!ref.current) return setRect(null);
      setRect(ref.current.getBoundingClientRect());
    };
    calc();
    window.addEventListener('resize', calc);
    window.addEventListener('scroll', calc, true);
    (window.visualViewport ?? window).addEventListener?.('resize', calc);
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

  const [showEspBranchModal, setShowEspBranchModal] = useState(false);
  const [pinToAssign, setPinToAssign] = useState<string | null>(null);

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

  const requestDelete = (id: number) => {
    setConfigToDelete(id);
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

  /* ESP mapping (kept) */
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

  /* Filter (KFB, MAC, info only) */
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

  /* Editing spotlight */
  const formRef = useRef<HTMLDivElement>(null);
  const editRect = useAnchorRect(isEditing, formRef);

  /* Discover ESP spotlight anchor (around the MAC input area) */
  const macWrapperRef = useRef<HTMLDivElement>(null);
  const discoverRect = useAnchorRect(discoverOpen, macWrapperRef);

  /* Discovery flow */
  const startDiscover = async () => {
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
      const data = (await res.json()) as { macAddress?: string; error?: string };
      if (!data.macAddress) throw new Error(data.error || 'No MAC returned');
      setFoundMac(data.macAddress);
      setCurrentConfig(prev => ({ ...prev, mac_address: data.macAddress }));
      setDiscoverStatus('success');
    } catch (e: any) {
      setDiscoverStatus('error');
      setDiscoverError(e?.message || 'Discovery failed');
    }
  };

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
          <input
            type="text"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder="Search KFB, MAC, info…"
            className={`${inputBase} max-w-xl`}
          />
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
          <div ref={macWrapperRef} className="space-y-2">
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">
              MAC Address
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                name="mac_address"
                value={currentConfig.mac_address}
                onChange={handleInputChange}
                className={inputBase}
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
          <h2 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white">Overview</h2>
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
                            onClick={() => requestDelete(config.id)}
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
      <AnimatePresence>
        {showDeleteModal && (
          <>
            <motion.div
              key="del-backdrop"
              className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-md"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={fade}
              onClick={cancelDelete}
            />
            <motion.div
              key="del-modal"
              initial={{ opacity: 0, y: 14, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 14, scale: 0.98 }}
              transition={cardSpring}
              className={`${sheetCard} fixed inset-0 z-[90] mx-auto my-auto w-[min(92vw,560px)] rounded-2xl p-6 sm:p-8`}
              role="dialog" aria-modal="true"
            >
              <div className="flex items-start gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/50">
                  <ExclamationTriangleIcon className="h-7 w-7 text-red-600 dark:text-red-400" />
                </div>
                <div className="flex-1">
                  <h3 className="text-xl font-semibold text-slate-900 dark:text-white">Delete Configuration</h3>
                  <p className="mt-2 text-[15px] text-slate-600 dark:text-slate-300">
                    Are you sure you want to delete this configuration? This action cannot be undone.
                  </p>
                </div>
              </div>
              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={cancelDelete}
                  className="rounded-full bg-white/90 px-6 py-3 text-[15px] font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-white active:scale-[0.99]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmDelete}
                  disabled={isLoading}
                  className="rounded-full bg-red-600 px-6 py-3 text-[15px] font-semibold text-white shadow-lg ring-1 ring-red-700/30 hover:bg-red-700 active:scale-[0.99] disabled:opacity-60"
                >
                  {isLoading ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Discover ESP modal + highlight around MAC */}
      <AnimatePresence>
        {discoverOpen && (
          <>
            <motion.div
              key="disc-backdrop"
              className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-md"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={fade}
              onClick={() => setDiscoverOpen(false)}
            />
            {discoverRect && (
              <motion.div
                key="disc-ring"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={cardSpring}
                className="pointer-events-none fixed z-[95] rounded-2xl ring-2 ring-indigo-500 shadow-[0_0_0_8px_rgba(99,102,241,0.25)]"
                style={{
                  top: Math.max(8, discoverRect.top - 8),
                  left: Math.max(8, discoverRect.left - 8),
                  width: discoverRect.width + 16,
                  height: discoverRect.height + 16,
                }}
              />
            )}
            <DiscoverEspModal
              open={discoverOpen}
              status={discoverStatus}
              mac={foundMac}
              error={discoverError}
              onClose={() => setDiscoverOpen(false)}
              onRetry={startDiscover}
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
        onUnassignBranch={handleUnassignBranchFromEspPin}
        espPinMappings={currentConfig.espPinMappings || {}}
      />
    </div>
  );
};

export default SettingsPageContent;

/* ────────────────────────────────────────────────────────────────────────────
 * Discover ESP Modal (inline so you get the full working file)
 * ──────────────────────────────────────────────────────────────────────────── */

function DiscoverEspModal({
  open,
  onClose,
  onRetry,
  status,
  mac,
  error,
}: {
  open: boolean;
  onClose: () => void;
  onRetry: () => void;
  status: 'idle' | 'searching' | 'success' | 'error';
  mac: string | null;
  error: string | null;
}) {
  const SHEET: Transition = { type: 'spring', stiffness: 520, damping: 42, mass: 0.9 };
  const FADE: Transition = { duration: 0.22 };

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* sheet */}
          <motion.div
            key="esp-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Discover ESP"
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={SHEET}
            className="fixed inset-0 z-[100] mx-auto my-auto flex w-[min(92vw,800px)] items-start justify-center p-5"
          >
            <div className="relative w-full overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/5">
              {/* Title bar */}
              <div className="flex items-center justify-between px-5 py-4">
                <h3 className="text-[18px] font-semibold text-slate-900">Discover ESP</h3>
                <button
                  onClick={onClose}
                  className="inline-flex h-9 items-center justify-center rounded-full px-4 text-[14px] font-semibold ring-1 ring-slate-200 hover:bg-slate-100 active:scale-95"
                >
                  Close
                </button>
              </div>

              {/* Content */}
              <div className="px-5 pb-6">
                <StatusCard
                  text={
                    status === 'searching'
                      ? 'Connecting to ESP over Wi-Fi…'
                      : status === 'success'
                      ? `Found ESP! MAC: ${mac ?? ''}`
                      : status === 'error'
                      ? (error || 'Discovery failed.')
                      : 'Ready'
                  }
                  tone={status}
                />

                <div className="mt-6 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
                  <EspLinkAnimation searching={status === 'searching'} success={status === 'success'} />
                </div>

                <div className="mt-6 flex justify-end gap-3">
                  {status !== 'searching' && (
                    <button
                      type="button"
                      onClick={onRetry}
                      className="rounded-full bg-indigo-600 px-6 py-3 text-[15px] font-semibold text-white shadow-lg ring-1 ring-indigo-700/30 hover:bg-indigo-700 active:scale-[0.99]"
                    >
                      Retry
                    </button>
                  )}
                </div>
              </div>
            </div>
          </motion.div>

          {/* keyframes for packets using offset-path (forward & reverse) */}
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

function StatusCard({ text, tone }: { text: string; tone: 'idle' | 'searching' | 'success' | 'error' }) {
  const base = 'rounded-2xl px-4 py-3 text-center text-[15px] font-medium ring-1';
  const cls =
    tone === 'error'
      ? `${base} bg-red-50 text-red-700 ring-red-200`
      : tone === 'success'
      ? `${base} bg-emerald-50 text-emerald-700 ring-emerald-200`
      : `${base} bg-white text-slate-700 ring-slate-200`;

  return (
    <div className={cls}>
      <div className="flex items-center justify-center gap-3">
        <span>{text}</span>
        {tone === 'searching' && <LoadingDots />}
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

/* ———————————————————————————————— */
/* The animated diagram (two ESP boards + animated line, packets both ways) */
/* ———————————————————————————————— */

function EspLinkAnimation({ searching, success }: { searching: boolean; success: boolean }) {
  const W = 720;
  const H = 230;

  // Curved path like your reference image (used by both the dashed stroke & the packet animation)
  const linkPath = `M 140 ${H / 2} C ${W / 2 - 80} ${H / 2 - 70}, ${W / 2 + 80} ${H / 2 - 70}, ${W - 140} ${H / 2}`;

  return (
    <div className="relative mx-auto w-full overflow-hidden rounded-xl bg-gradient-to-b from-white to-slate-50">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-[230px] w-full">
        {/* subtle grid */}
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

        {/* marching dashed connection line */}
        <motion.path
          d={linkPath}
          fill="none"
          stroke={success ? 'rgba(16,185,129,.75)' : 'rgba(99,102,241,.65)'}
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="10 12"
          animate={searching ? { strokeDashoffset: [0, -44] } : { strokeDashoffset: 0 }}
          transition={{ duration: 1.2, repeat: searching ? Infinity : 0, ease: 'linear' }}
        />

        {/* boards */}
        <g transform={`translate(60, ${H / 2 - 48})`}><EspBoard /></g>
        <g transform={`translate(${W - 60 - 120}, ${H / 2 - 48})`}><EspBoard /></g>

        {/* Wi-Fi pulses */}
        <WifiPulse x={120} y={H / 2 - 6} />
        <WifiPulse x={W - 120} y={H / 2 - 6} right />

        {/* end glows */}
        <circle cx="140" cy={H / 2} r="22" fill="url(#glow)" />
        <circle cx={W - 140} cy={H / 2} r="22" fill="url(#glow)" />
      </svg>

      {/* Packets along the path – both directions */}
      {searching && (
        <>
          <PacketStream path={linkPath} duration={2.6} count={3} />
          <PacketStream path={linkPath} duration={2.8} count={3} reverse />
        </>
      )}

      {/* helper text */}
      <div className="pointer-events-none absolute inset-x-0 bottom-2 text-center text-[12px] text-slate-500">
        {success ? 'Connected' : 'Searching nearby boards…'}
      </div>
    </div>
  );
}

/* Simplified ESP32 dev-board icon */
function EspBoard() {
  return (
    <svg width="120" height="96" viewBox="0 0 120 96">
      <rect x="2" y="2" width="116" height="92" rx="8" className="fill-white" />
      <rect x="2" y="2" width="116" height="92" rx="8" className="fill-none" stroke="rgba(2,6,23,.12)" strokeWidth="2" />
      <rect x="2" y="2" width="116" height="16" rx="8" className="fill-slate-100" />
      <rect x="12" y="24" width="52" height="48" rx="4" className="fill-slate-200" />
      <rect x="12" y="24" width="52" height="48" rx="4" className="fill-none" stroke="rgba(2,6,23,.18)" />
      <rect x="72" y="26" width="30" height="22" rx="3" className="fill-slate-300" />
      <rect x="72" y="52" width="14" height="10" rx="2" className="fill-slate-300" />
      <rect x="88" y="52" width="14" height="10" rx="2" className="fill-slate-300" />
      <rect x="72" y="66" width="10" height="6" rx="2" className="fill-slate-300" />
      <rect x="84" y="66" width="18" height="6" rx="2" className="fill-slate-300" />
      {Array.from({ length: 14 }).map((_, i) => (
        <rect key={`l-${i}`} x="0" y={18 + i * 5} width="4" height="3" className="fill-slate-200" />
      ))}
      {Array.from({ length: 14 }).map((_, i) => (
        <rect key={`r-${i}`} x="116" y={18 + i * 5} width="4" height="3" className="fill-slate-200" />
      ))}
    </svg>
  );
}

/* Wi-Fi pulse arcs near each board */
function WifiPulse({ x, y, right = false }: { x: number; y: number; right?: boolean }) {
  const dir = right ? -1 : 1;
  const base = `M ${x} ${y} q ${12 * dir} -10 ${24 * dir} 0`;
  const mid = `M ${x} ${y} q ${18 * dir} -16 ${36 * dir} 0`;
  const big = `M ${x} ${y} q ${24 * dir} -22 ${48 * dir} 0`;
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

/* Packets following the curved link using CSS offset-path */
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
          className="absolute h-2 w-2 rounded-full shadow-[0_0_0_4px_rgba(99,102,241,.15)]"
          style={
            {
              background: 'rgb(99 102 241)', // indigo-500
              // @ts-ignore vendor prefix handled by browser
              offsetPath: `path('${path}')`,
              animation: `${reverse ? 'packetReverse' : 'packet'} ${duration}s linear ${i * (duration / count)}s infinite`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
