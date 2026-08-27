// API-G.1H — Fail-closed runtime-control contract for btpm-api-v1.
//
// Pure runtime-control types and helpers. This module MUST NOT read
// the environment, open network connections, construct Supabase
// clients, touch the database, register routes, handle HTTP requests,
// log, schedule timers, or hold any mutable global state. The future
// Edge Function entry point will read the environment and pass only
// the three declared values into `parseApiRuntimeControls`.

import { ApiHttpError } from "../_shared/btpm-api/http.ts";
import type { AuthenticatedApiContext } from "../_shared/btpm-api/authenticateApiRequest.ts";
import { ApiAuthenticationError } from "../_shared/btpm-api/apiErrors.ts";
import {
  enforceApiRateLimit,
  type ApiRateLimitDependencies,
  type ApiRateLimitProfile,
} from "../_shared/btpm-api/rateLimit.ts";
import { apiUuidSchema } from "../_shared/btpm-api/schemas.ts";
import {
  type ApiVersionPayload,
  VERSION_ROUTE,
  buildVersionPayload,
} from "./routes/version.ts";
import {
  type ApiCapabilitiesPayload,
  CAPABILITIES_ROUTE,
  buildCapabilitiesPayload,
} from "./routes/capabilities.ts";
import { ME_ROUTE, parseApiV1MeQuery } from "./routes/me.ts";
import {
  ORGANIZATIONS_ROUTE,
  parseApiV1OrganizationsQuery,
} from "./routes/organizations.ts";
import {
  WORKSPACES_ROUTE,
  parseApiV1WorkspacesQuery,
} from "./routes/workspaces.ts";
// API-Q WML-1B — accepted Workspace-member read route contract and its strict
// path/query parsers. No generic Workspace subresource matcher is introduced.
import {
  WORKSPACE_MEMBERS_ROUTE,
  parseApiV1WorkspaceMembersPath,
  parseApiV1WorkspaceMembersQuery,
} from "./routes/workspaceMembers.ts";
import {
  PROJECTS_ROUTE,
  parseApiV1ProjectsQuery,
  // API-N.5 — the single accepted external Project mutation contract.
  PROJECT_CREATE_ROUTE,
  parseApiV1CreateProjectBody,
  type ApiV1CreateProjectBody,
  // API-N.6 — the accepted external Project metadata update contract.
  PROJECT_UPDATE_ROUTE,
  parseApiV1ProjectUpdatePath,
  parseApiV1UpdateProjectBody,
  buildApiV1UpdateProjectIdempotencyPayload,
  type ApiV1UpdateProjectBody,
  // API-N.7 — the accepted external Project status-transition contract.
  PROJECT_TRANSITION_ROUTE,
  parseApiV1ProjectTransitionPath,
  parseApiV1TransitionProjectBody,
  buildApiV1TransitionProjectIdempotencyPayload,
  type ApiV1TransitionProjectBody,
} from "./routes/projects.ts";
import {
  PROJECT_DETAIL_ROUTE,
  parseApiV1ProjectDetailPath,
} from "./routes/projectDetail.ts";
// API-N.2B — accepted Program read route contracts and strict parsers.
import {
  PROGRAMS_ROUTE,
  PROGRAM_DETAIL_ROUTE,
  parseApiV1ProgramDetailPath,
  parseApiV1ProgramsQuery,
  // API-N.9A — the single accepted external Program mutation contract.
  PROGRAM_CREATE_ROUTE,
  parseApiV1CreateProgramBody,
  parseApiV1ProgramUpdatePath,
  parseApiV1UpdateProgramBody,
  PROGRAM_UPDATE_ROUTE,
  buildApiV1UpdateProgramIdempotencyPayload,
  type ApiV1CreateProgramBody,
  type ApiV1UpdateProgramBody,
} from "./routes/programs.ts";
// API-Q Portfolio-3 — accepted Portfolio read route contracts and strict parsers.
// API-Q Portfolio-4B — the single accepted external Portfolio create contract.
// API-Q Portfolio-5B — the accepted external Portfolio update contract.
import {
  PORTFOLIOS_ROUTE,
  PORTFOLIO_CREATE_ROUTE,
  PORTFOLIO_DETAIL_ROUTE,
  PORTFOLIO_PROJECTS_ROUTE,
  PORTFOLIO_UPDATE_ROUTE,
  parseApiV1PortfoliosQuery,
  parseApiV1PortfolioDetailPath,
  parseApiV1PortfolioProjectsPath,
  parseApiV1PortfolioProjectsQuery,
  parseApiV1CreatePortfolioBody,
  parseApiV1PortfolioUpdatePath,
  parseApiV1UpdatePortfolioBody,
  buildApiV1UpdatePortfolioIdempotencyPayload,
  // API-Q Portfolio-6B — the accepted external Project↔Portfolio assignment
  // contract and its strict parsers.
  PORTFOLIO_ASSIGN_PROJECT_ROUTE,
  parseApiV1PortfolioAssignProjectPath,
  parseApiV1AssignProjectPortfolioBody,
  buildApiV1AssignProjectPortfolioIdempotencyPayload,
  type ApiV1AssignProjectPortfolioBody,
  type ApiV1CreatePortfolioBody,
  type ApiV1UpdatePortfolioBody,
} from "./routes/portfolios.ts";


// API-M.4 — Project planning read route contract and strict path parser.
import {
  PROJECT_PLANNING_ROUTE,
  parseApiV1ProjectPlanningPath,
} from "./routes/projectPlanning.ts";
// API-I.8 — Router registration only. The frozen API-I.6 route constant is
// reused as-is. API-I.9A additionally reuses the accepted strict body parser
// for the dedicated (still non-live) mutation pipeline below.
import {
  EXECUTION_UPDATES_APPEND_ROUTE,
  // API-M.CP.3C — accepted CP.3B frozen read route contract and strict query
  // parser. Reused unchanged; no second parser or cursor is introduced.
  EXECUTION_UPDATES_READ_ROUTE,
  parseApiV1AppendExecutionUpdateBody,
  parseApiV1ExecutionUpdatesReadQuery,
  type ApiV1AppendExecutionUpdateBody,
} from "./routes/executionUpdates.ts";
// API-K.7 — explicit Risk mutation contracts. The accepted execution-update
// route is untouched; no generic mutation engine is introduced.
// API-M.CP.2B2 — the two accepted CP.2B1 Risk read contracts and their strict
// parsers are activated here. They are reused exactly as accepted.
import {
  RISK_CREATE_ROUTE,
  RISK_DETAIL_ROUTE,
  RISK_PROJECT_COLLECTION_ROUTE,
  RISK_UPDATE_ROUTE,
  buildApiV1UpdateRiskIdempotencyPayload,
  parseApiV1CreateRiskBody,
  parseApiV1ProjectRisksPath,
  parseApiV1ProjectRisksQuery,
  parseApiV1RiskDetailPath,
  parseApiV1RiskUpdatePath,
  parseApiV1UpdateRiskBody,
  type ApiV1CreateRiskBody,
  type ApiV1UpdateRiskBody,
} from "./routes/risks.ts";
// KPI-1B — the single accepted external Project KPI collection read contract
// and its strict parsers. Reused exactly as accepted; no generic Project
// subresource dispatcher is introduced.
import {
  KPI_PROJECT_COLLECTION_ROUTE,
  parseApiV1KpiDetailPath,
  parseApiV1KpiUpdatesPath,
  parseApiV1KpiUpdatesQuery,
  parseApiV1ProjectKpisPath,
  parseApiV1ProjectKpisQuery,
  KPI_DETAIL_ROUTE,
  // KPI-3B — the accepted external KPI update-history read contract.
  KPI_UPDATES_ROUTE,
  // KPI-4B — the single accepted external Project KPI definition create
  // contract and its strict body/idempotency helpers.
  KPI_CREATE_ROUTE,
  buildApiV1CreateKpiIdempotencyPayload,
  parseApiV1CreateKpiBody,
  type ApiV1CreateKpiBody,
  // KPI-5B — the single accepted external KPI definition update contract and
  // its strict body/idempotency helpers.
  KPI_UPDATE_ROUTE,
  buildApiV1UpdateKpiIdempotencyPayload,
  parseApiV1UpdateKpiBody,
  type ApiV1UpdateKpiBody,
  // KPI-6B — the single accepted external KPI update-history append contract
  // and its strict closed-schema body parser.
  KPI_UPDATE_APPEND_ROUTE,
  buildApiV1AppendKpiUpdateIdempotencyPayload,
  parseApiV1AppendKpiUpdateBody,
  type ApiV1AppendKpiUpdateBody,
} from "../_shared/btpm-api/routes/kpis.ts";
// KPI-4B — accepted caller-scoped delegated KPI create executor + result types.
import type {
  DelegatedApiV1AppendKpiUpdateExecutor,
  DelegatedApiV1CreateKpiExecutor,
  DelegatedApiV1UpdateKpiExecutor,
} from "../_shared/btpm-api/supabaseDelegatedKpiMutation.ts";
import type {
  ApiV1AppendKpiUpdateSuccessResult,
  ApiV1CreateKpiSuccessResult,
  ApiV1UpdateKpiSuccessResult,
} from "../_shared/btpm-api/supabaseKpiMutation.ts";
import type {
  ApiV1KpiUpdatesPayload,
  ApiV1ProjectKpiItem,
  ApiV1ProjectKpisPayload,
} from "../_shared/btpm-api/supabaseKpiRead.ts";
import type {
  DelegatedApiV1KpiReader,
  DelegatedApiV1KpiUpdatesReader,
  DelegatedApiV1ProjectKpisReader,
} from "../_shared/btpm-api/supabaseDelegatedKpiRead.ts";

// API-K.8 — explicit Blocker mutation contracts. Separate, narrow surface:
// no generic CRUD/mutation dispatcher is introduced.
// API-M.CP.2C3 — the two accepted CP.2C2 Blocker read contracts and their
// strict parsers are activated here. They are reused exactly as accepted.
import {
  BLOCKER_CREATE_ROUTE,
  BLOCKER_DETAIL_ROUTE,
  BLOCKER_PROJECT_COLLECTION_ROUTE,
  BLOCKER_UPDATE_ROUTE,
  buildApiV1UpdateBlockerIdempotencyPayload,
  parseApiV1BlockerDetailPath,
  parseApiV1BlockerUpdatePath,
  parseApiV1CreateBlockerBody,
  parseApiV1ProjectBlockersPath,
  parseApiV1ProjectBlockersQuery,
  parseApiV1UpdateBlockerBody,
  type ApiV1CreateBlockerBody,
  type ApiV1UpdateBlockerBody,
} from "./routes/blockers.ts";

// API-M.8A — explicit Phase mutation contracts. Separate, narrow surface: no
// generic CRUD/mutation dispatcher is introduced.
import {
  PHASE_CREATE_ROUTE,
  // API-M.CP.4C — accepted CP.4B frozen Phase detail read contract and its
  // strict path parser. Reused unchanged; no second parser is introduced.
  PHASE_DETAIL_ROUTE,
  PHASE_PLANNING_ROUTE,
  PHASE_REORDER_ROUTE,
  PHASE_UPDATE_ROUTE,
  buildApiV1PlanPhaseIdempotencyPayload,
  buildApiV1ReorderPhasesIdempotencyPayload,
  buildApiV1UpdatePhaseIdempotencyPayload,
  parseApiV1CreatePhaseBody,
  parseApiV1PhaseDetailPath,
  parseApiV1PhasePlanningPath,
  parseApiV1PhaseReorderPath,
  parseApiV1PhaseUpdatePath,
  parseApiV1PlanPhaseBody,
  parseApiV1ReorderPhasesBody,
  parseApiV1UpdatePhaseBody,
  type ApiV1CreatePhaseBody,
  type ApiV1PlanPhaseBody,
  type ApiV1ReorderPhasesBody,
  type ApiV1UpdatePhaseBody,
} from "./routes/phases.ts";
// API-M.11A / API-M.11B — explicit Task mutation contracts (create, metadata
// update, reorder, planning). No generic Task CRUD or command dispatcher is
// introduced.
import {
  TASK_ASSIGN_ROUTE,
  TASK_CREATE_ROUTE,
  // API-M.CP.4C — accepted CP.4B frozen Task detail read contract and its
  // strict path parser. Reused unchanged; no second parser is introduced.
  TASK_DETAIL_ROUTE,
  TASK_PLANNING_ROUTE,
  TASK_REORDER_ROUTE,
  TASK_TRANSITION_ROUTE,
  TASK_UPDATE_ROUTE,
  buildApiV1AssignTaskIdempotencyPayload,
  buildApiV1PlanTaskIdempotencyPayload,
  buildApiV1ReorderTasksIdempotencyPayload,
  buildApiV1TransitionTaskIdempotencyPayload,
  buildApiV1UpdateTaskIdempotencyPayload,
  parseApiV1AssignTaskBody,
  parseApiV1CreateTaskBody,
  parseApiV1PlanTaskBody,
  parseApiV1ReorderTasksBody,
  parseApiV1TaskAssignPath,
  parseApiV1TaskDetailPath,
  parseApiV1TaskPlanningPath,
  parseApiV1TaskReorderPath,
  parseApiV1TaskTransitionPath,
  parseApiV1TaskUpdatePath,
  parseApiV1TransitionTaskBody,
  parseApiV1UpdateTaskBody,
  type ApiV1AssignTaskBody,
  type ApiV1CreateTaskBody,
  type ApiV1PlanTaskBody,
  type ApiV1ReorderTasksBody,
  type ApiV1TransitionTaskBody,
  type ApiV1UpdateTaskBody,
} from "./routes/tasks.ts";

import {
  buildExecutionContext,
  ExecutionContextError,
} from "../_shared/btpm-api/buildExecutionContext.ts";
import { IdempotencyValidationError } from "../_shared/btpm-api/idempotency.ts";
import type { ApiV1AppendExecutionUpdateSuccessResult } from "../_shared/btpm-api/supabaseAppendExecutionUpdate.ts";
import type { DelegatedApiV1AppendExecutionUpdateExecutor } from "../_shared/btpm-api/supabaseDelegatedAppendExecutionUpdate.ts";
import type {
  ApiV1CreateRiskSuccessResult,
  ApiV1UpdateRiskSuccessResult,
} from "../_shared/btpm-api/supabaseRisk.ts";
import type {
  DelegatedApiV1CreateRiskExecutor,
  DelegatedApiV1UpdateRiskExecutor,
} from "../_shared/btpm-api/supabaseDelegatedRisk.ts";
import type {
  ApiV1CreateBlockerSuccessResult,
  ApiV1UpdateBlockerSuccessResult,
} from "../_shared/btpm-api/supabaseBlocker.ts";
import type {
  DelegatedApiV1CreateBlockerExecutor,
  DelegatedApiV1UpdateBlockerExecutor,
} from "../_shared/btpm-api/supabaseDelegatedBlocker.ts";
import type {
  ApiV1CreatePhaseConfirmationRequiredResult,
  ApiV1CreatePhaseSuccessResult,
  ApiV1PlanPhaseConfirmationRequiredResult,
  ApiV1PlanPhaseSuccessResult,
  ApiV1ReorderPhasesSuccessResult,
  ApiV1UpdatePhaseSuccessResult,
} from "../_shared/btpm-api/supabasePhase.ts";
import type {
  DelegatedApiV1CreatePhaseExecutor,
  DelegatedApiV1PlanPhaseExecutor,
  DelegatedApiV1ReorderPhasesExecutor,
  DelegatedApiV1UpdatePhaseExecutor,
} from "../_shared/btpm-api/supabaseDelegatedPhase.ts";
import type {
  ApiV1AssignTaskSuccessResult,
  ApiV1CreateTaskConfirmationRequiredResult,
  ApiV1CreateTaskSuccessResult,
  ApiV1PlanTaskConfirmationRequiredResult,
  ApiV1PlanTaskSuccessResult,
  ApiV1ReorderTasksSuccessResult,
  ApiV1TransitionTaskSuccessResult,
  ApiV1UpdateTaskSuccessResult,
} from "../_shared/btpm-api/supabaseTask.ts";
import type {
  DelegatedApiV1AssignTaskExecutor,
  DelegatedApiV1CreateTaskExecutor,
  DelegatedApiV1PlanTaskExecutor,
  DelegatedApiV1ReorderTasksExecutor,
  DelegatedApiV1TransitionTaskExecutor,
  DelegatedApiV1UpdateTaskExecutor,
} from "../_shared/btpm-api/supabaseDelegatedTask.ts";


import type { ApiV1MePayload } from "../_shared/btpm-api/supabaseReadMe.ts";
import type { DelegatedApiV1MeReader } from "../_shared/btpm-api/supabaseDelegatedReadMe.ts";
import type { ApiV1OrganizationsPayload } from "../_shared/btpm-api/supabaseOrganizations.ts";
import type { DelegatedApiV1OrganizationsReader } from "../_shared/btpm-api/supabaseDelegatedOrganizations.ts";
import type { ApiV1WorkspacesPayload } from "../_shared/btpm-api/supabaseWorkspaces.ts";
import type { DelegatedApiV1WorkspacesReader } from "../_shared/btpm-api/supabaseDelegatedWorkspaces.ts";
import type { ApiV1WorkspaceMembersPayload } from "../_shared/btpm-api/supabaseWorkspaceMembers.ts";
import type { DelegatedApiV1WorkspaceMembersReader } from "../_shared/btpm-api/supabaseDelegatedWorkspaceMembers.ts";
// API-N.2B — accepted Program read payload and reader contracts.
import type {
  ApiV1ProgramDetailPayload,
  ApiV1ProgramsPayload,
} from "../_shared/btpm-api/supabaseProgramRead.ts";
import type {
  DelegatedApiV1ProgramReader,
  DelegatedApiV1ProgramsReader,
} from "../_shared/btpm-api/supabaseDelegatedProgramRead.ts";
// API-Q Portfolio-3 — accepted Portfolio read payload and reader contracts.
import type {
  ApiV1PortfolioDetailPayload,
  ApiV1PortfolioProjectsPayload,
  ApiV1PortfoliosPayload,
} from "../_shared/btpm-api/supabasePortfolioRead.ts";
import type {
  DelegatedApiV1PortfolioProjectsReader,
  DelegatedApiV1PortfolioReader,
  DelegatedApiV1PortfoliosReader,
} from "../_shared/btpm-api/supabaseDelegatedPortfolioRead.ts";
// API-Q Portfolio-4B / Portfolio-5B — the accepted external Portfolio mutation
// adapters.
import type {
  DelegatedApiV1AssignProjectPortfolioExecutor,
  DelegatedApiV1CreatePortfolioExecutor,
  DelegatedApiV1UpdatePortfolioExecutor,
} from "../_shared/btpm-api/supabaseDelegatedPortfolioMutation.ts";
import type {
  ApiV1AssignProjectPortfolioSuccessResult,
  ApiV1CreatePortfolioSuccessResult,
  ApiV1UpdatePortfolioSuccessResult,
} from "../_shared/btpm-api/supabasePortfolioMutation.ts";



import type { ApiV1ProjectsPayload } from "../_shared/btpm-api/supabaseProjects.ts";
import type { DelegatedApiV1ProjectsReader } from "../_shared/btpm-api/supabaseDelegatedProjects.ts";
import type { ApiV1ProjectDetailPayload } from "../_shared/btpm-api/supabaseProjectDetail.ts";
import type { DelegatedApiV1ProjectDetailReader } from "../_shared/btpm-api/supabaseDelegatedProjectDetail.ts";
import type { ApiV1ProjectPlanningPayload } from "../_shared/btpm-api/supabaseProjectPlanning.ts";
import type { DelegatedApiV1ProjectPlanningReader } from "../_shared/btpm-api/supabaseDelegatedProjectPlanning.ts";
// API-M.CP.2B2 — accepted CP.2B1 Risk read payload and reader contracts.
import type {
  ApiV1ProjectRisksPayload,
  ApiV1RiskReadItem,
} from "../_shared/btpm-api/supabaseRiskRead.ts";
import type {
  DelegatedApiV1ProjectRisksReader,
  DelegatedApiV1RiskReader,
} from "../_shared/btpm-api/supabaseDelegatedRiskRead.ts";
// API-M.CP.2C3 — accepted CP.2C2 Blocker read payload and reader contracts.
import type {
  ApiV1BlockerReadItem,
  ApiV1ProjectBlockersPayload,
} from "../_shared/btpm-api/supabaseBlockerRead.ts";
import type {
  DelegatedApiV1BlockerReader,
  DelegatedApiV1ProjectBlockersReader,
} from "../_shared/btpm-api/supabaseDelegatedBlockerRead.ts";
// API-M.CP.3C — accepted CP.3B Execution Update read payload and reader
// contracts.
import type { ApiV1ExecutionUpdatesPayload } from "../_shared/btpm-api/supabaseExecutionUpdateRead.ts";
import type { DelegatedApiV1ExecutionUpdatesReader } from "../_shared/btpm-api/supabaseDelegatedExecutionUpdateRead.ts";
// API-M.CP.4C — accepted CP.4B Phase/Task detail read payload and reader
// contracts. Reused unchanged.
import type { ApiV1PhaseReadItem } from "../_shared/btpm-api/supabasePhaseRead.ts";
import type { DelegatedApiV1PhaseReader } from "../_shared/btpm-api/supabaseDelegatedPhaseRead.ts";
import type { ApiV1TaskReadItem } from "../_shared/btpm-api/supabaseTaskRead.ts";
import type { DelegatedApiV1TaskReader } from "../_shared/btpm-api/supabaseDelegatedTaskRead.ts";
// API-N.5 — the single accepted external Project mutation adapters.
import type {
  DelegatedApiV1CreateProjectExecutor,
  DelegatedApiV1TransitionProjectExecutor,
  DelegatedApiV1UpdateProjectExecutor,
} from "../_shared/btpm-api/supabaseDelegatedProjectMutation.ts";
import type {
  ApiV1CreateProjectSuccessResult,
  ApiV1TransitionProjectBlockedResult,
  ApiV1TransitionProjectConfirmationResult,
  ApiV1TransitionProjectSuccessResult,
  ApiV1UpdateProjectSuccessResult,
} from "../_shared/btpm-api/supabaseProjectMutation.ts";
// API-N.9A — the single accepted external Program mutation adapters.
import type {
  DelegatedApiV1CreateProgramExecutor,
  DelegatedApiV1UpdateProgramExecutor,
} from "../_shared/btpm-api/supabaseDelegatedProgramMutation.ts";
import type {
  ApiV1CreateProgramSuccessResult,
  ApiV1UpdateProgramSuccessResult,
} from "../_shared/btpm-api/supabaseProgramMutation.ts";

export type ApiRoutePayload =
  | ApiVersionPayload
  | ApiCapabilitiesPayload
  | ApiV1MePayload
  | ApiV1OrganizationsPayload
  | ApiV1WorkspacesPayload
  | ApiV1WorkspaceMembersPayload
  | ApiV1ProgramsPayload
  | ApiV1ProgramDetailPayload
  | ApiV1PortfoliosPayload
  | ApiV1PortfolioDetailPayload
  | ApiV1PortfolioProjectsPayload



  | ApiV1ProjectsPayload
  | ApiV1ProjectDetailPayload
  | ApiV1ProjectPlanningPayload
  | ApiV1ProjectRisksPayload
  | ApiV1ProjectKpisPayload
  | ApiV1ProjectKpiItem
  | ApiV1KpiUpdatesPayload
  | ApiV1RiskReadItem
  | ApiV1ProjectBlockersPayload
  | ApiV1BlockerReadItem
  | ApiV1ExecutionUpdatesPayload
  | ApiV1PhaseReadItem
  | ApiV1TaskReadItem;



export type {
  ApiOperationKind,
  ApiRouteDefinition,
  ApiRouteId,
  ApiRouteMethod,
} from "../_shared/btpm-api/routes/allowlist.ts";
export { API_V1_ROUTE_ALLOWLIST } from "../_shared/btpm-api/routes/allowlist.ts";
import type {
  ApiOperationKind,
  ApiRouteDefinition,
} from "../_shared/btpm-api/routes/allowlist.ts";
import { API_V1_ROUTE_ALLOWLIST } from "../_shared/btpm-api/routes/allowlist.ts";

export interface ApiRuntimeControlEnvironment {
  BTPM_API_ENABLED?: string;
  BTPM_API_READS_ENABLED?: string;
  BTPM_API_MUTATIONS_ENABLED?: string;
}

export interface ApiRuntimeControls {
  readonly apiEnabled: boolean;
  readonly readsEnabled: boolean;
  readonly mutationsEnabled: boolean;
}

const SECURE_DEFAULT: ApiRuntimeControls = Object.freeze({
  apiEnabled: false,
  readsEnabled: false,
  mutationsEnabled: false,
});

function parseSwitch(value: unknown): boolean {
  if (value === undefined) return false;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new ApiHttpError("internal_error");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

export function parseApiRuntimeControls(
  environment: ApiRuntimeControlEnvironment | undefined,
): ApiRuntimeControls {
  if (environment === undefined) {
    return SECURE_DEFAULT;
  }
  if (!isPlainObject(environment)) {
    throw new ApiHttpError("internal_error");
  }

  const env = environment as Record<string, unknown>;
  const apiEnabledRaw = parseSwitch(env.BTPM_API_ENABLED);
  const readsRaw = parseSwitch(env.BTPM_API_READS_ENABLED);
  const mutationsRaw = parseSwitch(env.BTPM_API_MUTATIONS_ENABLED);

  const apiEnabled = apiEnabledRaw;
  const readsEnabled = apiEnabled && readsRaw;
  const mutationsEnabled = apiEnabled && mutationsRaw;

  return Object.freeze({ apiEnabled, readsEnabled, mutationsEnabled });
}

function validateControls(controls: ApiRuntimeControls): void {
  if (!isPlainObject(controls)) {
    throw new ApiHttpError("internal_error");
  }
  const c = controls as unknown as Record<string, unknown>;
  if (
    typeof c.apiEnabled !== "boolean" ||
    typeof c.readsEnabled !== "boolean" ||
    typeof c.mutationsEnabled !== "boolean"
  ) {
    throw new ApiHttpError("internal_error");
  }
  if (!c.apiEnabled && (c.readsEnabled || c.mutationsEnabled)) {
    throw new ApiHttpError("internal_error");
  }
}

export function isApiOperationEnabled(
  controls: ApiRuntimeControls,
  operation: ApiOperationKind,
): boolean {
  validateControls(controls);
  if (operation === "read") {
    return controls.apiEnabled && controls.readsEnabled;
  }
  if (operation === "mutation") {
    return controls.apiEnabled && controls.mutationsEnabled;
  }
  throw new ApiHttpError("internal_error");
}

// API-G.1I — Explicit route allowlist: canonical declarations live in
// ../_shared/btpm-api/routes/allowlist.ts and are re-exported above.


export function matchApiRoute(
  method: string,
  pathname: string,
): ApiRouteDefinition | null {
  if (typeof method !== "string" || typeof pathname !== "string") {
    throw new ApiHttpError("internal_error");
  }
  for (const route of API_V1_ROUTE_ALLOWLIST) {
    if (route.method === method && route.path === pathname) {
      return route;
    }
  }
  // API-M.CP.2B2 — Strict dynamic Project-Risk-collection matching. This MUST
  // be attempted before the Project-detail dynamic matcher, which would
  // otherwise consume the `/v1/projects/...` prefix. The accepted CP.2B1
  // parser is the sole path-validation authority; no wildcard or generic
  // Project subresource matcher is introduced.
  // API-Q WML-1B — Strict dynamic Workspace-member matching. The accepted
  // WML-1B parser is the sole path-validation authority; no `/v1/workspaces/*`
  // wildcard or generic subresource matcher is introduced.
  if (method === WORKSPACE_MEMBERS_ROUTE.method) {
    let matchedWorkspaceMembers = false;
    try {
      parseApiV1WorkspaceMembersPath(pathname);
      matchedWorkspaceMembers = true;
    } catch (cause) {
      if (!(cause instanceof ApiHttpError && cause.code === "invalid_request")) {
        throw cause;
      }
    }
    if (matchedWorkspaceMembers) return WORKSPACE_MEMBERS_ROUTE;
  }
  // KPI-4B — Strict dynamic Project-KPI create matching. The create route
  // shares its pathname with the accepted KPI-1B collection read and is
  // separated only by HTTP method, so the accepted KPI-1B path parser remains
  // the sole path-validation authority. This MUST be attempted before the
  // generic Project dynamic matchers, which would otherwise consume the
  // `/v1/projects/...` prefix.
  if (method === KPI_CREATE_ROUTE.method) {
    let matchedProjectKpiCreate = false;
    try {
      parseApiV1ProjectKpisPath(pathname);
      matchedProjectKpiCreate = true;
    } catch (cause) {
      if (!(cause instanceof ApiHttpError && cause.code === "invalid_request")) {
        throw cause;
      }
    }
    if (matchedProjectKpiCreate) return KPI_CREATE_ROUTE;
  }
  // KPI-1B — Strict dynamic Project-KPI-collection matching. This MUST be
  // attempted before the generic Project-detail dynamic matcher, which would
  // otherwise consume the `/v1/projects/...` prefix. The accepted KPI-1B parser
  // is the sole path-validation authority; no wildcard or generic Project
  // subresource matcher is introduced.
  if (method === KPI_PROJECT_COLLECTION_ROUTE.method) {
    let matchedProjectKpis = false;
    try {
      parseApiV1ProjectKpisPath(pathname);
      matchedProjectKpis = true;
    } catch (cause) {
      if (!(cause instanceof ApiHttpError && cause.code === "invalid_request")) {
        throw cause;
      }
    }
    if (matchedProjectKpis) return KPI_PROJECT_COLLECTION_ROUTE;
  }
  // KPI-6B — Strict dynamic KPI update-history append matching. The append route
  // shares its pathname with the accepted KPI-3B update-history read and is
  // separated only by HTTP method, so `parseApiV1KpiUpdatesPath` remains the
  // sole path authority and no second KPI grammar is introduced.
  if (method === KPI_UPDATE_APPEND_ROUTE.method) {
    let matchedKpiUpdateAppend = false;
    try {
      parseApiV1KpiUpdatesPath(pathname);
      matchedKpiUpdateAppend = true;
    } catch (cause) {
      if (!(cause instanceof ApiHttpError && cause.code === "invalid_request")) {
        throw cause;
      }
    }
    if (matchedKpiUpdateAppend) return KPI_UPDATE_APPEND_ROUTE;
  }
  // KPI-3B — Strict dynamic KPI update-history matching. This MUST be attempted
  // before the KPI-detail matcher so `/v1/kpis/:kpiid/updates` can never fall
  // through into the detail branch. The accepted KPI-3B parser is the sole
  // path-validation authority; no generic `/v1/kpis/*` dispatcher exists.
  if (method === KPI_UPDATES_ROUTE.method) {
    let matchedKpiUpdates = false;
    try {
      parseApiV1KpiUpdatesPath(pathname);
      matchedKpiUpdates = true;
    } catch (cause) {
      if (!(cause instanceof ApiHttpError && cause.code === "invalid_request")) {
        throw cause;
      }
    }
    if (matchedKpiUpdates) return KPI_UPDATES_ROUTE;
  }
  // KPI-5B — Strict dynamic KPI update matching. The update route shares its
  // pathname with the accepted KPI-2B detail read and is separated only by HTTP
  // method, so `parseApiV1KpiDetailPath` remains the sole KPI-ID path authority
  // and no second KPI UUID grammar is introduced.
  if (method === KPI_UPDATE_ROUTE.method) {
    let matchedKpiUpdate = false;
    try {
      parseApiV1KpiDetailPath(pathname);
      matchedKpiUpdate = true;
    } catch (cause) {
      if (!(cause instanceof ApiHttpError && cause.code === "invalid_request")) {
        throw cause;
      }
    }
    if (matchedKpiUpdate) return KPI_UPDATE_ROUTE;
  }
  // KPI-2B — Strict dynamic KPI-detail matching. The accepted KPI-2B parser is
  // the sole path-validation authority; no generic KPI dispatcher exists.
  if (method === KPI_DETAIL_ROUTE.method) {
    let matchedKpiDetail = false;
    try {
      parseApiV1KpiDetailPath(pathname);
      matchedKpiDetail = true;
    } catch (cause) {
      if (!(cause instanceof ApiHttpError && cause.code === "invalid_request")) {
        throw cause;
      }
    }
    if (matchedKpiDetail) return KPI_DETAIL_ROUTE;
  }
  if (method === RISK_PROJECT_COLLECTION_ROUTE.method) {
    let matchedProjectRisks = false;
    try {
      parseApiV1ProjectRisksPath(pathname);
      matchedProjectRisks = true;
    } catch (cause) {
      if (!(cause instanceof ApiHttpError && cause.code === "invalid_request")) {
        throw cause;
      }
    }
    if (matchedProjectRisks) return RISK_PROJECT_COLLECTION_ROUTE;
  }
  // API-M.CP.2B2 — Strict dynamic Risk-detail matching. The accepted CP.2B1
  // parser is the sole path-validation authority. `PATCH /v1/risks/:riskid`
  // matching is unaffected because the methods differ.
  if (method === RISK_DETAIL_ROUTE.method) {
    let matchedRiskDetail = false;
    try {
      parseApiV1RiskDetailPath(pathname);
      matchedRiskDetail = true;
    } catch (cause) {
      if (!(cause instanceof ApiHttpError && cause.code === "invalid_request")) {
        throw cause;
      }
    }
    if (matchedRiskDetail) return RISK_DETAIL_ROUTE;
  }
  // API-M.CP.2C3 — Strict dynamic Project-Blocker-collection matching. This
  // MUST be attempted before the generic Project-detail dynamic matcher, which
  // would otherwise consume the `/v1/projects/...` prefix. The accepted CP.2C2
  // parser is the sole path-validation authority; no wildcard or generic
  // Project subresource matcher is introduced.
  if (method === BLOCKER_PROJECT_COLLECTION_ROUTE.method) {
    let matchedProjectBlockers = false;
    try {
      parseApiV1ProjectBlockersPath(pathname);
      matchedProjectBlockers = true;
    } catch (cause) {
      if (!(cause instanceof ApiHttpError && cause.code === "invalid_request")) {
        throw cause;
      }
    }
    if (matchedProjectBlockers) return BLOCKER_PROJECT_COLLECTION_ROUTE;
  }
  // API-M.CP.2C3 — Strict dynamic Blocker-detail matching. The accepted CP.2C2
  // parser is the sole path-validation authority. `PATCH /v1/blockers/:blockerid`
  // matching is unaffected because the methods differ.
  if (method === BLOCKER_DETAIL_ROUTE.method) {
    let matchedBlockerDetail = false;
    try {
      parseApiV1BlockerDetailPath(pathname);
      matchedBlockerDetail = true;
    } catch (cause) {
      if (!(cause instanceof ApiHttpError && cause.code === "invalid_request")) {
        throw cause;
      }
    }
    if (matchedBlockerDetail) return BLOCKER_DETAIL_ROUTE;
  }
  // API-M.CP.4C — Strict dynamic Phase-detail matching. The accepted CP.4B
  // parser is the sole path-validation authority. `PATCH /v1/phases/:phaseid`
  // matching is unaffected because the methods differ.
  if (method === PHASE_DETAIL_ROUTE.method) {
    let matchedPhaseDetail = false;
    try {
      parseApiV1PhaseDetailPath(pathname);
      matchedPhaseDetail = true;
    } catch (cause) {
      if (!(cause instanceof ApiHttpError && cause.code === "invalid_request")) {
        throw cause;
      }
    }
    if (matchedPhaseDetail) return PHASE_DETAIL_ROUTE;
  }
  // API-M.CP.4C — Strict dynamic Task-detail matching. The accepted CP.4B
  // parser is the sole path-validation authority. `PATCH /v1/tasks/:taskid`
  // matching is unaffected because the methods differ.
  if (method === TASK_DETAIL_ROUTE.method) {
    let matchedTaskDetail = false;
    try {
      parseApiV1TaskDetailPath(pathname);
      matchedTaskDetail = true;
    } catch (cause) {
      if (!(cause instanceof ApiHttpError && cause.code === "invalid_request")) {
        throw cause;
      }
    }
    if (matchedTaskDetail) return TASK_DETAIL_ROUTE;
  }
  // API-Q Portfolio-3 — Strict dynamic Portfolio matching. The nested
  // Portfolio-Projects matcher MUST be attempted BEFORE the generic Portfolio
  // detail matcher; the accepted parsers are the sole path-validation
  // authorities and no wildcard `/v1/portfolios/*` matcher is introduced.
  if (method === PORTFOLIO_PROJECTS_ROUTE.method) {
    let matchedPortfolioProjects = false;
    try {
      parseApiV1PortfolioProjectsPath(pathname);
      matchedPortfolioProjects = true;
    } catch (cause) {
      if (!(cause instanceof ApiHttpError && cause.code === "invalid_request")) {
        throw cause;
      }
    }
    if (matchedPortfolioProjects) return PORTFOLIO_PROJECTS_ROUTE;
  }
  if (method === PORTFOLIO_DETAIL_ROUTE.method) {
    let matchedPortfolioDetail = false;
    try {
      parseApiV1PortfolioDetailPath(pathname);
      matchedPortfolioDetail = true;
    } catch (cause) {
      if (!(cause instanceof ApiHttpError && cause.code === "invalid_request")) {
        throw cause;
      }
    }
    if (matchedPortfolioDetail) return PORTFOLIO_DETAIL_ROUTE;
  }
  // API-N.2B — Strict dynamic Program-detail matching. The accepted API-N.2B

  // parser is the sole path-validation authority for `/v1/programs/:programid`;
  // no wildcard, prefix, decoding, case normalization or trailing-slash
  // acceptance is added here, and no generic `/v1/:resource/:id` matcher is
  // introduced.
  if (method === PROGRAM_DETAIL_ROUTE.method) {
    let matchedProgramDetail = false;
    try {
      parseApiV1ProgramDetailPath(pathname);
      matchedProgramDetail = true;
    } catch (cause) {
      if (!(cause instanceof ApiHttpError && cause.code === "invalid_request")) {
        throw cause;
      }
    }
    if (matchedProgramDetail) return PROGRAM_DETAIL_ROUTE;
  }
  // API-M.4 — Strict dynamic Project-planning matching. This MUST be


  // attempted before the Project-detail dynamic matcher, which returns null
  // for any other `/v1/projects/...` shape and would otherwise swallow the
  // planning path. The accepted planning parser is the sole path-validation
  // authority; no wildcard, prefix, decoding, case normalization or
  // trailing-slash acceptance is added here.
  if (method === PROJECT_PLANNING_ROUTE.method) {
    let matchedPlanning = false;
    try {
      parseApiV1ProjectPlanningPath(pathname);
      matchedPlanning = true;
    } catch (cause) {
      if (!(cause instanceof ApiHttpError && cause.code === "invalid_request")) {
        throw cause;
      }
    }
    if (matchedPlanning) return PROJECT_PLANNING_ROUTE;
  }
  // API-H.4E — Strict dynamic Project-detail matching. The accepted parser is
  // the sole path-validation authority; no wildcard, prefix, decoding, case
  // normalization or trailing-slash acceptance is added here.
  if (method === PROJECT_DETAIL_ROUTE.method) {
    try {
      parseApiV1ProjectDetailPath(pathname);
    } catch (cause) {
      if (cause instanceof ApiHttpError && cause.code === "invalid_request") {
        return null;
      }
      throw cause;
    }
    return PROJECT_DETAIL_ROUTE;
  }
  // API-N.6 — Strict dynamic Project-update matching. The accepted API-N.6
  // path parser is the sole path-validation authority; no wildcard, prefix,
  // decoding, case normalization or trailing-slash acceptance is added here,
  // and no other PATCH /v1/projects/... target is reachable.
  if (method === PROJECT_UPDATE_ROUTE.method) {
    let matchedProjectUpdate = false;
    try {
      parseApiV1ProjectUpdatePath(pathname);
      matchedProjectUpdate = true;
    } catch (cause) {
      if (!(cause instanceof ApiHttpError && cause.code === "invalid_request")) {
        throw cause;
      }
    }
    if (matchedProjectUpdate) return PROJECT_UPDATE_ROUTE;
  }
  // API-N.9B — Strict dynamic Program-update matching. The accepted API-N.9B
  // path parser is the sole path-validation authority; no wildcard, prefix,
  // decoding, case normalization or trailing-slash acceptance is added here,
  // and no other PATCH /v1/programs/... target is reachable.
  if (method === PROGRAM_UPDATE_ROUTE.method) {
    let matchedProgramUpdate = false;
    try {
      parseApiV1ProgramUpdatePath(pathname);
      matchedProgramUpdate = true;
    } catch (cause) {
      if (!(cause instanceof ApiHttpError && cause.code === "invalid_request")) {
        throw cause;
      }
    }
    if (matchedProgramUpdate) return PROGRAM_UPDATE_ROUTE;
  }
  // API-Q Portfolio-5B — Strict dynamic Portfolio-update matching. The accepted
  // Portfolio-5B path parser is the sole path-validation authority; no wildcard,
  // prefix, decoding, case normalization or trailing-slash acceptance is added
  // here, and no other PATCH /v1/portfolios/... target is reachable.
  if (method === PORTFOLIO_UPDATE_ROUTE.method) {
    let matchedPortfolioUpdate = false;
    try {
      parseApiV1PortfolioUpdatePath(pathname);
      matchedPortfolioUpdate = true;
    } catch (cause) {
      if (!(cause instanceof ApiHttpError && cause.code === "invalid_request")) {
        throw cause;
      }
    }
    if (matchedPortfolioUpdate) return PORTFOLIO_UPDATE_ROUTE;
  }
  // API-Q Portfolio-6B — Strict dynamic Project↔Portfolio assignment matching.
  // The accepted Portfolio-6B path parser is the sole path-validation authority;
  // no wildcard or prefix `/v1/projects/*` PUT matcher exists, and the Task
  // assignment matcher is unaffected because the resource prefixes differ.
  if (method === PORTFOLIO_ASSIGN_PROJECT_ROUTE.method) {
    let matchedAssignProjectPortfolio = false;
    try {
      parseApiV1PortfolioAssignProjectPath(pathname);
      matchedAssignProjectPortfolio = true;
    } catch (cause) {
      if (!(cause instanceof ApiHttpError && cause.code === "invalid_request")) {
        throw cause;
      }
    }
    if (matchedAssignProjectPortfolio) return PORTFOLIO_ASSIGN_PROJECT_ROUTE;
  }
  // API-K.7 / API-K.8 — Strict dynamic Risk-update and Blocker-update
  // matching. The two accepted parsers are the sole path-validation
  // authorities: no wildcard, prefix, decoding, case normalization or
  // trailing-slash acceptance is added here, no ambiguous shared prefix is
  // used, and no other PATCH target is reachable.
  if (method === RISK_UPDATE_ROUTE.method) {
    let matchedRisk = false;
    try {
      parseApiV1RiskUpdatePath(pathname);
      matchedRisk = true;
    } catch (cause) {
      if (!(cause instanceof ApiHttpError && cause.code === "invalid_request")) {
        throw cause;
      }
    }
    if (matchedRisk) return RISK_UPDATE_ROUTE;
  }
  if (method === BLOCKER_UPDATE_ROUTE.method) {
    let matchedBlocker = false;
    try {
      parseApiV1BlockerUpdatePath(pathname);
      matchedBlocker = true;
    } catch (cause) {
      if (!(cause instanceof ApiHttpError && cause.code === "invalid_request")) {
        throw cause;
      }
    }
    if (matchedBlocker) return BLOCKER_UPDATE_ROUTE;
  }
  // API-M.8B — Strict dynamic Phase-reorder matching. The accepted parser is
  // the sole path-validation authority; no wildcard `/v1/projects/*` mutation
  // matcher exists.
  if (method === PHASE_REORDER_ROUTE.method) {
    let matchedReorder = false;
    try {
      parseApiV1PhaseReorderPath(pathname);
      matchedReorder = true;
    } catch (cause) {
      if (!(cause instanceof ApiHttpError && cause.code === "invalid_request")) {
        throw cause;
      }
    }
    if (matchedReorder) return PHASE_REORDER_ROUTE;
  }
  // API-M.8B — Strict dynamic Phase-planning matching. This MUST be attempted
  // before the Phase metadata-update matcher; the accepted update parser
  // already rejects the nested `/planning` shape, so no ambiguity exists.
  if (method === PHASE_PLANNING_ROUTE.method) {
    let matchedPlanningPhase = false;
    try {
      parseApiV1PhasePlanningPath(pathname);
      matchedPlanningPhase = true;
    } catch (cause) {
      if (!(cause instanceof ApiHttpError && cause.code === "invalid_request")) {
        throw cause;
      }
    }
    if (matchedPlanningPhase) return PHASE_PLANNING_ROUTE;
  }
  // API-M.8A — Strict dynamic Phase-update matching. The accepted parser is
  // the sole path-validation authority: no wildcard, prefix, decoding, case
  // normalization or trailing-slash acceptance is added here, and no ambiguous
  // shared prefix with the Risk or Blocker update paths exists.
  if (method === PHASE_UPDATE_ROUTE.method) {
    let matchedPhase = false;
    try {
      parseApiV1PhaseUpdatePath(pathname);
      matchedPhase = true;
    } catch (cause) {
      if (!(cause instanceof ApiHttpError && cause.code === "invalid_request")) {
        throw cause;
      }
    }
    if (matchedPhase) return PHASE_UPDATE_ROUTE;
  }
  // API-M.11B — Strict dynamic Task-reorder matching. The accepted parser is the
  // sole path-validation authority; no wildcard `/v1/phases/*` mutation matcher
  // exists.
  if (method === TASK_REORDER_ROUTE.method) {
    let matchedTaskReorder = false;
    try {
      parseApiV1TaskReorderPath(pathname);
      matchedTaskReorder = true;
    } catch (cause) {
      if (!(cause instanceof ApiHttpError && cause.code === "invalid_request")) {
        throw cause;
      }
    }
    if (matchedTaskReorder) return TASK_REORDER_ROUTE;
  }
  // API-M.11B — Strict dynamic Task-planning matching. This MUST be attempted
  // before the Task metadata-update matcher; the accepted update parser already
  // rejects the nested `/planning` shape, so no ambiguity exists.
  if (method === TASK_PLANNING_ROUTE.method) {
    let matchedTaskPlanning = false;
    try {
      parseApiV1TaskPlanningPath(pathname);
      matchedTaskPlanning = true;
    } catch (cause) {
      if (!(cause instanceof ApiHttpError && cause.code === "invalid_request")) {
        throw cause;
      }
    }
    if (matchedTaskPlanning) return TASK_PLANNING_ROUTE;
  }
  // API-M.11C — Strict dynamic Task-assignment matching. `PUT` reaches exactly
  // this one route; the accepted parser is the sole path-validation authority.
  if (method === TASK_ASSIGN_ROUTE.method) {
    let matchedTaskAssign = false;
    try {
      parseApiV1TaskAssignPath(pathname);
      matchedTaskAssign = true;
    } catch (cause) {
      if (!(cause instanceof ApiHttpError && cause.code === "invalid_request")) {
        throw cause;
      }
    }
    if (matchedTaskAssign) return TASK_ASSIGN_ROUTE;
  }
  // API-N.7 — Strict dynamic Project-transition matching. The accepted API-N.7
  // path parser is the sole path-validation authority; no wildcard or prefix
  // `/v1/projects/*` POST matcher exists.
  if (method === PROJECT_TRANSITION_ROUTE.method) {
    let matchedProjectTransition = false;
    try {
      parseApiV1ProjectTransitionPath(pathname);
      matchedProjectTransition = true;
    } catch (cause) {
      if (!(cause instanceof ApiHttpError && cause.code === "invalid_request")) {
        throw cause;
      }
    }
    if (matchedProjectTransition) return PROJECT_TRANSITION_ROUTE;
  }
  // API-M.11C — Strict dynamic Task-transition matching. No other POST target
  // shares the `/v1/tasks/<id>/transition` shape, and the accepted parser is the
  // sole path-validation authority.
  if (method === TASK_TRANSITION_ROUTE.method) {
    let matchedTaskTransition = false;
    try {
      parseApiV1TaskTransitionPath(pathname);
      matchedTaskTransition = true;
    } catch (cause) {
      if (!(cause instanceof ApiHttpError && cause.code === "invalid_request")) {
        throw cause;
      }
    }
    if (matchedTaskTransition) return TASK_TRANSITION_ROUTE;
  }
  // API-M.11A — Strict dynamic Task-update matching. The accepted parser is the
  // sole path-validation authority: no wildcard `/v1/tasks/*` matcher exists,
  // and nested future Task shapes (`/planning`, `/assignee`, `/transition`) are
  // rejected by the parser itself.
  if (method === TASK_UPDATE_ROUTE.method) {
    let matchedTask = false;
    try {
      parseApiV1TaskUpdatePath(pathname);
      matchedTask = true;
    } catch (cause) {
      if (!(cause instanceof ApiHttpError && cause.code === "invalid_request")) {
        throw cause;
      }
    }
    if (matchedTask) return TASK_UPDATE_ROUTE;
  }
  return null;
}


// API-G.1J — Fail-closed route access and payload dispatch.

export function resolveApiRouteAccess(
  method: string,
  pathname: string,
  controls: ApiRuntimeControls,
): ApiRouteDefinition {
  const matched = matchApiRoute(method, pathname);
  if (matched === null) {
    throw new ApiHttpError("route_not_found");
  }
  if (!isApiOperationEnabled(controls, matched.operation)) {
    throw new ApiHttpError("api_unavailable");
  }
  return matched;
}

export function dispatchApiRoutePayload(
  route: ApiRouteDefinition,
): ApiRoutePayload {
  if (route === VERSION_ROUTE) {
    return buildVersionPayload();
  }
  if (route === CAPABILITIES_ROUTE) {
    return buildCapabilitiesPayload();
  }
  throw new ApiHttpError("internal_error");
}

// API-G.1K — Protected route authentication and rate-limit pipeline.

export interface ApiProtectedRouteDependencies {
  authenticate(request: Request): Promise<AuthenticatedApiContext>;
  authorizeRoute(
    context: AuthenticatedApiContext,
    route: ApiRouteDefinition,
  ): Promise<void>;
  resolveRateLimitProfile(
    context: AuthenticatedApiContext,
    route: ApiRouteDefinition,
  ): Promise<ApiRateLimitProfile>;
  rateLimit: ApiRateLimitDependencies;
  /** Explicit caller-scoped delegated `/v1/me` reader. */
  readMe: DelegatedApiV1MeReader;
  /** Explicit caller-scoped delegated `/v1/organizations` reader. */
  readOrganizations: DelegatedApiV1OrganizationsReader;
  /** Explicit caller-scoped delegated `/v1/workspaces` reader. */
  readWorkspaces: DelegatedApiV1WorkspacesReader;
  /**
   * API-Q WML-1B — Explicit caller-scoped delegated Workspace-member reader.
   * Optional at the interface level only so existing accepted fixtures remain
   * valid; the Workspace-member route itself fails closed with
   * `internal_error` when it is absent or malformed.
   */
  readWorkspaceMembers?: DelegatedApiV1WorkspaceMembersReader;
  /**
   * API-N.2B — Explicit caller-scoped delegated Program collection reader.
   * Optional at the interface level only so existing accepted fixtures remain
   * valid; the Program collection route itself fails closed with
   * `internal_error` when it is absent or malformed.
   */
  readPrograms?: DelegatedApiV1ProgramsReader;
  /**
   * API-N.2B — Explicit caller-scoped delegated Program detail reader.
   * Optional at the interface level only; the Program detail route fails
   * closed with `internal_error` when it is absent or malformed.
   */
  readProgram?: DelegatedApiV1ProgramReader;
  /**
   * API-Q Portfolio-3 — Explicit caller-scoped delegated Portfolio collection
   * reader. Optional at the interface level only so existing accepted fixtures
   * remain valid; the Portfolio collection route itself fails closed with
   * `internal_error` when it is absent or malformed.
   */
  readPortfolios?: DelegatedApiV1PortfoliosReader;
  /**
   * API-Q Portfolio-3 — Explicit caller-scoped delegated Portfolio detail
   * reader. Optional at the interface level only; the Portfolio detail route
   * fails closed with `internal_error` when it is absent or malformed.
   */
  readPortfolio?: DelegatedApiV1PortfolioReader;
  /**
   * API-Q Portfolio-3 — Explicit caller-scoped delegated Portfolio Projects
   * reader. Optional at the interface level only; the nested Portfolio Projects
   * route fails closed with `internal_error` when it is absent or malformed.
   */
  readPortfolioProjects?: DelegatedApiV1PortfolioProjectsReader;



  /** Explicit caller-scoped delegated `/v1/projects` reader. */
  readProjects: DelegatedApiV1ProjectsReader;
  /** Explicit caller-scoped delegated Project-detail reader. */
  readProjectDetail: DelegatedApiV1ProjectDetailReader;
  /** API-M.4 — Explicit caller-scoped delegated Project-planning reader. */
  readProjectPlanning: DelegatedApiV1ProjectPlanningReader;
  /**
   * API-M.CP.2B2 — Explicit caller-scoped delegated Project-Risk collection
   * reader. Optional at the interface level only so existing accepted
   * fixtures remain valid; the Risk collection route itself fails closed with
   * `internal_error` when it is absent or malformed.
   */
  readProjectRisks?: DelegatedApiV1ProjectRisksReader;
  /**
   * KPI-1B — Explicit caller-scoped delegated Project KPI collection reader.
   * Optional at the interface level only; the KPI route fails closed with
   * `internal_error` when it is absent or malformed.
   */
  readProjectKpis?: DelegatedApiV1ProjectKpisReader;
  readKpi?: DelegatedApiV1KpiReader;
  /**
   * KPI-3B — Explicit caller-scoped delegated KPI update-history reader.
   * Optional at the interface level only; the route fails closed with
   * `internal_error` when it is absent or malformed.
   */
  readKpiUpdates?: DelegatedApiV1KpiUpdatesReader;
  /**
   * API-M.CP.2B2 — Explicit caller-scoped delegated Risk detail reader.
   * Optional at the interface level only; the Risk detail route fails closed
   * with `internal_error` when it is absent or malformed.
   */
  readRisk?: DelegatedApiV1RiskReader;
  /**
   * API-M.CP.2C3 — Explicit caller-scoped delegated Project-Blocker collection
   * reader. Optional at the interface level only so existing accepted fixtures
   * remain valid; the Blocker collection route itself fails closed with
   * `internal_error` when it is absent or malformed.
   */
  readProjectBlockers?: DelegatedApiV1ProjectBlockersReader;
  /**
   * API-M.CP.2C3 — Explicit caller-scoped delegated Blocker detail reader.
   * Optional at the interface level only; the Blocker detail route fails closed
   * with `internal_error` when it is absent or malformed.
   */
  readBlocker?: DelegatedApiV1BlockerReader;
  /**
   * API-M.CP.3C — Explicit caller-scoped delegated Execution Update history
   * reader. Optional at the interface level only so existing accepted fixtures
   * remain valid; the Execution Update read route itself fails closed with
   * `internal_error` when it is absent or malformed.
   */
  readExecutionUpdates?: DelegatedApiV1ExecutionUpdatesReader;
  /**
   * API-M.CP.4C — Explicit caller-scoped delegated Phase detail reader.
   * Optional at the interface level only so existing accepted fixtures remain
   * valid; the Phase detail route itself fails closed with `internal_error`
   * when it is absent or malformed.
   */
  readPhase?: DelegatedApiV1PhaseReader;
  /**
   * API-M.CP.4C — Explicit caller-scoped delegated Task detail reader.
   * Optional at the interface level only; the Task detail route fails closed
   * with `internal_error` when it is absent or malformed.
   */
  readTask?: DelegatedApiV1TaskReader;
}



/**
 * API-G.5.10A-3 — Minimal durable-activity identity for a successful
 * protected route. Derived only from the validated authenticated context.
 */
export interface ApiProtectedRouteActivityIdentity {
  readonly apiClientId: string;
  readonly actorUserId: string;
}

export interface ApiProtectedRouteResult {
  readonly route: ApiRouteDefinition;
  readonly payload: ApiRoutePayload;
  readonly activityIdentity: ApiProtectedRouteActivityIdentity;
}


const OAUTH_CLIENT_ID_PATTERN = /^[A-Za-z0-9\-_.:/]{3,128}$/;

function isNonArrayObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isValidUuidString(v: unknown): v is string {
  return typeof v === "string" && apiUuidSchema.safeParse(v).success;
}

function preserveOrWrap(cause: unknown): never {
  if (cause instanceof ApiAuthenticationError) throw cause;
  if (cause instanceof ApiHttpError) throw cause;
  throw new ApiHttpError("internal_error", cause);
}

function validateAuthenticatedContext(ctx: unknown): AuthenticatedApiContext {
  if (!isNonArrayObject(ctx)) throw new ApiHttpError("internal_error");
  const token = (ctx as { token?: unknown }).token;
  const client = (ctx as { client?: unknown }).client;
  if (!isNonArrayObject(token)) throw new ApiHttpError("internal_error");
  if (!isNonArrayObject(client)) throw new ApiHttpError("internal_error");
  const tUserId = (token as { userId?: unknown }).userId;
  const tClientId = (token as { clientId?: unknown }).clientId;
  const cUserId = (client as { userId?: unknown }).userId;
  const cApiClientId = (client as { apiClientId?: unknown }).apiClientId;
  const cPolicyVersionId = (client as { policyVersionId?: unknown })
    .policyVersionId;
  const cOauthClientId = (client as { oauthClientId?: unknown }).oauthClientId;
  if (!isValidUuidString(tUserId)) throw new ApiHttpError("internal_error");
  if (!isValidUuidString(cUserId)) throw new ApiHttpError("internal_error");
  if (!isValidUuidString(cApiClientId)) {
    throw new ApiHttpError("internal_error");
  }
  if (!isValidUuidString(cPolicyVersionId)) {
    throw new ApiHttpError("internal_error");
  }
  if (tUserId !== cUserId) throw new ApiHttpError("internal_error");
  if (
    typeof tClientId !== "string" ||
    !OAUTH_CLIENT_ID_PATTERN.test(tClientId)
  ) {
    throw new ApiHttpError("internal_error");
  }
  if (
    typeof cOauthClientId !== "string" ||
    !OAUTH_CLIENT_ID_PATTERN.test(cOauthClientId)
  ) {
    throw new ApiHttpError("internal_error");
  }
  if (tClientId !== cOauthClientId) throw new ApiHttpError("internal_error");
  return ctx as unknown as AuthenticatedApiContext;
}

function validateDependencies(
  deps: unknown,
): asserts deps is ApiProtectedRouteDependencies {
  if (!isNonArrayObject(deps)) throw new ApiHttpError("internal_error");
  const d = deps as Record<string, unknown>;
  if (typeof d.authenticate !== "function") {
    throw new ApiHttpError("internal_error");
  }
  if (typeof d.authorizeRoute !== "function") {
    throw new ApiHttpError("internal_error");
  }
  if (typeof d.resolveRateLimitProfile !== "function") {
    throw new ApiHttpError("internal_error");
  }
  if (typeof d.readMe !== "function") {
    throw new ApiHttpError("internal_error");
  }
  if (typeof d.readOrganizations !== "function") {
    throw new ApiHttpError("internal_error");
  }
  if (typeof d.readWorkspaces !== "function") {
    throw new ApiHttpError("internal_error");
  }
  if (typeof d.readProjects !== "function") {
    throw new ApiHttpError("internal_error");
  }
  if (typeof d.readProjectDetail !== "function") {
    throw new ApiHttpError("internal_error");
  }
  if (typeof d.readProjectPlanning !== "function") {
    throw new ApiHttpError("internal_error");
  }

  if (!isNonArrayObject(d.rateLimit)) {
    throw new ApiHttpError("internal_error");
  }
}

export async function executeApiProtectedRoute(
  request: Request,
  pathname: string,
  controls: ApiRuntimeControls,
  dependencies: ApiProtectedRouteDependencies,
): Promise<ApiProtectedRouteResult> {
  if (!(request instanceof Request)) {
    throw new ApiHttpError("internal_error");
  }
  if (typeof pathname !== "string") {
    throw new ApiHttpError("internal_error");
  }

  const route = resolveApiRouteAccess(request.method, pathname, controls);

  validateDependencies(dependencies);

  // For ORGANIZATIONS_ROUTE, parse and validate the URL query BEFORE
  // authentication or any dependency call.
  let organizationsQuery:
    | ReturnType<typeof parseApiV1OrganizationsQuery>
    | null = null;
  if (route === ORGANIZATIONS_ROUTE) {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch (cause) {
      throw new ApiHttpError("internal_error", cause);
    }
    if (url.pathname !== "/v1/organizations") {
      throw new ApiHttpError("internal_error");
    }
    if (url.hash !== "") {
      throw new ApiHttpError("invalid_request");
    }
    organizationsQuery = parseApiV1OrganizationsQuery(url.search);
  }

  // For WORKSPACES_ROUTE, parse and validate the URL query BEFORE
  // authentication or any dependency call.
  let workspacesQuery:
    | ReturnType<typeof parseApiV1WorkspacesQuery>
    | null = null;
  if (route === WORKSPACES_ROUTE) {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch (cause) {
      throw new ApiHttpError("internal_error", cause);
    }
    if (url.pathname !== "/v1/workspaces") {
      throw new ApiHttpError("internal_error");
    }
    if (url.hash !== "") {
      throw new ApiHttpError("invalid_request");
    }
    workspacesQuery = parseApiV1WorkspacesQuery(url.search);
  }

  // API-N.2B — For PROGRAMS_ROUTE, parse and validate the URL query BEFORE
  // authentication or any dependency call. `workspace_id` is the only external
  // Workspace key; the accepted parser is the sole validation authority.
  let programsQuery:
    | ReturnType<typeof parseApiV1ProgramsQuery>
    | null = null;
  if (route === PROGRAMS_ROUTE) {
    if (typeof dependencies.readPrograms !== "function") {
      throw new ApiHttpError("internal_error");
    }
    let url: URL;
    try {
      url = new URL(request.url);
    } catch (cause) {
      throw new ApiHttpError("internal_error", cause);
    }
    if (url.pathname !== "/v1/programs") {
      throw new ApiHttpError("internal_error");
    }
    if (url.hash !== "") {
      throw new ApiHttpError("invalid_request");
    }
    programsQuery = parseApiV1ProgramsQuery(url.search);
  }

  // API-N.2B — For PROGRAM_DETAIL_ROUTE, parse the Program path BEFORE
  // authentication or any dependency call. The detail route is queryless.
  let programDetailPath:
    | ReturnType<typeof parseApiV1ProgramDetailPath>
    | null = null;
  if (route === PROGRAM_DETAIL_ROUTE) {
    if (typeof dependencies.readProgram !== "function") {
      throw new ApiHttpError("internal_error");
    }
    let url: URL;
    try {
      url = new URL(request.url);
    } catch (cause) {
      throw new ApiHttpError("internal_error", cause);
    }
    if (url.pathname !== pathname) {
      throw new ApiHttpError("internal_error");
    }
    if (url.search !== "") {
      throw new ApiHttpError("invalid_request");
    }
    if (url.hash !== "") {
      throw new ApiHttpError("invalid_request");
    }
    programDetailPath = parseApiV1ProgramDetailPath(url.pathname);
  }

  // API-Q Portfolio-3 — For PORTFOLIOS_ROUTE, parse and validate the URL query
  // BEFORE authentication or any dependency call. `organization_id` is the only
  // external Organization key; the accepted parser is the sole validation
  // authority.
  let portfoliosQuery:
    | ReturnType<typeof parseApiV1PortfoliosQuery>
    | null = null;
  if (route === PORTFOLIOS_ROUTE) {
    if (typeof dependencies.readPortfolios !== "function") {
      throw new ApiHttpError("internal_error");
    }
    let url: URL;
    try {
      url = new URL(request.url);
    } catch (cause) {
      throw new ApiHttpError("internal_error", cause);
    }
    if (url.pathname !== "/v1/portfolios") {
      throw new ApiHttpError("internal_error");
    }
    if (url.hash !== "") {
      throw new ApiHttpError("invalid_request");
    }
    portfoliosQuery = parseApiV1PortfoliosQuery(url.search);
  }

  // API-Q Portfolio-3 — For PORTFOLIO_DETAIL_ROUTE, parse the Portfolio path
  // BEFORE authentication or any dependency call. The detail route is queryless.
  let portfolioDetailPath:
    | ReturnType<typeof parseApiV1PortfolioDetailPath>
    | null = null;
  if (route === PORTFOLIO_DETAIL_ROUTE) {
    if (typeof dependencies.readPortfolio !== "function") {
      throw new ApiHttpError("internal_error");
    }
    let url: URL;
    try {
      url = new URL(request.url);
    } catch (cause) {
      throw new ApiHttpError("internal_error", cause);
    }
    if (url.pathname !== pathname) {
      throw new ApiHttpError("internal_error");
    }
    if (url.search !== "") {
      throw new ApiHttpError("invalid_request");
    }
    if (url.hash !== "") {
      throw new ApiHttpError("invalid_request");
    }
    portfolioDetailPath = parseApiV1PortfolioDetailPath(url.pathname);
  }

  // API-Q Portfolio-3 — For PORTFOLIO_PROJECTS_ROUTE, parse the nested path and
  // its query BEFORE authentication or any dependency call.
  let portfolioProjectsPath:
    | ReturnType<typeof parseApiV1PortfolioProjectsPath>
    | null = null;
  let portfolioProjectsQuery:
    | ReturnType<typeof parseApiV1PortfolioProjectsQuery>
    | null = null;
  if (route === PORTFOLIO_PROJECTS_ROUTE) {
    if (typeof dependencies.readPortfolioProjects !== "function") {
      throw new ApiHttpError("internal_error");
    }
    let url: URL;
    try {
      url = new URL(request.url);
    } catch (cause) {
      throw new ApiHttpError("internal_error", cause);
    }
    if (url.pathname !== pathname) {
      throw new ApiHttpError("internal_error");
    }
    if (url.hash !== "") {
      throw new ApiHttpError("invalid_request");
    }
    portfolioProjectsPath = parseApiV1PortfolioProjectsPath(url.pathname);
    portfolioProjectsQuery = parseApiV1PortfolioProjectsQuery(url.search);
  }





  // For PROJECTS_ROUTE, parse and validate the URL query BEFORE
  // authentication or any dependency call.
  let projectsQuery:
    | ReturnType<typeof parseApiV1ProjectsQuery>
    | null = null;
  if (route === PROJECTS_ROUTE) {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch (cause) {
      throw new ApiHttpError("internal_error", cause);
    }
    if (url.pathname !== "/v1/projects") {
      throw new ApiHttpError("internal_error");
    }
    if (url.hash !== "") {
      throw new ApiHttpError("invalid_request");
    }
    projectsQuery = parseApiV1ProjectsQuery(url.search);
  }

  // API-H.4E — For PROJECT_DETAIL_ROUTE, parse the Project path BEFORE
  // authentication or any dependency call. The accepted parser remains the
  // sole path-validation authority.
  let projectDetailPath:
    | ReturnType<typeof parseApiV1ProjectDetailPath>
    | null = null;
  if (route === PROJECT_DETAIL_ROUTE) {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch (cause) {
      throw new ApiHttpError("internal_error", cause);
    }
    if (url.pathname !== pathname) {
      throw new ApiHttpError("internal_error");
    }
    if (url.search !== "") {
      throw new ApiHttpError("invalid_request");
    }
    if (url.hash !== "") {
      throw new ApiHttpError("invalid_request");
    }
    projectDetailPath = parseApiV1ProjectDetailPath(url.pathname);
  }

  // API-M.4 — For PROJECT_PLANNING_ROUTE, parse the Project path BEFORE
  // authentication or any dependency call. The accepted planning parser
  // remains the sole path-validation authority.
  let projectPlanningPath:
    | ReturnType<typeof parseApiV1ProjectPlanningPath>
    | null = null;
  if (route === PROJECT_PLANNING_ROUTE) {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch (cause) {
      throw new ApiHttpError("internal_error", cause);
    }
    if (url.pathname !== pathname) {
      throw new ApiHttpError("internal_error");
    }
    if (url.search !== "") {
      throw new ApiHttpError("invalid_request");
    }
    if (url.hash !== "") {
      throw new ApiHttpError("invalid_request");
    }
    projectPlanningPath = parseApiV1ProjectPlanningPath(url.pathname);
  }

  // API-Q WML-1B — For WORKSPACE_MEMBERS_ROUTE, parse the real request URL,
  // the Workspace path and the query BEFORE authentication or any dependency
  // call. The accepted WML-1B parsers remain the sole validation authorities.
  let workspaceMembersPath:
    | ReturnType<typeof parseApiV1WorkspaceMembersPath>
    | null = null;
  let workspaceMembersQuery:
    | ReturnType<typeof parseApiV1WorkspaceMembersQuery>
    | null = null;
  if (route === WORKSPACE_MEMBERS_ROUTE) {
    if (typeof dependencies.readWorkspaceMembers !== "function") {
      throw new ApiHttpError("internal_error");
    }
    let url: URL;
    try {
      url = new URL(request.url);
    } catch (cause) {
      throw new ApiHttpError("internal_error", cause);
    }
    if (url.pathname !== pathname) {
      throw new ApiHttpError("internal_error");
    }
    if (url.hash !== "") {
      throw new ApiHttpError("invalid_request");
    }
    workspaceMembersPath = parseApiV1WorkspaceMembersPath(url.pathname);
    workspaceMembersQuery = parseApiV1WorkspaceMembersQuery(url.search);
  }

  // API-M.CP.2B2 — For RISK_PROJECT_COLLECTION_ROUTE, parse the real request
  // URL, the Project path and the query BEFORE authentication or any
  // dependency call. The accepted CP.2B1 parsers remain the sole validation
  // authorities.
  let projectRisksPath:
    | ReturnType<typeof parseApiV1ProjectRisksPath>
    | null = null;
  let projectRisksQuery:
    | ReturnType<typeof parseApiV1ProjectRisksQuery>
    | null = null;
  if (route === RISK_PROJECT_COLLECTION_ROUTE) {
    if (typeof dependencies.readProjectRisks !== "function") {
      throw new ApiHttpError("internal_error");
    }
    let url: URL;
    try {
      url = new URL(request.url);
    } catch (cause) {
      throw new ApiHttpError("internal_error", cause);
    }
    if (url.pathname !== pathname) {
      throw new ApiHttpError("internal_error");
    }
    if (url.hash !== "") {
      throw new ApiHttpError("invalid_request");
    }
    projectRisksPath = parseApiV1ProjectRisksPath(url.pathname);
    projectRisksQuery = parseApiV1ProjectRisksQuery(url.search);
  }

  // KPI-1B — For KPI_PROJECT_COLLECTION_ROUTE, parse the real request URL, the
  // Project path and the query BEFORE authentication or any dependency call.
  // The accepted KPI-1B parsers remain the sole validation authorities.
  let projectKpisPath:
    | ReturnType<typeof parseApiV1ProjectKpisPath>
    | null = null;
  let projectKpisQuery:
    | ReturnType<typeof parseApiV1ProjectKpisQuery>
    | null = null;
  if (route === KPI_PROJECT_COLLECTION_ROUTE) {
    if (typeof dependencies.readProjectKpis !== "function") {
      throw new ApiHttpError("internal_error");
    }
    let url: URL;
    try {
      url = new URL(request.url);
    } catch (cause) {
      throw new ApiHttpError("internal_error", cause);
    }
    if (url.pathname !== pathname) {
      throw new ApiHttpError("internal_error");
    }
    if (url.hash !== "") {
      throw new ApiHttpError("invalid_request");
    }
    projectKpisPath = parseApiV1ProjectKpisPath(url.pathname);
    projectKpisQuery = parseApiV1ProjectKpisQuery(url.search);
  }

  // KPI-2B — For KPI_DETAIL_ROUTE, parse the real request URL and the KPI path
  // BEFORE authentication. The detail route is queryless.
  let kpiDetailPath:
    | ReturnType<typeof parseApiV1KpiDetailPath>
    | null = null;
  if (route === KPI_DETAIL_ROUTE) {
    if (typeof dependencies.readKpi !== "function") {
      throw new ApiHttpError("internal_error");
    }
    let url: URL;
    try {
      url = new URL(request.url);
    } catch (cause) {
      throw new ApiHttpError("internal_error", cause);
    }
    if (url.pathname !== pathname) {
      throw new ApiHttpError("internal_error");
    }
    if (url.search !== "") {
      throw new ApiHttpError("invalid_request");
    }
    if (url.hash !== "") {
      throw new ApiHttpError("invalid_request");
    }
    kpiDetailPath = parseApiV1KpiDetailPath(url.pathname);
  }

  // KPI-3B — For KPI_UPDATES_ROUTE, parse the real request URL, the KPI path
  // and the query BEFORE authentication or any dependency call. The accepted
  // KPI-3B parsers remain the sole validation authorities.
  let kpiUpdatesPath:
    | ReturnType<typeof parseApiV1KpiUpdatesPath>
    | null = null;
  let kpiUpdatesQuery:
    | ReturnType<typeof parseApiV1KpiUpdatesQuery>
    | null = null;
  if (route === KPI_UPDATES_ROUTE) {
    if (typeof dependencies.readKpiUpdates !== "function") {
      throw new ApiHttpError("internal_error");
    }
    let url: URL;
    try {
      url = new URL(request.url);
    } catch (cause) {
      throw new ApiHttpError("internal_error", cause);
    }
    if (url.pathname !== pathname) {
      throw new ApiHttpError("internal_error");
    }
    if (url.hash !== "") {
      throw new ApiHttpError("invalid_request");
    }
    kpiUpdatesPath = parseApiV1KpiUpdatesPath(url.pathname);
    kpiUpdatesQuery = parseApiV1KpiUpdatesQuery(url.search);
  }

  // API-M.CP.2B2 — For RISK_DETAIL_ROUTE, parse the real request URL and the
  // Risk path BEFORE authentication. The detail route is queryless.
  let riskDetailPath:
    | ReturnType<typeof parseApiV1RiskDetailPath>
    | null = null;
  if (route === RISK_DETAIL_ROUTE) {
    if (typeof dependencies.readRisk !== "function") {
      throw new ApiHttpError("internal_error");
    }
    let url: URL;
    try {
      url = new URL(request.url);
    } catch (cause) {
      throw new ApiHttpError("internal_error", cause);
    }
    if (url.pathname !== pathname) {
      throw new ApiHttpError("internal_error");
    }
    if (url.search !== "") {
      throw new ApiHttpError("invalid_request");
    }
    if (url.hash !== "") {
      throw new ApiHttpError("invalid_request");
    }
    riskDetailPath = parseApiV1RiskDetailPath(url.pathname);
  }

  // API-M.CP.2C3 — For BLOCKER_PROJECT_COLLECTION_ROUTE, parse the real request
  // URL, the Project path and the query BEFORE authentication or any dependency
  // call. The accepted CP.2C2 parsers remain the sole validation authorities.
  let projectBlockersPath:
    | ReturnType<typeof parseApiV1ProjectBlockersPath>
    | null = null;
  let projectBlockersQuery:
    | ReturnType<typeof parseApiV1ProjectBlockersQuery>
    | null = null;
  if (route === BLOCKER_PROJECT_COLLECTION_ROUTE) {
    if (typeof dependencies.readProjectBlockers !== "function") {
      throw new ApiHttpError("internal_error");
    }
    let url: URL;
    try {
      url = new URL(request.url);
    } catch (cause) {
      throw new ApiHttpError("internal_error", cause);
    }
    if (url.pathname !== pathname) {
      throw new ApiHttpError("internal_error");
    }
    if (url.hash !== "") {
      throw new ApiHttpError("invalid_request");
    }
    projectBlockersPath = parseApiV1ProjectBlockersPath(url.pathname);
    projectBlockersQuery = parseApiV1ProjectBlockersQuery(url.search);
  }

  // API-M.CP.2C3 — For BLOCKER_DETAIL_ROUTE, parse the real request URL and the
  // Blocker path BEFORE authentication. The detail route is queryless.
  let blockerDetailPath:
    | ReturnType<typeof parseApiV1BlockerDetailPath>
    | null = null;
  if (route === BLOCKER_DETAIL_ROUTE) {
    if (typeof dependencies.readBlocker !== "function") {
      throw new ApiHttpError("internal_error");
    }
    let url: URL;
    try {
      url = new URL(request.url);
    } catch (cause) {
      throw new ApiHttpError("internal_error", cause);
    }
    if (url.pathname !== pathname) {
      throw new ApiHttpError("internal_error");
    }
    if (url.search !== "") {
      throw new ApiHttpError("invalid_request");
    }
    if (url.hash !== "") {
      throw new ApiHttpError("invalid_request");
    }
    blockerDetailPath = parseApiV1BlockerDetailPath(url.pathname);
  }

  // API-M.CP.3C — For EXECUTION_UPDATES_READ_ROUTE, parse the real request URL
  // and the query BEFORE authentication or any dependency call. The accepted
  // CP.3B parser remains the sole query-validation authority.
  let executionUpdatesQuery:
    | ReturnType<typeof parseApiV1ExecutionUpdatesReadQuery>
    | null = null;
  if (route === EXECUTION_UPDATES_READ_ROUTE) {
    if (typeof dependencies.readExecutionUpdates !== "function") {
      throw new ApiHttpError("internal_error");
    }
    let url: URL;
    try {
      url = new URL(request.url);
    } catch (cause) {
      throw new ApiHttpError("internal_error", cause);
    }
    if (url.pathname !== pathname) {
      throw new ApiHttpError("internal_error");
    }
    if (url.pathname !== EXECUTION_UPDATES_READ_ROUTE.path) {
      throw new ApiHttpError("internal_error");
    }
    if (url.hash !== "") {
      throw new ApiHttpError("invalid_request");
    }
    executionUpdatesQuery = parseApiV1ExecutionUpdatesReadQuery(url.search);
  }

  // API-M.CP.4C — For PHASE_DETAIL_ROUTE, parse the real request URL and the
  // Phase path BEFORE authentication or any dependency call. The detail route
  // is queryless; the accepted CP.4B parser remains the sole
  // identifier-validation authority.
  let phaseDetailPath:
    | ReturnType<typeof parseApiV1PhaseDetailPath>
    | null = null;
  if (route === PHASE_DETAIL_ROUTE) {
    if (typeof dependencies.readPhase !== "function") {
      throw new ApiHttpError("internal_error");
    }
    let url: URL;
    try {
      url = new URL(request.url);
    } catch (cause) {
      throw new ApiHttpError("internal_error", cause);
    }
    if (url.pathname !== pathname) {
      throw new ApiHttpError("internal_error");
    }
    if (url.search !== "") {
      throw new ApiHttpError("invalid_request");
    }
    if (url.hash !== "") {
      throw new ApiHttpError("invalid_request");
    }
    phaseDetailPath = parseApiV1PhaseDetailPath(url.pathname);
  }

  // API-M.CP.4C — For TASK_DETAIL_ROUTE, parse the real request URL and the
  // Task path BEFORE authentication. The detail route is queryless.
  let taskDetailPath:
    | ReturnType<typeof parseApiV1TaskDetailPath>
    | null = null;
  if (route === TASK_DETAIL_ROUTE) {
    if (typeof dependencies.readTask !== "function") {
      throw new ApiHttpError("internal_error");
    }
    let url: URL;
    try {
      url = new URL(request.url);
    } catch (cause) {
      throw new ApiHttpError("internal_error", cause);
    }
    if (url.pathname !== pathname) {
      throw new ApiHttpError("internal_error");
    }
    if (url.search !== "") {
      throw new ApiHttpError("invalid_request");
    }
    if (url.hash !== "") {
      throw new ApiHttpError("invalid_request");
    }
    taskDetailPath = parseApiV1TaskDetailPath(url.pathname);
  }





  // ME-2 — For ME_ROUTE, parse and validate the optional context query
  // BEFORE authentication or any dependency call.
  let meQuery: ReturnType<typeof parseApiV1MeQuery> | null = null;
  if (route === ME_ROUTE) {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch (cause) {
      throw new ApiHttpError("internal_error", cause);
    }
    if (url.pathname !== "/v1/me") {
      throw new ApiHttpError("internal_error");
    }
    if (url.hash !== "") {
      throw new ApiHttpError("invalid_request");
    }
    meQuery = parseApiV1MeQuery(url.search);
  }

  let authenticated: AuthenticatedApiContext;
  try {
    authenticated = await dependencies.authenticate(request);
  } catch (cause) {
    preserveOrWrap(cause);
  }
  authenticated = validateAuthenticatedContext(authenticated!);

  // API-G.5.10A-3 — Derive the durable-activity identity only from the
  // validated authenticated context. No OAuth client ID, policy-version ID,
  // grant ID, acknowledgement ID, scope ID or token data is included.
  const activityIdentity: ApiProtectedRouteActivityIdentity = Object.freeze({
    apiClientId: authenticated.client.apiClientId,
    actorUserId: authenticated.token.userId,
  });

  try {
    await dependencies.authorizeRoute(authenticated, route);
  } catch (cause) {
    preserveOrWrap(cause);
  }

  let profile: ApiRateLimitProfile;
  try {
    profile = await dependencies.resolveRateLimitProfile(authenticated, route);
  } catch (cause) {
    preserveOrWrap(cause);
  }

  await enforceApiRateLimit(
    {
      apiClientId: authenticated.client.apiClientId,
      userId: authenticated.token.userId,
      routeId: route.id,
    },
    profile!,
    dependencies.rateLimit,
  );

  if (route === ME_ROUTE) {
    let mePayload: ApiV1MePayload;
    try {
      mePayload = await dependencies.readMe(request, authenticated, meQuery!);
    } catch (cause) {
      preserveOrWrap(cause);
    }
    return Object.freeze({ route, payload: mePayload!, activityIdentity });
  }

  if (route === ORGANIZATIONS_ROUTE) {
    let orgsPayload: ApiV1OrganizationsPayload;
    try {
      orgsPayload = await dependencies.readOrganizations(
        request,
        authenticated,
        organizationsQuery!,
      );
    } catch (cause) {
      preserveOrWrap(cause);
    }
    return Object.freeze({ route, payload: orgsPayload!, activityIdentity });
  }

  if (route === WORKSPACES_ROUTE) {
    let workspacesPayload: ApiV1WorkspacesPayload;
    try {
      workspacesPayload = await dependencies.readWorkspaces(
        request,
        authenticated,
        workspacesQuery!,
      );
    } catch (cause) {
      preserveOrWrap(cause);
    }

    return Object.freeze({
      route,
      payload: workspacesPayload!,
      activityIdentity,
    });
  }

  if (route === WORKSPACE_MEMBERS_ROUTE) {
    const readWorkspaceMembers = dependencies.readWorkspaceMembers;
    if (typeof readWorkspaceMembers !== "function") {
      throw new ApiHttpError("internal_error");
    }
    if (workspaceMembersPath === null || workspaceMembersQuery === null) {
      throw new ApiHttpError("internal_error");
    }
    let workspaceMembersPayload: ApiV1WorkspaceMembersPayload;
    try {
      workspaceMembersPayload = await readWorkspaceMembers(
        request,
        authenticated,
        workspaceMembersPath.workspaceId,
        workspaceMembersQuery.limit,
        workspaceMembersQuery.offset,
        workspaceMembersQuery.search,
      );
    } catch (cause) {
      preserveOrWrap(cause);
    }

    return Object.freeze({
      route,
      payload: workspaceMembersPayload!,
      activityIdentity,
    });
  }

  if (route === PROJECTS_ROUTE) {
    let projectsPayload: ApiV1ProjectsPayload;
    try {
      projectsPayload = await dependencies.readProjects(
        request,
        authenticated,
        projectsQuery!,
      );
    } catch (cause) {
      preserveOrWrap(cause);
    }

    return Object.freeze({
      route,
      payload: projectsPayload!,
      activityIdentity,
    });
  }
  // API-N.2B — accepted Program reads. The delegated readers are the sole data
  // path; the API-N.2A SQL wrappers remain the authorization and
  // protected-data boundary.
  if (route === PROGRAMS_ROUTE) {
    const readPrograms = dependencies.readPrograms;
    if (typeof readPrograms !== "function" || programsQuery === null) {
      throw new ApiHttpError("internal_error");
    }
    let programsPayload: ApiV1ProgramsPayload;
    try {
      programsPayload = await readPrograms(
        request,
        authenticated,
        programsQuery,
      );
    } catch (cause) {
      preserveOrWrap(cause);
    }

    return Object.freeze({
      route,
      payload: programsPayload!,
      activityIdentity,
    });
  }

  if (route === PROGRAM_DETAIL_ROUTE) {
    const readProgram = dependencies.readProgram;
    if (typeof readProgram !== "function" || programDetailPath === null) {
      throw new ApiHttpError("internal_error");
    }
    let programDetailPayload: ApiV1ProgramDetailPayload;
    try {
      programDetailPayload = await readProgram(
        request,
        authenticated,
        programDetailPath.programId,
      );
    } catch (cause) {
      preserveOrWrap(cause);
    }

    return Object.freeze({
      route,
      payload: programDetailPayload!,
      activityIdentity,
    });
  }

  // API-Q Portfolio-3 — accepted Portfolio reads. The delegated readers are the
  // sole data path; the Portfolio-1/Portfolio-2 SQL wrappers remain the
  // capability, containment and protected-data authority.
  if (route === PORTFOLIOS_ROUTE) {
    const readPortfolios = dependencies.readPortfolios;
    if (typeof readPortfolios !== "function" || portfoliosQuery === null) {
      throw new ApiHttpError("internal_error");
    }
    let portfoliosPayload: ApiV1PortfoliosPayload;
    try {
      portfoliosPayload = await readPortfolios(
        request,
        authenticated,
        portfoliosQuery,
      );
    } catch (cause) {
      preserveOrWrap(cause);
    }

    return Object.freeze({
      route,
      payload: portfoliosPayload!,
      activityIdentity,
    });
  }

  if (route === PORTFOLIO_DETAIL_ROUTE) {
    const readPortfolio = dependencies.readPortfolio;
    if (typeof readPortfolio !== "function" || portfolioDetailPath === null) {
      throw new ApiHttpError("internal_error");
    }
    let portfolioDetailPayload: ApiV1PortfolioDetailPayload;
    try {
      portfolioDetailPayload = await readPortfolio(
        request,
        authenticated,
        portfolioDetailPath.portfolioId,
      );
    } catch (cause) {
      preserveOrWrap(cause);
    }

    return Object.freeze({
      route,
      payload: portfolioDetailPayload!,
      activityIdentity,
    });
  }

  if (route === PORTFOLIO_PROJECTS_ROUTE) {
    const readPortfolioProjects = dependencies.readPortfolioProjects;
    if (
      typeof readPortfolioProjects !== "function" ||
      portfolioProjectsPath === null ||
      portfolioProjectsQuery === null
    ) {
      throw new ApiHttpError("internal_error");
    }
    let portfolioProjectsPayload: ApiV1PortfolioProjectsPayload;
    try {
      portfolioProjectsPayload = await readPortfolioProjects(
        request,
        authenticated,
        portfolioProjectsPath.portfolioId,
        portfolioProjectsQuery,
      );
    } catch (cause) {
      preserveOrWrap(cause);
    }

    return Object.freeze({
      route,
      payload: portfolioProjectsPayload!,
      activityIdentity,
    });
  }



  if (route === PROJECT_DETAIL_ROUTE) {

    let projectDetailPayload: ApiV1ProjectDetailPayload;
    try {
      projectDetailPayload = await dependencies.readProjectDetail(
        request,
        authenticated,
        projectDetailPath!.projectId,
      );
    } catch (cause) {
      preserveOrWrap(cause);
    }

    return Object.freeze({
      route,
      payload: projectDetailPayload!,
      activityIdentity,
    });
  }

  if (route === PROJECT_PLANNING_ROUTE) {
    let projectPlanningPayload: ApiV1ProjectPlanningPayload;
    try {
      projectPlanningPayload = await dependencies.readProjectPlanning(
        request,
        authenticated,
        projectPlanningPath!.projectId,
      );
    } catch (cause) {
      preserveOrWrap(cause);
    }

    return Object.freeze({
      route,
      payload: projectPlanningPayload!,
      activityIdentity,
    });
  }

  // API-M.CP.2B2 — accepted CP.2B1 Risk reads. The delegated readers are the
  // sole data path; the CP.2A/C1 SQL wrappers remain the authorization and
  // protected-data boundary. The internal SQL keyset pair is never exposed.
  if (route === RISK_PROJECT_COLLECTION_ROUTE) {
    const readProjectRisks = dependencies.readProjectRisks;
    if (typeof readProjectRisks !== "function") {
      throw new ApiHttpError("internal_error");
    }
    if (projectRisksPath === null || projectRisksQuery === null) {
      throw new ApiHttpError("internal_error");
    }
    let projectRisksPayload: ApiV1ProjectRisksPayload;
    try {
      projectRisksPayload = await readProjectRisks(
        request,
        authenticated,
        projectRisksPath.projectId,
        projectRisksQuery.limit,
        projectRisksQuery.cursor,
      );
    } catch (cause) {
      preserveOrWrap(cause);
    }

    return Object.freeze({
      route,
      payload: projectRisksPayload!,
      activityIdentity,
    });
  }

  // KPI-1B — accepted Project KPI collection read. The delegated caller-scoped
  // reader is the sole data path; the accepted KPI-1A/KPI-1A-C1 SQL wrapper
  // remains the authorization and protected-data boundary.
  if (route === KPI_PROJECT_COLLECTION_ROUTE) {
    const readProjectKpis = dependencies.readProjectKpis;
    if (typeof readProjectKpis !== "function") {
      throw new ApiHttpError("internal_error");
    }
    if (projectKpisPath === null || projectKpisQuery === null) {
      throw new ApiHttpError("internal_error");
    }
    let projectKpisPayload: ApiV1ProjectKpisPayload;
    try {
      projectKpisPayload = await readProjectKpis(
        request,
        authenticated,
        projectKpisPath.projectId,
        projectKpisQuery,
      );
    } catch (cause) {
      preserveOrWrap(cause);
    }

    return Object.freeze({
      route,
      payload: projectKpisPayload!,
      activityIdentity,
    });
  }

  // KPI-2B — accepted single-KPI detail read. The delegated caller-scoped
  // reader is the sole data path; the accepted KPI-2A SQL wrapper remains the
  // authorization, containment and protected-data boundary.
  if (route === KPI_DETAIL_ROUTE) {
    const readKpi = dependencies.readKpi;
    if (typeof readKpi !== "function") {
      throw new ApiHttpError("internal_error");
    }
    if (kpiDetailPath === null) {
      throw new ApiHttpError("internal_error");
    }
    let kpiPayload: ApiV1ProjectKpiItem;
    try {
      kpiPayload = await readKpi(
        request,
        authenticated,
        kpiDetailPath.kpiId,
      );
    } catch (cause) {
      preserveOrWrap(cause);
    }

    return Object.freeze({
      route,
      payload: kpiPayload!,
      activityIdentity,
    });
  }

  // KPI-3B — accepted KPI update-history read. The delegated caller-scoped
  // reader is the sole data path; the accepted KPI-3A SQL wrapper remains the
  // authorization, containment and protected-data boundary.
  if (route === KPI_UPDATES_ROUTE) {
    const readKpiUpdates = dependencies.readKpiUpdates;
    if (typeof readKpiUpdates !== "function") {
      throw new ApiHttpError("internal_error");
    }
    if (kpiUpdatesPath === null || kpiUpdatesQuery === null) {
      throw new ApiHttpError("internal_error");
    }
    let kpiUpdatesPayload: ApiV1KpiUpdatesPayload;
    try {
      kpiUpdatesPayload = await readKpiUpdates(
        request,
        authenticated,
        kpiUpdatesPath.kpiId,
        kpiUpdatesQuery,
      );
    } catch (cause) {
      preserveOrWrap(cause);
    }

    return Object.freeze({
      route,
      payload: kpiUpdatesPayload!,
      activityIdentity,
    });
  }

  if (route === RISK_DETAIL_ROUTE) {
    const readRisk = dependencies.readRisk;
    if (typeof readRisk !== "function") {
      throw new ApiHttpError("internal_error");
    }
    if (riskDetailPath === null) {
      throw new ApiHttpError("internal_error");
    }
    let riskPayload: ApiV1RiskReadItem;
    try {
      riskPayload = await readRisk(
        request,
        authenticated,
        riskDetailPath.riskId,
      );
    } catch (cause) {
      preserveOrWrap(cause);
    }

    return Object.freeze({
      route,
      payload: riskPayload!,
      activityIdentity,
    });
  }

  // API-M.CP.2C3 — accepted CP.2C2 Blocker reads. The delegated readers are the
  // sole data path; the CP.2C1 SQL wrappers remain the authorization and
  // protected-data boundary. The internal SQL keyset pair is never exposed.
  if (route === BLOCKER_PROJECT_COLLECTION_ROUTE) {
    const readProjectBlockers = dependencies.readProjectBlockers;
    if (typeof readProjectBlockers !== "function") {
      throw new ApiHttpError("internal_error");
    }
    if (projectBlockersPath === null || projectBlockersQuery === null) {
      throw new ApiHttpError("internal_error");
    }
    let projectBlockersPayload: ApiV1ProjectBlockersPayload;
    try {
      projectBlockersPayload = await readProjectBlockers(
        request,
        authenticated,
        projectBlockersPath.projectId,
        projectBlockersQuery.limit,
        projectBlockersQuery.cursor,
      );
    } catch (cause) {
      preserveOrWrap(cause);
    }

    return Object.freeze({
      route,
      payload: projectBlockersPayload!,
      activityIdentity,
    });
  }

  if (route === BLOCKER_DETAIL_ROUTE) {
    const readBlocker = dependencies.readBlocker;
    if (typeof readBlocker !== "function") {
      throw new ApiHttpError("internal_error");
    }
    if (blockerDetailPath === null) {
      throw new ApiHttpError("internal_error");
    }
    let blockerPayload: ApiV1BlockerReadItem;
    try {
      blockerPayload = await readBlocker(
        request,
        authenticated,
        blockerDetailPath.blockerId,
      );
    } catch (cause) {
      preserveOrWrap(cause);
    }

    return Object.freeze({
      route,
      payload: blockerPayload!,
      activityIdentity,
    });
  }

  // API-M.CP.3C — accepted CP.3B Execution Update history read. The delegated
  // caller-bound reader is the sole data path; the CP.3A SQL wrapper remains
  // the authorization and protected-data boundary. The internal SQL keyset
  // pair is never exposed and `authorId` is never enriched.
  if (route === EXECUTION_UPDATES_READ_ROUTE) {
    const readExecutionUpdates = dependencies.readExecutionUpdates;
    if (typeof readExecutionUpdates !== "function") {
      throw new ApiHttpError("internal_error");
    }
    if (executionUpdatesQuery === null) {
      throw new ApiHttpError("internal_error");
    }
    let executionUpdatesPayload: ApiV1ExecutionUpdatesPayload;
    try {
      executionUpdatesPayload = await readExecutionUpdates(
        request,
        authenticated,
        executionUpdatesQuery.targetType,
        executionUpdatesQuery.targetId,
        executionUpdatesQuery.limit,
        executionUpdatesQuery.cursor,
      );
    } catch (cause) {
      preserveOrWrap(cause);
    }

    return Object.freeze({
      route,
      payload: executionUpdatesPayload!,
      activityIdentity,
    });
  }

  // API-M.CP.4C — accepted CP.4B Phase/Task detail reads. The delegated
  // caller-bound readers are the sole data path; the CP.4A SQL wrappers remain
  // the authorization and protected-data boundary. The accepted payloads are
  // returned unchanged; no field is added, transformed or enriched, and no
  // `not_found` result exists.
  if (route === PHASE_DETAIL_ROUTE) {
    const readPhase = dependencies.readPhase;
    if (typeof readPhase !== "function") {
      throw new ApiHttpError("internal_error");
    }
    if (phaseDetailPath === null) {
      throw new ApiHttpError("internal_error");
    }
    let phasePayload: ApiV1PhaseReadItem;
    try {
      phasePayload = await readPhase(
        request,
        authenticated,
        phaseDetailPath.phaseId,
      );
    } catch (cause) {
      preserveOrWrap(cause);
    }

    return Object.freeze({
      route,
      payload: phasePayload!,
      activityIdentity,
    });
  }

  if (route === TASK_DETAIL_ROUTE) {
    const readTask = dependencies.readTask;
    if (typeof readTask !== "function") {
      throw new ApiHttpError("internal_error");
    }
    if (taskDetailPath === null) {
      throw new ApiHttpError("internal_error");
    }
    let taskPayload: ApiV1TaskReadItem;
    try {
      taskPayload = await readTask(
        request,
        authenticated,
        taskDetailPath.taskId,
      );
    } catch (cause) {
      preserveOrWrap(cause);
    }

    return Object.freeze({
      route,
      payload: taskPayload!,
      activityIdentity,
    });
  }





  const payload = dispatchApiRoutePayload(route);
  return Object.freeze({ route, payload, activityIdentity });

}

// -----------------------------------------------------------------------------
// API-I.9A — Dedicated protected mutation execution pipeline.
//
// This pipeline is NOT reachable from the live HTTP handler: `handler.ts`,
// `index.ts` and `cors.ts` are unchanged and still reject POST. It performs no
// service-role access, no direct database access and no business-table
// pre-read; database mutation authority remains with the API-I.5 wrapper.
// -----------------------------------------------------------------------------

/** Narrow mutation dependency contract. Read execution is unaffected. */
export interface ApiAppendExecutionUpdateRouteDependencies {
  authenticate(request: Request): Promise<AuthenticatedApiContext>;
  authorizeRoute(
    context: AuthenticatedApiContext,
    route: ApiRouteDefinition,
  ): Promise<void>;
  resolveRateLimitProfile(
    context: AuthenticatedApiContext,
    route: ApiRouteDefinition,
  ): Promise<ApiRateLimitProfile>;
  rateLimit: ApiRateLimitDependencies;
  /** Accepted API-I.7 caller-scoped delegated mutation executor. */
  appendExecutionUpdate: DelegatedApiV1AppendExecutionUpdateExecutor;
}

export interface ApiAppendExecutionUpdateRouteResult {
  readonly route: ApiRouteDefinition;
  readonly payload: ApiV1AppendExecutionUpdateSuccessResult;
  readonly status: 200 | 201;
  readonly activityIdentity: ApiProtectedRouteActivityIdentity;
}

function validateMutationDependencies(
  deps: unknown,
): asserts deps is ApiAppendExecutionUpdateRouteDependencies {
  if (!isNonArrayObject(deps)) throw new ApiHttpError("internal_error");
  const d = deps as Record<string, unknown>;
  if (typeof d.authenticate !== "function") {
    throw new ApiHttpError("internal_error");
  }
  if (typeof d.authorizeRoute !== "function") {
    throw new ApiHttpError("internal_error");
  }
  if (typeof d.resolveRateLimitProfile !== "function") {
    throw new ApiHttpError("internal_error");
  }
  if (typeof d.appendExecutionUpdate !== "function") {
    throw new ApiHttpError("internal_error");
  }
  if (!isNonArrayObject(d.rateLimit)) {
    throw new ApiHttpError("internal_error");
  }
}

export async function executeApiAppendExecutionUpdateRoute(
  request: Request,
  rawBody: unknown,
  requestId: string,
  controls: ApiRuntimeControls,
  dependencies: ApiAppendExecutionUpdateRouteDependencies,
): Promise<ApiAppendExecutionUpdateRouteResult> {
  if (!(request instanceof Request)) {
    throw new ApiHttpError("internal_error");
  }
  if (typeof requestId !== "string" || requestId.trim().length === 0) {
    throw new ApiHttpError("internal_error");
  }

  // 1. Actual-request URL validation. The frozen route constant is never
  // substituted for the incoming pathname. No supplied URL, query string or
  // fragment is ever echoed into a public error message.
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    throw new ApiHttpError("internal_error");
  }
  if (url.search.length > 0 || url.hash.length > 0) {
    throw new ApiHttpError("invalid_request");
  }

  // 1b. Exact route/runtime gate on the real pathname. `isApiOperationEnabled`
  // is never bypassed.

  // The append route is the ONLY target of this executor. Route identity is
  // resolved before the runtime gate so any other registered route (including
  // the GET Execution Update history read) remains route_not_found here.
  if (
    matchApiRoute(request.method, url.pathname) !==
      EXECUTION_UPDATES_APPEND_ROUTE
  ) {
    throw new ApiHttpError("route_not_found");
  }
  const route = resolveApiRouteAccess(request.method, url.pathname, controls);
  if (route !== EXECUTION_UPDATES_APPEND_ROUTE) {
    throw new ApiHttpError("route_not_found");
  }


  validateMutationDependencies(dependencies);

  // 2. Strict accepted business-body validation, before authentication.
  const body: ApiV1AppendExecutionUpdateBody =
    parseApiV1AppendExecutionUpdateBody(rawBody);

  // 3. Authentication through the existing accepted pipeline.
  let authenticated: AuthenticatedApiContext;
  try {
    authenticated = await dependencies.authenticate(request);
  } catch (cause) {
    preserveOrWrap(cause);
  }
  authenticated = validateAuthenticatedContext(authenticated!);

  const activityIdentity: ApiProtectedRouteActivityIdentity = Object.freeze({
    apiClientId: authenticated.client.apiClientId,
    actorUserId: authenticated.token.userId,
  });

  // 4. Route authorization — exactly once.
  try {
    await dependencies.authorizeRoute(authenticated, route);
  } catch (cause) {
    preserveOrWrap(cause);
  }

  // 5. Rate limiting strictly before execution-context construction.
  let profile: ApiRateLimitProfile;
  try {
    profile = await dependencies.resolveRateLimitProfile(authenticated, route);
  } catch (cause) {
    preserveOrWrap(cause);
  }

  await enforceApiRateLimit(
    {
      apiClientId: authenticated.client.apiClientId,
      userId: authenticated.token.userId,
      routeId: route.id,
    },
    profile!,
    dependencies.rateLimit,
  );

  // 6. Canonical API-F execution context. The payload hash is derived from the
  // validated body only. The HTTP-resolved request ID is reused when the
  // caller supplied no `X-Request-ID`.
  let executionContext: Awaited<ReturnType<typeof buildExecutionContext>>;
  try {
    executionContext = await buildExecutionContext(request, authenticated, body, {
      randomUUID: () => requestId,
    });
  } catch (cause) {
    if (cause instanceof IdempotencyValidationError) {
      throw new ApiHttpError("invalid_request", cause);
    }
    if (cause instanceof ExecutionContextError) {
      if (cause.code === "invalid_authenticated_context") {
        throw new ApiHttpError("internal_error", cause);
      }
      throw new ApiHttpError("invalid_request", cause);
    }
    if (cause instanceof ApiHttpError) throw cause;
    throw new ApiHttpError("internal_error", cause);
  }

  // 7. Exactly one delegated mutation invocation.
  let result: Awaited<
    ReturnType<DelegatedApiV1AppendExecutionUpdateExecutor>
  >;
  try {
    result = await dependencies.appendExecutionUpdate(
      request,
      authenticated,
      body,
      executionContext,
    );
  } catch (cause) {
    preserveOrWrap(cause);
  }

  // 8. Bounded outcome mapping.
  const bounded = result!;
  if (bounded.ok === true) {
    if (bounded.outcome === "applied") {
      return Object.freeze({
        route,
        payload: bounded,
        status: 201 as const,
        activityIdentity,
      });
    }
    if (bounded.outcome === "replayed") {
      return Object.freeze({
        route,
        payload: bounded,
        status: 200 as const,
        activityIdentity,
      });
    }
    throw new ApiHttpError("internal_error");
  }

  if (bounded.outcome === "invalid") {
    throw new ApiHttpError("invalid_request");
  }
  if (bounded.outcome === "not_authorized") {
    throw new ApiHttpError("not_authorized");
  }
  if (bounded.outcome === "idempotency_conflict") {
    throw new ApiHttpError("idempotency_conflict");
  }
  if (bounded.outcome === "idempotency_pending") {
    throw new ApiHttpError("idempotency_pending");
  }
  throw new ApiHttpError("internal_error");
}

// -----------------------------------------------------------------------------
// API-K.7 — Dedicated protected Risk mutation execution pipelines.
//
// Two explicit pipelines (create, update). No generic mutation dependency,
// command dispatcher, RPC proxy or CRUD engine exists. Project / Workspace /
// Organization / Tenant authority is NOT derived here: the accepted API-K.5
// database wrappers remain the sole authority for target-derived scope and
// Project Connected App enablement.
// -----------------------------------------------------------------------------

/** Narrow Risk mutation dependency contract — exactly two executors. */
export interface ApiRiskMutationRouteDependencies {
  authenticate(request: Request): Promise<AuthenticatedApiContext>;
  authorizeRoute(
    context: AuthenticatedApiContext,
    route: ApiRouteDefinition,
  ): Promise<void>;
  resolveRateLimitProfile(
    context: AuthenticatedApiContext,
    route: ApiRouteDefinition,
  ): Promise<ApiRateLimitProfile>;
  rateLimit: ApiRateLimitDependencies;
  /** Caller-scoped delegated `api_v1_create_risk` executor. */
  createRisk: DelegatedApiV1CreateRiskExecutor;
  /** Caller-scoped delegated `api_v1_update_risk` executor. */
  updateRisk: DelegatedApiV1UpdateRiskExecutor;
}

export interface ApiCreateRiskRouteResult {
  readonly route: ApiRouteDefinition;
  readonly payload: ApiV1CreateRiskSuccessResult;
  readonly status: 200 | 201;
  readonly activityIdentity: ApiProtectedRouteActivityIdentity;
}

export interface ApiUpdateRiskRouteResult {
  readonly route: ApiRouteDefinition;
  readonly payload: ApiV1UpdateRiskSuccessResult;
  readonly status: 200;
  readonly activityIdentity: ApiProtectedRouteActivityIdentity;
}

function validateRiskMutationDependencies(
  deps: unknown,
): asserts deps is ApiRiskMutationRouteDependencies {
  if (!isNonArrayObject(deps)) throw new ApiHttpError("internal_error");
  const d = deps as Record<string, unknown>;
  if (typeof d.authenticate !== "function") {
    throw new ApiHttpError("internal_error");
  }
  if (typeof d.authorizeRoute !== "function") {
    throw new ApiHttpError("internal_error");
  }
  if (typeof d.resolveRateLimitProfile !== "function") {
    throw new ApiHttpError("internal_error");
  }
  if (typeof d.createRisk !== "function") {
    throw new ApiHttpError("internal_error");
  }
  if (typeof d.updateRisk !== "function") {
    throw new ApiHttpError("internal_error");
  }
  if (!isNonArrayObject(d.rateLimit)) {
    throw new ApiHttpError("internal_error");
  }
}

/** Shared, non-generic execution-context construction for Risk mutations. */
async function buildRiskExecutionContext(
  request: Request,
  authenticated: AuthenticatedApiContext,
  canonicalPayload: unknown,
  requestId: string,
): Promise<Awaited<ReturnType<typeof buildExecutionContext>>> {
  try {
    return await buildExecutionContext(
      request,
      authenticated,
      canonicalPayload,
      { randomUUID: () => requestId },
    );
  } catch (cause) {
    if (cause instanceof IdempotencyValidationError) {
      throw new ApiHttpError("invalid_request", cause);
    }
    if (cause instanceof ExecutionContextError) {
      if (cause.code === "invalid_authenticated_context") {
        throw new ApiHttpError("internal_error", cause);
      }
      throw new ApiHttpError("invalid_request", cause);
    }
    if (cause instanceof ApiHttpError) throw cause;
    throw new ApiHttpError("internal_error", cause);
  }
}

function parseMutationUrl(request: Request): URL {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    throw new ApiHttpError("internal_error");
  }
  if (url.search.length > 0 || url.hash.length > 0) {
    throw new ApiHttpError("invalid_request");
  }
  return url;
}

/** POST /v1/risks */
export async function executeApiCreateRiskRoute(
  request: Request,
  rawBody: unknown,
  requestId: string,
  controls: ApiRuntimeControls,
  dependencies: ApiRiskMutationRouteDependencies,
): Promise<ApiCreateRiskRouteResult> {
  if (!(request instanceof Request)) {
    throw new ApiHttpError("internal_error");
  }
  if (typeof requestId !== "string" || requestId.trim().length === 0) {
    throw new ApiHttpError("internal_error");
  }

  // 1. Actual route/runtime gate on the real pathname.
  const url = parseMutationUrl(request);
  const route = resolveApiRouteAccess(request.method, url.pathname, controls);
  if (route !== RISK_CREATE_ROUTE) {
    throw new ApiHttpError("route_not_found");
  }

  validateRiskMutationDependencies(dependencies);

  // 2. Strict closed-schema body validation, before authentication.
  const body: ApiV1CreateRiskBody = parseApiV1CreateRiskBody(rawBody);

  // 3. Authentication.
  let authenticated: AuthenticatedApiContext;
  try {
    authenticated = await dependencies.authenticate(request);
  } catch (cause) {
    preserveOrWrap(cause);
  }
  authenticated = validateAuthenticatedContext(authenticated!);

  const activityIdentity: ApiProtectedRouteActivityIdentity = Object.freeze({
    apiClientId: authenticated.client.apiClientId,
    actorUserId: authenticated.token.userId,
  });

  // 4. Route authorization — exactly once.
  try {
    await dependencies.authorizeRoute(authenticated, route);
  } catch (cause) {
    preserveOrWrap(cause);
  }

  // 5. Rate limiting strictly before execution-context construction.
  let profile: ApiRateLimitProfile;
  try {
    profile = await dependencies.resolveRateLimitProfile(authenticated, route);
  } catch (cause) {
    preserveOrWrap(cause);
  }
  await enforceApiRateLimit(
    {
      apiClientId: authenticated.client.apiClientId,
      userId: authenticated.token.userId,
      routeId: route.id,
    },
    profile!,
    dependencies.rateLimit,
  );

  // 6. Canonical API-F execution context. The create body already carries the
  // Risk target identity, so the normalized body IS the canonical payload.
  const executionContext = await buildRiskExecutionContext(
    request,
    authenticated,
    body,
    requestId,
  );

  // 7. Exactly one delegated mutation invocation.
  let result: Awaited<ReturnType<DelegatedApiV1CreateRiskExecutor>>;
  try {
    result = await dependencies.createRisk(
      request,
      authenticated,
      body,
      executionContext,
    );
  } catch (cause) {
    preserveOrWrap(cause);
  }

  // 8. Bounded outcome mapping.
  const bounded = result!;
  if (bounded.ok === true) {
    if (bounded.outcome === "applied") {
      return Object.freeze({
        route,
        payload: bounded,
        status: 201 as const,
        activityIdentity,
      });
    }
    if (bounded.outcome === "replayed") {
      return Object.freeze({
        route,
        payload: bounded,
        status: 200 as const,
        activityIdentity,
      });
    }
    throw new ApiHttpError("internal_error");
  }

  if (bounded.outcome === "invalid") {
    throw new ApiHttpError("invalid_request");
  }
  if (bounded.outcome === "not_authorized") {
    throw new ApiHttpError("not_authorized");
  }
  if (bounded.outcome === "idempotency_conflict") {
    throw new ApiHttpError("idempotency_conflict");
  }
  if (bounded.outcome === "idempotency_pending") {
    throw new ApiHttpError("idempotency_pending");
  }
  throw new ApiHttpError("internal_error");
}

/** PATCH /v1/risks/:riskid */
export async function executeApiUpdateRiskRoute(
  request: Request,
  rawBody: unknown,
  requestId: string,
  controls: ApiRuntimeControls,
  dependencies: ApiRiskMutationRouteDependencies,
): Promise<ApiUpdateRiskRouteResult> {
  if (!(request instanceof Request)) {
    throw new ApiHttpError("internal_error");
  }
  if (typeof requestId !== "string" || requestId.trim().length === 0) {
    throw new ApiHttpError("internal_error");
  }

  // 1. Actual route/runtime gate on the real pathname.
  const url = parseMutationUrl(request);
  const route = resolveApiRouteAccess(request.method, url.pathname, controls);
  if (route !== RISK_UPDATE_ROUTE) {
    throw new ApiHttpError("route_not_found");
  }

  validateRiskMutationDependencies(dependencies);

  // 2. Strict path + closed-schema body validation, before authentication.
  const { riskId } = parseApiV1RiskUpdatePath(url.pathname);
  const body: ApiV1UpdateRiskBody = parseApiV1UpdateRiskBody(rawBody);

  // 3. Authentication.
  let authenticated: AuthenticatedApiContext;
  try {
    authenticated = await dependencies.authenticate(request);
  } catch (cause) {
    preserveOrWrap(cause);
  }
  authenticated = validateAuthenticatedContext(authenticated!);

  const activityIdentity: ApiProtectedRouteActivityIdentity = Object.freeze({
    apiClientId: authenticated.client.apiClientId,
    actorUserId: authenticated.token.userId,
  });

  // 4. Route authorization — exactly once.
  try {
    await dependencies.authorizeRoute(authenticated, route);
  } catch (cause) {
    preserveOrWrap(cause);
  }

  // 5. Rate limiting strictly before execution-context construction.
  let profile: ApiRateLimitProfile;
  try {
    profile = await dependencies.resolveRateLimitProfile(authenticated, route);
  } catch (cause) {
    preserveOrWrap(cause);
  }
  await enforceApiRateLimit(
    {
      apiClientId: authenticated.client.apiClientId,
      userId: authenticated.token.userId,
      routeId: route.id,
    },
    profile!,
    dependencies.rateLimit,
  );

  // 6. Canonical API-F execution context. The Risk identity lives in the URL,
  // so the hashed canonical payload MUST fold in the validated path riskId.
  const executionContext = await buildRiskExecutionContext(
    request,
    authenticated,
    buildApiV1UpdateRiskIdempotencyPayload(riskId, body),
    requestId,
  );

  // 7. Exactly one delegated mutation invocation.
  let result: Awaited<ReturnType<DelegatedApiV1UpdateRiskExecutor>>;
  try {
    result = await dependencies.updateRisk(
      request,
      authenticated,
      riskId,
      body,
      executionContext,
    );
  } catch (cause) {
    preserveOrWrap(cause);
  }

  // 8. Bounded outcome mapping.
  const bounded = result!;
  if (bounded.ok === true) {
    if (
      bounded.outcome === "applied" ||
      bounded.outcome === "no_change" ||
      bounded.outcome === "replayed"
    ) {
      return Object.freeze({
        route,
        payload: bounded,
        status: 200 as const,
        activityIdentity,
      });
    }
    throw new ApiHttpError("internal_error");
  }

  if (bounded.outcome === "conflict") {
    // Optimistic concurrency only. `stale_risk` never leaves this boundary.
    throw new ApiHttpError("concurrency_conflict");
  }
  if (bounded.outcome === "invalid") {
    throw new ApiHttpError("invalid_request");
  }
  if (bounded.outcome === "not_authorized") {
    throw new ApiHttpError("not_authorized");
  }
  if (bounded.outcome === "idempotency_conflict") {
    throw new ApiHttpError("idempotency_conflict");
  }
  if (bounded.outcome === "idempotency_pending") {
    throw new ApiHttpError("idempotency_pending");
  }
  throw new ApiHttpError("internal_error");
}

// -----------------------------------------------------------------------------
// API-K.8 — Dedicated protected Blocker mutation execution pipelines.
//
// Two explicit pipelines (create, update). This is a SEPARATE narrow contract:
// the accepted Risk dependency contract is NOT generalized, and no command
// dispatcher, RPC proxy or CRUD engine exists. Project / Workspace /
// Organization / Tenant authority is NOT derived here: the accepted API-K.6
// database wrappers remain the sole authority for target-derived scope and
// Project Connected App enablement.
// -----------------------------------------------------------------------------

/** Narrow Blocker mutation dependency contract — exactly two executors. */
export interface ApiBlockerMutationRouteDependencies {
  authenticate(request: Request): Promise<AuthenticatedApiContext>;
  authorizeRoute(
    context: AuthenticatedApiContext,
    route: ApiRouteDefinition,
  ): Promise<void>;
  resolveRateLimitProfile(
    context: AuthenticatedApiContext,
    route: ApiRouteDefinition,
  ): Promise<ApiRateLimitProfile>;
  rateLimit: ApiRateLimitDependencies;
  /** Caller-scoped delegated `api_v1_create_blocker` executor. */
  createBlocker: DelegatedApiV1CreateBlockerExecutor;
  /** Caller-scoped delegated `api_v1_update_blocker` executor. */
  updateBlocker: DelegatedApiV1UpdateBlockerExecutor;
}

export interface ApiCreateBlockerRouteResult {
  readonly route: ApiRouteDefinition;
  readonly payload: ApiV1CreateBlockerSuccessResult;
  readonly status: 200 | 201;
  readonly activityIdentity: ApiProtectedRouteActivityIdentity;
}

export interface ApiUpdateBlockerRouteResult {
  readonly route: ApiRouteDefinition;
  readonly payload: ApiV1UpdateBlockerSuccessResult;
  readonly status: 200;
  readonly activityIdentity: ApiProtectedRouteActivityIdentity;
}

function validateBlockerMutationDependencies(
  deps: unknown,
): asserts deps is ApiBlockerMutationRouteDependencies {
  if (!isNonArrayObject(deps)) throw new ApiHttpError("internal_error");
  const d = deps as Record<string, unknown>;
  if (typeof d.authenticate !== "function") {
    throw new ApiHttpError("internal_error");
  }
  if (typeof d.authorizeRoute !== "function") {
    throw new ApiHttpError("internal_error");
  }
  if (typeof d.resolveRateLimitProfile !== "function") {
    throw new ApiHttpError("internal_error");
  }
  if (typeof d.createBlocker !== "function") {
    throw new ApiHttpError("internal_error");
  }
  if (typeof d.updateBlocker !== "function") {
    throw new ApiHttpError("internal_error");
  }
  if (!isNonArrayObject(d.rateLimit)) {
    throw new ApiHttpError("internal_error");
  }
}

/** Shared, non-generic execution-context construction for Blocker mutations. */
async function buildBlockerExecutionContext(
  request: Request,
  authenticated: AuthenticatedApiContext,
  canonicalPayload: unknown,
  requestId: string,
): Promise<Awaited<ReturnType<typeof buildExecutionContext>>> {
  try {
    return await buildExecutionContext(
      request,
      authenticated,
      canonicalPayload,
      { randomUUID: () => requestId },
    );
  } catch (cause) {
    if (cause instanceof IdempotencyValidationError) {
      throw new ApiHttpError("invalid_request", cause);
    }
    if (cause instanceof ExecutionContextError) {
      if (cause.code === "invalid_authenticated_context") {
        throw new ApiHttpError("internal_error", cause);
      }
      throw new ApiHttpError("invalid_request", cause);
    }
    if (cause instanceof ApiHttpError) throw cause;
    throw new ApiHttpError("internal_error", cause);
  }
}

/** POST /v1/blockers */
export async function executeApiCreateBlockerRoute(
  request: Request,
  rawBody: unknown,
  requestId: string,
  controls: ApiRuntimeControls,
  dependencies: ApiBlockerMutationRouteDependencies,
): Promise<ApiCreateBlockerRouteResult> {
  if (!(request instanceof Request)) {
    throw new ApiHttpError("internal_error");
  }
  if (typeof requestId !== "string" || requestId.trim().length === 0) {
    throw new ApiHttpError("internal_error");
  }

  // 1. Actual route/runtime gate on the real pathname.
  const url = parseMutationUrl(request);
  const route = resolveApiRouteAccess(request.method, url.pathname, controls);
  if (route !== BLOCKER_CREATE_ROUTE) {
    throw new ApiHttpError("route_not_found");
  }

  validateBlockerMutationDependencies(dependencies);

  // 2. Strict closed-schema body validation, before authentication.
  const body: ApiV1CreateBlockerBody = parseApiV1CreateBlockerBody(rawBody);

  // 3. Authentication.
  let authenticated: AuthenticatedApiContext;
  try {
    authenticated = await dependencies.authenticate(request);
  } catch (cause) {
    preserveOrWrap(cause);
  }
  authenticated = validateAuthenticatedContext(authenticated!);

  const activityIdentity: ApiProtectedRouteActivityIdentity = Object.freeze({
    apiClientId: authenticated.client.apiClientId,
    actorUserId: authenticated.token.userId,
  });

  // 4. Route authorization — exactly once.
  try {
    await dependencies.authorizeRoute(authenticated, route);
  } catch (cause) {
    preserveOrWrap(cause);
  }

  // 5. Rate limiting strictly before execution-context construction.
  let profile: ApiRateLimitProfile;
  try {
    profile = await dependencies.resolveRateLimitProfile(authenticated, route);
  } catch (cause) {
    preserveOrWrap(cause);
  }
  await enforceApiRateLimit(
    {
      apiClientId: authenticated.client.apiClientId,
      userId: authenticated.token.userId,
      routeId: route.id,
    },
    profile!,
    dependencies.rateLimit,
  );

  // 6. Canonical API-F execution context. The create body already carries the
  // Blocker target identity, so the normalized body IS the canonical payload.
  const executionContext = await buildBlockerExecutionContext(
    request,
    authenticated,
    body,
    requestId,
  );

  // 7. Exactly one delegated mutation invocation.
  let result: Awaited<ReturnType<DelegatedApiV1CreateBlockerExecutor>>;
  try {
    result = await dependencies.createBlocker(
      request,
      authenticated,
      body,
      executionContext,
    );
  } catch (cause) {
    preserveOrWrap(cause);
  }

  // 8. Bounded outcome mapping.
  const bounded = result!;
  if (bounded.ok === true) {
    if (bounded.outcome === "applied") {
      return Object.freeze({
        route,
        payload: bounded,
        status: 201 as const,
        activityIdentity,
      });
    }
    if (bounded.outcome === "replayed") {
      return Object.freeze({
        route,
        payload: bounded,
        status: 200 as const,
        activityIdentity,
      });
    }
    throw new ApiHttpError("internal_error");
  }

  if (bounded.outcome === "invalid") {
    throw new ApiHttpError("invalid_request");
  }
  if (bounded.outcome === "not_authorized") {
    throw new ApiHttpError("not_authorized");
  }
  if (bounded.outcome === "idempotency_conflict") {
    throw new ApiHttpError("idempotency_conflict");
  }
  if (bounded.outcome === "idempotency_pending") {
    throw new ApiHttpError("idempotency_pending");
  }
  throw new ApiHttpError("internal_error");
}

/** PATCH /v1/blockers/:blockerid */
export async function executeApiUpdateBlockerRoute(
  request: Request,
  rawBody: unknown,
  requestId: string,
  controls: ApiRuntimeControls,
  dependencies: ApiBlockerMutationRouteDependencies,
): Promise<ApiUpdateBlockerRouteResult> {
  if (!(request instanceof Request)) {
    throw new ApiHttpError("internal_error");
  }
  if (typeof requestId !== "string" || requestId.trim().length === 0) {
    throw new ApiHttpError("internal_error");
  }

  // 1. Actual route/runtime gate on the real pathname.
  const url = parseMutationUrl(request);
  const route = resolveApiRouteAccess(request.method, url.pathname, controls);
  if (route !== BLOCKER_UPDATE_ROUTE) {
    throw new ApiHttpError("route_not_found");
  }

  validateBlockerMutationDependencies(dependencies);

  // 2. Strict path + closed-schema body validation, before authentication.
  const { blockerId } = parseApiV1BlockerUpdatePath(url.pathname);
  const body: ApiV1UpdateBlockerBody = parseApiV1UpdateBlockerBody(rawBody);

  // 3. Authentication.
  let authenticated: AuthenticatedApiContext;
  try {
    authenticated = await dependencies.authenticate(request);
  } catch (cause) {
    preserveOrWrap(cause);
  }
  authenticated = validateAuthenticatedContext(authenticated!);

  const activityIdentity: ApiProtectedRouteActivityIdentity = Object.freeze({
    apiClientId: authenticated.client.apiClientId,
    actorUserId: authenticated.token.userId,
  });

  // 4. Route authorization — exactly once.
  try {
    await dependencies.authorizeRoute(authenticated, route);
  } catch (cause) {
    preserveOrWrap(cause);
  }

  // 5. Rate limiting strictly before execution-context construction.
  let profile: ApiRateLimitProfile;
  try {
    profile = await dependencies.resolveRateLimitProfile(authenticated, route);
  } catch (cause) {
    preserveOrWrap(cause);
  }
  await enforceApiRateLimit(
    {
      apiClientId: authenticated.client.apiClientId,
      userId: authenticated.token.userId,
      routeId: route.id,
    },
    profile!,
    dependencies.rateLimit,
  );

  // 6. Canonical API-F execution context. The Blocker identity lives in the
  // URL, so the hashed canonical payload MUST fold in the validated path
  // blockerId.
  const executionContext = await buildBlockerExecutionContext(
    request,
    authenticated,
    buildApiV1UpdateBlockerIdempotencyPayload(blockerId, body),
    requestId,
  );

  // 7. Exactly one delegated mutation invocation.
  let result: Awaited<ReturnType<DelegatedApiV1UpdateBlockerExecutor>>;
  try {
    result = await dependencies.updateBlocker(
      request,
      authenticated,
      blockerId,
      body,
      executionContext,
    );
  } catch (cause) {
    preserveOrWrap(cause);
  }

  // 8. Bounded outcome mapping.
  const bounded = result!;
  if (bounded.ok === true) {
    if (
      bounded.outcome === "applied" ||
      bounded.outcome === "no_change" ||
      bounded.outcome === "replayed"
    ) {
      return Object.freeze({
        route,
        payload: bounded,
        status: 200 as const,
        activityIdentity,
      });
    }
    throw new ApiHttpError("internal_error");
  }

  if (bounded.outcome === "conflict") {
    // Optimistic concurrency only. `stale_blocker` never leaves this boundary.
    throw new ApiHttpError("concurrency_conflict");
  }
  if (bounded.outcome === "invalid") {
    throw new ApiHttpError("invalid_request");
  }
  if (bounded.outcome === "not_authorized") {
    throw new ApiHttpError("not_authorized");
  }
  if (bounded.outcome === "idempotency_conflict") {
    throw new ApiHttpError("idempotency_conflict");
  }
  if (bounded.outcome === "idempotency_pending") {
    throw new ApiHttpError("idempotency_pending");
  }
  throw new ApiHttpError("internal_error");
}

// -----------------------------------------------------------------------------
// API-M.8A — Dedicated protected Phase mutation execution pipelines.
//
// Two explicit pipelines (create, metadata update). This is a SEPARATE narrow
// contract: the accepted Risk and Blocker dependency contracts are NOT
// generalized, and no command dispatcher, RPC proxy or CRUD engine exists.
// Project / Workspace / Organization / Tenant authority is NOT derived here:
// the accepted API-M.7A database wrappers remain the sole authority for
// target-derived scope, Project Connected App enablement, optimistic
// concurrency and the canonical Project planning-window constraint.
// -----------------------------------------------------------------------------

/** Narrow Phase mutation dependency contract — exactly two executors. */
export interface ApiPhaseMutationRouteDependencies {
  authenticate(request: Request): Promise<AuthenticatedApiContext>;
  authorizeRoute(
    context: AuthenticatedApiContext,
    route: ApiRouteDefinition,
  ): Promise<void>;
  resolveRateLimitProfile(
    context: AuthenticatedApiContext,
    route: ApiRouteDefinition,
  ): Promise<ApiRateLimitProfile>;
  rateLimit: ApiRateLimitDependencies;
  /** Caller-scoped delegated `api_v1_create_phase` executor. */
  createPhase: DelegatedApiV1CreatePhaseExecutor;
  /** Caller-scoped delegated `api_v1_update_phase` executor. */
  updatePhase: DelegatedApiV1UpdatePhaseExecutor;
  /** API-M.8B — caller-scoped delegated `api_v1_reorder_phases` executor. */
  reorderPhases: DelegatedApiV1ReorderPhasesExecutor;
  /** API-M.8B — caller-scoped delegated `api_v1_plan_phase` executor. */
  planPhase: DelegatedApiV1PlanPhaseExecutor;
}

export interface ApiCreatePhaseRouteResult {
  readonly route: ApiRouteDefinition;
  readonly payload:
    | ApiV1CreatePhaseSuccessResult
    | ApiV1CreatePhaseConfirmationRequiredResult;
  readonly status: 200 | 201 | 409;
  readonly activityIdentity: ApiProtectedRouteActivityIdentity;
}

export interface ApiUpdatePhaseRouteResult {
  readonly route: ApiRouteDefinition;
  readonly payload: ApiV1UpdatePhaseSuccessResult;
  readonly status: 200;
  readonly activityIdentity: ApiProtectedRouteActivityIdentity;
}

export interface ApiReorderPhasesRouteResult {
  readonly route: ApiRouteDefinition;
  readonly payload: ApiV1ReorderPhasesSuccessResult;
  readonly status: 200;
  readonly activityIdentity: ApiProtectedRouteActivityIdentity;
}

export interface ApiPlanPhaseRouteResult {
  readonly route: ApiRouteDefinition;
  readonly payload:
    | ApiV1PlanPhaseSuccessResult
    | ApiV1PlanPhaseConfirmationRequiredResult;
  readonly status: 200 | 409;
  readonly activityIdentity: ApiProtectedRouteActivityIdentity;
}

function validatePhaseMutationDependencies(
  deps: unknown,
): asserts deps is ApiPhaseMutationRouteDependencies {
  if (!isNonArrayObject(deps)) throw new ApiHttpError("internal_error");
  const d = deps as Record<string, unknown>;
  if (typeof d.authenticate !== "function") {
    throw new ApiHttpError("internal_error");
  }
  if (typeof d.authorizeRoute !== "function") {
    throw new ApiHttpError("internal_error");
  }
  if (typeof d.resolveRateLimitProfile !== "function") {
    throw new ApiHttpError("internal_error");
  }
  if (typeof d.createPhase !== "function") {
    throw new ApiHttpError("internal_error");
  }
  if (typeof d.updatePhase !== "function") {
    throw new ApiHttpError("internal_error");
  }
  if (typeof d.reorderPhases !== "function") {
    throw new ApiHttpError("internal_error");
  }
  if (typeof d.planPhase !== "function") {
    throw new ApiHttpError("internal_error");
  }
  if (!isNonArrayObject(d.rateLimit)) {
    throw new ApiHttpError("internal_error");
  }
}

/** Shared, non-generic execution-context construction for Phase mutations. */
async function buildPhaseExecutionContext(
  request: Request,
  authenticated: AuthenticatedApiContext,
  canonicalPayload: unknown,
  requestId: string,
): Promise<Awaited<ReturnType<typeof buildExecutionContext>>> {
  try {
    return await buildExecutionContext(
      request,
      authenticated,
      canonicalPayload,
      { randomUUID: () => requestId },
    );
  } catch (cause) {
    if (cause instanceof IdempotencyValidationError) {
      throw new ApiHttpError("invalid_request", cause);
    }
    if (cause instanceof ExecutionContextError) {
      if (cause.code === "invalid_authenticated_context") {
        throw new ApiHttpError("internal_error", cause);
      }
      throw new ApiHttpError("invalid_request", cause);
    }
    if (cause instanceof ApiHttpError) throw cause;
    throw new ApiHttpError("internal_error", cause);
  }
}

/** POST /v1/phases */
export async function executeApiCreatePhaseRoute(
  request: Request,
  rawBody: unknown,
  requestId: string,
  controls: ApiRuntimeControls,
  dependencies: ApiPhaseMutationRouteDependencies,
): Promise<ApiCreatePhaseRouteResult> {
  if (!(request instanceof Request)) {
    throw new ApiHttpError("internal_error");
  }
  if (typeof requestId !== "string" || requestId.trim().length === 0) {
    throw new ApiHttpError("internal_error");
  }

  // 1. Actual route/runtime gate on the real pathname.
  const url = parseMutationUrl(request);
  const route = resolveApiRouteAccess(request.method, url.pathname, controls);
  if (route !== PHASE_CREATE_ROUTE) {
    throw new ApiHttpError("route_not_found");
  }

  validatePhaseMutationDependencies(dependencies);

  // 2. Strict closed-schema body validation, before authentication.
  const body: ApiV1CreatePhaseBody = parseApiV1CreatePhaseBody(rawBody);

  // 3. Authentication.
  let authenticated: AuthenticatedApiContext;
  try {
    authenticated = await dependencies.authenticate(request);
  } catch (cause) {
    preserveOrWrap(cause);
  }
  authenticated = validateAuthenticatedContext(authenticated!);

  const activityIdentity: ApiProtectedRouteActivityIdentity = Object.freeze({
    apiClientId: authenticated.client.apiClientId,
    actorUserId: authenticated.token.userId,
  });

  // 4. Route authorization — exactly once.
  try {
    await dependencies.authorizeRoute(authenticated, route);
  } catch (cause) {
    preserveOrWrap(cause);
  }

  // 5. Rate limiting strictly before execution-context construction.
  let profile: ApiRateLimitProfile;
  try {
    profile = await dependencies.resolveRateLimitProfile(authenticated, route);
  } catch (cause) {
    preserveOrWrap(cause);
  }
  await enforceApiRateLimit(
    {
      apiClientId: authenticated.client.apiClientId,
      userId: authenticated.token.userId,
      routeId: route.id,
    },
    profile!,
    dependencies.rateLimit,
  );

  // 6. Canonical API-F execution context. The create body already carries the
  // target Project identity, so the normalized body IS the canonical payload.
  const executionContext = await buildPhaseExecutionContext(
    request,
    authenticated,
    body,
    requestId,
  );

  // 7. Exactly one delegated mutation invocation.
  let result: Awaited<ReturnType<DelegatedApiV1CreatePhaseExecutor>>;
  try {
    result = await dependencies.createPhase(
      request,
      authenticated,
      body,
      executionContext,
    );
  } catch (cause) {
    preserveOrWrap(cause);
  }

  // 8. Bounded outcome mapping.
  const bounded = result!;
  if (bounded.ok === true) {
    if (bounded.outcome === "applied") {
      return Object.freeze({
        route,
        payload: bounded,
        status: 201 as const,
        activityIdentity,
      });
    }
    if (bounded.outcome === "replayed") {
      return Object.freeze({
        route,
        payload: bounded,
        status: 200 as const,
        activityIdentity,
      });
    }
    throw new ApiHttpError("internal_error");
  }

  if (bounded.outcome === "confirmation_required") {
    // Canonical Project planning-window constraint. Nothing was created; the
    // bounded structural confirmation payload is returned with 409 so the
    // caller can decide explicitly. No Project is ever widened here.
    return Object.freeze({
      route,
      payload: bounded,
      status: 409 as const,
      activityIdentity,
    });
  }
  if (bounded.outcome === "invalid") {
    throw new ApiHttpError("invalid_request");
  }
  if (bounded.outcome === "not_authorized") {
    throw new ApiHttpError("not_authorized");
  }
  if (bounded.outcome === "idempotency_conflict") {
    throw new ApiHttpError("idempotency_conflict");
  }
  if (bounded.outcome === "idempotency_pending") {
    throw new ApiHttpError("idempotency_pending");
  }
  throw new ApiHttpError("internal_error");
}

/** PATCH /v1/phases/:phaseid */
export async function executeApiUpdatePhaseRoute(
  request: Request,
  rawBody: unknown,
  requestId: string,
  controls: ApiRuntimeControls,
  dependencies: ApiPhaseMutationRouteDependencies,
): Promise<ApiUpdatePhaseRouteResult> {
  if (!(request instanceof Request)) {
    throw new ApiHttpError("internal_error");
  }
  if (typeof requestId !== "string" || requestId.trim().length === 0) {
    throw new ApiHttpError("internal_error");
  }

  // 1. Actual route/runtime gate on the real pathname.
  const url = parseMutationUrl(request);
  const route = resolveApiRouteAccess(request.method, url.pathname, controls);
  if (route !== PHASE_UPDATE_ROUTE) {
    throw new ApiHttpError("route_not_found");
  }

  validatePhaseMutationDependencies(dependencies);

  // 2. Strict path + closed-schema body validation, before authentication.
  const { phaseId } = parseApiV1PhaseUpdatePath(url.pathname);
  const body: ApiV1UpdatePhaseBody = parseApiV1UpdatePhaseBody(rawBody);

  // 3. Authentication.
  let authenticated: AuthenticatedApiContext;
  try {
    authenticated = await dependencies.authenticate(request);
  } catch (cause) {
    preserveOrWrap(cause);
  }
  authenticated = validateAuthenticatedContext(authenticated!);

  const activityIdentity: ApiProtectedRouteActivityIdentity = Object.freeze({
    apiClientId: authenticated.client.apiClientId,
    actorUserId: authenticated.token.userId,
  });

  // 4. Route authorization — exactly once.
  try {
    await dependencies.authorizeRoute(authenticated, route);
  } catch (cause) {
    preserveOrWrap(cause);
  }

  // 5. Rate limiting strictly before execution-context construction.
  let profile: ApiRateLimitProfile;
  try {
    profile = await dependencies.resolveRateLimitProfile(authenticated, route);
  } catch (cause) {
    preserveOrWrap(cause);
  }
  await enforceApiRateLimit(
    {
      apiClientId: authenticated.client.apiClientId,
      userId: authenticated.token.userId,
      routeId: route.id,
    },
    profile!,
    dependencies.rateLimit,
  );

  // 6. Canonical API-F execution context. The Phase identity lives in the URL,
  // so the hashed canonical payload MUST fold in the validated path phaseId.
  const executionContext = await buildPhaseExecutionContext(
    request,
    authenticated,
    buildApiV1UpdatePhaseIdempotencyPayload(phaseId, body),
    requestId,
  );

  // 7. Exactly one delegated mutation invocation.
  let result: Awaited<ReturnType<DelegatedApiV1UpdatePhaseExecutor>>;
  try {
    result = await dependencies.updatePhase(
      request,
      authenticated,
      phaseId,
      body,
      executionContext,
    );
  } catch (cause) {
    preserveOrWrap(cause);
  }

  // 8. Bounded outcome mapping.
  const bounded = result!;
  if (bounded.ok === true) {
    if (
      bounded.outcome === "applied" ||
      bounded.outcome === "no_change" ||
      bounded.outcome === "replayed"
    ) {
      return Object.freeze({
        route,
        payload: bounded,
        status: 200 as const,
        activityIdentity,
      });
    }
    throw new ApiHttpError("internal_error");
  }

  if (bounded.outcome === "conflict") {
    // Optimistic concurrency only. `stale_phase` never leaves this boundary.
    throw new ApiHttpError("concurrency_conflict");
  }
  if (bounded.outcome === "invalid") {
    throw new ApiHttpError("invalid_request");
  }
  if (bounded.outcome === "not_authorized") {
    throw new ApiHttpError("not_authorized");
  }
  if (bounded.outcome === "idempotency_conflict") {
    throw new ApiHttpError("idempotency_conflict");
  }
  if (bounded.outcome === "idempotency_pending") {
    throw new ApiHttpError("idempotency_pending");
  }
  throw new ApiHttpError("internal_error");
}

// -----------------------------------------------------------------------------
// API-M.8B — Dedicated protected Phase reorder and planning pipelines.
//
// Two additional explicit pipelines. No generic Phase command executor exists:
// each pipeline is bound at authoring time to exactly one accepted API-M.7B
// database wrapper. Sibling-set completeness, ordering rules, stale-row
// semantics, Project membership and the Project planning-window constraint
// remain owned by the canonical database commands.
// -----------------------------------------------------------------------------

/** POST /v1/projects/:projectid/phases/reorder */
export async function executeApiReorderPhasesRoute(
  request: Request,
  rawBody: unknown,
  requestId: string,
  controls: ApiRuntimeControls,
  dependencies: ApiPhaseMutationRouteDependencies,
): Promise<ApiReorderPhasesRouteResult> {
  if (!(request instanceof Request)) {
    throw new ApiHttpError("internal_error");
  }
  if (typeof requestId !== "string" || requestId.trim().length === 0) {
    throw new ApiHttpError("internal_error");
  }

  // 1. Actual route/runtime gate on the real pathname.
  const url = parseMutationUrl(request);
  const route = resolveApiRouteAccess(request.method, url.pathname, controls);
  if (route !== PHASE_REORDER_ROUTE) {
    throw new ApiHttpError("route_not_found");
  }

  validatePhaseMutationDependencies(dependencies);

  // 2. Strict path + closed-schema body validation, before authentication.
  const { projectId } = parseApiV1PhaseReorderPath(url.pathname);
  const body: ApiV1ReorderPhasesBody = parseApiV1ReorderPhasesBody(rawBody);

  // 3. Authentication.
  let authenticated: AuthenticatedApiContext;
  try {
    authenticated = await dependencies.authenticate(request);
  } catch (cause) {
    preserveOrWrap(cause);
  }
  authenticated = validateAuthenticatedContext(authenticated!);

  const activityIdentity: ApiProtectedRouteActivityIdentity = Object.freeze({
    apiClientId: authenticated.client.apiClientId,
    actorUserId: authenticated.token.userId,
  });

  // 4. Route authorization — exactly once.
  try {
    await dependencies.authorizeRoute(authenticated, route);
  } catch (cause) {
    preserveOrWrap(cause);
  }

  // 5. Rate limiting strictly before execution-context construction.
  let profile: ApiRateLimitProfile;
  try {
    profile = await dependencies.resolveRateLimitProfile(authenticated, route);
  } catch (cause) {
    preserveOrWrap(cause);
  }
  await enforceApiRateLimit(
    {
      apiClientId: authenticated.client.apiClientId,
      userId: authenticated.token.userId,
      routeId: route.id,
    },
    profile!,
    dependencies.rateLimit,
  );

  // 6. Canonical API-F execution context. The Project identity lives in the
  // URL, so the hashed canonical payload MUST fold in the validated projectId.
  const executionContext = await buildPhaseExecutionContext(
    request,
    authenticated,
    buildApiV1ReorderPhasesIdempotencyPayload(projectId, body),
    requestId,
  );

  // 7. Exactly one delegated mutation invocation.
  let result: Awaited<ReturnType<DelegatedApiV1ReorderPhasesExecutor>>;
  try {
    result = await dependencies.reorderPhases(
      request,
      authenticated,
      projectId,
      body,
      executionContext,
    );
  } catch (cause) {
    preserveOrWrap(cause);
  }

  // 8. Bounded outcome mapping.
  const bounded = result!;
  if (bounded.ok === true) {
    if (
      bounded.outcome === "applied" ||
      bounded.outcome === "no_change" ||
      bounded.outcome === "replayed"
    ) {
      return Object.freeze({
        route,
        payload: bounded,
        status: 200 as const,
        activityIdentity,
      });
    }
    throw new ApiHttpError("internal_error");
  }

  if (bounded.outcome === "conflict") {
    // Optimistic concurrency only. `stale_phase_order` never leaves this
    // boundary and is never exposed as a new generic HTTP error code.
    throw new ApiHttpError("concurrency_conflict");
  }
  if (bounded.outcome === "invalid") {
    throw new ApiHttpError("invalid_request");
  }
  if (bounded.outcome === "not_authorized") {
    throw new ApiHttpError("not_authorized");
  }
  if (bounded.outcome === "idempotency_conflict") {
    throw new ApiHttpError("idempotency_conflict");
  }
  if (bounded.outcome === "idempotency_pending") {
    throw new ApiHttpError("idempotency_pending");
  }
  throw new ApiHttpError("internal_error");
}

/** PATCH /v1/phases/:phaseid/planning */
export async function executeApiPlanPhaseRoute(
  request: Request,
  rawBody: unknown,
  requestId: string,
  controls: ApiRuntimeControls,
  dependencies: ApiPhaseMutationRouteDependencies,
): Promise<ApiPlanPhaseRouteResult> {
  if (!(request instanceof Request)) {
    throw new ApiHttpError("internal_error");
  }
  if (typeof requestId !== "string" || requestId.trim().length === 0) {
    throw new ApiHttpError("internal_error");
  }

  // 1. Actual route/runtime gate on the real pathname.
  const url = parseMutationUrl(request);
  const route = resolveApiRouteAccess(request.method, url.pathname, controls);
  if (route !== PHASE_PLANNING_ROUTE) {
    throw new ApiHttpError("route_not_found");
  }

  validatePhaseMutationDependencies(dependencies);

  // 2. Strict path + closed-schema body validation, before authentication.
  const { phaseId } = parseApiV1PhasePlanningPath(url.pathname);
  const body: ApiV1PlanPhaseBody = parseApiV1PlanPhaseBody(rawBody);

  // 3. Authentication.
  let authenticated: AuthenticatedApiContext;
  try {
    authenticated = await dependencies.authenticate(request);
  } catch (cause) {
    preserveOrWrap(cause);
  }
  authenticated = validateAuthenticatedContext(authenticated!);

  const activityIdentity: ApiProtectedRouteActivityIdentity = Object.freeze({
    apiClientId: authenticated.client.apiClientId,
    actorUserId: authenticated.token.userId,
  });

  // 4. Route authorization — exactly once.
  try {
    await dependencies.authorizeRoute(authenticated, route);
  } catch (cause) {
    preserveOrWrap(cause);
  }

  // 5. Rate limiting strictly before execution-context construction.
  let profile: ApiRateLimitProfile;
  try {
    profile = await dependencies.resolveRateLimitProfile(authenticated, route);
  } catch (cause) {
    preserveOrWrap(cause);
  }
  await enforceApiRateLimit(
    {
      apiClientId: authenticated.client.apiClientId,
      userId: authenticated.token.userId,
      routeId: route.id,
    },
    profile!,
    dependencies.rateLimit,
  );

  // 6. Canonical API-F execution context. The Phase identity lives in the URL,
  // so the hashed canonical payload MUST fold in the validated path phaseId.
  const executionContext = await buildPhaseExecutionContext(
    request,
    authenticated,
    buildApiV1PlanPhaseIdempotencyPayload(phaseId, body),
    requestId,
  );

  // 7. Exactly one delegated mutation invocation.
  let result: Awaited<ReturnType<DelegatedApiV1PlanPhaseExecutor>>;
  try {
    result = await dependencies.planPhase(
      request,
      authenticated,
      phaseId,
      body,
      executionContext,
    );
  } catch (cause) {
    preserveOrWrap(cause);
  }

  // 8. Bounded outcome mapping.
  const bounded = result!;
  if (bounded.ok === true) {
    if (
      bounded.outcome === "applied" ||
      bounded.outcome === "no_change" ||
      bounded.outcome === "replayed"
    ) {
      return Object.freeze({
        route,
        payload: bounded,
        status: 200 as const,
        activityIdentity,
      });
    }
    throw new ApiHttpError("internal_error");
  }

  if (bounded.outcome === "confirmation_required") {
    // Canonical Project planning-window constraint. Nothing changed; the
    // bounded structural confirmation payload is returned with 409 so the
    // caller can decide explicitly. No preview route exists.
    return Object.freeze({
      route,
      payload: bounded,
      status: 409 as const,
      activityIdentity,
    });
  }
  if (bounded.outcome === "conflict") {
    // Optimistic concurrency only. `stale_phase_planning` never leaves this
    // boundary.
    throw new ApiHttpError("concurrency_conflict");
  }
  if (bounded.outcome === "invalid") {
    throw new ApiHttpError("invalid_request");
  }
  if (bounded.outcome === "not_authorized") {
    throw new ApiHttpError("not_authorized");
  }
  if (bounded.outcome === "idempotency_conflict") {
    throw new ApiHttpError("idempotency_conflict");
  }
  if (bounded.outcome === "idempotency_pending") {
    throw new ApiHttpError("idempotency_pending");
  }
  throw new ApiHttpError("internal_error");
}

// -----------------------------------------------------------------------------
// API-M.11A — Dedicated protected Task mutation execution pipelines.
//
// Exactly two explicit pipelines (create, metadata update). This is a SEPARATE
// narrow contract: the accepted Phase dependency contract is NOT generalized,
// and no command dispatcher, RPC proxy or CRUD engine exists. Tenant /
// Organization / Workspace / Project authority is NOT derived here: the accepted
// API-M.10A database wrappers remain the sole authority for target-derived
// scope, Project Connected App enablement, optimistic concurrency and the
// canonical parent-Phase planning-window constraint.
// -----------------------------------------------------------------------------

/** Narrow Task mutation dependency contract — exactly two executors. */
export interface ApiTaskMutationRouteDependencies {
  authenticate(request: Request): Promise<AuthenticatedApiContext>;
  authorizeRoute(
    context: AuthenticatedApiContext,
    route: ApiRouteDefinition,
  ): Promise<void>;
  resolveRateLimitProfile(
    context: AuthenticatedApiContext,
    route: ApiRouteDefinition,
  ): Promise<ApiRateLimitProfile>;
  rateLimit: ApiRateLimitDependencies;
  /** Caller-scoped delegated `api_v1_create_task` executor. */
  createTask: DelegatedApiV1CreateTaskExecutor;
  /** Caller-scoped delegated `api_v1_update_task` executor. */
  updateTask: DelegatedApiV1UpdateTaskExecutor;
  /** API-M.11B — caller-scoped delegated `api_v1_reorder_tasks` executor. */
  reorderTasks: DelegatedApiV1ReorderTasksExecutor;
  /** API-M.11B — caller-scoped delegated `api_v1_plan_task` executor. */
  planTask: DelegatedApiV1PlanTaskExecutor;
  /** API-M.11C — caller-scoped delegated `api_v1_assign_task` executor. */
  assignTask: DelegatedApiV1AssignTaskExecutor;
  /** API-M.11C — caller-scoped delegated `api_v1_transition_task` executor. */
  transitionTask: DelegatedApiV1TransitionTaskExecutor;
}

export interface ApiCreateTaskRouteResult {
  readonly route: ApiRouteDefinition;
  readonly payload:
    | ApiV1CreateTaskSuccessResult
    | ApiV1CreateTaskConfirmationRequiredResult;
  readonly status: 200 | 201 | 409;
  readonly activityIdentity: ApiProtectedRouteActivityIdentity;
}

export interface ApiUpdateTaskRouteResult {
  readonly route: ApiRouteDefinition;
  readonly payload: ApiV1UpdateTaskSuccessResult;
  readonly status: 200;
  readonly activityIdentity: ApiProtectedRouteActivityIdentity;
}

function validateTaskMutationDependencies(
  deps: unknown,
): asserts deps is ApiTaskMutationRouteDependencies {
  if (!isNonArrayObject(deps)) throw new ApiHttpError("internal_error");
  const d = deps as Record<string, unknown>;
  if (typeof d.authenticate !== "function") {
    throw new ApiHttpError("internal_error");
  }
  if (typeof d.authorizeRoute !== "function") {
    throw new ApiHttpError("internal_error");
  }
  if (typeof d.resolveRateLimitProfile !== "function") {
    throw new ApiHttpError("internal_error");
  }
  if (typeof d.createTask !== "function") {
    throw new ApiHttpError("internal_error");
  }
  if (typeof d.updateTask !== "function") {
    throw new ApiHttpError("internal_error");
  }
  if (typeof d.reorderTasks !== "function") {
    throw new ApiHttpError("internal_error");
  }
  if (typeof d.planTask !== "function") {
    throw new ApiHttpError("internal_error");
  }
  if (typeof d.assignTask !== "function") {
    throw new ApiHttpError("internal_error");
  }
  if (typeof d.transitionTask !== "function") {
    throw new ApiHttpError("internal_error");
  }
  if (!isNonArrayObject(d.rateLimit)) {
    throw new ApiHttpError("internal_error");
  }
}

/** Shared, non-generic execution-context construction for Task mutations. */
async function buildTaskExecutionContext(
  request: Request,
  authenticated: AuthenticatedApiContext,
  canonicalPayload: unknown,
  requestId: string,
): Promise<Awaited<ReturnType<typeof buildExecutionContext>>> {
  try {
    return await buildExecutionContext(
      request,
      authenticated,
      canonicalPayload,
      { randomUUID: () => requestId },
    );
  } catch (cause) {
    if (cause instanceof IdempotencyValidationError) {
      throw new ApiHttpError("invalid_request", cause);
    }
    if (cause instanceof ExecutionContextError) {
      if (cause.code === "invalid_authenticated_context") {
        throw new ApiHttpError("internal_error", cause);
      }
      throw new ApiHttpError("invalid_request", cause);
    }
    if (cause instanceof ApiHttpError) throw cause;
    throw new ApiHttpError("internal_error", cause);
  }
}

/** POST /v1/tasks */
export async function executeApiCreateTaskRoute(
  request: Request,
  rawBody: unknown,
  requestId: string,
  controls: ApiRuntimeControls,
  dependencies: ApiTaskMutationRouteDependencies,
): Promise<ApiCreateTaskRouteResult> {
  if (!(request instanceof Request)) {
    throw new ApiHttpError("internal_error");
  }
  if (typeof requestId !== "string" || requestId.trim().length === 0) {
    throw new ApiHttpError("internal_error");
  }

  // 1. Actual route/runtime gate on the real pathname.
  const url = parseMutationUrl(request);
  const route = resolveApiRouteAccess(request.method, url.pathname, controls);
  if (route !== TASK_CREATE_ROUTE) {
    throw new ApiHttpError("route_not_found");
  }

  validateTaskMutationDependencies(dependencies);

  // 2. Strict closed-schema body validation, before authentication.
  const body: ApiV1CreateTaskBody = parseApiV1CreateTaskBody(rawBody);

  // 3. Authentication.
  let authenticated: AuthenticatedApiContext;
  try {
    authenticated = await dependencies.authenticate(request);
  } catch (cause) {
    preserveOrWrap(cause);
  }
  authenticated = validateAuthenticatedContext(authenticated!);

  const activityIdentity: ApiProtectedRouteActivityIdentity = Object.freeze({
    apiClientId: authenticated.client.apiClientId,
    actorUserId: authenticated.token.userId,
  });

  // 4. Route authorization — exactly once.
  try {
    await dependencies.authorizeRoute(authenticated, route);
  } catch (cause) {
    preserveOrWrap(cause);
  }

  // 5. Rate limiting strictly before execution-context construction.
  let profile: ApiRateLimitProfile;
  try {
    profile = await dependencies.resolveRateLimitProfile(authenticated, route);
  } catch (cause) {
    preserveOrWrap(cause);
  }
  await enforceApiRateLimit(
    {
      apiClientId: authenticated.client.apiClientId,
      userId: authenticated.token.userId,
      routeId: route.id,
    },
    profile!,
    dependencies.rateLimit,
  );

  // 6. Canonical API-F execution context. The create body already carries the
  // target Phase identity, so the normalized body IS the canonical payload.
  const executionContext = await buildTaskExecutionContext(
    request,
    authenticated,
    body,
    requestId,
  );

  // 7. Exactly one delegated mutation invocation.
  let result: Awaited<ReturnType<DelegatedApiV1CreateTaskExecutor>>;
  try {
    result = await dependencies.createTask(
      request,
      authenticated,
      body,
      executionContext,
    );
  } catch (cause) {
    preserveOrWrap(cause);
  }

  // 8. Bounded outcome mapping.
  const bounded = result!;
  if (bounded.ok === true) {
    if (bounded.outcome === "applied") {
      return Object.freeze({
        route,
        payload: bounded,
        status: 201 as const,
        activityIdentity,
      });
    }
    if (bounded.outcome === "replayed") {
      return Object.freeze({
        route,
        payload: bounded,
        status: 200 as const,
        activityIdentity,
      });
    }
    throw new ApiHttpError("internal_error");
  }

  if (bounded.outcome === "confirmation_required") {
    // Canonical parent-Phase planning-window constraint. No Task was created;
    // the bounded structural confirmation payload is returned with 409 so the
    // caller can decide explicitly. No Phase is ever widened here.
    return Object.freeze({
      route,
      payload: bounded,
      status: 409 as const,
      activityIdentity,
    });
  }
  if (bounded.outcome === "invalid") {
    throw new ApiHttpError("invalid_request");
  }
  if (bounded.outcome === "not_authorized") {
    throw new ApiHttpError("not_authorized");
  }
  if (bounded.outcome === "idempotency_conflict") {
    throw new ApiHttpError("idempotency_conflict");
  }
  if (bounded.outcome === "idempotency_pending") {
    throw new ApiHttpError("idempotency_pending");
  }
  throw new ApiHttpError("internal_error");
}

/** PATCH /v1/tasks/:taskid */
export async function executeApiUpdateTaskRoute(
  request: Request,
  rawBody: unknown,
  requestId: string,
  controls: ApiRuntimeControls,
  dependencies: ApiTaskMutationRouteDependencies,
): Promise<ApiUpdateTaskRouteResult> {
  if (!(request instanceof Request)) {
    throw new ApiHttpError("internal_error");
  }
  if (typeof requestId !== "string" || requestId.trim().length === 0) {
    throw new ApiHttpError("internal_error");
  }

  // 1. Actual route/runtime gate on the real pathname.
  const url = parseMutationUrl(request);
  const route = resolveApiRouteAccess(request.method, url.pathname, controls);
  if (route !== TASK_UPDATE_ROUTE) {
    throw new ApiHttpError("route_not_found");
  }

  validateTaskMutationDependencies(dependencies);

  // 2. Strict path + closed-schema body validation, before authentication.
  const { taskId } = parseApiV1TaskUpdatePath(url.pathname);
  const body: ApiV1UpdateTaskBody = parseApiV1UpdateTaskBody(rawBody);

  // 3. Authentication.
  let authenticated: AuthenticatedApiContext;
  try {
    authenticated = await dependencies.authenticate(request);
  } catch (cause) {
    preserveOrWrap(cause);
  }
  authenticated = validateAuthenticatedContext(authenticated!);

  const activityIdentity: ApiProtectedRouteActivityIdentity = Object.freeze({
    apiClientId: authenticated.client.apiClientId,
    actorUserId: authenticated.token.userId,
  });

  // 4. Route authorization — exactly once.
  try {
    await dependencies.authorizeRoute(authenticated, route);
  } catch (cause) {
    preserveOrWrap(cause);
  }

  // 5. Rate limiting strictly before execution-context construction.
  let profile: ApiRateLimitProfile;
  try {
    profile = await dependencies.resolveRateLimitProfile(authenticated, route);
  } catch (cause) {
    preserveOrWrap(cause);
  }
  await enforceApiRateLimit(
    {
      apiClientId: authenticated.client.apiClientId,
      userId: authenticated.token.userId,
      routeId: route.id,
    },
    profile!,
    dependencies.rateLimit,
  );

  // 6. Canonical API-F execution context. The Task identity lives in the URL,
  // so the hashed canonical payload MUST fold in the validated path taskId.
  const executionContext = await buildTaskExecutionContext(
    request,
    authenticated,
    buildApiV1UpdateTaskIdempotencyPayload(taskId, body),
    requestId,
  );

  // 7. Exactly one delegated mutation invocation.
  let result: Awaited<ReturnType<DelegatedApiV1UpdateTaskExecutor>>;
  try {
    result = await dependencies.updateTask(
      request,
      authenticated,
      taskId,
      body,
      executionContext,
    );
  } catch (cause) {
    preserveOrWrap(cause);
  }

  // 8. Bounded outcome mapping.
  const bounded = result!;
  if (bounded.ok === true) {
    if (
      bounded.outcome === "applied" ||
      bounded.outcome === "no_change" ||
      bounded.outcome === "replayed"
    ) {
      return Object.freeze({
        route,
        payload: bounded,
        status: 200 as const,
        activityIdentity,
      });
    }
    throw new ApiHttpError("internal_error");
  }

  if (bounded.outcome === "conflict") {
    // Optimistic concurrency only. `stale_task` never leaves this boundary.
    throw new ApiHttpError("concurrency_conflict");
  }
  if (bounded.outcome === "invalid") {
    throw new ApiHttpError("invalid_request");
  }
  if (bounded.outcome === "not_authorized") {
    throw new ApiHttpError("not_authorized");
  }
  if (bounded.outcome === "idempotency_conflict") {
    throw new ApiHttpError("idempotency_conflict");
  }
  if (bounded.outcome === "idempotency_pending") {
    throw new ApiHttpError("idempotency_pending");
  }
  throw new ApiHttpError("internal_error");
}

// -----------------------------------------------------------------------------
// API-M.11B — Dedicated protected Task reorder and planning pipelines.
//
// Two additional explicit pipelines. No generic Task command executor exists:
// each pipeline is bound at authoring time to exactly one accepted API-M.10B
// database wrapper. Sibling-set completeness, ordering rules, stale-row
// semantics, Phase membership and the Phase planning-window constraint remain
// owned by the canonical database commands.
// -----------------------------------------------------------------------------

export interface ApiReorderTasksRouteResult {
  readonly route: ApiRouteDefinition;
  readonly payload: ApiV1ReorderTasksSuccessResult;
  readonly status: 200;
  readonly activityIdentity: ApiProtectedRouteActivityIdentity;
}

export interface ApiPlanTaskRouteResult {
  readonly route: ApiRouteDefinition;
  readonly payload:
    | ApiV1PlanTaskSuccessResult
    | ApiV1PlanTaskConfirmationRequiredResult;
  readonly status: 200 | 409;
  readonly activityIdentity: ApiProtectedRouteActivityIdentity;
}

/** POST /v1/phases/:phaseid/tasks/reorder */
export async function executeApiReorderTasksRoute(
  request: Request,
  rawBody: unknown,
  requestId: string,
  controls: ApiRuntimeControls,
  dependencies: ApiTaskMutationRouteDependencies,
): Promise<ApiReorderTasksRouteResult> {
  if (!(request instanceof Request)) {
    throw new ApiHttpError("internal_error");
  }
  if (typeof requestId !== "string" || requestId.trim().length === 0) {
    throw new ApiHttpError("internal_error");
  }

  // 1. Actual route/runtime gate on the real pathname.
  const url = parseMutationUrl(request);
  const route = resolveApiRouteAccess(request.method, url.pathname, controls);
  if (route !== TASK_REORDER_ROUTE) {
    throw new ApiHttpError("route_not_found");
  }

  validateTaskMutationDependencies(dependencies);

  // 2. Strict path + closed-schema body validation, before authentication.
  const { phaseId } = parseApiV1TaskReorderPath(url.pathname);
  const body: ApiV1ReorderTasksBody = parseApiV1ReorderTasksBody(rawBody);

  // 3. Authentication.
  let authenticated: AuthenticatedApiContext;
  try {
    authenticated = await dependencies.authenticate(request);
  } catch (cause) {
    preserveOrWrap(cause);
  }
  authenticated = validateAuthenticatedContext(authenticated!);

  const activityIdentity: ApiProtectedRouteActivityIdentity = Object.freeze({
    apiClientId: authenticated.client.apiClientId,
    actorUserId: authenticated.token.userId,
  });

  // 4. Route authorization — exactly once.
  try {
    await dependencies.authorizeRoute(authenticated, route);
  } catch (cause) {
    preserveOrWrap(cause);
  }

  // 5. Rate limiting strictly before execution-context construction.
  let profile: ApiRateLimitProfile;
  try {
    profile = await dependencies.resolveRateLimitProfile(authenticated, route);
  } catch (cause) {
    preserveOrWrap(cause);
  }
  await enforceApiRateLimit(
    {
      apiClientId: authenticated.client.apiClientId,
      userId: authenticated.token.userId,
      routeId: route.id,
    },
    profile!,
    dependencies.rateLimit,
  );

  // 6. Canonical API-F execution context. The target Phase identity lives in the
  // URL, so the hashed canonical payload MUST fold in the validated phaseId.
  const executionContext = await buildTaskExecutionContext(
    request,
    authenticated,
    buildApiV1ReorderTasksIdempotencyPayload(phaseId, body),
    requestId,
  );

  // 7. Exactly one delegated mutation invocation.
  let result: Awaited<ReturnType<DelegatedApiV1ReorderTasksExecutor>>;
  try {
    result = await dependencies.reorderTasks(
      request,
      authenticated,
      phaseId,
      body,
      executionContext,
    );
  } catch (cause) {
    preserveOrWrap(cause);
  }

  // 8. Bounded outcome mapping.
  const bounded = result!;
  if (bounded.ok === true) {
    if (
      bounded.outcome === "applied" ||
      bounded.outcome === "no_change" ||
      bounded.outcome === "replayed"
    ) {
      return Object.freeze({
        route,
        payload: bounded,
        status: 200 as const,
        activityIdentity,
      });
    }
    throw new ApiHttpError("internal_error");
  }

  if (bounded.outcome === "conflict") {
    // Optimistic concurrency only. `stale_task_order` never leaves this
    // boundary and is never exposed as a new generic HTTP error code.
    throw new ApiHttpError("concurrency_conflict");
  }
  if (bounded.outcome === "invalid") {
    throw new ApiHttpError("invalid_request");
  }
  if (bounded.outcome === "not_authorized") {
    throw new ApiHttpError("not_authorized");
  }
  if (bounded.outcome === "idempotency_conflict") {
    throw new ApiHttpError("idempotency_conflict");
  }
  if (bounded.outcome === "idempotency_pending") {
    throw new ApiHttpError("idempotency_pending");
  }
  throw new ApiHttpError("internal_error");
}

/** PATCH /v1/tasks/:taskid/planning */
export async function executeApiPlanTaskRoute(
  request: Request,
  rawBody: unknown,
  requestId: string,
  controls: ApiRuntimeControls,
  dependencies: ApiTaskMutationRouteDependencies,
): Promise<ApiPlanTaskRouteResult> {
  if (!(request instanceof Request)) {
    throw new ApiHttpError("internal_error");
  }
  if (typeof requestId !== "string" || requestId.trim().length === 0) {
    throw new ApiHttpError("internal_error");
  }

  // 1. Actual route/runtime gate on the real pathname.
  const url = parseMutationUrl(request);
  const route = resolveApiRouteAccess(request.method, url.pathname, controls);
  if (route !== TASK_PLANNING_ROUTE) {
    throw new ApiHttpError("route_not_found");
  }

  validateTaskMutationDependencies(dependencies);

  // 2. Strict path + closed-schema body validation, before authentication.
  const { taskId } = parseApiV1TaskPlanningPath(url.pathname);
  const body: ApiV1PlanTaskBody = parseApiV1PlanTaskBody(rawBody);

  // 3. Authentication.
  let authenticated: AuthenticatedApiContext;
  try {
    authenticated = await dependencies.authenticate(request);
  } catch (cause) {
    preserveOrWrap(cause);
  }
  authenticated = validateAuthenticatedContext(authenticated!);

  const activityIdentity: ApiProtectedRouteActivityIdentity = Object.freeze({
    apiClientId: authenticated.client.apiClientId,
    actorUserId: authenticated.token.userId,
  });

  // 4. Route authorization — exactly once.
  try {
    await dependencies.authorizeRoute(authenticated, route);
  } catch (cause) {
    preserveOrWrap(cause);
  }

  // 5. Rate limiting strictly before execution-context construction.
  let profile: ApiRateLimitProfile;
  try {
    profile = await dependencies.resolveRateLimitProfile(authenticated, route);
  } catch (cause) {
    preserveOrWrap(cause);
  }
  await enforceApiRateLimit(
    {
      apiClientId: authenticated.client.apiClientId,
      userId: authenticated.token.userId,
      routeId: route.id,
    },
    profile!,
    dependencies.rateLimit,
  );

  // 6. Canonical API-F execution context. The Task identity lives in the URL,
  // so the hashed canonical payload MUST fold in the validated path taskId.
  const executionContext = await buildTaskExecutionContext(
    request,
    authenticated,
    buildApiV1PlanTaskIdempotencyPayload(taskId, body),
    requestId,
  );

  // 7. Exactly one delegated mutation invocation.
  let result: Awaited<ReturnType<DelegatedApiV1PlanTaskExecutor>>;
  try {
    result = await dependencies.planTask(
      request,
      authenticated,
      taskId,
      body,
      executionContext,
    );
  } catch (cause) {
    preserveOrWrap(cause);
  }

  // 8. Bounded outcome mapping.
  const bounded = result!;
  if (bounded.ok === true) {
    if (
      bounded.outcome === "applied" ||
      bounded.outcome === "no_change" ||
      bounded.outcome === "replayed"
    ) {
      return Object.freeze({
        route,
        payload: bounded,
        status: 200 as const,
        activityIdentity,
      });
    }
    throw new ApiHttpError("internal_error");
  }

  if (bounded.outcome === "confirmation_required") {
    // Canonical parent-Phase planning-window constraint. Nothing changed; the
    // bounded structural confirmation payload is returned with 409 so the
    // caller can decide explicitly. No preview route exists.
    return Object.freeze({
      route,
      payload: bounded,
      status: 409 as const,
      activityIdentity,
    });
  }
  if (bounded.outcome === "conflict") {
    // Optimistic concurrency only. `stale_task_planning` never leaves this
    // boundary.
    throw new ApiHttpError("concurrency_conflict");
  }
  if (bounded.outcome === "invalid") {
    throw new ApiHttpError("invalid_request");
  }
  if (bounded.outcome === "not_authorized") {
    throw new ApiHttpError("not_authorized");
  }
  if (bounded.outcome === "idempotency_conflict") {
    throw new ApiHttpError("idempotency_conflict");
  }
  if (bounded.outcome === "idempotency_pending") {
    throw new ApiHttpError("idempotency_pending");
  }
  throw new ApiHttpError("internal_error");
}

// -----------------------------------------------------------------------------
// API-M.11C — Dedicated protected Task assignment and execution-transition
// pipelines. The final two Task pipelines. Each is bound at authoring time to
// exactly one accepted API-M.10B database wrapper; no generic Task command
// executor, action dispatcher or caller-selected RPC exists anywhere.
//
// Workspace-membership assignment eligibility, actual-date business rules,
// completed-task locking, reopen requirements, Phase/Project rollups, execution
// history and lifecycle protections remain owned by the canonical commands.
// -----------------------------------------------------------------------------

export interface ApiAssignTaskRouteResult {
  readonly route: ApiRouteDefinition;
  readonly payload: ApiV1AssignTaskSuccessResult;
  readonly status: 200;
  readonly activityIdentity: ApiProtectedRouteActivityIdentity;
}

export interface ApiTransitionTaskRouteResult {
  readonly route: ApiRouteDefinition;
  readonly payload: ApiV1TransitionTaskSuccessResult;
  readonly status: 200;
  readonly activityIdentity: ApiProtectedRouteActivityIdentity;
}

/** PUT /v1/tasks/:taskid/assignee */
export async function executeApiAssignTaskRoute(
  request: Request,
  rawBody: unknown,
  requestId: string,
  controls: ApiRuntimeControls,
  dependencies: ApiTaskMutationRouteDependencies,
): Promise<ApiAssignTaskRouteResult> {
  if (!(request instanceof Request)) {
    throw new ApiHttpError("internal_error");
  }
  if (typeof requestId !== "string" || requestId.trim().length === 0) {
    throw new ApiHttpError("internal_error");
  }

  // 1. Actual route/runtime gate on the real pathname.
  const url = parseMutationUrl(request);
  const route = resolveApiRouteAccess(request.method, url.pathname, controls);
  if (route !== TASK_ASSIGN_ROUTE) {
    throw new ApiHttpError("route_not_found");
  }

  validateTaskMutationDependencies(dependencies);

  // 2. Strict path + closed-schema body validation, before authentication.
  const { taskId } = parseApiV1TaskAssignPath(url.pathname);
  const body: ApiV1AssignTaskBody = parseApiV1AssignTaskBody(rawBody);

  // 3. Authentication.
  let authenticated: AuthenticatedApiContext;
  try {
    authenticated = await dependencies.authenticate(request);
  } catch (cause) {
    preserveOrWrap(cause);
  }
  authenticated = validateAuthenticatedContext(authenticated!);

  const activityIdentity: ApiProtectedRouteActivityIdentity = Object.freeze({
    apiClientId: authenticated.client.apiClientId,
    actorUserId: authenticated.token.userId,
  });

  // 4. Route authorization — exactly once.
  try {
    await dependencies.authorizeRoute(authenticated, route);
  } catch (cause) {
    preserveOrWrap(cause);
  }

  // 5. Rate limiting strictly before execution-context construction.
  let profile: ApiRateLimitProfile;
  try {
    profile = await dependencies.resolveRateLimitProfile(authenticated, route);
  } catch (cause) {
    preserveOrWrap(cause);
  }
  await enforceApiRateLimit(
    {
      apiClientId: authenticated.client.apiClientId,
      userId: authenticated.token.userId,
      routeId: route.id,
    },
    profile!,
    dependencies.rateLimit,
  );

  // 6. Canonical API-F execution context. The Task identity lives in the URL,
  // so the hashed canonical payload MUST fold in the validated path taskId.
  const executionContext = await buildTaskExecutionContext(
    request,
    authenticated,
    buildApiV1AssignTaskIdempotencyPayload(taskId, body),
    requestId,
  );

  // 7. Exactly one delegated mutation invocation.
  let result: Awaited<ReturnType<DelegatedApiV1AssignTaskExecutor>>;
  try {
    result = await dependencies.assignTask(
      request,
      authenticated,
      taskId,
      body,
      executionContext,
    );
  } catch (cause) {
    preserveOrWrap(cause);
  }

  // 8. Bounded outcome mapping. Assignment has no concurrency token, therefore
  // no conflict outcome exists on this route.
  const bounded = result!;
  if (bounded.ok === true) {
    if (
      bounded.outcome === "applied" ||
      bounded.outcome === "no_change" ||
      bounded.outcome === "replayed"
    ) {
      return Object.freeze({
        route,
        payload: bounded,
        status: 200 as const,
        activityIdentity,
      });
    }
    throw new ApiHttpError("internal_error");
  }

  if (bounded.outcome === "invalid") {
    throw new ApiHttpError("invalid_request");
  }
  if (bounded.outcome === "not_authorized") {
    throw new ApiHttpError("not_authorized");
  }
  if (bounded.outcome === "idempotency_conflict") {
    throw new ApiHttpError("idempotency_conflict");
  }
  if (bounded.outcome === "idempotency_pending") {
    throw new ApiHttpError("idempotency_pending");
  }
  throw new ApiHttpError("internal_error");
}

/** POST /v1/tasks/:taskid/transition */
export async function executeApiTransitionTaskRoute(
  request: Request,
  rawBody: unknown,
  requestId: string,
  controls: ApiRuntimeControls,
  dependencies: ApiTaskMutationRouteDependencies,
): Promise<ApiTransitionTaskRouteResult> {
  if (!(request instanceof Request)) {
    throw new ApiHttpError("internal_error");
  }
  if (typeof requestId !== "string" || requestId.trim().length === 0) {
    throw new ApiHttpError("internal_error");
  }

  // 1. Actual route/runtime gate on the real pathname.
  const url = parseMutationUrl(request);
  const route = resolveApiRouteAccess(request.method, url.pathname, controls);
  if (route !== TASK_TRANSITION_ROUTE) {
    throw new ApiHttpError("route_not_found");
  }

  validateTaskMutationDependencies(dependencies);

  // 2. Strict path + closed-schema body validation, before authentication.
  const { taskId } = parseApiV1TaskTransitionPath(url.pathname);
  const body: ApiV1TransitionTaskBody = parseApiV1TransitionTaskBody(rawBody);

  // 3. Authentication.
  let authenticated: AuthenticatedApiContext;
  try {
    authenticated = await dependencies.authenticate(request);
  } catch (cause) {
    preserveOrWrap(cause);
  }
  authenticated = validateAuthenticatedContext(authenticated!);

  const activityIdentity: ApiProtectedRouteActivityIdentity = Object.freeze({
    apiClientId: authenticated.client.apiClientId,
    actorUserId: authenticated.token.userId,
  });

  // 4. Route authorization — exactly once.
  try {
    await dependencies.authorizeRoute(authenticated, route);
  } catch (cause) {
    preserveOrWrap(cause);
  }

  // 5. Rate limiting strictly before execution-context construction.
  let profile: ApiRateLimitProfile;
  try {
    profile = await dependencies.resolveRateLimitProfile(authenticated, route);
  } catch (cause) {
    preserveOrWrap(cause);
  }
  await enforceApiRateLimit(
    {
      apiClientId: authenticated.client.apiClientId,
      userId: authenticated.token.userId,
      routeId: route.id,
    },
    profile!,
    dependencies.rateLimit,
  );

  // 6. Canonical API-F execution context. The Task identity lives in the URL,
  // so the hashed canonical payload MUST fold in the validated path taskId.
  const executionContext = await buildTaskExecutionContext(
    request,
    authenticated,
    buildApiV1TransitionTaskIdempotencyPayload(taskId, body),
    requestId,
  );

  // 7. Exactly one delegated mutation invocation.
  let result: Awaited<ReturnType<DelegatedApiV1TransitionTaskExecutor>>;
  try {
    result = await dependencies.transitionTask(
      request,
      authenticated,
      taskId,
      body,
      executionContext,
    );
  } catch (cause) {
    preserveOrWrap(cause);
  }

  // 8. Bounded outcome mapping.
  const bounded = result!;
  if (bounded.ok === true) {
    if (
      bounded.outcome === "applied" ||
      bounded.outcome === "no_change" ||
      bounded.outcome === "replayed"
    ) {
      return Object.freeze({
        route,
        payload: bounded,
        status: 200 as const,
        activityIdentity,
      });
    }
    throw new ApiHttpError("internal_error");
  }

  if (bounded.outcome === "conflict") {
    // Optimistic concurrency only. `stale_task` never leaves this boundary.
    throw new ApiHttpError("concurrency_conflict");
  }
  if (bounded.outcome === "invalid") {
    throw new ApiHttpError("invalid_request");
  }
  if (bounded.outcome === "not_authorized") {
    throw new ApiHttpError("not_authorized");
  }
  if (bounded.outcome === "idempotency_conflict") {
    throw new ApiHttpError("idempotency_conflict");
  }
  if (bounded.outcome === "idempotency_pending") {
    throw new ApiHttpError("idempotency_pending");
  }
  throw new ApiHttpError("internal_error");
}


// =============================================================================
// API-N.5 — POST /v1/projects (projects:create)
//
// Exactly one new dedicated mutation executor. No generic mutation dispatcher,
// no shared body/route table, no Project Connected App enablement write.
// =============================================================================

export interface ApiProjectMutationRouteDependencies {
  authenticate(request: Request): Promise<AuthenticatedApiContext>;
  authorizeRoute(
    context: AuthenticatedApiContext,
    route: ApiRouteDefinition,
  ): Promise<void>;
  resolveRateLimitProfile(
    context: AuthenticatedApiContext,
    route: ApiRouteDefinition,
  ): Promise<ApiRateLimitProfile>;
  rateLimit: ApiRateLimitDependencies;
  /** Caller-scoped delegated `api_v1_create_project` executor. */
  createProject: DelegatedApiV1CreateProjectExecutor;
  /** Caller-scoped delegated `api_v1_update_project` executor. */
  updateProject: DelegatedApiV1UpdateProjectExecutor;
  /** Caller-scoped delegated `api_v1_transition_project` executor. */
  transitionProject: DelegatedApiV1TransitionProjectExecutor;
}

export interface ApiCreateProjectRouteResult {
  readonly route: ApiRouteDefinition;
  readonly payload: ApiV1CreateProjectSuccessResult;
  readonly status: 200 | 201;
  readonly activityIdentity: ApiProtectedRouteActivityIdentity;
}

function validateProjectMutationDependencies(
  deps: unknown,
): asserts deps is ApiProjectMutationRouteDependencies {
  if (!isNonArrayObject(deps)) throw new ApiHttpError("internal_error");
  const d = deps as Record<string, unknown>;
  if (typeof d.authenticate !== "function") {
    throw new ApiHttpError("internal_error");
  }
  if (typeof d.authorizeRoute !== "function") {
    throw new ApiHttpError("internal_error");
  }
  if (typeof d.resolveRateLimitProfile !== "function") {
    throw new ApiHttpError("internal_error");
  }
  if (typeof d.createProject !== "function") {
    throw new ApiHttpError("internal_error");
  }
  if (!isNonArrayObject(d.rateLimit)) {
    throw new ApiHttpError("internal_error");
  }
}

/** POST /v1/projects */
export async function executeApiCreateProjectRoute(
  request: Request,
  rawBody: unknown,
  requestId: string,
  controls: ApiRuntimeControls,
  dependencies: ApiProjectMutationRouteDependencies,
): Promise<ApiCreateProjectRouteResult> {
  if (!(request instanceof Request)) {
    throw new ApiHttpError("internal_error");
  }
  if (typeof requestId !== "string" || requestId.trim().length === 0) {
    throw new ApiHttpError("internal_error");
  }

  // 1. Actual route/runtime gate on the real pathname.
  const url = parseMutationUrl(request);
  const route = resolveApiRouteAccess(request.method, url.pathname, controls);
  if (route !== PROJECT_CREATE_ROUTE) {
    throw new ApiHttpError("route_not_found");
  }

  validateProjectMutationDependencies(dependencies);

  // 2. Strict closed-schema body validation, before authentication.
  const body: ApiV1CreateProjectBody = parseApiV1CreateProjectBody(rawBody);

  // 3. Authentication.
  let authenticated: AuthenticatedApiContext;
  try {
    authenticated = await dependencies.authenticate(request);
  } catch (cause) {
    preserveOrWrap(cause);
  }
  authenticated = validateAuthenticatedContext(authenticated!);

  const activityIdentity: ApiProtectedRouteActivityIdentity = Object.freeze({
    apiClientId: authenticated.client.apiClientId,
    actorUserId: authenticated.token.userId,
  });

  // 4. Route authorization — exactly once.
  try {
    await dependencies.authorizeRoute(authenticated, route);
  } catch (cause) {
    preserveOrWrap(cause);
  }

  // 5. Rate limiting strictly before execution-context construction.
  let profile: ApiRateLimitProfile;
  try {
    profile = await dependencies.resolveRateLimitProfile(authenticated, route);
  } catch (cause) {
    preserveOrWrap(cause);
  }
  await enforceApiRateLimit(
    {
      apiClientId: authenticated.client.apiClientId,
      userId: authenticated.token.userId,
      routeId: route.id,
    },
    profile!,
    dependencies.rateLimit,
  );

  // 6. Canonical API-F execution context. The normalized create body already
  // carries the full target identity, so it IS the canonical payload.
  const executionContext = await buildPhaseExecutionContext(
    request,
    authenticated,
    body,
    requestId,
  );

  // 7. Exactly one delegated mutation invocation.
  let result: Awaited<ReturnType<DelegatedApiV1CreateProjectExecutor>>;
  try {
    result = await dependencies.createProject(
      request,
      authenticated,
      body,
      executionContext,
    );
  } catch (cause) {
    preserveOrWrap(cause);
  }

  // 8. Bounded outcome mapping. Nothing beyond the new Project identifier is
  // ever returned, and no Project read is performed here.
  const bounded = result!;
  if (bounded.ok === true) {
    if (bounded.outcome === "applied") {
      return Object.freeze({
        route,
        payload: bounded,
        status: 201 as const,
        activityIdentity,
      });
    }
    if (bounded.outcome === "replayed") {
      return Object.freeze({
        route,
        payload: bounded,
        status: 200 as const,
        activityIdentity,
      });
    }
    throw new ApiHttpError("internal_error");
  }

  if (bounded.outcome === "invalid") {
    throw new ApiHttpError("invalid_request");
  }
  if (bounded.outcome === "not_authorized") {
    throw new ApiHttpError("not_authorized");
  }
  if (bounded.outcome === "idempotency_conflict") {
    throw new ApiHttpError("idempotency_conflict");
  }
  if (bounded.outcome === "idempotency_pending") {
    throw new ApiHttpError("idempotency_pending");
  }
  throw new ApiHttpError("internal_error");
}

// =============================================================================
// API-N.6 — PATCH /v1/projects/{projectId} (projects:update)
//
// Exactly one new dedicated mutation executor. No generic Project dispatcher,
// no shared body table, no Project Connected App enablement write, and no
// planning/status/stage/archive/Agile surface.
// =============================================================================

export interface ApiUpdateProjectRouteResult {
  readonly route: ApiRouteDefinition;
  readonly payload: ApiV1UpdateProjectSuccessResult;
  readonly status: 200;
  readonly activityIdentity: ApiProtectedRouteActivityIdentity;
}

/** PATCH /v1/projects/<non-nil UUID> */
export async function executeApiUpdateProjectRoute(
  request: Request,
  rawBody: unknown,
  requestId: string,
  controls: ApiRuntimeControls,
  dependencies: ApiProjectMutationRouteDependencies,
): Promise<ApiUpdateProjectRouteResult> {
  if (!(request instanceof Request)) {
    throw new ApiHttpError("internal_error");
  }
  if (typeof requestId !== "string" || requestId.trim().length === 0) {
    throw new ApiHttpError("internal_error");
  }

  // 1. Actual route/runtime gate on the real pathname.
  const url = parseMutationUrl(request);
  const route = resolveApiRouteAccess(request.method, url.pathname, controls);
  if (route !== PROJECT_UPDATE_ROUTE) {
    throw new ApiHttpError("route_not_found");
  }

  validateProjectMutationDependencies(dependencies);
  if (typeof dependencies.updateProject !== "function") {
    throw new ApiHttpError("internal_error");
  }

  // 2. Strict path + closed-schema body validation, before authentication.
  const { projectId } = parseApiV1ProjectUpdatePath(url.pathname);
  const body: ApiV1UpdateProjectBody = parseApiV1UpdateProjectBody(rawBody);

  // 3. Authentication.
  let authenticated: AuthenticatedApiContext;
  try {
    authenticated = await dependencies.authenticate(request);
  } catch (cause) {
    preserveOrWrap(cause);
  }
  authenticated = validateAuthenticatedContext(authenticated!);

  const activityIdentity: ApiProtectedRouteActivityIdentity = Object.freeze({
    apiClientId: authenticated.client.apiClientId,
    actorUserId: authenticated.token.userId,
  });

  // 4. Route authorization — exactly once.
  try {
    await dependencies.authorizeRoute(authenticated, route);
  } catch (cause) {
    preserveOrWrap(cause);
  }

  // 5. Rate limiting strictly before execution-context construction.
  let profile: ApiRateLimitProfile;
  try {
    profile = await dependencies.resolveRateLimitProfile(authenticated, route);
  } catch (cause) {
    preserveOrWrap(cause);
  }
  await enforceApiRateLimit(
    {
      apiClientId: authenticated.client.apiClientId,
      userId: authenticated.token.userId,
      routeId: route.id,
    },
    profile!,
    dependencies.rateLimit,
  );

  // 6. Canonical API-F execution context. The Project identity lives in the
  // URL, so the hashed canonical payload folds in the validated path projectId
  // together with every presence flag and normalized value.
  const executionContext = await buildPhaseExecutionContext(
    request,
    authenticated,
    buildApiV1UpdateProjectIdempotencyPayload(projectId, body),
    requestId,
  );

  // 7. Exactly one delegated mutation invocation.
  let result: Awaited<ReturnType<DelegatedApiV1UpdateProjectExecutor>>;
  try {
    result = await dependencies.updateProject(
      request,
      authenticated,
      projectId,
      body,
      executionContext,
    );
  } catch (cause) {
    preserveOrWrap(cause);
  }

  // 8. Bounded outcome mapping. No Project narrative, name or encryption
  // metadata can ever leave this boundary.
  const bounded = result!;
  if (bounded.ok === true) {
    if (
      bounded.outcome === "applied" ||
      bounded.outcome === "no_change" ||
      bounded.outcome === "replayed"
    ) {
      return Object.freeze({
        route,
        payload: bounded,
        status: 200 as const,
        activityIdentity,
      });
    }
    throw new ApiHttpError("internal_error");
  }

  if (bounded.outcome === "conflict") {
    // Optimistic concurrency only. `stale_project` never leaves this boundary.
    throw new ApiHttpError("concurrency_conflict");
  }
  if (bounded.outcome === "invalid") {
    throw new ApiHttpError("invalid_request");
  }
  if (bounded.outcome === "not_authorized") {
    throw new ApiHttpError("not_authorized");
  }
  if (bounded.outcome === "idempotency_conflict") {
    throw new ApiHttpError("idempotency_conflict");
  }
  if (bounded.outcome === "idempotency_pending") {
    throw new ApiHttpError("idempotency_pending");
  }
  throw new ApiHttpError("internal_error");
}

// =============================================================================
// API-N.7 — POST /v1/projects/{projectId}/transition (projects:transition)
//
// Exactly one new dedicated mutation executor. No generic Project dispatcher,
// no shared body table, no Project Connected App enablement write, and no
// transition/completion business rule reproduced at the edge.
// =============================================================================

export interface ApiTransitionProjectRouteResult {
  readonly route: ApiRouteDefinition;
  readonly payload:
    | ApiV1TransitionProjectSuccessResult
    | ApiV1TransitionProjectBlockedResult
    | ApiV1TransitionProjectConfirmationResult;
  readonly status: 200 | 409;
  readonly activityIdentity: ApiProtectedRouteActivityIdentity;
}

/** POST /v1/projects/<non-nil UUID>/transition */
export async function executeApiTransitionProjectRoute(
  request: Request,
  rawBody: unknown,
  requestId: string,
  controls: ApiRuntimeControls,
  dependencies: ApiProjectMutationRouteDependencies,
): Promise<ApiTransitionProjectRouteResult> {
  if (!(request instanceof Request)) {
    throw new ApiHttpError("internal_error");
  }
  if (typeof requestId !== "string" || requestId.trim().length === 0) {
    throw new ApiHttpError("internal_error");
  }

  // 1. Actual route/runtime gate on the real pathname.
  const url = parseMutationUrl(request);
  const route = resolveApiRouteAccess(request.method, url.pathname, controls);
  if (route !== PROJECT_TRANSITION_ROUTE) {
    throw new ApiHttpError("route_not_found");
  }

  validateProjectMutationDependencies(dependencies);
  if (typeof dependencies.transitionProject !== "function") {
    throw new ApiHttpError("internal_error");
  }

  // 2. Strict path + closed-schema body validation, before authentication.
  const { projectId } = parseApiV1ProjectTransitionPath(url.pathname);
  const body: ApiV1TransitionProjectBody = parseApiV1TransitionProjectBody(
    rawBody,
  );

  // 3. Authentication.
  let authenticated: AuthenticatedApiContext;
  try {
    authenticated = await dependencies.authenticate(request);
  } catch (cause) {
    preserveOrWrap(cause);
  }
  authenticated = validateAuthenticatedContext(authenticated!);

  const activityIdentity: ApiProtectedRouteActivityIdentity = Object.freeze({
    apiClientId: authenticated.client.apiClientId,
    actorUserId: authenticated.token.userId,
  });

  // 4. Route authorization — exactly once.
  try {
    await dependencies.authorizeRoute(authenticated, route);
  } catch (cause) {
    preserveOrWrap(cause);
  }

  // 5. Rate limiting strictly before execution-context construction.
  let profile: ApiRateLimitProfile;
  try {
    profile = await dependencies.resolveRateLimitProfile(authenticated, route);
  } catch (cause) {
    preserveOrWrap(cause);
  }
  await enforceApiRateLimit(
    {
      apiClientId: authenticated.client.apiClientId,
      userId: authenticated.token.userId,
      routeId: route.id,
    },
    profile!,
    dependencies.rateLimit,
  );

  // 6. Canonical API-F execution context. The Project identity lives in the
  // URL, so the hashed canonical payload folds in the validated path projectId
  // together with the target status and the explicit confirmation flag.
  const executionContext = await buildPhaseExecutionContext(
    request,
    authenticated,
    buildApiV1TransitionProjectIdempotencyPayload(projectId, body),
    requestId,
  );

  // 7. Exactly one delegated mutation invocation.
  let result: Awaited<ReturnType<DelegatedApiV1TransitionProjectExecutor>>;
  try {
    result = await dependencies.transitionProject(
      request,
      authenticated,
      projectId,
      body,
      executionContext,
    );
  } catch (cause) {
    preserveOrWrap(cause);
  }

  // 8. Bounded outcome mapping. No Project narrative, name or encryption
  // metadata can ever leave this boundary.
  const bounded = result!;
  if (bounded.ok === true) {
    if (
      bounded.outcome === "applied" ||
      bounded.outcome === "no_change" ||
      bounded.outcome === "replayed"
    ) {
      return Object.freeze({
        route,
        payload: bounded,
        status: 200 as const,
        activityIdentity,
      });
    }
    throw new ApiHttpError("internal_error");
  }

  if (bounded.outcome === "blocked" ||
    bounded.outcome === "confirmation_required"
  ) {
    // Canonical completion validation. Nothing was transitioned; the bounded
    // structural completion payload is returned with 409 so the caller can
    // decide explicitly. No warning is ever auto-confirmed here.
    return Object.freeze({
      route,
      payload: bounded,
      status: 409 as const,
      activityIdentity,
    });
  }
  if (bounded.outcome === "conflict") {
    // Optimistic concurrency only. `stale_project` never leaves this boundary.
    throw new ApiHttpError("concurrency_conflict");
  }
  if (bounded.outcome === "invalid") {
    throw new ApiHttpError("invalid_request");
  }
  if (bounded.outcome === "not_authorized") {
    throw new ApiHttpError("not_authorized");
  }
  if (bounded.outcome === "idempotency_conflict") {
    throw new ApiHttpError("idempotency_conflict");
  }
  if (bounded.outcome === "idempotency_pending") {
    throw new ApiHttpError("idempotency_pending");
  }
  throw new ApiHttpError("internal_error");
}

// =============================================================================
// API-N.9A — POST /v1/programs (programs:create)
//
// Exactly one new dedicated mutation executor. No generic mutation dispatcher,
// no shared body/route table, no Program Connected App enablement write, and no
// Program read is ever performed here.
// =============================================================================

export interface ApiProgramMutationRouteDependencies {
  authenticate(request: Request): Promise<AuthenticatedApiContext>;
  authorizeRoute(
    context: AuthenticatedApiContext,
    route: ApiRouteDefinition,
  ): Promise<void>;
  resolveRateLimitProfile(
    context: AuthenticatedApiContext,
    route: ApiRouteDefinition,
  ): Promise<ApiRateLimitProfile>;
  rateLimit: ApiRateLimitDependencies;
  /** Caller-scoped delegated `api_v1_create_program` executor. */
  createProgram: DelegatedApiV1CreateProgramExecutor;
  /** Caller-scoped delegated `api_v1_update_program` executor. */
  updateProgram: DelegatedApiV1UpdateProgramExecutor;
}

export interface ApiCreateProgramRouteResult {
  readonly route: ApiRouteDefinition;
  readonly payload: ApiV1CreateProgramSuccessResult;
  readonly status: 200 | 201;
  readonly activityIdentity: ApiProtectedRouteActivityIdentity;
}

function validateProgramMutationDependencies(
  deps: unknown,
): asserts deps is ApiProgramMutationRouteDependencies {
  if (!isNonArrayObject(deps)) throw new ApiHttpError("internal_error");
  const d = deps as Record<string, unknown>;
  if (typeof d.authenticate !== "function") {
    throw new ApiHttpError("internal_error");
  }
  if (typeof d.authorizeRoute !== "function") {
    throw new ApiHttpError("internal_error");
  }
  if (typeof d.resolveRateLimitProfile !== "function") {
    throw new ApiHttpError("internal_error");
  }
  if (typeof d.createProgram !== "function") {
    throw new ApiHttpError("internal_error");
  }
  if (typeof d.updateProgram !== "function") {
    throw new ApiHttpError("internal_error");
  }
  if (!isNonArrayObject(d.rateLimit)) {
    throw new ApiHttpError("internal_error");
  }
}

/** POST /v1/programs */
export async function executeApiCreateProgramRoute(
  request: Request,
  rawBody: unknown,
  requestId: string,
  controls: ApiRuntimeControls,
  dependencies: ApiProgramMutationRouteDependencies,
): Promise<ApiCreateProgramRouteResult> {
  if (!(request instanceof Request)) {
    throw new ApiHttpError("internal_error");
  }
  if (typeof requestId !== "string" || requestId.trim().length === 0) {
    throw new ApiHttpError("internal_error");
  }

  // 1. Actual route/runtime gate on the real pathname.
  const url = parseMutationUrl(request);
  const route = resolveApiRouteAccess(request.method, url.pathname, controls);
  if (route !== PROGRAM_CREATE_ROUTE) {
    throw new ApiHttpError("route_not_found");
  }

  validateProgramMutationDependencies(dependencies);

  // 2. Strict closed-schema body validation, before authentication.
  const body: ApiV1CreateProgramBody = parseApiV1CreateProgramBody(rawBody);

  // 3. Authentication.
  let authenticated: AuthenticatedApiContext;
  try {
    authenticated = await dependencies.authenticate(request);
  } catch (cause) {
    preserveOrWrap(cause);
  }
  authenticated = validateAuthenticatedContext(authenticated!);

  const activityIdentity: ApiProtectedRouteActivityIdentity = Object.freeze({
    apiClientId: authenticated.client.apiClientId,
    actorUserId: authenticated.token.userId,
  });

  // 4. Route authorization — exactly once.
  try {
    await dependencies.authorizeRoute(authenticated, route);
  } catch (cause) {
    preserveOrWrap(cause);
  }

  // 5. Rate limiting strictly before execution-context construction.
  let profile: ApiRateLimitProfile;
  try {
    profile = await dependencies.resolveRateLimitProfile(authenticated, route);
  } catch (cause) {
    preserveOrWrap(cause);
  }
  await enforceApiRateLimit(
    {
      apiClientId: authenticated.client.apiClientId,
      userId: authenticated.token.userId,
      routeId: route.id,
    },
    profile!,
    dependencies.rateLimit,
  );

  // 6. Canonical API-F execution context. The normalized create body already
  // carries the full target identity, so it IS the canonical payload.
  const executionContext = await buildPhaseExecutionContext(
    request,
    authenticated,
    body,
    requestId,
  );

  // 7. Exactly one delegated mutation invocation.
  let result: Awaited<ReturnType<DelegatedApiV1CreateProgramExecutor>>;
  try {
    result = await dependencies.createProgram(
      request,
      authenticated,
      body,
      executionContext,
    );
  } catch (cause) {
    preserveOrWrap(cause);
  }

  // 8. Bounded outcome mapping. Nothing beyond the new Program identifier is
  // ever returned.
  const bounded = result!;
  if (bounded.ok === true) {
    if (bounded.outcome === "applied") {
      return Object.freeze({
        route,
        payload: bounded,
        status: 201 as const,
        activityIdentity,
      });
    }
    if (bounded.outcome === "replayed") {
      return Object.freeze({
        route,
        payload: bounded,
        status: 200 as const,
        activityIdentity,
      });
    }
    throw new ApiHttpError("internal_error");
  }

  if (bounded.outcome === "invalid") {
    throw new ApiHttpError("invalid_request");
  }
  if (bounded.outcome === "not_authorized") {
    throw new ApiHttpError("not_authorized");
  }
  if (bounded.outcome === "idempotency_conflict") {
    throw new ApiHttpError("idempotency_conflict");
  }
  if (bounded.outcome === "idempotency_pending") {
    throw new ApiHttpError("idempotency_pending");
  }
  throw new ApiHttpError("internal_error");
}

// =============================================================================
// API-N.9B — PATCH /v1/programs/{programId} (programs:update)
//
// Exactly one new dedicated mutation executor. No generic mutation dispatcher,
// no shared body/route table, no Connected App enablement write, and no Program
// read is ever performed here. The database wrapper remains the sole authority
// for Organization/Workspace derivation, capability enforcement, idempotency and
// optimistic concurrency.
// =============================================================================

// The Program mutation family shares exactly one dependency contract
// (`ApiProgramMutationRouteDependencies`) while keeping create and update as
// separate explicit executors.

export interface ApiUpdateProgramRouteResult {
  readonly route: ApiRouteDefinition;
  readonly payload: ApiV1UpdateProgramSuccessResult;
  readonly status: 200;
  readonly activityIdentity: ApiProtectedRouteActivityIdentity;
}

/** PATCH /v1/programs/{programId} */
export async function executeApiUpdateProgramRoute(
  request: Request,
  rawBody: unknown,
  requestId: string,
  controls: ApiRuntimeControls,
  dependencies: ApiProgramMutationRouteDependencies,
): Promise<ApiUpdateProgramRouteResult> {
  if (!(request instanceof Request)) {
    throw new ApiHttpError("internal_error");
  }
  if (typeof requestId !== "string" || requestId.trim().length === 0) {
    throw new ApiHttpError("internal_error");
  }

  // 1. Actual route/runtime gate on the real pathname.
  const url = parseMutationUrl(request);
  const route = resolveApiRouteAccess(request.method, url.pathname, controls);
  if (route !== PROGRAM_UPDATE_ROUTE) {
    throw new ApiHttpError("route_not_found");
  }

  validateProgramMutationDependencies(dependencies);

  // 2. Strict path and closed-schema body validation, before authentication.
  const { programId } = parseApiV1ProgramUpdatePath(url.pathname);
  const body: ApiV1UpdateProgramBody = parseApiV1UpdateProgramBody(rawBody);

  // 3. Authentication.
  let authenticated: AuthenticatedApiContext;
  try {
    authenticated = await dependencies.authenticate(request);
  } catch (cause) {
    preserveOrWrap(cause);
  }
  authenticated = validateAuthenticatedContext(authenticated!);

  const activityIdentity: ApiProtectedRouteActivityIdentity = Object.freeze({
    apiClientId: authenticated.client.apiClientId,
    actorUserId: authenticated.token.userId,
  });

  // 4. Route authorization — exactly once.
  try {
    await dependencies.authorizeRoute(authenticated, route);
  } catch (cause) {
    preserveOrWrap(cause);
  }

  // 5. Rate limiting strictly before execution-context construction.
  let profile: ApiRateLimitProfile;
  try {
    profile = await dependencies.resolveRateLimitProfile(authenticated, route);
  } catch (cause) {
    preserveOrWrap(cause);
  }
  await enforceApiRateLimit(
    {
      apiClientId: authenticated.client.apiClientId,
      userId: authenticated.token.userId,
      routeId: route.id,
    },
    profile!,
    dependencies.rateLimit,
  );

  // 6. Canonical API-F execution context over the fully normalized payload,
  // including the URL-borne Program identity.
  const executionContext = await buildPhaseExecutionContext(
    request,
    authenticated,
    buildApiV1UpdateProgramIdempotencyPayload(programId, body),
    requestId,
  );

  // 7. Exactly one delegated mutation invocation.
  let result: Awaited<ReturnType<DelegatedApiV1UpdateProgramExecutor>>;
  try {
    result = await dependencies.updateProgram(
      request,
      authenticated,
      programId,
      body,
      executionContext,
    );
  } catch (cause) {
    preserveOrWrap(cause);
  }

  // 8. Bounded outcome mapping. Nothing beyond the Program identifier and its
  // canonical `updatedAt` is ever returned.
  const bounded = result!;
  if (bounded.ok === true) {
    if (
      bounded.outcome === "applied" ||
      bounded.outcome === "no_change" ||
      bounded.outcome === "replayed"
    ) {
      return Object.freeze({
        route,
        payload: bounded,
        status: 200 as const,
        activityIdentity,
      });
    }
    throw new ApiHttpError("internal_error");
  }

  if (bounded.outcome === "conflict") {
    // Optimistic concurrency only. `stale_program` never leaves this boundary.
    throw new ApiHttpError("concurrency_conflict");
  }
  if (bounded.outcome === "invalid") {
    throw new ApiHttpError("invalid_request");
  }
  if (bounded.outcome === "not_authorized") {
    throw new ApiHttpError("not_authorized");
  }
  if (bounded.outcome === "idempotency_conflict") {
    throw new ApiHttpError("idempotency_conflict");
  }
  if (bounded.outcome === "idempotency_pending") {
    throw new ApiHttpError("idempotency_pending");
  }
  throw new ApiHttpError("internal_error");
}

// =============================================================================
// API-Q Portfolio-4B — POST /v1/portfolios (portfolios:create)
//
// Exactly one new dedicated mutation executor, mirroring the accepted Program
// Create HTTP architecture. No generic mutation dispatcher, no shared
// body/route table, no Portfolio read, no Connected App enablement write, and
// no archive/assignment/team surface is reachable here. Organization Admin
// domain authority, Connected App enablement, capability grants, idempotency,
// provenance and encryption remain entirely with the accepted
// `public.api_v1_create_portfolio` wrapper.
// =============================================================================

export interface ApiPortfolioMutationRouteDependencies {
  authenticate(request: Request): Promise<AuthenticatedApiContext>;
  authorizeRoute(
    context: AuthenticatedApiContext,
    route: ApiRouteDefinition,
  ): Promise<void>;
  resolveRateLimitProfile(
    context: AuthenticatedApiContext,
    route: ApiRouteDefinition,
  ): Promise<ApiRateLimitProfile>;
  rateLimit: ApiRateLimitDependencies;
  /** Caller-scoped delegated `api_v1_create_portfolio` executor. */
  createPortfolio: DelegatedApiV1CreatePortfolioExecutor;
  /** Caller-scoped delegated `api_v1_update_portfolio` executor. */
  updatePortfolio: DelegatedApiV1UpdatePortfolioExecutor;
  /** API-Q Portfolio-6B — the single external Project↔Portfolio assignment. */
  assignProjectPortfolio: DelegatedApiV1AssignProjectPortfolioExecutor;
}

export interface ApiCreatePortfolioRouteResult {
  readonly route: ApiRouteDefinition;
  readonly payload: ApiV1CreatePortfolioSuccessResult;
  readonly status: 200 | 201;
  readonly activityIdentity: ApiProtectedRouteActivityIdentity;
}

function validatePortfolioMutationDependencies(
  deps: unknown,
): asserts deps is ApiPortfolioMutationRouteDependencies {
  if (!isNonArrayObject(deps)) throw new ApiHttpError("internal_error");
  const d = deps as Record<string, unknown>;
  if (typeof d.authenticate !== "function") {
    throw new ApiHttpError("internal_error");
  }
  if (typeof d.authorizeRoute !== "function") {
    throw new ApiHttpError("internal_error");
  }
  if (typeof d.resolveRateLimitProfile !== "function") {
    throw new ApiHttpError("internal_error");
  }
  if (typeof d.createPortfolio !== "function") {
    throw new ApiHttpError("internal_error");
  }
  if (typeof d.assignProjectPortfolio !== "function") {
    throw new ApiHttpError("internal_error");
  }
  if (typeof d.updatePortfolio !== "function") {
    throw new ApiHttpError("internal_error");
  }
  if (!isNonArrayObject(d.rateLimit)) {
    throw new ApiHttpError("internal_error");
  }
}

/** POST /v1/portfolios */
export async function executeApiCreatePortfolioRoute(
  request: Request,
  rawBody: unknown,
  requestId: string,
  controls: ApiRuntimeControls,
  dependencies: ApiPortfolioMutationRouteDependencies,
): Promise<ApiCreatePortfolioRouteResult> {
  if (!(request instanceof Request)) {
    throw new ApiHttpError("internal_error");
  }
  if (typeof requestId !== "string" || requestId.trim().length === 0) {
    throw new ApiHttpError("internal_error");
  }

  // 1. Actual route/runtime gate on the real pathname.
  const url = parseMutationUrl(request);
  const route = resolveApiRouteAccess(request.method, url.pathname, controls);
  if (route !== PORTFOLIO_CREATE_ROUTE) {
    throw new ApiHttpError("route_not_found");
  }

  validatePortfolioMutationDependencies(dependencies);

  // 2. Strict closed-schema body validation, before authentication.
  const body: ApiV1CreatePortfolioBody = parseApiV1CreatePortfolioBody(rawBody);

  // 3. Authentication.
  let authenticated: AuthenticatedApiContext;
  try {
    authenticated = await dependencies.authenticate(request);
  } catch (cause) {
    preserveOrWrap(cause);
  }
  authenticated = validateAuthenticatedContext(authenticated!);

  const activityIdentity: ApiProtectedRouteActivityIdentity = Object.freeze({
    apiClientId: authenticated.client.apiClientId,
    actorUserId: authenticated.token.userId,
  });

  // 4. Route authorization — exactly once.
  try {
    await dependencies.authorizeRoute(authenticated, route);
  } catch (cause) {
    preserveOrWrap(cause);
  }

  // 5. Rate limiting strictly before execution-context construction.
  let profile: ApiRateLimitProfile;
  try {
    profile = await dependencies.resolveRateLimitProfile(authenticated, route);
  } catch (cause) {
    preserveOrWrap(cause);
  }
  await enforceApiRateLimit(
    {
      apiClientId: authenticated.client.apiClientId,
      userId: authenticated.token.userId,
      routeId: route.id,
    },
    profile!,
    dependencies.rateLimit,
  );

  // 6. Canonical API-F execution context. The normalized create body already
  // carries the full target identity, so it IS the canonical payload.
  const executionContext = await buildPhaseExecutionContext(
    request,
    authenticated,
    body,
    requestId,
  );

  // 7. Exactly one delegated mutation invocation.
  let result: Awaited<ReturnType<DelegatedApiV1CreatePortfolioExecutor>>;
  try {
    result = await dependencies.createPortfolio(
      request,
      authenticated,
      body,
      executionContext,
    );
  } catch (cause) {
    preserveOrWrap(cause);
  }

  // 8. Bounded outcome mapping. Nothing beyond the new Portfolio identifier is
  // ever returned.
  const bounded = result!;
  if (bounded.ok === true) {
    if (bounded.outcome === "applied") {
      return Object.freeze({
        route,
        payload: bounded,
        status: 201 as const,
        activityIdentity,
      });
    }
    if (bounded.outcome === "replayed") {
      return Object.freeze({
        route,
        payload: bounded,
        status: 200 as const,
        activityIdentity,
      });
    }
    throw new ApiHttpError("internal_error");
  }

  if (bounded.outcome === "invalid") {
    throw new ApiHttpError("invalid_request");
  }
  if (bounded.outcome === "not_authorized") {
    throw new ApiHttpError("not_authorized");
  }
  if (bounded.outcome === "idempotency_conflict") {
    throw new ApiHttpError("idempotency_conflict");
  }
  if (bounded.outcome === "idempotency_pending") {
    throw new ApiHttpError("idempotency_pending");
  }
  throw new ApiHttpError("internal_error");
}

// =============================================================================
// API-Q Portfolio-5B — PATCH /v1/portfolios/{portfolioId} (portfolios:update)
//
// Exactly one new dedicated mutation executor, mirroring the accepted Program
// Update HTTP architecture. No generic Portfolio mutation dispatcher, no shared
// body/route table, no Portfolio read, no Connected App enablement write, and no
// archive/assignment/team surface is reachable here. Organization Admin domain
// authority, capability grants, idempotency, provenance, optimistic concurrency
// and encryption remain entirely with the accepted
// `public.api_v1_update_portfolio` wrapper.
// =============================================================================

export interface ApiUpdatePortfolioRouteResult {
  readonly route: ApiRouteDefinition;
  readonly payload: ApiV1UpdatePortfolioSuccessResult;
  readonly status: 200;
  readonly activityIdentity: ApiProtectedRouteActivityIdentity;
}

/** PATCH /v1/portfolios/{portfolioId} */
export async function executeApiUpdatePortfolioRoute(
  request: Request,
  rawBody: unknown,
  requestId: string,
  controls: ApiRuntimeControls,
  dependencies: ApiPortfolioMutationRouteDependencies,
): Promise<ApiUpdatePortfolioRouteResult> {
  if (!(request instanceof Request)) {
    throw new ApiHttpError("internal_error");
  }
  if (typeof requestId !== "string" || requestId.trim().length === 0) {
    throw new ApiHttpError("internal_error");
  }

  // 1. Actual route/runtime gate on the real pathname.
  const url = parseMutationUrl(request);
  const route = resolveApiRouteAccess(request.method, url.pathname, controls);
  if (route !== PORTFOLIO_UPDATE_ROUTE) {
    throw new ApiHttpError("route_not_found");
  }

  validatePortfolioMutationDependencies(dependencies);

  // 2. Strict path and closed-schema body validation, before authentication.
  const { portfolioId } = parseApiV1PortfolioUpdatePath(url.pathname);
  const body: ApiV1UpdatePortfolioBody = parseApiV1UpdatePortfolioBody(rawBody);

  // 3. Authentication.
  let authenticated: AuthenticatedApiContext;
  try {
    authenticated = await dependencies.authenticate(request);
  } catch (cause) {
    preserveOrWrap(cause);
  }
  authenticated = validateAuthenticatedContext(authenticated!);

  const activityIdentity: ApiProtectedRouteActivityIdentity = Object.freeze({
    apiClientId: authenticated.client.apiClientId,
    actorUserId: authenticated.token.userId,
  });

  // 4. Route authorization — exactly once.
  try {
    await dependencies.authorizeRoute(authenticated, route);
  } catch (cause) {
    preserveOrWrap(cause);
  }

  // 5. Rate limiting strictly before execution-context construction.
  let profile: ApiRateLimitProfile;
  try {
    profile = await dependencies.resolveRateLimitProfile(authenticated, route);
  } catch (cause) {
    preserveOrWrap(cause);
  }
  await enforceApiRateLimit(
    {
      apiClientId: authenticated.client.apiClientId,
      userId: authenticated.token.userId,
      routeId: route.id,
    },
    profile!,
    dependencies.rateLimit,
  );

  // 6. Canonical API-F execution context over the fully normalized payload,
  // including the URL-borne Portfolio identity and every PATCH presence flag.
  const executionContext = await buildPhaseExecutionContext(
    request,
    authenticated,
    buildApiV1UpdatePortfolioIdempotencyPayload(portfolioId, body),
    requestId,
  );

  // 7. Exactly one delegated mutation invocation.
  let result: Awaited<ReturnType<DelegatedApiV1UpdatePortfolioExecutor>>;
  try {
    result = await dependencies.updatePortfolio(
      request,
      authenticated,
      portfolioId,
      body,
      executionContext,
    );
  } catch (cause) {
    preserveOrWrap(cause);
  }

  // 8. Bounded outcome mapping. Nothing beyond the Portfolio identifier and its
  // canonical `updatedAt` is ever returned.
  const bounded = result!;
  if (bounded.ok === true) {
    if (bounded.outcome === "applied" || bounded.outcome === "replayed") {
      return Object.freeze({
        route,
        payload: bounded,
        status: 200 as const,
        activityIdentity,
      });
    }
    throw new ApiHttpError("internal_error");
  }

  if (bounded.outcome === "conflict") {
    // Optimistic concurrency only. Neither `stale_portfolio` nor any current
    // Portfolio timestamp ever leaves this boundary.
    throw new ApiHttpError("concurrency_conflict");
  }
  if (bounded.outcome === "invalid") {
    throw new ApiHttpError("invalid_request");
  }
  if (bounded.outcome === "not_authorized") {
    throw new ApiHttpError("not_authorized");
  }
  if (bounded.outcome === "idempotency_conflict") {
    throw new ApiHttpError("idempotency_conflict");
  }
  if (bounded.outcome === "idempotency_pending") {
    throw new ApiHttpError("idempotency_pending");
  }
  throw new ApiHttpError("internal_error");
}

// =============================================================================
// API-Q Portfolio-6B — PUT /v1/projects/{projectId}/portfolio
// (portfolios:assign_project)
//
// Exactly one new dedicated mutation executor, mirroring the accepted Task
// Assignment HTTP architecture. No generic Portfolio mutation dispatcher, no
// shared body/route table, no Project or Portfolio read, no Connected App
// enablement write and no archive/team surface is reachable here. Project-derived
// scope, PM domain authority, capability grants, idempotency, provenance and the
// canonical `public.assign_project_portfolio` business write remain entirely with
// the accepted `public.api_v1_assign_project_portfolio` wrapper.
// =============================================================================

export interface ApiAssignProjectPortfolioRouteResult {
  readonly route: ApiRouteDefinition;
  readonly payload: ApiV1AssignProjectPortfolioSuccessResult;
  readonly status: 200;
  readonly activityIdentity: ApiProtectedRouteActivityIdentity;
}

/** PUT /v1/projects/{projectId}/portfolio */
export async function executeApiAssignProjectPortfolioRoute(
  request: Request,
  rawBody: unknown,
  requestId: string,
  controls: ApiRuntimeControls,
  dependencies: ApiPortfolioMutationRouteDependencies,
): Promise<ApiAssignProjectPortfolioRouteResult> {
  if (!(request instanceof Request)) {
    throw new ApiHttpError("internal_error");
  }
  if (typeof requestId !== "string" || requestId.trim().length === 0) {
    throw new ApiHttpError("internal_error");
  }

  // 1. Actual route/runtime gate on the real pathname.
  const url = parseMutationUrl(request);
  const route = resolveApiRouteAccess(request.method, url.pathname, controls);
  if (route !== PORTFOLIO_ASSIGN_PROJECT_ROUTE) {
    throw new ApiHttpError("route_not_found");
  }

  validatePortfolioMutationDependencies(dependencies);

  // 2. Strict path and closed-schema body validation, before authentication.
  const { projectId } = parseApiV1PortfolioAssignProjectPath(url.pathname);
  const body: ApiV1AssignProjectPortfolioBody =
    parseApiV1AssignProjectPortfolioBody(rawBody);

  // 3. Authentication.
  let authenticated: AuthenticatedApiContext;
  try {
    authenticated = await dependencies.authenticate(request);
  } catch (cause) {
    preserveOrWrap(cause);
  }
  authenticated = validateAuthenticatedContext(authenticated!);

  const activityIdentity: ApiProtectedRouteActivityIdentity = Object.freeze({
    apiClientId: authenticated.client.apiClientId,
    actorUserId: authenticated.token.userId,
  });

  // 4. Route authorization — exactly once.
  try {
    await dependencies.authorizeRoute(authenticated, route);
  } catch (cause) {
    preserveOrWrap(cause);
  }

  // 5. Rate limiting strictly before execution-context construction.
  let profile: ApiRateLimitProfile;
  try {
    profile = await dependencies.resolveRateLimitProfile(authenticated, route);
  } catch (cause) {
    preserveOrWrap(cause);
  }
  await enforceApiRateLimit(
    {
      apiClientId: authenticated.client.apiClientId,
      userId: authenticated.token.userId,
      routeId: route.id,
    },
    profile!,
    dependencies.rateLimit,
  );

  // 6. Canonical API-F execution context over the fully normalized payload,
  // including the URL-borne Project identity.
  const executionContext = await buildPhaseExecutionContext(
    request,
    authenticated,
    buildApiV1AssignProjectPortfolioIdempotencyPayload(projectId, body),
    requestId,
  );

  // 7. Exactly one delegated mutation invocation.
  let result: Awaited<ReturnType<DelegatedApiV1AssignProjectPortfolioExecutor>>;
  try {
    result = await dependencies.assignProjectPortfolio(
      request,
      authenticated,
      projectId,
      body,
      executionContext,
    );
  } catch (cause) {
    preserveOrWrap(cause);
  }

  // 8. Bounded outcome mapping. Nothing beyond the Project identifier and the
  // old/new Portfolio identifiers is ever returned.
  const bounded = result!;
  if (bounded.ok === true) {
    if (
      bounded.outcome === "applied" || bounded.outcome === "no_change" ||
      bounded.outcome === "replayed"
    ) {
      return Object.freeze({
        route,
        payload: bounded,
        status: 200 as const,
        activityIdentity,
      });
    }
    throw new ApiHttpError("internal_error");
  }

  if (bounded.outcome === "invalid") {
    throw new ApiHttpError("invalid_request");
  }
  if (bounded.outcome === "not_authorized") {
    throw new ApiHttpError("not_authorized");
  }
  if (bounded.outcome === "idempotency_conflict") {
    throw new ApiHttpError("idempotency_conflict");
  }
  if (bounded.outcome === "idempotency_pending") {
    throw new ApiHttpError("idempotency_pending");
  }
  throw new ApiHttpError("internal_error");
}

// =============================================================================
// KPI-4B — POST /v1/projects/:projectid/kpis  (kpis.create)
//
// One explicit protected mutation pipeline for exactly one operation. It
// reuses the accepted shared primitives (runtime gate, authentication, route
// authorization, rate limiting, canonical API-F execution context, delegated
// caller-scoped execution, bounded outcome mapping) and introduces no generic
// mutation dispatcher, no retry, and no fallback.
// =============================================================================

export interface ApiKpiMutationRouteDependencies {
  authenticate(request: Request): Promise<AuthenticatedApiContext>;
  authorizeRoute(
    context: AuthenticatedApiContext,
    route: ApiRouteDefinition,
  ): Promise<void>;
  resolveRateLimitProfile(
    context: AuthenticatedApiContext,
    route: ApiRouteDefinition,
  ): Promise<ApiRateLimitProfile>;
  rateLimit: ApiRateLimitDependencies;
  /** Caller-scoped delegated `api_v1_create_kpi` executor. */
  createKpi: DelegatedApiV1CreateKpiExecutor;
  /** KPI-5B — caller-scoped delegated `api_v1_update_kpi` executor. */
  updateKpi: DelegatedApiV1UpdateKpiExecutor;
  /** KPI-6B — caller-scoped delegated `api_v1_append_kpi_update` executor. */
  appendKpiUpdate: DelegatedApiV1AppendKpiUpdateExecutor;
}

export interface ApiCreateKpiRouteResult {
  readonly route: ApiRouteDefinition;
  readonly payload: ApiV1CreateKpiSuccessResult;
  readonly status: 200 | 201;
  readonly activityIdentity: ApiProtectedRouteActivityIdentity;
}

function validateKpiMutationDependencies(
  deps: unknown,
): asserts deps is ApiKpiMutationRouteDependencies {
  if (!isNonArrayObject(deps)) throw new ApiHttpError("internal_error");
  const d = deps as Record<string, unknown>;
  if (typeof d.authenticate !== "function") {
    throw new ApiHttpError("internal_error");
  }
  if (typeof d.authorizeRoute !== "function") {
    throw new ApiHttpError("internal_error");
  }
  if (typeof d.resolveRateLimitProfile !== "function") {
    throw new ApiHttpError("internal_error");
  }
  if (typeof d.createKpi !== "function") {
    throw new ApiHttpError("internal_error");
  }
  if (typeof d.updateKpi !== "function") {
    throw new ApiHttpError("internal_error");
  }
  if (typeof d.appendKpiUpdate !== "function") {
    throw new ApiHttpError("internal_error");
  }
  if (!isNonArrayObject(d.rateLimit)) {
    throw new ApiHttpError("internal_error");
  }
}

/** Shared, non-generic execution-context construction for KPI mutations. */
async function buildKpiExecutionContext(
  request: Request,
  authenticated: AuthenticatedApiContext,
  canonicalPayload: unknown,
  requestId: string,
): Promise<Awaited<ReturnType<typeof buildExecutionContext>>> {
  try {
    return await buildExecutionContext(
      request,
      authenticated,
      canonicalPayload,
      { randomUUID: () => requestId },
    );
  } catch (cause) {
    if (cause instanceof IdempotencyValidationError) {
      throw new ApiHttpError("invalid_request", cause);
    }
    if (cause instanceof ExecutionContextError) {
      if (cause.code === "invalid_authenticated_context") {
        throw new ApiHttpError("internal_error", cause);
      }
      throw new ApiHttpError("invalid_request", cause);
    }
    if (cause instanceof ApiHttpError) throw cause;
    throw new ApiHttpError("internal_error", cause);
  }
}

/** POST /v1/projects/:projectid/kpis */
export async function executeApiCreateKpiRoute(
  request: Request,
  rawBody: unknown,
  requestId: string,
  controls: ApiRuntimeControls,
  dependencies: ApiKpiMutationRouteDependencies,
): Promise<ApiCreateKpiRouteResult> {
  if (!(request instanceof Request)) {
    throw new ApiHttpError("internal_error");
  }
  if (typeof requestId !== "string" || requestId.trim().length === 0) {
    throw new ApiHttpError("internal_error");
  }

  // 1. Actual route/runtime gate on the real pathname. No query string or hash
  //    is accepted on this command.
  const url = parseMutationUrl(request);
  const route = resolveApiRouteAccess(request.method, url.pathname, controls);
  if (route !== KPI_CREATE_ROUTE) {
    throw new ApiHttpError("route_not_found");
  }

  validateKpiMutationDependencies(dependencies);

  // 2. Strict path + closed-schema body validation, before authentication.
  const { projectId } = parseApiV1ProjectKpisPath(url.pathname);
  const body: ApiV1CreateKpiBody = parseApiV1CreateKpiBody(rawBody);

  // 3. Authentication.
  let authenticated: AuthenticatedApiContext;
  try {
    authenticated = await dependencies.authenticate(request);
  } catch (cause) {
    preserveOrWrap(cause);
  }
  authenticated = validateAuthenticatedContext(authenticated!);

  const activityIdentity: ApiProtectedRouteActivityIdentity = Object.freeze({
    apiClientId: authenticated.client.apiClientId,
    actorUserId: authenticated.token.userId,
  });

  // 4. Route authorization — exactly once.
  try {
    await dependencies.authorizeRoute(authenticated, route);
  } catch (cause) {
    preserveOrWrap(cause);
  }

  // 5. Rate limiting strictly before execution-context construction.
  let profile: ApiRateLimitProfile;
  try {
    profile = await dependencies.resolveRateLimitProfile(authenticated, route);
  } catch (cause) {
    preserveOrWrap(cause);
  }
  await enforceApiRateLimit(
    {
      apiClientId: authenticated.client.apiClientId,
      userId: authenticated.token.userId,
      routeId: route.id,
    },
    profile!,
    dependencies.rateLimit,
  );

  // 6. Canonical API-F execution context over the canonical idempotency
  //    payload: the URL-borne Project identity folded together with the fully
  //    materialized canonical body.
  const executionContext = await buildKpiExecutionContext(
    request,
    authenticated,
    buildApiV1CreateKpiIdempotencyPayload(projectId, body),
    requestId,
  );

  // 7. Exactly one delegated mutation invocation.
  let result: Awaited<ReturnType<DelegatedApiV1CreateKpiExecutor>>;
  try {
    result = await dependencies.createKpi(
      request,
      authenticated,
      projectId,
      body,
      executionContext,
    );
  } catch (cause) {
    preserveOrWrap(cause);
  }

  // 8. Bounded outcome mapping. No database narrative is ever surfaced.
  const bounded = result!;
  if (bounded.ok === true) {
    if (bounded.outcome === "applied") {
      return Object.freeze({
        route,
        payload: bounded,
        status: 201 as const,
        activityIdentity,
      });
    }
    if (bounded.outcome === "replayed") {
      return Object.freeze({
        route,
        payload: bounded,
        status: 200 as const,
        activityIdentity,
      });
    }
    throw new ApiHttpError("internal_error");
  }

  if (bounded.outcome === "invalid") {
    throw new ApiHttpError("invalid_request");
  }
  if (bounded.outcome === "not_authorized") {
    throw new ApiHttpError("not_authorized");
  }
  if (bounded.outcome === "idempotency_conflict") {
    throw new ApiHttpError("idempotency_conflict");
  }
  if (bounded.outcome === "idempotency_pending") {
    throw new ApiHttpError("idempotency_pending");
  }
  throw new ApiHttpError("internal_error");
}

// =============================================================================
// KPI-5B — PATCH /v1/kpis/:kpiid  (kpis.update)
//
// One explicit protected mutation pipeline for exactly one operation. It reuses
// the accepted shared primitives (runtime gate, authentication, route
// authorization, rate limiting, canonical API-F execution context, delegated
// caller-scoped execution, bounded outcome mapping) and introduces no generic
// mutation dispatcher, no retry, no fallback and no current-timestamp refresh.
// =============================================================================

export interface ApiUpdateKpiRouteResult {
  readonly route: ApiRouteDefinition;
  readonly payload: ApiV1UpdateKpiSuccessResult;
  readonly status: 200;
  readonly activityIdentity: ApiProtectedRouteActivityIdentity;
}

/** PATCH /v1/kpis/:kpiid */
export async function executeApiUpdateKpiRoute(
  request: Request,
  rawBody: unknown,
  requestId: string,
  controls: ApiRuntimeControls,
  dependencies: ApiKpiMutationRouteDependencies,
): Promise<ApiUpdateKpiRouteResult> {
  if (!(request instanceof Request)) {
    throw new ApiHttpError("internal_error");
  }
  if (typeof requestId !== "string" || requestId.trim().length === 0) {
    throw new ApiHttpError("internal_error");
  }

  // 1. Actual route/runtime gate on the real pathname. No query string or hash
  //    is accepted on this command.
  const url = parseMutationUrl(request);
  const route = resolveApiRouteAccess(request.method, url.pathname, controls);
  if (route !== KPI_UPDATE_ROUTE) {
    throw new ApiHttpError("route_not_found");
  }

  validateKpiMutationDependencies(dependencies);

  // 2. Strict path + closed-schema body validation, before authentication.
  const { kpiId } = parseApiV1KpiDetailPath(url.pathname);
  const body: ApiV1UpdateKpiBody = parseApiV1UpdateKpiBody(rawBody);

  // 3. Authentication.
  let authenticated: AuthenticatedApiContext;
  try {
    authenticated = await dependencies.authenticate(request);
  } catch (cause) {
    preserveOrWrap(cause);
  }
  authenticated = validateAuthenticatedContext(authenticated!);

  const activityIdentity: ApiProtectedRouteActivityIdentity = Object.freeze({
    apiClientId: authenticated.client.apiClientId,
    actorUserId: authenticated.token.userId,
  });

  // 4. Route authorization — exactly once, for exactly this route object.
  try {
    await dependencies.authorizeRoute(authenticated, route);
  } catch (cause) {
    preserveOrWrap(cause);
  }

  // 5. Rate limiting strictly before execution-context construction.
  let profile: ApiRateLimitProfile;
  try {
    profile = await dependencies.resolveRateLimitProfile(authenticated, route);
  } catch (cause) {
    preserveOrWrap(cause);
  }
  await enforceApiRateLimit(
    {
      apiClientId: authenticated.client.apiClientId,
      userId: authenticated.token.userId,
      routeId: route.id,
    },
    profile!,
    dependencies.rateLimit,
  );

  // 6. Canonical API-F execution context over the canonical idempotency
  //    payload: the URL-borne KPI identity, the concurrency token, every
  //    normalized value and every presence flag.
  const executionContext = await buildKpiExecutionContext(
    request,
    authenticated,
    buildApiV1UpdateKpiIdempotencyPayload(kpiId, body),
    requestId,
  );

  // 7. Exactly one delegated mutation invocation. No retry.
  let result: Awaited<ReturnType<DelegatedApiV1UpdateKpiExecutor>>;
  try {
    result = await dependencies.updateKpi(
      request,
      authenticated,
      kpiId,
      body,
      executionContext,
    );
  } catch (cause) {
    preserveOrWrap(cause);
  }

  // 8. Bounded outcome mapping. No database narrative is ever surfaced and the
  //    internal `stale_kpi_definition` code is never exposed.
  const bounded = result!;
  if (bounded.ok === true) {
    if (
      bounded.outcome === "applied" || bounded.outcome === "no_change" ||
      bounded.outcome === "replayed"
    ) {
      return Object.freeze({
        route,
        payload: bounded,
        status: 200 as const,
        activityIdentity,
      });
    }
    throw new ApiHttpError("internal_error");
  }

  if (bounded.outcome === "conflict") {
    throw new ApiHttpError("concurrency_conflict");
  }
  if (bounded.outcome === "invalid") {
    throw new ApiHttpError("invalid_request");
  }
  if (bounded.outcome === "not_authorized") {
    throw new ApiHttpError("not_authorized");
  }
  if (bounded.outcome === "idempotency_conflict") {
    throw new ApiHttpError("idempotency_conflict");
  }
  if (bounded.outcome === "idempotency_pending") {
    throw new ApiHttpError("idempotency_pending");
  }
  throw new ApiHttpError("internal_error");
}

// =============================================================================
// KPI-6B — POST /v1/kpis/:kpiid/updates  (kpis.updates.append)
//
// One explicit protected mutation pipeline for exactly one operation. It reuses
// the accepted shared primitives (runtime gate, authentication, route
// authorization, rate limiting, canonical API-F execution context, delegated
// caller-scoped execution, bounded outcome mapping) and introduces no generic
// mutation dispatcher, no retry and no fallback.
// =============================================================================

export interface ApiAppendKpiUpdateRouteResult {
  readonly route: ApiRouteDefinition;
  readonly payload: ApiV1AppendKpiUpdateSuccessResult;
  readonly status: 200 | 201;
  readonly activityIdentity: ApiProtectedRouteActivityIdentity;
}

/** POST /v1/kpis/:kpiid/updates */
export async function executeApiAppendKpiUpdateRoute(
  request: Request,
  rawBody: unknown,
  requestId: string,
  controls: ApiRuntimeControls,
  dependencies: ApiKpiMutationRouteDependencies,
): Promise<ApiAppendKpiUpdateRouteResult> {
  if (!(request instanceof Request)) {
    throw new ApiHttpError("internal_error");
  }
  if (typeof requestId !== "string" || requestId.trim().length === 0) {
    throw new ApiHttpError("internal_error");
  }

  // 1. Actual route/runtime gate on the real pathname. No query string or hash
  //    is accepted on this command.
  const url = parseMutationUrl(request);
  const route = resolveApiRouteAccess(request.method, url.pathname, controls);
  if (route !== KPI_UPDATE_APPEND_ROUTE) {
    throw new ApiHttpError("route_not_found");
  }

  validateKpiMutationDependencies(dependencies);

  // 2. Strict path + closed-schema body validation, before authentication.
  const { kpiId } = parseApiV1KpiUpdatesPath(url.pathname);
  const body: ApiV1AppendKpiUpdateBody = parseApiV1AppendKpiUpdateBody(rawBody);

  // 3. Authentication.
  let authenticated: AuthenticatedApiContext;
  try {
    authenticated = await dependencies.authenticate(request);
  } catch (cause) {
    preserveOrWrap(cause);
  }
  authenticated = validateAuthenticatedContext(authenticated!);

  const activityIdentity: ApiProtectedRouteActivityIdentity = Object.freeze({
    apiClientId: authenticated.client.apiClientId,
    actorUserId: authenticated.token.userId,
  });

  // 4. Route authorization — exactly once, for exactly this route object.
  try {
    await dependencies.authorizeRoute(authenticated, route);
  } catch (cause) {
    preserveOrWrap(cause);
  }

  // 5. Rate limiting strictly before execution-context construction.
  let profile: ApiRateLimitProfile;
  try {
    profile = await dependencies.resolveRateLimitProfile(authenticated, route);
  } catch (cause) {
    preserveOrWrap(cause);
  }
  await enforceApiRateLimit(
    {
      apiClientId: authenticated.client.apiClientId,
      userId: authenticated.token.userId,
      routeId: route.id,
    },
    profile!,
    dependencies.rateLimit,
  );

  // 6. Canonical API-F execution context over the canonical idempotency
  //    payload: the URL-borne KPI identity folded together with the fully
  //    materialized canonical body.
  const executionContext = await buildKpiExecutionContext(
    request,
    authenticated,
    buildApiV1AppendKpiUpdateIdempotencyPayload(kpiId, body),
    requestId,
  );

  // 7. Exactly one delegated mutation invocation. No retry.
  let result: Awaited<ReturnType<DelegatedApiV1AppendKpiUpdateExecutor>>;
  try {
    result = await dependencies.appendKpiUpdate(
      request,
      authenticated,
      kpiId,
      body,
      executionContext,
    );
  } catch (cause) {
    preserveOrWrap(cause);
  }

  // 8. Bounded outcome mapping. No database narrative, note or PMG reason is
  //    ever surfaced.
  const bounded = result!;
  if (bounded.ok === true) {
    if (bounded.outcome === "applied") {
      return Object.freeze({
        route,
        payload: bounded,
        status: 201 as const,
        activityIdentity,
      });
    }
    if (bounded.outcome === "replayed") {
      return Object.freeze({
        route,
        payload: bounded,
        status: 200 as const,
        activityIdentity,
      });
    }
    throw new ApiHttpError("internal_error");
  }

  if (bounded.outcome === "invalid") {
    throw new ApiHttpError("invalid_request");
  }
  if (bounded.outcome === "not_authorized") {
    throw new ApiHttpError("not_authorized");
  }
  if (bounded.outcome === "idempotency_conflict") {
    throw new ApiHttpError("idempotency_conflict");
  }
  if (bounded.outcome === "idempotency_pending") {
    throw new ApiHttpError("idempotency_pending");
  }
  throw new ApiHttpError("internal_error");
}
