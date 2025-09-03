// app/api/discover/route.ts
import { NextResponse } from "next/server";
import { getEspLineStream, isEspPresent } from "@/lib/serial";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function extractMac(line) {
    const m = line.toUpperCase().match(/\b([0-9A-F]{2}(?::[0-9A-F]{2}){5})\b/);
    return m?.[1] ?? null;
}
/** Wait for "HELLO" (this line or a recent one) + a MAC. */
function waitForHelloAbortable(signal) {
    return new Promise((resolve, reject) => {
        const { parser } = getEspLineStream();
        let helloSeenAt = 0;
        const onData = (buf) => {
            const raw = String(buf).trim();
            if (!raw)
                return;
            const upper = raw.toUpperCase();
            // mark when we saw HELLO
            if (/\bHELLO\b/.test(upper))
                helloSeenAt = Date.now();
            // grab any MAC
            const mac = extractMac(upper);
            if (!mac)
                return;
            // accept if same line had HELLO, or HELLO seen very recently
            if (/\bHELLO\b/.test(upper) || Date.now() - helloSeenAt < 1500) {
                cleanup();
                resolve({ mac: mac.toUpperCase(), raw: `serial:${raw}` });
            }
        };
        const onAbort = () => { cleanup(); reject(new Error("client-abort")); };
        const cleanup = () => {
            try {
                parser.off?.("data", onData);
            }
            catch { }
            try {
                signal.removeEventListener("abort", onAbort);
            }
            catch { }
        };
        if (signal.aborted)
            return onAbort();
        signal.addEventListener("abort", onAbort);
        // ensure our listener gets called first if others exist
        if (parser.prependListener)
            parser.prependListener("data", onData);
        else
            parser.on("data", onData);
    });
}
export async function POST(req) {
    try {
        const present = await isEspPresent().catch(() => false);
        if (!present)
            return NextResponse.json({ error: "serial-not-present" }, { status: 428 });
        const { mac, raw } = await waitForHelloAbortable(req.signal);
        return NextResponse.json({ macAddress: mac, channel: "serial", raw });
    }
    catch (e) {
        const msg = String(e?.message ?? e);
        const status = msg === "client-abort" ? 499 : 500;
        return new NextResponse(JSON.stringify({ error: msg }), {
            status,
            headers: { "Content-Type": "application/json" },
        });
    }
}
//# sourceMappingURL=route.js.map