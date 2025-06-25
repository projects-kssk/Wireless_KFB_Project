// src/app/api/configurations/[id]/route.ts
import { NextResponse }     from 'next/server'
import type { ConfigurationFormData } from '@/types/types'
import { saveConfig, deleteConfig, getConfigById } from '@/lib/data'

export const dynamic = 'force-dynamic'

interface Params { params: { id: string } }

// GET a single config by ID
export async function GET(request: Request, { params }: Params) {
  const id = Number(params.id)
  if (Number.isNaN(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }
  try {
    const cfg = await getConfigById(id)
    return NextResponse.json(cfg)
  } catch (err: any) {
    console.error(`GET /api/configurations/${id} error:`, err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// PUT / replace or update the config
export async function PUT(request: Request, { params }: Params) {
  const id = Number(params.id)
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
  cfg.id = id

  try {
    await saveConfig(cfg)
    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error(`PUT /api/configurations/${id} error:`, err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// DELETE
export async function DELETE(request: Request, { params }: Params) {
  const id = Number(params.id)
  if (Number.isNaN(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }
  try {
    await deleteConfig(id)
    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error(`DELETE /api/configurations/${id} error:`, err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
