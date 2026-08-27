// AI-GUIDE.V2.GUIDE-MODE.0.7J — Fallback governance and clarification rendering.
//
// Locks in:
//   - Source-of-truth invariant requires an actual SoT/sync/update intent
//     in the user question. A generated-document situation alone is NOT
//     enough to fire the SoT fallback (workflow guidance must pass through).
//   - Verified-workflow answers are NOT downgraded by the SoT invariant
//     even when the situation looks generated-document-shaped.
//   - Actual source-of-truth questions ("Does editing a PowerPoint update
//     BTPM?") still trigger the SoT fallback.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { validateGuideV2PipelineInvariants } from "../../../functions/_shared/ai-guide-v2/pipeline-invariants.ts";
import type {
  GuideV2AnswerPlan,
  GuideV2DomainDiagnosis,
  GuideV2IntentClassification,
  GuideV2KnowledgePack,
  GuideV2WorkflowRecord,
} from "../../../functions/_shared/ai-guide-v2/types.ts";
import type { GuideV2RoutingResult } from "../../../functions/_shared/ai-guide-v2/router.ts";

function classification(): GuideV2IntentClassification {
  return {
    intent_type: "workflow_guidance",
    is_in_scope: true,
    user_goal: "generate a deck",
    clarification_needed: false,
    needs_verified_ui_steps: true,
    workflow_id: null,
    forbidden_claims: [],
  } as unknown as GuideV2IntentClassification;
}

function diagnosis(situation: string): GuideV2DomainDiagnosis {
  return {
    domain_situation: situation,
    canonical_objects: [],
    possible_objects: [],
    core_distinctions: [],
    recommended_kc_slugs: [],
    confidence: "high",
    domain_evidence: [],
    domain_safety_flags: [],
  } as unknown as GuideV2DomainDiagnosis;
}

function emptyPack(): GuideV2KnowledgePack {
  return {
    primary_articles: [],
    supporting_articles: [],
    metadata_signals: {},
    route_context: null,
    matched_workflow: null,
    source_confidence: "low",
    knowledge_sufficiency: "partial",
  } as unknown as GuideV2KnowledgePack;
}

function emptyPlan(mode: GuideV2AnswerPlan["answer_mode"]): GuideV2AnswerPlan {
  return {
    answer_mode: mode,
    title: "",
    opening: "",
    safe_limit_reason: null,
    allowed_steps: [],
    must_say: [],
    must_not_say: [],
    sources: [],
    next_suggestions: [],
    grounding_snippets: [],
    safe_guidance_points: [],
    concept_answer_shape: null,
    navigation_guidance: null,
    permission_note: null,
    source_of_truth_note: null,
    guided_card: null,
  } as unknown as GuideV2AnswerPlan;
}

function routing(
  mode: GuideV2RoutingResult["answer_mode"],
  withWorkflow: boolean,
): GuideV2RoutingResult {
  const wf: GuideV2WorkflowRecord | null = withWorkflow
    ? ({
      workflow_id: "wf-generate-roadmap-status-deck",
      title: "Generate Roadmap Status Deck",
      status: "verified",
      path: ["Roadmap"],
      steps: [{ order: 1, instruction: "Open Roadmap" }],
      source_articles: ["workflow-generate-roadmap-status-deck"],
      next_suggestions: [],
      permission_notes: [],
      not_supported: [],
    } as unknown as GuideV2WorkflowRecord)
    : null;
  return {
    answer_mode: mode,
    workflow_id: withWorkflow ? "wf-generate-roadmap-status-deck" : null,
    workflow_status: withWorkflow ? ("verified" as never) : null,
    matched_workflow: wf,
    route_reason: "test",
    can_generate_procedural_steps: withWorkflow,
    must_refuse_data_access: false,
    must_refuse_action_execution: false,
    requires_safe_limit: !withWorkflow,
    knowledge_sufficiency: "sufficient" as never,
    source_confidence: "high" as never,
    next_required_layer: "answer_planner",
    used_arbitration_override: false,
  };
}

const VERIFIED_DECK_ANSWER =
  "1. Open Roadmap. 2. Click Generate Roadmap Status Deck. 3. Pick projects. 4. Save.";
const GENERIC_SAFE_LIMIT_ANSWER =
  "I do not have enough verified BTPM guidance to answer this yet.";
const SOT_QUESTION = "Does editing a PowerPoint in SharePoint update BTPM?";
const WORKFLOW_QUESTION = "How do I generate a PowerPoint report for several projects?";
const SOT_ANSWER =
  "BTPM is the source of truth for project data. Editing the generated PowerPoint does not update BTPM; regenerate the deck after updating BTPM.";

Deno.test("0.7J SoT invariant does NOT fire on workflow guidance question alone (no SoT intent)", () => {
  const res = validateGuideV2PipelineInvariants({
    question: WORKFLOW_QUESTION,
    initialClassification: classification(),
    originalDiagnosis: diagnosis("generated_document_boundary"),
    arbitration: null,
    reconciledState: null,
    effectiveDecision: null,
    effectivePack: emptyPack(),
    routingResult: routing("verified_workflow", true),
    answerPlan: emptyPlan("verified_workflow"),
    renderedAnswer: VERIFIED_DECK_ANSWER,
    validation: null,
    finalAnswer: VERIFIED_DECK_ANSWER,
  });
  assert(
    !res.invariant_failures.some((f) => f.startsWith("generated_document_source_of_truth")),
    `unexpected SoT failure: ${res.invariant_failures.join("|")}`,
  );
  assertEquals(res.replacement_answer, null);
  assertEquals(res.hard_block_final_return, false);
  assertEquals(res.diagnostics.verified_workflow_no_downgrade_guard_applied, true);
});

Deno.test("0.7J SoT invariant DOES fire on real source-of-truth question", () => {
  const res = validateGuideV2PipelineInvariants({
    question: SOT_QUESTION,
    initialClassification: classification(),
    originalDiagnosis: diagnosis("generated_document_source_of_truth_boundary"),
    arbitration: null,
    reconciledState: null,
    effectiveDecision: null,
    effectivePack: emptyPack(),
    routingResult: routing("unverified_workflow_safe_limit", false),
    answerPlan: emptyPlan("unverified_workflow_safe_limit"),
    renderedAnswer: GENERIC_SAFE_LIMIT_ANSWER,
    validation: null,
    finalAnswer: GENERIC_SAFE_LIMIT_ANSWER,
  });
  assert(
    res.invariant_failures.some((f) => f === "generated_document_source_of_truth_wrong_or_missing_fallback"),
    `expected SoT failure, got: ${res.invariant_failures.join("|")}`,
  );
  assertEquals(res.hard_block_final_return, true);
  assert(res.replacement_answer && /source of truth/i.test(res.replacement_answer));
  assertEquals(res.diagnostics.source_of_truth_fallback_applied, true);
});

Deno.test("0.7J SoT invariant does NOT downgrade a verified workflow answer", () => {
  // Even if the question contains both a generated-doc word AND a SoT word,
  // a verified workflow answer must be protected.
  const res = validateGuideV2PipelineInvariants({
    question: "Does generating a PowerPoint update BTPM source of truth?",
    initialClassification: classification(),
    originalDiagnosis: diagnosis("generated_document_boundary"),
    arbitration: null,
    reconciledState: null,
    effectiveDecision: null,
    effectivePack: emptyPack(),
    routingResult: routing("verified_workflow", true),
    answerPlan: emptyPlan("verified_workflow"),
    renderedAnswer: VERIFIED_DECK_ANSWER,
    validation: null,
    finalAnswer: VERIFIED_DECK_ANSWER,
  });
  assertEquals(res.hard_block_final_return, false);
  assertEquals(res.replacement_answer, null);
});

Deno.test("0.7J generated-doc situation alone (no SoT-intent words) does NOT fire SoT fallback", () => {
  // Generic safe-limit answer (no SoT explanation), generated_document_boundary
  // situation, but the question is a pure workflow guidance question.
  const res = validateGuideV2PipelineInvariants({
    question: "How do I create a deck?",
    initialClassification: classification(),
    originalDiagnosis: diagnosis("generated_document_boundary"),
    arbitration: null,
    reconciledState: null,
    effectiveDecision: null,
    effectivePack: emptyPack(),
    routingResult: routing("unverified_workflow_safe_limit", false),
    answerPlan: emptyPlan("unverified_workflow_safe_limit"),
    renderedAnswer: GENERIC_SAFE_LIMIT_ANSWER,
    validation: null,
    finalAnswer: GENERIC_SAFE_LIMIT_ANSWER,
  });
  assert(
    !res.invariant_failures.some((f) => f.startsWith("generated_document_source_of_truth")),
    `unexpected SoT failure on workflow-guidance-only question: ${res.invariant_failures.join("|")}`,
  );
});

Deno.test("0.7J SoT trigger diagnostics are exposed", () => {
  const res = validateGuideV2PipelineInvariants({
    question: SOT_QUESTION,
    initialClassification: classification(),
    originalDiagnosis: diagnosis("generated_document_source_of_truth_boundary"),
    arbitration: null,
    reconciledState: null,
    effectiveDecision: null,
    effectivePack: emptyPack(),
    routingResult: routing("unverified_workflow_safe_limit", false),
    answerPlan: emptyPlan("unverified_workflow_safe_limit"),
    renderedAnswer: SOT_ANSWER,
    validation: null,
    finalAnswer: SOT_ANSWER,
  });
  const trig = res.diagnostics.source_of_truth_trigger_terms as Record<string, boolean>;
  assertEquals(trig.question_asks_source_of_truth, true);
  assertEquals(trig.question_mentions_generated_doc, true);
});
