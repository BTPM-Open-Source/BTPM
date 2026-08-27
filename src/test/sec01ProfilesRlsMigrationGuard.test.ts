/**
 * SEC-01 — current-state static guard for profile read containment.
 *
 * The OSS baseline is consolidated, so this guard inspects the installed
 * can_read_profile function and profiles SELECT policy rather than the
 * historical correction migration that originally introduced them.
 */
import { describe, it, expect } from "vitest";
import { currentFunction, functionAcl, policyDefinition } from "./ossSqlContract";

const FN = currentFunction("can_read_profile");
const ACL = functionAcl("can_read_profile");
const POLICY = policyDefinition("profiles_select_same_org", "profiles");

describe("SEC-01 can_read_profile helper", () => {
  it("is STABLE SECURITY DEFINER with a fixed public search_path", () => {
    expect(FN).toMatch(/FUNCTION\s+public\.can_read_profile\(_target_user_id uuid\)/i);
    expect(FN).toMatch(/RETURNS boolean/i);
    expect(FN).toMatch(/STABLE/i);
    expect(FN).toMatch(/SECURITY DEFINER/i);
    expect(FN).toMatch(/SET search_path TO 'public'/i);
  });

  it("fails closed for null identity and allows own profile", () => {
    expect(FN).toMatch(/auth\.uid\(\) IS NULL OR _target_user_id IS NULL THEN false/i);
    expect(FN).toMatch(/auth\.uid\(\) = _target_user_id THEN true/i);
  });

  it("does not use profiles.organization_id or legacy get_user_org_id fallback", () => {
    expect(FN).not.toMatch(/profiles\.organization_id/i);
    expect(FN).not.toMatch(/get_user_org_id/i);
    expect(FN).not.toMatch(/organization_id IS NULL/i);
  });

  it("requires active Organization membership for viewer and target in the same Organization/Tenant", () => {
    expect(FN).toMatch(/organization_memberships om_viewer/i);
    expect(FN).toMatch(/organization_memberships om_target/i);
    expect(FN).toMatch(/om_viewer\.status\s*=\s*'active'/i);
    expect(FN).toMatch(/om_target\.status\s*=\s*'active'/i);
    expect(FN).toMatch(/om_target\.organization_id\s*=\s*om_viewer\.organization_id/i);
    expect(FN).toMatch(/om_target\.tenant_id\s*=\s*om_viewer\.tenant_id/i);
    expect(FN).toMatch(/organizations o[\s\S]*o\.tenant_id\s*=\s*om_viewer\.tenant_id/i);
  });

  it("requires active Tenant membership for both viewer and target", () => {
    expect(FN).toMatch(/tenant_memberships tm_viewer/i);
    expect(FN).toMatch(/tenant_memberships tm_target/i);
    expect(FN).toMatch(/tm_viewer\.status\s*=\s*'active'/i);
    expect(FN).toMatch(/tm_target\.status\s*=\s*'active'/i);
  });

  it("revokes PUBLIC while browser/service roles cannot bypass auth.uid containment", () => {
    expect(ACL).toMatch(/REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.can_read_profile[^;]*FROM\s+PUBLIC/i);
    expect(ACL).toMatch(/GRANT\s+(?:ALL|EXECUTE)[^;]*TO\s+authenticated/i);
    expect(ACL).toMatch(/GRANT\s+(?:ALL|EXECUTE)[^;]*TO\s+service_role/i);
    // The current pg_dump grants function EXECUTE to anon, but the function's
    // first branch returns false when auth.uid() is null. The data-exposure
    // contract is therefore still fail-closed for anonymous callers.
    expect(FN).toMatch(/auth\.uid\(\) IS NULL[\s\S]*THEN false/i);
  });
});

describe("SEC-01 profiles SELECT policy", () => {
  it("uses only own-profile or can_read_profile containment", () => {
    expect(POLICY).toMatch(/FOR SELECT TO authenticated/i);
    expect(POLICY).toMatch(/id\s*=\s*auth\.uid\(\)/i);
    expect(POLICY).toMatch(/public\.can_read_profile\(id\)/i);
    expect(POLICY).not.toMatch(/get_user_org_id/i);
    expect(POLICY).not.toMatch(/organization_id IS NULL/i);
  });
});
