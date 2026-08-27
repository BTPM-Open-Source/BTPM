// API-Q.10D2 — focused guard for the caller-bound MCP Blocker-update adapter.
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
  createApiV1Blocker,
  createMcpV1Blocker,
  updateApiV1Blocker,
  updateMcpV1Blocker,
} from "../../functions/_shared/btpm-api/supabaseBlocker.ts";
import { createMcpV1UpdateBlockerExecutor } from "../../functions/btpm-mcp/mcp/blockerUpdateMutationExecutor.ts";
import { MCP_TOOL_REGISTRY } from "../../functions/btpm-mcp/mcp/toolRegistry.ts";

const ADAPTER_URL = new URL(
  "../../functions/_shared/btpm-api/supabaseBlocker.ts",
  import.meta.url,
);
const EXECUTOR_URL = new URL(
  "../../functions/btpm-mcp/mcp/blockerUpdateMutationExecutor.ts",
  import.meta.url,
);
const REGISTRY_URL = new URL(
  "../../functions/btpm-mcp/mcp/toolRegistry.ts",
  import.meta.url,
);
const FACTORY_URL = new URL(
  "../../functions/btpm-mcp/mcp/serverFactory.ts",
  import.meta.url,
);

const adapterSource = await Deno.readTextFile(ADAPTER_URL);
const executorSource = await Deno.readTextFile(EXECUTOR_URL);

const BLOCKER_ID = "33333333-3333-4333-8333-333333333333";
const TARGET_ID = "11111111-1111-4111-8111-111111111111";
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const PAYLOAD_HASH = "d".repeat(64);
const EXPECTED_UPDATED_AT = "2026-08-14T04:00:00.123456+02:00";
const RESULT_TIMESTAMP = "2026-08-14T06:15:00Z";

const canonicalBody = Object.freeze({
  expectedUpdatedAt: EXPECTED_UPDATED_AT,
  title: "Vendor environment access blocked",
  description: null,
  severity: "high" as const,
  status: "open" as const,
});

function updateSuccessData(outcome = "applied") {
  return {
    data: {
      ok: true,
      outcome,
      blockerId: BLOCKER_ID,
      targetType: "project",
      targetId: TARGET_ID,
      severity: "high",
      status: "open",
      isResolved: false,
      resolvedAt: null,
      updatedAt: RESULT_TIMESTAMP,
    },
    error: null,
  };
}

function createSuccessData() {
  return {
    data: {
      ok: true,
      outcome: "applied",
      blockerId: BLOCKER_ID,
      targetType: "project",
      targetId: TARGET_ID,
      severity: "high",
      status: "open",
      isResolved: false,
      resolvedAt: null,
      createdAt: RESULT_TIMESTAMP,
      updatedAt: RESULT_TIMESTAMP,
    },
    error: null,
  };
}

interface RpcCall {
  readonly name: string;
  readonly args: Record<string, unknown>;
}

// deno-lint-ignore no-explicit-any
function recordingClient(calls: RpcCall[], data: any = updateSuccessData()) {
  return {
    rpc(name: string, args: unknown) {
      calls.push({ name, args: { ...(args as Record<string, unknown>) } });
      return Promise.resolve(data);
    },
  };
}

const adapterInput = Object.freeze({
  expectedOauthClientId: "btpm-mcp-client",
  blockerId: BLOCKER_ID,
  ...canonicalBody,
  requestId: "req-10d2-0001",
  correlationId: "req-10d2-0001",
  idempotencyKey: "idem-10d2-0001",
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
    requestId: "req-10d2-0001",
    correlationId: "req-10d2-0001",
    sourceChannel: "mcp",
    sourceClientId: "api-client-1",
    delegationMode: "delegated_user",
    idempotencyKey: "idem-10d2-0001",
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
  return createMcpV1UpdateBlockerExecutor(
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
// A. Fixed supabaseBlocker update adapters (1, 2, 3, 4, 5)
// -----------------------------------------------------------------------------

Deno.test("REST Blocker update still calls only api_v1_update_blocker", async () => {
  const calls: RpcCall[] = [];
  const result = await updateApiV1Blocker(recordingClient(calls), adapterInput);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, "api_v1_update_blocker");
  assertEquals(result.ok, true);
});

Deno.test("MCP Blocker update calls only mcp_v1_update_blocker", async () => {
  const calls: RpcCall[] = [];
  const result = await updateMcpV1Blocker(recordingClient(calls), adapterInput);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, "mcp_v1_update_blocker");
  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.blockerId, BLOCKER_ID);
});

Deno.test("REST and MCP Blocker update share identical validation and mapping", async () => {
  const restCalls: RpcCall[] = [];
  const mcpCalls: RpcCall[] = [];
  const rest = await updateApiV1Blocker(
    recordingClient(restCalls),
    adapterInput,
  );
  const mcp = await updateMcpV1Blocker(recordingClient(mcpCalls), adapterInput);
  assertEquals(restCalls[0].args, mcpCalls[0].args);
  assertEquals(rest, mcp);

  const bad = { ...adapterInput, payloadHash: "nope" };
  await assertRejects(() => updateApiV1Blocker(recordingClient([]), bad));
  await assertRejects(() => updateMcpV1Blocker(recordingClient([]), bad));

  const badId = { ...adapterInput, blockerId: "not-a-uuid" };
  await assertRejects(() => updateApiV1Blocker(recordingClient([]), badId));
  await assertRejects(() => updateMcpV1Blocker(recordingClient([]), badId));

  const badTimestamp = { ...adapterInput, expectedUpdatedAt: "yesterday" };
  await assertRejects(() =>
    updateApiV1Blocker(recordingClient([]), badTimestamp)
  );
  await assertRejects(() =>
    updateMcpV1Blocker(recordingClient([]), badTimestamp)
  );

  const badSeverity = { ...adapterInput, severity: "urgent" };
  // deno-lint-ignore no-explicit-any
  await assertRejects(() => updateApiV1Blocker(recordingClient([]), badSeverity as any));
  // deno-lint-ignore no-explicit-any
  await assertRejects(() => updateMcpV1Blocker(recordingClient([]), badSeverity as any));

  const mapperDefs = adapterSource.match(/function toUpdateResult\(/g) ?? [];
  assertEquals(mapperDefs.length, 1, "one bounded update result contract only");
});

Deno.test("update wrapper names are fixed module constants, never caller-supplied", () => {
  assertStringIncludes(
    adapterSource,
    'const API_V1_UPDATE_BLOCKER_FUNCTION_NAME = "api_v1_update_blocker"',
  );
  assertStringIncludes(
    adapterSource,
    'const MCP_V1_UPDATE_BLOCKER_FUNCTION_NAME = "mcp_v1_update_blocker"',
  );
  assertEquals(updateApiV1Blocker.length, 2);
  assertEquals(updateMcpV1Blocker.length, 2);
  assert(
    !/export\s+(async\s+)?function\s+invokeUpdateBlocker/.test(adapterSource),
    "the shared update invocation helper must not be exported",
  );
  const helpers = adapterSource.match(/function invokeUpdateBlocker\(/g) ?? [];
  assertEquals(helpers.length, 1, "exactly one shared internal update helper");
  // Both fixed mutations funnel through one shared `client.rpc(functionName…)`.
  const invocations = adapterSource.match(/client\.rpc\(functionName/g) ?? [];
  assertEquals(invocations.length, 2, "one shared site per fixed mutation");
  assert(!/operationId/.test(adapterSource), "no operationId dispatch");
  assert(!/\.from\(/.test(adapterSource));
  assert(
    !/UpdateBlockerFunctionName[\s\S]{0,80}string/.test(adapterSource),
    "the wrapper-name type must be a closed literal union",
  );
});

// -----------------------------------------------------------------------------
// B. Exact Blocker Update RPC arguments (6, 7, 8)
// -----------------------------------------------------------------------------

Deno.test("executor passes canonical arguments through unchanged", async () => {
  const calls: RpcCall[] = [];
  const factoryCalls: FactoryCall[] = [];
  const executor = buildExecutor(calls, factoryCalls);

  const result = await executor(
    authenticatedRequest(),
    BLOCKER_ID,
    { ...canonicalBody },
    // deno-lint-ignore no-explicit-any
    mutationContext() as any,
  );

  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, "mcp_v1_update_blocker");
  assertEquals(calls[0].args, {
    _expected_oauth_client_id: "btpm-mcp-client",
    _blocker_id: BLOCKER_ID,
    _expected_updated_at: EXPECTED_UPDATED_AT,
    _title: canonicalBody.title,
    _description: null,
    _severity: "high",
    _status: "open",
    _request_id: "req-10d2-0001",
    _correlation_id: "req-10d2-0001",
    _idempotency_key: "idem-10d2-0001",
    _payload_hash: PAYLOAD_HASH,
  });
  assertEquals(result.ok, true);
  // No source channel, scope, link or independent provenance argument.
  for (
    const forbidden of [
      "_source_channel",
      "_project_id",
      "_workspace_id",
      "_organization_id",
      "_tenant_id",
      "_user_links",
      "_object_links",
      "_actor",
      "_actor_id",
    ]
  ) {
    assert(!(forbidden in calls[0].args), `${forbidden} must not be sent`);
  }
});

Deno.test("non-null description is forwarded verbatim without logging", async () => {
  const calls: RpcCall[] = [];
  const executor = buildExecutor(calls, []);
  await executor(
    authenticatedRequest(),
    BLOCKER_ID,
    { ...canonicalBody, description: "vendor VPN pending, escalated" },
    // deno-lint-ignore no-explicit-any
    mutationContext() as any,
  );
  assertEquals(calls[0].args._description, "vendor VPN pending, escalated");
  assert(!/console\./.test(executorSource), "no narrative logging");
});

// -----------------------------------------------------------------------------
// C. Caller-bound execution (9, 10)
// -----------------------------------------------------------------------------

Deno.test("fresh anon-key client bound to the current bearer per invocation", async () => {
  const calls: RpcCall[] = [];
  const factoryCalls: FactoryCall[] = [];
  const executor = buildExecutor(calls, factoryCalls);

  await executor(
    authenticatedRequest("token-one"),
    BLOCKER_ID,
    { ...canonicalBody },
    // deno-lint-ignore no-explicit-any
    mutationContext() as any,
  );
  await executor(
    authenticatedRequest("token-two"),
    BLOCKER_ID,
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

Deno.test("missing or malformed bearer fails before client construction", async () => {
  for (
    const headers of [
      undefined,
      { Authorization: "Bearer " },
      { Authorization: "Basic abc" },
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
        BLOCKER_ID,
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
// D. Trusted context fail-closed (11–17)
// -----------------------------------------------------------------------------

const INCONSISTENT_CONTEXTS: ReadonlyArray<Record<string, unknown>> = [
  { executingUserId: "user-2" },
  { requestedUserId: "user-2" },
  { sourceClientId: "other-client" },
  { correlationId: "req-other" },
  { sourceChannel: "external_api" },
  { sourceChannel: "btpm_ui" },
  { delegationMode: "service_account" },
  { payloadHash: "NOTAHASH" },
  { payloadHash: "D".repeat(64) },
  { payloadHash: "d".repeat(63) },
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
          BLOCKER_ID,
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
// E. Canonical Blocker Update semantics (18, 19, 20)
// -----------------------------------------------------------------------------

Deno.test("malformed and nil Blocker IDs are rejected before any RPC", async () => {
  for (
    const badId of [
      "",
      "not-a-uuid",
      NIL_UUID,
      `${BLOCKER_ID}/extra`,
      ` ${BLOCKER_ID}`,
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
});

Deno.test("all five desired-state body fields remain required", async () => {
  const keys = Object.keys(canonicalBody);
  assertEquals(keys.length, 5);
  for (const key of keys) {
    const partial: Record<string, unknown> = { ...canonicalBody };
    delete partial[key];
    const calls: RpcCall[] = [];
    const executor = buildExecutor(calls, []);
    await assertRejects(
      () =>
        executor(
          authenticatedRequest(),
          BLOCKER_ID,
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

Deno.test("stale_blocker is returned unchanged with no retry or read-before-write", async () => {
  const calls: RpcCall[] = [];
  const executor = buildExecutor(calls, [], {
    data: { ok: false, outcome: "conflict", code: "stale_blocker" },
    error: null,
  });
  const result = await executor(
    authenticatedRequest(),
    BLOCKER_ID,
    { ...canonicalBody },
    // deno-lint-ignore no-explicit-any
    mutationContext() as any,
  );
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.outcome, "conflict");
    assertEquals((result as { code?: string }).code, "stale_blocker");
  }
  assertEquals(calls.length, 1, "exactly one RPC, no retry");
  assertEquals(calls[0].args._expected_updated_at, EXPECTED_UPDATED_AT);
});

Deno.test("expectedUpdatedAt is never refreshed or reformatted", () => {
  assert(!/new Date\(/.test(executorSource));
  assert(!/toISOString/.test(executorSource));
  assert(!/Date\.now/.test(executorSource));
  assert(
    !/get_blocker|api_v1_get_blocker|mcp_v1_get_blocker/.test(executorSource),
  );
  assertStringIncludes(
    executorSource,
    "expectedUpdatedAt: canonicalBody.expectedUpdatedAt,",
  );
});

// -----------------------------------------------------------------------------
// F. Forbidden surfaces (21, 22, 23)
// -----------------------------------------------------------------------------

Deno.test("executor introduces no forbidden surface", () => {
  assert(!/SERVICE_ROLE|service_role|serviceRole/.test(executorSource));
  assert(!/Deno\.env/.test(executorSource));
  assert(!/fetch\(/.test(executorSource));
  assert(!/\.from\(/.test(executorSource));
  assert(!/setTimeout|setInterval/.test(executorSource));
  assert(
    !/pmg_|apply_blocker_update|api_v1_update_blocker/.test(executorSource),
  );
  assert(!/registerTool|MCP_TOOL_REGISTRY/.test(executorSource));
  assert(!/confirm/i.test(executorSource.replace(/^\/\/.*$/gm, "")));
  assert(!/for\s*\(|while\s*\(/.test(executorSource), "no retry loop");
  assertStringIncludes(executorSource, "updateMcpV1Blocker(client, {");
});

Deno.test("blockers.update stays a registry-declared mutation; the writer stays out of registry/factory", async () => {
  const entry = MCP_TOOL_REGISTRY.find((e) =>
    e.operationId === "blockers.update"
  );
  assert(entry, "blockers.update must exist in the registry");
  assertEquals(entry?.operationClass, "mutation");
  assertEquals(entry?.confirmation, "required");
  assertEquals(entry?.concurrencyToken, "required");

  // Durable invariant (API-Q.10D4 exposed the tool): the caller-bound writer
  // and the database wrapper name must NEVER leak into the registry or the
  // server factory. Only the runtime constructs the writer.
  const registrySource = await Deno.readTextFile(REGISTRY_URL);
  const factorySource = await Deno.readTextFile(FACTORY_URL);
  for (const source of [registrySource, factorySource]) {
    assert(
      !source.includes("blockerUpdateMutationExecutor") &&
        !source.includes("createMcpV1UpdateBlockerExecutor") &&
        !source.includes("mcp_v1_update_blocker"),
      "the caller-bound writer must stay out of the registry and factory",
    );
  }
});

Deno.test("Blocker Create behaviour remains unchanged", async () => {
  const createInput = Object.freeze({
    expectedOauthClientId: "btpm-mcp-client",
    targetType: "project" as const,
    targetId: TARGET_ID,
    title: canonicalBody.title,
    description: null,
    severity: canonicalBody.severity,
    status: canonicalBody.status,
    requestId: "req-10d2-0001",
    correlationId: "req-10d2-0001",
    idempotencyKey: "idem-10d2-0001",
    payloadHash: PAYLOAD_HASH,
  });

  const restCalls: RpcCall[] = [];
  const mcpCalls: RpcCall[] = [];
  const rest = await createApiV1Blocker(
    recordingClient(restCalls, createSuccessData()),
    createInput,
  );
  const mcp = await createMcpV1Blocker(
    recordingClient(mcpCalls, createSuccessData()),
    createInput,
  );
  assertEquals(restCalls[0].name, "api_v1_create_blocker");
  assertEquals(mcpCalls[0].name, "mcp_v1_create_blocker");
  assertEquals(restCalls[0].args, mcpCalls[0].args);
  assertEquals(rest, mcp);
  const createHelpers = adapterSource.match(/function invokeCreateBlocker\(/g) ??
    [];
  assertEquals(createHelpers.length, 1);
});
