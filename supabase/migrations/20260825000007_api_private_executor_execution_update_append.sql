-- BTPM OSS baseline: current Execution Update append private execution bridge.
CREATE OR REPLACE FUNCTION api_e_private.execute_v1_append_execution_update(
  _execution_source text,_expected_oauth_client_id text,_target_type text,_target_id uuid,_summary text,
  _update_date date,_status_label text,_request_id text,_correlation_id text,_idempotency_key text,_payload_hash text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog','public' AS $function$
DECLARE
  c_api_version constant text:='v1';c_capability_kind constant text:='command';c_capability_key constant text:='execution_updates:append';
  v_source text:=_execution_source;v_target_type text:=lower(nullif(btrim(coalesce(_target_type,'')),''));v_project_id uuid;v_workspace_id uuid;v_organization_id uuid;
  v_trusted boolean:=false;v_ctx_client_id uuid;v_ctx_tenant_id uuid;v_ctx_org_id uuid;v_ctx_workspace_id uuid;v_enabled boolean:=false;
  v_claim record;v_pmg jsonb;v_status text;v_data jsonb;v_exec_id uuid;v_result jsonb;
BEGIN
  IF v_source IS NULL OR v_source NOT IN ('external_api','mcp') THEN RETURN jsonb_build_object('ok',false,'outcome','not_authorized');END IF;
  IF nullif(btrim(coalesce(_expected_oauth_client_id,'')),'') IS NULL OR v_target_type IS NULL OR v_target_type NOT IN ('phase','task') OR _target_id IS NULL OR nullif(btrim(coalesce(_summary,'')),'') IS NULL OR _update_date IS NULL
     OR coalesce(nullif(btrim(coalesce(_request_id,'')),''),'') !~ '^[A-Za-z0-9._~:@/-]{1,128}$'
     OR coalesce(nullif(btrim(coalesce(_correlation_id,'')),''),'') !~ '^[A-Za-z0-9._~:@/-]{1,128}$'
     OR coalesce(nullif(btrim(coalesce(_idempotency_key,'')),''),'') !~ '^[A-Za-z0-9._~:@/+!=-]{1,255}$'
     OR coalesce(_payload_hash,'') !~ '^[0-9a-f]{64}$' THEN RETURN jsonb_build_object('ok',false,'outcome','invalid');END IF;
  IF v_target_type='phase' THEN SELECT p.project_id,p.workspace_id,p.organization_id INTO v_project_id,v_workspace_id,v_organization_id FROM public.phases p WHERE p.id=_target_id;
  ELSE SELECT t.project_id,t.workspace_id,t.organization_id INTO v_project_id,v_workspace_id,v_organization_id FROM public.tasks t WHERE t.id=_target_id;END IF;
  IF v_project_id IS NULL OR v_workspace_id IS NULL OR v_organization_id IS NULL THEN RETURN jsonb_build_object('ok',false,'outcome','not_authorized');END IF;
  IF v_source='external_api' THEN BEGIN v_trusted:=api_e_private.authorize_and_establish(_expected_oauth_client_id,v_organization_id,v_workspace_id,c_api_version,c_capability_kind,c_capability_key,_request_id);EXCEPTION WHEN OTHERS THEN v_trusted:=false;END;
  ELSE BEGIN v_trusted:=api_e_private.authorize_and_establish_mcp(_expected_oauth_client_id,v_organization_id,v_workspace_id,c_api_version,c_capability_kind,c_capability_key,_request_id);EXCEPTION WHEN OTHERS THEN v_trusted:=false;END;END IF;
  IF v_trusted IS NOT TRUE THEN RETURN jsonb_build_object('ok',false,'outcome','not_authorized');END IF;
  BEGIN v_ctx_client_id:=nullif(btrim(coalesce(current_setting('api_e.api_client_id',true),'')),'')::uuid;v_ctx_tenant_id:=nullif(btrim(coalesce(current_setting('api_e.tenant_id',true),'')),'')::uuid;v_ctx_org_id:=nullif(btrim(coalesce(current_setting('api_e.organization_id',true),'')),'')::uuid;v_ctx_workspace_id:=nullif(btrim(coalesce(current_setting('api_e.workspace_id',true),'')),'')::uuid;EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok',false,'outcome','not_authorized');END;
  IF v_ctx_client_id IS NULL OR v_ctx_tenant_id IS NULL OR v_ctx_org_id IS DISTINCT FROM v_organization_id OR v_ctx_workspace_id IS DISTINCT FROM v_workspace_id THEN RETURN jsonb_build_object('ok',false,'outcome','not_authorized');END IF;
  SELECT true INTO v_enabled FROM public.api_project_client_enablements e WHERE e.project_id=v_project_id AND e.api_client_id=v_ctx_client_id AND e.tenant_id=v_ctx_tenant_id AND e.organization_id=v_organization_id AND e.workspace_id=v_workspace_id AND e.lifecycle_status='enabled' AND e.enabled_at IS NOT NULL AND e.disabled_at IS NULL LIMIT 1;
  IF v_enabled IS NOT TRUE THEN RETURN jsonb_build_object('ok',false,'outcome','not_authorized');END IF;
  SELECT c.decision,c.registry_id,c.registry_state,c.canonical_result,c.failure_code INTO v_claim FROM api_e_private.claim_idempotency(c_capability_key,_idempotency_key,_payload_hash)c;
  IF v_claim.decision IS NULL THEN RAISE EXCEPTION 'api_v1_append_execution_update: no idempotency claim decision' USING ERRCODE='XX000';END IF;
  IF v_claim.decision='conflict' THEN RETURN jsonb_build_object('ok',false,'outcome','idempotency_conflict');ELSIF v_claim.decision='pending' THEN RETURN jsonb_build_object('ok',false,'outcome','idempotency_pending');ELSIF v_claim.decision='replay' THEN
    IF v_claim.registry_state='completed' THEN IF v_claim.canonical_result IS NULL OR jsonb_typeof(v_claim.canonical_result)<>'object' THEN RAISE EXCEPTION 'api_v1_append_execution_update: invalid stored canonical result' USING ERRCODE='XX000';END IF;RETURN v_claim.canonical_result||jsonb_build_object('outcome','replayed');
    ELSIF v_claim.registry_state='failed' THEN IF v_claim.failure_code='not_authorized' THEN RETURN jsonb_build_object('ok',false,'outcome','not_authorized');ELSIF v_claim.failure_code='invalid' THEN RETURN jsonb_build_object('ok',false,'outcome','invalid');END IF;RAISE EXCEPTION 'api_v1_append_execution_update: unknown persisted failure code' USING ERRCODE='XX000';END IF;
    RAISE EXCEPTION 'api_v1_append_execution_update: unexpected replay state' USING ERRCODE='XX000';
  ELSIF v_claim.decision<>'execute' THEN RAISE EXCEPTION 'api_v1_append_execution_update: unexpected idempotency decision' USING ERRCODE='XX000';END IF;
  v_pmg:=public.append_execution_update(_target_type,_target_id,_summary,_update_date,_status_label,_correlation_id,_idempotency_key);v_status:=v_pmg->>'status';v_data:=coalesce(v_pmg->'data','{}'::jsonb);
  IF v_status='applied' THEN BEGIN v_exec_id:=nullif(btrim(coalesce(v_data->>'id','')),'')::uuid;EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'api_v1_append_execution_update: malformed applied result' USING ERRCODE='XX000';END;
    IF v_exec_id IS NULL OR (v_data->>'target_type') IS DISTINCT FROM v_target_type OR (v_data->>'target_id') IS DISTINCT FROM _target_id::text OR (v_data->>'update_date') IS DISTINCT FROM _update_date::text OR jsonb_typeof(v_data->'has_status_label')<>'boolean' THEN RAISE EXCEPTION 'api_v1_append_execution_update: inconsistent applied result' USING ERRCODE='XX000';END IF;
    v_result:=jsonb_build_object('ok',true,'outcome','applied','executionUpdateId',v_exec_id,'targetType',v_target_type,'targetId',_target_id,'updateDate',_update_date,'hasStatusLabel',v_data->'has_status_label');PERFORM api_e_private.complete_idempotency(v_claim.registry_id,v_result);RETURN v_result;
  ELSIF v_status='not_authorized' THEN PERFORM api_e_private.fail_idempotency(v_claim.registry_id,'not_authorized');RETURN jsonb_build_object('ok',false,'outcome','not_authorized');
  ELSIF v_status='invalid' THEN PERFORM api_e_private.fail_idempotency(v_claim.registry_id,'invalid');RETURN jsonb_build_object('ok',false,'outcome','invalid');END IF;
  RAISE EXCEPTION 'api_v1_append_execution_update: unexpected canonical command status' USING ERRCODE='XX000';
END;$function$;
REVOKE ALL ON FUNCTION api_e_private.execute_v1_append_execution_update(text,text,text,uuid,text,date,text,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION api_e_private.execute_v1_append_execution_update(text,text,text,uuid,text,date,text,text,text,text,text) FROM anon;
REVOKE ALL ON FUNCTION api_e_private.execute_v1_append_execution_update(text,text,text,uuid,text,date,text,text,text,text,text) FROM authenticated;
REVOKE ALL ON FUNCTION api_e_private.execute_v1_append_execution_update(text,text,text,uuid,text,date,text,text,text,text,text) FROM service_role;
