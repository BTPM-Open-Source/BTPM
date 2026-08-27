/**
 * Roadmap lifecycle grouping — single source of truth for the derived
 * reporting bucket used by:
 *   - Roadmap Overview
 *   - Roadmap Dashboard (KPI strip + sorting)
 *   - Roadmap Status generated deck (mapper mirrors these rules)
 *
 * IMPORTANT semantic rules:
 *   - `project.status` (workflow status) remains the source of truth and is
 *     what should be displayed on cards via pmStatusLabel/pmStatusBadgeClass.
 *   - This helper returns a *derived* reporting bucket only. It is never
 *     stored, never overwrites status, never persisted downstream.
 *
 * Grouping rules:
 *   completed         → status === "completed"
 *   closed_cancelled  → status === "cancelled" | "closed" | "canceled"
 *   on_hold           → status === "on_hold"
 *   current           → status === "active"
 *                       OR project has materially begun:
 *                         progress > 0
 *                         OR project_stage === "execution"
 *                         OR start_date <= asOfDate
 *                       (and is not completed/cancelled/closed/on_hold)
 *   upcoming          → planned-like status, progress is 0/null,
 *                       stage is not execution, has not materially begun
 */

export type RoadmapLifecycleGroup =
  | "current"
  | "upcoming"
  | "completed"
  | "closed_cancelled"
  | "on_hold";

export interface RoadmapLifecycleInput {
  status: string | null | undefined;
  project_stage?: string | null | undefined;
  start_date?: string | null | undefined;
  progressPercent?: number | null | undefined;
}

function isPlannedLike(status: string | null | undefined): boolean {
  if (!status) return true; // null status → treat as planned-like
  const s = status.toLowerCase();
  return s === "planned" || s === "not_started" || s === "upcoming";
}

function hasMateriallyBegun(
  p: RoadmapLifecycleInput,
  asOfDate: Date,
): boolean {
  if (typeof p.progressPercent === "number" && p.progressPercent > 0) return true;
  if ((p.project_stage || "").toLowerCase() === "execution") return true;
  if (p.start_date) {
    const t = new Date(p.start_date).getTime();
    if (!Number.isNaN(t) && t <= asOfDate.getTime()) return true;
  }
  return false;
}

export function getRoadmapLifecycleGroup(
  project: RoadmapLifecycleInput,
  asOfDate: Date = new Date(),
): RoadmapLifecycleGroup {
  const s = (project.status || "").toLowerCase();
  if (s === "completed") return "completed";
  if (s === "cancelled" || s === "canceled" || s === "closed") return "closed_cancelled";
  if (s === "on_hold") return "on_hold";
  if (s === "active") return "current";

  // Planned / null / unknown — decide based on whether work has begun.
  if (isPlannedLike(s) || s === "") {
    if (hasMateriallyBegun(project, asOfDate)) return "current";
    return "upcoming";
  }

  // Unknown non-standard status — conservative default: treat as current
  // rather than misleading "upcoming". Card still displays raw status.
  return "current";
}
