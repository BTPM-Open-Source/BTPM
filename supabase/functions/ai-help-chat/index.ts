// BTPM Guide — AI Help chat edge function (AI-KC.4)
// Knowledge-Center-only grounding with body-aware + metadata-aware retrieval.
// No operational PM data is read. No raw prompts/bodies/answers are logged.
import { createClient } from "npm:@supabase/supabase-js@2";
import { resolveActiveOrganizationId, toSafeActiveOrganizationPublicError } from "../_shared/activeOrganizationContext.ts";
import { resolveGuideTextProviderRuntime, toSafeGuideProviderPublicError, type GuideTextProviderRuntimeConfig } from "../_shared/guideTextProviderRuntime.ts";
import { postTenantAiChatCompletion } from "../_shared/tenantAiChatCompletionsClient.ts";
import { getOpenAiChatBodyTraits } from "../_shared/ai-guide-v2/openai-model-traits.ts";
import { assertBrowserSessionOnly } from "../_shared/btpm-api/assertBrowserSessionOnly.ts";
import { createSupabaseTokenVerifier } from "../_shared/btpm-api/resolveTokenContext.ts";
import { toSafeErrorResponse } from "../_shared/btpm-api/apiErrors.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const OUT_OF_SCOPE =
  "I do not have enough Knowledge Center information to answer that. Please check the Knowledge Center or ask an admin to add an article.";

const SYSTEM_PROMPT = `You are BTPM Guide, the in-app help assistant for BTPM. You answer only questions about BTPM usage, concepts, screens, workflows, and governance based on the Knowledge Center context provided to you. You must not use outside knowledge. You must not answer questions about company operational project data, SharePoint files, Power BI data, emails, users, or admin records unless the provided Knowledge Center context explains the concept generally. Keep answers concise, practical, and step-by-step where helpful. When the user asks "what do I do here?", use the provided page/route context and the Knowledge Center articles related to that route. Do not invent features, data, or permissions.

DIRECT ACTION GUARDRAIL — CRITICAL:
You cannot create, update, delete, assign, send, schedule, or otherwise mutate any BTPM records, emails, files, or external systems. You also cannot read operational project data (actual tasks, risks, KPIs, files, users, projects) or SharePoint/Power BI/Outlook content.
This refusal applies ONLY when the user is asking YOU (BTPM Guide) to PERFORM the action — e.g. "change the baseline dates for me", "update this KPI now", "create the project for me", "send the invite", "read my SharePoint file". Signals of perform-action intent include phrases like "for me", "do it", "now", "please update/change/create", "make the change", or a direct imperative addressed to the assistant.
GUIDANCE QUESTIONS ARE DIFFERENT. When the user asks "how can I…", "how do I…", "where do I…", "what should I do…", "guide me through…", or "can I…" — they are asking for instructions, NOT asking you to perform the action. For guidance questions you MUST answer directly with the verified BTPM workflow and MUST NOT open with "I can't create or update records for you" or "I can't read your operational project data". Only mention what BTPM Guide cannot do when it is essential to explain why a workflow is not supported, and never as the first sentence.
When the user IS asking you to perform the action, you MUST:
1. Begin with a concise, action-specific refusal — name the exact thing you cannot do (e.g. "I can't change baseline dates for you", "I can't update this KPI for you", "I can't send the invite for you"). Use the exact phrases "I can't" or "I cannot" so the limitation is unambiguous. Do NOT add "I can't read your operational project data" unless the user explicitly asked you to read or inspect real project/SharePoint/Power BI/Outlook data — keep the refusal tightly scoped to what was requested.
2. Never claim the action was performed.
3. Immediately after the one-sentence refusal, give the verified safe workflow the user can follow themselves in BTPM (from the verified action block or KC sources).

NO-GUESS UI CONTRACT — CRITICAL:
Never invent UI controls, buttons, menus, locations, permissions, or capabilities. For procedural "how do I…" or "where do I click…" questions, you may only describe click-by-click UI steps that are explicitly listed in a VERIFIED UI ACTION block below or that appear verbatim in the Knowledge Center sources. Do not use phrases such as "look for", "locate", "find the option", "may be", "might be", "could be", "typically", "usually", "probably", "if available", "similar", "something like", "this may be", "section designated for", or "section dedicated to" as part of procedural UI guidance. If exact UI steps are not provided in the verified action block or the Knowledge Center sources, answer with this safe-limited pattern instead: "I can explain the purpose, but BTPM Guide does not have verified click-by-click steps for this action yet." then list what you can confirm (concept from KC), what you cannot confirm (exact button, exact section, whether enabled in this setup), name the page where the action lives, and recommend asking a Workspace Admin or Product Owner to confirm. Do NOT invent a control or page section.

NO FABRICATED WORKFLOW — CRITICAL:
Never create a workflow from general project-management knowledge. If the exact BTPM UI flow is not present in a verified action registry block or provided KC sources, do not invent steps. Do not name pages, buttons, settings areas, modals, or actions unless verified. For procedural-or-safe-limit questions where the action is unverified or unsupported, state the limitation plainly and offer the verified safe next step (for example, "use Rebaseline on the Project Overview after a governance decision" for baseline changes). Never invent "Baseline Settings", "Add Dependency button", "select the existing baseline", "create a new baseline", "set new dates", or "save changes" if the verified action block or KC sources do not confirm them. For unsupported workflows (for example, editing approved baseline dates directly), say BTPM does not support it and refer the user to the verified safe alternative.

OPERATIONAL-DATA REFUSAL — CRITICAL:
You cannot read operational project data, actual project records, real KPI values, real blockers/risks/tasks/files, SharePoint file contents, another user's tasks, or yesterday's/today's actual updates. When the user asks for actual project content (e.g. "what blockers are currently open in Project X", "what is the current KPI value", "summarize my SharePoint file"), you MUST begin with an explicit refusal using one of these exact phrasings: "I cannot read operational project data.", "I cannot access actual project records.", "I cannot read SharePoint file contents.", or "I cannot view another user's tasks or private project records." Then provide safe navigation guidance (which BTPM page the user should open). Never invent or guess actual data values.

If relevant Knowledge Center sources are provided in the context, answer from them. Do not say there is not enough Knowledge Center information unless the provided sources truly do not answer the question. If the question is clearly outside BTPM scope (travel, general world knowledge, personal advice, etc.), politely redirect the user to the BTPM Knowledge Center scope instead of answering, and do not cite unrelated articles.`;


interface ReqBody {
  conversation_id?: string;
  message?: string;
  context_route?: string;
  context_label?: string;
  debug?: boolean;
  evaluation_mode?: boolean;
  expected_sources?: string[];
  question_id?: string;
}

interface ArticleListItem {
  id: string;
  title: string;
  slug: string;
  summary: string | null;
  tooltip_excerpt: string | null;
  related_route: string | null;
  article_type: string;
}

interface ArticleDetail extends ArticleListItem {
  body: string | null;
}

interface ArticleAiMetadata {
  article_id: string;
  ai_flow: string | null;
  feature_area: string[] | null;
  route_patterns: string[] | null;
  user_intents: string[] | null;
  audience: string[] | null;
  synonyms: string[] | null;
  freshness_label: string | null;
  related_feature_flags: string[] | null;
  question_examples: string[] | null;
  answer_rules: string[] | null;
  forbidden_claims: string[] | null;
}

// ---------- Normalization & synonyms ----------

const STOP = new Set([
  "the","and","for","with","what","how","does","this","that","are","you","your","can","use","using","from","into","about","when","why","who","where","which","page","here","app","btpm","a","an","is","of","to","in","on","or","do","i","my","me","it","be","as","at","by","if","but","not","so","we","our","us",
]);

// Lightweight singular/plural normalizer
function stem(w: string): string {
  if (w.length <= 3) return w;
  if (w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.endsWith("sses")) return w.slice(0, -2);
  if (w.endsWith("ing") && w.length > 5) return w.slice(0, -3);
  if (w.endsWith("ed") && w.length > 4) return w.slice(0, -2);
  if (w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

function tokenize(s: string): string[] {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s\/:_-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .map(stem);
}

function tokensNoStop(s: string): string[] {
  return tokenize(s).filter((t) => !STOP.has(t));
}

// BTPM domain aliases — expand the user's query before scoring.
const SYNONYM_MAP: Array<[RegExp, string]> = [
  [/\bagile project\b/gi, "agile mode"],
  [/\bagile setting\b/gi, "agile mode"],
  [/\bpowerpoint\b/gi, "ppt deck"],
  [/\bpower point\b/gi, "ppt deck"],
  [/\bppt\b/gi, "deck"],
  [/\bslides?\b/gi, "deck"],
  [/\bstatus report\b/gi, "status deck"],
  [/\bweekly report\b/gi, "status deck"],
  [/\bkanban\b/gi, "board"],
  [/\bsprint cycle\b/gi, "sprint"],
  [/\bproject plan\b/gi, "planning"],
  [/\bgantt chart\b/gi, "gantt"],
  [/\btraffic light\b/gi, "health"],
  [/\brag\b/gi, "health"],
  [/\bbaseline plan\b/gi, "baseline"],
  [/\bpeople\b/gi, "team raci"],
  [/\broles\b/gi, "team raci"],
  [/\bresponsibility\b/gi, "raci"],
  [/\bbi report\b/gi, "power bi"],
  [/\bdashboard\b/gi, "power bi kpi"],
  [/\bguide\b/gi, "btpm guide"],
  [/\bhelp ?bot\b/gi, "btpm guide"],
  // Access / visibility troubleshooting
  [/\bcan'?t see (the |a |my )?project\b/gi, "project access visibility workspace access"],
  [/\bcannot see (the |a |my )?project\b/gi, "project access visibility workspace access"],
  [/\bmissing project\b/gi, "project access visibility"],
  [/\bproject not visible\b/gi, "project access visibility"],
  [/\bno access to (the |a |my )?project\b/gi, "project access workspace access"],
  [/\bproject access\b/gi, "project level access control"],
  [/\bworkspace access\b/gi, "project level access control"],
];

// Slugs that should be boosted strongly for access-troubleshooting queries.
const ACCESS_BOOST_SLUGS = new Set([
  "why-cant-i-see-a-project",
  "project-level-access-control",
]);
function isAccessQuery(q: string): boolean {
  const s = q.toLowerCase();
  return (
    /\bcan'?t see\b/.test(s) ||
    /\bcannot see\b/.test(s) ||
    /\bnot visible\b/.test(s) ||
    /\bmissing project\b/.test(s) ||
    /\bno access\b/.test(s) ||
    /\bwhy can'?t i\b/.test(s) ||
    /\bproject access\b/.test(s) ||
    /\bworkspace access\b/.test(s)
  );
}

// Deck / PPT export intent (AI-KC.4.2, narrowed in AI-KC.4.3).
// PowerPoint / PPT alone must NOT trigger deck-generation boost — only when the
// user clearly wants to generate/export/download a deck or report.
function isDeckExportQuery(q: string): boolean {
  const s = q.toLowerCase();
  // Hard signals: explicit verbs combined with a deck/report noun.
  const verbNoun =
    /\b(export|generate|create|download|build|make|produce|get|how (do|to) (i )?(make|create|generate|export|download|get))\b[^.?!]{0,40}\b(report|deck|ppt|power ?point|slides?|presentation|status deck|roadmap deck)\b/.test(
      s,
    );
  // Or unambiguous deck phrasing on its own.
  const deckPhrase =
    /\b(status deck|roadmap deck|project status deck|weekly status deck|presentation report)\b/.test(
      s,
    );
  return verbNoun || deckPhrase;
}
function mentionsPowerBi(q: string): boolean {
  return /\bpower ?bi\b/i.test(q);
}
function isRoadmapContext(route: string | null, label: string | null, q: string): boolean {
  const s = `${route || ""} ${label || ""} ${q}`.toLowerCase();
  return /roadmap/.test(s);
}

// AI-KC.4.3 — SharePoint/document sync-back intent. The user is asking whether
// editing a file in SharePoint reflects back into BTPM. This is a concept
// question; the canonical answer lives in `sharepoint-output-behavior`.
function isSharepointSyncQuery(q: string): boolean {
  const s = q.toLowerCase();
  const mentionsSharepoint = /\bshare ?point\b/.test(s);
  const mentionsFileLike =
    /\b(power ?point|ppt|deck|slides?|presentation|document|file|excel|word|pdf)\b/.test(s);
  const editOrSync =
    /\b(edit|editing|update|updating|change|changes|changing|modify|modifying|sync|syncing|reflect|reflected|reflects|push|pushed|pushes|write|writes|writing|save|saves|saved|saving)\b/.test(
      s,
    );
  const syncBackPhrase =
    /\b(sync(ed)? back|reflect(ed)? back|update btpm|updates btpm|push(ed)? back to btpm|back to btpm|into btpm)\b/.test(
      s,
    );
  if (syncBackPhrase) return true;
  if (mentionsSharepoint && editOrSync) return true;
  if (mentionsSharepoint && mentionsFileLike && /\bbtpm\b/.test(s)) return true;
  return false;
}
const SHAREPOINT_SYNC_BOOST_SLUGS = new Set([
  "sharepoint-output-behavior",
  "generated-documents-in-btpm",
]);
const SHAREPOINT_SYNC_SECONDARY_SLUGS = new Set([
  "weekly-project-status-deck",
  "roadmap-status-deck",
]);

const ROADMAP_DECK_BOOST_SLUGS = new Set([
  "roadmap-status-deck",
  "using-roadmap",
  "generated-documents-in-btpm",
  "saved-views-and-filters",
]);
const PROJECT_DECK_BOOST_SLUGS = new Set([
  "weekly-project-status-deck",
  "generated-documents-in-btpm",
]);
const POWER_BI_SLUGS = new Set([
  "power-bi-in-btpm",
  "using-power-bi-admin-page",
]);

// AI-KC.QA.2G — Project-creation how-to intent. The user is asking how to
// create a new project in BTPM. Boost the procedural article and suppress the
// direct-action guardrail for these phrasings.
const CREATE_PROJECT_HOWTO_PATTERNS: RegExp[] = [
  /\bhow (do|to|can) (i |you )?(create|start|open|make|add|set up|setup) (a |an |the )?(new )?project\b/i,
  /\bguide me (how )?to (create|start|open|make|add) (a |an |the )?(new )?project\b/i,
  /\bwhere (is|do i find) (the )?new project (button|option)\b/i,
  /\bcreate (a |an |the )?project (from|using) (a )?template\b/i,
  /\b(blank|new) project\b.*\?$/i,
  /\bwhy can'?t i (see|find) (the )?new project (button|option)\b/i,
];
function isCreateProjectHowToQuery(q: string): boolean {
  return CREATE_PROJECT_HOWTO_PATTERNS.some((re) => re.test(q));
}
const CREATE_PROJECT_PRIMARY_SLUG = "how-to-create-a-project";

// AI-FLOW.2C — Procedural workflow vs BTPM Guide meta intent detection.
// "Guide me how to update a task" is procedural workflow intent, NOT a
// question about BTPM Guide itself. Without this distinction, retrieval
// gives top score to BTPM Guide meta articles (what-is-btpm-guide etc.).
const PROCEDURAL_VERB_PATTERNS: RegExp[] = [
  /\bguide me\b/i,
  /\bwalk me through\b/i,
  /\bshow me how\b/i,
  /\bhow (do|to|can|should) (i|you|we)\b/i,
  /\bhow to\b/i,
  /\bwhere (do|should) (i|you) click\b/i,
  /\bwhere (do|should) (i|you) (go|find)\b/i,
  /\bwhat (do|should) i (do|click|check|open|fill)\b/i,
  /\bwhy can'?t i\b/i,
  /\bhelp me (set ?up|configure|create|update|add|connect|generate|capture|submit|invite|resolve|record|open)\b/i,
  /\b(create|update|add|connect|generate|capture|submit|invite|resolve|record|open|configure|set ?up) (a |an |the |my |this |new )/i,
];
function isProceduralWorkflowQuery(q: string): boolean {
  return PROCEDURAL_VERB_PATTERNS.some((re) => re.test(q));
}

const BTPM_GUIDE_META_PATTERNS: RegExp[] = [
  /\bwhat (is|does) btpm guide\b/i,
  /\bwhat can btpm guide do\b/i,
  /\bhow (do|should) (i|admins?) use btpm guide\b/i,
  /\bwhy (is|does) btpm guide (not |never )?(answer|say|return|give)/i,
  /\bbtpm guide (not |isn'?t |is not )?answer/i,
  /\bbtpm guide.*not enough information\b/i,
  /\bbtpm guide.*weak sources?\b/i,
  /\bbtpm guide evaluation\b/i,
  /\bpass.*warn.*fail\b/i,
];
function isBtpmGuideMetaQuery(q: string): boolean {
  return BTPM_GUIDE_META_PATTERNS.some((re) => re.test(q));
}

const BTPM_GUIDE_META_SLUGS = new Set([
  "what-can-btpm-guide-do-for-me",
  "what-is-btpm-guide",
  "how-admins-use-btpm-guide-evaluation",
  "why-btpm-guide-not-enough-information",
  "why-btpm-guide-not-answering",
  "why-btpm-guide-answer-weak-sources",
]);

// Targeted workflow boost rules — each rule contributes additive points for
// matching slugs when its trigger regex hits the raw query.
interface WorkflowBoostRule {
  name: string;
  trigger: RegExp;
  boosts: Record<string, number>;
  penalties?: Record<string, number>;
}
const WORKFLOW_BOOST_RULES: WorkflowBoostRule[] = [
  {
    name: "dependency",
    trigger: /\b(dependency|dependencies|waiting for (another|one)|predecessor|successor|connect one task|task as waiting)\b/i,
    boosts: {
      "how-to-add-a-dependency": 25,
      "dependencies-rulebook": 15,
      "faq-are-dependencies-only-visual": 8,
      "using-project-planning-page": 6,
      "using-project-gantt": 6,
    },
  },
  {
    name: "task_progress",
    trigger: /\b(task progress|update (a |the )?task|update progress|execution update|progress update|comment or execution update|status update)\b/i,
    boosts: {
      "how-to-update-execution": 25,
      "comment-vs-execution-update-rulebook": 15,
      "using-task-detail-page": 10,
    },
  },
  {
    name: "gantt",
    trigger: /\b(gantt|project timeline|review timeline|edit mode|schedule|phases and tasks on timeline)\b/i,
    boosts: {
      "using-project-gantt": 25,
      "roadmap-and-gantt": 15,
      "dependencies-rulebook": 6,
    },
  },
  {
    name: "risk_blocker",
    trigger: /\b(risk|blocker|resolve blocker|manage risk|mitigation|close blocker|remove blocker)\b/i,
    boosts: {
      "how-to-manage-risks-and-blockers": 25,
      "risk-vs-blocker-rulebook": 15,
      "using-risks-and-blockers-page": 12,
      "faq-risk-or-blocker": 10,
    },
  },
  {
    name: "kpi_snapshot",
    trigger: /\b(snapshot|snapshotting|kpi snapshot|official kpi snapshot|capture kpi|capture snapshot)\b/i,
    boosts: {
      "how-to-capture-kpi-snapshots": 25,
      "official-kpi-snapshots-vs-manual-update-history": 18,
      "using-project-kpis": 8,
    },
  },
  {
    name: "kpi_app",
    trigger: /\b(kpi app|submit kpi|submitting kpi|kpi submission|report not ready|readiness|mapping|external kpi|reporting period)\b/i,
    boosts: {
      "using-kpi-app-admin-page": 25,
      "why-kpi-app-report-not-ready": 20,
      "kpi-readiness-statuses": 15,
      "kpi-automation-protocol": 8,
    },
    penalties: {
      "how-to-update-kpis": 6,
      "kpi-definitions-and-updates": 6,
      "kpi-dashboard-and-reporting-consumption": 6,
      "how-to-configure-project-kpis": 4,
    },
  },
  {
    name: "kpi_app_approve",
    trigger: /\b(approve|auto[- ]?submit|automatically (approve|submit))\b/i,
    boosts: {
      "can-btpm-automatically-approve-kpi-submissions": 6,
    },
  },
  {
    name: "governance_evidence",
    trigger: /\b(governance review|record governance|governance evidence|steerco happens|record review|review happened|evidence|decision|follow-?up)\b/i,
    boosts: {
      "how-to-record-governance-evidence": 25,
      "using-project-governance": 12,
      "governance-cadence-vs-record": 10,
      "project-governance-traceability": 8,
      "governance-overview-and-calendar": 6,
    },
  },
];

// AI-FLOW.2E — Deno-side mirror of the verified UI Action Registry.
// Mirrors src/data/btpmGuideUiActionRegistry.ts for procedural answers.
interface UiAction {
  action_id: string;
  verified: boolean;
  page_label: string;
  exact_steps: string[];
  required_ui_terms: string[];
  permission_note?: string;
  not_supported?: string[];
  trigger_phrases: string[];
}
const UI_ACTIONS: UiAction[] = [
  {
    action_id: "add_dependency",
    verified: true,
    page_label: "Task / Phase / Project Overview — Dependencies panel",
    exact_steps: [
      "Open the Task, Phase, or Project that should be blocked by another item.",
      "Scroll to the Dependencies panel (heading 'Dependencies').",
      "In the predecessor dropdown, pick the same-level item that must finish first.",
      "Click the 'Blocked by' button to add the dependency.",
      "The new dependency appears under 'Blocked by' with an 'FS' (Finish-to-Start) badge; remove with the X icon.",
    ],
    required_ui_terms: ["Dependencies", "Blocked by", "predecessor", "FS"],
    permission_note: "Requires project planning authority (edit permission); panel is read-only otherwise.",
    not_supported: [
      "Creating or editing dependencies directly from the Gantt timeline (Gantt shows arrows only, no add/remove control).",
      "Cross-level dependencies (project → task). Only same-level Finish-to-Start dependencies are supported in v1.",
    ],
    trigger_phrases: ["add a dependency", "create a dependency", "add dependency", "make a dependency", "task dependency", "waiting for another", "blocked by", "predecessor", "add dependency button", "dependency from gantt", "dependencies from gantt", "edit dependency", "connect one task as waiting"],
  },
  {
    action_id: "create_blank_project",
    verified: true,
    page_label: "Projects",
    exact_steps: [
      "Open Projects (switch workspace first if needed).",
      "Click 'New project'.",
      "Choose 'Blank'.",
      "Enter the Project name and optionally pick a Program.",
      "Click 'Create project'. BTPM opens the new project page.",
    ],
    required_ui_terms: ["Projects", "New project", "Blank", "Project name", "Create project"],
    permission_note: "Requires workspace permission to create projects. If 'New project' is not visible, ask a Workspace Admin.",
    trigger_phrases: ["create a project", "create a new project", "create blank project", "new project button", "start a project", "make a project"],
  },
  {
    action_id: "create_project_from_template",
    verified: true,
    page_label: "Projects",
    exact_steps: [
      "Open Projects.",
      "Click 'New project'.",
      "Choose 'From template'.",
      "Pick the template and a Project start date.",
      "Enter the Project name (and optional Program), then click 'Create from template'.",
    ],
    required_ui_terms: ["Projects", "New project", "From template", "template", "Project start date", "Create from template"],
    permission_note: "Requires workspace permission to create projects.",
    trigger_phrases: ["create project from template", "from template", "project template", "use a template"],
  },
  {
    action_id: "baseline_review",
    verified: true,
    page_label: "Project Overview — Baseline section",
    exact_steps: [
      "Open the Project Overview.",
      "Scroll to the Baseline section. It shows the current plan vs the approved baseline and a variance in days.",
      "Use this section to compare planned dates against the approved baseline. Baseline-related events appear in the Baseline history list.",
    ],
    required_ui_terms: ["Project Overview", "Baseline", "current plan", "approved baseline", "variance", "Baseline history"],
    permission_note: "Read-only for users without project edit rights.",
    trigger_phrases: ["where do i see baseline", "view baseline", "review baseline", "baseline vs current plan", "what is the baseline"],
  },
  {
    action_id: "baseline_refresh_or_capture",
    verified: true,
    page_label: "Project Overview — Baseline section",
    exact_steps: [
      "If approved baseline dates need to change, do NOT edit individual baseline dates — there is no Baseline Settings page and no per-date baseline editor.",
      "First, update the current plan (planned dates) on the Project Planning page so the new dates exist in BTPM.",
      "Record the governance reason/evidence for replacing the baseline (formal governance approval is required).",
      "Open the project and go to Project Overview.",
      "Scroll to the Baseline section.",
      "If the project has not been baselined yet, click 'Approve baseline' (after the preflight shows 'Ready to baseline') to freeze the current dates as the approved baseline.",
      "If an approved baseline already exists and governance has approved replacing it, click 'Rebaseline'. Confirm the preflight dialog 'Rebaseline this project?'.",
      "Understand the consequences: Rebaseline OVERWRITES the existing approved baseline with the current planned dates; the previous baseline is not recoverable; the action is logged in Baseline history.",
    ],
    required_ui_terms: ["Project Overview", "Baseline", "Approve baseline", "Rebaseline", "current plan", "Baseline history"],
    permission_note: "Requires project planning authority. Rebaseline should follow a formal governance decision; it cannot be undone and does not create a parallel baseline.",
    not_supported: [
      "Editing approved baseline dates directly (no Baseline Settings page, no per-date baseline editor).",
      "Creating a brand-new baseline alongside an approved baseline. Rebaseline OVERWRITES the existing one.",
      "Editing the baseline from the Gantt timeline or the Project Planning page.",
    ],
    trigger_phrases: [
      "approve baseline", "rebaseline", "refresh baseline", "capture baseline", "freeze baseline",
      "set the baseline", "set baseline", "create a baseline", "new baseline",
      // AI-FLOW.3B — promote the "change baseline dates" intent onto the verified Rebaseline action
      "change baseline dates", "change the baseline dates", "edit approved baseline",
      "edit baseline dates", "change approved baseline", "modify baseline",
      "baseline settings", "baseline already approved", "already set and approved",
      "change baseline date", "update baseline dates", "rebaseline dates",
    ],
  },
];

const GUIDANCE_QUESTION_PATTERNS: RegExp[] = [
  /^\s*(how|where|what|when|why|which|can i|could i|do i|is it possible|guide me|walk me through|explain|show me|tell me how|what should i do|what do i do)\b/i,
];
// AI-FLOW.3A — signals that the user is asking BTPM Guide to PERFORM the
// action itself (assistant-performance intent), not asking for guidance.
// When any of these are present alongside an action verb, we treat the
// request as a direct-action request regardless of a "how/where" prefix.
const PERFORM_ACTION_PATTERNS: RegExp[] = [
  /\bfor me\b/i,
  /\bfor us\b/i,
  /\b(do|run|execute|trigger|perform|handle) it\b/i,
  /\b(please|pls|kindly)\s+(update|change|edit|create|set|assign|send|submit|delete|remove|approve|reject|invite|grant|make)\b/i,
  /\b(go ahead|just)\s+(and\s+)?(update|change|edit|create|set|assign|send|submit|delete|approve|invite|grant|make)\b/i,
  /\bmake the change(s)?\b/i,
  /\bupdate (this|that|it) now\b/i,
  /\b(now|right now|immediately)\b\s*[!.?]?\s*$/i,
  /\bcan you (please )?(update|change|edit|create|set|assign|send|submit|delete|remove|approve|reject|invite|grant|make)\b/i,
];
function isGuidanceQuery(q: string): boolean {
  if (!q) return false;
  if (PERFORM_ACTION_PATTERNS.some((re) => re.test(q))) return false;
  return GUIDANCE_QUESTION_PATTERNS.some((re) => re.test(q));
}
function isPerformActionQuery(q: string): boolean {
  return !!q && PERFORM_ACTION_PATTERNS.some((re) => re.test(q));
}



const UNVERIFIED_ACTIONS: Array<{ action_id: string; page_label: string; triggers: string[] }> = [
  { action_id: "create_phases_and_tasks", page_label: "Project Planning", triggers: ["create phases and tasks", "create a phase", "build a project plan"] },
  { action_id: "add_task_to_phase", page_label: "Project Planning / Phase row", triggers: ["add a task", "add task to phase", "new task button"] },
  { action_id: "update_execution", page_label: "Task Detail", triggers: ["update task status", "execution update", "write an execution update"] },
  { action_id: "use_gantt", page_label: "Project Gantt", triggers: ["edit project dates from gantt", "use gantt", "edit dates from gantt"] },
  { action_id: "configure_project_kpi", page_label: "Project KPIs", triggers: ["configure a kpi", "set up a kpi"] },
  { action_id: "update_kpi_value", page_label: "Project KPIs", triggers: ["update a kpi value", "update kpi"] },
  { action_id: "capture_kpi_snapshot", page_label: "Project KPIs — Snapshot action", triggers: ["capture a kpi snapshot", "kpi snapshot"] },
  { action_id: "kpi_app_submission", page_label: "Admin → KPI App Integration", triggers: ["submit kpi to the kpi app", "submit kpi data"] },
  { action_id: "setup_governance_cadence", page_label: "Project Governance", triggers: ["set up governance cadence", "configure governance cadence"] },
  { action_id: "record_governance_evidence", page_label: "Project Governance", triggers: ["record governance evidence", "record a governance review"] },
  { action_id: "connect_project_sharepoint_folder", page_label: "Project Files / Project SharePoint", triggers: ["connect a project to a sharepoint folder", "connect project sharepoint"] },
  { action_id: "setup_sharepoint_admin", page_label: "Admin → SharePoint", triggers: ["set up sharepoint", "configure sharepoint admin"] },
  { action_id: "generate_project_charter", page_label: "Project Overview", triggers: ["generate a project charter"] },
  { action_id: "generate_project_status_deck", page_label: "Project Overview", triggers: ["generate a project status deck", "generate status deck"] },
  { action_id: "generate_roadmap_status_deck", page_label: "Roadmap", triggers: ["generate a roadmap status deck", "roadmap status deck"] },
  { action_id: "use_roadmap_filters", page_label: "Roadmap", triggers: ["filter roadmap", "roadmap filters"] },
  { action_id: "manage_project_access", page_label: "Project Team / Project Access", triggers: ["give someone project access", "manage project access"] },
  { action_id: "invite_user", page_label: "Admin → Invitations", triggers: ["invite a new user", "invite user"] },
  { action_id: "use_agile_backlog", page_label: "Agile Backlog", triggers: ["use agile backlog", "move backlog item into a sprint"] },
  { action_id: "use_agile_sprints", page_label: "Agile Sprints", triggers: ["close a sprint", "use agile sprints"] },
  { action_id: "use_agile_board", page_label: "Agile Board", triggers: ["move an item on the agile board", "use agile board"] },
  { action_id: "use_files", page_label: "Files", triggers: ["open project files"] },
  { action_id: "use_btpm_guide_evaluation", page_label: "Admin → BTPM Guide Evaluation", triggers: ["download the btpm guide evaluation protocol"] },
  { action_id: "create_risk", page_label: "Risks and Blockers", triggers: ["create a risk", "add a risk"] },
  { action_id: "create_blocker", page_label: "Risks and Blockers", triggers: ["create a blocker", "add a blocker"] },
  { action_id: "resolve_blocker", page_label: "Risks and Blockers", triggers: ["resolve a blocker", "close a blocker"] },
];

const BANNED_SPECULATIVE_PHRASES = [
  "look for an option like", "or similar", "may be found", "may be available", "typically",
  "usually", "probably", "should be somewhere", "might be", "could be", "if available",
  "if there is a button", "something like", "this may be",
  // AI-FLOW.2E addendum — fabricated workflow phrases (procedural-only)
  "baseline settings", "select the existing baseline", "create a new baseline",
  "set new dates", "save changes", "under project settings", "under planning",
  "usually recommended", "typically follow these steps", "look for a section",
  "may be under", "similar button",
  // AI-FLOW.3B — when an exact UI label is verified, never weaken with "look for"
  "look for the", "look for a", "look for an",
  // AI-FLOW.3C — strengthen no-guess wording for procedural answers
  "look for ", "locate the", "locate a", "locate an", "find the option",
  "may be", "might be", "could be", "similar",
  "section designated for", "section dedicated to",
  // AI-FLOW.3D — additional fabricated procedural wording
  "generally need to", "available submission action", "available action",
  "follow the prompts", "access the setup area", "navigate to the section",
  "section for managing", "save or submit", "click option", "option to",
  "update as needed",
];

// Phrases that look like a fabricated workflow claim. If the answer asserts
// these for an unverified action, the post-check strips the sentence.
const FABRICATED_WORKFLOW_HINTS = [
  "baseline settings", "select the existing baseline", "create a new baseline",
  "set new dates", "save changes", "look for a section", "may be under",
];

// AI-FLOW.3C — operational-data intent (asks for actual project records).
// When matched, BTPM Guide MUST prepend an explicit refusal that it cannot
// read operational project data, then provide navigation guidance only.
const OPERATIONAL_DATA_PATTERNS: RegExp[] = [
  /\b(what|which|how many|list|show|tell me|give me)\b[^.?!]{0,40}\b(current|currently open|actually open|open|actual|today'?s|yesterday'?s|my|our|the)\b[^.?!]{0,40}\b(blockers?|risks?|tasks?|kpis?|projects?|files?|comments?|updates?|stakeholders?|deliverables?)\b/i,
  /\bcurrent (kpi|kpis|status|state|value|values|health|stage) (of|for|in)\b/i,
  /\b(yesterday'?s|today'?s|this week'?s|last week'?s) (updates?|status|comments?|execution updates?)\b/i,
  /\b(blockers?|risks?|tasks?|kpis?) .* (currently )?(open|active|overdue|pending|in progress)\b/i,
  /\b(read|open|summari[sz]e|tell me about) (the|my|this) (sharepoint|file|document|email|deck|excel|powerpoint|outlook)\b/i,
  /\b(what|how) (is|are) [^.?!]{0,30} (doing|progressing|going) (in|on|for) [A-Z][\w\s-]*/i,
  /\bwhat blockers? (are|is) (currently )?open\b/i,
  /\bcurrent kpi value\b/i,
];
function isOperationalDataQuery(q: string): boolean {
  return OPERATIONAL_DATA_PATTERNS.some((re) => re.test(q));
}

// AI-FLOW.3D — Deterministic refusal classification for operational/report/
// access/debug data questions where the answer must be a single canonical
// refusal sentence, not an LLM-generated paragraph that may leak speculation.
type DeterministicRefusal =
  | "power_bi_content"
  | "project_access_list"
  | "project_history"
  | "cross_org"
  | "provider_logs"
  | "sharepoint_auto_summary"
  | null;

function classifyDeterministicRefusal(q: string): DeterministicRefusal {
  const s = (q || "").toLowerCase();
  if (
    /\bwhat does my power ?bi\b/.test(s) ||
    /\bpower ?bi report (say|content|contents|data|values?)\b/.test(s) ||
    /\b(read|show|tell me|summari[sz]e) (my|the|this) power ?bi\b/.test(s)
  ) return "power_bi_content";
  if (
    /\b(which|who|what) (users?|people|members?)? ?(have|has|with) access to (this|the|my|our) (project|workspace)\b/.test(s) ||
    /\bproject access list\b/.test(s) ||
    /\blist (the )?(users|people|members) (with|that have) access\b/.test(s)
  ) return "project_access_list";
  if (
    /\b(what|which) (was|were) (updated|changed|added|modified) (in (this|the|my|our) project )?(yesterday|today|last week|this week)\b/.test(s) ||
    /\b(yesterday|today|last week|this week)'?s (project )?(updates?|changes?|activity|history)\b/.test(s) ||
    /\bwhat (happened|changed) (yesterday|today|last week)\b/.test(s)
  ) return "project_history";
  if (
    /\bfrom another organi[sz]ation\b/.test(s) ||
    /\b(different|other) organi[sz]ation\b/.test(s) ||
    /\bcross[- ]?org(ani[sz]ation)?\b/.test(s) ||
    /\bbypass organi[sz]ation\b/.test(s)
  ) return "cross_org";
  if (
    /\bprovider logs?\b/.test(s) ||
    /\bdebug payload\b/.test(s) ||
    /\binternal traces?\b/.test(s) ||
    /\badmin[- ]?only diagnostics?\b/.test(s) ||
    /\bshow me .* debug\b/.test(s)
  ) return "provider_logs";
  if (
    /\bauto[- ]?write .* (from )?share ?point\b/.test(s) ||
    /\b(summary|summaries) from share ?point files?\b/.test(s) ||
    /\bsummari[sz]e .* share ?point files?\b/.test(s) ||
    /\bauto[- ]?(generate|write) .* project summary .* share ?point\b/.test(s)
  ) return "sharepoint_auto_summary";
  return null;
}

const DETERMINISTIC_REFUSAL_ANSWERS: Record<Exclude<DeterministicRefusal, null>, string> = {
  power_bi_content:
    "I cannot read Power BI report contents or operational project data. Open the Power BI report directly to review it.",
  project_access_list:
    "I cannot read actual project access records. Check the Project Team / access area yourself, or ask a Project Manager, Workspace Admin, or Org Admin.",
  project_history:
    "I cannot read operational project history or activity records. Open the project and review activity/history or the relevant project sections.",
  cross_org:
    "I cannot access projects from another organization or bypass organization boundaries.",
  provider_logs:
    "I cannot expose provider logs, debug payloads, internal traces, or admin-only diagnostics.",
  sharepoint_auto_summary:
    "BTPM Guide cannot read SharePoint file contents or auto-write project summaries from them in the current assistant mode.",
};

// AI-FLOW.3C — Safe-limited deterministic answer for unverified procedural
// requests. Used when the LLM either produced speculative wording or no
// verified UI action is registered for the request.
function buildSafeLimitedAnswer(
  pageLabel: string | null,
  kcConcept: string | null,
): string {
  const concept = kcConcept && kcConcept.trim().length > 0
    ? kcConcept.trim()
    : (pageLabel ? `This action lives on ${pageLabel}.` : "BTPM does not document this action in the verified registry yet.");
  const page = pageLabel || "the relevant BTPM page";
  return [
    "I can explain the purpose, but BTPM Guide does not have verified click-by-click steps for this action yet.",
    "",
    "What I can confirm:",
    concept,
    "",
    "What I cannot confirm:",
    "- the exact button or field name;",
    "- the exact page section;",
    "- whether this action is enabled in your current setup.",
    "",
    `Open ${page} in BTPM. If the control is not visible, ask a Workspace Admin or Product Owner to confirm the enabled workflow.`,
  ].join("\n");
}

// AI-FLOW.3C — Fix broken numbering like "3. 4." and lone "This will…" stubs.
function tidyDeckFormatting(s: string): string {
  let out = s.replace(/(\d+)\.\s+(\d+)\./g, "$2.");
  out = out.replace(/^\s*\d+\.\s*This will[^.\n]*\.?\s*$/gim, "");
  return out.replace(/\n{3,}/g, "\n\n").trim();
}


function findUiActionForQuery(q: string): { action: UiAction | null; unverified: { action_id: string; page_label: string; not_supported?: string[]; permission_note?: string } | null } {
  const s = (q || "").toLowerCase();
  let bestV: { a: UiAction; score: number } | null = null;
  let bestUnv: { a: UiAction; score: number } | null = null;
  for (const a of UI_ACTIONS) {
    for (const t of a.trigger_phrases) {
      if (s.includes(t)) {
        const sc = t.length;
        if (a.verified) {
          if (!bestV || sc > bestV.score) bestV = { a, score: sc };
        } else {
          if (!bestUnv || sc > bestUnv.score) bestUnv = { a, score: sc };
        }
      }
    }
  }
  if (bestV) return { action: bestV.a, unverified: null };
  if (bestUnv) {
    return {
      action: null,
      unverified: {
        action_id: bestUnv.a.action_id,
        page_label: bestUnv.a.page_label,
        not_supported: bestUnv.a.not_supported,
        permission_note: bestUnv.a.permission_note,
      },
    };
  }
  let bestU: { u: { action_id: string; page_label: string; triggers: string[] }; score: number } | null = null;
  for (const u of UNVERIFIED_ACTIONS) {
    for (const t of u.triggers) {
      if (s.includes(t)) {
        const sc = t.length;
        if (!bestU || sc > bestU.score) bestU = { u, score: sc };
      }
    }
  }
  return { action: null, unverified: bestU ? { action_id: bestU.u.action_id, page_label: bestU.u.page_label } : null };
}

function findSpeculativePhraseHits(answer: string): string[] {
  const a = (answer || "").toLowerCase();
  return BANNED_SPECULATIVE_PHRASES.filter((p) => a.includes(p));
}

function stripSpeculativeSentences(answer: string, hasVerifiedAction: boolean = false): string {
  const sentences = answer.split(/(?<=[.!?])\s+/);
  const kept = sentences.filter((s) => {
    const low = s.toLowerCase();
    return !BANNED_SPECULATIVE_PHRASES.some((p) => low.includes(p));
  });
  const stripped = kept.join(" ").trim();
  // AI-FLOW.3B — only append the "not in verified registry" note when we
  // actually have NO verified action for this query. Otherwise the note
  // contradicts the verified steps the user just received.
  if (hasVerifiedAction) {
    return stripped || "I don't have additional verified click-by-click steps for that action.";
  }
  const note = "\n\nNote: exact click-by-click steps for that specific control are not in BTPM Guide's verified UI registry. Open the relevant page and ask a Workspace Admin to confirm if the control is not visible.";
  return (stripped || "I don't have verified click-by-click steps for that action in the Knowledge Center.") + note;
}


// Clearly out-of-scope (travel / general life / world knowledge) heuristics.
const OUT_OF_SCOPE_PATTERNS: RegExp[] = [
  /\b(visit|trip|travel|vacation|holiday|tourist|sightseeing|flight|hotel|restaurant|recipe|cook|weather|movie|song|sports?|football|soccer|nba|election|president|stock price|crypto|bitcoin)\b/i,
  /\bwhat should i (visit|see|eat|cook|watch|read)\b/i,
  /\b(paris|london|tokyo|new york|berlin|rome|madrid)\b/i,
];
function isClearlyOutOfScope(q: string): boolean {
  return OUT_OF_SCOPE_PATTERNS.some((re) => re.test(q));
}

// Direct-action intent detection (mutation / read-operational-data requests).
const DIRECT_ACTION_PATTERNS: RegExp[] = [
  /\bcreate (a |an |the )?(task|risk|blocker|project|phase|sprint|comment|update|kpi|deck|report)\b/i,
  /\bcreate .* for [A-Z][a-z]+/,
  /\b(update|edit|change|modify|set|assign|reassign|delete|remove|close|archive|approve|reject) (this|the|my|that) /i,
  /\bassign .* to\b/i,
  /\bsend (an |the )?(email|invite|notification)\b/i,
  /\bschedule (a |the )?(meeting|call|invite)\b/i,
  /\bsummari[sz]e (my|the|actual|our) (project|risks|tasks|sap|status|kpis?)/i,
  /\bread (my|the|this) (sharepoint|file|document|powerpoint|deck|excel|email)/i,
  /\bopen (my|the) (sharepoint|file|email)/i,
  /\b(change|update|set) (the )?(due date|deadline|owner|status|stage|health)\b/i,
];
function isDirectActionQuery(q: string): boolean {
  return DIRECT_ACTION_PATTERNS.some((re) => re.test(q));
}

// Lightweight BTPM-scope keyword check used to suppress noise on clear out-of-scope questions.
const BTPM_SCOPE_KEYWORDS = [
  "btpm","project","projects","program","programs","phase","phases","task","tasks","risk","blocker",
  "kpi","kpis","sprint","backlog","board","agile","gantt","roadmap","baseline","status","stage","health",
  "deck","ppt","powerpoint","power bi","sharepoint","governance","raci","template","templates",
  "knowledge","workspace","admin","planning","stakeholder","execution","attachment","saved view","filter",
  "lifecycle","charter","schedule","guide","help","kpi app",
];
function looksInScope(q: string): boolean {
  const s = q.toLowerCase();
  return BTPM_SCOPE_KEYWORDS.some((k) => s.includes(k));
}

function expandQuery(q: string): string {
  let out = q;
  for (const [re, rep] of SYNONYM_MAP) out = out.replace(re, `${rep} $&`);
  return out;
}


// ---------- Scoring ----------

interface Scored {
  article: ArticleListItem;
  meta: ArticleAiMetadata | null;
  score: number;
  reasons: string[];
}

function containsAny(hay: string, tokens: string[]): number {
  let hits = 0;
  for (const t of tokens) if (t && hay.includes(t)) hits++;
  return hits;
}

function scoreArticle(
  a: ArticleListItem,
  meta: ArticleAiMetadata | null,
  qTokens: string[],
  rawQuery: string,
  routeRaw: string,
): Scored {
  const reasons: string[] = [];
  const titleL = (a.title || "").toLowerCase();
  const sumL = (a.summary || "").toLowerCase();
  const tipL = (a.tooltip_excerpt || "").toLowerCase();
  const routeL = (a.related_route || "").toLowerCase();
  const rawQ = rawQuery.toLowerCase();
  const routeQ = routeRaw.toLowerCase();

  let score = 0;

  // A. Text match
  for (const t of qTokens) {
    if (STOP.has(t)) continue;
    if (titleL.includes(t)) { score += 4; }
    if (sumL.includes(t)) { score += 2; }
    if (tipL.includes(t)) { score += 2; }
  }
  if (qTokens.some((t) => !STOP.has(t) && titleL.includes(t))) reasons.push("title");

  // C. Route/context
  if (routeL && routeQ) {
    // Compare path segments
    const aSegs = routeL.split("/").filter(Boolean).map((s) => s.replace(/^:.*/, ""));
    const qSegs = routeQ.split("/").filter(Boolean).map((s) => s.replace(/^:.*/, ""));
    let segHits = 0;
    for (const s of aSegs) if (s && qSegs.includes(s)) segHits++;
    if (segHits > 0) { score += 3 * segHits; reasons.push(`route:${segHits}`); }
  }

  // B. Metadata match
  if (meta) {
    const synonyms = (meta.synonyms || []).map((s) => s.toLowerCase());
    const qExamples = (meta.question_examples || []).map((s) => s.toLowerCase());
    const features = (meta.feature_area || []).map((s) => s.toLowerCase());
    const intents = (meta.user_intents || []).map((s) => s.toLowerCase());
    const routePats = (meta.route_patterns || []).map((s) => s.toLowerCase());

    // synonym hits in query
    for (const syn of synonyms) {
      if (syn && rawQ.includes(syn)) { score += 5; reasons.push(`syn:${syn}`); }
    }
    // question_example token overlap
    for (const qe of qExamples) {
      const overlap = containsAny(qe, qTokens.filter((t) => !STOP.has(t)));
      if (overlap >= 2) { score += 4 + overlap; reasons.push(`qexample:${overlap}`); }
      else if (overlap === 1 && qe.length < 80) { score += 2; }
    }
    // feature_area words appearing in query
    for (const fa of features) {
      const faTokens = tokensNoStop(fa);
      const overlap = faTokens.filter((t) => qTokens.includes(t)).length;
      if (overlap > 0) { score += 2 * overlap; reasons.push(`feat:${fa}`); }
    }
    // route_patterns vs context route
    if (routeQ) {
      for (const rp of routePats) {
        const rpSegs = rp.split("/").filter(Boolean).map((s) => s.replace(/^:.*/, ""));
        const qSegs = routeQ.split("/").filter(Boolean).map((s) => s.replace(/^:.*/, ""));
        let hits = 0;
        for (const s of rpSegs) if (s && qSegs.includes(s)) hits++;
        if (hits > 0) { score += 2 * hits; }
      }
    }
    // user_intents — soft boost for matching wh-word patterns
    const isWhat = /\bwhat\b/i.test(rawQuery);
    const isHow = /\bhow\b/i.test(rawQuery);
    const isWhatDoI = /what do i do|what should i do/i.test(rawQuery);
    if (isWhat && intents.includes("understand")) score += 1;
    if (isHow && intents.includes("perform_task")) score += 1;
    if (isWhatDoI && (meta.ai_flow === "page_aware")) score += 3;
    if (isWhat && !isHow && (meta.ai_flow === "direct_answer")) score += 2;

    // D. Freshness
    if (meta.freshness_label === "current") score += 1;
    if (meta.freshness_label === "deprecated") score -= 3;
  }

  // Concept/rulebook bias for "what is X?"
  if (/^\s*what\s+is\b/i.test(rawQuery) && (a.article_type === "concept" || a.article_type === "rulebook")) {
    score += 2;
  }
  // How-to bias for "how do I"
  if (/\bhow\s+(do|to|can)\b/i.test(rawQuery) && a.article_type === "how_to") {
    score += 2;
  }

  return { article: a, meta, score, reasons };
}

function truncate(s: string | null | undefined, n: number): string {
  if (!s) return "";
  return s.length > n ? s.slice(0, n) + "…" : s;
}

// ---------- Body-aware re-scoring ----------

function scoreBody(body: string | null, qTokens: string[]): number {
  if (!body) return 0;
  const bodyL = body.toLowerCase();
  let s = 0;
  const uniq = Array.from(new Set(qTokens.filter((t) => !STOP.has(t))));
  for (const t of uniq) {
    if (bodyL.includes(t)) s += 1;
  }
  return s;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const reqId = crypto.randomUUID();
  const t0 = Date.now();

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ ok: false, error: "Unauthorized" }, 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    try {
      const verifier = createSupabaseTokenVerifier(supabase);
      await assertBrowserSessionOnly(req, verifier);
    } catch (guardError) {
      return toSafeErrorResponse(guardError, corsHeaders);
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: claimsErr } = await supabase.auth.getClaims(token);
    if (claimsErr || !claims?.claims?.sub) {
      return json({ ok: false, error: "Unauthorized" }, 401);
    }
    const userId = claims.claims.sub;

    const body = (await req.json().catch(() => ({}))) as ReqBody;
    const message = (body.message || "").trim();
    if (!message || message.length > 4000) {
      return json({ ok: false, error: "Message is required (max 4000 chars)" }, 400);
    }

    const contextRoute = (body.context_route || "").slice(0, 500) || null;
    const contextLabel = (body.context_label || "").slice(0, 200) || null;
    const debugRequested = body.debug === true;
    const evaluationMode = body.evaluation_mode === true;
    const evalQuestionId = (body.question_id || "").slice(0, 120) || null;

    // Phase 4D.14A.3C — canonical active Organization resolution.
    // Used for evaluation-mode admin check, later debug-mode admin check,
    // and the Guide provider runtime resolution below.
    let activeOrgId: string;
    try {
      activeOrgId = await resolveActiveOrganizationId(supabase);
    } catch (e) {
      const safe = toSafeActiveOrganizationPublicError(e);
      return json({ ok: false, error: safe.note }, 403);
    }

    // Evaluation mode: server-enforce org admin authority. Skip conversation/message persistence.
    let isAdminCached: boolean | null = null;
    if (evaluationMode) {
      const { data: isAdmin } = await supabase.rpc("is_org_admin", {
        _user_id: userId,
        _organization_id: activeOrgId,
      });
      if (isAdmin !== true) {
        return json({ ok: false, error: "Forbidden" }, 403);
      }
      isAdminCached = true;
    }


    // Ensure or create conversation (skipped in evaluation mode)
    let conversationId: string | null = body.conversation_id || null;
    if (!evaluationMode) {
      if (!conversationId) {
        const { data: newId, error: ccErr } = await supabase.rpc("ai_help_create_conversation", {
          _context_route: contextRoute,
          _context_label: contextLabel,
          _title: message.slice(0, 80),
        });
        if (ccErr || !newId) {
          console.error(`[${reqId}] create_conversation failed`, ccErr?.code, ccErr?.message);
          return json({ ok: false, error: "Failed to create conversation" }, 500);
        }
        conversationId = newId as string;
      }

      // Store user message
      const { error: umErr } = await supabase.rpc("ai_help_append_message", {
        _conversation_id: conversationId,
        _role: "user",
        _content: message,
        _context_route: contextRoute,
        _context_label: contextLabel,
        _source_article_ids: [],
      });
      if (umErr) {
        console.error(`[${reqId}] append_user_message failed`, umErr.code, umErr.message);
        return json({ ok: false, error: "Failed to save message" }, 500);
      }
    }

    // Load visible articles
    const { data: articleList, error: alErr } = await supabase.rpc("list_decrypted_knowledge_articles", {
      _category_id: null,
      _include_unpublished: false,
    });
    if (alErr) {
      console.error(`[${reqId}] list_articles failed`, alErr.code, alErr.message);
    }
    // AI-FLOW.3D — filter archived/placeholder articles so they never appear
    // as BTPM Guide sources or influence retrieval.
    const articles: ArticleListItem[] = ((articleList || []) as ArticleListItem[]).filter(
      (a) => !/placeholder/i.test(a.slug || "") && !/placeholder/i.test(a.title || ""),
    );

    // Load AI metadata for all visible articles in one batch.
    let metaMap = new Map<string, ArticleAiMetadata>();
    if (articles.length) {
      const ids = articles.map((a) => a.id);
      const { data: metaRows, error: metaErr } = await supabase.rpc(
        "list_knowledge_article_ai_metadata_for_visible_articles",
        { _article_ids: ids },
      );
      if (metaErr) {
        console.error(`[${reqId}] list_metadata failed`, metaErr.code, metaErr.message);
      } else {
        for (const m of (metaRows || []) as ArticleAiMetadata[]) {
          metaMap.set(m.article_id, m);
        }
      }
    }

    // Query normalization + alias expansion
    const expanded = expandQuery(message);
    const qTokens = tokenize(expanded);
    const routeRaw = `${contextRoute || ""} ${contextLabel || ""}`;
    const accessQuery = isAccessQuery(message);
    const spSyncQuery = isSharepointSyncQuery(message);
    const createProjectHowTo = isCreateProjectHowToQuery(message);
    const proceduralWorkflow = isProceduralWorkflowQuery(message);
    const uiActionMatch = proceduralWorkflow ? findUiActionForQuery(message) : { action: null, unverified: null };
    const verifiedAction = uiActionMatch.action;
    const unverifiedAction = uiActionMatch.unverified;
    const btpmGuideMeta = isBtpmGuideMetaQuery(message);
    // A concept question about SP sync-back is NOT a direct-action request,
    // even if it contains words like "update" or "edit". Project creation
    // how-to questions are also not direct-action requests.
    // AI-FLOW.2E addendum: a guidance question ("how can I…", "where do I…")
    // is NOT a direct-action request, even if it includes verbs like "change"
    // or "update". Only treat it as a direct action when the user explicitly
    // asks BTPM Guide to perform the action.
    const guidanceQuery = isGuidanceQuery(message);
    const performActionQuery = isPerformActionQuery(message);
    // AI-FLOW.3A — Refusal preamble triggers ONLY when the user explicitly
    // asks BTPM Guide to perform the action ("for me", "do it", "now",
    // "please update", "make the change") or when the message has no
    // guidance prefix but matches a perform-action pattern (e.g. imperative
    // "change the baseline dates for me", "update this KPI now").
    const directAction =
      !spSyncQuery &&
      !createProjectHowTo &&
      (performActionQuery || (!guidanceQuery && isDirectActionQuery(message)));
    const inScope = looksInScope(message);
    const rawDeckQuery = isDeckExportQuery(message);
    // Suppress deck-export boost when the user is actually asking about
    // SharePoint editing / sync-back behavior.
    const deckQuery = rawDeckQuery && !spSyncQuery;
    const roadmapCtx = isRoadmapContext(contextRoute, contextLabel, message);
    const userMentionedPowerBi = mentionsPowerBi(message);
    const clearlyOOS = isClearlyOutOfScope(message);

    // Stage 1: shortlist by title/summary/tooltip/route + metadata
    const stage1Scored: Scored[] = articles.map((a) =>
      scoreArticle(a, metaMap.get(a.id) || null, qTokens, message, routeRaw),
    );
    // Access-troubleshooting slug boost
    if (accessQuery) {
      for (const s of stage1Scored) {
        if (ACCESS_BOOST_SLUGS.has(s.article.slug)) {
          s.score += 10;
          s.reasons.push("access_boost");
        }
        const tL = (s.article.title || "").toLowerCase();
        if (tL.includes("access") || tL.includes("visible") || tL.includes("see a project")) {
          s.score += 3;
          s.reasons.push("access_title");
        }
      }
    }
    // SharePoint sync-back intent (AI-KC.4.3) — must rank sharepoint-output-behavior first.
    if (spSyncQuery) {
      for (const s of stage1Scored) {
        const slug = s.article.slug;
        if (slug === "sharepoint-output-behavior") {
          s.score += 20;
          s.reasons.push("sp_sync_primary_boost");
        } else if (SHAREPOINT_SYNC_BOOST_SLUGS.has(slug)) {
          s.score += 10;
          s.reasons.push("sp_sync_boost");
        } else if (SHAREPOINT_SYNC_SECONDARY_SLUGS.has(slug)) {
          s.score += 3;
          s.reasons.push("sp_sync_secondary");
        }
      }
    }
    // Deck / PPT export intent (AI-KC.4.2, gated by AI-KC.4.3)
    if (deckQuery) {
      for (const s of stage1Scored) {
        const slug = s.article.slug;
        if (roadmapCtx && ROADMAP_DECK_BOOST_SLUGS.has(slug)) {
          s.score += 12;
          s.reasons.push("roadmap_deck_boost");
        } else if (!roadmapCtx && PROJECT_DECK_BOOST_SLUGS.has(slug)) {
          s.score += 8;
          s.reasons.push("project_deck_boost");
        }
        // Penalize Power BI articles unless user explicitly asked about Power BI
        if (!userMentionedPowerBi && POWER_BI_SLUGS.has(slug)) {
          s.score -= 8;
          s.reasons.push("powerbi_penalty");
        }
        // For Roadmap deck context, also de-prioritize the project status deck
        if (roadmapCtx && slug === "weekly-project-status-deck") {
          s.score -= 3;
          s.reasons.push("non_roadmap_deck_penalty");
        }
      }
    }
    // Project-creation how-to intent (AI-KC.QA.2G) — strongly prefer the
    // procedural article over generic concept/rulebook articles.
    if (createProjectHowTo) {
      for (const s of stage1Scored) {
        const slug = s.article.slug;
        if (slug === CREATE_PROJECT_PRIMARY_SLUG) {
          s.score += 25;
          s.reasons.push("create_project_primary_boost");
        } else if (slug === "what-is-btpm" || slug === "what-can-btpm-guide-do-for-me") {
          s.score -= 6;
          s.reasons.push("create_project_generic_penalty");
        }
      }
    }
    // AI-FLOW.2C — Procedural workflow intent: downrank BTPM Guide meta
    // articles so they cannot dominate workflow guidance answers.
    if (proceduralWorkflow && !btpmGuideMeta) {
      for (const s of stage1Scored) {
        if (BTPM_GUIDE_META_SLUGS.has(s.article.slug)) {
          s.score -= 25;
          s.reasons.push("meta_downrank");
        }
      }
    }
    // AI-FLOW.2C — Targeted workflow retrieval boosts.
    for (const rule of WORKFLOW_BOOST_RULES) {
      if (!rule.trigger.test(message)) continue;
      for (const s of stage1Scored) {
        const slug = s.article.slug;
        const boost = rule.boosts[slug];
        if (boost) {
          s.score += boost;
          s.reasons.push(`${rule.name}_boost:${boost}`);
        }
        const penalty = rule.penalties?.[slug];
        if (penalty) {
          s.score -= penalty;
          s.reasons.push(`${rule.name}_penalty:${penalty}`);
        }
      }
    }
    const stage1: Scored[] = stage1Scored
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12);

    // Stage 2: body-aware re-scoring on shortlist
    const detailed: Array<{ s: Scored; detail: ArticleDetail }> = [];
    for (const cand of stage1) {
      const { data: d } = await supabase.rpc("get_decrypted_knowledge_article", { _id: cand.article.id });
      const row = (d?.[0] || null) as ArticleDetail | null;
      if (!row) continue;
      const bodyBoost = scoreBody(row.body, qTokens);
      cand.score += bodyBoost;
      if (bodyBoost > 0) cand.reasons.push(`body:${bodyBoost}`);
      detailed.push({ s: cand, detail: row });
    }
    detailed.sort((a, b) => b.s.score - a.s.score);

    // Source selection — dynamic top-N
    const top = detailed[0];
    const topScore = top?.s.score ?? 0;
    let selected: typeof detailed = [];
    if (top && topScore >= 5) {
      const threshold = Math.max(topScore * 0.4, 4);
      selected = detailed.filter((d) => d.s.score >= threshold).slice(0, 5);
      if (selected.length === 0) selected = [top];
    } else if (top && topScore >= 3) {
      selected = detailed.slice(0, 3);
    }
    // Stronger out-of-scope source suppression (AI-KC.4.2):
    // - Clearly out-of-scope queries (travel/general world) with no BTPM keyword → always clear.
    // - Otherwise, if not in-scope and topScore < 12, clear (was < 6 — too weak).
    if (clearlyOOS && !inScope) {
      selected = [];
    } else if (!inScope && topScore < 12) {
      selected = [];
    }


    const sourceArticleIds = selected.map((d) => d.detail.id);
    const sources = selected.map((d) => ({
      id: d.detail.id,
      title: d.detail.title,
      slug: d.detail.slug,
      related_route: d.detail.related_route,
    }));

    // Build KC block with metadata hints
    const verifiedActionBlock = verifiedAction
      ? `VERIFIED UI ACTION (use these exact steps; do not invent additional controls)\nAction: ${verifiedAction.action_id}\nPage: ${verifiedAction.page_label}\nSteps:\n${verifiedAction.exact_steps.map((s, i) => `  ${i + 1}. ${s}`).join("\n")}\nRequired UI terms: ${verifiedAction.required_ui_terms.join(", ")}\n${verifiedAction.permission_note ? `Permission: ${verifiedAction.permission_note}\n` : ""}${verifiedAction.not_supported?.length ? `Not supported (do NOT claim these): ${verifiedAction.not_supported.join(" | ")}\n` : ""}`
      : unverifiedAction
        ? `UNVERIFIED UI ACTION — ${unverifiedAction.action_id}\nKnown page area: ${unverifiedAction.page_label}\n${unverifiedAction.permission_note ? `Note: ${unverifiedAction.permission_note}\n` : ""}${unverifiedAction.not_supported?.length ? `Explicitly NOT supported (do NOT invent these and do NOT claim them as steps): ${unverifiedAction.not_supported.join(" | ")}\n` : ""}No verified click-by-click steps. Tell the user you do not have verified click-by-click steps, name the page area, and (when applicable) describe the safe verified next step from the Knowledge Center sources. Do NOT invent a button name, a settings page, or claim a control exists. Do NOT use phrases like "Baseline Settings", "select the existing baseline", "create a new baseline", "set new dates", "save changes", "look for a section", "may be under", or "typically follow these steps".\n`
        : "";

    const kcBlock = selected.length
      ? selected
          .map(({ s, detail }, i) => {
            const meta = s.meta;
            const metaLines: string[] = [];
            if (meta?.ai_flow) metaLines.push(`Flow: ${meta.ai_flow}`);
            if (meta?.synonyms?.length) metaLines.push(`Synonyms: ${meta.synonyms.join(", ")}`);
            if (meta?.question_examples?.length)
              metaLines.push(`Example questions: ${meta.question_examples.slice(0, 4).join(" | ")}`);
            if (meta?.answer_rules?.length)
              metaLines.push(`Answer rules: ${meta.answer_rules.slice(0, 4).join(" | ")}`);
            if (meta?.forbidden_claims?.length)
              metaLines.push(`Do NOT claim: ${meta.forbidden_claims.slice(0, 4).join(" | ")}`);
            return [
              `[Article ${i + 1}] ${detail.title}`,
              `Slug: ${detail.slug}`,
              `Route: ${detail.related_route || "n/a"}`,
              `Summary: ${truncate(detail.summary, 400)}`,
              metaLines.length ? metaLines.join("\n") : null,
              `Body: ${truncate(detail.body, 1800)}`,
            ].filter(Boolean).join("\n");
          })
          .join("\n\n")
      : "(No Knowledge Center articles matched this question.)";

    const routeBlock = `Current page route: ${contextRoute || "(unknown)"}\nCurrent page label: ${contextLabel || "(unknown)"}`;

    // Load recent history (skipped in evaluation mode — no conversation persistence)
    let recent: Array<{ role: string; content: string }> = [];
    if (!evaluationMode && conversationId) {
      const { data: history } = await supabase.rpc("ai_help_list_messages", { _conversation_id: conversationId });
      recent = ((history || []) as Array<{ role: string; content: string }>).slice(-8);
    }

    // Provider routing is fully Tenant-driven. Credentials/model/provider
    // are resolved from Admin AI Settings + Tenant Vault only when we know
    // we need to call the LLM (see resolveGuideTextProviderRuntime below).

    const noGuessHint = proceduralWorkflow && !verifiedAction
      ? "The user is asking for a procedural UI step but no VERIFIED UI ACTION block is present. Do NOT invent buttons, menus, or click paths. If the cited Knowledge Center sources include explicit UI steps, you may use those verbatim. Otherwise reply that exact click-by-click steps are not in the verified registry, name the page area where the action lives, and recommend asking a Workspace Admin to confirm. Never use phrases such as \"look for an option like\", \"or similar\", \"may be found\", \"typically\", \"usually\", \"probably\", \"might be\", \"could be\", \"if available\", \"if there is a button\", or \"something like\".\n"
      : "";
    const verifiedActionHint = verifiedAction
      ? "A VERIFIED UI ACTION block is provided below. Use those exact step labels and required UI terms verbatim. Do not add controls, screens, or capabilities that are not listed. If the block has 'Not supported' entries, do not claim those are possible.\n"
      : "";
    // AI-FLOW.3A — when the user is asking for guidance (how/where/what/can I…)
    // and is NOT asking BTPM Guide to perform the action, suppress the
    // refusal preamble entirely.
    const guidanceOnlyHint = guidanceQuery && !directAction
      ? "The user is asking FOR GUIDANCE (how/where/what/can I…), NOT asking BTPM Guide to perform the action. DO NOT start with \"I can't create or update records for you\", \"I cannot create\", \"I can't read your operational project data\", or any similar refusal/limitation preamble. Answer directly with the verified BTPM workflow steps. If the workflow is unverified or unsupported, state that plainly and give the verified safe alternative (e.g. for baseline date changes: update the current plan first, then use Rebaseline on the Project Overview only after a formal governance decision; Rebaseline overwrites the approved baseline and the previous baseline is not recoverable; the action is logged in baseline history). Only mention what you cannot do if it is essential to explain WHY a workflow is not supported, and never as the first sentence.\n"
      : "";


    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "system",
        content: `PAGE CONTEXT\n${routeBlock}\n\nINTENT HINTS:\n- direct_action_request: ${directAction ? "true" : "false"}\n- in_btpm_scope: ${inScope ? "true" : "false"}\n- deck_export_request: ${deckQuery ? "true" : "false"}\n- roadmap_context: ${roadmapCtx ? "true" : "false"}\n- sharepoint_sync_question: ${spSyncQuery ? "true" : "false"}\n- create_project_howto: ${createProjectHowTo ? "true" : "false"}\n- procedural_workflow_request: ${proceduralWorkflow && !btpmGuideMeta ? "true" : "false"}\n- btpm_guide_meta_question: ${btpmGuideMeta ? "true" : "false"}\n- verified_ui_action: ${verifiedAction ? verifiedAction.action_id : "none"}\n- unverified_ui_action: ${unverifiedAction ? unverifiedAction.action_id : "none"}\n${directAction ? "The user is asking BTPM Guide to perform an action or read operational data. Follow the DIRECT ACTION GUARDRAIL: start by saying explicitly \"I can't create or update records for you\" (and, if relevant, that you can't read operational project data or SharePoint/Power BI/Outlook content), then optionally explain how the user can do it themselves based on the Knowledge Center.\n" : ""}${spSyncQuery ? "The user is asking a CONCEPT question about whether editing a file (PowerPoint, document, deck, etc.) in SharePoint flows back into BTPM. This is NOT a direct-action request — do not refuse and do not start with \"I can't create or update\". Answer directly using the SharePoint output behavior source: editing a PowerPoint or document in SharePoint does NOT update BTPM; BTPM remains the source of truth, generated documents are one-way outputs, and changes must be made in BTPM and the deck regenerated.\n" : ""}${deckQuery ? "The user is asking how to generate/export a deck, PPT, PowerPoint, slides, or presentation. If a deck/status-deck source is provided in the Knowledge Center context below, you MUST answer from that source. Do NOT return the generic \"not enough Knowledge Center information\" fallback. Mention the relevant deck (Roadmap Status Deck if the roadmap_context hint is true, otherwise Project Status Deck), the filters/selected scope used, and that BTPM data should be updated first because the deck is an output. Do not mention Power BI unless the user explicitly asked about Power BI.\n" : ""}${createProjectHowTo ? "The user is asking HOW to create a new project in BTPM. This is NOT a direct-action request — do not refuse and do not say \"I can't create\". Answer with the exact BTPM UI steps from the \"How to create a project\" article: open Projects, confirm the workspace, click New project, choose Blank or From template, enter the Project name, optionally select a Program and (for template) the template and Project start date, then click Create project. Mention that BTPM opens the new project page after creation. If the user asks why they can't see the New project button, mention permissions and workspace access. Put the warning about not creating a project for every small action at the end, not the beginning. Do not claim BTPM Guide created the project.\n" : ""}${proceduralWorkflow && !btpmGuideMeta ? "The user is asking how to do something in BTPM (procedural workflow). Guide them through the BTPM workflow using the provided Knowledge Center sources. Start with the BTPM page or area and concrete numbered steps; name the specific BTPM buttons, tabs, or controls that the sources describe. Add a permission note where relevant. Add any source-of-truth boundary only AFTER the steps, not as the opening. Do not open with generic project-management advice. Do not say \"if you need more specific guidance\" when KC sources were provided. Do not claim that you created, updated, approved, submitted, invited, granted access, or changed anything.\n" : ""}${guidanceOnlyHint}${verifiedActionHint}${noGuessHint}${!inScope && selected.length === 0 ? "The question appears outside BTPM scope. Politely redirect the user to BTPM topics without inventing content or citing unrelated sources.\n" : ""}\n${verifiedActionBlock ? verifiedActionBlock + "\n" : ""}KNOWLEDGE CENTER CONTEXT (only source of truth):\n${kcBlock}\n\nIf the Knowledge Center context above is sufficient, answer concisely from it and follow any "Answer rules" / avoid any "Do NOT claim" items for the cited articles. Only if it truly does not cover the question AND no guardrail applies, reply exactly: "${OUT_OF_SCOPE}"`,
      },
      ...recent.map((m) => ({ role: m.role, content: m.content })),
      ...(evaluationMode ? [{ role: "user", content: message }] : []),
    ];

    // AI-FLOW.3D — Deterministic overrides BEFORE calling the LLM.
    //   (1) Deterministic refusals for operational/report/access/debug data.
    //   (2) Safe-limited template when proceduralWorkflow && !verifiedAction.
    // In either case we skip the LLM entirely so banned/speculative wording
    // can never reach the user.
    let answer: string = "";
    let speculativeHits: string[] = [];
    let llmSkipped: "deterministic_refusal" | "unverified_action_override" | null = null;
    let providerLabel: "openai" | "azure_openai" | null = null;

    const deterministicCase = classifyDeterministicRefusal(message);
    if (deterministicCase) {
      answer = DETERMINISTIC_REFUSAL_ANSWERS[deterministicCase];
      llmSkipped = "deterministic_refusal";
    } else if (proceduralWorkflow && !verifiedAction) {
      const pageLabel = unverifiedAction?.page_label || null;
      const kcConcept = selected[0]?.detail.summary || null;
      answer = buildSafeLimitedAnswer(pageLabel, kcConcept);
      llmSkipped = "unverified_action_override";
    }

    if (!llmSkipped) {
      // Resolve Guide provider runtime lazily — only when we know an LLM
      // call is required. Phase 4D.14A.8E.1: cutover to shared Tenant AI
      // text runtime + canonical chat-completions transport. No Global
      // env AI routing or provider credentials are read here.
      let guideRuntime: GuideTextProviderRuntimeConfig;
      try {
        guideRuntime = await resolveGuideTextProviderRuntime({
          organizationId: activeOrgId,
          functionName: "ai-help-chat",
          reason: "btpm-guide-v1-chat",
          requestId: reqId,
        });
      } catch (e) {
        const safe = toSafeGuideProviderPublicError(e);
        console.error(`[${reqId}] guide_provider_unavailable code=${safe.error}`);
        return json({ ok: false, conversation_id: conversationId, error: safe.note }, 503);
      }
      providerLabel = guideRuntime.provider;

      // Body compatibility is derived from the CANONICAL model — never the
      // Azure deployment name — and applies equally to both providers.
      // GPT-5-family / reasoning-tier models require `max_completion_tokens`
      // and reject a non-default `temperature`.
      const traits = getOpenAiChatBodyTraits(guideRuntime.canonicalModel);
      const payload: Record<string, unknown> = {
        messages,
        [traits.fieldName]: 800,
      };
      if (!traits.omitTemperature) {
        payload.temperature = 0.2;
        payload.top_p = 1;
      }

      const RETRYABLE_CATEGORIES = new Set([
        "rate_limited",
        "service_unavailable",
        "timeout",
        "network_error",
      ]);
      const maxAttempts = 3;
      let lastResult: Awaited<ReturnType<typeof postTenantAiChatCompletion>> | null = null;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        lastResult = await postTenantAiChatCompletion({
          runtime: guideRuntime,
          payload,
          requestId: reqId,
          operation: "ai_help_chat",
        });
        if (lastResult.ok) break;
        if (!RETRYABLE_CATEGORIES.has(lastResult.category)) break;
        if (attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, 400 * attempt));
        }
      }

      if (!lastResult || !lastResult.ok) {
        const category = lastResult?.category ?? "service_unavailable";
        console.error(
          `[${reqId}] ai_provider=${providerLabel} category=${category}`,
        );
        const friendly =
          category === "rate_limited"
            ? "BTPM Guide is busy right now. Please try again in a moment."
            : category === "credential_rejected" || category === "permission_denied"
            ? "BTPM Guide is not configured correctly. Please contact your administrator."
            : "BTPM Guide could not generate an answer right now.";
        return json({ ok: false, conversation_id: conversationId, error: friendly }, 502);
      }

      const aiJson = lastResult.json as {
        choices?: { message?: { content?: string } }[];
      };
      answer = aiJson?.choices?.[0]?.message?.content?.trim() || OUT_OF_SCOPE;
    }





    // AI-FLOW.2E — No-Guess post-check: strip speculative UI sentences from
    // procedural workflow answers so banned phrases never reach the user.
    if (!llmSkipped && proceduralWorkflow) {
      speculativeHits = findSpeculativePhraseHits(answer);
      if (speculativeHits.length > 0) {
        answer = stripSpeculativeSentences(answer, !!verifiedAction);
      }
    }

    // AI-FLOW.3C — When the request is procedural and there is NO verified UI
    // action, force the safe-limited deterministic template. (Belt-and-braces
    // post-check; primary path is the deterministic override before the LLM.)
    if (!llmSkipped && proceduralWorkflow && !verifiedAction) {
      const post = findSpeculativePhraseHits(answer);
      const tooShort = !answer || answer.trim().length < 40;
      if (post.length > 0 || tooShort) {
        const pageLabel = unverifiedAction?.page_label || null;
        const kcConcept = selected[0]?.detail.summary || null;
        answer = buildSafeLimitedAnswer(pageLabel, kcConcept);
        speculativeHits = post;
      }
    }

    // AI-FLOW.3C — Deck-generation answer formatting cleanup.
    if (!llmSkipped && deckQuery) {
      answer = tidyDeckFormatting(answer);
    }

    // AI-FLOW.3C — Operational-data refusal: when the user asks for actual
    // project data, prepend an explicit refusal — but ONLY when the answer
    // does not already contain a refusal phrase (prevents duplicate refusal
    // sentences like "I cannot read operational project data. I cannot…").
    const operationalDataQuery = isOperationalDataQuery(message);
    if (!llmSkipped && operationalDataQuery) {
      const sharepointAsked = /\bshare ?point|\.pptx?\b|\bword document|\bexcel\b|\boutlook\b/i.test(message);
      const refusalLine = sharepointAsked
        ? "I cannot read SharePoint file contents or actual project records."
        : "I cannot read operational project data or access actual project records.";
      const aLow = answer.toLowerCase();
      const alreadyRefuses =
        /\bi (cannot|can'?t|am unable to|'?m unable to)\s+(read|access|view|expose|open)\b/.test(aLow) ||
        aLow.includes("cannot read operational project data") ||
        aLow.includes("cannot access actual project records") ||
        aLow.includes("cannot read sharepoint");
      if (!alreadyRefuses) {
        answer = `${refusalLine} ${answer}`.trim();
      }
    }


    // AI-FLOW.3A — Strip refusal/limitation preamble when the user asked for
    // GUIDANCE (not for BTPM Guide to perform the action). Removes any
    // leading sentences/paragraphs that open with "I can't/cannot
    // create/update/read…" so verified workflow steps lead the answer.
    if (!llmSkipped && guidanceQuery && !directAction && !operationalDataQuery) {
      const REFUSAL_OPENERS = [
        /^\s*(?:I\s*(?:can(?:'|\u2019)?t|cannot)\s+(?:create|update|edit|change|modify|delete|remove|assign|send|schedule|approve|reject|submit|invite|grant|read|access|open|inspect|fetch|retrieve)[^.!?]*[.!?]\s*)+/i,
        /^\s*(?:I\s+do(?:\s+not|n(?:'|\u2019)?t)\s+have\s+access\s+to[^.!?]*[.!?]\s*)+/i,
        /^\s*(?:I\s*(?:can(?:'|\u2019)?t|cannot)\s+(?:read|access)\s+your\s+operational[^.!?]*[.!?]\s*)+/i,
      ];
      let changed = true;
      while (changed) {
        changed = false;
        for (const re of REFUSAL_OPENERS) {
          const next = answer.replace(re, "");
          if (next !== answer) {
            answer = next;
            changed = true;
          }
        }
      }
      answer = answer.replace(/^\s+/, "");
    }




    let assistantMsgId: string | null = null;
    if (!evaluationMode && conversationId) {
      const { data: amId, error: amErr } = await supabase.rpc("ai_help_append_message", {
        _conversation_id: conversationId,
        _role: "assistant",
        _content: answer,
        _context_route: contextRoute,
        _context_label: contextLabel,
        _source_article_ids: sourceArticleIds,
      });
      if (amErr) {
        console.error(`[${reqId}] append_assistant failed`, amErr.code, amErr.message);
      } else {
        assistantMsgId = (amId as string) || null;
      }
    }

    const elapsedMs = Date.now() - t0;
    // Safe logging only: slugs + scores, no prompts/bodies/answers.
    console.log(
      `[${reqId}] ok user=${userId} mode=${evaluationMode ? "eval" : "user"}${
        evalQuestionId ? ` qid=${evalQuestionId}` : ""
      } articles=${selected.length} top=${topScore.toFixed(1)} slugs=${selected
        .map((d) => d.detail.slug)
        .join(",")} ms=${elapsedMs}`,
    );

    // Optional debug payload — only when caller is org admin AND requested,
    // OR always in evaluation mode (admin already verified above).
    let debug: unknown = undefined;
    let isAdminForDebug = isAdminCached;
    if (debugRequested && isAdminForDebug === null) {
      // Phase 4D.14A.3C.1 — replace `.rpc(...).catch(...)` (which is not
      // valid on PostgrestBuilder in current Deno types and silently
      // suppresses RPC errors) with explicit try/catch. Any RPC error,
      // thrown error, or non-true return denies debug access. Raw errors
      // are never exposed or logged.
      let isAdmin: unknown = false;
      try {
        const res = await supabase.rpc("is_org_admin", {
          _user_id: userId,
          _organization_id: activeOrgId,
        });
        if (!res.error) isAdmin = res.data;
      } catch { /* swallow — treated as not admin */ }
      isAdminForDebug = isAdmin === true;
    }
    if ((debugRequested || evaluationMode) && isAdminForDebug === true) {
      const fallbackReason =
        selected.length === 0
          ? topScore < 3
            ? "below_threshold"
            : "no_candidates"
          : null;
      debug = {
        top_score: topScore,
        threshold: topScore >= 5 ? Math.max(topScore * 0.4, 4) : topScore >= 3 ? 3 : 3,
        selected_slugs: selected.map((d) => d.detail.slug),
        selected: selected.map((d) => ({
          slug: d.detail.slug,
          score: d.s.score,
          reasons: d.s.reasons,
        })),
        shortlist: detailed.slice(0, 12).map((d) => ({
          slug: d.detail.slug,
          score: d.s.score,
        })),
        fallback_reason: fallbackReason,
        provider: providerLabel,
        request_id: reqId,
        elapsed_ms: elapsedMs,
        ...(evalQuestionId ? { question_id: evalQuestionId } : {}),
        ...(body.expected_sources ? { expected_sources: body.expected_sources } : {}),
        no_guess: {
          procedural_workflow: proceduralWorkflow,
          verified_ui_action: verifiedAction?.action_id ?? null,
          unverified_ui_action: unverifiedAction?.action_id ?? null,
          speculative_phrase_hits: speculativeHits,
          stripped: speculativeHits.length > 0,
          llm_skipped: llmSkipped,
          deterministic_case: deterministicCase,
        },
      };
    }

    return json({
      ok: true,
      conversation_id: evaluationMode ? null : conversationId,
      evaluation_mode: evaluationMode,
      assistant_message: {
        id: assistantMsgId || "",
        content: answer,
        source_article_ids: sourceArticleIds,
      },
      sources,
      ...(debug ? { debug } : {}),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[${reqId}] unhandled error ${msg}`);
    return json({ ok: false, error: "BTPM Guide encountered an unexpected error." }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
