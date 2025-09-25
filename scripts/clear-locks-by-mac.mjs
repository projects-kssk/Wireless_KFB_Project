// scripts/clear-locks-by-mac.mjs
// Delete all KSK locks in Redis that belong to a specific MAC address.
// Usage:
//   - npm run locks:delete -- 08:3A:8D:15:27:54
//   - npm run locks:delete -- --mac=08:3A:8D:15:27:54
//   - npm run locks:delete:08:3A:8D:15:27:54
// Respects .env for REDIS_URL, REDIS_LOCK_PREFIX, REDIS_STATION_PREFIX

import fs from 'node:fs';
import path from 'node:path';
import Redis from 'ioredis';

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

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const LOCK_PREF = process.env.REDIS_LOCK_PREFIX || 'ksk:'; // value keys
const STATION_PREF = process.env.Redis_STATION_PREFIX || process.env.REDIS_STATION_PREFIX || 'ksk:station:'; // station index sets

function parseArgs() {
  const argv = process.argv.slice(2);
  let mac = process.env.npm_config_mac || '';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!mac && a && a.includes(':') && a.length >= 17) mac = a; // positional MAC
    else if (a.startsWith('--mac=')) mac = a.split('=')[1];
    else if (a === '--mac') mac = argv[++i];
  }
  mac = canonicalMac(mac) || String(mac || '').trim().toUpperCase();
  return { mac };
}

function canonicalMac(s) {
  const m = String(s || '').toUpperCase().match(/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/);
  return m ? m[0] : null;
}

async function readLock(redis, key) {
  const res = await redis
    .pipeline()
    .pttl(key)
    .get(key)
    .hgetall(key)
    .exec();
  const pttl = res?.[0]?.[1];
  const str = res?.[1]?.[1];
  const hash = res?.[2]?.[1] || {};
  let mac = null, stationId = null;
  if (typeof str === 'string') {
    try {
      const j = JSON.parse(str);
      mac = j.mac || j.boardMac || null;
      stationId = j.stationId || null;
    } catch {}
  }
  if (!mac && hash && Object.keys(hash).length) {
    mac = hash.mac || hash.boardMac || null;
    stationId = hash.stationId || null;
  }
  const normMac = canonicalMac(mac) || (mac ? String(mac).toUpperCase() : null);
  return { ttlMs: typeof pttl === 'number' ? pttl : null, mac: normMac, stationId };
}

async function removeFromAllStations(redis, kssk) {
  const pattern = `${STATION_PREF}*`;
  const stream = redis.scanStream({ match: pattern, count: 200 });
  const tasks = [];
  await new Promise((resolve, reject) => {
    stream.on('data', (keys) => {
      if (!Array.isArray(keys) || keys.length === 0) return;
      for (const skey of keys) tasks.push(redis.srem(skey, kssk).catch(() => 0));
    });
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  try { await Promise.all(tasks); } catch {}
}

async function main() {
  const { mac } = parseArgs();
  if (!canonicalMac(mac)) {
    console.error('Usage: npm run locks:delete -- AA:BB:CC:DD:EE:FF');
    console.error('       npm run locks:delete -- --mac=AA:BB:CC:DD:EE:FF');
    process.exit(1);
  }

  const redis = new Redis(REDIS_URL);
  try {
    await new Promise((res) => {
      if (redis.status === 'ready') return res();
      const done = () => { redis.off('ready', done); res(); };
      redis.once('ready', done);
    });
    console.log('Connected to', REDIS_URL);
    console.log('Deleting locks for MAC', mac);

    const pattern = `${LOCK_PREF}*`;
    let deleted = 0;
    let touchedStations = 0;
    const stream = redis.scanStream({ match: pattern, count: 500 });
    await new Promise((resolve, reject) => {
      stream.on('data', async (keys) => {
        if (!Array.isArray(keys) || keys.length === 0) return;
        for (const key of keys) {
          if (key.startsWith(STATION_PREF)) continue; // skip station sets
          const kssk = key.startsWith(LOCK_PREF) ? key.slice(LOCK_PREF.length) : key;
          try {
            const { mac: m, stationId } = await readLock(redis, key);
            if (!m || m !== mac) continue;
            const n = await redis.del(key).catch(() => 0);
            if (n) {
              deleted += n;
              if (stationId) {
                try { await redis.srem(`${STATION_PREF}${stationId}`, kssk).catch(() => 0); touchedStations++; } catch {}
              } else {
                // Fallback: attempt removal from all station sets
                await removeFromAllStations(redis, kssk).catch(() => {});
              }
              console.log(' - removed', key, stationId ? `(station ${stationId})` : '');
            }
          } catch {}
        }
      });
      stream.on('end', resolve);
      stream.on('error', reject);
    });

    console.log(`Done. Deleted locks: ${deleted}${touchedStations ? `; station updates: ${touchedStations}` : ''}`);
  } catch (e) {
    console.error('Error:', e?.message || e);
    process.exitCode = 1;
  } finally {
    try { await redis.quit(); } catch {}
  }
}

main();
