// KPI-6B — Focused tests for the single external KPI update-history append
// surface: POST /v1/kpis/:kpiid/updates  (`kpis.updates.append`).
//
// These tests assert ONLY the local KPI-6B contract: exact-once registration,
// exact path/method matching, the strict closed-schema body parser, the
// deterministic canonical idempotency payload, the RPC adapter argument and
// result contract, and the bounded HTTP status/error mapping. They deliberately
// freeze no global route cardinality and no terminal allowlist position — those
// remain owned by the central topology guard.

import {
  assert,
  assertEquals,
  assertRejects,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { API_V1_ROUTE_ALLOWLIST } from "../../../functions/_shared/btpm-api/routes/allowlist.ts";
import { matchApiRoute } from "../../../functions/btpm-api-v1/router.ts";
import { buildCapabilitiesPayload } from "../../../functions/_shared/btpm-api/routes/capabilities.ts";
import {
  KPI_UPDATE_APPEND_ROUTE,
  buildApiV1AppendKpiUpdateIdempotencyPayload,
  parseApiV1AppendKpiUpdateBody,
} from "../../../functions/_shared/btpm-api/routes/kpis.ts";
import {
  appendApiV1KpiUpdate,
  type ApiV1AppendKpiUpdateRpcArgs,
} from "../../../functions/_shared/btpm-api/supabaseKpiMutation.ts";
import { ApiHttpError } from "../../../functions/_shared/btpm-api/http.ts";
import { MCP_TOOL_REGISTRY } from "../../../functions/btpm-mcp/mcp/toolRegistry.ts";

const KPI_ID = "11111111-2222-4333-8444-55555555555a";
const OTHER_KPI_ID = "99999999-2222-4333-8444-55555555555b";
const PROJECT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const UPDATE_ID = "12121212-3434-4565-8787-909090909090";
const PATH = `/v1/kpis/${KPI_ID}/updates`;

// ---------------------------------------------------------------------------
// A. Route contract
// ---------------------------------------------------------------------------

Deno.test("KPI-6B: the append route contract is exactly the accepted one", () => {
  assertEquals(KPI_UPDATE_APPEND_ROUTE.id, "kpis.updates.append");
  assertEquals(KPI_UPDATE_APPEND_ROUTE.method, "POST");
  assertEquals(KPI_UPDATE_APPEND_ROUTE.path, "/v1/kpis/:kpiid/updates");
  assertEquals(KPI_UPDATE_APPEND_ROUTE.operation, "mutation");
});

Deno.test("KPI-6B: the append route is registered exactly once", () => {
  const matches = API_V1_ROUTE_ALLOWLIST.filter(
    (route) => route.id === "kpis.updates.append",
  );
  assertEquals(matches.length, 1);
  assertEquals(
    matches[0] as unknown,
    KPI_UPDATE_APPEND_ROUTE as unknown,
  );
});

Deno.test("KPI-6B: /v1/capabilities advertises the append operation exactly once", () => {
  const advertised = buildCapabilitiesPayload()
    .supportedOperations as readonly string[];
  assertEquals(
    advertised.filter((id) => id === "kpis.updates.append").length,
    1,
  );
});

Deno.test("KPI-6B: POST on the exact append path matches the append route", () => {
  assertEquals(matchApiRoute("POST", PATH) as unknown, KPI_UPDATE_APPEND_ROUTE);
});

Deno.test("KPI-6B: GET on the same path still matches the accepted read route", () => {
  const matched = matchApiRoute("GET", PATH);
  assert(matched !== null);
  assertEquals(matched.id, "kpis.updates.get");
});

Deno.test("KPI-6B: no other method reaches the append path", () => {
  for (const method of ["PATCH", "PUT"] as const) {
    assertEquals(matchApiRoute(method, PATH), null);
  }
});

Deno.test("KPI-6B: malformed append paths never match", () => {
  for (
    const pathname of [
      "/v1/kpis/updates",
      "/v1/kpis//updates",
      `/v1/kpis/${KPI_ID}/updates/`,
      `/v1/kpis/${KPI_ID}/updates/extra`,
      `/v1/kpis/${KPI_ID.toUpperCase()}/updates`,
      "/v1/kpis/00000000-0000-0000-0000-000000000000/updates",
      `/v1/kpis/${KPI_ID}%2Fupdates`,
      `/v1/kpis/${KPI_ID};v=1/updates`,
      `/v1/kpis/ ${KPI_ID}/updates`,
      `/v1/kpis/${KPI_ID}/update`,
    ]
  ) {
    assertEquals(matchApiRoute("POST", pathname), null, pathname);
  }
});

// ---------------------------------------------------------------------------
// B. Strict closed-schema body parser
// ---------------------------------------------------------------------------

Deno.test("KPI-6B: a minimal body materializes note as null", () => {
  const body = parseApiV1AppendKpiUpdateBody({
    value: 12.5,
    updateDate: "2026-03-01",
  });
  assertEquals(body, { value: 12.5, updateDate: "2026-03-01", note: null });
  assert(Object.isFrozen(body));
});

Deno.test("KPI-6B: an explicit null note is equivalent to omission", () => {
  assertEquals(
    parseApiV1AppendKpiUpdateBody({
      value: 0,
      updateDate: "2026-03-01",
      note: null,
    }),
    { value: 0, updateDate: "2026-03-01", note: null },
  );
});

Deno.test("KPI-6B-C1: note canonicalization matches PostgreSQL btrim semantics", () => {
  const cases: ReadonlyArray<readonly [string, string | null]> = [
    ["", null],
    ["   ", null],
    ["progress", "progress"],
    ["  progress  ", "progress"],
    ["  a  b  ", "a  b"],
    ["\tprogress\t", "\tprogress\t"],
    ["  \tprogress\t  ", "\tprogress\t"],
    ["\nprogress\n", "\nprogress\n"],
    ["  \nprogress\n  ", "\nprogress\n"],
  ];
  for (const [raw, expected] of cases) {
    assertEquals(
      parseApiV1AppendKpiUpdateBody({
        value: -3,
        updateDate: "2026-12-31",
        note: raw,
      }).note,
      expected,
      JSON.stringify(raw),
    );
  }
});


Deno.test("KPI-6B: unknown keys are rejected", () => {
  assertThrows(
    () =>
      parseApiV1AppendKpiUpdateBody({
        value: 1,
        updateDate: "2026-03-01",
        projectId: PROJECT_ID,
      }),
    ApiHttpError,
  );
});

Deno.test("KPI-6B: a missing or non-numeric value is rejected", () => {
  for (
    const value of [undefined, null, "1", true, {}, [], Number.NaN, Infinity]
  ) {
    assertThrows(
      () =>
        parseApiV1AppendKpiUpdateBody({ value, updateDate: "2026-03-01" }),
      ApiHttpError,
      undefined,
      String(value),
    );
  }
});

Deno.test("KPI-6B: only strict YYYY-MM-DD update dates are accepted", () => {
  for (
    const updateDate of [
      undefined,
      null,
      "",
      "2026-3-01",
      "2026/03/01",
      "01-03-2026",
      "2026-03-01T00:00:00Z",
      "2026-03-01 ",
      "today",
      20260301,
    ]
  ) {
    assertThrows(
      () => parseApiV1AppendKpiUpdateBody({ value: 1, updateDate }),
      ApiHttpError,
      undefined,
      String(updateDate),
    );
  }
});

Deno.test("KPI-6B: a non-string note is rejected", () => {
  for (const note of [1, true, {}, []]) {
    assertThrows(
      () =>
        parseApiV1AppendKpiUpdateBody({
          value: 1,
          updateDate: "2026-03-01",
          note,
        }),
      ApiHttpError,
      undefined,
      String(note),
    );
  }
});

Deno.test("KPI-6B: non-object bodies are rejected", () => {
  for (const raw of [undefined, null, 1, "x", true, [], []]) {
    assertThrows(
      () => parseApiV1AppendKpiUpdateBody(raw),
      ApiHttpError,
      undefined,
      String(raw),
    );
  }
});

// ---------------------------------------------------------------------------
// C. Canonical idempotency payload
// ---------------------------------------------------------------------------

Deno.test("KPI-6B: the idempotency payload folds in the URL-borne KPI identity", () => {
  const body = parseApiV1AppendKpiUpdateBody({
    value: 42,
    updateDate: "2026-03-01",
    note: "n",
  });
  assertEquals(buildApiV1AppendKpiUpdateIdempotencyPayload(KPI_ID, body), {
    kpiId: KPI_ID,
    value: 42,
    updateDate: "2026-03-01",
    note: "n",
  });
});

Deno.test("KPI-6B: the idempotency payload carries no identity or transport metadata", () => {
  const payload = buildApiV1AppendKpiUpdateIdempotencyPayload(
    KPI_ID,
    parseApiV1AppendKpiUpdateBody({ value: 1, updateDate: "2026-03-01" }),
  );
  assertEquals(Object.keys(payload).sort(), [
    "kpiId",
    "note",
    "updateDate",
    "value",
  ]);
});

Deno.test("KPI-6B: omitted and explicitly null notes hash identically by construction", () => {
  const a = buildApiV1AppendKpiUpdateIdempotencyPayload(
    KPI_ID,
    parseApiV1AppendKpiUpdateBody({ value: 1, updateDate: "2026-03-01" }),
  );
  const b = buildApiV1AppendKpiUpdateIdempotencyPayload(
    KPI_ID,
    parseApiV1AppendKpiUpdateBody({
      value: 1,
      updateDate: "2026-03-01",
      note: null,
    }),
  );
  assertEquals(JSON.stringify(a), JSON.stringify(b));
});

Deno.test("KPI-6B-C1: PMG-equivalent notes produce identical canonical payloads", () => {
  const payloadFor = (input: Record<string, unknown>) =>
    JSON.stringify(
      buildApiV1AppendKpiUpdateIdempotencyPayload(
        KPI_ID,
        parseApiV1AppendKpiUpdateBody({
          value: 1,
          updateDate: "2026-03-01",
          ...input,
        }),
      ),
    );

  const nullForms = [{}, { note: null }, { note: "" }, { note: "   " }];
  for (const form of nullForms) {
    assertEquals(payloadFor(form), payloadFor({}), JSON.stringify(form));
  }

  assertEquals(
    payloadFor({ note: "  progress  " }),
    payloadFor({ note: "progress" }),
  );

  assert(
    payloadFor({ note: "progress" }) !== payloadFor({ note: "progress changed" }),
  );
  assert(payloadFor({ note: "progress" }) !== payloadFor({}));
});



// ---------------------------------------------------------------------------
// D. RPC adapter contract
// ---------------------------------------------------------------------------

interface Recorded {
  readonly functionName: string;
  readonly args: ApiV1AppendKpiUpdateRpcArgs;
}

function stubClient(data: unknown, recorded: Recorded[] = []) {
  return {
    calls: recorded,
    rpc(functionName: string, args: ApiV1AppendKpiUpdateRpcArgs) {
      recorded.push({ functionName, args });
      return Promise.resolve({ data, error: null });
    },
  };
}

const VALID_INPUT = Object.freeze({
  expectedOauthClientId: "btpm-client-1",
  kpiId: KPI_ID,
  value: 7.25,
  updateDate: "2026-03-01",
  note: "progress",
  requestId: "req-1",
  correlationId: "corr-1",
  idempotencyKey: "idem-1",
  payloadHash: "a".repeat(64),
});

Deno.test("KPI-6B: the adapter calls exactly the accepted wrapper with nine fixed args", async () => {
  const calls: Recorded[] = [];
  const client = stubClient(
    {
      ok: true,
      outcome: "applied",
      kpiUpdateId: UPDATE_ID,
      kpiId: KPI_ID,
      projectId: PROJECT_ID,
    },
    calls,
  );
  const result = await appendApiV1KpiUpdate(client, VALID_INPUT);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].functionName, "api_v1_append_kpi_update");
  assertEquals(Object.keys(calls[0].args).sort(), [
    "_correlation_id",
    "_expected_oauth_client_id",
    "_idempotency_key",
    "_kpi_definition_id",
    "_note",
    "_payload_hash",
    "_request_id",
    "_update_date",
    "_value",
  ]);
  assertEquals(calls[0].args._kpi_definition_id, KPI_ID);
  assertEquals(calls[0].args._value, 7.25);
  assertEquals(calls[0].args._update_date, "2026-03-01");
  assertEquals(calls[0].args._note, "progress");
  assertEquals(result, {
    ok: true,
    outcome: "applied",
    kpiUpdateId: UPDATE_ID,
    kpiId: KPI_ID,
    projectId: PROJECT_ID,
  });
});

Deno.test("KPI-6B: a replayed success is mapped without alteration", async () => {
  const result = await appendApiV1KpiUpdate(
    stubClient({
      ok: true,
      outcome: "replayed",
      kpiUpdateId: UPDATE_ID,
      kpiId: KPI_ID,
      projectId: PROJECT_ID,
    }),
    VALID_INPUT,
  );
  assertEquals(result.ok, true);
  assertEquals(result.outcome, "replayed");
});

Deno.test("KPI-6B: every accepted negative outcome maps exactly", async () => {
  for (
    const outcome of [
      "invalid",
      "not_authorized",
      "idempotency_conflict",
      "idempotency_pending",
    ] as const
  ) {
    const result = await appendApiV1KpiUpdate(
      stubClient({ ok: false, outcome }),
      VALID_INPUT,
    );
    assertEquals(result, { ok: false, outcome });
  }
});

Deno.test("KPI-6B: a KPI identity mismatch fails closed", async () => {
  await assertRejects(
    () =>
      appendApiV1KpiUpdate(
        stubClient({
          ok: true,
          outcome: "applied",
          kpiUpdateId: UPDATE_ID,
          kpiId: OTHER_KPI_ID,
          projectId: PROJECT_ID,
        }),
        VALID_INPUT,
      ),
    ApiHttpError,
  );
});

Deno.test("KPI-6B: malformed writer results fail closed", async () => {
  for (
    const data of [
      null,
      "applied",
      {},
      { ok: true, outcome: "applied" },
      { ok: true, outcome: "unknown", kpiUpdateId: UPDATE_ID, kpiId: KPI_ID, projectId: PROJECT_ID },
      {
        ok: true,
        outcome: "applied",
        kpiUpdateId: "00000000-0000-0000-0000-000000000000",
        kpiId: KPI_ID,
        projectId: PROJECT_ID,
      },
      {
        ok: true,
        outcome: "applied",
        kpiUpdateId: UPDATE_ID,
        kpiId: KPI_ID,
        projectId: PROJECT_ID,
        extra: 1,
      },
      { ok: false, outcome: "conflict" },
      { ok: false, outcome: "invalid", reason: "leaky narrative" },
    ]
  ) {
    await assertRejects(
      () => appendApiV1KpiUpdate(stubClient(data), VALID_INPUT),
      ApiHttpError,
      undefined,
      JSON.stringify(data),
    );
  }
});

Deno.test("KPI-6B: invalid transport metadata never reaches the database", async () => {
  for (
    const patch of [
      { expectedOauthClientId: "" },
      { expectedOauthClientId: "bad client id" },
      { kpiId: "00000000-0000-0000-0000-000000000000" },
      { value: Number.NaN },
      { updateDate: "2026-3-1" },
      { note: 1 as unknown as string },
      { requestId: "req 1" },
      { correlationId: "corr 1" },
      { idempotencyKey: "" },
      { payloadHash: "zz" },
    ]
  ) {
    const calls: Recorded[] = [];
    await assertRejects(
      () =>
        appendApiV1KpiUpdate(
          stubClient({ ok: false, outcome: "invalid" }, calls),
          { ...VALID_INPUT, ...patch },
        ),
      ApiHttpError,
      undefined,
      JSON.stringify(patch),
    );
    assertEquals(calls.length, 0, JSON.stringify(patch));
  }
});

Deno.test("KPI-6B: an insufficient-privilege SQLSTATE maps to not_authorized", async () => {
  const client = {
    rpc: () => Promise.resolve({ data: null, error: { code: "42501" } }),
  };
  const error = await assertRejects(
    () => appendApiV1KpiUpdate(client, VALID_INPUT),
    ApiHttpError,
  );
  assertEquals((error as ApiHttpError).code, "not_authorized");
});

// ---------------------------------------------------------------------------
// E. Registry reservation metadata owned by this step
//
// KPI-6C owns the live MCP exposure assertion for `kpis.updates.append`; this
// section therefore freezes only the reservation metadata, not the exposure
// lifecycle.
// ---------------------------------------------------------------------------

Deno.test("KPI-6B: the append operation has exactly one registry reservation", () => {
  const entries = MCP_TOOL_REGISTRY.filter(
    (entry) => entry.operationId === "kpis.updates.append",
  );
  assertEquals(entries.length, 1);
  assertEquals(entries[0].toolName, "btpm_append_kpi_update");
  assertEquals(entries[0].operationClass, "mutation");
  assertEquals(entries[0].confirmation, "required");
  assertEquals(entries[0].resultShape, "single_object");
  assertEquals(entries[0].concurrencyToken, "not_applicable");
});
