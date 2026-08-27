// API-Q Task Plan Step 3 — focused guard for the Task-planning MCP mutation
// tool control composition. Behavioural (in-process fakes) + static source
// guards. No network, no database, no Edge invocation, no service-role key.
//
// Scope: control/composition only.

import {
  assert,
  assertEquals,
  assertFalse,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  createMcpTaskPlanToolExecutor,
  MCP_TASK_PLAN_TOOL_ARGUMENT_NAMES,
  MCP_TASK_PLAN_TOOL_ERROR_MESSAGES,
  MCP_TASK_PLAN_TOOL_INPUT_SCHEMA,
  MCP_TASK_PLAN_TOOL_NAME,
} from "../../functions/btpm-mcp/mcp/taskPlanMutationTool.ts";
import { MCP_TOOL_REGISTRY } from "../../functions/btpm-mcp/mcp/toolRegistry.ts";
import { hashCanonicalPayload } from "../../functions/_shared/btpm-api/idempotency.ts";
import {
  buildApiV1PlanTaskIdempotencyPayload,
  parseApiV1PlanTaskBody,
  TASK_PLANNING_ROUTE,
} from "../../functions/_shared/btpm-api/routes/tasks.ts";
import { ApiHttpError } from "../../functions/_shared/btpm-api/http.ts";

const TOOL_URL = new URL(
  "../../functions/btpm-mcp/mcp/taskPlanMutationTool.ts",
  import.meta.url,
);
const toolSource = await Deno.readTextFile(TOOL_URL);

const TASK_ID = "33333333-3333-4333-8333-333333333333";
const PHASE_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const API_CLIENT_ID = "44444444-4444-4444-8444-444444444444";
const USER_ID = "55555555-5555-4555-8555-555555555555";
const EXPECTED_AT = "2026-08-14T05:00:00.000Z";

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

function validArgs(overrides: Record<string, unknown> = {}) {
  return {
    taskId: TASK_ID,
    expectedUpdatedAt: EXPECTED_AT,
    startDate: "2026-09-01",
    dueDate: "2026-10-15",
    confirmParentExtension: false,
    confirmation: true,
    idempotencyKey: "idem-key-task-plan",
    ...overrides,
  };
}

const successResult = Object.freeze({
  ok: true,
  outcome: "applied",
  taskId: TASK_ID,
  projectId: PROJECT_ID,
  phaseId: PHASE_ID,
  startDate: "2026-09-01",
  dueDate: "2026-10-15",
  updatedAt: "2026-08-14T06:30:00.000Z",
  phaseExtended: false,
  phaseStartDate: "2026-08-01",
  phaseTargetEndDate: "2026-12-31",
});

const phaseWindowResult = Object.freeze({
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

const staleResult = Object.freeze({
  ok: false,
  outcome: "conflict",
  code: "stale_task_planning",
  currentUpdatedAt: "2026-08-14T07:45:00.000Z",
});

interface Recorder {
  readonly profileCalls: Array<{ clientId: string; routeId: string }>;
  // deno-lint-ignore no-explicit-any
  readonly consumeCalls: any[];
  readonly writerCalls: Array<{
    request: Request;
    taskId: string;
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
  options: {
    rateLimitThrows?: unknown;
    writerThrows?: unknown;
    // deno-lint-ignore no-explicit-any
    execution?: any;
  } = {},
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

  const executor = createMcpTaskPlanToolExecutor({
    request,
    execution: options.execution ?? trustedExecution,
    writer: (async (
      req: Request,
      taskId: string,
      // deno-lint-ignore no-explicit-any
      body: any,
      // deno-lint-ignore no-explicit-any
      context: any,
    ) => {
      recorder.order.push("writer");
      recorder.writerCalls.push({ request: req, taskId, body, context });
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
// A/B/C. Tool envelope and strict schema
// ---------------------------------------------------------------------------

Deno.test("A: tool name is exactly btpm_plan_task and matches the registry", () => {
  assertEquals(MCP_TASK_PLAN_TOOL_NAME, "btpm_plan_task");
  const entry = MCP_TOOL_REGISTRY.find((e) => e.operationId === "tasks.plan");
  assert(entry, "tasks.plan registry entry missing");
  assertEquals(entry.toolName, MCP_TASK_PLAN_TOOL_NAME);
});

Deno.test("B: exactly the seven approved argument names, in canonical order", () => {
  assertEquals([...MCP_TASK_PLAN_TOOL_ARGUMENT_NAMES], [
    "taskId",
    "expectedUpdatedAt",
    "startDate",
    "dueDate",
    "confirmParentExtension",
    "confirmation",
    "idempotencyKey",
  ]);
  assertEquals(
    Object.keys(MCP_TASK_PLAN_TOOL_INPUT_SCHEMA.shape),
    [...MCP_TASK_PLAN_TOOL_ARGUMENT_NAMES],
  );
  assert(MCP_TASK_PLAN_TOOL_INPUT_SCHEMA.safeParse(validArgs()).success);
  for (const key of MCP_TASK_PLAN_TOOL_ARGUMENT_NAMES) {
    const partial: Record<string, unknown> = validArgs();
    delete partial[key];
    assertFalse(
      MCP_TASK_PLAN_TOOL_INPUT_SCHEMA.safeParse(partial).success,
      `missing key accepted: ${key}`,
    );
  }
});

Deno.test("C: unknown scope/provenance/control fields are rejected", () => {
  for (
    const key of [
      "extra",
      "tenantId",
      "organizationId",
      "workspaceId",
      "projectId",
      "phaseId",
      "sortOrder",
      "actorUserId",
      "userId",
      "apiClientId",
      "oauthClientId",
      "sourceChannel",
      "requestId",
      "correlationId",
      "payloadHash",
      "rateLimitProfile",
      "operation",
      "functionName",
      "confirmed",
      "force",
    ]
  ) {
    assertFalse(
      MCP_TASK_PLAN_TOOL_INPUT_SCHEMA.safeParse(validArgs({ [key]: "x" }))
        .success,
      `unknown key accepted: ${key}`,
    );
  }
});

Deno.test("C2: argument types are strict (no coercion, no aliases)", () => {
  assertFalse(
    MCP_TASK_PLAN_TOOL_INPUT_SCHEMA.safeParse(validArgs({ taskId: 1 })).success,
  );
  assertFalse(
    MCP_TASK_PLAN_TOOL_INPUT_SCHEMA.safeParse(
      validArgs({ confirmParentExtension: "true" }),
    ).success,
  );
  assertFalse(
    MCP_TASK_PLAN_TOOL_INPUT_SCHEMA.safeParse(
      validArgs({ expectedUpdatedAt: null }),
    ).success,
  );
  assert(
    MCP_TASK_PLAN_TOOL_INPUT_SCHEMA.safeParse(
      validArgs({ startDate: null, dueDate: null }),
    ).success,
  );
});

// ---------------------------------------------------------------------------
// D/E. Two independent confirmation controls
// ---------------------------------------------------------------------------

Deno.test("D: confirmation=false is rejected before hashing, rate limit and writer", async () => {
  const { executor, recorder } = buildHarness();
  const result = await executor(
    // deno-lint-ignore no-explicit-any
    validArgs({ confirmation: false }) as any,
  );
  assertEquals(result, { ok: false, category: "confirmation_required" });
  assertEquals(recorder.order, []);
  assertEquals(recorder.profileCalls.length, 0);
  assertEquals(recorder.consumeCalls.length, 0);
  assertEquals(recorder.writerCalls.length, 0);
});

Deno.test("D2: non-literal confirmation values never reach the writer", async () => {
  for (const value of ["true", "TRUE", 1, 0, null, undefined, {}, []]) {
    const { executor, recorder } = buildHarness();
    const result = await executor(
      // deno-lint-ignore no-explicit-any
      validArgs({ confirmation: value }) as any,
    );
    assertFalse(result.ok);
    assertEquals(recorder.writerCalls.length, 0);
    assertEquals(recorder.consumeCalls.length, 0);
    assertEquals(recorder.profileCalls.length, 0);
  }
});

Deno.test("E: confirmation=true never promotes confirmParentExtension", async () => {
  const { executor, recorder } = buildHarness();
  assert((await executor(validArgs() as never)).ok);
  assertEquals(recorder.writerCalls[0].body.confirmParentExtension, false);
  // No source-level derivation of one control from the other.
  assertFalse(/confirmParentExtension\s*[:=][^,\n]*confirmation/.test(
    toolSource,
  ));
  assertFalse(toolSource.includes("confirmParentExtension: true"));
});

// ---------------------------------------------------------------------------
// F/G/H/I/J. Canonical contract reuse and hashing
// ---------------------------------------------------------------------------

Deno.test("F/G/H: canonical Task path, body and idempotency-payload builders are reused", () => {
  assert(toolSource.includes("parseApiV1TaskPlanningPath"));
  assert(toolSource.includes('"/v1/tasks/"'));
  assert(toolSource.includes('"/planning"'));
  assert(toolSource.includes("parseApiV1PlanTaskBody"));
  assert(toolSource.includes("buildApiV1PlanTaskIdempotencyPayload"));
  assert(toolSource.includes("buildMcpMutationExecutionContext"));
  // No second UUID/date parser is defined locally.
  assertFalse(/[0-9a-f]\{8\}-/.test(toolSource));
});

Deno.test("F2: invalid taskId maps to invalid_arguments before the writer", async () => {
  for (const taskId of ["not-a-uuid", "", "  ", `${TASK_ID}/extra`]) {
    const { executor, recorder } = buildHarness();
    const result = await executor(
      // deno-lint-ignore no-explicit-any
      validArgs({ taskId }) as any,
    );
    assertEquals(result, { ok: false, category: "invalid_arguments" });
    assertEquals(recorder.writerCalls.length, 0);
    assertEquals(recorder.consumeCalls.length, 0);
  }
});

Deno.test("G2: invalid concurrency token, dates or ranges map to invalid_arguments", async () => {
  const cases = [
    { expectedUpdatedAt: "not-a-timestamp" },
    { startDate: "2026-13-01" },
    { dueDate: "15/10/2026" },
    { startDate: "2026-10-15", dueDate: "2026-09-01" },
  ];
  for (const override of cases) {
    const { executor, recorder } = buildHarness();
    const result = await executor(
      // deno-lint-ignore no-explicit-any
      validArgs(override) as any,
    );
    assertEquals(result, { ok: false, category: "invalid_arguments" });
    assertEquals(recorder.writerCalls.length, 0);
    assertEquals(recorder.consumeCalls.length, 0);
  }
});

Deno.test("I: canonical payload hash covers Task identity and business fields only", async () => {
  const { executor, recorder } = buildHarness();
  assert((await executor(validArgs() as never)).ok);
  const canonicalBody = parseApiV1PlanTaskBody({
    expectedUpdatedAt: EXPECTED_AT,
    startDate: "2026-09-01",
    dueDate: "2026-10-15",
    confirmParentExtension: false,
  });
  const expectedHash = await hashCanonicalPayload(
    buildApiV1PlanTaskIdempotencyPayload(TASK_ID, canonicalBody),
  );
  assertEquals(recorder.writerCalls[0].context.payloadHash, expectedHash);

  // Ordinary confirmation, idempotency key and provenance are excluded: a hash
  // computed over the business payload alone reproduces it exactly.
  const withControl = await hashCanonicalPayload({
    taskId: TASK_ID,
    ...canonicalBody,
    confirmation: true,
    idempotencyKey: "idem-key-task-plan",
    apiClientId: API_CLIENT_ID,
  });
  assertNotEquals(withControl, expectedHash);
});

Deno.test("I2: a different idempotency key does not change the payload hash", async () => {
  const a = buildHarness();
  assert((await a.executor(validArgs() as never)).ok);
  const b = buildHarness();
  assert(
    (await b.executor(
      validArgs({ idempotencyKey: "idem-key-task-plan-2" }) as never,
    )).ok,
  );
  assertEquals(
    a.recorder.writerCalls[0].context.payloadHash,
    b.recorder.writerCalls[0].context.payloadHash,
  );
  assertNotEquals(
    a.recorder.writerCalls[0].context.idempotencyKey,
    b.recorder.writerCalls[0].context.idempotencyKey,
  );
});

Deno.test("J: confirmParentExtension false vs true yields a different hash", async () => {
  const a = buildHarness();
  assert((await a.executor(validArgs() as never)).ok);
  const b = buildHarness();
  assert(
    (await b.executor(
      validArgs({ confirmParentExtension: true }) as never,
    )).ok,
  );
  assertNotEquals(
    a.recorder.writerCalls[0].context.payloadHash,
    b.recorder.writerCalls[0].context.payloadHash,
  );
});

Deno.test("J2: dates and expectedUpdatedAt participate in the payload hash", async () => {
  const base = buildHarness();
  assert((await base.executor(validArgs() as never)).ok);
  const baseHash = base.recorder.writerCalls[0].context.payloadHash;
  const variants = [
    { startDate: "2026-09-02" },
    { dueDate: "2026-10-16" },
    { expectedUpdatedAt: "2026-08-14T05:00:01.000Z" },
  ];
  for (const override of variants) {
    const h = buildHarness();
    assert((await h.executor(validArgs(override) as never)).ok);
    assertNotEquals(h.recorder.writerCalls[0].context.payloadHash, baseHash);
  }
});

// ---------------------------------------------------------------------------
// K/L/M/N/O. Rate limiting and writer invocation
// ---------------------------------------------------------------------------

Deno.test("K: rate profile and consumption use exactly TASK_PLANNING_ROUTE.id", async () => {
  const { executor, recorder } = buildHarness();
  assert((await executor(validArgs() as never)).ok);
  assertEquals(TASK_PLANNING_ROUTE.id, "tasks.plan");
  assertEquals(recorder.profileCalls, [
    { clientId: API_CLIENT_ID, routeId: "tasks.plan" },
  ]);
  assertEquals(recorder.consumeCalls.length, 1);
  assertEquals(recorder.consumeCalls[0].apiClientId, API_CLIENT_ID);
  assertEquals(recorder.consumeCalls[0].userId, USER_ID);
  assertEquals(recorder.consumeCalls[0].routeId, "tasks.plan");
});

Deno.test("L/M/N/O: writer invoked exactly once with canonical inputs forwarded unchanged", async () => {
  const { executor, recorder, request } = buildHarness();
  assert((await executor(validArgs() as never)).ok);
  assertEquals(recorder.writerCalls.length, 1);
  assertEquals(recorder.order, ["profile", "rate_limit", "writer"]);
  const call = recorder.writerCalls[0];
  assertEquals(call.request, request);
  assertEquals(call.taskId, TASK_ID);
  assertEquals(Object.keys(call.body).sort(), [
    "confirmParentExtension",
    "dueDate",
    "expectedUpdatedAt",
    "startDate",
  ]);
  assertEquals(call.body.expectedUpdatedAt, EXPECTED_AT);
  assertEquals(call.body.startDate, "2026-09-01");
  assertEquals(call.body.dueDate, "2026-10-15");
  assertEquals(call.body.confirmParentExtension, false);
  assertEquals(call.context.sourceChannel, "mcp");
  assertEquals(call.context.delegationMode, "delegated_user");
  assertEquals(call.context.executingUserId, USER_ID);
  assertEquals(call.context.apiClientId, API_CLIENT_ID);
  assertEquals(call.context.requestId, "req-1");
  assertEquals(call.context.correlationId, "req-1");
  // The ordinary confirmation control never enters the canonical body.
  assertFalse("confirmation" in call.body);
});

Deno.test("N2/O2: null dates and confirmParentExtension=true forwarded unchanged", async () => {
  const { executor, recorder } = buildHarness();
  assert(
    (await executor(validArgs({
      startDate: null,
      dueDate: null,
      confirmParentExtension: true,
    }) as never)).ok,
  );
  const body = recorder.writerCalls[0].body;
  assertEquals(body.startDate, null);
  assertEquals(body.dueDate, null);
  assertEquals(body.confirmParentExtension, true);
});

Deno.test("K2: rate-limit exceeded maps to rate_limited without the writer", async () => {
  const { executor, recorder } = buildHarness(successResult, {
    rateLimitThrows: new ApiHttpError("rate_limit_exceeded"),
  });
  assertEquals(await executor(validArgs() as never), {
    ok: false,
    category: "rate_limited",
  });
  assertEquals(recorder.writerCalls.length, 0);
  assertEquals(recorder.order, ["profile", "rate_limit"]);
});

// ---------------------------------------------------------------------------
// P/Q/R/S/T/U/V. Bounded results
// ---------------------------------------------------------------------------

for (const outcome of ["applied", "no_change", "replayed"] as const) {
  Deno.test(`P/Q(${outcome}): success maps to the bounded structural payload`, async () => {
    const { executor } = buildHarness({ ...successResult, outcome });
    const result = await executor(validArgs() as never);
    assert(result.ok);
    assertEquals(Object.keys(result.payload).sort(), [
      "dueDate",
      "outcome",
      "phaseExtended",
      "phaseId",
      "phaseStartDate",
      "phaseTargetEndDate",
      "projectId",
      "startDate",
      "taskId",
      "updatedAt",
    ]);
    assertEquals(result.payload.outcome, outcome);
    assertEquals(result.payload.taskId, TASK_ID);
    assertEquals(result.payload.phaseId, PHASE_ID);
    assertEquals(result.payload.projectId, PROJECT_ID);
  });
}

Deno.test("Q2: no Task narrative, credential, identity or provenance is returned", async () => {
  const { executor } = buildHarness({
    ...successResult,
    name: "Configure GL",
    description: "secret narrative",
  });
  const result = await executor(validArgs() as never);
  assert(result.ok);
  const serialized = JSON.stringify(result);
  for (
    const leak of [
      "secret narrative",
      "Configure GL",
      "token-value",
      "idem-key-task-plan",
      "payloadHash",
      API_CLIENT_ID,
      USER_ID,
      "oauth-1",
      "policy-1",
      "req-1",
    ]
  ) {
    assertFalse(serialized.includes(leak), `leaked: ${leak}`);
  }
});

Deno.test("R/S: extend_phase_window_required maps to a distinct bounded category", async () => {
  const { executor, recorder } = buildHarness(phaseWindowResult);
  const result = await executor(validArgs() as never);
  assertFalse(result.ok);
  assertEquals(result.category, "phase_window_extension_required");
  assert("details" in result);
  assertEquals(Object.keys(result.details).sort(), [
    "phaseCurrentStart",
    "phaseCurrentTargetEnd",
    "phaseId",
    "phaseProposedStart",
    "phaseProposedTargetEnd",
    "projectId",
    "requestedTaskDue",
    "requestedTaskStart",
    "taskId",
  ]);
  assertEquals(Object.keys(result).sort(), ["category", "details", "ok"]);
  // No retry, no automatic approval, no date rewrite, no Phase mutation.
  assertEquals(recorder.writerCalls.length, 1);
  assertEquals(recorder.writerCalls[0].body.confirmParentExtension, false);
  assertEquals(recorder.writerCalls[0].body.startDate, "2026-09-01");
  assertEquals(recorder.writerCalls[0].body.dueDate, "2026-10-15");
  // The canonical code itself is not disclosed as a category.
  assertFalse(JSON.stringify(result).includes("extend_phase_window_required"));
  assert(
    MCP_TASK_PLAN_TOOL_ERROR_MESSAGES.phase_window_extension_required
      .includes("new idempotency key"),
  );
});

Deno.test("S2: a replayed stored Phase-window confirmation normalizes identically", async () => {
  const fresh = buildHarness(phaseWindowResult);
  const freshResult = await fresh.executor(validArgs() as never);
  const replay = buildHarness({ ...phaseWindowResult, outcome: "confirmation_required" });
  const replayResult = await replay.executor(validArgs() as never);
  assertEquals(JSON.stringify(replayResult), JSON.stringify(freshResult));
  assertEquals(replay.recorder.writerCalls.length, 1);
});

Deno.test("T: stale planning maps to stale_task_planning without currentUpdatedAt", async () => {
  const { executor, recorder } = buildHarness(staleResult);
  const result = await executor(validArgs() as never);
  assertEquals(result, { ok: false, category: "stale_task_planning" });
  assertEquals(recorder.writerCalls.length, 1);
  const serialized = JSON.stringify(result);
  assertFalse(serialized.includes("currentUpdatedAt"));
  assertFalse(serialized.includes("2026-08-14T07:45:00.000Z"));
  assert(
    MCP_TASK_PLAN_TOOL_ERROR_MESSAGES.stale_task_planning.includes(
      "new idempotency key",
    ),
  );
  assertEquals(
    MCP_TASK_PLAN_TOOL_ERROR_MESSAGES.not_authorized,
    "Not authorized to plan this Task.",
  );
  assertEquals(
    MCP_TASK_PLAN_TOOL_ERROR_MESSAGES.unavailable,
    "BTPM Task planning is temporarily unavailable.",
  );
});

Deno.test("U: negative writer outcomes and ApiHttpError codes map correctly", async () => {
  const pairs = [
    ["invalid", "invalid_arguments"],
    ["not_authorized", "not_authorized"],
    ["idempotency_conflict", "idempotency_conflict"],
    ["idempotency_pending", "idempotency_pending"],
  ] as const;
  for (const [outcome, category] of pairs) {
    const { executor } = buildHarness({ ok: false, outcome });
    assertEquals(await executor(validArgs() as never), {
      ok: false,
      category,
    });
  }
  const codes = [
    ["not_authorized", "not_authorized"],
    ["invalid_request", "invalid_arguments"],
    ["internal_error", "unavailable"],
  ] as const;
  for (const [code, category] of codes) {
    const { executor, recorder } = buildHarness(successResult, {
      writerThrows: new ApiHttpError(code),
    });
    assertEquals(await executor(validArgs() as never), {
      ok: false,
      category,
    });
    // The writer is never retried after an unexpected failure.
    assertEquals(recorder.writerCalls.length, 1);
  }
});

Deno.test("U2: invalid idempotency key maps to invalid_arguments", async () => {
  for (const key of ["", "   ", "bad key with spaces"]) {
    const { executor, recorder } = buildHarness();
    assertEquals(
      await executor(validArgs({ idempotencyKey: key }) as never),
      { ok: false, category: "invalid_arguments" },
    );
    assertEquals(recorder.writerCalls.length, 0);
  }
});

Deno.test("U3: unexpected non-Api writer failures surface only as unavailable", async () => {
  for (
    const thrown of [
      new Error("relation \"tasks\" violates policy 42501"),
      "raw string failure",
      { sqlstate: "P0001", message: "stale_task_planning detail" },
    ]
  ) {
    const { executor } = buildHarness(successResult, { writerThrows: thrown });
    const result = await executor(validArgs() as never);
    assertEquals(result, { ok: false, category: "unavailable" });
    assertFalse(JSON.stringify(result).includes("42501"));
    assertFalse(JSON.stringify(result).includes("P0001"));
  }
});

Deno.test("V: malformed trusted context stays unavailable without leaking the invariant", async () => {
  const malformed = [
    { ...trustedExecution, sourceChannel: "external_api" },
    { ...trustedExecution, delegationMode: "service" },
    { ...trustedExecution, executingUserId: "someone-else" },
    { ...trustedExecution, correlationId: "different" },
    { ...trustedExecution, apiClientId: "" },
  ];
  for (const execution of malformed) {
    const { executor, recorder } = buildHarness(successResult, { execution });
    const result = await executor(validArgs() as never);
    assertEquals(result, { ok: false, category: "unavailable" });
    assertEquals(Object.keys(result), ["ok", "category"]);
    assertEquals(recorder.writerCalls.length, 0);
    assertEquals(recorder.consumeCalls.length, 0);
  }
});

// ---------------------------------------------------------------------------
// W/X/Y/Z. Static architecture guards and registry/runtime state
// ---------------------------------------------------------------------------

Deno.test("W/X/Y: module introduces no forbidden surface, refresh or retry", () => {
  const forbidden = [
    "createClient",
    "Deno.env",
    "service_role",
    "SERVICE_ROLE",
    ".from(",
    ".rpc(",
    "mcp_v1_plan_task",
    "api_v1_plan_task",
    "apply_task_planning_change",
    "preview_task_planning_change",
    "pmg_",
    "registerTool",
    "setRequestHandler",
    "fetch(",
    "crypto.subtle",
    "Date.now",
    "toISOString",
    "while (",
    "for (;;)",
    "setTimeout",
    "setInterval",
    "console.",
    "currentUpdatedAt",
  ];
  for (const token of forbidden) {
    assertFalse(
      toolSource.includes(token),
      `forbidden token present: ${token}`,
    );
  }
});
