// API-Q Portfolio-8 — Focused, table-driven proofs for the three MCP Portfolio
// business-read adapters: `portfolios.get`, `portfolios.get_by_id` and
// `portfolios.projects.get`.
//
// The real adapters run against doubles for the accepted delegated Portfolio
// readers and the canonical rate-limit adapters, so the MCP SDK transport is not
// required. Nothing here contacts Supabase, PostgREST or the network.

import {
  assert,
  assertEquals,
  assertStrictEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  PORTFOLIO_DETAIL_ROUTE,
  PORTFOLIO_PROJECTS_ROUTE,
  PORTFOLIOS_ROUTE,
} from "../../../functions/_shared/btpm-api/routes/portfolios.ts";
import type { AuthenticatedApiContext } from "../../../functions/_shared/btpm-api/authenticateApiRequest.ts";
import { ApiHttpError } from "../../../functions/_shared/btpm-api/http.ts";
import type {
  ApiRateLimitStoreInput,
  ApiRateLimitStoreResult,
} from "../../../functions/_shared/btpm-api/rateLimit.ts";
import type {
  ApiV1PortfolioDetailPayload,
  ApiV1PortfolioProjectsPayload,
  ApiV1PortfolioProjectsQuery,
  ApiV1PortfoliosPayload,
  ApiV1PortfoliosQuery,
} from "../../../functions/_shared/btpm-api/supabasePortfolioRead.ts";
import type { McpAuthorizedContext } from "../../../functions/btpm-mcp/mcp/authorizeMcpConnectedApp.ts";
import { buildMcpExecutionContext } from "../../../functions/btpm-mcp/mcp/buildMcpExecutionContext.ts";
import {
  buildCanonicalPortfolioProjectsQueryString,
  buildCanonicalPortfoliosQueryString,
  createMcpPortfolioDetailToolExecutor,
  createMcpPortfolioProjectsToolExecutor,
  createMcpPortfoliosToolExecutor,
  MCP_PORTFOLIO_DETAIL_TOOL_INPUT_SCHEMA,
  MCP_PORTFOLIO_DETAIL_TOOL_NAME,
  MCP_PORTFOLIO_PROJECTS_TOOL_INPUT_SCHEMA,
  MCP_PORTFOLIO_PROJECTS_TOOL_NAME,
  MCP_PORTFOLIO_TOOL_ERROR_MESSAGES,
  MCP_PORTFOLIOS_TOOL_INPUT_SCHEMA,
  MCP_PORTFOLIOS_TOOL_NAME,
} from "../../../functions/btpm-mcp/mcp/portfolioReadTools.ts";
import {
  isMcpOperationExposed,
  MCP_TOOL_REGISTRY,
  validateMcpRegistryCoverage,
  validateMcpToolRegistry,
} from "../../../functions/btpm-mcp/mcp/toolRegistry.ts";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const API_CLIENT_ID = "22222222-2222-4222-8222-222222222222";
const OAUTH_CLIENT_ID = "btpm-connected-app";
const POLICY_VERSION_ID = "33333333-3333-4333-8333-333333333333";
const ORGANIZATION_ID = "44444444-4444-4444-8444-444444444444";
const WORKSPACE_ID = "55555555-5555-4555-8555-555555555555";
const PORTFOLIO_ID = "66666666-6666-4666-8666-666666666666";
const PROJECT_ID = "77777777-7777-4777-8777-777777777777";
const VALID_TOKEN = "header.payload.signature";

const INVALID_IDS: readonly string[] = Object.freeze([
  "",
  "   ",
  "not-a-uuid",
  "00000000-0000-0000-0000-000000000000",
  `${PORTFOLIO_ID}/extra`,
  `${PORTFOLIO_ID}?x=1`,
  `${PORTFOLIO_ID} `,
]);

const PORTFOLIOS_PAYLOAD: ApiV1PortfoliosPayload = Object.freeze({
  items: Object.freeze([
    Object.freeze({
      portfolioId: PORTFOLIO_ID,
      organizationId: ORGANIZATION_ID,
      name: "Core Platform",
      code: "CORE",
      lifecycleState: "active",
      strategicPriority: "high",
      ownerId: null,
      isArchived: false,
      updatedAt: "2026-01-02T03:04:05.000Z",
    }),
  ]),
  pagination: Object.freeze({ limit: 50, offset: 0, returned: 1, total: 1 }),
});

const PORTFOLIO_DETAIL_PAYLOAD: ApiV1PortfolioDetailPayload = Object.freeze({
  portfolioId: PORTFOLIO_ID,
  organizationId: ORGANIZATION_ID,
  name: "Core Platform",
  code: "CORE",
  description: null,
  lifecycleState: "active",
  strategicPriority: "high",
  ownerId: null,
  isArchived: false,
  archivedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T03:04:05.000Z",
});

const PORTFOLIO_PROJECTS_PAYLOAD: ApiV1PortfolioProjectsPayload = Object.freeze({
  items: Object.freeze([
    Object.freeze({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      programId: null,
      name: "SAP S/4 Rollout",
      status: "active",
      priority: "high",
      projectStage: null,
      deliveryModel: null,
      startDate: "2026-01-01",
      targetEndDate: null,
      updatedAt: "2026-01-02T03:04:05.000Z",
    }),
  ]),
  pagination: Object.freeze({ limit: 50, offset: 0, returned: 1, total: 1 }),
});

function authorizedFixture(): McpAuthorizedContext {
  return Object.freeze({
    userId: USER_ID,
    apiClientId: API_CLIENT_ID,
    oauthClientId: OAUTH_CLIENT_ID,
    policyVersionId: POLICY_VERSION_ID,
    requestId: "88888888-8888-4888-8888-888888888888",
    issuer: "https://example.supabase.co/auth/v1",
    audiences: Object.freeze(["authenticated"]),
    expiresAt: 1_900_000_000,
  }) as McpAuthorizedContext;
}

type ReadArgument = ApiV1PortfoliosQuery | ApiV1PortfolioProjectsQuery | string;

interface ReadCall {
  readonly authorization: string | null;
  readonly oauthClientId: string;
  readonly apiClientId: string;
  readonly tokenUserId: string;
  readonly args: readonly ReadArgument[];
}

interface HarnessState {
  profileResolutions: Array<{ apiClientId: string; routeId: string }>;
  consumptions: ApiRateLimitStoreInput[];
  reads: ReadCall[];
  allowed: boolean;
  failure: Error | null;
  order: string[];
}

interface HarnessOptions {
  readonly allowed?: boolean;
  readonly failure?: Error | null;
}

function createState(options: HarnessOptions): HarnessState {
  return {
    profileResolutions: [],
    consumptions: [],
    reads: [],
    allowed: options.allowed ?? true,
    failure: options.failure ?? null,
    order: [],
  };
}

function authenticatedRequest(): Request {
  return new Request("https://mcp.example.test/mcp", {
    method: "POST",
    headers: { authorization: `Bearer ${VALID_TOKEN}` },
  });
}

function sharedDependencies(state: HarnessState) {
  return {
    request: authenticatedRequest(),
    authorized: authorizedFixture(),
    execution: buildMcpExecutionContext(authorizedFixture()),
    rateLimitProfileResolver: {
      resolve: (apiClientId: string, routeId: string) => {
        state.order.push("resolve");
        state.profileResolutions.push({ apiClientId, routeId });
        return Promise.resolve({ limit: 60, windowSeconds: 60 });
      },
    },
    rateLimitStore: {
      consume: (
        input: ApiRateLimitStoreInput,
      ): Promise<ApiRateLimitStoreResult> => {
        state.order.push("consume");
        state.consumptions.push(input);
        return Promise.resolve({
          allowed: state.allowed,
          remaining: state.allowed ? 59 : 0,
          resetAtEpochMs: input.nowEpochMs + 60_000,
        });
      },
    },
    now: () => 1_700_000_000_000,
  };
}

function recordRead<TPayload>(state: HarnessState, payload: TPayload) {
  // deno-lint-ignore no-explicit-any
  return (req: Request, context: AuthenticatedApiContext, ...rest: any[]) => {
    state.order.push("read");
    state.reads.push({
      authorization: req.headers.get("authorization"),
      oauthClientId: context.client.oauthClientId,
      apiClientId: context.client.apiClientId,
      tokenUserId: context.token.userId,
      args: rest as readonly ReadArgument[],
    });
    if (state.failure !== null) return Promise.reject(state.failure);
    return Promise.resolve(payload);
  };
}

function portfoliosHarness(options: HarnessOptions = {}) {
  const state = createState(options);
  const executor = createMcpPortfoliosToolExecutor({
    ...sharedDependencies(state),
    // deno-lint-ignore no-explicit-any
    reader: recordRead(state, PORTFOLIOS_PAYLOAD) as any,
  });
  return { state, executor };
}

function portfolioDetailHarness(options: HarnessOptions = {}) {
  const state = createState(options);
  const executor = createMcpPortfolioDetailToolExecutor({
    ...sharedDependencies(state),
    // deno-lint-ignore no-explicit-any
    reader: recordRead(state, PORTFOLIO_DETAIL_PAYLOAD) as any,
  });
  return { state, executor };
}

function portfolioProjectsHarness(options: HarnessOptions = {}) {
  const state = createState(options);
  const executor = createMcpPortfolioProjectsToolExecutor({
    ...sharedDependencies(state),
    // deno-lint-ignore no-explicit-any
    reader: recordRead(state, PORTFOLIO_PROJECTS_PAYLOAD) as any,
  });
  return { state, executor };
}

// -----------------------------------------------------------------------------
// 1 — Registry exposure and tool identity
// -----------------------------------------------------------------------------

Deno.test("Portfolio-8: the three Portfolio reads are exposed with the exact tool names", () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ["portfolios.get", MCP_PORTFOLIOS_TOOL_NAME],
    ["portfolios.get_by_id", MCP_PORTFOLIO_DETAIL_TOOL_NAME],
    ["portfolios.projects.get", MCP_PORTFOLIO_PROJECTS_TOOL_NAME],
  ];
  for (const [operationId, toolName] of cases) {
    const matches = MCP_TOOL_REGISTRY.filter((e) =>
      e.operationId === operationId
    );
    assertStrictEquals(matches.length, 1, `${operationId} must appear once`);
    assertStrictEquals(matches[0].toolName, toolName);
    assertStrictEquals(matches[0].exposure, "exposed");
    assertStrictEquals(matches[0].operationClass, "read");
    assertStrictEquals(matches[0].confirmation, "not_required");
    assertStrictEquals(isMcpOperationExposed(operationId), true);
  }
});

Deno.test("Portfolio-8: advertised tool names are exactly the accepted names", () => {
  assertStrictEquals(MCP_PORTFOLIOS_TOOL_NAME, "btpm_list_portfolios");
  assertStrictEquals(MCP_PORTFOLIO_DETAIL_TOOL_NAME, "btpm_get_portfolio");
  assertStrictEquals(
    MCP_PORTFOLIO_PROJECTS_TOOL_NAME,
    "btpm_list_portfolio_projects",
  );
});

// MCP-HARDENING-C1B — the historical assertion that every Portfolio mutation
// stays globally non-exposed became obsolete once Portfolio-9/10/11 exposed
// them through their own accepted steps. What Portfolio-8 owns is that its own
// three operations remain reads; the durable mutation invariant kept here is
// that Portfolio mutations still require confirmation.
Deno.test("Portfolio-8: Portfolio mutations remain confirmation-gated mutations", () => {
  const portfolioMutations = MCP_TOOL_REGISTRY.filter((entry) =>
    String(entry.operationId).startsWith("portfolios.") &&
    entry.operationClass === "mutation"
  );
  assert(portfolioMutations.length > 0, "Portfolio mutations must exist");
  for (const entry of portfolioMutations) {
    assertStrictEquals(entry.confirmation, "required", entry.operationId);
  }
});


Deno.test("Portfolio-8: registry invariants still hold", () => {
  assertEquals([...validateMcpRegistryCoverage(MCP_TOOL_REGISTRY)], []);
  assertEquals([...validateMcpToolRegistry(MCP_TOOL_REGISTRY)], []);
});

Deno.test("Portfolio-8: each read tool advertises an input schema", () => {
  for (
    const schema of [
      MCP_PORTFOLIOS_TOOL_INPUT_SCHEMA,
      MCP_PORTFOLIO_DETAIL_TOOL_INPUT_SCHEMA,
      MCP_PORTFOLIO_PROJECTS_TOOL_INPUT_SCHEMA,
    ]
  ) {
    assert(schema !== null && typeof schema === "object");
  }
});

// -----------------------------------------------------------------------------
// 2 — Canonical query/path construction (no local defaulting or clamping)
// -----------------------------------------------------------------------------

Deno.test("Portfolio-8: omitted optional collection arguments stay omitted", () => {
  assertStrictEquals(
    buildCanonicalPortfoliosQueryString({ organizationId: ORGANIZATION_ID }),
    `?organization_id=${ORGANIZATION_ID}`,
  );
  assertStrictEquals(
    buildCanonicalPortfolioProjectsQueryString({
      portfolioId: PORTFOLIO_ID,
    }),
    "",
  );
});

Deno.test("Portfolio-8: supplied collection arguments map to canonical snake_case names", () => {
  assertStrictEquals(
    buildCanonicalPortfoliosQueryString({
      organizationId: ORGANIZATION_ID,
      limit: 10,
      offset: 20,
      search: "core platform",
      includeArchived: true,
    }),
    `?organization_id=${ORGANIZATION_ID}&limit=10&offset=20&search=core%20platform&include_archived=true`,
  );
  assertStrictEquals(
    buildCanonicalPortfolioProjectsQueryString({
      portfolioId: PORTFOLIO_ID,
      limit: 5,
      offset: 1,
      search: "sap",
    }),
    "?limit=5&offset=1&search=sap",
  );
});

// -----------------------------------------------------------------------------
// 3 — Rate limiting with the exact canonical route identifiers
// -----------------------------------------------------------------------------

Deno.test("Portfolio-8: portfolios.get enforces its own canonical route id", async () => {
  const { state, executor } = portfoliosHarness();
  const result = await executor({ organizationId: ORGANIZATION_ID });
  assert(result.ok);
  assertEquals(state.profileResolutions, [
    { apiClientId: API_CLIENT_ID, routeId: PORTFOLIOS_ROUTE.id },
  ]);
  assertStrictEquals(state.consumptions.length, 1);
  assertStrictEquals(state.consumptions[0].routeId, "portfolios.get");
  assertStrictEquals(state.consumptions[0].apiClientId, API_CLIENT_ID);
  assertStrictEquals(state.consumptions[0].userId, USER_ID);
  assertStrictEquals(state.consumptions[0].nowEpochMs, 1_700_000_000_000);
});

Deno.test("Portfolio-8: portfolios.get_by_id enforces its own canonical route id", async () => {
  const { state, executor } = portfolioDetailHarness();
  const result = await executor({ portfolioId: PORTFOLIO_ID });
  assert(result.ok);
  assertEquals(state.profileResolutions, [
    { apiClientId: API_CLIENT_ID, routeId: PORTFOLIO_DETAIL_ROUTE.id },
  ]);
  assertStrictEquals(state.consumptions[0].routeId, "portfolios.get_by_id");
});

Deno.test("Portfolio-8: portfolios.projects.get enforces its own canonical route id", async () => {
  const { state, executor } = portfolioProjectsHarness();
  const result = await executor({ portfolioId: PORTFOLIO_ID });
  assert(result.ok);
  assertEquals(state.profileResolutions, [
    { apiClientId: API_CLIENT_ID, routeId: PORTFOLIO_PROJECTS_ROUTE.id },
  ]);
  assertStrictEquals(state.consumptions[0].routeId, "portfolios.projects.get");
});

Deno.test("Portfolio-8: rate limit is consumed BEFORE the business read", async () => {
  const { state, executor } = portfoliosHarness();
  await executor({ organizationId: ORGANIZATION_ID });
  assertEquals(state.order, ["resolve", "consume", "read"]);
});

Deno.test("Portfolio-8: a denied rate limit blocks the business read on all three tools", async () => {
  const collection = portfoliosHarness({ allowed: false });
  const collectionResult = await collection.executor({
    organizationId: ORGANIZATION_ID,
  });
  assert(!collectionResult.ok);
  assertStrictEquals(collectionResult.category, "rate_limited");
  assertStrictEquals(collection.state.reads.length, 0);

  const detail = portfolioDetailHarness({ allowed: false });
  const detailResult = await detail.executor({ portfolioId: PORTFOLIO_ID });
  assert(!detailResult.ok);
  assertStrictEquals(detailResult.category, "rate_limited");
  assertStrictEquals(detail.state.reads.length, 0);

  const nested = portfolioProjectsHarness({ allowed: false });
  const nestedResult = await nested.executor({ portfolioId: PORTFOLIO_ID });
  assert(!nestedResult.ok);
  assertStrictEquals(nestedResult.category, "rate_limited");
  assertStrictEquals(nested.state.reads.length, 0);
});

// -----------------------------------------------------------------------------
// 4 — Delegated caller-scoped reads only
// -----------------------------------------------------------------------------

Deno.test("Portfolio-8: the caller's own request and identity reach the delegated reader", async () => {
  const { state, executor } = portfoliosHarness();
  await executor({ organizationId: ORGANIZATION_ID, limit: 10 });
  assertStrictEquals(state.reads.length, 1);
  const call = state.reads[0];
  assertStrictEquals(call.authorization, `Bearer ${VALID_TOKEN}`);
  assertStrictEquals(call.oauthClientId, OAUTH_CLIENT_ID);
  assertStrictEquals(call.apiClientId, API_CLIENT_ID);
  assertStrictEquals(call.tokenUserId, USER_ID);
});

Deno.test("Portfolio-8: canonical parser output — not raw arguments — reaches the reader", async () => {
  const collection = portfoliosHarness();
  await collection.executor({ organizationId: ORGANIZATION_ID });
  assertEquals(collection.state.reads[0].args, [
    {
      organizationId: ORGANIZATION_ID,
      limit: 50,
      offset: 0,
      search: null,
      includeArchived: false,
    },
  ]);

  const nested = portfolioProjectsHarness();
  await nested.executor({ portfolioId: PORTFOLIO_ID });
  assertEquals(nested.state.reads[0].args, [
    PORTFOLIO_ID,
    { limit: 50, offset: 0, search: null },
  ]);

  const detail = portfolioDetailHarness();
  await detail.executor({ portfolioId: PORTFOLIO_ID });
  assertEquals(detail.state.reads[0].args, [PORTFOLIO_ID]);
});

Deno.test("Portfolio-8: successful reads return the delegated payload verbatim", async () => {
  const collection = await portfoliosHarness().executor({
    organizationId: ORGANIZATION_ID,
  });
  assert(collection.ok);
  assertEquals(collection.payload, PORTFOLIOS_PAYLOAD);

  const detail = await portfolioDetailHarness().executor({
    portfolioId: PORTFOLIO_ID,
  });
  assert(detail.ok);
  assertEquals(detail.payload, PORTFOLIO_DETAIL_PAYLOAD);

  const nested = await portfolioProjectsHarness().executor({
    portfolioId: PORTFOLIO_ID,
  });
  assert(nested.ok);
  assertEquals(nested.payload, PORTFOLIO_PROJECTS_PAYLOAD);
});

// -----------------------------------------------------------------------------
// 5 — Canonical validation fails closed before any read
// -----------------------------------------------------------------------------

Deno.test("Portfolio-8: invalid organizationId is rejected as invalid_arguments", async () => {
  for (const candidate of INVALID_IDS) {
    const { state, executor } = portfoliosHarness();
    const result = await executor({ organizationId: candidate });
    assert(!result.ok, `expected rejection for ${JSON.stringify(candidate)}`);
    assertStrictEquals(result.category, "invalid_arguments");
    assertStrictEquals(state.reads.length, 0);
  }
});

Deno.test("Portfolio-8: invalid portfolioId is rejected on both Portfolio-scoped tools", async () => {
  for (const candidate of INVALID_IDS) {
    const detail = portfolioDetailHarness();
    const detailResult = await detail.executor({ portfolioId: candidate });
    assert(!detailResult.ok, `detail: ${JSON.stringify(candidate)}`);
    assertStrictEquals(detailResult.category, "invalid_arguments");
    assertStrictEquals(detail.state.reads.length, 0);

    const nested = portfolioProjectsHarness();
    const nestedResult = await nested.executor({ portfolioId: candidate });
    assert(!nestedResult.ok, `nested: ${JSON.stringify(candidate)}`);
    assertStrictEquals(nestedResult.category, "invalid_arguments");
    assertStrictEquals(nested.state.reads.length, 0);
  }
});

Deno.test("Portfolio-8: out-of-range pagination is rejected by the canonical parser", async () => {
  const overLimit = portfoliosHarness();
  const overLimitResult = await overLimit.executor({
    organizationId: ORGANIZATION_ID,
    limit: 1000,
  });
  assert(!overLimitResult.ok);
  assertStrictEquals(overLimitResult.category, "invalid_arguments");
  assertStrictEquals(overLimit.state.reads.length, 0);

  const negativeOffset = portfolioProjectsHarness();
  const negativeOffsetResult = await negativeOffset.executor({
    portfolioId: PORTFOLIO_ID,
    offset: -1,
  });
  assert(!negativeOffsetResult.ok);
  assertStrictEquals(negativeOffsetResult.category, "invalid_arguments");
  assertStrictEquals(negativeOffset.state.reads.length, 0);
});

// -----------------------------------------------------------------------------
// 6 — Bounded error mapping and disclosure
// -----------------------------------------------------------------------------

Deno.test("Portfolio-8: reader failures map to bounded categories only", async () => {
  const vectors: ReadonlyArray<readonly [Error, string]> = [
    [new ApiHttpError("not_authorized"), "not_authorized"],
    [new ApiHttpError("invalid_request"), "invalid_arguments"],
    [new ApiHttpError("rate_limit_exceeded"), "rate_limited"],
    [new ApiHttpError("internal_error"), "unavailable"],
    [new ApiHttpError("route_not_found"), "unavailable"],
    [new Error("permission denied for table portfolio_items (42501)"), "unavailable"],
  ];
  for (const [failure, category] of vectors) {
    const collection = await portfoliosHarness({ failure }).executor({
      organizationId: ORGANIZATION_ID,
    });
    assert(!collection.ok);
    assertStrictEquals(collection.category, category);

    const detail = await portfolioDetailHarness({ failure }).executor({
      portfolioId: PORTFOLIO_ID,
    });
    assert(!detail.ok);
    assertStrictEquals(detail.category, category);

    const nested = await portfolioProjectsHarness({ failure }).executor({
      portfolioId: PORTFOLIO_ID,
    });
    assert(!nested.ok);
    assertStrictEquals(nested.category, category);
  }
});

Deno.test("Portfolio-8: external messages disclose no internal detail", () => {
  assertEquals(Object.keys(MCP_PORTFOLIO_TOOL_ERROR_MESSAGES).sort(), [
    "invalid_arguments",
    "not_authorized",
    "rate_limited",
    "unavailable",
  ]);
  for (const message of Object.values(MCP_PORTFOLIO_TOOL_ERROR_MESSAGES)) {
    assert(typeof message === "string" && message.length > 0);
    for (
      const forbidden of [
        "42501",
        "portfolio_items",
        "select",
        "rls",
        "policy",
        "supabase",
        "sqlstate",
        VALID_TOKEN,
        POLICY_VERSION_ID,
      ]
    ) {
      assertStrictEquals(
        message.toLowerCase().includes(forbidden.toLowerCase()),
        false,
        `message must not disclose ${forbidden}`,
      );
    }
  }
});

Deno.test("Portfolio-8: failure results never carry a payload", async () => {
  const result = await portfoliosHarness({
    failure: new ApiHttpError("not_authorized"),
  }).executor({ organizationId: ORGANIZATION_ID });
  assert(!result.ok);
  assertStrictEquals(
    Object.prototype.hasOwnProperty.call(result, "payload"),
    false,
  );
  assert(Object.isFrozen(result));
});
