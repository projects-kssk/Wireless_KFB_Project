import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Mirror the shape returned by SerialPort.list()
type DeviceInfo = {
  path: string;
  vendorId: string | null;
  productId: string | null;
  manufacturer: string | null;
  serialNumber: string | null;
};

export async function GET() {
  try {
    const mod = await import("@/lib/serial");

    // Type the function explicitly
    const listSerialDevices: () => Promise<DeviceInfo[]> =
      (mod as any).listSerialDevices ?? (mod as any).default?.listSerialDevices;

    if (typeof listSerialDevices !== "function") {
      return NextResponse.json(
        { ok: false, error: "listSerialDevices missing" },
        { status: 500 }
      );
    }

    // Optional allowlist via env: "1a86:7523,2341:0043"
    const allow = (process.env.SCANNER_VIDPIDS ?? "")
      .split(",")
      .map((s: string) => s.trim().toLowerCase())
      .filter(Boolean);

    const devices: DeviceInfo[] = await listSerialDevices();

    const matched: DeviceInfo[] = allow.length
      ? devices.filter((d: DeviceInfo) =>
          d.vendorId &&
          d.productId &&
          allow.includes(`${d.vendorId}:${d.productId}`.toLowerCase())
        )
      : devices;

    return NextResponse.json({
      ok: true,
      count: matched.length,
      devices: matched,
      allDevices: process.env.EXPOSE_ALL_DEVICES === "1" ? devices : undefined, // debug
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/serial/devices] error:", err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
