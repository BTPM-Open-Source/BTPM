// API-Q.PS.4B — Universal Project Selector: Project discovery and local
// candidate-selection proofs.
//
// Scope: the pure Project discovery module (`selectorProjectData.ts`), the
// browser View wiring (`main.ts`), the regenerated single-file HTML, and
// confirmation that no Project revalidation, model-context update, message
// send, persistence or direct network path exists.

import {
  assert,
  assertEquals,
  assertFalse,
  assertStrictEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  DISCOVERY_PAGE_LIMIT,
  DISCOVERY_PAGE_OFFSET,
  type ServerToolCaller,
} from "../../functions/btpm-mcp/mcp/project-selector-app/selectorData.ts";
import {
  discoverProjectChoices,
  filterProjectChoices,
  parseProjectsResult,
  PROJECT_STATE_MESSAGES,
  PROJECTS_TOOL_NAME,
  shouldStartProjectDiscovery,
} from "../../functions/btpm-mcp/mcp/project-selector-app/selectorProjectData.ts";
import { BTPM_PROJECT_SELECTOR_GENERATED_HTML } from "../../functions/btpm-mcp/mcp/projectSelectorAppHtml.generated.ts";

const base = "../../functions/btpm-mcp/mcp/";
async function read(relative: string): Promise<string> {
  return await Deno.readTextFile(new URL(base + relative, import.meta.url));
}
const viewSource = await read("project-selector-app/main.ts");
const projectDataSource = await read(
  "project-selector-app/selectorProjectData.ts",
);
const markupSource = await read("project-selector-app/index.html");

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";
const WS_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WS_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PRJ_1 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PRJ_2 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const SCOPE = { workspaceId: WS_1, organizationId: ORG_A } as const;

function projectItem(
  projectId: string,
  name: string,
  status = "active",
  workspaceId = WS_1,
  organizationId = ORG_A,
) {
  return { projectId, organizationId, workspaceId, name, status };
}

function projectsResult(
  items: ReadonlyArray<unknown>,
  pagination?: Record<string, unknown>,
) {
  return {
    structuredContent: {
      items,
      pagination: pagination ?? {
        limit: 100,
        offset: 0,
        returned: items.length,
        total: items.length,
      },
    },
  };
}

/** Records every host-bridge call so ordering and arguments can be asserted. */
function recordingCaller(
  responses: ReadonlyArray<unknown>,
): { call: ServerToolCaller; calls: Array<{ name: string; arguments: Record<string, unknown> }> } {
  const calls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  let index = 0;
  const call: ServerToolCaller = (request) => {
    calls.push({ name: request.name, arguments: request.arguments });
    const response = responses[index];
    index += 1;
    return Promise.resolve(response);
  };
  return { call, calls };
}

// -----------------------------------------------------------------------------
// A. Canonical tool reuse and exact call shape
// -----------------------------------------------------------------------------

Deno.test("A1: the canonical Projects tool name is reused verbatim", () => {
  assertStrictEquals(PROJECTS_TOOL_NAME, "btpm_list_projects");
  assert(projectDataSource.includes('"btpm_list_projects"'));
});

Deno.test("A2: exact MCP call uses the selected workspaceId, limit 100, offset 0", async () => {
  const { call, calls } = recordingCaller([
    projectsResult([projectItem(PRJ_1, "Delivery Program")]),
  ]);
  const outcome = await discoverProjectChoices(call, SCOPE);
  assertStrictEquals(outcome.kind, "ok");
  assertStrictEquals(calls.length, 1);
  assertEquals(calls[0], {
    name: "btpm_list_projects",
    arguments: { workspaceId: WS_1, limit: 100, offset: 0 },
  });
  assertStrictEquals(DISCOVERY_PAGE_LIMIT, 100);
  assertStrictEquals(DISCOVERY_PAGE_OFFSET, 0);
});

Deno.test("A3: no identifier other than the selected Workspace is invented", async () => {
  const { call, calls } = recordingCaller([projectsResult([])]);
  await discoverProjectChoices(call, SCOPE);
  const args = calls[0].arguments;
  assertEquals(Object.keys(args).sort(), ["limit", "offset", "workspaceId"]);
  assertFalse("organizationId" in args);
  assertFalse("projectId" in args);
  assertFalse("tenantId" in args);
  // No new tool, endpoint or client is introduced by the discovery module.
  for (
    const forbidden of [
      "btpm_get_project",
      "createClient",
      "supabase",
      "/v1/",
      "localhost",
      "https://",
    ]
  ) {
    assertFalse(
      projectDataSource.includes(forbidden),
      `Project data module contains ${forbidden}`,
    );
  }
});

Deno.test("A4: a single bounded page is requested with no pagination loop", () => {
  assertFalse(projectDataSource.includes("while ("));
  assertFalse(projectDataSource.includes("offset +"));
  assertFalse(projectDataSource.includes("nextOffset"));
  assertFalse(projectDataSource.includes("setTimeout"));
  const callSites = projectDataSource.match(/await call\(/g) ?? [];
  assertStrictEquals(callSites.length, 1);
});

// -----------------------------------------------------------------------------
// B. Defensive parsing of the canonical Projects result
// -----------------------------------------------------------------------------

Deno.test("B1: a valid Projects result parses into bounded choices", () => {
  const parsed = parseProjectsResult(
    projectsResult([
      projectItem(PRJ_1, "Delivery Program", "active"),
      projectItem(PRJ_2, "Finance Rollout", "on_hold"),
    ]),
    SCOPE,
  );
  assertStrictEquals(parsed.kind, "ok");
  if (parsed.kind !== "ok") return;
  assertEquals(parsed.items, [
    {
      projectId: PRJ_1,
      projectName: "Delivery Program",
      status: "active",
      workspaceId: WS_1,
      organizationId: ORG_A,
    },
    {
      projectId: PRJ_2,
      projectName: "Finance Rollout",
      status: "on_hold",
      workspaceId: WS_1,
      organizationId: ORG_A,
    },
  ]);
});

Deno.test("B2: Workspace mismatch fails closed", () => {
  const parsed = parseProjectsResult(
    projectsResult([projectItem(PRJ_1, "Foreign", "active", WS_2, ORG_A)]),
    SCOPE,
  );
  assertStrictEquals(parsed.kind, "failed");
});

Deno.test("B3: Organization mismatch fails closed", () => {
  const parsed = parseProjectsResult(
    projectsResult([projectItem(PRJ_1, "Foreign", "active", WS_1, ORG_B)]),
    SCOPE,
  );
  assertStrictEquals(parsed.kind, "failed");
});

Deno.test("B4: duplicate Project identifiers fail closed", () => {
  const parsed = parseProjectsResult(
    projectsResult([
      projectItem(PRJ_1, "One"),
      projectItem(PRJ_1, "One again"),
    ]),
    SCOPE,
  );
  assertStrictEquals(parsed.kind, "failed");
});

Deno.test("B5: malformed identity, name or status fails closed", () => {
  const malformed: ReadonlyArray<unknown> = [
    { projectId: "", organizationId: ORG_A, workspaceId: WS_1, name: "A", status: "active" },
    { projectId: PRJ_1, organizationId: "", workspaceId: WS_1, name: "A", status: "active" },
    { projectId: PRJ_1, organizationId: ORG_A, workspaceId: "  ", name: "A", status: "active" },
    { projectId: PRJ_1, organizationId: ORG_A, workspaceId: WS_1, name: "   ", status: "active" },
    { projectId: PRJ_1, organizationId: ORG_A, workspaceId: WS_1, name: "A", status: "" },
    { projectId: PRJ_1, organizationId: ORG_A, workspaceId: WS_1, name: "A" },
    { projectId: 42, organizationId: ORG_A, workspaceId: WS_1, name: "A", status: "active" },
    { projectId: PRJ_1, organizationId: ORG_A, workspaceId: WS_1, name: 7, status: "active" },
    "not-an-object",
    null,
  ];
  for (const item of malformed) {
    assertStrictEquals(
      parseProjectsResult(projectsResult([item]), SCOPE).kind,
      "failed",
      `accepted malformed Project row ${JSON.stringify(item)}`,
    );
  }
});

Deno.test("B6: error results, absent structure and text fallback fail closed", () => {
  assertStrictEquals(parseProjectsResult(undefined, SCOPE).kind, "failed");
  assertStrictEquals(parseProjectsResult({}, SCOPE).kind, "failed");
  assertStrictEquals(
    parseProjectsResult({ isError: true, structuredContent: { items: [], pagination: { returned: 0, total: 0 } } }, SCOPE).kind,
    "failed",
  );
  assertStrictEquals(
    parseProjectsResult(
      { content: [{ type: "text", text: '{"items":[]}' }] },
      SCOPE,
    ).kind,
    "failed",
  );
  // A blank scope can never be trusted either.
  assertStrictEquals(
    parseProjectsResult(projectsResult([]), {
      workspaceId: "",
      organizationId: ORG_A,
    }).kind,
    "failed",
  );
});

Deno.test("B7: malformed or impossible pagination fails closed", () => {
  for (
    const pagination of [
      undefined,
      { returned: "1", total: 1 },
      { returned: 1 },
      { returned: 1, total: 0 },
      { returned: 1.5, total: 3 },
      { returned: -1, total: 3 },
      { returned: 2, total: 2 },
    ] as ReadonlyArray<Record<string, unknown> | undefined>
  ) {
    const result = {
      structuredContent: {
        items: [projectItem(PRJ_1, "One")],
        ...(pagination === undefined ? {} : { pagination }),
      },
    };
    assertStrictEquals(
      parseProjectsResult(result, SCOPE).kind,
      "failed",
      `accepted pagination ${JSON.stringify(pagination)}`,
    );
  }
});

Deno.test("B8: total greater than returned produces bounded overflow", () => {
  const parsed = parseProjectsResult(
    projectsResult([projectItem(PRJ_1, "One")], {
      limit: 100,
      offset: 0,
      returned: 1,
      total: 250,
    }),
    SCOPE,
  );
  assertStrictEquals(parsed.kind, "overflow");
  assertStrictEquals(
    PROJECT_STATE_MESSAGES.overflow,
    "Too many Projects are available to display safely in this selector. Use the conversation to narrow the BTPM scope.",
  );
});

Deno.test("B9: zero Projects parse as an empty collection (empty state)", async () => {
  const { call } = recordingCaller([projectsResult([])]);
  const outcome = await discoverProjectChoices(call, SCOPE);
  assertStrictEquals(outcome.kind, "ok");
  if (outcome.kind !== "ok") return;
  assertStrictEquals(outcome.choices.length, 0);
  assertStrictEquals(
    PROJECT_STATE_MESSAGES.empty,
    "No accessible BTPM Projects were found in this Workspace.",
  );
});

Deno.test("B10: a rejected or malformed call yields the bounded failure state", async () => {
  const failing: ServerToolCaller = () => Promise.reject(new Error("boom"));
  assertStrictEquals((await discoverProjectChoices(failing, SCOPE)).kind, "failed");
  const { call } = recordingCaller([{ isError: true }]);
  assertStrictEquals((await discoverProjectChoices(call, SCOPE)).kind, "failed");
  assertStrictEquals(
    PROJECT_STATE_MESSAGES.failure,
    "Available Projects could not be loaded. Use the text fallback in the conversation.",
  );
  assertStrictEquals(
    PROJECT_STATE_MESSAGES.loading,
    "Loading available projects\u2026",
  );
});

// -----------------------------------------------------------------------------
// C. Discovery timing guard
// -----------------------------------------------------------------------------

Deno.test("C1: no Project discovery starts before a Workspace is selected", () => {
  assertFalse(
    shouldStartProjectDiscovery({
      selectedWorkspaceId: undefined,
      startedForWorkspaceId: undefined,
    }),
  );
  assertFalse(
    shouldStartProjectDiscovery({
      selectedWorkspaceId: "",
      startedForWorkspaceId: undefined,
    }),
  );
});

Deno.test("C2: a selected Workspace starts discovery exactly once", () => {
  assert(
    shouldStartProjectDiscovery({
      selectedWorkspaceId: WS_1,
      startedForWorkspaceId: undefined,
    }),
  );
  // Re-render / theme change with the same Workspace must not repeat the call.
  assertFalse(
    shouldStartProjectDiscovery({
      selectedWorkspaceId: WS_1,
      startedForWorkspaceId: WS_1,
    }),
  );
  // A different Workspace is a new, single request.
  assert(
    shouldStartProjectDiscovery({
      selectedWorkspaceId: WS_2,
      startedForWorkspaceId: WS_1,
    }),
  );
});

Deno.test("C3: the View starts Project discovery only from Workspace selection", () => {
  const starts = viewSource.match(/maybeStartProjectDiscovery\(serverToolCall\)/g) ??
    [];
  // Exactly two trigger sites: explicit Workspace row click and the PS.4A
  // single-Workspace auto-selection.
  assertStrictEquals(starts.length, 2);

  const rowClick = viewSource.slice(
    viewSource.indexOf("discovery.selected = {"),
    viewSource.indexOf("item.appendChild(button);"),
  );
  assert(rowClick.includes("maybeStartProjectDiscovery(serverToolCall)"));

  const autoSelect = viewSource.slice(
    viewSource.indexOf("discovery.selected = outcome.choices.length === 1"),
    viewSource.indexOf("void discoverProjectChoices("),
  );
  assert(autoSelect.includes("if (discovery.selected && serverToolCall)"));

  // Rendering never triggers a Project request.
  const renderFn = viewSource.slice(
    viewSource.indexOf("function renderProjects(): void {"),
    viewSource.indexOf("function render(): void {"),
  );
  assertFalse(renderFn.includes("maybeStartProjectDiscovery"));
  assertFalse(renderFn.includes("discoverProjectChoices"));
  assertFalse(renderFn.includes("callServerTool"));

  const themeFn = viewSource.slice(
    viewSource.indexOf("function applyTheme("),
    viewSource.indexOf("function readToolResultStructuredContent("),
  );
  assertFalse(themeFn.includes("maybeStartProjectDiscovery"));

  // No automatic retry anywhere in the Project path.
  const projectStart = viewSource.slice(
    viewSource.indexOf("function maybeStartProjectDiscovery("),
    viewSource.indexOf("async function bootstrap()"),
  );
  assertFalse(projectStart.includes("retry"));
  assertFalse(projectStart.includes("setTimeout"));
  assertFalse(projectStart.includes("setInterval"));
});

Deno.test("C4: a stale Workspace result is discarded rather than rendered", () => {
  const projectStart = viewSource.slice(
    viewSource.indexOf("function maybeStartProjectDiscovery("),
    viewSource.indexOf("async function bootstrap()"),
  );
  // The Workspace-scope comparison remains part of the acceptance condition and
  // both callbacks apply the shared guard exactly once.
  assert(
    projectStart.includes(
      "projects.startedForWorkspaceId === scope.workspaceId",
    ),
  );
  const guards = projectStart.match(/if \(!isCurrentResult\(\)\) return;/g) ?? [];
  assertStrictEquals(guards.length, 2);
});


// -----------------------------------------------------------------------------
// D. Project UI, search and local candidate selection
// -----------------------------------------------------------------------------

Deno.test("D1: the View renders every bounded Project state", () => {
  for (
    const key of [
      "loading",
      "failure",
      "overflow",
      "empty",
      "readyToValidate",
      "noMatches",
    ]
  ) {
    assert(
      viewSource.includes(`PROJECT_STATE_MESSAGES.${key}`),
      `View never renders PROJECT_STATE_MESSAGES.${key}`,
    );
  }
  assertStrictEquals(
    PROJECT_STATE_MESSAGES.noMatches,
    "No projects match this search.",
  );
  assertStrictEquals(
    PROJECT_STATE_MESSAGES.readyToValidate,
    "Ready to validate selection.",
  );
  assert(markupSource.includes('id="selector-projects"'));
});

Deno.test("D2: Project rows show name and status only, never an identifier", () => {
  const results = viewSource.slice(
    viewSource.indexOf("function renderProjectResults(): void {"),
    viewSource.indexOf("function renderProjectList("),
  );
  assert(results.includes('"project-row-name", choice.projectName'));
  assert(results.includes('"project-row-status", choice.status'));
  for (
    const forbidden of [
      "textNode(\"span\", \"project-row-id\"",
      "textContent = choice.projectId",
      "textContent = choice.workspaceId",
      "textContent = choice.organizationId",
      "programId",
      "tenantId",
      "JSON.stringify",
      "pagination",
    ]
  ) {
    assertFalse(results.includes(forbidden), `Project row renders ${forbidden}`);
  }
  assertFalse(BTPM_PROJECT_SELECTOR_GENERATED_HTML.includes(PRJ_1));
});

Deno.test("D3: Project search filters locally over name and status", () => {
  const choices = [
    {
      projectId: PRJ_1,
      projectName: "Delivery Program",
      status: "active",
      workspaceId: WS_1,
      organizationId: ORG_A,
    },
    {
      projectId: PRJ_2,
      projectName: "Finance Rollout",
      status: "on_hold",
      workspaceId: WS_1,
      organizationId: ORG_A,
    },
  ];
  assertEquals(filterProjectChoices(choices, "").length, 2);
  assertEquals(
    filterProjectChoices(choices, "deliv").map((c) => c.projectId),
    [PRJ_1],
  );
  assertEquals(
    filterProjectChoices(choices, "on_hold").map((c) => c.projectId),
    [PRJ_2],
  );
  assertEquals(filterProjectChoices(choices, "zzz").length, 0);
  // Successive keystrokes only refilter the loaded collection.
  assertEquals(
    ["f", "fi", "fin", "finx"].map((q) => filterProjectChoices(choices, q).length),
    [1, 1, 1, 0],
  );
});

Deno.test("D4: Project search performs no server call and keeps the input mounted", () => {
  const handler = viewSource.slice(
    viewSource.indexOf('search.addEventListener("input", () => {\n    projects.search'),
    viewSource.indexOf("container.appendChild(search);\n  mountedProjectSearchInput"),
  );
  assert(handler.includes("projects.search = search.value;"));
  assert(handler.includes("renderProjectResults()"));
  assertFalse(handler.includes("renderProjects()"));
  assertFalse(handler.includes("render()"));
  assertFalse(handler.includes("callServerTool"));
  assertFalse(handler.includes("discoverProjectChoices"));
  assertFalse(handler.includes(".focus("));
  assertFalse(handler.includes("setTimeout"));

  // The results subtree is the only thing rebuilt per keystroke.
  const results = viewSource.slice(
    viewSource.indexOf("function renderProjectResults(): void {"),
    viewSource.indexOf("function renderProjectList("),
  );
  assert(results.includes("clear(results);"));
  assertFalse(results.includes('createElement("input")'));
  assertFalse(results.includes("project-search"));

  // Exactly one Project search input is ever constructed.
  const listRenderer = viewSource.slice(
    viewSource.indexOf("function renderProjectList("),
    viewSource.indexOf("function renderProjectCandidate("),
  );
  assertStrictEquals(
    (listRenderer.match(/createElement\("input"\)/g) ?? []).length,
    1,
  );
});

Deno.test("D5: a Project is never auto-selected", () => {
  const projectStart = viewSource.slice(
    viewSource.indexOf("function maybeStartProjectDiscovery("),
    viewSource.indexOf("async function bootstrap()"),
  );
  // The loaded branch only stores choices: no candidate is derived from them.
  assert(projectStart.includes("projects.choices = outcome.choices;"));
  assertFalse(projectStart.includes("projects.candidate = outcome.choices"));
  assertFalse(projectStart.includes("choices.length === 1"));
  assertFalse(projectStart.includes("choices[0]"));
  // The candidate is assigned only inside the explicit row click handler.
  const assignments = viewSource.match(/projects\.candidate = \{/g) ?? [];
  assertStrictEquals(assignments.length, 1);
  const projectResults = viewSource.slice(
    viewSource.indexOf("function renderProjectResults(): void {"),
    viewSource.indexOf("function renderProjectList("),
  );
  assert(projectResults.includes('button.addEventListener("click", () => {'));
  assert(projectResults.includes("projects.candidate = {"));
});

Deno.test("D6: the local candidate holds exactly the six context fields", () => {
  const candidateType = viewSource.slice(
    viewSource.indexOf("interface ProjectCandidate {"),
    viewSource.indexOf("const projects: {"),
  );
  for (
    const field of [
      "projectId",
      "projectName",
      "workspaceId",
      "workspaceName",
      "organizationId",
      "organizationName",
    ]
  ) {
    assert(candidateType.includes(`readonly ${field}: string;`), `missing ${field}`);
  }
  assertStrictEquals((candidateType.match(/readonly /g) ?? []).length, 6);
  assertFalse(candidateType.includes("status"));
  assertFalse(candidateType.includes("tenantId"));

  const candidateRender = viewSource.slice(
    viewSource.indexOf("function renderProjectCandidate("),
    viewSource.indexOf("function renderProjects(): void {"),
  );
  // PS.5A: the rendered Project name is the validated canonical name once
  // validation succeeded, and the candidate name until then.
  assert(candidateRender.includes("`Project: ${projectName}`"));
  assert(candidateRender.includes("candidate.projectName"));
  assert(candidateRender.includes("`Workspace: ${candidate.workspaceName}`"));
  assert(candidateRender.includes("candidate.organizationName"));
  assertFalse(candidateRender.includes("candidate.projectId"));
  assertFalse(candidateRender.includes("candidate.workspaceId"));
  assertFalse(candidateRender.includes("candidate.organizationId"));
});

Deno.test("D7: Change project reuses already-loaded Project data", () => {
  const changeBlock = viewSource.slice(
    viewSource.indexOf('change.textContent = "Change project";'),
    viewSource.indexOf("function renderProjects(): void {"),
  );
  assert(changeBlock.includes("projects.candidate = undefined;"));
  assertFalse(changeBlock.includes("callServerTool"));
  assertFalse(changeBlock.includes("discoverProjectChoices"));
  assertFalse(changeBlock.includes("maybeStartProjectDiscovery"));
  assertFalse(changeBlock.includes("projects.choices = []"));
  // Offered when more than one Project was loaded OR validation failed OR
  // conversation activation failed, so a single-Project failure can recover
  // (PS.5A-C1, PS.5B).
  assert(
    viewSource.includes("projects.choices.length > 1 ||") &&
      viewSource.includes('validation.phase === "failed" ||') &&
      viewSource.includes('handoff.phase === "failed"'),
  );
});

Deno.test("D8: Change workspace clears Project state and reruns no discovery", () => {
  const changeBlock = viewSource.slice(
    viewSource.indexOf('change.textContent = "Change workspace";'),
    viewSource.indexOf("container.appendChild(change);"),
  );
  assert(changeBlock.includes("discovery.selected = undefined;"));
  assert(changeBlock.includes("resetProjectState();"));
  assertFalse(changeBlock.includes("discoverWorkspaceChoices"));
  assertFalse(changeBlock.includes("discoverProjectChoices"));
  assertFalse(changeBlock.includes("callServerTool"));

  const reset = viewSource.slice(
    viewSource.indexOf("function resetProjectState(): void {"),
    viewSource.indexOf("function stateElement()"),
  );
  for (
    const cleared of [
      'projects.phase = "idle";',
      "projects.startedForWorkspaceId = undefined;",
      "projects.choices = [];",
      'projects.search = "";',
      "projects.candidate = undefined;",
    ]
  ) {
    assert(reset.includes(cleared), `reset misses ${cleared}`);
  }
});

// -----------------------------------------------------------------------------
// E. Authority boundary, security and non-goals
// -----------------------------------------------------------------------------

// PS.5A intentionally adds the canonical Project-detail revalidation read via
// `selectorValidation.ts`; PS.5A owns those proofs. Conversation-context
// activation is owned by PS.5B (`selectorContextHandoff.ts`) and proven there;
// the Project discovery module itself must stay free of it.
Deno.test("E1: Project discovery performs no publication or host resource read", () => {
  for (
    const forbidden of [
      "updateModelContext",
      "sendMessage",
      "setActiveProject",
      "readResource",
      "listServerTools",
    ]
  ) {
    assertFalse(
      projectDataSource.includes(forbidden),
      `source contains ${forbidden}`,
    );
  }
  for (const forbidden of ["setActiveProject", "readResource", "listServerTools"]) {
    assertFalse(viewSource.includes(forbidden), `View contains ${forbidden}`);
  }
});


Deno.test("E2: no persistence and no direct browser network path", () => {
  for (const source of [viewSource, projectDataSource]) {
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
        "innerHTML",
        "outerHTML",
        "insertAdjacentHTML",
      ]
    ) {
      assertFalse(source.includes(forbidden), `source contains ${forbidden}`);
    }
    assertFalse(/[^.\w]fetch\s*\(/.test(source));
  }
  assertFalse(BTPM_PROJECT_SELECTOR_GENERATED_HTML.includes("localStorage"));
});

Deno.test("E3: the host bridge remains the only business-read path", () => {
  assertStrictEquals(
    (viewSource.match(/app\.callServerTool\(/g) ?? []).length,
    1,
  );
  assertFalse(projectDataSource.includes("callServerTool"));
  // Safe DOM construction only.
  assert(viewSource.includes("document.createElement("));
  assert(viewSource.includes("addEventListener("));
});

Deno.test("E4: the Project module reproduces no BTPM authority logic", () => {
  for (
    const forbidden of [
      "has_role",
      "app_role",
      "membership",
      "rls",
      "auth.uid",
      "service_role",
      "tenant_id",
      ".rpc(",
      "from(",
    ]
  ) {
    assertFalse(
      projectDataSource.includes(forbidden),
      `Project module contains ${forbidden}`,
    );
  }
});

Deno.test("E5: the Project module stays DOM-free and pure", () => {
  assertFalse(projectDataSource.includes("document."));
  assertFalse(projectDataSource.includes("window."));
  assertFalse(projectDataSource.includes("createElement"));
});

// -----------------------------------------------------------------------------
// F. Generated bundle
// -----------------------------------------------------------------------------

Deno.test("F1: generated HTML carries the Project surface and stays self-contained", () => {
  for (
    const marker of [
      "selector-projects",
      "project-search",
      "project-row",
      "Loading available projects",
      "No accessible BTPM Projects were found in this Workspace.",
      "Too many Projects are available to display safely in this selector.",
      "Ready to validate selection.",
      "No projects match this search.",
      "Change project",
      "btpm_list_projects",
    ]
  ) {
    assert(
      BTPM_PROJECT_SELECTOR_GENERATED_HTML.includes(marker),
      `generated HTML misses ${marker}`,
    );
  }
  assertFalse(BTPM_PROJECT_SELECTOR_GENERATED_HTML.includes("<script src"));
  assertFalse(
    BTPM_PROJECT_SELECTOR_GENERATED_HTML.includes('<link rel="stylesheet"'),
  );
  assertFalse(BTPM_PROJECT_SELECTOR_GENERATED_HTML.includes("<img "));
  assertFalse(BTPM_PROJECT_SELECTOR_GENERATED_HTML.includes("@import"));
});

// -----------------------------------------------------------------------------
// G. API-Q.PS.4B-C1 — same-Workspace Project request race correction
// -----------------------------------------------------------------------------

/** The Project-discovery start body, isolated from the rest of the View. */
const projectStartSource = viewSource.slice(
  viewSource.indexOf("function maybeStartProjectDiscovery("),
  viewSource.indexOf("async function bootstrap()"),
);
const resetSource = viewSource.slice(
  viewSource.indexOf("function resetProjectState(): void {"),
  viewSource.indexOf("function stateElement()"),
);

Deno.test("G1: the Project state owns a monotonic request generation counter", () => {
  assert(viewSource.includes("requestGeneration: number;"));
  assert(viewSource.includes("requestGeneration: 0,"));
  // No timestamps, random identifiers or persistence back the mechanism.
  assertFalse(projectStartSource.includes("Date.now"));
  assertFalse(projectStartSource.includes("Math.random"));
  assertFalse(projectStartSource.includes("crypto"));
  assertFalse(projectStartSource.includes("AbortController"));
});

Deno.test("G2: every Project request advances and captures the generation", () => {
  const advances = projectStartSource.match(/projects\.requestGeneration \+= 1;/g) ?? [];
  assertStrictEquals(advances.length, 1);
  assert(
    projectStartSource.includes(
      "const requestGeneration = projects.requestGeneration;",
    ),
  );
  // The captured generation is taken before the call is issued.
  assert(
    projectStartSource.indexOf("const requestGeneration =") <
      projectStartSource.indexOf("discoverProjectChoices("),
  );
});

Deno.test("G3: acceptance requires both the request instance and the Workspace scope", () => {
  const predicate = projectStartSource.slice(
    projectStartSource.indexOf("const isCurrentResult"),
    projectStartSource.indexOf("void discoverProjectChoices("),
  );
  assert(predicate.includes("requestGeneration === projects.requestGeneration"));
  assert(
    predicate.includes("projects.startedForWorkspaceId === scope.workspaceId"),
  );
  assert(predicate.includes("&&"));
  // Both the success and the rejection callback use the same guard.
  const guarded = projectStartSource.match(/if \(!isCurrentResult\(\)\) return;/g) ?? [];
  assertStrictEquals(guarded.length, 2);
});

Deno.test("G4: resetProjectState invalidates any in-flight Project result", () => {
  assert(resetSource.includes("projects.requestGeneration += 1;"));
  // Invalidation happens while Project state is cleared, not later.
  assert(
    resetSource.indexOf("projects.requestGeneration += 1;") <
      resetSource.indexOf("projects.choices = [];"),
  );
});

/**
 * Executable mirror of the View acceptance mechanism proved textually above.
 * It reproduces the counter, the reset invalidation and the guard, so the race
 * outcomes can be asserted deterministically without a DOM.
 */
function raceHarness() {
  const state = {
    startedForWorkspaceId: undefined as string | undefined,
    requestGeneration: 0,
    accepted: [] as Array<string>,
  };
  const reset = (): void => {
    state.requestGeneration += 1;
    state.startedForWorkspaceId = undefined;
  };
  const start = (workspaceId: string, label: string) => {
    if (state.startedForWorkspaceId === workspaceId) return undefined;
    state.requestGeneration += 1;
    const requestGeneration = state.requestGeneration;
    state.startedForWorkspaceId = workspaceId;
    const scope = { workspaceId };
    const isCurrentResult = (): boolean =>
      requestGeneration === state.requestGeneration &&
      state.startedForWorkspaceId === scope.workspaceId;
    return {
      resolve: () => {
        if (!isCurrentResult()) return;
        state.accepted.push(label);
      },
      reject: () => {
        if (!isCurrentResult()) return;
        state.accepted.push(label + ":failed");
      },
    };
  };
  return { state, reset, start };
}

Deno.test("G5: reselecting the same Workspace discards the earlier in-flight result", () => {
  const harness = raceHarness();
  const a1 = harness.start(WS_1, "A1");
  assert(a1);
  harness.reset();
  const a2 = harness.start(WS_1, "A2");
  assert(a2);
  // A1 resolves after A2 started, with the current Workspace still WS_1.
  a1.resolve();
  assertEquals(harness.state.accepted, []);
  a2.resolve();
  assertEquals(harness.state.accepted, ["A2"]);
  assertStrictEquals(harness.state.startedForWorkspaceId, WS_1);
});

Deno.test("G6: the rejection callback is request-instance bound as well", () => {
  const harness = raceHarness();
  const a1 = harness.start(WS_1, "A1");
  assert(a1);
  harness.reset();
  const a2 = harness.start(WS_1, "A2");
  assert(a2);
  a1.reject();
  assertEquals(harness.state.accepted, []);
  a2.reject();
  assertEquals(harness.state.accepted, ["A2:failed"]);
});

Deno.test("G7: cross-Workspace late-result protection still holds", () => {
  const harness = raceHarness();
  const a1 = harness.start(WS_1, "A1");
  assert(a1);
  harness.reset();
  const b1 = harness.start(WS_2, "B1");
  assert(b1);
  a1.resolve();
  a1.reject();
  assertEquals(harness.state.accepted, []);
  b1.resolve();
  assertEquals(harness.state.accepted, ["B1"]);
});

Deno.test("G8: repeated starts for an unchanged Workspace create no extra request", () => {
  const harness = raceHarness();
  const first = harness.start(WS_1, "A1");
  assert(first);
  const generationAfterFirst = harness.state.requestGeneration;
  // Render, search and theme changes re-enter the same guarded start path.
  assertStrictEquals(harness.start(WS_1, "dup"), undefined);
  assertStrictEquals(harness.start(WS_1, "dup"), undefined);
  assertStrictEquals(harness.state.requestGeneration, generationAfterFirst);
  first.resolve();
  assertEquals(harness.state.accepted, ["A1"]);
});

Deno.test("G9: the correction introduces no retry, timer, persistence or network path", () => {
  for (
    const forbidden of [
      "setTimeout",
      "setInterval",
      "requestAnimationFrame",
      "retry",
      "localStorage",
      "sessionStorage",
      "indexedDB",
      "document.cookie",
      "fetch(",
      "XMLHttpRequest",
      "WebSocket",
      "updateModelContext",
      "sendMessage",
    ]
  ) {
    assertFalse(
      projectStartSource.includes(forbidden),
      `Project start must not use ${forbidden}`,
    );
  }
  // The canonical Project call is unchanged: one bounded page, one call site.
  const callSites = projectStartSource.match(/discoverProjectChoices\(/g) ?? [];
  assertStrictEquals(callSites.length, 1);
  assertStrictEquals(DISCOVERY_PAGE_LIMIT, 100);
  assertStrictEquals(DISCOVERY_PAGE_OFFSET, 0);
});
