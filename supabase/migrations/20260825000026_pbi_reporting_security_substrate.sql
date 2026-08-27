-- BTPM OSS baseline: portable Power BI reporting security substrate.
--
-- This file intentionally creates structure only. It creates no Tenant login
-- mappings, credentials, passwords, tenant-specific rows, or deployment data.
-- Tenant reporting identities are provisioned later through the controlled
-- public.service_manage_powerbi_reporting_identity(...) lifecycle contract.

CREATE SCHEMA IF NOT EXISTS pbi_reporting;
CREATE SCHEMA IF NOT EXISTS pbi_reporting_security;

REVOKE ALL ON SCHEMA pbi_reporting FROM PUBLIC;
REVOKE ALL ON SCHEMA pbi_reporting_security FROM PUBLIC;

DO $revoke_browser_schema_access$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON SCHEMA pbi_reporting FROM anon';
    EXECUTE 'REVOKE ALL ON SCHEMA pbi_reporting_security FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON SCHEMA pbi_reporting FROM authenticated';
    EXECUTE 'REVOKE ALL ON SCHEMA pbi_reporting_security FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'pbi_reader') THEN
    EXECUTE 'REVOKE ALL ON SCHEMA pbi_reporting FROM pbi_reader';
    EXECUTE 'REVOKE ALL ON SCHEMA pbi_reporting_security FROM pbi_reader';
  END IF;
END
$revoke_browser_schema_access$;

DO $reader_role$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'btpm_pbi_reader') THEN
    CREATE ROLE btpm_pbi_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT;
  ELSE
    -- Hosted Supabase can retain a correctly hardened role whose ownership does
    -- not permit ALTER ROLE from the project database user. Reuse only when its
    -- security attributes already match the BTPM contract; otherwise fail closed.
    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_roles
      WHERE rolname = 'btpm_pbi_reader'
        AND (
          rolsuper OR rolcreatedb OR rolcreaterole OR rolcanlogin
          OR rolreplication OR rolbypassrls OR NOT rolinherit
        )
    ) THEN
      RAISE EXCEPTION 'Existing btpm_pbi_reader role does not satisfy the required restricted role contract';
    END IF;
  END IF;
END
$reader_role$;

GRANT USAGE ON SCHEMA pbi_reporting TO btpm_pbi_reader;
GRANT USAGE ON SCHEMA pbi_reporting_security TO btpm_pbi_reader;

CREATE TABLE pbi_reporting_security.tenant_login_map (
  login_role_name text PRIMARY KEY
    CONSTRAINT tenant_login_map_role_name_pattern_chk
    CHECK (login_role_name ~ '^btpm_pbi_t_[a-f0-9]{32}$'),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  state text NOT NULL DEFAULT 'active'
    CONSTRAINT tenant_login_map_state_chk CHECK (state IN ('active','disabled','revoked')),
  provisioned_at timestamptz,
  last_rotated_at timestamptz,
  last_verified_at timestamptz,
  disabled_at timestamptz,
  revoked_at timestamptz,
  actor_identity text,
  actor_type text,
  operational_metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    CONSTRAINT tenant_login_map_metadata_object_chk CHECK (jsonb_typeof(operational_metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX tenant_login_map_one_active_per_tenant_uq
  ON pbi_reporting_security.tenant_login_map (tenant_id)
  WHERE state = 'active';

CREATE TRIGGER tenant_login_map_set_updated_at
  BEFORE UPDATE ON pbi_reporting_security.tenant_login_map
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE pbi_reporting_security.tenant_login_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE pbi_reporting_security.tenant_login_map FORCE ROW LEVEL SECURITY;

CREATE TABLE pbi_reporting_security.tenant_login_audit (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_at timestamptz NOT NULL DEFAULT now(),
  event_type text NOT NULL
    CONSTRAINT tenant_login_audit_event_type_chk
    CHECK (event_type IN ('provisioned','rotated','verified','disabled','revoked','probe','other')),
  login_role_name text
    CONSTRAINT tenant_login_audit_role_name_pattern_chk
    CHECK (login_role_name IS NULL OR login_role_name ~ '^btpm_pbi_t_[a-f0-9]{32}$'),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  actor_identity text,
  actor_type text,
  context jsonb NOT NULL DEFAULT '{}'::jsonb
    CONSTRAINT tenant_login_audit_context_object_chk CHECK (jsonb_typeof(context) = 'object'),
  CONSTRAINT tenant_login_audit_no_secret_keys_chk CHECK (
    NOT (context ?| ARRAY[
      'password','pwd','secret','token','access_token','refresh_token',
      'connection_string','conn_str','dsn','authorization','auth'
    ])
  )
);

CREATE INDEX tenant_login_audit_event_at_idx
  ON pbi_reporting_security.tenant_login_audit (event_at DESC);
CREATE INDEX tenant_login_audit_tenant_id_idx
  ON pbi_reporting_security.tenant_login_audit (tenant_id);

ALTER TABLE pbi_reporting_security.tenant_login_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE pbi_reporting_security.tenant_login_audit FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE pbi_reporting_security.tenant_login_map FROM PUBLIC;
REVOKE ALL ON TABLE pbi_reporting_security.tenant_login_audit FROM PUBLIC;
REVOKE ALL ON TABLE pbi_reporting_security.tenant_login_map FROM btpm_pbi_reader;
REVOKE ALL ON TABLE pbi_reporting_security.tenant_login_audit FROM btpm_pbi_reader;

DO $revoke_browser_table_access$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE pbi_reporting_security.tenant_login_map FROM anon';
    EXECUTE 'REVOKE ALL ON TABLE pbi_reporting_security.tenant_login_audit FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE pbi_reporting_security.tenant_login_map FROM authenticated';
    EXECUTE 'REVOKE ALL ON TABLE pbi_reporting_security.tenant_login_audit FROM authenticated';
  END IF;
END
$revoke_browser_table_access$;

CREATE OR REPLACE FUNCTION pbi_reporting_security.resolve_current_tenant()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pbi_reporting_security', 'pg_catalog'
AS $function$
DECLARE
  v_login text;
  v_tenant uuid;
BEGIN
  v_login := session_user;
  IF v_login IS NULL OR v_login !~ '^btpm_pbi_t_[a-f0-9]{32}$' THEN
    RETURN NULL;
  END IF;

  SELECT m.tenant_id
    INTO v_tenant
    FROM pbi_reporting_security.tenant_login_map m
    JOIN public.tenants t ON t.id = m.tenant_id
   WHERE m.login_role_name = v_login
     AND m.state = 'active'
     AND t.status = 'active';

  RETURN v_tenant;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION pbi_reporting_security.resolve_current_tenant() FROM PUBLIC;
DO $resolver_acl$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION pbi_reporting_security.resolve_current_tenant() FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION pbi_reporting_security.resolve_current_tenant() FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'pbi_reader') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION pbi_reporting_security.resolve_current_tenant() FROM pbi_reader';
  END IF;
END
$resolver_acl$;
GRANT EXECUTE ON FUNCTION pbi_reporting_security.resolve_current_tenant() TO btpm_pbi_reader;

-- No seed INSERTs belong in the clean baseline. An empty mapping/audit state is
-- the expected state of a newly installed open-source instance.
