import type { Tables } from "@/integrations/supabase/types";

export type Phase = Tables<"phases">;
export type Task = Tables<"tasks"> & { task_assignments?: { assignee_id: string }[] };
export type Dep = Tables<"dependencies">;

export interface GanttRow {
  type: "phase" | "task";
  id: string;
  name: string;
  status: string;
  start: string | null;
  end: string | null;
  /** Approved baseline range (null when project not baselined or item added pre-snapshot). */
  baselineStart?: string | null;
  baselineEnd?: string | null;
  /** True when this child was created after the project was baselined. */
  addedAfterBaseline?: boolean;
  phaseId?: string;
  assignee?: string | null;
  taskType?: string;
  /** Phase 4F.4 — execution anchors used for Gantt action gating. */
  actualStart?: string | null;
  actualEnd?: string | null;
  /** Find-in-project highlight flag (frontend-only). */
  isFindMatch?: boolean;
}


export const DAY_WIDTH = 28;
export const ROW_HEIGHT = 32;
export const HEADER_HEIGHT = 52;
export const LABEL_WIDTH = 280;

export function parseDate(d: string | null): Date | null {
  if (!d) return null;
  const parsed = new Date(d + "T00:00:00");
  return isNaN(parsed.getTime()) ? null : parsed;
}

export function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

export function formatMonthLabel(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

export function formatDateISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
