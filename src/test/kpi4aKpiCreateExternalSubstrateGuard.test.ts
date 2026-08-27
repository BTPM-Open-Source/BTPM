/** KPI-4A — current-state guard for trusted Project KPI creation. */
import { describe, it, expect } from "vitest";
import { currentFunction, functionAcl } from "./ossSqlContract";

const PMG = currentFunction("apply_kpi_definition_create");
const EXEC = currentFunction("execute_v1_create_kpi", { schema: "api_e_private" });
const REST = currentFunction("api_v1_create_kpi");
const MCP = currentFunction("mcp_v1_create_kpi");
const EXEC_ACL = functionAcl("execute_v1_create_kpi", "api_e_private");

describe("KPI-4A canonical PMG writer", () => {
  it("keeps browser audit source and trusted external context checks", () => {
    expect(PMG).toContain("btpm_ui");
    expect(PMG).toContain("api_e_private.jwt_client_id()");
    expect(PMG).toContain("api_e_private.assert_trusted_context()");
    expect(PMG).toContain("kpis:create");
    expect(PMG).toMatch(/external_api|mcp/i);
  });

  it("does not accept caller-controlled source channel", () => {
    const header = PMG.slice(0, PMG.indexOf("RETURNS"));
    expect(header).not.toContain("_source_channel");
  });
});

describe("KPI-4A private dual-source executor", () => {
  it("uses only external_api/mcp and derives Project scope server-side", () => {
    expect(EXEC).toContain("v_source NOT IN ('external_api','mcp')");
    expect(EXEC).toContain("SELECT p.id,p.workspace_id,p.organization_id");
    expect(EXEC).toContain("FROM public.projects p WHERE p.id=_project_id");
    const header = EXEC.slice(0, EXEC.indexOf("RETURNS"));
    expect(header).not.toContain("_organization_id");
    expect(header).not.toContain("_workspace_id");
    expect(header).not.toContain("_tenant_id");
  });

  it("authorizes through the final Project-scope helpers and re-verifies trusted context", () => {
    expect(EXEC).toContain("api_e_private.authorize_and_establish_project_scope(");
    expect(EXEC).toContain("api_e_private.authorize_and_establish_project_scope_mcp(");
    for (const key of ["api_e.api_client_id", "api_e.tenant_id", "api_e.organization_id", "api_e.workspace_id"]) {
      expect(EXEC).toContain(`current_setting('${key}',true)`);
    }
    expect(EXEC).toContain("v_ctx_org_id IS DISTINCT FROM v_organization_id");
    expect(EXEC).toContain("v_ctx_workspace_id IS DISTINCT FROM v_workspace_id");
  });

  it("requires explicit enabled Project application access", () => {
    for (const token of [
      "public.api_project_client_enablements", "e.project_id=v_project_id",
      "e.lifecycle_status='enabled'", "e.enabled_at IS NOT NULL", "e.disabled_at IS NULL",
    ]) expect(EXEC).toContain(token);
  });

  it("preserves bounded idempotency and calls the canonical PMG writer exactly once", () => {
    expect(EXEC).toContain("api_e_private.claim_idempotency");
    expect(EXEC).toContain("idempotency_conflict");
    expect(EXEC).toContain("idempotency_pending");
    expect(EXEC).toContain("'outcome','replayed'");
    expect(EXEC.match(/public\.apply_kpi_definition_create\(/g)?.length).toBe(1);
    expect(EXEC).toContain("api_e_private.complete_idempotency");
    expect(EXEC).toContain("api_e_private.fail_idempotency");
  });

  it("returns only the safe applied envelope and does not implement encryption", () => {
    expect(EXEC).toContain("jsonb_build_object('ok',true,'outcome','applied','kpiId',v_kpi_id,'projectId',v_project_id)");
    expect(EXEC).not.toContain("btpm_encrypt");
    expect(EXEC).not.toContain("btpm_decrypt");
    expect(EXEC).not.toMatch(/INSERT\s+INTO\s+public\.kpi_/i);
    expect(EXEC).not.toMatch(/UPDATE\s+public\.kpi_/i);
  });

  it("is not directly executable by caller roles", () => {
    for (const role of ["PUBLIC", "anon", "authenticated", "service_role"]) {
      expect(EXEC_ACL).toMatch(new RegExp(`REVOKE\\s+ALL[\\s\\S]*FROM\\s+${role}`, "i"));
    }
    expect(EXEC_ACL).not.toMatch(/GRANT\s+(?:ALL|EXECUTE)/i);
  });
});

describe("KPI-4A public wrappers", () => {
  it("keeps thin fixed-source REST and MCP wrappers", () => {
    expect(REST).toContain("api_e_private.execute_v1_create_kpi");
    expect(REST).toContain("'external_api'");
    expect(MCP).toContain("api_e_private.execute_v1_create_kpi");
    expect(MCP).toContain("'mcp'");
  });
});
