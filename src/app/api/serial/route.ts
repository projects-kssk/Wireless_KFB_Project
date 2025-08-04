// src/app/api/serial/route.ts
import { NextResponse } from 'next/server'
import { z } from 'zod'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const Body = z.object({
  normalPins: z.array(z.number().int()).optional(),
  latchPins:  z.array(z.number().int()).optional(),
  mac:        z.string().min(1),
})

export async function POST(request: Request) {
  // parse & validate
  let payload: z.infer<typeof Body>
  try {
    const json = await request.json()
    const parsed = Body.safeParse(json)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Expected { normalPins?: number[], latchPins?: number[], mac: string }' },
        { status: 400 }
      )
    }
    payload = parsed.data
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { normalPins = [], latchPins = [], mac } = payload

  // build command
  let cmd = 'MONITOR'
  if (normalPins.length) cmd += ' ' + normalPins.join(',')
  if (latchPins.length)  cmd += ' LATCH ' + latchPins.join(',')
  cmd += ' ' + mac

  // dynamic import of serial helper
  let sendToEsp: (cmd: string) => Promise<void>
  try {
    const mod = await import('@/lib/serial')
    const helper = (mod as any).default ?? mod
    if (typeof helper.sendToEsp !== 'function') throw new Error('sendToEsp missing')
    sendToEsp = helper.sendToEsp as (cmd: string) => Promise<void>
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('load serial helper error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }

  try {
    await sendToEsp(cmd)
    return NextResponse.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown'
    console.error('POST /api/serial error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
