// API-Q Task Update Step 2 — focused guard for the caller-bound MCP
// Task-update adapter.
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
  updateApiV1Task,
  updateMcpV1Task,
} from "../../functions/_shared/btpm-api/supabaseTask.ts";
import { createMcpV1UpdateTaskExecutor } from "../../functions/btpm-mcp/mcp/taskUpdateMutationExecutor.ts";


const ADAPTER_URL = new URL(
  "../../functions/_shared/btpm-api/supabaseTask.ts",
  import.meta.url,
);
const EXECUTOR_URL = new URL(
  "../../functions/btpm-mcp/mcp/taskUpdateMutationExecutor.ts",
  import.meta.url,
);

const adapterSource = await Deno.readTextFile(ADAPTER_URL);
const executorSource = await Deno.readTextFile(EXECUTOR_URL);

const TASK_ID = "44444444-4444-4444-8444-444444444444";
const PHASE_ID = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const PAYLOAD_HASH = "e".repeat(64);
const EXPECTED_UPDATED_AT = "2026-08-15T04:00:00.123456+02:00";
const RESULT_TIMESTAMP = "2026-08-16T06:15:00Z";

const canonicalBody = Object.freeze({
  expectedUpdatedAt: EXPECTED_UPDATED_AT,
  name: "Configure workflow",
  description: null,
  status: "active" as const,
  priority: "high" as const,
  taskType: "work_item" as const,
  estimatedHours: null,
});

function updateSuccessData(outcome = "applied") {
  return {
    data: {
      ok: true,
      outcome,
      taskId: TASK_ID,
      projectId: PROJECT_ID,
      phaseId: PHASE_ID,
      status: "active",
      priority: "high",
      taskType: "work_item",
      estimatedHours: null,
      updatedAt: RESULT_TIMESTAMP,
    },
    error: null,
  };
}

interface RpcCall {
  readonly name: string;
  readonly args: Record<string, unknown>;
}

interface RpcResult {
  readonly data: Record<string, unknown> | null;
  readonly error: { readonly message: string } | null;
}

function recordingClient(
  calls: RpcCall[],
  data: RpcResult = updateSuccessData(),
) {
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
  ...canonicalBody,
  requestId: "req-tu-0001",
  correlationId: "req-tu-0001",
  idempotencyKey: "idem-tu-0001",
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
    requestId: "req-tu-0001",
    correlationId: "req-tu-0001",
    sourceChannel: "mcp",
    sourceClientId: "api-client-1",
    delegationMode: "delegated_user",
    idempotencyKey: "idem-tu-0001",
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
  return createMcpV1UpdateTaskExecutor(
    "https://project.supabase.test",
    "anon-publishable-key",
    (url, key, options) => {
      factoryCalls.push({
        url,
        key,
        options: options as unknown as Record<string, unknown>,
      });
      return recordingClient(calls, data ?? updateSuccessData());
    },
  );
}

// -----------------------------------------------------------------------------
// A. Fixed supabaseTask update adapters
// -----------------------------------------------------------------------------

Deno.test("REST Task update still calls only api_v1_update_task", async () => {
  const calls: RpcCall[] = [];
  const result = await updateApiV1Task(recordingClient(calls), adapterInput);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, "api_v1_update_task");
  assertEquals(result.ok, true);
});

Deno.test("MCP Task update calls only mcp_v1_update_task", async () => {
  const calls: RpcCall[] = [];
  const result = await updateMcpV1Task(recordingClient(calls), adapterInput);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, "mcp_v1_update_task");
  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.taskId, TASK_ID);
});

Deno.test("REST and MCP Task update share identical validation and mapping", async () => {
  const restCalls: RpcCall[] = [];
  const mcpCalls: RpcCall[] = [];
  const rest = await updateApiV1Task(recordingClient(restCalls), adapterInput);
  const mcp = await updateMcpV1Task(recordingClient(mcpCalls), adapterInput);
  assertEquals(restCalls[0].args, mcpCalls[0].args);
  assertEquals(rest, mcp);

  const bad = { ...adapterInput, payloadHash: "nope" };
  await assertRejects(() => updateApiV1Task(recordingClient([]), bad));
  await assertRejects(() => updateMcpV1Task(recordingClient([]), bad));

  const badId = { ...adapterInput, taskId: "not-a-uuid" };
  await assertRejects(() => updateApiV1Task(recordingClient([]), badId));
  await assertRejects(() => updateMcpV1Task(recordingClient([]), badId));

  const mapperDefs = adapterSource.match(/function toUpdateResult\(/g) ?? [];
  assertEquals(mapperDefs.length, 1, "one bounded update result contract only");
});

Deno.test("Task update wrapper names are a closed set of fixed module constants", () => {
  assertStringIncludes(
    adapterSource,
    'const API_V1_UPDATE_TASK_FUNCTION_NAME = "api_v1_update_task"',
  );
  assertStringIncludes(
    adapterSource,
    'const MCP_V1_UPDATE_TASK_FUNCTION_NAME = "mcp_v1_update_task"',
  );
  assert(
    /type UpdateTaskFunctionName =\s*\|\s*typeof API_V1_UPDATE_TASK_FUNCTION_NAME\s*\|\s*typeof MCP_V1_UPDATE_TASK_FUNCTION_NAME;/
      .test(adapterSource),
    "the update wrapper name must be a closed internal union",
  );
  assertEquals(updateApiV1Task.length, 2);
  assertEquals(updateMcpV1Task.length, 2);
  assert(
    !/export\s+(async\s+)?function\s+invokeUpdateTask/.test(adapterSource),
    "the shared update invocation helper must not be exported",
  );
  assert(
    /function invokeUpdateTask\(/.test(adapterSource),
    "a single shared internal update invocation helper must exist",
  );
  assert(
    /client\.rpc\(functionName, \{\s*_expected_oauth_client_id: expectedOauthClientId,\s*_task_id: taskId,\s*_expected_updated_at: expectedUpdatedAt,/
      .test(adapterSource),
    "the shared update invoker must build the exact fixed RPC arguments",
  );
  const updateRpcSites = adapterSource.match(
    /client\.rpc\((API_V1_UPDATE_TASK_FUNCTION_NAME|MCP_V1_UPDATE_TASK_FUNCTION_NAME)/g,
  ) ?? [];
  assertEquals(
    updateRpcSites.length,
    0,
    "no direct update RPC site outside the shared invoker",
  );
});

Deno.test("stale_task mapping remains unchanged", async () => {
  const staleData = {
    data: { ok: false, outcome: "conflict", code: "stale_task" },
    error: null,
  };
  const rest = await updateApiV1Task(
    recordingClient([], staleData),
    adapterInput,
  );
  const mcp = await updateMcpV1Task(
    recordingClient([], staleData),
    adapterInput,
  );
  assertEquals(rest, mcp);
  assertEquals(rest, { ok: false, outcome: "conflict", code: "stale_task" });
});

Deno.test("applied / no_change / replayed handling is unchanged across sources", async () => {
  for (const outcome of ["applied", "no_change", "replayed"]) {
    const rest = await updateApiV1Task(
      recordingClient([], updateSuccessData(outcome)),
      adapterInput,
    );
    const mcp = await updateMcpV1Task(
      recordingClient([], updateSuccessData(outcome)),
      adapterInput,
    );
    assertEquals(rest, mcp);
    assertEquals(rest.ok, true);
    if (rest.ok) assertEquals(rest.outcome, outcome);
  }
});

Deno.test("bounded negative outcomes are unchanged across sources", async () => {
  const negative = {
    data: { ok: false, outcome: "not_authorized" },
    error: null,
  };
  const rest = await updateApiV1Task(
    recordingClient([], negative),
    adapterInput,
  );
  const mcp = await updateMcpV1Task(recordingClient([], negative), adapterInput);
  assertEquals(rest, mcp);
  assertEquals(rest.ok, false);
});

// -----------------------------------------------------------------------------
// B. Exact Task Update RPC arguments
// -----------------------------------------------------------------------------

Deno.test("executor passes canonical arguments through unchanged", async () => {
  const calls: RpcCall[] = [];
  const factoryCalls: FactoryCall[] = [];
  const executor = buildExecutor(calls, factoryCalls);

  const result = await executor(
    authenticatedRequest(),
    TASK_ID,
    { ...canonicalBody },
    // deno-lint-ignore no-explicit-any
    mutationContext() as any,
  );

  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, "mcp_v1_update_task");
  assertEquals(calls[0].args, {
    _expected_oauth_client_id: "btpm-mcp-client",
    _task_id: TASK_ID,
    _expected_updated_at: EXPECTED_UPDATED_AT,
    _name: canonicalBody.name,
    _description: null,
    _status: "active",
    _priority: "high",
    _task_type: "work_item",
    _estimated_hours: null,
    _request_id: "req-tu-0001",
    _correlation_id: "req-tu-0001",
    _idempotency_key: "idem-tu-0001",
    _payload_hash: PAYLOAD_HASH,
  });
  assertEquals(result.ok, true);
});

Deno.test("non-null description and estimatedHours are forwarded verbatim", async () => {
  const calls: RpcCall[] = [];
  const executor = buildExecutor(calls, []);
  await executor(
    authenticatedRequest(),
    TASK_ID,
    { ...canonicalBody, description: "desc text", estimatedHours: 7.5 },
    // deno-lint-ignore no-explicit-any
    mutationContext() as any,
  );
  assertEquals(calls[0].args._description, "desc text");
  assertEquals(calls[0].args._estimated_hours, 7.5);
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
    TASK_ID,
    { ...canonicalBody },
    // deno-lint-ignore no-explicit-any
    mutationContext() as any,
  );
  await executor(
    authenticatedRequest("token-two"),
    TASK_ID,
    { ...canonicalBody },
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

Deno.test("missing bearer fails before any client construction", async () => {
  const calls: RpcCall[] = [];
  const factoryCalls: FactoryCall[] = [];
  const executor = buildExecutor(calls, factoryCalls);
  await assertRejects(() =>
    executor(
      new Request("https://mcp.example.test/mcp", { method: "POST" }),
      TASK_ID,
      { ...canonicalBody },
      // deno-lint-ignore no-explicit-any
      mutationContext() as any,
    )
  );
  assertEquals(factoryCalls.length, 0);
  assertEquals(calls.length, 0);
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
          TASK_ID,
          { ...canonicalBody },
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
// E. Canonical Task Update semantics
// -----------------------------------------------------------------------------

Deno.test("executor reuses the canonical Task path and body parsers", () => {
  assertStringIncludes(executorSource, "parseApiV1TaskUpdatePath");
  assertStringIncludes(executorSource, "parseApiV1UpdateTaskBody");
  assertStringIncludes(executorSource, '"/v1/tasks/"');
  assert(
    !/const\s+\w*Schema\s*=|z\.object\(/.test(executorSource),
    "no duplicate Task parser or schema may exist in the executor",
  );
});

Deno.test("malformed and nil Task IDs are rejected", async () => {
  for (
    const badId of ["", "not-a-uuid", NIL_UUID, `${TASK_ID}/extra`, ` ${TASK_ID}`]
  ) {
    const calls: RpcCall[] = [];
    const factoryCalls: FactoryCall[] = [];
    const executor = buildExecutor(calls, factoryCalls);
    await assertRejects(() =>
      executor(
        authenticatedRequest(),
        badId,
        { ...canonicalBody },
        // deno-lint-ignore no-explicit-any
        mutationContext() as any,
      )
    );
    assertEquals(factoryCalls.length, 0);
    assertEquals(calls.length, 0);
  }
});

Deno.test("all seven desired-state body fields remain required, no extras", async () => {
  assertEquals(Object.keys(canonicalBody).length, 7);
  for (const key of Object.keys(canonicalBody)) {
    const partial: Record<string, unknown> = { ...canonicalBody };
    delete partial[key];
    const calls: RpcCall[] = [];
    const executor = buildExecutor(calls, []);
    await assertRejects(
      () =>
        executor(
          authenticatedRequest(),
          TASK_ID,
          // deno-lint-ignore no-explicit-any
          partial as any,
          // deno-lint-ignore no-explicit-any
          mutationContext() as any,
        ),
      Error,
      undefined,
      `${key} must remain required`,
    );
    assertEquals(calls.length, 0);
  }

  const calls: RpcCall[] = [];
  const executor = buildExecutor(calls, []);
  await assertRejects(() =>
    executor(
      authenticatedRequest(),
      TASK_ID,
      // deno-lint-ignore no-explicit-any
      { ...canonicalBody, startDate: "2026-01-01" } as any,
      // deno-lint-ignore no-explicit-any
      mutationContext() as any,
    )
  );
  assertEquals(calls.length, 0);
});

Deno.test("stale_task is returned unchanged with no retry or read-before-write", async () => {
  const calls: RpcCall[] = [];
  const executor = buildExecutor(calls, [], {
    data: { ok: false, outcome: "conflict", code: "stale_task" },
    error: null,
  });
  const result = await executor(
    authenticatedRequest(),
    TASK_ID,
    { ...canonicalBody },
    // deno-lint-ignore no-explicit-any
    mutationContext() as any,
  );
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.outcome, "conflict");
    assertEquals((result as { code?: string }).code, "stale_task");
  }
  assertEquals(calls.length, 1, "exactly one RPC, no retry");
  assertEquals(calls[0].args._expected_updated_at, EXPECTED_UPDATED_AT);
});

Deno.test("expectedUpdatedAt is never refreshed or reformatted", () => {
  assert(!/new Date\(/.test(executorSource));
  assert(!/toISOString/.test(executorSource));
  assert(!/Date\.now/.test(executorSource));
  assert(!/get_task|api_v1_get_task|mcp_v1_get_task/.test(executorSource));
  assertStringIncludes(
    executorSource,
    "expectedUpdatedAt: canonicalBody.expectedUpdatedAt,",
  );
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
  assert(
    !/pmg_|apply_task_update|api_v1_update_task|updateApiV1Task/.test(
      executorSource,
    ),
  );
  assert(!/registerTool|MCP_TOOL_REGISTRY|serverFactory/.test(executorSource));
  assert(!/for\s*\(|while\s*\(/.test(executorSource), "no retry loop");
  const invocations = executorSource.match(/updateMcpV1Task\(client, \{/g) ?? [];
  assertEquals(invocations.length, 1, "exactly one fixed MCP invocation site");
});

Deno.test("the canonical Task adapter exports remain present and unchanged", () => {
  for (
    const name of [
      "createApiV1Task",
      "createMcpV1Task",
      "reorderApiV1Tasks",
      "planApiV1Task",
      "assignApiV1Task",
      "transitionApiV1Task",
    ]
  ) {
    assert(
      new RegExp(`export (async )?function ${name}\\(`).test(adapterSource),
      `${name} must remain exported unchanged`,
    );
  }
});
