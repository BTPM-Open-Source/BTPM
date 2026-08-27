-- BTPM OSS baseline: current Power BI workspace-only reporting scope.
--
-- Current governance intentionally has no project-level reporting scope rules.
-- Projects inherit reporting inclusion from an explicitly included Workspace.
-- This file creates no scope rows and therefore enables no reporting data on a
-- fresh installation until an administrator configures Workspace scope.

CREATE OR REPLACE VIEW pbi_reporting._scope_configured_orgs AS
SELECT DISTINCT r.organization_id
FROM public.powerbi_data_scope_rules r
WHERE r.scope_type = 'workspace';

CREATE OR REPLACE VIEW pbi_reporting._scope_workspaces AS
SELECT DISTINCT w.organization_id, w.id AS workspace_id
FROM public.workspaces w
WHERE EXISTS (
  SELECT 1
  FROM pbi_reporting._scope_configured_orgs c
  WHERE c.organization_id = w.organization_id
)
AND EXISTS (
  SELECT 1
  FROM public.powerbi_data_scope_rules wr
  WHERE wr.scope_type = 'workspace'
    AND wr.organization_id = w.organization_id
    AND wr.workspace_id = w.id
    AND wr.scope_mode = 'included'
);

CREATE OR REPLACE VIEW pbi_reporting._scope_projects AS
SELECT p.organization_id, p.id AS project_id, p.workspace_id
FROM public.projects p
JOIN pbi_reporting._scope_workspaces sw
  ON sw.organization_id = p.organization_id
 AND sw.workspace_id = p.workspace_id;

CREATE OR REPLACE VIEW pbi_reporting._scope_organizations AS
SELECT DISTINCT sp.organization_id
FROM pbi_reporting._scope_projects sp;

-- Scope helper views are internal implementation details. They are consumed by
-- controlled reporting views/functions and by the admin readiness function;
-- browser roles and the reporting login do not query them directly.
REVOKE ALL ON pbi_reporting._scope_configured_orgs FROM PUBLIC;
REVOKE ALL ON pbi_reporting._scope_workspaces FROM PUBLIC;
REVOKE ALL ON pbi_reporting._scope_projects FROM PUBLIC;
REVOKE ALL ON pbi_reporting._scope_organizations FROM PUBLIC;
REVOKE ALL ON pbi_reporting._scope_configured_orgs FROM btpm_pbi_reader;
REVOKE ALL ON pbi_reporting._scope_workspaces FROM btpm_pbi_reader;
REVOKE ALL ON pbi_reporting._scope_projects FROM btpm_pbi_reader;
REVOKE ALL ON pbi_reporting._scope_organizations FROM btpm_pbi_reader;

DO $scope_acl$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON pbi_reporting._scope_configured_orgs FROM anon';
    EXECUTE 'REVOKE ALL ON pbi_reporting._scope_workspaces FROM anon';
    EXECUTE 'REVOKE ALL ON pbi_reporting._scope_projects FROM anon';
    EXECUTE 'REVOKE ALL ON pbi_reporting._scope_organizations FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON pbi_reporting._scope_configured_orgs FROM authenticated';
    EXECUTE 'REVOKE ALL ON pbi_reporting._scope_workspaces FROM authenticated';
    EXECUTE 'REVOKE ALL ON pbi_reporting._scope_projects FROM authenticated';
    EXECUTE 'REVOKE ALL ON pbi_reporting._scope_organizations FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'pbi_reader') THEN
    EXECUTE 'REVOKE ALL ON pbi_reporting._scope_configured_orgs FROM pbi_reader';
    EXECUTE 'REVOKE ALL ON pbi_reporting._scope_workspaces FROM pbi_reader';
    EXECUTE 'REVOKE ALL ON pbi_reporting._scope_projects FROM pbi_reader';
    EXECUTE 'REVOKE ALL ON pbi_reporting._scope_organizations FROM pbi_reader';
  END IF;
END
$scope_acl$;
