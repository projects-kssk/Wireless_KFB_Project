// src/app/api/configurations/route.ts
import { NextResponse } from 'next/server'
import { pool }         from '@/lib/postgresPool'

export const dynamic = 'force-dynamic'

/**
 * GET /api/configurations
 * Returns an array of:
 * {
 *   id: number
 *   kfb: string
 *   mac_address: string
 *   kfbInfo: string[]
 *   espPinMappings: Record<string, string>
 *   branchPins: { id: number; name: string }[]
 * }
 */
export async function GET() {
  const client = await pool.connect()
  try {
    // 1) fetch all configs
    const configsRes = await client.query<{
      id: number
      kfb: string
      mac_address: string
    }>(`
      SELECT id, kfb, mac_address
      FROM configurations
      ORDER BY id
    `)
    const configs: { id: number; kfb: string; mac_address: string }[] = configsRes.rows

    if (configs.length === 0) {
      return NextResponse.json([], { status: 200 })
    }

    // 2) fetch all kfb_info_details for these configs
    const configIds: number[] = configs.map((c: { id: number }) => c.id)
    const detailsRes = await client.query<{
      id: number
      config_id: number
      kfb_info_value: string
    }>(`
      SELECT id, config_id, kfb_info_value
      FROM kfb_info_details
      WHERE config_id = ANY($1)
    `, [configIds])
    const details: { id: number; config_id: number; kfb_info_value: string }[] = detailsRes.rows

    // 3) fetch all branch links for those detail IDs
    const detailIds: number[] = details.map((d: { id: number }) => d.id)
    const branchLinksRes = await client.query<{
      kfb_info_detail_id: number
      branch_id: number
      name: string
    }>(`
      SELECT cb.kfb_info_detail_id, b.id AS branch_id, b.name
      FROM config_branches cb
      JOIN branches b ON b.id = cb.branch_id
      WHERE cb.kfb_info_detail_id = ANY($1)
    `, [detailIds])
    const branchLinks: { kfb_info_detail_id: number; branch_id: number; name: string }[] = branchLinksRes.rows

    // 4) fetch all ESP-pin mappings for those detail IDs
    const pinLinksRes = await client.query<{
      kfb_info_detail_id: number
      pin_number: number
      branch_id: number
    }>(`
      SELECT kfb_info_detail_id, pin_number, branch_id
      FROM esp_pin_mappings
      WHERE kfb_info_detail_id = ANY($1)
    `, [detailIds])
    const pinLinks: { kfb_info_detail_id: number; pin_number: number; branch_id: number }[] = pinLinksRes.rows

    // 5) build lookup maps

    // Map: config_id -> array of its detail records
    const detailsByConfig = new Map<number, { id: number; config_id: number; kfb_info_value: string }[]>()
    details.forEach((d: { id: number; config_id: number; kfb_info_value: string }) => {
      const arr = detailsByConfig.get(d.config_id) ?? []
      arr.push(d)
      detailsByConfig.set(d.config_id, arr)
    })

    // Map: detail_id -> array of branch link objects
    type BranchLink = { branch_id: number; name: string }
    const branchesByDetail = new Map<number, BranchLink[]>()
    branchLinks.forEach((link: { kfb_info_detail_id: number; branch_id: number; name: string }) => {
      const arr = branchesByDetail.get(link.kfb_info_detail_id) ?? []
      arr.push({ branch_id: link.branch_id, name: link.name })
      branchesByDetail.set(link.kfb_info_detail_id, arr)
    })

    // Map: detail_id -> array of pin mapping objects
    type PinLink = { pin_number: number; branch_id: number }
    const pinsByDetail = new Map<number, PinLink[]>()
    pinLinks.forEach((p: { kfb_info_detail_id: number; pin_number: number; branch_id: number }) => {
      const arr = pinsByDetail.get(p.kfb_info_detail_id) ?? []
      arr.push({ pin_number: p.pin_number, branch_id: p.branch_id })
      pinsByDetail.set(p.kfb_info_detail_id, arr)
    })

    // 6) assemble final payload
    const result = configs.map((cfg: { id: number; kfb: string; mac_address: string }) => {
      const dets = detailsByConfig.get(cfg.id) ?? []

      // flatten kfbInfo: array of strings
      const kfbInfo: string[] = dets.map((d: { kfb_info_value: string }) => d.kfb_info_value)

      // flatten branchPins: unique per config
      const branchSet = new Map<number, string>()
      dets.forEach((d: { id: number }) => {
        const detailId = d.id
        const links = branchesByDetail.get(detailId) ?? []
        links.forEach((b: BranchLink) => {
          branchSet.set(b.branch_id, b.name)
        })
      })
      const branchPins: { id: number; name: string }[] = Array.from(branchSet.entries()).map(
        ([id, name]: [number, string]) => ({ id, name })
      )

      // flatten espPinMappings: last-wins strategy
      const espPinMappings: Record<string, string> = {}
      dets.forEach((d: { id: number }) => {
        const detailId = d.id
        const pinArr = pinsByDetail.get(detailId) ?? []
        pinArr.forEach((p: PinLink) => {
          const branchName = branchSet.get(p.branch_id)
          if (branchName) {
            espPinMappings[p.pin_number.toString()] = branchName
          }
        })
      })

      return {
        id:           cfg.id,
        kfb:          cfg.kfb,
        mac_address:  cfg.mac_address,
        kfbInfo,
        branchPins,
        espPinMappings,
      }
    })

    return NextResponse.json(result)
  } catch (err: any) {
    console.error('GET /api/configurations error', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  } finally {
    client.release()
  }
}

/**
 * POST /api/configurations
 * Body: {
 *   kfb: string
 *   mac_address: string
 *   kfbInfo: string[]
 *   branchPins: string[]          // array of branch-names
 *   espPinMappings: Record<string,string>
 * }
 */
export async function POST(request: Request) {
  let body: any
  try {
    body = await request.json()
  } catch (e) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const { kfb, mac_address, kfbInfo, branchPins, espPinMappings } = body

  // Basic validation
  if (
    typeof kfb !== 'string' ||
    typeof mac_address !== 'string' ||
    !Array.isArray(kfbInfo) ||
    !Array.isArray(branchPins) ||
    typeof espPinMappings !== 'object' ||
    espPinMappings === null
  ) {
    return NextResponse.json({ error: 'Invalid request body shape' }, { status: 400 })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // 1) insert into configurations
    const insertCfgRes = await client.query<{ id: number }>(
      `
      INSERT INTO configurations(kfb, mac_address)
      VALUES($1, $2)
      RETURNING id
      `,
      [kfb, mac_address]
    )
    if (insertCfgRes.rows.length === 0) {
      throw new Error('Failed to insert configuration')
    }
    const configId: number = insertCfgRes.rows[0].id

    // 2) insert kfb_info_details
    // Ensure we only take string entries
    const detailValues: string[] = kfbInfo.filter((val: any) => typeof val === 'string')
    const detailInserts: [number, string][] = detailValues.map((val: string) => [configId, val])

    let detailIds: number[] = []
    if (detailInserts.length > 0) {
      const configIdsArr = detailInserts.map(r => r[0])
      const infoValuesArr = detailInserts.map(r => r[1])
      const insertedDetailsRes = await client.query<{ id: number }>(
        `
        INSERT INTO kfb_info_details(config_id, kfb_info_value)
        SELECT x.config_id, x.kfb_info_value
        FROM UNNEST($1::int[], $2::text[]) AS x(config_id, kfb_info_value)
        RETURNING id
        `,
        [configIdsArr, infoValuesArr]
      )
      detailIds = insertedDetailsRes.rows.map((r: { id: number }) => r.id)
    }

    // 3) upsert branches & config_branches
    for (const detailId of detailIds) {
      for (const branchNameRaw of branchPins) {
        if (typeof branchNameRaw !== 'string') continue
        const branchName = branchNameRaw.trim()
        if (!branchName) continue

        // Upsert branch
        const branchUpsertRes = await client.query<{ id: number }>(
          `
          INSERT INTO branches(name)
          VALUES ($1)
          ON CONFLICT(name) DO UPDATE SET name = EXCLUDED.name
          RETURNING id
          `,
          [branchName]
        )
        if (branchUpsertRes.rows.length === 0) {
          continue
        }
        const branchId: number = branchUpsertRes.rows[0].id

        // Insert link
        await client.query(
          `
          INSERT INTO config_branches(config_id, kfb_info_detail_id, branch_id)
          VALUES($1, $2, $3)
          `,
          [configId, detailId, branchId]
        )
      }
    }

    // 4) insert esp_pin_mappings
    for (const detailId of detailIds) {
      // espPinMappings: Record<string, string>
      for (const [pinKey, branchNameRaw] of Object.entries(espPinMappings) as [string, any][]) {
        const pinNum = Number(pinKey)
        if (Number.isNaN(pinNum)) continue
        if (typeof branchNameRaw !== 'string') continue
        const branchName = branchNameRaw.trim()
        if (!branchName) continue

        // Find branch id
        const branchSelectRes = await client.query<{ id: number }>(
          `SELECT id FROM branches WHERE name = $1 LIMIT 1`,
          [branchName]
        )
        if (branchSelectRes.rows.length === 0) continue
        const branchId: number = branchSelectRes.rows[0].id

        // Insert mapping
        await client.query(
          `
          INSERT INTO esp_pin_mappings(kfb_info_detail_id, pin_number, branch_id)
          VALUES($1, $2, $3)
          `,
          [detailId, pinNum, branchId]
        )
      }
    }

    await client.query('COMMIT')
    return NextResponse.json({ success: true, id: configId }, { status: 201 })
  } catch (err: any) {
    await client.query('ROLLBACK')
    console.error('POST /api/configurations error', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  } finally {
    client.release()
  }
}
