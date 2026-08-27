-- BTPM OSS baseline: current Project update private execution bridge.
CREATE OR REPLACE FUNCTION api_e_private.execute_v1_update_project(
  _execution_source text,_expected_oauth_client_id text,_project_id uuid,_expected_updated_at timestamptz,
  _name text,_priority text,_description text,_charter text,_goals text,_scope_in text,_scope_out text,
  _business_case text,_success_criteria text,_completion_criteria text,_budget_narrative text,_assumptions text,_constraints text,
  _program_id uuid,_delivery_model text,
  _set_name boolean,_set_priority boolean,_set_description boolean,_set_charter boolean,_set_goals boolean,_set_scope_in boolean,_set_scope_out boolean,
  _set_business_case boolean,_set_success_criteria boolean,_set_completion_criteria boolean,_set_budget_narrative boolean,_set_assumptions boolean,_set_constraints boolean,
  _set_program_id boolean,_set_delivery_model boolean,_request_id text,_correlation_id text,_idempotency_key text,_payload_hash text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog','public' AS $function$
DECLARE
  c_api_version constant text:='v1'; c_capability_kind constant text:='command'; c_capability_key constant text:='projects:update';
  v_source text:=_execution_source; v_priority_text text:=nullif(btrim(coalesce(_priority,'')),''); v_delivery_text text:=nullif(btrim(coalesce(_delivery_model,'')),'');
  v_priority public.pm_priority; v_delivery_model public.project_delivery_model;
  v_project_id uuid; v_workspace_id uuid; v_organization_id uuid; v_trusted boolean:=false;
  v_ctx_client_id uuid; v_ctx_tenant_id uuid; v_ctx_org_id uuid; v_ctx_workspace_id uuid; v_enabled boolean:=false;
  v_claim record; v_locked_workspace_id uuid; v_locked_organization_id uuid; v_pmg jsonb; v_pmg_status text; v_data jsonb; v_safe_updated_at text; v_result jsonb;
BEGIN
  IF v_source IS NULL OR v_source NOT IN('external_api','mcp') THEN RETURN jsonb_build_object('ok',false,'outcome','not_authorized'); END IF;
  IF nullif(btrim(coalesce(_expected_oauth_client_id,'')),'') IS NULL OR _project_id IS NULL OR _expected_updated_at IS NULL
     OR coalesce(nullif(btrim(coalesce(_request_id,'')),''),'') !~ '^[A-Za-z0-9._~:@/-]{1,128}$'
     OR coalesce(nullif(btrim(coalesce(_correlation_id,'')),''),'') !~ '^[A-Za-z0-9._~:@/-]{1,128}$'
     OR coalesce(nullif(btrim(coalesce(_idempotency_key,'')),''),'') !~ '^[A-Za-z0-9._~:@/+!=-]{1,255}$'
     OR coalesce(_payload_hash,'') !~ '^[0-9a-f]{64}$'
     OR _set_name IS NULL OR _set_priority IS NULL OR _set_description IS NULL OR _set_charter IS NULL OR _set_goals IS NULL OR _set_scope_in IS NULL OR _set_scope_out IS NULL
     OR _set_business_case IS NULL OR _set_success_criteria IS NULL OR _set_completion_criteria IS NULL OR _set_budget_narrative IS NULL OR _set_assumptions IS NULL OR _set_constraints IS NULL
     OR _set_program_id IS NULL OR _set_delivery_model IS NULL
  THEN RETURN jsonb_build_object('ok',false,'outcome','invalid'); END IF;
  IF _set_name IS TRUE AND (nullif(btrim(coalesce(_name,'')),'') IS NULL OR length(btrim(_name))>200) THEN RETURN jsonb_build_object('ok',false,'outcome','invalid'); END IF;
  IF _set_priority IS TRUE THEN IF v_priority_text IS NULL THEN RETURN jsonb_build_object('ok',false,'outcome','invalid'); END IF; BEGIN v_priority:=v_priority_text::public.pm_priority; EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok',false,'outcome','invalid'); END; END IF;
  IF _set_delivery_model IS TRUE AND v_delivery_text IS NOT NULL THEN BEGIN v_delivery_model:=v_delivery_text::public.project_delivery_model; EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok',false,'outcome','invalid'); END; END IF;
  SELECT p.id,p.workspace_id,p.organization_id INTO v_project_id,v_workspace_id,v_organization_id FROM public.projects p WHERE p.id=_project_id;
  IF v_project_id IS NULL OR v_workspace_id IS NULL OR v_organization_id IS NULL THEN RETURN jsonb_build_object('ok',false,'outcome','not_authorized'); END IF;
  IF v_source='external_api' THEN BEGIN v_trusted:=api_e_private.authorize_and_establish(_expected_oauth_client_id,v_organization_id,v_workspace_id,c_api_version,c_capability_kind,c_capability_key,_request_id); EXCEPTION WHEN OTHERS THEN v_trusted:=false; END; ELSE BEGIN v_trusted:=api_e_private.authorize_and_establish_mcp(_expected_oauth_client_id,v_organization_id,v_workspace_id,c_api_version,c_capability_kind,c_capability_key,_request_id); EXCEPTION WHEN OTHERS THEN v_trusted:=false; END; END IF;
  IF v_trusted IS NOT TRUE THEN RETURN jsonb_build_object('ok',false,'outcome','not_authorized'); END IF;
  BEGIN v_ctx_client_id:=nullif(btrim(coalesce(current_setting('api_e.api_client_id',true),'')),'')::uuid; v_ctx_tenant_id:=nullif(btrim(coalesce(current_setting('api_e.tenant_id',true),'')),'')::uuid; v_ctx_org_id:=nullif(btrim(coalesce(current_setting('api_e.organization_id',true),'')),'')::uuid; v_ctx_workspace_id:=nullif(btrim(coalesce(current_setting('api_e.workspace_id',true),'')),'')::uuid; EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok',false,'outcome','not_authorized'); END;
  IF v_ctx_client_id IS NULL OR v_ctx_tenant_id IS NULL OR v_ctx_org_id IS DISTINCT FROM v_organization_id OR v_ctx_workspace_id IS DISTINCT FROM v_workspace_id
     OR coalesce(nullif(btrim(coalesce(current_setting('api_e.api_version',true),'')),''),'')<>c_api_version
     OR coalesce(nullif(btrim(coalesce(current_setting('api_e.capability_kind',true),'')),''),'')<>c_capability_kind
     OR coalesce(nullif(btrim(coalesce(current_setting('api_e.capability_key',true),'')),''),'')<>c_capability_key
     OR coalesce(nullif(btrim(coalesce(current_setting('api_e.source_channel',true),'')),''),'')<>v_source
  THEN RETURN jsonb_build_object('ok',false,'outcome','not_authorized'); END IF;
  SELECT true INTO v_enabled FROM public.api_project_client_enablements e WHERE e.project_id=v_project_id AND e.api_client_id=v_ctx_client_id AND e.tenant_id=v_ctx_tenant_id AND e.organization_id=v_organization_id AND e.workspace_id=v_workspace_id AND e.lifecycle_status='enabled' AND e.enabled_at IS NOT NULL AND e.disabled_at IS NULL LIMIT 1;
  IF v_enabled IS NOT TRUE THEN RETURN jsonb_build_object('ok',false,'outcome','not_authorized'); END IF;
  SELECT c.decision,c.registry_id,c.registry_state,c.canonical_result,c.failure_code INTO v_claim FROM api_e_private.claim_idempotency(c_capability_key,_idempotency_key,_payload_hash)c;
  IF v_claim.decision IS NULL THEN RAISE EXCEPTION 'execute_v1_update_project: no idempotency claim decision' USING ERRCODE='XX000'; END IF;
  IF v_claim.decision='conflict' THEN RETURN jsonb_build_object('ok',false,'outcome','idempotency_conflict'); ELSIF v_claim.decision='pending' THEN RETURN jsonb_build_object('ok',false,'outcome','idempotency_pending'); ELSIF v_claim.decision='replay' THEN IF v_claim.registry_state='completed' THEN IF v_claim.canonical_result IS NULL OR jsonb_typeof(v_claim.canonical_result)<>'object' THEN RAISE EXCEPTION 'execute_v1_update_project: invalid stored canonical result' USING ERRCODE='XX000'; END IF; RETURN v_claim.canonical_result||jsonb_build_object('outcome','replayed'); ELSIF v_claim.registry_state='failed' THEN IF v_claim.failure_code='stale_project' THEN RETURN jsonb_build_object('ok',false,'outcome','conflict','code','stale_project'); ELSIF v_claim.failure_code='not_authorized' THEN RETURN jsonb_build_object('ok',false,'outcome','not_authorized'); ELSIF v_claim.failure_code='invalid' THEN RETURN jsonb_build_object('ok',false,'outcome','invalid'); END IF; RAISE EXCEPTION 'execute_v1_update_project: unknown persisted failure code' USING ERRCODE='XX000'; END IF; RAISE EXCEPTION 'execute_v1_update_project: unexpected replay state' USING ERRCODE='XX000'; ELSIF v_claim.decision<>'execute' THEN RAISE EXCEPTION 'execute_v1_update_project: unexpected idempotency decision' USING ERRCODE='XX000'; END IF;
  SELECT p.workspace_id,p.organization_id INTO v_locked_workspace_id,v_locked_organization_id FROM public.projects p WHERE p.id=v_project_id FOR UPDATE;
  IF v_locked_workspace_id IS DISTINCT FROM v_workspace_id OR v_locked_organization_id IS DISTINCT FROM v_organization_id THEN PERFORM api_e_private.fail_idempotency(v_claim.registry_id,'not_authorized'); RETURN jsonb_build_object('ok',false,'outcome','not_authorized'); END IF;
  v_pmg:=public.apply_project_update(_project_id=>v_project_id,_expected_updated_at=>_expected_updated_at,_name=>_name,_priority=>v_priority,_description=>_description,_charter=>_charter,_goals=>_goals,_scope_in=>_scope_in,_scope_out=>_scope_out,_business_case=>_business_case,_success_criteria=>_success_criteria,_completion_criteria=>_completion_criteria,_budget_narrative=>_budget_narrative,_assumptions=>_assumptions,_constraints=>_constraints,_program_id=>_program_id,_delivery_model=>v_delivery_model,_set_name=>_set_name,_set_priority=>_set_priority,_set_description=>_set_description,_set_charter=>_set_charter,_set_goals=>_set_goals,_set_scope_in=>_set_scope_in,_set_scope_out=>_set_scope_out,_set_business_case=>_set_business_case,_set_success_criteria=>_set_success_criteria,_set_completion_criteria=>_set_completion_criteria,_set_budget_narrative=>_set_budget_narrative,_set_assumptions=>_set_assumptions,_set_constraints=>_set_constraints,_set_program_id=>_set_program_id,_set_delivery_model=>_set_delivery_model,_correlation_id=>_correlation_id,_idempotency_key=>_idempotency_key);
  v_pmg_status:=v_pmg->>'status'; v_data:=coalesce(v_pmg->'data','{}'::jsonb);
  IF v_pmg_status IN('applied','no_change') THEN v_safe_updated_at:=nullif(btrim(coalesce(v_data->>'updated_at','')),''); IF(v_data->>'id') IS DISTINCT FROM v_project_id::text OR v_safe_updated_at IS NULL THEN RAISE EXCEPTION 'execute_v1_update_project: inconsistent canonical result' USING ERRCODE='XX000'; END IF; v_result:=jsonb_build_object('ok',true,'outcome',v_pmg_status,'projectId',v_project_id,'updatedAt',v_safe_updated_at); PERFORM api_e_private.complete_idempotency(v_claim.registry_id,v_result); RETURN v_result;
  ELSIF v_pmg_status='conflict' THEN IF(v_data->>'code') IS DISTINCT FROM 'stale_project' THEN RAISE EXCEPTION 'execute_v1_update_project: unexpected conflict payload' USING ERRCODE='XX000'; END IF; PERFORM api_e_private.fail_idempotency(v_claim.registry_id,'stale_project'); RETURN jsonb_build_object('ok',false,'outcome','conflict','code','stale_project');
  ELSIF v_pmg_status='not_authorized' THEN PERFORM api_e_private.fail_idempotency(v_claim.registry_id,'not_authorized'); RETURN jsonb_build_object('ok',false,'outcome','not_authorized'); ELSIF v_pmg_status='invalid' THEN PERFORM api_e_private.fail_idempotency(v_claim.registry_id,'invalid'); RETURN jsonb_build_object('ok',false,'outcome','invalid'); END IF;
  RAISE EXCEPTION 'execute_v1_update_project: unexpected canonical command status' USING ERRCODE='XX000';
END;$function$;
REVOKE ALL ON FUNCTION api_e_private.execute_v1_update_project(text,text,uuid,timestamptz,text,text,text,text,text,text,text,text,text,text,text,text,text,uuid,text,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION api_e_private.execute_v1_update_project(text,text,uuid,timestamptz,text,text,text,text,text,text,text,text,text,text,text,text,text,uuid,text,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,text,text,text,text) FROM anon;
REVOKE ALL ON FUNCTION api_e_private.execute_v1_update_project(text,text,uuid,timestamptz,text,text,text,text,text,text,text,text,text,text,text,text,text,uuid,text,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,text,text,text,text) FROM authenticated;
REVOKE ALL ON FUNCTION api_e_private.execute_v1_update_project(text,text,uuid,timestamptz,text,text,text,text,text,text,text,text,text,text,text,text,text,uuid,text,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,text,text,text,text) FROM service_role;
