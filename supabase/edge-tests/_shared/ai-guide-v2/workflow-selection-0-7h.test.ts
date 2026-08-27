// AI-GUIDE.V2.GUIDE-MODE.0.7H — Generated-document / PPT routing tests.
//
// Locks in:
//   - PowerPoint/PPT/deck/charter terms route to generated-document workflows.
//   - Single-project deck → workflow-generate-project-status-deck.
//   - Multi-project / roadmap deck → workflow-generate-roadmap-status-deck.
//   - Project charter → workflow-generate-project-charter.
//   - "What should I update before generating a charter?" does NOT route to
//     workflow-record-kpi-update.
//   - PowerPoint/PPT does not default to Power BI handling.
//
// All deterministic; no LLM, no I/O.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { extractWorkflowFrame } from "../../../functions/_shared/ai-guide-v2/workflow-frame.ts";
import {
  buildCatalog,
  dispatchFromMatch,
  findCompatible,
  type KcWorkflowDoc,
} from "../../../functions/_shared/ai-guide-v2/workflow-catalog.ts";
import { validateGuideV2PipelineInvariants } from "../../../functions/_shared/ai-guide-v2/pipeline-invariants.ts";

const KC: KcWorkflowDoc[] = [
  { slug: "workflow-create-blank-project" },
  { slug: "workflow-edit-project-overview" },
  { slug: "workflow-add-task-to-phase" },
  { slug: "workflow-add-dependency" },
  { slug: "workflow-define-kpi" },
  { slug: "workflow-record-kpi-update" },
  { slug: "workflow-create-governance-cadence" },
  { slug: "workflow-record-governance-evidence" },
  { slug: "workflow-connect-project-sharepoint-folder" },
  { slug: "workflow-manage-sharepoint-files" },
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
  return { f, d };
}

function expectSlug(q: string, slug: string) {
  const { f, d } = pick(q);
  assert(
    d.kind === "verified_workflow",
    `${q} -> ${d.kind} (object_family=${f.object_family} action=${f.action} scope=${f.scope})`,
  );
  if (d.kind === "verified_workflow") {
    assertEquals(d.entry.workflow_slug, slug, q);
  }
}

// ---------- Project status deck (single project) ----------
Deno.test("0.7H project status PPT", () => {
  expectSlug("How do I generate a project status PPT?", "workflow-generate-project-status-deck");
});
Deno.test("0.7H project status deck for tomorrow's meeting", () => {
  expectSlug(
    "I need a status deck for tomorrow's meeting. Where do I create it?",
    "workflow-generate-project-status-deck",
  );
});
Deno.test("0.7H weekly project status deck", () => {
  expectSlug(
    "How do I generate a weekly project status deck?",
    "workflow-generate-project-status-deck",
  );
});

// ---------- Roadmap / multi-project deck ----------
Deno.test("0.7H one PPT for several projects -> roadmap deck", () => {
  expectSlug(
    "How do I generate one PPT for several projects?",
    "workflow-generate-roadmap-status-deck",
  );
});
Deno.test("0.7H PowerPoint report for multiple projects -> roadmap deck", () => {
  expectSlug(
    "How do I generate a PowerPoint report for multiple projects?",
    "workflow-generate-roadmap-status-deck",
  );
});
Deno.test("0.7H roadmap status deck", () => {
  expectSlug(
    "How do I generate a roadmap status deck?",
    "workflow-generate-roadmap-status-deck",
  );
});
Deno.test("0.7H status report for all selected projects -> roadmap deck", () => {
  expectSlug(
    "Where do I create a status report for all selected projects?",
    "workflow-generate-roadmap-status-deck",
  );
});

// ---------- Charter ----------
Deno.test("0.7H project charter", () => {
  expectSlug("How do I generate a project charter?", "workflow-generate-project-charter");
});

// ---------- PowerPoint does NOT default to Power BI ----------
Deno.test("0.7H export PowerPoint report -> not PowerBI", () => {
  const { f, d } = pick("How do I export a PowerPoint report?");
  assertEquals(f.object_family, "export");
  if (d.kind === "verified_workflow") {
    assert(
      d.entry.workflow_slug !== "workflow-configure-power-bi-admin",
      `picked ${d.entry.workflow_slug}`,
    );
  }
});

// ---------- Power BI explicit ----------
Deno.test("0.7H explicit Power BI keeps power_bi family", () => {
  const { f } = pick("How do I configure a Power BI workspace for BTPM?");
  assertEquals(f.object_family, "power_bi");
});

// ---------- charter readiness must not select KPI update ----------
Deno.test("0.7H update before generating charter -> not KPI update", () => {
  const { f, d } = pick("What should I update before generating a charter?");
  // Object family should be export (charter), action generate.
  assertEquals(f.object_family, "export");
  assertEquals(f.action, "generate");
  if (d.kind === "verified_workflow") {
    assert(
      d.entry.workflow_slug !== "workflow-record-kpi-update",
      `picked ${d.entry.workflow_slug}`,
    );
  }
});

// ---------- Pipeline-invariant: SharePoint/PowerPoint source-of-truth ----------
function runInvariant(question: string, finalAnswer: string, situation = "sharepoint_boundary") {
  return validateGuideV2PipelineInvariants({
    question,
    initialClassification: {
      intent_type: "concept",
      feature_area: null,
      workflow_id: null,
      user_goal: question,
      is_user_asking_assistant_to_act: false,
      is_user_asking_for_actual_data: false,
      needs_verified_ui_steps: false,
      confidence: 0.8,
      clarification_needed: false,
    },
    originalDiagnosis: {
      domain_situation: situation,
      canonical_objects: [],
      possible_objects: [],
      not_objects: [],
      core_distinctions: [],
      user_goal_domain: "",
      answer_strategy: "concept_explanation",
      recommended_kc_slugs: ["sharepoint-output-behavior", "generated-documents-in-btpm"],
      retrieval_hints: { feature_areas: [], keywords: [], route_hints: [] },
      workflow_candidates: [],
      needs_verified_ui_steps: false,
      needs_live_data: false,
      asks_assistant_to_act: false,
      safety_notes: [],
      confidence: 0.8,
      diagnosis_source: "llm_structured",
      schema_valid: true,
    },
    arbitration: null,
    reconciledState: null,
    effectivePack: null,
    routingResult: null,
    answerPlan: null,
    renderedAnswer: finalAnswer,
    validation: null,
    finalAnswer,
  });
}

Deno.test("0.7H invariant: PowerPoint in SharePoint must not get dependency fallback", () => {
  // Simulate the buggy LLM output that previously triggered the dependency
  // fallback because it mentioned "automatically update".
  const buggy =
    "The PowerPoint will not automatically update BTPM when you edit it.";
  const r = runInvariant("does editing a PowerPoint in SharePoint update BTPM?", buggy);
  assert(r.hard_block_final_return, "should hard-block and repair");
  assert(
    r.replacement_answer && /source of truth/i.test(r.replacement_answer),
    `replacement missing source of truth wording: ${r.replacement_answer}`,
  );
  assert(
    !/sequencing guidance/i.test(r.replacement_answer ?? ""),
    "must not use dependency fallback",
  );
});

Deno.test("0.7H invariant: dependency question still uses dependency fallback", () => {
  const buggy =
    "Yes, BTPM will automatically move the successor task dates when the predecessor slips.";
  const r = runInvariant(
    "If a predecessor slips, does BTPM automatically move successor dates?",
    buggy,
    "dependency_sequencing",
  );
  assert(r.hard_block_final_return);
  assert(
    /sequencing guidance/i.test(r.replacement_answer ?? ""),
    `expected dependency fallback, got: ${r.replacement_answer}`,
  );
});
