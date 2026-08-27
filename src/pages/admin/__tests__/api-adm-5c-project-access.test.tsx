/**
 * Step API-ADM.5C — focused behavior + containment tests for unified Project
 * access administration inside the Workspace Manage Sheet.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ConnectedAppProjectAccess from "../ConnectedAppProjectAccess";
import {
  ORGANIZATION_PARENT_NOTICE,
  WORKSPACE_PARENT_NOTICE,
  resolveProjectRowAction,
} from "../connectedAppProjectAccessModel";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

const ORG = "11111111-1111-4111-8111-111111111111";
const CLIENT = "33333333-3333-4333-8333-333333333333";
const WORKSPACE = "44444444-4444-4444-8444-444444444444";
const PROJECT = "55555555-5555-4555-8555-555555555555";

const PROJECT_LIST_RPC = "api_g_5_7_admin_list_workspace_client_projects";
const PROJECT_TRANSITION_RPC = "api_g_5_7_admin_transition_project_client";

const PROJECT_ACCESS_SOURCE = readFileSync(
  resolve(__dirname, "../ConnectedAppProjectAccess.tsx"),
  "utf8",
);
const WORKSPACE_ACCESS_SOURCE = readFileSync(
  resolve(__dirname, "../ConnectedAppWorkspaceAccess.tsx"),
  "utf8",
);
const SHELL_SOURCE = readFileSync(
  resolve(__dirname, "../ConnectedAppManagementView.tsx"),
  "utf8",
);

function projectRow(overrides: Record<string, unknown> = {}) {
  return {
    project_id: PROJECT,
    project_name: "Test",
    project_is_archived: false,
    project_enablement_status: "enabled",
    project_enabled_at: null,
    project_disabled_at: null,
    total_count: 1,
    ...overrides,
  };
}

function renderAccess(props: Partial<Record<string, unknown>> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const spy = vi.spyOn(queryClient, "invalidateQueries");
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <ConnectedAppProjectAccess
        organizationId={ORG}
        apiClientId={CLIENT}
        workspaceId={WORKSPACE}
        workspaceName="Delivery"
        organizationEnablementStatus="enabled"
        workspaceEnablementStatus="enabled"
        {...(props as any)}
      />
    </QueryClientProvider>,
  );
  return { ...utils, queryClient, spy };
}

beforeEach(() => {
  cleanup();
  rpc.mockReset();
});

describe("API-ADM.5C — Project list contract", () => {
  it("uses exactly the accepted Project list and transition RPCs", () => {
    const rpcNames = Array.from(
      PROJECT_ACCESS_SOURCE.matchAll(/"(api_[a-z0-9_]+)"/g),
      (m) => m[1],
    );
    expect(new Set(rpcNames)).toEqual(
      new Set([PROJECT_LIST_RPC, PROJECT_TRANSITION_RPC]),
    );
  });

  it("sends exactly the accepted list arguments", async () => {
    rpc.mockResolvedValue({ data: [projectRow()], error: null });
    renderAccess();
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    const [name, args] = rpc.mock.calls[0];
    expect(name).toBe(PROJECT_LIST_RPC);
    expect(Object.keys(args).sort()).toEqual([
      "_api_client_id",
      "_include_archived",
      "_limit",
      "_offset",
      "_organization_id",
      "_workspace_id",
    ]);
    expect(args).toMatchObject({
      _organization_id: ORG,
      _workspace_id: WORKSPACE,
      _api_client_id: CLIENT,
      _include_archived: false,
      _offset: 0,
    });
  });

  it("keys the query by organization, application, workspace, filter and page", () => {
    const key = PROJECT_ACCESS_SOURCE.slice(
      PROJECT_ACCESS_SOURCE.indexOf("queryKey: ["),
      PROJECT_ACCESS_SOURCE.indexOf("enabled: !!organizationId"),
    );
    expect(key).toContain('"connected-app-project-access"');
    expect(key).toContain("organizationId");
    expect(key).toContain("apiClientId");
    expect(key).toContain("workspaceId");
    expect(key).toContain("includeArchived");
    expect(key).toContain("page");
  });

  it("introduces no cross-context placeholder reuse", () => {
    expect(PROJECT_ACCESS_SOURCE).not.toContain("placeholderData");
    expect(PROJECT_ACCESS_SOURCE).not.toContain("keepPreviousData");
  });

  it("does not query Projects or enablements directly and exposes no enablement IDs", () => {
    expect(PROJECT_ACCESS_SOURCE).not.toContain(".from(");
    expect(PROJECT_ACCESS_SOURCE).not.toContain("project_enablement_id");
  });
});

describe("API-ADM.5C — mutation identity and gating", () => {
  it("takes the Project ID only from the authorized row and sends the exact context", async () => {
    rpc.mockResolvedValue({ data: [projectRow()], error: null });
    renderAccess();
    const disable = await screen.findByRole("button", { name: "Disable" });
    fireEvent.click(disable);
    rpc.mockClear();
    rpc.mockResolvedValue({ data: null, error: null });
    fireEvent.click(await screen.findByRole("button", { name: "Disable" }));
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    const [name, args] = rpc.mock.calls[0];
    expect(name).toBe(PROJECT_TRANSITION_RPC);
    expect(args).toEqual({
      _organization_id: ORG,
      _workspace_id: WORKSPACE,
      _project_id: PROJECT,
      _api_client_id: CLIENT,
      _target_lifecycle_status: "disabled",
    });
    expect(PROJECT_ACCESS_SOURCE).not.toContain("<Input");
  });

  it("invalidates the Project access and Workspace access queries on success", async () => {
    rpc.mockResolvedValue({ data: [projectRow()], error: null });
    const { spy } = renderAccess();
    fireEvent.click(await screen.findByRole("button", { name: "Disable" }));
    rpc.mockResolvedValue({ data: null, error: null });
    fireEvent.click(await screen.findByRole("button", { name: "Disable" }));
    await waitFor(() => {
      const keys = spy.mock.calls.map((c: any) => JSON.stringify(c[0]?.queryKey));
      expect(keys).toContain(
        JSON.stringify(["connected-app-project-access", ORG, CLIENT, WORKSPACE]),
      );
      expect(keys).toContain(
        JSON.stringify(["connected-app-workspace-access", ORG, CLIENT]),
      );
    });
  });

  it("preserves the accepted resolveProjectRowAction behavior", () => {
    expect(resolveProjectRowAction("enabled", "enabled", "enabled", false).kind).toBe("disable");
    expect(resolveProjectRowAction("disabled", "enabled", "enabled", false).kind).toBe("reenable");
    expect(resolveProjectRowAction(null, "enabled", "enabled", false).kind).toBe("enable");
    // Organization disabled fails closed.
    expect(resolveProjectRowAction(null, "disabled", "enabled", false).target).toBeNull();
    // Workspace disabled fails closed.
    expect(resolveProjectRowAction(null, "enabled", null, false).target).toBeNull();
    // Archived Projects cannot be newly enabled.
    expect(resolveProjectRowAction(null, "enabled", "enabled", true).target).toBeNull();
    // Enabled retained Project remains disableable.
    expect(resolveProjectRowAction("enabled", "disabled", null, true).target).toBe("disabled");
    // Unknown lifecycle fails closed.
    expect(resolveProjectRowAction("weird", "enabled", "enabled", false).kind).toBe("unavailable");
  });

  it("renders Unavailable when the Workspace is not enabled", async () => {
    rpc.mockResolvedValue({
      data: [projectRow({ project_enablement_status: null })],
      error: null,
    });
    renderAccess({ workspaceEnablementStatus: "disabled" });
    expect(await screen.findByRole("button", { name: "Unavailable" })).toBeDisabled();
  });
});

describe("API-ADM.5C — presentation containment", () => {
  it("uses the accepted parent notices", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    expect(PROJECT_ACCESS_SOURCE).toContain("resolveProjectParentNotice");
    renderAccess({ organizationEnablementStatus: "disabled" });
    expect(await screen.findByText(ORGANIZATION_PARENT_NOTICE)).toBeInTheDocument();
    cleanup();
    renderAccess({ workspaceEnablementStatus: null });
    expect(await screen.findByText(WORKSPACE_PARENT_NOTICE)).toBeInTheDocument();
  });

  it("preserves Show archived, defaulting to off and resetting on context change", async () => {
    rpc.mockResolvedValue({ data: [projectRow()], error: null });
    renderAccess();
    const toggle = await screen.findByLabelText("Show archived");
    expect(toggle).toHaveAttribute("data-state", "unchecked");
    expect(PROJECT_ACCESS_SOURCE).toMatch(
      /\[organizationId, apiClientId, workspaceId\]/,
    );
    expect(PROJECT_ACCESS_SOURCE).toContain("setIncludeArchived(false);");
  });

  it("never renders Project UUIDs", async () => {
    rpc.mockResolvedValue({ data: [projectRow()], error: null });
    const { container } = renderAccess();
    await screen.findByText("Test");
    expect(container.innerHTML).not.toContain(PROJECT);
  });

  it("introduces no Project capability system and no client-only search", () => {
    expect(PROJECT_ACCESS_SOURCE).not.toContain("capability");
    expect(PROJECT_ACCESS_SOURCE.toLowerCase()).not.toContain("search");
    expect(PROJECT_ACCESS_SOURCE).not.toContain(".filter(");
  });

  it("uses no browser persistence and no role inference", () => {
    expect(PROJECT_ACCESS_SOURCE).not.toContain("localStorage");
    expect(PROJECT_ACCESS_SOURCE).not.toContain("sessionStorage");
    expect(PROJECT_ACCESS_SOURCE).not.toContain("ActiveContext");
    expect(PROJECT_ACCESS_SOURCE).not.toContain("useIsOrgAdmin");
    expect(PROJECT_ACCESS_SOURCE).not.toContain("useIsTenantAdmin");
  });
});

describe("API-ADM.5C — integration boundaries", () => {
  it("embeds Project access in the existing Workspace Sheet with no extra overlay", () => {
    expect(WORKSPACE_ACCESS_SOURCE).toContain("<ConnectedAppProjectAccess");
    expect(WORKSPACE_ACCESS_SOURCE).not.toContain("Projects enabled");
    expect(WORKSPACE_ACCESS_SOURCE.match(/<Sheet\b/g)?.length).toBe(1);
    expect(PROJECT_ACCESS_SOURCE).not.toContain("<Sheet");
    expect(PROJECT_ACCESS_SOURCE).not.toContain("<Dialog");
    expect(PROJECT_ACCESS_SOURCE).toContain("<AlertDialog");
  });

  it("keeps ConnectedAppManagementView free of Supabase and RPC access", () => {
    expect(SHELL_SOURCE).not.toContain("supabase");
    expect(SHELL_SOURCE).not.toContain("api_g_5_7");
  });

  it("API-ADM.6B — sources Project contracts from the pure Project access model", () => {
    expect(PROJECT_ACCESS_SOURCE).toContain('from "./connectedAppProjectAccessModel"');
    expect(PROJECT_ACCESS_SOURCE).not.toContain("ConnectedAppProjectScopeDialog");
    const model = readFileSync(
      resolve(__dirname, "../connectedAppProjectAccessModel.ts"),
      "utf8",
    );
    expect(model).toContain("export function resolveProjectRowAction");
    expect(model).toContain("export function resolveProjectParentNotice");
    for (const banned of ["react", "supabase", "@tanstack/react-query"]) {
      expect(model).not.toContain(banned);
    }
  });
});
