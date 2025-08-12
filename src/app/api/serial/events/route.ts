// src/app/api/serial/events/route.ts
import { onSerialEvent } from "@/lib/bus";
import {
  listSerialDevices,
  ensureScanners,
  considerDevicesForScanner,
  espHealth,
} from "@/lib/serial";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const encoder = new TextEncoder();
  let closed = false;
  let heartbeat: NodeJS.Timeout | null = null;
  let pingTimer: NodeJS.Timeout | null = null;
  let unsubscribe: (() => void) | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        if (pingTimer) clearInterval(pingTimer);
        if (unsubscribe) unsubscribe();
        try {
          controller.close();
        } catch {}
      };

      // Close when the client disconnects
      try {
        // @ts-ignore Next.js provides an AbortSignal on Request
        req.signal?.addEventListener("abort", cleanup);
      } catch {}

      const safeEnqueue = (text: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          cleanup();
        }
      };
      const send = (obj: unknown) => safeEnqueue(`data: ${JSON.stringify(obj)}\n\n`);
      const sendComment = (txt: string) => safeEnqueue(`: ${txt}\n\n`);

      // Heartbeat keepalive
      heartbeat = setInterval(() => sendComment("ping"), 15_000);

      // Subscribe to serial bus (scan/open/close/error events)
      unsubscribe = onSerialEvent((e) => send(e));

      // Initial snapshot: devices + ESP health
      try {
        const devices = await listSerialDevices();
        send({ type: "devices", devices });

        // Let scanner logic know devices are present and open if available
        considerDevicesForScanner(devices);
        ensureScanners().catch((err: any) => {
          send({ type: "scanner/error", error: String(err?.message ?? err) });
        });
      } catch {}

      try {
        const { present, ok, raw } = await espHealth();
        // ok === presence only if ESP_PING_CMD is blank, otherwise presence && ping OK
        send({ type: "esp", ok, raw, present });
      } catch (err: any) {
        send({ type: "esp", ok: false, error: String(err?.message ?? err) });
      }

      // Periodic ESP health + device refresh
      pingTimer = setInterval(async () => {
        // ESP health
        try {
          const { present, ok, raw } = await espHealth();
          send({ type: "esp", ok, raw, present });
        } catch (err: any) {
          send({ type: "esp", ok: false, error: String(err?.message ?? err) });
        }

        // Devices & conditional scanner reconnect
        try {
          const devices = await listSerialDevices();
          send({ type: "devices", devices });

          // Reset cooldown if devices appeared; try (re)open
          if (considerDevicesForScanner(devices)) {
            ensureScanners().catch(() => {});
          }
        } catch {
          // ignore list errors
        }
      }, 5_000);

      // Expose cleanup to cancel()
      (controller as any).__cleanup = cleanup;
    },

    cancel() {
      // @ts-ignore
      const cleanup = (this as any).__cleanup as undefined | (() => void);
      if (cleanup) cleanup();
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
