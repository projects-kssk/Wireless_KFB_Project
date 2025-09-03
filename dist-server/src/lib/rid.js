// src/lib/rid.ts
export function newRid() {
    try {
        const fn = globalThis.crypto?.randomUUID;
        const raw = typeof fn === 'function' ? fn() : Math.random().toString(36).slice(2);
        return raw.replace(/-/g, '').slice(0, 8);
    }
    catch {
        return Math.random().toString(36).slice(2, 10);
    }
}
export function ridFrom(req) {
    try {
        const h = req.headers;
        const id = h.get('x-req-id') || h.get('x-request-id') || '';
        return id || newRid();
    }
    catch {
        return newRid();
    }
}
