// scripts/print-locks-redis.mjs
import Redis from 'ioredis';

const url   = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const pref  = process.env.REDIS_LOCK_PREFIX || 'kssk:lock:';
const redis = new Redis(url);

function parseKey(key) {
  // assumes kssk:lock:<KSSK>
  return key.slice(pref.length);
}

function expiryFromTTL(ttl) {
  if (ttl <= 0) return null;
  const d = new Date(Date.now() + ttl * 1000);
  return d.toISOString();
}

const rows = [];
const stream = redis.scanStream({ match: `${pref}*`, count: 200 });

stream.on('data', async (keys) => {
  if (!keys.length) return;
  const pipeline = redis.pipeline();
  for (const k of keys) {
    pipeline.ttl(k).get(k).hgetall(k); // support both JSON (GET) and HASH (HGETALL)
  }
  const results = await pipeline.exec();

  for (let i = 0; i < keys.length; i++) {
    const key   = keys[i];
    const kssk  = parseKey(key);
    const ttl   = results[i*3 + 0][1];      // TTL
    const str   = results[i*3 + 1][1];      // GET (JSON?)
    const hash  = results[i*3 + 2][1];      // HGETALL result

    let mac = null, stationId = null, createdAt = null;
    if (str) {
      try {
        const j = JSON.parse(str);
        mac = j.mac || j.boardMac || null;
        stationId = j.stationId || null;
        createdAt = j.createdAt || null;
      } catch {}
    } else if (hash && Object.keys(hash).length) {
      mac = hash.mac || hash.boardMac || null;
      stationId = hash.stationId || null;
      createdAt = hash.createdAt || null;
    }

    rows.push({
      kssk,
      mac: mac?.toUpperCase?.() || null,
      stationId,
      expiresAt: expiryFromTTL(ttl),
      ttlSec: ttl,
      key,
    });
  }
});

stream.on('end', async () => {
  console.table(rows);
  await redis.quit();
});

stream.on('error', async (e) => {
  console.error('Redis scan error:', e?.message || e);
  await redis.quit();
  process.exit(1);
});
