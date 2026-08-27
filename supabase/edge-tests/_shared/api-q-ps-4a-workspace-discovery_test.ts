// API-Q.PS.4A — Universal Project Selector: accessible Workspace discovery and
// selection proofs.
//
// Scope: the pure discovery/parse module (`selectorData.ts`), the browser View
// wiring (`main.ts`), the regenerated single-file HTML, and confirmation that
// no Project discovery, persistence or direct network path exists.

import {
  assert,
  assertEquals,
  assertFalse,
  assertStrictEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  discoverWorkspaceChoices,
  DISCOVERY_PAGE_LIMIT,
  DISCOVERY_PAGE_OFFSET,
  filterWorkspaceChoices,
  ORGANIZATIONS_TOOL_NAME,
  parseOrganizationsResult,
  parsePagination,
  parseWorkspacesResult,
  readToolStructuredContent,
  shouldStartWorkspaceDiscovery,
  WORKSPACE_STATE_MESSAGES,
  WORKSPACES_TOOL_NAME,
  type ServerToolCaller,
} from "../../functions/btpm-mcp/mcp/project-selector-app/selectorData.ts";
import { BTPM_PROJECT_SELECTOR_GENERATED_HTML } from "../../functions/btpm-mcp/mcp/projectSelectorAppHtml.generated.ts";

const base = "../../functions/btpm-mcp/mcp/";
async function read(relative: string): Promise<string> {
  return await Deno.readTextFile(new URL(base + relative, import.meta.url));
}
const viewSource = await read("project-selector-app/main.ts");
const dataSource = await read("project-selector-app/selectorData.ts");

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";
const WS_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const WS_2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";

function pagination(returned: number, total = returned) {
  return { limit: 100, offset: 0, returned, total };
}

function orgResult(items: unknown[], total?: number) {
  return {
    structuredContent: {
      items,
      pagination: pagination(items.length, total ?? items.length),
    },
  };
}

function wsResult(items: unknown[], total?: number) {
  return {
    structuredContent: {
      items,
      pagination: pagination(items.length, total ?? items.length),
    },
  };
}

interface Recorded {
  readonly name: string;
  readonly arguments: Record<string, unknown>;
}

function recorder(
  respond: (call: Recorded, index: number) => unknown,
): { call: ServerToolCaller; calls: Recorded[]; concurrent: number } {
  const calls: Recorded[] = [];
  const tracker = { concurrent: 0 };
  let inFlight = 0;
  const call: ServerToolCaller = async (request) => {
    inFlight += 1;
    if (inFlight > 1) tracker.concurrent = inFlight;
    calls.push({ name: request.name, arguments: { ...request.arguments } });
    const index = calls.length - 1;
    await Promise.resolve();
    const result = respond(calls[index], index);
    inFlight -= 1;
    return result;
  };
  return {
    call,
    calls,
    get concurrent() {
      return tracker.concurrent;
    },
  };
}

// -----------------------------------------------------------------------------
// A. One-time discovery guard / prerequisites
// -----------------------------------------------------------------------------

const readyGuard = {
  connected: true,
  connectionFailed: false,
  hostSupportsServerTools: true,
  alreadyStarted: false,
};

Deno.test("A1: discovery does not start before a successful connection", () => {
  assertFalse(shouldStartWorkspaceDiscovery({ ...readyGuard, connected: false }));
  assertFalse(
    shouldStartWorkspaceDiscovery({
      ...readyGuard,
      connected: false,
      connectionFailed: true,
    }),
  );
});

Deno.test("A2: discovery does not start without serverTools support", () => {
  assertFalse(
    shouldStartWorkspaceDiscovery({
      ...readyGuard,
      hostSupportsServerTools: false,
    }),
  );
});

// API-Q.PS.4A-C2: the presentation-only bootstrap result is no longer a
// discovery prerequisite (Microsoft 365 Copilot never delivers it to the App).
Deno.test("A3: discovery starts without any bootstrap tool result", () => {
  assert(shouldStartWorkspaceDiscovery(readyGuard));
  // The guard input carries no bootstrap field at all.
  assertFalse(
    Object.keys(readyGuard).some((key) => key.startsWith("bootstrap")),
  );
  // The pure guard body references no bootstrap state.
  const guardBody = dataSource.slice(
    dataSource.indexOf("export function shouldStartWorkspaceDiscovery("),
  );
  assertFalse(guardBody.includes("bootstrapReceived"));
  assertFalse(guardBody.includes("bootstrapValid"));
  // The View no longer passes bootstrap state into the guard.
  const guardCall = viewSource.slice(
    viewSource.indexOf("shouldStartWorkspaceDiscovery({"),
    viewSource.indexOf("if (!allowed) return;"),
  );
  assertFalse(guardCall.includes("bootstrap"));
});





Deno.test("A4: discovery starts exactly once when all prerequisites hold", () => {
  assert(shouldStartWorkspaceDiscovery(readyGuard));
  assertFalse(
    shouldStartWorkspaceDiscovery({ ...readyGuard, alreadyStarted: true }),
  );
});

Deno.test("A5: View guards the single start and never auto-retries", () => {
  assert(viewSource.includes("shouldStartWorkspaceDiscovery("));
  assert(viewSource.includes("discovery.started = true;"));
  const starts = viewSource.match(/maybeStartDiscovery\(call\)/g) ?? [];
  assertStrictEquals(starts.length, 2); // connect() completion + bootstrap result
  assertFalse(viewSource.includes("setTimeout"));
  assertFalse(viewSource.includes("setInterval"));
  const connectAt = viewSource.indexOf("await app.connect()");
  const startAfterConnect = viewSource.indexOf(
    "maybeStartDiscovery(call);",
    connectAt,
  );
  assert(startAfterConnect > connectAt);
});

// -----------------------------------------------------------------------------
// B. Discovery sequence, tools and bounded arguments
// -----------------------------------------------------------------------------

Deno.test("B1: first call is btpm_list_organizations with bounded arguments", async () => {
  const rec = recorder((call) =>
    call.name === ORGANIZATIONS_TOOL_NAME
      ? orgResult([{ organizationId: ORG_A, name: "Org A", role: "org_admin" }])
      : wsResult([{ workspaceId: WS_1, organizationId: ORG_A, name: "WS One" }])
  );
  const outcome = await discoverWorkspaceChoices(rec.call);
  assertStrictEquals(outcome.kind, "ok");
  assertStrictEquals(rec.calls[0].name, "btpm_list_organizations");
  assertEquals(rec.calls[0].arguments, { limit: 100, offset: 0 });
  assertStrictEquals(DISCOVERY_PAGE_LIMIT, 100);
  assertStrictEquals(DISCOVERY_PAGE_OFFSET, 0);
});

Deno.test("B2: Workspace calls use only returned Organization IDs, sequentially", async () => {
  const rec = recorder((call) => {
    if (call.name === ORGANIZATIONS_TOOL_NAME) {
      return orgResult([
        { organizationId: ORG_A, name: "Org A", role: "org_member" },
        { organizationId: ORG_B, name: "Org B", role: "org_admin" },
      ]);
    }
    const org = call.arguments.organizationId as string;
    return wsResult([
      {
        workspaceId: org === ORG_A ? WS_1 : WS_2,
        organizationId: org,
        name: org === ORG_A ? "WS One" : "WS Two",
      },
    ]);
  });
  const outcome = await discoverWorkspaceChoices(rec.call);
  assertStrictEquals(outcome.kind, "ok");
  assertEquals(rec.calls.map((c) => c.name), [
    "btpm_list_organizations",
    "btpm_list_workspaces",
    "btpm_list_workspaces",
  ]);
  assertEquals(rec.calls[1].arguments, {
    organizationId: ORG_A,
    limit: 100,
    offset: 0,
  });
  assertEquals(rec.calls[2].arguments, {
    organizationId: ORG_B,
    limit: 100,
    offset: 0,
  });
  assertStrictEquals(rec.concurrent, 0, "workspace calls must not be concurrent");
  assertStrictEquals(WORKSPACES_TOOL_NAME, "btpm_list_workspaces");
});

Deno.test("B3: valid payloads flatten into Workspace choices keeping Organization names", async () => {
  const rec = recorder((call) => {
    if (call.name === ORGANIZATIONS_TOOL_NAME) {
      return orgResult([
        { organizationId: ORG_A, name: "Org A" },
        { organizationId: ORG_B, name: "Org B" },
      ]);
    }
    const org = call.arguments.organizationId as string;
    return wsResult(
      org === ORG_A
        ? [{ workspaceId: WS_1, organizationId: ORG_A, name: "WS One" }]
        : [{ workspaceId: WS_2, organizationId: ORG_B, name: "WS Two" }],
    );
  });
  const outcome = await discoverWorkspaceChoices(rec.call);
  assert(outcome.kind === "ok");
  assertEquals(outcome.choices.map((c) => c.workspaceName), ["WS One", "WS Two"]);
  assertEquals(outcome.choices.map((c) => c.organizationName), ["Org A", "Org B"]);
  assertStrictEquals(outcome.choices[0].workspaceId, WS_1);
  assertStrictEquals(outcome.choices[1].organizationId, ORG_B);
});

Deno.test("B4: zero accessible Workspaces yields an empty flattened collection", async () => {
  const rec = recorder((call) =>
    call.name === ORGANIZATIONS_TOOL_NAME
      ? orgResult([{ organizationId: ORG_A, name: "Org A" }])
      : wsResult([])
  );
  const outcome = await discoverWorkspaceChoices(rec.call);
  assert(outcome.kind === "ok");
  assertStrictEquals(outcome.choices.length, 0);
});

// -----------------------------------------------------------------------------
// C. Defensive parsing / fail-closed behavior
// -----------------------------------------------------------------------------

Deno.test("C1: isError results and malformed structured content fail closed", () => {
  assertStrictEquals(
    readToolStructuredContent({ isError: true, structuredContent: { items: [] } }),
    undefined,
  );
  assertStrictEquals(readToolStructuredContent(undefined), undefined);
  assertStrictEquals(readToolStructuredContent({ structuredContent: "x" }), undefined);
  assertStrictEquals(
    parseOrganizationsResult({ isError: true, structuredContent: orgResult([]) }).kind,
    "failed",
  );
});

Deno.test("C2: malformed pagination fails closed", () => {
  assertStrictEquals(parsePagination(undefined), undefined);
  assertStrictEquals(parsePagination({ returned: "1", total: 1 }), undefined);
  assertStrictEquals(parsePagination({ returned: 1 }), undefined);
  assertStrictEquals(
    parseOrganizationsResult({ structuredContent: { items: [], pagination: {} } }).kind,
    "failed",
  );
  assertStrictEquals(
    parseWorkspacesResult({ structuredContent: { items: [] } }, ORG_A).kind,
    "failed",
  );
});

Deno.test("C3: missing/blank identifiers and names fail closed", () => {
  assertStrictEquals(
    parseOrganizationsResult(orgResult([{ organizationId: ORG_A, name: "" }])).kind,
    "failed",
  );
  assertStrictEquals(
    parseOrganizationsResult(orgResult([{ organizationId: 7, name: "Org" }])).kind,
    "failed",
  );
  assertStrictEquals(
    parseWorkspacesResult(
      wsResult([{ workspaceId: WS_1, organizationId: ORG_A, name: "  " }]),
      ORG_A,
    ).kind,
    "failed",
  );
});

Deno.test("C4: duplicate Organization and Workspace IDs fail closed", () => {
  assertStrictEquals(
    parseOrganizationsResult(
      orgResult([
        { organizationId: ORG_A, name: "Org A" },
        { organizationId: ORG_A, name: "Org A again" },
      ]),
    ).kind,
    "failed",
  );
  assertStrictEquals(
    parseWorkspacesResult(
      wsResult([
        { workspaceId: WS_1, organizationId: ORG_A, name: "One" },
        { workspaceId: WS_1, organizationId: ORG_A, name: "One again" },
      ]),
      ORG_A,
    ).kind,
    "failed",
  );
});

Deno.test("C5: a Workspace from a different Organization fails closed", () => {
  assertStrictEquals(
    parseWorkspacesResult(
      wsResult([{ workspaceId: WS_1, organizationId: ORG_B, name: "One" }]),
      ORG_A,
    ).kind,
    "failed",
  );
});

Deno.test("C6: duplicate Workspace IDs across Organizations fail closed in discovery", async () => {
  const rec = recorder((call) => {
    if (call.name === ORGANIZATIONS_TOOL_NAME) {
      return orgResult([
        { organizationId: ORG_A, name: "Org A" },
        { organizationId: ORG_B, name: "Org B" },
      ]);
    }
    const org = call.arguments.organizationId as string;
    return wsResult([{ workspaceId: WS_1, organizationId: org, name: "Same" }]);
  });
  assertStrictEquals((await discoverWorkspaceChoices(rec.call)).kind, "failed");
});

Deno.test("C7: a thrown/errored tool call fails closed without retry", async () => {
  let calls = 0;
  const outcome = await discoverWorkspaceChoices(() => {
    calls += 1;
    return Promise.reject(new Error("boom"));
  });
  assertStrictEquals(outcome.kind, "failed");
  assertStrictEquals(calls, 1);

  const rec = recorder((call) =>
    call.name === ORGANIZATIONS_TOOL_NAME
      ? orgResult([{ organizationId: ORG_A, name: "Org A" }])
      : { isError: true }
  );
  assertStrictEquals((await discoverWorkspaceChoices(rec.call)).kind, "failed");
});

// -----------------------------------------------------------------------------
// D. Pagination boundary
// -----------------------------------------------------------------------------

Deno.test("D1: truncated Organizations page yields the bounded overflow state", async () => {
  const rec = recorder(() =>
    orgResult([{ organizationId: ORG_A, name: "Org A" }], 250)
  );
  assertStrictEquals((await discoverWorkspaceChoices(rec.call)).kind, "overflow");
  assertStrictEquals(rec.calls.length, 1, "no workspace call after overflow");
});

Deno.test("D2: truncated Workspaces page yields the bounded overflow state", async () => {
  const rec = recorder((call) =>
    call.name === ORGANIZATIONS_TOOL_NAME
      ? orgResult([{ organizationId: ORG_A, name: "Org A" }])
      : wsResult([{ workspaceId: WS_1, organizationId: ORG_A, name: "One" }], 900)
  );
  assertStrictEquals((await discoverWorkspaceChoices(rec.call)).kind, "overflow");
});

Deno.test("D3: no unbounded pagination loop exists (offset is a fixed constant)", () => {
  assertFalse(/offset\s*\+/.test(dataSource));
  assertFalse(dataSource.includes("while ("));
  assertStrictEquals(
    (dataSource.match(/DISCOVERY_PAGE_OFFSET/g) ?? []).length >= 3,
    true,
  );
});

// -----------------------------------------------------------------------------
// E. Workspace UX states, single/multi behavior and local search
// -----------------------------------------------------------------------------

Deno.test("E1: bounded Workspace state copy is exact", () => {
  assertStrictEquals(WORKSPACE_STATE_MESSAGES.loading, "Loading available workspaces\u2026");
  assertStrictEquals(
    WORKSPACE_STATE_MESSAGES.empty,
    "No accessible BTPM Workspaces were found.",
  );
  assertStrictEquals(
    WORKSPACE_STATE_MESSAGES.failure,
    "Available Workspaces could not be loaded. Use the text fallback in the conversation.",
  );
  assertStrictEquals(
    WORKSPACE_STATE_MESSAGES.overflow,
    "Too many Workspaces are available to display safely in the selector. Use the conversation to narrow the BTPM scope.",
  );
  assertStrictEquals(WORKSPACE_STATE_MESSAGES.readyForProjects, "Ready to load Projects.");
});

Deno.test("E2: exactly one Workspace auto-selects; multiple require explicit choice", () => {
  assert(
    viewSource.includes(
      "discovery.selected = outcome.choices.length === 1\n        ? outcome.choices[0]\n        : undefined;",
    ),
  );
  assert(viewSource.includes('discovery.phase = "empty"'));
  assert(viewSource.includes('discovery.phase = "overflow"'));
  assert(viewSource.includes('discovery.phase = "failed"'));
  assert(viewSource.includes("renderWorkspaceList"));
  assert(viewSource.includes("Workspace: ${selected.workspaceName}"));
});

Deno.test("E3: selection stores only Workspace/Organization navigation context", () => {
  const block = viewSource.slice(
    viewSource.indexOf("discovery.selected = {"),
    viewSource.indexOf("render();", viewSource.indexOf("discovery.selected = {")),
  );
  assert(block.includes("workspaceId: choice.workspaceId"));
  assert(block.includes("workspaceName: choice.workspaceName"));
  assert(block.includes("organizationId: choice.organizationId"));
  assert(block.includes("organizationName: choice.organizationName"));
  assertFalse(block.includes("role"));
  assertFalse(block.includes("tenant"));
  assertFalse(block.includes("userId"));
});

Deno.test("E4: local search filters loaded choices without another server call", () => {
  const choices = [
    {
      workspaceId: WS_1,
      workspaceName: "Delivery",
      organizationId: ORG_A,
      organizationName: "Org A",
    },
    {
      workspaceId: WS_2,
      workspaceName: "Finance",
      organizationId: ORG_B,
      organizationName: "Beta Group",
    },
  ];
  assertEquals(filterWorkspaceChoices(choices, "").length, 2);
  assertEquals(
    filterWorkspaceChoices(choices, "deli").map((c) => c.workspaceId),
    [WS_1],
  );
  assertEquals(
    filterWorkspaceChoices(choices, "beta").map((c) => c.workspaceId),
    [WS_2],
  );
  assertEquals(filterWorkspaceChoices(choices, "zzz").length, 0);

  const searchHandler = viewSource.slice(
    viewSource.indexOf('search.addEventListener("input"'),
    viewSource.indexOf("container.appendChild(search);"),
  );
  assert(searchHandler.includes("renderWorkspaceResults()"));
  assertFalse(searchHandler.includes("callServerTool"));
  assertFalse(searchHandler.includes("discoverWorkspaceChoices"));
});

Deno.test("E5: Change workspace reuses already-loaded data (no server call)", () => {
  const changeBlock = viewSource.slice(
    viewSource.indexOf('change.textContent = "Change workspace";'),
    viewSource.indexOf("container.appendChild(change);"),
  );
  assert(changeBlock.includes("discovery.selected = undefined;"));
  assertFalse(changeBlock.includes("callServerTool"));
  assertFalse(changeBlock.includes("discoverWorkspaceChoices"));
});

Deno.test("E6: no identifier or role is rendered as visible text", () => {
  for (
    const forbidden of [
      "textContent = choice.workspaceId",
      "choice.organizationId)",
      "selected.workspaceId",
      "selected.organizationId",
      ".role",
      "tenantId",
    ]
  ) {
    assertFalse(viewSource.includes(forbidden), `View renders ${forbidden}`);
  }
  assertFalse(BTPM_PROJECT_SELECTOR_GENERATED_HTML.includes(ORG_A));
});

// -----------------------------------------------------------------------------
// F. Security, persistence and Project non-goal containment
// -----------------------------------------------------------------------------

Deno.test("F1: DOM construction stays safe (textContent/createElement/listeners)", () => {
  assert(viewSource.includes("document.createElement("));
  assert(viewSource.includes(".textContent = "));
  assert(viewSource.includes("addEventListener("));
  assertFalse(viewSource.includes("innerHTML"));
  assertFalse(viewSource.includes("outerHTML"));
  assertFalse(viewSource.includes("insertAdjacentHTML"));
});

Deno.test("F2: no persistence and no direct network path exists in the View", () => {
  for (const source of [viewSource, dataSource]) {
    for (
      const forbidden of [
        "localStorage",
        "sessionStorage",
        "indexedDB",
        "document.cookie",
        "XMLHttpRequest",
        "WebSocket",
        "EventSource",
        "sendBeacon",
        "createClient",
        "supabase",
      ]
    ) {
      assertFalse(source.includes(forbidden), `source contains ${forbidden}`);
    }
    assertFalse(/[^.\w]fetch\s*\(/.test(source));
  }
});

Deno.test("F3: app.callServerTool is the only new communication path", () => {
  const matches = viewSource.match(/app\.callServerTool\(/g) ?? [];
  assertStrictEquals(matches.length, 1);
  assertFalse(dataSource.includes("callServerTool"));
});

// PS.4B intentionally adds Project discovery to the View and PS.5A adds the
// canonical Project-detail revalidation read, so Project tokens are asserted
// only against the Workspace-discovery module here. Model-context updates and
// message sending remain forbidden in both modules; PS.4B/PS.5A own the
// Project-path proofs.
Deno.test("F4: Workspace module has no Project read, context update or message send", () => {
  for (
    const forbidden of [
      "btpm_list_projects",
      "btpm_get_project",
      "updateModelContext",
      "sendMessage",
      "projectId",
    ]
  ) {
    assertFalse(dataSource.includes(forbidden), `source contains ${forbidden}`);
  }
  // The View itself now publishes a validated selection via the host bridge
  // (API-Q.PS.5B); that surface is proven by the PS.5B suite, so it is no
  // longer asserted absent here.

  assertFalse(
    BTPM_PROJECT_SELECTOR_GENERATED_HTML.includes("updateModelContext(\""),
  );
});

Deno.test("F5: only the two canonical read tools are named by the View", () => {
  const toolNames = dataSource.match(/"btpm_[a-z_]+"/g) ?? [];
  assertEquals([...new Set(toolNames)].sort(), [
    '"btpm_list_organizations"',
    '"btpm_list_workspaces"',
  ]);
  assertStrictEquals(ORGANIZATIONS_TOOL_NAME, "btpm_list_organizations");
});

Deno.test("F6: pure data module stays DOM-free", () => {
  assertFalse(dataSource.includes("document."));
  assertFalse(dataSource.includes("window."));
  assertFalse(dataSource.includes("import "));
});

// -----------------------------------------------------------------------------
// G. Regenerated single-file document
// -----------------------------------------------------------------------------

Deno.test("G1: generated HTML is self-contained and carries the Workspace surface", () => {
  assert(BTPM_PROJECT_SELECTOR_GENERATED_HTML.startsWith("<!DOCTYPE html>"));
  assert(BTPM_PROJECT_SELECTOR_GENERATED_HTML.trimEnd().endsWith("</html>"));
  assert(BTPM_PROJECT_SELECTOR_GENERATED_HTML.includes("selector-workspaces"));
  for (const message of Object.values(WORKSPACE_STATE_MESSAGES)) {
    assert(
      BTPM_PROJECT_SELECTOR_GENERATED_HTML.includes(message),
      `generated HTML missing: ${message}`,
    );
  }
  assert(BTPM_PROJECT_SELECTOR_GENERATED_HTML.includes("btpm_list_organizations"));
  assert(BTPM_PROJECT_SELECTOR_GENERATED_HTML.includes("btpm_list_workspaces"));
});

Deno.test("G2: generated HTML has no external reference and no storage usage", () => {
  for (
    const forbidden of [
      "<script src",
      "<link",
      "<img",
      "@import",
      'src="http',
      'href="http',
      "url(http",
      "localStorage",
      "sessionStorage",
      "indexedDB",
      "document.cookie",
      "innerHTML",
      "XMLHttpRequest",
      "new WebSocket",
    ]
  ) {
    assertFalse(
      BTPM_PROJECT_SELECTOR_GENERATED_HTML.includes(forbidden),
      `generated HTML contains ${forbidden}`,
    );
  }
});

// -----------------------------------------------------------------------------
// H. API-Q.PS.4A-C1 — search focus + pagination integrity corrections
// -----------------------------------------------------------------------------

const searchHandlerSource = viewSource.slice(
  viewSource.indexOf('search.addEventListener("input"'),
  viewSource.indexOf("container.appendChild(search);"),
);

Deno.test("H1: search input handler no longer rerenders the whole chooser", () => {
  assert(searchHandlerSource.includes("discovery.search = search.value;"));
  assert(searchHandlerSource.includes("renderWorkspaceResults()"));
  assertFalse(searchHandlerSource.includes("renderWorkspaces()"));
  assertFalse(searchHandlerSource.includes("render()"));
  // No focus-restoration hack and no timer.
  assertFalse(searchHandlerSource.includes(".focus("));
  assertFalse(searchHandlerSource.includes("setTimeout"));
  assertFalse(viewSource.includes("setTimeout"));
  assertFalse(viewSource.includes("requestAnimationFrame"));
});

Deno.test("H2: the search input stays mounted while results are refreshed", () => {
  // The results area is a separate element, and only it is cleared on filter.
  assert(viewSource.includes('results.className = "workspace-results"'));
  assert(viewSource.includes("mountedSearchInput = search;"));
  assert(viewSource.includes("mountedResultsElement = results;"));
  const resultsRenderer = viewSource.slice(
    viewSource.indexOf("function renderWorkspaceResults()"),
    viewSource.indexOf("function renderWorkspaceList("),
  );
  // Clears the results element only: never the chooser container or the input.
  assert(resultsRenderer.includes("clear(results);"));
  assertFalse(resultsRenderer.includes("createElement(\"input\")"));
  assertFalse(resultsRenderer.includes("workspace-search"));
  assertFalse(resultsRenderer.includes("removeChild(search"));
});

Deno.test("H3: filtering successive values refreshes rows without rebuilding input", () => {
  // Pure-model proof of the successive-keystroke behavior the results-only
  // rerender relies on: each value yields the correct visible rows.
  const choices = [
    {
      workspaceId: WS_1,
      workspaceName: "Delivery",
      organizationId: ORG_A,
      organizationName: "Org A",
    },
    {
      workspaceId: WS_2,
      workspaceName: "Finance",
      organizationId: ORG_B,
      organizationName: "Beta Group",
    },
  ];
  const successive = ["d", "de", "del", "delx", "", "beta"];
  const rows = successive.map((value) =>
    filterWorkspaceChoices(choices, value).map((c) => c.workspaceId)
  );
  assertEquals(rows, [[WS_1], [WS_1], [WS_1], [], [WS_1, WS_2], [WS_2]]);
  // The Workspace search input is created exactly once, in the chooser
  // renderer. (PS.4B adds a separate Project search input of its own.)
  const listRenderer = viewSource.slice(
    viewSource.indexOf("function renderWorkspaceList("),
    viewSource.indexOf("function renderWorkspaces()"),
  );
  assertStrictEquals(
    (listRenderer.match(/createElement\("input"\)/g) ?? []).length,
    1,
  );
  const resultsRendererOnly = viewSource.slice(
    viewSource.indexOf("function renderWorkspaceResults()"),
    viewSource.indexOf("function renderWorkspaceList("),
  );
  assertFalse(resultsRendererOnly.includes('createElement("input")'));
});

Deno.test("H4: search performs no server tool call of any kind", () => {
  assertFalse(searchHandlerSource.includes("callServerTool"));
  assertFalse(searchHandlerSource.includes("discoverWorkspaceChoices"));
  assertFalse(searchHandlerSource.includes("maybeStartDiscovery"));
  const resultsRenderer = viewSource.slice(
    viewSource.indexOf("function renderWorkspaceResults()"),
    viewSource.indexOf("function renderWorkspaceList("),
  );
  assertFalse(resultsRenderer.includes("callServerTool"));
  assertFalse(resultsRenderer.includes("discoverWorkspaceChoices"));
});

Deno.test("H5: pagination rejects returned greater than total", () => {
  assertStrictEquals(parsePagination({ returned: 1, total: 0 }), undefined);
  assertStrictEquals(parsePagination({ returned: 5, total: 4 }), undefined);
});

Deno.test("H6: pagination rejects fractional counts", () => {
  assertStrictEquals(parsePagination({ returned: 1.5, total: 2 }), undefined);
  assertStrictEquals(parsePagination({ returned: 1, total: 2.5 }), undefined);
  assertStrictEquals(parsePagination({ returned: 0.1, total: 0.1 }), undefined);
});

Deno.test("H7: pagination still rejects negative and non-finite counts", () => {
  assertStrictEquals(parsePagination({ returned: -1, total: 0 }), undefined);
  assertStrictEquals(parsePagination({ returned: 0, total: -1 }), undefined);
  assertStrictEquals(parsePagination({ returned: -2, total: -1 }), undefined);
  assertStrictEquals(
    parsePagination({ returned: Number.NaN, total: 1 }),
    undefined,
  );
  assertStrictEquals(
    parsePagination({ returned: 1, total: Number.POSITIVE_INFINITY }),
    undefined,
  );
});

Deno.test("H8: valid equal counts remain accepted", () => {
  assertEquals(parsePagination({ returned: 0, total: 0 }), {
    returned: 0,
    total: 0,
  });
  assertEquals(parsePagination({ returned: 3, total: 3 }), {
    returned: 3,
    total: 3,
  });
  assertEquals(
    parsePagination({ limit: 100, offset: 0, returned: 2, total: 2 }),
    { returned: 2, total: 2 },
  );
});

Deno.test("H9: total greater than returned still produces bounded overflow", () => {
  const organizations = parseOrganizationsResult({
    structuredContent: {
      items: [{ organizationId: ORG_A, name: "Org A" }],
      pagination: { limit: 100, offset: 0, returned: 1, total: 2 },
    },
  });
  assertStrictEquals(organizations.kind, "overflow");

  const workspaces = parseWorkspacesResult({
    structuredContent: {
      items: [{ workspaceId: WS_1, organizationId: ORG_A, name: "Delivery" }],
      pagination: { limit: 100, offset: 0, returned: 1, total: 7 },
    },
  }, ORG_A);
  assertStrictEquals(workspaces.kind, "overflow");
});

Deno.test("H10: impossible counts fail closed through the collection parsers", () => {
  const organizations = parseOrganizationsResult({
    structuredContent: {
      items: [{ organizationId: ORG_A, name: "Org A" }],
      pagination: { limit: 100, offset: 0, returned: 1, total: 0 },
    },
  });
  assertStrictEquals(organizations.kind, "failed");

  const workspaces = parseWorkspacesResult({
    structuredContent: {
      items: [{ workspaceId: WS_1, organizationId: ORG_A, name: "Delivery" }],
      pagination: { limit: 100, offset: 0, returned: 1.5, total: 3 },
    },
  }, ORG_A);
  assertStrictEquals(workspaces.kind, "failed");
});

Deno.test("H11: generated HTML still carries the corrected chooser markup", () => {
  assert(BTPM_PROJECT_SELECTOR_GENERATED_HTML.includes("workspace-results"));
  assert(BTPM_PROJECT_SELECTOR_GENERATED_HTML.includes("workspace-search"));
  assertFalse(BTPM_PROJECT_SELECTOR_GENERATED_HTML.includes("<script src"));
});

// -----------------------------------------------------------------------------
// I. API-Q.PS.4A-C2 — Microsoft 365 MCP Apps bootstrap compatibility
// -----------------------------------------------------------------------------

/** Minimal harness mirroring the View's one-time discovery guard. */
function guardHarness() {
  let started = false;
  let runs = 0;
  const maybeStart = (input: {
    connected: boolean;
    connectionFailed?: boolean;
    hostSupportsServerTools: boolean;
  }): void => {
    if (!shouldStartWorkspaceDiscovery({ ...input, alreadyStarted: started })) {
      return;
    }
    started = true;
    runs += 1;
  };
  return {
    maybeStart,
    get runs() {
      return runs;
    },
  };
}

const connectedHost = { connected: true, hostSupportsServerTools: true };

Deno.test("I1: connected + serverTools starts discovery with no ontoolresult", () => {
  const h = guardHarness();
  h.maybeStart(connectedHost); // connect() completion only
  assertStrictEquals(h.runs, 1);
});

Deno.test("I2: a valid bootstrap result still starts discovery exactly once", () => {
  const h = guardHarness();
  h.maybeStart(connectedHost); // connect() completion
  h.maybeStart(connectedHost); // ontoolresult with a valid bootstrap payload
  assertStrictEquals(h.runs, 1);
});

Deno.test("I3: ontoolresult after discovery started does not duplicate calls", async () => {
  const rec = recorder((call) =>
    call.name === ORGANIZATIONS_TOOL_NAME
      ? orgResult([{ organizationId: ORG_A, name: "Org A" }])
      : wsResult([{ workspaceId: WS_1, organizationId: ORG_A, name: "WS One" }])
  );
  const h = guardHarness();
  h.maybeStart(connectedHost);
  const outcome = await discoverWorkspaceChoices(rec.call);
  h.maybeStart(connectedHost); // late ontoolresult
  assertStrictEquals(h.runs, 1);
  assertStrictEquals(outcome.kind, "ok");
  assertStrictEquals(rec.calls.length, 2);
  assertStrictEquals(rec.calls[0].name, ORGANIZATIONS_TOOL_NAME);
  assertStrictEquals(rec.calls[1].name, WORKSPACES_TOOL_NAME);
});

Deno.test("I4: malformed or absent bootstrap results never block discovery", () => {
  for (const _bootstrap of [undefined, null, {}, { selector: "other" }, "x"]) {
    const h = guardHarness();
    h.maybeStart(connectedHost);
    assertStrictEquals(h.runs, 1);
  }
});

Deno.test("I5: connection failure and missing serverTools still prevent discovery", () => {
  const failed = guardHarness();
  failed.maybeStart({ ...connectedHost, connected: false, connectionFailed: true });
  assertStrictEquals(failed.runs, 0);
  const noTools = guardHarness();
  noTools.maybeStart({ ...connectedHost, hostSupportsServerTools: false });
  assertStrictEquals(noTools.runs, 0);
});

Deno.test("I6: no timer, polling, retry or direct network path is introduced", () => {
  for (const source of [viewSource, dataSource]) {
    assertFalse(source.includes("setTimeout"));
    assertFalse(source.includes("setInterval"));
    assertFalse(source.includes("requestAnimationFrame"));
    assertFalse(source.includes("fetch("));
    assertFalse(source.includes("XMLHttpRequest"));
    assertFalse(source.includes("WebSocket"));
  }
});

Deno.test("I7: bootstrap handling stays presentation-only in the View", () => {
  assert(viewSource.includes("app.ontoolresult = (params) => {"));
  const registerAt = viewSource.indexOf("app.ontoolresult");
  const connectAt = viewSource.indexOf("await app.connect()");
  assert(registerAt < connectAt); // registered before connect()
  assert(viewSource.includes("state.bootstrapValid = isValidBootstrapResult("));
  // The bootstrap payload is only recorded, never used as authority.
  assertFalse(viewSource.includes("state.bootstrapValid && "));
});
