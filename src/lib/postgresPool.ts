import { Pool } from 'pg';

const pool = new Pool({
  host:     process.env.PGHOST,
  port:     Number(process.env.PGPORT),
  database: process.env.PGDATABASE,
  user:     process.env.PGUSER,
  password: process.env.PGPASSWORD,
  ssl:      false,      // <— explicitly disable SSL
});

console.log('→ Postgres config:', {
  host: pool.options.host,
  port: pool.options.port,
  database: pool.options.database,
  user: pool.options.user,
  ssl: pool.options.ssl,
});

export { pool };
