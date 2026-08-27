// Mirror of the canonical BTPM visual semantics palette from
// src/lib/btpmVisualSemantics.ts. Kept local because Supabase Edge Function
// bundling cannot reach ../../../src/lib/*. If canonical hex changes, update
// this file too. Report helpers return uppercase no-hash hex for pptxgenjs.

const WORKFLOW: Record<string, string> = {
  planned: "94A3B8",
  active: "2563EB",
  completed: "059669",
  on_hold: "F59E0B",
  cancelled: "475569",
};

const WORKFLOW_LABELS: Record<string, string> = {
  planned: "Planned",
  active: "Active",
  completed: "Completed",
  on_hold: "On Hold",
  cancelled: "Cancelled",
};

const PRIORITY: Record<string, string> = {
  low: "94A3B8",
  medium: "F59E0B",
  high: "7C3AED",
  critical: "E11D48",
};

const HEALTH: Record<string, string> = {
  on_track: "059669",
  needs_attention: "F59E0B",
  behind: "F97316",
  at_risk: "E11D48",
  blocked: "E11D48",
  overdue: "E11D48",
  critical: "E11D48",
};

export function getPmWorkflowStatusReportHex(v: string | null | undefined): string {
  return (v && WORKFLOW[v]) || "94A3B8";
}

export function getPmWorkflowStatusLabel(v: string | null | undefined): string {
  if (!v) return "—";
  return WORKFLOW_LABELS[v] || v.replace(/_/g, " ");
}

export function getPmPriorityReportHex(v: string | null | undefined): string {
  return (v && PRIORITY[v]) || "94A3B8";
}

export function getPmHealthReportHex(v: string | null | undefined): string {
  return (v && HEALTH[v]) || "94A3B8";
}
