import { LOG } from '@/lib/logger';
const log = LOG.tag('scan:mem');
const VERBOSE = (process.env.SCAN_MEM_LOG ?? '0') === '1';

export type Scan = { code: string; path: string | null; at: number };

const GG = globalThis as any;
if (!GG.__lastScan) GG.__lastScan = null as Scan | null;
if (!GG.__lastScanByPath) GG.__lastScanByPath = new Map<string, Scan | null>();

function normPath(p: string | null | undefined): string | null {
  const s = String(p ?? "").trim();
  return s ? s : null;
}

export function setLastScan(code: string, path: string | null) {
  const clean = String(code ?? '').trim();
  if (!clean) return;
  const at = Date.now();
  const p = normPath(path);

  const prev = GG.__lastScan as Scan | null;
  GG.__lastScan = { code: clean, path: p, at };
  // Quiet by default; promote to info only when SCAN_MEM_LOG=1
  const payload = { code: clean, path: p, prevAgeMs: prev ? at - prev.at : null } as const;
  if (VERBOSE) log.info('set', payload); else log.debug('set', payload);

  if (p) {
    const prevP = GG.__lastScanByPath.get(p) ?? null;
    GG.__lastScanByPath.set(p, { code: clean, path: p, at });
    const byPath = { path: p, replaced: !!prevP, prevAgeMs: prevP ? at - prevP.at : null } as const;
    if (VERBOSE) log.info('setByPath', byPath); else log.debug('setByPath', byPath);
  }
}

export function getLastScanAndClear(): Scan | null {
  const s: Scan | null = GG.__lastScan;
  GG.__lastScan = null;
  const out = s ? { code: s.code, path: s.path, ageMs: Date.now() - s.at } : { empty: true } as any;
  if (VERBOSE) log.info('pop', out); else log.debug('pop', out);
  return s;
}

export function peekLastScan(): Scan | null {
  const s = GG.__lastScan as Scan | null;
  const out = s ? { code: s.code, path: s.path, ageMs: Date.now() - s.at } : { empty: true } as any;
  if (VERBOSE) log.info('peek', out); else log.debug('peek', out);
  return s;
}

export function getLastScanAndClearFor(path: string): string | null {
  const p = normPath(path);
  if (!p) return null;
  const s: Scan | null = GG.__lastScanByPath.get(p) ?? null;
  GG.__lastScanByPath.delete(p);
  const outF = s ? { path: p, code: s.code, ageMs: Date.now() - s.at } : { path: p, empty: true } as any;
  if (VERBOSE) log.info('popFor', outF); else log.debug('popFor', outF);
  return s?.code ?? null;
}

export function peekLastScanFor(path: string): Scan | null {
  const p = normPath(path);
  if (!p) return null;
  const s: Scan | null = GG.__lastScanByPath.get(p) ?? null;
  const outPF = s ? { path: p, code: s.code, ageMs: Date.now() - s.at } : { path: p, empty: true } as any;
  if (VERBOSE) log.info('peekFor', outPF); else log.debug('peekFor', outPF);
  return s ?? null;
}
