/**
 * API-ADM-UX2.3 — Connected Apps final scope UX alignment and contract closure.
 *
 * Frontend/presentation only. Proves the accepted final administration model:
 *   Organization capability      -> actionable at Organization
 *   Workspace capability         -> actionable at Workspace
 *   Project capability           -> actionable at Workspace (exact Workspace grant)
 *   Project application access   -> actionable at Project
 *   Project capability grant     -> does NOT exist at Project
 *
 * No backend authorization is recomputed here and no migration is involved.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ConnectedAppOrganizationPermissions from "../ConnectedAppOrganizationPermissions";
import ConnectedAppWorkspacePermissions from "../ConnectedAppWorkspacePermissions";
import {
  WS_CAP_SCOPE_NOTICE,
  WS_PROJECT_SCOPE_EXPLANATION,
  partitionWorkspaceCapabilityRows,
  resolveWorkspaceCapabilityRowAction,
  workspaceLowerScopeManagedAtLabel,
  workspaceRuntimeScopeBadgeLabel,
} from "../connectedAppWorkspacePermissionsModel";
import {
  ORGANIZATION_LOWER_SCOPE_SECTION_DESCRIPTION,
  lowerScopeBadgeLabel,
  lowerScopeManagedAtLabel,
  partitionOrganizationCapabilityRows,
  resolveCapabilityRowAction,
} from "../connectedAppOrganizationPermissionsModel";
import { PROJECT_ACCESS_DESCRIPTION } from "../ConnectedAppProjectAccess";

const ORG = "11111111-1111-4111-8111-111111111111";
const CLIENT = "33333333-3333-4333-8333-333333333333";
const WS = "44444444-4444-4444-8444-444444444444";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const WS_PERMS = read("src/pages/admin/ConnectedAppWorkspacePermissions.tsx");
const ORG_PERMS = read("src/pages/admin/ConnectedAppOrganizationPermissions.tsx");
const PROJECT_ACCESS = read("src/pages/admin/ConnectedAppProjectAccess.tsx");
const PROJECT_MODEL = read("src/pages/admin/connectedAppProjectAccessModel.ts");

function baseRow(key: string, extra: Record<string, unknown> = {}) {
  return {
    api_version: "v1",
    capability_kind: "read",
    capability_key: key,
    display_name: `Display ${key}`,
    description: null,
    scope_level: "workspace",
    catalogue_lifecycle_status: "active",
    administrator_assignable: true,
    supported_capability_id: `sc-${key}`,
    supported_capability_status: "enabled",
    grant_id: null,
    grant_status: null,
    grant_enabled_at: null,
    grant_disabled_at: null,
    organization_grant_id: null,
    organization_grant_status: null,
    organization_grant_enabled_at: null,
    organization_grant_disabled_at: null,
    workspace_grant_id: null,
    workspace_grant_status: null,
    workspace_grant_enabled_at: null,
    workspace_grant_disabled_at: null,
    effective_grant_status: null,
    effective_grant_source: null,
    total_count: 1,
    ...extra,
  };
}

interface WsGates {
  readonly client?: string | null;
  readonly organization?: string | null;
  readonly workspace?: string | null;
  readonly archived?: boolean;
}

const wsAction = (extra: Record<string, unknown> = {}, gates: WsGates = {}) =>
  resolveWorkspaceCapabilityRowAction(
    baseRow("k:read", extra) as never,
    "client" in gates ? gates.client : "active",
    "organization" in gates ? gates.organization : "enabled",
    "workspace" in gates ? gates.workspace : "enabled",
    "archived" in gates ? gates.archived : false,
  );

function renderWithQuery(node: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>);
}

function renderWorkspacePermissions() {
  return renderWithQuery(
    <ConnectedAppWorkspacePermissions
      organizationId={ORG}
      apiClientId={CLIENT}
      workspaceId={WS}
      workspaceName="Delivery"
      clientLifecycleStatus="active"
      organizationEnablementStatus="enabled"
      workspaceEnablementStatus="enabled"
      workspaceIsArchived={false}
    />,
  );
}

beforeEach(() => rpc.mockReset());
afterEach(() => cleanup());

/* ------------------------------------------------------------------ 1-7 */
describe("UX2.3 — Workspace action eligibility", () => {
  it("1. permits an otherwise eligible Workspace-scoped capability", () => {
    expect(wsAction({ scope_level: "workspace" }).kind).toBe("enable");
  });

  it("2. permits an otherwise eligible Project-scoped capability", () => {
    expect(wsAction({ scope_level: "project" }).kind).toBe("enable");
    expect(
      wsAction({ scope_level: "project", workspace_grant_status: "disabled" }).kind,
    ).toBe("reenable");
    expect(
      wsAction({ scope_level: "project", workspace_grant_status: "enabled" }).kind,
    ).toBe("disable");
  });

  it("3. keeps an Organization-scoped capability non-actionable at Workspace", () => {
    expect(wsAction({ scope_level: "organization" }).kind).toBe("unavailable");
    expect(wsAction({ scope_level: "organization" }).target).toBeNull();
  });

  it("4. keeps an unknown scope non-actionable", () => {
    expect(wsAction({ scope_level: "weird" }).kind).toBe("unavailable");
    expect(wsAction({ scope_level: undefined as never }).kind).toBe("unavailable");
    expect(wsAction({ workspace_grant_status: "bogus" }).kind).toBe("unavailable");
  });

  it("5. keeps unsupported / inactive / non-assignable capabilities non-actionable", () => {
    for (const scope of ["workspace", "project"]) {
      expect(
        wsAction({ scope_level: scope, supported_capability_status: "disabled" }).kind,
      ).toBe("unavailable");
      expect(
        wsAction({ scope_level: scope, catalogue_lifecycle_status: "retired" }).kind,
      ).toBe("unavailable");
      expect(
        wsAction({ scope_level: scope, administrator_assignable: false }).kind,
      ).toBe("unavailable");
    }
  });

  it("6. keeps parent client / Organization / Workspace enablement gates required", () => {
    expect(wsAction({ scope_level: "project" }, { client: "suspended" }).kind).toBe(
      "unavailable",
    );
    expect(wsAction({ scope_level: "project" }, { organization: "disabled" }).kind).toBe(
      "unavailable",
    );
    expect(wsAction({ scope_level: "project" }, { workspace: null }).kind).toBe(
      "unavailable",
    );
  });

  it("7. keeps archived Workspaces blocked", () => {
    expect(
      wsAction({ scope_level: "project" }, { archived: true }).kind,
    ).toBe("unavailable");
  });
});

/* ------------------------------------------------------------------ 8-11 */
describe("UX2.3 — Workspace partitioning", () => {
  it("8-11. routes workspace+project to direct, organization to inherited, unknown to other", () => {
    const rows = [
      { scope_level: "workspace", capability_key: "a" },
      { scope_level: "project", capability_key: "b" },
      { scope_level: "organization", capability_key: "c" },
      { scope_level: "weird", capability_key: "d" },
    ] as never;
    const { direct, inherited, lowerScope } = partitionWorkspaceCapabilityRows(rows);
    expect(direct.map((r) => r.capability_key)).toEqual(["a", "b"]);
    expect(inherited.map((r) => r.capability_key)).toEqual(["c"]);
    expect(lowerScope.map((r) => r.capability_key)).toEqual(["d"]);
  });

  it("no longer describes any scope as Managed at Project", () => {
    expect(workspaceLowerScopeManagedAtLabel("project")).not.toBe("Managed at Project");
    expect(workspaceLowerScopeManagedAtLabel("weird")).toBe("Managed at another scope");
    expect(WS_PERMS).not.toContain("Managed at Project");
  });
});

/* ------------------------------------------------------------------ 12-18 */
describe("UX2.3 — Workspace presentation", () => {
  it("12/13/14. Project-scoped direct row shows Project scope, direct grant state, action and Project-access wording", async () => {
    rpc.mockResolvedValue({
      data: [
        baseRow("kpis:update", {
          scope_level: "project",
          capability_kind: "command",
          effective_grant_status: "enabled",
          effective_grant_source: "organization",
        }),
      ],
      error: null,
    });
    renderWorkspacePermissions();
    await waitFor(() => expect(screen.getByText("Display kpis:update")).toBeTruthy());

    expect(screen.getByTestId("ws-cap-runtime-scope-badge").textContent).toBe(
      "Project scope",
    );
    expect(screen.getByText("Direct Workspace permission")).toBeTruthy();
    expect(screen.getByText("Not granted")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Enable" })).toBeTruthy();
    expect(screen.getByTestId("ws-cap-project-scope-explanation").textContent).toBe(
      WS_PROJECT_SCOPE_EXPLANATION,
    );

    // No Organization-derived effective permission is presented.
    expect(screen.queryByText("Effective permission")).toBeNull();
    expect(screen.queryByText("Enabled · Organization")).toBeNull();
    expect(screen.queryByTestId("ws-cap-lower-scope-section")).toBeNull();
  });

  it("15. Workspace-scoped row retains the existing effective-permission presentation", async () => {
    rpc.mockResolvedValue({
      data: [
        baseRow("risks:create", {
          scope_level: "workspace",
          effective_grant_status: "enabled",
          effective_grant_source: "organization",
        }),
      ],
      error: null,
    });
    renderWorkspacePermissions();
    await waitFor(() => expect(screen.getByText("Display risks:create")).toBeTruthy());
    expect(screen.getByTestId("ws-cap-runtime-scope-badge").textContent).toBe(
      "Workspace scope",
    );
    expect(screen.getByText("Effective permission")).toBeTruthy();
    expect(screen.getByText("Enabled · Organization")).toBeTruthy();
  });

  it("16. Organization-scoped row stays inherited and read-only", async () => {
    rpc.mockResolvedValue({
      data: [
        baseRow("organizations:read", {
          scope_level: "organization",
          organization_grant_status: "enabled",
        }),
      ],
      error: null,
    });
    renderWorkspacePermissions();
    await waitFor(() => expect(screen.getByTestId("ws-cap-inherited-section")).toBeTruthy());
    expect(screen.getByText("Enabled by Organization")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Enable" })).toBeNull();
  });

  it("replaces the blanket additive notice with neutral scope wording", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    renderWorkspacePermissions();
    await waitFor(() => expect(screen.getByText(WS_CAP_SCOPE_NOTICE)).toBeTruthy());
    expect(WS_CAP_SCOPE_NOTICE).not.toContain("additive");
    expect(WS_PERMS).not.toContain("WS_CAP_ADDITIVE_NOTICE");
  });

  it("17/18. Project-scoped mutation uses the existing Workspace transition RPC only", async () => {
    rpc.mockResolvedValue({
      data: [baseRow("kpis:update", { scope_level: "project" })],
      error: null,
    });
    renderWorkspacePermissions();
    fireEvent.click(await screen.findByRole("button", { name: "Enable" }));
    rpc.mockResolvedValue({ data: null, error: null });
    fireEvent.click(screen.getAllByRole("button", { name: "Enable" }).slice(-1)[0]);

    await waitFor(() =>
      expect(
        rpc.mock.calls.some(
          (c) => c[0] === "api_g_5_7_admin_transition_workspace_client_capability",
        ),
      ).toBe(true),
    );
    expect([...new Set(rpc.mock.calls.map((c) => c[0]))].sort()).toEqual([
      "api_g_5_7_admin_list_workspace_client_capabilities",
      "api_g_5_7_admin_transition_workspace_client_capability",
    ]);
    // No Project-level capability RPC exists anywhere in this surface.
    expect(WS_PERMS).not.toContain("project_client_capabilit");
    expect(WS_PERMS).not.toContain("supabase.from(");
  });
});

/* ------------------------------------------------------------------ 19-20 */
describe("UX2.3 — scope-aware confirmation copy", () => {
  async function openConfirmation(extra: Record<string, unknown>, name: string) {
    rpc.mockResolvedValue({ data: [baseRow("kpis:update", extra)], error: null });
    renderWorkspacePermissions();
    fireEvent.click(await screen.findByRole("button", { name }));
  }

  it("19. Project-scoped enable explains Workspace grant plus Project access", async () => {
    await openConfirmation({ scope_level: "project" }, "Enable");
    const text = screen.getByRole("alertdialog").textContent ?? "";
    expect(text).toContain("in this Workspace");
    expect(text).toContain("Project access");
  });

  it("20. Project-scoped disable never claims an Organization permission remains effective", async () => {
    await openConfirmation(
      { scope_level: "project", workspace_grant_status: "enabled" },
      "Disable",
    );
    const text = screen.getByRole("alertdialog").textContent ?? "";
    expect(text).not.toContain("Organization permission remains effective");
    expect(text).toContain("Project application access alone");
    expect(text).toContain("not removed");
  });

  it("Workspace-scoped disable preserves the existing additive meaning", async () => {
    await openConfirmation(
      { scope_level: "workspace", workspace_grant_status: "enabled" },
      "Disable",
    );
    expect(screen.getByRole("alertdialog").textContent ?? "").toContain(
      "Organization permission remains effective",
    );
  });
});

/* ------------------------------------------------------------------ 21-25 */
describe("UX2.3 — Organization presentation", () => {
  const orgRow = (key: string, extra: Record<string, unknown> = {}) =>
    baseRow(key, { scope_level: "organization", ...extra });

  it("21. Organization-scoped row remains actionable", () => {
    expect(
      resolveCapabilityRowAction(orgRow("organizations:read") as never, "active", "enabled")
        .kind,
    ).toBe("enable");
  });

  it("22-25. Workspace and Project rows are read-only and Managed at Workspace", async () => {
    rpc.mockResolvedValue({
      data: [
        orgRow("organizations:read"),
        orgRow("workspaces:list", { scope_level: "workspace" }),
        orgRow("kpis:update", { scope_level: "project", capability_kind: "command" }),
      ],
      error: null,
    });
    renderWithQuery(
      <ConnectedAppOrganizationPermissions
        organizationId={ORG}
        apiClientId={CLIENT}
        clientLifecycleStatus="active"
        organizationEnablementStatus="enabled"
      />,
    );
    await waitFor(() => expect(screen.getByText("Display organizations:read")).toBeTruthy());

    // Only the Organization-scoped row is actionable (24).
    expect(screen.getAllByRole("button", { name: "Enable" })).toHaveLength(1);

    // Runtime scope badge stays Project (23).
    expect(screen.getAllByTestId("org-cap-scope-badge").map((b) => b.textContent)).toEqual([
      "Workspace",
      "Project",
    ]);
    // Administration location is Workspace for both (22/23).
    expect(screen.getAllByText("Managed at Workspace")).toHaveLength(2);
    // Never "Managed at Project" (25).
    expect(screen.queryByText("Managed at Project")).toBeNull();
    expect(ORG_PERMS).not.toContain("Managed at Project");
    expect(
      screen.getByText(ORGANIZATION_LOWER_SCOPE_SECTION_DESCRIPTION),
    ).toBeTruthy();
  });

  it("model wording: Project keeps its scope badge but is managed at Workspace", () => {
    expect(lowerScopeBadgeLabel("project")).toBe("Project");
    expect(lowerScopeManagedAtLabel("project")).toBe("Managed at Workspace");
    expect(lowerScopeManagedAtLabel("workspace")).toBe("Managed at Workspace");
    expect(ORGANIZATION_LOWER_SCOPE_SECTION_DESCRIPTION).toContain(
      "managed in Workspace permissions",
    );
    expect(ORGANIZATION_LOWER_SCOPE_SECTION_DESCRIPTION).not.toContain(
      "configured at Workspace or Project scope",
    );
    const { managed, lowerScope } = partitionOrganizationCapabilityRows([
      { scope_level: "organization" },
      { scope_level: "workspace" },
      { scope_level: "project" },
    ] as never);
    expect(managed).toHaveLength(1);
    expect(lowerScope).toHaveLength(2);
  });
});

/* ------------------------------------------------------------------ 26-29 */
describe("UX2.3 — Project surface remains application-access only", () => {
  it("26/27. uses only the accepted Project list and transition RPCs", () => {
    expect(PROJECT_ACCESS).toContain('"api_g_5_7_admin_list_workspace_client_projects"');
    expect(PROJECT_ACCESS).toContain('"api_g_5_7_admin_transition_project_client"');
    expect(PROJECT_ACCESS).not.toContain("client_capabilit");
    expect(PROJECT_ACCESS).not.toContain("api_capability_grants");
    expect(PROJECT_ACCESS).not.toContain("supabase.from(");
  });

  it("28. exposes no capability grant toggle", () => {
    for (const src of [PROJECT_ACCESS, PROJECT_MODEL]) {
      expect(src).not.toContain("capability_key");
      expect(src).not.toContain("scope_level");
      expect(src).not.toContain("capability");
      expect(src).not.toContain("_target_lifecycle_status: action.targetLifecycleStatus,\n        _capability");
    }
  });

  it("29. keeps the Project-access description semantics", () => {
    expect(PROJECT_ACCESS_DESCRIPTION).toContain("Projects this application can access");
    expect(PROJECT_ACCESS_DESCRIPTION).toContain("Workspace");
  });
});

/* ------------------------------------------------------------------ 30-32 */
describe("UX2.3 — backend isolation", () => {
  it("30/31/32. no migration, runtime or capability schema surface is referenced", () => {
    for (const src of [WS_PERMS, ORG_PERMS, PROJECT_ACCESS]) {
      expect(src).not.toContain("supabase/migrations");
      expect(src).not.toContain("api_capability_catalogue");
      expect(src).not.toContain("api_client_supported_capabilities");
      expect(src).not.toContain("api_project_client_enablements");
      expect(src).not.toContain("authorize_and_establish");
      expect(src).not.toContain("supabase.functions.invoke");
    }
  });
});

/* --------------------------------------------------- 10. closure assertion */
describe("UX2.3 — final administration-model closure guard", () => {
  it("Organization/Workspace/Project capability and Project access land on exactly one surface each", () => {
    // Organization capability -> actionable at Organization only.
    expect(
      resolveCapabilityRowAction(
        baseRow("organizations:read", { scope_level: "organization" }) as never,
        "active",
        "enabled",
      ).target,
    ).toBe("enabled");
    expect(wsAction({ scope_level: "organization" }).target).toBeNull();

    // Workspace capability -> actionable at Workspace only.
    expect(wsAction({ scope_level: "workspace" }).target).toBe("enabled");
    expect(
      resolveCapabilityRowAction(
        baseRow("risks:create", { scope_level: "workspace" }) as never,
        "active",
        "enabled",
      ).target,
    ).toBeNull();

    // Project capability -> actionable at Workspace, never at Organization.
    expect(wsAction({ scope_level: "project" }).target).toBe("enabled");
    expect(
      resolveCapabilityRowAction(
        baseRow("kpis:update", { scope_level: "project" }) as never,
        "active",
        "enabled",
      ).target,
    ).toBeNull();

    // Project application access -> actionable at Project, with no capability grant.
    expect(PROJECT_ACCESS).toContain('"api_g_5_7_admin_transition_project_client"');
    expect(PROJECT_ACCESS).not.toContain("capability");

    // Explicit regression protection against "Project capability -> Managed at Project".
    expect(workspaceRuntimeScopeBadgeLabel("project")).toBe("Project scope");
    expect(lowerScopeManagedAtLabel("project")).toBe("Managed at Workspace");
    for (const src of [WS_PERMS, ORG_PERMS, PROJECT_ACCESS]) {
      expect(src).not.toContain("Managed at Project");
    }
  });
});
