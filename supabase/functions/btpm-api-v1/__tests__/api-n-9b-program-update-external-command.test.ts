// API-N.9B — static + behavioural guards for the accepted external Program
// update command: PATCH /v1/programs/{programId} (programs.update).
//
// These guards assert exactly the accepted architecture: one dedicated
// transactional database wrapper, a delegated caller-bound anon-key executor, a
// strict closed-schema body parser, deterministic canonical idempotency payload
// construction including the URL-borne Program identity, no generic mutation
// dispatcher, and no Connected App enablement write on this path.

import {
  assert,
  assertEquals,
  assertRejects,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  API_V1_ROUTE_ALLOWLIST,
  executeApiUpdateProgramRoute,
  matchApiRoute,
  parseApiRuntimeControls,
} from "../router.ts";
import {
  PROGRAM_CREATE_ROUTE,
  PROGRAM_UPDATE_ROUTE,
  buildApiV1UpdateProgramIdempotencyPayload,
  parseApiV1ProgramUpdatePath,
  parseApiV1UpdateProgramBody,
} from "../routes/programs.ts";
import { buildCapabilitiesPayload } from "../routes/capabilities.ts";
import { ApiHttpError } from "../../_shared/btpm-api/http.ts";
import {
  updateApiV1Program,
  type ApiV1UpdateProgramRpcArgs,
} from "../../_shared/btpm-api/supabaseProgramMutation.ts";
import { createDelegatedApiV1UpdateProgramExecutor } from "../../_shared/btpm-api/supabaseDelegatedProgramMutation.ts";

const UUID = "11111111-1111-4111-8111-111111111111";
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const HASH = "a".repeat(64);
const TS = "2026-01-15T10:20:30.123456+00:00";

async function readSource(relative: string): Promise<string> {
  return await Deno.readTextFile(new URL(relative, import.meta.url));
}

// ---------------------------------------------------------------------------
// A. Route registration
// ---------------------------------------------------------------------------

Deno.test("API-N.9B: PROGRAM_UPDATE_ROUTE is frozen and exactly specified", () => {
  assert(Object.isFrozen(PROGRAM_UPDATE_ROUTE));
  assertEquals(PROGRAM_UPDATE_ROUTE.id, "programs.update");
  assertEquals(PROGRAM_UPDATE_ROUTE.method, "PATCH");
  assertEquals(PROGRAM_UPDATE_ROUTE.path, "/v1/programs/:programid");
  assertEquals(PROGRAM_UPDATE_ROUTE.operation, "mutation");
});

Deno.test("API-N.9B: the command is registered exactly once", () => {
  const byId = API_V1_ROUTE_ALLOWLIST.filter((r) => r.id === "programs.update");
  assertEquals(byId.length, 1);
  assertEquals(
    API_V1_ROUTE_ALLOWLIST.filter((r) => r === PROGRAM_UPDATE_ROUTE).length,
    1,
  );
  assertEquals(byId[0], PROGRAM_UPDATE_ROUTE);
});

Deno.test("API-N.9B: only an exact PATCH /v1/programs/<uuid> matches", () => {
  assertEquals(
    matchApiRoute("PATCH", `/v1/programs/${UUID}`),
    PROGRAM_UPDATE_ROUTE,
  );
  for (const method of ["POST", "PUT", "DELETE", "HEAD", "patch"]) {
    assertEquals(matchApiRoute(method, `/v1/programs/${UUID}`), null, method);
  }
  for (
    const path of [
      "/v1/programs",
      "/v1/programs/",
      `/v1/programs/${UUID}/`,
      `/v1/programs/${UUID}/archive`,
      `/v1/programs/${UUID}?x=1`,
      `/v1/Programs/${UUID}`,
      `/v1/programs/${NIL_UUID}`,
      "/v1/programs/not-a-uuid",
    ]
  ) {
    assertEquals(matchApiRoute("PATCH", path), null, path);
  }
});

Deno.test("API-N.9B: create and update remain distinct routes", () => {
  assert(PROGRAM_UPDATE_ROUTE !== PROGRAM_CREATE_ROUTE);
  assertEquals(matchApiRoute("POST", "/v1/programs"), PROGRAM_CREATE_ROUTE);
});

Deno.test("API-N.9B: capabilities advertise programs.update exactly once", () => {
  const ops = buildCapabilitiesPayload().supportedOperations as
    readonly string[];
  assertEquals(ops.filter((o) => o === "programs.update").length, 1);
});

// ---------------------------------------------------------------------------
// B. Path parsing
// ---------------------------------------------------------------------------

Deno.test("API-N.9B: the path parser accepts only one exact shape", () => {
  assertEquals(parseApiV1ProgramUpdatePath(`/v1/programs/${UUID}`), {
    programId: UUID,
  });
  for (
    const path of [
      "/v1/programs",
      "/v1/programs/",
      `/v1/programs/${UUID}/`,
      `/v1/programs/${UUID}/extra`,
      `/v1/programs/${UUID}?x=1`,
      `/v1/programs/${UUID}#x`,
      `/v1/programs/${NIL_UUID}`,
      `/v1/projects/${UUID}`,
    ]
  ) {
    assertThrows(
      () => parseApiV1ProgramUpdatePath(path),
      ApiHttpError,
      undefined,
      path,
    );
  }
});

// ---------------------------------------------------------------------------
// C. Strict closed-schema body parsing
// ---------------------------------------------------------------------------

Deno.test("API-N.9B: expectedUpdatedAt is mandatory and preserved verbatim", () => {
  const parsed = parseApiV1UpdateProgramBody({ expectedUpdatedAt: TS });
  assertEquals(parsed.expectedUpdatedAt, TS);
  assertEquals(parsed.name, null);
  assertEquals(parsed.status, null);
  assertEquals(parsed.description, null);
  assertEquals(parsed.setDescription, false);
  assert(Object.isFrozen(parsed));

  assertThrows(() => parseApiV1UpdateProgramBody({}), ApiHttpError);
  for (
    const bad of [
      "2026-01-15",
      "2026-01-15T10:20:30",
      "2026-13-15T10:20:30Z",
      "2026-02-30T10:20:30Z",
      "not-a-timestamp",
      123,
      null,
    ]
  ) {
    assertThrows(
      () => parseApiV1UpdateProgramBody({ expectedUpdatedAt: bad }),
      ApiHttpError,
    );
  }
});

Deno.test("API-N.9B: name is btrim-normalized and never clearable", () => {
  const parsed = parseApiV1UpdateProgramBody({
    expectedUpdatedAt: TS,
    name: "   S/4 Rollout   ",
  });
  assertEquals(parsed.name, "S/4 Rollout");
  for (const bad of [null, "", "   ", 5, {}]) {
    assertThrows(
      () => parseApiV1UpdateProgramBody({ expectedUpdatedAt: TS, name: bad }),
      ApiHttpError,
    );
  }
});

Deno.test("API-N.9B: status accepts only the canonical vocabulary", () => {
  for (
    const status of ["planned", "active", "completed", "on_hold", "cancelled"]
  ) {
    assertEquals(
      parseApiV1UpdateProgramBody({ expectedUpdatedAt: TS, status }).status,
      status,
    );
  }
  for (const bad of [null, "", "Active", "archived", "unknown", 1]) {
    assertThrows(
      () => parseApiV1UpdateProgramBody({ expectedUpdatedAt: TS, status: bad }),
      ApiHttpError,
    );
  }
});

Deno.test("API-N.9B: description presence semantics are preserved", () => {
  const absent = parseApiV1UpdateProgramBody({ expectedUpdatedAt: TS });
  assertEquals(absent.setDescription, false);
  assertEquals(absent.description, null);

  const cleared = parseApiV1UpdateProgramBody({
    expectedUpdatedAt: TS,
    description: null,
  });
  assertEquals(cleared.setDescription, true);
  assertEquals(cleared.description, null);

  const blank = parseApiV1UpdateProgramBody({
    expectedUpdatedAt: TS,
    description: "   ",
  });
  assertEquals(blank.setDescription, true);
  assertEquals(blank.description, null);

  const set = parseApiV1UpdateProgramBody({
    expectedUpdatedAt: TS,
    description: "  wave one  ",
  });
  assertEquals(set.setDescription, true);
  assertEquals(set.description, "wave one");
});

Deno.test("API-N.9B: unknown, protected and structural fields are rejected", () => {
  for (
    const key of [
      "workspaceId",
      "organizationId",
      "tenantId",
      "programId",
      "archived",
      "id",
      "createdAt",
      "updatedAt",
      "unknown",
    ]
  ) {
    assertThrows(
      () =>
        parseApiV1UpdateProgramBody({
          expectedUpdatedAt: TS,
          [key]: "x",
        }),
      ApiHttpError,
      undefined,
      key,
    );
  }
  for (const bad of [null, [], "x", 1, true]) {
    assertThrows(() => parseApiV1UpdateProgramBody(bad), ApiHttpError);
  }
});

// ---------------------------------------------------------------------------
// D. Canonical idempotency payload determinism
// ---------------------------------------------------------------------------

Deno.test("API-N.9B: the canonical payload folds in the URL-borne Program identity", () => {
  const body = parseApiV1UpdateProgramBody({
    expectedUpdatedAt: TS,
    name: " Alpha ",
  });
  const payload = buildApiV1UpdateProgramIdempotencyPayload(UUID, body);
  assertEquals(payload, {
    programId: UUID,
    expectedUpdatedAt: TS,
    name: "Alpha",
    status: null,
    setDescription: false,
    description: null,
  });
});

Deno.test("API-N.9B: absent description never hashes identically to an explicit clear", () => {
  const absent = buildApiV1UpdateProgramIdempotencyPayload(
    UUID,
    parseApiV1UpdateProgramBody({ expectedUpdatedAt: TS }),
  );
  const cleared = buildApiV1UpdateProgramIdempotencyPayload(
    UUID,
    parseApiV1UpdateProgramBody({ expectedUpdatedAt: TS, description: null }),
  );
  assert(JSON.stringify(absent) !== JSON.stringify(cleared));
});

Deno.test("API-N.9B: the canonical payload carries no execution or identity metadata", () => {
  const payload = buildApiV1UpdateProgramIdempotencyPayload(
    UUID,
    parseApiV1UpdateProgramBody({ expectedUpdatedAt: TS }),
  );
  for (
    const forbidden of [
      "requestId",
      "correlationId",
      "idempotencyKey",
      "payloadHash",
      "apiClientId",
      "oauthClientId",
      "userId",
      "tenantId",
      "organizationId",
      "workspaceId",
    ]
  ) {
    assert(!(forbidden in payload), forbidden);
  }
});

// ---------------------------------------------------------------------------
// E. RPC adapter contract
// ---------------------------------------------------------------------------

function stubClient(data: unknown, error: unknown = null) {
  const calls: { name: string; args: ApiV1UpdateProgramRpcArgs }[] = [];
  return {
    calls,
    client: {
      rpc(name: string, args: ApiV1UpdateProgramRpcArgs) {
        calls.push({ name, args });
        return Promise.resolve({ data, error });
      },
    },
  };
}

const BASE_INPUT = Object.freeze({
  expectedOauthClientId: "btpm-partner-app",
  programId: UUID,
  expectedUpdatedAt: TS,
  name: "Alpha",
  status: "active",
  description: null,
  setDescription: false,
  requestId: "req-1",
  correlationId: "corr-1",
  idempotencyKey: "idem-1",
  payloadHash: HASH,
});

Deno.test("API-N.9B: the adapter invokes exactly the accepted wrapper name and argument shape", async () => {
  const stub = stubClient({
    ok: true,
    outcome: "applied",
    programId: UUID,
    updatedAt: TS,
  });
  const result = await updateApiV1Program(stub.client, BASE_INPUT);
  assertEquals(stub.calls.length, 1);
  assertEquals(stub.calls[0].name, "api_v1_update_program");
  assertEquals(Object.keys(stub.calls[0].args).sort(), [
    "_correlation_id",
    "_description",
    "_expected_oauth_client_id",
    "_expected_updated_at",
    "_idempotency_key",
    "_name",
    "_payload_hash",
    "_program_id",
    "_request_id",
    "_set_description",
    "_status",
  ]);
  assertEquals(result, {
    ok: true,
    outcome: "applied",
    programId: UUID,
    updatedAt: TS,
  });
});

Deno.test("API-N.9B: no_change and replayed success outcomes are accepted", async () => {
  for (const outcome of ["no_change", "replayed"]) {
    const stub = stubClient({
      ok: true,
      outcome,
      programId: UUID,
      updatedAt: TS,
    });
    const result = await updateApiV1Program(stub.client, BASE_INPUT);
    assertEquals(result.ok, true);
    assertEquals((result as { outcome: string }).outcome, outcome);
  }
});

Deno.test("API-N.9B: the bounded conflict result exposes no server timestamp", async () => {
  const stub = stubClient({
    ok: false,
    outcome: "conflict",
    code: "stale_program",
  });
  const result = await updateApiV1Program(stub.client, BASE_INPUT);
  assertEquals(result, { ok: false, outcome: "conflict", code: "stale_program" });
  assert(!("currentUpdatedAt" in result));
});

Deno.test("API-N.9B: every bounded negative outcome is preserved", async () => {
  for (
    const outcome of [
      "invalid",
      "not_authorized",
      "idempotency_conflict",
      "idempotency_pending",
    ]
  ) {
    const stub = stubClient({ ok: false, outcome });
    assertEquals(await updateApiV1Program(stub.client, BASE_INPUT), {
      ok: false,
      outcome,
    });
  }
});

Deno.test("API-N.9B: unexpected wrapper payloads and extra keys fail closed", async () => {
  for (
    const data of [
      null,
      "x",
      { ok: true },
      { ok: true, outcome: "applied", programId: UUID },
      { ok: true, outcome: "unknown", programId: UUID, updatedAt: TS },
      {
        ok: true,
        outcome: "applied",
        programId: UUID,
        updatedAt: TS,
        name: "leak",
      },
      { ok: false, outcome: "conflict", code: "other" },
      { ok: false, outcome: "unknown" },
      { ok: false, outcome: "invalid", extra: 1 },
    ]
  ) {
    const stub = stubClient(data);
    await assertRejects(
      () => updateApiV1Program(stub.client, BASE_INPUT),
      ApiHttpError,
    );
  }
});

Deno.test("API-N.9B: insufficient privilege maps to not_authorized, other errors to internal", async () => {
  const denied = stubClient(null, { code: "42501" });
  const deniedError = await assertRejects(
    () => updateApiV1Program(denied.client, BASE_INPUT),
    ApiHttpError,
  );
  assertEquals(deniedError.code, "not_authorized");

  const failed = stubClient(null, { code: "XX000" });
  const failedError = await assertRejects(
    () => updateApiV1Program(failed.client, BASE_INPUT),
    ApiHttpError,
  );
  assertEquals(failedError.code, "internal_error");
});

Deno.test("API-N.9B: an inconsistent description presence contract fails closed", async () => {
  const stub = stubClient({
    ok: true,
    outcome: "applied",
    programId: UUID,
    updatedAt: TS,
  });
  await assertRejects(
    () =>
      updateApiV1Program(stub.client, {
        ...BASE_INPUT,
        setDescription: false,
        description: "unchanged means null",
      }),
    ApiHttpError,
  );
  assertEquals(stub.calls.length, 0);
});

// ---------------------------------------------------------------------------
// F. Architecture guards
// ---------------------------------------------------------------------------

Deno.test("API-N.9B: the Program mutation modules stay free of privileged or generic behavior", async () => {
  for (
    const file of [
      "../../_shared/btpm-api/supabaseProgramMutation.ts",
      "../../_shared/btpm-api/supabaseDelegatedProgramMutation.ts",
      "../routes/programs.ts",
    ]
  ) {
    const src = await readSource(file);
    for (
      const forbidden of [
        "SERVICE_ROLE",
        "service_role",
        "Deno.env",
        "fetch(",
        "console.",
        "setTimeout",
        "execute_sql",
        "api_organization_client_enablements",
        "api_workspace_client_enablements",
        "api_project_client_enablements",
      ]
    ) {
      assert(!src.includes(forbidden), `${file}: ${forbidden}`);
    }
  }
});

Deno.test("API-N.9B: the update path performs no Program read and writes no enablement row", async () => {
  const src = await readSource(
    "../../_shared/btpm-api/supabaseDelegatedProgramMutation.ts",
  );
  assert(src.includes("createDelegatedApiV1UpdateProgramExecutor"));
  for (
    const forbidden of [
      "from(",
      "select(",
      "insert(",
      "upsert(",
      "public.programs",
    ]
  ) {
    assert(!src.includes(forbidden), forbidden);
  }
});

Deno.test("API-N.9B: the runtime keeps a dedicated Program update dispatch, not a generic one", async () => {
  const handler = await readSource("../handler.ts");
  assert(handler.includes("executeApiUpdateProgramRoute"));
  assert(handler.includes("isProgramUpdatePath"));
  assert(handler.includes("PROGRAM_UPDATE_ROUTE"));
  // No generic Program subresource or wildcard dispatch.
  assert(!handler.includes("/v1/programs/*"));

  const index = await readSource("../index.ts");
  assert(index.includes("createDelegatedApiV1UpdateProgramExecutor"));
  assert(index.includes("route !== PROGRAM_UPDATE_ROUTE"));
});

// ---------------------------------------------------------------------------
// API-N.9B-C1 — unified Program mutation dependency contract.
//
// These focused injected tests prove that the single Program mutation
// dependency object (`ApiProgramMutationRouteDependencies`) drives BOTH
// explicit Program executors, that the update pipeline order and single
// execution remain exact, that mutation controls fail closed before execution,
// and that the delegated update executor stays caller-bound.
// ---------------------------------------------------------------------------

const C1_PROGRAM_ID = "44444444-4444-4444-8444-444444444444";
const C1_USER_ID = "55555555-5555-4555-8555-555555555555";
const C1_API_CLIENT_ID = "66666666-6666-4666-8666-666666666666";
const C1_POLICY_VERSION_ID = "77777777-7777-4777-8777-777777777777";
const C1_OAUTH_CLIENT_ID = "astra-client";
const C1_UPDATED_AT = "2026-03-01T10:20:30.123456+00:00";

const C1_AUTH_CONTEXT = Object.freeze({
  token: Object.freeze({
    userId: C1_USER_ID,
    clientId: C1_OAUTH_CLIENT_ID,
  }),
  client: Object.freeze({
    userId: C1_USER_ID,
    apiClientId: C1_API_CLIENT_ID,
    oauthClientId: C1_OAUTH_CLIENT_ID,
    policyVersionId: C1_POLICY_VERSION_ID,
  }),
});

const C1_ENABLED = parseApiRuntimeControls({
  BTPM_API_ENABLED: "true",
  BTPM_API_READS_ENABLED: "true",
  BTPM_API_MUTATIONS_ENABLED: "true",
});

function c1UpdateBody(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return { expectedUpdatedAt: C1_UPDATED_AT, ...overrides };
}

function c1ProgramDeps(result: unknown) {
  const order: string[] = [];
  const counters = { update: 0, create: 0, authenticate: 0, authorize: 0 };
  const captured: Array<{ programId: string; body: unknown }> = [];
  return {
    order,
    counters,
    captured,
    deps: {
      authenticate: () => {
        counters.authenticate++;
        order.push("authenticate");
        return Promise.resolve(C1_AUTH_CONTEXT);
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
      createProgram: () => {
        counters.create++;
        return Promise.reject(new Error("create must never run here"));
      },
      updateProgram: (
        _request: Request,
        _context: unknown,
        programId: string,
        body: unknown,
      ) => {
        counters.update++;
        order.push("updateProgram");
        captured.push({ programId, body });
        return Promise.resolve(result);
      },
      // deno-lint-ignore no-explicit-any
    } as any,
  };
}

function c1UpdateRequest(path = `/v1/programs/${C1_PROGRAM_ID}`): Request {
  return new Request(`https://api.example.test${path}`, {
    method: "PATCH",
    headers: {
      Authorization: "Bearer caller-token",
      "Idempotency-Key": "c1-key-1",
    },
    body: "{}",
  });
}

Deno.test("API-N.9B-C1: the runtime keeps exactly one Program mutation dependency contract", async () => {
  const router = await readSource("../router.ts");
  assert(router.includes("export interface ApiProgramMutationRouteDependencies"));
  assert(!router.includes("ApiProgramUpdateRouteDependencies"));
  assert(!router.includes("validateProgramUpdateDependencies"));
  // Both explicit executors survive; no generic Program action function.
  assert(router.includes("export async function executeApiCreateProgramRoute"));
  assert(router.includes("export async function executeApiUpdateProgramRoute"));

  const handler = await readSource("../handler.ts");
  assert(!handler.includes("programUpdateRoute?"));
  assert(!handler.includes("deps.programUpdateRoute"));
  assert(handler.includes("deps.programMutationRoute"));

  const index = await readSource("../index.ts");
  assert(!index.includes("ApiProgramUpdateRouteDependencies"));
  assert(index.includes("programMutationRoute"));
  assert(index.includes("updateProgram,"));
  assert(index.includes("createProgram,"));
});

Deno.test("API-N.9B-C1: update order is authenticate → authorizeRoute → rateLimit → updateProgram exactly once", async () => {
  const applied = {
    ok: true,
    outcome: "applied",
    programId: C1_PROGRAM_ID,
    updatedAt: C1_UPDATED_AT,
  } as const;
  const d = c1ProgramDeps(applied);
  const ok = await executeApiUpdateProgramRoute(
    c1UpdateRequest(),
    c1UpdateBody({ name: "Program A" }),
    "c1-req-1",
    C1_ENABLED,
    d.deps,
  );
  assertEquals(ok.route, PROGRAM_UPDATE_ROUTE);
  assertEquals(ok.status, 200);
  assertEquals(ok.payload, applied);
  assertEquals(d.order, [
    "authenticate",
    "authorizeRoute",
    "rateLimit",
    "updateProgram",
  ]);
  assertEquals(d.counters.update, 1);
  assertEquals(d.counters.create, 0);
  assertEquals(d.captured[0].programId, C1_PROGRAM_ID);
});

Deno.test("API-N.9B-C1: a Program dependency object missing either executor fails closed", async () => {
  for (const drop of ["createProgram", "updateProgram"] as const) {
    const d = c1ProgramDeps({
      ok: true,
      outcome: "applied",
      programId: C1_PROGRAM_ID,
      updatedAt: C1_UPDATED_AT,
    });
    const deps = { ...(d.deps as Record<string, unknown>) };
    delete deps[drop];
    const err = await assertRejects(
      () =>
        executeApiUpdateProgramRoute(
          c1UpdateRequest(),
          c1UpdateBody(),
          "c1-req-2",
          C1_ENABLED,
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

Deno.test("API-N.9B-C1: mutation-disabled controls fail closed before updateProgram", async () => {
  for (
    const env of [
      { BTPM_API_ENABLED: "true", BTPM_API_READS_ENABLED: "true", BTPM_API_MUTATIONS_ENABLED: "false" },
      { BTPM_API_ENABLED: "false", BTPM_API_READS_ENABLED: "true", BTPM_API_MUTATIONS_ENABLED: "true" },
    ]
  ) {
    const controls = parseApiRuntimeControls(env);
    const d = c1ProgramDeps({
      ok: true,
      outcome: "applied",
      programId: C1_PROGRAM_ID,
      updatedAt: C1_UPDATED_AT,
    });
    await assertRejects(
      () =>
        executeApiUpdateProgramRoute(
          c1UpdateRequest(),
          c1UpdateBody(),
          "c1-req-3",
          controls,
          d.deps,
        ),
      ApiHttpError,
    );
    assertEquals(d.counters.update, 0);
    assertEquals(d.counters.authenticate, 0);
  }
});

Deno.test("API-N.9B-C1: applied, no_change and replayed all remain HTTP 200", async () => {
  for (const outcome of ["applied", "no_change", "replayed"] as const) {
    const payload = {
      ok: true,
      outcome,
      programId: C1_PROGRAM_ID,
      updatedAt: C1_UPDATED_AT,
    } as const;
    const d = c1ProgramDeps(payload);
    const ok = await executeApiUpdateProgramRoute(
      c1UpdateRequest(),
      c1UpdateBody({ name: "Program A" }),
      "c1-req-4",
      C1_ENABLED,
      d.deps,
    );
    assertEquals(ok.status, 200);
    assertEquals(ok.payload, payload);
    assertEquals(d.counters.update, 1);
  }
});

Deno.test("API-N.9B-C1: conflict maps to the concurrency-conflict boundary without exposing stale_program", async () => {
  const d = c1ProgramDeps({
    ok: false,
    outcome: "conflict",
    code: "stale_program",
  });
  const err = await assertRejects(
    () =>
      executeApiUpdateProgramRoute(
        c1UpdateRequest(),
        c1UpdateBody({ name: "Program A" }),
        "c1-req-5",
        C1_ENABLED,
        d.deps,
      ),
    ApiHttpError,
  );
  assertEquals(err.code, "concurrency_conflict");
  assert(!err.message.includes("stale_program"));
});

Deno.test("API-N.9B-C1: the delegated update executor is caller-bound and identity-consistent", async () => {
  const factoryCalls: Array<{ url: string; key: string; auth: string }> = [];
  const rpcCalls: string[] = [];
  const createClient = (
    url: string,
    key: string,
    // deno-lint-ignore no-explicit-any
    options: any,
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
            programId: C1_PROGRAM_ID,
            updatedAt: C1_UPDATED_AT,
          },
          error: null,
        });
      },
    };
  };

  const execute = createDelegatedApiV1UpdateProgramExecutor(
    "https://project.supabase.co",
    "anon-key",
    createClient,
  );

  const executionContext = {
    requestedUserId: C1_USER_ID,
    executingUserId: C1_USER_ID,
    apiClientId: C1_API_CLIENT_ID,
    oauthClientId: C1_OAUTH_CLIENT_ID,
    policyVersionId: C1_POLICY_VERSION_ID,
    sourceChannel: "external_api",
    delegationMode: "delegated_user",
    requestId: "c1-req-6",
    correlationId: "c1-corr-6",
    idempotencyKey: "c1-key-6",
    payloadHash: HASH,
  };
  const body = parseApiV1UpdateProgramBody(c1UpdateBody({ name: "Program A" }));

  for (const token of ["token-a", "token-b"]) {
    await execute(
      new Request(`https://api.example.test/v1/programs/${C1_PROGRAM_ID}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}` },
      }),
      // deno-lint-ignore no-explicit-any
      C1_AUTH_CONTEXT as any,
      C1_PROGRAM_ID,
      body,
      // deno-lint-ignore no-explicit-any
      executionContext as any,
    );
  }

  // A fresh client per invocation, each forwarding the current bearer token.
  assertEquals(factoryCalls.length, 2);
  assertEquals(factoryCalls[0].auth, "Bearer token-a");
  assertEquals(factoryCalls[1].auth, "Bearer token-b");
  assertEquals(factoryCalls[0].key, "anon-key");
  assertEquals(rpcCalls, ["api_v1_update_program", "api_v1_update_program"]);

  // Identity inconsistency is refused before any RPC.
  const before = rpcCalls.length;
  await assertRejects(
    () =>
      execute(
        new Request(`https://api.example.test/v1/programs/${C1_PROGRAM_ID}`, {
          method: "PATCH",
          headers: { Authorization: "Bearer token-c" },
        }),
        // deno-lint-ignore no-explicit-any
        C1_AUTH_CONTEXT as any,
        C1_PROGRAM_ID,
        body,
        // deno-lint-ignore no-explicit-any
        { ...executionContext, executingUserId: C1_API_CLIENT_ID } as any,
      ),
    ApiHttpError,
  );
  assertEquals(rpcCalls.length, before);
});
