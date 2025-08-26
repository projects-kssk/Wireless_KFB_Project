const base = process.env.LOCKS_BASE || 'http://localhost:3000';
const stationId = process.env.STATION_ID; // optional

const url = new URL('/api/kssk-lock', base);
if (stationId) url.searchParams.set('stationId', stationId);

const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
if (!res.ok) {
  console.error('HTTP', res.status);
  process.exit(1);
}
const json = await res.json();
console.table((json.locks ?? []).map(l => ({
  kssk: String(l.kssk),
  mac: l.mac?.toUpperCase?.(),
  stationId: l.stationId,
  expiresAt: l.expiresAt
})));
