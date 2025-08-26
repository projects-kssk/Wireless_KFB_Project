// src/app/api/kssk-lock/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";

type LockVal = { kssk: string; mac: string; stationId: string; ts: number };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ================= In-memory fallback ================= */
const mem = new Map<string, { v: LockVal; exp: number }>(); // key = kssk:lock:<kssk>
const keyFor = (kssk: string) => `kssk:lock:${kssk}`;

function memGet(key: string): LockVal | null {
  const x = mem.get(key);
  if (!x) return null;
  if (Date.now() > x.exp) {
    mem.delete(key);
    return null;
  }
  return x.v;
}
function memSetNX(key: string, v: LockVal, ttlMs: number): boolean {
  if (memGet(key)) return false;
  mem.set(key, { v, exp: Date.now() + ttlMs });
  return true;
}
function memDelIfOwner(key: string, stationId: string): boolean {
  const cur = memGet(key);
  if (!cur || cur.stationId !== stationId) return false;
  mem.delete(key);
  return true;
}
function memTouchIfOwner(key: string, stationId: string, ttlMs: number): boolean {
  const cur = memGet(key);
  if (!cur || cur.stationId !== stationId) return false;
  mem.set(key, { v: cur, exp: Date.now() + ttlMs });
  return true;
}
function memList(stationId?: string): LockVal[] {
  const now = Date.now();
  const out: LockVal[] = [];
  for (const [k, { v, exp }] of mem.entries()) {
    if (exp <= now) {
      mem.delete(k);
      continue;
    }
    if (!stationId || v.stationId === stationId) out.push(v);
  }
  return out;
}

/* ================= Redis helpers ================= */
async function redisGet(key: string): Promise<LockVal | null> {
  const r: any = getRedis();
  if (!r) return null;
  const raw = await r.get(key);
  return raw ? (JSON.parse(raw) as LockVal) : null;
}

async function redisSetNX(key: string, val: LockVal, ttlMs: number): Promise<boolean> {
  const r: any = getRedis();
  if (!r) return false;
  // ioredis: set(key, value, 'PX', ttl, 'NX'); node-redis v4: set(key, value, { PX: ttl, NX: true })
  const ok =
    (await r.set?.(key, JSON.stringify(val), "PX", ttlMs, "NX")) ??
    (await r.set?.(key, JSON.stringify(val), { PX: ttlMs, NX: true }));
  return !!ok;
}

async function redisDel(key: string): Promise<void> {
  const r: any = getRedis();
  if (!r) return;
  await r.del(key);
}

async function redisPexpire(key: string, ttlMs: number): Promise<boolean> {
  const r: any = getRedis();
  if (!r) return false;
  const n = await r.pexpire(key, ttlMs);
  return !!n;
}

async function redisScanKeys(pattern: string): Promise<string[]> {
  const r: any = getRedis();
  if (!r) return [];
  if (typeof r.scan === "function") {
    let cursor = "0";
    const keys: string[] = [];
    do {
      const res = await r.scan(cursor, "MATCH", pattern, "COUNT", 100);
      cursor = res[0];
      const batch = res[1] as string[];
      keys.push(...batch);
    } while (cursor !== "0");
    return keys;
  }
  // Fallback (acceptable for small dev instances)
  return (await r.keys(pattern)) as string[];
}

async function redisMGet(keys: string[]): Promise<(LockVal | null)[]> {
  const r: any = getRedis();
  if (!r || keys.length === 0) return [];
  if (typeof r.mget === "function") {
    const raws: (string | null)[] = await r.mget(keys);
    return raws.map((raw) => (raw ? (JSON.parse(raw) as LockVal) : null));
  }
  // Fallback to individual GETs
  const out: (LockVal | null)[] = [];
  for (const k of keys) out.push(await redisGet(k));
  return out;
}

async function redisList(stationId?: string): Promise<LockVal[]> {
  const keys = await redisScanKeys("kssk:lock:*");
  const vals = await redisMGet(keys);
  const out: LockVal[] = [];
  for (const v of vals) {
    if (!v) continue;
    if (!stationId || v.stationId === stationId) out.push(v);
  }
  return out;
}

/* ================= Handlers ================= */

export async function POST(req: NextRequest) {
  const { kssk, mac, stationId, ttlSec = 900 } = await req.json();
  if (!kssk || !stationId) {
    return NextResponse.json({ error: "kssk & stationId required" }, { status: 400 });
  }

  const key = keyFor(String(kssk));
  const ttlMs = Math.max(5, Number(ttlSec)) * 1000;
  const val: LockVal = { kssk: String(kssk), mac: String(mac ?? ""), stationId: String(stationId), ts: Date.now() };

  const r = getRedis();
  if (r) {
    const ok = await redisSetNX(key, val, ttlMs);
    if (!ok) {
      const existing = await redisGet(key);
      return NextResponse.json({ error: "locked", existing }, { status: 409 });
    }
    return NextResponse.json({ ok: true });
  }

  if (!memSetNX(key, val, ttlMs)) {
    return NextResponse.json({ error: "locked", existing: memGet(key) }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}

/**
 * GET supports two modes:
 *  1) /api/kssk-lock?kssk=123          -> lookup a single lock
 *  2) /api/kssk-lock[?stationId=ID]    -> list locks (optionally filter by station)
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const kssk = searchParams.get("kssk");
  const stationId = searchParams.get("stationId") || undefined;

  if (kssk) {
    const key = keyFor(kssk);
    const r = getRedis();
    const existing = r ? await redisGet(key) : memGet(key);
    return NextResponse.json({ locked: !!existing, existing: existing ?? null });
  }

  // List locks
  const r = getRedis();
  const locks = r ? await redisList(stationId) : memList(stationId);
  return NextResponse.json({ locks });
}

export async function PATCH(req: NextRequest) {
  // heartbeat: extend TTL if owner
  const { kssk, stationId, ttlSec = 900 } = await req.json();
  if (!kssk || !stationId) {
    return NextResponse.json({ error: "kssk & stationId required" }, { status: 400 });
  }
  const key = keyFor(String(kssk));
  const ttlMs = Math.max(5, Number(ttlSec)) * 1000;

  const r = getRedis();
  if (r) {
    const existing = await redisGet(key);
    if (!existing) return NextResponse.json({ error: "not_locked" }, { status: 404 });
    if (existing.stationId !== String(stationId)) {
      return NextResponse.json({ error: "not_owner", existing }, { status: 403 });
    }
    await redisPexpire(key, ttlMs);
    return NextResponse.json({ ok: true });
  }

  if (!memTouchIfOwner(key, String(stationId), ttlMs)) {
    return NextResponse.json({ error: "not_locked_or_not_owner" }, { status: 403 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const { kssk, stationId } = await req.json();
  if (!kssk || !stationId) {
    return NextResponse.json({ error: "kssk & stationId required" }, { status: 400 });
  }
  const key = keyFor(String(kssk));

  const r = getRedis();
  if (r) {
    const existing = await redisGet(key);
    if (!existing) return NextResponse.json({ ok: true }); // already free
    if (existing.stationId !== String(stationId)) {
      return NextResponse.json({ error: "not_owner", existing }, { status: 403 });
    }
    await redisDel(key);
    return NextResponse.json({ ok: true });
  }

  if (!memDelIfOwner(key, String(stationId))) {
    return NextResponse.json({ error: "not_owner_or_missing" }, { status: 403 });
  }
  return NextResponse.json({ ok: true });
}
