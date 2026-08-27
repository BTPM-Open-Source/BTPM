// API-Q Project Update Step 2 — focused guard for the caller-bound MCP
// Project-update adapter.
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
  updateApiV1Project,
  updateMcpV1Project,
} from "../../functions/_shared/btpm-api/supabaseProjectMutation.ts";
import { createMcpV1UpdateProjectExecutor } from "../../functions/btpm-mcp/mcp/projectUpdateMutationExecutor.ts";

const ADAPTER_URL = new URL(
  "../../functions/_shared/btpm-api/supabaseProjectMutation.ts",
  import.meta.url,
);
const EXECUTOR_URL = new URL(
  "../../functions/btpm-mcp/mcp/projectUpdateMutationExecutor.ts",
  import.meta.url,
);

const adapterSource = await Deno.readTextFile(ADAPTER_URL);
const executorSource = await Deno.readTextFile(EXECUTOR_URL);

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const PROGRAM_ID = "22222222-2222-4222-8222-222222222222";
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const PAYLOAD_HASH = "e".repeat(64);
const EXPECTED_UPDATED_AT = "2026-08-15T04:00:00.123456+02:00";
const RESULT_TIMESTAMP = "2026-08-16T06:15:00Z";

/**
 * Canonical (already parsed) Project update body with a deliberate mixture of:
 *   - absent fields (`setX=false`, value null) — do not change;
 *   - explicit clears (`setX=true`, value null);
 *   - explicit value updates.
 */
const canonicalBody = Object.freeze({
  expectedUpdatedAt: EXPECTED_UPDATED_AT,
  name: "SAP S/4 Rollout",
  setName: true,
  priority: null,
  setPriority: false,
  // explicit clear
  description: null,
  setDescription: true,
  // explicit set
  charter: "Charter text",
  setCharter: true,
  // absent
  goals: null,
  setGoals: false,
  scopeIn: "In scope text",
  setScopeIn: true,
  scopeOut: null,
  setScopeOut: true,
  businessCase: null,
  setBusinessCase: false,
  successCriteria: "Success text",
  setSuccessCriteria: true,
  completionCriteria: null,
  setCompletionCriteria: true,
  budgetNarrative: null,
  setBudgetNarrative: false,
  assumptions: "Assumption text",
  setAssumptions: true,
  constraints: null,
  setConstraints: false,
  programId: PROGRAM_ID,
  setProgramId: true,
  deliveryModel: null,
  setDeliveryModel: false,
} as const);

const EXPECTED_RPC_ARGS: Record<string, unknown> = {
  _expected_oauth_client_id: "btpm-mcp-client",
  _project_id: PROJECT_ID,
  _expected_updated_at: EXPECTED_UPDATED_AT,
  _name: "SAP S/4 Rollout",
  _priority: null,
  _description: null,
  _charter: "Charter text",
  _goals: null,
  _scope_in: "In scope text",
  _scope_out: null,
  _business_case: null,
  _success_criteria: "Success text",
  _completion_criteria: null,
  _budget_narrative: null,
  _assumptions: "Assumption text",
  _constraints: null,
  _program_id: PROGRAM_ID,
  _delivery_model: null,
  _set_name: true,
  _set_priority: false,
  _set_description: true,
  _set_charter: true,
  _set_goals: false,
  _set_scope_in: true,
  _set_scope_out: true,
  _set_business_case: false,
  _set_success_criteria: true,
  _set_completion_criteria: true,
  _set_budget_narrative: false,
  _set_assumptions: true,
  _set_constraints: false,
  _set_program_id: true,
  _set_delivery_model: false,
  _request_id: "req-pu-0001",
  _correlation_id: "req-pu-0001",
  _idempotency_key: "idem-pu-0001",
  _payload_hash: PAYLOAD_HASH,
};

function updateSuccessData(outcome = "applied") {
  return {
    data: {
      ok: true,
      outcome,
      projectId: PROJECT_ID,
      updatedAt: RESULT_TIMESTAMP,
    },
    error: null,
  };
}

interface RpcCall {
  readonly name: string;
  readonly args: Record<string, unknown>;
}

function recordingClient(calls: RpcCall[], data: unknown = updateSuccessData()) {
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
  requestId: "req-pu-0001",
  correlationId: "req-pu-0001",
  idempotencyKey: "idem-pu-0001",
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
    requestId: "req-pu-0001",
    correlationId: "req-pu-0001",
    sourceChannel: "mcp",
    sourceClientId: "api-client-1",
    delegationMode: "delegated_user",
    idempotencyKey: "idem-pu-0001",
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
  return createMcpV1UpdateProjectExecutor(
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
// A. Fixed Project Update adapter pair
// -----------------------------------------------------------------------------

Deno.test("REST Project update still calls only api_v1_update_project", async () => {
  const calls: RpcCall[] = [];
  const result = await updateApiV1Project(recordingClient(calls), adapterInput);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, "api_v1_update_project");
  assertEquals(result.ok, true);
});

Deno.test("MCP Project update calls only mcp_v1_update_project", async () => {
  const calls: RpcCall[] = [];
  const result = await updateMcpV1Project(recordingClient(calls), adapterInput);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, "mcp_v1_update_project");
  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.projectId, PROJECT_ID);
});

Deno.test("REST and MCP Project update share identical validation and mapping", async () => {
  const restCalls: RpcCall[] = [];
  const mcpCalls: RpcCall[] = [];
  const rest = await updateApiV1Project(
    recordingClient(restCalls),
    adapterInput,
  );
  const mcp = await updateMcpV1Project(recordingClient(mcpCalls), adapterInput);
  assertEquals(restCalls[0].args, mcpCalls[0].args);
  assertEquals(restCalls[0].args, EXPECTED_RPC_ARGS);
  assertEquals(rest, mcp);

  const bad = { ...adapterInput, payloadHash: "nope" };
  await assertRejects(() => updateApiV1Project(recordingClient([]), bad));
  await assertRejects(() => updateMcpV1Project(recordingClient([]), bad));

  const badId = { ...adapterInput, projectId: "not-a-uuid" };
  await assertRejects(() => updateApiV1Project(recordingClient([]), badId));
  await assertRejects(() => updateMcpV1Project(recordingClient([]), badId));

  const mapperDefs =
    adapterSource.match(/function toUpdateProjectResult\(/g) ?? [];
  assertEquals(mapperDefs.length, 1, "one bounded update result contract only");
});

Deno.test("Project update wrapper names are a closed set of fixed module constants", () => {
  assertStringIncludes(
    adapterSource,
    'const API_V1_UPDATE_PROJECT_FUNCTION_NAME = "api_v1_update_project"',
  );
  assertStringIncludes(
    adapterSource,
    'const MCP_V1_UPDATE_PROJECT_FUNCTION_NAME = "mcp_v1_update_project"',
  );
  assert(
    /type UpdateProjectFunctionName =\s*\|\s*typeof API_V1_UPDATE_PROJECT_FUNCTION_NAME\s*\|\s*typeof MCP_V1_UPDATE_PROJECT_FUNCTION_NAME;/
      .test(adapterSource),
    "the update wrapper name must be a closed internal union",
  );
  assertEquals(updateApiV1Project.length, 2);
  assertEquals(updateMcpV1Project.length, 2);
  assert(
    !/export\s+(async\s+)?function\s+invokeUpdateProject/.test(adapterSource),
    "the shared update invocation helper must not be exported",
  );
  assert(
    /async function invokeUpdateProject\(\s*functionName: UpdateProjectFunctionName,/
      .test(adapterSource),
    "a single shared internal update invocation helper must exist",
  );
  assert(
    /client\.rpc\(functionName, args\)/.test(adapterSource),
    "the shared update invoker must perform the single RPC call",
  );
  const updateRpcSites = adapterSource.match(
    /client\.rpc\((API_V1_UPDATE_PROJECT_FUNCTION_NAME|MCP_V1_UPDATE_PROJECT_FUNCTION_NAME)/g,
  ) ?? [];
  assertEquals(
    updateRpcSites.length,
    0,
    "no direct update RPC site outside the shared invoker",
  );
});

// -----------------------------------------------------------------------------
// B. Result parity
// -----------------------------------------------------------------------------

Deno.test("stale_project mapping remains unchanged and leaks no timestamp", async () => {
  const staleData = {
    data: { ok: false, outcome: "conflict", code: "stale_project" },
    error: null,
  };
  const rest = await updateApiV1Project(
    recordingClient([], staleData),
    adapterInput,
  );
  const mcp = await updateMcpV1Project(
    recordingClient([], staleData),
    adapterInput,
  );
  assertEquals(rest, mcp);
  assertEquals(rest, { ok: false, outcome: "conflict", code: "stale_project" });
});

Deno.test("applied / no_change / replayed handling is unchanged across sources", async () => {
  for (const outcome of ["applied", "no_change", "replayed"]) {
    const rest = await updateApiV1Project(
      recordingClient([], updateSuccessData(outcome)),
      adapterInput,
    );
    const mcp = await updateMcpV1Project(
      recordingClient([], updateSuccessData(outcome)),
      adapterInput,
    );
    assertEquals(rest, mcp);
    assertEquals(rest.ok, true);
    if (rest.ok) {
      assertEquals(rest.outcome, outcome);
      assertEquals(rest.updatedAt, RESULT_TIMESTAMP);
    }
  }
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
    const rest = await updateApiV1Project(
      recordingClient([], negative),
      adapterInput,
    );
    const mcp = await updateMcpV1Project(
      recordingClient([], negative),
      adapterInput,
    );
    assertEquals(rest, mcp);
    assertEquals(rest, { ok: false, outcome });
  }
});

Deno.test("malformed RPC envelopes and results fail closed on both sources", async () => {
  const malformed: ReadonlyArray<unknown> = [
    null,
    { data: null, error: null },
    { data: { ok: true, outcome: "applied" }, error: null },
    { data: { ok: true, outcome: "weird", projectId: PROJECT_ID, updatedAt: RESULT_TIMESTAMP }, error: null },
    { data: { ok: false, outcome: "conflict", code: "stale_task" }, error: null },
    { data: { ok: false, outcome: "surprise" }, error: null },
  ];
  for (const data of malformed) {
    await assertRejects(() => updateApiV1Project(recordingClient([], data), adapterInput));
    await assertRejects(() => updateMcpV1Project(recordingClient([], data), adapterInput));
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
// E/F. Project identity
// -----------------------------------------------------------------------------

Deno.test("executor reuses the canonical Project update path parser only", () => {
  assertStringIncludes(executorSource, "parseApiV1ProjectUpdatePath");
  assertStringIncludes(executorSource, '"/v1/projects/"');
  assert(
    !/parseApiV1UpdateProjectBody/.test(executorSource),
    "the already-canonical body must not be reparsed by the raw HTTP parser",
  );
  assert(
    !/const\s+\w*Schema\s*=|z\.object\(/.test(executorSource),
    "no duplicate Project parser or schema may exist in the executor",
  );
  assert(
    !/\bfrom\(|projects\?select|api_v1_get_project|mcp_v1_get_project/.test(
      executorSource,
    ),
    "no Project lookup may occur",
  );
});

Deno.test("malformed and nil Project IDs are rejected before client and RPC", async () => {
  for (
    const badId of [
      "",
      "not-a-uuid",
      NIL_UUID,
      `${PROJECT_ID}/extra`,
      ` ${PROJECT_ID}`,
    ]
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

  const calls: RpcCall[] = [];
  const factoryCalls: FactoryCall[] = [];
  const executor = buildExecutor(calls, factoryCalls);
  await assertRejects(() =>
    executor(
      authenticatedRequest(),
      // deno-lint-ignore no-explicit-any
      undefined as any,
      { ...canonicalBody },
      // deno-lint-ignore no-explicit-any
      mutationContext() as any,
    )
  );
  assertEquals(factoryCalls.length, 0);
  assertEquals(calls.length, 0);
});

// -----------------------------------------------------------------------------
// G. Canonical body forwarding / presence semantics
// -----------------------------------------------------------------------------

Deno.test("every canonical value and set* flag reaches the RPC unchanged", async () => {
  const calls: RpcCall[] = [];
  const executor = buildExecutor(calls, []);
  const result = await executor(
    authenticatedRequest(),
    PROJECT_ID,
    { ...canonicalBody },
    // deno-lint-ignore no-explicit-any
    mutationContext() as any,
  );
  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, "mcp_v1_update_project");
  assertEquals(calls[0].args, EXPECTED_RPC_ARGS);
  assertEquals(result.ok, true);
});

Deno.test("absent and explicit-clear narratives remain distinct", async () => {
  const calls: RpcCall[] = [];
  const executor = buildExecutor(calls, []);
  await executor(
    authenticatedRequest(),
    PROJECT_ID,
    { ...canonicalBody },
    // deno-lint-ignore no-explicit-any
    mutationContext() as any,
  );
  const args = calls[0].args;

  // Explicit clear: value null, set flag true.
  assertEquals(args._description, null);
  assertEquals(args._set_description, true);
  assertEquals(args._scope_out, null);
  assertEquals(args._set_scope_out, true);
  assertEquals(args._completion_criteria, null);
  assertEquals(args._set_completion_criteria, true);

  // Absent: value null, set flag false.
  assertEquals(args._goals, null);
  assertEquals(args._set_goals, false);
  assertEquals(args._business_case, null);
  assertEquals(args._set_business_case, false);
  assertEquals(args._budget_narrative, null);
  assertEquals(args._set_budget_narrative, false);
  assertEquals(args._constraints, null);
  assertEquals(args._set_constraints, false);
  assertEquals(args._delivery_model, null);
  assertEquals(args._set_delivery_model, false);
  assertEquals(args._priority, null);
  assertEquals(args._set_priority, false);

  // Explicit set.
  assertEquals(args._charter, "Charter text");
  assertEquals(args._set_charter, true);
  assertEquals(args._program_id, PROGRAM_ID);
  assertEquals(args._set_program_id, true);

  assert(
    args._set_description !== args._set_goals,
    "explicit clear and absent must not collapse",
  );
});

Deno.test("explicit priority and delivery-model updates are forwarded verbatim", async () => {
  const calls: RpcCall[] = [];
  const executor = buildExecutor(calls, []);
  await executor(
    authenticatedRequest(),
    PROJECT_ID,
    {
      ...canonicalBody,
      priority: "critical",
      setPriority: true,
      deliveryModel: "vendor_delivery",
      setDeliveryModel: true,
      programId: null,
      setProgramId: true,
    },
    // deno-lint-ignore no-explicit-any
    mutationContext() as any,
  );
  assertEquals(calls[0].args._priority, "critical");
  assertEquals(calls[0].args._set_priority, true);
  assertEquals(calls[0].args._delivery_model, "vendor_delivery");
  assertEquals(calls[0].args._set_delivery_model, true);
  assertEquals(calls[0].args._program_id, null);
  assertEquals(calls[0].args._set_program_id, true);
});

// -----------------------------------------------------------------------------
// H. Concurrency
// -----------------------------------------------------------------------------

Deno.test("stale_project is returned unchanged with no retry or read-before-write", async () => {
  const calls: RpcCall[] = [];
  const executor = buildExecutor(calls, [], {
    data: { ok: false, outcome: "conflict", code: "stale_project" },
    error: null,
  });
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
    "expectedUpdatedAt: body.expectedUpdatedAt,",
  );
});

// -----------------------------------------------------------------------------
// I. Metadata forwarding
// -----------------------------------------------------------------------------

Deno.test("trusted execution metadata is forwarded exactly", async () => {
  const calls: RpcCall[] = [];
  const executor = buildExecutor(calls, []);
  await executor(
    authenticatedRequest(),
    PROJECT_ID,
    { ...canonicalBody },
    // deno-lint-ignore no-explicit-any
    mutationContext() as any,
  );
  assertEquals(calls[0].args._expected_oauth_client_id, "btpm-mcp-client");
  assertEquals(calls[0].args._request_id, "req-pu-0001");
  assertEquals(calls[0].args._correlation_id, "req-pu-0001");
  assertEquals(calls[0].args._idempotency_key, "idem-pu-0001");
  assertEquals(calls[0].args._payload_hash, PAYLOAD_HASH);
});

// -----------------------------------------------------------------------------
// J. Forbidden surfaces
// -----------------------------------------------------------------------------

Deno.test("executor introduces no forbidden surface", () => {
  assert(!/SERVICE_ROLE|service_role|serviceRole|privilegedClient/.test(executorSource));
  assert(!/Deno\.env/.test(executorSource));
  assert(!/fetch\(/.test(executorSource));
  assert(!/\.from\(/.test(executorSource));
  assert(!/console\./.test(executorSource));
  assert(!/setTimeout|setInterval/.test(executorSource));
  assert(!/api_project_client_enablements|enable_project/.test(executorSource));
  assert(!/authorize_and_establish|pmg_|PMG\b/.test(executorSource));
  assert(!/btpm_encrypt|btpm_decrypt/.test(executorSource));
  assert(
    !/hashCanonicalPayload|buildApiV1UpdateProjectIdempotencyPayload|claim_idempotency/
      .test(executorSource),
  );
  assert(!/registerTool|MCP_TOOL_REGISTRY|serverFactory/.test(executorSource));
  assert(
    !/api_v1_update_project|updateApiV1Project/.test(executorSource),
    "the MCP executor must never reach the REST wrapper",
  );
  assert(!/for\s*\(|while\s*\(/.test(executorSource), "no retry loop");
  const invocations =
    executorSource.match(/updateMcpV1Project\(client, \{/g) ?? [];
  assertEquals(invocations.length, 1, "exactly one fixed MCP invocation site");
  const factories =
    executorSource.match(/export function createMcpV1UpdateProjectExecutor\(/g) ??
      [];
  assertEquals(factories.length, 1, "exactly one exported factory");
});

Deno.test("the canonical Project mutation adapter exports remain unchanged", () => {
  for (
    const name of [
      "createApiV1Project",
      "createMcpV1Project",
      "updateApiV1Project",
      "transitionApiV1Project",
    ]
  ) {
    assert(
      new RegExp(`export (async )?function ${name}\\(`).test(adapterSource),
      `${name} must remain exported unchanged`,
    );
  }
});
