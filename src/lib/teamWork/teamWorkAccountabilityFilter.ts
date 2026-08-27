/**
 * TAE.9C — Team Work Requester/Executor client-side filter helper.
 *
 * Pure functions used by the Team Work page. Derives selectable option lists
 * from the already-loaded `TeamWorkItem[]` (no additional fetch) and applies
 * client-side filtering on the Requester/Executor accountability dimensions.
 *
 * Semantics (from TAE.9C spec):
 * - Requester dimension: (item.requested_by_stakeholder.id ∈ requesterIds)
 *   OR (includeNoRequester AND item has no Requester). Empty selection + false
 *   boolean → dimension passes for all items.
 * - Executor dimension: item has any executor whose id ∈ executorIds, OR
 *   (includeNoExecutors AND item has zero executors). Empty selection + false
 *   boolean → dimension passes for all items.
 * - Requester AND Executor combine with logical AND.
 */
import type {
  TeamWorkItem,
  TeamWorkStakeholderRef,
} from "@/hooks/useTeamWorkOverview";

export interface AccountabilityFilterOption {
  id: string;
  /** Fully composed display label including External/Former/role_label/project context. */
  name: string;
}

export interface AccountabilityFilterState {
  requesterIds: string[];
  executorIds: string[];
  includeNoRequester: boolean;
  includeNoExecutors: boolean;
}

export const EMPTY_ACCOUNTABILITY_FILTER: AccountabilityFilterState = {
  requesterIds: [],
  executorIds: [],
  includeNoRequester: false,
  includeNoExecutors: false,
};

export function isAccountabilityFilterActive(f: AccountabilityFilterState): boolean {
  return (
    f.requesterIds.length > 0 ||
    f.executorIds.length > 0 ||
    f.includeNoRequester ||
    f.includeNoExecutors
  );
}

interface AggregatedStakeholder {
  ref: TeamWorkStakeholderRef;
  projectNames: Set<string>;
}

function collect(
  items: TeamWorkItem[],
  pick: (i: TeamWorkItem) => TeamWorkStakeholderRef[],
): Map<string, AggregatedStakeholder> {
  const m = new Map<string, AggregatedStakeholder>();
  for (const item of items) {
    const refs = pick(item);
    for (const ref of refs) {
      if (!ref?.id) continue;
      let entry = m.get(ref.id);
      if (!entry) {
        entry = { ref, projectNames: new Set() };
        m.set(ref.id, entry);
      }
      if (item.project_name) entry.projectNames.add(item.project_name);
    }
  }
  return m;
}

function baseLabel(ref: TeamWorkStakeholderRef): string {
  const parts: string[] = [ref.display_name || "Unknown"];
  if (ref.stakeholder_type === "external") parts.push("(External)");
  if (ref.is_removed) parts.push("(Former)");
  if (ref.role_label) parts.push(`— ${ref.role_label}`);
  return parts.join(" ");
}

function buildOptions(
  aggregated: Map<string, AggregatedStakeholder>,
): AccountabilityFilterOption[] {
  // Count duplicate base display names so we can disambiguate with project context.
  const nameCounts = new Map<string, number>();
  for (const { ref } of aggregated.values()) {
    const key = (ref.display_name || "Unknown").toLowerCase();
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }

  const opts: AccountabilityFilterOption[] = [];
  for (const [id, { ref, projectNames }] of aggregated) {
    let name = baseLabel(ref);
    const nameKey = (ref.display_name || "Unknown").toLowerCase();
    if ((nameCounts.get(nameKey) ?? 0) > 1 && projectNames.size > 0) {
      const projList = Array.from(projectNames).sort().join(", ");
      name = `${name} · ${projList}`;
    }
    opts.push({ id, name });
  }
  opts.sort((a, b) => a.name.localeCompare(b.name));
  return opts;
}

export function deriveRequesterOptions(
  items: TeamWorkItem[],
): AccountabilityFilterOption[] {
  const aggregated = collect(items, (i) =>
    i.requested_by_stakeholder ? [i.requested_by_stakeholder] : [],
  );
  return buildOptions(aggregated);
}

export function deriveExecutorOptions(
  items: TeamWorkItem[],
): AccountabilityFilterOption[] {
  const aggregated = collect(items, (i) => i.executed_by_stakeholders ?? []);
  return buildOptions(aggregated);
}

export function applyAccountabilityFilter(
  items: TeamWorkItem[],
  f: AccountabilityFilterState,
): TeamWorkItem[] {
  if (!isAccountabilityFilterActive(f)) return items;

  const reqActive = f.requesterIds.length > 0 || f.includeNoRequester;
  const execActive = f.executorIds.length > 0 || f.includeNoExecutors;
  const reqSet = new Set(f.requesterIds);
  const execSet = new Set(f.executorIds);

  return items.filter((i) => {
    if (reqActive) {
      const req = i.requested_by_stakeholder;
      const passes =
        (req ? reqSet.has(req.id) : false) ||
        (f.includeNoRequester && !req);
      if (!passes) return false;
    }
    if (execActive) {
      const execs = i.executed_by_stakeholders ?? [];
      const passes =
        execs.some((e) => execSet.has(e.id)) ||
        (f.includeNoExecutors && execs.length === 0);
      if (!passes) return false;
    }
    return true;
  });
}
