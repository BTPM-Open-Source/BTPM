// API-Q.PS.5A — Universal Project Selector: authoritative Project revalidation
// proofs.
//
// Scope: the pure validation module (`selectorValidation.ts`), the browser View
// wiring (`main.ts`), the regenerated single-file HTML, and confirmation that no
// model-context update, message send, persistence or direct network path exists.

import {
  assert,
  assertEquals,
  assertFalse,
  assertStrictEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import type { ServerToolCaller } from "../../functions/btpm-mcp/mcp/project-selector-app/selectorData.ts";
import {
  parseValidatedProjectIdentity,
  PROJECT_VALIDATION_MESSAGES,
  PROJECT_VALIDATION_TOOL_NAME,
  requestProjectValidation,
} from "../../functions/btpm-mcp/mcp/project-selector-app/selectorValidation.ts";
import { BTPM_PROJECT_SELECTOR_GENERATED_HTML } from "../../functions/btpm-mcp/mcp/projectSelectorAppHtml.generated.ts";

const base = "../../functions/btpm-mcp/mcp/";
async function read(relative: string): Promise<string> {
  return await Deno.readTextFile(new URL(base + relative, import.meta.url));
}
const viewSource = await read("project-selector-app/main.ts");
const validationSource = await read("project-selector-app/selectorValidation.ts");

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";
const WS_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WS_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PRJ_1 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PRJ_2 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const SCOPE = {
  projectId: PRJ_1,
  workspaceId: WS_1,
  organizationId: ORG_A,
} as const;

/** A realistic canonical Project-detail payload, narrative fields included. */
function detailResult(overrides: Record<string, unknown> = {}) {
  return {
    structuredContent: {
      projectId: PRJ_1,
      organizationId: ORG_A,
      workspaceId: WS_1,
      name: "SAP S/4 Rollout",
      status: "active",
      description: "SECRET-DESCRIPTION",
      charter: "SECRET-CHARTER",
      goals: "SECRET-GOALS",
      scopeIn: "SECRET-SCOPEIN",
      scopeOut: "SECRET-SCOPEOUT",
      businessCase: "SECRET-CASE",
      successCriteria: "SECRET-SUCCESS",
      completionCriteria: "SECRET-COMPLETION",
      budgetNarrative: "SECRET-BUDGET",
      assumptions: "SECRET-ASSUMPTIONS",
      constraints: "SECRET-CONSTRAINTS",
      ...overrides,
    },
  };
}

const NARRATIVE_FIELDS = [
  "description",
  "charter",
  "goals",
  "scopeIn",
  "scopeOut",
  "businessCase",
  "successCriteria",
  "completionCriteria",
  "budgetNarrative",
  "assumptions",
  "constraints",
] as const;

function recordingCaller(
  responses: ReadonlyArray<unknown>,
): {
  call: ServerToolCaller;
  calls: Array<{ name: string; arguments: Record<string, unknown> }>;
} {
  const calls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  let index = 0;
  const call: ServerToolCaller = (request) => {
    calls.push({ name: request.name, arguments: request.arguments });
    const response = responses[index];
    index += 1;
    if (response instanceof Error) return Promise.reject(response);
    return Promise.resolve(response);
  };
  return { call, calls };
}

// -----------------------------------------------------------------------------
// A. Canonical tool reuse and exact request
// -----------------------------------------------------------------------------

Deno.test("A1: only the canonical projects.get_by_id tool is used", () => {
  assertStrictEquals(PROJECT_VALIDATION_TOOL_NAME, "btpm_get_project");
  const toolNames = validationSource.match(/"btpm_[a-z_]+"/g) ?? [];
  assertEquals([...new Set(toolNames)], ['"btpm_get_project"']);
});

Deno.test("A2: the exact request carries only the candidate projectId", async () => {
  const { call, calls } = recordingCaller([detailResult()]);
  await requestProjectValidation(call, SCOPE);
  assertStrictEquals(calls.length, 1);
  assertStrictEquals(calls[0].name, "btpm_get_project");
  assertEquals(Object.keys(calls[0].arguments), ["projectId"]);
  assertStrictEquals(calls[0].arguments.projectId, PRJ_1);
});

Deno.test("A3: no invented identifier or alternative transport", async () => {
  const { call, calls } = recordingCaller([detailResult()]);
  await requestProjectValidation(call, SCOPE);
  const args = calls[0].arguments;
  for (const forbidden of ["workspaceId", "organizationId", "tenantId", "limit"]) {
    assertFalse(forbidden in args, `arguments contain ${forbidden}`);
  }
  for (
    const forbidden of [
      "createClient",
      "supabase",
      "/v1/",
      "https://",
      "fetch(",
      "XMLHttpRequest",
      "WebSocket",
      "EventSource",
      "localStorage",
      "sessionStorage",
      "indexedDB",
      "document.cookie",
      "service_role",
      "updateModelContext",
      "sendMessage",
      "innerHTML",
      "setTimeout",
      "setInterval",
    ]
  ) {
    assertFalse(
      validationSource.includes(forbidden),
      `validation module contains ${forbidden}`,
    );
  }
});

Deno.test("A4: exactly one canonical call, never retried", async () => {
  const { call, calls } = recordingCaller([new Error("boom")]);
  const outcome = await requestProjectValidation(call, SCOPE);
  assertStrictEquals(outcome.kind, "failed");
  assertStrictEquals(calls.length, 1);
});

// -----------------------------------------------------------------------------
// B. Fail-closed defensive validation
// -----------------------------------------------------------------------------

Deno.test("B1: an isError result fails closed", () => {
  const result = { ...detailResult(), isError: true };
  assertStrictEquals(
    parseValidatedProjectIdentity(result, SCOPE).kind,
    "failed",
  );
});

Deno.test("B2: missing or malformed structured content fails closed", () => {
  for (
    const result of [
      undefined,
      null,
      {},
      { structuredContent: undefined },
      { structuredContent: null },
      { structuredContent: "x" },
      { structuredContent: [] },
      "not-an-object",
    ]
  ) {
    assertStrictEquals(
      parseValidatedProjectIdentity(result, SCOPE).kind,
      "failed",
      `accepted ${JSON.stringify(result)}`,
    );
  }
});

Deno.test("B3: absent, blank or non-string identity fails closed", () => {
  for (const field of ["projectId", "organizationId", "workspaceId", "name"]) {
    for (const value of [undefined, null, "", "   ", 7, {}, []]) {
      const result = detailResult({ [field]: value });
      assertStrictEquals(
        parseValidatedProjectIdentity(result, SCOPE).kind,
        "failed",
        `accepted ${field} = ${JSON.stringify(value)}`,
      );
    }
  }
});

Deno.test("B4: a Project-ID mismatch fails closed", () => {
  assertStrictEquals(
    parseValidatedProjectIdentity(detailResult({ projectId: PRJ_2 }), SCOPE)
      .kind,
    "failed",
  );
});

Deno.test("B5: a Workspace-ID mismatch fails closed", () => {
  assertStrictEquals(
    parseValidatedProjectIdentity(detailResult({ workspaceId: WS_2 }), SCOPE)
      .kind,
    "failed",
  );
});

Deno.test("B6: an Organization-ID mismatch fails closed", () => {
  assertStrictEquals(
    parseValidatedProjectIdentity(
      detailResult({ organizationId: ORG_B }),
      SCOPE,
    ).kind,
    "failed",
  );
});

Deno.test("B7: a malformed candidate scope fails closed", () => {
  for (
    const scope of [
      { projectId: "", workspaceId: WS_1, organizationId: ORG_A },
      { projectId: PRJ_1, workspaceId: "  ", organizationId: ORG_A },
      { projectId: PRJ_1, workspaceId: WS_1, organizationId: "" },
    ]
  ) {
    assertStrictEquals(
      parseValidatedProjectIdentity(detailResult(), scope).kind,
      "failed",
    );
  }
});

Deno.test("B8: the text fallback is never parsed", () => {
  const result = {
    content: [{ type: "text", text: JSON.stringify(detailResult().structuredContent) }],
  };
  assertStrictEquals(
    parseValidatedProjectIdentity(result, SCOPE).kind,
    "failed",
  );
  assertFalse(validationSource.includes("content["));
  assertFalse(validationSource.includes('"text"'));
});

// -----------------------------------------------------------------------------
// C. Data minimization and rename handling
// -----------------------------------------------------------------------------

Deno.test("C1: only the four identity fields are retained", () => {
  const outcome = parseValidatedProjectIdentity(detailResult(), SCOPE);
  assert(outcome.kind === "ok");
  assertEquals(Object.keys(outcome.identity).sort(), [
    "name",
    "organizationId",
    "projectId",
    "workspaceId",
  ]);
});

Deno.test("C2: no narrative field enters the validated identity", () => {
  const outcome = parseValidatedProjectIdentity(detailResult(), SCOPE);
  assert(outcome.kind === "ok");
  const serialized = JSON.stringify(outcome.identity);
  for (const field of NARRATIVE_FIELDS) {
    assertFalse(field in outcome.identity, `identity holds ${field}`);
    assertFalse(
      validationSource.includes(`structured.${field}`),
      `validation module reads ${field}`,
    );
    assertFalse(
      viewSource.includes(`identity.${field}`),
      `View source consumes ${field}`,
    );
    assertFalse(
      viewSource.includes(`selection.${field}`),
      `View source retains ${field}`,
    );
  }
  assertFalse(serialized.includes("SECRET-"));
  assertFalse(serialized.includes("status"));
});

Deno.test("C3: the raw structured content never becomes selector state", () => {
  const validated = viewSource.slice(
    viewSource.indexOf("validation.selection = {"),
    viewSource.indexOf("validation.phase = \"validated\";"),
  );
  assert(validated.includes("outcome.identity.projectId"));
  assert(validated.includes("outcome.identity.name"));
  assertFalse(validated.includes("outcome.payload"));
  assertFalse(validated.includes("structured"));
});

Deno.test("C4: a rename is accepted and the canonical current name wins", () => {
  const outcome = parseValidatedProjectIdentity(
    detailResult({ name: "SAP S/4 Rollout (renamed)" }),
    SCOPE,
  );
  assert(outcome.kind === "ok");
  assertStrictEquals(outcome.identity.name, "SAP S/4 Rollout (renamed)");
  // The rendered Project name comes from the validated result once validated.
  assert(viewSource.includes("validated ? validated.projectName"));
});

// -----------------------------------------------------------------------------
// D. Validated selection contract
// -----------------------------------------------------------------------------

Deno.test("D1: the validated selection holds exactly six fields", () => {
  const contract = viewSource.slice(
    viewSource.indexOf("interface ValidatedProjectSelection {"),
    viewSource.indexOf("const validation: {"),
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
    assert(contract.includes(`readonly ${field}: string;`), `missing ${field}`);
  }
  assertStrictEquals((contract.match(/readonly /g) ?? []).length, 6);
  for (const field of NARRATIVE_FIELDS) {
    assertFalse(contract.includes(field), `contract holds ${field}`);
  }
});

Deno.test("D2: identity comes from the validated result, names from context", () => {
  const validated = viewSource.slice(
    viewSource.indexOf("validation.selection = {"),
    viewSource.indexOf("validation.phase = \"validated\";"),
  );
  assert(validated.includes("projectId: outcome.identity.projectId,"));
  assert(validated.includes("projectName: outcome.identity.name,"));
  assert(validated.includes("workspaceId: outcome.identity.workspaceId,"));
  assert(validated.includes("organizationId: outcome.identity.organizationId,"));
  assert(validated.includes("workspaceName: workspace.workspaceName,"));
  assert(validated.includes("organizationName: workspace.organizationName,"));
});

Deno.test("D3: the validation module itself publishes nothing", () => {
  // API-Q.PS.5B moved publication into `selectorContextHandoff.ts`, which the
  // View calls only after validation succeeded. The authoritative validation
  // module must stay entirely free of any publication surface.
  for (
    const forbidden of [
      "updateModelContext",
      "sendMessage",
      "btpmActiveProject",
      "setActiveProject",
    ]
  ) {
    assertFalse(
      validationSource.includes(forbidden),
      `source contains ${forbidden}`,
    );
  }
  assertFalse(viewSource.includes("setActiveProject"));
});


// -----------------------------------------------------------------------------
// E. Validation timing and state
// -----------------------------------------------------------------------------

Deno.test("E1: validation starts only from the explicit Project row click", () => {
  const starts = viewSource.match(/startProjectValidation\(/g) ?? [];
  // One declaration plus exactly one call site.
  assertStrictEquals(starts.length, 2);
  const candidateAssignment = viewSource.indexOf("projects.candidate = {");
  const rowClick = viewSource.slice(
    candidateAssignment,
    viewSource.indexOf("list.appendChild(item);", candidateAssignment),
  );
  assert(rowClick.includes("startProjectValidation(projects.candidate);"));

  // Neither Project discovery, Workspace selection, rendering nor theme
  // handling may reach the validation path.
  const discoveryStart = viewSource.slice(
    viewSource.indexOf("function maybeStartProjectDiscovery("),
    viewSource.indexOf("function startProjectValidation("),
  );
  assertFalse(discoveryStart.includes("startProjectValidation("));
  const renderFn = viewSource.slice(
    viewSource.indexOf("function render(): void {"),
    viewSource.indexOf("function applyTheme("),
  );
  assertFalse(renderFn.includes("startProjectValidation("));
  const themeFn = viewSource.slice(
    viewSource.indexOf("function applyTheme("),
    viewSource.indexOf("function readToolResultStructuredContent("),
  );
  assertFalse(themeFn.includes("startProjectValidation("));
});

Deno.test("E2: a single Project is neither auto-selected nor auto-validated", () => {
  const discoveryStart = viewSource.slice(
    viewSource.indexOf("function maybeStartProjectDiscovery("),
    viewSource.indexOf("function startProjectValidation("),
  );
  assertFalse(discoveryStart.includes("choices.length === 1"));
  assertFalse(discoveryStart.includes("choices[0]"));
  assertFalse(discoveryStart.includes("projects.candidate = {"));
  assertFalse(discoveryStart.includes("requestProjectValidation("));
  const assignments = viewSource.match(/projects\.candidate = \{/g) ?? [];
  assertStrictEquals(assignments.length, 1);
});

Deno.test("E3: search filtering triggers no server call", () => {
  const searchHandlers = viewSource.match(
    /search\.addEventListener\("input", \(\) => \{[\s\S]*?\}\);/g,
  ) ?? [];
  assertStrictEquals(searchHandlers.length, 2);
  for (const handler of searchHandlers) {
    assertFalse(handler.includes("callServerTool"));
    assertFalse(handler.includes("discoverProjectChoices"));
    assertFalse(handler.includes("discoverWorkspaceChoices"));
    assertFalse(handler.includes("startProjectValidation"));
  }
});

Deno.test("E4: the bounded validation phases and copy are exact", () => {
  const phases = viewSource.slice(
    viewSource.indexOf("type ValidationPhase ="),
    viewSource.indexOf("interface ValidatedProjectSelection {"),
  );
  for (const phase of ["idle", "validating", "validated", "failed"]) {
    assert(phases.includes(`"${phase}"`), `missing phase ${phase}`);
  }
  assertStrictEquals(
    PROJECT_VALIDATION_MESSAGES.validating,
    "Validating Project selection\u2026",
  );
  assertStrictEquals(
    PROJECT_VALIDATION_MESSAGES.failure,
    "Project selection could not be validated. Choose the Project again.",
  );
  assertStrictEquals(
    PROJECT_VALIDATION_MESSAGES.validated,
    "Project selection validated.",
  );
  for (const key of ["validating", "failure", "validated"]) {
    assert(
      viewSource.includes(`PROJECT_VALIDATION_MESSAGES.${key}`),
      `View never renders ${key}`,
    );
  }
});

Deno.test("E5: candidate and validated selection remain distinct", () => {
  assert(viewSource.includes("interface ProjectCandidate {"));
  assert(viewSource.includes("interface ValidatedProjectSelection {"));
  assert(viewSource.includes("candidate: ProjectCandidate | undefined;"));
  assert(
    viewSource.includes("selection: ValidatedProjectSelection | undefined;"),
  );
});

Deno.test("E6: no UUID or raw tool result is rendered", () => {
  const candidateRender = viewSource.slice(
    viewSource.indexOf("function renderProjectCandidate("),
    viewSource.indexOf("function renderProjects(): void {"),
  );
  for (
    const forbidden of [
      "projectId",
      "workspaceId",
      "organizationId",
      "JSON.stringify",
      "structuredContent",
    ]
  ) {
    assertFalse(candidateRender.includes(forbidden), `renders ${forbidden}`);
  }
  assert(candidateRender.includes("textNode("));
  assertFalse(candidateRender.includes("innerHTML"));
});

// -----------------------------------------------------------------------------
// F. Validation request-instance protection
// -----------------------------------------------------------------------------

/**
 * Mirrors the View's validation request-generation guard exactly, so both the
 * A→B and the A→A reselect race can be proven deterministically without a DOM.
 */
function validationHarness() {
  const state = {
    requestGeneration: 0,
    candidateProjectId: undefined as string | undefined,
    workspaceId: undefined as string | undefined,
    organizationId: undefined as string | undefined,
    phase: "idle" as string,
    accepted: [] as string[],
  };

  function selectWorkspace(workspaceId: string, organizationId: string): void {
    state.workspaceId = workspaceId;
    state.organizationId = organizationId;
    state.candidateProjectId = undefined;
    state.requestGeneration += 1;
    state.phase = "idle";
  }

  function changeProject(): void {
    state.candidateProjectId = undefined;
    state.requestGeneration += 1;
    state.phase = "idle";
  }

  function start(projectId: string, label: string) {
    state.candidateProjectId = projectId;
    state.requestGeneration += 1;
    const requestGeneration = state.requestGeneration;
    state.phase = "validating";
    const scope = {
      projectId,
      workspaceId: state.workspaceId as string,
      organizationId: state.organizationId as string,
    };
    const isCurrent = (): boolean =>
      requestGeneration === state.requestGeneration &&
      state.candidateProjectId === scope.projectId &&
      state.workspaceId === scope.workspaceId &&
      state.organizationId === scope.organizationId;
    return {
      resolve() {
        if (!isCurrent()) return;
        state.phase = "validated";
        state.accepted.push(label);
      },
      reject() {
        if (!isCurrent()) return;
        state.phase = "failed";
        state.accepted.push(`${label}:failed`);
      },
    };
  }

  return { state, selectWorkspace, changeProject, start };
}

Deno.test("F1: an A→B stale validation result is ignored", () => {
  const harness = validationHarness();
  harness.selectWorkspace(WS_1, ORG_A);
  const a = harness.start(PRJ_1, "A");
  const b = harness.start(PRJ_2, "B");
  a.resolve();
  a.reject();
  assertEquals(harness.state.accepted, []);
  b.resolve();
  assertEquals(harness.state.accepted, ["B"]);
  assertStrictEquals(harness.state.phase, "validated");
});

Deno.test("F2: an A→A reselect stale validation result is ignored", () => {
  const harness = validationHarness();
  harness.selectWorkspace(WS_1, ORG_A);
  const first = harness.start(PRJ_1, "A1");
  harness.changeProject();
  const second = harness.start(PRJ_1, "A2");
  first.resolve();
  first.reject();
  assertEquals(harness.state.accepted, []);
  second.resolve();
  assertEquals(harness.state.accepted, ["A2"]);
});

Deno.test("F3: a Workspace change invalidates an in-flight validation", () => {
  const harness = validationHarness();
  harness.selectWorkspace(WS_1, ORG_A);
  const a = harness.start(PRJ_1, "A");
  harness.selectWorkspace(WS_2, ORG_B);
  a.resolve();
  a.reject();
  assertEquals(harness.state.accepted, []);
  assertStrictEquals(harness.state.phase, "idle");
});

Deno.test("F4: Change project invalidates an in-flight validation", () => {
  const harness = validationHarness();
  harness.selectWorkspace(WS_1, ORG_A);
  const a = harness.start(PRJ_1, "A");
  harness.changeProject();
  a.resolve();
  assertEquals(harness.state.accepted, []);
});

Deno.test("F5: both resolve and reject use the same current-request guard", () => {
  const startSource = viewSource.slice(
    viewSource.indexOf("function startProjectValidation("),
    viewSource.indexOf("async function bootstrap()"),
  );
  const guards = startSource.match(/if \(!isCurrentValidation\(\)\) return;/g) ??
    [];
  assertStrictEquals(guards.length, 2);
  assert(startSource.includes("validation.requestGeneration += 1;"));
  assert(
    startSource.includes(
      "requestGeneration === validation.requestGeneration &&",
    ),
  );
  assert(startSource.includes("projects.candidate?.projectId === scope.projectId"));
  assert(
    startSource.includes("discovery.selected?.workspaceId === scope.workspaceId"),
  );
  assert(
    startSource.includes(
      "discovery.selected?.organizationId === scope.organizationId",
    ),
  );
  // No timestamp, random ID or timer solution.
  for (
    const forbidden of [
      "Date.now",
      "Math.random",
      "crypto.randomUUID",
      "setTimeout",
      "setInterval",
      "requestAnimationFrame",
    ]
  ) {
    assertFalse(startSource.includes(forbidden), `uses ${forbidden}`);
  }
  const callSites = startSource.match(/requestProjectValidation\(/g) ?? [];
  assertStrictEquals(callSites.length, 1);
});

// -----------------------------------------------------------------------------
// G. Change project / Change workspace
// -----------------------------------------------------------------------------

Deno.test("G1: Change project clears validation without reloading Projects", () => {
  const changeBlock = viewSource.slice(
    viewSource.indexOf('change.textContent = "Change project";'),
    viewSource.indexOf("function renderProjects(): void {"),
  );
  assert(changeBlock.includes("projects.candidate = undefined;"));
  assert(changeBlock.includes("resetValidationState();"));
  assertFalse(changeBlock.includes("callServerTool"));
  assertFalse(changeBlock.includes("discoverProjectChoices"));
  assertFalse(changeBlock.includes("maybeStartProjectDiscovery"));
  assertFalse(changeBlock.includes("projects.choices = []"));
});

Deno.test("G2: resetValidationState invalidates request, phase and selection", () => {
  const reset = viewSource.slice(
    viewSource.indexOf("function resetValidationState(): void {"),
    viewSource.indexOf("/** Drops every Project-scoped state value."),
  );
  assert(reset.includes("validation.requestGeneration += 1;"));
  assert(reset.includes('validation.phase = "idle";'));
  assert(reset.includes("validation.selection = undefined;"));
});

Deno.test("G3: Change workspace clears candidate, validation and selection", () => {
  const projectReset = viewSource.slice(
    viewSource.indexOf("function resetProjectState(): void {"),
    viewSource.indexOf("function stateElement()"),
  );
  assert(projectReset.includes("projects.candidate = undefined;"));
  assert(projectReset.includes("resetValidationState();"));
  assert(projectReset.includes("projects.requestGeneration += 1;"));
  const changeBlock = viewSource.slice(
    viewSource.indexOf('change.textContent = "Change workspace";'),
    viewSource.indexOf("container.appendChild(change);"),
  );
  assert(changeBlock.includes("resetProjectState();"));
  assertFalse(changeBlock.includes("discoverWorkspaceChoices"));
  assertFalse(changeBlock.includes("discoverProjectChoices"));
});

// -----------------------------------------------------------------------------
// H. Authority boundary and generated bundle
// -----------------------------------------------------------------------------

Deno.test("H1: app.callServerTool remains the only business-read path", () => {
  const matches = viewSource.match(/app\.callServerTool\(/g) ?? [];
  assertStrictEquals(matches.length, 1);
  assertFalse(validationSource.includes("callServerTool"));
  assertFalse(validationSource.includes("document"));
  assertFalse(validationSource.includes("window"));
});

Deno.test("H2: no persistence and no direct browser network path in the View", () => {
  for (const source of [viewSource, validationSource]) {
    for (
      const forbidden of [
        "localStorage",
        "sessionStorage",
        "indexedDB",
        "document.cookie",
        "innerHTML",
        "fetch(",
        "XMLHttpRequest",
        "WebSocket",
        "EventSource",
        "createClient",
      ]
    ) {
      assertFalse(source.includes(forbidden), `source contains ${forbidden}`);
    }
  }
});

Deno.test("H3: no server, API, RPC or database surface is referenced", () => {
  for (const source of [viewSource, validationSource]) {
    for (
      const forbidden of [
        "/v1/",
        "supabase",
        "service_role",
        "rpc(",
        "api_e_private",
      ]
    ) {
      assertFalse(source.includes(forbidden), `source contains ${forbidden}`);
    }
  }
});

Deno.test("H4: the generated bundle stays deterministic and self-contained", () => {
  const html = BTPM_PROJECT_SELECTOR_GENERATED_HTML;
  assert(html.startsWith("<!doctype html>") || html.startsWith("<!DOCTYPE html>"));
  assert(html.includes("btpm_get_project"));
  assert(html.includes("Validating Project selection"));
  assert(html.includes("Project selection validated."));
  assert(
    html.includes(
      "Project selection could not be validated. Choose the Project again.",
    ),
  );
  // No test identifier, narrative value or external asset is embedded.
  for (const token of [PRJ_1, WS_1, ORG_A, "SECRET-"]) {
    assertFalse(html.includes(token), `bundle contains ${token}`);
  }
  assertFalse(/<script[^>]+src=/.test(html));
  assertFalse(/<link[^>]+stylesheet/.test(html));
});

// -----------------------------------------------------------------------------
// I. PS.5A-C1 — Single-Project validation-failure recovery
// -----------------------------------------------------------------------------
//
// With exactly one accessible Project the Change-project control was previously
// hidden, so a failed validation left the user unable to return to the list and
// retry. The recovery condition now renders Change project when there is more
// than one Project OR validation has failed.

/**
 * Extracts the exact Change-project guard condition from the View source, so
 * the recovery semantics can be asserted without a DOM.
 */
function changeProjectGuardCondition(): string {
  const candidateRender = viewSource.slice(
    viewSource.indexOf("function renderProjectCandidate("),
    viewSource.indexOf("function renderProjects(): void {"),
  );
  const match = candidateRender
    .replace(/\s+/g, " ")
    .match(
      /if \( ?(projects\.choices\.length > 1 \|\| validation\.phase === "failed"[^)]*?) ?\) \{/,
    );
  assert(match, "Change-project guard condition not found");
  return match[1];
}


Deno.test("I1: the Change-project condition covers a failed single Project", () => {
  const guard = changeProjectGuardCondition();
  assert(guard.startsWith('projects.choices.length > 1 || validation.phase === "failed"'));
  // PS.5B additionally recovers from a failed conversation activation.
  assert(guard.includes('handoff.phase === "failed"'));
});


Deno.test("I2: Change project clears candidate and validation state only", () => {
  const changeBlock = viewSource.slice(
    viewSource.indexOf('change.textContent = "Change project";'),
    viewSource.indexOf("function renderProjects(): void {"),
  );
  assert(changeBlock.includes("projects.candidate = undefined;"));
  assert(changeBlock.includes("resetValidationState();"));
  // It performs no Project-list server call and never drops the cached list.
  assertFalse(changeBlock.includes("callServerTool"));
  assertFalse(changeBlock.includes("discoverProjectChoices"));
  assertFalse(changeBlock.includes("maybeStartProjectDiscovery"));
  assertFalse(changeBlock.includes("projects.choices = []"));
});

Deno.test("I3: Change project performs no btpm_list_projects call", () => {
  const changeBlock = viewSource.slice(
    viewSource.indexOf('change.textContent = "Change project";'),
    viewSource.indexOf("function renderProjects(): void {"),
  );
  assertFalse(changeBlock.includes("btpm_list_projects"));
  assertFalse(changeBlock.includes("btpm_get_project"));
});

Deno.test("I4: reselecting the single Project starts one fresh validation", () => {
  // The Project row click is the only path that starts validation, and it
  // issues exactly one canonical btpm_get_project per click. Re-clicking the
  // same single Project advances the request generation and starts one new
  // attempt; there is exactly one requestProjectValidation call site overall.
  // lastIndexOf is used because the Workspace list shares the same list/item
  // append anchors; the Project row click is the last occurrence.
  const rowClickStart = viewSource.lastIndexOf("projects.candidate = {");
  const rowClickEnd = viewSource.lastIndexOf("list.appendChild(item);");
  const rowClick = viewSource.slice(rowClickStart, rowClickEnd);
  assert(rowClick.includes("startProjectValidation(projects.candidate);"));
  const callSites = viewSource.match(/requestProjectValidation\(/g) ?? [];
  assertStrictEquals(callSites.length, 1);
});

Deno.test("I5: a single validated Project does not show Change project", () => {
  // The guard gates on `failed` only, never on `validated`, so a single
  // validated Project keeps the control hidden (condition is false).
  const guard = changeProjectGuardCondition();
  assert(guard.includes("projects.choices.length > 1"));
  assert(guard.includes('validation.phase === "failed"'));
  assertFalse(guard.includes("validated"));
  assertFalse(guard.includes('!== "validated"'));
});

Deno.test("I6: multiple-Project Change-project behavior is unchanged", () => {
  // With multiple Projects the condition is true regardless of phase, matching
  // the prior behavior. The multiple-Project arm is still the first operand.
  const guard = changeProjectGuardCondition();
  assert(guard.startsWith("projects.choices.length > 1"));
});

Deno.test("I7: validation request-generation/race guards remain unchanged", () => {
  const startSource = viewSource.slice(
    viewSource.indexOf("function startProjectValidation("),
    viewSource.indexOf("async function bootstrap()"),
  );
  const guards = startSource.match(/if \(!isCurrentValidation\(\)\) return;/g) ??
    [];
  assertStrictEquals(guards.length, 2);
  assert(startSource.includes("validation.requestGeneration += 1;"));
  assert(
    startSource.includes(
      "requestGeneration === validation.requestGeneration &&",
    ),
  );
  assert(startSource.includes("projects.candidate?.projectId === scope.projectId"));
  assert(
    startSource.includes("discovery.selected?.workspaceId === scope.workspaceId"),
  );
  assert(
    startSource.includes(
      "discovery.selected?.organizationId === scope.organizationId",
    ),
  );
});

Deno.test("I8: no automatic retry, timer or persistence is added", () => {
  const candidateRender = viewSource.slice(
    viewSource.indexOf("function renderProjectCandidate("),
    viewSource.indexOf("function renderProjects(): void {"),
  );
  for (
    const forbidden of [
      "setTimeout",
      "setInterval",
      "requestAnimationFrame",
      "localStorage",
      "sessionStorage",
      "indexedDB",
      "document.cookie",
      "requestProjectValidation(",
      "callServerTool",
      "discoverProjectChoices",
    ]
  ) {
    assertFalse(candidateRender.includes(forbidden), `render adds ${forbidden}`);
  }
  // The guard references neither a retry nor a validated-state trigger.
  const guard = changeProjectGuardCondition();
  assertFalse(guard.includes("retry"));
  assertFalse(guard.includes("Date.now"));
  assertFalse(guard.includes("Math.random"));
});
