import { NextResponse } from 'next/server';
export function middleware(req) {
    const requestHeaders = new Headers(req.headers);
    const rid = requestHeaders.get('x-req-id') ??
        crypto.randomUUID().replace(/-/g, '').slice(0, 8);
    requestHeaders.set('x-req-id', rid);
    const res = NextResponse.next({ request: { headers: requestHeaders } });
    res.headers.set('x-req-id', rid); // echo for clients/logs
    return res;
}
export const config = { matcher: ['/api/:path*'] };
