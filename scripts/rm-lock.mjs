const id = process.env.npm_config_id || process.argv.find(a=>a.startsWith('--id='))?.split('=')[1];
const k = process.env.npm_config_kssk || process.argv.find(a=>a.startsWith('--kssk='))?.split('=')[1];
const force = process.env.npm_config_force ? '&force=1' : '';
if (!k) throw new Error('Pass --kssk=...');
const url = `http://localhost:3000/api/kssk-lock?kssk=${encodeURIComponent(k)}${id?`&stationId=${id}`:''}${force}`;
console.log('DELETE', url);
fetch(url, { method: 'DELETE' }).then(r=>r.text()).then(console.log);
