// API-Q Task Assign Step 3 — focused guard for the Task-assignment MCP mutation
// tool control composition. Behavioural (in-process fakes) + static source
// guards. No network, no database, no Edge invocation, no service-role key.
//
// Scope: control/composition only. `tasks.assign` exposure is owned by Step 4
// and remains unwired in this step.

import {
  assert,
  assertEquals,
  assertFalse,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  createMcpTaskAssignToolExecutor,
  MCP_TASK_ASSIGN_TOOL_ARGUMENT_NAMES,
  MCP_TASK_ASSIGN_TOOL_ERROR_MESSAGES,
  MCP_TASK_ASSIGN_TOOL_INPUT_SCHEMA,
  MCP_TASK_ASSIGN_TOOL_NAME,
} from "../../functions/btpm-mcp/mcp/taskAssignMutationTool.ts";
import { MCP_TOOL_REGISTRY } from "../../functions/btpm-mcp/mcp/toolRegistry.ts";
import { hashCanonicalPayload } from "../../functions/_shared/btpm-api/idempotency.ts";
import {
  buildApiV1AssignTaskIdempotencyPayload,
  parseApiV1AssignTaskBody,
  TASK_ASSIGN_ROUTE,
} from "../../functions/_shared/btpm-api/routes/tasks.ts";
import { ApiHttpError } from "../../functions/_shared/btpm-api/http.ts";

const TOOL_URL = new URL(
  "../../functions/btpm-mcp/mcp/taskAssignMutationTool.ts",
  import.meta.url,
);
const toolSource = await Deno.readTextFile(TOOL_URL);
const serverFactorySource = await Deno.readTextFile(
  new URL("../../functions/btpm-mcp/mcp/serverFactory.ts", import.meta.url),
);
const mcpIndexSource = await Deno.readTextFile(
  new URL("../../functions/btpm-mcp/index.ts", import.meta.url),
);

const TASK_ID = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const ASSIGNEE_ID = "66666666-6666-4666-8666-666666666666";
const OLD_ASSIGNEE_ID = "77777777-7777-4777-8777-777777777777";
const API_CLIENT_ID = "44444444-4444-4444-8444-444444444444";
const USER_ID = "55555555-5555-4555-8555-555555555555";

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
    assigneeId: ASSIGNEE_ID,
    confirmation: true,
    idempotencyKey: "idem-key-task-assign",
    ...overrides,
  };
}

const successResult = Object.freeze({
  ok: true,
  outcome: "applied",
  taskId: TASK_ID,
  projectId: PROJECT_ID,
  oldAssigneeId: OLD_ASSIGNEE_ID,
  newAssigneeId: ASSIGNEE_ID,
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

  const executor = createMcpTaskAssignToolExecutor({
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

Deno.test("A: tool name is exactly btpm_assign_task and matches the registry", () => {
  assertEquals(MCP_TASK_ASSIGN_TOOL_NAME, "btpm_assign_task");
  const entry = MCP_TOOL_REGISTRY.find((e) => e.operationId === "tasks.assign");
  assert(entry, "tasks.assign registry entry missing");
  assertEquals(entry.toolName, MCP_TASK_ASSIGN_TOOL_NAME);
});

Deno.test("B: exactly the four approved argument names, in canonical order", () => {
  assertEquals([...MCP_TASK_ASSIGN_TOOL_ARGUMENT_NAMES], [
    "taskId",
    "assigneeId",
    "confirmation",
    "idempotencyKey",
  ]);
  assertEquals(
    Object.keys(MCP_TASK_ASSIGN_TOOL_INPUT_SCHEMA.shape),
    [...MCP_TASK_ASSIGN_TOOL_ARGUMENT_NAMES],
  );
  assert(MCP_TASK_ASSIGN_TOOL_INPUT_SCHEMA.safeParse(validArgs()).success);
  for (const key of MCP_TASK_ASSIGN_TOOL_ARGUMENT_NAMES) {
    const partial: Record<string, unknown> = validArgs();
    delete partial[key];
    assertFalse(
      MCP_TASK_ASSIGN_TOOL_INPUT_SCHEMA.safeParse(partial).success,
      `missing key accepted: ${key}`,
    );
  }
});

Deno.test("C: unknown scope/provenance/concurrency fields are rejected", () => {
  for (
    const key of [
      "extra",
      "expectedUpdatedAt",
      "tenantId",
      "organizationId",
      "workspaceId",
      "projectId",
      "phaseId",
      "role",
      "assignmentType",
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
      MCP_TASK_ASSIGN_TOOL_INPUT_SCHEMA.safeParse(validArgs({ [key]: "x" }))
        .success,
      `unknown key accepted: ${key}`,
    );
  }
});

Deno.test("C2: argument types are strict (no coercion, no aliases)", () => {
  assertFalse(
    MCP_TASK_ASSIGN_TOOL_INPUT_SCHEMA.safeParse(validArgs({ taskId: 1 }))
      .success,
  );
  assertFalse(
    MCP_TASK_ASSIGN_TOOL_INPUT_SCHEMA.safeParse(
      validArgs({ confirmation: "true" }),
    ).success,
  );
  assertFalse(
    MCP_TASK_ASSIGN_TOOL_INPUT_SCHEMA.safeParse(
      validArgs({ assigneeId: 42 }),
    ).success,
  );
  assert(
    MCP_TASK_ASSIGN_TOOL_INPUT_SCHEMA.safeParse(validArgs({ assigneeId: null }))
      .success,
  );
});

// ---------------------------------------------------------------------------
// D. Confirmation control ordering
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

// ---------------------------------------------------------------------------
// F/G/H/I. Canonical contract reuse and hashing
// ---------------------------------------------------------------------------

Deno.test("F/G/H: canonical Task path, body and idempotency-payload builders are reused", () => {
  assert(toolSource.includes("parseApiV1TaskAssignPath"));
  assert(toolSource.includes('"/v1/tasks/"'));
  assert(toolSource.includes('"/assignee"'));
  assert(toolSource.includes("parseApiV1AssignTaskBody"));
  assert(toolSource.includes("buildApiV1AssignTaskIdempotencyPayload"));
  assert(toolSource.includes("buildMcpMutationExecutionContext"));
  assert(toolSource.includes("TASK_ASSIGN_ROUTE"));
  // No second UUID parser is defined locally.
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

Deno.test("G2: invalid assigneeId maps to invalid_arguments before the writer", async () => {
  for (
    const assigneeId of [
      "not-a-uuid",
      "",
      "   ",
      "00000000-0000-0000-0000-000000000000",
    ]
  ) {
    const { executor, recorder } = buildHarness();
    const result = await executor(
      // deno-lint-ignore no-explicit-any
      validArgs({ assigneeId }) as any,
    );
    assertEquals(result, { ok: false, category: "invalid_arguments" });
    assertEquals(recorder.writerCalls.length, 0);
    assertEquals(recorder.consumeCalls.length, 0);
  }
});

Deno.test("I: canonical payload hash covers Task identity and assigneeId only", async () => {
  const { executor, recorder } = buildHarness();
  assert((await executor(validArgs() as never)).ok);
  const canonicalBody = parseApiV1AssignTaskBody({ assigneeId: ASSIGNEE_ID });
  const expectedHash = await hashCanonicalPayload(
    buildApiV1AssignTaskIdempotencyPayload(TASK_ID, canonicalBody),
  );
  assertEquals(recorder.writerCalls[0].context.payloadHash, expectedHash);

  // The canonical idempotency payload is Task identity + assigneeId only.
  assertEquals(
    Object.keys(buildApiV1AssignTaskIdempotencyPayload(TASK_ID, canonicalBody))
      .sort(),
    ["assigneeId", "taskId"],
  );

  // Confirmation, idempotency key and provenance are excluded from the hash.
  const withControl = await hashCanonicalPayload({
    taskId: TASK_ID,
    ...canonicalBody,
    confirmation: true,
    idempotencyKey: "idem-key-task-assign",
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
      validArgs({ idempotencyKey: "idem-key-task-assign-2" }) as never,
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

Deno.test("J: clearing (null) vs setting an assignee yields a different hash", async () => {
  const a = buildHarness();
  assert((await a.executor(validArgs() as never)).ok);
  const b = buildHarness();
  assert((await b.executor(validArgs({ assigneeId: null }) as never)).ok);
  assertNotEquals(
    a.recorder.writerCalls[0].context.payloadHash,
    b.recorder.writerCalls[0].context.payloadHash,
  );
});

// ---------------------------------------------------------------------------
// K/L. Rate limiting and writer invocation
// ---------------------------------------------------------------------------

Deno.test("K: rate profile and consumption use exactly TASK_ASSIGN_ROUTE.id", async () => {
  const { executor, recorder } = buildHarness();
  assert((await executor(validArgs() as never)).ok);
  assertEquals(TASK_ASSIGN_ROUTE.id, "tasks.assign");
  assertEquals(recorder.profileCalls, [
    { clientId: API_CLIENT_ID, routeId: "tasks.assign" },
  ]);
  assertEquals(recorder.consumeCalls.length, 1);
  assertEquals(recorder.consumeCalls[0].apiClientId, API_CLIENT_ID);
  assertEquals(recorder.consumeCalls[0].userId, USER_ID);
  assertEquals(recorder.consumeCalls[0].routeId, "tasks.assign");
});

Deno.test("L: writer invoked exactly once with canonical inputs forwarded unchanged", async () => {
  const { executor, recorder, request } = buildHarness();
  assert((await executor(validArgs() as never)).ok);
  assertEquals(recorder.writerCalls.length, 1);
  assertEquals(recorder.order, ["profile", "rate_limit", "writer"]);
  const call = recorder.writerCalls[0];
  assertEquals(call.request, request);
  assertEquals(call.taskId, TASK_ID);
  assertEquals(Object.keys(call.body), ["assigneeId"]);
  assertEquals(call.body.assigneeId, ASSIGNEE_ID);
  assertEquals(call.context.sourceChannel, "mcp");
  assertEquals(call.context.delegationMode, "delegated_user");
  assertEquals(call.context.executingUserId, USER_ID);
  assertEquals(call.context.apiClientId, API_CLIENT_ID);
  assertEquals(call.context.requestId, "req-1");
  assertEquals(call.context.correlationId, "req-1");
  // The confirmation control never enters the canonical body.
  assertFalse("confirmation" in call.body);
  assertFalse("expectedUpdatedAt" in call.body);
});

Deno.test("L2: assigneeId null is accepted and forwarded unchanged (clear)", async () => {
  const { executor, recorder } = buildHarness({
    ...successResult,
    newAssigneeId: null,
  });
  const result = await executor(validArgs({ assigneeId: null }) as never);
  assert(result.ok);
  assertEquals(Object.keys(recorder.writerCalls[0].body), ["assigneeId"]);
  assertEquals(recorder.writerCalls[0].body.assigneeId, null);
  assertEquals(result.payload.newAssigneeId, null);
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
// P/Q/U/V. Bounded results
// ---------------------------------------------------------------------------

for (const outcome of ["applied", "no_change", "replayed"] as const) {
  Deno.test(`P/Q(${outcome}): success maps to the bounded structural payload`, async () => {
    const { executor } = buildHarness({ ...successResult, outcome });
    const result = await executor(validArgs() as never);
    assert(result.ok);
    assertEquals(Object.keys(result.payload).sort(), [
      "newAssigneeId",
      "oldAssigneeId",
      "outcome",
      "projectId",
      "taskId",
    ]);
    assertEquals(result.payload.outcome, outcome);
    assertEquals(result.payload.taskId, TASK_ID);
    assertEquals(result.payload.projectId, PROJECT_ID);
    assertEquals(result.payload.oldAssigneeId, OLD_ASSIGNEE_ID);
    assertEquals(result.payload.newAssigneeId, ASSIGNEE_ID);
  });
}

Deno.test("Q1: nullable old/new assignee IDs are preserved exactly", async () => {
  const { executor } = buildHarness({
    ...successResult,
    oldAssigneeId: null,
    newAssigneeId: null,
    outcome: "no_change",
  });
  const result = await executor(validArgs({ assigneeId: null }) as never);
  assert(result.ok);
  assertEquals(result.payload.oldAssigneeId, null);
  assertEquals(result.payload.newAssigneeId, null);
});

Deno.test("Q2: no Task narrative, credential, identity or provenance is returned", async () => {
  const { executor } = buildHarness({
    ...successResult,
    name: "Configure GL",
    description: "secret narrative",
    assigneeEmail: "person@example.test",
  });
  const result = await executor(validArgs() as never);
  assert(result.ok);
  const serialized = JSON.stringify(result);
  for (
    const leak of [
      "secret narrative",
      "Configure GL",
      "person@example.test",
      "token-value",
      "idem-key-task-assign",
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
      { sqlstate: "P0001", message: "assignee not in workspace" },
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

Deno.test("W: no concurrency token or stale category exists for Task assignment", () => {
  assertFalse("expectedUpdatedAt" in MCP_TASK_ASSIGN_TOOL_INPUT_SCHEMA.shape);
  // Executable code only: documentation comments may explain the absence.
  const executableSource = toolSource
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");
  for (
    const token of ["expectedUpdatedAt", "stale_", "updatedAt", "\"conflict\""]
  ) {
    assertFalse(
      executableSource.includes(token),
      `concurrency token present: ${token}`,
    );
  }

  assertEquals(Object.keys(MCP_TASK_ASSIGN_TOOL_ERROR_MESSAGES).sort(), [
    "confirmation_required",
    "idempotency_conflict",
    "idempotency_pending",
    "invalid_arguments",
    "not_authorized",
    "rate_limited",
    "unavailable",
  ]);
});

Deno.test("X/Y: module introduces no forbidden surface or retry", () => {
  const forbidden = [
    "createClient",
    "Deno.env",
    "service_role",
    "SERVICE_ROLE",
    ".from(",
    ".rpc(",
    "mcp_v1_assign_task",
    "api_v1_assign_task",
    "apply_task_assignee_set",
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
  ];
  for (const token of forbidden) {
    assertFalse(
      toolSource.includes(token),
      `forbidden token present: ${token}`,
    );
  }
});

Deno.test("Z: tasks.assign keeps its accepted canonical control contract", () => {
  const entry = MCP_TOOL_REGISTRY.find((e) => e.operationId === "tasks.assign");
  assert(entry, "tasks.assign registry entry missing");
  assertEquals(entry.toolName, MCP_TASK_ASSIGN_TOOL_NAME);
  assertEquals(entry.operationClass, "mutation");
  assertEquals(entry.confirmation, "required");
  assertEquals(entry.resultShape, "single_object");
  assertEquals(entry.concurrencyToken, "not_applicable");
  // Exposure and runtime wiring belong to Step 4 and are asserted there
  // (`api-q-task-assign-mcp-exposure_test.ts`). This Step 3 test only guards
  // that the control layer itself stays free of registration/runtime surface.
  assertFalse(toolSource.includes("registerTool"));
  assertFalse(toolSource.includes("MCP_TOOL_REGISTRY"));
});

