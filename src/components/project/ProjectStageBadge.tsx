import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { ChevronDown, Layers } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  PROJECT_STAGE_VALUES,
  PROJECT_STAGE_LABELS,
  PROJECT_STAGE_BADGE_CLASS,
  type ProjectStage,
  isProjectStage,
} from "@/lib/projectStage";
import { cn } from "@/lib/utils";

interface Props {
  projectId: string;
  currentStage: string | null | undefined;
  canEdit: boolean;
  /** Visual size — `badge` for inline header, `pill` for larger surfaces. */
  variant?: "badge" | "pill";
}

/**
 * Wave 5 Step 5.7 — Project Stage selector.
 *
 * Visually distinct from Status (uses Layers icon + stage palette).
 * Calls the SECURITY DEFINER `transition_project_stage` RPC.
 * Authority is server-enforced; UI hides the dropdown for non-PM+.
 */
export function ProjectStageBadge({ projectId, currentStage, canEdit, variant = "badge" }: Props) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();
  const stage: ProjectStage = isProjectStage(currentStage) ? currentStage : "planning";

  const mut = useMutation({
    mutationFn: async (next: ProjectStage) => {
      const { data, error } = await supabase.rpc("transition_project_stage", {
        _project_id: projectId,
        _project_stage: next,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, next) => {
      toast({
        title: "Project stage updated",
        description: `Stage set to ${PROJECT_STAGE_LABELS[next]}.`,
      });
      qc.invalidateQueries({ queryKey: ["project", projectId] });
      qc.invalidateQueries({ queryKey: ["roadmap-projects"] });
      qc.invalidateQueries({ queryKey: ["workspace-projects"] });
    },
    onError: (e: any) => {
      toast({
        title: "Could not update stage",
        description: e?.message ?? "Unknown error",
        variant: "destructive",
      });
    },
  });

  const badge = (
    <Badge
      className={cn(
        "gap-1",
        PROJECT_STAGE_BADGE_CLASS[stage],
        variant === "pill" ? "text-sm px-3 py-1" : "",
      )}
    >
      <Layers className="h-3 w-3" />
      Stage: {PROJECT_STAGE_LABELS[stage]}
    </Badge>
  );

  if (!canEdit) return badge;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-auto p-0 hover:bg-transparent"
          disabled={mut.isPending}
        >
          <span className="inline-flex items-center gap-1">
            {badge}
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {PROJECT_STAGE_VALUES.map((s) => (
          <DropdownMenuItem
            key={s}
            disabled={s === stage || mut.isPending}
            onClick={() => mut.mutate(s)}
          >
            {PROJECT_STAGE_LABELS[s]}
            {s === stage && <span className="ml-2 text-xs text-muted-foreground">(current)</span>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
