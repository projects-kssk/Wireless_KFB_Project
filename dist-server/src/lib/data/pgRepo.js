// src/lib/data/pgRepo.ts
import { pool } from '../postgresPool';
export const pgRepo = {
    async getAll() {
        const client = await pool.connect();
        try {
            // TODO: implement: run your SELECT with joins and map it to Configuration[]
            return [];
        }
        finally {
            client.release();
        }
    },
    async getById(id) {
        const client = await pool.connect();
        try {
            // TODO: implement lookup by id and map to Configuration
            return null;
        }
        finally {
            client.release();
        }
    },
    async upsert(data) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            // TODO: implement insert/update logic and RETURNING id
            await client.query('COMMIT');
            // fallback until you return the real id from SQL:
            return data.id ?? 0;
        }
        catch (e) {
            await client.query('ROLLBACK');
            throw e;
        }
        finally {
            client.release();
        }
    },
    async delete(id) {
        await pool.query('DELETE FROM configurations WHERE id = $1', [id]);
    },
};
//# sourceMappingURL=pgRepo.js.map