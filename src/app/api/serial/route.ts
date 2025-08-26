// src/app/api/serial/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import fs from "fs/promises";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
const LOG_DIR = path.join(process.cwd(), "monitor.logs");
async function ensureLogDir() {
  try { await fs.mkdir(LOG_DIR, { recursive: true }); } catch {}
}
function logFilePath() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return path.join(LOG_DIR, `monitor-${yyyy}-${mm}-${dd}.log`);
}
async function appendLog(entry: Record<string, unknown>) {
  try {
    await ensureLogDir();
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n";
    await fs.appendFile(logFilePath(), line, "utf8");
  } catch (err) {
    console.error("[monitor.log] append failed:", err);
  }
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
  const parts = objPos.split(",");
  let latch = false;
  if (parts.length && parts[parts.length - 1].trim().toUpperCase() === "C") {
    latch = true;
    parts.pop();
  }
  const last = parts[parts.length - 1] ?? "";
  const num = Number(last.replace(/[^\d]/g, ""));
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
    if (s.measType !== "default") continue;
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
    const url = new URL(req.url);
    const probe = url.searchParams.get("probe") === "1";

    if (!probe) {
      if (health) return json({ ok: health.ok, raw: health.raw, ageMs: now() - health.ts }, health.ok ? 200 : 503);
      return json({ ok: false, error: "No telemetry yet" }, 503);
    }

    if (health && now() - lastProbeTs < PROBE_TTL_MS) {
      return json({ ok: health.ok, raw: health.raw, ageMs: now() - health.ts }, health.ok ? 200 : 503);
    }

    const { sendAndReceive } = await loadSerial();
    const raw = await sendAndReceive("STATUS");
    const ok = /OK|SUCCESS|READY/i.test(raw);

    health = { ts: now(), ok, raw };
    lastProbeTs = now();
    return json({ ok, raw }, ok ? 200 : 502);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/serial] error:", err);
    return json({ ok: false, error: msg }, 500);
  }
}

/* ----------------- POST ----------------- */
export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  // Accept either pins or a raw sequence
  let mac: string;
  let normalPins: number[] = [];
  let latchPins: number[] = [];
  let kssk: string | undefined;

  const asPins = PinsBody.safeParse(body);
  if (asPins.success) {
    mac = asPins.data.mac.toUpperCase();
    normalPins = Array.from(new Set(asPins.data.normalPins ?? []));
    latchPins = Array.from(new Set(asPins.data.latchPins ?? []));
    kssk = asPins.data.kssk;
  } else {
    const asSeq = SequenceBody.safeParse(body);
    if (!asSeq.success) {
      return json({
        error:
          "Expected { normalPins?: number[], latchPins?: number[], mac } OR { sequence: [...], mac }",
      }, 400);
    }
    mac = asSeq.data.mac.toUpperCase();
    const pins = extractPinsFromSequence(asSeq.data.sequence, mac);
    normalPins = pins.normalPins;
    latchPins  = pins.latchPins;
    kssk = asSeq.data.kssk;
  }

  // Fail fast if no pins
  if (!normalPins.length && !latchPins.length) {
    await appendLog({ event: "monitor.nopins", mac, kssk, normalPins, latchPins });
    return json({ error: "No default pins for this MAC" }, 422);
  }

  // Sort for stable commands (optional)
  normalPins.sort((a,b)=>a-b);
  latchPins.sort((a,b)=>a-b);

  // Build MONITOR command
  let cmd = "MONITOR";
  if (normalPins.length) cmd += " " + normalPins.join(",");
  if (latchPins.length) cmd += " LATCH " + latchPins.join(",");
  cmd += " " + mac;

  await appendLog({ event: "monitor.prepare", mac, kssk, cmd, normalPins, latchPins });

  let sendToEsp: (cmd: string, opts?: { timeoutMs?: number }) => Promise<void>;
  try {
    ({ sendToEsp } = await loadSerial());
  } catch (err) {
    await appendLog({ event: "monitor.error", mac, kssk, cmd, error: "loadSerial failed" });
    console.error("load serial helper error:", err);
    return json({ error: "Internal error" }, 500);
  }

  try {
    await sendToEsp(cmd, { timeoutMs: 3000 });
    health = { ts: now(), ok: true, raw: "WRITE_OK" };
    await appendLog({ event: "monitor.success", mac, kssk, cmd });
    return json({ success: true, cmd, normalPins, latchPins, mac });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown";
    console.error("POST /api/serial error:", err);
    health = { ts: now(), ok: false, raw: `WRITE_ERR:${message}` };
    await appendLog({ event: "monitor.error", mac, kssk, cmd, error: message });
    return json({ error: message, cmdTried: cmd }, 500);
  }
}
