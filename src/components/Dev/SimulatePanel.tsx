"use client";

import React from 'react';
import { useSerialEvents } from '@/components/Header/useSerialEvents';

type SimConfig = {
  scenario: string;
  failurePins: number[];
  resultDelayMs: number;
  macOverride?: string | null;
};

export default function SimulatePanel() {
  const serial = useSerialEvents();
  const [enabled, setEnabled] = React.useState(false);
  const [config, setConfig] = React.useState<SimConfig | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [failCount, setFailCount] = React.useState<number>(5);

  // Live pin state from EV stream (0 = failing, 1 = passing)
  const [pinState, setPinState] = React.useState<Record<number, 0|1>>({});
  const [pinFlash, setPinFlash] = React.useState<Record<number, number>>({});
  const [session, setSession] = React.useState<{ startedAt?: number|null; done?: boolean; ok?: boolean }|null>(null);
  const [eventLog, setEventLog] = React.useState<Array<string>>([]);
  const [macInput, setMacInput] = React.useState('');
  const [kskInputs, setKskInputs] = React.useState<string[]>(['', '', '']);

  const unionPins = React.useMemo(() => {
    const n = serial.lastUnion?.normalPins || [];
    const l = serial.lastUnion?.latchPins || [];
    return Array.from(new Set([...(n||[]), ...(l||[])])).sort((a,b)=>a-b);
  }, [serial.lastUnion]);

  const refresh = React.useCallback(async () => {
    try {
      const r = await fetch('/api/simulate', { cache: 'no-store' });
      const j = await r.json();
      setEnabled(!!j.enabled);
      if (j.config) setConfig(j.config as SimConfig);
    } catch {}
  }, []);

  React.useEffect(() => { refresh(); }, [refresh]);
  React.useEffect(() => {
    // Initialize MAC input from config when present
    if (!macInput && config?.macOverride) setMacInput(String(config.macOverride).toUpperCase());
  }, [config?.macOverride]);

  // Track live EV updates to reflect real-time state and a small event log
  React.useEffect(() => {
    const ev: any = serial.lastEv;
    if (!ev || ev.type !== 'ev') return;
    if (ev.kind === 'P') {
      const ch = Number(ev.ch);
      const val = Number(ev.val) ? 1 : 0;
      if (!Number.isFinite(ch) || ch <= 0) return;
      setPinState((prev) => ({ ...prev, [ch]: val as 0|1 }));
      setPinFlash((prev) => ({ ...prev, [ch]: Date.now() }));
      setEventLog((prev) => [`P ${ch}=${val}`, ...prev].slice(0, 8));
      return;
    }
    if (ev.kind === 'START') {
      setSession({ startedAt: Date.now(), done: false, ok: undefined });
      setEventLog((prev) => [`START ${(ev.mac||'')}`, ...prev].slice(0, 8));
      return;
    }
    if (ev.kind === 'DONE') {
      const ok = !!ev.ok;
      setSession({ startedAt: (session?.startedAt ?? null), done: true, ok });
      setEventLog((prev) => [`DONE ${ok ? 'OK' : 'FAIL'}`, ...prev].slice(0, 8));
      return;
    }
  }, [serial.lastEvTick]);

  const apply = async (body: any) => {
    setBusy(true);
    try {
      const r = await fetch('/api/simulate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json();
      if (j?.config) setConfig(j.config as SimConfig);
    } catch {} finally { setBusy(false); }
  };

  const setSuccess = () => apply({ scenario: 'success', failurePins: [] });
  const setFailure = (count = 5) => {
    const pins = unionPins.length ? unionPins.slice(0, count) : Array.from({length: count}, (_,i)=>i+1);
    apply({ scenario: 'failure', failurePins: pins });
  };
  const togglePin = (pin: number) => apply({ togglePin: pin });
  const sendPress = (pin: number, val: 0|1) => apply({ ev: [{ kind: 'P', ch: pin, val }] });

  const saveKskMappings = async () => {
    const mac = (macInput || '').toUpperCase().trim();
    if (!/^[0-9A-F]{2}(?::[0-9A-F]{2}){5}$/.test(mac)) {
      setEventLog((prev) => ['ERR invalid MAC', ...prev].slice(0, 8));
      return;
    }
    const pins = unionPins.length ? unionPins : Array.from(new Set(Object.entries(pinState).filter(([,v])=>v===0).map(([k])=>Number(k))));
    // Build simple CL_<pin> aliases like XML-derived names
    const aliases: Record<string,string> = {};
    for (const p of pins) aliases[String(p)] = `CL_${p}`;
    setBusy(true);
    try {
      // Persist union (MAC-level) first
      const ru = await fetch('/api/aliases', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mac, normalPins: pins, latchPins: [], aliases }) });
      const unionOk = ru.ok;
      let okCount = 0; let total = 0;
      // Then per-KSK entries (up to 3)
      for (const raw of kskInputs) {
        const ksk = String(raw || '').trim();
        if (!ksk) continue;
        total += 1;
        const rk = await fetch('/api/aliases', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mac, ksk, normalPins: pins, latchPins: [], aliases }) });
        if (rk.ok) okCount += 1;
        // Also acquire a station lock to mirror real setup
        try {
          const stationId = (process.env.NEXT_PUBLIC_STATION_ID || window.location.hostname || 'SIM').toString();
          const ttlSec = Math.max(5, Number(process.env.NEXT_PUBLIC_KSK_TTL_SEC || 172800));
          await fetch('/api/ksk-lock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mac, ksk, stationId, ttlSec }) });
        } catch {}
      }
      if (unionOk) setEventLog((prev) => [`Saved to Redis: union ok; KSK ${okCount}/${total}`, ...prev].slice(0, 8));
      else setEventLog((prev) => [`Redis save failed (union)`, ...prev].slice(0, 8));
    } catch (e: any) {
      setEventLog((prev) => [`ERR saving aliases: ${String(e?.message||e)}`, ...prev].slice(0, 8));
    } finally {
      setBusy(false);
    }
  };

  // Prefer live EV pin state; fallback to config failurePins
  const failing = React.useMemo(() => {
    const live = new Set<number>();
    const keys = Object.keys(pinState);
    if (keys.length) {
      for (const k of keys) { const p = Number(k); if (pinState[p] === 0) live.add(p); }
      return live;
    }
    return new Set<number>(config?.failurePins || []);
  }, [pinState, config?.failurePins]);

  return !enabled ? null : (
    <div style={{ position: 'fixed', right: 12, bottom: 72, zIndex: 50 }}>
      <div style={{ padding: 10, borderRadius: 12, background: 'rgba(17,24,39,0.85)', color: '#fff', boxShadow: '0 10px 30px rgba(0,0,0,0.35)' }}>
        <div style={{ fontSize: 14, opacity: 0.85, marginBottom: 6 }}>Simulation</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <button onClick={setSuccess} disabled={busy} style={{ padding: '6px 10px', borderRadius: 10, background: config?.scenario==='success'?'#10b981':'#374151', color: '#fff' }}>OK</button>
          <button onClick={() => setFailure(5)} disabled={busy} style={{ padding: '6px 10px', borderRadius: 10, background: config?.scenario==='failure'?'#ef4444':'#374151', color: '#fff' }}>Fail 5</button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 12, opacity: 0.8 }}>Fail N</span>
          <button onClick={() => setFailCount((n) => Math.max(0, n-1))} disabled={busy} style={{ padding: '2px 8px', borderRadius: 8, background: '#374151', color: '#fff' }}>-</button>
          <input
            type="number"
            value={failCount}
            onChange={(e) => setFailCount(Math.max(0, Math.min(999, Number(e.target.value)||0)))}
            style={{ width: 52, textAlign: 'center', padding: '4px 6px', borderRadius: 8, background: '#111827', color: '#fff', border: '1px solid #374151' }}
          />
          <button onClick={() => setFailCount((n) => Math.min((unionPins.length || 10), n+1))} disabled={busy} style={{ padding: '2px 8px', borderRadius: 8, background: '#374151', color: '#fff' }}>+</button>
          <button onClick={() => setFailure(failCount)} disabled={busy} style={{ marginLeft: 6, padding: '6px 10px', borderRadius: 10, background: '#ef4444', color: '#fff' }}>Apply</button>
        </div>
        {/* Setup page should not start monitor; we only set failure pins and allow live toggles. */}
        {/* MAC + KSK setup (simulation persists to Redis) */}
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom: 8 }}>
          <span style={{ fontSize:12, opacity:.8 }}>MAC</span>
          <input value={macInput} onChange={(e)=>setMacInput(e.target.value.toUpperCase())}
            placeholder="08:3A:8D:15:27:54"
            style={{ width: 210, textAlign: 'center', padding: '4px 8px', borderRadius: 8, background: '#111827', color: '#fff', border: '1px solid #374151' }} />
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:10, flexWrap:'wrap' }}>
          <span style={{ fontSize:12, opacity:.8 }}>KSKs</span>
          {kskInputs.map((v, i) => (
            <input key={i} value={v} onChange={(e)=>setKskInputs((prev)=>prev.map((x, idx)=>idx===i?e.target.value:x))}
              placeholder={`KSK${i+1}`}
              style={{ width: 120, textAlign: 'center', padding: '4px 8px', borderRadius: 8, background: '#111827', color: '#fff', border: '1px solid #374151' }} />
          ))}
          <button onClick={saveKskMappings} disabled={busy || !macInput}
            style={{ padding:'6px 10px', borderRadius: 10, background:'#10b981', color:'#fff' }}>Save</button>
        </div>

        {/* Session summary */}
        {session && (
          <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom: 8 }}>
            <span style={{ fontSize:12, opacity:.8 }}>Session:</span>
            <span style={{ fontSize:12, color: session.done ? (session.ok ? '#10b981' : '#ef4444') : '#e5e7eb' }}>
              {session.done ? (session.ok ? 'DONE OK' : 'DONE FAIL') : 'STARTED'}
            </span>
          </div>
        )}

        {unionPins.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxWidth: 320, marginBottom: 8 }}>
            {unionPins.map((p) => {
              const failingNow = failing.has(p);
              const last = pinFlash[p] || 0;
              const age = Date.now() - last;
              const flash = last && age < 600;
              const bg = failingNow ? '#7f1d1d' : '#1f2937';
              const boxShadow = flash ? '0 0 0 2px rgba(59,130,246,0.6)' : 'none';
              return (
                <div key={p} style={{ display:'inline-flex', alignItems:'center', gap:6 }}>
                  <button onClick={() => togglePin(p)} disabled={busy}
                    title={`Toggle failure for pin ${p}`}
                    style={{ padding: '4px 8px', borderRadius: 999, fontSize: 12, background: bg, color: '#fff', border: '1px solid rgba(255,255,255,0.08)', boxShadow }}>
                    {p}
                  </button>
                  <div style={{ display:'inline-flex', gap:4 }}>
                    <button onClick={() => sendPress(p, 1)} disabled={busy} title={`Press pin ${p}`}
                      style={{ padding:'2px 6px', borderRadius: 8, background:'#374151', color:'#fff', fontSize:11 }}>
                      Press
                    </button>
                    <button onClick={() => sendPress(p, 0)} disabled={busy} title={`Release pin ${p}`}
                      style={{ padding:'2px 6px', borderRadius: 8, background:'#374151', color:'#fff', fontSize:11 }}>
                      Release
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Small event log */}
        {eventLog.length > 0 && (
          <div style={{ maxHeight: 96, overflowY: 'auto', fontSize: 11, lineHeight: 1.5, color: '#e5e7eb', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 6 }}>
            {eventLog.map((ln, i) => (
              <div key={i} style={{ opacity: i ? 0.75 : 1 }}>{ln}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
