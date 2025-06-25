// /src/lib/data/pgRepo.ts
import { pool } from '../postgresPool';
import { ConfigRepo } from './types';
import type { Configuration, ConfigurationFormData } from '@/types/types';

export const pgRepo: ConfigRepo = {
  async getAll() {
    const client = await pool.connect();
    try {
      // copy your /api/configurations GET logic here
      // run the SQL, build the maps, return the same shape
      // …
      return []; 
    } finally {
      client.release();
    }
  },

  async getById(id) { /* … */ return null },
  async upsert(data) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // your PUT or POST logic from route.ts goes here
      await client.query('COMMIT');
      return data.id!;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  },

  async delete(id) {
    await pool.query('DELETE FROM configurations WHERE id=$1', [id]);
  }
};
