/** API-ADM-UX2.2 — current-state Project-scoped runtime Workspace-grant guard. */
import { describe, it, expect } from "vitest";
import { currentFunction } from "./ossSqlContract";

const HELPER = currentFunction("authorize_and_establish_project_scope", { schema: "api_e_private" });
const KPI_READS = [
  currentFunction("api_v1_list_project_kpis"),
  currentFunction("api_v1_get_kpi"),
  currentFunction("api_v1_list_kpi_updates"),
] as const;

describe("API-ADM-UX2.2 canonical Project authorization", () => {
  it("requires the exact enabled Workspace capability grant", () => {
    const compact = HELPER.replace(/\s+/g, "");
    for (const token of [
      "public.api_capability_grants", "g.tenant_id=_tenant_id", "g.organization_id=_organization_id",
      "g.workspace_id=_workspace_id", "g.api_client_id=_client.id", "g.api_version=_api_version",
      "g.capability_kind=_capability_kind", "g.capability_key=_capability_key", "g.lifecycle_status='enabled'",
    ]) expect(compact).toContain(token.replace(/\s+/g, ""));
    expect(HELPER).not.toMatch(/g\.workspace_id\s+IS\s+NULL/i);
  });

  it("preserves every pre-existing Project containment and authority gate", () => {
    for (const token of [
      "api_e_private.jwt_client_id()", "public.api_clients", "public.api_client_policy_versions",
      "public.api_user_policy_acknowledgements", "public.tenant_memberships",
      "public.organization_memberships", "public.api_organization_client_enablements",
      "public.workspace_memberships", "public.api_workspace_client_enablements",
      "public.api_capability_catalogue", "public.api_client_supported_capabilities",
      "public.projects", "public.has_project_access", "public.api_project_client_enablements",
    ]) expect(HELPER).toContain(token);
  });

  it("sets trusted context only after authorization and fails closed", () => {
    expect(HELPER.indexOf("api_e.trusted','true'")).toBeGreaterThan(HELPER.indexOf("api_capability_grants"));
    expect(HELPER).toMatch(/EXCEPTION WHEN OTHERS THEN[\s\S]*api_e\.trusted','false'/i);
  });
});

describe("API-ADM-UX2.2 KPI Project reads", () => {
  it("all three reads require an exact Workspace kpis:read grant", () => {
    for (const fn of KPI_READS) {
      expect(fn).toContain("FROM public.api_capability_grants g");
      expect(fn).toContain("g.workspace_id = w.id");
      expect(fn).toContain("g.capability_key = 'kpis:read'");
      expect(fn).toContain("g.lifecycle_status = 'enabled'");
      expect(fn).not.toMatch(/g\.workspace_id\s+IS\s+NULL/i);
      expect(fn).toContain("public.has_project_access(_uid, p.id)");
      expect(fn).toContain("public.api_project_client_enablements");
    }
  });

  it("preserves decryption in detail/history/collection paths", () => {
    expect(KPI_READS[0]).toContain("public.btpm_decrypt(k.description, k.organization_id)");
    expect(KPI_READS[1]).toContain("public.btpm_decrypt(k.description, k.organization_id)");
    expect(KPI_READS[2]).toContain("public.btpm_decrypt(ku.note, ku.organization_id)");
  });
});
