// Relocated out of supabase/functions/ (Edge deploy bundle size).
// Source-file reads stay anchored to the original module location.
const __BTPM_SELF_URL__ = import.meta.url;
const __BTPM_SRC_BASE__ = new URL('../../../functions/btpm-mcp/mcp/api-q-7c-projects-read-tool_test.ts', import.meta.url).href;
// API-Q.7C — Focused proofs for the third MCP business-read vertical slice
// (`projects.get`). These tests exercise the real adapter against doubles for
// the accepted delegated reader and the canonical rate-limit adapters, so the
// MCP SDK transport is not required.

import {
  assert,
  assertEquals,
  assertStrictEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { PROJECTS_ROUTE } from "../../../functions/_shared/btpm-api/routes/projects.ts";
import type { AuthenticatedApiContext } from "../../../functions/_shared/btpm-api/authenticateApiRequest.ts";
import { ApiHttpError } from "../../../functions/_shared/btpm-api/http.ts";
import type {
  ApiRateLimitStoreInput,
  ApiRateLimitStoreResult,
} from "../../../functions/_shared/btpm-api/rateLimit.ts";
import type {
  ApiV1ProjectsPayload,
  ApiV1ProjectsQuery,
} from "../../../functions/_shared/btpm-api/supabaseProjects.ts";
import type { McpAuthorizedContext } from "../../../functions/btpm-mcp/mcp/authorizeMcpConnectedApp.ts";
import { buildMcpExecutionContext } from "../../../functions/btpm-mcp/mcp/buildMcpExecutionContext.ts";
import {
  buildCanonicalProjectsQueryString,
  createMcpProjectsToolExecutor,
  MCP_PROJECTS_TOOL_ERROR_MESSAGES,
  MCP_PROJECTS_TOOL_INPUT_SCHEMA,
  MCP_PROJECTS_TOOL_NAME,
} from "../../../functions/btpm-mcp/mcp/projectsReadTool.ts";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const API_CLIENT_ID = "22222222-2222-4222-8222-222222222222";
const OAUTH_CLIENT_ID = "btpm-connected-app";
const POLICY_VERSION_ID = "33333333-3333-4333-8333-333333333333";
const ORGANIZATION_ID = "44444444-4444-4444-8444-444444444444";
const WORKSPACE_ID = "55555555-5555-4555-8555-555555555555";
const VALID_TOKEN = "header.payload.signature";

const PROJECTS_PAYLOAD: ApiV1ProjectsPayload = Object.freeze({
  items: Object.freeze([
    Object.freeze({
      projectId: "66666666-6666-4666-8666-666666666666",
      organizationId: ORGANIZATION_ID,
      workspaceId: WORKSPACE_ID,
      programId: null,
      name: "SAP S/4 Rollout",
      status: "active",
      priority: "high",
      projectStage: null,
      deliveryModel: null,
      startDate: "2026-01-01",
      targetEndDate: null,
      agileEnabled: false,
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
    requestId: "77777777-7777-4777-8777-777777777777",
    issuer: "https://example.supabase.co/auth/v1",
    audiences: Object.freeze(["authenticated"]),
    expiresAt: 1_900_000_000,
  }) as McpAuthorizedContext;
}

interface ProjectsReadCall {
  readonly authorization: string | null;
  readonly oauthClientId: string;
  readonly apiClientId: string;
  readonly tokenUserId: string;
  readonly query: ApiV1ProjectsQuery;
}

interface Harness {
  profileResolutions: Array<{ apiClientId: string; routeId: string }>;
  consumptions: ApiRateLimitStoreInput[];
  reads: ProjectsReadCall[];
  allowed: boolean;
  failure: Error | null;
}

function createHarness(
  overrides: Partial<Pick<Harness, "allowed" | "failure">> = {},
) {
  const state: Harness = {
    profileResolutions: [],
    consumptions: [],
    reads: [],
    allowed: overrides.allowed ?? true,
    failure: overrides.failure ?? null,
  };

  const request = new Request("https://mcp.example.test/mcp", {
    method: "POST",
    headers: { authorization: `Bearer ${VALID_TOKEN}` },
  });

  const executor = createMcpProjectsToolExecutor({
    request,
    authorized: authorizedFixture(),
    execution: buildMcpExecutionContext(authorizedFixture()),
    reader: (
      req: Request,
      context: AuthenticatedApiContext,
      query: ApiV1ProjectsQuery,
    ) => {
      state.reads.push({
        authorization: req.headers.get("authorization"),
        oauthClientId: context.client.oauthClientId,
        apiClientId: context.client.apiClientId,
        tokenUserId: context.token.userId,
        query,
      });
      if (state.failure !== null) return Promise.reject(state.failure);
      return Promise.resolve(PROJECTS_PAYLOAD);
    },
    rateLimitProfileResolver: {
      resolve: (apiClientId: string, routeId: string) => {
        state.profileResolutions.push({ apiClientId, routeId });
        return Promise.resolve({ limit: 60, windowSeconds: 60 });
      },
    },
    rateLimitStore: {
      consume: (input: ApiRateLimitStoreInput): Promise<
        ApiRateLimitStoreResult
      > => {
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

Deno.test("API-Q.7C (D/E/F): tool identity, name and required workspaceId", () => {
  assertStrictEquals(MCP_PROJECTS_TOOL_NAME, "btpm_list_projects");
  assertStrictEquals(PROJECTS_ROUTE.id, "projects.get");
  assert(
    buildCanonicalProjectsQueryString({ workspaceId: WORKSPACE_ID })
      .startsWith(`?workspace_id=${WORKSPACE_ID}`),
  );
  // workspaceId is required by the advertised schema; optionals are optional.
  assertStrictEquals(
    MCP_PROJECTS_TOOL_INPUT_SCHEMA.safeParse({}).success,
    false,
  );
  assert(
    MCP_PROJECTS_TOOL_INPUT_SCHEMA.safeParse({ workspaceId: WORKSPACE_ID })
      .success,
  );
});

Deno.test("API-Q.7C (H/N/O): omitted arguments resolve to canonical 50/0/null and reuse the delegated reader", async () => {
  const { state, executor } = createHarness();
  const result = await executor({ workspaceId: WORKSPACE_ID });

  assert(result.ok);
  assertEquals(result.payload, PROJECTS_PAYLOAD);
  assertStrictEquals(state.reads.length, 1);
  assertEquals(state.reads[0].query, {
    workspaceId: WORKSPACE_ID,
    limit: 50,
    offset: 0,
    search: null,
  });
  // Caller-scoped delegated read with the caller's own bearer token.
  assertStrictEquals(state.reads[0].authorization, `Bearer ${VALID_TOKEN}`);
  // Server-derived identity only.
  assertStrictEquals(state.reads[0].oauthClientId, OAUTH_CLIENT_ID);
  assertStrictEquals(state.reads[0].apiClientId, API_CLIENT_ID);
  assertStrictEquals(state.reads[0].tokenUserId, USER_ID);
});

Deno.test("API-Q.7C (I): explicit valid arguments flow through the canonical parser unchanged", async () => {
  const { state, executor } = createHarness();
  const result = await executor({
    workspaceId: WORKSPACE_ID,
    limit: 25,
    offset: 10,
    search: "ad va",
  });
  assert(result.ok);
  assertEquals(state.reads[0].query, {
    workspaceId: WORKSPACE_ID,
    limit: 25,
    offset: 10,
    search: "ad va",
  });
});

Deno.test("API-Q.7C (G): missing/invalid workspaceId fails closed before the Project read", async () => {
  for (
    const workspaceId of [
      "",
      "   ",
      "not-a-uuid",
      "00000000-0000-0000-0000-000000000000",
    ]
  ) {
    const { state, executor } = createHarness();
    const result = await executor({ workspaceId });
    assertStrictEquals(result.ok, false);
    if (!result.ok) {
      assertStrictEquals(result.category, "invalid_arguments");
    }
    assertStrictEquals(state.reads.length, 0);
  }
});

Deno.test("API-Q.7C (J): out-of-range limit/offset and oversized search fail through the canonical parser", async () => {
  const invalid: Array<Record<string, unknown>> = [
    { limit: 101 },
    { limit: 0 },
    { offset: 10_001 },
    { offset: -1 },
    { search: "x".repeat(101) },
  ];
  for (const extra of invalid) {
    const { state, executor } = createHarness();
    const result = await executor(
      { workspaceId: WORKSPACE_ID, ...extra } as never,
    );
    assertStrictEquals(result.ok, false);
    if (!result.ok) {
      assertStrictEquals(result.category, "invalid_arguments");
    }
    // Rate limiting ran first; no business read happened.
    assertStrictEquals(state.consumptions.length, 1);
    assertStrictEquals(state.reads.length, 0);
  }
});

Deno.test("API-Q.7C (K/L): canonical rate limiting is enforced on apiClientId + userId + projects.get", async () => {
  const { state, executor } = createHarness();
  await executor({ workspaceId: WORKSPACE_ID });

  assertEquals(state.profileResolutions, [
    { apiClientId: API_CLIENT_ID, routeId: "projects.get" },
  ]);
  assertStrictEquals(state.consumptions.length, 1);
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
      routeId: "projects.get",
      limit: 60,
      windowSeconds: 60,
    },
  );
});

Deno.test("API-Q.7C (M): a denied rate limit prevents Project reader execution", async () => {
  const { state, executor } = createHarness({ allowed: false });
  const result = await executor({ workspaceId: WORKSPACE_ID });
  assertStrictEquals(result.ok, false);
  if (!result.ok) assertStrictEquals(result.category, "rate_limited");
  assertStrictEquals(state.reads.length, 0);
});

Deno.test("API-Q.7C (P): canonical not_authorized maps to a bounded tool error", async () => {
  const { executor } = createHarness({
    failure: new ApiHttpError("not_authorized"),
  });
  const result = await executor({ workspaceId: WORKSPACE_ID });
  assertStrictEquals(result.ok, false);
  if (!result.ok) {
    assertStrictEquals(result.category, "not_authorized");
    assertStrictEquals(
      MCP_PROJECTS_TOOL_ERROR_MESSAGES[result.category],
      "Not authorized to access Projects.",
    );
  }
});

Deno.test("API-Q.7C (Q/S): provider/database errors and bearer tokens never leak", async () => {
  const { executor } = createHarness({
    failure: new Error(
      `42501: permission denied for table projects (policy proj_members_select) ${POLICY_VERSION_ID} ${VALID_TOKEN}`,
    ),
  });
  const result = await executor({ workspaceId: WORKSPACE_ID });
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
      MCP_PROJECTS_TOOL_ERROR_MESSAGES[result.category],
      "BTPM Projects read is temporarily unavailable.",
    );
  }
});

Deno.test("API-Q.7C (S): the trusted execution context never carries the bearer token", () => {
  const context = buildMcpExecutionContext(authorizedFixture());
  assertStrictEquals(context.sourceChannel, "mcp");
  assertEquals(JSON.stringify(context).includes(VALID_TOKEN), false);
});

Deno.test("API-Q.7C (R/T): the Projects adapter duplicates no business logic and uses no service role", () => {
  const source = Deno.readTextFileSync(
    new URL("./projectsReadTool.ts", __BTPM_SRC_BASE__),
  );
  const code = source
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
  for (
    const forbidden of [
      ".from(",
      ".rpc(",
      "api_v1_list_projects",
      "SERVICE_ROLE",
      "Deno.env",
      "fetch(",
      "project_members",
      "select ",
    ]
  ) {
    assertEquals(
      code.includes(forbidden),
      false,
      `the MCP Projects adapter must not contain ${forbidden}`,
    );
  }
  for (
    const reused of [
      "parseApiV1ProjectsQuery",
      "PROJECTS_ROUTE.id",
      "enforceApiRateLimit",
      "buildAuthenticatedApiContextFromMcp",
      "DelegatedApiV1ProjectsReader",
    ]
  ) {
    assert(source.includes(reused), `expected reuse of ${reused}`);
  }
});
