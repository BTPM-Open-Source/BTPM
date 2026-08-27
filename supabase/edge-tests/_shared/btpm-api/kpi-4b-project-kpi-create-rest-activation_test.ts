// KPI-4B — Focused tests for the external Project KPI definition create REST
// activation (`kpis.create`, POST /v1/projects/:projectid/kpis).
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
  buildApiV1CreateKpiIdempotencyPayload,
  KPI_CREATE_ROUTE,
  KPI_PROJECT_COLLECTION_ROUTE,
  parseApiV1CreateKpiBody,
} from "../../../functions/_shared/btpm-api/routes/kpis.ts";
import {
  type ApiV1CreateKpiNegativeResult,
  createApiV1Kpi,
} from "../../../functions/_shared/btpm-api/supabaseKpiMutation.ts";
import {
  createDelegatedApiV1CreateKpiExecutor,
} from "../../../functions/_shared/btpm-api/supabaseDelegatedKpiMutation.ts";
import { MCP_TOOL_REGISTRY } from "../../../functions/btpm-mcp/mcp/toolRegistry.ts";

const PROJECT_ID = "8f14e45f-ceea-467a-a4a7-2b4b0c7f4d21";
const KPI_ID = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
const HASH = "a".repeat(64);

const MINIMAL_INPUT = { name: "On-time delivery" };

function fullBody() {
  return parseApiV1CreateKpiBody(MINIMAL_INPUT);
}

// ---------------------------------------------------------------------------
// A. Route contract
// ---------------------------------------------------------------------------

Deno.test("KPI-4B: route contract is exactly the accepted create surface", () => {
  assertEquals(KPI_CREATE_ROUTE.id, "kpis.create");
  assertEquals(KPI_CREATE_ROUTE.method, "POST");
  assertEquals(KPI_CREATE_ROUTE.path, "/v1/projects/:projectid/kpis");
  assertEquals(KPI_CREATE_ROUTE.operation, "mutation");
});

Deno.test("KPI-4B: create shares the collection pathname and differs only by method", () => {
  assertEquals(KPI_CREATE_ROUTE.path, KPI_PROJECT_COLLECTION_ROUTE.path);
  assertEquals(KPI_PROJECT_COLLECTION_ROUTE.method, "GET");
});

Deno.test("KPI-4B: the route is registered exactly once in the live allowlist", () => {
  const matches = API_V1_ROUTE_ALLOWLIST.filter((r) => r === KPI_CREATE_ROUTE);
  assertEquals(matches.length, 1);
  assertEquals(
    API_V1_ROUTE_ALLOWLIST.filter((r) => r.id === "kpis.create").length,
    1,
  );
});

Deno.test("KPI-4B: /v1/capabilities advertises kpis.create exactly once", () => {
  const advertised = buildCapabilitiesPayload().supportedOperations;
  assertEquals(advertised.filter((op) => op === "kpis.create").length, 1);
});

// ---------------------------------------------------------------------------
// B. Strict closed-schema body validation
// ---------------------------------------------------------------------------

Deno.test("KPI-4B: a minimal body materializes deterministic canonical defaults", () => {
  assertEquals(fullBody(), {
    name: "On-time delivery",
    description: null,
    unit: null,
    targetValue: null,
    targetDirection: "target_exact",
    sourceMode: "manual",
    valueType: "number",
    cadence: "manual_only",
    calculationKey: null,
    formulaVersion: null,
    completionMethod: null,
    commentRequired: false,
    actionPlanRequired: false,
    autoSnapshotEnabled: false,
  });
});

Deno.test("KPI-4B: name is btrim-canonicalized and required", () => {
  assertEquals(parseApiV1CreateKpiBody({ name: "  Cycle time  " }).name, "Cycle time");
  for (const bad of [{}, { name: "" }, { name: "   " }, { name: 1 }, { name: null }]) {
    assertThrows(() => parseApiV1CreateKpiBody(bad), ApiHttpError);
  }
});

Deno.test("KPI-4B: unknown, scope and derived keys are rejected", () => {
  for (
    const bad of [
      { name: "x", projectId: PROJECT_ID },
      { name: "x", workspaceId: PROJECT_ID },
      { name: "x", organizationId: PROJECT_ID },
      { name: "x", tenantId: PROJECT_ID },
      { name: "x", currentValue: 1 },
      { name: "x", isArchived: false },
      { name: "x", createdBy: PROJECT_ID },
      { name: "x", target_direction: "increase" },
      { name: "x", extra: 1 },
    ]
  ) {
    const err = assertThrows(
      () => parseApiV1CreateKpiBody(bad),
      ApiHttpError,
    );
    assertEquals(err.code, "invalid_request");
  }
});

Deno.test("KPI-4B: enum fields accept only canonical vocabulary", () => {
  assertEquals(
    parseApiV1CreateKpiBody({ name: "x", targetDirection: "increase" })
      .targetDirection,
    "increase",
  );
  for (
    const bad of [
      { name: "x", targetDirection: "up" },
      { name: "x", sourceMode: "auto" },
      { name: "x", valueType: "int" },
      { name: "x", cadence: "daily" },
      { name: "x", completionMethod: "manual" },
      { name: "x", completionMethod: "" },
    ]
  ) {
    assertThrows(() => parseApiV1CreateKpiBody(bad), ApiHttpError);
  }
});

Deno.test("KPI-4B: numeric and boolean fields are strictly typed", () => {
  for (
    const bad of [
      { name: "x", targetValue: "1" },
      { name: "x", targetValue: Number.NaN },
      { name: "x", targetValue: Number.POSITIVE_INFINITY },
      { name: "x", formulaVersion: 1.5 },
      { name: "x", formulaVersion: 2147483648 },
      { name: "x", commentRequired: "true" },
      { name: "x", actionPlanRequired: 1 },
      { name: "x", autoSnapshotEnabled: "no" },
    ]
  ) {
    assertThrows(() => parseApiV1CreateKpiBody(bad), ApiHttpError);
  }
});

Deno.test("KPI-4B: non-object bodies are rejected", () => {
  for (const bad of [undefined, null, 0, "", "x", true, [], [{ name: "x" }]]) {
    assertThrows(() => parseApiV1CreateKpiBody(bad), ApiHttpError);
  }
});

// ---------------------------------------------------------------------------
// C. Canonical idempotency payload
// ---------------------------------------------------------------------------

Deno.test("KPI-4B: the idempotency payload folds the URL Project identity in", () => {
  const payload = buildApiV1CreateKpiIdempotencyPayload(PROJECT_ID, fullBody());
  assertEquals(payload.projectId, PROJECT_ID);
  assertEquals(Object.keys(payload).length, 15);
});

Deno.test("KPI-4B: omitted and explicitly defaulted requests hash identically", () => {
  const a = buildApiV1CreateKpiIdempotencyPayload(PROJECT_ID, fullBody());
  const b = buildApiV1CreateKpiIdempotencyPayload(
    PROJECT_ID,
    parseApiV1CreateKpiBody({
      name: "On-time delivery",
      description: null,
      targetDirection: "target_exact",
      sourceMode: "manual",
      valueType: "number",
      cadence: "manual_only",
      commentRequired: false,
    }),
  );
  assertEquals(JSON.stringify(a), JSON.stringify(b));
});

Deno.test("KPI-4B: the idempotency payload carries no identity or transport data", () => {
  const text = JSON.stringify(
    buildApiV1CreateKpiIdempotencyPayload(PROJECT_ID, fullBody()),
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
    projectId: PROJECT_ID,
    ...fullBody(),
    requestId: "req-1",
    correlationId: "corr-1",
    idempotencyKey: "idem-1",
    payloadHash: HASH,
    ...overrides,
  } as Parameters<typeof createApiV1Kpi>[1];
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

Deno.test("KPI-4B: the adapter calls only api_v1_create_kpi with twenty fixed args", async () => {
  const stub = stubClient({
    ok: true,
    outcome: "applied",
    kpiId: KPI_ID,
    projectId: PROJECT_ID,
  });
  const result = await createApiV1Kpi(
    stub.client as never,
    adapterInput(),
  );
  assertEquals(stub.calls.length, 1);
  assertEquals(stub.calls[0].fn, "api_v1_create_kpi");
  assertEquals(Object.keys(stub.calls[0].args).length, 20);
  assertEquals(stub.calls[0].args._project_id, PROJECT_ID);
  assertEquals(result, {
    ok: true,
    outcome: "applied",
    kpiId: KPI_ID,
    projectId: PROJECT_ID,
  });
});

Deno.test("KPI-4B: negative outcomes map bounded with no narrative", async () => {
  const negativeOutcomes: readonly ApiV1CreateKpiNegativeResult["outcome"][] = [
    "invalid",
    "not_authorized",
    "idempotency_conflict",
    "idempotency_pending",
  ];
  for (const outcome of negativeOutcomes) {
    const stub = stubClient({ ok: false, outcome });
    const result = await createApiV1Kpi(stub.client as never, adapterInput());
    assertEquals(result, { ok: false, outcome });
  }
});

Deno.test("KPI-4B: an unknown or narrative-bearing result is contained", async () => {
  for (
    const data of [
      null,
      {},
      { ok: true, outcome: "applied" },
      { ok: true, outcome: "weird", kpiId: KPI_ID, projectId: PROJECT_ID },
      {
        ok: true,
        outcome: "applied",
        kpiId: KPI_ID,
        projectId: PROJECT_ID,
        detail: "leak",
      },
      { ok: false, outcome: "boom" },
      { ok: false, outcome: "invalid", message: "leak" },
    ]
  ) {
    const stub = stubClient(data);
    const err = await assertRejects(
      () => createApiV1Kpi(stub.client as never, adapterInput()),
      ApiHttpError,
    );
    assertEquals(err.code, "internal_error");
  }
});

Deno.test("KPI-4B: a Project mismatch in the result is contained", async () => {
  const stub = stubClient({
    ok: true,
    outcome: "applied",
    kpiId: KPI_ID,
    projectId: "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bec",
  });
  const err = await assertRejects(
    () => createApiV1Kpi(stub.client as never, adapterInput()),
    ApiHttpError,
  );
  assertEquals(err.code, "internal_error");
});

Deno.test("KPI-4B: insufficient privilege maps to not_authorized", async () => {
  const stub = stubClient(null, { code: "42501", message: "denied" });
  const err = await assertRejects(
    () => createApiV1Kpi(stub.client as never, adapterInput()),
    ApiHttpError,
  );
  assertEquals(err.code, "not_authorized");
});

Deno.test("KPI-4B: malformed infrastructure inputs never reach the database", async () => {
  for (
    const overrides of [
      { projectId: "nope" },
      { projectId: "00000000-0000-0000-0000-000000000000" },
      { expectedOauthClientId: "" },
      { requestId: "bad id" },
      { correlationId: "" },
      { idempotencyKey: "" },
      { payloadHash: "xyz" },
    ]
  ) {
    const stub = stubClient({ ok: false, outcome: "invalid" });
    await assertRejects(
      () => createApiV1Kpi(stub.client as never, adapterInput(overrides)),
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
  return new Request("https://x/v1/projects/" + PROJECT_ID + "/kpis", {
    method: "POST",
    headers: { Authorization: "Bearer caller-token" },
  });
}

Deno.test("KPI-4B: the executor builds a fresh caller-bound anon client per call", async () => {
  const built: Array<{ url: string; key: string; auth: string }> = [];
  const executor = createDelegatedApiV1CreateKpiExecutor(
    "https://project.supabase.co",
    "anon-key",
    (url, key, options) => {
      built.push({
        url,
        key,
        auth: options.global.headers.Authorization,
      });
      return {
        rpc: () =>
          Promise.resolve({
            data: {
              ok: true,
              outcome: "applied",
              kpiId: KPI_ID,
              projectId: PROJECT_ID,
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
      PROJECT_ID,
      fullBody(),
      EXEC_CONTEXT as never,
    );
    assertStrictEquals(result.ok, true);
  }
  assertEquals(built.length, 2);
  assertEquals(built[0].key, "anon-key");
  assertEquals(built[0].auth, "Bearer caller-token");
});

Deno.test("KPI-4B: inconsistent identity fails closed before any RPC", async () => {
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
    const executor = createDelegatedApiV1CreateKpiExecutor(
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
          PROJECT_ID,
          fullBody(),
          badContext as never,
        ),
      ApiHttpError,
    );
    assertEquals(err.code, "internal_error");
    assertEquals(called, 0);
  }
});

// ---------------------------------------------------------------------------
// F. Source hygiene and MCP reservation
// ---------------------------------------------------------------------------

Deno.test("KPI-4B: the mutation adapter builds no client and reads no env", async () => {
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

Deno.test("KPI-4B: the delegated executor never uses the service-role key", async () => {
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

// KPI-4C exposed `kpis.create` as `btpm_create_kpi`. What must still hold from
// KPI-4B's perspective is that the operation appears exactly once, under that
// exact tool name, as a mutation.
Deno.test("KPI-4B: kpis.create keeps exactly one canonical MCP registry entry", () => {
  const entries = MCP_TOOL_REGISTRY.filter(
    (entry) => entry.operationId === "kpis.create",
  );
  assertEquals(entries.length, 1);
  assertEquals(entries[0].toolName, "btpm_create_kpi");
  assertEquals(entries[0].operationClass, "mutation");
  assertEquals(entries[0].confirmation, "required");
});
