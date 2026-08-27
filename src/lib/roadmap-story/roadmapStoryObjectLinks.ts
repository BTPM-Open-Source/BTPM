/**
 * Phase 6B.7a.5 — Roadmap Story Pack Presentation object-link resolver.
 *
 * Central helper for translating structured Roadmap Story object references
 * into internal BTPM app routes. Rules (see governance doc):
 *
 *  - Never build URLs from names, prose, or LLM output.
 *  - Only structured refs already present in the source snapshot / visual
 *    block data are eligible.
 *  - Return `null` for object types that BTPM has no stable route for or
 *    when insufficient identifiers are available. Callers render a plain
 *    (non-clickable) label in that case.
 *  - Links never grant access. Destination routes/RPCs still enforce the
 *    existing project-level authorization model. This helper does NOT
 *    prefetch or validate access.
 *  - File objects only produce a link when an existing safe `webUrl`
 *    (SharePoint) already exists on the ref; no browser-side Graph download
 *    is introduced.
 */

export type RoadmapStoryObjectRefType =
  | "project"
  | "phase"
  | "task"
  | "risk"
  | "blocker"
  | "governance_record"
  | "decision_case"
  | "kpi"
  | "file"
  | "workspace"
  | "program";

export interface RoadmapStoryObjectRef {
  type: RoadmapStoryObjectRefType;
  /** Stable BTPM identifier for the object (uuid). Empty string treated as missing. */
  id: string;
  /** Required for project-scoped surfaces. */
  projectId?: string;
  /** Required for every route rooted under `/workspace/:workspaceId/...`. */
  workspaceId?: string;
  /** Optional — reserved for future program-scope routes. */
  programId?: string;
  /**
   * Optional user-facing label. Not used for URL construction; consumers
   * pass it separately to the link primitive.
   */
  label?: string;
  /**
   * For governance records only: distinguishes generic evidence records
   * (listed under `/governance`) from full decision cases (their own route).
   */
  governanceKind?: "decision_case" | "evidence_record";
  /**
   * For files only: existing safe SharePoint `webUrl`. When absent, no
   * link is emitted — we do not synthesize file URLs.
   */
  webUrl?: string | null;
}

/** True when `s` looks like a non-empty stable identifier. */
function ok(s: string | null | undefined): s is string {
  return typeof s === "string" && s.trim().length > 0;
}

/**
 * Resolve a structured object ref into an internal href. Returns `null`
 * when the object type has no supported route or the required identifiers
 * are missing. Never throws.
 *
 * External links: only permitted for `file` refs that already carry a
 * SharePoint `webUrl` (existing safe linked-file behavior).
 */
export function resolveRoadmapStoryObjectHref(
  ref: RoadmapStoryObjectRef | null | undefined,
): string | null {
  if (!ref) return null;
  const { type, id, projectId, workspaceId } = ref;

  switch (type) {
    case "workspace":
      return ok(id) ? `/workspace/${id}` : null;

    case "program":
      // Program pages live under a workspace. Without both IDs there is
      // no safe destination.
      return ok(workspaceId) && ok(id)
        ? `/workspace/${workspaceId}/program/${id}`
        : null;

    case "project":
      return ok(workspaceId) && ok(id)
        ? `/workspace/${workspaceId}/project/${id}`
        : null;

    case "phase":
      return ok(workspaceId) && ok(projectId) && ok(id)
        ? `/workspace/${workspaceId}/project/${projectId}/phase/${id}`
        : null;

    case "task":
      return ok(workspaceId) && ok(projectId) && ok(id)
        ? `/workspace/${workspaceId}/project/${projectId}/task/${id}`
        : null;

    case "risk":
    case "blocker":
      // BTPM has no per-risk / per-blocker route yet. Deep-link to the
      // project's risks/blockers surface where the item is scoped.
      return ok(workspaceId) && ok(projectId)
        ? `/workspace/${workspaceId}/project/${projectId}/risks`
        : null;

    case "kpi":
      return ok(workspaceId) && ok(projectId)
        ? `/workspace/${workspaceId}/project/${projectId}/kpis`
        : null;

    case "decision_case":
      return ok(workspaceId) && ok(projectId) && ok(id)
        ? `/workspace/${workspaceId}/project/${projectId}/governance/decision-cases/${id}`
        : null;

    case "governance_record":
      // Full decision cases route to their own surface; everything else
      // lands on the project governance list (no per-evidence route).
      if (ref.governanceKind === "decision_case" && ok(id)) {
        return ok(workspaceId) && ok(projectId)
          ? `/workspace/${workspaceId}/project/${projectId}/governance/decision-cases/${id}`
          : null;
      }
      return ok(workspaceId) && ok(projectId)
        ? `/workspace/${workspaceId}/project/${projectId}/governance`
        : null;

    case "file":
      // Files use existing safe linked-file behavior only. If no webUrl
      // was captured upstream, render as plain text.
      return ok(ref.webUrl) ? ref.webUrl! : null;

    default:
      return null;
  }
}

/** True when this ref is a safe external SharePoint webUrl (opens in new tab). */
export function isExternalRoadmapStoryHref(
  ref: RoadmapStoryObjectRef | null | undefined,
): boolean {
  return !!ref && ref.type === "file" && ok(ref.webUrl);
}
