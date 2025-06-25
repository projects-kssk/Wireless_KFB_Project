// src/app/api/config_branches/route.ts
import { NextResponse } from 'next/server'
import { pool }         from '@/lib/postgresPool'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const url      = new URL(request.url)
  const cfgIdS   = url.searchParams.get('configId')
  const detailS  = url.searchParams.get('detailId')
  if (!cfgIdS || !detailS) {
    return NextResponse.json(
      { error: 'Missing ?configId=… & ?detailId=…' },
      { status: 400 }
    )
  }
  const configId = Number(cfgIdS)
  const detailId = Number(detailS)
  if (Number.isNaN(configId) || Number.isNaN(detailId)) {
    return NextResponse.json(
      { error: 'configId/detailId must be numbers' },
      { status: 400 }
    )
  }

  const client = await pool.connect()
  try {
    const { rows } = await client.query<{
      branch_id:  number
      not_tested: boolean
    }>(`
      SELECT branch_id, not_tested
      FROM config_branches
      WHERE config_id           = $1
        AND kfb_info_detail_id   = $2
    `, [configId, detailId])

    return NextResponse.json(rows)
  } catch (err: any) {
    console.error('GET /api/config_branches error', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  } finally {
    client.release()
  }
}

export async function POST(request: Request) {
  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const { config_id, kfb_info_detail_id, branch_id } = body
  if (
    typeof config_id !== 'number'      ||
    typeof kfb_info_detail_id !== 'number' ||
    typeof branch_id !== 'number'
  ) {
    return NextResponse.json({ error: 'Invalid body shape' }, { status: 400 })
  }

  const client = await pool.connect()
  try {
    await client.query(`
      INSERT INTO config_branches(config_id, kfb_info_detail_id, branch_id)
      VALUES($1, $2, $3)
    `, [config_id, kfb_info_detail_id, branch_id])
    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('POST /api/config_branches error', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  } finally {
    client.release()
  }
}

export async function DELETE(request: Request) {
  const url      = new URL(request.url)
  const detailS  = url.searchParams.get('detailId')
  const branchS  = url.searchParams.get('branchId')
  if (!detailS || !branchS) {
    return NextResponse.json(
      { error: 'Missing ?detailId=… & ?branchId=…' },
      { status: 400 }
    )
  }
  const detailId = Number(detailS)
  const branchId = Number(branchS)
  if (Number.isNaN(detailId) || Number.isNaN(branchId)) {
    return NextResponse.json(
      { error: 'detailId/branchId must be numbers' },
      { status: 400 }
    )
  }

  const client = await pool.connect()
  try {
    await client.query(`
      DELETE FROM config_branches
      WHERE kfb_info_detail_id = $1
        AND branch_id          = $2
    `, [detailId, branchId])
    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('DELETE /api/config_branches error', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  } finally {
    client.release()
  }
}
