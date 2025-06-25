// src/app/api/esp_pin_mappings/route.ts
import { NextResponse } from 'next/server'
import { pool } from '@/lib/postgresPool'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const detailS = url.searchParams.get('detailId')
  if (!detailS) {
    return NextResponse.json({ error: 'Missing ?detailId=…' }, { status: 400 })
  }
  const detailId = Number(detailS)
  if (Number.isNaN(detailId)) {
    return NextResponse.json({ error: 'detailId must be a number' }, { status: 400 })
  }
  const client = await pool.connect()
  try {
    const { rows } = await client.query<{
      branch_id: number
      pin_number: number
    }>(`
      SELECT branch_id, pin_number
      FROM esp_pin_mappings
      WHERE kfb_info_detail_id = $1
    `, [detailId])
    return NextResponse.json(rows)
  } catch (err: any) {
    console.error('GET /api/esp_pin_mappings error', err)
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
  const { config_id, kfb_info_detail_id, branch_id, pin_number } = body
  if (
    typeof config_id !== 'number' ||
    typeof kfb_info_detail_id !== 'number' ||
    typeof branch_id !== 'number' ||
    typeof pin_number !== 'number'
  ) {
    return NextResponse.json({ error: 'Invalid body shape' }, { status: 400 })
  }
  const client = await pool.connect()
  try {
    await client.query(`
      INSERT INTO esp_pin_mappings(config_id, kfb_info_detail_id, branch_id, pin_number)
      VALUES($1, $2, $3, $4)
    `, [config_id, kfb_info_detail_id, branch_id, pin_number])
    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('POST /api/esp_pin_mappings error', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  } finally {
    client.release()
  }
}

export async function DELETE(request: Request) {
  const url = new URL(request.url)
  const detailS = url.searchParams.get('detailId')
  const branchS = url.searchParams.get('branchId')
  const pinS = url.searchParams.get('pinNumber')
  if (!detailS || !branchS || !pinS) {
    return NextResponse.json({ error: 'Missing ?detailId=&branchId=&pinNumber=' }, { status: 400 })
  }
  const detailId = Number(detailS)
  const branchId = Number(branchS)
  const pinNum = Number(pinS)
  if (Number.isNaN(detailId) || Number.isNaN(branchId) || Number.isNaN(pinNum)) {
    return NextResponse.json({ error: 'detailId/branchId/pinNumber must be numbers' }, { status: 400 })
  }
  const client = await pool.connect()
  try {
    await client.query(`
      DELETE FROM esp_pin_mappings
      WHERE kfb_info_detail_id = $1
        AND branch_id = $2
        AND pin_number = $3
    `, [detailId, branchId, pinNum])
    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('DELETE /api/esp_pin_mappings error', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  } finally {
    client.release()
  }
}
