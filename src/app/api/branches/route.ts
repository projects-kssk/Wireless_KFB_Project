// src/app/api/branches/route.ts
import { NextResponse } from 'next/server'
import { pool }         from '@/lib/postgresPool'
import type { BranchDisplayData } from '@/types/types'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const url    = new URL(request.url)
  const kfb    = url.searchParams.get('kfb')
  const idsRaw = url.searchParams.get('ids')

  try {
    // ────────────────────────────────────────────────────────────────────────────
    // 1) SETTINGS MODE: return specific branches by ID list
    // ────────────────────────────────────────────────────────────────────────────
    if (idsRaw) {
      const ids = idsRaw
        .split(',')
        .map(s => Number(s.trim()))
        .filter(n => !Number.isNaN(n))

      if (ids.length === 0) {
        return NextResponse.json<BranchDisplayData[]>([], { status: 200 })
      }

      const { rows } = await pool.query<{
        id: number
        name: string
        created_at: string
      }>(
        `SELECT id, name, created_at
           FROM branches
          WHERE id = ANY($1)
          ORDER BY name`,
        [ids]
      )

      // We'll cast these to your BranchDisplayData shape (you can omit
      // fields your Settings component doesn't use)
  const data: BranchDisplayData[] = rows.map((r: { 
    id: number; 
    name: string; 
    created_at: string; 
  }) => ({
    id:           r.id.toString(),
    branchName:   r.name,
    testStatus:   'not_tested',
    pinNumber:    undefined,
    kfbInfoValue: undefined,
  }));

      return NextResponse.json(data)
    }

    // ────────────────────────────────────────────────────────────────────────────
    // 2) DASHBOARD MODE: require ?kfb=
    // ────────────────────────────────────────────────────────────────────────────
    if (!kfb) {
      return NextResponse.json(
        { error: 'Missing ?kfb=<your-kfb-string> parameter' },
        { status: 400 }
      )
    }

    const { rows } = await pool.query<{
      id:              number
      name:            string
      pin_number:      number | null
      kfb_info_value:  string | null
    }>(
      `
      SELECT DISTINCT ON (b.id)
        b.id,
        b.name,
        ep.pin_number,
        kid.kfb_info_value
      FROM configurations    AS cfg
      JOIN config_branches    AS cb
        ON cb.config_id = cfg.id
      JOIN branches          AS b
        ON b.id = cb.branch_id
      LEFT JOIN kfb_info_details   AS kid
        ON kid.id = cb.kfb_info_detail_id
      LEFT JOIN esp_pin_mappings   AS ep
        ON ep.kfb_info_detail_id = cb.kfb_info_detail_id
       AND ep.branch_id          = b.id
      WHERE cfg.kfb = $1
      ORDER BY b.id, ep.pin_number DESC
    `,
      [kfb]
    )

    const data = rows.map<BranchDisplayData>(r => ({
        id:           r.id.toString(),
        branchName:   r.name,
        testStatus:   'not_tested',
        pinNumber:    undefined,
        kfbInfoValue: undefined,
      }));

    return NextResponse.json(data)
  } catch (err: any) {
    console.error('GET /api/branches error:', err)
    return NextResponse.json(
      { error: err.message || 'Unknown error' },
      { status: 500 }
    )
  }
}
