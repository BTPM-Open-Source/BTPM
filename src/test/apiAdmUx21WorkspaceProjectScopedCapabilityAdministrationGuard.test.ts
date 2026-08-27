/** API-ADM-UX2.1 — current-state Workspace capability administration guard. */
import { describe, it, expect } from "vitest";
import { currentFunction } from "./ossSqlContract";

const LIST = currentFunction("api_g_5_7_admin_list_workspace_client_capabilities");
const TRANSITION = currentFunction("api_g_5_7_admin_transition_workspace_client_capability");

describe("API-ADM-UX2.1 final Workspace administration contract", () => {
  it("keeps both functions SECURITY DEFINER with fixed search paths", () => {
    expect(LIST).toMatch(/STABLE SECURITY DEFINER/i);
    expect(LIST).toMatch(/SET search_path TO 'public', 'pg_catalog'/i);
    expect(TRANSITION).toMatch(/SECURITY DEFINER/i);
    expect(TRANSITION).toMatch(/SET search_path TO 'public', 'pg_catalog'/i);
  });

  it("treats Workspace and Project catalogue scopes as directly administrable at Workspace", () => {
    expect(LIST).toContain("scope_level IN ('workspace', 'project')");
    expect(TRANSITION).toContain("scope_level IN ('workspace', 'project')");
    expect(LIST).not.toContain("scope_level IN ('workspace', 'project', 'organization')");
  });

  it("keeps supported/active/admin-assignable eligibility gates", () => {
    for (const token of [
      "supported_capability_status = 'enabled'", "catalogue_lifecycle_status = 'active'",
      "administrator_assignable = true",
    ]) expect(LIST).toContain(token);
    for (const token of [
      "s.lifecycle_status = 'enabled'", "cat.lifecycle_status = 'active'",
      "cat.administrator_assignable = true",
    ]) expect(TRANSITION).toContain(token);
  });

  it("persists Workspace grant identity with no Project grant identity", () => {
    expect(TRANSITION).toContain("api_capability_grants");
    expect(TRANSITION).toContain("workspace_id");
    expect(TRANSITION).not.toContain("project_id");
  });

  it("preserves active Workspace containment and admin authority", () => {
    for (const token of [
      "public.is_active_user", "public.is_tenant_admin", "public.is_org_admin",
      "workspace_not_active", "organization_client_not_enabled", "workspace_client_not_enabled",
      "w.is_active = true", "w.is_archived = false",
    ]) expect(TRANSITION).toContain(token);
  });

  it("preserves locking, lifecycle transition and audit semantics", () => {
    for (const token of [
      "pg_advisory_xact_lock", "FOR UPDATE", "invalid_lifecycle_transition",
      "enable_workspace_capability", "disable_workspace_capability",
      "api_connected_apps_admin_audit_events",
    ]) expect(TRANSITION).toContain(token);
  });
});
