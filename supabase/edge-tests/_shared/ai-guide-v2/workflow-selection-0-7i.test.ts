// AI-GUIDE.V2.GUIDE-MODE.0.7I — Generated-artifact constraint guardrail.
//
// Locks in:
//   - Generic PowerPoint/PPT/report wording does NOT select Project Charter.
//     Either no verified workflow, or clarification, but never charter.
//   - Project Charter requires explicit charter wording.
//   - Project Status Deck and Roadmap Status Deck routing keeps working.
//   - Power BI is only chosen when explicitly mentioned.

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
  { slug: "workflow-edit-project-overview" },
  { slug: "workflow-define-kpi" },
  { slug: "workflow-record-kpi-update" },
  { slug: "workflow-generate-project-charter" },
  { slug: "workflow-generate-project-status-deck" },
  { slug: "workflow-generate-roadmap-status-deck" },
  { slug: "workflow-configure-power-bi-admin" },
];
const CAT = buildCatalog(KC);

function pick(q: string) {
  const f = extractWorkflowFrame(q);
  const m = findCompatible(f, CAT);
  const d = dispatchFromMatch(f, m);
  return { f, m, d };
}

function selectedSlug(q: string): string | null {
  const { d } = pick(q);
  return d.kind === "verified_workflow" ? d.entry.workflow_slug : null;
}

// ---------- Group A — Project Charter guardrail ----------

Deno.test("0.7I generic PowerPoint report must not select charter", () => {
  const { f, d } = pick("How do I export a PowerPoint report?");
  assertEquals(f.generated_artifact_type, "generic_generated_document");
  assert(d.kind !== "verified_workflow" || d.entry.workflow_slug !== "workflow-generate-project-charter");
  // Should clarify, not silently pick a single workflow.
  assert(d.kind === "clarification_needed", `expected clarification, got ${d.kind}`);
});

Deno.test("0.7I generic PPT report must not select charter", () => {
  const { f, d } = pick("How do I generate a PPT report?");
  assertEquals(f.generated_artifact_type, "generic_generated_document");
  assertEquals(d.kind, "clarification_needed");
});

Deno.test("0.7I generic 'Where do I create a PowerPoint?' must not select charter", () => {
  const { d } = pick("Where do I create a PowerPoint?");
  assert(d.kind !== "verified_workflow" || d.entry.workflow_slug !== "workflow-generate-project-charter");
});

Deno.test("0.7I generic 'How do I create a deck?' must not select charter", () => {
  const { d } = pick("How do I create a deck?");
  assert(d.kind !== "verified_workflow" || d.entry.workflow_slug !== "workflow-generate-project-charter");
});

// ---------- Group B — Charter still works ----------

Deno.test("0.7I explicit charter selects charter", () => {
  assertEquals(selectedSlug("How do I generate a project charter?"), "workflow-generate-project-charter");
});

Deno.test("0.7I 'What should I update before generating a charter?' selects charter (not KPI update)", () => {
  const slug = selectedSlug("What should I update before generating a charter?");
  assertEquals(slug, "workflow-generate-project-charter");
});

// ---------- Group C — Project status deck still works ----------

Deno.test("0.7I project status PPT", () => {
  assertEquals(
    selectedSlug("How do I generate a project status PPT?"),
    "workflow-generate-project-status-deck",
  );
});

Deno.test("0.7I weekly project status deck", () => {
  assertEquals(
    selectedSlug("How do I generate a weekly project status deck?"),
    "workflow-generate-project-status-deck",
  );
});

Deno.test("0.7I status deck for tomorrow's meeting", () => {
  // Acceptable: project status deck OR clarification. Must not be charter.
  const { d } = pick("I need a status deck for tomorrow's meeting. Where do I create it?");
  if (d.kind === "verified_workflow") {
    assert(d.entry.workflow_slug !== "workflow-generate-project-charter");
    assertEquals(d.entry.workflow_slug, "workflow-generate-project-status-deck");
  } else {
    assertEquals(d.kind, "clarification_needed");
  }
});

// ---------- Group D — Roadmap deck still works ----------

Deno.test("0.7I one PPT for several projects -> roadmap deck", () => {
  assertEquals(
    selectedSlug("How do I generate one PPT for several projects?"),
    "workflow-generate-roadmap-status-deck",
  );
});

Deno.test("0.7I PowerPoint report for several projects -> roadmap deck", () => {
  assertEquals(
    selectedSlug("How do I generate a PowerPoint report for several projects?"),
    "workflow-generate-roadmap-status-deck",
  );
});

Deno.test("0.7I PowerPoint report for multiple projects -> roadmap deck", () => {
  assertEquals(
    selectedSlug("How do I generate a PowerPoint report for multiple projects?"),
    "workflow-generate-roadmap-status-deck",
  );
});

Deno.test("0.7I roadmap status deck explicit", () => {
  assertEquals(
    selectedSlug("How do I generate a roadmap status deck?"),
    "workflow-generate-roadmap-status-deck",
  );
});

// ---------- Group E — Power BI explicit-only ----------

Deno.test("0.7I generic PowerPoint does not flip to Power BI", () => {
  const { f } = pick("How do I export a PowerPoint report?");
  assertEquals(f.object_family, "export");
});

Deno.test("0.7I explicit Power BI keeps power_bi family", () => {
  const { f } = pick("How do I configure a Power BI workspace for BTPM?");
  assertEquals(f.object_family, "power_bi");
});
