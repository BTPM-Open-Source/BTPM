// API-Q Project Transition Step 2 — focused guard for the caller-bound MCP
// Project-transition adapter.
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
  transitionApiV1Project,
  transitionMcpV1Project,
} from "../../functions/_shared/btpm-api/supabaseProjectMutation.ts";
import { createMcpV1TransitionProjectExecutor } from "../../functions/btpm-mcp/mcp/projectTransitionMutationExecutor.ts";

const ADAPTER_URL = new URL(
  "../../functions/_shared/btpm-api/supabaseProjectMutation.ts",
  import.meta.url,
);
const EXECUTOR_URL = new URL(
  "../../functions/btpm-mcp/mcp/projectTransitionMutationExecutor.ts",
  import.meta.url,
);

const adapterSource = await Deno.readTextFile(ADAPTER_URL);
const executorSource = await Deno.readTextFile(EXECUTOR_URL);

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const PAYLOAD_HASH = "c".repeat(64);
const EXPECTED_UPDATED_AT = "2026-08-15T04:00:00.123456+02:00";
const RESULT_TIMESTAMP = "2026-08-16T06:15:00Z";

const canonicalBody = Object.freeze({
  expectedUpdatedAt: EXPECTED_UPDATED_AT,
  targetStatus: "completed",
  confirmWarnings: true,
} as const);

const EXPECTED_RPC_ARGS: Record<string, unknown> = {
  _expected_oauth_client_id: "btpm-mcp-client",
  _project_id: PROJECT_ID,
  _expected_updated_at: EXPECTED_UPDATED_AT,
  _target_status: "completed",
  _confirm_warnings: true,
  _request_id: "req-pt-0001",
  _correlation_id: "req-pt-0001",
  _idempotency_key: "idem-pt-0001",
  _payload_hash: PAYLOAD_HASH,
};

function transitionSuccessData(outcome = "applied") {
  return {
    data: {
      ok: true,
      outcome,
      projectId: PROJECT_ID,
      status: "completed",
      previousStatus: "active",
      updatedAt: RESULT_TIMESTAMP,
    },
    error: null,
  };
}

const COMPLETION_COUNTS = Object.freeze({
  open_blockers: 1,
  incomplete_phases: 0,
  incomplete_tasks: 2,
  open_risks: 0,
  target_in_future: 0,
});

const HARD_BLOCK_ITEMS = Object.freeze([
  Object.freeze({
    code: "open_blockers",
    message: "1 open blocker must be resolved",
    count: 1,
  }),
]);

const WARNING_ITEMS = Object.freeze([
  Object.freeze({
    code: "incomplete_tasks",
    message: "2 tasks are not complete",
    count: 2,
  }),
]);

const BLOCKED_DATA = {
  data: {
    ok: false,
    outcome: "blocked",
    code: "completion_hard_blocked",
    projectId: PROJECT_ID,
    hardBlocks: HARD_BLOCK_ITEMS,
    warnings: WARNING_ITEMS,
    counts: COMPLETION_COUNTS,
  },
  error: null,
};

const CONFIRMATION_DATA = {
  data: {
    ok: false,
    outcome: "confirmation_required",
    code: "completion_soft_warnings",
    projectId: PROJECT_ID,
    warnings: WARNING_ITEMS,
    counts: COMPLETION_COUNTS,
  },
  error: null,
};

const STALE_DATA = {
  data: { ok: false, outcome: "conflict", code: "stale_project" },
  error: null,
};

interface RpcCall {
  readonly name: string;
  readonly args: Record<string, unknown>;
}

function recordingClient(
  calls: RpcCall[],
  data: unknown = transitionSuccessData(),
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
  projectId: PROJECT_ID,
  ...canonicalBody,
  requestId: "req-pt-0001",
  correlationId: "req-pt-0001",
  idempotencyKey: "idem-pt-0001",
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
    requestId: "req-pt-0001",
    correlationId: "req-pt-0001",
    sourceChannel: "mcp",
    sourceClientId: "api-client-1",
    delegationMode: "delegated_user",
    idempotencyKey: "idem-pt-0001",
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
  return createMcpV1TransitionProjectExecutor(
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

// -----------------------------------------------------------------------------
// A. Shared adapter dual-wrapper contract
// -----------------------------------------------------------------------------

Deno.test("REST Project transition still calls only api_v1_transition_project", async () => {
  const calls: RpcCall[] = [];
  const result = await transitionApiV1Project(
    recordingClient(calls),
    adapterInput,
  );
  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, "api_v1_transition_project");
  assertEquals(result.ok, true);
});

Deno.test("MCP Project transition calls only mcp_v1_transition_project", async () => {
  const calls: RpcCall[] = [];
  const result = await transitionMcpV1Project(
    recordingClient(calls),
    adapterInput,
  );
  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, "mcp_v1_transition_project");
  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.projectId, PROJECT_ID);
});

Deno.test("Project transition wrapper names are a closed set of fixed constants", () => {
  assertStringIncludes(
    adapterSource,
    'const API_V1_TRANSITION_PROJECT_FUNCTION_NAME = "api_v1_transition_project"',
  );
  assertStringIncludes(
    adapterSource,
    'const MCP_V1_TRANSITION_PROJECT_FUNCTION_NAME = "mcp_v1_transition_project"',
  );
  assert(
    /type TransitionProjectFunctionName =\s*\|\s*typeof API_V1_TRANSITION_PROJECT_FUNCTION_NAME\s*\|\s*typeof MCP_V1_TRANSITION_PROJECT_FUNCTION_NAME;/
      .test(adapterSource),
    "the transition wrapper name must be a closed internal union",
  );
  assert(
    !/export\s+(async\s+)?function\s+invokeTransitionProject/.test(
      adapterSource,
    ),
    "the shared transition invocation helper must not be exported",
  );
  const invokerDefs = adapterSource.match(
    /async function invokeTransitionProject\(/g,
  ) ?? [];
  assertEquals(invokerDefs.length, 1, "exactly one shared transition invoker");
  assert(
    /async function invokeTransitionProject\(\s*functionName: TransitionProjectFunctionName,/
      .test(adapterSource),
    "the shared invoker must take the closed wrapper-name union",
  );
  const sharedSites = adapterSource.match(/client\.rpc\(functionName, args\)/g) ??
    [];
  assertEquals(
    sharedSites.length,
    2,
    "one shared RPC call site for update and one for transition",
  );
  const directTransitionSites = adapterSource.match(
    /client\.rpc\((API_V1_TRANSITION_PROJECT_FUNCTION_NAME|MCP_V1_TRANSITION_PROJECT_FUNCTION_NAME)/g,
  ) ?? [];
  assertEquals(
    directTransitionSites.length,
    0,
    "no direct transition RPC site outside the shared invoker",
  );
  assert(
    /return invokeTransitionProject\(\s*API_V1_TRANSITION_PROJECT_FUNCTION_NAME,/
      .test(adapterSource),
    "REST delegate must select only the REST wrapper",
  );
  assert(
    /return invokeTransitionProject\(\s*MCP_V1_TRANSITION_PROJECT_FUNCTION_NAME,/
      .test(adapterSource),
    "MCP delegate must select only the MCP wrapper",
  );
  assertEquals(transitionApiV1Project.length, 2);
  assertEquals(transitionMcpV1Project.length, 2);
  const mapperDefs =
    adapterSource.match(/function toTransitionProjectResult\(/g) ?? [];
  assertEquals(
    mapperDefs.length,
    1,
    "one bounded transition result contract only",
  );
});

// -----------------------------------------------------------------------------
// B. Exact nine RPC arguments
// -----------------------------------------------------------------------------

Deno.test("both sources forward exactly the nine transition RPC arguments", async () => {
  const restCalls: RpcCall[] = [];
  const mcpCalls: RpcCall[] = [];
  await transitionApiV1Project(recordingClient(restCalls), adapterInput);
  await transitionMcpV1Project(recordingClient(mcpCalls), adapterInput);
  assertEquals(restCalls[0].args, EXPECTED_RPC_ARGS);
  assertEquals(mcpCalls[0].args, EXPECTED_RPC_ARGS);
  assertEquals(
    Object.keys(mcpCalls[0].args).sort(),
    Object.keys(EXPECTED_RPC_ARGS).sort(),
  );
  assertEquals(Object.keys(mcpCalls[0].args).length, 9);
  for (
    const forbidden of [
      "_source_channel",
      "_execution_source",
      "_tenant_id",
      "_organization_id",
      "_workspace_id",
      "_actor_user_id",
      "_user_id",
      "_client_id",
      "_current_updated_at",
      "_completion_state",
    ]
  ) {
    assert(
      !(forbidden in mcpCalls[0].args),
      `${forbidden} must not be forwarded`,
    );
  }
});

// -----------------------------------------------------------------------------
// C. Result parity
// -----------------------------------------------------------------------------

Deno.test("applied / no_change / replayed handling is unchanged across sources", async () => {
  for (const outcome of ["applied", "no_change", "replayed"]) {
    const rest = await transitionApiV1Project(
      recordingClient([], transitionSuccessData(outcome)),
      adapterInput,
    );
    const mcp = await transitionMcpV1Project(
      recordingClient([], transitionSuccessData(outcome)),
      adapterInput,
    );
    assertEquals(rest, mcp);
    assert(rest.ok);
    if (rest.ok) {
      assertEquals(rest.outcome, outcome);
      assertEquals(rest.status, "completed");
      assertEquals(rest.previousStatus, "active");
      assertEquals(rest.updatedAt, RESULT_TIMESTAMP);
    }
  }
});

Deno.test("hard completion block mapping is preserved identically", async () => {
  const rest = await transitionApiV1Project(
    recordingClient([], BLOCKED_DATA),
    adapterInput,
  );
  const mcp = await transitionMcpV1Project(
    recordingClient([], BLOCKED_DATA),
    adapterInput,
  );
  assertEquals(rest, mcp);
  assertEquals(rest.ok, false);
  if (!rest.ok && rest.outcome === "blocked") {
    assertEquals(rest.code, "completion_hard_blocked");
    assertEquals(rest.projectId, PROJECT_ID);
    assertEquals(rest.hardBlocks, HARD_BLOCK_ITEMS);
    assertEquals(rest.warnings, WARNING_ITEMS);
    assertEquals(rest.counts, COMPLETION_COUNTS);
  } else {
    throw new Error("blocked outcome must not be collapsed");
  }
});

Deno.test("soft warning confirmation mapping is preserved identically", async () => {
  const rest = await transitionApiV1Project(
    recordingClient([], CONFIRMATION_DATA),
    adapterInput,
  );
  const mcp = await transitionMcpV1Project(
    recordingClient([], CONFIRMATION_DATA),
    adapterInput,
  );
  assertEquals(rest, mcp);
  if (!rest.ok && rest.outcome === "confirmation_required") {
    assertEquals(rest.code, "completion_soft_warnings");
    assertEquals(rest.projectId, PROJECT_ID);
    assertEquals(rest.warnings, WARNING_ITEMS);
    assertEquals(rest.counts, COMPLETION_COUNTS);
  } else {
    throw new Error("confirmation_required must not be collapsed");
  }
});

Deno.test("stale_project mapping remains unchanged and leaks no timestamp", async () => {
  const rest = await transitionApiV1Project(
    recordingClient([], STALE_DATA),
    adapterInput,
  );
  const mcp = await transitionMcpV1Project(
    recordingClient([], STALE_DATA),
    adapterInput,
  );
  assertEquals(rest, mcp);
  assertEquals(rest, { ok: false, outcome: "conflict", code: "stale_project" });
});

Deno.test("bounded negative outcomes are unchanged across sources", async () => {
  const negativeOutcomes = [
    "invalid",
    "not_authorized",
    "idempotency_conflict",
    "idempotency_pending",
  ] as const;
  for (const outcome of negativeOutcomes) {
    const negative = { data: { ok: false, outcome }, error: null };
    const rest = await transitionApiV1Project(
      recordingClient([], negative),
      adapterInput,
    );
    const mcp = await transitionMcpV1Project(
      recordingClient([], negative),
      adapterInput,
    );
    assertEquals(rest, mcp);
    assertEquals(rest, { ok: false, outcome });
  }
});

Deno.test("malformed transition envelopes and results fail closed on both sources", async () => {
  const malformed: ReadonlyArray<unknown> = [
    null,
    { data: null, error: null },
    { data: { ok: true, outcome: "applied" }, error: null },
    { data: { ok: false, outcome: "conflict", code: "stale_task" }, error: null },
    { data: { ok: false, outcome: "surprise" }, error: null },
    {
      data: {
        ok: false,
        outcome: "blocked",
        code: "completion_soft_warnings",
        projectId: PROJECT_ID,
        hardBlocks: [],
        warnings: [],
        counts: COMPLETION_COUNTS,
      },
      error: null,
    },
  ];
  for (const data of malformed) {
    await assertRejects(() =>
      transitionApiV1Project(recordingClient([], data), adapterInput)
    );
    await assertRejects(() =>
      transitionMcpV1Project(recordingClient([], data), adapterInput)
    );
  }
});

// -----------------------------------------------------------------------------
// D. Canonical executor validation
// -----------------------------------------------------------------------------

Deno.test("executor reuses the canonical Project transition parsers only", () => {
  assertStringIncludes(executorSource, "parseApiV1ProjectTransitionPath");
  assertStringIncludes(executorSource, "parseApiV1TransitionProjectBody");
  assertStringIncludes(executorSource, '"/v1/projects/"');
  assertStringIncludes(executorSource, '"/transition"');
  assert(
    !/apiUuidSchema|z\.object\(|const\s+\w*Schema\s*=/.test(executorSource),
    "no duplicate Project parser or schema may exist in the executor",
  );
  const bodyParseSites =
    executorSource.match(/parseApiV1TransitionProjectBody\(body\)/g) ?? [];
  assertEquals(bodyParseSites.length, 1, "body is parsed exactly once");
});

Deno.test("executor forwards canonical transition body values unchanged", async () => {
  for (
    const body of [
      { ...canonicalBody },
      {
        expectedUpdatedAt: EXPECTED_UPDATED_AT,
        targetStatus: "on_hold",
        confirmWarnings: false,
      },
    ] as const
  ) {
    const calls: RpcCall[] = [];
    const executor = buildExecutor(calls, []);
    await executor(
      authenticatedRequest(),
      PROJECT_ID,
      body,
      // deno-lint-ignore no-explicit-any
      mutationContext() as any,
    );
    assertEquals(calls.length, 1);
    assertEquals(calls[0].name, "mcp_v1_transition_project");
    assertEquals(calls[0].args._project_id, PROJECT_ID);
    assertEquals(calls[0].args._expected_updated_at, body.expectedUpdatedAt);
    assertEquals(calls[0].args._target_status, body.targetStatus);
    assertEquals(calls[0].args._confirm_warnings, body.confirmWarnings);
    assertEquals(calls[0].args._expected_oauth_client_id, "btpm-mcp-client");
    assertEquals(calls[0].args._request_id, "req-pt-0001");
    assertEquals(calls[0].args._correlation_id, "req-pt-0001");
    assertEquals(calls[0].args._idempotency_key, "idem-pt-0001");
    assertEquals(calls[0].args._payload_hash, PAYLOAD_HASH);
  }
});

Deno.test("malformed Project IDs and bodies are rejected before client and RPC", async () => {
  const badIds = ["", "not-a-uuid", NIL_UUID, `${PROJECT_ID}/extra`, ` ${PROJECT_ID}`];
  for (const badId of badIds) {
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

  const badBodies: ReadonlyArray<unknown> = [
    null,
    "body",
    {},
    { expectedUpdatedAt: EXPECTED_UPDATED_AT },
    { expectedUpdatedAt: EXPECTED_UPDATED_AT, targetStatus: "archived" },
    {
      expectedUpdatedAt: EXPECTED_UPDATED_AT,
      targetStatus: "completed",
      confirmWarnings: "yes",
    },
    {
      expectedUpdatedAt: EXPECTED_UPDATED_AT,
      targetStatus: "completed",
      confirmWarnings: true,
      extra: 1,
    },
  ];
  for (const body of badBodies) {
    const calls: RpcCall[] = [];
    const factoryCalls: FactoryCall[] = [];
    const executor = buildExecutor(calls, factoryCalls);
    await assertRejects(() =>
      executor(
        authenticatedRequest(),
        PROJECT_ID,
        // deno-lint-ignore no-explicit-any
        body as any,
        // deno-lint-ignore no-explicit-any
        mutationContext() as any,
      )
    );
    assertEquals(factoryCalls.length, 0);
    assertEquals(calls.length, 0);
  }
});

// -----------------------------------------------------------------------------
// E. Trusted-context fail closed
// -----------------------------------------------------------------------------

const INCONSISTENT_CONTEXTS: ReadonlyArray<Record<string, unknown>> = [
  { executingUserId: "user-2" },
  { sourceClientId: "other-client" },
  { correlationId: "req-other" },
  { sourceChannel: "external_api" },
  { delegationMode: "service_account" },
  { payloadHash: "NOTAHASH" },
  { payloadHash: "C".repeat(64) },
  { payloadHash: "c".repeat(63) },
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
          PROJECT_ID,
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

Deno.test("non-object trusted context fails closed", async () => {
  for (const context of [null, undefined, "ctx", 7, []]) {
    const calls: RpcCall[] = [];
    const factoryCalls: FactoryCall[] = [];
    const executor = buildExecutor(calls, factoryCalls);
    await assertRejects(() =>
      executor(
        authenticatedRequest(),
        PROJECT_ID,
        { ...canonicalBody },
        // deno-lint-ignore no-explicit-any
        context as any,
      )
    );
    assertEquals(factoryCalls.length, 0);
    assertEquals(calls.length, 0);
  }
});

// -----------------------------------------------------------------------------
// F. Caller-bound authentication
// -----------------------------------------------------------------------------

Deno.test("fresh anon-key client bound to the current bearer per invocation", async () => {
  const calls: RpcCall[] = [];
  const factoryCalls: FactoryCall[] = [];
  const executor = buildExecutor(calls, factoryCalls);

  await executor(
    authenticatedRequest("token-one"),
    PROJECT_ID,
    { ...canonicalBody },
    // deno-lint-ignore no-explicit-any
    mutationContext() as any,
  );
  await executor(
    authenticatedRequest("token-two"),
    PROJECT_ID,
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

Deno.test("missing or malformed bearer fails before any client construction", async () => {
  for (
    const headers of [
      undefined,
      { Authorization: "Basic abc" },
      { Authorization: "Bearer" },
    ]
  ) {
    const calls: RpcCall[] = [];
    const factoryCalls: FactoryCall[] = [];
    const executor = buildExecutor(calls, factoryCalls);
    await assertRejects(() =>
      executor(
        new Request("https://mcp.example.test/mcp", { method: "POST", headers }),
        PROJECT_ID,
        { ...canonicalBody },
        // deno-lint-ignore no-explicit-any
        mutationContext() as any,
      )
    );
    assertEquals(factoryCalls.length, 0);
    assertEquals(calls.length, 0);
  }
  assertStringIncludes(executorSource, "extractBearerToken(request)");
});

// -----------------------------------------------------------------------------
// G. No privileged path
// -----------------------------------------------------------------------------

Deno.test("executor introduces no privileged or duplicated surface", () => {
  for (
    const forbidden of [
      "SUPABASE_SERVICE_ROLE_KEY",
      "serviceRole",
      "service_role",
      "privilegedClient",
      "Deno.env",
      ".from(",
      "mcp_v1_transition_project",
      "api_v1_transition_project",
      "apply_project_status_transition",
      "api_project_client_enablements",
      "authorize_and_establish",
      "authorize_and_establish_mcp",
      "btpm_encrypt",
      "btpm_decrypt",
    ]
  ) {
    assert(
      !executorSource.includes(forbidden),
      `executor must not contain ${forbidden}`,
    );
  }
  assert(!/fetch\(/.test(executorSource), "no direct network call");
  assert(!/console\./.test(executorSource), "no logging");
  assert(!/setTimeout|setInterval/.test(executorSource), "no timers");
  // Fixed wrapper names belong only to the shared adapter.
  assertStringIncludes(adapterSource, '"mcp_v1_transition_project"');
});

// -----------------------------------------------------------------------------
// H. No concurrency repair
// -----------------------------------------------------------------------------

Deno.test("stale_project is returned unchanged with no retry or read-before-write", async () => {
  const calls: RpcCall[] = [];
  const executor = buildExecutor(calls, [], STALE_DATA);
  const result = await executor(
    authenticatedRequest(),
    PROJECT_ID,
    { ...canonicalBody },
    // deno-lint-ignore no-explicit-any
    mutationContext() as any,
  );
  assertEquals(result, {
    ok: false,
    outcome: "conflict",
    code: "stale_project",
  });
  assertEquals(calls.length, 1, "exactly one RPC, no retry");
  assertEquals(calls[0].args._expected_updated_at, EXPECTED_UPDATED_AT);
});

Deno.test("expectedUpdatedAt is never refreshed or reformatted", () => {
  assert(!/new Date\(/.test(executorSource));
  assert(!/toISOString/.test(executorSource));
  assert(!/Date\.now/.test(executorSource));
  assertStringIncludes(
    executorSource,
    "expectedUpdatedAt: canonicalBody.expectedUpdatedAt,",
  );
  assertStringIncludes(
    executorSource,
    "confirmWarnings: canonicalBody.confirmWarnings,",
  );
  const mcpAdapterCalls =
    executorSource.match(/transitionMcpV1Project\(client, \{/g) ?? [];
  assertEquals(mcpAdapterCalls.length, 1, "exactly one MCP adapter invocation");
  assert(
    !executorSource.includes("transitionApiV1Project"),
    "no REST fallback path",
  );
});
