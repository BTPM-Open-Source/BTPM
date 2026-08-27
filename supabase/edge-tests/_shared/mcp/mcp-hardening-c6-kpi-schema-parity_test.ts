// MCP-HARDENING-C6 — KPI closed-vocabulary and presence/nullability MCP schema
// parity.
//
// Proves that the `kpis.create` and `kpis.update` MCP transport schemas
// advertise the five canonical KPI vocabularies as closed enums (discoverable
// by an MCP client) and that their null/blank presence semantics match the
// canonical API parsers exactly. Every accepted case is DERIVED from the
// canonical API authorities; this file contains no copied vocabulary inventory
// (only representative INVALID fixtures). No network, no database, no Edge
// invocation, no service-role key.

import {
  assert,
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  createMcpKpiCreateToolExecutor,
  MCP_KPI_CREATE_TOOL_INPUT_SCHEMA,
} from "../../../functions/btpm-mcp/mcp/kpiCreateMutationTool.ts";
import {
  createMcpKpiUpdateToolExecutor,
  MCP_KPI_UPDATE_TOOL_INPUT_SCHEMA,
} from "../../../functions/btpm-mcp/mcp/kpiUpdateMutationTool.ts";
import {
  API_V1_KPI_CADENCES,
  API_V1_KPI_COMPLETION_METHODS,
  API_V1_KPI_SOURCE_MODES,
  API_V1_KPI_TARGET_DIRECTIONS,
  API_V1_KPI_VALUE_TYPES,
  parseApiV1CreateKpiBody,
  parseApiV1UpdateKpiBody,
} from "../../../functions/_shared/btpm-api/routes/kpis.ts";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const KPI_ID = "55555555-5555-4555-8555-555555555555";
const API_CLIENT_ID = "44444444-4444-4444-8444-444444444444";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const EXPECTED_UPDATED_AT = "2026-08-18T10:11:12.123456Z";

const BLANK_SENTINELS = ["", " ", "   "] as const;
const INVALID_ENUM_VALUE = "definitely_not_a_canonical_value";

/** The canonical enum-field authorities, addressed by transport field name. */
const CANONICAL_ENUM_AUTHORITIES = {
  targetDirection: [...API_V1_KPI_TARGET_DIRECTIONS],
  sourceMode: [...API_V1_KPI_SOURCE_MODES],
  valueType: [...API_V1_KPI_VALUE_TYPES],
  cadence: [...API_V1_KPI_CADENCES],
  completionMethod: [...API_V1_KPI_COMPLETION_METHODS],
} as const;

const DEFAULTED_CREATE_ENUM_FIELDS = [
  "targetDirection",
  "sourceMode",
  "valueType",
  "cadence",
] as const;

const trustedExecution = Object.freeze({
  requestedUserId: USER_ID,
  executingUserId: USER_ID,
  apiClientId: API_CLIENT_ID,
  oauthClientId: "oauth-1",
  policyVersionId: "policy-1",
  requestId: "req-1",
  correlationId: "req-1",
  sourceChannel: "mcp" as const,
  sourceClientId: API_CLIENT_ID,
  delegationMode: "delegated_user" as const,
});

function rateLimitDependencies() {
  return {
    rateLimitProfileResolver: {
      resolve: () => Promise.resolve({ limit: 100, windowSeconds: 60 }),
      // deno-lint-ignore no-explicit-any
    } as any,
    rateLimitStore: {
      consume: () =>
        Promise.resolve({
          allowed: true,
          remaining: 99,
          resetAtEpochMs: 1_700_000_060_000,
        }),
      // deno-lint-ignore no-explicit-any
    } as any,
    now: () => 1_700_000_000_000,
  };
}

// deno-lint-ignore no-explicit-any
function buildCreateHarness(): { executor: any; writerBodies: any[] } {
  // deno-lint-ignore no-explicit-any
  const writerBodies: any[] = [];
  const request = new Request("https://example.test/mcp", { method: "POST" });
  const executor = createMcpKpiCreateToolExecutor({
    request,
    execution: trustedExecution,
    // deno-lint-ignore no-explicit-any
    writer: ((_req: Request, _projectId: string, body: any) => {
      writerBodies.push(body);
      return Promise.resolve({
        ok: true,
        outcome: "applied",
        kpiId: KPI_ID,
        projectId: PROJECT_ID,
      });
      // deno-lint-ignore no-explicit-any
    }) as any,
    ...rateLimitDependencies(),
    // deno-lint-ignore no-explicit-any
  } as any);
  return { executor, writerBodies };
}

// deno-lint-ignore no-explicit-any
function buildUpdateHarness(): { executor: any; writerBodies: any[] } {
  // deno-lint-ignore no-explicit-any
  const writerBodies: any[] = [];
  const request = new Request("https://example.test/mcp", { method: "POST" });
  const executor = createMcpKpiUpdateToolExecutor({
    request,
    execution: trustedExecution,
    // deno-lint-ignore no-explicit-any
    writer: ((_req: Request, _kpiId: string, body: any) => {
      writerBodies.push(body);
      return Promise.resolve({
        ok: true,
        outcome: "applied",
        kpiId: KPI_ID,
        projectId: PROJECT_ID,
        updatedAt: "2026-08-18T12:00:00.000000Z",
      });
      // deno-lint-ignore no-explicit-any
    }) as any,
    ...rateLimitDependencies(),
    // deno-lint-ignore no-explicit-any
  } as any);
  return { executor, writerBodies };
}

function createArgs(overrides: Record<string, unknown> = {}) {
  return {
    projectId: PROJECT_ID,
    name: "On-time delivery",
    confirmation: true,
    idempotencyKey: "idem-key-kpi-create",
    ...overrides,
  };
}

function updateArgs(overrides: Record<string, unknown> = {}) {
  return {
    kpiId: KPI_ID,
    expectedUpdatedAt: EXPECTED_UPDATED_AT,
    confirmation: true,
    idempotencyKey: "idem-key-kpi-update",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Runtime schema discoverability (never source-text matching).
// ---------------------------------------------------------------------------

/** Collects every closed-enum option advertised anywhere under a field schema. */
// deno-lint-ignore no-explicit-any
function collectEnumOptionSets(schema: any): string[][] {
  if (schema === undefined || schema === null) return [];
  const def = schema._def ?? schema.def;
  const typeName: string = def?.type ?? def?.typeName ?? "";

  if (Array.isArray(schema.options) && typeName.includes("enum")) {
    return [[...schema.options] as string[]];
  }
  if (def?.entries && typeName.includes("enum")) {
    return [Object.values(def.entries) as string[]];
  }
  if (Array.isArray(def?.options)) {
    // deno-lint-ignore no-explicit-any
    return def.options.flatMap((o: any) => collectEnumOptionSets(o));
  }
  if (def?.innerType) return collectEnumOptionSets(def.innerType);
  return [];
}

// deno-lint-ignore no-explicit-any
function fieldSchema(objectSchema: any, field: string): any {
  const shape = objectSchema.shape ?? objectSchema._def?.shape ??
    objectSchema.def?.shape;
  const resolved = typeof shape === "function" ? shape() : shape;
  return resolved[field];
}

for (
  const [label, objectSchema] of [
    ["create", MCP_KPI_CREATE_TOOL_INPUT_SCHEMA],
    ["update", MCP_KPI_UPDATE_TOOL_INPUT_SCHEMA],
  ] as const
) {
  Deno.test(`C6 ${label} schema advertises canonical closed enums`, () => {
    for (const [field, canonical] of Object.entries(
      CANONICAL_ENUM_AUTHORITIES,
    )) {
      const sets = collectEnumOptionSets(fieldSchema(objectSchema, field));
      assertEquals(
        sets.length,
        1,
        `${label}.${field} must advertise exactly one closed enum branch`,
      );
      assertEquals(
        [...sets[0]].sort(),
        [...canonical].sort(),
        `${label}.${field} enum must equal its canonical authority`,
      );
    }
  });
}

Deno.test("C6 no KPI vocabulary literal is duplicated in MCP modules", async () => {
  const files = [
    "../../../functions/btpm-mcp/mcp/kpiCreateMutationTool.ts",
    "../../../functions/btpm-mcp/mcp/kpiUpdateMutationTool.ts",
    "../../../functions/btpm-mcp/mcp/closedVocabularySchema.ts",
  ];
  const literals = Object.values(CANONICAL_ENUM_AUTHORITIES).flat();
  for (const relative of files) {
    const source = await Deno.readTextFile(
      new URL(relative, import.meta.url),
    );
    for (const literal of literals) {
      assertFalse(
        source.includes(`"${literal}"`),
        `${relative} must not restate the canonical value "${literal}"`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// CREATE — defaulted enum sentinel semantics.
// ---------------------------------------------------------------------------

const CREATE_CANONICAL_DEFAULTS = parseApiV1CreateKpiBody({
  name: "On-time delivery",
});

for (const field of DEFAULTED_CREATE_ENUM_FIELDS) {
  Deno.test(`C6 create ${field} accepts every canonical value`, async () => {
    for (const value of CANONICAL_ENUM_AUTHORITIES[field]) {
      const { executor, writerBodies } = buildCreateHarness();
      const result = await executor(createArgs({ [field]: value }));
      assert(result.ok, `${field}=${value} must be accepted`);
      assertEquals(writerBodies.length, 1);
      assertEquals(
        (writerBodies[0] as Record<string, unknown>)[field],
        value,
      );
    }
  });

  Deno.test(
    `C6 create ${field} omitted/null/blank reaches the canonical default`,
    async () => {
      const expected =
        (CREATE_CANONICAL_DEFAULTS as unknown as Record<string, unknown>)[field];
      const sentinelInputs: Array<Record<string, unknown>> = [
        {},
        { [field]: null },
        ...BLANK_SENTINELS.map((blank) => ({ [field]: blank })),
      ];
      for (const overrides of sentinelInputs) {
        const { executor, writerBodies } = buildCreateHarness();
        const result = await executor(createArgs(overrides));
        assert(result.ok, `sentinel ${JSON.stringify(overrides)} accepted`);
        assertEquals(
          (writerBodies[0] as Record<string, unknown>)[field],
          expected,
          `canonical parser must supply the ${field} default`,
        );
      }
    },
  );

  Deno.test(
    `C6 create ${field} rejects a non-canonical value as invalid_arguments`,
    async () => {
      const { executor, writerBodies } = buildCreateHarness();
      const result = await executor(
        createArgs({ [field]: INVALID_ENUM_VALUE }),
      );
      assertEquals(result, { ok: false, category: "invalid_arguments" });
      assertEquals(writerBodies.length, 0);
    },
  );
}

Deno.test("C6 create completionMethod accepts canonical values, omission and null", async () => {
  for (const value of CANONICAL_ENUM_AUTHORITIES.completionMethod) {
    const { executor, writerBodies } = buildCreateHarness();
    const result = await executor(createArgs({ completionMethod: value }));
    assert(result.ok);
    assertEquals(writerBodies[0].completionMethod, value);
  }
  for (const overrides of [{}, { completionMethod: null }]) {
    const { executor, writerBodies } = buildCreateHarness();
    const result = await executor(createArgs(overrides));
    assert(result.ok);
    assertEquals(writerBodies[0].completionMethod, null);
  }
});

Deno.test("C6 create completionMethod rejects blank and non-canonical values", async () => {
  for (const value of [...BLANK_SENTINELS, INVALID_ENUM_VALUE]) {
    const { executor, writerBodies } = buildCreateHarness();
    const result = await executor(createArgs({ completionMethod: value }));
    assertEquals(result, { ok: false, category: "invalid_arguments" });
    assertEquals(writerBodies.length, 0);
  }
});

// ---------------------------------------------------------------------------
// UPDATE — closed enums, non-nullable present fields, clearable fields.
// ---------------------------------------------------------------------------

for (const field of DEFAULTED_CREATE_ENUM_FIELDS) {
  Deno.test(`C6 update ${field} accepts every canonical value only`, async () => {
    for (const value of CANONICAL_ENUM_AUTHORITIES[field]) {
      const { executor, writerBodies } = buildUpdateHarness();
      const result = await executor(updateArgs({ [field]: value }));
      assert(result.ok, `${field}=${value} must be accepted`);
      const body = writerBodies[0] as Record<string, unknown>;
      assertEquals(body[field], value);
      assertEquals(
        body[`set${field[0].toUpperCase()}${field.slice(1)}`],
        true,
        "canonical parser must derive set*=true for a present field",
      );
    }
    for (const value of [INVALID_ENUM_VALUE, ...BLANK_SENTINELS]) {
      const { executor, writerBodies } = buildUpdateHarness();
      const result = await executor(updateArgs({ [field]: value }));
      assertEquals(result, { ok: false, category: "invalid_arguments" });
      assertEquals(writerBodies.length, 0);
    }
  });
}

Deno.test("C6 update rejects explicit null on non-nullable present fields", async () => {
  const nonNullableFields = [
    "name",
    "targetDirection",
    "sourceMode",
    "valueType",
    "cadence",
    "commentRequired",
    "actionPlanRequired",
    "autoSnapshotEnabled",
  ];
  for (const field of nonNullableFields) {
    assertFalse(
      MCP_KPI_UPDATE_TOOL_INPUT_SCHEMA.safeParse(
        updateArgs({ [field]: null }),
      ).success,
      `${field}=null must be rejected by the MCP schema`,
    );
    const { executor, writerBodies } = buildUpdateHarness();
    const result = await executor(updateArgs({ [field]: null }));
    assertEquals(result, { ok: false, category: "invalid_arguments" });
    assertEquals(writerBodies.length, 0);
  }
});

Deno.test("C6 update keeps null valid for clearable fields", async () => {
  const clearable = [
    "description",
    "unit",
    "targetValue",
    "calculationKey",
    "formulaVersion",
    "completionMethod",
  ];
  for (const field of clearable) {
    const { executor, writerBodies } = buildUpdateHarness();
    const result = await executor(updateArgs({ [field]: null }));
    assert(result.ok, `${field}=null must remain valid`);
    const body = writerBodies[0] as Record<string, unknown>;
    assertEquals(body[field], null);
    assertEquals(
      body[`set${field[0].toUpperCase()}${field.slice(1)}`],
      true,
      "canonical parser must derive set*=true for an explicitly cleared field",
    );
  }
});

Deno.test("C6 update completionMethod preserves exact clear semantics", async () => {
  for (const value of CANONICAL_ENUM_AUTHORITIES.completionMethod) {
    const { executor, writerBodies } = buildUpdateHarness();
    const result = await executor(updateArgs({ completionMethod: value }));
    assert(result.ok);
    assertEquals(writerBodies[0].completionMethod, value);
    assertEquals(writerBodies[0].setCompletionMethod, true);
  }
  for (const value of [null, ...BLANK_SENTINELS]) {
    const { executor, writerBodies } = buildUpdateHarness();
    const result = await executor(updateArgs({ completionMethod: value }));
    assert(result.ok, `clear sentinel ${JSON.stringify(value)} accepted`);
    assertEquals(writerBodies[0].completionMethod, null);
    assertEquals(writerBodies[0].setCompletionMethod, true);
  }
  const { executor, writerBodies } = buildUpdateHarness();
  const result = await executor(
    updateArgs({ completionMethod: INVALID_ENUM_VALUE }),
  );
  assertEquals(result, { ok: false, category: "invalid_arguments" });
  assertEquals(writerBodies.length, 0);
});

Deno.test("C6 update omission keeps every set* flag false", async () => {
  const { executor, writerBodies } = buildUpdateHarness();
  const result = await executor(updateArgs());
  assert(result.ok);
  const body = writerBodies[0] as Record<string, unknown>;
  const canonical = parseApiV1UpdateKpiBody({
    expectedUpdatedAt: EXPECTED_UPDATED_AT,
  }) as unknown as Record<string, unknown>;
  for (const key of Object.keys(canonical)) {
    if (!key.startsWith("set")) continue;
    assertEquals(canonical[key], false);
    assertEquals(body[key], false, `${key} must remain false when omitted`);
  }
});

Deno.test("C6 update stale_kpi_definition behaviour is unchanged", async () => {
  const request = new Request("https://example.test/mcp", { method: "POST" });
  const executor = createMcpKpiUpdateToolExecutor({
    request,
    execution: trustedExecution,
    writer: (() =>
      Promise.resolve({
        ok: false,
        outcome: "conflict",
        code: "stale_kpi_definition",
        // deno-lint-ignore no-explicit-any
      })) as any,
    ...rateLimitDependencies(),
    // deno-lint-ignore no-explicit-any
  } as any);
  const result = await executor(updateArgs({ name: "Renamed KPI" }));
  assertEquals(result, { ok: false, category: "stale_kpi_definition" });
});
