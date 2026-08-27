// AI-FLOW.2E — Verified UI Action Registry for BTPM Guide procedural answers.
// BTPM Guide may only describe click-by-click steps that appear here with
// `verified: true`. Unverified actions must produce a safe-limit answer, not a
// guessed UI. The edge function (supabase/functions/ai-help-chat/index.ts)
// maintains an equivalent Deno-side copy used at retrieval time.
//
// Verification sources are repo paths inspected during AI-FLOW.2E or KC content
// authored from real UI in prior steps.

export interface BtpmGuideUiAction {
  action_id: string;
  feature_area: string;
  user_intents: string[];
  verified: boolean;
  verification_source: string[];
  page_label: string;
  route_patterns: string[];
  exact_steps: string[];
  required_ui_terms: string[];
  permission_note?: string;
  not_supported?: string[];
  last_verified_step: string;
  /** Triggers that map a free-text user question to this action. */
  trigger_phrases: string[];
}

/** Banned speculative UI phrases — never allowed in a procedural answer. */
export const BANNED_SPECULATIVE_PHRASES: string[] = [
  "look for an option like",
  "or similar",
  "may be found",
  "may be available",
  "typically",
  "usually",
  "probably",
  "should be somewhere",
  "might be",
  "could be",
  "if available",
  "if there is a button",
  "something like",
  "this may be",
  // AI-FLOW.2E addendum — fabricated workflow phrases
  "baseline settings",
  "select the existing baseline",
  "create a new baseline",
  "set new dates",
  "save changes",
  "under project settings",
  "under planning",
  "usually recommended",
  "typically follow these steps",
  "look for a section",
  "may be under",
  "similar button",
  // AI-FLOW.3B — when a UI label is verified, never weaken procedural guidance with "look for"
  "look for the",
  "look for a",
  "look for an",
  // AI-FLOW.3C — strengthen no-guess wording for procedural answers
  "look for ",
  "locate the",
  "locate a",
  "locate an",
  "find the option",
  "may be",
  "might be",
  "could be",
  "similar",
  "similar",
  "section designated for",
  "section dedicated to",
  // AI-FLOW.3D — additional fabricated procedural wording
  "generally need to",
  "available submission action",
  "available action",
  "follow the prompts",
  "access the setup area",
  "navigate to the section",
  "section for managing",
  "save or submit",
  "click option",
  "option to",
  "update as needed",
];

/** Workflow claims that are explicitly not supported in BTPM. If they appear
 * as procedural assertions for a procedural-or-safe-limit question whose
 * verified action is missing, the row must fail. */
export const UNSUPPORTED_WORKFLOW_CLAIMS: string[] = [
  "baseline settings",
  "select existing baseline",
  "select the existing baseline",
  "create a new baseline",
  "set new dates",
  "save changes",
  "edit dependency from gantt",
  "edit dependencies from gantt",
  "add dependency button",
  "dependency icon",
  "submit/approve kpi automatically",
  "btpm guide created",
  "btpm guide updated",
  "btpm guide invited",
  "btpm guide submitted",
  "btpm guide granted access",
];

export const BTPM_GUIDE_UI_ACTIONS: BtpmGuideUiAction[] = [
  // ---------- VERIFIED FROM REPO ----------
  {
    action_id: "add_dependency",
    feature_area: "dependencies",
    user_intents: ["create", "plan"],
    verified: true,
    verification_source: [
      "src/components/dependencies/DependencyPanel.tsx",
      "src/pages/TaskDetail.tsx",
      "src/pages/PhaseDetail.tsx",
      "src/pages/ProjectOverviewTab.tsx",
      "src/components/planning/TaskFormDialog.tsx",
    ],
    page_label: "Task / Phase / Project Overview — Dependencies panel",
    route_patterns: [
      "/project/:id",
      "/project/:id/tasks/:taskId",
      "/project/:id/phases/:phaseId",
      "/workspace/:workspaceId/project/:projectId",
      "/workspace/:workspaceId/project/:projectId/tasks/:taskId",
      "/workspace/:workspaceId/project/:projectId/phases/:phaseId",
    ],
    exact_steps: [
      "Open the Task, Phase, or Project that should be blocked by another item.",
      "Scroll to the Dependencies panel (heading 'Dependencies').",
      "In the predecessor dropdown, pick the same-level item that must finish first.",
      "Click the 'Blocked by' button to add the dependency.",
      "The new dependency appears under 'Blocked by' with an 'FS' (Finish-to-Start) badge; remove with the X icon.",
    ],
    required_ui_terms: ["Dependencies", "Blocked by", "predecessor", "FS"],
    permission_note:
      "Requires project planning authority (edit permission) on the workspace; the panel is read-only otherwise.",
    not_supported: [
      "Creating or editing dependencies directly from the Gantt timeline. Gantt only displays dependency arrows; it does not expose an Add/Remove control.",
      "Cross-level dependencies (project → task, phase → task). Only same-level Finish-to-Start dependencies are supported in v1.",
    ],
    last_verified_step: "AI-FLOW.2E",
    trigger_phrases: [
      "add a dependency",
      "create a dependency",
      "add dependency",
      "make a dependency",
      "task dependency",
      "waiting for another",
      "blocked by",
      "predecessor",
      "add dependency button",
      "dependency from gantt",
      "dependencies from gantt",
      "edit dependency",
      "connect one task as waiting",
    ],
  },

  // ---------- VERIFIED FROM CONFIRMED KC CONTENT ----------
  {
    action_id: "create_blank_project",
    feature_area: "project_creation",
    user_intents: ["create"],
    verified: true,
    verification_source: ["kc:how-to-create-a-project (AI-KC.QA.2G)"],
    page_label: "Projects",
    route_patterns: ["/workspace/:workspaceId/projects", "/projects"],
    exact_steps: [
      "Open Projects (workspace switch first if needed).",
      "Click 'New project'.",
      "Choose 'Blank'.",
      "Enter the Project name, and optionally pick a Program.",
      "Click 'Create project'. BTPM opens the new project page.",
    ],
    required_ui_terms: ["Projects", "New project", "Blank", "Project name", "Create project"],
    permission_note:
      "Requires workspace permission to create projects. If 'New project' is not visible, ask a Workspace Admin.",
    last_verified_step: "AI-KC.QA.2G",
    trigger_phrases: [
      "create a project",
      "create a new project",
      "create blank project",
      "new project button",
      "start a project",
      "make a project",
    ],
  },
  {
    action_id: "create_project_from_template",
    feature_area: "project_creation",
    user_intents: ["create"],
    verified: true,
    verification_source: ["kc:how-to-create-a-project (AI-KC.QA.2G)"],
    page_label: "Projects",
    route_patterns: ["/workspace/:workspaceId/projects", "/projects"],
    exact_steps: [
      "Open Projects.",
      "Click 'New project'.",
      "Choose 'From template'.",
      "Pick the template and a Project start date.",
      "Enter the Project name (and optional Program), then click 'Create from template'.",
    ],
    required_ui_terms: [
      "Projects",
      "New project",
      "From template",
      "template",
      "Project start date",
      "Create from template",
    ],
    permission_note: "Requires workspace permission to create projects.",
    last_verified_step: "AI-KC.QA.2G",
    trigger_phrases: [
      "create project from template",
      "from template",
      "project template",
      "use a template",
    ],
  },

  // ---------- VERIFIED BASELINE ACTIONS (AI-FLOW.2E addendum) ----------
  {
    action_id: "baseline_review",
    feature_area: "baseline",
    user_intents: ["review", "understand"],
    verified: true,
    verification_source: [
      "src/components/project/ProjectBaselineCard.tsx",
      "src/components/baseline/BaselineComparison.tsx",
      "src/components/baseline/BaselineHistorySection.tsx",
      "src/components/baseline/BaselineLegend.tsx",
    ],
    page_label: "Project Overview — Baseline section",
    route_patterns: [
      "/workspace/:workspaceId/project/:projectId",
      "/project/:id",
    ],
    exact_steps: [
      "Open the Project Overview.",
      "Scroll to the Baseline section. It shows the current plan vs the approved baseline and a variance in days.",
      "Use the Baseline history list to see approvals, rebaselines, and post-baseline changes.",
    ],
    required_ui_terms: ["Project Overview", "Baseline", "current plan", "approved baseline", "variance", "Baseline history"],
    permission_note: "Read-only for users without project edit rights.",
    not_supported: [],
    last_verified_step: "AI-FLOW.2E addendum",
    trigger_phrases: ["view baseline", "review baseline", "see baseline", "baseline vs current plan", "what is the baseline"],
  },
  {
    action_id: "baseline_refresh_or_capture",
    feature_area: "baseline",
    user_intents: ["approve", "rebaseline"],
    verified: true,
    verification_source: [
      "src/components/project/ProjectBaselineCard.tsx",
      "src/hooks/useProjectBaseline.ts",
    ],
    page_label: "Project Overview — Baseline section",
    route_patterns: [
      "/workspace/:workspaceId/project/:projectId",
      "/project/:id",
    ],
    exact_steps: [
      "If approved baseline dates need to change, do NOT edit individual baseline dates — there is no Baseline Settings page and no per-date baseline editor.",
      "First, update the current plan (planned dates) on the Project Planning page so the new dates exist in BTPM.",
      "Record the governance reason/evidence for replacing the baseline (formal governance approval is required).",
      "Open the project and go to Project Overview.",
      "Scroll to the Baseline section.",
      "If the project has not been baselined yet, click 'Approve baseline' (after the preflight shows 'Ready to baseline') to freeze the current dates as the approved baseline.",
      "If an approved baseline already exists and governance has approved replacing it, click 'Rebaseline'. Confirm the preflight dialog 'Rebaseline this project?'.",
      "Understand the consequences: Rebaseline OVERWRITES the existing approved baseline with the current planned dates; the previous baseline is not recoverable; the action is logged in Baseline history.",
    ],
    required_ui_terms: ["Project Overview", "Baseline", "Approve baseline", "Rebaseline", "current plan", "Baseline history"],
    permission_note: "Requires project planning authority. Rebaseline should follow a formal governance decision; it cannot be undone and does not create a parallel baseline.",
    not_supported: [
      "Editing approved baseline dates in place (no Baseline Settings page and no per-date baseline editor).",
      "Creating a new baseline alongside an approved baseline (Rebaseline OVERWRITES).",
      "Editing the baseline from the Gantt timeline or the Project Planning page.",
    ],
    last_verified_step: "AI-FLOW.3B",
    trigger_phrases: [
      "approve baseline", "rebaseline", "refresh baseline", "capture baseline", "freeze baseline",
      "set the baseline", "set baseline", "create a baseline", "new baseline",
      // AI-FLOW.3B — promote change-baseline-dates intent onto verified Rebaseline action
      "change baseline dates", "change the baseline dates", "edit approved baseline",
      "edit baseline dates", "change approved baseline", "modify baseline",
      "baseline settings", "baseline already approved", "already set and approved",
      "change baseline date", "update baseline dates", "rebaseline dates",
      "change baseline dates from gantt", "edit baseline from gantt",
    ],
  },

  // ---------- UNVERIFIED (safe-limit only) ----------
  // For these, BTPM Guide must not invent UI labels. It may name the page area
  // from KC and refer the user to that page; it must say exact click-by-click
  // steps are not in the verified registry.
  ...([
    ["create_phases_and_tasks", "Project Planning", "planning", ["/project/:id/planning", "/workspace/:workspaceId/project/:projectId/planning"], ["how do i create a phase", "how do i create phases", "create phases and tasks", "build a project plan"]],
    ["add_task_to_phase", "Project Planning / Phase row", "planning", ["/project/:id/planning"], ["add a task", "add task to phase", "new task button"]],
    ["update_execution", "Task Detail", "execution", ["/project/:id/tasks/:taskId"], ["update task status", "execution update", "write an execution update"]],
    ["use_gantt", "Project Gantt", "gantt", ["/project/:id/gantt", "/workspace/:workspaceId/project/:projectId/gantt"], ["edit project dates from gantt", "use gantt", "edit dates from gantt"]],
    ["configure_project_kpi", "Project KPIs", "kpi", ["/project/:id/kpis"], ["configure a kpi", "set up a kpi"]],
    ["update_kpi_value", "Project KPIs", "kpi", ["/project/:id/kpis"], ["update a kpi value", "update kpi"]],
    ["capture_kpi_snapshot", "Project KPIs — Snapshot action", "kpi", ["/project/:id/kpis"], ["capture a kpi snapshot", "kpi snapshot"]],
    ["kpi_app_submission", "Admin → KPI App Integration", "kpi_app", ["/admin/kpi-app"], ["submit kpi data to the kpi app", "submit kpi to the kpi app"]],
    ["kpi_app_approval", "Admin → KPI App Integration", "kpi_app", ["/admin/kpi-app"], ["approve kpi submissions", "automatically approve kpi"]],
    ["setup_governance_cadence", "Project Governance", "governance", ["/project/:id/governance"], ["set up governance cadence", "configure governance cadence"]],
    ["record_governance_evidence", "Project Governance", "governance", ["/project/:id/governance"], ["record governance evidence", "record a governance review"]],
    ["connect_project_sharepoint_folder", "Project Files / Project SharePoint", "sharepoint", ["/project/:id/files", "/workspace/:workspaceId/project/:projectId/files"], ["connect a project to a sharepoint folder", "connect project sharepoint"]],
    ["setup_sharepoint_admin", "Admin → SharePoint", "sharepoint", ["/admin/sharepoint"], ["set up sharepoint", "configure sharepoint admin"]],
    ["generate_project_charter", "Project Overview", "outputs", ["/project/:id"], ["generate a project charter", "project charter"]],
    ["generate_project_status_deck", "Project Overview", "outputs", ["/project/:id"], ["generate a project status deck", "generate status deck"]],
    ["generate_roadmap_status_deck", "Roadmap", "outputs", ["/roadmap"], ["generate a roadmap status deck", "roadmap status deck"]],
    ["use_roadmap_filters", "Roadmap", "roadmap", ["/roadmap"], ["filter roadmap by selected projects", "roadmap filters"]],
    ["manage_project_access", "Project Team / Project Access", "access", ["/project/:id/team", "/workspace/:workspaceId/project/:projectId/team"], ["give someone project access", "manage project access"]],
    ["invite_user", "Admin → Invitations", "access", ["/admin/invitations"], ["invite a new user", "invite user"]],
    ["use_agile_backlog", "Agile Backlog", "agile", ["/project/:id/backlog"], ["use agile backlog", "move backlog item into a sprint"]],
    ["use_agile_sprints", "Agile Sprints", "agile", ["/project/:id/sprints"], ["close a sprint", "use agile sprints"]],
    ["use_agile_board", "Agile Board", "agile", ["/project/:id/board"], ["move an item on the agile board", "use agile board"]],
    ["use_files", "Files", "files", ["/project/:id/files", "/files"], ["open project files", "use files"]],
    ["use_btpm_guide_evaluation", "Admin → BTPM Guide Evaluation", "evaluation", ["/admin/btpm-guide-evaluation"], ["download the btpm guide evaluation protocol", "use btpm guide evaluation"]],
    ["create_risk", "Risks and Blockers", "risk", ["/project/:id/risks-blockers", "/risks-blockers"], ["create a risk", "add a risk"]],
    ["create_blocker", "Risks and Blockers", "risk", ["/project/:id/risks-blockers", "/risks-blockers"], ["create a blocker", "add a blocker"]],
    ["resolve_blocker", "Risks and Blockers", "risk", ["/project/:id/risks-blockers", "/risks-blockers"], ["resolve a blocker", "close a blocker"]],
  ] as Array<[string, string, string, string[], string[]]>).map(
    ([id, page, area, routes, triggers]): BtpmGuideUiAction => ({
      action_id: id,
      feature_area: area,
      user_intents: ["create", "configure", "update", "review"],
      verified: false,
      verification_source: [],
      page_label: page,
      route_patterns: routes,
      exact_steps: [],
      required_ui_terms: [],
      permission_note:
        "The exact control may require workspace/project authority — check with a Workspace Admin if it is not visible.",
      not_supported: [],
      last_verified_step: "AI-FLOW.2E",
      trigger_phrases: triggers,
    }),
  ),
];

const ACTION_BY_ID = new Map(BTPM_GUIDE_UI_ACTIONS.map((a) => [a.action_id, a]));

export function getUiAction(action_id: string): BtpmGuideUiAction | undefined {
  return ACTION_BY_ID.get(action_id);
}

/** Lightweight registry lookup for question→action mapping. */
export function findActionForQuery(query: string): BtpmGuideUiAction | undefined {
  const q = (query || "").toLowerCase();
  let best: { action: BtpmGuideUiAction; score: number } | null = null;
  for (const a of BTPM_GUIDE_UI_ACTIONS) {
    for (const t of a.trigger_phrases) {
      if (q.includes(t.toLowerCase())) {
        const s = t.length;
        if (!best || s > best.score) best = { action: a, score: s };
      }
    }
  }
  return best?.action;
}

/** Returns banned-phrase matches found in `answer` (lowercased). */
export function findSpeculativePhraseHits(answer: string): string[] {
  const a = (answer || "").toLowerCase();
  return BANNED_SPECULATIVE_PHRASES.filter((p) => a.includes(p));
}

/** Returns unsupported-workflow claim hits (lowercased). */
export function findUnsupportedClaimHits(answer: string): string[] {
  const a = (answer || "").toLowerCase();
  return UNSUPPORTED_WORKFLOW_CLAIMS.filter((p) => a.includes(p));
}

/** Safe limitation message to use when no verified UI is registered. */
export const SAFE_NO_UI_VERIFIED_MESSAGE =
  "Exact click-by-click steps for this action are not in BTPM Guide's verified UI registry yet. " +
  "Open the relevant page in BTPM and check the on-screen controls. " +
  "If you cannot find the control, ask a Workspace Admin or product owner to confirm whether this is enabled in your workspace.";
