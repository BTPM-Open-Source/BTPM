-- BTPM OSS baseline: portable tenant-bound Power BI core reporting views.
--
-- These are read-only PostgreSQL Import surfaces. Every exposed object is
-- fail-closed through resolve_current_tenant() and the Workspace-only scope.
-- No legacy pbi_reader role, Push/REST reporting objects, credentials, or seed
-- scope rows are created here.

CREATE OR REPLACE VIEW pbi_reporting.v2_tenant_boundary_probe
WITH (security_barrier = true) AS
SELECT pbi_reporting_security.resolve_current_tenant() AS tenant_id,
       session_user::text AS session_login
WHERE pbi_reporting_security.resolve_current_tenant() IS NOT NULL;

CREATE OR REPLACE VIEW pbi_reporting.dim_tenant
WITH (security_barrier = true) AS
SELECT t.id AS tenant_id,
       t.name AS tenant_name,
       t.status::text AS tenant_status,
       t.created_at,
       t.updated_at
FROM public.tenants t
WHERE t.id = pbi_reporting_security.resolve_current_tenant()
  AND EXISTS (
    SELECT 1
    FROM public.organizations o
    JOIN pbi_reporting._scope_organizations s ON s.organization_id = o.id
    WHERE o.tenant_id = t.id
  );

CREATE OR REPLACE VIEW pbi_reporting.v2_dim_organization
WITH (security_barrier = true) AS
SELECT o.id AS organization_id,
       o.name AS organization_name,
       o.slug AS organization_slug,
       o.created_at,
       o.updated_at,
       o.tenant_id
FROM public.organizations o
JOIN pbi_reporting._scope_organizations s ON s.organization_id = o.id
WHERE o.tenant_id = pbi_reporting_security.resolve_current_tenant();

CREATE OR REPLACE VIEW pbi_reporting.v2_dim_workspace
WITH (security_barrier = true) AS
SELECT w.id AS workspace_id,
       w.organization_id,
       w.name AS workspace_name,
       w.is_active,
       w.is_archived,
       w.is_demo,
       w.created_at,
       w.updated_at,
       o.tenant_id
FROM public.workspaces w
JOIN pbi_reporting._scope_workspaces s
  ON s.organization_id = w.organization_id
 AND s.workspace_id = w.id
JOIN public.organizations o ON o.id = w.organization_id
WHERE o.tenant_id = pbi_reporting_security.resolve_current_tenant();

CREATE OR REPLACE VIEW pbi_reporting.v2_dim_program
WITH (security_barrier = true) AS
SELECT pg.id AS program_id,
       pg.organization_id,
       pg.workspace_id,
       w.name AS workspace_name,
       pg.name AS program_name,
       pg.status::text AS program_status,
       pg.is_archived,
       pg.created_at,
       pg.updated_at,
       o.tenant_id
FROM public.programs pg
JOIN public.workspaces w ON w.id = pg.workspace_id
JOIN public.organizations o ON o.id = pg.organization_id
WHERE o.tenant_id = pbi_reporting_security.resolve_current_tenant()
  AND EXISTS (
    SELECT 1
    FROM pbi_reporting._scope_projects sp
    JOIN public.projects p ON p.id = sp.project_id
    WHERE sp.organization_id = pg.organization_id
      AND p.program_id = pg.id
  );

CREATE OR REPLACE VIEW pbi_reporting.v2_dim_project
WITH (security_barrier = true) AS
SELECT p.id AS project_id,
       p.organization_id,
       p.workspace_id,
       w.name AS workspace_name,
       p.program_id,
       pg.name AS program_name,
       p.name AS project_name,
       p.status::text AS project_status,
       p.project_stage::text AS project_stage,
       p.priority::text AS project_priority,
       CASE p.priority::text WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE NULL END AS priority_sort,
       p.agile_enabled,
       p.is_archived,
       p.is_baselined,
       p.baseline_approved_at,
       p.baseline_approved_by,
       p.start_date AS planned_start_date,
       p.target_end_date AS planned_end_date,
       p.baseline_start_date,
       p.baseline_end_date,
       p.actual_start_date,
       p.actual_end_date,
       COALESCE(p.actual_start_date,p.start_date,p.baseline_start_date) AS schedule_start_date,
       COALESCE(p.actual_end_date,p.target_end_date,p.baseline_end_date) AS schedule_end_date,
       (p.target_end_date-p.start_date) AS planned_duration_days,
       (p.baseline_end_date-p.baseline_start_date) AS baseline_duration_days,
       (p.actual_end_date-p.actual_start_date) AS actual_duration_days,
       (p.target_end_date-p.baseline_end_date) AS baseline_variance_days,
       (p.actual_end_date-p.baseline_end_date) AS actual_finish_variance_days,
       (p.status::text <> ALL (ARRAY['completed','cancelled']) AND p.target_end_date IS NOT NULL AND p.target_end_date < CURRENT_DATE) AS is_overdue,
       CASE WHEN p.status::text <> ALL (ARRAY['completed','cancelled']) AND p.target_end_date IS NOT NULL AND p.target_end_date < CURRENT_DATE THEN CURRENT_DATE-p.target_end_date ELSE 0 END AS days_overdue,
       p.created_at,
       p.updated_at,
       o.tenant_id,
       p.portfolio_item_id
FROM public.projects p
JOIN pbi_reporting._scope_projects sp
  ON sp.organization_id=p.organization_id AND sp.workspace_id=p.workspace_id AND sp.project_id=p.id
JOIN public.workspaces w ON w.id=p.workspace_id
JOIN public.organizations o ON o.id=p.organization_id
LEFT JOIN public.programs pg ON pg.id=p.program_id
WHERE o.tenant_id=pbi_reporting_security.resolve_current_tenant();

CREATE OR REPLACE VIEW pbi_reporting.v2_dim_phase
WITH (security_barrier = true) AS
SELECT ph.id AS phase_id,
       ph.organization_id,
       ph.workspace_id,
       w.name AS workspace_name,
       ph.project_id,
       p.name AS project_name,
       ph.name AS phase_name,
       ph.status::text AS phase_status,
       ph.phase_type::text AS phase_type,
       ph.sort_order,
       ph.is_archived,
       ph.added_after_baseline,
       ph.start_date AS planned_start_date,
       ph.target_end_date AS planned_end_date,
       ph.baseline_start_date,
       ph.baseline_end_date,
       ph.actual_start_date,
       ph.actual_end_date,
       COALESCE(ph.actual_start_date,ph.start_date,ph.baseline_start_date) AS schedule_start_date,
       COALESCE(ph.actual_end_date,ph.target_end_date,ph.baseline_end_date) AS schedule_end_date,
       (ph.target_end_date-ph.start_date) AS planned_duration_days,
       (ph.baseline_end_date-ph.baseline_start_date) AS baseline_duration_days,
       (ph.actual_end_date-ph.actual_start_date) AS actual_duration_days,
       (ph.target_end_date-ph.baseline_end_date) AS baseline_variance_days,
       (ph.actual_end_date-ph.baseline_end_date) AS actual_finish_variance_days,
       (ph.status::text <> ALL (ARRAY['completed','cancelled']) AND ph.target_end_date IS NOT NULL AND ph.target_end_date < CURRENT_DATE) AS is_overdue,
       CASE WHEN ph.status::text <> ALL (ARRAY['completed','cancelled']) AND ph.target_end_date IS NOT NULL AND ph.target_end_date < CURRENT_DATE THEN CURRENT_DATE-ph.target_end_date ELSE 0 END AS days_overdue,
       ph.created_at,
       ph.updated_at,
       o.tenant_id
FROM public.phases ph
JOIN pbi_reporting._scope_projects sp
  ON sp.organization_id=ph.organization_id AND sp.workspace_id=ph.workspace_id AND sp.project_id=ph.project_id
JOIN public.projects p ON p.id=ph.project_id
JOIN public.workspaces w ON w.id=ph.workspace_id
JOIN public.organizations o ON o.id=ph.organization_id
WHERE o.tenant_id=pbi_reporting_security.resolve_current_tenant();

CREATE OR REPLACE VIEW pbi_reporting.v2_dim_kpi
WITH (security_barrier = true) AS
SELECT k.id AS kpi_definition_id,
       k.organization_id,
       k.workspace_id,
       w.name AS workspace_name,
       k.target_type,
       k.target_id,
       k.name AS kpi_name,
       k.unit,
       k.value_type,
       k.source_mode,
       k.cadence,
       k.target_direction::text AS target_direction,
       k.target_value,
       k.current_value,
       k.auto_snapshot_enabled,
       k.is_archived,
       k.created_at,
       k.updated_at,
       o.tenant_id
FROM public.kpi_definitions k
JOIN public.workspaces w ON w.id=k.workspace_id
JOIN public.organizations o ON o.id=k.organization_id
WHERE o.tenant_id=pbi_reporting_security.resolve_current_tenant()
  AND ((k.target_type='project' AND EXISTS (
         SELECT 1 FROM pbi_reporting._scope_projects sp
         WHERE sp.organization_id=k.organization_id AND sp.project_id=k.target_id
       )) OR
       (k.target_type<>'project' AND EXISTS (
         SELECT 1 FROM pbi_reporting._scope_workspaces sw
         WHERE sw.organization_id=k.organization_id AND sw.workspace_id=k.workspace_id
       )));

CREATE OR REPLACE VIEW pbi_reporting.v2_fact_project_status_current
WITH (security_barrier = true) AS
WITH task_agg AS (
  SELECT t.project_id,count(*) AS total_tasks,
         count(*) FILTER (WHERE t.status::text='completed') AS completed_tasks,
         count(*) FILTER (WHERE t.status::text <> ALL (ARRAY['completed','cancelled']) AND t.due_date IS NOT NULL AND t.due_date<CURRENT_DATE) AS overdue_tasks
  FROM public.tasks t WHERE NOT t.is_archived GROUP BY t.project_id
), phase_agg AS (
  SELECT ph.project_id,count(*) AS total_phases,
         count(*) FILTER (WHERE ph.status::text='completed') AS completed_phases
  FROM public.phases ph WHERE NOT ph.is_archived GROUP BY ph.project_id
), blk_agg AS (
  SELECT b.target_id AS project_id,count(*) AS open_blockers FROM public.blockers b
  WHERE b.target_type='project' AND b.status::text<>'resolved' GROUP BY b.target_id
), risk_agg AS (
  SELECT r.target_id AS project_id,count(*) AS open_risks FROM public.risks r
  WHERE r.target_type='project' AND r.status::text <> ALL (ARRAY['closed','accepted']) GROUP BY r.target_id
)
SELECT p.id AS project_id,p.organization_id,p.workspace_id,p.program_id,
       p.status::text AS status,p.project_stage::text AS project_stage,p.priority::text AS priority,
       CASE p.priority::text WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE NULL END AS priority_sort,
       p.start_date AS planned_start_date,p.target_end_date AS planned_end_date,
       p.baseline_start_date,p.baseline_end_date,p.actual_start_date,p.actual_end_date,
       COALESCE(pa.total_phases,0) AS total_phases,COALESCE(pa.completed_phases,0) AS completed_phases,
       COALESCE(ta.total_tasks,0) AS total_tasks,COALESCE(ta.completed_tasks,0) AS completed_tasks,
       COALESCE(ta.overdue_tasks,0) AS overdue_tasks,COALESCE(ba.open_blockers,0) AS open_blockers,
       COALESCE(ra.open_risks,0) AS open_risks,(p.target_end_date-p.baseline_end_date) AS schedule_variance_days,
       (p.status::text <> ALL (ARRAY['completed','cancelled']) AND p.target_end_date IS NOT NULL AND p.target_end_date<CURRENT_DATE) AS is_overdue,
       CASE WHEN p.status::text <> ALL (ARRAY['completed','cancelled']) AND p.target_end_date IS NOT NULL AND p.target_end_date<CURRENT_DATE THEN CURRENT_DATE-p.target_end_date ELSE 0 END AS days_overdue,
       CASE WHEN COALESCE(ta.total_tasks,0)=0 THEN NULL ELSE round(100.0*ta.completed_tasks::numeric/ta.total_tasks::numeric,2) END AS derived_task_completion_percent,
       now() AS data_as_of_utc,o.tenant_id
FROM public.projects p
JOIN pbi_reporting._scope_projects sp ON sp.organization_id=p.organization_id AND sp.workspace_id=p.workspace_id AND sp.project_id=p.id
JOIN public.organizations o ON o.id=p.organization_id
LEFT JOIN task_agg ta ON ta.project_id=p.id LEFT JOIN phase_agg pa ON pa.project_id=p.id
LEFT JOIN blk_agg ba ON ba.project_id=p.id LEFT JOIN risk_agg ra ON ra.project_id=p.id
WHERE o.tenant_id=pbi_reporting_security.resolve_current_tenant();

CREATE OR REPLACE VIEW pbi_reporting.v2_fact_phase_status_current
WITH (security_barrier = true) AS
WITH task_agg AS (
  SELECT t.phase_id,count(*) AS total_tasks,
         count(*) FILTER (WHERE t.status::text='completed') AS completed_tasks,
         count(*) FILTER (WHERE t.status::text <> ALL (ARRAY['completed','cancelled']) AND t.due_date IS NOT NULL AND t.due_date<CURRENT_DATE) AS overdue_tasks
  FROM public.tasks t WHERE NOT t.is_archived AND t.phase_id IS NOT NULL GROUP BY t.phase_id
)
SELECT ph.id AS phase_id,ph.project_id,ph.organization_id,ph.workspace_id,ph.status::text AS status,
       ph.phase_type::text AS phase_type,ph.start_date AS planned_start_date,ph.target_end_date AS planned_end_date,
       ph.baseline_start_date,ph.baseline_end_date,ph.actual_start_date,ph.actual_end_date,
       COALESCE(ta.total_tasks,0) AS total_tasks,COALESCE(ta.completed_tasks,0) AS completed_tasks,
       COALESCE(ta.overdue_tasks,0) AS overdue_tasks,
       (SELECT count(*) FROM public.blockers b WHERE b.target_type='phase' AND b.target_id=ph.id AND b.status::text<>'resolved') AS open_blockers,
       (SELECT count(*) FROM public.risks r WHERE r.target_type='phase' AND r.target_id=ph.id AND r.status::text <> ALL (ARRAY['closed','accepted'])) AS open_risks,
       (ph.target_end_date-ph.baseline_end_date) AS schedule_variance_days,
       (ph.status::text <> ALL (ARRAY['completed','cancelled']) AND ph.target_end_date IS NOT NULL AND ph.target_end_date<CURRENT_DATE) AS is_overdue,
       CASE WHEN ph.status::text <> ALL (ARRAY['completed','cancelled']) AND ph.target_end_date IS NOT NULL AND ph.target_end_date<CURRENT_DATE THEN CURRENT_DATE-ph.target_end_date ELSE 0 END AS days_overdue,
       CASE WHEN COALESCE(ta.total_tasks,0)=0 THEN NULL ELSE round(100.0*ta.completed_tasks::numeric/ta.total_tasks::numeric,2) END AS derived_task_completion_percent,
       now() AS data_as_of_utc,o.tenant_id
FROM public.phases ph
JOIN pbi_reporting._scope_projects sp ON sp.organization_id=ph.organization_id AND sp.workspace_id=ph.workspace_id AND sp.project_id=ph.project_id
JOIN public.organizations o ON o.id=ph.organization_id
LEFT JOIN task_agg ta ON ta.phase_id=ph.id
WHERE o.tenant_id=pbi_reporting_security.resolve_current_tenant();

CREATE OR REPLACE VIEW pbi_reporting.v2_fact_task_status_current
WITH (security_barrier = true) AS
SELECT t.id AS task_id,t.phase_id,t.project_id,t.organization_id,t.workspace_id,t.status::text AS status,
       t.priority::text AS priority,CASE t.priority::text WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE NULL END AS priority_sort,
       t.task_type::text AS task_type,t.owner_id,t.start_date AS planned_start_date,t.due_date AS planned_end_date,t.due_date,
       t.baseline_start_date,t.baseline_end_date,t.actual_start_date,t.actual_end_date,t.estimated_hours,
       (t.status::text <> ALL (ARRAY['completed','cancelled']) AND t.due_date IS NOT NULL AND t.due_date<CURRENT_DATE) AS is_overdue,
       CASE WHEN t.status::text <> ALL (ARRAY['completed','cancelled']) AND t.due_date IS NOT NULL AND t.due_date<CURRENT_DATE THEN CURRENT_DATE-t.due_date ELSE 0 END AS days_overdue,
       (t.due_date-t.start_date) AS planned_duration_days,(t.baseline_end_date-t.baseline_start_date) AS baseline_duration_days,
       (t.actual_end_date-t.actual_start_date) AS actual_duration_days,(t.due_date-t.baseline_end_date) AS schedule_variance_days,
       now() AS data_as_of_utc,o.tenant_id
FROM public.tasks t
JOIN pbi_reporting._scope_projects sp ON sp.organization_id=t.organization_id AND sp.workspace_id=t.workspace_id AND sp.project_id=t.project_id
JOIN public.organizations o ON o.id=t.organization_id
WHERE o.tenant_id=pbi_reporting_security.resolve_current_tenant();

-- Grant only the explicit read-only tenant surfaces.
DO $acl$
DECLARE
  v_name text;
  v_role text;
  v_views text[] := ARRAY[
    'v2_tenant_boundary_probe','dim_tenant','v2_dim_organization','v2_dim_workspace',
    'v2_dim_program','v2_dim_project','v2_dim_phase','v2_dim_kpi',
    'v2_fact_project_status_current','v2_fact_phase_status_current','v2_fact_task_status_current'
  ];
BEGIN
  FOREACH v_name IN ARRAY v_views LOOP
    EXECUTE format('REVOKE ALL ON pbi_reporting.%I FROM PUBLIC',v_name);
    FOREACH v_role IN ARRAY ARRAY['anon','authenticated','service_role','pbi_reader'] LOOP
      IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=v_role) THEN
        EXECUTE format('REVOKE ALL ON pbi_reporting.%I FROM %I',v_name,v_role);
      END IF;
    END LOOP;
    EXECUTE format('GRANT SELECT ON pbi_reporting.%I TO btpm_pbi_reader',v_name);
  END LOOP;
END
$acl$;
