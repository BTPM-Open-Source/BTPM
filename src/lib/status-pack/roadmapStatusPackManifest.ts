/**
 * Roadmap Status Pack manifest helpers (Phase 6A.2).
 *
 * Pure, side-effect-free utilities. No data fetching, no persistence.
 */

import {
  DEFAULT_INCLUDED_ROADMAP_SECTION_IDS,
  MANDATORY_ROADMAP_STATUS_PACK_SECTION_IDS,
  ROADMAP_STATUS_PACK_SECTION_REGISTRY,
  getRoadmapStatusPackRegistryEntry,
  isKnownRoadmapStatusPackSectionId,
} from "./roadmapStatusPackRegistry";
import type {
  RoadmapFilterSnapshot,
  RoadmapStatusPackManifest,
  RoadmapStatusPackScope,
  StatusPackSectionId,
  StatusPackSectionRegistryEntry,
} from "./statusPackTypes";

export interface CreateDefaultManifestOptions {
  filters?: RoadmapFilterSnapshot;
  sourceSurface?: RoadmapStatusPackManifest["sourceSurface"];
}

/** Build the default Roadmap executive preset manifest. */
export function createDefaultRoadmapStatusPackManifest(
  opts: CreateDefaultManifestOptions = {},
): RoadmapStatusPackManifest {
  const ids = computeSectionOrder([...DEFAULT_INCLUDED_ROADMAP_SECTION_IDS]);
  return {
    manifest_version: "1",
    scope: {
      kind: "roadmap",
      workspace_ids: opts.filters?.workspace_ids,
      program_ids: opts.filters?.program_ids,
      project_ids: opts.filters?.project_ids,
      roadmap_filters: opts.filters,
    },
    selectedSectionIds: ids,
    sectionOrder: ids,
    display: { density: "comfortable" },
    appendix: { include_detail_annex: false, include_team_work_annex: false },
    createdFrom: "default",
    sourceSurface: opts.sourceSurface ?? "roadmap",
  };
}

/**
 * Normalize a manifest:
 *  - mandatory sections are always present
 *  - unknown / invalid IDs are stripped
 *  - duplicates removed
 *  - order recomputed from registry
 *  - empty / malformed input falls back to the default manifest
 */
export function sanitizeRoadmapStatusPackManifest(
  input: unknown,
): RoadmapStatusPackManifest {
  if (!input || typeof input !== "object") {
    return createDefaultRoadmapStatusPackManifest();
  }
  const m = input as Partial<RoadmapStatusPackManifest>;
  const scope = sanitizeScope(m.scope);

  const requested: string[] = Array.isArray(m.selectedSectionIds)
    ? (m.selectedSectionIds as string[])
    : [];
  const filtered = requested.filter(isKnownRoadmapStatusPackSectionId);
  const dedup = Array.from(new Set<StatusPackSectionId>(filtered));

  // Always enforce mandatory sections.
  for (const id of MANDATORY_ROADMAP_STATUS_PACK_SECTION_IDS) {
    if (!dedup.includes(id)) dedup.push(id);
  }
  const ordered = computeSectionOrder(dedup);

  // If nothing meaningful selected, fall back to default preset.
  const effectiveSelected =
    ordered.length === MANDATORY_ROADMAP_STATUS_PACK_SECTION_IDS.length &&
    requested.length === 0
      ? computeSectionOrder([...DEFAULT_INCLUDED_ROADMAP_SECTION_IDS])
      : ordered;

  return {
    manifest_version: "1",
    scope,
    selectedSectionIds: effectiveSelected,
    sectionOrder: effectiveSelected,
    display: m.display ?? { density: "comfortable" },
    appendix: m.appendix ?? {
      include_detail_annex: false,
      include_team_work_annex: false,
    },
    createdFrom: m.createdFrom ?? "default",
    sourceSurface: m.sourceSurface ?? "roadmap",
  };
}

function sanitizeScope(scope: unknown): RoadmapStatusPackScope {
  if (!scope || typeof scope !== "object") {
    return { kind: "roadmap" };
  }
  const s = scope as Partial<RoadmapStatusPackScope>;
  return {
    kind: "roadmap",
    workspace_ids: stringArrayOrUndef(s.workspace_ids),
    program_ids: stringArrayOrUndef(s.program_ids),
    project_ids: stringArrayOrUndef(s.project_ids),
    roadmap_filters: sanitizeRoadmapFilters(s.roadmap_filters),
    period: s.period,
  };
}

function sanitizeRoadmapFilters(
  filters: RoadmapFilterSnapshot | undefined,
): RoadmapFilterSnapshot | undefined {
  if (!filters || typeof filters !== "object") return filters;
  const portfolioIds = stringArrayOrUndef(
    (filters as { portfolio_item_ids?: unknown }).portfolio_item_ids,
  );
  const rawIncludeNone = (filters as { include_no_portfolio?: unknown }).include_no_portfolio;
  const includeNoPortfolio = typeof rawIncludeNone === "boolean" ? rawIncludeNone : undefined;
  return {
    ...filters,
    portfolio_item_ids: portfolioIds,
    include_no_portfolio: includeNoPortfolio,
  };
}

function stringArrayOrUndef(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === "string" && x.length > 0);
  return out.length > 0 ? out : undefined;
}

/** Compute registry-driven section order for a set of IDs. */
export function computeSectionOrder(
  ids: StatusPackSectionId[],
): StatusPackSectionId[] {
  const set = new Set(ids);
  return ROADMAP_STATUS_PACK_SECTION_REGISTRY.filter((e) => set.has(e.id)).map(
    (e) => e.id,
  );
}

/** Resolve the registry entries (in presentation order) for a manifest. */
export function getRoadmapStatusPackSectionsForManifest(
  manifest: RoadmapStatusPackManifest,
): StatusPackSectionRegistryEntry[] {
  return manifest.sectionOrder
    .map((id) => getRoadmapStatusPackRegistryEntry(id))
    .filter((e): e is StatusPackSectionRegistryEntry => Boolean(e));
}

/** Toggle an optional section (mandatory ones cannot be removed). */
export function toggleRoadmapStatusPackSection(
  manifest: RoadmapStatusPackManifest,
  id: StatusPackSectionId,
): RoadmapStatusPackManifest {
  const entry = getRoadmapStatusPackRegistryEntry(id);
  if (!entry) return manifest;
  if (entry.mandatory) return manifest; // locked
  const has = manifest.selectedSectionIds.includes(id);
  const nextIds = has
    ? manifest.selectedSectionIds.filter((s) => s !== id)
    : [...manifest.selectedSectionIds, id];
  const ordered = computeSectionOrder(nextIds);
  return { ...manifest, selectedSectionIds: ordered, sectionOrder: ordered };
}

export { isMandatoryStatusPackSection } from "./roadmapStatusPackRegistry";
