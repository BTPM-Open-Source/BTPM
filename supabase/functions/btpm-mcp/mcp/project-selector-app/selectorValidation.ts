// API-Q.PS.5A — Universal Project Selector: authoritative Project revalidation.
//
// This module is intentionally DOM-free, storage-free and network-free. The only
// communication path is the injected `ServerToolCaller`, which the View binds to
// the MCP Apps host bridge.
//
// It is NOT an authority layer. Delegated-user authorization, Connected App
// enforcement, Project access, canonical UUID/path validation, API rate limiting
// and the caller-bound Project-detail read are ALL owned by the already exposed
// canonical `projects.get_by_id` adapter. Nothing here reproduces those rules,
// and no new MCP tool, API route, RPC or database function is introduced.
//
// Data minimization is deliberate: the canonical Project-detail payload is a
// complete safe Project record, but the selector consumes ONLY the four identity
// fields it needs. No narrative field (description, charter, goals, scope, case,
// criteria, budget narrative, assumptions, constraints, ...) is read, copied,
// rendered, logged or retained, and the raw structured content object never
// enters selector state.
//
// Explicit non-goals: no model-context update, no conversation message send, no
// persistent active Project, no text-fallback parsing, no automatic retry.

import {
  readToolStructuredContent,
  type ServerToolCaller,
} from "./selectorData.ts";

/** Canonical MCP tool name reused verbatim. No new tool is introduced. */
export const PROJECT_VALIDATION_TOOL_NAME = "btpm_get_project";

/** Bounded, user-safe copy for every validation state. */
export const PROJECT_VALIDATION_MESSAGES = Object.freeze({
  validating: "Validating Project selection\u2026",
  failure: "Project selection could not be validated. Choose the Project again.",
  validated: "Project selection validated.",
});

/** The only Project-detail fields the selector is allowed to consume. */
export interface ValidatedProjectIdentity {
  readonly projectId: string;
  readonly organizationId: string;
  readonly workspaceId: string;
  readonly name: string;
}

/** The locally selected candidate scope the canonical result must match. */
export interface ProjectValidationScope {
  readonly projectId: string;
  readonly workspaceId: string;
  readonly organizationId: string;
}

/** Bounded outcome. No exception text or protocol data escapes. */
export type ProjectValidationOutcome =
  | { readonly kind: "ok"; readonly identity: ValidatedProjectIdentity }
  | { readonly kind: "failed" };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Defensively parses ONLY the safe identity of the canonical Project-detail
 * result.
 *
 * Fails closed on: an error result, absent/malformed structured content, a
 * missing/blank/non-string identity value, and any Project, Workspace or
 * Organization identifier that disagrees with the explicitly selected
 * candidate. The text fallback is never parsed.
 *
 * A Project-name difference alone is NOT a failure: if the Project was renamed
 * between list discovery and validation, the canonical current name wins.
 */
export function parseValidatedProjectIdentity(
  result: unknown,
  scope: ProjectValidationScope,
): ProjectValidationOutcome {
  if (
    !isNonEmptyString(scope?.projectId) ||
    !isNonEmptyString(scope?.workspaceId) ||
    !isNonEmptyString(scope?.organizationId)
  ) {
    return { kind: "failed" };
  }

  const structured = readToolStructuredContent(result);
  if (!isPlainObject(structured)) return { kind: "failed" };

  const projectId = structured.projectId;
  const organizationId = structured.organizationId;
  const workspaceId = structured.workspaceId;
  const name = structured.name;

  if (
    !isNonEmptyString(projectId) ||
    !isNonEmptyString(organizationId) ||
    !isNonEmptyString(workspaceId) ||
    !isNonEmptyString(name)
  ) {
    return { kind: "failed" };
  }

  if (projectId !== scope.projectId) return { kind: "failed" };
  if (workspaceId !== scope.workspaceId) return { kind: "failed" };
  if (organizationId !== scope.organizationId) return { kind: "failed" };

  // Exactly four fields are retained; every other Project-detail field, in
  // particular all narrative content, is deliberately dropped here.
  return {
    kind: "ok",
    identity: { projectId, organizationId, workspaceId, name },
  };
}

/**
 * Runs exactly one canonical Project-detail read for the explicitly selected
 * candidate: `btpm_get_project({ projectId })`.
 *
 * No other argument is ever sent, no retry is attempted, and the result is
 * reduced to the safe identity before it leaves this module.
 */
export async function requestProjectValidation(
  call: ServerToolCaller,
  scope: ProjectValidationScope,
): Promise<ProjectValidationOutcome> {
  let result: unknown;
  try {
    result = await call({
      name: PROJECT_VALIDATION_TOOL_NAME,
      arguments: { projectId: scope.projectId },
    });
  } catch {
    return { kind: "failed" };
  }
  return parseValidatedProjectIdentity(result, scope);
}
