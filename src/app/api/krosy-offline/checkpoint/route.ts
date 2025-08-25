// src/app/api/krosy-offile/checkpoint/route.ts
import { NextRequest } from "next/server";
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
const XML_TARGET = (process.env.KROSY_XML_TARGET || "kssksun01").trim();

const DEFAULT_CONNECT = (process.env.KROSY_CONNECT_HOST || "172.26.192.1:10080").trim();
const TCP_PORT = Number(process.env.KROSY_TCP_PORT || 10080);
const TCP_TIMEOUT_MS = Number(process.env.KROSY_TCP_TIMEOUT_MS || 10000);
/** newline | fin | null | none */
const TCP_TERMINATOR = (process.env.KROSY_TCP_TERMINATOR || "newline").toLowerCase();

/* ===== VC NS ===== */
const VC_NS_V01 =
  "http://www.kroschu.com/kroscada/namespaces/krosy/visualcontrol/V_0_1";

/* ===== CORS ===== */
function cors(req: NextRequest) {
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

async function ensureDir(p: string) { await fs.mkdir(p, { recursive: true }); }
async function writeLog(base: string, name: string, content: string) {
  await ensureDir(base);
  await fs.writeFile(path.join(base, name), content ?? "", "utf8");
}
function pickIpAndMac() {
  const want = (process.env.KROSY_NET_IFACE || "").trim();
  const rows: { name: string; address?: string; mac?: string; internal?: boolean; family?: string }[] = [];
  for (const [name, arr] of Object.entries(os.networkInterfaces()))
    for (const ni of arr || []) rows.push({ name, ...ni });
  const candidates = rows.filter((r) => !r.internal && r.family === "IPv4" && r.address && !/^169\.254\./.test(r.address || ""));
  const chosen =
    (want && candidates.find((r) => r.name === want)) ||
    candidates.find((r) => ["eth0", "en0", "ens160", "ens192"].includes(r.name)) ||
    candidates[0];
  const addr = chosen?.address || "0.0.0.0";
  const mac = (chosen?.mac || "00:00:00:00:00:00").toUpperCase().replace(/:/g, "-");
  return { ip: addr, mac };
}
function parseHostPort(raw: string, defPort: number) {
  let host = raw, port = defPort;
  const m = raw.match(/^\[?([^\]]+)\]:(\d+)$/);
  if (m) { host = m[1]; port = Number(m[2]); }
  return { host, port };
}
function prettyXml(xml: string) {
  try {
    const compact = xml.replace(/\r?\n/g, "").replace(/>\s+</g, "><").trim();
    const withNl = compact.replace(/(>)(<)(\/*)/g, "$1\n$2$3");
    let indent = 0; const out: string[] = [];
    for (const raw of withNl.split("\n")) {
      const line = raw.trim();
      if (line.startsWith("</")) indent = Math.max(indent - 1, 0);
      out.push("  ".repeat(indent) + line);
      if (/^<[^!?\/][^>]*[^\/]>$/.test(line)) indent++;
    }
    return out.join("\n");
  } catch { return xml; }
}
const xmlEsc = (s: string) =>
  String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/* ===== TCP ===== */
function sendTcp(host: string, port: number, xml: string) {
  return new Promise<{ ok: boolean; status: number; text: string; error: string | null; used: string }>((resolve) => {
    const socket = new net.Socket();
    let buf = ""; let done = false;
    const used = `tcp://${host}:${port}`;
    const payload =
      TCP_TERMINATOR === "newline" ? xml + "\n" :
      TCP_TERMINATOR === "null"    ? xml + "\0" : xml;

    const finish = (ok: boolean, status = 200, err: string | null = null) => {
      if (done) return; done = true;
      try { socket.destroy(); } catch {}
      resolve({ ok, status, text: buf, error: err, used });
    };

    socket.setNoDelay(true);
    socket.setTimeout(TCP_TIMEOUT_MS);

    socket.connect(port, host, () => {
      socket.write(payload);
      if (TCP_TERMINATOR === "fin") socket.end();
    });

    socket.on("data", (c) => {
      buf += c.toString("utf8");
      const s = buf.trim().toLowerCase();
      if (s === "ack" || s.endsWith("</krosy>")) finish(true, 200, null);
    });
    socket.on("end", () => { if (buf.length) finish(true); else finish(false, 0, "no data"); });
    socket.on("timeout", () => finish(false, 0, "tcp timeout"));
    socket.on("error", (e) => finish(false, 0, e?.message || "tcp error"));
  });
}

/* ===== DOM helpers ===== */
type AnyNode = any;
const firstDesc = (n: AnyNode, local: string): AnyNode | null => {
  const stack = [n];
  while (stack.length) {
    const cur = stack.pop();
    if (cur?.localName === local) return cur;
    const kids = cur?.childNodes || [];
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
  }
  return null;
};
const textOf = (n: AnyNode, local: string, dflt = "") => (firstDesc(n, local)?.textContent ?? dflt).trim();
const childrenByLocal = (n: AnyNode, local: string): AnyNode[] => {
  const out: AnyNode[] = [];
  const kids = n?.childNodes || [];
  for (let i = 0; i < kids.length; i++) if (kids[i]?.localName === local) out.push(kids[i]);
  return out;
};

/* ===== XML builders ===== */
function buildWorkingRequestXML(args: {
  requestID: string; srcHost: string; targetHost: string; scanned: string; ip: string; mac: string; intksk: string;
}) {
  const { requestID, srcHost, targetHost, scanned, ip, mac, intksk } = args;
  return (
    `<krosy xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="${VC_NS_V01}" xmlns:xsd="http://www.w3.org/2001/XMLSchema">` +
    `<header><requestID>${xmlEsc(requestID)}</requestID><sourceHost><hostname>${xmlEsc(srcHost)}</hostname><ipAddress>${xmlEsc(ip)}</ipAddress><macAddress>${xmlEsc(mac)}</macAddress></sourceHost><targetHost><hostname>${xmlEsc(targetHost)}</hostname></targetHost></header>` +
    `<body><visualControl><workingRequest intksk="${xmlEsc(intksk)}" scanned="${xmlEsc(scanned)}" device="${xmlEsc(srcHost)}"/></visualControl></body>` +
    `</krosy>`
  );
}
function buildWorkingResultFromWorkingData(workingDataXml: string, overrides?: {
  requestID?: string; resultTimeIso?: string; sourceIp?: string; sourceMac?: string;
}) {
  const parser = new Xmldom();
  const doc = parser.parseFromString(workingDataXml, "text/xml");

  const header = firstDesc(doc, "header");
  if (!header) throw new Error("No <header> in workingData XML");

  const requestID = overrides?.requestID || textOf(header, "requestID", String(Date.now()));
  const srcHostname_prev = textOf(firstDesc(header, "sourceHost")!, "hostname", "unknown-source");
  const tgtHostname_prev = textOf(firstDesc(header, "targetHost")!, "hostname", "unknown-target");

  const workingData = firstDesc(doc, "workingData");
  if (!workingData) throw new Error("No <workingData> found in response");

  const device = workingData.getAttribute("device") || tgtHostname_prev;
  const intksk = workingData.getAttribute("intksk") || "";
  const scanned = workingData.getAttribute("scanned") || isoNoMs();
  const resultTime = overrides?.resultTimeIso || isoNoMs();

  // Sequencer
  const sequencer = firstDesc(workingData, "sequencer");
  let segmentsOut = ""; let segCount = 0;
  if (sequencer) {
    const segList = firstDesc(sequencer, "segmentList") || sequencer;
    const segments = childrenByLocal(segList, "segment"); segCount = segments.length;
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
        seqOut += `<sequence index="${xmlEsc(idx)}" compType="${xmlEsc(compType)}" reference="${xmlEsc(reference)}" result="true">` +
                  (objGroup ? `<objGroup>${xmlEsc(objGroup)}</objGroup>` : ``) +
                  (objPos ? `<objPos>${xmlEsc(objPos)}</objPos>` : ``) +
                  `</sequence>`;
      }
      segmentsOut += `<segmentResult index="${xmlEsc(segIdx)}" name="${xmlEsc(segName)}" result="true" resultTime="${xmlEsc(resultTime)}">` +
                     `<sequenceList count="${sequences.length}">${seqOut}</sequenceList>` +
                     `</segmentResult>`;
    }
  }

  // Component clips
  const component = firstDesc(workingData, "component");
  let clipResultsOut = ""; let clipCount = 0;
  if (component) {
    const clipList = firstDesc(component, "clipList");
    const clips = clipList ? childrenByLocal(clipList, "clip") : [];
    clipCount = clips.length;
    for (const clip of clips) {
      const idx = clip.getAttribute("index") || "";
      clipResultsOut += `<clipResult index="${xmlEsc(idx)}" result="true" />`;
    }
  }

  const { ip, mac } = pickIpAndMac();
  const sourceIp = overrides?.sourceIp || ip;
  const sourceMac = overrides?.sourceMac || mac;

  const xml =
    `<krosy xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns="${VC_NS_V01}">` +
      `<header>` +
        `<requestID>${xmlEsc(requestID)}</requestID>` +
        `<sourceHost><hostname>${xmlEsc(device)}</hostname><ipAddress>${xmlEsc(sourceIp)}</ipAddress><macAddress>${xmlEsc(sourceMac)}</macAddress></sourceHost>` +
        `<targetHost><hostname>${xmlEsc(srcHostname_prev)}</hostname></targetHost>` +
      `</header>` +
      `<body><visualControl>` +
        `<workingResult device="${xmlEsc(device)}" intksk="${xmlEsc(intksk)}" scanned="${xmlEsc(scanned)}" result="true" resultTime="${xmlEsc(resultTime)}">` +
          (segCount ? `<sequencerResult><segmentResultList count="${segCount}">${segmentsOut}</segmentResultList></sequencerResult>` : ``) +
          (clipCount ? `<componentResult><clipResultList count="${clipCount}">${clipResultsOut}</clipResultList></componentResult>` : ``) +
        `</workingResult>` +
      `</visualControl></body>` +
    `</krosy>`;

  return { xml, meta: { requestID, device, intksk, scanned, resultTime, toHost: srcHostname_prev } };
}

/* ===== Handlers ===== */
export async function OPTIONS(req: NextRequest) {
  return new Response(null, { status: 204, headers: cors(req) });
}
export async function GET(req: NextRequest) {
  const { ip, mac } = pickIpAndMac();
  return new Response(JSON.stringify({ hostname: os.hostname(), ip, mac }), {
    status: 200, headers: { "Content-Type": "application/json", ...cors(req) },
  });
}

/**
 * POST JSON:
 * {
 *   workingDataXml?: "<krosy ...><workingData ...>...</workingData></krosy>",  // preferred
 *   // or derive workingData by sending workingRequest first:
 *   intksk?: "830569527900", requestID?: "1", sourceHostname?: "ksskkfb01", targetHostName?: "kssksun01",
 *   // TCP bridge:
 *   targetAddress?: "172.26.192.1:10080"
 * }
 */
export async function POST(req: NextRequest) {
  const accept = req.headers.get("accept") || "application/json";
  const body = (await req.json().catch(() => ({}))) as any;

  const connectRaw = String(body.targetAddress || DEFAULT_CONNECT).trim();
  const { host: connectHost, port: tcpPort } = parseHostPort(connectRaw, TCP_PORT);

  const stamp = nowStamp();
  const reqId = String(body.requestID || Date.now());
  const base = path.join(LOG_DIR, `${stamp}_${reqId}`);

  let workingDataXml: string | null = body.workingDataXml || null;
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

    let reqRespPretty: string | null = null;
    try { if (reqOut.text && reqOut.text.trim().startsWith("<")) reqRespPretty = prettyXml(reqOut.text); } catch {}

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

  // Build workingResult and send checkpoint back over TCP
  let resultXml: string; let meta: any;
  try { ({ xml: resultXml, meta } = buildWorkingResultFromWorkingData(workingDataXml!, { requestID: reqId })); }
  catch (e: any) {
    await writeLog(base, "2_error.build.json", JSON.stringify({ error: e?.message || String(e) }, null, 2));
    return new Response(JSON.stringify({ ok: false, phase: "buildWorkingResult", error: e?.message || String(e) }, null, 2),
      { status: 400, headers: { "Content-Type": "application/json", ...cors(req) } });
  }

  const prettyResultReq = prettyXml(resultXml);
  const t2 = Date.now();
  const resOut = await sendTcp(connectHost, tcpPort, resultXml);
  const dur2 = Date.now() - t2;

  let prettyResultResp: string | null = null;
  try { if (resOut.text && resOut.text.trim().startsWith("<")) prettyResultResp = prettyXml(resOut.text); } catch {}

  await Promise.all([
    writeLog(base, "2_request.workingResult.xml", resultXml),
    writeLog(base, "2_request.workingResult.pretty.xml", prettyResultReq),
    writeLog(base, "2_response.checkpoint.xml", resOut.text || ""),
    writeLog(base, "2_response.checkpoint.pretty.xml", prettyResultResp || (resOut.text || "")),
    writeLog(base, "2_meta.result.json", JSON.stringify({
      leg: "result",
      requestID: meta?.requestID, toHost: meta?.toHost, device: meta?.device, intksk: meta?.intksk,
      scanned: meta?.scanned, resultTime: meta?.resultTime,
      connect: { host: connectHost, tcpPort, used: resOut.used },
      durationMs: dur2, ok: resOut.ok, error: resOut.error, status: resOut.status,
      terminator: TCP_TERMINATOR, timeoutMs: TCP_TIMEOUT_MS, totalMs: Date.now() - startedAll,
    }, null, 2)),
  ]);

  if ((accept.includes("xml") || accept === "*/*") && resOut.text && resOut.text.trim().startsWith("<")) {
    return new Response(prettyResultResp || resOut.text, {
      status: resOut.ok ? 200 : 502,
      headers: { "Content-Type": "application/xml; charset=utf-8", "X-Krosy-Used-Url": resOut.used, ...cors(req) },
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
