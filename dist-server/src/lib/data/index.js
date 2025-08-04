// src/lib/data/index.ts
import { USE_SUPABASE } from '@/lib/config';
import { supabaseRepo } from './supabaseRepo';
import { pgRepo } from './pgRepo';
// choose which backend is “primary” for reads and which is “secondary” for writes
const primary = USE_SUPABASE ? supabaseRepo : pgRepo;
const secondary = USE_SUPABASE ? pgRepo : supabaseRepo;
/**
 * Fetch *all* configurations.
 */
export function getAllConfigs() {
    return primary.getAll();
}
/**
 * Fetch a single configuration by ID.
 * Returns `null` if not found.
 */
export function getConfigById(id) {
    // Some repos may throw if not found; others return null
    return primary.getById(id);
}
/**
 * Create or update a configuration in *both* backends.
 * Returns the id of the saved configuration.
 */
export async function saveConfig(cfg) {
    // fan-out writes to both primary and secondary
    const [primaryId] = await Promise.all([
        primary.upsert(cfg),
        secondary.upsert(cfg),
    ]);
    return primaryId;
}
/**
 * Delete a configuration by ID in *both* backends.
 */
export async function deleteConfig(id) {
    await Promise.all([
        primary.delete(id),
        secondary.delete(id),
    ]);
}
/**
 * Given a KFB string, return its list of branches (with pin mappings etc).
 * Reads only from the “primary” branch repo.
 */
export function getBranchesByKfb(kfb) {
    return primary.getByKfb(kfb);
}
//# sourceMappingURL=index.js.map