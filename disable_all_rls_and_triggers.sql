-- disable_all_rls_and_triggers.sql

BEGIN;

-- 1) Disable RLS on each table
ALTER TABLE public.branches         DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.configurations   DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.config_branches  DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.esp_pin_mappings DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.kfb_info_details DISABLE ROW LEVEL SECURITY;

-- 2) Drop every policy on those tables dynamically
DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT
      policyname   AS policy_name,
      schemaname,
      tablename
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'branches',
        'configurations',
        'config_branches',
        'esp_pin_mappings',
        'kfb_info_details'
      )
  LOOP
    EXECUTE FORMAT(
      'DROP POLICY IF EXISTS %I ON %I.%I;',
      rec.policy_name,
      rec.schemaname,
      rec.tablename
    );
  END LOOP;
END
$$;

-- 3) Disable all triggers on each table
ALTER TABLE public.branches         DISABLE TRIGGER ALL;
ALTER TABLE public.configurations   DISABLE TRIGGER ALL;
ALTER TABLE public.config_branches  DISABLE TRIGGER ALL;
ALTER TABLE public.esp_pin_mappings DISABLE TRIGGER ALL;
ALTER TABLE public.kfb_info_details DISABLE TRIGGER ALL;

COMMIT;
