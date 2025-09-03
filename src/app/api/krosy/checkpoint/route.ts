// app/api/krosy-checkpoint/route.ts
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
const ORIGINS = RAW_ORIGINS.split(",").map((s) => s.trim());
const ALLOW_ANY = RAW_ORIGINS.trim() === "*";

const LOG_DIR = process.env.KROSY_LOG_DIR || path.join(process.cwd(), ".krosy-logs");
const XML_TARGET = (process.env.KROSY_XML_TARGET || "ksskkfb01").trim();
// --- Force result (env) ---
const FORCE_RESULT_RAW = (process.env.KROSY_FORCE_CHECKPOINT_RESULT || "").trim().toLowerCase();
const FORCE_RESULT: boolean | null =
  ["ok","true","1","yes"].includes(FORCE_RESULT_RAW)  ? true  :
  ["nok","false","0","no"].includes(FORCE_RESULT_RAW) ? false :
  null; // null => don't force

const b2s = (b: boolean) => (b ? "true" : "false");

const TCP_TIMEOUT_MS = Number(process.env.KROSY_TCP_TIMEOUT_MS || 10000);
/** newline | crlf | fin | null | none */
const TCP_TERMINATOR = (process.env.KROSY_TCP_TERMINATOR || "newline").toLowerCase();
/** Comma list of strings that mean success */
const ACK_TOKENS = String(process.env.KROSY_ACK_TOKENS ?? "ack,ok,io")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
/** Treat any non-empty data then idle as success */
const READ_IDLE_MS = Number(process.env.KROSY_READ_IDLE_MS ?? 200);
const ANY_DATA_ACK = (process.env.KROSY_ANY_DATA_ACK ?? "0") === "1";

/** Default connect target */
const DEFAULT_CONNECT = (process.env.KROSY_CONNECT_HOST || "172.26.192.1:10080").trim();
/** Fallback TCP port if host has no :port */
const TCP_PORT = Number(process.env.KROSY_TCP_PORT || 10080);
// Optional: forward checkpoint result to an HTTP endpoint (central collector)
const REPORT_URL = (process.env.KROSY_RESULT_URL || "").trim();
const REPORT_IP = (process.env.KROSY_RESULT_IP || "").trim(); // if set, build URL with this IP and incoming port
const REPORT_PATH = (process.env.KROSY_RESULT_PATH || "/api/checkpoint").trim();
const REPORT_SCHEME = (process.env.KROSY_RESULT_SCHEME || "").trim(); // http|https (optional)
const REPORT_PORT = (process.env.KROSY_RESULT_PORT || "").trim(); // optional
const REPORT_TIMEOUT_MS = Number(process.env.KROSY_REPORT_TIMEOUT_MS || 4000);

function pickReportUrl(req: NextRequest): string | null {
  if (REPORT_URL) return REPORT_URL;
  const ip = REPORT_IP;
  if (!ip) return null;
  // Infer scheme from header or env
  const inferredProto = (req.headers.get('x-forwarded-proto') || req.nextUrl.protocol || 'http:').replace(':','');
  const scheme = (REPORT_SCHEME || inferredProto || 'http').toLowerCase();
  // Prefer explicit port; else copy from incoming Host header
  let port = REPORT_PORT;
  if (!port) {
    const hostHdr = req.headers.get('host') || '';
    const m = hostHdr.match(/:(\d+)$/);
    if (m) port = m[1];
  }
  const path = REPORT_PATH.startsWith('/') ? REPORT_PATH : ('/' + REPORT_PATH);
  const origin = port ? `${scheme}://${ip}:${port}` : `${scheme}://${ip}`;
  return `${origin}${path}`;
}

/* ===== Namespaces ===== */
const VC_NS_V01 =
  "http://www.kroschu.com/kroscada/namespaces/krosy/visualcontrol/V_0_1";

/* ===== CORS ===== */
function cors(req: NextRequest) {
  const origin = req.headers.get("origin") || "";
  const allow = ALLOW_ANY ? "*" : ORIGINS.includes(origin) ? origin : ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    Vary: "Origin",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
    "Access-Control-Expose-Headers": "X-Krosy-Used-Url",
    "Access-Control-Max-Age": "600",
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
async function uniqueBase(root: string, stem: string): Promise<string> {
  const tryPath = (s: string) => path.join(root, s);
  try { await fs.stat(tryPath(stem)); }
  catch { return tryPath(stem); }
  for (let i = 1; i < 1000; i++) {
    const alt = `${stem}__${String(i).padStart(2, '0')}`;
    try { await fs.stat(tryPath(alt)); }
    catch { return tryPath(alt); }
  }
  return tryPath(`${stem}__dup`);
}
async function pruneOldLogs(root: string, maxAgeDays = 31) {
  try {
    const now = Date.now();
    const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
    const entries = await fs.readdir(root, { withFileTypes: true });
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const dirPath = path.join(root, ent.name);
      let ts = 0;
      const m = ent.name.match(/^(\d{4})-(\d{2})$/);
      if (m) {
        const y = Number(m[1]); const mon = Number(m[2]);
        ts = new Date(Date.UTC(y, mon - 1, 1)).getTime();
      } else {
        const st = await fs.stat(dirPath);
        ts = st.mtimeMs || st.ctimeMs || 0;
      }
      if (now - ts > maxAgeMs) {
        try { await fs.rm(dirPath, { recursive: true, force: true }); } catch {}
      }
    }
  } catch {}
}
function pickIpAndMac() {
  const want = (process.env.KROSY_NET_IFACE || "").trim();
  const ifs = os.networkInterfaces();
  const rows: {
    name: string;
    address?: string;
    mac?: string;
    internal?: boolean;
    family?: string;
  }[] = [];
  for (const [name, arr] of Object.entries(ifs))
    for (const ni of arr || []) rows.push({ name, ...ni });
  const candidates = rows.filter((r) => !r.internal && r.family === "IPv4" && r.address);
  const chosen =
    (want && candidates.find((r) => r.name === want)) ||
    candidates.find((r) => ["eth0", "en0", "ens160", "ens192"].includes(r.name)) ||
    candidates[0];
  const addr = chosen?.address || "0.0.0.0";
  const mac = (chosen?.mac || "00:00:00:00:00:00").toUpperCase().replace(/:/g, "-");
  return { ip: addr, mac };
}
function parseHostPort(raw: string, defPort: number) {
  let host = raw,
    port = defPort;
  const m = raw.match(/^\[?([^\]]+)\]:(\d+)$/);
  if (m) {
    host = m[1];
    port = Number(m[2]);
  }
  return { host, port };
}
function prettyXml(xml: string) {
  try {
    const compact = xml.replace(/\r?\n/g, "").replace(/>\s+</g, "><").trim();
    const withNl = compact.replace(/(>)(<)(\/*)/g, "$1\n$2$3");
    let indent = 0;
    const out: string[] = [];
    for (const raw of withNl.split("\n")) {
      const line = raw.trim();
      if (line.startsWith("</")) indent = Math.max(indent - 1, 0);
      out.push("  ".repeat(indent) + line);
      if (/^<[^!?\/][^>]*[^\/]>$/.test(line)) indent++;
    }
    return out.join("\n");
  } catch {
    return xml;
  }
}
const xmlEsc = (s: string) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
const hasWorkingDataTag = (s: string) => /<workingData[\s>]/i.test(s || "");

/* ===== TCP ===== */
function terminatorAppend(xml: string) {
  if (TCP_TERMINATOR === "newline") return xml + "\n";
  if (TCP_TERMINATOR === "crlf") return xml + "\r\n";
  if (TCP_TERMINATOR === "null") return xml + "\0";
  return xml;
}
const xmlDone = (s: string) => s.trim().toLowerCase().endsWith("</krosy>");
const isAckToken = (s: string) => {
  const t = s.trim().toLowerCase();
  return ACK_TOKENS.includes(t);
};
function sendTcp(host: string, port: number, xml: string) {
  return new Promise<{
    ok: boolean;
    status: number;
    text: string;
    error: string | null;
    used: string;
  }>((resolve) => {
    const socket = new net.Socket();
    let buf = "";
    let done = false;
    let idleTimer: NodeJS.Timeout | null = null;
    const used = `tcp://${host}:${port}`;
    const payload = terminatorAppend(xml);

    const finish = (ok: boolean, status = 200, err: string | null = null) => {
      if (done) return;
      done = true;
      try {
        if (idleTimer) clearTimeout(idleTimer);
      } catch {}
      try {
        socket.destroy();
      } catch {}
      resolve({ ok, status, text: buf, error: err, used });
    };
    const armIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      if (READ_IDLE_MS > 0)
        idleTimer = setTimeout(() => {
          if (!done && (ANY_DATA_ACK ? buf.length > 0 : isAckToken(buf)))
            finish(true, 200, null);
        }, READ_IDLE_MS);
    };

    socket.setNoDelay(true);
    socket.setTimeout(TCP_TIMEOUT_MS);

    socket.connect(port, host, () => {
      socket.write(payload);
      if (TCP_TERMINATOR === "fin") socket.end();
      armIdle();
    });

    socket.on("data", (c) => {
      buf += c.toString("utf8");
      const t = buf.trim();
      if (xmlDone(t) || isAckToken(t)) return finish(true, 200, null);
      armIdle();
    });
    socket.on("end", () => {
      if (buf.length) finish(true);
      else finish(false, 0, "no data");
    });
    socket.on("timeout", () => finish(false, 0, "tcp timeout"));
    socket.on("error", (e) => finish(false, 0, e?.message || "tcp error"));
  });
}

/* ===== DOM helpers (namespace-agnostic) ===== */
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
const textOf = (n: AnyNode, local: string, dflt = "") =>
  (firstDesc(n, local)?.textContent ?? dflt).trim();
const childrenByLocal = (n: AnyNode, local: string): AnyNode[] => {
  const out: AnyNode[] = [];
  const kids = n?.childNodes || [];
  for (let i = 0; i < kids.length; i++)
    if (kids[i]?.localName === local) out.push(kids[i]);
  return out;
};

/* ===== XML builders ===== */
function apikingRequestXML(args: {
  requestID: string;
  srcHost: string;
  targetHost: string;
  scanned: string;
  ip: string;
  mac: string;
  intksk: string;
}) {
  const { requestID, srcHost, targetHost, scanned, ip, mac, intksk } = args;
  return (
    `<krosy xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="${VC_NS_V01}" xmlns:xsd="http://www.w3.org/2001/XMLSchema">` +
    `<header>` +
    `<requestID>${xmlEsc(requestID)}</requestID>` +
    `<sourceHost>` +
    `<hostname>${xmlEsc(srcHost)}</hostname>` +
    `<ipAddress>${xmlEsc(ip)}</ipAddress>` +
    `<macAddress>${xmlEsc(mac)}</macAddress>` +
    `</sourceHost>` +
    `<targetHost><hostname>${xmlEsc(targetHost)}</hostname></targetHost>` +
    `</header>` +
    `<body>` +
    `<visualControl>` +
    `<workingRequest intksk="${xmlEsc(
      intksk
    )}" scanned="${xmlEsc(scanned)}" device="${xmlEsc(srcHost)}"/>` +
    `</visualControl>` +
    `</body>` +
    `</krosy>`
  );
}

function apikingResultFromWorkingData(
  workingDataXml: string,
  overrides?: { requestID?: string; resultTimeIso?: string; sourceIp?: string; sourceMac?: string; },
  opts?: { forceResult?: boolean | null }          // NEW
) {
  const parser = new Xmldom();
  // Normalize boolean-like attributes to valid XML (e.g., allowed => allowed="true")
  const normalizeBooleanAttrs = (xml: string) => xml.replace(/(\s(?:allowed|status))(?!\s*=\s*["'])/gi, '$1="true"');
  const fixedXml = normalizeBooleanAttrs(workingDataXml || '');
  const doc = parser.parseFromString(fixedXml, "text/xml");

  const forced = opts?.forceResult ?? null;        // true/false or null
  const forceMode = typeof forced === "boolean";
  const resStr = forceMode ? b2s(forced!) : "true";

  const header = firstDesc(doc, "header")!;
  const requestID = overrides?.requestID || textOf(header, "requestID", String(Date.now()));
  const srcHostname_prev = textOf(firstDesc(header, "sourceHost")!, "hostname", "unknown-source");
  const tgtHostname_prev = textOf(firstDesc(header, "targetHost")!, "hostname", "unknown-target");

  const workingData = firstDesc(doc, "workingData");
  if (!workingData) throw new Error("No <workingData> in payload");

  const device = workingData.getAttribute("device") || tgtHostname_prev;
  const intksk = workingData.getAttribute("intksk") || "";
  const scanned = workingData.getAttribute("scanned") || isoNoMs();
  const resultTime = overrides?.resultTimeIso || isoNoMs();

  // ===== Sequencer =====
  let segmentsOut = ""; let segCount = 0; let markedFalse = false;
  const failingClipRefs = new Set<string>();

  const sequencer = firstDesc(workingData, "sequencer");
  if (sequencer) {
    const segList = firstDesc(sequencer, "segmentList") || sequencer;
    const segments = childrenByLocal(segList, "segment"); segCount = segments.length;

    for (const seg of segments) {
      const segIdx = seg.getAttribute("index") || "";
      const segName = seg.getAttribute("name") || segIdx || "1";

      const seqListNode = firstDesc(seg, "sequenceList") || seg;
      const sequences = childrenByLocal(seqListNode, "sequence");

      let seqOut = ""; let segHasFalse = false;

      for (const seq of sequences) {
        const idx = seq.getAttribute("index") || "";
        const compType = (seq.getAttribute("compType") || "").toLowerCase();
        const reference = seq.getAttribute("reference") || "";
        const measType = (seq.getAttribute("measType") || "").toLowerCase();
        const objGroup = textOf(seq, "objGroup", "");
        const objPos = textOf(seq, "objPos", "");

        // Your original target (only used when not forcing)
        const isTarget =
          compType === "clip" && measType === "default" &&
          (reference === "2" || /^CL_2452\b/i.test(objPos));

        // Decide this sequence result
        let seqResult = "true";
        if (forceMode) {
          seqResult = resStr;
        } else if (!markedFalse && isTarget) {
          seqResult = "false";
          markedFalse = true; segHasFalse = true;
          if (reference) failingClipRefs.add(reference);
        }

        seqOut += `<sequence index="${idx}" compType="${compType}" reference="${reference}" result="${seqResult}">` +
                  (objGroup ? `<objGroup>${xmlEsc(objGroup)}</objGroup>` : ``) +
                  (objPos ? `<objPos>${xmlEsc(objPos)}</objPos>` : ``) +
                  `</sequence>`;
      }

      const segResult = forceMode ? resStr : (segHasFalse ? "false" : "true");
      segmentsOut += `<segmentResult index="${xmlEsc(segIdx)}" name="${xmlEsc(segName)}" result="${segResult}" resultTime="${xmlEsc(resultTime)}">` +
                     `<sequenceList count="${sequences.length}">${seqOut}</sequenceList>` +
                     `</segmentResult>`;
    }
  }

  // ===== Component clips =====
  const component = firstDesc(workingData, "component");
  let clipResultsOut = ""; let clipCount = 0;
  if (component) {
    const clipList = firstDesc(component, "clipList");
    const clips = clipList ? childrenByLocal(clipList, "clip") : [];
    clipCount = clips.length;
    for (const clip of clips) {
      const idx = clip.getAttribute("index") || "";
      const isFalse = !forceMode && failingClipRefs.has(idx);
      if (isFalse) markedFalse = true;
      clipResultsOut += `<clipResult index="${xmlEsc(idx)}" result="${forceMode ? resStr : (isFalse ? "false" : "true")}" />`;
    }
  }

  const overall = forceMode ? resStr : (markedFalse ? "false" : "true");

  const xml =
    `<krosy xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns="${VC_NS_V01}">` +
      `<header>` +
        `<requestID>${xmlEsc(requestID)}</requestID>` +
        `<sourceHost><hostname>${xmlEsc(device)}</hostname><ipAddress>${xmlEsc(overrides?.sourceIp || pickIpAndMac().ip)}</ipAddress><macAddress>${xmlEsc(overrides?.sourceMac || pickIpAndMac().mac)}</macAddress></sourceHost>` +
        `<targetHost><hostname>${xmlEsc(srcHostname_prev)}</hostname></targetHost>` +
      `</header>` +
      `<body><visualControl>` +
        `<workingResult device="${xmlEsc(device)}" intksk="${xmlEsc(intksk)}" scanned="${xmlEsc(scanned)}" result="${overall}" resultTime="${xmlEsc(resultTime)}">` +
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
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...cors(req),
    },
  });
}


export async function POST(req: NextRequest) {
  const accept = req.headers.get("accept") || "application/json";
  const body = (await req.json().catch(() => ({}))) as any;

  const connectRaw = String(body.targetAddress || DEFAULT_CONNECT).trim();
  const { host: connectHost, port: tcpPort } = parseHostPort(connectRaw, TCP_PORT);

  const stamp = nowStamp();
  const reqId = String(body.requestID || Date.now());
  const cur = new Date();
  const yyyy = cur.getUTCFullYear();
  const mm = String(cur.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(cur.getUTCDate()).padStart(2, '0');
  const hh = String(cur.getUTCHours()).padStart(2, '0');
  const mi = String(cur.getUTCMinutes()).padStart(2, '0');
  const ss = String(cur.getUTCSeconds()).padStart(2, '0');
  const month = `${yyyy}-${mm}`;
  let idSan = (String((body as any)?.intksk || '')).replace(/[^0-9A-Za-z_-]/g, '').slice(-12) || '';
  if (!idSan && typeof (body as any)?.workingDataXml === 'string') {
    const xml = String((body as any).workingDataXml);
    try {
      const m1 = xml.match(/<workingData\b[^>]*\bintksk=\"([^\"]+)\"/i);
      const m2 = xml.match(/\bksknr=\"(\d{6,})\"/i);
      idSan = (m1?.[1] || m2?.[1] || '').replace(/[^0-9A-Za-z_-]/g, '').slice(-12) || '';
    } catch {}
  }
  if (!idSan) idSan = 'no-intksk';
  const nice = `${yyyy}-${mm}-${dd}_${hh}-${mi}-${ss}`;
  const base = await uniqueBase(path.join(LOG_DIR, month), `${nice}__KSK_${idSan}__RID_${reqId}`);

  let workingDataXml: string | null = body.workingDataXml || null;
  const startedAll = Date.now();

// normalize "forceResult" from body (available everywhere in POST)
const bodyForceRaw = String(body.forceResult ?? "").trim().toLowerCase();
const bodyForce: boolean | null =
  ["ok","true","1","yes"].includes(bodyForceRaw)  ? true  :
  ["nok","false","0","no"].includes(bodyForceRaw) ? false : null;
  // If no workingData provided, perform request leg to obtain it
  if (!workingDataXml) {
    const intksk = String(body.intksk || "830569527900");
    const sourceHostname = String(body.sourceHostname || os.hostname());
    const xmlTargetHost = String(body.targetHostName || XML_TARGET).trim();
    const { ip, mac } = pickIpAndMac();
    const scanned = isoNoMs();

    const reqXml = apikingRequestXML({
      requestID: reqId,
      srcHost: sourceHostname,
      targetHost: xmlTargetHost,
      scanned,
      ip,
      mac,
      intksk,
    });
    const prettyReq = prettyXml(reqXml);

    const t1 = Date.now();
    const reqOut = await sendTcp(connectHost, tcpPort, reqXml);
    const dur1 = Date.now() - t1;

    let reqRespPretty: string | null = null;
    try {
      if (reqOut.text && reqOut.text.trim().startsWith("<"))
        reqRespPretty = prettyXml(reqOut.text);
    } catch {}

    await Promise.all([
      writeLog(base, "1_request.workingRequest.xml", reqXml),
      writeLog(base, "1_request.workingRequest.pretty.xml", prettyReq),
      writeLog(base, "1_response.workingData.xml", reqOut.text || ""),
      writeLog(
        base,
        "1_response.workingData.pretty.xml",
        reqRespPretty || (reqOut.text || "")
      ),
      writeLog(
        base,
        "1_meta.request.json",
        JSON.stringify(
          {
            leg: "request",
            requestID: reqId,
            device: sourceHostname,
            xmlTargetHost,
            intksk,
            connect: { host: connectHost, tcpPort, used: reqOut.used },
            durationMs: dur1,
            ok: reqOut.ok,
            error: reqOut.error,
            status: reqOut.status,
            terminator: TCP_TERMINATOR,
            timeoutMs: TCP_TIMEOUT_MS,
          },
          null,
          2
        )
      ),
    ]);

    if (!reqOut.ok || !reqOut.text?.trim().startsWith("<")) {
      return new Response(
        JSON.stringify(
          {
            ok: false,
            phase: "workingRequest",
            requestID: reqId,
            usedUrl: reqOut.used,
            status: reqOut.status,
            durationMs: dur1,
            error: reqOut.error || "no xml response",
            responsePreview: (reqRespPretty || reqOut.text || "").slice(0, 2000),
          },
          null,
          2
        ),
        {
          status: 502,
          headers: { "Content-Type": "application/json", ...cors(req) },
        }
      );
    }
    workingDataXml = reqOut.text;
  }

  // Build workingResult from workingData and send checkpoint

  // Build workingResult from workingData and send checkpoint
let resultXml: string;
let meta: any;
try {
  const built = apikingResultFromWorkingData(
    workingDataXml!,
    { requestID: reqId },
    { forceResult: bodyForce ?? FORCE_RESULT }  // <-- pass it here
  );
  resultXml = built.xml;
  meta = built.meta;
} catch (e: any) {
  await writeLog(base, "2_error.build.json", JSON.stringify({ error: e?.message || String(e) }, null, 2));
  return new Response(JSON.stringify({ ok: false, phase: "apikingResult", error: e?.message || String(e) }, null, 2),
    { status: 400, headers: { "Content-Type": "application/json", ...cors(req) } });
}

  const prettyResultReq = prettyXml(resultXml);
  const t2 = Date.now();
  const resOut = await sendTcp(connectHost, tcpPort, resultXml);
  const dur2 = Date.now() - t2;

  let prettyResultResp: string | null = null;
  try {
    if (resOut.text && resOut.text.trim().startsWith("<"))
      prettyResultResp = prettyXml(resOut.text);
  } catch {}

  await Promise.all([
    writeLog(base, "2_request.workingResult.xml", resultXml),
    writeLog(base, "2_request.workingResult.pretty.xml", prettyResultReq),
    writeLog(base, "2_response.checkpoint.xml", resOut.text || ""),
    writeLog(
      base,
      "2_response.checkpoint.pretty.xml",
      prettyResultResp || (resOut.text || "")
    ),
    writeLog(
      base,
      "2_meta.result.json",
      JSON.stringify(
        {
          leg: "result",
          requestID: meta?.requestID,
          toHost: meta?.toHost,
          device: meta?.device,
          intksk: meta?.intksk,
          scanned: meta?.scanned,
          resultTime: meta?.resultTime,
          connect: { host: connectHost, tcpPort, used: resOut.used },
          durationMs: dur2,
          ok: resOut.ok,
          error: resOut.error,
          status: resOut.status,
          terminator: TCP_TERMINATOR,
          timeoutMs: TCP_TIMEOUT_MS,
          totalMs: Date.now() - startedAll,
        },
        null,
        2
      )
    ),
  ]);
  try { await pruneOldLogs(LOG_DIR, 31); } catch {}
    await pruneOldLogs(LOG_DIR, 31);

  // Optionally forward the built result to a central HTTP endpoint
  {
    try {
      const target = pickReportUrl(req);
      if (target) {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), Math.max(500, REPORT_TIMEOUT_MS));
        const payload = {
          mode: 'krosy.checkpoint',
          requestID: meta?.requestID,
          toHost: meta?.toHost,
          device: meta?.device,
          intksk: meta?.intksk,
          scanned: meta?.scanned,
          resultTime: meta?.resultTime,
          connect: { host: connectHost, tcpPort, used: resOut.used },
          ok: resOut.ok,
          status: resOut.status,
          error: resOut.error || null,
          durations: { buildAndSendMs: dur2, totalMs: Date.now() - startedAll },
          // Include the exact XML that was sent to Krosy
          workingResultXml: prettyResultReq,
        } as const;
        await fetch(target, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: ctrl.signal,
        }).catch(() => {});
        clearTimeout(t);
      }
    } catch {}
  }

  if (
    (accept.includes("xml") || accept === "*/*") &&
    resOut.text &&
    resOut.text.trim().startsWith("<")
  ) {
    return new Response(prettyResultResp || resOut.text, {
      status: resOut.ok ? 200 : 502,
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "X-Krosy-Used-Url": resOut.used,
        "X-Krosy-Log-Path": base,
        ...cors(req),
      },
    });
  }

  return new Response(
    JSON.stringify(
      {
        ok: resOut.ok,
        phase: "workingResult",
        requestID: meta?.requestID,
        usedUrl: resOut.used,
        status: resOut.status,
        durations: { buildAndSendMs: dur2, totalMs: Date.now() - startedAll },
        error: resOut.error,
        sentWorkingResultPreview: prettyResultReq.slice(0, 2000),
        responsePreview: (prettyResultResp || resOut.text || "").slice(0, 2000),
      },
      null,
      2
    ),
    {
      status: resOut.ok ? 200 : 502,
      headers: {
        "Content-Type": "application/json",
        "X-Krosy-Used-Url": resOut.used,
        "X-Krosy-Log-Path": base,
        ...cors(req),
      },
    }
  );
}
