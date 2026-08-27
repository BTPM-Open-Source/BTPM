// API-Q.PS.1 — Universal Project Selector: MCP Apps resource foundation proofs.
//
// Scope: the single static MCP Apps UI resource `ui://btpm/project-selector`,
// the capability change from tools-only to tools + static resources, and the
// unchanged MCP tool inventory. No BTPM business behavior is exercised.

import {
  assert,
  assertEquals,
  assertFalse,
  assertStrictEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  BTPM_MCP_CAPABILITIES,
  createBtpmMcpServer,
  type BtpmMcpToolExecutors,
} from "../../functions/btpm-mcp/mcp/serverFactory.ts";
import {
  BTPM_PROJECT_SELECTOR_RESOURCE_HTML,
  BTPM_PROJECT_SELECTOR_RESOURCE_META,
  BTPM_PROJECT_SELECTOR_RESOURCE_MIME_TYPE,
  BTPM_PROJECT_SELECTOR_RESOURCE_URI,
} from "../../functions/btpm-mcp/mcp/projectSelectorAppResource.ts";
import {
  exposedMcpTools,
  MCP_TOOL_REGISTRY,
} from "../../functions/btpm-mcp/mcp/toolRegistry.ts";
import type { McpTrustedExecutionContext } from "../../functions/btpm-mcp/mcp/buildMcpExecutionContext.ts";

const resourceModuleSource = await Deno.readTextFile(
  new URL(
    "../../functions/btpm-mcp/mcp/projectSelectorAppResource.ts",
    import.meta.url,
  ),
);
const serverFactorySource = await Deno.readTextFile(
  new URL("../../functions/btpm-mcp/mcp/serverFactory.ts", import.meta.url),
);


// deno-lint-ignore no-explicit-any
const stubExecutor = () => (() => Promise.resolve({ ok: false } as any));

function buildServer() {
  const executionContext = {} as McpTrustedExecutionContext;
  const executors = new Proxy({}, {
    get: () => stubExecutor(),
  }) as unknown as BtpmMcpToolExecutors;
  return createBtpmMcpServer(executionContext, executors);
}

// deno-lint-ignore no-explicit-any
function registeredResources(server: unknown): Record<string, any> {
  // The MCP server keeps static resources in its internal registry; this test
  // reads it only to prove protocol-level advertisement.
  // deno-lint-ignore no-explicit-any
  return (server as any)._registeredResources as Record<string, any>;
}

// -----------------------------------------------------------------------------
// A. Capabilities
// -----------------------------------------------------------------------------

Deno.test("A1: capabilities advertise tools plus the smallest static resources capability", () => {
  assertEquals(Object.keys(BTPM_MCP_CAPABILITIES).sort(), [
    "resources",
    "tools",
  ]);
  assertEquals(BTPM_MCP_CAPABILITIES.tools, {});
  assertEquals(BTPM_MCP_CAPABILITIES.resources, {});
});

Deno.test("A2: no prompts, sampling, elicitation, completions, subscription or listChanged capability is advertised", () => {
  const serialized = JSON.stringify(BTPM_MCP_CAPABILITIES);
  for (
    const forbidden of [
      "prompts",
      "sampling",
      "elicitation",
      "completions",
      "subscribe",
      "listChanged",
    ]
  ) {
    assertFalse(serialized.includes(forbidden));
  }
});

// -----------------------------------------------------------------------------
// B. Unchanged tool inventory
// -----------------------------------------------------------------------------

// MCP-HARDENING-C1B — the historical registry total, read/mutation totals and
// the full exposed tool-name inventory were obsolete global baselines. The
// durable invariant PS-1 owns is that the exposed set is derived from the
// canonical registry and advertises unique names only.
Deno.test("B1: exposed tools derive from the canonical registry with unique names", () => {
  const exposed = exposedMcpTools();
  const names = exposed.map((entry) => entry.toolName);
  assertStrictEquals(new Set(names).size, names.length);
  for (const entry of exposed) {
    assertStrictEquals(entry.exposure, "exposed");
    assert(
      MCP_TOOL_REGISTRY.includes(entry),
      `${entry.toolName} must come from the canonical registry`,
    );
  }
});

Deno.test("B2: no selector tool or BTPM business operation is introduced", () => {
  assertFalse(
    MCP_TOOL_REGISTRY.some((entry) =>
      entry.toolName === "btpm_choose_project" ||
      String(entry.operationId) === "projects.choose"
    ),
  );
  for (
    const forbidden of [
      "registerTool",
      "registerAppTool",
      "btpm_choose_project",
      "createClient",
      "supabase",
      "rpc(",
      ".from(",
    ]
  ) {
    assertFalse(
      resourceModuleSource.includes(forbidden),
      `resource module references ${forbidden}`,
    );
  }
});

// -----------------------------------------------------------------------------
// C. Resource advertisement and read
// -----------------------------------------------------------------------------

Deno.test("C1: exactly one resource is advertised, with the exact selector URI", () => {
  const resources = registeredResources(buildServer());
  assertEquals(Object.keys(resources), ["ui://btpm/project-selector"]);
  assertStrictEquals(
    BTPM_PROJECT_SELECTOR_RESOURCE_URI,
    "ui://btpm/project-selector",
  );
});

Deno.test("C2: advertised MIME type is exactly text/html;profile=mcp-app", () => {
  assertStrictEquals(
    BTPM_PROJECT_SELECTOR_RESOURCE_MIME_TYPE,
    "text/html;profile=mcp-app",
  );
  const entry =
    registeredResources(buildServer())[BTPM_PROJECT_SELECTOR_RESOURCE_URI];
  assertStrictEquals(entry.metadata.mimeType, "text/html;profile=mcp-app");
});

Deno.test("C3: resources/read resolves the resource with the MCP Apps MIME type", async () => {
  const entry =
    registeredResources(buildServer())[BTPM_PROJECT_SELECTOR_RESOURCE_URI];
  const result = await entry.readCallback(
    new URL(BTPM_PROJECT_SELECTOR_RESOURCE_URI),
    {},
  );
  assertStrictEquals(result.contents.length, 1);
  const [content] = result.contents;
  assertStrictEquals(content.uri, BTPM_PROJECT_SELECTOR_RESOURCE_URI);
  assertStrictEquals(content.mimeType, "text/html;profile=mcp-app");
  assertStrictEquals(content.text, BTPM_PROJECT_SELECTOR_RESOURCE_HTML);
});

// -----------------------------------------------------------------------------
// D. UI shell content
// -----------------------------------------------------------------------------

Deno.test("D1: HTML contains the required generic BTPM heading and supporting text", () => {
  assert(
    BTPM_PROJECT_SELECTOR_RESOURCE_HTML.includes("Choose a BTPM project"),
  );
  assert(
    BTPM_PROJECT_SELECTOR_RESOURCE_HTML.includes(
      "Select the BTPM project to use in this conversation.",
    ),
  );
  // PS.3: the initial state element is rendered by the built App bridge.
  assert(BTPM_PROJECT_SELECTOR_RESOURCE_HTML.includes('id="selector-state"'));
});

Deno.test("D2: HTML is self-contained: no external asset, storage or dynamic HTML", () => {
  for (
    const forbidden of [
      "<script src",
      "<link",
      "<img",
      "@import",
      "@font-face",
      "localStorage",
      "sessionStorage",
      "indexedDB",
      "document.cookie",
      "innerHTML",
      "XMLHttpRequest",
      "new WebSocket",
      "Astra",
      "Copilot",
    ]
  ) {
    assertFalse(
      BTPM_PROJECT_SELECTOR_RESOURCE_HTML.includes(forbidden),
      `HTML document contains ${forbidden}`,
    );
  }
});

// -----------------------------------------------------------------------------
// E. Deny-by-default resource metadata
// -----------------------------------------------------------------------------

Deno.test("E1: CSP metadata is deny-by-default and requests no permissions", () => {
  const ui = BTPM_PROJECT_SELECTOR_RESOURCE_META.ui;
  assertEquals(ui.csp.connectDomains, []);
  assertEquals(ui.csp.resourceDomains, []);
  assertEquals(ui.csp.frameDomains, []);
  assertEquals(ui.csp.baseUriDomains, []);
  assertEquals(ui.permissions, {});
  assertEquals(Object.keys(ui).sort(), ["csp", "permissions"]);
});

Deno.test("E2: the same deny-by-default metadata is returned on read and on listing", async () => {
  const entry =
    registeredResources(buildServer())[BTPM_PROJECT_SELECTOR_RESOURCE_URI];
  assertEquals(
    entry.metadata._meta,
    BTPM_PROJECT_SELECTOR_RESOURCE_META,
  );
  const result = await entry.readCallback(
    new URL(BTPM_PROJECT_SELECTOR_RESOURCE_URI),
    {},
  );
  assertEquals(result.contents[0]._meta, BTPM_PROJECT_SELECTOR_RESOURCE_META);
});

// -----------------------------------------------------------------------------
// F. Composition boundary
// -----------------------------------------------------------------------------

Deno.test("F1: serverFactory only composes: registration lives in the dedicated module", () => {
  assert(
    serverFactorySource.includes("registerBtpmProjectSelectorAppResource("),
  );
  for (
    const forbidden of [
      "ui://btpm/project-selector",
      "registerAppResource",
      "<!DOCTYPE html>",
      "Choose a BTPM project",
    ]
  ) {
    assertFalse(
      serverFactorySource.includes(forbidden),
      `serverFactory owns selector detail: ${forbidden}`,
    );
  }
});

Deno.test("F2: the resource module pins the accepted MCP Apps server helper", () => {
  assert(
    resourceModuleSource.includes(
      'npm:@modelcontextprotocol/ext-apps@1.7.5/server',
    ),
  );
  assert(resourceModuleSource.includes("RESOURCE_MIME_TYPE"));
});
