// API-Q.PS.2 — Universal Project Selector: MCP App bootstrap tool proofs.
//
// Scope: the single MCP-App-only bootstrap tool `btpm_choose_project`, its
// linkage to the accepted PS.1 resource, its read-only annotations, its empty
// input contract, its bounded result, and the unchanged canonical registry.

import {
  assert,
  assertEquals,
  assertFalse,
  assertStrictEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  createBtpmMcpServer,
  type BtpmMcpToolExecutors,
} from "../../functions/btpm-mcp/mcp/serverFactory.ts";
import {
  BTPM_PROJECT_SELECTOR_TOOL_ANNOTATIONS,
  BTPM_PROJECT_SELECTOR_TOOL_DESCRIPTION,
  BTPM_PROJECT_SELECTOR_TOOL_META,
  BTPM_PROJECT_SELECTOR_TOOL_NAME,
  BTPM_PROJECT_SELECTOR_TOOL_STRUCTURED_CONTENT,
  BTPM_PROJECT_SELECTOR_TOOL_TEXT,
  BTPM_PROJECT_SELECTOR_TOOL_TITLE,
} from "../../functions/btpm-mcp/mcp/projectSelectorAppTool.ts";
import { BTPM_PROJECT_SELECTOR_RESOURCE_URI } from "../../functions/btpm-mcp/mcp/projectSelectorAppResource.ts";
import {
  exposedMcpTools,
  MCP_TOOL_REGISTRY,
} from "../../functions/btpm-mcp/mcp/toolRegistry.ts";
import type { McpTrustedExecutionContext } from "../../functions/btpm-mcp/mcp/buildMcpExecutionContext.ts";

const toolModuleSource = await Deno.readTextFile(
  new URL(
    "../../functions/btpm-mcp/mcp/projectSelectorAppTool.ts",
    import.meta.url,
  ),
);

// deno-lint-ignore no-explicit-any
const stubExecutor = () => (() => Promise.resolve({ ok: false } as any));

function buildServer() {
  const executionContext = {} as McpTrustedExecutionContext;
  const executors = new Proxy({}, { get: () => stubExecutor() }) as unknown as
    BtpmMcpToolExecutors;
  return createBtpmMcpServer(executionContext, executors);
}

// deno-lint-ignore no-explicit-any
function registeredTools(server: unknown): Record<string, any> {
  // deno-lint-ignore no-explicit-any
  return (server as any)._registeredTools as Record<string, any>;
}

// deno-lint-ignore no-explicit-any
function registeredResources(server: unknown): Record<string, any> {
  // deno-lint-ignore no-explicit-any
  return (server as any)._registeredResources as Record<string, any>;
}

// -----------------------------------------------------------------------------
// A. Registration and contract
// -----------------------------------------------------------------------------

Deno.test("A1: btpm_choose_project is registered with the exact name, title and description", () => {
  assertStrictEquals(BTPM_PROJECT_SELECTOR_TOOL_NAME, "btpm_choose_project");
  assertStrictEquals(BTPM_PROJECT_SELECTOR_TOOL_TITLE, "Choose BTPM Project");
  assertStrictEquals(
    BTPM_PROJECT_SELECTOR_TOOL_DESCRIPTION,
    "Open the BTPM Workspace and Project selector when a Project must be selected or changed for the current conversation.",
  );
  const entry = registeredTools(buildServer())[BTPM_PROJECT_SELECTOR_TOOL_NAME];
  assert(entry, "tool is not registered");
  assertStrictEquals(entry.title, BTPM_PROJECT_SELECTOR_TOOL_TITLE);
  assertStrictEquals(entry.description, BTPM_PROJECT_SELECTOR_TOOL_DESCRIPTION);
});

Deno.test("A2: the descriptor links exactly to ui://btpm/project-selector", () => {
  assertStrictEquals(
    BTPM_PROJECT_SELECTOR_TOOL_META.ui.resourceUri,
    "ui://btpm/project-selector",
  );
  assertStrictEquals(
    BTPM_PROJECT_SELECTOR_TOOL_META.ui.resourceUri,
    BTPM_PROJECT_SELECTOR_RESOURCE_URI,
  );
  const entry = registeredTools(buildServer())[BTPM_PROJECT_SELECTOR_TOOL_NAME];
  // deno-lint-ignore no-explicit-any
  const meta = entry._meta as any;
  assertStrictEquals(meta.ui.resourceUri, BTPM_PROJECT_SELECTOR_RESOURCE_URI);
  // The MCP Apps helper also normalizes the legacy compatibility key.
  assertStrictEquals(
    meta["ui/resourceUri"],
    BTPM_PROJECT_SELECTOR_RESOURCE_URI,
  );
});

Deno.test("A3: annotations are read-only, non-destructive, idempotent and closed-world", () => {
  assertEquals(BTPM_PROJECT_SELECTOR_TOOL_ANNOTATIONS, {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  });
  const entry = registeredTools(buildServer())[BTPM_PROJECT_SELECTOR_TOOL_NAME];
  assertStrictEquals(entry.annotations.readOnlyHint, true);
  assertStrictEquals(entry.annotations.destructiveHint, false);
  assertStrictEquals(entry.annotations.idempotentHint, true);
  assertStrictEquals(entry.annotations.openWorldHint, false);
});

Deno.test("A4: input contract is the empty object only", () => {
  const entry = registeredTools(buildServer())[BTPM_PROJECT_SELECTOR_TOOL_NAME];
  const shape = entry.inputSchema?.shape ?? {};
  assertEquals(Object.keys(shape), []);
  for (
    const forbidden of [
      "tenantId",
      "organizationId",
      "workspaceId",
      "projectId",
      "userId",
      "url",
      "persist",
    ]
  ) {
    assertFalse(
      Object.prototype.hasOwnProperty.call(shape, forbidden),
      `input schema accepts ${forbidden}`,
    );
  }
});

Deno.test("A5: invocation returns the bounded bootstrap result and text fallback", async () => {
  const entry = registeredTools(buildServer())[BTPM_PROJECT_SELECTOR_TOOL_NAME];
  const result = await entry.handler({}, {});
  assertEquals(result.structuredContent, {
    selector: "btpm_project",
    state: "ready",
  });
  assertEquals(result.structuredContent, {
    ...BTPM_PROJECT_SELECTOR_TOOL_STRUCTURED_CONTENT,
  });
  assertEquals(result.content, [
    {
      type: "text",
      text: "Choose a BTPM Workspace and Project using the Project selector.",
    },
  ]);
  assertStrictEquals(
    result.content[0].text,
    BTPM_PROJECT_SELECTOR_TOOL_TEXT,
  );
  assertFalse(Boolean(result.isError));
});

// -----------------------------------------------------------------------------
// B. No business behavior
// -----------------------------------------------------------------------------

Deno.test("B1: the tool module performs no business read/write, no Supabase, no RPC, no persistence", () => {
  for (
    const forbidden of [
      "createClient",
      "@supabase/supabase-js",
      "rpc(",
      ".from(",
      "SERVICE_ROLE",
      "service_role",
      "fetch(",
      "Deno.env",
      "console.log",
      "console.warn",
      "localStorage",
      "Executor",
      "Astra",
      "Copilot",
      "<!DOCTYPE html>",
      "csp",
    ]
  ) {
    assertFalse(
      toolModuleSource.includes(forbidden),
      `tool module references ${forbidden}`,
    );
  }
});

Deno.test("B2: the tool module reuses only the PS.1 resource URI constant", () => {
  assert(
    toolModuleSource.includes(
      'import { BTPM_PROJECT_SELECTOR_RESOURCE_URI } from "./projectSelectorAppResource.ts";',
    ),
  );
  assertFalse(toolModuleSource.includes('"ui://'));
  assert(
    toolModuleSource.includes(
      'npm:@modelcontextprotocol/ext-apps@1.7.5/server',
    ),
  );
  assert(toolModuleSource.includes("registerAppTool("));
});

// -----------------------------------------------------------------------------
// C. Canonical registry and total inventory
// -----------------------------------------------------------------------------

// MCP-HARDENING-C1B — the historical registry/exposed totals were an
// obsolete global baseline. What PS-2 owns is that the Project-selector tool
// is never a canonical registry entry.
Deno.test("C1: the Project-selector tool is not a canonical registry entry", () => {
  assertFalse(
    MCP_TOOL_REGISTRY.some((entry) =>
      entry.toolName === BTPM_PROJECT_SELECTOR_TOOL_NAME ||
      String(entry.operationId) === "projects.choose"
    ),
  );
});

Deno.test("C2: tools/list is exactly the canonical exposed tools plus one MCP-App bootstrap tool", () => {
  const registered = Object.keys(registeredTools(buildServer()));
  const canonical = exposedMcpTools().map((entry) => entry.toolName);
  for (const name of canonical) {
    assert(registered.includes(name), `missing canonical tool ${name}`);
  }
  const extra = registered.filter((name) => !canonical.includes(name));
  assertEquals(extra, [BTPM_PROJECT_SELECTOR_TOOL_NAME]);
  assertStrictEquals(registered.length, canonical.length + extra.length);
});

Deno.test("C3: the Project-selector resource remains exactly one resource, unchanged", () => {
  assertEquals(Object.keys(registeredResources(buildServer())), [
    "ui://btpm/project-selector",
  ]);
});
