-- BTPM OSS baseline: current Project Create private execution bridge.
-- Source authority: current effective migration at the private-main checkpoint.

CREATE OR REPLACE FUNCTION api_e_private.execute_v1_create_project(
  _execution_source text,
  _expected_oauth_client_id text,
  _workspace_id uuid,
  _name text,
  _program_id uuid,
  _delivery_model text,
  _request_id text,
  _correlation_id text,
  _idempotency_key text,
  _payload_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  c_api_version constant text := 'v1';
  c_capability_kind constant text := 'command';
  c_capability_key constant text := 'projects:create';
  v_source text := _execution_source;
  v_name text := nullif(btrim(coalesce(_name,'')),'');
  v_delivery_text text := nullif(btrim(coalesce(_delivery_model,'')),'');
  v_delivery_model public.project_delivery_model;
  v_workspace_id uuid;
  v_organization_id uuid;
  v_trusted boolean := false;
  v_ctx_client_id uuid;
  v_ctx_tenant_id uuid;
  v_ctx_org_id uuid;
  v_ctx_workspace_id uuid;
  v_claim record;
  v_pmg jsonb;
  v_pmg_status text;
  v_data jsonb;
  v_project_id uuid;
  v_result jsonb;
BEGIN
  IF v_source IS NULL OR v_source NOT IN ('external_api','mcp') THEN
    RETURN jsonb_build_object('ok', false, 'outcome', 'not_authorized');
  END IF;

  IF nullif(btrim(coalesce(_expected_oauth_client_id,'')),'') IS NULL
     OR _workspace_id IS NULL
     OR v_name IS NULL
     OR length(v_name) > 200
     OR coalesce(nullif(btrim(coalesce(_request_id,'')),''),'') !~ '^[A-Za-z0-9._~:@/-]{1,128}$'
     OR coalesce(nullif(btrim(coalesce(_correlation_id,'')),''),'') !~ '^[A-Za-z0-9._~:@/-]{1,128}$'
     OR coalesce(nullif(btrim(coalesce(_idempotency_key,'')),''),'') !~ '^[A-Za-z0-9._~:@/+!=-]{1,255}$'
     OR coalesce(_payload_hash,'') !~ '^[0-9a-f]{64}$'
  THEN
    RETURN jsonb_build_object('ok', false, 'outcome', 'invalid');
  END IF;

  IF v_delivery_text IS NOT NULL THEN
    BEGIN
      v_delivery_model := v_delivery_text::public.project_delivery_model;
    EXCEPTION WHEN OTHERS THEN
      RETURN jsonb_build_object('ok', false, 'outcome', 'invalid');
    END;
  END IF;

  SELECT w.id, w.organization_id
    INTO v_workspace_id, v_organization_id
    FROM public.workspaces w
   WHERE w.id = _workspace_id
     AND w.is_active IS TRUE
     AND w.is_archived IS NOT TRUE;

  IF v_workspace_id IS NULL OR v_organization_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'outcome', 'not_authorized');
  END IF;

  IF v_source = 'external_api' THEN
    BEGIN
      v_trusted := api_e_private.authorize_and_establish(
        _expected_oauth_client_id, v_organization_id, v_workspace_id,
        c_api_version, c_capability_kind, c_capability_key, _request_id
      );
    EXCEPTION WHEN OTHERS THEN
      v_trusted := false;
    END;
  ELSE
    BEGIN
      v_trusted := api_e_private.authorize_and_establish_mcp(
        _expected_oauth_client_id, v_organization_id, v_workspace_id,
        c_api_version, c_capability_kind, c_capability_key, _request_id
      );
    EXCEPTION WHEN OTHERS THEN
      v_trusted := false;
    END;
  END IF;

  IF v_trusted IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'outcome', 'not_authorized');
  END IF;

  BEGIN
    v_ctx_client_id := nullif(btrim(coalesce(current_setting('api_e.api_client_id', true),'')),'')::uuid;
    v_ctx_tenant_id := nullif(btrim(coalesce(current_setting('api_e.tenant_id', true),'')),'')::uuid;
    v_ctx_org_id := nullif(btrim(coalesce(current_setting('api_e.organization_id', true),'')),'')::uuid;
    v_ctx_workspace_id := nullif(btrim(coalesce(current_setting('api_e.workspace_id', true),'')),'')::uuid;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'outcome', 'not_authorized');
  END;

  IF v_ctx_client_id IS NULL
     OR v_ctx_tenant_id IS NULL
     OR v_ctx_org_id IS DISTINCT FROM v_organization_id
     OR v_ctx_workspace_id IS DISTINCT FROM v_workspace_id
     OR coalesce(nullif(btrim(coalesce(current_setting('api_e.api_version', true),'')),''),'') <> c_api_version
     OR coalesce(nullif(btrim(coalesce(current_setting('api_e.capability_kind', true),'')),''),'') <> c_capability_kind
     OR coalesce(nullif(btrim(coalesce(current_setting('api_e.capability_key', true),'')),''),'') <> c_capability_key
     OR coalesce(nullif(btrim(coalesce(current_setting('api_e.source_channel', true),'')),''),'') IS DISTINCT FROM v_source
  THEN
    RETURN jsonb_build_object('ok', false, 'outcome', 'not_authorized');
  END IF;

  SELECT c.decision, c.registry_id, c.registry_state, c.canonical_result, c.failure_code
    INTO v_claim
    FROM api_e_private.claim_idempotency(c_capability_key, _idempotency_key, _payload_hash) c;

  IF v_claim.decision IS NULL THEN
    RAISE EXCEPTION 'execute_v1_create_project: no idempotency claim decision' USING ERRCODE = 'XX000';
  END IF;

  IF v_claim.decision = 'conflict' THEN
    RETURN jsonb_build_object('ok', false, 'outcome', 'idempotency_conflict');
  ELSIF v_claim.decision = 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'outcome', 'idempotency_pending');
  ELSIF v_claim.decision = 'replay' THEN
    IF v_claim.registry_state = 'completed' THEN
      IF v_claim.canonical_result IS NULL OR jsonb_typeof(v_claim.canonical_result) <> 'object' THEN
        RAISE EXCEPTION 'execute_v1_create_project: invalid stored canonical result' USING ERRCODE = 'XX000';
      END IF;
      RETURN v_claim.canonical_result || jsonb_build_object('outcome', 'replayed');
    ELSIF v_claim.registry_state = 'failed' THEN
      IF v_claim.failure_code = 'not_authorized' THEN
        RETURN jsonb_build_object('ok', false, 'outcome', 'not_authorized');
      ELSIF v_claim.failure_code = 'invalid' THEN
        RETURN jsonb_build_object('ok', false, 'outcome', 'invalid');
      END IF;
      RAISE EXCEPTION 'execute_v1_create_project: unknown persisted failure code' USING ERRCODE = 'XX000';
    END IF;
    RAISE EXCEPTION 'execute_v1_create_project: unexpected replay state' USING ERRCODE = 'XX000';
  ELSIF v_claim.decision <> 'execute' THEN
    RAISE EXCEPTION 'execute_v1_create_project: unexpected idempotency decision' USING ERRCODE = 'XX000';
  END IF;

  v_pmg := public.apply_project_create_blank(
    v_name, v_workspace_id, _program_id, v_delivery_model,
    _correlation_id, _idempotency_key
  );

  v_pmg_status := v_pmg ->> 'status';
  v_data := coalesce(v_pmg -> 'data', '{}'::jsonb);

  IF v_pmg_status = 'applied' THEN
    BEGIN
      v_project_id := nullif(btrim(coalesce(v_data ->> 'id','')),'')::uuid;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'execute_v1_create_project: malformed applied result' USING ERRCODE = 'XX000';
    END;

    IF v_project_id IS NULL
       OR v_project_id = '00000000-0000-0000-0000-000000000000'::uuid
       OR ((v_data ? 'project_id') AND (v_data ->> 'project_id') IS DISTINCT FROM v_project_id::text)
    THEN
      RAISE EXCEPTION 'execute_v1_create_project: inconsistent applied result' USING ERRCODE = 'XX000';
    END IF;

    v_result := jsonb_build_object('ok', true, 'outcome', 'applied', 'projectId', v_project_id);
    PERFORM api_e_private.complete_idempotency(v_claim.registry_id, v_result);
    RETURN v_result;
  ELSIF v_pmg_status = 'not_authorized' THEN
    PERFORM api_e_private.fail_idempotency(v_claim.registry_id, 'not_authorized');
    RETURN jsonb_build_object('ok', false, 'outcome', 'not_authorized');
  ELSIF v_pmg_status = 'invalid' THEN
    PERFORM api_e_private.fail_idempotency(v_claim.registry_id, 'invalid');
    RETURN jsonb_build_object('ok', false, 'outcome', 'invalid');
  END IF;

  RAISE EXCEPTION 'execute_v1_create_project: unexpected canonical command status' USING ERRCODE = 'XX000';
END;
$function$;

REVOKE ALL ON FUNCTION api_e_private.execute_v1_create_project(text, text, uuid, text, uuid, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION api_e_private.execute_v1_create_project(text, text, uuid, text, uuid, text, text, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION api_e_private.execute_v1_create_project(text, text, uuid, text, uuid, text, text, text, text, text) FROM authenticated;
REVOKE ALL ON FUNCTION api_e_private.execute_v1_create_project(text, text, uuid, text, uuid, text, text, text, text, text) FROM service_role;
