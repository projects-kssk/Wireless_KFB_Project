import { NextResponse } from "next/server";
import { ensureEspPresent, writeToStation, waitForEchoOrResult, MAC_RE } from "@/lib/station";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Generic send:
 * Body: { mac: string, payload: string, wait?: "none"|"echo"|"result", timeoutMs?: number }
 */
export async function POST(req: Request) {
  try {
    const { mac, payload, wait = "none", timeoutMs } =
      (await req.json().catch(() => ({}))) as {
        mac?: string; payload?: string; wait?: "none"|"echo"|"result"; timeoutMs?: number;
      };

    if (!payload || typeof payload !== "string") {
      return NextResponse.json({ error: 'Missing or invalid "payload".' }, { status: 400 });
    }
    const target = String(mac || "").toUpperCase();
    if (!MAC_RE.test(target)) {
      return NextResponse.json({ error: 'Missing or invalid "mac".' }, { status: 400 });
    }

    await ensureEspPresent();
    await writeToStation(payload, target);

    if (wait === "none") {
      return NextResponse.json({ ok: true, mac: target, payload, queued: true });
    }

    const out = await waitForEchoOrResult({ signal: req.signal, mac: target, payload, mode: wait, timeoutMs });
    return NextResponse.json({ ok: true, mac: target, payload, ...out });
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    const status =
      msg === "client-abort" ? 499 :
      msg === "serial-not-present" ? 428 :
      msg === "invalid-mac" ? 400 :
      msg === "echo-mismatch" ? 412 :
      msg === "timeout" ? 504 :
      500;
    return new NextResponse(JSON.stringify({ error: msg }), { status, headers: { "Content-Type": "application/json" } });
  }
}
