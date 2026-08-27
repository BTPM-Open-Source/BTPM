/**
 * Wave 5 Step 5.9 — Lifecycle vocabulary (UX-only).
 *
 * Single source of truth for the lifecycle labels, badge classes, and
 * destructive/consequence copy used across the app. This keeps wording
 * consistent across every surface and prevents the per-page drift the
 * Step 5.9 rollout is meant to fix.
 *
 * Object-class semantics (frozen in Wave 5):
 *
 *   - boundary objects   → Active / Inactive          (e.g. Workspace, User)
 *   - business / config  → Active / Archived          (Program, Project,
 *                                                       Phase, Task, Template,
 *                                                       Backlog item, Sprint,
 *                                                       Workflow state, KPI)
 *   - relation objects   → Remove                     (memberships, assignments)
 *   - hard delete        → Permanent Delete           (admin-only, archived-first)
 *
 * UX rules:
 *   - Workspace must NOT use Archive / Permanent Delete vocabulary.
 *   - Business objects must NEVER be presented as "Inactive".
 *   - Permanent Delete is always destructive copy and always archived-first
 *     for business/config objects.
 */

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ReactElement } from "react";

/* ────────────────────────────────────────────────────────────────────────── */
/* Boundary lifecycle (workspaces, users)                                     */
/* ────────────────────────────────────────────────────────────────────────── */

export const BOUNDARY_LIFECYCLE_LABELS = {
  active: "Active",
  inactive: "Inactive",
  activate: "Reactivate",
  deactivate: "Deactivate",
} as const;

/**
 * Renders the canonical Active / Inactive badge for a boundary object.
 * Workspaces and Users use this — never `bg-destructive` for "inactive",
 * because inactive is not a destructive state, it's a boundary state.
 */
export function boundaryStateBadgeClass(isActive: boolean): string {
  return isActive
    ? "bg-primary/10 text-primary"
    : "bg-muted text-muted-foreground border border-border";
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Business / config-object lifecycle                                         */
/* ────────────────────────────────────────────────────────────────────────── */

export const BUSINESS_LIFECYCLE_LABELS = {
  active: "Active",
  archived: "Archived",
  archive: "Archive",
  unarchive: "Restore",
  hardDelete: "Permanent Delete",
} as const;

export function businessStateBadgeClass(isArchived: boolean): string {
  return isArchived
    ? "bg-muted text-muted-foreground border border-border"
    : "bg-primary/10 text-primary";
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Relation lifecycle (memberships, assignments)                              */
/* ────────────────────────────────────────────────────────────────────────── */

export const RELATION_LIFECYCLE_LABELS = {
  remove: "Remove",
} as const;

/* ────────────────────────────────────────────────────────────────────────── */
/* Destructive / consequence copy                                             */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Standardized "what permanent delete means" copy for business-object
 * confirmations. Each object class gets a short, accurate cascade
 * description; surfaces should pass these into HardDeleteConfirmDialog.
 */
export const HARD_DELETE_CASCADE_COPY: Record<string, string> = {
  program:
    "This will permanently delete the program and unlink any projects from it. Project records themselves are not deleted.",
  project:
    "This will permanently delete the project and all of its phases, tasks, dependencies, attachments, KPIs, sprints, backlog items, and related metadata. Files attached anywhere in this project will be removed from storage.",
  phase:
    "This will permanently delete the phase and all of its tasks, dependencies, and attachments. Files attached to this phase or its tasks will be removed from storage.",
  task: "This will permanently delete the task and all of its dependencies and attachments. Files attached to this task will be removed from storage.",
  project_template:
    "This will permanently delete the template. Projects already cloned from it are not affected.",
  backlog_item:
    "This will permanently delete the backlog item. Linked tasks are not deleted but lose their backlog reference.",
  sprint:
    "This will permanently delete the sprint. Backlog items currently in this sprint will be moved back to the backlog.",
  kpi_definition:
    "This will permanently delete the KPI definition and all of its recorded updates.",
  board_workflow_state:
    "This will permanently delete the workflow state. Items currently in this state must be moved first.",
};

export const ARCHIVE_CONSEQUENCE_COPY =
  "Archiving hides this from active views and prevents new edits, but preserves all data and history. You can restore it at any time.";

export const RESTORE_CONSEQUENCE_COPY =
  "Restoring brings this back into active views. All previous data and history are preserved.";

/* ────────────────────────────────────────────────────────────────────────── */
/* Boundary copy (workspace)                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

export const WORKSPACE_DEACTIVATE_COPY =
  "Deactivating a workspace makes it read-only across the app. All projects, members, and history are preserved. You can reactivate it at any time. Workspaces are never permanently deleted from this UI.";

export const WORKSPACE_REACTIVATE_COPY =
  "Reactivating restores full read/write access to this workspace and all of its projects.";

export const WORKSPACE_INACTIVE_BANNER_COPY =
  "This workspace is currently Inactive. It is read-only — projects, phases, and tasks cannot be edited until an Org Admin reactivates the workspace.";

/* ────────────────────────────────────────────────────────────────────────── */
/* Render helpers                                                             */
/* ────────────────────────────────────────────────────────────────────────── */

export interface LifecycleBadgeProps {
  /** Object class — controls vocabulary. */
  kind: "boundary" | "business";
  /** For boundary objects. */
  isActive?: boolean;
  /** For business objects. */
  isArchived?: boolean;
  className?: string;
}

export function LifecycleBadge({
  kind,
  isActive,
  isArchived,
  className,
}: LifecycleBadgeProps): ReactElement {
  if (kind === "boundary") {
    const active = isActive !== false;
    return (
      <Badge
        className={cn(boundaryStateBadgeClass(active), className)}
        variant="outline"
      >
        {active
          ? BOUNDARY_LIFECYCLE_LABELS.active
          : BOUNDARY_LIFECYCLE_LABELS.inactive}
      </Badge>
    );
  }
  // business
  const archived = !!isArchived;
  return (
    <Badge
      className={cn(businessStateBadgeClass(archived), className)}
      variant="outline"
    >
      {archived
        ? BUSINESS_LIFECYCLE_LABELS.archived
        : BUSINESS_LIFECYCLE_LABELS.active}
    </Badge>
  );
}
