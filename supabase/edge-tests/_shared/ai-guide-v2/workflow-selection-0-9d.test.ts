// AI-GUIDE.V2.GUIDE-MODE.0.9D — Progress/contribution reporting guardrail tests.
//
// Confirms that semantically reporting-intent questions route to the
// execution-update workflow and NEVER to project/program/task creation or to
// an unsupported-safe-guidance verdict, while explicit create-of-project/task
// requests are preserved.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  extractWorkflowFrame,
  isProgressReportingIntent,
  PROGRESS_REPORTING_INTENT_RE,
  EXPLICIT_CREATE_PROJECT_OR_TASK_RE,
} from "../../../functions/_shared/ai-guide-v2/workflow-frame.ts";
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
  { slug: "workflow-use-roadmap" },
  { slug: "workflow-use-my-work" },
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
  if (d.kind === "verified_workflow") assertEquals(d.entry.workflow_slug, slug, q);
}

Deno.test("0.9D regex — reporting intent matches common phrasings", () => {
  assert(PROGRESS_REPORTING_INTENT_RE.test("how can I report my progress"));
  assert(PROGRESS_REPORTING_INTENT_RE.test("where do I add an execution update"));
  assert(PROGRESS_REPORTING_INTENT_RE.test("I did some work on a task and want to log it"));
  assert(PROGRESS_REPORTING_INTENT_RE.test("how do I tell stakeholders what I finished"));
});

Deno.test("0.9D regex — explicit create-project/task is not progress reporting", () => {
  assert(!isProgressReportingIntent("create a new project from scratch"));
  assert(!isProgressReportingIntent("add a task to this phase"));
  assert(EXPLICIT_CREATE_PROJECT_OR_TASK_RE.test("create a new project"));
  assert(EXPLICIT_CREATE_PROJECT_OR_TASK_RE.test("add a task to the phase"));
});

Deno.test("0.9D — 'how can I report my progress' → execution-update workflow", () => {
  expectSlug("How can I report my progress?", "workflow-add-execution-update");
});

Deno.test("0.9D — 'where do I record what changed this week' → execution-update", () => {
  expectSlug("Where do I record what changed this week?", "workflow-add-execution-update");
});

Deno.test("0.9D — 'I just finished work on a task' → execution-update (not complete-task)", () => {
  // "I just finished" reads as a reporting intent. complete-task requires
  // a "mark/complete the task" verb pattern, not a contribution narrative.
  expectSlug("I just finished some work on a task. How do I share that?", "workflow-add-execution-update");
});

Deno.test("0.9D — reporting intent with project mention does NOT route to create-project", () => {
  const { d } = pick("I contributed to this project. How can I report progress?");
  assert(d.kind === "verified_workflow", `expected verified workflow, got ${d.kind}`);
  if (d.kind === "verified_workflow") {
    assert(
      d.entry.workflow_slug !== "workflow-create-blank-project" &&
      d.entry.workflow_slug !== "workflow-create-project-from-template" &&
      d.entry.workflow_slug !== "workflow-create-program",
      `must not route to create-project family, got ${d.entry.workflow_slug}`,
    );
    assertEquals(d.entry.workflow_slug, "workflow-add-execution-update");
  }
});

Deno.test("0.9D — reporting intent with task mention does NOT route to add-task-to-phase", () => {
  const { d } = pick("I did some work on a task today. Where do I report that?");
  assert(d.kind === "verified_workflow", `expected verified workflow, got ${d.kind}`);
  if (d.kind === "verified_workflow") {
    assert(
      d.entry.workflow_slug !== "workflow-add-task-to-phase" &&
      d.entry.workflow_slug !== "workflow-complete-task",
      `must not route to task-create/complete, got ${d.entry.workflow_slug}`,
    );
    assertEquals(d.entry.workflow_slug, "workflow-add-execution-update");
  }
});

Deno.test("0.9D — explicit 'create a project' still routes to create-blank-project", () => {
  expectSlug("Where do I click to create a project from scratch?", "workflow-create-blank-project");
});

Deno.test("0.9D — explicit 'add a task to a phase' still routes to add-task-to-phase", () => {
  expectSlug("How do I add a task to a phase?", "workflow-add-task-to-phase");
});

Deno.test("0.9D — KPI value update phrasing preserved (not hijacked by guardrail)", () => {
  // 'update the kpi value' is preserved as KPI value update, not execution update.
  expectSlug("How do I update the KPI value this week?", "workflow-record-kpi-update");
});

Deno.test("0.9D — reporting intent never produces 'no verified workflow'", () => {
  const inputs = [
    "How can I report my contribution?",
    "Where do I submit my weekly status update?",
    "I helped move things forward — how do I show that?",
    "How shall I report progress on this?",
  ];
  for (const q of inputs) {
    const { d } = pick(q);
    assert(
      d.kind === "verified_workflow",
      `progress-reporting question '${q}' produced ${d.kind}, expected verified_workflow`,
    );
  }
});
