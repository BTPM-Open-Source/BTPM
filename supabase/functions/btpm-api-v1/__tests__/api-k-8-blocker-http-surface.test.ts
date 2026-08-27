// API-K.8 — Focused regression tests for the external Blocker mutation HTTP
// surface (POST /v1/blockers and PATCH /v1/blockers/{blockerId}).
//
// Only injected dependencies are used: no environment, network, database or
// live adapter is touched.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  handleApiV1Request,
  type ApiV1HttpHandlerDependencies,
} from "../handler.ts";
import {
  API_V1_ROUTE_ALLOWLIST,
  matchApiRoute,
  type ApiBlockerMutationRouteDependencies,
  type ApiRiskMutationRouteDependencies,
  type ApiAppendExecutionUpdateRouteDependencies,
  type ApiProtectedRouteDependencies,
  type ApiRuntimeControls,
} from "../router.ts";
import {
  BLOCKER_CREATE_ROUTE,
  BLOCKER_UPDATE_ROUTE,
  buildApiV1UpdateBlockerIdempotencyPayload,
  parseApiV1BlockerUpdatePath,
  parseApiV1CreateBlockerBody,
  parseApiV1UpdateBlockerBody,
} from "../routes/blockers.ts";
import { ApiHttpError } from "../../_shared/btpm-api/http.ts";
import type { AuthenticatedApiContext } from "../../_shared/btpm-api/authenticateApiRequest.ts";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const API_CLIENT_ID = "22222222-2222-4222-8222-222222222222";
const POLICY_VERSION_ID = "33333333-3333-4333-8333-333333333333";
const OAUTH_CLIENT_ID = "astra-client";
const BLOCKER_ID = "8f14e45f-ceea-467a-a4a7-2b4b0c7f4d21";
const TARGET_ID = "3b1e2c44-7a1f-4a02-9d5f-1c2b3a4d5e6f";
const NIL = "00000000-0000-0000-0000-000000000000";
const TS = "2026-08-08T14:56:32.123456+00:00";
const ALLOWED_ORIGIN = "https://app.example.com";
const REQUEST_ID = "req-fixed-uuid-k8";

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

const CREATE_OK = Object.freeze({
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

const UPDATE_OK = Object.freeze({
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

interface Trace {
  authenticate: number;
  createBlocker: number;
  updateBlocker: number;
  createRisk: number;
  updateRisk: number;
  bodyReads: number;
  lastBlockerId: string | null;
  lastPayloadHash: string | null;
}

function newTrace(): Trace {
  return {
    authenticate: 0,
    createBlocker: 0,
    updateBlocker: 0,
    createRisk: 0,
    updateRisk: 0,
    bodyReads: 0,
    lastBlockerId: null,
    lastPayloadHash: null,
  };
}

function makeDeps(
  trace: Trace,
  overrides: {
    createResult?: unknown;
    updateResult?: unknown;
    omitBlockerDeps?: boolean;
    controls?: ApiRuntimeControls;
  } = {},
): ApiV1HttpHandlerDependencies {
  const rateLimit = {
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

  const blockerMutationRoute: ApiBlockerMutationRouteDependencies = {
    authenticate: () => {
      trace.authenticate += 1;
      return Promise.resolve(AUTH_CONTEXT);
    },
    authorizeRoute: () => Promise.resolve(),
    resolveRateLimitProfile: () =>
      Promise.resolve({ limit: 100, windowSeconds: 60 }),
    rateLimit,
    createBlocker: (
      _request: Request,
      _context: AuthenticatedApiContext,
      _body: unknown,
      executionContext: { payloadHash: string },
    ) => {
      trace.createBlocker += 1;
      trace.lastPayloadHash = executionContext.payloadHash;
      return Promise.resolve(overrides.createResult ?? CREATE_OK);
    },
    updateBlocker: (
      _request: Request,
      _context: AuthenticatedApiContext,
      blockerId: string,
      _body: unknown,
      executionContext: { payloadHash: string },
    ) => {
      trace.updateBlocker += 1;
      trace.lastBlockerId = blockerId;
      trace.lastPayloadHash = executionContext.payloadHash;
      return Promise.resolve(overrides.updateResult ?? UPDATE_OK);
    },
  } as unknown as ApiBlockerMutationRouteDependencies;

  const riskMutationRoute: ApiRiskMutationRouteDependencies = {
    authenticate: () => {
      trace.authenticate += 1;
      return Promise.resolve(AUTH_CONTEXT);
    },
    authorizeRoute: () => Promise.resolve(),
    resolveRateLimitProfile: () =>
      Promise.resolve({ limit: 100, windowSeconds: 60 }),
    rateLimit,
    createRisk: () => {
      trace.createRisk += 1;
      return Promise.resolve({ ok: true, outcome: "applied" });
    },
    updateRisk: () => {
      trace.updateRisk += 1;
      return Promise.resolve({ ok: true, outcome: "applied" });
    },
  } as unknown as ApiRiskMutationRouteDependencies;

  const appendExecutionUpdateRoute:
    ApiAppendExecutionUpdateRouteDependencies = {
      authenticate: () => {
        trace.authenticate += 1;
        return Promise.resolve(AUTH_CONTEXT);
      },
      authorizeRoute: () => Promise.resolve(),
      resolveRateLimitProfile: () =>
        Promise.resolve({ limit: 100, windowSeconds: 60 }),
      rateLimit,
      appendExecutionUpdate: () =>
        Promise.resolve({ ok: true, outcome: "applied" }),
    } as unknown as ApiAppendExecutionUpdateRouteDependencies;

  const protectedRoute = {
    authenticate: () => {
      trace.authenticate += 1;
      return Promise.resolve(AUTH_CONTEXT);
    },
    authorizeRoute: () => Promise.resolve(),
    resolveRateLimitProfile: () =>
      Promise.resolve({ limit: 100, windowSeconds: 60 }),
    rateLimit,
    readMe: () => Promise.resolve({ userId: USER_ID }),
    readOrganizations: () => Promise.resolve({ organizations: [] }),
    readWorkspaces: () => Promise.resolve({ workspaces: [] }),
    readProjects: () => Promise.resolve({ projects: [] }),
    readProjectDetail: () => Promise.resolve({ project: null }),
    readProjectPlanning: () => Promise.resolve({ project: null }),
  } as unknown as ApiProtectedRouteDependencies;

  const deps: Record<string, unknown> = {
    controls: overrides.controls ?? CONTROLS,
    allowedOrigins: new Set<string>([ALLOWED_ORIGIN]),
    timeoutMs: 5_000,
    requestId: { randomUUID: () => REQUEST_ID },
    protectedRoute,
    riskMutationRoute,
    appendExecutionUpdateRoute,
  };
  if (overrides.omitBlockerDeps !== true) {
    deps.blockerMutationRoute = blockerMutationRoute;
  }
  return deps as unknown as ApiV1HttpHandlerDependencies;
}

function createBody(): string {
  return JSON.stringify({
    targetType: "project",
    targetId: TARGET_ID,
    title: "Blocked by vendor",
    description: null,
    severity: "high",
    status: "open",
  });
}

function updateBody(): string {
  return JSON.stringify({
    expectedUpdatedAt: TS,
    title: "Blocked by vendor",
    description: null,
    severity: "high",
    status: "resolved",
  });
}

function makeRequest(
  method: string,
  path: string,
  body: string | null,
  trace: Trace,
): Request {
  const headers = new Headers({
    Origin: ALLOWED_ORIGIN,
    "Content-Type": "application/json",
    "Idempotency-Key": "idem-key-k8",
  });
  const request = new Request(`https://api.example.test${path}`, {
    method,
    headers,
    body,
  });
  const original = request.text.bind(request);
  Object.defineProperty(request, "text", {
    value: () => {
      trace.bodyReads += 1;
      return original();
    },
  });
  return request;
}

async function codeOf(response: Response): Promise<string> {
  const payload = await response.json() as { error?: { code?: string } };
  return payload?.error?.code ?? "";
}

// ---------------------------------------------------------------------------
// Route contracts
// ---------------------------------------------------------------------------

Deno.test("API-K.8: Blocker route contracts are exact and frozen", () => {
  assertEquals(BLOCKER_CREATE_ROUTE.id, "blockers.create");
  assertEquals(BLOCKER_CREATE_ROUTE.method, "POST");
  assertEquals(BLOCKER_CREATE_ROUTE.path, "/v1/blockers");
  assertEquals(BLOCKER_CREATE_ROUTE.operation, "mutation");
  assertEquals(BLOCKER_UPDATE_ROUTE.id, "blockers.update");
  assertEquals(BLOCKER_UPDATE_ROUTE.method, "PATCH");
  assertEquals(BLOCKER_UPDATE_ROUTE.path, "/v1/blockers/:blockerid");
  assertEquals(BLOCKER_UPDATE_ROUTE.operation, "mutation");
  assert(Object.isFrozen(BLOCKER_CREATE_ROUTE));
  assert(Object.isFrozen(BLOCKER_UPDATE_ROUTE));
});

Deno.test("API-K.8: allowlist registers each Blocker route exactly once", () => {
  const ids = API_V1_ROUTE_ALLOWLIST.map((r) => r.id);
  assertEquals(ids.filter((id) => id === "blockers.create").length, 1);
  assertEquals(ids.filter((id) => id === "blockers.update").length, 1);
});

Deno.test("API-K.8: matchApiRoute resolves only the exact Blocker targets", () => {
  assertEquals(matchApiRoute("POST", "/v1/blockers"), BLOCKER_CREATE_ROUTE);
  assertEquals(
    matchApiRoute("PATCH", `/v1/blockers/${BLOCKER_ID}`),
    BLOCKER_UPDATE_ROUTE,
  );
  assertEquals(matchApiRoute("PATCH", "/v1/blockers"), null);
  assertEquals(matchApiRoute("PATCH", `/v1/blockers/${NIL}`), null);
  assertEquals(matchApiRoute("PATCH", `/v1/blockers/${BLOCKER_ID}/`), null);
  assertEquals(matchApiRoute("POST", `/v1/blockers/${BLOCKER_ID}`), null);
  assertEquals(matchApiRoute("POST", "/v1/blockers/"), null);
  assertEquals(matchApiRoute("DELETE", "/v1/blockers"), null);
  assertEquals(matchApiRoute("PUT", `/v1/blockers/${BLOCKER_ID}`), null);
});

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

Deno.test("API-K.8: path parser accepts only a canonical Blocker UUID path", () => {
  assertEquals(
    parseApiV1BlockerUpdatePath(`/v1/blockers/${BLOCKER_ID}`).blockerId,
    BLOCKER_ID,
  );
  for (
    const bad of [
      "/v1/blockers",
      "/v1/blockers/",
      `/v1/blockers/${NIL}`,
      `/v1/blockers/${BLOCKER_ID}/extra`,
      `/v1/risks/${BLOCKER_ID}`,
      `/V1/blockers/${BLOCKER_ID}`,
    ]
  ) {
    let code = "";
    try {
      parseApiV1BlockerUpdatePath(bad);
    } catch (cause) {
      code = cause instanceof ApiHttpError ? cause.code : "other";
    }
    assertEquals(code, "invalid_request", bad);
  }
});

Deno.test("API-K.8: body parsers are closed-schema and reject unknown keys", () => {
  const created = parseApiV1CreateBlockerBody(JSON.parse(createBody()));
  assertEquals(created.targetType, "project");
  assertEquals(created.severity, "high");

  const updated = parseApiV1UpdateBlockerBody(JSON.parse(updateBody()));
  assertEquals(updated.expectedUpdatedAt, TS);
  assertEquals(updated.status, "resolved");

  for (
    const bad of [
      { ...JSON.parse(createBody()), extra: 1 },
      { ...JSON.parse(createBody()), targetType: "workspace" },
      { ...JSON.parse(createBody()), severity: "urgent" },
      null,
      [],
      "x",
    ]
  ) {
    let code = "";
    try {
      parseApiV1CreateBlockerBody(bad);
    } catch (cause) {
      code = cause instanceof ApiHttpError ? cause.code : "other";
    }
    assertEquals(code, "invalid_request");
  }
});

Deno.test("API-K.8: update idempotency payload folds in the path Blocker ID", () => {
  const a = buildApiV1UpdateBlockerIdempotencyPayload(
    BLOCKER_ID,
    parseApiV1UpdateBlockerBody(JSON.parse(updateBody())),
  );
  const b = buildApiV1UpdateBlockerIdempotencyPayload(
    TARGET_ID,
    parseApiV1UpdateBlockerBody(JSON.parse(updateBody())),
  );
  assert(JSON.stringify(a) !== JSON.stringify(b));
});

// ---------------------------------------------------------------------------
// Live handler dispatch
// ---------------------------------------------------------------------------

Deno.test("API-K.8: POST /v1/blockers reaches the create pipeline with 201", async () => {
  const trace = newTrace();
  const response = await handleApiV1Request(
    makeRequest("POST", "/v1/blockers", createBody(), trace),
    makeDeps(trace),
  );
  assertEquals(response.status, 201);
  assertEquals(trace.createBlocker, 1);
  assertEquals(trace.updateBlocker, 0);
  assertEquals(trace.createRisk, 0);
  assertEquals(trace.updateRisk, 0);
});

Deno.test("API-K.8: PATCH /v1/blockers/{uuid} reaches the update pipeline with 200", async () => {
  const trace = newTrace();
  const response = await handleApiV1Request(
    makeRequest("PATCH", `/v1/blockers/${BLOCKER_ID}`, updateBody(), trace),
    makeDeps(trace),
  );
  assertEquals(response.status, 200);
  assertEquals(trace.updateBlocker, 1);
  assertEquals(trace.lastBlockerId, BLOCKER_ID);
  assertEquals(trace.createBlocker, 0);
  assertEquals(trace.updateRisk, 0);
});

Deno.test("API-K.8: Risk PATCH is never routed into the Blocker pipeline", async () => {
  const trace = newTrace();
  const riskBody = JSON.stringify({
    expectedUpdatedAt: TS,
    title: "T",
    description: null,
    mitigationPlan: null,
    likelihood: "medium",
    impact: "high",
    status: "under_mitigation",
  });
  const response = await handleApiV1Request(
    makeRequest("PATCH", `/v1/risks/${BLOCKER_ID}`, riskBody, trace),
    makeDeps(trace),
  );
  assert(response.status !== 404);
  assertEquals(trace.updateBlocker, 0);
  assertEquals(trace.createBlocker, 0);
  assertEquals(trace.updateRisk, 1);
});

Deno.test("API-K.8: unrecognized Blocker PATCH targets are 404 before body/auth", async () => {
  for (
    const path of [
      "/v1/blockers",
      "/v1/blockers/not-a-uuid",
      `/v1/blockers/${NIL}`,
      `/v1/blockers/${BLOCKER_ID}/`,
    ]
  ) {
    const trace = newTrace();
    const response = await handleApiV1Request(
      makeRequest("PATCH", path, updateBody(), trace),
      makeDeps(trace),
    );
    assertEquals(response.status, 404, path);
    assertEquals(await codeOf(response), "route_not_found");
    assertEquals(trace.bodyReads, 0);
    assertEquals(trace.authenticate, 0);
    assertEquals(trace.updateBlocker, 0);
  }
});

Deno.test("API-K.8: POST /v1/blockers/{uuid} is route_not_found", async () => {
  const trace = newTrace();
  const response = await handleApiV1Request(
    makeRequest("POST", `/v1/blockers/${BLOCKER_ID}`, createBody(), trace),
    makeDeps(trace),
  );
  assertEquals(response.status, 404);
  assertEquals(await codeOf(response), "route_not_found");
  assertEquals(trace.createBlocker, 0);
});

Deno.test("API-K.8: Blocker mutations fail closed when mutations are disabled", async () => {
  const trace = newTrace();
  const controls: ApiRuntimeControls = Object.freeze({
    apiEnabled: true,
    readsEnabled: true,
    mutationsEnabled: false,
  });
  const response = await handleApiV1Request(
    makeRequest("POST", "/v1/blockers", createBody(), trace),
    makeDeps(trace, { controls }),
  );
  assert(response.status === 404 || response.status === 503);
  assertEquals(trace.createBlocker, 0);
});

Deno.test("API-K.8: missing Blocker dependencies fail closed as internal_error", async () => {
  const trace = newTrace();
  const response = await handleApiV1Request(
    makeRequest("POST", "/v1/blockers", createBody(), trace),
    makeDeps(trace, { omitBlockerDeps: true }),
  );
  assertEquals(response.status, 500);
  assertEquals(await codeOf(response), "internal_error");
  assertEquals(trace.createBlocker, 0);
});

// ---------------------------------------------------------------------------
// Bounded outcome mapping
// ---------------------------------------------------------------------------

Deno.test("API-K.8: replayed create maps to 200 and update outcomes stay 200", async () => {
  const replay = newTrace();
  const replayResponse = await handleApiV1Request(
    makeRequest("POST", "/v1/blockers", createBody(), replay),
    makeDeps(replay, {
      createResult: { ...CREATE_OK, outcome: "replayed" },
    }),
  );
  assertEquals(replayResponse.status, 200);

  for (const outcome of ["applied", "no_change", "replayed"]) {
    const trace = newTrace();
    const response = await handleApiV1Request(
      makeRequest("PATCH", `/v1/blockers/${BLOCKER_ID}`, updateBody(), trace),
      makeDeps(trace, { updateResult: { ...UPDATE_OK, outcome } }),
    );
    assertEquals(response.status, 200, outcome);
  }
});

Deno.test("API-K.8: negative Blocker outcomes map to bounded public errors", async () => {
  const cases: readonly (readonly [string, number, string])[] = [
    ["invalid", 400, "invalid_request"],
    ["not_authorized", 403, "not_authorized"],
    ["conflict", 409, "concurrency_conflict"],
    ["idempotency_conflict", 409, "idempotency_conflict"],
  ];
  for (const [outcome, status, code] of cases) {
    const trace = newTrace();
    const response = await handleApiV1Request(
      makeRequest("PATCH", `/v1/blockers/${BLOCKER_ID}`, updateBody(), trace),
      makeDeps(trace, { updateResult: { ok: false, outcome } }),
    );
    assertEquals(response.status, status, outcome);
    assertEquals(await codeOf(response), code, outcome);
  }
});

Deno.test("API-K.8: stale_blocker never leaves the boundary", async () => {
  const trace = newTrace();
  const response = await handleApiV1Request(
    makeRequest("PATCH", `/v1/blockers/${BLOCKER_ID}`, updateBody(), trace),
    makeDeps(trace, {
      updateResult: { ok: false, outcome: "conflict", reason: "stale_blocker" },
    }),
  );
  const text = await response.text();
  assertEquals(text.includes("stale_blocker"), false);
});
