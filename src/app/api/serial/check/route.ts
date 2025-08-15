// app/api/serial/check/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ pins: z.array(z.number().int()), mac: z.string().min(1) });

const RX_OK = /^\s*(?:>>\s*)?(?:RESULT\s+)?SUCCESS\s*$/i;

let inFlight = false;

function escMac(mac: string) { return mac.trim().toUpperCase().replace(/:/g, '\\:'); }

async function waitFresh(
  getEspLineStream: () => any,
  matcher: (s: string) => boolean,
  signal?: AbortSignal,
  timeoutMs = 12_000
): Promise<string> {
  const { parser } = getEspLineStream() as any;

  return new Promise<string>((resolve, reject) => {
    let timer: NodeJS.Timeout | null = null;

    const finish = (err?: any, val?: string) => {
      try { parser.off('data', onData); } catch {}
      if (signal) try { signal.removeEventListener('abort', onAbort); } catch {}
      if (timer) clearTimeout(timer);
      err ? reject(err) : resolve(val as string);
    };

    const onData = (buf: Buffer | string) => {
      const s = String(buf).trim();
      if (s && matcher(s)) finish(undefined, s);
    };
    const onAbort = () => finish(new Error('client-abort'));
    const onTimeout = () => finish(new Error('timeout'));

    if (signal?.aborted) return onAbort();
    signal?.addEventListener('abort', onAbort, { once: true });

    // attach before we send
    if (typeof (parser as any).prependListener === 'function') {
      (parser as any).prependListener('data', onData);
    } else {
      parser.on('data', onData);
    }
    timer = setTimeout(onTimeout, timeoutMs);
  });
}

export async function POST(request: Request) {
  if (inFlight) return NextResponse.json({ error: 'busy' }, { status: 429 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Expected { pins, mac }' }, { status: 400 });

  inFlight = true;
  try {
    const { pins, mac } = parsed.data;
    const mod = await import('@/lib/serial');
    const helper: any = (mod as any).default ?? mod;
    const { sendToEsp, getEspLineStream } = helper;
    if (typeof sendToEsp !== 'function' || typeof getEspLineStream !== 'function') {
      throw new Error('serial-helpers-missing');
    }

    const macUp = mac.toUpperCase();
    const cmd = `CHECK ${pins.join(',')} ${macUp}`;
    const RESULT_RE = new RegExp(`^\\s*RESULT\\s+(SUCCESS|FAILURE.*)\\s+${escMac(macUp)}\\s*$`, 'i');

    const waiter = waitFresh(getEspLineStream, s => RESULT_RE.test(s) || RX_OK.test(s), (request as any).signal, 12_000);
    await sendToEsp(cmd);
    const line = (await waiter).trim();

    if (RX_OK.test(line) || /\bSUCCESS\b/i.test(line)) {
      return NextResponse.json({ failures: [] });
    }

    // Intersect with requested pins only; ignore EXTRA noise.
    const want = new Set<number>(pins);
    const out = new Set<number>();
    const m = line.match(/MISSING\s+([0-9,\s]+)/i) || line.match(/FAILURES?\s*:\s*([0-9,\s]+)/i);
    (m?.[1] ?? '')
      .split(/[,\s]+/)
      .map(x => parseInt(x, 10))
      .filter(n => Number.isInteger(n) && want.has(n))
      .forEach(n => out.add(n));

    return NextResponse.json({ failures: Array.from(out).sort((a, b) => a - b) });
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    const status = msg === 'client-abort' ? 499 : msg === 'timeout' ? 504 : 500;
    return new NextResponse(JSON.stringify({ error: msg }), {
      status, headers: { 'Content-Type': 'application/json' },
    });
  } finally {
    inFlight = false;
  }
}
