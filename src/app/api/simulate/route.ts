// src/app/api/simulate/route.ts
import { NextResponse } from 'next/server';
import serial from '@/lib/serial';
import { broadcast } from '@/lib/bus';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type PostBody = {
  scenario?: string;
  failurePins?: number[] | string;
  resultDelayMs?: number;
  mac?: string;
  // optional actions
  scan?: { code: string; path?: string | null } | Array<{ code: string; path?: string | null }>;
  cue?: string | string[];  // e.g., 'UI:REMOVE_CABLE' (emits as line with MAC)
  ev?: Array<{ kind: 'P'|'L'; ch: number; val: 0|1; mac?: string }>;
  togglePin?: number;  // flip a pin from failure->pass or vice versa and emit EV
};

function ok(data: any, status = 200) { return NextResponse.json(data, { status }); }

export async function GET() {
  try {
    const cfg = (serial as any).getSimulateConfig?.();
    const enabled = !!cfg;
    return ok({ enabled, config: cfg || null });
  } catch (e: any) {
    return ok({ enabled: false, error: String(e?.message ?? e) }, 500);
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as PostBody;
    const setCfg = (serial as any).setSimulateConfig;
    const getCfg = (serial as any).getSimulateConfig;
    const cfg = getCfg?.();
    if (!cfg) return ok({ error: 'Simulation not enabled (set SIMULATE=1)' }, 400);

    const update: any = {};
    if (body.scenario) update.scenario = String(body.scenario).toLowerCase();
    if (body.resultDelayMs != null) update.resultDelayMs = Number(body.resultDelayMs) || 0;
    if (body.mac != null) update.macOverride = String(body.mac || '').toUpperCase() || null;
    if (body.failurePins != null) {
      const list = Array.isArray(body.failurePins)
        ? body.failurePins
        : String(body.failurePins).split(',').map(s => Number(String(s).trim()));
      update.failurePins = Array.from(new Set(list.filter(n => Number.isFinite(n) && n > 0)));
    }
    const next = setCfg?.(update) || cfg;

    // Optional: inject scanner scan(s)
    const scans = Array.isArray(body.scan) ? body.scan : (body.scan ? [body.scan] : []);
    for (const s of scans) {
      const code = String((s as any)?.code ?? '').trim();
      if (code) broadcast({ type: 'scan', code, path: (s as any)?.path ?? undefined });
    }

    // Optional: UI cue emission as a raw line
    if (body.cue) {
      const cues = Array.isArray(body.cue) ? body.cue : [body.cue];
      const mac = next?.macOverride || process.env.ESP_EXPECT_MAC || '08:3A:8D:15:27:54';
      for (const c of cues) {
        const upper = String(c || '').toUpperCase();
        // emit in both formats some listeners understand
        const line1 = `UI:${upper} ${mac}`;
        const line2 = `UI ${upper} ${mac}`;
        try { (serial as any).getEspLineStream?.().emit?.(line1); } catch {}
        try { (serial as any).getEspLineStream?.().emit?.(line2); } catch {}
      }
    }

    // Optional: immediate EV emissions
    if (Array.isArray(body.ev) && body.ev.length) {
      const mac = next?.macOverride || process.env.ESP_EXPECT_MAC || '08:3A:8D:15:27:54';
      for (const e of body.ev) {
        const kind = (e.kind === 'L') ? 'L' : 'P';
        const ch = Number(e.ch) || 0;
        const val = (Number(e.val) ? 1 : 0);
        const m = (e.mac || mac).toUpperCase();
        const line = `EV ${kind} ${ch} ${val} ${m}`;
        try { (serial as any).getEspLineStream?.().emit?.(line); } catch {}
      }
    }

    // Optional: toggle a failure pin state and emit
    if (body.togglePin && Number.isFinite(Number(body.togglePin))) {
      const ch = Number(body.togglePin);
      const mac = next?.macOverride || process.env.ESP_EXPECT_MAC || '08:3A:8D:15:27:54';
      // Flip membership in failurePins
      const fail = new Set<number>(Array.isArray(next?.failurePins) ? next!.failurePins : []);
      if (fail.has(ch)) fail.delete(ch); else fail.add(ch);
      const updated = setCfg?.({ failurePins: Array.from(fail).sort((a,b)=>a-b) }) || next;
      // Emit EV with new state (0=fail when in set)
      const val = fail.has(ch) ? 0 : 1;
      const line = `EV P ${ch} ${val} ${mac}`;
      try { (serial as any).getEspLineStream?.().emit?.(line); } catch {}
      return ok({ ok: true, config: updated, toggled: { ch, val } });
    }

    return ok({ ok: true, config: next });
  } catch (e: any) {
    return ok({ ok: false, error: String(e?.message ?? e) }, 500);
  }
}
