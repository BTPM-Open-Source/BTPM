// AI-GUIDE.V2.GUIDE-MODE.0.7F — End-to-end semantic selection tests.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { extractWorkflowFrame } from "../../../functions/_shared/ai-guide-v2/workflow-frame.ts";
import { buildCatalog, dispatchFromMatch, findCompatible, type KcWorkflowDoc } from "../../../functions/_shared/ai-guide-v2/workflow-catalog.ts";

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
  { slug: "workflow-use-project-calendar" },
  { slug: "workflow-use-project-gantt" },
  { slug: "workflow-use-my-work" },
  { slug: "workflow-use-roadmap" },
];
const CAT = buildCatalog(KC);

function pick(q: string) {
  const f = extractWorkflowFrame(q);
  const m = findCompatible(f, CAT);
  const d = dispatchFromMatch(f, m);
  return { f, d };
}
function expectSlug(q: string, slug: string) {
  const { d } = pick(q);
  assert(d.kind === "verified_workflow", `${q} -> ${d.kind}`);
  if (d.kind === "verified_workflow") assertEquals(d.entry.workflow_slug, slug, `${q}`);
}

Deno.test("0.7F blank project — start phrasing", () => {
  expectSlug("I need to start a blank project. Where do I do that?", "workflow-create-blank-project");
});
Deno.test("0.7F blank project — from scratch", () => {
  expectSlug("Where do I click to create a project from scratch?", "workflow-create-blank-project");
});
Deno.test("0.7F create-from-template — implementation template", () => {
  expectSlug("We have a standard implementation template. How do I use it to create a new project?", "workflow-create-project-from-template");
});
Deno.test("0.7F create-from-template — reuse existing", () => {
  expectSlug("I want to reuse an existing project template. How do I start a project from it?", "workflow-create-project-from-template");
});
Deno.test("0.7F add task to phase", () => {
  expectSlug("How do I add a task to a phase?", "workflow-add-task-to-phase");
});
Deno.test("0.7F complete task — mark it done", () => {
  expectSlug("I finished my task. Where do I mark it done?", "workflow-complete-task");
});
Deno.test("0.7F reopen task", () => {
  expectSlug("I marked a task complete too early. How do I reopen it?", "workflow-reopen-task");
});
Deno.test("0.7F execution update — record what changed today", () => {
  expectSlug("I want to record what changed today on a task. Where should I put it?", "workflow-add-execution-update");
});
Deno.test("0.7F dependency — task after another", () => {
  expectSlug("I need one task to happen after another. Where do I set that?", "workflow-add-dependency");
});
Deno.test("0.7F dependency — phase dependent on phase", () => {
  expectSlug("How do I make one phase dependent on another phase?", "workflow-add-dependency");
});
Deno.test("0.7F blocker bare — clarification", () => {
  const { d } = pick("How do I add a blocker?");
  assertEquals(d.kind, "clarification_needed");
});
Deno.test("0.7F project-level blocker", () => {
  expectSlug("I have a project-level blocker. Where do I add it?", "workflow-create-project-blocker");
});
Deno.test("0.7F task blocker — stopping my task", () => {
  expectSlug("Something is stopping my task. Where do I record that?", "workflow-add-task-or-phase-blocker");
});
Deno.test("0.7F resolve blocker", () => {
  expectSlug("How do I resolve a blocker?", "workflow-resolve-blocker");
});
Deno.test("0.7F governance cadence — SteerCo every two weeks", () => {
  expectSlug("I want this project to have a SteerCo every two weeks. Where do I set that expectation?", "workflow-create-governance-cadence");
});
Deno.test("0.7F governance evidence — had the SteerCo today", () => {
  expectSlug("We had the SteerCo today. Where do I attach or record the evidence?", "workflow-record-governance-evidence");
});
Deno.test("0.7F SharePoint connect", () => {
  expectSlug("How do I connect a project to SharePoint?", "workflow-connect-project-sharepoint-folder");
});
Deno.test("0.7F SharePoint disconnect", () => {
  expectSlug("How do I disconnect a SharePoint folder from a project?", "workflow-disconnect-project-sharepoint-folder");
});
Deno.test("0.7F action refusal — can you mark my task complete", () => {
  const { d } = pick("Can you mark my task complete?");
  assertEquals(d.kind, "action_refusal");
});
Deno.test("0.7F action refusal — connect this project to SharePoint for me", () => {
  const { d } = pick("Connect this project to SharePoint for me.");
  assertEquals(d.kind, "action_refusal");
});
Deno.test("0.7F helper guard — blank project does not pick calendar", () => {
  const { d } = pick("I need to start a blank project. Where do I do that?");
  assert(d.kind === "verified_workflow");
  if (d.kind === "verified_workflow") {
    assert(d.entry.workflow_slug !== "workflow-use-project-calendar");
  }
});
Deno.test("0.7F helper guard — mark done does not pick my-work", () => {
  const { d } = pick("I finished my task. Where do I mark it done?");
  assert(d.kind === "verified_workflow");
  if (d.kind === "verified_workflow") {
    assert(d.entry.workflow_slug !== "workflow-use-my-work");
  }
});
Deno.test("0.7F helper guard — SteerCo cadence does not pick calendar", () => {
  const { d } = pick("I want this project to have a SteerCo every two weeks. Where do I set that expectation?");
  assert(d.kind === "verified_workflow");
  if (d.kind === "verified_workflow") {
    assert(d.entry.workflow_slug !== "workflow-use-project-calendar");
  }
});
Deno.test("0.7F define KPI", () => {
  expectSlug("How do I add a KPI to a project?", "workflow-define-kpi");
});

// 0.7H — same_family_matches surface for clarification (conceptual fix for
// "How do I create a blocker" returning false 'no verified workflow' refusal).
Deno.test("0.7H bare blocker clarification surfaces same-family verified workflows", () => {
  const { d } = pick("How do I create a blocker");
  assert(d.kind === "clarification_needed", `got ${d.kind}`);
  if (d.kind === "clarification_needed") {
    const slugs = d.same_family_matches.map((c) => c.workflow_slug).sort();
    assertEquals(slugs, [
      "workflow-add-task-or-phase-blocker",
      "workflow-create-project-blocker",
    ]);
  }
});
