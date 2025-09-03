// app/api/discover/route.ts
import { NextResponse } from "next/server";
import { getEspLineStream, isEspPresent } from "@/lib/serial";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function extractMac(line) {
    const m = line.toUpperCase().match(/\b([0-9A-F]{2}(?::[0-9A-F]{2}){5})\b/);
    return m?.[1] ?? null;
}
/** Wait forever until: (a) expected MAC + HELLO is seen, or (b) client aborts. */
function waitForExactHelloAbortable(expectedMac, signal) {
    return new Promise((resolve, reject) => {
        const { parser } = getEspLineStream();
        const onData = (buf) => {
            const raw = String(buf).trim();
            if (!raw)
                return;
            const upper = raw.toUpperCase();
            if (!/\bHELLO\b/.test(upper))
                return; // ignore non-HELLO
            const mac = extractMac(upper);
            if (!mac || mac !== expectedMac)
                return; // ignore wrong MAC
            cleanup();
            resolve({ mac, raw: `serial:${raw}` });
        };
        const onAbort = () => {
            cleanup();
            reject(new Error("client-abort"));
        };
        const cleanup = () => {
            try {
                parser.off("data", onData);
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
        parser.on("data", onData);
    });
}
export async function POST(req) {
    try {
        const body = (await req.json().catch(() => ({})));
        const expectedMac = String(body.expectMac ?? process.env.ESP_EXPECT_MAC ?? "08:3A:8D:15:27:54").toUpperCase().trim();
        const present = await isEspPresent().catch(() => false);
        if (!present)
            throw new Error("serial-not-present");
        const { mac, raw } = await waitForExactHelloAbortable(expectedMac, req.signal);
        return NextResponse.json({
            macAddress: mac,
            channel: "serial",
            unexpected: false,
            expected: expectedMac,
            raw,
        });
    }
    catch (e) {
        const msg = String(e?.message ?? e);
        const status = msg === "client-abort" ? 499 :
            msg.includes("serial-not-present") ? 428 :
                500;
        return new NextResponse(JSON.stringify({ error: msg }), {
            status,
            headers: { "Content-Type": "application/json" },
        });
    }
}
