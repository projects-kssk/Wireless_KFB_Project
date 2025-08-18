// src/app/api/krosy/route.ts
import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TEST_VC = process.env.TEST_VC_URL || "http://localhost:3001/test-visualcontrol";

function cors(req: NextRequest) {
  const origin = req.headers.get("origin") || "http://localhost:3001";
  return {
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
  };
}

export async function OPTIONS(req: NextRequest) {
  return new Response(null, { status: 204, headers: cors(req) });
}

// Quick liveness check: GET /api/krosy -> { alive: true }
export async function GET(req: NextRequest) {
  return new Response(JSON.stringify({ alive: true }), {
    status: 200,
    headers: { "Content-Type": "application/json", ...cors(req) },
  });
}

// POST /api/krosy -> forwards to /test-visualcontrol (JSON or XML passthrough)
export async function POST(req: NextRequest) {
  const accept = req.headers.get("accept") || "application/json";
  const body = await req.json().catch(() => ({} as any));
  const payload = {
    intksk: body.intksk ?? "950023158903",
    device: body.device ?? "ksmiwct07",
    scanned: body.scanned ?? new Date().toISOString().replace(/\.\d{3}Z$/, ""),
    targetUrl: body.targetUrl ?? "http://localhost:3001/visualcontrol",
  };

  const upstream = await fetch(TEST_VC, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: accept },
    body: JSON.stringify(payload),
  });

  const text = await upstream.text();
  const ct =
    upstream.headers.get("content-type") ||
    (accept.includes("xml") ? "application/xml" : "application/json");

  return new Response(text, {
    status: upstream.status,
    headers: { "Content-Type": ct, ...cors(req) },
  });
}
