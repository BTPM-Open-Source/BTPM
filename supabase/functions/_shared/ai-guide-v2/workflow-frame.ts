// AI-GUIDE.V2.GUIDE-MODE.0.7F — Semantic workflow frame extractor (hardened).
//
// Turns a user question into a normalized `WorkflowFrame` that downstream
// layers (workflow-catalog, kc-workflow-card-resolver) match against KC
// workflow cards using strict semantic gates BEFORE any vector ranking.
//
// Hard rules:
//   - Pure / deterministic. No I/O, no network, no LLM. Easy to unit-test.
//   - "How do I…" / "Where do I…" / "Where can I…" / "Where should I…"
//     are ALWAYS workflow_guidance, never perform_action_request.
//   - "Can you …" requests are action_refusal. "Can I …" stays guidance.
//   - Imperative verbs without "how/where/can/should I…" AND with a
//     concrete object are perform_action_request (action refusal).
//   - Unresolved pronouns / bare nouns ("one", "it", "this", bare
//     "status"/"note") without route/object context flip the frame to
//     clarification_needed.

export type WorkflowIntentType =
  | "workflow_guidance"
  | "perform_action_request"
  | "concept"
  | "troubleshooting"
  | "clarification_needed";

export type WorkflowObjectFamily =
  | "project"
  | "project_template"
  | "program"
  | "phase"
  | "task"
  | "kpi"
  | "risk"
  | "blocker"
  | "governance_cadence"
  | "governance_evidence"
  | "sharepoint_folder"
  | "file"
  | "my_work"
  | "agile"
  | "sprint"
  | "backlog_item"
  | "roadmap"
  | "export"
  | "comment"
  | "execution_update"
  | "dependency"
  | "raci"
  | "team_member"
  | "workspace_member"
  | "user_invitation"
  | "workspace_access"
  | "power_bi"
  | "knowledge_center"
  | "kpi_snapshot"
  | "kpi_app"
  | "email"
  | "unknown";

export type WorkflowAction =
  | "create"
  | "edit"
  | "update"
  | "complete"
  | "reopen"
  | "record"
  | "define"
  | "connect"
  | "disconnect"
  | "save_as_template"
  | "create_from_template"
  | "generate"
  | "export"
  | "enable"
  | "add_to"
  | "view_or_find"
  | "capture"
  | "send"
  | "manage"
  | "configure"
  | "invite"
  | "use"
  | "resolve"
  | "unknown";

export type WorkflowModifier =
  | "none"
  | "blank"
  | "from_template"
  | "as_template"
  | "from_program"
  | "from_project"
  | "project_level"
  | "task_level"
  | "phase_level"
  | "current_item"
  | "status_only"
  | "value_update"
  | "evidence_record"
  | "cadence_expectation";

export type WorkflowSourceObject =
  | null
  | "project_template"
  | "project"
  | "program"
  | "phase"
  | "task"
  | "sprint"
  | "backlog_item"
  | "kpi";

export type WorkflowTargetObject =
  | null
  | "project"
  | "project_template"
  | "program"
  | "phase"
  | "task"
  | "kpi"
  | "blocker"
  | "risk"
  | "governance_record"
  | "governance_cadence"
  | "sprint"
  | "backlog_item"
  | "file"
  | "sharepoint_folder"
  | "dependency"
  | "comment"
  | "execution_update";

export type WorkflowScope =
  | null
  | "project_level"
  | "task_level"
  | "phase_level"
  | "workspace_level"
  | "program_level";

export type WorkflowGeneratedArtifactType =
  | "project_charter"
  | "project_status_deck"
  | "roadmap_status_deck"
  | "generic_generated_document"
  | "unknown";

export type WorkflowGeneratedArtifactConfidence = "high" | "medium" | "low";

export interface WorkflowFrame {
  intent_type: WorkflowIntentType;
  object_family: WorkflowObjectFamily;
  action: WorkflowAction;
  modifier: WorkflowModifier;
  source_object: WorkflowSourceObject;
  target_object: WorkflowTargetObject;
  scope: WorkflowScope;
  ambiguity_flag: boolean;
  question_text: string;
  helper_terms_present: string[];
  // 0.7I — Generated-artifact discriminator for status-deck / charter / PPT
  // routing. Only meaningful when object_family === "export" (or future
  // generated-doc families). Defaults to "unknown" elsewhere.
  generated_artifact_type: WorkflowGeneratedArtifactType;
  generated_artifact_confidence: WorkflowGeneratedArtifactConfidence;
  raw_terms: {
    guidance_markers: string[];
    imperative_markers: string[];
    ambiguity_markers: string[];
    object_markers: string[];
    action_markers: string[];
    modifier_markers: string[];
  };
}

export interface FrameExtractionContext {
  route?: string | null;
  routeLabel?: string | null;
}

// ---------------------------------------------------------------------------
// Lexicons
// ---------------------------------------------------------------------------

const GUIDANCE_PREFIX_RE =
  /\b(?:how|where|when|what|why)\s+(?:do|can|should|would|might)\s+i\b|\bcan\s+i\b|\bcould\s+i\b|\bis\s+(?:it|there)\s+(?:possible|a\s+way)\b|\bhow\s+to\b|\bwhere\s+to\b/i;

// "Can you …", "Could you please …" etc. — clear action request to assistant.
const ASSISTANT_ACTION_REQUEST_RE =
  /\b(?:can|could|would|will)\s+you\s+(?:please\s+)?(?:create|add|make|update|delete|change|set|invite|close|complete|reopen|send|generate|publish|run|attach|upload|move|configure|record|resolve|connect|disconnect|start|kick\s*off|launch|mark|finish|give|grant|remove|export|turn(?:\s+\w+){0,3}\s+on|switch\s+on|activate|enable)\b/i;

const IMPERATIVE_FOR_ME_RE =
  /\b(?:do|create|add|update|delete|submit|sync|send|invite|grant|give|upload|approve|change|set|save|generate|publish|run|close|complete|reopen|attach|move|connect|disconnect|configure|record|resolve|mark|finish|kick\s+off|launch|start|export|remove|turn(?:\s+\w+)?\s+on|enable)\b[^.?!]*\b(?:for\s+me|for\s+us|now|please|right\s+now|asap)\b/i;

const IMPERATIVE_DIRECT_RE =
  /^\s*(?:please\s+)?(?:create|add|make|update|delete|change|set|invite|close|complete|reopen|send|generate|publish|run|attach|upload|move|kick\s+off|launch|configure|record|resolve|connect|disconnect|mark|finish|give|grant|remove|export|turn\s+(?:on|\w+\s+on)|enable|activate|switch\s+on)\b/i;

// Pronoun ambiguity (no nearby concrete object).
const PRONOUN_AMBIG_RE = /\b(?:it|this|that|one)\b/i;
const BARE_STATUS_RE = /\b(?:status|note|update|comment)\b/i;
const HAS_ROUTE_OR_OBJECT_RE = /\b(?:project|program|phase|task|kpi|risk|blocker|sprint|backlog|sharepoint|folder|cadence|evidence|steerco|template|roadmap|gantt|calendar|deck|charter|dependency|dependencies)\b/i;

// Helper / view-surface signal terms (used by catalog ranker to allow
// workflow-use-* candidates only when the user explicitly invokes them).
const HELPER_TERM_RE = /\b(?:calendar|gantt|timeline|roadmap|my\s+work|what\s+(?:i|i\s+need|i\s+should)\s+(?:need\s+to\s+|should\s+)?work\s+on|assigned\s+to\s+me|my\s+(?:assigned\s+)?tasks|files?\s+module|files?\s+page|knowledge\s+(?:center|base)|agile\s+board)\b/i;

// ---------------------------------------------------------------------------
// 0.9D — Progress / contribution reporting semantic family
// ---------------------------------------------------------------------------
// Detects when a user is asking how to REPORT progress / contribution /
// work / status against an existing BTPM work item. This must never be
// confused with an explicit request to CREATE a project/program/phase/task.
//
// Both patterns are exported so the workflow catalog, KC resolver, and
// pipeline invariants can apply the same semantic guardrail without
// duplicating regex sources.
export const PROGRESS_REPORTING_INTENT_RE =
  /\b(?:report(?:ing)?\s+(?:my\s+|the\s+|a\s+|some\s+|an?\s+)?(?:progress|contribution|work|update|status|it|this)|progress\s+(?:report|update)|status\s+update|update\s+(?:my\s+|the\s+|on\s+|phase\s+|task\s+|execution\s+)?progress|update\s+(?:my\s+|the\s+)?status\b|update\s+execution|execution\s+update|how\s+(?:do|shall|should|can)\s+i\s+(?:report|show|log|tell|share|submit)\b|where\s+(?:do|can|should)\s+i\s+(?:report|add\s+(?:an?\s+)?(?:execution\s+|progress\s+)?update|put\s+(?:my\s+|a\s+|the\s+)?(?:progress|update)|update\s+(?:phase|task)\s+progress)|did\s+(?:some\s+)?work\s+(?:on|for)|did\s+something\s+(?:which|that)\s+contribut\w+|i\s+contribut(?:ed|ing|ion)\b|i\s+helped\s+move\b|finished\s+(?:the\s+|my\s+)?work\b|completed\s+(?:the\s+|my\s+)?work\b|i\s+just\s+(?:finished|completed|did)\b|tell\s+(?:people|stakeholders|the\s+team|everyone)\s+what\s+(?:i|we)\s+(?:did|finished|completed|changed)|show\s+(?:people\s+|stakeholders\s+)?(?:my\s+|the\s+|some\s+)?progress|log\s+(?:my\s+|the\s+|some\s+)?contribution|submit\s+(?:my\s+|a\s+)?(?:weekly\s+)?(?:status\s+)?update|record\s+(?:my\s+|the\s+|some\s+)?progress|what\s+changed\s+(?:this\s+week|today|yesterday|recently)|close\s+task\s+or\s+update\s+progress|comment\s+or\s+execution\s+update|just\s+want\s+to\s+ask\s+a\s+question\s+on\s+a\s+task)\b/i;

// Explicit create-of-project/task/phase/program intent. ONLY matches when
// the user is unambiguously asking to CREATE that container object — not
// "report progress on the project". Used as a guard before promoting a
// frame away from project/task creation.
export const EXPLICIT_CREATE_PROJECT_OR_TASK_RE =
  /\b(?:create|start|spin\s+up|kick\s+off|launch|begin|make|build|set\s+up)\s+(?:a\s+|an\s+|the\s+|another\s+|new\s+|one\s+)*(?:blank\s+)?(?:project|program|phase|project\s+template)\b|\bnew\s+(?:blank\s+)?(?:project|program|phase)\b|\bstart\s+(?:a\s+)?(?:new\s+|blank\s+)?project\s+from\b|\bcreate\s+(?:a\s+|the\s+|another\s+|new\s+|one\s+)*task\b|\badd\s+(?:a\s+|another\s+|new\s+)?task\s+(?:to|in|under|on|for)\b|\bcreate\s+(?:a\s+)?(?:missing\s+)?task\b|\bwork\s+is\s+missing\s+as\s+a\s+task\b|\bi\s+(?:need|want)\s+to\s+add\s+(?:a\s+)?task\b|\brealized\s+(?:the\s+)?work\s+is\s+missing\b/i;

/** Strong reporting phrases that, alone, justify routing to execution_update
 *  even with no concrete object word in the question. Subset of
 *  PROGRESS_REPORTING_INTENT_RE — excludes the bare "update status" /
 *  "status update" forms which are still ambiguous on their own. */
export const STRONG_PROGRESS_REPORTING_RE =
  /\b(?:report(?:ing)?\s+(?:my\s+|the\s+|a\s+|some\s+|an?\s+)?(?:progress|contribution|work)|progress\s+report|how\s+(?:do|shall|should|can)\s+i\s+(?:report|show|log|tell|share|submit)\b|where\s+(?:do|can|should)\s+i\s+(?:report|add\s+(?:an?\s+)?(?:execution\s+|progress\s+)?update|put\s+(?:my\s+|a\s+|the\s+)?(?:progress|update))|did\s+(?:some\s+)?work\s+(?:on|for)|did\s+something\s+(?:which|that)\s+contribut\w+|i\s+contribut(?:ed|ing|ion)\b|i\s+helped\s+move\b|finished\s+(?:the\s+|my\s+)?work\b|completed\s+(?:the\s+|my\s+)?work\b|i\s+just\s+(?:finished|completed|did)\b|tell\s+(?:people|stakeholders|the\s+team|everyone)\s+what\s+(?:i|we)\s+(?:did|finished|completed|changed)|show\s+(?:people\s+|stakeholders\s+)?(?:my\s+|the\s+|some\s+)?progress|log\s+(?:my\s+|the\s+|some\s+)?contribution|submit\s+(?:my\s+|a\s+)?(?:weekly\s+)?(?:status\s+)?update|record\s+(?:my\s+|the\s+|some\s+)?progress|what\s+changed\s+(?:this\s+week|today|yesterday|recently))\b/i;

/** True if the question expresses progress / contribution reporting intent
 *  AND does not also contain an explicit create-project/task/phase/program
 *  request. Shared between workflow-catalog, kc-workflow-card-resolver, and
 *  pipeline-invariants so the guardrail is consistent. */
export function isProgressReportingIntent(question: string): boolean {
  const q = question || "";
  return PROGRESS_REPORTING_INTENT_RE.test(q) && !EXPLICIT_CREATE_PROJECT_OR_TASK_RE.test(q);
}


// Object family detection (ordered: more specific first).
const OBJECT_PATTERNS: Array<{ family: WorkflowObjectFamily; re: RegExp }> = [
  { family: "governance_evidence", re: /\b(?:governance\s+evidence|steer\s*co\s+(?:minutes|evidence|notes)|meeting\s+(?:minutes|notes|evidence)|attach\s+(?:the\s+|an?\s+)?(?:minutes|evidence|notes)|record\s+(?:the\s+|an?\s+)?(?:evidence|minutes|notes)|had\s+(?:the\s+|a\s+)?steer\s*co)\b/i },
  { family: "governance_cadence", re: /\b(?:governance\s+cadence|recurring\s+steer\s*co|weekly\s+steer\s*co|bi[-\s]?weekly\s+steer\s*co|monthly\s+steer\s*co|cadence|frequency|steer\s*co\s+every\s+(?:two\s+|three\s+|few\s+)?weeks?|set\s+(?:that|this|the)\s+expectation)\b/i },
  { family: "kpi_snapshot", re: /\bkpi\s+snapshot|capture\s+(?:a\s+)?kpi\s+snapshot/i },
  { family: "kpi_app", re: /\bkpi\s+app\b/i },
  { family: "kpi", re: /\bkpis?\b|\badoption\s+percentage\b|\bmetric\b/i },
  { family: "dependency", re: /\b(?:dependenc(?:y|ies)|predecessor|successor|depend(?:s|ent)?\s+on|one\s+(?:task|phase)\s+(?:to\s+)?(?:happen|come|start|finish)\s+after|happen\s+after\s+another|wait(?:s)?\s+for\s+(?:another|the\s+other|task))\b/i },
  { family: "blocker", re: /\bblockers?\b|\b(?:something\s+is\s+)?(?:stopping|blocking|preventing)\s+(?:my|the|a)\s+(?:task|work|progress)\b|\bblocked\s+(?:by|on)\b/i },
  { family: "risk", re: /\brisks?\b/i },
  { family: "sharepoint_folder", re: /\bsharepoint\s+folder|project\s+folder|workspace\s+folder|\bsharepoint\b|\bproject\s+to\s+sharepoint|\blink\s+(?:the\s+)?project\s+folder/i },
  { family: "file", re: /\bfiles?\s+module\b|\bsharepoint\s+file|\bupload\s+(?:a\s+)?(?:file|document)|\bproject\s+(?:files?|documents?)|\badd\s+(?:a\s+)?(?:file|document)\s+to\s+(?:a\s+|the\s+|this\s+)?project\b/i },
  { family: "my_work", re: /\bmy\s+work\b|\bwhat\s+(?:i\s+(?:need|should)\s+to\s+work\s+on|i\s+(?:need|should)\s+to\s+(?:do|work))\b|\bassigned\s+to\s+me\b|\bmy\s+assigned\s+tasks?\b|\bmy\s+tasks\b/i },
  { family: "sprint", re: /\bsprints?\b/i },
  { family: "backlog_item", re: /\bbacklog\s+item|backlog\s+entry|\bbacklog\b/i },
  { family: "agile", re: /\bagile\s+(?:board|mode)\b|\bturn\s+on\s+agile\b|\benable\s+agile\b/i },
  { family: "roadmap", re: /\broadmap\b/i },
  { family: "execution_update", re: /\bexecution\s+update\b|\bupdate\s+log\b|\bprogress\s+update\b|\brecord\s+what\s+changed\b|\bwhat\s+changed\s+(?:this\s+week|today|yesterday)\b|\bdated\s+(?:execution\s+)?update\b/i },
  { family: "comment", re: /\bcomments?\b/i },
  { family: "raci", re: /\braci\b/i },
  { family: "team_member", re: /\bproject\s+(?:team\s+)?member\b|\bteam\s+member\b/i },
  { family: "workspace_member", re: /\bworkspace\s+members?\b|\b(?:user[''']?s?|member[''']?s?)\s+workspace\s+role\b|\bchange\s+(?:a\s+)?user[''']?s?\s+(?:workspace\s+)?role\b|\bremove\s+(?:this\s+|the\s+)?person\s+from\s+(?:the\s+)?workspace\b/i },
  { family: "user_invitation", re: /\binvite\s+(?:a\s+)?(?:user|person|member|colleague)|\binvitation\b/i },
  { family: "workspace_access", re: /\bworkspace\s+access\b|\baccess\s+to\s+(?:a\s+)?workspace\b|\b(?:give|grant)\s+\w+\s+admin\s+access\b|\badmin\s+access\b/i },
  { family: "power_bi", re: /\bpower\s*bi\b/i },
  { family: "knowledge_center", re: /\bknowledge\s+center|knowledge\s+base\b/i },
  // 0.7H: Generated-document / deck / PPT / charter semantic family.
  // Power BI is handled by its own family above; this family is for BTPM
  // generated documents (status decks, roadmap decks, charters, exports).
  { family: "export", re: /\b(?:status\s+deck|project\s+deck|roadmap\s+(?:status\s+)?deck|status\s+(?:ppt|deck|presentation|report)|powerpoint(?:\s+report)?|power\s+point(?:\s+report)?|\bppt(?:\s+report)?\b|deck|presentation\s+for\s+(?:tomorrow|the\s+meeting)|presentation|(?:project\s+)?charter|generated\s+(?:document|deck|report|file)|exported\s+(?:report|deck|file))\b|\bexport\b|\bdownload\s+(?:as|the)\b/i },
  { family: "email", re: /\bsend\s+(?:an?\s+)?email\b|\bemail\s+(?:object|the\s+team)\b/i },
  { family: "task", re: /\btasks?\b/i },
  { family: "phase", re: /\bphases?\b/i },
  { family: "program", re: /\bprograms?\b/i },
  { family: "project_template", re: /\bproject\s+templates?\b/i },
  { family: "project", re: /\bprojects?\b/i },
];

// Action detection — verb-anchored. Order matters: specific before generic.
// Note: we deliberately use loose `[\s\S]{0,200}?` instead of `[^?.!]*` so
// natural multi-sentence phrasing (e.g. "We have a template. How do I use
// it to create a project?") still matches across sentence boundaries.
const ACTION_PATTERNS: Array<{ action: WorkflowAction; re: RegExp }> = [
  { action: "save_as_template", re: /\b(?:save|turn|convert|make)\b[\s\S]{0,80}?\b(?:as|into|to)\s+(?:a\s+)?template\b/i },
  { action: "create_from_template", re: /\b(?:create|start|spin\s+up|make|build|kick\s+off|launch|begin)\b[\s\S]{0,80}?\b(?:from|using|with)\s+(?:a\s+|the\s+)?(?:project\s+)?template\b|\bcreate\s+(?:a\s+)?(?:project|program)\s+from\s+(?:a\s+)?template\b|\btemplate\b[\s\S]{0,160}?\b(?:use|reuse)\s+(?:it|this|the\s+template|that)\b[\s\S]{0,80}?\b(?:create|start|spin\s+up|make|build|begin)\s+(?:a\s+)?(?:new\s+)?project\b|\b(?:reuse|use\s+(?:the|an?))\s+(?:existing\s+|standard\s+|implementation\s+)?(?:project\s+)?template\b[\s\S]{0,160}?\b(?:create|start)\s+(?:a\s+)?(?:new\s+)?project\b|\bstart\s+a\s+project\s+from\s+(?:it|template|a\s+template|the\s+template)\b/i },
  { action: "define", re: /\b(?:define|set\s+up\s+a\s+new|create\s+a\s+new|add\s+a\s+new|track\s+[\s\S]{0,60}?\s+as\s+(?:a\s+)?kpi)\b/i },
  { action: "record", re: /\b(?:record|attach|upload|log)\b[\s\S]{0,80}?\b(?:evidence|minutes|notes|file|deck|governance)\b|\battach\s+(?:the\s+)?(?:minutes|evidence|notes|deck)\b|\brecord\s+what\s+changed\b/i },
  { action: "resolve", re: /\bresolve\b[\s\S]{0,40}?\bblocker\b|\bclose\s+(?:the\s+|a\s+|this\s+)?blocker\b|\bblocker\s+is\s+gone\b/i },
  { action: "connect", re: /\b(?:connect|link)\b[\s\S]{0,40}?\b(?:sharepoint|folder|project)\b|\blink\s+the\s+project\s+folder\b/i },
  { action: "disconnect", re: /\b(?:disconnect|unlink|detach|unbind|remove\s+the\s+(?:sharepoint\s+)?link)\b/i },
  { action: "reopen", re: /\breopen\b/i },
  { action: "complete", re: /\b(?:complete|finish(?:ed)?|mark\s+(?:it|this|the\s+task|complete|as\s+(?:done|complete)|done))\b/i },
  { action: "generate", re: /\bgenerate\b|\b(?:create|build|make|need)\s+(?:a\s+|the\s+)?(?:status\s+deck|project\s+status\s+deck|deck|presentation|charter)\b/i },
  { action: "export", re: /\bexport\b|\bdownload\s+(?:as|the)\b/i },
  { action: "enable", re: /\b(?:enable|turn\s+on|switch\s+on|activate)\b/i },
  { action: "capture", re: /\bcapture\b/i },
  { action: "configure", re: /\bconfigure\b/i },
  { action: "manage", re: /\bmanage\b/i },
  { action: "invite", re: /\binvite\b/i },
  { action: "send", re: /\bsend\b/i },
  { action: "add_to", re: /\badd\b[\s\S]{0,60}?\b(?:to|into)\s+(?:a|the|this)\s+(?:sprint|backlog)\b/i },
  // Create — generic. Includes start/spin up/kick off/launch for project creation.
  { action: "create", re: /\b(?:create|add|new|raise|log|set\s+up|start|spin\s+up|kick\s+off|launch|begin)\s+(?:a|the|new|another|one)?\b/i },
  { action: "edit", re: /\b(?:edit|modify|change|rename)\b/i },
  { action: "update", re: /\b(?:update|enter|record|submit)\b[\s\S]{0,80}?\b(?:value|number|status|update|actual|this\s+week'?s)\b|\bupdate\b/i },
  { action: "view_or_find", re: /\b(?:see|view|find|open|locate|where\s+(?:are|is))\b/i },
  { action: "use", re: /\buse\s+the\b/i },
];

// Modifier detection.
const MODIFIER_PATTERNS: Array<{ mod: WorkflowModifier; re: RegExp }> = [
  { mod: "from_template", re: /\bfrom\s+(?:a\s+|the\s+)?(?:project\s+)?template\b|\busing\s+(?:a\s+|the\s+)?template\b|\btemplate\b[\s\S]{0,160}?\b(?:use|reuse)\s+(?:it|this|the\s+template)\b[\s\S]{0,80}?\b(?:create|start)\s+(?:a\s+)?(?:new\s+)?project\b|\breuse\s+(?:an?\s+)?(?:existing\s+)?(?:project\s+)?template\b|\bimplementation\s+template\b|\bstart\s+a\s+project\s+from\s+(?:it|template|a\s+template|the\s+template)\b/i },
  { mod: "as_template", re: /\b(?:as|into|to)\s+(?:a\s+)?template\b/i },
  { mod: "blank", re: /\bblank\s+project\b|\bfrom\s+scratch\b|\bempty\s+project\b/i },
  { mod: "from_program", re: /\bfrom\s+(?:a\s+|the\s+)?program\b/i },
  { mod: "from_project", re: /\bfrom\s+(?:a\s+|the\s+)?project\b/i },
  { mod: "project_level", re: /\bproject[-\s]level\b/i },
  { mod: "task_level", re: /\btask[-\s]level\b/i },
  { mod: "phase_level", re: /\bphase[-\s]level\b/i },
  { mod: "evidence_record", re: /\b(?:evidence|minutes|meeting\s+notes)\b/i },
  { mod: "cadence_expectation", re: /\bcadence\b|\brecurring\s+steer\s*co|\bweekly\s+steer\s*co|\bbi[-\s]?weekly\s+steer\s*co|\bmonthly\s+steer\s*co|\bsteer\s*co\s+every\s+(?:two\s+|three\s+|few\s+)?weeks?|\bset\s+(?:that|this|the)\s+expectation/i },
  { mod: "value_update", re: /\b(?:kpi\s+)?(?:value|number|actual|this\s+week'?s\s+kpi)\b/i },
  { mod: "status_only", re: /\bstatus\s+only\b/i },
];

// Source / target object detection.
const SOURCE_PATTERNS: Array<{ src: WorkflowSourceObject; re: RegExp }> = [
  { src: "project_template", re: /\bproject\s+template\b|\bimplementation\s+template\b|\bfrom\s+(?:a\s+|the\s+)?(?:project\s+)?template\b|\busing\s+(?:a\s+|the\s+)?template\b|\btemplate\b[\s\S]{0,160}?\b(?:use|reuse)\s+(?:it|this|the\s+template)\b[\s\S]{0,80}?\b(?:create|start)\s+(?:a\s+)?(?:new\s+)?project\b|\breuse\s+(?:an?\s+)?(?:existing\s+)?(?:project\s+)?template\b/i },
  { src: "program", re: /\bfrom\s+(?:a\s+|the\s+)?program\b/i },
  { src: "project", re: /\bfrom\s+(?:a\s+|the\s+)?project\b|\b(?:save|turn|convert|make)\s+(?:this|the)\s+project\b/i },
];

const TARGET_PATTERNS: Array<{ tgt: WorkflowTargetObject; re: RegExp }> = [
  { tgt: "governance_record", re: /\b(?:governance\s+)?(?:evidence|minutes|meeting\s+notes)\b/i },
  { tgt: "governance_cadence", re: /\bcadence\b|\bsteer\s*co\s+every\s+(?:two\s+|three\s+|few\s+)?weeks?/i },
  { tgt: "kpi", re: /\bas\s+(?:a\s+)?kpi\b|\bnew\s+kpi\b|\bcreate\s+(?:a\s+)?kpi\b|\bdefine\s+(?:a\s+)?kpi\b|\badd\s+a\s+kpi\b/i },
  { tgt: "blocker", re: /\b(?:create|add|raise|log)\b[\s\S]{0,60}?\bblocker\b|\bproject[-\s]level\s+blocker\b/i },
  { tgt: "risk", re: /\b(?:create|add|raise|log)\b[\s\S]{0,60}?\brisk\b/i },
  { tgt: "program", re: /\b(?:create|spin\s+up|start|kick\s+off|launch)\b[\s\S]{0,80}?\bprogram\b/i },
  { tgt: "project_template", re: /\b(?:save|turn|convert|make)\b[\s\S]{0,80}?\b(?:project|this|it)\b[\s\S]{0,80}?\b(?:as|into|to)\s+(?:a\s+)?template\b/i },
  { tgt: "project", re: /\b(?:create|spin\s+up|start|kick\s+off|launch|begin)\b[\s\S]{0,80}?\b(?:blank\s+)?project\b|\btemplate\b[\s\S]{0,160}?\b(?:use|reuse)\s+(?:it|this|the\s+template)\b[\s\S]{0,80}?\b(?:create|start)\s+(?:a\s+)?(?:new\s+)?project\b/i },
  { tgt: "phase", re: /\b(?:add|create)\b[\s\S]{0,40}?\bphase\b/i },
  { tgt: "execution_update", re: /\b(?:add|create|record|log)\b[\s\S]{0,60}?\b(?:execution\s+update|progress\s+update|update\s+log)\b|\brecord\s+what\s+changed\b/i },
  { tgt: "dependency", re: /\b(?:add|create|set)\b[\s\S]{0,60}?\bdependenc(?:y|ies)\b|\b(?:happen|happens|start|starts)\s+after\s+another\b|\bdepend(?:ent|s)?\s+on\b/i },
  { tgt: "sharepoint_folder", re: /\bsharepoint\s+folder\b|\b(?:project|workspace)\s+folder\b|\bconnect\s+(?:a\s+|the\s+)?project\s+to\s+sharepoint\b/i },
  { tgt: "task", re: /\b(?:add|create|complete|finish|reopen|mark)\b[\s\S]{0,40}?\btask\b/i },
  { tgt: "sprint", re: /\b(?:create|start)\b[\s\S]{0,40}?\bsprint\b/i },
];

const SCOPE_PATTERNS: Array<{ scope: WorkflowScope; re: RegExp }> = [
  { scope: "project_level", re: /\bproject[-\s]level\b/i },
  { scope: "phase_level", re: /\bphase[-\s]level\b|\b(?:to|under|inside|in)\s+(?:a\s+|the\s+|this\s+)?phase\b/i },
  { scope: "task_level", re: /\btask[-\s]level\b/i },
  { scope: "workspace_level", re: /\bworkspace[-\s]level\b/i },
  { scope: "program_level", re: /\bprogram[-\s]level\b/i },
];

function firstMatch<T>(
  text: string,
  patterns: Array<{ re: RegExp } & T>,
): (T & { matched: string }) | null {
  for (const p of patterns) {
    const m = text.match(p.re);
    if (m) return { ...p, matched: m[0] } as T & { matched: string };
  }
  return null;
}

function allMatches<T>(
  text: string,
  patterns: Array<{ re: RegExp } & T>,
): Array<T & { matched: string }> {
  const out: Array<T & { matched: string }> = [];
  for (const p of patterns) {
    const m = text.match(p.re);
    if (m) out.push({ ...p, matched: m[0] } as T & { matched: string });
  }
  return out;
}

function detectAmbiguity(
  question: string,
  objectFamily: WorkflowObjectFamily,
  ctx: FrameExtractionContext | undefined,
): boolean {
  const hasRouteContext =
    !!ctx?.route && /\/(project|program|phase|task|kpi|risk|blocker)/i.test(ctx.route);
  const hasObjectInText = HAS_ROUTE_OR_OBJECT_RE.test(question);
  const hasPronoun = PRONOUN_AMBIG_RE.test(question);
  const onlyBareStatusWord =
    BARE_STATUS_RE.test(question) && !hasObjectInText && objectFamily === "unknown";

  if (onlyBareStatusWord && !hasRouteContext) return true;
  if (hasPronoun && objectFamily === "unknown" && !hasObjectInText && !hasRouteContext) {
    return true;
  }
  if (/\b(?:add|create|update|close|edit|change|attach|record)\s+(?:it|this|that|one)\b/i.test(question) &&
      objectFamily === "unknown" && !hasObjectInText && !hasRouteContext) {
    return true;
  }
  return false;
}

/**
 * Extract a deterministic WorkflowFrame from a user question.
 */
export function extractWorkflowFrame(
  question: string,
  ctx?: FrameExtractionContext,
): WorkflowFrame {
  const q = (question || "").trim();

  const guidanceMatch = GUIDANCE_PREFIX_RE.test(q);
  const assistantActionRequest = ASSISTANT_ACTION_REQUEST_RE.test(q);
  const imperativeForMe = IMPERATIVE_FOR_ME_RE.test(q);
  const imperativeDirect = IMPERATIVE_DIRECT_RE.test(q);

  const objectHit = firstMatch(q, OBJECT_PATTERNS);
  const actionHit = firstMatch(q, ACTION_PATTERNS);
  const modifierHits = allMatches(q, MODIFIER_PATTERNS);
  const sourceHit = firstMatch(q, SOURCE_PATTERNS);
  const targetHit = firstMatch(q, TARGET_PATTERNS);
  const scopeHit = firstMatch(q, SCOPE_PATTERNS);

  let object_family: WorkflowObjectFamily = objectHit?.family ?? "unknown";
  // 0.7H: promote roadmap → export when a generated-document term is present
  // (e.g. "roadmap status deck"). Without this, OBJECT_PATTERNS picks
  // "roadmap" before "export" and we lose the deck workflow routing.
  if (object_family === "roadmap" &&
      /\b(?:status\s+deck|deck|powerpoint|power\s+point|\bppt\b|presentation|status\s+report|charter|generated\s+(?:document|deck|report)|exported\s+(?:report|deck))\b/i.test(q)) {
    object_family = "export";
  }
  let action: WorkflowAction = actionHit?.action ?? "unknown";
  // Choose strongest modifier — prefer template/scope/cadence over generic.
  const MOD_PRIORITY: WorkflowModifier[] = [
    "from_template", "as_template", "blank", "cadence_expectation",
    "evidence_record", "value_update", "project_level", "task_level",
    "phase_level", "from_program", "from_project", "status_only",
  ];
  let modifier: WorkflowModifier = "none";
  for (const p of MOD_PRIORITY) {
    if (modifierHits.some((m) => m.mod === p)) { modifier = p; break; }
  }
  let source_object: WorkflowSourceObject = sourceHit?.src ?? null;
  let target_object: WorkflowTargetObject = targetHit?.tgt ?? null;
  let scope: WorkflowScope = scopeHit?.scope ?? null;

  // ---- Post-processing rules ----------------------------------------------

  // Template-creation post-process: if template is referenced as source and
  // user wants to create a project, normalise to create_from_template.
  const mentionsTemplate = /\b(?:project\s+template|implementation\s+template|existing\s+template|standard\s+template|reuse\s+(?:an?\s+)?(?:existing\s+)?template|use\s+(?:it|the\s+template|this\s+template)|from\s+(?:a\s+|the\s+)?template|from\s+it)\b/i.test(q);
  const wantsCreateProject = /\b(?:create|start|spin\s+up|begin|make|build|kick\s+off|launch)\b[\s\S]{0,80}?\b(?:project)\b/i.test(q);
  if (mentionsTemplate && wantsCreateProject && (object_family === "project" || object_family === "project_template")) {
    object_family = "project";
    action = "create_from_template";
    modifier = "from_template";
    source_object = "project_template";
    target_object = "project";
  }


  // Blank project: if explicit "blank" / "from scratch" / "new project" but
  // no template wording, force create + project + no template modifier.
  const mentionsBlank = /\bblank\s+project\b|\bfrom\s+scratch\b|\bempty\s+project\b/i.test(q);
  if (object_family === "project" && wantsCreateProject && !mentionsTemplate) {
    action = "create";
    target_object = "project";
    source_object = null;
    if (mentionsBlank) modifier = "blank";
    else if (modifier === "from_template" || modifier === "as_template") modifier = "none";
  }

  // Save-as-template post-process
  if (/\b(?:save|turn|convert|make)\s+(?:this|the|my)\s+project\s+(?:as|into|to)\s+(?:a\s+)?template\b/i.test(q)) {
    object_family = "project";
    action = "save_as_template";
    modifier = "as_template";
    source_object = "project";
    target_object = "project_template";
  }

  // Dependency phrasing post-process — leave scope unset so the catalog's
  // canonical workflow-add-dependency (task_level) matches phase-phase and
  // task-task phrasing alike.
  if (object_family === "dependency") {
    action = "create";
    target_object = "dependency";
    scope = null;
    source_object = null;
  }


  // Execution-update phrasing post-process — guard against task-target hijack
  if (object_family === "execution_update") {
    action = action === "unknown" ? "create" : action;
    target_object = "execution_update";
  }

  // Blocker scope post-process
  if (object_family === "blocker") {
    if (/\bproject[-\s]level\b/i.test(q)) scope = "project_level";
    else if (/\b(?:my|the|a)\s+task\b|\bstopping\s+my\s+task\b|\bphase[-\s]level\b/i.test(q)) {
      scope = scope ?? "task_level";
    }
    target_object = "blocker";
    if (/\b(?:resolve|close|gone)\b/i.test(q)) {
      action = "complete";
    } else {
      action = action === "unknown" ? "create" : action;
    }
  }

  // SharePoint folder post-process
  // SharePoint folder post-process — clear stray "from a project" source so
  // connect/disconnect cards (source_object=null) still match.
  if (object_family === "sharepoint_folder") {
    if (/\bdisconnect|unlink|detach|unbind\b/i.test(q)) action = "disconnect";
    else if (action === "unknown" || /\bconnect|link\b/i.test(q)) action = "connect";
    target_object = "sharepoint_folder";
    source_object = null;
    scope = scope ?? "project_level";
  }


  // Governance cadence vs evidence post-process
  if (object_family === "governance_cadence") {
    action = "create";
    target_object = "governance_cadence";
    modifier = "cadence_expectation";
    scope = scope ?? "project_level";
  }
  if (object_family === "governance_evidence") {
    action = "record";
    target_object = "governance_record";
    modifier = "evidence_record";
    scope = scope ?? "project_level";
  }

  // KPI define vs update post-process
  if (object_family === "kpi") {
    const valueWord = /\b(?:value|number|actual|this\s+week'?s|enter\s+(?:the\s+)?(?:kpi\s+)?(?:value|number)|update\s+(?:a\s+|the\s+)?kpi\s+value)\b/i.test(q);
    const createWord = /\b(?:create|add|define|track|new)\b/i.test(q) && !valueWord;
    if (valueWord) {
      action = "update";
      modifier = "value_update";
    } else if (createWord) {
      action = "define";
      target_object = "kpi";
    }
  }

  // Task complete / reopen post-process
  if (object_family === "task") {
    if (/\breopen\b/i.test(q)) {
      action = "reopen";
      target_object = "task";
    } else if (/\b(?:mark|finish(?:ed)?|complete|done)\b/i.test(q) && !/\bcreate|add|new\b/i.test(q)) {
      action = "complete";
      target_object = "task";
    } else if (/\b(?:add|create)\b[\s\S]{0,40}?\btask\b/i.test(q)) {
      action = "create";
      target_object = "task";
    }
  }

  // 0.7G: My Work post-process — keep helper view route.
  if (object_family === "my_work") {
    action = "use";
  }

  // 0.7H/0.7I: Generated-document / status-deck / charter post-process.
  //   - Treat PowerPoint / PPT / deck / presentation / status deck / charter
  //     as BTPM generated-document workflows (object_family=export).
  //   - Compute a confidence-gated generated_artifact_type so the catalog
  //     guardrail can reject incompatible generate-* workflows.
  //   - Generic PPT/deck/report wording (no charter / no project-status / no
  //     multi-project signal) becomes generic_generated_document AND triggers
  //     ambiguity → clarification_needed downstream.
  let generated_artifact_type: WorkflowGeneratedArtifactType = "unknown";
  let generated_artifact_confidence: WorkflowGeneratedArtifactConfidence = "low";
  if (object_family === "export") {
    const isExplicitPowerBI = /\bpower\s*bi\b|\bpbi\b|\bbi\s+report\b|\bbi\s+dashboard\b|\bsemantic\s+model\b|\bpower\s*bi\s+workspace\b/i.test(q);
    if (!isExplicitPowerBI) {
      const mentionsCharter = /\bcharter\b/i.test(q);
      const multiProject = /\b(?:several\s+projects?|multiple\s+projects?|many\s+projects?|all\s+(?:selected\s+|filtered\s+)?projects?|selected\s+projects?|filtered\s+projects?|cross[-\s]?project|portfolio|roadmap|workspace\s+report|program\s+report|across\s+(?:projects?|the\s+portfolio))\b/i.test(q)
        || /\bone\s+(?:ppt|deck|presentation|powerpoint|report)\s+for\s+(?:several|multiple|many|all|the|various|different)\s+projects?\b/i.test(q);
      const projectStatusDeckSignal = /\b(?:project\s+status\s+(?:deck|ppt|presentation|report|powerpoint|update)|weekly\s+project\s+status|weekly\s+status\s+(?:deck|ppt|presentation|report)|project[-\s]level\s+(?:deck|status|status\s+deck|status\s+report)|status\s+deck\s+for\s+(?:this\s+|the\s+|my\s+|one\s+|a\s+)?project|one\s+project\s+status\s+deck|status\s+deck)\b/i.test(q);
      const isDeckOrCharterOrPPT = /\b(?:deck|powerpoint|power\s+point|\bppt\b|presentation|status\s+report|charter|generated\s+(?:document|deck|report)|exported\s+(?:report|deck))\b/i.test(q)
        || /\bexport\s+(?:a\s+|the\s+)?report\b/i.test(q);

      if (isDeckOrCharterOrPPT || /\b(?:status\s+deck|project\s+deck|roadmap\s+(?:status\s+)?deck)\b/i.test(q)) {
        action = "generate";
        target_object = "file";

        if (mentionsCharter) {
          generated_artifact_type = "project_charter";
          generated_artifact_confidence = "high";
          scope = "project_level";
        } else if (multiProject) {
          generated_artifact_type = "roadmap_status_deck";
          generated_artifact_confidence = "high";
          scope = "workspace_level";
        } else if (projectStatusDeckSignal) {
          generated_artifact_type = "project_status_deck";
          generated_artifact_confidence = "high";
          scope = "project_level";
        } else {
          // Generic PowerPoint / PPT / deck / presentation / report with no
          // charter / no project-status / no multi-project signal.
          generated_artifact_type = "generic_generated_document";
          generated_artifact_confidence = "low";
          // Leave scope null so neither project nor workspace candidate
          // pre-empts the clarification. Downstream ambiguity_flag below
          // forces clarification_needed.
          scope = null;
        }
      } else if (action === "unknown") {
        action = "export";
      }
    }
  }


  // 0.7G: File upload / project documents.
  if (object_family === "file") {
    if (action === "unknown" || /\b(?:upload|add)\b/i.test(q)) {
      action = "manage";
    }
  }

  // 0.7G: Backlog → sprint
  if (object_family === "backlog_item" && /\b(?:to|into)\s+(?:a\s+|the\s+|this\s+)?sprint\b/i.test(q)) {
    action = "add_to";
    target_object = "sprint";
    scope = "project_level";
  }

  // 0.7G: Workspace member role
  if (object_family === "workspace_member") {
    action = "manage";
    scope = "workspace_level";
  }

  // 0.7G: Workspace access vs project access
  if (object_family === "workspace_access") {
    if (/\bproject\s+access\b/i.test(q)) {
      // project-level access management
      scope = "project_level";
      action = "manage";
    } else if (action === "unknown") {
      action = "manage";
      scope = "workspace_level";
    }
  }

  // 0.9D — Progress / contribution reporting guardrail (semantic, not
  // question-hardcoded). When the user asks how to REPORT progress /
  // contribution / work / status / execution and is NOT explicitly asking to
  // CREATE a project / program / phase / task, force the frame to the
  // execution_update family so workflow-add-execution-update wins instead of
  // a stray create-project / create-task / use-roadmap workflow, or an
  // "unsupported_safe_guidance" no-verified-workflow verdict.
  //
  // Existing detections that already represent a more specific reporting
  // surface (governance evidence/cadence, KPI value updates, blockers,
  // risks, comments, execution_update itself, generated decks) are preserved.
  // The override requires EITHER a strong reporting phrase (report progress,
  // did work, finished work, contributed, submit weekly update, etc.) OR a
  // concrete BTPM object word in the question (task, phase, project, ...).
  // Bare phrasings like "update status" alone are still ambiguous and remain
  // clarification_needed.
  const hasReportingObjectContext = HAS_ROUTE_OR_OBJECT_RE.test(q) || /\bwork\b/i.test(q);
  // 0.9E — "should I add a comment or an execution update?" is a concept
  // decision question; do not force the verified add-execution-update
  // workflow on the user.
  const isCommentVsExecutionUpdateDecision =
    /\b(?:comment\s+or\s+(?:an?\s+)?execution\s+update|execution\s+update\s+or\s+(?:a\s+)?comment)\b/i.test(q);
  if (
    isProgressReportingIntent(q) &&
    !isCommentVsExecutionUpdateDecision &&
    (STRONG_PROGRESS_REPORTING_RE.test(q) || hasReportingObjectContext) &&
    object_family !== "governance_evidence" &&
    object_family !== "governance_cadence" &&
    object_family !== "kpi" &&
    object_family !== "kpi_snapshot" &&
    object_family !== "kpi_app" &&
    object_family !== "comment" &&
    object_family !== "blocker" &&
    object_family !== "risk" &&
    object_family !== "export"
  ) {
    // 0.9E — normalize to execution_update/create even when object_family
    // is already execution_update. Without this, "how can I report progress
    // update?" detects execution_update + action=update and the verified
    // workflow-add-execution-update (action=create) gets rejected.
    object_family = "execution_update";
    action = "create";
    target_object = "execution_update";
    source_object = null;
    modifier = "none";
    scope = null;
  }

  // ---- Intent classification ----------------------------------------------

  let intent_type: WorkflowIntentType;
  if (assistantActionRequest) {
    intent_type = "perform_action_request";
  } else if (guidanceMatch) {
    intent_type = "workflow_guidance";
  } else if (imperativeForMe) {
    intent_type = "perform_action_request";
  } else if (imperativeDirect && object_family !== "unknown") {
    intent_type = "perform_action_request";
  } else {
    intent_type = "workflow_guidance";
  }

  // Ambiguity check
  let ambiguity_flag = detectAmbiguity(q, object_family, ctx);
  // Generic "add a blocker" without scope qualifier → clarification
  if (!ambiguity_flag && object_family === "blocker" && (action === "create" || action === "unknown") &&
      !scope && !/\b(?:project|task|phase|my\s+task|the\s+task|a\s+task|stopping)\b/i.test(q)) {
    ambiguity_flag = true;
  }
  // 0.7I: Generic generated-document wording (PowerPoint / PPT / deck /
  // presentation / report) without a charter / project-status / multi-project
  // signal is ambiguous between Project Status Deck and Roadmap Status Deck.
  // Force clarification so the answer planner explains both verified options
  // and never silently picks Project Charter.
  if (!ambiguity_flag &&
      object_family === "export" &&
      generated_artifact_type === "generic_generated_document") {
    ambiguity_flag = true;
  }
  if (ambiguity_flag && intent_type !== "perform_action_request") {
    intent_type = "clarification_needed";
  }

  const helperTermsMatch = q.match(HELPER_TERM_RE);
  const helper_terms_present: string[] = helperTermsMatch ? [helperTermsMatch[0].toLowerCase()] : [];

  return {
    intent_type,
    object_family,
    action,
    modifier,
    source_object,
    target_object,
    scope,
    ambiguity_flag,
    question_text: q,
    helper_terms_present,
    generated_artifact_type,
    generated_artifact_confidence,
    raw_terms: {
      guidance_markers: guidanceMatch ? ["guidance_prefix"] : [],
      imperative_markers: [
        ...(assistantActionRequest ? ["assistant_action_request"] : []),
        ...(imperativeForMe ? ["imperative_for_me"] : []),
        ...(imperativeDirect ? ["imperative_direct"] : []),
      ],
      ambiguity_markers: ambiguity_flag ? ["pronoun_or_bare_noun_without_object_or_route"] : [],
      object_markers: objectHit ? [objectHit.matched] : [],
      action_markers: actionHit ? [actionHit.matched] : [],
      modifier_markers: modifierHits.map((m) => m.matched),
    },
  };
}
