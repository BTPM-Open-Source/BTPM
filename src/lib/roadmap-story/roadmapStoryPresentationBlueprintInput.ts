/**
 * Phase 6B.7b — AI Presentation Blueprint input package + prompt.
 * Phase 6B.7b.1 — Corrected source digest extraction to read the real
 * nested `RoadmapStorySourceSnapshot` shape (`snap.sources.<category>.items`),
 * strip file URLs / bytes from the AI input, and expose an `inputHealth`
 * summary for transparency.
 *
 * Builds the self-contained payload sent to the Presentation Blueprint
 * AI step. Story Draft + bounded source digest + implemented Visual
 * Template Library + strict rules. No file bytes, no URLs, no memory
 * from prior conversation.
 */

import {
  ROADMAP_STORY_PRESENTATION_TEMPLATES,
  type RoadmapStoryPresentationTemplate,
  type RoadmapStoryPresentationTemplateKey,
} from "./roadmapStoryPresentationTemplates";
import {
  AI_BLUEPRINT_SCHEMA_VERSION,
  AI_BLUEPRINT_TEMPLATE_ID,
} from "./roadmapStoryPresentationBlueprintSchema";
import {
  toVisualEnforcementLists,
  type RoadmapStoryVisualSettings,
} from "./roadmapStoryVisualSettings";

export interface BlueprintInputDraft {
  title?: string | null;
  executiveSummary?: string | null;
  sections?: Array<{ heading?: string | null; body?: string | null; evidenceRefs?: string[] }>;
  attentionItems?: Array<{ title?: string | null; detail?: string | null; evidenceRefs?: string[] }>;
  sourceLimitations?: string[];
  evidenceSummary?: string[];
}

export interface BlueprintInputHealth {
  hasStructuredSourceSnapshot: boolean;
  sourceCategoriesWithRows: string[];
  warnings: string[];
}

export interface BlueprintInputPackage {
  schemaVersion: typeof AI_BLUEPRINT_SCHEMA_VERSION;
  templateId: typeof AI_BLUEPRINT_TEMPLATE_ID;
  storyDraft: BlueprintInputDraft;
  sourceDigest: {
    counts: Record<string, number>;
    manifestCounts?: Record<string, number>;
    projectOverview: unknown[];
    planning: unknown[];
    risks: unknown[];
    blockers: unknown[];
    governance: unknown[];
    kpis: unknown[];
    files: unknown[];
    sourceLimitations: string[];
  };
  visualTemplateLibrary: Array<{
    id: RoadmapStoryPresentationTemplate["id"];
    name: string;
    purpose: string;
    dataCategories: RoadmapStoryPresentationTemplate["dataCategories"];
    family: RoadmapStoryPresentationTemplate["family"];
  }>;
  visualSettings: {
    requiredBlockTypes: RoadmapStoryPresentationTemplateKey[];
    excludedBlockTypes: RoadmapStoryPresentationTemplateKey[];
    narrativeEnabledBlockTypes: RoadmapStoryPresentationTemplateKey[];
    narrativeDisabledBlockTypes: RoadmapStoryPresentationTemplateKey[];
  };
  currentDeterministicBlueprint?: {
    note: "reference_only";
    blockTypes: string[];
  } | null;
  inputHealth: BlueprintInputHealth;
  rules: string[];
}

// Row bounds — enough for the model to pick + prioritise, small enough
// to keep the payload tight.
const MAX_ROWS_PER_CATEGORY = 40;
const MAX_FILE_ROWS = 30;

function boundRows(rows: unknown, cap = MAX_ROWS_PER_CATEGORY): unknown[] {
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, cap);
}

/**
 * Read a nested source block's `items` array (`snap.sources.<key>.items`),
 * with legacy flat fallbacks for older debug/replay payloads.
 */
function readSourceItems(
  snap: Record<string, unknown>,
  nestedKeys: string[],
  legacyFlatKeys: string[],
): unknown[] {
  const sources = (snap.sources && typeof snap.sources === "object")
    ? (snap.sources as Record<string, unknown>)
    : {};
  for (const key of nestedKeys) {
    const block = sources[key];
    if (block && typeof block === "object") {
      const items = (block as Record<string, unknown>).items;
      if (Array.isArray(items)) return items;
    }
  }
  for (const key of legacyFlatKeys) {
    const items = snap[key];
    if (Array.isArray(items)) return items;
  }
  return [];
}

/**
 * Strip fields the LLM does not need — especially URLs and bytes on file
 * rows. Keeps display fields, mime type, sizeBytes (numeric), and any
 * user note.
 */
function stripFileRow(row: unknown): Record<string, unknown> {
  if (!row || typeof row !== "object") return {};
  const r = row as Record<string, unknown>;
  return {
    id: r.id ?? null,
    displayName: r.displayName ?? r.name ?? null,
    mimeType: r.mimeType ?? null,
    sizeBytes: typeof r.sizeBytes === "number" ? r.sizeBytes : null,
    userNote: typeof r.userNote === "string" ? r.userNote : null,
    includeInStory: r.includeInStory ?? null,
    // NOTE: webUrl, driveId, itemId, base64, bytes, content are intentionally
    // omitted. BTPM handles file links at render time via structured refs.
  };
}

export interface BuildBlueprintInputArgs {
  draft: BlueprintInputDraft;
  sourceSnapshot: unknown | null;
  fileManifestSummary: {
    included_count?: number;
    sent_count?: number;
    skipped_count?: number;
    total_bytes_sent?: number;
    files?: Array<Record<string, unknown>>;
  } | null;
  deterministicBlockTypes?: string[];
  visualSettings?: RoadmapStoryVisualSettings | null;
}

export function buildBlueprintInputPackage(args: BuildBlueprintInputArgs): BlueprintInputPackage {
  const snap = (args.sourceSnapshot && typeof args.sourceSnapshot === "object")
    ? (args.sourceSnapshot as Record<string, unknown>)
    : {};
  const hasStructuredSourceSnapshot = !!snap.sources && typeof snap.sources === "object";

  // Nested `snap.sources.<key>.items` first, then legacy flat fallbacks.
  const projectOverview = boundRows(
    readSourceItems(snap, ["program_project_overview"], ["projectOverview", "programProjectOverview"]),
  );
  const planning = boundRows(
    readSourceItems(snap, ["planning_phases_tasks"], ["planning", "planningPhasesTasks"]),
  );
  const risks = boundRows(readSourceItems(snap, ["risks"], ["risks"]));
  const blockers = boundRows(readSourceItems(snap, ["blockers"], ["blockers"]));
  const governance = boundRows(
    readSourceItems(snap, ["governance_decisions", "governance"], ["governance", "governanceDecisions"]),
  );
  const kpis = boundRows(
    readSourceItems(snap, ["kpis_snapshots", "kpis"], ["kpis", "kpisSnapshots"]),
  );
  const rawFiles = boundRows(
    readSourceItems(snap, ["documents_metadata"], ["files", "documentsMetadata"]),
    MAX_FILE_ROWS,
  );
  const files = rawFiles.map(stripFileRow);

  const sourceLimitations = Array.isArray(snap.sourceLimitations)
    ? (snap.sourceLimitations as string[]).slice(0, 20)
    : Array.isArray(args.draft.sourceLimitations) ? args.draft.sourceLimitations : [];

  const manifestCounts = (snap.counts && typeof snap.counts === "object")
    ? Object.fromEntries(
        Object.entries(snap.counts as Record<string, unknown>)
          .filter(([, v]) => typeof v === "number")
          .slice(0, 30),
      ) as Record<string, number>
    : undefined;

  const counts: Record<string, number> = {
    projectOverview: projectOverview.length,
    planning: planning.length,
    risks: risks.length,
    blockers: blockers.length,
    governance: governance.length,
    kpis: kpis.length,
    files: files.length,
    filesSent: args.fileManifestSummary?.sent_count ?? 0,
    filesSkipped: args.fileManifestSummary?.skipped_count ?? 0,
  };

  // ---- Input health / transparency -----------------------------------
  const categoryCounts: Array<[string, number]> = [
    ["projectOverview", projectOverview.length],
    ["planning", planning.length],
    ["risks", risks.length],
    ["blockers", blockers.length],
    ["governance", governance.length],
    ["kpis", kpis.length],
    ["files", files.length],
  ];
  const sourceCategoriesWithRows = categoryCounts.filter(([, n]) => n > 0).map(([k]) => k);
  const healthWarnings: string[] = [];
  if (!hasStructuredSourceSnapshot) {
    healthWarnings.push(
      "No structured source snapshot was available; blueprint will rely mostly on Story Draft.",
    );
  }
  if (hasStructuredSourceSnapshot && projectOverview.length === 0) {
    healthWarnings.push("No project overview rows found.");
  }
  if (hasStructuredSourceSnapshot && risks.length === 0) {
    healthWarnings.push("No risk rows found.");
  }
  if (hasStructuredSourceSnapshot && governance.length === 0) {
    healthWarnings.push("No governance rows found.");
  }
  if (hasStructuredSourceSnapshot && kpis.length === 0) {
    healthWarnings.push("No KPI rows found.");
  }

  return {
    schemaVersion: AI_BLUEPRINT_SCHEMA_VERSION,
    templateId: AI_BLUEPRINT_TEMPLATE_ID,
    storyDraft: {
      title: args.draft.title ?? null,
      executiveSummary: args.draft.executiveSummary ?? null,
      sections: (args.draft.sections ?? []).slice(0, 20),
      attentionItems: (args.draft.attentionItems ?? []).slice(0, 20),
      sourceLimitations: (args.draft.sourceLimitations ?? []).slice(0, 20),
      evidenceSummary: (args.draft.evidenceSummary ?? []).slice(0, 20),
    },
    sourceDigest: {
      counts,
      manifestCounts,
      projectOverview,
      planning,
      risks,
      blockers,
      governance,
      kpis,
      files,
      sourceLimitations,
    },
    visualTemplateLibrary: ROADMAP_STORY_PRESENTATION_TEMPLATES.map((t) => ({
      id: t.id,
      name: t.name,
      purpose: t.purpose,
      dataCategories: t.dataCategories,
      family: t.family,
    })),
    visualSettings: args.visualSettings
      ? toVisualEnforcementLists(args.visualSettings)
      : {
          requiredBlockTypes: ROADMAP_STORY_PRESENTATION_TEMPLATES.map((t) => t.id),
          excludedBlockTypes: [],
          narrativeEnabledBlockTypes: ROADMAP_STORY_PRESENTATION_TEMPLATES
            .filter((t) => t.id !== "hero_takeaway" && t.id !== "source_limitations_footer")
            .map((t) => t.id),
          narrativeDisabledBlockTypes: [],
        },
    currentDeterministicBlueprint: args.deterministicBlockTypes && args.deterministicBlockTypes.length
      ? { note: "reference_only", blockTypes: args.deterministicBlockTypes.slice(0, 40) }
      : null,
    inputHealth: {
      hasStructuredSourceSnapshot,
      sourceCategoriesWithRows,
      warnings: healthWarnings,
    },
    rules: RULES,
  };
}

export const RULES: string[] = [
  "Return ONLY a single JSON object matching the specified schema. No prose. No markdown code fences.",
  "Do NOT invent facts. Every claim must be supported by storyDraft or sourceDigest.",
  "Do NOT return HTML, CSS, SVG, chart code, images, base64, or arbitrary layout instructions.",
  "Do NOT include URLs, http(s):// links, javascript: URIs, data: URIs, or file paths in any field.",
  "Do NOT try to define pixel sizes, colours, or styles — BTPM owns rendering.",
  "Do NOT invent metrics or numeric values — BTPM renders charts and counts from the source snapshot.",
  "Use ONLY the blockType ids listed in visualTemplateLibrary. Unknown ids are rejected.",
  "Keep narratives concise: `takeaway` ≤ 1 sentence, `summary` ≤ 3 short bullets, `implication` + `action` ≤ 1 sentence each.",
  "Set `narrative.tone` to 'risk' ONLY for genuine warnings/overdue/critical items, 'attention' for watch/caution, 'positive' for healthy/on-track, and 'neutral' otherwise.",
  "Ensure a `source_limitations_footer` block exists. Preserve any storyDraft.sourceLimitations verbatim.",
  "Use `evidenceRefs` short tags such as 'risks', 'planning', 'governance', 'file:<display_name>' — do NOT invent URLs.",
  "Prefer picking, ordering, and de-emphasising templates. Omit templates that have no supporting evidence in the source digest.",
  "Respect `visualSettings.requiredBlockTypes`: include every block type in that list when supporting data exists in the source digest.",
  "Respect `visualSettings.excludedBlockTypes`: do NOT emit any block whose type appears in that list — BTPM will strip it anyway.",
  "For blocks whose type is in `visualSettings.narrativeDisabledBlockTypes`, DO NOT include a `narrative` object — BTPM will strip narrative if you do.",
  "For blocks whose type is in `visualSettings.narrativeEnabledBlockTypes`, provide a concise narrative; leave narrative fields empty rather than invent content when unsupported.",
  "Never invent data for a block: if `visualSettings.requiredBlockTypes` names a block but the source digest lacks supporting rows, omit it and BTPM will record the gap.",
];

const PROMPT_TASK = [
  "You are the BTPM Roadmap Story Pack presentation blueprint builder.",
  "You receive: (1) an already-written Story Draft, (2) a bounded source digest with BTPM-owned rows, (3) an implemented Visual Template Library.",
  "Your job: pick, order, and describe which templates should appear in the executive presentation, and write a short in-block narrative for each.",
  "You do NOT render the presentation. You do NOT produce HTML, CSS, SVG, images, chart data, or URLs.",
  "You do NOT invent data — BTPM renders metrics and charts from the source digest.",
  "You MUST return only the JSON blueprint below.",
].join(" ");

const OUTPUT_SCHEMA = [
  "Output JSON shape (strict):",
  "{",
  `  "schemaVersion": "${AI_BLUEPRINT_SCHEMA_VERSION}",`,
  `  "templateId": "${AI_BLUEPRINT_TEMPLATE_ID}",`,
  '  "title": string,',
  '  "subtitle"?: string,',
  '  "density": "compact" | "standard" | "detailed",',
  '  "executiveTakeaway": string,',
  '  "blocks": [ {',
  '     "blockId": string,',
  '     "slotId": "opening"|"signals"|"portfolio"|"timeline"|"charts"|"movement"|"delivery"|"attention"|"kpi"|"evidence"|"limitations",',
  '     "blockType": <one of the implemented visualTemplateLibrary ids>,',
  '     "title": string,',
  '     "narrative"?: {',
  '        "takeaway"?: string,',
  '        "summary"?: string[],',
  '        "implication"?: string,',
  '        "action"?: string,',
  '        "tone"?: "neutral"|"positive"|"attention"|"risk",',
  '        "evidenceRefs"?: string[]',
  '     },',
  '     "evidenceRefs"?: string[],',
  '     "priority"?: "critical"|"high"|"medium"|"low",',
  '     "displayMode"?: "full"|"compact"|"collapsed",',
  '     "focusHints"?: string[]',
  '  } ],',
  '  "sourceLimitations": string[],',
  '  "validationNotes"?: string[]',
  "}",
].join("\n");

export function buildBlueprintSystemPrompt(): string {
  return [PROMPT_TASK, "", "STRICT RULES:", ...RULES.map((r) => `- ${r}`), "", OUTPUT_SCHEMA].join("\n");
}
