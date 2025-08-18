// src/app/krosy/route.ts
import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UPSTREAM =
  process.env.KROSY_TEST_VC_URL || "http://localhost:3001/test-visualcontrol";

const ALLOW = (process.env.KROSY_CLIENT_ORIGINS ||
  "http://localhost:3001,http://localhost:3002").split(",");

function cors(req: NextRequest) {
  const origin = req.headers.get("origin") || "";
  const allow = ALLOW.includes(origin) ? origin : ALLOW[0];
  return {
    "Access-Control-Allow-Origin": allow,
    Vary: "Origin",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
  };
}

export async function OPTIONS(req: NextRequest) {
  // respond 204 so preflight succeeds
  return new Response(null, { status: 204, headers: cors(req) });
}

export async function GET(req: NextRequest) {
  const headers = cors(req);
  const accept = req.headers.get("accept") || "application/json";

  const upstream = new URL(UPSTREAM);
  const here = new URL(req.url);
  upstream.search = here.search;

  const r = await fetch(upstream.toString(), {
    method: "GET",
    headers: { Accept: accept },
  });
  const body = await r.text();
  return new Response(body, {
    status: r.status,
    headers: { ...headers, "Content-Type": r.headers.get("content-type") ?? "application/octet-stream" },
  });
}

export async function POST(req: NextRequest) {
  const headers = cors(req);
  const accept = req.headers.get("accept") || "application/json";

  let payload: any = {};
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("application/json")) payload = await req.json();
  else if (ct.includes("application/x-www-form-urlencoded"))
    payload = Object.fromEntries(await req.formData());
  else payload = await req.json().catch(() => ({}));

  const r = await fetch(UPSTREAM, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: accept },
    body: JSON.stringify(payload),
  });
  const body = await r.text();
  return new Response(body, {
    status: r.status,
    headers: { ...headers, "Content-Type": r.headers.get("content-type") ?? "application/octet-stream" },
  });
}
