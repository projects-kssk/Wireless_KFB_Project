import { NextRequest } from "next/server";
import { getRedis } from "@/lib/redis";

type LockVal = { kssk:string; mac:string; stationId:string; ts:number };
const mem = new Map<string, { v:LockVal; exp:number }>(); // fallback

function memGet(k:string){ const x=mem.get(k); if(!x) return null; if(Date.now()>x.exp){mem.delete(k); return null;} return x.v; }
function memSetNX(k:string, v:LockVal, ttlMs:number){ if(memGet(k)) return false; mem.set(k,{v,exp:Date.now()+ttlMs}); return true; }
function memDelIfOwner(k:string, stationId:string){ const cur=memGet(k); if(!cur||cur.stationId!==stationId) return false; mem.delete(k); return true; }
function memTouchIfOwner(k:string, stationId:string, ttlMs:number){ const cur=memGet(k); if(!cur||cur.stationId!==stationId) return false; mem.set(k,{v:cur,exp:Date.now()+ttlMs}); return true; }

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { kssk, mac, stationId, ttlSec = 900 } = await req.json();
  if (!kssk || !stationId) return Response.json({ error:"kssk & stationId required" }, { status:400 });
  const key = `kssk:lock:${kssk}`;
  const ttlMs = Math.max(5, Number(ttlSec)) * 1000;
  const val: LockVal = { kssk, mac, stationId, ts: Date.now() };

  const r = getRedis();
  if (r) {
    // SET NX PX for atomic lock
    const ok = await r.set(key, JSON.stringify(val), "PX", ttlMs, "NX");
    if (!ok) {
      const existing = await r.get(key);
      return Response.json({ error:"locked", existing: existing && JSON.parse(existing) }, { status:409 });
    }
    return Response.json({ ok:true });
  }
  // fallback
  if (!memSetNX(key, val, ttlMs)) return Response.json({ error:"locked", existing: memGet(key) }, { status:409 });
  return Response.json({ ok:true });
}

export async function GET(req: NextRequest) {
  const kssk = new URL(req.url).searchParams.get("kssk") || "";
  if (!kssk) return Response.json({ error:"kssk required" }, { status:400 });
  const key = `kssk:lock:${kssk}`;
  const r = getRedis();
  const existing = r ? (await r.get(key)) && JSON.parse((await r.get(key))!) : memGet(key);
  return Response.json({ locked: !!existing, existing: existing || null });
}

export async function PATCH(req: NextRequest) {
  // heartbeat: extend TTL if owner
  const { kssk, stationId, ttlSec = 900 } = await req.json();
  if (!kssk || !stationId) return Response.json({ error:"kssk & stationId required" }, { status:400 });
  const key = `kssk:lock:${kssk}`;
  const ttlMs = Math.max(5, Number(ttlSec)) * 1000;

  const r = getRedis();
  if (r) {
    const existing = await r.get(key);
    if (!existing) return Response.json({ error:"not_locked" }, { status:404 });
    const cur = JSON.parse(existing);
    if (cur.stationId !== stationId) return Response.json({ error:"not_owner", existing:cur }, { status:403 });
    await r.pexpire(key, ttlMs);
    return Response.json({ ok:true });
  }
  if (!memTouchIfOwner(key, stationId, ttlMs)) return Response.json({ error:"not_locked_or_not_owner" }, { status:403 });
  return Response.json({ ok:true });
}

export async function DELETE(req: NextRequest) {
  const { kssk, stationId } = await req.json();
  if (!kssk || !stationId) return Response.json({ error:"kssk & stationId required" }, { status:400 });
  const key = `kssk:lock:${kssk}`;
  const r = getRedis();
  if (r) {
    const existing = await r.get(key);
    if (!existing) return Response.json({ ok:true }); // already free
    const cur = JSON.parse(existing);
    if (cur.stationId !== stationId) return Response.json({ error:"not_owner", existing:cur }, { status:403 });
    await r.del(key);
    return Response.json({ ok:true });
  }
  if (!memDelIfOwner(key, stationId)) return Response.json({ error:"not_owner_or_missing" }, { status:403 });
  return Response.json({ ok:true });
}
