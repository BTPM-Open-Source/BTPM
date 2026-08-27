// API-K.7-C1 — Live-handler regression tests for fail-closed PATCH dispatch.
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
import type {
  ApiProtectedRouteDependencies,
  ApiRiskMutationRouteDependencies,
  ApiAppendExecutionUpdateRouteDependencies,
  ApiRuntimeControls,
} from "../router.ts";
import type { AuthenticatedApiContext } from "../../_shared/btpm-api/authenticateApiRequest.ts";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const API_CLIENT_ID = "22222222-2222-4222-8222-222222222222";
const POLICY_VERSION_ID = "33333333-3333-4333-8333-333333333333";
const OAUTH_CLIENT_ID = "astra-client";
const RISK_ID = "8f14e45f-ceea-467a-a4a7-2b4b0c7f4d21";
const TARGET_ID = "3b1e2c44-7a1f-4a02-9d5f-1c2b3a4d5e6f";
const NIL = "00000000-0000-0000-0000-000000000000";
const TS = "2026-08-08T14:56:32.123456+00:00";
const ALLOWED_ORIGIN = "https://app.example.com";
const REQUEST_ID = "req-fixed-uuid-c1";

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

const UPDATE_OK = Object.freeze({
  ok: true,
  outcome: "applied",
  riskId: RISK_ID,
  targetType: "project",
  targetId: TARGET_ID,
  likelihood: "medium",
  impact: "high",
  status: "closed",
  updatedAt: TS,
});

const CREATE_OK = Object.freeze({
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

interface Trace {
  authenticate: number;
  createRisk: number;
  updateRisk: number;
  appendExecutionUpdate: number;
  bodyReads: number;
}

function newTrace(): Trace {
  return {
    authenticate: 0,
    createRisk: 0,
    updateRisk: 0,
    appendExecutionUpdate: 0,
    bodyReads: 0,
  };
}

function makeDeps(trace: Trace): ApiV1HttpHandlerDependencies {
  const riskMutationRoute: ApiRiskMutationRouteDependencies = {
    authenticate: () => {
      trace.authenticate += 1;
      return Promise.resolve(AUTH_CONTEXT);
    },
    authorizeRoute: () => Promise.resolve(),
    resolveRateLimitProfile: () =>
      Promise.resolve({ limit: 100, windowSeconds: 60 }),
    rateLimit: {
      store: {
        consume: () =>
          Promise.resolve({
            allowed: true,
            remaining: 99,
            resetAtEpochMs: 1_700_000_000_000,
          }),
      },
      now: () => 1_600_000_000_000,
    },
    createRisk: () => {
      trace.createRisk += 1;
      return Promise.resolve(CREATE_OK);
    },
    updateRisk: () => {
      trace.updateRisk += 1;
      return Promise.resolve(UPDATE_OK);
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
      rateLimit: riskMutationRoute.rateLimit,
      appendExecutionUpdate: () => {
        trace.appendExecutionUpdate += 1;
        return Promise.resolve({
          ok: true,
          outcome: "applied",
          executionUpdateId: "55555555-5555-4555-8555-555555555555",
          targetType: "task",
          targetId: TARGET_ID,
          updateDate: "2026-08-07",
          hasStatusLabel: false,
        });
      },
    } as unknown as ApiAppendExecutionUpdateRouteDependencies;

  const protectedRoute = {
    authenticate: () => {
      trace.authenticate += 1;
      return Promise.resolve(AUTH_CONTEXT);
    },
    authorizeRoute: () => Promise.resolve(),
    resolveRateLimitProfile: () =>
      Promise.resolve({ limit: 100, windowSeconds: 60 }),
    rateLimit: riskMutationRoute.rateLimit,
    readMe: () => Promise.resolve({ userId: USER_ID }),
    readOrganizations: () => Promise.resolve({ organizations: [] }),
    readWorkspaces: () => Promise.resolve({ workspaces: [] }),
    readProjects: () => Promise.resolve({ projects: [] }),
    readProjectDetail: () => Promise.resolve({ project: null }),
    readProjectPlanning: () => Promise.resolve({ project: null }),
  } as unknown as ApiProtectedRouteDependencies;

  return {
    controls: CONTROLS,
    allowedOrigins: new Set<string>([ALLOWED_ORIGIN]),
    timeoutMs: 5_000,
    requestId: { randomUUID: () => REQUEST_ID },
    protectedRoute,
    riskMutationRoute,
    appendExecutionUpdateRoute,
  } as unknown as ApiV1HttpHandlerDependencies;
}

function updateBody(): string {
  return JSON.stringify({
    expectedUpdatedAt: TS,
    title: "T",
    description: null,
    mitigationPlan: null,
    likelihood: "medium",
    impact: "high",
    status: "under_mitigation",
  });
}

function createBody(): string {
  return JSON.stringify({
    targetType: "project",
    targetId: TARGET_ID,
    title: "T",
    description: null,
    mitigationPlan: null,
    likelihood: "medium",
    impact: "high",
    status: "open",
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
    "Idempotency-Key": "idem-key-c1",
  });
  const request = new Request(`https://api.example.test${path}`, {
    method,
    headers,
    body,
  });
  // Detect any body read attempt.
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
// 1–4 — unrecognized PATCH targets are route_not_found before body/auth
// ---------------------------------------------------------------------------

const NOT_FOUND_PATCH_PATHS: readonly string[] = [
  "/v1/projects",
  "/v1/blockers",
  "/v1/risks",
  "/v1/risks/not-a-uuid",
  `/v1/risks/${NIL}`,
  `/v1/risks/${RISK_ID}/`,
];

for (const path of NOT_FOUND_PATCH_PATHS) {
  Deno.test(`API-K.7-C1: PATCH ${path} is route_not_found before body/auth`, async () => {
    const trace = newTrace();
    const response = await handleApiV1Request(
      makeRequest("PATCH", path, updateBody(), trace),
      makeDeps(trace),
    );
    assertEquals(response.status, 404);
    assertEquals(await codeOf(response), "route_not_found");
    assertEquals(trace.bodyReads, 0);
    assertEquals(trace.authenticate, 0);
    assertEquals(trace.updateRisk, 0);
    assertEquals(trace.createRisk, 0);
    assertEquals(trace.appendExecutionUpdate, 0);
  });
}

// ---------------------------------------------------------------------------
// 5 — valid Risk PATCH still reaches the accepted pipeline
// ---------------------------------------------------------------------------

Deno.test("API-K.7-C1: PATCH /v1/risks/{uuid} still reaches the Risk update pipeline", async () => {
  const trace = newTrace();
  const response = await handleApiV1Request(
    makeRequest("PATCH", `/v1/risks/${RISK_ID}`, updateBody(), trace),
    makeDeps(trace),
  );
  assertEquals(response.status, 200);
  assertEquals(trace.updateRisk, 1);
  assertEquals(trace.createRisk, 0);
  const payload = await response.json() as Record<string, unknown>;
  assertEquals(payload.riskId, RISK_ID);
});

// ---------------------------------------------------------------------------
// 6 — recognized Risk PATCH pathname with query/fragment stays invalid_request
// ---------------------------------------------------------------------------

Deno.test("API-K.7-C1: PATCH /v1/risks/{uuid}?x=1 remains invalid_request", async () => {
  const trace = newTrace();
  const response = await handleApiV1Request(
    makeRequest("PATCH", `/v1/risks/${RISK_ID}?x=1`, updateBody(), trace),
    makeDeps(trace),
  );
  assertEquals(response.status, 400);
  assertEquals(await codeOf(response), "invalid_request");
  assertEquals(trace.updateRisk, 0);
  assertEquals(trace.bodyReads, 0);
});

// ---------------------------------------------------------------------------
// 7 / 8 — POST surfaces are unchanged
// ---------------------------------------------------------------------------

Deno.test("API-K.7-C1: POST /v1/risks remains unchanged", async () => {
  const trace = newTrace();
  const response = await handleApiV1Request(
    makeRequest("POST", "/v1/risks", createBody(), trace),
    makeDeps(trace),
  );
  assert(response.status === 200 || response.status === 201);
  assertEquals(trace.createRisk, 1);
  assertEquals(trace.updateRisk, 0);
});

Deno.test("API-K.7-C1: POST /v1/execution-updates remains unchanged", async () => {
  const trace = newTrace();
  const response = await handleApiV1Request(
    makeRequest(
      "POST",
      "/v1/execution-updates",
      JSON.stringify({
        targetType: "task",
        targetId: TARGET_ID,
        summary: "S",
        updateDate: "2026-08-07",
        statusLabel: null,
      }),
      trace,
    ),
    makeDeps(trace),
  );
  assert(response.status === 200 || response.status === 201);
  assertEquals(trace.appendExecutionUpdate, 1);
  assertEquals(trace.createRisk, 0);
  assertEquals(trace.updateRisk, 0);
});
