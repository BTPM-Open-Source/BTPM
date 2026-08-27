-- BTPM OSS baseline: current Project transition private execution bridge.
CREATE OR REPLACE FUNCTION api_e_private.execute_v1_transition_project(
  _execution_source text,
  _expected_oauth_client_id text,
  _project_id uuid,
  _expected_updated_at timestamptz,
  _target_status text,
  _confirm_warnings boolean,
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
  c_capability_key constant text := 'projects:transition';
  c_categories constant text[] := ARRAY['open_blockers','incomplete_phases','incomplete_tasks','open_risks','target_end_in_future'];
  v_source text;
  v_target_status public.pm_status;
  v_project_id uuid;
  v_workspace_id uuid;
  v_organization_id uuid;
  v_trusted boolean := false;
  v_ctx_client_id uuid;
  v_ctx_tenant_id uuid;
  v_ctx_org_id uuid;
  v_ctx_workspace_id uuid;
  v_enabled boolean := false;
  v_claim record;
  v_locked_workspace_id uuid;
  v_locked_organization_id uuid;
  v_pmg jsonb;
  v_pmg_status text;
  v_data jsonb;
  v_status text;
  v_previous_status text;
  v_updated_at text;
  v_hard_out jsonb;
  v_warn_out jsonb;
  v_counts jsonb;
  v_raw_counts jsonb;
  v_key text;
  v_val text;
  v_result jsonb;
BEGIN
  v_source := nullif(btrim(coalesce(_execution_source,'')),'');
  IF v_source IS NULL OR v_source NOT IN ('external_api','mcp') THEN RETURN jsonb_build_object('ok',false,'outcome','not_authorized'); END IF;

  IF nullif(btrim(coalesce(_expected_oauth_client_id,'')),'') IS NULL
     OR _project_id IS NULL OR _expected_updated_at IS NULL OR _confirm_warnings IS NULL
     OR nullif(btrim(coalesce(_target_status,'')),'') IS NULL
     OR coalesce(nullif(btrim(coalesce(_request_id,'')),''),'') !~ '^[A-Za-z0-9._~:@/-]{1,128}$'
     OR coalesce(nullif(btrim(coalesce(_correlation_id,'')),''),'') !~ '^[A-Za-z0-9._~:@/-]{1,128}$'
     OR coalesce(nullif(btrim(coalesce(_idempotency_key,'')),''),'') !~ '^[A-Za-z0-9._~:@/+!=-]{1,255}$'
     OR coalesce(_payload_hash,'') !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('ok',false,'outcome','invalid');
  END IF;

  BEGIN v_target_status := _target_status::public.pm_status; EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok',false,'outcome','invalid'); END;

  SELECT p.id,p.workspace_id,p.organization_id INTO v_project_id,v_workspace_id,v_organization_id FROM public.projects p WHERE p.id=_project_id;
  IF v_project_id IS NULL OR v_workspace_id IS NULL OR v_organization_id IS NULL THEN RETURN jsonb_build_object('ok',false,'outcome','not_authorized'); END IF;

  IF v_source='external_api' THEN
    BEGIN v_trusted:=api_e_private.authorize_and_establish(_expected_oauth_client_id,v_organization_id,v_workspace_id,c_api_version,c_capability_kind,c_capability_key,_request_id); EXCEPTION WHEN OTHERS THEN v_trusted:=false; END;
  ELSE
    BEGIN v_trusted:=api_e_private.authorize_and_establish_mcp(_expected_oauth_client_id,v_organization_id,v_workspace_id,c_api_version,c_capability_kind,c_capability_key,_request_id); EXCEPTION WHEN OTHERS THEN v_trusted:=false; END;
  END IF;
  IF v_trusted IS NOT TRUE THEN RETURN jsonb_build_object('ok',false,'outcome','not_authorized'); END IF;

  BEGIN
    v_ctx_client_id:=nullif(btrim(coalesce(current_setting('api_e.api_client_id',true),'')),'')::uuid;
    v_ctx_tenant_id:=nullif(btrim(coalesce(current_setting('api_e.tenant_id',true),'')),'')::uuid;
    v_ctx_org_id:=nullif(btrim(coalesce(current_setting('api_e.organization_id',true),'')),'')::uuid;
    v_ctx_workspace_id:=nullif(btrim(coalesce(current_setting('api_e.workspace_id',true),'')),'')::uuid;
  EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok',false,'outcome','not_authorized'); END;

  IF v_ctx_client_id IS NULL OR v_ctx_tenant_id IS NULL
     OR v_ctx_org_id IS DISTINCT FROM v_organization_id OR v_ctx_workspace_id IS DISTINCT FROM v_workspace_id
     OR coalesce(nullif(btrim(coalesce(current_setting('api_e.api_version',true),'')),''),'')<>c_api_version
     OR coalesce(nullif(btrim(coalesce(current_setting('api_e.capability_kind',true),'')),''),'')<>c_capability_kind
     OR coalesce(nullif(btrim(coalesce(current_setting('api_e.capability_key',true),'')),''),'')<>c_capability_key
     OR coalesce(nullif(btrim(coalesce(current_setting('api_e.source_channel',true),'')),''),'')<>v_source
  THEN RETURN jsonb_build_object('ok',false,'outcome','not_authorized'); END IF;

  SELECT true INTO v_enabled FROM public.api_project_client_enablements e
   WHERE e.project_id=v_project_id AND e.api_client_id=v_ctx_client_id AND e.tenant_id=v_ctx_tenant_id
     AND e.organization_id=v_organization_id AND e.workspace_id=v_workspace_id
     AND e.lifecycle_status='enabled' AND e.enabled_at IS NOT NULL AND e.disabled_at IS NULL LIMIT 1;
  IF v_enabled IS NOT TRUE THEN RETURN jsonb_build_object('ok',false,'outcome','not_authorized'); END IF;

  SELECT c.decision,c.registry_id,c.registry_state,c.canonical_result,c.failure_code INTO v_claim
    FROM api_e_private.claim_idempotency(c_capability_key,_idempotency_key,_payload_hash)c;
  IF v_claim.decision IS NULL THEN RAISE EXCEPTION 'execute_v1_transition_project: no idempotency claim decision' USING ERRCODE='XX000'; END IF;
  IF v_claim.decision='conflict' THEN RETURN jsonb_build_object('ok',false,'outcome','idempotency_conflict');
  ELSIF v_claim.decision='pending' THEN RETURN jsonb_build_object('ok',false,'outcome','idempotency_pending');
  ELSIF v_claim.decision='replay' THEN
    IF v_claim.registry_state='completed' THEN
      IF v_claim.canonical_result IS NULL OR jsonb_typeof(v_claim.canonical_result)<>'object' THEN RAISE EXCEPTION 'execute_v1_transition_project: invalid stored canonical result' USING ERRCODE='XX000'; END IF;
      IF (v_claim.canonical_result->>'ok')='true' THEN RETURN v_claim.canonical_result||jsonb_build_object('outcome','replayed'); END IF;
      RETURN v_claim.canonical_result;
    ELSIF v_claim.registry_state='failed' THEN
      IF v_claim.failure_code='stale_project' THEN RETURN jsonb_build_object('ok',false,'outcome','conflict','code','stale_project');
      ELSIF v_claim.failure_code='not_authorized' THEN RETURN jsonb_build_object('ok',false,'outcome','not_authorized');
      ELSIF v_claim.failure_code='invalid' THEN RETURN jsonb_build_object('ok',false,'outcome','invalid'); END IF;
      RAISE EXCEPTION 'execute_v1_transition_project: unknown persisted failure code' USING ERRCODE='XX000';
    END IF;
    RAISE EXCEPTION 'execute_v1_transition_project: unexpected replay state' USING ERRCODE='XX000';
  ELSIF v_claim.decision<>'execute' THEN RAISE EXCEPTION 'execute_v1_transition_project: unexpected idempotency decision' USING ERRCODE='XX000'; END IF;

  SELECT p.workspace_id,p.organization_id INTO v_locked_workspace_id,v_locked_organization_id FROM public.projects p WHERE p.id=v_project_id FOR UPDATE;
  IF v_locked_workspace_id IS DISTINCT FROM v_workspace_id OR v_locked_organization_id IS DISTINCT FROM v_organization_id THEN
    PERFORM api_e_private.fail_idempotency(v_claim.registry_id,'not_authorized'); RETURN jsonb_build_object('ok',false,'outcome','not_authorized');
  END IF;

  v_pmg:=public.apply_project_status_transition(_project_id=>v_project_id,_expected_updated_at=>_expected_updated_at,_target_status=>v_target_status,_confirm_warnings=>_confirm_warnings,_correlation_id=>_correlation_id,_idempotency_key=>_idempotency_key);
  v_pmg_status:=v_pmg->>'status'; v_data:=coalesce(v_pmg->'data','{}'::jsonb);

  IF v_pmg_status IN('applied','no_change') THEN
    v_status:=nullif(btrim(coalesce(v_data->>'status','')),''); v_updated_at:=nullif(btrim(coalesce(v_data->>'updated_at','')),''); v_previous_status:=nullif(btrim(coalesce(v_data->>'previous_status','')),'');
    IF v_pmg_status='no_change' AND v_previous_status IS NULL THEN v_previous_status:=v_status; END IF;
    IF (v_data->>'id') IS DISTINCT FROM v_project_id::text OR v_status IS NULL OR v_previous_status IS NULL OR v_updated_at IS NULL
       OR NOT(v_status=ANY(ARRAY['planned','active','completed','on_hold','cancelled']))
       OR NOT(v_previous_status=ANY(ARRAY['planned','active','completed','on_hold','cancelled'])) THEN
      RAISE EXCEPTION 'execute_v1_transition_project: inconsistent canonical result' USING ERRCODE='XX000';
    END IF;
    v_result:=jsonb_build_object('ok',true,'outcome',v_pmg_status,'projectId',v_project_id,'status',v_status,'previousStatus',v_previous_status,'updatedAt',v_updated_at);
    PERFORM api_e_private.complete_idempotency(v_claim.registry_id,v_result); RETURN v_result;
  ELSIF v_pmg_status='conflict' THEN
    IF (v_data->>'code') IS DISTINCT FROM 'stale_project' THEN RAISE EXCEPTION 'execute_v1_transition_project: unexpected conflict payload' USING ERRCODE='XX000'; END IF;
    PERFORM api_e_private.fail_idempotency(v_claim.registry_id,'stale_project'); RETURN jsonb_build_object('ok',false,'outcome','conflict','code','stale_project');
  ELSIF v_pmg_status IN('blocked','confirmation_required') THEN
    IF v_pmg_status='blocked' AND (v_data->>'code') IS DISTINCT FROM 'completion_hard_blocked' THEN RAISE EXCEPTION 'execute_v1_transition_project: unexpected blocked payload' USING ERRCODE='XX000'; END IF;
    IF v_pmg_status='confirmation_required' AND (v_data->>'code') IS DISTINCT FROM 'completion_soft_warnings' THEN RAISE EXCEPTION 'execute_v1_transition_project: unexpected confirmation payload' USING ERRCODE='XX000'; END IF;
    SELECT coalesce(jsonb_agg(jsonb_build_object('code',e->>'code','message',e->>'message','count',(e->>'count')::int) ORDER BY ord),'[]'::jsonb) INTO v_hard_out
      FROM jsonb_array_elements(coalesce(v_data->'hard_blocks','[]'::jsonb)) WITH ORDINALITY AS t(e,ord)
     WHERE (e->>'code')=ANY(c_categories) AND nullif(btrim(coalesce(e->>'message','')),'') IS NOT NULL AND coalesce(e->>'count','') ~ '^[0-9]{1,9}$';
    SELECT coalesce(jsonb_agg(jsonb_build_object('code',e->>'code','message',e->>'message','count',(e->>'count')::int) ORDER BY ord),'[]'::jsonb) INTO v_warn_out
      FROM jsonb_array_elements(coalesce(v_data->'warnings','[]'::jsonb)) WITH ORDINALITY AS t(e,ord)
     WHERE (e->>'code')=ANY(c_categories) AND nullif(btrim(coalesce(e->>'message','')),'') IS NOT NULL AND coalesce(e->>'count','') ~ '^[0-9]{1,9}$';
    v_raw_counts:=coalesce(v_data->'counts','{}'::jsonb); v_counts:='{}'::jsonb;
    FOREACH v_key IN ARRAY ARRAY['open_blockers','incomplete_phases','incomplete_tasks','open_risks','target_in_future'] LOOP
      v_val:=coalesce(v_raw_counts->>v_key,''); IF v_val ~ '^[0-9]{1,9}$' THEN v_counts:=v_counts||jsonb_build_object(v_key,v_val::int); END IF;
    END LOOP;
    IF v_pmg_status='blocked' THEN v_result:=jsonb_build_object('ok',false,'outcome','blocked','code','completion_hard_blocked','projectId',v_project_id,'hardBlocks',v_hard_out,'warnings',v_warn_out,'counts',v_counts);
    ELSE v_result:=jsonb_build_object('ok',false,'outcome','confirmation_required','code','completion_soft_warnings','projectId',v_project_id,'warnings',v_warn_out,'counts',v_counts); END IF;
    PERFORM api_e_private.complete_idempotency(v_claim.registry_id,v_result); RETURN v_result;
  ELSIF v_pmg_status='not_authorized' THEN PERFORM api_e_private.fail_idempotency(v_claim.registry_id,'not_authorized'); RETURN jsonb_build_object('ok',false,'outcome','not_authorized');
  ELSIF v_pmg_status='invalid' THEN PERFORM api_e_private.fail_idempotency(v_claim.registry_id,'invalid'); RETURN jsonb_build_object('ok',false,'outcome','invalid'); END IF;
  RAISE EXCEPTION 'execute_v1_transition_project: unexpected canonical command status' USING ERRCODE='XX000';
END;
$function$;

REVOKE ALL ON FUNCTION api_e_private.execute_v1_transition_project(text,text,uuid,timestamptz,text,boolean,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION api_e_private.execute_v1_transition_project(text,text,uuid,timestamptz,text,boolean,text,text,text,text) FROM anon;
REVOKE ALL ON FUNCTION api_e_private.execute_v1_transition_project(text,text,uuid,timestamptz,text,boolean,text,text,text,text) FROM authenticated;
REVOKE ALL ON FUNCTION api_e_private.execute_v1_transition_project(text,text,uuid,timestamptz,text,boolean,text,text,text,text) FROM service_role;
