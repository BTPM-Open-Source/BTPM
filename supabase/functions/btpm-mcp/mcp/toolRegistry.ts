// API-Q.2 — Declarative MCP tool-registry foundation.
//
// This module is METADATA ONLY. It is a thin declarative description of which
// canonical BTPM API v1 operations MAY later be surfaced as MCP tools, keyed
// strictly by the existing canonical `operationId`.
//
// This module MUST NOT: read the environment, open network connections,
// construct Supabase clients, touch the database, execute SQL/RPC, register
// HTTP routes, handle requests, perform authentication or authorization,
// implement PM domain behavior, or hold mutable global state.
//
// Business logic, authorization, provenance, concurrency enforcement and
// pagination remain owned by the canonical BTPM API implementation. The MCP
// layer is an adapter; it never becomes a second mutation or authority path.
//
// No generic "execute operationId" mechanism exists here, by design.

import {
  type ApiSupportedOperation,
  buildCapabilitiesPayload,
} from "../../_shared/btpm-api/routes/capabilities.ts";
import {
  type ApiRouteDefinition,
  API_V1_ROUTE_ALLOWLIST,
} from "../../_shared/btpm-api/routes/allowlist.ts";

/** Canonical operation classes, mirroring the API route allowlist semantics. */
export type McpOperationClass = "read" | "mutation";

/**
 * MCP exposure state. Exposure is explicit and fails closed: an operation is
 * MCP-callable only when it is present in the registry AND declared
 * `"exposed"`. Adding a new BTPM API route never implicitly exposes anything.
 */
export type McpExposureState = "exposed" | "not_exposed";

/** Whether an MCP client must confirm before the adapter may execute. */
export type McpConfirmationRequirement = "required" | "not_required";

/** Bounded-result characteristic of the underlying API operation. */
export type McpResultShape =
  | "single_object"
  | "bounded_collection"
  | "metadata";

/** Whether the underlying API operation requires a concurrency version token. */
export type McpConcurrencyTokenRequirement = "required" | "not_applicable";

/** Declarative, MCP-specific metadata for exactly one canonical operation. */
export interface McpToolMetadata {
  /** Canonical BTPM API v1 operation identifier. The stable API<->MCP link. */
  readonly operationId: ApiSupportedOperation;
  /** MCP tool name as advertised to clients. Unique across the registry. */
  readonly toolName: string;
  /** Short human-readable title. */
  readonly title: string;
  /** Concise description of what the underlying API operation does. */
  readonly description: string;
  readonly operationClass: McpOperationClass;
  readonly exposure: McpExposureState;
  readonly confirmation: McpConfirmationRequirement;
  readonly resultShape: McpResultShape;
  readonly concurrencyToken: McpConcurrencyTokenRequirement;
}

export type McpToolRegistry = readonly McpToolMetadata[];

/**
 * The MCP tool registry contains one explicit exposure decision for every
 * canonical BTPM API v1 operation. Registry coverage and operation-class parity
 * are enforced by the canonical registry validators. Exposure is explicit and
 * fail-closed: adding a BTPM API route never implicitly exposes it as an MCP
 * tool. This comment intentionally does not maintain read/mutation counts or a
 * hand-written exposure inventory; the canonical API operation set, registry
 * entries and validators are the source of truth.
 */
export const MCP_TOOL_REGISTRY: McpToolRegistry = Object.freeze([
  Object.freeze({
    operationId: "organizations.get",
    toolName: "btpm_list_organizations",
    title: "List BTPM Organizations",
    description:
      "Bounded, server-paginated list of BTPM Organizations the delegated user may access.",
    operationClass: "read",
    exposure: "exposed",
    confirmation: "not_required",
    resultShape: "bounded_collection",
    concurrencyToken: "not_applicable",
  }),
  Object.freeze({
    operationId: "workspaces.get",
    toolName: "btpm_list_workspaces",
    title: "List BTPM Workspaces",
    description:
      "Bounded, server-paginated list of BTPM Workspaces in one Organization the delegated user may access.",
    operationClass: "read",
    exposure: "exposed",
    confirmation: "not_required",
    resultShape: "bounded_collection",
    concurrencyToken: "not_applicable",
  }),
  Object.freeze({
    // API-Q WML-1B added `workspace_members.get` to the canonical API; WML-1B-C1
    // recorded the explicit exposure decision, and WML-1C flips exposure only:
    // the Workspace-member lookup read is now advertised as
    // `btpm_list_workspace_members`. No other metadata changed.
    operationId: "workspace_members.get",
    toolName: "btpm_list_workspace_members",
    title: "List BTPM Workspace Members",
    description:
      "Bounded, server-paginated list of active members of one authorized BTPM Workspace, returning only user ID, display name and email.",
    operationClass: "read",
    exposure: "exposed",

    confirmation: "not_required",
    resultShape: "bounded_collection",
    concurrencyToken: "not_applicable",
  }),
  Object.freeze({
    operationId: "projects.get",
    toolName: "btpm_list_projects",
    title: "List BTPM Projects",
    description:
      "Bounded, server-paginated list of BTPM Projects in one Workspace the delegated user may access.",
    operationClass: "read",
    exposure: "exposed",
    confirmation: "not_required",
    resultShape: "bounded_collection",
    concurrencyToken: "not_applicable",
  }),
  Object.freeze({
    operationId: "programs.get",
    toolName: "btpm_list_programs",
    title: "List BTPM Programs",
    description:
      "Bounded, server-paginated list of BTPM Programs in one Workspace the delegated user may access.",
    operationClass: "read",
    exposure: "exposed",
    confirmation: "not_required",
    resultShape: "bounded_collection",
    concurrencyToken: "not_applicable",
  }),
  Object.freeze({
    operationId: "programs.get_by_id",
    toolName: "btpm_get_program",
    title: "Get BTPM Program",
    description:
      "Canonical safe detail view of one BTPM Program the delegated user may access.",
    operationClass: "read",
    exposure: "exposed",
    confirmation: "not_required",
    resultShape: "single_object",
    concurrencyToken: "not_applicable",
  }),
  Object.freeze({
    operationId: "projects.get_by_id",
    toolName: "btpm_get_project",
    title: "Get BTPM Project",
    description:
      "Canonical safe detail view of one BTPM Project the delegated user may access.",
    operationClass: "read",
    exposure: "exposed",
    confirmation: "not_required",
    resultShape: "single_object",
    concurrencyToken: "not_applicable",
  }),
  Object.freeze({
    operationId: "projects.planning.get",
    toolName: "btpm_get_project_planning",
    title: "Get BTPM Project Planning",
    description:
      "Canonical Project planning context (Project, Phases, Tasks and dependencies) the delegated user may access.",
    operationClass: "read",
    exposure: "exposed",
    confirmation: "not_required",
    resultShape: "single_object",
    concurrencyToken: "not_applicable",
  }),
  Object.freeze({
    operationId: "risks.get",
    toolName: "btpm_list_project_risks",
    title: "List BTPM Project Risks",
    description:
      "Bounded, cursor-paginated list of BTPM Risks in one Project the delegated user may access.",
    operationClass: "read",
    exposure: "exposed",
    confirmation: "not_required",
    resultShape: "bounded_collection",
    concurrencyToken: "not_applicable",
  }),
  Object.freeze({
    operationId: "risks.get_by_id",
    toolName: "btpm_get_risk",
    title: "Get BTPM Risk",
    description:
      "Canonical safe detail view of one BTPM Risk the delegated user may access.",
    operationClass: "read",
    exposure: "exposed",
    confirmation: "not_required",
    resultShape: "single_object",
    concurrencyToken: "not_applicable",
  }),
  Object.freeze({
    operationId: "blockers.get",
    toolName: "btpm_list_project_blockers",
    title: "List BTPM Project Blockers",
    description:
      "Bounded, cursor-paginated list of BTPM Blockers in one Project the delegated user may access.",
    operationClass: "read",
    exposure: "exposed",
    confirmation: "not_required",
    resultShape: "bounded_collection",
    concurrencyToken: "not_applicable",
  }),
  Object.freeze({
    operationId: "blockers.get_by_id",
    toolName: "btpm_get_blocker",
    title: "Get BTPM Blocker",
    description:
      "Canonical safe detail view of one BTPM Blocker the delegated user may access.",
    operationClass: "read",
    exposure: "exposed",
    confirmation: "not_required",
    resultShape: "single_object",
    concurrencyToken: "not_applicable",
  }),
  Object.freeze({
    operationId: "execution_updates.get",
    toolName: "btpm_list_execution_updates",
    title: "List BTPM Execution Updates",
    description:
      "Bounded, cursor-paginated dated Execution Update history for one Phase or Task the delegated user may access.",
    operationClass: "read",
    exposure: "exposed",
    confirmation: "not_required",
    resultShape: "bounded_collection",
    concurrencyToken: "not_applicable",
  }),
  Object.freeze({
    operationId: "phases.get_by_id",
    toolName: "btpm_get_phase",
    title: "Get BTPM Phase",
    description:
      "Canonical safe detail view of one BTPM Phase the delegated user may access.",
    operationClass: "read",
    exposure: "exposed",
    confirmation: "not_required",
    resultShape: "single_object",
    concurrencyToken: "not_applicable",
  }),
  Object.freeze({
    operationId: "tasks.get_by_id",
    toolName: "btpm_get_task",
    title: "Get BTPM Task",
    description:
      "Canonical safe detail view of one BTPM Task the delegated user may access.",
    operationClass: "read",
    exposure: "exposed",
    confirmation: "not_required",
    resultShape: "single_object",
    concurrencyToken: "not_applicable",
  }),
  // ---------------------------------------------------------------------------
  // Explicit NOT-EXPOSED decisions for the two canonical metadata operations
  // (`version.get`, `capabilities.get`).
  //
  // They remain registry decisions for coverage completeness — so that no
  // canonical operation is silently undecided — but are not advertised as MCP
  // tools: neither is registered in `serverFactory`, neither appears in
  // `tools/list`, and neither has an MCP executor. Exposure remains
  // fail-closed. Subsequent registry entries continue with exposed business
  // operations.
  // ---------------------------------------------------------------------------

  Object.freeze({
    operationId: "version.get",
    toolName: "btpm_get_version",
    title: "Get BTPM API Version",
    description:
      "Static BTPM API v1 version metadata.",
    operationClass: "read",
    exposure: "not_exposed",
    confirmation: "not_required",
    resultShape: "metadata",
    concurrencyToken: "not_applicable",
  }),
  Object.freeze({
    operationId: "capabilities.get",
    toolName: "btpm_get_capabilities",
    title: "Get BTPM API Capabilities",
    description:
      "Static BTPM API v1 capability advertisement metadata.",
    operationClass: "read",
    exposure: "not_exposed",
    confirmation: "not_required",
    resultShape: "metadata",
    concurrencyToken: "not_applicable",
  }),
  Object.freeze({
    operationId: "me.get",
    toolName: "btpm_get_me",
    title: "Get BTPM Caller Identity",
    description:
      "Canonical safe identity and optional Organization, Workspace, or Project authority-context view of the delegated BTPM caller.",
    operationClass: "read",
    exposure: "exposed",
    confirmation: "not_required",
    resultShape: "single_object",
    concurrencyToken: "not_applicable",
  }),
  Object.freeze({
    operationId: "execution_updates.append",
    toolName: "btpm_append_execution_update",
    title: "Append BTPM Execution Update",
    description:
      "Appends one dated Execution Update to a Phase or Task through the canonical API mutation contract.",
    operationClass: "mutation",
    exposure: "exposed",
    confirmation: "required",
    resultShape: "single_object",
    concurrencyToken: "not_applicable",
  }),
  Object.freeze({
    operationId: "risks.create",
    toolName: "btpm_create_risk",
    title: "Create BTPM Risk",
    description:
      "Creates one Risk in a Project through the canonical API mutation contract.",
    operationClass: "mutation",
    exposure: "exposed",
    confirmation: "required",
    resultShape: "single_object",
    concurrencyToken: "not_applicable",
  }),
  Object.freeze({
    operationId: "risks.update",
    toolName: "btpm_update_risk",
    title: "Update BTPM Risk",
    description:
      "Updates one Risk through the canonical API mutation contract.",
    operationClass: "mutation",
    exposure: "exposed",
    confirmation: "required",
    resultShape: "single_object",
    concurrencyToken: "required",
  }),
  Object.freeze({
    operationId: "blockers.create",
    toolName: "btpm_create_blocker",
    title: "Create BTPM Blocker",
    description:
      "Creates one Blocker for a Project, Phase, or Task through the canonical API mutation contract.",
    operationClass: "mutation",
    exposure: "exposed",
    confirmation: "required",
    resultShape: "single_object",
    concurrencyToken: "not_applicable",
  }),
  Object.freeze({
    operationId: "blockers.update",
    toolName: "btpm_update_blocker",
    title: "Update BTPM Blocker",
    description:
      "Updates one Blocker through the canonical API mutation contract.",
    operationClass: "mutation",
    exposure: "exposed",
    confirmation: "required",
    resultShape: "single_object",
    concurrencyToken: "required",
  }),
  Object.freeze({
    operationId: "phases.create",
    toolName: "btpm_create_phase",
    title: "Create BTPM Phase",
    description:
      "Creates one Phase in a Project through the canonical API mutation contract. Phases created in baselined Projects require both planned start and target end dates.",
    operationClass: "mutation",
    exposure: "exposed",
    confirmation: "required",
    resultShape: "single_object",
    concurrencyToken: "not_applicable",
  }),
  Object.freeze({
    operationId: "phases.update",
    toolName: "btpm_update_phase",
    title: "Update BTPM Phase",
    description:
      "Updates one Phase through the canonical API mutation contract.",
    operationClass: "mutation",
    exposure: "exposed",
    confirmation: "required",
    resultShape: "single_object",
    concurrencyToken: "required",
  }),
  Object.freeze({
    operationId: "phases.reorder",
    toolName: "btpm_reorder_phases",
    title: "Reorder BTPM Phases",
    description:
      "Reorders the Phases of one Project through the canonical API mutation contract.",
    operationClass: "mutation",
    exposure: "exposed",
    confirmation: "required",
    resultShape: "bounded_collection",
    concurrencyToken: "required",
  }),
  Object.freeze({
    operationId: "phases.plan",
    toolName: "btpm_plan_phase",
    title: "Plan BTPM Phase",
    description:
      "Applies planned dates to one Phase through the canonical API mutation contract.",
    operationClass: "mutation",
    exposure: "exposed",
    confirmation: "required",
    resultShape: "single_object",
    concurrencyToken: "required",
  }),
  Object.freeze({
    operationId: "tasks.create",
    toolName: "btpm_create_task",
    title: "Create BTPM Task",
    description:
      "Creates one Task in a Phase through the canonical API mutation contract. Tasks created in baselined Projects require both planned start and due dates.",
    operationClass: "mutation",
    exposure: "exposed",
    confirmation: "required",
    resultShape: "single_object",
    concurrencyToken: "not_applicable",
  }),
  Object.freeze({
    operationId: "tasks.update",
    toolName: "btpm_update_task",
    title: "Update BTPM Task",
    description:
      "Updates one Task through the canonical API mutation contract.",
    operationClass: "mutation",
    exposure: "exposed",
    confirmation: "required",
    resultShape: "single_object",
    concurrencyToken: "required",
  }),
  Object.freeze({
    operationId: "tasks.reorder",
    toolName: "btpm_reorder_tasks",
    title: "Reorder BTPM Tasks",
    description:
      "Reorders the Tasks of one Phase through the canonical API mutation contract.",
    operationClass: "mutation",
    exposure: "exposed",
    confirmation: "required",
    resultShape: "bounded_collection",
    concurrencyToken: "required",
  }),
  Object.freeze({
    operationId: "tasks.plan",
    toolName: "btpm_plan_task",
    title: "Plan BTPM Task",
    description:
      "Applies planned dates to one Task through the canonical API mutation contract.",
    operationClass: "mutation",
    exposure: "exposed",
    confirmation: "required",
    resultShape: "single_object",
    concurrencyToken: "required",
  }),
  Object.freeze({
    operationId: "tasks.assign",
    toolName: "btpm_assign_task",
    title: "Assign BTPM Task",
    description:
      "Sets or clears the single Task assignee through the canonical API mutation contract.",
    operationClass: "mutation",
    exposure: "exposed",
    confirmation: "required",
    resultShape: "single_object",
    concurrencyToken: "not_applicable",
  }),
  Object.freeze({
    operationId: "tasks.transition",
    toolName: "btpm_transition_task",
    title: "Transition BTPM Task",
    description:
      "Transitions one Task lifecycle status through the canonical API mutation contract. This operation does not reopen completed Tasks: a completed Task is locked and must first be reopened through BTPM's dedicated reopen flow.",
    operationClass: "mutation",
    exposure: "exposed",
    confirmation: "required",
    resultShape: "single_object",
    concurrencyToken: "required",
  }),
  Object.freeze({
    operationId: "projects.create",
    toolName: "btpm_create_project",
    title: "Create BTPM Project",
    description:
      "Creates one Project in a Workspace through the canonical API mutation contract. Creating a Project does not automatically enable that Project for the Connected App. Subsequent Project-scoped operations may require administrator enablement.",
    operationClass: "mutation",
    exposure: "exposed",
    confirmation: "required",
    resultShape: "single_object",
    concurrencyToken: "not_applicable",
  }),
  Object.freeze({
    operationId: "projects.update",
    toolName: "btpm_update_project",
    title: "Update BTPM Project",
    description:
      "Updates one Project through the canonical API mutation contract.",
    operationClass: "mutation",
    exposure: "exposed",
    confirmation: "required",
    resultShape: "single_object",
    concurrencyToken: "required",
  }),
  Object.freeze({
    operationId: "projects.transition",
    toolName: "btpm_transition_project",
    title: "Transition BTPM Project",
    description:
      "Transitions one Project lifecycle status through the canonical API mutation contract.",
    operationClass: "mutation",
    exposure: "exposed",
    confirmation: "required",
    resultShape: "single_object",
    concurrencyToken: "required",
  }),
  Object.freeze({
    operationId: "programs.create",
    toolName: "btpm_create_program",
    title: "Create BTPM Program",
    description:
      "Creates one Program in a Workspace through the canonical API mutation contract.",
    operationClass: "mutation",
    exposure: "exposed",
    confirmation: "required",
    resultShape: "single_object",
    concurrencyToken: "not_applicable",
  }),
  Object.freeze({
    operationId: "programs.update",
    toolName: "btpm_update_program",
    title: "Update BTPM Program",
    description:
      "Updates one Program through the canonical API mutation contract.",
    operationClass: "mutation",
    exposure: "exposed",
    confirmation: "required",
    resultShape: "single_object",
    concurrencyToken: "required",
  }),
  // ---------------------------------------------------------------------------
  // API-Q Portfolio-7 recorded explicit MCP exposure decisions for all six
  // canonical Portfolio API operations. API-Q Portfolio-8 flipped exactly the
  // three canonical Portfolio READS (`portfolios.get`, `portfolios.get_by_id`,
  // `portfolios.projects.get`) to `exposed`; each is registered in
  // `serverFactory` behind a bounded MCP → canonical delegated-reader adapter.
  // API-Q Portfolio-9D flips exactly ONE Portfolio MUTATION,
  // `portfolios.create`, to `exposed`, registered behind the bounded
  // Portfolio-9C control layer → Portfolio-9B caller-bound writer →
  // Portfolio-9A trusted database bridge. API-Q Portfolio-10D flips exactly
  // ONE further Portfolio MUTATION, `portfolios.update`, to `exposed`,
  // registered behind the bounded Portfolio-10C control layer →
  // Portfolio-10B caller-bound writer → Portfolio-10A trusted database
  // bridge. API-Q Portfolio-11D flips the final Portfolio MUTATION,
  // `portfolios.assign_project`, to `exposed`, registered behind the bounded
  // Portfolio-11C control layer → Portfolio-11B caller-bound writer →
  // Portfolio-11A trusted database bridge.
  // ---------------------------------------------------------------------------
  Object.freeze({
    operationId: "portfolios.get",
    toolName: "btpm_list_portfolios",
    title: "List BTPM Portfolios",
    description:
      "Bounded, server-paginated list of BTPM Portfolios in one Organization the delegated user may access.",
    operationClass: "read",
    exposure: "exposed",
    confirmation: "not_required",
    resultShape: "bounded_collection",
    concurrencyToken: "not_applicable",
  }),
  Object.freeze({
    operationId: "portfolios.get_by_id",
    toolName: "btpm_get_portfolio",
    title: "Get BTPM Portfolio",
    description:
      "Canonical safe detail view of one BTPM Portfolio the delegated user may access.",
    operationClass: "read",
    exposure: "exposed",
    confirmation: "not_required",
    resultShape: "single_object",
    concurrencyToken: "not_applicable",
  }),
  Object.freeze({
    operationId: "portfolios.projects.get",
    toolName: "btpm_list_portfolio_projects",
    title: "List BTPM Portfolio Projects",
    description:
      "Bounded, server-paginated list of BTPM Projects assigned to one Portfolio the delegated user may access.",
    operationClass: "read",
    exposure: "exposed",
    confirmation: "not_required",
    resultShape: "bounded_collection",
    concurrencyToken: "not_applicable",
  }),

  Object.freeze({
    operationId: "portfolios.create",
    toolName: "btpm_create_portfolio",
    title: "Create BTPM Portfolio",
    description:
      "Creates one Portfolio in an Organization through the canonical API mutation contract.",
    operationClass: "mutation",
    exposure: "exposed",
    confirmation: "required",
    resultShape: "single_object",
    concurrencyToken: "not_applicable",
  }),
  Object.freeze({
    operationId: "portfolios.update",
    toolName: "btpm_update_portfolio",
    title: "Update BTPM Portfolio",
    description:
      "Updates one Portfolio through the canonical API mutation contract.",
    operationClass: "mutation",
    exposure: "exposed",
    confirmation: "required",
    resultShape: "single_object",
    concurrencyToken: "required",
  }),
  Object.freeze({
    operationId: "portfolios.assign_project",
    toolName: "btpm_assign_project_portfolio",
    title: "Assign BTPM Project Portfolio",
    description:
      "Assigns or clears the Portfolio of one Project through the canonical API mutation contract.",
    operationClass: "mutation",
    exposure: "exposed",
    confirmation: "required",
    resultShape: "single_object",
    concurrencyToken: "not_applicable",
  }),
  // KPI-1C — exposed MCP read for the live REST operation `kpis.get`. It is
  // registered in `serverFactory` with the explicit bounded KPI executor and
  // reads only through the accepted KPI-1B caller-scoped delegated reader.
  Object.freeze({
    operationId: "kpis.get",
    toolName: "btpm_list_project_kpis",
    title: "List BTPM Project KPIs",
    description:
      "Lists the KPI definitions and current KPI state of one authorized Project.",
    operationClass: "read",
    exposure: "exposed",
    confirmation: "not_required",

    resultShape: "bounded_collection",
    concurrencyToken: "not_applicable",
  }),
  // KPI-2C — exposed MCP read for the live REST operation `kpis.get_by_id`.
  // It is registered in `serverFactory` with the explicit bounded KPI detail
  // executor and reads only through the accepted KPI-2B caller-scoped
  // delegated single-KPI reader.
  Object.freeze({
    operationId: "kpis.get_by_id",
    toolName: "btpm_get_kpi",
    title: "Get BTPM KPI",
    description:
      "Canonical safe detail view of one authorized Project KPI.",
    operationClass: "read",
    exposure: "exposed",
    confirmation: "not_required",
    resultShape: "single_object",
    concurrencyToken: "not_applicable",
  }),
  // KPI-3C — exposed MCP read for the live REST operation `kpis.updates.get`.
  // It is registered in `serverFactory` with the explicit bounded KPI
  // update-history executor and reads only through the accepted KPI-3B
  // caller-scoped delegated KPI update-history reader.
  Object.freeze({
    operationId: "kpis.updates.get",
    toolName: "btpm_list_kpi_updates",
    title: "List BTPM KPI Updates",
    description:
      "Bounded update history for one authorized Project KPI.",
    operationClass: "read",
    exposure: "exposed",
    confirmation: "not_required",
    resultShape: "bounded_collection",
    concurrencyToken: "not_applicable",
  }),
  // KPI-4C — the canonical Project KPI definition create command, exposed
  // through the accepted MCP mutation-control layer as `btpm_create_kpi`.
  // Confirmation is mandatory; a create carries no concurrency token.
  Object.freeze({
    operationId: "kpis.create",
    toolName: "btpm_create_kpi",
    title: "Create BTPM KPI",
    description:
      "Creates one KPI definition in an authorized Project through the canonical API mutation contract.",
    operationClass: "mutation",
    exposure: "exposed",
    confirmation: "required",
    resultShape: "single_object",
    concurrencyToken: "not_applicable",
  }),
  // KPI-5B — declarative registry reservation ONLY for the canonical REST
  // operation `kpis.update`, exposed by KPI-5C through the accepted MCP
  // mutation-control layer as `btpm_update_kpi`. Confirmation is mandatory and
  // the caller-supplied `expectedUpdatedAt` concurrency token is required.
  Object.freeze({
    operationId: "kpis.update",
    toolName: "btpm_update_kpi",
    title: "Update BTPM KPI",
    description:
      "Updates one KPI definition through the canonical API mutation contract.",
    operationClass: "mutation",
    exposure: "exposed",
    confirmation: "required",
    resultShape: "single_object",
    concurrencyToken: "required",
  }),
  // KPI-6C — the canonical operation `kpis.updates.append` is exposed through
  // MCP as `btpm_append_kpi_update`: registered once in `serverFactory`, backed
  // by the caller-bound MCP writer for `public.mcp_v1_append_kpi_update`.
  Object.freeze({
    operationId: "kpis.updates.append",
    toolName: "btpm_append_kpi_update",
    title: "Append BTPM KPI Update",
    description:
      "Appends one dated operational KPI update through the canonical API mutation contract.",
    operationClass: "mutation",
    exposure: "exposed",
    confirmation: "required",
    resultShape: "single_object",
    concurrencyToken: "not_applicable",
  }),
] as const);


/** The canonical operation IDs implemented by BTPM API v1. */
export function canonicalOperationIds(): readonly ApiSupportedOperation[] {
  return buildCapabilitiesPayload().supportedOperations;
}

/**
 * Narrows an untrusted value to a canonical operation ID. Untrusted input
 * begins as `unknown` and is never treated as a domain type before validation.
 */
export function isCanonicalOperationId(
  candidate: unknown,
): candidate is ApiSupportedOperation {
  if (typeof candidate !== "string") return false;
  return (canonicalOperationIds() as readonly string[]).includes(candidate);
}

/**
 * API-Q.7A-C2 — Bounded exact-cardinality resolution of the canonical REST
 * route class for an operationId, sourced exclusively from the authoritative
 * REST route allowlist (`API_V1_ROUTE_ALLOWLIST`). The resolver distinguishes
 * three deterministic outcomes so the registry validator can fail closed on
 * each separately:
 *
 * - `"missing"`   — zero canonical route definitions for the operationId;
 * - `"unique"`    — exactly one route definition, carrying its `operation` class;
 * - `"duplicate"` — more than one route definition (ambiguous authority).
 *
 * The previous implementation used `.find()`, which silently selected the
 * first route when duplicates existed. This resolver never silently picks a
 * duplicate: it reports `"duplicate"` and lets the caller decide.
 *
 * `allowlist` is injectable solely so focused tests can prove the
 * duplicate-cardinality branch against a tiny pure fixture without mutating
 * the immutable production allowlist. The production allowlist remains the
 * sole classification authority; no second operationId → class mapping is
 * maintained here.
 */
export type CanonicalRouteClassResolution =
  | { readonly status: "missing" }
  | { readonly status: "unique"; readonly operationClass: McpOperationClass }
  | { readonly status: "duplicate" };

export function resolveCanonicalRouteClass(
  operationId: string,
  allowlist: readonly ApiRouteDefinition[] = API_V1_ROUTE_ALLOWLIST,
): CanonicalRouteClassResolution {
  const routes = allowlist.filter((route) => route.id === operationId);
  if (routes.length === 0) return { status: "missing" };
  if (routes.length === 1) {
    return { status: "unique", operationClass: routes[0].operation };
  }
  return { status: "duplicate" };
}

/**
 * API-Q.7A-C1 — Canonical operation class for an operationId, sourced
 * exclusively from the authoritative REST route allowlist
 * (`API_V1_ROUTE_ALLOWLIST[].operation`). Returns `undefined` when no unique
 * canonical route definition exists for the supplied operationId (i.e. zero or
 * more than one definition). Callers that must distinguish the missing case
 * from the duplicate case should use {@link resolveCanonicalRouteClass}.
 *
 * No second operationId → read/mutation mapping is maintained here: the REST
 * allowlist remains the single authority.
 */
export function canonicalOperationClass(
  operationId: string,
): McpOperationClass | undefined {
  const resolution = resolveCanonicalRouteClass(operationId);
  return resolution.status === "unique" ? resolution.operationClass : undefined;
}

/** A registry integrity violation, reported as a stable, readable string. */
export type McpRegistryViolation = string;

/**
 * Validates registry metadata against the API-Q.2 invariants. Pure; returns
 * every violation found rather than throwing.
 */
export function validateMcpToolRegistry(
  registry: McpToolRegistry,
  allowlist: readonly ApiRouteDefinition[] = API_V1_ROUTE_ALLOWLIST,
): readonly McpRegistryViolation[] {
  const violations: McpRegistryViolation[] = [];
  const seenOperationIds = new Set<string>();
  const seenToolNames = new Set<string>();

  for (const entry of registry) {
    if (!isCanonicalOperationId(entry.operationId)) {
      violations.push(
        `unknown operationId is not a canonical BTPM API v1 operation: ${entry.operationId}`,
      );
    }

    // API-Q.7A-C1 / API-Q.7A-C2 — operationClass parity with the authoritative
    // REST route classification, resolved with bounded exact cardinality. The
    // MCP registry must never declare a class that contradicts the canonical
    // `API_V1_ROUTE_ALLOWLIST[].operation`. This guard is fail-closed across
    // all three cardinalities: missing route (zero), class mismatch (unique),
    // and duplicate route definitions (>1). The REST allowlist is the sole
    // authority; no second operationId → class mapping is maintained.
    const resolution = resolveCanonicalRouteClass(entry.operationId, allowlist);
    if (resolution.status === "missing") {
      violations.push(
        `no canonical route definition for operationId: ${entry.operationId}`,
      );
    } else if (resolution.status === "duplicate") {
      violations.push(
        `duplicate canonical route definitions for operationId: ${entry.operationId}`,
      );
    } else if (entry.operationClass !== resolution.operationClass) {
      violations.push(
        `operationClass mismatch for ${entry.operationId}: registry=${entry.operationClass} canonical=${resolution.operationClass}`,
      );
    }

    if (seenOperationIds.has(entry.operationId)) {
      violations.push(`duplicate operationId: ${entry.operationId}`);
    }
    seenOperationIds.add(entry.operationId);

    if (entry.toolName.trim().length === 0) {
      violations.push(`empty toolName for operationId: ${entry.operationId}`);
    }
    if (seenToolNames.has(entry.toolName)) {
      violations.push(`duplicate toolName: ${entry.toolName}`);
    }
    seenToolNames.add(entry.toolName);

    if (entry.title.trim().length === 0) {
      violations.push(`empty title for operationId: ${entry.operationId}`);
    }
    if (entry.description.trim().length === 0) {
      violations.push(
        `empty description for operationId: ${entry.operationId}`,
      );
    }

    if (
      entry.operationClass === "mutation" && entry.confirmation !== "required"
    ) {
      violations.push(
        `mutation must require confirmation: ${entry.operationId}`,
      );
    }
    if (
      entry.operationClass === "read" && entry.concurrencyToken === "required"
    ) {
      violations.push(
        `read must not require a concurrency token: ${entry.operationId}`,
      );
    }
  }

  return Object.freeze(violations);
}


/**
 * API-Q.8 — Complete-coverage invariant. The MCP registry must carry exactly
 * one explicit exposure decision for every canonical API v1 operation: no
 * canonical operation may be undecided, and no non-canonical operation may
 * appear. A future canonical API operation therefore requires an explicit MCP
 * registry decision (which defaults to `not_exposed`) rather than silently
 * becoming available.
 */
export function validateMcpRegistryCoverage(
  registry: McpToolRegistry = MCP_TOOL_REGISTRY,
): readonly McpRegistryViolation[] {
  const violations: McpRegistryViolation[] = [];
  const registered = new Set<string>(registry.map((e) => e.operationId));
  for (const canonical of canonicalOperationIds()) {
    if (!registered.has(canonical)) {
      violations.push(`canonical operation has no MCP decision: ${canonical}`);
    }
  }
  for (const entry of registry) {
    if (!isCanonicalOperationId(entry.operationId)) {
      violations.push(`non-canonical registry entry: ${entry.operationId}`);
    }
  }
  if (registry.length !== canonicalOperationIds().length) {
    violations.push(
      `registry cardinality ${registry.length} does not equal canonical cardinality ${canonicalOperationIds().length}`,
    );
  }
  return Object.freeze(violations);
}

/**
 * Fail-closed exposure decision for an untrusted candidate operation ID.
 * Unknown or unregistered operations are never exposed.
 */
export function isMcpOperationExposed(
  candidate: unknown,
  registry: McpToolRegistry = MCP_TOOL_REGISTRY,
): boolean {
  if (!isCanonicalOperationId(candidate)) return false;
  return registry.some(
    (entry) => entry.operationId === candidate && entry.exposure === "exposed",
  );
}

/**
 * The currently exposed registry entries, derived from the canonical registry's
 * explicit exposure decisions.
 */
export function exposedMcpTools(
  registry: McpToolRegistry = MCP_TOOL_REGISTRY,
): McpToolRegistry {
  return Object.freeze(registry.filter((e) => e.exposure === "exposed"));
}
