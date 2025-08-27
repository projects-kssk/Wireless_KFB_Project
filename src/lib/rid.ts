// src/lib/rid.ts
export function newRid(): string {
  try {
    const fn = (globalThis as any).crypto?.randomUUID as undefined | (() => string);
    const raw = typeof fn === 'function' ? fn() : Math.random().toString(36).slice(2);
    return raw.replace(/-/g, '').slice(0, 8);
  } catch {
    return Math.random().toString(36).slice(2, 10);
  }
}

export function ridFrom(req: Request): string {
  try {
    const h = (req as any).headers as Headers;
    const id = h.get('x-req-id') || h.get('x-request-id') || '';
    return id || newRid();
  } catch {
    return newRid();
  }
}

