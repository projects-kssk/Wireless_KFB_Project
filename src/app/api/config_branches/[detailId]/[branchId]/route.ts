// src/app/api/config_branches/[detailId]/[branchId]/route.ts
import { NextResponse } from 'next/server'
import { pool }         from '@/lib/postgresPool'

export const dynamic = 'force-dynamic'

// Notice: both fields are optional (for PATCH semantics)
interface PatchBody {
  not_tested?: boolean
  loose_contact?: boolean
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ detailId: string; branchId: string }> }
) {
  // await the params promise (correct for Next.js route handlers!)
  const { detailId: detailStr, branchId: branchStr } = await params
  const detailId = Number(detailStr)
  const branchId = Number(branchStr)

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

  // Build SET clause dynamically:
  const updates: string[] = []
  const values: any[] = []
  let idx = 1
  if (typeof body.not_tested === 'boolean') {
    updates.push(`not_tested = $${idx++}`)
    values.push(body.not_tested)
  }
  if (typeof body.loose_contact === 'boolean') {
    updates.push(`loose_contact = $${idx++}`)
    values.push(body.loose_contact)
  }
  if (updates.length === 0) {
    return NextResponse.json(
      { error: 'At least one of `not_tested` or `loose_contact` (boolean) is required' },
      { status: 400 }
    )
  }

  // Add WHERE params
  values.push(detailId, branchId)

  const sql = `
    UPDATE config_branches
       SET ${updates.join(', ')}
     WHERE kfb_info_detail_id = $${idx++}
       AND branch_id          = $${idx}
  `

  const client = await pool.connect()
  try {
    await client.query(sql, values)
    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('PATCH /api/config_branches error', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  } finally {
    client.release()
  }
}
