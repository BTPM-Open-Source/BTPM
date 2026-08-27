// API-Q Task Transition Step 3 — focused guard for the Task-transition MCP
// mutation-tool control composition. Behavioural (in-process fakes) + static
// source guards. No network, no database, no Edge invocation, no service-role
// key.
//
// Scope: control/composition only. `tasks.transition` exposure and runtime
// wiring are owned by Step 4; the temporary pre-exposure registry boundary is
// already frozen by the Step-2 executor test and is deliberately not repeated
// here.

import {
  assert,
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  createMcpTaskTransitionToolExecutor,
  MCP_TASK_TRANSITION_TOOL_ARGUMENT_NAMES,
  MCP_TASK_TRANSITION_TOOL_ERROR_MESSAGES,
  MCP_TASK_TRANSITION_TOOL_INPUT_SCHEMA,
  MCP_TASK_TRANSITION_TOOL_NAME,
} from "../../functions/btpm-mcp/mcp/taskTransitionMutationTool.ts";
import { hashCanonicalPayload } from "../../functions/_shared/btpm-api/idempotency.ts";
import {
  buildApiV1TransitionTaskIdempotencyPayload,
  parseApiV1TransitionTaskBody,
  TASK_TRANSITION_ROUTE,
} from "../../functions/_shared/btpm-api/routes/tasks.ts";
import { ApiHttpError } from "../../functions/_shared/btpm-api/http.ts";

const TOOL_URL = new URL(
  "../../functions/btpm-mcp/mcp/taskTransitionMutationTool.ts",
  import.meta.url,
);
const toolSource = await Deno.readTextFile(TOOL_URL);

const TASK_ID = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const PHASE_ID = "22222222-2222-4222-8222-222222222222";
const API_CLIENT_ID = "44444444-4444-4444-8444-444444444444";
const USER_ID = "55555555-5555-4555-8555-555555555555";
const EXPECTED_UPDATED_AT = "2026-01-15T10:20:30.123456Z";
const NEW_UPDATED_AT = "2026-02-01T08:00:00Z";

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
    expectedUpdatedAt: EXPECTED_UPDATED_AT,
    setActualStart: true,
    actualStartDate: "2026-01-10",
    setActualEnd: false,
    actualEndDate: null,
    status: "active",
    confirmation: true,
    idempotencyKey: "idem-key-task-transition",
    ...overrides,
  };
}

const successResult = Object.freeze({
  ok: true,
  outcome: "applied",
  taskId: TASK_ID,
  projectId: PROJECT_ID,
  phaseId: PHASE_ID,
  status: "active",
  actualStartDate: "2026-01-10",
  actualEndDate: null,
  updatedAt: NEW_UPDATED_AT,
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

  const executor = createMcpTaskTransitionToolExecutor({
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
// A. Input contract
// ---------------------------------------------------------------------------

Deno.test("A: tool name is exactly btpm_transition_task", () => {
  assertEquals(MCP_TASK_TRANSITION_TOOL_NAME, "btpm_transition_task");
});

Deno.test("A2: exactly the nine approved argument names, in canonical order", () => {
  assertEquals([...MCP_TASK_TRANSITION_TOOL_ARGUMENT_NAMES], [
    "taskId",
    "expectedUpdatedAt",
    "setActualStart",
    "actualStartDate",
    "setActualEnd",
    "actualEndDate",
    "status",
    "confirmation",
    "idempotencyKey",
  ]);
  assertEquals(
    Object.keys(MCP_TASK_TRANSITION_TOOL_INPUT_SCHEMA.shape),
    [...MCP_TASK_TRANSITION_TOOL_ARGUMENT_NAMES],
  );
  assert(MCP_TASK_TRANSITION_TOOL_INPUT_SCHEMA.safeParse(validArgs()).success);
  for (const key of MCP_TASK_TRANSITION_TOOL_ARGUMENT_NAMES) {
    const partial: Record<string, unknown> = validArgs();
    delete partial[key];
    assertFalse(
      MCP_TASK_TRANSITION_TOOL_INPUT_SCHEMA.safeParse(partial).success,
      `missing key accepted: ${key}`,
    );
  }
});

Deno.test("A3: unknown scope/provenance/control fields are rejected", () => {
  for (
    const key of [
      "extra",
      "tenantId",
      "organizationId",
      "workspaceId",
      "projectId",
      "phaseId",
      "actorUserId",
      "userId",
      "apiClientId",
      "oauthClientId",
      "sourceChannel",
      "provenance",
      "capability",
      "requestId",
      "correlationId",
      "payloadHash",
      "rateLimitProfile",
      "operation",
      "functionName",
      "confirmed",
      "force",
      "updatedAt",
    ]
  ) {
    assertFalse(
      MCP_TASK_TRANSITION_TOOL_INPUT_SCHEMA.safeParse(validArgs({ [key]: "x" }))
        .success,
      `unknown key accepted: ${key}`,
    );
  }
});

Deno.test("A4: argument types are strict at the transport level", () => {
  const rejected: Array<Record<string, unknown>> = [
    { taskId: 1 },
    { expectedUpdatedAt: 1 },
    { setActualStart: "true" },
    { setActualEnd: 1 },
    { actualStartDate: 5 },
    { actualEndDate: {} },
    { status: "planned" },
    { status: "on_hold" },
    { status: "cancelled" },
    { status: "ACTIVE" },
    { status: 1 },
    { confirmation: "true" },
    { idempotencyKey: 7 },
  ];
  for (const override of rejected) {
    assertFalse(
      MCP_TASK_TRANSITION_TOOL_INPUT_SCHEMA.safeParse(validArgs(override))
        .success,
      `accepted: ${JSON.stringify(override)}`,
    );
  }
  for (const status of ["active", "completed", null]) {
    assert(
      MCP_TASK_TRANSITION_TOOL_INPUT_SCHEMA.safeParse(validArgs({ status }))
        .success,
      `rejected valid status: ${status}`,
    );
  }
});

// ---------------------------------------------------------------------------
// B. Confirmation control
// ---------------------------------------------------------------------------

Deno.test("B: confirmation=false is rejected before hashing, rate limit and writer", async () => {
  const { executor, recorder } = buildHarness();
  const result = await executor(
    validArgs({ confirmation: false }) as never,
  );
  assertEquals(result, { ok: false, category: "confirmation_required" });
  assertEquals(recorder.order, []);
  assertEquals(recorder.profileCalls.length, 0);
  assertEquals(recorder.consumeCalls.length, 0);
  assertEquals(recorder.writerCalls.length, 0);
});

Deno.test("B2: non-literal confirmation values never reach the writer", async () => {
  for (const value of ["true", "TRUE", 1, 0, null, undefined, {}, []]) {
    const { executor, recorder } = buildHarness();
    const result = await executor(validArgs({ confirmation: value }) as never);
    assertFalse(result.ok);
    assertEquals(recorder.writerCalls.length, 0);
    assertEquals(recorder.consumeCalls.length, 0);
    assertEquals(recorder.profileCalls.length, 0);
  }
});

Deno.test("B3: confirmation enters neither the canonical body nor the hashed payload", async () => {
  const { executor, recorder } = buildHarness();
  assert((await executor(validArgs() as never)).ok);
  const call = recorder.writerCalls[0];
  assertFalse("confirmation" in call.body);
  assertFalse("idempotencyKey" in call.body);

  const canonicalBody = parseApiV1TransitionTaskBody({
    expectedUpdatedAt: EXPECTED_UPDATED_AT,
    setActualStart: true,
    actualStartDate: "2026-01-10",
    setActualEnd: false,
    actualEndDate: null,
    status: "active",
  });
  const expectedHash = await hashCanonicalPayload(
    buildApiV1TransitionTaskIdempotencyPayload(TASK_ID, canonicalBody),
  );
  assertEquals(call.context.payloadHash, expectedHash);
});

// ---------------------------------------------------------------------------
// C. Canonical validation reuse
// ---------------------------------------------------------------------------

Deno.test("C: canonical path/body/idempotency builders are reused", () => {
  assert(toolSource.includes("parseApiV1TaskTransitionPath"));
  assert(toolSource.includes('"/v1/tasks/"'));
  assert(toolSource.includes('"/transition"'));
  assert(toolSource.includes("parseApiV1TransitionTaskBody"));
  assert(toolSource.includes("buildApiV1TransitionTaskIdempotencyPayload"));
  assert(toolSource.includes("buildMcpMutationExecutionContext"));
  assert(toolSource.includes("TASK_TRANSITION_ROUTE"));
  // No second UUID/timestamp parser is defined locally.
  assertFalse(/[0-9a-f]\{8\}-/.test(toolSource));
});

Deno.test("C2: malformed/nil Task IDs map to invalid_arguments before the writer", async () => {
  for (
    const taskId of [
      "not-a-uuid",
      "",
      "  ",
      "00000000-0000-0000-0000-000000000000",
      `${TASK_ID}/extra`,
    ]
  ) {
    const { executor, recorder } = buildHarness();
    assertEquals(await executor(validArgs({ taskId }) as never), {
      ok: false,
      category: "invalid_arguments",
    });
    assertEquals(recorder.writerCalls.length, 0);
    assertEquals(recorder.consumeCalls.length, 0);
  }
});

Deno.test("C3: malformed expectedUpdatedAt maps to invalid_arguments", async () => {
  for (
    const expectedUpdatedAt of ["", "2026-01-15", "not-a-timestamp", "2026-13-01T00:00:00Z"]
  ) {
    const { executor, recorder } = buildHarness();
    assertEquals(
      await executor(validArgs({ expectedUpdatedAt }) as never),
      { ok: false, category: "invalid_arguments" },
    );
    assertEquals(recorder.writerCalls.length, 0);
  }
});

Deno.test("C4: false set-flag with a non-null date maps to invalid_arguments", async () => {
  const { executor: e1, recorder: r1 } = buildHarness();
  assertEquals(
    await e1(
      validArgs({ setActualStart: false, actualStartDate: "2026-01-10" }) as never,
    ),
    { ok: false, category: "invalid_arguments" },
  );
  assertEquals(r1.writerCalls.length, 0);

  const { executor: e2, recorder: r2 } = buildHarness();
  assertEquals(
    await e2(
      validArgs({ setActualEnd: false, actualEndDate: "2026-01-20" }) as never,
    ),
    { ok: false, category: "invalid_arguments" },
  );
  assertEquals(r2.writerCalls.length, 0);
});

Deno.test("C5: explicit clear (true + null) and status=null are preserved exactly", async () => {
  const { executor, recorder } = buildHarness();
  const result = await executor(
    validArgs({
      setActualStart: true,
      actualStartDate: null,
      setActualEnd: true,
      actualEndDate: null,
      status: null,
    }) as never,
  );
  assert(result.ok);
  const body = recorder.writerCalls[0].body;
  assertEquals(Object.keys(body).sort(), [
    "actualEndDate",
    "actualStartDate",
    "expectedUpdatedAt",
    "setActualEnd",
    "setActualStart",
    "status",
  ]);
  assertEquals(body.setActualStart, true);
  assertEquals(body.actualStartDate, null);
  assertEquals(body.setActualEnd, true);
  assertEquals(body.actualEndDate, null);
  assertEquals(body.status, null);
  // The caller concurrency precondition is forwarded unchanged.
  assertEquals(body.expectedUpdatedAt, EXPECTED_UPDATED_AT);
});

// ---------------------------------------------------------------------------
// D. Idempotency and hashing
// ---------------------------------------------------------------------------

Deno.test("D: Task identity and all six business fields participate in the hash", async () => {
  const baseline = await (async () => {
    const { executor, recorder } = buildHarness();
    assert((await executor(validArgs() as never)).ok);
    return recorder.writerCalls[0].context.payloadHash as string;
  })();

  const variants: Array<Record<string, unknown>> = [
    { taskId: "99999999-9999-4999-8999-999999999999" },
    { expectedUpdatedAt: "2026-01-15T10:20:31.123456Z" },
    { setActualStart: true, actualStartDate: "2026-01-11" },
    { setActualStart: true, actualStartDate: null },
    { setActualEnd: true, actualEndDate: "2026-01-22" },
    { status: "completed" },
    { status: null },
  ];
  for (const override of variants) {
    const { executor, recorder } = buildHarness();
    assert((await executor(validArgs(override) as never)).ok);
    const hash = recorder.writerCalls[0].context.payloadHash as string;
    assert(
      hash !== baseline,
      `hash unchanged for ${JSON.stringify(override)}`,
    );
  }

  // Confirmation is control-only: it cannot alter the hash.
  const { executor, recorder } = buildHarness();
  assert((await executor(validArgs({ confirmation: true }) as never)).ok);
  assertEquals(recorder.writerCalls[0].context.payloadHash, baseline);
});

Deno.test("D2: the caller idempotency key is forwarded unchanged", async () => {
  const { executor, recorder } = buildHarness();
  assert((await executor(validArgs() as never)).ok);
  assertEquals(
    recorder.writerCalls[0].context.idempotencyKey,
    "idem-key-task-transition",
  );
});

Deno.test("D3: invalid idempotency keys map to invalid_arguments", async () => {
  for (const key of ["", "   ", "bad key with spaces"]) {
    const { executor, recorder } = buildHarness();
    assertEquals(
      await executor(validArgs({ idempotencyKey: key }) as never),
      { ok: false, category: "invalid_arguments" },
    );
    assertEquals(recorder.writerCalls.length, 0);
  }
});

// ---------------------------------------------------------------------------
// E. Rate limiting
// ---------------------------------------------------------------------------

Deno.test("E: canonical route ID and trusted identities are used before the writer", async () => {
  const { executor, recorder } = buildHarness();
  assert((await executor(validArgs() as never)).ok);
  assertEquals(TASK_TRANSITION_ROUTE.id, "tasks.transition");
  assertEquals(recorder.profileCalls, [{
    clientId: API_CLIENT_ID,
    routeId: "tasks.transition",
  }]);
  assertEquals(recorder.consumeCalls.length, 1);
  assertEquals(recorder.consumeCalls[0].apiClientId, API_CLIENT_ID);
  assertEquals(recorder.consumeCalls[0].userId, USER_ID);
  assertEquals(recorder.consumeCalls[0].routeId, "tasks.transition");
  assertEquals(recorder.order, ["profile", "rate_limit", "writer"]);
});

Deno.test("E2: rate-limit exceeded maps to rate_limited without the writer", async () => {
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
// F. Writer contract
// ---------------------------------------------------------------------------

Deno.test("F: writer invoked exactly once with canonical inputs forwarded unchanged", async () => {
  const { executor, recorder, request } = buildHarness();
  assert((await executor(validArgs() as never)).ok);
  assertEquals(recorder.writerCalls.length, 1);
  const call = recorder.writerCalls[0];
  assertEquals(call.request, request);
  assertEquals(call.taskId, TASK_ID);
  assertEquals(call.body.expectedUpdatedAt, EXPECTED_UPDATED_AT);
  assertEquals(call.context.sourceChannel, "mcp");
  assertEquals(call.context.delegationMode, "delegated_user");
  assertEquals(call.context.executingUserId, USER_ID);
  assertEquals(call.context.apiClientId, API_CLIENT_ID);
  assertEquals(call.context.requestId, "req-1");
  assertEquals(call.context.correlationId, "req-1");
});

// ---------------------------------------------------------------------------
// G. Results
// ---------------------------------------------------------------------------

for (const outcome of ["applied", "no_change", "replayed"] as const) {
  Deno.test(`G(${outcome}): success maps to the bounded structural payload`, async () => {
    const { executor } = buildHarness({ ...successResult, outcome });
    const result = await executor(validArgs() as never);
    assert(result.ok);
    assertEquals(Object.keys(result.payload).sort(), [
      "actualEndDate",
      "actualStartDate",
      "outcome",
      "phaseId",
      "projectId",
      "status",
      "taskId",
      "updatedAt",
    ]);
    assertEquals(result.payload.outcome, outcome);
    assertEquals(result.payload.taskId, TASK_ID);
    assertEquals(result.payload.projectId, PROJECT_ID);
    assertEquals(result.payload.phaseId, PHASE_ID);
    assertEquals(result.payload.updatedAt, NEW_UPDATED_AT);
  });
}

Deno.test("G2: successful status is never narrowed to active/completed", async () => {
  for (
    const status of ["planned", "active", "completed", "on_hold", "cancelled"]
  ) {
    const { executor } = buildHarness({ ...successResult, status });
    const result = await executor(validArgs({ status: null }) as never);
    assert(result.ok);
    assertEquals(result.payload.status, status);
  }
});

Deno.test("G3: nullable actual dates are preserved exactly", async () => {
  const { executor } = buildHarness({
    ...successResult,
    outcome: "no_change",
    actualStartDate: null,
    actualEndDate: null,
  });
  const result = await executor(validArgs() as never);
  assert(result.ok);
  assertEquals(result.payload.actualStartDate, null);
  assertEquals(result.payload.actualEndDate, null);
});

Deno.test("G4: stale conflict maps only to stale_task and discloses no timestamp", async () => {
  const { executor, recorder } = buildHarness({
    ok: false,
    outcome: "conflict",
    code: "stale_task",
    currentUpdatedAt: "2026-03-03T03:03:03Z",
    sqlstate: "P0001",
    message: "row changed",
  });
  const result = await executor(validArgs() as never);
  assertEquals(result, { ok: false, category: "stale_task" });
  assertEquals(Object.keys(result), ["ok", "category"]);
  const serialized = JSON.stringify(result);
  for (
    const leak of ["currentUpdatedAt", "2026-03-03", "P0001", "row changed"]
  ) {
    assertFalse(serialized.includes(leak), `leaked: ${leak}`);
  }
  // No retry after a stale conflict.
  assertEquals(recorder.writerCalls.length, 1);
});

Deno.test("G5: negative writer outcomes map to the bounded categories", async () => {
  const pairs = [
    ["invalid", "invalid_arguments"],
    ["not_authorized", "not_authorized"],
    ["idempotency_conflict", "idempotency_conflict"],
    ["idempotency_pending", "idempotency_pending"],
  ] as const;
  for (const [outcome, category] of pairs) {
    const { executor, recorder } = buildHarness({ ok: false, outcome });
    assertEquals(await executor(validArgs() as never), {
      ok: false,
      category,
    });
    assertEquals(recorder.writerCalls.length, 1);
  }
});

Deno.test("G6: no Task narrative, credential, identity or provenance is returned", async () => {
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
      "idem-key-task-transition",
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

// ---------------------------------------------------------------------------
// H. Error boundaries
// ---------------------------------------------------------------------------

Deno.test("H: ApiHttpError codes map to the accepted categories with no retry", async () => {
  const codes = [
    ["not_authorized", "not_authorized"],
    ["invalid_request", "invalid_arguments"],
    ["rate_limit_exceeded", "rate_limited"],
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
    assertEquals(recorder.writerCalls.length, 1);
  }
});

Deno.test("H2: unexpected failures surface only as unavailable", async () => {
  for (
    const thrown of [
      new Error("relation \"tasks\" violates policy 42501"),
      "raw string failure",
      { sqlstate: "P0001", message: "task already completed" },
    ]
  ) {
    const { executor } = buildHarness(successResult, { writerThrows: thrown });
    const result = await executor(validArgs() as never);
    assertEquals(result, { ok: false, category: "unavailable" });
    const serialized = JSON.stringify(result);
    assertFalse(serialized.includes("42501"));
    assertFalse(serialized.includes("P0001"));
    assertFalse(serialized.includes("tasks"));
  }
});

Deno.test("H3: malformed trusted context stays unavailable without leaking the invariant", async () => {
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

Deno.test("H4: bounded error vocabulary is exactly the approved categories", () => {
  // MCP-HARDENING-C4 appended the bounded completed-Task lifecycle category.
  assertEquals(Object.keys(MCP_TASK_TRANSITION_TOOL_ERROR_MESSAGES).sort(), [
    "confirmation_required",
    "idempotency_conflict",
    "idempotency_pending",
    "invalid_arguments",
    "not_authorized",
    "rate_limited",
    "stale_task",
    "task_reopen_required",
    "unavailable",
  ]);
});

// ---------------------------------------------------------------------------
// I. Forbidden surfaces
// ---------------------------------------------------------------------------

Deno.test("I: module introduces no forbidden surface, retry or wiring", () => {
  const forbidden = [
    "createClient",
    "Deno.env",
    "service_role",
    "SERVICE_ROLE",
    ".from(",
    ".rpc(",
    "mcp_v1_transition_task",
    "api_v1_transition_task",
    "apply_task_execution_change",
    "reopen_task",
    "pmg_",
    "registerTool",
    "setRequestHandler",
    "MCP_TOOL_REGISTRY",
    "fetch(",
    "crypto.subtle",
    "Date.now",
    "toISOString",
    "while (",
    "for (;;)",
    "setTimeout",
    "setInterval",
    "console.",
    "decrypt",
    "description:",
  ];
  for (const token of forbidden) {
    assertFalse(
      toolSource.includes(token),
      `forbidden token present: ${token}`,
    );
  }
});
