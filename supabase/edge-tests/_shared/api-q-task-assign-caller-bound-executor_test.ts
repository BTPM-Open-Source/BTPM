// API-Q Task Assign Step 2 — focused guard for the caller-bound MCP
// Task-assign adapter.
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
  assignApiV1Task,
  assignMcpV1Task,
} from "../../functions/_shared/btpm-api/supabaseTask.ts";
import { createMcpV1AssignTaskExecutor } from "../../functions/btpm-mcp/mcp/taskAssignMutationExecutor.ts";

const ADAPTER_URL = new URL(
  "../../functions/_shared/btpm-api/supabaseTask.ts",
  import.meta.url,
);
const EXECUTOR_URL = new URL(
  "../../functions/btpm-mcp/mcp/taskAssignMutationExecutor.ts",
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
const ASSIGNEE_ID = "55555555-5555-4555-8555-555555555555";
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const PAYLOAD_HASH = "a".repeat(64);

function assignSuccessData(
  outcome = "applied",
  newAssigneeId: string | null = ASSIGNEE_ID,
) {
  return {
    data: {
      ok: true,
      outcome,
      taskId: TASK_ID,
      projectId: PROJECT_ID,
      oldAssigneeId: null,
      newAssigneeId,
    },
    error: null,
  };
}

interface RpcCall {
  readonly name: string;
  readonly args: Record<string, unknown>;
}

function recordingClient(calls: RpcCall[], data = assignSuccessData()) {
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
  assigneeId: ASSIGNEE_ID,
  requestId: "req-ta-0001",
  correlationId: "req-ta-0001",
  idempotencyKey: "idem-ta-0001",
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
    requestId: "req-ta-0001",
    correlationId: "req-ta-0001",
    sourceChannel: "mcp",
    sourceClientId: "api-client-1",
    delegationMode: "delegated_user",
    idempotencyKey: "idem-ta-0001",
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
  return createMcpV1AssignTaskExecutor(
    "https://project.supabase.test",
    "anon-publishable-key",
    (url, key, options) => {
      factoryCalls.push({
        url,
        key,
        options: options as unknown as Record<string, unknown>,
      });
      return recordingClient(calls, data ?? assignSuccessData());
    },
  );
}

// -----------------------------------------------------------------------------
// A. Fixed supabaseTask assign adapters
// -----------------------------------------------------------------------------

Deno.test("REST Task assign still calls only api_v1_assign_task", async () => {
  const calls: RpcCall[] = [];
  const result = await assignApiV1Task(recordingClient(calls), adapterInput);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, "api_v1_assign_task");
  assertEquals(result.ok, true);
});

Deno.test("MCP Task assign calls only mcp_v1_assign_task", async () => {
  const calls: RpcCall[] = [];
  const result = await assignMcpV1Task(recordingClient(calls), adapterInput);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, "mcp_v1_assign_task");
  assertEquals(result.ok, true);
});

Deno.test("REST and MCP Task assign share identical validation and mapping", async () => {
  const restCalls: RpcCall[] = [];
  const mcpCalls: RpcCall[] = [];
  const rest = await assignApiV1Task(recordingClient(restCalls), adapterInput);
  const mcp = await assignMcpV1Task(recordingClient(mcpCalls), adapterInput);
  assertEquals(restCalls[0].args, mcpCalls[0].args);
  assertEquals(Object.keys(restCalls[0].args).length, 7);
  assertEquals(rest, mcp);

  for (
    const bad of [
      { ...adapterInput, payloadHash: "nope" },
      { ...adapterInput, taskId: "not-a-uuid" },
      { ...adapterInput, assigneeId: "not-a-uuid" },
      { ...adapterInput, taskId: NIL_UUID },
      { ...adapterInput, expectedOauthClientId: "" },
      { ...adapterInput, idempotencyKey: "" },
    ]
  ) {
    await assertRejects(() => assignApiV1Task(recordingClient([]), bad));
    await assertRejects(() => assignMcpV1Task(recordingClient([]), bad));
  }
});

Deno.test("assign wrapper names are a closed set of fixed module constants", () => {
  assertStringIncludes(
    adapterSource,
    'const API_V1_ASSIGN_TASK_FUNCTION_NAME = "api_v1_assign_task"',
  );
  assertStringIncludes(
    adapterSource,
    'const MCP_V1_ASSIGN_TASK_FUNCTION_NAME = "mcp_v1_assign_task"',
  );
  assert(
    /type AssignTaskFunctionName =\s*\|\s*typeof API_V1_ASSIGN_TASK_FUNCTION_NAME\s*\|\s*typeof MCP_V1_ASSIGN_TASK_FUNCTION_NAME;/
      .test(adapterSource),
    "the assign wrapper name must be a closed internal union",
  );
  assert(
    !/export\s+(type\s+)?AssignTaskFunctionName/.test(adapterSource),
    "the assign function-name union must not be exported",
  );
  assert(
    !/export\s+(async\s+)?function\s+invokeAssignTask/.test(adapterSource),
    "the shared assign invocation helper must not be exported",
  );
  assert(
    /function invokeAssignTask\(/.test(adapterSource),
    "a single shared internal assign invocation helper must exist",
  );
  // Both exported adapters take exactly (client, input): no wrapper/source arg.
  assertEquals(assignApiV1Task.length, 2);
  assertEquals(assignMcpV1Task.length, 2);
  const invokerRpcSites = adapterSource.match(
    /client\.rpc\(functionName, \{\s*_expected_oauth_client_id: expectedOauthClientId,\s*_task_id: taskId,\s*_assignee_id: assigneeId,/g,
  ) ?? [];
  assertEquals(
    invokerRpcSites.length,
    1,
    "exactly one Task Assign rpc call site",
  );
  assert(
    !/_ASSIGN_TASK_FUNCTION_NAME[^\n]*=[^\n]*\|/.test(adapterSource),
    "no dynamic wrapper selection",
  );
});

Deno.test("every assign outcome maps identically across both sources", async () => {
  for (const outcome of ["applied", "no_change", "replayed"]) {
    const rest = await assignApiV1Task(
      recordingClient([], assignSuccessData(outcome)),
      adapterInput,
    );
    const mcp = await assignMcpV1Task(
      recordingClient([], assignSuccessData(outcome)),
      adapterInput,
    );
    assertEquals(rest, mcp);
    assertEquals(rest.ok, true);
    if (rest.ok) assertEquals(rest.outcome, outcome);
  }
  for (
    const outcome of [
      "invalid",
      "not_authorized",
      "idempotency_conflict",
      "idempotency_pending",
    ]
  ) {
    // deno-lint-ignore no-explicit-any
    const negative: any = { data: { ok: false, outcome }, error: null };
    const rest = await assignApiV1Task(
      recordingClient([], negative),
      adapterInput,
    );
    const mcp = await assignMcpV1Task(
      recordingClient([], negative),
      adapterInput,
    );
    assertEquals(rest, mcp);
    assertEquals(rest.ok, false);
    if (!rest.ok) assertEquals(rest.outcome, outcome);
  }
});

// -----------------------------------------------------------------------------
// B. Exact Task Assign RPC arguments
// -----------------------------------------------------------------------------

Deno.test("executor forwards a non-null assignee unchanged", async () => {
  const calls: RpcCall[] = [];
  const factoryCalls: FactoryCall[] = [];
  const executor = buildExecutor(calls, factoryCalls);

  const result = await executor(
    authenticatedRequest(),
    TASK_ID,
    { assigneeId: ASSIGNEE_ID },
    // deno-lint-ignore no-explicit-any
    mutationContext() as any,
  );

  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, "mcp_v1_assign_task");
  assertEquals(calls[0].args, {
    _expected_oauth_client_id: "btpm-mcp-client",
    _task_id: TASK_ID,
    _assignee_id: ASSIGNEE_ID,
    _request_id: "req-ta-0001",
    _correlation_id: "req-ta-0001",
    _idempotency_key: "idem-ta-0001",
    _payload_hash: PAYLOAD_HASH,
  });
  assertEquals(result.ok, true);
});

Deno.test("executor forwards assigneeId: null unchanged (clear assignment)", async () => {
  const calls: RpcCall[] = [];
  const executor = buildExecutor(calls, [], assignSuccessData("applied", null));

  const result = await executor(
    authenticatedRequest(),
    TASK_ID,
    { assigneeId: null },
    // deno-lint-ignore no-explicit-any
    mutationContext() as any,
  );

  assertEquals(calls.length, 1);
  assertEquals(calls[0].args._assignee_id, null);
  assertEquals(Object.keys(calls[0].args).length, 7);
  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.newAssigneeId, null);
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
    { assigneeId: ASSIGNEE_ID },
    // deno-lint-ignore no-explicit-any
    mutationContext() as any,
  );
  await executor(
    authenticatedRequest("token-two"),
    TASK_ID,
    { assigneeId: null },
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
        { assigneeId: ASSIGNEE_ID },
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
  assertEquals(createMcpV1AssignTaskExecutor.length, 3);
  for (const bad of ["", "   "]) {
    assertRejectsSync(() =>
      createMcpV1AssignTaskExecutor(
        bad,
        "anon-publishable-key",
        () => ({ rpc: () => Promise.resolve({ data: null, error: null }) }),
      )
    );
    assertRejectsSync(() =>
      createMcpV1AssignTaskExecutor(
        "https://project.supabase.test",
        bad,
        () => ({ rpc: () => Promise.resolve({ data: null, error: null }) }),
      )
    );
  }
});

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
// D. Trusted context fail-closed
// -----------------------------------------------------------------------------

const INCONSISTENT_CONTEXTS: ReadonlyArray<Record<string, unknown>> = [
  { executingUserId: "user-2" },
  { sourceClientId: "other-client" },
  { correlationId: "req-other" },
  { sourceChannel: "external_api" },
  { delegationMode: "service_account" },
  { payloadHash: "NOTAHASH" },
  { payloadHash: "A".repeat(64) },
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
          { assigneeId: ASSIGNEE_ID },
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
// E. Canonical Task Assign semantics
// -----------------------------------------------------------------------------

Deno.test("executor reuses the canonical assignment path and body parsers", () => {
  assertStringIncludes(executorSource, "parseApiV1TaskAssignPath");
  assertStringIncludes(executorSource, "parseApiV1AssignTaskBody");
  assertStringIncludes(executorSource, '"/v1/tasks/"');
  assertStringIncludes(executorSource, '"/assignee"');
  assert(
    !/const\s+\w*Schema\s*=|z\.object\(/.test(executorSource),
    "no duplicate assignment parser or schema may exist in the executor",
  );
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
        { assigneeId: ASSIGNEE_ID },
        // deno-lint-ignore no-explicit-any
        mutationContext() as any,
      )
    );
    assertEquals(factoryCalls.length, 0);
    assertEquals(calls.length, 0);
  }
});

Deno.test("closed single-key assign body shape is enforced by the canonical parser", async () => {
  const badBodies: unknown[] = [
    {},
    { assigneeId: "not-a-uuid" },
    { assigneeId: NIL_UUID },
    { assigneeId: ASSIGNEE_ID, expectedUpdatedAt: "2026-08-16T00:00:00Z" },
    { assigneeId: ASSIGNEE_ID, taskId: TASK_ID },
    { assigneeId: ASSIGNEE_ID, role: "executor" },
    { assigneeId: undefined },
    { assigneeIds: [ASSIGNEE_ID] },
    [],
    null,
    "assigneeId",
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

Deno.test("negative outcomes are returned unchanged with no retry", async () => {
  const calls: RpcCall[] = [];
  const executor = buildExecutor(calls, [], {
    data: { ok: false, outcome: "idempotency_conflict" },
    error: null,
  });
  const result = await executor(
    authenticatedRequest(),
    TASK_ID,
    { assigneeId: ASSIGNEE_ID },
    // deno-lint-ignore no-explicit-any
    mutationContext() as any,
  );
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.outcome, "idempotency_conflict");
  assertEquals(calls.length, 1, "exactly one RPC, no retry");
});

Deno.test("no concurrency token or read-before-write is introduced", () => {
  assert(!/expectedUpdatedAt|_expected_updated_at/.test(executorSource));
  assert(!/new Date\(|toISOString|Date\.now/.test(executorSource));
  assert(!/get_task|api_v1_get_task|mcp_v1_get_task/.test(executorSource));
  assert(!/is_workspace_member|eligib/i.test(executorCode));
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
    !/\bapi_v1_assign_task\b|assignApiV1Task|apply_task_assignee_set|set_task_assignee|pmg_|client\.rpc\(|\.rpc\(/
      .test(executorCode),
    "no REST wrapper, canonical command or direct rpc call may be referenced",
  );
  assert(
    !/\bmcp_v1_assign_task\b/.test(executorCode),
    "the sole wrapper choice must stay encapsulated in assignMcpV1Task",
  );
  assert(!/registerTool|MCP_TOOL_REGISTRY|serverFactory/.test(executorSource));
  assert(!/for\s*\(|while\s*\(/.test(executorSource), "no retry loop");
  assert(!/\blet\s+\w+\s*=\s*(new\s+Map|new\s+Set|\[\])/.test(executorCode));
  const invocations = executorSource.match(/assignMcpV1Task\(client, \{/g) ?? [];
  assertEquals(invocations.length, 1, "exactly one fixed MCP invocation site");
});

