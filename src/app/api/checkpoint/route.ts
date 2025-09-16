import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonHeaders() {
  return {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    ...CORS,
  };
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function POST(req: NextRequest) {
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  try {
    console.log('[checkpoint] received', { hasBody: body != null });
  } catch {}
  return NextResponse.json({ ok: true }, { status: 200, headers: jsonHeaders() });
}

export async function GET() {
  return NextResponse.json({ ok: true }, { status: 200, headers: jsonHeaders() });
}
