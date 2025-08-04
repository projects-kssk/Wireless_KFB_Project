// src/lib/data/pgRepo.ts
import { pool } from '../postgresPool'
import type { ConfigRepo } from './types'
import type { Configuration, ConfigurationFormData } from '@/types/types'

export const pgRepo: ConfigRepo = {
  async getAll(): Promise<Configuration[]> {
    const client = await pool.connect()
    try {
      // TODO: implement: run your SELECT with joins and map it to Configuration[]
      return []
    } finally {
      client.release()
    }
  },

  async getById(id: number): Promise<Configuration | null> {
    const client = await pool.connect()
    try {
      // TODO: implement lookup by id and map to Configuration
      return null
    } finally {
      client.release()
    }
  },

  async upsert(data: ConfigurationFormData): Promise<number> {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      // TODO: implement insert/update logic and RETURNING id
      await client.query('COMMIT')
      // fallback until you return the real id from SQL:
      return data.id ?? 0
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
    }
  },

  async delete(id: number): Promise<void> {
    await pool.query('DELETE FROM configurations WHERE id = $1', [id])
  },
}
