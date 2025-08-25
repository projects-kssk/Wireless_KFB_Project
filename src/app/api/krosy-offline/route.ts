// src/app/api/krosy-offline/route.ts
import { NextRequest } from "next/server";
import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ===== utils ===== */
// Whitespace-tolerant pretty-printer
function formatXml(xml: string) {
  try {
    let out = xml
      .replace(/^\uFEFF/, "")
      .replace(/\r?\n|\r/g, "")
      .replace(/>\s+</g, ">\n<")
      .trim();

    let pad = 0;
    const lines = out.split("\n").map((raw) => raw.trim());
    const pretty = lines.map((ln) => {
      const isClosing = /^<\//.test(ln);
      const isSelf = /\/>$/.test(ln);
      const isOpen = /^<[^!?/][^>]*>$/.test(ln) && !isSelf;

      if (isClosing) pad = Math.max(pad - 1, 0);
      const line = `${"  ".repeat(pad)}${ln}`;
      if (isOpen) pad += 1;
      return line;
    });
    return pretty.join("\n");
  } catch {
    return xml;
  }
}

const XML_DECL = '<?xml version="1.0" encoding="UTF-8"?>';
function prettyXml(raw: string): string {
  if (!raw) return "";
  const body = raw.replace(/^\uFEFF/, "").replace(/^\s*<\?xml[^>]*\?>\s*/i, "");
  const withDecl = `${XML_DECL}\n${body}`;
  return formatXml(withDecl);
}

function msFmt(ms: number) {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`;
}
function yesNo(b: boolean) {
  return b ? "yes" : "no";
}
function truncate(s: string, max = 2000) {
  if (!s) return "";
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n[... ${s.length - max} more chars truncated]`;
}
function padKey(k: string, w = 14) {
  return (k + ":").padEnd(w + 1, " ");
}
function buildReport(a: {
  timestamp: string;
  requestID: string;
  intksk: string;
  device: string;
  targetUrl: string;
  httpStatus: number;
  ok: boolean;
  error: string | null;
  duration_ms: number;
  hasWorkingData: boolean;
  scanned: string;
  timeline: string[];
  responsePreview: string;
}) {
  const statusLabel =
    a.httpStatus >= 200 && a.httpStatus < 300 ? "OK" : a.httpStatus ? "ERROR" : "NO RESPONSE";
  const header = `=== KROSY OFFLINE REPORT =================================================
${padKey("timestamp")} ${a.timestamp}
${padKey("requestID")} ${a.requestID}
${padKey("device")} ${a.device}
${padKey("intksk")} ${a.intksk}
${padKey("targetUrl")} ${a.targetUrl}
${padKey("status")} ${a.httpStatus} ${statusLabel}
${padKey("duration")} ${msFmt(a.duration_ms)}
${padKey("workingData")} ${yesNo(a.hasWorkingData)}
${padKey("ok")} ${yesNo(a.ok)}
${padKey("error")} ${a.error ?? "none"}
${padKey("scanned")} ${a.scanned}
-------------------------------------------------------------------------`;
  const timeline = a.timeline.length
    ? ["Timeline:", ...a.timeline.map((l) => `  ${l}`)].join("\n")
    : "Timeline:\n  [no events]";
  const preview = `Response XML (pretty, truncated):
${truncate(a.responsePreview, 4000)}
=========================================================================`;
  return [header, timeline, preview].join("\n");
}

/* ===== config ===== */
const RAW_ORIGINS = process.env.KROSY_CLIENT_ORIGINS ?? "*";
const ORIGINS = RAW_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);
const ALLOW_ANY = RAW_ORIGINS.trim() === "*";

const LOG_DIR = process.env.KROSY_LOG_DIR || path.join(process.cwd(), ".krosy-logs");
const XML_TARGET = (process.env.KROSY_XML_TARGET || "kssksun01").trim();
const OGLIEN_URL = (process.env.KROSY_OGLIEN_URL || "http://localhost:3000/api/krosy").trim();
const VC_NS = "http://www.kroschu.com/kroscada/namespaces/krosy/visualcontrol/V_0_1";
const TIMEOUT_MS = Number(process.env.KROSY_TIMEOUT_MS ?? 5000);
const PREVIEW_LIMIT = Number(process.env.KROSY_PREVIEW_LIMIT ?? 2000);
const RAW_LIMIT = Number(process.env.KROSY_RAW_LIMIT ?? 64000);

/* ===== http ===== */
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

/* ===== time + logging ===== */
const isoNoMs = (d = new Date()) => d.toISOString().replace(/\.\d{3}Z$/, "");
const nowStamp = () => isoNoMs().replace(/[:T]/g, "-");
const t = () => new Date().toTimeString().slice(0, 8);
const line = (s: string) => `[${t()}] ${s}`;

async function ensureDir(p: string) {
  await fs.mkdir(p, { recursive: true });
}
async function writeLog(base: string, name: string, content: string) {
  await ensureDir(base);
  await fs.writeFile(path.join(base, name), content ?? "", "utf8");
}

/* ===== net id ===== */
function pickIpAndMac() {
  const want = (process.env.KROSY_NET_IFACE || "").trim();
  const rows: { name: string; address?: string; mac?: string; internal?: boolean; family?: string }[] = [];
  for (const [name, arr] of Object.entries(os.networkInterfaces()))
    for (const ni of arr || []) rows.push({ name, ...ni });
  const candidates = rows.filter(
    (r) => !r.internal && r.family === "IPv4" && r.address && !/^169\.254\./.test(r.address || ""),
  );
  const chosen =
    (want && candidates.find((r) => r.name === want)) ||
    candidates.find((r) => ["eth0", "en0", "ens160", "ens192"].includes(r.name)) ||
    candidates[0];
  const addr = chosen?.address || "127.0.0.1";
  const mac = (chosen?.mac || "00:00:00:00:00:00").toUpperCase().replace(/:/g, "-");
  return { ip: addr, mac };
}

/* ===== xml build ===== */
function buildXML(a: {
  requestID: string;
  srcHost: string;
  targetHost: string;
  scanned: string;
  ip: string;
  mac: string;
  intksk: string;
}) {
  const { requestID, srcHost, targetHost, scanned, ip, mac, intksk } = a;
  return (
    `<krosy xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="${VC_NS}" xmlns:xsd="http://www.w3.org/2001/XMLSchema">` +
    `<header><requestID>${requestID}</requestID><sourceHost><hostname>${srcHost}</hostname><ipAddress>${ip}</ipAddress><macAddress>${mac}</macAddress></sourceHost><targetHost><hostname>${targetHost}</hostname></targetHost></header>` +
    `<body><visualControl><workingRequest intksk="${intksk}" scanned="${scanned}" device="${srcHost}"/></visualControl></body>` +
    `</krosy>`
  );
}

/* ===== xml detection ===== */
const WORKINGDATA_RE = /<(?:[A-Za-z_][\w.\-]*:)?workingData\b[^>]*>/i;
function hasWorkingDataTag(xml: string) {
  return WORKINGDATA_RE.test(xml || "");
}
function isCompleteKrosy(xml: string) {
  return /^\s*<krosy[\s>][\s\S]*<\/krosy>\s*$/i.test(xml || "");
}

/* ===== handlers ===== */
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
  const xml = buildXML({
    requestID,
    srcHost: sourceHostname,
    targetHost: xmlTargetHost,
    scanned,
    ip,
    mac,
    intksk,
  });

  const stamp = nowStamp();
  const base = path.join(LOG_DIR, `${stamp}_${requestID}`);
  const lines: string[] = [];
  const push = (s: string) => {
    const l = line(s);
    lines.push(l);
    console.log(l);
  };

  push(`POST ${targetUrl} [visualControl: working] (OFFLINE)`);

  let status = 0,
    text = "",
    err: string | null = null;
  const t0 = Date.now();
  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), TIMEOUT_MS);

  try {
    const r = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/xml",
        Accept: "application/xml,text/xml,*/*;q=0.1",
      },
      body: xml,
      signal: ac.signal,
    });
    status = r.status;
    text = await r.text();
  } catch (e: any) {
    err = e?.name === "AbortError" ? `timeout after ${TIMEOUT_MS} ms` : e?.message || "network error";
  } finally {
    clearTimeout(timeout);
  }

  const ms = Date.now() - t0;
  push(`→ HTTP ${status || 0} in ${ms} ms`);

  // Compute server-truth flags
  const responsePretty = prettyXml(text || "");
  const hasWorkingData = text ? hasWorkingDataTag(text) : false;
  const complete = isCompleteKrosy(text || "");
  const preview = responsePretty.length > PREVIEW_LIMIT;
  const responseXmlPreview = truncate(responsePretty, PREVIEW_LIMIT);

  // Logging aligned to policy
  push(
    hasWorkingData
      ? `found <workingData> (OFFLINE) → checkpoint disabled by policy`
      : `no <workingData> in response → checkpoint disabled`,
  );

  const resOk = status >= 200 && status < 300 && hasWorkingData && !err;

  // Build human report
  const report = buildReport({
    timestamp: isoNoMs(),
    requestID,
    intksk,
    device: sourceHostname,
    targetUrl,
    httpStatus: status || 0,
    ok: resOk,
    error: err,
    duration_ms: ms,
    hasWorkingData,
    scanned,
    timeline: lines,
    responsePreview: responsePretty,
  });

  await Promise.allSettled([
    writeLog(base, "request.xml", prettyXml(xml)),
    writeLog(base, "response.xml", responsePretty),
    writeLog(base, "report.log", report),
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
          hasWorkingData,
          logLines: lines,
        },
        null,
        2,
      ),
    ),
  ]);

  const headers = {
    ...cors(req),
    "X-Krosy-Used-Url": targetUrl,
    "X-Krosy-Duration": String(ms),
  };

  // XML passthrough for Accept: xml
  if ((accept.includes("xml") || accept === "*/*") && text) {
    return new Response(responsePretty, {
      status: resOk ? 200 : 502,
      headers: { "Content-Type": "application/xml; charset=utf-8", ...headers },
    });
  }

  // JSON response
  const maybeRaw = responsePretty.length <= RAW_LIMIT ? responsePretty : undefined;
  return new Response(
    JSON.stringify(
      {
        ok: resOk,
        requestID,
        httpStatus: status || 0,
        usedUrl: targetUrl,
        error: err,
        hasWorkingData,
        isComplete: complete,
        isPreview: preview,
        responseXmlPreview, // truncated pretty
        responseXmlPreviewLength: responseXmlPreview.length,
        responseXmlRaw: maybeRaw, // when small enough
        responseXmlRawLength: responsePretty.length,
        logText: report,
        logs: lines,
      },
      null,
      2,
    ),
    { status: resOk ? 200 : 502, headers: { "Content-Type": "application/json", ...headers } },
  );
}
