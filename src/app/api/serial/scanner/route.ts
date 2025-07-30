// src/app/api/serial/scanner/route.ts
import { NextResponse } from 'next/server'
import { getLastScanAndClear } from '@/lib/scannerMemory'
import { ensureScanner } from '@/lib/serial'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  ensureScanner()
  const code = getLastScanAndClear()
  if (code) {
    return NextResponse.json({ code })
  } else {
    return NextResponse.json({ code: null })
  }
}
