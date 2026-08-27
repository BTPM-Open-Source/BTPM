/** API-ADM-UX2.2-C1 — final closure guard for Project-scoped external reads. */
import { describe, it, expect } from "vitest";
import { currentFunction } from "./ossSqlContract";

const WRAPPERS = [
  ["api_v1_get_project", "projects:read"],
  ["api_v1_get_phase", "phases:read"],
  ["api_v1_get_task", "tasks:read"],
  ["api_v1_get_risk", "risks:read"],
  ["api_v1_list_project_risks", "risks:read"],
  ["api_v1_get_blocker", "blockers:read"],
  ["api_v1_list_project_blockers", "blockers:read"],
  ["api_v1_list_execution_updates", "execution_updates:read"],
  ["api_v1_get_project_planning", "planning:read"],
] as const;

describe("API-ADM-UX2.2-C1 final Project read closure", () => {
  it.each(WRAPPERS)("%s requires exact Workspace %s grant", (name, capability) => {
    const fn = currentFunction(name);
    expect(fn).toContain("FROM public.api_capability_grants g");
    expect(fn).toContain("g.workspace_id = w.id");
    expect(fn).toContain(`g.capability_key = '${capability}'`);
    expect(fn).toContain("g.lifecycle_status = 'enabled'");
    expect(fn).not.toMatch(/g\.workspace_id\s+IS\s+NULL/i);
  });

  it.each(WRAPPERS)("%s preserves Project access and Connected App containment", (name, capability) => {
    const fn = currentFunction(name);
    expect(fn).toContain("public.has_project_access(_uid, p.id)");
    expect(fn).toContain("public.api_project_client_enablements");
    expect(fn).toContain("public.api_workspace_client_enablements");
    expect(fn).toContain("public.api_organization_client_enablements");
    expect(fn).toContain(`sc.capability_key = '${capability}'`);
    expect(fn).toContain("cc.scope_level = 'project'");
    expect(fn).toContain("cc.lifecycle_status = 'active'");
  });

  it.each(WRAPPERS)("%s preserves active Tenant/Organization/Workspace membership containment", (name) => {
    const fn = currentFunction(name);
    expect(fn).toContain("api_e_private.resolve_delegated_read_principal");
    expect(fn).toContain("JOIN public.tenants t");
    expect(fn).toContain("JOIN public.tenant_memberships tm");
    expect(fn).toContain("JOIN public.organization_memberships om");
    expect(fn).toContain("JOIN public.workspaces w");
    expect(fn).toContain("w.is_active = true");
    expect(fn).toContain("w.is_archived = false");
    expect(fn).toContain("p.is_archived = false");
  });

  it("preserves protected-field decryption on sensitive read families", () => {
    expect(currentFunction("api_v1_get_project")).toContain("public.btpm_decrypt(p.charter, p.organization_id)");
    expect(currentFunction("api_v1_get_risk")).toContain("public.btpm_decrypt(r.mitigation_plan, r.organization_id)");
    expect(currentFunction("api_v1_get_blocker")).toContain("public.btpm_decrypt(b.title, b.organization_id)");
    expect(currentFunction("api_v1_list_execution_updates")).toContain("public.btpm_decrypt(eu.summary, eu.organization_id)");
  });
});
