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

function envScannerPaths(): string[] {
  const base =
    process.env.SCANNER_TTY_PATHS ??
    process.env.SCANNER_TTY_PATH ??
    "/dev/ttyACM0";
  const list = base.split(",").map((s) => s.trim()).filter(Boolean);
  const s2 = (
    process.env.SCANNER2_TTY_PATH ?? process.env.SECOND_SCANNER_TTY_PATH ?? ""
  ).trim();
  if (s2 && !list.includes(s2)) list.push(s2);
  return Array.from(new Set(list));
}

export async function GET(req: Request) {
  const encoder = new TextEncoder();
  let closed = false;
  let heartbeat: NodeJS.Timeout | null = null;
  let pingTimer: NodeJS.Timeout | null = null;
  let unsubscribe: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
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
        // @ts-ignore Next.js attaches an AbortSignal
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
      const send = (obj: unknown) =>
        safeEnqueue(`data: ${JSON.stringify(obj)}\n\n`);
      const sendComment = (txt: string) => safeEnqueue(`: ${txt}\n\n`);

      // Heartbeat keepalive
      heartbeat = setInterval(() => sendComment("ping"), 15_000);

      // Subscribe to serial bus (scan/open/close/error events)
      unsubscribe = onSerialEvent((e) => send(e));

      // Configured scanner paths → tell the client
      const paths = envScannerPaths();
      send({ type: "scanner/paths", paths });

      // Initial snapshot: devices + ESP health + try to open scanners
      try {
        const devices = await listSerialDevices();
        send({ type: "devices", devices });

        // Reset cooldown if present, then (re)open scanners
        considerDevicesForScanner(devices, paths.join(","));
        ensureScanners(paths).catch((err: any) => {
          send({ type: "scanner/error", error: String(err?.message ?? err) });
        });
      } catch {
        // ignore listing errors
      }

      try {
        const { present, ok, raw } = await espHealth();
        send({ type: "esp", ok, raw, present });
      } catch (err: any) {
        send({ type: "esp", ok: false, error: String(err?.message ?? err) });
      }

      // Periodic ESP health + device refresh + conditional reopen
      pingTimer = setInterval(async () => {
        try {
          const { present, ok, raw } = await espHealth();
          send({ type: "esp", ok, raw, present });
        } catch (err: any) {
          send({ type: "esp", ok: false, error: String(err?.message ?? err) });
        }

        try {
          const devices = await listSerialDevices();
          send({ type: "devices", devices });

          if (considerDevicesForScanner(devices, paths.join(","))) {
            ensureScanners(paths).catch(() => {});
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
      // helps some proxies to stream
      "Transfer-Encoding": "chunked",
    },
  });
}
