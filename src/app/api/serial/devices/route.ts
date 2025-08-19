// src/app/api/serial/devices/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Replace the stub with real enumeration if you wire in a server-side library.
export async function GET() {
  const devices: Array<{
    path: string;
    vendorId: string | null;
    productId: string | null;
    manufacturer: string | null;
    serialNumber: string | null;
  }> = [];

  return NextResponse.json({ devices });
}
