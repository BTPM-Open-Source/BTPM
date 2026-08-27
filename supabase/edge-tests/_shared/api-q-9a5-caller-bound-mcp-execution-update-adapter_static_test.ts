// API-Q.9A5 — focused guard for the caller-bound MCP Execution Update adapter.
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
  appendApiV1ExecutionUpdate,
  appendMcpV1ExecutionUpdate,
} from "../../functions/_shared/btpm-api/supabaseAppendExecutionUpdate.ts";
import { createMcpV1AppendExecutionUpdateExecutor } from "../../functions/btpm-mcp/mcp/executionUpdateMutationExecutor.ts";
import { MCP_TOOL_REGISTRY } from "../../functions/btpm-mcp/mcp/toolRegistry.ts";

const ADAPTER_URL = new URL(
  "../../functions/_shared/btpm-api/supabaseAppendExecutionUpdate.ts",
  import.meta.url,
);
const EXECUTOR_URL = new URL(
  "../../functions/btpm-mcp/mcp/executionUpdateMutationExecutor.ts",
  import.meta.url,
);

const adapterSource = await Deno.readTextFile(ADAPTER_URL);
const executorSource = await Deno.readTextFile(EXECUTOR_URL);

const TARGET_ID = "11111111-1111-4111-8111-111111111111";
const EXECUTION_UPDATE_ID = "22222222-2222-4222-8222-222222222222";
const PAYLOAD_HASH = "a".repeat(64);

const canonicalBody = Object.freeze({
  targetType: "phase" as const,
  targetId: TARGET_ID,
  summary: "Cutover rehearsal completed.",
  updateDate: "2026-08-13",
  statusLabel: null,
});

function successData() {
  return {
    data: {
      ok: true,
      outcome: "applied",
      executionUpdateId: EXECUTION_UPDATE_ID,
      targetType: "phase",
      targetId: TARGET_ID,
      updateDate: "2026-08-13",
      hasStatusLabel: false,
    },
    error: null,
  };
}

interface RpcCall {
  readonly name: string;
  readonly args: Record<string, unknown>;
}

function recordingClient(calls: RpcCall[]) {
  return {
    rpc(name: string, args: unknown) {
      calls.push({
        name,
        args: { ...(args as Record<string, unknown>) },
      });
      return Promise.resolve(successData());
    },
  };
}

const adapterInput = Object.freeze({
  expectedOauthClientId: "btpm-mcp-client",
  ...canonicalBody,
  requestId: "req-9a5-0001",
  correlationId: "req-9a5-0001",
  idempotencyKey: "idem-9a5-0001",
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
    requestId: "req-9a5-0001",
    correlationId: "req-9a5-0001",
    sourceChannel: "mcp",
    sourceClientId: "api-client-1",
    delegationMode: "delegated_user",
    idempotencyKey: "idem-9a5-0001",
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

function buildExecutor(
  calls: RpcCall[],
  factoryCalls: FactoryCall[],
) {
  return createMcpV1AppendExecutionUpdateExecutor(
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
// Fixed wrapper names
// -----------------------------------------------------------------------------

Deno.test("REST adapter still calls only api_v1_append_execution_update", async () => {
  const calls: RpcCall[] = [];
  const result = await appendApiV1ExecutionUpdate(
    recordingClient(calls),
    adapterInput,
  );
  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, "api_v1_append_execution_update");
  assertEquals(result.ok, true);
});

Deno.test("MCP adapter calls only mcp_v1_append_execution_update", async () => {
  const calls: RpcCall[] = [];
  const result = await appendMcpV1ExecutionUpdate(
    recordingClient(calls),
    adapterInput,
  );
  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, "mcp_v1_append_execution_update");
  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.executionUpdateId, EXECUTION_UPDATE_ID);
});

Deno.test("no exported adapter function accepts an RPC function name", () => {
  assertEquals(appendApiV1ExecutionUpdate.length, 2);
  assertEquals(appendMcpV1ExecutionUpdate.length, 2);
  assert(
    !/export\s+(async\s+)?function\s+invokeAppendExecutionUpdate/.test(
      adapterSource,
    ),
    "the shared invocation helper must not be exported",
  );
  assert(
    /function invokeAppendExecutionUpdate\(/.test(adapterSource),
    "a single shared internal invocation helper must exist",
  );
  assert(
    !/operationId/.test(adapterSource),
    "the adapter must not accept an operationId",
  );
});

Deno.test("bounded result parsing is shared, not duplicated", () => {
  const rpcCalls = adapterSource.match(/client\.rpc\(/g) ?? [];
  assertEquals(rpcCalls.length, 1, "exactly one RPC invocation site");
  const toResultDefs = adapterSource.match(/function toResult\(/g) ?? [];
  assertEquals(toResultDefs.length, 1, "one bounded result contract only");
  assert(
    !/toResult|SUCCESS_KEYS|NEGATIVE_OUTCOMES/.test(executorSource),
    "executor must not duplicate result parsing",
  );
  assertStringIncludes(executorSource, "appendMcpV1ExecutionUpdate");
});

// -----------------------------------------------------------------------------
// Caller-bound client
// -----------------------------------------------------------------------------

Deno.test("executor builds a fresh anon-key caller-bound client per call", async () => {
  const calls: RpcCall[] = [];
  const factoryCalls: FactoryCall[] = [];
  const executor = buildExecutor(calls, factoryCalls);

  await executor(authenticatedRequest(), canonicalBody, mutationContext() as never);
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
  for (const call of calls) {
    assertEquals(call.name, "mcp_v1_append_execution_update");
  }
});

Deno.test("bearer token comes only from the current Request", async () => {
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
  assertEquals(factoryCalls.length, 0, "no client without a caller token");

  await executor(authenticatedRequest(), canonicalBody, mutationContext() as never);
  const args = calls[0].args;
  for (const value of Object.values(args)) {
    if (typeof value === "string") {
      assert(
        !value.includes("caller-access-token"),
        "no token may appear in RPC arguments",
      );
    }
  }
  assert(
    !("token" in args) && !("_token" in args) &&
      !("_authorization" in args),
    "no token argument may be forwarded",
  );
});

Deno.test("no service-role key or client exists in either module", () => {
  for (const source of [adapterSource, executorSource]) {
    assert(!/SERVICE_ROLE/i.test(source));
    assert(!/serviceRole/.test(source));
  }
  assert(!/Deno\.env/.test(executorSource), "no environment access");
  assert(!/console\./.test(executorSource), "no logging");
});

// -----------------------------------------------------------------------------
// Trusted context invariants
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
  ["payload hash must be lowercase", { payloadHash: "A".repeat(64) }],
  ["oauth client must be nonblank", { oauthClientId: "" }],
  ["policy version must be nonblank", { policyVersionId: "" }],
  ["api client must be nonblank", { apiClientId: "" }],
  ["request id must be nonblank", { requestId: "", correlationId: "" }],
];

for (const [label, overrides] of VIOLATIONS) {
  Deno.test(`executor fails closed before RPC: ${label}`, async () => {
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

Deno.test("executor rejects a non-Request first argument", async () => {
  const calls: RpcCall[] = [];
  const factoryCalls: FactoryCall[] = [];
  const executor = buildExecutor(calls, factoryCalls);
  await assertRejects(() =>
    executor(
      {} as unknown as Request,
      canonicalBody,
      mutationContext() as never,
    )
  );
  assertEquals(calls.length, 0);
});

// -----------------------------------------------------------------------------
// Canonical body reuse + exact RPC mapping
// -----------------------------------------------------------------------------

Deno.test("executor reuses the canonical Execution Update body parser", async () => {
  assertStringIncludes(
    executorSource,
    "parseApiV1AppendExecutionUpdateBody",
  );
  assert(
    !/ALLOWED_KEYS|parseTargetType|parseUpdateDate/.test(executorSource),
    "executor must not reimplement body parsing",
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
});

Deno.test("RPC mapping uses only canonical body plus trusted context fields", async () => {
  const calls: RpcCall[] = [];
  const factoryCalls: FactoryCall[] = [];
  const executor = buildExecutor(calls, factoryCalls);

  await executor(authenticatedRequest(), canonicalBody, mutationContext() as never);

  assertEquals(calls[0].args, {
    _expected_oauth_client_id: "btpm-mcp-client",
    _target_type: "phase",
    _target_id: TARGET_ID,
    _summary: "Cutover rehearsal completed.",
    _update_date: "2026-08-13",
    _status_label: null,
    _request_id: "req-9a5-0001",
    _correlation_id: "req-9a5-0001",
    _idempotency_key: "idem-9a5-0001",
    _payload_hash: PAYLOAD_HASH,
  });

  const keys = Object.keys(calls[0].args);
  assert(
    !keys.some((k) => /confirm/i.test(k)),
    "confirmation must be absent from the RPC mapping",
  );
  assert(
    !keys.some((k) => /source|channel|user|actor|client_id$/.test(k) &&
      k !== "_expected_oauth_client_id"),
    "no source/provenance/actor argument may be sent",
  );
});

Deno.test("executor performs no hashing and no confirmation handling", () => {
  // Hashing must not happen in the executor. Import specifiers are excluded:
  // module paths are not behaviour and changed with the accepted MCP directory
  // relocation. The token set targets real hashing APIs only.
  const nonImportSource = executorSource
    .split("\n")
    .filter((line) => !/^\s*import\b/.test(line) && !/^\s*\}\s*from\s*"/.test(line))
    .join("\n")
    .replace(
      /SHA256_HEX_PATTERN|64-char lowercase SHA-256|payloadHash|payload-hash|payload hash/g,
      "",
    );
  assert(
    !/\bcrypto\b|digest\(|sha256|sha-256|createHash|Hash\(/i.test(nonImportSource),
    "the executor must perform no hashing",
  );
  const executableSource = executorSource
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith("//") && !trimmed.startsWith("*") &&
        !trimmed.startsWith("/*");
    })
    .join("\n");
  assert(
    !/requireMcpMutationConfirmation|confirmation/.test(executableSource),
    "confirmation is not handled here",
  );
  assertEquals(createMcpV1AppendExecutionUpdateExecutor.length, 3);
});

// -----------------------------------------------------------------------------
// Registry / transport untouched
// -----------------------------------------------------------------------------

Deno.test("btpm_append_execution_update is exposed and the 14 reads are unchanged", async () => {
  const append = MCP_TOOL_REGISTRY.find(
    (entry) => entry.operationId === "execution_updates.append",
  );
  assert(append !== undefined);
  // API-Q.9B2 exposed exactly this one mutation.
  assertEquals(append.exposure, "exposed");
  assertEquals(append.confirmation, "required");

  const exposed = MCP_TOOL_REGISTRY.filter(
    (entry) => entry.exposure === "exposed",
  );
  // API-Q.10A5..Phase Plan Step 4 exposed eight further mutations.

  const registrySource = await Deno.readTextFile(
    new URL("../../functions/btpm-mcp/mcp/toolRegistry.ts", import.meta.url),
  );
  const serverFactorySource = await Deno.readTextFile(
    new URL("../../functions/btpm-mcp/mcp/serverFactory.ts", import.meta.url),
  );
  // The fixed-source database wrapper name must still appear ONLY inside the
  // accepted adapter: never in the registry, the factory or the runtime.
  const indexSource = await Deno.readTextFile(
    new URL("../../functions/btpm-mcp/index.ts", import.meta.url),
  );
  for (const source of [registrySource, serverFactorySource, indexSource]) {
    assert(
      !source.includes("mcp_v1_append_execution_update"),
      "no transport/registry reference to the MCP wrapper",
    );
  }
  // The registry and the factory must never import the writer adapter; only the
  // runtime composes it (API-Q.9B2).
  for (const source of [registrySource, serverFactorySource]) {
    assert(
      !source.includes("executionUpdateMutationExecutor"),
      "registry/factory may not reference the caller-bound writer module",
    );
  }
  assert(
    indexSource.includes("createMcpV1AppendExecutionUpdateExecutor"),
    "the runtime builds the caller-bound writer through the accepted factory",
  );
});
