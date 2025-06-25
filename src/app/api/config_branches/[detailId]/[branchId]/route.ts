// src/app/api/config_branches/[detailId]/[branchId]/route.ts
import { NextResponse } from 'next/server'
import { pool }         from '@/lib/postgresPool'

export const dynamic = 'force-dynamic'

interface PatchBody { not_tested: boolean }

export async function PATCH(
  request: Request,
  { params }: { params: { detailId: string; branchId: string } }
) {
  const detailId = Number(params.detailId)
  const branchId = Number(params.branchId)
  if (Number.isNaN(detailId) || Number.isNaN(branchId)) {
    return NextResponse.json(
      { error: 'Invalid detailId or branchId in URL' },
      { status: 400 }
    )
  }

  let body: PatchBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (typeof body.not_tested !== 'boolean') {
    return NextResponse.json(
      { error: 'Field `not_tested` (boolean) is required' },
      { status: 400 }
    )
  }

  const client = await pool.connect()
  try {
    await client.query(
      `UPDATE config_branches
          SET not_tested = $1
        WHERE kfb_info_detail_id = $2
          AND branch_id          = $3`,
      [body.not_tested, detailId, branchId]
    )
    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('PATCH /api/config_branches error', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  } finally {
    client.release()
  }
}
