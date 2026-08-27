// API-Q Task Reorder Step 2 — focused guard for the caller-bound MCP
// Task-reorder adapter.
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
  reorderApiV1Tasks,
  reorderMcpV1Tasks,
} from "../../functions/_shared/btpm-api/supabaseTask.ts";
import { createMcpV1ReorderTasksExecutor } from "../../functions/btpm-mcp/mcp/taskReorderMutationExecutor.ts";

const ADAPTER_URL = new URL(
  "../../functions/_shared/btpm-api/supabaseTask.ts",
  import.meta.url,
);
const EXECUTOR_URL = new URL(
  "../../functions/btpm-mcp/mcp/taskReorderMutationExecutor.ts",
  import.meta.url,
);

const adapterSource = await Deno.readTextFile(ADAPTER_URL);
const executorSource = await Deno.readTextFile(EXECUTOR_URL);

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const PHASE_ID = "22222222-2222-4222-8222-222222222222";
const TASK_A = "33333333-3333-4333-8333-333333333333";
const TASK_B = "44444444-4444-4444-8444-444444444444";
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const PAYLOAD_HASH = "e".repeat(64);
const UPDATED_AT_A = "2026-08-14T04:00:00.123456+02:00";
const UPDATED_AT_B = "2026-08-14T05:30:00Z";

const canonicalBody = Object.freeze({
  rows: Object.freeze([
    Object.freeze({
      taskId: TASK_A,
      expectedUpdatedAt: UPDATED_AT_A,
      sortOrder: 0,
    }),
    Object.freeze({
      taskId: TASK_B,
      expectedUpdatedAt: UPDATED_AT_B,
      sortOrder: 1,
    }),
  ]),
});

function reorderSuccessData(outcome = "applied") {
  return {
    data: {
      ok: true,
      outcome,
      projectId: PROJECT_ID,
      phaseId: PHASE_ID,
      submittedCount: 2,
      changedCount: 2,
      orderedTasks: [
        { taskId: TASK_A, sortOrder: 0, updatedAt: UPDATED_AT_B },
        { taskId: TASK_B, sortOrder: 1, updatedAt: UPDATED_AT_B },
      ],
    },
    error: null,
  };
}

interface RpcCall {
  readonly name: string;
  readonly args: Record<string, unknown>;
}

function recordingClient(calls: RpcCall[], data = reorderSuccessData()) {
  return {
    rpc(name: string, args: unknown) {
      calls.push({ name, args: { ...(args as Record<string, unknown>) } });
      return Promise.resolve(data);
    },
  };
}

const adapterInput = Object.freeze({
  expectedOauthClientId: "btpm-mcp-client",
  phaseId: PHASE_ID,
  rows: canonicalBody.rows,
  requestId: "req-tr-0001",
  correlationId: "req-tr-0001",
  idempotencyKey: "idem-tr-0001",
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
    requestId: "req-tr-0001",
    correlationId: "req-tr-0001",
    sourceChannel: "mcp",
    sourceClientId: "api-client-1",
    delegationMode: "delegated_user",
    idempotencyKey: "idem-tr-0001",
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
  return createMcpV1ReorderTasksExecutor(
    "https://project.supabase.test",
    "anon-publishable-key",
    (url, key, options) => {
      factoryCalls.push({
        url,
        key,
        options: options as unknown as Record<string, unknown>,
      });
      return recordingClient(calls, data ?? reorderSuccessData());
    },
  );
}

// -----------------------------------------------------------------------------
// A. Fixed supabaseTask reorder adapters
// -----------------------------------------------------------------------------

Deno.test("REST Task reorder still calls only api_v1_reorder_tasks", async () => {
  const calls: RpcCall[] = [];
  const result = await reorderApiV1Tasks(recordingClient(calls), adapterInput);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, "api_v1_reorder_tasks");
  assertEquals(result.ok, true);
});

Deno.test("MCP Task reorder calls only mcp_v1_reorder_tasks", async () => {
  const calls: RpcCall[] = [];
  const result = await reorderMcpV1Tasks(recordingClient(calls), adapterInput);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, "mcp_v1_reorder_tasks");
  assertEquals(result.ok, true);
});

Deno.test("REST and MCP Task reorder share identical validation and mapping", async () => {
  const restCalls: RpcCall[] = [];
  const mcpCalls: RpcCall[] = [];
  const rest = await reorderApiV1Tasks(
    recordingClient(restCalls),
    adapterInput,
  );
  const mcp = await reorderMcpV1Tasks(recordingClient(mcpCalls), adapterInput);
  assertEquals(restCalls[0].args, mcpCalls[0].args);
  assertEquals(Object.keys(restCalls[0].args).length, 7);
  assertEquals(rest, mcp);

  const bad = { ...adapterInput, payloadHash: "nope" };
  await assertRejects(() => reorderApiV1Tasks(recordingClient([]), bad));
  await assertRejects(() => reorderMcpV1Tasks(recordingClient([]), bad));

  const badPhase = { ...adapterInput, phaseId: "not-a-uuid" };
  await assertRejects(() => reorderApiV1Tasks(recordingClient([]), badPhase));
  await assertRejects(() => reorderMcpV1Tasks(recordingClient([]), badPhase));

  const emptyRows = { ...adapterInput, rows: [] };
  await assertRejects(() => reorderApiV1Tasks(recordingClient([]), emptyRows));
  await assertRejects(() => reorderMcpV1Tasks(recordingClient([]), emptyRows));
});

Deno.test("reorder wrapper names are a closed set of fixed module constants", () => {
  assertStringIncludes(
    adapterSource,
    'const API_V1_REORDER_TASKS_FUNCTION_NAME = "api_v1_reorder_tasks"',
  );
  assertStringIncludes(
    adapterSource,
    'const MCP_V1_REORDER_TASKS_FUNCTION_NAME = "mcp_v1_reorder_tasks"',
  );
  assert(
    /type ReorderTasksFunctionName =\s*\|\s*typeof API_V1_REORDER_TASKS_FUNCTION_NAME\s*\|\s*typeof MCP_V1_REORDER_TASKS_FUNCTION_NAME;/
      .test(adapterSource),
    "the reorder wrapper name must be a closed internal union",
  );
  assertEquals(reorderApiV1Tasks.length, 2);
  assertEquals(reorderMcpV1Tasks.length, 2);
  assert(
    !/export\s+(async\s+)?function\s+invokeReorderTasks/.test(adapterSource),
    "the shared reorder invocation helper must not be exported",
  );
  assert(
    /function invokeReorderTasks\(/.test(adapterSource),
    "a single shared internal reorder invocation helper must exist",
  );
  const invokerRpcSites =
    adapterSource.match(/client\.rpc\(functionName, \{\s*_expected_oauth_client_id: expectedOauthClientId,\s*_phase_id: phaseId,\s*_rows:/g) ??
      [];
  assertEquals(
    invokerRpcSites.length,
    1,
    "exactly one Task Reorder rpc call site",
  );
  assert(!/operationId/.test(adapterSource), "no operationId dispatch");
});

Deno.test("stale_task_order mapping remains unchanged", async () => {
  // deno-lint-ignore no-explicit-any
  const staleData: any = {
    data: {
      ok: false,
      outcome: "conflict",
      code: "stale_task_order",
      projectId: PROJECT_ID,
      phaseId: PHASE_ID,
      staleTaskIds: [TASK_A],
    },
    error: null,
  };
  const rest = await reorderApiV1Tasks(
    recordingClient([], staleData),
    adapterInput,
  );
  const mcp = await reorderMcpV1Tasks(
    recordingClient([], staleData),
    adapterInput,
  );
  assertEquals(rest, mcp);
  assertEquals(rest.ok, false);
  assertEquals((rest as { code?: string }).code, "stale_task_order");
});

Deno.test("failed-replay normalization never invents stale Task IDs", async () => {
  // deno-lint-ignore no-explicit-any
  const replayData: any = {
    data: {
      ok: false,
      outcome: "conflict",
      code: "stale_task_order",
    },
    error: null,
  };
  const mcp = await reorderMcpV1Tasks(
    recordingClient([], replayData),
    adapterInput,
  );
  assertEquals(mcp.ok, false);
  assertEquals((mcp as { staleTaskIds?: readonly string[] }).staleTaskIds, []);
});

Deno.test("applied / no_change / replayed handling is unchanged across sources", async () => {
  for (const outcome of ["applied", "no_change", "replayed"]) {
    const rest = await reorderApiV1Tasks(
      recordingClient([], reorderSuccessData(outcome)),
      adapterInput,
    );
    const mcp = await reorderMcpV1Tasks(
      recordingClient([], reorderSuccessData(outcome)),
      adapterInput,
    );
    assertEquals(rest, mcp);
    assertEquals(rest.ok, true);
    if (rest.ok) assertEquals(rest.outcome, outcome);
  }
});

// -----------------------------------------------------------------------------
// B. Exact Task Reorder RPC arguments
// -----------------------------------------------------------------------------

Deno.test("executor passes canonical arguments and row mapping through unchanged", async () => {
  const calls: RpcCall[] = [];
  const factoryCalls: FactoryCall[] = [];
  const executor = buildExecutor(calls, factoryCalls);

  const result = await executor(
    authenticatedRequest(),
    PHASE_ID,
    { rows: canonicalBody.rows },
    // deno-lint-ignore no-explicit-any
    mutationContext() as any,
  );

  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, "mcp_v1_reorder_tasks");
  assertEquals(calls[0].args, {
    _expected_oauth_client_id: "btpm-mcp-client",
    _phase_id: PHASE_ID,
    _rows: [
      { id: TASK_A, expected_updated_at: UPDATED_AT_A, new_sort_order: 0 },
      { id: TASK_B, expected_updated_at: UPDATED_AT_B, new_sort_order: 1 },
    ],
    _request_id: "req-tr-0001",
    _correlation_id: "req-tr-0001",
    _idempotency_key: "idem-tr-0001",
    _payload_hash: PAYLOAD_HASH,
  });
  assertEquals(result.ok, true);
});

// -----------------------------------------------------------------------------
// C. Caller-bound execution
// -----------------------------------------------------------------------------

Deno.test("fresh anon-key client bound to the current bearer per invocation", async () => {
  const calls: RpcCall[] = [];
  const factoryCalls: FactoryCall[] = [];
  const executor = buildExecutor(calls, factoryCalls);

  await executor(
    authenticatedRequest("token-one"),
    PHASE_ID,
    { rows: canonicalBody.rows },
    // deno-lint-ignore no-explicit-any
    mutationContext() as any,
  );
  await executor(
    authenticatedRequest("token-two"),
    PHASE_ID,
    { rows: canonicalBody.rows },
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
        PHASE_ID,
        { rows: canonicalBody.rows },
        // deno-lint-ignore no-explicit-any
        mutationContext() as any,
      )
    );
    assertEquals(factoryCalls.length, 0);
    assertEquals(calls.length, 0);
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
  { payloadHash: "E".repeat(64) },
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
          PHASE_ID,
          { rows: canonicalBody.rows },
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
// E. Canonical Task Reorder semantics
// -----------------------------------------------------------------------------

Deno.test("executor reuses the canonical Phase path and reorder body parsers", () => {
  assertStringIncludes(executorSource, "parseApiV1TaskReorderPath");
  assertStringIncludes(executorSource, "parseApiV1ReorderTasksBody");
  assertStringIncludes(executorSource, '"/v1/phases/"');
  assertStringIncludes(executorSource, '"/tasks/reorder"');
  assert(
    !/const\s+\w*Schema\s*=|z\.object\(/.test(executorSource),
    "no duplicate reorder parser or schema may exist in the executor",
  );
});

Deno.test("malformed and nil Phase IDs are rejected", async () => {
  for (
    const badId of [
      "",
      "not-a-uuid",
      NIL_UUID,
      `${PHASE_ID}/extra`,
      ` ${PHASE_ID}`,
    ]
  ) {
    const calls: RpcCall[] = [];
    const factoryCalls: FactoryCall[] = [];
    const executor = buildExecutor(calls, factoryCalls);
    await assertRejects(() =>
      executor(
        authenticatedRequest(),
        badId,
        { rows: canonicalBody.rows },
        // deno-lint-ignore no-explicit-any
        mutationContext() as any,
      )
    );
    assertEquals(factoryCalls.length, 0);
    assertEquals(calls.length, 0);
  }
});

Deno.test("closed reorder body shape is enforced by the canonical parser", async () => {
  const oversized = Array.from({ length: 5000 }, (_, index) => ({
    taskId: TASK_A,
    expectedUpdatedAt: UPDATED_AT_A,
    sortOrder: index,
  }));
  const badBodies: unknown[] = [
    {},
    { rows: [] },
    { rows: oversized },
    { rows: [{ taskId: TASK_A, sortOrder: 0 }] },
    {
      rows: [{
        taskId: TASK_A,
        expectedUpdatedAt: UPDATED_AT_A,
        sortOrder: 0,
        extra: 1,
      }],
    },
    { rows: canonicalBody.rows, phaseId: PHASE_ID },
  ];
  for (const body of badBodies) {
    const calls: RpcCall[] = [];
    const factoryCalls: FactoryCall[] = [];
    const executor = buildExecutor(calls, factoryCalls);
    await assertRejects(
      () =>
        executor(
          authenticatedRequest(),
          PHASE_ID,
          // deno-lint-ignore no-explicit-any
          body as any,
          // deno-lint-ignore no-explicit-any
          mutationContext() as any,
        ),
      Error,
      undefined,
      "body must be rejected",
    );
    assertEquals(factoryCalls.length, 0);
    assertEquals(calls.length, 0);
  }
});

Deno.test("stale_task_order is returned unchanged with no retry or read-before-write", async () => {
  const calls: RpcCall[] = [];
  const executor = buildExecutor(calls, [], {
    data: {
      ok: false,
      outcome: "conflict",
      code: "stale_task_order",
      projectId: PROJECT_ID,
      phaseId: PHASE_ID,
      staleTaskIds: [TASK_A],
    },
    error: null,
  });
  const result = await executor(
    authenticatedRequest(),
    PHASE_ID,
    { rows: canonicalBody.rows },
    // deno-lint-ignore no-explicit-any
    mutationContext() as any,
  );
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.outcome, "conflict");
    assertEquals((result as { code?: string }).code, "stale_task_order");
  }
  assertEquals(calls.length, 1, "exactly one RPC, no retry");
  const rows = calls[0].args._rows as ReadonlyArray<
    Record<string, unknown>
  >;
  assertEquals(rows[0].id, TASK_A);
  assertEquals(rows[1].id, TASK_B);
  assertEquals(rows[0].expected_updated_at, UPDATED_AT_A);
  assertEquals(rows[1].expected_updated_at, UPDATED_AT_B);
});

Deno.test("expectedUpdatedAt values are never refreshed or reformatted", () => {
  assert(!/new Date\(/.test(executorSource));
  assert(!/toISOString/.test(executorSource));
  assert(!/Date\.now/.test(executorSource));
  assert(!/get_task|api_v1_get_task|mcp_v1_get_task/.test(executorSource));
  assert(!/\.sort\(/.test(executorSource), "no client-side row sorting");
  assertStringIncludes(executorSource, "rows: canonicalBody.rows,");
});

// -----------------------------------------------------------------------------
// F. Forbidden surfaces
// -----------------------------------------------------------------------------

Deno.test("executor introduces no forbidden surface", () => {
  assert(!/SERVICE_ROLE|service_role|serviceRole/.test(executorSource));
  assert(!/Deno\.env/.test(executorSource));
  assert(!/fetch\(/.test(executorSource));
  assert(!/\.from\(/.test(executorSource));
  assert(!/console\./.test(executorSource));
  assert(!/setTimeout|setInterval/.test(executorSource));
  assert(!/hashCanonicalPayload|sha256|crypto\./.test(executorSource));
  assert(!/confirmation/.test(executorSource.replace(/\/\/.*$/gm, "")));
  assert(
    !/pmg_|\bapi_v1_reorder_tasks\b|reorderApiV1Tasks|apply_task|client\.rpc\(/
      .test(
        executorSource,
      ),
  );
  assert(!/registerTool|MCP_TOOL_REGISTRY|serverFactory/.test(executorSource));
  assert(!/for\s*\(|while\s*\(/.test(executorSource), "no retry loop");
  const invocations = executorSource.match(/reorderMcpV1Tasks\(client, \{/g) ??
    [];
  assertEquals(invocations.length, 1, "exactly one fixed MCP invocation site");
});
