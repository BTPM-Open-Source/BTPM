// API-Q.3 / API-Q.4 / API-Q.5 / API-Q.6 / API-Q.7A — BTPM MCP Streamable HTTP
// shell with the OAuth protected-resource boundary, Connected App binding,
// trusted provenance and the first real business-read tool.
//
// Protocol + authentication infrastructure only. The official MCP TypeScript
// SDK v2 owns JSON-RPC validation, protocol-version negotiation, standard MCP
// errors, modern (2026-07-28) Streamable HTTP and stateless 2025-era
// compatibility.
//
// API-Q.5 binds every authenticated request to canonical BTPM Connected App
// governance by reusing `_shared/btpm-api/authorizeClient.ts` verbatim.
//
// The privileged service-role client constructed here has exactly THREE
// permitted infrastructure purposes after UX-GAP.1B1:
//   A. Connected App authorization substrate, via
//      `createSupabaseClientAuthorizationStore`: `public.api_clients`,
//      `public.api_client_policy_versions`,
//      `public.api_user_policy_acknowledgements`;
//   B. canonical rate-limit infrastructure, via
//      `createSupabaseRateLimitProfileResolver` /
//      `createSupabaseRateLimitStore`:
//      `public.api_rate_limit_profile_catalogue` and
//      `public.consume_api_rate_limit_v1`;
//   C. UX-GAP.1B1 MCP connection-verification evidence recording, via
//      `createMcpConnectionVerificationRecorder`:
//      `public.api_g_5_10_record_mcp_connection_verification` only.
// It NEVER performs any BTPM business read or write.
//
// The Organizations business read is caller-scoped: it runs through the accepted
// anon-key delegated reader (`createDelegatedApiV1OrganizationsReader`), which
// binds the caller's own bearer token so RLS and canonical containment apply
// unchanged.
//
// This module MUST NOT: query PostgreSQL business tables directly, decrypt
// data, mutate BTPM records, implement PM-domain logic, duplicate canonical BTPM
// API logic, evaluate Connected App capability grants, read business tables
// through the service role, perform an HTTP call to `btpm-api-v1`, or accept
// caller-selected tenant/organization/workspace/project authority or provenance.
//
// API-Q.6 constructs the trusted, server-derived MCP execution context
// (`source_channel = mcp`, `delegation_mode = delegated_user`) after
// authentication and Connected App authorization succeed, and injects it into a
// per-request MCP handler. Caller input can never influence provenance. No
// provenance is persisted in API-Q.7A: `organizations.get` is a read, so no
// activity event, audit row, PMG call or idempotency record is written.

import { createMcpHandler } from "npm:@modelcontextprotocol/server@2.0.0";
import { createClient } from "@supabase/supabase-js";

import { createBtpmMcpServer } from "./mcp/serverFactory.ts";
import {
  authenticateMcpRequest,
  type McpAuthenticationContext,
} from "./mcp/authenticateMcpRequest.ts";
import {
  buildMcpProtectedResourceMetadata,
  buildMcpInvalidTokenWwwAuthenticate,
  buildMcpWwwAuthenticate,
  deriveSupabaseAuthorizationServer,
  isMcpProtectedResourceMetadataPath,
  normalizeMcpResourceUri,
} from "./mcp/oauthProtectedResource.ts";
import {
  buildMcpExecutionContext,
  type McpTrustedExecutionContext,
} from "./mcp/buildMcpExecutionContext.ts";
import {
  authorizeMcpConnectedApp,
  McpConnectedAppAuthorizationError,
  type McpAuthorizedContext,
} from "./mcp/authorizeMcpConnectedApp.ts";
import {
  type ClientAuthorizationStore,
  createSupabaseClientAuthorizationStore,
  type SupabaseAuthorizationServerClient,
} from "../_shared/btpm-api/authorizeClient.ts";
import { ApiAuthenticationError } from "../_shared/btpm-api/apiErrors.ts";
import {
  createSupabaseCurrentUserResolver,
  createSupabaseTokenVerifier,
  type TokenContextDependencies,
} from "../_shared/btpm-api/resolveTokenContext.ts";
import {
  createMcpConnectionVerificationRecorder,
  type McpConnectionVerificationClient,
  type McpConnectionVerificationRecorder,
} from "./mcp/connectionVerificationRecorder.ts";
import { createMcpOrganizationsToolExecutor } from "./mcp/organizationsReadTool.ts";
import { createMcpWorkspacesToolExecutor } from "./mcp/workspacesReadTool.ts";
import { createMcpWorkspaceMembersToolExecutor } from "./mcp/workspaceMembersReadTool.ts";
import { createMcpProjectsToolExecutor } from "./mcp/projectsReadTool.ts";
import {
  createMcpProgramDetailToolExecutor,
  createMcpProgramsToolExecutor,
} from "./mcp/programsReadTools.ts";
import {
  createMcpPortfolioDetailToolExecutor,
  createMcpPortfolioProjectsToolExecutor,
  createMcpPortfoliosToolExecutor,
} from "./mcp/portfolioReadTools.ts";
import {
  createMcpProjectDetailToolExecutor,
  createMcpProjectPlanningToolExecutor,
} from "./mcp/projectContextReadTools.ts";
import {
  createMcpBlockerDetailToolExecutor,
  createMcpProjectBlockersToolExecutor,
  createMcpProjectRisksToolExecutor,
  createMcpRiskDetailToolExecutor,
} from "./mcp/operationalIssueReadTools.ts";
import {
  createMcpExecutionUpdatesToolExecutor,
  createMcpPhaseDetailToolExecutor,
  createMcpTaskDetailToolExecutor,
} from "./mcp/executionContextReadTools.ts";
import { createMcpExecutionUpdateAppendToolExecutor } from "./mcp/executionUpdateMutationTool.ts";
import {
  createMcpV1AppendExecutionUpdateExecutor,
  type McpAppendExecutionUpdateClientFactory,
  type McpV1AppendExecutionUpdateExecutor,
} from "./mcp/executionUpdateMutationExecutor.ts";
import { createMcpBlockerCreateToolExecutor } from "./mcp/blockerCreateMutationTool.ts";
import {
  createMcpV1CreateBlockerExecutor,
  type McpCreateBlockerClientFactory,
  type McpV1CreateBlockerExecutor,
} from "./mcp/blockerCreateMutationExecutor.ts";
import { createMcpPhaseCreateToolExecutor } from "./mcp/phaseCreateMutationTool.ts";
import {
  createMcpV1CreatePhaseExecutor,
  type McpCreatePhaseClientFactory,
  type McpV1CreatePhaseExecutor,
} from "./mcp/phaseCreateMutationExecutor.ts";
import { createMcpPhaseUpdateToolExecutor } from "./mcp/phaseUpdateMutationTool.ts";
import {
  createMcpV1UpdatePhaseExecutor,
  type McpUpdatePhaseClientFactory,
  type McpV1UpdatePhaseExecutor,
} from "./mcp/phaseUpdateMutationExecutor.ts";
import { createMcpPhaseReorderToolExecutor } from "./mcp/phaseReorderMutationTool.ts";
import { createMcpPhasePlanToolExecutor } from "./mcp/phasePlanMutationTool.ts";
import {
  createMcpV1ReorderPhasesExecutor,
  type McpReorderPhasesClientFactory,
  type McpV1ReorderPhasesExecutor,
} from "./mcp/phaseReorderMutationExecutor.ts";
import {
  createMcpV1PlanPhaseExecutor,
  type McpPlanPhaseClientFactory,
  type McpV1PlanPhaseExecutor,
} from "./mcp/phasePlanMutationExecutor.ts";
import { createMcpTaskCreateToolExecutor } from "./mcp/taskCreateMutationTool.ts";
import {
  createMcpV1CreateTaskExecutor,
  type McpCreateTaskClientFactory,
  type McpV1CreateTaskExecutor,
} from "./mcp/taskCreateMutationExecutor.ts";
import { createMcpTaskUpdateToolExecutor } from "./mcp/taskUpdateMutationTool.ts";
import {
  createMcpV1UpdateTaskExecutor,
  type McpUpdateTaskClientFactory,
  type McpV1UpdateTaskExecutor,
} from "./mcp/taskUpdateMutationExecutor.ts";
import { createMcpTaskReorderToolExecutor } from "./mcp/taskReorderMutationTool.ts";
import {
  createMcpV1ReorderTasksExecutor,
  type McpReorderTasksClientFactory,
  type McpV1ReorderTasksExecutor,
} from "./mcp/taskReorderMutationExecutor.ts";
import { createMcpTaskPlanToolExecutor } from "./mcp/taskPlanMutationTool.ts";
import {
  createMcpV1PlanTaskExecutor,
  type McpPlanTaskClientFactory,
  type McpV1PlanTaskExecutor,
} from "./mcp/taskPlanMutationExecutor.ts";
import { createMcpTaskAssignToolExecutor } from "./mcp/taskAssignMutationTool.ts";
import {
  createMcpV1AssignTaskExecutor,
  type McpAssignTaskClientFactory,
  type McpV1AssignTaskExecutor,
} from "./mcp/taskAssignMutationExecutor.ts";
import { createMcpTaskTransitionToolExecutor } from "./mcp/taskTransitionMutationTool.ts";
import {
  createMcpV1TransitionTaskExecutor,
  type McpTransitionTaskClientFactory,
  type McpV1TransitionTaskExecutor,
} from "./mcp/taskTransitionMutationExecutor.ts";
import { createMcpProjectCreateToolExecutor } from "./mcp/projectCreateMutationTool.ts";
import {
  createMcpV1CreateProjectExecutor,
  type McpCreateProjectClientFactory,
  type McpV1CreateProjectExecutor,
} from "./mcp/projectCreateMutationExecutor.ts";
import { createMcpProjectUpdateToolExecutor } from "./mcp/projectUpdateMutationTool.ts";
import {
  createMcpV1UpdateProjectExecutor,
  type McpUpdateProjectClientFactory,
  type McpV1UpdateProjectExecutor,
} from "./mcp/projectUpdateMutationExecutor.ts";
import { createMcpProjectTransitionToolExecutor } from "./mcp/projectTransitionMutationTool.ts";
import {
  createMcpV1TransitionProjectExecutor,
  type McpTransitionProjectClientFactory,
  type McpV1TransitionProjectExecutor,
} from "./mcp/projectTransitionMutationExecutor.ts";
import { createMcpProgramCreateToolExecutor } from "./mcp/programCreateMutationTool.ts";
import {
  createMcpV1CreateProgramExecutor,
  type McpCreateProgramClientFactory,
  type McpV1CreateProgramExecutor,
} from "./mcp/programCreateMutationExecutor.ts";
import { createMcpPortfolioCreateToolExecutor } from "./mcp/portfolioCreateMutationTool.ts";
import {
  createMcpV1CreatePortfolioExecutor,
  type McpCreatePortfolioClientFactory,
  type McpV1CreatePortfolioExecutor,
} from "./mcp/portfolioCreateMutationExecutor.ts";
import { createMcpPortfolioUpdateToolExecutor } from "./mcp/portfolioUpdateMutationTool.ts";
import {
  createMcpV1UpdatePortfolioExecutor,
  type McpUpdatePortfolioClientFactory,
  type McpV1UpdatePortfolioExecutor,
} from "./mcp/portfolioUpdateMutationExecutor.ts";
import { createMcpPortfolioAssignProjectToolExecutor } from "./mcp/portfolioAssignmentMutationTool.ts";
import {
  createMcpV1AssignProjectPortfolioExecutor,
  type McpAssignProjectPortfolioClientFactory,
  type McpV1AssignProjectPortfolioExecutor,
} from "./mcp/portfolioAssignmentMutationExecutor.ts";
import { createMcpProgramUpdateToolExecutor } from "./mcp/programUpdateMutationTool.ts";
import {
  createMcpV1UpdateProgramExecutor,
  type McpUpdateProgramClientFactory,
  type McpV1UpdateProgramExecutor,
} from "./mcp/programUpdateMutationExecutor.ts";
import { createMcpBlockerUpdateToolExecutor } from "./mcp/blockerUpdateMutationTool.ts";
import {
  createMcpV1UpdateBlockerExecutor,
  type McpUpdateBlockerClientFactory,
  type McpV1UpdateBlockerExecutor,
} from "./mcp/blockerUpdateMutationExecutor.ts";
import { createMcpKpiCreateToolExecutor } from "./mcp/kpiCreateMutationTool.ts";
import {
  createMcpV1CreateKpiExecutor,
  type McpCreateKpiClientFactory,
  type McpV1CreateKpiExecutor,
} from "./mcp/kpiCreateMutationExecutor.ts";
import { createMcpKpiUpdateToolExecutor } from "./mcp/kpiUpdateMutationTool.ts";
import {
  createMcpV1UpdateKpiExecutor,
  type McpUpdateKpiClientFactory,
  type McpV1UpdateKpiExecutor,
} from "./mcp/kpiUpdateMutationExecutor.ts";
import { createMcpKpiUpdateAppendToolExecutor } from "./mcp/kpiUpdateAppendMutationTool.ts";
import {
  createMcpV1AppendKpiUpdateExecutor,
  type McpAppendKpiUpdateClientFactory,
  type McpV1AppendKpiUpdateExecutor,
} from "./mcp/kpiUpdateAppendMutationExecutor.ts";
import { createMcpRiskCreateToolExecutor } from "./mcp/riskCreateMutationTool.ts";
import {
  createMcpV1CreateRiskExecutor,
  type McpCreateRiskClientFactory,
  type McpV1CreateRiskExecutor,
} from "./mcp/riskCreateMutationExecutor.ts";
import { createMcpRiskUpdateToolExecutor } from "./mcp/riskUpdateMutationTool.ts";
import {
  createMcpV1UpdateRiskExecutor,
  type McpUpdateRiskClientFactory,
  type McpV1UpdateRiskExecutor,
} from "./mcp/riskUpdateMutationExecutor.ts";
import {
  createDelegatedApiV1OrganizationsReader,
  type DelegatedApiV1OrganizationsReader,
  type DelegatedOrganizationsClientFactory,
} from "../_shared/btpm-api/supabaseDelegatedOrganizations.ts";
import {
  createDelegatedApiV1WorkspacesReader,
  type DelegatedApiV1WorkspacesReader,
  type DelegatedWorkspacesClientFactory,
} from "../_shared/btpm-api/supabaseDelegatedWorkspaces.ts";
import {
  createDelegatedApiV1WorkspaceMembersReader,
  type DelegatedApiV1WorkspaceMembersReader,
  type DelegatedWorkspaceMembersClientFactory,
} from "../_shared/btpm-api/supabaseDelegatedWorkspaceMembers.ts";
// ME-3 — accepted caller-scoped delegated `/v1/me` reader.
import {
  createDelegatedApiV1MeReader,
  type DelegatedApiV1MeReader,
  type DelegatedReadClientFactory as DelegatedMeClientFactory,
} from "../_shared/btpm-api/supabaseDelegatedReadMe.ts";
import { createMcpMeToolExecutor } from "./mcp/meReadTool.ts";
// KPI-1C — accepted KPI-1B caller-scoped delegated Project KPI reader.
import {
  createDelegatedApiV1KpiReader,
  createDelegatedApiV1KpiUpdatesReader,
  createDelegatedApiV1ProjectKpisReader,
  type DelegatedApiV1KpiReader,
  type DelegatedApiV1KpiUpdatesReader,
  type DelegatedApiV1ProjectKpisReader,
  type DelegatedKpiReadClientFactory,
} from "../_shared/btpm-api/supabaseDelegatedKpiRead.ts";
import {
  createMcpKpiDetailToolExecutor,
  createMcpKpiUpdatesToolExecutor,
  createMcpProjectKpisToolExecutor,
} from "./mcp/kpiReadTool.ts";

import {
  createDelegatedApiV1ProjectsReader,
  type DelegatedApiV1ProjectsReader,
  type DelegatedProjectsClientFactory,
} from "../_shared/btpm-api/supabaseDelegatedProjects.ts";
import {
  createDelegatedApiV1ProgramReader,
  createDelegatedApiV1ProgramsReader,
  type DelegatedApiV1ProgramReader,
  type DelegatedApiV1ProgramsReader,
  type DelegatedProgramClientFactory,
} from "../_shared/btpm-api/supabaseDelegatedProgramRead.ts";
import {
  createDelegatedApiV1PortfolioProjectsReader,
  createDelegatedApiV1PortfolioReader,
  createDelegatedApiV1PortfoliosReader,
  type DelegatedApiV1PortfolioProjectsReader,
  type DelegatedApiV1PortfolioReader,
  type DelegatedApiV1PortfoliosReader,
  type DelegatedPortfolioClientFactory,
} from "../_shared/btpm-api/supabaseDelegatedPortfolioRead.ts";
import {
  createDelegatedApiV1ProjectDetailReader,
  type DelegatedApiV1ProjectDetailReader,
  type DelegatedProjectDetailClientFactory,
} from "../_shared/btpm-api/supabaseDelegatedProjectDetail.ts";
import {
  createDelegatedApiV1ProjectPlanningReader,
  type DelegatedApiV1ProjectPlanningReader,
  type DelegatedProjectPlanningClientFactory,
} from "../_shared/btpm-api/supabaseDelegatedProjectPlanning.ts";
import {
  createDelegatedApiV1ProjectRisksReader,
  createDelegatedApiV1RiskReader,
  type DelegatedApiV1ProjectRisksReader,
  type DelegatedApiV1RiskReader,
  type DelegatedRiskReadClientFactory,
} from "../_shared/btpm-api/supabaseDelegatedRiskRead.ts";
import {
  createDelegatedApiV1BlockerReader,
  createDelegatedApiV1ProjectBlockersReader,
  type DelegatedApiV1BlockerReader,
  type DelegatedApiV1ProjectBlockersReader,
  type DelegatedBlockerReadClientFactory,
} from "../_shared/btpm-api/supabaseDelegatedBlockerRead.ts";
import {
  createDelegatedApiV1ExecutionUpdatesReader,
  type DelegatedApiV1ExecutionUpdatesReader,
  type DelegatedExecutionUpdateReadClientFactory,
} from "../_shared/btpm-api/supabaseDelegatedExecutionUpdateRead.ts";
import {
  createDelegatedApiV1PhaseReader,
  type DelegatedApiV1PhaseReader,
  type DelegatedPhaseReadClientFactory,
} from "../_shared/btpm-api/supabaseDelegatedPhaseRead.ts";
import {
  createDelegatedApiV1TaskReader,
  type DelegatedApiV1TaskReader,
  type DelegatedTaskReadClientFactory,
} from "../_shared/btpm-api/supabaseDelegatedTaskRead.ts";
import type { ApiRateLimitStore } from "../_shared/btpm-api/rateLimit.ts";
import {
  type ApiRateLimitProfileResolver,
  createSupabaseRateLimitProfileResolver,
  createSupabaseRateLimitStore,
  type SupabaseRateLimitClient,
} from "../_shared/btpm-api/supabaseRateLimit.ts";


/** Server-derived request correlation header. Caller values are never trusted. */
export const BTPM_MCP_REQUEST_ID_HEADER = "X-BTPM-Request-ID";

/** Single bounded external authentication message. No internal reason leaks. */
const AUTHENTICATION_REQUIRED_BODY = JSON.stringify({
  error: "unauthorized",
  message: "Authentication required.",
});

/**
 * Single bounded Connected App authorization message. Which governance rule
 * failed (missing client, ambiguous client, inactive client, missing/ambiguous
 * active policy, missing/stale/revoked acknowledgement, store failure) is never
 * disclosed.
 */
const CONNECTED_APP_FORBIDDEN_BODY = JSON.stringify({
  error: "forbidden",
  message: "Connected App authorization denied.",
});

/**
 * The authenticated MCP runtime. Constructed from server-controlled
 * configuration only.
 */
export interface BtpmMcpRuntime {
  /** Canonical, normalized `BTPM_MCP_RESOURCE_URI`. */
  readonly resourceUri: string;
  /** Supabase Auth issuer: normalized `SUPABASE_URL` + "/auth/v1". */
  readonly authorizationServer: string;
  readonly tokenDependencies: TokenContextDependencies;
  /** Canonical Connected App / policy-acknowledgement authorization store. */
  readonly authorizationStore: ClientAuthorizationStore;
  /**
   * UX-GAP.1B1 — optional MCP connection-verification evidence recorder.
   * Operational telemetry only; never a business-write precondition.
   */
  readonly connectionVerificationRecorder?: McpConnectionVerificationRecorder;
  /** Accepted caller-scoped delegated `/v1/organizations` reader (anon key). */
  readonly organizationsReader: DelegatedApiV1OrganizationsReader;
  /** Accepted caller-scoped delegated `/v1/workspaces` reader (anon key). */
  readonly workspacesReader: DelegatedApiV1WorkspacesReader;
  /** API-Q WML-1C caller-scoped delegated Workspace-member reader (anon key). */
  readonly workspaceMembersReader: DelegatedApiV1WorkspaceMembersReader;
  /** ME-3 accepted caller-scoped delegated `/v1/me` reader (anon key). */
  readonly meReader: DelegatedApiV1MeReader;
  /** KPI-1C accepted caller-scoped delegated Project KPI reader (anon key). */
  readonly kpisReader: DelegatedApiV1ProjectKpisReader;
  /** KPI-2C accepted caller-scoped delegated single-KPI reader (anon key). */
  readonly kpiReader: DelegatedApiV1KpiReader;
  readonly kpiUpdatesReader: DelegatedApiV1KpiUpdatesReader;

  /** Accepted caller-scoped delegated `/v1/projects` reader (anon key). */
  readonly projectsReader: DelegatedApiV1ProjectsReader;
  /** Accepted caller-scoped delegated `/v1/programs` reader (anon key). */
  readonly programsReader: DelegatedApiV1ProgramsReader;
  /** Accepted caller-scoped delegated Program detail reader (anon key). */
  readonly programReader: DelegatedApiV1ProgramReader;
  /** API-Q Portfolio-8 caller-scoped delegated `/v1/portfolios` reader. */
  readonly portfoliosReader: DelegatedApiV1PortfoliosReader;
  /** API-Q Portfolio-8 caller-scoped delegated Portfolio detail reader. */
  readonly portfolioReader: DelegatedApiV1PortfolioReader;
  /** API-Q Portfolio-8 caller-scoped delegated Portfolio Projects reader. */
  readonly portfolioProjectsReader: DelegatedApiV1PortfolioProjectsReader;

  /** Accepted caller-scoped delegated Project detail reader (anon key). */
  readonly projectDetailReader: DelegatedApiV1ProjectDetailReader;
  /** Accepted caller-scoped delegated Project planning reader (anon key). */
  readonly projectPlanningReader: DelegatedApiV1ProjectPlanningReader;
  /** Accepted caller-scoped delegated Project Risks reader (anon key). */
  readonly projectRisksReader: DelegatedApiV1ProjectRisksReader;
  /** Accepted caller-scoped delegated Risk detail reader (anon key). */
  readonly riskReader: DelegatedApiV1RiskReader;
  /** Accepted caller-scoped delegated Project Blockers reader (anon key). */
  readonly projectBlockersReader: DelegatedApiV1ProjectBlockersReader;
  /** Accepted caller-scoped delegated Blocker detail reader (anon key). */
  readonly blockerReader: DelegatedApiV1BlockerReader;
  /** Accepted caller-scoped delegated Execution Updates reader (anon key). */
  readonly executionUpdatesReader: DelegatedApiV1ExecutionUpdatesReader;
  /** Accepted caller-scoped delegated Phase detail reader (anon key). */
  readonly phaseReader: DelegatedApiV1PhaseReader;
  /** Accepted caller-scoped delegated Task detail reader (anon key). */
  readonly taskReader: DelegatedApiV1TaskReader;
  /**
   * API-Q.9B2: the single caller-bound MCP business mutation writer
   * (anon key + the caller's own bearer token). The privileged service-role
   * client is never passed here.
   */
  readonly executionUpdateWriter: McpV1AppendExecutionUpdateExecutor;
  /**
   * API-Q.10A5: the caller-bound MCP Risk-create business mutation writer
   * (anon key + the caller's own bearer token). The privileged service-role
   * client is never passed here.
   */
  readonly riskCreateWriter: McpV1CreateRiskExecutor;
  /**
   * KPI-4C: the caller-bound MCP KPI-create business mutation writer (anon key
   * + the caller's own bearer token). The privileged service-role client is
   * never passed here.
   */
  readonly kpiCreateWriter: McpV1CreateKpiExecutor;
  /**
   * KPI-5C: the caller-bound MCP KPI-update business mutation writer (anon key
   * + the caller's own bearer token). The privileged service-role client is
   * never passed here.
   */
  readonly kpiUpdateWriter: McpV1UpdateKpiExecutor;
  /**
   * KPI-6C: the caller-bound MCP KPI update-history append business mutation
   * writer (anon key + the caller's own bearer token). The privileged
   * service-role client is never passed here.
   */
  readonly kpiUpdateAppendWriter: McpV1AppendKpiUpdateExecutor;
  /**
   * API-Q.10B4: the caller-bound MCP Risk-update business mutation writer
   * (anon key + the caller's own bearer token). The privileged service-role
   * client is never passed here.
   */
  readonly riskUpdateWriter: McpV1UpdateRiskExecutor;
  /**
   * API-Q.10C4: the caller-bound MCP Blocker-create business mutation writer
   * (anon key + the caller's own bearer token). The privileged service-role
   * client is never passed here.
   */
  readonly blockerCreateWriter: McpV1CreateBlockerExecutor;
  /**
   * API-Q.10D4: the caller-bound MCP Blocker-update business mutation writer
   * (anon key + the caller's own bearer token). The privileged service-role
   * client is never passed here.
   */
  readonly blockerUpdateWriter: McpV1UpdateBlockerExecutor;
  /**
   * API-Q Phase Create Step 4: the caller-bound MCP Phase-create business
   * mutation writer (anon key + the caller's own bearer token). The privileged
   * service-role client is never passed here.
   */
  readonly phaseCreateWriter: McpV1CreatePhaseExecutor;
  /**
   * API-Q Phase Update Step 4: the caller-bound MCP Phase-update business
   * mutation writer (anon key + the caller's own bearer token). The privileged
   * service-role client is never passed here. `expectedUpdatedAt` is never
   * inspected, refreshed or retried by the runtime.
   */
  readonly phaseUpdateWriter: McpV1UpdatePhaseExecutor;
  /**
   * API-Q Phase Reorder Step 4: the caller-bound MCP Phase-reorder business
   * mutation writer (anon key + the caller's own bearer token). The privileged
   * service-role client is never passed here. No row's `expectedUpdatedAt` is
   * inspected, refreshed or retried by the runtime.
   */
  readonly phaseReorderWriter: McpV1ReorderPhasesExecutor;
  /**
   * API-Q Phase Plan Step 4: the caller-bound MCP Phase-planning business
   * mutation writer (anon key + the caller's own bearer token). The privileged
   * service-role client is never passed here. `expectedUpdatedAt` is never
   * inspected, refreshed or retried by the runtime, and no Project-window
   * extension is ever auto-approved.
   */
  readonly phasePlanWriter: McpV1PlanPhaseExecutor;
  /**
   * API-Q Task Create Step 4: the caller-bound MCP Task-create business
   * mutation writer (anon key + the caller's own bearer token). The privileged
   * service-role client is never passed here. No Phase window is widened and
   * nothing is retried by the runtime.
   */
  readonly taskCreateWriter: McpV1CreateTaskExecutor;
  /**
   * API-Q Task Update Step 4: the caller-bound MCP Task-update business
   * mutation writer (anon key + the caller's own bearer token). The privileged
   * service-role client is never passed here. `expectedUpdatedAt` is never
   * inspected, refreshed or retried by the runtime.
   */
  readonly taskUpdateWriter: McpV1UpdateTaskExecutor;
  /**
   * API-Q Task Reorder Step 4: the caller-bound MCP Task-reorder business
   * mutation writer (anon key + the caller's own bearer token). The privileged
   * service-role client is never passed here. No row's `expectedUpdatedAt` is
   * inspected, refreshed or retried by the runtime.
   */
  readonly taskReorderWriter: McpV1ReorderTasksExecutor;
  /**
   * API-Q Task Plan Step 4: the caller-bound MCP Task-planning business mutation
   * writer (anon key + the caller's own bearer token). The privileged
   * service-role client is never passed here. `expectedUpdatedAt` is never
   * inspected, refreshed or retried by the runtime, and no Phase-window
   * extension is ever auto-approved.
   */
  readonly taskPlanWriter: McpV1PlanTaskExecutor;
  /**
   * API-Q Task Assign Step 4: the caller-bound MCP Task-assign business
   * mutation writer (anon key + the caller's own bearer token). The privileged
   * service-role client is never passed here. Assignment eligibility is decided
   * by the canonical mutation, and no concurrency token exists.
   */
  readonly taskAssignWriter: McpV1AssignTaskExecutor;
  /**
   * API-Q Task Transition Step 4: the caller-bound MCP Task-transition business
   * mutation writer (anon key + the caller's own bearer token). The privileged
   * service-role client is never passed here. Optimistic concurrency stays a
   * caller-supplied token, never read, refreshed or repaired by the runtime.
   */
  readonly taskTransitionWriter: McpV1TransitionTaskExecutor;
  /**
   * API-Q Project Create Step 4: the caller-bound MCP Project-create business
   * mutation writer (anon key + the caller's own bearer token). The privileged
   * service-role client is never passed here. Project Create has no target
   * Project, so no Project enablement is read, required or created.
   */
  readonly projectCreateWriter: McpV1CreateProjectExecutor;
  /**
   * API-Q Project Update Step 4: the caller-bound MCP Project-update business
   * mutation writer (anon key + the caller's own bearer token). The privileged
   * service-role client is never passed here. Project Connected-App
   * enablement, optimistic concurrency and narrative encryption remain owned
   * by the canonical database bridge.
   */
  readonly projectUpdateWriter: McpV1UpdateProjectExecutor;
  /**
   * API-Q Project Transition Step 4: the caller-bound MCP Project-transition
   * business mutation writer (anon key + the caller's own bearer token). The
   * privileged service-role client is never passed here. Project
   * Connected-App enablement, lifecycle/completion rules, optimistic
   * concurrency and narrative encryption remain owned by the canonical
   * database bridge.
   */
  readonly projectTransitionWriter: McpV1TransitionProjectExecutor;
  /**
   * API-Q Program Create Step 4: the caller-bound MCP Program-create business
   * mutation writer (anon key + the caller's own bearer token). The privileged
   * service-role client is never passed here. Program Create has no target
   * Program, so no Program-level Connected-App enablement exists or is read;
   * Organization/Workspace authority remains API-E/database-owned.
   */
  readonly programCreateWriter: McpV1CreateProgramExecutor;
  /**
   * API-Q Program Update Step 4: the caller-bound MCP Program-update business
   * mutation writer (anon key + the caller's own bearer token). The privileged
   * service-role client is never passed here. Organization/Workspace
   * Connected-App authorization, optimistic concurrency and narrative
   * encryption remain owned by API-E and the canonical database bridge.
   */
  readonly programUpdateWriter: McpV1UpdateProgramExecutor;
  /**
   * API-Q Portfolio-9D: the caller-bound MCP Portfolio-create business
   * mutation writer (anon key + the caller's own bearer token). The privileged
   * service-role client is never passed here. Portfolio Create has no target
   * Portfolio, so no Portfolio, Organization or owner lookup exists or is read;
   * Organization authority remains API-E/database-owned.
   */
  readonly portfolioCreateWriter: McpV1CreatePortfolioExecutor;
  /**
   * API-Q Portfolio-10D: the caller-bound MCP Portfolio-update business
   * mutation writer (anon key + the caller's own bearer token). The privileged
   * service-role client is never passed here. Organization authority,
   * containment, optimistic concurrency, encryption and persistence remain
   * owned by API-E and the Portfolio-10A database bridge.
   */
  readonly portfolioUpdateWriter: McpV1UpdatePortfolioExecutor;
  /**
   * API-Q Portfolio-11D: the caller-bound MCP Project↔Portfolio assignment
   * business mutation writer (anon key + the caller's own bearer token). The
   * privileged service-role client is never passed here. Project/Portfolio
   * authority, containment, eligibility, encryption, provenance and
   * persistence remain owned by API-E and the Portfolio-11A database bridge.
   */
  readonly portfolioAssignProjectWriter: McpV1AssignProjectPortfolioExecutor;
  /** Canonical database-controlled rate-limit profile resolver. */
  readonly rateLimitProfileResolver: ApiRateLimitProfileResolver;
  /** Canonical atomic rate-limit store (`consume_api_rate_limit_v1`). */
  readonly rateLimitStore: ApiRateLimitStore;
  /** Immutable clock source for rate-limit enforcement. */
  now(): number;
}

export interface BtpmMcpRuntimeInput {
  readonly resourceUri: unknown;
  readonly supabaseUrl: unknown;
  readonly tokenDependencies: TokenContextDependencies;
  readonly authorizationStore: ClientAuthorizationStore;
  readonly connectionVerificationRecorder?: McpConnectionVerificationRecorder;
  readonly organizationsReader: DelegatedApiV1OrganizationsReader;
  readonly workspacesReader: DelegatedApiV1WorkspacesReader;
  readonly workspaceMembersReader: DelegatedApiV1WorkspaceMembersReader;
  readonly meReader: DelegatedApiV1MeReader;
  readonly kpisReader: DelegatedApiV1ProjectKpisReader;
  readonly kpiReader: DelegatedApiV1KpiReader;
  readonly kpiUpdatesReader: DelegatedApiV1KpiUpdatesReader;

  readonly projectsReader: DelegatedApiV1ProjectsReader;
  readonly programsReader: DelegatedApiV1ProgramsReader;
  readonly programReader: DelegatedApiV1ProgramReader;
  readonly portfoliosReader: DelegatedApiV1PortfoliosReader;
  readonly portfolioReader: DelegatedApiV1PortfolioReader;
  readonly portfolioProjectsReader: DelegatedApiV1PortfolioProjectsReader;
  readonly projectDetailReader: DelegatedApiV1ProjectDetailReader;
  readonly projectPlanningReader: DelegatedApiV1ProjectPlanningReader;
  readonly projectRisksReader: DelegatedApiV1ProjectRisksReader;
  readonly riskReader: DelegatedApiV1RiskReader;
  readonly projectBlockersReader: DelegatedApiV1ProjectBlockersReader;
  readonly blockerReader: DelegatedApiV1BlockerReader;
  readonly executionUpdatesReader: DelegatedApiV1ExecutionUpdatesReader;
  readonly phaseReader: DelegatedApiV1PhaseReader;
  readonly taskReader: DelegatedApiV1TaskReader;
  readonly executionUpdateWriter: McpV1AppendExecutionUpdateExecutor;
  readonly riskCreateWriter: McpV1CreateRiskExecutor;
  readonly kpiCreateWriter: McpV1CreateKpiExecutor;
  readonly kpiUpdateWriter: McpV1UpdateKpiExecutor;
  readonly kpiUpdateAppendWriter: McpV1AppendKpiUpdateExecutor;
  readonly riskUpdateWriter: McpV1UpdateRiskExecutor;
  readonly blockerCreateWriter: McpV1CreateBlockerExecutor;
  readonly blockerUpdateWriter: McpV1UpdateBlockerExecutor;
  readonly phaseCreateWriter: McpV1CreatePhaseExecutor;
  readonly phaseUpdateWriter: McpV1UpdatePhaseExecutor;
  readonly phaseReorderWriter: McpV1ReorderPhasesExecutor;
  readonly phasePlanWriter: McpV1PlanPhaseExecutor;
  readonly taskCreateWriter: McpV1CreateTaskExecutor;
  readonly taskUpdateWriter: McpV1UpdateTaskExecutor;
  readonly taskReorderWriter: McpV1ReorderTasksExecutor;
  readonly taskPlanWriter: McpV1PlanTaskExecutor;
  readonly taskAssignWriter: McpV1AssignTaskExecutor;
  readonly taskTransitionWriter: McpV1TransitionTaskExecutor;
  readonly projectCreateWriter: McpV1CreateProjectExecutor;
  readonly projectUpdateWriter: McpV1UpdateProjectExecutor;
  readonly projectTransitionWriter: McpV1TransitionProjectExecutor;
  readonly programCreateWriter: McpV1CreateProgramExecutor;
  readonly programUpdateWriter: McpV1UpdateProgramExecutor;
  readonly portfolioCreateWriter: McpV1CreatePortfolioExecutor;
  readonly portfolioUpdateWriter: McpV1UpdatePortfolioExecutor;
  readonly portfolioAssignProjectWriter: McpV1AssignProjectPortfolioExecutor;
  readonly rateLimitProfileResolver: ApiRateLimitProfileResolver;
  readonly rateLimitStore: ApiRateLimitStore;
  now?(): number;
}

/** Fail-closed runtime construction. Both configuration values are required. */
export function createBtpmMcpRuntime(
  input: BtpmMcpRuntimeInput,
): BtpmMcpRuntime {
  const clock = input.now;
  return Object.freeze({
    resourceUri: normalizeMcpResourceUri(input.resourceUri),
    authorizationServer: deriveSupabaseAuthorizationServer(input.supabaseUrl),
    tokenDependencies: input.tokenDependencies,
    authorizationStore: input.authorizationStore,
    connectionVerificationRecorder: input.connectionVerificationRecorder,
    organizationsReader: input.organizationsReader,
    workspacesReader: input.workspacesReader,
    workspaceMembersReader: input.workspaceMembersReader,
    meReader: input.meReader,
    kpisReader: input.kpisReader,
    kpiReader: input.kpiReader,
    kpiUpdatesReader: input.kpiUpdatesReader,

    projectsReader: input.projectsReader,
    programsReader: input.programsReader,
    programReader: input.programReader,
    portfoliosReader: input.portfoliosReader,
    portfolioReader: input.portfolioReader,
    portfolioProjectsReader: input.portfolioProjectsReader,
    projectDetailReader: input.projectDetailReader,
    projectPlanningReader: input.projectPlanningReader,
    projectRisksReader: input.projectRisksReader,
    riskReader: input.riskReader,
    projectBlockersReader: input.projectBlockersReader,
    blockerReader: input.blockerReader,
    executionUpdatesReader: input.executionUpdatesReader,
    phaseReader: input.phaseReader,
    taskReader: input.taskReader,
    executionUpdateWriter: input.executionUpdateWriter,
    riskCreateWriter: input.riskCreateWriter,
    kpiCreateWriter: input.kpiCreateWriter,
    kpiUpdateWriter: input.kpiUpdateWriter,
    kpiUpdateAppendWriter: input.kpiUpdateAppendWriter,
    riskUpdateWriter: input.riskUpdateWriter,
    blockerCreateWriter: input.blockerCreateWriter,
    blockerUpdateWriter: input.blockerUpdateWriter,
    phaseCreateWriter: input.phaseCreateWriter,
    phaseUpdateWriter: input.phaseUpdateWriter,
    phaseReorderWriter: input.phaseReorderWriter,
    phasePlanWriter: input.phasePlanWriter,
    taskCreateWriter: input.taskCreateWriter,
    taskUpdateWriter: input.taskUpdateWriter,
    taskReorderWriter: input.taskReorderWriter,
    taskPlanWriter: input.taskPlanWriter,
    taskAssignWriter: input.taskAssignWriter,
    taskTransitionWriter: input.taskTransitionWriter,
    projectCreateWriter: input.projectCreateWriter,
    projectUpdateWriter: input.projectUpdateWriter,
    projectTransitionWriter: input.projectTransitionWriter,
    programCreateWriter: input.programCreateWriter,
    programUpdateWriter: input.programUpdateWriter,
    portfolioCreateWriter: input.portfolioCreateWriter,
    portfolioUpdateWriter: input.portfolioUpdateWriter,
    portfolioAssignProjectWriter: input.portfolioAssignProjectWriter,
    rateLimitProfileResolver: input.rateLimitProfileResolver,
    rateLimitStore: input.rateLimitStore,
    now: typeof clock === "function" ? () => clock() : () => Date.now(),
  });
}

/**
 * Builds a per-request MCP handler bound to one trusted execution context and
 * the bounded per-request tool executors. Nothing is cached between requests.
 */
function createRequestHandler(
  request: Request,
  runtime: BtpmMcpRuntime,
  authorized: McpAuthorizedContext,
  executionContext: McpTrustedExecutionContext,
) {
  const organizationsGet = createMcpOrganizationsToolExecutor({
    request,
    authorized,
    execution: executionContext,
    reader: runtime.organizationsReader,
    rateLimitProfileResolver: runtime.rateLimitProfileResolver,
    rateLimitStore: runtime.rateLimitStore,
    now: () => runtime.now(),
  });

  const workspacesGet = createMcpWorkspacesToolExecutor({
    request,
    authorized,
    execution: executionContext,
    reader: runtime.workspacesReader,
    rateLimitProfileResolver: runtime.rateLimitProfileResolver,
    rateLimitStore: runtime.rateLimitStore,
    now: () => runtime.now(),
  });

  // API-Q WML-1C — bounded Workspace-member lookup read executor.
  const workspaceMembersGet = createMcpWorkspaceMembersToolExecutor({
    request,
    authorized,
    execution: executionContext,
    reader: runtime.workspaceMembersReader,
    rateLimitProfileResolver: runtime.rateLimitProfileResolver,
    rateLimitStore: runtime.rateLimitStore,
    now: () => runtime.now(),
  });

  // ME-3 — bounded canonical caller-identity read executor.
  const meGet = createMcpMeToolExecutor({
    request,
    authorized,
    execution: executionContext,
    reader: runtime.meReader,
    rateLimitProfileResolver: runtime.rateLimitProfileResolver,
    rateLimitStore: runtime.rateLimitStore,
    now: () => runtime.now(),
  });

  // KPI-1C — bounded Project KPI collection read executor. It reads only
  // through the accepted KPI-1B caller-scoped delegated reader; the privileged
  // service-role client never performs this KPI business read.
  const kpisGet = createMcpProjectKpisToolExecutor({
    request,
    authorized,
    execution: executionContext,
    reader: runtime.kpisReader,
    rateLimitProfileResolver: runtime.rateLimitProfileResolver,
    rateLimitStore: runtime.rateLimitStore,
    now: () => runtime.now(),
  });


  // KPI-2C — bounded single-KPI detail read executor. It reads only through the
  // accepted KPI-2B caller-scoped delegated reader; the privileged service-role
  // client never performs this KPI business read.
  const kpiGetById = createMcpKpiDetailToolExecutor({
    request,
    authorized,
    execution: executionContext,
    reader: runtime.kpiReader,
    rateLimitProfileResolver: runtime.rateLimitProfileResolver,
    rateLimitStore: runtime.rateLimitStore,
    now: () => runtime.now(),
  });

  // KPI-3C — bounded KPI update-history read executor. It reads only through
  // the accepted KPI-3B caller-scoped delegated reader; the privileged
  // service-role client never performs this KPI business read.
  const kpiUpdatesGet = createMcpKpiUpdatesToolExecutor({
    request,
    authorized,
    execution: executionContext,
    reader: runtime.kpiUpdatesReader,
    rateLimitProfileResolver: runtime.rateLimitProfileResolver,
    rateLimitStore: runtime.rateLimitStore,
    now: () => runtime.now(),
  });

  const projectsGet = createMcpProjectsToolExecutor({
    request,
    authorized,
    execution: executionContext,
    reader: runtime.projectsReader,
    rateLimitProfileResolver: runtime.rateLimitProfileResolver,
    rateLimitStore: runtime.rateLimitStore,
    now: () => runtime.now(),
  });

  const programsGet = createMcpProgramsToolExecutor({
    request,
    authorized,
    execution: executionContext,
    reader: runtime.programsReader,
    rateLimitProfileResolver: runtime.rateLimitProfileResolver,
    rateLimitStore: runtime.rateLimitStore,
    now: () => runtime.now(),
  });

  const programGetById = createMcpProgramDetailToolExecutor({
    request,
    authorized,
    execution: executionContext,
    reader: runtime.programReader,
    rateLimitProfileResolver: runtime.rateLimitProfileResolver,
    rateLimitStore: runtime.rateLimitStore,
    now: () => runtime.now(),
  });

  const projectGetById = createMcpProjectDetailToolExecutor({
    request,
    authorized,
    execution: executionContext,
    reader: runtime.projectDetailReader,
    rateLimitProfileResolver: runtime.rateLimitProfileResolver,
    rateLimitStore: runtime.rateLimitStore,
    now: () => runtime.now(),
  });

  const projectPlanningGet = createMcpProjectPlanningToolExecutor({
    request,
    authorized,
    execution: executionContext,
    reader: runtime.projectPlanningReader,
    rateLimitProfileResolver: runtime.rateLimitProfileResolver,
    rateLimitStore: runtime.rateLimitStore,
    now: () => runtime.now(),
  });

  const risksGet = createMcpProjectRisksToolExecutor({
    request,
    authorized,
    execution: executionContext,
    reader: runtime.projectRisksReader,
    rateLimitProfileResolver: runtime.rateLimitProfileResolver,
    rateLimitStore: runtime.rateLimitStore,
    now: () => runtime.now(),
  });

  const riskGetById = createMcpRiskDetailToolExecutor({
    request,
    authorized,
    execution: executionContext,
    reader: runtime.riskReader,
    rateLimitProfileResolver: runtime.rateLimitProfileResolver,
    rateLimitStore: runtime.rateLimitStore,
    now: () => runtime.now(),
  });

  const blockersGet = createMcpProjectBlockersToolExecutor({
    request,
    authorized,
    execution: executionContext,
    reader: runtime.projectBlockersReader,
    rateLimitProfileResolver: runtime.rateLimitProfileResolver,
    rateLimitStore: runtime.rateLimitStore,
    now: () => runtime.now(),
  });

  const blockerGetById = createMcpBlockerDetailToolExecutor({
    request,
    authorized,
    execution: executionContext,
    reader: runtime.blockerReader,
    rateLimitProfileResolver: runtime.rateLimitProfileResolver,
    rateLimitStore: runtime.rateLimitStore,
    now: () => runtime.now(),
  });

  const executionUpdatesGet = createMcpExecutionUpdatesToolExecutor({
    request,
    authorized,
    execution: executionContext,
    reader: runtime.executionUpdatesReader,
    rateLimitProfileResolver: runtime.rateLimitProfileResolver,
    rateLimitStore: runtime.rateLimitStore,
    now: () => runtime.now(),
  });

  const phaseGetById = createMcpPhaseDetailToolExecutor({
    request,
    authorized,
    execution: executionContext,
    reader: runtime.phaseReader,
    rateLimitProfileResolver: runtime.rateLimitProfileResolver,
    rateLimitStore: runtime.rateLimitStore,
    now: () => runtime.now(),
  });

  const taskGetById = createMcpTaskDetailToolExecutor({
    request,
    authorized,
    execution: executionContext,
    reader: runtime.taskReader,
    rateLimitProfileResolver: runtime.rateLimitProfileResolver,
    rateLimitStore: runtime.rateLimitStore,
    now: () => runtime.now(),
  });

  // API-Q.9B2 — the single exposed MCP mutation. Confirmation, canonical
  // validation, idempotency, payload hashing, rate limiting and provenance are
  // owned by the API-Q.9B1 control layer; caller-bound RPC execution is owned
  // by the API-Q.9A5 writer. Nothing is reconstructed here.
  const executionUpdateAppend = createMcpExecutionUpdateAppendToolExecutor({
    request,
    execution: executionContext,
    writer: runtime.executionUpdateWriter,
    rateLimitProfileResolver: runtime.rateLimitProfileResolver,
    rateLimitStore: runtime.rateLimitStore,
    now: () => runtime.now(),
  });

  // API-Q.10A5 — the second exposed MCP mutation (`risks.create`).
  // Confirmation, canonical validation, idempotency, payload hashing, rate
  // limiting and provenance are owned by the API-Q.10A4 control layer;
  // caller-bound RPC execution is owned by the API-Q.10A3 writer. Nothing is
  // reconstructed here.
  // KPI-4C — bounded KPI-definition-create mutation executor. Confirmation,
  // canonical validation, idempotency, payload hashing, rate limiting and
  // provenance are owned by the KPI-4C control layer; caller-bound RPC
  // execution is owned by the KPI-4C writer. Nothing is reconstructed here.
  const kpiCreate = createMcpKpiCreateToolExecutor({
    request,
    execution: executionContext,
    writer: runtime.kpiCreateWriter,
    rateLimitProfileResolver: runtime.rateLimitProfileResolver,
    rateLimitStore: runtime.rateLimitStore,
    now: () => runtime.now(),
  });

  // KPI-5C — bounded KPI-definition-update mutation executor. Confirmation,
  // canonical KPI-ID/body validation, idempotency, payload hashing, rate
  // limiting and provenance are owned by the KPI-5C control layer; caller-bound
  // RPC execution is owned by the KPI-5C writer. Nothing is reconstructed here.
  const kpiUpdate = createMcpKpiUpdateToolExecutor({
    request,
    execution: executionContext,
    writer: runtime.kpiUpdateWriter,
    rateLimitProfileResolver: runtime.rateLimitProfileResolver,
    rateLimitStore: runtime.rateLimitStore,
    now: () => runtime.now(),
  });

  // KPI-6C — bounded KPI update-history append mutation executor. Confirmation,
  // canonical KPI-ID/body validation, idempotency, payload hashing, rate
  // limiting and provenance are owned by the KPI-6C control layer; caller-bound
  // RPC execution is owned by the KPI-6C writer. Nothing is reconstructed here.
  const kpiUpdateAppend = createMcpKpiUpdateAppendToolExecutor({
    request,
    execution: executionContext,
    writer: runtime.kpiUpdateAppendWriter,
    rateLimitProfileResolver: runtime.rateLimitProfileResolver,
    rateLimitStore: runtime.rateLimitStore,
    now: () => runtime.now(),
  });



  const riskCreate = createMcpRiskCreateToolExecutor({
    request,
    execution: executionContext,
    writer: runtime.riskCreateWriter,
    rateLimitProfileResolver: runtime.rateLimitProfileResolver,
    rateLimitStore: runtime.rateLimitStore,
    now: () => runtime.now(),
  });

  // API-Q.10B4 — the third exposed MCP mutation (`risks.update`).
  // Confirmation, canonical validation, the caller-supplied
  // `expectedUpdatedAt` concurrency token, idempotency, payload hashing, rate
  // limiting and provenance are owned by the API-Q.10B3 control layer;
  // caller-bound RPC execution is owned by the API-Q.10B2 writer. Nothing is
  // read, refreshed, reformatted, retried or reconstructed here.
  const riskUpdate = createMcpRiskUpdateToolExecutor({
    request,
    execution: executionContext,
    writer: runtime.riskUpdateWriter,
    rateLimitProfileResolver: runtime.rateLimitProfileResolver,
    rateLimitStore: runtime.rateLimitStore,
    now: () => runtime.now(),
  });

  // API-Q.10C4 — the fourth exposed MCP mutation (`blockers.create`).
  // Confirmation, canonical validation, idempotency, payload hashing, rate
  // limiting and provenance are owned by the API-Q.10C3 control layer;
  // caller-bound RPC execution is owned by the API-Q.10C2 writer. Nothing is
  // reconstructed here.
  const blockerCreate = createMcpBlockerCreateToolExecutor({
    request,
    execution: executionContext,
    writer: runtime.blockerCreateWriter,
    rateLimitProfileResolver: runtime.rateLimitProfileResolver,
    rateLimitStore: runtime.rateLimitStore,
    now: () => runtime.now(),
  });

  // API-Q.10D4 — the fifth exposed MCP mutation (`blockers.update`).
  // Confirmation, canonical validation, idempotency, payload hashing, rate
  // limiting, optimistic concurrency and provenance are owned by the
  // API-Q.10D3 control layer; caller-bound RPC execution is owned by the
  // API-Q.10D2 writer. The caller's `expectedUpdatedAt` is never read,
  // refreshed, reformatted, retried or reconstructed here.
  const blockerUpdate = createMcpBlockerUpdateToolExecutor({
    request,
    execution: executionContext,
    writer: runtime.blockerUpdateWriter,
    rateLimitProfileResolver: runtime.rateLimitProfileResolver,
    rateLimitStore: runtime.rateLimitStore,
    now: () => runtime.now(),
  });

  // API-Q Phase Create Step 4 — the sixth exposed MCP mutation
  // (`phases.create`). Confirmation, canonical validation, idempotency, payload
  // hashing, rate limiting, Project containment, Project planning-window
  // semantics and provenance are owned by the Phase Create Step 3 control
  // layer; caller-bound RPC execution is owned by the Phase Create Step 2
  // writer. Nothing is read, widened, retried or reconstructed here.
  const phaseCreate = createMcpPhaseCreateToolExecutor({
    request,
    execution: executionContext,
    writer: runtime.phaseCreateWriter,
    rateLimitProfileResolver: runtime.rateLimitProfileResolver,
    rateLimitStore: runtime.rateLimitStore,
    now: () => runtime.now(),
  });

  // API-Q Phase Update Step 4 — the seventh exposed MCP mutation
  // (`phases.update`). Confirmation, canonical validation, idempotency, payload
  // hashing, rate limiting, optimistic concurrency and provenance are owned by
  // the Phase Update Step 3 control layer; caller-bound RPC execution is owned
  // by the Phase Update Step 2 writer. The caller's `expectedUpdatedAt` is
  // never read, refreshed, reformatted, retried or reconstructed here.
  const phaseUpdate = createMcpPhaseUpdateToolExecutor({
    request,
    execution: executionContext,
    writer: runtime.phaseUpdateWriter,
    rateLimitProfileResolver: runtime.rateLimitProfileResolver,
    rateLimitStore: runtime.rateLimitStore,
    now: () => runtime.now(),
  });

  // API-Q Phase Reorder Step 4 — the eighth exposed MCP mutation
  // (`phases.reorder`). Confirmation, canonical validation, idempotency,
  // payload hashing, rate limiting, optimistic concurrency and provenance are
  // owned by the Phase Reorder Step 3 control layer; caller-bound RPC execution
  // is owned by the Phase Reorder Step 2 writer. No row is inspected or
  // reordered here, and no `expectedUpdatedAt` is read, refreshed or retried.
  const phaseReorder = createMcpPhaseReorderToolExecutor({
    request,
    execution: executionContext,
    writer: runtime.phaseReorderWriter,
    rateLimitProfileResolver: runtime.rateLimitProfileResolver,
    rateLimitStore: runtime.rateLimitStore,
    now: () => runtime.now(),
  });

  // API-Q Phase Plan Step 4 — the ninth exposed MCP mutation (`phases.plan`).
  // Ordinary confirmation, canonical validation, the Project-window extension
  // business flag, idempotency, payload hashing, rate limiting, optimistic
  // concurrency, stale mapping and provenance are owned by the Phase Plan
  // Step 3 control layer; caller-bound RPC execution is owned by the Phase Plan
  // Step 2 writer. No Phase or Project is read here, no date is inspected, no
  // `expectedUpdatedAt` is refreshed and nothing is retried.
  const phasePlan = createMcpPhasePlanToolExecutor({
    request,
    execution: executionContext,
    writer: runtime.phasePlanWriter,
    rateLimitProfileResolver: runtime.rateLimitProfileResolver,
    rateLimitStore: runtime.rateLimitStore,
    now: () => runtime.now(),
  });

  // API-Q Task Create Step 4 — the tenth exposed MCP mutation (`tasks.create`).
  // Confirmation, canonical validation, idempotency, payload hashing, rate
  // limiting, Phase containment, Phase planning-window semantics and provenance
  // are owned by the Task Create Step 3 control layer; caller-bound RPC
  // execution is owned by the Task Create Step 2 writer. No Task, Phase or
  // Project is read here, no Phase window is widened and nothing is retried.
  const taskCreate = createMcpTaskCreateToolExecutor({
    request,
    execution: executionContext,
    writer: runtime.taskCreateWriter,
    rateLimitProfileResolver: runtime.rateLimitProfileResolver,
    rateLimitStore: runtime.rateLimitStore,
    now: () => runtime.now(),
  });

  // API-Q Task Update Step 4 — the eleventh exposed MCP mutation
  // (`tasks.update`). Confirmation, canonical validation, idempotency, payload
  // hashing, rate limiting, optimistic concurrency, stale mapping and provenance
  // are owned by the Task Update Step 3 control layer; caller-bound RPC
  // execution is owned by the Task Update Step 2 writer. No Task is read here,
  // no `expectedUpdatedAt` is refreshed and nothing is retried.
  const taskUpdate = createMcpTaskUpdateToolExecutor({
    request,
    execution: executionContext,
    writer: runtime.taskUpdateWriter,
    rateLimitProfileResolver: runtime.rateLimitProfileResolver,
    rateLimitStore: runtime.rateLimitStore,
    now: () => runtime.now(),
  });

  // API-Q Task Reorder Step 4 — the twelfth exposed MCP mutation
  // (`tasks.reorder`). Confirmation, canonical validation, idempotency, payload
  // hashing, rate limiting, optimistic concurrency and provenance are owned by
  // the Task Reorder Step 3 control layer; caller-bound RPC execution is owned
  // by the Task Reorder Step 2 writer. No row is inspected or reordered here,
  // and no `expectedUpdatedAt` is read, refreshed or retried.
  const taskReorder = createMcpTaskReorderToolExecutor({
    request,
    execution: executionContext,
    writer: runtime.taskReorderWriter,
    rateLimitProfileResolver: runtime.rateLimitProfileResolver,
    rateLimitStore: runtime.rateLimitStore,
    now: () => runtime.now(),
  });

  // API-Q Task Plan Step 4 — the thirteenth exposed MCP mutation
  // (`tasks.plan`). Ordinary confirmation, canonical validation, the
  // Phase-window extension business flag, idempotency, payload hashing, rate
  // limiting, optimistic concurrency, stale mapping and provenance are owned by
  // the Task Plan Step 3 control layer; caller-bound RPC execution is owned by
  // the Task Plan Step 2 writer. No Task, Phase or Project is read here, no date
  // is inspected, no `expectedUpdatedAt` is refreshed and nothing is retried.
  const taskPlan = createMcpTaskPlanToolExecutor({
    request,
    execution: executionContext,
    writer: runtime.taskPlanWriter,
    rateLimitProfileResolver: runtime.rateLimitProfileResolver,
    rateLimitStore: runtime.rateLimitStore,
    now: () => runtime.now(),
  });

  // API-Q Task Assign Step 4 — the fourteenth exposed MCP mutation
  // (`tasks.assign`). Confirmation, canonical validation, idempotency, payload
  // hashing, rate limiting, assignment eligibility and provenance are owned by
  // the Task Assign Step 3 control layer; caller-bound RPC execution is owned by
  // the Task Assign Step 2 writer. No Task, user or membership is read here,
  // `assigneeId: null` is never rewritten and there is no concurrency token.
  const taskAssign = createMcpTaskAssignToolExecutor({
    request,
    execution: executionContext,
    writer: runtime.taskAssignWriter,
    rateLimitProfileResolver: runtime.rateLimitProfileResolver,
    rateLimitStore: runtime.rateLimitStore,
    now: () => runtime.now(),
  });

  // API-Q Task Transition Step 4 — the fifteenth exposed MCP mutation
  // (`tasks.transition`). Confirmation, canonical validation, idempotency,
  // payload hashing, rate limiting, optimistic concurrency and provenance are
  // owned by the Task Transition Step 3 control layer; caller-bound execution is
  // owned by the Task Transition Step 2 writer. No Task is read here, the
  // caller's concurrency token is never inspected, refreshed or repaired, no
  // stale mapping happens here and nothing is retried.
  const taskTransition = createMcpTaskTransitionToolExecutor({
    request,
    execution: executionContext,
    writer: runtime.taskTransitionWriter,
    rateLimitProfileResolver: runtime.rateLimitProfileResolver,
    rateLimitStore: runtime.rateLimitStore,
    now: () => runtime.now(),
  });

  // API-Q Project Create Step 4 — the exposed MCP mutation `projects.create`.
  // Confirmation, canonical validation, idempotency, payload hashing, rate
  // limiting and provenance are owned by the Project Create Step 3 control
  // layer; caller-bound RPC execution is owned by the Project Create Step 2
  // writer. No Project, Program or Workspace is read here, no Project
  // Connected-App enablement is queried or created, and nothing is retried.
  const projectCreate = createMcpProjectCreateToolExecutor({
    request,
    execution: executionContext,
    writer: runtime.projectCreateWriter,
    rateLimitProfileResolver: runtime.rateLimitProfileResolver,
    rateLimitStore: runtime.rateLimitStore,
    now: () => runtime.now(),
  });

  // API-Q Project Update Step 4 — the exposed MCP mutation `projects.update`.
  // Confirmation, canonical validation, presence derivation, idempotency,
  // payload hashing, rate limiting and provenance are owned by the Project
  // Update Step 3 control layer; caller-bound RPC execution is owned by the
  // Project Update Step 2 writer. No Project is read here, no Project
  // Connected-App enablement is queried or created, `expectedUpdatedAt` is
  // never inspected or refreshed, and nothing is retried.
  const projectUpdate = createMcpProjectUpdateToolExecutor({
    request,
    execution: executionContext,
    writer: runtime.projectUpdateWriter,
    rateLimitProfileResolver: runtime.rateLimitProfileResolver,
    rateLimitStore: runtime.rateLimitStore,
    now: () => runtime.now(),
  });

  // API-Q Project Transition Step 4 — the exposed MCP mutation
  // `projects.transition`. MCP mutation confirmation, canonical validation,
  // idempotency, payload hashing, rate limiting and provenance are owned by
  // the Project Transition Step 3 control layer; caller-bound RPC execution is
  // owned by the Project Transition Step 2 writer. No Project is read here, no
  // Project Connected-App enablement is queried or created, no lifecycle or
  // completion rule is evaluated, `expectedUpdatedAt` is never inspected or
  // refreshed, and nothing is retried.
  const projectTransition = createMcpProjectTransitionToolExecutor({
    request,
    execution: executionContext,
    writer: runtime.projectTransitionWriter,
    rateLimitProfileResolver: runtime.rateLimitProfileResolver,
    rateLimitStore: runtime.rateLimitStore,
    now: () => runtime.now(),
  });

  // API-Q Program Create Step 4 — the exposed MCP mutation `programs.create`.
  // Confirmation, canonical validation, idempotency, payload hashing, rate
  // limiting and provenance are owned by the Program Create Step 3 control
  // layer; caller-bound RPC execution is owned by the Program Create Step 2
  // writer. No Program, Workspace or Organization is read here, no
  // Program-level Connected-App enablement exists or is queried, and nothing
  // is retried.
  const programCreate = createMcpProgramCreateToolExecutor({
    request,
    execution: executionContext,
    writer: runtime.programCreateWriter,
    rateLimitProfileResolver: runtime.rateLimitProfileResolver,
    rateLimitStore: runtime.rateLimitStore,
    now: () => runtime.now(),
  });

  // API-Q Program Update Step 4 — one bounded per-request Program Update
  // control executor. Confirmation, canonical validation, idempotency, payload
  // hashing, rate limiting and provenance are owned by the Program Update
  // Step 3 control layer; caller-bound RPC execution is owned by the Program
  // Update Step 2 writer. No Program, Workspace or Organization is read here,
  // no Program-level Connected-App enablement exists or is queried, no
  // concurrency token is inspected, and nothing is retried.
  const programUpdate = createMcpProgramUpdateToolExecutor({
    request,
    execution: executionContext,
    writer: runtime.programUpdateWriter,
    rateLimitProfileResolver: runtime.rateLimitProfileResolver,
    rateLimitStore: runtime.rateLimitStore,
    now: () => runtime.now(),
  });

  // API-Q Portfolio-9D — one bounded per-request Portfolio Create control
  // executor. Confirmation, canonical validation, idempotency, payload hashing,
  // rate limiting and provenance are owned by the Portfolio-9C control layer;
  // caller-bound RPC execution is owned by the Portfolio-9B writer. No
  // Portfolio, Organization or owner is read here, no Tenant/Organization scope
  // or capability is injected, and nothing is retried.
  const portfolioCreate = createMcpPortfolioCreateToolExecutor({
    request,
    execution: executionContext,
    writer: runtime.portfolioCreateWriter,
    rateLimitProfileResolver: runtime.rateLimitProfileResolver,
    rateLimitStore: runtime.rateLimitStore,
    now: () => runtime.now(),
  });

  // API-Q Portfolio-10D — one bounded per-request Portfolio Update control
  // executor. Confirmation, canonical validation, presence derivation,
  // idempotency, payload hashing, rate limiting and provenance are owned by
  // the Portfolio-10C control layer; caller-bound RPC execution is owned by
  // the Portfolio-10B writer. No Portfolio, Organization or owner is read
  // here, no Tenant/Organization scope or capability is injected, no
  // concurrency token is inspected or refreshed, and nothing is retried.
  const portfolioUpdate = createMcpPortfolioUpdateToolExecutor({
    request,
    execution: executionContext,
    writer: runtime.portfolioUpdateWriter,
    rateLimitProfileResolver: runtime.rateLimitProfileResolver,
    rateLimitStore: runtime.rateLimitStore,
    now: () => runtime.now(),
  });

  // API-Q Portfolio-11D — one bounded per-request Project↔Portfolio assignment
  // control executor. Confirmation, canonical validation, idempotency, payload
  // hashing, rate limiting and provenance are owned by the Portfolio-11C
  // control layer; caller-bound RPC execution is owned by the Portfolio-11B
  // writer. No Project or Portfolio is read here, no Tenant/Organization/
  // Workspace scope, capability or Connected-App grant is injected, no
  // assignment state is inspected, `portfolioId: null` is never rewritten, no
  // concurrency token exists, and nothing is retried.
  const portfolioAssignProject = createMcpPortfolioAssignProjectToolExecutor({
    request,
    execution: executionContext,
    writer: runtime.portfolioAssignProjectWriter,
    rateLimitProfileResolver: runtime.rateLimitProfileResolver,
    rateLimitStore: runtime.rateLimitStore,
    now: () => runtime.now(),
  });

  // API-Q Portfolio-8 — bounded per-request Portfolio read executors.
  const portfoliosGet = createMcpPortfoliosToolExecutor({
    request,
    authorized,
    execution: executionContext,
    reader: runtime.portfoliosReader,
    rateLimitProfileResolver: runtime.rateLimitProfileResolver,
    rateLimitStore: runtime.rateLimitStore,
    now: () => runtime.now(),
  });

  const portfolioGetById = createMcpPortfolioDetailToolExecutor({
    request,
    authorized,
    execution: executionContext,
    reader: runtime.portfolioReader,
    rateLimitProfileResolver: runtime.rateLimitProfileResolver,
    rateLimitStore: runtime.rateLimitStore,
    now: () => runtime.now(),
  });

  const portfolioProjectsGet = createMcpPortfolioProjectsToolExecutor({
    request,
    authorized,
    execution: executionContext,
    reader: runtime.portfolioProjectsReader,
    rateLimitProfileResolver: runtime.rateLimitProfileResolver,
    rateLimitStore: runtime.rateLimitStore,
    now: () => runtime.now(),
  });







  return createMcpHandler(
    () =>
      createBtpmMcpServer(executionContext, {
        organizationsGet,
        workspacesGet,
        workspaceMembersGet,
        meGet,
        kpisGet,
        kpiGetById,
        kpiUpdatesGet,

        projectsGet,
        programsGet,
        programGetById,
        portfoliosGet,
        portfolioGetById,
        portfolioProjectsGet,
        projectGetById,
        projectPlanningGet,
        risksGet,
        riskGetById,
        blockersGet,
        blockerGetById,
        executionUpdatesGet,
        phaseGetById,
        taskGetById,
        executionUpdateAppend,
        riskCreate,
        kpiCreate,
        kpiUpdate,
        kpiUpdateAppend,
        riskUpdate,
        blockerCreate,
        blockerUpdate,
        phaseCreate,
        phaseUpdate,
        phaseReorder,
        phasePlan,
        taskCreate,
        taskUpdate,
        taskReorder,
        taskPlan,
        taskAssign,
        taskTransition,
        projectCreate,
        projectUpdate,
        projectTransition,
        programCreate,
        programUpdate,
        portfolioCreate,
        portfolioUpdate,
        portfolioAssignProject,
      }),
    {
      // Keep the SDK's default stateless serving for supported 2025-era clients.
      legacy: "stateless",
    },
  );
}

/**
 * Server-side observability hook. It is invoked with the trusted execution
 * context only after authentication and Connected App authorization succeed,
 * and can never be supplied or influenced by the MCP caller.
 */
export interface BtpmMcpRequestHooks {
  onExecutionContext?(context: McpTrustedExecutionContext): void;
}

function withRequestId(response: Response, requestId: string): Response {
  const headers = new Headers(response.headers);
  headers.set(BTPM_MCP_REQUEST_ID_HEADER, requestId);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Fail-closed Origin check. A request without an `Origin` header proceeds to
 * protocol handling; a present `Origin` must exactly equal the request URL
 * origin. No wildcard CORS, no allowlist in this step.
 */
function isOriginAllowed(request: Request): boolean {
  const origin: string | null = request.headers.get("origin");
  if (origin === null) return true;
  try {
    return origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

/**
 * UX-GAP.1A-C1 — the protected-resource metadata document is public,
 * non-secret OAuth discovery data. It is the ONLY response carrying a wildcard
 * `Access-Control-Allow-Origin`, and no credentials support is advertised.
 */
function metadataResponse(runtime: BtpmMcpRuntime): Response {
  const metadata = buildMcpProtectedResourceMetadata(
    runtime.resourceUri,
    runtime.authorizationServer,
  );
  return new Response(JSON.stringify(metadata), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}


/** Bounded 403 with NO OAuth challenge: the bearer token itself was valid. */
function connectedAppForbiddenResponse(): Response {
  return new Response(CONNECTED_APP_FORBIDDEN_BODY, {
    status: 403,
    headers: { "content-type": "application/json" },
  });
}

function unauthorizedResponse(runtime: BtpmMcpRuntime): Response {
  return new Response(AUTHENTICATION_REQUIRED_BODY, {
    status: 401,
    headers: {
      "content-type": "application/json",
      "WWW-Authenticate": buildMcpWwwAuthenticate(runtime.resourceUri),
    },
  });
}

/**
 * UX-GAP.2C — bounded 401 OAuth reauthentication challenge. Used ONLY for the
 * three recoverable application-policy acknowledgement states. The public body
 * is the existing generic authentication-required body; nothing discloses that
 * the underlying reason was policy acknowledgement.
 */
function reauthenticationRequiredResponse(runtime: BtpmMcpRuntime): Response {
  return new Response(AUTHENTICATION_REQUIRED_BODY, {
    status: 401,
    headers: {
      "content-type": "application/json",
      "WWW-Authenticate": buildMcpInvalidTokenWwwAuthenticate(
        runtime.resourceUri,
      ),
    },
  });
}


/** API-Q.CLAUDE-D1 — bounded diagnostic event name. */
export const BTPM_MCP_AUTHENTICATION_FAILED_EVENT =
  "btpm_mcp_authentication_failed";

/** API-Q.CLAUDE-D1 — bounded code used when the thrown value is not an
 * ApiAuthenticationError. */
export const BTPM_MCP_UNKNOWN_AUTHENTICATION_FAILURE_CODE =
  "unknown_authentication_failure";

export interface BtpmMcpAuthenticationFailureDiagnostic {
  readonly event: typeof BTPM_MCP_AUTHENTICATION_FAILED_EVENT;
  readonly request_id: string;
  readonly code: string;
}

export function buildMcpAuthenticationFailureDiagnostic(
  requestId: string,
  error: unknown,
): BtpmMcpAuthenticationFailureDiagnostic {
  return {
    event: BTPM_MCP_AUTHENTICATION_FAILED_EVENT,
    request_id: requestId,
    code: error instanceof ApiAuthenticationError
      ? error.code
      : BTPM_MCP_UNKNOWN_AUTHENTICATION_FAILURE_CODE,
  };
}

function logMcpAuthenticationFailure(requestId: string, error: unknown): void {
  console.warn(
    JSON.stringify(buildMcpAuthenticationFailureDiagnostic(requestId, error)),
  );
}

/**
 * Serves exactly one MCP HTTP request in this order:
 *   1. server request ID; 2. Origin; 3. method/path; 4. bearer authentication
 *   against the canonical MCP resource; 5. canonical Connected App
 *   authorization; 6. MCP SDK handler.
 *
 * An unauthenticated or unauthorized request never reaches MCP initialize,
 * tools/list, tools/call, or the MCP server factory. The public protected-resource
 * metadata GET route is the only authentication exception.
 */
export async function handleBtpmMcpRequest(
  request: Request,
  runtime: BtpmMcpRuntime,
  hooks: BtpmMcpRequestHooks = {},
): Promise<Response> {
  const requestId: string = crypto.randomUUID();

  // UX-GAP.1A-C1 — the exact public metadata GET path is served as public
  // cross-origin discovery metadata BEFORE the MCP protocol Origin check. Every
  // other request (including all POST protocol traffic) keeps the unchanged
  // exact-origin boundary below.
  if (request.method === "GET") {
    let pathname = "";
    try {
      pathname = new URL(request.url).pathname;
    } catch {
      pathname = "";
    }
    if (isMcpProtectedResourceMetadataPath(pathname)) {
      return withRequestId(metadataResponse(runtime), requestId);
    }
  }

  if (!isOriginAllowed(request)) {
    return withRequestId(
      new Response("Forbidden origin.", { status: 403 }),
      requestId,
    );
  }


  if (request.method !== "POST") {
    return withRequestId(
      new Response("Method not allowed.", {
        status: 405,
        headers: { Allow: "POST" },
      }),
      requestId,
    );
  }

  let authenticated: McpAuthenticationContext;
  try {
    authenticated = await authenticateMcpRequest(
      request,
      { expectedIssuer: runtime.authorizationServer, resourceUri: runtime.resourceUri },
      runtime.tokenDependencies,
      requestId,
    );
  } catch (error) {
    // API-Q.CLAUDE-D1 — bounded authentication-failure observability. Only the
    // request ID and the bounded authentication code are recorded; no token,
    // claim, identifier, message, cause or stack is ever logged. The public
    // response is byte-identical to the previous behavior.
    logMcpAuthenticationFailure(requestId, error);
    return withRequestId(unauthorizedResponse(runtime), requestId);
  }

  let authorized: McpAuthorizedContext;
  try {
    authorized = await authorizeMcpConnectedApp(
      authenticated,
      runtime.authorizationStore,
    );
  } catch (error) {
    // UX-GAP.2C — only the three recoverable application-policy
    // acknowledgement states, classified inside the bounded authorization
    // error, return an OAuth reauthentication challenge. Classification is
    // never derived from message strings or database rows here.
    if (
      error instanceof McpConnectedAppAuthorizationError &&
      error.reauthenticationRequired === true
    ) {
      return withRequestId(
        reauthenticationRequiredResponse(runtime),
        requestId,
      );
    }
    // Every other Connected App governance failure — including an unexpected
    // store fault — collapses to one bounded 403 with no OAuth challenge.
    return withRequestId(connectedAppForbiddenResponse(), requestId);
  }


  // API-Q.6 — trusted provenance boundary. Constructed from the authorized
  // context alone; a malformed internal context fails closed as 403 without
  // disclosing any reason.
  let executionContext: McpTrustedExecutionContext;
  try {
    executionContext = buildMcpExecutionContext(authorized);
  } catch {
    return withRequestId(connectedAppForbiddenResponse(), requestId);
  }
  hooks.onExecutionContext?.(executionContext);

  const response: Response = await createRequestHandler(
    request,
    runtime,
    authorized,
    executionContext,
  ).fetch(request);

  // UX-GAP.1B1 / UX-GAP.1B1-C1 — durable MCP connection-verification evidence.
  // Recorded exactly once, only after authentication, canonical Connected App
  // authorization, trusted execution-context construction AND a successful
  // official MCP protocol response (response.ok). Awaited once so Edge Function
  // shutdown cannot drop it, never retried, and its failure is contained: it can
  // never fail or alter an otherwise valid MCP response, and no recorder or
  // database detail is exposed or logged.
  if (response.ok) {
    try {
      await runtime.connectionVerificationRecorder?.record({
        apiClientId: executionContext.apiClientId,
        actorUserId: executionContext.executingUserId,
        requestId: executionContext.correlationId,
      });
    } catch {
      // Intentionally ignored.
    }
  }

  return withRequestId(response, requestId);
}


function buildRuntimeFromEnvironment(): BtpmMcpRuntime {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const resourceUri = Deno.env.get("BTPM_MCP_RESOURCE_URI");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (typeof supabaseAnonKey !== "string" || supabaseAnonKey.length === 0) {
    throw new Error("mcp_runtime_configuration_missing");
  }
  if (typeof serviceRoleKey !== "string" || serviceRoleKey.length === 0) {
    throw new Error("mcp_runtime_configuration_missing");
  }

  const authClient = createClient(String(supabaseUrl), supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  // Privileged client. Exactly two permitted infrastructure purposes:
  //   A. Connected App / policy-acknowledgement authorization lookup;
  //   B. canonical rate-limit profile catalogue + atomic consumption RPC.
  // It is never handed to the MCP server factory, any business executor, PMG,
  // or any business table/RPC read.
  const privilegedClient = createClient(String(supabaseUrl), serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const authorizationStore: ClientAuthorizationStore =
    createSupabaseClientAuthorizationStore(
      privilegedClient as unknown as SupabaseAuthorizationServerClient,
    );

  const rateLimitClient =
    privilegedClient as unknown as SupabaseRateLimitClient;

  // UX-GAP.1B1 — permitted infrastructure purpose C: safe MCP
  // connection-verification activity recording through the protected
  // service-role recorder RPC. No business read or write uses this client.
  const connectionVerificationRecorder: McpConnectionVerificationRecorder =
    createMcpConnectionVerificationRecorder(
      privilegedClient as unknown as McpConnectionVerificationClient,
    );

  // Caller-scoped Organizations read: anon key + the caller's own bearer token,
  // extracted inside the accepted delegated reader from the original request.
  const organizationsReader: DelegatedApiV1OrganizationsReader =
    createDelegatedApiV1OrganizationsReader(
      String(supabaseUrl),
      supabaseAnonKey,
      createClient as unknown as DelegatedOrganizationsClientFactory,
    );

  // Caller-scoped Workspaces read: anon key + the caller's own bearer token,
  // extracted inside the accepted delegated reader from the original request.
  const workspacesReader: DelegatedApiV1WorkspacesReader =
    createDelegatedApiV1WorkspacesReader(
      String(supabaseUrl),
      supabaseAnonKey,
      createClient as unknown as DelegatedWorkspacesClientFactory,
    );

  // API-Q WML-1C — caller-scoped Workspace-member read: anon key + the caller's
  // own bearer token, extracted inside the accepted WML-1B delegated reader
  // from the original request. The privileged client never performs this read.
  const workspaceMembersReader: DelegatedApiV1WorkspaceMembersReader =
    createDelegatedApiV1WorkspaceMembersReader(
      String(supabaseUrl),
      supabaseAnonKey,
      createClient as unknown as DelegatedWorkspaceMembersClientFactory,
    );

  // ME-3 — caller-scoped Me read: anon key + the caller's own bearer token,
  // extracted inside the accepted delegated reader from the original request.
  const meReader: DelegatedApiV1MeReader = createDelegatedApiV1MeReader(
    String(supabaseUrl),
    supabaseAnonKey,
    createClient as unknown as DelegatedMeClientFactory,
  );

  // KPI-1C — caller-scoped Project KPI read: anon key + the caller's own bearer
  // token, extracted inside the accepted KPI-1B delegated reader from the
  // original request. The privileged client never performs this read.
  const kpisReader: DelegatedApiV1ProjectKpisReader =
    createDelegatedApiV1ProjectKpisReader(
      String(supabaseUrl),
      supabaseAnonKey,
      createClient as unknown as DelegatedKpiReadClientFactory,
    );


  // KPI-2C — caller-scoped single-KPI detail read: anon key + the caller's own
  // bearer token, extracted inside the accepted KPI-2B delegated reader from
  // the original request. The privileged client never performs this read.
  const kpiReader: DelegatedApiV1KpiReader = createDelegatedApiV1KpiReader(
    String(supabaseUrl),
    supabaseAnonKey,
    createClient as unknown as DelegatedKpiReadClientFactory,
  );

  // KPI-3C — caller-scoped KPI update-history read: anon key + the caller's own
  // bearer token, extracted inside the accepted KPI-3B delegated reader from
  // the original request. The privileged client never performs this read.
  const kpiUpdatesReader: DelegatedApiV1KpiUpdatesReader =
    createDelegatedApiV1KpiUpdatesReader(
      String(supabaseUrl),
      supabaseAnonKey,
      createClient as unknown as DelegatedKpiReadClientFactory,
    );

  // Caller-scoped Projects read: anon key + the caller's own bearer token,
  // extracted inside the accepted delegated reader from the original request.
  const projectsReader: DelegatedApiV1ProjectsReader =
    createDelegatedApiV1ProjectsReader(
      String(supabaseUrl),
      supabaseAnonKey,
      createClient as unknown as DelegatedProjectsClientFactory,
    );

  // Caller-scoped Program / Project context reads: anon key + the caller's own
  // bearer token, extracted inside each accepted delegated reader.
  const programsReader: DelegatedApiV1ProgramsReader =
    createDelegatedApiV1ProgramsReader(
      String(supabaseUrl),
      supabaseAnonKey,
      createClient as unknown as DelegatedProgramClientFactory,
    );

  const programReader: DelegatedApiV1ProgramReader =
    createDelegatedApiV1ProgramReader(
      String(supabaseUrl),
      supabaseAnonKey,
      createClient as unknown as DelegatedProgramClientFactory,
    );

  // API-Q Portfolio-8 — caller-scoped Portfolio reads: anon key + the caller's
  // own bearer token, extracted inside each accepted delegated Portfolio reader.
  // No service-role client and no Portfolio mutation executor is constructed.
  const portfoliosReader: DelegatedApiV1PortfoliosReader =
    createDelegatedApiV1PortfoliosReader(
      String(supabaseUrl),
      supabaseAnonKey,
      createClient as unknown as DelegatedPortfolioClientFactory,
    );

  const portfolioReader: DelegatedApiV1PortfolioReader =
    createDelegatedApiV1PortfolioReader(
      String(supabaseUrl),
      supabaseAnonKey,
      createClient as unknown as DelegatedPortfolioClientFactory,
    );

  const portfolioProjectsReader: DelegatedApiV1PortfolioProjectsReader =
    createDelegatedApiV1PortfolioProjectsReader(
      String(supabaseUrl),
      supabaseAnonKey,
      createClient as unknown as DelegatedPortfolioClientFactory,
    );


  const projectDetailReader: DelegatedApiV1ProjectDetailReader =
    createDelegatedApiV1ProjectDetailReader(
      String(supabaseUrl),
      supabaseAnonKey,
      createClient as unknown as DelegatedProjectDetailClientFactory,
    );

  const projectPlanningReader: DelegatedApiV1ProjectPlanningReader =
    createDelegatedApiV1ProjectPlanningReader(
      String(supabaseUrl),
      supabaseAnonKey,
      createClient as unknown as DelegatedProjectPlanningClientFactory,
    );


  // Caller-scoped operational execution reads: anon key + the caller's own
  // bearer token, extracted inside each accepted delegated reader.
  const projectRisksReader: DelegatedApiV1ProjectRisksReader =
    createDelegatedApiV1ProjectRisksReader(
      String(supabaseUrl),
      supabaseAnonKey,
      createClient as unknown as DelegatedRiskReadClientFactory,
    );

  const riskReader: DelegatedApiV1RiskReader = createDelegatedApiV1RiskReader(
    String(supabaseUrl),
    supabaseAnonKey,
    createClient as unknown as DelegatedRiskReadClientFactory,
  );

  const projectBlockersReader: DelegatedApiV1ProjectBlockersReader =
    createDelegatedApiV1ProjectBlockersReader(
      String(supabaseUrl),
      supabaseAnonKey,
      createClient as unknown as DelegatedBlockerReadClientFactory,
    );

  const blockerReader: DelegatedApiV1BlockerReader =
    createDelegatedApiV1BlockerReader(
      String(supabaseUrl),
      supabaseAnonKey,
      createClient as unknown as DelegatedBlockerReadClientFactory,
    );

  const executionUpdatesReader: DelegatedApiV1ExecutionUpdatesReader =
    createDelegatedApiV1ExecutionUpdatesReader(
      String(supabaseUrl),
      supabaseAnonKey,
      createClient as unknown as DelegatedExecutionUpdateReadClientFactory,
    );

  const phaseReader: DelegatedApiV1PhaseReader = createDelegatedApiV1PhaseReader(
    String(supabaseUrl),
    supabaseAnonKey,
    createClient as unknown as DelegatedPhaseReadClientFactory,
  );

  const taskReader: DelegatedApiV1TaskReader = createDelegatedApiV1TaskReader(
    String(supabaseUrl),
    supabaseAnonKey,
    createClient as unknown as DelegatedTaskReadClientFactory,
  );

  // Caller-bound Execution Update mutation writer (API-Q.9B2 → API-Q.9A5):
  // anon key + the caller's own bearer token, extracted inside the accepted
  // adapter from the original authenticated request. The privileged
  // service-role client is deliberately NOT used and NOT passed here.
  const executionUpdateWriter: McpV1AppendExecutionUpdateExecutor =
    createMcpV1AppendExecutionUpdateExecutor(
      String(supabaseUrl),
      supabaseAnonKey,
      createClient as unknown as McpAppendExecutionUpdateClientFactory,
    );

  // Caller-bound Risk-create mutation writer (API-Q.10A5 → API-Q.10A3): anon
  // key + the caller's own bearer token, extracted inside the accepted adapter
  // from the original authenticated request. The privileged service-role
  // client is deliberately NOT used and NOT passed here.
  const riskCreateWriter: McpV1CreateRiskExecutor =
    createMcpV1CreateRiskExecutor(
      String(supabaseUrl),
      supabaseAnonKey,
      createClient as unknown as McpCreateRiskClientFactory,
    );

  // Caller-bound KPI-create mutation writer (KPI-4C): anon key + the caller's
  // own bearer token, extracted inside the accepted adapter from the original
  // authenticated request. The privileged service-role client is deliberately
  // NOT used and NOT passed here.
  const kpiCreateWriter: McpV1CreateKpiExecutor = createMcpV1CreateKpiExecutor(
    String(supabaseUrl),
    supabaseAnonKey,
    createClient as unknown as McpCreateKpiClientFactory,
  );

  // Caller-bound KPI-update mutation writer (KPI-5C): anon key + the caller's
  // own bearer token, extracted inside the accepted adapter from the original
  // authenticated request. The privileged service-role client is deliberately
  // NOT used and NOT passed here.
  const kpiUpdateWriter: McpV1UpdateKpiExecutor = createMcpV1UpdateKpiExecutor(
    String(supabaseUrl),
    supabaseAnonKey,
    createClient as unknown as McpUpdateKpiClientFactory,
  );

  // Caller-bound KPI update-history append mutation writer (KPI-6C): anon key +
  // the caller's own bearer token, extracted inside the accepted adapter from
  // the original authenticated request. The privileged service-role client is
  // deliberately NOT used and NOT passed here.
  const kpiUpdateAppendWriter: McpV1AppendKpiUpdateExecutor =
    createMcpV1AppendKpiUpdateExecutor(
      String(supabaseUrl),
      supabaseAnonKey,
      createClient as unknown as McpAppendKpiUpdateClientFactory,
    );

  // Caller-bound Risk-update mutation writer (API-Q.10B4 → API-Q.10B2): anon
  // key + the caller's own bearer token, extracted inside the accepted adapter
  // from the original authenticated request. The privileged service-role
  // client is deliberately NOT used and NOT passed here.
  const riskUpdateWriter: McpV1UpdateRiskExecutor =
    createMcpV1UpdateRiskExecutor(
      String(supabaseUrl),
      supabaseAnonKey,
      createClient as unknown as McpUpdateRiskClientFactory,
    );

  // Caller-bound Blocker-create mutation writer (API-Q.10C4 → API-Q.10C2):
  // anon key + the caller's own bearer token, extracted inside the accepted
  // adapter from the original authenticated request. The privileged
  // service-role client is deliberately NOT used and NOT passed here.
  const blockerCreateWriter: McpV1CreateBlockerExecutor =
    createMcpV1CreateBlockerExecutor(
      String(supabaseUrl),
      supabaseAnonKey,
      createClient as unknown as McpCreateBlockerClientFactory,
    );

  // Caller-bound Blocker-update mutation writer (API-Q.10D4 → API-Q.10D2):
  // anon key + the caller's own bearer token, extracted inside the accepted
  // adapter from the original authenticated request. The privileged
  // service-role client is deliberately NOT used and NOT passed here.
  const blockerUpdateWriter: McpV1UpdateBlockerExecutor =
    createMcpV1UpdateBlockerExecutor(
      String(supabaseUrl),
      supabaseAnonKey,
      createClient as unknown as McpUpdateBlockerClientFactory,
    );

  // Caller-bound Phase-create mutation writer (Phase Create Step 4 → Step 2):
  // anon key + the caller's own bearer token, extracted inside the accepted
  // adapter from the original authenticated request. The privileged
  // service-role client is deliberately NOT used and NOT passed here.
  const phaseCreateWriter: McpV1CreatePhaseExecutor =
    createMcpV1CreatePhaseExecutor(
      String(supabaseUrl),
      supabaseAnonKey,
      createClient as unknown as McpCreatePhaseClientFactory,
    );

  // Caller-bound Phase-update mutation writer (Phase Update Step 4 → Step 2):
  // anon key + the caller's own bearer token, extracted inside the accepted
  // adapter from the original authenticated request. The privileged
  // service-role client is deliberately NOT used and NOT passed here.
  const phaseUpdateWriter: McpV1UpdatePhaseExecutor =
    createMcpV1UpdatePhaseExecutor(
      String(supabaseUrl),
      supabaseAnonKey,
      createClient as unknown as McpUpdatePhaseClientFactory,
    );

  // Caller-bound Phase-reorder mutation writer (Phase Reorder Step 4 → Step 2):
  // anon key + the caller's own bearer token, extracted inside the accepted
  // adapter from the original authenticated request. The privileged
  // service-role client is deliberately NOT used and NOT passed here.
  const phaseReorderWriter: McpV1ReorderPhasesExecutor =
    createMcpV1ReorderPhasesExecutor(
      String(supabaseUrl),
      supabaseAnonKey,
      createClient as unknown as McpReorderPhasesClientFactory,
    );

  // Caller-bound Phase-planning mutation writer (Phase Plan Step 4 → Step 2):
  // anon key + the caller's own bearer token, extracted inside the accepted
  // adapter from the original authenticated request. The privileged
  // service-role client is deliberately NOT used and NOT passed here.
  const phasePlanWriter: McpV1PlanPhaseExecutor = createMcpV1PlanPhaseExecutor(
    String(supabaseUrl),
    supabaseAnonKey,
    createClient as unknown as McpPlanPhaseClientFactory,
  );

  // Caller-bound Task-create mutation writer (Task Create Step 4 → Step 2):
  // anon key + the caller's own bearer token, extracted inside the accepted
  // adapter from the original authenticated request. The privileged
  // service-role client is deliberately NOT used and NOT passed here.
  const taskCreateWriter: McpV1CreateTaskExecutor = createMcpV1CreateTaskExecutor(
    String(supabaseUrl),
    supabaseAnonKey,
    createClient as unknown as McpCreateTaskClientFactory,
  );

  // Caller-bound Task-update mutation writer (Task Update Step 4 → Step 2):
  // anon key + the caller's own bearer token, extracted inside the accepted
  // adapter from the original authenticated request. The privileged
  // service-role client is deliberately NOT used and NOT passed here.
  const taskUpdateWriter: McpV1UpdateTaskExecutor = createMcpV1UpdateTaskExecutor(
    String(supabaseUrl),
    supabaseAnonKey,
    createClient as unknown as McpUpdateTaskClientFactory,
  );

  // Caller-bound Task-reorder mutation writer (Task Reorder Step 4 → Step 2):
  // anon key + the caller's own bearer token, extracted inside the accepted
  // adapter from the original authenticated request. The privileged
  // service-role client is deliberately NOT used and NOT passed here.
  const taskReorderWriter: McpV1ReorderTasksExecutor =
    createMcpV1ReorderTasksExecutor(
      String(supabaseUrl),
      supabaseAnonKey,
      createClient as unknown as McpReorderTasksClientFactory,
    );

  // Caller-bound Task-planning mutation writer (Task Plan Step 4 → Step 2):
  // anon key + the caller's own bearer token, extracted inside the accepted
  // adapter from the original authenticated request. The privileged
  // service-role client is deliberately NOT used and NOT passed here.
  const taskPlanWriter: McpV1PlanTaskExecutor = createMcpV1PlanTaskExecutor(
    String(supabaseUrl),
    supabaseAnonKey,
    createClient as unknown as McpPlanTaskClientFactory,
  );

  // Caller-bound Task-assign mutation writer (Task Assign Step 4 → Step 2):
  // anon key + the caller's own bearer token, extracted inside the accepted
  // adapter from the original authenticated request. The privileged
  // service-role client is deliberately NOT used and NOT passed here.
  const taskAssignWriter: McpV1AssignTaskExecutor =
    createMcpV1AssignTaskExecutor(
      String(supabaseUrl),
      supabaseAnonKey,
      createClient as unknown as McpAssignTaskClientFactory,
    );

  // Caller-bound Task-transition mutation writer (Task Transition Step 4 →
  // Step 2): anon key + the caller's own bearer token, extracted inside the
  // accepted adapter from the original authenticated request. The privileged
  // service-role client is deliberately NOT used and NOT passed here.
  const taskTransitionWriter: McpV1TransitionTaskExecutor =
    createMcpV1TransitionTaskExecutor(
      String(supabaseUrl),
      supabaseAnonKey,
      createClient as unknown as McpTransitionTaskClientFactory,
    );

  // Caller-bound Project-create mutation writer (Project Create Step 4 →
  // Step 2): anon key + the caller's own bearer token, extracted inside the
  // accepted adapter from the original authenticated request. The privileged
  // service-role client is deliberately NOT used and NOT passed here.
  const projectCreateWriter: McpV1CreateProjectExecutor =
    createMcpV1CreateProjectExecutor(
      String(supabaseUrl),
      supabaseAnonKey,
      createClient as unknown as McpCreateProjectClientFactory,
    );

  // Caller-bound Project-update mutation writer (Project Update Step 4 →
  // Step 2): anon key + the caller's own bearer token, extracted inside the
  // accepted adapter from the original authenticated request. The privileged
  // service-role client is deliberately NOT used and NOT passed here.
  const projectUpdateWriter: McpV1UpdateProjectExecutor =
    createMcpV1UpdateProjectExecutor(
      String(supabaseUrl),
      supabaseAnonKey,
      createClient as unknown as McpUpdateProjectClientFactory,
    );

  // Caller-bound Project-transition mutation writer (Project Transition
  // Step 4 → Step 2): anon key + the caller's own bearer token, extracted
  // inside the accepted adapter from the original authenticated request. The
  // privileged service-role client is deliberately NOT used and NOT passed
  // here.
  const projectTransitionWriter: McpV1TransitionProjectExecutor =
    createMcpV1TransitionProjectExecutor(
      String(supabaseUrl),
      supabaseAnonKey,
      createClient as unknown as McpTransitionProjectClientFactory,
    );

  // Caller-bound Program-create mutation writer (Program Create Step 4 →
  // Step 2): anon key + the caller's own bearer token, extracted inside the
  // accepted adapter from the original authenticated request. The privileged
  // service-role client is deliberately NOT used and NOT passed here.
  const programCreateWriter: McpV1CreateProgramExecutor =
    createMcpV1CreateProgramExecutor(
      String(supabaseUrl),
      supabaseAnonKey,
      createClient as unknown as McpCreateProgramClientFactory,
    );

  // Caller-bound Program-update mutation writer (Program Update Step 4 →
  // Step 2): anon key + the caller's own bearer token, extracted inside the
  // accepted adapter from the original authenticated request. The privileged
  // service-role client is deliberately NOT used and NOT passed here.
  // Caller-bound Portfolio-create mutation writer (Portfolio-9D →
  // Portfolio-9B): anon key + the caller's own bearer token, extracted inside
  // the accepted Portfolio-9B executor from the original authenticated request.
  // The privileged service-role client is deliberately NOT used and NOT passed
  // here.
  const portfolioCreateWriter: McpV1CreatePortfolioExecutor =
    createMcpV1CreatePortfolioExecutor(
      String(supabaseUrl),
      supabaseAnonKey,
      createClient as unknown as McpCreatePortfolioClientFactory,
    );

  const programUpdateWriter: McpV1UpdateProgramExecutor =
    createMcpV1UpdateProgramExecutor(
      String(supabaseUrl),
      supabaseAnonKey,
      createClient as unknown as McpUpdateProgramClientFactory,
    );

  // Caller-bound Portfolio-update mutation writer (Portfolio-10D →
  // Portfolio-10B): anon key + the caller's own bearer token, extracted inside
  // the accepted Portfolio-10B executor from the original authenticated
  // request. The privileged service-role client is deliberately NOT used and
  // NOT passed here.
  const portfolioUpdateWriter: McpV1UpdatePortfolioExecutor =
    createMcpV1UpdatePortfolioExecutor(
      String(supabaseUrl),
      supabaseAnonKey,
      createClient as unknown as McpUpdatePortfolioClientFactory,
    );

  // Caller-bound Project↔Portfolio assignment mutation writer (Portfolio-11D →
  // Portfolio-11B): anon key + the caller's own bearer token, extracted inside
  // the accepted Portfolio-11B executor from the original authenticated
  // request. The privileged service-role client is deliberately NOT used and
  // NOT passed here.
  const portfolioAssignProjectWriter: McpV1AssignProjectPortfolioExecutor =
    createMcpV1AssignProjectPortfolioExecutor(
      String(supabaseUrl),
      supabaseAnonKey,
      createClient as unknown as McpAssignProjectPortfolioClientFactory,
    );





  return createBtpmMcpRuntime({
    resourceUri,
    authorizationStore,
    connectionVerificationRecorder,
    supabaseUrl,
    organizationsReader,
    workspacesReader,
    workspaceMembersReader,
    meReader,
    kpisReader,
    kpiReader,
    kpiUpdatesReader,

    projectsReader,
    programsReader,
    programReader,
    portfoliosReader,
    portfolioReader,
    portfolioProjectsReader,
    projectDetailReader,
    projectPlanningReader,
    projectRisksReader,
    riskReader,
    projectBlockersReader,
    blockerReader,
    executionUpdatesReader,
    phaseReader,
    taskReader,
    executionUpdateWriter,
    riskCreateWriter,
    kpiCreateWriter,
    kpiUpdateWriter,
    kpiUpdateAppendWriter,
    riskUpdateWriter,
    blockerCreateWriter,
    blockerUpdateWriter,
    phaseCreateWriter,
    phaseUpdateWriter,
    phaseReorderWriter,
    phasePlanWriter,
    taskCreateWriter,
    taskUpdateWriter,
    taskReorderWriter,
    taskPlanWriter,
    taskAssignWriter,
    taskTransitionWriter,
    projectCreateWriter,
    projectUpdateWriter,
    projectTransitionWriter,
    programCreateWriter,
    programUpdateWriter,
    portfolioCreateWriter,
    portfolioUpdateWriter,
    portfolioAssignProjectWriter,
    rateLimitProfileResolver: createSupabaseRateLimitProfileResolver(
      rateLimitClient,
    ),
    rateLimitStore: createSupabaseRateLimitStore(rateLimitClient),
    tokenDependencies: {
      tokenVerifier: createSupabaseTokenVerifier(authClient),
      currentUserResolver: createSupabaseCurrentUserResolver(authClient),
      clock: { nowSeconds: () => Math.floor(Date.now() / 1000) },
    },
  });
}

if (import.meta.main) {
  const runtime = buildRuntimeFromEnvironment();
  Deno.serve((request: Request) => handleBtpmMcpRequest(request, runtime));
}
