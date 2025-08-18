import { NextRequest } from "next/server";
import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import net from "node:net";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ===== Env ===== */
const RAW_ORIGINS = process.env.KROSY_CLIENT_ORIGINS ?? "*";
const ORIGINS = RAW_ORIGINS.split(",").map(s => s.trim());
const ALLOW_ANY = RAW_ORIGINS.trim() === "*";

const LOG_DIR = process.env.KROSY_LOG_DIR || path.join(process.cwd(), ".krosy-logs");

const TRANSPORT = (process.env.KROSY_TRANSPORT || "tcp").toLowerCase(); // "tcp" | "http"
const KROSY_HOST = (process.env.KROSY_HOST || "").trim();               // e.g. "192.20.10.1"
const TCP_PORT = Number(process.env.KROSY_TCP_PORT || 10080);

const HTTP_SCHEME = process.env.KROSY_SCHEME || "http://";
const HTTP_PATH = process.env.KROSY_DEVICE_PATH || "/visualcontrol";

const DEFAULT_ACTION = (process.env.KROSY_DEFAULT_ACTION || "working").toLowerCase(); // "working" = visualControl

/* ===== Namespaces ===== */
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

/* ===== HTTP target url ===== */
function httpUrl(host: string) {
  if (/^https?:\/\//i.test(host)) return `${host}${HTTP_PATH}`;
  return `${HTTP_SCHEME}${host}${HTTP_PATH}`;
}

/* ===== XML builders ===== */
// visualControl plugin — EXACT shape you provided
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

// legacy “order” shapes for the other plugin
function xmlHeaderLegacy(requestID: string, srcHost: string, targetHost: string, ip: string, mac: string) {
  return (
    `<header>` +
      `<sourcehost><requestid>${requestID}</requestid><hostname>${srcHost}</hostname><ip>${ip}</ip><macaddress>${mac}</macaddress></sourcehost>` +
      `<targethost><hostname>${targetHost}</hostname></targethost>` +
    `</header>`
  );
}
function buildRequestXML(a:{requestID:string;srcHost:string;targetHost:string;scanned:string;ip:string;mac:string;scancode:string;}) {
  const { requestID, srcHost, targetHost, scanned, ip, mac, scancode } = a;
  return `<krosy>${xmlHeaderLegacy(requestID, srcHost, targetHost, ip, mac)}<body device="${srcHost}" ordercount="1"><order id="1" scancode="${scancode}" type="1" state="1" timestamp="${scanned}"/></body></krosy>`;
}
function buildIoXML(a:{requestID:string;srcHost:string;targetHost:string;scanned:string;ip:string;mac:string;scancode:string;tident:string;sdistance:string;}) {
  const { requestID, srcHost, targetHost, scanned, ip, mac, scancode, tident, sdistance } = a;
  return `<krosy>${xmlHeaderLegacy(requestID, srcHost, targetHost, ip, mac)}<body device="${srcHost}" ordercount="1"><order id="1" type="2" state="3" scancode="${scancode}" timestamp="${scanned}" amountok="1"><result><objects objectcount="1"><object id="1" state="3"><terminal ident="${tident}" distance="${sdistance}"></terminal></object></objects></result></order></body></krosy>`;
}
function buildCancelXML(a:{requestID:string;srcHost:string;targetHost:string;scanned:string;ip:string;mac:string;scancode:string;tident:string;sdistance:string;}) {
  const { requestID, srcHost, targetHost, scanned, ip, mac, scancode, tident, sdistance } = a;
  return `<krosy>${xmlHeaderLegacy(requestID, srcHost, targetHost, ip, mac)}<body device="${srcHost}" ordercount="1"><order id="1" type="2" state="-1" scancode="${scancode}" timestamp="${scanned}" amountok="0"><errors errorcount="1" langu="en"><error id="1" message="Wrong parameter"/></errors><result><objects objectcount="1"><object id="1" state="0"><terminal ident="${tident}" distance="${sdistance}"></terminal></object></objects></result></order></body></krosy>`;
}
function buildNioXML(a:{requestID:string;srcHost:string;targetHost:string;scanned:string;ip:string;mac:string;scancode:string;tident:string;sdistance:string;}) {
  const { requestID, srcHost, targetHost, scanned, ip, mac, scancode, tident, sdistance } = a;
  return `<krosy>${xmlHeaderLegacy(requestID, srcHost, targetHost, ip, mac)}<body device="${srcHost}" ordercount="1"><order id="1" type="2" state="-101" scancode="${scancode}" timestamp="${scanned}" amountok="0"><errors errorcount="1" langu="en"><error id="1" message="Process with failure"/></errors><result><objects objectcount="1"><object id="1" state="-135"><errors errorcount="1" langu="en"><error id="1" message="motor has an error"/></errors><terminal ident="${tident}" distance="${sdistance}"></terminal></object></objects></result></order></body></krosy>`;
}

/* ===== Transport ===== */
async function sendHttp(host: string, xml: string) {
  const url = httpUrl(host);
  try {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/xml", Accept: "application/xml,text/xml,*/*;q=0.1" }, body: xml });
    return { ok: r.ok, status: r.status, text: await r.text(), error: null as string | null, used: url };
  } catch (e: any) {
    return { ok: false, status: 0, text: "", error: e?.message || "network error", used: url };
  }
}
function sendTcp(host: string, port: number, xml: string) {
  return new Promise<{ ok: boolean; status: number; text: string; error: string | null; used: string }>((resolve) => {
    const socket = new net.Socket();
    let buf = "";
    let doneOnce = false;
    const used = `tcp://${host}:${port}`;
    const finish = (ok: boolean, status: number, err: string | null) => {
      if (doneOnce) return;
      doneOnce = true;
      try { socket.destroy(); } catch {}
      resolve({ ok, status, text: buf, error: err, used });
    };
    socket.setTimeout(5000);
    socket.connect(port, host, () => socket.write(xml));
    socket.on("data", (c) => {
      buf += c.toString("utf8");
      if (buf.includes("</krosy>") || buf.trim().toLowerCase() === "ack") finish(true, 200, null);
    });
    socket.on("end", () => finish(true, 200, null));
    socket.on("timeout", () => finish(false, 0, "tcp timeout"));
    socket.on("error", (err) => finish(false, 0, err?.message || "tcp error"));
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
    headers: { "Content-Type": "application/json", ...cors(req) },
  });
}

/**
 * POST JSON:
 * {
 *   action?: "working" | "request" | "io" | "nio" | "cancel",  // default "working" = visualControl
 *   intksk?: "950023158903",                                    // used in "working"
 *   scancode?: "830569527900",                                  // used in legacy actions
 *   tident?: "P8378691", sdistance?: "20",                      // legacy io/nio/cancel
 *   requestID?: "1", sourceHostname?: "ksmiwct07", targetHostName?: "ksmisun01" // overrides KROSY_HOST
 * }
 */
export async function POST(req: NextRequest) {
  const accept = req.headers.get("accept") || "application/json";
  const body = (await req.json().catch(() => ({}))) as any;

  const action = String(body.action || DEFAULT_ACTION).toLowerCase() as "working" | "request" | "io" | "nio" | "cancel";
  const intksk = String(body.intksk || "950023158903");
  const scancode = String(body.scancode || "000000000000");
  const tident = String(body.tident || "TIDENT");
  const sdistance = String(body.sdistance || "0");

  const requestID = String(body.requestID || Date.now());
  const sourceHostname = String(body.sourceHostname || os.hostname());
  const host = String(body.targetHostName || KROSY_HOST || "localhost");

  const { ip, mac } = pickIpAndMac();
  const scanned = isoNoMs();

  // Build XML
  let xml = "";
  if (action === "working") {
    xml = buildVisualControlWorkingXML({
      requestID, srcHost: sourceHostname, targetHost: host, scanned, ip, mac, intksk,
    });
  } else if (action === "io") {
    xml = buildIoXML({ requestID, srcHost: sourceHostname, targetHost: host, scanned, ip, mac, scancode, tident, sdistance });
  } else if (action === "nio") {
    xml = buildNioXML({ requestID, srcHost: sourceHostname, targetHost: host, scanned, ip, mac, scancode, tident, sdistance });
  } else if (action === "cancel") {
    xml = buildCancelXML({ requestID, srcHost: sourceHostname, targetHost: host, scanned, ip, mac, scancode, tident, sdistance });
  } else {
    xml = buildRequestXML({ requestID, srcHost: sourceHostname, targetHost: host, scanned, ip, mac, scancode });
  }

  // Send
  const started = Date.now();
  const out = TRANSPORT === "tcp" ? await sendTcp(host, TCP_PORT, xml) : await sendHttp(host, xml);
  const durationMs = Date.now() - started;

  // Logs
  try {
    const stamp = nowStamp();
    const base = path.join(LOG_DIR, `${stamp}_${requestID}`);
    await Promise.all([
      writeLog(base, "request.xml", xml),
      writeLog(base, "response.xml", out.text || ""),
      writeLog(base, "meta.json", JSON.stringify({
        action, intksk, scancode, tident, sdistance,
        requestID, device: sourceHostname, host,
        transport: TRANSPORT, used: out.used,
        httpStatus: out.status, durationMs, ok: out.ok, error: out.error,
      }, null, 2)),
    ]);
  } catch { /* ignore log failures */ }

  // Response
  if ((accept.includes("xml") || accept === "*/*") && out.text) {
    return new Response(out.text, {
      status: out.ok ? 200 : 502,
      headers: { "Content-Type": "application/xml; charset=utf-8", "X-Krosy-Used-Url": out.used, ...cors(req) },
    });
  }
  return new Response(JSON.stringify({
    ok: out.ok,
    requestID,
    usedUrl: out.used,
    httpStatus: out.status,
    durationMs,
    error: out.error,
    sentXmlPreview: xml.slice(0, 2000),
    responseXmlPreview: (out.text || "").slice(0, 2000),
  }), { status: out.ok ? 200 : 502, headers: { "Content-Type": "application/json", ...cors(req) } });
}
