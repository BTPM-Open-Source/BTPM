// API-Q Program Create Step 2 — focused test for the caller-bound MCP Program
// Create writer adapter.
//
// Proves the closed wrapper selection in `supabaseProgramMutation.ts`, the
// shared validation/result mapping between the REST and MCP Program Create
// adapters, and the fail-closed caller-bound executor behaviour.
//
// No database access, no network access, no Edge invocation.

import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  type ApiV1CreateProgramInput,
  createApiV1Program,
  createMcpV1Program,
} from "../../functions/_shared/btpm-api/supabaseProgramMutation.ts";
import { createMcpV1CreateProgramExecutor } from "../../functions/btpm-mcp/mcp/programCreateMutationExecutor.ts";
import { ApiHttpError } from "../../functions/_shared/btpm-api/http.ts";
import { ApiAuthenticationError } from "../../functions/_shared/btpm-api/apiErrors.ts";

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const PROGRAM_ID = "22222222-2222-4222-8222-222222222222";
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const PAYLOAD_HASH = "a".repeat(64);
const TOKEN = "caller.bearer.token";

const SUPABASE_URL = "https://project.supabase.co";
const ANON_KEY = "anon-publishable-key";

function createInput(
  overrides: Partial<ApiV1CreateProgramInput> = {},
): ApiV1CreateProgramInput {
  return {
    expectedOauthClientId: "btpm-connected-app",
    workspaceId: WORKSPACE_ID,
    name: "Finance Transformation",
    description: "Multi-year finance program",
    requestId: "req-1",
    correlationId: "req-1",
    idempotencyKey: "idem-1",
    payloadHash: PAYLOAD_HASH,
    ...overrides,
  };
}

function appliedData() {
  return { ok: true, outcome: "applied", programId: PROGRAM_ID };
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

function createBody(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId: WORKSPACE_ID,
    name: "Finance Transformation",
    description: "Multi-year finance program",
    ...overrides,
  };
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
  };
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
    factoryCalls.push({ url, key, options: options as Record<string, unknown> });
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
    "../../functions/btpm-mcp/mcp/programCreateMutationExecutor.ts",
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

/** The Program Create block ends where the API-N.9B update adapter begins. */
const UPDATE_MARKER = "// API-N.9B — `public.api_v1_update_program`";
const CREATE_BLOCK = ADAPTER_SOURCE.slice(
  0,
  ADAPTER_SOURCE.indexOf(UPDATE_MARKER),
);
const UPDATE_BLOCK = ADAPTER_SOURCE.slice(ADAPTER_SOURCE.indexOf(UPDATE_MARKER));

// -----------------------------------------------------------------------------
// A. Shared REST/MCP adapter — closed wrapper selection
// -----------------------------------------------------------------------------

Deno.test("REST Program Create invokes only api_v1_create_program", async () => {
  const { calls, client } = createRecordingClient(appliedData());
  const result = await createApiV1Program(client, createInput());
  assertEquals(calls.length, 1);
  assertEquals(calls[0].functionName, "api_v1_create_program");
  assert(result.ok);
  assertEquals(result.outcome, "applied");
});

Deno.test("MCP Program Create invokes only mcp_v1_create_program", async () => {
  const { calls, client } = createRecordingClient(appliedData());
  const result = await createMcpV1Program(client, createInput());
  assertEquals(calls.length, 1);
  assertEquals(calls[0].functionName, "mcp_v1_create_program");
  assert(result.ok);
  assertEquals(result.outcome, "applied");
});

Deno.test("Program Create wrapper selection is closed and not caller-provided", () => {
  assert(
    ADAPTER_SOURCE.includes(
      'const API_V1_CREATE_PROGRAM_FUNCTION_NAME = "api_v1_create_program";',
    ),
    "the fixed REST wrapper constant must exist",
  );
  assert(
    ADAPTER_SOURCE.includes(
      'const MCP_V1_CREATE_PROGRAM_FUNCTION_NAME = "mcp_v1_create_program";',
    ),
    "the fixed MCP wrapper constant must exist",
  );
  assert(
    /type CreateProgramFunctionName =\s*\|\s*typeof API_V1_CREATE_PROGRAM_FUNCTION_NAME\s*\|\s*typeof MCP_V1_CREATE_PROGRAM_FUNCTION_NAME;/
      .test(ADAPTER_SOURCE),
    "the closed create-wrapper type must contain exactly the two wrappers",
  );
  assert(
    /^async function invokeCreateProgram\(/m.test(ADAPTER_SOURCE),
    "invokeCreateProgram must exist and must not be exported",
  );
  assert(
    !ADAPTER_SOURCE.includes("export async function invokeCreateProgram"),
    "invokeCreateProgram must never be exported",
  );
  assert(
    /functionName: CreateProgramFunctionName,/.test(ADAPTER_SOURCE),
    "the shared invoker must constrain the wrapper name by the closed type",
  );
  for (const fn of ["createApiV1Program", "createMcpV1Program"]) {
    const match = new RegExp(
      `export function ${fn}\\(([\\s\\S]*?)\\): Promise<ApiV1CreateProgramResult>`,
    ).exec(ADAPTER_SOURCE);
    assert(match !== null, `${fn} must be exported`);
    const params = match?.[1] ?? "";
    assert(
      !params.includes("functionName"),
      `${fn} must not accept functionName`,
    );
    assert(!/wrapperName/i.test(params), `${fn} must not accept a wrapper name`);
  }
  assertEquals(
    (CREATE_BLOCK.match(/client\.rpc\(/g) ?? []).length,
    1,
    "the Program Create family must contain exactly one client.rpc call",
  );
  assert(
    CREATE_BLOCK.includes("await client.rpc(functionName, {"),
    "the single Program Create RPC must use the closed functionName",
  );
  assert(
    CREATE_BLOCK.includes("API_V1_CREATE_PROGRAM_FUNCTION_NAME,\n    client,") &&
      CREATE_BLOCK.includes("MCP_V1_CREATE_PROGRAM_FUNCTION_NAME,\n    client,"),
    "each exported adapter binds exactly one fixed wrapper",
  );
  assert(
    !/export\s+(async\s+)?function\s+\w+\([^)]*functionName/.test(
      ADAPTER_SOURCE,
    ),
    "no generic Program RPC dispatcher may be exported",
  );
  assert(!ADAPTER_SOURCE.includes("execute_sql"), "no raw SQL execution");
});

// -----------------------------------------------------------------------------
// B. Exact eight-argument RPC contract, C. REST preservation
// -----------------------------------------------------------------------------

Deno.test("REST and MCP Program Create build identical exact RPC arguments", async () => {
  const rest = createRecordingClient(appliedData());
  const mcp = createRecordingClient(appliedData());
  await createApiV1Program(rest.client, createInput());
  await createMcpV1Program(mcp.client, createInput());
  const expected = {
    _expected_oauth_client_id: "btpm-connected-app",
    _workspace_id: WORKSPACE_ID,
    _name: "Finance Transformation",
    _description: "Multi-year finance program",
    _request_id: "req-1",
    _correlation_id: "req-1",
    _idempotency_key: "idem-1",
    _payload_hash: PAYLOAD_HASH,
  };
  assertEquals(rest.calls[0].args, expected);
  assertEquals(mcp.calls[0].args, rest.calls[0].args);
  assertEquals(Object.keys(rest.calls[0].args).length, 8);
  for (
    const forbidden of [
      "_execution_source",
      "_tenant_id",
      "_organization_id",
      "_user_id",
      "_actor",
      "_source_channel",
      "_program_id",
      "_status",
    ]
  ) {
    assert(
      !(forbidden in rest.calls[0].args) && !(forbidden in mcp.calls[0].args),
      `${forbidden} must not be sent`,
    );
  }
});

Deno.test("REST and MCP Program Create apply identical input validation", async () => {
  const invalidInputs: Partial<ApiV1CreateProgramInput>[] = [
    { name: "" },
    { name: "x".repeat(201) },
    { name: 42 as unknown as string },
    { workspaceId: "not-a-uuid" },
    { workspaceId: NIL_UUID },
    { description: "" },
    { description: 7 as unknown as string },
    { expectedOauthClientId: "" },
    { requestId: "bad id with spaces" },
    { correlationId: "" },
    { idempotencyKey: "" },
    { payloadHash: "A".repeat(64) },
    { payloadHash: "a".repeat(63) },
  ];

  for (const override of invalidInputs) {
    const rest = createRecordingClient(appliedData());
    const mcp = createRecordingClient(appliedData());
    const label = JSON.stringify(override);
    await assertRejects(
      () => createApiV1Program(rest.client, createInput(override)),
      ApiHttpError,
      undefined,
      `REST must reject ${label}`,
    );
    await assertRejects(
      () => createMcpV1Program(mcp.client, createInput(override)),
      ApiHttpError,
      undefined,
      `MCP must reject ${label}`,
    );
    assertEquals(rest.calls.length, 0, `REST must not call RPC for ${label}`);
    assertEquals(mcp.calls.length, 0, `MCP must not call RPC for ${label}`);
  }
});

Deno.test("REST and MCP Program Create accept identical null description", async () => {
  const rest = createRecordingClient(appliedData());
  const mcp = createRecordingClient(appliedData());
  const input = createInput({ description: null });
  await createApiV1Program(rest.client, input);
  await createMcpV1Program(mcp.client, input);
  assertEquals(rest.calls[0].args._description, null);
  assertEquals(mcp.calls[0].args, rest.calls[0].args);
});

// -----------------------------------------------------------------------------
// D. REST/MCP result parity
// -----------------------------------------------------------------------------

Deno.test("REST and MCP Program Create map results identically", async () => {
  for (
    const data of [
      { ok: true, outcome: "applied", programId: PROGRAM_ID },
      { ok: true, outcome: "replayed", programId: PROGRAM_ID },
    ]
  ) {
    const rest = createRecordingClient(data);
    const mcp = createRecordingClient(data);
    const a = await createApiV1Program(rest.client, createInput());
    const b = await createMcpV1Program(mcp.client, createInput());
    assertEquals(b, a);
    assertEquals(a, data as unknown as typeof a);
  }

  for (
    const outcome of [
      "invalid",
      "not_authorized",
      "idempotency_conflict",
      "idempotency_pending",
    ]
  ) {
    const data = { ok: false, outcome };
    const rest = createRecordingClient(data);
    const mcp = createRecordingClient(data);
    const a = await createApiV1Program(rest.client, createInput());
    const b = await createMcpV1Program(mcp.client, createInput());
    assertEquals(b, a);
    assertEquals(a.ok, false);
    assertEquals(a.outcome, outcome);
  }
});

Deno.test("REST and MCP Program Create reject malformed envelopes identically", async () => {
  const malformed: unknown[] = [
    null,
    "applied",
    [],
    { ok: true, outcome: "applied" },
    { ok: true, outcome: "applied", programId: NIL_UUID },
    { ok: true, outcome: "applied", programId: "not-a-uuid" },
    { ok: true, outcome: "applied", programId: PROGRAM_ID, extra: 1 },
    { ok: true, outcome: "created", programId: PROGRAM_ID },
    { ok: false, outcome: "stale_program" },
    { ok: false, outcome: "invalid", programId: PROGRAM_ID },
    { ok: false },
  ];
  for (const data of malformed) {
    const rest = createRecordingClient(data);
    const mcp = createRecordingClient(data);
    const label = JSON.stringify(data);
    await assertRejects(
      () => createApiV1Program(rest.client, createInput()),
      ApiHttpError,
      undefined,
      `REST must reject result ${label}`,
    );
    await assertRejects(
      () => createMcpV1Program(mcp.client, createInput()),
      ApiHttpError,
      undefined,
      `MCP must reject result ${label}`,
    );
  }
});

Deno.test("REST and MCP Program Create map insufficient privilege identically", async () => {
  const privilege = { code: "42501", message: "permission denied" };
  const restPriv = createRecordingClient(null, privilege);
  const mcpPriv = createRecordingClient(null, privilege);
  const restError = await assertRejects(
    () => createApiV1Program(restPriv.client, createInput()),
    ApiHttpError,
  );
  const mcpError = await assertRejects(
    () => createMcpV1Program(mcpPriv.client, createInput()),
    ApiHttpError,
  );
  assertEquals(mcpError.code, restError.code);
  assertEquals(restError.code, "not_authorized");

  const other = { code: "XX000", message: "boom" };
  const restOther = createRecordingClient(null, other);
  const mcpOther = createRecordingClient(null, other);
  const restOtherError = await assertRejects(
    () => createApiV1Program(restOther.client, createInput()),
    ApiHttpError,
  );
  const mcpOtherError = await assertRejects(
    () => createMcpV1Program(mcpOther.client, createInput()),
    ApiHttpError,
  );
  assertEquals(mcpOtherError.code, restOtherError.code);
  assertEquals(restOtherError.code, "internal_error");
});

// -----------------------------------------------------------------------------
// E/G/H. Caller-bound executor
// -----------------------------------------------------------------------------

Deno.test("caller-bound executor factory validates its injected inputs", () => {
  const { factory } = createTrackingFactory(appliedData());
  for (const bad of ["", "   "]) {
    let threw = false;
    try {
      createMcpV1CreateProgramExecutor(bad, ANON_KEY, factory);
    } catch (error) {
      threw = error instanceof ApiHttpError;
    }
    assert(threw, "a blank Supabase URL must fail closed");
  }
  let threw = false;
  try {
    createMcpV1CreateProgramExecutor(SUPABASE_URL, "", factory);
  } catch (error) {
    threw = error instanceof ApiHttpError;
  }
  assert(threw, "a blank anon key must fail closed");

  threw = false;
  try {
    createMcpV1CreateProgramExecutor(
      SUPABASE_URL,
      ANON_KEY,
      undefined as unknown as typeof factory,
    );
  } catch (error) {
    threw = error instanceof ApiHttpError;
  }
  assert(threw, "a missing client factory must fail closed");
});

Deno.test("caller-bound executor performs exactly one bound MCP RPC", async () => {
  const { factory, factoryCalls, rpcCalls } = createTrackingFactory(
    appliedData(),
  );
  const execute = createMcpV1CreateProgramExecutor(
    SUPABASE_URL,
    ANON_KEY,
    factory,
  );
  const result = await execute(
    authorizedRequest(),
    createBody() as never,
    createContext() as never,
  );

  assertEquals(factoryCalls.length, 1, "exactly one client is constructed");
  assertEquals(factoryCalls[0].url, SUPABASE_URL);
  assertEquals(factoryCalls[0].key, ANON_KEY, "anon key is the only key used");
  assertEquals(factoryCalls[0].options, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { headers: { Authorization: `Bearer ${TOKEN}` } },
  });

  assertEquals(rpcCalls.length, 1, "exactly one RPC per invocation, no retry");
  assertEquals(rpcCalls[0].functionName, "mcp_v1_create_program");
  assertEquals(rpcCalls[0].args, {
    _expected_oauth_client_id: "btpm-connected-app",
    _workspace_id: WORKSPACE_ID,
    _name: "Finance Transformation",
    _description: "Multi-year finance program",
    _request_id: "req-1",
    _correlation_id: "req-1",
    _idempotency_key: "idem-1",
    _payload_hash: PAYLOAD_HASH,
  });
  assertEquals(result, { ok: true, outcome: "applied", programId: PROGRAM_ID });
});

Deno.test("caller-bound executor creates a fresh client per invocation", async () => {
  const { factory, factoryCalls, rpcCalls } = createTrackingFactory(
    appliedData(),
  );
  const execute = createMcpV1CreateProgramExecutor(
    SUPABASE_URL,
    ANON_KEY,
    factory,
  );
  await execute(
    authorizedRequest(),
    createBody() as never,
    createContext() as never,
  );
  await execute(
    new Request("https://edge.local/mcp", {
      method: "POST",
      headers: { Authorization: "Bearer second.caller.token" },
    }),
    createBody() as never,
    createContext() as never,
  );
  assertEquals(factoryCalls.length, 2, "no client reuse or caching");
  assertEquals(rpcCalls.length, 2);
  const first = factoryCalls[0].options as {
    global: { headers: { Authorization: string } };
  };
  const second = factoryCalls[1].options as {
    global: { headers: { Authorization: string } };
  };
  assertEquals(first.global.headers.Authorization, `Bearer ${TOKEN}`);
  assertEquals(
    second.global.headers.Authorization,
    "Bearer second.caller.token",
    "each invocation binds its own current caller token",
  );
});

Deno.test("caller-bound executor reuses the canonical Program body parser", async () => {
  assert(
    /import \{ parseApiV1CreateProgramBody \} from "[^"]*btpm-api\/routes\/programs\.ts";/
      .test(EXECUTOR_SOURCE),
    "the canonical Program Create parser must be imported",
  );
  assertEquals(
    (EXECUTOR_SOURCE.match(/parseApiV1CreateProgramBody\(body\)/g) ?? []).length,
    1,
    "the canonical parser must be called exactly once per invocation",
  );
  assertEquals(
    (EXECUTOR_CODE.match(
      /PROGRAM_CREATE_ALLOWED_KEYS|parseProgramName|canonicalizeProgramText|parseProgramWorkspaceId/g,
    ) ?? []).length,
    0,
    "no second Program Create body parser may exist",
  );

  const { factory, rpcCalls } = createTrackingFactory(appliedData());
  const execute = createMcpV1CreateProgramExecutor(
    SUPABASE_URL,
    ANON_KEY,
    factory,
  );
  await execute(
    authorizedRequest(),
    { workspaceId: WORKSPACE_ID, name: "  Spaced Name  " } as never,
    createContext() as never,
  );
  assertEquals(rpcCalls[0].args._name, "Spaced Name");
  assertEquals(rpcCalls[0].args._description, null);

  const blank = createTrackingFactory(appliedData());
  const executeBlank = createMcpV1CreateProgramExecutor(
    SUPABASE_URL,
    ANON_KEY,
    blank.factory,
  );
  await executeBlank(
    authorizedRequest(),
    createBody({ description: "   " }) as never,
    createContext() as never,
  );
  assertEquals(blank.rpcCalls[0].args._description, null);
});

Deno.test("caller-bound executor rejects a malformed body before any client or RPC", async () => {
  const malformedBodies: unknown[] = [
    null,
    [],
    "workspace",
    {},
    createBody({ workspaceId: "not-a-uuid" }),
    createBody({ workspaceId: NIL_UUID }),
    createBody({ name: "   " }),
    createBody({ name: "x".repeat(201) }),
    createBody({ name: 7 }),
    createBody({ description: 7 }),
    createBody({ status: "active" }),
    createBody({ programId: PROGRAM_ID }),
    createBody({ organizationId: WORKSPACE_ID }),
  ];
  for (const body of malformedBodies) {
    const { factory, factoryCalls, rpcCalls } = createTrackingFactory(
      appliedData(),
    );
    const execute = createMcpV1CreateProgramExecutor(
      SUPABASE_URL,
      ANON_KEY,
      factory,
    );
    const label = JSON.stringify(body);
    await assertRejects(
      () =>
        execute(authorizedRequest(), body as never, createContext() as never),
      ApiHttpError,
      undefined,
      `body ${label} must be rejected`,
    );
    assertEquals(factoryCalls.length, 0, `no client for body ${label}`);
    assertEquals(rpcCalls.length, 0, `no RPC for body ${label}`);
  }
});

Deno.test("caller-bound executor rejects an inconsistent trusted MCP context", async () => {
  const badContexts: Record<string, unknown>[] = [
    { requestedUserId: "user-2" },
    { executingUserId: "user-2" },
    { sourceClientId: "other-client" },
    { apiClientId: "other-client" },
    { correlationId: "req-2" },
    { requestId: "req-2" },
    { sourceChannel: "external_api" },
    { sourceChannel: "btpm_ui" },
    { sourceChannel: null },
    { delegationMode: "service_role" },
    { delegationMode: "app_only" },
    { payloadHash: "A".repeat(64) },
    { payloadHash: "a".repeat(63) },
    { payloadHash: "z".repeat(64) },
    { payloadHash: null },
    { idempotencyKey: "" },
    { idempotencyKey: null },
    { oauthClientId: "" },
    { apiClientId: "", sourceClientId: "" },
    { policyVersionId: "" },
    { requestedUserId: "", executingUserId: "" },
    { requestId: "", correlationId: "" },
  ];
  for (const override of badContexts) {
    const { factory, factoryCalls, rpcCalls } = createTrackingFactory(
      appliedData(),
    );
    const execute = createMcpV1CreateProgramExecutor(
      SUPABASE_URL,
      ANON_KEY,
      factory,
    );
    const label = JSON.stringify(override);
    await assertRejects(
      () =>
        execute(
          authorizedRequest(),
          createBody() as never,
          createContext(override) as never,
        ),
      ApiHttpError,
      undefined,
      `context ${label} must be rejected`,
    );
    assertEquals(factoryCalls.length, 0, `no client for context ${label}`);
    assertEquals(rpcCalls.length, 0, `no RPC for context ${label}`);
  }

  for (const bad of [null, "ctx", [], 7]) {
    const { factory, factoryCalls, rpcCalls } = createTrackingFactory(
      appliedData(),
    );
    const execute = createMcpV1CreateProgramExecutor(
      SUPABASE_URL,
      ANON_KEY,
      factory,
    );
    await assertRejects(
      () => execute(authorizedRequest(), createBody() as never, bad as never),
      ApiHttpError,
    );
    assertEquals(factoryCalls.length, 0);
    assertEquals(rpcCalls.length, 0);
  }
});

Deno.test("caller-bound executor requires a well-formed current bearer token", async () => {
  const badRequests: Request[] = [
    new Request("https://edge.local/mcp", { method: "POST" }),
    new Request("https://edge.local/mcp", {
      method: "POST",
      headers: { Authorization: "Bearer" },
    }),
    new Request("https://edge.local/mcp", {
      method: "POST",
      headers: { Authorization: "Basic dXNlcjpwYXNz" },
    }),
    new Request("https://edge.local/mcp", {
      method: "POST",
      headers: { Authorization: "Bearer    " },
    }),
  ];
  for (const request of badRequests) {
    const { factory, factoryCalls, rpcCalls } = createTrackingFactory(
      appliedData(),
    );
    const execute = createMcpV1CreateProgramExecutor(
      SUPABASE_URL,
      ANON_KEY,
      factory,
    );
    await assertRejects(
      () => execute(request, createBody() as never, createContext() as never),
      ApiAuthenticationError,
    );
    assertEquals(factoryCalls.length, 0, "no client before bearer validation");
    assertEquals(rpcCalls.length, 0, "no RPC before bearer validation");
  }

  const { factory, factoryCalls } = createTrackingFactory(appliedData());
  const execute = createMcpV1CreateProgramExecutor(
    SUPABASE_URL,
    ANON_KEY,
    factory,
  );
  await assertRejects(
    () =>
      execute(
        "https://edge.local/mcp" as unknown as Request,
        createBody() as never,
        createContext() as never,
      ),
    ApiHttpError,
  );
  assertEquals(factoryCalls.length, 0);
});

Deno.test("caller-bound executor fails closed on a structurally invalid client", async () => {
  for (const bad of [null, {}, "client", () => {}]) {
    const execute = createMcpV1CreateProgramExecutor(
      SUPABASE_URL,
      ANON_KEY,
      () => bad,
    );
    await assertRejects(
      () =>
        execute(
          authorizedRequest(),
          createBody() as never,
          createContext() as never,
        ),
      ApiHttpError,
    );
  }
  const throwing = createMcpV1CreateProgramExecutor(
    SUPABASE_URL,
    ANON_KEY,
    () => {
      throw new Error("factory exploded");
    },
  );
  await assertRejects(
    () =>
      throwing(
        authorizedRequest(),
        createBody() as never,
        createContext() as never,
      ),
    ApiHttpError,
  );
});

Deno.test("caller-bound executor forwards only trusted context and canonical body", async () => {
  const { factory, rpcCalls } = createTrackingFactory(appliedData());
  const execute = createMcpV1CreateProgramExecutor(
    SUPABASE_URL,
    ANON_KEY,
    factory,
  );
  await execute(
    authorizedRequest(),
    createBody({ name: " Alt Program " }) as never,
    createContext({
      oauthClientId: "other-oauth-client",
      requestId: "req-9",
      correlationId: "req-9",
      idempotencyKey: "idem-9",
      payloadHash: "b".repeat(64),
    }) as never,
  );
  assertEquals(rpcCalls[0].args, {
    _expected_oauth_client_id: "other-oauth-client",
    _workspace_id: WORKSPACE_ID,
    _name: "Alt Program",
    _description: "Multi-year finance program",
    _request_id: "req-9",
    _correlation_id: "req-9",
    _idempotency_key: "idem-9",
    _payload_hash: "b".repeat(64),
  });
});

Deno.test("caller-bound executor exports exactly one factory and no key/context escape", () => {
  const exported = [
    ...EXECUTOR_SOURCE.matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm),
  ].map((m) => m[1]);
  assertEquals(exported, ["createMcpV1CreateProgramExecutor"]);
  for (
    const symbol of [
      "export interface McpCreateProgramClientOptions",
      "export type McpCreateProgramClientFactory",
      "export type McpV1CreateProgramExecutor",
    ]
  ) {
    assert(EXECUTOR_SOURCE.includes(symbol), `${symbol} must be exported`);
  }

  const signature =
    /export function createMcpV1CreateProgramExecutor\(([\s\S]*?)\): McpV1CreateProgramExecutor/
      .exec(EXECUTOR_SOURCE)?.[1] ?? "";
  assert(signature.includes("supabaseUrl: string"));
  assert(signature.includes("supabaseAnonKey: string"));
  assert(signature.includes("createClient: McpCreateProgramClientFactory"));
  assertEquals(
    signature.split(",").map((s) => s.trim()).filter((s) => s.length > 0).length,
    3,
    "the factory takes exactly URL, anon key and client factory",
  );

  const executorSignature =
    /export type McpV1CreateProgramExecutor = \(([\s\S]*?)\) =>/
      .exec(EXECUTOR_SOURCE)?.[1] ?? "";
  assert(executorSignature.includes("request: Request"));
  assert(executorSignature.includes("body: ApiV1CreateProgramBody"));
  assert(
    executorSignature.includes("executionContext: McpMutationExecutionContext"),
  );
  assertEquals(
    executorSignature.split(",").map((s) => s.trim()).filter((s) =>
      s.length > 0
    ).length,
    3,
    "the executor takes exactly request, body and trusted context",
  );
  for (
    const forbidden of [
      "operationId",
      "capabilityKey",
      "wrapperName",
      "functionName",
      "sourceChannel:",
      "userId:",
      "apiClientId:",
      "organizationId",
      "tenantId",
      "workspaceAuthority",
      "confirmation",
      "AuthenticatedApiContext",
    ]
  ) {
    assert(
      !executorSignature.includes(forbidden) && !signature.includes(forbidden),
      `no caller-controlled ${forbidden} argument may exist`,
    );
  }
});

// -----------------------------------------------------------------------------
// I. Forbidden surfaces
// -----------------------------------------------------------------------------

Deno.test("caller-bound executor contains no privileged, enablement or authority logic", () => {
  for (
    const forbidden of [
      "SUPABASE_SERVICE_ROLE_KEY",
      "serviceRole",
      "service_role",
      "privilegedClient",
      "Deno.env",
      ".from(",
      "apply_program_create",
      "api_project_client_enablements",
      "authorize_and_establish",
      "authorize_and_establish_mcp",
      "btpm_encrypt",
      "btpm_decrypt",
      "console.",
      "setTimeout",
      "setInterval",
      "claim_idempotency",
      "createHash",
      "sha256",
      "confirmation",
      "toolRegistry",
      "serverFactory",
      "registerTool",
    ]
  ) {
    assert(
      !EXECUTOR_CODE.includes(forbidden),
      `the writer must not contain ${forbidden}`,
    );
  }
  assert(!/\bfetch\(/.test(EXECUTOR_CODE), "no direct fetch may exist");
  assert(!/\bretry\b/i.test(EXECUTOR_CODE), "no retry logic may exist");
  assertEquals(
    (EXECUTOR_CODE.match(/createMcpV1Program\(/g) ?? []).length,
    1,
    "exactly one canonical MCP adapter call site may exist",
  );
  assert(
    !EXECUTOR_CODE.includes("createApiV1Program"),
    "the MCP writer must never reach the REST adapter",
  );
  assert(
    !EXECUTOR_CODE.includes("mcp_v1_create_program"),
    "the wrapper name stays owned by the closed adapter",
  );
});

// -----------------------------------------------------------------------------
// J. Program Update boundary (Create must not leak into the Update block)
// -----------------------------------------------------------------------------

Deno.test("Program Update keeps its own closed wrapper set", () => {
  assert(
    ADAPTER_SOURCE.includes(
      'const API_V1_UPDATE_PROGRAM_FUNCTION_NAME = "api_v1_update_program";',
    ),
    "the REST Program Update wrapper constant must be untouched",
  );
  assert(
    /export function updateApiV1Program\(/.test(UPDATE_BLOCK),
    "updateApiV1Program remains exported",
  );
  assert(
    !UPDATE_BLOCK.includes("CREATE_PROGRAM_FUNCTION_NAME"),
    "no Program Create wrapper may be reachable from the Update block",
  );
  assert(
    !CREATE_BLOCK.includes("UPDATE_PROGRAM_FUNCTION_NAME"),
    "no Program Update wrapper may be reachable from the Create block",
  );
});

