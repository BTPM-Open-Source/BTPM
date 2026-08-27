-- UX-MCP-ADMIN.1 — Protected Resource Administration Backend
-- Forward-only, additive. Platform-Super-Admin-only protected configuration of
-- public.api_clients.oauth_resource_audience through a server-resolved bounded
-- resource selection ('none' | 'btpm_mcp'). The canonical MCP resource URI is
-- resolved server-side from BTPM_MCP_RESOURCE_URI and is never hard-coded here.

-- =========================================================================
-- 1. Additive bounded audit representation
-- =========================================================================
ALTER TABLE public.api_platform_admin_audit_events
  ADD COLUMN previous_protected_resource text NULL,
  ADD COLUMN resulting_protected_resource text NULL;

ALTER TABLE public.api_platform_admin_audit_events
  DROP CONSTRAINT api_platform_admin_audit_events_action_chk;

ALTER TABLE public.api_platform_admin_audit_events
  ADD CONSTRAINT api_platform_admin_audit_events_action_chk
    CHECK (action IN (
      'client_create',
      'client_update',
      'client_transition',
      'client_protected_resource_update',
      'redirect_create',
      'redirect_update',
      'redirect_transition',
      'policy_create',
      'policy_update',
      'policy_transition',
      'supported_capability_transition'
    ));

ALTER TABLE public.api_platform_admin_audit_events
  ADD CONSTRAINT api_platform_admin_audit_events_protected_resource_chk
    CHECK (
      (previous_protected_resource IS NULL
        OR previous_protected_resource IN ('none','btpm_mcp'))
      AND (resulting_protected_resource IS NULL
        OR resulting_protected_resource IN ('none','btpm_mcp'))
    );

ALTER TABLE public.api_platform_admin_audit_events
  ADD CONSTRAINT api_platform_admin_audit_events_protected_resource_action_chk
    CHECK (
      (action = 'client_protected_resource_update'
        AND previous_protected_resource IS NOT NULL
        AND resulting_protected_resource IS NOT NULL)
      OR
      (action <> 'client_protected_resource_update'
        AND previous_protected_resource IS NULL
        AND resulting_protected_resource IS NULL)
    );

COMMENT ON COLUMN public.api_platform_admin_audit_events.previous_protected_resource IS
  'UX-MCP-ADMIN.1 bounded administrative protected-resource state before the change: none | btpm_mcp.';
COMMENT ON COLUMN public.api_platform_admin_audit_events.resulting_protected_resource IS
  'UX-MCP-ADMIN.1 bounded administrative protected-resource state after the change: none | btpm_mcp.';

-- =========================================================================
-- 2. Protected mutation command (server-only)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.api_ux_mcp_admin_1_platform_set_client_protected_resource(
  _actor_user_id uuid,
  _api_client_id uuid,
  _resource_type text,
  _resolved_resource_audience text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_actor uuid := _actor_user_id;
  v_type text := _resource_type;
  v_audience text := _resolved_resource_audience;
  v_lifecycle text;
  v_oauth_client_id text;
  v_previous_audience text;
  v_previous_type text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_platform_super_admin(v_actor) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  IF v_type IS NULL OR v_type NOT IN ('none','btpm_mcp') THEN
    RAISE EXCEPTION 'unknown protected resource type' USING ERRCODE = '22023';
  END IF;

  IF v_type = 'none' THEN
    IF v_audience IS NOT NULL THEN
      RAISE EXCEPTION 'invalid protected resource audience' USING ERRCODE = '22023';
    END IF;
  ELSE
    IF v_audience IS NULL
       OR v_audience <> btrim(v_audience)
       OR length(v_audience) = 0
       OR length(v_audience) > 2048
       OR v_audience NOT LIKE 'https://%'
       OR v_audience ~ '\s' THEN
      RAISE EXCEPTION 'invalid protected resource audience' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF _api_client_id IS NULL THEN
    RAISE EXCEPTION 'api client is not available' USING ERRCODE = '42501';
  END IF;

  SELECT c.lifecycle_status, c.oauth_client_id, c.oauth_resource_audience
    INTO v_lifecycle, v_oauth_client_id, v_previous_audience
    FROM public.api_clients c
   WHERE c.id = _api_client_id
   FOR UPDATE;

  IF v_lifecycle IS NULL THEN
    RAISE EXCEPTION 'api client is not available' USING ERRCODE = '42501';
  END IF;

  IF v_lifecycle NOT IN ('draft','active','suspended') THEN
    RAISE EXCEPTION 'protected resource configuration is not permitted' USING ERRCODE = '23514';
  END IF;

  IF v_type = 'btpm_mcp' AND v_oauth_client_id IS NULL THEN
    RAISE EXCEPTION 'oauth client binding is required' USING ERRCODE = '23514';
  END IF;

  v_previous_type := CASE WHEN v_previous_audience IS NULL THEN 'none' ELSE 'btpm_mcp' END;

  -- Idempotent state semantics: an identical requested state creates no evidence.
  IF v_previous_audience IS NOT DISTINCT FROM v_audience THEN
    RETURN jsonb_build_object(
      'api_client_id', _api_client_id,
      'changed', false,
      'previous_protected_resource', v_previous_type,
      'resulting_protected_resource', v_previous_type
    );
  END IF;

  UPDATE public.api_clients
     SET oauth_resource_audience = v_audience,
         updated_by = v_actor
   WHERE id = _api_client_id;

  INSERT INTO public.api_platform_admin_audit_events (
    actor_user_id, api_client_id, target_type, target_id,
    action, previous_lifecycle_status, resulting_lifecycle_status,
    previous_protected_resource, resulting_protected_resource
  )
  VALUES (
    v_actor, _api_client_id, 'api_client', _api_client_id,
    'client_protected_resource_update', v_lifecycle, v_lifecycle,
    v_previous_type, v_type
  );

  RETURN jsonb_build_object(
    'api_client_id', _api_client_id,
    'changed', true,
    'previous_protected_resource', v_previous_type,
    'resulting_protected_resource', v_type
  );
END;
$$;

REVOKE ALL ON FUNCTION public.api_ux_mcp_admin_1_platform_set_client_protected_resource(uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.api_ux_mcp_admin_1_platform_set_client_protected_resource(uuid, uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.api_ux_mcp_admin_1_platform_set_client_protected_resource(uuid, uuid, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.api_ux_mcp_admin_1_platform_set_client_protected_resource(uuid, uuid, text, text) TO service_role;

-- =========================================================================
-- 3. Platform client detail read exposes the persisted configuration fact
-- =========================================================================
CREATE OR REPLACE FUNCTION public.api_g_5_6_platform_get_client(
  _api_client_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_client jsonb;
  v_redirects jsonb;
  v_policies jsonb;
  v_capabilities jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_platform_super_admin(v_actor) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  IF _api_client_id IS NULL THEN
    RAISE EXCEPTION 'api client is not available' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'id', c.id,
    'client_key', c.client_key,
    'display_name', c.display_name,
    'description', c.description,
    'oauth_client_id', c.oauth_client_id,
    'oauth_resource_audience', c.oauth_resource_audience,
    'protected_resource_type',
      CASE WHEN c.oauth_resource_audience IS NULL THEN 'none' ELSE 'btpm_mcp' END,
    'lifecycle_status', c.lifecycle_status,
    'created_at', c.created_at,
    'updated_at', c.updated_at
  )
  INTO v_client
  FROM public.api_clients c
  WHERE c.id = _api_client_id;

  IF v_client IS NULL THEN
    RAISE EXCEPTION 'api client is not available' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(jsonb_agg(item ORDER BY ord_created_at ASC, ord_id ASC), '[]'::jsonb)
  INTO v_redirects
  FROM (
    SELECT
      r.created_at AS ord_created_at,
      r.id AS ord_id,
      jsonb_build_object(
        'id', r.id,
        'redirect_uri', r.redirect_uri,
        'lifecycle_status', r.lifecycle_status,
        'verified_at', r.verified_at,
        'retired_at', r.retired_at,
        'created_at', r.created_at,
        'updated_at', r.updated_at
      ) AS item
    FROM public.api_client_oauth_redirect_uris r
    WHERE r.api_client_id = _api_client_id
  ) redirect_rows;

  SELECT coalesce(jsonb_agg(item ORDER BY ord_rank ASC, ord_created_at DESC, ord_id ASC), '[]'::jsonb)
  INTO v_policies
  FROM (
    SELECT
      CASE p.lifecycle_status
        WHEN 'active' THEN 0
        WHEN 'draft' THEN 1
        ELSE 2
      END AS ord_rank,
      p.created_at AS ord_created_at,
      p.id AS ord_id,
      jsonb_build_object(
        'id', p.id,
        'version', p.version,
        'policy_uri', p.policy_uri,
        'policy_digest', p.policy_digest,
        'lifecycle_status', p.lifecycle_status,
        'effective_at', p.effective_at,
        'retired_at', p.retired_at,
        'created_at', p.created_at,
        'updated_at', p.updated_at
      ) AS item
    FROM public.api_client_policy_versions p
    WHERE p.api_client_id = _api_client_id
  ) policy_rows;

  SELECT coalesce(
    jsonb_agg(item ORDER BY ord_api_version ASC, ord_display_name ASC, ord_capability_key ASC),
    '[]'::jsonb
  )
  INTO v_capabilities
  FROM (
    SELECT
      cat.api_version AS ord_api_version,
      cat.display_name AS ord_display_name,
      cat.capability_key AS ord_capability_key,
      jsonb_build_object(
        'supported_capability_id', s.id,
        'api_version', cat.api_version,
        'capability_kind', cat.capability_kind,
        'capability_key', cat.capability_key,
        'display_name', cat.display_name,
        'description', cat.description,
        'route_id', cat.route_id,
        'http_method', cat.http_method,
        'route_path', cat.route_path,
        'scope_level', cat.scope_level,
        'catalogue_lifecycle_status', cat.lifecycle_status,
        'administrator_assignable', cat.administrator_assignable,
        'support_lifecycle_status', s.lifecycle_status,
        'enabled_at', s.enabled_at,
        'disabled_at', s.disabled_at,
        'created_at', s.created_at,
        'updated_at', s.updated_at
      ) AS item
    FROM public.api_capability_catalogue cat
    LEFT JOIN public.api_client_supported_capabilities s
      ON s.api_client_id = _api_client_id
     AND s.api_version = cat.api_version
     AND s.capability_kind = cat.capability_kind
     AND s.capability_key = cat.capability_key
    WHERE s.id IS NOT NULL
       OR (cat.lifecycle_status = 'active' AND cat.administrator_assignable)
  ) capability_rows;

  RETURN jsonb_build_object(
    'client', v_client,
    'redirects', v_redirects,
    'policy_versions', v_policies,
    'supported_capabilities', v_capabilities
  );
END;
$$;

REVOKE ALL ON FUNCTION public.api_g_5_6_platform_get_client(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.api_g_5_6_platform_get_client(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.api_g_5_6_platform_get_client(uuid) TO authenticated;