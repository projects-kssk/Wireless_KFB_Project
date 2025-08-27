// src/app/api/serial/check/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import serial from '@/lib/serial';
import { LOG } from '@/lib/logger';
import crypto from 'node:crypto';
import { ridFrom } from '@/lib/rid';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const log = LOG.tag('api:serial/check');
const mon = LOG.tag('monitor');

// Accept either { mac } or { mac, pins }
const Body = z.object({
  mac: z.string().min(1),
  pins: z.array(z.number().int()).optional(),
});

// Fast turnaround. Scanner re-triggers checks, so don’t block long.
// Keep handshake wait short for faster checks; override via env if needed
const HANDSHAKE_TIMEOUT_MS = Number(process.env.CHECK_HANDSHAKE_TIMEOUT_MS ?? 200);
const RESULT_TIMEOUT_MS = Number(process.env.CHECK_RESULT_TIMEOUT_MS ?? 5000);

const locks = new Set<string>();

const esc = (s: string) => s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
const normMac = (s: string) => s.trim().toUpperCase();
const escMac = (s: string) => esc(normMac(s));

function buildMatchers(macUp: string) {
  const MAC = escMac(macUp);

  // This CHECK handshake — accept any content after CHECK inside quotes
  const SENT_RE = new RegExp(`Sent\\s+'CHECK[^']*'\\s+to\\s+${MAC}\\b`, 'i');

  // Terminal results only
  const RESULT_RE = new RegExp(`\\bRESULT\\s+(SUCCESS|OK|FAIL(?:URE)?[^\\n]*)\\b.*${MAC}\\b`, 'i');
  const REPLY_RESULT_RE = new RegExp(
    `^\\s*←\\s*(?:reply|resp|response)\\s+from\\s+${MAC}\\s*:\\s*(?:RESULT\\s+)?(SUCCESS|OK|FAIL(?:URE)?[^\\n]*)`,
    'i'
  );
  const OK_ONLY_RE = /^\s*(?:OK|SUCCESS)\s*$/i;

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
    OK_ONLY_RE,
  };
}

function parseFailuresFromLine(line: string, pins?: number[]) {
  const want = Array.isArray(pins) && pins.length > 0 ? new Set<number>(pins) : null;
  // Known patterns first
  const patterns = [
    /MISSING\s+([0-9,\s]+)/i,
    /FAILURES?\s*:\s*([0-9,\s]+)/i,
    /FAILED\s+PINS?\s*:\s*([0-9,\s]+)/i,
    /OPEN\s+PINS?\s*:\s*([0-9,\s]+)/i,
    /BAD\s+PINS?\s*:\s*([0-9,\s]+)/i,
  ];
  let captured: string | null = null;
  for (const rx of patterns) {
    const m = line.match(rx);
    if (m && m[1]) { captured = m[1]; break; }
  }

  const failures = new Set<number>();

  if (captured) {
    captured.split(/[,\s]+/).forEach((x) => {
      const n = Number(x);
      if (!Number.isInteger(n)) return;
      if (want) { if (want.has(n)) failures.add(n); }
      else failures.add(n);
    });
  } else {
    // Fallback: collect any standalone numbers in the line,
    // but first remove MAC-like tokens to avoid false positives (e.g., 08:3A:..)
    const sanitized = line.replace(/\b(?:[0-9A-F]{2}:){5}[0-9A-F]{2}\b/ig, '');
    const nums = sanitized.match(/\b\d{1,4}\b/g) || [];
    for (const s of nums) {
      const n = Number(s);
      if (!Number.isInteger(n)) continue;
      if (want) { if (want.has(n)) failures.add(n); }
      else failures.add(n);
    }
  }

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
  const rid = ridFrom(request);
  const t0 = Date.now();
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: 'Expected { mac } or { mac, pins }' }, { status: 400, headers: { 'X-Req-Id': rid } });

  const macUp = normMac(parsed.data.mac);
  if (locks.has(macUp)) return NextResponse.json({ error: 'busy' }, { status: 429 });
  locks.add(macUp);

  try {
    // Leave undefined if client didn't provide pins, so we don't filter out everything
    const pins = parsed.data.pins;

    const { sendToEsp, waitForNextLine } = serial as any;
    if (typeof sendToEsp !== 'function' || typeof waitForNextLine !== 'function') {
      throw new Error('serial-helpers-missing');
    }

    log.info('CHECK begin', { rid, mac: macUp, pins: pins?.length ?? 0 });
    if ((process.env.LOG_MONITOR_START_ONLY ?? '0') !== '1') {
      mon.info(`CHECK start mac=${macUp} pins=${pins?.length ?? 0}`);
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
      OK_ONLY_RE,
    } = buildMatchers(macUp);

    const signal = (request as any).signal;

    // Fire command
    if ((process.env.LOG_MONITOR_START_ONLY ?? '0') !== '1') {
      mon.info(`CHECK send mac=${macUp} cmd='CHECK ${macUp}'`);
    }
    await sendToEsp(`CHECK ${macUp}`);

    // Optional handshake: don't fail if not seen
    try {
      await waitForNextLine(SENT_RE, signal, HANDSHAKE_TIMEOUT_MS);
    } catch (e: any) {
      if (String(e?.message ?? e) !== 'timeout') throw e;
      // proceed without handshake; device may not emit it
    }

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
    const pOkOnly = waitForNextLine(OK_ONLY_RE, signal, RESULT_TIMEOUT_MS);
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
        await Promise.race([pResult, pIgnored, pInvalid, pAddPeer, pSendFail, pOkOnly])
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
          `^\\s*←\\s*reply\\s+from\\s+${MAC}\\s*:\\s*(?:RESULT\\s+)?(SUCCESS|FAILURE[^\\n]*)`,
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
        log.warn('CHECK timeout; tail scan applied', { rid, mac: macUp, found: !!line, tailSize: tail.length });
      } else {
        throw e;
      }
    }

    // Defer alias enrichment until we have a terminal result to minimize latency.
    let aliasesFromRedis: Record<string, string> | undefined;
    let pinMeta: { normalPins?: number[]; latchPins?: number[] } | undefined;
    let itemsAll: Array<{ kssk: string; aliases: Record<string,string>; normalPins: number[]; latchPins: number[]; ts?: number | null }> | undefined;

    if (!line) {
      // No signal yet — return 504 pending quickly, without alias enrichment.
      log.info('CHECK no-result-yet', { rid, mac: macUp, durationMs: Date.now()-t0 });
      if ((process.env.LOG_MONITOR_START_ONLY ?? '0') !== '1') {
        mon.info(`CHECK pending mac=${macUp} no-result-yet`);
      }
      // Do NOT return OK on no result; indicate pending/timeout
      return NextResponse.json(
        { error: 'no-result-yet', pending: true, ...(aliasesFromRedis ? { aliases: aliasesFromRedis } : {}), ...(pinMeta || {}), ...(itemsAll ? { items: itemsAll } : {}) },
        { status: 504, headers: { 'X-Req-Id': rid } }
      );
    }

    // Terminal parse
    const m1 = line.match(RESULT_RE) || line.match(REPLY_RESULT_RE);
    if (m1 && /^SUCCESS|OK/i.test(m1[1])) {
      if ((process.env.LOG_MONITOR_START_ONLY ?? '0') !== '1') {
        mon.info(`CHECK rx mac=${macUp} raw=${JSON.stringify(line)}`);
      }
      log.info('CHECK success', { rid, mac: macUp, durationMs: Date.now()-t0 });
      if ((process.env.LOG_MONITOR_START_ONLY ?? '0') !== '1') {
        mon.info(`CHECK ok mac=${macUp} failures=0 durMs=${Date.now()-t0}`);
      }
      // Fast path: success response without alias enrichment
      return NextResponse.json({ failures: [] }, { headers: { 'X-Req-Id': rid } });
    }

    // FAILURE → return pin list
    if ((process.env.LOG_MONITOR_START_ONLY ?? '0') !== '1') {
      mon.info(`CHECK rx mac=${macUp} raw=${JSON.stringify(line)}`);
    }
    const failures = parseFailuresFromLine(line, pins);

    // On failure, enrich with aliases and per-KSSK bundles (does not block success path)
    try {
      const { getRedis } = await import('@/lib/redis');
      const r = getRedis();
      const raw = await r.get(`kfb:aliases:${macUp}`);
      if (raw) {
        const parsedR = JSON.parse(raw);
        if (parsedR?.names && typeof parsedR.names === 'object') aliasesFromRedis = parsedR.names as Record<string,string>;
        const n = Array.isArray(parsedR?.normalPins) ? parsedR.normalPins : undefined;
        const l = Array.isArray(parsedR?.latchPins) ? parsedR.latchPins : undefined;
        pinMeta = { ...(n ? { normalPins: n } : {}), ...(l ? { latchPins: l } : {}) };
      }
      const members: string[] = await r.smembers(`kfb:aliases:index:${macUp}`).catch(() => []);
      const rows = await Promise.all(members.map(async (kssk) => {
        try {
          const raw2 = await r.get(`kfb:aliases:${macUp}:${kssk}`);
          if (!raw2) return null;
          const d = JSON.parse(raw2);
          return {
            kssk,
            aliases: d?.names || d?.aliases || {},
            normalPins: Array.isArray(d?.normalPins) ? d.normalPins : [],
            latchPins: Array.isArray(d?.latchPins) ? d.latchPins : [],
            ts: d?.ts || null,
          };
        } catch { return null; }
      }));
      itemsAll = rows.filter(Boolean) as any;
    } catch {}
    const unknown = !failures.length;
    log.info('CHECK failure', { rid, mac: macUp, failures, unknown, durationMs: Date.now()-t0 });
    mon.info(`CHECK fail mac=${macUp} failures=[${failures.join(',')}] durMs=${Date.now()-t0}`);
    return NextResponse.json({ failures, unknownFailure: unknown, ...(aliasesFromRedis ? { aliases: aliasesFromRedis } : {}), ...(pinMeta || {}), ...(itemsAll ? { items: itemsAll } : {}) }, { headers: { 'X-Req-Id': rid } });
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
          log.error('[serial/check tail]', { rid, mac: parsed.success ? normMac(parsed.data.mac) : 'n/a', tail });
        } else {
          log.error('[serial/check tail]', { rid, mac: parsed.success ? normMac(parsed.data.mac) : 'n/a', tail: [] });
        }
    } catch (err) {
      log.error('[serial/check tail] failed', { rid, mac: parsed.success ? normMac(parsed.data.mac) : 'n/a', error: String(err) });
    }

    log.error('[serial/check]', { rid, mac: parsed.success ? normMac(parsed.data.mac) : 'n/a', msg, status, durationMs: Date.now()-t0 });
    mon.error(`CHECK error mac=${macUp} err=${msg} status=${status}`);
    return NextResponse.json({ error: msg }, { status, headers: { 'X-Req-Id': rid } });
  } finally {
    locks.delete(macUp);
  }
}
