import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { mac, kfb } = (await req.json()) as { mac?: string; kfb?: string | null };

    if (!mac || typeof mac !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid "mac".' }, { status: 400 });
    }

    // Simulate an I/O call to device / broker
    await new Promise((r) => setTimeout(r, 800));

    return NextResponse.json({
      ok: true,
      mac,
      message: `Test command queued for ${mac}${kfb ? ` (KFB ${kfb})` : ''}.`,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Unexpected error.' }, { status: 500 });
  }
}
