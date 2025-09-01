'use client';

import React, { useState, useEffect, useCallback, useRef, FormEvent, startTransition } from 'react';
import dynamic from 'next/dynamic';
import { m, AnimatePresence, useReducedMotion } from 'framer-motion';
import type { Transition, Variants } from 'framer-motion';

import { BranchDisplayData, KfbInfo, TestStatus } from '@/types/types';
import { Header } from '@/components/Header/Header';
import { BranchControlSidebar } from '@/components/Program/BranchControlSidebar';
import { SettingsPageContent } from '@/components/Settings/SettingsPageContent';
import { SettingsBranchesPageContent } from '@/components/Settings/SettingsBranchesPageContent';
import BranchDashboardMainContent from '@/components/Program/BranchDashboardMainContent';
import { useSerialEvents } from '@/components/Header/useSerialEvents';

import SettingsRightSidebar from '@/components/Settings/SettingsRightSidebar';

// Helper: check if Redis has setup/alias data for this MAC (any aliases or pins)
async function hasSetupDataForMac(mac: string): Promise<boolean> {
  try {
    const rAll = await fetch(`/api/aliases?mac=${encodeURIComponent(mac)}&all=1`, { cache: 'no-store' });
    if (rAll.ok) {
      const j = await rAll.json();
      const items: Array<{ aliases?: Record<string,string>; normalPins?: number[]; latchPins?: number[] }>
        = Array.isArray(j?.items) ? j.items : [];
      const any = items.some(it => {
        const a = it.aliases && typeof it.aliases === 'object' && Object.keys(it.aliases).length > 0;
        const np = Array.isArray(it.normalPins) && it.normalPins.length > 0;
        const lp = Array.isArray(it.latchPins) && it.latchPins.length > 0;
        return !!(a || np || lp);
      });
      if (any) return true;
    }
    const rOne = await fetch(`/api/aliases?mac=${encodeURIComponent(mac)}`, { cache: 'no-store' });
    if (rOne.ok) {
      const ju = await rOne.json();
      const a = ju && typeof ju.aliases === 'object' && Object.keys(ju.aliases || {}).length > 0;
      const np = Array.isArray(ju?.normalPins) && ju.normalPins.length > 0;
      const lp = Array.isArray(ju?.latchPins) && ju.latchPins.length > 0;
      return !!(a || np || lp);
    }
  } catch {}
  return false;
}

const SIDEBAR_WIDTH = '24rem';
type MainView = 'dashboard' | 'settingsConfiguration' | 'settingsBranches';
type OverlayKind = 'success' | 'error' | 'scanning';

// Accept any ttyACM<N> and common by-id variants
const isAcmPath = (p?: string | null) =>
  !p
  || /(^|\/)ttyACM\d+$/.test(p)
  || /(^|\/)ACM\d+($|[^0-9])/.test(p)
  || /\/by-id\/.*ACM\d+/i.test(p);

function compileRegex(src: string | undefined, fallback: RegExp): RegExp {
  if (!src) return fallback;
  try {
    if (src.startsWith('/') && src.lastIndexOf('/') > 0) {
      const i = src.lastIndexOf('/');
      return new RegExp(src.slice(1, i), src.slice(i + 1));
    }
    return new RegExp(src);
  } catch (e) {
    console.warn('Invalid NEXT_PUBLIC_KFB_REGEX. Using fallback.', e);
    return fallback;
  }
}

// ENV-configurable KFB regex (fallback: 4 alphanumerics)
const KFB_REGEX = compileRegex(process.env.NEXT_PUBLIC_KFB_REGEX, /^[A-Z0-9]{4}$/);
// Accept common MAC formats and normalize to colon-separated uppercase
const MAC_ONLY_REGEX = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i;
const canonicalMac = (raw: string): string | null => {
  const s = String(raw || '').trim();
  if (!s) return null;
  // Strip non-hex chars and reformat as XX:XX:XX:XX:XX:XX when length is 12
  const hex = s.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  if (hex.length !== 12) return null;
  const mac = hex.match(/.{1,2}/g)?.join(':') || '';
  return MAC_ONLY_REGEX.test(mac) ? mac : null;
};

const MainApplicationUI: React.FC = () => {
  const reduce = useReducedMotion();

  // Overlay motion variants (respect reduced motion)
  const fadeTransition: Transition = { duration: reduce ? 0 : 0.18 };
  const cardTransition: Transition = reduce ? { duration: 0 } : { type: 'spring', stiffness: 260, damping: 20 };

  const bg: Variants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: fadeTransition },
    exit: { opacity: 0, transition: fadeTransition },
  };
  const card: Variants = {
    hidden: { scale: reduce ? 1 : 0.98, opacity: 0 },
    visible: {
      scale: 1,
      opacity: 1,
      transition: cardTransition,
    },
    exit: { scale: reduce ? 1 : 0.98, opacity: 0 },
  };
  const heading: Variants = {
    hidden: { y: reduce ? 0 : 6, opacity: 0 },
    visible: { y: 0, opacity: 1, transition: { duration: reduce ? 0 : 0.22 } },
  };

  const KIND_STYLES: Record<OverlayKind, string> = {
    error: '#ef4444',
    scanning: '#60a5fa',
    success: '#22c55e',
  };
  // UI state
  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(false);
  const [isSettingsSidebarOpen, setIsSettingsSidebarOpen] = useState(false);
  const [mainView, setMainView] = useState<MainView>('dashboard');
  const [session, setSession] = useState(0);
  const bumpSession = () => setSession(s => s + 1);
  // Data / process state
  const [branchesData, setBranchesData] = useState<BranchDisplayData[]>([]);
  const [groupedBranches, setGroupedBranches] = useState<Array<{ kssk: string; branches: BranchDisplayData[] }>>([]);
  const [kfbNumber, setKfbNumber] = useState('');
  const [kfbInfo, setKfbInfo] = useState<KfbInfo | null>(null);
  const [macAddress, setMacAddress] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  // Gate visual scanning animations; keep internal isScanning for flow control
  const [showScanUi, setShowScanUi] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [nameHints, setNameHints] = useState<Record<string,string> | undefined>(undefined);
  const [normalPins, setNormalPins] = useState<number[] | undefined>(undefined);
  const [latchPins, setLatchPins] = useState<number[] | undefined>(undefined);
  const [activeKssks, setActiveKssks] = useState<string[]>([]);
  const [scanningError, setScanningError] = useState(false);
  // Snapshot of KSSK items discovered via /api/aliases?all=1 for this MAC
  const itemsAllFromAliasesRef = useRef<Array<{ kssk: string; aliases?: Record<string,string>; normalPins?: number[]; latchPins?: number[] }>>([]);
  const lastGroupsRef = useRef<Array<{ kssk: string; branches: BranchDisplayData[] }>>([]);
  useEffect(() => { lastGroupsRef.current = groupedBranches; }, [groupedBranches]);

  // Check flow
  const [checkFailures, setCheckFailures] = useState<number[] | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  // Reflect isChecking in a ref for async handlers
  const isCheckingRef = useRef(false);
  useEffect(() => { isCheckingRef.current = isChecking; }, [isChecking]);
  // Simplified flow: no UI polling; show OK for a few seconds, then hide
  const [awaitingRelease, setAwaitingRelease] = useState(false); // deprecated
  const [showRemoveCable, setShowRemoveCable] = useState(false); // deprecated

  // Settings flow
  const [currentConfigIdForProgram, setCurrentConfigIdForProgram] = useState<number | null>(null);

  // KFB input (from scanner or manual)
  const [kfbInput, setKfbInput] = useState('');
  const kfbInputRef = useRef(kfbInput);
  const isScanningRef = useRef(isScanning);
  useEffect(() => { kfbInputRef.current = kfbInput; }, [kfbInput]);
  useEffect(() => { isScanningRef.current = isScanning; }, [isScanning]);

  // Overlay
  const [overlay, setOverlay] = useState<{ open: boolean; kind: OverlayKind; code: string }>({
    open: false, kind: 'success', code: ''
  });
  const showOverlay = (kind: OverlayKind, code: string) => setOverlay({ open: true, kind, code });
  const hideOverlaySoon = (ms = 1200) => {
    const t = setTimeout(() => setOverlay(o => ({ ...o, open: false })), ms);
    return () => clearTimeout(t);
  };
  // Always show a brief SUCCESS overlay on OK
  const OK_OVERLAY_MS = Math.max(400, Number(process.env.NEXT_PUBLIC_OK_OVERLAY_MS ?? '1200'));
  const lastScanRef = useRef('');
  const [okOverlayActive, setOkOverlayActive] = useState(false);
  const [okAnimationTick, setOkAnimationTick] = useState(0);

  const okResetTimerRef = useRef<number | null>(null);
  const scheduleOkReset = (ms = 1500) => {
    if (okResetTimerRef.current) clearTimeout(okResetTimerRef.current);
    okResetTimerRef.current = window.setTimeout(() => {
      handleResetKfb();
      okResetTimerRef.current = null;
    }, ms + 100);
  };
  const cancelOkReset = () => {
    if (okResetTimerRef.current) { clearTimeout(okResetTimerRef.current); okResetTimerRef.current = null; }
  };

  const [okFlashTick, setOkFlashTick] = useState(0);
  const [okSystemNote, setOkSystemNote] = useState<string | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const clearRetryTimer = () => { if (retryTimerRef.current != null) { try { clearTimeout(retryTimerRef.current); } catch {} retryTimerRef.current = null; } };
  const scanOverlayTimerRef = useRef<number | null>(null);
  const startScanOverlayTimeout = (ms = 5000) => {
    if (scanOverlayTimerRef.current != null) {
      try { clearTimeout(scanOverlayTimerRef.current); } catch {}
      scanOverlayTimerRef.current = null;
    }
    scanOverlayTimerRef.current = window.setTimeout(() => {
      scanOverlayTimerRef.current = null;
      setOverlay((o) => ({ ...o, open: false }));
    }, ms);
  };
  const clearScanOverlayTimeout = () => {
    if (scanOverlayTimerRef.current != null) {
      try { clearTimeout(scanOverlayTimerRef.current); } catch {}
      scanOverlayTimerRef.current = null;
    }
  };



  // Serial events (SSE)
  const serial = useSerialEvents((macAddress || '').toUpperCase() || undefined);
  const lastScan = serial.lastScan;
  const lastScanPath = (serial as any).lastScanPath as string | null | undefined;
  const DASH_SCANNER_INDEX = Number(process.env.NEXT_PUBLIC_SCANNER_INDEX_DASHBOARD ?? '0');
  const pathsEqual = (a?: string | null, b?: string | null) => {
    if (!a || !b) return false;
    if (a === b) return true;
    const ta = a.split('/').pop() || a;
    const tb = b.split('/').pop() || b;
    return ta === tb || a.endsWith(tb) || b.endsWith(ta);
  };
  const resolveDesiredPath = (): string | null => {
    const list = serial.scannerPaths || [];
    if (list[DASH_SCANNER_INDEX]) return list[DASH_SCANNER_INDEX] || null;
    // If no path is known for the desired index, do not force a fallback path
    // to avoid filtering out real scans from other ACM ports.
    return null;
  };
  const desiredPath = resolveDesiredPath();
  const desiredTail = (desiredPath || '').split('/').pop() || desiredPath || '';
  const desiredPortState = (() => {
    const map = serial.scannerPorts || {} as any;
    const key = Object.keys(map).find((k) => pathsEqual(k, desiredPath || ''));
    return key ? (map as any)[key] as { open: boolean; present: boolean } : null;
  })();

  // Apply union updates from SSE if they match current MAC
  const CLEAR_LOCAL_ALIAS = String(process.env.NEXT_PUBLIC_ALIAS_CLEAR_ON_READY || '').trim() === '1';
  useEffect(() => {
    const u = (serial as any).lastUnion as { mac?: string; normalPins?: number[]; latchPins?: number[]; names?: Record<string,string> } | null;
    if (!u) return;
    const cur = (macAddress || '').toUpperCase();
    if (!cur || String(u.mac||'').toUpperCase() !== cur) return;
    try {
      if (Array.isArray(u.normalPins)) setNormalPins(u.normalPins);
      if (Array.isArray(u.latchPins)) setLatchPins(u.latchPins);
      if (u.names && typeof u.names === 'object') setNameHints(u.names as any);
      // Persist or clear local cache according to env flag
      if (u.names && typeof u.names === 'object') {
        try {
          if (CLEAR_LOCAL_ALIAS) localStorage.removeItem(`PIN_ALIAS::${cur}`);
          else localStorage.setItem(`PIN_ALIAS::${cur}`, JSON.stringify(u.names));
        } catch {}
      }
    } catch {}
  }, [serial.lastUnion, macAddress]);

  // Live EV updates: normalize legacy RESULT lines; on SUCCESS, mark branches OK and trigger lock cleanup.

// Live EV updates (MainApplicationUI)
// Show OK when legacy RESULT SUCCESS arrives for current MAC
useEffect(() => {
  const ev = (serial as any).lastEv as { kind?: string; mac?: string|null; line?: string; raw?: string; ok?: any } | null;
  if (!ev) return;

  const raw = String(ev.line ?? ev.raw ?? '');
  const kind = String(ev.kind || '').toUpperCase();
  const ok = /\bRESULT\b/i.test(raw) && /\b(SUCCESS|OK)\b/i.test(raw) || String(ev.ok).toLowerCase() === 'true';

  // tolerate zero/empty MAC; fallback parse from text
  const ZERO = '00:00:00:00:00:00';
  const current = (macAddress || '').toUpperCase();
  let evMac = String(ev.mac || '').toUpperCase();
  if (!evMac || evMac === ZERO) evMac = raw.toUpperCase().match(/FROM\s+([0-9A-F]{2}(?::[0-9A-F]{2}){5})/)?.[1] || '';
  const matches = !evMac || evMac === ZERO || evMac === current;

  if ((kind === 'RESULT' || kind === 'DONE') && ok && matches) {
    setBranchesData(prev => prev.map(b => ({ ...b, testStatus: 'ok' as const })));
    setCheckFailures([]); setIsChecking(false); setIsScanning(false);
    setOkFlashTick(t => t + 1);   // triggers child OK animation
    // Send checkpoint when live event indicates success and live mode is on
    try {
      const mac = (macAddress || '').toUpperCase();
      if (mac) {
        (async () => {
          try {
            const hasSetup = await hasSetupDataForMac(mac);
            if (hasSetup && krosyLive && !checkpointMacSentRef.current.has(mac) && !checkpointMacPendingRef.current.has(mac)) {
              await sendCheckpointForMac(mac);
              try { setOkSystemNote('Checkpoint sent; cache cleared'); } catch {}
            } else {
              try { setOkSystemNote('Cache cleared'); } catch {}
            }
          } catch {}
          // Clear Redis aliases for this MAC regardless, then clear local cache
          try {
            await fetch('/api/aliases/clear', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ mac })
            });
          } catch {}
          try {
            localStorage.removeItem(`PIN_ALIAS::${mac}`);
            localStorage.removeItem(`PIN_ALIAS_UNION::${mac}`);
            localStorage.removeItem(`PIN_ALIAS_GROUPS::${mac}`);
          } catch {}
          // Also clear any KSSK locks for this MAC across stations (force), include stationId if known
          try {
            const sid = (process.env.NEXT_PUBLIC_STATION_ID || process.env.STATION_ID || '').trim();
            await fetch('/api/kssk-lock', {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(sid ? { mac, stationId: sid, force: 1 } : { mac, force: 1 })
            });
          } catch {}
        })();
      }
    } catch {}
    scheduleOkReset();            // auto-return to scan
    setOverlay(o => ({ ...o, open: false })); // close SCANNING overlay
  }
}, [serial.lastEvTick, macAddress]);


  // Fallback force-OK: if UI already reflects all branches OK and no failures, show OK + reset.
  useEffect(() => {
    // Reset guard when a new scan/check starts
    if (isScanning || isChecking) { okForcedRef.current = false; return; }
    // If the latest live event indicates a failure for the current MAC, do not force OK
    try {
      const ev: any = (serial as any).lastEv;
      const cur = (macAddress || '').toUpperCase();
      if (ev && cur) {
        const evMac = String(ev.mac || '').toUpperCase();
        const ZERO = '00:00:00:00:00:00';
        const raw = String(ev.line || ev.raw || '');
        const kindRaw = String(ev.kind || '').toUpperCase();
        const isResult = /\bRESULT\b/i.test(raw) || kindRaw === 'RESULT';
        const isFailText = /\bFAIL(?:URE)?\b/i.test(raw);
        const isDoneFail = kindRaw === 'DONE' && String(ev.ok).toLowerCase() === 'false';
        const macMatch = !evMac || evMac === ZERO || evMac === cur || /reply\s+from\s+([0-9A-F]{2}(?::[0-9A-F]{2}){5})/i.test(raw);
        if (macMatch && (isDoneFail || (isResult && isFailText))) return; // abort force OK
      }
    } catch {}
    if (okForcedRef.current) return;
    const anyFailures = Array.isArray(checkFailures) && checkFailures.length > 0;
    if (anyFailures) return;
    const flatOk = Array.isArray(branchesData) && branchesData.length > 0 && branchesData.every((b) => b.testStatus === 'ok');
    const groupedOk = Array.isArray(groupedBranches) && groupedBranches.length > 0 && groupedBranches.every((g) => g.branches.length > 0 && g.branches.every((b) => b.testStatus === 'ok'));
    if (flatOk || groupedOk) {
      // In live mode when everything is OK, close SCANNING overlay, show OK flash, then reset
      clearScanOverlayTimeout();
      setOverlay(o => ({ ...o, open: false }));
      okForcedRef.current = true;
      setOkFlashTick(t => t + 1);     // same unified path

      // Ensure checkpoint + cleanup also run when OK is derived from UI state
      try {
        const mac = (macAddress || '').toUpperCase();
        if (mac) {
          (async () => {
            try {
              const hasSetup = await hasSetupDataForMac(mac);
              const macUp = mac;
              if (hasSetup && krosyLive && !checkpointMacSentRef.current.has(macUp) && !checkpointMacPendingRef.current.has(macUp)) {
                await sendCheckpointForMac(mac);
                try { setOkSystemNote('Checkpoint sent; cache cleared'); } catch {}
              } else {
                try { setOkSystemNote('Cache cleared'); } catch {}
              }
              try { await fetch('/api/aliases/clear', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mac }) }); } catch {}
              try {
                localStorage.removeItem(`PIN_ALIAS::${macUp}`);
                localStorage.removeItem(`PIN_ALIAS_UNION::${macUp}`);
              } catch {}
              // Also clear any KSSK locks for this MAC across stations (force)
              try {
                const sid = (process.env.NEXT_PUBLIC_STATION_ID || process.env.STATION_ID || '').trim();
                await fetch('/api/kssk-lock', {
                  method: 'DELETE',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(sid ? { mac, stationId: sid, force: 1 } : { mac, force: 1 })
                });
              } catch {}
            } catch {}
          })();
        }
      } catch {}

      scheduleOkReset();
    }
  }, [branchesData, groupedBranches, checkFailures, isScanning, isChecking]);

  // Load station KSSKs as a fallback source for "KSSKs used" display
  useEffect(() => {
    let stop = false;
    const stationId = (process.env.NEXT_PUBLIC_STATION_ID || process.env.STATION_ID || '').trim();
    if (!stationId) return;
    const tick = async () => {
      try {
        const r = await fetch(`/api/kssk-lock?stationId=${encodeURIComponent(stationId)}`, { cache: 'no-store' });
        if (!r.ok) return;
        const j = await r.json();
        const ids: string[] = Array.isArray(j?.locks) ? j.locks.map((l: any) => String(l.kssk)) : [];
        if (ids.length && !stop) setActiveKssks((prev) => {
          const set = new Set<string>([...prev, ...ids]);
          return Array.from(set);
        });
      } catch {}
    };
    tick();
    const h = setInterval(tick, 5000);
    return () => { stop = true; clearInterval(h); };
  }, []);

  // Do NOT override Active KSSKs from Redis with aliases index; show only station-active

  // De-bounce duplicate scans
  const lastHandledScanRef = useRef<string>('');
  const scanDebounceRef = useRef<number>(0);
  const lastErrorStampRef = useRef<number>(0);
  // Prevent concurrent scan flows (SSE connect + poll race on refresh)
  const scanInFlightRef = useRef<boolean>(false);
  // Guard to avoid forcing OK multiple times per cycle
  const okForcedRef = useRef<boolean>(false);
  // Queue scans that arrive while a CHECK is running
  const pendingScansRef = useRef<string[]>([]);
  const enqueueScan = useCallback((raw: string) => {
    const code = String(raw || '').trim().toUpperCase();
    if (!code) return;
    const q = pendingScansRef.current;
    // coalesce identical consecutive entries; keep last 5
    if (q.length === 0 || q[q.length - 1] !== code) q.push(code);
    if (q.length > 5) q.splice(0, q.length - 5);
  }, []);
  // Provide stable reference to handleScan for async drains
  const handleScanRef = useRef<(code: string) => void | Promise<void>>(() => {});

  const handleResetKfb = useCallback(() => {
    cancelOkReset?.();
 setOkFlashTick(0);
    setOkSystemNote(null);
    setKfbNumber('');
    setKfbInfo(null);
    setBranchesData([]);
    setKfbInput('');
    setGroupedBranches([]);
    setActiveKssks([]);
    setNameHints(undefined);
    // Keep MAC address to persist scanned value through the flow
    okForcedRef.current = false;
     bumpSession();   
  }, []);

  // ===== Krosy checkpoint integration =====
  const CHECKPOINT_URL = process.env.NEXT_PUBLIC_KROSY_URL_CHECKPOINT_ONLINE || '/api/krosy/checkpoint';
  const KROSY_TARGET = process.env.NEXT_PUBLIC_KROSY_XML_TARGET || 'ksskkfb01';
  const KROSY_SOURCE = process.env.NEXT_PUBLIC_KROSY_SOURCE_HOSTNAME || KROSY_TARGET;
  const IP_ONLINE = (process.env.NEXT_PUBLIC_KROSY_IP_ONLINE || '').trim();
  const IP_OFFLINE = (process.env.NEXT_PUBLIC_KROSY_IP_OFFLINE || '').trim();
  const [krosyLive, setKrosyLive] = useState(String(process.env.NEXT_PUBLIC_KROSY_ONLINE) === 'true');
  useEffect(() => {
    (async () => {
      try {
        const idUrl = process.env.NEXT_PUBLIC_KROSY_IDENTITY_URL || '/api/krosy/checkpoint';
        const r = await fetch(idUrl, { headers: { Accept: 'application/json' }, cache: 'no-store' });
        if (!r.ok) return;
        const j = await r.json();
        const ip = String(j?.ip || '').trim();
        if (ip && IP_ONLINE && ip === IP_ONLINE) setKrosyLive(true);
        else if (ip && IP_OFFLINE && ip === IP_OFFLINE) setKrosyLive(false);
      } catch {}
    })();
  }, []);
  const checkpointSentRef = useRef<Set<string>>(new Set());
  const checkpointMacSentRef = useRef<Set<string>>(new Set());
  const checkpointMacPendingRef = useRef<Set<string>>(new Set());

  const sendCheckpointForMac = useCallback(async (mac: string) => {
    if (checkpointMacSentRef.current.has(mac.toUpperCase())) return;
    try {
      const rList = await fetch(`/api/aliases?mac=${encodeURIComponent(mac)}&all=1`, { cache: 'no-store' });
      if (!rList.ok) return;
      const j = await rList.json();
      const items: Array<{ kssk: string; aliases?: Record<string,string>; normalPins?: number[]; latchPins?: number[] }> = Array.isArray(j?.items) ? j.items : [];

      // If there is nothing to check (no items, no aliases/pins), do not send checkpoint
      let hasData = items.length > 0 && items.some(it => {
        const a = it.aliases && typeof it.aliases === 'object' ? Object.keys(it.aliases).length > 0 : false;
        const np = Array.isArray(it.normalPins) && it.normalPins.length > 0;
        const lp = Array.isArray(it.latchPins) && it.latchPins.length > 0;
        return a || np || lp;
      });
      if (!hasData) {
        try {
          const ru = await fetch(`/api/aliases?mac=${encodeURIComponent(mac)}`, { cache: 'no-store' });
          if (ru.ok) {
            const ju = await ru.json();
            const a = ju && typeof ju.aliases === 'object' ? Object.keys(ju.aliases || {}).length > 0 : false;
            const np = Array.isArray(ju?.normalPins) && ju.normalPins.length > 0;
            const lp = Array.isArray(ju?.latchPins) && ju.latchPins.length > 0;
            hasData = a || np || lp;
          }
        } catch {}
      }
      if (!hasData) return;

      let sentAny = false;
      for (const it of items) {
        const kssk = String(it.kssk || '').trim();
        if (!kssk || checkpointSentRef.current.has(kssk)) continue;
        let workingDataXml: string | null = null;
        try {
          const rXml = await fetch(`/api/aliases/xml?mac=${encodeURIComponent(mac)}&kssk=${encodeURIComponent(kssk)}`, { cache: 'no-store' });
          if (rXml.ok) workingDataXml = await rXml.text();
        } catch {}
        const payload = workingDataXml && workingDataXml.trim()
          ? { requestID: '1', workingDataXml }
          : { requestID: '1', intksk: kssk, sourceHostname: KROSY_SOURCE, targetHostName: KROSY_TARGET };
        try {
          await fetch(CHECKPOINT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(payload),
          });
          checkpointSentRef.current.add(kssk);
          sentAny = true;
        } catch {}
      }
      if (sentAny) checkpointMacSentRef.current.add(mac.toUpperCase());
    } catch {}
  }, [CHECKPOINT_URL, KROSY_SOURCE, KROSY_TARGET]);






  // Narrowing guard
  const isTestablePin = (b: BranchDisplayData): b is BranchDisplayData & { pinNumber: number } =>
    !b.notTested && typeof b.pinNumber === 'number';

  // ----- RUN CHECK ON DEMAND OR AFTER EACH SCAN -----
  const runCheck = useCallback(
    async (mac: string, attempt: number = 0, pins?: number[]) => {
      if (!mac) return;

      setIsChecking(true);
      setScanningError(false);
      setCheckFailures(null);
      setShowRemoveCable(false);
      setAwaitingRelease(false);

      try {
        const clientBudget = Number(process.env.NEXT_PUBLIC_CHECK_CLIENT_TIMEOUT_MS ?? '5000');
        const ctrl = new AbortController();
        const tAbort = setTimeout(() => ctrl.abort(), Math.max(1000, clientBudget));
        
        const res = await fetch('/api/serial/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // Send MAC plus optional pins as a fallback if union not ready on server
          body: JSON.stringify(pins && pins.length ? { mac, pins } : { mac }),
          signal: ctrl.signal,
        });
        clearTimeout(tAbort);
        const result = await res.json();
        try { if (Array.isArray((result as any)?.pinsUsed)) console.log('[GUI] CHECK used pins', (result as any).pinsUsed, 'mode', (result as any)?.sendMode); } catch {}

        if (res.ok) {
          clearRetryTimer();
          const failures: number[] = result.failures || [];
          const unknown = result?.unknownFailure === true;
          const hints = (result?.nameHints && typeof result.nameHints === 'object') ? (result.nameHints as Record<string,string>) : undefined;
          setNameHints(hints);
          try {
            const n = Array.isArray(result?.normalPins) ? (result.normalPins as number[]) : undefined;
            const l = Array.isArray(result?.latchPins) ? (result.latchPins as number[]) : undefined;
            setNormalPins(n);
            setLatchPins(l);
          } catch {}
          setCheckFailures(failures);
          startTransition(() => setBranchesData(_prev => {
            // Always rebuild list so all KSSKs are reflected
            const macUp = mac.toUpperCase();
            let aliases: Record<string,string> = {};
            // Prefer API items (all KSSKs), else fallback
            const itemsPref = Array.isArray((result as any)?.itemsActive) ? (result as any).itemsActive
                              : (Array.isArray((result as any)?.items) ? (result as any).items : null);
            if (itemsPref) {
              const mergeAliases = (items: Array<{ aliases: Record<string,string> }>) => {
                const merged: Record<string,string> = {};
                for (const it of items) {
                  for (const [pin, name] of Object.entries(it.aliases || {})) {
                    if (!merged[pin]) merged[pin] = name;
                    else if (merged[pin] !== name) merged[pin] = `${merged[pin]} / ${name}`;
                  }
                }
                return merged;
              };
              aliases = mergeAliases(itemsPref as Array<{ aliases: Record<string,string> }>);
            } else {
              try {
                aliases = JSON.parse(localStorage.getItem(`PIN_ALIAS::${macUp}`) || '{}') || {};
                const uLocal = JSON.parse(localStorage.getItem(`PIN_ALIAS_UNION::${macUp}`) || 'null');
                if (uLocal && typeof uLocal === 'object') {
                  if (Array.isArray(uLocal.normalPins)) setNormalPins(uLocal.normalPins);
                  if (Array.isArray(uLocal.latchPins)) setLatchPins(uLocal.latchPins);
                }
              } catch {}
            }
            // If still empty, try simple aliases from API union
            if (!aliases || Object.keys(aliases).length === 0) {
              const mergeAliases = (items: Array<{ aliases: Record<string,string> }>) => {
                const merged: Record<string,string> = {};
                for (const it of items) {
                  for (const [pin, name] of Object.entries(it.aliases || {})) {
                    if (!merged[pin]) merged[pin] = name;
                    else if (merged[pin] !== name) merged[pin] = `${merged[pin]} / ${name}`;
                  }
                }
                return merged;
              };
              let merged: Record<string,string> = {};
              // Synchronous path: if API included aliases in this result
              if (result?.items && Array.isArray(result.items)) {
                merged = mergeAliases(result.items as Array<{ aliases: Record<string,string> }>);
              } else if (result?.aliases && typeof result.aliases === 'object') {
                merged = result.aliases as Record<string,string>;
              }
              aliases = merged;
              try {
                if (Object.keys(aliases).length) {
                  if (CLEAR_LOCAL_ALIAS) localStorage.removeItem(`PIN_ALIAS::${macUp}`);
                  else localStorage.setItem(`PIN_ALIAS::${macUp}`, JSON.stringify(aliases));
                }
              } catch {}
            }
            const pins = Object.keys(aliases).map(n => Number(n)).filter(n => Number.isFinite(n));
            pins.sort((a,b)=>a-b);
            // Prefer per-item latch info when available; else global union
            const contactless = new Set<number>((Array.isArray(result?.latchPins) ? (result.latchPins as number[]) : (latchPins || [])).filter((n: number) => Number.isFinite(n)) as number[]);
            const flat = pins.map(pin => ({
              id: String(pin),
              branchName: aliases[String(pin)] || `PIN ${pin}`,
              testStatus: failures.includes(pin)
                ? 'nok' as TestStatus
                : (contactless.has(pin) ? 'not_tested' as TestStatus : 'ok' as TestStatus),
              pinNumber: pin,
              kfbInfoValue: undefined,
              isLatch: contactless.has(pin),
            }));

            // Build grouped sections per KSSK if available from API
            // Prefer union of all KSSKs and station-active ones
            const itemsActiveArr = Array.isArray((result as any)?.itemsActive)
              ? (result as any).itemsActive as Array<{ kssk: string; aliases: Record<string,string>; latchPins?: number[] }>
              : [];
            let itemsAllArr = Array.isArray((result as any)?.items)
              ? (result as any).items as Array<{ kssk: string; aliases: Record<string,string>; normalPins?: number[]; latchPins?: number[] }>
              : [];
            // Fallback to locally persisted groups when server did not return any
            try {
              if (!itemsAllArr.length) {
                const macUp = mac.toUpperCase();
                const rawGroups = localStorage.getItem(`PIN_ALIAS_GROUPS::${macUp}`);
                if (rawGroups) {
                  const arr = JSON.parse(rawGroups);
                  if (Array.isArray(arr)) itemsAllArr = arr as any;
                }
              }
            } catch {}
            // Merge API-provided items with pre-scan Redis snapshot to avoid missing groups
            const byKssk = new Map<string, { kssk: string; aliases: Record<string,string>; normalPins?: number[]; latchPins?: number[] }>();
            for (const it of [...itemsAllArr, ...itemsActiveArr]) {
              const id = String(it.kssk || '').trim();
              if (!id) continue;
              if (!byKssk.has(id)) byKssk.set(id, { kssk: id, aliases: it.aliases || {}, normalPins: (it as any).normalPins, latchPins: (it as any).latchPins });
            }
            for (const it of itemsAllFromAliasesRef.current || []) {
              const id = String(it.kssk || '').trim();
              if (!id || byKssk.has(id)) continue;
              byKssk.set(id, { kssk: id, aliases: (it.aliases as any) || {}, normalPins: it.normalPins, latchPins: it.latchPins });
            }
            const items = Array.from(byKssk.values());
            if (items.length) {
              // Build raw groups and then de-duplicate by KSSK and pin
              const groupsRaw: Array<{ kssk: string; branches: BranchDisplayData[] }> = [];
              for (const it of items) {
                const a = it.aliases || {};
                const pinsG = Object.keys(a).map(n => Number(n)).filter(n => Number.isFinite(n)).sort((x,y)=>x-y);
                // Use group-specific latchPins when present
                const contactless = new Set<number>((Array.isArray((it as any)?.latchPins) ? (it as any).latchPins : (latchPins || [])).filter((n: number) => Number.isFinite(n)) as number[]);
                const branchesG = pinsG.map(pin => ({
                  id: `${it.kssk}:${pin}`,
                  branchName: a[String(pin)] || `PIN ${pin}`,
                  testStatus: failures.includes(pin)
                    ? 'nok' as TestStatus
                    : (contactless.has(pin) ? 'not_tested' as TestStatus : 'ok' as TestStatus),
                  pinNumber: pin,
                  kfbInfoValue: undefined,
                  isLatch: contactless.has(pin),
                } as BranchDisplayData));
                groupsRaw.push({ kssk: String((it as any).kssk || ''), branches: branchesG });
              }
              const byId = new Map<string, BranchDisplayData[]>();
              for (const g of groupsRaw) {
                const id = String(g.kssk).trim().toUpperCase();
                const prev = byId.get(id) || [];
                const merged = [...prev, ...g.branches];
                const seen = new Set<number>();
                const dedup = merged.filter(b => {
                  const p = typeof b.pinNumber === 'number' ? b.pinNumber : NaN;
                  if (!Number.isFinite(p)) return true;
                  if (seen.has(p)) return false;
                  seen.add(p);
                  return true;
                });
                byId.set(id, dedup);
              }
              const groups: Array<{ kssk: string; branches: BranchDisplayData[] }> = Array.from(byId.entries())
                .sort((a,b)=> String(a[0]).localeCompare(String(b[0])))
                .map(([k, branches]) => ({ kssk: k, branches }));
              // Add any failure pins that are not present in any group as an extra synthetic group
              const knownPinsSet = new Set<number>();
              for (const g of groups) for (const b of g.branches) if (typeof b.pinNumber === 'number') knownPinsSet.add(b.pinNumber);
              const extraPins = failures.filter((p: number) => Number.isFinite(p) && !knownPinsSet.has(p));
              if (extraPins.length) {
                const extraBranches = extraPins.map((pin) => ({
                  id: `CHECK:${pin}`,
                  branchName: `PIN ${pin}`,
                  testStatus: 'nok' as TestStatus,
                  pinNumber: pin,
                  kfbInfoValue: undefined,
                } as BranchDisplayData));
                groups.push({ kssk: 'CHECK', branches: extraBranches });
              }
              // Merge with any previously shown groups if API dropped some
              const prev = lastGroupsRef.current || [];
              const have = new Set(groups.map(g => g.kssk));
              const mergedGroups = [...groups];
              for (const g of prev) { if (!have.has(g.kssk)) mergedGroups.push(g); }
              setGroupedBranches(mergedGroups);
              setActiveKssks(mergedGroups.map(g => g.kssk).filter(Boolean));
              // Also use union of all group pins for flat list
              const unionMap: Record<number, string> = {};
              for (const g of groups) for (const b of g.branches) if (typeof b.pinNumber === 'number') unionMap[b.pinNumber] = b.branchName;
              const unionPins = Object.keys(unionMap).map(n=>Number(n)).sort((x,y)=>x-y);
              const contactless = new Set<number>((latchPins || []).filter(n => Number.isFinite(n)) as number[]);
              return unionPins.map(pin => ({
                id: String(pin),
                branchName: unionMap[pin] || `PIN ${pin}`,
                testStatus: failures.includes(pin)
                  ? 'nok' as TestStatus
                  : (contactless.has(pin) ? 'not_tested' as TestStatus : 'ok' as TestStatus),
                pinNumber: pin,
                kfbInfoValue: undefined,
              }));
            } else {
              setGroupedBranches([]);
              setActiveKssks([]);
            }
            // No grouped items: include any failure pins not in alias map as synthetic entries
            const knownFlat = new Set<number>(pins);
            const extras = failures.filter((p: number) => Number.isFinite(p) && !knownFlat.has(p));
            return extras.length
              ? [
                  ...flat,
                  ...extras.map((pin:number) => ({
                    id: String(pin),
                    branchName: `PIN ${pin}`,
                    testStatus: 'nok' as TestStatus,
                    pinNumber: pin,
                    kfbInfoValue: undefined,
                  } as BranchDisplayData)),
                ]
              : flat;
          }));

        if (!unknown && failures.length === 0) {
              // Success: close SCANNING overlay immediately and flash OK
              clearScanOverlayTimeout();
              setOverlay(o => ({ ...o, open: false }));
              okForcedRef.current = true;
              setOkFlashTick(t => t + 1);     // show OK in child, then child resets
              scheduleOkReset();
              // Only call checkpoint when setup data exists in Redis; then clear Redis and localStorage
              try {
                const macUp = mac.toUpperCase();
                const hasSetup = await hasSetupDataForMac(mac);
                if (hasSetup && krosyLive && !checkpointMacSentRef.current.has(macUp) && !checkpointMacPendingRef.current.has(macUp)) {
                  await sendCheckpointForMac(mac);
                  try { setOkSystemNote('Checkpoint sent; cache cleared'); } catch {}
                } else {
                  try { setOkSystemNote('Cache cleared'); } catch {}
                }
                try {
                  await fetch('/api/aliases/clear', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mac })
                  });
                } catch {}
                try {
                  localStorage.removeItem(`PIN_ALIAS::${macUp}`);
                  localStorage.removeItem(`PIN_ALIAS_UNION::${macUp}`);
                } catch {}
              } catch {}

              // Clear any KSSK locks for this MAC across stations (force), include stationId if known
              try {
                const sid = (process.env.NEXT_PUBLIC_STATION_ID || process.env.STATION_ID || '').trim();
                await fetch('/api/kssk-lock', {
                  method: 'DELETE',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(sid ? { mac, stationId: sid, force: 1 } : { mac, force: 1 })
                });
              } catch {}
              // Also clear local Setup-page lock cache for this station
              try {
                const sid = (process.env.NEXT_PUBLIC_STATION_ID || process.env.STATION_ID || '').trim();
                if (sid) localStorage.removeItem(`setup.activeKsskLocks::${sid}`);
              } catch {}

          } else {
            const rawLine = typeof (result as any)?.raw === 'string' ? String((result as any).raw) : null;
            const msg = rawLine || (unknown ? 'CHECK failure (no pin list)' : `Failures: ${failures.join(', ')}`);
            const nowErr = Date.now();
            if (nowErr - lastErrorStampRef.current > 800) {
              showOverlay('error', msg);
              lastErrorStampRef.current = nowErr;
            }
            setAwaitingRelease(false);
          }
          if (!(failures.length === 0 && !unknown)) hideOverlaySoon();
        } else {
          // Distinguish no-result timeouts from other errors
          const maxRetries = Math.max(0, Number(process.env.NEXT_PUBLIC_CHECK_RETRY_COUNT ?? '1'))
          if (res.status === 429) {
            // Server busy (per-MAC lock). Retry shortly without showing an error.
            if (attempt < maxRetries + 2) {
              clearRetryTimer();
              retryTimerRef.current = window.setTimeout(() => { retryTimerRef.current = null; void runCheck(mac, attempt + 1, pins); }, 350);
            } else {
              console.warn('CHECK busy (429) too many retries');
            }
          } else if (res.status === 504 || result?.pending === true || String(result?.code || '').toUpperCase() === 'NO_RESULT') {
            // Quick retry a couple of times to shave latency without long waits
            // Quick retry a couple of times to shave latency without long waits
            if (attempt < maxRetries) {
              clearRetryTimer();
              retryTimerRef.current = window.setTimeout(() => { retryTimerRef.current = null; void runCheck(mac, attempt + 1, pins); }, 250);
            } else {
              console.warn('CHECK pending/no-result');
              setScanningError(true);
              showOverlay('error', 'SCANNING ERROR');
              clearScanOverlayTimeout();
              // Reset view back to default scan state shortly after showing error (preserve MAC)
              setTimeout(() => {
                handleResetKfb();
                setGroupedBranches([]);
                setActiveKssks([]);
                setNameHints(undefined);
              }, 1300);
            }
          } else {
            console.error('CHECK error:', result);
            setScanningError(true);
            showOverlay('error', 'CHECK ERROR');
            clearScanOverlayTimeout();
            // Reset view back to default scan state shortly after showing error (preserve MAC)
            setTimeout(() => {
              handleResetKfb();
              setGroupedBranches([]);
              setActiveKssks([]);
              setNameHints(undefined);
            }, 1300);
          }
          setAwaitingRelease(false);
          if (!(res.status === 504 && attempt < 2)) hideOverlaySoon();
        }
      } catch (err) {
        if ((err as any)?.name === 'AbortError') {
          const maxRetries = Math.max(0, Number(process.env.NEXT_PUBLIC_CHECK_RETRY_COUNT ?? '1'));
          if (attempt < 1 || attempt < maxRetries) {
            clearRetryTimer();
            retryTimerRef.current = window.setTimeout(() => { retryTimerRef.current = null; void runCheck(mac, attempt + 1, pins); }, 300);
          } else {
            setScanningError(true);
            showOverlay('error', 'SCANNING ERROR');
            clearScanOverlayTimeout();
            hideOverlaySoon();
            setTimeout(() => {
              handleResetKfb();
              setGroupedBranches([]);
              setActiveKssks([]);
              setNameHints(undefined);
            }, 1300);
          }
        } else {
          console.error('CHECK error', err);
          showOverlay('error', 'CHECK exception');
          setAwaitingRelease(false);
          clearScanOverlayTimeout();
          hideOverlaySoon();
          setTimeout(() => {
            handleResetKfb();
            setGroupedBranches([]);
            setActiveKssks([]);
            setNameHints(undefined);
          }, 1300);
        }
      } finally {
        clearRetryTimer();
        setIsChecking(false);
      }
    },
    []
  );

  // ----- LOAD + MONITOR + AUTO-CHECK FOR A SCAN -----
  // source: 'scan' (SSE/poll) or 'manual' (user input)
  const loadBranchesData = useCallback(async (value?: string, source: 'scan' | 'manual' = 'scan') => {
    cancelOkReset();
    setOkFlashTick(0);
    const kfbRaw = (value ?? kfbInputRef.current).trim();
    if (!kfbRaw) return;

    const normalized = kfbRaw.toUpperCase();
    // Accept MAC directly for production run; otherwise require KFB pattern
    const macCanon = canonicalMac(normalized);
    const isMac = !!macCanon;
    if (!isMac && !KFB_REGEX.test(normalized)) {
      // For manual submissions, use inline message instead of an overlay
      if (source === 'manual') {
        setErrorMsg('Invalid code. Expected MAC like AA:BB:CC:DD:EE:FF');
      } else {
        showOverlay('error', `Invalid code: ${normalized}`);
        hideOverlaySoon();
      }
      console.warn('[SCAN] rejected by patterns', { normalized });
      return;
    }

    // show SCANNING only if we have no content yet; otherwise keep UI and just highlight
    lastScanRef.current = normalized;
    // Avoid SCANNING overlay for manual entry; keep the UI calm
    if (source === 'scan') {
      if (branchesData.length === 0 && groupedBranches.length === 0) {
        showOverlay('scanning', normalized);
        startScanOverlayTimeout(5000);
      }
      setShowScanUi(true);
    }

    setIsScanning(true);
    setErrorMsg(null);
    // Do not clear existing view; keep content while rescanning
    // setBranchesData([]);
    setKfbInfo(null);
    // Keep previous identifiers until we assign the new MAC below
    // setKfbNumber('');
    // setMacAddress('');
    setCheckFailures(null);
    setShowRemoveCable(false);
    setAwaitingRelease(false);

    try {
      // MAC-first flow: build branch list from Setup pin aliases and run CHECK-only
      const mac = isMac ? (macCanon as string) : normalized; // use normalized MAC when available
      setKfbNumber(mac);
      setMacAddress(mac);

      // build from aliases if present
      let aliases: Record<string,string> = {};
      try { aliases = JSON.parse(localStorage.getItem(`PIN_ALIAS::${mac}`) || '{}') || {}; } catch {}
      let pins = Object.keys(aliases).map(n => Number(n)).filter(n => Number.isFinite(n)).sort((a,b)=>a-b);
      {
        // Fallback to Redis (prefer all KSSK items union). Force a rehydrate first.
        try {
          try {
            await fetch('/api/aliases/rehydrate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ mac }),
            }).catch(() => {});
          } catch {}
          const rAll = await fetch(`/api/aliases?mac=${encodeURIComponent(mac)}&all=1`, { cache: 'no-store' });
          if (rAll.ok) {
            const jAll = await rAll.json();
            const items = Array.isArray(jAll?.items) ? jAll.items as Array<{ aliases?: Record<string,string>; normalPins?: number[]; latchPins?: number[]; kssk: string; }> : [];
            try { itemsAllFromAliasesRef.current = items as any; } catch {}
            
             if (items.length) {
              // Build raw groups, then de-duplicate by KSSK and pin
              const groupsRaw = items.map((it: any) => {
                const aliases = it.aliases || {};
                const pins = Object.keys(aliases).map(n => Number(n)).filter(n => Number.isFinite(n)).sort((a,b)=>a-b);
                const branches = pins.map(pin => ({
                  id: `${it.kssk}:${pin}`,
                  branchName: aliases[String(pin)] || `PIN ${pin}`,
                  testStatus: 'not_tested' as TestStatus,
                  pinNumber: pin,
                  kfbInfoValue: undefined,
                }));
                return { kssk: String(it.kssk || ''), branches };
              });
              const byId = new Map<string, BranchDisplayData[]>();
              for (const g of groupsRaw) {
                const id = String(g.kssk).trim().toUpperCase();
                const prev = byId.get(id) || [];
                const merged = [...prev, ...g.branches];
                const seen = new Set<number>();
                const dedup = merged.filter(b => {
                  const p = typeof b.pinNumber === 'number' ? b.pinNumber : NaN;
                  if (!Number.isFinite(p)) return true;
                  if (seen.has(p)) return false;
                  seen.add(p);
                  return true;
                });
                byId.set(id, dedup);
              }
              const groups = Array.from(byId.entries())
                .sort((a,b)=> String(a[0]).localeCompare(String(b[0])))
                .map(([k, branches]) => ({ kssk: k, branches }));
              setGroupedBranches(groups);
              setActiveKssks(groups.map(g => g.kssk).filter(Boolean));
              // Persist per-KSSK grouping for offline/fallback rendering on dashboard
              try { localStorage.setItem(`PIN_ALIAS_GROUPS::${mac}`, JSON.stringify(items)); } catch {}
            }
                        
            
            
            const pinSet = new Set<number>();
            for (const it of items) {
              const a = (it.aliases && typeof it.aliases === 'object') ? it.aliases : {};
              for (const k of Object.keys(a)) { const n = Number(k); if (Number.isFinite(n) && n>0) pinSet.add(n); }
              if (Array.isArray(it.normalPins)) for (const n of it.normalPins) if (Number.isFinite(n) && n>0) pinSet.add(Number(n));
              if (Array.isArray(it.latchPins)) for (const n of it.latchPins) if (Number.isFinite(n) && n>0) pinSet.add(Number(n));
            }
            if (pinSet.size && pins.length === 0) pins = Array.from(pinSet).sort((x,y)=>x-y);
            // Also persist union aliases for UI rendering if available via single GET
            try {
              const rUnion = await fetch(`/api/aliases?mac=${encodeURIComponent(mac)}`, { cache: 'no-store' });
              if (rUnion.ok) {
                const jU = await rUnion.json();
                const aU = (jU?.aliases && typeof jU.aliases === 'object') ? (jU.aliases as Record<string,string>) : {};
                // Merge server union with locally persisted per‑KSSK groups to avoid dropping pins
                let mergedAliases: Record<string,string> = { ...aU };
                let mergedNormal: number[] = Array.isArray(jU?.normalPins) ? (jU.normalPins as number[]) : [];
                let mergedLatch: number[] = Array.isArray(jU?.latchPins) ? (jU.latchPins as number[]) : [];
                try {
                  const rawGroups = localStorage.getItem(`PIN_ALIAS_GROUPS::${mac}`);
                  if (rawGroups) {
                    const arr = JSON.parse(rawGroups);
                    if (Array.isArray(arr)) {
                      for (const it of arr) {
                        const names = (it && typeof it.aliases === 'object') ? it.aliases as Record<string,string> : {};
                        for (const [pin, name] of Object.entries(names)) {
                          if (!mergedAliases[pin]) mergedAliases[pin] = name as string;
                          else if (mergedAliases[pin] !== name) mergedAliases[pin] = `${mergedAliases[pin]} / ${name}`;
                        }
                        if (Array.isArray(it?.normalPins)) mergedNormal = Array.from(new Set([...mergedNormal, ...it.normalPins]));
                        if (Array.isArray(it?.latchPins)) mergedLatch = Array.from(new Set([...mergedLatch, ...it.latchPins]));
                      }
                    }
                  }
                } catch {}

                if (Object.keys(mergedAliases).length) {
                  aliases = mergedAliases;
                  try {
                    if (CLEAR_LOCAL_ALIAS) { localStorage.removeItem(`PIN_ALIAS::${mac}`); localStorage.removeItem(`PIN_ALIAS_UNION::${mac}`); }
                    else {
                      localStorage.setItem(`PIN_ALIAS::${mac}`, JSON.stringify(aliases));
                      localStorage.setItem(`PIN_ALIAS_UNION::${mac}`, JSON.stringify({ names: aliases, normalPins: mergedNormal, latchPins: mergedLatch, ts: Date.now() }));
                    }
                  } catch {}
                }
                // capture pin type context (use merged)
                try {
                  const n = mergedNormal.length ? mergedNormal : (Array.isArray(jU?.normalPins) ? (jU.normalPins as number[]) : undefined);
                  const l = mergedLatch.length ? mergedLatch : (Array.isArray(jU?.latchPins) ? (jU.latchPins as number[]) : undefined);
                  setNormalPins(n);
                  setLatchPins(l);
                  // Always merge union pins into the pins we send to CHECK so first scan uses all KSSKs
                  const acc = new Set<number>(pins);
                  if (Array.isArray(n)) for (const p of n) { const x = Number(p); if (Number.isFinite(x) && x>0) acc.add(x); }
                  if (Array.isArray(l)) for (const p of l) { const x = Number(p); if (Number.isFinite(x) && x>0) acc.add(x); }
                  pins = Array.from(acc).sort((a,b)=>a-b);
                } catch {}
              }
            } catch {}
          }
        } catch {}
      }
      // Defer rendering flat branches until CHECK result arrives
      setBranchesData([]);

      // Debug: log pins being sent for first CHECK
      try { console.log('[GUI] CHECK pins', pins); } catch {}
      await runCheck(mac, 0, pins);
    } catch (e) {
      console.error('Load/MONITOR error:', e);
      setKfbNumber('');
      setKfbInfo(null);
      // Preserve MAC to keep scanned value across the flow
      const msg = 'Failed to load setup data. Please run Setup or scan MAC again.';
      setErrorMsg(msg);
      if (source === 'scan') { showOverlay('error', 'Load failed'); hideOverlaySoon(); }
    } finally {
      setIsScanning(false);
      setShowScanUi(false);
    }
  }, [runCheck]);

  // Single entry for new scans (used by SSE + polling)
  const handleScan = useCallback(async (raw: string) => {
    const normalized = (raw || '').trim().toUpperCase();
    if (!normalized) return;

    // De-bounce identical value while idle, but allow new scan once previous finished
    const nowDeb = Date.now();
    if (normalized === lastHandledScanRef.current && nowDeb < scanDebounceRef.current) {
      return;
    }
    lastHandledScanRef.current = normalized;
    scanDebounceRef.current = nowDeb + 2000;

    // keep fields in sync
    if (normalized !== kfbInputRef.current) {
      setKfbInput(normalized);
      setKfbNumber(normalized);
    }

    // Accept either MAC (flex) or KFB pattern; reject only if neither matches
    if (!(canonicalMac(normalized) || KFB_REGEX.test(normalized))) {
      showOverlay('error', normalized);
      hideOverlaySoon();
      return;
    }

    if (isScanningRef.current || scanInFlightRef.current) return; // avoid overlapping flows
    scanInFlightRef.current = true;
    try {
      await loadBranchesData(normalized);
    } finally {
      // small delay before allowing next scan to avoid quick double-trigger
      setTimeout(() => { scanInFlightRef.current = false; }, 300);
    }
  }, [loadBranchesData]);

  // keep ref in sync for drains
  useEffect(() => { handleScanRef.current = handleScan; }, [handleScan]);

  // SSE → handle scans (gate by view and settings sidebar). If CHECK is running, queue it.
  useEffect(() => {
    if (mainView !== 'dashboard') return;
    if (isSettingsSidebarOpen) return;
    if (!serial.lastScanTick) return;              // no event yet
    const want = resolveDesiredPath();
    const seen = lastScanPath;
    if (want && seen && !pathsEqual(seen, want)) return; // ignore scans from other scanner paths
    const code = serial.lastScan;                   // the latest payload
    if (!code) return;
    if (isCheckingRef.current) {
      enqueueScan(code);
    } else {
      void handleScan(code);
    }
   // optional: echo code for visibility
   // console.debug('[SSE scan]', { code, path: lastScanPath, tick: serial.lastScanTick });
 // depend on the tick, not the string
 }, [serial.lastScanTick, lastScanPath, handleScan, mainView, isSettingsSidebarOpen]);

  // Polling fallback (filters to ACM via returned path and gates by view + settings).
  useEffect(() => {
    if (mainView !== 'dashboard') return;
    if (isSettingsSidebarOpen) return;
    // If SSE is connected but stale (no recent scans), allow polling as a safety net
    const STALE_MS = Number(process.env.NEXT_PUBLIC_SCANNER_POLL_IF_STALE_MS ?? '4000');
    const lastAt = (serial as any).lastScanAt as number | null | undefined;
    const sseOk = !!(serial as any).sseConnected;
    const stale = !(typeof lastAt === 'number' && isFinite(lastAt)) || (Date.now() - (lastAt as number)) > STALE_MS;
    if (sseOk && !stale) return; // healthy SSE path — skip polling

    let stopped = false;
    let lastPollAt = 0;
    // guard against duplicate pollers in StrictMode / re-renders
    const key = '__scannerPollActive__';
    if ((window as any)[key]) return;
    (window as any)[key] = true;
    let timer: number | null = null;
    let ctrl: AbortController | null = null;

    const tick = async () => {
      try {
        if (isScanningRef.current) {
          if (!stopped) timer = window.setTimeout(tick, 500);
          return;
        }
        ctrl = new AbortController();
        const want = resolveDesiredPath();
        // Only poll the desired scanner path; if unknown, wait and try again
        if (!want) {
          if (!stopped) timer = window.setTimeout(tick, 1200);
          return;
        }
        const url = `/api/serial/scanner?path=${encodeURIComponent(want)}&consume=1`;
        const res = await fetch(url, { cache: 'no-store', signal: ctrl.signal });
        if (res.ok) {
           const { code, path, error, retryInMs } = await res.json();
           try { if (typeof retryInMs === 'number') (window as any).__scannerRetry = retryInMs; } catch {}
          const raw = typeof code === 'string' ? code.trim() : '';
          if (raw) {
            if (path && !isAcmPath(path)) return;
            if (want && path && !pathsEqual(path, want)) return;
            if (isCheckingRef.current) enqueueScan(raw);
            else await handleScan(raw);
          }
              else if (error) {
                const str = String(error);
                const lower = str.toLowerCase();
                // Suppress noisy "not present/disconnected" class of errors; badge already reflects state
                const isNotPresent =
                  lower.includes('scanner port not present') ||
                  lower.includes('disconnected:not_present') ||
                  lower.includes('not present') ||
                  lower.includes('not_present');
                if (isNotPresent) {
                  setErrorMsg(null);
                } else {
                  setErrorMsg(str);
                }
                console.warn('[SCANNER] poll error', error);
              }
        }
      } catch (e) {
        if (!(e instanceof DOMException && e.name === 'AbortError')) {
          console.error('[SCANNER] poll error', e);
        }
      } finally {
        const now = Date.now();
        const delay = typeof (window as any).__scannerRetry === 'number' ? (window as any).__scannerRetry : undefined;
        let nextMs = (typeof delay === 'number' && delay > 0) ? delay : 1800;
        // enforce a minimum spacing between polls
        const elapsed = now - lastPollAt;
        if (elapsed < nextMs) nextMs = Math.max(nextMs, 1800 - elapsed);
        lastPollAt = now + nextMs;
        if (!stopped) timer = window.setTimeout(tick, nextMs);
      }
    };

    tick();
    return () => {
      stopped = true;
      try { delete (window as any)[key]; } catch {}
      if (timer) window.clearTimeout(timer);
      if (ctrl) ctrl.abort();
    };
  }, [mainView, isSettingsSidebarOpen, handleScan]);

  // When CHECK finishes, process the most recent queued scan (if any)
  useEffect(() => {
    if (!isChecking) {
      // small delay allows UI state to settle
      const t = setTimeout(() => {
        const q = pendingScansRef.current;
        if (!q.length) return;
        const next = q[q.length - 1]!; // most recent
        pendingScansRef.current = [];
        try { void handleScanRef.current(next); } catch {}
      }, 50);
      return () => clearTimeout(t);
    }
  }, [isChecking]);

  // Removed UI polling; success overlay auto-hides after 3s.

  // Manual submit from a form/input
  const handleKfbSubmit = (e: FormEvent) => {
    e.preventDefault();
    void loadBranchesData(kfbInputRef.current, 'manual');
  };

  const handleManualSubmit = (submittedNumber: string) => {
    const val = submittedNumber.trim().toUpperCase();
    if (!val) return;
    // For manual entry, avoid intrusive overlays; show subtle inline message
    if (!(canonicalMac(val) || KFB_REGEX.test(val))) {
      setErrorMsg('Invalid code. Expected MAC like AA:BB:CC:DD:EE:FF');
      return;
    }
    const mac = canonicalMac(val);
    const next = mac || val;
    setKfbInput(next);
    setKfbNumber(next);
    void loadBranchesData(next, 'manual');
  };

  // Layout helpers
  const actualHeaderHeight = mainView === 'dashboard' ? '4rem' : '0rem';
  const leftOffset = mainView === 'dashboard' && isLeftSidebarOpen ? SIDEBAR_WIDTH : '0';
  const appCurrentViewType = (mainView === 'settingsConfiguration' || mainView === 'settingsBranches') ? 'settings' : 'main';

  const toggleLeftSidebar = () => setIsLeftSidebarOpen(v => !v);
  const toggleSettingsSidebar = () => setIsSettingsSidebarOpen(v => !v);
  const showDashboard = () => setMainView('dashboard');
  const showConfig = () => { setMainView('settingsConfiguration'); setIsLeftSidebarOpen(false); };
  const showBranchesSettings = (id?: number) => { if (id != null) setCurrentConfigIdForProgram(id); setMainView('settingsBranches'); setIsLeftSidebarOpen(false); };

  const handleHeaderClick = () => {
    if (appCurrentViewType === 'settings') { showDashboard(); setIsSettingsSidebarOpen(false); }
    else { toggleSettingsSidebar(); }
  };

  return (
    <div className="relative flex min-h-screen bg-slate-100 dark:bg-slate-900">
      {mainView === 'dashboard' && (
        <BranchControlSidebar
          isOpen={isLeftSidebarOpen}
          toggleSidebar={toggleLeftSidebar}
          branches={branchesData}
          onSetStatus={(id, status) =>
            setBranchesData(data => data.map(b => (b.id === id ? { ...b, testStatus: status } : b)))
          }
          sidebarWidthProvided={SIDEBAR_WIDTH}
          appHeaderHeight={actualHeaderHeight}
        />
      )}

      <div className="flex flex-1 flex-col transition-all" style={{ marginLeft: leftOffset }}>
        {mainView === 'dashboard' && (
          <Header
            onSettingsClick={handleHeaderClick}
            currentView={appCurrentViewType}
            isSidebarOpen={isLeftSidebarOpen}
            onToggleSidebar={toggleLeftSidebar}
          />
        )}

        <main className="flex-1 overflow-auto bg-gray-50 dark:bg-slate-900">
      {mainView === 'dashboard' ? (
        <>
              {(desiredTail || true) && (
                <div className="px-2 pt-0 flex flex-wrap gap-2">
                  {/* Primary desired scanner badge (bigger) */}
                  {desiredTail && (() => {
                    const present = !!desiredPortState?.present;
                    const badgeBase = 'inline-flex items-center gap-1 rounded-full px-3 py-1 text-[12px] md:text-[13px] font-extrabold';
                    const badgeColor = present
                      ? 'border border-emerald-300 bg-emerald-50 text-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-200'
                      : 'border border-red-300 bg-red-50 text-red-900 dark:bg-red-900/20 dark:text-red-200';
                    return (
                      <span className={`${badgeBase} ${badgeColor}`}>
                        Scanner: {desiredTail}
                        <span className={present ? 'text-emerald-700' : 'text-red-700'}>
                          {present ? 'detected' : 'not detected'}
                        </span>
                      </span>
                    );
                  })()}
                  {/* Redis badge (bigger) */}
                  {(() => {
                    const ready = !!(serial as any).redisReady;
                    const badgeBase = 'inline-flex items-center gap-1 rounded-full px-3 py-1 text-[12px] md:text-[13px] font-extrabold';
                    const badgeColor = ready
                      ? 'border border-emerald-300 bg-emerald-50 text-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-200'
                      : 'border border-red-300 bg-red-50 text-red-900 dark:bg-red-900/20 dark:text-red-200';
                    return (
                      <span className={`${badgeBase} ${badgeColor}`}>
                        Redis:
                        <span className={ready ? 'text-emerald-700' : 'text-red-700'}>
                          {ready ? 'connected' : 'offline'}
                        </span>
                      </span>
                    );
                  })()}
                  {/* Live monitor badge (debug) */}
                  {(() => {
                    const mac = (macAddress || '').toUpperCase();
                    const on = !!((serial as any).sseConnected && mac);
                    const cnt = Number((serial as any).evCount || 0);
                    const badgeBase = 'inline-flex items-center gap-1 rounded-full px-3 py-1 text-[12px] md:text-[13px] font-extrabold';
                    const badgeColor = on
                      ? 'border border-emerald-300 bg-emerald-50 text-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-200'
                      : 'border border-slate-300 bg-slate-50 text-slate-700 dark:bg-slate-800/40 dark:text-slate-200';
                    return (
                      <span className={`${badgeBase} ${badgeColor}`} title={mac ? `MAC ${mac}` : 'inactive'}>
                        Live:
                        <span className={on ? 'text-emerald-700' : 'text-slate-600'}>
                          {on ? `on (EV ${cnt})` : 'off'}
                        </span>
                      </span>
                    );
                  })()}
                  {/* Only show desired scanner + Redis on this page */}
                </div>
              )}
              {/* UI cue banner removed (no UI polling) */}

              {errorMsg && <div className="px-8 pt-2 text-sm text-red-600">{errorMsg}</div>}

              <BranchDashboardMainContent
               key={session}
                appHeaderHeight={actualHeaderHeight}
                onManualSubmit={handleManualSubmit}
                onScanAgainRequest={() => loadBranchesData()}
                branchesData={branchesData}
                groupedBranches={groupedBranches}
                checkFailures={checkFailures}
                nameHints={nameHints}
                kfbNumber={kfbNumber}
                kfbInfo={kfbInfo}
                // Hide scanning visuals for manual submits (we gate via showScanUi)
                isScanning={isScanning && showScanUi}
                macAddress={macAddress}
                activeKssks={activeKssks}
              lastEv={(serial as any).lastEv}
              lastEvTick={(serial as any).lastEvTick}
              normalPins={normalPins}
                latchPins={latchPins}
                
                onResetKfb={handleResetKfb}
                flashOkTick={okFlashTick}
                okSystemNote={okSystemNote}

            />

              {/* Hidden form target if you submit manually elsewhere */}
              <form onSubmit={handleKfbSubmit} className="hidden" />
            </>
          ) : mainView === 'settingsConfiguration' ? (
            <SettingsPageContent onNavigateBack={showDashboard} onShowProgramForConfig={showBranchesSettings} />
          ) : (
            <SettingsBranchesPageContent onNavigateBack={showDashboard} configId={currentConfigIdForProgram} />
          )}
        </main>
      </div>

      <SettingsRightSidebar
        isOpen={isSettingsSidebarOpen}
        onClose={() => setIsSettingsSidebarOpen(false)}
        appHeaderHeight={actualHeaderHeight}
        onShowConfigurationInMain={showConfig}
        onShowBranchesSettingsInMain={() => showBranchesSettings()}
      />

      <style>{`
        .plug-wiggle { animation: wiggle 1s ease-in-out infinite; }
        @keyframes wiggle { 0%,100% { transform: translateX(0) } 50% { transform: translateX(8px) } }
      `}</style>

      {/* SCANNING / OK / ERROR overlay */}
<AnimatePresence>
  {overlay.open && (
    <m.div
      variants={bg}
      initial="hidden"
      animate="visible"
      exit="exit"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(2,6,23,0.64)',
        backdropFilter: 'blur(4px)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 9999,
      }}
      aria-live="assertive"
      aria-label={
        overlay.kind === 'scanning' && overlay.code
          ? overlay.code
          : overlay.kind.toUpperCase()
      }
    >
      <m.div
        variants={card}
        initial="hidden"
        animate="visible"
        exit="exit"
        style={{ display: 'grid', justifyItems: 'center', gap: 8 }}
      >
        {overlay.kind === 'success' ? (
          <>
            <m.div
              initial={{ scale: reduce ? 1 : 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 260, damping: 20 }}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ width: 160, height: 160, color: KIND_STYLES.success }}
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M9 12l2 2 4-4" />
              </svg>
            </m.div>
            <m.div
              variants={heading}
              style={{
                fontSize: 56,
                fontWeight: 900,
                letterSpacing: '0.02em',
                color: KIND_STYLES.success,
                textShadow: '0 6px 18px rgba(0,0,0,0.45)',
              }}
            >
              OK
            </m.div>
          </>
        ) : (
          <>
            <m.div
              variants={heading}
              style={{
                fontSize: 128,
                fontWeight: 900,
                letterSpacing: '0.02em',
                color: KIND_STYLES[overlay.kind],
                textShadow: '0 8px 24px rgba(0,0,0,0.45)',
                fontFamily:
                  overlay.kind === 'scanning'
                    ? 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
                    : 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Apple Color Emoji", "Segoe UI Emoji"',
              }}
            >
              {overlay.kind === 'scanning' && overlay.code
                ? overlay.code // show MAC big
                : overlay.kind.toUpperCase()}
            </m.div>

            {overlay.kind === 'scanning' && overlay.code ? (
              <m.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: reduce ? 0 : 0.05 }}
                style={{ fontSize: 18, color: '#f1f5f9', opacity: 0.95 }}
              >
                SCANNING…
              </m.div>
            ) : overlay.code ? (
              <m.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: reduce ? 0 : 0.05 }}
                style={{
                  fontSize: 16,
                  color: '#f1f5f9',
                  opacity: 0.95,
                  wordBreak: 'break-all',
                  textAlign: 'center',
                  maxWidth: 640,
                }}
              >
                {overlay.code}
              </m.div>
            ) : null}
          </>
        )}
      </m.div>
    </m.div>
  )}
</AnimatePresence>

    </div>
  );
};

export default MainApplicationUI;
