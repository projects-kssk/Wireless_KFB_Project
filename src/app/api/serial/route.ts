// src/app/api/serial/route.ts
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  let body: { pins: number[]; mac: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const { pins, mac } = body
  if (!Array.isArray(pins) || typeof mac !== 'string') {
    return NextResponse.json({ error: 'Expected { pins: number[], mac: string }' }, { status: 400 })
  }

  // dynamic import
  let sendToEsp: (cmd: string) => Promise<void>
  try {
    const mod = await import('@/lib/serial')
    const helper = mod.default ?? mod
    if (typeof helper.sendToEsp !== 'function') throw new Error('sendToEsp missing')
    sendToEsp = helper.sendToEsp
  } catch (err:any) {
    console.error('load serial helper error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }

  const cmd = `MONITOR ${pins.join(',')} ${mac}`
  try {
    await sendToEsp(cmd)
    return NextResponse.json({ success: true })
  } catch (err:any) {
    console.error('POST /api/serial error:', err)
    return NextResponse.json({ error: err.message || 'Unknown' }, { status: 500 })
  }
}
