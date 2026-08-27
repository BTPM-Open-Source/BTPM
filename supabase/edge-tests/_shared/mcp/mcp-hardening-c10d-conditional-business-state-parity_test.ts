// MCP-HARDENING-C10D — Critical conditional business-state cross-family
// regression pack.
//
// Purpose: prove that the accepted SPECIAL business/state outcomes of the MCP
// mutation tools remain distinct from ordinary MCP transport confirmation,
// generic `invalid_arguments`, generic `unavailable`, ordinary success and
// stale/concurrency outcomes.
//
// Execution model: the REAL accepted MCP tool executors are invoked in-process
// with bounded stub writers / rate-limit dependencies. No network, no database,
// no Edge invocation, no service-role key. No business logic is re-implemented
// here, and no production helper exists for this pack.
//
// This pack is a cross-family closure regression ON TOP OF the existing focused
// family tests, which remain authoritative.

import {
  assert,
  assertEquals,
  assertFalse,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  createMcpPhaseCreateToolExecutor,
  MCP_PHASE_CREATE_TOOL_ERROR_MESSAGES,
} from "../../../functions/btpm-mcp/mcp/phaseCreateMutationTool.ts";
import {
  createMcpTaskCreateToolExecutor,
  MCP_TASK_CREATE_TOOL_ERROR_MESSAGES,
} from "../../../functions/btpm-mcp/mcp/taskCreateMutationTool.ts";
import { createMcpPhasePlanToolExecutor } from "../../../functions/btpm-mcp/mcp/phasePlanMutationTool.ts";
import { createMcpTaskPlanToolExecutor } from "../../../functions/btpm-mcp/mcp/taskPlanMutationTool.ts";
import { createMcpProjectTransitionToolExecutor } from "../../../functions/btpm-mcp/mcp/projectTransitionMutationTool.ts";
import {
  createMcpTaskTransitionToolExecutor,
  MCP_TASK_TRANSITION_TOOL_ERROR_MESSAGES,
} from "../../../functions/btpm-mcp/mcp/taskTransitionMutationTool.ts";

// ---------------------------------------------------------------------------
// Shared bounded fixtures
// ---------------------------------------------------------------------------

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const PHASE_ID = "22222222-2222-4222-8222-222222222222";
const TASK_ID = "33333333-3333-4333-8333-333333333333";
const API_CLIENT_ID = "44444444-4444-4444-8444-444444444444";
const USER_ID = "55555555-5555-4555-8555-555555555555";
const EXPECTED_UPDATED_AT = "2026-08-14T05:00:00.000Z";

const trustedExecution = Object.freeze({
  requestedUserId: USER_ID,
  executingUserId: USER_ID,
  apiClientId: API_CLIENT_ID,
  oauthClientId: "oauth-1",
  policyVersionId: "policy-1",
  requestId: "req-1",
  correlationId: "req-1",
  sourceChannel: "mcp" as const,
  sourceClientId: API_CLIENT_ID,
  delegationMode: "delegated_user" as const,
});

interface Recorder {
  // deno-lint-ignore no-explicit-any
  readonly writerCalls: any[];
  readonly order: string[];
}

/**
 * Builds a bounded harness around one real MCP tool factory. The stub writer
 * returns the supplied canonical result exactly once per invocation and records
 * every call, so writer-call count and ordering are observable.
 */
function harness<TArgs, TResult>(
  // deno-lint-ignore no-explicit-any
  factory: (dependencies: any) => (args: TArgs) => Promise<TResult>,
  // deno-lint-ignore no-explicit-any
  writerResult: any,
): { executor: (args: TArgs) => Promise<TResult>; recorder: Recorder } {
  const recorder: Recorder = { writerCalls: [], order: [] };
  const request = new Request("https://example.test/mcp", {
    method: "POST",
    headers: { Authorization: "Bearer token-value" },
  });

  const executor = factory({
    request,
    execution: trustedExecution,
    // deno-lint-ignore no-explicit-any
    writer: async (...writerArgs: any[]) => {
      recorder.order.push("writer");
      recorder.writerCalls.push(writerArgs);
      return await Promise.resolve(writerResult);
    },
    rateLimitProfileResolver: {
      resolve: () => {
        recorder.order.push("profile");
        return Promise.resolve({ limit: 100, windowSeconds: 60 });
      },
      // deno-lint-ignore no-explicit-any
    } as any,
    rateLimitStore: {
      consume: () => {
        recorder.order.push("rate_limit");
        return Promise.resolve({
          allowed: true,
          remaining: 99,
          resetAtEpochMs: 1_700_000_060_000,
        });
      },
      // deno-lint-ignore no-explicit-any
    } as any,
    now: () => 1_700_000_000_000,
  });

  return { executor, recorder };
}

/**
 * Fields that must never appear anywhere in an externally returned MCP result
 * unless they are part of an explicitly accepted bounded business-detail
 * contract (none of the results asserted below contain any of them).
 */
const FORBIDDEN_DISCLOSURE_FIELDS = [
  "sqlstate",
  "databaseMessage",
  "stack",
  "token",
  "userId",
  "tenantId",
  "organizationId",
  "workspaceId",
  "apiClientId",
  "serviceRole",
  "currentUpdatedAt",
] as const;

function assertBoundedDisclosure(result: unknown): void {
  const serialized = JSON.stringify(result);
  for (const field of FORBIDDEN_DISCLOSURE_FIELDS) {
    assertFalse(
      serialized.includes(field),
      `MCP result must not disclose ${field}: ${serialized}`,
    );
  }
}

/** Asserts the writer ran exactly once and no second/retry call happened. */
function assertSingleWriterCall(recorder: Recorder): void {
  assertEquals(recorder.writerCalls.length, 1);
  assertEquals(recorder.order.filter((step) => step === "writer").length, 1);
}

/** Asserts transport confirmation short-circuited before the writer. */
function assertNoWriterCall(recorder: Recorder): void {
  assertEquals(recorder.writerCalls.length, 0);
  assertFalse(recorder.order.includes("writer"));
  assertFalse(recorder.order.includes("rate_limit"));
  assertFalse(recorder.order.includes("profile"));
}

// Executable source of the six tools, comments removed, for the narrow
// no-retry / no-parent-mutation / no-reopen invariants that execution alone
// cannot express.
async function executableSource(moduleFile: string): Promise<string> {
  const text = await Deno.readTextFile(
    new URL(`../../../functions/btpm-mcp/mcp/${moduleFile}`, import.meta.url),
  );
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

const TOOL_MODULES = [
  "phaseCreateMutationTool.ts",
  "taskCreateMutationTool.ts",
  "phasePlanMutationTool.ts",
  "taskPlanMutationTool.ts",
  "projectTransitionMutationTool.ts",
  "taskTransitionMutationTool.ts",
] as const;

// ---------------------------------------------------------------------------
// A. Phase Create — two special conditional states
// ---------------------------------------------------------------------------

const phaseCreateArgs = Object.freeze({
  projectId: PROJECT_ID,
  name: "Realization",
  confirmation: true,
  idempotencyKey: "idem-key-c10d-phase-create",
});

Deno.test("C10D A1: baselined-Project Phase dates remain phase_dates_required", async () => {
  const { executor, recorder } = harness(createMcpPhaseCreateToolExecutor, {
    ok: false,
    outcome: "invalid",
    code: "phase_dates_required",
  });
  const result = await executor({ ...phaseCreateArgs });
  assertEquals(result, { ok: false, category: "phase_dates_required" });
  for (
    const other of [
      "invalid_arguments",
      "confirmation_required",
      "project_window_extension_required",
      "unavailable",
    ]
  ) {
    assertNotEquals((result as { category: string }).category, other);
  }
  assertSingleWriterCall(recorder);
  assertBoundedDisclosure(result);
  assert(
    MCP_PHASE_CREATE_TOOL_ERROR_MESSAGES.phase_dates_required.length > 0,
  );
});

Deno.test("C10D A2: Phase Create Project-window extension is not transport confirmation", async () => {
  const { executor, recorder } = harness(createMcpPhaseCreateToolExecutor, {
    ok: false,
    outcome: "confirmation_required",
    code: "extend_project_window_required",
    projectId: PROJECT_ID,
    projectStartDate: "2026-01-01",
    projectTargetEndDate: "2026-06-30",
    requestedPhaseStartDate: "2026-07-01",
    requestedPhaseTargetEndDate: "2026-09-30",
    requiredProjectStartDate: "2026-01-01",
    requiredProjectTargetEndDate: "2026-09-30",
  });
  const result = await executor({ ...phaseCreateArgs });
  assertEquals(result, {
    ok: false,
    category: "project_window_extension_required",
  });
  assertNotEquals(
    (result as { category: string }).category,
    "confirmation_required",
  );
  assertSingleWriterCall(recorder);
  assertBoundedDisclosure(result);
});

Deno.test("C10D A3: Phase Create transport confirmation stays separate and pre-writer", async () => {
  const { executor, recorder } = harness(createMcpPhaseCreateToolExecutor, {
    ok: true,
  });
  const result = await executor({ ...phaseCreateArgs, confirmation: false });
  assertEquals(result, { ok: false, category: "confirmation_required" });
  assertNoWriterCall(recorder);
  assertBoundedDisclosure(result);
});

// ---------------------------------------------------------------------------
// B. Task Create — two special conditional states
// ---------------------------------------------------------------------------

const taskCreateArgs = Object.freeze({
  phaseId: PHASE_ID,
  name: "Prepare cutover checklist",
  confirmation: true,
  idempotencyKey: "idem-key-c10d-task-create",
});

Deno.test("C10D B1: baselined-Project Task dates remain task_dates_required", async () => {
  const { executor, recorder } = harness(createMcpTaskCreateToolExecutor, {
    ok: false,
    outcome: "invalid",
    code: "task_dates_required",
  });
  const result = await executor({ ...taskCreateArgs });
  assertEquals(result, { ok: false, category: "task_dates_required" });
  assertNotEquals((result as { category: string }).category, "invalid_arguments");
  assertSingleWriterCall(recorder);
  assertBoundedDisclosure(result);
  assert(MCP_TASK_CREATE_TOOL_ERROR_MESSAGES.task_dates_required.length > 0);
});

Deno.test("C10D B2: Task Create Phase-window extension is not transport confirmation", async () => {
  const { executor, recorder } = harness(createMcpTaskCreateToolExecutor, {
    ok: false,
    outcome: "confirmation_required",
    code: "extend_phase_window_required",
    projectId: PROJECT_ID,
    phaseId: PHASE_ID,
    phaseStartDate: "2026-01-01",
    phaseTargetEndDate: "2026-06-30",
    requestedTaskStartDate: "2026-07-01",
    requestedTaskDueDate: "2026-09-30",
    requiredPhaseStartDate: "2026-01-01",
    requiredPhaseTargetEndDate: "2026-09-30",
  });
  const result = await executor({ ...taskCreateArgs });
  assertEquals(result, {
    ok: false,
    category: "phase_window_extension_required",
  });
  assertNotEquals(
    (result as { category: string }).category,
    "confirmation_required",
  );
  assertSingleWriterCall(recorder);
  assertBoundedDisclosure(result);
});

Deno.test("C10D B3: Task Create transport confirmation stays separate and pre-writer", async () => {
  const { executor, recorder } = harness(createMcpTaskCreateToolExecutor, {
    ok: true,
  });
  const result = await executor({ ...taskCreateArgs, confirmation: false });
  assertEquals(result, { ok: false, category: "confirmation_required" });
  assertNoWriterCall(recorder);
});

// ---------------------------------------------------------------------------
// C. Phase Plan — business confirmation vs transport confirmation
// ---------------------------------------------------------------------------

const phasePlanArgs = Object.freeze({
  phaseId: PHASE_ID,
  expectedUpdatedAt: EXPECTED_UPDATED_AT,
  startDate: "2026-09-01",
  targetEndDate: "2026-10-15",
  confirmParentExtension: false,
  confirmation: true,
  idempotencyKey: "idem-key-c10d-phase-plan",
});

const PHASE_PLAN_WINDOW_DETAIL_KEYS = [
  "projectId",
  "projectCurrentStart",
  "projectCurrentTargetEnd",
  "projectProposedStart",
  "projectProposedTargetEnd",
  "requestedPhaseStart",
  "requestedPhaseEnd",
] as const;

Deno.test("C10D C1: Phase Plan transport confirmation precedes the writer", async () => {
  const { executor, recorder } = harness(createMcpPhasePlanToolExecutor, {
    ok: true,
  });
  const result = await executor({ ...phasePlanArgs, confirmation: false });
  assertEquals(result, { ok: false, category: "confirmation_required" });
  assertNoWriterCall(recorder);
});

Deno.test("C10D C2: Phase Plan Project-window confirmation is bounded and distinct", async () => {
  const { executor, recorder } = harness(createMcpPhasePlanToolExecutor, {
    ok: false,
    outcome: "confirmation_required",
    code: "extend_project_window_required",
    projectId: PROJECT_ID,
    projectCurrentStart: "2026-08-01",
    projectCurrentTargetEnd: "2026-10-01",
    projectProposedStart: "2026-08-01",
    projectProposedTargetEnd: "2026-10-15",
    requestedPhaseStart: "2026-09-01",
    requestedPhaseEnd: "2026-10-15",
  });
  const result = await executor({ ...phasePlanArgs });
  assert(!(result as { ok: boolean }).ok);
  const failure = result as unknown as {
    category: string;
    details: Record<string, unknown>;
  };
  assertEquals(failure.category, "project_window_extension_required");
  assertNotEquals(failure.category, "confirmation_required");
  assertEquals(
    Object.keys(failure.details).sort(),
    [...PHASE_PLAN_WINDOW_DETAIL_KEYS].sort(),
  );
  assertSingleWriterCall(recorder);
  assertBoundedDisclosure(result);
});

Deno.test("C10D C3: stale Phase planning remains stale_phase_planning without timestamp leak", async () => {
  const { executor, recorder } = harness(createMcpPhasePlanToolExecutor, {
    ok: false,
    outcome: "conflict",
    code: "stale_phase_planning",
    currentUpdatedAt: "2026-08-14T07:45:00.000Z",
  });
  const result = await executor({ ...phasePlanArgs });
  assertEquals(result, { ok: false, category: "stale_phase_planning" });
  assertSingleWriterCall(recorder);
  assertBoundedDisclosure(result);
});

// ---------------------------------------------------------------------------
// D. Task Plan — business confirmation vs transport confirmation
// ---------------------------------------------------------------------------

const taskPlanArgs = Object.freeze({
  taskId: TASK_ID,
  expectedUpdatedAt: EXPECTED_UPDATED_AT,
  startDate: "2026-09-01",
  dueDate: "2026-10-15",
  confirmParentExtension: false,
  confirmation: true,
  idempotencyKey: "idem-key-c10d-task-plan",
});

const TASK_PLAN_WINDOW_DETAIL_KEYS = [
  "taskId",
  "projectId",
  "phaseId",
  "phaseCurrentStart",
  "phaseCurrentTargetEnd",
  "phaseProposedStart",
  "phaseProposedTargetEnd",
  "requestedTaskStart",
  "requestedTaskDue",
] as const;

Deno.test("C10D D1: Task Plan transport confirmation precedes the writer", async () => {
  const { executor, recorder } = harness(createMcpTaskPlanToolExecutor, {
    ok: true,
  });
  const result = await executor({ ...taskPlanArgs, confirmation: false });
  assertEquals(result, { ok: false, category: "confirmation_required" });
  assertNoWriterCall(recorder);
});

Deno.test("C10D D2: Task Plan Phase-window confirmation is bounded and distinct", async () => {
  const { executor, recorder } = harness(createMcpTaskPlanToolExecutor, {
    ok: false,
    outcome: "confirmation_required",
    code: "extend_phase_window_required",
    taskId: TASK_ID,
    projectId: PROJECT_ID,
    phaseId: PHASE_ID,
    phaseCurrentStart: "2026-08-01",
    phaseCurrentTargetEnd: "2026-10-01",
    phaseProposedStart: "2026-08-01",
    phaseProposedTargetEnd: "2026-10-15",
    requestedTaskStart: "2026-09-01",
    requestedTaskDue: "2026-10-15",
  });
  const result = await executor({ ...taskPlanArgs });
  assert(!(result as { ok: boolean }).ok);
  const failure = result as unknown as {
    category: string;
    details: Record<string, unknown>;
  };
  assertEquals(failure.category, "phase_window_extension_required");
  assertNotEquals(failure.category, "confirmation_required");
  assertEquals(
    Object.keys(failure.details).sort(),
    [...TASK_PLAN_WINDOW_DETAIL_KEYS].sort(),
  );
  assertSingleWriterCall(recorder);
});

Deno.test("C10D D3: stale Task planning remains stale_task_planning without timestamp leak", async () => {
  const { executor, recorder } = harness(createMcpTaskPlanToolExecutor, {
    ok: false,
    outcome: "conflict",
    code: "stale_task_planning",
    currentUpdatedAt: "2026-08-14T07:45:00.000Z",
  });
  const result = await executor({ ...taskPlanArgs });
  assertEquals(result, { ok: false, category: "stale_task_planning" });
  assertSingleWriterCall(recorder);
  assertBoundedDisclosure(result);
});

// ---------------------------------------------------------------------------
// E. Project Transition — three distinct control states
// ---------------------------------------------------------------------------

const projectTransitionArgs = Object.freeze({
  projectId: PROJECT_ID,
  expectedUpdatedAt: "2026-08-16T10:20:30.123Z",
  targetStatus: "completed" as const,
  confirmWarnings: false,
  confirmation: true,
  idempotencyKey: "idem-key-c10d-project-transition",
});

const completionItem = Object.freeze({
  code: "open_tasks",
  message: "Open Tasks remain.",
  count: 3,
});

Deno.test("C10D E1: Project Transition transport confirmation is an ok:false transport state", async () => {
  const { executor, recorder } = harness(
    createMcpProjectTransitionToolExecutor,
    { ok: true },
  );
  const result = await executor({
    ...projectTransitionArgs,
    confirmation: false,
  });
  assertEquals(result, { ok: false, category: "confirmation_required" });
  assertNoWriterCall(recorder);
});

Deno.test("C10D E2: completion soft warnings remain an ok:true bounded business payload", async () => {
  const { executor, recorder } = harness(
    createMcpProjectTransitionToolExecutor,
    {
      ok: false,
      outcome: "confirmation_required",
      code: "completion_soft_warnings",
      projectId: PROJECT_ID,
      warnings: [completionItem],
      counts: { openRisks: 1 },
    },
  );
  const result = await executor({ ...projectTransitionArgs });
  assert((result as { ok: boolean }).ok);
  const payload = (result as unknown as { payload: Record<string, unknown> })
    .payload;
  assertEquals(payload.outcome, "confirmation_required");
  assertEquals(payload.code, "completion_soft_warnings");
  assertEquals(
    Object.keys(payload).sort(),
    ["code", "counts", "outcome", "projectId", "warnings"],
  );
  // It must never be flattened into the outer transport failure.
  const transport = await harness(createMcpProjectTransitionToolExecutor, {
    ok: true,
  }).executor({ ...projectTransitionArgs, confirmation: false });
  assertNotEquals(JSON.stringify(result), JSON.stringify(transport));
  assertSingleWriterCall(recorder);
  assertBoundedDisclosure(result);
});

Deno.test("C10D E3: hard completion block remains an ok:true bounded business payload", async () => {
  const { executor, recorder } = harness(
    createMcpProjectTransitionToolExecutor,
    {
      ok: false,
      outcome: "blocked",
      code: "completion_hard_blocked",
      projectId: PROJECT_ID,
      hardBlocks: [completionItem],
      warnings: [],
      counts: { openTasks: 3 },
    },
  );
  const result = await executor({ ...projectTransitionArgs });
  assert((result as { ok: boolean }).ok);
  const payload = (result as unknown as { payload: Record<string, unknown> })
    .payload;
  assertEquals(
    Object.keys(payload).sort(),
    ["code", "counts", "hardBlocks", "outcome", "projectId", "warnings"],
  );
  assertEquals(payload.outcome, "blocked");
  assertEquals(payload.code, "completion_hard_blocked");
  assertFalse("category" in (result as Record<string, unknown>));
  assertSingleWriterCall(recorder);
  assertBoundedDisclosure(result);
});

Deno.test("C10D E4: stale Project transition remains a distinct stale_project transport state", async () => {
  const { executor, recorder } = harness(
    createMcpProjectTransitionToolExecutor,
    {
      ok: false,
      outcome: "conflict",
      code: "stale_project",
      currentUpdatedAt: "2026-08-16T11:30:00.000Z",
    },
  );
  const result = await executor({ ...projectTransitionArgs });
  assertEquals(result, { ok: false, category: "stale_project" });
  assertSingleWriterCall(recorder);
  assertBoundedDisclosure(result);
});

// ---------------------------------------------------------------------------
// F. Task Transition — reopen boundary
// ---------------------------------------------------------------------------

const taskTransitionArgs = Object.freeze({
  taskId: TASK_ID,
  expectedUpdatedAt: "2026-01-15T10:20:30.123456Z",
  setActualStart: true,
  actualStartDate: "2026-01-10",
  setActualEnd: false,
  actualEndDate: null,
  status: "active" as const,
  confirmation: true,
  idempotencyKey: "idem-key-c10d-task-transition",
});

Deno.test("C10D F1: completed Task remains task_reopen_required", async () => {
  const { executor, recorder } = harness(createMcpTaskTransitionToolExecutor, {
    ok: false,
    outcome: "invalid",
    code: "task_reopen_required",
  });
  const result = await executor({ ...taskTransitionArgs });
  assertEquals(result, { ok: false, category: "task_reopen_required" });
  for (const other of ["invalid_arguments", "stale_task", "unavailable"]) {
    assertNotEquals((result as { category: string }).category, other);
  }
  assertSingleWriterCall(recorder);
  assertBoundedDisclosure(result);
  assert(
    MCP_TASK_TRANSITION_TOOL_ERROR_MESSAGES.task_reopen_required.length > 0,
  );
});

Deno.test("C10D F2: stale Task transition remains stale_task and distinct from reopen", async () => {
  const { executor, recorder } = harness(createMcpTaskTransitionToolExecutor, {
    ok: false,
    outcome: "conflict",
    code: "stale_task",
    currentUpdatedAt: "2026-02-02T08:00:00.000Z",
  });
  const result = await executor({ ...taskTransitionArgs });
  assertEquals(result, { ok: false, category: "stale_task" });
  assertNotEquals(
    (result as { category: string }).category,
    "task_reopen_required",
  );
  assertSingleWriterCall(recorder);
  assertBoundedDisclosure(result);
});

Deno.test("C10D F3: a code-less canonical invalid result remains invalid_arguments", async () => {
  const { executor, recorder } = harness(createMcpTaskTransitionToolExecutor, {
    ok: false,
    outcome: "invalid",
  });
  const result = await executor({ ...taskTransitionArgs });
  assertEquals(result, { ok: false, category: "invalid_arguments" });
  assertSingleWriterCall(recorder);
});

Deno.test("C10D F4: Task Transition transport confirmation precedes the writer", async () => {
  const { executor, recorder } = harness(createMcpTaskTransitionToolExecutor, {
    ok: true,
  });
  const result = await executor({ ...taskTransitionArgs, confirmation: false });
  assertEquals(result, { ok: false, category: "confirmation_required" });
  assertNoWriterCall(recorder);
});

// ---------------------------------------------------------------------------
// G. Cross-family: no automatic second mutation, retry or token refresh
// ---------------------------------------------------------------------------

Deno.test("C10D G1: no MCP mutation tool retries, reopens or mutates a parent object", async () => {
  for (const moduleFile of TOOL_MODULES) {
    const source = await executableSource(moduleFile);
    for (
      const forbidden of [
        "reopen(",
        "setTimeout",
        "for (let attempt",
        "while (",
        "crypto.randomUUID",
        "extendProject",
        "extendPhase",
        "confirmWarnings = true",
        "confirmParentExtension = true",
      ]
    ) {
      assertFalse(
        source.includes(forbidden),
        `${moduleFile} must not contain ${forbidden}`,
      );
    }
    // Exactly one writer invocation site exists per tool.
    const writerInvocations =
      source.match(/dependencies\.writer\(/g)?.length ?? 0;
    assertEquals(
      writerInvocations,
      1,
      `${moduleFile} must invoke the writer from exactly one site`,
    );
  }
});
