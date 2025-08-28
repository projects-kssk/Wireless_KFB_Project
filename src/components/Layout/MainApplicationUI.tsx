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
const MAC_ONLY_REGEX = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i;

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
  const serial = useSerialEvents();
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

  // De-bounce duplicate scans
  const lastHandledScanRef = useRef<string>('');

  const handleResetKfb = () => {
    setKfbNumber('');
    setKfbInfo(null);
    setBranchesData([]);
    setKfbInput('');
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

        if (res.ok) {
          clearRetryTimer();
          const failures: number[] = result.failures || [];
          const unknown = result?.unknownFailure === true;
          const hints = (result?.nameHints && typeof result.nameHints === 'object') ? (result.nameHints as Record<string,string>) : undefined;
          setNameHints(hints);
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
            showOverlay('error', msg);
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
    const isMac = MAC_ONLY_REGEX.test(normalized);
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
      const mac = isMac ? normalized : normalized; // if KFB code equals MAC form, treat as MAC
      setKfbNumber(mac);
      setMacAddress(mac);

      // build from aliases if present
      let aliases: Record<string,string> = {};
      try { aliases = JSON.parse(localStorage.getItem(`PIN_ALIAS::${mac}`) || '{}') || {}; } catch {}
      let pins = Object.keys(aliases).map(n => Number(n)).filter(n => Number.isFinite(n)).sort((a,b)=>a-b);
      if (pins.length === 0) {
        // Fallback to Redis union if local cache empty
        try {
          const r = await fetch(`/api/aliases?mac=${encodeURIComponent(mac)}`, { cache: 'no-store' });
          if (r.ok) {
            const j = await r.json();
            const a = (j?.aliases && typeof j.aliases === 'object') ? (j.aliases as Record<string,string>) : {};
            if (a && Object.keys(a).length) {
              aliases = a;
              try { localStorage.setItem(`PIN_ALIAS::${mac}`, JSON.stringify(aliases)); } catch {}
              pins = Object.keys(aliases).map(n => Number(n)).filter(n => Number.isFinite(n)).sort((x,y)=>x-y);
            }
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
    if (normalized === lastHandledScanRef.current && !isScanningRef.current) {
      // allow manual re-check by clearing lastHandledScanRef if desired
    }
    lastHandledScanRef.current = normalized;

    // keep fields in sync
    if (normalized !== kfbInputRef.current) {
      setKfbInput(normalized);
      setKfbNumber(normalized);
    }

    if (!KFB_REGEX.test(normalized)) {
      showOverlay('error', normalized);
      hideOverlaySoon();
      return;
    }

    if (isScanningRef.current) return; // avoid overlapping flows
    await loadBranchesData(normalized);
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
        const url = want ? `/api/serial/scanner?path=${encodeURIComponent(want)}` : '/api/serial/scanner';
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
    if (!KFB_REGEX.test(val)) {
      showOverlay('error', val);
      hideOverlaySoon();
      return;
    }
    setKfbInput(val);
    setKfbNumber(val);
    void loadBranchesData(val);
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
