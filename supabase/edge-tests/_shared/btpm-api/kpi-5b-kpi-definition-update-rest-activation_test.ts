// KPI-5B — Focused tests for the external KPI definition update REST
// activation (`kpis.update`, PATCH /v1/kpis/:kpiid).
//
// Source-file reads stay anchored to the canonical module locations.

import {
  assert,
  assertEquals,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { ApiHttpError } from "../../../functions/_shared/btpm-api/http.ts";
import {
  API_V1_ROUTE_ALLOWLIST,
} from "../../../functions/_shared/btpm-api/routes/allowlist.ts";
import {
  buildCapabilitiesPayload,
} from "../../../functions/_shared/btpm-api/routes/capabilities.ts";
import {
  buildApiV1UpdateKpiIdempotencyPayload,
  KPI_DETAIL_ROUTE,
  KPI_UPDATE_ROUTE,
  parseApiV1UpdateKpiBody,
} from "../../../functions/_shared/btpm-api/routes/kpis.ts";
import {
  updateApiV1Kpi,
} from "../../../functions/_shared/btpm-api/supabaseKpiMutation.ts";
import {
  createDelegatedApiV1UpdateKpiExecutor,
} from "../../../functions/_shared/btpm-api/supabaseDelegatedKpiMutation.ts";
import { MCP_TOOL_REGISTRY } from "../../../functions/btpm-mcp/mcp/toolRegistry.ts";

const KPI_ID = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
const PROJECT_ID = "8f14e45f-ceea-467a-a4a7-2b4b0c7f4d21";
const HASH = "a".repeat(64);
const UPDATED_AT = "2026-08-22T07:30:30.123456+00:00";

const MINIMAL_INPUT = { expectedUpdatedAt: UPDATED_AT };

function minimalBody() {
  return parseApiV1UpdateKpiBody(MINIMAL_INPUT);
}

// ---------------------------------------------------------------------------
// A. Route contract
// ---------------------------------------------------------------------------

Deno.test("KPI-5B: route contract is exactly the accepted update surface", () => {
  assertEquals(KPI_UPDATE_ROUTE.id, "kpis.update");
  assertEquals(KPI_UPDATE_ROUTE.method, "PATCH");
  assertEquals(KPI_UPDATE_ROUTE.path, "/v1/kpis/:kpiid");
  assertEquals(KPI_UPDATE_ROUTE.operation, "mutation");
});

Deno.test("KPI-5B: update shares the detail pathname and differs only by method", () => {
  assertEquals(KPI_UPDATE_ROUTE.path, KPI_DETAIL_ROUTE.path);
  assertEquals(KPI_DETAIL_ROUTE.method, "GET");
});

Deno.test("KPI-5B: the route is registered exactly once in the live allowlist", () => {
  assertEquals(
    API_V1_ROUTE_ALLOWLIST.filter((r) => r === KPI_UPDATE_ROUTE).length,
    1,
  );
  assertEquals(
    API_V1_ROUTE_ALLOWLIST.filter((r) => r.id === "kpis.update").length,
    1,
  );
});

Deno.test("KPI-5B: /v1/capabilities advertises kpis.update exactly once", () => {
  const advertised = buildCapabilitiesPayload().supportedOperations;
  assertEquals(advertised.filter((op) => op === "kpis.update").length, 1);
});

// ---------------------------------------------------------------------------
// B. Strict closed-schema body validation
// ---------------------------------------------------------------------------

Deno.test("KPI-5B: a minimal body sets no field and carries the concurrency token", () => {
  const body = minimalBody();
  assertEquals(body.expectedUpdatedAt, UPDATED_AT);
  for (
    const flag of [
      body.setName,
      body.setDescription,
      body.setUnit,
      body.setTargetValue,
      body.setTargetDirection,
      body.setSourceMode,
      body.setValueType,
      body.setCadence,
      body.setCalculationKey,
      body.setFormulaVersion,
      body.setCompletionMethod,
      body.setCommentRequired,
      body.setActionPlanRequired,
      body.setAutoSnapshotEnabled,
    ]
  ) {
    assertStrictEquals(flag, false);
  }
  assertStrictEquals(body.name, null);
});

Deno.test("KPI-5B: expectedUpdatedAt is mandatory and strictly formatted", () => {
  for (
    const bad of [
      {},
      { expectedUpdatedAt: null },
      { expectedUpdatedAt: "" },
      { expectedUpdatedAt: "   " },
      { expectedUpdatedAt: "2026-08-22" },
      { expectedUpdatedAt: "not-a-timestamp" },
      { expectedUpdatedAt: 1 },
    ]
  ) {
    const err = assertThrows(
      () => parseApiV1UpdateKpiBody(bad),
      ApiHttpError,
    );
    assertEquals(err.code, "invalid_request");
  }
});

Deno.test("KPI-5B: presence drives set-flags and null clears explicitly", () => {
  const named = parseApiV1UpdateKpiBody({
    ...MINIMAL_INPUT,
    name: "  Cycle time  ",
  });
  assertStrictEquals(named.setName, true);
  assertEquals(named.name, "Cycle time");

  const cleared = parseApiV1UpdateKpiBody({
    ...MINIMAL_INPUT,
    description: null,
  });
  assertStrictEquals(cleared.setDescription, true);
  assertStrictEquals(cleared.description, null);
  assertStrictEquals(cleared.setName, false);
});

Deno.test("KPI-5B: unknown, scope, derived and set-flag keys are rejected", () => {
  for (
    const bad of [
      { ...MINIMAL_INPUT, kpiId: KPI_ID },
      { ...MINIMAL_INPUT, projectId: PROJECT_ID },
      { ...MINIMAL_INPUT, workspaceId: PROJECT_ID },
      { ...MINIMAL_INPUT, organizationId: PROJECT_ID },
      { ...MINIMAL_INPUT, tenantId: PROJECT_ID },
      { ...MINIMAL_INPUT, currentValue: 1 },
      { ...MINIMAL_INPUT, isArchived: false },
      { ...MINIMAL_INPUT, updatedBy: PROJECT_ID },
      { ...MINIMAL_INPUT, setName: true },
      { ...MINIMAL_INPUT, target_direction: "increase" },
      { ...MINIMAL_INPUT, extra: 1 },
    ]
  ) {
    const err = assertThrows(
      () => parseApiV1UpdateKpiBody(bad),
      ApiHttpError,
    );
    assertEquals(err.code, "invalid_request");
  }
});

Deno.test("KPI-5B: enum fields accept only canonical vocabulary", () => {
  assertEquals(
    parseApiV1UpdateKpiBody({ ...MINIMAL_INPUT, targetDirection: "increase" })
      .targetDirection,
    "increase",
  );
  for (
    const bad of [
      { ...MINIMAL_INPUT, targetDirection: "up" },
      { ...MINIMAL_INPUT, sourceMode: "auto" },
      { ...MINIMAL_INPUT, valueType: "int" },
      { ...MINIMAL_INPUT, cadence: "daily" },
      { ...MINIMAL_INPUT, completionMethod: "manual" },
    ]
  ) {
    assertThrows(() => parseApiV1UpdateKpiBody(bad), ApiHttpError);
  }
});

Deno.test("KPI-5B: a blank clearable enum clears the stored value", () => {
  const cleared = parseApiV1UpdateKpiBody({
    ...MINIMAL_INPUT,
    completionMethod: "   ",
  });
  assertStrictEquals(cleared.setCompletionMethod, true);
  assertStrictEquals(cleared.completionMethod, null);
});

Deno.test("KPI-5B: numeric, string and boolean fields are strictly typed", () => {
  for (
    const bad of [
      { ...MINIMAL_INPUT, name: "" },
      { ...MINIMAL_INPUT, name: "   " },
      { ...MINIMAL_INPUT, name: 1 },
      { ...MINIMAL_INPUT, targetValue: "1" },
      { ...MINIMAL_INPUT, targetValue: Number.NaN },
      { ...MINIMAL_INPUT, targetValue: Number.POSITIVE_INFINITY },
      { ...MINIMAL_INPUT, formulaVersion: 1.5 },
      { ...MINIMAL_INPUT, formulaVersion: 2147483648 },
      { ...MINIMAL_INPUT, commentRequired: "true" },
      { ...MINIMAL_INPUT, actionPlanRequired: 1 },
      { ...MINIMAL_INPUT, autoSnapshotEnabled: "no" },
    ]
  ) {
    assertThrows(() => parseApiV1UpdateKpiBody(bad), ApiHttpError);
  }
});

Deno.test("KPI-5B: non-object bodies are rejected", () => {
  for (const bad of [undefined, null, 0, "", "x", true, [], [MINIMAL_INPUT]]) {
    assertThrows(() => parseApiV1UpdateKpiBody(bad), ApiHttpError);
  }
});

// ---------------------------------------------------------------------------
// C. Canonical idempotency payload
// ---------------------------------------------------------------------------

Deno.test("KPI-5B: the payload folds KPI identity, token, values and flags in", () => {
  const payload = buildApiV1UpdateKpiIdempotencyPayload(KPI_ID, minimalBody());
  assertEquals(payload.kpiId, KPI_ID);
  assertEquals(payload.expectedUpdatedAt, UPDATED_AT);
  assertEquals(Object.keys(payload).length, 30);
});

Deno.test("KPI-5B: absent and explicitly-cleared fields hash differently", () => {
  const absent = JSON.stringify(
    buildApiV1UpdateKpiIdempotencyPayload(KPI_ID, minimalBody()),
  );
  const cleared = JSON.stringify(
    buildApiV1UpdateKpiIdempotencyPayload(
      KPI_ID,
      parseApiV1UpdateKpiBody({ ...MINIMAL_INPUT, description: null }),
    ),
  );
  assert(absent !== cleared);
});

Deno.test("KPI-5B: identical requests hash identically", () => {
  const a = buildApiV1UpdateKpiIdempotencyPayload(
    KPI_ID,
    parseApiV1UpdateKpiBody({ ...MINIMAL_INPUT, name: "Cycle time" }),
  );
  const b = buildApiV1UpdateKpiIdempotencyPayload(
    KPI_ID,
    parseApiV1UpdateKpiBody({ ...MINIMAL_INPUT, name: "  Cycle time " }),
  );
  assertEquals(JSON.stringify(a), JSON.stringify(b));
});

Deno.test("KPI-5B: the idempotency payload carries no identity or transport data", () => {
  const text = JSON.stringify(
    buildApiV1UpdateKpiIdempotencyPayload(KPI_ID, minimalBody()),
  );
  for (
    const forbidden of [
      "userId",
      "tenantId",
      "organizationId",
      "workspaceId",
      "oauthClientId",
      "apiClientId",
      "requestId",
      "correlationId",
      "token",
      "Bearer",
    ]
  ) {
    assert(!text.includes(forbidden), forbidden);
  }
});

// ---------------------------------------------------------------------------
// D. RPC adapter — one hardcoded wrapper, bounded mapping
// ---------------------------------------------------------------------------

function adapterInput(overrides: Record<string, unknown> = {}) {
  return {
    expectedOauthClientId: "btpm-client-1",
    kpiId: KPI_ID,
    ...minimalBody(),
    requestId: "req-1",
    correlationId: "corr-1",
    idempotencyKey: "idem-1",
    payloadHash: HASH,
    ...overrides,
  } as Parameters<typeof updateApiV1Kpi>[1];
}

function stubClient(data: unknown, error: unknown = null) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    client: {
      rpc(fn: string, args: Record<string, unknown>) {
        calls.push({ fn, args });
        return Promise.resolve({ data, error });
      },
    },
  };
}

Deno.test("KPI-5B: the adapter calls only api_v1_update_kpi with fixed args", async () => {
  const stub = stubClient({
    ok: true,
    outcome: "applied",
    kpiId: KPI_ID,
    projectId: PROJECT_ID,
    updatedAt: UPDATED_AT,
  });
  const result = await updateApiV1Kpi(stub.client as never, adapterInput());
  assertEquals(stub.calls.length, 1);
  assertEquals(stub.calls[0].fn, "api_v1_update_kpi");
  assertEquals(Object.keys(stub.calls[0].args).length, 35);
  assertEquals(stub.calls[0].args._kpi_definition_id, KPI_ID);
  assertEquals(result, {
    ok: true,
    outcome: "applied",
    kpiId: KPI_ID,
    projectId: PROJECT_ID,
    updatedAt: UPDATED_AT,
  });
});

Deno.test("KPI-5B: no_change and replayed are accepted success outcomes", async () => {
  for (const outcome of ["no_change", "replayed"] as const) {
    const stub = stubClient({
      ok: true,
      outcome,
      kpiId: KPI_ID,
      projectId: PROJECT_ID,
      updatedAt: UPDATED_AT,
    });
    const result = await updateApiV1Kpi(stub.client as never, adapterInput());
    assertEquals(result.ok, true);
    assertEquals(result.outcome, outcome);
  }
});

Deno.test("KPI-5B: the bounded stale conflict maps with a stable code only", async () => {
  const stub = stubClient({
    ok: false,
    outcome: "conflict",
    code: "stale_kpi_definition",
  });
  const result = await updateApiV1Kpi(stub.client as never, adapterInput());
  assertEquals(result, {
    ok: false,
    outcome: "conflict",
    code: "stale_kpi_definition",
  });
});

Deno.test("KPI-5B: negative outcomes map bounded with no narrative", async () => {
  for (
    const outcome of [
      "invalid",
      "not_authorized",
      "idempotency_conflict",
      "idempotency_pending",
    ] as const
  ) {
    const stub = stubClient({ ok: false, outcome });
    const result = await updateApiV1Kpi(stub.client as never, adapterInput());
    assertEquals(result, { ok: false, outcome });
  }
});

Deno.test("KPI-5B: an unknown or narrative-bearing result is contained", async () => {
  for (
    const data of [
      null,
      {},
      { ok: true, outcome: "applied" },
      {
        ok: true,
        outcome: "weird",
        kpiId: KPI_ID,
        projectId: PROJECT_ID,
        updatedAt: UPDATED_AT,
      },
      {
        ok: true,
        outcome: "applied",
        kpiId: KPI_ID,
        projectId: PROJECT_ID,
        updatedAt: UPDATED_AT,
        detail: "leak",
      },
      { ok: false, outcome: "boom" },
      { ok: false, outcome: "invalid", message: "leak" },
      { ok: false, outcome: "conflict", code: "other" },
      { ok: false, outcome: "conflict" },
    ]
  ) {
    const stub = stubClient(data);
    const err = await assertRejects(
      () => updateApiV1Kpi(stub.client as never, adapterInput()),
      ApiHttpError,
    );
    assertEquals(err.code, "internal_error");
  }
});

Deno.test("KPI-5B: a KPI identity mismatch in the result is contained", async () => {
  const stub = stubClient({
    ok: true,
    outcome: "applied",
    kpiId: "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bec",
    projectId: PROJECT_ID,
    updatedAt: UPDATED_AT,
  });
  const err = await assertRejects(
    () => updateApiV1Kpi(stub.client as never, adapterInput()),
    ApiHttpError,
  );
  assertEquals(err.code, "internal_error");
});

Deno.test("KPI-5B: insufficient privilege maps to not_authorized", async () => {
  const stub = stubClient(null, { code: "42501", message: "denied" });
  const err = await assertRejects(
    () => updateApiV1Kpi(stub.client as never, adapterInput()),
    ApiHttpError,
  );
  assertEquals(err.code, "not_authorized");
});

Deno.test("KPI-5B: malformed infrastructure inputs never reach the database", async () => {
  for (
    const overrides of [
      { kpiId: "nope" },
      { kpiId: "00000000-0000-0000-0000-000000000000" },
      { expectedOauthClientId: "" },
      { expectedUpdatedAt: "" },
      { requestId: "bad id" },
      { correlationId: "" },
      { idempotencyKey: "" },
      { payloadHash: "xyz" },
    ]
  ) {
    const stub = stubClient({ ok: false, outcome: "invalid" });
    await assertRejects(
      () => updateApiV1Kpi(stub.client as never, adapterInput(overrides)),
      ApiHttpError,
    );
    assertEquals(stub.calls.length, 0);
  }
});

// ---------------------------------------------------------------------------
// E. Delegated caller-scoped executor
// ---------------------------------------------------------------------------

const EXEC_CONTEXT = Object.freeze({
  requestedUserId: "user-1",
  executingUserId: "user-1",
  apiClientId: "api-client-1",
  oauthClientId: "btpm-client-1",
  policyVersionId: "policy-1",
  sourceChannel: "external_api",
  delegationMode: "delegated_user",
  requestId: "req-1",
  correlationId: "corr-1",
  idempotencyKey: "idem-1",
  payloadHash: HASH,
});

const AUTH_CONTEXT = Object.freeze({
  token: Object.freeze({ userId: "user-1" }),
  client: Object.freeze({
    userId: "user-1",
    apiClientId: "api-client-1",
    oauthClientId: "btpm-client-1",
    policyVersionId: "policy-1",
  }),
});

function makeRequest() {
  return new Request("https://x/v1/kpis/" + KPI_ID, {
    method: "PATCH",
    headers: { Authorization: "Bearer caller-token" },
  });
}

Deno.test("KPI-5B: the executor builds a fresh caller-bound anon client per call", async () => {
  const built: Array<{ url: string; key: string; auth: string }> = [];
  const executor = createDelegatedApiV1UpdateKpiExecutor(
    "https://project.supabase.co",
    "anon-key",
    (url, key, options) => {
      built.push({ url, key, auth: options.global.headers.Authorization });
      return {
        rpc: () =>
          Promise.resolve({
            data: {
              ok: true,
              outcome: "applied",
              kpiId: KPI_ID,
              projectId: PROJECT_ID,
              updatedAt: UPDATED_AT,
            },
            error: null,
          }),
      };
    },
  );

  for (let i = 0; i < 2; i += 1) {
    const result = await executor(
      makeRequest(),
      AUTH_CONTEXT as never,
      KPI_ID,
      minimalBody(),
      EXEC_CONTEXT as never,
    );
    assertStrictEquals(result.ok, true);
  }
  assertEquals(built.length, 2);
  assertEquals(built[0].key, "anon-key");
  assertEquals(built[0].auth, "Bearer caller-token");
});

Deno.test("KPI-5B: inconsistent identity fails closed before any RPC", async () => {
  for (
    const badContext of [
      { ...EXEC_CONTEXT, executingUserId: "user-2" },
      { ...EXEC_CONTEXT, apiClientId: "other" },
      { ...EXEC_CONTEXT, oauthClientId: "other" },
      { ...EXEC_CONTEXT, policyVersionId: "other" },
      { ...EXEC_CONTEXT, sourceChannel: "mcp" },
      { ...EXEC_CONTEXT, delegationMode: "service" },
    ]
  ) {
    let called = 0;
    const executor = createDelegatedApiV1UpdateKpiExecutor(
      "https://project.supabase.co",
      "anon-key",
      () => ({
        rpc: () => {
          called += 1;
          return Promise.resolve({ data: null, error: null });
        },
      }),
    );
    const err = await assertRejects(
      () =>
        executor(
          makeRequest(),
          AUTH_CONTEXT as never,
          KPI_ID,
          minimalBody(),
          badContext as never,
        ),
      ApiHttpError,
    );
    assertEquals(err.code, "internal_error");
    assertEquals(called, 0);
  }
});

// ---------------------------------------------------------------------------
// F. Source hygiene and MCP non-exposure
// ---------------------------------------------------------------------------

Deno.test("KPI-5B: the mutation adapter builds no client and reads no env", async () => {
  const source = await Deno.readTextFile(
    new URL(
      "../../../functions/_shared/btpm-api/supabaseKpiMutation.ts",
      import.meta.url,
    ),
  );
  for (
    const forbidden of [
      "Deno.env",
      "createClient",
      "SERVICE_ROLE",
      "service_role",
      "fetch(",
      "console.log",
      "Deno.serve",
      ".from(",
    ]
  ) {
    assert(!source.includes(forbidden), forbidden);
  }
});

Deno.test("KPI-5B: the delegated executor never uses the service-role key", async () => {
  const source = await Deno.readTextFile(
    new URL(
      "../../../functions/_shared/btpm-api/supabaseDelegatedKpiMutation.ts",
      import.meta.url,
    ),
  );
  for (
    const forbidden of [
      "Deno.env",
      "SERVICE_ROLE",
      "service_role",
      "fetch(",
      "console.log",
    ]
  ) {
    assert(!source.includes(forbidden), forbidden);
  }
});

// KPI-5C exposed `kpis.update` as `btpm_update_kpi`. The durable REST-side
// invariant is the single canonical registry entry and its metadata.
Deno.test("KPI-5B: kpis.update has exactly one canonical MCP registry entry", () => {
  const entries = MCP_TOOL_REGISTRY.filter(
    (entry) => entry.operationId === "kpis.update",
  );
  assertEquals(entries.length, 1);
  assertEquals(entries[0].toolName, "btpm_update_kpi");
  assertEquals(entries[0].operationClass, "mutation");
  assertEquals(entries[0].exposure, "exposed");
  assertEquals(entries[0].confirmation, "required");
});
