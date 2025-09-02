// src/lib/redis.ts
import Redis from 'ioredis';
import { LOG } from '@/lib/logger';

const log = LOG.tag('redis');

let client: any = null;

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

  r.on('connect',     () => log.info(`connect → ${urlShown}`));
  r.on('ready',       () => log.info('ready'));
  r.on('reconnecting', (ms: number) => log.info(`reconnecting in ${ms}ms`));
  r.on('close',       () => log.info('close'));
  r.on('end',         () => log.info('end'));
  r.on('error',       (e: any) => {
    const msg = e?.message || String(e);
    log.error(`error: ${msg}`);
  });
}

export function getRedis() {
  if (client) return client;

  const url = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
  const shown = maskUrl(url);
  const connectTimeout = Number(process.env.REDIS_CONNECT_TIMEOUT_MS ?? '2000');

  client = new Redis(url, {
    lazyConnect: false,          // connect immediately
    enableOfflineQueue: false,   // fail fast if down
    maxRetriesPerRequest: 2,
    connectTimeout,
  });

  log.info(`init url=${shown} lazyConnect=false offlineQueue=false timeout=${connectTimeout}ms`);
  attachEventLogging(client, shown);

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
