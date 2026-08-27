// API-G.1I — Explicit route allowlist (canonical contract).
//
// This module is the single source of truth for the frozen API v1 route
// allowlist and its identity/operation types. It lives under `_shared` so both
// the `btpm-api-v1` REST runtime and the `btpm-mcp` runtime can reach it inside
// their own deployment bundles. `btpm-api-v1/router.ts` re-exports every symbol
// declared here; no second allowlist exists.
//
// Pure declarations only: no environment access, no I/O, no route handling.

import { VERSION_ROUTE } from "./version.ts";
import { CAPABILITIES_ROUTE } from "./capabilities.ts";
import { ME_ROUTE } from "./me.ts";
import { ORGANIZATIONS_ROUTE } from "./organizations.ts";
import { WORKSPACES_ROUTE } from "./workspaces.ts";
import { WORKSPACE_MEMBERS_ROUTE } from "./workspaceMembers.ts";
import {
  PORTFOLIOS_ROUTE,
  PORTFOLIO_ASSIGN_PROJECT_ROUTE,
  PORTFOLIO_CREATE_ROUTE,
  PORTFOLIO_DETAIL_ROUTE,
  PORTFOLIO_PROJECTS_ROUTE,
  PORTFOLIO_UPDATE_ROUTE,
} from "./portfolios.ts";
import {
  PROGRAM_CREATE_ROUTE,
  PROGRAM_DETAIL_ROUTE,
  PROGRAM_UPDATE_ROUTE,
  PROGRAMS_ROUTE,
} from "./programs.ts";
import {
  PROJECT_CREATE_ROUTE,
  PROJECT_TRANSITION_ROUTE,
  PROJECT_UPDATE_ROUTE,
  PROJECTS_ROUTE,
} from "./projects.ts";
import { PROJECT_DETAIL_ROUTE } from "./projectDetail.ts";
import { PROJECT_PLANNING_ROUTE } from "./projectPlanning.ts";
import {
  EXECUTION_UPDATES_APPEND_ROUTE,
  EXECUTION_UPDATES_READ_ROUTE,
} from "./executionUpdates.ts";
import {
  RISK_CREATE_ROUTE,
  RISK_DETAIL_ROUTE,
  RISK_PROJECT_COLLECTION_ROUTE,
  RISK_UPDATE_ROUTE,
} from "./risks.ts";
import {
  BLOCKER_CREATE_ROUTE,
  BLOCKER_DETAIL_ROUTE,
  BLOCKER_PROJECT_COLLECTION_ROUTE,
  BLOCKER_UPDATE_ROUTE,
} from "./blockers.ts";
import {
  PHASE_CREATE_ROUTE,
  PHASE_DETAIL_ROUTE,
  PHASE_PLANNING_ROUTE,
  PHASE_REORDER_ROUTE,
  PHASE_UPDATE_ROUTE,
} from "./phases.ts";
import {
  TASK_ASSIGN_ROUTE,
  TASK_CREATE_ROUTE,
  TASK_DETAIL_ROUTE,
  TASK_PLANNING_ROUTE,
  TASK_REORDER_ROUTE,
  TASK_TRANSITION_ROUTE,
  TASK_UPDATE_ROUTE,
} from "./tasks.ts";
import {
  KPI_CREATE_ROUTE,
  KPI_DETAIL_ROUTE,
  KPI_PROJECT_COLLECTION_ROUTE,
  KPI_UPDATE_APPEND_ROUTE,
  KPI_UPDATE_ROUTE,
  KPI_UPDATES_ROUTE,
} from "./kpis.ts";

export type ApiOperationKind = "read" | "mutation";

export type ApiRouteId =
  | "version.get"
  | "capabilities.get"
  | "me.get"
  | "organizations.get"
  | "workspaces.get"
  | "programs.get"
  | "programs.get_by_id"

  | "projects.get"
  | "projects.get_by_id"
  | "projects.planning.get"
  | "projects.create"
  | "projects.update"
  | "projects.transition"
  // API-N.9A / API-N.9B — the two accepted external Program commands.
  | "programs.create"
  | "programs.update"
  | "execution_updates.append"
  | "execution_updates.get"
  | "risks.get"
  | "risks.get_by_id"
  | "risks.create"
  | "risks.update"
  | "blockers.get"
  | "blockers.get_by_id"
  | "blockers.create"
  | "blockers.update"
  | "phases.get_by_id"
  | "phases.create"
  | "phases.update"
  | "phases.reorder"
  | "phases.plan"
  | "tasks.get_by_id"
  | "tasks.create"
  | "tasks.update"
  | "tasks.reorder"
  | "tasks.plan"
  | "tasks.assign"
  | "tasks.transition"
  // API-Q WML-1B — the accepted external Workspace-member read, appended last
  // so every previously frozen route id position is preserved.
  | "workspace_members.get"
  // API-Q Portfolio-3 — the three accepted external Portfolio reads, appended
  // last so every previously frozen route id position is preserved.
  | "portfolios.get"
  | "portfolios.get_by_id"
  | "portfolios.projects.get"
  // API-Q Portfolio-4B — the single accepted external Portfolio command,
  // appended last so every previously frozen route id position is preserved.
  | "portfolios.create"
  // API-Q Portfolio-5B — the accepted external Portfolio metadata update
  // command, appended last so every previously frozen route id position is
  // preserved.
  | "portfolios.update"
  // API-Q Portfolio-6B — the accepted external Project↔Portfolio assignment
  // command, appended last so every previously frozen route id position is
  // preserved.
  | "portfolios.assign_project"
  // KPI-1B — the single accepted external Project KPI collection read.
  | "kpis.get"
  // KPI-2B — the single accepted external KPI detail read, appended last so
  // every previously frozen route id position is preserved.
  | "kpis.get_by_id"
  // KPI-3B — the accepted external KPI update-history read, appended last so
  // every previously frozen route id position is preserved.
  | "kpis.updates.get"
  // KPI-4B — the single accepted external Project KPI definition create
  // command, appended last so every previously frozen route id position is
  // preserved.
  | "kpis.create"
  // KPI-5B — the single accepted external KPI definition update command,
  // appended last so every previously frozen route id position is preserved.
  | "kpis.update"
  // KPI-6B — the single accepted external KPI update-history append command,
  // appended last so every previously frozen route id position is preserved.
  | "kpis.updates.append";

export type ApiRouteMethod = "GET" | "POST" | "PATCH" | "PUT";

export interface ApiRouteDefinition {
  readonly id: ApiRouteId;
  readonly method: ApiRouteMethod;
  readonly path: string;
  readonly operation: ApiOperationKind;
}

export const API_V1_ROUTE_ALLOWLIST: readonly ApiRouteDefinition[] =
  Object.freeze([
    VERSION_ROUTE,
    CAPABILITIES_ROUTE,
    ME_ROUTE,
    ORGANIZATIONS_ROUTE,
    WORKSPACES_ROUTE,
    // API-N.2B — the two accepted external Program reads.
    PROGRAMS_ROUTE,
    PROGRAM_DETAIL_ROUTE,

    PROJECTS_ROUTE,
    PROJECT_DETAIL_ROUTE,
    PROJECT_PLANNING_ROUTE,
    EXECUTION_UPDATES_APPEND_ROUTE,
    RISK_CREATE_ROUTE,
    RISK_UPDATE_ROUTE,
    BLOCKER_CREATE_ROUTE,
    BLOCKER_UPDATE_ROUTE,
    PHASE_CREATE_ROUTE,
    PHASE_UPDATE_ROUTE,
    PHASE_REORDER_ROUTE,
    PHASE_PLANNING_ROUTE,
    TASK_CREATE_ROUTE,
    TASK_UPDATE_ROUTE,
    TASK_REORDER_ROUTE,
    TASK_PLANNING_ROUTE,
    TASK_ASSIGN_ROUTE,
    TASK_TRANSITION_ROUTE,
    // API-M.CP.2B2 — the two accepted external Risk read routes.
    RISK_PROJECT_COLLECTION_ROUTE,
    RISK_DETAIL_ROUTE,
    // API-M.CP.2C3 — the two accepted external Blocker read routes.
    BLOCKER_PROJECT_COLLECTION_ROUTE,
    BLOCKER_DETAIL_ROUTE,
    // API-M.CP.3C — the accepted external Execution Update history read.
    EXECUTION_UPDATES_READ_ROUTE,
    // API-M.CP.4C — the two accepted external Phase/Task detail reads.
    PHASE_DETAIL_ROUTE,
    TASK_DETAIL_ROUTE,
    // API-N.5 — the single accepted external Project command, appended last so
    // every previously frozen allowlist position is preserved.
    PROJECT_CREATE_ROUTE,
    // API-N.6 — the accepted external Project metadata update command, appended
    // immediately after projects.create so every earlier position is stable.
    PROJECT_UPDATE_ROUTE,
    // API-N.7 — the accepted external Project status-transition command,
    // appended immediately after projects.update so every earlier position is
    // stable.
    PROJECT_TRANSITION_ROUTE,
    // API-N.9A — the single accepted external Program command, appended last so
    // every previously frozen allowlist position is preserved.
    PROGRAM_CREATE_ROUTE,
    // API-N.9B — the accepted external Program metadata update command,
    // appended immediately after programs.create so every earlier position is
    // preserved.
    PROGRAM_UPDATE_ROUTE,
    // API-Q WML-1B — the accepted external Workspace-member read, appended last
    // so every previously frozen allowlist position is preserved.
    WORKSPACE_MEMBERS_ROUTE,
    // API-Q Portfolio-3 — the three accepted external Portfolio reads, appended
    // last so every previously frozen allowlist position is preserved.
    PORTFOLIOS_ROUTE,
    PORTFOLIO_DETAIL_ROUTE,
    PORTFOLIO_PROJECTS_ROUTE,
    // API-Q Portfolio-4B — the single accepted external Portfolio command,
    // appended last so every previously frozen allowlist position is preserved.
    PORTFOLIO_CREATE_ROUTE,
    // API-Q Portfolio-5B — the accepted external Portfolio metadata update
    // command, appended immediately after portfolios.create so every earlier
    // position is preserved.
    PORTFOLIO_UPDATE_ROUTE,
    // API-Q Portfolio-6B — the accepted external Project↔Portfolio assignment
    // command, appended immediately after portfolios.update so every earlier
    // position is preserved.
    PORTFOLIO_ASSIGN_PROJECT_ROUTE,
    // KPI-1B — the single accepted external Project KPI collection read,
    // appended last so every previously frozen allowlist position is preserved.
    KPI_PROJECT_COLLECTION_ROUTE,
    // KPI-2B — the accepted external KPI detail read, appended immediately
    // after kpis.get so every earlier allowlist position is preserved.
    KPI_DETAIL_ROUTE,
    // KPI-3B — the accepted external KPI update-history read, appended
    // immediately after kpis.get_by_id so every earlier allowlist position is
    // preserved.
    KPI_UPDATES_ROUTE,
    // KPI-4B — the single accepted external Project KPI definition create
    // command, appended immediately after kpis.updates.get so every earlier
    // allowlist position is preserved.
    KPI_CREATE_ROUTE,
    // KPI-5B — the single accepted external KPI definition update command,
    // appended immediately after kpis.create so every earlier allowlist
    // position is preserved.
    KPI_UPDATE_ROUTE,
    // KPI-6B — the single accepted external KPI update-history append command,
    // appended immediately after kpis.update so every earlier allowlist
    // position is preserved.
    KPI_UPDATE_APPEND_ROUTE,
  ] as const);
