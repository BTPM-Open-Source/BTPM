// API-Q Portfolio-9D — MCP exposure + runtime wiring evidence for the single
// canonical Portfolio mutation `portfolios.create`.
//
// This suite is deliberately DURABLE: it asserts nothing about the global
// exposed-tool inventory or counts. `portfolios.update` and
// `portfolios.assign_project` are asserted only as current sibling protection
// for this step.

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
  MCP_PORTFOLIO_CREATE_TOOL_ERROR_MESSAGES,
  MCP_PORTFOLIO_CREATE_TOOL_NAME,
} from "../../functions/btpm-mcp/mcp/portfolioCreateMutationTool.ts";

const serverFactorySource = await Deno.readTextFile(
  new URL("../../functions/btpm-mcp/mcp/serverFactory.ts", import.meta.url),
);

const runtimeSource = await Deno.readTextFile(
  new URL("../../functions/btpm-mcp/index.ts", import.meta.url),
);

function occurrences(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

function portfolioCreateBranch(): string {
  const start = serverFactorySource.indexOf(
    "if (tool.toolName === MCP_PORTFOLIO_CREATE_TOOL_NAME)",
  );
  assert(start > 0, "Portfolio Create registration branch must exist");
  const end = serverFactorySource.indexOf("continue;", start);
  assert(end > start, "Portfolio Create branch must end with continue;");
  return serverFactorySource.slice(start, end + "continue;".length);
}

function portfolioCreateControlBlock(): string {
  const start = runtimeSource.indexOf(
    "const portfolioCreate = createMcpPortfolioCreateToolExecutor({",
  );
  assert(start > 0, "Portfolio Create control construction must exist");
  const end = runtimeSource.indexOf("});", start);
  assert(end > start);
  return runtimeSource.slice(start, end + 3);
}

function portfolioCreateWriterBlock(): string {
  const start = runtimeSource.indexOf(
    "const portfolioCreateWriter: McpV1CreatePortfolioExecutor =",
  );
  assert(start > 0, "Portfolio Create writer construction must exist");
  const end = runtimeSource.indexOf(");", start);
  assert(end > start);
  return runtimeSource.slice(start, end + 2);
}

// -----------------------------------------------------------------------------
// A. Registry
// -----------------------------------------------------------------------------

Deno.test("A1: registry validates structurally and by coverage", () => {
  assertEquals(validateMcpToolRegistry(MCP_TOOL_REGISTRY), []);
  assertEquals(validateMcpRegistryCoverage(MCP_TOOL_REGISTRY), []);
});

Deno.test("A2: portfolios.create exists exactly once, exposed, with accepted metadata", () => {
  const matches = MCP_TOOL_REGISTRY.filter(
    (candidate) => candidate.operationId === "portfolios.create",
  );
  assertStrictEquals(matches.length, 1);
  assertStrictEquals(
    MCP_TOOL_REGISTRY.filter(
      (candidate) => candidate.toolName === "btpm_create_portfolio",
    ).length,
    1,
  );

  const entry = matches[0];
  assertStrictEquals(entry.exposure, "exposed");
  assertStrictEquals(entry.toolName, "btpm_create_portfolio");
  assertStrictEquals(entry.toolName, MCP_PORTFOLIO_CREATE_TOOL_NAME);
  assertStrictEquals(entry.title, "Create BTPM Portfolio");
  assertStrictEquals(
    entry.description,
    "Creates one Portfolio in an Organization through the canonical API mutation contract.",
  );
  assertStrictEquals(entry.operationClass, "mutation");
  assertStrictEquals(entry.confirmation, "required");
  assertStrictEquals(entry.resultShape, "single_object");
  assertStrictEquals(entry.concurrencyToken, "not_applicable");
});

// API-Q Portfolio-10D exposed `portfolios.update`, so only its stable identity
// contract is asserted here.
Deno.test("A3: portfolios.update keeps its canonical identity", () => {
  const entry = MCP_TOOL_REGISTRY.find(
    (candidate) => candidate.operationId === "portfolios.update",
  );
  assert(entry !== undefined, "portfolios.update must exist in the registry");
  assertStrictEquals(entry!.toolName, "btpm_update_portfolio");
  assertStrictEquals(entry!.confirmation, "required");
  assertStrictEquals(entry!.concurrencyToken, "required");
});


// Historically asserted non-exposure; API-Q Portfolio-11D exposed the
// assignment mutation, so only its stable identity contract is asserted here.
Deno.test("A4: portfolios.assign_project keeps its canonical identity", () => {
  const entry = MCP_TOOL_REGISTRY.find(
    (candidate) => candidate.operationId === "portfolios.assign_project",
  );
  assert(entry !== undefined, "assignment must exist in the registry");
  assertStrictEquals(entry!.toolName, "btpm_assign_project_portfolio");
  assertStrictEquals(entry!.confirmation, "required");
});

// -----------------------------------------------------------------------------
// B. Server factory
// -----------------------------------------------------------------------------

Deno.test("B1: server factory imports only the Portfolio-9C control layer", () => {
  assert(serverFactorySource.includes("./portfolioCreateMutationTool.ts"));
  assert(serverFactorySource.includes("MCP_PORTFOLIO_CREATE_TOOL_NAME"));
  assert(
    serverFactorySource.includes("MCP_PORTFOLIO_CREATE_TOOL_INPUT_SCHEMA"),
  );
  assert(
    serverFactorySource.includes("MCP_PORTFOLIO_CREATE_TOOL_ERROR_MESSAGES"),
  );
  assert(serverFactorySource.includes("McpPortfolioCreateToolArguments"));
  assert(serverFactorySource.includes("McpPortfolioCreateToolExecutor"));

  assertFalse(
    serverFactorySource.includes("portfolioCreateMutationExecutor.ts"),
  );
  assertFalse(
    serverFactorySource.includes("createMcpV1CreatePortfolioExecutor"),
  );
  assertFalse(serverFactorySource.includes("createMcpV1Portfolio"));
  assertFalse(serverFactorySource.includes("supabasePortfolioMutation.ts"));
});

Deno.test("B2: exactly one Portfolio Create executor dependency and branch", () => {
  assertStrictEquals(
    occurrences(
      serverFactorySource,
      "readonly portfolioCreate: McpPortfolioCreateToolExecutor;",
    ),
    1,
  );
  assertStrictEquals(
    occurrences(
      serverFactorySource,
      "if (tool.toolName === MCP_PORTFOLIO_CREATE_TOOL_NAME)",
    ),
    1,
  );
  assertStrictEquals(
    occurrences(serverFactorySource, "executors.portfolioCreate("),
    1,
  );
});

Deno.test("B3: the branch uses the accepted bounded contract only", () => {
  const branch = portfolioCreateBranch();
  assert(branch.includes("title: tool.title"));
  assert(branch.includes("description: tool.description"));
  assert(
    branch.includes("inputSchema: MCP_PORTFOLIO_CREATE_TOOL_INPUT_SCHEMA"),
  );
  assert(branch.includes("...BTPM_MCP_MUTATION_TOOL_ANNOTATIONS"));
  assert(branch.includes("await executors.portfolioCreate(args)"));
  assert(
    branch.includes(
      "MCP_PORTFOLIO_CREATE_TOOL_ERROR_MESSAGES[result.category]",
    ),
  );
  assert(branch.includes("JSON.stringify(result.payload)"));
  assert(branch.includes("structuredContent: result.payload"));

  // No Portfolio business-result interpretation may exist here.
  for (
    const forbidden of [
      "result.payload.outcome",
      "result.payload.portfolioId",
      '"applied"',
      '"replayed"',
    ]
  ) {
    assertFalse(
      branch.includes(forbidden),
      `branch must not interpret ${forbidden}`,
    );
  }
});

// -----------------------------------------------------------------------------
// C. Runtime wiring
// -----------------------------------------------------------------------------

Deno.test("C1: runtime imports the 9C control factory and the 9B writer", () => {
  assert(
    runtimeSource.includes(
      'import { createMcpPortfolioCreateToolExecutor } from "./mcp/portfolioCreateMutationTool.ts";',
    ),
  );
  assert(runtimeSource.includes("createMcpV1CreatePortfolioExecutor"));
  assert(runtimeSource.includes("McpCreatePortfolioClientFactory"));
  assert(runtimeSource.includes("McpV1CreatePortfolioExecutor"));
  assert(
    runtimeSource.includes("./mcp/portfolioCreateMutationExecutor.ts"),
  );
  assertFalse(runtimeSource.includes("createApiV1Portfolio"));
});

Deno.test("C2: runtime contract carries exactly one portfolioCreateWriter path", () => {
  assertStrictEquals(
    occurrences(
      runtimeSource,
      "readonly portfolioCreateWriter: McpV1CreatePortfolioExecutor;",
    ),
    2,
  );
  assertStrictEquals(
    occurrences(
      runtimeSource,
      "portfolioCreateWriter: input.portfolioCreateWriter,",
    ),
    1,
  );
});

Deno.test("C3: exactly one per-request control executor with the exact dependencies", () => {
  assertStrictEquals(
    occurrences(runtimeSource, "createMcpPortfolioCreateToolExecutor({"),
    1,
  );
  const block = portfolioCreateControlBlock();
  assert(block.includes("request,"));
  assert(block.includes("execution: executionContext,"));
  assert(block.includes("writer: runtime.portfolioCreateWriter,"));
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
      "workspace",
      "organization",
      "tenant",
      "capability",
      "operationId",
      "enablement",
      "confirmation",
      "payloadHash",
      "owner",
    ]
  ) {
    assertFalse(
      block.toLowerCase().includes(forbidden.toLowerCase()),
      `control block must not receive ${forbidden}`,
    );
  }
});

Deno.test("C4: portfolioCreate is passed exactly once to createBtpmMcpServer", () => {
  assertStrictEquals(
    occurrences(runtimeSource, "\n        portfolioCreate,\n"),
    1,
  );
});

// -----------------------------------------------------------------------------
// D. Writer construction
// -----------------------------------------------------------------------------

Deno.test("D1: exactly one anon-key caller-bound writer construction site", () => {
  assertStrictEquals(
    occurrences(runtimeSource, "createMcpV1CreatePortfolioExecutor("),
    1,
  );
  const block = portfolioCreateWriterBlock();
  assert(block.includes("String(supabaseUrl)"));
  assert(block.includes("supabaseAnonKey"));
  assert(block.includes("McpCreatePortfolioClientFactory"));

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
    assertFalse(
      block.includes(forbidden),
      `writer construction must not reference ${forbidden}`,
    );
  }
  assertStrictEquals(
    occurrences(runtimeSource, "\n    portfolioCreateWriter,\n"),
    1,
  );
});

// -----------------------------------------------------------------------------
// E. Business / security boundaries
// -----------------------------------------------------------------------------

Deno.test("E1: neither factory nor runtime touches Portfolio business internals", () => {
  for (
    const forbidden of [
      "mcp_v1_create_portfolio",
      "api_v1_create_portfolio",
      "admin_create_portfolio_item",
      "claim_idempotency",
      "hashCanonicalPayload",
      "requireMcpMutationConfirmation",
      "btpm_encrypt",
      "btpm_decrypt",
      'from("portfolios")',
      "portfolio_items",
    ]
  ) {
    assertFalse(
      serverFactorySource.includes(forbidden),
      `serverFactory must not reference ${forbidden}`,
    );
    assertFalse(
      runtimeSource.includes(forbidden),
      `runtime must not reference ${forbidden}`,
    );
  }
});

Deno.test("E2: no Portfolio retry or auto-enablement wiring exists", () => {
  const branch = portfolioCreateBranch();
  assertFalse(branch.toLowerCase().includes("retry"));
  assertFalse(branch.toLowerCase().includes("auto-enable"));
  const block = portfolioCreateControlBlock();
  assertFalse(block.toLowerCase().includes("retry"));
  assertFalse(block.toLowerCase().includes("enable"));
});

// -----------------------------------------------------------------------------
// F. Bounded external messages
// -----------------------------------------------------------------------------

Deno.test("F1: the seven bounded Portfolio Create messages disclose nothing internal", () => {
  const categories = Object.keys(MCP_PORTFOLIO_CREATE_TOOL_ERROR_MESSAGES)
    .slice()
    .sort();
  assertEquals(categories, [
    "confirmation_required",
    "idempotency_conflict",
    "idempotency_pending",
    "invalid_arguments",
    "not_authorized",
    "rate_limited",
    "unavailable",
  ]);

  assertStrictEquals(
    MCP_PORTFOLIO_CREATE_TOOL_ERROR_MESSAGES.not_authorized,
    "Not authorized to create this Portfolio.",
  );
  assertStrictEquals(
    MCP_PORTFOLIO_CREATE_TOOL_ERROR_MESSAGES.unavailable,
    "BTPM Portfolio creation is temporarily unavailable.",
  );

  for (
    const message of Object.values(MCP_PORTFOLIO_CREATE_TOOL_ERROR_MESSAGES)
  ) {
    assert(message.length > 0);
    const lowered = message.toLowerCase();
    for (
      const forbidden of [
        "sql",
        "postgres",
        "sqlstate",
        "42501",
        "oauth",
        "client_id",
        "bearer",
        "token",
        "service_role",
        "service role",
        "rpc",
        "mcp_v1_",
        "api_v1_",
        "admin_create_portfolio",
      ]
    ) {
      assertFalse(
        lowered.includes(forbidden),
        `${message} must not disclose ${forbidden}`,
      );
    }
  }
});
