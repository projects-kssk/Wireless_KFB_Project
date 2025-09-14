// scripts/clear-all-locks.mjs
// Danger: deletes ALL KSK lock keys and station index sets from Redis.
// Usage: npm run locks:deleteall

import fs from 'node:fs';
import path from 'node:path';
import Redis from 'ioredis';

// Lightweight .env loader
function loadEnvFiles() {
  try {
    const cwd = process.cwd();
    const files = ['.env', '.env.local', '.env.production'];
    for (const f of files) {
      const p = path.join(cwd, f);
      if (!fs.existsSync(p)) continue;
      const txt = fs.readFileSync(p, 'utf8');
      for (const line of txt.split(/\r?\n/)) {
        const s = line.trim();
        if (!s || s.startsWith('#')) continue;
        const i = s.indexOf('=');
        if (i <= 0) continue;
        const k = s.slice(0, i).trim();
        let v = s.slice(i + 1).trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith('\'') && v.endsWith('\''))) v = v.slice(1, -1);
        if (!(k in process.env)) process.env[k] = v;
      }
    }
  } catch {}
}
loadEnvFiles();

const url = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const pref = process.env.REDIS_LOCK_PREFIX || 'ksk:';          // lock value keys
const stationPref = process.env.Redis_STATION_PREFIX || process.env.REDIS_STATION_PREFIX || 'ksk:station:';

const redis = new Redis(url);

async function delKeys(pattern) {
  let count = 0;
  const stream = redis.scanStream({ match: pattern, count: 500 });
  await new Promise((resolve, reject) => {
    stream.on('data', async (keys) => {
      if (!Array.isArray(keys) || keys.length === 0) return;
      try {
        const chunks = [];
        for (let i = 0; i < keys.length; i += 500) chunks.push(keys.slice(i, i + 500));
        for (const chunk of chunks) {
          const n = await redis.del(...chunk).catch(() => 0);
          count += Number(n) || 0;
        }
      } catch {}
    });
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  return count;
}

async function main() {
  try {
    await new Promise((res) => {
      if (redis.status === 'ready') return res();
      const done = () => { redis.off('ready', done); res(); };
      redis.once('ready', done);
    });

    console.log('Connected to', url);
    const lockPattern = `${pref}*`;
    const stationPattern = `${stationPref}*`;

    const deletedLocks = await delKeys(lockPattern);
    const deletedStations = await delKeys(stationPattern);
    console.log(`Deleted locks: ${deletedLocks}`);
    console.log(`Deleted station index sets: ${deletedStations}`);
  } catch (e) {
    console.error('Error:', e?.message || e);
    process.exitCode = 1;
  } finally {
    try { await redis.quit(); } catch {}
  }
}

main();

