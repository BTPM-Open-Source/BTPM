// API-Q Portfolio-6B — focused HTTP-surface contract test for the single
// external Project↔Portfolio assignment command.
//
// Scope is strictly local: the route contract, exact-once registration, strict
// path parsing, closed-schema body parsing and the canonical idempotency payload
// shape. No global cardinality or terminal allowlist position is asserted here
// (that is owned by api-v1-current-surface-topology.test.ts), and no business
// authority is re-implemented — `public.api_v1_assign_project_portfolio` remains
// the sole authority.

import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  API_V1_ROUTE_ALLOWLIST,
  executeApiAssignProjectPortfolioRoute,
  parseApiRuntimeControls,
} from "../router.ts";
import {
  PORTFOLIO_ASSIGN_PROJECT_ROUTE,
  buildApiV1AssignProjectPortfolioIdempotencyPayload,
  parseApiV1AssignProjectPortfolioBody,
  parseApiV1PortfolioAssignProjectPath,
} from "../../_shared/btpm-api/routes/portfolios.ts";
import { buildCapabilitiesPayload } from "../routes/capabilities.ts";
import {
  assignApiV1ProjectPortfolio,
  type ApiV1AssignProjectPortfolioRpcArgs,
} from "../../_shared/btpm-api/supabasePortfolioMutation.ts";
import { createDelegatedApiV1AssignProjectPortfolioExecutor } from "../../_shared/btpm-api/supabaseDelegatedPortfolioMutation.ts";
import { ApiHttpError } from "../../_shared/btpm-api/http.ts";


const PROJECT_ID = "1a1b1c1d-1111-4111-8111-1a1b1c1d1e1f";
const PORTFOLIO_ID = "2a2b2c2d-2222-4222-8222-2a2b2c2d2e2f";
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

Deno.test("Portfolio-6B: route contract is exactly PUT /v1/projects/:projectid/portfolio", () => {
  assertEquals(PORTFOLIO_ASSIGN_PROJECT_ROUTE.id, "portfolios.assign_project");
  assertEquals(PORTFOLIO_ASSIGN_PROJECT_ROUTE.method, "PUT");
  assertEquals(
    PORTFOLIO_ASSIGN_PROJECT_ROUTE.path,
    "/v1/projects/:projectid/portfolio",
  );
  assertEquals(PORTFOLIO_ASSIGN_PROJECT_ROUTE.operation, "mutation");
});

Deno.test("Portfolio-6B: the route is registered exactly once in the live allowlist", () => {
  const matches = API_V1_ROUTE_ALLOWLIST.filter(
    (route) => route.id === "portfolios.assign_project",
  );
  assertEquals(matches.length, 1);
  assertEquals(matches[0], PORTFOLIO_ASSIGN_PROJECT_ROUTE);
});

Deno.test("Portfolio-6B: path parser accepts exactly one canonical shape", () => {
  assertEquals(
    parseApiV1PortfolioAssignProjectPath(
      `/v1/projects/${PROJECT_ID}/portfolio`,
    ),
    { projectId: PROJECT_ID },
  );
});

Deno.test("Portfolio-6B: path parser rejects every non-canonical shape", () => {
  const rejected: readonly string[] = [
    "/v1/projects/portfolio",
    "/v1/projects//portfolio",
    `/v1/projects/${PROJECT_ID}`,
    `/v1/projects/${PROJECT_ID}/portfolio/`,
    `/v1/projects/${PROJECT_ID}/portfolio/extra`,
    `/v1/projects/${PROJECT_ID}/portfolios`,
    `/v1/projects/${NIL_UUID}/portfolio`,
    `/v1/projects/${PROJECT_ID}%2Fportfolio`,
    `/v1/projects/${PROJECT_ID};v=1/portfolio`,
    `/v1/projects/ ${PROJECT_ID}/portfolio`,
    `/V1/projects/${PROJECT_ID}/portfolio`,
    `/v1/PROJECTS/${PROJECT_ID}/portfolio`,
    "/v1/projects/not-a-uuid/portfolio",
    `/v1/tasks/${PROJECT_ID}/portfolio`,
  ];
  for (const pathname of rejected) {
    assertThrows(
      () => parseApiV1PortfolioAssignProjectPath(pathname),
      ApiHttpError,
    );
  }
});

Deno.test("Portfolio-6B: body parser accepts an assignment and an explicit clear", () => {
  assertEquals(
    parseApiV1AssignProjectPortfolioBody({ portfolioId: PORTFOLIO_ID }),
    { portfolioId: PORTFOLIO_ID },
  );
  assertEquals(
    parseApiV1AssignProjectPortfolioBody({ portfolioId: null }),
    { portfolioId: null },
  );
});

Deno.test("Portfolio-6B: body parser is closed-schema and requires portfolioId", () => {
  const rejected: readonly unknown[] = [
    {},
    { portfolioId: undefined },
    { portfolioId: PORTFOLIO_ID, expectedUpdatedAt: "2026-01-01T00:00:00Z" },
    { portfolioId: PORTFOLIO_ID, projectId: PROJECT_ID },
    { portfolioId: PORTFOLIO_ID, organizationId: PORTFOLIO_ID },
    { portfolio_id: PORTFOLIO_ID },
    { portfolioId: NIL_UUID },
    { portfolioId: "not-a-uuid" },
    { portfolioId: 1 },
    { portfolioId: false },
    { portfolioId: [PORTFOLIO_ID] },
    { portfolioId: { id: PORTFOLIO_ID } },
    null,
    undefined,
    [],
    "portfolioId",
    42,
  ];
  for (const body of rejected) {
    assertThrows(
      () => parseApiV1AssignProjectPortfolioBody(body),
      ApiHttpError,
    );
  }
});

Deno.test("Portfolio-6B: idempotency payload is the exact canonical shape", () => {
  const assigned = buildApiV1AssignProjectPortfolioIdempotencyPayload(
    PROJECT_ID,
    parseApiV1AssignProjectPortfolioBody({ portfolioId: PORTFOLIO_ID }),
  );
  assertEquals(Object.keys(assigned).sort(), ["portfolioId", "projectId"]);
  assertEquals(assigned, {
    projectId: PROJECT_ID,
    portfolioId: PORTFOLIO_ID,
  });

  const cleared = buildApiV1AssignProjectPortfolioIdempotencyPayload(
    PROJECT_ID,
    parseApiV1AssignProjectPortfolioBody({ portfolioId: null }),
  );
  assertEquals(cleared, { projectId: PROJECT_ID, portfolioId: null });
});

// ---------------------------------------------------------------------------
// Portfolio-6B-C1 — executable adapter, delegated executor and router pipeline
// coverage. Nothing below re-implements business authority: the accepted
// `public.api_v1_assign_project_portfolio` wrapper remains the sole authority.
// ---------------------------------------------------------------------------

const HASH = "a".repeat(64);
const OTHER_ID = "3a3b3c3d-3333-4333-8333-3a3b3c3d3e3f";

const ADAPTER_INPUT = Object.freeze({
  expectedOauthClientId: "astra-client",
  projectId: PROJECT_ID,
  portfolioId: PORTFOLIO_ID,
  requestId: "req-1",
  correlationId: "corr-1",
  idempotencyKey: "key-1",
  payloadHash: HASH,
});

function captureRpc(result: unknown, error: unknown = null) {
  const calls: Array<{
    name: string;
    args: ApiV1AssignProjectPortfolioRpcArgs;
  }> = [];
  return {
    calls,
    client: {
      rpc: (name: string, args: ApiV1AssignProjectPortfolioRpcArgs) => {
        calls.push({ name, args });
        return Promise.resolve({ data: result, error });
      },
    },
  };
}

Deno.test("Portfolio-6B-C1: the adapter calls api_v1_assign_project_portfolio exactly once with the accepted seven arguments", async () => {
  const rpc = captureRpc({
    ok: true,
    outcome: "applied",
    projectId: PROJECT_ID,
    oldPortfolioId: null,
    newPortfolioId: PORTFOLIO_ID,
  });
  const result = await assignApiV1ProjectPortfolio(rpc.client, ADAPTER_INPUT);
  assertEquals(rpc.calls.length, 1);
  assertEquals(rpc.calls[0].name, "api_v1_assign_project_portfolio");
  assertEquals(Object.keys(rpc.calls[0].args).sort(), [
    "_correlation_id",
    "_expected_oauth_client_id",
    "_idempotency_key",
    "_payload_hash",
    "_portfolio_item_id",
    "_project_id",
    "_request_id",
  ]);
  assertEquals(rpc.calls[0].args, {
    _expected_oauth_client_id: "astra-client",
    _project_id: PROJECT_ID,
    _portfolio_item_id: PORTFOLIO_ID,
    _request_id: "req-1",
    _correlation_id: "corr-1",
    _idempotency_key: "key-1",
    _payload_hash: HASH,
  });
  assertEquals(result, {
    ok: true,
    outcome: "applied",
    projectId: PROJECT_ID,
    oldPortfolioId: null,
    newPortfolioId: PORTFOLIO_ID,
  });
});

Deno.test("Portfolio-6B-C1: an explicit clear maps to a NULL _portfolio_item_id", async () => {
  const rpc = captureRpc({
    ok: true,
    outcome: "applied",
    projectId: PROJECT_ID,
    oldPortfolioId: PORTFOLIO_ID,
    newPortfolioId: null,
  });
  await assignApiV1ProjectPortfolio(rpc.client, {
    ...ADAPTER_INPUT,
    portfolioId: null,
  });
  assertEquals(rpc.calls.length, 1);
  assertEquals(rpc.calls[0].args._portfolio_item_id, null);
});

Deno.test("Portfolio-6B-C1: the adapter accepts every bounded success shape", async () => {
  for (const outcome of ["applied", "no_change", "replayed"] as const) {
    for (
      const [oldPortfolioId, newPortfolioId] of [
        [null, PORTFOLIO_ID],
        [PORTFOLIO_ID, null],
        [PORTFOLIO_ID, OTHER_ID],
        [null, null],
      ] as ReadonlyArray<readonly [string | null, string | null]>
    ) {
      const rpc = captureRpc({
        ok: true,
        outcome,
        projectId: PROJECT_ID,
        oldPortfolioId,
        newPortfolioId,
      });
      assertEquals(
        await assignApiV1ProjectPortfolio(rpc.client, ADAPTER_INPUT),
        {
          ok: true,
          outcome,
          projectId: PROJECT_ID,
          oldPortfolioId,
          newPortfolioId,
        },
      );
    }
  }
});

Deno.test("Portfolio-6B-C1: the adapter accepts every bounded negative shape", async () => {
  for (
    const outcome of [
      "invalid",
      "not_authorized",
      "idempotency_conflict",
      "idempotency_pending",
    ] as const
  ) {
    const rpc = captureRpc({ ok: false, outcome });
    assertEquals(
      await assignApiV1ProjectPortfolio(rpc.client, ADAPTER_INPUT),
      { ok: false, outcome },
    );
  }
});

Deno.test("Portfolio-6B-C1: malformed wrapper output fails closed", async () => {
  const malformed: readonly unknown[] = [
    null,
    "applied",
    [],
    {},
    { outcome: "applied" },
    // missing success field
    { ok: true, outcome: "applied", projectId: PROJECT_ID, oldPortfolioId: null },
    // extra success field
    {
      ok: true,
      outcome: "applied",
      projectId: PROJECT_ID,
      oldPortfolioId: null,
      newPortfolioId: PORTFOLIO_ID,
      updatedAt: "2026-03-01T10:20:30.123456+00:00",
    },
    // invalid outcome
    {
      ok: true,
      outcome: "conflict",
      projectId: PROJECT_ID,
      oldPortfolioId: null,
      newPortfolioId: PORTFOLIO_ID,
    },
    // malformed Project UUID
    {
      ok: true,
      outcome: "applied",
      projectId: "not-a-uuid",
      oldPortfolioId: null,
      newPortfolioId: PORTFOLIO_ID,
    },
    {
      ok: true,
      outcome: "applied",
      projectId: NIL_UUID,
      oldPortfolioId: null,
      newPortfolioId: PORTFOLIO_ID,
    },
    // malformed Portfolio UUID
    {
      ok: true,
      outcome: "applied",
      projectId: PROJECT_ID,
      oldPortfolioId: "nope",
      newPortfolioId: PORTFOLIO_ID,
    },
    {
      ok: true,
      outcome: "applied",
      projectId: PROJECT_ID,
      oldPortfolioId: null,
      newPortfolioId: "nope",
    },
    // unexpected negative key / invalid negative outcome
    { ok: false, outcome: "invalid", detail: "why" },
    { ok: false, outcome: "conflict" },
    { ok: false, outcome: "boom" },
    { ok: false },
  ];
  for (const data of malformed) {
    const rpc = captureRpc(data);
    const err = await assertRejects(
      () => assignApiV1ProjectPortfolio(rpc.client, ADAPTER_INPUT),
      ApiHttpError,
      undefined,
      JSON.stringify(data),
    );
    assertEquals(err.code, "internal_error");
  }
});

Deno.test("Portfolio-6B-C1: SQLSTATE 42501 maps to not_authorized and other RPC errors to internal_error", async () => {
  const denied = captureRpc(null, { code: "42501", message: "denied" });
  const deniedErr = await assertRejects(
    () => assignApiV1ProjectPortfolio(denied.client, ADAPTER_INPUT),
    ApiHttpError,
  );
  assertEquals(deniedErr.code, "not_authorized");

  for (
    const error of [
      { code: "23505", message: "conflict" },
      { code: "P0001", message: "raise" },
      { message: "no code" },
    ]
  ) {
    const rpc = captureRpc(null, error);
    const err = await assertRejects(
      () => assignApiV1ProjectPortfolio(rpc.client, ADAPTER_INPUT),
      ApiHttpError,
    );
    assertEquals(err.code, "internal_error");
  }
});

// ---------------------------------------------------------------------------
// Caller-bound delegated executor
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

const APPLIED_ASSIGNMENT = Object.freeze({
  ok: true,
  outcome: "applied",
  projectId: PROJECT_ID,
  oldPortfolioId: null,
  newPortfolioId: PORTFOLIO_ID,
});

function assignRequest(
  path = `/v1/projects/${PROJECT_ID}/portfolio`,
): Request {
  return new Request(`https://api.example.test${path}`, {
    method: "PUT",
    headers: {
      Authorization: "Bearer caller-token",
      "Idempotency-Key": "portfolio-6b-key-1",
    },
    body: "{}",
  });
}

Deno.test("Portfolio-6B-C1: the delegated assignment executor is caller-bound and builds a fresh client per invocation", async () => {
  const factoryCalls: Array<
    { url: string; key: string; auth: string; auth0: unknown }
  > = [];
  const rpcCalls: string[] = [];
  const createClient = (
    url: string,
    key: string,
    options: {
      auth: Record<string, unknown>;
      global: { headers: { Authorization: string } };
    },
  ) => {
    factoryCalls.push({
      url,
      key,
      auth: options.global.headers.Authorization,
      auth0: options.auth,
    });
    return {
      rpc: (name: string) => {
        rpcCalls.push(name);
        return Promise.resolve({ data: APPLIED_ASSIGNMENT, error: null });
      },
    };
  };

  const executor = createDelegatedApiV1AssignProjectPortfolioExecutor(
    "https://project.supabase.test",
    "anon-key",
    // deno-lint-ignore no-explicit-any
    createClient as any,
  );

  const body = parseApiV1AssignProjectPortfolioBody({
    portfolioId: PORTFOLIO_ID,
  });
  for (const _run of [1, 2]) {
    const result = await executor(
      assignRequest(),
      // deno-lint-ignore no-explicit-any
      AUTH_CONTEXT as any,
      PROJECT_ID,
      body,
      // deno-lint-ignore no-explicit-any
      EXECUTION_CONTEXT as any,
    );
    assertEquals(result, APPLIED_ASSIGNMENT);
  }

  assertEquals(factoryCalls.length, 2);
  for (const call of factoryCalls) {
    assertEquals(call.url, "https://project.supabase.test");
    assertEquals(call.key, "anon-key");
    assertEquals(call.auth, "Bearer caller-token");
    assertEquals(call.auth0, {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    });
  }
  assertEquals(rpcCalls, [
    "api_v1_assign_project_portfolio",
    "api_v1_assign_project_portfolio",
  ]);
});

Deno.test("Portfolio-6B-C1: the delegated assignment executor fails closed on identity drift", async () => {
  let rpcCount = 0;
  const createClient = () => ({
    rpc: () => {
      rpcCount++;
      return Promise.resolve({ data: APPLIED_ASSIGNMENT, error: null });
    },
  });
  const executor = createDelegatedApiV1AssignProjectPortfolioExecutor(
    "https://project.supabase.test",
    "anon-key",
    // deno-lint-ignore no-explicit-any
    createClient as any,
  );
  const body = parseApiV1AssignProjectPortfolioBody({
    portfolioId: PORTFOLIO_ID,
  });

  for (
    const drift of [
      { requestedUserId: OTHER_ID },
      { executingUserId: OTHER_ID },
      { apiClientId: OTHER_ID },
      { oauthClientId: "other-client" },
      { policyVersionId: OTHER_ID },
      { sourceChannel: "browser" },
      { delegationMode: "service_role" },
    ]
  ) {
    const err = await assertRejects(
      () =>
        executor(
          assignRequest(),
          // deno-lint-ignore no-explicit-any
          AUTH_CONTEXT as any,
          PROJECT_ID,
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
  assertEquals(rpcCount, 0);
});

// ---------------------------------------------------------------------------
// Router pipeline
// ---------------------------------------------------------------------------

const ENABLED_CONTROLS = parseApiRuntimeControls({
  BTPM_API_ENABLED: "true",
  BTPM_API_READS_ENABLED: "true",
  BTPM_API_MUTATIONS_ENABLED: "true",
});

function assignDeps(result: unknown) {
  const order: string[] = [];
  const counters = {
    authenticate: 0,
    authorize: 0,
    assign: 0,
    create: 0,
    update: 0,
  };
  const captured: Array<{ projectId: string; body: unknown }> = [];
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
      // Harmless shared-contract stubs: neither may ever execute here.
      createPortfolio: () => {
        counters.create++;
        return Promise.reject(new Error("create must never run here"));
      },
      updatePortfolio: () => {
        counters.update++;
        return Promise.reject(new Error("update must never run here"));
      },
      assignProjectPortfolio: (
        _request: Request,
        _context: unknown,
        projectId: string,
        body: unknown,
      ) => {
        counters.assign++;
        order.push("assignProjectPortfolio");
        captured.push({ projectId, body });
        return Promise.resolve(result);
      },
      // deno-lint-ignore no-explicit-any
    } as any,
  };
}

Deno.test("Portfolio-6B-C1: order is authenticate → authorizeRoute → rateLimit → assignProjectPortfolio exactly once", async () => {
  const d = assignDeps(APPLIED_ASSIGNMENT);
  const ok = await executeApiAssignProjectPortfolioRoute(
    assignRequest(),
    { portfolioId: PORTFOLIO_ID },
    "req-1",
    ENABLED_CONTROLS,
    d.deps,
  );
  assertEquals(ok.route, PORTFOLIO_ASSIGN_PROJECT_ROUTE);
  assertEquals(ok.status, 200);
  assertEquals(ok.payload, APPLIED_ASSIGNMENT);
  assertEquals(d.order, [
    "authenticate",
    "authorizeRoute",
    "rateLimit",
    "assignProjectPortfolio",
  ]);
  assertEquals(d.counters.authenticate, 1);
  assertEquals(d.counters.authorize, 1);
  assertEquals(d.counters.assign, 1);
  assertEquals(d.counters.create, 0);
  assertEquals(d.counters.update, 0);
  assertEquals(d.captured.length, 1);
  assertEquals(d.captured[0].projectId, PROJECT_ID);
  assertEquals(d.captured[0].body, { portfolioId: PORTFOLIO_ID });
});

Deno.test("Portfolio-6B-C1: an explicit clear reaches the executor as portfolioId null", async () => {
  const cleared = {
    ok: true,
    outcome: "applied",
    projectId: PROJECT_ID,
    oldPortfolioId: PORTFOLIO_ID,
    newPortfolioId: null,
  } as const;
  const d = assignDeps(cleared);
  const ok = await executeApiAssignProjectPortfolioRoute(
    assignRequest(),
    { portfolioId: null },
    "req-2",
    ENABLED_CONTROLS,
    d.deps,
  );
  assertEquals(ok.status, 200);
  assertEquals(ok.payload, cleared);
  assertEquals(d.captured[0].body, { portfolioId: null });
});

Deno.test("Portfolio-6B-C1: applied, no_change and replayed are all HTTP 200", async () => {
  for (const outcome of ["applied", "no_change", "replayed"] as const) {
    const payload = {
      ok: true,
      outcome,
      projectId: PROJECT_ID,
      oldPortfolioId: null,
      newPortfolioId: PORTFOLIO_ID,
    } as const;
    const d = assignDeps(payload);
    const ok = await executeApiAssignProjectPortfolioRoute(
      assignRequest(),
      { portfolioId: PORTFOLIO_ID },
      "req-3",
      ENABLED_CONTROLS,
      d.deps,
    );
    assertEquals(ok.status, 200);
    assertEquals(ok.payload, payload);
    assertEquals(d.counters.assign, 1);
  }
});

Deno.test("Portfolio-6B-C1: every negative outcome maps to its own bounded error code and no concurrency_conflict path exists", async () => {
  const expected: ReadonlyArray<readonly [string, string]> = [
    ["invalid", "invalid_request"],
    ["not_authorized", "not_authorized"],
    ["idempotency_conflict", "idempotency_conflict"],
    ["idempotency_pending", "idempotency_pending"],
  ];
  for (const [outcome, code] of expected) {
    const d = assignDeps({ ok: false, outcome });
    const err = await assertRejects(
      () =>
        executeApiAssignProjectPortfolioRoute(
          assignRequest(),
          { portfolioId: PORTFOLIO_ID },
          "req-4",
          ENABLED_CONTROLS,
          d.deps,
        ),
      ApiHttpError,
      undefined,
      outcome,
    );
    assertEquals(err.code, code);
  }

  // There is deliberately no optimistic-concurrency token on this command, so a
  // conflict outcome is structurally unrepresentable and never mapped.
  const conflict = assignDeps({ ok: false, outcome: "conflict" });
  const err = await assertRejects(
    () =>
      executeApiAssignProjectPortfolioRoute(
        assignRequest(),
        { portfolioId: PORTFOLIO_ID },
        "req-5",
        ENABLED_CONTROLS,
        conflict.deps,
      ),
    ApiHttpError,
  );
  assertEquals(err.code, "internal_error");
});

Deno.test("Portfolio-6B-C1: a malformed path or body fails closed before authentication and assignment", async () => {
  const badBody = assignDeps(APPLIED_ASSIGNMENT);
  await assertRejects(
    () =>
      executeApiAssignProjectPortfolioRoute(
        assignRequest(),
        {},
        "req-6",
        ENABLED_CONTROLS,
        badBody.deps,
      ),
    ApiHttpError,
  );
  assertEquals(badBody.counters.authenticate, 0);
  assertEquals(badBody.counters.assign, 0);

  const badPath = assignDeps(APPLIED_ASSIGNMENT);
  await assertRejects(
    () =>
      executeApiAssignProjectPortfolioRoute(
        assignRequest(`/v1/projects/${NIL_UUID}/portfolio`),
        { portfolioId: PORTFOLIO_ID },
        "req-7",
        ENABLED_CONTROLS,
        badPath.deps,
      ),
    ApiHttpError,
  );
  assertEquals(badPath.counters.authenticate, 0);
  assertEquals(badPath.counters.assign, 0);
});

Deno.test("Portfolio-6B-C1: mutation-disabled controls fail closed before authentication and assignment", async () => {
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
    const d = assignDeps(APPLIED_ASSIGNMENT);
    await assertRejects(
      () =>
        executeApiAssignProjectPortfolioRoute(
          assignRequest(),
          { portfolioId: PORTFOLIO_ID },
          "req-8",
          parseApiRuntimeControls(env),
          d.deps,
        ),
      ApiHttpError,
    );
    assertEquals(d.counters.authenticate, 0);
    assertEquals(d.counters.assign, 0);
  }
});

// ---------------------------------------------------------------------------
// Capability advertisement (exact-once only; global cardinality lives in
// api-v1-current-surface-topology.test.ts)
// ---------------------------------------------------------------------------

Deno.test("Portfolio-6B-C1: /v1/capabilities advertises portfolios.assign_project exactly once", () => {
  const advertised = buildCapabilitiesPayload()
    .supportedOperations as readonly string[];
  assertEquals(
    advertised.filter((id) => id === "portfolios.assign_project").length,
    1,
  );
});
