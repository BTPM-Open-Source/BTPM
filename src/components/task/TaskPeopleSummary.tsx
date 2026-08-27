/**
 * TAE-UX.2–4 — Task Detail People panel with three inline searchable
 * controls (no modal): Assignee, Requested by, Executed by.
 *
 * Persistence, containment, former-stakeholder rules, optimistic
 * concurrency, query invalidation, and lifecycle gating are unchanged
 * — this is a UI-only refactor over the canonical hooks:
 *   - Assignee   -> useSetTaskAssignee         (immediate save)
 *   - Requester  -> useSetTaskStakeholderRoles (immediate save, preserves executors)
 *   - Executors  -> useSetTaskStakeholderRoles (Apply, preserves requester)
 *
 *
 * Assignment notification email delivery is NOT a frontend concern: the
 * canonical notification_outbox → process-notifications pipeline owns it
 * for UI, API, and MCP assignments alike. This component only confirms
 * that the assignment mutation succeeded.
 */
import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, Users, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useWorkspaceMembers } from "@/hooks/useWorkspaceMembers";
import { useProjectStakeholders } from "@/hooks/useProjectStakeholders";
import { useSetTaskAssignee } from "@/hooks/useTaskAssignment";
import { useSetTaskStakeholderRoles } from "@/hooks/useTaskStakeholderRoles";
import { useToast } from "@/hooks/use-toast";

interface StakeholderSummary {
  id: string;
  display_name: string;
  stakeholder_type: string | null;
  role_label: string | null;
  is_removed: boolean | null;
}

interface TaskPeopleSummaryProps {
  task: {
    id?: string;
    name?: string | null;
    project_id?: string;
    workspace_id?: string;
    organization_id?: string;
    updated_at?: string;
    status?: string | null;
    is_archived?: boolean | null;
    task_assignments?: { id?: string; assignee_id?: string }[] | null;
    requested_by_stakeholder?: StakeholderSummary | null;
    executed_by_stakeholders?: StakeholderSummary[] | null;
  };
  membersMap: Record<string, string>;
  canEdit?: boolean;
  className?: string;
}

type StakeholderOption = {
  id: string;
  display_name: string;
  stakeholder_type: string | null;
  role_label: string | null;
  is_removed: boolean;
};

function StakeholderChip({
  stakeholder,
  onRemove,
  removable = false,
}: {
  stakeholder: StakeholderSummary;
  onRemove?: () => void;
  removable?: boolean;
}) {
  const isExternal = stakeholder.stakeholder_type === "external";
  const isRemoved = stakeholder.is_removed === true;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border border-border bg-muted/60 px-1.5 py-0.5 text-[11px]",
        isRemoved && "text-muted-foreground line-through",
      )}
    >
      <span className="truncate max-w-[10rem]">{stakeholder.display_name}</span>
      {isExternal && (
        <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5 font-normal">
          Ext
        </Badge>
      )}
      {isRemoved && (
        <Badge variant="secondary" className="text-[9px] px-1 py-0 h-3.5 font-normal">
          Former
        </Badge>
      )}
      {removable && onRemove && (
        <button
          type="button"
          aria-label={`Remove ${stakeholder.display_name}`}
          className="hover:text-destructive"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}

function buildStakeholderOptions(
  active: { id: string; display_name: string; stakeholder_type: string | null; role_label: string | null; removed_at: string | null }[],
  linked: StakeholderSummary[],
): StakeholderOption[] {
  const map = new Map<string, StakeholderOption>();
  for (const s of active) {
    if (!s.removed_at) {
      map.set(s.id, {
        id: s.id,
        display_name: s.display_name,
        stakeholder_type: s.stakeholder_type,
        role_label: s.role_label,
        is_removed: false,
      });
    }
  }
  for (const l of linked) {
    if (!l || !l.id || map.has(l.id)) continue;
    map.set(l.id, {
      id: l.id,
      display_name: l.display_name,
      stakeholder_type: l.stakeholder_type,
      role_label: l.role_label,
      is_removed: l.is_removed === true,
    });
  }
  return Array.from(map.values()).sort((a, b) => {
    if (a.is_removed !== b.is_removed) return a.is_removed ? 1 : -1;
    return a.display_name.localeCompare(b.display_name);
  });
}

// --- Shared list-state helpers ----------------------------------------------

function ListStatus({ message }: { message: string }) {
  return <li className="px-2 py-2 text-xs text-muted-foreground">{message}</li>;
}

// --- Assignee picker --------------------------------------------------------

function InlineAssigneePicker({
  task,
  members,
  isLoading,
  disabled,
}: {
  task: TaskPeopleSummaryProps["task"];
  members: { id: string; display_name: string; email: string | null }[];
  isLoading: boolean;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { toast } = useToast();
  const mutation = useSetTaskAssignee();

  const currentAssigneeId = task.task_assignments?.[0]?.assignee_id ?? null;
  const currentMember = currentAssigneeId
    ? members.find((m) => m.id === currentAssigneeId)
    : null;
  const currentLabel = currentAssigneeId
    ? currentMember?.display_name || currentAssigneeId.slice(0, 8)
    : "Unassigned";

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return members;
    return members.filter(
      (m) =>
        m.display_name.toLowerCase().includes(q) ||
        (m.email ?? "").toLowerCase().includes(q),
    );
  }, [members, query]);

  const commit = async (nextId: string | null) => {
    if (nextId === currentAssigneeId) {
      setOpen(false);
      return;
    }
    try {
      await mutation.mutateAsync({
        taskId: task.id!,
        assigneeId: nextId,
        workspaceId: task.workspace_id,
        organizationId: task.organization_id,
        projectId: task.project_id!,
      });
      toast({ title: "Assignee updated" });
    } catch (e: any) {
      toast({
        title: "Assignee change failed",
        description: e?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setOpen(false);
      setQuery("");
    }
  };

  const hasQuery = query.trim().length > 0;

  return (
    <Popover open={open} onOpenChange={disabled ? undefined : setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || mutation.isPending}
          aria-label="Change assignee"
          className="w-full justify-between h-9 font-normal"
        >
          <span className={cn("truncate", !currentAssigneeId && "text-muted-foreground italic")}>
            {currentLabel}
          </span>
          <ChevronDown className="h-3.5 w-3.5 opacity-60 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-72" align="start">
        <div className="p-2 border-b border-border">
          <Input
            autoFocus
            aria-label="Search members"
            placeholder="Search members by name or email…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-8"
          />
        </div>
        <div className="overflow-y-auto max-h-64">
          <ul role="listbox" aria-label="Assignee options" className="p-1">
            <li>
              <button
                type="button"
                role="option"
                aria-selected={!currentAssigneeId}
                onClick={() => commit(null)}
                className={cn(
                  "w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded text-left text-sm hover:bg-accent",
                  !currentAssigneeId && "bg-accent/60",
                )}
              >
                <span className="italic text-muted-foreground">Unassigned</span>
                {!currentAssigneeId && <Check className="h-3.5 w-3.5" />}
              </button>
            </li>
            {isLoading ? (
              <ListStatus message="Loading members…" />
            ) : members.length === 0 ? (
              <ListStatus message="No workspace members available." />
            ) : filtered.length === 0 ? (
              <ListStatus
                message={hasQuery ? "No members match your search." : "No members available."}
              />
            ) : (
              filtered.map((m) => {
                const selected = m.id === currentAssigneeId;
                return (
                  <li key={m.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => commit(m.id)}
                      className={cn(
                        "w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded text-left text-sm hover:bg-accent",
                        selected && "bg-accent/60",
                      )}
                    >
                      <span className="flex flex-col min-w-0">
                        <span className="truncate">{m.display_name}</span>
                        {m.email && (
                          <span className="truncate text-[11px] text-muted-foreground">
                            {m.email}
                          </span>
                        )}
                      </span>
                      {selected && <Check className="h-3.5 w-3.5 shrink-0" />}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// --- Stakeholder option row (shared by Requester & Executors) ----------------

function StakeholderOptionRow({
  option,
  selected,
  disabled,
  multi,
  onClick,
}: {
  option: StakeholderOption;
  selected: boolean;
  disabled: boolean;
  multi: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded text-left text-sm hover:bg-accent",
        selected && "bg-accent/60",
        disabled && "opacity-60 cursor-not-allowed hover:bg-transparent",
      )}
    >
      <span className="flex items-center gap-2 min-w-0">
        {multi && (
          <span
            aria-hidden
            className={cn(
              "inline-flex h-4 w-4 items-center justify-center border rounded-sm shrink-0",
              selected ? "bg-primary text-primary-foreground border-primary" : "border-input",
            )}
          >
            {selected && <Check className="h-3 w-3" />}
          </span>
        )}
        <span className="flex flex-col min-w-0">
          <span className="flex items-center gap-1.5 min-w-0">
            <span className={cn("truncate", option.is_removed && "line-through text-muted-foreground")}>
              {option.display_name}
            </span>
            {option.stakeholder_type === "external" && (
              <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5 font-normal">External</Badge>
            )}
            {option.is_removed && (
              <Badge variant="secondary" className="text-[9px] px-1 py-0 h-3.5 font-normal">Former</Badge>
            )}
          </span>
          {option.role_label && option.role_label.trim() && (
            <span className="truncate text-[11px] text-muted-foreground">
              {option.role_label.trim()}
            </span>
          )}
        </span>
      </span>
      {!multi && selected && <Check className="h-3.5 w-3.5 shrink-0" />}
    </button>
  );
}

function filterStakeholderOptions(
  options: StakeholderOption[],
  query: string,
): StakeholderOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return options;
  return options.filter(
    (o) =>
      o.display_name.toLowerCase().includes(q) ||
      (o.role_label ?? "").toLowerCase().includes(q),
  );
}

// --- Requester picker -------------------------------------------------------

function InlineRequesterPicker({
  task,
  options,
  isLoading,
  disabled,
}: {
  task: TaskPeopleSummaryProps["task"];
  options: StakeholderOption[];
  isLoading: boolean;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { toast } = useToast();
  const mutation = useSetTaskStakeholderRoles();

  const current = task.requested_by_stakeholder ?? null;
  const executorIds = (task.executed_by_stakeholders ?? []).map((s) => s.id);

  const filtered = useMemo(() => filterStakeholderOptions(options, query), [options, query]);
  const hasQuery = query.trim().length > 0;

  const commit = async (nextId: string | null) => {
    if (nextId === (current?.id ?? null)) {
      setOpen(false);
      return;
    }
    try {
      await mutation.mutateAsync({
        taskId: task.id!,
        projectId: task.project_id!,
        expectedUpdatedAt: task.updated_at!,
        requesterStakeholderId: nextId,
        executorStakeholderIds: executorIds,
      });
      toast({ title: "Requester updated" });
    } catch (e: any) {
      toast({
        title: "Requester change failed",
        description: e?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setOpen(false);
      setQuery("");
    }
  };

  return (
    <Popover open={open} onOpenChange={disabled ? undefined : setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || mutation.isPending}
          aria-label="Change requester"
          className="w-full justify-between h-9 font-normal"
        >
          <span className={cn("truncate flex items-center gap-1.5", !current && "text-muted-foreground italic")}>
            {current ? (
              <>
                <span className={cn("truncate", current.is_removed && "line-through text-muted-foreground")}>
                  {current.display_name}
                </span>
                {current.is_removed && (
                  <Badge variant="secondary" className="text-[9px] px-1 py-0 h-3.5 font-normal">Former</Badge>
                )}
              </>
            ) : (
              "Not set"
            )}
          </span>
          <ChevronDown className="h-3.5 w-3.5 opacity-60 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-72" align="start">
        <div className="p-2 border-b border-border">
          <Input
            autoFocus
            aria-label="Search stakeholders"
            placeholder="Search stakeholders by name or role…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-8"
          />
        </div>
        <div className="overflow-y-auto max-h-64">
          <ul role="listbox" aria-label="Requester options" className="p-1">
            <li>
              <button
                type="button"
                role="option"
                aria-selected={!current}
                onClick={() => commit(null)}
                className={cn(
                  "w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded text-left text-sm hover:bg-accent",
                  !current && "bg-accent/60",
                )}
              >
                <span className="italic text-muted-foreground">Not set</span>
                {!current && <Check className="h-3.5 w-3.5" />}
              </button>
            </li>
            {isLoading ? (
              <ListStatus message="Loading stakeholders…" />
            ) : options.length === 0 ? (
              <ListStatus message="No project stakeholders yet. Add them in the project Stakeholders panel." />
            ) : filtered.length === 0 ? (
              <ListStatus
                message={hasQuery ? "No stakeholders match your search." : "No stakeholders available."}
              />
            ) : (
              filtered.map((o) => {
                const selected = current?.id === o.id;
                // Former stakeholders may not be newly picked. If already
                // selected they can stay (or be cleared via Not set).
                const optDisabled = o.is_removed && !selected;
                return (
                  <li key={o.id}>
                    <StakeholderOptionRow
                      option={o}
                      selected={selected}
                      disabled={optDisabled}
                      multi={false}
                      onClick={() => commit(o.id)}
                    />
                  </li>
                );
              })
            )}
          </ul>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// --- Executors picker (multi-select with Apply/Cancel) ----------------------

function InlineExecutorsPicker({
  task,
  options,
  isLoading,
  disabled,
}: {
  task: TaskPeopleSummaryProps["task"];
  options: StakeholderOption[];
  isLoading: boolean;
  disabled: boolean;
}) {
  const current = task.executed_by_stakeholders ?? [];
  const currentIds = useMemo(() => current.map((s) => s.id), [current]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(currentIds);
  const [query, setQuery] = useState("");
  const { toast } = useToast();
  const mutation = useSetTaskStakeholderRoles();

  // Reset draft each time we open, or when server state changes.
  useEffect(() => {
    if (open) setDraft(currentIds);
  }, [open, currentIds]);

  const filtered = useMemo(() => filterStakeholderOptions(options, query), [options, query]);
  const hasQuery = query.trim().length > 0;

  const selectedCount = draft.length;
  const requesterId = task.requested_by_stakeholder?.id ?? null;

  const toggle = (id: string, isFormer: boolean) => {
    setDraft((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (isFormer) return prev; // may not newly add a former
      return [...prev, id];
    });
  };

  const apply = async () => {
    try {
      await mutation.mutateAsync({
        taskId: task.id!,
        projectId: task.project_id!,
        expectedUpdatedAt: task.updated_at!,
        requesterStakeholderId: requesterId,
        executorStakeholderIds: draft,
      });
      toast({ title: "Executors updated" });
      setOpen(false);
      setQuery("");
    } catch (e: any) {
      toast({
        title: "Executors change failed",
        description: e?.message || "Please try again.",
        variant: "destructive",
      });
    }
  };

  // Trigger content: chips with +N overflow.
  const MAX_CHIPS = 2;
  const shown = current.slice(0, MAX_CHIPS);
  const overflow = current.length - shown.length;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (disabled) return;
        if (mutation.isPending) return;
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || mutation.isPending}
          aria-label="Change executors"
          className="w-full justify-between h-auto min-h-9 py-1.5 font-normal"
        >
          <span className="flex flex-wrap items-center gap-1 min-w-0">
            {current.length === 0 ? (
              <span className="italic text-muted-foreground">Not set</span>
            ) : (
              <>
                {shown.map((s) => (
                  <StakeholderChip key={s.id} stakeholder={s} />
                ))}
                {overflow > 0 && (
                  <span className="text-[11px] text-muted-foreground">+{overflow}</span>
                )}
              </>
            )}
          </span>
          <ChevronDown className="h-3.5 w-3.5 opacity-60 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-80" align="start">
        <div className="p-2 border-b border-border">
          <Input
            autoFocus
            aria-label="Search stakeholders"
            placeholder="Search stakeholders by name or role…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-8"
          />
        </div>
        <div className="flex items-center justify-between px-2 py-1.5 border-b border-border text-[11px]">
          <span className="text-muted-foreground">{selectedCount} selected</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => setDraft([])}
            disabled={selectedCount === 0}
          >
            Clear all
          </Button>
        </div>
        <div className="overflow-y-auto max-h-64">
          <ul role="listbox" aria-label="Executor options" aria-multiselectable className="p-1">
            {isLoading ? (
              <ListStatus message="Loading stakeholders…" />
            ) : options.length === 0 ? (
              <ListStatus message="No project stakeholders yet. Add them in the project Stakeholders panel." />
            ) : filtered.length === 0 ? (
              <ListStatus
                message={hasQuery ? "No stakeholders match your search." : "No stakeholders available."}
              />
            ) : (
              filtered.map((o) => {
                const selected = draft.includes(o.id);
                const optDisabled = o.is_removed && !selected;
                return (
                  <li key={o.id}>
                    <StakeholderOptionRow
                      option={o}
                      selected={selected}
                      disabled={optDisabled}
                      multi
                      onClick={() => toggle(o.id, o.is_removed)}
                    />
                  </li>
                );
              })
            )}
          </ul>
        </div>
        <div className="flex justify-end gap-2 p-2 border-t border-border">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setOpen(false);
              setQuery("");
            }}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={apply} disabled={mutation.isPending}>
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// --- Panel ------------------------------------------------------------------

/**
 * TAE-UX.2–4 — People panel with three inline searchable controls.
 * No modal / no Edit button. Direct save on Assignee and Requester;
 * Executors uses an inline Apply flow.
 */
export function TaskPeopleSummary({
  task,
  membersMap: _membersMap,
  canEdit = false,
  className,
}: TaskPeopleSummaryProps) {
  void _membersMap; // retained for backward-compatible prop signature
  const { data: members = [], isLoading: membersLoading } = useWorkspaceMembers(task?.workspace_id);
  const { data: activeStakeholders = [], isLoading: stakeholdersLoading } = useProjectStakeholders(task?.project_id);

  const isArchived = task?.is_archived === true;
  const isCancelled = task?.status === "cancelled";
  const isCompleted = task?.status === "completed";

  // Assignee is read-only when task is completed/cancelled/archived or no
  // authority; requester/executor allow correction on completed tasks.
  const assigneeReadOnly = !canEdit || isArchived || isCancelled || isCompleted;
  const stakeholderReadOnly = !canEdit || isArchived || isCancelled;

  const requesterLinked = task?.requested_by_stakeholder
    ? [task.requested_by_stakeholder]
    : [];
  const executorsLinked = task?.executed_by_stakeholders ?? [];

  const stakeholderOptions = useMemo(
    () =>
      buildStakeholderOptions(activeStakeholders, [
        ...requesterLinked,
        ...executorsLinked,
      ]),
    [activeStakeholders, requesterLinked, executorsLinked],
  );

  const hasTaskContext =
    typeof task?.id === "string" &&
    typeof task?.project_id === "string" &&
    typeof task?.updated_at === "string";

  return (
    <div
      className={cn(
        "rounded-md border border-border p-3 bg-background text-xs",
        className,
      )}
    >
      <div className="flex items-center gap-1.5 text-muted-foreground mb-2">
        <Users className="h-3.5 w-3.5" />
        <span className="font-medium">People</span>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
            Assignee
          </div>
          {hasTaskContext ? (
            <InlineAssigneePicker
              task={task}
              members={members}
              isLoading={membersLoading}
              disabled={assigneeReadOnly}
            />
          ) : (
            <div className="font-medium text-foreground italic text-muted-foreground">Unassigned</div>
          )}
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
            Requested by
          </div>
          {hasTaskContext ? (
            <InlineRequesterPicker
              task={task}
              options={stakeholderOptions}
              isLoading={stakeholdersLoading}
              disabled={stakeholderReadOnly}
            />
          ) : (
            <span className="text-muted-foreground italic">Not set</span>
          )}
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
            Executed by
          </div>
          {hasTaskContext ? (
            <InlineExecutorsPicker
              task={task}
              options={stakeholderOptions}
              isLoading={stakeholdersLoading}
              disabled={stakeholderReadOnly}
            />
          ) : (
            <span className="text-muted-foreground italic">Not set</span>
          )}
        </div>
      </div>
    </div>
  );
}

export const __test = { buildStakeholderOptions, filterStakeholderOptions };
