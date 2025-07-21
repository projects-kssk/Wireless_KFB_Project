import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  let body: { normalPins?: number[]; latchPins?: number[]; mac: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { normalPins = [], latchPins = [], mac } = body
  if ((!Array.isArray(normalPins) && !Array.isArray(latchPins)) || typeof mac !== 'string') {
    return NextResponse.json({ error: 'Expected { normalPins?: number[], latchPins?: number[], mac: string }' }, { status: 400 })
  }

  let cmd = 'MONITOR'
  if (normalPins.length) cmd += ' ' + normalPins.join(',')
  if (latchPins.length) cmd += ' LATCH ' + latchPins.join(',')
  cmd += ' ' + mac

  // dynamic import as before
  let sendToEsp: (cmd: string) => Promise<void>
  try {
    const mod = await import('@/lib/serial')
    const helper = mod.default ?? mod
    if (typeof helper.sendToEsp !== 'function') throw new Error('sendToEsp missing')
    sendToEsp = helper.sendToEsp
  } catch (err: any) {
    console.error('load serial helper error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }

  try {
    await sendToEsp(cmd)
    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('POST /api/serial error:', err)
    return NextResponse.json({ error: err.message || 'Unknown' }, { status: 500 })
  }
}
