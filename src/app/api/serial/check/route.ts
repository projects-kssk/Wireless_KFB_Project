// src/app/api/serial/check/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import serial from '@/lib/serial';
import { broadcast } from '@/lib/bus';
import { LOG } from '@/lib/logger';
import crypto from 'node:crypto';
import os from 'node:os';
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

// Fast turnaround. Scanner re-triggers checks, tune as needed.
// Handshake echo wait
const HANDSHAKE_TIMEOUT_MS = Number(process.env.CHECK_HANDSHAKE_TIMEOUT_MS ?? 400);
// Terminal result wait (increase to wait more)
const RESULT_TIMEOUT_MS = Number(process.env.CHECK_RESULT_TIMEOUT_MS ?? 9000);

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
    captured
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .forEach((x) => {
        const n = Number(x);
        if (!Number.isInteger(n)) return;
        if (want) {
          if (want.has(n)) failures.add(n);
        } else {
          failures.add(n);
        }
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
    // Build effective pin list based on mode
    // Modes: mac (default) → send no pins; union → union of active KSSKs; client → honor body pins; merge → superset of both
    // Default to 'merge' to avoid under-sending when Redis union is stale while client has a more complete set
    const SEND_MODE = (process.env.CHECK_SEND_MODE ?? 'merge').toLowerCase();
    let clientPins: number[] | undefined = Array.isArray(parsed.data.pins)
      ? parsed.data.pins.filter((n) => Number.isFinite(n) && n > 0)
      : undefined;
    let pinsUnion: number[] = [];
    try {
      const { getRedis } = await import('@/lib/redis');
      const r = getRedis();
      const indexKey = `kfb:aliases:index:${macUp}`;
      const members: string[] = await r.smembers(indexKey).catch(() => []);
      const stationId = (process.env.STATION_ID || process.env.NEXT_PUBLIC_STATION_ID || '').trim();
      const act: string[] = stationId ? await r.smembers(`kssk:station:${stationId}`).catch(() => []) : [];
      // Union of station-active and indexed KSSKs to be safe
      let targets: string[] = Array.from(new Set([...(Array.isArray(act)?act:[]), ...(Array.isArray(members)?members:[])])).filter(Boolean);
      // Fallback: if both station + index empty, scan Redis keys for per-KSSK alias entries
      if (!targets.length) {
        try {
          const pattern = `kfb:aliases:${macUp}:*`;
          let cursor = '0';
          const found: string[] = [];
          if (typeof (r as any).scan === 'function') {
            do {
              const res = await (r as any).scan(cursor, 'MATCH', pattern, 'COUNT', 300);
              cursor = res[0];
              const keys: string[] = res[1] || [];
              for (const k of keys) {
                const id = String(k).slice(pattern.length - 1).replace(/^:/, '');
                if (id) found.push(id);
              }
            } while (cursor !== '0');
          } else {
            const keys: string[] = await (r as any).keys(pattern).catch(() => []);
            for (const k of keys) {
              const id = String(k).slice(pattern.length - 1).replace(/^:/, '');
              if (id) found.push(id);
            }
          }
          targets = Array.from(new Set(found));
        } catch {}
      }
      if ((process.env.LOG_MONITOR_START_ONLY ?? '0') !== '1') {
        mon.info(`CHECK kssk targets count=${targets.length} station=${stationId || 'n/a'}`);
      }
      const pinsSet = new Set<number>();
      const unionNames: Record<string, string> = {};
      const unionN = new Set<number>();
      const unionL = new Set<number>();
      for (const id of targets) {
        try {
          const raw = await r.get(`kfb:aliases:${macUp}:${id}`);
          if (!raw) continue;
          const d = JSON.parse(raw);
          const names = d?.names || d?.aliases || {};
          for (const k of Object.keys(names)) { const n = Number(k); if (Number.isFinite(n) && n>0) pinsSet.add(n); }
          // merge first-seen name per pin (preserve earlier)
          for (const [k, v] of Object.entries(names)) { if (!unionNames[k]) unionNames[k] = String(v); }
          if (Array.isArray(d?.normalPins)) for (const n of d.normalPins) { const x = Number(n); if (Number.isFinite(x) && x>0) { pinsSet.add(x); unionN.add(x); } }
          if (Array.isArray(d?.latchPins)) for (const n of d.latchPins) { const x = Number(n); if (Number.isFinite(x) && x>0) { pinsSet.add(x); unionL.add(x); } }
        } catch {}
      }
      // Always merge the union-from-MAC key as a safety net, so we never
      // under-send when some per-KSSK alias records are missing.
      try {
        const rawUnion = await r.get(`kfb:aliases:${macUp}`);
        if (rawUnion) {
          const u = JSON.parse(rawUnion);
          const allPins = [
            ...(Array.isArray(u?.normalPins) ? u.normalPins : []),
            ...(Array.isArray(u?.latchPins) ? u.latchPins : []),
          ];
          for (const p of allPins) { const n = Number(p); if (Number.isFinite(n) && n>0) pinsSet.add(n); }
        }
      } catch {}
      pinsUnion = Array.from(pinsSet).sort((a,b)=>a-b);
      if ((process.env.LOG_MONITOR_START_ONLY ?? '0') !== '1') {
        mon.info(`CHECK union pins count=${pinsUnion.length}`);
      }
      // Persist union back to Redis (strengthen consistency for subsequent sessions)
      try {
        const { getRedis } = await import('@/lib/redis');
        const rr: any = getRedis();
        const key = `kfb:aliases:${macUp}`;
        const prevRaw = await rr.get(key).catch(() => null);
        let prev: any = null;
        try { prev = prevRaw ? JSON.parse(prevRaw) : null; } catch {}
        const hints = (prev?.hints && typeof prev.hints === 'object') ? prev.hints : undefined;
        const outNames = Object.keys(unionNames).length ? unionNames : (prev?.names && typeof prev.names === 'object' ? prev.names : {});
        const nArr = Array.from(unionN).sort((a,b)=>a-b);
        const lArr = Array.from(unionL).sort((a,b)=>a-b);
        const payload = JSON.stringify({ names: outNames, normalPins: nArr, latchPins: lArr, ...(hints?{hints}:{}) , ts: Date.now() });
        await rr.set(key, payload).catch(()=>{});
        try { broadcast({ type: 'aliases/union', mac: macUp, names: outNames, normalPins: nArr, latchPins: lArr }); } catch {}
      } catch {}
    } catch {}

    // Choose which pins to send based on SEND_MODE ('merge'|'union'|'client'):
    // 1) merge: union of server union and client pins
    // 2) union: server union if available; else client pins
    // 3) client: client pins if provided; else server union
    // Fallback: CHECK_DEFAULT_PINS → MAC-only
    let pins: number[] | undefined = undefined;
    const uniqSort = (arr: number[] | undefined) => Array.from(new Set((arr || []).filter((n) => Number.isFinite(n) && n > 0))).sort((a,b)=>a-b);
    if (SEND_MODE === 'merge') {
      const merged = uniqSort([...(pinsUnion || []), ...((clientPins || []) as number[])] as number[]);
      if (merged.length) pins = merged;
    } else if (SEND_MODE === 'client') {
      if (Array.isArray(clientPins) && clientPins.length) pins = uniqSort(clientPins);
      else if (pinsUnion.length) pins = uniqSort(pinsUnion);
    } else { // 'union' (legacy default)
      if (pinsUnion.length) pins = uniqSort(pinsUnion);
      else if (Array.isArray(clientPins) && clientPins.length) pins = uniqSort(clientPins);
    }
    if (!pins) {
      const rawDef = (process.env.CHECK_DEFAULT_PINS || '').trim();
      if (rawDef) {
        const defPins = rawDef
          .split(',')
          .map((s) => Number(s.trim()))
          .filter((n) => Number.isFinite(n) && n > 0);
        if (defPins.length) pins = Array.from(new Set(defPins)).sort((a, b) => a - b);
      }
      // if still no pins → MAC-only
    }

    const { sendToEsp, waitForNextLine } = serial as any;
    if (typeof sendToEsp !== 'function' || typeof waitForNextLine !== 'function') {
      throw new Error('serial-helpers-missing');
    }

    log.info('CHECK begin', { rid, mac: macUp, mode: SEND_MODE, pins: pins?.length ?? 0 });
    if ((process.env.LOG_MONITOR_START_ONLY ?? '0') !== '1') mon.info(`CHECK start mac=${macUp} mode=${SEND_MODE} pins=${pins?.length ?? 0}`);

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

    // Do NOT couple device waiters to the HTTP client's abort — own the lifetime here
    const ac = new AbortController();
    const signal = ac.signal;

    // Log current ESP path for visibility
    try {
      const s = (serial as any).getEspLineStream?.();
      const espPath = s?.port?.path || process.env.ESP_TTY || process.env.ESP_TTY_PATH || 'unknown';
      if (espPath && (process.env.LOG_MONITOR_START_ONLY ?? '0') !== '1') mon.info(`CHECK espPath=${espPath}`);
    } catch {}

    // Fire command (optionally with selected pins)
    const cmdStr = (pins && pins.length) ? `CHECK ${pins.join(',')} ${macUp}` : `CHECK ${macUp}`;
    if ((process.env.LOG_MONITOR_START_ONLY ?? '0') !== '1') {
      mon.info(`CHECK send mac=${macUp} cmd='${cmdStr}'`);
    }
    await sendToEsp(cmdStr);

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
      // Cancel remaining matchers to avoid late rejections after return
      try { ac.abort(); } catch {}
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
        { error: 'no-result-yet', code: 'NO_RESULT', symbol: 'X', pending: true, ...(aliasesFromRedis ? { aliases: aliasesFromRedis } : {}), ...(pinMeta || {}), ...(itemsAll ? { items: itemsAll } : {}) },
        { status: 504, headers: { 'X-Req-Id': rid } }
      );
    }

    // Terminal parse
    const m1 = line.match(RESULT_RE) || line.match(REPLY_RESULT_RE);
    // SUCCESS/OK with RESULT wrapper
    if (m1 && /^SUCCESS|OK/i.test(m1[1])) {
      if ((process.env.LOG_MONITOR_START_ONLY ?? '0') !== '1') {
        mon.info(`CHECK rx mac=${macUp} raw=${JSON.stringify(line)}`);
      }
      log.info('CHECK success', { rid, mac: macUp, durationMs: Date.now()-t0 });
      if ((process.env.LOG_MONITOR_START_ONLY ?? '0') !== '1') {
        mon.info(`CHECK ok mac=${macUp} failures=0 durMs=${Date.now()-t0}`);
      }
      // Fire-and-forget: build a checkpoint XML from aliases and send it to Krosy only on SUCCESS
      try { void sendCheckpointFromAliases(macUp, rid); } catch {}
      // On SUCCESS: clear any KSSK locks for this MAC across ALL stations so Setup can proceed next time anywhere
      try {
        const { getRedis } = await import('@/lib/redis');
        const r: any = getRedis();
        if (r) {
          const explicitStation = (process.env.NEXT_PUBLIC_STATION_ID || process.env.STATION_ID || '').trim();
          const stationSetKeys: string[] = [];
          // 1) Include explicit current station if set
          if (explicitStation) stationSetKeys.push(`kssk:station:${explicitStation}`);
          // 2) Discover any other station sets
          try {
            if (typeof r.scan === 'function') {
              let cursor = '0';
              do {
                const res = await r.scan(cursor, 'MATCH', 'kssk:station:*', 'COUNT', 300);
                cursor = res[0];
                const chunk: string[] = res[1] || [];
                for (const k of chunk) if (!stationSetKeys.includes(k)) stationSetKeys.push(k);
              } while (cursor !== '0');
            } else {
              const keys: string[] = await r.keys('kssk:station:*').catch(() => []);
              for (const k of keys) if (!stationSetKeys.includes(k)) stationSetKeys.push(k);
            }
          } catch {}

          // 3) For each station set, remove locks that belong to this MAC
          for (const setKey of stationSetKeys) {
            try {
              const members: string[] = await r.smembers(setKey).catch(() => []);
              for (const kssk of members) {
                try {
                  const lockKey = `kssk:lock:${kssk}`;
                  const raw = await r.get(lockKey).catch(() => null);
                  if (!raw) { await r.srem(setKey, kssk).catch(() => {}); continue; }
                  const v = JSON.parse(raw);
                  const macLock = String(v?.mac || '').toUpperCase();
                  if (macLock === macUp) {
                    await r.del(lockKey).catch(() => {});
                    await r.srem(setKey, kssk).catch(() => {});
                  }
                } catch {}
              }
            } catch {}
          }

          // 4) Belt-and-suspenders: scan all kssk:lock:* keys and delete any whose mac matches this MAC,
          //    also removing from their recorded station set if present.
          try {
            const lockKeys: string[] = [];
            if (typeof r.scan === 'function') {
              let cursor = '0';
              do {
                const res = await r.scan(cursor, 'MATCH', 'kssk:lock:*', 'COUNT', 300);
                cursor = res[0];
                const chunk: string[] = res[1] || [];
                lockKeys.push(...chunk);
              } while (cursor !== '0');
            } else {
              const keys: string[] = await r.keys('kssk:lock:*').catch(() => []);
              lockKeys.push(...keys);
            }
            for (const key of lockKeys) {
              try {
                const raw = await r.get(key).catch(() => null);
                if (!raw) continue;
                const v = JSON.parse(raw);
                const macLock = String(v?.mac || '').toUpperCase();
                if (macLock === macUp) {
                  await r.del(key).catch(() => {});
                  const sid = (v && v.stationId) ? String(v.stationId) : null;
                  if (sid) await r.srem(`kssk:station:${sid}`, String(v.kssk || '').trim()).catch(() => {});
                }
              } catch {}
            }
          } catch {}
        }
      } catch {}
      // Fast path: success response (also include raw line for UI display if desired)
      return NextResponse.json({ failures: [], raw: line, pinsUsed: Array.isArray(pins) ? pins : [], sendMode: SEND_MODE }, { headers: { 'X-Req-Id': rid } });
    }

    // FAILURE → return pin list
    if ((process.env.LOG_MONITOR_START_ONLY ?? '0') !== '1') {
      mon.info(`CHECK rx mac=${macUp} raw=${JSON.stringify(line)}`);
    }
    let failures = parseFailuresFromLine(line, pins);

    // Enrich failures by mapping alias names (e.g., CL_2455) seen in the line back to pin numbers via Redis aliases
    try {
      const { getRedis } = await import('@/lib/redis');
      const r = getRedis();
      const rawUnion = await r.get(`kfb:aliases:${macUp}`).catch(() => null as any);
      if (rawUnion) {
        const d = JSON.parse(rawUnion);
        const names = (d?.names && typeof d.names === 'object') ? (d.names as Record<string,string>) : {};
        // Build reverse map: label -> pins[]
        const rev = new Map<string, number[]>();
        const norm = (s: string) => String(s || '').trim().toUpperCase();
        for (const [pinStr, label] of Object.entries(names)) {
          const pin = Number(pinStr);
          if (!Number.isFinite(pin) || pin <= 0) continue;
          const key = norm(label);
          const arr = rev.get(key) || [];
          arr.push(pin);
          rev.set(key, arr);
        }
        // Scan line for any alias labels present; if found, add matching pins
        const hay = norm(line);
        const have = new Set<number>(failures);
        for (const [label, pinsList] of rev.entries()) {
          if (!label) continue;
          if (hay.includes(label)) {
            for (const p of pinsList) have.add(p);
          }
        }
        failures = Array.from(have).sort((a,b)=>a-b);
      }
    } catch {}

    // On failure, enrich with aliases, name hints and per-KSSK bundles (does not block success path)
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
        if (parsedR?.hints && typeof parsedR.hints === 'object') {
          // pass through as nameHints for UI
          (pinMeta as any).nameHints = parsedR.hints;
        }
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
      // Active KSSKs for this station (if configured)
      try {
        const stationId = (process.env.NEXT_PUBLIC_STATION_ID || process.env.STATION_ID || '').trim();
        if (stationId && itemsAll && itemsAll.length) {
          const activeIds: string[] = await r.smembers(`kssk:station:${stationId}`).catch(() => []);
          if (activeIds && activeIds.length) {
            const set = new Set(activeIds.map(String));
            const filt = (itemsAll as any[]).filter(it => set.has(String(it.kssk)));
            if (filt.length) (pinMeta as any) = { ...(pinMeta || {}), itemsActive: filt };
          }
        }
      } catch {}
    } catch {}
    const unknown = !failures.length;
    log.info('CHECK failure', { rid, mac: macUp, failures, unknown, durationMs: Date.now()-t0 });
    mon.info(`CHECK fail mac=${macUp} failures=[${failures.join(',')}] durMs=${Date.now()-t0}`);
    return NextResponse.json({ failures, unknownFailure: unknown, raw: line, pinsUsed: Array.isArray(pins) ? pins : [], sendMode: SEND_MODE, ...(aliasesFromRedis ? { aliases: aliasesFromRedis } : {}), ...(pinMeta || {}), ...(itemsAll ? { items: itemsAll } : {}) }, { headers: { 'X-Req-Id': rid } });
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

    // Tail-fallback: if client aborted or timeout, try to salvage latest RESULT for this MAC
    try {
      if (msg === 'client-abort' || msg === 'timeout') {
        const tail = getTail();
        const MAC = escMac(parsed.success ? normMac(parsed.data.mac) : '');
        const RESULT_RE2 = new RegExp(`\\bRESULT\\s+(SUCCESS|FAILURE[^\\n]*)\\b.*${MAC}\\b`, 'i');
        const REPLY_RESULT_RE2 = new RegExp(`^\\s*←\\s*reply\\s+from\\s+${MAC}\\s*:\\s*(?:RESULT\\s+)?(SUCCESS|FAILURE[^\\n]*)`, 'i');
        let line: string | null = null;
        for (let i = tail.length - 1; i >= 0; i--) {
          const ln = tail[i];
          const m = ln.match(RESULT_RE2) || ln.match(REPLY_RESULT_RE2);
          if (m && (/^FAILURE/i.test(m[1]) || /^SUCCESS/i.test(m[1]))) { line = ln; break; }
        }
        if (line) {
          // Parse failures
          const failures = parseFailuresFromLine(line, Array.isArray((parsed as any)?.data?.pins) ? (parsed as any).data.pins : undefined);
          const unknown = !Array.isArray(failures) ? true : false;
          mon.info(`CHECK tail-fallback mac=${parsed.success ? normMac(parsed.data.mac) : '-'} line=${JSON.stringify(line)}`);
          return NextResponse.json({ failures: Array.isArray(failures) ? failures : [], unknownFailure: unknown });
        }
      }
    } catch {}

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

/** Build a minimal workingData XML from Redis aliases and post it to the offline checkpoint route. */
async function sendCheckpointFromAliases(macUp: string, requestId: string) {
  try {
    const { getRedis } = await import('@/lib/redis');
    const r: any = getRedis();
    const raw = await r.get(`kfb:aliases:${macUp}`).catch(() => null as any);
    if (!raw) return;
    const data = JSON.parse(raw);
    const hints = (data?.hints && typeof data.hints === 'object') ? (data.hints as Record<string,string>) : {};
    const namesMap: Record<string,string> = (data?.names && typeof data.names === 'object') ? data.names : {};
    // Prefer CL name hints; fall back to alias names
    let names: string[] = [];
    const seen = new Set<string>();
    const pushName = (nm?: string) => { if (!nm) return; const key = String(nm).trim(); if (!key) return; if (seen.has(key)) return; seen.add(key); names.push(key); };
    for (const v of Object.values(hints)) pushName(String(v));
    for (const v of Object.values(namesMap)) pushName(String(v));
    names = names.filter(Boolean);
    if (!names.length) return;

    const srcHost = os.hostname();
    const targetHost = (process.env.KROSY_XML_TARGET || 'kssksun01').trim();
    const nowIso = new Date().toISOString().replace(/\..*Z$/, 'Z');

    // Build a compact workingData XML that the checkpoint route knows how to convert to workingResult
    const seqXml = names.map((nm, i) => (
      `<sequence index="${i+1}" compType="clip" reference="1" result="true">`+
      `<objGroup>CL</objGroup><objPos>${escapeXml(nm)}</objPos>`+
      `</sequence>`
    )).join('');
    const workingDataXml =
      `<krosy xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="http://www.kroschu.com/kroscada/namespaces/krosy/visualcontrol/V_0_1" xmlns:xsd="http://www.w3.org/2001/XMLSchema">`+
      `<header><requestID>${escapeXml(requestId)}</requestID>`+
      `<sourceHost><hostname>${escapeXml(srcHost)}</hostname></sourceHost>`+
      `<targetHost><hostname>${escapeXml(targetHost)}</hostname></targetHost></header>`+
      `<body><visualControl>`+
      `<workingData device="${escapeXml(srcHost)}" intksk="" scanned="${escapeXml(nowIso)}">`+
      `<sequencer><segmentList count="1">`+
      `<segment index="1" name="1"><sequenceList count="${names.length}">${seqXml}</sequenceList></segment>`+
      `</segmentList></sequencer>`+
      `</workingData>`+
      `</visualControl></body>`+
      `</krosy>`;

    await fetch('http://localhost:3000/api/krosy-offline/checkpoint', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workingDataXml, requestID: requestId, sourceHostname: srcHost }),
    }).catch(() => {});
  } catch {}
}

function escapeXml(s: string) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
