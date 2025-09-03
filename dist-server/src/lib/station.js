// Centralized station I/O helpers
import { getEspLineStream, isEspPresent } from "@/lib/serial";
export const MAC_RE = /^[0-9A-F]{2}(?::[0-9A-F]{2}){5}$/;
export async function ensureEspPresent() {
    const present = await isEspPresent().catch(() => false);
    if (!present)
        throw new Error("serial-not-present");
}
export async function writeToStation(payload, mac) {
    const target = mac.toUpperCase();
    if (!MAC_RE.test(target))
        throw new Error('invalid-mac');
    const { port } = getEspLineStream(); // { parser, port }
    await new Promise((resolve, reject) => port.write(`${payload} ${target}\n`, (err) => (err ? reject(err) : resolve())));
}
export function waitForEchoOrResult(opts) {
    const { signal, mac, payload, mode } = opts;
    const timeoutMs = opts.timeoutMs ?? 15000;
    if (mode === "none") {
        return Promise.resolve({ event: "echo", reply: "", lines: [] });
    }
    return new Promise((resolve, reject) => {
        const { parser } = getEspLineStream();
        const lines = [];
        let timer;
        const done = (value, err) => {
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
            if (err)
                reject(err);
            else
                resolve(value);
        };
        const onAbort = () => done(undefined, new Error("client-abort"));
        const onTimeout = () => done(undefined, new Error("timeout"));
        const isResultReply = (s) => /\b(SUCCESS|FAILURE)\b/.test(s.toUpperCase());
        const onData = (buf) => {
            const raw = String(buf).trim();
            if (!raw)
                return;
            lines.push(raw);
            const upper = raw.toUpperCase();
            // Gate by expected MAC if present in line
            const macMatch = upper.match(/\b([0-9A-F]{2}(?::[0-9A-F]{2}){5})\b/);
            if (macMatch && macMatch[1] !== mac)
                return;
            // Fast-path: station prints the hub's reply
            // Formats we handle:
            //  - "← reply from <MAC>: <reply>"
            //  - "← RESULT: <reply>"
            //  - "← RESULT (no echo): <reply>"
            //  - "✅ ECHO OK"
            if (mode === "echo" && /ECHO OK/i.test(raw)) {
                return done({ event: "echo", reply: "ECHO OK", lines });
            }
            if (mode === "result") {
                // Any line that contains SUCCESS/FAILURE is a terminal result
                if (isResultReply(raw)) {
                    // try to capture the payload after colon if present
                    const afterColon = raw.split(":").slice(1).join(":").trim();
                    const reply = afterColon || raw;
                    return done({ event: "result", reply, lines });
                }
            }
            // Edge case: if payload was CHECK, hub may skip echo and go straight to result
            if (payload.toUpperCase() === "CHECK" && isResultReply(raw)) {
                const afterColon = raw.split(":").slice(1).join(":").trim();
                const reply = afterColon || raw;
                return done({ event: "result", reply, lines });
            }
            // Mismatch is a hard error to surface
            if (/MISMATCH/i.test(raw)) {
                return done(undefined, new Error("echo-mismatch"));
            }
        };
        if (signal.aborted)
            return onAbort();
        signal.addEventListener("abort", onAbort);
        parser.on("data", onData);
        timer = setTimeout(onTimeout, timeoutMs);
    });
}
