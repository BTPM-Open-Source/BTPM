// Deno tests for workflow-catalog semantic gate.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { extractWorkflowFrame } from "../../../functions/_shared/ai-guide-v2/workflow-frame.ts";
import {
  buildCatalog,
  dispatchFromMatch,
  findCompatible,
  type KcWorkflowDoc,
} from "../../../functions/_shared/ai-guide-v2/workflow-catalog.ts";

// Minimal stand-in for the live KC corpus. Each entry mirrors the seed
// pack: only slug + body are required for the slug-inference path.
const KC_DOCS: KcWorkflowDoc[] = [
  { slug: "workflow-create-project-from-template" },
  { slug: "workflow-save-project-as-template" },
  { slug: "workflow-create-blank-project" },
  { slug: "workflow-create-program" },
  { slug: "workflow-edit-project-overview" },
  { slug: "workflow-define-kpi" },
  { slug: "workflow-record-kpi-update" },
  { slug: "workflow-create-governance-cadence" },
  { slug: "workflow-record-governance-evidence" },
  { slug: "workflow-edit-phase-plan" },
  { slug: "workflow-add-task-to-phase" },
  { slug: "workflow-create-project-blocker" },
  { slug: "workflow-add-task-or-phase-blocker" },
  { slug: "workflow-create-project-risk" },
  { slug: "workflow-enable-agile-mode" },
];

const CATALOG = buildCatalog(KC_DOCS);

Deno.test("catalog buildCatalog populates required fields for known slugs", () => {
  const define = CATALOG.find((c) => c.workflow_slug === "workflow-define-kpi");
  const update = CATALOG.find((c) => c.workflow_slug === "workflow-record-kpi-update");
  assert(define, "define-kpi entry missing");
  assert(update, "record-kpi-update entry missing");
  assertEquals(define!.object_family, "kpi");
  assertEquals(define!.action, "define");
  assertEquals(update!.object_family, "kpi");
  assertEquals(update!.action, "update");
  assertEquals(update!.modifier, "value_update");
});

Deno.test("KPI define vs update — define question rejects record-kpi-update", () => {
  const frame = extractWorkflowFrame("Where do I create a new KPI for the project?");
  const match = findCompatible(frame, CATALOG);
  const allowed = match.supported_matches.map((m) => m.workflow_slug);
  assert(allowed.includes("workflow-define-kpi"), `expected define-kpi in ${JSON.stringify(allowed)}`);
  assert(!allowed.includes("workflow-record-kpi-update"));
});

Deno.test("KPI value update — update question rejects define-kpi", () => {
  const frame = extractWorkflowFrame("Where do I enter this week's KPI value?");
  const match = findCompatible(frame, CATALOG);
  const allowed = match.supported_matches.map((m) => m.workflow_slug);
  assert(allowed.includes("workflow-record-kpi-update"));
  assert(!allowed.includes("workflow-define-kpi"));
});

Deno.test("Program-from-template returns unsupported safe guidance (no project-from-template steps)", () => {
  const frame = extractWorkflowFrame("Can I use a project template to create a program?");
  const match = findCompatible(frame, CATALOG);
  const allowed = match.supported_matches.map((m) => m.workflow_slug);
  // No supported catalog entry should match — both project-from-template
  // (wrong target_object) and create-program (no from_template modifier)
  // are rejected.
  assert(!allowed.includes("workflow-create-project-from-template"));
  assert(!allowed.includes("workflow-create-program"));
  const dispatch = dispatchFromMatch(frame, match);
  assertEquals(dispatch.kind, "unsupported_safe_guidance");
});

Deno.test("Governance evidence — cadence card is rejected when frame asks for evidence", () => {
  const frame = extractWorkflowFrame(
    "We had the SteerCo today. Where do I record the evidence?",
  );
  const match = findCompatible(frame, CATALOG);
  const allowed = match.supported_matches.map((m) => m.workflow_slug);
  assert(allowed.includes("workflow-record-governance-evidence"));
  assert(!allowed.includes("workflow-create-governance-cadence"));
});

Deno.test("Governance cadence — evidence card is rejected when frame asks for cadence", () => {
  const frame = extractWorkflowFrame(
    "How do I set up a recurring SteerCo cadence every two weeks?",
  );
  const match = findCompatible(frame, CATALOG);
  const allowed = match.supported_matches.map((m) => m.workflow_slug);
  assert(allowed.includes("workflow-create-governance-cadence"));
  assert(!allowed.includes("workflow-record-governance-evidence"));
});

Deno.test("Project edit overview is selected for 'Where do I update the basic project details?'", () => {
  const frame = extractWorkflowFrame("Where do I update the basic project details?");
  const match = findCompatible(frame, CATALOG);
  const allowed = match.supported_matches.map((m) => m.workflow_slug);
  assert(allowed.includes("workflow-edit-project-overview"));
});

Deno.test("Phase plan edit is selected for 'How do I update the phase plan?'", () => {
  const frame = extractWorkflowFrame("How do I update the phase plan?");
  const match = findCompatible(frame, CATALOG);
  const allowed = match.supported_matches.map((m) => m.workflow_slug);
  assert(allowed.includes("workflow-edit-phase-plan"));
});

Deno.test("Action request dispatches to action_refusal regardless of catalog matches", () => {
  const frame = extractWorkflowFrame("Create a project for me now.");
  const match = findCompatible(frame, CATALOG);
  const dispatch = dispatchFromMatch(frame, match);
  assertEquals(dispatch.kind, "action_refusal");
});

Deno.test("Ambiguous pronoun dispatches to clarification_needed", () => {
  const frame = extractWorkflowFrame("How do I add one?");
  const match = findCompatible(frame, CATALOG);
  const dispatch = dispatchFromMatch(frame, match);
  assertEquals(dispatch.kind, "clarification_needed");
});
