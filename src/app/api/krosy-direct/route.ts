// src/app/api/krosy-direct/route.ts
import { NextRequest } from "next/server";
import os from "node:os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NS =
  "http://www.kroschu.com/kroscada/namespaces/krosy/visualcontrol/V_0_1";

const DEFAULT_DEVICE_URL =
  process.env.KROSY_DEVICE_URL || "http://172.26.202.248/visualcontrol";

const ALLOW_ORIGINS = (process.env.KROSY_CLIENT_ORIGINS ||
  "http://localhost:3001,http://localhost:3002").split(",");

function cors(req: NextRequest) {
  const origin = req.headers.get("origin") || "";
  const allow = ALLOW_ORIGINS.includes(origin) ? origin : ALLOW_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    Vary: "Origin",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
  };
}

function isoNoMs(d = new Date()) {
  return d.toISOString().replace(/\.\d{3}Z$/, "");
}

function pickIpAndMac() {
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const ni of ifs[name] || []) {
      if (!ni.internal && ni.family === "IPv4" && ni.address) {
        return {
          ip: ni.address,
          mac: (ni.mac || "").toUpperCase().replace(/:/g, "-"),
        };
      }
    }
  }
  return { ip: "127.0.0.1", mac: "00-00-00-00-00-00" };
}

export async function OPTIONS(req: NextRequest) {
  return new Response(null, { status: 204, headers: cors(req) });
}

// Host info for disabled fields (hostname/ip/mac)
export async function GET(req: NextRequest) {
  const { ip, mac } = pickIpAndMac();
  return new Response(
    JSON.stringify({
      hostname: os.hostname(),
      ip,
      mac,
      defaultDeviceUrl: DEFAULT_DEVICE_URL,
    }),
    { status: 200, headers: { "Content-Type": "application/json", ...cors(req) } },
  );
}

// Send XML directly to device (no proxy, no targetUrl needed)
export async function POST(req: NextRequest) {
  const accept = req.headers.get("accept") || "application/json";
  const body = (await req.json().catch(() => ({}))) as any;

  const requestID = String(body.requestID || Date.now());
  const intksk = String(body.intksk || "950023158903");
  const targetHostName = String(body.targetHostName || "kssksun01");
  const deviceUrl = String(body.deviceUrl || DEFAULT_DEVICE_URL);

  const { ip, mac } = pickIpAndMac();
  const sourceHostname = String(body.sourceHostname || os.hostname());
  const scanned = isoNoMs();

  // Namespaced root as requested
  const xml =
    `<krosy xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="${NS}" xmlns:xsd="http://www.w3.org/2001/XMLSchema">` +
    `<header>` +
    `<sourcehost>` +
    `<requestid>${requestID}</requestid>` +
    `<hostname>${sourceHostname}</hostname>` +
    `<ip>${ip}</ip>` +
    `<macaddress>${mac}</macaddress>` +
    `</sourcehost>` +
    `<targethost><hostname>${targetHostName}</hostname></targethost>` +
    `</header>` +
    `<body><visualControl>` +
    `<workingRequest intksk="${intksk}" scanned="${scanned}" device="${sourceHostname}"/>` +
    `</visualControl></body>` +
    `</krosy>`;

  let status = 0,
    text = "",
    error: string | null = null;

  try {
    const r = await fetch(deviceUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/xml",
        Accept: "application/xml,text/xml,*/*;q=0.1",
      },
      body: xml,
    });
    status = r.status;
    text = await r.text();
  } catch (e: any) {
    error = e?.message || "network error";
  }

  const ok = !error && status >= 200 && status < 300;

  if ((accept.includes("xml") || accept === "*/*") && text) {
    return new Response(text, {
      status: ok ? 200 : 502,
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "X-Krosy-Used-Url": deviceUrl,
        ...cors(req),
      },
    });
  }

  return new Response(
    JSON.stringify({
      ok,
      requestID,
      usedUrl: deviceUrl,
      httpStatus: status,
      error,
      sentXmlPreview: xml.slice(0, 2000),
      responseXmlPreview: text.slice(0, 2000),
    }),
    { status: ok ? 200 : 502, headers: { "Content-Type": "application/json", ...cors(req) } },
  );
}
