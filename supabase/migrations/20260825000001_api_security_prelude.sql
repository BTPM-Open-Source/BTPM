-- BTPM OSS baseline: trusted API security prelude.
--
-- The public schema contains restrictive OAuth-containment RLS policies that
-- reference api_e_private.jwt_client_id() and
-- api_e_private.assert_trusted_context(). Those helpers therefore have to
-- exist before the public schema is installed. Keep this schema inaccessible
-- to browser roles; callers reach it only through controlled public wrappers.

CREATE SCHEMA IF NOT EXISTS api_e_private;

REVOKE ALL ON SCHEMA api_e_private FROM PUBLIC;
REVOKE ALL ON SCHEMA api_e_private FROM anon;
REVOKE ALL ON SCHEMA api_e_private FROM authenticated;

CREATE OR REPLACE FUNCTION api_e_private.jwt_client_id()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  _raw text;
  _claims jsonb;
  _client_id text;
BEGIN
  _raw := current_setting('request.jwt.claims', true);
  IF _raw IS NULL OR length(_raw) = 0 THEN
    RETURN NULL;
  END IF;

  BEGIN
    _claims := _raw::jsonb;
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;

  IF _claims IS NULL OR jsonb_typeof(_claims) <> 'object' THEN
    RETURN NULL;
  END IF;

  IF (_claims ? 'client_id') IS NOT TRUE THEN
    RETURN NULL;
  END IF;
  IF jsonb_typeof(_claims->'client_id') <> 'string' THEN
    RETURN NULL;
  END IF;

  _client_id := _claims->>'client_id';
  IF _client_id IS NULL THEN
    RETURN NULL;
  END IF;
  IF length(_client_id) = 0 OR length(_client_id) > 255 THEN
    RETURN NULL;
  END IF;
  IF _client_id !~ '^[A-Za-z0-9._~:@/-]{1,255}$' THEN
    RETURN NULL;
  END IF;

  RETURN _client_id;
END;
$$;

REVOKE ALL ON FUNCTION api_e_private.jwt_client_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION api_e_private.jwt_client_id() FROM anon;
REVOKE ALL ON FUNCTION api_e_private.jwt_client_id() FROM authenticated;

CREATE OR REPLACE FUNCTION api_e_private.assert_trusted_context()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  _uid uuid := auth.uid();
  _trusted text;
  _ctx_auth_user text;
  _ctx_exec_user text;
  _ctx_signed_client text;
  _ctx_client text;
  _ctx_policy text;
  _ctx_tenant text;
  _ctx_org text;
  _ctx_api_version text;
  _ctx_kind text;
  _ctx_key text;
  _ctx_channel text;
  _ctx_request_id text;
  _signed_client_id text;
BEGIN
  IF _uid IS NULL THEN
    RETURN false;
  END IF;

  _trusted := current_setting('api_e.trusted', true);
  IF _trusted IS DISTINCT FROM 'true' THEN
    RETURN false;
  END IF;

  _ctx_auth_user     := current_setting('api_e.authenticated_user_id', true);
  _ctx_exec_user     := current_setting('api_e.executing_user_id', true);
  _ctx_signed_client := current_setting('api_e.signed_oauth_client_id', true);
  _ctx_client        := current_setting('api_e.api_client_id', true);
  _ctx_policy        := current_setting('api_e.policy_version_id', true);
  _ctx_tenant        := current_setting('api_e.tenant_id', true);
  _ctx_org           := current_setting('api_e.organization_id', true);
  _ctx_api_version   := current_setting('api_e.api_version', true);
  _ctx_kind          := current_setting('api_e.capability_kind', true);
  _ctx_key           := current_setting('api_e.capability_key', true);
  _ctx_channel       := current_setting('api_e.source_channel', true);
  _ctx_request_id    := current_setting('api_e.request_id', true);

  IF _ctx_auth_user IS NULL OR length(_ctx_auth_user) = 0
     OR _ctx_exec_user IS NULL OR length(_ctx_exec_user) = 0
     OR _ctx_signed_client IS NULL OR length(_ctx_signed_client) = 0
     OR _ctx_client IS NULL OR length(_ctx_client) = 0
     OR _ctx_policy IS NULL OR length(_ctx_policy) = 0
     OR _ctx_tenant IS NULL OR length(_ctx_tenant) = 0
     OR _ctx_org IS NULL OR length(_ctx_org) = 0
     OR _ctx_api_version IS NULL OR length(_ctx_api_version) = 0
     OR _ctx_kind IS NULL OR length(_ctx_kind) = 0
     OR _ctx_key IS NULL OR length(_ctx_key) = 0
     OR _ctx_channel IS NULL OR length(_ctx_channel) = 0
     OR _ctx_request_id IS NULL OR length(_ctx_request_id) = 0 THEN
    RETURN false;
  END IF;

  IF _ctx_auth_user <> _ctx_exec_user THEN
    RETURN false;
  END IF;

  IF _ctx_auth_user <> _uid::text THEN
    RETURN false;
  END IF;

  _signed_client_id := api_e_private.jwt_client_id();
  IF _signed_client_id IS NULL OR _signed_client_id <> _ctx_signed_client THEN
    RETURN false;
  END IF;

  IF _ctx_channel <> 'external_api' THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION api_e_private.assert_trusted_context() FROM PUBLIC;
REVOKE ALL ON FUNCTION api_e_private.assert_trusted_context() FROM anon;
REVOKE ALL ON FUNCTION api_e_private.assert_trusted_context() FROM authenticated;
