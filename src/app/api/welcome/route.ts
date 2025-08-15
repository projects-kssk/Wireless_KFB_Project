// app/api/welcome/route.ts
import { NextResponse } from "next/server";
import { getEspLineStream, isEspPresent } from "@/lib/serial";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAC_RE = /^[0-9A-F]{2}(?::[0-9A-F]{2}){5}$/i;
const ACK_LINE_RE = /^ACK\s+WELCOME\s+([0-9A-F]{2}(?::[0-9A-F]{2}){5})\s+(READY|TIMEOUT)\s*$/i;
const WELCOME_RE  = /^WELCOME\s+([0-9A-F]{2}(?::[0-9A-F]{2}){5})\s*$/i;
const STATUS_RE   = /^(READY|TIMEOUT)\s*$/i;

let inFlight = false;

async function writeWelcome(mac: string) {
  const { port } = getEspLineStream() as any;
  if (!port || typeof port.write !== "function") throw new Error("serial-not-present");
  await new Promise<void>((resolve, reject) =>
    port.write(`WELCOME ${mac}\n`, (err: any) => (err ? reject(err) : resolve()))
  );
  if (typeof (port as any).drain === "function") {
    await new Promise<void>((resolve, reject) =>
      (port as any).drain((err: any) => (err ? reject(err) : resolve()))
    );
  }
}

function waitForAck(signal: AbortSignal, wantMacUpper: string, softTimeoutMs = 10_000) {
  type StatusT = "READY" | "TIMEOUT";
  const MAC_ANY = /([0-9A-F]{2}(?::[0-9A-F]{2}){5})/i;

  const parse = (rawIn: Buffer | string) => {
    const raw = String(rawIn).trim();
    if (!raw) return null;
    const status = /\b(READY|TIMEOUT)\b/i.exec(raw)?.[1]?.toUpperCase() as StatusT | undefined;
    const macFromAnywhere = MAC_ANY.exec(raw)?.[1]?.toUpperCase() || null;
    const macFromPrefix = /reply\s+from\s+([0-9A-F:]{17})/i.exec(raw)?.[1]?.toUpperCase() || null;
    const mac = macFromAnywhere || macFromPrefix;
    const hasWelcome = /\bWELCOME\b/i.test(raw);
    const hasAckWelcome = /\bACK\b/i.test(raw) && /\bWELCOME\b/i.test(raw);
    return { raw, mac, status, hasWelcome, hasAckWelcome };
  };

  return new Promise<{ hubMac: string; status: StatusT; raw: string }>((resolve, reject) => {
    const { parser, ring } = getEspLineStream() as any;

    for (let i = ring.length - 1; i >= 0; i--) {
      const p = parse(ring[i]);
      if (!p) continue;
      if (p.hasAckWelcome && p.status) {
        if (p.status === "READY" && p.mac !== wantMacUpper) continue;
        return resolve({ hubMac: p.mac || wantMacUpper, status: p.status, raw: p.raw });
      }
    }

    let armedForReady = false;
    let lastWelcomeRaw: string | null = null;

    const onData = (buf: Buffer | string) => {
      const p = parse(buf);
      if (!p) return;

      if (p.hasAckWelcome && p.status) {
        if (p.status === "READY" && p.mac && p.mac !== wantMacUpper) return;
        cleanup();
        return resolve({ hubMac: p.mac || wantMacUpper, status: p.status, raw: p.raw });
      }

      if (p.hasWelcome && (p.mac ? p.mac === wantMacUpper : true)) {
        armedForReady = true;
        lastWelcomeRaw = p.raw;
        return;
      }

      if (p.status) {
        if (p.mac && p.mac !== wantMacUpper && !armedForReady) return;
        cleanup();
        const rawCombined = lastWelcomeRaw ? `${lastWelcomeRaw}\n${p.raw}` : p.raw;
        return resolve({ hubMac: p.mac || wantMacUpper, status: p.status, raw: rawCombined });
      }
    };

    const onAbort = () => { cleanup(); reject(new Error("client-abort")); };
    const onTimeout = () => { cleanup(); reject(new Error("timeout")); };

    let timer: NodeJS.Timeout | null = null;
    const cleanup = () => {
      try { parser.off("data", onData); } catch {}
      try { signal.removeEventListener("abort", onAbort); } catch {}
      if (timer) clearTimeout(timer);
    };

    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort);

    if (typeof (parser as any).prependListener === "function") {
      (parser as any).prependListener("data", onData);
    } else {
      parser.on("data", onData);
    }

    timer = setTimeout(onTimeout, softTimeoutMs);
  });
}

export async function POST(req: Request) {
  if (inFlight) return NextResponse.json({ error: "busy" }, { status: 429 });
  inFlight = true;
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

    const waitP = waitForAck((req as any).signal, mac, 10_000);
    await writeWelcome(mac);
    const { hubMac, status, raw } = await waitP;

    if (status === "READY") {
      return NextResponse.json({ ok: true, mac, hubMac, message: `WELCOME ACK from hub ${hubMac} (READY)`, raw });
    }
    return NextResponse.json({ error: "timeout", mac, hubMac, raw }, { status: 504 });
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    const status =
      msg === "client-abort" ? 499 :
      msg === "serial-not-present" ? 428 :
      msg === "timeout" ? 504 :
      500;

    return new NextResponse(JSON.stringify({ error: msg }), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  } finally {
    inFlight = false;
  }
}
