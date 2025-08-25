import { NextRequest } from "next/server";
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
const XML_TARGET = (process.env.KROSY_XML_TARGET || "kssksun01").trim();
const TCP_TIMEOUT_MS = Number(process.env.KROSY_TCP_TIMEOUT_MS || 10000);
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

/**
 * POST JSON:
 * {
 *   intksk?: "950023158903",
 *   requestID?: "1",
 *   sourceHostname?: "ksskkfb01",
 *   targetHostName?: "kssksun01",
 *   targetAddress?: "172.26.192.1:10080"
 * }
 */
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
  const out = await sendTcp(connectHost, tcpPort, xml);
  const durationMs = Date.now() - started;

  // Pretty-print XML response when present
  let prettyResp: string | null = null;
  try { if (out.text && out.text.trim().startsWith("<")) prettyResp = prettyXml(out.text); } catch {}

  // Derived flags for client to avoid re-post "upgrade"
  const responseXmlRaw = out.text || "";
  const hasWorkingData = hasWorkingDataTag(responseXmlRaw);
  const isComplete = isCompleteKrosy(responseXmlRaw);

  // Logs
  try {
    const stamp = nowStamp();
    const base = path.join(LOG_DIR, `${stamp}_${requestID}`);
    await Promise.all([
      writeLog(base, "request.xml", xml),
      writeLog(base, "request.pretty.xml", prettyReq),
      writeLog(base, "response.xml", responseXmlRaw),
      writeLog(base, "response.pretty.xml", prettyResp || responseXmlRaw),
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
  } catch {}

  // XML response branch
  if ((accept.includes("xml") || accept === "*/*") && responseXmlRaw.trim().startsWith("<")) {
    return new Response(prettyResp || responseXmlRaw, {
      status: out.ok ? 200 : 502,
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Krosy-Used-Url": out.used,
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
      ...cors(req),
    },
  });
}
