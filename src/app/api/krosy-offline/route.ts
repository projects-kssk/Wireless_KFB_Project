// src/app/api/krosy-offline/route.ts
import { NextRequest } from "next/server";
import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { LOG } from '@/lib/logger';

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const log = LOG.tag('api:krosy-offline');

/* ===== utils ===== */
// Whitespace-tolerant pretty-printer
function formatXml(xml: string) {
  try {
    let out = xml
      .replace(/^\uFEFF/, "")
      .replace(/\r?\n|\r/g, "")
      // Ensure a newline between every tag boundary, even when there is no whitespace
      .replace(/>\s*</g, ">\n<")
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
const XML_TARGET = (process.env.KROSY_XML_TARGET || "ksskkfb01").trim();
const OGLIEN_URL = (process.env.KROSY_OGLIEN_URL || "http://localhost:3001/api/visualcontrol").trim();
const OFFLINE_PORT = Number(process.env.KROSY_OFFLINE_PORT || 3001);
const OFFLINE_PATH = (process.env.KROSY_OFFLINE_PATH || "/api/visualcontrol").trim();
const VC_NS = "http://www.kroschu.com/kroscada/namespaces/krosy/visualcontrol/V_0_1";
const TIMEOUT_MS = Number(process.env.KROSY_TIMEOUT_MS ?? 5000);
const PREVIEW_LIMIT = Number(process.env.KROSY_PREVIEW_LIMIT ?? 2000);
const RAW_LIMIT = Number(process.env.KROSY_RAW_LIMIT ?? 64000);

/* ===== http ===== */
function cors(req: NextRequest) {
  const origin = req.headers.get("origin") || "";
  let allow = "";
  if (ALLOW_ANY) {
    allow = "*";
  } else if (ORIGINS.includes(origin)) {
    allow = origin;
  } else {
    // Be lenient with localhost vs 127.0.0.1 and explicit ports
    try {
      const o = new URL(origin);
      const host = o.hostname;
      const port = o.port || (o.protocol === 'https:' ? '443' : '80');
      const swapHost = host === '127.0.0.1' ? 'localhost' : host === 'localhost' ? '127.0.0.1' : null;
      if (swapHost) {
        const swapped = `${o.protocol}//${swapHost}:${port}`;
        if (ORIGINS.includes(swapped)) allow = origin;
      }
      // Also accept when ORIGINS contains protocol-less hosts
      if (!allow) {
        for (const a of ORIGINS) {
          try {
            const aa = new URL(a);
            if (aa.hostname === host && (aa.port || (aa.protocol === 'https:' ? '443' : '80')) === port) { allow = origin; break; }
          } catch { /* ignore */ }
        }
      }
    } catch {}
    if (!allow) allow = ORIGINS[0] || "";
  }
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
async function uniqueBase(root: string, stem: string): Promise<string> {
  const tryPath = (s: string) => path.join(root, s);
  try {
    await fs.stat(tryPath(stem));
  } catch { return tryPath(stem); }
  for (let i = 1; i < 1000; i++) {
    const alt = `${stem}__${String(i).padStart(2, '0')}`;
    try { await fs.stat(tryPath(alt)); }
    catch { return tryPath(alt); }
  }
  return tryPath(`${stem}__dup`);
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
  const { ip, mac } = pickIpAndMac();
  // Compute effective target URL:
  // 1) Explicit body.targetUrl wins
  // 2) If KROSY_OGLIEN_URL set, use it (localhost is OK for server-side calls)
  // 3) Otherwise, use discovered network IP and OFFLINE_PORT/PATH (e.g., http://<ip>:3001/api/visualcontrol)
  let targetUrl = String(body.targetUrl || "").trim();
  if (!targetUrl) {
    if (OGLIEN_URL) targetUrl = OGLIEN_URL;
  }
  if (!targetUrl) {
    const base = `http://${ip}:${OFFLINE_PORT}`;
    targetUrl = `${base}${OFFLINE_PATH.startsWith('/') ? OFFLINE_PATH : '/' + OFFLINE_PATH}`;
  }

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
  const lines: string[] = [];
  const push = (s: string) => {
    const l = line(s);
    lines.push(l);
    log.info(l);
  };

  push(`POST ${targetUrl} [visualControl: working] (OFFLINE)`);
  // Debug: surface OGLIEN_URL and effective targetUrl
  try { log.info('offline.forward.config', { OGLIEN_URL, targetUrl }); } catch {}

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

  let upstreamJson: any = null;
  try { upstreamJson = text && text.trim().startsWith("{") ? JSON.parse(text) : null; } catch {}

  const responsePretty = upstreamJson ? "" : prettyXml(text || "");
  const hasWorkingData =
    upstreamJson
      ? !!upstreamJson?.response?.krosy?.body?.visualControl?.workingData
      : (text ? hasWorkingDataTag(text) : false);
  const complete = upstreamJson ? true : isCompleteKrosy(text || "");
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
    // Request logs: raw + pretty (normalized across online/offline)
    writeLog(base, "request.raw.xml", xml),
    writeLog(base, "request.pretty.xml", prettyXml(xml)),
    // Backward-compat duplicates (for tools/scripts expecting old names)
    writeLog(base, "request.xml", xml),
    // Response logs: raw + pretty when available
    writeLog(base, "response.raw.xml", upstreamJson ? JSON.stringify(upstreamJson, null, 2) : (text || "")),
    writeLog(base, "response.pretty.xml", upstreamJson ? "" : responsePretty),
    // Backward-compat duplicate
    writeLog(base, "response.xml", upstreamJson ? JSON.stringify(upstreamJson, null, 2) : (text || "")),
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
  try { await (async function pruneOldLogs(root, maxAgeDays = 31){
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
  })(LOG_DIR, 31); } catch {}

  const headers = {
    ...cors(req),
    "X-Krosy-Used-Url": targetUrl,
    "X-Krosy-Duration": String(ms),
    ...(base ? { "X-Krosy-Log-Path": base } : {}),
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
        responseXmlPreview: upstreamJson ? undefined : responsePretty && responsePretty.slice(0, PREVIEW_LIMIT),
        responseXmlPreviewLength: upstreamJson ? undefined : responsePretty ? Math.min(responsePretty.length, PREVIEW_LIMIT) : 0,
        responseXmlRaw: upstreamJson ? undefined : maybeRaw,
        responseXmlRawLength: upstreamJson ? undefined : responsePretty.length,
         responseJsonRaw: upstreamJson || undefined,
        logText: report,
        logs: lines,
      },
      null,
      2,
    ),
    { status: resOk ? 200 : 502, headers: { "Content-Type": "application/json", ...headers } },
  );
}
