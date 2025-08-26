const base = process.env.LOCKS_BASE || 'http://localhost:3000';

// parse --id=... (also works without npm's npm_config_id)
let argId = '';
for (const a of process.argv.slice(2)) {
  if (a.startsWith('--id=')) argId = a.split('=')[1];
}

const stationId =
  argId ||
  process.env.STATION_ID ||                 // from env
  process.env.npm_config_id || '';          // from "npm run ... --id=..."

const url = new URL('/api/kssk-lock', base);
if (stationId) url.searchParams.set('stationId', stationId);

console.log('GET', url.toString());

const res = await fetch(url, { headers: { Accept: 'application/json' } });
const text = await res.text();
if (!res.ok) {
  console.error('HTTP', res.status, text);
  process.exit(1);
}

try {
  const json = JSON.parse(text);
  console.table((json.locks ?? []).map(l => ({
    kssk: String(l.kssk),
    mac: l.mac?.toUpperCase?.(),
    stationId: l.stationId,
    expiresAt: l.expiresAt
  })));
} catch {
  console.log(text);
}
