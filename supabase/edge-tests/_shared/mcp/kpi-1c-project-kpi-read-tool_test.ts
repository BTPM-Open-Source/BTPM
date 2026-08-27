// KPI-1C — Focused proofs for the MCP read exposure of the accepted canonical
// `kpis.get` operation. These tests exercise the real adapter against doubles
// for the accepted KPI-1B delegated reader and the canonical rate-limit
// adapters, so the MCP SDK transport is not required.

import {
  assert,
  assertEquals,
  assertStrictEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  KPI_PROJECT_COLLECTION_ROUTE,
  type ApiV1ProjectKpisRouteQuery,
} from "../../../functions/_shared/btpm-api/routes/kpis.ts";
import type { AuthenticatedApiContext } from "../../../functions/_shared/btpm-api/authenticateApiRequest.ts";
import { ApiHttpError } from "../../../functions/_shared/btpm-api/http.ts";
import type {
  ApiRateLimitStoreInput,
  ApiRateLimitStoreResult,
} from "../../../functions/_shared/btpm-api/rateLimit.ts";
import type { ApiV1ProjectKpisPayload } from "../../../functions/_shared/btpm-api/supabaseKpiRead.ts";
import type { McpAuthorizedContext } from "../../../functions/btpm-mcp/mcp/authorizeMcpConnectedApp.ts";
import { buildMcpExecutionContext } from "../../../functions/btpm-mcp/mcp/buildMcpExecutionContext.ts";
import {
  buildCanonicalProjectKpisQueryString,
  createMcpProjectKpisToolExecutor,
  MCP_PROJECT_KPIS_TOOL_ERROR_MESSAGES,
  MCP_PROJECT_KPIS_TOOL_INPUT_SCHEMA,
  MCP_PROJECT_KPIS_TOOL_NAME,
} from "../../../functions/btpm-mcp/mcp/kpiReadTool.ts";
import {
  exposedMcpTools,
  isMcpOperationExposed,
  MCP_TOOL_REGISTRY,
} from "../../../functions/btpm-mcp/mcp/toolRegistry.ts";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const API_CLIENT_ID = "22222222-2222-4222-8222-222222222222";
const OAUTH_CLIENT_ID = "btpm-connected-app";
const POLICY_VERSION_ID = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID = "44444444-4444-4444-8444-444444444444";
const VALID_TOKEN = "header.payload.signature";

const KPIS_PAYLOAD = Object.freeze({
  items: Object.freeze([]),
  pagination: Object.freeze({ limit: 50, offset: 0, returned: 0, total: 0 }),
}) as unknown as ApiV1ProjectKpisPayload;

function authorizedFixture(): McpAuthorizedContext {
  return Object.freeze({
    userId: USER_ID,
    apiClientId: API_CLIENT_ID,
    oauthClientId: OAUTH_CLIENT_ID,
    policyVersionId: POLICY_VERSION_ID,
    requestId: "66666666-6666-4666-8666-666666666666",
    issuer: "https://example.supabase.co/auth/v1",
    audiences: Object.freeze(["authenticated"]),
    expiresAt: 1_900_000_000,
  }) as McpAuthorizedContext;
}

interface KpiReadCall {
  readonly authorization: string | null;
  readonly oauthClientId: string;
  readonly apiClientId: string;
  readonly tokenUserId: string;
  readonly projectId: string;
  readonly query: ApiV1ProjectKpisRouteQuery;
}

function createHarness(
  overrides: { allowed?: boolean; failure?: Error | null } = {},
) {
  const state = {
    order: [] as string[],
    profileResolutions: [] as Array<{ apiClientId: string; routeId: string }>,
    consumptions: [] as ApiRateLimitStoreInput[],
    reads: [] as KpiReadCall[],
    allowed: overrides.allowed ?? true,
    failure: overrides.failure ?? null,
  };

  const request = new Request("https://mcp.example.test/mcp", {
    method: "POST",
    headers: { authorization: `Bearer ${VALID_TOKEN}` },
  });

  const executor = createMcpProjectKpisToolExecutor({
    request,
    authorized: authorizedFixture(),
    execution: buildMcpExecutionContext(authorizedFixture()),
    reader: (
      req: Request,
      context: AuthenticatedApiContext,
      projectId: string,
      query: ApiV1ProjectKpisRouteQuery,
    ) => {
      state.order.push("reader");
      state.reads.push({
        authorization: req.headers.get("authorization"),
        oauthClientId: context.client.oauthClientId,
        apiClientId: context.client.apiClientId,
        tokenUserId: context.token.userId,
        projectId,
        query,
      });
      if (state.failure !== null) return Promise.reject(state.failure);
      return Promise.resolve(KPIS_PAYLOAD);
    },
    rateLimitProfileResolver: {
      resolve: (apiClientId: string, routeId: string) => {
        state.order.push("profile");
        state.profileResolutions.push({ apiClientId, routeId });
        return Promise.resolve({ limit: 60, windowSeconds: 60 });
      },
    },
    rateLimitStore: {
      consume: (
        input: ApiRateLimitStoreInput,
      ): Promise<ApiRateLimitStoreResult> => {
        state.order.push("rateLimit");
        state.consumptions.push(input);
        return Promise.resolve({
          allowed: state.allowed,
          remaining: state.allowed ? 59 : 0,
          resetAtEpochMs: input.nowEpochMs + 60_000,
        });
      },
    },
    now: () => 1_700_000_000_000,
  });

  return { state, executor };
}

// ---------------------------------------------------------------- A. Registry

Deno.test("KPI-1C (A): kpis.get is exposed exactly once as btpm_list_project_kpis", () => {
  const entries = MCP_TOOL_REGISTRY.filter(
    (entry) => entry.operationId === "kpis.get",
  );
  assertStrictEquals(entries.length, 1);
  assertStrictEquals(entries[0].toolName, MCP_PROJECT_KPIS_TOOL_NAME);
  assertStrictEquals(entries[0].toolName, "btpm_list_project_kpis");
  assertStrictEquals(entries[0].operationClass, "read");
  assertStrictEquals(entries[0].exposure, "exposed");
  assertStrictEquals(entries[0].confirmation, "not_required");
  assertStrictEquals(entries[0].resultShape, "bounded_collection");
  assertStrictEquals(entries[0].concurrencyToken, "not_applicable");
  assertStrictEquals(isMcpOperationExposed("kpis.get"), true);
});

Deno.test("KPI-1C (A): the advertised inventory has no duplicate tool names", () => {
  const exposed = exposedMcpTools();
  assertStrictEquals(
    exposed.filter((tool) => tool.toolName === MCP_PROJECT_KPIS_TOOL_NAME)
      .length,
    1,
  );
  assertStrictEquals(
    new Set(exposed.map((tool) => tool.toolName)).size,
    exposed.length,
  );
});

// ------------------------------------------------------------------- B. Input

Deno.test("KPI-1C (B): the tool input exposes only projectId/limit/offset/includeArchived", () => {
  assertEquals(
    Object.keys(MCP_PROJECT_KPIS_TOOL_INPUT_SCHEMA.shape).sort(),
    ["includeArchived", "limit", "offset", "projectId"],
  );
  assertStrictEquals(
    MCP_PROJECT_KPIS_TOOL_INPUT_SCHEMA.safeParse({}).success,
    false,
  );
  assertStrictEquals(
    MCP_PROJECT_KPIS_TOOL_INPUT_SCHEMA.safeParse({ projectId: PROJECT_ID })
      .success,
    true,
  );
});

Deno.test("KPI-1C (B): omitted values stay omitted in the canonical query string", () => {
  assertStrictEquals(
    buildCanonicalProjectKpisQueryString({ projectId: PROJECT_ID }),
    "",
  );
  assertStrictEquals(
    buildCanonicalProjectKpisQueryString({
      projectId: PROJECT_ID,
      limit: 25,
      offset: 10,
      includeArchived: true,
    }),
    "?limit=25&offset=10&include_archived=true",
  );
});

// -------------------------------------------------- C. Canonical parser owns

Deno.test("KPI-1C (C): omitted arguments resolve to canonical 50/0/false", async () => {
  const { state, executor } = createHarness();
  const result = await executor({ projectId: PROJECT_ID });
  assert(result.ok);
  assertStrictEquals(state.reads.length, 1);
  assertStrictEquals(state.reads[0].projectId, PROJECT_ID);
  assertEquals(state.reads[0].query, {
    limit: 50,
    offset: 0,
    includeArchived: false,
  });
});

Deno.test("KPI-1C (C): explicit valid values reach the delegated reader unchanged", async () => {
  const { state, executor } = createHarness();
  const result = await executor({
    projectId: PROJECT_ID,
    limit: 100,
    offset: 10_000,
    includeArchived: true,
  });
  assert(result.ok);
  assertEquals(state.reads[0].query, {
    limit: 100,
    offset: 10_000,
    includeArchived: true,
  });
});

Deno.test("KPI-1C (C): malformed, non-UUID, uppercase and nil Project IDs fail closed", async () => {
  for (
    const projectId of [
      "",
      "   ",
      "not-a-uuid",
      "00000000-0000-0000-0000-000000000000",
      "44444444-4444-4444-8444-444444444444/extra",
      "44444444%2D4444-4444-8444-444444444444",
    ]
  ) {
    const { state, executor } = createHarness();
    const result = await executor({ projectId });
    assertStrictEquals(result.ok, false);
    if (!result.ok) assertStrictEquals(result.category, "invalid_arguments");
    assertStrictEquals(state.reads.length, 0);
  }
});

Deno.test("KPI-1C (C): out-of-range or non-integral limit/offset fail as invalid_arguments", async () => {
  const invalid: Array<Record<string, unknown>> = [
    { limit: 0 },
    { limit: 101 },
    { limit: 1.5 },
    { limit: -1 },
    { offset: -1 },
    { offset: 10_001 },
    { offset: 2.25 },
  ];
  for (const extra of invalid) {
    const { state, executor } = createHarness();
    const result = await executor(
      { projectId: PROJECT_ID, ...extra } as never,
    );
    assertStrictEquals(result.ok, false);
    if (!result.ok) assertStrictEquals(result.category, "invalid_arguments");
    // Rate limiting ran first; no business read happened.
    assertStrictEquals(state.consumptions.length, 1);
    assertStrictEquals(state.reads.length, 0);
  }
});

// --------------------------------------------------------- D. Execution order

Deno.test("KPI-1C (D): order is context → profile → rate limit → parser → reader", async () => {
  const { state, executor } = createHarness();
  const result = await executor({ projectId: PROJECT_ID });
  assert(result.ok);
  assertEquals(state.order, ["profile", "rateLimit", "reader"]);
  assertEquals(state.profileResolutions, [
    { apiClientId: API_CLIENT_ID, routeId: "kpis.get" },
  ]);
  assertStrictEquals(KPI_PROJECT_COLLECTION_ROUTE.id, "kpis.get");
  assertEquals(
    {
      apiClientId: state.consumptions[0].apiClientId,
      userId: state.consumptions[0].userId,
      routeId: state.consumptions[0].routeId,
      limit: state.consumptions[0].limit,
      windowSeconds: state.consumptions[0].windowSeconds,
    },
    {
      apiClientId: API_CLIENT_ID,
      userId: USER_ID,
      routeId: "kpis.get",
      limit: 60,
      windowSeconds: 60,
    },
  );
});

Deno.test("KPI-1C (D): the caller's own bearer request and identity reach the reader", async () => {
  const { state, executor } = createHarness();
  await executor({ projectId: PROJECT_ID });
  assertStrictEquals(state.reads[0].authorization, `Bearer ${VALID_TOKEN}`);
  assertStrictEquals(state.reads[0].oauthClientId, OAUTH_CLIENT_ID);
  assertStrictEquals(state.reads[0].apiClientId, API_CLIENT_ID);
  assertStrictEquals(state.reads[0].tokenUserId, USER_ID);
  // The trusted execution context never carries the bearer token.
  const context = buildMcpExecutionContext(authorizedFixture());
  assertStrictEquals(context.sourceChannel, "mcp");
  assertEquals(JSON.stringify(context).includes(VALID_TOKEN), false);
});

Deno.test("KPI-1C (D): an exhausted rate limit fails closed without reading", async () => {
  const { state, executor } = createHarness({ allowed: false });
  const result = await executor({ projectId: PROJECT_ID });
  assertStrictEquals(result.ok, false);
  if (!result.ok) assertStrictEquals(result.category, "rate_limited");
  assertStrictEquals(state.reads.length, 0);
});

// ------------------------------------------------------------ E. Bounded error

Deno.test("KPI-1C (E): delegated not_authorized maps to a bounded tool error", async () => {
  const { executor } = createHarness({
    failure: new ApiHttpError("not_authorized"),
  });
  const result = await executor({ projectId: PROJECT_ID });
  assertStrictEquals(result.ok, false);
  if (!result.ok) {
    assertStrictEquals(result.category, "not_authorized");
    assertStrictEquals(
      MCP_PROJECT_KPIS_TOOL_ERROR_MESSAGES[result.category],
      "Not authorized to access Project KPIs.",
    );
  }
});

Deno.test("KPI-1C (E): unexpected failures map to unavailable and leak nothing", async () => {
  const { executor } = createHarness({
    failure: new Error(
      `42501: permission denied for table project_kpis (policy kpi_select) ${POLICY_VERSION_ID} ${VALID_TOKEN}`,
    ),
  });
  const result = await executor({ projectId: PROJECT_ID });
  assertStrictEquals(result.ok, false);
  const serialized = JSON.stringify(result);
  for (
    const forbidden of [
      "42501",
      "permission denied",
      "policy",
      POLICY_VERSION_ID,
      VALID_TOKEN,
    ]
  ) {
    assertEquals(
      serialized.toLowerCase().includes(forbidden.toLowerCase()),
      false,
      `bounded tool error must not disclose ${forbidden}`,
    );
  }
  if (!result.ok) {
    assertStrictEquals(
      MCP_PROJECT_KPIS_TOOL_ERROR_MESSAGES[result.category],
      "BTPM KPI read is temporarily unavailable.",
    );
  }
});

// ------------------------------------------------------ F. Structural posture

Deno.test("KPI-1C (F): the adapter contains no KPI, SQL or privileged surface", async () => {
  const source = await Deno.readTextFile(
    new URL("../../../functions/btpm-mcp/mcp/kpiReadTool.ts", import.meta.url),
  );
  const code = source
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
  for (
    const forbidden of [
      "@supabase/supabase-js",
      "createClient",
      "Deno.env",
      "service_role",
      "SERVICE_ROLE",
      ".from(",
      ".rpc(",
      "api_v1_list_project_kpis",
      "btpm_decrypt",
      "console.",
      "Deno.serve",
      "fetch(",
    ]
  ) {
    assert(!code.includes(forbidden), `adapter must not contain: ${forbidden}`);
  }
  // One business read per KPI read operation in this KPI-family adapter
  // (KPI-1C collection + KPI-2C detail + KPI-3C update history), each through
  // its accepted delegated reader. No other data path exists.
  assertStrictEquals(code.split("dependencies.reader(").length - 1, 3);
  assertStrictEquals(code.split("parseApiV1ProjectKpisQuery(").length - 1, 1);
  assertStrictEquals(code.split("parseApiV1ProjectKpisPath(").length - 1, 1);
});

Deno.test("KPI-1C (F): the server factory registers the exact tool with read annotations", async () => {
  const factory = await Deno.readTextFile(
    new URL("../../../functions/btpm-mcp/mcp/serverFactory.ts", import.meta.url),
  );
  assert(factory.includes("MCP_PROJECT_KPIS_TOOL_NAME"));
  assert(factory.includes("MCP_PROJECT_KPIS_TOOL_INPUT_SCHEMA"));
  assert(factory.includes("readonly kpisGet: McpProjectKpisToolExecutor;"));
  assertStrictEquals(factory.split("executors.kpisGet(").length - 1, 1);
  assertStrictEquals(
    factory.split("tool.toolName === MCP_PROJECT_KPIS_TOOL_NAME").length - 1,
    1,
  );
  assert(factory.includes("readOnlyHint: true"));
});

Deno.test("KPI-1C (F): the MCP runtime wires the accepted delegated KPI reader", async () => {
  const index = await Deno.readTextFile(
    new URL("../../../functions/btpm-mcp/index.ts", import.meta.url),
  );
  assert(index.includes("createDelegatedApiV1ProjectKpisReader("));
  assert(index.includes("createMcpProjectKpisToolExecutor("));
  assert(index.includes("reader: runtime.kpisReader,"));
  assert(index.includes("        kpisGet,"));
});
