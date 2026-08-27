import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface PortfolioPickerItem {
  id: string;
  name: string;
  code: string | null;
  lifecycle_state: string;
  owner_id: string | null;
}

export function useWorkspacePortfolioPicker(
  workspaceId: string | undefined,
  enabled: boolean = true,
) {
  return useQuery({
    queryKey: ["portfolio-picker", "workspace", workspaceId],
    enabled: !!workspaceId && enabled !== false,
    queryFn: async (): Promise<PortfolioPickerItem[]> => {
      if (!workspaceId) return [];
      const { data, error } = await supabase.rpc(
        "list_active_portfolio_items_for_workspace_picker",
        { _workspace_id: workspaceId },
      );
      if (error) throw error;
      return (data as unknown as PortfolioPickerItem[]) ?? [];
    },
  });
}

export function useProjectPortfolioPicker(
  projectId: string | undefined,
  enabled: boolean = true,
) {
  return useQuery({
    queryKey: ["portfolio-picker", "project", projectId],
    enabled: !!projectId && enabled !== false,
    queryFn: async (): Promise<PortfolioPickerItem[]> => {
      if (!projectId) return [];
      const { data, error } = await supabase.rpc(
        "list_active_portfolio_items_for_project_picker",
        { _project_id: projectId },
      );
      if (error) throw error;
      return (data as unknown as PortfolioPickerItem[]) ?? [];
    },
  });
}

export interface AssignProjectPortfolioInput {
  projectId: string;
  portfolioItemId: string | null;
}

export function useAssignProjectPortfolio(options?: {
  projectId?: string;
  workspaceId?: string;
  organizationId?: string;
}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: AssignProjectPortfolioInput) => {
      const { error } = await supabase.rpc("assign_project_portfolio", {
        _project_id: input.projectId,
        _portfolio_item_id: input.portfolioItemId ?? undefined,
      } as any);
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      const pid = options?.projectId ?? variables.projectId;
      qc.invalidateQueries({ queryKey: ["project", pid] });
      if (options?.workspaceId) {
        qc.invalidateQueries({ queryKey: ["workspace-projects", options.workspaceId] });
      } else {
        qc.invalidateQueries({ queryKey: ["workspace-projects"] });
      }
      if (options?.organizationId) {
        qc.invalidateQueries({ queryKey: ["admin-portfolio-items", options.organizationId] });
      } else {
        qc.invalidateQueries({ queryKey: ["admin-portfolio-items"] });
      }
      qc.invalidateQueries({ queryKey: ["admin-portfolio-membership"] });
      qc.invalidateQueries({ queryKey: ["portfolio-picker"] });
    },
    onError: (e: Error) => {
      toast.error(e.message || "Failed to assign Portfolio");
    },
  });
}
