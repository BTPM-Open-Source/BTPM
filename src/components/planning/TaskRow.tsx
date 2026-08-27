import { Link, useParams } from "react-router-dom";
import type { Tables } from "@/integrations/supabase/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowRight, ArrowUp, ArrowDown, Link as LinkIcon, Sparkles, Copy, PlusCircle } from "lucide-react";
import { computeVariance, formatVarianceDays, varianceTone, varianceLabel } from "@/lib/baselineUtils";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { CloneTaskDialog } from "./CloneTaskDialog";
import { AdoptionLinkBadge } from "@/components/adoption/AdoptionLinkBadge";
import type { AdoptionLinkBadge as AdoptionLinkBadgeData } from "@/hooks/useProjectAdoptionLinkBadges";
import {
  TaskAccountabilityInline,
  type AccountabilityStakeholder,
} from "./TaskAccountabilityInline";

import {
  getPmPriorityBadgeClass,
  getPmPriorityLabel,
  getPmWorkflowStatusBadgeClass,
  getPmWorkflowStatusLabel,
} from "@/lib/btpmVisualSemantics";

interface TaskRowProps {
  task: Tables<"tasks"> & {
    task_assignments?: any[];
    requested_by_stakeholder?: AccountabilityStakeholder | null;
    executed_by_stakeholders?: AccountabilityStakeholder[] | null;
  };
  dependencies: Tables<"dependencies">[];
  allTasks: (Tables<"tasks"> & { task_assignments?: any[] })[];
  membersMap: Record<string, string>;
  isFirst: boolean;
  isLast: boolean;
  canEdit: boolean;
  isProjectBaselined?: boolean;
  adoptionBadge?: AdoptionLinkBadgeData | null;
  /** Find-in-project highlight flag (frontend-only). */
  isFindMatch?: boolean;
  onMove: (direction: "up" | "down") => void;
  onAddBelow?: () => void;
}

export function TaskRow({ task, dependencies, allTasks, membersMap, isFirst, isLast, canEdit, isProjectBaselined, adoptionBadge, isFindMatch, onMove, onAddBelow }: TaskRowProps) {
  const { workspaceId, projectId } = useParams<{ workspaceId: string; projectId: string }>();
  const [showClone, setShowClone] = useState(false);
  const taskDeps = dependencies.filter(
    (d) => d.source_id === task.id || d.target_id === task.id
  );

  const assigneeId = task.task_assignments?.[0]?.assignee_id || null;
  const assigneeName = assigneeId ? (membersMap[assigneeId] || assigneeId.slice(0, 8)) : null;
  const detailPath = `/workspace/${workspaceId}/project/${projectId}/task/${task.id}`;

  return (
    <div
      data-find-task-id={task.id}
      className={cn(
        "flex items-center gap-2 py-1.5 px-2 pl-8 rounded hover:bg-accent/50 transition-colors group",
        isFindMatch && "bg-accent/60 ring-1 ring-ring/30"
      )}
    >
      <Link to={detailPath} className="flex-1 text-sm text-foreground truncate hover:underline">{task.name}</Link>

      <Badge variant="outline" className="text-xs capitalize">{task.task_type.replace("_", " ")}</Badge>
      <Badge className={`text-xs ${getPmWorkflowStatusBadgeClass(task.status)}`}>{getPmWorkflowStatusLabel(task.status)}</Badge>
      <Badge className={`text-xs ${getPmPriorityBadgeClass(task.priority)}`}>{getPmPriorityLabel(task.priority)}</Badge>

      {adoptionBadge && <AdoptionLinkBadge badge={adoptionBadge} />}

      {assigneeName && (
        <span className="text-xs text-muted-foreground max-w-[100px] truncate">{assigneeName}</span>
      )}

      <TaskAccountabilityInline
        requester={task.requested_by_stakeholder}
        executors={task.executed_by_stakeholders}
      />

      {task.start_date && <span className="text-xs text-muted-foreground">{task.start_date}</span>}
      {task.due_date && <span className="text-xs text-muted-foreground">→ {task.due_date}</span>}

      {isProjectBaselined && (task as any).added_after_baseline && (
        <Badge variant="outline" className="text-[10px] uppercase tracking-wide gap-1" title="Added after baseline approval">
          <Sparkles className="h-3 w-3" /> new
        </Badge>
      )}
      {isProjectBaselined && !(task as any).added_after_baseline && (() => {
        const v = computeVariance(task.start_date, task.due_date,
          (task as any).baseline_start_date, (task as any).baseline_end_date).endDays;
        if (v === null) return null;
        return (
          <Badge variant="outline" className={cn("text-xs font-mono", varianceTone(v))} title={`End vs baseline: ${varianceLabel(v)}`}>
            {formatVarianceDays(v)}
          </Badge>
        );
      })()}

      {taskDeps.length > 0 && (
        <Badge variant="outline" className="text-xs">
          <LinkIcon className="h-3 w-3 mr-0.5" />
          {taskDeps.length}
        </Badge>
      )}

      <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        {canEdit && !isFirst && (
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onMove("up")}>
            <ArrowUp className="h-3 w-3" />
          </Button>
        )}
        {canEdit && !isLast && (
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onMove("down")}>
            <ArrowDown className="h-3 w-3" />
          </Button>
        )}
        {canEdit && onAddBelow && (
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onAddBelow} title="Create task below">
            <PlusCircle className="h-3 w-3" />
          </Button>
        )}
        {canEdit && (
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setShowClone(true)} title="Copy task">
            <Copy className="h-3 w-3" />
          </Button>
        )}
        <Button variant="ghost" size="icon" className="h-6 w-6" asChild title="Open task">
          <Link to={detailPath}><ArrowRight className="h-3 w-3" /></Link>
        </Button>
      </div>
      {showClone && (
        <CloneTaskDialog
          open={showClone}
          onClose={() => setShowClone(false)}
          taskId={task.id}
          sourceTaskName={task.name}
          projectId={task.project_id}
        />
      )}
    </div>
  );
}
