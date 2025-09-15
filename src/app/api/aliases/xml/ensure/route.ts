// src/app/api/aliases/xml/ensure/route.ts
import { NextRequest, NextResponse } from "next/server";
import net from "node:net";
import os from "node:os";
import { getRedis } from "@/lib/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAC_RE = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i;
const KSK_RE = /^\d{12}$/;

function parseHostPort(raw: string, defPort: number): { host: string; port: number } {
  const m = String(raw || "").match(/^(.*?):(\d+)$/);
  if (m) return { host: m[1], port: Number(m[2]) };
  return { host: String(raw || ""), port: defPort };
}

function pickIp(): string {
  for (const arr of Object.values(os.networkInterfaces()))
    for (const ni of arr || [])
      if (!ni.internal && ni.family === "IPv4" && ni.address && !/^169\.254\./.test(ni.address))
        return ni.address;
  return "127.0.0.1";
}

function apikingRequestXML(a: { requestID: string; srcHost: string; targetHost: string; scanned: string; ip: string; mac: string; intksk: string; }) {
  const { requestID, srcHost, targetHost, scanned, ip, mac, intksk } = a;
  return (
    `<krosy xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="http://www.kroschu.com/kroscada/namespaces/krosy/visualcontrol/V_0_1" xmlns:xsd="http://www.w3.org/2001/XMLSchema">` +
    `<header><requestID>${requestID}</requestID><sourceHost><hostname>${srcHost}</hostname><ipAddress>${ip}</ipAddress><macAddress>${mac}</macAddress></sourceHost><targetHost><hostname>${targetHost}</hostname></targetHost></header>` +
    `<body><visualControl><workingRequest intksk="${intksk}" scanned="${scanned}" device="${srcHost}"/></visualControl></body>` +
    `</krosy>`
  );
}

async function sendTcp(host: string, port: number, xml: string, timeoutMs: number): Promise<{ ok: boolean; text: string; used: string; status: number; error: string | null }>{
  return new Promise((resolve) => {
    const used = `tcp://${host}:${port}`;
    const socket = new net.Socket();
    let out = Buffer.alloc(0);
    let finished = false;
    const done = (ok: boolean, error: string | null) => {
      if (finished) return;
      finished = true;
      try { socket.destroy(); } catch {}
      resolve({ ok, text: out.toString("utf8"), used, status: ok ? 200 : 502, error });
    };
    socket.setTimeout(Math.max(1000, timeoutMs), () => done(false, "timeout"));
    socket.on("error", (e: any) => done(false, e?.message || "tcp error"));
    socket.connect(port, host, () => {
      try { socket.write(xml); } catch {}
    });
    socket.on("data", (chunk: Buffer) => {
      out = Buffer.concat([out, chunk]);
    });
    socket.on("end", () => done(true, null));
    socket.on("close", () => done(out.length > 0, out.length > 0 ? null : "closed"));
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as any));
  const mac = String(body.mac || "").toUpperCase();
  const ksk = String(body.ksk || body.kssk || "").trim();
  if (!MAC_RE.test(mac) || !KSK_RE.test(ksk))
    return NextResponse.json({ ok: false, error: "invalid-params" }, { status: 400 });

  const r: any = getRedis();
  let xmlKey = `kfb:aliases:xml:${mac}:${ksk}`;
  try {
    const have = await r?.get?.(xmlKey);
    if (have) return NextResponse.json({ ok: true, existed: true, bytes: Buffer.byteLength(have, 'utf8') });
  } catch {}

  const connectRaw = (process.env.KROSY_CONNECT_HOST || "172.26.192.1:10080").trim();
  const { host, port } = parseHostPort(connectRaw, Number(process.env.KROSY_TCP_PORT || 10080));
  const reqId = String(body.requestID || Date.now());
  const xml = apikingRequestXML({
    requestID: reqId,
    srcHost: os.hostname(),
    targetHost: (process.env.KROSY_XML_TARGET || "ksskkfb01").trim(),
    scanned: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    ip: pickIp(),
    mac,
    intksk: ksk,
  });
  const resp = await sendTcp(host, port, xml, Number(process.env.KROSY_TCP_TIMEOUT_MS || 10000));
  if (!resp.ok || !resp.text || !resp.text.trim().startsWith("<")) {
    return NextResponse.json({ ok: false, phase: 'workingRequest', used: resp.used, status: resp.status, error: resp.error || 'no xml' }, { status: 502 });
  }

  try { await r?.set?.(xmlKey, resp.text); } catch {}
  return NextResponse.json({ ok: true, saved: true, bytes: Buffer.byteLength(resp.text, 'utf8') });
}
