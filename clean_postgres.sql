-- clean_postgres.sql

BEGIN;

-- 1) Disable RLS on all public tables
DO $$
DECLARE
  tbl record;
BEGIN
  FOR tbl IN
    SELECT tablename
      FROM pg_tables
     WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY;', tbl.tablename);
  END LOOP;
END
$$;

-- 2) Drop every policy on those tables
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname
      FROM pg_policies
     WHERE schemaname = 'public'
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I;',
      pol.policyname,
      pol.schemaname,
      pol.tablename
    );
  END LOOP;
END
$$;

-- 3) Disable ALL triggers on all public tables
DO $$
DECLARE
  tbl record;
BEGIN
  FOR tbl IN
    SELECT tablename
      FROM pg_tables
     WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER ALL;', tbl.tablename);
  END LOOP;
END
$$;

-- 4) Drop ALL event triggers (Supabase uses these for RLS enforcement)
DO $$
DECLARE
  evt record;
BEGIN
  FOR evt IN
    SELECT evtname
      FROM pg_event_trigger
  LOOP
    EXECUTE format('DROP EVENT TRIGGER %I;', evt.evtname);
  END LOOP;
END
$$;

COMMIT;
