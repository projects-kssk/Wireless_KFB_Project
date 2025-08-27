// src/app/api/serial/check/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import serial from '@/lib/serial';
import { LOG } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const log = LOG.tag('api:serial/check');

const Body = z.object({
  pins: z.array(z.number().int()),
  mac: z.string().min(1),
});

// Fast turnaround. Scanner re-triggers checks, so don’t block long.
const HANDSHAKE_TIMEOUT_MS = 1500;
const RESULT_TIMEOUT_MS = 1500;

const locks = new Set<string>();

const esc = (s: string) => s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
const normMac = (s: string) => s.trim().toUpperCase();
const escMac = (s: string) => esc(normMac(s));

function buildMatchers(macUp: string, pinsCsv: string) {
  const MAC = escMac(macUp);
  const PINS = esc(pinsCsv);

  // This CHECK handshake
  const SENT_RE = new RegExp(`Sent\\s+'CHECK\\s+${PINS}'\\s+to\\s+${MAC}\\b`, 'i');

  // Terminal results only
  const RESULT_RE = new RegExp(`\\bRESULT\\s+(SUCCESS|FAILURE[^\\n]*)\\b.*${MAC}\\b`, 'i');
  const REPLY_RESULT_RE = new RegExp(
    `^\\s*←\\s*reply\\s+from\\s+${MAC}\\s*:\\s*(SUCCESS|FAILURE[^\\n]*)`,
    'i'
  );

  // Errors
  const IGNORED_RE = new RegExp(
    `ignored:\\s+unexpected\\s+MAC\\.?\\s*expected\\s*${MAC}\\s*got\\s*([0-9A-F:]{17})`,
    'i'
  );
  const INVALID_RE = /ERROR:\s*invalid\s*MAC/i;
  const ADDPEER_RE = /ERROR:\s*add_peer\s*failed/i;
  const SENDFAIL_RE = /ERROR:\s*send\s*failed/i;

  const isResult = (s: string) => RESULT_RE.test(s) || REPLY_RESULT_RE.test(s);
  return {
    SENT_RE,
    RESULT_RE,
    REPLY_RESULT_RE,
    IGNORED_RE,
    INVALID_RE,
    ADDPEER_RE,
    SENDFAIL_RE,
    isResult,
  };
}

function parseFailuresFromLine(line: string, pins: number[]) {
  const want = new Set<number>(pins);
  const miss =
    line.match(/MISSING\s+([0-9,\s]+)/i) ||
    line.match(/FAILURES?\s*:\s*([0-9,\s]+)/i);

  const failures = new Set<number>();
  (miss?.[1] ?? '')
    .split(/[,\s]+/)
    .forEach((x) => {
      const n = Number(x);
      if (Number.isInteger(n) && want.has(n)) failures.add(n);
    });

  return Array.from(failures).sort((a, b) => a - b);
}

function getTail(): string[] {
  try {
    const s = (serial as any).getEspLineStream?.();
    return Array.isArray(s?.ring) ? s.ring.slice(-200).map(String) : [];
  } catch {
    return [];
  }
}

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: 'Expected { pins, mac }' }, { status: 400 });

  const macUp = normMac(parsed.data.mac);
  if (locks.has(macUp)) return NextResponse.json({ error: 'busy' }, { status: 429 });
  locks.add(macUp);

  try {
    const { pins } = parsed.data;
    const pinsCsv = pins.join(',');

    const { sendToEsp, waitForNextLine } = serial as any;
    if (typeof sendToEsp !== 'function' || typeof waitForNextLine !== 'function') {
      throw new Error('serial-helpers-missing');
    }

    const {
      SENT_RE,
      RESULT_RE,
      REPLY_RESULT_RE,
      IGNORED_RE,
      INVALID_RE,
      ADDPEER_RE,
      SENDFAIL_RE,
      isResult,
    } = buildMatchers(macUp, pinsCsv);

    const signal = (request as any).signal;

    // Fire command
    await sendToEsp(`CHECK ${pinsCsv} ${macUp}`);

    // Sync to this transaction quickly
    await waitForNextLine(SENT_RE, signal, HANDSHAKE_TIMEOUT_MS);

    // Wait briefly for a terminal RESULT from this transaction
    const pResult = waitForNextLine(isResult, signal, RESULT_TIMEOUT_MS);
    const pIgnored = waitForNextLine(IGNORED_RE, signal, RESULT_TIMEOUT_MS).then(
      (s: string) => {
        const m = s.match(IGNORED_RE);
        throw new Error(
          `mac-mismatch expected ${macUp} got ${m?.[1] ?? '?'}`
        );
      }
    );
    const pInvalid = waitForNextLine(INVALID_RE, signal, RESULT_TIMEOUT_MS).then(
      () => {
        throw new Error('station-invalid-mac');
      }
    );
    const pAddPeer = waitForNextLine(ADDPEER_RE, signal, RESULT_TIMEOUT_MS).then(
      () => {
        throw new Error('station-add-peer-failed');
      }
    );
    const pSendFail = waitForNextLine(SENDFAIL_RE, signal, RESULT_TIMEOUT_MS).then(
      () => {
        throw new Error('station-send-failed');
      }
    );

    let line: string | null = null;
    try {
      line = String(
        await Promise.race([pResult, pIgnored, pInvalid, pAddPeer, pSendFail])
      ).trim();
    } catch (e: any) {
      // Timeout or non-fatal error: scan tail for latest terminal line
      if (String(e?.message ?? e) === 'timeout') {
        const tail = getTail();
        const MAC = escMac(macUp);
        const RESULT_RE = new RegExp(
          `\\bRESULT\\s+(SUCCESS|FAILURE[^\\n]*)\\b.*${MAC}\\b`,
          'i'
        );
        const REPLY_RESULT_RE = new RegExp(
          `^\\s*←\\s*reply\\s+from\\s+${MAC}\\s*:\\s*(SUCCESS|FAILURE[^\\n]*)`,
          'i'
        );
        for (let i = tail.length - 1; i >= 0; i--) {
          const ln = tail[i];
          const m = ln.match(RESULT_RE) || ln.match(REPLY_RESULT_RE);
          if (m && /^FAILURE/i.test(m[1])) {
            line = ln;
            break;
          }
          if (m && /^SUCCESS/i.test(m[1])) {
            line = ln;
            break;
          }
        }
      } else {
        throw e;
      }
    }

    if (!line) {
      // No signal yet. Return empty failures. Scanner will re-trigger.
      return NextResponse.json({ failures: [] });
    }

    // Terminal parse
    const m1 = line.match(RESULT_RE) || line.match(REPLY_RESULT_RE);
    if (m1 && /^SUCCESS/i.test(m1[1])) {
      return NextResponse.json({ failures: [] });
    }

    // FAILURE → return pin list
    const failures = parseFailuresFromLine(line, pins);
    return NextResponse.json({ failures });
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    const status =
      msg === 'client-abort'
        ? 499
        : msg === 'timeout'
        ? 504
        : /mac-mismatch/.test(msg)
        ? 502
        : /station-(invalid-mac|add-peer-failed|send-failed)/.test(msg)
        ? 502
        : 500;

    // Safe diagnostics
    try {
      const s = (serial as any).getEspLineStream?.();
        if (Array.isArray(s?.ring)) {
          const tail = s.ring.slice(-50);
          log.error('[serial/check tail]', { mac: parsed.success ? normMac(parsed.data.mac) : 'n/a', tail });
        } else {
          log.error('[serial/check tail]', { mac: parsed.success ? normMac(parsed.data.mac) : 'n/a', tail: [] });
        }
    } catch (err) {
      log.error('[serial/check tail] failed', { mac: parsed.success ? normMac(parsed.data.mac) : 'n/a', error: String(err) });
    }

    log.error('[serial/check]', { mac: parsed.success ? normMac(parsed.data.mac) : 'n/a', msg, status });
    return NextResponse.json({ error: msg }, { status });
  } finally {
    locks.delete(macUp);
  }
}
