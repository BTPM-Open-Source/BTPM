// API-Q.PS.4B — Universal Project Selector: accessible Project discovery.
//
// This module is intentionally DOM-free, storage-free and network-free. The
// only communication path is the injected `ServerToolCaller`, which the View
// binds to the MCP Apps host bridge. No database client, no BTPM HTTP call, no
// direct browser networking, no persistence.
//
// It is NOT an authority layer: delegated authorization, Connected App
// enforcement, containment, canonical validation, pagination limits and rate
// limiting remain owned by the already exposed canonical Projects read tool.
// Everything below is defensive handling of host-returned data only, and it
// reuses the accepted PS.4A structured-content and pagination handling.
//
// Explicit non-goals: no Project revalidation read, no model-context update, no
// conversation message send, no persistence of a selected Project.

import {
  DISCOVERY_PAGE_LIMIT,
  DISCOVERY_PAGE_OFFSET,
  parsePagination,
  readToolStructuredContent,
  type ParsedCollection,
  type ServerToolCaller,
} from "./selectorData.ts";

/** Canonical MCP tool name reused verbatim. No new tool is introduced. */
export const PROJECTS_TOOL_NAME = "btpm_list_projects";

/** Bounded, user-safe copy for every Project-discovery state. */
export const PROJECT_STATE_MESSAGES = Object.freeze({
  loading: "Loading available projects\u2026",
  empty: "No accessible BTPM Projects were found in this Workspace.",
  failure:
    "Available Projects could not be loaded. Use the text fallback in the conversation.",
  overflow:
    "Too many Projects are available to display safely in this selector. Use the conversation to narrow the BTPM scope.",
  readyToValidate: "Ready to validate selection.",
  noMatches: "No projects match this search.",
});

/** A single Project choice held in iframe memory only. */
export interface ProjectChoice {
  readonly projectId: string;
  readonly projectName: string;
  readonly status: string;
  readonly workspaceId: string;
  readonly organizationId: string;
}

/** Bounded discovery outcome. No exception text or protocol data escapes. */
export type ProjectDiscoveryOutcome =
  | { readonly kind: "ok"; readonly choices: ReadonlyArray<ProjectChoice> }
  | { readonly kind: "overflow" }
  | { readonly kind: "failed" };

/** Workspace context the Project collection must belong to. */
export interface ProjectDiscoveryScope {
  readonly workspaceId: string;
  readonly organizationId: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Defensively parses the canonical Projects collection result for exactly one
 * Workspace scope.
 *
 * Fails closed on: error results, absent/malformed structured content, missing
 * or malformed identity/name/status, a row whose Workspace or Organization does
 * not equal the selected Workspace scope, duplicate Project identifiers,
 * malformed or structurally impossible pagination, and a `returned` count that
 * disagrees with the item count. A truncated first page yields the bounded
 * overflow state, so a partial list is never presented as complete.
 */
export function parseProjectsResult(
  result: unknown,
  scope: ProjectDiscoveryScope,
): ParsedCollection<ProjectChoice> {
  if (
    !isNonEmptyString(scope?.workspaceId) ||
    !isNonEmptyString(scope?.organizationId)
  ) {
    return { kind: "failed" };
  }
  const structured = readToolStructuredContent(result);
  if (!isPlainObject(structured)) return { kind: "failed" };
  const rawItems = structured.items;
  const pagination = parsePagination(structured.pagination);
  if (!Array.isArray(rawItems) || pagination === undefined) {
    return { kind: "failed" };
  }

  const items: ProjectChoice[] = [];
  const seen = new Set<string>();
  for (const raw of rawItems) {
    if (!isPlainObject(raw)) return { kind: "failed" };
    const { projectId, organizationId, workspaceId, name, status } = raw;
    if (
      !isNonEmptyString(projectId) ||
      !isNonEmptyString(organizationId) ||
      !isNonEmptyString(workspaceId) ||
      !isNonEmptyString(name) ||
      !isNonEmptyString(status)
    ) {
      return { kind: "failed" };
    }
    if (workspaceId !== scope.workspaceId) return { kind: "failed" };
    if (organizationId !== scope.organizationId) return { kind: "failed" };
    if (seen.has(projectId)) return { kind: "failed" };
    seen.add(projectId);
    items.push({
      projectId,
      projectName: name,
      status,
      workspaceId,
      organizationId,
    });
  }

  if (pagination.total > pagination.returned) return { kind: "overflow" };
  if (pagination.returned !== items.length) return { kind: "failed" };
  return { kind: "ok", items };
}

/**
 * Runs exactly one bounded Projects read for the selected Workspace:
 * `btpm_list_projects({ workspaceId, limit: 100, offset: 0 })`.
 *
 * No pagination loop, no automatic retry, and no identifier other than the
 * Workspace identifier returned by the canonical Workspaces read is ever sent.
 */
export async function discoverProjectChoices(
  call: ServerToolCaller,
  scope: ProjectDiscoveryScope,
): Promise<ProjectDiscoveryOutcome> {
  let result: unknown;
  try {
    result = await call({
      name: PROJECTS_TOOL_NAME,
      arguments: {
        workspaceId: scope.workspaceId,
        limit: DISCOVERY_PAGE_LIMIT,
        offset: DISCOVERY_PAGE_OFFSET,
      },
    });
  } catch {
    return { kind: "failed" };
  }

  const parsed = parseProjectsResult(result, scope);
  if (parsed.kind !== "ok") return { kind: parsed.kind };
  return { kind: "ok", choices: parsed.items };
}

/** Local, client-side filtering over Project name and status. */
export function filterProjectChoices(
  choices: ReadonlyArray<ProjectChoice>,
  query: string,
): ReadonlyArray<ProjectChoice> {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return choices;
  return choices.filter((choice) =>
    choice.projectName.toLowerCase().includes(needle) ||
    choice.status.toLowerCase().includes(needle)
  );
}

/** Prerequisites for starting Project discovery exactly once per Workspace. */
export interface ProjectDiscoveryStartInput {
  /** Workspace currently selected in the View, if any. */
  readonly selectedWorkspaceId: string | undefined;
  /** Workspace a Project request has already been started for, if any. */
  readonly startedForWorkspaceId: string | undefined;
}

/**
 * Pure guard: Project discovery may start only after a Workspace has been
 * selected, and only once per selected Workspace. Rendering and theme changes
 * therefore never trigger a duplicate Project request.
 */
export function shouldStartProjectDiscovery(
  input: ProjectDiscoveryStartInput,
): boolean {
  if (!isNonEmptyString(input.selectedWorkspaceId)) return false;
  return input.startedForWorkspaceId !== input.selectedWorkspaceId;
}
