// AI-GUIDE.V2.GUIDE-MODE.0.7G — Final routing/planner enforcement tests.
//
// These tests are intentionally scoped to deterministic layers
// (workflow-frame + workflow-catalog dispatch). They lock in:
//   - Assistant-action requests always become action_refusal at the gate.
//   - Workflow gaps (My Work, files, status deck, backlog→sprint, workspace
//     role, project access, governance cadence vs evidence) select the right
//     verified slug.
//   - Ambiguous pronoun/status/note questions produce clarification_needed.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { extractWorkflowFrame } from "../../../functions/_shared/ai-guide-v2/workflow-frame.ts";
import {
  buildCatalog,
  dispatchFromMatch,
  findCompatible,
  type KcWorkflowDoc,
} from "../../../functions/_shared/ai-guide-v2/workflow-catalog.ts";

const KC: KcWorkflowDoc[] = [
  { slug: "workflow-create-blank-project" },
  { slug: "workflow-create-project-from-template" },
  { slug: "workflow-save-project-as-template" },
  { slug: "workflow-create-program" },
  { slug: "workflow-edit-project-overview" },
  { slug: "workflow-add-phase" },
  { slug: "workflow-edit-phase-plan" },
  { slug: "workflow-add-task-to-phase" },
  { slug: "workflow-edit-task-plan" },
  { slug: "workflow-complete-task" },
  { slug: "workflow-reopen-task" },
  { slug: "workflow-add-execution-update" },
  { slug: "workflow-add-comment" },
  { slug: "workflow-add-dependency" },
  { slug: "workflow-create-project-blocker" },
  { slug: "workflow-add-task-or-phase-blocker" },
  { slug: "workflow-resolve-blocker" },
  { slug: "workflow-define-kpi" },
  { slug: "workflow-record-kpi-update" },
  { slug: "workflow-create-governance-cadence" },
  { slug: "workflow-record-governance-evidence" },
  { slug: "workflow-connect-project-sharepoint-folder" },
  { slug: "workflow-disconnect-project-sharepoint-folder" },
  { slug: "workflow-manage-sharepoint-files" },
  { slug: "workflow-use-files-module" },
  { slug: "workflow-use-project-calendar" },
  { slug: "workflow-use-project-gantt" },
  { slug: "workflow-use-my-work" },
  { slug: "workflow-use-roadmap" },
  { slug: "workflow-enable-agile-mode" },
  { slug: "workflow-create-sprint" },
  { slug: "workflow-create-backlog-item" },
  { slug: "workflow-assign-backlog-item-to-sprint" },
  { slug: "workflow-use-agile-board" },
  { slug: "workflow-manage-workspace-members" },
  { slug: "workflow-add-workspace-access" },
  { slug: "workflow-manage-project-access" },
  { slug: "workflow-invite-user" },
  { slug: "workflow-generate-project-charter" },
  { slug: "workflow-generate-project-status-deck" },
  { slug: "workflow-generate-roadmap-status-deck" },
];
const CAT = buildCatalog(KC);

function pick(q: string) {
  const f = extractWorkflowFrame(q);
  const m = findCompatible(f, CAT);
  const d = dispatchFromMatch(f, m);
  return { f, d };
}

function expectActionRefusal(q: string) {
  const { d } = pick(q);
  assertEquals(d.kind, "action_refusal", `${q} -> ${d.kind}`);
}

function expectClarification(q: string) {
  const { d } = pick(q);
  assertEquals(d.kind, "clarification_needed", `${q} -> ${d.kind}`);
}

function expectSlug(q: string, slug: string) {
  const { d } = pick(q);
  assert(d.kind === "verified_workflow", `${q} -> ${d.kind}`);
  if (d.kind === "verified_workflow") {
    assertEquals(d.entry.workflow_slug, slug, q);
  }
}

// ---------- Terminal action-refusal enforcement ----------
Deno.test("0.7G action — can you create a blocker for this task", () => {
  expectActionRefusal("Can you create a blocker for this task?");
});
Deno.test("0.7G action — give Maria admin access", () => {
  expectActionRefusal("Give Maria admin access.");
});
Deno.test("0.7G action — remove this person from the workspace", () => {
  expectActionRefusal("Remove this person from the workspace.");
});
Deno.test("0.7G action — can you turn Agile mode on for this project", () => {
  expectActionRefusal("Can you turn Agile mode on for this project?");
});
Deno.test("0.7G action — export this project to Excel", () => {
  expectActionRefusal("Export this project to Excel.");
});

// ---------- Workflow gap fixes ----------
Deno.test("0.7G my work — what I need to work on", () => {
  expectSlug("I just want to see what I need to work on. Where do I go?", "workflow-use-my-work");
});
Deno.test("0.7G backlog to sprint", () => {
  expectSlug("How do I add backlog items to a sprint?", "workflow-assign-backlog-item-to-sprint");
});
Deno.test("0.7G status deck — for tomorrow's meeting", () => {
  expectSlug("I need a status deck for tomorrow's meeting. Where do I create it?", "workflow-generate-project-status-deck");
});

// ---------- Governance distinction ----------
Deno.test("0.7G governance cadence still selects cadence workflow", () => {
  expectSlug(
    "I want this project to have a SteerCo every two weeks. Where do I set that expectation?",
    "workflow-create-governance-cadence",
  );
});
Deno.test("0.7G governance evidence still selects evidence workflow", () => {
  expectSlug(
    "We had the SteerCo today. Where do I attach or record the evidence?",
    "workflow-record-governance-evidence",
  );
});

// ---------- Ambiguity clarification ----------
Deno.test("0.7G ambiguous — where do I update it", () => {
  expectClarification("Where do I update it?");
});
Deno.test("0.7G ambiguous — where do I add a note", () => {
  expectClarification("Where do I add a note?");
});
Deno.test("0.7G ambiguous — how do I update status", () => {
  expectClarification("How do I update status?");
});

// ---------- Helper guards ----------
Deno.test("0.7G upload file does not select blank project", () => {
  const { d } = pick("How do I upload a file to a project?");
  if (d.kind === "verified_workflow") {
    assert(
      d.entry.workflow_slug !== "workflow-create-blank-project",
      `picked ${d.entry.workflow_slug}`,
    );
  }
});
Deno.test("0.7G my work does not select sharepoint files", () => {
  const { d } = pick("I just want to see what I need to work on. Where do I go?");
  if (d.kind === "verified_workflow") {
    assert(
      d.entry.workflow_slug !== "workflow-manage-sharepoint-files",
      `picked ${d.entry.workflow_slug}`,
    );
  }
});
Deno.test("0.7G backlog→sprint does not pick create-sprint", () => {
  const { d } = pick("How do I add backlog items to a sprint?");
  if (d.kind === "verified_workflow") {
    assert(
      d.entry.workflow_slug !== "workflow-create-sprint",
      `picked ${d.entry.workflow_slug}`,
    );
  }
});
Deno.test("0.7G status deck does not pick create backlog item", () => {
  const { d } = pick("I need a status deck for tomorrow's meeting. Where do I create it?");
  if (d.kind === "verified_workflow") {
    assert(
      d.entry.workflow_slug !== "workflow-create-backlog-item",
      `picked ${d.entry.workflow_slug}`,
    );
  }
});
