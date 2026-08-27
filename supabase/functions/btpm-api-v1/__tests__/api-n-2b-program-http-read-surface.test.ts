// API-N.2B — Focused tests for the Program HTTP read surface activation.
//
// Route contracts, strict parsers, RPC adapters, delegated caller-bound
// readers, live routing/cardinality, capability advertisement and non-goals.
// Synthetic UUIDs only; no environment, network or database is touched.

import {
  assert,
  assertEquals,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { ApiHttpError } from "../../_shared/btpm-api/http.ts";
import type { AuthenticatedApiContext } from "../../_shared/btpm-api/authenticateApiRequest.ts";
import {
  API_V1_ROUTE_ALLOWLIST,
  executeApiProtectedRoute,
  matchApiRoute,
  type ApiProtectedRouteDependencies,
} from "../router.ts";
import {
  PROGRAMS_ROUTE,
  PROGRAM_DETAIL_ROUTE,
  parseApiV1ProgramDetailPath,
  parseApiV1ProgramsQuery,
} from "../routes/programs.ts";
import { buildCapabilitiesPayload } from "../routes/capabilities.ts";
import {
  readApiV1ProgramDetail,
  readApiV1Programs,
} from "../../_shared/btpm-api/supabaseProgramRead.ts";
import {
  createDelegatedApiV1ProgramReader,
  createDelegatedApiV1ProgramsReader,
} from "../../_shared/btpm-api/supabaseDelegatedProgramRead.ts";

const WORKSPACE_ID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const OTHER_WORKSPACE_ID = "bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb";
const ORGANIZATION_ID = "cccccccc-1111-4111-8111-cccccccccccc";
const PROGRAM_ID = "dddddddd-1111-4111-8111-dddddddddddd";
const OTHER_PROGRAM_ID = "eeeeeeee-1111-4111-8111-eeeeeeeeeeee";
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const API_CLIENT_ID = "22222222-2222-4222-8222-222222222222";
const POLICY_VERSION_ID = "33333333-3333-4333-8333-333333333333";
const OAUTH_CLIENT_ID = "oauth-client-abc";

const PROGRAMS_PATH = "/v1/programs";
const PROGRAM_PATH = `/v1/programs/${PROGRAM_ID}`;

const CONTEXT = Object.freeze({
  token: Object.freeze({ userId: USER_ID, clientId: OAUTH_CLIENT_ID }),
  client: Object.freeze({
    userId: USER_ID,
    apiClientId: API_CLIENT_ID,
    policyVersionId: POLICY_VERSION_ID,
    oauthClientId: OAUTH_CLIENT_ID,
  }),
}) as unknown as AuthenticatedApiContext;

const READS_ON = Object.freeze({
  apiEnabled: true,
  readsEnabled: true,
  mutationsEnabled: false,
});

const DEFAULT_QUERY = Object.freeze({
  workspaceId: WORKSPACE_ID,
  limit: 50,
  offset: 0,
  search: null,
});

function programItem(overrides: Record<string, unknown> = {}) {
  return {
    programId: PROGRAM_ID,
    organizationId: ORGANIZATION_ID,
    workspaceId: WORKSPACE_ID,
    name: "Global rollout",
    status: "active",
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-02T10:00:00.000Z",
    ...overrides,
  };
}

function programDetail(overrides: Record<string, unknown> = {}) {
  return {
    programId: PROGRAM_ID,
    organizationId: ORGANIZATION_ID,
    workspaceId: WORKSPACE_ID,
    name: "Global rollout",
    description: null,
    status: "active",
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-02T10:00:00.000Z",
    ...overrides,
  };
}

function collection(items: unknown[], pagination: Record<string, unknown> = {}) {
  return {
    items,
    pagination: {
      limit: 50,
      offset: 0,
      returned: items.length,
      total: items.length,
      ...pagination,
    },
  };
}

interface RpcCall {
  readonly fn: string;
  readonly args: Record<string, unknown>;
}

function rpcClient(
  result: unknown,
  calls: RpcCall[],
  throwValue?: unknown,
) {
  return {
    rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ fn, args });
      if (throwValue !== undefined) return Promise.reject(throwValue);
      return Promise.resolve(result);
    },
  };
}

function getRequest(path: string, suffix = ""): Request {
  return new Request(`https://api.example.test${path}${suffix}`, {
    method: "GET",
    headers: new Headers({ Authorization: "Bearer caller-token" }),
  });
}

interface Trace {
  authenticateCalls: number;
  authorizedRouteIds: string[];
  programsCalls: Array<{ url: string; query: unknown }>;
  programCalls: Array<{ url: string; programId: string }>;
}

function newTrace(): Trace {
  return {
    authenticateCalls: 0,
    authorizedRouteIds: [],
    programsCalls: [],
    programCalls: [],
  };
}

function buildDeps(
  trace: Trace,
  overrides: Partial<ApiProtectedRouteDependencies> = {},
): ApiProtectedRouteDependencies {
  const failing = () => Promise.reject(new ApiHttpError("internal_error"));
  return {
    authenticate: () => {
      trace.authenticateCalls++;
      return Promise.resolve(CONTEXT);
    },
    authorizeRoute: (_c: unknown, route: { id: string }) => {
      trace.authorizedRouteIds.push(route.id);
      return Promise.resolve();
    },
    resolveRateLimitProfile: () =>
      Promise.resolve({ limit: 100, windowSeconds: 60 }),
    rateLimit: {
      store: {
        consume: () =>
          Promise.resolve({
            allowed: true,
            remaining: 9,
            resetAtEpochMs: 1_700_000_000_000,
          }),
      },
      now: () => 1_600_000_000_000,
    },
    readMe: failing,
    readOrganizations: failing,
    readWorkspaces: failing,
    readProjects: failing,
    readProjectDetail: failing,
    readProjectPlanning: failing,
    readPrograms: (req: Request, _ctx: unknown, query: unknown) => {
      trace.programsCalls.push({ url: req.url, query });
      return Promise.resolve(collection([programItem()]));
    },
    readProgram: (req: Request, _ctx: unknown, programId: string) => {
      trace.programCalls.push({ url: req.url, programId });
      return Promise.resolve(programDetail());
    },
    ...overrides,
  } as unknown as ApiProtectedRouteDependencies;
}

// ---------------------------------------------------------------------------
// A. Route constants
// ---------------------------------------------------------------------------

Deno.test("API-N.2B: Program route constants are exactly the accepted contracts", () => {
  assertEquals(PROGRAMS_ROUTE.id, "programs.get");
  assertEquals(PROGRAMS_ROUTE.method, "GET");
  assertEquals(PROGRAMS_ROUTE.path, "/v1/programs");
  assertEquals(PROGRAMS_ROUTE.operation, "read");
  assertEquals(PROGRAM_DETAIL_ROUTE.id, "programs.get_by_id");
  assertEquals(PROGRAM_DETAIL_ROUTE.method, "GET");
  assertEquals(PROGRAM_DETAIL_ROUTE.path, "/v1/programs/:programid");
  assertEquals(PROGRAM_DETAIL_ROUTE.operation, "read");
  assert(Object.isFrozen(PROGRAMS_ROUTE));
  assert(Object.isFrozen(PROGRAM_DETAIL_ROUTE));
});

// ---------------------------------------------------------------------------
// B. Collection query parser
// ---------------------------------------------------------------------------

Deno.test("API-N.2B: workspace_id only, with accepted defaults", () => {
  assertEquals(parseApiV1ProgramsQuery(`?workspace_id=${WORKSPACE_ID}`), {
    workspaceId: WORKSPACE_ID,
    limit: 50,
    offset: 0,
    search: null,
  });
});

Deno.test("API-N.2B: pagination and search boundaries are accepted", () => {
  assertEquals(
    parseApiV1ProgramsQuery(
      `?workspace_id=${WORKSPACE_ID}&limit=1&offset=0&search=%20a%20`,
    ),
    { workspaceId: WORKSPACE_ID, limit: 1, offset: 0, search: "a" },
  );
  assertEquals(
    parseApiV1ProgramsQuery(
      `?workspace_id=${WORKSPACE_ID}&limit=100&offset=10000`,
    ),
    { workspaceId: WORKSPACE_ID, limit: 100, offset: 10000, search: null },
  );
  assertEquals(
    parseApiV1ProgramsQuery(
      `?workspace_id=${WORKSPACE_ID}&search=${"x".repeat(100)}`,
    ).search,
    "x".repeat(100),
  );
  // Trimmed-empty search collapses to null.
  assertEquals(
    parseApiV1ProgramsQuery(`?workspace_id=${WORKSPACE_ID}&search=%20%20`)
      .search,
    null,
  );
});

Deno.test("API-N.2B: workspaceId is rejected as a public query alias", () => {
  const err = assertThrows(
    () => parseApiV1ProgramsQuery(`?workspaceId=${WORKSPACE_ID}`),
    ApiHttpError,
  );
  assertEquals(err.code, "invalid_request");
  assertThrows(
    () =>
      parseApiV1ProgramsQuery(
        `?workspace_id=${WORKSPACE_ID}&workspaceId=${WORKSPACE_ID}`,
      ),
    ApiHttpError,
  );
});

Deno.test("API-N.2B: invalid Program collection queries are rejected", () => {
  const bad = [
    "",
    "?",
    "?limit=10",
    "?workspace_id=",
    `?workspace_id=${NIL_UUID}`,
    "?workspace_id=not-a-uuid",
    `?workspace_id=${WORKSPACE_ID}&workspace_id=${OTHER_WORKSPACE_ID}`,
    `?workspace_id=${WORKSPACE_ID}&unknown=1`,
    `?workspace_id=${WORKSPACE_ID}&limit=0`,
    `?workspace_id=${WORKSPACE_ID}&limit=101`,
    `?workspace_id=${WORKSPACE_ID}&limit=+1`,
    `?workspace_id=${WORKSPACE_ID}&limit=-1`,
    `?workspace_id=${WORKSPACE_ID}&limit=1.0`,
    `?workspace_id=${WORKSPACE_ID}&limit=1e1`,
    `?workspace_id=${WORKSPACE_ID}&limit=`,
    `?workspace_id=${WORKSPACE_ID}&limit=%2010`,
    `?workspace_id=${WORKSPACE_ID}&offset=-1`,
    `?workspace_id=${WORKSPACE_ID}&offset=10001`,
    `?workspace_id=${WORKSPACE_ID}&offset=`,
    `?workspace_id=${WORKSPACE_ID}&search=${"y".repeat(101)}`,
    `?workspace_id=${WORKSPACE_ID}%zz`,
    `?workspace_id=${WORKSPACE_ID}#fragment`,
  ];
  for (const raw of bad) {
    const err = assertThrows(
      () => parseApiV1ProgramsQuery(raw),
      ApiHttpError,
      undefined,
      `expected rejection: ${raw}`,
    );
    assertEquals(err.code, "invalid_request", raw);
  }
});

// ---------------------------------------------------------------------------
// C. Detail path parser
// ---------------------------------------------------------------------------

Deno.test("API-N.2B: the Program detail path parser accepts exactly one non-nil UUID", () => {
  assertEquals(parseApiV1ProgramDetailPath(PROGRAM_PATH), {
    programId: PROGRAM_ID,
  });
});

Deno.test("API-N.2B: malformed Program detail paths are rejected", () => {
  const bad = [
    "/v1/programs",
    "/v1/programs/",
    `/v1/programs/${NIL_UUID}`,
    "/v1/programs/not-a-uuid",
    `/v1/programs/${PROGRAM_ID}/`,
    `/v1/programs/${PROGRAM_ID}/detail`,
    `/v1/programs/${PROGRAM_ID.replace("-", "%2D")}`,
    `/v1/programs/${PROGRAM_ID};v=1`,
    `/v1/programs/ ${PROGRAM_ID}`,
    `/v1/programs/${PROGRAM_ID} `,
    `/v1/programs/${PROGRAM_ID}?x=1`,
    `/v1/programs/${PROGRAM_ID}#f`,
    `/v1/programs//${PROGRAM_ID}`,
    `/v1/programs/\\${PROGRAM_ID}`,
    `/V1/programs/${PROGRAM_ID}`,
    `/v1/Programs/${PROGRAM_ID}`,
  ];
  for (const raw of bad) {
    const err = assertThrows(
      () => parseApiV1ProgramDetailPath(raw),
      ApiHttpError,
      undefined,
      `expected rejection: ${raw}`,
    );
    assertEquals(err.code, "invalid_request", raw);
  }
});

// ---------------------------------------------------------------------------
// D. RPC adapters
// ---------------------------------------------------------------------------

Deno.test("API-N.2B: the collection adapter calls only api_v1_list_programs with exact arguments", async () => {
  const calls: RpcCall[] = [];
  const payload = await readApiV1Programs(
    rpcClient(
      { data: collection([programItem()]), error: null },
      calls,
    ),
    OAUTH_CLIENT_ID,
    { ...DEFAULT_QUERY, search: "roll" },
  );
  assertEquals(calls.length, 1);
  assertEquals(calls[0].fn, "api_v1_list_programs");
  assertEquals(calls[0].args, {
    _expected_oauth_client_id: OAUTH_CLIENT_ID,
    _workspace_id: WORKSPACE_ID,
    _limit: 50,
    _offset: 0,
    _search: "roll",
  });
  assertEquals(payload.items.length, 1);
  assertEquals(Object.keys(payload.items[0]), [
    "programId",
    "organizationId",
    "workspaceId",
    "name",
    "status",
    "createdAt",
    "updatedAt",
  ]);
  assertEquals(payload.pagination, {
    limit: 50,
    offset: 0,
    returned: 1,
    total: 1,
  });
});

Deno.test("API-N.2B: the detail adapter calls only api_v1_get_program with exact arguments", async () => {
  const calls: RpcCall[] = [];
  const payload = await readApiV1ProgramDetail(
    rpcClient({ data: programDetail({ description: "d" }), error: null }, calls),
    OAUTH_CLIENT_ID,
    PROGRAM_ID,
  );
  assertEquals(calls.length, 1);
  assertEquals(calls[0].fn, "api_v1_get_program");
  assertEquals(calls[0].args, {
    _expected_oauth_client_id: OAUTH_CLIENT_ID,
    _program_id: PROGRAM_ID,
  });
  assertEquals(payload.description, "d");
  assertEquals(Object.keys(payload).length, 8);
});

Deno.test("API-N.2B: SQLSTATE mapping is exact for both adapters", async () => {
  const cases: Array<[string, string]> = [
    ["42501", "not_authorized"],
    ["22023", "invalid_request"],
    ["P0001", "internal_error"],
  ];
  for (const [sqlstate, expected] of cases) {
    const listErr = await assertRejects(
      () =>
        readApiV1Programs(
          rpcClient({ data: null, error: { code: sqlstate } }, []),
          OAUTH_CLIENT_ID,
          DEFAULT_QUERY,
        ),
      ApiHttpError,
    );
    assertEquals(listErr.code, expected);
    const detailErr = await assertRejects(
      () =>
        readApiV1ProgramDetail(
          rpcClient({ data: null, error: { code: sqlstate } }, []),
          OAUTH_CLIENT_ID,
          PROGRAM_ID,
        ),
      ApiHttpError,
    );
    assertEquals(detailErr.code, expected);
  }
});

Deno.test("API-N.2B: malformed trusted backend output fails closed as internal_error", async () => {
  const badCollections: unknown[] = [
    null,
    { items: [], pagination: { limit: 50, offset: 0, returned: 0 } },
    collection([programItem({ extra: 1 })]),
    collection([{ programId: PROGRAM_ID }]),
    collection([programItem({ name: "" })]),
    collection([programItem({ createdAt: "not-a-timestamp" })]),
    collection([programItem({ programId: NIL_UUID })]),
    // Workspace mismatch.
    collection([programItem({ workspaceId: OTHER_WORKSPACE_ID })]),
    // Duplicate Program IDs.
    collection([programItem(), programItem()]),
    // Cross-Organization contamination.
    collection([
      programItem(),
      programItem({
        programId: OTHER_PROGRAM_ID,
        organizationId: "ffffffff-1111-4111-8111-ffffffffffff",
      }),
    ]),
    // Pagination drift.
    collection([programItem()], { limit: 25 }),
    collection([programItem()], { offset: 5 }),
    collection([programItem()], { returned: 2 }),
    collection([programItem()], { total: 0 }),
  ];
  for (const data of badCollections) {
    const err = await assertRejects(
      () =>
        readApiV1Programs(
          rpcClient({ data, error: null }, []),
          OAUTH_CLIENT_ID,
          DEFAULT_QUERY,
        ),
      ApiHttpError,
    );
    assertEquals(err.code, "internal_error", JSON.stringify(data));
  }

  const badDetails: unknown[] = [
    null,
    programDetail({ extra: 1 }),
    programDetail({ programId: OTHER_PROGRAM_ID }),
    programDetail({ name: "" }),
    programDetail({ description: 5 }),
    programDetail({ updatedAt: "" }),
  ];
  for (const data of badDetails) {
    const err = await assertRejects(
      () =>
        readApiV1ProgramDetail(
          rpcClient({ data, error: null }, []),
          OAUTH_CLIENT_ID,
          PROGRAM_ID,
        ),
      ApiHttpError,
    );
    assertEquals(err.code, "internal_error", JSON.stringify(data));
  }
});

// ---------------------------------------------------------------------------
// E. Delegated readers
// ---------------------------------------------------------------------------

Deno.test("API-N.2B: delegated Program readers bind the caller token to a fresh anon client", async () => {
  const created: Array<{ url: string; key: string; options: unknown }> = [];
  const calls: RpcCall[] = [];
  const factory = (url: string, key: string, options: unknown) => {
    created.push({ url, key, options });
    return rpcClient(
      { data: collection([programItem()]), error: null },
      calls,
    );
  };
  const readPrograms = createDelegatedApiV1ProgramsReader(
    "https://project.supabase.co",
    "anon-key",
    factory as never,
  );
  await readPrograms(getRequest(PROGRAMS_PATH), CONTEXT, DEFAULT_QUERY);
  await readPrograms(getRequest(PROGRAMS_PATH), CONTEXT, DEFAULT_QUERY);
  assertEquals(created.length, 2, "a fresh client per invocation");
  assertEquals(created[0].key, "anon-key");
  assertEquals(created[0].options, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { headers: { Authorization: "Bearer caller-token" } },
  });
  assertEquals(
    calls[0].args._expected_oauth_client_id,
    OAUTH_CLIENT_ID,
    "OAuth client ID comes from the authenticated context",
  );

  const detailCalls: RpcCall[] = [];
  const readProgram = createDelegatedApiV1ProgramReader(
    "https://project.supabase.co",
    "anon-key",
    ((url: string, key: string, options: unknown) => {
      created.push({ url, key, options });
      return rpcClient({ data: programDetail(), error: null }, detailCalls);
    }) as never,
  );
  const detail = await readProgram(
    getRequest(PROGRAM_PATH),
    CONTEXT,
    PROGRAM_ID,
  );
  assertEquals(detail.programId, PROGRAM_ID);
  assertEquals(detailCalls[0].fn, "api_v1_get_program");
  assertEquals(detailCalls[0].args._expected_oauth_client_id, OAUTH_CLIENT_ID);
});

Deno.test("API-N.2B: no service-role business reader exists in the Program modules", async () => {
  const sources = await Promise.all([
    Deno.readTextFile(
      new URL("../../_shared/btpm-api/supabaseProgramRead.ts", import.meta.url),
    ),
    Deno.readTextFile(
      new URL(
        "../../_shared/btpm-api/supabaseDelegatedProgramRead.ts",
        import.meta.url,
      ),
    ),
    Deno.readTextFile(new URL("../routes/programs.ts", import.meta.url)),
  ]);
  for (const src of sources) {
    assert(!src.includes("SERVICE_ROLE"), "service-role reference");
    assert(!src.includes("privilegedClient"), "privileged client reference");
    assert(!src.includes("Deno.env"), "environment read");
  }
});

// ---------------------------------------------------------------------------
// F. Live routing
// ---------------------------------------------------------------------------

Deno.test("API-N.2B: both Program routes are live in the allowlist exactly once", () => {
  assertStrictEquals(matchApiRoute("GET", PROGRAMS_PATH), PROGRAMS_ROUTE);
  assertStrictEquals(
    matchApiRoute("GET", PROGRAM_PATH),
    PROGRAM_DETAIL_ROUTE,
  );
  assertEquals(
    API_V1_ROUTE_ALLOWLIST.filter((r) => r.id === "programs.get").length,
    1,
  );
  assertEquals(
    API_V1_ROUTE_ALLOWLIST.filter((r) => r.id === "programs.get_by_id").length,
    1,
  );
});

// API-N.RG1A owns current global route cardinality; no global assertion here.


Deno.test("API-N.2B: malformed Program detail paths are not matched", () => {
  for (
    const raw of [
      "/v1/programs/",
      `/v1/programs/${NIL_UUID}`,
      "/v1/programs/not-a-uuid",
      `/v1/programs/${PROGRAM_ID}/detail`,
      `/v1/programs/${PROGRAM_ID}/`,
    ]
  ) {
    assertEquals(matchApiRoute("GET", raw), null, raw);
  }
});

Deno.test("API-N.2B: the Program collection query is parsed before authentication", async () => {
  const trace = newTrace();
  const err = await assertRejects(
    () =>
      executeApiProtectedRoute(
        getRequest(PROGRAMS_PATH, `?workspaceId=${WORKSPACE_ID}`),
        PROGRAMS_PATH,
        READS_ON,
        buildDeps(trace),
      ),
    ApiHttpError,
  );
  assertEquals(err.code, "invalid_request");
  assertEquals(trace.authenticateCalls, 0);
  assertEquals(trace.programsCalls.length, 0);
});

Deno.test("API-N.2B: the Program detail ID is parsed before authentication", async () => {
  const trace = newTrace();
  const err = await assertRejects(
    () =>
      executeApiProtectedRoute(
        getRequest(PROGRAM_PATH, "?x=1"),
        PROGRAM_PATH,
        READS_ON,
        buildDeps(trace),
      ),
    ApiHttpError,
  );
  assertEquals(err.code, "invalid_request");
  assertEquals(trace.authenticateCalls, 0);
  assertEquals(trace.programCalls.length, 0);
});

Deno.test("API-N.2B: each Program reader is invoked exactly once on the happy path", async () => {
  const trace = newTrace();
  const collectionResult = await executeApiProtectedRoute(
    getRequest(PROGRAMS_PATH, `?workspace_id=${WORKSPACE_ID}&limit=10`),
    PROGRAMS_PATH,
    READS_ON,
    buildDeps(trace),
  );
  assertStrictEquals(collectionResult.route, PROGRAMS_ROUTE);
  assertEquals(trace.programsCalls.length, 1);
  assertEquals(trace.programsCalls[0].query, {
    workspaceId: WORKSPACE_ID,
    limit: 10,
    offset: 0,
    search: null,
  });
  assertEquals(trace.authorizedRouteIds, ["programs.get"]);

  const detailTrace = newTrace();
  const detailResult = await executeApiProtectedRoute(
    getRequest(PROGRAM_PATH),
    PROGRAM_PATH,
    READS_ON,
    buildDeps(detailTrace),
  );
  assertStrictEquals(detailResult.route, PROGRAM_DETAIL_ROUTE);
  assertEquals(detailTrace.programCalls.length, 1);
  assertEquals(detailTrace.programCalls[0].programId, PROGRAM_ID);
  assertEquals(detailTrace.authorizedRouteIds, ["programs.get_by_id"]);
});

Deno.test("API-N.2B: missing Program readers fail closed", async () => {
  const trace = newTrace();
  for (
    const [path, override] of [
      [PROGRAMS_PATH, { readPrograms: undefined }],
      [PROGRAM_PATH, { readProgram: undefined }],
    ] as Array<[string, Partial<ApiProtectedRouteDependencies>]>
  ) {
    const err = await assertRejects(
      () =>
        executeApiProtectedRoute(
          getRequest(path, path === PROGRAMS_PATH
            ? `?workspace_id=${WORKSPACE_ID}`
            : ""),
          path,
          READS_ON,
          buildDeps(trace, override),
        ),
      ApiHttpError,
    );
    assertEquals(err.code, "internal_error");
  }
  assertEquals(trace.authenticateCalls, 0);
});

// ---------------------------------------------------------------------------
// G. Capability advertisement
// ---------------------------------------------------------------------------

Deno.test("API-N.2B: /v1/capabilities advertises both Program operations exactly once", () => {
  const ops = buildCapabilitiesPayload().supportedOperations as
    readonly string[];
  assertEquals(ops.filter((o) => o === "programs.get").length, 1);
  assertEquals(ops.filter((o) => o === "programs.get_by_id").length, 1);
});

// ---------------------------------------------------------------------------
// H. Local step invariants
// ---------------------------------------------------------------------------

Deno.test("API-N.2B: the two Program read routes remain live exactly once as GET reads", () => {
  for (const route of [PROGRAMS_ROUTE, PROGRAM_DETAIL_ROUTE]) {
    assertEquals(
      API_V1_ROUTE_ALLOWLIST.filter((r) => r === route).length,
      1,
      route.id,
    );
    assertEquals(route.method, "GET", route.id);
    assertEquals(route.operation, "read", route.id);
  }
});

Deno.test("API-N.2B: Project collection read behaviour is unchanged", () => {
  assertEquals(matchApiRoute("GET", "/v1/projects")?.id, "projects.get");
});


Deno.test("API-N.2B: no generic read dispatcher or dynamic RPC name is introduced", async () => {
  const adapter = await Deno.readTextFile(
    new URL("../../_shared/btpm-api/supabaseProgramRead.ts", import.meta.url),
  );
  assertEquals(
    (adapter.match(/client\.rpc\(/g) ?? []).length,
    2,
    "exactly two explicit RPC invocations",
  );
  assert(adapter.includes('"api_v1_list_programs"'));
  assert(adapter.includes('"api_v1_get_program"'));
  assert(
    !adapter.includes("get_decrypted_program") &&
      !adapter.includes("list_decrypted_workspace_programs"),
    "internal UI RPCs are never called",
  );
});
