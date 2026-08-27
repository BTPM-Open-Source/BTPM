// API-G.1O — Live Edge Function entry point for btpm-api-v1.
//
// This module is the ONLY runtime activation surface for the protected
// API v1 read routes. It composes already-accepted pure helpers and
// server-side adapters and does no route logic of its own.
//
// Fail-closed behavior:
//   - Missing / malformed switches leave the API disabled.
//   - Initialization failures never leak configuration details.
//   - Every non-preflight request runs through the accepted pure
//     transport handler.

import { createClient } from "npm:@supabase/supabase-js@2.50.0";

import {
  ApiHttpError,
  toSafeHttpErrorResponse,
} from "../_shared/btpm-api/http.ts";
import { parseAllowedOrigins } from "../_shared/btpm-api/cors.ts";
import {
  authenticateApiRequest,
  type AuthenticatedApiContext,
} from "../_shared/btpm-api/authenticateApiRequest.ts";
import {
  createSupabaseTokenVerifier,
  createSupabaseCurrentUserResolver,
} from "../_shared/btpm-api/resolveTokenContext.ts";
import { createSupabaseClientAuthorizationStore } from "../_shared/btpm-api/authorizeClient.ts";
import {
  createSupabaseRateLimitProfileResolver,
  createSupabaseRateLimitStore,
} from "../_shared/btpm-api/supabaseRateLimit.ts";
import {
  parseApiRuntimeControls,
  type ApiRouteDefinition,
  type ApiProtectedRouteDependencies,
  type ApiAppendExecutionUpdateRouteDependencies,
  type ApiRiskMutationRouteDependencies,
  // KPI-4B — accepted KPI mutation route dependency contract.
  type ApiKpiMutationRouteDependencies,
  type ApiBlockerMutationRouteDependencies,
  type ApiProgramMutationRouteDependencies,
  type ApiPortfolioMutationRouteDependencies,
  type ApiProjectMutationRouteDependencies,
  type ApiPhaseMutationRouteDependencies,
  type ApiTaskMutationRouteDependencies,
} from "./router.ts";
import { VERSION_ROUTE } from "./routes/version.ts";
import { CAPABILITIES_ROUTE } from "./routes/capabilities.ts";
import { ME_ROUTE } from "./routes/me.ts";
import { ORGANIZATIONS_ROUTE } from "./routes/organizations.ts";
import { WORKSPACES_ROUTE } from "./routes/workspaces.ts";
import { WORKSPACE_MEMBERS_ROUTE } from "./routes/workspaceMembers.ts";
import {
  PROJECT_CREATE_ROUTE,
  PROJECT_UPDATE_ROUTE,
  PROJECT_TRANSITION_ROUTE,
  PROJECTS_ROUTE,
} from "./routes/projects.ts";
// API-N.2B — the two accepted external Program reads.
// API-N.9A / API-N.9B — the two accepted external Program commands.
import {
  PROGRAMS_ROUTE,
  PROGRAM_DETAIL_ROUTE,
  PROGRAM_CREATE_ROUTE,
  PROGRAM_UPDATE_ROUTE,
} from "./routes/programs.ts";
// API-Q Portfolio-3 — the three accepted external Portfolio reads.
// API-Q Portfolio-4B / Portfolio-5B — the two accepted external Portfolio
// commands.
import {
  PORTFOLIOS_ROUTE,
  PORTFOLIO_ASSIGN_PROJECT_ROUTE,
  PORTFOLIO_CREATE_ROUTE,
  PORTFOLIO_DETAIL_ROUTE,
  PORTFOLIO_PROJECTS_ROUTE,
  PORTFOLIO_UPDATE_ROUTE,
} from "./routes/portfolios.ts";
import { PROJECT_DETAIL_ROUTE } from "./routes/projectDetail.ts";
import { PROJECT_PLANNING_ROUTE } from "./routes/projectPlanning.ts";
import {
  EXECUTION_UPDATES_APPEND_ROUTE,
  EXECUTION_UPDATES_READ_ROUTE,
} from "./routes/executionUpdates.ts";
import {
  RISK_CREATE_ROUTE,
  RISK_DETAIL_ROUTE,
  RISK_PROJECT_COLLECTION_ROUTE,
  RISK_UPDATE_ROUTE,
} from "./routes/risks.ts";
import {
  BLOCKER_CREATE_ROUTE,
  BLOCKER_DETAIL_ROUTE,
  BLOCKER_PROJECT_COLLECTION_ROUTE,
  BLOCKER_UPDATE_ROUTE,
} from "./routes/blockers.ts";
import {
  PHASE_CREATE_ROUTE,
  PHASE_DETAIL_ROUTE,
  PHASE_PLANNING_ROUTE,
  PHASE_REORDER_ROUTE,
  PHASE_UPDATE_ROUTE,
} from "./routes/phases.ts";
import {
  TASK_ASSIGN_ROUTE,
  TASK_CREATE_ROUTE,
  TASK_DETAIL_ROUTE,
  TASK_PLANNING_ROUTE,
  TASK_REORDER_ROUTE,
  TASK_TRANSITION_ROUTE,
  TASK_UPDATE_ROUTE,
} from "./routes/tasks.ts";
import { createDelegatedApiV1AppendExecutionUpdateExecutor } from "../_shared/btpm-api/supabaseDelegatedAppendExecutionUpdate.ts";
import {
  createDelegatedApiV1CreateRiskExecutor,
  createDelegatedApiV1UpdateRiskExecutor,
} from "../_shared/btpm-api/supabaseDelegatedRisk.ts";
import {
  createDelegatedApiV1CreateBlockerExecutor,
  createDelegatedApiV1UpdateBlockerExecutor,
} from "../_shared/btpm-api/supabaseDelegatedBlocker.ts";
// API-N.5 — the single delegated, caller-bound Project mutation executor.
import {
  createDelegatedApiV1CreateProjectExecutor,
  createDelegatedApiV1UpdateProjectExecutor,
  createDelegatedApiV1TransitionProjectExecutor,
} from "../_shared/btpm-api/supabaseDelegatedProjectMutation.ts";
// API-N.9A — the single delegated, caller-bound Program mutation executor.
import {
  createDelegatedApiV1CreateProgramExecutor,
  createDelegatedApiV1UpdateProgramExecutor,
} from "../_shared/btpm-api/supabaseDelegatedProgramMutation.ts";
// API-Q Portfolio-4B — the single delegated, caller-bound Portfolio mutation
// executor.
import {
  createDelegatedApiV1AssignProjectPortfolioExecutor,
  createDelegatedApiV1CreatePortfolioExecutor,
  createDelegatedApiV1UpdatePortfolioExecutor,
} from "../_shared/btpm-api/supabaseDelegatedPortfolioMutation.ts";
import {
  createDelegatedApiV1CreatePhaseExecutor,
  createDelegatedApiV1PlanPhaseExecutor,
  createDelegatedApiV1ReorderPhasesExecutor,
  createDelegatedApiV1UpdatePhaseExecutor,
} from "../_shared/btpm-api/supabaseDelegatedPhase.ts";
import {
  createDelegatedApiV1CreateTaskExecutor,
  createDelegatedApiV1UpdateTaskExecutor,
  createDelegatedApiV1ReorderTasksExecutor,
  createDelegatedApiV1PlanTaskExecutor,
  createDelegatedApiV1AssignTaskExecutor,
  createDelegatedApiV1TransitionTaskExecutor,
} from "../_shared/btpm-api/supabaseDelegatedTask.ts";
// API-M.CP.4C — accepted CP.4B caller-bound Phase/Task detail read factories.
import { createDelegatedApiV1PhaseReader } from "../_shared/btpm-api/supabaseDelegatedPhaseRead.ts";
import { createDelegatedApiV1TaskReader } from "../_shared/btpm-api/supabaseDelegatedTaskRead.ts";
import { createSupabaseActivityRecorder } from "../_shared/btpm-api/supabaseActivity.ts";
import { createSupabaseActivityScopeResolver } from "../_shared/btpm-api/supabaseActivityScope.ts";

import { createDelegatedApiV1MeReader } from "../_shared/btpm-api/supabaseDelegatedReadMe.ts";
import { createDelegatedApiV1OrganizationsReader } from "../_shared/btpm-api/supabaseDelegatedOrganizations.ts";
import { createDelegatedApiV1WorkspacesReader } from "../_shared/btpm-api/supabaseDelegatedWorkspaces.ts";
import { createDelegatedApiV1WorkspaceMembersReader } from "../_shared/btpm-api/supabaseDelegatedWorkspaceMembers.ts";
import {
  createDelegatedApiV1ProgramReader,
  createDelegatedApiV1ProgramsReader,
} from "../_shared/btpm-api/supabaseDelegatedProgramRead.ts";
// API-Q Portfolio-3 — the three delegated, caller-bound Portfolio readers.
import {
  createDelegatedApiV1PortfolioProjectsReader,
  createDelegatedApiV1PortfolioReader,
  createDelegatedApiV1PortfoliosReader,
} from "../_shared/btpm-api/supabaseDelegatedPortfolioRead.ts";
import { createDelegatedApiV1ProjectsReader } from "../_shared/btpm-api/supabaseDelegatedProjects.ts";
import { createDelegatedApiV1ProjectDetailReader } from "../_shared/btpm-api/supabaseDelegatedProjectDetail.ts";
import { createDelegatedApiV1ProjectPlanningReader } from "../_shared/btpm-api/supabaseDelegatedProjectPlanning.ts";
// API-M.CP.2B2 — accepted CP.2B1 caller-bound Risk read factories.
import {
  createDelegatedApiV1ProjectRisksReader,
  createDelegatedApiV1RiskReader,
} from "../_shared/btpm-api/supabaseDelegatedRiskRead.ts";
// KPI-1B — accepted caller-bound Project KPI collection read factory.
import {
  createDelegatedApiV1KpiReader,
  createDelegatedApiV1KpiUpdatesReader,
  createDelegatedApiV1ProjectKpisReader,
} from "../_shared/btpm-api/supabaseDelegatedKpiRead.ts";
// KPI-1B-C1 — the accepted KPI route constants for the live authorization gate.
import {
  KPI_DETAIL_ROUTE,
  KPI_PROJECT_COLLECTION_ROUTE,
  KPI_UPDATES_ROUTE,
  // KPI-4B — the accepted external Project KPI create route constant.
  KPI_CREATE_ROUTE,
  // KPI-5B — the accepted external KPI definition update route constant.
  KPI_UPDATE_ROUTE,
  // KPI-6B — the accepted external KPI update-history append route constant.
  KPI_UPDATE_APPEND_ROUTE,
} from "../_shared/btpm-api/routes/kpis.ts";
// KPI-4B — accepted caller-bound delegated KPI create executor factory. The
// anon key is used; the service-role key is never used for KPI mutation
// execution.
import {
  createDelegatedApiV1AppendKpiUpdateExecutor,
  createDelegatedApiV1CreateKpiExecutor,
  createDelegatedApiV1UpdateKpiExecutor,
} from "../_shared/btpm-api/supabaseDelegatedKpiMutation.ts";
// API-M.CP.2C3 — accepted CP.2C2 caller-bound Blocker read factories.
import {
  createDelegatedApiV1BlockerReader,
  createDelegatedApiV1ProjectBlockersReader,
} from "../_shared/btpm-api/supabaseDelegatedBlockerRead.ts";
// API-M.CP.3C — accepted CP.3B caller-bound Execution Update read factory.
import { createDelegatedApiV1ExecutionUpdatesReader } from "../_shared/btpm-api/supabaseDelegatedExecutionUpdateRead.ts";

import {
  handleApiV1Request,
  type ApiV1HttpHandlerDependencies,
} from "./handler.ts";

// API-G.5.10A-4 — Live durable activity activation
declare const EdgeRuntime: {
  waitUntil(task: Promise<unknown>): void;
};

const API_TIMEOUT_MS = 10_000;
const FUNCTION_ROUTE_PREFIX = "/btpm-api-v1";

function normalizeSupabaseUrl(raw: string): string {
  let end = raw.length;
  while (end > 0 && raw.charCodeAt(end - 1) === 47 /* '/' */) end--;
  return raw.slice(0, end);
}

function parseRuntimeAllowedOrigins(
  raw: string | undefined,
): ReadonlySet<string> {
  if (raw === undefined) return parseAllowedOrigins(raw);
  if (raw.trim().length === 0) return parseAllowedOrigins(raw);
  const parts = raw.split(",");
  for (const part of parts) {
    if (part.trim().length === 0) {
      throw new ApiHttpError("internal_error");
    }
  }
  return parseAllowedOrigins(raw);
}

function normalizeFunctionRouteRequest(request: Request): Request {
  const url = new URL(request.url);

  let newPathname: string | null = null;
  if (url.pathname === FUNCTION_ROUTE_PREFIX) {
    newPathname = "/";
  } else if (url.pathname.startsWith(`${FUNCTION_ROUTE_PREFIX}/`)) {
    newPathname = url.pathname.slice(FUNCTION_ROUTE_PREFIX.length);
  }

  if (newPathname === null) {
    return request;
  }

  url.pathname = newPathname;

  // API-I.9B — POST must keep both the normalized BTPM pathname and an
  // intact, unread body stream. The body is forwarded by reference only; it
  // is never read, parsed, copied or logged here. `readBoundedJson` inside
  // the handler remains the only body reader.
  if (request.body !== null) {
    return new Request(url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: request.signal,
      // Required by the Fetch spec when forwarding a stream body.
      duplex: "half",
    } as RequestInit & { duplex: "half" });
  }

  return new Request(url, {
    method: request.method,
    headers: request.headers,
    signal: request.signal,
  });
}

function buildDependencies(): ApiV1HttpHandlerDependencies {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (
    typeof supabaseUrl !== "string" ||
    supabaseUrl.length === 0 ||
    typeof supabaseAnonKey !== "string" ||
    supabaseAnonKey.length === 0 ||
    typeof supabaseServiceRoleKey !== "string" ||
    supabaseServiceRoleKey.length === 0
  ) {
    throw new ApiHttpError("internal_error");
  }

  const controls = parseApiRuntimeControls({
    BTPM_API_ENABLED: Deno.env.get("BTPM_API_ENABLED"),
    BTPM_API_READS_ENABLED: Deno.env.get("BTPM_API_READS_ENABLED"),
    BTPM_API_MUTATIONS_ENABLED: Deno.env.get("BTPM_API_MUTATIONS_ENABLED"),
  });

  const allowedOrigins = parseRuntimeAllowedOrigins(
    Deno.env.get("BTPM_API_ALLOWED_ORIGINS"),
  );

  const authClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const privilegedClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const normalizedUrl = normalizeSupabaseUrl(supabaseUrl);
  const expectedIssuer = normalizedUrl + "/auth/v1";

  const clientAuthorizationStore =
    createSupabaseClientAuthorizationStore(privilegedClient);
  const tokenVerifier = createSupabaseTokenVerifier(authClient);
  const currentUserResolver = createSupabaseCurrentUserResolver(authClient);

  const profileResolver = createSupabaseRateLimitProfileResolver(
    privilegedClient as unknown as Parameters<
      typeof createSupabaseRateLimitProfileResolver
    >[0],
  );
  const rateLimitStore = createSupabaseRateLimitStore(
    privilegedClient as unknown as Parameters<
      typeof createSupabaseRateLimitStore
    >[0],
  );

  const readMe = createDelegatedApiV1MeReader(
    supabaseUrl,
    supabaseAnonKey,
    (url, key, options) => createClient(url, key, options),
  );

  const readOrganizations = createDelegatedApiV1OrganizationsReader(
    supabaseUrl,
    supabaseAnonKey,
    (url, key, options) => createClient(url, key, options),
  );

  const readWorkspaces = createDelegatedApiV1WorkspacesReader(
    supabaseUrl,
    supabaseAnonKey,
    (url, key, options) => createClient(url, key, options),
  );

  // API-Q WML-1B — caller-bound Workspace-member reader. The anon key is used;
  // the service-role key is never used for Workspace-member business reads.
  const readWorkspaceMembers = createDelegatedApiV1WorkspaceMembersReader(
    supabaseUrl,
    supabaseAnonKey,
    (url, key, options) => createClient(url, key, options),
  );

  // API-N.2B — caller-bound Program readers. The anon key is used; the
  // service-role key is never used for Program business reads.
  const readPrograms = createDelegatedApiV1ProgramsReader(
    supabaseUrl,
    supabaseAnonKey,
    (url, key, options) => createClient(url, key, options),
  );

  const readProgram = createDelegatedApiV1ProgramReader(
    supabaseUrl,
    supabaseAnonKey,
    (url, key, options) => createClient(url, key, options),
  );

  // API-Q Portfolio-3 — caller-bound Portfolio readers. The anon key is used;
  // the service-role key is never used for Portfolio business reads.
  const readPortfolios = createDelegatedApiV1PortfoliosReader(
    supabaseUrl,
    supabaseAnonKey,
    (url, key, options) => createClient(url, key, options),
  );

  const readPortfolio = createDelegatedApiV1PortfolioReader(
    supabaseUrl,
    supabaseAnonKey,
    (url, key, options) => createClient(url, key, options),
  );

  const readPortfolioProjects = createDelegatedApiV1PortfolioProjectsReader(
    supabaseUrl,
    supabaseAnonKey,
    (url, key, options) => createClient(url, key, options),
  );

  const readProjects = createDelegatedApiV1ProjectsReader(
    supabaseUrl,
    supabaseAnonKey,
    (url, key, options) => createClient(url, key, options),
  );

  const readProjectDetail = createDelegatedApiV1ProjectDetailReader(
    supabaseUrl,
    supabaseAnonKey,
    (url, key, options) => createClient(url, key, options),
  );

  // API-M.4 — caller-bound Project-planning reader. The anon key is used;
  // the service-role key is never used for planning data.
  const readProjectPlanning = createDelegatedApiV1ProjectPlanningReader(
    supabaseUrl,
    supabaseAnonKey,
    (url, key, options) => createClient(url, key, options),
  );

  // API-M.CP.2B2 — caller-bound Risk readers. The anon key is used; the
  // service-role key is never used for Risk business reads.
  const readProjectRisks = createDelegatedApiV1ProjectRisksReader(
    supabaseUrl,
    supabaseAnonKey,
    (url, key, options) => createClient(url, key, options),
  );

  // KPI-1B — caller-bound Project KPI collection reader. The anon key is used;
  // the service-role key is never used for the KPI business read.
  const readProjectKpis = createDelegatedApiV1ProjectKpisReader(
    supabaseUrl,
    supabaseAnonKey,
    (url, key, options) => createClient(url, key, options),
  );

  // KPI-2B — caller-bound single-KPI detail reader. The anon key is used; the
  // service-role key is never used for the KPI business read.
  const readKpi = createDelegatedApiV1KpiReader(
    supabaseUrl,
    supabaseAnonKey,
    (url, key, options) => createClient(url, key, options),
  );

  // KPI-3B — caller-bound KPI update-history reader. The anon key is used; the
  // service-role key is never used for the KPI business read.
  const readKpiUpdates = createDelegatedApiV1KpiUpdatesReader(
    supabaseUrl,
    supabaseAnonKey,
    (url, key, options) => createClient(url, key, options),
  );

  const readRisk = createDelegatedApiV1RiskReader(
    supabaseUrl,
    supabaseAnonKey,
    (url, key, options) => createClient(url, key, options),
  );

  // API-M.CP.2C3 — caller-bound Blocker readers. The anon key is used; the
  // service-role key is never used for Blocker business reads.
  const readProjectBlockers = createDelegatedApiV1ProjectBlockersReader(
    supabaseUrl,
    supabaseAnonKey,
    (url, key, options) => createClient(url, key, options),
  );

  const readBlocker = createDelegatedApiV1BlockerReader(
    supabaseUrl,
    supabaseAnonKey,
    (url, key, options) => createClient(url, key, options),
  );

  // API-M.CP.3C — caller-bound Execution Update history reader. The anon key is
  // used; the service-role key is never used for Execution Update business
  // reads.
  const readExecutionUpdates = createDelegatedApiV1ExecutionUpdatesReader(
    supabaseUrl,
    supabaseAnonKey,
    (url, key, options) => createClient(url, key, options),
  );

  // API-M.CP.4C — caller-bound Phase/Task detail readers. The anon key is used;
  // the service-role key is never used for Phase or Task business reads.
  const readPhase = createDelegatedApiV1PhaseReader(
    supabaseUrl,
    supabaseAnonKey,
    (url, key, options) => createClient(url, key, options),
  );

  const readTask = createDelegatedApiV1TaskReader(
    supabaseUrl,
    supabaseAnonKey,
    (url, key, options) => createClient(url, key, options),
  );




  // API-I.9B — exactly one delegated, caller-bound mutation executor. The
  // anon key is used; the service-role key is never used for mutation
  // execution.
  const appendExecutionUpdate =
    createDelegatedApiV1AppendExecutionUpdateExecutor(
      supabaseUrl,
      supabaseAnonKey,
      (url, key, options) => createClient(url, key, options),
    );

  // KPI-4B — exactly one delegated, caller-bound KPI mutation executor.
  const createKpi = createDelegatedApiV1CreateKpiExecutor(
    supabaseUrl,
    supabaseAnonKey,
    (url, key, options) => createClient(url, key, options),
  );

  // KPI-5B — exactly one delegated, caller-bound KPI update executor. The anon
  // key is used; the service-role key is never used for KPI business mutation.
  const updateKpi = createDelegatedApiV1UpdateKpiExecutor(
    supabaseUrl,
    supabaseAnonKey,
    (url, key, options) => createClient(url, key, options),
  );

  // KPI-6B — exactly one delegated, caller-bound KPI update-history append
  // executor. The anon key is used; the service-role key is never used for KPI
  // business mutation.
  const appendKpiUpdate = createDelegatedApiV1AppendKpiUpdateExecutor(
    supabaseUrl,
    supabaseAnonKey,
    (url, key, options) => createClient(url, key, options),
  );

  // API-K.7 — exactly two delegated, caller-bound Risk mutation executors.
  // The anon key is used; the service-role key is never used for Risk
  // mutation execution.
  const createRisk = createDelegatedApiV1CreateRiskExecutor(
    supabaseUrl,
    supabaseAnonKey,
    (url, key, options) => createClient(url, key, options),
  );

  const updateRisk = createDelegatedApiV1UpdateRiskExecutor(
    supabaseUrl,
    supabaseAnonKey,
    (url, key, options) => createClient(url, key, options),
  );

  // API-K.8 — exactly two delegated, caller-bound Blocker mutation executors.
  // The anon key is used; the service-role key is never used for Blocker
  // mutation execution.
  const createBlocker = createDelegatedApiV1CreateBlockerExecutor(
    supabaseUrl,
    supabaseAnonKey,
    (url, key, options) => createClient(url, key, options),
  );

  const updateBlocker = createDelegatedApiV1UpdateBlockerExecutor(
    supabaseUrl,
    supabaseAnonKey,
    (url, key, options) => createClient(url, key, options),
  );

  // API-N.5 — exactly one delegated, caller-bound Project mutation executor.
  // The anon key is used; the service-role key is never used for Project
  // mutation execution.
  const createProject = createDelegatedApiV1CreateProjectExecutor(
    supabaseUrl,
    supabaseAnonKey,
    (url, key, options) => createClient(url, key, options),
  );

  // API-Q Portfolio-4B — exactly one delegated, caller-bound Portfolio
  // mutation executor. The anon key is used; the service-role key is never used
  // for Portfolio mutation execution.
  const createPortfolio = createDelegatedApiV1CreatePortfolioExecutor(
    supabaseUrl,
    supabaseAnonKey,
    (url, key, options) => createClient(url, key, options),
  );

  // API-Q Portfolio-5B — exactly one delegated, caller-bound Portfolio update
  // executor. The anon key is used with the current caller bearer token; the
  // service-role key is never used for Portfolio business execution.
  const updatePortfolio = createDelegatedApiV1UpdatePortfolioExecutor(
    supabaseUrl,
    supabaseAnonKey,
    (url, key, options) => createClient(url, key, options),
  );

  // API-Q Portfolio-6B — exactly one delegated, caller-bound Project↔Portfolio
  // assignment executor. The anon key is used with the current caller bearer
  // token; the service-role key is never used for Portfolio business execution.
  const assignProjectPortfolio =
    createDelegatedApiV1AssignProjectPortfolioExecutor(
      supabaseUrl,
      supabaseAnonKey,
      (url, key, options) => createClient(url, key, options),
    );

  // API-N.9A — exactly one delegated, caller-bound Program mutation executor.
  // The anon key is used; the service-role key is never used for Program
  // mutation execution.
  const createProgram = createDelegatedApiV1CreateProgramExecutor(
    supabaseUrl,
    supabaseAnonKey,
    (url, key, options) => createClient(url, key, options),
  );

  // API-N.9B — exactly one delegated, caller-bound Program update executor.
  // The anon key is used; the service-role key is never used for Program
  // mutation execution.
  const updateProgram = createDelegatedApiV1UpdateProgramExecutor(
    supabaseUrl,
    supabaseAnonKey,
    (url, key, options) => createClient(url, key, options),
  );

  // API-N.6 — the delegated, caller-bound Project metadata update executor.
  // The anon key is used; the service-role key is never used for Project
  // business mutation execution.
  const updateProject = createDelegatedApiV1UpdateProjectExecutor(
    supabaseUrl,
    supabaseAnonKey,
    (url, key, options) => createClient(url, key, options),
  );

  // API-N.7 — the delegated, caller-bound Project status-transition executor.
  // The anon key is used; the service-role key is never used for Project
  // business mutation execution.
  const transitionProject = createDelegatedApiV1TransitionProjectExecutor(
    supabaseUrl,
    supabaseAnonKey,
    (url, key, options) => createClient(url, key, options),
  );

  // API-M.8A — exactly two delegated, caller-bound Phase mutation executors.
  // The anon key is used; the service-role key is never used for Phase
  // mutation execution.
  const createPhase = createDelegatedApiV1CreatePhaseExecutor(
    supabaseUrl,
    supabaseAnonKey,
    (url, key, options) => createClient(url, key, options),
  );

  const updatePhase = createDelegatedApiV1UpdatePhaseExecutor(
    supabaseUrl,
    supabaseAnonKey,
    (url, key, options) => createClient(url, key, options),
  );

  // API-M.8B — the two remaining delegated, caller-bound Phase mutation
  // executors. The anon key is used; the service-role client remains
  // infrastructure-only and never executes Phase business RPCs.
  const reorderPhases = createDelegatedApiV1ReorderPhasesExecutor(
    supabaseUrl,
    supabaseAnonKey,
    (url, key, options) => createClient(url, key, options),
  );

  const planPhase = createDelegatedApiV1PlanPhaseExecutor(
    supabaseUrl,
    supabaseAnonKey,
    (url, key, options) => createClient(url, key, options),
  );


  // API-M.11A / API-M.11B — exactly four delegated, caller-bound Task mutation
  // executors (create, metadata update, reorder, planning). The anon key is
  // used; the service-role key is never used for Task mutation execution.
  const createTask = createDelegatedApiV1CreateTaskExecutor(
    supabaseUrl,
    supabaseAnonKey,
    (url, key, options) => createClient(url, key, options),
  );

  const updateTask = createDelegatedApiV1UpdateTaskExecutor(
    supabaseUrl,
    supabaseAnonKey,
    (url, key, options) => createClient(url, key, options),
  );

  const reorderTasks = createDelegatedApiV1ReorderTasksExecutor(
    supabaseUrl,
    supabaseAnonKey,
    (url, key, options) => createClient(url, key, options),
  );

  const planTask = createDelegatedApiV1PlanTaskExecutor(
    supabaseUrl,
    supabaseAnonKey,
    (url, key, options) => createClient(url, key, options),
  );

  // API-M.11C — the final two caller-scoped Task executors.
  const assignTask = createDelegatedApiV1AssignTaskExecutor(
    supabaseUrl,
    supabaseAnonKey,
    (url, key, options) => createClient(url, key, options),
  );

  const transitionTask = createDelegatedApiV1TransitionTaskExecutor(
    supabaseUrl,
    supabaseAnonKey,
    (url, key, options) => createClient(url, key, options),
  );






  // API-I.9B — the same accepted authentication, authorization and
  // rate-limiting components are shared by protected reads and the single
  // mutation. No parallel infrastructure is created.
  const authenticate = (request: Request) =>
    authenticateApiRequest(
      request,
      {
        expectedIssuer,
        expectedAudience: "authenticated",
      },
      {
        tokenVerifier,
        currentUserResolver,
        clientAuthorizationStore,
        clock: {
          nowSeconds: () => Math.floor(Date.now() / 1000),
        },
      },
    );

  const authorizeRoute = async (
    _context: AuthenticatedApiContext,
    route: ApiRouteDefinition,
  ): Promise<void> => {
    if (
      route !== VERSION_ROUTE &&
      route !== CAPABILITIES_ROUTE &&
      route !== ME_ROUTE &&
      route !== ORGANIZATIONS_ROUTE &&
      route !== WORKSPACES_ROUTE &&
      route !== WORKSPACE_MEMBERS_ROUTE &&
      route !== PROGRAMS_ROUTE &&
      route !== PROGRAM_DETAIL_ROUTE &&
      route !== PROGRAM_CREATE_ROUTE &&
      route !== PROGRAM_UPDATE_ROUTE &&
      route !== PROJECTS_ROUTE &&
      route !== PROJECT_DETAIL_ROUTE &&
      route !== PROJECT_PLANNING_ROUTE &&
      route !== PROJECT_CREATE_ROUTE &&
      route !== PROJECT_UPDATE_ROUTE &&
      route !== PROJECT_TRANSITION_ROUTE &&
      route !== EXECUTION_UPDATES_APPEND_ROUTE &&
      route !== RISK_CREATE_ROUTE &&
      route !== RISK_UPDATE_ROUTE &&
      route !== BLOCKER_CREATE_ROUTE &&
      route !== BLOCKER_UPDATE_ROUTE &&
      route !== PHASE_CREATE_ROUTE &&
      route !== PHASE_UPDATE_ROUTE &&
      route !== PHASE_REORDER_ROUTE &&
      route !== PHASE_PLANNING_ROUTE &&
      route !== TASK_CREATE_ROUTE &&
      route !== TASK_UPDATE_ROUTE &&
      route !== TASK_REORDER_ROUTE &&
      route !== TASK_PLANNING_ROUTE &&
      route !== TASK_ASSIGN_ROUTE &&
      route !== TASK_TRANSITION_ROUTE &&
      route !== RISK_PROJECT_COLLECTION_ROUTE &&
      route !== RISK_DETAIL_ROUTE &&
      route !== BLOCKER_PROJECT_COLLECTION_ROUTE &&
      route !== BLOCKER_DETAIL_ROUTE &&
      route !== EXECUTION_UPDATES_READ_ROUTE &&
      route !== PHASE_DETAIL_ROUTE &&
      route !== TASK_DETAIL_ROUTE &&
      route !== PORTFOLIOS_ROUTE &&
      route !== PORTFOLIO_DETAIL_ROUTE &&
      route !== PORTFOLIO_PROJECTS_ROUTE &&
      route !== PORTFOLIO_CREATE_ROUTE &&
      route !== PORTFOLIO_UPDATE_ROUTE &&
      route !== PORTFOLIO_ASSIGN_PROJECT_ROUTE &&
      route !== KPI_PROJECT_COLLECTION_ROUTE &&
      route !== KPI_DETAIL_ROUTE &&
      route !== KPI_UPDATES_ROUTE &&
      route !== KPI_CREATE_ROUTE &&
      route !== KPI_UPDATE_ROUTE &&
      route !== KPI_UPDATE_APPEND_ROUTE
    ) {
      throw new ApiHttpError("internal_error");
    }
  };

  const resolveRateLimitProfile = (
    context: AuthenticatedApiContext,
    route: ApiRouteDefinition,
  ) => profileResolver.resolve(context.client.apiClientId, route.id);

  const rateLimit = {
    store: rateLimitStore,
    now: () => Date.now(),
  };

  const protectedRoute: ApiProtectedRouteDependencies = {
    authenticate,
    authorizeRoute,
    resolveRateLimitProfile,
    rateLimit,
    readMe,
    readOrganizations,
    readWorkspaces,
    readWorkspaceMembers,
    readPrograms,
    readProgram,
    readPortfolios,
    readPortfolio,
    readPortfolioProjects,
    readProjects,
    readProjectDetail,
    readProjectPlanning,
    readProjectRisks,
    readProjectKpis,
    readKpi,
    readKpiUpdates,
    readRisk,
    readProjectBlockers,
    readBlocker,
    readExecutionUpdates,
    readPhase,
    readTask,
  };

  const appendExecutionUpdateRoute: ApiAppendExecutionUpdateRouteDependencies = {
    authenticate,
    authorizeRoute,
    resolveRateLimitProfile,
    rateLimit,
    appendExecutionUpdate,
  };

  const riskMutationRoute: ApiRiskMutationRouteDependencies = {
    authenticate,
    authorizeRoute,
    resolveRateLimitProfile,
    rateLimit,
    createRisk,
    updateRisk,
  };

  // KPI-4B — narrowly scoped dependency for the single KPI create command.
  const kpiMutationRoute: ApiKpiMutationRouteDependencies = {
    authenticate,
    authorizeRoute,
    resolveRateLimitProfile,
    rateLimit,
    createKpi,
    updateKpi,
    appendKpiUpdate,
  };

  const blockerMutationRoute: ApiBlockerMutationRouteDependencies = {
    authenticate,
    authorizeRoute,
    resolveRateLimitProfile,
    rateLimit,
    createBlocker,
    updateBlocker,
  };

  const projectMutationRoute: ApiProjectMutationRouteDependencies = {
    authenticate,
    authorizeRoute,
    resolveRateLimitProfile,
    rateLimit,
    createProject,
    updateProject,
    transitionProject,
  };

  const portfolioMutationRoute: ApiPortfolioMutationRouteDependencies = {
    authenticate,
    authorizeRoute,
    resolveRateLimitProfile,
    rateLimit,
    createPortfolio,
    updatePortfolio,
    assignProjectPortfolio,
  };

  const programMutationRoute: ApiProgramMutationRouteDependencies = {
    authenticate,
    authorizeRoute,
    resolveRateLimitProfile,
    rateLimit,
    createProgram,
    updateProgram,
  };


  const phaseMutationRoute: ApiPhaseMutationRouteDependencies = {
    authenticate,
    authorizeRoute,
    resolveRateLimitProfile,
    rateLimit,
    createPhase,
    updatePhase,
    reorderPhases,
    planPhase,
  };

  const taskMutationRoute: ApiTaskMutationRouteDependencies = {
    authenticate,
    authorizeRoute,
    resolveRateLimitProfile,
    rateLimit,
    createTask,
    updateTask,
    reorderTasks,
    planTask,
    assignTask,
    transitionTask,
  };




  // API-G.5.10A-4 — Live durable activity activation
  const activityRecorder = createSupabaseActivityRecorder(
    privilegedClient as unknown as Parameters<
      typeof createSupabaseActivityRecorder
    >[0],
  );

  // API-ADM.1 — Activity attribution scope resolver. It reuses the SAME
  // service-role client already dedicated to durable activity infrastructure.
  // Service role is never used for mutation execution or authorization.
  const activityScopeResolver = createSupabaseActivityScopeResolver(
    privilegedClient as unknown as Parameters<
      typeof createSupabaseActivityScopeResolver
    >[0],
  );

  return Object.freeze({
    controls,
    allowedOrigins,
    timeoutMs: API_TIMEOUT_MS,
    requestId: {
      randomUUID: () => crypto.randomUUID(),
    },
    protectedRoute,
    programMutationRoute,
    portfolioMutationRoute,
    
    appendExecutionUpdateRoute,
    riskMutationRoute,
    blockerMutationRoute,
    projectMutationRoute,
    phaseMutationRoute,
    taskMutationRoute,
    kpiMutationRoute,
    activity: Object.freeze({
      recorder: activityRecorder,
      scopeResolver: activityScopeResolver,
      nowMs: () => Date.now(),
      schedule: (task: Promise<boolean>) => {
        EdgeRuntime.waitUntil(task);
      },
    }),
  });

}

// Build dependencies exactly once at module initialization. If it fails,
// remember only the safe fact of failure — never the underlying cause.
let INITIALIZED_DEPENDENCIES: ApiV1HttpHandlerDependencies | null = null;
let INITIALIZATION_FAILED = false;
try {
  INITIALIZED_DEPENDENCIES = buildDependencies();
} catch {
  INITIALIZATION_FAILED = true;
}

Deno.serve(async (request: Request) => {
  if (INITIALIZATION_FAILED || INITIALIZED_DEPENDENCIES === null) {
    return toSafeHttpErrorResponse(
      new ApiHttpError("internal_error"),
      "unavailable",
    );
  }
  const normalizedRequest = normalizeFunctionRouteRequest(request);
  return await handleApiV1Request(
    normalizedRequest,
    INITIALIZED_DEPENDENCIES,
  );
});
