// src/app/api/configurations/[id]/route.ts
import { NextResponse } from 'next/server';
import { saveConfig, deleteConfig, getConfigById } from '@/lib/data';
export const dynamic = 'force-dynamic';
// GET a single config by ID
export async function GET(request, { params }) {
    const { id: idStr } = await params;
    const id = Number(idStr);
    if (Number.isNaN(id)) {
        return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    try {
        const cfg = await getConfigById(id);
        return NextResponse.json(cfg);
    }
    catch (err) {
        console.error(`GET /api/configurations/${id} error:`, err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
// PUT / replace or update the config
export async function PUT(request, { params }) {
    const { id: idStr } = await params;
    const id = Number(idStr);
    if (Number.isNaN(id)) {
        return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    let body;
    try {
        body = await request.json();
    }
    catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    const cfg = body;
    cfg.id = id;
    try {
        await saveConfig(cfg);
        return NextResponse.json({ success: true });
    }
    catch (err) {
        console.error(`PUT /api/configurations/${id} error:`, err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
// DELETE
export async function DELETE(request, { params }) {
    const { id: idStr } = await params;
    const id = Number(idStr);
    if (Number.isNaN(id)) {
        return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    try {
        await deleteConfig(id);
        return NextResponse.json({ success: true });
    }
    catch (err) {
        console.error(`DELETE /api/configurations/${id} error:`, err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
//# sourceMappingURL=route.js.map