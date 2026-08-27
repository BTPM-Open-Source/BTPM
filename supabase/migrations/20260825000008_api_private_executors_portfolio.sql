-- BTPM OSS baseline: current Portfolio Create and Update private execution bridges.
-- The owner-membership check uses the canonical transition-aware Organization
-- membership authority. No customer data or reporting credentials are seeded.

CREATE OR REPLACE FUNCTION api_e_private.execute_v1_create_portfolio(
  _execution_source text,_expected_oauth_client_id text,_organization_id uuid,_name text,_code text,
  _description text,_lifecycle_state text,_strategic_priority text,_owner_id uuid,_request_id text,
  _correlation_id text,_idempotency_key text,_payload_hash text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog','public' AS $function$
DECLARE
  c_api_version constant text:='v1'; c_capability_kind constant text:='command'; c_capability_key constant text:='portfolios:create';
  v_source text:=_execution_source; v_source_channel public.pmg_source_channel;
  v_name text:=nullif(btrim(coalesce(_name,'')),''); v_code text:=_code; v_description text:=_description;
  v_lifecycle_state text:=_lifecycle_state; v_strategic_priority text:=_strategic_priority; v_organization_id uuid;
  v_trusted boolean:=false; v_ctx_user_id uuid; v_ctx_client_id uuid; v_ctx_tenant_id uuid; v_ctx_org_id uuid; v_ctx_workspace_id uuid;
  v_claim record; v_portfolio_id uuid; v_result jsonb;
BEGIN
  IF v_source IS NULL OR v_source NOT IN ('external_api','mcp') THEN RETURN jsonb_build_object('ok',false,'outcome','not_authorized'); END IF;
  v_source_channel:=CASE WHEN v_source='external_api' THEN 'external_api'::public.pmg_source_channel ELSE 'mcp'::public.pmg_source_channel END;
  IF nullif(btrim(coalesce(_expected_oauth_client_id,'')),'') IS NULL OR _organization_id IS NULL OR v_name IS NULL OR length(v_name)>200
     OR (v_code IS NOT NULL AND length(v_code)>80) OR (v_description IS NOT NULL AND length(v_description)>4000)
     OR v_lifecycle_state IS NULL OR v_lifecycle_state NOT IN ('opportunity_candidate','business_case_approved','contracted','development','submission_approval','launch_preparation','launched_commercial','lcm_optimization','on_hold','discontinuation','retired')
     OR v_strategic_priority IS NULL OR v_strategic_priority NOT IN ('critical','high','medium','low','watchlist')
     OR coalesce(nullif(btrim(coalesce(_request_id,'')),''),'') !~ '^[A-Za-z0-9._~:@/-]{1,128}$'
     OR coalesce(nullif(btrim(coalesce(_correlation_id,'')),''),'') !~ '^[A-Za-z0-9._~:@/-]{1,128}$'
     OR coalesce(nullif(btrim(coalesce(_idempotency_key,'')),''),'') !~ '^[A-Za-z0-9._~:@/+!=-]{1,255}$'
     OR coalesce(_payload_hash,'') !~ '^[0-9a-f]{64}$' THEN RETURN jsonb_build_object('ok',false,'outcome','invalid'); END IF;
  SELECT o.id INTO v_organization_id FROM public.organizations o WHERE o.id=_organization_id;
  IF v_organization_id IS NULL THEN RETURN jsonb_build_object('ok',false,'outcome','not_authorized'); END IF;
  IF v_source='external_api' THEN BEGIN v_trusted:=api_e_private.authorize_and_establish(_expected_oauth_client_id,v_organization_id,NULL,c_api_version,c_capability_kind,c_capability_key,_request_id); EXCEPTION WHEN OTHERS THEN v_trusted:=false; END;
  ELSE BEGIN v_trusted:=api_e_private.authorize_and_establish_mcp(_expected_oauth_client_id,v_organization_id,NULL,c_api_version,c_capability_kind,c_capability_key,_request_id); EXCEPTION WHEN OTHERS THEN v_trusted:=false; END; END IF;
  IF v_trusted IS NOT TRUE THEN RETURN jsonb_build_object('ok',false,'outcome','not_authorized'); END IF;
  BEGIN
    v_ctx_user_id:=nullif(btrim(coalesce(current_setting('api_e.executing_user_id',true),'')),'')::uuid;
    v_ctx_client_id:=nullif(btrim(coalesce(current_setting('api_e.api_client_id',true),'')),'')::uuid;
    v_ctx_tenant_id:=nullif(btrim(coalesce(current_setting('api_e.tenant_id',true),'')),'')::uuid;
    v_ctx_org_id:=nullif(btrim(coalesce(current_setting('api_e.organization_id',true),'')),'')::uuid;
    v_ctx_workspace_id:=nullif(btrim(coalesce(current_setting('api_e.workspace_id',true),'')),'')::uuid;
  EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok',false,'outcome','not_authorized'); END;
  IF v_ctx_user_id IS NULL OR v_ctx_client_id IS NULL OR v_ctx_tenant_id IS NULL OR v_ctx_workspace_id IS NOT NULL OR v_ctx_org_id IS DISTINCT FROM v_organization_id
     OR coalesce(nullif(btrim(coalesce(current_setting('api_e.api_version',true),'')),''),'')<>c_api_version
     OR coalesce(nullif(btrim(coalesce(current_setting('api_e.capability_kind',true),'')),''),'')<>c_capability_kind
     OR coalesce(nullif(btrim(coalesce(current_setting('api_e.capability_key',true),'')),''),'')<>c_capability_key
     OR coalesce(nullif(btrim(coalesce(current_setting('api_e.source_channel',true),'')),''),'') IS DISTINCT FROM v_source
     OR coalesce(nullif(btrim(coalesce(current_setting('api_e.trusted',true),'')),''),'')<>'true'
  THEN RETURN jsonb_build_object('ok',false,'outcome','not_authorized'); END IF;
  IF public.is_org_admin(v_ctx_user_id,v_organization_id) IS NOT TRUE THEN RETURN jsonb_build_object('ok',false,'outcome','not_authorized'); END IF;
  IF _owner_id IS NOT NULL AND public.is_user_org_member(_owner_id,v_organization_id) IS NOT TRUE THEN RETURN jsonb_build_object('ok',false,'outcome','invalid'); END IF;
  SELECT c.decision,c.registry_id,c.registry_state,c.canonical_result,c.failure_code INTO v_claim FROM api_e_private.claim_idempotency(c_capability_key,_idempotency_key,_payload_hash)c;
  IF v_claim.decision IS NULL THEN RAISE EXCEPTION 'execute_v1_create_portfolio: no idempotency claim decision' USING ERRCODE='XX000'; END IF;
  IF v_claim.decision='conflict' THEN RETURN jsonb_build_object('ok',false,'outcome','idempotency_conflict');
  ELSIF v_claim.decision='pending' THEN RETURN jsonb_build_object('ok',false,'outcome','idempotency_pending');
  ELSIF v_claim.decision='replay' THEN
    IF v_claim.registry_state='completed' THEN IF v_claim.canonical_result IS NULL OR jsonb_typeof(v_claim.canonical_result)<>'object' THEN RAISE EXCEPTION 'execute_v1_create_portfolio: invalid stored canonical result' USING ERRCODE='XX000'; END IF; RETURN v_claim.canonical_result||jsonb_build_object('outcome','replayed');
    ELSIF v_claim.registry_state='failed' THEN IF v_claim.failure_code='not_authorized' THEN RETURN jsonb_build_object('ok',false,'outcome','not_authorized'); ELSIF v_claim.failure_code='invalid' THEN RETURN jsonb_build_object('ok',false,'outcome','invalid'); END IF; RAISE EXCEPTION 'execute_v1_create_portfolio: unknown persisted failure code' USING ERRCODE='XX000'; END IF;
    RAISE EXCEPTION 'execute_v1_create_portfolio: unexpected replay state' USING ERRCODE='XX000';
  ELSIF v_claim.decision<>'execute' THEN RAISE EXCEPTION 'execute_v1_create_portfolio: unexpected idempotency decision' USING ERRCODE='XX000'; END IF;
  v_portfolio_id:=public.admin_create_portfolio_item(v_organization_id,v_name,v_code,v_description,v_lifecycle_state,_owner_id,v_strategic_priority);
  IF v_portfolio_id IS NULL OR v_portfolio_id='00000000-0000-0000-0000-000000000000'::uuid THEN RAISE EXCEPTION 'execute_v1_create_portfolio: malformed canonical create result' USING ERRCODE='XX000'; END IF;
  PERFORM public.pmg_record_command_audit('applied'::public.pmg_command_status,'admin_create_portfolio_item',v_source_channel,NULL::uuid,'portfolio',v_portfolio_id,NULL::uuid,_correlation_id,_idempotency_key,
    jsonb_build_object('organization_id',v_organization_id,'lifecycle_state',v_lifecycle_state,'strategic_priority',v_strategic_priority,'code_set',(v_code IS NOT NULL),'description_set',(v_description IS NOT NULL),'owner_set',(_owner_id IS NOT NULL)));
  v_result:=jsonb_build_object('ok',true,'outcome','applied','portfolioId',v_portfolio_id);
  PERFORM api_e_private.complete_idempotency(v_claim.registry_id,v_result); RETURN v_result;
END;$function$;
REVOKE ALL ON FUNCTION api_e_private.execute_v1_create_portfolio(text,text,uuid,text,text,text,text,text,uuid,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION api_e_private.execute_v1_create_portfolio(text,text,uuid,text,text,text,text,text,uuid,text,text,text,text) FROM anon;
REVOKE ALL ON FUNCTION api_e_private.execute_v1_create_portfolio(text,text,uuid,text,text,text,text,text,uuid,text,text,text,text) FROM authenticated;
REVOKE ALL ON FUNCTION api_e_private.execute_v1_create_portfolio(text,text,uuid,text,text,text,text,text,uuid,text,text,text,text) FROM service_role;

CREATE OR REPLACE FUNCTION api_e_private.execute_v1_update_portfolio(
  _execution_source text,_expected_oauth_client_id text,_portfolio_item_id uuid,_expected_updated_at timestamptz,
  _name text,_set_name boolean,_code text,_set_code boolean,_description text,_set_description boolean,
  _lifecycle_state text,_set_lifecycle_state boolean,_strategic_priority text,_set_strategic_priority boolean,
  _owner_id uuid,_set_owner_id boolean,_request_id text,_correlation_id text,_idempotency_key text,_payload_hash text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog','public' AS $function$
DECLARE
  c_api_version constant text:='v1';c_capability_kind constant text:='command';c_capability_key constant text:='portfolios:update';
  v_source text:=_execution_source;v_source_channel public.pmg_source_channel;v_name text:=nullif(btrim(coalesce(_name,'')),'');
  v_portfolio_id uuid;v_organization_id uuid;v_trusted boolean:=false;v_ctx_user_id uuid;v_ctx_client_id uuid;v_ctx_tenant_id uuid;v_ctx_org_id uuid;v_ctx_workspace_id uuid;v_claim record;
  v_locked_organization_id uuid;v_locked_updated_at timestamptz;v_cur_name text;v_cur_code text;v_cur_description text;v_cur_lifecycle_state text;v_cur_strategic_priority text;v_cur_owner_id uuid;
  v_eff_name text;v_eff_code text;v_eff_description text;v_eff_lifecycle_state text;v_eff_strategic_priority text;v_eff_owner_id uuid;v_new_org uuid;v_new_updated_at timestamptz;v_result jsonb;
BEGIN
  IF v_source IS NULL OR v_source NOT IN ('external_api','mcp') THEN RETURN jsonb_build_object('ok',false,'outcome','not_authorized'); END IF;
  v_source_channel:=CASE WHEN v_source='external_api' THEN 'external_api'::public.pmg_source_channel ELSE 'mcp'::public.pmg_source_channel END;
  IF nullif(btrim(coalesce(_expected_oauth_client_id,'')),'') IS NULL OR _portfolio_item_id IS NULL OR _expected_updated_at IS NULL
     OR _set_name IS NULL OR _set_code IS NULL OR _set_description IS NULL OR _set_lifecycle_state IS NULL OR _set_strategic_priority IS NULL OR _set_owner_id IS NULL
     OR coalesce(nullif(btrim(coalesce(_request_id,'')),''),'') !~ '^[A-Za-z0-9._~:@/-]{1,128}$'
     OR coalesce(nullif(btrim(coalesce(_correlation_id,'')),''),'') !~ '^[A-Za-z0-9._~:@/-]{1,128}$'
     OR coalesce(nullif(btrim(coalesce(_idempotency_key,'')),''),'') !~ '^[A-Za-z0-9._~:@/+!=-]{1,255}$'
     OR coalesce(_payload_hash,'') !~ '^[0-9a-f]{64}$' THEN RETURN jsonb_build_object('ok',false,'outcome','invalid'); END IF;
  IF NOT(_set_name OR _set_code OR _set_description OR _set_lifecycle_state OR _set_strategic_priority OR _set_owner_id) THEN RETURN jsonb_build_object('ok',false,'outcome','invalid'); END IF;
  IF (_set_name IS NOT TRUE AND _name IS NOT NULL) OR (_set_code IS NOT TRUE AND _code IS NOT NULL) OR (_set_description IS NOT TRUE AND _description IS NOT NULL)
     OR (_set_lifecycle_state IS NOT TRUE AND _lifecycle_state IS NOT NULL) OR (_set_strategic_priority IS NOT TRUE AND _strategic_priority IS NOT NULL) OR (_set_owner_id IS NOT TRUE AND _owner_id IS NOT NULL)
  THEN RETURN jsonb_build_object('ok',false,'outcome','invalid'); END IF;
  IF _set_name AND (v_name IS NULL OR length(v_name)>200) THEN RETURN jsonb_build_object('ok',false,'outcome','invalid'); END IF;
  IF _set_code AND _code IS NOT NULL AND length(_code)>80 THEN RETURN jsonb_build_object('ok',false,'outcome','invalid'); END IF;
  IF _set_description AND _description IS NOT NULL AND length(_description)>4000 THEN RETURN jsonb_build_object('ok',false,'outcome','invalid'); END IF;
  IF _set_lifecycle_state AND (_lifecycle_state IS NULL OR _lifecycle_state NOT IN ('opportunity_candidate','business_case_approved','contracted','development','submission_approval','launch_preparation','launched_commercial','lcm_optimization','on_hold','discontinuation','retired')) THEN RETURN jsonb_build_object('ok',false,'outcome','invalid'); END IF;
  IF _set_strategic_priority AND (_strategic_priority IS NULL OR _strategic_priority NOT IN ('critical','high','medium','low','watchlist')) THEN RETURN jsonb_build_object('ok',false,'outcome','invalid'); END IF;
  SELECT pi.id,pi.organization_id INTO v_portfolio_id,v_organization_id FROM public.portfolio_items pi WHERE pi.id=_portfolio_item_id;
  IF v_portfolio_id IS NULL OR v_organization_id IS NULL THEN RETURN jsonb_build_object('ok',false,'outcome','not_authorized'); END IF;
  IF v_source='external_api' THEN BEGIN v_trusted:=api_e_private.authorize_and_establish(_expected_oauth_client_id,v_organization_id,NULL,c_api_version,c_capability_kind,c_capability_key,_request_id); EXCEPTION WHEN OTHERS THEN v_trusted:=false; END;
  ELSE BEGIN v_trusted:=api_e_private.authorize_and_establish_mcp(_expected_oauth_client_id,v_organization_id,NULL,c_api_version,c_capability_kind,c_capability_key,_request_id); EXCEPTION WHEN OTHERS THEN v_trusted:=false; END; END IF;
  IF v_trusted IS NOT TRUE THEN RETURN jsonb_build_object('ok',false,'outcome','not_authorized'); END IF;
  BEGIN v_ctx_user_id:=nullif(btrim(coalesce(current_setting('api_e.executing_user_id',true),'')),'')::uuid;v_ctx_client_id:=nullif(btrim(coalesce(current_setting('api_e.api_client_id',true),'')),'')::uuid;v_ctx_tenant_id:=nullif(btrim(coalesce(current_setting('api_e.tenant_id',true),'')),'')::uuid;v_ctx_org_id:=nullif(btrim(coalesce(current_setting('api_e.organization_id',true),'')),'')::uuid;v_ctx_workspace_id:=nullif(btrim(coalesce(current_setting('api_e.workspace_id',true),'')),'')::uuid; EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok',false,'outcome','not_authorized'); END;
  IF v_ctx_user_id IS NULL OR v_ctx_client_id IS NULL OR v_ctx_tenant_id IS NULL OR v_ctx_workspace_id IS NOT NULL OR v_ctx_org_id IS DISTINCT FROM v_organization_id
     OR coalesce(nullif(btrim(coalesce(current_setting('api_e.api_version',true),'')),''),'')<>c_api_version OR coalesce(nullif(btrim(coalesce(current_setting('api_e.capability_kind',true),'')),''),'')<>c_capability_kind
     OR coalesce(nullif(btrim(coalesce(current_setting('api_e.capability_key',true),'')),''),'')<>c_capability_key OR coalesce(nullif(btrim(coalesce(current_setting('api_e.source_channel',true),'')),''),'') IS DISTINCT FROM v_source
     OR coalesce(nullif(btrim(coalesce(current_setting('api_e.trusted',true),'')),''),'')<>'true' THEN RETURN jsonb_build_object('ok',false,'outcome','not_authorized'); END IF;
  IF public.is_org_admin(v_ctx_user_id,v_organization_id) IS NOT TRUE THEN RETURN jsonb_build_object('ok',false,'outcome','not_authorized'); END IF;
  SELECT c.decision,c.registry_id,c.registry_state,c.canonical_result,c.failure_code INTO v_claim FROM api_e_private.claim_idempotency(c_capability_key,_idempotency_key,_payload_hash)c;
  IF v_claim.decision IS NULL THEN RAISE EXCEPTION 'execute_v1_update_portfolio: no idempotency claim decision' USING ERRCODE='XX000'; END IF;
  IF v_claim.decision='conflict' THEN RETURN jsonb_build_object('ok',false,'outcome','idempotency_conflict'); ELSIF v_claim.decision='pending' THEN RETURN jsonb_build_object('ok',false,'outcome','idempotency_pending');
  ELSIF v_claim.decision='replay' THEN
    IF v_claim.registry_state='completed' THEN IF v_claim.canonical_result IS NULL OR jsonb_typeof(v_claim.canonical_result)<>'object' THEN RAISE EXCEPTION 'execute_v1_update_portfolio: invalid stored canonical result' USING ERRCODE='XX000'; END IF; RETURN v_claim.canonical_result||jsonb_build_object('outcome','replayed');
    ELSIF v_claim.registry_state='failed' THEN IF v_claim.failure_code='stale_portfolio' THEN RETURN jsonb_build_object('ok',false,'outcome','conflict','code','stale_portfolio'); ELSIF v_claim.failure_code='not_authorized' THEN RETURN jsonb_build_object('ok',false,'outcome','not_authorized'); ELSIF v_claim.failure_code='invalid' THEN RETURN jsonb_build_object('ok',false,'outcome','invalid'); END IF; RAISE EXCEPTION 'execute_v1_update_portfolio: unknown persisted failure code' USING ERRCODE='XX000'; END IF;
    RAISE EXCEPTION 'execute_v1_update_portfolio: unexpected replay state' USING ERRCODE='XX000';
  ELSIF v_claim.decision<>'execute' THEN RAISE EXCEPTION 'execute_v1_update_portfolio: unexpected idempotency decision' USING ERRCODE='XX000'; END IF;
  SELECT pi.organization_id,pi.updated_at,public.btpm_decrypt(pi.name,pi.organization_id),public.btpm_decrypt(pi.code,pi.organization_id),public.btpm_decrypt(pi.description,pi.organization_id),pi.lifecycle_state,pi.strategic_priority,pi.owner_id
    INTO v_locked_organization_id,v_locked_updated_at,v_cur_name,v_cur_code,v_cur_description,v_cur_lifecycle_state,v_cur_strategic_priority,v_cur_owner_id FROM public.portfolio_items pi WHERE pi.id=v_portfolio_id FOR UPDATE;
  IF v_locked_organization_id IS DISTINCT FROM v_organization_id THEN PERFORM api_e_private.fail_idempotency(v_claim.registry_id,'not_authorized'); RETURN jsonb_build_object('ok',false,'outcome','not_authorized'); END IF;
  IF v_locked_updated_at IS DISTINCT FROM _expected_updated_at THEN PERFORM api_e_private.fail_idempotency(v_claim.registry_id,'stale_portfolio'); RETURN jsonb_build_object('ok',false,'outcome','conflict','code','stale_portfolio'); END IF;
  v_eff_name:=CASE WHEN _set_name THEN v_name ELSE v_cur_name END;v_eff_code:=CASE WHEN _set_code THEN _code ELSE v_cur_code END;v_eff_description:=CASE WHEN _set_description THEN _description ELSE v_cur_description END;
  v_eff_lifecycle_state:=CASE WHEN _set_lifecycle_state THEN _lifecycle_state ELSE v_cur_lifecycle_state END;v_eff_strategic_priority:=CASE WHEN _set_strategic_priority THEN _strategic_priority ELSE v_cur_strategic_priority END;v_eff_owner_id:=CASE WHEN _set_owner_id THEN _owner_id ELSE v_cur_owner_id END;
  IF v_eff_owner_id IS NOT NULL AND public.is_user_org_member(v_eff_owner_id,v_organization_id) IS NOT TRUE THEN PERFORM api_e_private.fail_idempotency(v_claim.registry_id,'invalid'); RETURN jsonb_build_object('ok',false,'outcome','invalid'); END IF;
  PERFORM public.admin_update_portfolio_item(v_portfolio_id,v_eff_name,v_eff_code,v_eff_description,v_eff_lifecycle_state,v_eff_owner_id,v_eff_strategic_priority);
  SELECT pi.organization_id,pi.updated_at INTO v_new_org,v_new_updated_at FROM public.portfolio_items pi WHERE pi.id=v_portfolio_id;
  IF v_new_updated_at IS NULL OR v_new_org IS DISTINCT FROM v_organization_id THEN RAISE EXCEPTION 'execute_v1_update_portfolio: inconsistent canonical update result' USING ERRCODE='XX000'; END IF;
  PERFORM public.pmg_record_command_audit('applied'::public.pmg_command_status,'admin_update_portfolio_item',v_source_channel,NULL::uuid,'portfolio',v_portfolio_id,NULL::uuid,_correlation_id,_idempotency_key,
    jsonb_build_object('organization_id',v_organization_id,'set_name',_set_name,'set_code',_set_code,'set_description',_set_description,'set_lifecycle_state',_set_lifecycle_state,'set_strategic_priority',_set_strategic_priority,'set_owner_id',_set_owner_id));
  v_result:=jsonb_build_object('ok',true,'outcome','applied','portfolioId',v_portfolio_id,'updatedAt',v_new_updated_at);PERFORM api_e_private.complete_idempotency(v_claim.registry_id,v_result);RETURN v_result;
END;$function$;
REVOKE ALL ON FUNCTION api_e_private.execute_v1_update_portfolio(text,text,uuid,timestamptz,text,boolean,text,boolean,text,boolean,text,boolean,text,boolean,uuid,boolean,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION api_e_private.execute_v1_update_portfolio(text,text,uuid,timestamptz,text,boolean,text,boolean,text,boolean,text,boolean,text,boolean,uuid,boolean,text,text,text,text) FROM anon;
REVOKE ALL ON FUNCTION api_e_private.execute_v1_update_portfolio(text,text,uuid,timestamptz,text,boolean,text,boolean,text,boolean,text,boolean,text,boolean,uuid,boolean,text,text,text,text) FROM authenticated;
REVOKE ALL ON FUNCTION api_e_private.execute_v1_update_portfolio(text,text,uuid,timestamptz,text,boolean,text,boolean,text,boolean,text,boolean,text,boolean,uuid,boolean,text,text,text,text) FROM service_role;
