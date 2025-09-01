import { LOG } from '@/lib/logger';
const log = LOG.tag('scan:mem');

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
  log.info('set', {
    code: clean, path: p,
    prevAgeMs: prev ? at - prev.at : null
  });

  if (p) {
    const prevP = GG.__lastScanByPath.get(p) ?? null;
    GG.__lastScanByPath.set(p, { code: clean, path: p, at });
    log.debug('setByPath', {
      path: p, replaced: !!prevP, prevAgeMs: prevP ? at - prevP.at : null
    });
  }
}

export function getLastScanAndClear(): Scan | null {
  const s: Scan | null = GG.__lastScan;
  GG.__lastScan = null;
  log.info('pop', s ? { code: s.code, path: s.path, ageMs: Date.now() - s.at } : { empty: true });
  return s;
}

export function peekLastScan(): Scan | null {
  const s = GG.__lastScan as Scan | null;
  log.debug('peek', s ? { code: s.code, path: s.path, ageMs: Date.now() - s.at } : { empty: true });
  return s;
}

export function getLastScanAndClearFor(path: string): string | null {
  const p = normPath(path);
  if (!p) return null;
  const s: Scan | null = GG.__lastScanByPath.get(p) ?? null;
  GG.__lastScanByPath.delete(p);
  log.info('popFor', s ? { path: p, code: s.code, ageMs: Date.now() - s.at } : { path: p, empty: true });
  return s?.code ?? null;
}

export function peekLastScanFor(path: string): Scan | null {
  const p = normPath(path);
  if (!p) return null;
  const s: Scan | null = GG.__lastScanByPath.get(p) ?? null;
  log.debug('peekFor', s ? { path: p, code: s.code, ageMs: Date.now() - s.at } : { path: p, empty: true });
  return s ?? null;
}
