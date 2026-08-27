/** PMG-CORR.4.1 — current-state Risk/Blocker create scope guard. */
import { describe, expect, it } from "vitest";
import { allFunctionDefinitions, currentFunction, functionAcl } from "../../../test/ossSqlContract";

const blockers = allFunctionDefinitions("create_blocker_with_links");
const risk = currentFunction("create_risk_with_links");

function assertScopedCreate(src: string): void {
  expect(src).toMatch(/_target_type\s*=\s*'project'/i);
  expect(src).toMatch(/_target_type\s*=\s*'phase'/i);
  expect(src).toMatch(/_target_type\s*=\s*'task'/i);
  expect(src).toMatch(/v_project_id\s+uuid/i);
  expect(src).toMatch(/v_workspace_id\s+uuid/i);
  expect(src).toMatch(/v_organization_id\s+uuid/i);
  expect(src).toMatch(/_workspace_id\s+IS DISTINCT FROM\s+v_workspace_id/i);
  expect(src).toMatch(/_organization_id\s+IS DISTINCT FROM\s+v_organization_id/i);
  expect(src).toMatch(/has_pm_authority\s*\(\s*v_uid\s*,\s*v_workspace_id\s*\)/i);
  expect(src).toMatch(/can_write_demo\s*\(\s*v_uid\s*,\s*v_workspace_id\s*\)/i);
  expect(src).not.toMatch(/has_pm_authority\s*\(\s*v_uid\s*,\s*_workspace_id\s*\)/i);
  expect(src).toMatch(/_validate_object_links\(_object_links,\s*v_workspace_id,\s*v_organization_id\)/i);
  expect(src).toMatch(/_validate_user_links\(_user_links,\s*v_workspace_id,\s*v_project_id\)/i);
  expect(src).toMatch(/v_organization_id,\s*v_workspace_id,\s*_target_type/i);
  expect(src).toMatch(/SECURITY DEFINER/i);
  expect(src).toMatch(/SET\s+search_path\s+TO\s+'?pg_catalog'?\s*,\s*'?public'?/i);
}

describe("PMG-CORR.4.1 final Risk/Blocker create contract", () => {
  it("retains both blocker overloads and the risk create function", () => {
    expect(blockers.length).toBeGreaterThanOrEqual(2);
    expect(blockers.some((f) => f.includes("_status text DEFAULT 'open'"))).toBe(true);
    expect(risk).toContain("create_risk_with_links");
  });

  it("all active create bodies derive authoritative Project/Workspace/Organization scope", () => {
    for (const body of [...blockers, risk]) assertScopedCreate(body);
  });

  it("all create bodies use generic non-enumerating target/authority failure copy", () => {
    for (const body of [...blockers, risk]) {
      expect((body.match(/Target is unavailable or not authorized/g) ?? []).length).toBeGreaterThanOrEqual(4);
    }
  });

  it("raw create helper ACLs revoke PUBLIC and authenticated access while retaining service runtime access", () => {
    for (const name of ["create_blocker_with_links", "create_risk_with_links"]) {
      const acl = functionAcl(name);
      expect(acl).toMatch(/REVOKE\s+ALL[\s\S]*FROM\s+PUBLIC/i);
      expect(acl).not.toMatch(/GRANT\s+(?:ALL|EXECUTE)[^;]*TO\s+anon/i);
      expect(acl).not.toMatch(/GRANT\s+(?:ALL|EXECUTE)[^;]*TO\s+authenticated/i);
      expect(acl).toMatch(/GRANT\s+(?:ALL|EXECUTE)[\s\S]*TO\s+service_role/i);
    }
  });

  it("canonical PMG create wrappers revoke PUBLIC/anon and retain authenticated plus service runtime access", () => {
    for (const name of ["apply_blocker_create", "apply_risk_create"]) {
      const acl = functionAcl(name);
      expect(acl).toMatch(/REVOKE\s+ALL[\s\S]*FROM\s+PUBLIC/i);
      expect(acl).not.toMatch(/GRANT\s+(?:ALL|EXECUTE)[^;]*TO\s+anon/i);
      expect(acl).toMatch(/GRANT\s+(?:ALL|EXECUTE)[\s\S]*TO\s+authenticated/i);
      expect(acl).toMatch(/GRANT\s+(?:ALL|EXECUTE)[\s\S]*TO\s+service_role/i);
    }
  });
});
