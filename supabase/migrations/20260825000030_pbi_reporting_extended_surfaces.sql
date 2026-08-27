-- BTPM OSS baseline: extended tenant-bound Power BI reporting surfaces.

CREATE OR REPLACE FUNCTION pbi_reporting_security.list_reporting_portfolio_items()
RETURNS TABLE(portfolio_item_id uuid,tenant_id uuid,organization_id uuid,portfolio_item_name text,portfolio_item_code text,lifecycle_state text,strategic_priority text,owner_id uuid,owner_display_name text,is_archived boolean,archived_at timestamptz,created_at timestamptz,updated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pbi_reporting_security','pbi_reporting','pg_catalog'
AS $function$
  WITH ctx AS (SELECT pbi_reporting_security.resolve_current_tenant() AS tenant_id)
  SELECT pi.id,o.tenant_id,pi.organization_id,public.btpm_decrypt(pi.name,pi.organization_id),public.btpm_decrypt(pi.code,pi.organization_id),
         pi.lifecycle_state,pi.strategic_priority,pi.owner_id,public.btpm_decrypt(pr.display_name,pr.organization_id),pi.is_archived,pi.archived_at,pi.created_at,pi.updated_at
  FROM public.portfolio_items pi JOIN public.organizations o ON o.id=pi.organization_id
  JOIN ctx ON ctx.tenant_id IS NOT NULL AND o.tenant_id=ctx.tenant_id
  LEFT JOIN public.profiles pr ON pr.id=pi.owner_id AND pr.organization_id=pi.organization_id
  WHERE EXISTS (SELECT 1 FROM public.projects p JOIN pbi_reporting._scope_projects sp ON sp.organization_id=p.organization_id AND sp.workspace_id=p.workspace_id AND sp.project_id=p.id WHERE p.portfolio_item_id=pi.id AND p.organization_id=pi.organization_id);
$function$;

CREATE OR REPLACE FUNCTION pbi_reporting_security.list_reporting_project_benefits()
RETURNS TABLE(benefit_id uuid,tenant_id uuid,organization_id uuid,workspace_id uuid,project_id uuid,benefit_type text,custom_benefit_type_label text,metric_name text,unit_of_measure text,baseline_value numeric,target_value numeric,actual_value numeric,realization_status text,expected_realization_date date,actual_realization_date date,benefit_owner_id uuid,benefit_owner_display_name text,is_archived boolean,archived_at timestamptz,created_at timestamptz,updated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pbi_reporting_security','pbi_reporting','pg_catalog'
AS $function$
  WITH ctx AS (SELECT pbi_reporting_security.resolve_current_tenant() AS tenant_id)
  SELECT b.id,o.tenant_id,b.organization_id,b.workspace_id,b.project_id,b.benefit_type,
         CASE WHEN b.custom_benefit_type_label IS NULL THEN NULL ELSE public.btpm_decrypt(b.custom_benefit_type_label,b.organization_id) END,
         public.btpm_decrypt(b.metric_name,b.organization_id),b.unit_of_measure,b.baseline_value,b.target_value,b.actual_value,b.realization_status,
         b.expected_realization_date,b.actual_realization_date,b.benefit_owner_id,public.btpm_decrypt(pr.display_name,pr.organization_id),
         (b.archived_at IS NOT NULL),b.archived_at,b.created_at,b.updated_at
  FROM public.project_benefits b
  JOIN pbi_reporting._scope_projects sp ON sp.organization_id=b.organization_id AND sp.workspace_id=b.workspace_id AND sp.project_id=b.project_id
  JOIN public.organizations o ON o.id=b.organization_id JOIN ctx ON ctx.tenant_id IS NOT NULL AND o.tenant_id=ctx.tenant_id
  LEFT JOIN public.profiles pr ON pr.id=b.benefit_owner_id AND pr.organization_id=b.organization_id;
$function$;

CREATE OR REPLACE FUNCTION pbi_reporting_security.list_reporting_project_team()
RETURNS TABLE(project_team_member_id uuid,tenant_id uuid,organization_id uuid,workspace_id uuid,project_id uuid,user_id uuid,canonical_role_key text,role_label text,created_at timestamptz,updated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pbi_reporting_security','pbi_reporting','pg_catalog'
AS $function$
  WITH ctx AS (SELECT pbi_reporting_security.resolve_current_tenant() AS tenant_id)
  SELECT ptm.id,o.tenant_id,ptm.organization_id,ptm.workspace_id,ptm.project_id,ptm.user_id,ptm.canonical_role_key,
         CASE WHEN ptm.role_label IS NULL THEN NULL ELSE public.btpm_decrypt(ptm.role_label,ptm.organization_id) END,ptm.created_at,ptm.updated_at
  FROM public.project_team_members ptm
  JOIN pbi_reporting._scope_projects sp ON sp.organization_id=ptm.organization_id AND sp.workspace_id=ptm.workspace_id AND sp.project_id=ptm.project_id
  JOIN public.organizations o ON o.id=ptm.organization_id JOIN ctx ON ctx.tenant_id IS NOT NULL AND o.tenant_id=ctx.tenant_id;
$function$;

CREATE OR REPLACE FUNCTION pbi_reporting_security.list_reporting_project_stakeholders()
RETURNS TABLE(stakeholder_id uuid,tenant_id uuid,organization_id uuid,workspace_id uuid,project_id uuid,stakeholder_type text,user_id uuid,external_name text,role_label text,start_date date,is_removed boolean,removed_at timestamptz,created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pbi_reporting_security','pbi_reporting','pg_catalog'
AS $function$
  WITH ctx AS (SELECT pbi_reporting_security.resolve_current_tenant() AS tenant_id)
  SELECT s.id,o.tenant_id,s.organization_id,s.workspace_id,s.project_id,s.stakeholder_type,s.user_id,
         CASE WHEN s.stakeholder_type='external' THEN s.external_name ELSE NULL END,s.role_label,s.start_date,(s.removed_at IS NOT NULL),s.removed_at,s.created_at
  FROM public.project_stakeholders s
  JOIN pbi_reporting._scope_projects sp ON sp.organization_id=s.organization_id AND sp.workspace_id=s.workspace_id AND sp.project_id=s.project_id
  JOIN public.organizations o ON o.id=s.organization_id JOIN ctx ON ctx.tenant_id IS NOT NULL AND o.tenant_id=ctx.tenant_id;
$function$;

CREATE OR REPLACE VIEW pbi_reporting.dim_portfolio_item WITH (security_barrier=true) AS SELECT * FROM pbi_reporting_security.list_reporting_portfolio_items();
CREATE OR REPLACE VIEW pbi_reporting.fact_project_benefits WITH (security_barrier=true) AS SELECT * FROM pbi_reporting_security.list_reporting_project_benefits();
CREATE OR REPLACE VIEW pbi_reporting.bridge_project_team WITH (security_barrier=true) AS SELECT * FROM pbi_reporting_security.list_reporting_project_team();
CREATE OR REPLACE VIEW pbi_reporting.bridge_project_stakeholders WITH (security_barrier=true) AS SELECT * FROM pbi_reporting_security.list_reporting_project_stakeholders();

CREATE OR REPLACE VIEW pbi_reporting.bridge_task_assignees WITH (security_barrier=true) AS
SELECT ta.id AS task_assignment_id,o.tenant_id,ta.organization_id,ta.workspace_id,t.project_id,t.phase_id,ta.task_id,ta.assignee_id,ta.created_at,ta.updated_at
FROM public.task_assignments ta
JOIN public.tasks t ON t.id=ta.task_id AND t.organization_id=ta.organization_id AND t.workspace_id=ta.workspace_id
JOIN pbi_reporting._scope_projects sp ON sp.organization_id=t.organization_id AND sp.workspace_id=t.workspace_id AND sp.project_id=t.project_id
JOIN public.organizations o ON o.id=ta.organization_id
WHERE o.tenant_id=pbi_reporting_security.resolve_current_tenant();

CREATE OR REPLACE VIEW pbi_reporting.bridge_raci_assignments WITH (security_barrier=true) AS
SELECT ra.id AS raci_assignment_id,o.tenant_id,ra.organization_id,ra.workspace_id,p.id AS project_id,
       CASE WHEN ra.target_type='phase' THEN ph.id ELSE NULL END AS phase_id,ra.target_type::text AS target_type,ra.target_id,ra.raci_role::text AS raci_role,
       CASE WHEN ps.id IS NOT NULL AND ps.stakeholder_type='workspace_member' THEN ps.user_id WHEN ra.stakeholder_id IS NULL THEN ra.user_id ELSE NULL END AS user_id,
       ra.stakeholder_id,ra.created_at,ra.updated_at
FROM public.raci_assignments ra
LEFT JOIN public.phases ph ON ra.target_type='phase' AND ph.id=ra.target_id AND ph.organization_id=ra.organization_id AND ph.workspace_id=ra.workspace_id
JOIN public.projects p ON p.id=CASE WHEN ra.target_type='project' THEN ra.target_id WHEN ra.target_type='phase' THEN ph.project_id END
 AND p.organization_id=ra.organization_id AND p.workspace_id=ra.workspace_id
LEFT JOIN public.project_stakeholders ps ON ps.id=ra.stakeholder_id AND ps.project_id=p.id AND ps.organization_id=ra.organization_id AND ps.workspace_id=ra.workspace_id
JOIN pbi_reporting._scope_projects sp ON sp.organization_id=p.organization_id AND sp.workspace_id=p.workspace_id AND sp.project_id=p.id
JOIN public.organizations o ON o.id=ra.organization_id
WHERE ra.target_type IN ('project','phase') AND (ra.stakeholder_id IS NULL OR ps.id IS NOT NULL)
  AND o.tenant_id=pbi_reporting_security.resolve_current_tenant();

CREATE OR REPLACE VIEW pbi_reporting.bridge_task_stakeholder_roles WITH (security_barrier=true) AS
SELECT p.organization_id,p.workspace_id,p.id AS project_id,tsr.task_id,tsr.project_stakeholder_id AS stakeholder_id,tsr.role_type::text AS role
FROM public.task_stakeholder_roles tsr
JOIN public.tasks t ON t.id=tsr.task_id
JOIN public.projects p ON p.id=t.project_id AND p.organization_id=t.organization_id AND p.workspace_id=t.workspace_id
JOIN public.project_stakeholders ps ON ps.id=tsr.project_stakeholder_id AND ps.project_id=p.id AND ps.organization_id=p.organization_id AND ps.workspace_id=p.workspace_id
JOIN pbi_reporting._scope_projects sp ON sp.organization_id=p.organization_id AND sp.workspace_id=p.workspace_id AND sp.project_id=p.id
JOIN public.organizations o ON o.id=p.organization_id
WHERE o.tenant_id=pbi_reporting_security.resolve_current_tenant();

CREATE OR REPLACE VIEW pbi_reporting.v2_fact_dependencies WITH (security_barrier=true) AS
WITH endpoint AS (
 SELECT d.id,'source'::text AS side,d.source_type AS etype,d.source_id AS eid FROM public.dependencies d
 UNION ALL SELECT d.id,'target',d.target_type,d.target_id FROM public.dependencies d
), resolved AS (
 SELECT e.id,e.side,
   CASE e.etype WHEN 'project' THEN e.eid WHEN 'phase' THEN ph.project_id WHEN 'task' THEN t.project_id ELSE NULL END AS project_id,
   CASE e.etype WHEN 'project' THEN pp.name WHEN 'phase' THEN ph.name WHEN 'task' THEN t.name ELSE NULL END AS object_name,
   CASE e.etype WHEN 'project' THEN pp.name WHEN 'phase' THEN php.name WHEN 'task' THEN tpp.name ELSE NULL END AS project_name
 FROM endpoint e LEFT JOIN public.phases ph ON e.etype='phase' AND ph.id=e.eid LEFT JOIN public.tasks t ON e.etype='task' AND t.id=e.eid
 LEFT JOIN public.projects pp ON e.etype='project' AND pp.id=e.eid LEFT JOIN public.projects php ON e.etype='phase' AND php.id=ph.project_id LEFT JOIN public.projects tpp ON e.etype='task' AND tpp.id=t.project_id
)
SELECT d.id AS dependency_id,d.organization_id,d.workspace_id,w.name AS workspace_name,d.source_type,d.source_id,rs.object_name AS source_name,rs.project_id AS source_project_id,rs.project_name AS source_project_name,
       d.target_type,d.target_id,rt.object_name AS target_name,rt.project_id AS target_project_id,rt.project_name AS target_project_name,d.dependency_type::text AS dependency_type,d.created_at,d.updated_at,now() AS data_as_of_utc,o.tenant_id
FROM public.dependencies d JOIN public.workspaces w ON w.id=d.workspace_id JOIN resolved rs ON rs.id=d.id AND rs.side='source' JOIN resolved rt ON rt.id=d.id AND rt.side='target'
JOIN public.organizations o ON o.id=d.organization_id
WHERE o.tenant_id=pbi_reporting_security.resolve_current_tenant()
 AND EXISTS (SELECT 1 FROM pbi_reporting._scope_projects sp WHERE sp.organization_id=d.organization_id AND sp.project_id=rs.project_id)
 AND EXISTS (SELECT 1 FROM pbi_reporting._scope_projects sp WHERE sp.organization_id=d.organization_id AND sp.project_id=rt.project_id);

CREATE OR REPLACE VIEW pbi_reporting.v2_fact_governance_records WITH (security_barrier=true) AS
SELECT gr.id AS governance_record_id,gr.organization_id,gr.workspace_id,w.name AS workspace_name,gr.project_id,p.name AS project_name,gr.cadence_id,gr.event_type,gr.event_name,
       gr.expected_date_snapshot,gr.actual_date_held,(gr.expected_date_snapshot IS NOT NULL AND gr.actual_date_held<=gr.expected_date_snapshot) AS is_on_time,
       CASE WHEN gr.expected_date_snapshot IS NOT NULL AND gr.actual_date_held>gr.expected_date_snapshot THEN gr.actual_date_held-gr.expected_date_snapshot ELSE 0 END AS days_late,
       (gr.sharepoint_evidence_reference IS NOT NULL) AS has_sharepoint_evidence,(gr.external_reference_url IS NOT NULL) AS has_external_reference,
       gr.archived_at,gr.created_at,gr.updated_at,now() AS data_as_of_utc,o.tenant_id
FROM public.governance_records gr
JOIN pbi_reporting._scope_projects sp ON sp.organization_id=gr.organization_id AND sp.workspace_id=gr.workspace_id AND sp.project_id=gr.project_id
JOIN public.workspaces w ON w.id=gr.workspace_id JOIN public.projects p ON p.id=gr.project_id JOIN public.organizations o ON o.id=gr.organization_id
WHERE o.tenant_id=pbi_reporting_security.resolve_current_tenant();

DO $acl$
DECLARE v_name text;v_role text;v_fn text;
BEGIN
 FOREACH v_fn IN ARRAY ARRAY[
  'pbi_reporting_security.list_reporting_portfolio_items()',
  'pbi_reporting_security.list_reporting_project_benefits()',
  'pbi_reporting_security.list_reporting_project_team()',
  'pbi_reporting_security.list_reporting_project_stakeholders()'
 ] LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',v_fn);
  FOREACH v_role IN ARRAY ARRAY['anon','authenticated','service_role','pbi_reader'] LOOP IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=v_role) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',v_fn,v_role); END IF; END LOOP;
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO btpm_pbi_reader',v_fn);
 END LOOP;
 FOREACH v_name IN ARRAY ARRAY['dim_portfolio_item','fact_project_benefits','bridge_project_team','bridge_project_stakeholders','bridge_task_assignees','bridge_raci_assignments','bridge_task_stakeholder_roles','v2_fact_dependencies','v2_fact_governance_records'] LOOP
  EXECUTE format('REVOKE ALL ON pbi_reporting.%I FROM PUBLIC',v_name);
  FOREACH v_role IN ARRAY ARRAY['anon','authenticated','service_role','pbi_reader'] LOOP IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=v_role) THEN EXECUTE format('REVOKE ALL ON pbi_reporting.%I FROM %I',v_name,v_role); END IF; END LOOP;
  EXECUTE format('GRANT SELECT ON pbi_reporting.%I TO btpm_pbi_reader',v_name);
 END LOOP;
END
$acl$;
