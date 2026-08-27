-- BTPM OSS baseline: portable private API runtime helpers.
--
-- Install after 01_api_security_prelude.sql and the sanitized current public
-- schema. This file contains only current-state private runtime helpers; it has
-- no tenant/customer seed data, no historical backfills and no environment IDs.

-- ---------------------------------------------------------------------------
-- Canonical delegated API authorization context.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api_e_private.authorize_and_establish(
  _expected_oauth_client_id text,
  _organization_id uuid,
  _workspace_id uuid,
  _api_version text,
  _capability_kind text,
  _capability_key text,
  _request_id text
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  _uid uuid;
  _signed_client_id text;
  _client public.api_clients%ROWTYPE;
  _active_policy_count integer;
  _policy public.api_client_policy_versions%ROWTYPE;
  _ack_ok boolean;
  _tenant_id uuid;
  _org_enabled boolean;
  _ws_enabled boolean;
  _grant_ok boolean;
BEGIN
  PERFORM set_config('api_e.trusted', 'false', true);
  PERFORM set_config('api_e.authenticated_user_id', '', true);
  PERFORM set_config('api_e.executing_user_id', '', true);
  PERFORM set_config('api_e.signed_oauth_client_id', '', true);
  PERFORM set_config('api_e.api_client_id', '', true);
  PERFORM set_config('api_e.policy_version_id', '', true);
  PERFORM set_config('api_e.tenant_id', '', true);
  PERFORM set_config('api_e.organization_id', '', true);
  PERFORM set_config('api_e.workspace_id', '', true);
  PERFORM set_config('api_e.api_version', '', true);
  PERFORM set_config('api_e.capability_kind', '', true);
  PERFORM set_config('api_e.capability_key', '', true);
  PERFORM set_config('api_e.source_channel', '', true);
  PERFORM set_config('api_e.request_id', '', true);

  _uid := auth.uid();

  IF _expected_oauth_client_id IS NULL
     OR length(_expected_oauth_client_id) = 0
     OR length(_expected_oauth_client_id) > 255 THEN RETURN false; END IF;
  IF _organization_id IS NULL THEN RETURN false; END IF;
  IF _api_version IS NULL OR _api_version !~ '^v[1-9][0-9]*$' THEN RETURN false; END IF;
  IF _capability_kind IS NULL OR _capability_kind NOT IN ('read','command') THEN RETURN false; END IF;
  IF _capability_key IS NULL
     OR _capability_key <> lower(_capability_key)
     OR _capability_key !~ '^[a-z][a-z0-9._:-]*$'
     OR _capability_key IN ('crud','generic_crud','rpc','generic_rpc','table_access','postgrest','service_role','*')
  THEN RETURN false; END IF;
  IF _request_id IS NULL OR length(_request_id) = 0 OR length(_request_id) > 128 THEN RETURN false; END IF;

  IF _uid IS NULL THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = _uid AND p.is_active = true) THEN RETURN false; END IF;

  _signed_client_id := api_e_private.jwt_client_id();
  IF _signed_client_id IS NULL OR _signed_client_id <> _expected_oauth_client_id THEN RETURN false; END IF;

  SELECT * INTO _client
  FROM public.api_clients
  WHERE oauth_client_id = _signed_client_id AND lifecycle_status = 'active'
  LIMIT 1;
  IF _client.id IS NULL THEN RETURN false; END IF;
  IF (SELECT count(*) FROM public.api_clients WHERE oauth_client_id = _signed_client_id AND lifecycle_status = 'active') <> 1 THEN RETURN false; END IF;

  SELECT count(*) INTO _active_policy_count
  FROM public.api_client_policy_versions
  WHERE api_client_id = _client.id AND lifecycle_status = 'active';
  IF _active_policy_count <> 1 THEN RETURN false; END IF;
  SELECT * INTO _policy
  FROM public.api_client_policy_versions
  WHERE api_client_id = _client.id AND lifecycle_status = 'active'
  LIMIT 1;

  SELECT EXISTS (
    SELECT 1 FROM public.api_user_policy_acknowledgements
    WHERE user_id = _uid AND api_client_id = _client.id
      AND policy_version_id = _policy.id AND revoked_at IS NULL
  ) INTO _ack_ok;
  IF NOT _ack_ok THEN RETURN false; END IF;

  SELECT t.id INTO _tenant_id
  FROM public.organizations o
  JOIN public.tenants t ON t.id = o.tenant_id
  WHERE o.id = _organization_id
    AND t.status = 'active'
    AND t.suspended_at IS NULL
    AND t.archived_at IS NULL
    AND t.purged_at IS NULL
  LIMIT 1;
  IF _tenant_id IS NULL THEN RETURN false; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_memberships tm
    WHERE tm.tenant_id = _tenant_id AND tm.user_id = _uid
      AND tm.status = 'active' AND tm.deactivated_at IS NULL
  ) THEN RETURN false; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.organization_memberships om
    WHERE om.organization_id = _organization_id AND om.tenant_id = _tenant_id
      AND om.user_id = _uid AND om.status = 'active' AND om.deactivated_at IS NULL
  ) THEN RETURN false; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.api_organization_client_enablements oe
    WHERE oe.api_client_id = _client.id
      AND oe.organization_id = _organization_id
      AND oe.tenant_id = _tenant_id
      AND oe.lifecycle_status = 'enabled'
  ) INTO _org_enabled;
  IF NOT _org_enabled THEN RETURN false; END IF;

  IF _workspace_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.workspaces w
      WHERE w.id = _workspace_id AND w.organization_id = _organization_id
        AND w.is_active = true AND w.is_archived = false
    ) THEN RETURN false; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.workspace_id = _workspace_id AND wm.user_id = _uid
    ) THEN RETURN false; END IF;
    SELECT EXISTS (
      SELECT 1 FROM public.api_workspace_client_enablements we
      WHERE we.api_client_id = _client.id
        AND we.workspace_id = _workspace_id
        AND we.organization_id = _organization_id
        AND we.tenant_id = _tenant_id
        AND we.lifecycle_status = 'enabled'
    ) INTO _ws_enabled;
    IF NOT _ws_enabled THEN RETURN false; END IF;
  END IF;

  IF _workspace_id IS NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.api_capability_grants g
      WHERE g.api_client_id = _client.id
        AND g.organization_id = _organization_id
        AND g.tenant_id = _tenant_id
        AND g.workspace_id IS NULL
        AND g.api_version = _api_version
        AND g.capability_kind = _capability_kind
        AND g.capability_key = _capability_key
        AND g.lifecycle_status = 'enabled'
    ) INTO _grant_ok;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM public.api_capability_grants g
      WHERE g.api_client_id = _client.id
        AND g.organization_id = _organization_id
        AND g.tenant_id = _tenant_id
        AND g.api_version = _api_version
        AND g.capability_kind = _capability_kind
        AND g.capability_key = _capability_key
        AND g.lifecycle_status = 'enabled'
        AND (g.workspace_id = _workspace_id OR g.workspace_id IS NULL)
    ) INTO _grant_ok;
  END IF;
  IF NOT _grant_ok THEN RETURN false; END IF;

  PERFORM set_config('api_e.authenticated_user_id', _uid::text, true);
  PERFORM set_config('api_e.executing_user_id', _uid::text, true);
  PERFORM set_config('api_e.signed_oauth_client_id', _signed_client_id, true);
  PERFORM set_config('api_e.api_client_id', _client.id::text, true);
  PERFORM set_config('api_e.policy_version_id', _policy.id::text, true);
  PERFORM set_config('api_e.tenant_id', _tenant_id::text, true);
  PERFORM set_config('api_e.organization_id', _organization_id::text, true);
  PERFORM set_config('api_e.workspace_id', COALESCE(_workspace_id::text, ''), true);
  PERFORM set_config('api_e.api_version', _api_version, true);
  PERFORM set_config('api_e.capability_kind', _capability_kind, true);
  PERFORM set_config('api_e.capability_key', _capability_key, true);
  PERFORM set_config('api_e.source_channel', 'external_api', true);
  PERFORM set_config('api_e.request_id', _request_id, true);
  PERFORM set_config('api_e.trusted', 'true', true);
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('api_e.trusted', 'false', true);
  PERFORM set_config('api_e.authenticated_user_id', '', true);
  PERFORM set_config('api_e.executing_user_id', '', true);
  PERFORM set_config('api_e.signed_oauth_client_id', '', true);
  PERFORM set_config('api_e.api_client_id', '', true);
  PERFORM set_config('api_e.policy_version_id', '', true);
  PERFORM set_config('api_e.tenant_id', '', true);
  PERFORM set_config('api_e.organization_id', '', true);
  PERFORM set_config('api_e.workspace_id', '', true);
  PERFORM set_config('api_e.api_version', '', true);
  PERFORM set_config('api_e.capability_kind', '', true);
  PERFORM set_config('api_e.capability_key', '', true);
  PERFORM set_config('api_e.source_channel', '', true);
  PERFORM set_config('api_e.request_id', '', true);
  RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION api_e_private.authorize_and_establish(text,uuid,uuid,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION api_e_private.authorize_and_establish(text,uuid,uuid,text,text,text,text) FROM anon;
REVOKE ALL ON FUNCTION api_e_private.authorize_and_establish(text,uuid,uuid,text,text,text,text) FROM authenticated;

CREATE OR REPLACE FUNCTION api_e_private.authorize_and_establish_mcp(
  _expected_oauth_client_id text,
  _organization_id uuid,
  _workspace_id uuid,
  _api_version text,
  _capability_kind text,
  _capability_key text,
  _request_id text
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE _established boolean;
BEGIN
  _established := api_e_private.authorize_and_establish(
    _expected_oauth_client_id,_organization_id,_workspace_id,_api_version,
    _capability_kind,_capability_key,_request_id
  );
  IF _established IS DISTINCT FROM true THEN RETURN false; END IF;
  IF current_setting('api_e.trusted', true) IS DISTINCT FROM 'true'
     OR current_setting('api_e.source_channel', true) IS DISTINCT FROM 'external_api'
     OR COALESCE(current_setting('api_e.authenticated_user_id', true), '') = ''
     OR COALESCE(current_setting('api_e.executing_user_id', true), '') = ''
     OR current_setting('api_e.authenticated_user_id', true) <> current_setting('api_e.executing_user_id', true)
     OR COALESCE(current_setting('api_e.signed_oauth_client_id', true), '') = ''
     OR COALESCE(current_setting('api_e.api_client_id', true), '') = ''
     OR COALESCE(current_setting('api_e.policy_version_id', true), '') = ''
     OR current_setting('api_e.api_version', true) IS DISTINCT FROM _api_version
     OR current_setting('api_e.capability_kind', true) IS DISTINCT FROM _capability_kind
     OR current_setting('api_e.capability_key', true) IS DISTINCT FROM _capability_key
     OR current_setting('api_e.request_id', true) IS DISTINCT FROM _request_id
  THEN
    PERFORM set_config('api_e.trusted','false',true);
    PERFORM set_config('api_e.authenticated_user_id','',true);
    PERFORM set_config('api_e.executing_user_id','',true);
    PERFORM set_config('api_e.signed_oauth_client_id','',true);
    PERFORM set_config('api_e.api_client_id','',true);
    PERFORM set_config('api_e.policy_version_id','',true);
    PERFORM set_config('api_e.tenant_id','',true);
    PERFORM set_config('api_e.organization_id','',true);
    PERFORM set_config('api_e.workspace_id','',true);
    PERFORM set_config('api_e.api_version','',true);
    PERFORM set_config('api_e.capability_kind','',true);
    PERFORM set_config('api_e.capability_key','',true);
    PERFORM set_config('api_e.source_channel','',true);
    PERFORM set_config('api_e.request_id','',true);
    RETURN false;
  END IF;
  PERFORM set_config('api_e.source_channel','mcp',true);
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('api_e.trusted','false',true);
  PERFORM set_config('api_e.authenticated_user_id','',true);
  PERFORM set_config('api_e.executing_user_id','',true);
  PERFORM set_config('api_e.signed_oauth_client_id','',true);
  PERFORM set_config('api_e.api_client_id','',true);
  PERFORM set_config('api_e.policy_version_id','',true);
  PERFORM set_config('api_e.tenant_id','',true);
  PERFORM set_config('api_e.organization_id','',true);
  PERFORM set_config('api_e.workspace_id','',true);
  PERFORM set_config('api_e.api_version','',true);
  PERFORM set_config('api_e.capability_kind','',true);
  PERFORM set_config('api_e.capability_key','',true);
  PERFORM set_config('api_e.source_channel','',true);
  PERFORM set_config('api_e.request_id','',true);
  RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION api_e_private.authorize_and_establish_mcp(text,uuid,uuid,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION api_e_private.authorize_and_establish_mcp(text,uuid,uuid,text,text,text,text) FROM anon;
REVOKE ALL ON FUNCTION api_e_private.authorize_and_establish_mcp(text,uuid,uuid,text,text,text,text) FROM authenticated;

-- ---------------------------------------------------------------------------
-- Project-scoped delegated authorization. Project-scoped capabilities require
-- an exact enabled Workspace capability grant and explicit Project enablement.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api_e_private.authorize_and_establish_project_scope(
  _expected_oauth_client_id text,
  _organization_id uuid,
  _workspace_id uuid,
  _project_id uuid,
  _api_version text,
  _capability_kind text,
  _capability_key text,
  _request_id text
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  _uid uuid; _signed_client_id text; _client public.api_clients%ROWTYPE;
  _active_policy_count integer; _policy public.api_client_policy_versions%ROWTYPE;
  _ack_ok boolean; _tenant_id uuid;
BEGIN
  PERFORM set_config('api_e.trusted','false',true);
  PERFORM set_config('api_e.authenticated_user_id','',true);
  PERFORM set_config('api_e.executing_user_id','',true);
  PERFORM set_config('api_e.signed_oauth_client_id','',true);
  PERFORM set_config('api_e.api_client_id','',true);
  PERFORM set_config('api_e.policy_version_id','',true);
  PERFORM set_config('api_e.tenant_id','',true);
  PERFORM set_config('api_e.organization_id','',true);
  PERFORM set_config('api_e.workspace_id','',true);
  PERFORM set_config('api_e.api_version','',true);
  PERFORM set_config('api_e.capability_kind','',true);
  PERFORM set_config('api_e.capability_key','',true);
  PERFORM set_config('api_e.source_channel','',true);
  PERFORM set_config('api_e.request_id','',true);

  _uid := auth.uid();
  IF _expected_oauth_client_id IS NULL OR length(_expected_oauth_client_id)=0 OR length(_expected_oauth_client_id)>255 THEN RETURN false; END IF;
  IF _organization_id IS NULL OR _workspace_id IS NULL OR _project_id IS NULL OR _project_id='00000000-0000-0000-0000-000000000000'::uuid THEN RETURN false; END IF;
  IF _api_version IS NULL OR _api_version !~ '^v[1-9][0-9]*$' THEN RETURN false; END IF;
  IF _capability_kind IS NULL OR _capability_kind NOT IN ('read','command') THEN RETURN false; END IF;
  IF _capability_key IS NULL OR _capability_key<>lower(_capability_key) OR _capability_key !~ '^[a-z][a-z0-9._:-]*$'
     OR _capability_key IN ('crud','generic_crud','rpc','generic_rpc','table_access','postgrest','service_role','*') THEN RETURN false; END IF;
  IF _request_id IS NULL OR length(_request_id)=0 OR length(_request_id)>128 THEN RETURN false; END IF;
  IF _uid IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=_uid AND p.is_active=true) THEN RETURN false; END IF;

  _signed_client_id := api_e_private.jwt_client_id();
  IF _signed_client_id IS NULL OR _signed_client_id<>_expected_oauth_client_id THEN RETURN false; END IF;
  SELECT * INTO _client FROM public.api_clients WHERE oauth_client_id=_signed_client_id AND lifecycle_status='active' LIMIT 1;
  IF _client.id IS NULL OR (SELECT count(*) FROM public.api_clients WHERE oauth_client_id=_signed_client_id AND lifecycle_status='active')<>1 THEN RETURN false; END IF;
  SELECT count(*) INTO _active_policy_count FROM public.api_client_policy_versions WHERE api_client_id=_client.id AND lifecycle_status='active';
  IF _active_policy_count<>1 THEN RETURN false; END IF;
  SELECT * INTO _policy FROM public.api_client_policy_versions WHERE api_client_id=_client.id AND lifecycle_status='active' LIMIT 1;
  SELECT EXISTS (SELECT 1 FROM public.api_user_policy_acknowledgements WHERE user_id=_uid AND api_client_id=_client.id AND policy_version_id=_policy.id AND revoked_at IS NULL) INTO _ack_ok;
  IF NOT _ack_ok THEN RETURN false; END IF;

  SELECT t.id INTO _tenant_id FROM public.organizations o JOIN public.tenants t ON t.id=o.tenant_id
   WHERE o.id=_organization_id AND t.status='active' AND t.suspended_at IS NULL AND t.archived_at IS NULL AND t.purged_at IS NULL LIMIT 1;
  IF _tenant_id IS NULL THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenant_memberships tm WHERE tm.tenant_id=_tenant_id AND tm.user_id=_uid AND tm.status='active' AND tm.deactivated_at IS NULL) THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organization_memberships om WHERE om.organization_id=_organization_id AND om.tenant_id=_tenant_id AND om.user_id=_uid AND om.status='active' AND om.deactivated_at IS NULL) THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.api_organization_client_enablements oe WHERE oe.api_client_id=_client.id AND oe.organization_id=_organization_id AND oe.tenant_id=_tenant_id AND oe.lifecycle_status='enabled') THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id=_workspace_id AND w.organization_id=_organization_id AND w.is_active=true AND w.is_archived=false) THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workspace_memberships wm WHERE wm.workspace_id=_workspace_id AND wm.user_id=_uid) THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.api_workspace_client_enablements we WHERE we.api_client_id=_client.id AND we.workspace_id=_workspace_id AND we.organization_id=_organization_id AND we.tenant_id=_tenant_id AND we.lifecycle_status='enabled') THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.api_capability_grants g WHERE g.tenant_id=_tenant_id AND g.organization_id=_organization_id AND g.workspace_id=_workspace_id AND g.api_client_id=_client.id AND g.api_version=_api_version AND g.capability_kind=_capability_kind AND g.capability_key=_capability_key AND g.lifecycle_status='enabled') THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.api_capability_catalogue c WHERE c.api_version=_api_version AND c.capability_kind=_capability_kind AND c.capability_key=_capability_key AND c.scope_level='project' AND c.lifecycle_status='active') THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.api_client_supported_capabilities sc WHERE sc.api_client_id=_client.id AND sc.api_version=_api_version AND sc.capability_kind=_capability_kind AND sc.capability_key=_capability_key AND sc.lifecycle_status='enabled') THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id=_project_id AND p.workspace_id=_workspace_id AND p.organization_id=_organization_id AND COALESCE(p.is_archived,false)=false) THEN RETURN false; END IF;
  IF NOT COALESCE(public.has_project_access(_uid,_project_id),false) THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.api_project_client_enablements e WHERE e.project_id=_project_id AND e.api_client_id=_client.id AND e.tenant_id=_tenant_id AND e.organization_id=_organization_id AND e.workspace_id=_workspace_id AND e.lifecycle_status='enabled' AND e.enabled_at IS NOT NULL AND e.disabled_at IS NULL) THEN RETURN false; END IF;

  PERFORM set_config('api_e.authenticated_user_id',_uid::text,true);
  PERFORM set_config('api_e.executing_user_id',_uid::text,true);
  PERFORM set_config('api_e.signed_oauth_client_id',_signed_client_id,true);
  PERFORM set_config('api_e.api_client_id',_client.id::text,true);
  PERFORM set_config('api_e.policy_version_id',_policy.id::text,true);
  PERFORM set_config('api_e.tenant_id',_tenant_id::text,true);
  PERFORM set_config('api_e.organization_id',_organization_id::text,true);
  PERFORM set_config('api_e.workspace_id',_workspace_id::text,true);
  PERFORM set_config('api_e.api_version',_api_version,true);
  PERFORM set_config('api_e.capability_kind',_capability_kind,true);
  PERFORM set_config('api_e.capability_key',_capability_key,true);
  PERFORM set_config('api_e.source_channel','external_api',true);
  PERFORM set_config('api_e.request_id',_request_id,true);
  PERFORM set_config('api_e.trusted','true',true);
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('api_e.trusted','false',true);
  PERFORM set_config('api_e.authenticated_user_id','',true); PERFORM set_config('api_e.executing_user_id','',true);
  PERFORM set_config('api_e.signed_oauth_client_id','',true); PERFORM set_config('api_e.api_client_id','',true);
  PERFORM set_config('api_e.policy_version_id','',true); PERFORM set_config('api_e.tenant_id','',true);
  PERFORM set_config('api_e.organization_id','',true); PERFORM set_config('api_e.workspace_id','',true);
  PERFORM set_config('api_e.api_version','',true); PERFORM set_config('api_e.capability_kind','',true);
  PERFORM set_config('api_e.capability_key','',true); PERFORM set_config('api_e.source_channel','',true);
  PERFORM set_config('api_e.request_id','',true); RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION api_e_private.authorize_and_establish_project_scope(text,uuid,uuid,uuid,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION api_e_private.authorize_and_establish_project_scope(text,uuid,uuid,uuid,text,text,text,text) FROM anon;
REVOKE ALL ON FUNCTION api_e_private.authorize_and_establish_project_scope(text,uuid,uuid,uuid,text,text,text,text) FROM authenticated;
REVOKE ALL ON FUNCTION api_e_private.authorize_and_establish_project_scope(text,uuid,uuid,uuid,text,text,text,text) FROM service_role;

CREATE OR REPLACE FUNCTION api_e_private.authorize_and_establish_project_scope_mcp(
  _expected_oauth_client_id text,_organization_id uuid,_workspace_id uuid,_project_id uuid,
  _api_version text,_capability_kind text,_capability_key text,_request_id text
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public','pg_catalog'
AS $$
DECLARE _established boolean;
BEGIN
  _established := api_e_private.authorize_and_establish_project_scope(
    _expected_oauth_client_id,_organization_id,_workspace_id,_project_id,
    _api_version,_capability_kind,_capability_key,_request_id
  );
  IF _established IS DISTINCT FROM true THEN RETURN false; END IF;
  IF current_setting('api_e.trusted',true) IS DISTINCT FROM 'true'
     OR current_setting('api_e.source_channel',true) IS DISTINCT FROM 'external_api'
     OR COALESCE(current_setting('api_e.authenticated_user_id',true),'')=''
     OR COALESCE(current_setting('api_e.executing_user_id',true),'')=''
     OR current_setting('api_e.authenticated_user_id',true)<>current_setting('api_e.executing_user_id',true)
     OR COALESCE(current_setting('api_e.signed_oauth_client_id',true),'')=''
     OR COALESCE(current_setting('api_e.api_client_id',true),'')=''
     OR COALESCE(current_setting('api_e.policy_version_id',true),'')=''
     OR current_setting('api_e.api_version',true) IS DISTINCT FROM _api_version
     OR current_setting('api_e.capability_kind',true) IS DISTINCT FROM _capability_kind
     OR current_setting('api_e.capability_key',true) IS DISTINCT FROM _capability_key
     OR current_setting('api_e.request_id',true) IS DISTINCT FROM _request_id
  THEN
    PERFORM set_config('api_e.trusted','false',true);
    PERFORM set_config('api_e.authenticated_user_id','',true); PERFORM set_config('api_e.executing_user_id','',true);
    PERFORM set_config('api_e.signed_oauth_client_id','',true); PERFORM set_config('api_e.api_client_id','',true);
    PERFORM set_config('api_e.policy_version_id','',true); PERFORM set_config('api_e.tenant_id','',true);
    PERFORM set_config('api_e.organization_id','',true); PERFORM set_config('api_e.workspace_id','',true);
    PERFORM set_config('api_e.api_version','',true); PERFORM set_config('api_e.capability_kind','',true);
    PERFORM set_config('api_e.capability_key','',true); PERFORM set_config('api_e.source_channel','',true);
    PERFORM set_config('api_e.request_id','',true); RETURN false;
  END IF;
  PERFORM set_config('api_e.source_channel','mcp',true);
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('api_e.trusted','false',true);
  PERFORM set_config('api_e.authenticated_user_id','',true); PERFORM set_config('api_e.executing_user_id','',true);
  PERFORM set_config('api_e.signed_oauth_client_id','',true); PERFORM set_config('api_e.api_client_id','',true);
  PERFORM set_config('api_e.policy_version_id','',true); PERFORM set_config('api_e.tenant_id','',true);
  PERFORM set_config('api_e.organization_id','',true); PERFORM set_config('api_e.workspace_id','',true);
  PERFORM set_config('api_e.api_version','',true); PERFORM set_config('api_e.capability_kind','',true);
  PERFORM set_config('api_e.capability_key','',true); PERFORM set_config('api_e.source_channel','',true);
  PERFORM set_config('api_e.request_id','',true); RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION api_e_private.authorize_and_establish_project_scope_mcp(text,uuid,uuid,uuid,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION api_e_private.authorize_and_establish_project_scope_mcp(text,uuid,uuid,uuid,text,text,text,text) FROM anon;
REVOKE ALL ON FUNCTION api_e_private.authorize_and_establish_project_scope_mcp(text,uuid,uuid,uuid,text,text,text,text) FROM authenticated;
REVOKE ALL ON FUNCTION api_e_private.authorize_and_establish_project_scope_mcp(text,uuid,uuid,uuid,text,text,text,text) FROM service_role;

-- ---------------------------------------------------------------------------
-- Delegated read/context helpers.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api_e_private.resolve_delegated_read_principal(_expected_oauth_client_id text)
RETURNS TABLE(authenticated_user_id uuid,api_client_id uuid,policy_version_id uuid,signed_oauth_client_id text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE _uid uuid; _signed text; _client_id uuid; _policy_id uuid;
BEGIN
  IF _expected_oauth_client_id IS NULL OR length(_expected_oauth_client_id)=0 OR length(_expected_oauth_client_id)>255
     OR _expected_oauth_client_id !~ '^[A-Za-z0-9._~:@/-]{1,255}$' THEN RETURN; END IF;
  BEGIN _uid:=auth.uid(); EXCEPTION WHEN OTHERS THEN RETURN; END;
  IF _uid IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=_uid AND p.is_active=true) THEN RETURN; END IF;
  BEGIN _signed:=api_e_private.jwt_client_id(); EXCEPTION WHEN OTHERS THEN RETURN; END;
  IF _signed IS NULL OR _signed<>_expected_oauth_client_id THEN RETURN; END IF;
  SELECT c.id INTO _client_id FROM public.api_clients c WHERE c.oauth_client_id=_signed AND c.lifecycle_status='active';
  IF _client_id IS NULL THEN RETURN; END IF;
  SELECT v.id INTO _policy_id FROM public.api_client_policy_versions v WHERE v.api_client_id=_client_id AND v.lifecycle_status='active';
  IF _policy_id IS NULL THEN RETURN; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.api_user_policy_acknowledgements a WHERE a.user_id=_uid AND a.api_client_id=_client_id AND a.policy_version_id=_policy_id AND a.revoked_at IS NULL) THEN RETURN; END IF;
  authenticated_user_id:=_uid; api_client_id:=_client_id; policy_version_id:=_policy_id; signed_oauth_client_id:=_signed;
  RETURN NEXT; RETURN;
EXCEPTION WHEN OTHERS THEN RETURN;
END;
$$;
REVOKE ALL ON FUNCTION api_e_private.resolve_delegated_read_principal(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION api_e_private.resolve_delegated_read_principal(text) FROM anon;
REVOKE ALL ON FUNCTION api_e_private.resolve_delegated_read_principal(text) FROM authenticated;

CREATE OR REPLACE FUNCTION api_e_private.resolve_me_context(
  _expected_oauth_client_id text,
  _context_type text DEFAULT NULL,
  _context_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  _uid uuid; _client_id uuid; _rowcount integer;
  _display_name text; _email text; _is_active boolean; _profile_org uuid; _super boolean;
  _tenant_id uuid; _org_id uuid; _ws_id uuid; _proj_id uuid;
  _tenant_role text; _org_role text; _ws_role text; _project_role text; _effective_role text;
  _is_org_admin boolean:=false; _is_ws_admin boolean:=false; _context jsonb:=NULL;
BEGIN
  IF _context_type IS NULL AND _context_id IS NOT NULL THEN RAISE EXCEPTION 'api_v1_invalid_request' USING ERRCODE='22023'; END IF;
  IF _context_type IS NOT NULL AND _context_id IS NULL THEN RAISE EXCEPTION 'api_v1_invalid_request' USING ERRCODE='22023'; END IF;
  IF _context_type IS NOT NULL AND _context_type NOT IN ('organization','workspace','project') THEN RAISE EXCEPTION 'api_v1_invalid_request' USING ERRCODE='22023'; END IF;
  IF _context_id IS NOT NULL AND _context_id='00000000-0000-0000-0000-000000000000'::uuid THEN RAISE EXCEPTION 'api_v1_invalid_request' USING ERRCODE='22023'; END IF;

  SELECT r.authenticated_user_id,r.api_client_id INTO _uid,_client_id FROM api_e_private.resolve_delegated_read_principal(_expected_oauth_client_id) r;
  GET DIAGNOSTICS _rowcount=ROW_COUNT;
  IF _rowcount<>1 OR _uid IS NULL OR _client_id IS NULL THEN RAISE EXCEPTION 'api_v1_not_authorized' USING ERRCODE='42501'; END IF;

  SELECT CASE WHEN p.organization_id IS NOT NULL THEN public.btpm_decrypt(p.display_name,p.organization_id) ELSE p.display_name END,
         p.email,p.is_active,p.organization_id
    INTO _display_name,_email,_is_active,_profile_org
  FROM public.profiles p WHERE p.id=_uid;
  IF _is_active IS DISTINCT FROM true THEN RAISE EXCEPTION 'api_v1_not_authorized' USING ERRCODE='42501'; END IF;
  _super:=COALESCE(public.is_platform_super_admin(_uid),false);

  IF _context_type IS NULL THEN
    IF NOT EXISTS(
      SELECT 1 FROM public.organization_memberships om
      JOIN public.organizations o ON o.id=om.organization_id
      JOIN public.tenants t ON t.id=o.tenant_id
      JOIN public.tenant_memberships tm ON tm.tenant_id=t.id AND tm.user_id=_uid
      JOIN public.api_organization_client_enablements e ON e.tenant_id=t.id AND e.organization_id=o.id AND e.api_client_id=_client_id
      JOIN public.api_capability_grants g ON g.tenant_id=t.id AND g.organization_id=o.id AND g.api_client_id=_client_id AND g.workspace_id IS NULL
        AND g.api_version='v1' AND g.capability_kind='read' AND g.capability_key='me:read' AND g.lifecycle_status='enabled'
      WHERE om.user_id=_uid AND om.status='active' AND om.deactivated_at IS NULL
        AND tm.status='active' AND tm.deactivated_at IS NULL AND t.status='active' AND e.lifecycle_status='enabled'
    ) THEN RAISE EXCEPTION 'api_v1_not_authorized' USING ERRCODE='42501'; END IF;
    RETURN jsonb_build_object('userId',_uid,'displayName',_display_name,'email',_email,'isActive',true,'platformSuperAdmin',_super,'context',NULL);
  END IF;

  IF _context_type='organization' THEN
    SELECT o.id,t.id,om.role::text,tm.role::text INTO _org_id,_tenant_id,_org_role,_tenant_role
    FROM public.organizations o
    JOIN public.tenants t ON t.id=o.tenant_id AND t.status='active'
    JOIN public.tenant_memberships tm ON tm.tenant_id=t.id AND tm.user_id=_uid AND tm.status='active' AND tm.deactivated_at IS NULL
    JOIN public.organization_memberships om ON om.organization_id=o.id AND om.user_id=_uid AND om.status='active' AND om.deactivated_at IS NULL
    WHERE o.id=_context_id
      AND EXISTS(SELECT 1 FROM public.api_organization_client_enablements e WHERE e.tenant_id=t.id AND e.organization_id=o.id AND e.api_client_id=_client_id AND e.lifecycle_status='enabled')
      AND EXISTS(SELECT 1 FROM public.api_capability_grants g WHERE g.tenant_id=t.id AND g.organization_id=o.id AND g.api_client_id=_client_id AND g.workspace_id IS NULL AND g.api_version='v1' AND g.capability_kind='read' AND g.capability_key='me:read' AND g.lifecycle_status='enabled');
    IF _org_id IS NULL THEN RAISE EXCEPTION 'api_v1_not_authorized' USING ERRCODE='42501'; END IF;
    _is_org_admin:=COALESCE(public.is_org_admin(_uid,_org_id),false);
    _effective_role:=CASE WHEN _is_org_admin THEN 'org_admin' ELSE _org_role END;
    _context:=jsonb_build_object('type','organization','contextId',_org_id,'tenantId',_tenant_id,'organizationId',_org_id,'workspaceId',NULL,'projectId',NULL,'tenantRole',_tenant_role,'organizationRole',_org_role,'workspaceRole',NULL,'projectRole',NULL,'effectiveRole',_effective_role);

  ELSIF _context_type='workspace' THEN
    SELECT w.id,o.id,t.id,om.role::text,tm.role::text INTO _ws_id,_org_id,_tenant_id,_org_role,_tenant_role
    FROM public.workspaces w
    JOIN public.organizations o ON o.id=w.organization_id
    JOIN public.tenants t ON t.id=o.tenant_id AND t.status='active'
    JOIN public.tenant_memberships tm ON tm.tenant_id=t.id AND tm.user_id=_uid AND tm.status='active' AND tm.deactivated_at IS NULL
    JOIN public.organization_memberships om ON om.organization_id=o.id AND om.user_id=_uid AND om.status='active' AND om.deactivated_at IS NULL
    WHERE w.id=_context_id AND w.is_active=true AND w.is_archived=false
      AND (public.is_workspace_member(_uid,w.id) OR public.is_org_admin(_uid,o.id))
      AND EXISTS(SELECT 1 FROM public.api_organization_client_enablements e WHERE e.tenant_id=t.id AND e.organization_id=o.id AND e.api_client_id=_client_id AND e.lifecycle_status='enabled')
      AND EXISTS(SELECT 1 FROM public.api_workspace_client_enablements we WHERE we.tenant_id=t.id AND we.organization_id=o.id AND we.workspace_id=w.id AND we.api_client_id=_client_id AND we.lifecycle_status='enabled')
      AND EXISTS(SELECT 1 FROM public.api_capability_grants g WHERE g.tenant_id=t.id AND g.organization_id=o.id AND g.api_client_id=_client_id AND g.workspace_id IS NULL AND g.api_version='v1' AND g.capability_kind='read' AND g.capability_key='me:read' AND g.lifecycle_status='enabled');
    IF _ws_id IS NULL THEN RAISE EXCEPTION 'api_v1_not_authorized' USING ERRCODE='42501'; END IF;
    SELECT ur.role::text INTO _ws_role FROM public.user_roles ur WHERE ur.user_id=_uid AND ur.organization_id=_org_id AND ur.workspace_id=_ws_id
      ORDER BY CASE ur.role WHEN 'workspace_admin' THEN 1 WHEN 'project_manager' THEN 2 WHEN 'contributor' THEN 3 WHEN 'viewer' THEN 4 ELSE 5 END LIMIT 1;
    _is_org_admin:=COALESCE(public.is_org_admin(_uid,_org_id),false); _is_ws_admin:=(_ws_role='workspace_admin');
    _effective_role:=CASE WHEN _is_org_admin THEN 'org_admin' WHEN _is_ws_admin THEN 'workspace_admin' WHEN _ws_role IS NOT NULL THEN _ws_role ELSE _org_role END;
    _context:=jsonb_build_object('type','workspace','contextId',_ws_id,'tenantId',_tenant_id,'organizationId',_org_id,'workspaceId',_ws_id,'projectId',NULL,'tenantRole',_tenant_role,'organizationRole',_org_role,'workspaceRole',_ws_role,'projectRole',NULL,'effectiveRole',_effective_role);

  ELSE
    SELECT p.id,w.id,o.id,t.id,om.role::text,tm.role::text INTO _proj_id,_ws_id,_org_id,_tenant_id,_org_role,_tenant_role
    FROM public.projects p
    JOIN public.workspaces w ON w.id=p.workspace_id AND w.organization_id=p.organization_id AND w.is_active=true AND w.is_archived=false
    JOIN public.organizations o ON o.id=p.organization_id
    JOIN public.tenants t ON t.id=o.tenant_id AND t.status='active'
    JOIN public.tenant_memberships tm ON tm.tenant_id=t.id AND tm.user_id=_uid AND tm.status='active' AND tm.deactivated_at IS NULL
    JOIN public.organization_memberships om ON om.organization_id=o.id AND om.user_id=_uid AND om.status='active' AND om.deactivated_at IS NULL
    WHERE p.id=_context_id AND p.is_archived=false AND public.has_project_access(_uid,p.id)
      AND EXISTS(SELECT 1 FROM public.api_organization_client_enablements e WHERE e.tenant_id=t.id AND e.organization_id=o.id AND e.api_client_id=_client_id AND e.lifecycle_status='enabled')
      AND EXISTS(SELECT 1 FROM public.api_workspace_client_enablements we WHERE we.tenant_id=t.id AND we.organization_id=o.id AND we.workspace_id=w.id AND we.api_client_id=_client_id AND we.lifecycle_status='enabled')
      AND EXISTS(SELECT 1 FROM public.api_project_client_enablements pe WHERE pe.tenant_id=t.id AND pe.organization_id=o.id AND pe.workspace_id=w.id AND pe.project_id=p.id AND pe.api_client_id=_client_id AND pe.lifecycle_status='enabled' AND pe.enabled_at IS NOT NULL AND pe.disabled_at IS NULL)
      AND EXISTS(SELECT 1 FROM public.api_capability_grants g WHERE g.tenant_id=t.id AND g.organization_id=o.id AND g.api_client_id=_client_id AND g.workspace_id IS NULL AND g.api_version='v1' AND g.capability_kind='read' AND g.capability_key='me:read' AND g.lifecycle_status='enabled');
    IF _proj_id IS NULL THEN RAISE EXCEPTION 'api_v1_not_authorized' USING ERRCODE='42501'; END IF;
    SELECT ur.role::text INTO _ws_role FROM public.user_roles ur WHERE ur.user_id=_uid AND ur.organization_id=_org_id AND ur.workspace_id=_ws_id
      ORDER BY CASE ur.role WHEN 'workspace_admin' THEN 1 WHEN 'project_manager' THEN 2 WHEN 'contributor' THEN 3 WHEN 'viewer' THEN 4 ELSE 5 END LIMIT 1;
    SELECT pm.role::text INTO _project_role FROM public.project_memberships pm WHERE pm.user_id=_uid AND pm.project_id=_proj_id AND pm.removed_at IS NULL
      ORDER BY CASE pm.role WHEN 'project_manager' THEN 1 WHEN 'contributor' THEN 2 WHEN 'viewer' THEN 3 ELSE 4 END LIMIT 1;
    _is_org_admin:=COALESCE(public.is_org_admin(_uid,_org_id),false); _is_ws_admin:=(_ws_role='workspace_admin');
    _effective_role:=CASE WHEN _is_org_admin THEN 'org_admin' WHEN _is_ws_admin THEN 'workspace_admin' WHEN _project_role IS NOT NULL THEN _project_role WHEN _ws_role IS NOT NULL THEN _ws_role ELSE _org_role END;
    _context:=jsonb_build_object('type','project','contextId',_proj_id,'tenantId',_tenant_id,'organizationId',_org_id,'workspaceId',_ws_id,'projectId',_proj_id,'tenantRole',_tenant_role,'organizationRole',_org_role,'workspaceRole',_ws_role,'projectRole',_project_role,'effectiveRole',_effective_role);
  END IF;

  RETURN jsonb_build_object('userId',_uid,'displayName',_display_name,'email',_email,'isActive',true,'platformSuperAdmin',_super,'context',_context);
END;
$$;
REVOKE ALL ON FUNCTION api_e_private.resolve_me_context(text,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION api_e_private.resolve_me_context(text,text,uuid) FROM anon;
REVOKE ALL ON FUNCTION api_e_private.resolve_me_context(text,text,uuid) FROM authenticated;

-- ---------------------------------------------------------------------------
-- Idempotency helpers.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api_e_private.claim_idempotency(_command text,_idempotency_key text,_payload_hash text)
RETURNS TABLE(decision text,registry_id uuid,registry_state text,canonical_result jsonb,failure_code text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE v_capability_kind text; v_capability_key text; v_user_raw text; v_client_raw text; v_user_id uuid; v_client_id uuid; v_inserted_id uuid; v_existing record;
BEGIN
  IF NOT api_e_private.assert_trusted_context() THEN RAISE EXCEPTION 'api_e_private.claim_idempotency: trusted context required' USING ERRCODE='42501'; END IF;
  v_capability_kind:=current_setting('api_e.capability_kind',true);
  IF v_capability_kind IS DISTINCT FROM 'command' THEN RAISE EXCEPTION 'api_e_private.claim_idempotency: capability_kind must be command' USING ERRCODE='42501'; END IF;
  v_capability_key:=current_setting('api_e.capability_key',true);
  IF v_capability_key IS NULL OR length(btrim(v_capability_key))=0 THEN RAISE EXCEPTION 'api_e_private.claim_idempotency: capability_key missing' USING ERRCODE='42501'; END IF;
  IF _command IS NULL OR length(btrim(_command))=0 OR length(_command)>128 THEN RAISE EXCEPTION 'api_e_private.claim_idempotency: invalid command' USING ERRCODE='22023'; END IF;
  IF _command<>v_capability_key THEN RAISE EXCEPTION 'api_e_private.claim_idempotency: command does not match trusted capability_key' USING ERRCODE='42501'; END IF;
  IF _idempotency_key IS NULL OR length(btrim(_idempotency_key))=0 OR length(_idempotency_key)>255 THEN RAISE EXCEPTION 'api_e_private.claim_idempotency: invalid idempotency_key' USING ERRCODE='22023'; END IF;
  IF _payload_hash IS NULL OR _payload_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'api_e_private.claim_idempotency: invalid payload_hash' USING ERRCODE='22023'; END IF;
  v_user_raw:=current_setting('api_e.authenticated_user_id',true);
  IF v_user_raw IS NULL OR length(btrim(v_user_raw))=0 THEN RAISE EXCEPTION 'api_e_private.claim_idempotency: authenticated_user_id missing' USING ERRCODE='42501'; END IF;
  BEGIN v_user_id:=v_user_raw::uuid; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'api_e_private.claim_idempotency: authenticated_user_id invalid' USING ERRCODE='42501'; END;
  v_client_raw:=current_setting('api_e.api_client_id',true);
  IF v_client_raw IS NULL OR length(btrim(v_client_raw))=0 THEN RAISE EXCEPTION 'api_e_private.claim_idempotency: api_client_id missing' USING ERRCODE='42501'; END IF;
  BEGIN v_client_id:=v_client_raw::uuid; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'api_e_private.claim_idempotency: api_client_id invalid' USING ERRCODE='42501'; END;
  INSERT INTO public.api_idempotency_registry AS r(requested_user_id,source_client_id,command,idempotency_key,payload_hash,state)
  VALUES(v_user_id,v_client_id,_command,_idempotency_key,_payload_hash,'pending')
  ON CONFLICT ON CONSTRAINT api_idempotency_registry_scope_unique DO NOTHING RETURNING r.id INTO v_inserted_id;
  IF v_inserted_id IS NOT NULL THEN decision:='execute';registry_id:=v_inserted_id;registry_state:='pending';canonical_result:=NULL;failure_code:=NULL;RETURN NEXT;RETURN;END IF;
  SELECT r.id,r.state,r.payload_hash,r.canonical_result,r.failure_code INTO v_existing FROM public.api_idempotency_registry r
   WHERE r.requested_user_id=v_user_id AND r.source_client_id=v_client_id AND r.command=_command AND r.idempotency_key=_idempotency_key;
  IF NOT FOUND THEN RAISE EXCEPTION 'api_e_private.claim_idempotency: registry row missing after conflict' USING ERRCODE='XX000'; END IF;
  IF v_existing.payload_hash<>_payload_hash THEN decision:='conflict';registry_id:=v_existing.id;registry_state:=v_existing.state;canonical_result:=NULL;failure_code:=NULL;RETURN NEXT;RETURN;END IF;
  IF v_existing.state='completed' THEN decision:='replay';registry_id:=v_existing.id;registry_state:='completed';canonical_result:=v_existing.canonical_result;failure_code:=NULL;RETURN NEXT;RETURN;
  ELSIF v_existing.state='failed' THEN decision:='replay';registry_id:=v_existing.id;registry_state:='failed';canonical_result:=NULL;failure_code:=v_existing.failure_code;RETURN NEXT;RETURN;
  ELSIF v_existing.state='pending' THEN decision:='pending';registry_id:=v_existing.id;registry_state:='pending';canonical_result:=NULL;failure_code:=NULL;RETURN NEXT;RETURN;
  ELSE RAISE EXCEPTION 'api_e_private.claim_idempotency: unexpected registry state %',v_existing.state USING ERRCODE='XX000'; END IF;
END; $$;
REVOKE ALL ON FUNCTION api_e_private.claim_idempotency(text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION api_e_private.claim_idempotency(text,text,text) FROM anon;
REVOKE ALL ON FUNCTION api_e_private.claim_idempotency(text,text,text) FROM authenticated;

CREATE OR REPLACE FUNCTION api_e_private.complete_idempotency(_registry_id uuid,_canonical_result jsonb)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE v_capability_key text;v_user_raw text;v_client_raw text;v_user_id uuid;v_client_id uuid;v_updated_id uuid;
BEGIN
  IF NOT api_e_private.assert_trusted_context() THEN RAISE EXCEPTION 'api_e_private.complete_idempotency: trusted context required' USING ERRCODE='42501'; END IF;
  IF current_setting('api_e.capability_kind',true) IS DISTINCT FROM 'command' THEN RAISE EXCEPTION 'api_e_private.complete_idempotency: capability_kind must be command' USING ERRCODE='42501'; END IF;
  v_capability_key:=current_setting('api_e.capability_key',true);
  IF v_capability_key IS NULL OR length(btrim(v_capability_key))=0 THEN RAISE EXCEPTION 'api_e_private.complete_idempotency: capability_key missing' USING ERRCODE='42501'; END IF;
  v_user_raw:=current_setting('api_e.authenticated_user_id',true);v_client_raw:=current_setting('api_e.api_client_id',true);
  IF v_user_raw IS NULL OR length(btrim(v_user_raw))=0 OR v_client_raw IS NULL OR length(btrim(v_client_raw))=0 THEN RAISE EXCEPTION 'api_e_private.complete_idempotency: trusted identity missing' USING ERRCODE='42501'; END IF;
  BEGIN v_user_id:=v_user_raw::uuid;v_client_id:=v_client_raw::uuid; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'api_e_private.complete_idempotency: trusted identity invalid' USING ERRCODE='42501'; END;
  IF _registry_id IS NULL THEN RAISE EXCEPTION 'api_e_private.complete_idempotency: registry_id required' USING ERRCODE='22023'; END IF;
  IF _canonical_result IS NULL OR jsonb_typeof(_canonical_result)<>'object' THEN RAISE EXCEPTION 'api_e_private.complete_idempotency: canonical_result must be a JSON object' USING ERRCODE='22023'; END IF;
  UPDATE public.api_idempotency_registry SET state='completed',canonical_result=_canonical_result,failure_code=NULL,completed_at=now(),updated_at=now()
   WHERE id=_registry_id AND requested_user_id=v_user_id AND source_client_id=v_client_id AND command=v_capability_key AND state='pending' RETURNING id INTO v_updated_id;
  IF v_updated_id IS NULL THEN RAISE EXCEPTION 'api_e_private.complete_idempotency: no matching pending claim' USING ERRCODE='42501'; END IF;
  RETURN true;
END; $$;
REVOKE ALL ON FUNCTION api_e_private.complete_idempotency(uuid,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION api_e_private.complete_idempotency(uuid,jsonb) FROM anon;
REVOKE ALL ON FUNCTION api_e_private.complete_idempotency(uuid,jsonb) FROM authenticated;

CREATE OR REPLACE FUNCTION api_e_private.fail_idempotency(_registry_id uuid,_failure_code text)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE v_capability_key text;v_user_raw text;v_client_raw text;v_user_id uuid;v_client_id uuid;v_updated_id uuid;
BEGIN
  IF NOT api_e_private.assert_trusted_context() THEN RAISE EXCEPTION 'api_e_private.fail_idempotency: trusted context required' USING ERRCODE='42501'; END IF;
  IF current_setting('api_e.capability_kind',true) IS DISTINCT FROM 'command' THEN RAISE EXCEPTION 'api_e_private.fail_idempotency: capability_kind must be command' USING ERRCODE='42501'; END IF;
  v_capability_key:=current_setting('api_e.capability_key',true);
  IF v_capability_key IS NULL OR length(btrim(v_capability_key))=0 THEN RAISE EXCEPTION 'api_e_private.fail_idempotency: capability_key missing' USING ERRCODE='42501'; END IF;
  v_user_raw:=current_setting('api_e.authenticated_user_id',true);v_client_raw:=current_setting('api_e.api_client_id',true);
  IF v_user_raw IS NULL OR length(btrim(v_user_raw))=0 OR v_client_raw IS NULL OR length(btrim(v_client_raw))=0 THEN RAISE EXCEPTION 'api_e_private.fail_idempotency: trusted identity missing' USING ERRCODE='42501'; END IF;
  BEGIN v_user_id:=v_user_raw::uuid;v_client_id:=v_client_raw::uuid; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'api_e_private.fail_idempotency: trusted identity invalid' USING ERRCODE='42501'; END;
  IF _registry_id IS NULL THEN RAISE EXCEPTION 'api_e_private.fail_idempotency: registry_id required' USING ERRCODE='22023'; END IF;
  IF _failure_code IS NULL OR length(btrim(_failure_code))=0 OR length(_failure_code)>128 THEN RAISE EXCEPTION 'api_e_private.fail_idempotency: invalid failure_code' USING ERRCODE='22023'; END IF;
  UPDATE public.api_idempotency_registry SET state='failed',canonical_result=NULL,failure_code=_failure_code,completed_at=now(),updated_at=now()
   WHERE id=_registry_id AND requested_user_id=v_user_id AND source_client_id=v_client_id AND command=v_capability_key AND state='pending' RETURNING id INTO v_updated_id;
  IF v_updated_id IS NULL THEN RAISE EXCEPTION 'api_e_private.fail_idempotency: no matching pending claim' USING ERRCODE='42501'; END IF;
  RETURN true;
END; $$;
REVOKE ALL ON FUNCTION api_e_private.fail_idempotency(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION api_e_private.fail_idempotency(uuid,text) FROM anon;
REVOKE ALL ON FUNCTION api_e_private.fail_idempotency(uuid,text) FROM authenticated;
