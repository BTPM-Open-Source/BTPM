// API-N.5-C4 — focused behavioural contract coverage for the single accepted
// external Project command: POST /v1/projects (projects:create).
//
// These tests exercise the committed production parser, route pipeline and
// delegated caller-bound adapter with injected deterministic dependencies.
// No environment variable, network call, live Supabase client, OAuth flow or
// service-role credential is touched, and no production module is modified.

import {
  assert,
  assertEquals,
  assertNotEquals,
  assertRejects,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ApiHttpError } from "../../_shared/btpm-api/http.ts";
import {
  parseApiV1CreateProjectBody,
  PROJECT_CREATE_ROUTE,
  PROJECTS_ROUTE,
  type ApiV1CreateProjectBody,
} from "../routes/projects.ts";
import {
  API_V1_ROUTE_ALLOWLIST,
  executeApiCreateProjectRoute,
  matchApiRoute,
  parseApiRuntimeControls,
} from "../router.ts";
import { buildCapabilitiesPayload } from "../routes/capabilities.ts";
import { createApiV1Project } from "../../_shared/btpm-api/supabaseProjectMutation.ts";
import { createDelegatedApiV1CreateProjectExecutor } from "../../_shared/btpm-api/supabaseDelegatedProjectMutation.ts";

const WORKSPACE_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const PROGRAM_ID = "bbbbbbbb-2222-4222-8222-222222222222";
const PROJECT_ID = "cccccccc-3333-4333-8333-333333333333";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const API_CLIENT_ID = "22222222-2222-4222-8222-222222222222";
const POLICY_VERSION_ID = "33333333-3333-4333-8333-333333333333";
const OAUTH_CLIENT_ID = "astra-client";
const NIL = "00000000-0000-0000-0000-000000000000";

function base(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { workspaceId: WORKSPACE_ID, name: "Project A", ...overrides };
}

function assertInvalid(run: () => unknown): void {
  const err = assertThrows(run, ApiHttpError);
  assertEquals(err.code, "invalid_request");
  assertEquals(err.status, 400);
}

// ---------------------------------------------------------------------------
// 1. Parser — exact closed body schema
// ---------------------------------------------------------------------------

Deno.test("API-N.5-C4: parser accepts exactly the four canonical keys", () => {
  const parsed = parseApiV1CreateProjectBody(base());
  assertEquals(Object.keys(parsed).sort(), [
    "deliveryModel",
    "name",
    "programId",
    "workspaceId",
  ]);
  assertEquals(parsed, {
    workspaceId: WORKSPACE_ID,
    name: "Project A",
    programId: null,
    deliveryModel: null,
  });
  assert(Object.isFrozen(parsed));
});

Deno.test("API-N.5-C4: parser rejects every create-time field outside the closed schema", () => {
  const rejectedKeys: readonly string[] = [
    "description",
    "charter",
    "goals",
    "scopeIn",
    "scopeOut",
    "businessCase",
    "successCriteria",
    "completionCriteria",
    "budgetNarrative",
    "assumptions",
    "constraints",
    "status",
    "priority",
    "projectStage",
    "startDate",
    "targetEndDate",
    "agileEnabled",
    "team",
    "raci",
    "accountableUserId",
    "responsibleUserIds",
    "organizationId",
    "projectId",
    "id",
    "x",
    "workspace_id",
    "delivery_model",
  ];
  for (const key of rejectedKeys) {
    assertInvalid(() => parseApiV1CreateProjectBody(base({ [key]: null })));
    assertInvalid(() => parseApiV1CreateProjectBody(base({ [key]: "value" })));
  }
});

Deno.test("API-N.5-C4: parser rejects non-object bodies", () => {
  for (
    const bad of [null, undefined, 1, "x", true, [], [base()], () => {}]
  ) {
    assertInvalid(() => parseApiV1CreateProjectBody(bad));
  }
});

// ---------------------------------------------------------------------------
// 2. Parser — workspaceId
// ---------------------------------------------------------------------------

Deno.test("API-N.5-C4: workspaceId is required and must be a valid non-nil UUID", () => {
  assertEquals(
    parseApiV1CreateProjectBody(base()).workspaceId,
    WORKSPACE_ID,
  );
  assertInvalid(() => parseApiV1CreateProjectBody({ name: "Project A" }));
  for (
    const bad of [
      NIL,
      "not-a-uuid",
      "",
      `${WORKSPACE_ID} `,
      ` ${WORKSPACE_ID}`,
      WORKSPACE_ID.replace("-", ""),
      null,
      1,
      {},
      [],
      true,
    ]
  ) {
    assertInvalid(() =>
      parseApiV1CreateProjectBody(base({ workspaceId: bad }))
    );
  }
});

// ---------------------------------------------------------------------------
// 3. Parser — name (PostgreSQL btrim(text) U+0020 semantics)
// ---------------------------------------------------------------------------

Deno.test("API-N.5-C4: name follows btrim U+0020 semantics exactly", () => {
  assertEquals(parseApiV1CreateProjectBody(base({ name: "  Project A  " })).name, "Project A");
  assertEquals(parseApiV1CreateProjectBody(base({ name: "A  B" })).name, "A  B");
  assertEquals(parseApiV1CreateProjectBody(base({ name: "  A  B  " })).name, "A  B");
  // Non-U+0020 whitespace is preserved verbatim — the committed behaviour.
  assertEquals(parseApiV1CreateProjectBody(base({ name: "\tProject\n" })).name, "\tProject\n");
  assertEquals(
    parseApiV1CreateProjectBody(base({ name: " \tProject\t " })).name,
    "\tProject\t",
  );
  assertEquals(
    parseApiV1CreateProjectBody(base({ name: "\u00a0Project\u00a0" })).name,
    "\u00a0Project\u00a0",
  );
  // Blank after U+0020 trimming is rejected.
  assertInvalid(() => parseApiV1CreateProjectBody(base({ name: "" })));
  assertInvalid(() => parseApiV1CreateProjectBody(base({ name: " " })));
  assertInvalid(() => parseApiV1CreateProjectBody(base({ name: "     " })));
  // Required and typed.
  assertInvalid(() => parseApiV1CreateProjectBody({ workspaceId: WORKSPACE_ID }));
  for (const bad of [null, 1, {}, [], true]) {
    assertInvalid(() => parseApiV1CreateProjectBody(base({ name: bad })));
  }
});

Deno.test("API-N.5-C4: name accepts 200 characters and rejects more", () => {
  const exact = "n".repeat(200);
  assertEquals(parseApiV1CreateProjectBody(base({ name: exact })).name, exact);
  assertInvalid(() =>
    parseApiV1CreateProjectBody(base({ name: "n".repeat(201) }))
  );
  // A 201-char raw value whose ordinary spaces trim to 200 is rejected by the
  // committed pre-trim length guard; assert the committed behaviour.
  assertInvalid(() =>
    parseApiV1CreateProjectBody(base({ name: ` ${exact}` }))
  );
});

// ---------------------------------------------------------------------------
// 4. Parser — programId
// ---------------------------------------------------------------------------

Deno.test("API-N.5-C4: programId absent and explicit null normalize identically", () => {
  assertEquals(parseApiV1CreateProjectBody(base()).programId, null);
  assertEquals(
    parseApiV1CreateProjectBody(base({ programId: null })).programId,
    null,
  );
  assertEquals(
    parseApiV1CreateProjectBody(base()),
    parseApiV1CreateProjectBody(base({ programId: null })),
  );
  assertEquals(
    parseApiV1CreateProjectBody(base({ programId: PROGRAM_ID })).programId,
    PROGRAM_ID,
  );
  for (const bad of [NIL, "not-a-uuid", "", 1, {}, [], true]) {
    assertInvalid(() => parseApiV1CreateProjectBody(base({ programId: bad })));
  }
});

// ---------------------------------------------------------------------------
// 5. Parser — deliveryModel
// ---------------------------------------------------------------------------

Deno.test("API-N.5-C4: deliveryModel accepts exactly the canonical vocabulary", () => {
  assertEquals(parseApiV1CreateProjectBody(base()).deliveryModel, null);
  assertEquals(
    parseApiV1CreateProjectBody(base({ deliveryModel: null })).deliveryModel,
    null,
  );
  assertEquals(
    parseApiV1CreateProjectBody(base()),
    parseApiV1CreateProjectBody(base({ deliveryModel: null })),
  );
  for (
    const model of ["internal_delivery", "vendor_delivery", "co_delivery"]
  ) {
    assertEquals(
      parseApiV1CreateProjectBody(base({ deliveryModel: model })).deliveryModel,
      model,
    );
  }
  for (
    const bad of [
      "__unclassified__",
      "unclassified",
      "internal",
      "vendor",
      "co-delivery",
      "INTERNAL_DELIVERY",
      "internal_delivery ",
      "",
      1,
      {},
      [],
      true,
    ]
  ) {
    assertInvalid(() =>
      parseApiV1CreateProjectBody(base({ deliveryModel: bad }))
    );
  }
});

Deno.test("API-N.5-C4: equivalent inputs normalize to identical canonical bodies", () => {
  const a = parseApiV1CreateProjectBody(base({ name: "  Project A  " }));
  const b = parseApiV1CreateProjectBody({
    workspaceId: WORKSPACE_ID,
    name: "Project A",
    programId: null,
    deliveryModel: null,
  });
  assertEquals(a, b);
});

// ---------------------------------------------------------------------------
// 6. Mutation pipeline — injected deterministic dependencies
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

const ENABLED = parseApiRuntimeControls({
  BTPM_API_ENABLED: "true",
  BTPM_API_READS_ENABLED: "true",
  BTPM_API_MUTATIONS_ENABLED: "true",
});

const APPLIED = Object.freeze({
  ok: true,
  outcome: "applied",
  projectId: PROJECT_ID,
});

interface CapturedCall {
  readonly body: ApiV1CreateProjectBody;
  // deno-lint-ignore no-explicit-any
  readonly executionContext: any;
}

function projectDeps(result: unknown) {
  const captured: CapturedCall[] = [];
  const order: string[] = [];
  const counters = { create: 0, authorize: 0, authenticate: 0, rate: 0 };
  return {
    captured,
    order,
    counters,
    // deno-lint-ignore no-explicit-any
    deps: {
      authenticate: () => {
        counters.authenticate++;
        order.push("authenticate");
        return Promise.resolve(AUTH_CONTEXT);
      },
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
      // deno-lint-ignore no-explicit-any
      createProject: (
        _request: Request,
        _context: unknown,
        body: ApiV1CreateProjectBody,
        // deno-lint-ignore no-explicit-any
        executionContext: any,
      ) => {
        counters.create++;
        order.push("execute");
        captured.push({ body, executionContext });
        return Promise.resolve(result);
      },
      // deno-lint-ignore no-explicit-any
    } as any,
  };
}

function createRequest(
  path = "/v1/projects",
  method = "POST",
  idempotencyKey = "key-1",
): Request {
  return new Request(`https://api.example.test${path}`, {
    method,
    headers: {
      Authorization: "Bearer caller-token",
      "Idempotency-Key": idempotencyKey,
    },
    body: method === "POST" ? "{}" : undefined,
  });
}

Deno.test("API-N.5-C4: only PROJECT_CREATE_ROUTE serves this command; GET stays the read route", async () => {
  assertEquals(matchApiRoute("POST", "/v1/projects"), PROJECT_CREATE_ROUTE);
  assertEquals(matchApiRoute("GET", "/v1/projects"), PROJECTS_ROUTE);
  assertEquals(PROJECTS_ROUTE.operation, "read");
  assertEquals(PROJECT_CREATE_ROUTE.operation, "mutation");

  const d = projectDeps(APPLIED);
  const ok = await executeApiCreateProjectRoute(
    createRequest(),
    base(),
    "req-1",
    ENABLED,
    d.deps,
  );
  assertEquals(ok.route, PROJECT_CREATE_ROUTE);

  // Any other method/path is refused before any dependency runs.
  for (
    const [method, path] of [
      ["GET", "/v1/projects"],
      ["PATCH", "/v1/projects"],
      ["POST", "/v1/projects/"],
      ["POST", `/v1/projects/${PROJECT_ID}`],
    ] as const
  ) {
    const bad = projectDeps(APPLIED);
    const err = await assertRejects(
      () =>
        executeApiCreateProjectRoute(
          createRequest(path, method),
          base(),
          "req-1",
          ENABLED,
          bad.deps,
        ),
      ApiHttpError,
    );
    assertEquals(err.code, "route_not_found");
    assertEquals(bad.counters.create, 0);
    assertEquals(bad.counters.authenticate, 0);
  }
});

Deno.test("API-N.5-C4: pipeline order is authenticate → authorize → rateLimit → delegated execute", async () => {
  const d = projectDeps(APPLIED);
  await executeApiCreateProjectRoute(
    createRequest(),
    base(),
    "req-1",
    ENABLED,
    d.deps,
  );
  assertEquals(d.order, ["authenticate", "authorize", "rateLimit", "execute"]);
  assertEquals(d.counters.create, 1);
  assertEquals(d.counters.authorize, 1);
  assertEquals(d.counters.rate, 1);
});

Deno.test("API-N.5-C4: createProject receives the normalized body, not the raw caller body", async () => {
  const d = projectDeps(APPLIED);
  await executeApiCreateProjectRoute(
    createRequest(),
    { workspaceId: WORKSPACE_ID, name: "  Project A  " },
    "req-1",
    ENABLED,
    d.deps,
  );
  assertEquals(d.captured.length, 1);
  assertEquals(d.captured[0].body, {
    workspaceId: WORKSPACE_ID,
    name: "Project A",
    programId: null,
    deliveryModel: null,
  });
});

Deno.test("API-N.5-C4: malformed body fails before createProject is invoked", async () => {
  for (
    const bad of [
      {},
      { workspaceId: WORKSPACE_ID },
      { workspaceId: NIL, name: "Project A" },
      base({ name: "   " }),
      base({ description: "nope" }),
      base({ deliveryModel: "__unclassified__" }),
      null,
    ]
  ) {
    const d = projectDeps(APPLIED);
    const err = await assertRejects(
      () =>
        executeApiCreateProjectRoute(
          createRequest(),
          bad,
          "req-1",
          ENABLED,
          d.deps,
        ),
      ApiHttpError,
    );
    assertEquals(err.code, "invalid_request");
    assertEquals(d.counters.create, 0);
    assertEquals(d.counters.authenticate, 0);
  }
});

Deno.test("API-N.5-C4: execution context is the external delegated-user context", async () => {
  const d = projectDeps(APPLIED);
  await executeApiCreateProjectRoute(
    createRequest(),
    base(),
    "req-1",
    ENABLED,
    d.deps,
  );
  const ctx = d.captured[0].executionContext;
  assertEquals(ctx.sourceChannel, "external_api");
  assertEquals(ctx.delegationMode, "delegated_user");
  assertEquals(ctx.requestedUserId, USER_ID);
  assertEquals(ctx.executingUserId, USER_ID);
  assertEquals(ctx.apiClientId, API_CLIENT_ID);
  assertEquals(ctx.oauthClientId, OAUTH_CLIENT_ID);
  assertEquals(ctx.policyVersionId, POLICY_VERSION_ID);
  assertEquals(ctx.idempotencyKey, "key-1");
  assertEquals(ctx.requestId, "req-1");
  assert(/^[0-9a-f]{64}$/.test(ctx.payloadHash));
});

// ---------------------------------------------------------------------------
// 7. Normalization → real API-F payload hash equivalence
// ---------------------------------------------------------------------------

async function hashFor(rawBody: unknown): Promise<string> {
  const d = projectDeps(APPLIED);
  await executeApiCreateProjectRoute(
    createRequest(),
    rawBody,
    "req-1",
    ENABLED,
    d.deps,
  );
  return d.captured[0].executionContext.payloadHash as string;
}

Deno.test("API-N.5-C4: normalized-equivalent bodies produce the same API-F payload hash", async () => {
  const canonical = await hashFor(base());

  // programId absent vs explicit null.
  assertEquals(await hashFor(base({ programId: null })), canonical);
  // deliveryModel absent vs explicit null.
  assertEquals(await hashFor(base({ deliveryModel: null })), canonical);
  assertEquals(
    await hashFor(base({ programId: null, deliveryModel: null })),
    canonical,
  );
  // Ordinary-space-trimmed name vs its canonical normalized name.
  assertEquals(await hashFor(base({ name: "  Project A  " })), canonical);

  // Genuinely different canonical payloads hash differently.
  assertNotEquals(await hashFor(base({ programId: PROGRAM_ID })), canonical);
  assertNotEquals(
    await hashFor(base({ deliveryModel: "internal_delivery" })),
    canonical,
  );
  assertNotEquals(await hashFor(base({ name: "Project B" })), canonical);
});

// ---------------------------------------------------------------------------
// 8. HTTP outcome mapping
// ---------------------------------------------------------------------------

Deno.test("API-N.5-C4: applied → 201 and replayed → 200 with a bounded payload", async () => {
  const applied = projectDeps(APPLIED);
  const r1 = await executeApiCreateProjectRoute(
    createRequest(),
    base(),
    "req-1",
    ENABLED,
    applied.deps,
  );
  assertEquals(r1.status, 201);
  assertEquals(r1.payload, APPLIED);
  assertEquals(Object.keys(r1.payload).sort(), ["ok", "outcome", "projectId"]);
  assertEquals(r1.activityIdentity, {
    apiClientId: API_CLIENT_ID,
    actorUserId: USER_ID,
  });

  const replayed = projectDeps({ ...APPLIED, outcome: "replayed" });
  const r2 = await executeApiCreateProjectRoute(
    createRequest(),
    base(),
    "req-1",
    ENABLED,
    replayed.deps,
  );
  assertEquals(r2.status, 200);
  assertEquals(Object.keys(r2.payload).sort(), ["ok", "outcome", "projectId"]);
});

Deno.test("API-N.5-C4: negative wrapper outcomes map to the exact public error codes", async () => {
  const mapping: readonly (readonly [string, string])[] = [
    ["invalid", "invalid_request"],
    ["not_authorized", "not_authorized"],
    ["idempotency_conflict", "idempotency_conflict"],
    ["idempotency_pending", "idempotency_pending"],
  ];
  for (const [outcome, code] of mapping) {
    const d = projectDeps({ ok: false, outcome });
    const err = await assertRejects(
      () =>
        executeApiCreateProjectRoute(
          createRequest(),
          base(),
          "req-1",
          ENABLED,
          d.deps,
        ),
      ApiHttpError,
    );
    assertEquals(err.code, code, outcome);
    assertEquals(d.counters.create, 1);
  }
});

Deno.test("API-N.5-C4: unexpected or malformed bounded results fail closed as internal_error", async () => {
  for (
    const result of [
      { ok: true, outcome: "no_change", projectId: PROJECT_ID },
      { ok: true, outcome: "conflict", projectId: PROJECT_ID },
      { ok: false, outcome: "conflict" },
      { ok: false, outcome: "something_else" },
    ]
  ) {
    const d = projectDeps(result);
    const err = await assertRejects(
      () =>
        executeApiCreateProjectRoute(
          createRequest(),
          base(),
          "req-1",
          ENABLED,
          d.deps,
        ),
      ApiHttpError,
    );
    assertEquals(err.code, "internal_error");
  }
});

Deno.test("API-N.5-C4: missing or malformed dependencies fail closed", async () => {
  const good = projectDeps(APPLIED);
  for (
    const deps of [
      undefined,
      null,
      {},
      { ...good.deps, createProject: undefined },
      { ...good.deps, rateLimit: undefined },
      { ...good.deps, authorizeRoute: undefined },
    ]
  ) {
    const err = await assertRejects(
      () =>
        executeApiCreateProjectRoute(
          createRequest(),
          base(),
          "req-1",
          ENABLED,
          // deno-lint-ignore no-explicit-any
          deps as any,
        ),
      ApiHttpError,
    );
    assertEquals(err.code, "internal_error");
  }
});

// ---------------------------------------------------------------------------
// 9. Delegated caller-bound RPC evidence
// ---------------------------------------------------------------------------

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

interface RpcCall {
  fn: string;
  args: Record<string, unknown>;
}

Deno.test("API-N.5-C4: delegated executor binds the anon key + caller bearer and calls exactly api_v1_create_project", async () => {
  const seen: Array<{ url: string; key: string; auth: string }> = [];
  const rpcCalls: RpcCall[] = [];
  const clients: unknown[] = [];
  // deno-lint-ignore no-explicit-any
  const factory = (url: string, key: string, options: any) => {
    seen.push({ url, key, auth: options.global.headers.Authorization });
    const client = {
      rpc: (fn: string, args: Record<string, unknown>) => {
        rpcCalls.push({ fn, args });
        return Promise.resolve({ data: APPLIED, error: null });
      },
    };
    clients.push(client);
    return client;
  };

  const exec = createDelegatedApiV1CreateProjectExecutor(
    "https://example.supabase.co",
    "anon-key",
    factory,
  );

  const body = parseApiV1CreateProjectBody(
    base({ name: "  Project A  ", programId: PROGRAM_ID, deliveryModel: "co_delivery" }),
  );
  const result = await exec(createRequest(), AUTH_CONTEXT, body, EXEC_CONTEXT);
  await exec(createRequest(), AUTH_CONTEXT, body, EXEC_CONTEXT);

  assertEquals(result.ok, true);
  assertEquals(seen.length, 2);
  assertEquals(clients.length, 2);
  assert(clients[0] !== clients[1], "a fresh client is built per invocation");
  for (const s of seen) {
    assertEquals(s.url, "https://example.supabase.co");
    assertEquals(s.key, "anon-key");
    assertEquals(s.auth, "Bearer caller-token");
  }
  assertEquals(rpcCalls.map((c) => c.fn), [
    "api_v1_create_project",
    "api_v1_create_project",
  ]);
  assertEquals(rpcCalls[0].args, {
    _expected_oauth_client_id: OAUTH_CLIENT_ID,
    _workspace_id: WORKSPACE_ID,
    _name: "Project A",
    _program_id: PROGRAM_ID,
    _delivery_model: "co_delivery",
    _request_id: "req-1",
    _correlation_id: "corr-1",
    _idempotency_key: "key-1",
    _payload_hash: "a".repeat(64),
  });
});

Deno.test("API-N.5-C4: base adapter calls only the literal api_v1_create_project wrapper", async () => {
  const calls: RpcCall[] = [];
  const client = {
    rpc: (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return Promise.resolve({ data: APPLIED, error: null });
    },
  };
  // deno-lint-ignore no-explicit-any
  const result = await createApiV1Project(client as any, {
    expectedOauthClientId: OAUTH_CLIENT_ID,
    workspaceId: WORKSPACE_ID,
    name: "Project A",
    programId: null,
    deliveryModel: null,
    requestId: "req-1",
    correlationId: "corr-1",
    idempotencyKey: "key-1",
    payloadHash: "a".repeat(64),
  });
  assertEquals(calls.length, 1);
  assertEquals(calls[0].fn, "api_v1_create_project");
  assertEquals(calls[0].args._program_id, null);
  assertEquals(calls[0].args._delivery_model, null);
  assertEquals(result, { ok: true, outcome: "applied", projectId: PROJECT_ID });

  // A caller can never influence the invoked function name: the adapter takes
  // no function-name argument at all.
  assertEquals(createApiV1Project.length, 2);

  // Insufficient privilege from the caller-bound client is not_authorized.
  const denied = {
    rpc: () => Promise.resolve({ data: null, error: { code: "42501" } }),
  };
  const err = await assertRejects(
    () =>
      // deno-lint-ignore no-explicit-any
      createApiV1Project(denied as any, {
        expectedOauthClientId: OAUTH_CLIENT_ID,
        workspaceId: WORKSPACE_ID,
        name: "Project A",
        programId: null,
        deliveryModel: null,
        requestId: "req-1",
        correlationId: "corr-1",
        idempotencyKey: "key-1",
        payloadHash: "a".repeat(64),
      }),
    ApiHttpError,
  );
  assertEquals(err.code, "not_authorized");
});

Deno.test("API-N.5-C4: delegated executor rejects identity / channel / delegation drift", async () => {
  const factory = () => ({
    rpc: () => Promise.resolve({ data: APPLIED, error: null }),
  });
  const exec = createDelegatedApiV1CreateProjectExecutor(
    "https://example.supabase.co",
    "anon-key",
    factory,
  );
  const body = parseApiV1CreateProjectBody(base());

  const drifts: Array<Record<string, unknown>> = [
    { executingUserId: "99999999-9999-4999-8999-999999999999" },
    { requestedUserId: "99999999-9999-4999-8999-999999999999" },
    { apiClientId: "99999999-9999-4999-8999-999999999999" },
    { oauthClientId: "other-client" },
    { policyVersionId: "99999999-9999-4999-8999-999999999999" },
    { sourceChannel: "browser" },
    { sourceChannel: "internal_app" },
    { delegationMode: "service" },
    { delegationMode: "service_role" },
  ];
  for (const drift of drifts) {
    const err = await assertRejects(
      () =>
        exec(createRequest(), AUTH_CONTEXT, body, {
          ...EXEC_CONTEXT,
          ...drift,
        }),
      ApiHttpError,
    );
    assertEquals(err.code, "internal_error", JSON.stringify(drift));
  }
});

// ---------------------------------------------------------------------------
// 10. Surface / parity non-regression
// ---------------------------------------------------------------------------

Deno.test("API-N.5-C4: projects.create is a live mutation route advertised exactly once", () => {
  const live = API_V1_ROUTE_ALLOWLIST.filter((r) => r.id === "projects.create");
  assertEquals(live.length, 1);
  assertEquals(live[0].operation, "mutation");
  const ops = buildCapabilitiesPayload().supportedOperations as
    readonly string[];
  assertEquals(ops.filter((o) => o === "projects.create").length, 1);
});

