import { NextResponse } from "next/server";
import { ensureEspPresent, writeToStation, waitForEchoOrResult, MAC_RE } from "@/lib/station";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { mac, kfb } = (await req.json().catch(() => ({}))) as { mac?: string; kfb?: string | null };
    const target = String(mac || "").toUpperCase();
    if (!MAC_RE.test(target)) return NextResponse.json({ error: 'Missing or invalid "mac".' }, { status: 400 });

    await ensureEspPresent();
    await writeToStation("WELCOME", target);

    // wait for echo only, not full result
    const out = await waitForEchoOrResult({
      signal: req.signal, mac: target, payload: "WELCOME", mode: "result", timeoutMs: 8000
    });

    return NextResponse.json({
      ok: true,
      mac: target,
      kfb: kfb ?? null,
      message: `WELCOME acknowledged for ${target}`,
      telemetry: out,
    });
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
