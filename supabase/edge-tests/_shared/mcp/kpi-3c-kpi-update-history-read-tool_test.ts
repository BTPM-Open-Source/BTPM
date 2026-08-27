// KPI-3C — Focused proofs for the MCP read exposure of the accepted canonical
// `kpis.updates.get` operation. The real adapter is exercised against doubles
// for the accepted KPI-3B delegated KPI update-history reader and the canonical
// rate-limit adapters, so the MCP SDK transport is not required.

import {
  assert,
  assertEquals,
  assertStrictEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  encodeApiV1KpiUpdateCursor,
  KPI_UPDATES_ROUTE,
} from "../../../functions/_shared/btpm-api/routes/kpis.ts";
import type { ApiV1KpiUpdatesRouteQuery } from "../../../functions/_shared/btpm-api/routes/kpis.ts";
import type { AuthenticatedApiContext } from "../../../functions/_shared/btpm-api/authenticateApiRequest.ts";
import { ApiHttpError } from "../../../functions/_shared/btpm-api/http.ts";
import type {
  ApiRateLimitStoreInput,
  ApiRateLimitStoreResult,
} from "../../../functions/_shared/btpm-api/rateLimit.ts";
import type { ApiV1KpiUpdatesPayload } from "../../../functions/_shared/btpm-api/supabaseKpiRead.ts";
import type { McpAuthorizedContext } from "../../../functions/btpm-mcp/mcp/authorizeMcpConnectedApp.ts";
import { buildMcpExecutionContext } from "../../../functions/btpm-mcp/mcp/buildMcpExecutionContext.ts";
import {
  buildCanonicalKpiUpdatesPath,
  buildCanonicalKpiUpdatesQueryString,
  createMcpKpiUpdatesToolExecutor,
  MCP_KPI_UPDATES_TOOL_ERROR_MESSAGES,
  MCP_KPI_UPDATES_TOOL_INPUT_SCHEMA,
  MCP_KPI_UPDATES_TOOL_NAME,
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
const KPI_ID = "5a5a5a5a-5b5b-4c5c-8d5d-5e5e5e5e5f5f";
const UPDATE_ID = "7c7c7c7c-7d7d-4e7e-8f7f-7a7a7a7a7b7b";
const VALID_TOKEN = "header.payload.signature";

const VALID_CURSOR = encodeApiV1KpiUpdateCursor({
  updateDate: "2026-02-14",
  createdAt: "2026-02-14T10:00:00.000Z",
  id: UPDATE_ID,
});

const UPDATES_PAYLOAD = Object.freeze({
  items: Object.freeze([]),
}) as unknown as ApiV1KpiUpdatesPayload;

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

interface KpiUpdatesReadCall {
  readonly authorization: string | null;
  readonly oauthClientId: string;
  readonly apiClientId: string;
  readonly tokenUserId: string;
  readonly kpiId: string;
  readonly query: ApiV1KpiUpdatesRouteQuery;
  readonly sameRequest: boolean;
}

function createHarness(
  overrides: { allowed?: boolean; failure?: Error | null } = {},
) {
  const state = {
    order: [] as string[],
    profileResolutions: [] as Array<{ apiClientId: string; routeId: string }>,
    consumptions: [] as ApiRateLimitStoreInput[],
    reads: [] as KpiUpdatesReadCall[],
    allowed: overrides.allowed ?? true,
    failure: overrides.failure ?? null,
  };

  const request = new Request("https://mcp.example.test/mcp", {
    method: "POST",
    headers: { authorization: `Bearer ${VALID_TOKEN}` },
  });

  const execution = buildMcpExecutionContext(authorizedFixture());

  const executor = createMcpKpiUpdatesToolExecutor({
    request,
    authorized: authorizedFixture(),
    execution,
    reader: (
      req: Request,
      context: AuthenticatedApiContext,
      kpiId: string,
      query: ApiV1KpiUpdatesRouteQuery,
    ) => {
      state.order.push("reader");
      state.reads.push({
        authorization: req.headers.get("authorization"),
        oauthClientId: context.client.oauthClientId,
        apiClientId: context.client.apiClientId,
        tokenUserId: context.token.userId,
        kpiId,
        query,
        sameRequest: req === request,
      });
      if (state.failure !== null) return Promise.reject(state.failure);
      return Promise.resolve(UPDATES_PAYLOAD);
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

  return { state, executor, execution, request };
}

// ---------------------------------------------------------------- A. Registry

Deno.test("KPI-3C (A): kpis.updates.get is exposed exactly once as btpm_list_kpi_updates", () => {
  const entries = MCP_TOOL_REGISTRY.filter(
    (entry) => entry.operationId === "kpis.updates.get",
  );
  assertStrictEquals(entries.length, 1);
  assertStrictEquals(entries[0].toolName, MCP_KPI_UPDATES_TOOL_NAME);
  assertStrictEquals(entries[0].toolName, "btpm_list_kpi_updates");
  assertStrictEquals(entries[0].title, "List BTPM KPI Updates");
  assertStrictEquals(
    entries[0].description,
    "Bounded update history for one authorized Project KPI.",
  );
  assertStrictEquals(entries[0].exposure, "exposed");
  assertStrictEquals(entries[0].operationClass, "read");
  assertStrictEquals(entries[0].confirmation, "not_required");
  assertStrictEquals(entries[0].resultShape, "bounded_collection");
  assertStrictEquals(entries[0].concurrencyToken, "not_applicable");
  assertStrictEquals(isMcpOperationExposed("kpis.updates.get"), true);
  // KPI-R1: the former absolute global-cardinality freeze (47 registry
  // entries) was removed. Global registry cardinality is owned by the
  // current-surface / registry guards, not by this historical step test.

});

Deno.test("KPI-3C (A): the accepted KPI read exposures remain unchanged", () => {
  for (
    const [operationId, toolName] of [
      ["kpis.get", "btpm_list_project_kpis"],
      ["kpis.get_by_id", "btpm_get_kpi"],
    ] as const
  ) {
    const entries = MCP_TOOL_REGISTRY.filter(
      (entry) => entry.operationId === operationId,
    );
    assertStrictEquals(entries.length, 1, operationId);
    assertStrictEquals(entries[0].toolName, toolName);
    assertStrictEquals(entries[0].exposure, "exposed", operationId);
  }
  const exposed = exposedMcpTools();
  assertStrictEquals(
    exposed.filter((tool) => tool.toolName === "btpm_list_kpi_updates").length,
    1,
  );
  assertStrictEquals(
    new Set(exposed.map((tool) => tool.toolName)).size,
    exposed.length,
  );
});

// ------------------------------------------------------------------- B. Input

Deno.test("KPI-3C (B): the tool input exposes only kpiId, limit and cursor", () => {
  assertEquals(Object.keys(MCP_KPI_UPDATES_TOOL_INPUT_SCHEMA.shape), [
    "kpiId",
    "limit",
    "cursor",
  ]);
  assertStrictEquals(
    MCP_KPI_UPDATES_TOOL_INPUT_SCHEMA.safeParse({}).success,
    false,
  );
  assertStrictEquals(
    MCP_KPI_UPDATES_TOOL_INPUT_SCHEMA.safeParse({ kpiId: KPI_ID }).success,
    true,
  );
  assertStrictEquals(
    MCP_KPI_UPDATES_TOOL_INPUT_SCHEMA.safeParse({
      kpiId: KPI_ID,
      limit: 10,
      cursor: VALID_CURSOR,
    }).success,
    true,
  );
  // Internal keyset fields are never MCP parameters.
  for (const forbidden of ["updateDate", "createdAt", "id"]) {
    assertStrictEquals(
      Object.keys(MCP_KPI_UPDATES_TOOL_INPUT_SCHEMA.shape).includes(forbidden),
      false,
      forbidden,
    );
  }
});

Deno.test("KPI-3C (B): the structural schema is not the canonical validator", () => {
  assertStrictEquals(
    MCP_KPI_UPDATES_TOOL_INPUT_SCHEMA.safeParse({ kpiId: "not-a-uuid" }).success,
    true,
  );
  assertStrictEquals(
    MCP_KPI_UPDATES_TOOL_INPUT_SCHEMA.safeParse({
      kpiId: KPI_ID,
      limit: 9999,
      cursor: "!!!not-a-cursor!!!",
    }).success,
    true,
  );
});

Deno.test("KPI-3C (B): canonical path and query are built verbatim", () => {
  assertStrictEquals(
    buildCanonicalKpiUpdatesPath({ kpiId: KPI_ID }),
    `/v1/kpis/${KPI_ID}/updates`,
  );
  assertStrictEquals(
    buildCanonicalKpiUpdatesPath({ kpiId: ` ${KPI_ID.toUpperCase()} ` }),
    `/v1/kpis/ ${KPI_ID.toUpperCase()} /updates`,
  );
  assertStrictEquals(
    buildCanonicalKpiUpdatesQueryString({ kpiId: KPI_ID }),
    "",
  );
  assertStrictEquals(
    buildCanonicalKpiUpdatesQueryString({
      kpiId: KPI_ID,
      limit: 25,
      cursor: VALID_CURSOR,
    }),
    `?limit=25&cursor=${encodeURIComponent(VALID_CURSOR)}`,
  );
});

// --------------------------------------------------------------- C. Execution

Deno.test("KPI-3C (C): valid arguments reach the delegated reader unchanged", async () => {
  const { state, executor, request } = createHarness();
  const result = await executor({
    kpiId: KPI_ID,
    limit: 25,
    cursor: VALID_CURSOR,
  });
  assert(result.ok);
  assertStrictEquals(result.payload, UPDATES_PAYLOAD);
  assertEquals(state.order, ["profile", "rateLimit", "reader"]);
  assertStrictEquals(state.reads.length, 1);
  assertStrictEquals(state.reads[0].kpiId, KPI_ID);
  assertStrictEquals(state.reads[0].sameRequest, true);
  assertStrictEquals(state.reads[0].query.limit, 25);
  assertStrictEquals(state.reads[0].query.cursor?.id, UPDATE_ID);
  assertStrictEquals(state.reads[0].query.cursor?.updateDate, "2026-02-14");
  assertStrictEquals(state.reads[0].authorization, `Bearer ${VALID_TOKEN}`);
  assertStrictEquals(state.reads[0].oauthClientId, OAUTH_CLIENT_ID);
  assertStrictEquals(state.reads[0].apiClientId, API_CLIENT_ID);
  assertStrictEquals(state.reads[0].tokenUserId, USER_ID);
  assertStrictEquals(request.bodyUsed, false);
});

Deno.test("KPI-3C (C): omitted optional arguments yield canonical defaults", async () => {
  const { state, executor } = createHarness();
  const result = await executor({ kpiId: KPI_ID });
  assert(result.ok);
  assertStrictEquals(state.reads[0].query.limit, 50);
  assertStrictEquals(state.reads[0].query.cursor, null);
});

Deno.test("KPI-3C (C): malformed KPI IDs fail closed as invalid_arguments", async () => {
  for (
    const kpiId of [
      "",
      "not-a-uuid",
      "00000000-0000-0000-0000-000000000000",
      KPI_ID.toUpperCase(),
      `${encodeURIComponent(KPI_ID)}%20`,
      `${KPI_ID}%2F`,
      ` ${KPI_ID}`,
      `${KPI_ID} `,
      `${KPI_ID}/history`,
      `${KPI_ID}/`,
      `../${KPI_ID}`,
    ]
  ) {
    const { state, executor } = createHarness();
    const result = await executor({ kpiId });
    assertStrictEquals(result.ok, false, kpiId);
    if (!result.ok) {
      assertStrictEquals(result.category, "invalid_arguments", kpiId);
    }
    assertStrictEquals(state.reads.length, 0, kpiId);
  }
});

Deno.test("KPI-3C (C): invalid limit or cursor fails through canonical parsers", async () => {
  const invalidArgs: ReadonlyArray<
    { readonly kpiId: string; readonly limit?: number; readonly cursor?: string }
  > = [
    { kpiId: KPI_ID, limit: 0 },
    { kpiId: KPI_ID, limit: 101 },
    { kpiId: KPI_ID, limit: 1.5 },
    { kpiId: KPI_ID, limit: -1 },
    { kpiId: KPI_ID, cursor: "" },
    { kpiId: KPI_ID, cursor: "!!!" },
    { kpiId: KPI_ID, cursor: "a".repeat(600) },
  ];
  for (const args of invalidArgs) {
    const { state, executor } = createHarness();
    const result = await executor(args);
    assertStrictEquals(result.ok, false, JSON.stringify(args));
    if (!result.ok) {
      assertStrictEquals(
        result.category,
        "invalid_arguments",
        JSON.stringify(args),
      );
    }
    assertStrictEquals(state.reads.length, 0);
  }
});

// -------------------------------------------------------------- D. Rate limit

Deno.test("KPI-3C (D): the rate-limit profile and identity are canonical", async () => {
  const { state, executor } = createHarness();
  await executor({ kpiId: KPI_ID });
  assertStrictEquals(KPI_UPDATES_ROUTE.id, "kpis.updates.get");
  assertEquals(state.profileResolutions, [
    { apiClientId: API_CLIENT_ID, routeId: "kpis.updates.get" },
  ]);
  assertStrictEquals(state.consumptions.length, 1);
  assertStrictEquals(state.consumptions[0].apiClientId, API_CLIENT_ID);
  assertStrictEquals(state.consumptions[0].userId, USER_ID);
  assertStrictEquals(state.consumptions[0].routeId, "kpis.updates.get");
});

Deno.test("KPI-3C (D): exhaustion prevents the business reader", async () => {
  const { state, executor } = createHarness({ allowed: false });
  const result = await executor({ kpiId: KPI_ID });
  assertStrictEquals(result.ok, false);
  if (!result.ok) assertStrictEquals(result.category, "rate_limited");
  assertStrictEquals(state.reads.length, 0);
  assertEquals(state.order, ["profile", "rateLimit"]);
});

// ------------------------------------------------------------------ E. Errors

Deno.test("KPI-3C (E): delegated not_authorized maps to bounded not_authorized", async () => {
  const { executor } = createHarness({
    failure: new ApiHttpError("not_authorized"),
  });
  const result = await executor({ kpiId: KPI_ID });
  assertStrictEquals(result.ok, false);
  if (!result.ok) {
    assertStrictEquals(result.category, "not_authorized");
    assertStrictEquals(
      MCP_KPI_UPDATES_TOOL_ERROR_MESSAGES[result.category],
      "Not authorized to access KPI updates.",
    );
  }
});

Deno.test("KPI-3C (E): unexpected errors map to unavailable without leakage", async () => {
  const { executor } = createHarness({
    failure: new Error(
      "permission denied for function api_v1_list_kpi_updates SQLSTATE 42501 policy",
    ),
  });
  const result = await executor({ kpiId: KPI_ID });
  assertStrictEquals(result.ok, false);
  if (!result.ok) {
    assertStrictEquals(result.category, "unavailable");
    assertStrictEquals(
      MCP_KPI_UPDATES_TOOL_ERROR_MESSAGES[result.category],
      "BTPM KPI read is temporarily unavailable.",
    );
  }
  assertEquals(Object.keys(MCP_KPI_UPDATES_TOOL_ERROR_MESSAGES).sort(), [
    "invalid_arguments",
    "not_authorized",
    "rate_limited",
    "unavailable",
  ]);
  for (const message of Object.values(MCP_KPI_UPDATES_TOOL_ERROR_MESSAGES)) {
    for (
      const forbidden of ["42501", "policy", "select ", "supabase", "token"]
    ) {
      assertStrictEquals(message.toLowerCase().includes(forbidden), false);
    }
  }
});

// ------------------------------------------------------------- F. Containment

Deno.test("KPI-3C (F): the trusted execution context never carries the bearer", () => {
  const { execution } = createHarness();
  const serialized = JSON.stringify(execution);
  assertStrictEquals(serialized.includes(VALID_TOKEN), false);
  assertStrictEquals(serialized.includes("Bearer"), false);
  assertStrictEquals(execution.apiClientId, API_CLIENT_ID);
  assertStrictEquals(execution.executingUserId, USER_ID);
});

Deno.test("KPI-3C (F): result and registry surfaces never carry the bearer", async () => {
  const { executor } = createHarness();
  const result = await executor({ kpiId: KPI_ID, cursor: VALID_CURSOR });
  assertStrictEquals(JSON.stringify(result).includes(VALID_TOKEN), false);
  assertStrictEquals(
    JSON.stringify(MCP_TOOL_REGISTRY).includes(VALID_TOKEN),
    false,
  );
});

// ------------------------------------------------------------------ G. Purity

Deno.test("KPI-3C (G): the KPI adapter has no alternate authority or data path", async () => {
  const raw = await Deno.readTextFile(
    new URL("../../../functions/btpm-mcp/mcp/kpiReadTool.ts", import.meta.url),
  );
  const source = raw
    .split("\n")
    .filter((line) =>
      !line.trimStart().startsWith("//") &&
      !line.trimStart().startsWith("*") &&
      !line.trimStart().startsWith("/*")
    )
    .join("\n");
  for (
    const forbidden of [
      "createClient",
      "SERVICE_ROLE",
      "service_role",
      "Deno.env",
      ".from(",
      ".rpc(",
      "fetch(",
      "api_v1_list_kpi_updates",
      "decrypt",
      "console.log",
      "btpm-api-v1",
      "decodeApiV1KpiUpdateCursor",
    ]
  ) {
    assertStrictEquals(source.includes(forbidden), false, forbidden);
  }
  for (
    const reused of [
      "KPI_UPDATES_ROUTE",
      "parseApiV1KpiUpdatesPath",
      "parseApiV1KpiUpdatesQuery",
      "buildAuthenticatedApiContextFromMcp",
      "enforceApiRateLimit",
    ]
  ) {
    assert(source.includes(reused), reused);
  }
});

Deno.test("KPI-3C (G): no competing KPI-history adapter module exists", async () => {
  for (const module of ["kpiUpdatesReadTool.ts", "kpiHistoryReadTool.ts"]) {
    let missing = false;
    try {
      await Deno.stat(
        new URL(`../../../functions/btpm-mcp/mcp/${module}`, import.meta.url),
      );
    } catch {
      missing = true;
    }
    assert(missing, `${module} must not exist`);
  }
});

// ----------------------------------------------------------- H. serverFactory

Deno.test("KPI-3C (H): serverFactory has exactly one bounded branch", async () => {
  const source = await Deno.readTextFile(
    new URL("../../../functions/btpm-mcp/mcp/serverFactory.ts", import.meta.url),
  );
  assertStrictEquals(
    source.split("executors.kpiUpdatesGet(args)").length - 1,
    1,
  );
  assert(source.includes("MCP_KPI_UPDATES_TOOL_NAME"));
  assert(source.includes("MCP_KPI_UPDATES_TOOL_INPUT_SCHEMA"));
  assert(source.includes("MCP_KPI_UPDATES_TOOL_ERROR_MESSAGES"));
  assert(source.includes("BTPM_MCP_READ_TOOL_ANNOTATIONS"));
  assert(source.includes("structuredContent: result.payload"));
  for (
    const forbidden of [
      "executorsByToolName",
      "executorsByOperationId",
      "EXECUTOR_MAP",
    ]
  ) {
    assertStrictEquals(source.includes(forbidden), false, forbidden);
  }
});

Deno.test("KPI-3C (H): read annotations are the standard read posture", async () => {
  const { BTPM_MCP_READ_TOOL_ANNOTATIONS } = await import(
    "../../../functions/btpm-mcp/mcp/serverFactory.ts"
  );
  assertEquals(BTPM_MCP_READ_TOOL_ANNOTATIONS, {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  });
});

// --------------------------------------------------------------- I. btpm-mcp

Deno.test("KPI-3C (I): btpm-mcp wires exactly one caller-scoped history reader", async () => {
  const source = await Deno.readTextFile(
    new URL("../../../functions/btpm-mcp/index.ts", import.meta.url),
  );
  assertStrictEquals(
    source.split("createDelegatedApiV1KpiUpdatesReader(").length - 1,
    1,
  );
  assertStrictEquals(
    source.split("createMcpKpiUpdatesToolExecutor({").length - 1,
    1,
  );
  assert(source.includes("reader: runtime.kpiUpdatesReader"));
  assert(source.includes("kpiUpdatesReader: DelegatedApiV1KpiUpdatesReader"));
  assertStrictEquals(source.split("        kpiUpdatesGet,").length - 1, 1);
  // The caller-scoped reader uses the anon key, never the service role.
  const construction = source.slice(
    source.indexOf("createDelegatedApiV1KpiUpdatesReader("),
    source.indexOf("createDelegatedApiV1KpiUpdatesReader(") + 400,
  );
  assert(construction.includes("supabaseAnonKey"));
  assertStrictEquals(construction.includes("SERVICE_ROLE"), false);
});
