// Relocated out of supabase/functions/ (Edge deploy bundle size).
// Source-file reads stay anchored to the original module location.
const __BTPM_SELF_URL__ = import.meta.url;
const __BTPM_SRC_BASE__ = new URL('../../../../functions/_shared/btpm-api/__tests__/api-i-7-delegated-append-execution-update.test.ts', import.meta.url).href;
// API-I.7 — Focused tests for the delegated Edge mutation executor and
// its explicit RPC adapter.

import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { ApiHttpError } from "../../../../functions/_shared/btpm-api/http.ts";
import { ApiAuthenticationError } from "../../../../functions/_shared/btpm-api/apiErrors.ts";
import {
  appendApiV1ExecutionUpdate,
  type ApiV1AppendExecutionUpdateInput,
  type ApiV1AppendExecutionUpdateRpcArgs,
} from "../../../../functions/_shared/btpm-api/supabaseAppendExecutionUpdate.ts";
import { createDelegatedApiV1AppendExecutionUpdateExecutor } from "../../../../functions/_shared/btpm-api/supabaseDelegatedAppendExecutionUpdate.ts";
import { API_V1_ROUTE_ALLOWLIST } from "../../../../functions/btpm-api-v1/router.ts";

const TARGET_ID = "8f14e45f-ceea-467a-a4a7-2b4b0c7f4d21";
const UPDATE_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const USER_ID = "9c858901-8a57-4791-81fe-4c455b099bc9";
const API_CLIENT_ID = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
const POLICY_VERSION_ID = "6ba7b810-9dad-41d1-80b4-00c04fd430c8";
const OAUTH_CLIENT_ID = "btpm-connected-app";
const PAYLOAD_HASH = "a".repeat(64);

const INPUT: ApiV1AppendExecutionUpdateInput = Object.freeze({
  expectedOauthClientId: OAUTH_CLIENT_ID,
  targetType: "phase",
  targetId: TARGET_ID,
  summary: "Progress narrative.",
  updateDate: "2026-08-07",
  statusLabel: "On track",
  requestId: "req-1",
  correlationId: "corr-1",
  idempotencyKey: "idem-1",
  payloadHash: PAYLOAD_HASH,
});

const APPLIED = Object.freeze({
  ok: true,
  outcome: "applied",
  executionUpdateId: UPDATE_ID,
  targetType: "phase",
  targetId: TARGET_ID,
  updateDate: "2026-08-07",
  hasStatusLabel: true,
});

interface Recorded {
  name: string;
  args: Record<string, unknown>;
}

function stubClient(
  outcome: { data?: unknown; error?: unknown } | (() => never),
  recorded: Recorded[] = [],
) {
  return {
    rpc(name: string, args: ApiV1AppendExecutionUpdateRpcArgs) {
      recorded.push({ name, args: { ...args } as Record<string, unknown> });
      if (typeof outcome === "function") outcome();
      const fixed = outcome as { data?: unknown; error?: unknown };
      return Promise.resolve({
        data: fixed.data ?? null,
        error: fixed.error ?? null,
      });
    },
  };
}

// -----------------------------------------------------------------------------
// RPC name and argument mapping
// -----------------------------------------------------------------------------

Deno.test("API-I.7: fixed RPC name and exact ten-argument mapping", async () => {
  const recorded: Recorded[] = [];
  await appendApiV1ExecutionUpdate(
    stubClient({ data: APPLIED }, recorded),
    INPUT,
  );
  assertEquals(recorded.length, 1);
  assertEquals(recorded[0].name, "api_v1_append_execution_update");
  assertEquals(recorded[0].args, {
    _expected_oauth_client_id: OAUTH_CLIENT_ID,
    _target_type: "phase",
    _target_id: TARGET_ID,
    _summary: "Progress narrative.",
    _update_date: "2026-08-07",
    _status_label: "On track",
    _request_id: "req-1",
    _correlation_id: "corr-1",
    _idempotency_key: "idem-1",
    _payload_hash: PAYLOAD_HASH,
  });
  assertEquals(Object.keys(recorded[0].args).length, 10);
});

Deno.test("API-I.7: no parent scope, registry or provenance arguments are sent", async () => {
  const recorded: Recorded[] = [];
  await appendApiV1ExecutionUpdate(
    stubClient({ data: APPLIED }, recorded),
    INPUT,
  );
  for (
    const forbidden of [
      "_tenant_id",
      "_organization_id",
      "_workspace_id",
      "_project_id",
      "_api_client_id",
      "_source_channel",
      "_source_client_id",
      "_delegation_mode",
      "_requested_user_id",
      "_executing_user_id",
      "_integration_id",
      "_policy_version_id",
    ]
  ) {
    assert(!(forbidden in recorded[0].args), `must not send ${forbidden}`);
  }
});

// -----------------------------------------------------------------------------
// Bounded result contract
// -----------------------------------------------------------------------------

Deno.test("API-I.7: applied result exact shape accepted", async () => {
  const result = await appendApiV1ExecutionUpdate(
    stubClient({ data: APPLIED }),
    INPUT,
  );
  assertEquals(result, {
    ok: true,
    outcome: "applied",
    executionUpdateId: UPDATE_ID,
    targetType: "phase",
    targetId: TARGET_ID,
    updateDate: "2026-08-07",
    hasStatusLabel: true,
  });
  assert(Object.isFrozen(result));
});

Deno.test("API-I.7: replayed result exact shape accepted", async () => {
  const result = await appendApiV1ExecutionUpdate(
    stubClient({ data: { ...APPLIED, outcome: "replayed" } }),
    INPUT,
  );
  assertEquals(result.outcome, "replayed");
  assertEquals(result.ok, true);
});

Deno.test("API-I.7: four safe negative outcomes accepted", async () => {
  for (
    const outcome of [
      "invalid",
      "not_authorized",
      "idempotency_conflict",
      "idempotency_pending",
    ]
  ) {
    const result = await appendApiV1ExecutionUpdate(
      stubClient({ data: { ok: false, outcome } }),
      INPUT,
    );
    assertEquals(result, { ok: false, outcome } as typeof result);
  }
});

Deno.test("API-I.7: malformed / extended / narrative results fail closed", async () => {
  const bad: unknown[] = [
    null,
    undefined,
    "applied",
    1,
    true,
    [],
    [APPLIED],
    {},
    { ok: true },
    { ok: "true", outcome: "applied" },
    { ...APPLIED, summary: "leaked narrative" },
    { ...APPLIED, statusLabel: "Amber" },
    { ...APPLIED, projectId: TARGET_ID },
    { ...APPLIED, workspaceId: TARGET_ID },
    { ...APPLIED, organizationId: TARGET_ID },
    { ...APPLIED, tenantId: TARGET_ID },
    { ...APPLIED, payloadHash: PAYLOAD_HASH },
    { ...APPLIED, pmgResult: { rows: 1 } },
    { ...APPLIED, executionUpdateId: "not-a-uuid" },
    { ...APPLIED, executionUpdateId: "00000000-0000-0000-0000-000000000000" },
    { ...APPLIED, targetType: "project" },
    { ...APPLIED, updateDate: "2026-08-07T00:00:00Z" },
    { ...APPLIED, updateDate: "2026-02-30" },
    { ...APPLIED, hasStatusLabel: "true" },
    { ok: true, outcome: "unknown_outcome" },
    { ok: false, outcome: "exploded" },
    { ok: false, outcome: "invalid", detail: "db message" },
  ];
  for (const data of bad) {
    const err = await assertRejects(
      () => appendApiV1ExecutionUpdate(stubClient({ data }), INPUT),
      ApiHttpError,
    );
    assertEquals(err.code, "internal_error");
    assertEquals(err.status, 500);
  }
});

// -----------------------------------------------------------------------------
// RPC error handling
// -----------------------------------------------------------------------------

Deno.test("API-I.7: thrown RPC call becomes internal_error", async () => {
  const err = await assertRejects(
    () =>
      appendApiV1ExecutionUpdate(
        stubClient(() => {
          throw new Error("connection reset at pg://secret");
        }),
        INPUT,
      ),
    ApiHttpError,
  );
  assertEquals(err.code, "internal_error");
  assert(!err.publicMessage.includes("pg://"));
});

Deno.test("API-I.7: SQLSTATE 42501 becomes not_authorized", async () => {
  const err = await assertRejects(
    () =>
      appendApiV1ExecutionUpdate(
        stubClient({
          error: { code: "42501", message: "permission denied for function" },
        }),
        INPUT,
      ),
    ApiHttpError,
  );
  assertEquals(err.code, "not_authorized");
  assertEquals(err.status, 403);
  assertEquals(err.publicMessage, "Not authorized.");
});

Deno.test("API-I.7: other RPC errors become internal_error with no leakage", async () => {
  for (
    const error of [
      { code: "22023", message: "invalid parameter" },
      { code: "P0001", message: "not_authorized", hint: "check scope" },
      { code: "23505", details: "duplicate key value" },
      "boom",
    ]
  ) {
    const err = await assertRejects(
      () => appendApiV1ExecutionUpdate(stubClient({ error }), INPUT),
      ApiHttpError,
    );
    assertEquals(err.code, "internal_error");
    assertEquals(err.publicMessage, "Internal server error.");
  }
});

// -----------------------------------------------------------------------------
// Delegated executor
// -----------------------------------------------------------------------------

function authContext(overrides: Record<string, unknown> = {}) {
  return {
    token: { userId: USER_ID, clientId: OAUTH_CLIENT_ID, ...(overrides.token as object ?? {}) },
    client: {
      userId: USER_ID,
      apiClientId: API_CLIENT_ID,
      oauthClientId: OAUTH_CLIENT_ID,
      policyVersionId: POLICY_VERSION_ID,
      ...(overrides.client as object ?? {}),
    },
  };
}

function execContext(overrides: Record<string, unknown> = {}) {
  return {
    requestedUserId: USER_ID,
    executingUserId: USER_ID,
    apiClientId: API_CLIENT_ID,
    oauthClientId: OAUTH_CLIENT_ID,
    policyVersionId: POLICY_VERSION_ID,
    requestId: "req-1",
    correlationId: "corr-1",
    idempotencyKey: "idem-1",
    payloadHash: PAYLOAD_HASH,
    sourceChannel: "external_api",
    sourceClientId: API_CLIENT_ID,
    delegationMode: "delegated_user",
    ...overrides,
  };
}

const BODY = Object.freeze({
  targetType: "phase",
  targetId: TARGET_ID,
  summary: "Progress narrative.",
  updateDate: "2026-08-07",
  statusLabel: "On track",
});

function mutationRequest(token = "caller.jwt.token") {
  return new Request("https://example.test/v1/execution-updates", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

// deno-lint-ignore no-explicit-any
function harness(rpcOutcome: any = { data: APPLIED }) {
  const created: Array<{ url: string; key: string; options: unknown }> = [];
  const recorded: Recorded[] = [];
  const factory = (url: string, key: string, options: unknown) => {
    created.push({ url, key, options });
    return stubClient(rpcOutcome, recorded);
  };
  const executor = createDelegatedApiV1AppendExecutionUpdateExecutor(
    "https://project.supabase.co",
    "anon-key",
    factory,
  );
  return { created, recorded, executor };
}

Deno.test("API-I.7: delegated executor binds the current caller bearer token", async () => {
  const { created, recorded, executor } = harness();
  // deno-lint-ignore no-explicit-any
  const result = await executor(
    mutationRequest("token-abc"),
    authContext() as any,
    BODY as any,
    execContext() as any,
  );
  assertEquals(result.ok, true);
  assertEquals(created.length, 1);
  assertEquals(created[0].url, "https://project.supabase.co");
  assertEquals(created[0].key, "anon-key");
  assertEquals(created[0].options, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { headers: { Authorization: "Bearer token-abc" } },
  });
  assertEquals(recorded[0].name, "api_v1_append_execution_update");
  assertEquals(recorded[0].args._expected_oauth_client_id, OAUTH_CLIENT_ID);
});

Deno.test("API-I.7: a fresh client is constructed per invocation", async () => {
  const { created, executor } = harness();
  for (const t of ["t1", "t2", "t3"]) {
    // deno-lint-ignore no-explicit-any
    await executor(mutationRequest(t), authContext() as any, BODY as any, execContext() as any);
  }
  assertEquals(created.length, 3);
  assertEquals(
    created.map((c) => (c.options as { global: { headers: { Authorization: string } } }).global.headers.Authorization),
    ["Bearer t1", "Bearer t2", "Bearer t3"],
  );
});

Deno.test("API-I.7: missing bearer token fails before client construction", async () => {
  const { created, executor } = harness();
  await assertRejects(
    () =>
      // deno-lint-ignore no-explicit-any
      executor(
        new Request("https://example.test/v1/execution-updates", { method: "POST" }),
        authContext() as any,
        BODY as any,
        execContext() as any,
      ),
    ApiAuthenticationError,
  );
  assertEquals(created.length, 0);
});

Deno.test("API-I.7: identity mismatches fail closed before RPC invocation", async () => {
  const mismatches: Array<[Record<string, unknown>, Record<string, unknown>]> = [
    [{ token: { userId: "other-user" } }, {}],
    [{}, { requestedUserId: "other-user" }],
    [{}, { executingUserId: "other-user" }],
    [{}, { apiClientId: "00000000-0000-4000-8000-000000000001" }],
    [{}, { oauthClientId: "other-client" }],
    [{}, { policyVersionId: "00000000-0000-4000-8000-000000000002" }],
    [{}, { sourceChannel: "mcp" }],
    [{}, { sourceChannel: "browser" }],
    [{}, { delegationMode: "service_role" }],
    [{}, { delegationMode: "system" }],
    [{ client: { policyVersionId: "" } }, {}],
    [{ client: { apiClientId: "" } }, {}],
  ];
  for (const [authOverride, execOverride] of mismatches) {
    const { created, recorded, executor } = harness();
    const err = await assertRejects(
      () =>
        // deno-lint-ignore no-explicit-any
        executor(
          mutationRequest(),
          authContext(authOverride) as any,
          BODY as any,
          execContext(execOverride) as any,
        ),
      ApiHttpError,
    );
    assertEquals(err.code, "internal_error");
    assertEquals(created.length, 0);
    assertEquals(recorded.length, 0);
  }
});

Deno.test("API-I.7: sourceChannel must be external_api and delegationMode delegated_user", async () => {
  const { executor, recorded } = harness();
  // deno-lint-ignore no-explicit-any
  await executor(mutationRequest(), authContext() as any, BODY as any, execContext() as any);
  assertEquals(recorded.length, 1);
  const bad = await assertRejects(
    () =>
      // deno-lint-ignore no-explicit-any
      executor(
        mutationRequest(),
        authContext() as any,
        BODY as any,
        execContext({ sourceChannel: "external", delegationMode: "delegated_user" }) as any,
      ),
    ApiHttpError,
  );
  assertEquals(bad.code, "internal_error");
});

Deno.test("API-I.7: execution metadata never comes from the JSON body", async () => {
  const { recorded, executor } = harness();
  const pollutedBody = {
    ...BODY,
    requestId: "body-request",
    correlationId: "body-correlation",
    idempotencyKey: "body-idem",
    payloadHash: "b".repeat(64),
    projectId: TARGET_ID,
  };
  // deno-lint-ignore no-explicit-any
  await executor(mutationRequest(), authContext() as any, pollutedBody as any, execContext() as any);
  const args = recorded[0].args;
  assertEquals(args._request_id, "req-1");
  assertEquals(args._correlation_id, "corr-1");
  assertEquals(args._idempotency_key, "idem-1");
  assertEquals(args._payload_hash, PAYLOAD_HASH);
  assert(!("_project_id" in args));
  assertEquals(Object.keys(args).length, 10);
});

// -----------------------------------------------------------------------------
// Idempotency-Key contract alignment (API-I.7C1)
// -----------------------------------------------------------------------------

Deno.test("API-I.7C1: idempotency key matches canonical API-F contract and request/correlation remain unchanged", async () => {
  for (const key of ["abc+def", "abc!def", "abc=def"]) {
    const recorded: Recorded[] = [];
    await appendApiV1ExecutionUpdate(
      stubClient({ data: APPLIED }, recorded),
      { ...INPUT, idempotencyKey: key },
    );
    assertEquals(recorded.length, 1);
    assertEquals(recorded[0].args._idempotency_key, key);
  }

  const key129 = "a".repeat(129);
  const recorded129: Recorded[] = [];
  await appendApiV1ExecutionUpdate(
    stubClient({ data: APPLIED }, recorded129),
    { ...INPUT, idempotencyKey: key129 },
  );
  assertEquals(recorded129[0].args._idempotency_key, key129);

  const key255 = "a".repeat(255);
  const recorded255: Recorded[] = [];
  await appendApiV1ExecutionUpdate(
    stubClient({ data: APPLIED }, recorded255),
    { ...INPUT, idempotencyKey: key255 },
  );
  assertEquals(recorded255[0].args._idempotency_key, key255);

  for (const key of ["a".repeat(256), "id em-1", ""]) {
    const err = await assertRejects(
      () =>
        appendApiV1ExecutionUpdate(
          stubClient({ data: APPLIED }),
          { ...INPUT, idempotencyKey: key },
        ),
      ApiHttpError,
    );
    assertEquals(err.code, "internal_error");
  }

  for (const field of ["requestId", "correlationId"] as const) {
    const long = "a".repeat(129);
    const err = await assertRejects(
      () =>
        appendApiV1ExecutionUpdate(
          stubClient({ data: APPLIED }),
          { ...INPUT, [field]: long },
        ),
      ApiHttpError,
    );
    assertEquals(err.code, "internal_error");
  }
});

// -----------------------------------------------------------------------------
// Static containment guards
// -----------------------------------------------------------------------------

Deno.test("API-I.7: modules contain no service role, privileged client, business read or logging", async () => {
  for (
    const file of [
      "../supabaseAppendExecutionUpdate.ts",
      "../supabaseDelegatedAppendExecutionUpdate.ts",
    ]
  ) {
    const source = await Deno.readTextFile(new URL(file, __BTPM_SRC_BASE__));
    for (
      const needle of [
        "SERVICE_ROLE",
        "service_role",
        "serviceRole",
        "Deno.env",
        "@supabase/supabase-js",
        "fetch(",
        "console.log",
        "console.warn",
        "console.error",
        ".from(",
        ".select(",
        ".insert(",
        "\"phases\"",
        "\"tasks\"",
        "\"execution_updates\"",
        "\"append_execution_update\"",
        "Deno.serve",
        "setTimeout",
        "setInterval",
        "API_V1_ROUTE_ALLOWLIST",
      ]
    ) {
      assert(!source.includes(needle), `${file} must not contain: ${needle}`);
    }
    // At most one quoted RPC-name string literal may appear per module,
    // proving no dynamic dispatch and no second RPC target.
    const literals = source.match(/"api_v1_append_execution_update"/g) ?? [];
    assert(literals.length <= 1, `${file} must not repeat RPC name literals`);
  }
});

Deno.test("API-I.7/API-I.8: route is registered exactly once in the allowlist", () => {
  const matches = API_V1_ROUTE_ALLOWLIST.filter(
    (route) =>
      route.id === "execution_updates.append" &&
      route.method === "POST" &&
      route.path === "/v1/execution-updates" &&
      route.operation === "mutation",
  );
  assert(matches.length === 1);
});
