// AI-GUIDE.V2.GUIDE-MODE.0.7C — Resolver dispatch tests.
//
// End-to-end check that the semantic frame + KC workflow catalog
// dispatch produces the correct outcome for the GW_* focus cases,
// using slug-inference fallback (no JSON enrichment required).

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { extractWorkflowFrame } from "../../../functions/_shared/ai-guide-v2/workflow-frame.ts";
import {
  buildCatalog,
  dispatchFromMatch,
  findCompatible,
  type KcWorkflowDoc,
} from "../../../functions/_shared/ai-guide-v2/workflow-catalog.ts";

// Minimal slice of real KC workflow cards (just slugs — inference handles rest).
const KC_SLICE: KcWorkflowDoc[] = [
  { slug: "workflow-create-blank-project" },
  { slug: "workflow-create-project-from-template" },
  { slug: "workflow-edit-project-overview" },
  { slug: "workflow-save-project-as-template" },
  { slug: "workflow-create-program" },
  { slug: "workflow-add-phase" },
  { slug: "workflow-edit-phase-plan" },
  { slug: "workflow-add-task-to-phase" },
  { slug: "workflow-edit-task-plan" },
  { slug: "workflow-add-execution-update" },
  { slug: "workflow-add-comment" },
  { slug: "workflow-add-dependency" },
  { slug: "workflow-create-project-risk" },
  { slug: "workflow-create-project-blocker" },
  { slug: "workflow-define-kpi" },
  { slug: "workflow-record-kpi-update" },
  { slug: "workflow-capture-kpi-snapshot" },
  { slug: "workflow-create-governance-cadence" },
  { slug: "workflow-record-governance-evidence" },
];

const CATALOG = buildCatalog(KC_SLICE);

function dispatch(q: string) {
  const frame = extractWorkflowFrame(q, { route: null, routeLabel: null });
  const match = findCompatible(frame, CATALOG);
  return { frame, outcome: dispatchFromMatch(frame, match) };
}

Deno.test("GW_F09 — imperative action request returns refusal", () => {
  const { outcome } = dispatch("Update the phase plan for me.");
  assertEquals(outcome.kind, "action_refusal");
});

Deno.test("GW_G02 — 'where do I create a KPI' picks define-kpi, NOT update", () => {
  const { outcome } = dispatch("Where do I create a KPI?");
  assert(outcome.kind === "verified_workflow", `got ${outcome.kind}`);
  if (outcome.kind === "verified_workflow") {
    assertEquals(outcome.entry.workflow_slug, "workflow-define-kpi");
  }
});

Deno.test("GW_H02 — 'how do I set up a governance cadence' picks cadence, NOT evidence", () => {
  const { outcome } = dispatch("How do I set up a governance cadence?");
  assert(outcome.kind === "verified_workflow", `got ${outcome.kind}`);
  if (outcome.kind === "verified_workflow") {
    assertEquals(outcome.entry.workflow_slug, "workflow-create-governance-cadence");
  }
});

Deno.test("GW_H04 — 'how do I record governance evidence' picks evidence, NOT cadence", () => {
  const { outcome } = dispatch("How do I record governance evidence?");
  assert(outcome.kind === "verified_workflow", `got ${outcome.kind}`);
  if (outcome.kind === "verified_workflow") {
    assertEquals(outcome.entry.workflow_slug, "workflow-record-governance-evidence");
  }
});

Deno.test("GW_O01 — ambiguous pronoun triggers clarification", () => {
  const { outcome } = dispatch("Where do I update it?");
  assertEquals(outcome.kind, "clarification_needed");
});

Deno.test("Risk vs blocker — 'how do I create a risk' picks risk", () => {
  const { outcome } = dispatch("How do I create a project risk?");
  assert(outcome.kind === "verified_workflow");
  if (outcome.kind === "verified_workflow") {
    assertEquals(outcome.entry.workflow_slug, "workflow-create-project-risk");
  }
});

Deno.test("Risk vs blocker — 'how do I create a blocker' picks blocker", () => {
  const { outcome } = dispatch("How do I create a project blocker?");
  assert(outcome.kind === "verified_workflow");
  if (outcome.kind === "verified_workflow") {
    assertEquals(outcome.entry.workflow_slug, "workflow-create-project-blocker");
  }
});

Deno.test("Comment vs execution update — 'how do I add an execution update' picks update", () => {
  const { outcome } = dispatch("How do I add an execution update?");
  assert(outcome.kind === "verified_workflow");
  if (outcome.kind === "verified_workflow") {
    assertEquals(outcome.entry.workflow_slug, "workflow-add-execution-update");
  }
});
