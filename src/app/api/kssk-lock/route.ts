// src/app/api/kssk-lock/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ===== Types ===== */
type LockVal = { kssk: string; mac: string; stationId: string; ts: number };
type LockRow = LockVal & { expiresAt?: number };

/* ===== Keys ===== */
const K = (kssk: string) => `kssk:lock:${kssk}`;
const S = (stationId: string) => `kssk:station:${stationId}`;

/* =======================================================================================
   In-memory fallback (kept simple but mirrors Redis behaviour incl. per-station index)
======================================================================================= */
const memLocks = new Map<string, { v: LockVal; exp: number }>(); // key = K(kssk)
const memStations = new Map<string, Set<string>>(); // key = S(stationId) -> Set<kssk>

const nowMs = () => Date.now();
const memGet = (key: string): LockVal | null => {
  const x = memLocks.get(key);
  if (!x) return null;
  if (nowMs() > x.exp) {
    // expire + cleanup station index
    memLocks.delete(key);
    const kssk = key.slice("kssk:lock:".length);
    for (const set of memStations.values()) set.delete(kssk);
    return null;
  }
  return x.v;
};
const memSetNX = (key: string, v: LockVal, ttlMs: number) => {
  if (memGet(key)) return false;
  memLocks.set(key, { v, exp: nowMs() + ttlMs });
  const setKey = S(v.stationId);
  if (!memStations.has(setKey)) memStations.set(setKey, new Set());
  memStations.get(setKey)!.add(v.kssk);
  return true;
};
const memDelIfOwner = (key: string, stationId: string) => {
  const cur = memGet(key);
  if (!cur || cur.stationId !== stationId) return false;
  memLocks.delete(key);
  const setKey = S(stationId);
  memStations.get(setKey)?.delete(cur.kssk);
  return true;
};
const memTouchIfOwner = (key: string, stationId: string, ttlMs: number) => {
  const cur = memGet(key);
  if (!cur || cur.stationId !== stationId) return false;
  memLocks.set(key, { v: cur, exp: nowMs() + ttlMs });
  return true;
};
const memList = (stationId?: string): LockRow[] => {
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
};

/* =======================================================================================
   Redis helpers (compatible with ioredis or node-redis v4)
======================================================================================= */
const asJSON = (x: any) => (typeof x === "string" ? JSON.parse(x) : x);
async function connectIfNeeded(r: any): Promise<boolean> {
  if (!r) return false;
  try {
    // node-redis v4
    if (typeof r.isOpen === "boolean") {
      if (!r.isOpen) await r.connect();
      return r.isOpen;
    }
    // ioredis
    if (typeof r.status === "string") {
      if (r.status !== "ready") {
        await new Promise<void>((resolve) => {
          const done = () => {
            r.off?.("ready", done);
            r.off?.("connect", done);
            resolve();
          };
          r.once?.("ready", done);
          r.once?.("connect", done);
        });
      }
      return r.status === "ready";
    }
  } catch { /* ignore */ }
  return true;
}

async function rGet(key: string): Promise<LockVal | null> {
  const r: any = getRedis();
  if (!r || !(await connectIfNeeded(r))) return null;
  try {
    const raw = await r.get(key);
    return raw ? (asJSON(raw) as LockVal) : null;
  } catch { return null; }
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
  try {
    const n = await r.pexpire(key, ttlMs);
    return !!n;
  } catch { return false; }
}

async function rDel(key: string): Promise<void> {
  const r: any = getRedis();
  if (!r || !(await connectIfNeeded(r))) return;
  try { await r.del(key); } catch { /* ignore */ }
}

async function rSAdd(skey: string, member: string) {
  const r: any = getRedis();
  if (!r || !(await connectIfNeeded(r))) return;
  try { await r.sadd(skey, member); } catch { /* ignore */ }
}
async function rSRem(skey: string, member: string) {
  const r: any = getRedis();
  if (!r || !(await connectIfNeeded(r))) return;
  try { await r.srem(skey, member); } catch { /* ignore */ }
}
async function rSMembers(skey: string): Promise<string[]> {
  const r: any = getRedis();
  if (!r || !(await connectIfNeeded(r))) return [];
  try {
    const res = await r.smembers(skey);
    return Array.isArray(res) ? res : [];
  } catch { return []; }
}
async function rPTTL(key: string): Promise<number | null> {
  const r: any = getRedis();
  if (!r || !(await connectIfNeeded(r))) return null;
  try {
    const v = await r.pttl(key);
    return typeof v === "number" ? v : null;
  } catch { return null; }
}

/* Station-scoped list with cleanup & expiresAt */
async function redisList(stationId?: string): Promise<LockRow[]> {
  const r: any = getRedis();
if (!r || !(await connectIfNeeded(r))) return [];

  const now = nowMs();
  const rows: LockRow[] = [];

  const collect = async (ksskList: string[]) => {
    // fetch each; keep simple for compatibility
    await Promise.all(
      ksskList.map(async (kssk) => {
        const key = K(kssk);
        const val = await rGet(key);
        if (!val) {
          // stale index entry → cleanup
          if (stationId) await rSRem(S(stationId), kssk);
          return;
        }
        const ttl = await rPTTL(key);
        const expiresAt = ttl && ttl > 0 ? now + ttl : undefined;
        rows.push({ ...val, expiresAt });
      })
    );
  };

  if (stationId) {
    const members = await rSMembers(S(stationId));
    await collect(members);
    return rows;
  }

  // no station filter → scan keys
  const keys: string[] = [];
  if (typeof r.scan === "function") {
    let cursor = "0";
    do {
      const res = await r.scan(cursor, "MATCH", "kssk:lock:*", "COUNT", 300);
      cursor = res[0];
      keys.push(...(res[1] as string[]));
    } while (cursor !== "0");
  } else {
    keys.push(...(await r.keys("kssk:lock:*")));
  }

  await Promise.all(
    keys.map(async (key) => {
      const val = await rGet(key);
      if (!val) return;
      const ttl = await rPTTL(key);
      rows.push({ ...val, expiresAt: ttl && ttl > 0 ? now + ttl : undefined });
    })
  );
  return rows;
}

/* =======================================================================================
   Handlers
======================================================================================= */

export async function POST(req: NextRequest) {
  const { kssk, mac, stationId, ttlSec = 900 } = await req.json();
  if (!kssk || !stationId) {
    return NextResponse.json({ error: "kssk & stationId required" }, { status: 400 });
  }

  const key = K(String(kssk));
  const ttlMs = Math.max(5, Number(ttlSec)) * 1000;
  const val: LockVal = {
    kssk: String(kssk),
    mac: String(mac ?? "").toUpperCase(),
    stationId: String(stationId),
    ts: nowMs(),
  };

  const r = getRedis();
  if (r) {
    const ok = await rSetNXPX(key, val, ttlMs);
    if (!ok) {
      const existing = await rGet(key);
      return NextResponse.json({ error: "locked", existing }, { status: 409 });
    }
    // index by station for fast listing
    await rSAdd(S(val.stationId), val.kssk);
    return NextResponse.json({ ok: true });
  }

  if (!memSetNX(key, val, ttlMs)) {
    return NextResponse.json({ error: "locked", existing: memGet(key) }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}

/** GET
 *  - /api/kssk-lock?kssk=123         -> single status
 *  - /api/kssk-lock[?stationId=ID]   -> list, optionally filtered; returns expiresAt
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const kssk = searchParams.get("kssk");
  const stationId = searchParams.get("stationId") || undefined;

  if (kssk) {
    const key = K(kssk);
    const r = getRedis();
    if (r) {
      const existing = await rGet(key);
      const ttl = existing ? await rPTTL(key) : null;
      const expiresAt = existing && ttl && ttl > 0 ? nowMs() + ttl : undefined;
      return NextResponse.json({ locked: !!existing, existing: existing ? { ...existing, expiresAt } : null });
    }
    const v = memGet(key);
    // find exp in mem
    let expiresAt: number | undefined;
    if (v) {
      const x = (memLocks.get(key) as any)?.exp as number | undefined;
      if (x) expiresAt = x;
    }
    return NextResponse.json({ locked: !!v, existing: v ? { ...v, expiresAt } : null });
  }

  const r = getRedis();
  const locks: LockRow[] = r ? await redisList(stationId) : memList(stationId);
  return NextResponse.json({ locks });
}

/** PATCH: heartbeat (extend TTL) */
export async function PATCH(req: NextRequest) {
  const { kssk, stationId, ttlSec = 900 } = await req.json();
  if (!kssk || !stationId) {
    return NextResponse.json({ error: "kssk & stationId required" }, { status: 400 });
  }
  const key = K(String(kssk));
  const ttlMs = Math.max(5, Number(ttlSec)) * 1000;

  const r = getRedis();
  if (r) {
    const existing = await rGet(key);
    if (!existing) return NextResponse.json({ error: "not_locked" }, { status: 404 });
    if (existing.stationId !== String(stationId)) {
      return NextResponse.json({ error: "not_owner", existing }, { status: 403 });
    }
    await rExpirePX(key, ttlMs);
    // ensure index exists
    await rSAdd(S(existing.stationId), existing.kssk);
    return NextResponse.json({ ok: true });
  }

  if (!memTouchIfOwner(key, String(stationId), ttlMs)) {
    return NextResponse.json({ error: "not_locked_or_not_owner" }, { status: 403 });
  }
  return NextResponse.json({ ok: true });
}
export async function DELETE(req: NextRequest) {
  let kssk: string | null = null;
  let stationId: string | null = null;
  let force = false;

  try {
    if ((req.headers.get("content-type") || "").includes("application/json")) {
      const b = await req.json().catch(() => ({}));
      kssk = b?.kssk ?? null;
      stationId = b?.stationId ?? null;
      force = b?.force === true || b?.force === 1 || b?.force === "1";
    }
  } catch {}

  const sp = new URL(req.url).searchParams;
  kssk ??= sp.get("kssk");
  stationId ??= sp.get("stationId");
  force ||= sp.get("force") === "1";

  if (!kssk) return NextResponse.json({ error: "kssk required" }, { status: 400 });

  const key = K(String(kssk));
  const r = getRedis();

  // --- Redis path
  if (r && (await connectIfNeeded(r))) {
    if (typeof r.connect === "function") { await r.connect().catch(()=>{}); }
    const existing = await rGet(key);
    if (!existing) return NextResponse.json({ ok: true });

    if (!force && (!stationId || existing.stationId !== String(stationId))) {
      return NextResponse.json({ error: "not_owner", existing }, { status: 403 });
    }

    await rDel(key);
    // remove from station index set
    await rSRem(S(existing.stationId), existing.kssk);

    return NextResponse.json({ ok: true, deleted: existing });
  }

  // --- In-memory fallback
  const cur = memGet(key);
  if (!cur) return NextResponse.json({ ok: true });

  if (!force && (!stationId || cur.stationId !== String(stationId))) {
    return NextResponse.json({ error: "not_owner_or_missing", existing: cur }, { status: 403 });
  }

  memLocks.delete(key);
  memStations.get(S(cur.stationId))?.delete(cur.kssk);

  return NextResponse.json({ ok: true, deleted: cur });
}
