import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  // 1) parse body
  let body: { pins: number[]; mac: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const { pins, mac } = body
  if (!Array.isArray(pins) || typeof mac !== 'string') {
    return NextResponse.json(
      { error: 'Expected { pins: number[], mac: string }' },
      { status: 400 }
    )
  }

  // 2) import helper
  let sendAndReceive: (cmd: string) => Promise<string>
  try {
    const mod = await import('@/lib/serial')
    const helper = mod.default ?? mod
    if (typeof helper.sendAndReceive !== 'function') {
      throw new Error('sendAndReceive not found')
    }
    sendAndReceive = helper.sendAndReceive
  } catch (err: any) {
    console.error('Failed to load serial helper:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }

  // 3) build & send CHECK
  const cmd = `CHECK ${pins.join(',')} ${mac}`
  try {
    const raw = await sendAndReceive(cmd)
    console.log('raw ESP reply:', raw)

    // strip prefix up through the last ": "
    const text = raw.trim().replace(/^.*:\s*/, '').trim()
    console.log('parsed ESP reply:', text)

    // SUCCESS or OK → no failures
    if (text === 'SUCCESS' || text === 'OK') {
      return NextResponse.json({ failures: [] })
    }

    // FAILURES:1,2,3
    if (text.startsWith('FAILURES:')) {
      const rest = text.slice('FAILURES:'.length)
      const failures = rest
        .split(',')
        .map(n => parseInt(n, 10))
        .filter(n => !Number.isNaN(n))
      return NextResponse.json({ failures })
    }

    // FAILURE MISSING 1,2,3,19,20,,
    if (text.startsWith('FAILURE MISSING')) {
      const rest = text
        .slice('FAILURE MISSING'.length)
        .replace(/^[\s:]+/, '')
        .replace(/,+$/, '')
      const failures = rest
        .split(',')
        .map(n => parseInt(n, 10))
        .filter(n => !Number.isNaN(n))
      return NextResponse.json({ failures })
    }

    console.error('Unexpected ESP response:', text)
    return NextResponse.json(
      { error: `Unexpected ESP response: ${text}` },
      { status: 500 }
    )
  } catch (err: any) {
    console.error('POST /api/serial/check error:', err)
    return NextResponse.json({ error: err.message || 'Unknown' }, { status: 500 })
  }
}
