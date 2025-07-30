import { NextResponse } from 'next/server'
import { pool } from '@/lib/postgresPool'

export const dynamic = 'force-dynamic'

// context can be a promise, so always await it!
export async function PATCH(
  request: Request,
  context: { params: { id: string } } | Promise<{ params: { id: string } }>
) {
  const { params } = await Promise.resolve(context)
  const { id } = await params

  let name: string
  try {
    const body = await request.json()
    name = (typeof body.name === 'string' && body.name.trim()) || ''
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!name) {
    return NextResponse.json({ error: 'Branch name is required' }, { status: 400 })
  }

  try {
    const result = await pool.query(
      `UPDATE branches SET name = $1 WHERE id = $2 RETURNING id, name`,
      [name, id]
    )
    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Branch not found' }, { status: 404 })
    }
    return NextResponse.json({
      id: result.rows[0].id,
      branchName: result.rows[0].name,
    }, { status: 200 })
  } catch (err: any) {
    console.error('PATCH /api/branches/[id] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
