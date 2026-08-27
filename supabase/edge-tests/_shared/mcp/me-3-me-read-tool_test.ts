// ME-3 — Focused proofs for the MCP read exposure of the canonical `me.get`
// operation. These tests exercise the real adapter against doubles for the
// accepted ME-2 delegated reader and the canonical rate-limit adapters, so the
// MCP SDK transport is not required.

import {
  assert,
  assertEquals,
  assertStrictEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  ME_ROUTE,
  type ApiV1MeQuery,
} from "../../../functions/_shared/btpm-api/routes/me.ts";
import type { AuthenticatedApiContext } from "../../../functions/_shared/btpm-api/authenticateApiRequest.ts";
import { ApiHttpError } from "../../../functions/_shared/btpm-api/http.ts";
import type {
  ApiRateLimitStoreInput,
  ApiRateLimitStoreResult,
} from "../../../functions/_shared/btpm-api/rateLimit.ts";
import type { ApiV1MePayload } from "../../../functions/_shared/btpm-api/supabaseReadMe.ts";
import type { McpAuthorizedContext } from "../../../functions/btpm-mcp/mcp/authorizeMcpConnectedApp.ts";
import { buildMcpExecutionContext } from "../../../functions/btpm-mcp/mcp/buildMcpExecutionContext.ts";
import {
  buildCanonicalMeQueryString,
  createMcpMeToolExecutor,
  MCP_ME_TOOL_ERROR_MESSAGES,
  MCP_ME_TOOL_INPUT_SCHEMA,
  MCP_ME_TOOL_NAME,
} from "../../../functions/btpm-mcp/mcp/meReadTool.ts";
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
const OTHER_ID = "55555555-5555-4555-8555-555555555555";
const VALID_TOKEN = "header.payload.signature";

const ME_PAYLOAD = Object.freeze({
  userId: USER_ID,
  displayName: "Example User",
  email: "vit@example.test",
  isActive: true,
  platformSuperAdmin: false,
  context: null,
}) as unknown as ApiV1MePayload;

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

interface MeReadCall {
  readonly authorization: string | null;
  readonly oauthClientId: string;
  readonly apiClientId: string;
  readonly tokenUserId: string;
  readonly query: ApiV1MeQuery;
}

function createHarness(
  overrides: { allowed?: boolean; failure?: Error | null } = {},
) {
  const state = {
    profileResolutions: [] as Array<{ apiClientId: string; routeId: string }>,
    consumptions: [] as ApiRateLimitStoreInput[],
    reads: [] as MeReadCall[],
    allowed: overrides.allowed ?? true,
    failure: overrides.failure ?? null,
  };

  const request = new Request("https://mcp.example.test/mcp", {
    method: "POST",
    headers: { authorization: `Bearer ${VALID_TOKEN}` },
  });

  const executor = createMcpMeToolExecutor({
    request,
    authorized: authorizedFixture(),
    execution: buildMcpExecutionContext(authorizedFixture()),
    reader: (
      req: Request,
      context: AuthenticatedApiContext,
      query: ApiV1MeQuery,
    ) => {
      state.reads.push({
        authorization: req.headers.get("authorization"),
        oauthClientId: context.client.oauthClientId,
        apiClientId: context.client.apiClientId,
        tokenUserId: context.token.userId,
        query,
      });
      if (state.failure !== null) return Promise.reject(state.failure);
      return Promise.resolve(ME_PAYLOAD);
    },
    rateLimitProfileResolver: {
      resolve: (apiClientId: string, routeId: string) => {
        state.profileResolutions.push({ apiClientId, routeId });
        return Promise.resolve({ limit: 60, windowSeconds: 60 });
      },
    },
    rateLimitStore: {
      consume: (
        input: ApiRateLimitStoreInput,
      ): Promise<ApiRateLimitStoreResult> => {
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

Deno.test("ME-3 (A): me.get is exposed exactly once as btpm_get_me", () => {
  const entries = MCP_TOOL_REGISTRY.filter(
    (entry) => entry.operationId === "me.get",
  );
  assertStrictEquals(entries.length, 1);
  assertStrictEquals(entries[0].toolName, MCP_ME_TOOL_NAME);
  assertStrictEquals(entries[0].toolName, "btpm_get_me");
  assertStrictEquals(entries[0].operationClass, "read");
  assertStrictEquals(entries[0].exposure, "exposed");
  assertStrictEquals(entries[0].confirmation, "not_required");
  assertStrictEquals(entries[0].resultShape, "single_object");
  assertStrictEquals(entries[0].concurrencyToken, "not_applicable");
  assertStrictEquals(isMcpOperationExposed("me.get"), true);
});

Deno.test("ME-3 (A): the advertised inventory has no duplicate tool names", () => {
  const exposed = exposedMcpTools();
  assertStrictEquals(
    exposed.filter((tool) => tool.toolName === MCP_ME_TOOL_NAME).length,
    1,
  );
  assertStrictEquals(
    new Set(exposed.map((tool) => tool.toolName)).size,
    exposed.length,
  );
  // version.get and capabilities.get keep their own accepted decisions.
  for (const id of ["version.get", "capabilities.get"]) {
    assertStrictEquals(isMcpOperationExposed(id), false);
  }
});

// ------------------------------------------------------------- B. Tool schema

Deno.test("ME-3 (B): both context fields are optional and nothing else is exposed", () => {
  assert(MCP_ME_TOOL_INPUT_SCHEMA.safeParse({}).success);
  assert(
    MCP_ME_TOOL_INPUT_SCHEMA.safeParse({
      contextType: "project",
      contextId: PROJECT_ID,
    }).success,
  );
  const keys = Object.keys(MCP_ME_TOOL_INPUT_SCHEMA.shape).sort();
  assertEquals(keys, ["contextId", "contextType"]);
  for (
    const forbidden of [
      "userId",
      "role",
      "effectiveRole",
      "tenantId",
      "impersonate",
      "platformSuperAdmin",
      "confirm",
      "idempotencyKey",
      "expectedUpdatedAt",
    ]
  ) {
    assertEquals(keys.includes(forbidden), false, `must not expose ${forbidden}`);
  }
});

// ---------------------------------------- C. Canonical query-parser reuse

Deno.test("ME-3 (C): omitted arguments produce the canonical no-context read", async () => {
  const { state, executor } = createHarness();
  const result = await executor({});

  assert(result.ok);
  assertStrictEquals(buildCanonicalMeQueryString({}), "");
  assertStrictEquals(state.reads.length, 1);
  assertEquals(state.reads[0].query, { contextType: null, contextId: null });
});

Deno.test("ME-3 (C): supplied context is passed through the canonical parser verbatim", async () => {
  for (const type of ["organization", "workspace", "project"] as const) {
    const { state, executor } = createHarness();
    const result = await executor({ contextType: type, contextId: PROJECT_ID });
    assert(result.ok);
    assertEquals(state.reads[0].query, {
      contextType: type,
      contextId: PROJECT_ID,
    });
  }
});

Deno.test("ME-3 (C): malformed or partial context fails closed as invalid_arguments", async () => {
  const cases: ReadonlyArray<Record<string, string>> = [
    { contextType: "project" },
    { contextId: PROJECT_ID },
    { contextType: "tenant", contextId: PROJECT_ID },
    { contextType: "Project", contextId: PROJECT_ID },
    { contextType: "project", contextId: "not-a-uuid" },
    {
      contextType: "project",
      contextId: "00000000-0000-0000-0000-000000000000",
    },
    { contextType: "project", contextId: ` ${PROJECT_ID}` },
    { contextType: "", contextId: "" },
  ];
  for (const args of cases) {
    const { state, executor } = createHarness();
    const result = await executor(args);
    assertStrictEquals(result.ok, false, JSON.stringify(args));
    if (!result.ok) {
      assertStrictEquals(result.category, "invalid_arguments");
      assertStrictEquals(
        MCP_ME_TOOL_ERROR_MESSAGES[result.category],
        "Invalid arguments.",
      );
    }
    // No business read may happen for invalid input.
    assertStrictEquals(state.reads.length, 0);
  }
});

Deno.test("ME-3 (C): argument values are encoded, never repaired", () => {
  assertStrictEquals(
    buildCanonicalMeQueryString({ contextType: "project", contextId: OTHER_ID }),
    `?contextType=project&contextId=${OTHER_ID}`,
  );
  assertStrictEquals(
    buildCanonicalMeQueryString({ contextType: "a&b=c" }),
    "?contextType=a%26b%3Dc",
  );
});

// --------------------------------------------------- D. Delegated authority

Deno.test("ME-3 (D): the caller's own bearer request and identity reach the reader", async () => {
  const { state, executor } = createHarness();
  await executor({});

  assertStrictEquals(state.reads[0].authorization, `Bearer ${VALID_TOKEN}`);
  assertStrictEquals(state.reads[0].oauthClientId, OAUTH_CLIENT_ID);
  assertStrictEquals(state.reads[0].apiClientId, API_CLIENT_ID);
  assertStrictEquals(state.reads[0].tokenUserId, USER_ID);
});

Deno.test("ME-3 (D): rate limiting is enforced on the canonical route before the read", async () => {
  const { state, executor } = createHarness();
  await executor({});

  assertEquals(state.profileResolutions, [
    { apiClientId: API_CLIENT_ID, routeId: ME_ROUTE.id },
  ]);
  assertStrictEquals(state.consumptions.length, 1);
  assertStrictEquals(state.consumptions[0].apiClientId, API_CLIENT_ID);
  assertStrictEquals(state.consumptions[0].userId, USER_ID);
  assertStrictEquals(state.consumptions[0].routeId, ME_ROUTE.id);
});

Deno.test("ME-3 (D): an exhausted rate limit fails closed without reading", async () => {
  const { state, executor } = createHarness({ allowed: false });
  const result = await executor({});

  assertStrictEquals(result.ok, false);
  if (!result.ok) assertStrictEquals(result.category, "rate_limited");
  assertStrictEquals(state.reads.length, 0);
});

// ------------------------------------------------------- E. Error containment

Deno.test("ME-3 (E): authorization and internal failures map to bounded categories", async () => {
  const denied = createHarness({
    failure: new ApiHttpError("not_authorized", "denied"),
  });
  const deniedResult = await denied.executor({});
  assertStrictEquals(deniedResult.ok, false);
  if (!deniedResult.ok) {
    assertStrictEquals(deniedResult.category, "not_authorized");
  }

  const broken = createHarness({
    failure: new ApiHttpError("internal_error", "42501 relation foo"),
  });
  const brokenResult = await broken.executor({});
  assertStrictEquals(brokenResult.ok, false);
  if (!brokenResult.ok) {
    assertStrictEquals(brokenResult.category, "unavailable");
  }

  const raw = createHarness({ failure: new Error("boom: service_role key") });
  const rawResult = await raw.executor({});
  assertStrictEquals(rawResult.ok, false);
  if (!rawResult.ok) assertStrictEquals(rawResult.category, "unavailable");

  // Only the four bounded messages may ever be disclosed.
  assertEquals(Object.keys(MCP_ME_TOOL_ERROR_MESSAGES).sort(), [
    "invalid_arguments",
    "not_authorized",
    "rate_limited",
    "unavailable",
  ]);
  for (const message of Object.values(MCP_ME_TOOL_ERROR_MESSAGES)) {
    for (
      const forbidden of ["42501", "service_role", "relation", "policy", "SQL"]
    ) {
      assertEquals(message.includes(forbidden), false);
    }
  }
});

// ------------------------------------------------------------ F. Thin adapter

Deno.test("ME-3 (F): the adapter contains no identity, SQL or privileged surface", async () => {
  const source = await Deno.readTextFile(
    new URL("../../../functions/btpm-mcp/mcp/meReadTool.ts", import.meta.url),
  );
  for (
    const forbidden of [
      "@supabase/supabase-js",
      "createClient",
      "Deno.env",
      "service_role",
      "SERVICE_ROLE",
      ".rpc(",
      "resolve_me_context",
      "api_v1_get_me",
      "btpm_decrypt",
      "organization_memberships",
      "workspace_members",
      "console.",
      "Deno.serve",
      "fetch(",
    ]
  ) {
    assert(!source.includes(forbidden), `adapter must not contain: ${forbidden}`);
  }
  // Exactly one business read, through the accepted delegated reader.
  assertStrictEquals(source.split("dependencies.reader(").length - 1, 1);
  assertStrictEquals(source.split("parseApiV1MeQuery(").length - 1, 1);
});

Deno.test("ME-3 (F): the MCP runtime wires the accepted delegated Me reader", async () => {
  const index = await Deno.readTextFile(
    new URL("../../../functions/btpm-mcp/index.ts", import.meta.url),
  );
  assert(index.includes("createDelegatedApiV1MeReader("));
  assert(index.includes("createMcpMeToolExecutor("));
  assert(index.includes("reader: runtime.meReader,"));
  assert(index.includes("        meGet,"));

  const factory = await Deno.readTextFile(
    new URL("../../../functions/btpm-mcp/mcp/serverFactory.ts", import.meta.url),
  );
  assert(factory.includes("MCP_ME_TOOL_NAME"));
  assertStrictEquals(factory.split("executors.meGet(").length - 1, 1);
});
