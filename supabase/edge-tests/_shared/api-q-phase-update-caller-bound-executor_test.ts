// API-Q Phase Update Step 2 — focused guard for the caller-bound MCP
// Phase-update adapter.
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
  updateApiV1Phase,
  updateMcpV1Phase,
} from "../../functions/_shared/btpm-api/supabasePhase.ts";
import { createMcpV1UpdatePhaseExecutor } from "../../functions/btpm-mcp/mcp/phaseUpdateMutationExecutor.ts";
import { MCP_TOOL_REGISTRY } from "../../functions/btpm-mcp/mcp/toolRegistry.ts";

const ADAPTER_URL = new URL(
  "../../functions/_shared/btpm-api/supabasePhase.ts",
  import.meta.url,
);
const EXECUTOR_URL = new URL(
  "../../functions/btpm-mcp/mcp/phaseUpdateMutationExecutor.ts",
  import.meta.url,
);

const adapterSource = await Deno.readTextFile(ADAPTER_URL);
const executorSource = await Deno.readTextFile(EXECUTOR_URL);

const PHASE_ID = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const PAYLOAD_HASH = "d".repeat(64);
const EXPECTED_UPDATED_AT = "2026-08-14T04:00:00.123456+02:00";
const RESULT_TIMESTAMP = "2026-08-14T06:15:00Z";

const canonicalBody = Object.freeze({
  expectedUpdatedAt: EXPECTED_UPDATED_AT,
  name: "Realization",
  description: null,
  status: "active" as const,
  phaseType: "deliverable" as const,
});

function updateSuccessData(outcome = "applied") {
  return {
    data: {
      ok: true,
      outcome,
      phaseId: PHASE_ID,
      projectId: PROJECT_ID,
      status: "active",
      phaseType: "deliverable",
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
  phaseId: PHASE_ID,
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
  return createMcpV1UpdatePhaseExecutor(
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
// A. Fixed supabasePhase update adapters
// -----------------------------------------------------------------------------

Deno.test("REST Phase update still calls only api_v1_update_phase", async () => {
  const calls: RpcCall[] = [];
  const result = await updateApiV1Phase(recordingClient(calls), adapterInput);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, "api_v1_update_phase");
  assertEquals(result.ok, true);
});

Deno.test("MCP Phase update calls only mcp_v1_update_phase", async () => {
  const calls: RpcCall[] = [];
  const result = await updateMcpV1Phase(recordingClient(calls), adapterInput);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, "mcp_v1_update_phase");
  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.phaseId, PHASE_ID);
});

Deno.test("REST and MCP Phase update share identical validation and mapping", async () => {
  const restCalls: RpcCall[] = [];
  const mcpCalls: RpcCall[] = [];
  const rest = await updateApiV1Phase(recordingClient(restCalls), adapterInput);
  const mcp = await updateMcpV1Phase(recordingClient(mcpCalls), adapterInput);
  assertEquals(restCalls[0].args, mcpCalls[0].args);
  assertEquals(rest, mcp);

  const bad = { ...adapterInput, payloadHash: "nope" };
  await assertRejects(() => updateApiV1Phase(recordingClient([]), bad));
  await assertRejects(() => updateMcpV1Phase(recordingClient([]), bad));

  const badId = { ...adapterInput, phaseId: "not-a-uuid" };
  await assertRejects(() => updateApiV1Phase(recordingClient([]), badId));
  await assertRejects(() => updateMcpV1Phase(recordingClient([]), badId));

  const mapperDefs = adapterSource.match(/function toUpdateResult\(/g) ?? [];
  assertEquals(mapperDefs.length, 1, "one bounded update result contract only");
});

Deno.test("update wrapper names are a closed set of fixed module constants", () => {
  assertStringIncludes(
    adapterSource,
    'const API_V1_UPDATE_PHASE_FUNCTION_NAME = "api_v1_update_phase"',
  );
  assertStringIncludes(
    adapterSource,
    'const MCP_V1_UPDATE_PHASE_FUNCTION_NAME = "mcp_v1_update_phase"',
  );
  assert(
    /type UpdatePhaseFunctionName =\s*\|\s*typeof API_V1_UPDATE_PHASE_FUNCTION_NAME\s*\|\s*typeof MCP_V1_UPDATE_PHASE_FUNCTION_NAME;/
      .test(adapterSource),
    "the update wrapper name must be a closed internal union",
  );
  assertEquals(updateApiV1Phase.length, 2);
  assertEquals(updateMcpV1Phase.length, 2);
  assert(
    !/export\s+(async\s+)?function\s+invokeUpdatePhase/.test(adapterSource),
    "the shared update invocation helper must not be exported",
  );
  assert(
    /function invokeUpdatePhase\(/.test(adapterSource),
    "a single shared internal update invocation helper must exist",
  );
  assert(
    /client\.rpc\(functionName, \{\s*_expected_oauth_client_id: expectedOauthClientId,\s*_phase_id: phaseId,\s*_expected_updated_at: expectedUpdatedAt,/
      .test(adapterSource),
    "the shared update invoker must build the exact fixed RPC arguments",
  );
  assert(!/operationId/.test(adapterSource), "no operationId dispatch");
});

Deno.test("stale_phase mapping remains unchanged", async () => {
  const staleData = {
    data: { ok: false, outcome: "conflict", code: "stale_phase" },
    error: null,
  };
  const rest = await updateApiV1Phase(
    recordingClient([], staleData),
    adapterInput,
  );
  const mcp = await updateMcpV1Phase(
    recordingClient([], staleData),
    adapterInput,
  );
  assertEquals(rest, mcp);
  assertEquals(rest, { ok: false, outcome: "conflict", code: "stale_phase" });
});

Deno.test("applied / no_change / replayed handling is unchanged across sources", async () => {
  for (const outcome of ["applied", "replayed"]) {
    const rest = await updateApiV1Phase(
      recordingClient([], updateSuccessData(outcome)),
      adapterInput,
    );
    const mcp = await updateMcpV1Phase(
      recordingClient([], updateSuccessData(outcome)),
      adapterInput,
    );
    assertEquals(rest, mcp);
    assertEquals(rest.ok, true);
    if (rest.ok) assertEquals(rest.outcome, outcome);
  }
});

// -----------------------------------------------------------------------------
// B. Exact Phase Update RPC arguments
// -----------------------------------------------------------------------------

Deno.test("executor passes canonical arguments through unchanged", async () => {
  const calls: RpcCall[] = [];
  const factoryCalls: FactoryCall[] = [];
  const executor = buildExecutor(calls, factoryCalls);

  const result = await executor(
    authenticatedRequest(),
    PHASE_ID,
    { ...canonicalBody },
    // deno-lint-ignore no-explicit-any
    mutationContext() as any,
  );

  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, "mcp_v1_update_phase");
  assertEquals(calls[0].args, {
    _expected_oauth_client_id: "btpm-mcp-client",
    _phase_id: PHASE_ID,
    _expected_updated_at: EXPECTED_UPDATED_AT,
    _name: canonicalBody.name,
    _description: null,
    _status: "active",
    _phase_type: "deliverable",
    _request_id: "req-pu-0001",
    _correlation_id: "req-pu-0001",
    _idempotency_key: "idem-pu-0001",
    _payload_hash: PAYLOAD_HASH,
  });
  assertEquals(result.ok, true);
});

Deno.test("non-null description is forwarded verbatim", async () => {
  const calls: RpcCall[] = [];
  const executor = buildExecutor(calls, []);
  await executor(
    authenticatedRequest(),
    PHASE_ID,
    { ...canonicalBody, description: "desc text" },
    // deno-lint-ignore no-explicit-any
    mutationContext() as any,
  );
  assertEquals(calls[0].args._description, "desc text");
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
    { ...canonicalBody },
    // deno-lint-ignore no-explicit-any
    mutationContext() as any,
  );
  await executor(
    authenticatedRequest("token-two"),
    PHASE_ID,
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
      PHASE_ID,
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
          PHASE_ID,
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
// E. Canonical Phase Update semantics
// -----------------------------------------------------------------------------

Deno.test("executor reuses the canonical Phase path and body parsers", () => {
  assertStringIncludes(executorSource, "parseApiV1PhaseUpdatePath");
  assertStringIncludes(executorSource, "parseApiV1UpdatePhaseBody");
  assertStringIncludes(executorSource, '"/v1/phases/"');
  assert(
    !/const\s+\w*Schema\s*=|z\.object\(/.test(executorSource),
    "no duplicate Phase parser or schema may exist in the executor",
  );
});

Deno.test("malformed and nil Phase IDs are rejected", async () => {
  for (
    const badId of ["", "not-a-uuid", NIL_UUID, `${PHASE_ID}/extra`, ` ${PHASE_ID}`]
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

Deno.test("all five desired-state body fields remain required, no extras", async () => {
  for (const key of Object.keys(canonicalBody)) {
    const partial: Record<string, unknown> = { ...canonicalBody };
    delete partial[key];
    const calls: RpcCall[] = [];
    const executor = buildExecutor(calls, []);
    await assertRejects(
      () =>
        executor(
          authenticatedRequest(),
          PHASE_ID,
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
      PHASE_ID,
      // deno-lint-ignore no-explicit-any
      { ...canonicalBody, startDate: "2026-01-01" } as any,
      // deno-lint-ignore no-explicit-any
      mutationContext() as any,
    )
  );
  assertEquals(calls.length, 0);
});

Deno.test("stale_phase is returned unchanged with no retry or read-before-write", async () => {
  const calls: RpcCall[] = [];
  const executor = buildExecutor(calls, [], {
    data: { ok: false, outcome: "conflict", code: "stale_phase" },
    error: null,
  });
  const result = await executor(
    authenticatedRequest(),
    PHASE_ID,
    { ...canonicalBody },
    // deno-lint-ignore no-explicit-any
    mutationContext() as any,
  );
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.outcome, "conflict");
    assertEquals((result as { code?: string }).code, "stale_phase");
  }
  assertEquals(calls.length, 1, "exactly one RPC, no retry");
  assertEquals(calls[0].args._expected_updated_at, EXPECTED_UPDATED_AT);
});

Deno.test("expectedUpdatedAt is never refreshed or reformatted", () => {
  assert(!/new Date\(/.test(executorSource));
  assert(!/toISOString/.test(executorSource));
  assert(!/Date\.now/.test(executorSource));
  assert(!/get_phase|api_v1_get_phase|mcp_v1_get_phase/.test(executorSource));
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
    !/pmg_|apply_phase_update|api_v1_update_phase|updateApiV1Phase/.test(
      executorSource,
    ),
  );
  assert(!/registerTool|MCP_TOOL_REGISTRY|serverFactory/.test(executorSource));
  assert(!/for\s*\(|while\s*\(/.test(executorSource), "no retry loop");
  const invocations = executorSource.match(/updateMcpV1Phase\(client, \{/g) ??
    [];
  assertEquals(invocations.length, 1, "exactly one fixed MCP invocation site");
});

// Phase Update Step 4 exposed `phases.update`; the durable invariant asserted
// here is the canonical identity/metadata, not the exposure state.
Deno.test("phases.update keeps its canonical identity", () => {
  const entry = MCP_TOOL_REGISTRY.find((e) => e.operationId === "phases.update");
  assert(entry, "phases.update must exist in the registry");
  assertEquals(entry?.toolName, "btpm_update_phase");
  assertEquals(entry?.operationClass, "mutation");
  assertEquals(entry?.exposure, "exposed");
  assertEquals(entry?.confirmation, "required");
  assertEquals(entry?.concurrencyToken, "required");
});
