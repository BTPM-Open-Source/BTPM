// API-Q Project Create Step 2 — focused test for the caller-bound MCP Project
// Create writer adapter.
//
// Proves the closed wrapper selection in `supabaseProjectMutation.ts`, the
// shared validation/result mapping between the REST and MCP Project Create
// adapters, and the fail-closed caller-bound executor behaviour.
//
// No database access, no network access, no Edge invocation.

import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  type ApiV1CreateProjectInput,
  createApiV1Project,
  createMcpV1Project,
} from "../../functions/_shared/btpm-api/supabaseProjectMutation.ts";
import { createMcpV1CreateProjectExecutor } from "../../functions/btpm-mcp/mcp/projectCreateMutationExecutor.ts";
import { ApiHttpError } from "../../functions/_shared/btpm-api/http.ts";
import { ApiAuthenticationError } from "../../functions/_shared/btpm-api/apiErrors.ts";

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const PROGRAM_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const PAYLOAD_HASH = "a".repeat(64);
const TOKEN = "caller.bearer.token";

const SUPABASE_URL = "https://project.supabase.co";
const ANON_KEY = "anon-publishable-key";

function createInput(
  overrides: Partial<ApiV1CreateProjectInput> = {},
): ApiV1CreateProjectInput {
  return {
    expectedOauthClientId: "btpm-connected-app",
    workspaceId: WORKSPACE_ID,
    name: "SAP S/4 Rollout",
    programId: PROGRAM_ID,
    deliveryModel: "internal_delivery",
    requestId: "req-1",
    correlationId: "req-1",
    idempotencyKey: "idem-1",
    payloadHash: PAYLOAD_HASH,
    ...overrides,
  };
}

function appliedData() {
  return { ok: true, outcome: "applied", projectId: PROJECT_ID };
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
    name: "SAP S/4 Rollout",
    programId: PROGRAM_ID,
    deliveryModel: "internal_delivery",
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
    "../../functions/_shared/btpm-api/supabaseProjectMutation.ts",
    import.meta.url,
  ),
);
const EXECUTOR_SOURCE = await Deno.readTextFile(
  new URL(
    "../../functions/btpm-mcp/mcp/projectCreateMutationExecutor.ts",
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

/** Executable executor code only: no comments. */
const EXECUTOR_CODE = stripTsComments(EXECUTOR_SOURCE);

/** The Project Create block ends where the API-N.6 update adapter begins. */
const CREATE_BLOCK = ADAPTER_SOURCE.slice(
  0,
  ADAPTER_SOURCE.indexOf("// API-N.6 — Explicit RPC adapter"),
);

// -----------------------------------------------------------------------------
// A. Base adapter — closed wrapper selection
// -----------------------------------------------------------------------------

Deno.test("REST Project Create invokes only api_v1_create_project", async () => {
  const { calls, client } = createRecordingClient(appliedData());
  const result = await createApiV1Project(client, createInput());
  assertEquals(calls.length, 1);
  assertEquals(calls[0].functionName, "api_v1_create_project");
  assert(result.ok);
  assertEquals(result.outcome, "applied");
});

Deno.test("MCP Project Create invokes only mcp_v1_create_project", async () => {
  const { calls, client } = createRecordingClient(appliedData());
  const result = await createMcpV1Project(client, createInput());
  assertEquals(calls.length, 1);
  assertEquals(calls[0].functionName, "mcp_v1_create_project");
  assert(result.ok);
  assertEquals(result.outcome, "applied");
});

Deno.test("Project Create wrapper selection is closed and not caller-provided", () => {
  assert(
    ADAPTER_SOURCE.includes(
      'const MCP_V1_CREATE_PROJECT_FUNCTION_NAME = "mcp_v1_create_project";',
    ),
    "the fixed MCP wrapper constant must exist",
  );
  assert(
    /type CreateProjectFunctionName =\s*\|\s*typeof API_V1_CREATE_PROJECT_FUNCTION_NAME\s*\|\s*typeof MCP_V1_CREATE_PROJECT_FUNCTION_NAME;/
      .test(ADAPTER_SOURCE),
    "the closed create-wrapper type must contain exactly the two wrappers",
  );
  assert(
    /^async function invokeCreateProject\(/m.test(ADAPTER_SOURCE),
    "invokeCreateProject must exist and must not be exported",
  );
  assert(
    !ADAPTER_SOURCE.includes("export async function invokeCreateProject"),
    "invokeCreateProject must never be exported",
  );
  assert(
    /functionName: CreateProjectFunctionName,/.test(ADAPTER_SOURCE),
    "the shared invoker must constrain the wrapper name by the closed type",
  );
  for (const fn of ["createApiV1Project", "createMcpV1Project"]) {
    const match = new RegExp(
      `export function ${fn}\\(([\\s\\S]*?)\\): Promise<ApiV1CreateProjectResult>`,
    ).exec(ADAPTER_SOURCE);
    assert(match !== null, `${fn} must be exported`);
    const params = match?.[1] ?? "";
    assert(!params.includes("functionName"), `${fn} must not accept functionName`);
    assert(!/wrapperName/i.test(params), `${fn} must not accept a wrapper name`);
  }
  // Exactly one shared RPC invocation exists inside the Project Create block.
  // Update and Transition own their own explicit adapters.
  assertEquals(
    (CREATE_BLOCK.match(/client\.rpc\(/g) ?? []).length,
    1,
    "the Project Create family must contain exactly one client.rpc call",
  );
  assert(
    CREATE_BLOCK.includes("await client.rpc(functionName, {"),
    "the single Project Create RPC must use the closed functionName",
  );
  // No generic dispatcher: the module never exports a function-name-taking RPC.
  assert(
    !/export\s+(async\s+)?function\s+\w+\([^)]*functionName/.test(ADAPTER_SOURCE),
    "no generic Project RPC dispatcher may be exported",
  );
  assert(!ADAPTER_SOURCE.includes("execute_sql"), "no raw SQL execution");
});

// -----------------------------------------------------------------------------
// B. Shared validation / result contract parity
// -----------------------------------------------------------------------------

Deno.test("REST and MCP Project Create build identical RPC arguments", async () => {
  const rest = createRecordingClient(appliedData());
  const mcp = createRecordingClient(appliedData());
  await createApiV1Project(rest.client, createInput());
  await createMcpV1Project(mcp.client, createInput());
  assertEquals(mcp.calls[0].args, rest.calls[0].args);
  assertEquals(rest.calls[0].args, {
    _expected_oauth_client_id: "btpm-connected-app",
    _workspace_id: WORKSPACE_ID,
    _name: "SAP S/4 Rollout",
    _program_id: PROGRAM_ID,
    _delivery_model: "internal_delivery",
    _request_id: "req-1",
    _correlation_id: "req-1",
    _idempotency_key: "idem-1",
    _payload_hash: PAYLOAD_HASH,
  });
});

Deno.test("REST and MCP Project Create apply identical input validation", async () => {
  const invalidInputs: Partial<ApiV1CreateProjectInput>[] = [
    { name: "" },
    { name: "x".repeat(201) },
    { name: 42 as unknown as string },
    { workspaceId: "not-a-uuid" },
    { workspaceId: NIL_UUID },
    { programId: "not-a-uuid" },
    { programId: NIL_UUID },
    {
      deliveryModel: "external_delivery" as unknown as
        ApiV1CreateProjectInput["deliveryModel"],
    },
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
      () => createApiV1Project(rest.client, createInput(override)),
      ApiHttpError,
      undefined,
      `REST must reject ${label}`,
    );
    await assertRejects(
      () => createMcpV1Project(mcp.client, createInput(override)),
      ApiHttpError,
      undefined,
      `MCP must reject ${label}`,
    );
    assertEquals(rest.calls.length, 0, `REST must not call RPC for ${label}`);
    assertEquals(mcp.calls.length, 0, `MCP must not call RPC for ${label}`);
  }
});

Deno.test("REST and MCP Project Create accept identical optional-null input", async () => {
  const rest = createRecordingClient(appliedData());
  const mcp = createRecordingClient(appliedData());
  const input = createInput({ programId: null, deliveryModel: null });
  await createApiV1Project(rest.client, input);
  await createMcpV1Project(mcp.client, input);
  assertEquals(rest.calls[0].args._program_id, null);
  assertEquals(rest.calls[0].args._delivery_model, null);
  assertEquals(mcp.calls[0].args, rest.calls[0].args);
});

Deno.test("REST and MCP Project Create map results identically", async () => {
  const positive = [
    { ok: true, outcome: "applied", projectId: PROJECT_ID },
    { ok: true, outcome: "replayed", projectId: PROJECT_ID },
  ];
  for (const data of positive) {
    const rest = createRecordingClient(data);
    const mcp = createRecordingClient(data);
    const a = await createApiV1Project(rest.client, createInput());
    const b = await createMcpV1Project(mcp.client, createInput());
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
    const a = await createApiV1Project(rest.client, createInput());
    const b = await createMcpV1Project(mcp.client, createInput());
    assertEquals(b, a);
    assertEquals(a.ok, false);
    assertEquals(a.outcome, outcome);
  }
});

Deno.test("REST and MCP Project Create reject malformed result shapes identically", async () => {
  const malformed: unknown[] = [
    null,
    "applied",
    [],
    { ok: true, outcome: "applied" },
    { ok: true, outcome: "applied", projectId: NIL_UUID },
    { ok: true, outcome: "applied", projectId: "not-a-uuid" },
    { ok: true, outcome: "applied", projectId: PROJECT_ID, extra: 1 },
    { ok: true, outcome: "created", projectId: PROJECT_ID },
    { ok: false, outcome: "stale_project" },
    { ok: false, outcome: "invalid", projectId: PROJECT_ID },
    { ok: false },
  ];
  for (const data of malformed) {
    const rest = createRecordingClient(data);
    const mcp = createRecordingClient(data);
    const label = JSON.stringify(data);
    await assertRejects(
      () => createApiV1Project(rest.client, createInput()),
      ApiHttpError,
      undefined,
      `REST must reject result ${label}`,
    );
    await assertRejects(
      () => createMcpV1Project(mcp.client, createInput()),
      ApiHttpError,
      undefined,
      `MCP must reject result ${label}`,
    );
  }
});

Deno.test("REST and MCP Project Create map insufficient privilege identically", async () => {
  // Preserved API-N.5 behavior: SQLSTATE 42501 raises the bounded
  // `not_authorized` ApiHttpError on BOTH adapters. No outcome is invented.
  const privilege = { code: "42501", message: "permission denied" };
  const restPriv = createRecordingClient(null, privilege);
  const mcpPriv = createRecordingClient(null, privilege);
  const restError = await assertRejects(
    () => createApiV1Project(restPriv.client, createInput()),
    ApiHttpError,
  );
  const mcpError = await assertRejects(
    () => createMcpV1Project(mcpPriv.client, createInput()),
    ApiHttpError,
  );
  assertEquals(mcpError.code, restError.code);
  assertEquals(restError.code, "not_authorized");

  // Any other database error maps identically to bounded internal_error.
  const other = { code: "XX000", message: "boom" };
  const restOther = createRecordingClient(null, other);
  const mcpOther = createRecordingClient(null, other);
  const restOtherError = await assertRejects(
    () => createApiV1Project(restOther.client, createInput()),
    ApiHttpError,
  );
  const mcpOtherError = await assertRejects(
    () => createMcpV1Project(mcpOther.client, createInput()),
    ApiHttpError,
  );
  assertEquals(mcpOtherError.code, restOtherError.code);
  assertEquals(restOtherError.code, "internal_error");
});

// -----------------------------------------------------------------------------
// C. Caller-bound writer
// -----------------------------------------------------------------------------

Deno.test("caller-bound executor factory validates its injected inputs", () => {
  const { factory } = createTrackingFactory(appliedData());
  for (const bad of ["", "   "]) {
    assertRejects(async () => {
      createMcpV1CreateProjectExecutor(bad, ANON_KEY, factory);
    });
  }
  let threw = false;
  try {
    createMcpV1CreateProjectExecutor(SUPABASE_URL, "", factory);
  } catch (error) {
    threw = error instanceof ApiHttpError;
  }
  assert(threw, "a blank anon key must fail closed");

  threw = false;
  try {
    createMcpV1CreateProjectExecutor(
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
  const execute = createMcpV1CreateProjectExecutor(
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
  assertEquals(rpcCalls[0].functionName, "mcp_v1_create_project");
  assertEquals(rpcCalls[0].args, {
    _expected_oauth_client_id: "btpm-connected-app",
    _workspace_id: WORKSPACE_ID,
    _name: "SAP S/4 Rollout",
    _program_id: PROGRAM_ID,
    _delivery_model: "internal_delivery",
    _request_id: "req-1",
    _correlation_id: "req-1",
    _idempotency_key: "idem-1",
    _payload_hash: PAYLOAD_HASH,
  });
  assertEquals(result, { ok: true, outcome: "applied", projectId: PROJECT_ID });
});

Deno.test("caller-bound executor creates a fresh client per invocation", async () => {
  const { factory, factoryCalls, rpcCalls } = createTrackingFactory(
    appliedData(),
  );
  const execute = createMcpV1CreateProjectExecutor(
    SUPABASE_URL,
    ANON_KEY,
    factory,
  );
  await execute(authorizedRequest(), createBody() as never, createContext() as never);
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
  const first = factoryCalls[0].options as { global: { headers: { Authorization: string } } };
  const second = factoryCalls[1].options as { global: { headers: { Authorization: string } } };
  assertEquals(first.global.headers.Authorization, `Bearer ${TOKEN}`);
  assertEquals(
    second.global.headers.Authorization,
    "Bearer second.caller.token",
    "each invocation binds its own current caller token",
  );
});

Deno.test("caller-bound executor reuses the canonical body parser and normalizes", async () => {
  assert(
    // Path-agnostic: the canonical parser must be imported from the canonical
    // btpm-api route module. The relative depth is not an invariant (it changed
    // with the accepted MCP directory relocation).
    /import \{ parseApiV1CreateProjectBody \} from "[^"]*btpm-api\/routes\/projects\.ts";/
      .test(EXECUTOR_SOURCE),
    "the canonical Project Create parser must be imported",
  );
  assert(
    EXECUTOR_SOURCE.includes("parseApiV1CreateProjectBody(body)"),
    "the canonical parser must be called on every invocation",
  );
  assert(
    (EXECUTOR_SOURCE.match(/PROJECT_CREATE_ALLOWED_KEYS|parseProjectName|parseProjectUuid/g) ??
      []).length === 0,
    "no second Project Create body parser may exist",
  );

  // Canonical normalization is applied: absent optional keys become null and
  // the name is canonicalized by the canonical parser, not by the writer.
  const { factory, rpcCalls } = createTrackingFactory(appliedData());
  const execute = createMcpV1CreateProjectExecutor(
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
  assertEquals(rpcCalls[0].args._program_id, null);
  assertEquals(rpcCalls[0].args._delivery_model, null);
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
    createBody({ programId: "not-a-uuid" }),
    createBody({ deliveryModel: "external_delivery" }),
    createBody({ status: "active" }),
    createBody({ startDate: "2026-01-01" }),
    createBody({ description: "narrative" }),
  ];
  for (const body of malformedBodies) {
    const { factory, factoryCalls, rpcCalls } = createTrackingFactory(
      appliedData(),
    );
    const execute = createMcpV1CreateProjectExecutor(
      SUPABASE_URL,
      ANON_KEY,
      factory,
    );
    const label = JSON.stringify(body);
    await assertRejects(
      () => execute(authorizedRequest(), body as never, createContext() as never),
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
    const execute = createMcpV1CreateProjectExecutor(
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
    const execute = createMcpV1CreateProjectExecutor(
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
    const execute = createMcpV1CreateProjectExecutor(
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
  const execute = createMcpV1CreateProjectExecutor(
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
    const execute = createMcpV1CreateProjectExecutor(
      SUPABASE_URL,
      ANON_KEY,
      () => bad,
    );
    await assertRejects(
      () =>
        execute(authorizedRequest(), createBody() as never, createContext() as never),
      ApiHttpError,
    );
  }
  const throwing = createMcpV1CreateProjectExecutor(
    SUPABASE_URL,
    ANON_KEY,
    () => {
      throw new Error("factory exploded");
    },
  );
  await assertRejects(
    () =>
      throwing(authorizedRequest(), createBody() as never, createContext() as never),
    ApiHttpError,
  );
});

Deno.test("caller-bound executor exports exactly one factory and no key/context escape", () => {
  const exported = [...EXECUTOR_SOURCE.matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm)]
    .map((m) => m[1]);
  assertEquals(exported, ["createMcpV1CreateProjectExecutor"]);

  const signature = /export function createMcpV1CreateProjectExecutor\(([\s\S]*?)\): McpV1CreateProjectExecutor/
    .exec(EXECUTOR_SOURCE)?.[1] ?? "";
  assert(signature.includes("supabaseUrl: string"));
  assert(signature.includes("supabaseAnonKey: string"));
  assert(signature.includes("createClient: McpCreateProjectClientFactory"));
  assertEquals(
    signature.split(",").map((s) => s.trim()).filter((s) => s.length > 0).length,
    3,
    "the factory takes exactly URL, anon key and client factory",
  );

  const executorSignature = /export type McpV1CreateProjectExecutor = \(([\s\S]*?)\) =>/
    .exec(EXECUTOR_SOURCE)?.[1] ?? "";
  assert(executorSignature.includes("request: Request"));
  assert(executorSignature.includes("body: ApiV1CreateProjectBody"));
  assert(
    executorSignature.includes("executionContext: McpMutationExecutionContext"),
  );
  assertEquals(
    executorSignature.split(",").map((s) => s.trim()).filter((s) => s.length > 0)
      .length,
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
// D. Project Create special rule and ownership boundaries
// -----------------------------------------------------------------------------

Deno.test("caller-bound executor contains no Project enablement or authority logic", () => {
  for (
    const forbidden of [
      "api_project_client_enablements",
      "project_client_enablement",
      "enable_project",
      "from(\"projects\")",
      "from('projects')",
      ".from(",
      "is_project_manager",
      "has_role",
      "can_write_demo",
      "authorize_and_establish",
      "claim_idempotency",
      "complete_idempotency",
      "fail_idempotency",
      "btpm_encrypt",
      "btpm_decrypt",
      "encrypt",
      "decrypt",
      "confirmation",
      "toolRegistry",
      "serverFactory",
      "registerTool",
      "service_role",
      "SERVICE_ROLE",
      "serviceRole",
      "Deno.env",
      "createHash",
      "sha256",
      "setTimeout",
      "setInterval",
      "console.",
    ]
  ) {
    assert(
      !EXECUTOR_CODE.includes(forbidden),
      `the writer must not contain ${forbidden}`,
    );
  }
  assert(!/\bfetch\(/.test(EXECUTOR_CODE), "no direct fetch may exist");
  assert(!/\bretry\b/i.test(EXECUTOR_CODE), "no retry logic may exist");
  assert(
    (EXECUTOR_CODE.match(/createMcpV1Project\(/g) ?? []).length === 1,
    "exactly one canonical MCP adapter call site may exist",
  );
  assert(
    !EXECUTOR_CODE.includes("createApiV1Project"),
    "the MCP writer must never reach the REST adapter",
  );
  assert(
    !EXECUTOR_CODE.includes("mcp_v1_create_project"),
    "the wrapper name stays owned by the closed adapter",
  );
});

Deno.test("Project Create adapter block adds no enablement behavior", () => {
  for (
    const forbidden of [
      "api_project_client_enablements",
      "enable_project",
      "service_role",
      "Deno.env",
    ]
  ) {
    assert(
      !stripTsComments(CREATE_BLOCK).includes(forbidden),
      `the Project Create adapter must not contain ${forbidden}`,
    );
  }
});
