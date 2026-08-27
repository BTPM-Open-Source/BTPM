// AI-GUIDE.V2.3 — Verified Workflow Registry v2.
//
// Clean V2 registry. MUST NOT import from src/data/btpmGuideUiActionRegistry.ts
// or from any v1 ai-help-chat runtime. Workflow records here are the ONLY
// source from which V2 may later render procedural steps. GPT must never
// invent steps that are not in this registry.

import type { GuideV2WorkflowRecord, GuideV2WorkflowStatus } from "./types.ts";

const REGISTRY: GuideV2WorkflowRecord[] = [
  {
    workflow_id: "add_dependency",
    title: "Add a dependency between work items",
    feature_area: "dependencies",
    status: "verified",
    route_patterns: [
      "/projects/:projectId",
      "/projects/:projectId/phases/:phaseId",
      "/projects/:projectId/tasks/:taskId",
      "/projects/:projectId/board",
      "/projects/:projectId/backlog",
    ],
    path: ["Project", "Open Task / Phase / Project Overview", "Dependencies panel"],
    steps: [
      {
        order: 1,
        instruction: "Open the Task, Phase, or Project Overview where you want to add the dependency.",
        expected_result: "The detail page opens with side panels visible.",
      },
      {
        order: 2,
        instruction: "Open the Dependencies panel on the detail page. In this flow the dependency is added under 'Blocked by'.",
        ui_control: "Dependencies panel",
      },
      {
        order: 3,
        instruction: "Use the predecessor dropdown to pick the same-level item that must finish first.",
        ui_control: "Predecessor dropdown",
      },
      {
        order: 4,
        instruction: "Click 'Blocked by' to add the dependency.",
        ui_control: "Blocked by",
        expected_result: "The created dependency appears under 'Blocked by' with an FS (Finish-to-Start) badge.",
      },
      {
        order: 5,
        instruction: "If you have edit permission, remove a dependency using the X icon next to it.",
        ui_control: "X icon",
      },
    ],
    not_supported: [
      "Creating or editing dependencies from the Gantt view — Gantt displays arrows only.",
      "Cross-level dependencies (e.g. Task ↔ Phase across different parents) are not supported in v1.",
    ],
    permission_notes: [
      "Requires project planning/edit permission. If the panel is read-only, ask a Workspace Admin.",
    ],
    if_missing_control:
      "If the Dependencies panel or 'Blocked by' button is missing, you likely have read-only access — request edit permission from a Workspace Admin.",
    next_suggestions: [
      "View the dependency in the Gantt view as a Finish-to-Start arrow (read-only).",
      "Open the predecessor item to confirm its planned finish date.",
    ],
    source_articles: ["how-to-add-a-dependency", "dependencies-rulebook"],
    verification_source: "AI-GUIDE.V2.3 manual UI verification against current dependency panel.",
    last_verified_step: "2026-05-21",
  },
  {
    workflow_id: "approved_baseline_date_change",
    title: "Change approved baseline dates (rebaseline)",
    feature_area: "baseline",
    status: "verified",
    route_patterns: [
      "/projects/:projectId",
      "/projects/:projectId/overview",
    ],
    path: ["Project", "Project Overview", "Baseline section"],
    steps: [
      {
        order: 1,
        instruction: "Open the project and update the current plan (dates on phases/tasks) using the normal planning pages.",
        expected_result: "The current plan reflects the new intended dates.",
      },
      {
        order: 2,
        instruction: "Record or confirm the governance reason for the rebaseline (per your project's governance policy).",
      },
      {
        order: 3,
        instruction: "Open Project Overview and locate the Baseline section.",
        ui_control: "Baseline section",
      },
      {
        order: 4,
        instruction: "Use 'Rebaseline' to overwrite the approved baseline with the current planned dates.",
        ui_control: "Rebaseline",
        expected_result: "The approved baseline is replaced with the current plan and a baseline history entry is recorded.",
      },
    ],
    not_supported: [
      "There is no Baseline Settings page.",
      "Approved baseline dates cannot be edited one-by-one in place.",
      "There is no per-date baseline editor.",
      "Running a parallel second baseline alongside the existing baseline is not supported.",
      "Previous baselines are NOT recoverable after rebaseline.",
    ],
    permission_notes: [
      "Requires appropriate project/admin permission to rebaseline. If you don't see Rebaseline, ask a Workspace Admin.",
    ],
    if_missing_control:
      "If the Rebaseline control is not visible, your role does not permit baseline changes — contact a Workspace Admin.",
    next_suggestions: [
      "Review the baseline history entry to confirm the rebaseline was recorded.",
      "Communicate the rebaseline to stakeholders per governance policy.",
    ],
    source_articles: ["project-baseline-vs-current-plan"],
    verification_source: "AI-GUIDE.V2.3 manual verification against current Project Overview baseline flow.",
    last_verified_step: "2026-05-21",
  },

  // ---- Unverified workflows (no procedural steps until verified) ----
  unverifiedStub("update_kpi_value", "Update a KPI value", "kpi", [
    "Workflow details depend on KPI type (manual vs automatic) and KPI App readiness.",
    "Do not provide click-by-click steps until verified.",
  ]),
  unverifiedStub("record_governance_evidence", "Record governance evidence", "governance", [
    "Exact control path not fully verified.",
    "Do not invent exact button or control names.",
  ]),
  unverifiedStub("create_blank_project", "Create a blank project", "projects", [
    "Project creation UI not re-verified for V2.",
    "Do not invent buttons (e.g. 'Blank') until verified against current UI.",
  ]),
  unverifiedStub("create_project_from_template", "Create a project from a template", "projects", [
    "Template selection UI not re-verified for V2.",
  ]),
  unverifiedStub("generate_project_status_deck", "Generate a project status deck", "reporting", [
    "Exact UI path for project status deck not re-verified for V2.",
  ]),
  unverifiedStub("generate_roadmap_status_deck", "Generate a roadmap status deck", "roadmap", [
    "Exact UI path for roadmap status deck not re-verified for V2.",
  ]),
  unverifiedStub("connect_project_sharepoint_folder", "Connect a project SharePoint folder", "sharepoint", [
    "Exact UI path not re-verified for V2.",
  ]),
  unverifiedStub("setup_sharepoint_admin", "Set up SharePoint at the admin level", "sharepoint", [
    "Exact admin UI path not re-verified for V2.",
  ]),
  unverifiedStub("manage_project_access", "Manage project-level access", "access", [
    "Exact UI path not re-verified for V2.",
  ]),
  unverifiedStub("invite_user", "Invite a user to the organization", "access", [
    "Exact admin UI path not re-verified for V2.",
  ]),
];

function unverifiedStub(
  workflow_id: string,
  title: string,
  feature_area: string,
  notes: string[],
): GuideV2WorkflowRecord {
  return {
    workflow_id,
    title,
    feature_area,
    status: "unverified",
    route_patterns: [],
    path: [],
    steps: [],
    not_supported: notes,
    permission_notes: [],
    if_missing_control:
      "This workflow is not verified for V2 — no exact click-by-click guidance is available.",
    next_suggestions: [],
    source_articles: [],
    verification_source: "not_verified",
    last_verified_step: "n/a",
  };
}

export function listWorkflowsByStatus(status: GuideV2WorkflowStatus): GuideV2WorkflowRecord[] {
  return REGISTRY.filter((w) => w.status === status);
}

export function listVerifiedWorkflows(): GuideV2WorkflowRecord[] {
  return listWorkflowsByStatus("verified");
}

export function findWorkflowById(id: string | null | undefined): GuideV2WorkflowRecord | null {
  if (!id) return null;
  return REGISTRY.find((w) => w.workflow_id === id) ?? null;
}

export function findWorkflowsByFeatureArea(area: string): GuideV2WorkflowRecord[] {
  return REGISTRY.filter((w) => w.feature_area === area);
}

export function listAllWorkflows(): GuideV2WorkflowRecord[] {
  return REGISTRY.slice();
}
