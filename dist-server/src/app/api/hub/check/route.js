import { NextResponse } from "next/server";
import { getEspLineStream, isEspPresent } from "@/lib/serial";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Accept upper/lowercase
const MAC_RE = /^[0-9A-F]{2}(?::[0-9A-F]{2}){5}$/i;
function parseNums(s) {
    return s.split(",").map(x => parseInt(x.trim(), 10)).filter(n => Number.isFinite(n));
}
// Understand all result flavors:
// "SUCCESS"
// "FAILURES: 1,2"
// "FAILURE MISSING 1,2"
// "FAILURE MISSING 1,2 ;EXTRA 3,4"
// "← RESULT: FAILURE MISSING 1,2 ;EXTRA 3"
function parseResult(line) {
    const upper = line.toUpperCase();
    if (/\bSUCCESS\b/.test(upper))
        return { ok: true, missing: [], extra: [] };
    // FAILURES: 1,2
    const m1 = upper.match(/FAILURES:\s*([0-9,\s]+)/);
    if (m1)
        return { ok: false, missing: parseNums(m1[1]), extra: [] };
    // FAILURE [MISSING <...>] [;EXTRA <...>]
    const m2 = upper.match(/FAILURE(?:\s+MISSING\s+([0-9,\s]+))?(?:\s*;?\s*EXTRA\s+([0-9,\s]+))?/);
    if (m2) {
        return {
            ok: false,
            missing: m2[1] ? parseNums(m2[1]) : [],
            extra: m2[2] ? parseNums(m2[2]) : [],
        };
    }
    return null;
}
async function writeLine(line) {
    const { port } = getEspLineStream(); // { parser, port }
    await new Promise((resolve, reject) => port.write(line, (e) => (e ? reject(e) : resolve())));
}
function waitForResult(signal, mac, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
        const { parser } = getEspLineStream();
        let timer;
        const done = (val, err) => {
            try {
                parser.off("data", onData);
            }
            catch { }
            try {
                signal.removeEventListener("abort", onAbort);
            }
            catch { }
            if (timer)
                clearTimeout(timer);
            err ? reject(err) : resolve(val);
        };
        const onAbort = () => done(undefined, new Error("client-abort"));
        const onTimeout = () => done(undefined, new Error("timeout"));
        const onData = (buf) => {
            const raw = String(buf).trim();
            if (!raw)
                return;
            // If a MAC appears in the line, gate on it
            const macMatch = raw.toUpperCase().match(/\b([0-9A-F]{2}(?::[0-9A-F]{2}){5})\b/);
            if (macMatch && macMatch[1] !== mac)
                return;
            const parsed = parseResult(raw);
            if (parsed)
                return done({ raw, parsed });
        };
        if (signal.aborted)
            return onAbort();
        signal.addEventListener("abort", onAbort);
        parser.on("data", onData);
        timer = setTimeout(onTimeout, timeoutMs);
    });
}
export async function POST(req) {
    try {
        const { mac, pins } = (await req.json().catch(() => ({})));
        const target = String(mac || "").toUpperCase();
        if (!MAC_RE.test(target)) {
            return NextResponse.json({ error: 'Missing or invalid "mac".' }, { status: 400 });
        }
        // Pins are hub concern only; they are not sent to the station.
        // You can still validate/store `pins` here if your hub needs them.
        if (!Array.isArray(pins)) {
            // Optional: enforce if your client always sends pins
            // return NextResponse.json({ error: 'Missing "pins".' }, { status: 400 });
        }
        const present = await isEspPresent().catch(() => false);
        if (!present)
            return NextResponse.json({ error: "serial-not-present" }, { status: 428 });
        // Drive the station protocol: "<payload> <MAC>\n"
        await writeLine(`CHECK ${target}\n`);
        const { raw, parsed } = await waitForResult(req.signal, target);
        // Preserve your old response shape
        const body = { failures: parsed.ok ? [] : parsed.missing };
        if (parsed.extra.length)
            body.extra = parsed.extra;
        return NextResponse.json({ ...body, raw });
    }
    catch (e) {
        const msg = String(e?.message ?? e);
        const status = msg === "client-abort" ? 499 :
            msg === "timeout" ? 504 :
                msg === "serial-not-present" ? 428 :
                    500;
        return new NextResponse(JSON.stringify({ error: msg }), { status, headers: { "Content-Type": "application/json" } });
    }
}
//# sourceMappingURL=route.js.map