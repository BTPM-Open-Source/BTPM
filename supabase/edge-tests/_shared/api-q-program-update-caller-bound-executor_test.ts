// API-Q Program Update Step 2 — focused test for the caller-bound MCP Program
// Update writer adapter.
//
// Proves the closed wrapper selection in `supabaseProgramMutation.ts`, the
// shared validation/result mapping between the REST and MCP Program Update
// adapters, Program Create non-drift, and the fail-closed caller-bound
// executor behaviour.
//
// No database access, no network access, no Edge invocation.

import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  type ApiV1UpdateProgramInput,
  createApiV1Program,
  createMcpV1Program,
  updateApiV1Program,
  updateMcpV1Program,
} from "../../functions/_shared/btpm-api/supabaseProgramMutation.ts";
import { createMcpV1UpdateProgramExecutor } from "../../functions/btpm-mcp/mcp/programUpdateMutationExecutor.ts";
import { ApiHttpError } from "../../functions/_shared/btpm-api/http.ts";
import { ApiAuthenticationError } from "../../functions/_shared/btpm-api/apiErrors.ts";

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

const PROGRAM_ID = "22222222-2222-4222-8222-222222222222";
const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const PAYLOAD_HASH = "b".repeat(64);
const UPDATED_AT = "2026-08-17T05:00:00.000Z";
const NEXT_UPDATED_AT = "2026-08-17T06:00:00.000Z";
const TOKEN = "caller.bearer.token";

const SUPABASE_URL = "https://project.supabase.co";
const ANON_KEY = "anon-publishable-key";

const RPC_ARG_KEYS: ReadonlyArray<string> = [
  "_expected_oauth_client_id",
  "_program_id",
  "_expected_updated_at",
  "_name",
  "_status",
  "_description",
  "_set_description",
  "_request_id",
  "_correlation_id",
  "_idempotency_key",
  "_payload_hash",
];

function updateInput(
  overrides: Partial<ApiV1UpdateProgramInput> = {},
): ApiV1UpdateProgramInput {
  return {
    expectedOauthClientId: "btpm-connected-app",
    programId: PROGRAM_ID,
    expectedUpdatedAt: UPDATED_AT,
    name: "Finance Transformation",
    status: "active",
    description: "Multi-year finance program",
    setDescription: true,
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
    programId: PROGRAM_ID,
    updatedAt: NEXT_UPDATED_AT,
  };
}

function conflictData() {
  return { ok: false, outcome: "conflict", code: "stale_program" };
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
    name: "Finance Transformation",
    status: "active",
    description: "Multi-year finance program",
    setDescription: true,
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
    "../../functions/_shared/btpm-api/supabaseProgramMutation.ts",
    import.meta.url,
  ),
);
const EXECUTOR_SOURCE = await Deno.readTextFile(
  new URL(
    "../../functions/btpm-mcp/mcp/programUpdateMutationExecutor.ts",
    import.meta.url,
  ),
);
const REGISTRY_SOURCE = await Deno.readTextFile(
  new URL("../../functions/btpm-mcp/mcp/toolRegistry.ts", import.meta.url),
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
const ADAPTER_CODE = stripTsComments(ADAPTER_SOURCE);

const UPDATE_MARKER = "// API-N.9B — `public.api_v1_update_program`";
const CREATE_BLOCK = ADAPTER_SOURCE.slice(
  0,
  ADAPTER_SOURCE.indexOf(UPDATE_MARKER),
);
const UPDATE_BLOCK = ADAPTER_SOURCE.slice(
  ADAPTER_SOURCE.indexOf(UPDATE_MARKER),
);

// -----------------------------------------------------------------------------
// A. Program Update base adapter — closed wrapper selection
// -----------------------------------------------------------------------------

Deno.test("REST Program Update invokes only api_v1_update_program", async () => {
  const { calls, client } = createRecordingClient(appliedData());
  const result = await updateApiV1Program(client, updateInput());
  assertEquals(calls.length, 1);
  assertEquals(calls[0].functionName, "api_v1_update_program");
  assert(result.ok);
  assertEquals(result.outcome, "applied");
  assertEquals(result.updatedAt, NEXT_UPDATED_AT);
});

Deno.test("MCP Program Update invokes only mcp_v1_update_program", async () => {
  const { calls, client } = createRecordingClient(appliedData());
  const result = await updateMcpV1Program(client, updateInput());
  assertEquals(calls.length, 1);
  assertEquals(calls[0].functionName, "mcp_v1_update_program");
  assert(result.ok);
  assertEquals(result.outcome, "applied");
});

Deno.test("Program Update wrapper constants are exact and closed", () => {
  assert(
    ADAPTER_SOURCE.includes(
      'const API_V1_UPDATE_PROGRAM_FUNCTION_NAME = "api_v1_update_program";',
    ),
    "the fixed REST wrapper constant must exist",
  );
  assert(
    ADAPTER_SOURCE.includes(
      'const MCP_V1_UPDATE_PROGRAM_FUNCTION_NAME = "mcp_v1_update_program";',
    ),
    "the fixed MCP wrapper constant must exist",
  );
  assert(
    /type UpdateProgramFunctionName =\s*\|\s*typeof API_V1_UPDATE_PROGRAM_FUNCTION_NAME\s*\|\s*typeof MCP_V1_UPDATE_PROGRAM_FUNCTION_NAME;/
      .test(ADAPTER_SOURCE),
    "the wrapper name type must be a closed two-member union",
  );
});

Deno.test("one shared closed Program Update invocation path exists", () => {
  assert(
    /async function invokeUpdateProgram\(\s*functionName: UpdateProgramFunctionName,/
      .test(UPDATE_BLOCK),
    "the shared invocation must take the closed function-name type",
  );
  assertEquals(
    (UPDATE_BLOCK.match(/client\.rpc\(/g) ?? []).length,
    1,
    "exactly one RPC call site may exist in the Program Update block",
  );
  assert(
    UPDATE_BLOCK.includes("result = await client.rpc(functionName, args);"),
    "the single RPC call site uses the closed wrapper name",
  );
  assertEquals(
    (UPDATE_BLOCK.match(/invokeUpdateProgram\(/g) ?? []).length,
    3,
    "one definition plus exactly two thin delegates",
  );
  assert(
    /export function updateApiV1Program\(/.test(UPDATE_BLOCK),
    "the REST adapter remains exported with its original name",
  );
  assert(
    /export function updateMcpV1Program\(/.test(UPDATE_BLOCK),
    "the MCP adapter is exported",
  );
  assert(
    !/functionName: string/.test(UPDATE_BLOCK.split("invokeUpdateProgram")[1]),
    "no generic external function-name parameter may be introduced",
  );
});

Deno.test("REST and MCP Program Update share the exact 11-argument mapping", async () => {
  const rest = createRecordingClient(appliedData());
  const mcp = createRecordingClient(appliedData());
  await updateApiV1Program(rest.client, updateInput());
  await updateMcpV1Program(mcp.client, updateInput());

  assertEquals(Object.keys(rest.calls[0].args).sort(), [...RPC_ARG_KEYS].sort());
  assertEquals(rest.calls[0].args, mcp.calls[0].args);
  assertEquals(rest.calls[0].args._program_id, PROGRAM_ID);
  assertEquals(rest.calls[0].args._expected_updated_at, UPDATED_AT);
  assertEquals(rest.calls[0].args._set_description, true);
  assertEquals(rest.calls[0].args._payload_hash, PAYLOAD_HASH);
});

Deno.test("Program Update result parity is preserved across both adapters", async () => {
  for (const invoke of [updateApiV1Program, updateMcpV1Program]) {
    const conflict = await invoke(
      createRecordingClient(conflictData()).client,
      updateInput(),
    );
    assertEquals(conflict, {
      ok: false,
      outcome: "conflict",
      code: "stale_program",
    });

    const noChange = await invoke(
      createRecordingClient({
        ok: true,
        outcome: "no_change",
        programId: PROGRAM_ID,
        updatedAt: UPDATED_AT,
      }).client,
      updateInput(),
    );
    assert(noChange.ok);
    assertEquals(noChange.outcome, "no_change");

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

Deno.test("Program Update validation and malformed envelopes fail closed on both adapters", async () => {
  for (const invoke of [updateApiV1Program, updateMcpV1Program]) {
    await assertRejects(
      () =>
        invoke(
          createRecordingClient(appliedData()).client,
          updateInput({ programId: NIL_UUID }),
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
          updateInput({ status: "unknown_status" }),
        ),
      ApiHttpError,
    );
    await assertRejects(
      () =>
        invoke(
          createRecordingClient(appliedData()).client,
          updateInput({ payloadHash: "A".repeat(64) }),
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
    // Malformed envelopes.
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
    await assertRejects(
      () =>
        invoke(
          createRecordingClient({
            ok: true,
            outcome: "applied",
            programId: PROGRAM_ID,
            updatedAt: NEXT_UPDATED_AT,
            currentUpdatedAt: NEXT_UPDATED_AT,
          }).client,
          updateInput(),
        ),
      ApiHttpError,
    );
    await assertRejects(
      () =>
        invoke(
          createRecordingClient(null, { code: "42501" }).client,
          updateInput(),
        ),
      ApiHttpError,
    );
  }
});

// -----------------------------------------------------------------------------
// B. Program Create non-drift
// -----------------------------------------------------------------------------

Deno.test("Program Create adapters remain intact after the Update refactor", async () => {
  const rest = createRecordingClient({
    ok: true,
    outcome: "applied",
    programId: PROGRAM_ID,
  });
  const mcp = createRecordingClient({
    ok: true,
    outcome: "applied",
    programId: PROGRAM_ID,
  });
  const input = {
    expectedOauthClientId: "btpm-connected-app",
    workspaceId: WORKSPACE_ID,
    name: "Finance Transformation",
    description: "Multi-year finance program",
    requestId: "req-1",
    correlationId: "req-1",
    idempotencyKey: "idem-1",
    payloadHash: PAYLOAD_HASH,
  };
  await createApiV1Program(rest.client, input);
  await createMcpV1Program(mcp.client, input);
  assertEquals(rest.calls[0].functionName, "api_v1_create_program");
  assertEquals(mcp.calls[0].functionName, "mcp_v1_create_program");
  assertEquals(rest.calls[0].args, mcp.calls[0].args);
});

Deno.test("Program Create wrapper names and shared path are unchanged", () => {
  assert(
    CREATE_BLOCK.includes(
      'const API_V1_CREATE_PROGRAM_FUNCTION_NAME = "api_v1_create_program";',
    ),
  );
  assert(
    CREATE_BLOCK.includes(
      'const MCP_V1_CREATE_PROGRAM_FUNCTION_NAME = "mcp_v1_create_program";',
    ),
  );
  assert(
    /async function invokeCreateProgram\(\s*functionName: CreateProgramFunctionName,/
      .test(CREATE_BLOCK),
  );
  assertEquals((CREATE_BLOCK.match(/client\.rpc\(/g) ?? []).length, 1);
  assert(!CREATE_BLOCK.includes("UPDATE_PROGRAM_FUNCTION_NAME"));
});

// -----------------------------------------------------------------------------
// C. Caller-bound executor shape and forwarding
// -----------------------------------------------------------------------------

Deno.test("executor factory exports the exact caller-bound contract", () => {
  assertEquals(typeof createMcpV1UpdateProgramExecutor, "function");
  for (
    const exported of [
      "export interface McpUpdateProgramClientOptions",
      "export type McpUpdateProgramClientFactory",
      "export type McpV1UpdateProgramExecutor",
      "export function createMcpV1UpdateProgramExecutor(",
    ]
  ) {
    assert(EXECUTOR_SOURCE.includes(exported), `missing ${exported}`);
  }
  assert(
    /export type McpV1UpdateProgramExecutor = \(\s*request: Request,\s*programId: string,\s*body: ApiV1UpdateProgramBody,\s*executionContext: McpMutationExecutionContext,\s*\) => Promise<ApiV1UpdateProgramResult>;/
      .test(EXECUTOR_SOURCE),
    "the executor signature must be exactly the caller-bound MCP shape",
  );
  for (
    const forbiddenArg of [
      "AuthenticatedApiContext",
      "organizationId",
      "workspaceId",
      "tenantId",
      "actorUserId",
      "bearerToken",
    ]
  ) {
    assert(
      !EXECUTOR_CODE.includes(forbiddenArg),
      `no ${forbiddenArg} argument may exist`,
    );
  }
});

Deno.test("executor canonicalizes the Program id through the canonical parser", async () => {
  const { factory, rpcCalls } = createTrackingFactory(appliedData());
  const execute = createMcpV1UpdateProgramExecutor(
    SUPABASE_URL,
    ANON_KEY,
    factory,
  );
  await execute(
    authorizedRequest(),
    PROGRAM_ID,
    updateBody(),
    createContext(),
  );
  assertEquals(rpcCalls[0].args._program_id, PROGRAM_ID);

  assert(
    EXECUTOR_SOURCE.includes("parseApiV1ProgramUpdatePath"),
    "the canonical path parser must be reused",
  );
  assert(
    EXECUTOR_SOURCE.includes('const PROGRAM_PATH_PREFIX = "/v1/programs/";'),
    "the canonical prefix must be fixed",
  );

  for (const bad of [NIL_UUID, "not-a-uuid", "", `${PROGRAM_ID}/phases`]) {
    await assertRejects(
      () =>
        execute(authorizedRequest(), bad, updateBody(), createContext()),
      ApiHttpError,
    );
  }
});

Deno.test("executor does not reparse the canonical body and forwards it unchanged", async () => {
  assert(
    !EXECUTOR_SOURCE.includes("parseApiV1UpdateProgramBody"),
    "the raw HTTP body parser must not be reused here",
  );

  const { factory, rpcCalls } = createTrackingFactory(appliedData());
  const execute = createMcpV1UpdateProgramExecutor(
    SUPABASE_URL,
    ANON_KEY,
    factory,
  );
  await execute(
    authorizedRequest(),
    PROGRAM_ID,
    updateBody({
      name: "Renamed Program",
      status: "on_hold",
      description: "New narrative",
      setDescription: true,
    }),
    createContext(),
  );
  const args = rpcCalls[0].args;
  assertEquals(args._expected_updated_at, UPDATED_AT);
  assertEquals(args._name, "Renamed Program");
  assertEquals(args._status, "on_hold");
  assertEquals(args._description, "New narrative");
  assertEquals(args._set_description, true);

  // Description clearing presence semantics are forwarded, not reconstructed.
  const cleared = createTrackingFactory(appliedData());
  const executeCleared = createMcpV1UpdateProgramExecutor(
    SUPABASE_URL,
    ANON_KEY,
    cleared.factory,
  );
  await executeCleared(
    authorizedRequest(),
    PROGRAM_ID,
    updateBody({ description: null, setDescription: true }),
    createContext(),
  );
  assertEquals(cleared.rpcCalls[0].args._description, null);
  assertEquals(cleared.rpcCalls[0].args._set_description, true);

  const absent = createTrackingFactory(appliedData());
  const executeAbsent = createMcpV1UpdateProgramExecutor(
    SUPABASE_URL,
    ANON_KEY,
    absent.factory,
  );
  await executeAbsent(
    authorizedRequest(),
    PROGRAM_ID,
    updateBody({ description: null, setDescription: false }),
    createContext(),
  );
  assertEquals(absent.rpcCalls[0].args._set_description, false);

  await assertRejects(
    () =>
      execute(
        authorizedRequest(),
        PROGRAM_ID,
        // deno-lint-ignore no-explicit-any
        "not-an-object" as any,
        createContext(),
      ),
    ApiHttpError,
  );
});

Deno.test("caller expectedUpdatedAt is forwarded unchanged and never refreshed", async () => {
  const { factory, rpcCalls } = createTrackingFactory(conflictData());
  const execute = createMcpV1UpdateProgramExecutor(
    SUPABASE_URL,
    ANON_KEY,
    factory,
  );
  const stale = "2020-01-01T00:00:00.000Z";
  const result = await execute(
    authorizedRequest(),
    PROGRAM_ID,
    updateBody({ expectedUpdatedAt: stale }),
    createContext(),
  );
  assertEquals(rpcCalls.length, 1);
  assertEquals(rpcCalls[0].args._expected_updated_at, stale);
  assertEquals(result, {
    ok: false,
    outcome: "conflict",
    code: "stale_program",
  });
  assert(
    EXECUTOR_SOURCE.includes("expectedUpdatedAt: body.expectedUpdatedAt,"),
    "the caller token must be passed through verbatim",
  );
});

// -----------------------------------------------------------------------------
// D. Trusted MCP execution context
// -----------------------------------------------------------------------------

Deno.test("valid MCP delegated-user context succeeds", async () => {
  const { factory, rpcCalls } = createTrackingFactory(appliedData());
  const execute = createMcpV1UpdateProgramExecutor(
    SUPABASE_URL,
    ANON_KEY,
    factory,
  );
  const result = await execute(
    authorizedRequest(),
    PROGRAM_ID,
    updateBody(),
    createContext(),
  );
  assert(result.ok);
  assertEquals(rpcCalls[0].functionName, "mcp_v1_update_program");
  assertEquals(rpcCalls[0].args._expected_oauth_client_id, "btpm-connected-app");
});

Deno.test("inconsistent or incomplete trusted context fails before client and RPC", async () => {
  const invalidContexts: ReadonlyArray<Record<string, unknown>> = [
    { sourceChannel: "external_api" },
    { sourceChannel: "btpm_ui" },
    { delegationMode: "service_account" },
    { executingUserId: "user-2" },
    { sourceClientId: "other-client" },
    { correlationId: "corr-2" },
    { requestedUserId: "  " },
    { executingUserId: "" },
    { apiClientId: "" },
    { oauthClientId: " " },
    { policyVersionId: "" },
    { requestId: "" },
    { idempotencyKey: "" },
    { payloadHash: "B".repeat(64) },
    { payloadHash: "abc" },
    { payloadHash: null },
  ];

  for (const overrides of invalidContexts) {
    const { factory, factoryCalls, rpcCalls } = createTrackingFactory(
      appliedData(),
    );
    const execute = createMcpV1UpdateProgramExecutor(
      SUPABASE_URL,
      ANON_KEY,
      factory,
    );
    await assertRejects(
      () =>
        execute(
          authorizedRequest(),
          PROGRAM_ID,
          updateBody(),
          createContext(overrides),
        ),
      ApiHttpError,
      undefined,
      `context override ${JSON.stringify(overrides)} must fail closed`,
    );
    assertEquals(factoryCalls.length, 0, "no client may be constructed");
    assertEquals(rpcCalls.length, 0, "no RPC may execute");
  }

  assert(
    EXECUTOR_SOURCE.includes('const REQUIRED_SOURCE_CHANNEL = "mcp" as const;'),
    "the MCP source channel is fixed",
  );
  assert(
    EXECUTOR_SOURCE.includes(
      'const REQUIRED_DELEGATION_MODE = "delegated_user" as const;',
    ),
    "the delegation mode is fixed",
  );
  assert(
    !EXECUTOR_CODE.includes("external_api"),
    "external_api must never be accepted as a fallback",
  );
});

// -----------------------------------------------------------------------------
// E. Caller bearer and fresh anon-key client
// -----------------------------------------------------------------------------

Deno.test("missing or malformed bearer fails before client construction", async () => {
  for (
    const headers of [
      {},
      { Authorization: "Bearer" },
      { Authorization: "Basic abc" },
      { Authorization: "Bearer " },
    ] as ReadonlyArray<Record<string, string>>
  ) {
    const { factory, factoryCalls, rpcCalls } = createTrackingFactory(
      appliedData(),
    );
    const execute = createMcpV1UpdateProgramExecutor(
      SUPABASE_URL,
      ANON_KEY,
      factory,
    );
    await assertRejects(
      () =>
        execute(
          new Request("https://edge.local/mcp", { method: "POST", headers }),
          PROGRAM_ID,
          updateBody(),
          createContext(),
        ),
      ApiAuthenticationError,
    );
    assertEquals(factoryCalls.length, 0);
    assertEquals(rpcCalls.length, 0);
  }
});

Deno.test("a fresh anon-key client bound to the current bearer is built per invocation", async () => {
  const { factory, factoryCalls, rpcCalls } = createTrackingFactory(
    appliedData(),
  );
  const execute = createMcpV1UpdateProgramExecutor(
    SUPABASE_URL,
    ANON_KEY,
    factory,
  );
  await execute(authorizedRequest(), PROGRAM_ID, updateBody(), createContext());
  await execute(
    new Request("https://edge.local/mcp", {
      method: "POST",
      headers: { Authorization: "Bearer second.caller.token" },
    }),
    PROGRAM_ID,
    updateBody(),
    createContext(),
  );

  assertEquals(factoryCalls.length, 2, "one fresh client per invocation");
  assertEquals(rpcCalls.length, 2);
  for (const call of factoryCalls) {
    assertEquals(call.url, SUPABASE_URL);
    assertEquals(call.key, ANON_KEY);
    assertEquals(call.options, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: { headers: { Authorization: call.options.global !== undefined
        ? (call.options.global as { headers: { Authorization: string } })
          .headers.Authorization
        : "" } },
    });
  }
  assertEquals(
    (factoryCalls[0].options.global as { headers: { Authorization: string } })
      .headers.Authorization,
    `Bearer ${TOKEN}`,
  );
  assertEquals(
    (factoryCalls[1].options.global as { headers: { Authorization: string } })
      .headers.Authorization,
    "Bearer second.caller.token",
  );
});

Deno.test("factory inputs are validated at construction", () => {
  const { factory } = createTrackingFactory(appliedData());
  let threw = 0;
  for (
    const attempt of [
      () => createMcpV1UpdateProgramExecutor("", ANON_KEY, factory),
      () => createMcpV1UpdateProgramExecutor(SUPABASE_URL, "", factory),
      () =>
        createMcpV1UpdateProgramExecutor(
          SUPABASE_URL,
          ANON_KEY,
          // deno-lint-ignore no-explicit-any
          undefined as any,
        ),
    ]
  ) {
    try {
      attempt();
    } catch (error) {
      assert(error instanceof ApiHttpError);
      threw += 1;
    }
  }
  assertEquals(threw, 3);
});

Deno.test("a non-RPC client fails closed", async () => {
  const execute = createMcpV1UpdateProgramExecutor(
    SUPABASE_URL,
    ANON_KEY,
    () => ({}),
  );
  await assertRejects(
    () =>
      execute(authorizedRequest(), PROGRAM_ID, updateBody(), createContext()),
    ApiHttpError,
  );
});

// -----------------------------------------------------------------------------
// F. Writer behaviour
// -----------------------------------------------------------------------------

Deno.test("exactly one MCP writer path exists with no retry or REST fallback", async () => {
  assertEquals(
    (EXECUTOR_CODE.match(/updateMcpV1Program\(/g) ?? []).length,
    1,
    "exactly one canonical MCP adapter call site may exist",
  );
  assert(
    !EXECUTOR_CODE.includes("updateApiV1Program"),
    "the MCP writer must never reach the REST adapter",
  );
  assert(
    !EXECUTOR_CODE.includes("mcp_v1_update_program"),
    "the wrapper name stays owned by the closed adapter",
  );
  assert(!/\bretry\b/i.test(EXECUTOR_CODE), "no retry logic may exist");

  const { factory, rpcCalls } = createTrackingFactory(conflictData());
  const execute = createMcpV1UpdateProgramExecutor(
    SUPABASE_URL,
    ANON_KEY,
    factory,
  );
  const result = await execute(
    authorizedRequest(),
    PROGRAM_ID,
    updateBody(),
    createContext(),
  );
  assertEquals(rpcCalls.length, 1, "stale_program must not trigger a second RPC");
  assertEquals(result, {
    ok: false,
    outcome: "conflict",
    code: "stale_program",
  });
  assert(!("updatedAt" in result), "conflicts expose no timestamp");
  assert(
    !EXECUTOR_CODE.includes("currentUpdatedAt") &&
      !EXECUTOR_CODE.includes("current_updated_at") &&
      !ADAPTER_CODE.includes("current_updated_at"),
    "no current-timestamp surface may exist",
  );
});

Deno.test("updatedAt is returned only for accepted success outcomes", async () => {
  for (const outcome of ["applied", "no_change", "replayed"]) {
    const { factory } = createTrackingFactory({
      ok: true,
      outcome,
      programId: PROGRAM_ID,
      updatedAt: NEXT_UPDATED_AT,
    });
    const execute = createMcpV1UpdateProgramExecutor(
      SUPABASE_URL,
      ANON_KEY,
      factory,
    );
    const result = await execute(
      authorizedRequest(),
      PROGRAM_ID,
      updateBody(),
      createContext(),
    );
    assert(result.ok);
    assertEquals(result.outcome, outcome);
    assertEquals(result.updatedAt, NEXT_UPDATED_AT);
  }

  for (
    const outcome of [
      "invalid",
      "not_authorized",
      "idempotency_conflict",
      "idempotency_pending",
    ] as const
  ) {
    const { factory } = createTrackingFactory({ ok: false, outcome });
    const execute = createMcpV1UpdateProgramExecutor(
      SUPABASE_URL,
      ANON_KEY,
      factory,
    );
    const result = await execute(
      authorizedRequest(),
      PROGRAM_ID,
      updateBody(),
      createContext(),
    );
    assertEquals(result, { ok: false, outcome });
  }
});

// -----------------------------------------------------------------------------
// G. Forbidden production surfaces
// -----------------------------------------------------------------------------

Deno.test("the caller-bound Program Update writer contains no forbidden surface", () => {
  for (
    const forbidden of [
      "SUPABASE_SERVICE_ROLE_KEY",
      "serviceRole",
      "service_role",
      "privilegedClient",
      "Deno.env",
      ".from(",
      "public.programs",
      "public.workspaces",
      "public.organizations",
      "apply_program_update",
      "has_pm_authority",
      "get_user_org_id",
      "api_project_client_enablements",
      "authorize_and_establish",
      "authorize_and_establish_mcp",
      "claim_idempotency",
      "pmg_record_command_audit",
      "btpm_encrypt",
      "btpm_decrypt",
      "createHash",
      "sha256",
      "confirmation",
      "toolRegistry",
      "serverFactory",
      "registerTool",
      "console.",
      "setTimeout",
      "setInterval",
      "cache",
    ]
  ) {
    assert(
      !EXECUTOR_CODE.includes(forbidden),
      `the writer must not contain ${forbidden}`,
    );
  }
  assert(!/\bfetch\(/.test(EXECUTOR_CODE), "no direct fetch may exist");
  assert(!/\blet\s+\w+\s*=/.test(
    EXECUTOR_CODE.slice(0, EXECUTOR_CODE.indexOf("export function")),
  ), "no mutable module-level state may exist");
  assert(!/\bSELECT\b/i.test(EXECUTOR_CODE), "no SQL may exist");
});

// -----------------------------------------------------------------------------
// H. Exposure state
// -----------------------------------------------------------------------------

// Step 4 intentionally superseded the temporary `not_exposed` assertion here.
Deno.test("programs.update keeps its canonical registry contract", () => {
  const index = REGISTRY_SOURCE.indexOf('operationId: "programs.update"');
  assert(index > -1, "the programs.update registry entry must exist");
  const entry = REGISTRY_SOURCE.slice(index, index + 600);
  assert(entry.includes('toolName: "btpm_update_program"'));
  assert(entry.includes('operationClass: "mutation"'));
  assert(entry.includes('confirmation: "required"'));
  assert(entry.includes('concurrencyToken: "required"'));

  const createIndex = REGISTRY_SOURCE.indexOf('operationId: "programs.create"');
  assert(createIndex > -1);
  const createEntry = REGISTRY_SOURCE.slice(createIndex, createIndex + 600);
  assert(createEntry.includes('toolName: "btpm_create_program"'));
  assert(createEntry.includes('exposure: "exposed"'));
});
