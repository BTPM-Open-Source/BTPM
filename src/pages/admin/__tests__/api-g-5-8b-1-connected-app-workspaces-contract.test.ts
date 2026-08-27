import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  archiveStatusLabel,
  accessLabel,
  accessVariant,
  resolveWorkspaceRowAction,
  resolveWorkspacePlaceholder,
  ARCHIVED_BLOCK_REASON,
  ORGANIZATION_BLOCK_REASON,
  UNKNOWN_STATE_REASON,
  WORKSPACE_SCOPE_PAGE_SIZE,
} from "../connectedAppWorkspaceAccessModel";

/**
 * Step API-G.5.8B-1 / API-G.5.8B-2 — Connected App Workspace access contract.
 *
 * Step API-ADM.6B repointed this historical coverage from the retired Workspace
 * scope dialog to the current production Workspace access surface plus the pure
 * Workspace access model. Assertions that only proved the old dialog UI existed
 * were removed; the read/write contract, containment and fail-closed lifecycle
 * coverage is preserved.
 */

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const ACCESS_PATH = "src/pages/admin/ConnectedAppWorkspaceAccess.tsx";
const MODEL_PATH = "src/pages/admin/connectedAppWorkspaceAccessModel.ts";
// API-ADM.8 — Organization Connected Apps orchestration lives in the shared surface.
const PAGE_PATH = "src/pages/admin/ConnectedAppsOrganizationSurface.tsx";

const access = read(ACCESS_PATH);
const model = read(MODEL_PATH);
const page = read(PAGE_PATH);
const types = read("src/integrations/supabase/types.ts");

const WORKSPACE_LIST_RPC = "api_g_5_7_admin_list_organization_client_workspaces";
const ORG_TRANSITION_RPC = "api_g_5_7_admin_transition_organization_client";
const WORKSPACE_TRANSITION_RPC = "api_g_5_7_admin_transition_workspace_client";

const FORBIDDEN_MUTATION_RPCS = [
  "api_g_5_7_admin_transition_organization_client_capability",
  "api_g_5_7_admin_transition_workspace_client_capability",
];

describe("surface existence and entry point", () => {
  it("the production Workspace access surface and pure model exist", () => {
    expect(existsSync(resolve(process.cwd(), ACCESS_PATH))).toBe(true);
    expect(existsSync(resolve(process.cwd(), MODEL_PATH))).toBe(true);
  });

  it("API-ADM.6B — the retired Workspace scope dialog is gone from the repository", () => {
    expect(
      existsSync(resolve(process.cwd(), "src/pages/admin/ConnectedAppWorkspaceScopeDialog.tsx")),
    ).toBe(false);
    expect(access).not.toContain("ConnectedAppWorkspaceScopeDialog");
    expect(page).not.toContain("ConnectedAppWorkspaceScopeDialog");
  });

  it("API-ADM.6A — the legacy View scope entry point stays retired from the list", () => {
    expect(page).not.toContain("View scope");
    expect(page).not.toContain("openWorkspaceScope");
    expect(page).toContain("Manage");
  });

  it("preserves the accepted Organization connection actions", () => {
    for (const label of ["Connect", "Reconnect", "Unavailable"]) {
      expect(page).toContain(label);
    }
    expect(page).toContain(ORG_TRANSITION_RPC);
    expect(page).toContain("resolveRowAction");
  });
});

describe("read and write contract", () => {
  it("uses exactly the accepted Workspace list and transition RPCs", () => {
    expect(access).toContain(WORKSPACE_LIST_RPC);
    expect(access).toContain(WORKSPACE_TRANSITION_RPC);
    const rpcCalls = access.match(/supabase\.rpc as any\)\(/g) ?? [];
    expect(rpcCalls.length).toBe(2);
  });

  it("sends exactly the accepted list and transition arguments", () => {
    for (const arg of [
      "_organization_id:",
      "_api_client_id:",
      "_include_archived:",
      "_limit:",
      "_offset:",
      "_workspace_id:",
      "_target_lifecycle_status:",
    ]) {
      expect(access).toContain(arg);
    }
  });

  it("invokes no capability or Project mutation RPC", () => {
    for (const rpc of FORBIDDEN_MUTATION_RPCS) {
      expect(access).not.toContain(rpc);
    }
    expect(access).not.toContain("api_g_5_7_admin_transition_project_client");
  });

  it("never touches tables directly and performs no optimistic writes", () => {
    expect(access).not.toMatch(/supabase\s*\.\s*from\s*\(/);
    expect(access).not.toMatch(/\.insert\(|\.update\(|\.delete\(|\.upsert\(/);
    expect(access).not.toContain("onMutate");
    expect(access).not.toContain("setQueryData");
    expect(access).not.toContain("queryClient.clear");
    expect(access).not.toContain("removeQueries");
  });

  it("keeps the accepted RPCs available in generated types", () => {
    expect(types).toContain(WORKSPACE_LIST_RPC);
    expect(types).toContain(WORKSPACE_TRANSITION_RPC);
  });
});

describe("context containment", () => {
  it("scopes query identity to the explicit Organization and application", () => {
    expect(access).toContain('"connected-app-workspace-access",');
    expect(access).toContain("enabled: !!organizationId && !!apiClientId");
    expect(access).toContain("staleTime: 30_000");
  });

  it("resets pagination, filter, pending action and Sheet on context change", () => {
    expect(access).toContain("}, [organizationId, apiClientId]);");
    expect(access).toContain("setPage(0);");
    expect(access).toContain("setIncludeArchived(false);");
    expect(access).toContain("setPendingAction(null);");
    expect(access).toContain("setManaged(null);");
  });

  it("refuses to execute a stale-context mutation", () => {
    expect(access).toContain('if (action.organizationId !== organizationId) throw new Error("context_mismatch");');
    expect(access).toContain('if (action.apiClientId !== apiClientId) throw new Error("context_mismatch");');
    expect(access).toContain('if (!action.workspaceId) throw new Error("context_mismatch");');
  });

  it("takes Workspace identity only from an authorized list row", () => {
    const block = access.slice(
      access.indexOf("const openWorkspaceAction"),
      access.indexOf("const openManage"),
    );
    expect(block).toContain("workspaceId: row.workspace_id");
    expect(block).not.toContain("prompt(");
    expect(block).not.toContain("input");
  });

  it("invalidates only the scoped Workspace access list and the parent summary", () => {
    const block = access.slice(
      access.indexOf("onSuccess: async (action)"),
      access.indexOf("onError: (err: any, action)"),
    );
    expect(block).toContain(
      'queryKey: ["connected-app-workspace-access", action.organizationId, action.apiClientId],',
    );
    expect(block).toContain('queryKey: ["connected-apps", action.organizationId],');
  });
});

describe("presentation and disclosure", () => {
  it("presents only safe list fields", () => {
    expect(access).toContain("row.workspace_name");
    expect(access).toContain("row.workspace_enablement_status");
    expect(access).toContain("row.workspace_is_archived");
    expect(access).not.toContain("workspace_enablement_id");
    expect(access).not.toContain("client_secret");
    expect(access.toLowerCase()).not.toContain("astra");
  });

  it("derives counts from backend fields without client aggregation", () => {
    expect(access).toContain("row.enabled_project_count");
    expect(access).toContain("row.enabled_capability_grant_count");
    expect(access).not.toMatch(/\.reduce\(/);
  });

  it("shows a generic load error only", () => {
    expect(access).toContain("Failed to load Workspace access.");
    expect(access).not.toContain("error.message");
    expect(access).not.toContain("error?.message");
    expect(access).not.toContain("JSON.stringify(error");
  });

  it("keeps a bounded, backend-paged list with Show archived off by default", () => {
    expect(model).toContain("export const WORKSPACE_SCOPE_PAGE_SIZE = 25;");
    expect(WORKSPACE_SCOPE_PAGE_SIZE).toBe(25);
    expect(access).toContain("Show archived");
    expect(access).toContain("useState(false)");
    expect(access).toContain("Number(rows[0].total_count ?? 0)");
    expect(access).toContain("const canNext = rangeEnd < totalCount;");
    expect(access).not.toContain(".slice(");
  });

  it("adds no Organization connection action to the Workspace surface", () => {
    expect(access).not.toMatch(/>\s*Connect\s*</);
    expect(access).not.toMatch(/>\s*Reconnect\s*</);
    expect(access).not.toMatch(/>\s*Disconnect\s*</);
  });
});

describe("pure Workspace access model", () => {
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

  it("labels archive status independently of enablement", () => {
    expect(archiveStatusLabel(true)).toBe("Archived");
    expect(archiveStatusLabel(false)).toBe("Not archived");
    expect(archiveStatusLabel(null)).toBe("Not archived");
  });

  it("maps only accepted access values and fails closed otherwise", () => {
    expect(accessLabel("enabled")).toBe("Enabled");
    expect(accessLabel("disabled")).toBe("Disabled");
    expect(accessLabel(null)).toBe("Not enabled");
    expect(accessLabel("weird")).toBe("Not enabled");
    expect(accessVariant("enabled")).toBe("default");
    expect(accessVariant("disabled")).toBe("secondary");
    expect(accessVariant(null)).toBe("outline");
  });

  it("keeps fail-closed Workspace action semantics unchanged", () => {
    expect(resolveWorkspaceRowAction("enabled", "disabled", true)).toEqual({
      kind: "disable",
      label: "Disable",
      target: "disabled",
      reason: null,
    });
    expect(resolveWorkspaceRowAction(null, "enabled", false)).toEqual({
      kind: "enable",
      label: "Enable",
      target: "enabled",
      reason: null,
    });
    expect(resolveWorkspaceRowAction("disabled", "enabled", false)).toEqual({
      kind: "reenable",
      label: "Re-enable",
      target: "enabled",
      reason: null,
    });
    expect(resolveWorkspaceRowAction(null, "enabled", true)).toEqual({
      kind: "unavailable",
      label: "Unavailable",
      target: null,
      reason: ARCHIVED_BLOCK_REASON,
    });
    expect(resolveWorkspaceRowAction(null, null, false)).toEqual({
      kind: "unavailable",
      label: "Unavailable",
      target: null,
      reason: ORGANIZATION_BLOCK_REASON,
    });
    expect(resolveWorkspaceRowAction("pending", "enabled", false)).toEqual({
      kind: "unavailable",
      label: "Unavailable",
      target: null,
      reason: UNKNOWN_STATE_REASON,
    });
  });

  it("never reuses rows across Organizations or applications", () => {
    const rows: any = [{ workspace_id: "w1" }];
    expect(resolveWorkspacePlaceholder(rows, ["k", "org", "client"], "org", "client")).toBe(rows);
    expect(resolveWorkspacePlaceholder(rows, ["k", "other", "client"], "org", "client")).toBe(
      undefined,
    );
    expect(resolveWorkspacePlaceholder(rows, ["k", "org", "other"], "org", "client")).toBe(
      undefined,
    );
    expect(resolveWorkspacePlaceholder(rows, undefined, "org", "client")).toBe(undefined);
    expect(resolveWorkspacePlaceholder(rows, ["k", "org", "client"], null, "client")).toBe(
      undefined,
    );
  });
});
