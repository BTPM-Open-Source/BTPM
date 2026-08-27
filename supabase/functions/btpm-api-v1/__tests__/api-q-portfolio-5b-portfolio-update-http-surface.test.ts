// API-Q Portfolio-5B — Focused HTTP-activation guards for the single accepted
// external Portfolio update command: PATCH /v1/portfolios/{portfolioId}
// (portfolios.update).
//
// Structural precedent: api-n-9b-program-update-external-command.test.ts.
// These guards assert exactly this step's local contracts: exact-once route
// registration, exact dynamic path/method matching, strict closed-schema body
// parsing with PATCH presence semantics, deterministic canonical idempotency
// payload construction including the URL-borne Portfolio identity, the explicit
// RPC adapter argument mapping and bounded outcome shapes, a caller-bound
// delegated executor, and the unified runtime dependency execution order.
// Global route cardinality remains owned by
// api-v1-current-surface-topology.test.ts.

import {
  assert,
  assertEquals,
  assertRejects,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  API_V1_ROUTE_ALLOWLIST,
  executeApiUpdatePortfolioRoute,
  matchApiRoute,
  parseApiRuntimeControls,
} from "../router.ts";
import {
  PORTFOLIO_UPDATE_ROUTE,
  buildApiV1UpdatePortfolioIdempotencyPayload,
  parseApiV1PortfolioUpdatePath,
  parseApiV1UpdatePortfolioBody,
} from "../routes/portfolios.ts";
import { buildCapabilitiesPayload } from "../routes/capabilities.ts";
import { ApiHttpError } from "../../_shared/btpm-api/http.ts";
import {
  updateApiV1Portfolio,
  type ApiV1UpdatePortfolioRpcArgs,
} from "../../_shared/btpm-api/supabasePortfolioMutation.ts";
import { createDelegatedApiV1UpdatePortfolioExecutor } from "../../_shared/btpm-api/supabaseDelegatedPortfolioMutation.ts";

const PORTFOLIO_ID = "44444444-4444-4444-8444-444444444444";
const OWNER_ID = "88888888-8888-4888-8888-888888888888";
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const HASH = "a".repeat(64);
const TS = "2026-03-01T10:20:30.123456+00:00";

async function readSource(relative: string): Promise<string> {
  return await Deno.readTextFile(new URL(relative, import.meta.url));
}

// ---------------------------------------------------------------------------
// A. Route registration and matching
// ---------------------------------------------------------------------------

Deno.test("Portfolio-5B: PORTFOLIO_UPDATE_ROUTE is frozen and exactly specified", () => {
  assert(Object.isFrozen(PORTFOLIO_UPDATE_ROUTE));
  assertEquals(PORTFOLIO_UPDATE_ROUTE.id, "portfolios.update");
  assertEquals(PORTFOLIO_UPDATE_ROUTE.method, "PATCH");
  assertEquals(PORTFOLIO_UPDATE_ROUTE.path, "/v1/portfolios/:portfolioid");
  assertEquals(PORTFOLIO_UPDATE_ROUTE.operation, "mutation");
});

Deno.test("Portfolio-5B: the command is registered exactly once", () => {
  const byId = API_V1_ROUTE_ALLOWLIST.filter(
    (r) => r.id === "portfolios.update",
  );
  assertEquals(byId.length, 1);
  assertEquals(byId[0], PORTFOLIO_UPDATE_ROUTE);
  assertEquals(
    API_V1_ROUTE_ALLOWLIST.filter((r) => r === PORTFOLIO_UPDATE_ROUTE).length,
    1,
  );
});

Deno.test("Portfolio-5B: no other PATCH Portfolio surface exists", () => {
  const patched = API_V1_ROUTE_ALLOWLIST.filter(
    (r) => r.path.startsWith("/v1/portfolios") && r.method === "PATCH",
  );
  assertEquals(patched.length, 1);
  assertEquals(patched[0].id, "portfolios.update");
});

Deno.test("Portfolio-5B: /v1/capabilities advertises portfolios.update exactly once", () => {
  const advertised = buildCapabilitiesPayload()
    .supportedOperations as readonly string[];
  assertEquals(advertised.filter((id) => id === "portfolios.update").length, 1);
});

Deno.test("Portfolio-5B: only an exact PATCH /v1/portfolios/<uuid> matches", () => {
  assertEquals(
    matchApiRoute("PATCH", `/v1/portfolios/${PORTFOLIO_ID}`),
    PORTFOLIO_UPDATE_ROUTE,
  );
  for (const method of ["POST", "PUT", "DELETE", "HEAD", "patch"]) {
    assertEquals(
      matchApiRoute(method, `/v1/portfolios/${PORTFOLIO_ID}`),
      null,
      method,
    );
  }
  for (
    const path of [
      "/v1/portfolios",
      "/v1/portfolios/",
      `/v1/portfolios/${NIL_UUID}`,
      `/v1/portfolios/${PORTFOLIO_ID}/`,
      `/v1/portfolios/${PORTFOLIO_ID}/projects`,
      `/v1/portfolios/${PORTFOLIO_ID}/archive`,
      "/v1/portfolios/not-a-uuid",
    ]
  ) {
    assertEquals(matchApiRoute("PATCH", path), null, path);
  }
});

// ---------------------------------------------------------------------------
// B. Strict path parsing
// ---------------------------------------------------------------------------

Deno.test("Portfolio-5B: the path parser accepts only one non-nil Portfolio UUID", () => {
  const parsed = parseApiV1PortfolioUpdatePath(
    `/v1/portfolios/${PORTFOLIO_ID}`,
  );
  assertEquals(parsed.portfolioId, PORTFOLIO_ID);
  assert(Object.isFrozen(parsed));

  for (
    const path of [
      "/v1/portfolios",
      "/v1/portfolios/",
      `/v1/portfolios/${NIL_UUID}`,
      `/v1/portfolios/${PORTFOLIO_ID}/`,
      `/v1/portfolios/${PORTFOLIO_ID}/projects`,
      `/v1/portfolios/${PORTFOLIO_ID}%2Fprojects`,
      `/v1/portfolios/${PORTFOLIO_ID};v=1`,
      `/v1/portfolios/${PORTFOLIO_ID}?x=1`,
      `/v1/portfolios/${PORTFOLIO_ID}#f`,
      `/v1/portfolios/ ${PORTFOLIO_ID}`,
      "/v1/portfolios/*",
      "/v1/PORTFOLIOS/" + PORTFOLIO_ID,
    ]
  ) {
    assertThrows(
      () => parseApiV1PortfolioUpdatePath(path),
      ApiHttpError,
      undefined,
      path,
    );
  }
});

// ---------------------------------------------------------------------------
// C. Strict closed-schema body parsing with PATCH presence semantics
// ---------------------------------------------------------------------------

Deno.test("Portfolio-5B: a single-field update materializes exact presence flags", () => {
  const body = parseApiV1UpdatePortfolioBody({
    expectedUpdatedAt: TS,
    name: "  Growth Portfolio  ",
  });
  assertEquals(body, {
    expectedUpdatedAt: TS,
    name: "Growth Portfolio",
    setName: true,
    code: null,
    setCode: false,
    description: null,
    setDescription: false,
    lifecycleState: null,
    setLifecycleState: false,
    strategicPriority: null,
    setStrategicPriority: false,
    ownerId: null,
    setOwnerId: false,
  });
  assert(Object.isFrozen(body));
});

Deno.test("Portfolio-5B: explicit clears are distinguished from absence", () => {
  const cleared = parseApiV1UpdatePortfolioBody({
    expectedUpdatedAt: TS,
    code: null,
    description: null,
    ownerId: null,
  });
  assertEquals(cleared.setCode, true);
  assertEquals(cleared.code, null);
  assertEquals(cleared.setDescription, true);
  assertEquals(cleared.description, null);
  assertEquals(cleared.setOwnerId, true);
  assertEquals(cleared.ownerId, null);

  const absent = parseApiV1UpdatePortfolioBody({
    expectedUpdatedAt: TS,
    name: "P",
  });
  assertEquals(absent.setCode, false);
  assertEquals(absent.setDescription, false);
  assertEquals(absent.setOwnerId, false);
});

Deno.test("Portfolio-5B: clearable text is preserved exactly, including empty strings", () => {
  const body = parseApiV1UpdatePortfolioBody({
    expectedUpdatedAt: TS,
    code: "  gRoWtH-01  ",
    description: "",
    lifecycleState: "development",
    strategicPriority: "critical",
    ownerId: OWNER_ID,
  });
  assertEquals(body.code, "  gRoWtH-01  ");
  assertEquals(body.description, "");
  assertEquals(body.lifecycleState, "development");
  assertEquals(body.strategicPriority, "critical");
  assertEquals(body.ownerId, OWNER_ID);
});

Deno.test("Portfolio-5B: expectedUpdatedAt is mandatory and at least one mutable field is required", () => {
  assertThrows(
    () => parseApiV1UpdatePortfolioBody({ name: "P" }),
    ApiHttpError,
  );
  assertThrows(
    () => parseApiV1UpdatePortfolioBody({ expectedUpdatedAt: TS }),
    ApiHttpError,
  );
});

Deno.test("Portfolio-5B: unknown keys, aliases and escalation fields are rejected", () => {
  for (
    const extra of [
      { organizationId: PORTFOLIO_ID },
      { workspaceId: PORTFOLIO_ID },
      { tenantId: PORTFOLIO_ID },
      { portfolioId: PORTFOLIO_ID },
      { isArchived: true },
      { archivedAt: TS },
      { expected_updated_at: TS },
      { lifecycle_state: "development" },
      { strategic_priority: "high" },
      { owner_id: OWNER_ID },
      { members: [] },
    ]
  ) {
    assertThrows(
      () =>
        parseApiV1UpdatePortfolioBody({
          expectedUpdatedAt: TS,
          name: "P",
          ...extra,
        }),
      ApiHttpError,
      undefined,
      Object.keys(extra)[0],
    );
  }
});

Deno.test("Portfolio-5B: invalid values, bounds and non-clearable nulls are rejected", () => {
  const invalid: unknown[] = [
    null,
    [],
    "x",
    {},
    { expectedUpdatedAt: TS, name: null },
    { expectedUpdatedAt: TS, name: "" },
    { expectedUpdatedAt: TS, name: "   " },
    { expectedUpdatedAt: TS, name: 5 },
    { expectedUpdatedAt: TS, name: "x".repeat(201) },
    { expectedUpdatedAt: TS, code: "c".repeat(81) },
    { expectedUpdatedAt: TS, code: 5 },
    { expectedUpdatedAt: TS, description: "d".repeat(4001) },
    { expectedUpdatedAt: TS, lifecycleState: null },
    { expectedUpdatedAt: TS, lifecycleState: "archived" },
    { expectedUpdatedAt: TS, strategicPriority: null },
    { expectedUpdatedAt: TS, strategicPriority: "urgent" },
    { expectedUpdatedAt: TS, ownerId: NIL_UUID },
    { expectedUpdatedAt: TS, ownerId: "nope" },
    { expectedUpdatedAt: "2026-03-01T10:20:30", name: "P" },
    { expectedUpdatedAt: "2026-13-01T10:20:30Z", name: "P" },
    { expectedUpdatedAt: "2026-02-30T10:20:30Z", name: "P" },
    { expectedUpdatedAt: 5, name: "P" },
    { expectedUpdatedAt: null, name: "P" },
  ];
  for (const raw of invalid) {
    assertThrows(
      () => parseApiV1UpdatePortfolioBody(raw),
      ApiHttpError,
      undefined,
      JSON.stringify(raw),
    );
  }
});

Deno.test("Portfolio-5B: every canonical lifecycle and priority value round-trips", () => {
  for (
    const lifecycleState of [
      "opportunity_candidate",
      "business_case_approved",
      "contracted",
      "development",
      "submission_approval",
      "launch_preparation",
      "launched_commercial",
      "lcm_optimization",
      "on_hold",
      "discontinuation",
      "retired",
    ]
  ) {
    const body = parseApiV1UpdatePortfolioBody({
      expectedUpdatedAt: TS,
      lifecycleState,
    });
    assertEquals(body.lifecycleState, lifecycleState);
    assertEquals(body.setLifecycleState, true);
  }
  for (
    const strategicPriority of [
      "critical",
      "high",
      "medium",
      "low",
      "watchlist",
    ]
  ) {
    const body = parseApiV1UpdatePortfolioBody({
      expectedUpdatedAt: TS,
      strategicPriority,
    });
    assertEquals(body.strategicPriority, strategicPriority);
    assertEquals(body.setStrategicPriority, true);
  }
});

// ---------------------------------------------------------------------------
// D. Deterministic canonical idempotency payload
// ---------------------------------------------------------------------------

Deno.test("Portfolio-5B: the idempotency payload folds in the URL-borne Portfolio identity", () => {
  const body = parseApiV1UpdatePortfolioBody({
    expectedUpdatedAt: TS,
    name: "P",
  });
  const payload = buildApiV1UpdatePortfolioIdempotencyPayload(
    PORTFOLIO_ID,
    body,
  );
  assertEquals(payload.portfolioId, PORTFOLIO_ID);
  assertEquals(payload.expectedUpdatedAt, TS);
  assertEquals(Object.keys(payload).sort(), [
    "code",
    "description",
    "expectedUpdatedAt",
    "lifecycleState",
    "name",
    "ownerId",
    "portfolioId",
    "setCode",
    "setDescription",
    "setLifecycleState",
    "setName",
    "setOwnerId",
    "setStrategicPriority",
    "strategicPriority",
  ]);
});

Deno.test("Portfolio-5B: an omitted clearable value never hashes like an explicit clear", () => {
  const omitted = buildApiV1UpdatePortfolioIdempotencyPayload(
    PORTFOLIO_ID,
    parseApiV1UpdatePortfolioBody({ expectedUpdatedAt: TS, name: "P" }),
  );
  const cleared = buildApiV1UpdatePortfolioIdempotencyPayload(
    PORTFOLIO_ID,
    parseApiV1UpdatePortfolioBody({
      expectedUpdatedAt: TS,
      name: "P",
      description: null,
    }),
  );
  assertEquals(omitted.description, null);
  assertEquals(cleared.description, null);
  assertEquals(omitted.setDescription, false);
  assertEquals(cleared.setDescription, true);
  assert(JSON.stringify(omitted) !== JSON.stringify(cleared));
});

Deno.test("Portfolio-5B: the idempotency payload carries no request, user or OAuth metadata", () => {
  const payload = buildApiV1UpdatePortfolioIdempotencyPayload(
    PORTFOLIO_ID,
    parseApiV1UpdatePortfolioBody({ expectedUpdatedAt: TS, name: "P" }),
  );
  const serialized = JSON.stringify(payload).toLowerCase();
  for (
    const forbidden of [
      "requestid",
      "correlationid",
      "idempotencykey",
      "payloadhash",
      "userid",
      "oauth",
      "tenant",
      "organization",
      "token",
    ]
  ) {
    assert(!serialized.includes(forbidden), forbidden);
  }
});

// ---------------------------------------------------------------------------
// E. Explicit RPC adapter contract
// ---------------------------------------------------------------------------

function captureRpc(result: unknown) {
  const calls: Array<{ name: string; args: ApiV1UpdatePortfolioRpcArgs }> = [];
  return {
    calls,
    client: {
      rpc: (name: string, args: ApiV1UpdatePortfolioRpcArgs) => {
        calls.push({ name, args });
        return Promise.resolve({ data: result, error: null });
      },
    },
  };
}

const ADAPTER_INPUT = Object.freeze({
  expectedOauthClientId: "astra-client",
  portfolioId: PORTFOLIO_ID,
  expectedUpdatedAt: TS,
  name: "Growth Portfolio",
  setName: true,
  code: null,
  setCode: true,
  description: "notes",
  setDescription: true,
  lifecycleState: "development",
  setLifecycleState: true,
  strategicPriority: "high",
  setStrategicPriority: true,
  ownerId: null,
  setOwnerId: true,
  requestId: "req-1",
  correlationId: "corr-1",
  idempotencyKey: "key-1",
  payloadHash: HASH,
});

Deno.test("Portfolio-5B: the adapter calls api_v1_update_portfolio exactly once with the accepted 19 arguments", async () => {
  const rpc = captureRpc({
    ok: true,
    outcome: "applied",
    portfolioId: PORTFOLIO_ID,
    updatedAt: TS,
  });
  const result = await updateApiV1Portfolio(rpc.client, ADAPTER_INPUT);
  assertEquals(rpc.calls.length, 1);
  assertEquals(rpc.calls[0].name, "api_v1_update_portfolio");
  assertEquals(rpc.calls[0].args, {
    _expected_oauth_client_id: "astra-client",
    _portfolio_item_id: PORTFOLIO_ID,
    _expected_updated_at: TS,
    _name: "Growth Portfolio",
    _set_name: true,
    _code: null,
    _set_code: true,
    _description: "notes",
    _set_description: true,
    _lifecycle_state: "development",
    _set_lifecycle_state: true,
    _strategic_priority: "high",
    _set_strategic_priority: true,
    _owner_id: null,
    _set_owner_id: true,
    _request_id: "req-1",
    _correlation_id: "corr-1",
    _idempotency_key: "key-1",
    _payload_hash: HASH,
  });
  assertEquals(result, {
    ok: true,
    outcome: "applied",
    portfolioId: PORTFOLIO_ID,
    updatedAt: TS,
  });
});

Deno.test("Portfolio-5B: the adapter fails closed on inconsistent presence pairing", async () => {
  for (
    const override of [
      { setName: false, name: "P" },
      { setCode: false, code: "C" },
      { setDescription: false, description: "D" },
      { setLifecycleState: true, lifecycleState: null },
      { setStrategicPriority: true, strategicPriority: null },
      { setName: true, name: null },
      { setLifecycleState: true, lifecycleState: "archived" },
    ]
  ) {
    const rpc = captureRpc({
      ok: true,
      outcome: "applied",
      portfolioId: PORTFOLIO_ID,
      updatedAt: TS,
    });
    await assertRejects(
      () =>
        updateApiV1Portfolio(rpc.client, { ...ADAPTER_INPUT, ...override }),
      ApiHttpError,
    );
    assertEquals(rpc.calls.length, 0);
  }
});

Deno.test("Portfolio-5B: the adapter accepts only the bounded result shapes", async () => {
  const conflict = captureRpc({
    ok: false,
    outcome: "conflict",
    code: "stale_portfolio",
  });
  assertEquals(await updateApiV1Portfolio(conflict.client, ADAPTER_INPUT), {
    ok: false,
    outcome: "conflict",
    code: "stale_portfolio",
  });

  for (
    const outcome of [
      "invalid",
      "not_authorized",
      "idempotency_conflict",
      "idempotency_pending",
    ] as const
  ) {
    const rpc = captureRpc({ ok: false, outcome });
    assertEquals(await updateApiV1Portfolio(rpc.client, ADAPTER_INPUT), {
      ok: false,
      outcome,
    });
  }

  for (
    const bad of [
      null,
      "applied",
      { ok: true, outcome: "applied", portfolioId: PORTFOLIO_ID },
      {
        ok: true,
        outcome: "applied",
        portfolioId: PORTFOLIO_ID,
        updatedAt: TS,
        currentUpdatedAt: TS,
      },
      { ok: true, outcome: "no_change", portfolioId: PORTFOLIO_ID, updatedAt: TS },
      { ok: false, outcome: "conflict", code: "stale_program" },
      { ok: false, outcome: "conflict", code: "stale_portfolio", currentUpdatedAt: TS },
      { ok: false, outcome: "boom" },
    ]
  ) {
    const rpc = captureRpc(bad);
    await assertRejects(
      () => updateApiV1Portfolio(rpc.client, ADAPTER_INPUT),
      ApiHttpError,
      undefined,
      JSON.stringify(bad),
    );
  }
});

// ---------------------------------------------------------------------------
// F. Caller-bound delegated executor
// ---------------------------------------------------------------------------

const AUTH_USER_ID = "55555555-5555-4555-8555-555555555555";
const AUTH_API_CLIENT_ID = "66666666-6666-4666-8666-666666666666";
const AUTH_POLICY_VERSION_ID = "77777777-7777-4777-8777-777777777777";
const AUTH_OAUTH_CLIENT_ID = "astra-client";

const AUTH_CONTEXT = Object.freeze({
  token: Object.freeze({
    userId: AUTH_USER_ID,
    clientId: AUTH_OAUTH_CLIENT_ID,
  }),
  client: Object.freeze({
    userId: AUTH_USER_ID,
    apiClientId: AUTH_API_CLIENT_ID,
    oauthClientId: AUTH_OAUTH_CLIENT_ID,
    policyVersionId: AUTH_POLICY_VERSION_ID,
  }),
});

const EXECUTION_CONTEXT = Object.freeze({
  requestedUserId: AUTH_USER_ID,
  executingUserId: AUTH_USER_ID,
  apiClientId: AUTH_API_CLIENT_ID,
  oauthClientId: AUTH_OAUTH_CLIENT_ID,
  policyVersionId: AUTH_POLICY_VERSION_ID,
  requestId: "req-9",
  correlationId: "corr-9",
  idempotencyKey: "key-9",
  payloadHash: HASH,
  sourceChannel: "external_api",
  sourceClientId: AUTH_API_CLIENT_ID,
  delegationMode: "delegated_user",
});

function updateRequest(path = `/v1/portfolios/${PORTFOLIO_ID}`): Request {
  return new Request(`https://api.example.test${path}`, {
    method: "PATCH",
    headers: {
      Authorization: "Bearer caller-token",
      "Idempotency-Key": "portfolio-5b-key-1",
    },
    body: "{}",
  });
}

Deno.test("Portfolio-5B: the delegated update executor is caller-bound and identity-consistent", async () => {
  const factoryCalls: Array<{ url: string; key: string; auth: string }> = [];
  const rpcCalls: string[] = [];
  const createClient = (
    url: string,
    key: string,
    options: { global: { headers: { Authorization: string } } },
  ) => {
    factoryCalls.push({
      url,
      key,
      auth: options.global.headers.Authorization,
    });
    return {
      rpc: (name: string) => {
        rpcCalls.push(name);
        return Promise.resolve({
          data: {
            ok: true,
            outcome: "applied",
            portfolioId: PORTFOLIO_ID,
            updatedAt: TS,
          },
          error: null,
        });
      },
    };
  };

  const executor = createDelegatedApiV1UpdatePortfolioExecutor(
    "https://project.supabase.test",
    "anon-key",
    // deno-lint-ignore no-explicit-any
    createClient as any,
  );

  const body = parseApiV1UpdatePortfolioBody({
    expectedUpdatedAt: TS,
    name: "Growth Portfolio",
  });
  const result = await executor(
    updateRequest(),
    // deno-lint-ignore no-explicit-any
    AUTH_CONTEXT as any,
    PORTFOLIO_ID,
    body,
    // deno-lint-ignore no-explicit-any
    EXECUTION_CONTEXT as any,
  );

  assertEquals(result, {
    ok: true,
    outcome: "applied",
    portfolioId: PORTFOLIO_ID,
    updatedAt: TS,
  });
  assertEquals(factoryCalls.length, 1);
  assertEquals(factoryCalls[0].url, "https://project.supabase.test");
  assertEquals(factoryCalls[0].key, "anon-key");
  assertEquals(factoryCalls[0].auth, "Bearer caller-token");
  assertEquals(rpcCalls, ["api_v1_update_portfolio"]);
});

Deno.test("Portfolio-5B: the delegated update executor fails closed on identity drift", async () => {
  const createClient = () => ({
    rpc: () =>
      Promise.resolve({
        data: {
          ok: true,
          outcome: "applied",
          portfolioId: PORTFOLIO_ID,
          updatedAt: TS,
        },
        error: null,
      }),
  });
  const executor = createDelegatedApiV1UpdatePortfolioExecutor(
    "https://project.supabase.test",
    "anon-key",
    // deno-lint-ignore no-explicit-any
    createClient as any,
  );
  const body = parseApiV1UpdatePortfolioBody({
    expectedUpdatedAt: TS,
    name: "P",
  });

  for (
    const drift of [
      { requestedUserId: OWNER_ID },
      { executingUserId: OWNER_ID },
      { apiClientId: OWNER_ID },
      { oauthClientId: "other-client" },
      { policyVersionId: OWNER_ID },
      { sourceChannel: "browser" },
      { delegationMode: "service_role" },
    ]
  ) {
    const err = await assertRejects(
      () =>
        executor(
          updateRequest(),
          // deno-lint-ignore no-explicit-any
          AUTH_CONTEXT as any,
          PORTFOLIO_ID,
          body,
          // deno-lint-ignore no-explicit-any
          { ...EXECUTION_CONTEXT, ...drift } as any,
        ),
      ApiHttpError,
      undefined,
      Object.keys(drift)[0],
    );
    assertEquals(err.code, "internal_error");
  }
});

// ---------------------------------------------------------------------------
// G. Runtime execution contract
// ---------------------------------------------------------------------------

const ENABLED_CONTROLS = parseApiRuntimeControls({
  BTPM_API_ENABLED: "true",
  BTPM_API_READS_ENABLED: "true",
  BTPM_API_MUTATIONS_ENABLED: "true",
});

function portfolioDeps(result: unknown) {
  const order: string[] = [];
  const counters = { update: 0, create: 0, authenticate: 0, authorize: 0 };
  const captured: Array<{ portfolioId: string; body: unknown }> = [];
  return {
    order,
    counters,
    captured,
    deps: {
      authenticate: () => {
        counters.authenticate++;
        order.push("authenticate");
        return Promise.resolve(AUTH_CONTEXT);
      },
      authorizeRoute: () => {
        counters.authorize++;
        order.push("authorizeRoute");
        return Promise.resolve();
      },
      resolveRateLimitProfile: () =>
        Promise.resolve({ limit: 1000, windowSeconds: 60 }),
      rateLimit: {
        store: {
          consume: () => {
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
      createPortfolio: () => {
        counters.create++;
        return Promise.reject(new Error("create must never run here"));
      },
      // API-Q Portfolio-6B — present only so the shared Portfolio dependency
      // contract is satisfied; it must never run on the update path.
      assignProjectPortfolio: () =>
        Promise.reject(new Error("assign must never run here")),
      updatePortfolio: (
        _request: Request,
        _context: unknown,
        portfolioId: string,
        body: unknown,
      ) => {
        counters.update++;
        order.push("updatePortfolio");
        captured.push({ portfolioId, body });
        return Promise.resolve(result);
      },
      // deno-lint-ignore no-explicit-any
    } as any,
  };
}

function rawUpdateBody(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return { expectedUpdatedAt: TS, name: "Growth Portfolio", ...overrides };
}

Deno.test("Portfolio-5B: order is authenticate → authorizeRoute → rateLimit → updatePortfolio exactly once", async () => {
  const applied = {
    ok: true,
    outcome: "applied",
    portfolioId: PORTFOLIO_ID,
    updatedAt: TS,
  } as const;
  const d = portfolioDeps(applied);
  const ok = await executeApiUpdatePortfolioRoute(
    updateRequest(),
    rawUpdateBody(),
    "req-1",
    ENABLED_CONTROLS,
    d.deps,
  );
  assertEquals(ok.route, PORTFOLIO_UPDATE_ROUTE);
  assertEquals(ok.status, 200);
  assertEquals(ok.payload, applied);
  assertEquals(d.order, [
    "authenticate",
    "authorizeRoute",
    "rateLimit",
    "updatePortfolio",
  ]);
  assertEquals(d.counters.update, 1);
  assertEquals(d.counters.create, 0);
  assertEquals(d.captured[0].portfolioId, PORTFOLIO_ID);
});

Deno.test("Portfolio-5B: replayed remains HTTP 200", async () => {
  for (const outcome of ["applied", "replayed"] as const) {
    const payload = {
      ok: true,
      outcome,
      portfolioId: PORTFOLIO_ID,
      updatedAt: TS,
    } as const;
    const d = portfolioDeps(payload);
    const ok = await executeApiUpdatePortfolioRoute(
      updateRequest(),
      rawUpdateBody(),
      "req-2",
      ENABLED_CONTROLS,
      d.deps,
    );
    assertEquals(ok.status, 200);
    assertEquals(ok.payload, payload);
    assertEquals(d.counters.update, 1);
  }
});

Deno.test("Portfolio-5B: a dependency object missing either Portfolio executor fails closed", async () => {
  for (const drop of ["createPortfolio", "updatePortfolio"] as const) {
    const d = portfolioDeps({
      ok: true,
      outcome: "applied",
      portfolioId: PORTFOLIO_ID,
      updatedAt: TS,
    });
    const deps = { ...(d.deps as Record<string, unknown>) };
    delete deps[drop];
    const err = await assertRejects(
      () =>
        executeApiUpdatePortfolioRoute(
          updateRequest(),
          rawUpdateBody(),
          "req-3",
          ENABLED_CONTROLS,
          // deno-lint-ignore no-explicit-any
          deps as any,
        ),
      ApiHttpError,
    );
    assertEquals(err.code, "internal_error");
    assertEquals(d.counters.update, 0);
    assertEquals(d.counters.authenticate, 0);
  }
});

Deno.test("Portfolio-5B: mutation-disabled controls fail closed before updatePortfolio", async () => {
  for (
    const env of [
      {
        BTPM_API_ENABLED: "true",
        BTPM_API_READS_ENABLED: "true",
        BTPM_API_MUTATIONS_ENABLED: "false",
      },
      {
        BTPM_API_ENABLED: "false",
        BTPM_API_READS_ENABLED: "true",
        BTPM_API_MUTATIONS_ENABLED: "true",
      },
    ]
  ) {
    const d = portfolioDeps({
      ok: true,
      outcome: "applied",
      portfolioId: PORTFOLIO_ID,
      updatedAt: TS,
    });
    await assertRejects(
      () =>
        executeApiUpdatePortfolioRoute(
          updateRequest(),
          rawUpdateBody(),
          "req-4",
          parseApiRuntimeControls(env),
          d.deps,
        ),
      ApiHttpError,
    );
    assertEquals(d.counters.update, 0);
    assertEquals(d.counters.authenticate, 0);
  }
});

Deno.test("Portfolio-5B: an invalid body or path fails closed before authentication", async () => {
  const badBody = portfolioDeps({
    ok: true,
    outcome: "applied",
    portfolioId: PORTFOLIO_ID,
    updatedAt: TS,
  });
  await assertRejects(
    () =>
      executeApiUpdatePortfolioRoute(
        updateRequest(),
        { expectedUpdatedAt: TS },
        "req-5",
        ENABLED_CONTROLS,
        badBody.deps,
      ),
    ApiHttpError,
  );
  assertEquals(badBody.counters.authenticate, 0);
  assertEquals(badBody.counters.update, 0);

  const badPath = portfolioDeps({
    ok: true,
    outcome: "applied",
    portfolioId: PORTFOLIO_ID,
    updatedAt: TS,
  });
  await assertRejects(
    () =>
      executeApiUpdatePortfolioRoute(
        updateRequest(`/v1/portfolios/${NIL_UUID}`),
        rawUpdateBody(),
        "req-6",
        ENABLED_CONTROLS,
        badPath.deps,
      ),
    ApiHttpError,
  );
  assertEquals(badPath.counters.authenticate, 0);
  assertEquals(badPath.counters.update, 0);
});

Deno.test("Portfolio-5B: conflict maps to concurrency_conflict without exposing stale_portfolio", async () => {
  const d = portfolioDeps({
    ok: false,
    outcome: "conflict",
    code: "stale_portfolio",
  });
  const err = await assertRejects(
    () =>
      executeApiUpdatePortfolioRoute(
        updateRequest(),
        rawUpdateBody(),
        "req-7",
        ENABLED_CONTROLS,
        d.deps,
      ),
    ApiHttpError,
  );
  assertEquals(err.code, "concurrency_conflict");
  assert(!err.message.includes("stale_portfolio"));
});

Deno.test("Portfolio-5B: every negative outcome maps to its own bounded error code", async () => {
  const expected: ReadonlyArray<readonly [string, string]> = [
    ["invalid", "invalid_request"],
    ["not_authorized", "not_authorized"],
    ["idempotency_conflict", "idempotency_conflict"],
    ["idempotency_pending", "idempotency_pending"],
  ];
  for (const [outcome, code] of expected) {
    const d = portfolioDeps({ ok: false, outcome });
    const err = await assertRejects(
      () =>
        executeApiUpdatePortfolioRoute(
          updateRequest(),
          rawUpdateBody(),
          "req-8",
          ENABLED_CONTROLS,
          d.deps,
        ),
      ApiHttpError,
      undefined,
      outcome,
    );
    assertEquals(err.code, code);
  }
});

// ---------------------------------------------------------------------------
// H. Architecture guards
// ---------------------------------------------------------------------------

Deno.test("Portfolio-5B: the runtime keeps exactly one Portfolio mutation dependency contract", async () => {
  const router = await readSource("../router.ts");
  assert(
    router.includes("export interface ApiPortfolioMutationRouteDependencies"),
  );
  assert(!router.includes("ApiPortfolioUpdateRouteDependencies"));
  assert(!router.includes("validatePortfolioUpdateDependencies"));
  assert(
    router.includes("export async function executeApiCreatePortfolioRoute"),
  );
  assert(
    router.includes("export async function executeApiUpdatePortfolioRoute"),
  );

  const handler = await readSource("../handler.ts");
  assert(handler.includes("deps.portfolioMutationRoute"));
  assert(!handler.includes("deps.portfolioUpdateRoute"));

  const index = await readSource("../index.ts");
  assert(index.includes("portfolioMutationRoute"));
  assert(index.includes("updatePortfolio,"));
  assert(index.includes("createPortfolio,"));
});

Deno.test("Portfolio-5B: no privileged key, raw SQL or read-before-write exists on this path", async () => {
  for (
    const relative of [
      "../../_shared/btpm-api/routes/portfolios.ts",
      "../../_shared/btpm-api/supabasePortfolioMutation.ts",
      "../../_shared/btpm-api/supabaseDelegatedPortfolioMutation.ts",
    ]
  ) {
    const source = await readSource(relative);
    for (
      const forbidden of [
        "SUPABASE_SERVICE_ROLE_KEY",
        "service_role",
        "Deno.env",
        ".from(",
        "execute_sql",
      ]
    ) {
      assert(
        !source.includes(forbidden),
        `${relative} must not contain ${forbidden}`,
      );
    }
  }
});

Deno.test("Portfolio-5B: exactly one database wrapper name is reachable from the update adapter", async () => {
  const source = await readSource(
    "../../_shared/btpm-api/supabasePortfolioMutation.ts",
  );
  const occurrences = source.split('"api_v1_update_portfolio"').length - 1;
  assertEquals(occurrences, 1);
  assert(!source.includes("admin_update_portfolio_item"));
});
