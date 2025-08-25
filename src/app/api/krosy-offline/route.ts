// src/app/api/krosy-offline/route.ts
import { NextRequest } from "next/server";
import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ===== utils ===== */
function formatXml(xml: string) {
  try {
    const reg = /(>)(<)(\/*)/g;
    let out = xml.replace(/\r?\n|\r/g, "").replace(reg, "$1\n$2$3");
    let pad = 0;
    return out
      .split("\n")
      .map((ln) => {
        let indent = 0;
        if (ln.match(/^<\/\w/) || ln.match(/^<\w[^>]*\/>/)) indent = -1;
        const line = `${"  ".repeat(Math.max(pad + indent, 0))}${ln}`;
        if (ln.match(/^<\w[^>]*[^/]>/) && !ln.startsWith("<?")) pad += 1;
        if (ln.match(/^<\/\w/)) pad = Math.max(pad - 1, 0);
        return line;
      })
      .join("\n");
  } catch {
    return xml;
  }
}

const RAW_ORIGINS = process.env.KROSY_CLIENT_ORIGINS ?? "*";
const ORIGINS = RAW_ORIGINS.split(",").map(s => s.trim());
const ALLOW_ANY = RAW_ORIGINS.trim() === "*";

const LOG_DIR = process.env.KROSY_LOG_DIR || path.join(process.cwd(), ".krosy-logs");
const XML_TARGET = (process.env.KROSY_XML_TARGET || "kssksun01").trim();
const OGLIEN_URL = (process.env.KROSY_OGLIEN_URL || "http://localhost:3000/api/krosy").trim();
const VC_NS = "http://www.kroschu.com/kroscada/namespaces/krosy/visualcontrol/V_0_1";
const TIMEOUT_MS = Number(process.env.KROSY_TIMEOUT_MS ?? 5000);

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

const isoNoMs = (d = new Date()) => d.toISOString().replace(/\.\d{3}Z$/, "");
const nowStamp = () => isoNoMs().replace(/[:T]/g, "-");

const t = () => new Date().toTimeString().slice(0, 8);
const line = (s: string) => `[${t()}] ${s}`;

async function ensureDir(p: string) { await fs.mkdir(p, { recursive: true }); }
async function writeLog(base: string, name: string, content: string) {
  await ensureDir(base);
  await fs.writeFile(path.join(base, name), content ?? "", "utf8");
}

function pickIpAndMac() {
  const want = (process.env.KROSY_NET_IFACE || "").trim();
  const rows: { name: string; address?: string; mac?: string; internal?: boolean; family?: string }[] = [];
  for (const [name, arr] of Object.entries(os.networkInterfaces())) for (const ni of arr || []) rows.push({ name, ...ni });
  const candidates = rows.filter(r =>
    !r.internal && r.family === "IPv4" && r.address && !/^169\.254\./.test(r.address)
  );
  const chosen =
    (want && candidates.find(r => r.name === want)) ||
    candidates.find(r => ["eth0","en0","ens160","ens192"].includes(r.name)) ||
    candidates[0];
  const addr = chosen?.address || "127.0.0.1";
  const mac = (chosen?.mac || "00:00:00:00:00:00").toUpperCase().replace(/:/g, "-");
  return { ip: addr, mac };
}

function buildXML(a: {
  requestID: string; srcHost: string; targetHost: string; scanned: string; ip: string; mac: string; intksk: string;
}) {
  const { requestID, srcHost, targetHost, scanned, ip, mac, intksk } = a;
  return (
    `<krosy xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="${VC_NS}" xmlns:xsd="http://www.w3.org/2001/XMLSchema">` +
    `<header><requestID>${requestID}</requestID><sourceHost><hostname>${srcHost}</hostname><ipAddress>${ip}</ipAddress><macAddress>${mac}</macAddress></sourceHost><targetHost><hostname>${targetHost}</hostname></targetHost></header>` +
    `<body><visualControl><workingRequest intksk="${intksk}" scanned="${scanned}" device="${srcHost}"/></visualControl></body>` +
    `</krosy>`
  );
}

// namespace-agnostic detector for <workingData ...>
const WORKINGDATA_RE = /<(?:[A-Za-z_][\w.\-]*:)?workingData\b[^>]*>/i;
function hasWorkingDataTag(xml: string) {
  return WORKINGDATA_RE.test(xml || "");
}

export async function OPTIONS(req: NextRequest) {
  return new Response(null, { status: 204, headers: cors(req) });
}

export async function GET(req: NextRequest) {
  const { ip, mac } = pickIpAndMac();
  return new Response(JSON.stringify({ hostname: os.hostname(), ip, mac }), {
    status: 200, headers: { "Content-Type": "application/json", ...cors(req) },
  });
}

/** POST JSON: { intksk?, requestID?, sourceHostname?, targetHostName?, targetUrl? } */
export async function POST(req: NextRequest) {
  const accept = (req.headers.get("accept") || "application/json").toLowerCase();
  const body = (await req.json().catch(() => ({}))) as any;

  const intksk = String(body.intksk || "830569527900");
  const requestID = String(body.requestID || Date.now());
  const sourceHostname = String(body.sourceHostname || os.hostname());
  const xmlTargetHost = String(body.targetHostName || XML_TARGET).trim();
  const targetUrl = String(body.targetUrl || OGLIEN_URL).trim();

  const { ip, mac } = pickIpAndMac();
  const scanned = isoNoMs();

  const xml = buildXML({ requestID, srcHost: sourceHostname, targetHost: xmlTargetHost, scanned, ip, mac, intksk });

  const stamp = nowStamp();
  const base = path.join(LOG_DIR, `${stamp}_${requestID}`);
  const lines: string[] = [];
  const push = (s: string) => { const l = line(s); lines.push(l); console.log(l); };

  push(`POST ${targetUrl} [visualControl: working] (OFFLINE)`);

  let status = 0, text = "", err: string | null = null;
  const t0 = Date.now();
  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), TIMEOUT_MS);

  try {
    const r = await fetch(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/xml", Accept: "application/xml,text/xml,*/*;q=0.1" },
      body: xml,
      signal: ac.signal,
    });
    status = r.status;
    text = await r.text();
  } catch (e: any) {
    err = e?.name === "AbortError" ? `timeout after ${TIMEOUT_MS} ms` : (e?.message || "network error");
  } finally {
    clearTimeout(timeout);
  }

  const ms = Date.now() - t0;
  push(`→ HTTP ${status || 0} in ${ms} ms`);

  const hasWorkingData = text ? hasWorkingDataTag(text) : false;
  push(hasWorkingData ? `found <workingData> → checkpoint enabled` : `no <workingData> in response → checkpoint disabled to work`);

  const resOk = status >= 200 && status < 300 && hasWorkingData && !err;

  await Promise.allSettled([
    writeLog(base, "request.xml", formatXml(xml)),
    writeLog(base, "response.xml", formatXml(text || "")),
    writeLog(
      base,
      "meta.json",
      JSON.stringify(
        {
          requestID,
          intksk,
          scanned,
          device: sourceHostname,
          targetUrl,
          httpStatus: status || 0,
          ok: resOk,
          error: err,
          duration_ms: ms,
          logLines: lines,
        },
        null,
        2,
      ),
    ),
  ]);

  const headers = { ...cors(req), "X-Krosy-Used-Url": targetUrl, "X-Krosy-Duration": String(ms) };

  if ((accept.includes("xml") || accept === "*/*") && text) {
    return new Response(formatXml(text), {
      status: resOk ? 200 : 502,
      headers: { "Content-Type": "application/xml; charset=utf-8", ...headers },
    });
  }

  return new Response(
    JSON.stringify(
      {
        ok: resOk,
        requestID,
        httpStatus: status || 0,
        usedUrl: targetUrl,
        error: err,
        hasWorkingData,
        logs: lines,
        responseXmlPreview: formatXml((text || "")).slice(0, 2000),
      },
      null,
      2,
    ),
    { status: resOk ? 200 : 502, headers: { "Content-Type": "application/json", ...headers } },
  );
}
