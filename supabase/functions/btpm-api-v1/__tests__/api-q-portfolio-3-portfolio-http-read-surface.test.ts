// API-Q Portfolio-3 — Focused executable evidence for the three activated
// Portfolio HTTP reads. Synthetic UUIDs and stub RPC clients only; no network,
// no database, no business data.

import {
  assertEquals,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { ApiHttpError } from "../../_shared/btpm-api/http.ts";
import type { AuthenticatedApiContext } from "../../_shared/btpm-api/authenticateApiRequest.ts";
import {
  executeApiProtectedRoute,
  matchApiRoute,
  type ApiProtectedRouteDependencies,
} from "../router.ts";
import {
  PORTFOLIOS_ROUTE,
  PORTFOLIO_DETAIL_ROUTE,
  PORTFOLIO_PROJECTS_ROUTE,
  parseApiV1PortfolioDetailPath,
  parseApiV1PortfolioProjectsPath,
  parseApiV1PortfolioProjectsQuery,
  parseApiV1PortfoliosQuery,
} from "../routes/portfolios.ts";
import { buildCapabilitiesPayload } from "../routes/capabilities.ts";
import {
  readApiV1PortfolioDetail,
  readApiV1PortfolioProjects,
  readApiV1Portfolios,
} from "../../_shared/btpm-api/supabasePortfolioRead.ts";

const ORGANIZATION_ID = "cccccccc-1111-4111-8111-cccccccccccc";
const PORTFOLIO_ID = "dddddddd-1111-4111-8111-dddddddddddd";
const PROJECT_ID = "eeeeeeee-1111-4111-8111-eeeeeeeeeeee";
const OTHER_PROJECT_ID = "ffffffff-1111-4111-8111-ffffffffffff";
const WORKSPACE_ID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const API_CLIENT_ID = "22222222-2222-4222-8222-222222222222";
const POLICY_VERSION_ID = "33333333-3333-4333-8333-333333333333";
const OAUTH_CLIENT_ID = "oauth-client-abc";

const PORTFOLIOS_PATH = "/v1/portfolios";
const PORTFOLIO_PATH = `/v1/portfolios/${PORTFOLIO_ID}`;
const PORTFOLIO_PROJECTS_PATH = `/v1/portfolios/${PORTFOLIO_ID}/projects`;

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

// ---------------------------------------------------------------------------
// A. Strict collection query parsing
// ---------------------------------------------------------------------------

Deno.test("Portfolio-3: collection query defaults and explicit values parse", () => {
  assertEquals(
    parseApiV1PortfoliosQuery(`?organization_id=${ORGANIZATION_ID}`),
    {
      organizationId: ORGANIZATION_ID,
      limit: 50,
      offset: 0,
      search: null,
      includeArchived: false,
    },
  );
  assertEquals(
    parseApiV1PortfoliosQuery(
      `?organization_id=${ORGANIZATION_ID}&limit=1&offset=10000&search=%20ops%20&include_archived=true`,
    ),
    {
      organizationId: ORGANIZATION_ID,
      limit: 1,
      offset: 10000,
      search: "ops",
      includeArchived: true,
    },
  );
  assertEquals(
    parseApiV1PortfoliosQuery(
      `?organization_id=${ORGANIZATION_ID}&search=%20%20&include_archived=false`,
    ).search,
    null,
  );
});

Deno.test("Portfolio-3: collection query rejects every malformed shape", () => {
  const bad = [
    "",
    "?",
    `?organizationId=${ORGANIZATION_ID}`,
    `?organization_id=${NIL_UUID}`,
    "?organization_id=not-a-uuid",
    "?limit=10",
    `?organization_id=${ORGANIZATION_ID}&limit=0`,
    `?organization_id=${ORGANIZATION_ID}&limit=101`,
    `?organization_id=${ORGANIZATION_ID}&limit=1.5`,
    `?organization_id=${ORGANIZATION_ID}&limit=+1`,
    `?organization_id=${ORGANIZATION_ID}&offset=-1`,
    `?organization_id=${ORGANIZATION_ID}&offset=10001`,
    `?organization_id=${ORGANIZATION_ID}&include_archived=TRUE`,
    `?organization_id=${ORGANIZATION_ID}&include_archived=1`,
    `?organization_id=${ORGANIZATION_ID}&includeArchived=true`,
    `?organization_id=${ORGANIZATION_ID}&unknown=1`,
    `?organization_id=${ORGANIZATION_ID}&organization_id=${ORGANIZATION_ID}`,
    `?organization_id=${ORGANIZATION_ID}&search=${"a".repeat(101)}`,
    `?organization_id=${ORGANIZATION_ID}&search=%E0%A4%A`,
    `?organization_id=${ORGANIZATION_ID}#frag`,
  ];
  for (const raw of bad) {
    const err = assertThrows(
      () => parseApiV1PortfoliosQuery(raw),
      ApiHttpError,
    );
    assertEquals(err.code, "invalid_request", raw);
  }
});

// ---------------------------------------------------------------------------
// B. Strict detail path and nested Projects path
// ---------------------------------------------------------------------------

Deno.test("Portfolio-3: detail path accepts exactly one non-nil UUID", () => {
  assertEquals(parseApiV1PortfolioDetailPath(PORTFOLIO_PATH), {
    portfolioId: PORTFOLIO_ID,
  });
  for (
    const bad of [
      PORTFOLIOS_PATH,
      `${PORTFOLIOS_PATH}/`,
      `/v1/portfolios/${NIL_UUID}`,
      "/v1/portfolios/not-a-uuid",
      `${PORTFOLIO_PATH}/`,
      `${PORTFOLIO_PATH}/projects`,
      `${PORTFOLIO_PATH};v=1`,
      `${PORTFOLIO_PATH}\\projects`,
      `${PORTFOLIO_PATH} `,
      "/v1/portfolios/dddddddd%2D1111-4111-8111-dddddddddddd",
      `/v1/programs/${PORTFOLIO_ID}`,
    ]
  ) {
    const err = assertThrows(
      () => parseApiV1PortfolioDetailPath(bad),
      ApiHttpError,
    );
    assertEquals(err.code, "invalid_request", bad);
  }
});

Deno.test("Portfolio-3: nested Projects path is strict", () => {
  assertEquals(parseApiV1PortfolioProjectsPath(PORTFOLIO_PROJECTS_PATH), {
    portfolioId: PORTFOLIO_ID,
  });
  for (
    const bad of [
      PORTFOLIO_PATH,
      `${PORTFOLIO_PROJECTS_PATH}/`,
      `${PORTFOLIO_PROJECTS_PATH}/${PROJECT_ID}`,
      `/v1/portfolios/${NIL_UUID}/projects`,
      "/v1/portfolios/not-a-uuid/projects",
      "/v1/portfolios//projects",
      `${PORTFOLIO_PATH}/Projects`,
      `/v1/portfolios/${PORTFOLIO_ID}/projects/../projects`,
    ]
  ) {
    const err = assertThrows(
      () => parseApiV1PortfolioProjectsPath(bad),
      ApiHttpError,
    );
    assertEquals(err.code, "invalid_request", bad);
  }
});

Deno.test("Portfolio-3: nested Projects query allows an empty query", () => {
  assertEquals(parseApiV1PortfolioProjectsQuery(""), {
    limit: 50,
    offset: 0,
    search: null,
  });
  assertEquals(
    parseApiV1PortfolioProjectsQuery("?limit=25&offset=25&search=%20crm%20"),
    { limit: 25, offset: 25, search: "crm" },
  );
  for (
    const bad of [
      "?limit=0",
      "?limit=101",
      "?offset=10001",
      "?unknown=1",
      "?limit=1&limit=2",
      `?search=${"a".repeat(101)}`,
      "?search=%E0%A4%A",
      "?limit=1#frag",
      "limit=1",
    ]
  ) {
    const err = assertThrows(
      () => parseApiV1PortfolioProjectsQuery(bad),
      ApiHttpError,
    );
    assertEquals(err.code, "invalid_request", bad);
  }
});

// ---------------------------------------------------------------------------
// C. Route matching order — nested route is not swallowed by detail matcher
// ---------------------------------------------------------------------------

Deno.test("Portfolio-3: route matching resolves all three Portfolio routes", () => {
  assertStrictEquals(matchApiRoute("GET", PORTFOLIOS_PATH), PORTFOLIOS_ROUTE);
  assertStrictEquals(
    matchApiRoute("GET", PORTFOLIO_PROJECTS_PATH),
    PORTFOLIO_PROJECTS_ROUTE,
  );
  assertStrictEquals(
    matchApiRoute("GET", PORTFOLIO_PATH),
    PORTFOLIO_DETAIL_ROUTE,
  );
  assertEquals(matchApiRoute("GET", `${PORTFOLIO_PROJECTS_PATH}/`), null);
  // API-Q Portfolio-4B activated exactly one Portfolio command on this path;
  // the read matchers above remain unaffected.
  assertEquals(matchApiRoute("POST", PORTFOLIOS_PATH)?.id, "portfolios.create");
});

// ---------------------------------------------------------------------------
// D. Exact RPC function selection and SQLSTATE mapping
// ---------------------------------------------------------------------------

interface RpcCall {
  readonly fn: string;
  readonly args: Record<string, unknown>;
}

function rpcClient(result: unknown, calls: RpcCall[]) {
  return {
    rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ fn, args });
      return Promise.resolve(result);
    },
  };
}

function portfolioItem(overrides: Record<string, unknown> = {}) {
  return {
    portfolioId: PORTFOLIO_ID,
    organizationId: ORGANIZATION_ID,
    name: "Core platform",
    code: "CORE",
    lifecycleState: "active",
    strategicPriority: "high",
    ownerId: USER_ID,
    isArchived: false,
    updatedAt: "2026-08-02T10:00:00.000Z",
    ...overrides,
  };
}

function portfolioDetail(overrides: Record<string, unknown> = {}) {
  return {
    portfolioId: PORTFOLIO_ID,
    organizationId: ORGANIZATION_ID,
    name: "Core platform",
    code: null,
    description: null,
    lifecycleState: "active",
    strategicPriority: "high",
    ownerId: null,
    isArchived: false,
    archivedAt: null,
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-02T10:00:00.000Z",
    ...overrides,
  };
}

function projectItem(overrides: Record<string, unknown> = {}) {
  return {
    projectId: PROJECT_ID,
    workspaceId: WORKSPACE_ID,
    programId: null,
    name: "SAP rollout",
    status: "active",
    priority: "high",
    projectStage: "build",
    deliveryModel: "waterfall",
    startDate: "2026-01-05",
    targetEndDate: null,
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

const LIST_QUERY = Object.freeze({
  organizationId: ORGANIZATION_ID,
  limit: 50,
  offset: 0,
  search: null,
  includeArchived: false,
});

const PROJECTS_QUERY = Object.freeze({ limit: 50, offset: 0, search: null });

Deno.test("Portfolio-3: each adapter calls exactly its own database wrapper", async () => {
  const listCalls: RpcCall[] = [];
  await readApiV1Portfolios(
    rpcClient({ data: collection([portfolioItem()]), error: null }, listCalls),
    OAUTH_CLIENT_ID,
    LIST_QUERY,
  );
  assertEquals(listCalls.length, 1);
  assertEquals(listCalls[0].fn, "api_v1_list_portfolios");
  assertEquals(listCalls[0].args, {
    _expected_oauth_client_id: OAUTH_CLIENT_ID,
    _organization_id: ORGANIZATION_ID,
    _limit: 50,
    _offset: 0,
    _search: null,
    _include_archived: false,
  });

  const detailCalls: RpcCall[] = [];
  await readApiV1PortfolioDetail(
    rpcClient({ data: portfolioDetail(), error: null }, detailCalls),
    OAUTH_CLIENT_ID,
    PORTFOLIO_ID,
  );
  assertEquals(detailCalls.length, 1);
  assertEquals(detailCalls[0].fn, "api_v1_get_portfolio");
  assertEquals(detailCalls[0].args, {
    _expected_oauth_client_id: OAUTH_CLIENT_ID,
    _portfolio_item_id: PORTFOLIO_ID,
  });

  const projectCalls: RpcCall[] = [];
  const projects = await readApiV1PortfolioProjects(
    rpcClient({ data: collection([projectItem()]), error: null }, projectCalls),
    OAUTH_CLIENT_ID,
    PORTFOLIO_ID,
    PROJECTS_QUERY,
  );
  assertEquals(projectCalls.length, 1);
  assertEquals(projectCalls[0].fn, "api_v1_list_portfolio_projects");
  assertEquals(projectCalls[0].args, {
    _expected_oauth_client_id: OAUTH_CLIENT_ID,
    _portfolio_item_id: PORTFOLIO_ID,
    _limit: 50,
    _offset: 0,
    _search: null,
  });
  assertEquals(projects.items.length, 1);
  assertEquals(Object.keys(projects.items[0]), [
    "projectId",
    "workspaceId",
    "programId",
    "name",
    "status",
    "priority",
    "projectStage",
    "deliveryModel",
    "startDate",
    "targetEndDate",
    "updatedAt",
  ]);
});

Deno.test("Portfolio-3: SQLSTATE 42501 and 22023 map to the public contract", async () => {
  for (
    const [code, expected] of [
      ["42501", "not_authorized"],
      ["22023", "invalid_request"],
      ["XX000", "internal_error"],
    ] as Array<[string, string]>
  ) {
    const err = await assertRejects(
      () =>
        readApiV1Portfolios(
          { rpc: () => Promise.resolve({ data: null, error: { code } }) },
          OAUTH_CLIENT_ID,
          LIST_QUERY,
        ),
      ApiHttpError,
    );
    assertEquals(err.code, expected);

    const detailErr = await assertRejects(
      () =>
        readApiV1PortfolioDetail(
          { rpc: () => Promise.resolve({ data: null, error: { code } }) },
          OAUTH_CLIENT_ID,
          PORTFOLIO_ID,
        ),
      ApiHttpError,
    );
    assertEquals(detailErr.code, expected);

    const projectsErr = await assertRejects(
      () =>
        readApiV1PortfolioProjects(
          { rpc: () => Promise.resolve({ data: null, error: { code } }) },
          OAUTH_CLIENT_ID,
          PORTFOLIO_ID,
          PROJECTS_QUERY,
        ),
      ApiHttpError,
    );
    assertEquals(projectsErr.code, expected);
  }
});

Deno.test("Portfolio-3: malformed database responses fail closed", async () => {
  const malformedCollections: unknown[] = [
    null,
    [],
    { items: [], pagination: { limit: 50, offset: 0, returned: 0 } },
    collection([portfolioItem()], { returned: 2 }),
    collection([portfolioItem()], { total: 0 }),
    collection([portfolioItem()], { limit: 10 }),
    collection([portfolioItem({ portfolioId: NIL_UUID })]),
    collection([portfolioItem({ organizationId: WORKSPACE_ID })]),
    collection([portfolioItem({ name: "" })]),
    collection([portfolioItem({ updatedAt: "not-a-date" })]),
    collection([portfolioItem(), portfolioItem()], { total: 2 }),
    collection([{ ...portfolioItem(), extra: 1 }]),
  ];
  for (const data of malformedCollections) {
    const err = await assertRejects(
      () =>
        readApiV1Portfolios(
          { rpc: () => Promise.resolve({ data, error: null }) },
          OAUTH_CLIENT_ID,
          LIST_QUERY,
        ),
      ApiHttpError,
    );
    assertEquals(err.code, "internal_error");
  }

  const detailErr = await assertRejects(
    () =>
      readApiV1PortfolioDetail(
        {
          rpc: () =>
            Promise.resolve({
              data: portfolioDetail({ portfolioId: PROJECT_ID }),
              error: null,
            }),
        },
        OAUTH_CLIENT_ID,
        PORTFOLIO_ID,
      ),
    ApiHttpError,
  );
  assertEquals(detailErr.code, "internal_error");

  for (
    const data of [
      collection([projectItem({ startDate: "2026-02-30" })]),
      collection([projectItem({ workspaceId: NIL_UUID })]),
      collection([projectItem(), projectItem()], { total: 2 }),
      collection([projectItem({ projectStage: "" })]),
    ]
  ) {
    const err = await assertRejects(
      () =>
        readApiV1PortfolioProjects(
          { rpc: () => Promise.resolve({ data, error: null }) },
          OAUTH_CLIENT_ID,
          PORTFOLIO_ID,
          PROJECTS_QUERY,
        ),
      ApiHttpError,
    );
    assertEquals(err.code, "internal_error");
  }

  // Two distinct Projects remain acceptable.
  const ok = await readApiV1PortfolioProjects(
    {
      rpc: () =>
        Promise.resolve({
          data: collection(
            [projectItem(), projectItem({ projectId: OTHER_PROJECT_ID })],
            { total: 2 },
          ),
          error: null,
        }),
    },
    OAUTH_CLIENT_ID,
    PORTFOLIO_ID,
    PROJECTS_QUERY,
  );
  assertEquals(ok.items.length, 2);
});

// ---------------------------------------------------------------------------
// E. Protected router dispatch
// ---------------------------------------------------------------------------

interface Trace {
  authenticateCalls: number;
  authorizedRouteIds: string[];
  portfoliosCalls: Array<{ query: unknown }>;
  portfolioCalls: Array<{ portfolioId: string }>;
  portfolioProjectsCalls: Array<{ portfolioId: string; query: unknown }>;
}

function newTrace(): Trace {
  return {
    authenticateCalls: 0,
    authorizedRouteIds: [],
    portfoliosCalls: [],
    portfolioCalls: [],
    portfolioProjectsCalls: [],
  };
}

function getRequest(path: string, suffix = ""): Request {
  return new Request(`https://api.example.test${path}${suffix}`, {
    method: "GET",
    headers: new Headers({ Authorization: "Bearer caller-token" }),
  });
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
    readPortfolios: (_req: Request, _ctx: unknown, query: unknown) => {
      trace.portfoliosCalls.push({ query });
      return Promise.resolve(collection([portfolioItem()]));
    },
    readPortfolio: (_req: Request, _ctx: unknown, portfolioId: string) => {
      trace.portfolioCalls.push({ portfolioId });
      return Promise.resolve(portfolioDetail());
    },
    readPortfolioProjects: (
      _req: Request,
      _ctx: unknown,
      portfolioId: string,
      query: unknown,
    ) => {
      trace.portfolioProjectsCalls.push({ portfolioId, query });
      return Promise.resolve(collection([projectItem()]));
    },
    ...overrides,
  } as unknown as ApiProtectedRouteDependencies;
}

Deno.test("Portfolio-3: dispatch reaches exactly the matching Portfolio reader", async () => {
  const listTrace = newTrace();
  const listResult = await executeApiProtectedRoute(
    getRequest(
      PORTFOLIOS_PATH,
      `?organization_id=${ORGANIZATION_ID}&limit=10&include_archived=true`,
    ),
    PORTFOLIOS_PATH,
    READS_ON,
    buildDeps(listTrace),
  );
  assertStrictEquals(listResult.route, PORTFOLIOS_ROUTE);
  assertEquals(listTrace.portfoliosCalls, [{
    query: {
      organizationId: ORGANIZATION_ID,
      limit: 10,
      offset: 0,
      search: null,
      includeArchived: true,
    },
  }]);
  assertEquals(listTrace.authorizedRouteIds, ["portfolios.get"]);
  assertEquals(listTrace.portfolioCalls.length, 0);
  assertEquals(listTrace.portfolioProjectsCalls.length, 0);

  const detailTrace = newTrace();
  const detailResult = await executeApiProtectedRoute(
    getRequest(PORTFOLIO_PATH),
    PORTFOLIO_PATH,
    READS_ON,
    buildDeps(detailTrace),
  );
  assertStrictEquals(detailResult.route, PORTFOLIO_DETAIL_ROUTE);
  assertEquals(detailTrace.portfolioCalls, [{ portfolioId: PORTFOLIO_ID }]);
  assertEquals(detailTrace.authorizedRouteIds, ["portfolios.get_by_id"]);
  assertEquals(detailTrace.portfolioProjectsCalls.length, 0);

  const nestedTrace = newTrace();
  const nestedResult = await executeApiProtectedRoute(
    getRequest(PORTFOLIO_PROJECTS_PATH, "?limit=5"),
    PORTFOLIO_PROJECTS_PATH,
    READS_ON,
    buildDeps(nestedTrace),
  );
  assertStrictEquals(nestedResult.route, PORTFOLIO_PROJECTS_ROUTE);
  assertEquals(nestedTrace.portfolioProjectsCalls, [{
    portfolioId: PORTFOLIO_ID,
    query: { limit: 5, offset: 0, search: null },
  }]);
  assertEquals(nestedTrace.authorizedRouteIds, ["portfolios.projects.get"]);
  assertEquals(nestedTrace.portfolioCalls.length, 0);
});

Deno.test("Portfolio-3: Portfolio input is parsed before authentication", async () => {
  for (
    const [path, suffix] of [
      [PORTFOLIOS_PATH, `?organizationId=${ORGANIZATION_ID}`],
      [PORTFOLIO_PATH, "?x=1"],
      [PORTFOLIO_PROJECTS_PATH, "?unknown=1"],
    ] as Array<[string, string]>
  ) {
    const trace = newTrace();
    const err = await assertRejects(
      () =>
        executeApiProtectedRoute(
          getRequest(path, suffix),
          path,
          READS_ON,
          buildDeps(trace),
        ),
      ApiHttpError,
    );
    assertEquals(err.code, "invalid_request");
    assertEquals(trace.authenticateCalls, 0);
  }
});

Deno.test("Portfolio-3: missing Portfolio readers fail closed", async () => {
  for (
    const [path, suffix, override] of [
      [
        PORTFOLIOS_PATH,
        `?organization_id=${ORGANIZATION_ID}`,
        { readPortfolios: undefined },
      ],
      [PORTFOLIO_PATH, "", { readPortfolio: undefined }],
      [PORTFOLIO_PROJECTS_PATH, "", { readPortfolioProjects: undefined }],
    ] as Array<[string, string, Partial<ApiProtectedRouteDependencies>]>
  ) {
    const trace = newTrace();
    const err = await assertRejects(
      () =>
        executeApiProtectedRoute(
          getRequest(path, suffix),
          path,
          READS_ON,
          buildDeps(trace, override),
        ),
      ApiHttpError,
    );
    assertEquals(err.code, "internal_error");
    assertEquals(trace.authenticateCalls, 0);
  }
});

// ---------------------------------------------------------------------------
// F. Capability advertisement
// ---------------------------------------------------------------------------

Deno.test("Portfolio-3: capabilities advertise the three Portfolio operations", () => {
  const advertised = buildCapabilitiesPayload()
    .supportedOperations as readonly string[];
  for (
    const id of ["portfolios.get", "portfolios.get_by_id", "portfolios.projects.get"]
  ) {
    assertEquals(advertised.includes(id), true, id);
  }
});
