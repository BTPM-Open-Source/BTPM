// API-Q.PS.4A — Universal Project Selector: accessible Workspace discovery.
//
// This module is intentionally DOM-free, storage-free and network-free. The
// only communication path is the injected `ServerToolCaller`, which the View
// binds to the MCP Apps host bridge. No database client, no BTPM HTTP API
// call, no direct browser networking, no persistence.
//
// It is NOT an authority layer: delegated authorization, containment,
// canonical validation, pagination limits and rate limiting remain owned by
// the already exposed canonical tools `btpm_list_organizations` and
// `btpm_list_workspaces`. Everything below is defensive handling of
// host-returned data only.
//
// Explicit non-goals: no Project discovery, no Project read tool, no
// model-context update, no conversation message send.

/** Canonical MCP tool names reused verbatim. No new tool is introduced. */
export const ORGANIZATIONS_TOOL_NAME = "btpm_list_organizations";
export const WORKSPACES_TOOL_NAME = "btpm_list_workspaces";

/** Single bounded page per canonical collection for this step. */
export const DISCOVERY_PAGE_LIMIT = 100;
export const DISCOVERY_PAGE_OFFSET = 0;

/** Bounded, user-safe copy for every Workspace-discovery state. */
export const WORKSPACE_STATE_MESSAGES = Object.freeze({
  loading: "Loading available workspaces\u2026",
  empty: "No accessible BTPM Workspaces were found.",
  failure:
    "Available Workspaces could not be loaded. Use the text fallback in the conversation.",
  overflow:
    "Too many Workspaces are available to display safely in the selector. Use the conversation to narrow the BTPM scope.",
  readyForProjects: "Ready to load Projects.",
});

/** A single flattened Workspace choice held in iframe memory only. */
export interface WorkspaceChoice {
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly organizationId: string;
  readonly organizationName: string;
}

/** Bounded discovery outcome. No exception text or protocol data escapes. */
export type WorkspaceDiscoveryOutcome =
  | { readonly kind: "ok"; readonly choices: ReadonlyArray<WorkspaceChoice> }
  | { readonly kind: "overflow" }
  | { readonly kind: "failed" };

/** Structural contract of the host-proxied server tool call. */
export type ServerToolCaller = (request: {
  readonly name: string;
  readonly arguments: Record<string, unknown>;
}) => Promise<unknown>;

interface SafePagination {
  readonly returned: number;
  readonly total: number;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Extracts the structured content of a tool result, failing closed on
 * `isError: true` or absent/malformed structured content.
 */
export function readToolStructuredContent(result: unknown): unknown {
  if (!isPlainObject(result)) return undefined;
  if (result.isError === true) return undefined;
  const structured = result.structuredContent;
  return isPlainObject(structured) ? structured : undefined;
}

/**
 * Validates the bounded pagination shape; fails closed when malformed.
 *
 * `returned` and `total` must both be finite, non-negative integers and must
 * satisfy `returned <= total`: any structurally impossible count combination
 * (fractional, negative, or more returned rows than exist) is rejected.
 */
export function parsePagination(value: unknown): SafePagination | undefined {
  if (!isPlainObject(value)) return undefined;
  const { returned, total } = value;
  if (typeof returned !== "number" || !Number.isInteger(returned)) return undefined;
  if (typeof total !== "number" || !Number.isInteger(total)) return undefined;
  if (returned < 0 || total < 0) return undefined;
  if (returned > total) return undefined;
  return { returned, total };
}


/** Validated Organization row needed by the View. */
export interface ParsedOrganization {
  readonly organizationId: string;
  readonly name: string;
}

/** Bounded parse result for a canonical collection payload. */
export type ParsedCollection<TItem> =
  | { readonly kind: "ok"; readonly items: ReadonlyArray<TItem> }
  | { readonly kind: "overflow" }
  | { readonly kind: "failed" };

/**
 * Defensively parses the `btpm_list_organizations` result.
 * Duplicate Organization IDs, missing names and malformed pagination fail
 * closed. A truncated first page yields the bounded overflow state.
 */
export function parseOrganizationsResult(
  result: unknown,
): ParsedCollection<ParsedOrganization> {
  const structured = readToolStructuredContent(result);
  if (!isPlainObject(structured)) return { kind: "failed" };
  const rawItems = structured.items;
  const pagination = parsePagination(structured.pagination);
  if (!Array.isArray(rawItems) || pagination === undefined) {
    return { kind: "failed" };
  }
  const items: ParsedOrganization[] = [];
  const seen = new Set<string>();
  for (const raw of rawItems) {
    if (!isPlainObject(raw)) return { kind: "failed" };
    const { organizationId, name } = raw;
    if (!isNonEmptyString(organizationId) || !isNonEmptyString(name)) {
      return { kind: "failed" };
    }
    if (seen.has(organizationId)) return { kind: "failed" };
    seen.add(organizationId);
    items.push({ organizationId, name });
  }
  if (pagination.total > pagination.returned) return { kind: "overflow" };
  if (pagination.returned !== items.length) return { kind: "failed" };
  return { kind: "ok", items };
}

/** Validated Workspace row needed by the View. */
export interface ParsedWorkspace {
  readonly workspaceId: string;
  readonly organizationId: string;
  readonly name: string;
}

/**
 * Defensively parses the `btpm_list_workspaces` result for one Organization.
 * A Workspace whose `organizationId` does not equal the Organization it was
 * loaded under fails closed, as do duplicates and malformed pagination.
 */
export function parseWorkspacesResult(
  result: unknown,
  expectedOrganizationId: string,
): ParsedCollection<ParsedWorkspace> {
  const structured = readToolStructuredContent(result);
  if (!isPlainObject(structured)) return { kind: "failed" };
  const rawItems = structured.items;
  const pagination = parsePagination(structured.pagination);
  if (!Array.isArray(rawItems) || pagination === undefined) {
    return { kind: "failed" };
  }
  const items: ParsedWorkspace[] = [];
  const seen = new Set<string>();
  for (const raw of rawItems) {
    if (!isPlainObject(raw)) return { kind: "failed" };
    const { workspaceId, organizationId, name } = raw;
    if (!isNonEmptyString(workspaceId) || !isNonEmptyString(name)) {
      return { kind: "failed" };
    }
    if (organizationId !== expectedOrganizationId) return { kind: "failed" };
    if (seen.has(workspaceId)) return { kind: "failed" };
    seen.add(workspaceId);
    items.push({ workspaceId, organizationId, name });
  }
  if (pagination.total > pagination.returned) return { kind: "overflow" };
  if (pagination.returned !== items.length) return { kind: "failed" };
  return { kind: "ok", items };
}

/**
 * Runs the exact discovery sequence:
 *   `btpm_list_organizations` → for each returned Organization, sequentially
 *   `btpm_list_workspaces(organizationId)` → one flattened Workspace
 *   collection.
 *
 * No Workspace call happens for an Organization that the canonical
 * Organizations tool did not return. Calls are strictly sequential and never
 * retried automatically.
 */
export async function discoverWorkspaceChoices(
  call: ServerToolCaller,
): Promise<WorkspaceDiscoveryOutcome> {
  let organizationsResult: unknown;
  try {
    organizationsResult = await call({
      name: ORGANIZATIONS_TOOL_NAME,
      arguments: { limit: DISCOVERY_PAGE_LIMIT, offset: DISCOVERY_PAGE_OFFSET },
    });
  } catch {
    return { kind: "failed" };
  }

  const organizations = parseOrganizationsResult(organizationsResult);
  if (organizations.kind !== "ok") return { kind: organizations.kind };

  const choices: WorkspaceChoice[] = [];
  const seenWorkspaceIds = new Set<string>();

  for (const organization of organizations.items) {
    let workspacesResult: unknown;
    try {
      workspacesResult = await call({
        name: WORKSPACES_TOOL_NAME,
        arguments: {
          organizationId: organization.organizationId,
          limit: DISCOVERY_PAGE_LIMIT,
          offset: DISCOVERY_PAGE_OFFSET,
        },
      });
    } catch {
      return { kind: "failed" };
    }

    const workspaces = parseWorkspacesResult(
      workspacesResult,
      organization.organizationId,
    );
    if (workspaces.kind !== "ok") return { kind: workspaces.kind };

    for (const workspace of workspaces.items) {
      if (seenWorkspaceIds.has(workspace.workspaceId)) return { kind: "failed" };
      seenWorkspaceIds.add(workspace.workspaceId);
      choices.push({
        workspaceId: workspace.workspaceId,
        workspaceName: workspace.name,
        organizationId: workspace.organizationId,
        organizationName: organization.name,
      });
    }
  }

  return { kind: "ok", choices };
}

/** Local, client-side filtering over Workspace and Organization names. */
export function filterWorkspaceChoices(
  choices: ReadonlyArray<WorkspaceChoice>,
  query: string,
): ReadonlyArray<WorkspaceChoice> {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return choices;
  return choices.filter((choice) =>
    choice.workspaceName.toLowerCase().includes(needle) ||
    choice.organizationName.toLowerCase().includes(needle)
  );
}

/** Prerequisites for starting Workspace discovery exactly once. */
export interface DiscoveryStartInput {
  readonly connected: boolean;
  readonly connectionFailed?: boolean;
  readonly hostSupportsServerTools: boolean;
  readonly alreadyStarted: boolean;
}

/**
 * Pure guard: discovery may start only after a successful connection, with
 * confirmed `serverTools` support, and only once.
 *
 * API-Q.PS.4A-C2: the presentation-only `btpm_choose_project` bootstrap result
 * is NOT a prerequisite. Some MCP hosts (Microsoft 365 Copilot) never deliver
 * the initiating tool result to the App iframe, and the bootstrap payload
 * carries no Tenant/Organization/Workspace/Project/user authority. All
 * authorization stays in the delegated canonical MCP tools.
 */
export function shouldStartWorkspaceDiscovery(
  input: DiscoveryStartInput,
): boolean {
  if (input.alreadyStarted) return false;
  if (!input.connected || input.connectionFailed === true) return false;
  return input.hostSupportsServerTools;
}

