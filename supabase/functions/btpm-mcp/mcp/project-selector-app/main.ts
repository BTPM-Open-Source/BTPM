// API-Q.PS.3 / PS.4A / PS.4B / PS.5A / PS.5B — Universal Project Selector:
// browser MCP App View.
//
// PS.3 established the host bridge for the accepted resource
// `ui://btpm/project-selector`. PS.4A added accessible Workspace discovery.
// PS.4B added accessible Project discovery inside the selected Workspace and a
// purely local candidate Project selection, reusing ONLY the already exposed
// canonical Organizations, Workspaces and Projects read tools. PS.5A added
// authoritative Project revalidation through the canonical
// `btpm_get_project` tool: exactly one read per explicit candidate click,
// reduced to the safe Project identity, never retried automatically. PS.5B
// publishes ONLY an authoritatively validated selection into the host model
// context (`btpmActiveProject`) and then triggers one static conversational
// follow-up message.
//
// Explicit non-goals (deliberately absent below):
//   * persistence of any kind (no browser storage or cookie is used);
//   * no direct browser network access of any kind;
//   * no new API, database function, MCP tool or aggregation endpoint;
//   * no interpolation of business names/identifiers into instruction text.
//
// Rendering uses `textContent` / `createElement` / explicit event listeners
// only: no HTML string injection anywhere.

import { App, applyDocumentTheme } from "@modelcontextprotocol/ext-apps";

import {
  deriveSelectorViewState,
  hostSupportsServerTools,
  isValidBootstrapResult,
  resolveHostTheme,
  type SelectorViewStateInput,
} from "./selectorState.ts";
import {
  discoverWorkspaceChoices,
  filterWorkspaceChoices,
  shouldStartWorkspaceDiscovery,
  WORKSPACE_STATE_MESSAGES,
  type ServerToolCaller,
  type WorkspaceChoice,
} from "./selectorData.ts";
import {
  discoverProjectChoices,
  filterProjectChoices,
  PROJECT_STATE_MESSAGES,
  shouldStartProjectDiscovery,
  type ProjectChoice,
} from "./selectorProjectData.ts";
import {
  PROJECT_VALIDATION_MESSAGES,
  requestProjectValidation,
} from "./selectorValidation.ts";
import {
  HANDOFF_MESSAGES,
  performContextHandoff,
  type FollowUpSender,
  type HandoffPhase,
  type ModelContextUpdater,
  type PublishableProjectSelection,
} from "./selectorContextHandoff.ts";


import "./styles.css";


/** Generic, Tenant-neutral App identity. */
const APP_INFO = { name: "BTPM Project Selector", version: "1.0.0" } as const;

const state: SelectorViewStateInput = {
  connected: false,
  connectionFailed: false,
  hostCapabilities: undefined,
  bootstrapResult: undefined,
  bootstrapReceived: false,
};

/** Bounded Workspace-discovery phases held in iframe memory only. */
type DiscoveryPhase =
  | "idle"
  | "loading"
  | "loaded"
  | "empty"
  | "overflow"
  | "failed";

const discovery: {
  phase: DiscoveryPhase;
  started: boolean;
  choices: ReadonlyArray<WorkspaceChoice>;
  selected: WorkspaceChoice | undefined;
  search: string;
} = {
  phase: "idle",
  started: false,
  choices: [],
  selected: undefined,
  search: "",
};

/** Bounded Project-discovery phases held in iframe memory only. */
type ProjectPhase =
  | "idle"
  | "loading"
  | "loaded"
  | "empty"
  | "overflow"
  | "failed";

/**
 * Local candidate Project selection. This is NOT authoritative BTPM context:
 * it is never validated here, never written to model context, never sent as a
 * conversation message and never persisted outside iframe memory.
 */
interface ProjectCandidate {
  readonly projectId: string;
  readonly projectName: string;
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly organizationId: string;
  readonly organizationName: string;
}

const projects: {
  phase: ProjectPhase;
  /** Workspace a Project request has already been started for. */
  startedForWorkspaceId: string | undefined;
  /**
   * Monotonic iframe-local Project-discovery request counter. Every new request
   * advances it, so a result is only accepted when its captured generation is
   * still the current one. This makes acceptance request-instance bound instead
   * of merely Workspace bound: reselecting the same Workspace invalidates the
   * earlier in-flight request.
   */
  requestGeneration: number;
  choices: ReadonlyArray<ProjectChoice>;
  search: string;
  candidate: ProjectCandidate | undefined;
} = {
  phase: "idle",
  startedForWorkspaceId: undefined,
  requestGeneration: 0,
  choices: [],
  search: "",
  candidate: undefined,
};

/** Bounded validation phases for the explicitly selected Project. */
type ValidationPhase = "idle" | "validating" | "validated" | "failed";

/**
 * Authoritatively validated Project selection. It exists only after the
 * canonical Project-detail read confirmed identity and scope, and it stays in
 * iframe memory: it is not published to the model or the conversation here.
 */
interface ValidatedProjectSelection {
  readonly projectId: string;
  readonly projectName: string;
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly organizationId: string;
  readonly organizationName: string;
}

const validation: {
  phase: ValidationPhase;
  /**
   * Monotonic iframe-local validation request counter. Every attempt advances
   * it and captures the value, so acceptance is request-instance bound:
   * reselecting the same Project invalidates the earlier in-flight validation.
   */
  requestGeneration: number;
  selection: ValidatedProjectSelection | undefined;
} = {
  phase: "idle",
  requestGeneration: 0,
  selection: undefined,
};

/**
 * PS.5B conversation-context activation state, iframe memory only. The phase is
 * presentation state: it is never persisted and never sent anywhere.
 */
const handoff: {
  phase: HandoffPhase;
  /**
   * Monotonic iframe-local handoff request counter, mirroring the PS.4B/PS.5A
   * race-safety pattern. Every activation attempt advances it and captures the
   * value, so a stale asynchronous handoff result can never change UI state.
   */
  requestGeneration: number;
} = {
  phase: "idle",
  requestGeneration: 0,
};

/**
 * Invalidates any in-flight activation and returns the View to `idle`.
 *
 * Replacement semantics: the host model context is deliberately NOT cleared
 * here. The previously published active Project remains the conversational
 * selection until a replacement Project is validated and published, and the
 * next successful `updateModelContext` atomically replaces it.
 */
function resetHandoffState(): void {
  handoff.requestGeneration += 1;
  handoff.phase = "idle";
}

/** True while an activation is in progress: navigation must stay disabled. */
function isPublishing(): boolean {
  return handoff.phase === "publishing";
}

/** Invalidates any in-flight validation and drops the validated selection. */
function resetValidationState(): void {
  validation.requestGeneration += 1;
  validation.phase = "idle";
  validation.selection = undefined;
  resetHandoffState();
}


/** Drops every Project-scoped state value. Used on Workspace change. */
function resetProjectState(): void {
  // Advancing the generation invalidates any Project result still in flight.
  projects.requestGeneration += 1;
  projects.phase = "idle";
  projects.startedForWorkspaceId = undefined;
  projects.choices = [];
  projects.search = "";
  projects.candidate = undefined;
  resetValidationState();
  mountedProjectSearchInput = null;
  mountedProjectResultsElement = null;
}



function stateElement(): HTMLElement | null {
  return document.getElementById("selector-state");
}

function workspacesElement(): HTMLElement | null {
  return document.getElementById("selector-workspaces");
}

/**
 * The single host-bridge caller, bound once in `bootstrap()`. It is the only
 * business-read path available to this View.
 */
let serverToolCall: ServerToolCaller | undefined = undefined;

function projectsElement(): HTMLElement | null {
  return document.getElementById("selector-projects");
}

function clear(element: HTMLElement): void {
  while (element.firstChild) element.removeChild(element.firstChild);
}

function textNode(tag: string, className: string, text: string): HTMLElement {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

function renderSelectedWorkspace(
  container: HTMLElement,
  selected: WorkspaceChoice,
): void {
  container.appendChild(
    textNode("p", "workspace-selected", `Workspace: ${selected.workspaceName}`),
  );
  container.appendChild(
    textNode("p", "workspace-org", selected.organizationName),
  );
  container.appendChild(
    textNode("p", "workspace-next", WORKSPACE_STATE_MESSAGES.readyForProjects),
  );
  if (discovery.choices.length > 1) {
    const change = document.createElement("button");
    change.type = "button";
    change.className = "workspace-change";
    change.textContent = "Change workspace";
    // While an activation is in flight the View stays non-interactive.
    change.disabled = isPublishing();

    // Returns to the already-loaded list: no further server call is made.
    change.addEventListener("click", () => {
      // Returns to the already-loaded Workspace chooser and drops all Project
      // state, including any local candidate. No discovery is rerun.
      discovery.selected = undefined;
      resetProjectState();
      render();
    });
    container.appendChild(change);
  }
}

/**
 * Live references to the mounted Workspace chooser. The search input stays
 * mounted while the user filters, so only the results area is rebuilt per
 * keystroke and keyboard focus is never taken from the input.
 */
let mountedSearchInput: HTMLInputElement | null = null;
let mountedResultsElement: HTMLElement | null = null;

/** Rebuilds only the filtered Workspace rows/results area. */
function renderWorkspaceResults(): void {
  const results = mountedResultsElement;
  if (!results) return;
  clear(results);

  const visible = filterWorkspaceChoices(discovery.choices, discovery.search);
  if (visible.length === 0) {
    results.appendChild(
      textNode("p", "workspace-note", "No workspaces match this search."),
    );
    return;
  }

  const list = document.createElement("ul");
  list.className = "workspace-list";
  for (const choice of visible) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "workspace-row";
    button.appendChild(
      textNode("span", "workspace-row-name", choice.workspaceName),
    );
    button.appendChild(
      textNode("span", "workspace-row-org", choice.organizationName),
    );
    button.addEventListener("click", () => {
      // Only navigation context is stored, in iframe memory.
      discovery.selected = {
        workspaceId: choice.workspaceId,
        workspaceName: choice.workspaceName,
        organizationId: choice.organizationId,
        organizationName: choice.organizationName,
      };
      render();
      // Project discovery starts only here: after an explicit Workspace choice.
      if (serverToolCall) maybeStartProjectDiscovery(serverToolCall);
    });
    item.appendChild(button);
    list.appendChild(item);
  }
  results.appendChild(list);
}

function renderWorkspaceList(container: HTMLElement): void {
  const search = document.createElement("input");
  search.type = "search";
  search.className = "workspace-search";
  search.setAttribute("aria-label", "Search workspaces");
  search.placeholder = "Search workspaces";
  search.value = discovery.search;
  // Local, client-side filtering only: no server call per keystroke, and the
  // input itself is never rebuilt, so focus and caret position are preserved.
  search.addEventListener("input", () => {
    discovery.search = search.value;
    renderWorkspaceResults();
  });
  container.appendChild(search);
  mountedSearchInput = search;

  const results = document.createElement("div");
  results.className = "workspace-results";
  container.appendChild(results);
  mountedResultsElement = results;

  renderWorkspaceResults();
}

function renderWorkspaces(): void {
  const container = workspacesElement();
  if (!container) return;
  clear(container);
  // The chooser subtree was just removed: drop the stale references.
  mountedSearchInput = null;
  mountedResultsElement = null;
  container.dataset.phase = discovery.phase;

  if (discovery.phase === "idle") return;

  if (discovery.phase === "loading") {
    container.appendChild(
      textNode("p", "workspace-note", WORKSPACE_STATE_MESSAGES.loading),
    );
    return;
  }
  if (discovery.phase === "failed") {
    container.appendChild(
      textNode("p", "workspace-note", WORKSPACE_STATE_MESSAGES.failure),
    );
    return;
  }
  if (discovery.phase === "overflow") {
    container.appendChild(
      textNode("p", "workspace-note", WORKSPACE_STATE_MESSAGES.overflow),
    );
    return;
  }
  if (discovery.phase === "empty") {
    container.appendChild(
      textNode("p", "workspace-note", WORKSPACE_STATE_MESSAGES.empty),
    );
    return;
  }

  if (discovery.selected) {
    renderSelectedWorkspace(container, discovery.selected);
    return;
  }
  renderWorkspaceList(container);
}


/**
 * Live references to the mounted Project chooser. Exactly as corrected for the
 * Workspace chooser, the Project search input stays mounted while the user
 * filters, so only the Project results subtree is rebuilt per keystroke.
 */
let mountedProjectSearchInput: HTMLInputElement | null = null;
let mountedProjectResultsElement: HTMLElement | null = null;

/** Rebuilds only the filtered Project rows/results area. */
function renderProjectResults(): void {
  const results = mountedProjectResultsElement;
  if (!results) return;
  clear(results);

  const visible = filterProjectChoices(projects.choices, projects.search);
  if (visible.length === 0) {
    results.appendChild(
      textNode("p", "project-note", PROJECT_STATE_MESSAGES.noMatches),
    );
    return;
  }

  const list = document.createElement("ul");
  list.className = "project-list";
  for (const choice of visible) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "project-row";
    // No new selection may start while an activation is in flight.
    button.disabled = isPublishing();

    // Only the Project name and status are shown: no identifier is rendered.
    button.appendChild(textNode("span", "project-row-name", choice.projectName));
    button.appendChild(textNode("span", "project-row-status", choice.status));
    button.addEventListener("click", () => {
      const workspace = discovery.selected;
      if (!workspace) return;
      // Local candidate only: exactly the six navigation context fields, held
      // in iframe memory. It is never authoritative by itself.
      projects.candidate = {
        projectId: choice.projectId,
        projectName: choice.projectName,
        workspaceId: workspace.workspaceId,
        workspaceName: workspace.workspaceName,
        organizationId: workspace.organizationId,
        organizationName: workspace.organizationName,
      };
      // Authoritative revalidation starts ONLY from this explicit click.
      startProjectValidation(projects.candidate);
      render();
    });

    item.appendChild(button);
    list.appendChild(item);
  }
  results.appendChild(list);
}

function renderProjectList(container: HTMLElement): void {
  const search = document.createElement("input");
  search.type = "search";
  search.className = "project-search";
  search.setAttribute("aria-label", "Search projects");
  search.placeholder = "Search projects";
  search.value = projects.search;
  // Local, client-side filtering only: no server call per keystroke, and the
  // input itself is never rebuilt, so focus and caret position are preserved.
  search.addEventListener("input", () => {
    projects.search = search.value;
    renderProjectResults();
  });
  container.appendChild(search);
  mountedProjectSearchInput = search;

  const results = document.createElement("div");
  results.className = "project-results";
  container.appendChild(results);
  mountedProjectResultsElement = results;

  renderProjectResults();
}

function renderProjectCandidate(
  container: HTMLElement,
  candidate: ProjectCandidate,
): void {
  const validated = validation.phase === "validated"
    ? validation.selection
    : undefined;
  // The canonical current Project name wins once validation succeeded, so a
  // Project renamed between discovery and validation is shown correctly.
  const projectName = validated ? validated.projectName : candidate.projectName;
  // PS.5B-C1: once the selection is activated for the conversation (active or
  // context_only) the canonical validated Project name is presented as the
  // active Project. Business values still enter the DOM only via textContent.
  const isActivated = validated !== undefined &&
    (handoff.phase === "active" || handoff.phase === "context_only");
  container.appendChild(
    textNode(
      "p",
      "project-selected",
      isActivated
        ? `Active project: ${projectName}`
        : `Project: ${projectName}`,
    ),
  );
  container.appendChild(
    textNode("p", "project-workspace", `Workspace: ${candidate.workspaceName}`),
  );
  container.appendChild(
    textNode("p", "project-org", candidate.organizationName),
  );

  if (validation.phase === "validating") {
    container.appendChild(
      textNode("p", "project-next", PROJECT_VALIDATION_MESSAGES.validating),
    );
  } else if (validation.phase === "failed") {
    container.appendChild(
      textNode("p", "project-invalid", PROJECT_VALIDATION_MESSAGES.failure),
    );
  } else if (validated) {
    container.appendChild(
      textNode("p", "project-validated", PROJECT_VALIDATION_MESSAGES.validated),
    );
    // PS.5B: exactly one bounded activation state is rendered for a validated
    // selection. No host payload or exception text is ever surfaced.
    if (handoff.phase === "publishing") {
      container.appendChild(
        textNode("p", "project-activating", HANDOFF_MESSAGES.publishing),
      );
    } else if (handoff.phase === "active") {
      container.appendChild(
        textNode("p", "project-active", HANDOFF_MESSAGES.active),
      );
    } else if (handoff.phase === "context_only") {
      container.appendChild(
        textNode("p", "project-active", HANDOFF_MESSAGES.context_only),
      );
    } else if (handoff.phase === "failed") {
      container.appendChild(
        textNode("p", "project-handoff-failed", HANDOFF_MESSAGES.failed),
      );
      // Recovery is explicit and user-initiated only: never automatic.
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "project-activate-retry";
      retry.textContent = "Retry activation";
      retry.addEventListener("click", () => {
        startContextHandoff(validated);
        render();
      });
      container.appendChild(retry);
    }
  } else {
    container.appendChild(
      textNode("p", "project-next", PROJECT_STATE_MESSAGES.readyToValidate),
    );
  }

  // Change project returns to the already-loaded Project list. With multiple
  // Projects it is always available; with a single Project it is shown only
  // when validation or activation failed, so the user can recover and retry
  // explicitly.
  if (
    projects.choices.length > 1 ||
    validation.phase === "failed" ||
    handoff.phase === "failed"
  ) {
    const change = document.createElement("button");
    change.type = "button";
    change.className = "project-change";
    change.textContent = "Change project";
    // Disabled while an activation is in flight, so no replacement selection
    // can race the publication currently being acknowledged by the host.
    change.disabled = isPublishing();
    // Returns to the already-loaded Project list: no further server call.
    change.addEventListener("click", () => {
      projects.candidate = undefined;
      resetValidationState();
      render();
    });
    container.appendChild(change);
  }
}



function renderProjects(): void {
  const container = projectsElement();
  if (!container) return;
  clear(container);
  // The Project chooser subtree was just removed: drop the stale references.
  mountedProjectSearchInput = null;
  mountedProjectResultsElement = null;
  container.dataset.phase = projects.phase;

  if (projects.phase === "idle") return;

  if (projects.phase === "loading") {
    container.appendChild(
      textNode("p", "project-note", PROJECT_STATE_MESSAGES.loading),
    );
    return;
  }
  if (projects.phase === "failed") {
    container.appendChild(
      textNode("p", "project-note", PROJECT_STATE_MESSAGES.failure),
    );
    return;
  }
  if (projects.phase === "overflow") {
    container.appendChild(
      textNode("p", "project-note", PROJECT_STATE_MESSAGES.overflow),
    );
    return;
  }
  if (projects.phase === "empty") {
    container.appendChild(
      textNode("p", "project-note", PROJECT_STATE_MESSAGES.empty),
    );
    return;
  }

  // A Project is NEVER auto-selected: the list is rendered until the user
  // explicitly clicks a Project row, even when only one Project exists.
  if (projects.candidate) {
    renderProjectCandidate(container, projects.candidate);
    return;
  }
  renderProjectList(container);
}

function render(): void {
  const element = stateElement();
  if (element) {
    const view = deriveSelectorViewState(state);
    element.dataset.state = view.kind;
    // The shell message is hidden once real Workspace content is shown.
    // The shell message is hidden once real Workspace content is shown. A
    // malformed/absent bootstrap result must never mask a working selector.
    element.hidden = discovery.phase !== "idle" &&
      (view.kind === "ready" || view.kind === "unavailable");

    element.textContent = view.message;
  }
  renderWorkspaces();
  renderProjects();
}

function applyTheme(hostContext: unknown): void {
  try {
    const theme = resolveHostTheme(hostContext);
    applyDocumentTheme(theme);
  } catch {
    // Theme application is presentational only: never fail the View for it.
  }
}

function readToolResultStructuredContent(params: unknown): unknown {
  if (typeof params !== "object" || params === null) return undefined;
  return (params as Record<string, unknown>).structuredContent;
}

/**
 * Starts Workspace discovery exactly once, and only when the host connection
 * succeeded and `serverTools` support is confirmed. The presentation-only
 * `btpm_choose_project` bootstrap result is optional (API-Q.PS.4A-C2).
 * Failures are never auto-retried.
 */
function maybeStartDiscovery(call: ServerToolCaller): void {
  const allowed = shouldStartWorkspaceDiscovery({
    connected: state.connected,
    connectionFailed: state.connectionFailed === true,
    hostSupportsServerTools: hostSupportsServerTools(state.hostCapabilities),
    alreadyStarted: discovery.started,
  });
  if (!allowed) return;


  discovery.started = true;
  discovery.phase = "loading";
  render();

  void discoverWorkspaceChoices(call).then((outcome) => {
    if (outcome.kind === "failed") {
      discovery.phase = "failed";
    } else if (outcome.kind === "overflow") {
      discovery.phase = "overflow";
    } else if (outcome.choices.length === 0) {
      discovery.phase = "empty";
    } else {
      discovery.choices = outcome.choices;
      discovery.phase = "loaded";
      // Workspace is navigation context only, so a single accessible
      // Workspace is selected automatically. A Project is never auto-selected.
      discovery.selected = outcome.choices.length === 1
        ? outcome.choices[0]
        : undefined;
    }
    render();
    // A single accessible Workspace is auto-selected, so Project discovery
    // starts here. With multiple Workspaces nothing is requested yet.
    if (discovery.selected && serverToolCall) {
      maybeStartProjectDiscovery(serverToolCall);
    }
  }, () => {
    discovery.phase = "failed";
    render();
  });
}

/**
 * Starts Project discovery for the currently selected Workspace, at most once
 * per selected Workspace. Rendering, filtering and theme changes therefore
 * never trigger a duplicate Project request, and failures are never retried.
 */
function maybeStartProjectDiscovery(call: ServerToolCaller): void {
  const workspace = discovery.selected;
  if (!workspace) return;
  const allowed = shouldStartProjectDiscovery({
    selectedWorkspaceId: workspace.workspaceId,
    startedForWorkspaceId: projects.startedForWorkspaceId,
  });
  if (!allowed) return;

  projects.requestGeneration += 1;
  const requestGeneration = projects.requestGeneration;
  projects.startedForWorkspaceId = workspace.workspaceId;
  projects.choices = [];
  projects.candidate = undefined;
  projects.search = "";
  projects.phase = "loading";
  render();

  const scope = {
    workspaceId: workspace.workspaceId,
    organizationId: workspace.organizationId,
  };
  /**
   * A result is current only when it belongs to the newest Project request and
   * the selected Workspace still matches its scope. Reselecting the same
   * Workspace starts a newer request, so the earlier one stays obsolete.
   */
  const isCurrentResult = (): boolean =>
    requestGeneration === projects.requestGeneration &&
    projects.startedForWorkspaceId === scope.workspaceId;

  void discoverProjectChoices(call, scope).then((outcome) => {
    // Obsolete results are silently discarded.
    if (!isCurrentResult()) return;
    if (outcome.kind === "failed") {
      projects.phase = "failed";
    } else if (outcome.kind === "overflow") {
      projects.phase = "overflow";
    } else if (outcome.choices.length === 0) {
      projects.phase = "empty";
    } else {
      projects.choices = outcome.choices;
      projects.phase = "loaded";
    }
    render();
  }, () => {
    if (!isCurrentResult()) return;
    projects.phase = "failed";
    render();
  });
}

/**
 * Starts exactly one authoritative Project revalidation for an explicitly
 * selected candidate. Rendering, theme changes, search filtering, Workspace
 * loading and Project loading never reach this path, and a failure is never
 * retried automatically.
 *
 * The canonical `projects.get_by_id` tool owns delegated authorization,
 * Connected App enforcement, Project access, canonical identifier validation
 * and rate limiting; only its safe identity fields are consumed here.
 */
function startProjectValidation(candidate: ProjectCandidate): void {
  const call = serverToolCall;
  if (!call) return;

  validation.requestGeneration += 1;
  const requestGeneration = validation.requestGeneration;
  validation.phase = "validating";
  validation.selection = undefined;

  const scope = {
    projectId: candidate.projectId,
    workspaceId: candidate.workspaceId,
    organizationId: candidate.organizationId,
  };

  /**
   * A validation result is current only when it belongs to the newest attempt
   * AND the candidate Project plus the selected Workspace/Organization still
   * match the scope it was issued for. Reselecting the same Project starts a
   * newer attempt, so the earlier one stays obsolete.
   */
  const isCurrentValidation = (): boolean =>
    requestGeneration === validation.requestGeneration &&
    projects.candidate?.projectId === scope.projectId &&
    discovery.selected?.workspaceId === scope.workspaceId &&
    discovery.selected?.organizationId === scope.organizationId;

  void requestProjectValidation(call, scope).then((outcome) => {
    // Obsolete results are silently discarded.
    if (!isCurrentValidation()) return;
    if (outcome.kind !== "ok") {
      validation.phase = "failed";
      validation.selection = undefined;
      render();
      return;
    }
    const workspace = discovery.selected;
    if (!workspace) return;
    // Exactly six fields: identity from the validated canonical result, the
    // Workspace/Organization display names from the validated navigation
    // context. No Project-detail narrative is retained.
    validation.selection = {
      projectId: outcome.identity.projectId,
      projectName: outcome.identity.name,
      workspaceId: outcome.identity.workspaceId,
      workspaceName: workspace.workspaceName,
      organizationId: outcome.identity.organizationId,
      organizationName: workspace.organizationName,
    };
    validation.phase = "validated";
    // PS.5B: publication happens ONLY here, immediately after an authoritative
    // validation success, and only for the six validated fields.
    startContextHandoff(validation.selection);
    render();
  }, () => {
    if (!isCurrentValidation()) return;
    validation.phase = "failed";
    validation.selection = undefined;
    render();
  });
}

/**
 * Host bridge closures bound in `bootstrap()`. They are the ONLY publication
 * path: no direct browser network access exists anywhere in this View.
 */
let modelContextUpdate: ModelContextUpdater | null = null;
let followUpMessageSend: FollowUpSender | null = null;

/**
 * Publishes an already authoritatively validated selection into the host model
 * context and then triggers exactly one static conversational follow-up.
 *
 * Never runs for an unvalidated candidate, never retries automatically, and a
 * stale result can never change UI state (request-generation bound, and the
 * selection identity must still match).
 */
function startContextHandoff(selection: PublishableProjectSelection): void {
  const update = modelContextUpdate;
  const send = followUpMessageSend;
  if (!update || !send) {
    handoff.requestGeneration += 1;
    handoff.phase = "failed";
    return;
  }

  handoff.requestGeneration += 1;
  const requestGeneration = handoff.requestGeneration;
  handoff.phase = "publishing";

  const isCurrentHandoff = (): boolean =>
    requestGeneration === handoff.requestGeneration &&
    validation.phase === "validated" &&
    validation.selection?.projectId === selection.projectId &&
    validation.selection?.workspaceId === selection.workspaceId &&
    validation.selection?.organizationId === selection.organizationId;

  void performContextHandoff(update, send, selection, isCurrentHandoff).then(
    (outcome) => {
      // A `stale` outcome is never UI-applicable: no phase change, no render.
      if (outcome.kind === "stale") return;
      if (!isCurrentHandoff()) return;
      handoff.phase = outcome.kind;
      render();
    },
    () => {
      if (!isCurrentHandoff()) return;
      handoff.phase = "failed";
      render();
    },
  );
}






async function bootstrap(): Promise<void> {
  // One App instance. `autoResize` keeps the normal MCP Apps responsive size
  // behavior. No mutable state is created outside this iframe module scope.
  const app = new App(APP_INFO, {}, { autoResize: true });

  // The host bridge is the ONLY communication path used by this View.
  const call: ServerToolCaller = (request) => app.callServerTool(request);
  serverToolCall = call;
  // PS.5B publication closures: bounded host bridge methods only.
  modelContextUpdate = (params) => app.updateModelContext(params);
  followUpMessageSend = (params) => app.sendMessage(params);


  // ---- All handlers are registered BEFORE connect() ----
  app.ontoolresult = (params) => {
    // Presentation-only bootstrap record (API-Q.PS.4A-C2): parsed defensively,
    // never business authority, and never a discovery prerequisite.
    state.bootstrapReceived = true;
    state.bootstrapResult = readToolResultStructuredContent(params);
    state.bootstrapValid = isValidBootstrapResult(state.bootstrapResult);
    render();
    // Harmless when discovery already ran: the one-time guard prevents a
    // duplicate Workspace-discovery execution.
    maybeStartDiscovery(call);
  };


  app.onhostcontextchanged = (hostContext) => {
    applyTheme(hostContext);
  };

  render();

  try {
    await app.connect();
  } catch {
    // Explicit connection failure: bounded unavailable state. No exception text
    // or protocol data is shown, and no host capability is faked.
    state.connected = false;
    state.connectionFailed = true;
    state.hostCapabilities = undefined;
    state.bootstrapReceived = false;
    state.bootstrapResult = undefined;
    render();
    return;
  }

  state.connected = true;
  state.connectionFailed = false;
  // Optional host capabilities are read defensively; an absent capability must
  // never throw.
  state.hostCapabilities = app.getHostCapabilities();
  applyTheme(app.getHostContext());
  render();
  maybeStartDiscovery(call);
}

void bootstrap();
