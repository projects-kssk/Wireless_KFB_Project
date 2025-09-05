import { NextRequest } from "next/server";
import { LOG } from "@/lib/logger";
import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import net from "node:net";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ===== Env ===== */
const RAW_ORIGINS = process.env.KROSY_CLIENT_ORIGINS ?? "*";
const ORIGINS = RAW_ORIGINS.split(",").map((s) => s.trim());
const ALLOW_ANY = RAW_ORIGINS.trim() === "*";

const LOG_DIR = process.env.KROSY_LOG_DIR || path.join(process.cwd(), ".krosy-logs");
const XML_TARGET = (process.env.KROSY_XML_TARGET || "ksskkfb01").trim();
// Increase default timeout to accommodate slower Krosy responses in production
const TCP_TIMEOUT_MS = Number(process.env.KROSY_TCP_TIMEOUT_MS || 30000);
const log = LOG.tag('api:krosy');
/** newline | fin | null | none */
const TCP_TERMINATOR = (process.env.KROSY_TCP_TERMINATOR || "newline").toLowerCase();

/** Default connect target per your requirement */
const DEFAULT_CONNECT = (process.env.KROSY_CONNECT_HOST || "172.26.192.1:10080").trim();
/** Fallback TCP port if host has no :port */
const TCP_PORT = Number(process.env.KROSY_TCP_PORT || 10080);

/** Preview char limit for JSON payloads */
const PREVIEW_LIMIT = Number(process.env.KROSY_PREVIEW_LIMIT ?? 2000);

/* ===== VisualControl namespace ===== */
const VC_NS = "http://www.kroschu.com/kroscada/namespaces/krosy/visualcontrol/V_0_1";

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
const isoNoMs = (d = new Date()) => d.toISOString().replace(/\.\d{3}Z$/, "");
const nowStamp = () => isoNoMs().replace(/[:T]/g, "-");

async function ensureDir(p: string) { await fs.mkdir(p, { recursive: true }); }
async function writeLog(base: string, name: string, content: string) {
  await ensureDir(base);
  await fs.writeFile(path.join(base, name), content ?? "", "utf8");
}
async function uniqueBase(root: string, stem: string): Promise<string> {
  const tryPath = (s: string) => path.join(root, s);
  try {
    await fs.stat(tryPath(stem));
  } catch { return tryPath(stem); }
  // If exists, append numeric suffix
  for (let i = 1; i < 1000; i++) {
    const alt = `${stem}__${String(i).padStart(2, '0')}`;
    try { await fs.stat(tryPath(alt)); }
    catch { return tryPath(alt); }
  }
  return tryPath(`${stem}__dup`);
}
const msFmt = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`);
const yesNo = (b: boolean) => (b ? "yes" : "no");
async function pruneOldLogs(root: string, maxAgeDays = 31) {
  try {
    const now = Date.now();
    const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
    const entries = await fs.readdir(root, { withFileTypes: true });
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const dirPath = path.join(root, ent.name);
      // Prefer YYYY-MM folders; else fallback to mtime
      let ts = 0;
      const m = ent.name.match(/^(\d{4})-(\d{2})$/);
      if (m) {
        const y = Number(m[1]); const mon = Number(m[2]);
        const firstDay = new Date(Date.UTC(y, mon - 1, 1)).getTime();
        ts = firstDay;
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
  const rows: { name: string; address?: string; mac?: string; internal?: boolean; family?: string }[] = [];
  for (const [name, arr] of Object.entries(ifs)) for (const ni of arr || []) rows.push({ name, ...ni });
  const candidates = rows.filter((r) => !r.internal && r.family === "IPv4" && r.address);
  const chosen =
    (want && candidates.find((r) => r.name === want)) ||
    candidates.find((r) => ["eth0", "en0", "ens160", "ens192"].includes(r.name)) ||
    candidates[0];
  const addr = chosen?.address || "127.0.0.1";
  const mac = (chosen?.mac || "00:00:00:00:00:00").toUpperCase().replace(/:/g, "-");
  return { ip: addr, mac };
}
function parseHostPort(raw: string, defPort: number) {
  // supports "host:1234", "[::1]:1234", or "host" with default port
  let host = raw, port = defPort;
  const m = raw.match(/^\[?([^\]]+)\]:(\d+)$/);
  if (m) { host = m[1]; port = Number(m[2]); }
  return { host, port };
}

/* ===== XML helpers ===== */
function buildVisualControlWorkingXML(args: {
  requestID: string; srcHost: string; targetHost: string; scanned: string; ip: string; mac: string; intksk: string;
}) {
  const { requestID, srcHost, targetHost, scanned, ip, mac, intksk } = args;
  return (
    `<krosy xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="${VC_NS}" xmlns:xsd="http://www.w3.org/2001/XMLSchema">` +
      `<header>` +
        `<requestID>${requestID}</requestID>` +
        `<sourceHost>` +
          `<hostname>${srcHost}</hostname>` +
          `<ipAddress>${ip}</ipAddress>` +
          `<macAddress>${mac}</macAddress>` +
        `</sourceHost>` +
        `<targetHost><hostname>${targetHost}</hostname></targetHost>` +
      `</header>` +
      `<body>` +
        `<visualControl>` +
          `<workingRequest intksk="${intksk}" scanned="${scanned}" device="${srcHost}"/>` +
        `</visualControl>` +
      `</body>` +
    `</krosy>`
  );
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

const hasWorkingDataTag = (s: string) => /<workingData[\s>]/i.test(s || "");
const isCompleteKrosy = (s: string) =>
  /^\s*(?:<\?xml[^>]*\?>\s*)?<krosy[\s>][\s\S]*<\/krosy>\s*$/i.test(s || "");

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

  const intksk = String(body.intksk || "830569527900");
  const requestID = String(body.requestID || Date.now());
  const sourceHostname = String(body.sourceHostname || os.hostname());
  const xmlTargetHost = String(body.targetHostName || XML_TARGET).trim();

  const connectRaw = String(body.targetAddress || DEFAULT_CONNECT).trim();
  const { host: connectHost, port: tcpPort } = parseHostPort(connectRaw, TCP_PORT);

  const { ip, mac } = pickIpAndMac();
  const scanned = isoNoMs();

  const xml = buildVisualControlWorkingXML({
    requestID, srcHost: sourceHostname, targetHost: xmlTargetHost, scanned, ip, mac, intksk,
  });
  const prettyReq = prettyXml(xml);

  const started = Date.now();
  try {
    log.info('POST begin', {
      intksk,
      requestID,
      sourceHostname,
      xmlTargetHost,
      connectHost,
      tcpPort,
      timeoutMs: TCP_TIMEOUT_MS,
      terminator: TCP_TERMINATOR,
    });
  } catch {}
  const out = await sendTcp(connectHost, tcpPort, xml);
  const durationMs = Date.now() - started;
  try { log.info('POST end', { ok: out.ok, status: out.status, error: out.error, durationMs }); } catch {}

  // Pretty-print XML response when present
  let prettyResp: string | null = null;
  try { if (out.text && out.text.trim().startsWith("<")) prettyResp = prettyXml(out.text); } catch {}

  // Derived flags for client to avoid re-post "upgrade"
  const responseXmlRaw = out.text || "";
  const hasWorkingData = hasWorkingDataTag(responseXmlRaw);
  const isComplete = isCompleteKrosy(responseXmlRaw);

  // Build human-friendly report similar to offline route
  const report = (() => {
    const ts = isoNoMs();
    const header = [
      "=== KROSY ONLINE REPORT ===============================================",
      `timestamp:     ${ts}`,
      `requestID:     ${requestID}`,
      `device:        ${sourceHostname}`,
      `intksk:        ${intksk}`,
      `targetHost:    ${xmlTargetHost}`,
      `tcpUsed:       ${out.used}`,
      `status:        ${out.status} ${out.ok ? "OK" : "ERROR"}`,
      `duration:      ${msFmt(durationMs)}`,
      `workingData:   ${yesNo(hasWorkingData)}`,
      `completeXml:   ${yesNo(isComplete)}`,
      `error:         ${out.error ?? "none"}`,
      "-------------------------------------------------------------------------",
    ].join("\n");
    const preview = `Response XML (pretty, truncated):\n${(prettyResp || responseXmlRaw).slice(0, 4000)}\n=========================================================================`;
    return `${header}\n${preview}`;
  })();

  // Logs
  let logBase: string | null = null;
  try {
    const cur = new Date();
    const yyyy = cur.getUTCFullYear();
    const mm = String(cur.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(cur.getUTCDate()).padStart(2, '0');
    const hh = String(cur.getUTCHours()).padStart(2, '0');
    const mi = String(cur.getUTCMinutes()).padStart(2, '0');
    const ss = String(cur.getUTCSeconds()).padStart(2, '0');
    const month = `${yyyy}-${mm}`;
    const idSan = (intksk || '').replace(/[^0-9A-Za-z_-]/g, '').slice(-12) || 'no-intksk';
    const nice = `${yyyy}-${mm}-${dd}_${hh}-${mi}-${ss}`;
    const base = await uniqueBase(path.join(LOG_DIR, month), `${nice}__KSK_${idSan}__RID_${requestID}`);
    logBase = base;
    await Promise.all([
      // Normalized file names
      writeLog(base, "request.raw.xml", xml),
      writeLog(base, "request.pretty.xml", prettyReq),
      writeLog(base, "response.raw.xml", responseXmlRaw),
      writeLog(base, "response.pretty.xml", prettyResp || responseXmlRaw),
      writeLog(base, "report.log", report),
      // Backward-compat duplicates
      writeLog(base, "request.xml", xml),
      writeLog(base, "response.xml", responseXmlRaw),
      writeLog(base, "meta.json", JSON.stringify({
        mode: "visualControl.working",
        requestID,
        device: sourceHostname,
        xmlTargetHost,
        intksk,
        connect: { host: connectHost, tcpPort, used: out.used },
        durationMs, ok: out.ok, error: out.error, status: out.status,
        terminator: TCP_TERMINATOR, timeoutMs: TCP_TIMEOUT_MS,
      }, null, 2)),
    ]);
    // Auto-prune logs older than ~1 month
    await pruneOldLogs(LOG_DIR, 31);
  } catch {}

  // XML response branch
  if ((accept.includes("xml") || accept === "*/*") && responseXmlRaw.trim().startsWith("<")) {
    return new Response(prettyResp || responseXmlRaw, {
      status: out.ok ? 200 : 502,
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Krosy-Used-Url": out.used,
        "X-Krosy-Timeout": String(TCP_TIMEOUT_MS),
        "X-Krosy-Duration": String(durationMs),
        ...(logBase ? { "X-Krosy-Log-Path": logBase } : {}),
        ...cors(req),
      },
    });
  }

  // JSON response branch with full raw XML and flags to prevent client "upgrade" POST
  return new Response(JSON.stringify({
    ok: out.ok,
    requestID,
    usedUrl: out.used,
    status: out.status,
    durationMs,
    error: out.error,
    sentXmlPreview: prettyReq.slice(0, PREVIEW_LIMIT),
    responseXmlPreview: (prettyResp || responseXmlRaw).slice(0, PREVIEW_LIMIT),
    responseXmlRaw,            // <— full XML for client consumption
    hasWorkingData,            // <— server-evaluated hint
    isComplete,                // <— server-evaluated hint
  }, null, 2), {
    status: out.ok ? 200 : 502,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Krosy-Used-Url": out.used,
      "X-Krosy-Timeout": String(TCP_TIMEOUT_MS),
      "X-Krosy-Duration": String(durationMs),
      ...(logBase ? { "X-Krosy-Log-Path": logBase } : {}),
      ...cors(req),
    },
  });
}
