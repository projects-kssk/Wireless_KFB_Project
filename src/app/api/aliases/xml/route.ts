// src/app/api/aliases/xml/route.ts
import { NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { LOG } from "@/lib/logger";
import fs from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = LOG.tag("aliases:xml");
const MAC_RE = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i;
const KSK_RE = /^\d{12}$/;
const REQUIRE_REDIS =
  ((process.env.KSK_REQUIRE_REDIS ?? process.env.KSSK_REQUIRE_REDIS) ?? "0") === "1";

function keyForKssk(mac: string, kssk: string) {
  return `kfb:aliases:${mac.toUpperCase()}:${kssk}`;
}
function keyForXml(mac: string, kssk: string) {
  return `kfb:aliases:xml:${mac.toUpperCase()}:${kssk}`;
}

// Dedicated read log (separate from app log stream) → write under /logs
const READ_LOG_DIR = process.env.LOG_DIR || path.join(process.cwd(), "logs");
const READ_LOGS_ENABLED = (process.env.LOG_VERBOSE ?? '0') === '1';
function ymdParts(d = new Date()) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return { y, m, day };
}
async function appendReadLog(mac: string, ksk: string, hit: boolean, bytes: number, note?: string) {
  if (!READ_LOGS_ENABLED) return; // verbose read logging disabled
  try {
    const { y, m, day } = ymdParts();
    const f = path.join(READ_LOG_DIR, `aliases-xml-reads-${y}-${m}-${day}.log`);
    await fs.mkdir(READ_LOG_DIR, { recursive: true });
    const ts = new Date().toISOString();
    const line = JSON.stringify({ ts, mac, ksk, hit, bytes, note: note || null });
    await fs.appendFile(f, line + "\n", "utf8");
  } catch {}
}

async function connectIfNeeded(r: any, timeoutMs = 400): Promise<boolean> {
  if (!r) return false;
  const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));
  try {
    if (typeof r.isOpen === "boolean") {
      if (!r.isOpen) {
        try {
          const p = r.connect();
          await Promise.race([p, sleep(timeoutMs)]);
        } catch {}
      }
      return r.isOpen === true;
    }
    if (typeof r.status === "string") {
      if (r.status === "ready") return true;
      if (["connecting", "connect", "reconnecting"].includes(r.status)) {
        await Promise.race([
          new Promise<void>(resolve => {
            const done = () => { r.off?.("ready", done); r.off?.("error", done); r.off?.("end", done); resolve(); };
            r.once?.("ready", done);
            r.once?.("error", done);
            r.once?.("end", done);
          }),
          sleep(timeoutMs),
        ]);
        return r.status === "ready";
      }
      try { await r.connect?.().catch(() => {}); } catch {}
      await Promise.race([
        new Promise<void>(resolve => {
          const done = () => { r.off?.("ready", done); r.off?.("error", done); resolve(); };
          r.once?.("ready", done);
          r.once?.("error", done);
        }),
        sleep(timeoutMs),
      ]);
      return r.status === "ready";
    }
  } catch {}
  return false;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mac = String(url.searchParams.get("mac") || "").toUpperCase();
  const kssk = String(url.searchParams.get("kssk") || url.searchParams.get("ksk") || "");

  if (!MAC_RE.test(mac) || !KSK_RE.test(kssk)) {
    return NextResponse.json({ error: "invalid-params" }, { status: 400 });
  }

  const r: any = getRedis();
  const haveRedis = r && await connectIfNeeded(r);
  if (!haveRedis) {
    try { await appendReadLog(mac, kssk, false, 0, "redis_unavailable"); } catch {}
    const resp = NextResponse.json({ error: "redis_unavailable" }, { status: 503 });
    resp.headers.set("X-KSK-Mode", "redis");
    return resp;
  }

  const base = keyForKssk(mac, kssk);
  let xml: string | null = null;

  // 1) dedicated XML key (current writer)
  if (!xml) { try { xml = await r.get?.(keyForXml(mac, kssk)); } catch {} }

  // 2) hash field (legacy)
  if (!xml) { try { xml = await r.hget?.(base, "xml"); } catch {} }

  // 3) separate key suffix (legacy)
  if (!xml) { try { xml = await r.get?.(`${base}:xml`); } catch {} }

  // 4) whole-key JSON with embedded xml (defensive)
  if (!xml) {
    try {
      const raw = await r.get?.(base);
      if (raw) {
        try {
          const j = JSON.parse(raw);
          xml = j?.xml || j?.responseXmlRaw || j?.responseXmlPreview || null;
        } catch {}
      }
    } catch {}
  }

  if (!xml) {
    log.info("xml not found", { mac, kssk });
    try { await appendReadLog(mac, kssk, false, 0, "not_found"); } catch {}
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  try { await appendReadLog(mac, kssk, true, Buffer.byteLength(xml, "utf8")); } catch {}
  return new NextResponse(xml, {
    status: 200,
    headers: { "content-type": "text/xml; charset=utf-8", "X-KSK-Mode": "redis" },
  });
}
