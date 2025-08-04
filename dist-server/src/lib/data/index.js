import { USE_SUPABASE } from '@/lib/config';
import { supabaseRepo } from './supabaseRepo';
import { pgRepo } from './pgRepo';
const primary = USE_SUPABASE ? supabaseRepo : pgRepo;
const secondary = USE_SUPABASE ? pgRepo : supabaseRepo;
export function getAllConfigs() {
    return primary.getAll();
}
export function getConfigById(id) {
    return primary.getById(id);
}
export async function saveConfig(cfg) {
    const [primaryId] = await Promise.all([primary.upsert(cfg), secondary.upsert(cfg)]);
    return primaryId;
}
export async function deleteConfig(id) {
    await Promise.all([primary.delete(id), secondary.delete(id)]);
}
export function getBranchesByKfb(kfb) {
    return primary.getByKfb(kfb);
}
//# sourceMappingURL=index.js.map