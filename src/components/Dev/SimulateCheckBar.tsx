"use client";

import React from 'react';
import { useSerialEvents } from '@/components/Header/useSerialEvents';

type SimConfig = {
  scenario: string;
  macOverride?: string | null;
};

export default function SimulateCheckBar() {
  const serial = useSerialEvents();
  const [enabled, setEnabled] = React.useState(false);
  const [mac, setMac] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [last, setLast] = React.useState<{ ok?: boolean; failures?: number; msg?: string } | null>(null);
  const [live, setLive] = React.useState<{ started?: boolean; done?: boolean; ok?: boolean; evCount: number }>(
    { started: false, done: false, ok: undefined, evCount: 0 }
  );

  React.useEffect(() => {
    let stop = false;
    (async () => {
      try {
        const r = await fetch('/api/simulate', { cache: 'no-store' });
        const j = await r.json();
        if (stop) return;
        setEnabled(!!j.enabled);
        const m = String(((j.config as SimConfig | undefined)?.macOverride || '')).toUpperCase();
        if (m) setMac(m);
      } catch {}
    })();
    return () => { stop = true; };
  }, []);

  // Listen to EV stream for START/DONE and count
  React.useEffect(() => {
    const ev: any = serial.lastEv;
    if (!ev || ev.type !== 'ev') return;
    if (ev.kind === 'START') setLive({ started: true, done: false, ok: undefined, evCount: 0 });
    else if (ev.kind === 'DONE') setLive((p) => ({ ...p, done: true, ok: !!ev.ok }));
    else setLive((p) => ({ ...p, evCount: (p.evCount || 0) + 1 }));
  }, [serial.lastEvTick]);


  const runCheck = async () => {
    if (!mac) return;
    setBusy(true); setLast(null);
    try {
      // Prefer sending a simulated scanner code so the main app flow runs like a real scan
      const paths: string[] = Array.isArray((serial as any).scannerPaths) ? (serial as any).scannerPaths : [];
      const idx = Math.max(0, Number(process.env.NEXT_PUBLIC_SCANNER_INDEX_DASHBOARD ?? '0'));
      const path = paths[idx] || '/dev/ttyACM0';
      await fetch('/api/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Send both raw MAC and a prefixed variant many classifiers accept
        body: JSON.stringify({ scan: [
          { code: `KFB:${mac.toUpperCase()}`, path },
          { code: mac.toUpperCase(), path }
        ] }),
      });
      // The UI’s scan handler will run load + check; we just show RUNNING status, then DONE via SSE
    } catch (e: any) {
      setLast({ ok: false, msg: String(e?.message || e) });
    } finally {
      setBusy(false);
    }
  };

  if (!enabled) return null;

  return (
    <div style={{ position: 'fixed', right: 12, bottom: 120, zIndex: 50 }}>
      <div style={{ padding: 8, borderRadius: 12, background: 'rgba(17,24,39,0.85)', color: '#fff', boxShadow: '0 10px 30px rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12, opacity: 0.8 }}>Sim Check</span>
        <input
          placeholder="AA:BB:CC:DD:EE:FF"
          value={mac}
          onChange={(e) => setMac(e.target.value.toUpperCase())}
          style={{ width: 195, textAlign: 'center', padding: '4px 8px', borderRadius: 8, background: '#111827', color: '#fff', border: '1px solid #374151' }}
        />
        <button onClick={runCheck} disabled={busy || !mac} style={{ padding: '6px 10px', borderRadius: 10, background: '#2563eb', color: '#fff' }}>Run Check</button>
        {last && (
          <span style={{ fontSize: 12, opacity: 0.9, paddingLeft: 6, color: last.ok ? '#10b981' : '#fca5a5' }}>
            {last.ok ? 'OK' : (last.failures != null ? `${last.failures} fail` : (last.msg || 'ERR'))}
          </span>
        )}
        <span style={{ fontSize: 11, opacity: 0.8, paddingLeft: 8 }}>
          {live.started ? (live.done ? (live.ok ? 'DONE OK' : 'DONE FAIL') : `RUNNING · EV ${live.evCount}`) : ''}
        </span>
      </div>
    </div>
  );
}
