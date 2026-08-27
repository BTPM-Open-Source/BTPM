// KPI-2C — Focused proofs for the MCP read exposure of the accepted canonical
// `kpis.get_by_id` operation. The real adapter is exercised against doubles for
// the accepted KPI-2B delegated KPI detail reader and the canonical rate-limit
// adapters, so the MCP SDK transport is not required.

import {
  assert,
  assertEquals,
  assertStrictEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { KPI_DETAIL_ROUTE } from "../../../functions/_shared/btpm-api/routes/kpis.ts";
import type { AuthenticatedApiContext } from "../../../functions/_shared/btpm-api/authenticateApiRequest.ts";
import { ApiHttpError } from "../../../functions/_shared/btpm-api/http.ts";
import type {
  ApiRateLimitStoreInput,
  ApiRateLimitStoreResult,
} from "../../../functions/_shared/btpm-api/rateLimit.ts";
import type { ApiV1ProjectKpiItem } from "../../../functions/_shared/btpm-api/supabaseKpiRead.ts";
import type { McpAuthorizedContext } from "../../../functions/btpm-mcp/mcp/authorizeMcpConnectedApp.ts";
import { buildMcpExecutionContext } from "../../../functions/btpm-mcp/mcp/buildMcpExecutionContext.ts";
import {
  buildCanonicalKpiDetailPath,
  createMcpKpiDetailToolExecutor,
  MCP_KPI_DETAIL_TOOL_ERROR_MESSAGES,
  MCP_KPI_DETAIL_TOOL_INPUT_SCHEMA,
  MCP_KPI_DETAIL_TOOL_NAME,
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
const VALID_TOKEN = "header.payload.signature";

const KPI_PAYLOAD = Object.freeze({
  id: KPI_ID,
}) as unknown as ApiV1ProjectKpiItem;

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

interface KpiDetailReadCall {
  readonly authorization: string | null;
  readonly oauthClientId: string;
  readonly apiClientId: string;
  readonly tokenUserId: string;
  readonly kpiId: string;
  readonly sameRequest: boolean;
}

function createHarness(
  overrides: { allowed?: boolean; failure?: Error | null } = {},
) {
  const state = {
    order: [] as string[],
    profileResolutions: [] as Array<{ apiClientId: string; routeId: string }>,
    consumptions: [] as ApiRateLimitStoreInput[],
    reads: [] as KpiDetailReadCall[],
    allowed: overrides.allowed ?? true,
    failure: overrides.failure ?? null,
  };

  const request = new Request("https://mcp.example.test/mcp", {
    method: "POST",
    headers: { authorization: `Bearer ${VALID_TOKEN}` },
  });

  const execution = buildMcpExecutionContext(authorizedFixture());

  const executor = createMcpKpiDetailToolExecutor({
    request,
    authorized: authorizedFixture(),
    execution,
    reader: (
      req: Request,
      context: AuthenticatedApiContext,
      kpiId: string,
    ) => {
      state.order.push("reader");
      state.reads.push({
        authorization: req.headers.get("authorization"),
        oauthClientId: context.client.oauthClientId,
        apiClientId: context.client.apiClientId,
        tokenUserId: context.token.userId,
        kpiId,
        sameRequest: req === request,
      });
      if (state.failure !== null) return Promise.reject(state.failure);
      return Promise.resolve(KPI_PAYLOAD);
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

Deno.test("KPI-2C (A): kpis.get_by_id is exposed exactly once as btpm_get_kpi", () => {
  const entries = MCP_TOOL_REGISTRY.filter(
    (entry) => entry.operationId === "kpis.get_by_id",
  );
  assertStrictEquals(entries.length, 1);
  assertStrictEquals(entries[0].toolName, MCP_KPI_DETAIL_TOOL_NAME);
  assertStrictEquals(entries[0].toolName, "btpm_get_kpi");
  assertStrictEquals(entries[0].exposure, "exposed");
  assertStrictEquals(entries[0].operationClass, "read");
  assertStrictEquals(entries[0].confirmation, "not_required");
  assertStrictEquals(entries[0].resultShape, "single_object");
  assertStrictEquals(entries[0].concurrencyToken, "not_applicable");
  assertStrictEquals(isMcpOperationExposed("kpis.get_by_id"), true);
});

Deno.test("KPI-2C (A): btpm_list_project_kpis stays unchanged and exposed once", () => {
  const entries = MCP_TOOL_REGISTRY.filter(
    (entry) => entry.operationId === "kpis.get",
  );
  assertStrictEquals(entries.length, 1);
  assertStrictEquals(entries[0].toolName, "btpm_list_project_kpis");
  assertStrictEquals(entries[0].exposure, "exposed");
  assertStrictEquals(entries[0].resultShape, "bounded_collection");
  const exposed = exposedMcpTools();
  assertStrictEquals(
    exposed.filter((tool) => tool.toolName === "btpm_get_kpi").length,
    1,
  );
  assertStrictEquals(
    new Set(exposed.map((tool) => tool.toolName)).size,
    exposed.length,
  );
});

// ------------------------------------------------------------------- B. Input

Deno.test("KPI-2C (B): the tool input exposes only kpiId", () => {
  assertEquals(Object.keys(MCP_KPI_DETAIL_TOOL_INPUT_SCHEMA.shape), ["kpiId"]);
  assertStrictEquals(
    MCP_KPI_DETAIL_TOOL_INPUT_SCHEMA.safeParse({}).success,
    false,
  );
  assertStrictEquals(
    MCP_KPI_DETAIL_TOOL_INPUT_SCHEMA.safeParse({ kpiId: KPI_ID }).success,
    true,
  );
});

Deno.test("KPI-2C (B): the canonical path is built verbatim without repair", () => {
  assertStrictEquals(
    buildCanonicalKpiDetailPath({ kpiId: KPI_ID }),
    `/v1/kpis/${KPI_ID}`,
  );
  assertStrictEquals(
    buildCanonicalKpiDetailPath({ kpiId: ` ${KPI_ID.toUpperCase()} ` }),
    `/v1/kpis/ ${KPI_ID.toUpperCase()} `,
  );
});

// --------------------------------------------------------------- C. Execution

Deno.test("KPI-2C (C): a valid KPI ID reaches the delegated reader unchanged", async () => {
  const { state, executor, request } = createHarness();
  const result = await executor({ kpiId: KPI_ID });
  assert(result.ok);
  assertStrictEquals(result.payload, KPI_PAYLOAD);
  assertEquals(state.order, ["profile", "rateLimit", "reader"]);
  assertStrictEquals(state.reads.length, 1);
  assertStrictEquals(state.reads[0].kpiId, KPI_ID);
  assertStrictEquals(state.reads[0].sameRequest, true);
  assertStrictEquals(
    state.reads[0].authorization,
    `Bearer ${VALID_TOKEN}`,
  );
  assertStrictEquals(state.reads[0].oauthClientId, OAUTH_CLIENT_ID);
  assertStrictEquals(state.reads[0].apiClientId, API_CLIENT_ID);
  assertStrictEquals(state.reads[0].tokenUserId, USER_ID);
  assertStrictEquals(request.bodyUsed, false);
});

Deno.test("KPI-2C (C): malformed KPI IDs fail closed as invalid_arguments", async () => {
  for (
    const kpiId of [
      "",
      "not-a-uuid",
      "00000000-0000-0000-0000-000000000000",
      KPI_ID.toUpperCase(),
      encodeURIComponent(KPI_ID) + "%20",
      `${KPI_ID}%2F`,
      ` ${KPI_ID}`,
      `${KPI_ID} `,
      `${KPI_ID}/history`,
      `${KPI_ID}/`,
      `../${KPI_ID}`,
      `${KPI_ID}?limit=1`,
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

Deno.test("KPI-2C (C): the canonical parser is the validator, not the schema", () => {
  // The structural schema accepts any string; only the canonical parser rejects.
  assertStrictEquals(
    MCP_KPI_DETAIL_TOOL_INPUT_SCHEMA.safeParse({ kpiId: "not-a-uuid" }).success,
    true,
  );
});

// -------------------------------------------------------------- D. Rate limit

Deno.test("KPI-2C (D): the rate-limit profile and identity are canonical", async () => {
  const { state, executor } = createHarness();
  await executor({ kpiId: KPI_ID });
  assertEquals(state.profileResolutions, [
    { apiClientId: API_CLIENT_ID, routeId: "kpis.get_by_id" },
  ]);
  assertStrictEquals(KPI_DETAIL_ROUTE.id, "kpis.get_by_id");
  assertStrictEquals(state.consumptions.length, 1);
  assertStrictEquals(state.consumptions[0].apiClientId, API_CLIENT_ID);
  assertStrictEquals(state.consumptions[0].userId, USER_ID);
  assertStrictEquals(state.consumptions[0].routeId, "kpis.get_by_id");
});

Deno.test("KPI-2C (D): exhaustion prevents the business reader", async () => {
  const { state, executor } = createHarness({ allowed: false });
  const result = await executor({ kpiId: KPI_ID });
  assertStrictEquals(result.ok, false);
  if (!result.ok) assertStrictEquals(result.category, "rate_limited");
  assertStrictEquals(state.reads.length, 0);
  assertEquals(state.order, ["profile", "rateLimit"]);
});

// ------------------------------------------------------------------ E. Errors

Deno.test("KPI-2C (E): delegated not_authorized maps to bounded not_authorized", async () => {
  const { executor } = createHarness({
    failure: new ApiHttpError("not_authorized"),
  });
  const result = await executor({ kpiId: KPI_ID });
  assertStrictEquals(result.ok, false);
  if (!result.ok) {
    assertStrictEquals(result.category, "not_authorized");
    assertStrictEquals(
      MCP_KPI_DETAIL_TOOL_ERROR_MESSAGES[result.category],
      "Not authorized to access KPI.",
    );
  }
});

Deno.test("KPI-2C (E): unexpected errors map to unavailable without leakage", async () => {
  const { executor } = createHarness({
    failure: new Error(
      'permission denied for function api_v1_get_kpi SQLSTATE 42501 policy',
    ),
  });
  const result = await executor({ kpiId: KPI_ID });
  assertStrictEquals(result.ok, false);
  if (!result.ok) {
    assertStrictEquals(result.category, "unavailable");
    assertStrictEquals(
      MCP_KPI_DETAIL_TOOL_ERROR_MESSAGES[result.category],
      "BTPM KPI read is temporarily unavailable.",
    );
  }
  for (const message of Object.values(MCP_KPI_DETAIL_TOOL_ERROR_MESSAGES)) {
    for (
      const forbidden of ["42501", "policy", "select ", "supabase", "token"]
    ) {
      assertStrictEquals(message.toLowerCase().includes(forbidden), false);
    }
  }
});

Deno.test("KPI-2C (E): exactly the four bounded categories are declared", () => {
  assertEquals(Object.keys(MCP_KPI_DETAIL_TOOL_ERROR_MESSAGES).sort(), [
    "invalid_arguments",
    "not_authorized",
    "rate_limited",
    "unavailable",
  ]);
});

// ------------------------------------------------------------- F. Containment

Deno.test("KPI-2C (F): the trusted execution context never carries the bearer", () => {
  const { execution } = createHarness();
  const serialized = JSON.stringify(execution);
  assertStrictEquals(serialized.includes(VALID_TOKEN), false);
  assertStrictEquals(serialized.includes("Bearer"), false);
  assertStrictEquals(execution.apiClientId, API_CLIENT_ID);
  assertStrictEquals(execution.executingUserId, USER_ID);
});

Deno.test("KPI-2C (F): the KPI adapter has no alternate authority or data path", async () => {
  const raw = await Deno.readTextFile(
    new URL(
      "../../../functions/btpm-mcp/mcp/kpiReadTool.ts",
      import.meta.url,
    ),
  );
  // Executable surface only: documentation comments describe what is absent.
  const source = raw
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//") &&
      !line.trimStart().startsWith("*") &&
      !line.trimStart().startsWith("/*"))
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
      "api_v1_get_kpi",
      "api_v1_list_project_kpis",
      "decrypt",
      "console.log",
      "btpm-api-v1",
    ]
  ) {
    assertStrictEquals(source.includes(forbidden), false, forbidden);
  }
  for (
    const reused of [
      "parseApiV1KpiDetailPath",
      "KPI_DETAIL_ROUTE",
      "buildAuthenticatedApiContextFromMcp",
      "enforceApiRateLimit",
    ]
  ) {
    assert(source.includes(reused), reused);
  }
});

Deno.test("KPI-2C (F): serverFactory has exactly one bounded btpm_get_kpi branch", async () => {
  const source = await Deno.readTextFile(
    new URL(
      "../../../functions/btpm-mcp/mcp/serverFactory.ts",
      import.meta.url,
    ),
  );
  assertStrictEquals(
    source.split("MCP_KPI_DETAIL_TOOL_NAME").length - 1 >= 1,
    true,
  );
  assertStrictEquals(
    source.split("executors.kpiGetById(args)").length - 1,
    1,
  );
  assert(source.includes("MCP_KPI_DETAIL_TOOL_INPUT_SCHEMA"));
  assert(source.includes("MCP_KPI_DETAIL_TOOL_ERROR_MESSAGES"));
  assert(source.includes("BTPM_MCP_READ_TOOL_ANNOTATIONS"));
  // No generic operation-ID/executor dispatcher.
  for (
    const forbidden of [
      "executors[",
      "EXECUTOR_BY_OPERATION",
      "operationId]",
    ]
  ) {
    assertStrictEquals(source.includes(forbidden), false, forbidden);
  }
});

Deno.test("KPI-2C (F): read annotations stay read-only/idempotent/closed-world", async () => {
  const source = await Deno.readTextFile(
    new URL(
      "../../../functions/btpm-mcp/mcp/serverFactory.ts",
      import.meta.url,
    ),
  );
  const index = source.indexOf("BTPM_MCP_READ_TOOL_ANNOTATIONS = ");
  assert(index > 0);
  const block = source.slice(index, index + 400);
  assert(block.includes("readOnlyHint: true"));
  assert(block.includes("destructiveHint: false"));
  assert(block.includes("idempotentHint: true"));
  assert(block.includes("openWorldHint: false"));
});

Deno.test("KPI-2C (F): btpm-mcp wires a caller-scoped anon KPI detail reader", async () => {
  const source = await Deno.readTextFile(
    new URL("../../../functions/btpm-mcp/index.ts", import.meta.url),
  );
  assert(source.includes("createDelegatedApiV1KpiReader("));
  assert(source.includes("createMcpKpiDetailToolExecutor({"));
  assert(source.includes("reader: runtime.kpiReader,"));
  assert(source.includes("supabaseAnonKey"));
  assertStrictEquals(source.split("kpiGetById,").length - 1, 1);
  const start = source.indexOf("createMcpKpiDetailToolExecutor({");
  const block = source.slice(start, start + 400);
  assert(block.includes("request,"));
  assert(block.includes("authorized,"));
  assert(block.includes("execution: executionContext,"));
  assert(block.includes("rateLimitProfileResolver: runtime.rateLimitProfileResolver,"));
  assert(block.includes("rateLimitStore: runtime.rateLimitStore,"));
  assertStrictEquals(block.includes("SERVICE_ROLE"), false);
});

// ---------------------------------------------------------------- G. Topology
//
// KPI-R1: the former absolute global-cardinality freeze (46 registry entries)
// was removed. Global registry cardinality is owned exclusively by the
// current-surface / registry guards, never by a historical feature-step test.
// The durable local invariant KPI-2C still owns is operation-ID uniqueness.

Deno.test("KPI-2C (G): registry operation IDs remain unique", () => {
  assertStrictEquals(
    new Set(MCP_TOOL_REGISTRY.map((entry) => entry.operationId)).size,
    MCP_TOOL_REGISTRY.length,
  );
});

