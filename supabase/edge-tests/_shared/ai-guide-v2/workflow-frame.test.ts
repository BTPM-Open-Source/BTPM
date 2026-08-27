// Deno tests for workflow-frame extractor — covers the GW_* acceptance
// cases from Guide Mode Step 0.7C.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { extractWorkflowFrame } from "../../../functions/_shared/ai-guide-v2/workflow-frame.ts";

Deno.test("GW_A09 — 'Where do I update the basic project details?' is workflow_guidance, not action", () => {
  const f = extractWorkflowFrame("Where do I update the basic project details?");
  assertEquals(f.intent_type, "workflow_guidance");
  assertEquals(f.object_family, "project");
  assert(f.action === "edit" || f.action === "update", `expected edit/update, got ${f.action}`);
});

Deno.test("GW_C04 — 'How do I update the phase plan?' is workflow_guidance for phase", () => {
  const f = extractWorkflowFrame("How do I update the phase plan?");
  assertEquals(f.intent_type, "workflow_guidance");
  assertEquals(f.object_family, "phase");
});

Deno.test("GW_B06 — 'I have a project template. Can I use it to create a program?' targets program, not project", () => {
  const f = extractWorkflowFrame("I have a project template. Can I use it to create a program?");
  assertEquals(f.intent_type, "workflow_guidance");
  // Object family must resolve to program (the user's *goal* object).
  assertEquals(f.object_family, "program");
  // Source object is project_template (template phrasing); target is program.
  assertEquals(f.source_object, "project_template");
  assertEquals(f.target_object, "program");
});

Deno.test("Example A — 'How do I create a project from a template?'", () => {
  const f = extractWorkflowFrame("How do I create a project from a template?");
  assertEquals(f.intent_type, "workflow_guidance");
  assertEquals(f.object_family, "project");
  assertEquals(f.action, "create_from_template");
  assertEquals(f.modifier, "from_template");
  assertEquals(f.source_object, "project_template");
  assertEquals(f.target_object, "project");
});

Deno.test("Example B — 'Can I turn this project into a template?'", () => {
  const f = extractWorkflowFrame("Can I turn this project into a template?");
  assertEquals(f.intent_type, "workflow_guidance");
  assertEquals(f.object_family, "project");
  assertEquals(f.action, "save_as_template");
  assertEquals(f.modifier, "as_template");
});

Deno.test("GW_G02 — 'I need to track adoption percentage as a KPI. Where do I create it?' is define, not update", () => {
  const f = extractWorkflowFrame("I need to track adoption percentage as a KPI. Where do I create it?");
  assertEquals(f.intent_type, "workflow_guidance");
  assertEquals(f.object_family, "kpi");
  // Action must be a 'create'/'define'-class verb, NOT 'update'.
  assert(
    f.action === "define" || f.action === "create",
    `expected define/create, got ${f.action}`,
  );
});

Deno.test("GW_H02 — governance cadence", () => {
  const f = extractWorkflowFrame("How do I set up a recurring SteerCo every two weeks?");
  assertEquals(f.intent_type, "workflow_guidance");
  assertEquals(f.object_family, "governance_cadence");
});

Deno.test("GW_H04 — 'We had the SteerCo today. Where do I attach or record the evidence?'", () => {
  const f = extractWorkflowFrame("We had the SteerCo today. Where do I attach or record the evidence?");
  assertEquals(f.intent_type, "workflow_guidance");
  assertEquals(f.object_family, "governance_evidence");
  assertEquals(f.modifier, "evidence_record");
});

Deno.test("GW_F09 — 'Create a project for me now.' is perform_action_request", () => {
  const f = extractWorkflowFrame("Create a project for me now.");
  assertEquals(f.intent_type, "perform_action_request");
});

Deno.test("GW_F09b — 'Set this KPI to 80%.' is perform_action_request", () => {
  const f = extractWorkflowFrame("Set this KPI to 80%.");
  assertEquals(f.intent_type, "perform_action_request");
});

Deno.test("GW_O01 — 'How do I add one?' triggers clarification_needed", () => {
  const f = extractWorkflowFrame("How do I add one?");
  assertEquals(f.intent_type, "clarification_needed");
  assertEquals(f.ambiguity_flag, true);
});

Deno.test("GW_O02 — 'Where do I update it?' triggers clarification_needed", () => {
  const f = extractWorkflowFrame("Where do I update it?");
  assertEquals(f.intent_type, "clarification_needed");
});

Deno.test("GW_O03 — 'How do I close this?' triggers clarification_needed", () => {
  const f = extractWorkflowFrame("How do I close this?");
  assertEquals(f.intent_type, "clarification_needed");
});

Deno.test("GW_O05 — 'Where do I add a note?' triggers clarification_needed (bare 'note', no object/route)", () => {
  const f = extractWorkflowFrame("Where do I add a note?");
  assertEquals(f.intent_type, "clarification_needed");
});

Deno.test("GW_O06 — 'How do I update status?' triggers clarification_needed (bare 'status', no object)", () => {
  const f = extractWorkflowFrame("How do I update status?");
  assertEquals(f.intent_type, "clarification_needed");
});

Deno.test("Imperative without object falls back to workflow_guidance (no false action)", () => {
  // No concrete object → not action.
  const f = extractWorkflowFrame("Where can I see what changed?");
  assertEquals(f.intent_type, "workflow_guidance");
});
