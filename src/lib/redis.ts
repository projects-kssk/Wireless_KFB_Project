// src/lib/redis.ts
import RedisPkg from 'ioredis';
const Redis: any = (RedisPkg as any)?.default ?? (RedisPkg as any);
import { LOG } from './logger.js';

const log = LOG.tag('redis');

let client: any = null;

function getGlobalStore() {
  try {
    const g: any = globalThis as any;
    g.__KFB_REDIS_STORE__ ||= {};
    return g.__KFB_REDIS_STORE__;
  } catch {
    return {};
  }
}

// Track recent status for diagnostics
const lastInfo: {
  status: string;
  lastEvent: string;
  lastError: string | null;
  lastAt: number;
} = { status: 'idle', lastEvent: 'init', lastError: null, lastAt: Date.now() };

function maskUrl(u: string) {
  try {
    const x = new URL(u);
    if (x.password) x.password = '***';
    return x.toString();
  } catch {
    return u;
  }
}

function attachEventLogging(r: any, urlShown: string) {
  if ((r as any).__logAttached) return;
  (r as any).__logAttached = true;

  r.on('connect',     () => { lastInfo.status = r.status; lastInfo.lastEvent = 'connect'; lastInfo.lastAt = Date.now(); log.info(`connect → ${urlShown}`); });
  r.on('ready',       () => { lastInfo.status = r.status; lastInfo.lastEvent = 'ready'; lastInfo.lastAt = Date.now(); log.info('ready'); });
  r.on('reconnecting', (ms: number) => { lastInfo.status = r.status; lastInfo.lastEvent = `reconnecting(${ms})`; lastInfo.lastAt = Date.now(); log.info(`reconnecting in ${ms}ms`); });
  r.on('close',       () => { lastInfo.status = r.status; lastInfo.lastEvent = 'close'; lastInfo.lastAt = Date.now(); log.info('close'); });
  r.on('end',         () => { lastInfo.status = r.status; lastInfo.lastEvent = 'end'; lastInfo.lastAt = Date.now(); log.info('end'); });
  r.on('error',       (e: any) => {
    const msg = e?.message || String(e);
    lastInfo.status = r.status;
    lastInfo.lastEvent = 'error';
    lastInfo.lastError = msg;
    lastInfo.lastAt = Date.now();
    log.error(`error: ${msg}`);
  });
}

function ensureKeepAlive(r: any) {
  const raw = process.env.REDIS_KEEPALIVE_MS ?? process.env.REDIS_KEEPALIVE_INTERVAL_MS;
  const keepAliveMs = Number(raw ?? '30000');
  if (!Number.isFinite(keepAliveMs) || keepAliveMs <= 0) return;
  if ((r as any).__keepAliveInterval) return;

  let inFlight = false;
  const interval = setInterval(() => {
    if (inFlight) return;
    if (!client || client.status !== 'ready') return;
    inFlight = true;
    client
      .ping()
      .catch((err: any) => {
        if ((process.env.REDIS_KEEPALIVE_LOG ?? '0') === '1') {
          const msg = err?.message || String(err);
          log.warn(`keepalive ping failed: ${msg}`);
        }
      })
      .finally(() => {
        inFlight = false;
      });
  }, keepAliveMs);
  interval.unref?.();
  (r as any).__keepAliveInterval = interval;
}

export function getRedis() {
  const store = getGlobalStore();
  if (!client) client = store.client;
  if (client) return client;

  const url = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
  const shown = maskUrl(url);
  const connectTimeout = Number(process.env.REDIS_CONNECT_TIMEOUT_MS ?? '2000');

  const instance = new Redis(url, {
    lazyConnect: false,          // connect immediately
    enableOfflineQueue: false,   // fail fast if down
    maxRetriesPerRequest: 2,
    connectTimeout,
  });

  log.info(`init url=${shown} lazyConnect=false offlineQueue=false timeout=${connectTimeout}ms`);
  attachEventLogging(instance, shown);
  ensureKeepAlive(instance);
  store.client = instance;
  client = instance;

  // Also log unhandled error events at process level (useful in prod)
  // Install once to avoid MaxListenersExceededWarning under hot-reload
  try {
    const g: any = globalThis as any;
    if (!g.__redis_unhandled_attached) {
      process.on('unhandledRejection', (err: any) => {
        const msg = err?.message || String(err);
        log.error(`unhandledRejection: ${msg}`);
      });
      g.__redis_unhandled_attached = true;
    }
  } catch {}

  return client;
}

// Small helper if you want to expose current state elsewhere
export function redisStatus(): string {
  return client?.status ?? 'idle';
}

export function redisDetail() {
  return {
    status: client?.status ?? 'idle',
    lastEvent: lastInfo.lastEvent,
    lastError: lastInfo.lastError,
    lastAt: lastInfo.lastAt,
  };
}
