// Relocated out of supabase/functions/ (Edge deploy bundle size).
// Source-file reads stay anchored to the original module location.
const __BTPM_SRC_BASE__ = new URL('../../../functions/btpm-mcp/mcp/api-q-wml-1c-workspace-members-read-tool_test.ts', import.meta.url).href;
// API-Q WML-1C — Focused proofs for the MCP read exposure of the canonical
// `workspace_members.get` operation. These tests exercise the real adapter
// against doubles for the accepted WML-1B delegated reader and the canonical
// rate-limit adapters, so the MCP SDK transport is not required.

import {
  assert,
  assertEquals,
  assertStrictEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { WORKSPACE_MEMBERS_ROUTE } from "../../../functions/_shared/btpm-api/routes/workspaceMembers.ts";
import type { AuthenticatedApiContext } from "../../../functions/_shared/btpm-api/authenticateApiRequest.ts";
import { ApiHttpError } from "../../../functions/_shared/btpm-api/http.ts";
import type {
  ApiRateLimitStoreInput,
  ApiRateLimitStoreResult,
} from "../../../functions/_shared/btpm-api/rateLimit.ts";
import type { ApiV1WorkspaceMembersPayload } from "../../../functions/_shared/btpm-api/supabaseWorkspaceMembers.ts";
import type { McpAuthorizedContext } from "../../../functions/btpm-mcp/mcp/authorizeMcpConnectedApp.ts";
import { buildMcpExecutionContext } from "../../../functions/btpm-mcp/mcp/buildMcpExecutionContext.ts";
import {
  buildCanonicalWorkspaceMembersPathname,
  buildCanonicalWorkspaceMembersQueryString,
  createMcpWorkspaceMembersToolExecutor,
  MCP_WORKSPACE_MEMBERS_TOOL_ERROR_MESSAGES,
  MCP_WORKSPACE_MEMBERS_TOOL_INPUT_SCHEMA,
  MCP_WORKSPACE_MEMBERS_TOOL_NAME,
} from "../../../functions/btpm-mcp/mcp/workspaceMembersReadTool.ts";
import {
  exposedMcpTools,
  isMcpOperationExposed,
  MCP_TOOL_REGISTRY,
} from "../../../functions/btpm-mcp/mcp/toolRegistry.ts";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const API_CLIENT_ID = "22222222-2222-4222-8222-222222222222";
const OAUTH_CLIENT_ID = "btpm-connected-app";
const POLICY_VERSION_ID = "33333333-3333-4333-8333-333333333333";
const WORKSPACE_ID = "44444444-4444-4444-8444-444444444444";
const VALID_TOKEN = "header.payload.signature";

const MEMBERS_PAYLOAD: ApiV1WorkspaceMembersPayload = Object.freeze({
  items: Object.freeze([
    Object.freeze({
      userId: "55555555-5555-4555-8555-555555555555",
      displayName: "Example User",
      email: "vit@example.test",
    }),
    // Null display name / email must survive unchanged.
    Object.freeze({
      userId: "66666666-6666-4666-8666-666666666667",
      displayName: null,
      email: null,
    }),
  ]),
  pagination: Object.freeze({ limit: 50, offset: 0, returned: 2, total: 2 }),
}) as ApiV1WorkspaceMembersPayload;

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

interface MembersReadCall {
  readonly authorization: string | null;
  readonly oauthClientId: string;
  readonly apiClientId: string;
  readonly tokenUserId: string;
  readonly workspaceId: string;
  readonly limit: number;
  readonly offset: number;
  readonly search: string | null;
}

interface Harness {
  profileResolutions: Array<{ apiClientId: string; routeId: string }>;
  consumptions: ApiRateLimitStoreInput[];
  reads: MembersReadCall[];
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

  const executor = createMcpWorkspaceMembersToolExecutor({
    request,
    authorized: authorizedFixture(),
    execution: buildMcpExecutionContext(authorizedFixture()),
    reader: (
      req: Request,
      context: AuthenticatedApiContext,
      workspaceId: string,
      limit: number,
      offset: number,
      search: string | null,
    ) => {
      state.reads.push({
        authorization: req.headers.get("authorization"),
        oauthClientId: context.client.oauthClientId,
        apiClientId: context.client.apiClientId,
        tokenUserId: context.token.userId,
        workspaceId,
        limit,
        offset,
        search,
      });
      if (state.failure !== null) return Promise.reject(state.failure);
      return Promise.resolve(MEMBERS_PAYLOAD);
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

// ---------------------------------------------------------------- A. Registry

Deno.test("WML-1C (A): workspace_members.get is exposed exactly once with unchanged metadata", () => {
  const entries = MCP_TOOL_REGISTRY.filter(
    (entry) => entry.operationId === "workspace_members.get",
  );
  assertStrictEquals(entries.length, 1);
  assertStrictEquals(entries[0].toolName, "btpm_list_workspace_members");
  assertStrictEquals(entries[0].title, "List BTPM Workspace Members");
  assertStrictEquals(entries[0].operationClass, "read");
  assertStrictEquals(entries[0].exposure, "exposed");
  assertStrictEquals(entries[0].confirmation, "not_required");
  assertStrictEquals(entries[0].resultShape, "bounded_collection");
  assertStrictEquals(entries[0].concurrencyToken, "not_applicable");
  assertStrictEquals(isMcpOperationExposed("workspace_members.get"), true);
});

Deno.test("WML-1C (A): the tool name appears exactly once in the exposed inventory", () => {
  const exposed = exposedMcpTools();
  const named = exposed.filter(
    (tool) => tool.toolName === MCP_WORKSPACE_MEMBERS_TOOL_NAME,
  );
  assertStrictEquals(named.length, 1);
  assertStrictEquals(named[0].operationId, "workspace_members.get");
  // No duplicate tool names anywhere in the exposed inventory.
  assertStrictEquals(
    new Set(exposed.map((tool) => tool.toolName)).size,
    exposed.length,
  );
});

Deno.test("WML-1C (A): the only exposure-set change is workspace_members.get", () => {
  // The pre-WML-1C exposed set is reconstructed from the current registry by
  // removing exactly the Workspace-member operation; every other operation
  // keeps its own explicit decision.
  const exposedIds = exposedMcpTools().map((tool) => tool.operationId).sort();
  const withoutMembers = exposedIds.filter(
    (id) => id !== "workspace_members.get",
  );
  assertStrictEquals(exposedIds.length - withoutMembers.length, 1);
  assert(exposedIds.includes("workspace_members.get"));
  // Every registry entry still carries an explicit, valid exposure decision.
  for (const entry of MCP_TOOL_REGISTRY) {
    assert(
      entry.exposure === "exposed" || entry.exposure === "not_exposed",
      `${entry.operationId} must carry an explicit exposure decision`,
    );
  }
});

// ------------------------------------------------------------- B. Tool schema

Deno.test("WML-1C (B): workspaceId is required and limit/offset/search are optional", () => {
  assertStrictEquals(MCP_WORKSPACE_MEMBERS_TOOL_NAME, "btpm_list_workspace_members");
  assertStrictEquals(WORKSPACE_MEMBERS_ROUTE.id, "workspace_members.get");

  assertStrictEquals(
    MCP_WORKSPACE_MEMBERS_TOOL_INPUT_SCHEMA.safeParse({}).success,
    false,
  );
  assert(
    MCP_WORKSPACE_MEMBERS_TOOL_INPUT_SCHEMA.safeParse({
      workspaceId: WORKSPACE_ID,
    }).success,
  );
  assert(
    MCP_WORKSPACE_MEMBERS_TOOL_INPUT_SCHEMA.safeParse({
      workspaceId: WORKSPACE_ID,
      limit: 10,
      offset: 5,
      search: "vit",
    }).success,
  );
});

Deno.test("WML-1C (B): the schema exposes no authority, mutation or concurrency parameters", () => {
  const keys = Object.keys(MCP_WORKSPACE_MEMBERS_TOOL_INPUT_SCHEMA.shape).sort();
  assertEquals(keys, ["limit", "offset", "search", "workspaceId"]);
  for (
    const forbidden of [
      "role",
      "workspaceRole",
      "organizationId",
      "organizationRole",
      "tenantId",
      "tenantRole",
      "userId",
      "membershipId",
      "confirm",
      "confirmation",
      "idempotencyKey",
      "expectedUpdatedAt",
      "version",
    ]
  ) {
    assertEquals(
      keys.includes(forbidden),
      false,
      `the lookup schema must not expose ${forbidden}`,
    );
  }
});

// ------------------------------------------- C. Canonical validation reuse

Deno.test("WML-1C (C): omitted options resolve to canonical 50/0/null", async () => {
  const { state, executor } = createHarness();
  const result = await executor({ workspaceId: WORKSPACE_ID });

  assert(result.ok);
  assertStrictEquals(state.reads.length, 1);
  assertStrictEquals(state.reads[0].workspaceId, WORKSPACE_ID);
  assertStrictEquals(state.reads[0].limit, 50);
  assertStrictEquals(state.reads[0].offset, 0);
  assertStrictEquals(state.reads[0].search, null);
  // Canonical path shape, not a second Workspace-id contract.
  assertStrictEquals(
    buildCanonicalWorkspaceMembersPathname({ workspaceId: WORKSPACE_ID }),
    `/v1/workspaces/${WORKSPACE_ID}/members`,
  );
  // Omitted options produce no query string at all.
  assertStrictEquals(
    buildCanonicalWorkspaceMembersQueryString({ workspaceId: WORKSPACE_ID }),
    "",
  );
});

Deno.test("WML-1C (C): explicit valid options flow through the canonical parser unchanged", async () => {
  const { state, executor } = createHarness();
  const result = await executor({
    workspaceId: WORKSPACE_ID,
    limit: 25,
    offset: 10,
    search: " ad va ",
  });
  assert(result.ok);
  assertStrictEquals(state.reads[0].limit, 25);
  assertStrictEquals(state.reads[0].offset, 10);
  // Canonical trimming, no clamping and no silent repair.
  assertStrictEquals(state.reads[0].search, "ad va");
});

Deno.test("WML-1C (C): blank search becomes canonical null", async () => {
  const { state, executor } = createHarness();
  const result = await executor({ workspaceId: WORKSPACE_ID, search: "   " });
  assert(result.ok);
  assertStrictEquals(state.reads[0].search, null);
});

Deno.test("WML-1C (C): invalid Workspace IDs fail closed as invalid_arguments", async () => {
  for (
    const workspaceId of [
      "",
      "   ",
      "not-a-uuid",
      "00000000-0000-0000-0000-000000000000",
      `${WORKSPACE_ID}/extra`,
      `${WORKSPACE_ID}?x=1`,
    ]
  ) {
    const { state, executor } = createHarness();
    const result = await executor({ workspaceId });
    assertStrictEquals(result.ok, false);
    if (!result.ok) assertStrictEquals(result.category, "invalid_arguments");
    assertStrictEquals(state.reads.length, 0);
  }
});

Deno.test("WML-1C (C): out-of-range bounds and oversized search fail through the canonical parser", async () => {
  const invalid: Array<Record<string, unknown>> = [
    { limit: 101 },
    { limit: 0 },
    { limit: -1 },
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
    if (!result.ok) assertStrictEquals(result.category, "invalid_arguments");
    // Rate limiting ran first; no business read happened.
    assertStrictEquals(state.consumptions.length, 1);
    assertStrictEquals(state.reads.length, 0);
  }
});

// -------------------------------------------------------- D. Rate limiting

Deno.test("WML-1C (D): rate limiting is enforced on apiClientId + userId + workspace_members.get", async () => {
  const { state, executor } = createHarness();
  await executor({ workspaceId: WORKSPACE_ID });

  assertEquals(state.profileResolutions, [
    { apiClientId: API_CLIENT_ID, routeId: "workspace_members.get" },
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
      routeId: "workspace_members.get",
      limit: 60,
      windowSeconds: 60,
    },
  );
});

Deno.test("WML-1C (D): a denied rate limit prevents the Workspace-member read", async () => {
  const { state, executor } = createHarness({ allowed: false });
  const result = await executor({ workspaceId: WORKSPACE_ID });
  assertStrictEquals(result.ok, false);
  if (!result.ok) assertStrictEquals(result.category, "rate_limited");
  assertStrictEquals(state.reads.length, 0);
});

// ------------------------------------------------ E. Delegated business read

Deno.test("WML-1C (E): the delegated reader runs exactly once with the original request and derived context", async () => {
  const { state, executor } = createHarness();
  await executor({ workspaceId: WORKSPACE_ID });

  assertStrictEquals(state.reads.length, 1);
  assertStrictEquals(state.reads[0].authorization, `Bearer ${VALID_TOKEN}`);
  assertStrictEquals(state.reads[0].oauthClientId, OAUTH_CLIENT_ID);
  assertStrictEquals(state.reads[0].apiClientId, API_CLIENT_ID);
  assertStrictEquals(state.reads[0].tokenUserId, USER_ID);
});

Deno.test("WML-1C (E): the adapter contains no direct RPC/table read and no service role", () => {
  const source = Deno.readTextFileSync(
    new URL("./workspaceMembersReadTool.ts", __BTPM_SRC_BASE__),
  );
  const code = source
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
  for (
    const forbidden of [
      ".from(",
      ".rpc(",
      "api_v1_list_workspace_members",
      "SERVICE_ROLE",
      "Deno.env",
      "fetch(",
      "createClient",
      "select ",
    ]
  ) {
    assertEquals(
      code.includes(forbidden),
      false,
      `the MCP Workspace-member adapter must not contain ${forbidden}`,
    );
  }
  for (
    const reused of [
      "parseApiV1WorkspaceMembersPath",
      "parseApiV1WorkspaceMembersQuery",
      "WORKSPACE_MEMBERS_ROUTE.id",
      "enforceApiRateLimit",
      "buildAuthenticatedApiContextFromMcp",
      "DelegatedApiV1WorkspaceMembersReader",
    ]
  ) {
    assert(source.includes(reused), `expected reuse of ${reused}`);
  }
});

// ------------------------------------------------------- F. Result / privacy

Deno.test("WML-1C (F): the canonical payload passes through unchanged with nulls preserved", async () => {
  const { executor } = createHarness();
  const result = await executor({ workspaceId: WORKSPACE_ID });
  assert(result.ok);
  assertEquals(result.payload, MEMBERS_PAYLOAD);
  assertEquals(Object.keys(result.payload).sort(), ["items", "pagination"]);
  for (const item of result.payload.items) {
    assertEquals(Object.keys(item).sort(), ["displayName", "email", "userId"]);
  }
  assertStrictEquals(result.payload.items[1].displayName, null);
  assertStrictEquals(result.payload.items[1].email, null);
  assertEquals(Object.keys(result.payload.pagination).sort(), [
    "limit",
    "offset",
    "returned",
    "total",
  ]);
});

// --------------------------------------------------------- G. Error mapping

Deno.test("WML-1C (G): canonical error codes map to the four bounded categories", async () => {
  const cases: Array<[Error, string, string]> = [
    [
      new ApiHttpError("invalid_request"),
      "invalid_arguments",
      "Invalid arguments.",
    ],
    [
      new ApiHttpError("not_authorized"),
      "not_authorized",
      "Not authorized to access Workspace members.",
    ],
    [
      new ApiHttpError("rate_limit_exceeded"),
      "rate_limited",
      "Rate limit exceeded. Try again later.",
    ],
    [
      new ApiHttpError("internal_error"),
      "unavailable",
      "BTPM Workspace member read is temporarily unavailable.",
    ],
    [
      new Error("boom"),
      "unavailable",
      "BTPM Workspace member read is temporarily unavailable.",
    ],
  ];
  for (const [failure, category, message] of cases) {
    const { executor } = createHarness({ failure });
    const result = await executor({ workspaceId: WORKSPACE_ID });
    assertStrictEquals(result.ok, false);
    if (!result.ok) {
      assertStrictEquals(result.category, category);
      assertStrictEquals(
        MCP_WORKSPACE_MEMBERS_TOOL_ERROR_MESSAGES[result.category],
        message,
      );
    }
  }
  assertEquals(
    Object.keys(MCP_WORKSPACE_MEMBERS_TOOL_ERROR_MESSAGES).sort(),
    ["invalid_arguments", "not_authorized", "rate_limited", "unavailable"],
  );
});

Deno.test("WML-1C (G): database detail and bearer tokens never leak", async () => {
  const { executor } = createHarness({
    failure: new Error(
      `42501: permission denied for table profiles (policy wm_select) ${POLICY_VERSION_ID} ${VALID_TOKEN}`,
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
});

// -------------------------------------------- H/I. serverFactory + runtime

Deno.test("WML-1C (H): serverFactory registers the tool once with read annotations", () => {
  const source = Deno.readTextFileSync(
    new URL("./serverFactory.ts", __BTPM_SRC_BASE__),
  );
  assertStrictEquals(
    source.split("MCP_WORKSPACE_MEMBERS_TOOL_NAME").length - 1,
    2, // one import binding + one explicit tool-name branch
  );
  assert(source.includes("workspaceMembersGet: McpWorkspaceMembersToolExecutor"));
  assert(source.includes("inputSchema: MCP_WORKSPACE_MEMBERS_TOOL_INPUT_SCHEMA"));
  assert(
    source.includes(
      "MCP_WORKSPACE_MEMBERS_TOOL_ERROR_MESSAGES[result.category]",
    ),
  );
  // The branch uses the shared read annotations.
  assert(source.includes("readOnlyHint: true"));
  assert(source.includes("destructiveHint: false"));
  assert(source.includes("idempotentHint: true"));
  assert(source.includes("openWorldHint: false"));
  // No generic dispatcher was introduced.
  assertEquals(source.includes("executors[tool.operationId]"), false);
});

Deno.test("WML-1C (I): btpm-mcp constructs the anon-key delegated reader and supplies the executor", () => {
  const source = Deno.readTextFileSync(
    new URL("../../btpm-mcp/index.ts", __BTPM_SRC_BASE__),
  );
  assert(source.includes("createDelegatedApiV1WorkspaceMembersReader("));
  assert(source.includes("createMcpWorkspaceMembersToolExecutor({"));
  assert(source.includes("reader: runtime.workspaceMembersReader"));
  assert(source.includes("workspaceMembersGet,"));
  // The reader is built with the anon key, never the service-role key.
  const readerBlock = source.slice(
    source.indexOf("createDelegatedApiV1WorkspaceMembersReader("),
    source.indexOf("createDelegatedApiV1WorkspaceMembersReader(") + 320,
  );
  assert(readerBlock.includes("supabaseAnonKey"));
  assertEquals(readerBlock.includes("SERVICE_ROLE"), false);
});

Deno.test("WML-1C (I): the lookup adapter references no Task Assign contract", () => {
  const source = Deno.readTextFileSync(
    new URL("./workspaceMembersReadTool.ts", __BTPM_SRC_BASE__),
  );
  for (
    const forbidden of [
      "assign",
      "Assign",
      "tasks.assign",
      "TaskAssign",
      "apply_task_assign",
      "mcp_v1_assign_task",
    ]
  ) {
    assertEquals(
      source.includes(forbidden),
      false,
      `the lookup adapter must not reference ${forbidden}`,
    );
  }
});
