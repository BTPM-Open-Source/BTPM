import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  projectArchiveStatusLabel,
  projectAccessLabel,
  projectAccessVariant,
  resolveProjectParentNotice,
  resolveProjectRowAction,
  resolveProjectPlaceholder,
  ORGANIZATION_PARENT_NOTICE,
  WORKSPACE_PARENT_NOTICE,
  PROJECT_ARCHIVED_BLOCK_REASON,
  PROJECT_ORGANIZATION_BLOCK_REASON,
  PROJECT_WORKSPACE_BLOCK_REASON,
  PROJECT_UNKNOWN_STATE_REASON,
  PROJECT_ENABLE_ERROR,
  PROJECT_DISABLE_ERROR,
  PROJECT_SCOPE_PAGE_SIZE,
} from "../connectedAppProjectAccessModel";

/**
 * Step API-G.5.8C-1 — Connected App Project access contract.
 *
 * Step API-ADM.6B repointed this historical coverage from the retired Project
 * scope dialog to the current production Project access surface (rendered inside
 * the Workspace Manage Sheet) plus the pure Project access model. Only
 * assertions that solely proved the old dialog UI existed were removed.
 */

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const PROJECT_ACCESS_PATH = "src/pages/admin/ConnectedAppProjectAccess.tsx";
const MODEL_PATH = "src/pages/admin/connectedAppProjectAccessModel.ts";
const WORKSPACE_ACCESS_PATH = "src/pages/admin/ConnectedAppWorkspaceAccess.tsx";
// API-ADM.8 — Organization Connected Apps orchestration lives in the shared surface.
const PAGE_PATH = "src/pages/admin/ConnectedAppsOrganizationSurface.tsx";

const project = read(PROJECT_ACCESS_PATH);
const model = read(MODEL_PATH);
const workspace = read(WORKSPACE_ACCESS_PATH);
const page = read(PAGE_PATH);
const types = read("src/integrations/supabase/types.ts");

const PROJECT_LIST_RPC = "api_g_5_7_admin_list_workspace_client_projects";
const PROJECT_TRANSITION_RPC = "api_g_5_7_admin_transition_project_client";

const FORBIDDEN_RPCS = [
  "api_g_5_7_admin_transition_organization_client",
  "api_g_5_7_admin_transition_workspace_client",
  "api_g_5_7_admin_transition_organization_client_capability",
  "api_g_5_7_admin_transition_workspace_client_capability",
];

describe("surface existence and reachability", () => {
  it("the production Project access surface and pure model exist", () => {
    expect(existsSync(resolve(process.cwd(), PROJECT_ACCESS_PATH))).toBe(true);
    expect(existsSync(resolve(process.cwd(), MODEL_PATH))).toBe(true);
  });

  it("API-ADM.6B — the retired Project scope dialog is gone from the repository", () => {
    expect(
      existsSync(resolve(process.cwd(), "src/pages/admin/ConnectedAppProjectScopeDialog.tsx")),
    ).toBe(false);
    expect(project).not.toContain("ConnectedAppProjectScopeDialog");
    expect(workspace).not.toContain("ConnectedAppProjectScopeDialog");
    expect(page).not.toContain("ConnectedAppProjectScopeDialog");
  });

  it("Project access is reached from the Workspace Manage Sheet only", () => {
    expect(workspace).toContain("<ConnectedAppProjectAccess");
    expect(workspace).toContain("<Sheet");
  });
});

describe("read and write contract", () => {
  it("uses exactly the accepted Project list and transition RPCs", () => {
    expect(project).toContain(PROJECT_LIST_RPC);
    expect(project).toContain(PROJECT_TRANSITION_RPC);
    const rpcCalls = project.match(/supabase\.rpc as any\)\(/g) ?? [];
    expect(rpcCalls.length).toBe(2);
  });

  it("sends exactly the accepted arguments", () => {
    for (const arg of [
      "_organization_id:",
      "_workspace_id:",
      "_api_client_id:",
      "_project_id:",
      "_include_archived:",
      "_limit:",
      "_offset:",
      "_target_lifecycle_status:",
    ]) {
      expect(project).toContain(arg);
    }
  });

  it("invokes no Organization, Workspace or capability transition RPC", () => {
    for (const rpc of FORBIDDEN_RPCS) {
      expect(project).not.toContain(rpc);
    }
  });

  it("never touches tables directly and performs no optimistic writes", () => {
    expect(project).not.toMatch(/supabase\s*\.\s*from\s*\(/);
    expect(project).not.toMatch(/\.insert\(|\.update\(|\.delete\(|\.upsert\(/);
    expect(project).not.toContain("onMutate");
    expect(project).not.toContain("setQueryData");
    expect(project).not.toContain("queryClient.clear");
    expect(project).not.toContain("removeQueries");
  });

  it("keeps the accepted RPCs available in generated types", () => {
    expect(types).toContain(PROJECT_LIST_RPC);
    expect(types).toContain(PROJECT_TRANSITION_RPC);
  });
});

describe("context containment", () => {
  it("scopes query identity to Organization, application and Workspace", () => {
    expect(project).toContain('"connected-app-project-access",');
    expect(project).toContain("enabled: !!organizationId && !!apiClientId && !!workspaceId");
  });

  it("refuses to execute a stale-context mutation", () => {
    expect(project).toContain('throw new Error("context_mismatch")');
    expect(project).toContain("action.organizationId !== organizationId");
    expect(project).toContain("action.apiClientId !== apiClientId");
    expect(project).toContain("action.workspaceId !== workspaceId");
  });

  it("takes Project identity only from an authorized list row", () => {
    expect(project).toContain("projectId: row.project_id");
    expect(project).not.toContain("prompt(");
  });

  it("exposes no enablement identifiers or Project UUIDs", () => {
    expect(project).not.toContain("project_enablement_id");
    expect(project).not.toContain(">{row.project_id}");
  });
});

describe("presentation and disclosure", () => {
  it("presents only safe list fields with backend paging", () => {
    expect(project).toContain("row.project_name");
    expect(project).toContain("row.project_enablement_status");
    expect(project).toContain("row.project_is_archived");
    expect(project).toContain("Number(rows[0].total_count ?? 0)");
    expect(project).not.toContain(".slice(");
    expect(model).toContain("export const PROJECT_SCOPE_PAGE_SIZE = 25;");
    expect(PROJECT_SCOPE_PAGE_SIZE).toBe(25);
  });

  it("shows a generic load error and the accepted action errors only", () => {
    expect(project).not.toContain("error.message");
    expect(project).not.toContain("JSON.stringify(error");
    expect(project).toContain("PROJECT_ENABLE_ERROR");
    expect(project).toContain("PROJECT_DISABLE_ERROR");
    expect(PROJECT_ENABLE_ERROR).toContain("Could not enable this Project.");
    expect(PROJECT_DISABLE_ERROR).toBe(
      "Could not disable this Project. Refresh the scope and try again.",
    );
  });

  it("adds no capability administration to the Project surface", () => {
    expect(project).not.toContain("capability");
    expect(project.toLowerCase()).not.toContain("astra");
  });
});

describe("pure Project access model", () => {
  it("is a dependency-free module", () => {
    for (const banned of [
      "react",
      "supabase",
      "@tanstack/react-query",
      "ActiveContext",
      "useIsOrgAdmin",
      "useIsTenantAdmin",
      "@/components/ui/dialog",
      "@/components/ui/sheet",
    ]) {
      expect(model).not.toContain(banned);
    }
  });

  it("preserves archive and access presentation", () => {
    expect(projectArchiveStatusLabel(true)).toBe("Archived");
    expect(projectArchiveStatusLabel(null)).toBe("Not archived");
    expect(projectAccessLabel("enabled")).toBe("Enabled");
    expect(projectAccessLabel("disabled")).toBe("Disabled");
    expect(projectAccessLabel("weird")).toBe("Not enabled");
    expect(projectAccessVariant("enabled")).toBe("default");
    expect(projectAccessVariant("disabled")).toBe("secondary");
    expect(projectAccessVariant(null)).toBe("outline");
  });

  it("preserves the most-restrictive-first parent notice", () => {
    expect(resolveProjectParentNotice(null, "enabled")).toBe(ORGANIZATION_PARENT_NOTICE);
    expect(resolveProjectParentNotice("disabled", "enabled")).toBe(ORGANIZATION_PARENT_NOTICE);
    expect(resolveProjectParentNotice("enabled", null)).toBe(WORKSPACE_PARENT_NOTICE);
    expect(resolveProjectParentNotice("enabled", "enabled")).toBe(null);
  });

  it("keeps fail-closed Project action semantics unchanged", () => {
    expect(resolveProjectRowAction("enabled", null, null, true)).toEqual({
      kind: "disable",
      label: "Disable",
      target: "disabled",
      reason: null,
    });
    expect(resolveProjectRowAction(null, "enabled", "enabled", false)).toEqual({
      kind: "enable",
      label: "Enable",
      target: "enabled",
      reason: null,
    });
    expect(resolveProjectRowAction("disabled", "enabled", "enabled", false)).toEqual({
      kind: "reenable",
      label: "Re-enable",
      target: "enabled",
      reason: null,
    });
    expect(resolveProjectRowAction(null, "enabled", "enabled", true).reason).toBe(
      PROJECT_ARCHIVED_BLOCK_REASON,
    );
    expect(resolveProjectRowAction(null, "disabled", "enabled", false).reason).toBe(
      PROJECT_ORGANIZATION_BLOCK_REASON,
    );
    expect(resolveProjectRowAction(null, "enabled", "disabled", false).reason).toBe(
      PROJECT_WORKSPACE_BLOCK_REASON,
    );
    expect(resolveProjectRowAction("pending", "enabled", "enabled", false).reason).toBe(
      PROJECT_UNKNOWN_STATE_REASON,
    );
  });

  it("never reuses rows across Organization, application or Workspace", () => {
    const rows: any = [{ project_id: "p1" }];
    expect(resolveProjectPlaceholder(rows, ["k", "o", "c", "w"], "o", "c", "w")).toBe(rows);
    expect(resolveProjectPlaceholder(rows, ["k", "x", "c", "w"], "o", "c", "w")).toBe(undefined);
    expect(resolveProjectPlaceholder(rows, ["k", "o", "x", "w"], "o", "c", "w")).toBe(undefined);
    expect(resolveProjectPlaceholder(rows, ["k", "o", "c", "x"], "o", "c", "w")).toBe(undefined);
    expect(resolveProjectPlaceholder(rows, ["k", "o", "c", "w"], "o", "c", null)).toBe(undefined);
  });
});
