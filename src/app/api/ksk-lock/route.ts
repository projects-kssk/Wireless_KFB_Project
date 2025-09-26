// src/app/api/ksk-lock/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";

import { LOG } from "@/lib/logger";
const log = LOG.tag("ksk-lock");
/** Next runtime */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ======================= Scoped logger ======================= */
import crypto from "node:crypto";

// below imports, before using rid()
function rid(): string {
  const id = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
  return id.replace(/-/g, "").slice(0, 8);
}

/* ======================= Types / keys ======================== */
type LockVal = { kssk: string; mac: string; stationId: string; ts: number };
type LockRow = LockVal & { expiresAt?: number };
const K = (kssk: string) => `ksk:${kssk}`;
const S = (stationId: string) => `ksk:station:${stationId}`;
const REQUIRE_REDIS = ((process.env.KSK_REQUIRE_REDIS ?? process.env.KSSK_REQUIRE_REDIS) ?? '0') === '1';

const normalizeMac = (value?: string | null): string | null => {
  const hex = String(value ?? '').replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
  if (hex.length !== 12) return null;
  const parts = hex.match(/.{1,2}/g);
  return parts ? parts.join(':') : null;
};

const canonicalizeLock = (lock: LockVal | null): LockVal | null => {
  if (!lock) return null;
  const normalized = normalizeMac(lock.mac);
  return {
    ...lock,
    mac: normalized ?? (typeof lock.mac === 'string' ? lock.mac.toUpperCase() : ''),
  };
};

const macEquals = (candidate: string | null | undefined, targetNorm: string | null): boolean => {
  if (!targetNorm) return false;
  const normCandidate = normalizeMac(candidate);
  return normCandidate === targetNorm;
};
/* ================= In-memory fallback store ================== */
const memLocks = new Map<string, { v: LockVal; exp: number }>(); // key: K(kssk)
const memStations = new Map<string, Set<string>>();              // key: S(stationId) -> Set<kssk>
const nowMs = () => Date.now();

function memGet(key: string): LockVal | null {
  const x = memLocks.get(key);
  if (!x) return null;
  if (nowMs() > x.exp) {
    memLocks.delete(key);
    const kssk = key.slice("ksk:".length);
    for (const set of memStations.values()) set.delete(kssk);
    return null;
  }
  return canonicalizeLock(x.v);
}
function memSetNX(key: string, v: LockVal, ttlMs: number) {
  if (memGet(key)) return false;
  const canonical = canonicalizeLock(v);
  if (!canonical) return false;
  memLocks.set(key, { v: canonical, exp: nowMs() + ttlMs });
  const skey = S(v.stationId);
  if (!memStations.has(skey)) memStations.set(skey, new Set());
  memStations.get(skey)!.add(canonical.kssk);
  return true;
}
function memTouchIfOwner(key: string, stationId: string, ttlMs: number) {
  const cur = memGet(key);
  if (!cur || cur.stationId !== stationId) return false;
  memLocks.set(key, { v: cur, exp: nowMs() + ttlMs });
  return true;
}
function memList(stationId?: string): LockRow[] {
  const out: LockRow[] = [];
  const n = nowMs();
  if (stationId) {
    const ids = memStations.get(S(stationId)) ?? new Set<string>();
    for (const kssk of ids) {
      const k = K(kssk);
      const x = memLocks.get(k);
      if (!x) continue;
      if (x.exp <= n) { memLocks.delete(k); ids.delete(kssk); continue; }
      const lock = canonicalizeLock(x.v);
      if (!lock) continue;
      out.push({ ...lock, expiresAt: x.exp });
    }
    return out;
  }
  for (const [k, { v, exp }] of memLocks.entries()) {
    if (exp <= n) { memLocks.delete(k); continue; }
    const lock = canonicalizeLock(v);
    if (!lock) continue;
    out.push({ ...lock, expiresAt: exp });
  }
  return out;
}

/* ===================== Redis helpers ========================= */
const asJSON = (x: unknown) => (typeof x === "string" ? JSON.parse(x) : x);

/** Try to be ready within a short timeout; don’t hang the route. */
async function connectIfNeeded(r: any, timeoutMs = 400): Promise<boolean> {
  if (!r) return false;
  const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

  try {
    // node-redis v4
    if (typeof r.isOpen === "boolean") {
      if (!r.isOpen) {
        try {
          const p = r.connect();
          await Promise.race([p, sleep(timeoutMs)]);
        } catch {}
      }
      return r.isOpen === true;
    }

    // ioredis
    if (typeof r.status === "string") {
      const s = r.status;

      if (s === "ready") return true;

      // already in-flight? just wait; don't call connect() again
      if (s === "connecting" || s === "connect" || s === "reconnecting") {
        await Promise.race([
          new Promise<void>((resolve) => {
            const done = () => { r.off?.("ready", done); r.off?.("error", done); r.off?.("end", done); resolve(); };
            r.once?.("ready", done); r.once?.("error", done); r.once?.("end", done);
          }),
          sleep(timeoutMs),
        ]);
        return r.status === "ready";
      }

      // states like "wait"/"end"/"close" → try to connect (and ALWAYS await/catch)
      try { await r.connect?.().catch(() => {}); } catch {}
      await Promise.race([
        new Promise<void>((resolve) => {
          const done = () => { r.off?.("ready", done); r.off?.("error", done); resolve(); };
          r.once?.("ready", done); r.once?.("error", done);
        }),
        sleep(timeoutMs),
      ]);
      return r.status === "ready";
    }
  } catch {}
  return false;
}

async function rGet(key: string): Promise<LockVal | null> {
  const r: any = getRedis();
  if (!r || !(await connectIfNeeded(r))) return null;
  try {
    const raw = await r.get(key);
    return canonicalizeLock(raw ? (asJSON(raw) as LockVal) : null);
  } catch {
    return null;
  }
}
async function rSetNXPX(key: string, val: LockVal, ttlMs: number): Promise<boolean> {
  const r: any = getRedis();
  if (!r || !(await connectIfNeeded(r))) return false;
  try {
    const ok =
      (await r.set?.(key, JSON.stringify(val), "PX", ttlMs, "NX")) ??
      (await r.set?.(key, JSON.stringify(val), { PX: ttlMs, NX: true }));
    return !!ok;
  } catch { return false; }
}
async function rExpirePX(key: string, ttlMs: number): Promise<boolean> {
  const r: any = getRedis();
  if (!r || !(await connectIfNeeded(r))) return false;
  try { const n = await r.pexpire(key, ttlMs); return !!n; } catch { return false; }
}
async function rDel(key: string): Promise<void> {
  const r: any = getRedis();
  if (!r || !(await connectIfNeeded(r))) return;
  try { await r.del(key); } catch {}
}
async function rSAdd(skey: string, member: string) {
  const r: any = getRedis();
  if (!r || !(await connectIfNeeded(r))) return;
  try { await r.sadd(skey, member); } catch {}
}
async function rSRem(skey: string, member: string) {
  const r: any = getRedis();
  if (!r || !(await connectIfNeeded(r))) return;
  try { await r.srem(skey, member); } catch {}
}
async function rSMembers(skey: string): Promise<string[]> {
  const r: any = getRedis();
  if (!r || !(await connectIfNeeded(r))) return [];
  try { const res = await r.smembers(skey); return Array.isArray(res) ? res : []; } catch { return []; }
}
async function rPTTL(key: string): Promise<number | null> {
  const r: any = getRedis();
  if (!r || !(await connectIfNeeded(r))) return null;
  try { const v = await r.pttl(key); return typeof v === "number" ? v : null; } catch { return null; }
}

/** Station-scoped list (cleans stale index; includes expiresAt) */
async function redisList(stationId?: string): Promise<LockRow[]> {
  const r: any = getRedis();
  if (!r || !(await connectIfNeeded(r))) return [];
  const now = nowMs();
  const rows: LockRow[] = [];

  const collect = async (ksskList: string[]) => {
    await Promise.all(ksskList.map(async (kssk) => {
      const key = K(kssk);
      const val = await rGet(key);
      if (!val) { if (stationId) await rSRem(S(stationId), kssk); return; }
      const ttl = await rPTTL(key);
      rows.push({ ...val, expiresAt: ttl && ttl > 0 ? now + ttl : undefined });
    }));
  };

  if (stationId) {
    const members = await rSMembers(S(stationId));
    await collect(members);
    return rows;
  }

  // Global: scan keys
  const keys: string[] = [];
  if (typeof r.scan === "function") {
    let cursor = "0";
    do {
      const res = await r.scan(cursor, "MATCH", "ksk:*", "COUNT", 300);
      cursor = res[0]; keys.push(...(res[1] as string[]));
    } while (cursor !== "0");
  } else {
    keys.push(...(await r.keys("ksk:*")));
  }

  await Promise.all(keys.map(async (key) => {
    const val = await rGet(key);
    if (!val) return;
    const ttl = await rPTTL(key);
    rows.push({ ...val, expiresAt: ttl && ttl > 0 ? now + ttl : undefined });
  }));
  return rows;
}

/* ====================== Small respond helper ====================== */
function withMode(resp: NextResponse, mode: "redis"|"mem"|"mem-fallback", id?: string) {
  resp.headers.set("X-KSK-Mode", mode);
  if (id) resp.headers.set("X-Req-Id", id);
  return resp;
}

/* ============================ POST =============================== */
export async function POST(req: NextRequest) {
  const id = rid(); const t0 = Date.now();

  try {
    const DEFAULT_TTL_SEC = Math.max(5, Number((process.env.KSK_DEFAULT_TTL_SEC ?? process.env.KSSK_DEFAULT_TTL_SEC) ?? '900'));
    const body = await req.json();
    const macRaw = typeof body?.mac === 'string' ? body.mac : null;
    const macCanonical = normalizeMac(macRaw);
    const stationId = body?.stationId;
    const ttlSec = body?.ttlSec ?? DEFAULT_TTL_SEC;
    const ksk = (body?.ksk ?? body?.kssk);
    const macForLog = macCanonical ?? (macRaw ? String(macRaw).toUpperCase() : '');
    log.info('POST begin', { rid: id, action: 'create', ksk, mac: macForLog, stationId, ttlSec: Number(ttlSec) });

    if (!ksk || !stationId)
      return NextResponse.json({ error: "ksk & stationId required" }, { status: 400 });

    const key = K(String(ksk));
    const ttlMs = Math.max(5, Number(ttlSec)) * 1000;
    const baseVal: LockVal & { ksk?: string } = {
      kssk: String(ksk),
      ksk: String(ksk),
      mac: macCanonical ?? (macRaw ? String(macRaw).toUpperCase() : ''),
      stationId: String(stationId),
      ts: nowMs(),
    };
    const val = canonicalizeLock(baseVal)!;

    const r = getRedis();
    const haveRedis = r && (await connectIfNeeded(r));
    if (REQUIRE_REDIS && !haveRedis) {
      log.info('POST redis_unavailable (require_redis)', { rid: id, ksk, durationMs: Date.now()-t0 });
      return withMode(NextResponse.json({ error: 'redis_unavailable' }, { status: 503 }), 'redis');
    }

    if (haveRedis) {
      const ok = await rSetNXPX(key, val, ttlMs);
      if (!ok) {
        const existing = await rGet(key);
        if (!existing) {
          // Redis reachable but failed to set for an unknown reason → degrade to mem once
          const memOk = memSetNX(key, val, ttlMs);
          log.info('POST mem-fallback', { rid: id, ksk, stationId: val.stationId, memSet: memOk, durationMs: Date.now()-t0 });
          return withMode(
            memOk
              ? NextResponse.json({ ok: true, mode: "mem-fallback" })
              : NextResponse.json({ error: "locked", existing: memGet(key) }, { status: 409 }),
            "mem-fallback"
          );
        }
        log.info('POST locked', { rid: id, ksk, stationId: existing.stationId, durationMs: Date.now()-t0 });
        return withMode(NextResponse.json({ error: "locked", existing }, { status: 409 }), "redis");
      }
      await rSAdd(S(val.stationId), val.kssk);
      log.info('POST ok', { rid: id, ksk, stationId: val.stationId, mode: 'redis', durationMs: Date.now()-t0 });
      return withMode(NextResponse.json({ ok: true }), "redis", id);
    }

    const memOk = memSetNX(key, val, ttlMs);
    log.info('POST ok', { rid: id, ksk, stationId: val.stationId, mode: 'mem', memSet: memOk, durationMs: Date.now()-t0 });
    return withMode(
      memOk
        ? NextResponse.json({ ok: true, mode: "mem" })
        : NextResponse.json({ error: "locked", existing: memGet(key) }, { status: 409 }),
      "mem"
    );
  } catch (e: unknown) {
    log.info('POST error', { rid: id, error: (e as any)?.message ?? String(e), durationMs: Date.now()-t0 });
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}

/* ============================== GET ============================== */
export async function GET(req: NextRequest) {
  const id = rid(); const t0 = Date.now();
  try {
    const { searchParams } = new URL(req.url);
    const kssk = searchParams.get("ksk") || searchParams.get("kssk");
    const stationId = searchParams.get("stationId") || undefined;
    const include = String(searchParams.get('include') || '').trim().toLowerCase();
    const includeAliases = include === '1' || include === 'true' || include === 'aliases' || include === 'pins' || include === 'all';

    const r = getRedis();
    const haveRedis = r && (await connectIfNeeded(r));
    if (REQUIRE_REDIS && !haveRedis) {
      log.info('GET redis_unavailable (require_redis)', { rid: id, durationMs: Date.now()-t0 });
      return withMode(NextResponse.json({ error: 'redis_unavailable' }, { status: 503 }), 'redis');
    }
    const mode: "redis" | "mem" = haveRedis ? "redis" : "mem";

    if (kssk) {
      const key = K(kssk);
      if (haveRedis) {
        const existing = await rGet(key);
        const ttl = existing ? await rPTTL(key) : null;
        const expiresAt = existing && ttl && ttl > 0 ? nowMs() + ttl : undefined;
        log.info('GET one', { rid: id, ksk: kssk, mode, locked: !!existing, durationMs: Date.now()-t0 });
        return withMode(NextResponse.json({ locked: !!existing, existing: existing ? { ...existing, ksk: existing.kssk, expiresAt } : null }), mode);
      }
      const v = memGet(key);
      const exp = (memLocks.get(key) as any)?.exp as number | undefined;
      log.info('GET one', { rid: id, ksk: kssk, mode, locked: !!v, durationMs: Date.now()-t0 });
      return withMode(NextResponse.json({ locked: !!v, existing: v ? { ...v, ksk: v.kssk, expiresAt: exp } : null }), mode);
    }

    const rows: LockRow[] = haveRedis ? await redisList(stationId) : memList(stationId);
    // Optionally enrich rows with aliases + pin maps (Redis only)
    if (includeAliases && haveRedis && rows.length) {
      try {
        const r: any = getRedis();
        // Minimal XML extractor to recover pins/names when arrays are missing
        const parsePos = (pos: string) => {
          try {
            const parts = String(pos || '').split(',').map(s => s.trim());
            // Policy: do not derive pins if no comma present
            if (parts.length < 2) return { pin: NaN, label: parts[0] || '', isLatch: false, labelPrefix: (parts[0] || '').split('_')[0] || '' };
            let isLatch = false;
            if (parts.at(-1)?.toUpperCase() === 'C') { isLatch = true; parts.pop(); }
            if (parts.length < 2) return { pin: NaN, label: parts[0] || '', isLatch, labelPrefix: (parts[0] || '').split('_')[0] || '' };
            const label = String(parts[0] || '').trim();
            const labelPrefix = label.split('_')[0] || '';
            const last = parts.at(-1) || '';
            const pinNum = Number(String(last).replace(/\D+/g, ''));
            return { pin: Number.isFinite(pinNum) ? pinNum : NaN, label, isLatch, labelPrefix };
          } catch { return { pin: NaN, label: '', isLatch: false, labelPrefix: '' }; }
        };
        const extractFromXml = (xml: string) => {
          const names: Record<string,string> = {};
          const normal: number[] = [];
          const latch: number[] = [];
          try {
            const re = /<sequence\b([^>]*)>([\s\S]*?)<\/sequence>/gi;
            let m: RegExpExecArray | null;
            while ((m = re.exec(xml))) {
              const attrs = m[1] || '';
              const body = m[2] || '';
              const mt = (attrs.match(/\bmeasType="([^"]*)"/i)?.[1] || '').toLowerCase();
              if (mt !== 'default') continue; // strict: only default
              const pos = body.match(/<objPos>([^<]+)<\/objPos>/i)?.[1] || '';
              if (!pos) continue;
              const { pin, label, isLatch } = parsePos(pos);
              if (!Number.isFinite(pin)) continue;
              if (label) names[String(pin)] = label;
              (isLatch ? latch : normal).push(pin);
            }
          } catch {}
          const uniq = (xs: number[]) => Array.from(new Set(xs));
          return { names, normalPins: uniq(normal), latchPins: uniq(latch) };
        };
        await Promise.all(rows.map(async (row: any) => {
          try {
            const macUp = String(row.mac || '').toUpperCase();
            if (!macUp) return;
            // 1) Try per-KSK alias bundle
            let names: Record<string,string> | undefined;
            let nPins: number[] | undefined;
            let lPins: number[] | undefined;
            let ts: number | null | undefined;
            try {
              const raw = await r.get(`kfb:aliases:${macUp}:${row.kssk}`).catch(() => null);
              if (raw) {
                const d = JSON.parse(raw);
                names = (d?.names && typeof d.names === 'object') ? d.names as Record<string,string> : (d?.aliases || undefined);
                nPins = Array.isArray(d?.normalPins) ? d.normalPins as number[] : undefined;
                lPins = Array.isArray(d?.latchPins) ? d.latchPins as number[] : undefined;
                ts = d?.ts || null;
              }
            } catch {}
            // 2) If pins missing, fallback to lastpins snapshot
            try {
              const emptyN = !Array.isArray(nPins) || nPins.length === 0;
              const emptyL = !Array.isArray(lPins) || lPins.length === 0;
              if (emptyN && emptyL) {
                const rawLP = await r.get(`kfb:lastpins:${macUp}:${row.kssk}`).catch(() => null);
                if (rawLP) {
                  const d2 = JSON.parse(rawLP);
                  if (emptyN) nPins = Array.isArray(d2?.normalPins) ? d2.normalPins as number[] : undefined;
                  if (emptyL) lPins = Array.isArray(d2?.latchPins) ? d2.latchPins as number[] : undefined;
                  ts ??= d2?.ts || null;
                }
              }
            } catch {}
            // 3) If still missing, try XML snapshot and extract strictly default measType
            try {
              const emptyN = !Array.isArray(nPins) || nPins.length === 0;
              const emptyL = !Array.isArray(lPins) || lPins.length === 0;
              if (emptyN && emptyL) {
                const xml = await r.get(`kfb:aliases:xml:${macUp}:${row.kssk}`).catch(() => null);
                if (xml) {
                  const ex = extractFromXml(xml);
                  if (ex.normalPins.length || ex.latchPins.length) {
                    nPins = ex.normalPins;
                    lPins = ex.latchPins;
                    if (!names || Object.keys(names).length === 0) names = ex.names;
                  }
                }
              }
            } catch {}
            // 4) If names missing but we have pins, select names from MAC union
            try {
              const havePins = (Array.isArray(nPins) && nPins.length) || (Array.isArray(lPins) && lPins.length);
              const noNames = !names || Object.keys(names).length === 0;
              if (havePins && noNames) {
                const rawU = await r.get(`kfb:aliases:${macUp}`).catch(() => null);
                if (rawU) {
                  const dU = JSON.parse(rawU);
                  const namesU: Record<string,string> = (dU?.names && typeof dU.names === 'object') ? dU.names : {};
                  const want = new Set<number>([...(nPins || []), ...(lPins || [])].filter((x: number) => Number.isFinite(x)) as number[]);
                  const picked: Record<string,string> = {};
                  for (const [p, label] of Object.entries(namesU)) {
                    const pn = Number(p);
                    if (Number.isFinite(pn) && want.has(pn)) picked[p] = String(label);
                  }
                  names = picked;
                }
              }
            } catch {}

            if (names && typeof names === 'object') row.aliases = names;
            if (Array.isArray(nPins)) row.normalPins = nPins;
            if (Array.isArray(lPins)) row.latchPins = lPins;
            if (typeof ts === 'number' || ts === null) row.ts = ts;
          } catch {}
        }));
      } catch {}
    }
    const info = { rid: id, stationId: stationId ?? null, mode, count: rows.length, durationMs: Date.now()-t0 };
    if (rows.length > 0) {
      log.info('GET list', info);
    } else {
      const quiet = ((process.env.KSK_LOCK_SILENCE_EMPTY ?? process.env.KSSK_LOCK_SILENCE_EMPTY) ?? '1') === '1';
      if (!quiet) log.debug('GET list (empty)', info);
    }

    // Optional verbose detail logging for terminal visibility
    if (((process.env.KSK_LOCK_LOG_DETAIL ?? process.env.KSSK_LOCK_LOG_DETAIL) ?? '0') === '1') {
      const g: any = globalThis as any;
      if (!g.__kssk_list_detail_last) g.__kssk_list_detail_last = 0;
      const tsNow = Date.now();
      if (tsNow - g.__kssk_list_detail_last < 2000) {
        return withMode(NextResponse.json({ locks: rows }), mode);
      }
      g.__kssk_list_detail_last = tsNow;
      const now = Date.now();
      const brief = rows.slice(0, 12).map(r => ({
        kssk: r.kssk,
        mac: r.mac,
        stationId: r.stationId,
        ttlSec: typeof r.expiresAt === 'number' ? Math.max(0, Math.round((r.expiresAt - now)/1000)) : null,
      }));
      log.info('GET list detail', { rid: id, stationId: stationId ?? null, items: brief });
      if (rows.length > brief.length) log.info('GET list detail (truncated)', { rid: id, more: rows.length - brief.length });
    }
    // include 'ksk' alias for compatibility
    const rowsOut = rows.map(r => ({ ...r, ksk: r.kssk }));
    return withMode(NextResponse.json({ locks: rowsOut }), mode);
  } catch (e: unknown) {
    log.info('GET error', { rid: id, error: (e as any)?.message ?? String(e), durationMs: Date.now()-t0 });
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}

/* ============================= PATCH ============================= */
export async function PATCH(req: NextRequest) {
  const id = rid(); const t0 = Date.now();
  try {
    const DEFAULT_TTL_SEC = Math.max(5, Number((process.env.KSK_DEFAULT_TTL_SEC ?? process.env.KSSK_DEFAULT_TTL_SEC) ?? '900'));
    const body = await req.json();
    const stationId = body?.stationId;
    const ttlSec = body?.ttlSec ?? DEFAULT_TTL_SEC;
    const ksk = (body?.ksk ?? body?.kssk);
    if (!ksk || !stationId) return NextResponse.json({ error: "ksk & stationId required" }, { status: 400 });

    const key = K(String(ksk));
    const ttlMs = Math.max(5, Number(ttlSec)) * 1000;

    const r = getRedis();
    const haveRedis = r && (await connectIfNeeded(r));
    if (REQUIRE_REDIS && !haveRedis) {
      log.info('PATCH redis_unavailable (require_redis)', { rid: id, ksk, durationMs: Date.now()-t0 });
      return withMode(NextResponse.json({ error: 'redis_unavailable' }, { status: 503 }), 'redis');
    }
    const mode: "redis" | "mem" = haveRedis ? "redis" : "mem";

    if (haveRedis) {
      const existing = await rGet(key);
      if (!existing) {
        // Idempotent: if lock missing (already cleared), treat as OK no-op
        log.info('PATCH not_locked (idempotent_ok)', { rid: id, ksk, durationMs: Date.now()-t0 });
        return withMode(NextResponse.json({ ok: true, note: 'not_locked' }), mode);
      }
      if (existing.stationId !== String(stationId)) {
        log.info('PATCH not_owner', { rid: id, ksk, stationId, owner: existing.stationId, durationMs: Date.now()-t0 });
        return withMode(NextResponse.json({ error: "not_owner", existing }, { status: 403 }), mode);
      }
      await rExpirePX(key, ttlMs);
      await rSAdd(S(existing.stationId), existing.kssk);
      log.info('PATCH ok', { rid: id, ksk, stationId: existing.stationId, mode, durationMs: Date.now()-t0 });
      return withMode(NextResponse.json({ ok: true }), mode);
    }

    const ok = memTouchIfOwner(key, String(stationId), ttlMs);
    log.info('PATCH mem', { rid: id, ksk, stationId, ok, durationMs: Date.now()-t0 });
    return withMode(ok ? NextResponse.json({ ok: true }) : NextResponse.json({ ok: true, note: 'not_locked_or_not_owner' }), mode);
  } catch (e: unknown) {
    log.info('PATCH error', { rid: id, error: (e as any)?.message ?? String(e), durationMs: Date.now()-t0 });
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}

/* ============================= DELETE ============================ */
export async function DELETE(req: NextRequest) {
  const id = rid(); const t0 = Date.now();
  try {
    // accept body or query params
    let ksk: string | null = null;
    let stationId: string | null = null;
    let force = false;
    let macFilterRaw: string | null = null;

    try {
      if ((req.headers.get("content-type") || "").includes("application/json")) {
        const b = await req.json().catch(() => ({} as any));
        ksk = (b?.ksk ?? b?.kssk) ?? null;
        stationId = b?.stationId ?? null;
        force = b?.force === true || b?.force === 1 || b?.force === "1";
        if (typeof b?.mac === 'string') macFilterRaw = String(b.mac);
      }
    } catch {}
    const sp = new URL(req.url).searchParams;
    ksk ??= (sp.get("ksk") || sp.get("kssk"));
    stationId ??= sp.get("stationId");
    force ||= sp.get("force") === "1";
    macFilterRaw ??= sp.get('mac');
    const macFilter = normalizeMac(macFilterRaw);

    // Allow bulk clear by MAC without specifying a KSK
    if (!ksk && !macFilter) return NextResponse.json({ error: "ksk_or_mac_required" }, { status: 400 });

    const key = K(String(ksk));
    const r = getRedis();
    const haveRedis = r && (await connectIfNeeded(r));
    if (REQUIRE_REDIS && !haveRedis) {
      log.info('DELETE redis_unavailable (require_redis)', { rid: id, ksk, durationMs: Date.now()-t0 });
      return withMode(NextResponse.json({ error: 'redis_unavailable' }, { status: 503 }), 'redis');
    }
    const mode: "redis" | "mem" = haveRedis ? "redis" : "mem";

    if (haveRedis) {
      // Bulk delete by MAC (works with or without station index sets)
      if (!ksk && macFilter) {
        let count = 0;
        try {
          const keys: string[] = [];
          if (typeof (r as any).scan === 'function') {
            let cursor = '0';
            do {
              const res = await (r as any).scan(cursor, 'MATCH', 'ksk:*', 'COUNT', 300);
              cursor = res[0];
              const chunk: string[] = res[1] || [];
              keys.push(...chunk);
            } while (cursor !== '0');
          } else {
            const k = await (r as any).keys('ksk:*').catch(() => [] as string[]);
            keys.push(...k);
          }
          for (const key of keys) {
            try {
              const raw = await (r as any).get(key).catch(() => null);
              if (!raw) continue;
              const v = JSON.parse(raw);
              const sid = String(v?.stationId || '');
              const matches = macEquals(v?.mac, macFilter) || macEquals(v?.boardMac, macFilter);
              if (!matches) continue;
              if (stationId && sid !== String(stationId)) continue; // if station constrained, enforce it
              await (r as any).del(key).catch(() => {});
              const member = String(v?.kssk ?? v?.ksk ?? '').trim();
              if (sid) await (r as any).srem(S(sid), member).catch(() => {});
              count += 1;
            } catch {}
          }
        } catch {}
        log.info('DELETE bulk mac (scan)', { rid: id, mac: macFilter ?? macFilterRaw, stationId: stationId ?? null, count, mode, durationMs: Date.now()-t0 });
        return withMode(NextResponse.json({ ok: true, count }), mode);
      }
      const existing = await rGet(key);
      if (!existing) { log.info('DELETE none', { rid: id, ksk, mode, durationMs: Date.now()-t0 }); return withMode(NextResponse.json({ ok: true }), mode); }
      if (!force && (!stationId || existing.stationId !== String(stationId))) {
        log.info('DELETE not_owner', { rid: id, ksk, stationId, owner: existing.stationId, mode, durationMs: Date.now()-t0 });
        return withMode(NextResponse.json({ error: "not_owner", existing }, { status: 403 }), mode);
      }
      await rDel(key);
      await rSRem(S(existing.stationId), existing.kssk);
      log.info('DELETE ok', { rid: id, ksk, stationId: existing.stationId, mode, durationMs: Date.now()-t0 });
      return withMode(NextResponse.json({ ok: true, deleted: existing }), mode);
    }

    // mem fallback bulk
    if (!ksk && macFilter) {
      let rows: LockRow[] = [];
      const filterRows = (items: LockRow[]) =>
        items.filter((r) => normalizeMac(r.mac) === macFilter);
      if (stationId) rows = filterRows(memList(stationId));
      else rows = filterRows(memList());
      for (const row of rows) { memLocks.delete(K(row.kssk)); memStations.get(S(row.stationId))?.delete(row.kssk); }
      log.info('DELETE bulk mac (mem)', { rid: id, mac: macFilter ?? macFilterRaw, stationId: stationId ?? null, count: rows.length, durationMs: Date.now()-t0 });
      return withMode(NextResponse.json({ ok: true, count: rows.length }), 'mem');
    }
    const cur = memGet(key);
    if (!cur) { log.info('DELETE none', { rid: id, ksk, mode: 'mem', durationMs: Date.now()-t0 }); return withMode(NextResponse.json({ ok: true }), mode); }
    if (!force && (!stationId || cur.stationId !== String(stationId))) {
      log.info('DELETE not_owner', { rid: id, ksk, stationId, owner: cur.stationId, mode: 'mem', durationMs: Date.now()-t0 });
      return withMode(NextResponse.json({ error: "not_owner_or_missing", existing: cur }, { status: 403 }), mode);
    }
    memLocks.delete(key);
    memStations.get(S(cur.stationId))?.delete(cur.kssk);
    log.info('DELETE ok', { rid: id, ksk, stationId: cur.stationId, mode: 'mem', durationMs: Date.now()-t0 });
    return withMode(NextResponse.json({ ok: true, deleted: cur }), mode);
  } catch (e: unknown) {
    log.info('DELETE error', { rid: id, error: (e as any)?.message ?? String(e), durationMs: Date.now()-t0 });
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
