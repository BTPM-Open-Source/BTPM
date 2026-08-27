// AI-GUIDE.V2.GUIDE-MODE.0.9E — Workflow frame specificity + unknown-frame
// dispatch guard tests.

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
  { slug: "workflow-create-program" },
  { slug: "workflow-add-phase" },
  { slug: "workflow-add-task-to-phase" },
  { slug: "workflow-complete-task" },
  { slug: "workflow-reopen-task" },
  { slug: "workflow-add-execution-update" },
  { slug: "workflow-add-comment" },
  { slug: "workflow-record-kpi-update" },
  { slug: "workflow-define-kpi" },
  { slug: "workflow-use-roadmap" },
  { slug: "workflow-use-my-work" },
  {
    slug: "workflow-kpi-app-report-now",
    workflow_metadata: {
      object_family: "kpi_app",
      action: "generate",
      selection_terms: ["kpi app report now", "submit kpi payload", "kpi app payload"],
    },
  },
];
const CAT = buildCatalog(KC);

function pick(q: string) {
  const f = extractWorkflowFrame(q);
  const m = findCompatible(f, CAT);
  const d = dispatchFromMatch(f, m);
  return { f, d };
}

Deno.test("0.9E Fix A — 'how can I report progress update?' frame is execution_update/create", () => {
  const { f, d } = pick("how can I report progress update?");
  assertEquals(f.object_family, "execution_update");
  assertEquals(f.action, "create");
  assertEquals(f.target_object, "execution_update");
  assert(d.kind === "verified_workflow", `expected verified, got ${d.kind}`);
  if (d.kind === "verified_workflow") {
    assertEquals(d.entry.workflow_slug, "workflow-add-execution-update");
  }
});

Deno.test("0.9E Fix A — 'where do I add an execution update?' selects add-execution-update", () => {
  const { d } = pick("Where do I add an execution update?");
  assert(d.kind === "verified_workflow");
  if (d.kind === "verified_workflow") {
    assertEquals(d.entry.workflow_slug, "workflow-add-execution-update");
  }
});

Deno.test("0.9E Fix A — 'I did something which contributes to the project' does not select create-project/task", () => {
  const { d } = pick("I did something which contributes to the project, how shall I report it?");
  assert(d.kind === "verified_workflow", `expected verified, got ${d.kind}`);
  if (d.kind === "verified_workflow") {
    assert(
      ![
        "workflow-create-blank-project",
        "workflow-create-project-from-template",
        "workflow-create-program",
        "workflow-add-task-to-phase",
      ].includes(d.entry.workflow_slug),
      `got ${d.entry.workflow_slug}`,
    );
    assertEquals(d.entry.workflow_slug, "workflow-add-execution-update");
  }
});

Deno.test("0.9E Fix B — 'guide me through the main workflows in the app' does NOT select KPI App Report Now", () => {
  const { d } = pick("guide me through the main workflows in the app");
  // Either clarification or NOT a verified KPI app workflow.
  if (d.kind === "verified_workflow") {
    assert(
      d.entry.workflow_slug !== "workflow-kpi-app-report-now",
      `unknown frame should not pick KPI App Report Now, got ${d.entry.workflow_slug}`,
    );
  } else {
    assertEquals(d.kind, "clarification_needed");
  }
});

Deno.test("0.9E Fix B — 'what are the main workflows in BTPM?' routes to clarification, not a single workflow", () => {
  const { d } = pick("what are the main workflows in BTPM?");
  if (d.kind === "verified_workflow") {
    assert(
      d.entry.workflow_slug !== "workflow-kpi-app-report-now",
      `got ${d.entry.workflow_slug}`,
    );
  } else {
    assertEquals(d.kind, "clarification_needed");
  }
});

Deno.test("0.9E — KPI App Report Now still works for explicit KPI App questions", () => {
  const { d } = pick("How do I run KPI App Report Now?");
  assert(d.kind === "verified_workflow");
  if (d.kind === "verified_workflow") {
    assertEquals(d.entry.workflow_slug, "workflow-kpi-app-report-now");
  }
});

Deno.test("0.9E — 'How do I submit KPI App payload?' selects KPI App Report Now", () => {
  const { d } = pick("How do I submit KPI App payload?");
  assert(d.kind === "verified_workflow");
  if (d.kind === "verified_workflow") {
    assertEquals(d.entry.workflow_slug, "workflow-kpi-app-report-now");
  }
});

Deno.test("0.9E — explicit create-blank-project still works", () => {
  const { d } = pick("How do I create a blank project?");
  assert(d.kind === "verified_workflow");
  if (d.kind === "verified_workflow") {
    assertEquals(d.entry.workflow_slug, "workflow-create-blank-project");
  }
});

Deno.test("0.9E — explicit create-from-template still works", () => {
  const { d } = pick("How do I create a project from a template?");
  assert(d.kind === "verified_workflow");
  if (d.kind === "verified_workflow") {
    assertEquals(d.entry.workflow_slug, "workflow-create-project-from-template");
  }
});

Deno.test("0.9E — explicit add-task-to-phase still works", () => {
  const { d } = pick("How do I add a task to a phase?");
  assert(d.kind === "verified_workflow");
  if (d.kind === "verified_workflow") {
    assertEquals(d.entry.workflow_slug, "workflow-add-task-to-phase");
  }
});

Deno.test("0.9E — KPI value update phrasing still routes to record-kpi-update", () => {
  const { d } = pick("How do I update the KPI value this week?");
  assert(d.kind === "verified_workflow");
  if (d.kind === "verified_workflow") {
    assertEquals(d.entry.workflow_slug, "workflow-record-kpi-update");
  }
});

// Note: "comment or execution update" decision-question routing is left
// to the answer planner / concept guidance layer and not enforced here.

