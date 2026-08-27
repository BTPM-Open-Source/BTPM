// API-K.8-C1 — Live-handler OPTIONS/CORS preflight regression tests for the
// Blocker mutation surface. No executor, environment, network or database is
// touched; OPTIONS must never invoke a mutation dependency.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  handleApiV1Request,
  type ApiV1HttpHandlerDependencies,
} from "../handler.ts";
import type { ApiRuntimeControls } from "../router.ts";

const ALLOWED_ORIGIN = "https://app.example.com";
const REQUEST_ID = "req-fixed-uuid-k8c1";
const UUID = "8f14e45f-ceea-467a-a4a7-2b4b0c7f4d21";
const NIL = "00000000-0000-0000-0000-000000000000";

const CONTROLS: ApiRuntimeControls = Object.freeze({
  apiEnabled: true,
  readsEnabled: true,
  mutationsEnabled: true,
});

let executorCalls = 0;

function throwingRoute(): unknown {
  const fail = () => {
    executorCalls += 1;
    throw new Error("executor must never run during OPTIONS");
  };
  return {
    authenticate: fail,
    authorizeRoute: fail,
    resolveRateLimitProfile: fail,
    rateLimit: { store: { consume: fail }, now: () => 0 },
    createRisk: fail,
    updateRisk: fail,
    createBlocker: fail,
    updateBlocker: fail,
    appendExecutionUpdate: fail,
    readMe: fail,
    readOrganizations: fail,
    readWorkspaces: fail,
    readProjects: fail,
    readProjectDetail: fail,
  };
}

function makeDeps(): ApiV1HttpHandlerDependencies {
  return {
    controls: CONTROLS,
    allowedOrigins: new Set<string>([ALLOWED_ORIGIN]),
    timeoutMs: 5_000,
    requestId: { randomUUID: () => REQUEST_ID },
    protectedRoute: throwingRoute(),
    riskMutationRoute: throwingRoute(),
    blockerMutationRoute: throwingRoute(),
    appendExecutionUpdateRoute: throwingRoute(),
  } as unknown as ApiV1HttpHandlerDependencies;
}

function preflight(path: string, requestedMethod: string): Request {
  return new Request(`https://api.example.test${path}`, {
    method: "OPTIONS",
    headers: new Headers({
      Origin: ALLOWED_ORIGIN,
      "Access-Control-Request-Method": requestedMethod,
      "Access-Control-Request-Headers": "authorization, content-type",
    }),
  });
}

async function codeOf(response: Response): Promise<string> {
  const payload = await response.json() as { error?: { code?: string } };
  return payload?.error?.code ?? "";
}

// ---------------------------------------------------------------------------
// Accepted preflights
// ---------------------------------------------------------------------------

const ACCEPTED: readonly (readonly [string, string])[] = [
  ["/v1/blockers", "POST"],
  [`/v1/blockers/${UUID}`, "PATCH"],
  ["/v1/risks", "POST"],
  [`/v1/risks/${UUID}`, "PATCH"],
  ["/v1/execution-updates", "POST"],
];

for (const [path, method] of ACCEPTED) {
  Deno.test(`API-K.8-C1: OPTIONS ${path} (${method}) returns 204`, async () => {
    executorCalls = 0;
    const response = await handleApiV1Request(
      preflight(path, method),
      makeDeps(),
    );
    assertEquals(response.status, 204);
    assertEquals(executorCalls, 0);
    assertEquals(
      response.headers.get("Access-Control-Allow-Origin"),
      ALLOWED_ORIGIN,
    );
    assertEquals(
      response.headers.get("Access-Control-Allow-Methods"),
      "GET, POST, PATCH, PUT, OPTIONS",
    );
    assert(response.headers.get("Access-Control-Allow-Credentials") === null);
  });
}

// ---------------------------------------------------------------------------
// Fail-closed preflights
// ---------------------------------------------------------------------------

const REJECTED: readonly (readonly [string, string])[] = [
  // API-N.RG1C — the historical `PATCH /v1/projects/{uuid}` future-route
  // nonexistence entry was removed; K8 owns only Risk/Blocker preflight cases.
  ["/v1/blockers", "PATCH"],

  ["/v1/risks", "PATCH"],
  ["/v1/blockers/not-a-uuid", "PATCH"],
  ["/v1/risks/not-a-uuid", "PATCH"],
  [`/v1/blockers/${NIL}`, "PATCH"],
  [`/v1/risks/${NIL}`, "PATCH"],
  [`/v1/blockers/${UUID}/`, "PATCH"],
  [`/v1/risks/${UUID}/`, "PATCH"],
  [`/v1/blockers/${UUID}/extra`, "PATCH"],
  [`/v1/BLOCKERS/${UUID}`, "PATCH"],
  [`/v1/blockers/${UUID}?x=1`, "PATCH"],
  ["/v1/blockers?x=1", "POST"],
  // API-N.5 — "/v1/projects" POST preflight is now accepted, so only the
  // query-bearing form remains rejected.
  ["/v1/projects?x=1", "POST"],
  ["/v1/unknown-mutation", "POST"],
];

for (const [path, method] of REJECTED) {
  Deno.test(`API-K.8-C1: OPTIONS ${path} (${method}) is route_not_found`, async () => {
    executorCalls = 0;
    const response = await handleApiV1Request(
      preflight(path, method),
      makeDeps(),
    );
    assertEquals(response.status, 404);
    assertEquals(await codeOf(response), "route_not_found");
    assertEquals(executorCalls, 0);
  });
}
