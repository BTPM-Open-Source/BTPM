// API-Q.10C2 — focused guard for the caller-bound MCP Blocker-create adapter.
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
} from "../../functions/_shared/btpm-api/supabaseBlocker.ts";
import { createMcpV1CreateBlockerExecutor } from "../../functions/btpm-mcp/mcp/blockerCreateMutationExecutor.ts";
import { MCP_TOOL_REGISTRY } from "../../functions/btpm-mcp/mcp/toolRegistry.ts";

const ADAPTER_URL = new URL(
  "../../functions/_shared/btpm-api/supabaseBlocker.ts",
  import.meta.url,
);
const EXECUTOR_URL = new URL(
  "../../functions/btpm-mcp/mcp/blockerCreateMutationExecutor.ts",
  import.meta.url,
);

const adapterSource = await Deno.readTextFile(ADAPTER_URL);
const executorSource = await Deno.readTextFile(EXECUTOR_URL);

const TARGET_ID = "11111111-1111-4111-8111-111111111111";
const BLOCKER_ID = "33333333-3333-4333-8333-333333333333";
const PAYLOAD_HASH = "c".repeat(64);
const TIMESTAMP = "2026-08-14T09:00:00Z";

const canonicalBody = Object.freeze({
  targetType: "project" as const,
  targetId: TARGET_ID,
  title: "Vendor environment access blocked",
  description: null,
  severity: "high" as const,
  status: "open" as const,
});

function successData() {
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
      blockerId: BLOCKER_ID,
      targetType: "project",
      targetId: TARGET_ID,
      severity: "high",
      status: "open",
      isResolved: false,
      resolvedAt: null,
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
  requestId: "req-10c2-0001",
  correlationId: "req-10c2-0001",
  idempotencyKey: "idem-10c2-0001",
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
    requestId: "req-10c2-0001",
    correlationId: "req-10c2-0001",
    sourceChannel: "mcp",
    sourceClientId: "api-client-1",
    delegationMode: "delegated_user",
    idempotencyKey: "idem-10c2-0001",
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
  return createMcpV1CreateBlockerExecutor(
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
// A. Blocker RPC adapter
// -----------------------------------------------------------------------------

Deno.test("REST Blocker create still calls only api_v1_create_blocker", async () => {
  const calls: RpcCall[] = [];
  const result = await createApiV1Blocker(recordingClient(calls), adapterInput);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, "api_v1_create_blocker");
  assertEquals(result.ok, true);
});

Deno.test("MCP Blocker create calls only mcp_v1_create_blocker", async () => {
  const calls: RpcCall[] = [];
  const result = await createMcpV1Blocker(recordingClient(calls), adapterInput);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, "mcp_v1_create_blocker");
  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.blockerId, BLOCKER_ID);
});

Deno.test("REST and MCP Blocker create share identical validation and mapping", async () => {
  const restCalls: RpcCall[] = [];
  const mcpCalls: RpcCall[] = [];
  const rest = await createApiV1Blocker(
    recordingClient(restCalls),
    adapterInput,
  );
  const mcp = await createMcpV1Blocker(recordingClient(mcpCalls), adapterInput);
  assertEquals(restCalls[0].args, mcpCalls[0].args);
  assertEquals(rest, mcp);

  // Identical rejection behaviour on an invalid input.
  const bad = { ...adapterInput, payloadHash: "nope" };
  await assertRejects(() => createApiV1Blocker(recordingClient([]), bad));
  await assertRejects(() => createMcpV1Blocker(recordingClient([]), bad));

  // One shared parametrised invocation site per fixed Blocker mutation
  // (create since API-Q.10C2, update since API-Q.10D2).
  const sharedInvocations =
    adapterSource.match(/client\.rpc\(functionName/g) ?? [];
  assertEquals(sharedInvocations.length, 2, "one shared site per mutation");
  const mapperDefs = adapterSource.match(/function toCreateResult\(/g) ?? [];
  assertEquals(mapperDefs.length, 1, "one bounded create result contract only");
});

Deno.test("wrapper names are fixed module constants and never caller-supplied", () => {
  assertStringIncludes(
    adapterSource,
    'const API_V1_CREATE_BLOCKER_FUNCTION_NAME = "api_v1_create_blocker"',
  );
  assertStringIncludes(
    adapterSource,
    'const MCP_V1_CREATE_BLOCKER_FUNCTION_NAME = "mcp_v1_create_blocker"',
  );
  assertEquals(createApiV1Blocker.length, 2);
  assertEquals(createMcpV1Blocker.length, 2);
  assert(
    !/export\s+(async\s+)?function\s+invokeCreateBlocker/.test(adapterSource),
    "the shared create invocation helper must not be exported",
  );
  assert(
    /function invokeCreateBlocker\(/.test(adapterSource),
    "a single shared internal create invocation helper must exist",
  );
  assert(!/operationId/.test(adapterSource), "no operationId dispatch");
  assert(!/execute_sql/.test(adapterSource));
  assert(!/\.from\(/.test(adapterSource));
});

Deno.test("Blocker update remains external-only", async () => {
  const calls: RpcCall[] = [];
  const result = await updateApiV1Blocker(recordingClient(calls, true), {
    expectedOauthClientId: "btpm-rest-client",
    blockerId: BLOCKER_ID,
    expectedUpdatedAt: TIMESTAMP,
    title: "Vendor environment access blocked",
    description: null,
    severity: "high",
    status: "open",
    requestId: "req-10c2-0002",
    correlationId: "req-10c2-0002",
    idempotencyKey: "idem-10c2-0002",
    payloadHash: PAYLOAD_HASH,
  });
  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, "api_v1_update_blocker");
  assertEquals(result.ok, true);
  assertStringIncludes(
    adapterSource,
    'const API_V1_UPDATE_BLOCKER_FUNCTION_NAME = "api_v1_update_blocker"',
  );
  // API-Q.10D2 added the fixed MCP-source update wrapper. What must still hold
  // for Blocker create is that the REST update export keeps calling only
  // `api_v1_update_blocker` (asserted above) and that the update path uses a
  // single non-exported shared helper over two fixed literal wrapper names.
  assert(
    /function invokeUpdateBlocker\(/.test(adapterSource) &&
      !/export\s+(async\s+)?function\s+invokeUpdateBlocker/.test(adapterSource),
    "update must use one non-exported shared invocation helper",
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
  ["requested user must be nonblank", { requestedUserId: "" }],
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

Deno.test("executor reuses the canonical Blocker-create body parser", async () => {
  assertStringIncludes(executorSource, "parseApiV1CreateBlockerBody");
  assert(
    !/CREATE_ALLOWED_KEYS|parseTargetType|parseSeverity|parseTitle/.test(
      executorSource,
    ),
    "executor must not reimplement Blocker validation",
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
  for (const call of calls) assertEquals(call.name, "mcp_v1_create_blocker");
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
    _title: "Vendor environment access blocked",
    _description: null,
    _severity: "high",
    _status: "open",
    _request_id: "req-10c2-0001",
    _correlation_id: "req-10c2-0001",
    _idempotency_key: "idem-10c2-0001",
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
  assertStringIncludes(executorSource, "createMcpV1Blocker");
  assert(
    !executorSource.includes("createApiV1Blocker"),
    "the MCP executor must never call the REST wrapper",
  );
});

Deno.test("executor contains no privileged, environment or side-effect behaviour", () => {
  assert(!/SERVICE_ROLE/i.test(executorSource));
  assert(!/serviceRole/.test(executorSource));
  assert(!/Deno\.env/.test(executorSource), "no environment read");
  assert(!/fetch\(/.test(executorSource), "no fetch call");
  assert(!/\.from\(/.test(executorSource), "no direct table access");
  assert(!/pmg_|apply_blocker_create|execute_sql/.test(executorSource));
  assert(!/setTimeout|setInterval/.test(executorSource));
  assert(!/console\./.test(executorSource), "no logging");
  assertEquals(createMcpV1CreateBlockerExecutor.length, 3);

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
// C. No MCP tool / registry / runtime exposure was introduced by this step.
// -----------------------------------------------------------------------------

Deno.test("this step owns no MCP registry/runtime composition of its own", async () => {
  // API-Q.10C4 reframing: `blockers.create` is now legitimately exposed and
  // wired. What this C2 test still owns is that the caller-bound adapter layer
  // itself performs no MCP registration or runtime composition, and that the
  // MCP database wrapper name stays confined to the adapter/database layers.
  const create = MCP_TOOL_REGISTRY.find(
    (entry) => entry.operationId === "blockers.create",
  );
  assert(create !== undefined);
  assertEquals(create.toolName, "btpm_create_blocker");
  assertEquals(create.operationClass, "mutation");
  assertEquals(create.confirmation, "required");

  const registrySource = await Deno.readTextFile(
    new URL("../../functions/btpm-mcp/mcp/toolRegistry.ts", import.meta.url),
  );
  const serverFactorySource = await Deno.readTextFile(
    new URL("../../functions/btpm-mcp/mcp/serverFactory.ts", import.meta.url),
  );
  const indexSource = await Deno.readTextFile(
    new URL("../../functions/btpm-mcp/index.ts", import.meta.url),
  );
  for (const source of [registrySource, serverFactorySource, indexSource]) {
    assert(
      !source.includes("mcp_v1_create_blocker"),
      "no transport/registry reference to the MCP Blocker wrapper",
    );
  }
  assert(
    !serverFactorySource.includes("createMcpV1CreateBlockerExecutor"),
    "serverFactory must never construct the caller-bound Blocker writer",
  );
});
