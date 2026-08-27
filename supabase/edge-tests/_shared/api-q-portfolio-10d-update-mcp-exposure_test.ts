// API-Q Portfolio-10D — MCP exposure + runtime wiring evidence for the
// canonical `portfolios.update` mutation.
//
// This suite is deliberately DURABLE: it asserts nothing about the global
// exposed-tool inventory, nothing about total mutation counts, and nothing
// about the future exposure state of any other operation.

import {
  assert,
  assertEquals,
  assertFalse,
  assertStrictEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  MCP_TOOL_REGISTRY,
  validateMcpRegistryCoverage,
  validateMcpToolRegistry,
} from "../../functions/btpm-mcp/mcp/toolRegistry.ts";
import {
  MCP_PORTFOLIO_UPDATE_TOOL_ERROR_MESSAGES,
  MCP_PORTFOLIO_UPDATE_TOOL_NAME,
} from "../../functions/btpm-mcp/mcp/portfolioUpdateMutationTool.ts";

const serverFactorySource = await Deno.readTextFile(
  new URL("../../functions/btpm-mcp/mcp/serverFactory.ts", import.meta.url),
);

const runtimeSource = await Deno.readTextFile(
  new URL("../../functions/btpm-mcp/index.ts", import.meta.url),
);

function occurrences(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

function portfolioUpdateBranch(): string {
  const start = serverFactorySource.indexOf(
    "if (tool.toolName === MCP_PORTFOLIO_UPDATE_TOOL_NAME)",
  );
  assert(start > 0, "Portfolio Update registration branch must exist");
  const end = serverFactorySource.indexOf("continue;", start);
  assert(end > start, "Portfolio Update branch must end with continue;");
  return serverFactorySource.slice(start, end + "continue;".length);
}

function portfolioUpdateControlBlock(): string {
  const start = runtimeSource.indexOf(
    "const portfolioUpdate = createMcpPortfolioUpdateToolExecutor({",
  );
  assert(start > 0, "Portfolio Update control construction must exist");
  const end = runtimeSource.indexOf("});", start);
  assert(end > start);
  return runtimeSource.slice(start, end + 3);
}

function portfolioUpdateWriterBlock(): string {
  const start = runtimeSource.indexOf(
    "const portfolioUpdateWriter: McpV1UpdatePortfolioExecutor =",
  );
  assert(start > 0, "Portfolio Update writer construction must exist");
  const end = runtimeSource.indexOf(");", start);
  assert(end > start);
  return runtimeSource.slice(start, end + 2);
}

// ---------------------------------------------------------------------------
// A. Registry
// ---------------------------------------------------------------------------

Deno.test("A1: canonical MCP registry remains structurally valid", () => {
  assertEquals(validateMcpToolRegistry(MCP_TOOL_REGISTRY), []);
  assertEquals(validateMcpRegistryCoverage(MCP_TOOL_REGISTRY), []);
});

Deno.test("A2: portfolios.update exists exactly once and is exposed", () => {
  const byOperation = MCP_TOOL_REGISTRY.filter(
    (entry) => entry.operationId === "portfolios.update",
  );
  assertStrictEquals(byOperation.length, 1);

  const byToolName = MCP_TOOL_REGISTRY.filter(
    (entry) => entry.toolName === MCP_PORTFOLIO_UPDATE_TOOL_NAME,
  );
  assertStrictEquals(byToolName.length, 1);
  assertStrictEquals(byToolName[0], byOperation[0]);

  const entry = byOperation[0];
  assertStrictEquals(entry.exposure, "exposed");
  assertStrictEquals(entry.toolName, "btpm_update_portfolio");
  assertStrictEquals(entry.title, "Update BTPM Portfolio");
  assertStrictEquals(
    entry.description,
    "Updates one Portfolio through the canonical API mutation contract.",
  );
  assertStrictEquals(entry.operationClass, "mutation");
  assertStrictEquals(entry.confirmation, "required");
  assertStrictEquals(entry.resultShape, "single_object");
  assertStrictEquals(entry.concurrencyToken, "required");
});

// API-Q Portfolio-11D exposed `portfolios.assign_project`; only its stable
// identity contract is asserted here.
Deno.test("A3: portfolios.create stays exposed and assign_project keeps its identity", () => {
  const create = MCP_TOOL_REGISTRY.find(
    (candidate) => candidate.operationId === "portfolios.create",
  );
  assert(create !== undefined);
  assertStrictEquals(create!.exposure, "exposed");
  assertStrictEquals(create!.toolName, "btpm_create_portfolio");

  const assign = MCP_TOOL_REGISTRY.find(
    (candidate) => candidate.operationId === "portfolios.assign_project",
  );
  assert(assign !== undefined);
  assertStrictEquals(assign!.toolName, "btpm_assign_project_portfolio");
});

// ---------------------------------------------------------------------------
// B. Server factory ownership
// ---------------------------------------------------------------------------

Deno.test("B1: serverFactory imports only the Portfolio-10C control contract", () => {
  assert(
    serverFactorySource.includes('from "./portfolioUpdateMutationTool.ts"'),
  );
  for (
    const symbol of [
      "MCP_PORTFOLIO_UPDATE_TOOL_ERROR_MESSAGES",
      "MCP_PORTFOLIO_UPDATE_TOOL_INPUT_SCHEMA",
      "MCP_PORTFOLIO_UPDATE_TOOL_NAME",
      "McpPortfolioUpdateToolArguments",
      "McpPortfolioUpdateToolExecutor",
    ]
  ) {
    assert(serverFactorySource.includes(symbol), `missing ${symbol}`);
  }
});

Deno.test("B2: serverFactory never imports the writer or base adapter", () => {
  assertFalse(
    serverFactorySource.includes("portfolioUpdateMutationExecutor.ts"),
  );
  assertFalse(
    serverFactorySource.includes("createMcpV1UpdatePortfolioExecutor"),
  );
  assertFalse(serverFactorySource.includes("updateMcpV1Portfolio"));
  assertFalse(serverFactorySource.includes("updateApiV1Portfolio"));
  assertFalse(serverFactorySource.includes("supabasePortfolioMutation.ts"));
});

Deno.test("B3: exactly one Portfolio Update dependency and registration", () => {
  assertStrictEquals(
    occurrences(
      serverFactorySource,
      "readonly portfolioUpdate: McpPortfolioUpdateToolExecutor;",
    ),
    1,
  );
  assertStrictEquals(
    occurrences(
      serverFactorySource,
      "if (tool.toolName === MCP_PORTFOLIO_UPDATE_TOOL_NAME)",
    ),
    1,
  );
  assertStrictEquals(
    occurrences(serverFactorySource, "executors.portfolioUpdate(args)"),
    1,
  );
});

// ---------------------------------------------------------------------------
// C. Registration branch
// ---------------------------------------------------------------------------

Deno.test("C1: registration branch uses the accepted bounded contract", () => {
  const branch = portfolioUpdateBranch();
  assert(branch.includes("title: tool.title"));
  assert(branch.includes("description: tool.description"));
  assert(
    branch.includes("inputSchema: MCP_PORTFOLIO_UPDATE_TOOL_INPUT_SCHEMA"),
  );
  assert(branch.includes("...BTPM_MCP_MUTATION_TOOL_ANNOTATIONS"));
  assert(
    branch.includes(
      "MCP_PORTFOLIO_UPDATE_TOOL_ERROR_MESSAGES[result.category]",
    ),
  );
  assert(branch.includes("JSON.stringify(result.payload)"));
  assert(branch.includes("structuredContent: result.payload"));
  assert(branch.includes("continue;"));
});

Deno.test("C2: registration branch never interprets the Portfolio payload", () => {
  const branch = portfolioUpdateBranch();
  for (
    const forbidden of [
      "result.payload.outcome",
      "result.payload.portfolioId",
      "result.payload.updatedAt",
      '"applied"',
      '"replayed"',
      "expectedUpdatedAt",
      "stale_portfolio",
    ]
  ) {
    assertFalse(branch.includes(forbidden), `branch interprets ${forbidden}`);
  }
});

// ---------------------------------------------------------------------------
// D. Runtime imports
// ---------------------------------------------------------------------------

Deno.test("D1: runtime imports the 10C control and 10B writer factories", () => {
  assert(
    runtimeSource.includes(
      'import { createMcpPortfolioUpdateToolExecutor } from "./mcp/portfolioUpdateMutationTool.ts";',
    ),
  );
  assert(
    runtimeSource.includes(
      'from "./mcp/portfolioUpdateMutationExecutor.ts"',
    ),
  );
  for (
    const symbol of [
      "createMcpV1UpdatePortfolioExecutor",
      "McpUpdatePortfolioClientFactory",
      "McpV1UpdatePortfolioExecutor",
    ]
  ) {
    assert(runtimeSource.includes(symbol), `missing ${symbol}`);
  }
  assertFalse(runtimeSource.includes("updateApiV1Portfolio"));
  assertFalse(runtimeSource.includes("updateMcpV1Portfolio"));
  assertFalse(runtimeSource.includes("supabasePortfolioMutation.ts"));
});

// ---------------------------------------------------------------------------
// E. Runtime writer contract
// ---------------------------------------------------------------------------

Deno.test("E1: portfolioUpdateWriter exists in both runtime contracts once", () => {
  assertStrictEquals(
    occurrences(
      runtimeSource,
      "readonly portfolioUpdateWriter: McpV1UpdatePortfolioExecutor;",
    ),
    2,
  );
  assertStrictEquals(
    occurrences(
      runtimeSource,
      "portfolioUpdateWriter: input.portfolioUpdateWriter,",
    ),
    1,
  );
  assertStrictEquals(
    occurrences(runtimeSource, "\n    portfolioUpdateWriter,\n"),
    1,
  );
});

// ---------------------------------------------------------------------------
// F. Writer construction
// ---------------------------------------------------------------------------

Deno.test("F1: exactly one caller-bound anon-key writer construction", () => {
  assertStrictEquals(
    occurrences(runtimeSource, "createMcpV1UpdatePortfolioExecutor("),
    1,
  );
  const block = portfolioUpdateWriterBlock();
  assert(block.includes("String(supabaseUrl)"));
  assert(block.includes("supabaseAnonKey"));
  assert(block.includes("McpUpdatePortfolioClientFactory"));

  for (
    const forbidden of [
      "serviceRoleKey",
      "privilegedClient",
      "rateLimitClient",
      "authorizationStore",
      "authClient",
      "SUPABASE_SERVICE_ROLE_KEY",
    ]
  ) {
    assertFalse(block.includes(forbidden), `writer must not use ${forbidden}`);
  }
});

// ---------------------------------------------------------------------------
// G. Per-request control construction
// ---------------------------------------------------------------------------

Deno.test("G1: exactly one per-request control executor with accepted deps", () => {
  assertStrictEquals(
    occurrences(runtimeSource, "createMcpPortfolioUpdateToolExecutor({"),
    1,
  );
  const block = portfolioUpdateControlBlock();
  assert(block.includes("request,"));
  assert(block.includes("execution: executionContext,"));
  assert(block.includes("writer: runtime.portfolioUpdateWriter,"));
  assert(
    block.includes(
      "rateLimitProfileResolver: runtime.rateLimitProfileResolver,",
    ),
  );
  assert(block.includes("rateLimitStore: runtime.rateLimitStore,"));
  assert(block.includes("now: () => runtime.now(),"));

  for (
    const forbidden of [
      "authorized",
      "serviceRole",
      "privileged",
      "supabase",
      "tenant",
      "organization",
      "workspace",
      "enablement",
      "capability",
      "operationId",
      "confirm",
      "payloadHash",
    ]
  ) {
    assertFalse(
      block.toLowerCase().includes(forbidden.toLowerCase()),
      `control construction must not receive ${forbidden}`,
    );
  }
});

// ---------------------------------------------------------------------------
// H. Server handoff
// ---------------------------------------------------------------------------

Deno.test("H1: portfolioUpdate is handed to createBtpmMcpServer exactly once", () => {
  const start = runtimeSource.indexOf(
    "createBtpmMcpServer(executionContext, {",
  );
  assert(start > 0);
  const end = runtimeSource.indexOf("}),", start);
  assert(end > start);
  const handoff = runtimeSource.slice(start, end);
  assertStrictEquals(occurrences(handoff, "portfolioUpdate,"), 1);
});

// ---------------------------------------------------------------------------
// I. Forbidden business / concurrency internals
// ---------------------------------------------------------------------------

Deno.test("I1: no Portfolio Update business internals in wiring surfaces", () => {
  const controlBlock = portfolioUpdateControlBlock();
  const writerBlock = portfolioUpdateWriterBlock();
  const branch = portfolioUpdateBranch();

  for (
    const forbidden of [
      "mcp_v1_update_portfolio",
      "api_v1_update_portfolio",
      "admin_update_portfolio_item",
      "buildApiV1UpdatePortfolioIdempotencyPayload",
      "parseApiV1UpdatePortfolioBody",
      "hashCanonicalPayload",
      "requireMcpMutationConfirmation",
      "btpm_encrypt",
      "btpm_decrypt",
    ]
  ) {
    assertFalse(
      serverFactorySource.includes(forbidden),
      `factory: ${forbidden}`,
    );
    assertFalse(controlBlock.includes(forbidden), `control: ${forbidden}`);
    assertFalse(writerBlock.includes(forbidden), `writer: ${forbidden}`);
    assertFalse(branch.includes(forbidden), `branch: ${forbidden}`);
  }
});

Deno.test("I2: no direct database access or concurrency handling in wiring", () => {
  for (
    const block of [
      portfolioUpdateControlBlock(),
      portfolioUpdateWriterBlock(),
      portfolioUpdateBranch(),
    ]
  ) {
    for (
      const forbidden of [
        ".rpc(",
        ".from(",
        "expectedUpdatedAt",
        "currentUpdatedAt",
        "current_updated_at",
        "updated_at",
        "Date.parse",
        "retry",
      ]
    ) {
      assertFalse(block.includes(forbidden), `must not contain ${forbidden}`);
    }
  }
});

// ---------------------------------------------------------------------------
// J. Bounded external errors
// ---------------------------------------------------------------------------

Deno.test("J1: exactly the accepted eight bounded categories remain", () => {
  assertEquals(
    Object.keys(MCP_PORTFOLIO_UPDATE_TOOL_ERROR_MESSAGES).sort(),
    [
      "confirmation_required",
      "idempotency_conflict",
      "idempotency_pending",
      "invalid_arguments",
      "not_authorized",
      "rate_limited",
      "stale_portfolio",
      "unavailable",
    ],
  );
});

Deno.test("J2: bounded messages disclose no internal detail", () => {
  const forbidden = [
    "sql",
    "postgres",
    "sqlstate",
    "oauth",
    "client_id",
    "bearer",
    "token",
    "service role",
    "service_role",
    "rpc",
    "supabase",
    "function",
    "mcp_v1_",
    "api_v1_",
    "admin_update_portfolio_item",
  ];
  for (
    const message of Object.values(MCP_PORTFOLIO_UPDATE_TOOL_ERROR_MESSAGES)
  ) {
    assert(message.length > 0);
    const lower = message.toLowerCase();
    for (const needle of forbidden) {
      assertFalse(lower.includes(needle), `"${message}" discloses ${needle}`);
    }
  }
});
