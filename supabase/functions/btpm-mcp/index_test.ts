// API-Q.3 / API-Q.4 — Focused MCP shell + OAuth protected-resource tests.
//
// These tests exercise protocol and authentication infrastructure only. No BTPM
// API operation, database call, RPC, or PM-domain behavior may occur through
// this endpoint.

import {
  assert,
  assertEquals,
  assertStrictEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  BTPM_MCP_REQUEST_ID_HEADER,
  type BtpmMcpRuntime,
  createBtpmMcpRuntime,
  handleBtpmMcpRequest,
} from "./index.ts";
import {
  BTPM_MCP_SERVER_NAME,
  BTPM_MCP_SERVER_VERSION,
} from "./mcp/serverFactory.ts";
import {
  exposedMcpTools,
  MCP_TOOL_REGISTRY,
} from "./mcp/toolRegistry.ts";
import type {
  TokenContextDependencies,
  VerifiedTokenClaims,
} from "../_shared/btpm-api/resolveTokenContext.ts";
import type {
  ActiveApiClientRecord,
  ActivePolicyVersionRecord,
  ClientAuthorizationStore,
  PolicyAcknowledgementRecord,
} from "../_shared/btpm-api/authorizeClient.ts";
import type {
  ApiRateLimitProfile,
  ApiRateLimitStoreInput,
  ApiRateLimitStoreResult,
} from "../_shared/btpm-api/rateLimit.ts";
import type {
  ApiV1OrganizationsPayload,
  ApiV1OrganizationsQuery,
} from "../_shared/btpm-api/supabaseOrganizations.ts";
import type {
  ApiV1WorkspacesPayload,
  ApiV1WorkspacesQuery,
} from "../_shared/btpm-api/supabaseWorkspaces.ts";
import type {
  ApiV1ProjectsPayload,
  ApiV1ProjectsQuery,
} from "../_shared/btpm-api/supabaseProjects.ts";
import {
  MCP_ORGANIZATIONS_TOOL_NAME,
  MCP_TOOL_ERROR_MESSAGES,
} from "./mcp/organizationsReadTool.ts";
import {
  MCP_WORKSPACES_TOOL_ERROR_MESSAGES,
  MCP_WORKSPACES_TOOL_NAME,
} from "./mcp/workspacesReadTool.ts";
import type {
  ApiV1ProgramDetailPayload,
  ApiV1ProgramsPayload,
  ApiV1ProgramsQuery,
} from "../_shared/btpm-api/supabaseProgramRead.ts";
import type { ApiV1ProjectDetailPayload } from "../_shared/btpm-api/supabaseProjectDetail.ts";
import type { ApiV1ProjectPlanningPayload } from "../_shared/btpm-api/supabaseProjectPlanning.ts";
import {
  MCP_PROJECTS_TOOL_ERROR_MESSAGES,
  MCP_PROJECTS_TOOL_NAME,
} from "./mcp/projectsReadTool.ts";
import {
  MCP_PROGRAM_DETAIL_TOOL_NAME,
  MCP_PROGRAMS_TOOL_ERROR_MESSAGES,
  MCP_PROGRAMS_TOOL_NAME,
} from "./mcp/programsReadTools.ts";
import {
  MCP_PROJECT_CONTEXT_TOOL_ERROR_MESSAGES,
  MCP_PROJECT_DETAIL_TOOL_NAME,
  MCP_PROJECT_PLANNING_TOOL_NAME,
} from "./mcp/projectContextReadTools.ts";
import type {
  ApiV1ProjectRisksPayload,
  ApiV1RiskReadItem,
} from "../_shared/btpm-api/supabaseRiskRead.ts";
import type {
  ApiV1BlockerReadItem,
  ApiV1ProjectBlockersPayload,
} from "../_shared/btpm-api/supabaseBlockerRead.ts";
import type { ApiV1ExecutionUpdatesPayload } from "../_shared/btpm-api/supabaseExecutionUpdateRead.ts";
import type { ApiV1PhaseReadItem } from "../_shared/btpm-api/supabasePhaseRead.ts";
import type { ApiV1TaskReadItem } from "../_shared/btpm-api/supabaseTaskRead.ts";
import type { ApiV1RiskCursor } from "../btpm-api-v1/routes/risks.ts";
import type { ApiV1BlockerCursor } from "../btpm-api-v1/routes/blockers.ts";
import type { ApiV1ExecutionUpdateCursor } from "../btpm-api-v1/routes/executionUpdates.ts";
import {
  MCP_BLOCKER_DETAIL_TOOL_NAME,
  MCP_BLOCKER_TOOL_ERROR_MESSAGES,
  MCP_PROJECT_BLOCKERS_TOOL_NAME,
  MCP_PROJECT_RISKS_TOOL_NAME,
  MCP_RISK_DETAIL_TOOL_NAME,
  MCP_RISK_TOOL_ERROR_MESSAGES,
} from "./mcp/operationalIssueReadTools.ts";
import {
  MCP_EXECUTION_UPDATE_TOOL_ERROR_MESSAGES,
  MCP_EXECUTION_UPDATES_TOOL_NAME,
  MCP_PHASE_DETAIL_TOOL_NAME,
  MCP_PHASE_TOOL_ERROR_MESSAGES,
  MCP_TASK_DETAIL_TOOL_NAME,
  MCP_TASK_TOOL_ERROR_MESSAGES,
} from "./mcp/executionContextReadTools.ts";
import { ApiHttpError } from "../_shared/btpm-api/http.ts";

const ENDPOINT = "https://example.test/functions/v1/btpm-mcp";
const METADATA_ENDPOINT =
  "https://example.test/functions/v1/btpm-mcp/.well-known/oauth-protected-resource";

const SUPABASE_URL = "https://project.supabase.co";
const EXPECTED_ISSUER = `${SUPABASE_URL}/auth/v1`;
const RESOURCE_URI = "https://api.example.test/functions/v1/btpm-mcp";
const METADATA_URL = `${RESOURCE_URI}/.well-known/oauth-protected-resource`;

const NOW_SECONDS = 1_800_000_000;
const USER_ID = "11111111-2222-4333-8444-555555555555";
const SIGNED_CLIENT_ID = "btpm-copilot-studio-client";
const API_CLIENT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const POLICY_VERSION_ID = "99999999-8888-4777-8666-555555555555";

const MODERN_PROTOCOL_VERSION = "2026-07-28";
const LEGACY_PROTOCOL_VERSION = "2025-06-18";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// -----------------------------------------------------------------------------
// Test doubles — no live Supabase, network, or environment access.
// -----------------------------------------------------------------------------

const VALID_TOKEN = "valid-mcp-token";

interface TokenFixture {
  readonly claims: VerifiedTokenClaims | null;
  readonly currentUserId: string | null;
}

const TOKENS = new Map<string, TokenFixture>([
  [VALID_TOKEN, {
    claims: {
      iss: EXPECTED_ISSUER,
      aud: RESOURCE_URI,
      exp: NOW_SECONDS + 600,
      sub: USER_ID,
      client_id: SIGNED_CLIENT_ID,
    },
    currentUserId: USER_ID,
  }],
  ["authenticated-audience-only", {
    claims: {
      iss: EXPECTED_ISSUER,
      aud: "authenticated",
      exp: NOW_SECONDS + 600,
      sub: USER_ID,
      client_id: SIGNED_CLIENT_ID,
    },
    currentUserId: USER_ID,
  }],
  ["wrong-issuer", {
    claims: {
      iss: "https://attacker.example/auth/v1",
      aud: RESOURCE_URI,
      exp: NOW_SECONDS + 600,
      sub: USER_ID,
      client_id: SIGNED_CLIENT_ID,
    },
    currentUserId: USER_ID,
  }],
  ["expired", {
    claims: {
      iss: EXPECTED_ISSUER,
      aud: RESOURCE_URI,
      exp: NOW_SECONDS - 1,
      sub: USER_ID,
      client_id: SIGNED_CLIENT_ID,
    },
    currentUserId: USER_ID,
  }],
]);

/** Records whether the MCP protocol layer was reached. */
let handlerReached = 0;

// -----------------------------------------------------------------------------
// API-Q.7A — Organizations vertical-slice doubles. No live Supabase, no SQL.
// -----------------------------------------------------------------------------

interface OrganizationsReadCall {
  readonly authorization: string | null;
  readonly oauthClientId: string;
  readonly tokenUserId: string;
  readonly apiClientId: string;
  readonly query: ApiV1OrganizationsQuery;
}

const ORGANIZATIONS_PAYLOAD: ApiV1OrganizationsPayload = Object.freeze({
  items: Object.freeze([
    Object.freeze({
      organizationId: "cccccccc-dddd-4eee-8fff-000000000001",
      name: "Example Organization",
      role: "org_member" as const,
    }),
  ]),
  pagination: Object.freeze({ limit: 50, offset: 0, returned: 1, total: 1 }),
});

let profileResolutions: Array<{ apiClientId: string; routeId: string }> = [];
let rateLimitConsumptions: ApiRateLimitStoreInput[] = [];
let organizationsReadCalls: OrganizationsReadCall[] = [];
let rateLimitAllowed = true;
let organizationsReadFailure: Error | null = null;

function resetOrganizationsSlice(): void {
  profileResolutions = [];
  rateLimitConsumptions = [];
  organizationsReadCalls = [];
  rateLimitAllowed = true;
  organizationsReadFailure = null;
}

function RATE_LIMIT_PROFILE_DOUBLE(
  apiClientId: string,
  routeId: string,
): Promise<ApiRateLimitProfile> {
  profileResolutions.push({ apiClientId, routeId });
  return Promise.resolve({ limit: 60, windowSeconds: 60 });
}

function RATE_LIMIT_STORE_DOUBLE(
  input: ApiRateLimitStoreInput,
): Promise<ApiRateLimitStoreResult> {
  rateLimitConsumptions.push(input);
  return Promise.resolve({
    allowed: rateLimitAllowed,
    remaining: rateLimitAllowed ? 59 : 0,
    resetAtEpochMs: input.nowEpochMs + 60_000,
  });
}

const SLICE_DEPENDENCIES = {
  get authorizationStore(): ClientAuthorizationStore {
    return AUTHORIZATION_STORE;
  },
  organizationsReader: (
    request: Request,
    context: AuthenticatedApiContext,
    query: ApiV1OrganizationsQuery,
  ) => ORGANIZATIONS_READER_DOUBLE(request, context, query),
  workspacesReader: (
    request: Request,
    context: AuthenticatedApiContext,
    query: ApiV1WorkspacesQuery,
  ) => WORKSPACES_READER_DOUBLE(request, context, query),
  projectsReader: (
    request: Request,
    context: AuthenticatedApiContext,
    query: ApiV1ProjectsQuery,
  ) => PROJECTS_READER_DOUBLE(request, context, query),
  programsReader: (
    request: Request,
    context: AuthenticatedApiContext,
    query: ApiV1ProgramsQuery,
  ) => PROGRAMS_READER_DOUBLE(request, context, query),
  programReader: (
    request: Request,
    context: AuthenticatedApiContext,
    programId: string,
  ) => PROGRAM_DETAIL_READER_DOUBLE(request, context, programId),
  projectDetailReader: (
    request: Request,
    context: AuthenticatedApiContext,
    projectId: string,
  ) => PROJECT_DETAIL_READER_DOUBLE(request, context, projectId),
  projectPlanningReader: (
    request: Request,
    context: AuthenticatedApiContext,
    projectId: string,
  ) => PROJECT_PLANNING_READER_DOUBLE(request, context, projectId),
  projectRisksReader: (
    request: Request,
    context: AuthenticatedApiContext,
    projectId: string,
    limit: number,
    cursor: ApiV1RiskCursor | null,
  ) => PROJECT_RISKS_READER_DOUBLE(request, context, projectId, limit, cursor),
  riskReader: (
    request: Request,
    context: AuthenticatedApiContext,
    riskId: string,
  ) => RISK_DETAIL_READER_DOUBLE(request, context, riskId),
  projectBlockersReader: (
    request: Request,
    context: AuthenticatedApiContext,
    projectId: string,
    limit: number,
    cursor: ApiV1BlockerCursor | null,
  ) => PROJECT_BLOCKERS_READER_DOUBLE(request, context, projectId, limit, cursor),
  blockerReader: (
    request: Request,
    context: AuthenticatedApiContext,
    blockerId: string,
  ) => BLOCKER_DETAIL_READER_DOUBLE(request, context, blockerId),
  executionUpdatesReader: (
    request: Request,
    context: AuthenticatedApiContext,
    targetType: string,
    targetId: string,
    limit: number,
    cursor: ApiV1ExecutionUpdateCursor | null,
  ) =>
    EXECUTION_UPDATES_READER_DOUBLE(
      request,
      context,
      targetType,
      targetId,
      limit,
      cursor,
    ),
  phaseReader: (
    request: Request,
    context: AuthenticatedApiContext,
    phaseId: string,
  ) => PHASE_DETAIL_READER_DOUBLE(request, context, phaseId),
  taskReader: (
    request: Request,
    context: AuthenticatedApiContext,
    taskId: string,
  ) => TASK_DETAIL_READER_DOUBLE(request, context, taskId),
  rateLimitProfileResolver: {
    resolve: (apiClientId: string, routeId: string) =>
      RATE_LIMIT_PROFILE_DOUBLE(apiClientId, routeId),
  },
  rateLimitStore: {
    consume: (input: ApiRateLimitStoreInput) => RATE_LIMIT_STORE_DOUBLE(input),
  },
};

function ORGANIZATIONS_READER_DOUBLE(
  request: Request,
  context: AuthenticatedApiContext,
  query: ApiV1OrganizationsQuery,
): Promise<ApiV1OrganizationsPayload> {
  organizationsReadCalls.push({
    authorization: request.headers.get("authorization"),
    oauthClientId: context.client.oauthClientId,
    tokenUserId: context.token.userId,
    apiClientId: context.client.apiClientId,
    query,
  });
  if (organizationsReadFailure !== null) {
    return Promise.reject(organizationsReadFailure);
  }
  return Promise.resolve(ORGANIZATIONS_PAYLOAD);
}

// -----------------------------------------------------------------------------
// API-Q.7B — workspaces.get vertical-slice doubles. No live Supabase, no SQL.
// -----------------------------------------------------------------------------

const ORGANIZATION_ID = "aaaaaaaa-bbbb-4ccc-8ddd-000000000001";

interface WorkspacesReadCall {
  readonly authorization: string | null;
  readonly oauthClientId: string;
  readonly tokenUserId: string;
  readonly apiClientId: string;
  readonly query: ApiV1WorkspacesQuery;
}

const WORKSPACES_PAYLOAD: ApiV1WorkspacesPayload = Object.freeze({
  items: Object.freeze([
    Object.freeze({
      workspaceId: "aaaaaaaa-bbbb-4ccc-8ddd-000000000002",
      organizationId: ORGANIZATION_ID,
      name: "Delivery",
    }),
  ]),
  pagination: Object.freeze({ limit: 50, offset: 0, returned: 1, total: 1 }),
});

let workspacesReadCalls: WorkspacesReadCall[] = [];
let workspacesReadFailure: Error | null = null;

function resetWorkspacesSlice(): void {
  profileResolutions = [];
  rateLimitConsumptions = [];
  workspacesReadCalls = [];
  rateLimitAllowed = true;
  workspacesReadFailure = null;
}

function WORKSPACES_READER_DOUBLE(
  request: Request,
  context: AuthenticatedApiContext,
  query: ApiV1WorkspacesQuery,
): Promise<ApiV1WorkspacesPayload> {
  workspacesReadCalls.push({
    authorization: request.headers.get("authorization"),
    oauthClientId: context.client.oauthClientId,
    tokenUserId: context.token.userId,
    apiClientId: context.client.apiClientId,
    query,
  });
  if (workspacesReadFailure !== null) {
    return Promise.reject(workspacesReadFailure);
  }
  return Promise.resolve(WORKSPACES_PAYLOAD);
}

// -----------------------------------------------------------------------------
// API-Q.7C — projects.get vertical-slice doubles. No live Supabase, no SQL.
// -----------------------------------------------------------------------------

const PROJECTS_WORKSPACE_ID = "aaaaaaaa-bbbb-4ccc-8ddd-000000000003";

interface ProjectsReadCall {
  readonly authorization: string | null;
  readonly oauthClientId: string;
  readonly tokenUserId: string;
  readonly apiClientId: string;
  readonly query: ApiV1ProjectsQuery;
}

const PROJECTS_PAYLOAD: ApiV1ProjectsPayload = Object.freeze({
  items: Object.freeze([
    Object.freeze({
      projectId: "aaaaaaaa-bbbb-4ccc-8ddd-000000000004",
      organizationId: ORGANIZATION_ID,
      workspaceId: PROJECTS_WORKSPACE_ID,
      programId: null,
      name: "SAP S/4 Rollout",
      status: "active",
      priority: "high",
      projectStage: null,
      deliveryModel: null,
      startDate: "2026-01-01",
      targetEndDate: null,
      agileEnabled: false,
      updatedAt: "2026-01-02T03:04:05.000Z",
    }),
  ]),
  pagination: Object.freeze({ limit: 50, offset: 0, returned: 1, total: 1 }),
});

let projectsReadCalls: ProjectsReadCall[] = [];
let projectsReadFailure: Error | null = null;

function resetProjectsSlice(): void {
  profileResolutions = [];
  rateLimitConsumptions = [];
  projectsReadCalls = [];
  rateLimitAllowed = true;
  projectsReadFailure = null;
}

function PROJECTS_READER_DOUBLE(
  request: Request,
  context: AuthenticatedApiContext,
  query: ApiV1ProjectsQuery,
): Promise<ApiV1ProjectsPayload> {
  projectsReadCalls.push({
    authorization: request.headers.get("authorization"),
    oauthClientId: context.client.oauthClientId,
    tokenUserId: context.token.userId,
    apiClientId: context.client.apiClientId,
    query,
  });
  if (projectsReadFailure !== null) {
    return Promise.reject(projectsReadFailure);
  }
  return Promise.resolve(PROJECTS_PAYLOAD);
}

// -----------------------------------------------------------------------------
// API-Q.7D — Program / Project context vertical-slice doubles. No live
// Supabase, no SQL, no service role.
// -----------------------------------------------------------------------------

const CONTEXT_WORKSPACE_ID = "aaaaaaaa-bbbb-4ccc-8ddd-000000000005";
const CONTEXT_PROGRAM_ID = "aaaaaaaa-bbbb-4ccc-8ddd-000000000006";
const CONTEXT_PROJECT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-000000000007";

interface ContextReadCall {
  readonly authorization: string | null;
  readonly oauthClientId: string;
  readonly tokenUserId: string;
  readonly apiClientId: string;
  readonly argument: ApiV1ProgramsQuery | string;
}

const PROGRAMS_PAYLOAD: ApiV1ProgramsPayload = Object.freeze({
  items: Object.freeze([
    Object.freeze({
      programId: CONTEXT_PROGRAM_ID,
      organizationId: ORGANIZATION_ID,
      workspaceId: CONTEXT_WORKSPACE_ID,
      name: "SAP Transformation",
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T03:04:05.000Z",
    }),
  ]),
  pagination: Object.freeze({ limit: 50, offset: 0, returned: 1, total: 1 }),
});

const PROGRAM_DETAIL_PAYLOAD: ApiV1ProgramDetailPayload = Object.freeze({
  programId: CONTEXT_PROGRAM_ID,
  organizationId: ORGANIZATION_ID,
  workspaceId: CONTEXT_WORKSPACE_ID,
  name: "SAP Transformation",
  description: null,
  status: "active",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T03:04:05.000Z",
});

const PROJECT_DETAIL_PAYLOAD: ApiV1ProjectDetailPayload = Object.freeze({
  projectId: CONTEXT_PROJECT_ID,
  organizationId: ORGANIZATION_ID,
  workspaceId: CONTEXT_WORKSPACE_ID,
  programId: CONTEXT_PROGRAM_ID,
  portfolioItemId: null,
  name: "SAP S/4 Rollout",
  description: null,
  status: "active",
  priority: "high",
  projectStage: null,
  deliveryModel: null,
  startDate: "2026-01-01",
  targetEndDate: null,
  actualStartDate: null,
  actualEndDate: null,
  agileEnabled: false,
  updatedAt: "2026-01-02T03:04:05.000Z",
  charter: null,
  goals: null,
  scopeIn: null,
  scopeOut: null,
  businessCase: null,
  successCriteria: null,
  completionCriteria: null,
  budgetNarrative: null,
  assumptions: null,
  constraints: null,
});

const PROJECT_PLANNING_PAYLOAD: ApiV1ProjectPlanningPayload = Object.freeze({
  project: Object.freeze({
    projectId: CONTEXT_PROJECT_ID,
    name: "SAP S/4 Rollout",
    startDate: "2026-01-01",
    targetEndDate: null,
    actualStartDate: null,
    actualEndDate: null,
    isBaselined: false,
  }),
  phases: Object.freeze([]),
  tasks: Object.freeze([]),
  dependencies: Object.freeze([]),
});

let contextReadCalls: ContextReadCall[] = [];
let contextReadFailure: Error | null = null;

function resetContextSlice(): void {
  profileResolutions = [];
  rateLimitConsumptions = [];
  contextReadCalls = [];
  rateLimitAllowed = true;
  contextReadFailure = null;
}

function recordContextRead(
  request: Request,
  context: AuthenticatedApiContext,
  argument: ApiV1ProgramsQuery | string,
): void {
  contextReadCalls.push({
    authorization: request.headers.get("authorization"),
    oauthClientId: context.client.oauthClientId,
    tokenUserId: context.token.userId,
    apiClientId: context.client.apiClientId,
    argument,
  });
}

function PROGRAMS_READER_DOUBLE(
  request: Request,
  context: AuthenticatedApiContext,
  query: ApiV1ProgramsQuery,
): Promise<ApiV1ProgramsPayload> {
  recordContextRead(request, context, query);
  if (contextReadFailure !== null) return Promise.reject(contextReadFailure);
  return Promise.resolve(PROGRAMS_PAYLOAD);
}

function PROGRAM_DETAIL_READER_DOUBLE(
  request: Request,
  context: AuthenticatedApiContext,
  programId: string,
): Promise<ApiV1ProgramDetailPayload> {
  recordContextRead(request, context, programId);
  if (contextReadFailure !== null) return Promise.reject(contextReadFailure);
  return Promise.resolve(PROGRAM_DETAIL_PAYLOAD);
}

function PROJECT_DETAIL_READER_DOUBLE(
  request: Request,
  context: AuthenticatedApiContext,
  projectId: string,
): Promise<ApiV1ProjectDetailPayload> {
  recordContextRead(request, context, projectId);
  if (contextReadFailure !== null) return Promise.reject(contextReadFailure);
  return Promise.resolve(PROJECT_DETAIL_PAYLOAD);
}

function PROJECT_PLANNING_READER_DOUBLE(
  request: Request,
  context: AuthenticatedApiContext,
  projectId: string,
): Promise<ApiV1ProjectPlanningPayload> {
  recordContextRead(request, context, projectId);
  if (contextReadFailure !== null) return Promise.reject(contextReadFailure);
  return Promise.resolve(PROJECT_PLANNING_PAYLOAD);
}



// -----------------------------------------------------------------------------
// API-Q.7E — Operational execution read vertical-slice doubles. No live
// Supabase, no SQL, no service role.
// -----------------------------------------------------------------------------

const OPS_PROJECT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-000000000011";
const OPS_RISK_ID = "aaaaaaaa-bbbb-4ccc-8ddd-000000000012";
const OPS_BLOCKER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-000000000013";
const OPS_PHASE_ID = "aaaaaaaa-bbbb-4ccc-8ddd-000000000014";
const OPS_TASK_ID = "aaaaaaaa-bbbb-4ccc-8ddd-000000000015";

interface OperationalReadCall {
  readonly authorization: string | null;
  readonly oauthClientId: string;
  readonly tokenUserId: string;
  readonly apiClientId: string;
  readonly argument: unknown;
}

const RISK_ITEM: ApiV1RiskReadItem = Object.freeze({
  riskId: OPS_RISK_ID,
  projectId: OPS_PROJECT_ID,
  targetType: "project",
  targetId: OPS_PROJECT_ID,
  title: "Integration slippage",
  description: null,
  mitigationPlan: null,
  likelihood: "medium",
  impact: "high",
  status: "open",
  updatedAt: "2026-01-02T03:04:05.000Z",
});

const PROJECT_RISKS_PAYLOAD: ApiV1ProjectRisksPayload = Object.freeze({
  items: Object.freeze([RISK_ITEM]),
  nextCursor: null,
});

const BLOCKER_ITEM: ApiV1BlockerReadItem = Object.freeze({
  blockerId: OPS_BLOCKER_ID,
  projectId: OPS_PROJECT_ID,
  targetType: "project",
  targetId: OPS_PROJECT_ID,
  title: "Awaiting sandbox refresh",
  description: null,
  severity: "high",
  status: "open",
  resolvedAt: null,
  updatedAt: "2026-01-02T03:04:05.000Z",
  resolvedBy: null,
});

const PROJECT_BLOCKERS_PAYLOAD: ApiV1ProjectBlockersPayload = Object.freeze({
  items: Object.freeze([BLOCKER_ITEM]),
  nextCursor: null,
});

const EXECUTION_UPDATES_PAYLOAD: ApiV1ExecutionUpdatesPayload = Object.freeze({
  items: Object.freeze([
    Object.freeze({
      executionUpdateId: "aaaaaaaa-bbbb-4ccc-8ddd-000000000016",
      targetType: "phase",
      targetId: OPS_PHASE_ID,
      authorId: USER_ID,
      summary: "Cutover dry run completed.",
      statusLabel: null,
      updateDate: "2026-01-02",
      createdAt: "2026-01-02T03:04:05.000Z",
    }),
  ]),
  nextCursor: null,
});

const PHASE_DETAIL_PAYLOAD: ApiV1PhaseReadItem = Object.freeze({
  phaseId: OPS_PHASE_ID,
  projectId: OPS_PROJECT_ID,
  name: "Realize",
  description: null,
  status: "active",
  phaseType: "work_item",
  sortOrder: 1,
  startDate: "2026-01-01",
  targetEndDate: null,
  baselineStartDate: null,
  baselineEndDate: null,
  addedAfterBaseline: false,
  actualStartDate: null,
  actualEndDate: null,
  updatedAt: "2026-01-02T03:04:05.000Z",
});

const TASK_DETAIL_PAYLOAD: ApiV1TaskReadItem = Object.freeze({
  taskId: OPS_TASK_ID,
  projectId: OPS_PROJECT_ID,
  phaseId: OPS_PHASE_ID,
  name: "Configure FI module",
  description: null,
  status: "active",
  priority: "high",
  taskType: "work_item",
  sortOrder: 1,
  startDate: "2026-01-01",
  dueDate: null,
  baselineStartDate: null,
  baselineEndDate: null,
  addedAfterBaseline: false,
  actualStartDate: null,
  actualEndDate: null,
  estimatedHours: null,
  assigneeId: null,
  updatedAt: "2026-01-02T03:04:05.000Z",
});

let operationalReadCalls: OperationalReadCall[] = [];
let operationalReadFailure: Error | null = null;

function resetOperationalSlice(): void {
  profileResolutions = [];
  rateLimitConsumptions = [];
  operationalReadCalls = [];
  rateLimitAllowed = true;
  operationalReadFailure = null;
}

function recordOperationalRead(
  request: Request,
  context: AuthenticatedApiContext,
  argument: unknown,
): void {
  operationalReadCalls.push({
    authorization: request.headers.get("authorization"),
    oauthClientId: context.client.oauthClientId,
    tokenUserId: context.token.userId,
    apiClientId: context.client.apiClientId,
    argument,
  });
}

function PROJECT_RISKS_READER_DOUBLE(
  request: Request,
  context: AuthenticatedApiContext,
  projectId: string,
  limit: number,
  cursor: ApiV1RiskCursor | null,
): Promise<ApiV1ProjectRisksPayload> {
  recordOperationalRead(request, context, { projectId, limit, cursor });
  if (operationalReadFailure !== null) {
    return Promise.reject(operationalReadFailure);
  }
  return Promise.resolve(PROJECT_RISKS_PAYLOAD);
}

function RISK_DETAIL_READER_DOUBLE(
  request: Request,
  context: AuthenticatedApiContext,
  riskId: string,
): Promise<ApiV1RiskReadItem> {
  recordOperationalRead(request, context, riskId);
  if (operationalReadFailure !== null) {
    return Promise.reject(operationalReadFailure);
  }
  return Promise.resolve(RISK_ITEM);
}

function PROJECT_BLOCKERS_READER_DOUBLE(
  request: Request,
  context: AuthenticatedApiContext,
  projectId: string,
  limit: number,
  cursor: ApiV1BlockerCursor | null,
): Promise<ApiV1ProjectBlockersPayload> {
  recordOperationalRead(request, context, { projectId, limit, cursor });
  if (operationalReadFailure !== null) {
    return Promise.reject(operationalReadFailure);
  }
  return Promise.resolve(PROJECT_BLOCKERS_PAYLOAD);
}

function BLOCKER_DETAIL_READER_DOUBLE(
  request: Request,
  context: AuthenticatedApiContext,
  blockerId: string,
): Promise<ApiV1BlockerReadItem> {
  recordOperationalRead(request, context, blockerId);
  if (operationalReadFailure !== null) {
    return Promise.reject(operationalReadFailure);
  }
  return Promise.resolve(BLOCKER_ITEM);
}

function EXECUTION_UPDATES_READER_DOUBLE(
  request: Request,
  context: AuthenticatedApiContext,
  targetType: string,
  targetId: string,
  limit: number,
  cursor: ApiV1ExecutionUpdateCursor | null,
): Promise<ApiV1ExecutionUpdatesPayload> {
  recordOperationalRead(request, context, {
    targetType,
    targetId,
    limit,
    cursor,
  });
  if (operationalReadFailure !== null) {
    return Promise.reject(operationalReadFailure);
  }
  return Promise.resolve(EXECUTION_UPDATES_PAYLOAD);
}

function PHASE_DETAIL_READER_DOUBLE(
  request: Request,
  context: AuthenticatedApiContext,
  phaseId: string,
): Promise<ApiV1PhaseReadItem> {
  recordOperationalRead(request, context, phaseId);
  if (operationalReadFailure !== null) {
    return Promise.reject(operationalReadFailure);
  }
  return Promise.resolve(PHASE_DETAIL_PAYLOAD);
}

function TASK_DETAIL_READER_DOUBLE(
  request: Request,
  context: AuthenticatedApiContext,
  taskId: string,
): Promise<ApiV1TaskReadItem> {
  recordOperationalRead(request, context, taskId);
  if (operationalReadFailure !== null) {
    return Promise.reject(operationalReadFailure);
  }
  return Promise.resolve(TASK_DETAIL_PAYLOAD);
}

// -----------------------------------------------------------------------------
// API-Q.5 — in-memory Connected App authorization store double. It implements
// only the accepted `ClientAuthorizationStore` contract; every governance rule
// under test lives in canonical `authorizeClient`.
// -----------------------------------------------------------------------------

interface StoreFixture {
  clients: ActiveApiClientRecord[];
  versions: ActivePolicyVersionRecord[];
  acknowledgement: PolicyAcknowledgementRecord | null;
  failWith?: string;
}

function activeClientFixture(): StoreFixture {
  return {
    clients: [{
      id: API_CLIENT_ID,
      oauthClientId: SIGNED_CLIENT_ID,
      lifecycleStatus: "active",
    }],
    versions: [{
      id: POLICY_VERSION_ID,
      apiClientId: API_CLIENT_ID,
      lifecycleStatus: "active",
    }],
    acknowledgement: {
      id: "ack-1",
      userId: USER_ID,
      apiClientId: API_CLIENT_ID,
      policyVersionId: POLICY_VERSION_ID,
      revokedAt: null,
    },
  };
}

let storeFixture: StoreFixture = activeClientFixture();
let storeLookups: string[] = [];

const AUTHORIZATION_STORE: ClientAuthorizationStore = {
  findActiveClientsByOauthClientId(oauthClientId: string) {
    storeLookups.push(oauthClientId);
    if (storeFixture.failWith === "clients") {
      return Promise.reject(new Error("supabase_query_error"));
    }
    return Promise.resolve(
      storeFixture.clients.filter((c) => c.oauthClientId === oauthClientId),
    );
  },
  findActivePolicyVersionsForClient(apiClientId: string) {
    if (storeFixture.failWith === "versions") {
      return Promise.reject(new Error("supabase_query_error"));
    }
    return Promise.resolve(
      storeFixture.versions.filter((v) => v.apiClientId === apiClientId),
    );
  },
  findUserAcknowledgement() {
    if (storeFixture.failWith === "ack") {
      return Promise.reject(new Error("acknowledgement_ambiguous"));
    }
    return Promise.resolve(storeFixture.acknowledgement);
  },
};

function buildRuntime(): BtpmMcpRuntime {
  const deps: TokenContextDependencies = {
    tokenVerifier: {
      verify(token: string): Promise<VerifiedTokenClaims> {
        const fixture = TOKENS.get(token);
        if (!fixture || fixture.claims === null) {
          return Promise.reject(new Error("token_verification_failed"));
        }
        return Promise.resolve(fixture.claims);
      },
    },
    currentUserResolver: {
      resolveCurrentUserId(token: string): Promise<string | null> {
        return Promise.resolve(TOKENS.get(token)?.currentUserId ?? null);
      },
    },
    clock: { nowSeconds: () => NOW_SECONDS },
  };
  return createBtpmMcpRuntime({
    resourceUri: RESOURCE_URI,
    supabaseUrl: SUPABASE_URL,
    tokenDependencies: deps,
    authorizationStore: AUTHORIZATION_STORE,
    organizationsReader: (request, context, query) =>
      ORGANIZATIONS_READER_DOUBLE(request, context, query),
    workspacesReader: (request, context, query) =>
      WORKSPACES_READER_DOUBLE(request, context, query),
    projectsReader: (request, context, query) =>
      PROJECTS_READER_DOUBLE(request, context, query),
    programsReader: (request, context, query) =>
      PROGRAMS_READER_DOUBLE(request, context, query),
    programReader: (request, context, programId) =>
      PROGRAM_DETAIL_READER_DOUBLE(request, context, programId),
    projectDetailReader: (request, context, projectId) =>
      PROJECT_DETAIL_READER_DOUBLE(request, context, projectId),
    projectPlanningReader: (request, context, projectId) =>
      PROJECT_PLANNING_READER_DOUBLE(request, context, projectId),
    projectRisksReader: (request, context, projectId, limit, cursor) =>
      PROJECT_RISKS_READER_DOUBLE(request, context, projectId, limit, cursor),
    riskReader: (request, context, riskId) =>
      RISK_DETAIL_READER_DOUBLE(request, context, riskId),
    projectBlockersReader: (request, context, projectId, limit, cursor) =>
      PROJECT_BLOCKERS_READER_DOUBLE(request, context, projectId, limit, cursor),
    blockerReader: (request, context, blockerId) =>
      BLOCKER_DETAIL_READER_DOUBLE(request, context, blockerId),
    executionUpdatesReader: (
      request,
      context,
      targetType,
      targetId,
      limit,
      cursor,
    ) =>
      EXECUTION_UPDATES_READER_DOUBLE(
        request,
        context,
        targetType,
        targetId,
        limit,
        cursor,
      ),
    phaseReader: (request, context, phaseId) =>
      PHASE_DETAIL_READER_DOUBLE(request, context, phaseId),
    taskReader: (request, context, taskId) =>
      TASK_DETAIL_READER_DOUBLE(request, context, taskId),
    rateLimitProfileResolver: {
      resolve: (apiClientId, routeId) =>
        RATE_LIMIT_PROFILE_DOUBLE(apiClientId, routeId),
    },
    rateLimitStore: { consume: (input) => RATE_LIMIT_STORE_DOUBLE(input) },
    now: () => NOW_SECONDS * 1000,
  });
}

const RUNTIME = buildRuntime();

function serve(request: Request): Promise<Response> {
  return handleBtpmMcpRequest(request, RUNTIME);
}

/** Every protocol test runs against the fully authorized Connected App. */
function resetAuthorization(): void {
  storeFixture = activeClientFixture();
  storeLookups = [];
}

function post(
  body: unknown,
  headers: Record<string, string> = {},
  token: string | null = VALID_TOKEN,
): Request {
  const base: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  if (token !== null) base.authorization = `Bearer ${token}`;
  return new Request(ENDPOINT, {
    method: "POST",
    headers: { ...base, ...headers },
    body: JSON.stringify(body),
  });
}

/**
 * The 2026-07-28 per-request `_meta` envelope required by the SDK on modern
 * non-initialize requests.
 */
function modernEnvelope(): Record<string, unknown> {
  return {
    "io.modelcontextprotocol/protocolVersion": MODERN_PROTOCOL_VERSION,
    "io.modelcontextprotocol/clientCapabilities": {},
    "io.modelcontextprotocol/clientInfo": {
      name: "api-q-3-test-client",
      version: "0.0.0",
    },
  };
}

function initializeRequest(protocolVersion: string): unknown {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion,
      capabilities: {},
      clientInfo: { name: "api-q-3-test-client", version: "0.0.0" },
    },
  };
}

/** Reads a single JSON-RPC payload from either a JSON or SSE response body. */
async function readJsonRpc(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    for (const line of text.split("\n")) {
      if (line.startsWith("data:")) {
        return JSON.parse(line.slice("data:".length).trim());
      }
    }
    throw new Error("no SSE data frame in response");
  }
  return JSON.parse(text);
}

async function initializeModern(): Promise<{
  response: Response;
  payload: Record<string, unknown>;
}> {
  const response = await serve(post(initializeRequest(MODERN_PROTOCOL_VERSION)));
  return { response, payload: await readJsonRpc(response) };
}

// -----------------------------------------------------------------------------
// API-Q.3 protocol behavior (authenticated where authentication now applies)
// -----------------------------------------------------------------------------

Deno.test("API-Q.3 A/B: modern Streamable HTTP initialize returns BTPM identity and only tools capability", async () => {
  const { response, payload } = await initializeModern();
  assertStrictEquals(response.status, 200);

  const result = payload.result as Record<string, unknown>;
  const serverInfo = result.serverInfo as Record<string, unknown>;
  assertStrictEquals(serverInfo.name, BTPM_MCP_SERVER_NAME);
  assertStrictEquals(serverInfo.version, BTPM_MCP_SERVER_VERSION);

  const capabilities = result.capabilities as Record<string, unknown>;
  assert("tools" in capabilities, "tools capability must be advertised");
  for (const forbidden of ["resources", "prompts", "sampling", "elicitation"]) {
    assertEquals(forbidden in capabilities, false);
  }
});

Deno.test("API-Q.3 C: legacy-stateless initialization remains compatible", async () => {
  const response = await serve(post(initializeRequest(LEGACY_PROTOCOL_VERSION)));
  assertStrictEquals(response.status, 200);
  const payload = await readJsonRpc(response);
  const result = payload.result as Record<string, unknown>;
  const serverInfo = result.serverInfo as Record<string, unknown>;
  assertStrictEquals(serverInfo.name, BTPM_MCP_SERVER_NAME);
  assertStrictEquals(payload.error, undefined);
});

Deno.test("API-Q.3 D / API-Q.7D: tools/list exposes exactly the fourteen accepted read tools", async () => {
  // API-Q.8: the registry declares all 37 canonical operations explicitly;
  // exactly 14 remain EXPOSED, and only exposed entries reach tools/list.
  assertStrictEquals(MCP_TOOL_REGISTRY.length, 38);
  assertStrictEquals(exposedMcpTools().length, 14);

  const response = await serve(
    post({ jsonrpc: "2.0", id: 2, method: "tools/list", params: { _meta: modernEnvelope() } }, {
      "mcp-protocol-version": MODERN_PROTOCOL_VERSION,
      "mcp-method": "tools/list",
    }),
  );
  assertStrictEquals(response.status, 200);
  const payload = await readJsonRpc(response);
  const result = payload.result as { tools?: Array<{ name?: string }> } | undefined;
  assert(result !== undefined, `expected a result, got ${JSON.stringify(payload)}`);
  assertEquals((result.tools ?? []).map((t) => t.name), [
    MCP_ORGANIZATIONS_TOOL_NAME,
    MCP_WORKSPACES_TOOL_NAME,
    MCP_PROJECTS_TOOL_NAME,
    MCP_PROGRAMS_TOOL_NAME,
    MCP_PROGRAM_DETAIL_TOOL_NAME,
    MCP_PROJECT_DETAIL_TOOL_NAME,
    MCP_PROJECT_PLANNING_TOOL_NAME,
    MCP_PROJECT_RISKS_TOOL_NAME,
    MCP_RISK_DETAIL_TOOL_NAME,
    MCP_PROJECT_BLOCKERS_TOOL_NAME,
    MCP_BLOCKER_DETAIL_TOOL_NAME,
    MCP_EXECUTION_UPDATES_TOOL_NAME,
    MCP_PHASE_DETAIL_TOOL_NAME,
    MCP_TASK_DETAIL_TOOL_NAME,
  ]);
});

Deno.test("API-Q.3 E: tools/call for an unknown tool fails bounded with no BTPM execution", async () => {
  const response = await serve(
    post({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "btpm_projects_delete_everything",
        arguments: {},
        _meta: modernEnvelope(),
      },
    }, {
      "mcp-protocol-version": MODERN_PROTOCOL_VERSION,
      "mcp-method": "tools/call",
      "mcp-name": "btpm_projects_delete_everything",
    }),
  );
  assertStrictEquals(response.status, 200);
  const payload = await readJsonRpc(response);
  const serialized = JSON.stringify(payload);
  assert(
    payload.error !== undefined ||
      (payload.result as { isError?: boolean }).isError === true,
    `expected a bounded protocol error, got ${serialized}`,
  );
  assertEquals(serialized.includes("btpm_projects_delete_everything"), true);
});

Deno.test("API-Q.3 F / API-Q.4 N: unsupported HTTP methods return 405", async () => {
  for (const method of ["GET", "DELETE", "PUT", "PATCH"]) {
    const response = await serve(new Request(ENDPOINT, { method }));
    assertStrictEquals(response.status, 405, `${method} must be rejected`);
    assertStrictEquals(response.headers.get("allow"), "POST");
    await response.text();
  }
});

Deno.test("API-Q.3 G / API-Q.4 O: mismatching Origin fails closed with 403 before authentication", async () => {
  const response = await serve(
    post(initializeRequest(MODERN_PROTOCOL_VERSION), {
      origin: "https://attacker.example",
    }, null),
  );
  assertStrictEquals(response.status, 403);
  assertEquals(response.headers.get("access-control-allow-origin"), null);
  assertEquals(response.headers.get("www-authenticate"), null);
  await response.text();
});

Deno.test("API-Q.3 G: exactly matching Origin reaches protocol handling", async () => {
  const response = await serve(
    post(initializeRequest(MODERN_PROTOCOL_VERSION), {
      origin: new URL(ENDPOINT).origin,
    }),
  );
  assertStrictEquals(response.status, 200);
  await response.text();
});

Deno.test("API-Q.3 H: requests with no Origin header reach protocol handling", async () => {
  const { response } = await initializeModern();
  assertStrictEquals(response.status, 200);
});

Deno.test("API-Q.3 I / API-Q.4 P: every response carries a server-generated X-BTPM-Request-ID", async () => {
  const spoofed = "11111111-1111-1111-1111-111111111111";

  const modern = await serve(
    post(initializeRequest(MODERN_PROTOCOL_VERSION), {
      [BTPM_MCP_REQUEST_ID_HEADER]: spoofed,
    }),
  );
  const modernId = modern.headers.get(BTPM_MCP_REQUEST_ID_HEADER);
  assert(modernId !== null && UUID_PATTERN.test(modernId));
  assert(modernId !== spoofed, "caller-supplied correlation IDs are not trusted");
  await modern.text();

  const rejectedMethod = await serve(new Request(ENDPOINT, { method: "GET" }));
  const methodId = rejectedMethod.headers.get(BTPM_MCP_REQUEST_ID_HEADER);
  assert(methodId !== null && UUID_PATTERN.test(methodId));
  await rejectedMethod.text();

  const rejectedOrigin = await serve(
    post(initializeRequest(MODERN_PROTOCOL_VERSION), {
      origin: "https://attacker.example",
    }),
  );
  const originId = rejectedOrigin.headers.get(BTPM_MCP_REQUEST_ID_HEADER);
  assert(originId !== null && UUID_PATTERN.test(originId));
  assert(originId !== modernId, "correlation IDs are per-request");
  await rejectedOrigin.text();

  const unauthenticated = await serve(
    post(initializeRequest(MODERN_PROTOCOL_VERSION), {}, null),
  );
  const unauthId = unauthenticated.headers.get(BTPM_MCP_REQUEST_ID_HEADER);
  assert(unauthId !== null && UUID_PATTERN.test(unauthId));
  await unauthenticated.text();

  const metadata = await serve(new Request(METADATA_ENDPOINT, { method: "GET" }));
  const metadataId = metadata.headers.get(BTPM_MCP_REQUEST_ID_HEADER);
  assert(metadataId !== null && UUID_PATTERN.test(metadataId));
  await metadata.text();
});

/** Drops `//` comment lines so static scans inspect executable code only. */
function stripComments(source: string): string {
  return source
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//") && !line.trimStart().startsWith("*") && !line.trimStart().startsWith("/*"))
    .join("\n");
}

Deno.test("API-Q.3 / API-Q.5 O/P: the shell performs no SQL or RPC access and confines the service role to the authorization store", () => {
  const shell = Deno.readTextFileSync(new URL("./index.ts", import.meta.url));
  const factory = Deno.readTextFileSync(
    new URL("./mcp/serverFactory.ts", import.meta.url),
  );
  const binder = Deno.readTextFileSync(
    new URL("./mcp/authorizeMcpConnectedApp.ts", import.meta.url),
  );
  const binderCode = stripComments(binder);

  for (const source of [shell, factory, binder]) {
    for (const forbidden of [".rpc(", "select ", "operationId]", ".from("]) {
      assertEquals(
        source.includes(forbidden),
        false,
        `MCP shell must not contain ${forbidden}`,
      );
    }
  }

  // The Connected App binder and the MCP server factory never see the service role.
  assertEquals(stripComments(factory).includes("SERVICE_ROLE"), false);
  assertEquals(binderCode.includes("SERVICE_ROLE"), false);
  assertEquals(binderCode.includes("createClient"), false);
  assertEquals(binderCode.includes("Deno.env"), false);

  // The shell reads the service-role key exactly once and passes the privileged
  // client exclusively into the canonical authorization store.
  assertStrictEquals(
    shell.split("SUPABASE_SERVICE_ROLE_KEY").length - 1,
    1,
  );
  // The single privileged client is referenced exactly twice: its typed
  // declaration and the canonical Connected App store construction.
  // UX-GAP.1B1: the single privileged client is referenced only by its
  // declaration and the three accepted infrastructure adapters (authorization
  // store + rate limiting + MCP connection-verification evidence recording).
  const privilegedUses = stripComments(shell).split("privilegedClient").length - 1;
  assertStrictEquals(privilegedUses, 4);
  assert(
    shell.includes("privilegedClient as unknown as SupabaseAuthorizationServerClient"),
    "the privileged client must construct the Connected App store",
  );
  // The business read is caller-scoped through the accepted anon-key reader.
  assert(
    shell.includes("createDelegatedApiV1OrganizationsReader(\n      String(supabaseUrl),\n      supabaseAnonKey,"),
    "Organizations must be read with the anon key + caller bearer token",
  );
  // The MCP server factory receives only trusted provenance and bounded executors.
  assert(
    shell.includes(
      "createBtpmMcpServer(executionContext, {\n        organizationsGet,\n        workspacesGet,\n        projectsGet,\n        programsGet,\n        programGetById,\n        projectGetById,\n        projectPlanningGet,\n        risksGet,\n        riskGetById,\n        blockersGet,\n        blockerGetById,\n        executionUpdatesGet,\n        phaseGetById,\n        taskGetById,\n      })",
    ),
    "the server factory must receive exactly the fourteen accepted read executors",
  );
  // API-Q.7B: Workspaces are likewise read caller-scoped with the anon key.
  assert(
    shell.includes("createDelegatedApiV1WorkspacesReader(\n      String(supabaseUrl),\n      supabaseAnonKey,"),
    "Workspaces must be read with the anon key + caller bearer token",
  );
  // API-Q.7C: Projects are likewise read caller-scoped with the anon key.
  assert(
    shell.includes("createDelegatedApiV1ProjectsReader(\n      String(supabaseUrl),\n      supabaseAnonKey,"),
    "Projects must be read with the anon key + caller bearer token",
  );
  // API-Q.7D: Program / Project context reads use the same caller-scoped shape.
  for (
    const factory of [
      "createDelegatedApiV1ProgramsReader",
      "createDelegatedApiV1ProgramReader",
      "createDelegatedApiV1ProjectDetailReader",
      "createDelegatedApiV1ProjectPlanningReader",
    ]
  ) {
    assert(
      shell.includes(`${factory}(\n      String(supabaseUrl),\n      supabaseAnonKey,`),
      `${factory} must use the anon key + caller bearer token`,
    );
  }
});

// -----------------------------------------------------------------------------
// API-Q.4 — OAuth protected-resource boundary
// -----------------------------------------------------------------------------

Deno.test("API-Q.4 A/B/C/M: protected-resource metadata is public, canonical, and business-free", async () => {
  const response = await serve(new Request(METADATA_ENDPOINT, { method: "GET" }));
  assertStrictEquals(response.status, 200);
  assertEquals(
    (response.headers.get("content-type") ?? "").includes("application/json"),
    true,
  );
  const body = await response.json() as Record<string, unknown>;

  // A: canonical resource URI.
  assertStrictEquals(body.resource, RESOURCE_URI);
  // B: existing Supabase Auth issuer.
  assertEquals(body.authorization_servers, [EXPECTED_ISSUER]);
  // C: no DCR behavior and no invented BTPM business scopes.
  const serialized = JSON.stringify(body);
  for (
    const forbidden of [
      "registration_endpoint",
      "scopes_supported",
      "btpm:",
      "client_secret",
      "apikey",
    ]
  ) {
    assertEquals(
      serialized.includes(forbidden),
      false,
      `metadata must not contain ${forbidden}`,
    );
  }
});

Deno.test("API-Q.4 D/E: missing bearer token returns 401 with the exact resource_metadata URL", async () => {
  const response = await serve(
    post(initializeRequest(MODERN_PROTOCOL_VERSION), {}, null),
  );
  assertStrictEquals(response.status, 401);
  const challenge = response.headers.get("www-authenticate") ?? "";
  assert(challenge.startsWith("Bearer "), challenge);
  assert(
    challenge.includes(`resource_metadata="${METADATA_URL}"`),
    challenge,
  );
  const body = await response.text();
  assertEquals(body.includes(VALID_TOKEN), false);
  assertEquals(body.includes("missing_bearer_token"), false);
});

Deno.test("API-Q.4 F/G/H: malformed, invalid, expired, wrong-issuer and authenticated-only tokens all fail 401", async () => {
  const cases: Array<Record<string, string>> = [
    { authorization: "Bearer" },
    { authorization: "Basic abc" },
    { authorization: "Bearer not-a-known-token" },
    { authorization: "Bearer expired" },
    { authorization: "Bearer wrong-issuer" },
    { authorization: "Bearer authenticated-audience-only" },
  ];
  for (const headers of cases) {
    const response = await serve(
      new Request(ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...headers,
        },
        body: JSON.stringify(initializeRequest(MODERN_PROTOCOL_VERSION)),
      }),
    );
    assertStrictEquals(
      response.status,
      401,
      `${headers.authorization} must not authenticate`,
    );
    assert((response.headers.get("www-authenticate") ?? "").includes(METADATA_URL));
    await response.text();
  }
});

Deno.test("API-Q.4 I: audience equal to the canonical MCP resource URI succeeds", async () => {
  const { response, payload } = await initializeModern();
  assertStrictEquals(response.status, 200);
  assertStrictEquals(payload.error, undefined);
});

Deno.test("API-Q.4 J/K: signed client_id is retained and caller-provided identity cannot override it", async () => {
  const { authenticateMcpRequest } = await import(
    "./mcp/authenticateMcpRequest.ts"
  );
  const request = post(initializeRequest(MODERN_PROTOCOL_VERSION), {
    "x-client-id": "attacker-client",
    "client_id": "attacker-client",
  });
  const context = await authenticateMcpRequest(
    request,
    { expectedIssuer: EXPECTED_ISSUER, resourceUri: RESOURCE_URI },
    RUNTIME.tokenDependencies,
    "req-1",
  );
  assertStrictEquals(context.clientId, SIGNED_CLIENT_ID);
  assertStrictEquals(context.userId, USER_ID);
  assertStrictEquals(context.issuer, EXPECTED_ISSUER);
  assertEquals([...context.audiences], [RESOURCE_URI]);
  assertStrictEquals(context.expiresAt, NOW_SECONDS + 600);
  assertStrictEquals(context.resourceUri, RESOURCE_URI);
  assertStrictEquals(context.requestId, "req-1");
  // No tenant/org/workspace/project/role/capability/provenance fields exist.
  for (
    const forbidden of [
      "tenantId",
      "organizationId",
      "workspaceId",
      "projectId",
      "roles",
      "capabilities",
      "sourceChannel",
    ]
  ) {
    assertEquals(forbidden in context, false, `${forbidden} must not exist`);
  }
});

Deno.test("API-Q.4 L: unauthenticated MCP requests never reach the MCP handler", async () => {
  handlerReached = 0;
  const response = await serve(
    post({
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: { name: "anything", arguments: {}, _meta: modernEnvelope() },
    }, {
      "mcp-protocol-version": MODERN_PROTOCOL_VERSION,
      "mcp-method": "tools/call",
      "mcp-name": "anything",
    }, null),
  );
  assertStrictEquals(response.status, 401);
  const body = await response.text();
  // No JSON-RPC protocol result/echo of the requested tool may appear.
  assertEquals(body.includes("anything"), false);
  assertEquals(body.includes("jsonrpc"), false);
  assertStrictEquals(handlerReached, 0);
});

Deno.test("API-Q.4: canonical resource URI configuration fails closed", () => {
  const deps = RUNTIME.tokenDependencies;
  const invalid: unknown[] = [
    undefined,
    "",
    "http://insecure.example/functions/v1/btpm-mcp",
    "https://user:pass@example.test/btpm-mcp",
    "https://example.test/btpm-mcp?x=1",
    "https://example.test/btpm-mcp#frag",
    "not-a-url",
  ];
  for (const value of invalid) {
    let threw = false;
    try {
      createBtpmMcpRuntime({
        resourceUri: value,
        supabaseUrl: SUPABASE_URL,
        tokenDependencies: deps,
        ...SLICE_DEPENDENCIES,
      });
    } catch {
      threw = true;
    }
    assert(threw, `${String(value)} must be rejected`);
  }
  // Trailing slash is the only normalization performed.
  assertStrictEquals(
    createBtpmMcpRuntime({
      resourceUri: `${RESOURCE_URI}/`,
      supabaseUrl: `${SUPABASE_URL}/`,
      tokenDependencies: deps,
      ...SLICE_DEPENDENCIES,
    }).resourceUri,
    RESOURCE_URI,
  );
  assertStrictEquals(
    createBtpmMcpRuntime({
      resourceUri: RESOURCE_URI,
      supabaseUrl: `${SUPABASE_URL}/`,
      tokenDependencies: deps,
      ...SLICE_DEPENDENCIES,
    }).authorizationServer,
    EXPECTED_ISSUER,
  );
});

// -----------------------------------------------------------------------------
// API-Q.5 — Connected App binding + delegated-user consent access
// -----------------------------------------------------------------------------

/** Bounded 403 assertions shared by every Connected App denial case. */
async function assertBoundedForbidden(response: Response): Promise<void> {
  assertStrictEquals(response.status, 403);
  // L: no OAuth authentication challenge — the bearer token itself was valid.
  assertEquals(response.headers.get("www-authenticate"), null);
  // M: correlation header preserved.
  const requestId = response.headers.get(BTPM_MCP_REQUEST_ID_HEADER);
  assert(requestId !== null && UUID_PATTERN.test(requestId), String(requestId));
  const body = await response.text();
  const parsed = JSON.parse(body) as Record<string, unknown>;
  assertStrictEquals(parsed.error, "forbidden");
  assertEquals(Object.keys(parsed).sort(), ["error", "message"]);
  // No governance reason, identifier, token or JSON-RPC echo may leak.
  for (
    const forbidden of [
      "client_disabled",
      "client_record_ambiguous",
      "active_policy_missing",
      "active_policy_ambiguous",
      "policy_acknowledgement_missing",
      "policy_acknowledgement_stale",
      "policy_acknowledgement_revoked",
      "authentication_internal_error",
      "supabase",
      "api_clients",
      "jsonrpc",
      SIGNED_CLIENT_ID,
      API_CLIENT_ID,
      POLICY_VERSION_ID,
      VALID_TOKEN,
    ]
  ) {
    assertEquals(
      body.toLowerCase().includes(forbidden.toLowerCase()),
      false,
      `403 body must not disclose ${forbidden}`,
    );
  }
}

/** N: the MCP protocol layer must never be reached on a denial. */
async function serveAuthorizedToolsCall(): Promise<Response> {
  return await serve(
    post({
      jsonrpc: "2.0",
      id: 21,
      method: "tools/call",
      params: { name: "anything", arguments: {}, _meta: modernEnvelope() },
    }, {
      "mcp-protocol-version": MODERN_PROTOCOL_VERSION,
      "mcp-method": "tools/call",
      "mcp-name": "anything",
    }),
  );
}

Deno.test("API-Q.5 A/B: active Connected App + active policy + valid acknowledgement reaches the MCP handler", async () => {
  resetAuthorization();
  const { response, payload } = await initializeModern();
  assertStrictEquals(response.status, 200);
  assertStrictEquals(payload.error, undefined);
  // B: the store is queried by the exact signed OAuth client_id.
  assertEquals(storeLookups, [SIGNED_CLIENT_ID]);
});

Deno.test("API-Q.5 C: no matching active Connected App returns a bounded 403", async () => {
  resetAuthorization();
  storeFixture.clients = [];
  await assertBoundedForbidden(await serveAuthorizedToolsCall());
  resetAuthorization();
});

Deno.test("API-Q.5 B: a Connected App registered under another oauth_client_id does not match", async () => {
  resetAuthorization();
  storeFixture.clients = [{
    id: API_CLIENT_ID,
    oauthClientId: "some-other-client",
    lifecycleStatus: "active",
  }];
  await assertBoundedForbidden(await serveAuthorizedToolsCall());
  assertEquals(storeLookups, [SIGNED_CLIENT_ID]);
  resetAuthorization();
});

Deno.test("API-Q.5 D: multiple matching Connected Apps fail closed", async () => {
  resetAuthorization();
  storeFixture.clients = [
    { id: API_CLIENT_ID, oauthClientId: SIGNED_CLIENT_ID, lifecycleStatus: "active" },
    { id: "dddddddd-dddd-dddd-dddd-dddddddddddd", oauthClientId: SIGNED_CLIENT_ID, lifecycleStatus: "active" },
  ];
  await assertBoundedForbidden(await serveAuthorizedToolsCall());
  resetAuthorization();
});

Deno.test("API-Q.5 C: inactive Connected App lifecycle states fail closed", async () => {
  for (const status of ["draft", "suspended", "retired"] as const) {
    resetAuthorization();
    storeFixture.clients = [{
      id: API_CLIENT_ID,
      oauthClientId: SIGNED_CLIENT_ID,
      lifecycleStatus: status,
    }];
    await assertBoundedForbidden(await serveAuthorizedToolsCall());
  }
  resetAuthorization();
});

Deno.test("API-Q.5 E: missing active policy version returns a bounded 403", async () => {
  resetAuthorization();
  storeFixture.versions = [];
  await assertBoundedForbidden(await serveAuthorizedToolsCall());
  resetAuthorization();
});

Deno.test("API-Q.5 F: ambiguous active policy versions fail closed", async () => {
  resetAuthorization();
  storeFixture.versions = [
    { id: POLICY_VERSION_ID, apiClientId: API_CLIENT_ID, lifecycleStatus: "active" },
    { id: "77777777-7777-7777-7777-777777777777", apiClientId: API_CLIENT_ID, lifecycleStatus: "active" },
  ];
  await assertBoundedForbidden(await serveAuthorizedToolsCall());
  resetAuthorization();
});

Deno.test("API-Q.5 G: missing acknowledgement returns a bounded 403", async () => {
  resetAuthorization();
  storeFixture.acknowledgement = null;
  await assertBoundedForbidden(await serveAuthorizedToolsCall());
  resetAuthorization();
});

Deno.test("API-Q.5 H: stale acknowledgement (older policy version) fails closed", async () => {
  resetAuthorization();
  storeFixture.acknowledgement = {
    id: "ack-old",
    userId: USER_ID,
    apiClientId: API_CLIENT_ID,
    policyVersionId: "00000000-0000-0000-0000-000000000001",
    revokedAt: null,
  };
  await assertBoundedForbidden(await serveAuthorizedToolsCall());
  resetAuthorization();
});

Deno.test("API-Q.5 I: revoked acknowledgement fails closed", async () => {
  resetAuthorization();
  storeFixture.acknowledgement = {
    id: "ack-revoked",
    userId: USER_ID,
    apiClientId: API_CLIENT_ID,
    policyVersionId: POLICY_VERSION_ID,
    revokedAt: "2026-01-01T00:00:00.000Z",
  };
  await assertBoundedForbidden(await serveAuthorizedToolsCall());
  resetAuthorization();
});

Deno.test("API-Q.5 C: an acknowledgement belonging to another user fails closed", async () => {
  resetAuthorization();
  storeFixture.acknowledgement = {
    id: "ack-other",
    userId: "22222222-3333-4444-5555-666666666666",
    apiClientId: API_CLIENT_ID,
    policyVersionId: POLICY_VERSION_ID,
    revokedAt: null,
  };
  await assertBoundedForbidden(await serveAuthorizedToolsCall());
  resetAuthorization();
});

Deno.test("API-Q.5 C: authorization-store failures fail closed with a bounded 403", async () => {
  for (const failWith of ["clients", "versions", "ack"]) {
    resetAuthorization();
    storeFixture.failWith = failWith;
    await assertBoundedForbidden(await serveAuthorizedToolsCall());
  }
  resetAuthorization();
});

Deno.test("API-Q.5 J: caller-supplied client identity cannot override the signed OAuth client_id", async () => {
  resetAuthorization();
  // Only "attacker-client" is registered as an active Connected App.
  storeFixture.clients = [{
    id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    oauthClientId: "attacker-client",
    lifecycleStatus: "active",
  }];
  const response = await serve(
    post({
      jsonrpc: "2.0",
      id: 22,
      method: "tools/list",
      params: {
        client_id: "attacker-client",
        _meta: {
          ...modernEnvelope(),
          "client_id": "attacker-client",
        },
      },
    }, {
      "mcp-protocol-version": MODERN_PROTOCOL_VERSION,
      "mcp-method": "tools/list",
      "x-client-id": "attacker-client",
      "client_id": "attacker-client",
    }),
  );
  await assertBoundedForbidden(response);
  // Resolution was attempted with the signed claim only.
  assertEquals(storeLookups, [SIGNED_CLIENT_ID]);
  resetAuthorization();
});

Deno.test("API-Q.5 K: authentication failures remain 401 with the resource metadata challenge and no store lookup", async () => {
  resetAuthorization();
  const response = await serve(
    post(initializeRequest(MODERN_PROTOCOL_VERSION), {}, null),
  );
  assertStrictEquals(response.status, 401);
  assert((response.headers.get("www-authenticate") ?? "").includes(METADATA_URL));
  await response.text();
  // Connected App authorization is never attempted for an unauthenticated call.
  assertEquals(storeLookups, []);
});

Deno.test("API-Q.5 N: the MCP handler is never reached when Connected App authorization fails", async () => {
  resetAuthorization();
  handlerReached = 0;
  storeFixture.clients = [];
  const response = await serveAuthorizedToolsCall();
  const body = await response.clone().text();
  assertStrictEquals(response.status, 403);
  assertEquals(body.includes("jsonrpc"), false);
  assertEquals(body.includes("anything"), false);
  assertStrictEquals(handlerReached, 0);
  await response.text();
  resetAuthorization();
});

Deno.test("API-Q.5 S / API-Q.7D: the MCP registry exposes only the fourteen accepted reads", async () => {
  resetAuthorization();
  // API-Q.8: the registry declares all 37 canonical operations explicitly;
  // exactly 14 remain EXPOSED, and only exposed entries reach tools/list.
  assertStrictEquals(MCP_TOOL_REGISTRY.length, 38);
  assertStrictEquals(exposedMcpTools().length, 14);
  const response = await serve(
    post({ jsonrpc: "2.0", id: 23, method: "tools/list", params: { _meta: modernEnvelope() } }, {
      "mcp-protocol-version": MODERN_PROTOCOL_VERSION,
      "mcp-method": "tools/list",
    }),
  );
  assertStrictEquals(response.status, 200);
  const payload = await readJsonRpc(response);
  assertEquals(
    ((payload.result as { tools?: Array<{ name?: string }> }).tools ?? [])
      .map((t) => t.name),
    [
      MCP_ORGANIZATIONS_TOOL_NAME,
      MCP_WORKSPACES_TOOL_NAME,
      MCP_PROJECTS_TOOL_NAME,
      MCP_PROGRAMS_TOOL_NAME,
      MCP_PROGRAM_DETAIL_TOOL_NAME,
      MCP_PROJECT_DETAIL_TOOL_NAME,
      MCP_PROJECT_PLANNING_TOOL_NAME,
      MCP_PROJECT_RISKS_TOOL_NAME,
      MCP_RISK_DETAIL_TOOL_NAME,
      MCP_PROJECT_BLOCKERS_TOOL_NAME,
      MCP_BLOCKER_DETAIL_TOOL_NAME,
      MCP_EXECUTION_UPDATES_TOOL_NAME,
      MCP_PHASE_DETAIL_TOOL_NAME,
      MCP_TASK_DETAIL_TOOL_NAME,
    ],
  );
});

Deno.test("API-Q.5: the authorized MCP context carries exactly the accepted fields", async () => {
  resetAuthorization();
  const { authorizeMcpConnectedApp } = await import(
    "./mcp/authorizeMcpConnectedApp.ts"
  );
  const context = await authorizeMcpConnectedApp({
    userId: USER_ID,
    clientId: SIGNED_CLIENT_ID,
    issuer: EXPECTED_ISSUER,
    audiences: [RESOURCE_URI],
    expiresAt: NOW_SECONDS + 600,
    resourceUri: RESOURCE_URI,
    requestId: "req-q5",
  }, AUTHORIZATION_STORE);

  assertEquals(Object.keys(context).sort(), [
    "apiClientId",
    "audiences",
    "expiresAt",
    "issuer",
    "oauthClientId",
    "policyVersionId",
    "requestId",
    "resourceUri",
    "userId",
  ]);
  assertStrictEquals(context.apiClientId, API_CLIENT_ID);
  assertStrictEquals(context.oauthClientId, SIGNED_CLIENT_ID);
  assertStrictEquals(context.policyVersionId, POLICY_VERSION_ID);
  for (
    const forbidden of [
      "tenantId",
      "organizationId",
      "workspaceId",
      "projectId",
      "capabilities",
      "sourceChannel",
      "sourceSystem",
      "idempotencyKey",
    ]
  ) {
    assertEquals(forbidden in context, false, `${forbidden} must not exist`);
  }
});

Deno.test("API-Q.5: no Connected App governance rule is duplicated in MCP code", () => {
  const binder = stripComments(Deno.readTextFileSync(
    new URL("./mcp/authorizeMcpConnectedApp.ts", import.meta.url),
  ));
  assert(binder.includes("authorizeClient("), "canonical authorizeClient must be reused");
  for (
    const forbidden of [
      "lifecycleStatus !==",
      "revokedAt",
      "api_client_policy_versions",
      "api_user_policy_acknowledgements",
      "api_clients",
      "length > 1",
    ]
  ) {
    assertEquals(
      binder.includes(forbidden),
      false,
      `governance rule ${forbidden} must not be duplicated`,
    );
  }
});

Deno.test("API-Q.5 Q/R: /oauth/consent is auth-guarded but no longer Tenant-Admin-guarded", () => {
  const app = Deno.readTextFileSync(new URL("../../../src/App.tsx", import.meta.url));
  const route = app
    .split("\n")
    .find((line) => line.includes('path="/oauth/consent"'));
  assert(route !== undefined, "the /oauth/consent route must exist");
  assert(route.includes("<AuthGuardedRoute>"), route);
  assertEquals(route.includes("TenantAdminGuard"), false, route);

  // R: every other TenantAdminGuard route is unchanged.
  const guarded = app
    .split("\n")
    .filter((line) => line.includes("<TenantAdminGuard>"));
  assertStrictEquals(guarded.length, 7, "the tenant admin routes must remain unchanged");
  for (const line of guarded) {
    assert(line.includes("<AuthGuardedRoute>"), line);
    assert(line.includes('path="/admin/tenant'), line);
  }
});

// -----------------------------------------------------------------------------
// API-Q.6 — Trusted MCP provenance boundary
// -----------------------------------------------------------------------------

import {
  buildMcpExecutionContext,
  MCP_DELEGATION_MODE,
  MCP_SOURCE_CHANNEL,
  McpExecutionContextError,
  type McpTrustedExecutionContext,
} from "./mcp/buildMcpExecutionContext.ts";
import type { McpAuthorizedContext } from "./mcp/authorizeMcpConnectedApp.ts";
import type { AuthenticatedApiContext } from "../_shared/btpm-api/authenticateApiRequest.ts";
import { PMG_SOURCE_CHANNELS } from "../../../src/lib/pmg/pmgContract.ts";

const Q6_REQUEST_ID = "9f5b1c2e-0000-4000-8000-abcdefabcdef";

function authorizedFixture(
  overrides: Partial<McpAuthorizedContext> = {},
): McpAuthorizedContext {
  return {
    userId: USER_ID,
    apiClientId: API_CLIENT_ID,
    oauthClientId: SIGNED_CLIENT_ID,
    policyVersionId: POLICY_VERSION_ID,
    issuer: EXPECTED_ISSUER,
    audiences: [RESOURCE_URI],
    expiresAt: NOW_SECONDS + 600,
    resourceUri: RESOURCE_URI,
    requestId: Q6_REQUEST_ID,
    ...overrides,
  };
}

Deno.test("API-Q.6 A/B/C/D/E/F/G/H: a valid authorized context yields exact server-derived provenance", () => {
  const context = buildMcpExecutionContext(authorizedFixture());

  // A: exactly the accepted provenance fields, nothing more.
  assertEquals(Object.keys(context).sort(), [
    "apiClientId",
    "correlationId",
    "delegationMode",
    "executingUserId",
    "oauthClientId",
    "policyVersionId",
    "requestId",
    "requestedUserId",
    "sourceChannel",
    "sourceClientId",
  ]);
  // B / C
  assertStrictEquals(context.sourceChannel, "mcp");
  assertStrictEquals(MCP_SOURCE_CHANNEL, "mcp");
  assertStrictEquals(context.delegationMode, "delegated_user");
  assertStrictEquals(MCP_DELEGATION_MODE, "delegated_user");
  // D
  assertStrictEquals(context.requestedUserId, USER_ID);
  assertStrictEquals(context.executingUserId, USER_ID);
  // E
  assertStrictEquals(context.apiClientId, API_CLIENT_ID);
  assertStrictEquals(context.oauthClientId, SIGNED_CLIENT_ID);
  assertStrictEquals(context.policyVersionId, POLICY_VERSION_ID);
  // F
  assertStrictEquals(context.sourceClientId, context.apiClientId);
  // G / H
  assertStrictEquals(context.requestId, Q6_REQUEST_ID);
  assertStrictEquals(context.correlationId, Q6_REQUEST_ID);

  // No tenant/business authority and no idempotency field exists yet.
  for (
    const forbidden of [
      "tenantId",
      "organizationId",
      "workspaceId",
      "projectId",
      "roles",
      "capabilities",
      "idempotencyKey",
      "payloadHash",
    ]
  ) {
    assertEquals(forbidden in context, false, `${forbidden} must not exist`);
  }
});

Deno.test("API-Q.6 I: the returned trusted context is frozen", () => {
  const context = buildMcpExecutionContext(authorizedFixture());
  assert(Object.isFrozen(context));
  const mutable = context as unknown as Record<string, unknown>;
  try {
    mutable.sourceChannel = "external_api";
  } catch {
    // Strict-mode assignment on a frozen object throws; either way it is ignored.
  }
  assertStrictEquals(context.sourceChannel, "mcp");
});

Deno.test("API-Q.6 J: malformed authorized contexts fail closed with one bounded error", () => {
  const malformed: McpAuthorizedContext[] = [
    authorizedFixture({ userId: "" }),
    authorizedFixture({ userId: "   " }),
    authorizedFixture({ apiClientId: "" }),
    authorizedFixture({ oauthClientId: "" }),
    authorizedFixture({ policyVersionId: "" }),
    authorizedFixture({ requestId: "" }),
    null as unknown as McpAuthorizedContext,
    {} as McpAuthorizedContext,
  ];
  for (const input of malformed) {
    let thrown: unknown = null;
    try {
      buildMcpExecutionContext(input);
    } catch (error) {
      thrown = error;
    }
    assert(thrown instanceof McpExecutionContextError, String(thrown));
    assertStrictEquals(
      (thrown as McpExecutionContextError).message,
      "mcp_execution_context_invalid",
    );
  }
});

Deno.test("API-Q.6 K: the builder accepts no caller-controllable input at all", () => {
  const builder = stripComments(Deno.readTextFileSync(
    new URL("./mcp/buildMcpExecutionContext.ts", import.meta.url),
  ));
  for (
    const forbidden of [
      "Request",
      "headers",
      "searchParams",
      "_meta",
      "arguments",
      "X-Source-Channel",
      "source_channel",
      "Deno.env",
      ".from(",
      ".rpc(",
    ]
  ) {
    assertEquals(
      builder.includes(forbidden),
      false,
      `the provenance builder must not reference ${forbidden}`,
    );
  }
  assertStrictEquals(builder.split("buildMcpExecutionContext(").length - 1, 1);
});

Deno.test("API-Q.6 K: caller-supplied provenance in headers, body and tool metadata has no effect", async () => {
  resetAuthorization();
  const seen: McpTrustedExecutionContext[] = [];
  const response = await handleBtpmMcpRequest(
    post({
      jsonrpc: "2.0",
      id: 61,
      method: "tools/call",
      params: {
        name: "anything",
        arguments: {
          source_channel: "btpm_ui",
          delegation_mode: "service_role",
          executing_user_id: "00000000-0000-4000-8000-000000000000",
          api_client_id: "spoofed-api-client",
        },
        _meta: {
          ...modernEnvelope(),
          source_channel: "external_api",
          delegationMode: "admin",
        },
      },
    }, {
      "mcp-protocol-version": MODERN_PROTOCOL_VERSION,
      "mcp-method": "tools/call",
      "mcp-name": "anything",
      "x-source-channel": "external_api",
      "x-delegation-mode": "service_role",
      "x-btpm-user-id": "00000000-0000-4000-8000-000000000000",
      "x-btpm-api-client-id": "spoofed-api-client",
    }),
    RUNTIME,
    { onExecutionContext: (context) => seen.push(context) },
  );
  assertStrictEquals(response.status, 200);
  assertStrictEquals(seen.length, 1);
  const context = seen[0];
  assertStrictEquals(context.sourceChannel, "mcp");
  assertStrictEquals(context.delegationMode, "delegated_user");
  assertStrictEquals(context.requestedUserId, USER_ID);
  assertStrictEquals(context.executingUserId, USER_ID);
  assertStrictEquals(context.apiClientId, API_CLIENT_ID);
  assertStrictEquals(context.sourceClientId, API_CLIENT_ID);
  assertStrictEquals(context.oauthClientId, SIGNED_CLIENT_ID);
  assertStrictEquals(context.policyVersionId, POLICY_VERSION_ID);
});

Deno.test("API-Q.6 G/H/L: the trusted context uses the server request ID and reaches the factory per request", async () => {
  resetAuthorization();
  const seen: McpTrustedExecutionContext[] = [];
  const hooks = { onExecutionContext: (c: McpTrustedExecutionContext) => seen.push(c) };
  const first = await handleBtpmMcpRequest(
    post(initializeRequest(MODERN_PROTOCOL_VERSION)),
    RUNTIME,
    hooks,
  );
  const second = await handleBtpmMcpRequest(
    post(initializeRequest(MODERN_PROTOCOL_VERSION)),
    RUNTIME,
    hooks,
  );
  assertStrictEquals(first.status, 200);
  assertStrictEquals(second.status, 200);
  assertStrictEquals(seen.length, 2);
  for (const [index, response] of [first, second].entries()) {
    const headerRequestId = response.headers.get(BTPM_MCP_REQUEST_ID_HEADER);
    assert(headerRequestId !== null && UUID_PATTERN.test(headerRequestId));
    // G: the provenance request ID is exactly the server-generated request ID.
    assertStrictEquals(seen[index].requestId, headerRequestId);
    // H: correlation is deterministic and server-derived.
    assertStrictEquals(seen[index].correlationId, headerRequestId);
  }
  // Each request gets its own context: no cross-request reuse.
  assert(seen[0].requestId !== seen[1].requestId);
  assert(seen[0] !== seen[1]);
});

Deno.test("API-Q.6 M: unauthenticated and unauthorized requests never construct an execution context", async () => {
  resetAuthorization();
  const seen: McpTrustedExecutionContext[] = [];
  const hooks = { onExecutionContext: (c: McpTrustedExecutionContext) => seen.push(c) };

  // Unauthenticated.
  const unauthenticated = await handleBtpmMcpRequest(
    post(initializeRequest(MODERN_PROTOCOL_VERSION), {}, null),
    RUNTIME,
    hooks,
  );
  assertStrictEquals(unauthenticated.status, 401);

  // Authenticated but Connected App authorization denied.
  storeFixture.clients = [];
  const forbidden = await handleBtpmMcpRequest(
    post(initializeRequest(MODERN_PROTOCOL_VERSION)),
    RUNTIME,
    hooks,
  );
  assertStrictEquals(forbidden.status, 403);

  // Wrong HTTP method and mismatching Origin.
  const method = await handleBtpmMcpRequest(
    new Request(ENDPOINT, { method: "DELETE" }),
    RUNTIME,
    hooks,
  );
  assertStrictEquals(method.status, 405);

  assertStrictEquals(seen.length, 0);
  resetAuthorization();
});

Deno.test("API-Q.6 L: provenance is built strictly after authentication and Connected App authorization", () => {
  const shell = stripComments(
    Deno.readTextFileSync(new URL("./index.ts", import.meta.url)),
  );
  const order = [
    "crypto.randomUUID()",
    "isOriginAllowed(request)",
    'request.method !== "POST"',
    "authenticateMcpRequest(",
    "authorizeMcpConnectedApp(",
    "buildMcpExecutionContext(authorized)",
    "createRequestHandler(\n    request,",
  ].map((marker) => {
    const index = shell.indexOf(marker);
    assert(index >= 0, `missing shell stage: ${marker}`);
    return index;
  });
  for (let i = 1; i < order.length; i += 1) {
    assert(order[i] > order[i - 1], `stage ${i} is out of order`);
  }
  // No mutable cross-request provenance state.
  assertEquals(shell.includes("let executionContextCache"), false);
  assertEquals(shell.includes("globalThis.executionContext"), false);
});

Deno.test("API-Q.6 N: REST buildExecutionContext still produces sourceChannel = external_api", async () => {
  const { buildExecutionContext } = await import(
    "../_shared/btpm-api/buildExecutionContext.ts"
  );
  const restRequest = new Request("https://api.example.test/v1/projects", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Idempotency-Key": "11111111-1111-4111-8111-111111111111",
      "X-Request-ID": "rest-request-id",
      // A REST caller-supplied source channel must be ignored entirely.
      "X-Source-Channel": "mcp",
    },
    body: JSON.stringify({ name: "Example" }),
  });
  const restContext: AuthenticatedApiContext = {
    token: {
      userId: USER_ID,
      clientId: SIGNED_CLIENT_ID,
      issuer: EXPECTED_ISSUER,
      audiences: ["authenticated"],
      expiresAt: NOW_SECONDS + 600,
    },
    client: {
      userId: USER_ID,
      apiClientId: API_CLIENT_ID,
      oauthClientId: SIGNED_CLIENT_ID,
      policyVersionId: POLICY_VERSION_ID,
    },
  };
  const context = await buildExecutionContext(
    restRequest,
    restContext,
    { name: "Example" },
  );
  assertStrictEquals(context.sourceChannel, "external_api");
  assertStrictEquals(context.delegationMode, "delegated_user");
  assertStrictEquals(context.requestId, "rest-request-id");
});

Deno.test("API-Q.6 O: delegated REST adapters still require external_api provenance", () => {
  const adapters = [
    "supabaseDelegatedProjectMutation.ts",
    "supabaseDelegatedProgramMutation.ts",
    "supabaseDelegatedTask.ts",
    "supabaseDelegatedPhase.ts",
    "supabaseDelegatedRisk.ts",
    "supabaseDelegatedBlocker.ts",
    "supabaseDelegatedAppendExecutionUpdate.ts",
  ];
  for (const adapter of adapters) {
    const source = stripComments(Deno.readTextFileSync(
      new URL(`../_shared/btpm-api/${adapter}`, import.meta.url),
    ));
    assert(
      source.includes('sourceChannel !== "external_api"'),
      `${adapter} must keep rejecting non-external_api provenance`,
    );
    assertEquals(
      source.includes('sourceChannel !== "mcp"'),
      false,
      `${adapter} must not gain MCP provenance handling in API-Q.6`,
    );
  }
});

Deno.test("API-Q.6 P: the PMG source-channel vocabulary is unchanged and still includes mcp", () => {
  assertEquals([...PMG_SOURCE_CHANNELS], [
    "btpm_ui",
    "admin_import",
    "external_api",
    "mcp",
    "background_job",
    "btpm_internal",
  ]);
});

Deno.test("API-Q.6 Q / API-Q.7D: exposure stays explicit — fourteen declared read tools only", async () => {
  resetAuthorization();
  // API-Q.8: the registry declares all 37 canonical operations explicitly;
  // exactly 14 remain EXPOSED, and only exposed entries reach tools/list.
  assertStrictEquals(MCP_TOOL_REGISTRY.length, 38);
  assertStrictEquals(exposedMcpTools().length, 14);
  await initializeModern();
  const response = await serve(
    post({
      jsonrpc: "2.0",
      id: 62,
      method: "tools/list",
      params: { _meta: modernEnvelope() },
    }, {
      "mcp-protocol-version": MODERN_PROTOCOL_VERSION,
      "mcp-method": "tools/list",
    }),
  );
  const payload = await readJsonRpc(response);
  const result = payload.result as
    | { tools?: Array<{ name?: string }> }
    | undefined;
  assertEquals((result?.tools ?? []).map((t) => t.name), [
    MCP_ORGANIZATIONS_TOOL_NAME,
    MCP_WORKSPACES_TOOL_NAME,
    MCP_PROJECTS_TOOL_NAME,
    MCP_PROGRAMS_TOOL_NAME,
    MCP_PROGRAM_DETAIL_TOOL_NAME,
    MCP_PROJECT_DETAIL_TOOL_NAME,
    MCP_PROJECT_PLANNING_TOOL_NAME,
    MCP_PROJECT_RISKS_TOOL_NAME,
    MCP_RISK_DETAIL_TOOL_NAME,
    MCP_PROJECT_BLOCKERS_TOOL_NAME,
    MCP_BLOCKER_DETAIL_TOOL_NAME,
    MCP_EXECUTION_UPDATES_TOOL_NAME,
    MCP_PHASE_DETAIL_TOOL_NAME,
    MCP_TASK_DETAIL_TOOL_NAME,
  ]);
});

// -----------------------------------------------------------------------------
// API-Q.7A — organizations.get vertical slice
// -----------------------------------------------------------------------------

async function callOrganizationsTool(
  args: Record<string, unknown> = {},
  id = 70,
): Promise<Record<string, unknown>> {
  const response = await serve(
    post({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: {
        name: MCP_ORGANIZATIONS_TOOL_NAME,
        arguments: args,
        _meta: modernEnvelope(),
      },
    }, {
      "mcp-protocol-version": MODERN_PROTOCOL_VERSION,
      "mcp-method": "tools/call",
      "mcp-name": MCP_ORGANIZATIONS_TOOL_NAME,
    }),
  );
  assertStrictEquals(response.status, 200);
  return await readJsonRpc(response);
}

function toolResult(payload: Record<string, unknown>): {
  isError?: boolean;
  content?: Array<{ type?: string; text?: string }>;
  structuredContent?: unknown;
} {
  assertStrictEquals(payload.error, undefined);
  return payload.result as {
    isError?: boolean;
    content?: Array<{ type?: string; text?: string }>;
    structuredContent?: unknown;
  };
}

Deno.test("API-Q.7A A/B: the exposed tool is declared read-only and advertises its bounded schema", async () => {
  resetAuthorization();
  resetOrganizationsSlice();
  const entry = MCP_TOOL_REGISTRY[0];
  assertStrictEquals(entry.operationId, "organizations.get");
  assertStrictEquals(entry.toolName, MCP_ORGANIZATIONS_TOOL_NAME);
  assertStrictEquals(entry.operationClass, "read");
  assertStrictEquals(entry.exposure, "exposed");

  const payload = await callOrganizationsTool({}, 71);
  const result = toolResult(payload);
  assertEquals(result.isError ?? false, false);
});

Deno.test("API-Q.7A C/D: a successful read reuses canonical defaults and the caller-scoped reader", async () => {
  resetAuthorization();
  resetOrganizationsSlice();
  const result = toolResult(await callOrganizationsTool({}, 72));

  // Canonical validation/defaulting is owned by parseApiV1OrganizationsQuery.
  assertStrictEquals(organizationsReadCalls.length, 1);
  assertEquals(organizationsReadCalls[0].query, {
    limit: 50,
    offset: 0,
    search: null,
  });

  // The read is delegated with the caller's own bearer token (RLS applies).
  assertStrictEquals(
    organizationsReadCalls[0].authorization,
    `Bearer ${VALID_TOKEN}`,
  );
  // Server-derived identity only.
  assertStrictEquals(organizationsReadCalls[0].oauthClientId, SIGNED_CLIENT_ID);
  assertStrictEquals(organizationsReadCalls[0].apiClientId, API_CLIENT_ID);
  assertStrictEquals(organizationsReadCalls[0].tokenUserId, USER_ID);

  assertEquals(result.structuredContent, ORGANIZATIONS_PAYLOAD);
  assertEquals(
    JSON.parse(result.content?.[0]?.text ?? "null"),
    ORGANIZATIONS_PAYLOAD,
  );
});

Deno.test("API-Q.7A E: explicit arguments are forwarded to the canonical parser unchanged", async () => {
  resetAuthorization();
  resetOrganizationsSlice();
  toolResult(
    await callOrganizationsTool({ limit: 25, offset: 10, search: "ad va" }, 73),
  );
  assertEquals(organizationsReadCalls[0].query, {
    limit: 25,
    offset: 10,
    search: "ad va",
  });
});

Deno.test("API-Q.7A F: out-of-range arguments are rejected by canonical validation, not by MCP", async () => {
  resetAuthorization();
  resetOrganizationsSlice();
  const result = toolResult(await callOrganizationsTool({ limit: 101 }, 74));
  assertStrictEquals(result.isError, true);
  assertStrictEquals(
    result.content?.[0]?.text,
    MCP_TOOL_ERROR_MESSAGES.invalid_arguments,
  );
  // Canonical validation runs after rate limiting and before any business read.
  assertStrictEquals(rateLimitConsumptions.length, 1);
  assertStrictEquals(organizationsReadCalls.length, 0);
});

Deno.test("API-Q.7A G/H: canonical rate limiting is enforced before the business read", async () => {
  resetAuthorization();
  resetOrganizationsSlice();
  toolResult(await callOrganizationsTool({}, 75));

  assertEquals(profileResolutions, [
    { apiClientId: API_CLIENT_ID, routeId: "organizations.get" },
  ]);
  assertStrictEquals(rateLimitConsumptions.length, 1);
  assertEquals(
    {
      apiClientId: rateLimitConsumptions[0].apiClientId,
      userId: rateLimitConsumptions[0].userId,
      routeId: rateLimitConsumptions[0].routeId,
      limit: rateLimitConsumptions[0].limit,
      windowSeconds: rateLimitConsumptions[0].windowSeconds,
    },
    {
      apiClientId: API_CLIENT_ID,
      userId: USER_ID,
      routeId: "organizations.get",
      limit: 60,
      windowSeconds: 60,
    },
  );
});

Deno.test("API-Q.7A H: an exhausted rate limit fails bounded and performs no business read", async () => {
  resetAuthorization();
  resetOrganizationsSlice();
  rateLimitAllowed = false;
  const result = toolResult(await callOrganizationsTool({}, 76));
  assertStrictEquals(result.isError, true);
  assertStrictEquals(
    result.content?.[0]?.text,
    MCP_TOOL_ERROR_MESSAGES.rate_limited,
  );
  assertStrictEquals(organizationsReadCalls.length, 0);
  resetOrganizationsSlice();
});

Deno.test("API-Q.7A I: authorization denials surface as a bounded not_authorized tool error", async () => {
  resetAuthorization();
  resetOrganizationsSlice();
  organizationsReadFailure = new ApiHttpError("not_authorized");
  const result = toolResult(await callOrganizationsTool({}, 77));
  assertStrictEquals(result.isError, true);
  assertStrictEquals(
    result.content?.[0]?.text,
    MCP_TOOL_ERROR_MESSAGES.not_authorized,
  );
  resetOrganizationsSlice();
});

Deno.test("API-Q.7A J: internal failures never leak database, SQLSTATE, stack or identity detail", async () => {
  resetAuthorization();
  resetOrganizationsSlice();
  organizationsReadFailure = new Error(
    "42501: permission denied for table organizations (policy org_members_select) " +
      POLICY_VERSION_ID,
  );
  const payload = await callOrganizationsTool({}, 78);
  const serialized = JSON.stringify(payload);
  const result = toolResult(payload);
  assertStrictEquals(result.isError, true);
  assertStrictEquals(
    result.content?.[0]?.text,
    MCP_TOOL_ERROR_MESSAGES.unavailable,
  );
  for (
    const forbidden of [
      "42501",
      "permission denied",
      "policy",
      "organizations (",
      POLICY_VERSION_ID,
      VALID_TOKEN,
      API_CLIENT_ID,
    ]
  ) {
    assertEquals(
      serialized.toLowerCase().includes(forbidden.toLowerCase()),
      false,
      `tool error must not disclose ${forbidden}`,
    );
  }
  resetOrganizationsSlice();
});

Deno.test("API-Q.7A K: unauthenticated and unauthorized tool calls never execute the read", async () => {
  resetAuthorization();
  resetOrganizationsSlice();

  const unauthenticated = await serve(
    post({
      jsonrpc: "2.0",
      id: 79,
      method: "tools/call",
      params: {
        name: MCP_ORGANIZATIONS_TOOL_NAME,
        arguments: {},
        _meta: modernEnvelope(),
      },
    }, {
      "mcp-protocol-version": MODERN_PROTOCOL_VERSION,
      "mcp-method": "tools/call",
      "mcp-name": MCP_ORGANIZATIONS_TOOL_NAME,
    }, null),
  );
  assertStrictEquals(unauthenticated.status, 401);
  await unauthenticated.text();

  storeFixture.clients = [];
  const forbidden = await serve(
    post({
      jsonrpc: "2.0",
      id: 80,
      method: "tools/call",
      params: {
        name: MCP_ORGANIZATIONS_TOOL_NAME,
        arguments: {},
        _meta: modernEnvelope(),
      },
    }, {
      "mcp-protocol-version": MODERN_PROTOCOL_VERSION,
      "mcp-method": "tools/call",
      "mcp-name": MCP_ORGANIZATIONS_TOOL_NAME,
    }),
  );
  assertStrictEquals(forbidden.status, 403);
  await forbidden.text();

  assertStrictEquals(profileResolutions.length, 0);
  assertStrictEquals(rateLimitConsumptions.length, 0);
  assertStrictEquals(organizationsReadCalls.length, 0);
  resetAuthorization();
});

Deno.test("API-Q.7A L: the MCP adapter duplicates no Organizations business logic", () => {
  const tool = Deno.readTextFileSync(
    new URL("./mcp/organizationsReadTool.ts", import.meta.url),
  );
  const bridge = Deno.readTextFileSync(
    new URL("./mcp/mcpApiContext.ts", import.meta.url),
  );
  const code = stripComments(tool) + "\n" + stripComments(bridge);
  for (
    const forbidden of [
      ".from(",
      ".rpc(",
      "api_v1_list_organizations",
      "SERVICE_ROLE",
      "Deno.env",
      "fetch(",
      "org_members",
      "select ",
    ]
  ) {
    assertEquals(
      code.includes(forbidden),
      false,
      `the MCP adapter must not contain ${forbidden}`,
    );
  }
  // Authority is reused, not reimplemented.
  for (
    const reused of [
      "parseApiV1OrganizationsQuery",
      "ORGANIZATIONS_ROUTE.id",
      "enforceApiRateLimit",
      "buildAuthenticatedApiContextFromMcp",
    ]
  ) {
    assert(tool.includes(reused), `expected reuse of ${reused}`);
  }
});

// -----------------------------------------------------------------------------
// API-Q.7B — workspaces.get vertical slice
// -----------------------------------------------------------------------------

async function callWorkspacesTool(
  args: Record<string, unknown> = { organizationId: ORGANIZATION_ID },
  id = 90,
): Promise<Record<string, unknown>> {
  const response = await serve(
    post({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: {
        name: MCP_WORKSPACES_TOOL_NAME,
        arguments: args,
        _meta: modernEnvelope(),
      },
    }, {
      "mcp-protocol-version": MODERN_PROTOCOL_VERSION,
      "mcp-method": "tools/call",
      "mcp-name": MCP_WORKSPACES_TOOL_NAME,
    }),
  );
  assertStrictEquals(response.status, 200);
  return await readJsonRpc(response);
}

Deno.test("API-Q.7B D/E/F: the Workspaces tool advertises read annotations and a required organizationId", async () => {
  resetAuthorization();
  resetWorkspacesSlice();
  const response = await serve(
    post({ jsonrpc: "2.0", id: 91, method: "tools/list", params: { _meta: modernEnvelope() } }, {
      "mcp-protocol-version": MODERN_PROTOCOL_VERSION,
      "mcp-method": "tools/list",
    }),
  );
  const payload = await readJsonRpc(response);
  const tools = (payload.result as {
    tools?: Array<{
      name?: string;
      annotations?: Record<string, unknown>;
      inputSchema?: { required?: string[] };
    }>;
  }).tools ?? [];
  const tool = tools.find((t) => t.name === MCP_WORKSPACES_TOOL_NAME);
  assert(tool !== undefined);
  assertEquals(tool.annotations?.readOnlyHint, true);
  assertEquals(tool.annotations?.destructiveHint, false);
  assertEquals(tool.annotations?.idempotentHint, true);
  assertEquals(tool.annotations?.openWorldHint, false);
  assertEquals(tool.inputSchema?.required, ["organizationId"]);
});

Deno.test("API-Q.7B H/N/P: a successful Workspaces read uses canonical defaults, the delegated reader and the exact payload", async () => {
  resetAuthorization();
  resetWorkspacesSlice();
  const result = toolResult(await callWorkspacesTool({ organizationId: ORGANIZATION_ID }, 92));

  assertStrictEquals(workspacesReadCalls.length, 1);
  assertEquals(workspacesReadCalls[0].query, {
    organizationId: ORGANIZATION_ID,
    limit: 50,
    offset: 0,
    search: null,
  });
  assertStrictEquals(workspacesReadCalls[0].authorization, `Bearer ${VALID_TOKEN}`);
  assertStrictEquals(workspacesReadCalls[0].oauthClientId, SIGNED_CLIENT_ID);
  assertStrictEquals(workspacesReadCalls[0].apiClientId, API_CLIENT_ID);
  assertStrictEquals(workspacesReadCalls[0].tokenUserId, USER_ID);

  assertEquals(result.structuredContent, WORKSPACES_PAYLOAD);
  assertEquals(
    JSON.parse(result.content?.[0]?.text ?? "null"),
    WORKSPACES_PAYLOAD,
  );
});

Deno.test("API-Q.7B I: explicit Workspaces arguments reach the canonical parser unchanged", async () => {
  resetAuthorization();
  resetWorkspacesSlice();
  toolResult(
    await callWorkspacesTool(
      { organizationId: ORGANIZATION_ID, limit: 25, offset: 10, search: "ad va" },
      93,
    ),
  );
  assertEquals(workspacesReadCalls[0].query, {
    organizationId: ORGANIZATION_ID,
    limit: 25,
    offset: 10,
    search: "ad va",
  });
});

Deno.test("API-Q.7B G/J: invalid organizationId and out-of-range paging fail closed before the Workspace read", async () => {
  for (const [index, args] of [
    { organizationId: "not-a-uuid" },
    { organizationId: "00000000-0000-0000-0000-000000000000" },
    { organizationId: ORGANIZATION_ID, limit: 101 },
    { organizationId: ORGANIZATION_ID, offset: 10_001 },
    { organizationId: ORGANIZATION_ID, search: "x".repeat(101) },
  ].entries()) {
    resetAuthorization();
    resetWorkspacesSlice();
    const result = toolResult(await callWorkspacesTool(args, 100 + index));
    assertStrictEquals(result.isError, true);
    assertStrictEquals(
      result.content?.[0]?.text,
      MCP_WORKSPACES_TOOL_ERROR_MESSAGES.invalid_arguments,
    );
    assertStrictEquals(workspacesReadCalls.length, 0);
  }
});

Deno.test("API-Q.7B K/L/M: canonical rate limiting guards the Workspaces read", async () => {
  resetAuthorization();
  resetWorkspacesSlice();
  toolResult(await callWorkspacesTool({ organizationId: ORGANIZATION_ID }, 110));
  assertEquals(profileResolutions, [
    { apiClientId: API_CLIENT_ID, routeId: "workspaces.get" },
  ]);
  assertEquals(
    {
      apiClientId: rateLimitConsumptions[0].apiClientId,
      userId: rateLimitConsumptions[0].userId,
      routeId: rateLimitConsumptions[0].routeId,
    },
    { apiClientId: API_CLIENT_ID, userId: USER_ID, routeId: "workspaces.get" },
  );

  resetWorkspacesSlice();
  rateLimitAllowed = false;
  const denied = toolResult(
    await callWorkspacesTool({ organizationId: ORGANIZATION_ID }, 111),
  );
  assertStrictEquals(denied.isError, true);
  assertStrictEquals(
    denied.content?.[0]?.text,
    MCP_WORKSPACES_TOOL_ERROR_MESSAGES.rate_limited,
  );
  assertStrictEquals(workspacesReadCalls.length, 0);
  resetWorkspacesSlice();
});

Deno.test("API-Q.7B Q/R/S: Workspaces failures stay bounded and leak nothing", async () => {
  resetAuthorization();
  resetWorkspacesSlice();
  workspacesReadFailure = new ApiHttpError("not_authorized");
  const denied = toolResult(
    await callWorkspacesTool({ organizationId: ORGANIZATION_ID }, 120),
  );
  assertStrictEquals(denied.isError, true);
  assertStrictEquals(
    denied.content?.[0]?.text,
    MCP_WORKSPACES_TOOL_ERROR_MESSAGES.not_authorized,
  );

  resetWorkspacesSlice();
  workspacesReadFailure = new Error(
    `42501: permission denied for table workspaces (policy ws_members_select) ${POLICY_VERSION_ID}`,
  );
  const raw = await callWorkspacesTool({ organizationId: ORGANIZATION_ID }, 121);
  const serialized = JSON.stringify(raw);
  const failed = toolResult(raw);
  assertStrictEquals(failed.isError, true);
  assertStrictEquals(
    failed.content?.[0]?.text,
    MCP_WORKSPACES_TOOL_ERROR_MESSAGES.unavailable,
  );
  for (
    const forbidden of [
      "42501",
      "permission denied",
      "policy",
      POLICY_VERSION_ID,
      VALID_TOKEN,
      API_CLIENT_ID,
    ]
  ) {
    assertEquals(
      serialized.toLowerCase().includes(forbidden.toLowerCase()),
      false,
      `Workspaces tool error must not disclose ${forbidden}`,
    );
  }
  resetWorkspacesSlice();
});

Deno.test("API-Q.7B O: the Workspaces adapter performs no service-role business read", () => {
  const tool = Deno.readTextFileSync(
    new URL("./mcp/workspacesReadTool.ts", import.meta.url),
  );
  const code = stripComments(tool);
  for (
    const forbidden of [
      ".from(",
      ".rpc(",
      "api_v1_list_workspaces",
      "SERVICE_ROLE",
      "Deno.env",
      "fetch(",
      "workspace_members",
      "select ",
    ]
  ) {
    assertEquals(
      code.includes(forbidden),
      false,
      `the MCP Workspaces adapter must not contain ${forbidden}`,
    );
  }
  for (
    const reused of [
      "parseApiV1WorkspacesQuery",
      "WORKSPACES_ROUTE.id",
      "enforceApiRateLimit",
      "buildAuthenticatedApiContextFromMcp",
    ]
  ) {
    assert(tool.includes(reused), `expected reuse of ${reused}`);
  }
});

Deno.test("API-Q.7B T: the Organizations tool remains behaviorally unchanged", async () => {
  resetAuthorization();
  resetOrganizationsSlice();
  const result = toolResult(await callOrganizationsTool({}, 130));
  assertEquals(result.isError ?? false, false);
  assertEquals(result.structuredContent, ORGANIZATIONS_PAYLOAD);
  assertEquals(organizationsReadCalls[0].query, {
    limit: 50,
    offset: 0,
    search: null,
  });
  assertEquals(profileResolutions, [
    { apiClientId: API_CLIENT_ID, routeId: "organizations.get" },
  ]);
});

// -----------------------------------------------------------------------------
// API-Q.7C — projects.get vertical slice
// -----------------------------------------------------------------------------

async function callProjectsTool(
  args: Record<string, unknown> = { workspaceId: PROJECTS_WORKSPACE_ID },
  id = 130,
): Promise<Record<string, unknown>> {
  const response = await serve(
    post({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: {
        name: MCP_PROJECTS_TOOL_NAME,
        arguments: args,
        _meta: modernEnvelope(),
      },
    }, {
      "mcp-protocol-version": MODERN_PROTOCOL_VERSION,
      "mcp-method": "tools/call",
      "mcp-name": MCP_PROJECTS_TOOL_NAME,
    }),
  );
  assertStrictEquals(response.status, 200);
  return await readJsonRpc(response);
}

Deno.test("API-Q.7C D/E/F: the Projects tool advertises read annotations and a required workspaceId", async () => {
  resetAuthorization();
  resetProjectsSlice();
  const response = await serve(
    post({ jsonrpc: "2.0", id: 131, method: "tools/list", params: { _meta: modernEnvelope() } }, {
      "mcp-protocol-version": MODERN_PROTOCOL_VERSION,
      "mcp-method": "tools/list",
    }),
  );
  const payload = await readJsonRpc(response);
  const tools = (payload.result as {
    tools?: Array<{
      name?: string;
      annotations?: Record<string, unknown>;
      inputSchema?: { required?: string[] };
    }>;
  }).tools ?? [];
  const tool = tools.find((t) => t.name === MCP_PROJECTS_TOOL_NAME);
  assert(tool !== undefined);
  assertEquals(tool.annotations?.readOnlyHint, true);
  assertEquals(tool.annotations?.destructiveHint, false);
  assertEquals(tool.annotations?.idempotentHint, true);
  assertEquals(tool.annotations?.openWorldHint, false);
  assertEquals(tool.inputSchema?.required, ["workspaceId"]);
});

Deno.test("API-Q.7C H/N/O: a successful Projects read uses canonical defaults, the delegated reader and the exact payload", async () => {
  resetAuthorization();
  resetProjectsSlice();
  const result = toolResult(
    await callProjectsTool({ workspaceId: PROJECTS_WORKSPACE_ID }, 132),
  );

  assertStrictEquals(projectsReadCalls.length, 1);
  assertEquals(projectsReadCalls[0].query, {
    workspaceId: PROJECTS_WORKSPACE_ID,
    limit: 50,
    offset: 0,
    search: null,
  });
  assertStrictEquals(projectsReadCalls[0].authorization, `Bearer ${VALID_TOKEN}`);
  assertStrictEquals(projectsReadCalls[0].oauthClientId, SIGNED_CLIENT_ID);
  assertStrictEquals(projectsReadCalls[0].apiClientId, API_CLIENT_ID);
  assertStrictEquals(projectsReadCalls[0].tokenUserId, USER_ID);

  assertEquals(result.structuredContent, PROJECTS_PAYLOAD);
  assertEquals(
    JSON.parse(result.content?.[0]?.text ?? "null"),
    PROJECTS_PAYLOAD,
  );
});

Deno.test("API-Q.7C I: explicit Projects arguments reach the canonical parser unchanged", async () => {
  resetAuthorization();
  resetProjectsSlice();
  toolResult(
    await callProjectsTool(
      { workspaceId: PROJECTS_WORKSPACE_ID, limit: 25, offset: 10, search: "ad va" },
      133,
    ),
  );
  assertEquals(projectsReadCalls[0].query, {
    workspaceId: PROJECTS_WORKSPACE_ID,
    limit: 25,
    offset: 10,
    search: "ad va",
  });
});

Deno.test("API-Q.7C G/J: invalid workspaceId and out-of-range paging fail closed before the Project read", async () => {
  for (const [index, args] of [
    { workspaceId: "not-a-uuid" },
    { workspaceId: "00000000-0000-0000-0000-000000000000" },
    { workspaceId: PROJECTS_WORKSPACE_ID, limit: 101 },
    { workspaceId: PROJECTS_WORKSPACE_ID, offset: 10_001 },
    { workspaceId: PROJECTS_WORKSPACE_ID, search: "x".repeat(101) },
  ].entries()) {
    resetAuthorization();
    resetProjectsSlice();
    const result = toolResult(await callProjectsTool(args, 140 + index));
    assertStrictEquals(result.isError, true);
    assertStrictEquals(
      result.content?.[0]?.text,
      MCP_PROJECTS_TOOL_ERROR_MESSAGES.invalid_arguments,
    );
    assertStrictEquals(projectsReadCalls.length, 0);
  }
});

Deno.test("API-Q.7C K/L/M: canonical rate limiting guards the Projects read", async () => {
  resetAuthorization();
  resetProjectsSlice();
  toolResult(await callProjectsTool({ workspaceId: PROJECTS_WORKSPACE_ID }, 150));
  assertEquals(profileResolutions, [
    { apiClientId: API_CLIENT_ID, routeId: "projects.get" },
  ]);
  assertEquals(
    {
      apiClientId: rateLimitConsumptions[0].apiClientId,
      userId: rateLimitConsumptions[0].userId,
      routeId: rateLimitConsumptions[0].routeId,
    },
    { apiClientId: API_CLIENT_ID, userId: USER_ID, routeId: "projects.get" },
  );

  resetProjectsSlice();
  rateLimitAllowed = false;
  const denied = toolResult(
    await callProjectsTool({ workspaceId: PROJECTS_WORKSPACE_ID }, 151),
  );
  assertStrictEquals(denied.isError, true);
  assertStrictEquals(
    denied.content?.[0]?.text,
    MCP_PROJECTS_TOOL_ERROR_MESSAGES.rate_limited,
  );
  assertStrictEquals(projectsReadCalls.length, 0);
  resetProjectsSlice();
});

Deno.test("API-Q.7C P/Q/S: Projects failures stay bounded and leak nothing", async () => {
  resetAuthorization();
  resetProjectsSlice();
  projectsReadFailure = new ApiHttpError("not_authorized");
  const denied = toolResult(
    await callProjectsTool({ workspaceId: PROJECTS_WORKSPACE_ID }, 160),
  );
  assertStrictEquals(denied.isError, true);
  assertStrictEquals(
    denied.content?.[0]?.text,
    MCP_PROJECTS_TOOL_ERROR_MESSAGES.not_authorized,
  );

  resetProjectsSlice();
  projectsReadFailure = new Error(
    `42501: permission denied for table projects (policy proj_members_select) ${POLICY_VERSION_ID}`,
  );
  const raw = await callProjectsTool({ workspaceId: PROJECTS_WORKSPACE_ID }, 161);
  const serialized = JSON.stringify(raw);
  const failed = toolResult(raw);
  assertStrictEquals(failed.isError, true);
  assertStrictEquals(
    failed.content?.[0]?.text,
    MCP_PROJECTS_TOOL_ERROR_MESSAGES.unavailable,
  );
  for (
    const forbidden of [
      "42501",
      "permission denied",
      "policy",
      POLICY_VERSION_ID,
      VALID_TOKEN,
      API_CLIENT_ID,
    ]
  ) {
    assertEquals(
      serialized.toLowerCase().includes(forbidden.toLowerCase()),
      false,
      `Projects tool error must not disclose ${forbidden}`,
    );
  }
  resetProjectsSlice();
});

Deno.test("API-Q.7C R/T: the Projects adapter performs no service-role business read", () => {
  const tool = Deno.readTextFileSync(
    new URL("./mcp/projectsReadTool.ts", import.meta.url),
  );
  const code = stripComments(tool);
  for (
    const forbidden of [
      ".from(",
      ".rpc(",
      "api_v1_list_projects",
      "SERVICE_ROLE",
      "Deno.env",
      "fetch(",
      "project_members",
      "select ",
    ]
  ) {
    assertEquals(
      code.includes(forbidden),
      false,
      `the MCP Projects adapter must not contain ${forbidden}`,
    );
  }
  for (
    const reused of [
      "parseApiV1ProjectsQuery",
      "PROJECTS_ROUTE.id",
      "enforceApiRateLimit",
      "buildAuthenticatedApiContextFromMcp",
      "DelegatedApiV1ProjectsReader",
    ]
  ) {
    assert(tool.includes(reused), `expected reuse of ${reused}`);
  }
});

// -----------------------------------------------------------------------------
// API-Q.7D — Program / Project context vertical slices, end to end through the
// live MCP shell (authorization, provenance, rate limiting, delegated read).
// -----------------------------------------------------------------------------

async function callContextTool(
  name: string,
  args: Record<string, unknown>,
  id: number,
): Promise<Record<string, unknown>> {
  const response = await serve(
    post({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name, arguments: args, _meta: modernEnvelope() },
    }, {
      "mcp-protocol-version": MODERN_PROTOCOL_VERSION,
      "mcp-method": "tools/call",
      "mcp-name": name,
    }),
  );
  assertStrictEquals(response.status, 200);
  return await readJsonRpc(response);
}

interface ContextToolCase {
  readonly toolName: string;
  readonly routeId: string;
  readonly required: readonly string[];
  readonly validArgs: Record<string, unknown>;
  readonly expectedArgument: ApiV1ProgramsQuery | string;
  readonly payload: unknown;
  readonly invalidArgs: ReadonlyArray<Record<string, unknown>>;
  readonly errorMessages: Readonly<Record<string, string>>;
}

const CONTEXT_TOOL_CASES: readonly ContextToolCase[] = [
  {
    toolName: MCP_PROGRAMS_TOOL_NAME,
    routeId: "programs.get",
    required: ["workspaceId"],
    validArgs: { workspaceId: CONTEXT_WORKSPACE_ID },
    expectedArgument: {
      workspaceId: CONTEXT_WORKSPACE_ID,
      limit: 50,
      offset: 0,
      search: null,
    },
    payload: PROGRAMS_PAYLOAD,
    invalidArgs: [
      { workspaceId: "not-a-uuid" },
      { workspaceId: "00000000-0000-0000-0000-000000000000" },
      { workspaceId: CONTEXT_WORKSPACE_ID, limit: 101 },
      { workspaceId: CONTEXT_WORKSPACE_ID, offset: 10_001 },
      { workspaceId: CONTEXT_WORKSPACE_ID, search: "x".repeat(101) },
    ],
    errorMessages: MCP_PROGRAMS_TOOL_ERROR_MESSAGES,
  },
  {
    toolName: MCP_PROGRAM_DETAIL_TOOL_NAME,
    routeId: "programs.get_by_id",
    required: ["programId"],
    validArgs: { programId: CONTEXT_PROGRAM_ID },
    expectedArgument: CONTEXT_PROGRAM_ID,
    payload: PROGRAM_DETAIL_PAYLOAD,
    invalidArgs: [
      { programId: "not-a-uuid" },
      { programId: "00000000-0000-0000-0000-000000000000" },
      { programId: `${CONTEXT_PROGRAM_ID}/tasks` },
    ],
    errorMessages: MCP_PROGRAMS_TOOL_ERROR_MESSAGES,
  },
  {
    toolName: MCP_PROJECT_DETAIL_TOOL_NAME,
    routeId: "projects.get_by_id",
    required: ["projectId"],
    validArgs: { projectId: CONTEXT_PROJECT_ID },
    expectedArgument: CONTEXT_PROJECT_ID,
    payload: PROJECT_DETAIL_PAYLOAD,
    invalidArgs: [
      { projectId: "not-a-uuid" },
      { projectId: "00000000-0000-0000-0000-000000000000" },
      { projectId: `${CONTEXT_PROJECT_ID}?x=1` },
    ],
    errorMessages: MCP_PROJECT_CONTEXT_TOOL_ERROR_MESSAGES,
  },
  {
    toolName: MCP_PROJECT_PLANNING_TOOL_NAME,
    routeId: "projects.planning.get",
    required: ["projectId"],
    validArgs: { projectId: CONTEXT_PROJECT_ID },
    expectedArgument: CONTEXT_PROJECT_ID,
    payload: PROJECT_PLANNING_PAYLOAD,
    invalidArgs: [
      { projectId: "not-a-uuid" },
      { projectId: "00000000-0000-0000-0000-000000000000" },
      { projectId: `${CONTEXT_PROJECT_ID}/planning` },
    ],
    errorMessages: MCP_PROJECT_CONTEXT_TOOL_ERROR_MESSAGES,
  },
];

Deno.test("API-Q.7D D/E: every new tool advertises read-only annotations and its required input", async () => {
  resetAuthorization();
  resetContextSlice();
  const response = await serve(
    post({ jsonrpc: "2.0", id: 200, method: "tools/list", params: { _meta: modernEnvelope() } }, {
      "mcp-protocol-version": MODERN_PROTOCOL_VERSION,
      "mcp-method": "tools/list",
    }),
  );
  const payload = await readJsonRpc(response);
  const tools = (payload.result as {
    tools?: Array<{
      name?: string;
      annotations?: Record<string, unknown>;
      inputSchema?: { required?: string[] };
    }>;
  }).tools ?? [];

  for (const testCase of CONTEXT_TOOL_CASES) {
    const tool = tools.find((t) => t.name === testCase.toolName);
    assert(tool !== undefined, `expected tool ${testCase.toolName}`);
    assertEquals(tool.annotations?.readOnlyHint, true);
    assertEquals(tool.annotations?.destructiveHint, false);
    assertEquals(tool.annotations?.idempotentHint, true);
    assertEquals(tool.annotations?.openWorldHint, false);
    assertEquals(tool.inputSchema?.required, testCase.required);
  }
});

Deno.test("API-Q.7D F/G/H/I: each new read is caller-scoped and returns the exact canonical payload", async () => {
  for (const [index, testCase] of CONTEXT_TOOL_CASES.entries()) {
    resetAuthorization();
    resetContextSlice();
    const result = toolResult(
      await callContextTool(testCase.toolName, testCase.validArgs, 210 + index),
    );

    assertStrictEquals(contextReadCalls.length, 1);
    assertEquals(contextReadCalls[0].argument, testCase.expectedArgument);
    // The caller's own bearer token and server-derived identity only.
    assertStrictEquals(
      contextReadCalls[0].authorization,
      `Bearer ${VALID_TOKEN}`,
    );
    assertStrictEquals(contextReadCalls[0].oauthClientId, SIGNED_CLIENT_ID);
    assertStrictEquals(contextReadCalls[0].apiClientId, API_CLIENT_ID);
    assertStrictEquals(contextReadCalls[0].tokenUserId, USER_ID);

    assertEquals(result.structuredContent, testCase.payload);
    assertEquals(
      JSON.parse(result.content?.[0]?.text ?? "null"),
      testCase.payload,
    );
  }
});

Deno.test("API-Q.7D G/H/I: invalid arguments fail closed before any business read", async () => {
  let id = 230;
  for (const testCase of CONTEXT_TOOL_CASES) {
    for (const args of testCase.invalidArgs) {
      resetAuthorization();
      resetContextSlice();
      const result = toolResult(
        await callContextTool(testCase.toolName, args, id++),
      );
      assertStrictEquals(result.isError, true);
      assertStrictEquals(
        result.content?.[0]?.text,
        testCase.errorMessages.invalid_arguments,
      );
      assertStrictEquals(contextReadCalls.length, 0);
    }
  }
});

Deno.test("API-Q.7D F/G/H/I/J: canonical rate limiting guards each new read", async () => {
  let id = 300;
  for (const testCase of CONTEXT_TOOL_CASES) {
    resetAuthorization();
    resetContextSlice();
    toolResult(await callContextTool(testCase.toolName, testCase.validArgs, id++));
    assertEquals(profileResolutions, [
      { apiClientId: API_CLIENT_ID, routeId: testCase.routeId },
    ]);
    assertEquals(
      {
        apiClientId: rateLimitConsumptions[0].apiClientId,
        userId: rateLimitConsumptions[0].userId,
        routeId: rateLimitConsumptions[0].routeId,
      },
      {
        apiClientId: API_CLIENT_ID,
        userId: USER_ID,
        routeId: testCase.routeId,
      },
    );

    resetContextSlice();
    rateLimitAllowed = false;
    const denied = toolResult(
      await callContextTool(testCase.toolName, testCase.validArgs, id++),
    );
    assertStrictEquals(denied.isError, true);
    assertStrictEquals(
      denied.content?.[0]?.text,
      testCase.errorMessages.rate_limited,
    );
    assertStrictEquals(contextReadCalls.length, 0);
    resetContextSlice();
  }
});

Deno.test("API-Q.7D K/L: authorization and provider failures stay bounded and disclose nothing", async () => {
  let id = 400;
  for (const testCase of CONTEXT_TOOL_CASES) {
    resetAuthorization();
    resetContextSlice();
    contextReadFailure = new ApiHttpError("not_authorized");
    const denied = toolResult(
      await callContextTool(testCase.toolName, testCase.validArgs, id++),
    );
    assertStrictEquals(denied.isError, true);
    assertStrictEquals(
      denied.content?.[0]?.text,
      testCase.errorMessages.not_authorized,
    );

    resetContextSlice();
    contextReadFailure = new Error(
      `42501: permission denied for table projects (policy proj_members_select) ${POLICY_VERSION_ID}`,
    );
    const raw = await callContextTool(
      testCase.toolName,
      testCase.validArgs,
      id++,
    );
    const serialized = JSON.stringify(raw);
    const failed = toolResult(raw);
    assertStrictEquals(failed.isError, true);
    assertStrictEquals(
      failed.content?.[0]?.text,
      testCase.errorMessages.unavailable,
    );
    for (
      const forbidden of [
        "42501",
        "permission denied",
        "policy",
        POLICY_VERSION_ID,
        VALID_TOKEN,
        API_CLIENT_ID,
      ]
    ) {
      assertEquals(
        serialized.toLowerCase().includes(forbidden.toLowerCase()),
        false,
        `${testCase.toolName} error must not disclose ${forbidden}`,
      );
    }
    resetContextSlice();
  }
});

// -----------------------------------------------------------------------------
// API-Q.7E — Operational execution read vertical slices, end to end through the
// live MCP shell (authorization, provenance, rate limiting, delegated read).
// -----------------------------------------------------------------------------

interface OperationalToolCase {
  readonly toolName: string;
  readonly routeId: string;
  readonly required: readonly string[];
  readonly validArgs: Record<string, unknown>;
  readonly expectedArgument: unknown;
  readonly payload: unknown;
  readonly invalidArgs: ReadonlyArray<Record<string, unknown>>;
  readonly errorMessages: Readonly<Record<string, string>>;
}

const NIL = "00000000-0000-0000-0000-000000000000";

const OPERATIONAL_TOOL_CASES: readonly OperationalToolCase[] = [
  {
    toolName: MCP_PROJECT_RISKS_TOOL_NAME,
    routeId: "risks.get",
    required: ["projectId"],
    validArgs: { projectId: OPS_PROJECT_ID },
    expectedArgument: { projectId: OPS_PROJECT_ID, limit: 100, cursor: null },
    payload: PROJECT_RISKS_PAYLOAD,
    invalidArgs: [
      { projectId: "not-a-uuid" },
      { projectId: NIL },
      { projectId: OPS_PROJECT_ID, limit: 100_000 },
      { projectId: OPS_PROJECT_ID, cursor: "not-a-cursor" },
    ],
    errorMessages: MCP_RISK_TOOL_ERROR_MESSAGES,
  },
  {
    toolName: MCP_RISK_DETAIL_TOOL_NAME,
    routeId: "risks.get_by_id",
    required: ["riskId"],
    validArgs: { riskId: OPS_RISK_ID },
    expectedArgument: OPS_RISK_ID,
    payload: RISK_ITEM,
    invalidArgs: [
      { riskId: "not-a-uuid" },
      { riskId: NIL },
      { riskId: `${OPS_RISK_ID}/x` },
    ],
    errorMessages: MCP_RISK_TOOL_ERROR_MESSAGES,
  },
  {
    toolName: MCP_PROJECT_BLOCKERS_TOOL_NAME,
    routeId: "blockers.get",
    required: ["projectId"],
    validArgs: { projectId: OPS_PROJECT_ID },
    expectedArgument: { projectId: OPS_PROJECT_ID, limit: 100, cursor: null },
    payload: PROJECT_BLOCKERS_PAYLOAD,
    invalidArgs: [
      { projectId: "not-a-uuid" },
      { projectId: NIL },
      { projectId: OPS_PROJECT_ID, limit: 100_000 },
      { projectId: OPS_PROJECT_ID, cursor: "not-a-cursor" },
    ],
    errorMessages: MCP_BLOCKER_TOOL_ERROR_MESSAGES,
  },
  {
    toolName: MCP_BLOCKER_DETAIL_TOOL_NAME,
    routeId: "blockers.get_by_id",
    required: ["blockerId"],
    validArgs: { blockerId: OPS_BLOCKER_ID },
    expectedArgument: OPS_BLOCKER_ID,
    payload: BLOCKER_ITEM,
    invalidArgs: [
      { blockerId: "not-a-uuid" },
      { blockerId: NIL },
      { blockerId: `${OPS_BLOCKER_ID}?x=1` },
    ],
    errorMessages: MCP_BLOCKER_TOOL_ERROR_MESSAGES,
  },
  {
    toolName: MCP_EXECUTION_UPDATES_TOOL_NAME,
    routeId: "execution_updates.get",
    required: ["targetType", "targetId"],
    validArgs: { targetType: "phase", targetId: OPS_PHASE_ID },
    expectedArgument: {
      targetType: "phase",
      targetId: OPS_PHASE_ID,
      limit: 100,
      cursor: null,
    },
    payload: EXECUTION_UPDATES_PAYLOAD,
    invalidArgs: [
      { targetType: "Phase", targetId: OPS_PHASE_ID },
      { targetType: "project", targetId: OPS_PHASE_ID },
      { targetType: "phase", targetId: NIL },
      { targetType: "phase", targetId: "not-a-uuid" },
      { targetType: "phase", targetId: OPS_PHASE_ID, limit: 100_000 },
    ],
    errorMessages: MCP_EXECUTION_UPDATE_TOOL_ERROR_MESSAGES,
  },
  {
    toolName: MCP_PHASE_DETAIL_TOOL_NAME,
    routeId: "phases.get_by_id",
    required: ["phaseId"],
    validArgs: { phaseId: OPS_PHASE_ID },
    expectedArgument: OPS_PHASE_ID,
    payload: PHASE_DETAIL_PAYLOAD,
    invalidArgs: [
      { phaseId: "not-a-uuid" },
      { phaseId: NIL },
      { phaseId: `${OPS_PHASE_ID}/tasks` },
    ],
    errorMessages: MCP_PHASE_TOOL_ERROR_MESSAGES,
  },
  {
    toolName: MCP_TASK_DETAIL_TOOL_NAME,
    routeId: "tasks.get_by_id",
    required: ["taskId"],
    validArgs: { taskId: OPS_TASK_ID },
    expectedArgument: OPS_TASK_ID,
    payload: TASK_DETAIL_PAYLOAD,
    invalidArgs: [
      { taskId: "not-a-uuid" },
      { taskId: NIL },
      { taskId: `${OPS_TASK_ID}#x` },
    ],
    errorMessages: MCP_TASK_TOOL_ERROR_MESSAGES,
  },
];

Deno.test("API-Q.7E: every new tool advertises read-only annotations and its required input", async () => {
  resetAuthorization();
  resetOperationalSlice();
  const response = await serve(
    post({ jsonrpc: "2.0", id: 400, method: "tools/list", params: { _meta: modernEnvelope() } }, {
      "mcp-protocol-version": MODERN_PROTOCOL_VERSION,
      "mcp-method": "tools/list",
    }),
  );
  const payload = await readJsonRpc(response);
  const tools = (payload.result as {
    tools?: Array<{
      name?: string;
      annotations?: Record<string, unknown>;
      inputSchema?: { required?: string[] };
    }>;
  }).tools ?? [];

  for (const testCase of OPERATIONAL_TOOL_CASES) {
    const tool = tools.find((t) => t.name === testCase.toolName);
    assert(tool !== undefined, `expected tool ${testCase.toolName}`);
    assertEquals(tool.annotations?.readOnlyHint, true);
    assertEquals(tool.annotations?.destructiveHint, false);
    assertEquals(tool.annotations?.idempotentHint, true);
    assertEquals(tool.annotations?.openWorldHint, false);
    assertEquals(tool.inputSchema?.required, testCase.required);
  }
});

Deno.test("API-Q.7E: each new read is caller-scoped and returns the exact canonical payload", async () => {
  for (const [index, testCase] of OPERATIONAL_TOOL_CASES.entries()) {
    resetAuthorization();
    resetOperationalSlice();
    const result = toolResult(
      await callContextTool(testCase.toolName, testCase.validArgs, 410 + index),
    );

    assertStrictEquals(operationalReadCalls.length, 1);
    assertEquals(operationalReadCalls[0].argument, testCase.expectedArgument);
    assertStrictEquals(
      operationalReadCalls[0].authorization,
      `Bearer ${VALID_TOKEN}`,
    );
    assertStrictEquals(operationalReadCalls[0].oauthClientId, SIGNED_CLIENT_ID);
    assertStrictEquals(operationalReadCalls[0].apiClientId, API_CLIENT_ID);
    assertStrictEquals(operationalReadCalls[0].tokenUserId, USER_ID);

    assertEquals(result.structuredContent, testCase.payload);
    assertEquals(
      JSON.parse(result.content?.[0]?.text ?? "null"),
      testCase.payload,
    );
  }
});

Deno.test("API-Q.7E: invalid arguments fail closed before any business read", async () => {
  let id = 430;
  for (const testCase of OPERATIONAL_TOOL_CASES) {
    for (const args of testCase.invalidArgs) {
      resetAuthorization();
      resetOperationalSlice();
      const result = toolResult(
        await callContextTool(testCase.toolName, args, id++),
      );
      assertStrictEquals(result.isError, true);
      assertStrictEquals(
        result.content?.[0]?.text,
        testCase.errorMessages.invalid_arguments,
      );
      assertStrictEquals(operationalReadCalls.length, 0);
    }
  }
});

Deno.test("API-Q.7E: canonical rate limiting guards each new read", async () => {
  let id = 500;
  for (const testCase of OPERATIONAL_TOOL_CASES) {
    resetAuthorization();
    resetOperationalSlice();
    toolResult(await callContextTool(testCase.toolName, testCase.validArgs, id++));
    assertEquals(profileResolutions, [
      { apiClientId: API_CLIENT_ID, routeId: testCase.routeId },
    ]);
    assertEquals(
      {
        apiClientId: rateLimitConsumptions[0].apiClientId,
        userId: rateLimitConsumptions[0].userId,
        routeId: rateLimitConsumptions[0].routeId,
      },
      {
        apiClientId: API_CLIENT_ID,
        userId: USER_ID,
        routeId: testCase.routeId,
      },
    );

    resetOperationalSlice();
    rateLimitAllowed = false;
    const denied = toolResult(
      await callContextTool(testCase.toolName, testCase.validArgs, id++),
    );
    assertStrictEquals(denied.isError, true);
    assertStrictEquals(
      denied.content?.[0]?.text,
      testCase.errorMessages.rate_limited,
    );
    assertStrictEquals(operationalReadCalls.length, 0);
    resetOperationalSlice();
  }
});

Deno.test("API-Q.7E: failures stay bounded and disclose nothing", async () => {
  let id = 600;
  for (const testCase of OPERATIONAL_TOOL_CASES) {
    resetAuthorization();
    resetOperationalSlice();
    operationalReadFailure = new ApiHttpError("not_authorized");
    const denied = toolResult(
      await callContextTool(testCase.toolName, testCase.validArgs, id++),
    );
    assertStrictEquals(denied.isError, true);
    assertStrictEquals(
      denied.content?.[0]?.text,
      testCase.errorMessages.not_authorized,
    );

    resetOperationalSlice();
    operationalReadFailure = new Error(
      `42501: permission denied for table risks (policy x) ${POLICY_VERSION_ID}`,
    );
    const raw = await callContextTool(
      testCase.toolName,
      testCase.validArgs,
      id++,
    );
    const serialized = JSON.stringify(raw);
    const failed = toolResult(raw);
    assertStrictEquals(failed.isError, true);
    assertStrictEquals(
      failed.content?.[0]?.text,
      testCase.errorMessages.unavailable,
    );
    for (
      const forbidden of [
        "42501",
        "permission denied",
        "policy",
        POLICY_VERSION_ID,
        VALID_TOKEN,
        API_CLIENT_ID,
      ]
    ) {
      assertEquals(
        serialized.toLowerCase().includes(forbidden.toLowerCase()),
        false,
        `${testCase.toolName} error must not disclose ${forbidden}`,
      );
    }
    resetOperationalSlice();
  }
});

Deno.test("API-Q.7E: the new adapters perform no service-role business read", () => {
  for (
    const module of [
      "./mcp/operationalIssueReadTools.ts",
      "./mcp/executionContextReadTools.ts",
    ]
  ) {
    const source = Deno.readTextFileSync(new URL(module, import.meta.url));
    const code = stripComments(source);
    for (
      const forbidden of [
        ".from(",
        ".rpc(",
        "SERVICE_ROLE",
        "Deno.env",
        "fetch(",
        "api_v1_list_project_risks",
        "api_v1_get_risk",
        "api_v1_list_project_blockers",
        "api_v1_get_blocker",
        "api_v1_list_execution_updates",
        "api_v1_get_phase",
        "api_v1_get_task",
      ]
    ) {
      assertEquals(
        code.includes(forbidden),
        false,
        `${module} must not contain ${forbidden}`,
      );
    }
    for (
      const reused of [
        "enforceApiRateLimit",
        "buildAuthenticatedApiContextFromMcp",
      ]
    ) {
      assert(source.includes(reused), `${module} must reuse ${reused}`);
    }
  }
});

// ---------------------------------------------------------------------------
// UX-GAP.1A-C1 — public MCP protected-resource metadata browser read.
// ---------------------------------------------------------------------------

Deno.test("UX-GAP.1A-C1 A: metadata GET with a foreign browser Origin returns 200 with wildcard CORS and canonical fields", async () => {
  const response = await serve(
    new Request(METADATA_ENDPOINT, {
      method: "GET",
      headers: { origin: "https://btpm.example.test" },
    }),
  );
  assertStrictEquals(response.status, 200);
  assertStrictEquals(response.headers.get("access-control-allow-origin"), "*");
  assertStrictEquals(
    response.headers.get("access-control-allow-credentials"),
    null,
  );
  const body = await response.json() as Record<string, unknown>;
  assertStrictEquals(body.resource, RESOURCE_URI);
  assertEquals(body.authorization_servers, [EXPECTED_ISSUER]);
  assertEquals(body.bearer_methods_supported, ["header"]);
});

Deno.test("UX-GAP.1A-C1 B: metadata GET without an Origin header remains 200 and public", async () => {
  const response = await serve(new Request(METADATA_ENDPOINT, { method: "GET" }));
  assertStrictEquals(response.status, 200);
  assertStrictEquals(response.headers.get("access-control-allow-origin"), "*");
  const body = await response.json() as Record<string, unknown>;
  assertStrictEquals(body.resource, RESOURCE_URI);
});

Deno.test("UX-GAP.1A-C1 C: MCP protocol POST with a foreign Origin remains rejected with no CORS", async () => {
  const response = await serve(
    post(initializeRequest(MODERN_PROTOCOL_VERSION), {
      origin: "https://btpm.example.test",
    }, null),
  );
  assertStrictEquals(response.status, 403);
  assertStrictEquals(response.headers.get("access-control-allow-origin"), null);
  await response.text();
});

Deno.test("UX-GAP.1A-C1 D: wildcard CORS is emitted only by the metadata response", async () => {
  const shell = stripComments(
    Deno.readTextFileSync(new URL("./index.ts", import.meta.url)),
  );
  const occurrences = shell.split('"Access-Control-Allow-Origin": "*"').length -
    1;
  assertStrictEquals(occurrences, 1);
  assertEquals(shell.includes("Access-Control-Allow-Credentials"), false);

  // No generic MCP response carries CORS headers.
  const authorizedInitialize = await serve(
    post(initializeRequest(MODERN_PROTOCOL_VERSION)),
  );
  assertStrictEquals(
    authorizedInitialize.headers.get("access-control-allow-origin"),
    null,
  );
  await authorizedInitialize.text();

  const unauthenticated = await serve(
    post(initializeRequest(MODERN_PROTOCOL_VERSION), {}, null),
  );
  assertStrictEquals(
    unauthenticated.headers.get("access-control-allow-origin"),
    null,
  );
  await unauthenticated.text();

  const methodNotAllowed = await serve(
    new Request(ENDPOINT, { method: "DELETE" }),
  );
  assertStrictEquals(
    methodNotAllowed.headers.get("access-control-allow-origin"),
    null,
  );
  await methodNotAllowed.text();
});

// -----------------------------------------------------------------------------
// UX-GAP.1B1 — durable MCP connection-verification evidence (runtime wiring).
// -----------------------------------------------------------------------------

interface VerificationCall {
  readonly apiClientId: string;
  readonly actorUserId: string;
  readonly requestId: string;
}

function runtimeWithRecorder(
  impl: (call: VerificationCall) => Promise<boolean>,
): { runtime: BtpmMcpRuntime; calls: VerificationCall[] } {
  const calls: VerificationCall[] = [];
  const runtime: BtpmMcpRuntime = {
    ...RUNTIME,
    connectionVerificationRecorder: {
      record(input) {
        calls.push({ ...input });
        return impl(input);
      },
    },
  };
  return { runtime, calls };
}

const RECORDER_OK = () => Promise.resolve(true);

Deno.test("UX-GAP.1B1: a successful authenticated and authorized MCP request records verification exactly once", async () => {
  resetAuthorization();
  const { runtime, calls } = runtimeWithRecorder(RECORDER_OK);
  const response = await handleBtpmMcpRequest(
    post(initializeRequest(MODERN_PROTOCOL_VERSION)),
    runtime,
  );
  const body = await response.text();

  assertStrictEquals(response.status, 200);
  assertStrictEquals(calls.length, 1);
  assertStrictEquals(calls[0].apiClientId, API_CLIENT_ID);
  assertStrictEquals(calls[0].actorUserId, USER_ID);
  assertStrictEquals(
    calls[0].requestId,
    response.headers.get(BTPM_MCP_REQUEST_ID_HEADER),
  );
  // Exactly three safe fields: no bearer token, audience or scope may be passed.
  assertEquals(Object.keys(calls[0]).sort(), [
    "actorUserId",
    "apiClientId",
    "requestId",
  ]);
  // The normal MCP protocol handler still ran and answered the initialize call.
  assert(body.includes("protocolVersion"));
});

Deno.test("UX-GAP.1B1: unverified boundaries never record verification", async () => {
  resetAuthorization();
  const { runtime, calls } = runtimeWithRecorder(RECORDER_OK);

  // Metadata GET.
  const metadata = await handleBtpmMcpRequest(
    new Request(METADATA_ENDPOINT, { method: "GET" }),
    runtime,
  );
  assertStrictEquals(metadata.status, 200);
  await metadata.text();

  // Missing bearer token.
  const unauthenticated = await handleBtpmMcpRequest(
    post(initializeRequest(MODERN_PROTOCOL_VERSION), {}, null),
    runtime,
  );
  assertStrictEquals(unauthenticated.status, 401);
  await unauthenticated.text();

  // Wrong audience, wrong issuer and expired token.
  for (const token of ["authenticated-audience-only", "wrong-issuer", "expired"]) {
    const rejected = await handleBtpmMcpRequest(
      post(initializeRequest(MODERN_PROTOCOL_VERSION), {}, token),
      runtime,
    );
    assertStrictEquals(rejected.status, 401);
    await rejected.text();
  }

  // Foreign-Origin POST.
  const foreignOrigin = await handleBtpmMcpRequest(
    post(initializeRequest(MODERN_PROTOCOL_VERSION), {
      origin: "https://attacker.example",
    }),
    runtime,
  );
  assertStrictEquals(foreignOrigin.status, 403);
  await foreignOrigin.text();

  // Non-POST protocol traffic.
  const wrongMethod = await handleBtpmMcpRequest(
    new Request(ENDPOINT, { method: "DELETE" }),
    runtime,
  );
  assertStrictEquals(wrongMethod.status, 405);
  await wrongMethod.text();

  // Connected App authorization denial.
  storeFixture.clients = [];
  const denied = await handleBtpmMcpRequest(
    post(initializeRequest(MODERN_PROTOCOL_VERSION)),
    runtime,
  );
  assertStrictEquals(denied.status, 403);
  await denied.text();
  resetAuthorization();

  assertStrictEquals(calls.length, 0);
});

Deno.test("UX-GAP.1B1: recorder failure never blocks an otherwise successful MCP request", async () => {
  const SENSITIVE = "sensitive recorder failure detail";
  const impls: Array<() => Promise<boolean>> = [
    () => Promise.resolve(false),
    () => Promise.reject(new Error(SENSITIVE)),
    () => {
      throw new Error(SENSITIVE);
    },
  ];

  for (const impl of impls) {
    resetAuthorization();
    const { runtime, calls } = runtimeWithRecorder(impl);
    const response = await handleBtpmMcpRequest(
      post(initializeRequest(MODERN_PROTOCOL_VERSION)),
      runtime,
    );
    const body = await response.text();

    assertStrictEquals(response.status, 200);
    assertStrictEquals(calls.length, 1);
    // The normal MCP protocol handler still ran unchanged.
    assert(body.includes("protocolVersion"));
    assertStrictEquals(body.includes(SENSITIVE), false);
  }
});

Deno.test("UX-GAP.1B1-C1: an authenticated malformed MCP protocol request records nothing", async () => {
  resetAuthorization();
  const { runtime, calls } = runtimeWithRecorder(RECORDER_OK);

  // Valid bearer token and Connected App authorization, but the body is not a
  // valid JSON-RPC/MCP payload. The official MCP handler is the authority here —
  // it is not mocked away — and rejects it at the HTTP level.
  const malformed = new Request(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${VALID_TOKEN}`,
    },
    body: "this-is-not-json",
  });
  const response = await handleBtpmMcpRequest(malformed, runtime);
  await response.text();

  assertStrictEquals(response.ok, false);
  assert(response.status >= 400);
  assertStrictEquals(calls.length, 0);
});

Deno.test("UX-GAP.1B1-C1: source ordering places the recorder after the official MCP handler", () => {
  const shell = stripComments(
    Deno.readTextFileSync(new URL("./index.ts", import.meta.url)),
  );
  const contextAt = shell.indexOf("buildMcpExecutionContext(authorized)");
  const handlerAt = shell.lastIndexOf("createRequestHandler(");
  const fetchAt = shell.lastIndexOf(".fetch(request)");
  const okAt = shell.indexOf("if (response.ok)");
  const recordAt = shell.indexOf("connectionVerificationRecorder?.record(");

  assert(contextAt > 0 && handlerAt > contextAt);
  assert(fetchAt > handlerAt);
  assert(okAt > fetchAt, "verification decision must follow the MCP response");
  assert(recordAt > okAt, "recorder must never precede the MCP handler");
  assertStrictEquals(
    shell.split("connectionVerificationRecorder?.record(").length - 1,
    1,
  );
});
