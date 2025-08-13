// app/api/discover/route.ts
import { NextResponse } from "next/server";
import { getEspLineStream, isEspPresent } from "@/lib/serial";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function extractMac(line: string): string | null {
  const m = line.toUpperCase().match(/\b([0-9A-F]{2}(?::[0-9A-F]{2}){5})\b/);
  return m?.[1] ?? null;
}

/** Wait indefinitely for any MAC + HELLO. Abort when client closes. */
function waitForHelloAbortable(signal: AbortSignal): Promise<{ mac: string; raw: string }> {
  return new Promise((resolve, reject) => {
    const { parser } = getEspLineStream();

    const onData = (buf: Buffer | string) => {
      const raw = String(buf).trim();
      if (!raw) return;
      const upper = raw.toUpperCase();

      if (!/\bHELLO\b/.test(upper)) return;           // ignore non-HELLO lines
      const mac = extractMac(upper);
      if (!mac) return;                               // require a MAC in the line

      cleanup();
      resolve({ mac, raw: `serial:${raw}` });
    };

    const onAbort = () => {
      cleanup();
      reject(new Error("client-abort"));
    };

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
    const present = await isEspPresent().catch(() => false);
    if (!present) throw new Error("serial-not-present");

    const { mac, raw } = await waitForHelloAbortable(req.signal);

    return NextResponse.json({
      macAddress: mac.toUpperCase(),
      channel: "serial",
      raw,
    });
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    const status =
      msg === "client-abort" ? 499 :
      msg.includes("serial-not-present") ? 428 :
      500;

    return new NextResponse(JSON.stringify({ error: msg }), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }
}
