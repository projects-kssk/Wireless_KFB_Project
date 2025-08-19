// src/app/api/krosy-offline/route.ts
import { NextRequest } from "next/server";
import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RAW_ORIGINS = process.env.KROSY_CLIENT_ORIGINS ?? "*";
const ORIGINS = RAW_ORIGINS.split(",").map(s => s.trim());
const ALLOW_ANY = RAW_ORIGINS.trim() === "*";

const LOG_DIR = process.env.KROSY_LOG_DIR || path.join(process.cwd(), ".krosy-logs");
const XML_TARGET = (process.env.KROSY_XML_TARGET || "kssksun01").trim();

// OFFLINE TARGET (Next handler)
const OGLIEN_URL = (process.env.KROSY_OGLIEN_URL || "http://localhost:3001/visualcontrol").trim();

const VC_NS = "http://www.kroschu.com/kroscada/namespaces/krosy/visualcontrol/V_0_1";

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
  const candidates = rows.filter(r => !r.internal && r.family === "IPv4" && r.address);
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
  const accept = req.headers.get("accept") || "application/json";
  const body = (await req.json().catch(() => ({}))) as any;

  const intksk = String(body.intksk || "830569527900");
  const requestID = String(body.requestID || Date.now());
  const sourceHostname = String(body.sourceHostname || os.hostname());
  const xmlTargetHost = String(body.targetHostName || XML_TARGET).trim();
  const targetUrl = String(body.targetUrl || OGLIEN_URL).trim();

  const { ip, mac } = pickIpAndMac();
  const scanned = isoNoMs();

  const xml = buildXML({ requestID, srcHost: sourceHostname, targetHost: xmlTargetHost, scanned, ip, mac, intksk });

  // forward to offline visualcontrol (HTTP)
  let resOk = false, status = 0, text = "", err: string | null = null;
  try {
    const r = await fetch(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/xml", Accept: "application/xml,text/xml,*/*;q=0.1" },
      body: xml,
    });
    status = r.status;
    text = await r.text();
    resOk = r.ok;
  } catch (e: any) {
    err = e?.message || "network error";
  }

  // logs
  const stamp = nowStamp();
  const base = path.join(LOG_DIR, `${stamp}_${requestID}`);
  await Promise.allSettled([
    writeLog(base, "request.xml", xml),
    writeLog(base, "response.xml", text || ""),
    writeLog(base, "meta.json", JSON.stringify({ requestID, intksk, scanned, device: sourceHostname, targetUrl, httpStatus: status, ok: resOk, error: err }, null, 2)),
  ]);

  // passthrough
  if ((accept.includes("xml") || accept === "*/*") && text) {
    return new Response(text, {
      status: resOk ? 200 : 502,
      headers: { "Content-Type": "application/xml; charset=utf-8", "X-Krosy-Used-Url": targetUrl, ...cors(req) },
    });
  }
  return new Response(JSON.stringify({
    ok: resOk, requestID, httpStatus: status, usedUrl: targetUrl, error: err, responseXmlPreview: (text || "").slice(0, 2000),
  }, null, 2), { status: resOk ? 200 : 502, headers: { "Content-Type": "application/json", ...cors(req) } });
}
