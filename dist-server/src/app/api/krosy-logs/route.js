// src/app/api/krosy-logs/route.ts
import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const LOG_DIR = process.env.KROSY_LOG_DIR || path.join(process.cwd(), ".krosy-logs");
async function listMonths(root) {
    try {
        const ents = await fs.readdir(root, { withFileTypes: true });
        return ents.filter(e => e.isDirectory()).map(e => e.name).sort((a, b) => b.localeCompare(a));
    }
    catch {
        return [];
    }
}
async function listRunDirs(monthDir) {
    try {
        const ents = await fs.readdir(monthDir, { withFileTypes: true });
        return ents.filter(e => e.isDirectory()).map(e => e.name).sort((a, b) => b.localeCompare(a));
    }
    catch {
        return [];
    }
}
async function readJsonSafe(p) {
    try {
        const t = await fs.readFile(p, "utf8");
        return JSON.parse(t);
    }
    catch {
        return null;
    }
}
async function fileExists(p) {
    try {
        const st = await fs.stat(p);
        return st.isFile();
    }
    catch {
        return false;
    }
}
export async function GET(req) {
    try {
        const url = new URL(req.url);
        const limit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit") || 50)));
        const monthParam = (url.searchParams.get("month") || "").trim();
        const ksk = (url.searchParams.get("ksk") || url.searchParams.get("kssk") || url.searchParams.get("intksk") || "").trim();
        const mac = (url.searchParams.get("mac") || "").toUpperCase();
        const sinceIso = (url.searchParams.get("since") || "").trim();
        const untilIso = (url.searchParams.get("until") || "").trim();
        const months = monthParam ? [monthParam] : await listMonths(LOG_DIR);
        const out = [];
        const sinceTs = sinceIso ? Date.parse(sinceIso) : null;
        const untilTs = untilIso ? Date.parse(untilIso) : null;
        outer: for (const month of months) {
            const mdir = path.join(LOG_DIR, month);
            const runs = await listRunDirs(mdir);
            for (const r of runs) {
                // r format: <stamp>_<INTKSK>_<requestID>
                const parts = r.split("_");
                const stamp = parts[0] || r;
                const intkskFromName = parts[1] && parts[1] !== "no-intksk" ? parts[1] : null;
                const reqIdFromName = parts[2] || undefined;
                // time filter by stamp if present (YYYY-MM-DD-HH-MM-SS[Z]) → reconstruct to ISO vaguely
                if (sinceTs || untilTs) {
                    const guessIso = stamp.replace(/^(\d{4}-\d{2}-\d{2})-(\d{2})-(\d{2})-(\d{2}).*/, "$1T$2:$3:$4Z");
                    const ts = Date.parse(guessIso);
                    if (Number.isFinite(ts)) {
                        if (sinceTs && ts < sinceTs)
                            continue;
                        if (untilTs && ts > untilTs)
                            continue;
                    }
                }
                if (ksk && intkskFromName && intkskFromName !== ksk)
                    continue;
                const base = path.join(mdir, r);
                const meta = await readJsonSafe(path.join(base, "meta.json"));
                const files = [];
                for (const name of [
                    "request.raw.xml", "request.pretty.xml", "response.raw.xml", "response.pretty.xml", "request.xml", "response.xml", "report.log",
                    "1_request.workingRequest.xml", "2_request.workingResult.xml", "2_response.checkpoint.xml",
                ]) {
                    if (await fileExists(path.join(base, name)))
                        files.push(name);
                }
                let usedUrl = null;
                let tcpUsed = null;
                let device = null;
                let ok = undefined;
                let status = undefined;
                let httpStatus = undefined;
                let durationMs = undefined;
                let intksk = intkskFromName;
                let mode = undefined;
                let error = null;
                if (meta && typeof meta === 'object') {
                    mode = String(meta.mode || meta.leg || meta.phase || "");
                    ok = typeof meta.ok === 'boolean' ? meta.ok : ok;
                    status = typeof meta.status === 'number' ? meta.status : status;
                    httpStatus = typeof meta.httpStatus === 'number' ? meta.httpStatus : httpStatus;
                    durationMs = typeof meta.durationMs === 'number' ? meta.durationMs : (typeof meta.duration_ms === 'number' ? meta.duration_ms : durationMs);
                    usedUrl = (meta.connect && meta.connect.used) || null;
                    tcpUsed = usedUrl && usedUrl.startsWith('tcp') ? usedUrl : null;
                    device = (meta.device ? String(meta.device) : null);
                    intksk = String(meta.intksk || intksk || '').trim() || null;
                    error = (typeof meta.error === 'string') ? meta.error : null;
                }
                const row = {
                    month,
                    dir: path.join(month, r),
                    stamp,
                    requestID: reqIdFromName,
                    intksk,
                    mode,
                    ok,
                    status,
                    httpStatus,
                    durationMs,
                    error,
                    device,
                    usedUrl,
                    tcpUsed,
                    files,
                };
                // Optional MAC filter: check request.pretty.xml content for MAC address
                if (mac) {
                    const reqPretty = path.join(base, "request.pretty.xml");
                    try {
                        const t = await fs.readFile(reqPretty, 'utf8');
                        if (!t || !t.toUpperCase().includes(mac))
                            continue;
                    }
                    catch {
                        continue;
                    }
                }
                out.push(row);
                if (out.length >= limit)
                    break outer;
            }
        }
        return NextResponse.json({
            root: LOG_DIR,
            count: out.length,
            items: out,
        });
    }
    catch (e) {
        return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
    }
}
export async function OPTIONS() { return NextResponse.json({}, { status: 204 }); }
