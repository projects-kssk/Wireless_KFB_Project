// src/lib/data/supabaseRepo.ts
import { supabase } from '../supabaseClient'
import type { ConfigRepo, BranchRepo } from './types'
import type {
  Configuration,
  ConfigurationFormData,
  BranchDisplayData
} from '@/types/types'

export const supabaseRepo: ConfigRepo & BranchRepo = {
  // ---- ConfigRepo ----
  async getAll() {
    const { data, error } = await supabase
      .from('configurations')
      .select(`
        id,
        kfb,
        mac_address,
        kfb_info_details ( kfb_info_value ),
        config_branches (
          branch:branches ( id, name ),
          esp_pin_mappings ( pin_number, branch:branches(name) )
        )
      `)

    if (error) throw error

    return (data || []).map((row: any): Configuration => {
      // 1) flatten the Branch[] list
      const branchPins = (row.config_branches || []).map((cb: any) => ({
        id:   cb.branch.id,
        name: cb.branch.name
      }))

      // 2) build the pin→branch map
      const espPinMappings: Record<string,string> = {}
      for (const cb of (row.config_branches || [])) {
        for (const m of (cb.esp_pin_mappings || [])) {
          // here `m.branch` is an object { name: string }
          espPinMappings[m.pin_number.toString()] = m.branch.name
        }
      }

      return {
        id:            row.id,
        kfb:           row.kfb,
        mac_address:   row.mac_address,
        kfbInfo:       (row.kfb_info_details || []).map((d: any) => d.kfb_info_value),
        branchPins,
        espPinMappings
      }
    })
  },

  async getById(id: number) {
    // …your existing single‐config fetch…
    return null
  },

  async upsert(cfg: ConfigurationFormData) {
    // …your existing upsert logic…
    return cfg.id!
  },

  async delete(id: number) {
    const { error } = await supabase
      .from('configurations')
      .delete()
      .eq('id', id)
    if (error) throw error
  },

  // ---- BranchRepo ----
  async getByKfb(kfb: string) {
    const { data, error } = await supabase
      .from('configurations')
      .select(`
        config_branches (
          branch:branches(id,name),
          esp_pin_mappings(pin_number,branch:branches(name)),
          kfb_info_detail:kfb_info_details(kfb_info_value)
        )
      `)
      .eq('kfb', kfb)

    if (error) throw error

    return (data! as any[]).flatMap(cfg =>
      cfg.config_branches.map((cb: any): BranchDisplayData => ({
        id:            cb.branch.id.toString(),
        branchName:    cb.branch.name,
        testStatus:    cb.esp_pin_mappings.length ? 'ok' : 'not_tested',
        pinNumber:     cb.esp_pin_mappings[0]?.pin_number,
        kfbInfoValue:  cb.kfb_info_detail?.kfb_info_value
      }))
    )
  }
}
