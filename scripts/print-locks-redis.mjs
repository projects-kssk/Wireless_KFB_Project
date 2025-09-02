// scripts/print-locks-redis.mjs
// Enhanced: respects STATION_ID to list only that station’s locks, or scans all.
import fs from 'node:fs';
import path from 'node:path';
import Redis from 'ioredis';

// Lightweight .env loader (no deps). Loads before reading env vars.
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

const url         = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const pref        = process.env.REDIS_LOCK_PREFIX || 'ksk:';                // lock value keys
const stationPref = process.env.Redis_STATION_PREFIX || process.env.REDIS_STATION_PREFIX || 'ksk:station:';     // station index set
let stationId     = process.env.STATION_ID || process.env.NEXT_PUBLIC_STATION_ID || process.env.npm_config_id || process.env.HOSTNAME || '';

// --- tiny argv parser ---
const argv = process.argv.slice(2);
const opts = Object.create(null);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--watch' || a === '-w') opts.watch = true;
  else if (a === '--clear' || a === '-c') opts.clear = true;
  else if (a.startsWith('--interval=')) opts.interval = Number(a.split('=')[1]);
  else if (a === '--interval' || a === '-i') opts.interval = Number(argv[++i]);
  else if (a.startsWith('--id=')) stationId = a.split('=')[1];
  else if (a === '--id') stationId = argv[++i];
  else if (a.startsWith('--match=')) opts.match = a.split('=')[1];
  else if (a === '--match' || a === '-m') opts.match = argv[++i];
}

function compileRegex(src) {
  if (!src) return null;
  try {
    if (src.startsWith('/') && src.lastIndexOf('/') > 0) {
      const i = src.lastIndexOf('/');
      const body = src.slice(1, i);
      const flags = src.slice(i + 1);
      return new RegExp(body, flags);
    }
    return new RegExp(src);
  } catch {
    return null;
  }
}
const matchRe = compileRegex(opts.match || process.env.KSK_REGEX || process.env.KFB_REGEX);

const redis = new Redis(url);

function parseKey(key) {
  return key.startsWith(pref) ? key.slice(pref.length) : key;
}

function expiryFromPTTL(pttl) {
  // pttl is milliseconds; -1 no expire, -2 no key
  if (typeof pttl !== 'number' || pttl <= 0) return null;
  const d = new Date(Date.now() + pttl);
  return d.toISOString();
}

async function readLock(key) {
  // Pipeline: PTTL + GET + HGETALL to support both string-json and hash storage
  const res = await redis
    .pipeline()
    .pttl(key)
    .get(key)
    .hgetall(key)
    .exec();

  const pttl = res?.[0]?.[1];
  const str  = res?.[1]?.[1];
  const hash = res?.[2]?.[1] || {};

  let mac = null, station = null, createdAt = null;
  if (typeof str === 'string') {
    try {
      const j = JSON.parse(str);
      mac       = j.mac || j.boardMac || null;
      station   = j.stationId || null;
      createdAt = j.createdAt || null;
    } catch {}
  }
  if (!mac && hash && Object.keys(hash).length) {
    mac       = hash.mac || hash.boardMac || null;
    station   = hash.stationId || null;
    createdAt = hash.createdAt || null;
  }

  return {
    key,
    kssk: parseKey(key),
    mac: mac ? String(mac).toUpperCase() : null,
    stationId: station || null,
    expiresAt: expiryFromPTTL(typeof pttl === 'number' ? pttl : null),
    ttlSec: typeof pttl === 'number' && pttl > 0 ? Math.round(pttl / 1000) : pttl,
    present: pttl !== -2,
  };
}

async function listByStation(id) {
  const setKey = stationPref + id;
  const members = await redis.smembers(setKey);
  const keys = members.map(k => pref + k);
  const rows = [];
  for (const key of keys) rows.push(await readLock(key));
  return rows;
}

async function scanAll() {
  const rows = [];
  const stream = redis.scanStream({ match: `${pref}*`, count: 500 });
  await new Promise((resolve, reject) => {
    stream.on('data', async (keys) => {
      if (!Array.isArray(keys) || keys.length === 0) return;
      // Batch per chunk to keep order reasonable
      const chunk = await Promise.all(keys.map(k => readLock(k)));
      rows.push(...chunk);
    });
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  return rows;
}

async function scanStations() {
  const stations = [];
  // Scan station index sets
  const stream = redis.scanStream({ match: `${stationPref}*`, count: 200 });
  await new Promise((resolve, reject) => {
    stream.on('data', async (keys) => {
      if (!Array.isArray(keys) || keys.length === 0) return;
      for (const skey of keys) {
        try {
          const id = skey.slice(stationPref.length);
          const members = await redis.smembers(skey);
          stations.push({ stationId: id, members });
        } catch {}
      }
    });
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  // Sort by stationId for stable output
  stations.sort((a,b) => String(a.stationId).localeCompare(String(b.stationId)));
  return stations;
}

async function main() {
  try {
    // Wait for ready quickly
    await new Promise((res) => {
      if (redis.status === 'ready') return res();
      const done = () => { redis.off('ready', done); res(); };
      redis.once('ready', done);
    });

    const pad = (n) => String(n).padStart(2, '0');
    const fmtLocal = (iso) => {
      if (!iso) return '';
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return String(iso);
      return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    };
    const fmtIn = (ttlSec) => {
      const s = Number(ttlSec);
      if (!Number.isFinite(s) || s <= 0) return '';
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const sec = Math.floor(s % 60);
      const parts = [];
      if (h) parts.push(`${h}h`);
      if (m) parts.push(`${m}m`);
      parts.push(`${sec}s`);
      return 'in ' + parts.join(' ');
    };

    const fmtPins = (arr) => {
      const xs = Array.isArray(arr) ? arr.map(n => Number(n)).filter(n => Number.isFinite(n) && n>0) : [];
      xs.sort((a,b)=>a-b);
      const s = xs.join(',');
      if (s.length <= 48) return s;
      // trim but keep counts visible
      const head = xs.slice(0, 12).join(',');
      return head + ` …(+${Math.max(0, xs.length-12)})`;
    };
    const sampleMap = (names) => {
      if (!names || typeof names !== 'object') return '';
      const entries = Object.entries(names)
        .map(([k,v]) => [Number(k), String(v)])
        .filter(([k]) => Number.isFinite(k) && k>0)
        .sort((a,b)=>a[0]-b[0]);
      if (!entries.length) return '';
      const shown = entries.slice(0, 4).map(([k,v]) => `${k}:${v}`);
      const extra = entries.length - shown.length;
      return extra > 0 ? `${shown.join(' | ')} …(+${extra})` : shown.join(' | ');
    };

    const runOnce = async () => {
      let rows = [];
      if (stationId) rows = await listByStation(stationId);
      else rows = await scanAll();

      if (matchRe) rows = rows.filter(r => matchRe.test(String(r.kssk)));

      // Sort by expires soonest first
      rows.sort((a, b) => {
        const ax = a.expiresAt ? Date.parse(a.expiresAt) : Infinity;
        const bx = b.expiresAt ? Date.parse(b.expiresAt) : Infinity;
        return ax - bx;
      });

      // Enrich with alias data (names, pins); fallback to lastpins snapshot
      for (const r of rows) {
        try {
          if (!r.mac) continue;
          const key = `kfb:aliases:${r.mac}:${r.kssk}`;
          const raw = await redis.get(key).catch(() => null);
          if (raw) {
            const d = JSON.parse(raw);
            r.__aliases = d?.names || d?.aliases || {};
            // Policy: do NOT derive pins from alias keys. Only trust explicit arrays.
            r.__pinsN = Array.isArray(d?.normalPins) ? d.normalPins : [];
            r.__pinsC = Array.isArray(d?.latchPins) ? d.latchPins : [];
          }
        } catch {}
        try {
          if (!r.mac || (Array.isArray(r.__pinsN) && r.__pinsN.length) || (Array.isArray(r.__pinsC) && r.__pinsC.length)) continue;
          const keyLP = `kfb:lastpins:${r.mac}:${r.kssk}`;
          const rawLP = await redis.get(keyLP).catch(() => null);
          if (rawLP) {
            const d2 = JSON.parse(rawLP);
            if (!Array.isArray(r.__pinsN) || r.__pinsN.length === 0) r.__pinsN = Array.isArray(d2?.normalPins) ? d2.normalPins : [];
            if (!Array.isArray(r.__pinsC) || r.__pinsC.length === 0) r.__pinsC = Array.isArray(d2?.latchPins) ? d2.latchPins : [];
          }
        } catch {}
        // Fallback names for map: pick labels from MAC union for the pins we have
        try {
          const havePins = (Array.isArray(r.__pinsN) && r.__pinsN.length) || (Array.isArray(r.__pinsC) && r.__pinsC.length);
          const noNames = !r.__aliases || Object.keys(r.__aliases).length === 0;
          if (r.mac && havePins && noNames) {
            const rawU = await redis.get(`kfb:aliases:${r.mac}`).catch(() => null);
            if (rawU) {
              const dU = JSON.parse(rawU);
              const namesU = (dU?.names && typeof dU.names === 'object') ? dU.names : {};
              const need = new Set([...(r.__pinsN || []), ...(r.__pinsC || [])].map(n=>Number(n)).filter(n=>Number.isFinite(n)));
              const sel = {};
              for (const [pin, label] of Object.entries(namesU)) {
                const p = Number(pin);
                if (Number.isFinite(p) && need.has(p)) sel[pin] = String(label);
              }
              r.__aliases = sel;
            }
          }
        } catch {}
      }

      if (opts.clear) console.clear();
      const hdr = [`Redis: ${url}`, stationId ? `station=${stationId}` : 'station=ALL'];
      if (matchRe) hdr.push(`match=${matchRe}`);
      console.log(hdr.join(' | '));

      if (!rows.length) {
        console.log('(no locks found)');
      } else {
        console.table(rows.map(r => ({
          ksk: (r.ksk ?? r.kssk),
          mac: r.mac,
          stationId: r.stationId,
          ttlSec: r.ttlSec,
          expiresAt: fmtLocal(r.expiresAt),
          expiresIn: fmtIn(r.ttlSec),
          pinsN: fmtPins(r.__pinsN),
          pinsC: fmtPins(r.__pinsC),
          map: sampleMap(r.__aliases),
        })));
      }

      // Always print station index summary to help discover station IDs
      try {
        const stations = await scanStations();
        if (stations.length) {
          console.log('\nStation index summary:');
          console.table(stations.map(s => ({
            stationId: s.stationId,
            count: Array.isArray(s.members) ? s.members.length : 0,
            members: Array.isArray(s.members) ? (s.members.length > 8 ? (s.members.slice(0,8).join(',') + ` …(+${s.members.length-8})`) : s.members.join(',')) : '',
          })));
          if (!stationId) console.log('Tip: pass --id <stationId> to view lock details for a station.');
        } else {
          console.log('\n(no station index keys found)');
        }
      } catch (e) {
        console.error('Failed to scan stations:', e?.message || e);
      }
    };

    if (opts.watch) {
      const interval = Number.isFinite(opts.interval) && opts.interval > 0 ? opts.interval : 2000;
      console.log(`Watching${opts.clear ? ' (clearing)' : ''} every ${interval}ms... (Ctrl+C to exit)`);
      // eslint-disable-next-line no-constant-condition
      while (true) {
        // break on termination signals via thrown error on quit
        await runOnce();
        await new Promise(res => setTimeout(res, interval));
      }
    } else {
      await runOnce();
    }
  } catch (e) {
    console.error('Error:', e?.message || e);
    process.exitCode = 1;
  } finally {
    try { await redis.quit(); } catch {}
  }
}

main();
