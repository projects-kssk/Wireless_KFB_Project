// src/app/api/configurations/route.ts
import { NextResponse } from 'next/server'
import { pool }         from '@/lib/postgresPool'
import { LOG } from '@/lib/logger'
import { ridFrom } from '@/lib/rid'

export const dynamic = 'force-dynamic'
const log = LOG.tag('api:configurations')

/**
 * GET /api/configurations
 * - If `?kfb=...` is present → return single `{ id, kfb, mac_address }`
 * - Otherwise → return full list of configurations with kfbInfo, branchPins, espPinMappings
 */
export async function GET(request: Request) {
  const rid = ridFrom(request)
  const url = new URL(request.url)
  const kfb = url.searchParams.get('kfb')

  // 1) Single lookup by kfb name
  if (kfb) {
    try {
      const { rows } = await pool.query<{
        id:          number
        kfb:         string
        mac_address: string
      }>(
        `SELECT id, kfb, mac_address
           FROM configurations
          WHERE kfb = $1`,
        [kfb]
      )
      if (rows.length === 0) {
        const resp = NextResponse.json({ error: 'Not found' }, { status: 404 })
        resp.headers.set('X-Req-Id', rid)
        return resp
      }
      const resp = NextResponse.json(rows[0], { status: 200 })
      resp.headers.set('X-Req-Id', rid)
      return resp
    } catch (err: any) {
      log.error(`GET /api/configurations?kfb=${kfb} error`, { rid, error: err?.message || String(err) })
      const resp = NextResponse.json({ error: err.message }, { status: 500 })
      resp.headers.set('X-Req-Id', rid)
      return resp
    }
  }

  // 2) List-all mode
  const client = await pool.connect()
  try {
    // 2.1) load configs
    const configsRes = await client.query<{
      id:           number
      kfb:          string
      mac_address:  string
    }>(
      `SELECT id, kfb, mac_address
         FROM configurations
        ORDER BY id`
    )
    const configs = configsRes.rows
    if (configs.length === 0) {
      const resp = NextResponse.json([], { status: 200 })
      resp.headers.set('X-Req-Id', rid)
      return resp
    }

    // 2.2) load kfb_info_details
    const configIds = configs.map(c => c.id)
    const detailsRes = await client.query<{
      id:             number
      config_id:      number
      kfb_info_value: string
    }>(
      `SELECT id, config_id, kfb_info_value
         FROM kfb_info_details
        WHERE config_id = ANY($1)`,
      [configIds]
    )
    const details = detailsRes.rows

    // 2.3) load config_branches
    const detailIds = details.map(d => d.id)
    const branchLinksRes = await client.query<{
      kfb_info_detail_id: number
      branch_id:          number
      name:               string
    }>(
      `SELECT cb.kfb_info_detail_id,
              b.id       AS branch_id,
              b.name
         FROM config_branches cb
         JOIN branches b
           ON b.id = cb.branch_id
        WHERE cb.kfb_info_detail_id = ANY($1)`,
      [detailIds]
    )
    const branchLinks = branchLinksRes.rows

    // 2.4) load esp_pin_mappings
    const pinLinksRes = await client.query<{
      kfb_info_detail_id: number
      pin_number:         number
      branch_id:          number
    }>(
      `SELECT kfb_info_detail_id, pin_number, branch_id
         FROM esp_pin_mappings
        WHERE kfb_info_detail_id = ANY($1)`,
      [detailIds]
    )
    const pinLinks = pinLinksRes.rows

    // 2.5) build lookup maps
    const detailsByConfig = new Map<number, typeof details>()
    details.forEach(d => {
      const arr = detailsByConfig.get(d.config_id) ?? []
      arr.push(d)
      detailsByConfig.set(d.config_id, arr)
    })

    type BranchLink = { branch_id: number; name: string }
    const branchesByDetail = new Map<number, BranchLink[]>()
    branchLinks.forEach(link => {
      const arr = branchesByDetail.get(link.kfb_info_detail_id) ?? []
      arr.push({ branch_id: link.branch_id, name: link.name })
      branchesByDetail.set(link.kfb_info_detail_id, arr)
    })

    type PinLink = { pin_number: number; branch_id: number }
    const pinsByDetail = new Map<number, PinLink[]>()
    pinLinks.forEach(p => {
      const arr = pinsByDetail.get(p.kfb_info_detail_id) ?? []
      arr.push({ pin_number: p.pin_number, branch_id: p.branch_id })
      pinsByDetail.set(p.kfb_info_detail_id, arr)
    })

    // 2.6) assemble final array
    const result = configs.map(cfg => {
      const dets = detailsByConfig.get(cfg.id) ?? []

      // kfbInfo
      const kfbInfo = dets.map(d => d.kfb_info_value)

      // branchPins (unique)
      const branchSet = new Map<number, string>()
      dets.forEach(d => {
        (branchesByDetail.get(d.id) ?? []).forEach(b =>
          branchSet.set(b.branch_id, b.name)
        )
      })
      const branchPins = Array.from(branchSet.entries()).map(
        ([id, name]) => ({ id, name })
      )

      // espPinMappings (last-write wins)
      const espPinMappings: Record<string, string> = {}
      dets.forEach(d => {
        (pinsByDetail.get(d.id) ?? []).forEach(p => {
          const name = branchSet.get(p.branch_id)
          if (name) {
            espPinMappings[p.pin_number.toString()] = name
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

    const resp = NextResponse.json(result, { status: 200 })
    resp.headers.set('X-Req-Id', rid)
    return resp
  } catch (err: any) {
    log.error('GET /api/configurations error', { rid, error: err?.message || String(err) })
    const resp = NextResponse.json({ error: err.message }, { status: 500 })
    resp.headers.set('X-Req-Id', rid)
    return resp
  } finally {
    client.release()
  }
}

/**
 * POST /api/configurations
 * Body: {
 *   kfb: string,
 *   mac_address: string,
 *   kfbInfo: string[],
 *   branchPins: string[],
 *   espPinMappings: Record<string,string>
 * }
 */
export async function POST(request: Request) {
  const rid = ridFrom(request)
  let body: any
  try {
    body = await request.json()
  } catch {
    const resp = NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    resp.headers.set('X-Req-Id', rid)
    return resp
  }
  const { kfb, mac_address, kfbInfo, branchPins, espPinMappings } = body

  if (
    typeof kfb !== 'string' ||
    typeof mac_address !== 'string' ||
    !Array.isArray(kfbInfo) ||
    !Array.isArray(branchPins) ||
    typeof espPinMappings !== 'object' ||
    espPinMappings === null
  ) {
    return NextResponse.json({ error: 'Invalid request shape' }, { status: 400 })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // 1) configurations
    const insertCfg = await client.query<{ id: number }>(
      `INSERT INTO configurations(kfb, mac_address)
       VALUES($1, $2)
       RETURNING id`,
      [kfb, mac_address]
    )
    if (insertCfg.rows.length === 0) {
      throw new Error('Failed to insert configuration')
    }
    const configId = insertCfg.rows[0].id

    // 2) kfb_info_details
    const detailValues = kfbInfo.filter(v => typeof v === 'string')
    let detailIds: number[] = []
    if (detailValues.length) {
      const inserted = await client.query<{ id: number }>(
        `INSERT INTO kfb_info_details(config_id, kfb_info_value)
         SELECT x.config_id, x.kfb_info_value
         FROM UNNEST($1::int[], $2::text[]) AS x(config_id, kfb_info_value)
         RETURNING id`,
        [detailValues.map(() => configId), detailValues]
      )
      detailIds = inserted.rows.map(r => r.id)
    }

    // 3) branches + config_branches
    for (const detailId of detailIds) {
      for (const raw of branchPins) {
        if (typeof raw !== 'string') continue
        const name = raw.trim()
        if (!name) continue

        const upsert = await client.query<{ id: number }>(
          `INSERT INTO branches(name)
           VALUES($1)
           ON CONFLICT(name) DO UPDATE SET name=EXCLUDED.name
           RETURNING id`,
          [name]
        )
        const branchId = upsert.rows[0].id
        await client.query(
          `INSERT INTO config_branches(config_id, kfb_info_detail_id, branch_id)
           VALUES($1, $2, $3)`,
          [configId, detailId, branchId]
        )
      }
    }

    // 4) esp_pin_mappings
    for (const detailId of detailIds) {
      for (const [pinKey, raw] of Object.entries(espPinMappings)) {
        const pin = Number(pinKey)
        if (Number.isNaN(pin)) continue
        if (typeof raw !== 'string') continue
        const name = raw.trim()
        if (!name) continue

        const sel = await client.query<{ id: number }>(
          `SELECT id FROM branches WHERE name = $1 LIMIT 1`,
          [name]
        )
        if (sel.rows.length === 0) continue
        const branchId = sel.rows[0].id

        await client.query(
          `INSERT INTO esp_pin_mappings(kfb_info_detail_id, pin_number, branch_id)
           VALUES($1, $2, $3)`,
          [detailId, pin, branchId]
        )
      }
    }

    await client.query('COMMIT')
    const resp = NextResponse.json({ success: true, id: configId }, { status: 201 })
    resp.headers.set('X-Req-Id', rid)
    return resp
  } catch (err: any) {
    await client.query('ROLLBACK')
    log.error('POST /api/configurations error', { rid, error: err?.message || String(err) })
    const resp = NextResponse.json({ error: err.message }, { status: 500 })
    resp.headers.set('X-Req-Id', rid)
    return resp
  } finally {
    client.release()
  }
}
