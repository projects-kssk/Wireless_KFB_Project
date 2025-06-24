// src/app/api/branches/route.ts
import { NextResponse } from 'next/server'
import { pool }         from '@/lib/postgresPool'
import type { BranchDisplayData } from '@/types/types'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const kfb = url.searchParams.get('kfb')

  if (!kfb) {
    return NextResponse.json(
      { error: 'Missing ?kfb=<your-kfb-string> parameter' },
      { status: 400 }
    )
  }

  try {
    const { rows } = await pool.query<{
      id: number
      name: string
      pin_number: number | null
      kfb_info_value: string | null
    }>(`
      SELECT DISTINCT ON (b.id)
        b.id,
        b.name,
        ep.pin_number,
        kid.kfb_info_value
      FROM configurations AS cfg
      JOIN config_branches AS cb
        ON cb.config_id = cfg.id
      JOIN branches AS b
        ON b.id = cb.branch_id
      LEFT JOIN esp_pin_mappings AS ep
        ON ep.config_id      = cfg.id
       AND ep.branch_id     = b.id
      LEFT JOIN kfb_info_details AS kid
        ON kid.id            = cb.kfb_info_detail_id
      WHERE cfg.kfb = $1
      ORDER BY b.id, ep.pin_number DESC  -- pick the “best” pin if you want
    `, [kfb]);

    // Map into your UI shape
    const data: BranchDisplayData[] = rows.map((r) => ({
      id:         r.id.toString(),
      branchName: r.name,
      testStatus: r.pin_number != null ? 'ok' : 'not_tested',
      pinNumber:  r.pin_number ?? undefined,
      // if you want to display the KFB info value somewhere
      kfbInfoValue: r.kfb_info_value ?? undefined,
    }))

    return NextResponse.json(data)
  } catch (err: any) {
    console.error('GET /api/branches error:', err)
    return NextResponse.json(
      { error: err.message || 'Unknown error' },
      { status: 500 }
    )
  }
}
