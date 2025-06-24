-- drop_all_supabase_artifacts.sql

BEGIN;

-- 1) Drop Supabase's helper schemas (and everything in them)
DROP SCHEMA IF EXISTS auth            CASCADE;
DROP SCHEMA IF EXISTS storage         CASCADE;
DROP SCHEMA IF EXISTS graphql_schema  CASCADE;
DROP SCHEMA IF EXISTS extensions      CASCADE;
DROP SCHEMA IF EXISTS supabase_migrations CASCADE;
DROP SCHEMA IF EXISTS vault           CASCADE;

-- 2) Drop all event triggers (Supabase uses them for RLS/auth)
DO $$
DECLARE
  evt record;
BEGIN
  FOR evt IN SELECT evtname FROM pg_event_trigger LOOP
    EXECUTE FORMAT('DROP EVENT TRIGGER %I;', evt.evtname);
  END LOOP;
END
$$;

-- 3a) Disable RLS on every table in public
DO $$
DECLARE
  tbl record;
BEGIN
  FOR tbl IN
    SELECT tablename
      FROM pg_tables
     WHERE schemaname = 'public'
  LOOP
    EXECUTE FORMAT('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY;', tbl.tablename);
  END LOOP;
END
$$;

-- 3b) Drop every policy on every public table
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname
      FROM pg_policies
     WHERE schemaname = 'public'
  LOOP
    EXECUTE FORMAT(
      'DROP POLICY IF EXISTS %I ON %I.%I;',
      pol.policyname,
      pol.schemaname,
      pol.tablename
    );
  END LOOP;
END
$$;

-- 3c) Disable all table triggers on every public table
DO $$
DECLARE
  tbl record;
BEGIN
  FOR tbl IN
    SELECT tablename
      FROM pg_tables
     WHERE schemaname = 'public'
  LOOP
    EXECUTE FORMAT('ALTER TABLE public.%I DISABLE TRIGGER ALL;', tbl.tablename);
  END LOOP;
END
$$;

COMMIT;
