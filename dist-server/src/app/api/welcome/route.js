// app/api/welcome/route.ts
import { NextResponse } from "next/server";
import { getEspLineStream, isEspPresent } from "@/lib/serial";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAC_RE = /^[0-9A-F]{2}(?::[0-9A-F]{2}){5}$/i;
let inFlight = false;
function writeWithTimeout(port, data, ms = 1500) {
    return new Promise((resolve, reject) => {
        let done = false;
        const to = setTimeout(() => { if (!done) {
            done = true;
            reject(new Error("serial-write-timeout"));
        } }, ms);
        port.write(data, (err) => {
            if (done)
                return;
            clearTimeout(to);
            done = true;
            if (err)
                reject(err);
            else
                resolve();
        });
    });
}
// drain but never block the request: resolve after `ms` even if callback never fires
function drainSoft(port, ms = 300) {
    if (typeof port?.drain !== "function")
        return Promise.resolve();
    return new Promise((resolve) => {
        let settled = false;
        const to = setTimeout(() => { if (!settled) {
            settled = true;
            resolve();
        } }, ms);
        port.drain(() => {
            if (settled)
                return;
            clearTimeout(to);
            settled = true;
            resolve();
        });
    });
}
async function writeWelcome(mac) {
    const { port } = getEspLineStream();
    if (!port || typeof port.write !== "function")
        throw new Error("serial-not-present");
    await writeWithTimeout(port, `WELCOME ${mac}\n`); // bounded write
    await drainSoft(port); // non-blocking drain
}
function waitForAck(signal, wantMacUpper, softTimeoutMs = 10000) {
    const MAC_ANY = /([0-9A-F]{2}(?::[0-9A-F]{2}){5})/i;
    const parse = (rawIn) => {
        const raw = String(rawIn).trim();
        if (!raw)
            return null;
        const status = /\b(READY|TIMEOUT)\b/i.exec(raw)?.[1]?.toUpperCase();
        const macFromAnywhere = MAC_ANY.exec(raw)?.[1]?.toUpperCase() || null;
        const hasWelcome = /\bWELCOME\b/i.test(raw);
        const hasAckWelcome = /\bACK\b/i.test(raw) && /\bWELCOME\b/i.test(raw);
        return { raw, mac: macFromAnywhere, status, hasWelcome, hasAckWelcome };
    };
    return new Promise((resolve, reject) => {
        const { parser, ring } = getEspLineStream();
        for (let i = ring.length - 1; i >= 0; i--) {
            const p = parse(ring[i]);
            if (!p)
                continue;
            if (p.hasAckWelcome && p.status)
                return resolve({ hubMac: p.mac || wantMacUpper, status: p.status, raw: p.raw });
            if (p.hasWelcome) {
                for (let j = i + 1; j < ring.length; j++) {
                    const q = parse(ring[j]);
                    if (q?.status)
                        return resolve({ hubMac: q.mac || wantMacUpper, status: q.status, raw: `${p.raw}\n${q.raw}` });
                }
            }
        }
        let armed = false, lastWelcome = null;
        const onData = (buf) => {
            const p = parse(buf);
            if (!p)
                return;
            if (p.hasAckWelcome && p.status) {
                cleanup();
                return resolve({ hubMac: p.mac || wantMacUpper, status: p.status, raw: p.raw });
            }
            if (p.hasWelcome) {
                armed = true;
                lastWelcome = p.raw;
                return;
            }
            if (p.status) {
                cleanup();
                return resolve({ hubMac: p.mac || wantMacUpper, status: p.status, raw: lastWelcome ? `${lastWelcome}\n${p.raw}` : p.raw });
            }
        };
        const onAbort = () => { cleanup(); reject(new Error("client-abort")); };
        const onTimeout = () => { cleanup(); reject(new Error("timeout")); };
        const cleanup = () => { try {
            parser?.off?.("data", onData);
        }
        catch { } try {
            signal.removeEventListener("abort", onAbort);
        }
        catch { } if (t)
            clearTimeout(t); };
        if (signal.aborted)
            return onAbort();
        signal.addEventListener("abort", onAbort);
        if (typeof parser?.prependListener === "function")
            parser.prependListener("data", onData);
        else
            parser?.on?.("data", onData);
        const t = setTimeout(onTimeout, softTimeoutMs);
    });
}
export async function POST(req) {
    if (inFlight)
        return NextResponse.json({ error: "busy" }, { status: 429 });
    inFlight = true;
    try {
        const body = await req.json().catch(() => ({}));
        const mac = String(body?.mac || "").toUpperCase();
        if (!MAC_RE.test(mac))
            return NextResponse.json({ error: 'Missing or invalid "mac".' }, { status: 400 });
        const present = await isEspPresent().catch(() => false);
        if (!present)
            return NextResponse.json({ error: "serial-not-present" }, { status: 428 });
        const waitP = waitForAck(req.signal, mac, 10000);
        await writeWelcome(mac); // will not hang on drain
        const { hubMac, status, raw } = await waitP;
        if (status === "READY")
            return NextResponse.json({ ok: true, mac, hubMac, message: `WELCOME ACK from hub ${hubMac} (READY)`, raw });
        return NextResponse.json({ error: "timeout", mac, hubMac, raw }, { status: 504 });
    }
    catch (e) {
        const msg = String(e?.message ?? e);
        const status = msg === "client-abort" ? 499 : msg === "serial-not-present" ? 428 : msg === "timeout" ? 504 : msg === "serial-write-timeout" ? 504 : 500;
        return new NextResponse(JSON.stringify({ error: msg }), { status, headers: { "Content-Type": "application/json" } });
    }
    finally {
        inFlight = false;
    }
}
