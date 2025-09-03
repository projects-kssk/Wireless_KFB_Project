import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import { DOMParser as Xmldom } from "@xmldom/xmldom";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/* ===== Env ===== */
const RAW_ORIGINS = process.env.KROSY_CLIENT_ORIGINS ?? "*";
const ORIGINS = RAW_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);
const ALLOW_ANY = RAW_ORIGINS.trim() === "*";
const LOG_DIR = process.env.KROSY_LOG_DIR || path.join(process.cwd(), ".krosy-logs");
const XML_TARGET = (process.env.KROSY_XML_TARGET || "ksskkfb01").trim();
const DEFAULT_CONNECT = (process.env.KROSY_CONNECT_HOST || "172.26.192.1:10080").trim(); // request leg (TCP)
const TCP_PORT = Number(process.env.KROSY_TCP_PORT || 10080);
const TCP_TIMEOUT_MS = Number(process.env.KROSY_TCP_TIMEOUT_MS || 10000);
/** newline | fin | null | none */
const TCP_TERMINATOR = (process.env.KROSY_TCP_TERMINATOR || "newline").toLowerCase();
/** NEW: checkpoint leg can be HTTP */
const DEFAULT_CHECKPOINT_URL = (process.env.KROSY_RESULT_URL || "http://localhost:3001/api/checkpoint").trim();
/* ===== VC NS ===== */
const VC_NS_V01 = "http://www.kroschu.com/kroscada/namespaces/krosy/visualcontrol/V_0_1";
const FORCE_RESULT_RAW = (process.env.KROSY_FORCE_CHECKPOINT_RESULT || "").trim().toLowerCase();
const FORCE_RESULT = ["ok", "true", "1"].includes(FORCE_RESULT_RAW) ? true :
    ["nok", "false", "0"].includes(FORCE_RESULT_RAW) ? false :
        null; // null => don't force; default to OK below
const b2s = (b) => (b ? "true" : "false");
/* ===== CORS ===== */
function cors(req) {
    const origin = req.headers.get("origin") || "";
    const allow = ALLOW_ANY ? "*" : ORIGINS.includes(origin) ? origin : ORIGINS[0] || "";
    return {
        "Access-Control-Allow-Origin": allow,
        Vary: "Origin",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Accept",
    };
}
/* ===== Utils ===== */
const isoNoMs = (d = new Date()) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
const nowStamp = () => isoNoMs().replace(/[:T]/g, "-").replace("Z", "");
async function ensureDir(p) { await fs.mkdir(p, { recursive: true }); }
async function writeLog(base, name, content) {
    await ensureDir(base);
    await fs.writeFile(path.join(base, name), content ?? "", "utf8");
}
async function pruneOldLogs(root, maxAgeDays = 31) {
    try {
        const now = Date.now();
        const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
        const entries = await fs.readdir(root, { withFileTypes: true });
        for (const ent of entries) {
            if (!ent.isDirectory())
                continue;
            const dirPath = path.join(root, ent.name);
            let ts = 0;
            const m = ent.name.match(/^(\d{4})-(\d{2})$/);
            if (m) {
                const y = Number(m[1]);
                const mon = Number(m[2]);
                ts = new Date(Date.UTC(y, mon - 1, 1)).getTime();
            }
            else {
                const st = await fs.stat(dirPath);
                ts = st.mtimeMs || st.ctimeMs || 0;
            }
            if (now - ts > maxAgeMs) {
                try {
                    await fs.rm(dirPath, { recursive: true, force: true });
                }
                catch { }
            }
        }
    }
    catch { }
}
function pickIpAndMac() {
    const want = (process.env.KROSY_NET_IFACE || "").trim();
    const rows = [];
    for (const [name, arr] of Object.entries(os.networkInterfaces()))
        for (const ni of arr || [])
            rows.push({ name, ...ni });
    const candidates = rows.filter((r) => !r.internal && r.family === "IPv4" && r.address && !/^169\.254\./.test(r.address || ""));
    const chosen = (want && candidates.find((r) => r.name === want)) ||
        candidates.find((r) => ["eth0", "en0", "ens160", "ens192"].includes(r.name)) ||
        candidates[0];
    const addr = chosen?.address || "0.0.0.0";
    const mac = (chosen?.mac || "00:00:00:00:00:00").toUpperCase().replace(/:/g, "-");
    return { ip: addr, mac };
}
function parseHostPort(raw, defPort) {
    let host = raw, port = defPort;
    const m = raw.match(/^\[?([^\]]+)\]:(\d+)$/);
    if (m) {
        host = m[1];
        port = Number(m[2]);
    }
    return { host, port };
}
function prettyXml(xml) {
    try {
        const compact = xml.replace(/\r?\n/g, "").replace(/>\s+</g, "><").trim();
        const withNl = compact.replace(/(>)(<)(\/*)/g, "$1\n$2$3");
        let indent = 0;
        const out = [];
        for (const raw of withNl.split("\n")) {
            const line = raw.trim();
            if (line.startsWith("</"))
                indent = Math.max(indent - 1, 0);
            out.push("  ".repeat(indent) + line);
            if (/^<[^!?\/][^>]*[^\/]>$/.test(line))
                indent++;
        }
        return out.join("\n");
    }
    catch {
        return xml;
    }
}
const xmlEsc = (s) => String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
/* ===== Transports ===== */
function sendTcp(host, port, xml) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        let buf = "";
        let done = false;
        const used = `tcp://${host}:${port}`;
        const payload = TCP_TERMINATOR === "newline" ? xml + "\n" :
            TCP_TERMINATOR === "null" ? xml + "\0" : xml;
        const finish = (ok, status = 200, err = null) => {
            if (done)
                return;
            done = true;
            try {
                socket.destroy();
            }
            catch { }
            resolve({ ok, status, text: buf, error: err, used });
        };
        socket.setNoDelay(true);
        socket.setTimeout(TCP_TIMEOUT_MS);
        socket.connect(port, host, () => {
            socket.write(payload);
            if (TCP_TERMINATOR === "fin")
                socket.end();
        });
        socket.on("data", (c) => {
            buf += c.toString("utf8");
            const s = buf.trim().toLowerCase();
            if (s === "ack" || s.endsWith("</krosy>"))
                finish(true, 200, null);
        });
        socket.on("end", () => { if (buf.length)
            finish(true);
        else
            finish(false, 0, "no data"); });
        socket.on("timeout", () => finish(false, 0, "tcp timeout"));
        socket.on("error", (e) => finish(false, 0, e?.message || "tcp error"));
    });
}
async function sendHttp(url, xml) {
    try {
        const r = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/xml",
                "Accept": "application/xml,application/json;q=0.9,*/*;q=0.1",
            },
            body: xml,
        });
        const text = await r.text();
        return { ok: r.ok, status: r.status, text, error: r.ok ? null : `http ${r.status}`, used: url };
    }
    catch (e) {
        return { ok: false, status: 0, text: "", error: e?.message || "http error", used: url };
    }
}
function pickCheckpointTarget(raw, defPort) {
    if (/^https?:\/\//i.test(raw))
        return { kind: "http", url: raw };
    const { host, port } = parseHostPort(raw, defPort);
    return { kind: "tcp", host, port };
}
const firstDesc = (n, local) => {
    const stack = [n];
    while (stack.length) {
        const cur = stack.pop();
        if (cur?.localName === local)
            return cur;
        const kids = cur?.childNodes || [];
        for (let i = kids.length - 1; i >= 0; i--)
            stack.push(kids[i]);
    }
    return null;
};
const textOf = (n, local, dflt = "") => (firstDesc(n, local)?.textContent ?? dflt).trim();
const childrenByLocal = (n, local) => {
    const out = [];
    const kids = n?.childNodes || [];
    for (let i = 0; i < kids.length; i++)
        if (kids[i]?.localName === local)
            out.push(kids[i]);
    return out;
};
/* ===== XML builders ===== */
function buildWorkingRequestXML(args) {
    const { requestID, srcHost, targetHost, scanned, ip, mac, intksk } = args;
    return (`<krosy xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="${VC_NS_V01}" xmlns:xsd="http://www.w3.org/2001/XMLSchema">` +
        `<header><requestID>${xmlEsc(requestID)}</requestID><sourceHost><hostname>${xmlEsc(srcHost)}</hostname><ipAddress>${xmlEsc(ip)}</ipAddress><macAddress>${xmlEsc(mac)}</macAddress></sourceHost><targetHost><hostname>${xmlEsc(targetHost)}</hostname></targetHost></header>` +
        `<body><visualControl><workingRequest intksk="${xmlEsc(intksk)}" scanned="${xmlEsc(scanned)}" device="${xmlEsc(srcHost)}"/></visualControl></body>` +
        `</krosy>`);
}
function buildWorkingResultFromWorkingData(workingDataXml, overrides, opts) {
    const parser = new Xmldom({ errorHandler: { warning() { }, error() { }, fatalError() { } } });
    const normalizeBooleanAttrs = (xml) => xml.replace(/(\s(?:allowed|status))(?!\s*=\s*["'])/gi, '$1="true"');
    const fixedXml = normalizeBooleanAttrs(workingDataXml || '');
    const doc = parser.parseFromString(fixedXml, "text/xml");
    const forced = opts?.forceResult ?? null; // true / false / null
    const resultStr = b2s(forced ?? true); // default to "true" (OK)
    const header = firstDesc(doc, "header");
    if (!header)
        throw new Error("No <header> in workingData XML");
    const requestID = overrides?.requestID || textOf(header, "requestID", String(Date.now()));
    const srcHostname_prev = textOf(firstDesc(header, "sourceHost"), "hostname", "unknown-source");
    const tgtHostname_prev = textOf(firstDesc(header, "targetHost"), "hostname", "unknown-target");
    const workingData = firstDesc(doc, "workingData");
    if (!workingData)
        throw new Error("No <workingData> found in response");
    const device = workingData.getAttribute("device") || tgtHostname_prev;
    const intksk = workingData.getAttribute("intksk") || "";
    const scanned = workingData.getAttribute("scanned") || isoNoMs();
    const resultTime = overrides?.resultTimeIso || isoNoMs();
    // Sequencer
    const sequencer = firstDesc(workingData, "sequencer");
    let segmentsOut = "";
    let segCount = 0;
    if (sequencer) {
        const segList = firstDesc(sequencer, "segmentList") || sequencer;
        const segments = childrenByLocal(segList, "segment");
        segCount = segments.length;
        for (const seg of segments) {
            const segIdx = seg.getAttribute("index") || "";
            const segName = seg.getAttribute("name") || segIdx || "1";
            const seqListNode = firstDesc(seg, "sequenceList") || seg;
            const sequences = childrenByLocal(seqListNode, "sequence");
            let seqOut = "";
            for (const seq of sequences) {
                const idx = seq.getAttribute("index") || "";
                const compType = seq.getAttribute("compType") || "";
                const reference = seq.getAttribute("reference") || "";
                const objGroup = textOf(seq, "objGroup", "");
                const objPos = textOf(seq, "objPos", "");
                seqOut += `<sequence index="${xmlEsc(idx)}" compType="${xmlEsc(compType)}" reference="${xmlEsc(reference)}" result="${resultStr}">` +
                    (objGroup ? `<objGroup>${xmlEsc(objGroup)}</objGroup>` : ``) +
                    (objPos ? `<objPos>${xmlEsc(objPos)}</objPos>` : ``) +
                    `</sequence>`;
            }
            segmentsOut += `<segmentResult index="${xmlEsc(segIdx)}" name="${xmlEsc(segName)}" result="${resultStr}" resultTime="${xmlEsc(resultTime)}">` +
                `<sequenceList count="${sequences.length}">${seqOut}</sequenceList>` +
                `</segmentResult>`;
        }
    }
    // Component clips
    const component = firstDesc(workingData, "component");
    let clipResultsOut = "";
    let clipCount = 0;
    if (component) {
        const clipList = firstDesc(component, "clipList");
        const clips = clipList ? childrenByLocal(clipList, "clip") : [];
        clipCount = clips.length;
        for (const clip of clips) {
            const idx = clip.getAttribute("index") || "";
            clipResultsOut += `<clipResult index="${xmlEsc(idx)}" result="${resultStr}" />`;
        }
    }
    const { ip, mac } = pickIpAndMac();
    const sourceIp = overrides?.sourceIp || ip;
    const sourceMac = overrides?.sourceMac || mac;
    const xml = `<krosy xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns="${VC_NS_V01}">` +
        `<header>` +
        `<requestID>${xmlEsc(requestID)}</requestID>` +
        `<sourceHost><hostname>${xmlEsc(device)}</hostname><ipAddress>${xmlEsc(sourceIp)}</ipAddress><macAddress>${xmlEsc(sourceMac)}</macAddress></sourceHost>` +
        `<targetHost><hostname>${xmlEsc(srcHostname_prev)}</hostname></targetHost>` +
        `</header>` +
        `<body><visualControl>` +
        `<workingResult device="${xmlEsc(device)}" intksk="${xmlEsc(intksk)}" scanned="${xmlEsc(scanned)}" result="${resultStr}" resultTime="${xmlEsc(resultTime)}">` +
        (segCount ? `<sequencerResult><segmentResultList count="${segCount}">${segmentsOut}</segmentResultList></sequencerResult>` : ``) +
        (clipCount ? `<componentResult><clipResultList count="${clipCount}">${clipResultsOut}</clipResultList></componentResult>` : ``) +
        `</workingResult>` +
        `</visualControl></body>` +
        `</krosy>`;
    return { xml, meta: { requestID, device, intksk, scanned, resultTime, toHost: srcHostname_prev } };
}
/* ===== Handlers ===== */
export async function OPTIONS(req) {
    return new Response(null, { status: 204, headers: cors(req) });
}
export async function GET(req) {
    const { ip, mac } = pickIpAndMac();
    return new Response(JSON.stringify({ hostname: os.hostname(), ip, mac }), {
        status: 200, headers: { "Content-Type": "application/json", ...cors(req) },
    });
}
export async function POST(req) {
    const accept = req.headers.get("accept") || "application/json";
    const body = (await req.json().catch(() => ({})));
    // Request leg (always TCP)
    const connectRaw = String(body.targetAddress || DEFAULT_CONNECT).trim();
    const { host: connectHost, port: tcpPort } = parseHostPort(connectRaw, TCP_PORT);
    // Checkpoint leg can be HTTP or TCP
    const checkpointRaw = String(body.checkpointUrl || DEFAULT_CHECKPOINT_URL || connectRaw).trim();
    const checkpointTarget = pickCheckpointTarget(checkpointRaw, tcpPort);
    const stamp = nowStamp();
    const reqId = String(body.requestID || Date.now());
    const cur = new Date();
    const month = `${cur.getUTCFullYear()}-${String(cur.getUTCMonth() + 1).padStart(2, '0')}`;
    const base = path.join(LOG_DIR, month, `${stamp}_${reqId}`);
    let workingDataXml = body.workingDataXml || null;
    const startedAll = Date.now();
    // If no workingData: perform offline request leg over TCP to obtain it
    if (!workingDataXml) {
        const intksk = String(body.intksk || "830569527900");
        const sourceHostname = String(body.sourceHostname || os.hostname());
        const xmlTargetHost = String(body.targetHostName || XML_TARGET).trim();
        const { ip, mac } = pickIpAndMac();
        const scanned = isoNoMs();
        const reqXml = buildWorkingRequestXML({
            requestID: reqId, srcHost: sourceHostname, targetHost: xmlTargetHost, scanned, ip, mac, intksk,
        });
        const prettyReq = prettyXml(reqXml);
        const t1 = Date.now();
        const reqOut = await sendTcp(connectHost, tcpPort, reqXml);
        const dur1 = Date.now() - t1;
        let reqRespPretty = null;
        try {
            if (reqOut.text && reqOut.text.trim().startsWith("<"))
                reqRespPretty = prettyXml(reqOut.text);
        }
        catch { }
        await Promise.all([
            writeLog(base, "1_request.workingRequest.xml", reqXml),
            writeLog(base, "1_request.workingRequest.pretty.xml", prettyReq),
            writeLog(base, "1_response.workingData.xml", reqOut.text || ""),
            writeLog(base, "1_response.workingData.pretty.xml", reqRespPretty || (reqOut.text || "")),
            writeLog(base, "1_meta.request.json", JSON.stringify({
                leg: "request", requestID: reqId, device: sourceHostname, xmlTargetHost, intksk,
                connect: { host: connectHost, tcpPort, used: reqOut.used },
                durationMs: dur1, ok: reqOut.ok, error: reqOut.error, status: reqOut.status,
                terminator: TCP_TERMINATOR, timeoutMs: TCP_TIMEOUT_MS,
            }, null, 2)),
        ]);
        if (!reqOut.ok || !reqOut.text?.trim().startsWith("<")) {
            return new Response(JSON.stringify({
                ok: false, phase: "workingRequest", requestID: reqId, usedUrl: reqOut.used,
                status: reqOut.status, durationMs: dur1, error: reqOut.error || "no xml response",
                responsePreview: (reqRespPretty || reqOut.text || "").slice(0, 2000),
            }, null, 2), { status: 502, headers: { "Content-Type": "application/json", ...cors(req) } });
        }
        workingDataXml = reqOut.text;
    }
    // Build workingResult and send checkpoint back via chosen transport
    let resultXml;
    let meta;
    try {
        ({ xml: resultXml, meta } = buildWorkingResultFromWorkingData(workingDataXml, { requestID: reqId }));
    }
    catch (e) {
        await writeLog(base, "2_error.build.json", JSON.stringify({ error: e?.message || String(e) }, null, 2));
        return new Response(JSON.stringify({ ok: false, phase: "buildWorkingResult", error: e?.message || String(e) }, null, 2), { status: 400, headers: { "Content-Type": "application/json", ...cors(req) } });
    }
    const prettyResultReq = prettyXml(resultXml);
    const t2 = Date.now();
    const resOut = checkpointTarget.kind === "http"
        ? await sendHttp(checkpointTarget.url, resultXml)
        : await sendTcp(checkpointTarget.host, checkpointTarget.port, resultXml);
    const dur2 = Date.now() - t2;
    let prettyResultResp = null;
    try {
        if (resOut.text && resOut.text.trim().startsWith("<"))
            prettyResultResp = prettyXml(resOut.text);
    }
    catch { }
    await Promise.all([
        writeLog(base, "2_request.workingResult.xml", resultXml),
        writeLog(base, "2_request.workingResult.pretty.xml", prettyResultReq),
        writeLog(base, "2_response.checkpoint.xml", resOut.text || ""),
        writeLog(base, "2_response.checkpoint.pretty.xml", prettyResultResp || (resOut.text || "")),
        writeLog(base, "2_meta.result.json", JSON.stringify({
            leg: "result",
            requestID: meta?.requestID, toHost: meta?.toHost, device: meta?.device, intksk: meta?.intksk,
            scanned: meta?.scanned, resultTime: meta?.resultTime,
            connect: checkpointTarget.kind === "http"
                ? { url: resOut.used }
                : { host: checkpointTarget.host, tcpPort: checkpointTarget.port, used: resOut.used },
            durationMs: dur2, ok: resOut.ok, error: resOut.error, status: resOut.status,
            terminator: TCP_TERMINATOR, timeoutMs: TCP_TIMEOUT_MS, totalMs: Date.now() - startedAll,
        }, null, 2)),
    ]);
    try {
        await pruneOldLogs(LOG_DIR, 31);
    }
    catch { }
    if ((accept.includes("xml") || accept === "*/*") && resOut.text && resOut.text.trim().startsWith("<")) {
        return new Response(prettyResultResp || resOut.text, {
            status: resOut.ok ? 200 : 502,
            headers: {
                "Content-Type": "application/xml; charset=utf-8",
                "X-Krosy-Used-Url": resOut.used,
                ...cors(req),
            },
        });
    }
    return new Response(JSON.stringify({
        ok: resOut.ok, phase: "workingResult", requestID: meta?.requestID, usedUrl: resOut.used, status: resOut.status,
        durations: { buildAndSendMs: dur2, totalMs: Date.now() - startedAll },
        error: resOut.error,
        sentWorkingResultPreview: prettyResultReq.slice(0, 2000),
        responsePreview: (prettyResultResp || resOut.text || "").slice(0, 2000),
    }, null, 2), { status: resOut.ok ? 200 : 502, headers: { "Content-Type": "application/json", ...cors(req) } });
}
//# sourceMappingURL=route.js.map