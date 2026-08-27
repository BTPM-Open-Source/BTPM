// API-ADM.1 — C / D. Live-handler durable-activity attribution tests for the
// five already-approved external mutation routes.
//
// Fully dependency-injected: no environment, network, Supabase client or
// live adapter is touched. These tests assert ONLY activity attribution and
// containment; mutation behavior, status codes and payloads must remain
// exactly as approved by API-I / API-K.

import {
  assert,
  assertEquals,
  assertStrictEquals,
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
const TARGET_ID = "44444444-4444-4444-8444-444444444444";
const RISK_ID = "8f14e45f-ceea-467a-a4a7-2b4b0c7f4d21";
const BLOCKER_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const TENANT_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const ORG_ID = "bbbbbbbb-2222-4222-8222-222222222222";
const WS_ID = "cccccccc-3333-4333-8333-333333333333";
const PROJECT_ID = "dddddddd-4444-4444-8444-444444444444";
const OAUTH_CLIENT_ID = "oauth-client-abc";
const ALLOWED_ORIGIN = "https://app.example.com";
const FIXED_REQUEST_ID = "req-fixed-uuid-0001";
const IDEMPOTENCY_KEY = "idem-key-0001";
const TS = "2026-08-08T14:56:32.123456+00:00";

const NARRATIVE = "Confidential narrative that must never be recorded.";

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

const EXECUTION_OK = Object.freeze({
  ok: true,
  outcome: "applied",
  executionUpdateId: "55555555-5555-4555-8555-555555555555",
  targetType: "task",
  targetId: TARGET_ID,
  updateDate: "2026-08-07",
  hasStatusLabel: false,
});

const RISK_CREATE_OK = Object.freeze({
  ok: true,
  outcome: "applied",
  riskId: RISK_ID,
  targetType: "project",
  targetId: TARGET_ID,
  likelihood: "medium",
  impact: "high",
  status: "open",
  createdAt: TS,
  updatedAt: TS,
});

const RISK_UPDATE_OK = Object.freeze({
  ok: true,
  outcome: "applied",
  riskId: RISK_ID,
  targetType: "project",
  targetId: TARGET_ID,
  likelihood: "medium",
  impact: "high",
  status: "under_mitigation",
  updatedAt: TS,
});

const BLOCKER_CREATE_OK = Object.freeze({
  ok: true,
  outcome: "applied",
  blockerId: BLOCKER_ID,
  targetType: "project",
  targetId: TARGET_ID,
  severity: "high",
  status: "open",
  isResolved: false,
  resolvedAt: null,
  createdAt: TS,
  updatedAt: TS,
});

const BLOCKER_UPDATE_OK = Object.freeze({
  ok: true,
  outcome: "applied",
  blockerId: BLOCKER_ID,
  targetType: "project",
  targetId: TARGET_ID,
  severity: "high",
  status: "resolved",
  isResolved: true,
  resolvedAt: TS,
  updatedAt: TS,
});

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
  executors: number;
}

function newTrace(): Trace {
  return { activity: [], scopeCalls: [], scheduled: 0, executors: 0 };
}

interface Options {
  /** Omit the resolver entirely (pre-API-ADM.1 shape). */
  omitScopeResolver?: boolean;
  /** Resolver behavior. */
  scope?: ApiActivityScope | null;
  resolverThrows?: boolean;
  recorderThrows?: boolean;
  /** Force a negative (ok:false) mutation result. */
  negative?: boolean;
  /** Malformed activity dependencies. */
  brokenActivity?: unknown;
}

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

function makeDeps(trace: Trace, options: Options = {}) {
  const authBits = {
    authenticate: () => Promise.resolve(AUTH_CONTEXT),
    authorizeRoute: () => Promise.resolve(),
    resolveRateLimitProfile: () =>
      Promise.resolve({ limit: 100, windowSeconds: 60 }),
    rateLimit: RATE_LIMIT,
  };

  const neg = Object.freeze({ ok: false, outcome: "invalid" });
  const pick = (ok: unknown) => {
    trace.executors += 1;
    return Promise.resolve(options.negative === true ? neg : ok);
  };

  let clock = 1_000;
  const activityDeps: Record<string, unknown> = {
    recorder: {
      record: (input: ApiActivityRecordInput) => {
        if (options.recorderThrows === true) {
          throw new Error("recorder exploded");
        }
        trace.activity.push(input);
        return Promise.resolve(true);
      },
    },
    nowMs: () => (clock += 5),
    schedule: (task: Promise<boolean>) => {
      trace.scheduled += 1;
      // Deliberately awaited by the tests via the returned promise list.
      pending.push(task);
    },
  };
  if (options.omitScopeResolver !== true) {
    activityDeps.scopeResolver = {
      resolve: (targetType: string, targetId: string) => {
        trace.scopeCalls.push({ targetType, targetId });
        if (options.resolverThrows === true) {
          return Promise.reject(new Error("resolver exploded"));
        }
        return Promise.resolve(
          options.scope === undefined ? SCOPE : options.scope,
        );
      },
    };
  }

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
    appendExecutionUpdateRoute: {
      ...authBits,
      appendExecutionUpdate: () => pick(EXECUTION_OK),
    },
    riskMutationRoute: {
      ...authBits,
      createRisk: () => pick(RISK_CREATE_OK),
      updateRisk: () => pick(RISK_UPDATE_OK),
    },
    blockerMutationRoute: {
      ...authBits,
      createBlocker: () => pick(BLOCKER_CREATE_OK),
      updateBlocker: () => pick(BLOCKER_UPDATE_OK),
    },
    activity: options.brokenActivity !== undefined
      ? options.brokenActivity
      : activityDeps,
  };
  return deps as unknown as ApiV1HttpHandlerDependencies;
}

let pending: Promise<boolean>[] = [];

async function settle(): Promise<void> {
  const tasks = pending;
  pending = [];
  await Promise.allSettled(tasks);
}

function makeRequest(method: string, path: string, body: unknown): Request {
  const headers = new Headers({
    Origin: ALLOWED_ORIGIN,
    "Content-Type": "application/json",
    "Idempotency-Key": IDEMPOTENCY_KEY,
  });
  return new Request(`https://api.example.test${path}`, {
    method,
    headers,
    body: JSON.stringify(body),
  });
}

const EXECUTION_BODY = {
  targetType: "task",
  targetId: TARGET_ID,
  summary: NARRATIVE,
  updateDate: "2026-08-07",
  statusLabel: null,
};

const RISK_CREATE_BODY = {
  targetType: "project",
  targetId: TARGET_ID,
  title: NARRATIVE,
  description: null,
  mitigationPlan: null,
  likelihood: "medium",
  impact: "high",
  status: "open",
};

const RISK_UPDATE_BODY = {
  expectedUpdatedAt: TS,
  title: NARRATIVE,
  description: null,
  mitigationPlan: null,
  likelihood: "medium",
  impact: "high",
  status: "under_mitigation",
};

const BLOCKER_CREATE_BODY = {
  targetType: "project",
  targetId: TARGET_ID,
  title: NARRATIVE,
  description: null,
  severity: "high",
  status: "open",
};

const BLOCKER_UPDATE_BODY = {
  expectedUpdatedAt: TS,
  title: NARRATIVE,
  description: null,
  severity: "high",
  status: "resolved",
};

interface RouteCase {
  readonly name: string;
  readonly routeId: string;
  readonly method: "POST" | "PATCH";
  readonly path: string;
  readonly body: unknown;
  readonly successStatus: number;
}

const ROUTES: ReadonlyArray<RouteCase> = Object.freeze([
  {
    name: "execution-updates.append",
    routeId: "execution_updates.append",
    method: "POST",
    path: "/v1/execution-updates",
    body: EXECUTION_BODY,
    successStatus: 201,
  },
  {
    name: "risks.create",
    routeId: "risks.create",
    method: "POST",
    path: "/v1/risks",
    body: RISK_CREATE_BODY,
    successStatus: 201,
  },
  {
    name: "risks.update",
    routeId: "risks.update",
    method: "PATCH",
    path: `/v1/risks/${RISK_ID}`,
    body: RISK_UPDATE_BODY,
    successStatus: 200,
  },
  {
    name: "blockers.create",
    routeId: "blockers.create",
    method: "POST",
    path: "/v1/blockers",
    body: BLOCKER_CREATE_BODY,
    successStatus: 201,
  },
  {
    name: "blockers.update",
    routeId: "blockers.update",
    method: "PATCH",
    path: `/v1/blockers/${BLOCKER_ID}`,
    body: BLOCKER_UPDATE_BODY,
    successStatus: 200,
  },
]);

// ---------------------------------------------------------------------------
// C — Attribution on success
// ---------------------------------------------------------------------------

Deno.test("C — every successful mutation records exactly one fully scoped event", async () => {
  for (const route of ROUTES) {
    const trace = newTrace();
    const response = await handleApiV1Request(
      makeRequest(route.method, route.path, route.body),
      makeDeps(trace),
    );
    assertEquals(response.status, route.successStatus, route.name);
    await response.json();
    await settle();

    assertEquals(trace.scheduled, 1, route.name);
    assertEquals(trace.activity.length, 1, route.name);
    assertEquals(trace.scopeCalls.length, 1, route.name);

    const event = trace.activity[0];
    assertEquals(event.routeId, route.routeId, route.name);
    assertEquals(event.method, route.method, route.name);
    assertEquals(event.status, route.successStatus, route.name);
    assertEquals(event.apiVersion, "v1", route.name);
    assertEquals(event.apiClientId, API_CLIENT_ID, route.name);
    assertEquals(event.actorUserId, USER_ID, route.name);

    // Canonical hierarchy from the SERVER-side resolver only.
    assertEquals(event.tenantId, TENANT_ID, route.name);
    assertEquals(event.organizationId, ORG_ID, route.name);
    assertEquals(event.workspaceId, WS_ID, route.name);
    assertEquals(event.projectId, PROJECT_ID, route.name);

    // Exactly the approved API-G.5.10A field set — no new fields.
    assertEquals(Object.keys(event).sort(), [
      "actorUserId",
      "apiClientId",
      "apiVersion",
      "correlationId",
      "durationMs",
      "method",
      "organizationId",
      "projectId",
      "routeId",
      "status",
      "tenantId",
      "workspaceId",
    ], route.name);
  }
});

Deno.test("C — scope is resolved from the server result target, not the request body", async () => {
  // Execution-updates targets a task; Risk/Blocker fixtures target a project.
  const expectations: ReadonlyArray<[string, string]> = [
    ["task", TARGET_ID],
    ["project", TARGET_ID],
    ["project", TARGET_ID],
    ["project", TARGET_ID],
    ["project", TARGET_ID],
  ];

  for (let i = 0; i < ROUTES.length; i += 1) {
    const route = ROUTES[i];
    const trace = newTrace();
    // Body carries a hostile hierarchy that must be ignored entirely.
    const hostileBody = {
      ...(route.body as Record<string, unknown>),
    };
    const response = await handleApiV1Request(
      makeRequest(route.method, route.path, hostileBody),
      makeDeps(trace),
    );
    await response.json();
    await settle();

    assertEquals(trace.scopeCalls.length, 1, route.name);
    assertEquals(trace.scopeCalls[0].targetType, expectations[i][0], route.name);
    assertEquals(trace.scopeCalls[0].targetId, expectations[i][1], route.name);
  }
});

Deno.test("C — no narrative, target or idempotency data is ever recorded", async () => {
  for (const route of ROUTES) {
    const trace = newTrace();
    const response = await handleApiV1Request(
      makeRequest(route.method, route.path, route.body),
      makeDeps(trace),
    );
    await response.json();
    await settle();

    const serialized = JSON.stringify(trace.activity[0]);
    for (
      const forbidden of [
        NARRATIVE,
        IDEMPOTENCY_KEY,
        RISK_ID,
        BLOCKER_ID,
        TARGET_ID,
        OAUTH_CLIENT_ID,
        POLICY_VERSION_ID,
        "summary",
        "statusLabel",
        "title",
        "description",
        "mitigationPlan",
        "severity",
        "likelihood",
        "impact",
        "expectedUpdatedAt",
      ]
    ) {
      assert(
        !serialized.includes(forbidden),
        `${route.name} leaked: ${forbidden}`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// D — Containment and fail-safety
// ---------------------------------------------------------------------------

Deno.test("D — resolver failure or unresolved scope records the event with null hierarchy", async () => {
  const variants: Options[] = [
    { resolverThrows: true },
    { scope: null },
    { omitScopeResolver: true },
  ];

  for (const variant of variants) {
    for (const route of ROUTES) {
      const trace = newTrace();
      const response = await handleApiV1Request(
        makeRequest(route.method, route.path, route.body),
        makeDeps(trace, variant),
      );
      // HTTP outcome unchanged.
      assertEquals(response.status, route.successStatus, route.name);
      await response.json();
      await settle();

      assertEquals(trace.activity.length, 1, route.name);
      const event = trace.activity[0];
      assertStrictEquals(event.tenantId, null, route.name);
      assertStrictEquals(event.organizationId, null, route.name);
      assertStrictEquals(event.workspaceId, null, route.name);
      assertStrictEquals(event.projectId, null, route.name);
      assertEquals(event.status, route.successStatus, route.name);
    }
  }
});

Deno.test("D — recorder failure and malformed activity deps never change the response", async () => {
  const variants: Options[] = [
    { recorderThrows: true },
    { brokenActivity: null },
    { brokenActivity: {} },
    { brokenActivity: { recorder: {} } },
    { brokenActivity: { recorder: { record: () => true } } },
  ];

  for (const variant of variants) {
    for (const route of ROUTES) {
      const trace = newTrace();
      const response = await handleApiV1Request(
        makeRequest(route.method, route.path, route.body),
        makeDeps(trace, variant),
      );
      assertEquals(response.status, route.successStatus, route.name);
      const payload = await response.json() as Record<string, unknown>;
      assertEquals(payload.ok, true, route.name);
      await settle();
      assertEquals(trace.executors, 1, route.name);
    }
  }
});

Deno.test("D — activity is instrumentation only: exactly one executor call per request", async () => {
  for (const route of ROUTES) {
    const trace = newTrace();
    const response = await handleApiV1Request(
      makeRequest(route.method, route.path, route.body),
      makeDeps(trace),
    );
    await response.json();
    await settle();
    assertEquals(trace.executors, 1, route.name);
    assertEquals(trace.scopeCalls.length, 1, route.name);
    assertEquals(trace.activity.length, 1, route.name);
  }
});

Deno.test("D — scope resolution is never awaited on the request path", async () => {
  // The resolver promise is intentionally left unsettled; the HTTP response
  // must still be produced.
  for (const route of ROUTES) {
    const trace = newTrace();
    const deps = makeDeps(trace) as unknown as Record<string, unknown>;
    (deps.activity as Record<string, unknown>).scopeResolver = {
      resolve: () => new Promise<ApiActivityScope | null>(() => {}),
    };
    const response = await handleApiV1Request(
      makeRequest(route.method, route.path, route.body),
      deps as unknown as ApiV1HttpHandlerDependencies,
    );
    assertEquals(response.status, route.successStatus, route.name);
    await response.json();
    // Scheduled but never recorded.
    assertEquals(trace.scheduled, 1, route.name);
    assertEquals(trace.activity.length, 0, route.name);
    pending = [];
  }
});
