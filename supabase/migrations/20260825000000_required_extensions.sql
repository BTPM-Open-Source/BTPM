-- BTPM OSS baseline: extension prerequisites.
-- Supabase normally provisions the extensions schema; keep the portable extensions idempotent.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- Existing BTPM scheduled notification/reporting functions also depend on the
-- Supabase-supported scheduler/network extensions. Installing the extensions does
-- not create any job, target URL, credential, or private deployment state.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
