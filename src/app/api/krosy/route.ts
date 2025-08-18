// app/krosy/route.ts  (runs on port 3002)
import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TEST_URL = process.env.KROSY_TEST_URL || "http://localhost:3001/test-visualcontrol";

const cors = {
  "Access-Control-Allow-Origin": "http://localhost:3002",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: cors });
}

export async function POST(req: NextRequest) {
  // pass-through JSON from the page; if no targetUrl provided, the 3001 route will default to /visualcontrol
  const body = await req.json().catch(() => ({}));
  const accept = req.headers.get("accept") || "application/json";

  const resp = await fetch(TEST_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: accept },
    body: JSON.stringify(body),
  });

  const text = await resp.text();
  const type = resp.headers.get("content-type") || (accept.includes("xml") ? "application/xml" : "application/json");
  return new Response(text, { status: resp.status, headers: { "Content-Type": type, ...cors } });
}
