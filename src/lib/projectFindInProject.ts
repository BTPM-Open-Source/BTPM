// Frontend-only helper for "Find in project" search across phases & tasks.
// Pure functions — no side effects, no persistence, no schema impact.

export interface FindPhaseLike {
  id: string;
  name: string;
}

export interface FindTaskLike {
  id: string;
  name: string;
  phase_id: string;
}

export type FindResult =
  | { type: "phase"; id: string; name: string }
  | { type: "task"; id: string; name: string; phaseId: string; phaseName: string };

export interface FindState {
  query: string;          // normalized (trim + lowercase)
  rawQuery: string;       // exactly as typed
  matchedPhaseIds: Set<string>;
  matchedTaskIds: Set<string>;
  /** Phases that must remain visible because they themselves match OR contain a matching task. */
  contextPhaseIds: Set<string>;
  results: FindResult[];
  active: boolean;
}

export function normalizeQuery(q: string): string {
  return (q ?? "").trim().toLowerCase();
}

export function computeFindState(
  rawQuery: string,
  phases: FindPhaseLike[],
  tasks: FindTaskLike[],
): FindState {
  const q = normalizeQuery(rawQuery);
  const empty: FindState = {
    query: q,
    rawQuery,
    matchedPhaseIds: new Set(),
    matchedTaskIds: new Set(),
    contextPhaseIds: new Set(),
    results: [],
    active: false,
  };
  if (!q) return empty;

  const phaseById = new Map<string, FindPhaseLike>();
  for (const p of phases) phaseById.set(p.id, p);

  const matchedPhaseIds = new Set<string>();
  const matchedTaskIds = new Set<string>();
  const contextPhaseIds = new Set<string>();
  const results: FindResult[] = [];

  for (const p of phases) {
    if ((p.name ?? "").toLowerCase().includes(q)) {
      matchedPhaseIds.add(p.id);
      contextPhaseIds.add(p.id);
      results.push({ type: "phase", id: p.id, name: p.name });
    }
  }
  for (const t of tasks) {
    if ((t.name ?? "").toLowerCase().includes(q)) {
      matchedTaskIds.add(t.id);
      contextPhaseIds.add(t.phase_id);
      const phaseName = phaseById.get(t.phase_id)?.name ?? "";
      results.push({
        type: "task",
        id: t.id,
        name: t.name,
        phaseId: t.phase_id,
        phaseName,
      });
    }
  }

  return {
    query: q,
    rawQuery,
    matchedPhaseIds,
    matchedTaskIds,
    contextPhaseIds,
    results,
    active: true,
  };
}

export function totalMatchCount(state: FindState): number {
  return state.matchedPhaseIds.size + state.matchedTaskIds.size;
}
