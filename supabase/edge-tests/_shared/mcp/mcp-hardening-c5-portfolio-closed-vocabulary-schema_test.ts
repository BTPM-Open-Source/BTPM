// MCP-HARDENING-C5 — Portfolio closed-vocabulary MCP schema parity.
//
// Proves that the `portfolios.create` and `portfolios.update` MCP transport
// schemas advertise the canonical Portfolio lifecycle and strategic-priority
// vocabularies as closed enums (discoverable by an MCP client), while the
// canonical API parsers remain the sole business-validation and defaulting
// authority.
//
// Every accepted case is DERIVED from the canonical API authorities; this file
// contains no copied vocabulary inventory. No network, no database, no Edge
// invocation, no service-role key.

import {
  assert,
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  createMcpPortfolioCreateToolExecutor,
  MCP_PORTFOLIO_CREATE_TOOL_INPUT_SCHEMA,
} from "../../../functions/btpm-mcp/mcp/portfolioCreateMutationTool.ts";
import {
  createMcpPortfolioUpdateToolExecutor,
  MCP_PORTFOLIO_UPDATE_TOOL_INPUT_SCHEMA,
  type McpPortfolioUpdateToolErrorCategory,
} from "../../../functions/btpm-mcp/mcp/portfolioUpdateMutationTool.ts";
import {
  API_V1_PORTFOLIO_LIFECYCLE_STATES,
  API_V1_PORTFOLIO_STRATEGIC_PRIORITIES,
  parseApiV1CreatePortfolioBody,
  parseApiV1UpdatePortfolioBody,
} from "../../../functions/_shared/btpm-api/routes/portfolios.ts";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_ID = "22222222-2222-4222-8222-222222222222";
const PORTFOLIO_ID = "55555555-5555-4555-8555-555555555555";
const API_CLIENT_ID = "44444444-4444-4444-8444-444444444444";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const EXPECTED_UPDATED_AT = "2026-08-18T10:11:12.123456Z";

const CANONICAL_LIFECYCLE_STATES = [...API_V1_PORTFOLIO_LIFECYCLE_STATES];
const CANONICAL_STRATEGIC_PRIORITIES = [
  ...API_V1_PORTFOLIO_STRATEGIC_PRIORITIES,
];

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

const createArgs = Object.freeze({
  organizationId: ORGANIZATION_ID,
  name: "Oncology Portfolio",
  confirmation: true,
  idempotencyKey: "idem-key-portfolio-create",
});

const updateArgs = Object.freeze({
  portfolioId: PORTFOLIO_ID,
  expectedUpdatedAt: EXPECTED_UPDATED_AT,
  name: "Oncology Portfolio",
  confirmation: true,
  idempotencyKey: "idem-key-portfolio-update",
});

interface WriterCall {
  readonly portfolioId?: string;
  // deno-lint-ignore no-explicit-any
  readonly body: any;
}

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

function buildCreateHarness(
  // deno-lint-ignore no-explicit-any
  writerResult: any = {
    ok: true,
    outcome: "applied",
    portfolioId: PORTFOLIO_ID,
  },
) {
  const writerCalls: WriterCall[] = [];
  const request = new Request("https://example.test/mcp", { method: "POST" });
  const executor = createMcpPortfolioCreateToolExecutor({
    request,
    execution: trustedExecution,
    // deno-lint-ignore no-explicit-any
    writer: ((_req: Request, body: any) => {
      writerCalls.push({ body });
      return Promise.resolve(writerResult);
      // deno-lint-ignore no-explicit-any
    }) as any,
    ...rateLimitDependencies(),
  });
  return { executor, writerCalls };
}

function buildUpdateHarness(
  // deno-lint-ignore no-explicit-any
  writerResult: any = {
    ok: true,
    outcome: "applied",
    portfolioId: PORTFOLIO_ID,
    updatedAt: "2026-08-18T12:00:00.000000Z",
  },
) {
  const writerCalls: WriterCall[] = [];
  const request = new Request("https://example.test/mcp", { method: "POST" });
  const executor = createMcpPortfolioUpdateToolExecutor({
    request,
    execution: trustedExecution,
    writer: ((
      _req: Request,
      portfolioId: string,
      // deno-lint-ignore no-explicit-any
      body: any,
    ) => {
      writerCalls.push({ portfolioId, body });
      return Promise.resolve(writerResult);
      // deno-lint-ignore no-explicit-any
    }) as any,
    ...rateLimitDependencies(),
  });
  return { executor, writerCalls };
}

// ---------------------------------------------------------------------------
// 0. Discoverability regression — the schemas must expose closed enums.
// ---------------------------------------------------------------------------

/** Unwraps optional/nullable wrappers down to the innermost Zod schema. */
// deno-lint-ignore no-explicit-any
function innermost(schema: any): any {
  let current = schema;
  while (current?.def?.innerType) current = current.def.innerType;
  return current;
}

// deno-lint-ignore no-explicit-any
function advertisedEnumValues(schema: any): string[] {
  const inner = innermost(schema);
  assertEquals(
    inner.def.type,
    "enum",
    "the field must advertise a closed enum, not a generic string schema",
  );
  return Object.values(inner.def.entries as Record<string, string>);
}

Deno.test("C5-0: both Portfolio schemas advertise closed canonical enums", () => {
  const surfaces: ReadonlyArray<
    // deno-lint-ignore no-explicit-any
    [label: string, schema: any, canonical: ReadonlyArray<string>]
  > = [
    [
      "create.lifecycleState",
      MCP_PORTFOLIO_CREATE_TOOL_INPUT_SCHEMA.shape.lifecycleState,
      CANONICAL_LIFECYCLE_STATES,
    ],
    [
      "create.strategicPriority",
      MCP_PORTFOLIO_CREATE_TOOL_INPUT_SCHEMA.shape.strategicPriority,
      CANONICAL_STRATEGIC_PRIORITIES,
    ],
    [
      "update.lifecycleState",
      MCP_PORTFOLIO_UPDATE_TOOL_INPUT_SCHEMA.shape.lifecycleState,
      CANONICAL_LIFECYCLE_STATES,
    ],
    [
      "update.strategicPriority",
      MCP_PORTFOLIO_UPDATE_TOOL_INPUT_SCHEMA.shape.strategicPriority,
      CANONICAL_STRATEGIC_PRIORITIES,
    ],
  ];

  for (const [label, schema, canonical] of surfaces) {
    const advertised = advertisedEnumValues(schema);
    assertEquals(
      [...advertised].sort(),
      [...canonical].sort(),
      `${label} must advertise exactly the canonical vocabulary`,
    );
  }
});

Deno.test("C5-0b: MCP presentation modules declare no Portfolio vocabulary literal", async () => {
  const files = [
    "../../../functions/btpm-mcp/mcp/portfolioCreateMutationTool.ts",
    "../../../functions/btpm-mcp/mcp/portfolioUpdateMutationTool.ts",
    "../../../functions/btpm-mcp/mcp/closedVocabularySchema.ts",
  ];
  for (const relative of files) {
    const source = await Deno.readTextFile(
      new URL(relative, import.meta.url),
    );
    for (
      const value of [
        ...CANONICAL_LIFECYCLE_STATES,
        ...CANONICAL_STRATEGIC_PRIORITIES,
      ]
    ) {
      assertFalse(
        source.includes(`"${value}"`),
        `${relative} must not restate the canonical value ${value}`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// 1. Create — lifecycleState / strategicPriority vocabulary parity.
// ---------------------------------------------------------------------------

Deno.test("C5-1A: Create accepts every canonical lifecycle value and rejects others", () => {
  for (const value of CANONICAL_LIFECYCLE_STATES) {
    assert(
      MCP_PORTFOLIO_CREATE_TOOL_INPUT_SCHEMA.safeParse({
        ...createArgs,
        lifecycleState: value,
      }).success,
      `canonical lifecycle value must be accepted: ${value}`,
    );
  }
  for (const value of ["unknown", "ACTIVE", "", null, 1, {}]) {
    assertFalse(
      MCP_PORTFOLIO_CREATE_TOOL_INPUT_SCHEMA.safeParse({
        ...createArgs,
        lifecycleState: value,
      }).success,
      `non-canonical lifecycle value must be rejected: ${String(value)}`,
    );
  }
});

Deno.test("C5-1B: Create accepts every canonical strategic priority and rejects others", () => {
  for (const value of CANONICAL_STRATEGIC_PRIORITIES) {
    assert(
      MCP_PORTFOLIO_CREATE_TOOL_INPUT_SCHEMA.safeParse({
        ...createArgs,
        strategicPriority: value,
      }).success,
      `canonical priority value must be accepted: ${value}`,
    );
  }
  for (const value of ["urgent", "Critical", "", null, 0, []]) {
    assertFalse(
      MCP_PORTFOLIO_CREATE_TOOL_INPUT_SCHEMA.safeParse({
        ...createArgs,
        strategicPriority: value,
      }).success,
      `non-canonical priority value must be rejected: ${String(value)}`,
    );
  }
});

Deno.test("C5-1C: Create omission stays valid and canonical defaults still apply", async () => {
  assert(MCP_PORTFOLIO_CREATE_TOOL_INPUT_SCHEMA.safeParse(createArgs).success);
  const parsed = MCP_PORTFOLIO_CREATE_TOOL_INPUT_SCHEMA.parse(createArgs);
  assertEquals(parsed.lifecycleState, undefined);
  assertEquals(parsed.strategicPriority, undefined);

  const { executor, writerCalls } = buildCreateHarness();
  const result = await executor(createArgs);
  assert(result.ok);
  assertEquals(writerCalls.length, 1);

  // The canonical parser — not MCP — supplies the defaults.
  const canonicalDefault = parseApiV1CreatePortfolioBody({
    organizationId: ORGANIZATION_ID,
    name: "Oncology Portfolio",
  });
  assertEquals(writerCalls[0].body, canonicalDefault);
  assert(
    API_V1_PORTFOLIO_LIFECYCLE_STATES.has(canonicalDefault.lifecycleState),
  );
  assert(
    API_V1_PORTFOLIO_STRATEGIC_PRIORITIES.has(
      canonicalDefault.strategicPriority,
    ),
  );
});

Deno.test("C5-1D: valid Create input still flows through the canonical parser", async () => {
  const lifecycleState = CANONICAL_LIFECYCLE_STATES[0];
  const strategicPriority = CANONICAL_STRATEGIC_PRIORITIES[0];
  const { executor, writerCalls } = buildCreateHarness();
  const result = await executor({
    ...createArgs,
    name: "  Trimmed Name  ",
    lifecycleState,
    strategicPriority,
    // deno-lint-ignore no-explicit-any
  } as any);
  assert(result.ok);
  assertEquals(
    writerCalls[0].body,
    parseApiV1CreatePortfolioBody({
      organizationId: ORGANIZATION_ID,
      name: "Trimmed Name",
      lifecycleState,
      strategicPriority,
    }),
  );
});

Deno.test("C5-1E: an invalid Create vocabulary value is bounded invalid_arguments", async () => {
  const { executor, writerCalls } = buildCreateHarness();
  const result = await executor({
    ...createArgs,
    lifecycleState: "ACTIVE",
    // deno-lint-ignore no-explicit-any
  } as any);
  assertEquals(result, { ok: false, category: "invalid_arguments" });
  assertEquals(writerCalls.length, 0);
});

// ---------------------------------------------------------------------------
// 2. Update — vocabulary parity and unchanged presence semantics.
// ---------------------------------------------------------------------------

Deno.test("C5-2A: Update accepts every canonical lifecycle value", () => {
  for (const value of CANONICAL_LIFECYCLE_STATES) {
    assert(
      MCP_PORTFOLIO_UPDATE_TOOL_INPUT_SCHEMA.safeParse({
        ...updateArgs,
        lifecycleState: value,
      }).success,
      `canonical lifecycle value must be accepted: ${value}`,
    );
  }
});

Deno.test("C5-2B: Update rejects non-canonical lifecycle strings and explicit null", () => {
  for (const value of ["unknown", "ACTIVE", "", null]) {
    assertFalse(
      MCP_PORTFOLIO_UPDATE_TOOL_INPUT_SCHEMA.safeParse({
        ...updateArgs,
        lifecycleState: value,
      }).success,
      `must be rejected: ${String(value)}`,
    );
  }
});

Deno.test("C5-2C: Update accepts every canonical strategic priority", () => {
  for (const value of CANONICAL_STRATEGIC_PRIORITIES) {
    assert(
      MCP_PORTFOLIO_UPDATE_TOOL_INPUT_SCHEMA.safeParse({
        ...updateArgs,
        strategicPriority: value,
      }).success,
      `canonical priority value must be accepted: ${value}`,
    );
  }
});

Deno.test("C5-2D: Update rejects non-canonical priorities and explicit null", () => {
  for (const value of ["urgent", "Critical", "", null]) {
    assertFalse(
      MCP_PORTFOLIO_UPDATE_TOOL_INPUT_SCHEMA.safeParse({
        ...updateArgs,
        strategicPriority: value,
      }).success,
      `must be rejected: ${String(value)}`,
    );
  }
});

Deno.test("C5-2E: Update omission remains valid and absent", () => {
  const parsed = MCP_PORTFOLIO_UPDATE_TOOL_INPUT_SCHEMA.parse(updateArgs);
  assertFalse("lifecycleState" in parsed);
  assertFalse("strategicPriority" in parsed);
});

Deno.test("C5-2F: Update clearable-field null semantics are unchanged", async () => {
  const { executor, writerCalls } = buildUpdateHarness();
  const result = await executor({
    ...updateArgs,
    code: null,
    description: null,
    ownerId: null,
  });
  assert(result.ok);
  assertEquals(
    writerCalls[0].body,
    parseApiV1UpdatePortfolioBody({
      expectedUpdatedAt: EXPECTED_UPDATED_AT,
      name: "Oncology Portfolio",
      code: null,
      description: null,
      ownerId: null,
    }),
  );
});

Deno.test("C5-2G: the canonical update parser remains the sole set* authority", async () => {
  const lifecycleState = CANONICAL_LIFECYCLE_STATES[1];
  const strategicPriority = CANONICAL_STRATEGIC_PRIORITIES[1];
  const { executor, writerCalls } = buildUpdateHarness();
  const result = await executor({
    ...updateArgs,
    lifecycleState,
    strategicPriority,
    ownerId: OWNER_ID,
    // deno-lint-ignore no-explicit-any
  } as any);
  assert(result.ok);
  assertEquals(
    writerCalls[0].body,
    parseApiV1UpdatePortfolioBody({
      expectedUpdatedAt: EXPECTED_UPDATED_AT,
      name: "Oncology Portfolio",
      lifecycleState,
      strategicPriority,
      ownerId: OWNER_ID,
    }),
  );
});

Deno.test("C5-2H: existing bounded Update outcomes remain unchanged", async () => {
  const outcomes: ReadonlyArray<
    [string, McpPortfolioUpdateToolErrorCategory]
  > = [
    ["not_authorized", "not_authorized"],
    ["idempotency_conflict", "idempotency_conflict"],
    ["idempotency_pending", "idempotency_pending"],
    ["invalid", "invalid_arguments"],
  ];
  for (const [writerOutcome, category] of outcomes) {
    const { executor } = buildUpdateHarness({
      ok: false,
      outcome: writerOutcome,
    });
    const result = await executor(updateArgs);
    assertEquals(result, { ok: false, category });
  }
});
