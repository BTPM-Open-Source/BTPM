// Relocated out of supabase/functions/ (Edge deploy bundle size).
// Source-file reads stay anchored to the original module location.
const __BTPM_SELF_URL__ = import.meta.url;
const __BTPM_SRC_BASE__ = new URL('../../../functions/btpm-mcp/mcp/api-q-7d-project-program-context-read-tools_test.ts', import.meta.url).href;
// API-Q.7D — Focused, table-driven proofs for the four new MCP business-read
// adapters: `programs.get`, `programs.get_by_id`, `projects.get_by_id` and
// `projects.planning.get`.
//
// The real adapters run against doubles for the accepted delegated readers and
// the canonical rate-limit adapters, so the MCP SDK transport is not required.

import {
  assert,
  assertEquals,
  assertStrictEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  PROGRAM_DETAIL_ROUTE,
  PROGRAMS_ROUTE,
} from "../../../functions/_shared/btpm-api/routes/programs.ts";
import { PROJECT_DETAIL_ROUTE } from "../../../functions/_shared/btpm-api/routes/projectDetail.ts";
import { PROJECT_PLANNING_ROUTE } from "../../../functions/_shared/btpm-api/routes/projectPlanning.ts";
import type { AuthenticatedApiContext } from "../../../functions/_shared/btpm-api/authenticateApiRequest.ts";
import { ApiHttpError } from "../../../functions/_shared/btpm-api/http.ts";
import type {
  ApiRateLimitStoreInput,
  ApiRateLimitStoreResult,
} from "../../../functions/_shared/btpm-api/rateLimit.ts";
import type {
  ApiV1ProgramDetailPayload,
  ApiV1ProgramsPayload,
  ApiV1ProgramsQuery,
} from "../../../functions/_shared/btpm-api/supabaseProgramRead.ts";
import type { ApiV1ProjectDetailPayload } from "../../../functions/_shared/btpm-api/supabaseProjectDetail.ts";
import type { ApiV1ProjectPlanningPayload } from "../../../functions/_shared/btpm-api/supabaseProjectPlanning.ts";
import type { McpAuthorizedContext } from "../../../functions/btpm-mcp/mcp/authorizeMcpConnectedApp.ts";
import { buildMcpExecutionContext } from "../../../functions/btpm-mcp/mcp/buildMcpExecutionContext.ts";
import {
  buildCanonicalProgramsQueryString,
  createMcpProgramDetailToolExecutor,
  createMcpProgramsToolExecutor,
  MCP_PROGRAM_DETAIL_TOOL_INPUT_SCHEMA,
  MCP_PROGRAM_DETAIL_TOOL_NAME,
  MCP_PROGRAMS_TOOL_ERROR_MESSAGES,
  MCP_PROGRAMS_TOOL_INPUT_SCHEMA,
  MCP_PROGRAMS_TOOL_NAME,
} from "../../../functions/btpm-mcp/mcp/programsReadTools.ts";
import {
  createMcpProjectDetailToolExecutor,
  createMcpProjectPlanningToolExecutor,
  MCP_PROJECT_CONTEXT_TOOL_ERROR_MESSAGES,
  MCP_PROJECT_DETAIL_TOOL_INPUT_SCHEMA,
  MCP_PROJECT_DETAIL_TOOL_NAME,
  MCP_PROJECT_PLANNING_TOOL_INPUT_SCHEMA,
  MCP_PROJECT_PLANNING_TOOL_NAME,
} from "../../../functions/btpm-mcp/mcp/projectContextReadTools.ts";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const API_CLIENT_ID = "22222222-2222-4222-8222-222222222222";
const OAUTH_CLIENT_ID = "btpm-connected-app";
const POLICY_VERSION_ID = "33333333-3333-4333-8333-333333333333";
const ORGANIZATION_ID = "44444444-4444-4444-8444-444444444444";
const WORKSPACE_ID = "55555555-5555-4555-8555-555555555555";
const PROGRAM_ID = "66666666-6666-4666-8666-666666666666";
const PROJECT_ID = "77777777-7777-4777-8777-777777777777";
const VALID_TOKEN = "header.payload.signature";

const INVALID_IDS: readonly string[] = Object.freeze([
  "",
  "   ",
  "not-a-uuid",
  "00000000-0000-0000-0000-000000000000",
  `${PROJECT_ID}/extra`,
  `${PROJECT_ID}?x=1`,
]);

const PROGRAMS_PAYLOAD: ApiV1ProgramsPayload = Object.freeze({
  items: Object.freeze([
    Object.freeze({
      programId: PROGRAM_ID,
      organizationId: ORGANIZATION_ID,
      workspaceId: WORKSPACE_ID,
      name: "SAP Transformation",
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T03:04:05.000Z",
    }),
  ]),
  pagination: Object.freeze({ limit: 50, offset: 0, returned: 1, total: 1 }),
});

const PROGRAM_DETAIL_PAYLOAD: ApiV1ProgramDetailPayload = Object.freeze({
  programId: PROGRAM_ID,
  organizationId: ORGANIZATION_ID,
  workspaceId: WORKSPACE_ID,
  name: "SAP Transformation",
  description: null,
  status: "active",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T03:04:05.000Z",
});

const PROJECT_DETAIL_PAYLOAD: ApiV1ProjectDetailPayload = Object.freeze({
  projectId: PROJECT_ID,
  organizationId: ORGANIZATION_ID,
  workspaceId: WORKSPACE_ID,
  programId: PROGRAM_ID,
  portfolioItemId: null,
  name: "SAP S/4 Rollout",
  description: null,
  status: "active",
  priority: "high",
  projectStage: null,
  deliveryModel: null,
  startDate: "2026-01-01",
  targetEndDate: null,
  actualStartDate: null,
  actualEndDate: null,
  agileEnabled: false,
  updatedAt: "2026-01-02T03:04:05.000Z",
  charter: null,
  goals: null,
  scopeIn: null,
  scopeOut: null,
  businessCase: null,
  successCriteria: null,
  completionCriteria: null,
  budgetNarrative: null,
  assumptions: null,
  constraints: null,
});

const PROJECT_PLANNING_PAYLOAD: ApiV1ProjectPlanningPayload = Object.freeze({
  project: Object.freeze({
    projectId: PROJECT_ID,
    name: "SAP S/4 Rollout",
    startDate: "2026-01-01",
    targetEndDate: null,
    actualStartDate: null,
    actualEndDate: null,
    isBaselined: false,
  }),
  phases: Object.freeze([]),
  tasks: Object.freeze([]),
  dependencies: Object.freeze([]),
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

interface ReadCall {
  readonly authorization: string | null;
  readonly oauthClientId: string;
  readonly apiClientId: string;
  readonly tokenUserId: string;
  readonly argument: ApiV1ProgramsQuery | string;
}

interface HarnessState {
  profileResolutions: Array<{ apiClientId: string; routeId: string }>;
  consumptions: ApiRateLimitStoreInput[];
  reads: ReadCall[];
  allowed: boolean;
  failure: Error | null;
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
  };
}

function recordRead<TPayload>(
  state: HarnessState,
  payload: TPayload,
): (
  req: Request,
  context: AuthenticatedApiContext,
  argument: ApiV1ProgramsQuery | string,
) => Promise<TPayload> {
  return (
    req: Request,
    context: AuthenticatedApiContext,
    argument: ApiV1ProgramsQuery | string,
  ) => {
    state.reads.push({
      authorization: req.headers.get("authorization"),
      oauthClientId: context.client.oauthClientId,
      apiClientId: context.client.apiClientId,
      tokenUserId: context.token.userId,
      argument,
    });
    if (state.failure !== null) return Promise.reject(state.failure);
    return Promise.resolve(payload);
  };
}

function programsHarness(options: HarnessOptions = {}) {
  const state = createState(options);
  const executor = createMcpProgramsToolExecutor({
    ...sharedDependencies(state),
    reader: recordRead(state, PROGRAMS_PAYLOAD),
  });
  return { state, executor };
}

function programDetailHarness(options: HarnessOptions = {}) {
  const state = createState(options);
  const executor = createMcpProgramDetailToolExecutor({
    ...sharedDependencies(state),
    reader: recordRead(state, PROGRAM_DETAIL_PAYLOAD),
  });
  return { state, executor };
}

function projectDetailHarness(options: HarnessOptions = {}) {
  const state = createState(options);
  const executor = createMcpProjectDetailToolExecutor({
    ...sharedDependencies(state),
    reader: recordRead(state, PROJECT_DETAIL_PAYLOAD),
  });
  return { state, executor };
}

function projectPlanningHarness(options: HarnessOptions = {}) {
  const state = createState(options);
  const executor = createMcpProjectPlanningToolExecutor({
    ...sharedDependencies(state),
    reader: recordRead(state, PROJECT_PLANNING_PAYLOAD),
  });
  return { state, executor };
}

// -----------------------------------------------------------------------------
// D/E/F — identity, advertised names, required inputs
// -----------------------------------------------------------------------------

Deno.test("API-Q.7D (D): advertised tool names match the approved contract", () => {
  assertStrictEquals(MCP_PROGRAMS_TOOL_NAME, "btpm_list_programs");
  assertStrictEquals(MCP_PROGRAM_DETAIL_TOOL_NAME, "btpm_get_program");
  assertStrictEquals(MCP_PROJECT_DETAIL_TOOL_NAME, "btpm_get_project");
  assertStrictEquals(
    MCP_PROJECT_PLANNING_TOOL_NAME,
    "btpm_get_project_planning",
  );
  assertStrictEquals(PROGRAMS_ROUTE.id, "programs.get");
  assertStrictEquals(PROGRAM_DETAIL_ROUTE.id, "programs.get_by_id");
  assertStrictEquals(PROJECT_DETAIL_ROUTE.id, "projects.get_by_id");
  assertStrictEquals(PROJECT_PLANNING_ROUTE.id, "projects.planning.get");
});

Deno.test("API-Q.7D (F): required inputs are enforced by the advertised schemas", () => {
  assertStrictEquals(
    MCP_PROGRAMS_TOOL_INPUT_SCHEMA.safeParse({}).success,
    false,
  );
  assert(
    MCP_PROGRAMS_TOOL_INPUT_SCHEMA.safeParse({ workspaceId: WORKSPACE_ID })
      .success,
  );
  assertStrictEquals(
    MCP_PROGRAM_DETAIL_TOOL_INPUT_SCHEMA.safeParse({}).success,
    false,
  );
  assert(
    MCP_PROGRAM_DETAIL_TOOL_INPUT_SCHEMA.safeParse({ programId: PROGRAM_ID })
      .success,
  );
  assertStrictEquals(
    MCP_PROJECT_DETAIL_TOOL_INPUT_SCHEMA.safeParse({}).success,
    false,
  );
  assert(
    MCP_PROJECT_DETAIL_TOOL_INPUT_SCHEMA.safeParse({ projectId: PROJECT_ID })
      .success,
  );
  assertStrictEquals(
    MCP_PROJECT_PLANNING_TOOL_INPUT_SCHEMA.safeParse({}).success,
    false,
  );
  assert(
    MCP_PROJECT_PLANNING_TOOL_INPUT_SCHEMA.safeParse({ projectId: PROJECT_ID })
      .success,
  );
});

// -----------------------------------------------------------------------------
// F — programs.get canonical parser behavior
// -----------------------------------------------------------------------------

Deno.test("API-Q.7D (F): omitted programs.get arguments resolve to canonical 50/0/null", async () => {
  const { state, executor } = programsHarness();
  const result = await executor({ workspaceId: WORKSPACE_ID });
  assert(result.ok);
  assertEquals(result.payload, PROGRAMS_PAYLOAD);
  assertStrictEquals(state.reads.length, 1);
  assertEquals(state.reads[0].argument, {
    workspaceId: WORKSPACE_ID,
    limit: 50,
    offset: 0,
    search: null,
  });
  // Caller-scoped delegated read carrying the caller's own bearer token, with
  // server-derived identity only.
  assertStrictEquals(state.reads[0].authorization, `Bearer ${VALID_TOKEN}`);
  assertStrictEquals(state.reads[0].oauthClientId, OAUTH_CLIENT_ID);
  assertStrictEquals(state.reads[0].apiClientId, API_CLIENT_ID);
  assertStrictEquals(state.reads[0].tokenUserId, USER_ID);
  assert(
    buildCanonicalProgramsQueryString({ workspaceId: WORKSPACE_ID })
      .startsWith(`?workspace_id=${WORKSPACE_ID}`),
  );
});

Deno.test("API-Q.7D (F): explicit valid programs.get arguments reach the canonical parser unchanged", async () => {
  const { state, executor } = programsHarness();
  const result = await executor({
    workspaceId: WORKSPACE_ID,
    limit: 25,
    offset: 10,
    search: "ad va",
  });
  assert(result.ok);
  assertEquals(state.reads[0].argument, {
    workspaceId: WORKSPACE_ID,
    limit: 25,
    offset: 10,
    search: "ad va",
  });
});

Deno.test("API-Q.7D (F): invalid programs.get values fail through the canonical parser", async () => {
  for (const workspaceId of INVALID_IDS) {
    const { state, executor } = programsHarness();
    const result = await executor({ workspaceId });
    assertStrictEquals(result.ok, false);
    if (!result.ok) assertStrictEquals(result.category, "invalid_arguments");
    assertStrictEquals(state.reads.length, 0);
  }
  for (
    const extra of [
      { limit: 101 },
      { limit: 0 },
      { offset: 10_001 },
      { offset: -1 },
      { search: "x".repeat(101) },
    ]
  ) {
    const { state, executor } = programsHarness();
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

// -----------------------------------------------------------------------------
// G/H/I — single-object reads: canonical path parsers own ID validation
// -----------------------------------------------------------------------------

Deno.test("API-Q.7D (G/H/I): valid single-object reads return the exact canonical payloads", async () => {
  const program = programDetailHarness();
  const programResult = await program.executor({ programId: PROGRAM_ID });
  assert(programResult.ok);
  assertEquals(programResult.payload, PROGRAM_DETAIL_PAYLOAD);
  assertStrictEquals(program.state.reads[0].argument, PROGRAM_ID);

  const detail = projectDetailHarness();
  const detailResult = await detail.executor({ projectId: PROJECT_ID });
  assert(detailResult.ok);
  assertEquals(detailResult.payload, PROJECT_DETAIL_PAYLOAD);
  assertStrictEquals(detail.state.reads[0].argument, PROJECT_ID);

  const planning = projectPlanningHarness();
  const planningResult = await planning.executor({ projectId: PROJECT_ID });
  assert(planningResult.ok);
  assertEquals(planningResult.payload, PROJECT_PLANNING_PAYLOAD);
  assertStrictEquals(planning.state.reads[0].argument, PROJECT_ID);
});

Deno.test("API-Q.7D (G/H/I): invalid IDs fail closed before any business read", async () => {
  for (const badId of INVALID_IDS) {
    const program = programDetailHarness();
    const programResult = await program.executor({ programId: badId });
    assertStrictEquals(programResult.ok, false);
    if (!programResult.ok) {
      assertStrictEquals(programResult.category, "invalid_arguments");
    }
    assertStrictEquals(program.state.reads.length, 0);

    const detail = projectDetailHarness();
    const detailResult = await detail.executor({ projectId: badId });
    assertStrictEquals(detailResult.ok, false);
    if (!detailResult.ok) {
      assertStrictEquals(detailResult.category, "invalid_arguments");
    }
    assertStrictEquals(detail.state.reads.length, 0);

    const planning = projectPlanningHarness();
    const planningResult = await planning.executor({ projectId: badId });
    assertStrictEquals(planningResult.ok, false);
    if (!planningResult.ok) {
      assertStrictEquals(planningResult.category, "invalid_arguments");
    }
    assertStrictEquals(planning.state.reads.length, 0);
  }
});

// -----------------------------------------------------------------------------
// F/G/H/I/J — canonical rate limiting per route, and denial prevents the read
// -----------------------------------------------------------------------------

Deno.test("API-Q.7D (F/G/H/I): rate limiting uses apiClientId + userId + the exact canonical route", async () => {
  const cases: ReadonlyArray<
    { routeId: string; run: () => Promise<HarnessState> }
  > = [
    {
      routeId: "programs.get",
      run: async () => {
        const h = programsHarness();
        await h.executor({ workspaceId: WORKSPACE_ID });
        return h.state;
      },
    },
    {
      routeId: "programs.get_by_id",
      run: async () => {
        const h = programDetailHarness();
        await h.executor({ programId: PROGRAM_ID });
        return h.state;
      },
    },
    {
      routeId: "projects.get_by_id",
      run: async () => {
        const h = projectDetailHarness();
        await h.executor({ projectId: PROJECT_ID });
        return h.state;
      },
    },
    {
      routeId: "projects.planning.get",
      run: async () => {
        const h = projectPlanningHarness();
        await h.executor({ projectId: PROJECT_ID });
        return h.state;
      },
    },
  ];

  for (const testCase of cases) {
    const state = await testCase.run();
    assertEquals(state.profileResolutions, [
      { apiClientId: API_CLIENT_ID, routeId: testCase.routeId },
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
        routeId: testCase.routeId,
        limit: 60,
        windowSeconds: 60,
      },
    );
    assertStrictEquals(state.reads.length, 1);
  }
});

Deno.test("API-Q.7D (J): a denied rate limit prevents every business read", async () => {
  const denied = { allowed: false };

  const programs = programsHarness(denied);
  const programsResult = await programs.executor({ workspaceId: WORKSPACE_ID });
  assertStrictEquals(programsResult.ok, false);
  if (!programsResult.ok) {
    assertStrictEquals(programsResult.category, "rate_limited");
  }
  assertStrictEquals(programs.state.reads.length, 0);

  const program = programDetailHarness(denied);
  const programResult = await program.executor({ programId: PROGRAM_ID });
  assertStrictEquals(programResult.ok, false);
  assertStrictEquals(program.state.reads.length, 0);

  const detail = projectDetailHarness(denied);
  const detailResult = await detail.executor({ projectId: PROJECT_ID });
  assertStrictEquals(detailResult.ok, false);
  assertStrictEquals(detail.state.reads.length, 0);

  const planning = projectPlanningHarness(denied);
  const planningResult = await planning.executor({ projectId: PROJECT_ID });
  assertStrictEquals(planningResult.ok, false);
  assertStrictEquals(planning.state.reads.length, 0);
});

// -----------------------------------------------------------------------------
// K/L — bounded error mapping and non-disclosure
// -----------------------------------------------------------------------------

Deno.test("API-Q.7D (K): canonical not_authorized maps to bounded MCP tool errors", async () => {
  const failure = { failure: new ApiHttpError("not_authorized") };

  const programs = programsHarness(failure);
  const programsResult = await programs.executor({ workspaceId: WORKSPACE_ID });
  assertStrictEquals(programsResult.ok, false);
  if (!programsResult.ok) {
    assertStrictEquals(
      MCP_PROGRAMS_TOOL_ERROR_MESSAGES[programsResult.category],
      "Not authorized to access Programs.",
    );
  }

  const planning = projectPlanningHarness(failure);
  const planningResult = await planning.executor({ projectId: PROJECT_ID });
  assertStrictEquals(planningResult.ok, false);
  if (!planningResult.ok) {
    assertStrictEquals(
      MCP_PROJECT_CONTEXT_TOOL_ERROR_MESSAGES[planningResult.category],
      "Not authorized to access Project data.",
    );
  }
});

Deno.test("API-Q.7D (L/N): provider/database errors and bearer tokens never leak", async () => {
  const failure = {
    failure: new Error(
      `42501: permission denied for table projects (policy proj_members_select) ${POLICY_VERSION_ID} ${VALID_TOKEN}`,
    ),
  };
  const forbidden: readonly string[] = [
    "42501",
    "permission denied",
    "policy",
    POLICY_VERSION_ID,
    VALID_TOKEN,
  ];

  const results = [
    await programsHarness(failure).executor({ workspaceId: WORKSPACE_ID }),
    await programDetailHarness(failure).executor({ programId: PROGRAM_ID }),
    await projectDetailHarness(failure).executor({ projectId: PROJECT_ID }),
    await projectPlanningHarness(failure).executor({ projectId: PROJECT_ID }),
  ];

  for (const result of results) {
    assertStrictEquals(result.ok, false);
    if (!result.ok) assertStrictEquals(result.category, "unavailable");
    const serialized = JSON.stringify(result).toLowerCase();
    for (const needle of forbidden) {
      assertEquals(
        serialized.includes(needle.toLowerCase()),
        false,
        `bounded tool error must not disclose ${needle}`,
      );
    }
  }

  assertStrictEquals(
    MCP_PROGRAMS_TOOL_ERROR_MESSAGES.unavailable,
    "BTPM Programs read is temporarily unavailable.",
  );
  assertStrictEquals(
    MCP_PROJECT_CONTEXT_TOOL_ERROR_MESSAGES.unavailable,
    "BTPM Project read is temporarily unavailable.",
  );
});

Deno.test("API-Q.7D (N): the trusted execution context never carries the bearer token", () => {
  const context = buildMcpExecutionContext(authorizedFixture());
  assertStrictEquals(context.sourceChannel, "mcp");
  assertEquals(JSON.stringify(context).includes(VALID_TOKEN), false);
});

// -----------------------------------------------------------------------------
// M/O — containment: no duplicated business logic, no service role, no generic
// executor
// -----------------------------------------------------------------------------

Deno.test("API-Q.7D (M/O): the new adapters duplicate no business logic and use no service role", () => {
  const modules: ReadonlyArray<{ file: string; reused: readonly string[] }> = [
    {
      file: "./programsReadTools.ts",
      reused: [
        "parseApiV1ProgramsQuery",
        "parseApiV1ProgramDetailPath",
        "PROGRAMS_ROUTE.id",
        "PROGRAM_DETAIL_ROUTE.id",
        "enforceApiRateLimit",
        "buildAuthenticatedApiContextFromMcp",
        "DelegatedApiV1ProgramsReader",
        "DelegatedApiV1ProgramReader",
      ],
    },
    {
      file: "./projectContextReadTools.ts",
      reused: [
        "parseApiV1ProjectDetailPath",
        "parseApiV1ProjectPlanningPath",
        "PROJECT_DETAIL_ROUTE.id",
        "PROJECT_PLANNING_ROUTE.id",
        "enforceApiRateLimit",
        "buildAuthenticatedApiContextFromMcp",
        "DelegatedApiV1ProjectDetailReader",
        "DelegatedApiV1ProjectPlanningReader",
      ],
    },
  ];

  for (const module of modules) {
    const source = Deno.readTextFileSync(new URL(module.file, __BTPM_SRC_BASE__));
    const code = source
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//"))
      .join("\n");
    for (
      const needle of [
        ".from(",
        ".rpc(",
        "api_v1_list_programs",
        "api_v1_get_program",
        "api_v1_get_project",
        "api_v1_get_project_planning",
        "SERVICE_ROLE",
        "Deno.env",
        "fetch(",
        "project_members",
        "createReadTool",
        "executeOperation",
        "operationExecutorMap",
        "select ",
      ]
    ) {
      assertEquals(
        code.includes(needle),
        false,
        `${module.file} must not contain ${needle}`,
      );
    }
    for (const reused of module.reused) {
      assert(source.includes(reused), `${module.file} must reuse ${reused}`);
    }
  }
});
