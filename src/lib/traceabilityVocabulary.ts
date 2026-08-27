/**
 * Wave B.5+ — Traceability vocabulary & event summarizer.
 *
 * One single source of truth for how raw activity_events are presented in the
 * Project Traceability Sheet. Pure presentation: never derives, never persists.
 *
 * Strict separation rule: comments and execution updates are NOT events here
 * by design — they live in their own collaboration surfaces.
 */
import type { ProjectObjectIndex } from "@/hooks/useProjectObjectIndex";

export type EventClass =
  | "status"
  | "schedule"
  | "baseline"
  | "dependency"
  | "blocker"
  | "risk"
  | "kpi"
  | "lifecycle"
  | "stage"
  | "stakeholder"
  | "governance"
  | "adoption"
  | "assignment"
  | "metadata"
  | "auto"
  | "other";

export const EVENT_CLASS_ORDER: { value: EventClass | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "status", label: "Status" },
  { value: "schedule", label: "Schedule" },
  { value: "metadata", label: "Edits" },
  { value: "assignment", label: "Assignment" },
  { value: "governance", label: "Governance" },
  { value: "adoption", label: "Adoption" },
  { value: "baseline", label: "Baseline" },
  { value: "dependency", label: "Dependency" },
  { value: "blocker", label: "Blocker" },
  { value: "risk", label: "Risk" },
  { value: "kpi", label: "KPI" },
  { value: "lifecycle", label: "Lifecycle" },
  { value: "stage", label: "Stage" },
  { value: "stakeholder", label: "Stakeholder" },
  { value: "auto", label: "Auto-derivation" },
];

export function classifyEvent(eventType: string): EventClass {
  const t = eventType.toLowerCase();
  if (t.startsWith("adoption_")) return "adoption";
  if (t === "status_changed" || t === "project_status_changed") return "status";
  if (
    t === "schedule_changed" ||
    t === "phase_plan_moved" ||
    t === "phase_remaining_work_shifted" ||
    t === "phase_resized" ||
    t === "parent_extended_for_child_edit"
  )
    return "schedule";
  if (t.startsWith("baseline_")) return "baseline";
  if (t.startsWith("dependency_")) return "dependency";
  if (t.startsWith("blocker_")) return "blocker";
  if (t.startsWith("risk_")) return "risk";
  if (t.startsWith("kpi_")) return "kpi";
  if (t.startsWith("governance_")) return "governance";
  if (
    t === "task_assignee_changed" ||
    t === "raci_assignment_added" ||
    t === "raci_assignment_removed"
  )
    return "assignment";
  if (
    t === "project_created" ||
    t === "project_metadata_updated" ||
    t === "phase_created" ||
    t === "phase_metadata_updated" ||
    t === "task_created" ||
    t === "task_metadata_updated" ||
    t === "task_moved"
  )
    return "metadata";
  if (
    t.startsWith("lifecycle.") ||
    t.endsWith("_archived") ||
    t.endsWith("_unarchived") ||
    t.endsWith("_restored") ||
    t === "task_reopened"
  )
    return "lifecycle";
  if (t === "project_stage_transitioned") return "stage";
  if (t.startsWith("stakeholder_")) return "stakeholder";
  if (t.startsWith("phase_auto_") || t === "task_actual_dates_updated") return "auto";
  return "other";
}

export const TARGET_LABELS: Record<string, string> = {
  project: "Project",
  phase: "Phase",
  task: "Task",
  blocker: "Blocker",
  risk: "Risk",
  kpi_definition: "KPI",
  governance_cadence: "Cadence",
  governance_record: "Governance",
};

export function targetLabel(targetType: string): string {
  return TARGET_LABELS[targetType] ?? targetType;
}

// ---------- Helpers ----------

type Meta = Record<string, unknown>;

export function parseMetadata(metaInput: unknown): Meta | null {
  if (!metaInput) return null;
  if (typeof metaInput === "string") {
    try {
      const parsed = JSON.parse(metaInput);
      return parsed && typeof parsed === "object" ? (parsed as Meta) : null;
    } catch {
      return null;
    }
  }
  if (typeof metaInput === "object") return metaInput as Meta;
  return null;
}

function fmtDate(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  const s = String(v);
  // YYYY-MM-DD or ISO timestamp — render as a short date
  const d = new Date(s.length === 10 ? `${s}T00:00:00` : s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString(undefined, { dateStyle: "medium" });
}

function fmtNum(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
}

function statusToken(v: unknown): string {
  if (v === null || v === undefined) return "—";
  return String(v).replace(/_/g, " ");
}

function truncate(v: unknown, max = 80): string {
  const s = v === null || v === undefined ? "—" : String(v);
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

/** Render the metadata payload of a *_updated event into readable delta lines. */
function appendUpdateDeltas(meta: Meta, out: string[]): void {
  const changed = (meta.changed_fields ?? {}) as Record<string, { old?: unknown; new?: unknown }>;
  const fieldLabel: Record<string, string> = {
    title: "Title",
    name: "Name",
    description: "Description",
    severity: "Severity",
    mitigation_plan: "Mitigation plan",
    likelihood: "Likelihood",
    impact: "Impact",
    priority: "Priority",
    program_id: "Program",
    delivery_model: "Delivery model",
    task_type: "Task type",
    estimated_hours: "Estimated hours",
    owner_id: "Owner",
  };
  for (const [field, val] of Object.entries(changed)) {
    if (!val || typeof val !== "object") continue;
    const label = fieldLabel[field] ?? field.replace(/_/g, " ");
    if (
      field === "description" ||
      field === "mitigation_plan" ||
      field === "title" ||
      field === "name"
    ) {
      out.push(`${label}: "${truncate(val.old)}" → "${truncate(val.new)}"`);
    } else {
      out.push(`${label}: ${statusToken(val.old)} → ${statusToken(val.new)}`);
    }
  }
  const peopleAdded = Array.isArray(meta.people_added) ? (meta.people_added as Array<{ display_name?: string | null; user_id?: string }>) : [];
  const peopleRemoved = Array.isArray(meta.people_removed) ? (meta.people_removed as Array<{ display_name?: string | null; user_id?: string }>) : [];
  if (peopleAdded.length > 0) {
    out.push(`People added: ${peopleAdded.map((p) => p.display_name || (p.user_id ? p.user_id.slice(0, 8) : "?")).join(", ")}`);
  }
  if (peopleRemoved.length > 0) {
    out.push(`People removed: ${peopleRemoved.map((p) => p.display_name || (p.user_id ? p.user_id.slice(0, 8) : "?")).join(", ")}`);
  }
  const objsAdded = Array.isArray(meta.objects_added) ? (meta.objects_added as Array<{ referenced_type?: string; display_label?: string | null; referenced_id?: string }>) : [];
  const objsRemoved = Array.isArray(meta.objects_removed) ? (meta.objects_removed as Array<{ referenced_type?: string; display_label?: string | null; referenced_id?: string }>) : [];
  const fmtObj = (o: { referenced_type?: string; display_label?: string | null; referenced_id?: string }) => {
    const type = o.referenced_type ? targetLabel(o.referenced_type) : "Item";
    const name = o.display_label || (o.referenced_id ? o.referenced_id.slice(0, 8) : "?");
    return `${type} "${name}"`;
  };
  if (objsAdded.length > 0) out.push(`Items added: ${objsAdded.map(fmtObj).join(", ")}`);
  if (objsRemoved.length > 0) out.push(`Items removed: ${objsRemoved.map(fmtObj).join(", ")}`);
}

// ---------- Event summarizer ----------

export type EventSummary = {
  /** "Task", "Phase", "Project", "Blocker", "Risk", "KPI" — for the chip */
  objectTypeLabel: string;
  /** Resolved object name if known, else null (UI falls back to "—") */
  objectName: string | null;
  /** Optional hierarchical hint, e.g. "Phase: UAT" for a task event */
  contextLine: string | null;
  /** Concise human-readable summary line */
  summary: string;
  /** Optional structured before/after detail lines */
  deltaLines: string[];
};

/** Resolve a name from the index, or fall back to a metadata field, or null. */
function resolveName(
  index: ProjectObjectIndex | undefined,
  id: unknown,
  fallback?: unknown,
): string | null {
  if (typeof id === "string" && index?.byId[id]) return index.byId[id].name;
  if (typeof fallback === "string" && fallback.trim()) return fallback;
  return null;
}

/** Build the summary for an event row. Pure function; safe in render. */
export function summarizeEvent(args: {
  eventType: string;
  targetType: string;
  targetId: string;
  metadata: unknown;
  index?: ProjectObjectIndex;
}): EventSummary {
  const { eventType, targetType, targetId, metadata, index } = args;
  const meta = parseMetadata(metadata) ?? {};
  const t = eventType.toLowerCase();

  // Object name resolution: prefer the project index, then metadata fallbacks.
  const objectTypeLabel = targetLabel(targetType);
  const fallbackName =
    (meta.phase_name as string | undefined) ||
    (meta.task_name as string | undefined) ||
    (meta.project_name as string | undefined) ||
    (meta.kpi_name as string | undefined) ||
    (meta.title as string | undefined) ||
    undefined;
  const objectName = resolveName(index, targetId, fallbackName);

  // Hierarchical context (e.g. "Phase: UAT" on a task event)
  let contextLine: string | null = null;
  if (targetType === "task") {
    const taskEntry = index?.byId[targetId];
    // We don't carry phase_id on every task event, but when present:
    const phaseId = (meta.phase_id as string | undefined) ?? undefined;
    if (phaseId && index?.byId[phaseId]) {
      contextLine = `Phase: ${index.byId[phaseId].name}`;
    } else if (taskEntry) {
      // index doesn't store phase linkage today; skip silently
      contextLine = null;
    }
  } else if (targetType === "blocker" || targetType === "risk" || targetType === "kpi_definition") {
    const anchorType = meta.anchor_type as string | undefined;
    const anchorId = meta.anchor_id as string | undefined;
    const anchorName = resolveName(index, anchorId);
    if (anchorType && (anchorName || anchorId)) {
      contextLine = `${targetLabel(anchorType)}: ${anchorName ?? "—"}`;
    }
  }

  // ----- Per-event-type rendering -----
  let summary = "";
  const deltaLines: string[] = [];

  // Status
  if (t === "status_changed") {
    summary = `${objectTypeLabel}${objectName ? ` "${objectName}"` : ""} status changed`;
    if ("old_status" in meta || "new_status" in meta) {
      deltaLines.push(`Status: ${statusToken(meta.old_status)} → ${statusToken(meta.new_status)}`);
    }
  }

  // Schedule
  else if (t === "schedule_changed") {
    summary = `${objectTypeLabel}${objectName ? ` "${objectName}"` : ""} planned dates changed`;
    if (meta.old_start !== meta.new_start) {
      deltaLines.push(`Start: ${fmtDate(meta.old_start)} → ${fmtDate(meta.new_start)}`);
    }
    if (meta.old_end !== meta.new_end) {
      deltaLines.push(`End: ${fmtDate(meta.old_end)} → ${fmtDate(meta.new_end)}`);
    }
    if (meta.after_baseline === true) {
      deltaLines.push("Edited after baseline approval");
    }
  } else if (
    t === "phase_plan_moved" ||
    t === "phase_remaining_work_shifted" ||
    t === "phase_resized"
  ) {
    const verb =
      t === "phase_remaining_work_shifted"
        ? "remaining work shifted"
        : t === "phase_resized"
          ? "resized"
          : "plan moved";
    summary = `Phase${objectName ? ` "${objectName}"` : ""} ${verb}`;
    if (meta.old_start !== meta.new_start) {
      deltaLines.push(`Start: ${fmtDate(meta.old_start)} → ${fmtDate(meta.new_start)}`);
    }
    if (meta.old_end !== meta.new_end) {
      deltaLines.push(`End: ${fmtDate(meta.old_end)} → ${fmtDate(meta.new_end)}`);
    }
    if (typeof meta.delta_days === "number" && meta.delta_days !== 0) {
      const sign = meta.delta_days > 0 ? "+" : "";
      deltaLines.push(`Shift: ${sign}${meta.delta_days}d`);
    }
    if (typeof meta.moved_children_count === "number") {
      deltaLines.push(`Tasks moved: ${meta.moved_children_count}`);
    }
  } else if (t === "parent_extended_for_child_edit") {
    const triggerKind = (meta.trigger_kind as string | undefined) ?? "child";
    const triggerId = meta.trigger_id as string | undefined;
    const triggerName = resolveName(index, triggerId);
    summary =
      `${objectTypeLabel}${objectName ? ` "${objectName}"` : ""} window extended for ` +
      `${triggerKind}${triggerName ? ` "${triggerName}"` : ""}`;
    if (meta.old_start !== meta.new_start) {
      deltaLines.push(`Start: ${fmtDate(meta.old_start)} → ${fmtDate(meta.new_start)}`);
    }
    if (meta.old_end !== meta.new_end) {
      deltaLines.push(`End: ${fmtDate(meta.old_end)} → ${fmtDate(meta.new_end)}`);
    }
  }

  // Auto: actual-date update
  else if (t === "task_actual_dates_updated") {
    summary = `Task${objectName ? ` "${objectName}"` : ""} actual dates updated`;
    if (meta.old_actual_start_date !== meta.new_actual_start_date) {
      deltaLines.push(
        `Actual start: ${fmtDate(meta.old_actual_start_date)} → ${fmtDate(meta.new_actual_start_date)}`,
      );
    }
    if (meta.old_actual_end_date !== meta.new_actual_end_date) {
      deltaLines.push(
        `Actual end: ${fmtDate(meta.old_actual_end_date)} → ${fmtDate(meta.new_actual_end_date)}`,
      );
    }
  } else if (t === "phase_auto_completed" || t === "phase_auto_reopened") {
    const verb = t === "phase_auto_completed" ? "auto-completed" : "auto-reopened";
    summary = `Phase${objectName ? ` "${objectName}"` : ""} ${verb}`;
    if (meta.prior_status || meta.new_status) {
      deltaLines.push(`Status: ${statusToken(meta.prior_status)} → ${statusToken(meta.new_status)}`);
    }
    if (meta.reason) {
      deltaLines.push(`Reason: ${String(meta.reason).replace(/_/g, " ")}`);
    }
  }

  // Baseline
  else if (t === "baseline_approved") {
    summary = `Baseline approved on Project${objectName ? ` "${objectName}"` : ""}`;
  } else if (t === "baseline_rebaselined") {
    summary = `Project${objectName ? ` "${objectName}"` : ""} rebaselined`;
  } else if (t === "baseline_post_add") {
    summary = `${objectTypeLabel}${objectName ? ` "${objectName}"` : ""} added after baseline approval`;
    if (meta.baseline_start || meta.baseline_end) {
      deltaLines.push(
        `Baseline window: ${fmtDate(meta.baseline_start)} → ${fmtDate(meta.baseline_end)}`,
      );
    }
  }

  // Dependency
  else if (t === "dependency_added" || t === "dependency_removed") {
    const predName = resolveName(index, meta.predecessor_id) ?? "—";
    const succName = resolveName(index, meta.successor_id) ?? "—";
    const verb = t === "dependency_added" ? "added" : "removed";
    summary = `Dependency ${verb}: "${predName}" → "${succName}"`;
    if (meta.dependency_type) {
      deltaLines.push(`Type: ${String(meta.dependency_type)}`);
    }
  } else if (t === "dependency_type_changed") {
    const predName = resolveName(index, meta.predecessor_id) ?? "—";
    const succName = resolveName(index, meta.successor_id) ?? "—";
    summary = `Dependency type changed: "${predName}" → "${succName}"`;
    deltaLines.push(
      `Type: ${String(meta.old_dependency_type ?? "—")} → ${String(meta.new_dependency_type ?? "—")}`,
    );
  }

  // Blocker
  else if (t === "blocker_opened") {
    summary = `Blocker opened${objectName ? `: "${objectName}"` : ""}`;
    if (meta.severity) deltaLines.push(`Severity: ${statusToken(meta.severity)}`);
    if (meta.status) deltaLines.push(`State: ${statusToken(meta.status)}`);
  } else if (t === "blocker_state_changed" || t === "blocker_resolved") {
    const verb = t === "blocker_resolved" ? "resolved" : "state changed";
    summary = `Blocker ${verb}${objectName ? `: "${objectName}"` : ""}`;
    if (meta.old_status || meta.new_status) {
      deltaLines.push(`State: ${statusToken(meta.old_status)} → ${statusToken(meta.new_status)}`);
    }
  } else if (t === "blocker_updated" || t === "risk_updated") {
    const noun = t === "blocker_updated" ? "Blocker" : "Risk";
    summary = `${noun} updated${objectName ? `: "${objectName}"` : ""}`;
    appendUpdateDeltas(meta, deltaLines);
  }

  // Risk
  else if (t === "risk_opened") {
    summary = `Risk opened${objectName ? `: "${objectName}"` : ""}`;
    if (meta.likelihood) deltaLines.push(`Likelihood: ${statusToken(meta.likelihood)}`);
    if (meta.impact) deltaLines.push(`Impact: ${statusToken(meta.impact)}`);
    if (meta.status) deltaLines.push(`State: ${statusToken(meta.status)}`);
  } else if (t === "risk_state_changed") {
    summary = `Risk state changed${objectName ? `: "${objectName}"` : ""}`;
    if (meta.old_status || meta.new_status) {
      deltaLines.push(`State: ${statusToken(meta.old_status)} → ${statusToken(meta.new_status)}`);
    }
  }

  // KPI
  else if (t === "kpi_value_recorded") {
    const kpiName = (meta.kpi_name as string | undefined) ?? objectName ?? "KPI";
    const unit = meta.unit ? ` ${meta.unit}` : "";
    summary = `KPI value recorded for "${kpiName}"`;
    deltaLines.push(`Value: ${fmtNum(meta.value)}${unit}`);
    if (meta.update_date) deltaLines.push(`As of: ${fmtDate(meta.update_date)}`);
  } else if (t === "kpi_target_changed") {
    const kpiName = (meta.kpi_name as string | undefined) ?? objectName ?? "KPI";
    summary = `KPI target changed: "${kpiName}"`;
    if (meta.old_target_value !== meta.new_target_value) {
      deltaLines.push(
        `Target: ${fmtNum(meta.old_target_value)} → ${fmtNum(meta.new_target_value)}`,
      );
    }
    if (meta.old_target_direction !== meta.new_target_direction) {
      deltaLines.push(
        `Direction: ${statusToken(meta.old_target_direction)} → ${statusToken(meta.new_target_direction)}`,
      );
    }
    if (meta.old_unit !== meta.new_unit) {
      deltaLines.push(`Unit: ${String(meta.old_unit ?? "—")} → ${String(meta.new_unit ?? "—")}`);
    }
  }

  // Stage
  else if (t === "project_stage_transitioned") {
    summary = `Project${objectName ? ` "${objectName}"` : ""} stage changed`;
    if (meta.old_stage || meta.new_stage) {
      deltaLines.push(`Stage: ${statusToken(meta.old_stage)} → ${statusToken(meta.new_stage)}`);
    }
  }

  // Stakeholder
  else if (t.startsWith("stakeholder_")) {
    const sName = (meta.display_name as string | undefined) ?? "stakeholder";
    const sType = meta.stakeholder_type === "external" ? "external" : "workspace member";
    if (t === "stakeholder_added") {
      summary = `Stakeholder added: "${sName}" (${sType})`;
      if (meta.role_label) deltaLines.push(`Role: ${String(meta.role_label)}`);
    } else if (t === "stakeholder_updated") {
      summary = `Stakeholder updated: "${sName}"`;
      if (meta.old_role_label !== meta.new_role_label) {
        deltaLines.push(
          `Role: ${meta.old_role_label ? String(meta.old_role_label) : "—"} → ${meta.new_role_label ? String(meta.new_role_label) : "—"}`,
        );
      }
      if (
        meta.old_external_name !== meta.new_external_name &&
        (meta.old_external_name || meta.new_external_name)
      ) {
        deltaLines.push(
          `Name: ${meta.old_external_name ? String(meta.old_external_name) : "—"} → ${meta.new_external_name ? String(meta.new_external_name) : "—"}`,
        );
      }
    } else if (t === "stakeholder_removed") {
      summary = `Stakeholder removed: "${sName}" (${sType})`;
      if (meta.role_label) deltaLines.push(`Role: ${String(meta.role_label)}`);
    } else if (t === "stakeholder_restored") {
      summary = `Stakeholder restored: "${sName}" (${sType})`;
      if (meta.role_label) deltaLines.push(`Role: ${String(meta.role_label)}`);
    } else {
      summary = `Stakeholder ${t.replace("stakeholder_", "").replace(/_/g, " ")}: "${sName}"`;
    }
  }

  // Governance — handled before generic lifecycle so *_archived / *_restored
  // governance events render with a governance-specific summary.
  else if (t.startsWith("governance_cadence_") || t.startsWith("governance_record_")) {
    const noun = t.startsWith("governance_cadence_") ? "Governance cadence" : "Governance record";
    if (t.endsWith("_created")) {
      summary = `${noun} created${objectName ? `: "${objectName}"` : ""}`;
      if (meta.event_type) deltaLines.push(`Event type: ${statusToken(meta.event_type)}`);
      if (meta.frequency_type) deltaLines.push(`Frequency: ${statusToken(meta.frequency_type)}`);
    } else if (t.endsWith("_updated")) {
      summary = `${noun} updated${objectName ? `: "${objectName}"` : ""}`;
      const changed = (meta.changed_fields ?? {}) as Record<string, { old?: unknown; new?: unknown }>;
      for (const [field, val] of Object.entries(changed)) {
        if (!val || typeof val !== "object") continue;
        deltaLines.push(`${field.replace(/_/g, " ")}: ${statusToken(val.old)} → ${statusToken(val.new)}`);
      }
    } else if (t === "governance_record_decisions_updated") {
      const count =
        typeof meta.decision_count === "number"
          ? meta.decision_count
          : Array.isArray(meta.decisions)
            ? meta.decisions.length
            : null;
      summary = `Governance decisions updated${objectName ? ` on "${objectName}"` : ""}${
        count !== null ? ` — ${count} decision(s)` : ""
      }`;
    } else if (t === "governance_record_links_updated") {
      summary = `Governance links updated${objectName ? ` on "${objectName}"` : ""}`;
    } else if (t.endsWith("_archived")) {
      summary = `${noun} archived${objectName ? `: "${objectName}"` : ""}`;
    } else if (t.endsWith("_restored") || t.endsWith("_unarchived")) {
      summary = `${noun} restored${objectName ? `: "${objectName}"` : ""}`;
    } else {
      summary = `${noun} ${t.replace(/^governance_(cadence|record)_/, "").replace(/_/g, " ")}${objectName ? `: "${objectName}"` : ""}`;
    }
  }

  // Project / phase / task metadata + assignment
  else if (t === "project_created") {
    summary = `Project${objectName ? ` "${objectName}"` : ""} created`;
  } else if (t === "phase_created") {
    summary = `Phase${objectName ? ` "${objectName}"` : ""} created`;
  } else if (t === "task_created") {
    summary = `Task${objectName ? ` "${objectName}"` : ""} created`;
  } else if (
    t === "project_metadata_updated" ||
    t === "phase_metadata_updated" ||
    t === "task_metadata_updated"
  ) {
    const noun = t.startsWith("project_") ? "Project" : t.startsWith("phase_") ? "Phase" : "Task";
    summary = `${noun}${objectName ? ` "${objectName}"` : ""} updated`;
    appendUpdateDeltas(meta, deltaLines);
  } else if (t === "task_moved") {
    const fromName = resolveName(index, meta.old_phase_id);
    const toName = resolveName(index, meta.new_phase_id);
    summary = `Task${objectName ? ` "${objectName}"` : ""} moved to another phase`;
    if (fromName || toName) {
      deltaLines.push(`Phase: ${fromName ?? "—"} → ${toName ?? "—"}`);
    }
  } else if (t === "task_assignee_changed") {
    const oldName = resolveName(index, meta.old_assignee_id) ?? (meta.old_assignee_id ? "previous assignee" : null);
    const newName = resolveName(index, meta.new_assignee_id) ?? (meta.new_assignee_id ? "new assignee" : null);
    summary = `Task${objectName ? ` "${objectName}"` : ""} assignee changed`;
    deltaLines.push(`Assignee: ${oldName ?? "—"} → ${newName ?? "Unassigned"}`);
  } else if (t === "raci_assignment_added" || t === "raci_assignment_removed") {
    const verb = t === "raci_assignment_added" ? "added" : "removed";
    const role = meta.raci_role ? String(meta.raci_role) : "RACI";
    summary = `RACI assignment ${verb} — ${role.charAt(0).toUpperCase()}${role.slice(1)}${
      objectName ? ` on ${objectTypeLabel} "${objectName}"` : ""
    }`;
  } else if (t === "kpi_definition_created") {
    summary = `KPI definition created${objectName ? `: "${objectName}"` : ""}`;
    if (meta.unit) deltaLines.push(`Unit: ${String(meta.unit)}`);
    if (meta.target_value !== undefined && meta.target_value !== null) {
      deltaLines.push(`Target: ${fmtNum(meta.target_value)}`);
    }
  }

  // Adoption (must be before generic lifecycle so adoption_initiative_archived
  // renders with an adoption-specific summary)
  else if (t.startsWith("adoption_")) {
    if (t === "adoption_template_generated") {
      summary = "Adoption Plan generated from BTPM template";
      if (meta.created_initiative_count !== undefined) {
        deltaLines.push(`Initiatives created: ${fmtNum(meta.created_initiative_count)}`);
      }
      if (meta.created_task_count !== undefined) {
        deltaLines.push(`Tasks created: ${fmtNum(meta.created_task_count)}`);
      }
    } else if (t === "adoption_plan_created") {
      summary = "Adoption Plan created";
      if (meta.readiness_status) deltaLines.push(`Readiness: ${statusToken(meta.readiness_status)}`);
    } else if (t === "adoption_plan_updated") {
      summary = "Adoption Plan updated";
    } else if (t === "adoption_initiative_created") {
      summary = "Adoption initiative created";
      if (meta.readiness_area) deltaLines.push(`Area: ${statusToken(meta.readiness_area)}`);
      if (meta.status) deltaLines.push(`Status: ${statusToken(meta.status)}`);
    } else if (t === "adoption_initiative_updated") {
      summary = "Adoption initiative updated";
    } else if (t === "adoption_initiative_archived") {
      summary = "Adoption initiative archived";
    } else if (t === "adoption_task_linked") {
      summary = "Task linked to Adoption Plan";
      if (meta.linked_to_general_plan === true) {
        deltaLines.push("Linked to general Adoption Plan");
      } else if (meta.new_adoption_initiative_id) {
        deltaLines.push("Initiative linked");
      }
    } else if (t === "adoption_task_unlinked") {
      summary = "Task removed from Adoption Plan";
    } else if (
      t === "adoption_risk_linked" ||
      t === "adoption_blocker_linked" ||
      t === "adoption_kpi_linked" ||
      t === "adoption_risk_unlinked" ||
      t === "adoption_blocker_unlinked" ||
      t === "adoption_kpi_unlinked"
    ) {
      const noun =
        t.includes("_risk_") ? "Risk" : t.includes("_blocker_") ? "Blocker" : "KPI";
      const verb = t.endsWith("_linked") ? "linked to" : "removed from";
      summary = `${noun} ${verb} Adoption Plan`;
      if (meta.object_type) deltaLines.push(`Item: ${statusToken(meta.object_type)}`);
      if (typeof meta.object_id === "string") {
        deltaLines.push(`Linked item id: ${meta.object_id.slice(0, 8)}`);
      }
      if (t.endsWith("_linked")) {
        if (meta.adoption_initiative_id) deltaLines.push("Initiative linked");
        else deltaLines.push("Linked to general Adoption Plan");
      }
    } else {
      summary = `Adoption Plan ${eventType.replace(/^adoption_/, "").replace(/_/g, " ")}`;
    }
  }

  // Lifecycle (archive / unarchive / hard-delete / task reopen)
  else if (t.endsWith("_archived")) {
    summary = `${objectTypeLabel}${objectName ? ` "${objectName}"` : ""} archived`;
  } else if (t.endsWith("_unarchived") || t.endsWith("_restored")) {
    summary = `${objectTypeLabel}${objectName ? ` "${objectName}"` : ""} restored`;
  } else if (t === "task_reopened") {
    summary = `Task${objectName ? ` "${objectName}"` : ""} reopened`;
  } else if (t.startsWith("lifecycle.")) {
    summary = `${objectTypeLabel}${objectName ? ` "${objectName}"` : ""} ${t.replace("lifecycle.", "").replace(/_/g, " ")}`;
  }

  // Fallback
  else {
    summary = `${objectTypeLabel}${objectName ? ` "${objectName}"` : ""} ${eventType.replace(/_/g, " ")}`;
  }

  return { objectTypeLabel, objectName, contextLine, summary, deltaLines };
}

/**
 * UI-only mirror collapse. Two events written back-to-back from the same
 * trigger (one on the entity, one on its anchor) are detected and one is
 * suppressed so users don't see duplicate-looking rows.
 *
 * We never delete data — this is render-time only.
 */
export function dedupeMirroredEvents<
  T extends {
    id: string;
    event_type: string;
    target_type: string;
    target_id: string;
    actor_id: string | null;
    created_at: string;
    metadata: unknown;
  },
>(events: T[]): T[] {
  const MIRROR_TYPES = new Set([
    "blocker_opened",
    "blocker_state_changed",
    "blocker_resolved",
    "blocker_updated",
    "risk_opened",
    "risk_state_changed",
    "risk_updated",
    "kpi_value_recorded",
    "kpi_target_changed",
    "dependency_added",
    "dependency_removed",
    "dependency_type_changed",
  ]);
  const seen = new Map<string, T>();
  const out: T[] = [];
  for (const e of events) {
    if (!MIRROR_TYPES.has(e.event_type)) {
      out.push(e);
      continue;
    }
    const meta = parseMetadata(e.metadata) ?? {};
    const entityId =
      (meta.blocker_id as string | undefined) ??
      (meta.risk_id as string | undefined) ??
      (meta.kpi_definition_id as string | undefined) ??
      (meta.dependency_id as string | undefined) ??
      e.target_id;
    // Bucket by event_type + entityId + actor + 5-second window
    const bucketTime = Math.floor(new Date(e.created_at).getTime() / 5000);
    const key = `${e.event_type}|${entityId}|${e.actor_id ?? ""}|${bucketTime}`;
    const prior = seen.get(key);
    if (!prior) {
      seen.set(key, e);
      out.push(e);
      continue;
    }
    // Prefer the row that targets the entity itself (blocker/risk/kpi_definition)
    // over the anchor mirror, since the entity row is the canonical one.
    const priorIsEntity =
      prior.target_type === "blocker" ||
      prior.target_type === "risk" ||
      prior.target_type === "kpi_definition";
    const currentIsEntity =
      e.target_type === "blocker" ||
      e.target_type === "risk" ||
      e.target_type === "kpi_definition";
    if (currentIsEntity && !priorIsEntity) {
      // Replace prior in `out`
      const idx = out.indexOf(prior);
      if (idx !== -1) out[idx] = e;
      seen.set(key, e);
    }
    // Otherwise drop the duplicate.
  }
  return out;
}

// ---------- Backwards-compat exports (kept for any existing imports) ----------

export function eventVerb(eventType: string): string {
  return eventType.replace(/_/g, " ").replace(/\./g, " · ");
}

export function formatBeforeAfter(metaInput: unknown): string | null {
  const meta = parseMetadata(metaInput);
  if (!meta) return null;
  if ("old_status" in meta && "new_status" in meta) {
    return `${statusToken(meta.old_status)} → ${statusToken(meta.new_status)}`;
  }
  if ("old_dependency_type" in meta && "new_dependency_type" in meta) {
    return `${String(meta.old_dependency_type)} → ${String(meta.new_dependency_type)}`;
  }
  if ("old_target_value" in meta && "new_target_value" in meta) {
    return `target ${fmtNum(meta.old_target_value)} → ${fmtNum(meta.new_target_value)}`;
  }
  if ("value" in meta && "kpi_name" in meta) {
    const unit = meta.unit ? ` ${meta.unit}` : "";
    return `${meta.kpi_name}: ${meta.value}${unit}`;
  }
  if ("title" in meta && typeof meta.title === "string") return meta.title;
  if ("kpi_name" in meta && typeof meta.kpi_name === "string") return meta.kpi_name;
  return null;
}

// ---------- Period-summary grouping ----------

export type SummaryGroup =
  | "completed"
  | "schedule"
  | "governance"
  | "adoption"
  | "risk_kpi"
  | "ownership";

export const SUMMARY_GROUP_ORDER: { value: SummaryGroup; label: string }[] = [
  { value: "completed", label: "Completed / delivered" },
  { value: "schedule", label: "Plan / schedule movement" },
  { value: "governance", label: "Governance / decisions" },
  { value: "adoption", label: "Adoption / readiness" },
  { value: "risk_kpi", label: "Risks / blockers / KPIs" },
  { value: "ownership", label: "Ownership / metadata" },
];

/**
 * Classify an activity_events row into a Period Summary group, or null if it
 * does not belong to any summary lens (it remains visible in the event log).
 * Pure presentation; never persists.
 */
export function classifySummaryGroup(
  eventType: string,
  metadataInput: unknown,
): SummaryGroup | null {
  const t = eventType.toLowerCase();
  const meta = parseMetadata(metadataInput) ?? {};

  // Adoption / readiness (must come before generic risk/blocker/kpi prefix tests)
  if (t.startsWith("adoption_")) return "adoption";

  // Completed / delivered
  if (t === "phase_auto_completed") return "completed";
  if (t === "task_reopened") return null;
  if (t === "status_changed" || t === "project_status_changed") {
    const ns = String(meta.new_status ?? "").toLowerCase();
    if (ns === "completed" || ns === "done" || ns === "closed") return "completed";
    return "schedule";
  }
  if (t === "blocker_resolved") return "completed";
  if (t === "task_actual_dates_updated") {
    if (meta.new_actual_end_date && meta.new_actual_end_date !== meta.old_actual_end_date) {
      return "completed";
    }
    return "schedule";
  }

  // Plan / schedule
  if (
    t === "schedule_changed" ||
    t === "phase_plan_moved" ||
    t === "phase_remaining_work_shifted" ||
    t === "phase_resized" ||
    t === "parent_extended_for_child_edit" ||
    t === "phase_auto_reopened" ||
    t === "task_moved" ||
    t.startsWith("baseline_") ||
    t.startsWith("dependency_")
  ) {
    return "schedule";
  }

  // Governance / decisions
  if (t.startsWith("governance_")) return "governance";

  // Risks / blockers / KPIs
  if (t.startsWith("risk_") || t.startsWith("blocker_") || t.startsWith("kpi_")) {
    return "risk_kpi";
  }

  // Ownership / metadata
  if (
    t === "task_assignee_changed" ||
    t === "raci_assignment_added" ||
    t === "raci_assignment_removed" ||
    t === "project_created" ||
    t === "project_metadata_updated" ||
    t === "phase_created" ||
    t === "phase_metadata_updated" ||
    t === "task_created" ||
    t === "task_metadata_updated" ||
    t.startsWith("stakeholder_")
  ) {
    return "ownership";
  }

  return null;
}
