import { Link } from "react-router-dom";
import { Folder, Layers, CheckSquare, X } from "lucide-react";
import type { CommentReferenceTargetType } from "@/hooks/useExecutionData";

interface ChipData {
  referenced_type: CommentReferenceTargetType;
  referenced_id: string;
  workspace_id: string;
  project_id: string | null;
  phase_id?: string | null;
  display_label: string | null;
  context_label?: string | null;
}

const ICONS: Record<CommentReferenceTargetType, typeof Folder> = {
  project: Folder,
  phase: Layers,
  task: CheckSquare,
};

function buildHref(d: ChipData): string {
  const ws = d.workspace_id;
  const pid = d.project_id;
  if (d.referenced_type === "project" && pid) return `/workspace/${ws}/project/${pid}`;
  if (d.referenced_type === "phase" && pid) return `/workspace/${ws}/project/${pid}/phase/${d.referenced_id}`;
  if (d.referenced_type === "task" && pid) return `/workspace/${ws}/project/${pid}/task/${d.referenced_id}`;
  return "#";
}

export function CommentReferenceChip({ data }: { data: ChipData }) {
  const Icon = ICONS[data.referenced_type];
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

export function DraftReferenceChip({
  data,
  onRemove,
}: {
  data: ChipData;
  onRemove: () => void;
}) {
  const Icon = ICONS[data.referenced_type];
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
        aria-label="Remove reference"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}
