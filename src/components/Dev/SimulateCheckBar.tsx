"use client";

import React from 'react';
import { useSerialEvents } from '@/components/Header/useSerialEvents';

type SimConfig = {
  scenario: string;
  macOverride?: string | null;
};

const LIVE_INITIAL = {
  started: false,
  done: false,
  ok: undefined as boolean | undefined,
  evCount: 0,
};

export default function SimulateCheckBar() {
  const [panelOpen, setPanelOpen] = React.useState(false);
  const [available, setAvailable] = React.useState<boolean | null>(null);
  const [loadingConfig, setLoadingConfig] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const serial = useSerialEvents(undefined, { disabled: !panelOpen, base: panelOpen });
  const [mac, setMac] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [last, setLast] = React.useState<{ ok?: boolean; failures?: number; msg?: string } | null>(null);
  const [live, setLive] = React.useState<{ started?: boolean; done?: boolean; ok?: boolean; evCount: number }>(
    () => ({ ...LIVE_INITIAL })
  );
  const [unionPins, setUnionPins] = React.useState<number[]>([]);
  const [names, setNames] = React.useState<Record<string,string>>({});
  const [simFailing, setSimFailing] = React.useState<Set<number>>(new Set());
  const [useFallbackCheck, setUseFallbackCheck] = React.useState(true);

  const isMountedRef = React.useRef(true);
  React.useEffect(() => () => { isMountedRef.current = false; }, []);

  const loadSimulatorConfig = React.useCallback(async () => {
    setLoadingConfig(true);
    setLoadError(null);
    try {
      const r = await fetch('/api/simulate', { cache: 'no-store' });
      const j = await r.json();
      if (!isMountedRef.current) return false;
      const enabled = !!j?.enabled;
      setAvailable(enabled);
      if (!enabled) {
        setLoadError(j?.error ? String(j.error) : 'Simulation disabled');
        return false;
      }
      const cfg = j?.config as SimConfig | undefined;
      const m = String((cfg?.macOverride || '')).toUpperCase();
      if (m) setMac(m);
      const fp = (cfg as any)?.failurePins as any[] | undefined;
      if (Array.isArray(fp)) {
        setSimFailing(new Set(fp.map(Number).filter((n) => Number.isFinite(n) && n > 0)));
      }
      setLoadError(null);
      return true;
    } catch (err: any) {
      if (!isMountedRef.current) return false;
      setAvailable(null);
      setLoadError(`Simulator unavailable: ${String(err?.message ?? err)}`);
      return false;
    } finally {
      if (isMountedRef.current) setLoadingConfig(false);
    }
  }, []);

  const handleOpenPanel = React.useCallback(async () => {
    if (panelOpen || loadingConfig) return;
    const ok = await loadSimulatorConfig();
    if (ok && isMountedRef.current) {
      setPanelOpen(true);
      setLast(null);
      setLive({ ...LIVE_INITIAL });
    }
  }, [panelOpen, loadingConfig, loadSimulatorConfig]);

  const handleClosePanel = React.useCallback(() => {
    setPanelOpen(false);
    setLast(null);
    setLive({ ...LIVE_INITIAL });
  }, []);

  // Listen to EV stream for START/DONE and count when monitoring
  React.useEffect(() => {
    if (!panelOpen) return;
    const ev: any = serial.lastEv;
    if (!ev || ev.type !== 'ev') return;
    if (ev.kind === 'START') setLive({ started: true, done: false, ok: undefined, evCount: 0 });
    else if (ev.kind === 'DONE') setLive((p) => ({ ...p, done: true, ok: !!ev.ok }));
    else setLive((p) => ({ ...p, evCount: (p.evCount || 0) + 1 }));
  }, [panelOpen, serial.lastEvTick]);

  // Load union pins and labels for current MAC
  React.useEffect(() => {
    if (!panelOpen) {
      setUnionPins([]);
      setNames({});
      return;
    }
    let stop = false;
    const mm = (mac || '').toUpperCase().trim();
    const MAC_RE = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i;
    if (!mm || !MAC_RE.test(mm)) { setUnionPins([]); setNames({}); return; }
    (async () => {
      try {
        const r = await fetch(`/api/aliases?mac=${encodeURIComponent(mm)}`, { cache: 'no-store' });
        if (!r.ok) return;
        const j = await r.json();
        if (stop) return;
        const np = Array.isArray(j?.normalPins) ? j.normalPins : [];
        const lp = Array.isArray(j?.latchPins) ? j.latchPins : [];
        const pins = Array.from(new Set([...(np||[]), ...(lp||[])]))
          .map((n: any)=>Number(n)).filter((n:number)=>Number.isFinite(n)&&n>0).sort((a:number,b:number)=>a-b);
        setUnionPins(pins);
        setNames((j?.aliases && typeof j.aliases==='object') ? j.aliases as Record<string,string> : {});
      } catch {}
    })();
    return () => { stop = true; };
  }, [panelOpen, mac]);

  // NOTE: Do not auto-post MAC changes — only update simulator MAC during Run Check.


  const liveRef = React.useRef<{ started?: boolean; done?: boolean; ok?: boolean }>({});
  React.useEffect(() => { liveRef.current = { started: live.started, done: live.done, ok: live.ok }; }, [live.started, live.done, live.ok]);

  const pathsEqual = (a?: string | null, b?: string | null) => {
    if (!a || !b) return false;
    if (a === b) return true;
    const tail = (s: string) => (s.split('/').pop() || s).toLowerCase();
    const ta = tail(a);
    const tb = tail(b);
    if (ta === tb) return true;
    const normalize = (s: string) => {
      const m = s.match(/(ACM|USB)(\d+)/i);
      return m ? `${m[1].toUpperCase()}${m[2]}` : null;
    };
    const na = normalize(a) || normalize(ta);
    const nb = normalize(b) || normalize(tb);
    return !!(na && nb && na === nb);
  };

  const resolveDashboardPath = (): string | undefined => {
    const list: string[] = Array.isArray((serial as any).scannerPaths)
      ? (serial as any).scannerPaths
      : [];
    if (!list.length) return undefined;

    const configured = (process.env.NEXT_PUBLIC_SCANNER_PATH_DASHBOARD || '').trim();
    if (configured) {
      const fixed = list.find((p) => pathsEqual(p, configured));
      if (fixed) return fixed;
    }

    const preferAcm1 = list.find((p) => /(^|\/)ttyACM1$/i.test(p) || /(\/|^)(ACM)1(?!\d)/i.test(p));
    if (preferAcm1) return preferAcm1;
    const preferUsb1 = list.find((p) => /(^|\/)ttyUSB1$/i.test(p) || /(\/|^)(USB)1(?!\d)/i.test(p));
    if (preferUsb1) return preferUsb1;

    const idx = Math.max(0, Number(process.env.NEXT_PUBLIC_SCANNER_INDEX_DASHBOARD ?? '1'));
    if (list[idx]) return list[idx];

    return list[0];
  };

  const runCheck = async () => {
    const MAC_RE = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i;
    if (!mac || !MAC_RE.test(mac.toUpperCase())) return;
    setBusy(true); setLast(null);
    try {
      try { (window as any).__armScanOnce__ = true; } catch {}
      // Prefer sending a single simulated scanner code so the main app flow runs like a real scan.
      // Target the same path the main dashboard listens on so Setup doesn't consume the scan.
      const desiredPath = resolveDashboardPath() || (serial as any).lastScanPath || undefined;
      await fetch('/api/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mac: mac.toUpperCase(),
          scan: [desiredPath ? { code: mac.toUpperCase(), path: desiredPath } : { code: mac.toUpperCase() }],
        }),
      });
      try {
        const detail = { code: mac.toUpperCase(), trigger: 'simulate', allowDuringSetup: true };
        window.dispatchEvent(new CustomEvent('kfb:sim-scan', { detail }));
      } catch {}
      // Optional fallback: only if enabled and no START was seen soon after the single scan
      if (useFallbackCheck) {
        setTimeout(async () => {
          try {
            if (liveRef.current.started) return; // main app already reacting via SSE
            const res = await fetch('/api/serial/check', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ mac: mac.toUpperCase() }),
            });
            const j = await res.json().catch(() => null);
            if (res.ok)
              setLast({
                ok: (Array.isArray(j?.failures) ? j.failures.length : 0) === 0,
                failures: Array.isArray(j?.failures) ? j.failures.length : undefined,
              });
            else setLast({ ok: false, msg: j?.error || String(res.status) });
          } catch {}
        }, 600);
      }
    } catch (e: any) {
      setLast({ ok: false, msg: String(e?.message || e) });
    } finally {
      setBusy(false);
    }
  };

  // helpers to control simulation failing pins
  const apply = async (body: any) => {
    try {
      const r = await fetch('/api/simulate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mac: (mac||'').toUpperCase().trim() || undefined, ...body }) });
      const j = await r.json().catch(()=>null);
      const fp = j?.config?.failurePins as any[] | undefined;
      if (Array.isArray(fp)) setSimFailing(new Set(fp.map(Number)));
    } catch {}
  };
  const togglePin = async (pin: number) => { await apply({ togglePin: pin }); };
  const failAll = async () => { if (unionPins.length) await apply({ scenario: 'failure', failurePins: unionPins }); };
  const clearFails = async () => { await apply({ scenario: 'success', failurePins: [] }); };

  if (!panelOpen) {
    if (available === false) return null;
    return (
      <div style={{ position: 'fixed', right: 12, bottom: 120, zIndex: 50 }}>
        <div style={{ padding: 8, borderRadius: 12, background: 'rgba(17,24,39,0.85)', color: '#fff', boxShadow: '0 10px 30px rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={handleOpenPanel}
            disabled={loadingConfig}
            style={{ padding: '6px 10px', borderRadius: 10, background: '#2563eb', color: '#fff' }}
          >
            {loadingConfig ? 'Opening…' : 'Monitor'}
          </button>
          {loadError && (
            <span style={{ fontSize: 11, opacity: 0.8 }}>{loadError}</span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: 'fixed', right: 12, bottom: 120, zIndex: 50 }}>
      <div style={{ padding: 8, borderRadius: 12, background: 'rgba(17,24,39,0.85)', color: '#fff', boxShadow: '0 10px 30px rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 360 }}>
        <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
          <span style={{ fontSize: 12, opacity: 0.8, flex: 1 }}>Sim Check</span>
          <button
            onClick={handleClosePanel}
            style={{ padding: '4px 8px', borderRadius: 8, background: '#1f2937', color: '#fff', fontSize: 11 }}
          >
            Close
          </button>
        </div>
        <input
          placeholder="AA:BB:CC:DD:EE:FF"
          value={mac}
          onChange={(e) => setMac(e.target.value.toUpperCase())}
          style={{ width: 195, textAlign: 'center', padding: '4px 8px', borderRadius: 8, background: '#111827', color: '#fff', border: '1px solid #374151' }}
        />
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, opacity: 0.9 }}>
          <input type="checkbox" checked={useFallbackCheck} onChange={(e) => setUseFallbackCheck(e.target.checked)} />
          Fallback CHECK if no SSE
        </label>
        <button onClick={runCheck} disabled={busy || !mac} style={{ padding: '6px 10px', borderRadius: 10, background: '#2563eb', color: '#fff' }}>Run Check</button>
        {last && (
          <span style={{ fontSize: 12, opacity: 0.9, paddingLeft: 6, color: last.ok ? '#10b981' : '#fca5a5' }}>
            {last.ok ? 'OK' : (last.failures != null ? `${last.failures} fail` : (last.msg || 'ERR'))}
          </span>
        )}
        <span style={{ fontSize: 11, opacity: 0.8, paddingLeft: 8 }}>
          {live.started ? (live.done ? (live.ok ? 'DONE OK' : 'DONE FAIL') : `RUNNING · EV ${live.evCount}`) : ''}
        </span>
        {unionPins.length > 0 && (
          <>
            <div style={{ width: '100%' }} />
            <button onClick={failAll} disabled={busy} style={{ padding: '6px 10px', borderRadius: 10, background: '#ef4444', color: '#fff' }}>Fail all</button>
            <button onClick={clearFails} disabled={busy} style={{ padding: '6px 10px', borderRadius: 10, background: '#10b981', color: '#fff' }}>Clear</button>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxWidth: 520 }}>
              {unionPins.map((p) => {
                const failing = simFailing.has(p);
                const label = names[String(p)] || `PIN ${p}`;
                return (
                  <button key={p} title={label} onClick={() => togglePin(p)} disabled={busy}
                    style={{ padding: '4px 8px', borderRadius: 999, fontSize: 12, background: failing ? '#7f1d1d' : '#1f2937', color: '#fff', border: '1px solid rgba(255,255,255,0.08)' }}>
                    {p}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
