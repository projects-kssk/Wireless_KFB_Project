// src/app/api/config_branches/[detailId]/[branchId]/route.ts
import { NextResponse } from 'next/server';
import { pool } from '@/lib/postgresPool';
import { z } from 'zod';
export const dynamic = 'force-dynamic';
const PatchSchema = z.object({
    not_tested: z.boolean().optional(),
    loose_contact: z.boolean().optional(),
});
export async function PATCH(request, { params }) {
    const { detailId: detailStr, branchId: branchStr } = await params;
    const detailId = Number(detailStr);
    const branchId = Number(branchStr);
    if (Number.isNaN(detailId) || Number.isNaN(branchId)) {
        return NextResponse.json({ error: 'Invalid detailId or branchId in URL' }, { status: 400 });
    }
    let body;
    try {
        const json = await request.json(); // unknown
        const parsed = PatchSchema.safeParse(json); // narrow
        if (!parsed.success) {
            return NextResponse.json({ error: 'At least one of `not_tested` or `loose_contact` (boolean) is required' }, { status: 400 });
        }
        body = parsed.data;
    }
    catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    const updates = [];
    const values = [];
    let idx = 1;
    if (typeof body.not_tested === 'boolean') {
        updates.push(`not_tested = $${idx++}`);
        values.push(body.not_tested);
    }
    if (typeof body.loose_contact === 'boolean') {
        updates.push(`loose_contact = $${idx++}`);
        values.push(body.loose_contact);
    }
    if (updates.length === 0) {
        return NextResponse.json({ error: 'At least one of `not_tested` or `loose_contact` (boolean) is required' }, { status: 400 });
    }
    values.push(detailId, branchId);
    const sql = `
    UPDATE config_branches
       SET ${updates.join(', ')}
     WHERE kfb_info_detail_id = $${idx++}
       AND branch_id          = $${idx}
  `;
    const client = await pool.connect();
    try {
        await client.query(sql, values);
        return NextResponse.json({ success: true });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        console.error('PATCH /api/config_branches error', err);
        return NextResponse.json({ error: message }, { status: 500 });
    }
    finally {
        client.release();
    }
}
//# sourceMappingURL=route.js.map