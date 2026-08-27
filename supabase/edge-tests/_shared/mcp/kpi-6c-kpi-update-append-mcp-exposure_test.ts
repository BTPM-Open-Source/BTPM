// KPI-6C — focused guard for the MCP exposure and runtime wiring of the
// canonical `kpis.updates.append` operation as `btpm_append_kpi_update`.
//
// Registry invariants are asserted against the live registry; wiring invariants
// are asserted statically against the accepted factory/runtime sources; control
// behaviour is asserted against the control layer with injected fakes.
// No network, no database, no Edge invocation, no service-role key.

import {
  assert,
  assertEquals,
  assertFalse,
  assertNotEquals,
  assertStrictEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  isMcpOperationExposed,
  MCP_TOOL_REGISTRY,
  validateMcpRegistryCoverage,
  validateMcpToolRegistry,
} from "../../../functions/btpm-mcp/mcp/toolRegistry.ts";
import {
  createMcpKpiUpdateAppendToolExecutor,
  MCP_KPI_UPDATE_APPEND_TOOL_ARGUMENT_NAMES,
  MCP_KPI_UPDATE_APPEND_TOOL_ERROR_MESSAGES,
  MCP_KPI_UPDATE_APPEND_TOOL_INPUT_SCHEMA,
  MCP_KPI_UPDATE_APPEND_TOOL_NAME,
} from "../../../functions/btpm-mcp/mcp/kpiUpdateAppendMutationTool.ts";
import {
  buildApiV1AppendKpiUpdateIdempotencyPayload,
  KPI_UPDATE_APPEND_ROUTE,
  parseApiV1AppendKpiUpdateBody,
} from "../../../functions/_shared/btpm-api/routes/kpis.ts";
import { API_V1_ROUTE_ALLOWLIST } from "../../../functions/_shared/btpm-api/routes/allowlist.ts";

const serverFactorySource = await Deno.readTextFile(
  new URL("../../../functions/btpm-mcp/mcp/serverFactory.ts", import.meta.url),
);
const mcpIndexSource = await Deno.readTextFile(
  new URL("../../../functions/btpm-mcp/index.ts", import.meta.url),
);
const toolSource = await Deno.readTextFile(
  new URL(
    "../../../functions/btpm-mcp/mcp/kpiUpdateAppendMutationTool.ts",
    import.meta.url,
  ),
);
const executorSource = await Deno.readTextFile(
  new URL(
    "../../../functions/btpm-mcp/mcp/kpiUpdateAppendMutationExecutor.ts",
    import.meta.url,
  ),
);
const adapterSource = await Deno.readTextFile(
  new URL(
    "../../../functions/_shared/btpm-api/supabaseKpiMutation.ts",
    import.meta.url,
  ),
);

// -----------------------------------------------------------------------------
// A. Registry
// -----------------------------------------------------------------------------

Deno.test("KPI-6C (A1): the live registry stays valid and fully covered", () => {
  assertEquals(validateMcpToolRegistry(MCP_TOOL_REGISTRY), []);
  assertEquals(validateMcpRegistryCoverage(MCP_TOOL_REGISTRY), []);
});

Deno.test("KPI-6C (A2): kpis.updates.append is exposed exactly once", () => {
  const entries = MCP_TOOL_REGISTRY.filter(
    (entry) => entry.operationId === "kpis.updates.append",
  );
  assertStrictEquals(entries.length, 1);
  const entry = entries[0];
  assertStrictEquals(entry.toolName, MCP_KPI_UPDATE_APPEND_TOOL_NAME);
  assertStrictEquals(entry.toolName, "btpm_append_kpi_update");
  assertStrictEquals(entry.title, "Append BTPM KPI Update");
  assertStrictEquals(entry.operationClass, "mutation");
  assertStrictEquals(entry.exposure, "exposed");
  assertStrictEquals(entry.confirmation, "required");
  assertStrictEquals(entry.resultShape, "single_object");
  assertStrictEquals(entry.concurrencyToken, "not_applicable");
  assertStrictEquals(isMcpOperationExposed("kpis.updates.append"), true);
});

Deno.test("KPI-6C (A3): exposure counts derive from the registry authority, not literals", () => {
  // MCP-HARDENING-C1: the former global magic counts (50 total, 48 exposed,
  // 22 reads, 26 mutations) were removed. Global inventory cardinality is
  // derived from the declarative registry itself.
  const exposed = MCP_TOOL_REGISTRY.filter(
    (entry) => entry.exposure === "exposed",
  );
  const reads = exposed.filter((entry) => entry.operationClass === "read");
  const mutations = exposed.filter(
    (entry) => entry.operationClass === "mutation",
  );
  assertStrictEquals(reads.length + mutations.length, exposed.length);
  assert(exposed.length <= MCP_TOOL_REGISTRY.length);
  assertStrictEquals(
    exposed.filter((entry) => entry.operationId === "kpis.updates.append")
      .length,
    1,
  );
});

Deno.test("KPI-6C (A4): the tool name is advertised exactly once", () => {
  assertStrictEquals(
    MCP_TOOL_REGISTRY.filter(
      (entry) => entry.toolName === MCP_KPI_UPDATE_APPEND_TOOL_NAME,
    ).length,
    1,
  );
});

// -----------------------------------------------------------------------------
// B. Strict structural envelope
// -----------------------------------------------------------------------------

const FORBIDDEN_ARGUMENT_NAMES: ReadonlyArray<string> = Object.freeze([
  "projectId",
  "workspaceId",
  "organizationId",
  "tenantId",
  "authorId",
  "oauthClientId",
  "apiClientId",
  "requestId",
  "correlationId",
  "payloadHash",
  "sourceChannel",
  "sourceMode",
  "valueType",
  "currentValue",
  "confirmationToken",
  "kpiUpdateId",
  "kpi_id",
  "update_date",
  "idempotency_key",
]);

Deno.test("KPI-6C (B1): the schema exposes exactly the six approved arguments", () => {
  assertEquals([...MCP_KPI_UPDATE_APPEND_TOOL_ARGUMENT_NAMES], [
    "kpiId",
    "value",
    "updateDate",
    "note",
    "confirmation",
    "idempotencyKey",
  ]);
  const keys = Object.keys(MCP_KPI_UPDATE_APPEND_TOOL_INPUT_SCHEMA.shape)
    .sort();
  assertEquals(keys, [
    "confirmation",
    "idempotencyKey",
    "kpiId",
    "note",
    "updateDate",
    "value",
  ]);
});

Deno.test("KPI-6C (B2): unknown keys are rejected structurally", () => {
  const parsed = MCP_KPI_UPDATE_APPEND_TOOL_INPUT_SCHEMA.safeParse({
    kpiId: "x",
    value: 1,
    updateDate: "2026-08-22",
    confirmation: true,
    idempotencyKey: "k",
    projectId: "leak",
  });
  assertFalse(parsed.success);
});

Deno.test("KPI-6C (B3): no scope/identity/provenance/internal field is exposed", () => {
  for (const name of FORBIDDEN_ARGUMENT_NAMES) {
    assertFalse(
      Object.prototype.hasOwnProperty.call(
        MCP_KPI_UPDATE_APPEND_TOOL_INPUT_SCHEMA.shape,
        name,
      ),
      `unexpected argument ${name}`,
    );
  }
});

Deno.test("KPI-6C (B4): the structural layer duplicates no date/note business semantics", () => {
  assertFalse(toolSource.includes(".refine("));
  assertFalse(toolSource.includes("btrim"));
  // Structurally, a syntactically wrong date and a blank note are accepted
  // here: the canonical parser owns those semantics.
  const parsed = MCP_KPI_UPDATE_APPEND_TOOL_INPUT_SCHEMA.safeParse({
    kpiId: "x",
    value: 1,
    updateDate: "not-a-date",
    note: "   ",
    confirmation: true,
    idempotencyKey: "k",
  });
  assert(parsed.success);
});

// -----------------------------------------------------------------------------
// C. Control layer behaviour (injected fakes only)
// -----------------------------------------------------------------------------

const KPI_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "99999999-9999-4999-8999-999999999999";
const KPI_UPDATE_ID = "88888888-8888-4888-8888-888888888888";
const API_CLIENT_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "22222222-2222-4222-8222-222222222222";

function trustedExecution() {
  return {
    requestedUserId: USER_ID,
    executingUserId: USER_ID,
    apiClientId: API_CLIENT_ID,
    oauthClientId: "44444444-4444-4444-8444-444444444444",
    policyVersionId: "55555555-5555-4555-8555-555555555555",
    requestId: "66666666-6666-4666-8666-666666666666",
    correlationId: "66666666-6666-4666-8666-666666666666",
    sourceChannel: "mcp",
    sourceClientId: API_CLIENT_ID,
    delegationMode: "delegated_user",
    // deno-lint-ignore no-explicit-any
  } as any;
}

// deno-lint-ignore no-explicit-any
function harness(writerResult: any, options?: { rateLimited?: boolean }) {
  const calls: unknown[] = [];
  const routeIds: string[] = [];
  const rateIdentities: unknown[] = [];
  const executor = createMcpKpiUpdateAppendToolExecutor({
    request: new Request("https://example.test/mcp", {
      method: "POST",
      headers: { Authorization: "Bearer fake-token" },
    }),
    execution: trustedExecution(),
    // deno-lint-ignore no-explicit-any
    writer: ((request: Request, kpiId: string, body: any, ctx: any) => {
      calls.push({ request, kpiId, body, ctx });
      return Promise.resolve(writerResult);
      // deno-lint-ignore no-explicit-any
    }) as any,
    rateLimitProfileResolver: {
      resolve: (apiClientId: string, routeId: string) => {
        routeIds.push(routeId);
        rateIdentities.push({ apiClientId });
        return Promise.resolve({ limit: 60, windowSeconds: 60 });
      },
      // deno-lint-ignore no-explicit-any
    } as any,
    rateLimitStore: {
      // deno-lint-ignore no-explicit-any
      consume: (input: any) => {
        rateIdentities.push({
          apiClientId: input.apiClientId,
          userId: input.userId,
          routeId: input.routeId,
        });
        return Promise.resolve({
          allowed: options?.rateLimited ? false : true,
          remaining: options?.rateLimited ? 0 : 59,
          resetAtEpochMs: input.nowEpochMs + 60_000,
        });
      },
      // deno-lint-ignore no-explicit-any
    } as any,
    now: () => 1_700_000_000_000,
  });
  return { executor, calls, routeIds, rateIdentities };
}

const VALID_ARGS = Object.freeze({
  kpiId: KPI_ID,
  value: 42,
  updateDate: "2026-08-22",
  confirmation: true,
  idempotencyKey: "kpi-6c-key-0001",
});

function appliedResult() {
  return {
    ok: true,
    outcome: "applied",
    kpiUpdateId: KPI_UPDATE_ID,
    kpiId: KPI_ID,
    projectId: PROJECT_ID,
  };
}

Deno.test("KPI-6C (C1): confirmation false blocks writer, rate limit and returns confirmation_required", async () => {
  const { executor, calls, routeIds } = harness(appliedResult());
  // deno-lint-ignore no-explicit-any
  const result = await executor(
    { ...VALID_ARGS, confirmation: false } as any,
  );
  assertFalse(result.ok);
  assertStrictEquals(
    result.ok === false ? result.category : null,
    "confirmation_required",
  );
  assertStrictEquals(calls.length, 0);
  assertStrictEquals(routeIds.length, 0);
});

Deno.test("KPI-6C (D1): malformed KPI identities fail as invalid_arguments with no writer call", async () => {
  const badIds = [
    "not-a-uuid",
    "00000000-0000-0000-0000-000000000000",
    `${KPI_ID}/`,
    `${KPI_ID}/extra`,
    "",
  ];
  for (const kpiId of badIds) {
    const { executor, calls } = harness(appliedResult());
    // deno-lint-ignore no-explicit-any
    const result = await executor({ ...VALID_ARGS, kpiId } as any);
    assertFalse(result.ok, `expected failure for ${kpiId}`);
    assertStrictEquals(
      result.ok === false ? result.category : null,
      "invalid_arguments",
    );
    assertStrictEquals(calls.length, 0);
  }
});

Deno.test("KPI-6C (D2): the tool uses the canonical update-history path parser only", () => {
  assert(toolSource.includes("parseApiV1KpiUpdatesPath("));
  assert(toolSource.includes("`/v1/kpis/${parsedArgs.kpiId}/updates`"));
  assertFalse(/\[0-9a-f\]\{8\}/.test(toolSource));
  assertFalse(toolSource.includes("parseApiV1KpiDetailPath"));
});

Deno.test("KPI-6C (E1): canonical business parsing runs exactly once and owns date/value semantics", async () => {
  assertStrictEquals(
    toolSource.split("parseApiV1AppendKpiUpdateBody(").length - 1,
    1, // exactly one call site
  );

  for (
    const bad of [
      { updateDate: "2026-8-22" },
      { updateDate: "22-08-2026" },
      { value: Number.NaN },
      { value: Number.POSITIVE_INFINITY },
    ]
  ) {
    const { executor, calls } = harness(appliedResult());
    // deno-lint-ignore no-explicit-any
    const result = await executor({ ...VALID_ARGS, ...bad } as any);
    assertFalse(result.ok);
    assertStrictEquals(
      result.ok === false ? result.category : null,
      "invalid_arguments",
    );
    assertStrictEquals(calls.length, 0);
  }
});

Deno.test("KPI-6C (E2): note canonicalization inherits the accepted C1 semantics", async () => {
  const cases: ReadonlyArray<[Record<string, unknown>, string | null]> = [
    [{}, null],
    [{ note: null }, null],
    [{ note: "" }, null],
    [{ note: "   " }, null],
    [{ note: "  progress  " }, "progress"],
    [{ note: "\tkept\t" }, "\tkept\t"],
    [{ note: "\nkept\n" }, "\nkept\n"],
  ];
  for (const [patch, expected] of cases) {
    const { executor, calls } = harness(appliedResult());
    // deno-lint-ignore no-explicit-any
    const result = await executor({ ...VALID_ARGS, ...patch } as any);
    assert(result.ok);
    assertStrictEquals(calls.length, 1);
    // deno-lint-ignore no-explicit-any
    assertStrictEquals((calls[0] as any).body.note, expected);
  }
});

Deno.test("KPI-6C (F1): the canonical idempotency payload is exactly the four business fields", async () => {
  const { executor, calls } = harness(appliedResult());
  // deno-lint-ignore no-explicit-any
  await executor({ ...VALID_ARGS, note: "  progress  " } as any);
  // deno-lint-ignore no-explicit-any
  const body = (calls[0] as any).body;

  const restPayload = buildApiV1AppendKpiUpdateIdempotencyPayload(
    KPI_ID,
    parseApiV1AppendKpiUpdateBody({
      value: 42,
      updateDate: "2026-08-22",
      note: "progress",
    }),
  );
  assertEquals(Object.keys(restPayload).sort(), [
    "kpiId",
    "note",
    "updateDate",
    "value",
  ]);
  assertEquals(
    buildApiV1AppendKpiUpdateIdempotencyPayload(KPI_ID, body),
    restPayload,
  );
});

Deno.test("KPI-6C (F2): equivalent note forms produce identical payloads and different business values differ", () => {
  const base = buildApiV1AppendKpiUpdateIdempotencyPayload(
    KPI_ID,
    parseApiV1AppendKpiUpdateBody({ value: 42, updateDate: "2026-08-22" }),
  );
  for (const note of [null, "", "   "]) {
    assertEquals(
      buildApiV1AppendKpiUpdateIdempotencyPayload(
        KPI_ID,
        parseApiV1AppendKpiUpdateBody({
          value: 42,
          updateDate: "2026-08-22",
          note,
        }),
      ),
      base,
    );
  }
  assertNotEquals(
    buildApiV1AppendKpiUpdateIdempotencyPayload(
      KPI_ID,
      parseApiV1AppendKpiUpdateBody({ value: 43, updateDate: "2026-08-22" }),
    ),
    base,
  );
  assertNotEquals(
    buildApiV1AppendKpiUpdateIdempotencyPayload(
      KPI_ID,
      parseApiV1AppendKpiUpdateBody({ value: 42, updateDate: "2026-08-23" }),
    ),
    base,
  );
  assertNotEquals(
    buildApiV1AppendKpiUpdateIdempotencyPayload(
      KPI_ID,
      parseApiV1AppendKpiUpdateBody({
        value: 42,
        updateDate: "2026-08-22",
        note: "progress",
      }),
    ),
    base,
  );
});

Deno.test("KPI-6C (F3): confirmation, idempotency key, identity and scope never enter the business payload", () => {
  const payload = buildApiV1AppendKpiUpdateIdempotencyPayload(
    KPI_ID,
    parseApiV1AppendKpiUpdateBody({ value: 42, updateDate: "2026-08-22" }),
  ) as Record<string, unknown>;
  for (
    const forbidden of [
      "confirmation",
      "idempotencyKey",
      "projectId",
      "workspaceId",
      "organizationId",
      "tenantId",
      "authorId",
      "oauthClientId",
      "sourceChannel",
      "requestId",
      "payloadHash",
    ]
  ) {
    assertFalse(Object.prototype.hasOwnProperty.call(payload, forbidden));
  }
});

Deno.test("KPI-6C (G1): the exact kpis.updates.append rate profile and trusted identity are used", async () => {
  const { executor, routeIds, rateIdentities } = harness(appliedResult());
  // deno-lint-ignore no-explicit-any
  await executor({ ...VALID_ARGS } as any);
  assertStrictEquals(KPI_UPDATE_APPEND_ROUTE.id, "kpis.updates.append");
  assertEquals(routeIds, ["kpis.updates.append"]);
  assertEquals(rateIdentities[0], { apiClientId: API_CLIENT_ID });
  assertEquals(rateIdentities[1], {
    apiClientId: API_CLIENT_ID,
    userId: USER_ID,
    routeId: "kpis.updates.append",
  });
  assertFalse(toolSource.includes("KPI_UPDATE_ROUTE.id"));
  assertFalse(toolSource.includes("KPI_CREATE_ROUTE"));
  assertFalse(toolSource.includes("KPI_UPDATES_ROUTE"));
});

Deno.test("KPI-6C (G2): a rejected rate limit makes zero writer calls", async () => {
  const { executor, calls } = harness(appliedResult(), { rateLimited: true });
  // deno-lint-ignore no-explicit-any
  const result = await executor({ ...VALID_ARGS } as any);
  assertFalse(result.ok);
  assertStrictEquals(
    result.ok === false ? result.category : null,
    "rate_limited",
  );
  assertStrictEquals(calls.length, 0);
});

Deno.test("KPI-6C (H1): the writer runs exactly once with the original request, canonical id/body/context", async () => {
  const { executor, calls } = harness(appliedResult());
  // deno-lint-ignore no-explicit-any
  const result = await executor({ ...VALID_ARGS, note: "progress" } as any);
  assert(result.ok);
  assertStrictEquals(calls.length, 1);
  // deno-lint-ignore no-explicit-any
  const call = calls[0] as any;
  assert(call.request instanceof Request);
  assertStrictEquals(call.request.headers.get("Authorization"), "Bearer fake-token");
  assertStrictEquals(call.kpiId, KPI_ID);
  assertEquals(Object.keys(call.body).sort(), ["note", "updateDate", "value"]);
  assertStrictEquals(call.ctx.sourceChannel, "mcp");
  assertStrictEquals(call.ctx.delegationMode, "delegated_user");
  assertStrictEquals(call.ctx.idempotencyKey, "kpi-6c-key-0001");
  assert(/^[0-9a-f]{64}$/.test(call.ctx.payloadHash));
});

Deno.test("KPI-6C (I1): the writer executor is caller-bound, anon-key only and fixed to the MCP wrapper", () => {
  assert(executorSource.includes("appendMcpV1KpiUpdate("));
  assertFalse(executorSource.includes("appendApiV1KpiUpdate"));
  assertFalse(executorSource.includes("api_v1_append_kpi_update"));
  assert(executorSource.includes("extractBearerToken(request)"));
  assert(executorSource.includes("supabaseAnonKey"));
  assertFalse(executorSource.includes("SERVICE_ROLE"));
  assertFalse(executorSource.includes("service_role"));
  assertFalse(executorSource.includes("serviceRole"));
  assertFalse(executorSource.includes("Deno.env"));
  assertFalse(executorSource.includes(".from("));
  assertFalse(executorSource.includes("console."));
  // Fresh client per invocation, inside the returned executor.
  assertStrictEquals(executorSource.split("createClient(").length - 1, 1);
  // Trusted-context invariants.
  for (
    const invariant of [
      'REQUIRED_SOURCE_CHANNEL = "mcp"',
      'REQUIRED_DELEGATION_MODE = "delegated_user"',
      "requestedUserId !== executingUserId",
      "sourceClientId !== apiClientId",
      "correlationId !== requestId",
      "SHA256_HEX_PATTERN",
      "parseApiV1KpiUpdatesPath(",
    ]
  ) {
    assert(executorSource.includes(invariant), `missing ${invariant}`);
  }
});

Deno.test("KPI-6C (J1): the adapter has exactly two fixed append wrapper literals", () => {
  assert(
    adapterSource.includes(
      'const API_V1_APPEND_KPI_UPDATE_FUNCTION_NAME = "api_v1_append_kpi_update"',
    ),
  );
  assert(
    adapterSource.includes(
      'const MCP_V1_APPEND_KPI_UPDATE_FUNCTION_NAME = "mcp_v1_append_kpi_update"',
    ),
  );
  assertStrictEquals(
    adapterSource.split('"api_v1_append_kpi_update"').length - 1,
    1,
  );
  assertStrictEquals(
    adapterSource.split('"mcp_v1_append_kpi_update"').length - 1,
    1,
  );
  // Callers cannot choose the wrapper: both exported adapters bind it.
  assert(
    adapterSource.includes(
      "export function appendApiV1KpiUpdate(",
    ),
  );
  assert(
    adapterSource.includes(
      "export function appendMcpV1KpiUpdate(",
    ),
  );
  assertStrictEquals(
    adapterSource.split("invokeAppendKpiUpdate(").length - 1,
    3, // definition + two fixed call sites
  );
});

Deno.test("KPI-6C (K1): valid writer outcomes map to the exact bounded shapes", async () => {
  for (const outcome of ["applied", "replayed"] as const) {
    const { executor } = harness({ ...appliedResult(), outcome });
    // deno-lint-ignore no-explicit-any
    const result = await executor({ ...VALID_ARGS } as any);
    assert(result.ok);
    if (result.ok) {
      assertEquals(result.payload, {
        outcome,
        kpiUpdateId: KPI_UPDATE_ID,
        kpiId: KPI_ID,
        projectId: PROJECT_ID,
      });
    }
  }

  const negatives: ReadonlyArray<[string, string]> = [
    ["invalid", "invalid_arguments"],
    ["not_authorized", "not_authorized"],
    ["idempotency_conflict", "idempotency_conflict"],
    ["idempotency_pending", "idempotency_pending"],
  ];
  for (const [outcome, category] of negatives) {
    const { executor } = harness({ ok: false, outcome });
    // deno-lint-ignore no-explicit-any
    const result = await executor({ ...VALID_ARGS } as any);
    assertFalse(result.ok);
    assertStrictEquals(result.ok === false ? result.category : null, category);
  }
});

Deno.test("KPI-6C (K2): every malformed writer result is bounded as unavailable", async () => {
  const malformed: ReadonlyArray<unknown> = [
    null,
    undefined,
    [],
    [appliedResult()],
    "applied",
    42,
    true,
    {},
    { ok: true },
    { ...appliedResult(), outcome: "no_change" },
    { ...appliedResult(), outcome: "conflict" },
    { ...appliedResult(), outcome: "unknown" },
    { ok: true, outcome: "applied", kpiId: KPI_ID, projectId: PROJECT_ID },
    {
      ok: true,
      outcome: "applied",
      kpiUpdateId: KPI_UPDATE_ID,
      projectId: PROJECT_ID,
    },
    { ok: true, outcome: "applied", kpiUpdateId: KPI_UPDATE_ID, kpiId: KPI_ID },
    { ...appliedResult(), kpiUpdateId: "" },
    { ...appliedResult(), kpiId: "" },
    { ...appliedResult(), projectId: "" },
    { ...appliedResult(), kpiId: "77777777-7777-4777-8777-777777777777" },
    { ...appliedResult(), message: "leak" },
    { ...appliedResult(), detail: "leak" },
    { ...appliedResult(), reason: "leak" },
    { ...appliedResult(), note: "protected" },
    { ...appliedResult(), value: 42 },
    { ok: false, outcome: "invalid", message: "leak" },
    { ok: false, outcome: "not_authorized", detail: "leak" },
    { ok: false, outcome: "idempotency_conflict", reason: "leak" },
    { ok: false, outcome: "unknown" },
    { ok: false, outcome: "conflict" },
    { ok: false, outcome: "conflict", code: "stale_kpi_definition" },
    { ok: false, outcome: "no_change" },
  ];
  for (const writerResult of malformed) {
    const { executor } = harness(writerResult);
    // deno-lint-ignore no-explicit-any
    const result = await executor({ ...VALID_ARGS } as any);
    assertFalse(result.ok, `malformed became success: ${JSON.stringify(writerResult)}`);
    assertStrictEquals(
      result.ok === false ? result.category : null,
      "unavailable",
      `unexpected category for ${JSON.stringify(writerResult)}`,
    );
  }
});

Deno.test("KPI-6C (K3): the bounded error vocabulary discloses no internals", () => {
  assertEquals(
    Object.keys(MCP_KPI_UPDATE_APPEND_TOOL_ERROR_MESSAGES).sort(),
    [
      "confirmation_required",
      "idempotency_conflict",
      "idempotency_pending",
      "invalid_arguments",
      "not_authorized",
      "rate_limited",
      "unavailable",
    ],
  );
  for (
    const message of Object.values(MCP_KPI_UPDATE_APPEND_TOOL_ERROR_MESSAGES)
  ) {
    for (
      const forbidden of [
        "sql",
        "postgres",
        "policy",
        "token",
        "mcp_v1_",
        "api_v1_",
        "append_kpi_update",
      ]
    ) {
      assertFalse(
        message.toLowerCase().includes(forbidden),
        `message leaks ${forbidden}`,
      );
    }
  }
  assertFalse(
    Object.prototype.hasOwnProperty.call(
      MCP_KPI_UPDATE_APPEND_TOOL_ERROR_MESSAGES,
      "stale_kpi_definition",
    ),
  );
});

Deno.test("KPI-6C (K4): the control layer touches no client, env, RPC or table", () => {
  for (
    const forbidden of [
      "createClient",
      "Deno.env",
      ".rpc(",
      ".from(",
      "service_role",
      "SERVICE_ROLE",
      "console.",
    ]
  ) {
    assertFalse(toolSource.includes(forbidden), `control layer uses ${forbidden}`);
  }
});

// -----------------------------------------------------------------------------
// L. serverFactory wiring
// -----------------------------------------------------------------------------

Deno.test("KPI-6C (L1): serverFactory imports the control tool only", () => {
  assert(serverFactorySource.includes('from "./kpiUpdateAppendMutationTool.ts"'));
  assertFalse(
    serverFactorySource.includes("kpiUpdateAppendMutationExecutor.ts"),
  );
  assert(
    serverFactorySource.includes(
      "readonly kpiUpdateAppend: McpKpiUpdateAppendToolExecutor;",
    ),
  );
  assertStrictEquals(
    serverFactorySource.split("MCP_KPI_UPDATE_APPEND_TOOL_NAME").length - 1,
    2, // import + one registration branch
  );
  assertStrictEquals(
    serverFactorySource.split("executors.kpiUpdateAppend(").length - 1,
    1,
  );
  assert(
    serverFactorySource.includes("MCP_KPI_UPDATE_APPEND_TOOL_INPUT_SCHEMA"),
  );
  assert(
    serverFactorySource.includes("MCP_KPI_UPDATE_APPEND_TOOL_ERROR_MESSAGES"),
  );
});

// -----------------------------------------------------------------------------
// M. btpm-mcp runtime wiring
// -----------------------------------------------------------------------------

Deno.test("KPI-6C (M1): the runtime constructs the caller-bound writer with the anon key", () => {
  assert(mcpIndexSource.includes("createMcpV1AppendKpiUpdateExecutor("));
  assert(mcpIndexSource.includes("createMcpKpiUpdateAppendToolExecutor("));
  assert(
    mcpIndexSource.includes(
      "readonly kpiUpdateAppendWriter: McpV1AppendKpiUpdateExecutor;",
    ),
  );
  const writerBlock = mcpIndexSource.slice(
    mcpIndexSource.indexOf("createMcpV1AppendKpiUpdateExecutor(\n"),
  ).slice(0, 300);
  assert(writerBlock.includes("supabaseAnonKey"));
  assertFalse(writerBlock.includes("serviceRole"));
});

Deno.test("KPI-6C (M2): the per-request control executor is composed once and injected explicitly", () => {
  assertStrictEquals(
    mcpIndexSource.split("createMcpKpiUpdateAppendToolExecutor({").length - 1,
    1,
  );
  const block = mcpIndexSource.slice(
    mcpIndexSource.indexOf("createMcpKpiUpdateAppendToolExecutor({"),
  ).slice(0, 400);
  for (
    const dependency of [
      "request,",
      "execution: executionContext,",
      "writer: runtime.kpiUpdateAppendWriter,",
      "rateLimitProfileResolver",
      "rateLimitStore",
      "now: () => runtime.now(),",
    ]
  ) {
    assert(block.includes(dependency), `missing ${dependency}`);
  }
  assert(mcpIndexSource.includes("        kpiUpdateAppend,\n"));
});

// -----------------------------------------------------------------------------
// N. Regression
// -----------------------------------------------------------------------------

Deno.test("KPI-6C (N1): the KPI update-append route stays a single canonical POST route", () => {
  // MCP-HARDENING-C1: the former global REST totals (50 / 24 / 26) were
  // removed; only this step's own capability is asserted here.
  const routes = API_V1_ROUTE_ALLOWLIST;
  const appendRoutes = routes.filter((route) =>
    route.id === "kpis.updates.append"
  );
  assertStrictEquals(appendRoutes.length, 1);
  assertStrictEquals(appendRoutes[0].operation, "mutation");
  assertStrictEquals(
    routes.filter((route) => route.method === "GET").length +
      routes.filter((route) => route.method !== "GET").length,
    routes.length,
  );
});
