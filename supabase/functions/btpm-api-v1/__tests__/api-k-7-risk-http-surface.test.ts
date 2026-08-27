// API-K.7 — Focused regression tests for the external Risk HTTP surface:
//   POST  /v1/risks
//   PATCH /v1/risks/:riskid

import {
  assert,
  assertEquals,
  assertRejects,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { ApiHttpError } from "../../_shared/btpm-api/http.ts";
import { canonicalizePayload } from "../../_shared/btpm-api/idempotency.ts";
import {
  RISK_CREATE_ROUTE,
  RISK_UPDATE_ROUTE,
  buildApiV1UpdateRiskIdempotencyPayload,
  parseApiV1CreateRiskBody,
  parseApiV1RiskUpdatePath,
  parseApiV1UpdateRiskBody,
} from "../routes/risks.ts";
import {
  API_V1_ROUTE_ALLOWLIST,
  matchApiRoute,
  parseApiRuntimeControls,
  executeApiCreateRiskRoute,
  executeApiUpdateRiskRoute,
} from "../router.ts";
import {
  createApiV1Risk,
  updateApiV1Risk,
} from "../../_shared/btpm-api/supabaseRisk.ts";
import {
  createDelegatedApiV1CreateRiskExecutor,
  createDelegatedApiV1UpdateRiskExecutor,
} from "../../_shared/btpm-api/supabaseDelegatedRisk.ts";

const RISK_ID = "8f14e45f-ceea-467a-a4a7-2b4b0c7f4d21";
const TARGET_ID = "3b1e2c44-7a1f-4a02-9d5f-1c2b3a4d5e6f";
const OTHER_RISK_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const NIL = "00000000-0000-0000-0000-000000000000";
const TS = "2026-08-08T14:56:32.123456+00:00";
const USER_ID = "c2a1f5d0-1111-4c22-9a33-4d5e6f708192";
const API_CLIENT_ID = "d4b2e6a1-2222-4d33-8b44-5e6f70819203";
const POLICY_VERSION_ID = "e5c3f7b2-3333-4e44-9c55-6f7081920314";

// -----------------------------------------------------------------------------
// 1 / 2 — Route identity and dynamic path parser
// -----------------------------------------------------------------------------

Deno.test("API-K.7: Risk route contracts are exact and frozen", () => {
  assertEquals(RISK_CREATE_ROUTE.id, "risks.create");
  assertEquals(RISK_CREATE_ROUTE.method, "POST");
  assertEquals(RISK_CREATE_ROUTE.path, "/v1/risks");
  assertEquals(RISK_CREATE_ROUTE.operation, "mutation");
  assertEquals(Object.keys(RISK_CREATE_ROUTE).length, 4);
  assert(Object.isFrozen(RISK_CREATE_ROUTE));

  assertEquals(RISK_UPDATE_ROUTE.id, "risks.update");
  assertEquals(RISK_UPDATE_ROUTE.method, "PATCH");
  assertEquals(RISK_UPDATE_ROUTE.path, "/v1/risks/:riskid");
  assertEquals(RISK_UPDATE_ROUTE.operation, "mutation");
  assert(Object.isFrozen(RISK_UPDATE_ROUTE));
});

Deno.test("API-K.7: Risk update path parser is exact", () => {
  assertEquals(parseApiV1RiskUpdatePath(`/v1/risks/${RISK_ID}`), {
    riskId: RISK_ID,
  });

  for (
    const bad of [
      "/v1/risks",
      "/v1/risks/",
      `/v1/risks/${RISK_ID}/`,
      `/v1/risks/${RISK_ID}/extra`,
      `/v1/risks/${NIL}`,
      "/v1/risks/nope",
      `/v1/risks/${RISK_ID.replace(/-/g, "")}`,
      `/v1/risks/${RISK_ID.toUpperCase()}X`,
      `/v1/risks/${RISK_ID}?a=1`,
      `/v1/risks/${RISK_ID}#f`,
      `/v1/risks/%38f14e45f`,
      `/v1/risks/ ${RISK_ID}`,
      `/v1/risks/${RISK_ID};v=1`,
      `/V1/risks/${RISK_ID}`,
      `/v1/risk/${RISK_ID}`,
      `/api/v1/risks/${RISK_ID}`,
    ]
  ) {
    const err = assertThrows(
      () => parseApiV1RiskUpdatePath(bad),
      ApiHttpError,
      undefined,
      `expected rejection for ${bad}`,
    );
    assertEquals(err.code, "invalid_request");
  }
});

// -----------------------------------------------------------------------------
// 3 / 5 / 6 / 7 — create body
// -----------------------------------------------------------------------------

function createBase(overrides: Record<string, unknown> = {}) {
  return { targetType: "project", targetId: TARGET_ID, title: "T", ...overrides };
}

function assertInvalidCreate(input: unknown) {
  const err = assertThrows(
    () => parseApiV1CreateRiskBody(input),
    ApiHttpError,
  );
  assertEquals(err.code, "invalid_request");
  assertEquals(err.status, 400);
}

Deno.test("API-K.7: create defaults are deterministic", () => {
  const parsed = parseApiV1CreateRiskBody(createBase());
  assertEquals(parsed, {
    targetType: "project",
    targetId: TARGET_ID,
    title: "T",
    description: null,
    mitigationPlan: null,
    likelihood: "medium",
    impact: "medium",
    status: "open",
  });
  assert(Object.isFrozen(parsed));
});

Deno.test("API-K.7: create schema is closed and required fields enforced", () => {
  for (
    const key of [
      "extra",
      "Title",
      "target_type",
      "riskId",
      "userLinks",
      "objectLinks",
      "links",
      "projectId",
      "workspaceId",
      "organizationId",
      "tenantId",
      "requestedUserId",
      "executingUserId",
      "sourceChannel",
      "sourceClientId",
      "apiClientId",
      "capabilityKey",
      "command",
      "function",
      "rpc",
      "table",
      "sql",
      "requestId",
      "correlationId",
      "idempotencyKey",
      "payloadHash",
      "expectedUpdatedAt",
    ]
  ) {
    assertInvalidCreate(createBase({ [key]: "x" }));
  }
  for (const bad of [null, undefined, 0, "", "{}", true, [], [createBase()]]) {
    assertInvalidCreate(bad);
  }
  assertInvalidCreate({ targetId: TARGET_ID, title: "T" });
  assertInvalidCreate({ targetType: "project", title: "T" });
  assertInvalidCreate({ targetType: "project", targetId: TARGET_ID });
});

Deno.test("API-K.7: create enums are exact and legacy Risk aliases rejected", () => {
  for (const t of ["project", "phase", "task"]) {
    assertEquals(parseApiV1CreateRiskBody(createBase({ targetType: t })).targetType, t);
  }
  for (const bad of ["Project", "PHASE", "program", " task", "", null, 1]) {
    assertInvalidCreate(createBase({ targetType: bad }));
  }
  for (const l of ["low", "medium", "high"]) {
    assertEquals(parseApiV1CreateRiskBody(createBase({ likelihood: l })).likelihood, l);
  }
  assertInvalidCreate(createBase({ likelihood: "critical" }));
  for (const i of ["low", "medium", "high", "critical"]) {
    assertEquals(parseApiV1CreateRiskBody(createBase({ impact: i })).impact, i);
  }
  assertInvalidCreate(createBase({ impact: "extreme" }));
  for (
    const st of ["open", "under_mitigation", "monitoring", "realized", "closed"]
  ) {
    assertEquals(parseApiV1CreateRiskBody(createBase({ status: st })).status, st);
  }
  for (const legacy of ["identified", "mitigating", "accepted", "Open"]) {
    assertInvalidCreate(createBase({ status: legacy }));
  }
});

Deno.test("API-K.7: create targetId must be a canonical non-nil UUID", () => {
  for (const bad of ["nope", NIL, ` ${TARGET_ID} `, TARGET_ID.replace(/-/g, ""), null, 1]) {
    assertInvalidCreate(createBase({ targetId: bad }));
  }
});

Deno.test("API-K.7: create preserves narrative content exactly", () => {
  const title = "  Risk of\tslippage  ";
  const parsed = parseApiV1CreateRiskBody(
    createBase({ title, description: " d ", mitigationPlan: null }),
  );
  assertEquals(parsed.title, title);
  assertEquals(parsed.description, " d ");
  assertEquals(parsed.mitigationPlan, null);
  assertInvalidCreate(createBase({ title: "   " }));
  assertInvalidCreate(createBase({ title: "" }));
});

// -----------------------------------------------------------------------------
// 4 / 8 / 9 — update body
// -----------------------------------------------------------------------------

function updateBase(overrides: Record<string, unknown> = {}) {
  return {
    expectedUpdatedAt: TS,
    title: "T",
    description: null,
    mitigationPlan: null,
    likelihood: "medium",
    impact: "high",
    status: "under_mitigation",
    ...overrides,
  };
}

function assertInvalidUpdate(input: unknown) {
  const err = assertThrows(
    () => parseApiV1UpdateRiskBody(input),
    ApiHttpError,
  );
  assertEquals(err.code, "invalid_request");
}

Deno.test("API-K.7: update requires the complete scalar state", () => {
  const parsed = parseApiV1UpdateRiskBody(updateBase());
  assertEquals(Object.keys(parsed).length, 7);
  assert(Object.isFrozen(parsed));

  for (
    const key of [
      "expectedUpdatedAt",
      "title",
      "description",
      "mitigationPlan",
      "likelihood",
      "impact",
      "status",
    ]
  ) {
    const body = updateBase();
    delete (body as Record<string, unknown>)[key];
    assertInvalidUpdate(body);
  }
});

Deno.test("API-K.7: update schema is closed — identity/scope/dispatch keys rejected", () => {
  for (
    const key of [
      "riskId",
      "targetType",
      "targetId",
      "projectId",
      "workspaceId",
      "organizationId",
      "tenantId",
      "userLinks",
      "objectLinks",
      "provenance",
      "requestId",
      "correlationId",
      "idempotencyKey",
      "payloadHash",
      "command",
      "function",
      "rpc",
      "table",
      "sql",
      "extra",
    ]
  ) {
    assertInvalidUpdate(updateBase({ [key]: "x" }));
  }
  for (const bad of [null, undefined, 1, "", "{}", true, [], [updateBase()]]) {
    assertInvalidUpdate(bad);
  }
});

Deno.test("API-K.7: expectedUpdatedAt requires an explicit timezone", () => {
  for (
    const ok of [
      "2026-08-08T14:56:32Z",
      "2026-08-08T14:56:32.1Z",
      "2026-08-08T14:56:32.123456Z",
      "2026-08-08 14:56:32.123456+00",
      "2026-08-08T14:56:32+02:00",
      "2026-08-08T14:56:32-0500",
      TS,
    ]
  ) {
    assertEquals(
      parseApiV1UpdateRiskBody(updateBase({ expectedUpdatedAt: ok }))
        .expectedUpdatedAt,
      ok,
    );
  }
  for (
    const bad of [
      "2026-08-08T14:56:32",
      "2026-08-08",
      "2026-13-08T00:00:00Z",
      "2026-02-30T00:00:00Z",
      "2026-08-08T24:00:00Z",
      " 2026-08-08T14:56:32Z",
      "",
      null,
      1,
    ]
  ) {
    assertInvalidUpdate(updateBase({ expectedUpdatedAt: bad }));
  }
});

Deno.test("API-K.7: update enums exact, legacy aliases rejected", () => {
  assertInvalidUpdate(updateBase({ status: "identified" }));
  assertInvalidUpdate(updateBase({ status: "mitigating" }));
  assertInvalidUpdate(updateBase({ status: "accepted" }));
  assertInvalidUpdate(updateBase({ likelihood: "critical" }));
  assertInvalidUpdate(updateBase({ impact: "extreme" }));
  assertInvalidUpdate(updateBase({ description: 1 }));
  assertInvalidUpdate(updateBase({ title: "  " }));
});

// -----------------------------------------------------------------------------
// 13 / 14 / 15 — idempotency canonical payloads
// -----------------------------------------------------------------------------

Deno.test("API-K.7: create canonical payload includes target identity", () => {
  const a = canonicalizePayload(parseApiV1CreateRiskBody(createBase()));
  const b = canonicalizePayload(
    parseApiV1CreateRiskBody(createBase({ targetId: RISK_ID })),
  );
  const c = canonicalizePayload(
    parseApiV1CreateRiskBody(createBase({ targetType: "task" })),
  );
  assert(a.includes(TARGET_ID));
  assert(a !== b);
  assert(a !== c);
});

Deno.test("API-K.7: update canonical payload folds in the path Risk ID", () => {
  const body = parseApiV1UpdateRiskBody(updateBase());
  const same = canonicalizePayload(
    buildApiV1UpdateRiskIdempotencyPayload(RISK_ID, body),
  );
  const sameAgain = canonicalizePayload(
    buildApiV1UpdateRiskIdempotencyPayload(
      RISK_ID,
      parseApiV1UpdateRiskBody(updateBase()),
    ),
  );
  const otherRisk = canonicalizePayload(
    buildApiV1UpdateRiskIdempotencyPayload(OTHER_RISK_ID, body),
  );
  const otherBody = canonicalizePayload(
    buildApiV1UpdateRiskIdempotencyPayload(
      RISK_ID,
      parseApiV1UpdateRiskBody(updateBase({ status: "closed" })),
    ),
  );

  assert(same.includes(RISK_ID));
  assertEquals(same, sameAgain);
  assert(same !== otherRisk);
  assert(same !== otherBody);
});

// -----------------------------------------------------------------------------
// 10 / 11 — base RPC adapters
// -----------------------------------------------------------------------------

const CREATE_INPUT = Object.freeze({
  expectedOauthClientId: "astra-client",
  targetType: "project" as const,
  targetId: TARGET_ID,
  title: "T",
  description: null,
  mitigationPlan: null,
  likelihood: "medium" as const,
  impact: "high" as const,
  status: "open" as const,
  requestId: "req-1",
  correlationId: "corr-1",
  idempotencyKey: "key-1",
  payloadHash: "a".repeat(64),
});

const UPDATE_INPUT = Object.freeze({
  expectedOauthClientId: "astra-client",
  riskId: RISK_ID,
  expectedUpdatedAt: TS,
  title: "T",
  description: null,
  mitigationPlan: null,
  likelihood: "medium" as const,
  impact: "high" as const,
  status: "closed" as const,
  requestId: "req-1",
  correlationId: "corr-1",
  idempotencyKey: "key-1",
  payloadHash: "a".repeat(64),
});

function stubClient(data: unknown) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    client: {
      rpc(fn: string, args: Record<string, unknown>) {
        calls.push({ fn, args });
        return Promise.resolve({ data, error: null });
      },
      // deno-lint-ignore no-explicit-any
    } as any,
  };
}

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

Deno.test("API-K.7: adapters call only their dedicated wrapper", async () => {
  const c = stubClient(CREATE_OK);
  await createApiV1Risk(c.client, CREATE_INPUT);
  assertEquals(c.calls.length, 1);
  assertEquals(c.calls[0].fn, "api_v1_create_risk");
  assertEquals(c.calls[0].args._target_id, TARGET_ID);
  assertEquals(c.calls[0].args._payload_hash, "a".repeat(64));

  const u = stubClient(UPDATE_OK);
  await updateApiV1Risk(u.client, UPDATE_INPUT);
  assertEquals(u.calls.length, 1);
  assertEquals(u.calls[0].fn, "api_v1_update_risk");
  assertEquals(u.calls[0].args._risk_id, RISK_ID);
});

Deno.test("API-K.7: adapters strictly validate bounded wrapper results", async () => {
  // Extra / narrative-bearing keys are rejected.
  for (
    const bad of [
      { ...CREATE_OK, title: "leak" },
      { ...CREATE_OK, description: "leak" },
      { ...CREATE_OK, outcome: "no_change" },
      { ...CREATE_OK, status: "identified" },
      { ...CREATE_OK, riskId: NIL },
      { ...CREATE_OK, createdAt: "nope" },
      { ok: true },
      { ok: false, outcome: "conflict", code: "stale_risk" },
      null,
      [],
      "x",
    ]
  ) {
    const s = stubClient(bad);
    const err = await assertRejects(
      () => createApiV1Risk(s.client, CREATE_INPUT),
      ApiHttpError,
    );
    assertEquals(err.code, "internal_error");
  }

  for (
    const bad of [
      { ...UPDATE_OK, mitigationPlan: "leak" },
      { ...UPDATE_OK, createdAt: TS },
      { ok: false, outcome: "conflict", code: "other" },
      { ok: false, outcome: "conflict" },
      { ok: false, outcome: "stale_risk" },
    ]
  ) {
    const s = stubClient(bad);
    const err = await assertRejects(
      () => updateApiV1Risk(s.client, UPDATE_INPUT),
      ApiHttpError,
    );
    assertEquals(err.code, "internal_error");
  }

  // Accepted negative and conflict shapes.
  for (
    const outcome of [
      "invalid",
      "not_authorized",
      "idempotency_conflict",
      "idempotency_pending",
    ] as const

  ) {
    const s = stubClient({ ok: false, outcome });
    assertEquals(await createApiV1Risk(s.client, CREATE_INPUT), {
      ok: false,
      outcome,
    });
  }
  const conflict = stubClient({
    ok: false,
    outcome: "conflict",
    code: "stale_risk",
  });
  assertEquals(await updateApiV1Risk(conflict.client, UPDATE_INPUT), {
    ok: false,
    outcome: "conflict",
    code: "stale_risk",
  });
  for (const outcome of ["applied", "no_change", "replayed"] as const) {
    const s = stubClient({ ...UPDATE_OK, outcome });
    const r = await updateApiV1Risk(s.client, UPDATE_INPUT);
    assertEquals(r.ok, true);
  }
});

Deno.test("API-K.7: adapter maps SQLSTATE 42501 to not_authorized", async () => {
  const client = {
    rpc: () => Promise.resolve({ data: null, error: { code: "42501" } }),
    // deno-lint-ignore no-explicit-any
  } as any;
  const err = await assertRejects(
    () => createApiV1Risk(client, CREATE_INPUT),
    ApiHttpError,
  );
  assertEquals(err.code, "not_authorized");

  const other = {
    rpc: () =>
      Promise.resolve({
        data: null,
        error: { code: "22P02", message: "raw db detail" },
      }),
    // deno-lint-ignore no-explicit-any
  } as any;
  const err2 = await assertRejects(
    () => updateApiV1Risk(other, UPDATE_INPUT),
    ApiHttpError,
  );
  assertEquals(err2.code, "internal_error");
  assertEquals(err2.publicMessage, "Internal server error.");
});

// -----------------------------------------------------------------------------
// 12 — delegated executors use anon + current bearer token
// -----------------------------------------------------------------------------

const AUTH_CONTEXT = {
  token: { userId: USER_ID, clientId: "astra-client" },
  client: {
    userId: USER_ID,
    apiClientId: API_CLIENT_ID,
    oauthClientId: "astra-client",
    policyVersionId: POLICY_VERSION_ID,
  },
  // deno-lint-ignore no-explicit-any
} as any;

const EXEC_CONTEXT = Object.freeze({
  requestedUserId: USER_ID,
  executingUserId: USER_ID,
  apiClientId: API_CLIENT_ID,
  oauthClientId: "astra-client",
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

Deno.test("API-K.7: delegated executors bind anon key + caller bearer token", async () => {
  const seen: Array<{ url: string; key: string; auth: string }> = [];
  // deno-lint-ignore no-explicit-any
  const factory = (url: string, key: string, options: any) => {
    seen.push({ url, key, auth: options.global.headers.Authorization });
    assertEquals(options.auth.persistSession, false);
    assertEquals(options.auth.autoRefreshToken, false);
    return {
      rpc: () => Promise.resolve({ data: CREATE_OK, error: null }),
    };
  };

  const exec = createDelegatedApiV1CreateRiskExecutor(
    "https://example.supabase.co",
    "anon-key",
    factory,
  );
  const request = new Request("https://x/v1/risks", {
    method: "POST",
    headers: { Authorization: "Bearer caller-token" },
    body: "{}",
  });
  const result = await exec(
    request,
    AUTH_CONTEXT,
    parseApiV1CreateRiskBody(createBase()),
    EXEC_CONTEXT,
  );
  assertEquals(result.ok, true);
  assertEquals(seen.length, 1);
  assertEquals(seen[0].key, "anon-key");
  assertEquals(seen[0].auth, "Bearer caller-token");

  const source = await Deno.readTextFile(
    new URL(
      "../../_shared/btpm-api/supabaseDelegatedRisk.ts",
      import.meta.url,
    ),
  );
  assert(!source.includes("SERVICE_ROLE"));
  assert(!source.includes("service_role"));
  assert(!source.includes("Deno.env"));
});

Deno.test("API-K.7: delegated update executor rejects identity mismatch", async () => {
  const exec = createDelegatedApiV1UpdateRiskExecutor(
    "https://example.supabase.co",
    "anon-key",
    () => ({ rpc: () => Promise.resolve({ data: UPDATE_OK, error: null }) }),
  );
  const request = new Request(`https://x/v1/risks/${RISK_ID}`, {
    method: "PATCH",
    headers: { Authorization: "Bearer caller-token" },
    body: "{}",
  });
  const err = await assertRejects(
    () =>
      exec(
        request,
        AUTH_CONTEXT,
        RISK_ID,
        parseApiV1UpdateRiskBody(updateBase()),
        { ...EXEC_CONTEXT, oauthClientId: "someone-else" },
      ),
    ApiHttpError,
  );
  assertEquals(err.code, "internal_error");
});

// -----------------------------------------------------------------------------
// 16 / 25 / 26 — router allowlist
// -----------------------------------------------------------------------------

Deno.test("API-K.7: router exposes exactly the two Risk mutation targets", () => {
  assertEquals(matchApiRoute("POST", "/v1/risks"), RISK_CREATE_ROUTE);
  assertEquals(
    matchApiRoute("PATCH", `/v1/risks/${RISK_ID}`),
    RISK_UPDATE_ROUTE,
  );

  assertEquals(matchApiRoute("PATCH", "/v1/risks"), null);
  assertEquals(matchApiRoute("PATCH", `/v1/risks/${NIL}`), null);
  assertEquals(matchApiRoute("PATCH", `/v1/risks/${RISK_ID}/`), null);
  assertEquals(matchApiRoute("PATCH", "/v1/projects"), null);
  assertEquals(matchApiRoute("PATCH", "/v1/blockers"), null);
  assertEquals(matchApiRoute("POST", `/v1/risks/${RISK_ID}`), null);
  assertEquals(matchApiRoute("POST", "/v1/risks/"), null);
  assertEquals(matchApiRoute("PUT", "/v1/risks"), null);
  assertEquals(matchApiRoute("DELETE", `/v1/risks/${RISK_ID}`), null);
});

// API-N.RG1B — this historical guard no longer snapshots the whole current
// operation-ID array or the whole GET-path array. Global order/cardinality and
// `/v1/capabilities` parity are owned solely by
// api-v1-current-surface-topology.test.ts. What remains is the local Risk and
// Blocker mutation contract this file actually owns.
Deno.test("API-K.7/API-K.8/API-N.RG1B: the four Risk/Blocker mutation routes are registered exactly once with exact contracts", () => {
  const expected = [
    { id: "risks.create", method: "POST", path: "/v1/risks" },
    { id: "risks.update", method: "PATCH", path: "/v1/risks/:riskid" },
    { id: "blockers.create", method: "POST", path: "/v1/blockers" },
    { id: "blockers.update", method: "PATCH", path: "/v1/blockers/:blockerid" },
  ] as const;
  for (const row of expected) {
    const matches = API_V1_ROUTE_ALLOWLIST.filter((r) => r.id === row.id);
    assertEquals(matches.length, 1, row.id);
    assertEquals(matches[0].method, row.method, row.id);
    assertEquals(matches[0].path, row.path, row.id);
    assertEquals(matches[0].operation, "mutation", row.id);
  }
});

Deno.test("API-K.7/API-K.8/API-N.RG1B: matchApiRoute resolves exactly the four Risk/Blocker mutation shapes", () => {
  assertEquals(matchApiRoute("POST", "/v1/risks")?.id, "risks.create");
  assertEquals(
    matchApiRoute("PATCH", `/v1/risks/${RISK_ID}`)?.id,
    "risks.update",
  );
  assertEquals(matchApiRoute("POST", "/v1/blockers")?.id, "blockers.create");
  assertEquals(
    matchApiRoute("PATCH", `/v1/blockers/${RISK_ID}`)?.id,
    "blockers.update",
  );
});


// -----------------------------------------------------------------------------
// 17 - 21 — pipeline outcomes
// -----------------------------------------------------------------------------

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

function riskDeps(
  createResult: unknown,
  updateResult: unknown,
  counters = { create: 0, update: 0 },
) {
  return {
    counters,
    deps: {
      authenticate: () => Promise.resolve(AUTH_CONTEXT),
      authorizeRoute: () => Promise.resolve(),
      resolveRateLimitProfile: () =>
        Promise.resolve({ limit: 1000, windowSeconds: 60 }),
      rateLimit: {
        store: {
          consume: () =>
            Promise.resolve({
              allowed: true,
              remaining: 999,
              resetAtEpochMs: Date.now() + 60_000,
            }),
        },
        now: () => Date.now(),
      },
      createRisk: () => {
        counters.create++;
        return Promise.resolve(createResult);
      },
      updateRisk: () => {
        counters.update++;
        return Promise.resolve(updateResult);
      },
      // deno-lint-ignore no-explicit-any
    } as any,
  };
}

function createRequest() {
  return new Request("https://x/v1/risks", {
    method: "POST",
    headers: {
      Authorization: "Bearer caller-token",
      "Idempotency-Key": "key-1",
    },
    body: "{}",
  });
}

function updateRequest() {
  return new Request(`https://x/v1/risks/${RISK_ID}`, {
    method: "PATCH",
    headers: {
      Authorization: "Bearer caller-token",
      "Idempotency-Key": "key-1",
    },
    body: "{}",
  });
}

Deno.test("API-K.7: mutation switch blocks both Risk routes before execution", async () => {
  const c = riskDeps(CREATE_OK, UPDATE_OK);
  const e1 = await assertRejects(
    () =>
      executeApiCreateRiskRoute(
        createRequest(),
        createBase(),
        "req-1",
        MUTATIONS_OFF,
        c.deps,
      ),
    ApiHttpError,
  );
  assertEquals(e1.code, "api_unavailable");

  const e2 = await assertRejects(
    () =>
      executeApiUpdateRiskRoute(
        updateRequest(),
        updateBase(),
        "req-1",
        MUTATIONS_OFF,
        c.deps,
      ),
    ApiHttpError,
  );
  assertEquals(e2.code, "api_unavailable");
  assertEquals(c.counters.create, 0);
  assertEquals(c.counters.update, 0);
});

Deno.test("API-K.7: create applied → 201, replayed → 200", async () => {
  const applied = riskDeps(CREATE_OK, UPDATE_OK);
  const r1 = await executeApiCreateRiskRoute(
    createRequest(),
    createBase(),
    "req-1",
    ENABLED,
    applied.deps,
  );
  assertEquals(r1.status, 201);
  assertEquals(r1.route, RISK_CREATE_ROUTE);
  assertEquals(applied.counters.create, 1);
  assertEquals(r1.activityIdentity, {
    apiClientId: API_CLIENT_ID,
    actorUserId: USER_ID,
  });

  const replayed = riskDeps({ ...CREATE_OK, outcome: "replayed" }, UPDATE_OK);
  const r2 = await executeApiCreateRiskRoute(
    createRequest(),
    createBase(),
    "req-1",
    ENABLED,
    replayed.deps,
  );
  assertEquals(r2.status, 200);
});

Deno.test("API-K.7: update applied/no_change/replayed → 200", async () => {
  for (const outcome of ["applied", "no_change", "replayed"]) {
    const d = riskDeps(CREATE_OK, { ...UPDATE_OK, outcome });
    const r = await executeApiUpdateRiskRoute(
      updateRequest(),
      updateBase(),
      "req-1",
      ENABLED,
      d.deps,
    );
    assertEquals(r.status, 200);
    assertEquals(r.route, RISK_UPDATE_ROUTE);
    assertEquals(d.counters.update, 1);
  }
});

Deno.test("API-K.7: stale_risk maps to a safe 409 concurrency conflict", async () => {
  const d = riskDeps(CREATE_OK, {
    ok: false,
    outcome: "conflict",
    code: "stale_risk",
  });
  const err = await assertRejects(
    () =>
      executeApiUpdateRiskRoute(
        updateRequest(),
        updateBase(),
        "req-1",
        ENABLED,
        d.deps,
      ),
    ApiHttpError,
  );
  assertEquals(err.code, "concurrency_conflict");
  assertEquals(err.status, 409);
  assertEquals(err.publicMessage, "Resource update conflicts with a newer version.");
  assert(!err.publicMessage.includes("stale_risk"));
});

Deno.test("API-K.7: negative outcomes map safely and distinctly", async () => {
  const expectations: Array<[string, string, number]> = [
    ["invalid", "invalid_request", 400],
    ["not_authorized", "not_authorized", 403],
    ["idempotency_conflict", "idempotency_conflict", 409],
    ["idempotency_pending", "idempotency_pending", 409],
  ];
  for (const [outcome, code, status] of expectations) {
    const d = riskDeps({ ok: false, outcome }, { ok: false, outcome });
    const e1 = await assertRejects(
      () =>
        executeApiCreateRiskRoute(
          createRequest(),
          createBase(),
          "req-1",
          ENABLED,
          d.deps,
        ),
      ApiHttpError,
    );
    assertEquals(e1.code, code);
    assertEquals(e1.status, status);

    const e2 = await assertRejects(
      () =>
        executeApiUpdateRiskRoute(
          updateRequest(),
          updateBase(),
          "req-1",
          ENABLED,
          d.deps,
        ),
      ApiHttpError,
    );
    assertEquals(e2.code, code);
  }
});

Deno.test("API-K.7: Risk pipelines reject query strings and fragments", async () => {
  const d = riskDeps(CREATE_OK, UPDATE_OK);
  const err = await assertRejects(
    () =>
      executeApiCreateRiskRoute(
        new Request("https://x/v1/risks?a=1", {
          method: "POST",
          headers: {
            Authorization: "Bearer t",
            "Idempotency-Key": "key-1",
          },
          body: "{}",
        }),
        createBase(),
        "req-1",
        ENABLED,
        d.deps,
      ),
    ApiHttpError,
  );
  assertEquals(err.code, "invalid_request");
  assertEquals(d.counters.create, 0);
});

// -----------------------------------------------------------------------------
// 27 / 28 — no generic dispatch, no narrative leakage
// -----------------------------------------------------------------------------

Deno.test("API-K.7: route module is pure and free of runtime access", async () => {
  const source = await Deno.readTextFile(
    new URL("../routes/risks.ts", import.meta.url),
  );
  for (
    const needle of [
      "Deno.env",
      "createClient",
      "supabase",
      "service_role",
      "fetch(",
      "console.log",
      "console.error",
      "Deno.serve",
      "request.json",
      ".headers",
      "crypto",
      "api_v1_create_risk",
      "api_v1_update_risk",
      "API_V1_ROUTE_ALLOWLIST",
      "setTimeout",
    ]
  ) {
    assert(!source.includes(needle), `must not contain: ${needle}`);
  }
});

Deno.test("API-K.7: no generic RPC/CRUD dispatch in the Risk adapters", async () => {
  const source = await Deno.readTextFile(
    new URL("../../_shared/btpm-api/supabaseRisk.ts", import.meta.url),
  );
  const rpcCalls = source.match(/client\.rpc\(/g) ?? [];
  assertEquals(rpcCalls.length, 2);
  assert(source.includes('"api_v1_create_risk"'));
  assert(source.includes('"api_v1_update_risk"'));
  assert(!source.includes("execute_sql"));
  assert(!source.includes(".from("));
  assert(!source.includes("Deno.env"));
  assert(!source.includes("service_role"));
  // No Blocker surface leaks into the Risk HTTP step.
  assert(!source.includes("blocker"));
});

Deno.test("API-K.7: bounded success payloads carry no Risk narrative", async () => {
  const d = riskDeps(CREATE_OK, UPDATE_OK);
  const created = await executeApiCreateRiskRoute(
    createRequest(),
    createBase({ title: "SECRET TITLE", description: "SECRET DESC" }),
    "req-1",
    ENABLED,
    d.deps,
  );
  const serialized = JSON.stringify(created.payload);
  assert(!serialized.includes("SECRET"));
  assert(!serialized.includes("title"));
  assert(!serialized.includes("description"));
  assert(!serialized.includes("mitigation"));
  assert(!serialized.includes("payloadHash"));
  assert(!serialized.includes("Idempotency"));
});
