/**
 * Canonical Dependency Conflict Engine (client mirror).
 *
 * This is the single source of truth for finish-to-start dependency rules
 * on the client. The DB enforces the same rules via triggers
 * (btpm_fs_pair_conflict / btpm_check_entity_schedule / enforce_*_schedule).
 * Keep both implementations behaviourally identical.
 *
 * Rule (Phase 6, v1):
 *   - Only finish-to-start is active.
 *   - Same-level only (project↔project, phase↔phase, task↔task).
 *   - predecessor_end <= successor_start  → OK   (same-day handoff allowed).
 *   - successor_start <  predecessor_end  → CONFLICT.
 *   - Missing dates on either side → cannot validate → treated as OK
 *     (UI may still show "set dates first" hints elsewhere).
 */

export type DepEntityType = "project" | "phase" | "task";

export interface DepEdge {
  id: string;
  source_id: string;
  source_type: string; // canonical: predecessor
  target_id: string;
  target_type: string; // canonical: successor
  dependency_type: string;
}

export interface EntityWindow {
  id: string;
  type: DepEntityType;
  name: string;
  start: string | null; // ISO yyyy-mm-dd
  end: string | null;   // ISO yyyy-mm-dd
}

export interface ConflictResult {
  ok: boolean;
  side?: "predecessor" | "successor";
  message?: string;
  otherId?: string;
  otherName?: string;
}

/** Pure pair check. Strict `<` so equality (same-day handoff) is allowed. */
export function fsPairConflict(predEnd: string | null, succStart: string | null): boolean {
  if (!predEnd || !succStart) return false;
  return succStart < predEnd;
}

/**
 * Bilateral check for an entity whose dates are about to change.
 * Examines incoming (predecessors) and outgoing (successors) FS edges only.
 */
export function checkEntitySchedule(args: {
  type: DepEntityType;
  id: string;
  name: string;
  newStart: string | null;
  newEnd: string | null;
  dependencies: DepEdge[];
  /** Lookup of OTHER entities' current dates (must include this entity's neighbours). */
  windows: Record<string, EntityWindow>;
}): ConflictResult {
  const { type, id, name, newStart, newEnd, dependencies, windows } = args;

  // Outgoing edges: this entity is SOURCE (predecessor).
  for (const d of dependencies) {
    if (d.dependency_type !== "finish_to_start") continue;
    if (d.source_id !== id || d.source_type !== type) continue;
    const succ = windows[d.target_id];
    if (!succ) continue;
    if (fsPairConflict(newEnd, succ.start)) {
      return {
        ok: false,
        side: "predecessor",
        otherId: succ.id,
        otherName: succ.name,
        message: `Cannot move "${name}": successor "${succ.name}" starts ${succ.start} which is before this item would finish (${newEnd}).`,
      };
    }
  }

  // Incoming edges: this entity is TARGET (successor).
  for (const d of dependencies) {
    if (d.dependency_type !== "finish_to_start") continue;
    if (d.target_id !== id || d.target_type !== type) continue;
    const pred = windows[d.source_id];
    if (!pred) continue;
    if (fsPairConflict(pred.end, newStart)) {
      return {
        ok: false,
        side: "successor",
        otherId: pred.id,
        otherName: pred.name,
        message: `Cannot move "${name}": predecessor "${pred.name}" must finish (ends ${pred.end}) on or before this item starts (would be ${newStart}).`,
      };
    }
  }

  return { ok: true };
}

/**
 * Pre-flight check before INSERTING a new dependency. Mirrors
 * enforce_dependency_schedule() on the server.
 */
export function checkDependencyCreation(args: {
  predecessor: EntityWindow;
  successor: EntityWindow;
}): ConflictResult {
  const { predecessor, successor } = args;
  if (fsPairConflict(predecessor.end, successor.start)) {
    return {
      ok: false,
      side: "successor",
      otherId: predecessor.id,
      otherName: predecessor.name,
      message: `Cannot create dependency — "${predecessor.name}" (ends ${predecessor.end}) must finish on or before "${successor.name}" starts (currently ${successor.start}).`,
    };
  }
  return { ok: true };
}

/**
 * Map a Postgres error raised by our enforce_* triggers to a friendly,
 * consistent message. Falls back to the original message when not one of ours.
 */
export function mapDependencyError(err: unknown): string {
  const raw = (err as any)?.message ? String((err as any).message) : String(err ?? "");
  // Database-level date-range check constraints (btpm_*_date_range_valid).
  if (/btpm_(projects|phases|tasks)_date_range_valid/i.test(raw)) {
    return "End date must be on or after start date.";
  }
  // Strip the "BTPM_DEP_*: " prefix; the rest is already user-readable.
  const m = raw.match(/BTPM_DEP_(?:CREATE_CONFLICT|CONFLICT_SUCC|CONFLICT_PRED):\s*(.*)$/);
  if (m) return m[1].trim();
  // Other server-side dep errors we already had:
  if (/cycle/i.test(raw)) return "This link would create a cycle. Pick a different predecessor.";
  if (/duplicate|unique/i.test(raw)) return "This dependency already exists.";
  if (/same-level/i.test(raw)) return "Dependencies must be between items of the same type.";
  if (/itself/i.test(raw)) return "An item cannot depend on itself.";
  return raw || "Could not complete operation.";
}
