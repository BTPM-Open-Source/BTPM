-- BTPM OSS baseline: protected tenant reporting surfaces.
--
-- Protected plaintext is exposed only inside tightly scoped SECURITY DEFINER
-- functions. The shared reporting role cannot execute btpm_decrypt directly.

CREATE OR REPLACE FUNCTION pbi_reporting_security.list_reporting_users()
RETURNS TABLE(user_id uuid,tenant_id uuid,organization_id uuid,display_name text,is_active boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'pbi_reporting_security','pbi_reporting','pg_catalog'
AS $function$
  WITH ctx AS (SELECT pbi_reporting_security.resolve_current_tenant() AS tenant_id), refs AS (
    SELECT t.owner_id AS uid,t.organization_id AS org_id FROM public.tasks t
      WHERE t.owner_id IS NOT NULL AND EXISTS (SELECT 1 FROM pbi_reporting._scope_projects s WHERE s.organization_id=t.organization_id AND s.project_id=t.project_id)
    UNION SELECT b.reported_by,b.organization_id FROM public.blockers b
      WHERE b.reported_by IS NOT NULL AND EXISTS (SELECT 1 FROM pbi_reporting._scope_workspaces s WHERE s.organization_id=b.organization_id AND s.workspace_id=b.workspace_id)
    UNION SELECT b.resolved_by,b.organization_id FROM public.blockers b
      WHERE b.resolved_by IS NOT NULL AND EXISTS (SELECT 1 FROM pbi_reporting._scope_workspaces s WHERE s.organization_id=b.organization_id AND s.workspace_id=b.workspace_id)
    UNION SELECT r.reported_by,r.organization_id FROM public.risks r
      WHERE r.reported_by IS NOT NULL AND EXISTS (SELECT 1 FROM pbi_reporting._scope_workspaces s WHERE s.organization_id=r.organization_id AND s.workspace_id=r.workspace_id)
    UNION SELECT gc.owner_id,gc.organization_id FROM public.governance_cadences gc
      WHERE gc.owner_id IS NOT NULL AND EXISTS (SELECT 1 FROM pbi_reporting._scope_projects s WHERE s.organization_id=gc.organization_id AND s.project_id=gc.project_id)
    UNION SELECT p.baseline_approved_by,p.organization_id FROM public.projects p
      WHERE p.baseline_approved_by IS NOT NULL AND EXISTS (SELECT 1 FROM pbi_reporting._scope_projects s WHERE s.organization_id=p.organization_id AND s.project_id=p.id)
    UNION SELECT b.benefit_owner_id,b.organization_id FROM public.project_benefits b
      WHERE b.benefit_owner_id IS NOT NULL AND EXISTS (SELECT 1 FROM pbi_reporting._scope_projects s WHERE s.organization_id=b.organization_id AND s.workspace_id=b.workspace_id AND s.project_id=b.project_id)
    UNION SELECT ptm.user_id,ptm.organization_id FROM public.project_team_members ptm
      WHERE EXISTS (SELECT 1 FROM pbi_reporting._scope_projects s WHERE s.organization_id=ptm.organization_id AND s.workspace_id=ptm.workspace_id AND s.project_id=ptm.project_id)
    UNION SELECT ps.user_id,ps.organization_id FROM public.project_stakeholders ps
      WHERE ps.stakeholder_type='workspace_member' AND ps.user_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM pbi_reporting._scope_projects s WHERE s.organization_id=ps.organization_id AND s.workspace_id=ps.workspace_id AND s.project_id=ps.project_id)
    UNION SELECT ta.assignee_id,ta.organization_id FROM public.task_assignments ta JOIN public.tasks t ON t.id=ta.task_id
      WHERE EXISTS (SELECT 1 FROM pbi_reporting._scope_projects s WHERE s.organization_id=t.organization_id AND s.workspace_id=t.workspace_id AND s.project_id=t.project_id)
  )
  SELECT DISTINCT pr.id,o.tenant_id,refs.org_id,public.btpm_decrypt(pr.display_name,pr.organization_id),pr.is_active
  FROM refs JOIN public.profiles pr ON pr.id=refs.uid AND pr.organization_id=refs.org_id
  JOIN public.organizations o ON o.id=refs.org_id JOIN ctx ON ctx.tenant_id IS NOT NULL AND o.tenant_id=ctx.tenant_id;
$function$;

CREATE OR REPLACE FUNCTION pbi_reporting_security.list_reporting_tasks()
RETURNS TABLE(task_id uuid,organization_id uuid,workspace_id uuid,workspace_name text,project_id uuid,project_name text,phase_id uuid,phase_name text,task_name text,task_type text,task_status text,task_priority text,priority_sort integer,owner_id uuid,owner_display_name text,workflow_state_id uuid,backlog_item_id uuid,estimated_hours numeric,sort_order integer,is_archived boolean,added_after_baseline boolean,planned_start_date date,planned_end_date date,due_date date,baseline_start_date date,baseline_end_date date,actual_start_date date,actual_end_date date,schedule_start_date date,schedule_end_date date,planned_duration_days integer,baseline_duration_days integer,actual_duration_days integer,baseline_variance_days integer,actual_finish_variance_days integer,is_overdue boolean,days_overdue integer,is_milestone boolean,created_at timestamptz,updated_at timestamptz,tenant_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'pbi_reporting_security','pbi_reporting','pg_catalog'
AS $function$
  WITH ctx AS (SELECT pbi_reporting_security.resolve_current_tenant() AS tenant_id)
  SELECT t.id,t.organization_id,t.workspace_id,w.name,t.project_id,p.name,t.phase_id,ph.name,t.name,
         t.task_type::text,t.status::text,t.priority::text,
         CASE t.priority::text WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE NULL END,
         t.owner_id,public.btpm_decrypt(pr.display_name,pr.organization_id),t.workflow_state_id,t.backlog_item_id,t.estimated_hours,t.sort_order,t.is_archived,t.added_after_baseline,
         t.start_date,t.due_date,t.due_date,t.baseline_start_date,t.baseline_end_date,t.actual_start_date,t.actual_end_date,
         COALESCE(t.actual_start_date,t.start_date,t.baseline_start_date),COALESCE(t.actual_end_date,t.due_date,t.baseline_end_date),
         (t.due_date-t.start_date),(t.baseline_end_date-t.baseline_start_date),(t.actual_end_date-t.actual_start_date),(t.due_date-t.baseline_end_date),(t.actual_end_date-t.baseline_end_date),
         (t.status::text <> ALL (ARRAY['completed','cancelled']) AND t.due_date IS NOT NULL AND t.due_date<CURRENT_DATE),
         CASE WHEN t.status::text <> ALL (ARRAY['completed','cancelled']) AND t.due_date IS NOT NULL AND t.due_date<CURRENT_DATE THEN CURRENT_DATE-t.due_date ELSE 0 END,
         (t.task_type::text='milestone' OR ph.phase_type::text='milestone'),t.created_at,t.updated_at,o.tenant_id
  FROM ctx JOIN public.tasks t ON TRUE
  JOIN pbi_reporting._scope_projects sp ON sp.organization_id=t.organization_id AND sp.workspace_id=t.workspace_id AND sp.project_id=t.project_id
  JOIN public.projects p ON p.id=t.project_id JOIN public.workspaces w ON w.id=t.workspace_id
  LEFT JOIN public.phases ph ON ph.id=t.phase_id LEFT JOIN public.profiles pr ON pr.id=t.owner_id
  JOIN public.organizations o ON o.id=t.organization_id
  WHERE ctx.tenant_id IS NOT NULL AND o.tenant_id=ctx.tenant_id;
$function$;

CREATE OR REPLACE FUNCTION pbi_reporting_security.list_reporting_blockers_current()
RETURNS TABLE(blocker_id uuid,organization_id uuid,workspace_id uuid,workspace_name text,target_type text,target_id uuid,project_id uuid,project_name text,phase_id uuid,phase_name text,task_id uuid,task_name text,blocker_status text,severity text,severity_sort integer,reported_by uuid,reported_by_display_name text,created_at timestamptz,updated_at timestamptz,resolved_at timestamptz,resolved_by uuid,age_days integer,is_open boolean,data_as_of_utc timestamptz,tenant_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'pbi_reporting_security','pbi_reporting','pg_catalog'
AS $function$
  WITH ctx AS (SELECT pbi_reporting_security.resolve_current_tenant() AS tenant_id)
  SELECT b.id,b.organization_id,b.workspace_id,w.name,b.target_type,b.target_id,
         CASE b.target_type WHEN 'project' THEN b.target_id WHEN 'phase' THEN ph.project_id WHEN 'task' THEN tk.project_id ELSE NULL END,p.name,
         CASE b.target_type WHEN 'phase' THEN b.target_id WHEN 'task' THEN tk.phase_id ELSE NULL END,ph2.name,
         CASE b.target_type WHEN 'task' THEN b.target_id ELSE NULL END,t2.name,b.status::text,b.severity::text,
         CASE b.severity::text WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE NULL END,
         b.reported_by,public.btpm_decrypt(pr.display_name,pr.organization_id),b.created_at,b.updated_at,b.resolved_at,b.resolved_by,
         (EXTRACT(epoch FROM COALESCE(b.resolved_at,now())-b.created_at)/86400::numeric)::integer,(b.status::text<>'resolved'),now(),o.tenant_id
  FROM ctx JOIN public.blockers b ON TRUE JOIN public.workspaces w ON w.id=b.workspace_id
  LEFT JOIN public.phases ph ON b.target_type='phase' AND ph.id=b.target_id
  LEFT JOIN public.tasks tk ON b.target_type='task' AND tk.id=b.target_id
  LEFT JOIN public.projects p ON p.id=CASE b.target_type WHEN 'project' THEN b.target_id WHEN 'phase' THEN ph.project_id WHEN 'task' THEN tk.project_id ELSE NULL END
  LEFT JOIN public.phases ph2 ON ph2.id=CASE b.target_type WHEN 'phase' THEN b.target_id WHEN 'task' THEN tk.phase_id ELSE NULL END
  LEFT JOIN public.tasks t2 ON b.target_type='task' AND t2.id=b.target_id LEFT JOIN public.profiles pr ON pr.id=b.reported_by
  JOIN public.organizations o ON o.id=b.organization_id
  WHERE ctx.tenant_id IS NOT NULL AND o.tenant_id=ctx.tenant_id AND EXISTS (
    SELECT 1 FROM pbi_reporting._scope_projects sp WHERE sp.organization_id=b.organization_id AND sp.project_id=CASE b.target_type WHEN 'project' THEN b.target_id WHEN 'phase' THEN ph.project_id WHEN 'task' THEN tk.project_id ELSE NULL END);
$function$;

CREATE OR REPLACE FUNCTION pbi_reporting_security.list_reporting_risks_current()
RETURNS TABLE(risk_id uuid,organization_id uuid,workspace_id uuid,workspace_name text,target_type text,target_id uuid,project_id uuid,project_name text,phase_id uuid,phase_name text,task_id uuid,task_name text,risk_status text,likelihood text,likelihood_sort integer,impact text,impact_sort integer,risk_score integer,reported_by uuid,reported_by_display_name text,created_at timestamptz,updated_at timestamptz,is_open boolean,data_as_of_utc timestamptz,tenant_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'pbi_reporting_security','pbi_reporting','pg_catalog'
AS $function$
  WITH ctx AS (SELECT pbi_reporting_security.resolve_current_tenant() AS tenant_id)
  SELECT r.id,r.organization_id,r.workspace_id,w.name,r.target_type,r.target_id,
         CASE r.target_type WHEN 'project' THEN r.target_id WHEN 'phase' THEN ph.project_id WHEN 'task' THEN tk.project_id ELSE NULL END,p.name,
         CASE r.target_type WHEN 'phase' THEN r.target_id WHEN 'task' THEN tk.phase_id ELSE NULL END,ph2.name,
         CASE r.target_type WHEN 'task' THEN r.target_id ELSE NULL END,t2.name,r.status::text,r.likelihood::text,
         CASE r.likelihood::text WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE NULL END,r.impact::text,
         CASE r.impact::text WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE NULL END,
         (CASE r.likelihood::text WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE NULL END)*(CASE r.impact::text WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE NULL END),
         r.reported_by,public.btpm_decrypt(pr.display_name,pr.organization_id),r.created_at,r.updated_at,(r.status::text <> ALL (ARRAY['closed','accepted'])),now(),o.tenant_id
  FROM ctx JOIN public.risks r ON TRUE JOIN public.workspaces w ON w.id=r.workspace_id
  LEFT JOIN public.phases ph ON r.target_type='phase' AND ph.id=r.target_id LEFT JOIN public.tasks tk ON r.target_type='task' AND tk.id=r.target_id
  LEFT JOIN public.projects p ON p.id=CASE r.target_type WHEN 'project' THEN r.target_id WHEN 'phase' THEN ph.project_id WHEN 'task' THEN tk.project_id ELSE NULL END
  LEFT JOIN public.phases ph2 ON ph2.id=CASE r.target_type WHEN 'phase' THEN r.target_id WHEN 'task' THEN tk.phase_id ELSE NULL END
  LEFT JOIN public.tasks t2 ON r.target_type='task' AND t2.id=r.target_id LEFT JOIN public.profiles pr ON pr.id=r.reported_by
  JOIN public.organizations o ON o.id=r.organization_id
  WHERE ctx.tenant_id IS NOT NULL AND o.tenant_id=ctx.tenant_id AND EXISTS (
    SELECT 1 FROM pbi_reporting._scope_projects sp WHERE sp.organization_id=r.organization_id AND sp.project_id=CASE r.target_type WHEN 'project' THEN r.target_id WHEN 'phase' THEN ph.project_id WHEN 'task' THEN tk.project_id ELSE NULL END);
$function$;

CREATE OR REPLACE FUNCTION pbi_reporting_security.list_reporting_governance_cadences()
RETURNS TABLE(cadence_id uuid,organization_id uuid,workspace_id uuid,workspace_name text,project_id uuid,project_name text,event_type text,event_name text,frequency_type text,next_expected_date date,expected_evidence_type text,owner_id uuid,owner_display_name text,is_active boolean,archived_at timestamptz,created_at timestamptz,updated_at timestamptz,data_as_of_utc timestamptz,tenant_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'pbi_reporting_security','pbi_reporting','pg_catalog'
AS $function$
  WITH ctx AS (SELECT pbi_reporting_security.resolve_current_tenant() AS tenant_id)
  SELECT gc.id,gc.organization_id,gc.workspace_id,w.name,gc.project_id,p.name,gc.event_type,gc.event_name,gc.frequency_type,gc.next_expected_date,gc.expected_evidence_type,gc.owner_id,
         public.btpm_decrypt(pr.display_name,pr.organization_id),(gc.archived_at IS NULL),gc.archived_at,gc.created_at,gc.updated_at,now(),o.tenant_id
  FROM ctx JOIN public.governance_cadences gc ON TRUE
  JOIN pbi_reporting._scope_projects sp ON sp.organization_id=gc.organization_id AND sp.workspace_id=gc.workspace_id AND sp.project_id=gc.project_id
  JOIN public.workspaces w ON w.id=gc.workspace_id JOIN public.projects p ON p.id=gc.project_id
  JOIN public.organizations o ON o.id=gc.organization_id LEFT JOIN public.profiles pr ON pr.id=gc.owner_id
  WHERE ctx.tenant_id IS NOT NULL AND o.tenant_id=ctx.tenant_id;
$function$;

CREATE OR REPLACE FUNCTION pbi_reporting_security.list_reporting_kpi_snapshot_values()
RETURNS TABLE(snapshot_id uuid,snapshot_captured_at timestamptz,snapshot_date date,period_start date,period_end date,kpi_definition_id uuid,organization_id uuid,workspace_id uuid,workspace_name text,project_id uuid,target_type text,target_id uuid,value_amount numeric,string_value text,value_type text,target_value numeric,unit text,target_direction text,source_mode text,calculation_status text,generated_by text,formula_version integer,data_as_of_utc timestamptz,tenant_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'pbi_reporting_security','pbi_reporting','pg_catalog'
AS $function$
  WITH ctx AS (SELECT pbi_reporting_security.resolve_current_tenant() AS tenant_id)
  SELECT ks.id,ks.created_at,ks.snapshot_date,ks.period_start,ks.period_end,ks.kpi_definition_id,ks.organization_id,ks.workspace_id,w.name,ks.project_id,
         k.target_type,k.target_id,ks.value_amount,public.btpm_decrypt(ks.string_value,ks.organization_id),ks.value_type,k.target_value,k.unit,k.target_direction::text,
         ks.source_mode,ks.calculation_status,ks.generated_by,ks.formula_version,now(),o.tenant_id
  FROM ctx JOIN public.kpi_snapshots ks ON TRUE JOIN public.kpi_definitions k ON k.id=ks.kpi_definition_id
  JOIN public.workspaces w ON w.id=ks.workspace_id JOIN public.organizations o ON o.id=ks.organization_id
  WHERE ctx.tenant_id IS NOT NULL AND o.tenant_id=ctx.tenant_id
    AND EXISTS (SELECT 1 FROM pbi_reporting._scope_projects sp WHERE sp.organization_id=ks.organization_id AND sp.project_id=ks.project_id);
$function$;

CREATE OR REPLACE VIEW pbi_reporting.dim_user WITH (security_barrier=true) AS
SELECT * FROM pbi_reporting_security.list_reporting_users();
CREATE OR REPLACE VIEW pbi_reporting.v2_dim_task WITH (security_barrier=true) AS
SELECT * FROM pbi_reporting_security.list_reporting_tasks();
CREATE OR REPLACE VIEW pbi_reporting.v2_fact_blockers_current WITH (security_barrier=true) AS
SELECT * FROM pbi_reporting_security.list_reporting_blockers_current();
CREATE OR REPLACE VIEW pbi_reporting.v2_fact_risks_current WITH (security_barrier=true) AS
SELECT * FROM pbi_reporting_security.list_reporting_risks_current();
CREATE OR REPLACE VIEW pbi_reporting.v2_fact_governance_cadences WITH (security_barrier=true) AS
SELECT * FROM pbi_reporting_security.list_reporting_governance_cadences();
CREATE OR REPLACE VIEW pbi_reporting.v2_fact_kpi_snapshot_values WITH (security_barrier=true) AS
SELECT * FROM pbi_reporting_security.list_reporting_kpi_snapshot_values();

DO $acl$
DECLARE v_name text;v_role text;v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'pbi_reporting_security.list_reporting_users()',
    'pbi_reporting_security.list_reporting_tasks()',
    'pbi_reporting_security.list_reporting_blockers_current()',
    'pbi_reporting_security.list_reporting_risks_current()',
    'pbi_reporting_security.list_reporting_governance_cadences()',
    'pbi_reporting_security.list_reporting_kpi_snapshot_values()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',v_fn);
    FOREACH v_role IN ARRAY ARRAY['anon','authenticated','service_role','pbi_reader'] LOOP
      IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=v_role) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',v_fn,v_role); END IF;
    END LOOP;
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO btpm_pbi_reader',v_fn);
  END LOOP;
  FOREACH v_name IN ARRAY ARRAY['dim_user','v2_dim_task','v2_fact_blockers_current','v2_fact_risks_current','v2_fact_governance_cadences','v2_fact_kpi_snapshot_values'] LOOP
    EXECUTE format('REVOKE ALL ON pbi_reporting.%I FROM PUBLIC',v_name);
    FOREACH v_role IN ARRAY ARRAY['anon','authenticated','service_role','pbi_reader'] LOOP
      IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=v_role) THEN EXECUTE format('REVOKE ALL ON pbi_reporting.%I FROM %I',v_name,v_role); END IF;
    END LOOP;
    EXECUTE format('GRANT SELECT ON pbi_reporting.%I TO btpm_pbi_reader',v_name);
  END LOOP;
END
$acl$;
