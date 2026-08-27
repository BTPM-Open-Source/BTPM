// API-M.8A — Phase create/update HTTP surface regression tests.
//
// These tests are pure: no executor, environment, network or database is
// touched. They prove route registration, strict path matching, fail-closed
// dependency handling, OPTIONS/CORS behaviour and bounded outcome mapping for
// exactly two targets: POST /v1/phases and PATCH /v1/phases/<validated UUID>.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  API_V1_ROUTE_ALLOWLIST,
  matchApiRoute,
  type ApiRuntimeControls,
} from "../router.ts";
import {
  PHASE_CREATE_ROUTE,
  PHASE_UPDATE_ROUTE,
} from "../routes/phases.ts";
import {
  handleApiV1Request,
  type ApiV1HttpHandlerDependencies,
} from "../handler.ts";

const ALLOWED_ORIGIN = "https://app.example.com";
const REQUEST_ID = "req-fixed-uuid-m8a";
const UUID = "8f14e45f-ceea-467a-a4a7-2b4b0c7f4d21";
const NIL = "00000000-0000-0000-0000-000000000000";

const CONTROLS: ApiRuntimeControls = Object.freeze({
  apiEnabled: true,
  readsEnabled: true,
  mutationsEnabled: true,
});

// ---------------------------------------------------------------------------
// 1. Route registration and contract
// ---------------------------------------------------------------------------

Deno.test("API-M.8A: the two Phase metadata routes stay at their frozen allowlist positions", () => {
  // Later steps append further routes after them; this step-local guard asserts
  // only the frozen positions of the two Phase metadata routes, never the
  // global allowlist cardinality (owned by routes.test.ts).
  assertEquals(API_V1_ROUTE_ALLOWLIST[15], PHASE_CREATE_ROUTE);
  assertEquals(API_V1_ROUTE_ALLOWLIST[16], PHASE_UPDATE_ROUTE);
  assert(Object.isFrozen(PHASE_CREATE_ROUTE));
  assert(Object.isFrozen(PHASE_UPDATE_ROUTE));
  assertEquals(PHASE_CREATE_ROUTE.operation, "mutation");
  assertEquals(PHASE_UPDATE_ROUTE.operation, "mutation");
});

Deno.test("API-M.8A: matchApiRoute resolves exactly the two Phase targets", () => {
  assertEquals(matchApiRoute("POST", "/v1/phases"), PHASE_CREATE_ROUTE);
  assertEquals(matchApiRoute("PATCH", `/v1/phases/${UUID}`), PHASE_UPDATE_ROUTE);
});

Deno.test("API-M.8A: matchApiRoute rejects every near-miss Phase target", () => {
  const rejected: readonly (readonly [string, string])[] = [
    ["POST", "/v1/phases/"],
    ["POST", `/v1/phases/${UUID}`],
    ["PATCH", "/v1/phases"],
    ["PATCH", "/v1/phases/not-a-uuid"],
    ["PATCH", `/v1/phases/${NIL}`],
    ["PATCH", `/v1/phases/${UUID}/`],
    ["PATCH", `/v1/phases/${UUID}/extra`],
    ["PATCH", `/v1/PHASES/${UUID}`],
    ["PUT", "/v1/phases"],
    ["DELETE", `/v1/phases/${UUID}`],
  ];
  for (const [method, path] of rejected) {
    assertEquals(matchApiRoute(method, path), null, `${method} ${path}`);
  }
});

// ---------------------------------------------------------------------------
// 2. Live-handler behaviour with a throwing dependency surface
// ---------------------------------------------------------------------------

let executorCalls = 0;

function throwingRoute(): unknown {
  const fail = () => {
    executorCalls += 1;
    throw new Error("executor must never run");
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
    createPhase: fail,
    updatePhase: fail,
    appendExecutionUpdate: fail,
    readMe: fail,
    readOrganizations: fail,
    readWorkspaces: fail,
    readProjects: fail,
    readProjectDetail: fail,
    readProjectPlanning: fail,
  };
}

function makeDeps(
  overrides: Partial<ApiV1HttpHandlerDependencies> = {},
): ApiV1HttpHandlerDependencies {
  return {
    controls: CONTROLS,
    allowedOrigins: new Set<string>([ALLOWED_ORIGIN]),
    timeoutMs: 5_000,
    requestId: { randomUUID: () => REQUEST_ID },
    protectedRoute: throwingRoute(),
    riskMutationRoute: throwingRoute(),
    blockerMutationRoute: throwingRoute(),
    phaseMutationRoute: throwingRoute(),
    appendExecutionUpdateRoute: throwingRoute(),
    ...overrides,
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

const ACCEPTED_PREFLIGHTS: readonly (readonly [string, string])[] = [
  ["/v1/phases", "POST"],
  [`/v1/phases/${UUID}`, "PATCH"],
];

for (const [path, method] of ACCEPTED_PREFLIGHTS) {
  Deno.test(`API-M.8A: OPTIONS ${path} (${method}) returns 204 without executing`, async () => {
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
  });
}

const REJECTED_PREFLIGHTS: readonly (readonly [string, string])[] = [
  ["/v1/phases", "PATCH"],
  ["/v1/phases?x=1", "POST"],
  ["/v1/phases/not-a-uuid", "PATCH"],
  [`/v1/phases/${NIL}`, "PATCH"],
  [`/v1/phases/${UUID}/`, "PATCH"],
  [`/v1/phases/${UUID}/extra`, "PATCH"],
  [`/v1/phases/${UUID}?x=1`, "PATCH"],
];

for (const [path, method] of REJECTED_PREFLIGHTS) {
  Deno.test(`API-M.8A: OPTIONS ${path} (${method}) is route_not_found`, async () => {
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

function mutation(path: string, method: "POST" | "PATCH"): Request {
  return new Request(`https://api.example.test${path}`, {
    method,
    headers: new Headers({
      Origin: ALLOWED_ORIGIN,
      Authorization: "Bearer token",
      "Content-Type": "application/json",
      "Idempotency-Key": "11111111-2222-4333-8444-555555555555",
    }),
    body: JSON.stringify({}),
  });
}

Deno.test("API-M.8A: missing Phase dependencies fail closed with internal_error", async () => {
  for (
    const request of [
      mutation("/v1/phases", "POST"),
      mutation(`/v1/phases/${UUID}`, "PATCH"),
    ]
  ) {
    executorCalls = 0;
    const response = await handleApiV1Request(
      request,
      makeDeps({ phaseMutationRoute: undefined }),
    );
    assertEquals(response.status, 500);
    assertEquals(await codeOf(response), "internal_error");
    assertEquals(executorCalls, 0);
  }
});

Deno.test("API-M.8A: Phase routes are unreachable when mutations are disabled", async () => {
  const disabled: ApiRuntimeControls = Object.freeze({
    apiEnabled: true,
    readsEnabled: true,
    mutationsEnabled: false,
  });
  for (
    const request of [
      mutation("/v1/phases", "POST"),
      mutation(`/v1/phases/${UUID}`, "PATCH"),
    ]
  ) {
    executorCalls = 0;
    const response = await handleApiV1Request(
      request,
      makeDeps({ controls: disabled }),
    );
    assert(response.status === 404 || response.status === 503);
    assertEquals(executorCalls, 0);
  }
});

Deno.test("API-M.8A: a PATCH to an invalid Phase id never reaches an executor", async () => {
  executorCalls = 0;
  const response = await handleApiV1Request(
    mutation("/v1/phases/not-a-uuid", "PATCH"),
    makeDeps(),
  );
  assertEquals(response.status, 404);
  assertEquals(await codeOf(response), "route_not_found");
  assertEquals(executorCalls, 0);
});

// ===========================================================================
// API-M.8A-C1 — Correction regression coverage.
//
// Everything below is dependency-injected and pure: no environment, network,
// Supabase client or live adapter is touched.
// ===========================================================================

import { assertRejects, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ApiHttpError } from "../../_shared/btpm-api/http.ts";
import {
  API_V1_PHASE_STATUSES,
  API_V1_PHASE_TYPES,
  buildApiV1UpdatePhaseIdempotencyPayload,
  canonicalizePhaseText,
  parseApiV1CreatePhaseBody,
  parseApiV1UpdatePhaseBody,
} from "../routes/phases.ts";
import {
  createApiV1Phase,
  updateApiV1Phase,
} from "../../_shared/btpm-api/supabasePhase.ts";
import {
  createDelegatedApiV1CreatePhaseExecutor,
  createDelegatedApiV1UpdatePhaseExecutor,
} from "../../_shared/btpm-api/supabaseDelegatedPhase.ts";
import {
  executeApiCreatePhaseRoute,
  executeApiUpdatePhaseRoute,
  parseApiRuntimeControls,
} from "../router.ts";
import { buildCapabilitiesPayload } from "../routes/capabilities.ts";

const PROJECT_ID = "dddddddd-4444-4444-8444-444444444444";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const API_CLIENT_ID = "22222222-2222-4222-8222-222222222222";
const POLICY_VERSION_ID = "33333333-3333-4333-8333-333333333333";
const OAUTH_CLIENT_ID = "astra-client";
const TS = "2026-08-08T14:56:32.123456+00:00";

// ---------------------------------------------------------------------------
// A. Canonical body normalization (Correction A) + defaults
// ---------------------------------------------------------------------------

function createBase(overrides: Record<string, unknown> = {}) {
  return { projectId: PROJECT_ID, name: "Phase A", ...overrides };
}

function updateBase(overrides: Record<string, unknown> = {}) {
  return {
    expectedUpdatedAt: TS,
    name: "Phase A",
    description: null,
    status: "planned",
    phaseType: "work_item",
    ...overrides,
  };
}

function assertInvalid(run: () => unknown): void {
  const err = assertThrows(run, ApiHttpError);
  assertEquals(err.code, "invalid_request");
  assertEquals(err.status, 400);
}

Deno.test("API-M.8A-C1: canonicalizePhaseText matches PostgreSQL btrim(text) default", () => {
  assertEquals(canonicalizePhaseText("  Phase A  "), "Phase A");
  assertEquals(canonicalizePhaseText("Phase  A"), "Phase  A");
  assertEquals(canonicalizePhaseText("   "), "");
  assertEquals(canonicalizePhaseText(""), "");
  // Non-U+0020 whitespace is NOT trimmed, exactly like btrim(text).
  assertEquals(canonicalizePhaseText("\tPhase\n"), "\tPhase\n");
  assertEquals(canonicalizePhaseText("\u00a0Phase\u00a0"), "\u00a0Phase\u00a0");
  assertEquals(canonicalizePhaseText(" \tPhase\t "), "\tPhase\t");
});

Deno.test("API-M.8A-C1: create body resolves canonical defaults", () => {
  const parsed = parseApiV1CreatePhaseBody(createBase());
  assertEquals(parsed, {
    projectId: PROJECT_ID,
    name: "Phase A",
    description: null,
    status: "planned",
    phaseType: "work_item",
    startDate: null,
    targetEndDate: null,
    sortOrder: null,
  });
  assert(Object.isFrozen(parsed));
  assertEquals(API_V1_PHASE_STATUSES[0], "planned");
  assertEquals(API_V1_PHASE_TYPES[0], "work_item");
});

Deno.test("API-M.8A-C1: create canonicalizes name and description before returning", () => {
  const parsed = parseApiV1CreatePhaseBody(
    createBase({ name: " Phase A ", description: " detail " }),
  );
  assertEquals(parsed.name, "Phase A");
  assertEquals(parsed.description, "detail");

  // Ordinary-space-only description collapses to NULL, like the command.
  assertEquals(
    parseApiV1CreatePhaseBody(createBase({ description: "   " })).description,
    null,
  );
  assertEquals(
    parseApiV1CreatePhaseBody(createBase({ description: "" })).description,
    null,
  );
  // A name that is only ordinary spaces is rejected outright.
  assertInvalid(() => parseApiV1CreatePhaseBody(createBase({ name: "   " })));
  assertInvalid(() => parseApiV1CreatePhaseBody(createBase({ name: "" })));
  // Interior content is preserved exactly.
  assertEquals(
    parseApiV1CreatePhaseBody(createBase({ name: "  A  B  " })).name,
    "A  B",
  );
});

Deno.test("API-M.8A-C1: create rejects malformed dates, inverted ranges and unknown keys", () => {
  for (
    const bad of ["2026-13-01", "2026-02-30", "20260101", "2026-1-1", "", 5, {}]
  ) {
    assertInvalid(() => parseApiV1CreatePhaseBody(createBase({ startDate: bad })));
    assertInvalid(() =>
      parseApiV1CreatePhaseBody(createBase({ targetEndDate: bad }))
    );
  }
  // Correction B — inverted planning window rejected at the HTTP boundary.
  assertInvalid(() =>
    parseApiV1CreatePhaseBody(
      createBase({ startDate: "2026-05-02", targetEndDate: "2026-05-01" }),
    )
  );
  // Equal boundaries and a proper range remain valid.
  assertEquals(
    parseApiV1CreatePhaseBody(
      createBase({ startDate: "2026-05-01", targetEndDate: "2026-05-01" }),
    ).targetEndDate,
    "2026-05-01",
  );
  assertEquals(
    parseApiV1CreatePhaseBody(
      createBase({ startDate: "2026-05-01", targetEndDate: "2026-06-01" }),
    ).startDate,
    "2026-05-01",
  );
  // One-sided windows are not compared.
  assertEquals(
    parseApiV1CreatePhaseBody(createBase({ targetEndDate: "2026-05-01" }))
      .startDate,
    null,
  );
  for (
    const key of ["expectedUpdatedAt", "confirmParentExtension", "phaseId", "x"]
  ) {
    assertInvalid(() => parseApiV1CreatePhaseBody(createBase({ [key]: "x" })));
  }
});

Deno.test("API-M.8A-C1: update requires exactly the five metadata keys", () => {
  for (
    const key of [
      "expectedUpdatedAt",
      "name",
      "description",
      "status",
      "phaseType",
    ]
  ) {
    const body = updateBase() as Record<string, unknown>;
    delete body[key];
    assertInvalid(() => parseApiV1UpdatePhaseBody(body));
  }
  for (
    const key of [
      "startDate",
      "targetEndDate",
      "confirmParentExtension",
      "projectId",
      "sortOrder",
    ]
  ) {
    assertInvalid(() => parseApiV1UpdatePhaseBody(updateBase({ [key]: null })));
  }
});

Deno.test("API-M.8A-C1: update applies identical canonical normalization", () => {
  const parsed = parseApiV1UpdatePhaseBody(
    updateBase({ name: " Phase A ", description: " detail " }),
  );
  assertEquals(parsed.name, "Phase A");
  assertEquals(parsed.description, "detail");
  assertEquals(
    parseApiV1UpdatePhaseBody(updateBase({ description: "   " })).description,
    null,
  );
  assertInvalid(() => parseApiV1UpdatePhaseBody(updateBase({ name: "  " })));

  // The hashed idempotency payload carries the validated path phaseId and the
  // canonical (already normalized) narrative values.
  const payload = buildApiV1UpdatePhaseIdempotencyPayload(UUID, parsed);
  assertEquals(payload.phaseId, UUID);
  assertEquals(payload.name, "Phase A");
  assertEquals(payload.description, "detail");
  assert(Object.isFrozen(payload));
});

// ---------------------------------------------------------------------------
// B. Adapter / RPC regression (Correction C)
// ---------------------------------------------------------------------------

const CREATE_INPUT = Object.freeze({
  expectedOauthClientId: OAUTH_CLIENT_ID,
  projectId: PROJECT_ID,
  name: "Phase A",
  description: null,
  status: "planned",
  phaseType: "work_item",
  startDate: "2026-05-01",
  targetEndDate: "2026-06-01",
  sortOrder: 3,
  requestId: "req-1",
  correlationId: "corr-1",
  idempotencyKey: "key-1",
  payloadHash: "a".repeat(64),
  // deno-lint-ignore no-explicit-any
}) as any;

const UPDATE_INPUT = Object.freeze({
  expectedOauthClientId: OAUTH_CLIENT_ID,
  phaseId: UUID,
  expectedUpdatedAt: TS,
  name: "Phase A",
  description: null,
  status: "active",
  phaseType: "work_item",
  requestId: "req-1",
  correlationId: "corr-1",
  idempotencyKey: "key-1",
  payloadHash: "a".repeat(64),
  // deno-lint-ignore no-explicit-any
}) as any;

const CREATE_OK = Object.freeze({
  ok: true,
  outcome: "applied",
  phaseId: UUID,
  projectId: PROJECT_ID,
  status: "planned",
  phaseType: "work_item",
  startDate: "2026-05-01",
  targetEndDate: "2026-06-01",
  sortOrder: 3,
  isArchived: false,
  createdAt: TS,
  updatedAt: TS,
  shiftedSiblingCount: 0,
});

const CONFIRMATION = Object.freeze({
  ok: false,
  outcome: "confirmation_required",
  code: "extend_project_window_required",
  projectId: PROJECT_ID,
  projectStartDate: "2026-05-01",
  projectTargetEndDate: "2026-05-20",
  requestedPhaseStartDate: "2026-05-01",
  requestedPhaseTargetEndDate: "2026-06-01",
  requiredProjectStartDate: "2026-05-01",
  requiredProjectTargetEndDate: "2026-06-01",
});

const REPLAYED_CONFIRMATION = Object.freeze({
  ...CONFIRMATION,
  outcome: "replayed",
});

const UPDATE_OK = Object.freeze({
  ok: true,
  outcome: "applied",
  phaseId: UUID,
  projectId: PROJECT_ID,
  status: "active",
  phaseType: "work_item",
  updatedAt: TS,
});

interface RpcCall {
  fn: string;
  args: Record<string, unknown>;
}

function fakeRpc(data: unknown, calls: RpcCall[] = []) {
  return {
    calls,
    client: {
      rpc: (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args });
        return Promise.resolve({ data, error: null });
      },
      // deno-lint-ignore no-explicit-any
    } as any,
  };
}

Deno.test("API-M.8A-C1: create adapter calls exactly api_v1_create_phase with exact args", async () => {
  const f = fakeRpc(CREATE_OK);
  const result = await createApiV1Phase(f.client, CREATE_INPUT);
  assertEquals(f.calls.length, 1);
  assertEquals(f.calls[0].fn, "api_v1_create_phase");
  assertEquals(f.calls[0].args, {
    _expected_oauth_client_id: OAUTH_CLIENT_ID,
    _project_id: PROJECT_ID,
    _name: "Phase A",
    _description: null,
    _status: "planned",
    _phase_type: "work_item",
    _start_date: "2026-05-01",
    _target_end_date: "2026-06-01",
    _sort_order: 3,
    _request_id: "req-1",
    _correlation_id: "corr-1",
    _idempotency_key: "key-1",
    _payload_hash: "a".repeat(64),
  });
  assertEquals(result.ok, true);
  assertEquals((result as { outcome: string }).outcome, "applied");
});

Deno.test("API-M.8A-C1: update adapter calls exactly api_v1_update_phase with exact args", async () => {
  const f = fakeRpc(UPDATE_OK);
  const result = await updateApiV1Phase(f.client, UPDATE_INPUT);
  assertEquals(f.calls.length, 1);
  assertEquals(f.calls[0].fn, "api_v1_update_phase");
  assertEquals(f.calls[0].args, {
    _expected_oauth_client_id: OAUTH_CLIENT_ID,
    _phase_id: UUID,
    _expected_updated_at: TS,
    _name: "Phase A",
    _description: null,
    _status: "active",
    _phase_type: "work_item",
    _request_id: "req-1",
    _correlation_id: "corr-1",
    _idempotency_key: "key-1",
    _payload_hash: "a".repeat(64),
  });
  assertEquals(result.ok, true);
});

Deno.test("API-M.8A-C1: Phase adapter module exposes no generic RPC selection", async () => {
  const source = await Deno.readTextFile(
    new URL("../../_shared/btpm-api/supabasePhase.ts", import.meta.url),
  );
  const names = source.match(/client\.rpc\(([^,]+),/g) ?? [];
  // API-M.8B added exactly two more fixed wrapper invocations. API-Q Phase
  // Create Step 2 and API-Q Phase Update Step 2 moved the create and update
  // invocations into the shared, non-exported `invokeCreatePhase` /
  // `invokeUpdatePhase`, whose wrapper names are constrained by the closed
  // `CreatePhaseFunctionName` / `UpdatePhaseFunctionName` types (exactly the
  // api_v1_* and mcp_v1_* pairs) and are never caller-provided.
  assertEquals(names.length, 4);
  assert(String(names[0]).includes("functionName"));
  assert(String(names[1]).includes("functionName"));
  assert(
    /type CreatePhaseFunctionName =\s*\|\s*typeof API_V1_CREATE_PHASE_FUNCTION_NAME\s*\|\s*typeof MCP_V1_CREATE_PHASE_FUNCTION_NAME;/
      .test(source),
  );
  assert(
    /type UpdatePhaseFunctionName =\s*\|\s*typeof API_V1_UPDATE_PHASE_FUNCTION_NAME\s*\|\s*typeof MCP_V1_UPDATE_PHASE_FUNCTION_NAME;/
      .test(source),
  );
  assert(/functionName: CreatePhaseFunctionName,/.test(source));
  assert(/functionName: UpdatePhaseFunctionName,/.test(source));
  assert(!source.includes("export async function invokeCreatePhase"));
  assert(!source.includes("export async function invokeUpdatePhase"));
  assert(String(names[2]).includes("API_V1_REORDER_PHASES_FUNCTION_NAME"));
  assert(String(names[3]).includes("API_V1_PLAN_PHASE_FUNCTION_NAME"));


  assert(!source.includes("Deno.env"));
  assert(!source.includes("service_role"));
  assert(!source.includes("execute_sql"));
});

Deno.test("API-M.8A-C1: ordinary confirmation_required validates and is returned verbatim", async () => {
  const f = fakeRpc(CONFIRMATION);
  const result = await createApiV1Phase(f.client, CREATE_INPUT);
  assertEquals(result, CONFIRMATION);
});

Deno.test("API-M.8A-C1: replayed confirmation is normalized to confirmation_required", async () => {
  const f = fakeRpc(REPLAYED_CONFIRMATION);
  const result = await createApiV1Phase(f.client, CREATE_INPUT);
  assertEquals((result as { outcome: string }).outcome, "confirmation_required");
  assertEquals(result, CONFIRMATION);
  // The transport label never leaks to the HTTP consumer.
  assert((result as { outcome: string }).outcome !== "replayed");
});

Deno.test("API-M.8A-C1: malformed replayed confirmation fails closed", async () => {
  const malformed: unknown[] = [
    { ok: false, outcome: "replayed" },
    { ok: false, outcome: "replayed", code: "extend_project_window_required" },
    { ...REPLAYED_CONFIRMATION, code: "something_else" },
    { ...REPLAYED_CONFIRMATION, extra: 1 },
    { ...REPLAYED_CONFIRMATION, projectId: "not-a-uuid" },
    { ...REPLAYED_CONFIRMATION, requiredProjectTargetEndDate: "2026-6-1" },
    { ...CONFIRMATION, outcome: "replayed", projectId: NIL },
    { ok: false, outcome: "replayed", reason: "arbitrary negative" },
  ];
  for (const data of malformed) {
    const f = fakeRpc(data);
    const err = await assertRejects(
      () => createApiV1Phase(f.client, CREATE_INPUT),
      ApiHttpError,
    );
    assertEquals(err.code, "internal_error");
  }
  // The same strictness applies to the ordinary confirmation label.
  const bad = fakeRpc({ ...CONFIRMATION, code: "nope" });
  const err = await assertRejects(
    () => createApiV1Phase(bad.client, CREATE_INPUT),
    ApiHttpError,
  );
  assertEquals(err.code, "internal_error");
});

Deno.test("API-M.8A-C1: successful create replay remains ok:true / replayed", async () => {
  const f = fakeRpc({ ...CREATE_OK, outcome: "replayed" });
  const result = await createApiV1Phase(f.client, CREATE_INPUT);
  assertEquals(result.ok, true);
  assertEquals((result as { outcome: string }).outcome, "replayed");
});

Deno.test("API-M.8A-C1: update conflict accepts only stale_phase", async () => {
  const good = fakeRpc({ ok: false, outcome: "conflict", code: "stale_phase" });
  assertEquals(await updateApiV1Phase(good.client, UPDATE_INPUT), {
    ok: false,
    outcome: "conflict",
    code: "stale_phase",
  });
  for (
    const data of [
      { ok: false, outcome: "conflict", code: "stale_project" },
      { ok: false, outcome: "conflict" },
      { ok: false, outcome: "conflict", code: "stale_phase", extra: 1 },
      { ok: false, outcome: "replayed", code: "stale_phase" },
      { ...UPDATE_OK, extra: 1 },
    ]
  ) {
    const f = fakeRpc(data);
    const err = await assertRejects(
      () => updateApiV1Phase(f.client, UPDATE_INPUT),
      ApiHttpError,
    );
    assertEquals(err.code, "internal_error");
  }
});

Deno.test("API-M.8A-C1: no Phase narrative is present in any wrapper result", () => {
  for (const result of [CREATE_OK, CONFIRMATION, REPLAYED_CONFIRMATION, UPDATE_OK]) {
    const keys = Object.keys(result);
    assert(!keys.includes("name"));
    assert(!keys.includes("description"));
  }
});

// ---------------------------------------------------------------------------
// C. Delegated executors
// ---------------------------------------------------------------------------

const AUTH_CONTEXT = {
  token: { userId: USER_ID, clientId: OAUTH_CLIENT_ID },
  client: {
    userId: USER_ID,
    apiClientId: API_CLIENT_ID,
    oauthClientId: OAUTH_CLIENT_ID,
    policyVersionId: POLICY_VERSION_ID,
  },
  // deno-lint-ignore no-explicit-any
} as any;

const EXEC_CONTEXT = Object.freeze({
  requestedUserId: USER_ID,
  executingUserId: USER_ID,
  apiClientId: API_CLIENT_ID,
  oauthClientId: OAUTH_CLIENT_ID,
  policyVersionId: POLICY_VERSION_ID,
  requestId: "req-1",
  correlationId: "corr-1",
  idempotencyKey: "key-1",
  payloadHash: "a".repeat(64),
  sourceChannel: "external_api",
  sourceClientId: API_CLIENT_ID,
  delegationMode: "delegated_user",
  // deno-lint-ignore no-explicit-any
}) as any;

Deno.test("API-M.8A-C1: delegated Phase executors bind anon key + caller bearer per call", async () => {
  const seen: Array<{ url: string; key: string; auth: string }> = [];
  const rpcCalls: RpcCall[] = [];
  const clients: unknown[] = [];
  // deno-lint-ignore no-explicit-any
  const factory = (url: string, key: string, options: any) => {
    seen.push({ url, key, auth: options.global.headers.Authorization });
    const client = {
      rpc: (fn: string, args: Record<string, unknown>) => {
        rpcCalls.push({ fn, args });
        return Promise.resolve({
          data: fn === "api_v1_create_phase" ? CREATE_OK : UPDATE_OK,
          error: null,
        });
      },
    };
    clients.push(client);
    return client;
  };

  const createExec = createDelegatedApiV1CreatePhaseExecutor(
    "https://example.supabase.co",
    "anon-key",
    factory,
  );
  const updateExec = createDelegatedApiV1UpdatePhaseExecutor(
    "https://example.supabase.co",
    "anon-key",
    factory,
  );

  const createRequest = new Request("https://x/v1/phases", {
    method: "POST",
    headers: { Authorization: "Bearer caller-token" },
    body: "{}",
  });
  const updateRequest = new Request(`https://x/v1/phases/${UUID}`, {
    method: "PATCH",
    headers: { Authorization: "Bearer caller-token" },
    body: "{}",
  });

  const created = await createExec(
    createRequest,
    AUTH_CONTEXT,
    parseApiV1CreatePhaseBody(createBase()),
    EXEC_CONTEXT,
  );
  const updated = await updateExec(
    updateRequest,
    AUTH_CONTEXT,
    UUID,
    parseApiV1UpdatePhaseBody(updateBase({ status: "active" })),
    EXEC_CONTEXT,
  );

  assertEquals(created.ok, true);
  assertEquals(updated.ok, true);
  assertEquals(seen.length, 2);
  assertEquals(clients.length, 2);
  assert(clients[0] !== clients[1]);
  for (const s of seen) {
    assertEquals(s.url, "https://example.supabase.co");
    assertEquals(s.key, "anon-key");
    assertEquals(s.auth, "Bearer caller-token");
  }
  assertEquals(rpcCalls.map((c) => c.fn), [
    "api_v1_create_phase",
    "api_v1_update_phase",
  ]);

  const source = await Deno.readTextFile(
    new URL("../../_shared/btpm-api/supabaseDelegatedPhase.ts", import.meta.url),
  );
  assert(!source.includes("SERVICE_ROLE"));
  assert(!source.includes("service_role"));
  assert(!source.includes("Deno.env"));
});

Deno.test("API-M.8A-C1: delegated Phase executors reject identity / channel drift", async () => {
  const factory = () => ({
    rpc: () => Promise.resolve({ data: CREATE_OK, error: null }),
  });
  const exec = createDelegatedApiV1CreatePhaseExecutor(
    "https://example.supabase.co",
    "anon-key",
    factory,
  );
  const request = new Request("https://x/v1/phases", {
    method: "POST",
    headers: { Authorization: "Bearer caller-token" },
    body: "{}",
  });
  const body = parseApiV1CreatePhaseBody(createBase());

  const drifts: Array<Record<string, unknown>> = [
    { executingUserId: "99999999-9999-4999-8999-999999999999" },
    { requestedUserId: "99999999-9999-4999-8999-999999999999" },
    { apiClientId: "99999999-9999-4999-8999-999999999999" },
    { oauthClientId: "other-client" },
    { policyVersionId: "99999999-9999-4999-8999-999999999999" },
    { sourceChannel: "browser" },
    { delegationMode: "service" },
  ];
  for (const drift of drifts) {
    const err = await assertRejects(
      () => exec(request, AUTH_CONTEXT, body, { ...EXEC_CONTEXT, ...drift }),
      ApiHttpError,
    );
    assertEquals(err.code, "internal_error");
  }
});

// ---------------------------------------------------------------------------
// D. Router pipeline outcomes
// ---------------------------------------------------------------------------

const ENABLED = parseApiRuntimeControls({
  BTPM_API_ENABLED: "true",
  BTPM_API_READS_ENABLED: "true",
  BTPM_API_MUTATIONS_ENABLED: "true",
});

const MUTATIONS_OFF = parseApiRuntimeControls({
  BTPM_API_ENABLED: "true",
  BTPM_API_READS_ENABLED: "true",
  BTPM_API_MUTATIONS_ENABLED: "false",
});

function phaseDeps(createResult: unknown, updateResult: unknown) {
  const counters = { create: 0, update: 0, authorize: 0, rate: 0, exec: 0 };
  const order: string[] = [];
  return {
    counters,
    order,
    // deno-lint-ignore no-explicit-any
    deps: {
      authenticate: () => Promise.resolve(AUTH_CONTEXT),
      authorizeRoute: () => {
        counters.authorize++;
        order.push("authorize");
        return Promise.resolve();
      },
      resolveRateLimitProfile: () =>
        Promise.resolve({ limit: 1000, windowSeconds: 60 }),
      rateLimit: {
        store: {
          consume: () => {
            counters.rate++;
            order.push("rateLimit");
            return Promise.resolve({
              allowed: true,
              remaining: 999,
              resetAtEpochMs: Date.now() + 60_000,
            });
          },
        },
        now: () => Date.now(),
      },
      createPhase: () => {
        counters.create++;
        counters.exec++;
        order.push("execute");
        return Promise.resolve(createResult);
      },
      updatePhase: () => {
        counters.update++;
        counters.exec++;
        order.push("execute");
        return Promise.resolve(updateResult);
      },
      // API-M.8B — the dependency contract now carries four explicit Phase
      // executors. These two are never invoked by the M.8A pipelines.
      reorderPhases: () => Promise.reject(new Error("unexpected reorder")),
      planPhase: () => Promise.reject(new Error("unexpected plan")),
      // deno-lint-ignore no-explicit-any
    } as any,
  };
}

function routerCreateRequest() {
  return new Request("https://x/v1/phases", {
    method: "POST",
    headers: {
      Authorization: "Bearer caller-token",
      "Idempotency-Key": "key-1",
    },
    body: "{}",
  });
}

function routerUpdateRequest() {
  return new Request(`https://x/v1/phases/${UUID}`, {
    method: "PATCH",
    headers: {
      Authorization: "Bearer caller-token",
      "Idempotency-Key": "key-1",
    },
    body: "{}",
  });
}

Deno.test("API-M.8A-C1: create maps applied → 201, replayed → 200, confirmation → 409", async () => {
  const applied = phaseDeps(CREATE_OK, UPDATE_OK);
  const r1 = await executeApiCreatePhaseRoute(
    routerCreateRequest(),
    createBase(),
    "req-1",
    ENABLED,
    applied.deps,
  );
  assertEquals(r1.status, 201);
  assertEquals(r1.route, PHASE_CREATE_ROUTE);
  assertEquals(applied.counters.create, 1);
  assertEquals(applied.counters.authorize, 1);
  // Rate limiting strictly precedes delegated execution.
  assertEquals(applied.order, ["authorize", "rateLimit", "execute"]);

  const replayed = phaseDeps({ ...CREATE_OK, outcome: "replayed" }, UPDATE_OK);
  const r2 = await executeApiCreatePhaseRoute(
    routerCreateRequest(),
    createBase(),
    "req-1",
    ENABLED,
    replayed.deps,
  );
  assertEquals(r2.status, 200);

  const confirm = phaseDeps(CONFIRMATION, UPDATE_OK);
  const r3 = await executeApiCreatePhaseRoute(
    routerCreateRequest(),
    createBase(),
    "req-1",
    ENABLED,
    confirm.deps,
  );
  assertEquals(r3.status, 409);
  assertEquals(r3.payload, CONFIRMATION);

  // A replayed confirmation traversing the adapter is already normalized, so
  // the pipeline sees exactly the same bounded 409 contract.
  const replayedConfirm = phaseDeps(CONFIRMATION, UPDATE_OK);
  const r4 = await executeApiCreatePhaseRoute(
    routerCreateRequest(),
    createBase(),
    "req-1",
    ENABLED,
    replayedConfirm.deps,
  );
  assertEquals(r4.status, 409);
});

Deno.test("API-M.8A-C1: update maps applied/no_change/replayed → 200 and stale_phase → concurrency_conflict", async () => {
  for (const outcome of ["applied", "no_change", "replayed"]) {
    const d = phaseDeps(CREATE_OK, { ...UPDATE_OK, outcome });
    const r = await executeApiUpdatePhaseRoute(
      routerUpdateRequest(),
      updateBase({ status: "active" }),
      "req-1",
      ENABLED,
      d.deps,
    );
    assertEquals(r.status, 200);
    assertEquals(r.route, PHASE_UPDATE_ROUTE);
    assertEquals(d.counters.update, 1);
    assertEquals(d.counters.authorize, 1);
  }

  const stale = phaseDeps(CREATE_OK, {
    ok: false,
    outcome: "conflict",
    code: "stale_phase",
  });
  const err = await assertRejects(
    () =>
      executeApiUpdatePhaseRoute(
        routerUpdateRequest(),
        updateBase({ status: "active" }),
        "req-1",
        ENABLED,
        stale.deps,
      ),
    ApiHttpError,
  );
  assertEquals(err.code, "concurrency_conflict");
});

Deno.test("API-M.8A-C1: mutation switch and broken deps block Phase execution", async () => {
  const off = phaseDeps(CREATE_OK, UPDATE_OK);
  const e1 = await assertRejects(
    () =>
      executeApiCreatePhaseRoute(
        routerCreateRequest(),
        createBase(),
        "req-1",
        MUTATIONS_OFF,
        off.deps,
      ),
    ApiHttpError,
  );
  assertEquals(e1.code, "api_unavailable");
  const e2 = await assertRejects(
    () =>
      executeApiUpdatePhaseRoute(
        routerUpdateRequest(),
        updateBase(),
        "req-1",
        MUTATIONS_OFF,
        off.deps,
      ),
    ApiHttpError,
  );
  assertEquals(e2.code, "api_unavailable");
  assertEquals(off.counters.exec, 0);

  const broken = phaseDeps(CREATE_OK, UPDATE_OK);
  // deno-lint-ignore no-explicit-any
  const missing = { ...(broken.deps as any) };
  delete missing.createPhase;
  const e3 = await assertRejects(
    () =>
      executeApiCreatePhaseRoute(
        routerCreateRequest(),
        createBase(),
        "req-1",
        ENABLED,
        missing,
      ),
    ApiHttpError,
  );
  assertEquals(e3.code, "internal_error");
});

// ---------------------------------------------------------------------------
// E. Live-handler activity semantics (Correction D)
// ---------------------------------------------------------------------------

interface ActivityTrace {
  records: Array<Record<string, unknown>>;
  scopeCalls: Array<{ targetType: string; targetId: string }>;
  scheduled: number;
}

let activityPending: Promise<boolean>[] = [];

function activityDeps(trace: ActivityTrace) {
  let clock = 1_000;
  return {
    recorder: {
      record: (input: Record<string, unknown>) => {
        trace.records.push(input);
        return Promise.resolve(true);
      },
    },
    scopeResolver: {
      resolve: (targetType: string, targetId: string) => (
        trace.scopeCalls.push({ targetType, targetId }),
        Promise.resolve({
          tenantId: "aaaaaaaa-1111-4111-8111-111111111111",
          organizationId: "bbbbbbbb-2222-4222-8222-222222222222",
          workspaceId: "cccccccc-3333-4333-8333-333333333333",
          projectId: PROJECT_ID,
        })
      ),
    },
    nowMs: () => (clock += 5),
    schedule: (task: Promise<boolean>) => {
      trace.scheduled += 1;
      activityPending.push(task);
    },
  };
}

const LIVE_REQUEST_ID = "44444444-4444-4444-8444-444444444444";

function liveDeps(trace: ActivityTrace, createResult: unknown) {
  const authBits = {
    authenticate: () => Promise.resolve(AUTH_CONTEXT),
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
  };
  return {
    controls: CONTROLS,
    allowedOrigins: new Set<string>([ALLOWED_ORIGIN]),
    timeoutMs: 5_000,
    requestId: { randomUUID: () => LIVE_REQUEST_ID },
    protectedRoute: throwingRoute(),
    phaseMutationRoute: {
      ...authBits,
      createPhase: () => Promise.resolve(createResult),
      updatePhase: () => Promise.resolve(UPDATE_OK),
      reorderPhases: () => Promise.reject(new Error("unexpected reorder")),
      planPhase: () => Promise.reject(new Error("unexpected plan")),
    },
    activity: activityDeps(trace),
  } as unknown as ApiV1HttpHandlerDependencies;
}

function liveRequest(method: "POST" | "PATCH", path: string, body: unknown) {
  return new Request(`https://api.example.test${path}`, {
    method,
    headers: new Headers({
      Origin: ALLOWED_ORIGIN,
      Authorization: "Bearer caller-token",
      "Content-Type": "application/json",
      "Idempotency-Key": "idem-key-0001",
    }),
    body: JSON.stringify(body),
  });
}

async function settleActivity(): Promise<void> {
  const tasks = activityPending;
  activityPending = [];
  await Promise.allSettled(tasks);
}

Deno.test("API-M.8A-C1: successful Phase mutations record Phase-targeted activity", async () => {
  const trace: ActivityTrace = { records: [], scopeCalls: [], scheduled: 0 };
  const created = await handleApiV1Request(
    liveRequest("POST", "/v1/phases", createBase()),
    liveDeps(trace, CREATE_OK),
  );
  assertEquals(created.status, 201);
  await settleActivity();
  assertEquals(trace.scheduled, 1);
  assertEquals(trace.records.length, 1);
  // The canonical hierarchy is resolved SERVER-side from the Phase target.
  assertEquals(trace.scopeCalls, [{ targetType: "phase", targetId: UUID }]);
  assertEquals(trace.records[0].routeId, "phases.create");
  assertEquals(trace.records[0].status, 201);
  assertEquals(trace.records[0].projectId, PROJECT_ID);
  assertEquals(trace.records[0].apiClientId, API_CLIENT_ID);
  assertEquals(trace.records[0].actorUserId, USER_ID);

  const trace2: ActivityTrace = { records: [], scopeCalls: [], scheduled: 0 };
  const updated = await handleApiV1Request(
    liveRequest("PATCH", `/v1/phases/${UUID}`, updateBase({ status: "active" })),
    liveDeps(trace2, CREATE_OK),
  );
  assertEquals(updated.status, 200);
  await settleActivity();
  assertEquals(trace2.records.length, 1);
  assertEquals(trace2.scopeCalls, [{ targetType: "phase", targetId: UUID }]);
  assertEquals(trace2.records[0].routeId, "phases.update");
  assertEquals(trace2.records[0].status, 200);
});

Deno.test("API-M.8A-C1: confirmation-required create records zero durable activity", async () => {
  const trace: ActivityTrace = { records: [], scopeCalls: [], scheduled: 0 };
  const response = await handleApiV1Request(
    liveRequest("POST", "/v1/phases", createBase()),
    liveDeps(trace, CONFIRMATION),
  );
  assertEquals(response.status, 409);
  assertEquals(await response.json(), CONFIRMATION);
  await settleActivity();
  assertEquals(trace.scheduled, 0);
  assertEquals(trace.records.length, 0);
  // No substitute Project-targeted activity is emitted either.
  assertEquals(trace.scopeCalls.length, 0);
});

// ---------------------------------------------------------------------------
// F. Contract inventory
// ---------------------------------------------------------------------------

Deno.test("API-M.8A-C1: read inventory stays 15 and capabilities are bounded", () => {
  // Global mutation cardinality is owned by routes.test.ts; this step-local
  // guard asserts only the invariants API-M.8A itself froze.
  // API-M.CP.2B2 / API-M.CP.2C3 — the read inventory moved from 8 to 12 when
  // the Risk and Blocker reads were activated.
  // API-M.CP.3C — it moved to 13 when the Execution Update history read
  // activated.
  // API-M.CP.4C — it moved to 15 when the Phase and Task detail reads
  // activated.
  // API-Q WML-1B — it moved to 18 when the Workspace member read activated.
  assertEquals(
    API_V1_ROUTE_ALLOWLIST.filter((r) => r.operation === "read").length,
    18,
  );

  const ops = buildCapabilitiesPayload().supportedOperations;
  assert(ops.includes("phases.create"));
  assert(ops.includes("phases.update"));
  assert(ops.includes("phases.reorder"));
  assert(ops.includes("phases.plan"));

  // No generic RPC / CRUD / command surface exists.
  for (const route of API_V1_ROUTE_ALLOWLIST) {
    assert(!route.path.includes("rpc"));
    assert(!route.path.includes("command"));
    assert(!route.path.includes("*"));
    assert(!route.path.includes("sql"));
  }

  // Risk, Blocker and execution-update surfaces remain registered unchanged.
  const ids: readonly string[] = API_V1_ROUTE_ALLOWLIST.map((r) =>
    String(r.id)
  );
  for (
    const id of [
      "execution_updates.append",
      "risks.create",
      "risks.update",
      "blockers.create",
      "blockers.update",
    ]
  ) {
    assert(ids.includes(id), id);
  }
});
