// lib/db.ts

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Pool } from 'pg';

/**
 * Flip this flag to "true" to use Supabase HTTP API,
 * or "false" to use a direct Postgres Pool (over Unix socket or TCP).
 */
const useSupabase = process.env.USE_SUPABASE === 'true';

/** Supabase client instance (only when useSupabase===true) */
let supabase: SupabaseClient | undefined;

/** Postgres Pool instance (only when useSupabase===false) */
let pool: Pool | undefined;

if (useSupabase) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in environment'
    );
  }
  supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
} else {
  const { PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD } = process.env;
  if (!PGHOST || !PGPORT || !PGDATABASE || !PGUSER || !PGPASSWORD) {
    throw new Error(
      'Missing one of PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD in environment'
    );
  }
  pool = new Pool({
    host:     PGHOST,
    port:     Number(PGPORT),
    database: PGDATABASE,
    user:     PGUSER,
    password: PGPASSWORD,
  });
}

export { useSupabase, supabase, pool };
