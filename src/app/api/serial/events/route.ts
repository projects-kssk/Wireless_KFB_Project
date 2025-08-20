import os from "os";
import { promises as fs } from "fs";
import { onSerialEvent } from "@/lib/bus";
import {
  listSerialDevices,
  ensureScanners,
  considerDevicesForScanner,
  espHealth,
} from "@/lib/serial";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** From env (SCANNER_TTY_PATHS/SCANNER_TTY_PATH) plus optional SCANNER2_TTY_PATH */
function envScannerPaths(): string[] {
  const base =
    process.env.SCANNER_TTY_PATHS ??
    process.env.SCANNER_TTY_PATH ??
    "/dev/ttyACM0";
  const list = base.split(",").map((s) => s.trim()).filter(Boolean);
  const s2 =
    (process.env.SCANNER2_TTY_PATH ??
      process.env.SECOND_SCANNER_TTY_PATH ??
      "").trim();
  if (s2 && !list.includes(s2)) list.push(s2);
  return Array.from(new Set(list));
}

/** Heuristic: looks like a serial tty path */
const isLikelySerialPath = (p: string) =>
  /\/dev\/(tty(ACM|USB)\d+|tty\.usb|cu\.usb)/i.test(p);

/** Which interface to treat as the “server” uplink */
function netIfaceName() {
  return (process.env.NET_IFACE || "eth0").trim();
}

async function ethStatus() {
  const iface = netIfaceName();
  const ifaces = os.networkInterfaces();
  const present = !!ifaces[iface];

  // Linux hints (best-effort)
  let oper: string | null = null;
  let carrier: string | null = null;
  try {
    oper = (await fs.readFile(`/sys/class/net/${iface}/operstate`, "utf8")).trim();
  } catch {}
  try {
    carrier = (await fs.readFile(`/sys/class/net/${iface}/carrier`, "utf8")).trim();
  } catch {}

  const ip =
    (ifaces[iface] || [])
      .filter((x) => (x as any).family === "IPv4" && !x.internal)
      .map((x) => (x as any).address)[0] ?? null;

  const up = oper === "up" || carrier === "1" || !!ip;
  return { iface, present, up, ip, oper };
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
        try { controller.close(); } catch {}
      };

      // @ts-ignore Next.js attaches AbortSignal
      try { req.signal?.addEventListener("abort", cleanup); } catch {}

      const safeEnqueue = (text: string) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(text)); }
        catch { cleanup(); }
      };
      const send = (obj: unknown) => safeEnqueue(`data: ${JSON.stringify(obj)}\n\n`);
      const sendComment = (txt: string) => safeEnqueue(`: ${txt}\n\n`);

      // Heartbeat
      heartbeat = setInterval(() => sendComment("ping"), 15_000);

      // Relay bus events (scan/open/close/error)
      unsubscribe = onSerialEvent((e) => send(e));

      // Initial NET
      try {
        const net = await ethStatus();
        send({ type: "net", ...net });
      } catch {}

      // Configured scanner paths
      const configured = envScannerPaths();
      let allPaths = configured.slice();
      send({ type: "scanner/paths", paths: allPaths });

      // Initial snapshot: devices + ESP + open scanners
      try {
        const devices = await listSerialDevices();
        send({ type: "devices", devices });

        // Discover additional serial-ish paths present now
        const discovered = devices
          .map((d) => d.path)
          .filter(Boolean)
          .filter(isLikelySerialPath);
        allPaths = Array.from(new Set([...allPaths, ...discovered]));
        if (allPaths.length) send({ type: "scanner/paths", paths: allPaths });

        // Reset cooldowns and (re)open
        considerDevicesForScanner(devices, allPaths.join(","));
        ensureScanners(allPaths).catch((err: any) => {
          send({ type: "scanner/error", error: String(err?.message ?? err) });
        });
      } catch {}

      // ESP once at start
      try {
        const { present, ok, raw } = await espHealth();
        send({ type: "esp", ok, raw, present });
      } catch (err: any) {
        send({ type: "esp", ok: false, error: String(err?.message ?? err) });
      }

      // Periodic polling: ESP, NET, devices (+ opportunistic reopen)
      pingTimer = setInterval(async () => {
        // ESP
        try {
          const { present, ok, raw } = await espHealth();
          send({ type: "esp", ok, raw, present });
        } catch (err: any) {
          send({ type: "esp", ok: false, error: String(err?.message ?? err) });
        }

        // NET
        try {
          const net = await ethStatus();
          send({ type: "net", ...net });
        } catch {}

        // Devices + path discovery + conditional reopen
        try {
          const devices = await listSerialDevices();
          send({ type: "devices", devices });

          const discoveredNow = devices
            .map((d) => d.path)
            .filter(Boolean)
            .filter(isLikelySerialPath);
          const nextAll = Array.from(new Set([...allPaths, ...discoveredNow]));
          if (nextAll.length !== allPaths.length) {
            allPaths = nextAll;
            send({ type: "scanner/paths", paths: allPaths });
          }

          if (considerDevicesForScanner(devices, allPaths.join(","))) {
            ensureScanners(allPaths).catch(() => {});
          }
        } catch {}
      }, 5_000);

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
      "Transfer-Encoding": "chunked",
    },
  });
}
