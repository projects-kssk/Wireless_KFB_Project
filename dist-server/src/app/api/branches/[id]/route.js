// src/app/api/branches/[id]/route.ts
import { NextResponse } from 'next/server';
import { pool } from '@/lib/postgresPool';
import { z } from 'zod';
export const dynamic = 'force-dynamic';
const BodySchema = z.object({ name: z.string().trim().min(1) });
export async function PATCH(request, { params }) {
    const { id } = await params;
    // Validate body
    let name;
    try {
        const json = await request.json();
        const parsed = BodySchema.safeParse(json);
        if (!parsed.success) {
            return NextResponse.json({ error: 'Branch name is required' }, { status: 400 });
        }
        name = parsed.data.name;
    }
    catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    try {
        const { rows } = await pool.query('UPDATE branches SET name = $1 WHERE id = $2 RETURNING id, name', [name, id]);
        if (rows.length === 0) {
            return NextResponse.json({ error: 'Branch not found' }, { status: 404 });
        }
        return NextResponse.json({ id: rows[0].id, branchName: rows[0].name }, { status: 200 });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        console.error('PATCH /api/branches/[id] error:', err);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
//# sourceMappingURL=route.js.map