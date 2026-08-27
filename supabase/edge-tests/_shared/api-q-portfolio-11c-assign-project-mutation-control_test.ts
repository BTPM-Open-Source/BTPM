// API-Q Portfolio-11C — focused guard for the Project↔Portfolio assignment MCP
// mutation-control composition. Behavioural (in-process fakes) + static source
// guards. No network, no database, no Edge invocation, no service-role key.
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
  createMcpPortfolioAssignProjectToolExecutor,
  MCP_PORTFOLIO_ASSIGN_PROJECT_TOOL_ARGUMENT_NAMES,
  MCP_PORTFOLIO_ASSIGN_PROJECT_TOOL_ERROR_MESSAGES,
  MCP_PORTFOLIO_ASSIGN_PROJECT_TOOL_INPUT_SCHEMA,
  MCP_PORTFOLIO_ASSIGN_PROJECT_TOOL_NAME,
  type McpPortfolioAssignProjectToolErrorCategory,
} from "../../functions/btpm-mcp/mcp/portfolioAssignmentMutationTool.ts";
import { hashCanonicalPayload } from "../../functions/_shared/btpm-api/idempotency.ts";
import {
  buildApiV1AssignProjectPortfolioIdempotencyPayload,
  parseApiV1AssignProjectPortfolioBody,
  PORTFOLIO_ASSIGN_PROJECT_ROUTE,
} from "../../functions/_shared/btpm-api/routes/portfolios.ts";
import { ApiHttpError } from "../../functions/_shared/btpm-api/http.ts";

const TOOL_URL = new URL(
  "../../functions/btpm-mcp/mcp/portfolioAssignmentMutationTool.ts",
  import.meta.url,
);
const toolSource = await Deno.readTextFile(TOOL_URL);

/** Executable production code only: line and block comments removed. */
const executableSource = toolSource
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .filter((line) => !line.trim().startsWith("//"))
  .join("\n");




const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const PORTFOLIO_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_PORTFOLIO_ID = "33333333-3333-4333-8333-333333333333";
const API_CLIENT_ID = "44444444-4444-4444-8444-444444444444";
const USER_ID = "55555555-5555-4555-8555-555555555555";
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

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
  projectId: PROJECT_ID,
  portfolioId: PORTFOLIO_ID,
  confirmation: true,
  idempotencyKey: "idem-key-assign-project-portfolio",
});

const successResult = Object.freeze({
  ok: true,
  outcome: "applied",
  projectId: PROJECT_ID,
  oldPortfolioId: OTHER_PORTFOLIO_ID,
  newPortfolioId: PORTFOLIO_ID,
});

interface Recorder {
  readonly profileCalls: Array<{ clientId: string; routeId: string }>;
  // deno-lint-ignore no-explicit-any
  readonly consumeCalls: any[];
  readonly writerCalls: Array<{
    request: Request;
    projectId: string;
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

  const executor = createMcpPortfolioAssignProjectToolExecutor({
    request,
    execution: trustedExecution,
    writer: (async (
      req: Request,
      projectId: string,
      // deno-lint-ignore no-explicit-any
      body: any,
      // deno-lint-ignore no-explicit-any
      context: any,
    ) => {
      recorder.order.push("writer");
      recorder.writerCalls.push({ request: req, projectId, body, context });
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
// A. Tool contract
// ---------------------------------------------------------------------------

Deno.test("A1: exact tool name and exactly four argument names", () => {
  assertEquals(
    MCP_PORTFOLIO_ASSIGN_PROJECT_TOOL_NAME,
    "btpm_assign_project_portfolio",
  );
  assertEquals([...MCP_PORTFOLIO_ASSIGN_PROJECT_TOOL_ARGUMENT_NAMES], [
    "projectId",
    "portfolioId",
    "confirmation",
    "idempotencyKey",
  ]);
  assertEquals(MCP_PORTFOLIO_ASSIGN_PROJECT_TOOL_ARGUMENT_NAMES.length, 4);
  assertEquals(
    Object.keys(MCP_PORTFOLIO_ASSIGN_PROJECT_TOOL_INPUT_SCHEMA.shape).sort(),
    [...MCP_PORTFOLIO_ASSIGN_PROJECT_TOOL_ARGUMENT_NAMES].sort(),
  );
  assert(executableSource.includes("z.strictObject("));
});

Deno.test("A2: portfolioId is required but nullable", () => {
  assert(
    MCP_PORTFOLIO_ASSIGN_PROJECT_TOOL_INPUT_SCHEMA.safeParse(validArgs).success,
  );
  assert(
    MCP_PORTFOLIO_ASSIGN_PROJECT_TOOL_INPUT_SCHEMA.safeParse({
      ...validArgs,
      portfolioId: null,
    }).success,
  );
  assertFalse(
    MCP_PORTFOLIO_ASSIGN_PROJECT_TOOL_INPUT_SCHEMA.safeParse({
      projectId: PROJECT_ID,
      confirmation: true,
      idempotencyKey: "k",
    }).success,
  );
  assertFalse(
    MCP_PORTFOLIO_ASSIGN_PROJECT_TOOL_INPUT_SCHEMA.safeParse({
      ...validArgs,
      portfolioId: undefined,
    }).success,
  );
});

Deno.test("A3: unknown / snake_case / provenance / concurrency fields are rejected", () => {
  for (
    const key of [
      "organizationId",
      "workspaceId",
      "tenantId",
      "portfolio_item_id",
      "project_id",
      "expectedUpdatedAt",
      "sourceChannel",
      "apiClientId",
      "oauthClientId",
      "requestId",
      "correlationId",
      "payloadHash",
      "setPortfolioId",
      "operationId",
      "functionName",
      "extra",
    ]
  ) {
    assertFalse(
      MCP_PORTFOLIO_ASSIGN_PROJECT_TOOL_INPUT_SCHEMA.safeParse({
        ...validArgs,
        // deno-lint-ignore no-explicit-any
        [key]: "x" as any,
      }).success,
      `unknown field must be rejected: ${key}`,
    );
  }
});

Deno.test("A4: unknown MCP argument reaches invalid_arguments with no effect", async () => {
  const { executor, recorder } = buildHarness();
  // deno-lint-ignore no-explicit-any
  const result = await executor({ ...validArgs, nope: true } as any);
  assertEquals(result, { ok: false, category: "invalid_arguments" });
  assertEquals(recorder.order.length, 0);
});

Deno.test("A5: no duplicated UUID or business rules in the control layer", () => {
  for (
    const forbidden of [
      "uuid",
      "UUID_REGEX",
      "[0-9a-f]{8}",
      "00000000-0000",
      "trim(",
      "toLowerCase",
      "expectedUpdatedAt",
      "retry(",
    ]
  ) {
    assertFalse(
      executableSource.includes(forbidden),
      `must not duplicate: ${forbidden}`,
    );
  }
  assert(executableSource.includes("parseApiV1PortfolioAssignProjectPath"));
  assert(executableSource.includes("parseApiV1AssignProjectPortfolioBody"));
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

Deno.test("B2: non-literal confirmation values are rejected with no writer call", async () => {
  for (const value of ["true", "TRUE", 1, 0, null, undefined, {}]) {
    const { executor, recorder } = buildHarness();
    // deno-lint-ignore no-explicit-any
    const result = await executor({ ...validArgs, confirmation: value } as any);
    assertFalse(result.ok);
    assertEquals(recorder.writerCalls.length, 0);
    assertEquals(recorder.profileCalls.length, 0);
    assertEquals(recorder.consumeCalls.length, 0);
  }
});

Deno.test("B3: confirmation never enters the canonical body or the hash", async () => {
  const { executor, recorder } = buildHarness();
  const result = await executor(validArgs);
  assert(result.ok);
  const body = recorder.writerCalls[0].body;
  assertEquals(Object.keys(body), ["portfolioId"]);
  assertFalse(Object.prototype.hasOwnProperty.call(body, "confirmation"));
  assertFalse(Object.prototype.hasOwnProperty.call(body, "idempotencyKey"));
  const expectedHash = await hashCanonicalPayload(
    buildApiV1AssignProjectPortfolioIdempotencyPayload(
      PROJECT_ID,
      parseApiV1AssignProjectPortfolioBody({ portfolioId: PORTFOLIO_ID }),
    ),
  );
  assertEquals(recorder.writerCalls[0].context.payloadHash, expectedHash);
});

// ---------------------------------------------------------------------------
// C. Canonical Project identity
// ---------------------------------------------------------------------------

Deno.test("C1: malformed / nil Project identity is invalid_arguments", async () => {
  for (
    const projectId of [
      "not-a-uuid",
      NIL_UUID,
      `${PROJECT_ID}/`,
      `${PROJECT_ID}/phases`,
      ` ${PROJECT_ID}`,
      "",
    ]
  ) {
    const { executor, recorder } = buildHarness();
    const result = await executor({ ...validArgs, projectId });
    assertEquals(result, { ok: false, category: "invalid_arguments" });
    assertEquals(recorder.writerCalls.length, 0);
  }
});

// ---------------------------------------------------------------------------
// D. Canonical assignment body
// ---------------------------------------------------------------------------

Deno.test("D1: UUID assignment is preserved through the canonical parser", async () => {
  const { executor, recorder } = buildHarness();
  assert((await executor(validArgs)).ok);
  assertEquals(
    recorder.writerCalls[0].body,
    parseApiV1AssignProjectPortfolioBody({ portfolioId: PORTFOLIO_ID }),
  );
});

Deno.test("D2: explicit null clear is preserved exactly", async () => {
  const { executor, recorder } = buildHarness({
    ...successResult,
    outcome: "applied",
    oldPortfolioId: PORTFOLIO_ID,
    newPortfolioId: null,
  });
  const result = await executor({ ...validArgs, portfolioId: null });
  assert(result.ok);
  const body = recorder.writerCalls[0].body;
  assert(Object.prototype.hasOwnProperty.call(body, "portfolioId"));
  assertStrictEquals(body.portfolioId, null);
  assertEquals(result.payload.newPortfolioId, null);
  assertEquals(result.payload.oldPortfolioId, PORTFOLIO_ID);
});

Deno.test("D3: invalid Portfolio identity is invalid_arguments", async () => {
  for (const portfolioId of ["nope", NIL_UUID, ` ${PORTFOLIO_ID}`, ""]) {
    const { executor, recorder } = buildHarness();
    const result = await executor({ ...validArgs, portfolioId });
    assertEquals(result, { ok: false, category: "invalid_arguments" });
    assertEquals(recorder.writerCalls.length, 0);
  }
});

// ---------------------------------------------------------------------------
// E. Canonical idempotency payload and hash
// ---------------------------------------------------------------------------

Deno.test("E1: hashed payload is exactly projectId + portfolioId", async () => {
  const { executor, recorder } = buildHarness();
  assert((await executor(validArgs)).ok);
  const context = recorder.writerCalls[0].context;
  assertEquals(context.idempotencyKey, validArgs.idempotencyKey);
  const canonicalPayload = buildApiV1AssignProjectPortfolioIdempotencyPayload(
    PROJECT_ID,
    parseApiV1AssignProjectPortfolioBody({ portfolioId: PORTFOLIO_ID }),
  );
  assertEquals(Object.keys(canonicalPayload).sort(), [
    "portfolioId",
    "projectId",
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

Deno.test("E2: assignment and clear hash differently", async () => {
  const assigned = buildHarness();
  assert((await assigned.executor(validArgs)).ok);
  const cleared = buildHarness();
  assert((await cleared.executor({ ...validArgs, portfolioId: null })).ok);
  assertNotEquals(
    assigned.recorder.writerCalls[0].context.payloadHash,
    cleared.recorder.writerCalls[0].context.payloadHash,
  );
});

Deno.test("E3: semantically identical requests hash identically", async () => {
  const a = buildHarness();
  assert((await a.executor(validArgs)).ok);
  const b = buildHarness();
  assert(
    (await b.executor({ ...validArgs, idempotencyKey: "another-key" })).ok,
  );
  assertEquals(
    a.recorder.writerCalls[0].context.payloadHash,
    b.recorder.writerCalls[0].context.payloadHash,
  );
});

Deno.test("E4: no confirmation, key, identity or provenance value is hashed", async () => {
  const { executor, recorder } = buildHarness();
  assert((await executor(validArgs)).ok);
  const serialized = JSON.stringify(
    buildApiV1AssignProjectPortfolioIdempotencyPayload(
      PROJECT_ID,
      recorder.writerCalls[0].body,
    ),
  );
  for (
    const secret of [
      USER_ID,
      API_CLIENT_ID,
      "oauth-1",
      "req-1",
      "mcp",
      "confirmation",
      validArgs.idempotencyKey,
    ]
  ) {
    assertFalse(serialized.includes(secret), `must not be hashed: ${secret}`);
  }
});

// ---------------------------------------------------------------------------
// F. Rate limiting
// ---------------------------------------------------------------------------

Deno.test("F1: exact route, identity and profile→consume→writer ordering", async () => {
  const { executor, recorder } = buildHarness();
  assert((await executor(validArgs)).ok);
  assertEquals(
    PORTFOLIO_ASSIGN_PROJECT_ROUTE.id,
    "portfolios.assign_project",
  );
  assertEquals(recorder.profileCalls, [{
    clientId: API_CLIENT_ID,
    routeId: "portfolios.assign_project",
  }]);
  assertEquals(recorder.consumeCalls[0].apiClientId, API_CLIENT_ID);
  assertEquals(recorder.consumeCalls[0].userId, USER_ID);
  assertEquals(recorder.consumeCalls[0].routeId, "portfolios.assign_project");
  assertEquals(recorder.order, ["profile", "rate_limit", "writer"]);
});

Deno.test("F2: rate-limit rejection prevents the writer", async () => {
  const { executor, recorder } = buildHarness(successResult, {
    rateLimitThrows: new ApiHttpError("rate_limit_exceeded"),
  });
  const result = await executor(validArgs);
  assertEquals(result, { ok: false, category: "rate_limited" });
  assertEquals(recorder.writerCalls.length, 0);
});

// ---------------------------------------------------------------------------
// G. Writer invocation
// ---------------------------------------------------------------------------

Deno.test("G1: writer invoked exactly once with original request, canonical id, body and context", async () => {
  const { executor, recorder, request } = buildHarness();
  assert((await executor(validArgs)).ok);
  assertEquals(recorder.writerCalls.length, 1);
  assertStrictEquals(recorder.writerCalls[0].request, request);
  assertEquals(recorder.writerCalls[0].projectId, PROJECT_ID);
  assertEquals(recorder.writerCalls[0].body, { portfolioId: PORTFOLIO_ID });
  assert(typeof recorder.writerCalls[0].context.payloadHash === "string");
  assertEquals(recorder.order.filter((e) => e === "writer").length, 1);
});

Deno.test("G2: no retry and no read-before-write", () => {
  for (
    const forbidden of [
      "retry",
      "attempt",
      "getProject",
      "readProject",
      "listPortfolios",
      "currentPortfolioId",
    ]
  ) {
    assertFalse(
      executableSource.includes(forbidden),
      `must not appear: ${forbidden}`,
    );
  }
});

// ---------------------------------------------------------------------------
// H. Results and bounded errors
// ---------------------------------------------------------------------------

Deno.test("H1: applied, no_change and replayed are bounded successes", async () => {
  for (const outcome of ["applied", "no_change", "replayed"] as const) {
    const { executor } = buildHarness({ ...successResult, outcome });
    const result = await executor(validArgs);
    assert(result.ok);
    assertEquals(Object.keys(result.payload).sort(), [
      "newPortfolioId",
      "oldPortfolioId",
      "outcome",
      "projectId",
    ]);
    assertEquals(result.payload.outcome, outcome);
    assertEquals(result.payload.projectId, PROJECT_ID);
    assertEquals(result.payload.oldPortfolioId, OTHER_PORTFOLIO_ID);
    assertEquals(result.payload.newPortfolioId, PORTFOLIO_ID);
  }
});

Deno.test("H2: null old Portfolio identity is preserved", async () => {
  const { executor } = buildHarness({
    ...successResult,
    oldPortfolioId: null,
  });
  const result = await executor(validArgs);
  assert(result.ok);
  assertStrictEquals(result.payload.oldPortfolioId, null);
  assertEquals(result.payload.newPortfolioId, PORTFOLIO_ID);
});

Deno.test("H3: negative writer outcomes map to the exact bounded categories", async () => {
  const cases: ReadonlyArray<
    [string, McpPortfolioAssignProjectToolErrorCategory]
  > = [
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

Deno.test("H4: malformed or internal writer failures degrade to unavailable", async () => {
  const malformedNegative = buildHarness({ ok: false, outcome: "who_knows" });
  assertEquals(await malformedNegative.executor(validArgs), {
    ok: false,
    category: "unavailable",
  });
  const malformedSuccess = buildHarness({ ...successResult, outcome: "weird" });
  assertEquals(await malformedSuccess.executor(validArgs), {
    ok: false,
    category: "unavailable",
  });
  const thrown = buildHarness(successResult, {
    writerThrows: new ApiHttpError(
      "internal_error",
      new Error("SQLSTATE 42501"),
    ),
  });
  assertEquals(await thrown.executor(validArgs), {
    ok: false,
    category: "unavailable",
  });
});

Deno.test("H5: exactly seven bounded categories with no concurrency category", () => {
  assertEquals(
    Object.keys(MCP_PORTFOLIO_ASSIGN_PROJECT_TOOL_ERROR_MESSAGES).sort(),
    [
      "confirmation_required",
      "idempotency_conflict",
      "idempotency_pending",
      "invalid_arguments",
      "not_authorized",
      "rate_limited",
      "unavailable",
    ],
  );
  for (
    const forbidden of [
      "stale_project",
      "stale_portfolio",
      '"conflict"',
      "concurrency",
    ]
  ) {
    assertFalse(
      executableSource.includes(forbidden),
      `must not appear: ${forbidden}`,
    );
  }
});

Deno.test("H6: bounded messages disclose no protected narrative", () => {
  const messages = Object.values(
    MCP_PORTFOLIO_ASSIGN_PROJECT_TOOL_ERROR_MESSAGES,
  ).join(" ");
  for (
    const forbidden of [
      "SQLSTATE",
      "mcp_v1_assign_project_portfolio",
      "assign_project_portfolio",
      "row-level",
      "policy",
      "token",
      "Bearer",
    ]
  ) {
    assertFalse(messages.includes(forbidden), `must not disclose: ${forbidden}`);
  }
});

// ---------------------------------------------------------------------------
// I. Security boundary
// ---------------------------------------------------------------------------

Deno.test("I1: no client, env, RPC, table or authority logic exists", () => {
  for (
    const forbidden of [
      "createClient",
      "Deno.env",
      "service_role",
      "SERVICE_ROLE",
      "SUPABASE_URL",
      "SUPABASE_ANON_KEY",
      ".rpc(",
      ".from(",
      "fetch(",
      "mcp_v1_assign_project_portfolio",
      "api_v1_assign_project_portfolio",
      "assignMcpV1ProjectPortfolio",
      "assignApiV1ProjectPortfolio",
      "has_role",
      "can_write_demo",
      "encrypt",
      "decrypt",
      "capability",
      "containment",
    ]
  ) {
    assertFalse(
      executableSource.includes(forbidden),
      `must not appear: ${forbidden}`,
    );
  }
});

Deno.test("I2: the control layer registers no MCP tool and builds no server", () => {
  for (
    const forbidden of [
      "registerTool",
      "createBtpmMcpServer",
      "serverFactory",
      "McpServer",
      "tools/list",
      "MCP_TOOL_REGISTRY",
      "createMcpV1AssignProjectPortfolioExecutor",
    ]
  ) {
    assertFalse(
      executableSource.includes(forbidden),
      `control layer must not contain: ${forbidden}`,
    );
  }
});


