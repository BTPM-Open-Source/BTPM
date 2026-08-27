// API-Q Task Plan Step 2 — focused guard for the caller-bound MCP
// Task-planning adapter.
//
// Behavioural (in-process, injected fakes) + static source guards. No network,
// no database, no Edge invocation, no service-role key.

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  planApiV1Task,
  planMcpV1Task,
} from "../../functions/_shared/btpm-api/supabaseTask.ts";
import { createMcpV1PlanTaskExecutor } from "../../functions/btpm-mcp/mcp/taskPlanMutationExecutor.ts";

const ADAPTER_URL = new URL(
  "../../functions/_shared/btpm-api/supabaseTask.ts",
  import.meta.url,
);
const EXECUTOR_URL = new URL(
  "../../functions/btpm-mcp/mcp/taskPlanMutationExecutor.ts",
  import.meta.url,
);

const adapterSource = await Deno.readTextFile(ADAPTER_URL);
const executorSource = await Deno.readTextFile(EXECUTOR_URL);

/**
 * Executable executor source with line comments removed. The module header
 * documents the prohibited surfaces by name, so name-level guards must run
 * against code only.
 */
const executorCode = executorSource
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("//"))
  .join("\n");

const TASK_ID = "44444444-4444-4444-8444-444444444444";
const PHASE_ID = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const PAYLOAD_HASH = "d".repeat(64);
const EXPECTED_UPDATED_AT = "2026-08-16T04:00:00.123456+02:00";
const START_DATE = "2026-09-01";
const DUE_DATE = "2026-09-30";

const canonicalBody = Object.freeze({
  expectedUpdatedAt: EXPECTED_UPDATED_AT,
  startDate: START_DATE,
  dueDate: DUE_DATE,
  confirmParentExtension: false,
});

function planSuccessData(outcome = "applied") {
  return {
    data: {
      ok: true,
      outcome,
      taskId: TASK_ID,
      projectId: PROJECT_ID,
      phaseId: PHASE_ID,
      startDate: START_DATE,
      dueDate: DUE_DATE,
      updatedAt: "2026-08-16T06:00:00Z",
      phaseExtended: false,
      phaseStartDate: "2026-08-01",
      phaseTargetEndDate: "2026-10-31",
    },
    error: null,
  };
}

function confirmationData(outcome = "confirmation_required") {
  return {
    data: {
      ok: false,
      outcome,
      code: "extend_phase_window_required",
      taskId: TASK_ID,
      projectId: PROJECT_ID,
      phaseId: PHASE_ID,
      phaseCurrentStart: "2026-08-01",
      phaseCurrentTargetEnd: "2026-09-15",
      phaseProposedStart: "2026-08-01",
      phaseProposedTargetEnd: DUE_DATE,
      requestedTaskStart: START_DATE,
      requestedTaskDue: DUE_DATE,
    },
    error: null,
  };
}

const STALE_DATA = Object.freeze({
  data: {
    ok: false,
    outcome: "conflict",
    code: "stale_task_planning",
    currentUpdatedAt: "2026-08-16T05:00:00Z",
  },
  error: null,
});

const STALE_REPLAY_DATA = Object.freeze({
  data: {
    ok: false,
    outcome: "conflict",
    code: "stale_task_planning",
  },
  error: null,
});

function negativeData(outcome: string) {
  return { data: { ok: false, outcome }, error: null };
}

interface RpcCall {
  readonly name: string;
  readonly args: Record<string, unknown>;
}

// deno-lint-ignore no-explicit-any
function recordingClient(calls: RpcCall[], data: any = planSuccessData()) {
  return {
    rpc(name: string, args: unknown) {
      calls.push({ name, args: { ...(args as Record<string, unknown>) } });
      return Promise.resolve(data);
    },
  };
}

const adapterInput = Object.freeze({
  expectedOauthClientId: "btpm-mcp-client",
  taskId: TASK_ID,
  expectedUpdatedAt: EXPECTED_UPDATED_AT,
  startDate: START_DATE,
  dueDate: DUE_DATE,
  confirmParentExtension: false,
  requestId: "req-tp-0001",
  correlationId: "req-tp-0001",
  idempotencyKey: "idem-tp-0001",
  payloadHash: PAYLOAD_HASH,
});

function mutationContext(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    requestedUserId: "user-1",
    executingUserId: "user-1",
    apiClientId: "api-client-1",
    oauthClientId: "btpm-mcp-client",
    policyVersionId: "policy-1",
    requestId: "req-tp-0001",
    correlationId: "req-tp-0001",
    sourceChannel: "mcp",
    sourceClientId: "api-client-1",
    delegationMode: "delegated_user",
    idempotencyKey: "idem-tp-0001",
    payloadHash: PAYLOAD_HASH,
    ...overrides,
  };
}

function authenticatedRequest(token = "caller-access-token"): Request {
  return new Request("https://mcp.example.test/mcp", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

interface FactoryCall {
  readonly url: string;
  readonly key: string;
  readonly options: Record<string, unknown>;
}

// deno-lint-ignore no-explicit-any
function buildExecutor(calls: RpcCall[], factoryCalls: FactoryCall[], data?: any) {
  return createMcpV1PlanTaskExecutor(
    "https://project.supabase.test",
    "anon-publishable-key",
    (url, key, options) => {
      factoryCalls.push({
        url,
        key,
        options: options as unknown as Record<string, unknown>,
      });
      return recordingClient(calls, data ?? planSuccessData());
    },
  );
}

// -----------------------------------------------------------------------------
// A/B/C/D. Fixed supabaseTask planning adapters
// -----------------------------------------------------------------------------

Deno.test("REST Task plan still calls only api_v1_plan_task", async () => {
  const calls: RpcCall[] = [];
  const result = await planApiV1Task(recordingClient(calls), adapterInput);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, "api_v1_plan_task");
  assertEquals(result.ok, true);
});

Deno.test("MCP Task plan calls only mcp_v1_plan_task", async () => {
  const calls: RpcCall[] = [];
  const result = await planMcpV1Task(recordingClient(calls), adapterInput);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, "mcp_v1_plan_task");
  assertEquals(result.ok, true);
});

Deno.test("REST and MCP Task plan share identical validation and mapping", async () => {
  const restCalls: RpcCall[] = [];
  const mcpCalls: RpcCall[] = [];
  const rest = await planApiV1Task(recordingClient(restCalls), adapterInput);
  const mcp = await planMcpV1Task(recordingClient(mcpCalls), adapterInput);
  assertEquals(restCalls[0].args, mcpCalls[0].args);
  assertEquals(Object.keys(restCalls[0].args).length, 10);
  assertEquals(rest, mcp);

  for (
    const bad of [
      { ...adapterInput, payloadHash: "nope" },
      { ...adapterInput, taskId: "not-a-uuid" },
      { ...adapterInput, expectedUpdatedAt: "not-a-timestamp" },
      // deno-lint-ignore no-explicit-any
      { ...adapterInput, confirmParentExtension: "true" as any },
      { ...adapterInput, expectedOauthClientId: "" },
      { ...adapterInput, idempotencyKey: "" },
    ]
  ) {
    await assertRejects(
      () => planApiV1Task(recordingClient([]), bad),
      Error,
      undefined,
      `REST must reject ${JSON.stringify(bad)}`,
    );
    await assertRejects(
      () => planMcpV1Task(recordingClient([]), bad),
      Error,
      undefined,
      `MCP must reject ${JSON.stringify(bad)}`,
    );
  }

  const mapperDefs = adapterSource.match(/function toPlanResult\(/g) ?? [];
  assertEquals(mapperDefs.length, 1, "one bounded plan result contract only");
});

Deno.test("plan wrapper names are a closed set of fixed module constants", () => {
  assertStringIncludes(
    adapterSource,
    'const API_V1_PLAN_TASK_FUNCTION_NAME = "api_v1_plan_task"',
  );
  assertStringIncludes(
    adapterSource,
    'const MCP_V1_PLAN_TASK_FUNCTION_NAME = "mcp_v1_plan_task"',
  );
  assert(
    /type PlanTaskFunctionName =\s*\|\s*typeof API_V1_PLAN_TASK_FUNCTION_NAME\s*\|\s*typeof MCP_V1_PLAN_TASK_FUNCTION_NAME;/
      .test(adapterSource),
    "the plan wrapper name must be a closed internal union",
  );
  assertEquals(planApiV1Task.length, 2);
  assertEquals(planMcpV1Task.length, 2);
  assert(
    !/export\s+(async\s+)?function\s+invokePlanTask/.test(adapterSource),
    "the shared plan invocation helper must not be exported",
  );
  assert(
    /function invokePlanTask\(/.test(adapterSource),
    "a single shared internal plan invocation helper must exist",
  );
  const planRpcSites = adapterSource.match(
    /client\.rpc\(functionName, \{\n\s+_expected_oauth_client_id: expectedOauthClientId,\n\s+_task_id: taskId,\n\s+_expected_updated_at: expectedUpdatedAt,\n\s+_new_start: startDate,/g,
  ) ?? [];
  assertEquals(planRpcSites.length, 1, "exactly one Task plan rpc call site");
  assert(
    !/client\.rpc\(API_V1_PLAN_TASK_FUNCTION_NAME|client\.rpc\(MCP_V1_PLAN_TASK_FUNCTION_NAME/
      .test(adapterSource),
    "neither adapter may hold its own plan rpc call site",
  );
});

// -----------------------------------------------------------------------------
// F. Mapping parity across every canonical outcome
// -----------------------------------------------------------------------------

Deno.test("applied / no_change / replayed mapping is identical across sources", async () => {
  for (const outcome of ["applied", "no_change", "replayed"]) {
    const rest = await planApiV1Task(
      recordingClient([], planSuccessData(outcome)),
      adapterInput,
    );
    const mcp = await planMcpV1Task(
      recordingClient([], planSuccessData(outcome)),
      adapterInput,
    );
    assertEquals(rest, mcp);
    assertEquals(rest.ok, true);
    if (rest.ok) {
      assertEquals(rest.outcome, outcome);
      assertEquals(rest.phaseExtended, false);
      assertEquals(rest.phaseStartDate, "2026-08-01");
      assertEquals(rest.phaseTargetEndDate, "2026-10-31");
    }
  }
});

Deno.test("confirmation_required / extend_phase_window_required parity", async () => {
  const rest = await planApiV1Task(
    recordingClient([], confirmationData()),
    adapterInput,
  );
  const mcp = await planMcpV1Task(
    recordingClient([], confirmationData()),
    adapterInput,
  );
  assertEquals(rest, mcp);
  assertEquals(rest.ok, false);
  if (!rest.ok) {
    assertEquals(rest.outcome, "confirmation_required");
    assertEquals(
      (rest as { code?: string }).code,
      "extend_phase_window_required",
    );
    assertEquals((rest as { taskId?: string }).taskId, TASK_ID);
    assertEquals((rest as { phaseId?: string }).phaseId, PHASE_ID);
    assertEquals((rest as { projectId?: string }).projectId, PROJECT_ID);
    assertEquals(
      (rest as { phaseProposedTargetEnd?: string | null })
        .phaseProposedTargetEnd,
      DUE_DATE,
    );
    assertEquals(
      (rest as { requestedTaskDue?: string | null }).requestedTaskDue,
      DUE_DATE,
    );
  }
});

Deno.test("stored replayed confirmation normalizes identically across sources", async () => {
  const rest = await planApiV1Task(
    recordingClient([], confirmationData("replayed")),
    adapterInput,
  );
  const mcp = await planMcpV1Task(
    recordingClient([], confirmationData("replayed")),
    adapterInput,
  );
  const direct = await planMcpV1Task(
    recordingClient([], confirmationData()),
    adapterInput,
  );
  assertEquals(rest, mcp);
  assertEquals(rest, direct, "replayed confirmation must normalize identically");
});

Deno.test("stale_task_planning mapping parity for direct and failed replay", async () => {
  const rest = await planApiV1Task(
    recordingClient([], STALE_DATA),
    adapterInput,
  );
  const mcp = await planMcpV1Task(
    recordingClient([], STALE_DATA),
    adapterInput,
  );
  assertEquals(rest, mcp);
  assertEquals(
    (rest as { currentUpdatedAt?: string | null }).currentUpdatedAt,
    "2026-08-16T05:00:00Z",
  );

  const restReplay = await planApiV1Task(
    recordingClient([], STALE_REPLAY_DATA),
    adapterInput,
  );
  const mcpReplay = await planMcpV1Task(
    recordingClient([], STALE_REPLAY_DATA),
    adapterInput,
  );
  assertEquals(restReplay, mcpReplay);
  assertEquals(
    (mcpReplay as { currentUpdatedAt?: string | null }).currentUpdatedAt,
    null,
    "failed replay must stay normalized with a null timestamp",
  );
});

Deno.test("negative outcome mapping parity", async () => {
  for (
    const outcome of [
      "invalid",
      "not_authorized",
      "idempotency_conflict",
      "idempotency_pending",
    ]
  ) {
    const rest = await planApiV1Task(
      recordingClient([], negativeData(outcome)),
      adapterInput,
    );
    const mcp = await planMcpV1Task(
      recordingClient([], negativeData(outcome)),
      adapterInput,
    );
    assertEquals(rest, mcp);
    assertEquals(rest.ok, false);
    if (!rest.ok) assertEquals(rest.outcome, outcome);
  }
});

// -----------------------------------------------------------------------------
// G/H/I. Exact RPC argument mapping and unchanged canonical inputs
// -----------------------------------------------------------------------------

Deno.test("executor passes exact canonical RPC arguments through unchanged", async () => {
  const calls: RpcCall[] = [];
  const factoryCalls: FactoryCall[] = [];
  const executor = buildExecutor(calls, factoryCalls);

  const result = await executor(
    authenticatedRequest(),
    TASK_ID,
    canonicalBody,
    // deno-lint-ignore no-explicit-any
    mutationContext() as any,
  );

  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, "mcp_v1_plan_task");
  assertEquals(calls[0].args, {
    _expected_oauth_client_id: "btpm-mcp-client",
    _task_id: TASK_ID,
    _expected_updated_at: EXPECTED_UPDATED_AT,
    _new_start: START_DATE,
    _new_due: DUE_DATE,
    _confirm_parent_extension: false,
    _request_id: "req-tp-0001",
    _correlation_id: "req-tp-0001",
    _idempotency_key: "idem-tp-0001",
    _payload_hash: PAYLOAD_HASH,
  });
  assertEquals(result.ok, true);
});

Deno.test("expectedUpdatedAt is forwarded byte-for-byte", async () => {
  for (
    const stamp of [
      EXPECTED_UPDATED_AT,
      "2026-08-16T05:30:00Z",
      "2026-08-16T05:30:00.000+00:00",
    ]
  ) {
    const calls: RpcCall[] = [];
    const executor = buildExecutor(calls, []);
    await executor(
      authenticatedRequest(),
      TASK_ID,
      { ...canonicalBody, expectedUpdatedAt: stamp },
      // deno-lint-ignore no-explicit-any
      mutationContext() as any,
    );
    assertEquals(calls[0].args._expected_updated_at, stamp);
  }
});

Deno.test("confirmParentExtension is forwarded unchanged for false and true", async () => {
  for (const confirm of [false, true]) {
    const calls: RpcCall[] = [];
    const executor = buildExecutor(calls, []);
    await executor(
      authenticatedRequest(),
      TASK_ID,
      { ...canonicalBody, confirmParentExtension: confirm },
      // deno-lint-ignore no-explicit-any
      mutationContext() as any,
    );
    assertEquals(calls.length, 1, "exactly one RPC per invocation");
    assertEquals(calls[0].args._confirm_parent_extension, confirm);
  }
});

Deno.test("null planning dates are forwarded as nulls", async () => {
  const calls: RpcCall[] = [];
  const executor = buildExecutor(calls, []);
  await executor(
    authenticatedRequest(),
    TASK_ID,
    { ...canonicalBody, startDate: null, dueDate: null },
    // deno-lint-ignore no-explicit-any
    mutationContext() as any,
  );
  assertEquals(calls[0].args._new_start, null);
  assertEquals(calls[0].args._new_due, null);
});

// -----------------------------------------------------------------------------
// J. Canonical parser reuse
// -----------------------------------------------------------------------------

Deno.test("executor reuses the canonical Task planning path and body parsers", () => {
  assertStringIncludes(executorSource, "parseApiV1TaskPlanningPath");
  assertStringIncludes(executorSource, "parseApiV1PlanTaskBody");
  assertStringIncludes(executorSource, '"/v1/tasks/"');
  assertStringIncludes(executorSource, '"/planning"');
  assert(
    !/const\s+\w*Schema\s*=|z\.object\(/.test(executorSource),
    "no duplicate planning parser or schema may exist in the executor",
  );
});

Deno.test("malformed and nil Task IDs are rejected", async () => {
  for (
    const badId of [
      "",
      "not-a-uuid",
      NIL_UUID,
      `${TASK_ID}/extra`,
      ` ${TASK_ID}`,
    ]
  ) {
    const calls: RpcCall[] = [];
    const factoryCalls: FactoryCall[] = [];
    const executor = buildExecutor(calls, factoryCalls);
    await assertRejects(() =>
      executor(
        authenticatedRequest(),
        badId,
        canonicalBody,
        // deno-lint-ignore no-explicit-any
        mutationContext() as any,
      )
    );
    assertEquals(factoryCalls.length, 0);
    assertEquals(calls.length, 0);
  }
});

Deno.test("closed planning body shape is enforced by the canonical parser", async () => {
  const badBodies: unknown[] = [
    {},
    { expectedUpdatedAt: EXPECTED_UPDATED_AT },
    { ...canonicalBody, extra: 1 },
    { ...canonicalBody, taskId: TASK_ID },
    { ...canonicalBody, confirmParentExtension: "true" },
    { ...canonicalBody, expectedUpdatedAt: "yesterday" },
    { ...canonicalBody, startDate: DUE_DATE, dueDate: START_DATE },
  ];
  for (const body of badBodies) {
    const calls: RpcCall[] = [];
    const factoryCalls: FactoryCall[] = [];
    const executor = buildExecutor(calls, factoryCalls);
    await assertRejects(
      () =>
        executor(
          authenticatedRequest(),
          TASK_ID,
          // deno-lint-ignore no-explicit-any
          body as any,
          // deno-lint-ignore no-explicit-any
          mutationContext() as any,
        ),
      Error,
      undefined,
      `body must be rejected: ${JSON.stringify(body)}`,
    );
    assertEquals(factoryCalls.length, 0);
    assertEquals(calls.length, 0);
  }
});

// -----------------------------------------------------------------------------
// K/L/N. Caller-bound execution
// -----------------------------------------------------------------------------

Deno.test("fresh anon-key client bound to the current bearer per invocation", async () => {
  const calls: RpcCall[] = [];
  const factoryCalls: FactoryCall[] = [];
  const executor = buildExecutor(calls, factoryCalls);

  await executor(
    authenticatedRequest("token-one"),
    TASK_ID,
    canonicalBody,
    // deno-lint-ignore no-explicit-any
    mutationContext() as any,
  );
  await executor(
    authenticatedRequest("token-two"),
    TASK_ID,
    canonicalBody,
    // deno-lint-ignore no-explicit-any
    mutationContext() as any,
  );

  assertEquals(factoryCalls.length, 2, "one fresh client per invocation");
  for (const call of factoryCalls) {
    assertEquals(call.url, "https://project.supabase.test");
    assertEquals(call.key, "anon-publishable-key");
    const auth = call.options.auth as Record<string, unknown>;
    assertEquals(auth.persistSession, false);
    assertEquals(auth.autoRefreshToken, false);
    assertEquals(auth.detectSessionInUrl, false);
  }
  const headersOne =
    ((factoryCalls[0].options.global as Record<string, unknown>)
      .headers) as Record<string, string>;
  const headersTwo =
    ((factoryCalls[1].options.global as Record<string, unknown>)
      .headers) as Record<string, string>;
  assertEquals(headersOne.Authorization, "Bearer token-one");
  assertEquals(headersTwo.Authorization, "Bearer token-two");
  assertEquals(calls.length, 2, "exactly one RPC per invocation");
});

Deno.test("missing or malformed bearer fails before any client construction", async () => {
  const badRequests = [
    new Request("https://mcp.example.test/mcp", { method: "POST" }),
    new Request("https://mcp.example.test/mcp", {
      method: "POST",
      headers: { Authorization: "Basic abc" },
    }),
    new Request("https://mcp.example.test/mcp", {
      method: "POST",
      headers: { Authorization: "Bearer " },
    }),
  ];
  for (const request of badRequests) {
    const calls: RpcCall[] = [];
    const factoryCalls: FactoryCall[] = [];
    const executor = buildExecutor(calls, factoryCalls);
    await assertRejects(() =>
      executor(
        request,
        TASK_ID,
        canonicalBody,
        // deno-lint-ignore no-explicit-any
        mutationContext() as any,
      )
    );
    assertEquals(factoryCalls.length, 0);
    assertEquals(calls.length, 0);
  }
});

// -----------------------------------------------------------------------------
// M. Trusted context fail-closed
// -----------------------------------------------------------------------------

const INCONSISTENT_CONTEXTS: ReadonlyArray<Record<string, unknown>> = [
  { executingUserId: "user-2" },
  { sourceClientId: "other-client" },
  { correlationId: "req-other" },
  { sourceChannel: "external_api" },
  { delegationMode: "service_account" },
  { payloadHash: "NOTAHASH" },
  { payloadHash: "D".repeat(64) },
  { policyVersionId: "  " },
  { apiClientId: "" },
  { oauthClientId: "" },
  { requestId: "" },
  { requestedUserId: "" },
  { idempotencyKey: "" },
];

Deno.test("inconsistent trusted context fails before client and RPC", async () => {
  for (const overrides of INCONSISTENT_CONTEXTS) {
    const calls: RpcCall[] = [];
    const factoryCalls: FactoryCall[] = [];
    const executor = buildExecutor(calls, factoryCalls);
    await assertRejects(
      () =>
        executor(
          authenticatedRequest(),
          TASK_ID,
          canonicalBody,
          // deno-lint-ignore no-explicit-any
          mutationContext(overrides) as any,
        ),
      Error,
      undefined,
      `context override must fail closed: ${JSON.stringify(overrides)}`,
    );
    assertEquals(factoryCalls.length, 0);
    assertEquals(calls.length, 0);
  }
});

// -----------------------------------------------------------------------------
// O/P/Q. Forbidden surfaces, no refresh/retry, no auto-approval
// -----------------------------------------------------------------------------

Deno.test("stale_task_planning is returned unchanged with no retry or read-before-write", async () => {
  for (const data of [STALE_DATA, STALE_REPLAY_DATA]) {
    const calls: RpcCall[] = [];
    const executor = buildExecutor(calls, [], data);
    const result = await executor(
      authenticatedRequest(),
      TASK_ID,
      canonicalBody,
      // deno-lint-ignore no-explicit-any
      mutationContext() as any,
    );
    assertEquals(result.ok, false);
    if (!result.ok) {
      assertEquals(result.outcome, "conflict");
      assertEquals((result as { code?: string }).code, "stale_task_planning");
    }
    assertEquals(calls.length, 1, "exactly one RPC, no retry");
    assertEquals(calls[0].args._expected_updated_at, EXPECTED_UPDATED_AT);
  }
});

Deno.test("confirmation_required is returned unchanged with no auto-approval retry", async () => {
  for (const data of [confirmationData(), confirmationData("replayed")]) {
    const calls: RpcCall[] = [];
    const executor = buildExecutor(calls, [], data);
    const result = await executor(
      authenticatedRequest(),
      TASK_ID,
      canonicalBody,
      // deno-lint-ignore no-explicit-any
      mutationContext() as any,
    );
    assertEquals(result.ok, false);
    if (!result.ok) assertEquals(result.outcome, "confirmation_required");
    assertEquals(calls.length, 1, "exactly one RPC, no confirmation retry");
    assertEquals(
      calls[0].args._confirm_parent_extension,
      false,
      "the executor must never approve Phase extension by itself",
    );
  }
});

Deno.test("expectedUpdatedAt is never refreshed and no Task read occurs", () => {
  assert(!/new Date\(/.test(executorSource));
  assert(!/toISOString/.test(executorSource));
  assert(!/Date\.now/.test(executorSource));
  assert(!/get_task|api_v1_get_task|mcp_v1_get_task/.test(executorSource));
  assertStringIncludes(
    executorSource,
    "expectedUpdatedAt: canonicalBody.expectedUpdatedAt,",
  );
  assertStringIncludes(
    executorSource,
    "confirmParentExtension: canonicalBody.confirmParentExtension,",
  );
  assert(
    !/confirmParentExtension:\s*true/.test(executorSource),
    "no hardcoded parent-extension approval",
  );
});

Deno.test("executor introduces no forbidden surface", () => {
  assert(!/SERVICE_ROLE|service_role|serviceRole/.test(executorSource));
  assert(!/Deno\.env/.test(executorSource));
  assert(!/fetch\(/.test(executorSource));
  assert(!/\.from\(/.test(executorSource));
  assert(!/console\./.test(executorSource));
  assert(!/setTimeout|setInterval/.test(executorSource));
  assert(
    !/pmg_|planApiV1Task|client\.rpc\(/.test(executorSource),
    "no REST wrapper adapter and no direct RPC dispatch",
  );
  assert(
    !/\bapi_v1_plan_task\b|apply_task_planning_change|preview_task_planning_change/
      .test(executorCode),
    "no REST wrapper, canonical command or preview call",
  );
  assert(!/registerTool|MCP_TOOL_REGISTRY|serverFactory/.test(executorSource));
  assert(!/for\s*\(|while\s*\(/.test(executorSource), "no retry loop");
  const invocations = executorSource.match(/planMcpV1Task\(client, \{/g) ?? [];
  assertEquals(invocations.length, 1, "exactly one fixed MCP invocation site");
});
