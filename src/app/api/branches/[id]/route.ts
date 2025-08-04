// src/app/api/branches/[id]/route.ts
import { NextResponse } from 'next/server'
import { pool } from '@/lib/postgresPool'

export const dynamic = 'force-dynamic'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  let name = ''
  try {
    const body = await request.json()
    if (typeof body?.name === 'string') name = body.name.trim()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!name) {
    return NextResponse.json({ error: 'Branch name is required' }, { status: 400 })
  }

  try {
    const { rows } = await pool.query(
      'UPDATE branches SET name = $1 WHERE id = $2 RETURNING id, name',
      [name, id]
    )
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Branch not found' }, { status: 404 })
    }
    return NextResponse.json(
      { id: rows[0].id, branchName: rows[0].name },
      { status: 200 }
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('PATCH /api/branches/[id] error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
