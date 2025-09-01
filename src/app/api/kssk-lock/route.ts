// src/app/api/kssk-lock/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";

import { LOG } from "@/lib/logger";
const log = LOG.tag("kssk-lock");
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
const K = (kssk: string) => `kssk:lock:${kssk}`;
const S = (stationId: string) => `kssk:station:${stationId}`;
const REQUIRE_REDIS = (process.env.KSSK_REQUIRE_REDIS ?? '0') === '1';
/* ================= In-memory fallback store ================== */
const memLocks = new Map<string, { v: LockVal; exp: number }>(); // key: K(kssk)
const memStations = new Map<string, Set<string>>();              // key: S(stationId) -> Set<kssk>
const nowMs = () => Date.now();

function memGet(key: string): LockVal | null {
  const x = memLocks.get(key);
  if (!x) return null;
  if (nowMs() > x.exp) {
    memLocks.delete(key);
    const kssk = key.slice("kssk:lock:".length);
    for (const set of memStations.values()) set.delete(kssk);
    return null;
  }
  return x.v;
}
function memSetNX(key: string, v: LockVal, ttlMs: number) {
  if (memGet(key)) return false;
  memLocks.set(key, { v, exp: nowMs() + ttlMs });
  const skey = S(v.stationId);
  if (!memStations.has(skey)) memStations.set(skey, new Set());
  memStations.get(skey)!.add(v.kssk);
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
      out.push({ ...x.v, expiresAt: x.exp });
    }
    return out;
  }
  for (const [k, { v, exp }] of memLocks.entries()) {
    if (exp <= n) { memLocks.delete(k); continue; }
    out.push({ ...v, expiresAt: exp });
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
  try { const raw = await r.get(key); return raw ? (asJSON(raw) as LockVal) : null; } catch { return null; }
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
      const res = await r.scan(cursor, "MATCH", "kssk:lock:*", "COUNT", 300);
      cursor = res[0]; keys.push(...(res[1] as string[]));
    } while (cursor !== "0");
  } else {
    keys.push(...(await r.keys("kssk:lock:*")));
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
    resp.headers.set("X-KSSK-Mode", mode);
    if (id) resp.headers.set("X-Req-Id", id);
    return resp;
  }
/* ============================ POST =============================== */
export async function POST(req: NextRequest) {
  const id = rid(); const t0 = Date.now();

  try {
    const DEFAULT_TTL_SEC = Math.max(5, Number(process.env.KSSK_DEFAULT_TTL_SEC ?? '900'));
    const { kssk, mac, stationId, ttlSec = DEFAULT_TTL_SEC } = await req.json();
    log.info('POST begin', { rid: id, action: 'create', kssk, mac: String(mac||'').toUpperCase(), stationId, ttlSec: Number(ttlSec) });

    if (!kssk || !stationId)
      return NextResponse.json({ error: "kssk & stationId required" }, { status: 400 });

    const key = K(String(kssk));
    const ttlMs = Math.max(5, Number(ttlSec)) * 1000;
    const val: LockVal = { kssk: String(kssk), mac: String(mac ?? "").toUpperCase(), stationId: String(stationId), ts: nowMs() };

    const r = getRedis();
    const haveRedis = r && (await connectIfNeeded(r));
    if (REQUIRE_REDIS && !haveRedis) {
      log.info('POST redis_unavailable (require_redis)', { rid: id, kssk, durationMs: Date.now()-t0 });
      return withMode(NextResponse.json({ error: 'redis_unavailable' }, { status: 503 }), 'redis');
    }

    if (haveRedis) {
      const ok = await rSetNXPX(key, val, ttlMs);
      if (!ok) {
        const existing = await rGet(key);
        if (!existing) {
          // Redis reachable but failed to set for an unknown reason → degrade to mem once
          const memOk = memSetNX(key, val, ttlMs);
          log.info('POST mem-fallback', { rid: id, kssk, stationId: val.stationId, memSet: memOk, durationMs: Date.now()-t0 });
          return withMode(
            memOk
              ? NextResponse.json({ ok: true, mode: "mem-fallback" })
              : NextResponse.json({ error: "locked", existing: memGet(key) }, { status: 409 }),
            "mem-fallback"
          );
        }
        log.info('POST locked', { rid: id, kssk, stationId: existing.stationId, durationMs: Date.now()-t0 });
        return withMode(NextResponse.json({ error: "locked", existing }, { status: 409 }), "redis");
      }
      await rSAdd(S(val.stationId), val.kssk);
      log.info('POST ok', { rid: id, kssk, stationId: val.stationId, mode: 'redis', durationMs: Date.now()-t0 });
      return withMode(NextResponse.json({ ok: true }), "redis", id);
    }

    const memOk = memSetNX(key, val, ttlMs);
    log.info('POST ok', { rid: id, kssk, stationId: val.stationId, mode: 'mem', memSet: memOk, durationMs: Date.now()-t0 });
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
    const kssk = searchParams.get("kssk");
    const stationId = searchParams.get("stationId") || undefined;

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
        log.info('GET one', { rid: id, kssk, mode, locked: !!existing, durationMs: Date.now()-t0 });
        return withMode(NextResponse.json({ locked: !!existing, existing: existing ? { ...existing, expiresAt } : null }), mode);
      }
      const v = memGet(key);
      const exp = (memLocks.get(key) as any)?.exp as number | undefined;
      log.info('GET one', { rid: id, kssk, mode, locked: !!v, durationMs: Date.now()-t0 });
      return withMode(NextResponse.json({ locked: !!v, existing: v ? { ...v, expiresAt: exp } : null }), mode);
    }

    const rows: LockRow[] = haveRedis ? await redisList(stationId) : memList(stationId);
    const info = { rid: id, stationId: stationId ?? null, mode, count: rows.length, durationMs: Date.now()-t0 };
    if (rows.length > 0) log.info('GET list', info);
    else log.debug('GET list (empty)', info);

    // Optional verbose detail logging for terminal visibility
    if ((process.env.KSSK_LOCK_LOG_DETAIL ?? '0') === '1') {
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
    return withMode(NextResponse.json({ locks: rows }), mode);
  } catch (e: unknown) {
    log.info('GET error', { rid: id, error: (e as any)?.message ?? String(e), durationMs: Date.now()-t0 });
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}

/* ============================= PATCH ============================= */
export async function PATCH(req: NextRequest) {
  const id = rid(); const t0 = Date.now();
  try {
    const DEFAULT_TTL_SEC = Math.max(5, Number(process.env.KSSK_DEFAULT_TTL_SEC ?? '900'));
    const { kssk, stationId, ttlSec = DEFAULT_TTL_SEC } = await req.json();
    if (!kssk || !stationId) return NextResponse.json({ error: "kssk & stationId required" }, { status: 400 });

    const key = K(String(kssk));
    const ttlMs = Math.max(5, Number(ttlSec)) * 1000;

    const r = getRedis();
    const haveRedis = r && (await connectIfNeeded(r));
    if (REQUIRE_REDIS && !haveRedis) {
      log.info('PATCH redis_unavailable (require_redis)', { rid: id, kssk, durationMs: Date.now()-t0 });
      return withMode(NextResponse.json({ error: 'redis_unavailable' }, { status: 503 }), 'redis');
    }
    const mode: "redis" | "mem" = haveRedis ? "redis" : "mem";

    if (haveRedis) {
      const existing = await rGet(key);
      if (!existing) { log.info('PATCH not_locked', { rid: id, kssk, durationMs: Date.now()-t0 }); return withMode(NextResponse.json({ error: "not_locked" }, { status: 404 }), mode); }
      if (existing.stationId !== String(stationId)) {
        log.info('PATCH not_owner', { rid: id, kssk, stationId, owner: existing.stationId, durationMs: Date.now()-t0 });
        return withMode(NextResponse.json({ error: "not_owner", existing }, { status: 403 }), mode);
      }
      await rExpirePX(key, ttlMs);
      await rSAdd(S(existing.stationId), existing.kssk);
      log.info('PATCH ok', { rid: id, kssk, stationId: existing.stationId, mode, durationMs: Date.now()-t0 });
      return withMode(NextResponse.json({ ok: true }), mode);
    }

    const ok = memTouchIfOwner(key, String(stationId), ttlMs);
    log.info('PATCH mem', { rid: id, kssk, stationId, ok, durationMs: Date.now()-t0 });
    return withMode(ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "not_locked_or_not_owner" }, { status: 403 }), mode);
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
    let kssk: string | null = null;
    let stationId: string | null = null;
    let force = false;
    let macFilter: string | null = null;

    try {
      if ((req.headers.get("content-type") || "").includes("application/json")) {
        const b = await req.json().catch(() => ({} as any));
        kssk = b?.kssk ?? null;
        stationId = b?.stationId ?? null;
        force = b?.force === true || b?.force === 1 || b?.force === "1";
        if (typeof b?.mac === 'string') macFilter = String(b.mac).toUpperCase();
      }
    } catch {}
    const sp = new URL(req.url).searchParams;
    kssk ??= sp.get("kssk");
    stationId ??= sp.get("stationId");
    force ||= sp.get("force") === "1";
    macFilter ??= sp.get('mac');
    if (macFilter) macFilter = macFilter.toUpperCase();

    // Allow bulk clear by MAC without specifying a KSSK
    if (!kssk && !macFilter) return NextResponse.json({ error: "kssk_or_mac_required" }, { status: 400 });

    const key = K(String(kssk));
    const r = getRedis();
    const haveRedis = r && (await connectIfNeeded(r));
    if (REQUIRE_REDIS && !haveRedis) {
      log.info('DELETE redis_unavailable (require_redis)', { rid: id, kssk, durationMs: Date.now()-t0 });
      return withMode(NextResponse.json({ error: 'redis_unavailable' }, { status: 503 }), 'redis');
    }
    const mode: "redis" | "mem" = haveRedis ? "redis" : "mem";

    if (haveRedis) {
      // Bulk delete by MAC (works with or without station index sets)
      if (!kssk && macFilter) {
        let count = 0;
        try {
          const keys: string[] = [];
          if (typeof (r as any).scan === 'function') {
            let cursor = '0';
            do {
              const res = await (r as any).scan(cursor, 'MATCH', 'kssk:lock:*', 'COUNT', 300);
              cursor = res[0];
              const chunk: string[] = res[1] || [];
              keys.push(...chunk);
            } while (cursor !== '0');
          } else {
            const k = await (r as any).keys('kssk:lock:*').catch(() => [] as string[]);
            keys.push(...k);
          }
          for (const key of keys) {
            try {
              const raw = await (r as any).get(key).catch(() => null);
              if (!raw) continue;
              const v = JSON.parse(raw);
              const macUp = String(v?.mac || '').toUpperCase();
              const sid = String(v?.stationId || '');
              if (macUp !== macFilter) continue;
              if (stationId && sid !== String(stationId)) continue; // if station constrained, enforce it
              await (r as any).del(key).catch(() => {});
              if (sid) await (r as any).srem(S(sid), String(v?.kssk || '').trim()).catch(() => {});
              count += 1;
            } catch {}
          }
        } catch {}
        log.info('DELETE bulk mac (scan)', { rid: id, mac: macFilter, stationId: stationId ?? null, count, mode, durationMs: Date.now()-t0 });
        return withMode(NextResponse.json({ ok: true, count }), mode);
      }
      const existing = await rGet(key);
      if (!existing) { log.info('DELETE none', { rid: id, kssk, mode, durationMs: Date.now()-t0 }); return withMode(NextResponse.json({ ok: true }), mode); }
      if (!force && (!stationId || existing.stationId !== String(stationId))) {
        log.info('DELETE not_owner', { rid: id, kssk, stationId, owner: existing.stationId, mode, durationMs: Date.now()-t0 });
        return withMode(NextResponse.json({ error: "not_owner", existing }, { status: 403 }), mode);
      }
      await rDel(key);
      await rSRem(S(existing.stationId), existing.kssk);
      log.info('DELETE ok', { rid: id, kssk, stationId: existing.stationId, mode, durationMs: Date.now()-t0 });
      return withMode(NextResponse.json({ ok: true, deleted: existing }), mode);
    }

    // mem fallback bulk
    if (!kssk && macFilter) {
      let rows: LockRow[] = [];
      if (stationId) rows = memList(stationId).filter(r => String(r.mac || '').toUpperCase() === macFilter);
      else rows = memList().filter(r => String(r.mac || '').toUpperCase() === macFilter);
      for (const row of rows) { memLocks.delete(K(row.kssk)); memStations.get(S(row.stationId))?.delete(row.kssk); }
      log.info('DELETE bulk mac (mem)', { rid: id, mac: macFilter, stationId: stationId ?? null, count: rows.length, durationMs: Date.now()-t0 });
      return withMode(NextResponse.json({ ok: true, count: rows.length }), 'mem');
    }
    const cur = memGet(key);
    if (!cur) { log.info('DELETE none', { rid: id, kssk, mode: 'mem', durationMs: Date.now()-t0 }); return withMode(NextResponse.json({ ok: true }), mode); }
    if (!force && (!stationId || cur.stationId !== String(stationId))) {
      log.info('DELETE not_owner', { rid: id, kssk, stationId, owner: cur.stationId, mode: 'mem', durationMs: Date.now()-t0 });
      return withMode(NextResponse.json({ error: "not_owner_or_missing", existing: cur }, { status: 403 }), mode);
    }
    memLocks.delete(key);
    memStations.get(S(cur.stationId))?.delete(cur.kssk);
    log.info('DELETE ok', { rid: id, kssk, stationId: cur.stationId, mode: 'mem', durationMs: Date.now()-t0 });
    return withMode(NextResponse.json({ ok: true, deleted: cur }), mode);
  } catch (e: unknown) {
    log.info('DELETE error', { rid: id, error: (e as any)?.message ?? String(e), durationMs: Date.now()-t0 });
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
