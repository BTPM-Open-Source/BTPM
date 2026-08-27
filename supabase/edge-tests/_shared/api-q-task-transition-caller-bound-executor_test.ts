// API-Q Task Transition Step 2 — focused guard for the caller-bound MCP
// Task-transition adapter.
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
  transitionApiV1Task,
  transitionMcpV1Task,
} from "../../functions/_shared/btpm-api/supabaseTask.ts";
import { createMcpV1TransitionTaskExecutor } from "../../functions/btpm-mcp/mcp/taskTransitionMutationExecutor.ts";

const ADAPTER_URL = new URL(
  "../../functions/_shared/btpm-api/supabaseTask.ts",
  import.meta.url,
);
const EXECUTOR_URL = new URL(
  "../../functions/btpm-mcp/mcp/taskTransitionMutationExecutor.ts",
  import.meta.url,
);

const adapterSource = await Deno.readTextFile(ADAPTER_URL);
const executorSource = await Deno.readTextFile(EXECUTOR_URL);

/** Executable executor source: line and block comments removed. */
const executorCode = executorSource
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

const TASK_ID = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const PHASE_ID = "22222222-2222-4222-8222-222222222222";
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const PAYLOAD_HASH = "b".repeat(64);
const EXPECTED_UPDATED_AT = "2026-08-16T10:00:00.000Z";

function transitionSuccessData(
  outcome = "applied",
  status = "active",
  actualStartDate: string | null = "2026-08-10",
  actualEndDate: string | null = null,
) {
  return {
    data: {
      ok: true,
      outcome,
      taskId: TASK_ID,
      projectId: PROJECT_ID,
      phaseId: PHASE_ID,
      status,
      actualStartDate,
      actualEndDate,
      updatedAt: "2026-08-16T11:00:00.000Z",
    },
    error: null,
  };
}

const STALE_DATA = {
  data: { ok: false, outcome: "conflict", code: "stale_task" },
  error: null,
};

interface RpcCall {
  readonly name: string;
  readonly args: Record<string, unknown>;
}

function recordingClient(calls: RpcCall[], data = transitionSuccessData()) {
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
  setActualStart: true,
  actualStartDate: "2026-08-10",
  setActualEnd: false,
  actualEndDate: null,
  status: "active",
  requestId: "req-tt-0001",
  correlationId: "req-tt-0001",
  idempotencyKey: "idem-tt-0001",
  payloadHash: PAYLOAD_HASH,
});

const canonicalBody = Object.freeze({
  expectedUpdatedAt: EXPECTED_UPDATED_AT,
  setActualStart: true,
  actualStartDate: "2026-08-10",
  setActualEnd: false,
  actualEndDate: null,
  status: "active" as const,
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
    requestId: "req-tt-0001",
    correlationId: "req-tt-0001",
    sourceChannel: "mcp",
    sourceClientId: "api-client-1",
    delegationMode: "delegated_user",
    idempotencyKey: "idem-tt-0001",
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
  return createMcpV1TransitionTaskExecutor(
    "https://project.supabase.test",
    "anon-publishable-key",
    (url, key, options) => {
      factoryCalls.push({
        url,
        key,
        options: options as unknown as Record<string, unknown>,
      });
      return recordingClient(calls, data ?? transitionSuccessData());
    },
  );
}

function assertRejectsSync(fn: () => unknown): void {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  assert(threw, "expected a bounded synchronous failure");
}

// -----------------------------------------------------------------------------
// A. Fixed supabaseTask transition adapters
// -----------------------------------------------------------------------------

Deno.test("REST Task transition still calls only api_v1_transition_task", async () => {
  const calls: RpcCall[] = [];
  const result = await transitionApiV1Task(
    recordingClient(calls),
    adapterInput,
  );
  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, "api_v1_transition_task");
  assertEquals(result.ok, true);
});

Deno.test("MCP Task transition calls only mcp_v1_transition_task", async () => {
  const calls: RpcCall[] = [];
  const result = await transitionMcpV1Task(
    recordingClient(calls),
    adapterInput,
  );
  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, "mcp_v1_transition_task");
  assertEquals(result.ok, true);
});

Deno.test("REST and MCP Task transition build identical 12-key RPC arguments", async () => {
  const restCalls: RpcCall[] = [];
  const mcpCalls: RpcCall[] = [];
  const rest = await transitionApiV1Task(
    recordingClient(restCalls),
    adapterInput,
  );
  const mcp = await transitionMcpV1Task(
    recordingClient(mcpCalls),
    adapterInput,
  );
  assertEquals(restCalls[0].args, mcpCalls[0].args);
  assertEquals(Object.keys(restCalls[0].args).sort(), [
    "_actual_end_date",
    "_actual_start_date",
    "_correlation_id",
    "_expected_oauth_client_id",
    "_expected_updated_at",
    "_idempotency_key",
    "_payload_hash",
    "_request_id",
    "_set_actual_end",
    "_set_actual_start",
    "_status",
    "_task_id",
  ]);
  assertEquals(Object.keys(restCalls[0].args).length, 12);
  assertEquals(rest, mcp);

  for (
    const bad of [
      { ...adapterInput, payloadHash: "nope" },
      { ...adapterInput, taskId: "not-a-uuid" },
      { ...adapterInput, taskId: NIL_UUID },
      { ...adapterInput, expectedOauthClientId: "" },
      { ...adapterInput, idempotencyKey: "" },
      { ...adapterInput, expectedUpdatedAt: "not-a-timestamp" },
      { ...adapterInput, status: "planned" },
      { ...adapterInput, setActualEnd: false, actualEndDate: "2026-08-11" },
    ]
  ) {
    await assertRejects(() => transitionApiV1Task(recordingClient([]), bad));
    await assertRejects(() => transitionMcpV1Task(recordingClient([]), bad));
  }
});

Deno.test("transition wrapper names are a closed set of fixed module constants", () => {
  assertStringIncludes(
    adapterSource,
    'const API_V1_TRANSITION_TASK_FUNCTION_NAME = "api_v1_transition_task"',
  );
  assertStringIncludes(
    adapterSource,
    'const MCP_V1_TRANSITION_TASK_FUNCTION_NAME = "mcp_v1_transition_task"',
  );
  assert(
    /type TransitionTaskFunctionName =\s*\|\s*typeof API_V1_TRANSITION_TASK_FUNCTION_NAME\s*\|\s*typeof MCP_V1_TRANSITION_TASK_FUNCTION_NAME;/
      .test(adapterSource),
    "the transition wrapper name must be a closed internal union",
  );
  assert(
    !/export\s+(type\s+)?TransitionTaskFunctionName/.test(adapterSource),
    "the transition function-name union must not be exported",
  );
  assert(
    !/export\s+(async\s+)?function\s+invokeTransitionTask/.test(adapterSource),
    "the shared transition invocation helper must not be exported",
  );
  assert(
    /function invokeTransitionTask\(/.test(adapterSource),
    "a single shared internal transition invocation helper must exist",
  );
  // Both exported adapters take exactly (client, input): no wrapper/source arg.
  assertEquals(transitionApiV1Task.length, 2);
  assertEquals(transitionMcpV1Task.length, 2);
  const invokerRpcSites = adapterSource.match(
    /client\.rpc\(functionName, \{\s*_expected_oauth_client_id: expectedOauthClientId,\s*_task_id: taskId,\s*_expected_updated_at: expectedUpdatedAt,\s*_set_actual_start: setActualStart,/g,
  ) ?? [];
  assertEquals(
    invokerRpcSites.length,
    1,
    "exactly one Task Transition rpc call site",
  );
  assert(
    !/_TRANSITION_TASK_FUNCTION_NAME[^\n]*=[^\n]*\|/.test(adapterSource),
    "no dynamic wrapper selection",
  );
});

// -----------------------------------------------------------------------------
// B. Canonical contract reuse
// -----------------------------------------------------------------------------

Deno.test("executor reuses the canonical transition path and body parsers", () => {
  assertStringIncludes(executorSource, "parseApiV1TaskTransitionPath");
  assertStringIncludes(executorSource, "parseApiV1TransitionTaskBody");
  assertStringIncludes(executorSource, '"/v1/tasks/"');
  assertStringIncludes(executorSource, '"/transition"');
  assert(
    !/const\s+\w*Schema\s*=|z\.object\(/.test(executorSource),
    "no duplicate transition parser or schema may exist in the executor",
  );
});

Deno.test("executor forwards the canonical body as exactly 12 RPC keys", async () => {
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
  assertEquals(calls[0].name, "mcp_v1_transition_task");
  assertEquals(calls[0].args, {
    _expected_oauth_client_id: "btpm-mcp-client",
    _task_id: TASK_ID,
    _expected_updated_at: EXPECTED_UPDATED_AT,
    _set_actual_start: true,
    _actual_start_date: "2026-08-10",
    _set_actual_end: false,
    _actual_end_date: null,
    _status: "active",
    _request_id: "req-tt-0001",
    _correlation_id: "req-tt-0001",
    _idempotency_key: "idem-tt-0001",
    _payload_hash: PAYLOAD_HASH,
  });
  assertEquals(Object.keys(calls[0].args).length, 12);
  assertEquals(result.ok, true);
});

Deno.test("explicit clear semantics and null status are preserved unchanged", async () => {
  const calls: RpcCall[] = [];
  const executor = buildExecutor(
    calls,
    [],
    transitionSuccessData("applied", "planned", null, null),
  );

  const result = await executor(
    authenticatedRequest(),
    TASK_ID,
    {
      expectedUpdatedAt: EXPECTED_UPDATED_AT,
      setActualStart: true,
      actualStartDate: null,
      setActualEnd: true,
      actualEndDate: null,
      status: null,
    },
    // deno-lint-ignore no-explicit-any
    mutationContext() as any,
  );

  assertEquals(calls[0].args._set_actual_start, true);
  assertEquals(calls[0].args._actual_start_date, null);
  assertEquals(calls[0].args._set_actual_end, true);
  assertEquals(calls[0].args._actual_end_date, null);
  assertEquals(calls[0].args._status, null);
  assertEquals(calls[0].args._expected_updated_at, EXPECTED_UPDATED_AT);
  assertEquals(result.ok, true);
});

Deno.test("malformed and nil Task IDs are rejected before client and RPC", async () => {
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

Deno.test("closed six-key transition body shape is enforced by the canonical parser", async () => {
  const badBodies: unknown[] = [
    {},
    { ...canonicalBody, extra: 1 },
    { ...canonicalBody, taskId: TASK_ID },
    { ...canonicalBody, status: "planned" },
    { ...canonicalBody, status: "on_hold" },
    { ...canonicalBody, status: "cancelled" },
    { ...canonicalBody, status: undefined },
    { ...canonicalBody, expectedUpdatedAt: "yesterday" },
    { ...canonicalBody, setActualStart: "true" },
    { ...canonicalBody, setActualEnd: false, actualEndDate: "2026-08-11" },
    { ...canonicalBody, setActualStart: false },
    { expectedUpdatedAt: EXPECTED_UPDATED_AT },
    [],
    null,
    "transition",
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

Deno.test("active, completed and null request statuses are accepted", async () => {
  for (const status of ["active", "completed", null]) {
    const calls: RpcCall[] = [];
    const executor = buildExecutor(calls, []);
    const result = await executor(
      authenticatedRequest(),
      TASK_ID,
      // deno-lint-ignore no-explicit-any
      { ...canonicalBody, status } as any,
      // deno-lint-ignore no-explicit-any
      mutationContext() as any,
    );
    assertEquals(calls[0].args._status, status);
    assertEquals(result.ok, true);
  }
});

// -----------------------------------------------------------------------------
// C. Caller binding
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
  assertEquals(calls.length, 2, "exactly one RPC per invocation, no retry");
});

Deno.test("missing or malformed bearer fails before any client construction", async () => {
  for (
    const headers of [
      undefined,
      { Authorization: "token-without-scheme" },
      { Authorization: "Basic abc" },
      { Authorization: "Bearer " },
    ]
  ) {
    const calls: RpcCall[] = [];
    const factoryCalls: FactoryCall[] = [];
    const executor = buildExecutor(calls, factoryCalls);
    await assertRejects(() =>
      executor(
        new Request("https://mcp.example.test/mcp", {
          method: "POST",
          headers: headers as Record<string, string> | undefined,
        }),
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

Deno.test("no service-role key or privileged client is accepted", () => {
  assert(!/SERVICE_ROLE|service_role|serviceRole/.test(executorSource));
  assertEquals(createMcpV1TransitionTaskExecutor.length, 3);
  for (const bad of ["", "   "]) {
    assertRejectsSync(() =>
      createMcpV1TransitionTaskExecutor(
        bad,
        "anon-publishable-key",
        () => ({ rpc: () => Promise.resolve({ data: null, error: null }) }),
      )
    );
    assertRejectsSync(() =>
      createMcpV1TransitionTaskExecutor(
        "https://project.supabase.test",
        bad,
        () => ({ rpc: () => Promise.resolve({ data: null, error: null }) }),
      )
    );
  }
});

// -----------------------------------------------------------------------------
// D. Trusted context fail-closed
// -----------------------------------------------------------------------------

const INCONSISTENT_CONTEXTS: ReadonlyArray<Record<string, unknown>> = [
  { executingUserId: "user-2" },
  { sourceClientId: "other-client" },
  { correlationId: "req-other" },
  { sourceChannel: "external_api" },
  { delegationMode: "service_account" },
  { payloadHash: "NOTAHASH" },
  { payloadHash: "B".repeat(64) },
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
// E. Result preservation
// -----------------------------------------------------------------------------

Deno.test("applied / no_change / replayed outcomes pass through unchanged", async () => {
  for (const outcome of ["applied", "no_change", "replayed"]) {
    const calls: RpcCall[] = [];
    const executor = buildExecutor(
      calls,
      [],
      transitionSuccessData(outcome),
    );
    const result = await executor(
      authenticatedRequest(),
      TASK_ID,
      canonicalBody,
      // deno-lint-ignore no-explicit-any
      mutationContext() as any,
    );
    assertEquals(result.ok, true);
    if (result.ok) {
      assertEquals(result.outcome, outcome);
      assertEquals(result.taskId, TASK_ID);
      assertEquals(result.projectId, PROJECT_ID);
      assertEquals(result.phaseId, PHASE_ID);
      assertEquals(result.updatedAt, "2026-08-16T11:00:00.000Z");
    }
    assertEquals(calls.length, 1);
  }
});

Deno.test("returned Task status is not narrowed to active/completed", async () => {
  for (
    const status of ["planned", "active", "completed", "on_hold", "cancelled"]
  ) {
    const executor = buildExecutor(
      [],
      [],
      transitionSuccessData("applied", status),
    );
    const result = await executor(
      authenticatedRequest(),
      TASK_ID,
      // deno-lint-ignore no-explicit-any
      { ...canonicalBody, status: null } as any,
      // deno-lint-ignore no-explicit-any
      mutationContext() as any,
    );
    assertEquals(result.ok, true);
    if (result.ok) assertEquals(result.status, status);
  }
});

Deno.test("stale_task conflict passes through exactly and carries no timestamp", async () => {
  const calls: RpcCall[] = [];
  const executor = buildExecutor(calls, [], STALE_DATA);
  const result = await executor(
    authenticatedRequest(),
    TASK_ID,
    canonicalBody,
    // deno-lint-ignore no-explicit-any
    mutationContext() as any,
  );
  assertEquals(result, { ok: false, outcome: "conflict", code: "stale_task" });
  assertEquals(Object.keys(result).sort(), ["code", "ok", "outcome"]);
  assert(!("currentUpdatedAt" in result));
  assertEquals(calls.length, 1, "no retry after stale");
});

Deno.test("bounded negative outcomes are returned unchanged with no retry", async () => {
  for (
    const outcome of [
      "invalid",
      "not_authorized",
      "idempotency_conflict",
      "idempotency_pending",
    ] as const
  ) {
    const calls: RpcCall[] = [];
    const executor = buildExecutor(calls, [], {
      data: { ok: false, outcome },
      error: null,
    });
    const result = await executor(
      authenticatedRequest(),
      TASK_ID,
      canonicalBody,
      // deno-lint-ignore no-explicit-any
      mutationContext() as any,
    );
    assertEquals(result, { ok: false, outcome });
    assertEquals(calls.length, 1, "exactly one RPC, no retry");
  }
});

// -----------------------------------------------------------------------------
// F. Forbidden surfaces
// -----------------------------------------------------------------------------

Deno.test("executor introduces no forbidden surface", () => {
  assert(!/Deno\.env/.test(executorSource));
  assert(!/fetch\(/.test(executorSource));
  assert(!/\.from\(/.test(executorSource));
  assert(!/console\./.test(executorSource));
  assert(!/setTimeout|setInterval/.test(executorSource));
  assert(!/hashCanonicalPayload|sha256|crypto\./.test(executorSource));
  assert(!/confirmation/.test(executorCode));
  assert(!/@supabase\/supabase-js/.test(executorSource));
  assert(
    !/new Date\(|toISOString|Date\.now/.test(executorSource),
    "no timestamp construction or refresh",
  );
  assert(
    !/get_task|api_v1_get_task|mcp_v1_get_task|select\(/.test(executorSource),
    "no read-before-write",
  );
  assert(
    !/\bapi_v1_transition_task\b|transitionApiV1Task|apply_task_execution_change|reopen_task|pmg_|client\.rpc\(|\.rpc\(/
      .test(executorCode),
    "no REST wrapper, canonical command or direct rpc call may be referenced",
  );
  assert(
    !/\bmcp_v1_transition_task\b/.test(executorCode),
    "the sole wrapper choice must stay encapsulated in transitionMcpV1Task",
  );
  assert(
    !/preview_task_planning_change|apply_task_planning_change/
      .test(executorCode),
  );
  assert(!/registerTool|MCP_TOOL_REGISTRY|serverFactory/.test(executorSource));
  assert(!/for\s*\(|while\s*\(/.test(executorSource), "no retry loop");
  assert(!/\blet\s+\w+\s*=\s*(new\s+Map|new\s+Set|\[\])/.test(executorCode));
  const invocations =
    executorSource.match(/transitionMcpV1Task\(client, \{/g) ?? [];
  assertEquals(invocations.length, 1, "exactly one fixed MCP invocation site");
});
