/**
 * API-ADM.4 — Focused contract tests for the reusable Connected App management shell.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CONNECTED_APP_MANAGEMENT_TABS,
  DEFAULT_CONNECTED_APP_MANAGEMENT_TAB,
  resolveConnectedAppManagementTab,
  connectedAppConnectionLabel,
} from "../ConnectedAppManagementView";

const SOURCE = readFileSync(
  resolve(__dirname, "../ConnectedAppManagementView.tsx"),
  "utf8",
);

describe("API-ADM.4 tab contract", () => {
  it("exposes exactly three tabs in the approved order", () => {
    expect(CONNECTED_APP_MANAGEMENT_TABS.map((t) => t.value)).toEqual([
      "overview",
      "access",
      "activity",
    ]);
    expect(CONNECTED_APP_MANAGEMENT_TABS.map((t) => t.label)).toEqual([
      "Overview",
      "Access & permissions",
      "API activity",
    ]);
  });

  it("defaults to overview", () => {
    expect(DEFAULT_CONNECTED_APP_MANAGEMENT_TAB).toBe("overview");
    expect(resolveConnectedAppManagementTab(undefined)).toBe("overview");
    expect(resolveConnectedAppManagementTab(null)).toBe("overview");
  });

  it("resolves invalid tabs to overview and preserves valid ones", () => {
    expect(resolveConnectedAppManagementTab("nope")).toBe("overview");
    expect(resolveConnectedAppManagementTab("OVERVIEW")).toBe("overview");
    expect(resolveConnectedAppManagementTab(42)).toBe("overview");
    expect(resolveConnectedAppManagementTab("access")).toBe("access");
    expect(resolveConnectedAppManagementTab("activity")).toBe("activity");
  });

  it("maps connection labels safely", () => {
    expect(connectedAppConnectionLabel("enabled")).toBe("Connected");
    expect(connectedAppConnectionLabel("disabled")).toBe("Disabled");
    expect(connectedAppConnectionLabel(null)).toBe("Not connected");
  });
});

describe("API-ADM.4 Overview fields", () => {
  it("renders the approved summary labels", () => {
    for (const label of [
      "Application status",
      "Organization connection",
      "Active policy version",
      "Workspaces enabled",
      "Projects enabled",
      "Enabled permissions",
    ]) {
      expect(SOURCE).toContain(`label="${label}"`);
    }
    expect(SOURCE).toContain("app.displayName");
    expect(SOURCE).toContain("organizationName");
    expect(SOURCE).toContain("app.description");
  });
});

describe("API-ADM.4 Access & permissions shell", () => {
  it("states the WHERE information architecture and delegates permissions (ADM.5A)", () => {
    expect(SOURCE).toContain("Where the application can operate.");
    expect(SOURCE).toContain('label="Organization access"');
    expect(SOURCE).toContain("<ConnectedAppOrganizationPermissions");
    expect(SOURCE).not.toMatch(/coming soon/i);
    expect(SOURCE).not.toMatch(/\bEnable<\/Button>|\bDisable<\/Button>/);
  });
});


describe("API-ADM.4 activity reuse", () => {
  it("renders ApiClientActivityPanel in organization mode with explicit props", () => {
    expect(SOURCE).toContain("import { ApiClientActivityPanel }");
    expect(SOURCE).toContain("<ApiClientActivityPanel");
    expect(SOURCE).toContain('mode="organization"');
    expect(SOURCE).toContain("apiClientId={app.apiClientId}");
    expect(SOURCE).toContain("organizationId={organizationId}");
    expect(SOURCE).not.toContain('mode="platform"');
    expect(SOURCE).not.toContain("useApiClientActivity");
  });
});

describe("API-ADM.4 containment", () => {
  it("performs no Supabase, RPC or mutation access", () => {
    expect(SOURCE).not.toContain("integrations/supabase");
    expect(SOURCE).not.toContain("supabase");
    expect(SOURCE).not.toContain(".rpc(");
    expect(SOURCE).not.toContain("useMutation");
    for (const rpc of [
      "api_g_5_7_admin_transition_workspace_client_capability",
      "api_g_5_8b",
      "api_g_5_8c",
      "api_g_5_8d",
    ]) {
      expect(SOURCE).not.toContain(rpc);
    }
  });

  it("does not import ActiveContext or admin-role helpers", () => {
    const imports = SOURCE.split("\n").filter((l) => l.trimStart().startsWith("import "));
    const importBlock = imports.join("\n");
    expect(importBlock).not.toContain("ActiveContext");
    expect(importBlock).not.toContain("useIsOrgAdmin");
    expect(importBlock).not.toContain("useIsTenantAdmin");
    expect(SOURCE).not.toContain("useIsOrgAdmin(");
  });

  it("uses no persistence APIs", () => {
    for (const api of ["localStorage", "sessionStorage", "indexedDB", "useSearchParams"]) {
      expect(SOURCE).not.toContain(api);
    }
  });
});

describe("API-ADM.6A production wiring", () => {
  it("is wired into the Organization Connected Apps page only", () => {
    const list = readFileSync(resolve(__dirname, "../ConnectedAppsOrganizationSurface.tsx"), "utf8");
    expect(list).toContain("ConnectedAppManagementView");
    const platform = readFileSync(
      resolve(__dirname, "../AdminPlatformApiClientDetail.tsx"),
      "utf8",
    );
    expect(platform).not.toContain("ConnectedAppManagementView");
  });
});
