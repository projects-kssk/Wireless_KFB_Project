// scripts/migrate-station-sets.mjs
// Copy station set members from legacy 'kssk:station:*' to new 'ksk:station:*'.
// Options:
//   --delete-old    Delete legacy sets after copying
//   --dry-run       Print actions without writing
//   --pattern=...   Override match pattern (default 'kssk:station:*')
//   --redis=...     Redis URL (default from REDIS_URL)

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

const argv = process.argv.slice(2);
const opts = Object.create(null);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--delete-old') opts.deleteOld = true;
  else if (a === '--dry-run') opts.dryRun = true;
  else if (a.startsWith('--pattern=')) opts.pattern = a.split('=')[1];
  else if (a.startsWith('--redis=')) opts.redis = a.split('=')[1];
}

const url = opts.redis || process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const pattern = opts.pattern || 'kssk:station:*';

const redis = new Redis(url);

function toNewKey(oldKey) {
  if (oldKey.startsWith('kssk:station:')) return 'ksk:station:' + oldKey.slice('kssk:station:'.length);
  return oldKey.replace(/^kssk:/, 'ksk:');
}

async function migrate() {
  let cursor = '0';
  const found = [];
  do {
    const res = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 300);
    cursor = res[0];
    const keys = res[1] || [];
    found.push(...keys);
  } while (cursor !== '0');

  if (found.length === 0) {
    console.log('No legacy station sets found matching', pattern);
    return;
  }

  console.log(`Found ${found.length} legacy sets`);
  for (const oldKey of found) {
    const newKey = toNewKey(oldKey);
    const members = await redis.smembers(oldKey).catch(() => []);
    if (!Array.isArray(members) || members.length === 0) {
      console.log('Skip empty set', oldKey);
      if (opts.deleteOld && !opts.dryRun) await redis.del(oldKey).catch(() => {});
      continue;
    }
    console.log(`Copy ${members.length} -> ${newKey} (from ${oldKey})`);
    if (!opts.dryRun) await redis.sadd(newKey, ...members).catch(() => {});
    if (opts.deleteOld && !opts.dryRun) await redis.del(oldKey).catch(() => {});
  }
}

migrate()
  .then(() => { try { redis.disconnect(); } catch {} })
  .catch((e) => { console.error('Migration error', e); try { redis.disconnect(); } catch {} });

