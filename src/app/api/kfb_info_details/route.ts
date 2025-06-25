// src/app/api/kfb_info_details/route.ts
import { NextResponse } from 'next/server'
import { pool } from '@/lib/postgresPool'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const configIdS = url.searchParams.get('configId')
  if (!configIdS) {
    return NextResponse.json({ error: 'Missing ?configId=…' }, { status: 400 })
  }
  const configId = Number(configIdS)
  if (Number.isNaN(configId)) {
    return NextResponse.json({ error: 'configId must be a number' }, { status: 400 })
  }

  const client = await pool.connect()
  try {
    const { rows } = await client.query<{
      id: number
      kfb_info_value: string
    }>(`
      SELECT id, kfb_info_value
      FROM kfb_info_details
      WHERE config_id = $1
      ORDER BY id
    `, [configId])
    return NextResponse.json(rows)
  } catch (err: any) {
    console.error('GET /api/kfb_info_details error', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  } finally {
    client.release()
  }
}

// Optionally, you can add POST to create a new info detail under a config:
// POST body: { config_id: number, kfb_info_value: string }
export async function POST(request: Request) {
  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const { config_id, kfb_info_value } = body
  if (typeof config_id !== 'number' || typeof kfb_info_value !== 'string') {
    return NextResponse.json({ error: 'Invalid body shape' }, { status: 400 })
  }
  const client = await pool.connect()
  try {
    const insertRes = await client.query<{ id: number }>(
      `
      INSERT INTO kfb_info_details(config_id, kfb_info_value)
      VALUES($1, $2)
      RETURNING id
      `,
      [config_id, kfb_info_value.trim()]
    )
    if (insertRes.rows.length === 0) {
      throw new Error('Failed to insert kfb_info_detail')
    }
    return NextResponse.json({ success: true, id: insertRes.rows[0].id }, { status: 201 })
  } catch (err: any) {
    console.error('POST /api/kfb_info_details error', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  } finally {
    client.release()
  }
}
