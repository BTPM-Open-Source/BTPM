// API-Q Portfolio-10C — focused guard for the Portfolio-update MCP mutation
// control composition. Behavioural (in-process fakes) + static source guards.
// No network, no database, no Edge invocation, no service-role key.
//
// Scope: control/composition only. Exposure and runtime wiring remain closed.

import {
  assert,
  assertEquals,
  assertFalse,
  assertNotEquals,
  assertStrictEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  createMcpPortfolioUpdateToolExecutor,
  MCP_PORTFOLIO_UPDATE_OPTIONAL_BUSINESS_FIELDS,
  MCP_PORTFOLIO_UPDATE_TOOL_ARGUMENT_NAMES,
  MCP_PORTFOLIO_UPDATE_TOOL_ERROR_MESSAGES,
  MCP_PORTFOLIO_UPDATE_TOOL_INPUT_SCHEMA,
  MCP_PORTFOLIO_UPDATE_TOOL_NAME,
  type McpPortfolioUpdateToolErrorCategory,
} from "../../functions/btpm-mcp/mcp/portfolioUpdateMutationTool.ts";
import { hashCanonicalPayload } from "../../functions/_shared/btpm-api/idempotency.ts";
import {
  buildApiV1UpdatePortfolioIdempotencyPayload,
  parseApiV1UpdatePortfolioBody,
  PORTFOLIO_UPDATE_ROUTE,
} from "../../functions/_shared/btpm-api/routes/portfolios.ts";
import { ApiHttpError } from "../../functions/_shared/btpm-api/http.ts";

const TOOL_URL = new URL(
  "../../functions/btpm-mcp/mcp/portfolioUpdateMutationTool.ts",
  import.meta.url,
);
const toolSource = await Deno.readTextFile(TOOL_URL);

/** Executable production code only: line and block comments removed. */
const executableSource = toolSource
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .filter((line) => !line.trim().startsWith("//"))
  .join("\n");

const registrySource = await Deno.readTextFile(
  new URL("../../functions/btpm-mcp/mcp/toolRegistry.ts", import.meta.url),
);

const PORTFOLIO_ID = "55555555-5555-4555-8555-555555555555";
const OWNER_ID = "22222222-2222-4222-8222-222222222222";
const API_CLIENT_ID = "44444444-4444-4444-8444-444444444444";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const EXPECTED_UPDATED_AT = "2026-08-18T10:11:12.123456Z";

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
  portfolioId: PORTFOLIO_ID,
  expectedUpdatedAt: EXPECTED_UPDATED_AT,
  name: "Oncology Portfolio",
  confirmation: true,
  idempotencyKey: "idem-key-portfolio-update",
});

const successResult = Object.freeze({
  ok: true,
  outcome: "applied",
  portfolioId: PORTFOLIO_ID,
  updatedAt: "2026-08-18T12:00:00.000000Z",
});

interface Recorder {
  readonly profileCalls: Array<{ clientId: string; routeId: string }>;
  // deno-lint-ignore no-explicit-any
  readonly consumeCalls: any[];
  readonly writerCalls: Array<{
    request: Request;
    portfolioId: string;
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

  const executor = createMcpPortfolioUpdateToolExecutor({
    request,
    execution: trustedExecution,
    writer: (async (
      req: Request,
      portfolioId: string,
      // deno-lint-ignore no-explicit-any
      body: any,
      // deno-lint-ignore no-explicit-any
      context: any,
    ) => {
      recorder.order.push("writer");
      recorder.writerCalls.push({ request: req, portfolioId, body, context });
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

Deno.test("A1: tool name and the exact ten argument names", () => {
  assertEquals(MCP_PORTFOLIO_UPDATE_TOOL_NAME, "btpm_update_portfolio");
  assertEquals([...MCP_PORTFOLIO_UPDATE_TOOL_ARGUMENT_NAMES], [
    "portfolioId",
    "expectedUpdatedAt",
    "name",
    "code",
    "description",
    "lifecycleState",
    "strategicPriority",
    "ownerId",
    "confirmation",
    "idempotencyKey",
  ]);
  assertEquals(MCP_PORTFOLIO_UPDATE_TOOL_ARGUMENT_NAMES.length, 10);
  assertEquals(
    Object.keys(MCP_PORTFOLIO_UPDATE_TOOL_INPUT_SCHEMA.shape).sort(),
    [...MCP_PORTFOLIO_UPDATE_TOOL_ARGUMENT_NAMES].sort(),
  );
  assertEquals([...MCP_PORTFOLIO_UPDATE_OPTIONAL_BUSINESS_FIELDS], [
    "name",
    "code",
    "description",
    "lifecycleState",
    "strategicPriority",
    "ownerId",
  ]);
});

Deno.test("A2: the schema is strict and rejects unknown / provenance / set-flag fields", () => {
  assert(MCP_PORTFOLIO_UPDATE_TOOL_INPUT_SCHEMA.safeParse(validArgs).success);
  for (
    const key of [
      "setName",
      "setCode",
      "setDescription",
      "setLifecycleState",
      "setStrategicPriority",
      "setOwnerId",
      "organizationId",
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
      "isArchived",
      "expected_updated_at",
      "extra",
    ]
  ) {
    assertFalse(
      MCP_PORTFOLIO_UPDATE_TOOL_INPUT_SCHEMA.safeParse({
        ...validArgs,
        // deno-lint-ignore no-explicit-any
        [key]: "x" as any,
      }).success,
      `unknown field must be rejected: ${key}`,
    );
  }
});

Deno.test("A3: unknown MCP argument reaches invalid_arguments with no effect", async () => {
  const { executor, recorder } = buildHarness();
  // deno-lint-ignore no-explicit-any
  const result = await executor({ ...validArgs, nope: true } as any);
  assertEquals(result, { ok: false, category: "invalid_arguments" });
  assertEquals(recorder.order.length, 0);
});

Deno.test("A4: no duplicated business rules (vocabulary, UUID, timestamp)", () => {
  for (
    const forbidden of [
      "opportunity_candidate",
      "business_case_approved",
      "launched_commercial",
      "watchlist",
      "critical",
      "trim(",
      "toLowerCase",
      "uuid",
      "setName",
      "setCode",
      "setDescription",
      "setLifecycleState",
      "setStrategicPriority",
      "setOwnerId",
      "\\d{4}",
      "Date.UTC",
    ]
  ) {
    assertFalse(
      executableSource.includes(forbidden),
      `must not duplicate: ${forbidden}`,
    );
  }
  assert(executableSource.includes("parseApiV1UpdatePortfolioBody"));
  assert(executableSource.includes("parseApiV1PortfolioUpdatePath"));
});

// ---------------------------------------------------------------------------
// B. Confirmation
// ---------------------------------------------------------------------------

Deno.test("B1: confirmation false fails confirmation_required before any effect", async () => {
  const { executor, recorder } = buildHarness();
  const result = await executor({ ...validArgs, confirmation: false });
  assertEquals(result, { ok: false, category: "confirmation_required" });
  assertEquals(recorder.order, []);
  assertEquals(recorder.profileCalls.length, 0);
  assertEquals(recorder.consumeCalls.length, 0);
  assertEquals(recorder.writerCalls.length, 0);
});

Deno.test("B2: non-literal confirmation values are rejected", async () => {
  for (const value of ["true", 1, 0, null, undefined, {}]) {
    const { executor, recorder } = buildHarness();
    // deno-lint-ignore no-explicit-any
    const result = await executor({ ...validArgs, confirmation: value } as any);
    assertFalse(result.ok);
    assertEquals(recorder.writerCalls.length, 0);
  }
});

Deno.test("B3: confirmation never enters the canonical body or the hash", async () => {
  const { executor, recorder } = buildHarness();
  const result = await executor(validArgs);
  assert(result.ok);
  const body = recorder.writerCalls[0].body;
  assertFalse(Object.prototype.hasOwnProperty.call(body, "confirmation"));
  assertFalse(Object.prototype.hasOwnProperty.call(body, "idempotencyKey"));
  const expectedHash = await hashCanonicalPayload(
    buildApiV1UpdatePortfolioIdempotencyPayload(
      PORTFOLIO_ID,
      parseApiV1UpdatePortfolioBody({
        expectedUpdatedAt: EXPECTED_UPDATED_AT,
        name: "Oncology Portfolio",
      }),
    ),
  );
  assertEquals(recorder.writerCalls[0].context.payloadHash, expectedHash);
});

// ---------------------------------------------------------------------------
// C. Canonical identity and body
// ---------------------------------------------------------------------------

Deno.test("C1: malformed / nil Portfolio identity is invalid_arguments", async () => {
  for (
    const portfolioId of [
      "not-a-uuid",
      NIL_UUID,
      `${PORTFOLIO_ID}/`,
      `${PORTFOLIO_ID}/projects`,
      ` ${PORTFOLIO_ID}`,
      "",
    ]
  ) {
    const { executor, recorder } = buildHarness();
    const result = await executor({ ...validArgs, portfolioId });
    assertEquals(result, { ok: false, category: "invalid_arguments" });
    assertEquals(recorder.writerCalls.length, 0);
  }
});

Deno.test("C2: omitted optional fields stay absent and set flags stay false", async () => {
  const { executor, recorder } = buildHarness();
  const result = await executor(validArgs);
  assert(result.ok);
  const body = recorder.writerCalls[0].body;
  assertEquals(
    body,
    parseApiV1UpdatePortfolioBody({
      expectedUpdatedAt: EXPECTED_UPDATED_AT,
      name: "Oncology Portfolio",
    }),
  );
  assertEquals(body.setName, true);
  assertEquals(body.setCode, false);
  assertEquals(body.setDescription, false);
  assertEquals(body.setLifecycleState, false);
  assertEquals(body.setStrategicPriority, false);
  assertEquals(body.setOwnerId, false);
  assertEquals(body.expectedUpdatedAt, EXPECTED_UPDATED_AT);
});

Deno.test("C3: explicit null on clearable fields becomes an explicit clear", async () => {
  const { executor, recorder } = buildHarness();
  const result = await executor({
    portfolioId: PORTFOLIO_ID,
    expectedUpdatedAt: EXPECTED_UPDATED_AT,
    code: null,
    description: null,
    ownerId: null,
    confirmation: true,
    idempotencyKey: "idem-clear",
  });
  assert(result.ok);
  const body = recorder.writerCalls[0].body;
  assertEquals(body.setCode, true);
  assertEquals(body.code, null);
  assertEquals(body.setDescription, true);
  assertEquals(body.description, null);
  assertEquals(body.setOwnerId, true);
  assertEquals(body.ownerId, null);
  assertEquals(body.setName, false);
});

Deno.test("C4: explicit undefined is treated as absence", async () => {
  const { executor, recorder } = buildHarness();
  const result = await executor({
    ...validArgs,
    code: undefined,
    description: undefined,
    ownerId: undefined,
  });
  assert(result.ok);
  const body = recorder.writerCalls[0].body;
  assertEquals(body.setCode, false);
  assertEquals(body.setDescription, false);
  assertEquals(body.setOwnerId, false);
});

Deno.test("C5: canonical parser owns all six set flags and every business rule", async () => {
  const { executor, recorder } = buildHarness();
  const result = await executor({
    portfolioId: PORTFOLIO_ID,
    expectedUpdatedAt: EXPECTED_UPDATED_AT,
    name: "  Trimmed  ",
    code: "PF-1",
    description: "d",
    lifecycleState: "development",
    strategicPriority: "high",
    ownerId: OWNER_ID,
    confirmation: true,
    idempotencyKey: "idem-full",
  });
  assert(result.ok);
  assertEquals(
    recorder.writerCalls[0].body,
    parseApiV1UpdatePortfolioBody({
      expectedUpdatedAt: EXPECTED_UPDATED_AT,
      name: "  Trimmed  ",
      code: "PF-1",
      description: "d",
      lifecycleState: "development",
      strategicPriority: "high",
      ownerId: OWNER_ID,
    }),
  );
});

Deno.test("C6: invalid business values are invalid_arguments and never reach the writer", async () => {
  const cases = [
    { ...validArgs, name: "   " },
    // deno-lint-ignore no-explicit-any
    { ...validArgs, name: null as any },
    { ...validArgs, lifecycleState: "invented_state" },
    { ...validArgs, strategicPriority: "urgent" },
    { ...validArgs, ownerId: "nope" },
    { ...validArgs, expectedUpdatedAt: "2026-08-18" },
    {
      portfolioId: PORTFOLIO_ID,
      expectedUpdatedAt: EXPECTED_UPDATED_AT,
      confirmation: true,
      idempotencyKey: "idem-empty",
    },
  ];
  for (const args of cases) {
    const { executor, recorder } = buildHarness();
    // deno-lint-ignore no-explicit-any
    const result = await executor(args as any);
    assertEquals(result, { ok: false, category: "invalid_arguments" });
    assertEquals(recorder.writerCalls.length, 0);
  }
});

// ---------------------------------------------------------------------------
// D. Canonical idempotency payload and hash
// ---------------------------------------------------------------------------

Deno.test("D1: canonical Portfolio-update payload is the hashed payload", async () => {
  const { executor, recorder } = buildHarness();
  const result = await executor(validArgs);
  assert(result.ok);
  const context = recorder.writerCalls[0].context;
  assertEquals(context.idempotencyKey, validArgs.idempotencyKey);
  const canonicalPayload = buildApiV1UpdatePortfolioIdempotencyPayload(
    PORTFOLIO_ID,
    parseApiV1UpdatePortfolioBody({
      expectedUpdatedAt: EXPECTED_UPDATED_AT,
      name: "Oncology Portfolio",
    }),
  );
  assertEquals(Object.keys(canonicalPayload).sort(), [
    "code",
    "description",
    "expectedUpdatedAt",
    "lifecycleState",
    "name",
    "ownerId",
    "portfolioId",
    "setCode",
    "setDescription",
    "setLifecycleState",
    "setName",
    "setOwnerId",
    "setStrategicPriority",
    "strategicPriority",
  ]);
  assertEquals(
    context.payloadHash,
    await hashCanonicalPayload(canonicalPayload),
  );
  assertEquals(context.sourceChannel, "mcp");
  assertEquals(context.delegationMode, "delegated_user");
  assertEquals(context.executingUserId, USER_ID);
  assertEquals(context.apiClientId, API_CLIENT_ID);
});

Deno.test("D2: omitted versus explicit clear hash differently", async () => {
  const omitted = buildHarness();
  assert(
    (await omitted.executor({
      portfolioId: PORTFOLIO_ID,
      expectedUpdatedAt: EXPECTED_UPDATED_AT,
      name: "N",
      confirmation: true,
      idempotencyKey: "k1",
    })).ok,
  );
  const cleared = buildHarness();
  assert(
    (await cleared.executor({
      portfolioId: PORTFOLIO_ID,
      expectedUpdatedAt: EXPECTED_UPDATED_AT,
      name: "N",
      code: null,
      confirmation: true,
      idempotencyKey: "k1",
    })).ok,
  );
  assertNotEquals(
    omitted.recorder.writerCalls[0].context.payloadHash,
    cleared.recorder.writerCalls[0].context.payloadHash,
  );
});

Deno.test("D3: semantically identical canonical updates hash identically", async () => {
  const a = buildHarness();
  assert((await a.executor(validArgs)).ok);
  const b = buildHarness();
  assert(
    (await b.executor({
      ...validArgs,
      name: "  Oncology Portfolio  ",
      idempotencyKey: "another-key",
    })).ok,
  );
  assertEquals(
    a.recorder.writerCalls[0].context.payloadHash,
    b.recorder.writerCalls[0].context.payloadHash,
  );
});

Deno.test("D4: no identity, client or provenance value is hashed", async () => {
  const { executor, recorder } = buildHarness();
  assert((await executor(validArgs)).ok);
  const serialized = JSON.stringify(
    buildApiV1UpdatePortfolioIdempotencyPayload(
      PORTFOLIO_ID,
      recorder.writerCalls[0].body,
    ),
  );
  for (const secret of [USER_ID, API_CLIENT_ID, "oauth-1", "req-1", "mcp"]) {
    assertFalse(serialized.includes(secret), `must not be hashed: ${secret}`);
  }
});

// ---------------------------------------------------------------------------
// E. Rate limiting
// ---------------------------------------------------------------------------

Deno.test("E1: exact route, identity and profile→consume→writer ordering", async () => {
  const { executor, recorder } = buildHarness();
  assert((await executor(validArgs)).ok);
  assertEquals(PORTFOLIO_UPDATE_ROUTE.id, "portfolios.update");
  assertEquals(recorder.profileCalls, [{
    clientId: API_CLIENT_ID,
    routeId: "portfolios.update",
  }]);
  assertEquals(recorder.consumeCalls[0].apiClientId, API_CLIENT_ID);
  assertEquals(recorder.consumeCalls[0].userId, USER_ID);
  assertEquals(recorder.consumeCalls[0].routeId, "portfolios.update");
  assertEquals(recorder.order, ["profile", "rate_limit", "writer"]);
});

Deno.test("E2: rate-limit rejection prevents the writer", async () => {
  const { executor, recorder } = buildHarness(successResult, {
    rateLimitThrows: new ApiHttpError("rate_limit_exceeded"),
  });
  const result = await executor(validArgs);
  assertEquals(result, { ok: false, category: "rate_limited" });
  assertEquals(recorder.writerCalls.length, 0);
});

// ---------------------------------------------------------------------------
// F. Writer invocation
// ---------------------------------------------------------------------------

Deno.test("F1: writer invoked exactly once with original request, canonical id, body and context", async () => {
  const { executor, recorder, request } = buildHarness();
  assert((await executor(validArgs)).ok);
  assertEquals(recorder.writerCalls.length, 1);
  assertStrictEquals(recorder.writerCalls[0].request, request);
  assertEquals(recorder.writerCalls[0].portfolioId, PORTFOLIO_ID);
  assertEquals(
    recorder.writerCalls[0].body.expectedUpdatedAt,
    EXPECTED_UPDATED_AT,
  );
  assert(typeof recorder.writerCalls[0].context.payloadHash === "string");
  assertEquals(
    recorder.order.filter((entry) => entry === "writer").length,
    1,
  );
});

Deno.test("F2: a stale conflict is never retried or refreshed", async () => {
  const { executor, recorder } = buildHarness({
    ok: false,
    outcome: "conflict",
    code: "stale_portfolio",
  });
  const result = await executor(validArgs);
  assertEquals(result, { ok: false, category: "stale_portfolio" });
  assertEquals(recorder.writerCalls.length, 1);
  for (
    const forbidden of ["currentUpdatedAt", "current_updated_at", "retry("]
  ) {
    assertFalse(executableSource.includes(forbidden));
  }
});

// ---------------------------------------------------------------------------
// G. Results and bounded errors
// ---------------------------------------------------------------------------

Deno.test("G1: applied and replayed are bounded successes", async () => {
  for (const outcome of ["applied", "replayed"] as const) {
    const { executor } = buildHarness({ ...successResult, outcome });
    const result = await executor(validArgs);
    assert(result.ok);
    assertEquals(Object.keys(result.payload).sort(), [
      "outcome",
      "portfolioId",
      "updatedAt",
    ]);
    assertEquals(result.payload.outcome, outcome);
    assertEquals(result.payload.portfolioId, PORTFOLIO_ID);
    assertEquals(result.payload.updatedAt, successResult.updatedAt);
  }
});

Deno.test("G2: negative writer outcomes map to the exact bounded categories", async () => {
  const cases: ReadonlyArray<[string, McpPortfolioUpdateToolErrorCategory]> = [
    ["invalid", "invalid_arguments"],
    ["not_authorized", "not_authorized"],
    ["idempotency_conflict", "idempotency_conflict"],
    ["idempotency_pending", "idempotency_pending"],
  ];
  for (const [outcome, category] of cases) {
    const { executor } = buildHarness({ ok: false, outcome });
    assertEquals(await executor(validArgs), { ok: false, category });
  }
});

Deno.test("G3: malformed or internal writer failures degrade to unavailable", async () => {
  const malformed = buildHarness({ ok: false, outcome: "who_knows" });
  assertEquals(await malformed.executor(validArgs), {
    ok: false,
    category: "unavailable",
  });
  const thrown = buildHarness(successResult, {
    writerThrows: new ApiHttpError("internal_error", new Error("SQLSTATE 42501")),
  });
  assertEquals(await thrown.executor(validArgs), {
    ok: false,
    category: "unavailable",
  });
});

Deno.test("G4: bounded messages disclose no protected narrative", () => {
  assertEquals(Object.keys(MCP_PORTFOLIO_UPDATE_TOOL_ERROR_MESSAGES).sort(), [
    "confirmation_required",
    "idempotency_conflict",
    "idempotency_pending",
    "invalid_arguments",
    "not_authorized",
    "rate_limited",
    "stale_portfolio",
    "unavailable",
  ]);
  const messages = Object.values(MCP_PORTFOLIO_UPDATE_TOOL_ERROR_MESSAGES)
    .join(" ");
  for (
    const forbidden of [
      "SQLSTATE",
      "mcp_v1_update_portfolio",
      "admin_update_portfolio_item",
      "policy",
      "token",
      "row-level",
    ]
  ) {
    assertFalse(messages.includes(forbidden), `must not disclose: ${forbidden}`);
  }
  assert(
    MCP_PORTFOLIO_UPDATE_TOOL_ERROR_MESSAGES.stale_portfolio.includes(
      "expectedUpdatedAt",
    ),
  );
});

// ---------------------------------------------------------------------------
// H. Security boundaries
// ---------------------------------------------------------------------------

Deno.test("H1: no client, env, RPC, table or authority logic exists", () => {
  for (
    const forbidden of [
      "createClient",
      "Deno.env",
      "service_role",
      "SERVICE_ROLE",
      ".rpc(",
      "from(",
      "fetch(",
      "mcp_v1_update_portfolio",
      "api_v1_update_portfolio",
      "admin_update_portfolio_item",
      "updateApiV1Portfolio",
      "has_role",
      "encrypt",
      "decrypt",
      "capability",
    ]
  ) {
    assertFalse(
      executableSource.includes(forbidden),
      `must not appear: ${forbidden}`,
    );
  }
});

// ---------------------------------------------------------------------------
// I. Durable control-layer boundary
//
// API-Q Portfolio-10D exposed `portfolios.update` and wired it into the MCP
// runtime, so the temporary non-exposure assertions of Portfolio-10C are
// intentionally obsolete. What remains durable is that this module is a
// CONTROL/COMPOSITION layer only: it never registers MCP tools, never builds
// a server or Supabase client, and never touches the database wrapper.
// ---------------------------------------------------------------------------

Deno.test("I1: the control layer registers no MCP tool and builds no server", () => {
  for (
    const forbidden of [
      "registerTool",
      "createBtpmMcpServer",
      "serverFactory",
      "McpServer",
      "tools/list",
      "MCP_TOOL_REGISTRY",
      "BTPM_MCP_MUTATION_TOOL_ANNOTATIONS",
    ]
  ) {
    assertFalse(
      executableSource.includes(forbidden),
      `control layer must not contain: ${forbidden}`,
    );
  }
});

Deno.test("I2: the control layer constructs no runtime or Supabase client", () => {
  for (
    const forbidden of [
      "createClient",
      "supabaseAnonKey",
      "SUPABASE_URL",
      "SUPABASE_ANON_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "Deno.env",
      "createBtpmMcpRuntime",
      "createMcpV1UpdatePortfolioExecutor",
    ]
  ) {
    assertFalse(
      executableSource.includes(forbidden),
      `control layer must not contain: ${forbidden}`,
    );
  }
});

Deno.test("I3: the control layer never calls the database wrapper directly", () => {
  for (
    const forbidden of [
      "mcp_v1_update_portfolio",
      "api_v1_update_portfolio",
      "admin_update_portfolio_item",
      "updateMcpV1Portfolio",
      "updateApiV1Portfolio",
      ".rpc(",
      ".from(",
    ]
  ) {
    assertFalse(
      executableSource.includes(forbidden),
      `control layer must not contain: ${forbidden}`,
    );
  }
});

Deno.test("I4: the canonical registry entry keeps its accepted metadata", () => {
  const entry = registrySource.slice(
    registrySource.indexOf('"portfolios.update"'),
  ).slice(0, 700);
  assert(entry.includes('toolName: "btpm_update_portfolio"'));
  assert(entry.includes('operationClass: "mutation"'));
  assert(entry.includes('confirmation: "required"'));
  assert(entry.includes('resultShape: "single_object"'));
  assert(entry.includes('concurrencyToken: "required"'));
});
