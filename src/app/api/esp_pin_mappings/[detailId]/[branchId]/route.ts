import { NextResponse } from 'next/server'
import { pool } from '@/lib/postgresPool'
import { LOG } from '@/lib/logger'

export const dynamic = 'force-dynamic'
const log = LOG.tag('api:esp_pin_mappings')

// DELETE /api/esp_pin_mappings/:detailId/:branchId
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

  try {
    const { rowCount } = await pool.query(
      `DELETE FROM esp_pin_mappings
        WHERE kfb_info_detail_id = $1 AND branch_id = $2`,
      [detail, branch]
    )
    return NextResponse.json({ success: true, deleted: rowCount ?? 0 })
  } catch (err: any) {
    log.error(`DELETE /api/esp_pin_mappings/${detail}/${branch} error`, err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
