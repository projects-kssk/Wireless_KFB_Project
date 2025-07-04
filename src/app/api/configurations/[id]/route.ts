// src/app/api/configurations/[id]/route.ts

import { NextResponse } from 'next/server'
import { pool }         from '@/lib/postgresPool'
import type { ConfigurationFormData } from '@/types/types'

export const dynamic = 'force-dynamic'

// GET a single configuration by ID
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: idStr } = await params
  const id = Number(idStr)
  if (Number.isNaN(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  try {
    const { rows } = await pool.query<{
      id:           number
      kfb:          string
      mac_address:  string
    }>(
      `SELECT id, kfb, mac_address
         FROM configurations
        WHERE id = $1`,
      [id]
    )

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    // Just return the core record; your front-end already fetches the
    // kfb_info_details, branches, and esp_pin_mappings separately.
    const cfg = rows[0]
    return NextResponse.json(cfg, { status: 200 })
  } catch (err: any) {
    console.error(`GET /api/configurations/${id} error:`, err)
    return NextResponse.json(
      { error: err.message || 'Unknown error' },
      { status: 500 }
    )
  }
}


// PUT / update both KFB number _and_ MAC address
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: idStr } = await params
  const id = Number(idStr)
  if (Number.isNaN(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const cfg = body as ConfigurationFormData

  // Sanity check: ensure the path‐ID and payload‐ID match (or set it)
  cfg.id = id

  try {
    // 1) Update the main configurations row INCLUDING mac_address
    await pool.query(
      `
      UPDATE configurations
         SET kfb         = $1,
             mac_address = $2
       WHERE id = $3
      `,
      [cfg.kfb, cfg.mac_address, cfg.id]
    )

    // 2) (If you have existing logic to sync kfb_info_details,
    //     config_branches, esp_pin_mappings, call it here or re-implement
    //     the same way you did before.) For example:
    //
    //    await syncKfbInfoDetails(cfg.id, cfg.kfbInfo)
    //    await syncConfigBranches(cfg.id, cfg.branchPins)
    //    await syncEspPinMappings(cfg.id, cfg.espPinMappings)
    //

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (err: any) {
    console.error(`PUT /api/configurations/${id} error:`, err)
    return NextResponse.json(
      { error: err.message || 'Unknown error' },
      { status: 500 }
    )
  }
}


// DELETE a configuration (cascades in the DB if you’ve set ON DELETE CASCADE)
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: idStr } = await params
  const id = Number(idStr)
  if (Number.isNaN(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  try {
    await pool.query(`DELETE FROM configurations WHERE id = $1`, [id])
    return NextResponse.json({ success: true }, { status: 200 })
  } catch (err: any) {
    console.error(`DELETE /api/configurations/${id} error:`, err)
    return NextResponse.json(
      { error: err.message || 'Unknown error' },
      { status: 500 }
    )
  }
}
