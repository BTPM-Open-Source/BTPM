// API-Q.10A3 — focused guard for the caller-bound MCP Risk-create adapter.
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
  createApiV1Risk,
  createMcpV1Risk,
  updateApiV1Risk,
} from "../../functions/_shared/btpm-api/supabaseRisk.ts";
import { createMcpV1CreateRiskExecutor } from "../../functions/btpm-mcp/mcp/riskCreateMutationExecutor.ts";
import { MCP_TOOL_REGISTRY } from "../../functions/btpm-mcp/mcp/toolRegistry.ts";

const ADAPTER_URL = new URL(
  "../../functions/_shared/btpm-api/supabaseRisk.ts",
  import.meta.url,
);
const EXECUTOR_URL = new URL(
  "../../functions/btpm-mcp/mcp/riskCreateMutationExecutor.ts",
  import.meta.url,
);

const adapterSource = await Deno.readTextFile(ADAPTER_URL);
const executorSource = await Deno.readTextFile(EXECUTOR_URL);

const TARGET_ID = "11111111-1111-4111-8111-111111111111";
const RISK_ID = "22222222-2222-4222-8222-222222222222";
const PAYLOAD_HASH = "b".repeat(64);
const TIMESTAMP = "2026-08-14T04:00:00Z";

const canonicalBody = Object.freeze({
  targetType: "project" as const,
  targetId: TARGET_ID,
  title: "Integration regression risk",
  description: null,
  mitigationPlan: null,
  likelihood: "medium" as const,
  impact: "high" as const,
  status: "open" as const,
});

function successData() {
  return {
    data: {
      ok: true,
      outcome: "applied",
      riskId: RISK_ID,
      targetType: "project",
      targetId: TARGET_ID,
      likelihood: "medium",
      impact: "high",
      status: "open",
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
    },
    error: null,
  };
}

function updateSuccessData() {
  return {
    data: {
      ok: true,
      outcome: "applied",
      riskId: RISK_ID,
      targetType: "project",
      targetId: TARGET_ID,
      likelihood: "medium",
      impact: "high",
      status: "open",
      updatedAt: TIMESTAMP,
    },
    error: null,
  };
}

interface RpcCall {
  readonly name: string;
  readonly args: Record<string, unknown>;
}

function recordingClient(calls: RpcCall[], update = false) {
  return {
    rpc(name: string, args: unknown) {
      calls.push({ name, args: { ...(args as Record<string, unknown>) } });
      return Promise.resolve(update ? updateSuccessData() : successData());
    },
  };
}

const adapterInput = Object.freeze({
  expectedOauthClientId: "btpm-mcp-client",
  ...canonicalBody,
  requestId: "req-10a3-0001",
  correlationId: "req-10a3-0001",
  idempotencyKey: "idem-10a3-0001",
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
    requestId: "req-10a3-0001",
    correlationId: "req-10a3-0001",
    sourceChannel: "mcp",
    sourceClientId: "api-client-1",
    delegationMode: "delegated_user",
    idempotencyKey: "idem-10a3-0001",
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

function buildExecutor(calls: RpcCall[], factoryCalls: FactoryCall[]) {
  return createMcpV1CreateRiskExecutor(
    "https://project.supabase.test",
    "anon-publishable-key",
    (url, key, options) => {
      factoryCalls.push({
        url,
        key,
        options: options as unknown as Record<string, unknown>,
      });
      return recordingClient(calls);
    },
  );
}

// -----------------------------------------------------------------------------
// A. Risk RPC adapter
// -----------------------------------------------------------------------------

Deno.test("REST Risk create still calls only api_v1_create_risk", async () => {
  const calls: RpcCall[] = [];
  const result = await createApiV1Risk(recordingClient(calls), adapterInput);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, "api_v1_create_risk");
  assertEquals(result.ok, true);
});

Deno.test("MCP Risk create calls only mcp_v1_create_risk", async () => {
  const calls: RpcCall[] = [];
  const result = await createMcpV1Risk(recordingClient(calls), adapterInput);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, "mcp_v1_create_risk");
  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.riskId, RISK_ID);
});

Deno.test("REST and MCP Risk create share identical validation and mapping", async () => {
  const restCalls: RpcCall[] = [];
  const mcpCalls: RpcCall[] = [];
  const rest = await createApiV1Risk(recordingClient(restCalls), adapterInput);
  const mcp = await createMcpV1Risk(recordingClient(mcpCalls), adapterInput);
  assertEquals(restCalls[0].args, mcpCalls[0].args);
  assertEquals(rest, mcp);

  // Identical rejection behaviour on an invalid input.
  const bad = { ...adapterInput, payloadHash: "nope" };
  await assertRejects(() => createApiV1Risk(recordingClient([]), bad));
  await assertRejects(() => createMcpV1Risk(recordingClient([]), bad));

  // API-Q.10B2 added the analogous fixed update helper, so two shared
  // `functionName` invocation sites exist (one per fixed mutation).
  const createInvocations = adapterSource.match(/client\.rpc\(functionName/g) ??
    [];
  assertEquals(createInvocations.length, 2, "one shared site per mutation");
  const mapperDefs = adapterSource.match(/function toCreateResult\(/g) ?? [];
  assertEquals(mapperDefs.length, 1, "one bounded create result contract only");
});

Deno.test("wrapper names are fixed module constants and never caller-supplied", () => {
  assertStringIncludes(
    adapterSource,
    'const API_V1_CREATE_RISK_FUNCTION_NAME = "api_v1_create_risk"',
  );
  assertStringIncludes(
    adapterSource,
    'const MCP_V1_CREATE_RISK_FUNCTION_NAME = "mcp_v1_create_risk"',
  );
  assertEquals(createApiV1Risk.length, 2);
  assertEquals(createMcpV1Risk.length, 2);
  assert(
    !/export\s+(async\s+)?function\s+invokeCreateRisk/.test(adapterSource),
    "the shared create invocation helper must not be exported",
  );
  assert(
    /function invokeCreateRisk\(/.test(adapterSource),
    "a single shared internal create invocation helper must exist",
  );
  assert(!/operationId/.test(adapterSource), "no operationId dispatch");
  assert(!/execute_sql/.test(adapterSource));
  assert(!/\.from\(/.test(adapterSource));
});

Deno.test("Risk update adapter remains unchanged", async () => {
  const calls: RpcCall[] = [];
  const result = await updateApiV1Risk(recordingClient(calls, true), {
    expectedOauthClientId: "btpm-rest-client",
    riskId: RISK_ID,
    expectedUpdatedAt: TIMESTAMP,
    title: "Integration regression risk",
    description: null,
    mitigationPlan: null,
    likelihood: "medium",
    impact: "high",
    status: "open",
    requestId: "req-10a3-0002",
    correlationId: "req-10a3-0002",
    idempotencyKey: "idem-10a3-0002",
    payloadHash: PAYLOAD_HASH,
  });
  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, "api_v1_update_risk");
  assertEquals(result.ok, true);
  assertStringIncludes(
    adapterSource,
    'const API_V1_UPDATE_RISK_FUNCTION_NAME = "api_v1_update_risk"',
  );
  // API-Q.10B2 — Risk update now routes through its own fixed internal helper
  // selecting between the two literal update wrapper constants.
  assert(
    /function invokeUpdateRisk\(/.test(adapterSource),
    "update keeps its own fixed RPC path",
  );
  assert(
    /return invokeUpdateRisk\(API_V1_UPDATE_RISK_FUNCTION_NAME, client, input\)/
      .test(adapterSource),
    "REST update binds only the api_v1_update_risk constant",
  );
});

// -----------------------------------------------------------------------------
// B. Caller-bound executor — trusted context invariants
// -----------------------------------------------------------------------------

const VIOLATIONS: ReadonlyArray<[string, Record<string, unknown>]> = [
  ["source channel must be mcp", { sourceChannel: "external_api" }],
  ["source channel must not be blank", { sourceChannel: "" }],
  ["delegation mode must be delegated_user", { delegationMode: "service" }],
  ["requested user must equal executing user", { executingUserId: "user-2" }],
  ["source client must equal api client", { sourceClientId: "api-client-2" }],
  ["correlation id must equal request id", { correlationId: "req-other" }],
  ["idempotency key must be nonblank", { idempotencyKey: "  " }],
  ["payload hash must be canonical sha256", { payloadHash: "abc" }],
  ["payload hash must be lowercase hex", { payloadHash: "A".repeat(64) }],
  ["oauth client must be nonblank", { oauthClientId: "" }],
  ["policy version must be nonblank", { policyVersionId: "" }],
  ["api client must be nonblank", { apiClientId: "" }],
  ["request id must be nonblank", { requestId: "", correlationId: "" }],
];

for (const [label, overrides] of VIOLATIONS) {
  Deno.test(`executor fails closed before client construction: ${label}`, async () => {
    const calls: RpcCall[] = [];
    const factoryCalls: FactoryCall[] = [];
    const executor = buildExecutor(calls, factoryCalls);
    await assertRejects(() =>
      executor(
        authenticatedRequest(),
        canonicalBody,
        mutationContext(overrides) as never,
      )
    );
    assertEquals(factoryCalls.length, 0, "no client constructed");
    assertEquals(calls.length, 0, "no RPC executed");
  });
}

Deno.test("executor rejects a malformed context and a non-Request argument", async () => {
  const calls: RpcCall[] = [];
  const factoryCalls: FactoryCall[] = [];
  const executor = buildExecutor(calls, factoryCalls);
  await assertRejects(() =>
    executor(authenticatedRequest(), canonicalBody, null as never)
  );
  await assertRejects(() =>
    executor(
      {} as unknown as Request,
      canonicalBody,
      mutationContext() as never,
    )
  );
  assertEquals(factoryCalls.length, 0);
  assertEquals(calls.length, 0);
});

// -----------------------------------------------------------------------------
// B. Caller-bound executor — canonical parsing, client, RPC mapping
// -----------------------------------------------------------------------------

Deno.test("executor reuses the canonical Risk-create body parser", async () => {
  assertStringIncludes(executorSource, "parseApiV1CreateRiskBody");
  assert(
    !/CREATE_ALLOWED_KEYS|parseTargetType|parseLikelihood|parseTitle/.test(
      executorSource,
    ),
    "executor must not reimplement Risk validation",
  );
  assert(
    !/toCreateResult|CREATE_SUCCESS_KEYS|NEGATIVE_OUTCOMES/.test(
      executorSource,
    ),
    "executor must not duplicate result parsing",
  );

  const calls: RpcCall[] = [];
  const factoryCalls: FactoryCall[] = [];
  const executor = buildExecutor(calls, factoryCalls);
  await assertRejects(() =>
    executor(
      authenticatedRequest(),
      { ...canonicalBody, confirmation: true } as never,
      mutationContext() as never,
    )
  );
  assertEquals(calls.length, 0, "non-canonical body rejected by the parser");
  assertEquals(factoryCalls.length, 0);
});

Deno.test("missing bearer fails before client construction and RPC", async () => {
  const calls: RpcCall[] = [];
  const factoryCalls: FactoryCall[] = [];
  const executor = buildExecutor(calls, factoryCalls);
  await assertRejects(() =>
    executor(
      new Request("https://mcp.example.test/mcp", { method: "POST" }),
      canonicalBody,
      mutationContext() as never,
    )
  );
  await assertRejects(() =>
    executor(
      new Request("https://mcp.example.test/mcp", {
        method: "POST",
        headers: { Authorization: "Basic abc" },
      }),
      canonicalBody,
      mutationContext() as never,
    )
  );
  assertEquals(factoryCalls.length, 0);
  assertEquals(calls.length, 0);
});

Deno.test("executor builds a fresh anon-key caller-bound client per call", async () => {
  const calls: RpcCall[] = [];
  const factoryCalls: FactoryCall[] = [];
  const executor = buildExecutor(calls, factoryCalls);

  await executor(
    authenticatedRequest(),
    canonicalBody,
    mutationContext() as never,
  );
  await executor(
    authenticatedRequest("second-token"),
    canonicalBody,
    mutationContext() as never,
  );

  assertEquals(factoryCalls.length, 2, "a fresh client per invocation");
  assertEquals(factoryCalls[0].url, "https://project.supabase.test");
  assertEquals(factoryCalls[0].key, "anon-publishable-key");
  assertEquals(factoryCalls[0].options, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { headers: { Authorization: "Bearer caller-access-token" } },
  });
  assertEquals(
    (factoryCalls[1].options as {
      global: { headers: { Authorization: string } };
    }).global.headers.Authorization,
    "Bearer second-token",
  );
  assertEquals(calls.length, 2);
  for (const call of calls) assertEquals(call.name, "mcp_v1_create_risk");
});

Deno.test("RPC mapping uses only canonical body plus trusted context fields", async () => {
  const calls: RpcCall[] = [];
  const factoryCalls: FactoryCall[] = [];
  const executor = buildExecutor(calls, factoryCalls);

  await executor(
    authenticatedRequest(),
    canonicalBody,
    mutationContext() as never,
  );

  assertEquals(calls[0].args, {
    _expected_oauth_client_id: "btpm-mcp-client",
    _target_type: "project",
    _target_id: TARGET_ID,
    _title: "Integration regression risk",
    _description: null,
    _mitigation_plan: null,
    _likelihood: "medium",
    _impact: "high",
    _status: "open",
    _request_id: "req-10a3-0001",
    _correlation_id: "req-10a3-0001",
    _idempotency_key: "idem-10a3-0001",
    _payload_hash: PAYLOAD_HASH,
  });

  const keys = Object.keys(calls[0].args);
  assert(
    !keys.some((k) => /confirm/i.test(k)),
    "confirmation must be absent from the RPC mapping",
  );
  assert(
    !keys.some((k) =>
      /source|channel|user|actor|policy|capability|organization|workspace|project/
        .test(k)
    ),
    "no source/provenance/actor/scope argument may be sent",
  );
  assertStringIncludes(executorSource, "createMcpV1Risk");
  assert(
    !executorSource.includes("createApiV1Risk"),
    "the MCP executor must never call the REST wrapper",
  );
});

Deno.test("executor contains no privileged, environment or side-effect behaviour", () => {
  assert(!/SERVICE_ROLE/i.test(executorSource));
  assert(!/serviceRole/.test(executorSource));
  assert(!/Deno\.env/.test(executorSource), "no environment read");
  assert(!/fetch\(/.test(executorSource), "no fetch call");
  assert(!/\.from\(/.test(executorSource), "no direct table access");
  assert(!/pmg_|apply_risk_create|execute_sql/.test(executorSource));
  assert(!/setTimeout|setInterval/.test(executorSource));
  assert(!/console\./.test(executorSource), "no logging");
  assertEquals(createMcpV1CreateRiskExecutor.length, 3);

  const executableSource = executorSource
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");
  assert(
    !/confirmation|confirmed|approve|force\b/.test(executableSource),
    "no confirmation alias is accepted here",
  );
  assert(
    !/crypto|digest|createHash/i.test(executableSource),
    "no hashing in the executor",
  );
});

// -----------------------------------------------------------------------------
// Registry / transport boundary — exposure is owned by API-Q.10A5, and the
// database wrapper name stays confined to the accepted adapter layer.
// -----------------------------------------------------------------------------

Deno.test("risks.create registry metadata and the wrapper-name boundary hold", async () => {
  const create = MCP_TOOL_REGISTRY.find(
    (entry) => entry.operationId === "risks.create",
  );
  assert(create !== undefined);
  assertEquals(create.toolName, "btpm_create_risk");
  assertEquals(create.operationClass, "mutation");
  assertEquals(create.confirmation, "required");

  // API-Q.10A5 exposed `risks.create` as the second MCP mutation,
  // API-Q.10B4 `risks.update` as the third, API-Q.10C4 `blockers.create` as
  // the fourth, API-Q.10D4 `blockers.update` as the fifth and Phase Create
  // Step 4 `phases.create` as the sixth.
  const exposed = MCP_TOOL_REGISTRY.filter((e) => e.exposure === "exposed");

  const registrySource = await Deno.readTextFile(
    new URL("../../functions/btpm-mcp/mcp/toolRegistry.ts", import.meta.url),
  );
  const serverFactorySource = await Deno.readTextFile(
    new URL("../../functions/btpm-mcp/mcp/serverFactory.ts", import.meta.url),
  );
  const indexSource = await Deno.readTextFile(
    new URL("../../functions/btpm-mcp/index.ts", import.meta.url),
  );
  // The fixed MCP database wrapper name must never leak into the registry, the
  // factory or the transport: only the accepted caller-bound adapter names it.
  for (const source of [registrySource, serverFactorySource, indexSource]) {
    assert(
      !source.includes("mcp_v1_create_risk"),
      "no transport/registry reference to the MCP Risk wrapper",
    );
  }
  // The registry and the factory never construct the caller-bound writer;
  // only the transport runtime does.
  for (const source of [registrySource, serverFactorySource]) {
    assert(
      !source.includes("createMcpV1CreateRiskExecutor"),
      "only the transport runtime may construct the Risk writer",
    );
  }
});
