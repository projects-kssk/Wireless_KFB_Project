-- truncate_tables.sql

BEGIN;

TRUNCATE TABLE
  public.esp_pin_mappings,
  public.config_branches,
  public.kfb_info_details,
  public.branches,
  public.configurations
RESTART IDENTITY CASCADE;

COMMIT;
