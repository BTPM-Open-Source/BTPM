// API-Q Portfolio-11B — focused test for the caller-bound MCP Project↔Portfolio
// assignment writer adapter.
//
// Proves the closed wrapper selection in `supabasePortfolioMutation.ts`, the
// shared validation/argument/result mapping between the REST and MCP assignment
// adapters, the fail-closed caller-bound executor behaviour, and that
// `portfolios.assign_project` remains unexposed over MCP.
//
// No database access, no network access, no Edge invocation.

import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  type ApiV1AssignProjectPortfolioInput,
  assignApiV1ProjectPortfolio,
  assignMcpV1ProjectPortfolio,
} from "../../functions/_shared/btpm-api/supabasePortfolioMutation.ts";
import { createMcpV1AssignProjectPortfolioExecutor } from "../../functions/btpm-mcp/mcp/portfolioAssignmentMutationExecutor.ts";
import { ApiHttpError } from "../../functions/_shared/btpm-api/http.ts";
import { ApiAuthenticationError } from "../../functions/_shared/btpm-api/apiErrors.ts";

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const PORTFOLIO_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_PORTFOLIO_ID = "33333333-3333-4333-8333-333333333333";
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const PAYLOAD_HASH = "a".repeat(64);
const TOKEN = "caller.bearer.token";

const SUPABASE_URL = "https://project.supabase.co";
const ANON_KEY = "anon-publishable-key";

const RPC_ARG_KEYS: ReadonlyArray<string> = [
  "_expected_oauth_client_id",
  "_project_id",
  "_portfolio_item_id",
  "_request_id",
  "_correlation_id",
  "_idempotency_key",
  "_payload_hash",
];

function assignInput(
  overrides: Partial<ApiV1AssignProjectPortfolioInput> = {},
): ApiV1AssignProjectPortfolioInput {
  return {
    expectedOauthClientId: "btpm-connected-app",
    projectId: PROJECT_ID,
    portfolioId: PORTFOLIO_ID,
    requestId: "req-1",
    correlationId: "req-1",
    idempotencyKey: "idem-1",
    payloadHash: PAYLOAD_HASH,
    ...overrides,
  };
}

function appliedData(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ok: true,
    outcome: "applied",
    projectId: PROJECT_ID,
    oldPortfolioId: OTHER_PORTFOLIO_ID,
    newPortfolioId: PORTFOLIO_ID,
    ...overrides,
  };
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

function assignBody(portfolioId: string | null = PORTFOLIO_ID) {
  // deno-lint-ignore no-explicit-any
  return { portfolioId } as any;
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
  const clients: unknown[] = [];
  const factory = (url: string, key: string, options: unknown) => {
    factoryCalls.push({
      url,
      key,
      options: options as Record<string, unknown>,
    });
    const client = {
      rpc(functionName: string, args: unknown) {
        rpcCalls.push({ functionName, args: args as Record<string, unknown> });
        return Promise.resolve({ data, error: null });
      },
    };
    clients.push(client);
    return client;
  };
  return { factory, factoryCalls, rpcCalls, clients };
}

const ADAPTER_SOURCE = await Deno.readTextFile(
  new URL(
    "../../functions/_shared/btpm-api/supabasePortfolioMutation.ts",
    import.meta.url,
  ),
);
const EXECUTOR_SOURCE = await Deno.readTextFile(
  new URL(
    "../../functions/btpm-mcp/mcp/portfolioAssignmentMutationExecutor.ts",
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
const ASSIGN_BLOCK = ADAPTER_SOURCE.slice(
  ADAPTER_SOURCE.indexOf("// API-Q Portfolio-6B"),
);

// -----------------------------------------------------------------------------
// A. Shared assignment adapter
// -----------------------------------------------------------------------------

Deno.test("REST assignment invokes only api_v1_assign_project_portfolio", async () => {
  const { calls, client } = createRecordingClient(appliedData());
  const result = await assignApiV1ProjectPortfolio(client, assignInput());
  assertEquals(calls.length, 1);
  assertEquals(calls[0].functionName, "api_v1_assign_project_portfolio");
  assert(result.ok);
  assertEquals(result.outcome, "applied");
  assertEquals(result.projectId, PROJECT_ID);
});

Deno.test("MCP assignment invokes only mcp_v1_assign_project_portfolio", async () => {
  const { calls, client } = createRecordingClient(appliedData());
  const result = await assignMcpV1ProjectPortfolio(client, assignInput());
  assertEquals(calls.length, 1);
  assertEquals(calls[0].functionName, "mcp_v1_assign_project_portfolio");
  assert(result.ok);
  assertEquals(result.outcome, "applied");
});

Deno.test("assignment wrapper constants are exact and closed", () => {
  assert(
    ADAPTER_SOURCE.includes(
      'const API_V1_ASSIGN_PROJECT_PORTFOLIO_FUNCTION_NAME =\n  "api_v1_assign_project_portfolio";',
    ),
    "the fixed REST wrapper constant must exist",
  );
  assert(
    ADAPTER_SOURCE.includes(
      'const MCP_V1_ASSIGN_PROJECT_PORTFOLIO_FUNCTION_NAME =\n  "mcp_v1_assign_project_portfolio";',
    ),
    "the fixed MCP wrapper constant must exist",
  );
  assert(
    /type AssignProjectPortfolioFunctionName =\s*\|\s*typeof API_V1_ASSIGN_PROJECT_PORTFOLIO_FUNCTION_NAME\s*\|\s*typeof MCP_V1_ASSIGN_PROJECT_PORTFOLIO_FUNCTION_NAME;/
      .test(ADAPTER_SOURCE),
    "the wrapper name type must be a closed two-member union",
  );
});

Deno.test("one shared closed assignment invocation path exists", () => {
  assert(
    /async function invokeAssignProjectPortfolio\(\s*functionName: AssignProjectPortfolioFunctionName,/
      .test(ASSIGN_BLOCK),
    "the shared invocation must take the closed function-name type",
  );
  assertEquals(
    (ASSIGN_BLOCK.match(/client\.rpc\(/g) ?? []).length,
    1,
    "exactly one RPC call site may exist in the assignment block",
  );
  assert(
    ASSIGN_BLOCK.includes("result = await client.rpc(functionName, args);"),
    "the single RPC call site uses the closed wrapper name",
  );
  assertEquals(
    (ASSIGN_BLOCK.match(/invokeAssignProjectPortfolio\(/g) ?? []).length,
    3,
    "one definition plus exactly two thin delegates",
  );
  assert(
    /export function assignApiV1ProjectPortfolio\(/.test(ASSIGN_BLOCK),
    "the REST adapter remains exported with its original name",
  );
  assert(
    /export function assignMcpV1ProjectPortfolio\(/.test(ASSIGN_BLOCK),
    "the MCP adapter is exported",
  );
});

Deno.test("REST and MCP assignment share the exact seven-argument mapping", async () => {
  const rest = createRecordingClient(appliedData());
  const mcp = createRecordingClient(appliedData());
  await assignApiV1ProjectPortfolio(rest.client, assignInput());
  await assignMcpV1ProjectPortfolio(mcp.client, assignInput());

  assertEquals(
    Object.keys(rest.calls[0].args).sort(),
    [...RPC_ARG_KEYS].sort(),
  );
  assertEquals(Object.keys(rest.calls[0].args).length, 7);
  assertEquals(rest.calls[0].args, mcp.calls[0].args);
  assertEquals(rest.calls[0].args._project_id, PROJECT_ID);
  assertEquals(rest.calls[0].args._portfolio_item_id, PORTFOLIO_ID);
  assertEquals(rest.calls[0].args._payload_hash, PAYLOAD_HASH);
  assert(!("_execution_source" in rest.calls[0].args));
  assert(!("_expected_updated_at" in rest.calls[0].args));
});

Deno.test("null portfolioId reaches _portfolio_item_id unchanged", async () => {
  for (const invoke of [assignApiV1ProjectPortfolio, assignMcpV1ProjectPortfolio]) {
    const { calls, client } = createRecordingClient(
      appliedData({ newPortfolioId: null }),
    );
    const result = await invoke(client, assignInput({ portfolioId: null }));
    assertEquals(calls[0].args._portfolio_item_id, null);
    assert("_portfolio_item_id" in calls[0].args);
    assert(result.ok);
    assertEquals(result.newPortfolioId, null);
  }
});

Deno.test("assignment result parity is preserved across both adapters", async () => {
  for (const invoke of [assignApiV1ProjectPortfolio, assignMcpV1ProjectPortfolio]) {
    for (const outcome of ["applied", "no_change", "replayed"]) {
      const success = await invoke(
        createRecordingClient(appliedData({ outcome })).client,
        assignInput(),
      );
      assert(success.ok);
      assertEquals(success.outcome, outcome);
      assertEquals(success.oldPortfolioId, OTHER_PORTFOLIO_ID);
    }

    for (
      const outcome of [
        "invalid",
        "not_authorized",
        "idempotency_conflict",
        "idempotency_pending",
      ]
    ) {
      const negative = await invoke(
        createRecordingClient({ ok: false, outcome }).client,
        assignInput(),
      );
      assertEquals(negative, {
        ok: false,
        outcome:
          outcome as "invalid" | "not_authorized" | "idempotency_conflict" |
            "idempotency_pending",
      });
    }

    await assertRejects(
      () =>
        invoke(
          createRecordingClient({ ok: false, outcome: "conflict" }).client,
          assignInput(),
        ),
      ApiHttpError,
    );

    await assertRejects(
      () => invoke(createRecordingClient({ nope: true }).client, assignInput()),
      ApiHttpError,
    );
  }
});

Deno.test("SQLSTATE 42501 maps to not_authorized for both adapters", async () => {
  for (const invoke of [assignApiV1ProjectPortfolio, assignMcpV1ProjectPortfolio]) {
    const error = await assertRejects(
      () =>
        invoke(
          createRecordingClient(null, { code: "42501" }).client,
          assignInput(),
        ),
      ApiHttpError,
    );
    assertEquals((error as ApiHttpError).code, "not_authorized");

    const other = await assertRejects(
      () =>
        invoke(
          createRecordingClient(null, { code: "23505" }).client,
          assignInput(),
        ),
      ApiHttpError,
    );
    assertEquals((other as ApiHttpError).code, "internal_error");
  }
});

Deno.test("malformed adapter inputs fail before the RPC", async () => {
  const { calls, client } = createRecordingClient(appliedData());
  await assertRejects(
    () => assignMcpV1ProjectPortfolio(client, assignInput({ projectId: NIL_UUID })),
    ApiHttpError,
  );
  await assertRejects(
    () =>
      assignMcpV1ProjectPortfolio(client, assignInput({ payloadHash: "ZZ" })),
    ApiHttpError,
  );
  assertEquals(calls.length, 0);
});

// -----------------------------------------------------------------------------
// B. Caller-bound MCP executor
// -----------------------------------------------------------------------------

Deno.test("executor forwards trusted metadata to the fixed MCP wrapper", async () => {
  const { factory, factoryCalls, rpcCalls } = createTrackingFactory(
    appliedData(),
  );
  const execute = createMcpV1AssignProjectPortfolioExecutor(
    SUPABASE_URL,
    ANON_KEY,
    factory,
  );
  const result = await execute(
    authorizedRequest(),
    PROJECT_ID,
    assignBody(),
    createContext(),
  );

  assertEquals(factoryCalls.length, 1);
  assertEquals(factoryCalls[0].url, SUPABASE_URL);
  assertEquals(factoryCalls[0].key, ANON_KEY);
  assertEquals(factoryCalls[0].options, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { headers: { Authorization: `Bearer ${TOKEN}` } },
  });

  assertEquals(rpcCalls.length, 1);
  assertEquals(rpcCalls[0].functionName, "mcp_v1_assign_project_portfolio");
  assertEquals(rpcCalls[0].args._expected_oauth_client_id, "btpm-connected-app");
  assertEquals(rpcCalls[0].args._project_id, PROJECT_ID);
  assertEquals(rpcCalls[0].args._portfolio_item_id, PORTFOLIO_ID);
  assertEquals(rpcCalls[0].args._request_id, "req-1");
  assertEquals(rpcCalls[0].args._correlation_id, "req-1");
  assertEquals(rpcCalls[0].args._idempotency_key, "idem-1");
  assertEquals(rpcCalls[0].args._payload_hash, PAYLOAD_HASH);
  assert(result.ok);
});

Deno.test("executor preserves the explicit null clear", async () => {
  const { factory, rpcCalls } = createTrackingFactory(
    appliedData({ newPortfolioId: null }),
  );
  const execute = createMcpV1AssignProjectPortfolioExecutor(
    SUPABASE_URL,
    ANON_KEY,
    factory,
  );
  const result = await execute(
    authorizedRequest(),
    PROJECT_ID,
    assignBody(null),
    createContext(),
  );
  assertEquals(rpcCalls[0].args._portfolio_item_id, null);
  assert("_portfolio_item_id" in rpcCalls[0].args);
  assert(result.ok);
  assertEquals(result.newPortfolioId, null);
});

Deno.test("executor constructs a fresh client per invocation", async () => {
  const { factory, factoryCalls, clients } = createTrackingFactory(
    appliedData(),
  );
  const execute = createMcpV1AssignProjectPortfolioExecutor(
    SUPABASE_URL,
    ANON_KEY,
    factory,
  );
  await execute(authorizedRequest(), PROJECT_ID, assignBody(), createContext());
  await execute(authorizedRequest(), PROJECT_ID, assignBody(), createContext());
  assertEquals(factoryCalls.length, 2);
  assert(clients[0] !== clients[1], "clients must never be reused");
});

Deno.test("malformed Project identity fails before any client construction", async () => {
  for (const badProjectId of [NIL_UUID, "not-a-uuid", "", `${PROJECT_ID}/`]) {
    const { factory, factoryCalls, rpcCalls } = createTrackingFactory(
      appliedData(),
    );
    const execute = createMcpV1AssignProjectPortfolioExecutor(
      SUPABASE_URL,
      ANON_KEY,
      factory,
    );
    await assertRejects(
      () =>
        execute(
          authorizedRequest(),
          badProjectId,
          assignBody(),
          createContext(),
        ),
      ApiHttpError,
    );
    assertEquals(factoryCalls.length, 0);
    assertEquals(rpcCalls.length, 0);
  }
});

Deno.test("malformed assignment body fails before any client construction", async () => {
  const badBodies: ReadonlyArray<unknown> = [
    {},
    { portfolioId: PORTFOLIO_ID, extra: 1 },
    { portfolio_id: PORTFOLIO_ID },
    { portfolioId: NIL_UUID },
    { portfolioId: "nope" },
    { portfolioId: undefined },
    null,
    [],
  ];
  for (const body of badBodies) {
    const { factory, factoryCalls, rpcCalls } = createTrackingFactory(
      appliedData(),
    );
    const execute = createMcpV1AssignProjectPortfolioExecutor(
      SUPABASE_URL,
      ANON_KEY,
      factory,
    );
    await assertRejects(
      () =>
        execute(
          authorizedRequest(),
          PROJECT_ID,
          // deno-lint-ignore no-explicit-any
          body as any,
          createContext(),
        ),
      ApiHttpError,
    );
    assertEquals(factoryCalls.length, 0);
    assertEquals(rpcCalls.length, 0);
  }
});

Deno.test("inconsistent trusted context fails before any client construction", async () => {
  const badContexts: ReadonlyArray<Record<string, unknown>> = [
    { sourceChannel: "external_api" },
    { sourceChannel: "MCP" },
    { delegationMode: "service_account" },
    { requestedUserId: "user-2" },
    { sourceClientId: "client-uuid-2" },
    { correlationId: "req-2" },
    { payloadHash: PAYLOAD_HASH.toUpperCase() },
    { payloadHash: "a".repeat(63) },
    { payloadHash: 123 },
    { oauthClientId: "  " },
    { policyVersionId: "" },
    { idempotencyKey: "" },
    { requestId: "" },
    { apiClientId: "" },
  ];
  for (const overrides of badContexts) {
    const { factory, factoryCalls, rpcCalls } = createTrackingFactory(
      appliedData(),
    );
    const execute = createMcpV1AssignProjectPortfolioExecutor(
      SUPABASE_URL,
      ANON_KEY,
      factory,
    );
    await assertRejects(
      () =>
        execute(
          authorizedRequest(),
          PROJECT_ID,
          assignBody(),
          createContext(overrides),
        ),
      ApiHttpError,
    );
    assertEquals(factoryCalls.length, 0);
    assertEquals(rpcCalls.length, 0);
  }
});

Deno.test("missing or malformed bearer fails before any client construction", async () => {
  for (
    const headers of [
      {} as Record<string, string>,
      { Authorization: "Basic abc" },
      { Authorization: "Bearer" },
      { Authorization: "Bearer " },
    ]
  ) {
    const { factory, factoryCalls, rpcCalls } = createTrackingFactory(
      appliedData(),
    );
    const execute = createMcpV1AssignProjectPortfolioExecutor(
      SUPABASE_URL,
      ANON_KEY,
      factory,
    );
    await assertRejects(
      () =>
        execute(
          new Request("https://edge.local/mcp", { method: "POST", headers }),
          PROJECT_ID,
          assignBody(),
          createContext(),
        ),
      ApiAuthenticationError,
    );
    assertEquals(factoryCalls.length, 0);
    assertEquals(rpcCalls.length, 0);
  }
});

Deno.test("executor factory validates its own bindings", () => {
  const { factory } = createTrackingFactory(appliedData());
  for (const url of ["", "   "]) {
    assertThrowsApiHttpError(() =>
      createMcpV1AssignProjectPortfolioExecutor(url, ANON_KEY, factory)
    );
  }
  assertThrowsApiHttpError(() =>
    createMcpV1AssignProjectPortfolioExecutor(SUPABASE_URL, "", factory)
  );
  assertThrowsApiHttpError(() =>
    // deno-lint-ignore no-explicit-any
    createMcpV1AssignProjectPortfolioExecutor(SUPABASE_URL, ANON_KEY, null as any)
  );
});

function assertThrowsApiHttpError(fn: () => unknown): void {
  let threw = false;
  try {
    fn();
  } catch (error) {
    threw = error instanceof ApiHttpError;
  }
  assert(threw, "expected a bounded ApiHttpError");
}

Deno.test("executor source has no service-role, retry or read-before-write behaviour", () => {
  for (
    const forbidden of [
      "SERVICE_ROLE",
      "service_role",
      "serviceRole",
      "privilegedClient",
      "authorizationStore",
      "rateLimitClient",
      "Deno.env",
      "setTimeout",
      "retry",
      ".from(",
      "confirmation",
      "hashCanonicalPayload",
      "api_v1_assign_project_portfolio",
    ]
  ) {
    assert(
      !EXECUTOR_CODE.includes(forbidden),
      `executor must not reference ${forbidden}`,
    );
  }
  assertEquals(
    (EXECUTOR_CODE.match(/assignMcpV1ProjectPortfolio\(/g) ?? []).length,
    1,
    "exactly one MCP adapter call site",
  );
  assert(
    EXECUTOR_CODE.includes("parseApiV1PortfolioAssignProjectPath("),
    "the canonical path parser must be reused",
  );
  assert(
    EXECUTOR_CODE.includes("parseApiV1AssignProjectPortfolioBody("),
    "the canonical body parser must be reused",
  );
  assert(
    EXECUTOR_CODE.includes("extractBearerToken(request)"),
    "the current caller token must be extracted from the request",
  );
});

// -----------------------------------------------------------------------------
// C. REST path preservation
// -----------------------------------------------------------------------------



Deno.test("the REST assignment path is unchanged", () => {
  assert(
    REST_EXECUTOR_SOURCE.includes("assignApiV1ProjectPortfolio"),
    "the REST delegated executor keeps the REST adapter",
  );
  assert(
    !REST_EXECUTOR_SOURCE.includes("assignMcpV1ProjectPortfolio"),
    "the REST delegated executor must not reach the MCP adapter",
  );
});
