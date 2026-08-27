// BTPM MCP server factory (protocol composition only).
//
// This module builds the MCP server advertised over the Streamable HTTP shell.
// It contains NO BTPM PM-domain logic: no SQL, no Supabase client, no RPC, no
// service-role credential, no generic operation dispatcher, no direct table
// read, no pagination logic and no authorization rule.
//
// Tool exposure is driven exclusively by the declarative registry
// (`MCP_TOOL_REGISTRY`): the factory advertises exactly the entries the registry
// marks as exposed, and knows only that each exposed entry must have one
// explicit bounded per-request registration/executor path. There is no
// operationId → arbitrary executor map: each tool is wired only when its exact
// advertised tool name is encountered, and per MCP-HARDENING-C2 any exposed
// registry entry without such an explicit path fails closed at construction.
// No fixed read/mutation/exposure counts are maintained in this commentary; the
// registry is the sole exposure authority.


import { McpServer } from "npm:@modelcontextprotocol/server@2.0.0";

import {
  exposedMcpTools,
  type McpToolMetadata,
  type McpToolRegistry,
} from "./toolRegistry.ts";

import { registerBtpmProjectSelectorAppResource } from "./projectSelectorAppResource.ts";
import { registerBtpmProjectSelectorAppTool } from "./projectSelectorAppTool.ts";
import type { McpTrustedExecutionContext } from "./buildMcpExecutionContext.ts";
import {
  MCP_ORGANIZATIONS_TOOL_INPUT_SCHEMA,
  MCP_ORGANIZATIONS_TOOL_NAME,
  MCP_TOOL_ERROR_MESSAGES,
  type McpOrganizationsToolArguments,
  type McpOrganizationsToolExecutor,
} from "./organizationsReadTool.ts";
import {
  MCP_WORKSPACES_TOOL_ERROR_MESSAGES,
  MCP_WORKSPACES_TOOL_INPUT_SCHEMA,
  MCP_WORKSPACES_TOOL_NAME,
  type McpWorkspacesToolArguments,
  type McpWorkspacesToolExecutor,
} from "./workspacesReadTool.ts";
import {
  MCP_WORKSPACE_MEMBERS_TOOL_ERROR_MESSAGES,
  MCP_WORKSPACE_MEMBERS_TOOL_INPUT_SCHEMA,
  MCP_WORKSPACE_MEMBERS_TOOL_NAME,
  type McpWorkspaceMembersToolArguments,
  type McpWorkspaceMembersToolExecutor,
} from "./workspaceMembersReadTool.ts";
// ME-3 — canonical caller-identity read tool.
import {
  MCP_ME_TOOL_ERROR_MESSAGES,
  MCP_ME_TOOL_INPUT_SCHEMA,
  MCP_ME_TOOL_NAME,
  type McpMeToolArguments,
  type McpMeToolExecutor,
} from "./meReadTool.ts";
// KPI-1C — canonical Project KPI collection read tool.
import {
  MCP_PROJECT_KPIS_TOOL_ERROR_MESSAGES,
  MCP_PROJECT_KPIS_TOOL_INPUT_SCHEMA,
  MCP_PROJECT_KPIS_TOOL_NAME,
  type McpProjectKpisToolArguments,
  type McpProjectKpisToolExecutor,
  MCP_KPI_DETAIL_TOOL_ERROR_MESSAGES,
  MCP_KPI_DETAIL_TOOL_INPUT_SCHEMA,
  MCP_KPI_DETAIL_TOOL_NAME,
  type McpKpiDetailToolArguments,
  type McpKpiDetailToolExecutor,
  MCP_KPI_UPDATES_TOOL_ERROR_MESSAGES,
  MCP_KPI_UPDATES_TOOL_INPUT_SCHEMA,
  MCP_KPI_UPDATES_TOOL_NAME,
  type McpKpiUpdatesToolArguments,
  type McpKpiUpdatesToolExecutor,
} from "./kpiReadTool.ts";


import {
  MCP_PROJECTS_TOOL_ERROR_MESSAGES,
  MCP_PROJECTS_TOOL_INPUT_SCHEMA,
  MCP_PROJECTS_TOOL_NAME,
  type McpProjectsToolArguments,
  type McpProjectsToolExecutor,
} from "./projectsReadTool.ts";
import {
  MCP_PROGRAM_DETAIL_TOOL_INPUT_SCHEMA,
  MCP_PROGRAM_DETAIL_TOOL_NAME,
  MCP_PROGRAMS_TOOL_ERROR_MESSAGES,
  MCP_PROGRAMS_TOOL_INPUT_SCHEMA,
  MCP_PROGRAMS_TOOL_NAME,
  type McpProgramDetailToolArguments,
  type McpProgramDetailToolExecutor,
  type McpProgramsToolArguments,
  type McpProgramsToolExecutor,
} from "./programsReadTools.ts";
import {
  MCP_PORTFOLIO_DETAIL_TOOL_INPUT_SCHEMA,
  MCP_PORTFOLIO_DETAIL_TOOL_NAME,
  MCP_PORTFOLIO_PROJECTS_TOOL_INPUT_SCHEMA,
  MCP_PORTFOLIO_PROJECTS_TOOL_NAME,
  MCP_PORTFOLIO_TOOL_ERROR_MESSAGES,
  MCP_PORTFOLIOS_TOOL_INPUT_SCHEMA,
  MCP_PORTFOLIOS_TOOL_NAME,
  type McpPortfolioDetailToolArguments,
  type McpPortfolioDetailToolExecutor,
  type McpPortfolioProjectsToolArguments,
  type McpPortfolioProjectsToolExecutor,
  type McpPortfoliosToolArguments,
  type McpPortfoliosToolExecutor,
} from "./portfolioReadTools.ts";
import {
  MCP_PROJECT_CONTEXT_TOOL_ERROR_MESSAGES,
  MCP_PROJECT_DETAIL_TOOL_INPUT_SCHEMA,
  MCP_PROJECT_DETAIL_TOOL_NAME,
  MCP_PROJECT_PLANNING_TOOL_INPUT_SCHEMA,
  MCP_PROJECT_PLANNING_TOOL_NAME,
  type McpProjectDetailToolArguments,
  type McpProjectDetailToolExecutor,
  type McpProjectPlanningToolArguments,
  type McpProjectPlanningToolExecutor,
} from "./projectContextReadTools.ts";
import {
  MCP_BLOCKER_DETAIL_TOOL_INPUT_SCHEMA,
  MCP_BLOCKER_DETAIL_TOOL_NAME,
  MCP_BLOCKER_TOOL_ERROR_MESSAGES,
  MCP_PROJECT_BLOCKERS_TOOL_INPUT_SCHEMA,
  MCP_PROJECT_BLOCKERS_TOOL_NAME,
  MCP_PROJECT_RISKS_TOOL_INPUT_SCHEMA,
  MCP_PROJECT_RISKS_TOOL_NAME,
  MCP_RISK_DETAIL_TOOL_INPUT_SCHEMA,
  MCP_RISK_DETAIL_TOOL_NAME,
  MCP_RISK_TOOL_ERROR_MESSAGES,
  type McpBlockerDetailToolArguments,
  type McpBlockerDetailToolExecutor,
  type McpProjectBlockersToolArguments,
  type McpProjectBlockersToolExecutor,
  type McpProjectRisksToolArguments,
  type McpProjectRisksToolExecutor,
  type McpRiskDetailToolArguments,
  type McpRiskDetailToolExecutor,
} from "./operationalIssueReadTools.ts";
import {
  MCP_EXECUTION_UPDATE_TOOL_ERROR_MESSAGES,
  MCP_EXECUTION_UPDATES_TOOL_INPUT_SCHEMA,
  MCP_EXECUTION_UPDATES_TOOL_NAME,
  MCP_PHASE_DETAIL_TOOL_INPUT_SCHEMA,
  MCP_PHASE_DETAIL_TOOL_NAME,
  MCP_PHASE_TOOL_ERROR_MESSAGES,
  MCP_TASK_DETAIL_TOOL_INPUT_SCHEMA,
  MCP_TASK_DETAIL_TOOL_NAME,
  MCP_TASK_TOOL_ERROR_MESSAGES,
  type McpExecutionUpdatesToolArguments,
  type McpExecutionUpdatesToolExecutor,
  type McpPhaseDetailToolArguments,
  type McpPhaseDetailToolExecutor,
  type McpTaskDetailToolArguments,
  type McpTaskDetailToolExecutor,
} from "./executionContextReadTools.ts";
import {
  MCP_BLOCKER_CREATE_TOOL_ERROR_MESSAGES,
  MCP_BLOCKER_CREATE_TOOL_INPUT_SCHEMA,
  MCP_BLOCKER_CREATE_TOOL_NAME,
  type McpBlockerCreateToolArguments,
  type McpBlockerCreateToolExecutor,
} from "./blockerCreateMutationTool.ts";
import {
  MCP_BLOCKER_UPDATE_TOOL_ERROR_MESSAGES,
  MCP_BLOCKER_UPDATE_TOOL_INPUT_SCHEMA,
  MCP_BLOCKER_UPDATE_TOOL_NAME,
  type McpBlockerUpdateToolArguments,
  type McpBlockerUpdateToolExecutor,
} from "./blockerUpdateMutationTool.ts";
import {
  MCP_EXECUTION_UPDATE_APPEND_TOOL_ERROR_MESSAGES,
  MCP_EXECUTION_UPDATE_APPEND_TOOL_INPUT_SCHEMA,
  MCP_EXECUTION_UPDATE_APPEND_TOOL_NAME,
  type McpExecutionUpdateAppendToolArguments,
  type McpExecutionUpdateAppendToolExecutor,
} from "./executionUpdateMutationTool.ts";
import {
  MCP_KPI_CREATE_TOOL_ERROR_MESSAGES,
  MCP_KPI_CREATE_TOOL_INPUT_SCHEMA,
  MCP_KPI_CREATE_TOOL_NAME,
  type McpKpiCreateToolArguments,
  type McpKpiCreateToolExecutor,
} from "./kpiCreateMutationTool.ts";
import {
  MCP_KPI_UPDATE_TOOL_ERROR_MESSAGES,
  MCP_KPI_UPDATE_TOOL_INPUT_SCHEMA,
  MCP_KPI_UPDATE_TOOL_NAME,
  type McpKpiUpdateToolArguments,
  type McpKpiUpdateToolExecutor,
} from "./kpiUpdateMutationTool.ts";
import {
  MCP_KPI_UPDATE_APPEND_TOOL_ERROR_MESSAGES,
  MCP_KPI_UPDATE_APPEND_TOOL_INPUT_SCHEMA,
  MCP_KPI_UPDATE_APPEND_TOOL_NAME,
  type McpKpiUpdateAppendToolArguments,
  type McpKpiUpdateAppendToolExecutor,
} from "./kpiUpdateAppendMutationTool.ts";
import {
  MCP_RISK_CREATE_TOOL_ERROR_MESSAGES,
  MCP_RISK_CREATE_TOOL_INPUT_SCHEMA,
  MCP_RISK_CREATE_TOOL_NAME,
  type McpRiskCreateToolArguments,
  type McpRiskCreateToolExecutor,
} from "./riskCreateMutationTool.ts";
import {
  MCP_RISK_UPDATE_TOOL_ERROR_MESSAGES,
  MCP_RISK_UPDATE_TOOL_INPUT_SCHEMA,
  MCP_RISK_UPDATE_TOOL_NAME,
  type McpRiskUpdateToolArguments,
  type McpRiskUpdateToolExecutor,
} from "./riskUpdateMutationTool.ts";
import {
  MCP_PHASE_CREATE_TOOL_ERROR_MESSAGES,
  MCP_PHASE_CREATE_TOOL_INPUT_SCHEMA,
  MCP_PHASE_CREATE_TOOL_NAME,
  type McpPhaseCreateToolArguments,
  type McpPhaseCreateToolExecutor,
} from "./phaseCreateMutationTool.ts";
import {
  MCP_PHASE_UPDATE_TOOL_ERROR_MESSAGES,
  MCP_PHASE_UPDATE_TOOL_INPUT_SCHEMA,
  MCP_PHASE_UPDATE_TOOL_NAME,
  type McpPhaseUpdateToolArguments,
  type McpPhaseUpdateToolExecutor,
} from "./phaseUpdateMutationTool.ts";
import {
  MCP_PHASE_REORDER_TOOL_ERROR_MESSAGES,
  MCP_PHASE_REORDER_TOOL_INPUT_SCHEMA,
  MCP_PHASE_REORDER_TOOL_NAME,
  type McpPhaseReorderToolArguments,
  type McpPhaseReorderToolExecutor,
} from "./phaseReorderMutationTool.ts";
import {
  MCP_PHASE_PLAN_TOOL_ERROR_MESSAGES,
  MCP_PHASE_PLAN_TOOL_INPUT_SCHEMA,
  MCP_PHASE_PLAN_TOOL_NAME,
  type McpPhasePlanToolArguments,
  type McpPhasePlanToolExecutor,
} from "./phasePlanMutationTool.ts";
import {
  MCP_TASK_CREATE_TOOL_ERROR_MESSAGES,
  MCP_TASK_CREATE_TOOL_INPUT_SCHEMA,
  MCP_TASK_CREATE_TOOL_NAME,
  type McpTaskCreateToolArguments,
  type McpTaskCreateToolExecutor,
} from "./taskCreateMutationTool.ts";
import {
  MCP_TASK_UPDATE_TOOL_ERROR_MESSAGES,
  MCP_TASK_UPDATE_TOOL_INPUT_SCHEMA,
  MCP_TASK_UPDATE_TOOL_NAME,
  type McpTaskUpdateToolArguments,
  type McpTaskUpdateToolExecutor,
} from "./taskUpdateMutationTool.ts";
import {
  MCP_TASK_REORDER_TOOL_ERROR_MESSAGES,
  MCP_TASK_REORDER_TOOL_INPUT_SCHEMA,
  MCP_TASK_REORDER_TOOL_NAME,
  type McpTaskReorderToolArguments,
  type McpTaskReorderToolExecutor,
} from "./taskReorderMutationTool.ts";
import {
  MCP_TASK_PLAN_TOOL_ERROR_MESSAGES,
  MCP_TASK_PLAN_TOOL_INPUT_SCHEMA,
  MCP_TASK_PLAN_TOOL_NAME,
  type McpTaskPlanToolArguments,
  type McpTaskPlanToolExecutor,
} from "./taskPlanMutationTool.ts";
import {
  MCP_TASK_ASSIGN_TOOL_ERROR_MESSAGES,
  MCP_TASK_ASSIGN_TOOL_INPUT_SCHEMA,
  MCP_TASK_ASSIGN_TOOL_NAME,
  type McpTaskAssignToolArguments,
  type McpTaskAssignToolExecutor,
} from "./taskAssignMutationTool.ts";
import {
  MCP_TASK_TRANSITION_TOOL_ERROR_MESSAGES,
  MCP_TASK_TRANSITION_TOOL_INPUT_SCHEMA,
  MCP_TASK_TRANSITION_TOOL_NAME,
  type McpTaskTransitionToolArguments,
  type McpTaskTransitionToolExecutor,
} from "./taskTransitionMutationTool.ts";
import {
  MCP_PROJECT_CREATE_TOOL_ERROR_MESSAGES,
  MCP_PROJECT_CREATE_TOOL_INPUT_SCHEMA,
  MCP_PROJECT_CREATE_TOOL_NAME,
  type McpProjectCreateToolArguments,
  type McpProjectCreateToolExecutor,
} from "./projectCreateMutationTool.ts";
import {
  MCP_PROJECT_UPDATE_TOOL_ERROR_MESSAGES,
  MCP_PROJECT_UPDATE_TOOL_INPUT_SCHEMA,
  MCP_PROJECT_UPDATE_TOOL_NAME,
  type McpProjectUpdateToolArguments,
  type McpProjectUpdateToolExecutor,
} from "./projectUpdateMutationTool.ts";
import {
  MCP_PROJECT_TRANSITION_TOOL_ERROR_MESSAGES,
  MCP_PROJECT_TRANSITION_TOOL_INPUT_SCHEMA,
  MCP_PROJECT_TRANSITION_TOOL_NAME,
  type McpProjectTransitionToolArguments,
  type McpProjectTransitionToolExecutor,
} from "./projectTransitionMutationTool.ts";
import {
  MCP_PROGRAM_CREATE_TOOL_ERROR_MESSAGES,
  MCP_PROGRAM_CREATE_TOOL_INPUT_SCHEMA,
  MCP_PROGRAM_CREATE_TOOL_NAME,
  type McpProgramCreateToolArguments,
  type McpProgramCreateToolExecutor,
} from "./programCreateMutationTool.ts";
import {
  MCP_PROGRAM_UPDATE_TOOL_ERROR_MESSAGES,
  MCP_PROGRAM_UPDATE_TOOL_INPUT_SCHEMA,
  MCP_PROGRAM_UPDATE_TOOL_NAME,
  type McpProgramUpdateToolArguments,
  type McpProgramUpdateToolExecutor,
} from "./programUpdateMutationTool.ts";
import {
  MCP_PORTFOLIO_CREATE_TOOL_ERROR_MESSAGES,
  MCP_PORTFOLIO_CREATE_TOOL_INPUT_SCHEMA,
  MCP_PORTFOLIO_CREATE_TOOL_NAME,
  type McpPortfolioCreateToolArguments,
  type McpPortfolioCreateToolExecutor,
} from "./portfolioCreateMutationTool.ts";
import {
  MCP_PORTFOLIO_UPDATE_TOOL_ERROR_MESSAGES,
  MCP_PORTFOLIO_UPDATE_TOOL_INPUT_SCHEMA,
  MCP_PORTFOLIO_UPDATE_TOOL_NAME,
  type McpPortfolioUpdateToolArguments,
  type McpPortfolioUpdateToolExecutor,
} from "./portfolioUpdateMutationTool.ts";
import {
  MCP_PORTFOLIO_ASSIGN_PROJECT_TOOL_ERROR_MESSAGES,
  MCP_PORTFOLIO_ASSIGN_PROJECT_TOOL_INPUT_SCHEMA,
  MCP_PORTFOLIO_ASSIGN_PROJECT_TOOL_NAME,
  type McpPortfolioAssignProjectToolArguments,
  type McpPortfolioAssignProjectToolExecutor,
} from "./portfolioAssignmentMutationTool.ts";

/** Stable MCP server name advertised to clients. */
export const BTPM_MCP_SERVER_NAME = "btpm-mcp";

/** Explicit MCP shell version constant (independent of BTPM API v1 version). */
export const BTPM_MCP_SERVER_VERSION = "0.1.0";

/**
 * Only the `tools` capability is advertised. Resources, prompts, sampling,
 * elicitation and completions are deliberately not advertised.
 */
// API-Q.PS.1: the server advertises `tools` plus the smallest valid *static*
// resources capability. No `listChanged`, no `subscribe`, and no prompts,
// sampling, elicitation or completions capability is advertised.
export const BTPM_MCP_CAPABILITIES = Object.freeze({
  tools: {},
  resources: {},
});

/**
 * Presentation/execution hints for read tools. These are MCP hints only and
 * are NEVER used as authorization logic anywhere in BTPM.
 */
export const BTPM_MCP_READ_TOOL_ANNOTATIONS = Object.freeze({
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
});

/**
 * Presentation/execution hints applied to the exposed mutation tools. These are
 * MCP presentation hints only: they are NEVER used as authorization or
 * execution logic anywhere in BTPM.

 */
export const BTPM_MCP_MUTATION_TOOL_ANNOTATIONS = Object.freeze({
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
});

/**
 * The narrow, explicit per-request execution dependencies the factory accepts.
 * No Supabase client, no service-role key, no RPC capability and no generic
 * "execute operation" function may ever be added here.
 */
export interface BtpmMcpToolExecutors {
  readonly organizationsGet: McpOrganizationsToolExecutor;
  readonly workspacesGet: McpWorkspacesToolExecutor;
  /**
   * API-Q WML-1C: the bounded Workspace-member lookup read executor. It reads
   * only through the accepted WML-1B delegated reader; no Supabase client,
   * service-role credential, RPC or generic dispatcher may be added here.
   */
  readonly workspaceMembersGet: McpWorkspaceMembersToolExecutor;

  /**
   * ME-3: the bounded canonical caller-identity read executor. It reads only
   * through the accepted delegated `/v1/me` reader; no Supabase client,
   * service-role credential, RPC or generic dispatcher may be added here.
   */
  readonly meGet: McpMeToolExecutor;

  /**
   * KPI-1C: the bounded Project KPI collection read executor. It reads only
   * through the accepted KPI-1B caller-scoped delegated Project KPI reader; no
   * Supabase client, service-role credential, RPC or generic dispatcher may be
   * added here. This executor is read-only and performs no KPI mutation.
   */
  readonly kpisGet: McpProjectKpisToolExecutor;

  /**
   * KPI-2C: the bounded single-KPI detail read executor. It reads only through
   * the accepted KPI-2B caller-scoped delegated KPI detail reader; no Supabase
   * client, service-role credential, RPC or generic dispatcher may be added
   * here.
   */
  readonly kpiGetById: McpKpiDetailToolExecutor;

  /**
   * KPI-3C: the bounded KPI update-history read executor. It reads only through
   * the accepted KPI-3B caller-scoped delegated KPI update-history reader; no
   * Supabase client, service-role credential, RPC or generic dispatcher may be
   * added here.
   */
  readonly kpiUpdatesGet: McpKpiUpdatesToolExecutor;


  readonly projectsGet: McpProjectsToolExecutor;
  readonly programsGet: McpProgramsToolExecutor;
  readonly programGetById: McpProgramDetailToolExecutor;

  /**
   * API-Q Portfolio-8: the three bounded Portfolio read executors. Each reads
   * only through its accepted caller-scoped delegated Portfolio reader; no
   * Supabase client, service-role credential, RPC or generic dispatcher may be
   * added here. These executors are read-only and perform no Portfolio mutation.
   */
  readonly portfoliosGet: McpPortfoliosToolExecutor;
  readonly portfolioGetById: McpPortfolioDetailToolExecutor;
  readonly portfolioProjectsGet: McpPortfolioProjectsToolExecutor;

  readonly projectGetById: McpProjectDetailToolExecutor;
  readonly projectPlanningGet: McpProjectPlanningToolExecutor;
  readonly risksGet: McpProjectRisksToolExecutor;
  readonly riskGetById: McpRiskDetailToolExecutor;
  readonly blockersGet: McpProjectBlockersToolExecutor;
  readonly blockerGetById: McpBlockerDetailToolExecutor;
  readonly executionUpdatesGet: McpExecutionUpdatesToolExecutor;
  readonly phaseGetById: McpPhaseDetailToolExecutor;
  readonly taskGetById: McpTaskDetailToolExecutor;
  /**
   * API-Q.9B2: the first exposed mutation executor. It is the bounded
   * API-Q.9B1 control-layer executor; no Supabase client, service-role
   * credential, RPC or generic dispatcher may ever be added here.
   */
  readonly executionUpdateAppend: McpExecutionUpdateAppendToolExecutor;
  /**
   * API-Q.10A5: the second exposed mutation executor — the bounded API-Q.10A4
   * Risk-create control-layer executor. Same constraint: no Supabase client,
   * service-role credential, RPC or generic dispatcher, ever.
   */
  readonly riskCreate: McpRiskCreateToolExecutor;
  /**
   * KPI-4C: the bounded KPI-definition-create control-layer executor. Same
   * constraint: no Supabase client, service-role credential, RPC or generic
   * dispatcher, ever.
   */
  readonly kpiCreate: McpKpiCreateToolExecutor;
  /**
   * KPI-5C: the bounded KPI-definition-update control-layer executor. Same
   * constraint: no Supabase client, service-role credential, RPC or generic
   * dispatcher, ever.
   */
  readonly kpiUpdate: McpKpiUpdateToolExecutor;
  /**
   * KPI-6C: the bounded KPI update-history append control-layer executor. Same
   * constraint: no Supabase client, service-role credential, RPC or generic
   * dispatcher, ever.
   */
  readonly kpiUpdateAppend: McpKpiUpdateAppendToolExecutor;
  /**
   * API-Q.10B4: the third exposed mutation executor — the bounded API-Q.10B3
   * Risk-update control-layer executor. Same constraint: no Supabase client,
   * service-role credential, RPC or generic dispatcher, ever.
   */
  readonly riskUpdate: McpRiskUpdateToolExecutor;
  /**
   * API-Q.10C4: the fourth exposed mutation executor — the bounded API-Q.10C3
   * Blocker-create control-layer executor. Same constraint: no Supabase client,
   * service-role credential, RPC or generic dispatcher, ever.
   */
  readonly blockerCreate: McpBlockerCreateToolExecutor;
  /**
   * API-Q.10D4: the fifth exposed mutation executor — the bounded API-Q.10D3
   * Blocker-update control-layer executor. Same constraint: no Supabase client,
   * service-role credential, RPC or generic dispatcher, ever. Optimistic
   * concurrency (`expectedUpdatedAt`) stays owned by the control layer.
   */
  readonly blockerUpdate: McpBlockerUpdateToolExecutor;
  /**
   * API-Q Phase Create Step 4: the sixth exposed mutation executor — the
   * bounded Phase Create Step 3 control-layer executor. Same constraint: no
   * Supabase client, service-role credential, RPC or generic dispatcher, ever.
   */
  readonly phaseCreate: McpPhaseCreateToolExecutor;
  /**
   * API-Q Phase Update Step 4: the seventh exposed mutation executor — the
   * bounded Phase Update Step 3 control-layer executor. Same constraint: no
   * Supabase client, service-role credential, RPC or generic dispatcher, ever.
   * Optimistic concurrency (`expectedUpdatedAt`) stays owned by the control
   * layer and the canonical mutation.
   */
  readonly phaseUpdate: McpPhaseUpdateToolExecutor;
  /**
   * API-Q Phase Reorder Step 4: the eighth exposed mutation executor — the
   * bounded Phase Reorder Step 3 control-layer executor. Same constraint: no
   * Supabase client, service-role credential, RPC or generic dispatcher, ever.
   * Row order and every `expectedUpdatedAt` concurrency token stay owned by the
   * control layer and the canonical mutation.
   */
  readonly phaseReorder: McpPhaseReorderToolExecutor;
  /**
   * API-Q Phase Plan Step 4: the ninth exposed mutation executor — the bounded
   * Phase Plan Step 3 control-layer executor. Same constraint: no Supabase
   * client, service-role credential, RPC or generic dispatcher, ever. Ordinary
   * confirmation, the Project-window extension business flag, idempotency,
   * `expectedUpdatedAt` concurrency and Project-window impact details stay
   * owned by the control layer and the canonical mutation.
   */
  readonly phasePlan: McpPhasePlanToolExecutor;
  /**
   * API-Q Task Create Step 4: the tenth exposed mutation executor — the bounded
   * Task Create Step 3 control-layer executor. Same constraint: no Supabase
   * client, service-role credential, RPC or generic dispatcher, ever.
   * Confirmation, canonical validation, idempotency, payload hashing, rate
   * limiting, Phase containment and Phase planning-window semantics stay owned
   * by the control layer and the canonical mutation.
   */
  readonly taskCreate: McpTaskCreateToolExecutor;
  /**
   * API-Q Task Update Step 4: the eleventh exposed mutation executor — the
   * bounded Task Update Step 3 control-layer executor. Same constraint: no
   * Supabase client, service-role credential, RPC or generic dispatcher, ever.
   * Confirmation, canonical validation, idempotency, payload hashing, rate
   * limiting, optimistic concurrency and stale mapping stay owned by the
   * control layer and the canonical mutation.
   */
  readonly taskUpdate: McpTaskUpdateToolExecutor;
  /**
   * API-Q Task Reorder Step 4: the twelfth exposed mutation executor — the
   * bounded Task Reorder Step 3 control-layer executor. Same constraint: no
   * Supabase client, service-role credential, RPC or generic dispatcher, ever.
   * Row order and every `expectedUpdatedAt` concurrency token stay owned by the
   * control layer and the canonical mutation.
   */
  readonly taskReorder: McpTaskReorderToolExecutor;
  /**
   * API-Q Task Plan Step 4: the thirteenth exposed mutation executor — the
   * bounded Task Plan Step 3 control-layer executor. Same constraint: no
   * Supabase client, service-role credential, RPC or generic dispatcher, ever.
   * Ordinary confirmation, the Phase-window extension business flag,
   * idempotency, `expectedUpdatedAt` concurrency and Phase-window impact
   * details stay owned by the control layer and the canonical mutation.
   */
  readonly taskPlan: McpTaskPlanToolExecutor;
  /**
   * API-Q Task Assign Step 4: the fourteenth exposed mutation executor — the
   * bounded Task Assign Step 3 control-layer executor. Same constraint: no
   * Supabase client, service-role credential, RPC or generic dispatcher, ever.
   * Confirmation, canonical validation, idempotency, rate limiting, assignment
   * eligibility and provenance stay owned by the control layer and the
   * canonical mutation. Task assignment carries no concurrency token.
   */
  readonly taskAssign: McpTaskAssignToolExecutor;
  /**
   * API-Q Task Transition Step 4: the FIFTEENTH exposed mutation executor — the
   * bounded Task Transition Step 3 control-layer executor. Same constraint: no
   * Supabase client, service-role credential, RPC or generic dispatcher, ever.
   * Confirmation, canonical validation, idempotency, rate limiting, optimistic
   * concurrency and provenance stay owned by the control layer and the
   * canonical mutation.
   */
  readonly taskTransition: McpTaskTransitionToolExecutor;
  /**
   * API-Q Project Create Step 4: the bounded Project Create Step 3
   * control-layer executor. Same constraint: no Supabase client, service-role
   * credential, RPC or generic dispatcher, ever. Confirmation, canonical
   * validation, idempotency, payload hashing and rate limiting stay owned by
   * the control layer; Workspace/capability authority stays owned by the
   * canonical mutation. Project Create has no target Project, so no Project
   * Connected-App enablement is read, required or created here.
   */
  readonly projectCreate: McpProjectCreateToolExecutor;
  /**
   * API-Q Project Update Step 4: the bounded Project Update Step 3
   * control-layer executor. No Supabase client, service-role credential, RPC
   * or generic dispatcher is ever accepted here. Confirmation, canonical
   * validation, presence (`set*`) derivation, idempotency, payload hashing and
   * rate limiting stay owned by the Step 3 control layer; Project
   * Connected-App enablement, optimistic concurrency and narrative encryption
   * stay owned by the canonical database bridge.
   */
  readonly projectUpdate: McpProjectUpdateToolExecutor;
  /**
   * API-Q Project Transition Step 4: the bounded Project Transition Step 3
   * control-layer executor. No Supabase client, service-role credential, RPC
   * or generic dispatcher is ever accepted here. Confirmation, canonical
   * validation, idempotency, payload hashing and rate limiting stay owned by
   * the Step 3 control layer; Project Connected-App enablement, lifecycle and
   * completion rules, optimistic concurrency and narrative encryption stay
   * owned by the canonical database bridge.
   */
  readonly projectTransition: McpProjectTransitionToolExecutor;
  /**
   * API-Q Program Create Step 4: the bounded Program Create Step 3
   * control-layer executor. No Supabase client, service-role credential, RPC
   * or generic dispatcher is ever accepted here. Confirmation, canonical
   * validation, idempotency, payload hashing and rate limiting stay owned by
   * the Step 3 control layer; Organization/Workspace authority stays owned by
   * API-E and the canonical database bridge. Program Create has no target
   * Program, so no Program-level Connected-App enablement exists, is read,
   * required or created here.
   */
  readonly programCreate: McpProgramCreateToolExecutor;
  /**
   * API-Q Program Update Step 4: the bounded Program Update Step 3
   * control-layer executor. No Supabase client, service-role credential, RPC
   * or generic dispatcher is ever accepted here. Confirmation, canonical
   * validation, presence derivation, idempotency, payload hashing and rate
   * limiting stay owned by the Step 3 control layer; Organization/Workspace
   * authority, optimistic concurrency and narrative encryption stay owned by
   * API-E and the canonical database bridge.
   */
  readonly programUpdate: McpProgramUpdateToolExecutor;
  /**
   * API-Q Portfolio-9D: the bounded Portfolio-9C control-layer executor. No
   * Supabase client, service-role credential, RPC or generic dispatcher is
   * ever accepted here. Confirmation, canonical validation, idempotency,
   * payload hashing and rate limiting stay owned by the Portfolio-9C control
   * layer; Organization authority, containment, encryption, provenance and
   * persistence stay owned by API-E and the Portfolio-9A database bridge.
   * Portfolio Create has no target Portfolio, so no Portfolio, Organization or
   * owner lookup exists, is read, required or created here.
   */
  readonly portfolioCreate: McpPortfolioCreateToolExecutor;
  /**
   * API-Q Portfolio-10D: the bounded Portfolio-10C control-layer executor. No
   * Supabase client, service-role credential, RPC or generic dispatcher is
   * ever accepted here. Confirmation, canonical validation, presence
   * derivation, idempotency, payload hashing and rate limiting stay owned by
   * the Portfolio-10C control layer; Organization authority, containment,
   * optimistic concurrency, encryption, provenance and persistence stay owned
   * by API-E and the Portfolio-10A database bridge.
   */
  readonly portfolioUpdate: McpPortfolioUpdateToolExecutor;
  /**
   * API-Q Portfolio-11D: the bounded Portfolio-11C control-layer executor. No
   * Supabase client, service-role credential, RPC or generic dispatcher is
   * ever accepted here. Confirmation, canonical validation, idempotency,
   * payload hashing and rate limiting stay owned by the Portfolio-11C control
   * layer; Project/Portfolio authority, containment, eligibility, encryption,
   * provenance and persistence stay owned by API-E and the Portfolio-11A
   * trusted database bridge. `portfolioId: null` (clear) semantics are owned
   * entirely downstream and never inspected or rewritten here.
   */
  readonly portfolioAssignProject: McpPortfolioAssignProjectToolExecutor;
}

/**
 * MCP-HARDENING-C2 — exposed → executable runtime parity.
 *
 * The canonical registry is the exposure-decision authority; the explicit
 * registration branches below are the execution-wiring authority. When those
 * two realities diverge — a registry entry marked `exposed` with no explicit
 * bounded executor branch — server construction fails closed instead of
 * advertising a discoverable placeholder tool (the removed no-op placeholder
 * fallback) and instead of silently omitting the entry.
 *
 * The thrown error is a deterministic internal configuration error. It names
 * only the offending advertised tool name and operation id and never performs
 * BTPM work, touches a Supabase client, dispatches by operation id, or
 * discloses secrets, bearer tokens or tenant/user data.
 */
export class McpExposedToolWithoutExecutionPathError extends Error {
  readonly toolName: string;
  readonly operationId: string;

  constructor(tool: McpToolMetadata) {
    super(
      `MCP server configuration error: exposed tool "${tool.toolName}" (operation "${tool.operationId}") has no explicit executable registration path.`,
    );
    this.name = "McpExposedToolWithoutExecutionPathError";
    this.toolName = tool.toolName;
    this.operationId = tool.operationId as string;
  }
}


function boundedToolError(message: string) {
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: message }],
  };
}

/**
 * Creates a fresh MCP server instance for exactly one authorized MCP request.
 *
 * API-Q.6: the trusted, server-derived execution context is injected here and
 * kept in per-request closure scope. Each exposed tool receives its explicit
 * bounded per-request executor through this per-request server instance the same
 * way. No mutable global, singleton or cross-request cache exists.
 */
export function createBtpmMcpServer(
  executionContext: McpTrustedExecutionContext,
  executors: BtpmMcpToolExecutors,
  // MCP-HARDENING-C2: test-injectable exposure authority. Production callers
  // omit it, so the canonical `MCP_TOOL_REGISTRY` stays the only real authority.
  registry?: McpToolRegistry,
): McpServer {
  // Held in per-request closure scope only; never stored module-wide.
  void executionContext;

  const server = new McpServer(
    { name: BTPM_MCP_SERVER_NAME, version: BTPM_MCP_SERVER_VERSION },
    { capabilities: BTPM_MCP_CAPABILITIES },
  );

  for (const tool of exposedMcpTools(registry)) {

    if (tool.toolName === MCP_ORGANIZATIONS_TOOL_NAME) {
      server.registerTool(
        tool.toolName,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: MCP_ORGANIZATIONS_TOOL_INPUT_SCHEMA,
          annotations: { title: tool.title, ...BTPM_MCP_READ_TOOL_ANNOTATIONS },
        },
        async (args: McpOrganizationsToolArguments) => {
          const result = await executors.organizationsGet(args);
          if (!result.ok) {
            return boundedToolError(MCP_TOOL_ERROR_MESSAGES[result.category]);
          }
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(result.payload) },
            ],
            structuredContent: result.payload,
          };
        },
      );
      continue;
    }

    if (tool.toolName === MCP_WORKSPACES_TOOL_NAME) {
      server.registerTool(
        tool.toolName,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: MCP_WORKSPACES_TOOL_INPUT_SCHEMA,
          annotations: { title: tool.title, ...BTPM_MCP_READ_TOOL_ANNOTATIONS },
        },
        async (args: McpWorkspacesToolArguments) => {
          const result = await executors.workspacesGet(args);
          if (!result.ok) {
            return boundedToolError(
              MCP_WORKSPACES_TOOL_ERROR_MESSAGES[result.category],
            );
          }
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(result.payload) },
            ],
            structuredContent: result.payload,
          };
        },
      );
      continue;
    }

    // API-Q WML-1C — explicit Workspace-member lookup read branch.
    if (tool.toolName === MCP_WORKSPACE_MEMBERS_TOOL_NAME) {
      server.registerTool(
        tool.toolName,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: MCP_WORKSPACE_MEMBERS_TOOL_INPUT_SCHEMA,
          annotations: { title: tool.title, ...BTPM_MCP_READ_TOOL_ANNOTATIONS },
        },
        async (args: McpWorkspaceMembersToolArguments) => {
          const result = await executors.workspaceMembersGet(args);
          if (!result.ok) {
            return boundedToolError(
              MCP_WORKSPACE_MEMBERS_TOOL_ERROR_MESSAGES[result.category],
            );
          }
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(result.payload) },
            ],
            structuredContent: result.payload,
          };
        },
      );
      continue;
    }

    // ME-3 — explicit canonical caller-identity read branch.
    if (tool.toolName === MCP_ME_TOOL_NAME) {
      server.registerTool(
        tool.toolName,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: MCP_ME_TOOL_INPUT_SCHEMA,
          annotations: { title: tool.title, ...BTPM_MCP_READ_TOOL_ANNOTATIONS },
        },
        async (args: McpMeToolArguments) => {
          const result = await executors.meGet(args);
          if (!result.ok) {
            return boundedToolError(
              MCP_ME_TOOL_ERROR_MESSAGES[result.category],
            );
          }
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(result.payload) },
            ],
            structuredContent: result.payload,
          };
        },
      );
      continue;
    }

    // KPI-3C — explicit canonical KPI update-history read branch.
    if (tool.toolName === MCP_KPI_UPDATES_TOOL_NAME) {
      server.registerTool(
        tool.toolName,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: MCP_KPI_UPDATES_TOOL_INPUT_SCHEMA,
          annotations: { title: tool.title, ...BTPM_MCP_READ_TOOL_ANNOTATIONS },
        },
        async (args: McpKpiUpdatesToolArguments) => {
          const result = await executors.kpiUpdatesGet(args);
          if (!result.ok) {
            return boundedToolError(
              MCP_KPI_UPDATES_TOOL_ERROR_MESSAGES[result.category],
            );
          }
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(result.payload) },
            ],
            structuredContent: result.payload,
          };
        },
      );
      continue;
    }

    // KPI-2C — explicit canonical single-KPI detail read branch.
    if (tool.toolName === MCP_KPI_DETAIL_TOOL_NAME) {
      server.registerTool(
        tool.toolName,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: MCP_KPI_DETAIL_TOOL_INPUT_SCHEMA,
          annotations: { title: tool.title, ...BTPM_MCP_READ_TOOL_ANNOTATIONS },
        },
        async (args: McpKpiDetailToolArguments) => {
          const result = await executors.kpiGetById(args);
          if (!result.ok) {
            return boundedToolError(
              MCP_KPI_DETAIL_TOOL_ERROR_MESSAGES[result.category],
            );
          }
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(result.payload) },
            ],
            structuredContent: result.payload,
          };
        },
      );
      continue;
    }

    // KPI-1C — explicit canonical Project KPI collection read branch.
    if (tool.toolName === MCP_PROJECT_KPIS_TOOL_NAME) {
      server.registerTool(
        tool.toolName,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: MCP_PROJECT_KPIS_TOOL_INPUT_SCHEMA,
          annotations: { title: tool.title, ...BTPM_MCP_READ_TOOL_ANNOTATIONS },
        },
        async (args: McpProjectKpisToolArguments) => {
          const result = await executors.kpisGet(args);
          if (!result.ok) {
            return boundedToolError(
              MCP_PROJECT_KPIS_TOOL_ERROR_MESSAGES[result.category],
            );
          }
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(result.payload) },
            ],
            structuredContent: result.payload,
          };
        },
      );
      continue;
    }





    if (tool.toolName === MCP_PROJECTS_TOOL_NAME) {
      server.registerTool(
        tool.toolName,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: MCP_PROJECTS_TOOL_INPUT_SCHEMA,
          annotations: { title: tool.title, ...BTPM_MCP_READ_TOOL_ANNOTATIONS },
        },
        async (args: McpProjectsToolArguments) => {
          const result = await executors.projectsGet(args);
          if (!result.ok) {
            return boundedToolError(
              MCP_PROJECTS_TOOL_ERROR_MESSAGES[result.category],
            );
          }
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(result.payload) },
            ],
            structuredContent: result.payload,
          };
        },
      );
      continue;
    }

    if (tool.toolName === MCP_PROGRAMS_TOOL_NAME) {
      server.registerTool(
        tool.toolName,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: MCP_PROGRAMS_TOOL_INPUT_SCHEMA,
          annotations: { title: tool.title, ...BTPM_MCP_READ_TOOL_ANNOTATIONS },
        },
        async (args: McpProgramsToolArguments) => {
          const result = await executors.programsGet(args);
          if (!result.ok) {
            return boundedToolError(
              MCP_PROGRAMS_TOOL_ERROR_MESSAGES[result.category],
            );
          }
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(result.payload) },
            ],
            structuredContent: result.payload,
          };
        },
      );
      continue;
    }

    if (tool.toolName === MCP_PROGRAM_DETAIL_TOOL_NAME) {
      server.registerTool(
        tool.toolName,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: MCP_PROGRAM_DETAIL_TOOL_INPUT_SCHEMA,
          annotations: { title: tool.title, ...BTPM_MCP_READ_TOOL_ANNOTATIONS },
        },
        async (args: McpProgramDetailToolArguments) => {
          const result = await executors.programGetById(args);
          if (!result.ok) {
            return boundedToolError(
              MCP_PROGRAMS_TOOL_ERROR_MESSAGES[result.category],
            );
          }
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(result.payload) },
            ],
            structuredContent: result.payload,
          };
        },
      );
      continue;
    }

    // -------------------------------------------------------------------------
    // API-Q Portfolio-8 — the three canonical Portfolio reads. Each branch is an
    // explicit per-tool registration bound to its own bounded executor; the
    // three Portfolio mutations remain unregistered and uncallable.
    // -------------------------------------------------------------------------
    if (tool.toolName === MCP_PORTFOLIOS_TOOL_NAME) {
      server.registerTool(
        tool.toolName,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: MCP_PORTFOLIOS_TOOL_INPUT_SCHEMA,
          annotations: { title: tool.title, ...BTPM_MCP_READ_TOOL_ANNOTATIONS },
        },
        async (args: McpPortfoliosToolArguments) => {
          const result = await executors.portfoliosGet(args);
          if (!result.ok) {
            return boundedToolError(
              MCP_PORTFOLIO_TOOL_ERROR_MESSAGES[result.category],
            );
          }
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(result.payload) },
            ],
            structuredContent: result.payload,
          };
        },
      );
      continue;
    }

    if (tool.toolName === MCP_PORTFOLIO_DETAIL_TOOL_NAME) {
      server.registerTool(
        tool.toolName,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: MCP_PORTFOLIO_DETAIL_TOOL_INPUT_SCHEMA,
          annotations: { title: tool.title, ...BTPM_MCP_READ_TOOL_ANNOTATIONS },
        },
        async (args: McpPortfolioDetailToolArguments) => {
          const result = await executors.portfolioGetById(args);
          if (!result.ok) {
            return boundedToolError(
              MCP_PORTFOLIO_TOOL_ERROR_MESSAGES[result.category],
            );
          }
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(result.payload) },
            ],
            structuredContent: result.payload,
          };
        },
      );
      continue;
    }

    if (tool.toolName === MCP_PORTFOLIO_PROJECTS_TOOL_NAME) {
      server.registerTool(
        tool.toolName,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: MCP_PORTFOLIO_PROJECTS_TOOL_INPUT_SCHEMA,
          annotations: { title: tool.title, ...BTPM_MCP_READ_TOOL_ANNOTATIONS },
        },
        async (args: McpPortfolioProjectsToolArguments) => {
          const result = await executors.portfolioProjectsGet(args);
          if (!result.ok) {
            return boundedToolError(
              MCP_PORTFOLIO_TOOL_ERROR_MESSAGES[result.category],
            );
          }
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(result.payload) },
            ],
            structuredContent: result.payload,
          };
        },
      );
      continue;
    }


    if (tool.toolName === MCP_PROJECT_DETAIL_TOOL_NAME) {
      server.registerTool(
        tool.toolName,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: MCP_PROJECT_DETAIL_TOOL_INPUT_SCHEMA,
          annotations: { title: tool.title, ...BTPM_MCP_READ_TOOL_ANNOTATIONS },
        },
        async (args: McpProjectDetailToolArguments) => {
          const result = await executors.projectGetById(args);
          if (!result.ok) {
            return boundedToolError(
              MCP_PROJECT_CONTEXT_TOOL_ERROR_MESSAGES[result.category],
            );
          }
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(result.payload) },
            ],
            structuredContent: result.payload,
          };
        },
      );
      continue;
    }

    if (tool.toolName === MCP_PROJECT_PLANNING_TOOL_NAME) {
      server.registerTool(
        tool.toolName,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: MCP_PROJECT_PLANNING_TOOL_INPUT_SCHEMA,
          annotations: { title: tool.title, ...BTPM_MCP_READ_TOOL_ANNOTATIONS },
        },
        async (args: McpProjectPlanningToolArguments) => {
          const result = await executors.projectPlanningGet(args);
          if (!result.ok) {
            return boundedToolError(
              MCP_PROJECT_CONTEXT_TOOL_ERROR_MESSAGES[result.category],
            );
          }
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(result.payload) },
            ],
            structuredContent: result.payload,
          };
        },
      );
      continue;
    }

    if (tool.toolName === MCP_PROJECT_RISKS_TOOL_NAME) {
      server.registerTool(
        tool.toolName,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: MCP_PROJECT_RISKS_TOOL_INPUT_SCHEMA,
          annotations: { title: tool.title, ...BTPM_MCP_READ_TOOL_ANNOTATIONS },
        },
        async (args: McpProjectRisksToolArguments) => {
          const result = await executors.risksGet(args);
          if (!result.ok) {
            return boundedToolError(MCP_RISK_TOOL_ERROR_MESSAGES[result.category]);
          }
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(result.payload) },
            ],
            structuredContent: result.payload,
          };
        },
      );
      continue;
    }

    if (tool.toolName === MCP_RISK_DETAIL_TOOL_NAME) {
      server.registerTool(
        tool.toolName,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: MCP_RISK_DETAIL_TOOL_INPUT_SCHEMA,
          annotations: { title: tool.title, ...BTPM_MCP_READ_TOOL_ANNOTATIONS },
        },
        async (args: McpRiskDetailToolArguments) => {
          const result = await executors.riskGetById(args);
          if (!result.ok) {
            return boundedToolError(MCP_RISK_TOOL_ERROR_MESSAGES[result.category]);
          }
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(result.payload) },
            ],
            structuredContent: result.payload,
          };
        },
      );
      continue;
    }

    if (tool.toolName === MCP_PROJECT_BLOCKERS_TOOL_NAME) {
      server.registerTool(
        tool.toolName,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: MCP_PROJECT_BLOCKERS_TOOL_INPUT_SCHEMA,
          annotations: { title: tool.title, ...BTPM_MCP_READ_TOOL_ANNOTATIONS },
        },
        async (args: McpProjectBlockersToolArguments) => {
          const result = await executors.blockersGet(args);
          if (!result.ok) {
            return boundedToolError(MCP_BLOCKER_TOOL_ERROR_MESSAGES[result.category]);
          }
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(result.payload) },
            ],
            structuredContent: result.payload,
          };
        },
      );
      continue;
    }

    if (tool.toolName === MCP_BLOCKER_DETAIL_TOOL_NAME) {
      server.registerTool(
        tool.toolName,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: MCP_BLOCKER_DETAIL_TOOL_INPUT_SCHEMA,
          annotations: { title: tool.title, ...BTPM_MCP_READ_TOOL_ANNOTATIONS },
        },
        async (args: McpBlockerDetailToolArguments) => {
          const result = await executors.blockerGetById(args);
          if (!result.ok) {
            return boundedToolError(MCP_BLOCKER_TOOL_ERROR_MESSAGES[result.category]);
          }
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(result.payload) },
            ],
            structuredContent: result.payload,
          };
        },
      );
      continue;
    }

    if (tool.toolName === MCP_EXECUTION_UPDATES_TOOL_NAME) {
      server.registerTool(
        tool.toolName,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: MCP_EXECUTION_UPDATES_TOOL_INPUT_SCHEMA,
          annotations: { title: tool.title, ...BTPM_MCP_READ_TOOL_ANNOTATIONS },
        },
        async (args: McpExecutionUpdatesToolArguments) => {
          const result = await executors.executionUpdatesGet(args);
          if (!result.ok) {
            return boundedToolError(MCP_EXECUTION_UPDATE_TOOL_ERROR_MESSAGES[result.category]);
          }
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(result.payload) },
            ],
            structuredContent: result.payload,
          };
        },
      );
      continue;
    }

    if (tool.toolName === MCP_PHASE_DETAIL_TOOL_NAME) {
      server.registerTool(
        tool.toolName,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: MCP_PHASE_DETAIL_TOOL_INPUT_SCHEMA,
          annotations: { title: tool.title, ...BTPM_MCP_READ_TOOL_ANNOTATIONS },
        },
        async (args: McpPhaseDetailToolArguments) => {
          const result = await executors.phaseGetById(args);
          if (!result.ok) {
            return boundedToolError(MCP_PHASE_TOOL_ERROR_MESSAGES[result.category]);
          }
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(result.payload) },
            ],
            structuredContent: result.payload,
          };
        },
      );
      continue;
    }

    if (tool.toolName === MCP_TASK_DETAIL_TOOL_NAME) {
      server.registerTool(
        tool.toolName,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: MCP_TASK_DETAIL_TOOL_INPUT_SCHEMA,
          annotations: { title: tool.title, ...BTPM_MCP_READ_TOOL_ANNOTATIONS },
        },
        async (args: McpTaskDetailToolArguments) => {
          const result = await executors.taskGetById(args);
          if (!result.ok) {
            return boundedToolError(MCP_TASK_TOOL_ERROR_MESSAGES[result.category]);
          }
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(result.payload) },
            ],
            structuredContent: result.payload,
          };
        },
      );
      continue;
    }

    // API-Q.9B2 — the single exposed canonical mutation
    // (`execution_updates.append`). Confirmation, canonical validation,
    // idempotency, payload hashing and rate limiting are owned entirely by the
    // API-Q.9B1 control layer behind this bounded executor.
    if (tool.toolName === MCP_EXECUTION_UPDATE_APPEND_TOOL_NAME) {
      server.registerTool(
        tool.toolName,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: MCP_EXECUTION_UPDATE_APPEND_TOOL_INPUT_SCHEMA,
          annotations: {
            title: tool.title,
            ...BTPM_MCP_MUTATION_TOOL_ANNOTATIONS,
          },
        },
        async (args: McpExecutionUpdateAppendToolArguments) => {
          const result = await executors.executionUpdateAppend(args);
          if (!result.ok) {
            return boundedToolError(
              MCP_EXECUTION_UPDATE_APPEND_TOOL_ERROR_MESSAGES[result.category],
            );
          }
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(result.payload) },
            ],
            structuredContent: result.payload,
          };
        },
      );
      continue;
    }

    // KPI-4C — the exposed canonical Project KPI definition create mutation
    // (`kpis.create`). Confirmation, canonical path/body validation,
    // idempotency, payload hashing and rate limiting are owned entirely by the
    // KPI-4C control layer behind this bounded executor. No KPI narrative is
    // reconstructed here.
    if (tool.toolName === MCP_KPI_CREATE_TOOL_NAME) {
      server.registerTool(
        tool.toolName,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: MCP_KPI_CREATE_TOOL_INPUT_SCHEMA,
          annotations: {
            title: tool.title,
            ...BTPM_MCP_MUTATION_TOOL_ANNOTATIONS,
          },
        },
        async (args: McpKpiCreateToolArguments) => {
          const result = await executors.kpiCreate(args);
          if (!result.ok) {
            return boundedToolError(
              MCP_KPI_CREATE_TOOL_ERROR_MESSAGES[result.category],
            );
          }
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(result.payload) },
            ],
            structuredContent: result.payload,
          };
        },
      );
      continue;
    }

    // KPI-5C — the exposed canonical Project KPI definition update mutation
    // (`kpis.update`). Confirmation, canonical KPI-ID/body validation
    // (including the caller-supplied `expectedUpdatedAt` concurrency token,
    // which is passed through unchanged), idempotency, payload hashing, rate
    // limiting and the bounded `stale_kpi_definition` mapping are owned
    // entirely by the KPI-5C control layer behind this bounded executor. No KPI
    // is read before write, no timestamp is refreshed, nothing is retried and
    // no KPI narrative is reconstructed here.
    if (tool.toolName === MCP_KPI_UPDATE_TOOL_NAME) {
      server.registerTool(
        tool.toolName,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: MCP_KPI_UPDATE_TOOL_INPUT_SCHEMA,
          annotations: {
            title: tool.title,
            ...BTPM_MCP_MUTATION_TOOL_ANNOTATIONS,
          },
        },
        async (args: McpKpiUpdateToolArguments) => {
          const result = await executors.kpiUpdate(args);
          if (!result.ok) {
            return boundedToolError(
              MCP_KPI_UPDATE_TOOL_ERROR_MESSAGES[result.category],
            );
          }
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(result.payload) },
            ],
            structuredContent: result.payload,
          };
        },
      );
      continue;
    }

    // KPI-6C — the canonical append-only KPI update-history mutation. All
    // confirmation, canonical parsing, idempotency, rate limiting and bounded
    // result mapping are owned by the KPI-6C control layer behind this bounded
    // executor. No Supabase client, RPC, service role or generic dispatcher
    // exists here, and no KPI note is ever returned.
    if (tool.toolName === MCP_KPI_UPDATE_APPEND_TOOL_NAME) {
      server.registerTool(
        tool.toolName,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: MCP_KPI_UPDATE_APPEND_TOOL_INPUT_SCHEMA,
          annotations: {
            title: tool.title,
            ...BTPM_MCP_MUTATION_TOOL_ANNOTATIONS,
          },
        },
        async (args: McpKpiUpdateAppendToolArguments) => {
          const result = await executors.kpiUpdateAppend(args);
          if (!result.ok) {
            return boundedToolError(
              MCP_KPI_UPDATE_APPEND_TOOL_ERROR_MESSAGES[result.category],
            );
          }
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(result.payload) },
            ],
            structuredContent: result.payload,
          };
        },
      );
      continue;
    }



    // API-Q.10A5 — the second exposed canonical mutation (`risks.create`).
    // Confirmation, canonical validation, idempotency, payload hashing and
    // rate limiting are owned entirely by the API-Q.10A4 control layer behind
    // this bounded executor. No Risk narrative is reconstructed here.
    if (tool.toolName === MCP_RISK_CREATE_TOOL_NAME) {
      server.registerTool(
        tool.toolName,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: MCP_RISK_CREATE_TOOL_INPUT_SCHEMA,
          annotations: {
            title: tool.title,
            ...BTPM_MCP_MUTATION_TOOL_ANNOTATIONS,
          },
        },
        async (args: McpRiskCreateToolArguments) => {
          const result = await executors.riskCreate(args);
          if (!result.ok) {
            return boundedToolError(
              MCP_RISK_CREATE_TOOL_ERROR_MESSAGES[result.category],
            );
          }
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(result.payload) },
            ],
            structuredContent: result.payload,
          };
        },
      );
      continue;
    }

    // API-Q.10B4 — the third exposed canonical mutation (`risks.update`).
    // Confirmation, canonical validation (including the caller-supplied
    // `expectedUpdatedAt` concurrency token, which is passed through
    // unchanged), idempotency, payload hashing, rate limiting and the bounded
    // `stale_risk` mapping are owned entirely by the API-Q.10B3 control layer
    // behind this bounded executor. No Risk is read before write, no timestamp
    // is refreshed or reformatted, nothing is retried or resubmitted, and no
    // Risk narrative is reconstructed here.
    if (tool.toolName === MCP_RISK_UPDATE_TOOL_NAME) {
      server.registerTool(
        tool.toolName,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: MCP_RISK_UPDATE_TOOL_INPUT_SCHEMA,
          annotations: {
            title: tool.title,
            ...BTPM_MCP_MUTATION_TOOL_ANNOTATIONS,
          },
        },
        async (args: McpRiskUpdateToolArguments) => {
          const result = await executors.riskUpdate(args);
          if (!result.ok) {
            return boundedToolError(
              MCP_RISK_UPDATE_TOOL_ERROR_MESSAGES[result.category],
            );
          }
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(result.payload) },
            ],
            structuredContent: result.payload,
          };
        },
      );
      continue;
    }

    // API-Q.10C4 — the fourth exposed canonical mutation (`blockers.create`).
    // Confirmation, canonical validation, idempotency, payload hashing, rate
    // limiting and provenance are owned entirely by the API-Q.10C3 control
    // layer behind this bounded executor. No Blocker narrative is
    // reconstructed here.
    if (tool.toolName === MCP_BLOCKER_CREATE_TOOL_NAME) {
      server.registerTool(
        tool.toolName,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: MCP_BLOCKER_CREATE_TOOL_INPUT_SCHEMA,
          annotations: {
            title: tool.title,
            ...BTPM_MCP_MUTATION_TOOL_ANNOTATIONS,
          },
        },
        async (args: McpBlockerCreateToolArguments) => {
          const result = await executors.blockerCreate(args);
          if (!result.ok) {
            return boundedToolError(
              MCP_BLOCKER_CREATE_TOOL_ERROR_MESSAGES[result.category],
            );
          }
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(result.payload) },
            ],
            structuredContent: result.payload,
          };
        },
      );
      continue;
    }

    // API-Q.10D4 — the fifth exposed canonical mutation (`blockers.update`).
    // Confirmation, canonical validation, idempotency, payload hashing, rate
    // limiting, optimistic concurrency and provenance are owned entirely by the
    // API-Q.10D3 control layer behind this bounded executor. The caller's
    // `expectedUpdatedAt` is never read, refreshed or retried here.
    if (tool.toolName === MCP_BLOCKER_UPDATE_TOOL_NAME) {
      server.registerTool(
        tool.toolName,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: MCP_BLOCKER_UPDATE_TOOL_INPUT_SCHEMA,
          annotations: {
            title: tool.title,
            ...BTPM_MCP_MUTATION_TOOL_ANNOTATIONS,
          },
        },
        async (args: McpBlockerUpdateToolArguments) => {
          const result = await executors.blockerUpdate(args);
          if (!result.ok) {
            return boundedToolError(
              MCP_BLOCKER_UPDATE_TOOL_ERROR_MESSAGES[result.category],
            );
          }
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(result.payload) },
            ],
            structuredContent: result.payload,
          };
        },
      );
      continue;
    }

    // API-Q Phase Create Step 4 — the sixth exposed canonical mutation
    // (`phases.create`). Confirmation, canonical validation, idempotency,
    // payload hashing, rate limiting, Project containment, Project
    // planning-window semantics and provenance are owned entirely by the Phase
    // Create Step 3 control layer behind this bounded executor. No Phase or
    // Project is read here, no Project window is widened, nothing is retried,
    // and no Phase narrative is reconstructed.
    if (tool.toolName === MCP_PHASE_CREATE_TOOL_NAME) {
      server.registerTool(
        tool.toolName,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: MCP_PHASE_CREATE_TOOL_INPUT_SCHEMA,
          annotations: {
            title: tool.title,
            ...BTPM_MCP_MUTATION_TOOL_ANNOTATIONS,
          },
        },
        async (args: McpPhaseCreateToolArguments) => {
          const result = await executors.phaseCreate(args);
          if (!result.ok) {
            return boundedToolError(
              MCP_PHASE_CREATE_TOOL_ERROR_MESSAGES[result.category],
            );
          }
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(result.payload) },
            ],
            structuredContent: result.payload,
          };
        },
      );
      continue;
    }

    // API-Q Phase Update Step 4 — the seventh exposed canonical mutation
    // (`phases.update`). Confirmation, canonical path/body validation,
    // idempotency, payload hashing, rate limiting, optimistic concurrency
    // (`expectedUpdatedAt`), containment and provenance are owned entirely by
    // the Phase Update Step 3 control layer behind this bounded executor. No
    // Phase is read here, no timestamp is refreshed, nothing is retried, and no
    // Phase narrative is reconstructed.
    if (tool.toolName === MCP_PHASE_UPDATE_TOOL_NAME) {
      server.registerTool(
        tool.toolName,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: MCP_PHASE_UPDATE_TOOL_INPUT_SCHEMA,
          annotations: {
            title: tool.title,
            ...BTPM_MCP_MUTATION_TOOL_ANNOTATIONS,
          },
        },
        async (args: McpPhaseUpdateToolArguments) => {
          const result = await executors.phaseUpdate(args);
          if (!result.ok) {
            return boundedToolError(
              MCP_PHASE_UPDATE_TOOL_ERROR_MESSAGES[result.category],
            );
          }
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(result.payload) },
            ],
            structuredContent: result.payload,
          };
        },
      );
      continue;
    }

    // API-Q Phase Reorder Step 4 — the eighth exposed canonical mutation
    // (`phases.reorder`). Confirmation, canonical path/body validation,
    // idempotency, payload hashing, rate limiting, optimistic concurrency
    // (every row's `expectedUpdatedAt`), sibling completeness, containment and
    // provenance are owned entirely by the Phase Reorder Step 3 control layer
    // behind this bounded executor. No Phase is read here, no row is inspected,
    // reordered or supplemented, no timestamp is refreshed and nothing is
    // retried.
    if (tool.toolName === MCP_PHASE_REORDER_TOOL_NAME) {
      server.registerTool(
        tool.toolName,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: MCP_PHASE_REORDER_TOOL_INPUT_SCHEMA,
          annotations: {
            title: tool.title,
            ...BTPM_MCP_MUTATION_TOOL_ANNOTATIONS,
          },
        },
        async (args: McpPhaseReorderToolArguments) => {
          const result = await executors.phaseReorder(args);
          if (!result.ok) {
            return boundedToolError(
              MCP_PHASE_REORDER_TOOL_ERROR_MESSAGES[result.category],
            );
          }
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(result.payload) },
            ],
            structuredContent: result.payload,
          };
        },
      );
      continue;
    }

    // API-Q Phase Plan Step 4 — the ninth exposed canonical mutation
    // (`phases.plan`). Ordinary confirmation, canonical path/body validation,
    // the Project-window extension business flag, idempotency, payload hashing,
    // rate limiting, optimistic concurrency (`expectedUpdatedAt`), containment
    // and provenance are owned entirely by the Phase Plan Step 3 control layer
    // behind this bounded executor. No Phase or Project is read here, no date is
    // inspected or adjusted, no timestamp is refreshed, no Project extension is
    // ever auto-approved and nothing is retried.
    if (tool.toolName === MCP_PHASE_PLAN_TOOL_NAME) {
      server.registerTool(
        tool.toolName,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: MCP_PHASE_PLAN_TOOL_INPUT_SCHEMA,
          annotations: {
            title: tool.title,
            ...BTPM_MCP_MUTATION_TOOL_ANNOTATIONS,
          },
        },
        async (args: McpPhasePlanToolArguments) => {
          const result = await executors.phasePlan(args);
          if (!result.ok) {
            // Informational Project-window impact only. The bounded structured
            // details let the user decide explicitly; the server never
            // authorizes the extension, retries or mints a new idempotency key.
            if (result.category === "project_window_extension_required") {
              const details = "details" in result ? result.details : undefined;
              if (details === null || typeof details !== "object") {
                return boundedToolError(
                  MCP_PHASE_PLAN_TOOL_ERROR_MESSAGES.unavailable,
                );
              }
              const structured = {
                category: "project_window_extension_required" as const,
                message: MCP_PHASE_PLAN_TOOL_ERROR_MESSAGES[
                  "project_window_extension_required"
                ],
                details: {
                  projectId: details.projectId,
                  projectCurrentStart: details.projectCurrentStart,
                  projectCurrentTargetEnd: details.projectCurrentTargetEnd,
                  projectProposedStart: details.projectProposedStart,
                  projectProposedTargetEnd: details.projectProposedTargetEnd,
                  requestedPhaseStart: details.requestedPhaseStart,
                  requestedPhaseEnd: details.requestedPhaseEnd,
                },
              };
              return {
                isError: true as const,
                content: [
                  { type: "text" as const, text: JSON.stringify(structured) },
                ],
                structuredContent: structured,
              };
            }
            return boundedToolError(
              MCP_PHASE_PLAN_TOOL_ERROR_MESSAGES[result.category],
            );
          }
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(result.payload) },
            ],
            structuredContent: result.payload,
          };
        },
      );
      continue;
    }

    // API-Q Task Create Step 4 — the tenth exposed canonical mutation
    // (`tasks.create`). Confirmation, canonical validation, idempotency, payload
    // hashing, rate limiting, Phase containment, Phase planning-window
    // semantics and provenance are owned entirely by the Task Create Step 3
    // control layer behind this bounded executor. No Task, Phase or Project is
    // read here, no Phase window is widened, nothing is retried, and no Task
    // narrative is reconstructed.
    if (tool.toolName === MCP_TASK_CREATE_TOOL_NAME) {
      server.registerTool(
        tool.toolName,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: MCP_TASK_CREATE_TOOL_INPUT_SCHEMA,
          annotations: {
            title: tool.title,
            ...BTPM_MCP_MUTATION_TOOL_ANNOTATIONS,
          },
        },
        async (args: McpTaskCreateToolArguments) => {
          const result = await executors.taskCreate(args);
          if (!result.ok) {
            return boundedToolError(
              MCP_TASK_CREATE_TOOL_ERROR_MESSAGES[result.category],
            );
          }
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(result.payload) },
            ],
            structuredContent: result.payload,
          };
        },
      );
      continue;
    }

    // API-Q Task Update Step 4 — the ELEVENTH exposed MCP mutation
    // (`tasks.update`). Confirmation, canonical validation, idempotency, payload
    // hashing, rate limiting, optimistic concurrency and stale mapping are owned
    // entirely by the Task Update Step 3 control layer behind this bounded
    // executor. No Task is read here, no `expectedUpdatedAt` is refreshed,
    // nothing is retried, and no Task narrative is reconstructed.
    if (tool.toolName === MCP_TASK_UPDATE_TOOL_NAME) {
      server.registerTool(
        tool.toolName,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: MCP_TASK_UPDATE_TOOL_INPUT_SCHEMA,
          annotations: {
            title: tool.title,
            ...BTPM_MCP_MUTATION_TOOL_ANNOTATIONS,
          },
        },
        async (args: McpTaskUpdateToolArguments) => {
          const result = await executors.taskUpdate(args);
          if (!result.ok) {
            return boundedToolError(
              MCP_TASK_UPDATE_TOOL_ERROR_MESSAGES[result.category],
            );
          }
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(result.payload) },
            ],
            structuredContent: result.payload,
          };
        },
      );
      continue;
    }

    // API-Q Task Reorder Step 4 — the TWELFTH exposed MCP mutation
    // (`tasks.reorder`). Confirmation, canonical path/body validation,
    // idempotency, payload hashing, rate limiting, optimistic concurrency
    // (every row's `expectedUpdatedAt`), sibling completeness, containment and
    // provenance are owned entirely by the Task Reorder Step 3 control layer
    // behind this bounded executor. No Task is read here, no row is inspected,
    // reordered or supplemented, no timestamp is refreshed and nothing is
    // retried.
    if (tool.toolName === MCP_TASK_REORDER_TOOL_NAME) {
      server.registerTool(
        tool.toolName,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: MCP_TASK_REORDER_TOOL_INPUT_SCHEMA,
          annotations: {
            title: tool.title,
            ...BTPM_MCP_MUTATION_TOOL_ANNOTATIONS,
          },
        },
        async (args: McpTaskReorderToolArguments) => {
          const result = await executors.taskReorder(args);
          if (!result.ok) {
            return boundedToolError(
              MCP_TASK_REORDER_TOOL_ERROR_MESSAGES[result.category],
            );
          }
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(result.payload) },
            ],
            structuredContent: result.payload,
          };
        },
      );
      continue;
    }

    // API-Q Task Plan Step 4 — the THIRTEENTH exposed MCP mutation
    // (`tasks.plan`). Ordinary confirmation, canonical validation, the
    // Phase-window extension business flag, idempotency, payload hashing, rate
    // limiting, optimistic concurrency (`expectedUpdatedAt`), containment and
    // provenance are owned entirely by the Task Plan Step 3 control layer behind
    // this bounded executor. No Task, Phase or Project is read here, no date is
    // inspected or adjusted, no timestamp is refreshed, no Phase extension is
    // ever auto-approved and nothing is retried.
    if (tool.toolName === MCP_TASK_PLAN_TOOL_NAME) {
      server.registerTool(
        tool.toolName,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: MCP_TASK_PLAN_TOOL_INPUT_SCHEMA,
          annotations: {
            title: tool.title,
            ...BTPM_MCP_MUTATION_TOOL_ANNOTATIONS,
          },
        },
        async (args: McpTaskPlanToolArguments) => {
          const result = await executors.taskPlan(args);
          if (!result.ok) {
            // Informational Phase-window impact only. The bounded structured
            // details let the user decide explicitly; the server never
            // authorizes the extension, retries or mints a new idempotency key.
            if (result.category === "phase_window_extension_required") {
              const details = "details" in result ? result.details : undefined;
              if (details === null || typeof details !== "object") {
                return boundedToolError(
                  MCP_TASK_PLAN_TOOL_ERROR_MESSAGES.unavailable,
                );
              }
              const structured = {
                category: "phase_window_extension_required" as const,
                message: MCP_TASK_PLAN_TOOL_ERROR_MESSAGES[
                  "phase_window_extension_required"
                ],
                details: {
                  taskId: details.taskId,
                  projectId: details.projectId,
                  phaseId: details.phaseId,
                  phaseCurrentStart: details.phaseCurrentStart,
                  phaseCurrentTargetEnd: details.phaseCurrentTargetEnd,
                  phaseProposedStart: details.phaseProposedStart,
                  phaseProposedTargetEnd: details.phaseProposedTargetEnd,
                  requestedTaskStart: details.requestedTaskStart,
                  requestedTaskDue: details.requestedTaskDue,
                },
              };
              return {
                isError: true as const,
                content: [
                  { type: "text" as const, text: JSON.stringify(structured) },
                ],
                structuredContent: structured,
              };
            }
            return boundedToolError(
              MCP_TASK_PLAN_TOOL_ERROR_MESSAGES[result.category],
            );
          }
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(result.payload) },
            ],
            structuredContent: result.payload,
          };
        },
      );
      continue;
    }

    // API-Q Task Assign Step 4 — the FOURTEENTH exposed MCP mutation
    // (`tasks.assign`). Confirmation, canonical path/body validation,
    // idempotency, payload hashing, rate limiting, assignment eligibility,
    // containment and provenance are owned entirely by the Task Assign Step 3
    // control layer behind this bounded executor. No Task, user or membership is
    // read here, `assigneeId: null` is never rewritten, and Task assignment
    // carries no concurrency token.
    if (tool.toolName === MCP_TASK_ASSIGN_TOOL_NAME) {
      server.registerTool(
        tool.toolName,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: MCP_TASK_ASSIGN_TOOL_INPUT_SCHEMA,
          annotations: {
            title: tool.title,
            ...BTPM_MCP_MUTATION_TOOL_ANNOTATIONS,
          },
        },
        async (args: McpTaskAssignToolArguments) => {
          const result = await executors.taskAssign(args);
          if (!result.ok) {
            return boundedToolError(
              MCP_TASK_ASSIGN_TOOL_ERROR_MESSAGES[result.category],
            );
          }
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(result.payload) },
            ],
            structuredContent: result.payload,
          };
        },
      );
      continue;
    }

    // API-Q Task Transition Step 4 — the FIFTEENTH exposed MCP mutation
    // (`tasks.transition`). Confirmation, canonical path/body validation,
    // idempotency, payload hashing, rate limiting, optimistic concurrency,
    // containment and provenance are owned entirely by the Task Transition
    // Step 3 control layer behind this bounded executor. No Task is read here,
    // no concurrency token is inspected, refreshed or repaired, and no
    // successful status is narrowed.
    if (tool.toolName === MCP_TASK_TRANSITION_TOOL_NAME) {
      server.registerTool(
        tool.toolName,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: MCP_TASK_TRANSITION_TOOL_INPUT_SCHEMA,
          annotations: {
            title: tool.title,
            ...BTPM_MCP_MUTATION_TOOL_ANNOTATIONS,
          },
        },
        async (args: McpTaskTransitionToolArguments) => {
          const result = await executors.taskTransition(args);
          if (!result.ok) {
            return boundedToolError(
              MCP_TASK_TRANSITION_TOOL_ERROR_MESSAGES[result.category],
            );
          }
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(result.payload) },
            ],
            structuredContent: result.payload,
          };
        },
      );
      continue;
    }

    // API-Q Project Create Step 4 — the exposed canonical `projects.create`
    // mutation. Confirmation, canonical validation, idempotency, payload
    // hashing, rate limiting and provenance are owned entirely by the Project
    // Create Step 3 control layer behind this bounded executor. No Project,
    // Program or Workspace is read here, no Project Connected-App enablement is
    // queried, required or created, nothing is retried, and no Project
    // narrative is reconstructed.
    if (tool.toolName === MCP_PROJECT_CREATE_TOOL_NAME) {
      server.registerTool(
        tool.toolName,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: MCP_PROJECT_CREATE_TOOL_INPUT_SCHEMA,
          annotations: {
            title: tool.title,
            ...BTPM_MCP_MUTATION_TOOL_ANNOTATIONS,
          },
        },
        async (args: McpProjectCreateToolArguments) => {
          const result = await executors.projectCreate(args);
          if (!result.ok) {
            return boundedToolError(
              MCP_PROJECT_CREATE_TOOL_ERROR_MESSAGES[result.category],
            );
          }
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(result.payload) },
            ],
            structuredContent: result.payload,
          };
        },
      );
      continue;
    }

    // API-Q Project Update Step 4 — the exposed canonical `projects.update`
    // mutation. Confirmation, canonical validation, presence derivation,
    // idempotency, payload hashing, rate limiting and provenance are owned
    // entirely by the Project Update Step 3 control layer behind this bounded
    // executor. No Project or Program is read here, no Project Connected-App
    // enablement is queried, required or created, no timestamp is refreshed,
    // nothing is retried, and no Project narrative is reconstructed.
    if (tool.toolName === MCP_PROJECT_UPDATE_TOOL_NAME) {
      server.registerTool(
        tool.toolName,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: MCP_PROJECT_UPDATE_TOOL_INPUT_SCHEMA,
          annotations: {
            title: tool.title,
            ...BTPM_MCP_MUTATION_TOOL_ANNOTATIONS,
          },
        },
        async (args: McpProjectUpdateToolArguments) => {
          const result = await executors.projectUpdate(args);
          if (!result.ok) {
            return boundedToolError(
              MCP_PROJECT_UPDATE_TOOL_ERROR_MESSAGES[result.category],
            );
          }
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(result.payload) },
            ],
            structuredContent: result.payload,
          };
        },
      );
      continue;
    }

    // API-Q Project Transition Step 4 — the exposed canonical
    // `projects.transition` mutation. MCP mutation confirmation, canonical
    // validation, idempotency, payload hashing, rate limiting and provenance
    // are owned entirely by the Project Transition Step 3 control layer behind
    // this bounded executor. No Project or Program is read here, no Project
    // Connected-App enablement is queried, required or created, no lifecycle,
    // completion, hard-block or soft-warning rule is evaluated or inspected,
    // no timestamp is refreshed, and nothing is retried. Every outer
    // `ok: true` payload family — applied/no_change/replayed, blocked and
    // business confirmation_required — is serialized identically.
    if (tool.toolName === MCP_PROJECT_TRANSITION_TOOL_NAME) {
      server.registerTool(
        tool.toolName,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: MCP_PROJECT_TRANSITION_TOOL_INPUT_SCHEMA,
          annotations: {
            title: tool.title,
            ...BTPM_MCP_MUTATION_TOOL_ANNOTATIONS,
          },
        },
        async (args: McpProjectTransitionToolArguments) => {
          const result = await executors.projectTransition(args);
          if (!result.ok) {
            return boundedToolError(
              MCP_PROJECT_TRANSITION_TOOL_ERROR_MESSAGES[result.category],
            );
          }
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(result.payload) },
            ],
            structuredContent: result.payload,
          };
        },
      );
      continue;
    }

    // API-Q Program Create Step 4 — the exposed canonical `programs.create`
    // mutation. Confirmation, canonical validation, idempotency, payload
    // hashing, rate limiting and provenance are owned entirely by the Program
    // Create Step 3 control layer behind this bounded executor. No Program,
    // Workspace or Organization is read here, no Program-level Connected-App
    // enablement exists or is queried, nothing is retried, and no Program name
    // or description is inspected, logged or returned.
    if (tool.toolName === MCP_PROGRAM_CREATE_TOOL_NAME) {
      server.registerTool(
        tool.toolName,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: MCP_PROGRAM_CREATE_TOOL_INPUT_SCHEMA,
          annotations: {
            title: tool.title,
            ...BTPM_MCP_MUTATION_TOOL_ANNOTATIONS,
          },
        },
        async (args: McpProgramCreateToolArguments) => {
          const result = await executors.programCreate(args);
          if (!result.ok) {
            return boundedToolError(
              MCP_PROGRAM_CREATE_TOOL_ERROR_MESSAGES[result.category],
            );
          }
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(result.payload) },
            ],
            structuredContent: result.payload,
          };
        },
      );
      continue;
    }

    // API-Q Program Update Step 4 — the exposed canonical `programs.update`
    // mutation. Confirmation, canonical validation, presence derivation,
    // idempotency, payload hashing, rate limiting and provenance are owned
    // entirely by the Program Update Step 3 control layer behind this bounded
    // executor. No Program, Workspace or Organization is read here, no
    // Program-level Connected-App enablement exists or is queried, no
    // concurrency token is inspected or refreshed, nothing is retried, and no
    // Program name, status or description is inspected, logged or returned.
    if (tool.toolName === MCP_PROGRAM_UPDATE_TOOL_NAME) {
      server.registerTool(
        tool.toolName,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: MCP_PROGRAM_UPDATE_TOOL_INPUT_SCHEMA,
          annotations: {
            title: tool.title,
            ...BTPM_MCP_MUTATION_TOOL_ANNOTATIONS,
          },
        },
        async (args: McpProgramUpdateToolArguments) => {
          const result = await executors.programUpdate(args);
          if (!result.ok) {
            return boundedToolError(
              MCP_PROGRAM_UPDATE_TOOL_ERROR_MESSAGES[result.category],
            );
          }
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(result.payload) },
            ],
            structuredContent: result.payload,
          };
        },
      );
      continue;
    }

    // API-Q Portfolio-9D — the exposed canonical `portfolios.create` mutation.
    // Confirmation, canonical validation, idempotency, payload hashing, rate
    // limiting and provenance are owned entirely by the Portfolio-9C control
    // layer behind this bounded executor; Organization authority, containment,
    // encryption and persistence stay owned by the Portfolio-9A database
    // bridge. No Portfolio, Organization or owner is read here, no
    // Portfolio-level Connected-App enablement exists or is queried, nothing is
    // retried, and no Portfolio name or description is inspected, logged or
    // returned.
    if (tool.toolName === MCP_PORTFOLIO_CREATE_TOOL_NAME) {
      server.registerTool(
        tool.toolName,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: MCP_PORTFOLIO_CREATE_TOOL_INPUT_SCHEMA,
          annotations: {
            title: tool.title,
            ...BTPM_MCP_MUTATION_TOOL_ANNOTATIONS,
          },
        },
        async (args: McpPortfolioCreateToolArguments) => {
          const result = await executors.portfolioCreate(args);
          if (!result.ok) {
            return boundedToolError(
              MCP_PORTFOLIO_CREATE_TOOL_ERROR_MESSAGES[result.category],
            );
          }
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(result.payload) },
            ],
            structuredContent: result.payload,
          };
        },
      );
      continue;
    }





    // API-Q Portfolio-10D — the exposed canonical `portfolios.update`
    // mutation. Confirmation, canonical validation, presence derivation,
    // idempotency, payload hashing, rate limiting and provenance are owned
    // entirely by the Portfolio-10C control layer behind this bounded
    // executor; Organization authority, containment, optimistic concurrency,
    // encryption and persistence stay owned by the Portfolio-10A database
    // bridge. No Portfolio, Organization or owner is read here, no
    // Portfolio-level Connected-App enablement exists or is queried, no
    // concurrency token is inspected or refreshed, nothing is retried, and no
    // Portfolio name or description is inspected, logged or returned.
    if (tool.toolName === MCP_PORTFOLIO_UPDATE_TOOL_NAME) {
      server.registerTool(
        tool.toolName,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: MCP_PORTFOLIO_UPDATE_TOOL_INPUT_SCHEMA,
          annotations: {
            title: tool.title,
            ...BTPM_MCP_MUTATION_TOOL_ANNOTATIONS,
          },
        },
        async (args: McpPortfolioUpdateToolArguments) => {
          const result = await executors.portfolioUpdate(args);
          if (!result.ok) {
            return boundedToolError(
              MCP_PORTFOLIO_UPDATE_TOOL_ERROR_MESSAGES[result.category],
            );
          }
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(result.payload) },
            ],
            structuredContent: result.payload,
          };
        },
      );
      continue;
    }

    // API-Q Portfolio-11D — the exposed canonical `portfolios.assign_project`
    // mutation. Confirmation, canonical validation, idempotency, payload
    // hashing, rate limiting and provenance are owned entirely by the
    // Portfolio-11C control layer behind this bounded executor;
    // Project/Portfolio authority, containment, same-Organization eligibility,
    // archive validation, encryption and persistence stay owned by the
    // Portfolio-11A trusted database bridge. No Project or Portfolio is read
    // here, no assignment state is inspected, `portfolioId: null` is never
    // replaced or omitted, no concurrency token exists, and nothing is
    // retried.
    if (tool.toolName === MCP_PORTFOLIO_ASSIGN_PROJECT_TOOL_NAME) {
      server.registerTool(
        tool.toolName,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: MCP_PORTFOLIO_ASSIGN_PROJECT_TOOL_INPUT_SCHEMA,
          annotations: {
            title: tool.title,
            ...BTPM_MCP_MUTATION_TOOL_ANNOTATIONS,
          },
        },
        async (args: McpPortfolioAssignProjectToolArguments) => {
          const result = await executors.portfolioAssignProject(args);
          if (!result.ok) {
            return boundedToolError(
              MCP_PORTFOLIO_ASSIGN_PROJECT_TOOL_ERROR_MESSAGES[result.category],
            );
          }
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(result.payload) },
            ],
            structuredContent: result.payload,
          };
        },
      );
      continue;
    }

    // MCP-HARDENING-C2: no placeholder registration and no silent skip. An
    // exposed registry entry that reaches this point has no explicit bounded
    // executor branch, so server construction fails closed and no usable
    // server is returned.
    throw new McpExposedToolWithoutExecutionPathError(tool);
  }


  // API-Q.PS.1: register the single static MCP Apps UI resource. This adds no
  // tool, no capability beyond static resources and reads no BTPM data.
  registerBtpmProjectSelectorAppResource(server);

  // API-Q.PS.2 — one explicit MCP-App-only presentation/bootstrap tool. It is
  // intentionally NOT part of the canonical `MCP_TOOL_REGISTRY` allowlist above
  // and performs no BTPM business read or write.
  registerBtpmProjectSelectorAppTool(server);

  return server;
}
