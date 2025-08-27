import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(req: NextRequest) {
  const headers = new Headers(req.headers)
  if (!headers.get('x-req-id')) {
    const raw = (globalThis as any).crypto?.randomUUID?.() || Math.random().toString(36).slice(2)
    const rid = String(raw).replace(/-/g, '').slice(0, 8)
    headers.set('x-req-id', rid)
  }
  return NextResponse.next({ request: { headers } })
}

export const config = {
  matcher: ['/api/:path*'],
}

