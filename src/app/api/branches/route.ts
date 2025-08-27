// src/app/api/branches/route.ts
import { NextResponse }           from 'next/server'
import { pool }                   from '@/lib/postgresPool'
import type { BranchDisplayData } from '@/types/types'
import { z } from 'zod' // ⬅️ add this import
import { LOG } from '@/lib/logger'
export const dynamic = 'force-dynamic'
const BodySchema = z.object({ name: z.string().trim().min(1) })
const log = LOG.tag('api:branches')
export async function GET(request: Request) {
  const url    = new URL(request.url)
  const kfb    = url.searchParams.get('kfb')
  const idsRaw = url.searchParams.get('ids')
  try {
    // SETTINGS MODE: fetch by explicit IDs
    if (idsRaw) {
      const ids = idsRaw
        .split(',')
        .map(s => Number(s.trim()))
        .filter(n => !Number.isNaN(n))

      if (ids.length === 0) {
        return NextResponse.json<BranchDisplayData[]>([], { status: 200 })
      }

      const { rows } = await pool.query<{
        id: number;
        name: string;
        not_tested: boolean | null;
        loose_contact: boolean | null;
      }>(
        `SELECT b.id, b.name, cb.not_tested, cb.loose_contact
          FROM branches b
      LEFT JOIN config_branches cb ON cb.branch_id = b.id
          WHERE b.id = ANY($1)
      ORDER BY b.name`,
        [ids]
      )

      const data: BranchDisplayData[] = rows.map(r => ({
        id:           r.id.toString(),
        branchName:   r.name,
        testStatus:   'not_tested',
        pinNumber:    undefined,
        kfbInfoValue: undefined,
        notTested:    !!r.not_tested,
        looseContact: !!r.loose_contact,
      }))

      return NextResponse.json(data, { status: 200 })
    }

    // DASHBOARD MODE: fetch by KFB
    if (!kfb) {
      return NextResponse.json({ error: 'Missing ?kfb=' }, { status: 400 })
    }

   const { rows } = await pool.query<{
      id: number;
      name: string;
      pin_number: number | null;
      kfb_info_value: string | null;
      not_tested: boolean | null;
      loose_contact: boolean | null;
    }>(
      `
      SELECT DISTINCT ON (b.id)
        b.id,
        b.name,
        ep.pin_number,
        kid.kfb_info_value,
        cb.not_tested,
        cb.loose_contact
      FROM configurations    AS cfg
      JOIN config_branches    AS cb ON cb.config_id = cfg.id
      JOIN branches           AS b  ON b.id = cb.branch_id
      LEFT JOIN kfb_info_details AS kid ON kid.id = cb.kfb_info_detail_id
      LEFT JOIN esp_pin_mappings  AS ep  ON
          ep.kfb_info_detail_id = cb.kfb_info_detail_id
        AND ep.branch_id         = b.id
      WHERE cfg.kfb = $1
      ORDER BY b.id, ep.pin_number DESC
      `,
      [kfb]
    )

    const data: BranchDisplayData[] = rows.map(r => ({
      id:           r.id.toString(),
      branchName:   r.name,
      testStatus:   'not_tested',
      pinNumber:    r.pin_number ?? undefined,
      kfbInfoValue: r.kfb_info_value ?? undefined,
      notTested:    !!r.not_tested,
      looseContact: !!r.loose_contact,
    }))


    return NextResponse.json(data, { status: 200 })
  } catch (err: any) {
    log.error('GET /api/branches error', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(request: Request) {

    // 1) parse & validate
  let name: string
  try {
    const json = await request.json()            // json: unknown
    const parsed = BodySchema.safeParse(json)    // narrow & validate
    if (!parsed.success) {
      return NextResponse.json({ error: 'Branch name is required' }, { status: 400 })
    }
    name = parsed.data.name
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }


  const client = await pool.connect()
  try {
    // 2) attempt to insert, but do nothing if it already exists
    await client.query(
      `INSERT INTO branches(name)
         VALUES ($1)
         ON CONFLICT (name) DO NOTHING`,
      [name]
    )

    // 3) fetch *that* branch row (new or existing)
    const sel = await client.query<{ id: number; name: string }>(
      `SELECT id, name
         FROM branches
        WHERE name = $1
        LIMIT 1`,
      [name]
    )
    if (sel.rows.length === 0) {
      throw new Error('Could not retrieve branch after upsert')
    }
    const row = sel.rows[0]

    // 4) respond in the shape the UI wants
    const responseData: BranchDisplayData = {
      id:           row.id.toString(),
      branchName:   row.name,
      testStatus:   'not_tested',
      pinNumber:    undefined,
      kfbInfoValue: undefined,
    }
    return NextResponse.json(responseData, { status: 201 })
  } catch (err: any) {
    log.error('POST /api/branches error', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  } finally {
    client.release()
  }
}
