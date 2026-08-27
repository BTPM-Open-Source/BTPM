/** KPI-2A — current-state guard for Project KPI detail reads. */
import { describe, it, expect } from "vitest";
import { currentFunction, functionAcl } from "./ossSqlContract";

const FN = currentFunction("api_v1_get_kpi");
const ACL = functionAcl("api_v1_get_kpi");

describe("KPI-2A Project KPI detail current contract", () => {
  it("keeps the frozen signature and protected execution posture", () => {
    expect(FN).toMatch(/FUNCTION\s+public\.api_v1_get_kpi\s*\(\s*_expected_oauth_client_id text\s*,\s*_kpi_id uuid\s*\)/i);
    expect(FN).toMatch(/RETURNS jsonb/i);
    expect(FN).toMatch(/STABLE SECURITY DEFINER/i);
    expect(FN).toMatch(/SET search_path TO 'pg_catalog'/i);
    expect(FN).toContain("IF _kpi_id IS NULL");
    expect(FN).toContain("00000000-0000-0000-0000-000000000000");
  });

  it("derives Project scope from the KPI and enforces stored scope consistency", () => {
    for (const token of [
      "api_e_private.resolve_delegated_read_principal(_expected_oauth_client_id)",
      "FROM public.kpi_definitions k", "JOIN public.projects p", "p.id = k.target_id",
      "k.target_type = 'project'", "k.id = _kpi_id", "p.workspace_id = k.workspace_id",
      "p.organization_id = k.organization_id", "JOIN public.workspaces w",
      "JOIN public.organizations o", "JOIN public.tenants t", "JOIN public.tenant_memberships tm",
      "JOIN public.organization_memberships om", "public.has_project_access(_uid, p.id)",
    ]) expect(FN).toContain(token);
    const header = FN.slice(0, FN.indexOf("RETURNS"));
    expect(header).not.toContain("_project_id");
    expect(header).not.toContain("_workspace_id");
  });

  it("requires all Connected App gates and the final exact-Workspace kpis:read grant", () => {
    for (const token of [
      "public.api_organization_client_enablements", "public.api_workspace_client_enablements",
      "public.api_project_client_enablements", "sc.capability_key = 'kpis:read'",
      "sc.lifecycle_status = 'enabled'", "cc.scope_level = 'project'",
      "cc.lifecycle_status = 'active'", "FROM public.api_capability_grants g",
      "g.workspace_id = w.id", "g.capability_key = 'kpis:read'", "g.lifecycle_status = 'enabled'",
    ]) expect(FN).toContain(token);
    expect(FN).not.toMatch(/g\.workspace_id\s+IS\s+NULL/i);
    expect(FN).not.toContain("platform_super_admins");
  });

  it("preserves the approved 20-field projection and decrypts description only", () => {
    const fields = [
      "kpiId", "projectId", "name", "description", "unit", "targetValue", "currentValue",
      "targetDirection", "sourceMode", "valueType", "cadence", "calculationKey",
      "formulaVersion", "completionMethod", "commentRequired", "actionPlanRequired",
      "autoSnapshotEnabled", "isArchived", "createdAt", "updatedAt",
    ];
    expect(fields).toHaveLength(20);
    for (const f of fields) expect(FN).toContain(`'${f}',`);
    expect(FN).toContain("'projectId', p.id");
    expect(FN).not.toContain("'createdBy'");
    expect(FN).not.toContain("'updatedBy'");
    expect(FN.match(/public\.btpm_decrypt\(/g)?.length).toBe(1);
    expect(FN).toContain("public.btpm_decrypt(k.description, k.organization_id)");
  });

  it("does not expand into KPI history/snapshot/integration data", () => {
    for (const forbidden of ["kpi_updates", "kpi_snapshots", "kpi_app_mappings", "kpi_app_external_kpis"]) {
      expect(FN).not.toContain(forbidden);
    }
  });

  it("keeps execute unavailable to PUBLIC/anon and available to authenticated", () => {
    expect(ACL).toMatch(/REVOKE\s+ALL[\s\S]*FROM\s+PUBLIC/i);
    expect(ACL).not.toMatch(/GRANT\s+(?:ALL|EXECUTE)[^;]*TO\s+anon/i);
    expect(ACL).toMatch(/GRANT\s+(?:ALL|EXECUTE)[^;]*TO\s+authenticated/i);
  });
});
