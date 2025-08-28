'use client';

import React, { useState, useEffect, useCallback, useRef, FormEvent } from 'react';
import dynamic from 'next/dynamic';
import { m, AnimatePresence } from 'framer-motion';

import { BranchDisplayData, KfbInfo, TestStatus } from '@/types/types';
import { Header } from '@/components/Header/Header';
import { BranchControlSidebar } from '@/components/Program/BranchControlSidebar';
import { SettingsPageContent } from '@/components/Settings/SettingsPageContent';
import { SettingsBranchesPageContent } from '@/components/Settings/SettingsBranchesPageContent';
import BranchDashboardMainContent from '@/components/Program/BranchDashboardMainContent';
import { useSerialEvents } from '@/components/Header/useSerialEvents';

import SettingsRightSidebar from '@/components/Settings/SettingsRightSidebar';

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
  // UI state
  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(false);
  const [isSettingsSidebarOpen, setIsSettingsSidebarOpen] = useState(false);
  const [mainView, setMainView] = useState<MainView>('dashboard');

  // Data / process state
  const [branchesData, setBranchesData] = useState<BranchDisplayData[]>([]);
  const [groupedBranches, setGroupedBranches] = useState<Array<{ kssk: string; branches: BranchDisplayData[] }>>([]);
  const [kfbNumber, setKfbNumber] = useState('');
  const [kfbInfo, setKfbInfo] = useState<KfbInfo | null>(null);
  const [macAddress, setMacAddress] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [nameHints, setNameHints] = useState<Record<string,string> | undefined>(undefined);
  const [normalPins, setNormalPins] = useState<number[] | undefined>(undefined);
  const [latchPins, setLatchPins] = useState<number[] | undefined>(undefined);
  const [activeKssks, setActiveKssks] = useState<string[]>([]);
  const [scanningError, setScanningError] = useState(false);

  // Check flow
  const [checkFailures, setCheckFailures] = useState<number[] | null>(null);
  const [isChecking, setIsChecking] = useState(false);
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
  const lastScanRef = useRef('');
  const [okOverlayActive, setOkOverlayActive] = useState(false);
  const [okAnimationTick, setOkAnimationTick] = useState(0);
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
    return `/dev/ttyACM${DASH_SCANNER_INDEX}`;
  };
  const desiredPath = resolveDesiredPath();
  const desiredTail = (desiredPath || '').split('/').pop() || desiredPath || '';
  const desiredPortState = (() => {
    const map = serial.scannerPorts || {} as any;
    const key = Object.keys(map).find((k) => pathsEqual(k, desiredPath || ''));
    return key ? (map as any)[key] as { open: boolean; present: boolean } : null;
  })();

  // Apply union updates from SSE if they match current MAC
  useEffect(() => {
    const u = (serial as any).lastUnion as { mac?: string; normalPins?: number[]; latchPins?: number[]; names?: Record<string,string> } | null;
    if (!u) return;
    const cur = (macAddress || '').toUpperCase();
    if (!cur || String(u.mac||'').toUpperCase() !== cur) return;
    try {
      if (Array.isArray(u.normalPins)) setNormalPins(u.normalPins);
      if (Array.isArray(u.latchPins)) setLatchPins(u.latchPins);
      if (u.names && typeof u.names === 'object') setNameHints(u.names as any);
      // Persist union names locally for immediate reuse without refresh
      if (u.names && typeof u.names === 'object') {
        try { localStorage.setItem(`PIN_ALIAS::${cur}`, JSON.stringify(u.names)); } catch {}
      }
    } catch {}
  }, [serial.lastUnion, macAddress]);

  // Live EV updates: normalize legacy RESULT lines; on SUCCESS, mark branches OK and trigger lock cleanup.
  useEffect(() => {
    const ev = (serial as any).lastEv as { kind?: string; mac?: string | null; ok?: boolean; raw?: string } | null;
    if (!ev) return;
    const current = (macAddress || '').toUpperCase();
    const evMac = String(ev.mac || '').toUpperCase();
    const isZeroMac = evMac === '00:00:00:00:00:00';
    if (!current) return;

    // Normalize legacy RESULT lines where kind may not be DONE and mac may be 00:.. .
    const raw = String((ev as any).raw || '');
    const rxResult = /\bRESULT\s+(SUCCESS|OK|FAIL(?:URE)?)/i;
    const rxReplyFrom = /reply\s+from\s+([0-9A-F]{2}(?::[0-9A-F]{2}){5})/i;
    const rxAnyMac = /([0-9A-F]{2}(?::[0-9A-F]{2}){5})/gi;
    const looksResult = rxResult.test(raw);
    const okFromRaw = looksResult ? /\b(SUCCESS|OK)\b/i.test(raw) : undefined;
    let realMac: string | null = null;
    // Prefer "reply from <MAC>" when present
    const mFrom = raw.match(rxReplyFrom);
    if (mFrom && mFrom[1]) realMac = mFrom[1].toUpperCase();
    // Fallback: first non-zero MAC token in the line
    if (!realMac) {
      const tokens = Array.from(raw.matchAll(rxAnyMac)).map(m => String(m[1]).toUpperCase());
      const nonZero = tokens.find(t => t !== '00:00:00:00:00:00');
      if (nonZero) realMac = nonZero;
    }
    const kindNorm = (String(ev.kind || '').toUpperCase() === 'DONE' || looksResult) ? 'DONE' : String(ev.kind || '').toUpperCase();
    const okNorm = (ev.ok === true) || (okFromRaw === true);
    const macEff = isZeroMac && realMac ? realMac : (evMac || realMac || '');
    const match = (!!macEff && macEff === current) || (isZeroMac && !!realMac && realMac === current);

    if (kindNorm === 'DONE' && okNorm && match) {
      // Ensure the in-content success pipe animation can run by marking all branches OK
      setBranchesData(prev => prev.map(b => ({ ...b, testStatus: 'ok' })));
      // Clear any remembered failures so child considers this a full success
      try { setCheckFailures([]); } catch {}
      try { setIsChecking(false); setIsScanning(false); } catch {}
      try { setOkAnimationTick((x) => x + 1); } catch {}
      // Clear station locks in background
      (async () => {
        try {
          const stationId = (process.env.NEXT_PUBLIC_STATION_ID || process.env.STATION_ID || '').trim();
          const mac = current;
          if (stationId && mac) {
            await fetch(`/api/kssk-lock?stationId=${encodeURIComponent(stationId)}`, {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ mac, force: true }),
            }).catch(() => {});
          }
        } catch {}
      })();
    }
  }, [serial.lastEvTick, macAddress]);

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

  // Load KSSKs used for the current MAC from aliases index (authoritative per-MAC list)
  useEffect(() => {
    const mac = (macAddress || '').trim().toUpperCase();
    if (!mac) return;
    let stop = false;
    (async () => {
      try {
        const r = await fetch(`/api/aliases?mac=${encodeURIComponent(mac)}&all=1`, { cache: 'no-store' });
        const j = await r.json().catch(() => ({}));
        const items = Array.isArray(j?.items) ? j.items : [];
        const ids = items.map((it: any) => String(it.kssk)).filter(Boolean);
        if (!stop && ids.length) setActiveKssks(ids);
      } catch {}
    })();
    return () => { stop = true; };
  }, [macAddress]);

  // De-bounce duplicate scans
  const lastHandledScanRef = useRef<string>('');
  const scanDebounceRef = useRef<number>(0);
  const lastErrorStampRef = useRef<number>(0);
  // Prevent concurrent scan flows (SSE connect + poll race on refresh)
  const scanInFlightRef = useRef<boolean>(false);

  const handleResetKfb = () => {
    setKfbNumber('');
    setKfbInfo(null);
    setBranchesData([]);
    setKfbInput('');
    setGroupedBranches([]);
    setActiveKssks([]);
    setNameHints(undefined);
    setMacAddress('');
  };

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
          setBranchesData(_prev => {
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
              try { aliases = JSON.parse(localStorage.getItem(`PIN_ALIAS::${macUp}`) || '{}') || {}; } catch {}
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
              try { if (Object.keys(aliases).length) localStorage.setItem(`PIN_ALIAS::${macUp}`, JSON.stringify(aliases)); } catch {}
            }
            const pins = Object.keys(aliases).map(n => Number(n)).filter(n => Number.isFinite(n));
            pins.sort((a,b)=>a-b);
            const flat = pins.map(pin => ({
              id: String(pin),
              branchName: aliases[String(pin)] || `PIN ${pin}`,
              testStatus: failures.includes(pin) ? 'nok' as TestStatus : 'ok' as TestStatus,
              pinNumber: pin,
              kfbInfoValue: undefined,
            }));

            // Build grouped sections per KSSK if available from API
            const items = Array.isArray((result as any)?.items)
              ? (result as any).items as Array<{ kssk: string; aliases: Record<string,string> }>
              : (Array.isArray((result as any)?.itemsActive) ? (result as any).itemsActive as Array<{ kssk: string; aliases: Record<string,string> }> : []);
            if (items.length) {
              const groups: Array<{ kssk: string; branches: BranchDisplayData[] }> = [];
              for (const it of items) {
                const a = it.aliases || {};
                const pinsG = Object.keys(a).map(n => Number(n)).filter(n => Number.isFinite(n)).sort((x,y)=>x-y);
                const branchesG = pinsG.map(pin => ({
                  id: `${it.kssk}:${pin}`,
                  branchName: a[String(pin)] || `PIN ${pin}`,
                  testStatus: failures.includes(pin) ? 'nok' as TestStatus : 'ok' as TestStatus,
                  pinNumber: pin,
                  kfbInfoValue: undefined,
                } as BranchDisplayData));
                groups.push({ kssk: String((it as any).kssk || ''), branches: branchesG });
              }
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
              setGroupedBranches(groups);
              setActiveKssks(groups.map(g => g.kssk).filter(Boolean));
              // Also use union of all group pins for flat list
              const unionMap: Record<number, string> = {};
              for (const g of groups) for (const b of g.branches) if (typeof b.pinNumber === 'number') unionMap[b.pinNumber] = b.branchName;
              const unionPins = Object.keys(unionMap).map(n=>Number(n)).sort((x,y)=>x-y);
              return unionPins.map(pin => ({
                id: String(pin),
                branchName: unionMap[pin] || `PIN ${pin}`,
                testStatus: failures.includes(pin) ? 'nok' as TestStatus : 'ok' as TestStatus,
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
          });

          if (!unknown && failures.length === 0) {
            // Success: close SCANNING overlay; let the in-content SVG OK animation run and handle reset
            clearScanOverlayTimeout();
            setOverlay((o) => ({ ...o, open: false }));
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
          if (res.status === 504 || result?.pending === true || String(result?.code || '').toUpperCase() === 'NO_RESULT') {
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
              // Reset view back to default scan state shortly after showing error
              setTimeout(() => {
                handleResetKfb();
                setMacAddress('');
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
            // Reset view back to default scan state shortly after showing error
            setTimeout(() => {
              handleResetKfb();
              setMacAddress('');
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
              setMacAddress('');
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
            setMacAddress('');
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
  const loadBranchesData = useCallback(async (value?: string) => {
    const kfbRaw = (value ?? kfbInputRef.current).trim();
    if (!kfbRaw) return;

    const normalized = kfbRaw.toUpperCase();
    // Accept MAC directly for production run; otherwise require KFB pattern
    const macCanon = canonicalMac(normalized);
    const isMac = !!macCanon;
    if (!isMac && !KFB_REGEX.test(normalized)) {
      showOverlay('error', `Invalid code: ${normalized}`);
      console.warn('[SCAN] rejected by patterns', { normalized });
      hideOverlaySoon();
      return;
    }

    // show SCANNING immediately
    lastScanRef.current = normalized;
    showOverlay('scanning', normalized);
    startScanOverlayTimeout(5000);

    setIsScanning(true);
    setErrorMsg(null);
    setBranchesData([]);
    setKfbInfo(null);
    setKfbNumber('');
    setMacAddress('');
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
                if (Object.keys(aU).length) {
                  aliases = aU;
                  try { localStorage.setItem(`PIN_ALIAS::${mac}`, JSON.stringify(aliases)); } catch {}
                }
                // capture pin type context
                try {
                  const n = Array.isArray(jU?.normalPins) ? (jU.normalPins as number[]) : undefined;
                  const l = Array.isArray(jU?.latchPins) ? (jU.latchPins as number[]) : undefined;
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
      if (pins.length) {
        setBranchesData(pins.map(pin => ({
          id: String(pin),
          branchName: aliases[String(pin)] || `PIN ${pin}`,
          testStatus: 'not_tested' as TestStatus,
          pinNumber: pin,
          kfbInfoValue: undefined,
        })));
      } else {
        setBranchesData([]);
      }

      // Debug: log pins being sent for first CHECK
      try { console.log('[GUI] CHECK pins', pins); } catch {}
      await runCheck(mac, 0, pins);
    } catch (e) {
      console.error('Load/MONITOR error:', e);
      setKfbNumber('');
      setKfbInfo(null);
      setMacAddress('');
      setErrorMsg('Failed to load setup data. Please run Setup or scan MAC again.');
      showOverlay('error', 'Load failed');
      hideOverlaySoon();
    } finally {
      setIsScanning(false);
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

  // SSE → handle scans (gate by view, settings sidebar, and pause during CHECK)
  useEffect(() => {
    if (mainView !== 'dashboard') return;
    if (isSettingsSidebarOpen) return;
    if (isChecking) return;
    if (!serial.lastScanTick) return;              // no event yet
    if (lastScanPath && !isAcmPath(lastScanPath)) return;
    const want = resolveDesiredPath();
    if (want && lastScanPath && !pathsEqual(lastScanPath, want)) return; // ignore other scanner paths
    const code = serial.lastScan;                   // the latest payload
    if (!code) return;
    void handleScan(code);
   // optional: echo code for visibility
   // console.debug('[SSE scan]', { code, path: lastScanPath, tick: serial.lastScanTick });
 // depend on the tick, not the string
 }, [serial.lastScanTick, lastScanPath, handleScan, mainView, isSettingsSidebarOpen, isChecking]);

  // Polling fallback (filters to ACM via returned path and gates by view + settings). Pause during CHECK.
  useEffect(() => {
    if (mainView !== 'dashboard') return;
    if (isSettingsSidebarOpen) return;
    if (isChecking) return;
    if ((serial as any).sseConnected) return; // don't poll if SSE is healthy

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
        // Consume scan once so polling doesn't re-play the same code forever before SSE connects
        const url = want
          ? `/api/serial/scanner?path=${encodeURIComponent(want)}&consume=1`
          : '/api/serial/scanner?consume=1';
       const res = await fetch(url, { cache: 'no-store', signal: ctrl.signal });
        if (res.ok) {
           const { code, path, error, retryInMs } = await res.json();
           try { if (typeof retryInMs === 'number') (window as any).__scannerRetry = retryInMs; } catch {}
          const raw = typeof code === 'string' ? code.trim() : '';
          if (raw) {
            if (path && !isAcmPath(path)) return;
            if (want && path && !pathsEqual(path, want)) return;
            await handleScan(raw);
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
  }, [mainView, isSettingsSidebarOpen, handleScan, isChecking]);

  // Removed UI polling; success overlay auto-hides after 3s.

  // Manual submit from a form/input
  const handleKfbSubmit = (e: FormEvent) => {
    e.preventDefault();
    void loadBranchesData(kfbInputRef.current);
  };

  const handleManualSubmit = (submittedNumber: string) => {
    const val = submittedNumber.trim().toUpperCase();
    if (!val) return;
    if (!(canonicalMac(val) || KFB_REGEX.test(val))) {
      showOverlay('error', val);
      hideOverlaySoon();
      return;
    }
    const mac = canonicalMac(val);
    const next = mac || val;
    setKfbInput(next);
    setKfbNumber(next);
    void loadBranchesData(next);
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
                appHeaderHeight={actualHeaderHeight}
                onManualSubmit={handleManualSubmit}
                onScanAgainRequest={() => loadBranchesData()}
                branchesData={branchesData}
                groupedBranches={groupedBranches}
                checkFailures={checkFailures}
                nameHints={nameHints}
                kfbNumber={kfbNumber}
                kfbInfo={kfbInfo}
                isScanning={isScanning}
                macAddress={macAddress}
                activeKssks={activeKssks}
              lastEv={(serial as any).lastEv}
              lastEvTick={(serial as any).lastEvTick}
              normalPins={normalPins}
              latchPins={latchPins}
              forceOkTick={okAnimationTick}
              onResetKfb={handleResetKfb}
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
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
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
              overlay.kind === 'success' ? 'OK' :
              overlay.kind === 'error' ? 'ERROR' : 'SCANNING'
            }
          >
            <m.div
              initial={{ scale: 0.98, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.98, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 260, damping: 20 }}
              style={{ display: 'grid', justifyItems: 'center', gap: 8 }}
            >
              <m.div
                initial={{ y: 6, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.22 }}
                style={{
                  fontSize: 128,
                  fontWeight: 900,
                  letterSpacing: '0.02em',
                  color:
                    overlay.kind === 'success' ? '#10b981' :
                    overlay.kind === 'error' ? '#ef4444' :
                    '#60a5fa',
                  textShadow: '0 8px 24px rgba(0,0,0,0.45)',
                  fontFamily:
                    'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Apple Color Emoji", "Segoe UI Emoji"',
                }}
              >
                {overlay.kind === 'success' ? 'OK' :
                 overlay.kind === 'error' ? 'ERROR' : 'SCANNING'}
              </m.div>
              {overlay.code && (
                <m.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.05 }}
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
              )}
            </m.div>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default MainApplicationUI;
