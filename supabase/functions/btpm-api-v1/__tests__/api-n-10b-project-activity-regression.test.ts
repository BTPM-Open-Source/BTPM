// API-N.10B — Project + Program durable-activity regression (real handler).
//
// This is a PERMANENT regression guard over the accepted API-N.6-C1 activity
// semantics. It changes no production behavior. Every dependency is injected:
// no environment, network, Supabase client or live adapter is touched.
//
// Accepted semantics frozen here:
//   * projects.create      -> durable activity on `applied` AND `replayed`
//   * projects.update      -> durable activity ONLY on `applied`
//   * projects.transition  -> durable activity ONLY on `applied`
//   * programs.create      -> NO durable API activity (the activity-scope
//     substrate resolves Project / Phase / Task targets only)
//   * programs.update      -> NO durable API activity (same reason)
//
// Bounded 409 completion outcomes, optimistic-concurrency conflicts and
// no-change replays never produce activity.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  handleApiV1Request,
  type ApiV1HttpHandlerDependencies,
} from "../handler.ts";
import type { ApiRuntimeControls } from "../router.ts";
import type { AuthenticatedApiContext } from "../../_shared/btpm-api/authenticateApiRequest.ts";
import type { ApiActivityRecordInput } from "../../_shared/btpm-api/supabaseActivity.ts";
import type { ApiActivityScope } from "../../_shared/btpm-api/supabaseActivityScope.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER_ID = "11111111-1111-4111-8111-111111111111";
const API_CLIENT_ID = "22222222-2222-4222-8222-222222222222";
const POLICY_VERSION_ID = "33333333-3333-4333-8333-333333333333";
const TENANT_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const ORG_ID = "bbbbbbbb-2222-4222-8222-222222222222";
const WS_ID = "cccccccc-3333-4333-8333-333333333333";
const PROJECT_ID = "dddddddd-4444-4444-8444-444444444444";
const PROGRAM_ID = "eeeeeeee-5555-4555-8555-555555555555";
const OAUTH_CLIENT_ID = "oauth-client-n10b";
const ALLOWED_ORIGIN = "https://app.example.com";
const FIXED_REQUEST_ID = "req-n10b-uuid-0001";
const IDEMPOTENCY_KEY = "idem-n10b-0001";
const TS = "2026-08-12T14:56:32.123456+00:00";

const SCOPE: ApiActivityScope = Object.freeze({
  tenantId: TENANT_ID,
  organizationId: ORG_ID,
  workspaceId: WS_ID,
  projectId: PROJECT_ID,
});

const AUTH_CONTEXT: AuthenticatedApiContext = Object.freeze({
  token: Object.freeze({ userId: USER_ID, clientId: OAUTH_CLIENT_ID }),
  client: Object.freeze({
    userId: USER_ID,
    apiClientId: API_CLIENT_ID,
    policyVersionId: POLICY_VERSION_ID,
    oauthClientId: OAUTH_CLIENT_ID,
  }),
}) as unknown as AuthenticatedApiContext;

const CONTROLS: ApiRuntimeControls = Object.freeze({
  apiEnabled: true,
  readsEnabled: true,
  mutationsEnabled: true,
});

const RATE_LIMIT = {
  store: {
    consume: () =>
      Promise.resolve({
        allowed: true,
        remaining: 99,
        resetAtEpochMs: 1_700_000_000_000,
      }),
  },
  now: () => 1_600_000_000_000,
};

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface ScopeCall {
  targetType: string;
  targetId: string;
}

interface Trace {
  activity: ApiActivityRecordInput[];
  scopeCalls: ScopeCall[];
  scheduled: number;
  projectExecutors: string[];
  programExecutors: string[];
}

function newTrace(): Trace {
  return {
    activity: [],
    scopeCalls: [],
    scheduled: 0,
    projectExecutors: [],
    programExecutors: [],
  };
}

let pending: Promise<boolean>[] = [];

async function settle(): Promise<void> {
  const tasks = pending;
  pending = [];
  await Promise.allSettled(tasks);
}

interface Results {
  createProject?: unknown;
  updateProject?: unknown;
  transitionProject?: unknown;
  createProgram?: unknown;
  updateProgram?: unknown;
}

function makeDeps(
  trace: Trace,
  results: Results,
): ApiV1HttpHandlerDependencies {
  const authBits = {
    authenticate: () => Promise.resolve(AUTH_CONTEXT),
    authorizeRoute: () => Promise.resolve(),
    resolveRateLimitProfile: () =>
      Promise.resolve({ limit: 100, windowSeconds: 60 }),
    rateLimit: RATE_LIMIT,
  };

  let clock = 1_000;
  const activityDeps = {
    recorder: {
      record: (input: ApiActivityRecordInput) => {
        trace.activity.push(input);
        return Promise.resolve(true);
      },
    },
    nowMs: () => (clock += 5),
    schedule: (task: Promise<boolean>) => {
      trace.scheduled += 1;
      pending.push(task);
    },
    scopeResolver: {
      resolve: (targetType: string, targetId: string) => {
        trace.scopeCalls.push({ targetType, targetId });
        return Promise.resolve(SCOPE);
      },
    },
  };

  const project = (name: string, value: unknown) => () => {
    trace.projectExecutors.push(name);
    return Promise.resolve(value);
  };
  const program = (name: string, value: unknown) => () => {
    trace.programExecutors.push(name);
    return Promise.resolve(value);
  };

  const deps: Record<string, unknown> = {
    controls: CONTROLS,
    allowedOrigins: new Set<string>([ALLOWED_ORIGIN]),
    timeoutMs: 5_000,
    requestId: { randomUUID: () => FIXED_REQUEST_ID },
    protectedRoute: {
      ...authBits,
      readMe: () => Promise.resolve({ userId: USER_ID }),
      readOrganizations: () => Promise.resolve({ organizations: [] }),
      readWorkspaces: () => Promise.resolve({ workspaces: [] }),
      readProjects: () => Promise.resolve({ projects: [] }),
      readProjectDetail: () => Promise.resolve({ project: null }),
      readProjectPlanning: () => Promise.resolve({ project: null }),
    },
    projectMutationRoute: {
      ...authBits,
      createProject: project("createProject", results.createProject),
      updateProject: project("updateProject", results.updateProject),
      transitionProject: project(
        "transitionProject",
        results.transitionProject,
      ),
    },
    programMutationRoute: {
      ...authBits,
      createProgram: program("createProgram", results.createProgram),
      updateProgram: program("updateProgram", results.updateProgram),
    },
    activity: activityDeps,
  };
  return deps as unknown as ApiV1HttpHandlerDependencies;
}

function makeRequest(method: string, path: string, body: unknown): Request {
  return new Request(`https://api.example.test${path}`, {
    method,
    headers: new Headers({
      Origin: ALLOWED_ORIGIN,
      "Content-Type": "application/json",
      "Idempotency-Key": IDEMPOTENCY_KEY,
    }),
    body: JSON.stringify(body),
  });
}

const PROJECT_CREATE_BODY = {
  workspaceId: WS_ID,
  name: "Programme delivery stream",
  programId: null,
  deliveryModel: null,
};

const PROJECT_UPDATE_BODY = {
  expectedUpdatedAt: TS,
  name: "Renamed delivery stream",
};

const PROJECT_TRANSITION_BODY = {
  expectedUpdatedAt: TS,
  targetStatus: "active",
};

const PROGRAM_CREATE_BODY = {
  workspaceId: WS_ID,
  name: "SAP S/4HANA programme",
};

const PROGRAM_UPDATE_BODY = {
  expectedUpdatedAt: TS,
  name: "SAP S/4HANA programme (renamed)",
};

async function call(
  trace: Trace,
  results: Results,
  method: string,
  path: string,
  body: unknown,
): Promise<{ status: number; payload: Record<string, unknown> }> {
  const response = await handleApiV1Request(
    makeRequest(method, path, body),
    makeDeps(trace, results),
  );
  const status = response.status;
  const payload = await response.json() as Record<string, unknown>;
  await settle();
  return { status, payload };
}

// ---------------------------------------------------------------------------
// Project create — activity on `applied` AND `replayed`
// ---------------------------------------------------------------------------

Deno.test("API-N.10B: projects.create applied records exactly one Project-scoped activity", async () => {
  const trace = newTrace();
  const { status } = await call(
    trace,
    {
      createProject: {
        ok: true,
        outcome: "applied",
        projectId: PROJECT_ID,
      },
    },
    "POST",
    "/v1/projects",
    PROJECT_CREATE_BODY,
  );
  assertEquals(status, 201);
  assertEquals(trace.scheduled, 1);
  assertEquals(trace.activity.length, 1);
  assertEquals(trace.scopeCalls, [
    { targetType: "project", targetId: PROJECT_ID },
  ]);
  const event = trace.activity[0];
  assertEquals(event.routeId, "projects.create");
  assertEquals(event.method, "POST");
  assertEquals(event.status, 201);
  assertEquals(event.apiVersion, "v1");
  assertEquals(event.apiClientId, API_CLIENT_ID);
  assertEquals(event.actorUserId, USER_ID);
  assertEquals(event.tenantId, TENANT_ID);
  assertEquals(event.organizationId, ORG_ID);
  assertEquals(event.workspaceId, WS_ID);
  assertEquals(event.projectId, PROJECT_ID);
  assertEquals(trace.projectExecutors, ["createProject"]);
  assertEquals(trace.programExecutors, []);
});

Deno.test("API-N.10B: projects.create replayed still records exactly one activity", async () => {
  const trace = newTrace();
  const { status } = await call(
    trace,
    {
      createProject: {
        ok: true,
        outcome: "replayed",
        projectId: PROJECT_ID,
      },
    },
    "POST",
    "/v1/projects",
    PROJECT_CREATE_BODY,
  );
  assertEquals(status, 200);
  assertEquals(trace.scheduled, 1);
  assertEquals(trace.activity.length, 1);
  assertEquals(trace.activity[0].routeId, "projects.create");
  assertEquals(trace.activity[0].status, 200);
});

// ---------------------------------------------------------------------------
// Project update — activity ONLY on `applied`
// ---------------------------------------------------------------------------

Deno.test("API-N.10B: projects.update records activity only when genuinely applied", async () => {
  const cases: ReadonlyArray<[string, number]> = [
    ["applied", 1],
    ["no_change", 0],
    ["replayed", 0],
  ];
  for (const [outcome, expected] of cases) {
    const trace = newTrace();
    const { status } = await call(
      trace,
      {
        updateProject: {
          ok: true,
          outcome,
          projectId: PROJECT_ID,
          updatedAt: TS,
        },
      },
      "PATCH",
      `/v1/projects/${PROJECT_ID}`,
      PROJECT_UPDATE_BODY,
    );
    assertEquals(status, 200, outcome);
    assertEquals(trace.activity.length, expected, outcome);
    assertEquals(trace.scheduled, expected, outcome);
    assertEquals(trace.scopeCalls.length, expected, outcome);
    if (expected === 1) {
      assertEquals(trace.activity[0].routeId, "projects.update");
      assertEquals(trace.activity[0].method, "PATCH");
      assertEquals(trace.activity[0].projectId, PROJECT_ID);
    }
    assertEquals(trace.projectExecutors, ["updateProject"], outcome);
  }
});

Deno.test("API-N.10B: projects.update stale conflict returns 409 and records no activity", async () => {
  const trace = newTrace();
  const { status, payload } = await call(
    trace,
    { updateProject: { ok: false, outcome: "conflict", code: "stale_project" } },
    "PATCH",
    `/v1/projects/${PROJECT_ID}`,
    PROJECT_UPDATE_BODY,
  );
  assertEquals(status, 409);
  assertEquals(trace.activity.length, 0);
  assertEquals(trace.scheduled, 0);
  assert(!JSON.stringify(payload).includes("stale_project"));
});

// ---------------------------------------------------------------------------
// Project transition — activity ONLY on `applied`
// ---------------------------------------------------------------------------

Deno.test("API-N.10B: projects.transition records activity only when genuinely applied", async () => {
  const cases: ReadonlyArray<[string, number]> = [
    ["applied", 1],
    ["no_change", 0],
    ["replayed", 0],
  ];
  for (const [outcome, expected] of cases) {
    const trace = newTrace();
    const { status } = await call(
      trace,
      {
        transitionProject: {
          ok: true,
          outcome,
          projectId: PROJECT_ID,
          status: "active",
          previousStatus: "planned",
          updatedAt: TS,
        },
      },
      "POST",
      `/v1/projects/${PROJECT_ID}/transition`,
      PROJECT_TRANSITION_BODY,
    );
    assertEquals(status, 200, outcome);
    assertEquals(trace.activity.length, expected, outcome);
    assertEquals(trace.scheduled, expected, outcome);
    if (expected === 1) {
      assertEquals(trace.activity[0].routeId, "projects.transition");
      assertEquals(trace.activity[0].method, "POST");
      assertEquals(trace.activity[0].status, 200);
    }
    assertEquals(trace.projectExecutors, ["transitionProject"], outcome);
  }
});

Deno.test("API-N.10B: bounded 409 completion outcomes never record activity", async () => {
  const blocked = {
    ok: false,
    outcome: "blocked",
    code: "completion_hard_blocked",
    projectId: PROJECT_ID,
    hardBlocks: [{ category: "open_blockers", count: 2 }],
    warnings: [],
    counts: { open_blockers: 2 },
  };
  const confirmation = {
    ok: false,
    outcome: "confirmation_required",
    code: "completion_soft_warnings",
    projectId: PROJECT_ID,
    hardBlocks: [],
    warnings: [{ category: "open_risks", count: 1 }],
    counts: { open_risks: 1 },
  };
  for (const result of [blocked, confirmation]) {
    const trace = newTrace();
    const { status } = await call(
      trace,
      { transitionProject: result },
      "POST",
      `/v1/projects/${PROJECT_ID}/transition`,
      { ...PROJECT_TRANSITION_BODY, targetStatus: "completed" },
    );
    assertEquals(status, 409, String(result.outcome));
    assertEquals(trace.activity.length, 0, String(result.outcome));
    assertEquals(trace.scheduled, 0, String(result.outcome));
    assertEquals(trace.scopeCalls.length, 0, String(result.outcome));
  }
});

// ---------------------------------------------------------------------------
// Program commands — no durable API activity by accepted design
// ---------------------------------------------------------------------------

Deno.test("API-N.10B: programs.create records no durable activity and never resolves a scope", async () => {
  for (const outcome of ["applied", "replayed"]) {
    const trace = newTrace();
    const { status } = await call(
      trace,
      { createProgram: { ok: true, outcome, programId: PROGRAM_ID } },
      "POST",
      "/v1/programs",
      PROGRAM_CREATE_BODY,
    );
    assertEquals(status, outcome === "applied" ? 201 : 200, outcome);
    assertEquals(trace.activity.length, 0, outcome);
    assertEquals(trace.scheduled, 0, outcome);
    assertEquals(trace.scopeCalls.length, 0, outcome);
    assertEquals(trace.programExecutors, ["createProgram"], outcome);
    assertEquals(trace.projectExecutors, [], outcome);
  }
});

Deno.test("API-N.10B: programs.update records no durable activity for any success outcome", async () => {
  for (const outcome of ["applied", "no_change", "replayed"]) {
    const trace = newTrace();
    const { status } = await call(
      trace,
      {
        updateProgram: {
          ok: true,
          outcome,
          programId: PROGRAM_ID,
          updatedAt: TS,
        },
      },
      "PATCH",
      `/v1/programs/${PROGRAM_ID}`,
      PROGRAM_UPDATE_BODY,
    );
    assertEquals(status, 200, outcome);
    assertEquals(trace.activity.length, 0, outcome);
    assertEquals(trace.scheduled, 0, outcome);
    assertEquals(trace.scopeCalls.length, 0, outcome);
    assertEquals(trace.programExecutors, ["updateProgram"], outcome);
    assertEquals(trace.projectExecutors, [], outcome);
  }
});

Deno.test("API-N.10B: programs.update stale conflict returns 409 without leaking the internal code", async () => {
  const trace = newTrace();
  const { status, payload } = await call(
    trace,
    { updateProgram: { ok: false, outcome: "conflict", code: "stale_program" } },
    "PATCH",
    `/v1/programs/${PROGRAM_ID}`,
    PROGRAM_UPDATE_BODY,
  );
  assertEquals(status, 409);
  assertEquals(trace.activity.length, 0);
  assert(!JSON.stringify(payload).includes("stale_program"));
});

// ---------------------------------------------------------------------------
// Cross-family containment
// ---------------------------------------------------------------------------

Deno.test("API-N.10B: each family command invokes exactly one delegated executor", async () => {
  const trace = newTrace();
  await call(
    trace,
    {
      createProject: { ok: true, outcome: "applied", projectId: PROJECT_ID },
      createProgram: { ok: true, outcome: "applied", programId: PROGRAM_ID },
    },
    "POST",
    "/v1/programs",
    PROGRAM_CREATE_BODY,
  );
  assertEquals(trace.programExecutors, ["createProgram"]);
  assertEquals(trace.projectExecutors, []);

  const trace2 = newTrace();
  await call(
    trace2,
    {
      createProject: { ok: true, outcome: "applied", projectId: PROJECT_ID },
      createProgram: { ok: true, outcome: "applied", programId: PROGRAM_ID },
    },
    "POST",
    "/v1/projects",
    PROJECT_CREATE_BODY,
  );
  assertEquals(trace2.projectExecutors, ["createProject"]);
  assertEquals(trace2.programExecutors, []);
});

// ---------------------------------------------------------------------------
// API-N.10B-C1 — Real-handler negative activity matrix.
//
// Every bounded failure outcome of every Project command must produce:
//   * the correct bounded HTTP status,
//   * zero durable activity records,
//   * zero scheduled activity tasks,
//   * zero scope resolutions,
//   * exactly one invocation of the intended Project executor,
//   * no invocation of any other Project or Program executor.
// ---------------------------------------------------------------------------

interface NegativeCase {
  readonly label: string;
  readonly executor: "createProject" | "updateProject" | "transitionProject";
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
  readonly result: Record<string, unknown>;
  readonly status: number;
  /** Bounded completion outcomes intentionally expose their public code. */
  readonly publicCode?: true;
}

const NEGATIVE_CASES: ReadonlyArray<NegativeCase> = Object.freeze([
  {
    label: "projects.create invalid",
    executor: "createProject",
    method: "POST",
    path: "/v1/projects",
    body: PROJECT_CREATE_BODY,
    result: { ok: false, outcome: "invalid", code: "invalid_project_input" },
    status: 400,
  },
  {
    label: "projects.create not_authorized",
    executor: "createProject",
    method: "POST",
    path: "/v1/projects",
    body: PROJECT_CREATE_BODY,
    result: {
      ok: false,
      outcome: "not_authorized",
      code: "workspace_not_enabled",
    },
    status: 403,
  },
  {
    label: "projects.update invalid",
    executor: "updateProject",
    method: "PATCH",
    path: `/v1/projects/${PROJECT_ID}`,
    body: PROJECT_UPDATE_BODY,
    result: { ok: false, outcome: "invalid", code: "invalid_project_input" },
    status: 400,
  },
  {
    label: "projects.update not_authorized",
    executor: "updateProject",
    method: "PATCH",
    path: `/v1/projects/${PROJECT_ID}`,
    body: PROJECT_UPDATE_BODY,
    result: {
      ok: false,
      outcome: "not_authorized",
      code: "project_not_enabled",
    },
    status: 403,
  },
  {
    label: "projects.update stale conflict",
    executor: "updateProject",
    method: "PATCH",
    path: `/v1/projects/${PROJECT_ID}`,
    body: PROJECT_UPDATE_BODY,
    result: { ok: false, outcome: "conflict", code: "stale_project" },
    status: 409,
  },
  {
    label: "projects.transition invalid",
    executor: "transitionProject",
    method: "POST",
    path: `/v1/projects/${PROJECT_ID}/transition`,
    body: PROJECT_TRANSITION_BODY,
    result: { ok: false, outcome: "invalid", code: "invalid_transition" },
    status: 400,
  },
  {
    label: "projects.transition not_authorized",
    executor: "transitionProject",
    method: "POST",
    path: `/v1/projects/${PROJECT_ID}/transition`,
    body: PROJECT_TRANSITION_BODY,
    result: {
      ok: false,
      outcome: "not_authorized",
      code: "project_not_enabled",
    },
    status: 403,
  },
  {
    label: "projects.transition stale conflict",
    executor: "transitionProject",
    method: "POST",
    path: `/v1/projects/${PROJECT_ID}/transition`,
    body: PROJECT_TRANSITION_BODY,
    result: { ok: false, outcome: "conflict", code: "stale_project" },
    status: 409,
  },
  {
    label: "projects.transition blocked",
    executor: "transitionProject",
    method: "POST",
    path: `/v1/projects/${PROJECT_ID}/transition`,
    body: { ...PROJECT_TRANSITION_BODY, targetStatus: "completed" },
    result: {
      ok: false,
      outcome: "blocked",
      code: "completion_hard_blocked",
      projectId: PROJECT_ID,
      hardBlocks: [{ category: "open_blockers", count: 2 }],
      warnings: [],
      counts: { open_blockers: 2 },
    },
    status: 409,
    publicCode: true,
  },
  {
    label: "projects.transition confirmation_required",
    executor: "transitionProject",
    method: "POST",
    path: `/v1/projects/${PROJECT_ID}/transition`,
    body: { ...PROJECT_TRANSITION_BODY, targetStatus: "completed" },
    result: {
      ok: false,
      outcome: "confirmation_required",
      code: "completion_soft_warnings",
      projectId: PROJECT_ID,
      hardBlocks: [],
      warnings: [{ category: "open_risks", count: 1 }],
      counts: { open_risks: 1 },
    },
    status: 409,
    publicCode: true,
  },
]);

for (const negative of NEGATIVE_CASES) {
  Deno.test(
    `API-N.10B-C1: ${negative.label} records no durable activity`,
    async () => {
      const trace = newTrace();
      // Every family executor is available; only the intended one may run.
      const results: Results = {
        createProject: { ok: true, outcome: "applied", projectId: PROJECT_ID },
        updateProject: {
          ok: true,
          outcome: "applied",
          projectId: PROJECT_ID,
          updatedAt: TS,
        },
        transitionProject: {
          ok: true,
          outcome: "applied",
          projectId: PROJECT_ID,
          status: "active",
          previousStatus: "planned",
          updatedAt: TS,
        },
        createProgram: { ok: true, outcome: "applied", programId: PROGRAM_ID },
        updateProgram: {
          ok: true,
          outcome: "applied",
          programId: PROGRAM_ID,
          updatedAt: TS,
        },
      };
      (results as Record<string, unknown>)[negative.executor] =
        negative.result;

      const { status, payload } = await call(
        trace,
        results,
        negative.method,
        negative.path,
        negative.body,
      );

      assertEquals(status, negative.status, negative.label);
      assertEquals(trace.activity.length, 0, negative.label);
      assertEquals(trace.scheduled, 0, negative.label);
      assertEquals(trace.scopeCalls.length, 0, negative.label);
      assertEquals(trace.projectExecutors, [negative.executor], negative.label);
      assertEquals(trace.programExecutors, [], negative.label);
      // Internal wrapper codes are never surfaced verbatim, except for the
      // accepted public completion-contract codes.
      if (negative.publicCode !== true) {
        const serialized = JSON.stringify(payload);
        assert(
          !serialized.includes(String(negative.result.code)),
          `${negative.label} leaked ${String(negative.result.code)}`,
        );
      }
    },
  );
}

// ---------------------------------------------------------------------------
// API-N.10B-C1 — Scheduled Project activity identity (applied only).
// ---------------------------------------------------------------------------

Deno.test("API-N.10B-C1: applied projects.update activity identity is fully server-derived", async () => {
  const trace = newTrace();
  const { status } = await call(
    trace,
    {
      updateProject: {
        ok: true,
        outcome: "applied",
        projectId: PROJECT_ID,
        updatedAt: TS,
      },
    },
    "PATCH",
    `/v1/projects/${PROJECT_ID}`,
    PROJECT_UPDATE_BODY,
  );
  assertEquals(status, 200);
  assertEquals(trace.scopeCalls, [
    { targetType: "project", targetId: PROJECT_ID },
  ]);
  assertEquals(trace.activity.length, 1);
  const event = trace.activity[0];
  assertEquals(event.routeId, "projects.update");
  assertEquals(event.method, "PATCH");
  assertEquals(event.status, 200);
  assertEquals(event.apiVersion, "v1");
  assertEquals(event.apiClientId, API_CLIENT_ID);
  assertEquals(event.actorUserId, USER_ID);
  assertEquals(event.projectId, PROJECT_ID);
  assertEquals(event.tenantId, TENANT_ID);
  assertEquals(event.organizationId, ORG_ID);
  assertEquals(event.workspaceId, WS_ID);
});

Deno.test("API-N.10B-C1: applied projects.transition activity identity is fully server-derived", async () => {
  const trace = newTrace();
  const { status } = await call(
    trace,
    {
      transitionProject: {
        ok: true,
        outcome: "applied",
        projectId: PROJECT_ID,
        status: "active",
        previousStatus: "planned",
        updatedAt: TS,
      },
    },
    "POST",
    `/v1/projects/${PROJECT_ID}/transition`,
    PROJECT_TRANSITION_BODY,
  );
  assertEquals(status, 200);
  assertEquals(trace.scopeCalls, [
    { targetType: "project", targetId: PROJECT_ID },
  ]);
  assertEquals(trace.activity.length, 1);
  const event = trace.activity[0];
  assertEquals(event.routeId, "projects.transition");
  assertEquals(event.method, "POST");
  assertEquals(event.status, 200);
  assertEquals(event.apiVersion, "v1");
  assertEquals(event.apiClientId, API_CLIENT_ID);
  assertEquals(event.actorUserId, USER_ID);
  assertEquals(event.projectId, PROJECT_ID);
  assertEquals(event.tenantId, TENANT_ID);
  assertEquals(event.organizationId, ORG_ID);
  assertEquals(event.workspaceId, WS_ID);
});

// ---------------------------------------------------------------------------
// API-N.10B-C1 — Sensitive request content and idempotency key exclusion.
// ---------------------------------------------------------------------------

const SENSITIVE_MARKER = "N10B-SENSITIVE-MARKER-DO-NOT-LOG";

const FORBIDDEN_ACTIVITY_FIELDS: ReadonlyArray<string> = Object.freeze([
  "payloadHash",
  "payload_hash",
  "idempotencyKey",
  "idempotency_key",
  "requestBody",
  "body",
  "narrative",
]);

Deno.test("API-N.10B-C1: recorded activity excludes request content and the idempotency key", async () => {
  const trace = newTrace();
  const { status } = await call(
    trace,
    {
      updateProject: {
        ok: true,
        outcome: "applied",
        projectId: PROJECT_ID,
        updatedAt: TS,
      },
    },
    "PATCH",
    `/v1/projects/${PROJECT_ID}`,
    {
      expectedUpdatedAt: TS,
      name: SENSITIVE_MARKER,
      description: `${SENSITIVE_MARKER} narrative body`,
    },
  );
  assertEquals(status, 200);
  assertEquals(trace.activity.length, 1);

  const event = trace.activity[0] as unknown as Record<string, unknown>;
  const serialized = JSON.stringify(event);
  assert(
    !serialized.includes(SENSITIVE_MARKER),
    "activity metadata contains request content",
  );
  assert(
    !serialized.includes(IDEMPOTENCY_KEY),
    "activity metadata contains the idempotency key",
  );
  for (const field of FORBIDDEN_ACTIVITY_FIELDS) {
    assert(!(field in event), `activity exposes a forbidden field: ${field}`);
    assert(
      !serialized.includes(`"${field}"`),
      `activity serializes a forbidden field: ${field}`,
    );
  }
});
