// API-Q WML-1B — Focused HTTP read slice for
// GET /v1/workspaces/:workspaceid/members.
//
// Scope: route contract, strict path/query parsing, allowlist + capabilities
// registration, the caller-scoped RPC adapter, the delegated reader and the
// runtime wiring. No MCP, no Task Assign, no database authority assertions.

import {
  assert,
  assertEquals,
  assertRejects,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { ApiHttpError } from "../../_shared/btpm-api/http.ts";
import {
  WORKSPACE_MEMBERS_ROUTE,
  parseApiV1WorkspaceMembersPath,
  parseApiV1WorkspaceMembersQuery,
} from "../routes/workspaceMembers.ts";
import { API_V1_ROUTE_ALLOWLIST, matchApiRoute } from "../router.ts";
import { buildCapabilitiesPayload } from "../routes/capabilities.ts";
import { readApiV1WorkspaceMembers } from "../../_shared/btpm-api/supabaseWorkspaceMembers.ts";
import { createDelegatedApiV1WorkspaceMembersReader } from "../../_shared/btpm-api/supabaseDelegatedWorkspaceMembers.ts";

const WS = "11111111-1111-4111-8111-111111111111";
const USER_A = "22222222-2222-4222-8222-222222222222";
const USER_B = "33333333-3333-4333-8333-333333333333";
const NIL = "00000000-0000-0000-0000-000000000000";
const MEMBERS_PATH = `/v1/workspaces/${WS}/members`;

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (cause) {
    assert(cause instanceof ApiHttpError, "expected ApiHttpError");
    return (cause as ApiHttpError).code;
  }
  throw new Error("expected a throw");
}

// ---------------------------------------------------------------- route contract

Deno.test("WML-1B: exact route id / method / path / operation", () => {
  assertEquals(WORKSPACE_MEMBERS_ROUTE.id, "workspace_members.get");
  assertEquals(WORKSPACE_MEMBERS_ROUTE.method, "GET");
  assertEquals(
    WORKSPACE_MEMBERS_ROUTE.path,
    "/v1/workspaces/:workspaceid/members",
  );
  assertEquals(WORKSPACE_MEMBERS_ROUTE.operation, "read");
});

Deno.test("WML-1B: route appended to the canonical allowlist exactly once", () => {
  // Terminal position is owned by api-v1-current-surface-topology.test.ts; later
  // accepted operations are appended after this one.
  const ids = API_V1_ROUTE_ALLOWLIST.map((r) => r.id);
  assertEquals(ids.filter((id) => id === "workspace_members.get").length, 1);
  // Previously accepted operations keep their positions.
  assertEquals(ids[0], "version.get");
  assertEquals(ids[4], "workspaces.get");
});

Deno.test("WML-1B: capabilities.get advertises workspace_members.get exactly once", () => {
  const ops = buildCapabilitiesPayload().supportedOperations as readonly string[];
  assertEquals(ops.filter((o) => o === "workspace_members.get").length, 1);
});

Deno.test("WML-1B: matchApiRoute resolves the dynamic members path for GET only", () => {
  assertEquals(matchApiRoute("GET", MEMBERS_PATH), WORKSPACE_MEMBERS_ROUTE);
  assertEquals(matchApiRoute("POST", MEMBERS_PATH), null);
  assertEquals(matchApiRoute("PATCH", MEMBERS_PATH), null);
  assertEquals(matchApiRoute("PUT", MEMBERS_PATH), null);
  // The static workspaces collection is unaffected.
  assertEquals(matchApiRoute("GET", "/v1/workspaces")?.id, "workspaces.get");
});

Deno.test("WML-1B: no HTTP mutation surface is introduced for members", () => {
  const mutations = API_V1_ROUTE_ALLOWLIST.filter(
    (r) => r.operation === "mutation",
  );
  assert(
    mutations.every((r) => !r.path.includes("/members")),
    "no mutation route may target /members",
  );
});

// ------------------------------------------------------------------ path parsing

Deno.test("WML-1B: strict workspaceId path parsing", () => {
  assertEquals(parseApiV1WorkspaceMembersPath(MEMBERS_PATH), {
    workspaceId: WS,
  });
  assertEquals(codeOf(() => parseApiV1WorkspaceMembersPath("/v1/workspaces/members")), "invalid_request");
  assertEquals(codeOf(() => parseApiV1WorkspaceMembersPath(`/v1/workspaces/${WS}`)), "invalid_request");
  assertEquals(codeOf(() => parseApiV1WorkspaceMembersPath(`/v1/workspaces/${NIL}/members`)), "invalid_request");
  assertEquals(codeOf(() => parseApiV1WorkspaceMembersPath(`/v1/workspaces/not-a-uuid/members`)), "invalid_request");
  assertEquals(codeOf(() => parseApiV1WorkspaceMembersPath(`/v1/workspaces/${WS}/members/extra`)), "invalid_request");
  assertEquals(codeOf(() => parseApiV1WorkspaceMembersPath(`/v1/workspaces/${WS}/x/members`)), "invalid_request");
  assertEquals(codeOf(() => parseApiV1WorkspaceMembersPath(`/v1/workspaces/%20${WS}/members`)), "invalid_request");
  assertEquals(codeOf(() => parseApiV1WorkspaceMembersPath(`/v1/workspaces/${WS};v=1/members`)), "invalid_request");
  assertEquals(codeOf(() => parseApiV1WorkspaceMembersPath(`/v1/organizations/${WS}/members`)), "invalid_request");
});

// ----------------------------------------------------------------- query parsing

Deno.test("WML-1B: query defaults match WML-1A", () => {
  assertEquals(parseApiV1WorkspaceMembersQuery(""), {
    limit: 50,
    offset: 0,
    search: null,
  });
});

Deno.test("WML-1B: limit / offset bounds are enforced", () => {
  assertEquals(parseApiV1WorkspaceMembersQuery("?limit=1").limit, 1);
  assertEquals(parseApiV1WorkspaceMembersQuery("?limit=100").limit, 100);
  assertEquals(parseApiV1WorkspaceMembersQuery("?offset=10000").offset, 10000);
  assertEquals(codeOf(() => parseApiV1WorkspaceMembersQuery("?limit=0")), "invalid_request");
  assertEquals(codeOf(() => parseApiV1WorkspaceMembersQuery("?limit=101")), "invalid_request");
  assertEquals(codeOf(() => parseApiV1WorkspaceMembersQuery("?limit=1.5")), "invalid_request");
  assertEquals(codeOf(() => parseApiV1WorkspaceMembersQuery("?limit=-1")), "invalid_request");
  assertEquals(codeOf(() => parseApiV1WorkspaceMembersQuery("?limit=abc")), "invalid_request");
  assertEquals(codeOf(() => parseApiV1WorkspaceMembersQuery("?offset=10001")), "invalid_request");
});

Deno.test("WML-1B: search trimming, blank handling and length bound", () => {
  assertEquals(parseApiV1WorkspaceMembersQuery("?search=%20ann%20").search, "ann");
  assertEquals(parseApiV1WorkspaceMembersQuery("?search=").search, null);
  assertEquals(parseApiV1WorkspaceMembersQuery("?search=%20%20").search, null);
  assertEquals(
    parseApiV1WorkspaceMembersQuery(`?search=${"a".repeat(100)}`).search,
    "a".repeat(100),
  );
  assertEquals(
    codeOf(() => parseApiV1WorkspaceMembersQuery(`?search=${"a".repeat(101)}`)),
    "invalid_request",
  );
});

Deno.test("WML-1B: unknown, duplicate, scope and malformed query inputs are rejected", () => {
  assertEquals(codeOf(() => parseApiV1WorkspaceMembersQuery("?foo=1")), "invalid_request");
  assertEquals(codeOf(() => parseApiV1WorkspaceMembersQuery("?limit=5&limit=6")), "invalid_request");
  assertEquals(codeOf(() => parseApiV1WorkspaceMembersQuery("?organization_id=" + WS)), "invalid_request");
  assertEquals(codeOf(() => parseApiV1WorkspaceMembersQuery("?tenant_id=" + WS)), "invalid_request");
  assertEquals(codeOf(() => parseApiV1WorkspaceMembersQuery("?user_id=" + USER_A)), "invalid_request");
  assertEquals(codeOf(() => parseApiV1WorkspaceMembersQuery("?capability=x")), "invalid_request");
  assertEquals(codeOf(() => parseApiV1WorkspaceMembersQuery("?role=admin")), "invalid_request");
  assertEquals(codeOf(() => parseApiV1WorkspaceMembersQuery("?search=%E0%A4%A")), "invalid_request");
  assertEquals(codeOf(() => parseApiV1WorkspaceMembersQuery("?search=a#frag")), "invalid_request");
  assertEquals(codeOf(() => parseApiV1WorkspaceMembersQuery("limit=5")), "invalid_request");
});

// ------------------------------------------------------------------- RPC adapter

interface RpcCall {
  readonly name: string;
  readonly args: Record<string, unknown>;
}

function stubClient(
  result: unknown,
  calls: RpcCall[],
): { rpc: (n: string, a: Record<string, unknown>) => Promise<unknown> } {
  return {
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return Promise.resolve(result);
    },
  };
}

const OK_DATA = {
  items: [
    { userId: USER_A, displayName: "Ann", email: "ann@example.com" },
    { userId: USER_B, displayName: null, email: null },
  ],
  pagination: { limit: 50, offset: 0, returned: 2, total: 7 },
};

Deno.test("WML-1B: adapter calls only api_v1_list_workspace_members with exact args", async () => {
  const calls: RpcCall[] = [];
  const payload = await readApiV1WorkspaceMembers(
    stubClient({ data: OK_DATA, error: null }, calls),
    "client-abc",
    { workspaceId: WS, limit: 50, offset: 0, search: null },
  );
  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, "api_v1_list_workspace_members");
  assertEquals(Object.keys(calls[0].args).sort(), [
    "_expected_oauth_client_id",
    "_limit",
    "_offset",
    "_search",
    "_workspace_id",
  ]);
  assertEquals(calls[0].args, {
    _expected_oauth_client_id: "client-abc",
    _workspace_id: WS,
    _limit: 50,
    _offset: 0,
    _search: null,
  });
  // Exact safe payload: only userId/displayName/email + pagination.
  assertEquals(Object.keys(payload).sort(), ["items", "pagination"]);
  assertEquals(Object.keys(payload.items[0]).sort(), [
    "displayName",
    "email",
    "userId",
  ]);
  assertEquals(payload.items[1].displayName, null);
  assertEquals(payload.items[1].email, null);
  assertEquals(Object.keys(payload.pagination).sort(), [
    "limit",
    "offset",
    "returned",
    "total",
  ]);
  assertEquals(payload.pagination.total, 7);
});

Deno.test("WML-1B: adapter maps 42501 to not_authorized and 22023 to invalid_request", async () => {
  const a = await assertRejects(
    () =>
      readApiV1WorkspaceMembers(
        stubClient({ data: null, error: { code: "42501", message: "perm" } }, []),
        "client-abc",
        { workspaceId: WS, limit: 50, offset: 0, search: null },
      ),
    ApiHttpError,
  );
  assertEquals(a.code, "not_authorized");

  const b = await assertRejects(
    () =>
      readApiV1WorkspaceMembers(
        stubClient({ data: null, error: { code: "22023", message: "bad" } }, []),
        "client-abc",
        { workspaceId: WS, limit: 50, offset: 0, search: null },
      ),
    ApiHttpError,
  );
  assertEquals(b.code, "invalid_request");

  const c = await assertRejects(
    () =>
      readApiV1WorkspaceMembers(
        stubClient({ data: null, error: { code: "XX000", message: "boom" } }, []),
        "client-abc",
        { workspaceId: WS, limit: 50, offset: 0, search: null },
      ),
    ApiHttpError,
  );
  assertEquals(c.code, "internal_error");
});

Deno.test("WML-1B: malformed database output becomes internal_error", async () => {
  const malformed: readonly unknown[] = [
    null,
    { items: [], pagination: { limit: 50, offset: 0, returned: 0 } },
    {
      items: [{ userId: USER_A, displayName: "Ann", email: "a@x", role: "admin" }],
      pagination: { limit: 50, offset: 0, returned: 1, total: 1 },
    },
    {
      items: [{ userId: "nope", displayName: null, email: null }],
      pagination: { limit: 50, offset: 0, returned: 1, total: 1 },
    },
    {
      items: [],
      pagination: { limit: 50, offset: 0, returned: 1, total: 1 },
    },
    {
      items: [
        { userId: USER_A, displayName: null, email: null },
        { userId: USER_A, displayName: null, email: null },
      ],
      pagination: { limit: 50, offset: 0, returned: 2, total: 2 },
    },
    {
      items: [],
      pagination: { limit: 10, offset: 0, returned: 0, total: 0 },
    },
  ];
  for (const data of malformed) {
    const err = await assertRejects(
      () =>
        readApiV1WorkspaceMembers(
          stubClient({ data, error: null }, []),
          "client-abc",
          { workspaceId: WS, limit: 50, offset: 0, search: null },
        ),
      ApiHttpError,
    );
    assertEquals(err.code, "internal_error");
  }
});

Deno.test("WML-1B: adapter rejects invalid request values before any RPC", async () => {
  const calls: RpcCall[] = [];
  const err = await assertRejects(
    () =>
      readApiV1WorkspaceMembers(
        stubClient({ data: OK_DATA, error: null }, calls),
        "client-abc",
        { workspaceId: NIL, limit: 50, offset: 0, search: null },
      ),
    ApiHttpError,
  );
  assertEquals(err.code, "invalid_request");
  assertEquals(calls.length, 0);
});

// --------------------------------------------------------------- delegated reader

Deno.test("WML-1B: delegated reader binds the caller bearer token and the anon key", async () => {
  const created: Array<{ url: string; key: string; options: unknown }> = [];
  const calls: RpcCall[] = [];
  const reader = createDelegatedApiV1WorkspaceMembersReader(
    "https://example.supabase.co",
    "anon-key",
    (url, key, options) => {
      created.push({ url, key, options });
      return stubClient({ data: OK_DATA, error: null }, calls);
    },
  );

  const request = new Request(`https://api.test${MEMBERS_PATH}`, {
    headers: { Authorization: "Bearer caller-token" },
  });
  const payload = await reader(
    request,
    { client: { oauthClientId: "client-abc" } } as never,
    WS,
    50,
    0,
    null,
  );

  assertEquals(created.length, 1);
  assertEquals(created[0].key, "anon-key");
  assertEquals(created[0].url, "https://example.supabase.co");
  assertEquals(created[0].options, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { headers: { Authorization: "Bearer caller-token" } },
  });
  assertEquals(calls[0].name, "api_v1_list_workspace_members");
  assertEquals(calls[0].args._expected_oauth_client_id, "client-abc");
  assertEquals(payload.pagination.returned, 2);
});

Deno.test("WML-1B: no service-role key or privileged client appears in the read slice", async () => {
  const sources = [
    "../../_shared/btpm-api/supabaseWorkspaceMembers.ts",
    "../../_shared/btpm-api/supabaseDelegatedWorkspaceMembers.ts",
    "../../_shared/btpm-api/routes/workspaceMembers.ts",
  ];
  for (const rel of sources) {
    const text = await Deno.readTextFile(new URL(rel, import.meta.url));
    assert(!text.includes("SERVICE_ROLE"), `${rel} must not mention SERVICE_ROLE`);
    assert(!text.includes("serviceRole"), `${rel} must not mention serviceRole`);
    assert(!text.includes(".from("), `${rel} must not read tables directly`);
    assert(!text.includes("btpm_decrypt"), `${rel} must not touch encryption`);
  }
});

Deno.test("WML-1B: reader requires a real Request and an OAuth client id", async () => {
  const reader = createDelegatedApiV1WorkspaceMembersReader(
    "https://example.supabase.co",
    "anon-key",
    () => stubClient({ data: OK_DATA, error: null }, []),
  );
  const bad = await assertRejects(
    () => reader({} as never, { client: { oauthClientId: "c" } } as never, WS, 50, 0, null),
    ApiHttpError,
  );
  assertEquals(bad.code, "internal_error");

  const noClient = await assertRejects(
    () =>
      reader(
        new Request(`https://api.test${MEMBERS_PATH}`, {
          headers: { Authorization: "Bearer t" },
        }),
        {} as never,
        WS,
        50,
        0,
        null,
      ),
    ApiHttpError,
  );
  assertEquals(noClient.code, "internal_error");
});

Deno.test("WML-1B: factory validates its own construction inputs", () => {
  assertThrows(
    () =>
      createDelegatedApiV1WorkspaceMembersReader("", "anon", () => ({
        rpc: () => Promise.resolve({ data: null, error: null }),
      })),
    ApiHttpError,
  );
  assertThrows(
    () =>
      createDelegatedApiV1WorkspaceMembersReader("https://x", "", () => ({
        rpc: () => Promise.resolve({ data: null, error: null }),
      })),
    ApiHttpError,
  );
});

// --------------------------------------------------------------- runtime wiring

Deno.test("WML-1B: runtime composition wires the caller-bound members reader", async () => {
  const index = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
  assert(index.includes("createDelegatedApiV1WorkspaceMembersReader"));
  assert(index.includes("readWorkspaceMembers,"));
  assert(
    /const readWorkspaceMembers = createDelegatedApiV1WorkspaceMembersReader\(\s*supabaseUrl,\s*supabaseAnonKey,/m
      .test(index),
    "members reader must be constructed with the anon key",
  );

  const handler = await Deno.readTextFile(new URL("../handler.ts", import.meta.url));
  assert(handler.includes("isExactWorkspaceMembersPath(url.pathname)"));

  const router = await Deno.readTextFile(new URL("../router.ts", import.meta.url));
  assert(router.includes("readWorkspaceMembers?: DelegatedApiV1WorkspaceMembersReader"));
  assert(router.includes("parseApiV1WorkspaceMembersPath(url.pathname)"));
  assert(router.includes("parseApiV1WorkspaceMembersQuery(url.search)"));
  assert(router.includes("route === WORKSPACE_MEMBERS_ROUTE"));
  // The route must reach the delegated reader, never a direct RPC or table read.
  assert(!router.includes("api_v1_list_workspace_members"));
});
