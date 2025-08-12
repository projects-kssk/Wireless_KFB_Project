import { NextResponse } from 'next/server';

// Ensure this runs in the Node runtime (not edge)
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// TODO: replace this with your real discovery (mDNS/UDP/HTTP handshake)
// For now, we simulate a discovery and return a deterministic fake MAC.
async function discoverEspOverWifi(): Promise<string> {
  // Simulate 1.5s work
  await new Promise(r => setTimeout(r, 1500));
  // Example deterministic fake MAC
  const octets = Array.from({ length: 6 }, () => Math.floor(Math.random() * 256));
  return octets.map(b => b.toString(16).padStart(2, '0')).join(':').toUpperCase();
}

// OPTIONAL: persist to DB (Prisma example)
// import { prisma } from '@/lib/prisma';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const kfb: string | undefined = body?.kfb;

    const macAddress = await discoverEspOverWifi();

    // If you want to persist, uncomment & adapt:
    // if (kfb) {
    //   await prisma.configuration.update({
    //     where: { kfb },
    //     data: { mac_address: macAddress },
    //   });
    // }

    return NextResponse.json({ macAddress });
  } catch (e: any) {
    return new NextResponse(
      JSON.stringify({ error: e?.message || 'ESP discovery failed' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
