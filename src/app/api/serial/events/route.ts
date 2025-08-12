// src/app/api/serial/events/route.ts
import { onSerialEvent } from "@/lib/bus";
import { listSerialDevices, ensureScanner, sendAndReceive } from "@/lib/serial";

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
        try { controller.close(); } catch {}
      };

      // Close when the client disconnects
      try {
        // @ts-ignore – Next.js Request has a signal
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

      // heartbeat keepalive
      heartbeat = setInterval(() => sendComment("ping"), 15000);

      // subscribe to serial bus
      unsubscribe = onSerialEvent((e) => send(e));

      // initial snapshot
      try {
        const devices = await listSerialDevices();
        send({ type: "devices", devices });
      } catch {
        // ignore
      }

      // try to open scanner once; if not present, report as event (no crash)
      ensureScanner().catch((err: any) => {
        const msg = String(err?.message ?? err);
        send({ type: "scanner/error", error: msg });
      });

      // periodic ESP ping + device refresh
      pingTimer = setInterval(async () => {
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
        } catch {
          // ignore
        }
      }, 5000);

      // expose cleanup to cancel()
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
