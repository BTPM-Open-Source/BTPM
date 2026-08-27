// API-Q Portfolio-10B — focused test for the caller-bound MCP Portfolio Update
// writer adapter.
//
// Proves the closed wrapper selection in `supabasePortfolioMutation.ts`, the
// shared validation/result mapping between the REST and MCP Portfolio Update
// adapters, the fail-closed caller-bound executor behaviour, and that
// `portfolios.update` remains unexposed over MCP.
//
// No database access, no network access, no Edge invocation.

import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  type ApiV1UpdatePortfolioInput,
  updateApiV1Portfolio,
  updateMcpV1Portfolio,
} from "../../functions/_shared/btpm-api/supabasePortfolioMutation.ts";
import { createMcpV1UpdatePortfolioExecutor } from "../../functions/btpm-mcp/mcp/portfolioUpdateMutationExecutor.ts";
import { ApiHttpError } from "../../functions/_shared/btpm-api/http.ts";
import { ApiAuthenticationError } from "../../functions/_shared/btpm-api/apiErrors.ts";

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

const PORTFOLIO_ID = "33333333-3333-4333-8333-333333333333";
const OWNER_ID = "44444444-4444-4444-8444-444444444444";
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const PAYLOAD_HASH = "c".repeat(64);
const UPDATED_AT = "2026-08-18T05:00:00.000Z";
const NEXT_UPDATED_AT = "2026-08-18T06:00:00.000Z";
const TOKEN = "caller.bearer.token";

const SUPABASE_URL = "https://project.supabase.co";
const ANON_KEY = "anon-publishable-key";

const RPC_ARG_KEYS: ReadonlyArray<string> = [
  "_expected_oauth_client_id",
  "_portfolio_item_id",
  "_expected_updated_at",
  "_name",
  "_set_name",
  "_code",
  "_set_code",
  "_description",
  "_set_description",
  "_lifecycle_state",
  "_set_lifecycle_state",
  "_strategic_priority",
  "_set_strategic_priority",
  "_owner_id",
  "_set_owner_id",
  "_request_id",
  "_correlation_id",
  "_idempotency_key",
  "_payload_hash",
];

function updateInput(
  overrides: Partial<ApiV1UpdatePortfolioInput> = {},
): ApiV1UpdatePortfolioInput {
  return {
    expectedOauthClientId: "btpm-connected-app",
    portfolioId: PORTFOLIO_ID,
    expectedUpdatedAt: UPDATED_AT,
    name: "Oncology Portfolio",
    setName: true,
    code: null,
    setCode: true,
    description: "Portfolio narrative",
    setDescription: true,
    lifecycleState: "development",
    setLifecycleState: true,
    strategicPriority: "high",
    setStrategicPriority: true,
    ownerId: OWNER_ID,
    setOwnerId: true,
    requestId: "req-1",
    correlationId: "req-1",
    idempotencyKey: "idem-1",
    payloadHash: PAYLOAD_HASH,
    ...overrides,
  };
}

function appliedData() {
  return {
    ok: true,
    outcome: "applied",
    portfolioId: PORTFOLIO_ID,
    updatedAt: NEXT_UPDATED_AT,
  };
}

function conflictData() {
  return { ok: false, outcome: "conflict", code: "stale_portfolio" };
}

interface RecordedCall {
  readonly functionName: string;
  readonly args: Record<string, unknown>;
}

function createRecordingClient(data: unknown, error: unknown = null) {
  const calls: RecordedCall[] = [];
  return {
    calls,
    client: {
      rpc(functionName: string, args: unknown) {
        calls.push({ functionName, args: args as Record<string, unknown> });
        return Promise.resolve({ data, error });
      },
    },
  };
}

function updateBody(overrides: Record<string, unknown> = {}) {
  return {
    expectedUpdatedAt: UPDATED_AT,
    name: "Oncology Portfolio",
    setName: true,
    code: null,
    setCode: true,
    description: "Portfolio narrative",
    setDescription: true,
    lifecycleState: "development",
    setLifecycleState: true,
    strategicPriority: "high",
    setStrategicPriority: true,
    ownerId: OWNER_ID,
    setOwnerId: true,
    ...overrides,
    // deno-lint-ignore no-explicit-any
  } as any;
}

function createContext(overrides: Record<string, unknown> = {}) {
  return {
    requestedUserId: "user-1",
    executingUserId: "user-1",
    apiClientId: "client-uuid-1",
    oauthClientId: "btpm-connected-app",
    policyVersionId: "policy-1",
    requestId: "req-1",
    correlationId: "req-1",
    sourceChannel: "mcp",
    sourceClientId: "client-uuid-1",
    delegationMode: "delegated_user",
    idempotencyKey: "idem-1",
    payloadHash: PAYLOAD_HASH,
    ...overrides,
    // deno-lint-ignore no-explicit-any
  } as any;
}

function authorizedRequest(): Request {
  return new Request("https://edge.local/mcp", {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
}

interface FactoryCall {
  readonly url: string;
  readonly key: string;
  readonly options: Record<string, unknown>;
}

function createTrackingFactory(data: unknown) {
  const factoryCalls: FactoryCall[] = [];
  const rpcCalls: RecordedCall[] = [];
  const factory = (url: string, key: string, options: unknown) => {
    factoryCalls.push({
      url,
      key,
      options: options as Record<string, unknown>,
    });
    return {
      rpc(functionName: string, args: unknown) {
        rpcCalls.push({ functionName, args: args as Record<string, unknown> });
        return Promise.resolve({ data, error: null });
      },
    };
  };
  return { factory, factoryCalls, rpcCalls };
}

const ADAPTER_SOURCE = await Deno.readTextFile(
  new URL(
    "../../functions/_shared/btpm-api/supabasePortfolioMutation.ts",
    import.meta.url,
  ),
);
const EXECUTOR_SOURCE = await Deno.readTextFile(
  new URL(
    "../../functions/btpm-mcp/mcp/portfolioUpdateMutationExecutor.ts",
    import.meta.url,
  ),
);
const REST_EXECUTOR_SOURCE = await Deno.readTextFile(
  new URL(
    "../../functions/_shared/btpm-api/supabaseDelegatedPortfolioMutation.ts",
    import.meta.url,
  ),
);

/** Strip `//` and block comments so governance prose cannot satisfy a guard. */
function stripTsComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => {
      const at = line.indexOf("//");
      return at === -1 ? line : line.slice(0, at);
    })
    .join("\n");
}

const EXECUTOR_CODE = stripTsComments(EXECUTOR_SOURCE);
const UPDATE_MARKER = "// API-Q Portfolio-5B";
const ASSIGN_MARKER = "// API-Q Portfolio-6B";
const UPDATE_BLOCK = ADAPTER_SOURCE.slice(
  ADAPTER_SOURCE.indexOf(UPDATE_MARKER),
  ADAPTER_SOURCE.indexOf(ASSIGN_MARKER),
);

// -----------------------------------------------------------------------------
// A. Shared Portfolio Update adapter
// -----------------------------------------------------------------------------

Deno.test("REST Portfolio Update invokes only api_v1_update_portfolio", async () => {
  const { calls, client } = createRecordingClient(appliedData());
  const result = await updateApiV1Portfolio(client, updateInput());
  assertEquals(calls.length, 1);
  assertEquals(calls[0].functionName, "api_v1_update_portfolio");
  assert(result.ok);
  assertEquals(result.outcome, "applied");
  assertEquals(result.updatedAt, NEXT_UPDATED_AT);
});

Deno.test("MCP Portfolio Update invokes only mcp_v1_update_portfolio", async () => {
  const { calls, client } = createRecordingClient(appliedData());
  const result = await updateMcpV1Portfolio(client, updateInput());
  assertEquals(calls.length, 1);
  assertEquals(calls[0].functionName, "mcp_v1_update_portfolio");
  assert(result.ok);
  assertEquals(result.outcome, "applied");
});

Deno.test("Portfolio Update wrapper constants are exact and closed", () => {
  assert(
    ADAPTER_SOURCE.includes(
      'const API_V1_UPDATE_PORTFOLIO_FUNCTION_NAME = "api_v1_update_portfolio";',
    ),
    "the fixed REST wrapper constant must exist",
  );
  assert(
    ADAPTER_SOURCE.includes(
      'const MCP_V1_UPDATE_PORTFOLIO_FUNCTION_NAME = "mcp_v1_update_portfolio";',
    ),
    "the fixed MCP wrapper constant must exist",
  );
  assert(
    /type UpdatePortfolioFunctionName =\s*\|\s*typeof API_V1_UPDATE_PORTFOLIO_FUNCTION_NAME\s*\|\s*typeof MCP_V1_UPDATE_PORTFOLIO_FUNCTION_NAME;/
      .test(ADAPTER_SOURCE),
    "the wrapper name type must be a closed two-member union",
  );
});

Deno.test("one shared closed Portfolio Update invocation path exists", () => {
  assert(
    /async function invokeUpdatePortfolio\(\s*functionName: UpdatePortfolioFunctionName,/
      .test(UPDATE_BLOCK),
    "the shared invocation must take the closed function-name type",
  );
  assertEquals(
    (UPDATE_BLOCK.match(/client\.rpc\(/g) ?? []).length,
    1,
    "exactly one RPC call site may exist in the Portfolio Update block",
  );
  assert(
    UPDATE_BLOCK.includes("result = await client.rpc(functionName, args);"),
    "the single RPC call site uses the closed wrapper name",
  );
  assertEquals(
    (UPDATE_BLOCK.match(/invokeUpdatePortfolio\(/g) ?? []).length,
    3,
    "one definition plus exactly two thin delegates",
  );
  assert(
    /export function updateApiV1Portfolio\(/.test(UPDATE_BLOCK),
    "the REST adapter remains exported with its original name",
  );
  assert(
    /export function updateMcpV1Portfolio\(/.test(UPDATE_BLOCK),
    "the MCP adapter is exported",
  );
});

Deno.test("REST and MCP Portfolio Update share the exact 19-argument mapping", async () => {
  const rest = createRecordingClient(appliedData());
  const mcp = createRecordingClient(appliedData());
  await updateApiV1Portfolio(rest.client, updateInput());
  await updateMcpV1Portfolio(mcp.client, updateInput());

  assertEquals(
    Object.keys(rest.calls[0].args).sort(),
    [...RPC_ARG_KEYS].sort(),
  );
  assertEquals(Object.keys(rest.calls[0].args).length, 19);
  assertEquals(rest.calls[0].args, mcp.calls[0].args);
  assertEquals(rest.calls[0].args._portfolio_item_id, PORTFOLIO_ID);
  assertEquals(rest.calls[0].args._expected_updated_at, UPDATED_AT);
  assertEquals(rest.calls[0].args._payload_hash, PAYLOAD_HASH);
});

Deno.test("explicit clears remain distinguishable from absent fields", async () => {
  const cleared = createRecordingClient(appliedData());
  await updateMcpV1Portfolio(
    cleared.client,
    updateInput({ code: null, setCode: true }),
  );
  assertEquals(cleared.calls[0].args._code, null);
  assertEquals(cleared.calls[0].args._set_code, true);

  const absent = createRecordingClient(appliedData());
  await updateMcpV1Portfolio(
    absent.client,
    updateInput({ code: null, setCode: false }),
  );
  assertEquals(absent.calls[0].args._code, null);
  assertEquals(absent.calls[0].args._set_code, false);

  const owner = createRecordingClient(appliedData());
  await updateMcpV1Portfolio(
    owner.client,
    updateInput({ ownerId: null, setOwnerId: true }),
  );
  assertEquals(owner.calls[0].args._owner_id, null);
  assertEquals(owner.calls[0].args._set_owner_id, true);
});

Deno.test("Portfolio Update result parity is preserved across both adapters", async () => {
  for (const invoke of [updateApiV1Portfolio, updateMcpV1Portfolio]) {
    const replayed = await invoke(
      createRecordingClient({
        ok: true,
        outcome: "replayed",
        portfolioId: PORTFOLIO_ID,
        updatedAt: UPDATED_AT,
      }).client,
      updateInput(),
    );
    assert(replayed.ok);
    assertEquals(replayed.outcome, "replayed");

    const conflict = await invoke(
      createRecordingClient(conflictData()).client,
      updateInput(),
    );
    assertEquals(conflict, {
      ok: false,
      outcome: "conflict",
      code: "stale_portfolio",
    });
    assert(!Object.keys(conflict).includes("currentUpdatedAt"));

    for (
      const outcome of [
        "invalid",
        "not_authorized",
        "idempotency_conflict",
        "idempotency_pending",
      ] as const
    ) {
      const negative = await invoke(
        createRecordingClient({ ok: false, outcome }).client,
        updateInput(),
      );
      assertEquals(negative, { ok: false, outcome });
    }
  }
});

Deno.test("Portfolio Update conflict cannot disclose a current timestamp", async () => {
  await assertRejects(
    () =>
      updateMcpV1Portfolio(
        createRecordingClient({
          ok: false,
          outcome: "conflict",
          code: "stale_portfolio",
          currentUpdatedAt: NEXT_UPDATED_AT,
        }).client,
        updateInput(),
      ),
    ApiHttpError,
  );
});

Deno.test("Portfolio Update validation and malformed envelopes fail closed on both adapters", async () => {
  for (const invoke of [updateApiV1Portfolio, updateMcpV1Portfolio]) {
    await assertRejects(
      () =>
        invoke(
          createRecordingClient(appliedData()).client,
          updateInput({ portfolioId: NIL_UUID }),
        ),
      ApiHttpError,
    );
    await assertRejects(
      () =>
        invoke(
          createRecordingClient(appliedData()).client,
          updateInput({ expectedUpdatedAt: "not-a-timestamp" }),
        ),
      ApiHttpError,
    );
    await assertRejects(
      () =>
        invoke(
          createRecordingClient(appliedData()).client,
          updateInput({ lifecycleState: "unknown_state" }),
        ),
      ApiHttpError,
    );
    await assertRejects(
      () =>
        invoke(
          createRecordingClient(appliedData()).client,
          updateInput({ payloadHash: "C".repeat(64) }),
        ),
      ApiHttpError,
    );
    await assertRejects(
      () =>
        invoke(
          createRecordingClient(appliedData()).client,
          updateInput({ setDescription: false, description: "leaked" }),
        ),
      ApiHttpError,
    );
    await assertRejects(
      () =>
        invoke(
          createRecordingClient(appliedData()).client,
          updateInput({ setName: true, name: null }),
        ),
      ApiHttpError,
    );
    await assertRejects(
      () => invoke(createRecordingClient(undefined).client, updateInput()),
      ApiHttpError,
    );
    await assertRejects(
      () =>
        invoke(
          createRecordingClient({ ok: true, outcome: "applied" }).client,
          updateInput(),
        ),
      ApiHttpError,
    );
  }
});

Deno.test("SQLSTATE 42501 maps to not_authorized and other errors to internal_error", async () => {
  for (const invoke of [updateApiV1Portfolio, updateMcpV1Portfolio]) {
    const denied = await assertRejects(
      () =>
        invoke(
          createRecordingClient(null, { code: "42501", message: "denied" })
            .client,
          updateInput(),
        ),
      ApiHttpError,
    );
    assertEquals(denied.code, "not_authorized");

    const other = await assertRejects(
      () =>
        invoke(
          createRecordingClient(null, { code: "XX000", message: "boom" })
            .client,
          updateInput(),
        ),
      ApiHttpError,
    );
    assertEquals(other.code, "internal_error");
  }
});

// -----------------------------------------------------------------------------
// B. Caller-bound MCP executor
// -----------------------------------------------------------------------------

Deno.test("executor reuses the canonical Portfolio path parser", () => {
  assert(
    EXECUTOR_CODE.includes("parseApiV1PortfolioUpdatePath"),
    "the canonical Portfolio identity parser must be reused",
  );
  assert(
    EXECUTOR_CODE.includes('"/v1/portfolios/"'),
    "the canonical Portfolio path prefix must be used",
  );
  assert(
    !EXECUTOR_CODE.includes("parseApiV1UpdatePortfolioBody"),
    "the raw PATCH body parser must not be re-run",
  );
});

Deno.test("malformed and nil Portfolio identifiers fail before any RPC", async () => {
  for (const badId of [NIL_UUID, "not-a-uuid", "", `${PORTFOLIO_ID}/`]) {
    const { factory, factoryCalls, rpcCalls } = createTrackingFactory(
      appliedData(),
    );
    const executor = createMcpV1UpdatePortfolioExecutor(
      SUPABASE_URL,
      ANON_KEY,
      factory,
    );
    await assertRejects(
      () =>
        executor(
          authorizedRequest(),
          badId,
          updateBody(),
          createContext(),
        ),
      ApiHttpError,
    );
    assertEquals(factoryCalls.length, 0);
    assertEquals(rpcCalls.length, 0);
  }
});

Deno.test("every trusted-context drift fails closed before client construction", async () => {
  const drifts: ReadonlyArray<Record<string, unknown>> = [
    { requestedUserId: "" },
    { executingUserId: "user-2" },
    { apiClientId: "" },
    { oauthClientId: "" },
    { policyVersionId: "" },
    { requestId: "" },
    { correlationId: "other" },
    { sourceClientId: "different-client" },
    { sourceChannel: "external_api" },
    { delegationMode: "service_account" },
    { idempotencyKey: "" },
    { payloadHash: "C".repeat(64) },
    { payloadHash: "abc" },
  ];
  for (const drift of drifts) {
    const { factory, factoryCalls, rpcCalls } = createTrackingFactory(
      appliedData(),
    );
    const executor = createMcpV1UpdatePortfolioExecutor(
      SUPABASE_URL,
      ANON_KEY,
      factory,
    );
    await assertRejects(
      () =>
        executor(
          authorizedRequest(),
          PORTFOLIO_ID,
          updateBody(),
          createContext(drift),
        ),
      ApiHttpError,
    );
    assertEquals(factoryCalls.length, 0);
    assertEquals(rpcCalls.length, 0);
  }
});

Deno.test("missing or malformed bearer fails before client construction", async () => {
  for (
    const headers of [
      {} as Record<string, string>,
      { Authorization: "Basic abc" },
      { Authorization: "Bearer" },
    ]
  ) {
    const { factory, factoryCalls, rpcCalls } = createTrackingFactory(
      appliedData(),
    );
    const executor = createMcpV1UpdatePortfolioExecutor(
      SUPABASE_URL,
      ANON_KEY,
      factory,
    );
    await assertRejects(
      () =>
        executor(
          new Request("https://edge.local/mcp", { method: "POST", headers }),
          PORTFOLIO_ID,
          updateBody(),
          createContext(),
        ),
      ApiAuthenticationError,
    );
    assertEquals(factoryCalls.length, 0);
    assertEquals(rpcCalls.length, 0);
  }
});

Deno.test("executor binds a fresh anon client to the current caller bearer", async () => {
  const { factory, factoryCalls, rpcCalls } = createTrackingFactory(
    appliedData(),
  );
  const executor = createMcpV1UpdatePortfolioExecutor(
    SUPABASE_URL,
    ANON_KEY,
    factory,
  );

  const first = await executor(
    authorizedRequest(),
    PORTFOLIO_ID,
    updateBody(),
    createContext(),
  );
  assert(first.ok);
  await executor(
    authorizedRequest(),
    PORTFOLIO_ID,
    updateBody(),
    createContext(),
  );

  assertEquals(factoryCalls.length, 2, "a fresh client per invocation");
  for (const call of factoryCalls) {
    assertEquals(call.url, SUPABASE_URL);
    assertEquals(call.key, ANON_KEY);
    const auth = call.options.auth as Record<string, unknown>;
    assertEquals(auth.persistSession, false);
    assertEquals(auth.autoRefreshToken, false);
    assertEquals(auth.detectSessionInUrl, false);
    const global = call.options.global as {
      headers: Record<string, string>;
    };
    assertEquals(global.headers.Authorization, `Bearer ${TOKEN}`);
  }
  assertEquals(rpcCalls.length, 2);
  for (const call of rpcCalls) {
    assertEquals(call.functionName, "mcp_v1_update_portfolio");
  }
});

Deno.test("executor passes the canonical body and trusted provenance unchanged", async () => {
  const { factory, rpcCalls } = createTrackingFactory(appliedData());
  const executor = createMcpV1UpdatePortfolioExecutor(
    SUPABASE_URL,
    ANON_KEY,
    factory,
  );
  await executor(
    authorizedRequest(),
    PORTFOLIO_ID,
    updateBody({
      code: null,
      setCode: false,
      description: null,
      setDescription: true,
    }),
    createContext(),
  );

  const args = rpcCalls[0].args;
  assertEquals(Object.keys(args).length, 19);
  assertEquals(args._portfolio_item_id, PORTFOLIO_ID);
  assertEquals(args._expected_updated_at, UPDATED_AT);
  assertEquals(args._set_code, false);
  assertEquals(args._code, null);
  assertEquals(args._set_description, true);
  assertEquals(args._description, null);
  assertEquals(args._set_name, true);
  assertEquals(args._name, "Oncology Portfolio");
  assertEquals(args._set_lifecycle_state, true);
  assertEquals(args._lifecycle_state, "development");
  assertEquals(args._set_strategic_priority, true);
  assertEquals(args._strategic_priority, "high");
  assertEquals(args._set_owner_id, true);
  assertEquals(args._owner_id, OWNER_ID);
  assertEquals(args._expected_oauth_client_id, "btpm-connected-app");
  assertEquals(args._request_id, "req-1");
  assertEquals(args._correlation_id, "req-1");
  assertEquals(args._idempotency_key, "idem-1");
  assertEquals(args._payload_hash, PAYLOAD_HASH);
});

Deno.test("stale conflict is returned without retry or concurrency refresh", async () => {
  const { factory, rpcCalls } = createTrackingFactory(conflictData());
  const executor = createMcpV1UpdatePortfolioExecutor(
    SUPABASE_URL,
    ANON_KEY,
    factory,
  );
  const result = await executor(
    authorizedRequest(),
    PORTFOLIO_ID,
    updateBody(),
    createContext(),
  );
  assertEquals(result, {
    ok: false,
    outcome: "conflict",
    code: "stale_portfolio",
  });
  assertEquals(rpcCalls.length, 1, "no retry may occur");
  assertEquals(rpcCalls[0].args._expected_updated_at, UPDATED_AT);
});

Deno.test("executor performs no read-before-write and no privileged execution", () => {
  assertEquals(
    (EXECUTOR_CODE.match(/\.rpc\(/g) ?? []).length,
    0,
    "the executor must not call rpc directly",
  );
  assert(!/\.from\(/.test(EXECUTOR_CODE), "no direct table access");
  assert(!/select\(/i.test(EXECUTOR_CODE), "no read-before-write");
  assert(
    !/service_role|SERVICE_ROLE|serviceRole/.test(EXECUTOR_CODE),
    "no service-role usage",
  );
  assert(
    !/Deno\.env/.test(EXECUTOR_CODE),
    "no environment reads inside the module",
  );
  assert(
    !EXECUTOR_CODE.includes("api_v1_update_portfolio"),
    "the REST wrapper must not be reachable from MCP",
  );
  assert(
    EXECUTOR_CODE.includes("updateMcpV1Portfolio("),
    "only the fixed MCP update adapter is invoked",
  );
});

Deno.test("REST Portfolio Update executor still uses updateApiV1Portfolio", () => {
  assert(
    REST_EXECUTOR_SOURCE.includes("updateApiV1Portfolio"),
    "the accepted REST delegated executor keeps the REST adapter",
  );
  assert(
    !REST_EXECUTOR_SOURCE.includes("updateMcpV1Portfolio"),
    "the REST path must not reach the MCP wrapper",
  );
});
