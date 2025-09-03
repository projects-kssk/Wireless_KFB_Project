// src/app/api/serial/sse/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
    const encoder = new TextEncoder();
    let ping;
    const stream = new ReadableStream({
        start(controller) {
            const send = (payload) => {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
            };
            // initial snapshot
            send({ type: "devices", devices: [] });
            // heartbeat
            ping = setInterval(() => {
                controller.enqueue(encoder.encode(`: ping\n\n`));
            }, 15000);
        },
        cancel() {
            if (ping)
                clearInterval(ping);
        },
    });
    return new Response(stream, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-store",
            Connection: "keep-alive",
            // Required for streaming in some proxies
            "Transfer-Encoding": "chunked",
        },
    });
}
