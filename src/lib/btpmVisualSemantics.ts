/**
 * BTPM Visual Semantics — canonical source of truth for status / priority /
 * health / stage colors and labels used across the live app.
 *
 * Operational palette (best-practice SaaS/PM). BTPM shell colors
 * remain in app chrome and are NOT redefined here.
 *
 * Workflow: planned #94A3B8, active #2563EB, completed #059669,
 *           on_hold #F59E0B, cancelled #475569.
 * Priority: low #94A3B8, medium #F59E0B, high #7C3AED, critical #E11D48.
 * Health:   on_track #059669, needs_attention #F59E0B, behind #F97316,
 *           at_risk/blocked/overdue/critical #E11D48.
 * Stage:    planning #0EA5E9, initiation #14B8A6, execution #6366F1,
 *           closing/closure #2563EB.
 *
 * All Tailwind class strings are static arbitrary values so the JIT can
 * compile them.
 */

// ---------- PM Workflow Status ----------

export const PM_WORKFLOW_STATUS_VALUES = [
  "planned",
  "active",
  "completed",
  "on_hold",
  "cancelled",
] as const;
export type PmWorkflowStatus = (typeof PM_WORKFLOW_STATUS_VALUES)[number];

const PM_WORKFLOW_STATUS_LABELS: Record<PmWorkflowStatus, string> = {
  planned: "Planned",
  active: "Active",
  completed: "Completed",
  on_hold: "On Hold",
  cancelled: "Cancelled",
};

const PM_WORKFLOW_STATUS_HEX: Record<PmWorkflowStatus, string> = {
  planned: "#94A3B8",
  active: "#2563EB",
  completed: "#059669",
  on_hold: "#F59E0B",
  cancelled: "#475569",
};

const PM_WORKFLOW_STATUS_BADGE_CLASS: Record<PmWorkflowStatus, string> = {
  planned: "bg-[#94A3B8]/10 text-[#94A3B8] border-[#94A3B8]/20",
  active: "bg-[#2563EB]/10 text-[#2563EB] border-[#2563EB]/20",
  completed: "bg-[#059669]/10 text-[#059669] border-[#059669]/20",
  on_hold: "bg-[#F59E0B]/10 text-[#F59E0B] border-[#F59E0B]/20",
  cancelled: "bg-[#475569]/10 text-[#475569] border-[#475569]/20",
};

const PM_WORKFLOW_STATUS_DOT_CLASS: Record<PmWorkflowStatus, string> = {
  planned: "bg-[#94A3B8]",
  active: "bg-[#2563EB]",
  completed: "bg-[#059669]",
  on_hold: "bg-[#F59E0B]",
  cancelled: "bg-[#475569]",
};

const PM_WORKFLOW_STATUS_BORDER_TOP_CLASS: Record<PmWorkflowStatus, string> = {
  planned: "border-t-[#94A3B8]",
  active: "border-t-[#2563EB]",
  completed: "border-t-[#059669]",
  on_hold: "border-t-[#F59E0B]",
  cancelled: "border-t-[#475569]",
};

export function getPmWorkflowStatusBorderTopClass(
  value: string | null | undefined,
): string {
  if (isPmWorkflowStatus(value)) return PM_WORKFLOW_STATUS_BORDER_TOP_CLASS[value];
  return "border-t-border";
}

function isPmWorkflowStatus(v: unknown): v is PmWorkflowStatus {
  return (
    typeof v === "string" &&
    (PM_WORKFLOW_STATUS_VALUES as readonly string[]).includes(v)
  );
}

export function getPmWorkflowStatusLabel(value: string | null | undefined): string {
  if (!value) return "—";
  if (isPmWorkflowStatus(value)) return PM_WORKFLOW_STATUS_LABELS[value];
  return value.replace(/_/g, " ");
}

export function getPmWorkflowStatusHex(value: string | null | undefined): string {
  if (isPmWorkflowStatus(value)) return PM_WORKFLOW_STATUS_HEX[value];
  return "#94A3B8";
}

export function getPmWorkflowStatusBadgeClass(value: string | null | undefined): string {
  if (isPmWorkflowStatus(value)) return PM_WORKFLOW_STATUS_BADGE_CLASS[value];
  return "";
}

export function getPmWorkflowStatusDotClass(value: string | null | undefined): string {
  if (isPmWorkflowStatus(value)) return PM_WORKFLOW_STATUS_DOT_CLASS[value];
  return "bg-slate-400";
}

export function getPmWorkflowStatusBarStyle(
  value: string | null | undefined,
): { backgroundColor: string } {
  return { backgroundColor: getPmWorkflowStatusHex(value) };
}

export function getPmWorkflowStatusFillStyle(
  value: string | null | undefined,
): { fill: string } {
  return { fill: getPmWorkflowStatusHex(value) };
}

export function getPmPriorityStyle(
  value: string | null | undefined,
): { backgroundColor: string } {
  return { backgroundColor: getPmPriorityHex(value) };
}

// ---------- Priority ----------

export const PM_PRIORITY_VALUES = ["low", "medium", "high", "critical"] as const;
export type PmPriority = (typeof PM_PRIORITY_VALUES)[number];

const PM_PRIORITY_LABELS: Record<PmPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

const PM_PRIORITY_HEX: Record<PmPriority, string> = {
  low: "#94A3B8",
  medium: "#F59E0B",
  high: "#7C3AED",
  critical: "#E11D48",
};

const PM_PRIORITY_BADGE_CLASS: Record<PmPriority, string> = {
  low: "bg-[#94A3B8]/10 text-[#94A3B8] border-[#94A3B8]/20",
  medium: "bg-[#F59E0B]/10 text-[#F59E0B] border-[#F59E0B]/20",
  high: "bg-[#7C3AED]/10 text-[#7C3AED] border-[#7C3AED]/20",
  critical: "bg-[#E11D48]/10 text-[#E11D48] border-[#E11D48]/20",
};

function isPmPriority(v: unknown): v is PmPriority {
  return (
    typeof v === "string" &&
    (PM_PRIORITY_VALUES as readonly string[]).includes(v)
  );
}

export function getPmPriorityLabel(value: string | null | undefined): string {
  if (!value) return "—";
  if (isPmPriority(value)) return PM_PRIORITY_LABELS[value];
  return value;
}

export function getPmPriorityHex(value: string | null | undefined): string {
  if (isPmPriority(value)) return PM_PRIORITY_HEX[value];
  return "#94A3B8";
}

export function getPmPriorityBadgeClass(value: string | null | undefined): string {
  if (isPmPriority(value)) return PM_PRIORITY_BADGE_CLASS[value];
  return "";
}

// ---------- Health ----------

export const PM_HEALTH_VALUES = [
  "on_track",
  "needs_attention",
  "behind",
  "at_risk",
  "blocked",
  "overdue",
  "critical",
] as const;
export type PmHealth = (typeof PM_HEALTH_VALUES)[number];

const PM_HEALTH_LABELS: Record<PmHealth, string> = {
  on_track: "On Track",
  needs_attention: "Needs Attention",
  behind: "Behind",
  at_risk: "At Risk",
  blocked: "Blocked",
  overdue: "Overdue",
  critical: "Critical",
};

const PM_HEALTH_HEX: Record<PmHealth, string> = {
  on_track: "#059669",
  needs_attention: "#F59E0B",
  behind: "#F97316",
  at_risk: "#E11D48",
  blocked: "#E11D48",
  overdue: "#E11D48",
  critical: "#E11D48",
};

const PM_HEALTH_BADGE_CLASS: Record<PmHealth, string> = {
  on_track: "bg-[#059669]/10 text-[#059669] border-[#059669]/20",
  needs_attention: "bg-[#F59E0B]/10 text-[#F59E0B] border-[#F59E0B]/20",
  behind: "bg-[#F97316]/10 text-[#F97316] border-[#F97316]/20",
  at_risk: "bg-[#E11D48]/10 text-[#E11D48] border-[#E11D48]/20",
  blocked: "bg-[#E11D48]/10 text-[#E11D48] border-[#E11D48]/20",
  overdue: "bg-[#E11D48]/10 text-[#E11D48] border-[#E11D48]/20",
  critical: "bg-[#E11D48]/10 text-[#E11D48] border-[#E11D48]/20",
};

const PM_HEALTH_DOT_CLASS: Record<PmHealth, string> = {
  on_track: "bg-[#059669]",
  needs_attention: "bg-[#F59E0B]",
  behind: "bg-[#F97316]",
  at_risk: "bg-[#E11D48]",
  blocked: "bg-[#E11D48]",
  overdue: "bg-[#E11D48]",
  critical: "bg-[#E11D48]",
};

const PM_HEALTH_BAR_BORDER_CLASS: Record<PmHealth, string> = {
  on_track: "border-l-[#059669]",
  needs_attention: "border-l-[#F59E0B]",
  behind: "border-l-[#F97316]",
  at_risk: "border-l-[#E11D48]",
  blocked: "border-l-[#E11D48]",
  overdue: "border-l-[#E11D48]",
  critical: "border-l-[#E11D48]",
};

export function getPmHealthDotClass(v: string | null | undefined): string {
  if (isPmHealth(v)) return PM_HEALTH_DOT_CLASS[v];
  return "bg-muted-foreground/40";
}

export function getPmHealthBarBorderClass(v: string | null | undefined): string {
  if (isPmHealth(v)) return PM_HEALTH_BAR_BORDER_CLASS[v];
  return "border-l-border";
}

function isPmHealth(v: unknown): v is PmHealth {
  return typeof v === "string" && (PM_HEALTH_VALUES as readonly string[]).includes(v);
}

export function getPmHealthLabel(v: string | null | undefined): string {
  if (!v) return "—";
  if (isPmHealth(v)) return PM_HEALTH_LABELS[v];
  return v.replace(/_/g, " ");
}
export function getPmHealthHex(v: string | null | undefined): string {
  if (isPmHealth(v)) return PM_HEALTH_HEX[v];
  return "#94A3B8";
}
export function getPmHealthBadgeClass(v: string | null | undefined): string {
  if (isPmHealth(v)) return PM_HEALTH_BADGE_CLASS[v];
  return "";
}

// ---------- Stage ----------

export const PM_STAGE_VALUES = [
  "initiation",
  "planning",
  "execution",
  "closing",
  "closure",
] as const;
export type PmStage = (typeof PM_STAGE_VALUES)[number];

const PM_STAGE_LABELS: Record<PmStage, string> = {
  initiation: "Initiation",
  planning: "Planning",
  execution: "Execution",
  closing: "Closing",
  closure: "Closure",
};

const PM_STAGE_HEX: Record<PmStage, string> = {
  initiation: "#14B8A6",
  planning: "#0EA5E9",
  execution: "#6366F1",
  closing: "#2563EB",
  closure: "#2563EB",
};

function isPmStage(v: unknown): v is PmStage {
  return typeof v === "string" && (PM_STAGE_VALUES as readonly string[]).includes(v);
}

export function getPmStageLabel(v: string | null | undefined): string {
  if (!v) return "—";
  if (isPmStage(v)) return PM_STAGE_LABELS[v];
  return v.replace(/_/g, " ");
}
export function getPmStageHex(v: string | null | undefined): string {
  if (isPmStage(v)) return PM_STAGE_HEX[v];
  return "#94A3B8";
}

// ---------- Progress ----------
// Semantic color helper for operational completion/progress bars.

export function getPmProgressHex(): string {
  return "#059669";
}

export function getPmProgressStyle(): { backgroundColor: string } {
  return { backgroundColor: getPmProgressHex() };
}

// ---------- Generated-report / PPT-safe helpers ----------
// PPT libraries such as pptxgenjs consume colors as uppercase hex WITHOUT the
// leading "#". These helpers DERIVE from the canonical maps above so there is
// only ever one source of truth for BTPM color semantics.

function stripHash(hex: string): string {
  return hex.replace(/^#/, "").toUpperCase();
}

export function getPmWorkflowStatusReportHex(value: string | null | undefined): string {
  return stripHash(getPmWorkflowStatusHex(value));
}

export function getPmPriorityReportHex(value: string | null | undefined): string {
  return stripHash(getPmPriorityHex(value));
}

export function getPmHealthReportHex(value: string | null | undefined): string {
  return stripHash(getPmHealthHex(value));
}

export function getPmStageReportHex(value: string | null | undefined): string {
  return stripHash(getPmStageHex(value));
}
