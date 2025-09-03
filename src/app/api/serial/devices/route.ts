// src/app/api/serial/devices/route.ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

import { listSerialDevices } from '@/lib/serial';

export async function GET() {
  try {
    const devices = await listSerialDevices();
    return Response.json({ devices }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
