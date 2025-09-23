// src/app/api/serial/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { LOG } from '@/lib/logger';
import { getRedis } from '@/lib/redis';
import { ridFrom } from '@/lib/rid';

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const log = LOG.tag('api:serial');
const mon = LOG.tag('monitor');
/* ------------------------ schemas ------------------------ */
const Mac = z.string().regex(/^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/);

const PinsBody = z.object({
  normalPins: z.array(z.number().int().nonnegative()).optional(),
  latchPins:  z.array(z.number().int().nonnegative()).optional(),
  mac:        Mac,
  kssk:       z.string().optional(), // for logging
});

// alt payload: give me krosy "sequence" and I'll extract pins
const SequenceItem = z.object({
  objPos: z.string(),
  measType: z.string(),
  objGroup: z.string().optional(),
});

const SequenceBody = z.object({
  sequence: z.array(SequenceItem).min(1),
  mac: Mac,
  kssk: z.string().optional(),
});

/* ----------------- health snapshot (in-memory) ----------------- */
type Health = { ts: number; ok: boolean; raw?: string };
let health: Health | null = null;
let lastProbeTs = 0;
const PROBE_TTL_MS = 10_000;

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}
const now = () => Date.now();

/* ----------------- logging ----------------- */
const MONITOR_LOGS_ENABLED = ((process.env.LOG_VERBOSE ?? process.env.LOG_ENABLE ?? "1") === "1");
const MONITOR_START_ONLY = (process.env.LOG_MONITOR_START_ONLY ?? "0") === "1";

async function appendLog(entry: Record<string, unknown>) {
  const evt = String((entry as any)?.event || "");
  const mac = (entry as any)?.mac as string | undefined;
  const kssk = (entry as any)?.kssk as string | undefined;

  const severity: "info" | "warn" | "error" =
    evt === "monitor.error" ? "error" :
    evt === "monitor.nopins" ? "warn" :
    "info";

  if (!MONITOR_LOGS_ENABLED && severity !== "error") return;

  try {
    if (evt === "monitor.send") {
      const payload = (entry as any)?.sent ?? (entry as any)?.built;
      const normals: number[] = Array.isArray(payload?.normalPins) ? payload.normalPins : [];
      const latch: number[] = Array.isArray(payload?.latchPins) ? payload.latchPins : [];
      if (latch.length > 0) {
        mon.info(
          `MONITOR start mac=${mac ?? "-"} kssk=${kssk ?? "-"} normal(${normals.length})=[${normals.join(',')}] contactless(${latch.length})=[${latch.join(',')}]`,
          entry,
        );
      } else {
        mon.info(
          `MONITOR start mac=${mac ?? "-"} kssk=${kssk ?? "-"} normal(${normals.length})=[${normals.join(',')}]`,
          entry,
        );
      }
      return;
    }

    if (evt === "monitor.success") {
      if (MONITOR_START_ONLY) return;
      const counts = (entry as any)?.counts as { builtNormal?: number; builtLatch?: number } | undefined;
      const total = (counts?.builtNormal || 0) + (counts?.builtLatch || 0);
      mon.info(`MONITOR ok mac=${mac ?? "-"} kssk=${kssk ?? "-"} totalPins=${total}`, entry);
      return;
    }

    if (evt === "monitor.error") {
      const err = (entry as any)?.error as string | undefined;
      mon.error(`MONITOR error mac=${mac ?? "-"} kssk=${kssk ?? "-"} err=${err ?? "unknown"}`, entry);
      return;
    }

    if (evt === "monitor.nopins") {
      mon.warn(`MONITOR skipped mac=${mac ?? "-"} kssk=${kssk ?? "-"} reason=no-pins`, entry);
      return;
    }

    mon.info(`MONITOR event=${evt || "unknown"} mac=${mac ?? "-"} kssk=${kssk ?? "-"}`, entry);
  } catch (err) {
    log.error("monitor logging failure", err);
  }
}

function pinDiff(requested: number[] = [], built: number[] = []) {
  const r = new Set(requested);
  const b = new Set(built);
  const missing = [...r].filter(x => !b.has(x)); // asked but not sent
  const added   = [...b].filter(x => !r.has(x)); // sent but not asked
  return { missing, added };
}


/* ----------------- dynamic serial helper ----------------- */
async function loadSerial(): Promise<{
  sendAndReceive: (cmd: string, opts?: { timeoutMs?: number }) => Promise<string>;
  sendToEsp: (cmd: string, opts?: { timeoutMs?: number }) => Promise<void>;
}> {
  const mod = await import("@/lib/serial");
  const root = (mod as any).default ?? mod;
  const sendAndReceive = root.sendAndReceive;
  const sendToEsp = root.sendToEsp;
  if (typeof sendAndReceive !== "function") throw new Error("sendAndReceive missing");
  if (typeof sendToEsp !== "function") throw new Error("sendToEsp missing");
  return { sendAndReceive, sendToEsp };
}

/* ----------------- pin extraction ----------------- */
function parseObjPos(objPos: string): { pin: number | null; latch: boolean } {
  const parts = String(objPos || "").split(",").map(s => s.trim());
  // Policy: do NOT derive a pin when no comma is present
  if (parts.length < 2) return { pin: null, latch: false };
  let latch = false;
  if (parts.at(-1)?.toUpperCase() === "C") { latch = true; parts.pop(); }
  if (parts.length < 2) return { pin: null, latch };
  const last = parts.at(-1) ?? "";
  const num = Number(String(last).replace(/[^\d]/g, ""));
  return { pin: Number.isFinite(num) ? num : null, latch };
}

const OBJGROUP_MAC = /\(([0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5})\)/;

function extractPinsFromSequence(
  seq: Array<z.infer<typeof SequenceItem>>,
  mac?: string
) {
  const wantMac = mac?.toUpperCase();
  const normal: number[] = [];
  const latch: number[] = [];

  for (const s of seq) {
    const mt = String(s.measType || '').toLowerCase();
    if (mt !== 'default') continue;
    if (s.objGroup) {
      const m = s.objGroup.match(OBJGROUP_MAC);
      if (m && wantMac && m[1].toUpperCase() !== wantMac) continue;
    }
    const { pin, latch: isLatch } = parseObjPos(s.objPos);
    if (pin == null) continue;
    (isLatch ? latch : normal).push(pin);
  }
  const uniq = (xs: number[]) => Array.from(new Set(xs));
  return { normalPins: uniq(normal), latchPins: uniq(latch) };
}

/* ----------------- GET ----------------- */
export async function GET(req: Request) {
  try {
    const rid = ridFrom(req);
    const url = new URL(req.url);
    const probe = url.searchParams.get("probe") === "1";

    if (!probe) {
      if (health) {
        const resp = NextResponse.json({ ok: health.ok, raw: health.raw, ageMs: now() - health.ts }, { status: health.ok ? 200 : 503 });
        resp.headers.set('X-Req-Id', rid);
        return resp;
      }
      const resp = NextResponse.json({ ok: false, error: "No telemetry yet" }, { status: 503 });
      resp.headers.set('X-Req-Id', rid);
      return resp;
    }

    if (health && now() - lastProbeTs < PROBE_TTL_MS) {
      const resp = NextResponse.json({ ok: health.ok, raw: health.raw, ageMs: now() - health.ts }, { status: health.ok ? 200 : 503 });
      resp.headers.set('X-Req-Id', rid);
      return resp;
    }

    const { sendAndReceive } = await loadSerial();
    const raw = await sendAndReceive("STATUS");
    const ok = /OK|SUCCESS|READY/i.test(raw);

    health = { ts: now(), ok, raw };
    lastProbeTs = now();
    const resp = NextResponse.json({ ok, raw }, { status: ok ? 200 : 502 });
    resp.headers.set('X-Req-Id', rid);
    return resp;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("GET /api/serial error", err);
    const resp = NextResponse.json({ ok: false, error: msg }, { status: 500 });
    try { (resp.headers as any).set('X-Req-Id', ridFrom(req)); } catch {}
    return resp;
  }
}

// ----------------- POST -----------------
export async function POST(request: Request) {
  let body: unknown;
  const rid = ridFrom(request);
  try { body = await request.json(); } catch {
    const resp = NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    resp.headers.set('X-Req-Id', rid);
    return resp;
  }

  // capture raw requested pins (for logging)
  let src: "pins" | "sequence" = "pins";
  let mac: string;
  let normalPins: number[] = [];
  let latchPins: number[] = [];
  let kssk: string | undefined;
  let reqNormal: number[] | undefined;
  let reqLatch: number[] | undefined;

  const asPins = PinsBody.safeParse(body);
  if (asPins.success) {
    src = "pins";
    mac = asPins.data.mac.toUpperCase();
    reqNormal = asPins.data.normalPins ?? [];
    reqLatch  = asPins.data.latchPins  ?? [];
    normalPins = Array.from(new Set(reqNormal));
    latchPins  = Array.from(new Set(reqLatch));
    kssk = asPins.data.kssk;
  } else {
    src = "sequence";
    const asSeq = SequenceBody.safeParse(body);
    if (!asSeq.success) {
      return json({ error:"Expected { normalPins?: number[], latchPins?: number[], mac } OR { sequence: [...], mac }" }, 400);
    }
    mac = asSeq.data.mac.toUpperCase();
    const pins = extractPinsFromSequence(asSeq.data.sequence, mac);
    normalPins = pins.normalPins;
    latchPins  = pins.latchPins;
    // reqNormal/reqLatch undefined here (we didn't receive explicit pins)
    kssk = asSeq.data.kssk;
  }

  if (!normalPins.length && !latchPins.length) {
    await appendLog({ event: "monitor.nopins", mac, kssk, normalPins, latchPins });
    return json({ error: "No default pins for this MAC" }, 422);
  }

  // Filter out invalid/zero pins and sort
  normalPins = Array.from(new Set(normalPins.filter(n => Number.isFinite(n) && n > 0))).sort((a,b)=>a-b);
  latchPins  = Array.from(new Set(latchPins.filter(n => Number.isFinite(n) && n > 0))).sort((a,b)=>a-b);

  // Build commands: send NORMAL and LATCH pins as separate MONITOR commands
  const cmds: Array<{ cmd: string; kind: 'normal' | 'latch' }> = [];
  if (normalPins.length) cmds.push({ cmd: `MONITOR ${normalPins.join(',')} ${mac}`, kind: 'normal' });
  if (latchPins.length)  cmds.push({ cmd: `MONITOR LATCH ${latchPins.length} ${latchPins.join(',')} ${mac}`, kind: 'latch' });
  // Backward-compat: if neither branch added (shouldn't happen), fall back to combined
  const combinedFallback = (!cmds.length);
  const fallbackCmd = `MONITOR${normalPins.length?` ${normalPins.join(',')}`:''}${latchPins.length?` LATCH ${latchPins.length} ${latchPins.join(',')}`:''} ${mac}`;

  const diffs = {
    normal: pinDiff(reqNormal, normalPins),
    latch:  pinDiff(reqLatch,  latchPins),
  };
  const counts = {
    requestedNormal: reqNormal?.length ?? null,
    requestedLatch:  reqLatch?.length  ?? null,
    requestedTotal:  (reqNormal?.length ?? 0) + (reqLatch?.length ?? 0) || null,
    builtNormal: normalPins.length,
    builtLatch:  latchPins.length,
    builtTotal:  normalPins.length + latchPins.length,
  };
  const mismatch =
    (diffs.normal.missing.length + diffs.normal.added.length +
    diffs.latch.missing.length  + diffs.latch.added.length) > 0;

  const cmdLabel = combinedFallback ? fallbackCmd : (cmds.length ? cmds.map(c=>c.cmd).join(' && ') : fallbackCmd);
  const entry: any = {
    event: "monitor.send",
    mac, kssk, cmd: cmdLabel, rid,
    sent: { normalPins, latchPins },
    counts
  };
  if (mismatch) {
    entry.requested = { normalPins: reqNormal ?? null, latchPins: reqLatch ?? null };
    entry.diffs = diffs;
  }
  await appendLog(entry);
  // Opportunistically update per-KSK pins in Redis so tools (locks:watch) show live pins
  try {
    if (kssk) {
      const r: any = getRedis();
      const macUp = String(mac).toUpperCase();
      const keyK = `kfb:aliases:${macUp}:${String(kssk)}`;
      const keyU = `kfb:aliases:${macUp}`;
      let names: Record<string,string> = {};
      try {
        const rawK = await r.get(keyK).catch(() => null);
        if (rawK) {
          const d = JSON.parse(rawK);
          if (d?.names && typeof d.names === 'object') names = d.names as Record<string,string>;
        }
      } catch {}
      if (!names || Object.keys(names).length === 0) {
        try {
          const rawU = await r.get(keyU).catch(() => null);
          if (rawU) {
            const dU = JSON.parse(rawU);
            const nU = (dU?.names && typeof dU.names === 'object') ? (dU.names as Record<string,string>) : {};
            // only take names for pins we are sending
            const need = new Set<number>([...normalPins, ...latchPins]);
            const picked: Record<string,string> = {};
            for (const [pin, label] of Object.entries(nU)) {
              const p = Number(pin);
              if (Number.isFinite(p) && need.has(p)) picked[pin] = String(label);
            }
            names = picked;
          }
        } catch {}
      }
      const tsNow = Date.now();
      const value = JSON.stringify({ names: names || {}, normalPins, latchPins, ts: tsNow });
      try { await r.set(keyK, value); } catch {}
      try { await r.sadd(`kfb:aliases:index:${macUp}`, String(kssk)); } catch {}
      // Also record "last pins used" snapshot for this KSK to support watcher fallbacks
      try { await r.set(`kfb:lastpins:${macUp}:${String(kssk)}`, JSON.stringify({ normalPins, latchPins, ts: tsNow })); } catch {}
    }
  } catch {}
  await appendLog({
    event: "monitor.send",
    source: src,
    mac, kssk, cmd: cmdLabel,
    requested: { normalPins: reqNormal ?? null, latchPins: reqLatch ?? null },
    built: { normalPins, latchPins },
    counts,
    diffs,
  });

  // send
  let sendToEsp: (cmd: string, opts?: { timeoutMs?: number }) => Promise<void>;
  try { ({ sendToEsp } = await loadSerial()); }
  catch (err) {
    await appendLog({ event: "monitor.error", mac, kssk, cmd: cmdLabel, error: "loadSerial failed" });
    log.error("load serial helper error", err);
    const resp = NextResponse.json({ error: "Internal error" }, { status: 500 });
    resp.headers.set('X-Req-Id', rid);
    return resp;
  }

  try {
    const executed: string[] = [];
    if (combinedFallback) {
      await sendToEsp(fallbackCmd, { timeoutMs: 3000 });
      executed.push(fallbackCmd);
      await appendLog({ event: "monitor.success", mac, kssk, cmd: fallbackCmd, counts });
    } else {
      for (const c of cmds) {
        await sendToEsp(c.cmd, { timeoutMs: 3000 });
        executed.push(c.cmd);
        await appendLog({ event: "monitor.success", mac, kssk, cmd: c.cmd, counts });
      }
    }
    health = { ts: now(), ok: true, raw: "WRITE_OK" };
    const resp = NextResponse.json({ success: true, cmds: executed, normalPins, latchPins, mac });
    resp.headers.set('X-Req-Id', rid);
    return resp;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown";
    const stationId = (process.env.STATION_ID || process.env.NEXT_PUBLIC_STATION_ID || '').trim() || undefined;
    const tty = (process.env.ESP_TTY || process.env.ESP_TTY_PATH || '').trim() || undefined;
    const isPerm = /EACCES|Permission denied/i.test(message);
    const code = isPerm ? 'esp_permission_denied' : 'esp_error';
    log.error("POST /api/serial error", err);
    health = { ts: now(), ok: false, raw: `WRITE_ERR:${message}` };
    const tried = combinedFallback ? fallbackCmd : (cmds.length ? cmds[0].cmd : fallbackCmd);
    await appendLog({ event: "monitor.error", mac, kssk, cmd: tried, counts, diffs, error: message });
    const resp = NextResponse.json({ error: message, cmdTried: tried, code, stationId, tty }, { status: 500 });
    resp.headers.set('X-Req-Id', rid);
    return resp;
  }
}
