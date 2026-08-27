/**
 * Hierarchical reference picker for Discussion comments.
 *
 * Two modes (driven by the typed query after `#`):
 *  - Browse: query is empty -> show Projects, lazy-load Phases on expand,
 *    lazy-load Tasks on expand. Selection allowed at every level.
 *  - Search: query is non-empty -> call protected `search_workspace_reference_targets`
 *    and group flat results into the same Project › Phase › Task tree, with
 *    matching branches auto-expanded.
 *
 * Same-workspace boundary is enforced server-side inside the underlying RPCs.
 * No plaintext names are stored — all labels come from decrypted RPC reads.
 */
import { useMemo, useState } from "react";
import { ChevronRight, ChevronDown, Folder, Layers, CheckSquare, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useReferenceTargetSearch,
  type ReferenceTargetSearchResult,
} from "@/hooks/useExecutionData";
import {
  useBrowseReferenceProjects,
  useBrowseProjectPhases,
  useBrowsePhaseTasks,
  type ReferenceProjectNode,
  type ReferencePhaseNode,
  type ReferenceTaskNode,
} from "@/hooks/useReferenceBrowse";

export type PickerSelection = ReferenceTargetSearchResult;

export interface ReferencePickerProps {
  workspaceId: string;
  query: string;
  onSelect: (sel: PickerSelection) => void;
  onClose: () => void;
  /** Render above the textarea (composer) vs below (edit). Ignored when `embedded`. */
  placement?: "above" | "below";
  /**
   * When true the picker renders inline (no absolute positioning, no popover
   * shadow) so it can be embedded inside an outer Popover/Dialog.
   */
  embedded?: boolean;
}

export function ReferencePicker({
  workspaceId,
  query,
  onSelect,
  placement = "above",
  embedded = false,
}: ReferencePickerProps) {
  const trimmed = query.trim();
  const isSearch = trimmed.length > 0;

  const containerClass = embedded
    ? "h-full overflow-y-auto text-sm bg-transparent"
    : cn(
        placement === "above"
          ? "absolute bottom-full mb-1 left-0 right-0 z-20"
          : "absolute top-full mt-1 left-0 right-0 z-20",
        "bg-popover border border-border rounded-md shadow-md max-h-72 overflow-y-auto text-sm",
      );

  return (
    <div className={containerClass} onMouseDown={(e) => e.preventDefault()}>
      {isSearch ? (
        <SearchTree workspaceId={workspaceId} query={trimmed} onSelect={onSelect} />
      ) : (
        <BrowseTree workspaceId={workspaceId} onSelect={onSelect} />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- Browse mode */

function BrowseTree({
  workspaceId,
  onSelect,
}: {
  workspaceId: string;
  onSelect: (sel: PickerSelection) => void;
}) {
  const { data: projects = [], isLoading } = useBrowseReferenceProjects(workspaceId, true);
  const [openProjects, setOpenProjects] = useState<Record<string, boolean>>({});

  if (isLoading) return <RowLoading label="Loading projects…" />;
  if (projects.length === 0)
    return <RowEmpty label="No projects in this workspace yet." />;

  return (
    <div className="py-1">
      <Header label="Browse — pick a Project, Phase, or Task" />
      {projects.map((p) => (
        <ProjectBranch
          key={p.id}
          project={p}
          isOpen={!!openProjects[p.id]}
          onToggle={() => setOpenProjects((s) => ({ ...s, [p.id]: !s[p.id] }))}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function ProjectBranch({
  project,
  isOpen,
  onToggle,
  onSelect,
}: {
  project: ReferenceProjectNode;
  isOpen: boolean;
  onToggle: () => void;
  onSelect: (sel: PickerSelection) => void;
}) {
  const { data: phases = [], isLoading } = useBrowseProjectPhases(
    project.id,
    project.workspace_id,
    isOpen,
  );

  return (
    <div>
      <NodeRow
        depth={0}
        icon={<Folder className="h-3.5 w-3.5" />}
        chevron={<ChevronButton open={isOpen} onClick={onToggle} />}
        type="Project"
        label={project.name}
        onSelect={() =>
          onSelect({
            target_type: "project",
            target_id: project.id,
            workspace_id: project.workspace_id,
            project_id: project.id,
            phase_id: null,
            display_label: project.name,
            context_label: null,
          })
        }
      />
      {isOpen && isLoading && <RowLoading label="Loading phases…" depth={1} />}
      {isOpen &&
        !isLoading &&
        phases.map((ph) => (
          <PhaseBranch key={ph.id} phase={ph} project={project} onSelect={onSelect} />
        ))}
      {isOpen && !isLoading && phases.length === 0 && (
        <RowEmpty label="No phases in this project." depth={1} />
      )}
    </div>
  );
}

function PhaseBranch({
  phase,
  project,
  onSelect,
}: {
  phase: ReferencePhaseNode;
  project: ReferenceProjectNode;
  onSelect: (sel: PickerSelection) => void;
}) {
  const [open, setOpen] = useState(false);
  const { data: tasks = [], isLoading } = useBrowsePhaseTasks(
    phase.project_id,
    phase.id,
    phase.workspace_id,
    open,
  );

  return (
    <div>
      <NodeRow
        depth={1}
        icon={<Layers className="h-3.5 w-3.5" />}
        chevron={<ChevronButton open={open} onClick={() => setOpen((v) => !v)} />}
        type="Phase"
        label={phase.name}
        contextLabel={project.name}
        onSelect={() =>
          onSelect({
            target_type: "phase",
            target_id: phase.id,
            workspace_id: phase.workspace_id,
            project_id: phase.project_id,
            phase_id: phase.id,
            display_label: phase.name,
            context_label: project.name,
          })
        }
      />
      {open && isLoading && <RowLoading label="Loading tasks…" depth={2} />}
      {open &&
        !isLoading &&
        tasks.map((t) => (
          <TaskRowItem key={t.id} task={t} project={project} phase={phase} onSelect={onSelect} />
        ))}
      {open && !isLoading && tasks.length === 0 && (
        <RowEmpty label="No tasks in this phase." depth={2} />
      )}
    </div>
  );
}

function TaskRowItem({
  task,
  project,
  phase,
  onSelect,
}: {
  task: ReferenceTaskNode;
  project: ReferenceProjectNode;
  phase: ReferencePhaseNode;
  onSelect: (sel: PickerSelection) => void;
}) {
  const ctx = `${project.name} › ${phase.name}`;
  return (
    <NodeRow
      depth={2}
      icon={<CheckSquare className="h-3.5 w-3.5" />}
      type="Task"
      label={task.name}
      contextLabel={ctx}
      onSelect={() =>
        onSelect({
          target_type: "task",
          target_id: task.id,
          workspace_id: task.workspace_id,
          project_id: task.project_id,
          phase_id: task.phase_id,
          display_label: task.name,
          context_label: ctx,
        })
      }
    />
  );
}

/* ---------------------------------------------------------------- Search mode */

type SearchPhaseGroup = {
  phase_id: string;
  phase_label: string;
  phase_match?: ReferenceTargetSearchResult;
  tasks: ReferenceTargetSearchResult[];
};

type SearchProjectGroup = {
  project_id: string;
  project_label: string;
  project_match?: ReferenceTargetSearchResult;
  phases: Map<string, SearchPhaseGroup>;
  orphanTasks: ReferenceTargetSearchResult[];
};

function SearchTree({
  workspaceId,
  query,
  onSelect,
}: {
  workspaceId: string;
  query: string;
  onSelect: (sel: PickerSelection) => void;
}) {
  const { data: results = [], isLoading } = useReferenceTargetSearch(workspaceId, query, true);

  const groups = useMemo(() => groupSearchResults(results), [results]);

  if (isLoading) return <RowLoading label="Searching…" />;
  if (groups.length === 0)
    return <RowEmpty label={`No matches for "${query}" in this workspace.`} />;

  return (
    <div className="py-1">
      <Header label={`Matches for "${query}"`} />
      {groups.map((g) => (
        <SearchProjectBranch key={g.project_id} group={g} query={query} onSelect={onSelect} />
      ))}
    </div>
  );
}

function SearchProjectBranch({
  group,
  query,
  onSelect,
}: {
  group: SearchProjectGroup;
  query: string;
  onSelect: (sel: PickerSelection) => void;
}) {
  return (
    <div>
      <NodeRow
        depth={0}
        icon={<Folder className="h-3.5 w-3.5" />}
        chevron={<ChevronButton open onClick={() => {}} />}
        type="Project"
        label={group.project_label}
        highlight={query}
        muted={!group.project_match}
        onSelect={
          group.project_match
            ? () => onSelect(group.project_match!)
            : undefined
        }
      />
      {Array.from(group.phases.values()).map((ph) => (
        <div key={ph.phase_id}>
          <NodeRow
            depth={1}
            icon={<Layers className="h-3.5 w-3.5" />}
            chevron={<ChevronButton open onClick={() => {}} />}
            type="Phase"
            label={ph.phase_label}
            contextLabel={group.project_label}
            highlight={query}
            muted={!ph.phase_match}
            onSelect={ph.phase_match ? () => onSelect(ph.phase_match!) : undefined}
          />
          {ph.tasks.map((t) => (
            <NodeRow
              key={t.target_id}
              depth={2}
              icon={<CheckSquare className="h-3.5 w-3.5" />}
              type="Task"
              label={t.display_label}
              contextLabel={`${group.project_label} › ${ph.phase_label}`}
              highlight={query}
              onSelect={() => onSelect(t)}
            />
          ))}
        </div>
      ))}
      {group.orphanTasks.map((t) => (
        <NodeRow
          key={t.target_id}
          depth={1}
          icon={<CheckSquare className="h-3.5 w-3.5" />}
          type="Task"
          label={t.display_label}
          contextLabel={group.project_label}
          highlight={query}
          onSelect={() => onSelect(t)}
        />
      ))}
    </div>
  );
}

function groupSearchResults(rows: ReferenceTargetSearchResult[]): SearchProjectGroup[] {
  const byProject = new Map<string, SearchProjectGroup>();

  const ensureProject = (
    projectId: string,
    fallbackLabel: string,
  ): SearchProjectGroup => {
    const existing = byProject.get(projectId);
    if (existing) return existing;
    const created: SearchProjectGroup = {
      project_id: projectId,
      project_label: fallbackLabel,
      phases: new Map(),
      orphanTasks: [],
    };
    byProject.set(projectId, created);
    return created;
  };

  for (const r of rows) {
    if (r.target_type === "project") {
      const g = ensureProject(r.target_id, r.display_label);
      g.project_label = r.display_label;
      g.project_match = r;
    }
  }

  for (const r of rows) {
    if (r.target_type === "phase" && r.project_id) {
      const projectLabel = r.context_label || "Project";
      const g = ensureProject(r.project_id, projectLabel);
      if (!g.project_match) g.project_label = projectLabel;
      g.phases.set(r.target_id, {
        phase_id: r.target_id,
        phase_label: r.display_label,
        phase_match: r,
        tasks: [],
      });
    }
  }

  for (const r of rows) {
    if (r.target_type === "task" && r.project_id) {
      const parts = (r.context_label || "").split("›").map((s) => s.trim()).filter(Boolean);
      const projectLabel = parts[0] || "Project";
      const phaseLabel = parts[1];
      const g = ensureProject(r.project_id, projectLabel);
      if (!g.project_match && parts[0]) g.project_label = parts[0];
      if (r.phase_id && phaseLabel) {
        const ph = g.phases.get(r.phase_id) ?? {
          phase_id: r.phase_id,
          phase_label: phaseLabel,
          tasks: [],
        };
        ph.tasks.push(r);
        g.phases.set(r.phase_id, ph);
      } else {
        g.orphanTasks.push(r);
      }
    }
  }

  return Array.from(byProject.values());
}

/* ---------------------------------------------------------------- Shared rows */

function NodeRow({
  depth,
  icon,
  chevron,
  type,
  label,
  contextLabel,
  highlight,
  onSelect,
  muted,
}: {
  depth: 0 | 1 | 2;
  icon: React.ReactNode;
  chevron?: React.ReactNode;
  type: "Project" | "Phase" | "Task";
  label: string;
  contextLabel?: string;
  highlight?: string;
  onSelect?: () => void;
  muted?: boolean;
}) {
  const padLeft = depth === 0 ? "pl-2" : depth === 1 ? "pl-6" : "pl-10";
  const Wrapper: React.ElementType = onSelect ? "button" : "div";
  return (
    <Wrapper
      type={onSelect ? "button" : undefined}
      onMouseDown={onSelect ? (e: React.MouseEvent) => { e.preventDefault(); onSelect(); } : undefined}
      className={cn(
        "w-full text-left flex items-center gap-1.5 pr-2 py-1 hover:bg-accent",
        padLeft,
        !onSelect && "cursor-default opacity-80",
      )}
    >
      <span className="w-4 flex justify-center text-muted-foreground">{chevron}</span>
      <span className="text-muted-foreground">{icon}</span>
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground w-12 shrink-0">{type}</span>
      <span className={cn("truncate", muted && "text-muted-foreground")}>
        {highlight ? <Highlight text={label} query={highlight} /> : label}
      </span>
      {contextLabel && depth > 0 && (
        <span className="ml-auto pl-2 text-[11px] text-muted-foreground truncate max-w-[40%]">
          {contextLabel}
        </span>
      )}
    </Wrapper>
  );
}

function ChevronButton({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <span
      role="button"
      tabIndex={-1}
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      className="inline-flex items-center justify-center h-4 w-4 hover:text-foreground"
    >
      {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
    </span>
  );
}

function Header({ label }: { label: string }) {
  return (
    <div className="px-3 py-1 text-[11px] uppercase tracking-wide text-muted-foreground">
      {label}
    </div>
  );
}

function RowLoading({ label, depth = 0 }: { label: string; depth?: 0 | 1 | 2 }) {
  const padLeft = depth === 0 ? "pl-3" : depth === 1 ? "pl-8" : "pl-12";
  return (
    <div className={cn("flex items-center gap-2 py-2 text-xs text-muted-foreground", padLeft)}>
      <Loader2 className="h-3 w-3 animate-spin" />
      {label}
    </div>
  );
}

function RowEmpty({ label, depth = 0 }: { label: string; depth?: 0 | 1 | 2 }) {
  const padLeft = depth === 0 ? "pl-3" : depth === 1 ? "pl-8" : "pl-12";
  return <div className={cn("py-2 text-xs text-muted-foreground italic", padLeft)}>{label}</div>;
}

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-primary/20 text-foreground rounded px-0.5">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}


