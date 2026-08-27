// API-Q Task Create Step 3 — focused guard for the Task-create MCP mutation
// tool control composition. Behavioural (in-process fakes) + static source
// guards. No network, no database, no Edge invocation, no service-role key.
//
// Scope: control/composition only.

import {
  assert,
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  createMcpTaskCreateToolExecutor,
  MCP_TASK_CREATE_TOOL_ARGUMENT_NAMES,
  MCP_TASK_CREATE_TOOL_ERROR_MESSAGES,
  MCP_TASK_CREATE_TOOL_INPUT_SCHEMA,
  MCP_TASK_CREATE_TOOL_NAME,
} from "../../functions/btpm-mcp/mcp/taskCreateMutationTool.ts";
import { hashCanonicalPayload } from "../../functions/_shared/btpm-api/idempotency.ts";
import {
  parseApiV1CreateTaskBody,
  TASK_CREATE_ROUTE,
} from "../../functions/_shared/btpm-api/routes/tasks.ts";

const TOOL_URL = new URL(
  "../../functions/btpm-mcp/mcp/taskCreateMutationTool.ts",
  import.meta.url,
);
const toolSource = await Deno.readTextFile(TOOL_URL);

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const PHASE_ID = "22222222-2222-4222-8222-222222222222";
const TASK_ID = "55555555-5555-4555-8555-555555555555";
const API_CLIENT_ID = "44444444-4444-4444-8444-444444444444";
const USER_ID = "33333333-3333-4333-8333-333333333333";

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

const validArgs = Object.freeze({
  phaseId: PHASE_ID,
  name: "Prepare cutover checklist",
  confirmation: true,
  idempotencyKey: "idem-key-task-create",
});

const successResult = Object.freeze({
  ok: true,
  outcome: "applied",
  taskId: TASK_ID,
  projectId: PROJECT_ID,
  phaseId: PHASE_ID,
  status: "planned",
  priority: "medium",
  taskType: "work_item",
  startDate: null,
  dueDate: null,
  estimatedHours: null,
  sortOrder: 1,
  isArchived: false,
  createdAt: "2026-08-16T05:00:00.000Z",
  updatedAt: "2026-08-16T05:00:00.000Z",
  shiftedSiblingCount: 0,
});

const phaseWindowResult = Object.freeze({
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

interface Recorder {
  readonly profileCalls: Array<{ clientId: string; routeId: string }>;
  // deno-lint-ignore no-explicit-any
  readonly consumeCalls: any[];
  readonly writerCalls: Array<{
    request: Request;
    // deno-lint-ignore no-explicit-any
    body: any;
    // deno-lint-ignore no-explicit-any
    context: any;
  }>;
  readonly order: string[];
}

function buildHarness(
  // deno-lint-ignore no-explicit-any
  writerResult: any = successResult,
  options: { rateLimitThrows?: unknown; writerThrows?: unknown } = {},
) {
  const recorder: Recorder = {
    profileCalls: [],
    consumeCalls: [],
    writerCalls: [],
    order: [],
  };
  const request = new Request("https://example.test/mcp", {
    method: "POST",
    headers: { Authorization: "Bearer token-value" },
  });

  const executor = createMcpTaskCreateToolExecutor({
    request,
    execution: trustedExecution,
    // deno-lint-ignore no-explicit-any
    writer: (async (req: Request, body: any, context: any) => {
      recorder.order.push("writer");
      recorder.writerCalls.push({ request: req, body, context });
      if (options.writerThrows) throw options.writerThrows;
      return writerResult;
      // deno-lint-ignore no-explicit-any
    }) as any,
    rateLimitProfileResolver: {
      resolve: (clientId: string, routeId: string) => {
        recorder.order.push("profile");
        recorder.profileCalls.push({ clientId, routeId });
        return Promise.resolve({ limit: 100, windowSeconds: 60 });
      },
      // deno-lint-ignore no-explicit-any
    } as any,
    rateLimitStore: {
      // deno-lint-ignore no-explicit-any
      consume: (input: any) => {
        recorder.order.push("rate_limit");
        recorder.consumeCalls.push(input);
        if (options.rateLimitThrows) throw options.rateLimitThrows;
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

  return { executor, recorder, request };
}

// ---------------------------------------------------------------------------
// A. Tool envelope
// ---------------------------------------------------------------------------

Deno.test("A1/A2: tool name and the exact twelve argument names", () => {
  assertEquals(MCP_TASK_CREATE_TOOL_NAME, "btpm_create_task");
  assertEquals([...MCP_TASK_CREATE_TOOL_ARGUMENT_NAMES], [
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
  assertEquals(MCP_TASK_CREATE_TOOL_ARGUMENT_NAMES.length, 12);
  assertEquals(
    Object.keys(MCP_TASK_CREATE_TOOL_INPUT_SCHEMA.shape).sort(),
    [...MCP_TASK_CREATE_TOOL_ARGUMENT_NAMES].sort(),
  );
});

Deno.test("A3/A4: the schema is strict and rejects unknown fields", () => {
  const ok = MCP_TASK_CREATE_TOOL_INPUT_SCHEMA.safeParse(validArgs);
  assert(ok.success);
  for (
    const key of ["nickname", "extra", "taskId", "projectId", "targetEndDate"]
  ) {
    const result = MCP_TASK_CREATE_TOOL_INPUT_SCHEMA.safeParse({
      ...validArgs,
      [key]: "x",
    });
    assertFalse(result.success, `unknown key accepted: ${key}`);
  }
});

Deno.test("A5: only canonical Task vocabularies are accepted", () => {
  for (
    const status of [
      "planned",
      "active",
      "completed",
      "on_hold",
      "cancelled",
    ]
  ) {
    assert(
      MCP_TASK_CREATE_TOOL_INPUT_SCHEMA.safeParse({ ...validArgs, status })
        .success,
    );
  }
  for (const priority of ["low", "medium", "high", "critical"]) {
    assert(
      MCP_TASK_CREATE_TOOL_INPUT_SCHEMA.safeParse({ ...validArgs, priority })
        .success,
    );
  }
  for (
    const taskType of [
      "milestone",
      "deliverable",
      "work_item",
      "decision",
      "review",
    ]
  ) {
    assert(
      MCP_TASK_CREATE_TOOL_INPUT_SCHEMA.safeParse({ ...validArgs, taskType })
        .success,
    );
  }
  for (
    const patch of [
      { status: "in_progress" },
      { priority: "urgent" },
      { taskType: "epic" },
    ]
  ) {
    assertFalse(
      MCP_TASK_CREATE_TOOL_INPUT_SCHEMA.safeParse({ ...validArgs, ...patch })
        .success,
      `accepted non-canonical vocabulary: ${JSON.stringify(patch)}`,
    );
  }
});

// ---------------------------------------------------------------------------
// B. Confirmation gate
// ---------------------------------------------------------------------------

Deno.test("B1: confirmation=false fails before rate limit and writer", async () => {
  for (const confirmation of [false, undefined, null, "true", 1]) {
    const { executor, recorder } = buildHarness();
    // deno-lint-ignore no-explicit-any
    const result = await executor({ ...validArgs, confirmation } as any);
    assert(!result.ok);
    assert(
      result.category === "confirmation_required" ||
        result.category === "invalid_arguments",
      `unexpected category for ${String(confirmation)}: ${result.category}`,
    );
    assertEquals(recorder.profileCalls.length, 0);
    assertEquals(recorder.consumeCalls.length, 0);
    assertEquals(recorder.writerCalls.length, 0);
  }
  const { executor, recorder } = buildHarness();
  const result = await executor({ ...validArgs, confirmation: false });
  assert(!result.ok);
  assertEquals(result.category, "confirmation_required");
  assertEquals(recorder.order.length, 0);
});

// ---------------------------------------------------------------------------
// C. Canonical business parsing / defaults
// ---------------------------------------------------------------------------

Deno.test("C1: business object excludes confirmation and idempotencyKey", async () => {
  const { executor, recorder } = buildHarness();
  const result = await executor(validArgs);
  assert(result.ok);
  const body = recorder.writerCalls[0].body as Record<string, unknown>;
  assertFalse("confirmation" in body);
  assertFalse("idempotencyKey" in body);
  for (
    const forbidden of [
      "apiClientId",
      "oauthClientId",
      "requestId",
      "correlationId",
      "sourceChannel",
      "payloadHash",
      "executingUserId",
      "delegationMode",
      "policyVersionId",
    ]
  ) {
    assertFalse(forbidden in body, `leaked control field: ${forbidden}`);
  }
});

Deno.test("C2: omitted optional values receive canonical parser defaults", async () => {
  const { executor, recorder } = buildHarness();
  await executor(validArgs);
  const body = recorder.writerCalls[0].body;
  assertEquals(body, parseApiV1CreateTaskBody({
    phaseId: PHASE_ID,
    name: "Prepare cutover checklist",
  }));
  assertEquals(body.description, null);
  assertEquals(body.status, "planned");
  assertEquals(body.priority, "medium");
  assertEquals(body.taskType, "work_item");
  assertEquals(body.startDate, null);
  assertEquals(body.dueDate, null);
  assertEquals(body.estimatedHours, null);
  assertEquals(body.sortOrder, null);
});

Deno.test("C3: canonical parser rejects invalid ids, names, dates, ranges, hours and sort order", async () => {
  const invalidCases: Array<Record<string, unknown>> = [
    { phaseId: "not-a-uuid" },
    { name: "" },
    { startDate: "2026-13-01" },
    { dueDate: "16/08/2026" },
    { startDate: "2026-09-30", dueDate: "2026-01-01" },
    { estimatedHours: -1 },
    { estimatedHours: 1_000_000_000 },
    { sortOrder: -1 },
    { sortOrder: 1.5 },
    { sortOrder: 10_000_000 },
  ];
  for (const patch of invalidCases) {
    const { executor, recorder } = buildHarness();
    // deno-lint-ignore no-explicit-any
    const result = await executor({ ...validArgs, ...patch } as any);
    assert(!result.ok, `accepted invalid patch: ${JSON.stringify(patch)}`);
    assertEquals(
      result.category,
      "invalid_arguments",
      `wrong category for ${JSON.stringify(patch)}`,
    );
    assertEquals(recorder.writerCalls.length, 0);
    assertEquals(recorder.consumeCalls.length, 0);
    assertEquals(recorder.profileCalls.length, 0);
  }
});

// ---------------------------------------------------------------------------
// D. Idempotency + payload hash
// ---------------------------------------------------------------------------

Deno.test("D1: the payload hash covers the canonical body only", async () => {
  const { executor, recorder } = buildHarness();
  await executor({
    ...validArgs,
    description: "Cutover prep",
    startDate: "2026-01-01",
    dueDate: "2026-06-30",
  });
  const canonicalBody = recorder.writerCalls[0].body;
  const context = recorder.writerCalls[0].context;
  assertEquals(context.payloadHash, await hashCanonicalPayload(canonicalBody));
  assertEquals(context.idempotencyKey, validArgs.idempotencyKey);
});

Deno.test("D2: confirmation and idempotencyKey are not hashed", async () => {
  const { executor, recorder } = buildHarness();
  await executor(validArgs);
  const hash = recorder.writerCalls[0].context.payloadHash;

  const { executor: e2, recorder: r2 } = buildHarness();
  await e2({ ...validArgs, idempotencyKey: "different-key" });
  assertEquals(r2.writerCalls[0].context.payloadHash, hash);

  const withConfirmation = await hashCanonicalPayload({
    ...recorder.writerCalls[0].body,
    confirmation: true,
  });
  assertFalse(hash === withConfirmation);
  const withKey = await hashCanonicalPayload({
    ...recorder.writerCalls[0].body,
    idempotencyKey: validArgs.idempotencyKey,
  });
  assertFalse(hash === withKey);
});

// ---------------------------------------------------------------------------
// E. Rate limit + single writer invocation
// ---------------------------------------------------------------------------

Deno.test("E1: rate limiting uses exactly tasks.create", async () => {
  const { executor, recorder } = buildHarness();
  await executor(validArgs);
  assertEquals(TASK_CREATE_ROUTE.id, "tasks.create");
  assertEquals(recorder.profileCalls, [{
    clientId: API_CLIENT_ID,
    routeId: "tasks.create",
  }]);
  assertEquals(recorder.consumeCalls.length, 1);
  const consumed = recorder.consumeCalls[0];
  assertEquals(consumed.apiClientId ?? consumed.clientId, API_CLIENT_ID);
  assert(JSON.stringify(consumed).includes("tasks.create"));
  assert(JSON.stringify(consumed).includes(USER_ID));
});

Deno.test("E2: the writer runs exactly once, after all controls", async () => {
  const { executor, recorder } = buildHarness();
  const result = await executor(validArgs);
  assert(result.ok);
  assertEquals(recorder.writerCalls.length, 1);
  assertEquals(recorder.order, ["profile", "rate_limit", "writer"]);
});

Deno.test("E3: rate-limit rejection stops before the writer", async () => {
  const { ApiHttpError } = await import(
    "../../functions/_shared/btpm-api/http.ts"
  );
  const { executor, recorder } = buildHarness(successResult, {
    rateLimitThrows: new ApiHttpError("rate_limit_exceeded"),
  });
  const result = await executor(validArgs);
  assert(!result.ok);
  assertEquals(result.category, "rate_limited");
  assertEquals(recorder.writerCalls.length, 0);
});

// ---------------------------------------------------------------------------
// F. Bounded success payload
// ---------------------------------------------------------------------------

Deno.test("F1: the success payload is bounded and has no name or description", async () => {
  const { executor } = buildHarness();
  const result = await executor({ ...validArgs, description: "Cutover prep" });
  assert(result.ok);
  assertEquals(Object.keys(result.payload), [
    "outcome",
    "taskId",
    "projectId",
    "phaseId",
    "status",
    "priority",
    "taskType",
    "startDate",
    "dueDate",
    "estimatedHours",
    "sortOrder",
    "isArchived",
    "createdAt",
    "updatedAt",
    "shiftedSiblingCount",
  ]);
  const serialized = JSON.stringify(result.payload);
  assertFalse(serialized.includes("Prepare cutover checklist"));
  assertFalse(serialized.includes("Cutover prep"));
  assertFalse(serialized.includes("idem-key-task-create"));
  for (
    const forbidden of [
      "name",
      "description",
      "idempotencyKey",
      "payloadHash",
      "requestId",
      "correlationId",
      "apiClientId",
      "oauthClientId",
      "policyVersionId",
      "sourceChannel",
      "delegationMode",
    ]
  ) {
    assertFalse(
      forbidden in (result.payload as unknown as Record<string, unknown>),
      `leaked field: ${forbidden}`,
    );
  }
});

Deno.test("F2: applied and replayed map identically except for outcome", async () => {
  const { executor: applied } = buildHarness(successResult);
  const a = await applied(validArgs);
  const { executor: replayed } = buildHarness({
    ...successResult,
    outcome: "replayed",
  });
  const r = await replayed(validArgs);
  assert(a.ok && r.ok);
  assertEquals(a.payload.outcome, "applied");
  assertEquals(r.payload.outcome, "replayed");
  assertEquals(
    { ...a.payload, outcome: null },
    { ...r.payload, outcome: null },
  );
});

// ---------------------------------------------------------------------------
// G. Phase planning-window category
// ---------------------------------------------------------------------------

Deno.test("G1: extend_phase_window_required maps to phase_window_extension_required", async () => {
  const { executor, recorder } = buildHarness(phaseWindowResult);
  const result = await executor({
    ...validArgs,
    startDate: "2026-07-01",
    dueDate: "2026-09-30",
  });
  assert(!result.ok);
  assertEquals(result.category, "phase_window_extension_required");
  // Distinct from the ordinary MCP confirmation gate.
  assertFalse(result.category === "confirmation_required");
  // No retry, no Phase mutation, no date rewrite.
  assertEquals(recorder.writerCalls.length, 1);
  assertEquals(recorder.writerCalls[0].body.startDate, "2026-07-01");
  assertEquals(recorder.writerCalls[0].body.dueDate, "2026-09-30");
  assertEquals(
    recorder.order.filter((entry) => entry === "writer").length,
    1,
  );
  // No Task narrative or date disclosure.
  assertFalse(JSON.stringify(result).includes("Prepare cutover checklist"));
  assertFalse(JSON.stringify(result).includes("2026-07-01"));
  assertFalse(JSON.stringify(result).includes("2026-09-30"));
});

Deno.test("G2: a replayed stored Phase-window confirmation gets the same category", async () => {
  // The wrapper normalizes the replayed stored confirmation result back to
  // `outcome: confirmation_required` with the same code.
  const { executor } = buildHarness({ ...phaseWindowResult });
  const result = await executor(validArgs);
  assert(!result.ok);
  assertEquals(result.category, "phase_window_extension_required");
});

Deno.test("G3: the bounded Phase-window message names the new-key requirement", () => {
  assertEquals(
    MCP_TASK_CREATE_TOOL_ERROR_MESSAGES.phase_window_extension_required,
    "Task dates fall outside the Phase planning window. Extend the Phase planning window, then retry with a new idempotency key.",
  );
});

// ---------------------------------------------------------------------------
// H. Other bounded failure mapping
// ---------------------------------------------------------------------------

Deno.test("H1: canonical negative outcomes map correctly", async () => {
  const cases: Array<[string, string]> = [
    ["invalid", "invalid_arguments"],
    ["not_authorized", "not_authorized"],
    ["idempotency_conflict", "idempotency_conflict"],
    ["idempotency_pending", "idempotency_pending"],
  ];
  for (const [outcome, category] of cases) {
    const { executor } = buildHarness({ ok: false, outcome });
    const result = await executor(validArgs);
    assert(!result.ok);
    assertEquals(result.category, category);
  }
});

Deno.test("H2: unexpected failures map to unavailable only", async () => {
  const { executor } = buildHarness(undefined, {
    writerThrows: new Error(
      "relation tasks does not exist (SQLSTATE 42P01) at pg_catalog",
    ),
  });
  const result = await executor(validArgs);
  assert(!result.ok);
  assertEquals(result.category, "unavailable");
  const serialized = JSON.stringify(result);
  assertFalse(serialized.includes("SQLSTATE"));
  assertFalse(serialized.includes("pg_catalog"));
});

Deno.test("H3: a malformed trusted context maps to unavailable", async () => {
  const executor = createMcpTaskCreateToolExecutor({
    request: new Request("https://example.test/mcp", { method: "POST" }),
    // deno-lint-ignore no-explicit-any
    execution: { ...trustedExecution, requestedUserId: "other-user" } as any,
    // deno-lint-ignore no-explicit-any
    writer: (() => Promise.resolve(successResult)) as any,
    rateLimitProfileResolver: {
      resolve: () => Promise.reject(new Error("x")),
      // deno-lint-ignore no-explicit-any
    } as any,
    // deno-lint-ignore no-explicit-any
    rateLimitStore: { consume: () => Promise.reject(new Error("x")) } as any,
    now: () => 1_700_000_000_000,
  });
  const result = await executor(validArgs);
  assert(!result.ok);
  assertEquals(result.category, "unavailable");
});

// TCC-1 added exactly one bounded category: `task_dates_required`.
Deno.test("H4: bounded messages are exactly the approved nine categories", () => {
  assertEquals(Object.keys(MCP_TASK_CREATE_TOOL_ERROR_MESSAGES).sort(), [
    "confirmation_required",
    "idempotency_conflict",
    "idempotency_pending",
    "invalid_arguments",
    "not_authorized",
    "phase_window_extension_required",
    "rate_limited",
    "task_dates_required",
    "unavailable",
  ]);
});

// ---------------------------------------------------------------------------
// I. Architecture / exposure
// ---------------------------------------------------------------------------

Deno.test("I1: no env, Supabase client, RPC, PMG, table, fetch or service-role code exists", () => {
  for (
    const forbidden of [
      ".rpc(",
      "mcp_v1_create_task",
      "api_v1_create_task",
      "apply_task_create",
      "pmg_",
      "createClient",
      "SERVICE_ROLE",
      "service_role",
      "Deno.env",
      "console.",
      "fetch(",
      ".from(",
      "setTimeout",
      "setInterval",
      "select ",
      "Bearer",
    ]
  ) {
    assertFalse(
      toolSource.includes(forbidden),
      `unexpected reference to ${forbidden}`,
    );
  }
});

Deno.test("I2: no generic dispatcher, registration or Phase mutation exists", () => {
  for (
    const forbidden of [
      "registerTool",
      "createBtpmMcpServer",
      "MCP_TOOL_REGISTRY",
      "exposedMcpTools",
      "operationId:",
      "dispatch(",
      "wrapperName",
      "functionName",
      "sourceChannel:",
      "serverFactory",
      "toolRegistry",
      "Deno.serve",
      "PHASE_UPDATE_ROUTE",
      "PHASE_PLANNING_ROUTE",
      "parseApiV1PlanPhaseBody",
      "btpm_plan_phase",
    ]
  ) {
    assertFalse(
      toolSource.includes(forbidden),
      `unexpected reference to ${forbidden}`,
    );
  }
});

Deno.test("I3: Task update, reorder, plan, assign and transition remain untouched", () => {
  for (
    const forbidden of [
      "TASK_UPDATE_ROUTE",
      "TASK_REORDER_ROUTE",
      "TASK_PLANNING_ROUTE",
      "TASK_ASSIGN_ROUTE",
      "TASK_TRANSITION_ROUTE",
      "parseApiV1UpdateTaskBody",
      "parseApiV1AssignTaskBody",
      "parseApiV1TransitionTaskBody",
      "expectedUpdatedAt",
      "btpm_update_task",
    ]
  ) {
    assertFalse(
      toolSource.includes(forbidden),
      `unexpected out-of-scope reference to ${forbidden}`,
    );
  }
});
