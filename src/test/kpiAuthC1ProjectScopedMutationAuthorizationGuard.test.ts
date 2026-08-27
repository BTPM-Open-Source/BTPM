/**
 * KPI-AUTH-C1 — current-state guard for Project-scoped delegated authorization.
 *
 * The clean OSS baseline contains only the final authorization model: every
 * Project-scoped capability requires an exact enabled Workspace capability
 * grant plus explicit Project enablement. Historical intermediate assertions
 * that intentionally predated this requirement are not part of the OSS
 * installation contract.
 */
import { describe, it, expect } from "vitest";
import { currentFunction, functionAcl } from "./ossSqlContract";

const EXT = currentFunction("authorize_and_establish_project_scope", { schema: "api_e_private" });
const MCP = currentFunction("authorize_and_establish_project_scope_mcp", { schema: "api_e_private" });
const EXT_ACL = functionAcl("authorize_and_establish_project_scope", "api_e_private");
const MCP_ACL = functionAcl("authorize_and_establish_project_scope_mcp", "api_e_private");

describe("KPI-AUTH-C1 final Project-scope establishment", () => {
  it("keeps the frozen Project-scoped signature and SECURITY DEFINER posture", () => {
    for (const token of [
      "_expected_oauth_client_id text", "_organization_id uuid", "_workspace_id uuid",
      "_project_id uuid", "_api_version text", "_capability_kind text",
      "_capability_key text", "_request_id text", "RETURNS boolean",
      "SECURITY DEFINER", "SET search_path TO 'public', 'pg_catalog'",
    ]) expect(EXT).toContain(token);
  });

  it("requires exact Workspace grant for the exact Project-scoped capability", () => {
    for (const token of [
      "FROM public.api_capability_grants g", "g.tenant_id=_tenant_id",
      "g.organization_id=_organization_id", "g.workspace_id=_workspace_id",
      "g.api_client_id=_client.id", "g.api_version=_api_version",
      "g.capability_kind=_capability_kind", "g.capability_key=_capability_key",
      "g.lifecycle_status='enabled'",
    ]) expect(EXT.replace(/\s+/g, "")).toContain(token.replace(/\s+/g, ""));
    expect(EXT).not.toMatch(/g\.workspace_id\s+IS\s+NULL/i);
  });

  it("preserves client correlation, policy acknowledgement, memberships and all app enablement layers", () => {
    for (const token of [
      "api_e_private.jwt_client_id()", "public.api_clients", "public.api_client_policy_versions",
      "public.api_user_policy_acknowledgements", "public.tenant_memberships",
      "public.organization_memberships", "public.api_organization_client_enablements",
      "public.workspace_memberships", "public.api_workspace_client_enablements",
      "public.api_project_client_enablements",
    ]) expect(EXT).toContain(token);
  });

  it("requires active Project catalogue/support plus contained non-archived Project and canonical access", () => {
    for (const token of [
      "public.api_capability_catalogue c", "c.scope_level='project'", "c.lifecycle_status='active'",
      "public.api_client_supported_capabilities sc", "sc.lifecycle_status='enabled'",
      "public.projects p", "p.workspace_id=_workspace_id", "p.organization_id=_organization_id",
      "COALESCE(p.is_archived,false)=false", "public.has_project_access(_uid,_project_id)",
    ]) expect(EXT.replace(/\s+/g, "")).toContain(token.replace(/\s+/g, ""));
  });

  it("establishes trusted context only after gates and fails closed on exceptions", () => {
    const grant = EXT.indexOf("public.api_capability_grants");
    const trust = EXT.indexOf("set_config('api_e.trusted','true',true)");
    expect(grant).toBeGreaterThan(-1);
    expect(trust).toBeGreaterThan(grant);
    expect(EXT).toMatch(/EXCEPTION WHEN OTHERS THEN[\s\S]*api_e\.trusted','false'/i);
    expect(EXT).not.toContain("platform_super_admins");
  });

  it("is not caller-reachable directly", () => {
    for (const acl of [EXT_ACL, MCP_ACL]) {
      for (const role of ["PUBLIC", "anon", "authenticated", "service_role"]) {
        expect(acl).toMatch(new RegExp(`REVOKE\\s+ALL[\\s\\S]*FROM\\s+${role}`, "i"));
      }
      expect(acl).not.toMatch(/GRANT\s+(?:ALL|EXECUTE)/i);
    }
  });
});

describe("KPI-AUTH-C1 MCP inheritance", () => {
  it("delegates to the canonical Project-scope helper and only changes source channel after validation", () => {
    expect(MCP).toContain("api_e_private.authorize_and_establish_project_scope(");
    expect(MCP).not.toContain("FROM public.api_capability_grants");
    expect(MCP).toContain("current_setting('api_e.trusted',true)");
    expect(MCP).toContain("set_config('api_e.source_channel','mcp',true)");
    expect(MCP).toMatch(/EXCEPTION WHEN OTHERS THEN[\s\S]*api_e\.trusted','false'/i);
  });
});
