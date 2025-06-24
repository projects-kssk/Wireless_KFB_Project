// src/app/api/configurations/[id]/route.ts
import { NextResponse } from 'next/server'
import { pool }         from '@/lib/postgresPool'

export const dynamic = 'force-dynamic'

interface Params { params: { id: string } }

/**
 * PUT /api/configurations/:id
 * Body shape is same as POST above.
 * Completely replaces all kfb_info_details, config_branches, esp_pin_mappings.
 */
export async function PUT(request: Request, { params }: Params) {
  const configId = Number(params.id)
  let body: any
  try {
    body = await request.json()
  } catch (e) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const { kfb, mac_address, kfbInfo, branchPins, espPinMappings } = body

  // Basic validation:
  if (typeof kfb !== 'string' || typeof mac_address !== 'string' ||
      !Array.isArray(kfbInfo) || !Array.isArray(branchPins) || typeof espPinMappings !== 'object'
  ) {
    return NextResponse.json({ error: 'Invalid request body shape' }, { status: 400 })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // 1) Update main configurations row
    await client.query(
      `
      UPDATE configurations
      SET kfb = $1, mac_address = $2
      WHERE id = $3
      `,
      [kfb, mac_address, configId]
    )

    // 2) Fetch existing kfb_info_details IDs for this config
    const existingRes = await client.query<{ id: number }>(
      `SELECT id FROM kfb_info_details WHERE config_id = $1`,
      [configId]
    )
    const existingRows: { id: number }[] = existingRes.rows
    const oldIds: number[] = existingRows.map((r: { id: number }) => r.id)

    // 3) Delete dependent rows if any oldIds exist
    if (oldIds.length > 0) {
      // Delete esp_pin_mappings linked to old detail IDs
      await client.query(
        `DELETE FROM esp_pin_mappings WHERE kfb_info_detail_id = ANY($1)`,
        [oldIds]
      )
      // Delete config_branches linked to old detail IDs
      await client.query(
        `DELETE FROM config_branches WHERE kfb_info_detail_id = ANY($1)`,
        [oldIds]
      )
      // Delete the kfb_info_details themselves
      await client.query(
        `DELETE FROM kfb_info_details WHERE id = ANY($1)`,
        [oldIds]
      )
    }

    // 4) Insert new kfb_info_details and collect their new IDs
    // Ensure we type detailInserts as [number, string][]
    const detailValues: string[] = kfbInfo.filter((val: any) => typeof val === 'string')
    const detailInserts: [number, string][] = detailValues.map((val: string) => [configId, val])

    let detailIds: number[] = []
    if (detailInserts.length > 0) {
      // We can bulk-insert using unnest, but for clarity we can also insert one by one.
      // Here: bulk insert via unnest arrays.
      const configIdsArr = detailInserts.map((r) => r[0])
      const infoValuesArr = detailInserts.map((r) => r[1])
      const insertDetailsRes = await client.query<{ id: number }>(
        `
        INSERT INTO kfb_info_details(config_id, kfb_info_value)
        SELECT x.config_id, x.kfb_info_value
        FROM UNNEST($1::int[], $2::text[]) AS x(config_id, kfb_info_value)
        RETURNING id
        `,
        [configIdsArr, infoValuesArr]
      )
      detailIds = insertDetailsRes.rows.map((r: { id: number }) => r.id)
    }

    // 5) Insert config_branches rows for each detailId × each branchName
    // branchPins is expected to be array of strings (branch names)
    for (const detailId of detailIds) {
      for (const branchNameRaw of branchPins) {
        if (typeof branchNameRaw !== 'string') continue
        const branchName = branchNameRaw.trim()
        if (!branchName) continue

        // Upsert branch: insert or get existing
        const branchUpsertRes = await client.query<{ id: number }>(
          `
          INSERT INTO branches(name)
          VALUES ($1)
          ON CONFLICT(name) DO UPDATE SET name = EXCLUDED.name
          RETURNING id
          `,
          [branchName]
        )
        // In Postgres ON CONFLICT ... DO UPDATE, RETURNING will always return a row
        if (branchUpsertRes.rows.length === 0) {
          // Should not happen normally, but skip if so
          continue
        }
        const branchId = branchUpsertRes.rows[0].id
        // Insert into config_branches
        await client.query(
          `
          INSERT INTO config_branches(config_id, kfb_info_detail_id, branch_id)
          VALUES ($1, $2, $3)
          `,
          [configId, detailId, branchId]
        )
      }
    }

    // 6) Insert esp_pin_mappings for each detailId × each [pin, branchName]
    // espPinMappings is expected: Record<string, string>
    for (const detailId of detailIds) {
      // Iterate entries; annotate entry types
      for (const [pinKey, branchNameRaw] of Object.entries(espPinMappings) as [string, any][]) {
        const pinNum = Number(pinKey)
        if (Number.isNaN(pinNum)) {
          continue
        }
        if (typeof branchNameRaw !== 'string') continue
        const branchName = branchNameRaw.trim()
        if (!branchName) continue

        // Find branch id by name
        const branchSelectRes = await client.query<{ id: number }>(
          `SELECT id FROM branches WHERE name = $1 LIMIT 1`,
          [branchName]
        )
        if (branchSelectRes.rows.length === 0) {
          // Branch not found; skip
          continue
        }
        const branchId = branchSelectRes.rows[0].id
        // Insert mapping
        await client.query(
          `
          INSERT INTO esp_pin_mappings(kfb_info_detail_id, pin_number, branch_id)
          VALUES ($1, $2, $3)
          `,
          [detailId, pinNum, branchId]
        )
      }
    }

    await client.query('COMMIT')
    return NextResponse.json({ success: true })
  } catch (err: any) {
    await client.query('ROLLBACK')
    console.error(`PUT /api/configurations/${configId} error`, err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  } finally {
    client.release()
  }
}

/**
 * DELETE /api/configurations/:id
 */
export async function DELETE(request: Request, { params }: Params) {
  const configId = Number(params.id)
  if (Number.isNaN(configId)) {
    return NextResponse.json({ error: 'Invalid id parameter' }, { status: 400 })
  }
  try {
    await pool.query(
      `DELETE FROM configurations WHERE id = $1`,
      [configId]
    )
    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error(`DELETE /api/configurations/${configId} error`, err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
