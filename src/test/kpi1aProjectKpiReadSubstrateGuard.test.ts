/** KPI-1A — current-state guard for Project KPI collection reads. */
import { describe, it, expect } from "vitest";
import { currentFunction, functionAcl } from "./ossSqlContract";

const FN = currentFunction("api_v1_list_project_kpis");
const ACL = functionAcl("api_v1_list_project_kpis");

describe("KPI-1A Project KPI collection current contract", () => {
  it("keeps the frozen bounded signature and SECURITY DEFINER posture", () => {
    for (const token of [
      "_expected_oauth_client_id text", "_project_id uuid", "_limit integer",
      "_offset integer", "_include_archived boolean", "RETURNS jsonb",
      "STABLE SECURITY DEFINER", "SET search_path TO 'pg_catalog'",
    ]) expect(FN).toContain(token);
    expect(FN).toContain("IF _project_id IS NULL THEN");
    expect(FN).toContain("IF _limit IS NULL OR _limit < 1 OR _limit > 100 THEN");
    expect(FN).toContain("IF _offset IS NULL OR _offset < 0 OR _offset > 10000 THEN");
    expect(FN).toContain("IF _include_archived IS NULL THEN");
  });

  it("derives Tenant/Organization/Workspace/Project scope server-side and requires canonical access", () => {
    for (const token of [
      "api_e_private.resolve_delegated_read_principal(_expected_oauth_client_id)",
      "FROM public.projects p", "JOIN public.workspaces w", "JOIN public.organizations o",
      "JOIN public.tenants t", "JOIN public.tenant_memberships tm",
      "JOIN public.organization_memberships om", "public.has_project_access(_uid, p.id)",
      "public.api_organization_client_enablements", "public.api_workspace_client_enablements",
      "public.api_project_client_enablements",
    ]) expect(FN).toContain(token);
    expect(FN).not.toContain("platform_super_admins");
    expect(FN).not.toContain("is_platform_super_admin");
  });

  it("requires the final exact-Workspace kpis:read capability grant", () => {
    expect(FN).toContain("FROM public.api_capability_grants g");
    expect(FN).toContain("g.workspace_id = w.id");
    expect(FN).toContain("g.capability_key = 'kpis:read'");
    expect(FN).toContain("g.lifecycle_status = 'enabled'");
    expect(FN).toContain("sc.capability_key = 'kpis:read'");
    expect(FN).toContain("cc.scope_level = 'project'");
    expect(FN).not.toMatch(/g\.workspace_id\s+IS\s+NULL/i);
  });

  it("contains KPI rows to derived Project/Workspace/Organization and decrypts description only", () => {
    for (const token of [
      "FROM public.kpi_definitions k", "k.target_type = 'project'", "k.target_id = _proj_id",
      "k.workspace_id = _ws_id", "k.organization_id = _org_id",
      "(_include_archived OR k.is_archived = false)",
      "public.btpm_decrypt(k.description, k.organization_id)",
    ]) expect(FN).toContain(token);
    expect(FN.match(/public\.btpm_decrypt\(/g)?.length).toBe(1);
  });

  it("preserves the approved projection and deterministic pagination", () => {
    for (const field of [
      "kpiId", "projectId", "name", "description", "unit", "targetValue", "currentValue",
      "targetDirection", "sourceMode", "valueType", "cadence", "calculationKey",
      "formulaVersion", "completionMethod", "commentRequired", "actionPlanRequired",
      "autoSnapshotEnabled", "isArchived", "createdAt", "updatedAt",
    ]) expect(FN).toContain(`'${field}',`);
    expect(FN).not.toContain("'createdBy'");
    expect(FN).not.toContain("'updatedBy'");
    expect(FN).toContain("row_number() OVER (ORDER BY e.is_archived ASC, e.created_at ASC, e.id ASC)");
    expect(FN).toContain("FILTER (WHERE sub.rn > _offset AND sub.rn <= _offset + _limit)");
  });

  it("keeps execute unavailable to PUBLIC/anon and available to authenticated", () => {
    expect(ACL).toMatch(/REVOKE\s+ALL[\s\S]*FROM\s+PUBLIC/i);
    expect(ACL).not.toMatch(/GRANT\s+(?:ALL|EXECUTE)[^;]*TO\s+anon/i);
    expect(ACL).toMatch(/GRANT\s+(?:ALL|EXECUTE)[^;]*TO\s+authenticated/i);
  });
});
