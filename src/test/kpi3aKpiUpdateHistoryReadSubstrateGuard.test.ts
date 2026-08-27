/** KPI-3A — current-state guard for protected KPI update-history reads. */
import { describe, it, expect } from "vitest";
import { currentFunction, functionAcl } from "./ossSqlContract";

const FN = currentFunction("api_v1_list_kpi_updates");
const ACL = functionAcl("api_v1_list_kpi_updates");

describe("KPI-3A KPI update history current contract", () => {
  it("keeps the frozen keyset signature and protected execution posture", () => {
    for (const token of [
      "_expected_oauth_client_id text", "_kpi_id uuid", "_limit integer",
      "_after_update_date date", "_after_id uuid",
      "RETURNS jsonb", "STABLE SECURITY DEFINER", "SET search_path TO 'pg_catalog'",
    ]) expect(FN).toContain(token);
    expect(FN).toMatch(/_after_created_at\s+(?:timestamptz|timestamp\s+with\s+time\s+zone)/i);
    expect(FN).toContain("IF _kpi_id IS NULL");
    expect(FN).toContain("00000000-0000-0000-0000-000000000000");
    expect(FN).toContain("_limit > 100");
    expect(FN).toContain("IF _cursor_supplied <> 0 AND _cursor_supplied <> 3 THEN");
  });

  it("derives KPI → Project → Workspace → Organization → Tenant and enforces canonical Project access", () => {
    for (const token of [
      "api_e_private.resolve_delegated_read_principal(_expected_oauth_client_id)",
      "FROM public.kpi_definitions kd", "JOIN public.projects p", "p.id = kd.target_id",
      "kd.target_type = 'project'", "kd.id = _kpi_id", "p.workspace_id = kd.workspace_id",
      "p.organization_id = kd.organization_id", "JOIN public.workspaces w",
      "JOIN public.organizations o", "JOIN public.tenants t", "JOIN public.tenant_memberships tm",
      "JOIN public.organization_memberships om", "public.has_project_access(_uid, p.id)",
    ]) expect(FN).toContain(token);
    expect(FN).not.toContain("platform_super_admins");
  });

  it("requires Connected App enablements and the final exact-Workspace kpis:read grant", () => {
    for (const token of [
      "public.api_organization_client_enablements", "public.api_workspace_client_enablements",
      "public.api_project_client_enablements", "sc.capability_key = 'kpis:read'",
      "cc.scope_level = 'project'", "FROM public.api_capability_grants g",
      "g.workspace_id = w.id", "g.capability_key = 'kpis:read'", "g.lifecycle_status = 'enabled'",
    ]) expect(FN).toContain(token);
    expect(FN).not.toMatch(/g\.workspace_id\s+IS\s+NULL/i);
  });

  it("contains canonical update rows to the derived scope and decrypts note only", () => {
    for (const token of [
      "FROM public.kpi_updates ku", "ku.kpi_definition_id = _kpi_def_id",
      "ku.workspace_id = _ws_id", "ku.organization_id = _org_id",
      "public.btpm_decrypt(ku.note, ku.organization_id)",
    ]) expect(FN).toContain(token);
    expect(FN.match(/public\.btpm_decrypt\(/g)?.length).toBe(1);
  });

  it("keeps the approved seven-field projection without profile leakage", () => {
    const fields = ["kpiUpdateId", "kpiId", "value", "updateDate", "note", "authorId", "createdAt"];
    expect(fields).toHaveLength(7);
    for (const f of fields) expect(FN).toContain(`'${f}',`);
    for (const forbidden of ["author_name", "author_email", "authorName", "authorEmail", "'workspaceId'", "'organizationId'", "public.profiles"]) {
      expect(FN).not.toContain(forbidden);
    }
  });

  it("uses deterministic keyset pagination and a bounded limit+1 probe", () => {
    expect(FN).toContain("ORDER BY ku.update_date DESC, ku.created_at DESC, ku.id DESC");
    expect(FN).toContain("(ku.update_date, ku.created_at, ku.id)");
    expect(FN).toContain("< (_after_update_date, _after_created_at, _after_id)");
    expect(FN).not.toMatch(/\bOFFSET\b/i);
    expect(FN).toContain("LIMIT (_limit + 1)");
    for (const key of ["items", "nextCursorUpdateDate", "nextCursorCreatedAt", "nextCursorId"]) {
      expect(FN).toContain(`'${key}'`);
    }
  });

  it("keeps execute unavailable to PUBLIC/anon and available to authenticated", () => {
    expect(ACL).toMatch(/REVOKE\s+ALL[\s\S]*FROM\s+PUBLIC/i);
    expect(ACL).not.toMatch(/GRANT\s+(?:ALL|EXECUTE)[^;]*TO\s+anon/i);
    expect(ACL).toMatch(/GRANT\s+(?:ALL|EXECUTE)[^;]*TO\s+authenticated/i);
  });
});
