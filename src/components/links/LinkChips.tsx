/**
 * Shared chip renderers for the centralized linking module.
 *
 *  - <ObjectLinkChip />   — saved Project/Phase/Task link, navigates on click.
 *  - <DraftObjectChip />  — draft Project/Phase/Task link, removable.
 *  - <PersonChip />       — saved workspace-user link.
 *  - <DraftPersonChip />  — draft workspace-user link, removable.
 *
 * Used by:
 *   - CommentsSection (comment references)
 *   - BlockerFormDialog / RiskFormDialog (related people + related work items)
 *   - ProjectRisksBlockers cards (saved chips)
 */
import { Link } from "react-router-dom";
import { Folder, Layers, CheckSquare, X, User } from "lucide-react";
import type { LinkedObjectType } from "@/lib/entityLinks";

const OBJECT_ICONS: Record<LinkedObjectType, typeof Folder> = {
  project: Folder,
  phase: Layers,
  task: CheckSquare,
};

export interface ObjectChipData {
  referenced_type: LinkedObjectType;
  referenced_id: string;
  workspace_id: string;
  project_id: string | null;
  phase_id?: string | null;
  display_label: string | null;
  context_label?: string | null;
}

function buildHref(d: ObjectChipData): string {
  const ws = d.workspace_id;
  const pid = d.project_id;
  if (d.referenced_type === "project" && pid) return `/workspace/${ws}/project/${pid}`;
  if (d.referenced_type === "phase" && pid)
    return `/workspace/${ws}/project/${pid}/phase/${d.referenced_id}`;
  if (d.referenced_type === "task" && pid)
    return `/workspace/${ws}/project/${pid}/task/${d.referenced_id}`;
  return "#";
}

export function ObjectLinkChip({ data }: { data: ObjectChipData }) {
  const Icon = OBJECT_ICONS[data.referenced_type];
  const label = data.display_label || `${data.referenced_type} ${data.referenced_id.slice(0, 8)}`;
  return (
    <Link
      to={buildHref(data)}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground text-xs hover:bg-accent transition-colors max-w-full"
      title={data.context_label ? `${data.context_label} › ${label}` : label}
    >
      <Icon className="h-3 w-3 shrink-0" />
      <span className="truncate">{label}</span>
    </Link>
  );
}

export function DraftObjectChip({
  data,
  onRemove,
}: {
  data: ObjectChipData;
  onRemove: () => void;
}) {
  const Icon = OBJECT_ICONS[data.referenced_type];
  const label = data.display_label || data.referenced_id.slice(0, 8);
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground text-xs max-w-full"
      title={data.context_label ? `${data.context_label} › ${label}` : label}
    >
      <Icon className="h-3 w-3 shrink-0" />
      <span className="truncate">{label}</span>
      <button
        type="button"
        onClick={onRemove}
        className="ml-0.5 hover:text-destructive"
        aria-label="Remove link"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

export interface PersonChipData {
  user_id?: string | null;
  stakeholder_id?: string | null;
  stakeholder_type?: "workspace_member" | "external" | null;
  display_name: string | null;
}

function fallbackLabel(d: PersonChipData): string {
  const id = d.user_id || d.stakeholder_id || "";
  return id ? id.slice(0, 8) : "Unknown";
}

export function PersonChip({ data }: { data: PersonChipData }) {
  const label = data.display_name || fallbackLabel(data);
  const isExternal = data.stakeholder_type === "external";
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-xs max-w-full"
      title={isExternal ? `${label} (external stakeholder)` : label}
    >
      <User className="h-3 w-3 shrink-0" />
      <span className="truncate">{label}</span>
      {isExternal && <span className="text-[9px] uppercase tracking-wide opacity-70">ext</span>}
    </span>
  );
}

export function DraftPersonChip({
  data,
  onRemove,
}: {
  data: PersonChipData;
  onRemove: () => void;
}) {
  const label = data.display_name || fallbackLabel(data);
  const isExternal = data.stakeholder_type === "external";
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-xs max-w-full"
      title={isExternal ? `${label} (external stakeholder)` : label}
    >
      <User className="h-3 w-3 shrink-0" />
      <span className="truncate">{label}</span>
      {isExternal && <span className="text-[9px] uppercase tracking-wide opacity-70">ext</span>}
      <button
        type="button"
        onClick={onRemove}
        className="ml-0.5 hover:text-destructive"
        aria-label="Remove person"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}
