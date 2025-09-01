import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { mac } = await req.json();
    const macUp = String(mac || '').trim().toUpperCase();
    if (!macUp) return NextResponse.json({ error: 'mac required' }, { status: 400 });

    const { getRedis } = await import('@/lib/redis');
    const r: any = getRedis();

    let cleared = 0;

    // 1) Remove any lock whose mac matches
    const lockKeys: string[] = [];
    if (typeof r.scan === 'function') {
      let cursor = '0';
      do {
        const [c, keys] = await r.scan(cursor, 'MATCH', 'kssk:lock:*', 'COUNT', 300);
        cursor = c; lockKeys.push(...(keys || []));
      } while (cursor !== '0');
    } else {
      lockKeys.push(...(await r.keys('kssk:lock:*').catch(() => [])));
    }

    for (const key of lockKeys) {
      try {
        const raw = await r.get(key);
        if (!raw) continue;
        const v = JSON.parse(raw);
        if (String(v?.mac || '').toUpperCase() !== macUp) continue;

        await r.del(key).catch(() => {});
        cleared++;

        // also remove from its station set if recorded
        const sid = v?.stationId ? String(v.stationId) : '';
        const kssk = v?.kssk ? String(v.kssk) : '';
        if (sid && kssk) await r.srem(`kssk:station:${sid}`, kssk).catch(() => {});
      } catch {}
    }

    // 2) Best-effort: prune stray members from all station sets that point to this MAC
    try {
      const stationSets: string[] =
        typeof r.scan === 'function'
          ? (await (async () => {
              let cursor = '0', acc: string[] = [];
              do {
                const [c, keys] = await r.scan(cursor, 'MATCH', 'kssk:station:*', 'COUNT', 300);
                cursor = c; acc.push(...(keys || []));
              } while (cursor !== '0');
              return acc;
            })())
          : await r.keys('kssk:station:*').catch(() => []);

      for (const setKey of stationSets) {
        const members: string[] = await r.smembers(setKey).catch(() => []);
        for (const kssk of members) {
          const raw = await r.get(`kssk:lock:${kssk}`).catch(() => null);
          if (!raw) { await r.srem(setKey, kssk).catch(() => {}); continue; }
          const v = JSON.parse(raw);
          if (String(v?.mac || '').toUpperCase() === macUp) {
            await r.del(`kssk:lock:${kssk}`).catch(() => {});
            await r.srem(setKey, kssk).catch(() => {});
            cleared++;
          }
        }
      }
    } catch {}

    return NextResponse.json({ ok: true, mac: macUp, cleared });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
