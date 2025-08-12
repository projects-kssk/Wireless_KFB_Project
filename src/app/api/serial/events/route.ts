import { NextResponse } from "next/server";
import { onSerialEvent, broadcast } from "@/lib/bus";
import { listSerialDevices } from "@/lib/serial";
import { ensureScanner, sendAndReceive } from "@/lib/serial";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };
      const heartbeat = setInterval(() => {
        // SSE comment as keepalive
        controller.enqueue(encoder.encode(`: ping\n\n`));
      }, 15000);

      // subscribe to serial bus
      const unsubscribe = onSerialEvent((e) => send(e));

      // initial snapshot
      try {
        const devices = await listSerialDevices();
        send({ type: "devices", devices });
      } catch {}

      // keep trying to open scanner once (no-op if open)
      ensureScanner().catch(() => {});

      // periodic ESP ping + device refresh
      const pingTimer = setInterval(async () => {
        try {
          const raw = await sendAndReceive("PING", 3000);
          const ok = /OK|SUCCESS/i.test(raw);
          send({ type: "esp", ok, raw });
        } catch (err: any) {
          send({ type: "esp", ok: false, error: String(err?.message ?? err) });
        }

        try {
          const devices = await listSerialDevices();
          send({ type: "devices", devices });
        } catch {}
      }, 5000);

      // cleanup
      const close = () => {
        clearInterval(heartbeat);
        clearInterval(pingTimer);
        unsubscribe();
        controller.close();
      };

      // If the client disconnects, the stream cancels.
      (controller as any).__close = close;
    },
    cancel(reason) {
      // @ts-ignore
      const close = (this as any).__close as undefined | (() => void);
      if (close) close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
