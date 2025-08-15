// app/api/wait-ready/route.ts
import { NextResponse } from "next/server";
import { getEspLineStream, isEspPresent } from "@/lib/serial";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAC_RE = /^[0-9A-F]{2}(?::[0-9A-F]{2}){5}$/;

function extractMac(upperLine: string): string | null {
  const m = upperLine.match(/\b([0-9A-F]{2}(?::[0-9A-F]{2}){5})\b/);
  return m?.[1] ?? null;
}

async function sendWelcomeLine(mac: string) {
  // write "WELCOME <MAC>\n" to the station's serial port
  const { port } = getEspLineStream() as any;
  if (!port || typeof port.write !== "function") throw new Error("serial-port-not-writable");
  await new Promise<void>((resolve, reject) =>
    port.write(`WELCOME ${mac}\n`, (err: any) => (err ? reject(err) : resolve()))
  );
}

function waitForReadyAbortable(signal: AbortSignal, wantMacUpper: string): Promise<{ mac: string; raw: string }> {
  return new Promise((resolve, reject) => {
    const { parser } = getEspLineStream() as any;

    const onData = (buf: Buffer | string) => {
      const raw = String(buf).trim();
      if (!raw) return;
      const upper = raw.toUpperCase();
      if (!upper.includes("READY")) return;
      const mac = extractMac(upper);
      if (!mac || mac !== wantMacUpper) return;
      cleanup();
      resolve({ mac, raw });
    };

    const onAbort = () => { cleanup(); reject(new Error("client-abort")); };

    const cleanup = () => {
      try { parser.off("data", onData); } catch {}
      try { signal.removeEventListener("abort", onAbort); } catch {}
    };

    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort);
    parser.on("data", onData);
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const mac = String(body?.mac || "").toUpperCase();

    if (!MAC_RE.test(mac)) {
      return NextResponse.json({ error: 'Missing or invalid "mac".' }, { status: 400 });
    }

    const present = await isEspPresent().catch(() => false);
    if (!present) {
      return NextResponse.json({ error: "serial-not-present" }, { status: 428 });
    }

    // Optional trigger: send WELCOME to kick off the hub’s READY response
    if (body?.sendWelcome !== false) {
      await sendWelcomeLine(mac);
    }

    const { raw } = await waitForReadyAbortable(req.signal, mac);
    return NextResponse.json({ ok: true, mac, raw, message: `READY received for ${mac}.` });
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    const status = msg === "client-abort" ? 499 : 500;
    return new NextResponse(JSON.stringify({ error: msg }), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }
}
