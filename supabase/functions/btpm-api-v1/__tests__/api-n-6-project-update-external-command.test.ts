// API-N.6 — focused behavioural contract coverage for the single accepted
// external Project metadata update command: PATCH /v1/projects/{projectId}
// (projects:update).
//
// These tests exercise the committed production path parser, body parser,
// canonical idempotency payload builder, route pipeline and delegated
// caller-bound adapter with injected deterministic dependencies. No
// environment variable, network call, live Supabase client, OAuth flow or
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
  parseApiV1ProjectUpdatePath,
  parseApiV1UpdateProjectBody,
  buildApiV1UpdateProjectIdempotencyPayload,
  PROJECT_CREATE_ROUTE,
  PROJECT_UPDATE_NARRATIVE_FIELDS,
  PROJECT_UPDATE_ROUTE,
  PROJECTS_ROUTE,
  type ApiV1UpdateProjectBody,
} from "../routes/projects.ts";
import {
  API_V1_ROUTE_ALLOWLIST,
  executeApiUpdateProjectRoute,
  matchApiRoute,
  parseApiRuntimeControls,
} from "../router.ts";
import { buildCapabilitiesPayload } from "../routes/capabilities.ts";
import { updateApiV1Project } from "../../_shared/btpm-api/supabaseProjectMutation.ts";
import { createDelegatedApiV1UpdateProjectExecutor } from "../../_shared/btpm-api/supabaseDelegatedProjectMutation.ts";
import { handleApiV1Request } from "../handler.ts";

const PROJECT_ID = "cccccccc-3333-4333-8333-333333333333";
const PROGRAM_ID = "bbbbbbbb-2222-4222-8222-222222222222";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const API_CLIENT_ID = "22222222-2222-4222-8222-222222222222";
const POLICY_VERSION_ID = "33333333-3333-4333-8333-333333333333";
const OAUTH_CLIENT_ID = "astra-client";
const NIL = "00000000-0000-0000-0000-000000000000";
const UPDATED_AT = "2026-02-01T10:20:30.123456+00:00";

function base(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { expectedUpdatedAt: UPDATED_AT, ...overrides };
}

function assertInvalid(run: () => unknown): void {
  const err = assertThrows(run, ApiHttpError);
  assertEquals(err.code, "invalid_request");
  assertEquals(err.status, 400);
}

// ---------------------------------------------------------------------------
// 1. Path parser
// ---------------------------------------------------------------------------

Deno.test("API-N.6: path parser accepts exactly one non-nil Project UUID segment", () => {
  const parsed = parseApiV1ProjectUpdatePath(`/v1/projects/${PROJECT_ID}`);
  assertEquals(parsed, { projectId: PROJECT_ID });
  assert(Object.isFrozen(parsed));

  for (
    const bad of [
      "/v1/projects",
      "/v1/projects/",
      `/v1/projects/${NIL}`,
      `/v1/projects/${PROJECT_ID}/`,
      `/v1/projects/${PROJECT_ID}/phases`,
      `/v1/projects/${PROJECT_ID}%20`,
      `/v1/projects/ ${PROJECT_ID}`,
      `/v1/projects/${PROJECT_ID} `,
      `/v1/projects/${PROJECT_ID};x`,
      "/v1/projects/not-a-uuid",
      `/v1/PROJECTS/${PROJECT_ID}`,
    ]
  ) {
    assertInvalid(() => parseApiV1ProjectUpdatePath(bad));
  }
});

// ---------------------------------------------------------------------------
// 2. Body parser — closed schema and required concurrency token
// ---------------------------------------------------------------------------

Deno.test("API-N.6: body parser rejects every key outside the closed schema", () => {
  for (
    const key of [
      "projectId",
      "id",
      "workspaceId",
      "organizationId",
      "status",
      "projectStage",
      "startDate",
      "targetEndDate",
      "isArchived",
      "agileEnabled",
      "team",
      "raci",
      "expected_updated_at",
      "delivery_model",
      "program_id",
      "x",
    ]
  ) {
    assertInvalid(() => parseApiV1UpdateProjectBody(base({ [key]: null })));
    assertInvalid(() => parseApiV1UpdateProjectBody(base({ [key]: "value" })));
  }

  for (const bad of [null, undefined, 1, "x", true, [], [base()], () => {}]) {
    assertInvalid(() => parseApiV1UpdateProjectBody(bad));
  }
});

Deno.test("API-N.6: expectedUpdatedAt is required and must be timezone-aware", () => {
  assertInvalid(() => parseApiV1UpdateProjectBody({}));
  assertInvalid(() => parseApiV1UpdateProjectBody({ name: "Project A" }));

  for (
    const good of [
      "2026-02-01T10:20:30Z",
      "2026-02-01T10:20:30.123Z",
      "2026-02-01 10:20:30+00",
      "2026-02-01T10:20:30+02:00",
      "2026-02-01T10:20:30-0500",
      UPDATED_AT,
    ]
  ) {
    assertEquals(
      parseApiV1UpdateProjectBody({ expectedUpdatedAt: good })
        .expectedUpdatedAt,
      good,
      `expected ${good} to be accepted verbatim`,
    );
  }

  for (
    const bad of [
      "2026-02-01T10:20:30",
      "2026-02-01",
      "2026-13-01T10:20:30Z",
      "2026-02-30T10:20:30Z",
      "2026-02-01T24:20:30Z",
      "not-a-timestamp",
      "",
      1,
      null,
      {},
      [],
      true,
    ]
  ) {
    assertInvalid(() =>
      parseApiV1UpdateProjectBody({ expectedUpdatedAt: bad })
    );
  }
});

// ---------------------------------------------------------------------------
// 3. Body parser — presence semantics
// ---------------------------------------------------------------------------

Deno.test("API-N.6: absent fields carry no presence flag and no value", () => {
  const parsed = parseApiV1UpdateProjectBody(base());
  const flags = Object.entries(parsed).filter(([k]) => k.startsWith("set"));
  assertEquals(flags.length, 15);
  for (const [key, value] of flags) {
    assertEquals(value, false, `${key} must be absent`);
  }
  for (const [key, value] of Object.entries(parsed)) {
    if (key === "expectedUpdatedAt" || key.startsWith("set")) continue;
    assertEquals(value, null, `${key} must normalize to null when absent`);
  }
  assert(Object.isFrozen(parsed));
});

Deno.test("API-N.6: explicit null on a narrative is an explicit clear, never absence", () => {
  for (const field of PROJECT_UPDATE_NARRATIVE_FIELDS) {
    const flag = `set${field[0].toUpperCase()}${field.slice(1)}`;
    const cleared = parseApiV1UpdateProjectBody(
      base({ [field]: null }),
    ) as unknown as Record<string, unknown>;
    assertEquals(cleared[flag], true);
    assertEquals(cleared[field], null);

    const absent = parseApiV1UpdateProjectBody(
      base(),
    ) as unknown as Record<string, unknown>;
    assertEquals(absent[flag], false);

    // A whitespace-only narrative normalizes to the same explicit clear.
    const blank = parseApiV1UpdateProjectBody(
      base({ [field]: "   " }),
    ) as unknown as Record<string, unknown>;
    assertEquals(blank[flag], true);
    assertEquals(blank[field], null);

    // Supplied narrative text is btrim-canonicalized.
    const text = parseApiV1UpdateProjectBody(
      base({ [field]: "  value  " }),
    ) as unknown as Record<string, unknown>;
    assertEquals(text[field], "value");
  }
});

Deno.test("API-N.6: name is not clearable and priority is a closed vocabulary", () => {
  assertEquals(parseApiV1UpdateProjectBody(base({ name: "  A  " })).name, "A");
  assertEquals(parseApiV1UpdateProjectBody(base({ name: "A" })).setName, true);
  for (const bad of [null, "", "   ", 1, {}, [], true, "x".repeat(201)]) {
    assertInvalid(() => parseApiV1UpdateProjectBody(base({ name: bad })));
  }

  for (const good of ["low", "medium", "high", "critical"]) {
    const p = parseApiV1UpdateProjectBody(base({ priority: good }));
    assertEquals(p.priority, good);
    assertEquals(p.setPriority, true);
  }
  for (
    const bad of [null, "", "urgent", "LOW", "low ", 1, {}, [], true]
  ) {
    assertInvalid(() => parseApiV1UpdateProjectBody(base({ priority: bad })));
  }
});

Deno.test("API-N.6: programId and deliveryModel are nullable but strictly typed", () => {
  const linked = parseApiV1UpdateProjectBody(base({ programId: PROGRAM_ID }));
  assertEquals(linked.programId, PROGRAM_ID);
  assertEquals(linked.setProgramId, true);

  const unlinked = parseApiV1UpdateProjectBody(base({ programId: null }));
  assertEquals(unlinked.programId, null);
  assertEquals(unlinked.setProgramId, true);

  for (const bad of [NIL, "not-a-uuid", "", 1, {}, [], true]) {
    assertInvalid(() => parseApiV1UpdateProjectBody(base({ programId: bad })));
  }

  for (
    const good of ["internal_delivery", "vendor_delivery", "co_delivery"]
  ) {
    const d = parseApiV1UpdateProjectBody(base({ deliveryModel: good }));
    assertEquals(d.deliveryModel, good);
    assertEquals(d.setDeliveryModel, true);
  }
  const clearedModel = parseApiV1UpdateProjectBody(
    base({ deliveryModel: null }),
  );
  assertEquals(clearedModel.deliveryModel, null);
  assertEquals(clearedModel.setDeliveryModel, true);
  for (
    const bad of ["vendor", "INTERNAL_DELIVERY", "co_delivery ", "", 1, {}, []]
  ) {
    assertInvalid(() =>
      parseApiV1UpdateProjectBody(base({ deliveryModel: bad }))
    );
  }
});

// ---------------------------------------------------------------------------
// 4. Canonical idempotency payload
// ---------------------------------------------------------------------------

Deno.test("API-N.6: absence and explicit clear never hash identically", () => {
  const absent = buildApiV1UpdateProjectIdempotencyPayload(
    PROJECT_ID,
    parseApiV1UpdateProjectBody(base()),
  );
  for (const field of PROJECT_UPDATE_NARRATIVE_FIELDS) {
    const cleared = buildApiV1UpdateProjectIdempotencyPayload(
      PROJECT_ID,
      parseApiV1UpdateProjectBody(base({ [field]: null })),
    );
    assertNotEquals(
      JSON.stringify(cleared),
      JSON.stringify(absent),
      `${field}: explicit clear must differ from absence`,
    );
  }

  const withProgram = buildApiV1UpdateProjectIdempotencyPayload(
    PROJECT_ID,
    parseApiV1UpdateProjectBody(base({ programId: null })),
  );
  assertNotEquals(JSON.stringify(withProgram), JSON.stringify(absent));
});

Deno.test("API-N.6: idempotency payload is deterministic, target-bound and metadata-free", () => {
  const body = parseApiV1UpdateProjectBody(
    base({ name: "  Project A  ", charter: "  C  ", priority: "high" }),
  );
  const a = buildApiV1UpdateProjectIdempotencyPayload(PROJECT_ID, body);
  const b = buildApiV1UpdateProjectIdempotencyPayload(
    PROJECT_ID,
    parseApiV1UpdateProjectBody(
      base({ name: "Project A", charter: "C", priority: "high" }),
    ),
  );
  assertEquals(JSON.stringify(a), JSON.stringify(b));

  // A different target Project can never share a canonical payload.
  const other = buildApiV1UpdateProjectIdempotencyPayload(PROGRAM_ID, body);
  assertNotEquals(JSON.stringify(a), JSON.stringify(other));

  const keys = Object.keys(a);
  assertEquals(keys[0], "projectId");
  assertEquals(keys.length, 2 + 15 * 2);
  for (
    const forbidden of [
      "requestId",
      "correlationId",
      "idempotencyKey",
      "payloadHash",
      "apiClientId",
      "oauthClientId",
      "workspaceId",
      "organizationId",
      "tenantId",
    ]
  ) {
    assert(!keys.includes(forbidden), `payload must not include ${forbidden}`);
  }
  assert(Object.isFrozen(a));
});

// ---------------------------------------------------------------------------
// 5. Route identity
// ---------------------------------------------------------------------------

Deno.test("API-N.6: exactly one route serves this command and it is registered once", () => {
  assertEquals(
    matchApiRoute("PATCH", `/v1/projects/${PROJECT_ID}`),
    PROJECT_UPDATE_ROUTE,
  );
  assertEquals(matchApiRoute("GET", "/v1/projects"), PROJECTS_ROUTE);
  assertEquals(matchApiRoute("POST", "/v1/projects"), PROJECT_CREATE_ROUTE);
  assertEquals(PROJECT_UPDATE_ROUTE.operation, "mutation");
  assertEquals(PROJECT_UPDATE_ROUTE.id, "projects.update");
  assertEquals(PROJECT_UPDATE_ROUTE.method, "PATCH");
  assertEquals(PROJECT_UPDATE_ROUTE.path, "/v1/projects/:projectid");

  assertEquals(
    API_V1_ROUTE_ALLOWLIST.filter((r) => r === PROJECT_UPDATE_ROUTE).length,
    1,
  );
  assertEquals(
    API_V1_ROUTE_ALLOWLIST.filter((r) => r.id === "projects.update").length,
    1,
  );
});

Deno.test("API-N.6: /v1/capabilities advertises projects.update exactly once", () => {
  const ops = buildCapabilitiesPayload().supportedOperations;
  assertEquals(ops.filter((o) => o === "projects.update").length, 1);
  // API-N.6-C1 — terminal/absolute position assertions intentionally omitted;
  // global order and cardinality are owned solely by
  // `api-v1-current-surface-topology.test.ts`.

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
  updatedAt: UPDATED_AT,
});

function updateDeps(result: unknown) {
  const captured: Array<{
    projectId: string;
    body: ApiV1UpdateProjectBody;
    // deno-lint-ignore no-explicit-any
    executionContext: any;
  }> = [];
  const order: string[] = [];
  const counters = { update: 0, create: 0, authorize: 0, authenticate: 0 };
  return {
    captured,
    order,
    counters,
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
      createProject: () => {
        counters.create++;
        return Promise.reject(new Error("create must never run here"));
      },
      updateProject: (
        _request: Request,
        _context: unknown,
        projectId: string,
        body: ApiV1UpdateProjectBody,
        // deno-lint-ignore no-explicit-any
        executionContext: any,
      ) => {
        counters.update++;
        order.push("execute");
        captured.push({ projectId, body, executionContext });
        return Promise.resolve(result);
      },
      // deno-lint-ignore no-explicit-any
    } as any,
  };
}

function updateRequest(
  path = `/v1/projects/${PROJECT_ID}`,
  method = "PATCH",
  idempotencyKey = "key-1",
): Request {
  return new Request(`https://api.example.test${path}`, {
    method,
    headers: {
      Authorization: "Bearer caller-token",
      "Idempotency-Key": idempotencyKey,
    },
    body: method === "PATCH" || method === "POST" ? "{}" : undefined,
  });
}

Deno.test("API-N.6: pipeline order is authenticate → authorize → rateLimit → delegated execute", async () => {
  const d = updateDeps(APPLIED);
  const ok = await executeApiUpdateProjectRoute(
    updateRequest(),
    base({ name: "Project A" }),
    "req-1",
    ENABLED,
    d.deps,
  );
  assertEquals(ok.route, PROJECT_UPDATE_ROUTE);
  assertEquals(ok.status, 200);
  assertEquals(ok.payload, APPLIED);
  assertEquals(ok.activityIdentity, {
    apiClientId: API_CLIENT_ID,
    actorUserId: USER_ID,
  });
  assertEquals(d.order, ["authenticate", "authorize", "rateLimit", "execute"]);
  assertEquals(d.counters.update, 1);
  assertEquals(d.counters.create, 0);
  assertEquals(d.counters.authorize, 1);
  assertEquals(d.captured[0].projectId, PROJECT_ID);
  assertEquals(d.captured[0].body.name, "Project A");
});

Deno.test("API-N.6: any other method/path is refused before any dependency runs", async () => {
  for (
    const [method, path] of [
      ["GET", `/v1/projects/${PROJECT_ID}`],
      ["POST", `/v1/projects/${PROJECT_ID}`],
      ["PATCH", "/v1/projects"],
      ["PATCH", `/v1/projects/${PROJECT_ID}/phases`],
      ["PUT", `/v1/projects/${PROJECT_ID}`],
      ["DELETE", `/v1/projects/${PROJECT_ID}`],
    ] as const
  ) {
    const d = updateDeps(APPLIED);
    const err = await assertRejects(
      () =>
        executeApiUpdateProjectRoute(
          updateRequest(path, method),
          base(),
          "req-1",
          ENABLED,
          d.deps,
        ),
      ApiHttpError,
    );
    assert(
      err.code === "route_not_found" || err.code === "invalid_request",
      `unexpected code ${err.code} for ${method} ${path}`,
    );
    assertEquals(d.counters.update, 0);
    assertEquals(d.counters.authenticate, 0);
  }
});

Deno.test("API-N.6: mutations disabled and invalid bodies never reach the executor", async () => {
  const disabled = parseApiRuntimeControls({
    BTPM_API_ENABLED: "true",
    BTPM_API_READS_ENABLED: "true",
    BTPM_API_MUTATIONS_ENABLED: "false",
  });
  const off = updateDeps(APPLIED);
  await assertRejects(
    () =>
      executeApiUpdateProjectRoute(
        updateRequest(),
        base(),
        "req-1",
        disabled,
        off.deps,
      ),
    ApiHttpError,
  );
  assertEquals(off.counters.update, 0);
  assertEquals(off.counters.authenticate, 0);

  const bad = updateDeps(APPLIED);
  const err = await assertRejects(
    () =>
      executeApiUpdateProjectRoute(
        updateRequest(),
        { status: "active", expectedUpdatedAt: UPDATED_AT },
        "req-1",
        ENABLED,
        bad.deps,
      ),
    ApiHttpError,
  );
  assertEquals(err.code, "invalid_request");
  assertEquals(bad.counters.update, 0);
  assertEquals(bad.counters.authenticate, 0);
});

Deno.test("API-N.6: bounded outcome mapping never leaks internal reasons", async () => {
  for (const outcome of ["applied", "no_change", "replayed"] as const) {
    const d = updateDeps({
      ok: true,
      outcome,
      projectId: PROJECT_ID,
      updatedAt: UPDATED_AT,
    });
    const res = await executeApiUpdateProjectRoute(
      updateRequest(),
      base({ name: "Project A" }),
      "req-1",
      ENABLED,
      d.deps,
    );
    assertEquals(res.status, 200);
    assertEquals(res.payload.outcome, outcome);
    assertEquals(Object.keys(res.payload).sort(), [
      "ok",
      "outcome",
      "projectId",
      "updatedAt",
    ]);
  }

  const cases: ReadonlyArray<[unknown, string]> = [
    [{ ok: false, outcome: "conflict", code: "stale_project" },
      "concurrency_conflict"],
    [{ ok: false, outcome: "invalid" }, "invalid_request"],
    [{ ok: false, outcome: "not_authorized" }, "not_authorized"],
    [{ ok: false, outcome: "idempotency_conflict" }, "idempotency_conflict"],
    [{ ok: false, outcome: "idempotency_pending" }, "idempotency_pending"],
    [{ ok: true, outcome: "surprise" }, "internal_error"],
    [{ ok: false, outcome: "surprise" }, "internal_error"],
  ];
  for (const [result, code] of cases) {
    const d = updateDeps(result);
    const err = await assertRejects(
      () =>
        executeApiUpdateProjectRoute(
          updateRequest(),
          base({ name: "Project A" }),
          "req-1",
          ENABLED,
          d.deps,
        ),
      ApiHttpError,
    );
    assertEquals(err.code, code);
    assert(!JSON.stringify(err.code).includes("stale_project"));
  }
});

Deno.test("API-N.6: a missing update executor fails closed", async () => {
  const d = updateDeps(APPLIED);
  const deps = { ...d.deps, updateProject: undefined };
  const err = await assertRejects(
    () =>
      executeApiUpdateProjectRoute(
        updateRequest(),
        base(),
        "req-1",
        ENABLED,
        // deno-lint-ignore no-explicit-any
        deps as any,
      ),
    ApiHttpError,
  );
  assertEquals(err.code, "internal_error");
});

// ---------------------------------------------------------------------------
// 7. Delegated caller-bound RPC evidence
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

Deno.test("API-N.6: delegated executor binds anon key + caller bearer and calls only api_v1_update_project", async () => {
  const seen: Array<{ url: string; key: string; auth: string }> = [];
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
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

  const exec = createDelegatedApiV1UpdateProjectExecutor(
    "https://example.supabase.co",
    "anon-key",
    factory,
  );

  const body = parseApiV1UpdateProjectBody(
    base({
      name: "  Project A  ",
      priority: "high",
      charter: "  C  ",
      description: null,
      programId: PROGRAM_ID,
      deliveryModel: "co_delivery",
    }),
  );

  const result = await exec(
    updateRequest(),
    AUTH_CONTEXT,
    PROJECT_ID,
    body,
    EXEC_CONTEXT,
  );
  await exec(updateRequest(), AUTH_CONTEXT, PROJECT_ID, body, EXEC_CONTEXT);

  assertEquals(result.ok, true);
  assertEquals(seen.length, 2);
  assert(clients[0] !== clients[1], "a fresh client is built per invocation");
  for (const s of seen) {
    assertEquals(s.url, "https://example.supabase.co");
    assertEquals(s.key, "anon-key");
    assertEquals(s.auth, "Bearer caller-token");
  }
  assertEquals(rpcCalls.map((c) => c.fn), [
    "api_v1_update_project",
    "api_v1_update_project",
  ]);

  const args = rpcCalls[0].args;
  assertEquals(args._expected_oauth_client_id, OAUTH_CLIENT_ID);
  assertEquals(args._project_id, PROJECT_ID);
  assertEquals(args._expected_updated_at, UPDATED_AT);
  assertEquals(args._name, "Project A");
  assertEquals(args._set_name, true);
  assertEquals(args._priority, "high");
  assertEquals(args._set_priority, true);
  assertEquals(args._charter, "C");
  assertEquals(args._set_charter, true);
  assertEquals(args._description, null);
  assertEquals(args._set_description, true);
  assertEquals(args._goals, null);
  assertEquals(args._set_goals, false);
  assertEquals(args._program_id, PROGRAM_ID);
  assertEquals(args._set_program_id, true);
  assertEquals(args._delivery_model, "co_delivery");
  assertEquals(args._set_delivery_model, true);
  assertEquals(args._request_id, "req-1");
  assertEquals(args._correlation_id, "corr-1");
  assertEquals(args._idempotency_key, "key-1");
  assertEquals(args._payload_hash, "a".repeat(64));

  // No Tenant/Organization/Workspace or capability argument is ever sent.
  for (
    const forbidden of [
      "_tenant_id",
      "_organization_id",
      "_workspace_id",
      "_capability_key",
      "_status",
      "_start_date",
      "_target_end_date",
    ]
  ) {
    assert(!(forbidden in args), `args must not include ${forbidden}`);
  }
  assertEquals(
    Object.keys(args).filter((k) => k.startsWith("_set_")).length,
    15,
  );
});

Deno.test("API-N.6: delegated executor fails closed on identity inconsistency", async () => {
  const exec = createDelegatedApiV1UpdateProjectExecutor(
    "https://example.supabase.co",
    "anon-key",
    () => ({ rpc: () => Promise.resolve({ data: APPLIED, error: null }) }),
  );
  const body = parseApiV1UpdateProjectBody(base({ name: "Project A" }));

  for (
    const badContext of [
      { ...EXEC_CONTEXT, requestedUserId: API_CLIENT_ID },
      { ...EXEC_CONTEXT, executingUserId: API_CLIENT_ID },
      { ...EXEC_CONTEXT, apiClientId: POLICY_VERSION_ID },
      { ...EXEC_CONTEXT, oauthClientId: "other-client" },
      { ...EXEC_CONTEXT, policyVersionId: API_CLIENT_ID },
      { ...EXEC_CONTEXT, sourceChannel: "btpm_ui" },
      { ...EXEC_CONTEXT, delegationMode: "service_role" },
    ]
  ) {
    const err = await assertRejects(
      () =>
        exec(
          updateRequest(),
          AUTH_CONTEXT,
          PROJECT_ID,
          body,
          // deno-lint-ignore no-explicit-any
          badContext as any,
        ),
      ApiHttpError,
    );
    assertEquals(err.code, "internal_error");
  }

  // A mismatched token/client identity is equally fatal.
  const err = await assertRejects(
    () =>
      exec(
        updateRequest(),
        // deno-lint-ignore no-explicit-any
        {
          token: { userId: USER_ID },
          client: {
            userId: API_CLIENT_ID,
            apiClientId: API_CLIENT_ID,
            oauthClientId: OAUTH_CLIENT_ID,
            policyVersionId: POLICY_VERSION_ID,
          },
          // deno-lint-ignore no-explicit-any
        } as any,
        PROJECT_ID,
        body,
        EXEC_CONTEXT,
      ),
    ApiHttpError,
  );
  assertEquals(err.code, "internal_error");
});

Deno.test("API-N.6: base adapter is wrapper-locked and maps insufficient privilege", async () => {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const client = {
    rpc: (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return Promise.resolve({ data: APPLIED, error: null });
    },
  };
  const input = {
    expectedOauthClientId: OAUTH_CLIENT_ID,
    projectId: PROJECT_ID,
    expectedUpdatedAt: UPDATED_AT,
    name: null,
    setName: false,
    priority: null,
    setPriority: false,
    description: null,
    setDescription: false,
    charter: null,
    setCharter: false,
    goals: null,
    setGoals: false,
    scopeIn: null,
    setScopeIn: false,
    scopeOut: null,
    setScopeOut: false,
    businessCase: null,
    setBusinessCase: false,
    successCriteria: null,
    setSuccessCriteria: false,
    completionCriteria: null,
    setCompletionCriteria: false,
    budgetNarrative: null,
    setBudgetNarrative: false,
    assumptions: null,
    setAssumptions: false,
    constraints: null,
    setConstraints: false,
    programId: null,
    setProgramId: false,
    deliveryModel: null,
    setDeliveryModel: false,
    requestId: "req-1",
    correlationId: "corr-1",
    idempotencyKey: "key-1",
    payloadHash: "a".repeat(64),
  };

  // deno-lint-ignore no-explicit-any
  const result = await updateApiV1Project(client as any, input as any);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].fn, "api_v1_update_project");
  assertEquals(result, {
    ok: true,
    outcome: "applied",
    projectId: PROJECT_ID,
    updatedAt: UPDATED_AT,
  });

  // The adapter takes no function-name argument at all.
  assertEquals(updateApiV1Project.length, 2);

  const denied = {
    rpc: () => Promise.resolve({ data: null, error: { code: "42501" } }),
  };
  const err = await assertRejects(
    // deno-lint-ignore no-explicit-any
    () => updateApiV1Project(denied as any, input as any),
    ApiHttpError,
  );
  assertEquals(err.code, "not_authorized");

  // A value supplied without its presence flag is a contract violation.
  const bad = await assertRejects(
    () =>
      updateApiV1Project(
        // deno-lint-ignore no-explicit-any
        client as any,
        // deno-lint-ignore no-explicit-any
        { ...input, name: "Project A", setName: false } as any,
      ),
    ApiHttpError,
  );
  assertEquals(bad.code, "internal_error");
});

// ---------------------------------------------------------------------------
// 9. API-N.6-C1 — handler-level durable-activity regression evidence.
//
// Fully dependency-injected: no environment, network, Supabase client, OAuth
// flow or browser is touched. These tests assert ONLY which Project mutation
// outcomes schedule durable activity.
// ---------------------------------------------------------------------------

const HANDLER_ALLOWED_ORIGIN = "https://app.example.com";
const HANDLER_TENANT_SCOPE = Object.freeze({
  tenantId: "aaaaaaaa-1111-4111-8111-111111111111",
  organizationId: "bbbbbbbb-1111-4111-8111-111111111111",
  workspaceId: "cccccccc-1111-4111-8111-111111111111",
  projectId: PROJECT_ID,
});

interface ActivityTrace {
  readonly scopeCalls: Array<{ targetType: string; targetId: string }>;
  // deno-lint-ignore no-explicit-any
  readonly recorded: any[];
  scheduled: number;
}

let handlerPending: Promise<boolean>[] = [];

async function settleHandlerActivity(): Promise<void> {
  const tasks = handlerPending;
  handlerPending = [];
  await Promise.allSettled(tasks);
}

function makeHandlerDeps(result: unknown): {
  // deno-lint-ignore no-explicit-any
  readonly deps: any;
  readonly trace: ActivityTrace;
} {
  const trace: ActivityTrace = {
    scopeCalls: [],
    recorded: [],
    scheduled: 0,
  };

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

  let clock = 1_000;

  const deps = {
    controls: parseApiRuntimeControls({
      BTPM_API_ENABLED: "true",
      BTPM_API_READS_ENABLED: "true",
      BTPM_API_MUTATIONS_ENABLED: "true",
    }),
    allowedOrigins: new Set<string>([HANDLER_ALLOWED_ORIGIN]),
    timeoutMs: 5_000,
    requestId: { randomUUID: () => "req-n6-c1-0001" },
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
      createProject: () => Promise.resolve(result),
      updateProject: () => Promise.resolve(result),
    },
    activity: {
      recorder: {
        // deno-lint-ignore no-explicit-any
        record: (input: any) => {
          trace.recorded.push(input);
          return Promise.resolve(true);
        },
      },
      nowMs: () => (clock += 5),
      schedule: (task: Promise<boolean>) => {
        trace.scheduled += 1;
        handlerPending.push(task);
      },
      scopeResolver: {
        resolve: (targetType: string, targetId: string) => {
          trace.scopeCalls.push({ targetType, targetId });
          return Promise.resolve(HANDLER_TENANT_SCOPE);
        },
      },
    },
  };

  return { deps, trace };
}

function handlerRequest(
  method: "POST" | "PATCH",
  path: string,
  body: unknown,
): Request {
  return new Request(`https://api.example.test${path}`, {
    method,
    headers: new Headers({
      Origin: HANDLER_ALLOWED_ORIGIN,
      "Content-Type": "application/json",
      "Idempotency-Key": "idem-n6-c1-0001",
    }),
    body: JSON.stringify(body),
  });
}

const CREATE_BODY = Object.freeze({
  workspaceId: HANDLER_TENANT_SCOPE.workspaceId,
  name: "Project A",
  programId: PROGRAM_ID,
});

const UPDATE_BODY = Object.freeze({
  expectedUpdatedAt: UPDATED_AT,
  name: "Project A",
});

async function runHandlerCase(
  method: "POST" | "PATCH",
  result: unknown,
): Promise<{ status: number; trace: ActivityTrace }> {
  const { deps, trace } = makeHandlerDeps(result);
  const response = await handleApiV1Request(
    method === "POST"
      ? handlerRequest("POST", "/v1/projects", CREATE_BODY)
      : handlerRequest("PATCH", `/v1/projects/${PROJECT_ID}`, UPDATE_BODY),
    deps,
  );
  const status = response.status;
  await response.json();
  await settleHandlerActivity();
  return { status, trace };
}

Deno.test("API-N.6-C1: Project create applied schedules durable activity", async () => {
  const { status, trace } = await runHandlerCase("POST", {
    ok: true,
    outcome: "applied",
    projectId: PROJECT_ID,
  });
  assertEquals(status, 201);
  assertEquals(trace.scheduled, 1);
  assertEquals(trace.recorded.length, 1);
  assertEquals(trace.scopeCalls, [
    { targetType: "project", targetId: PROJECT_ID },
  ]);
  assertEquals(trace.recorded[0].routeId, "projects.create");
  assertEquals(trace.recorded[0].method, "POST");
  assertEquals(trace.recorded[0].projectId, PROJECT_ID);
});

Deno.test("API-N.6-C1: Project create replayed preserves pre-N.6 durable activity", async () => {
  const { status, trace } = await runHandlerCase("POST", {
    ok: true,
    outcome: "replayed",
    projectId: PROJECT_ID,
  });
  assertEquals(status, 200);
  assertEquals(trace.scheduled, 1);
  assertEquals(trace.recorded.length, 1);
  assertEquals(trace.recorded[0].routeId, "projects.create");
});

Deno.test("API-N.6-C1: Project update applied schedules durable activity", async () => {
  const { status, trace } = await runHandlerCase("PATCH", {
    ok: true,
    outcome: "applied",
    projectId: PROJECT_ID,
    updatedAt: UPDATED_AT,
  });
  assertEquals(status, 200);
  assertEquals(trace.scheduled, 1);
  assertEquals(trace.recorded.length, 1);
  assertEquals(trace.recorded[0].routeId, "projects.update");
  assertEquals(trace.recorded[0].method, "PATCH");
});

Deno.test("API-N.6-C1: Project update no_change schedules no durable activity", async () => {
  const { status, trace } = await runHandlerCase("PATCH", {
    ok: true,
    outcome: "no_change",
    projectId: PROJECT_ID,
    updatedAt: UPDATED_AT,
  });
  assertEquals(status, 200);
  assertEquals(trace.scheduled, 0);
  assertEquals(trace.recorded.length, 0);
  assertEquals(trace.scopeCalls.length, 0);
});

Deno.test("API-N.6-C1: Project update replayed schedules no durable activity", async () => {
  const { status, trace } = await runHandlerCase("PATCH", {
    ok: true,
    outcome: "replayed",
    projectId: PROJECT_ID,
    updatedAt: UPDATED_AT,
  });
  assertEquals(status, 200);
  assertEquals(trace.scheduled, 0);
  assertEquals(trace.recorded.length, 0);
  assertEquals(trace.scopeCalls.length, 0);
});
