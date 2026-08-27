// API-Q.PS.3 — Universal Project Selector: browser App bridge + single-file
// build proofs.
//
// Scope: the browser View source (official App client usage, handler ordering),
// the pure View-state logic (host capability detection, theme, bounded fallback
// and unavailable states), the committed generated single-file HTML, and the
// unchanged PS.1 resource / PS.2 tool / MCP inventory contracts.

import {
  assert,
  assertEquals,
  assertFalse,
  assertStrictEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  deriveSelectorViewState,
  hostSupportsServerTools,
  isValidBootstrapResult,
  resolveHostTheme,
  SELECTOR_STATE_MESSAGES,
} from "../../functions/btpm-mcp/mcp/project-selector-app/selectorState.ts";
import {
  BTPM_PROJECT_SELECTOR_RESOURCE_HTML,
  BTPM_PROJECT_SELECTOR_RESOURCE_META,
  BTPM_PROJECT_SELECTOR_RESOURCE_MIME_TYPE,
  BTPM_PROJECT_SELECTOR_RESOURCE_URI,
} from "../../functions/btpm-mcp/mcp/projectSelectorAppResource.ts";
import { BTPM_PROJECT_SELECTOR_GENERATED_HTML } from "../../functions/btpm-mcp/mcp/projectSelectorAppHtml.generated.ts";
import {
  BTPM_PROJECT_SELECTOR_TOOL_META,
  BTPM_PROJECT_SELECTOR_TOOL_NAME,
  BTPM_PROJECT_SELECTOR_TOOL_STRUCTURED_CONTENT,
} from "../../functions/btpm-mcp/mcp/projectSelectorAppTool.ts";
import {
  exposedMcpTools,
  MCP_TOOL_REGISTRY,
} from "../../functions/btpm-mcp/mcp/toolRegistry.ts";

const base = "../../functions/btpm-mcp/mcp/";

async function read(relative: string): Promise<string> {
  return await Deno.readTextFile(new URL(base + relative, import.meta.url));
}

const viewSource = await read("project-selector-app/main.ts");
const stateSource = await read("project-selector-app/selectorState.ts");
const resourceSource = await read("projectSelectorAppResource.ts");
const generatedSource = await read("projectSelectorAppHtml.generated.ts");

// -----------------------------------------------------------------------------
// A. Official App client usage and lifecycle ordering
// -----------------------------------------------------------------------------

Deno.test("A1: View imports the official MCP Apps App client", () => {
  assert(
    /import\s*\{[^}]*\bApp\b[^}]*\}\s*from\s*"@modelcontextprotocol\/ext-apps"/
      .test(viewSource),
  );
});

Deno.test("A2: View instantiates exactly one App instance with a generic identity", () => {
  const instantiations = viewSource.match(/new App\(/g) ?? [];
  assertStrictEquals(instantiations.length, 1);
  assert(viewSource.includes('name: "BTPM Project Selector"'));
});

Deno.test("A3: responsive size behavior (autoResize) is enabled", () => {
  assert(viewSource.includes("autoResize: true"));
});

Deno.test("A4: tool-result and host-context handlers are registered before connect()", () => {
  const toolResultAt = viewSource.indexOf("app.ontoolresult");
  const hostContextAt = viewSource.indexOf("app.onhostcontextchanged");
  const connectAt = viewSource.indexOf("app.connect(");
  assert(toolResultAt > -1);
  assert(hostContextAt > -1);
  assert(connectAt > -1);
  assert(toolResultAt < connectAt, "tool-result handler registered after connect");
  assert(hostContextAt < connectAt, "host-context handler registered after connect");
});

Deno.test("A5: connect() is awaited and its failure is handled defensively", () => {
  assert(viewSource.includes("await app.connect()"));
  assert(/try\s*\{\s*\n\s*await app\.connect\(\);/.test(viewSource));
  assert(viewSource.includes("} catch {"));
});

Deno.test("A6: host capabilities are inspected only after connection", () => {
  const connectAt = viewSource.indexOf("await app.connect()");
  const capabilitiesAt = viewSource.indexOf("app.getHostCapabilities()");
  assert(capabilitiesAt > connectAt);
});

// -----------------------------------------------------------------------------
// B. Host capability detection and bounded states
// -----------------------------------------------------------------------------

Deno.test("B1: server-tool capability detection is safe for absent/odd payloads", () => {
  assert(hostSupportsServerTools({ serverTools: {} }));
  assert(hostSupportsServerTools({ serverTools: { listChanged: true } }));
  assertFalse(hostSupportsServerTools(undefined));
  assertFalse(hostSupportsServerTools(null));
  assertFalse(hostSupportsServerTools({}));
  assertFalse(hostSupportsServerTools({ serverTools: true }));
  assertFalse(hostSupportsServerTools("serverTools"));
});

Deno.test("B2: supported host yields the ready state message", () => {
  const view = deriveSelectorViewState({
    connected: true,
    hostCapabilities: { serverTools: {} },
    bootstrapReceived: true,
    bootstrapResult: { ...BTPM_PROJECT_SELECTOR_TOOL_STRUCTURED_CONTENT },
  });
  assertStrictEquals(view.kind, "ready");
  assertStrictEquals(view.message, "Ready to load available workspaces.");
});

Deno.test("B3: unsupported host yields the bounded fallback state message", () => {
  const view = deriveSelectorViewState({
    connected: true,
    hostCapabilities: {},
    bootstrapReceived: true,
    bootstrapResult: { ...BTPM_PROJECT_SELECTOR_TOOL_STRUCTURED_CONTENT },
  });
  assertStrictEquals(view.kind, "host-unsupported");
  assertStrictEquals(
    view.message,
    "Interactive Project selection is unavailable in this host. Use the text fallback in the conversation.",
  );
});

Deno.test("B4: pre-connection state is loading", () => {
  assertStrictEquals(deriveSelectorViewState({ connected: false }).kind, "loading");
});

Deno.test("B4b: an actual connection failure yields the unavailable state", () => {
  const view = deriveSelectorViewState({
    connected: false,
    connectionFailed: true,
    hostCapabilities: undefined,
    bootstrapReceived: false,
    bootstrapResult: undefined,
  });
  assertStrictEquals(view.kind, "unavailable");
  assertStrictEquals(view.message, SELECTOR_STATE_MESSAGES.unavailable);
});

Deno.test("B4c: connection failure is never misclassified as host-unsupported", () => {
  assertStrictEquals(
    deriveSelectorViewState({ connected: false, connectionFailed: true }).kind,
    "unavailable",
  );
  assertStrictEquals(
    deriveSelectorViewState({ connected: true, connectionFailed: false, hostCapabilities: {} })
      .kind,
    "host-unsupported",
  );
});

Deno.test("B4d: connect-failure branch sets connectionFailed and fakes no capability", () => {
  const connectAt = viewSource.indexOf("await app.connect();");
  const failureBranch = viewSource.slice(
    viewSource.indexOf("} catch {", connectAt),
    viewSource.indexOf("state.connected = true;", connectAt),
  );
  assert(failureBranch.includes("state.connectionFailed = true;"));
  assert(failureBranch.includes("state.connected = false;"));
  assert(failureBranch.includes("state.hostCapabilities = undefined;"));
  assertFalse(failureBranch.includes("serverTools"));
  assert(viewSource.includes("connectionFailed: false"));
});

Deno.test("B5: malformed bootstrap results yield a bounded unavailable state", () => {
  for (
    const malformed of [
      undefined,
      null,
      {},
      "ready",
      { selector: "other", state: "ready" },
      { selector: "btpm_project", state: "broken" },
      { selector: "btpm_project" },
    ]
  ) {
    const view = deriveSelectorViewState({
      connected: true,
      hostCapabilities: { serverTools: {} },
      bootstrapReceived: true,
      bootstrapResult: malformed,
    });
    assertStrictEquals(view.kind, "unavailable");
    assertStrictEquals(view.message, SELECTOR_STATE_MESSAGES.unavailable);
  }
});

Deno.test("B6: bounded messages never expose protocol data or exception text", () => {
  for (const message of Object.values(SELECTOR_STATE_MESSAGES)) {
    assertFalse(message.includes("{"));
    assertFalse(message.toLowerCase().includes("error"));
    assertFalse(message.toLowerCase().includes("jsonrpc"));
  }
});

Deno.test("B7: bootstrap validation accepts only the accepted PS.2 contract", () => {
  assert(isValidBootstrapResult({ ...BTPM_PROJECT_SELECTOR_TOOL_STRUCTURED_CONTENT }));
  assertFalse(isValidBootstrapResult({ selector: "btpm_project", state: "x" }));
});

// -----------------------------------------------------------------------------
// C. Host theme
// -----------------------------------------------------------------------------

Deno.test("C1: light and dark host themes are resolved; unknown falls back to light", () => {
  assertStrictEquals(resolveHostTheme({ theme: "light" }), "light");
  assertStrictEquals(resolveHostTheme({ theme: "dark" }), "dark");
  assertStrictEquals(resolveHostTheme({ theme: "neon" }), "light");
  assertStrictEquals(resolveHostTheme({}), "light");
  assertStrictEquals(resolveHostTheme(undefined), "light");
});

Deno.test("C2: View applies the theme via the SDK helper on connect and on host-context change", () => {
  assert(viewSource.includes("applyDocumentTheme"));
  assert(viewSource.includes("applyTheme(app.getHostContext())"));
  assert(viewSource.includes("app.onhostcontextchanged"));
});

Deno.test("C3: generated document carries light and dark theme styling without remote fonts", () => {
  assert(BTPM_PROJECT_SELECTOR_GENERATED_HTML.includes("data-theme=dark]"));
  assert(BTPM_PROJECT_SELECTOR_GENERATED_HTML.includes('data-theme="light"'));
  assert(BTPM_PROJECT_SELECTOR_GENERATED_HTML.includes("color-scheme"));
  assert(BTPM_PROJECT_SELECTOR_GENERATED_HTML.includes("system-ui"));
  assertFalse(BTPM_PROJECT_SELECTOR_GENERATED_HTML.includes("@font-face"));
  assertFalse(BTPM_PROJECT_SELECTOR_GENERATED_HTML.includes("fonts.googleapis"));
});

// -----------------------------------------------------------------------------
// D. Generated single-file document
// -----------------------------------------------------------------------------

Deno.test("D1: generated module carries the AUTO-GENERATED header and one string export", () => {
  assert(generatedSource.includes("AUTO-GENERATED — do not edit manually"));
  const exports = generatedSource.match(/^export /gm) ?? [];
  assertStrictEquals(exports.length, 1);
  assertStrictEquals(typeof BTPM_PROJECT_SELECTOR_GENERATED_HTML, "string");
});

Deno.test("D2: generated HTML is a single self-contained HTML document", () => {
  assert(BTPM_PROJECT_SELECTOR_GENERATED_HTML.startsWith("<!DOCTYPE html>"));
  assertStrictEquals(
    (BTPM_PROJECT_SELECTOR_GENERATED_HTML.match(/<html/g) ?? []).length,
    1,
  );
  assert(BTPM_PROJECT_SELECTOR_GENERATED_HTML.trimEnd().endsWith("</html>"));
});

Deno.test("D3: generated HTML inlines the App-bridge JavaScript and CSS", () => {
  assert(BTPM_PROJECT_SELECTOR_GENERATED_HTML.includes("<script"));
  assert(BTPM_PROJECT_SELECTOR_GENERATED_HTML.includes("<style"));
  assert(BTPM_PROJECT_SELECTOR_GENERATED_HTML.includes("ui/initialize"));
  assert(BTPM_PROJECT_SELECTOR_GENERATED_HTML.includes("BTPM Project Selector"));
  assert(
    BTPM_PROJECT_SELECTOR_GENERATED_HTML.includes(
      "Ready to load available workspaces.",
    ),
  );
  assert(
    BTPM_PROJECT_SELECTOR_GENERATED_HTML.includes(
      "Interactive Project selection is unavailable in this host.",
    ),
  );
});

Deno.test("D4: generated HTML has no external script, stylesheet or asset reference", () => {
  for (
    const forbidden of [
      "<script src",
      "<link",
      "<img",
      "@import",
      'src="http',
      "src='http",
      'href="http',
      "href='http",
      "url(http",
      "//cdn.",
      "unpkg.com",
      "jsdelivr",
    ]
  ) {
    assertFalse(
      BTPM_PROJECT_SELECTOR_GENERATED_HTML.includes(forbidden),
      `generated HTML contains ${forbidden}`,
    );
  }
});

Deno.test("D5: generated HTML performs no direct network call and uses no storage or unsafe innerHTML", () => {
  for (
    const forbidden of [
      "localStorage",
      "sessionStorage",
      "indexedDB",
      "document.cookie",
      "innerHTML",
      "XMLHttpRequest",
      "new WebSocket",
      "navigator.sendBeacon",
      "EventSource",
    ]
  ) {
    assertFalse(
      BTPM_PROJECT_SELECTOR_GENERATED_HTML.includes(forbidden),
      `generated HTML contains ${forbidden}`,
    );
  }
  assertFalse(/[^.\w]fetch\s*\(/.test(BTPM_PROJECT_SELECTOR_GENERATED_HTML));
});

Deno.test("D6: generated HTML contains no secret, token or Tenant/user hardcoding", () => {
  for (
    const forbidden of [
      "SUPABASE",
      "supabase.co",
      "service_role",
      "Bearer ",
      "access_token",
      "client_secret",
      "adalvo",
      "Astra",
      "Copilot",
      "organization_id",
      "workspace_id",
      "project_id",
    ]
  ) {
    assertFalse(
      BTPM_PROJECT_SELECTOR_GENERATED_HTML.includes(forbidden),
      `generated HTML contains ${forbidden}`,
    );
  }
});

// -----------------------------------------------------------------------------
// E. Source-level scope containment
// -----------------------------------------------------------------------------

// PS.4A: `callServerTool` is now the accepted host-bridge read path for
// Workspace discovery. PS.4B intentionally adds the canonical Projects
// collection read and PS.5A the canonical Project-detail revalidation read, so
// `btpm_list_projects` and `btpm_get_project` are no longer forbidden here.
// Model-context updates, message sending, persistence and direct networking
// remain forbidden.
Deno.test("E1: View performs no unbounded host or network access", () => {
  for (
    const forbidden of [
      // `updateModelContext` / `sendMessage` are intentionally NOT forbidden
      // any more: API-Q.PS.5B publishes a validated Project selection through
      // exactly those two host bridge methods, and PS.5B owns their proofs.
      "readResource",
      "listServerTools",
      "localStorage",
      "sessionStorage",
      "indexedDB",
      "document.cookie",
      "innerHTML",
      "fetch(",
      "XMLHttpRequest",
      "WebSocket",
    ]
  ) {
    assertFalse(viewSource.includes(forbidden), `View source contains ${forbidden}`);
  }
});


Deno.test("E2: View and state logic contain no BTPM business read/write surface", () => {
  for (const source of [viewSource, stateSource]) {
    for (
      const forbidden of [
        "createClient",
        "supabase",
        "from(",
        ".rpc(",
        "insert",
        "update(",
        "delete(",
      ]
    ) {
      assertFalse(source.includes(forbidden), `source contains ${forbidden}`);
    }
  }
});

Deno.test("E3: state logic is DOM-free and SDK-free (pure, testable)", () => {
  assertFalse(stateSource.includes("document."));
  assertFalse(stateSource.includes("window."));
  assertFalse(stateSource.includes("import "));
});

// -----------------------------------------------------------------------------
// F. Unchanged accepted contracts
// -----------------------------------------------------------------------------

Deno.test("F1: resource module serves the generated HTML constant and holds no HTML literal", () => {
  assertStrictEquals(
    BTPM_PROJECT_SELECTOR_RESOURCE_HTML,
    BTPM_PROJECT_SELECTOR_GENERATED_HTML,
  );
  assert(resourceSource.includes("projectSelectorAppHtml.generated.ts"));
  assertFalse(resourceSource.includes("<!DOCTYPE html>"));
  assertFalse(resourceSource.includes("Deno.readTextFile"));
});

Deno.test("F2: resource URI, MIME type and deny-by-default CSP remain unchanged", () => {
  assertStrictEquals(
    BTPM_PROJECT_SELECTOR_RESOURCE_URI,
    "ui://btpm/project-selector",
  );
  assertStrictEquals(
    BTPM_PROJECT_SELECTOR_RESOURCE_MIME_TYPE,
    "text/html;profile=mcp-app",
  );
  const csp = BTPM_PROJECT_SELECTOR_RESOURCE_META.ui.csp;
  assertEquals(csp.connectDomains, []);
  assertEquals(csp.resourceDomains, []);
  assertEquals(csp.frameDomains, []);
  assertEquals(csp.baseUriDomains, []);
  assertEquals(BTPM_PROJECT_SELECTOR_RESOURCE_META.ui.permissions, {});
});

Deno.test("F3: btpm_choose_project contract is unchanged", () => {
  assertStrictEquals(BTPM_PROJECT_SELECTOR_TOOL_NAME, "btpm_choose_project");
  assertEquals({ ...BTPM_PROJECT_SELECTOR_TOOL_STRUCTURED_CONTENT }, {
    selector: "btpm_project",
    state: "ready",
  });
  assertStrictEquals(
    BTPM_PROJECT_SELECTOR_TOOL_META.ui.resourceUri,
    BTPM_PROJECT_SELECTOR_RESOURCE_URI,
  );
});

// MCP-HARDENING-C1B — the historical exposed/registry totals were an obsolete
// global baseline. The durable PS-3 invariant is that the bootstrap selector
// tool never becomes a canonical registry entry.
Deno.test("F4: the bootstrap selector tool is never a canonical registry entry", () => {
  const exposed = exposedMcpTools(MCP_TOOL_REGISTRY);
  assertStrictEquals(
    exposed.some((entry) =>
      entry.toolName === BTPM_PROJECT_SELECTOR_TOOL_NAME
    ),
    false,
  );
});

// EDGE-DEPLOY-SIZE-R1-C1 — the generator must write the single canonical
// generated module into the function-local MCP directory consumed by
// btpm-mcp, never back into the retired shared MCP path.
Deno.test("F5: generator target is the function-local btpm-mcp MCP module", async () => {
  const generator = await Deno.readTextFile(
    new URL("../../../scripts/build-project-selector-app.mjs", import.meta.url),
  );
  const match = generator.match(
    /const\s+generatedModulePath\s*=\s*path\.join\(([\s\S]*?)\);/,
  );
  assert(match, "generatedModulePath construction must exist");
  const segments = [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assertEquals(segments, [
    "supabase",
    "functions",
    "btpm-mcp",
    "mcp",
    "projectSelectorAppHtml.generated.ts",
  ]);
  assertFalse(generator.includes("_shared"));
});
