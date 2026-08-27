// API-Q Portfolio-9C — focused guard for the Portfolio-create MCP mutation
// control composition. Behavioural (in-process fakes) + static source guards.
// No network, no database, no Edge invocation, no service-role key.
//
// Scope: control/composition only. Exposure and runtime wiring remain closed.

import {
  assert,
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  createMcpPortfolioCreateToolExecutor,
  MCP_PORTFOLIO_CREATE_TOOL_ARGUMENT_NAMES,
  MCP_PORTFOLIO_CREATE_TOOL_ERROR_MESSAGES,
  MCP_PORTFOLIO_CREATE_TOOL_INPUT_SCHEMA,
  MCP_PORTFOLIO_CREATE_TOOL_NAME,
  type McpPortfolioCreateToolErrorCategory,
} from "../../functions/btpm-mcp/mcp/portfolioCreateMutationTool.ts";
import { hashCanonicalPayload } from "../../functions/_shared/btpm-api/idempotency.ts";
import {
  parseApiV1CreatePortfolioBody,
  PORTFOLIO_CREATE_ROUTE,
} from "../../functions/_shared/btpm-api/routes/portfolios.ts";
import { ApiHttpError } from "../../functions/_shared/btpm-api/http.ts";

const TOOL_URL = new URL(
  "../../functions/btpm-mcp/mcp/portfolioCreateMutationTool.ts",
  import.meta.url,
);
const toolSource = await Deno.readTextFile(TOOL_URL);

/** Executable production code only: line and block comments removed. */
const executableSource = toolSource
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .filter((line) => !line.trim().startsWith("//"))
  .join("\n");

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_ID = "22222222-2222-4222-8222-222222222222";
const PORTFOLIO_ID = "55555555-5555-4555-8555-555555555555";
const API_CLIENT_ID = "44444444-4444-4444-8444-444444444444";
const USER_ID = "33333333-3333-4333-8333-333333333333";

const trustedExecution = Object.freeze({
  requestedUserId: USER_ID,
  executingUserId: USER_ID,
  apiClientId: API_CLIENT_ID,
  oauthClientId: "oauth-1",
  policyVersionId: "policy-1",
  requestId: "req-1",
  correlationId: "req-1",
  sourceChannel: "mcp" as const,
  sourceClientId: API_CLIENT_ID,
  delegationMode: "delegated_user" as const,
});

const validArgs = Object.freeze({
  organizationId: ORGANIZATION_ID,
  name: "Oncology Portfolio",
  confirmation: true,
  idempotencyKey: "idem-key-portfolio-create",
});

const successResult = Object.freeze({
  ok: true,
  outcome: "applied",
  portfolioId: PORTFOLIO_ID,
});

interface Recorder {
  readonly profileCalls: Array<{ clientId: string; routeId: string }>;
  // deno-lint-ignore no-explicit-any
  readonly consumeCalls: any[];
  readonly writerCalls: Array<{
    request: Request;
    // deno-lint-ignore no-explicit-any
    body: any;
    // deno-lint-ignore no-explicit-any
    context: any;
  }>;
  readonly order: string[];
}

function buildHarness(
  // deno-lint-ignore no-explicit-any
  writerResult: any = successResult,
  options: { rateLimitThrows?: unknown; writerThrows?: unknown } = {},
) {
  const recorder: Recorder = {
    profileCalls: [],
    consumeCalls: [],
    writerCalls: [],
    order: [],
  };
  const request = new Request("https://example.test/mcp", {
    method: "POST",
    headers: { Authorization: "Bearer token-value" },
  });

  const executor = createMcpPortfolioCreateToolExecutor({
    request,
    execution: trustedExecution,
    // deno-lint-ignore no-explicit-any
    writer: (async (req: Request, body: any, context: any) => {
      recorder.order.push("writer");
      recorder.writerCalls.push({ request: req, body, context });
      if (options.writerThrows) throw options.writerThrows;
      return writerResult;
      // deno-lint-ignore no-explicit-any
    }) as any,
    rateLimitProfileResolver: {
      resolve: (clientId: string, routeId: string) => {
        recorder.order.push("profile");
        recorder.profileCalls.push({ clientId, routeId });
        return Promise.resolve({ limit: 100, windowSeconds: 60 });
      },
      // deno-lint-ignore no-explicit-any
    } as any,
    rateLimitStore: {
      // deno-lint-ignore no-explicit-any
      consume: (input: any) => {
        recorder.order.push("rate_limit");
        recorder.consumeCalls.push(input);
        if (options.rateLimitThrows) throw options.rateLimitThrows;
        return Promise.resolve({
          allowed: true,
          remaining: 99,
          resetAtEpochMs: 1_700_000_060_000,
        });
      },
      // deno-lint-ignore no-explicit-any
    } as any,
    now: () => 1_700_000_000_000,
  });

  return { executor, recorder, request };
}

// ---------------------------------------------------------------------------
// A. Input contract
// ---------------------------------------------------------------------------

Deno.test("A1: tool name and the exact nine argument names", () => {
  assertEquals(MCP_PORTFOLIO_CREATE_TOOL_NAME, "btpm_create_portfolio");
  assertEquals([...MCP_PORTFOLIO_CREATE_TOOL_ARGUMENT_NAMES], [
    "organizationId",
    "name",
    "code",
    "description",
    "lifecycleState",
    "strategicPriority",
    "ownerId",
    "confirmation",
    "idempotencyKey",
  ]);
  assertEquals(MCP_PORTFOLIO_CREATE_TOOL_ARGUMENT_NAMES.length, 9);
  assertEquals(
    Object.keys(MCP_PORTFOLIO_CREATE_TOOL_INPUT_SCHEMA.shape).sort(),
    [...MCP_PORTFOLIO_CREATE_TOOL_ARGUMENT_NAMES].sort(),
  );
});

Deno.test("A2: the schema is strict and rejects unknown / provenance fields", () => {
  assert(MCP_PORTFOLIO_CREATE_TOOL_INPUT_SCHEMA.safeParse(validArgs).success);
  for (
    const key of [
      "tenantId",
      "workspaceId",
      "userId",
      "actor",
      "apiClientId",
      "oauthClientId",
      "sourceChannel",
      "requestId",
      "correlationId",
      "payloadHash",
      "portfolioId",
      "organization_id",
      "lifecycle_state",
      "extra",
    ]
  ) {
    assertFalse(
      MCP_PORTFOLIO_CREATE_TOOL_INPUT_SCHEMA.safeParse({
        ...validArgs,
        [key]: "x",
      }).success,
      `unknown field must be rejected: ${key}`,
    );
  }
});

Deno.test("A3: unknown MCP argument reaches invalid_arguments", async () => {
  const { executor, recorder } = buildHarness();
  const result = await executor(
    // deno-lint-ignore no-explicit-any
    { ...validArgs, nope: true } as any,
  );
  assertEquals(result, { ok: false, category: "invalid_arguments" });
  assertEquals(recorder.order.length, 0);
});

// ---------------------------------------------------------------------------
// B. Confirmation
// ---------------------------------------------------------------------------

Deno.test("B1: confirmation false fails confirmation_required before any effect", async () => {
  const { executor, recorder } = buildHarness();
  const result = await executor({ ...validArgs, confirmation: false });
  assertEquals(result, { ok: false, category: "confirmation_required" });
  assertEquals(recorder.order, []);
  assertEquals(recorder.consumeCalls.length, 0);
  assertEquals(recorder.writerCalls.length, 0);
});

Deno.test("B2: non-literal confirmation values are rejected", async () => {
  for (const value of ["true", 1, null, undefined, {}]) {
    const { executor, recorder } = buildHarness();
    // deno-lint-ignore no-explicit-any
    const result = await executor({ ...validArgs, confirmation: value } as any);
    assertFalse(result.ok);
    assertEquals(recorder.writerCalls.length, 0);
  }
});

// ---------------------------------------------------------------------------
// C. Canonical parser
// ---------------------------------------------------------------------------

Deno.test("C1: canonical parser owns trimming and defaults", async () => {
  const { executor, recorder } = buildHarness();
  const result = await executor({ ...validArgs, name: "  Trimmed Name  " });
  assert(result.ok);
  assertEquals(
    recorder.writerCalls[0].body,
    parseApiV1CreatePortfolioBody({
      organizationId: ORGANIZATION_ID,
      name: "Trimmed Name",
    }),
  );
  assertEquals(recorder.writerCalls[0].body.lifecycleState, "opportunity_candidate");
  assertEquals(recorder.writerCalls[0].body.strategicPriority, "medium");
  assertEquals(recorder.writerCalls[0].body.code, null);
  assertEquals(recorder.writerCalls[0].body.description, null);
  assertEquals(recorder.writerCalls[0].body.ownerId, null);
});

Deno.test("C2: invalid business values are rejected as invalid_arguments", async () => {
  const cases = [
    { ...validArgs, organizationId: "not-a-uuid" },
    { ...validArgs, name: "   " },
    { ...validArgs, lifecycleState: "invented_state" },
    { ...validArgs, strategicPriority: "urgent" },
    { ...validArgs, ownerId: "nope" },
  ];
  for (const args of cases) {
    const { executor, recorder } = buildHarness();
    // Deliberately invalid transport/business values.
    // deno-lint-ignore no-explicit-any
    const result = await executor(args as any);
    assertEquals(result, { ok: false, category: "invalid_arguments" });
    assertEquals(recorder.writerCalls.length, 0);
  }
});

Deno.test("C3: no local Portfolio vocabulary or default logic is duplicated", () => {
  for (
    const forbidden of [
      "opportunity_candidate",
      "business_case_approved",
      "launched_commercial",
      "watchlist",
      "critical",
      "medium",
      "btrim",
      "trim(",
      "toLowerCase",
      "uuid",
    ]
  ) {
    assertFalse(
      executableSource.includes(forbidden),
      `must not duplicate: ${forbidden}`,
    );
  }
  assert(executableSource.includes("parseApiV1CreatePortfolioBody"));
});

Deno.test("C4: no client, env, RPC or authority logic exists", () => {
  for (
    const forbidden of [
      "createClient",
      "Deno.env",
      "service_role",
      "SERVICE_ROLE",
      ".rpc(",
      "from(",
      "admin_create_portfolio_item",
      "mcp_v1_create_portfolio",
      "fetch(",
    ]
  ) {
    assertFalse(
      executableSource.includes(forbidden),
      `must not appear: ${forbidden}`,
    );
  }
});

// ---------------------------------------------------------------------------
// D. Canonical mutation context
// ---------------------------------------------------------------------------

Deno.test("D1: canonical body is the hashed payload and the key passes through", async () => {
  const { executor, recorder } = buildHarness();
  const result = await executor(validArgs);
  assert(result.ok);
  const context = recorder.writerCalls[0].context;
  assertEquals(context.idempotencyKey, validArgs.idempotencyKey);
  assertEquals(
    context.payloadHash,
    await hashCanonicalPayload(recorder.writerCalls[0].body),
  );
  assertEquals(context.sourceChannel, "mcp");
  assertEquals(context.delegationMode, "delegated_user");
});

Deno.test("D2: omitted vs explicit canonical values produce identical body and hash", async () => {
  const omitted = buildHarness();
  await omitted.executor(validArgs);
  const explicit = buildHarness();
  await explicit.executor({
    ...validArgs,
    code: null,
    description: null,
    ownerId: null,
    lifecycleState: "opportunity_candidate",
    strategicPriority: "medium",
  });
  assertEquals(
    omitted.recorder.writerCalls[0].body,
    explicit.recorder.writerCalls[0].body,
  );
  assertEquals(
    omitted.recorder.writerCalls[0].context.payloadHash,
    explicit.recorder.writerCalls[0].context.payloadHash,
  );
});

Deno.test("D3: confirmation and idempotency key never enter body or hash", async () => {
  const { executor, recorder } = buildHarness();
  await executor({ ...validArgs, ownerId: OWNER_ID });
  const body = recorder.writerCalls[0].body;
  assertFalse("confirmation" in body);
  assertFalse("idempotencyKey" in body);
  assertEquals(
    recorder.writerCalls[0].context.payloadHash,
    await hashCanonicalPayload(body),
  );
});

Deno.test("D4: invalid idempotency key is invalid_arguments and blocks the writer", async () => {
  const { executor, recorder } = buildHarness();
  const result = await executor({ ...validArgs, idempotencyKey: "  " });
  assertEquals(result, { ok: false, category: "invalid_arguments" });
  assertEquals(recorder.writerCalls.length, 0);
});

// ---------------------------------------------------------------------------
// E. Rate limit
// ---------------------------------------------------------------------------

Deno.test("E1: exact route id and identity, consumed before the writer", async () => {
  const { executor, recorder } = buildHarness();
  await executor(validArgs);
  assertEquals(PORTFOLIO_CREATE_ROUTE.id, "portfolios.create");
  assertEquals(recorder.profileCalls, [{
    clientId: API_CLIENT_ID,
    routeId: "portfolios.create",
  }]);
  const consume = recorder.consumeCalls[0];
  assertEquals(consume.apiClientId ?? consume.key?.apiClientId, API_CLIENT_ID);
  assertEquals(
    consume.userId ?? consume.key?.userId,
    USER_ID,
  );
  assertEquals(
    consume.routeId ?? consume.key?.routeId,
    "portfolios.create",
  );
  assertEquals(recorder.order, ["profile", "rate_limit", "writer"]);
});

Deno.test("E2: rate-limit rejection maps to rate_limited and blocks the writer", async () => {
  const { executor, recorder } = buildHarness(successResult, {
    rateLimitThrows: new ApiHttpError("rate_limit_exceeded"),
  });
  const result = await executor(validArgs);
  assertEquals(result, { ok: false, category: "rate_limited" });
  assertEquals(recorder.writerCalls.length, 0);
});

// ---------------------------------------------------------------------------
// F. Writer
// ---------------------------------------------------------------------------

Deno.test("F1: writer invoked exactly once with the original request", async () => {
  const { executor, recorder, request } = buildHarness();
  await executor(validArgs);
  assertEquals(recorder.writerCalls.length, 1);
  assert(recorder.writerCalls[0].request === request);
});

// ---------------------------------------------------------------------------
// G. Result mapping
// ---------------------------------------------------------------------------

Deno.test("G1: applied and replayed bounded payloads", async () => {
  for (const outcome of ["applied", "replayed"] as const) {
    const { executor } = buildHarness({
      ok: true,
      outcome,
      portfolioId: PORTFOLIO_ID,
    });
    const result = await executor(validArgs);
    assert(result.ok);
    assertEquals(Object.keys(result.payload).sort(), [
      "outcome",
      "portfolioId",
    ]);
    assertEquals(result.payload, { outcome, portfolioId: PORTFOLIO_ID });
  }
});

Deno.test("G2: negative writer outcomes map to bounded categories", async () => {
  const mapping: ReadonlyArray<[string, McpPortfolioCreateToolErrorCategory]> = [
    ["invalid", "invalid_arguments"],
    ["not_authorized", "not_authorized"],
    ["idempotency_conflict", "idempotency_conflict"],
    ["idempotency_pending", "idempotency_pending"],
  ];
  for (const [outcome, category] of mapping) {
    const { executor } = buildHarness({ ok: false, outcome });
    assertEquals(await executor(validArgs), { ok: false, category });
  }
});

Deno.test("G3: unexpected writer failures degrade to unavailable", async () => {
  const { executor } = buildHarness(successResult, {
    writerThrows: new Error("SQLSTATE 42501: policy btpm_admin denied tenant"),
  });
  const result = await executor(validArgs);
  assertEquals(result, { ok: false, category: "unavailable" });
});

Deno.test("G4: ApiHttpError categories are mapped without narrative", async () => {
  const cases: ReadonlyArray<[string, McpPortfolioCreateToolErrorCategory]> = [
    ["not_authorized", "not_authorized"],
    ["invalid_request", "invalid_arguments"],
    ["internal_error", "unavailable"],
  ];
  for (const [code, category] of cases) {
    const { executor } = buildHarness(successResult, {
      // deno-lint-ignore no-explicit-any
      writerThrows: new ApiHttpError(code as any),
    });
    assertEquals(await executor(validArgs), { ok: false, category });
  }
});

Deno.test("G5: bounded error messages disclose no protected narrative", () => {
  const messages = Object.values(MCP_PORTFOLIO_CREATE_TOOL_ERROR_MESSAGES);
  assertEquals(messages.length, 7);
  for (const message of messages) {
    assertFalse(/tenant|sqlstate|policy|token|rls/i.test(message), message);
  }
});

// ---------------------------------------------------------------------------
// H. Control-layer boundary
//
// The temporary Portfolio-9C non-exposure assertions are obsolete:
// API-Q Portfolio-9D exposed `portfolios.create` and wired the runtime.
// Exposure evidence is owned by
// `api-q-portfolio-9d-create-mcp-exposure_test.ts`. What remains durable here
// is that this control layer keeps its own boundaries.
// ---------------------------------------------------------------------------

Deno.test("H1: the control layer imports no Supabase client and no service role", async () => {
  const source = await Deno.readTextFile(
    new URL(
      "../../functions/btpm-mcp/mcp/portfolioCreateMutationTool.ts",
      import.meta.url,
    ),
  );
  for (
    const forbidden of [
      "@supabase/supabase-js",
      "createClient",
      "SUPABASE_SERVICE_ROLE_KEY",
      "SUPABASE_ANON_KEY",
      "Deno.env",
      ".rpc(",
      "mcp_v1_create_portfolio",
      "api_v1_create_portfolio",
    ]
  ) {
    assertFalse(
      source.includes(forbidden),
      `control layer must not reference ${forbidden}`,
    );
  }
});

Deno.test("H2: the control layer registers no MCP tool itself", async () => {
  const source = await Deno.readTextFile(
    new URL(
      "../../functions/btpm-mcp/mcp/portfolioCreateMutationTool.ts",
      import.meta.url,
    ),
  );
  assertFalse(source.includes("registerTool"));
  assertFalse(source.includes("MCP_TOOL_REGISTRY"));
  assertFalse(source.includes("createBtpmMcpServer"));
});

