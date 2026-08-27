// API-Q.10B2 — focused guard for the caller-bound MCP Risk-update adapter.
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
  updateApiV1Risk,
  updateMcpV1Risk,
} from "../../functions/_shared/btpm-api/supabaseRisk.ts";
import { createMcpV1UpdateRiskExecutor } from "../../functions/btpm-mcp/mcp/riskUpdateMutationExecutor.ts";
import { MCP_TOOL_REGISTRY } from "../../functions/btpm-mcp/mcp/toolRegistry.ts";

const ADAPTER_URL = new URL(
  "../../functions/_shared/btpm-api/supabaseRisk.ts",
  import.meta.url,
);
const EXECUTOR_URL = new URL(
  "../../functions/btpm-mcp/mcp/riskUpdateMutationExecutor.ts",
  import.meta.url,
);

const adapterSource = await Deno.readTextFile(ADAPTER_URL);
const executorSource = await Deno.readTextFile(EXECUTOR_URL);

const RISK_ID = "22222222-2222-4222-8222-222222222222";
const TARGET_ID = "11111111-1111-4111-8111-111111111111";
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const PAYLOAD_HASH = "c".repeat(64);
const EXPECTED_UPDATED_AT = "2026-08-14T04:00:00.123456+02:00";
const RESULT_TIMESTAMP = "2026-08-14T06:15:00Z";

const canonicalBody = Object.freeze({
  expectedUpdatedAt: EXPECTED_UPDATED_AT,
  title: "Integration regression risk",
  description: null,
  mitigationPlan: null,
  likelihood: "medium" as const,
  impact: "high" as const,
  status: "open" as const,
});

function updateSuccessData(outcome = "applied") {
  return {
    data: {
      ok: true,
      outcome,
      riskId: RISK_ID,
      targetType: "project",
      targetId: TARGET_ID,
      likelihood: "medium",
      impact: "high",
      status: "open",
      updatedAt: RESULT_TIMESTAMP,
    },
    error: null,
  };
}

interface RpcCall {
  readonly name: string;
  readonly args: Record<string, unknown>;
}

function recordingClient(calls: RpcCall[], data = updateSuccessData()) {
  return {
    rpc(name: string, args: unknown) {
      calls.push({ name, args: { ...(args as Record<string, unknown>) } });
      return Promise.resolve(data);
    },
  };
}

const adapterInput = Object.freeze({
  expectedOauthClientId: "btpm-mcp-client",
  riskId: RISK_ID,
  ...canonicalBody,
  requestId: "req-10b2-0001",
  correlationId: "req-10b2-0001",
  idempotencyKey: "idem-10b2-0001",
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
    requestId: "req-10b2-0001",
    correlationId: "req-10b2-0001",
    sourceChannel: "mcp",
    sourceClientId: "api-client-1",
    delegationMode: "delegated_user",
    idempotencyKey: "idem-10b2-0001",
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
  return createMcpV1UpdateRiskExecutor(
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
// A. Fixed supabaseRisk update adapters
// -----------------------------------------------------------------------------

Deno.test("REST Risk update still calls only api_v1_update_risk", async () => {
  const calls: RpcCall[] = [];
  const result = await updateApiV1Risk(recordingClient(calls), adapterInput);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, "api_v1_update_risk");
  assertEquals(result.ok, true);
});

Deno.test("MCP Risk update calls only mcp_v1_update_risk", async () => {
  const calls: RpcCall[] = [];
  const result = await updateMcpV1Risk(recordingClient(calls), adapterInput);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, "mcp_v1_update_risk");
  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.riskId, RISK_ID);
});

Deno.test("REST and MCP Risk update share identical validation and mapping", async () => {
  const restCalls: RpcCall[] = [];
  const mcpCalls: RpcCall[] = [];
  const rest = await updateApiV1Risk(recordingClient(restCalls), adapterInput);
  const mcp = await updateMcpV1Risk(recordingClient(mcpCalls), adapterInput);
  assertEquals(restCalls[0].args, mcpCalls[0].args);
  assertEquals(rest, mcp);

  const bad = { ...adapterInput, payloadHash: "nope" };
  await assertRejects(() => updateApiV1Risk(recordingClient([]), bad));
  await assertRejects(() => updateMcpV1Risk(recordingClient([]), bad));

  const badId = { ...adapterInput, riskId: "not-a-uuid" };
  await assertRejects(() => updateApiV1Risk(recordingClient([]), badId));
  await assertRejects(() => updateMcpV1Risk(recordingClient([]), badId));

  const invocations = adapterSource.match(/client\.rpc\(functionName/g) ?? [];
  assertEquals(invocations.length, 2, "one shared site per fixed mutation");
  const mapperDefs = adapterSource.match(/function toUpdateResult\(/g) ?? [];
  assertEquals(mapperDefs.length, 1, "one bounded update result contract only");
});

Deno.test("update wrapper names are fixed module constants, never caller-supplied", () => {
  assertStringIncludes(
    adapterSource,
    'const API_V1_UPDATE_RISK_FUNCTION_NAME = "api_v1_update_risk"',
  );
  assertStringIncludes(
    adapterSource,
    'const MCP_V1_UPDATE_RISK_FUNCTION_NAME = "mcp_v1_update_risk"',
  );
  assertEquals(updateApiV1Risk.length, 2);
  assertEquals(updateMcpV1Risk.length, 2);
  assert(
    !/export\s+(async\s+)?function\s+invokeUpdateRisk/.test(adapterSource),
    "the shared update invocation helper must not be exported",
  );
  assert(
    /function invokeUpdateRisk\(/.test(adapterSource),
    "a single shared internal update invocation helper must exist",
  );
  assert(!/operationId/.test(adapterSource), "no operationId dispatch");
  assert(!/\.from\(/.test(adapterSource));
});

// -----------------------------------------------------------------------------
// B. Exact Risk Update RPC arguments
// -----------------------------------------------------------------------------

Deno.test("executor passes canonical arguments through unchanged", async () => {
  const calls: RpcCall[] = [];
  const factoryCalls: FactoryCall[] = [];
  const executor = buildExecutor(calls, factoryCalls);

  const result = await executor(
    authenticatedRequest(),
    RISK_ID,
    { ...canonicalBody },
    // deno-lint-ignore no-explicit-any
    mutationContext() as any,
  );

  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, "mcp_v1_update_risk");
  assertEquals(calls[0].args, {
    _expected_oauth_client_id: "btpm-mcp-client",
    _risk_id: RISK_ID,
    _expected_updated_at: EXPECTED_UPDATED_AT,
    _title: canonicalBody.title,
    _description: null,
    _mitigation_plan: null,
    _likelihood: "medium",
    _impact: "high",
    _status: "open",
    _request_id: "req-10b2-0001",
    _correlation_id: "req-10b2-0001",
    _idempotency_key: "idem-10b2-0001",
    _payload_hash: PAYLOAD_HASH,
  });
  assertEquals(result.ok, true);
});

Deno.test("non-null narrative values are forwarded verbatim", async () => {
  const calls: RpcCall[] = [];
  const executor = buildExecutor(calls, []);
  await executor(
    authenticatedRequest(),
    RISK_ID,
    { ...canonicalBody, description: "desc text", mitigationPlan: "plan text" },
    // deno-lint-ignore no-explicit-any
    mutationContext() as any,
  );
  assertEquals(calls[0].args._description, "desc text");
  assertEquals(calls[0].args._mitigation_plan, "plan text");
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
    RISK_ID,
    { ...canonicalBody },
    // deno-lint-ignore no-explicit-any
    mutationContext() as any,
  );
  await executor(
    authenticatedRequest("token-two"),
    RISK_ID,
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
});

Deno.test("missing bearer fails before any client construction", async () => {
  const calls: RpcCall[] = [];
  const factoryCalls: FactoryCall[] = [];
  const executor = buildExecutor(calls, factoryCalls);
  await assertRejects(() =>
    executor(
      new Request("https://mcp.example.test/mcp", { method: "POST" }),
      RISK_ID,
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
  { payloadHash: "C".repeat(64) },
  { policyVersionId: "  " },
  { apiClientId: "" },
  { oauthClientId: "" },
  { requestId: "" },
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
          RISK_ID,
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
// E. Canonical Risk Update semantics
// -----------------------------------------------------------------------------

Deno.test("malformed and nil Risk IDs are rejected", async () => {
  for (const badId of ["", "not-a-uuid", NIL_UUID, `${RISK_ID}/extra`, ` ${RISK_ID}`]) {
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

Deno.test("all seven desired-state body fields remain required", async () => {
  const keys = Object.keys(canonicalBody);
  for (const key of keys) {
    const partial: Record<string, unknown> = { ...canonicalBody };
    delete partial[key];
    const calls: RpcCall[] = [];
    const executor = buildExecutor(calls, []);
    await assertRejects(
      () =>
        executor(
          authenticatedRequest(),
          RISK_ID,
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
});

Deno.test("stale_risk is returned unchanged with no retry or read-before-write", async () => {
  const calls: RpcCall[] = [];
  const executor = buildExecutor(calls, [], {
    data: { ok: false, outcome: "conflict", code: "stale_risk" },
    error: null,
  });
  const result = await executor(
    authenticatedRequest(),
    RISK_ID,
    { ...canonicalBody },
    // deno-lint-ignore no-explicit-any
    mutationContext() as any,
  );
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.outcome, "conflict");
    assertEquals((result as { code?: string }).code, "stale_risk");
  }
  assertEquals(calls.length, 1, "exactly one RPC, no retry");
  assertEquals(calls[0].args._expected_updated_at, EXPECTED_UPDATED_AT);
});

Deno.test("expectedUpdatedAt is never refreshed or reformatted", () => {
  assert(!/new Date\(/.test(executorSource));
  assert(!/toISOString/.test(executorSource));
  assert(!/Date\.now/.test(executorSource));
  assert(!/get_risk|api_v1_get_risk|mcp_v1_get_risk/.test(executorSource));
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
  assert(!/pmg_|apply_risk_update|api_v1_update_risk/.test(executorSource));
  assert(!/registerTool|MCP_TOOL_REGISTRY/.test(executorSource));
  assert(!/for\s*\(|while\s*\(/.test(executorSource), "no retry loop");
  assertStringIncludes(executorSource, "updateMcpV1Risk(client, {");
});

// API-Q.10B4 exposed `risks.update`. What must still hold for this adapter step
// is that the registry entry keeps its canonical identity and that the adapter
// itself performs no registration (asserted above).
Deno.test("risks.update keeps its canonical registry identity", () => {
  const entry = MCP_TOOL_REGISTRY.find((e) => e.operationId === "risks.update");
  assert(entry, "risks.update must exist in the registry");
  assertEquals(entry?.toolName, "btpm_update_risk");
  assertEquals(entry?.operationClass, "mutation");
  assertEquals(entry?.confirmation, "required");
  assertEquals(entry?.concurrencyToken, "required");
});
