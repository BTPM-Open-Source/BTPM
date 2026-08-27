// API-Q Task Create Step 3 — Task-create MCP mutation tool control layer.
//
// This module is the per-request MCP tool CONTROL/COMPOSITION layer for exactly
// one canonical operation: `tasks.create`. It composes only already accepted
// components:
//
//   - literal confirmation control        : `requireMcpMutationConfirmation`
//   - canonical business validation       : `parseApiV1CreateTaskBody`
//   - canonical idempotency + payload hash: `buildMcpMutationExecutionContext`
//   - canonical rate limiting             : `enforceApiRateLimit`
//   - caller-bound writer                 : `McpV1CreateTaskExecutor`
//
// It creates no Supabase client, reads no environment variable, calls no RPC,
// calls no PMG function, touches no table, uses no service-role credential,
// performs no authorization, no Tenant/Organization/Workspace derivation, no
// encryption, persists nothing, logs nothing and registers no MCP tool. No
// generic operation dispatcher exists here. Task update, reorder, planning,
// assignment and transition are out of scope for this module, and the parent
// Phase planning window is never mutated here.

import { z } from "npm:zod@4.4.3";
import { MCP_IDEMPOTENCY_KEY_SCHEMA } from "./idempotencyKeySchema.ts";

import { ApiHttpError } from "../../_shared/btpm-api/http.ts";
import {
  type ApiRateLimitStore,
  enforceApiRateLimit,
} from "../../_shared/btpm-api/rateLimit.ts";
import type { ApiRateLimitProfileResolver } from "../../_shared/btpm-api/supabaseRateLimit.ts";
import {
  type ApiV1TaskPriority,
  type ApiV1TaskStatus,
  type ApiV1TaskType,
  parseApiV1CreateTaskBody,
  TASK_CREATE_ROUTE,
} from "../../_shared/btpm-api/routes/tasks.ts";
import type { ApiV1CreateTaskSuccessResult } from "../../_shared/btpm-api/supabaseTask.ts";
import type { McpTrustedExecutionContext } from "./buildMcpExecutionContext.ts";
import {
  buildMcpMutationExecutionContext,
  IdempotencyValidationError,
  McpMutationControlError,
  requireMcpMutationConfirmation,
} from "./mutationControl.ts";
import type { McpV1CreateTaskExecutor } from "./taskCreateMutationExecutor.ts";

/** Advertised MCP tool name for the canonical `tasks.create`. */
export const MCP_TASK_CREATE_TOOL_NAME = "btpm_create_task";

/**
 * Strict MCP transport guard. It is presentation only: canonical validation
 * remains authoritative for every business rule (UUID form, text
 * canonicalization, date validity and ranges, estimated-hours bounds,
 * sort-order bounds and all optional-field defaults).
 */
export const MCP_TASK_CREATE_TOOL_INPUT_SCHEMA = z.strictObject({
  phaseId: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  status: z
    .enum(["planned", "active", "completed", "on_hold", "cancelled"])
    .optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
  taskType: z
    .enum(["milestone", "deliverable", "work_item", "decision", "review"])
    .optional(),
  startDate: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Planned Task start date (YYYY-MM-DD). REQUIRED when the parent Project is baselined; the mutation is rejected with a Task-dates requirement otherwise.",
    ),
  dueDate: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Planned Task due date (YYYY-MM-DD). REQUIRED when the parent Project is baselined; the mutation is rejected with a Task-dates requirement otherwise.",
    ),
  estimatedHours: z.number().nullable().optional(),
  sortOrder: z.number().nullable().optional(),
  confirmation: z.boolean(),
  idempotencyKey: MCP_IDEMPOTENCY_KEY_SCHEMA,
});

/** The exact twelve approved MCP argument names. */
export const MCP_TASK_CREATE_TOOL_ARGUMENT_NAMES: ReadonlyArray<string> =
  Object.freeze([
    "phaseId",
    "name",
    "description",
    "status",
    "priority",
    "taskType",
    "startDate",
    "dueDate",
    "estimatedHours",
    "sortOrder",
    "confirmation",
    "idempotencyKey",
  ]);

/** Already schema-validated (untrusted) MCP tool arguments. */
export interface McpTaskCreateToolArguments {
  readonly phaseId: string;
  readonly name: string;
  readonly description?: string | null;
  readonly status?: ApiV1TaskStatus;
  readonly priority?: ApiV1TaskPriority;
  readonly taskType?: ApiV1TaskType;
  readonly startDate?: string | null;
  readonly dueDate?: string | null;
  readonly estimatedHours?: number | null;
  readonly sortOrder?: number | null;
  readonly confirmation: boolean;
  readonly idempotencyKey: string;
}

/**
 * Bounded failure categories this tool may disclose.
 *
 * `phase_window_extension_required` is deliberately distinct from
 * `confirmation_required`: the MCP literal confirmation gate and the canonical
 * parent-Phase planning-window constraint are different controls.
 */
export type McpTaskCreateToolErrorCategory =
  | "confirmation_required"
  | "phase_window_extension_required"
  | "task_dates_required"
  | "invalid_arguments"
  | "not_authorized"
  | "rate_limited"
  | "idempotency_conflict"
  | "idempotency_pending"
  | "unavailable";

/** The only external messages a failure may disclose. */
export const MCP_TASK_CREATE_TOOL_ERROR_MESSAGES: Readonly<
  Record<McpTaskCreateToolErrorCategory, string>
> = Object.freeze({
  confirmation_required: "Explicit confirmation is required for this mutation.",
  phase_window_extension_required:
    "Task dates fall outside the Phase planning window. Extend the Phase planning window, then retry with a new idempotency key.",
  task_dates_required:
    "Start Date and Due Date are required when creating a Task in a baselined Project. Read the parent Phase planning dates and retry with a new idempotency key.",
  invalid_arguments: "Invalid arguments.",
  not_authorized: "Not authorized to create this Task.",
  rate_limited: "Rate limit exceeded. Try again later.",
  idempotency_conflict:
    "This idempotency key was already used with a different request.",
  idempotency_pending:
    "An identical request is still in progress. Retry shortly.",
  unavailable: "BTPM Task creation is temporarily unavailable.",
});

/** Bounded successful tool payload. No Task narrative is returned. */
export interface McpTaskCreateToolPayload {
  readonly outcome: "applied" | "replayed";
  readonly taskId: string;
  readonly projectId: string;
  readonly phaseId: string;
  readonly status: ApiV1TaskStatus;
  readonly priority: ApiV1TaskPriority;
  readonly taskType: ApiV1TaskType;
  readonly startDate: string | null;
  readonly dueDate: string | null;
  readonly estimatedHours: number | null;
  readonly sortOrder: number;
  readonly isArchived: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly shiftedSiblingCount: number | null;
}

/** Bounded tool result union. */
export type McpTaskCreateToolResult =
  | { readonly ok: true; readonly payload: McpTaskCreateToolPayload }
  | {
    readonly ok: false;
    readonly category: McpTaskCreateToolErrorCategory;
  };

/** The bounded executor the MCP server factory would be allowed to know. */
export type McpTaskCreateToolExecutor = (
  args: McpTaskCreateToolArguments,
) => Promise<McpTaskCreateToolResult>;

/** Per-request dependencies. No Supabase client, no service role, no env. */
export interface McpTaskCreateToolDependencies {
  /** The original authenticated MCP request; the writer owns it. */
  readonly request: Request;
  readonly execution: McpTrustedExecutionContext;
  readonly writer: McpV1CreateTaskExecutor;
  readonly rateLimitProfileResolver: ApiRateLimitProfileResolver;
  readonly rateLimitStore: ApiRateLimitStore;
  now(): number;
}

function categorize(error: unknown): McpTaskCreateToolErrorCategory {
  if (error instanceof McpMutationControlError) {
    if (error.code === "mcp_mutation_confirmation_required") {
      return "confirmation_required";
    }
    // A malformed trusted context is internal: never disclose which invariant.
    return "unavailable";
  }
  if (error instanceof z.ZodError) {
    return "invalid_arguments";
  }
  if (error instanceof IdempotencyValidationError) {
    return "invalid_arguments";
  }
  if (error instanceof ApiHttpError) {
    if (error.code === "rate_limit_exceeded") return "rate_limited";
    if (error.code === "not_authorized") return "not_authorized";
    if (error.code === "invalid_request") return "invalid_arguments";
  }
  return "unavailable";
}

function mapNegativeOutcome(
  outcome:
    | "invalid"
    | "not_authorized"
    | "idempotency_conflict"
    | "idempotency_pending",
): McpTaskCreateToolErrorCategory {
  switch (outcome) {
    case "invalid":
      return "invalid_arguments";
    case "not_authorized":
      return "not_authorized";
    case "idempotency_conflict":
      return "idempotency_conflict";
    case "idempotency_pending":
      return "idempotency_pending";
  }
}

function toBoundedPayload(
  result: ApiV1CreateTaskSuccessResult,
): McpTaskCreateToolPayload {
  return Object.freeze({
    outcome: result.outcome,
    taskId: result.taskId,
    projectId: result.projectId,
    phaseId: result.phaseId,
    status: result.status,
    priority: result.priority,
    taskType: result.taskType,
    startDate: result.startDate,
    dueDate: result.dueDate,
    estimatedHours: result.estimatedHours,
    sortOrder: result.sortOrder,
    isArchived: result.isArchived,
    createdAt: result.createdAt,
    updatedAt: result.updatedAt,
    shiftedSiblingCount: result.shiftedSiblingCount,
  });
}

/**
 * Creates the per-request `tasks.create` MCP tool executor.
 *
 * Execution order:
 *   1. the strict MCP argument envelope is validated;
 *   2. literal confirmation is required;
 *   3. a business-only object is built (no confirmation, no idempotency key,
 *      no identity, scope or provenance field);
 *   4. it is validated through `parseApiV1CreateTaskBody`, which alone owns
 *      canonical validation and defaults;
 *   5. the canonical mutation execution context is built (canonical
 *      idempotency validation + canonical payload hash over the canonical
 *      body only);
 *   6. the canonical rate-limit profile is resolved for `tasks.create`;
 *   7. the canonical atomic rate limit is consumed;
 *   8. the accepted caller-bound writer is invoked exactly once, with no retry.
 *
 * The canonical `confirmation_required` / `extend_phase_window_required`
 * writer result is NOT a successful mutation and is NOT the ordinary MCP
 * confirmation category: it maps to `phase_window_extension_required`. No
 * Phase planning mutation, no date rewrite and no retry happens here; the
 * database persists that safe result under idempotency, so an intentional
 * retry requires a new idempotency key.
 */
export function createMcpTaskCreateToolExecutor(
  dependencies: McpTaskCreateToolDependencies,
): McpTaskCreateToolExecutor {
  return async function executeTaskCreate(
    args: McpTaskCreateToolArguments,
  ): Promise<McpTaskCreateToolResult> {
    try {
      // 1. Strict MCP argument envelope.
      const parsedArgs = MCP_TASK_CREATE_TOOL_INPUT_SCHEMA.parse(args);

      // 2. Literal confirmation, before any rate-limit consumption or writer.
      requireMcpMutationConfirmation(parsedArgs.confirmation);

      // 3. Business-only object.
      const businessInput: Record<string, unknown> = {
        phaseId: parsedArgs.phaseId,
        name: parsedArgs.name,
      };
      if (parsedArgs.description !== undefined) {
        businessInput.description = parsedArgs.description;
      }
      if (parsedArgs.status !== undefined) {
        businessInput.status = parsedArgs.status;
      }
      if (parsedArgs.priority !== undefined) {
        businessInput.priority = parsedArgs.priority;
      }
      if (parsedArgs.taskType !== undefined) {
        businessInput.taskType = parsedArgs.taskType;
      }
      if (parsedArgs.startDate !== undefined) {
        businessInput.startDate = parsedArgs.startDate;
      }
      if (parsedArgs.dueDate !== undefined) {
        businessInput.dueDate = parsedArgs.dueDate;
      }
      if (parsedArgs.estimatedHours !== undefined) {
        businessInput.estimatedHours = parsedArgs.estimatedHours;
      }
      if (parsedArgs.sortOrder !== undefined) {
        businessInput.sortOrder = parsedArgs.sortOrder;
      }

      // 4. Canonical business validation and defaulting.
      const canonicalBody = parseApiV1CreateTaskBody(businessInput);

      // 5. Canonical mutation execution context (idempotency + payload hash).
      const mutationContext = await buildMcpMutationExecutionContext(
        dependencies.execution,
        parsedArgs.idempotencyKey,
        canonicalBody,
      );

      // 6. Canonical rate-limit profile.
      const profile = await dependencies.rateLimitProfileResolver.resolve(
        dependencies.execution.apiClientId,
        TASK_CREATE_ROUTE.id,
      );

      // 7. Canonical atomic rate-limit consumption.
      await enforceApiRateLimit(
        {
          apiClientId: dependencies.execution.apiClientId,
          userId: dependencies.execution.executingUserId,
          routeId: TASK_CREATE_ROUTE.id,
        },
        profile,
        { store: dependencies.rateLimitStore, now: () => dependencies.now() },
      );

      // 8. Accepted caller-bound writer, exactly once.
      const result = await dependencies.writer(
        dependencies.request,
        canonicalBody,
        mutationContext,
      );

      if (result.ok) {
        return Object.freeze({
          ok: true as const,
          payload: toBoundedPayload(result),
        });
      }

      // API-Q Task Create Contract Parity Correction TCC-1 — the canonical
      // baselined-Project Task date requirement is actionable, not generic.
      if (
        result.outcome === "invalid" && "code" in result &&
        result.code === "task_dates_required"
      ) {
        return Object.freeze({
          ok: false as const,
          category: "task_dates_required" as const,
        });
      }

      if (result.outcome === "confirmation_required") {
        return Object.freeze({
          ok: false as const,
          category: "phase_window_extension_required" as const,
        });
      }

      return Object.freeze({
        ok: false as const,
        category: mapNegativeOutcome(result.outcome),
      });
    } catch (error) {
      // Only a bounded category escapes: no SQLSTATE, database message, stack,
      // policy reason, token, identity or internal function name.
      return Object.freeze({ ok: false as const, category: categorize(error) });
    }
  };
}
