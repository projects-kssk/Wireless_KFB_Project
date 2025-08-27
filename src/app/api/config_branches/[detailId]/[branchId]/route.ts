import { NextResponse } from 'next/server'
import { pool } from '@/lib/postgresPool'
import { LOG } from '@/lib/logger'

export const dynamic = 'force-dynamic'
const log = LOG.tag('api:config_branches')

// PATCH /api/config_branches/:detailId/:branchId
// Body: { not_tested?: boolean, loose_contact?: boolean }
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ detailId: string; branchId: string }> }
) {
  const { detailId, branchId } = await params
  const detail = Number(detailId)
  const branch = Number(branchId)
  if (Number.isNaN(detail) || Number.isNaN(branch)) {
    return NextResponse.json({ error: 'Invalid ids' }, { status: 400 })
  }

  let body: any
  try { body = await req.json() } catch { body = {} }

  const sets: string[] = []
  const vals: any[] = []

  if (typeof body.not_tested === 'boolean') {
    sets.push(`not_tested = $${sets.length + 3}`)
    vals.push(body.not_tested)
  }
  if (typeof body.loose_contact === 'boolean') {
    sets.push(`loose_contact = $${sets.length + 3}`)
    vals.push(body.loose_contact)
  }
  if (sets.length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  try {
    const q = `
      UPDATE config_branches
         SET ${sets.join(', ')}
       WHERE kfb_info_detail_id = $1 AND branch_id = $2`
    await pool.query(q, [detail, branch, ...vals])
    return NextResponse.json({ success: true })
  } catch (err: any) {
    log.error(`PATCH /api/config_branches/${detail}/${branch} error`, err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// DELETE /api/config_branches/:detailId/:branchId  (unlink)
// Also cleans up any pin mapping for that pair.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ detailId: string; branchId: string }> }
) {
  const { detailId, branchId } = await params
  const detail = Number(detailId)
  const branch = Number(branchId)
  if (Number.isNaN(detail) || Number.isNaN(branch)) {
    return NextResponse.json({ error: 'Invalid ids' }, { status: 400 })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `DELETE FROM esp_pin_mappings
        WHERE kfb_info_detail_id = $1 AND branch_id = $2`,
      [detail, branch]
    )
    const { rowCount } = await client.query(
      `DELETE FROM config_branches
        WHERE kfb_info_detail_id = $1 AND branch_id = $2`,
      [detail, branch]
    )
    await client.query('COMMIT')
    return NextResponse.json({ success: true, deleted: rowCount ?? 0 })
  } catch (err: any) {
    await client.query('ROLLBACK')
    log.error(`DELETE /api/config_branches/${detail}/${branch} error`, err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  } finally {
    client.release()
  }
}
