// src/app/api/serial/scanner/route.ts
import { NextResponse } from 'next/server'
import { getLastScanAndClear } from '@/lib/scannerMemory'
import { ensureScanner } from '@/lib/serial'

// --- Log scanned codes globally ---
const SCAN_LOG: string[] = []

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    // Ensure the scanner is initialized (singleton)
    ensureScanner()

    // Get last scanned code
    const code = getLastScanAndClear()

    // Log it if present
    if (code) {
      SCAN_LOG.push(code)
      // Also print to console
      console.log(`[SCANNER] Scanned code: ${code}`)
    }

    return NextResponse.json({ code })
  } catch (err) {
    // Log serial errors
    console.error('[SCANNER ERROR]', err)
    return NextResponse.json({ code: null, error: err?.message || String(err) }, { status: 500 })
  }
}
