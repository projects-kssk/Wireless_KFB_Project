import { NextResponse } from 'next/server';
import { pool} from '@/lib/postgresPool';
import type { Pool, PoolClient } from "pg";
export const dynamic = 'force-dynamic';

type CfgRow = { id: number; kfb: string; mac_address: string };
type DetailRow = { id: number; config_id: number; kfb_info_value: string };
type BranchRow = { id: number; name: string };
type CbRow = { kfb_info_detail_id: number; branch_id: number; name: string };
type PinRow = { kfb_info_detail_id: number; pin_number: number; branch_id: number };
function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== '';
}

async function tableHasConfigIdOnEspPins(client: any): Promise<boolean> {
  const { rows } = await client.query(
    `SELECT 1
       FROM information_schema.columns
      WHERE table_name = 'esp_pin_mappings'
        AND column_name = 'config_id'
      LIMIT 1`
  );
  return rows.length > 0;
}
// was: export async function upsertBranches(
async function upsertBranches(
  client: Pool | PoolClient,
  names: string[]
): Promise<Map<string, number>> {
  const uniq = Array.from(new Set(names.map(n => n.trim()).filter(Boolean)));
  const map = new Map<string, number>();
  for (const name of uniq) {
    const res = await client.query<BranchRow>(
      `INSERT INTO branches(name)
       VALUES($1)
       ON CONFLICT(name) DO UPDATE SET name = EXCLUDED.name
       RETURNING id, name`,
      [name]
    );
    map.set(res.rows[0].name, res.rows[0].id);
  }
  return map;
}

/* GET /api/configurations/[id] */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (Number.isNaN(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const cfgRes = await client.query<CfgRow>(
      `SELECT id, kfb, mac_address
         FROM configurations
        WHERE id = $1
        LIMIT 1`,
      [id]
    );
    if (cfgRes.rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const cfg = cfgRes.rows[0];

    const detRes = await client.query<DetailRow>(
      `SELECT id, config_id, kfb_info_value
         FROM kfb_info_details
        WHERE config_id = $1
        ORDER BY id`,
      [id]
    );
    const details = detRes.rows;
    const detailIds = details.map(d => d.id);

    let branchLinks: CbRow[] = [];
    if (detailIds.length) {
      const bl = await client.query<CbRow>(
        `SELECT cb.kfb_info_detail_id, b.id AS branch_id, b.name
           FROM config_branches cb
           JOIN branches b ON b.id = cb.branch_id
          WHERE cb.kfb_info_detail_id = ANY($1)`,
        [detailIds]
      );
      branchLinks = bl.rows;
    }

    let pinLinks: PinRow[] = [];
    if (detailIds.length) {
      const pl = await client.query<PinRow>(
        `SELECT kfb_info_detail_id, pin_number, branch_id
           FROM esp_pin_mappings
          WHERE kfb_info_detail_id = ANY($1)`,
        [detailIds]
      );
      pinLinks = pl.rows;
    }

    const kfbInfo = details.map(d => d.kfb_info_value);
    const branchSet = new Map<number, string>();
    branchLinks.forEach(link => branchSet.set(link.branch_id, link.name));
    const branchPins = Array.from(branchSet.entries()).map(([bid, name]) => ({ id: bid, name }));

    const espPinMappings: Record<string, string> = {};
    pinLinks.forEach(p => {
      const name = branchSet.get(p.branch_id);
      if (name) espPinMappings[p.pin_number.toString()] = name;
    });

    return NextResponse.json(
      {
        id: cfg.id,
        kfb: cfg.kfb,
        mac_address: cfg.mac_address,
        kfbInfo,
        branchPins,
        espPinMappings,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error(`GET /api/configurations/${id} error:`, err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  } finally {
    client.release();
  }
}
/* PUT /api/configurations/[id] */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (Number.isNaN(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { kfb, mac_address, kfbInfo, branchPins, espPinMappings } = body ?? {};
  if (
    !isNonEmptyString(kfb) ||
    typeof mac_address !== 'string' ||
    !Array.isArray(kfbInfo) ||
    !Array.isArray(branchPins) ||
    typeof espPinMappings !== 'object' ||
    espPinMappings === null
  ) {
    return NextResponse.json({ error: 'Invalid request shape' }, { status: 400 });
  }

  // Normalize + enforce uniqueness at the application layer to match DB constraint
  const infoValues = kfbInfo
    .filter((v: unknown): v is string => typeof v === 'string')
    .map(v => v.trim())
    .filter(v => v.length > 0);

  // IMPORTANT: dedupe to satisfy UNIQUE(config_id, kfb_info_value)
  const desiredValues = Array.from(new Set(infoValues));

  const unionBranchNames = Array.from(
    new Set<string>([
      ...branchPins
        .filter((v: unknown): v is string => typeof v === 'string')
        .map(n => n.trim())
        .filter(Boolean),
      ...Object.values(espPinMappings)
        .filter((v: unknown): v is string => typeof v === 'string')
        .map(n => n.trim())
        .filter(Boolean),
    ])
  );

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const hasConfigId = await tableHasConfigIdOnEspPins(client);

    // 1) Update base config
    const upd = await client.query<CfgRow>(
      `UPDATE configurations
          SET kfb = $2,
              mac_address = $3
        WHERE id = $1
        RETURNING id`,
      [id, kfb, mac_address]
    );
    if (upd.rows.length === 0) throw new Error('Configuration not found');

    // 2) Fetch current detail ids
    const detRes = await client.query<DetailRow>(
      `SELECT id, config_id, kfb_info_value
         FROM kfb_info_details
        WHERE config_id = $1
        ORDER BY id`,
      [id]
    );
    const currentDetails = detRes.rows;
    const currentIds = currentDetails.map(d => d.id);

    // 3) Remove all existing links + details (avoid mid-update UNIQUE violations)
    if (currentIds.length) {
      await client.query(`DELETE FROM esp_pin_mappings WHERE kfb_info_detail_id = ANY($1)`, [currentIds]);
      await client.query(`DELETE FROM config_branches   WHERE kfb_info_detail_id = ANY($1)`, [currentIds]);
      await client.query(`DELETE FROM kfb_info_details  WHERE id                  = ANY($1)`, [currentIds]);
    }

    // 4) Insert new details (deduped)
    let finalDetailIds: number[] = [];
    if (desiredValues.length) {
      const ins = await client.query<{ id: number }>(
        `INSERT INTO kfb_info_details(config_id, kfb_info_value)
         SELECT x.config_id, x.kfb_info_value
           FROM UNNEST($1::int[], $2::text[]) AS x(config_id, kfb_info_value)
         RETURNING id`,
        [desiredValues.map(() => id), desiredValues]
      );
      finalDetailIds = ins.rows.map(r => r.id);
    }

    // 5) Upsert branches
    const branchIdMap = await upsertBranches(client, unionBranchNames);

    // 6) Rebuild links for each detail
    for (const detailId of finalDetailIds) {
      // config_branches
      if (unionBranchNames.length) {
        const branchIds = unionBranchNames.map(n => branchIdMap.get(n)!).filter(Boolean);
        if (branchIds.length) {
          await client.query(
            `INSERT INTO config_branches(config_id, kfb_info_detail_id, branch_id)
             SELECT * FROM UNNEST($1::int[], $2::int[], $3::int[])`,
            [branchIds.map(() => id), branchIds.map(() => detailId), branchIds]
          );
        }
      }

      // esp_pin_mappings
      const entries = Object.entries(espPinMappings);
      for (const [pinStr, branchName] of entries) {
        const pin = Number(pinStr);
        if (Number.isNaN(pin)) continue;
        if (!isNonEmptyString(branchName)) continue;
        const bid = branchIdMap.get(branchName.trim());
        if (!bid) continue;

        if (hasConfigId) {
          await client.query(
            `INSERT INTO esp_pin_mappings(config_id, kfb_info_detail_id, pin_number, branch_id)
             VALUES ($1, $2, $3, $4)`,
            [id, detailId, pin, bid]
          );
        } else {
          await client.query(
            `INSERT INTO esp_pin_mappings(kfb_info_detail_id, pin_number, branch_id)
             VALUES ($1, $2, $3)`,
            [detailId, pin, bid]
          );
        }
      }
    }

    await client.query('COMMIT');
    return NextResponse.json({ success: true, id }, { status: 200 });
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error(`PUT /api/configurations/${id} error:`, err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  } finally {
    client.release();
  }
}


/* DELETE /api/configurations/[id] */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (Number.isNaN(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const detRes = await client.query<{ id: number }>(
      `SELECT id FROM kfb_info_details WHERE config_id = $1`,
      [id]
    );
    const detailIds = detRes.rows.map(r => r.id);

    if (detailIds.length) {
      await client.query(`DELETE FROM esp_pin_mappings WHERE kfb_info_detail_id = ANY($1)`, [detailIds]);
      await client.query(`DELETE FROM config_branches   WHERE kfb_info_detail_id = ANY($1)`, [detailIds]);
      await client.query(`DELETE FROM kfb_info_details  WHERE id                  = ANY($1)`, [detailIds]);
    }

    await client.query(`DELETE FROM configurations WHERE id = $1`, [id]);

    await client.query('COMMIT');
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error(`DELETE /api/configurations/${id} error:`, err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  } finally {
    client.release();
  }
}
