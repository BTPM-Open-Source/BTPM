/** API-Q Portfolio-12A — current-state Organization command-capability alignment. */
import { describe, it, expect } from "vitest";
import {
  resolveCapabilityRowAction,
  type OrganizationClientCapabilityRow,
} from "../connectedAppOrganizationPermissionsModel";
import { currentFunction } from "../../../test/ossSqlContract";

type EligibilityRow = Pick<
  OrganizationClientCapabilityRow,
  | "grant_status"
  | "supported_capability_status"
  | "catalogue_lifecycle_status"
  | "administrator_assignable"
  | "scope_level"
  | "capability_kind"
>;

function row(overrides: Partial<EligibilityRow> = {}): EligibilityRow {
  return {
    grant_status: null,
    supported_capability_status: "enabled",
    catalogue_lifecycle_status: "active",
    administrator_assignable: true,
    scope_level: "organization",
    capability_kind: "read",
    ...overrides,
  };
}

const TRANSITION = currentFunction("api_g_5_7_admin_transition_organization_client_capability");

describe("Portfolio-12A Organization capability eligibility", () => {
  it("keeps eligible read and command capabilities actionable", () => {
    expect(resolveCapabilityRowAction(row(), "active", "enabled").kind).toBe("enable");
    expect(resolveCapabilityRowAction(row({ capability_kind: "command" }), "active", "enabled").kind).toBe("enable");
    expect(resolveCapabilityRowAction(
      row({ capability_kind: "command", grant_status: "disabled" }), "active", "enabled",
    ).kind).toBe("reenable");
  });

  it("keeps lower scopes, unsupported/inactive/non-assignable capabilities unavailable", () => {
    for (const scope_level of ["workspace", "project"]) {
      expect(resolveCapabilityRowAction(row({ scope_level }), "active", "enabled").kind).toBe("unavailable");
    }
    for (const override of [
      { supported_capability_status: "disabled" },
      { catalogue_lifecycle_status: "retired" },
      { administrator_assignable: false },
    ] as Partial<EligibilityRow>[]) {
      expect(resolveCapabilityRowAction(row({ capability_kind: "command", ...override }), "active", "enabled").kind)
        .toBe("unavailable");
    }
  });
});

describe("Portfolio-12A backend transition", () => {
  it("is generic across read/command kinds with no kind allowlist", () => {
    expect(TRANSITION).not.toMatch(/capability_kind\s*=\s*'read'/i);
    expect(TRANSITION).not.toMatch(/capability_kind\s+IN\s*\(/i);
    expect(TRANSITION).not.toMatch(/capability_kind\s*=\s*'command'/i);
  });

  it("retains supported/active/admin-assignable Organization eligibility", () => {
    expect(TRANSITION).toContain("s.lifecycle_status = 'enabled'");
    expect(TRANSITION).toContain("cat.lifecycle_status = 'active'");
    expect(TRANSITION).toContain("cat.administrator_assignable = true");
    expect(TRANSITION).toContain("cat.scope_level = 'organization'");
  });

  it("retains Tenant/Admin/Organization containment, locking and security posture", () => {
    for (const token of [
      "public.is_tenant_admin", "public.is_org_admin", "organization_client_not_enabled",
      "pg_advisory_xact_lock", "g.workspace_id IS NULL", "SECURITY DEFINER",
      "SET search_path TO 'public', 'pg_catalog'",
    ]) expect(TRANSITION).toContain(token);
  });
});
