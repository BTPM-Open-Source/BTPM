import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type AssignmentState = "unassigned" | "assigned_to_other" | "assigned_to_current";

export interface PortfolioAssignmentCandidate {
  project_id: string;
  project_name: string;
  workspace_id: string;
  workspace_name: string;
  program_id: string | null;
  program_name: string | null;
  status: string | null;
  priority: string | null;
  project_stage: string | null;
  delivery_model: string | null;
  start_date: string | null;
  target_end_date: string | null;
  is_archived: boolean;
  current_portfolio_item_id: string | null;
  current_portfolio_name: string | null;
  current_portfolio_code: string | null;
  assignment_state: AssignmentState;
}

export interface AssignSummary {
  assigned_count: number;
  reassigned_count: number;
  skipped_count: number;
  affected_project_ids: string[];
}

export interface RemoveSummary {
  removed_count: number;
  skipped_count: number;
  affected_project_ids: string[];
}

export function usePortfolioProjectAssignmentCandidates(params: {
  portfolioItemId: string | null;
  workspaceIds: string[] | null;
  search: string;
  includeArchived: boolean;
  enabled: boolean;
}) {
  const { portfolioItemId, workspaceIds, search, includeArchived, enabled } = params;
  return useQuery({
    queryKey: [
      "admin-portfolio-assignment-candidates",
      portfolioItemId,
      { workspaceIds, search, includeArchived },
    ],
    enabled: enabled && !!portfolioItemId,
    queryFn: async (): Promise<PortfolioAssignmentCandidate[]> => {
      if (!portfolioItemId) return [];
      const { data, error } = await supabase.rpc(
        "admin_list_portfolio_project_assignment_candidates",
        {
          _portfolio_item_id: portfolioItemId,
          _workspace_ids: workspaceIds && workspaceIds.length > 0 ? workspaceIds : null,
          _search: search.trim() || null,
          _include_archived: includeArchived,
        },
      );
      if (error) throw error;
      return (data as unknown as PortfolioAssignmentCandidate[]) ?? [];
    },
  });
}

function invalidatePortfolioCaches(qc: ReturnType<typeof useQueryClient>, portfolioItemId: string) {
  qc.invalidateQueries({ queryKey: ["admin-portfolio-items"] });
  qc.invalidateQueries({ queryKey: ["admin-portfolio-membership", portfolioItemId] });
  qc.invalidateQueries({ queryKey: ["admin-portfolio-assignment-candidates", portfolioItemId] });
  qc.invalidateQueries({ queryKey: ["projects"] });
  qc.invalidateQueries({ queryKey: ["project"] });
}

export function useAssignProjectsToPortfolio(portfolioItemId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (projectIds: string[]): Promise<AssignSummary> => {
      if (!portfolioItemId) throw new Error("Missing Portfolio");
      const { data, error } = await supabase.rpc("admin_assign_projects_to_portfolio", {
        _portfolio_item_id: portfolioItemId,
        _project_ids: projectIds,
      });
      if (error) throw error;
      return data as unknown as AssignSummary;
    },
    onSuccess: (res) => {
      const parts: string[] = [];
      if (res.assigned_count) parts.push(`${res.assigned_count} assigned`);
      if (res.reassigned_count) parts.push(`${res.reassigned_count} reassigned`);
      if (res.skipped_count) parts.push(`${res.skipped_count} skipped`);
      toast.success(parts.length ? parts.join(", ") : "Assignment complete");
      if (portfolioItemId) invalidatePortfolioCaches(qc, portfolioItemId);
    },
    onError: (e: Error) => toast.error(e.message || "Failed to assign projects"),
  });
}

export function useRemoveProjectsFromPortfolio(portfolioItemId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (projectIds: string[]): Promise<RemoveSummary> => {
      if (!portfolioItemId) throw new Error("Missing Portfolio");
      const { data, error } = await supabase.rpc("admin_remove_projects_from_portfolio", {
        _portfolio_item_id: portfolioItemId,
        _project_ids: projectIds,
      });
      if (error) throw error;
      return data as unknown as RemoveSummary;
    },
    onSuccess: (res) => {
      toast.success(`${res.removed_count} project${res.removed_count === 1 ? "" : "s"} removed from Portfolio`);
      if (portfolioItemId) invalidatePortfolioCaches(qc, portfolioItemId);
    },
    onError: (e: Error) => toast.error(e.message || "Failed to remove projects"),
  });
}
