import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type PortfolioTeamRole =
  | "product_manager"
  | "commercial_lead"
  | "finance_partner"
  | "supply_lead"
  | "regulatory_lead"
  | "quality_lead"
  | "tech_services_lead"
  | "launch_lead"
  | "bd_lead"
  | "srm_lead"
  | "other";

export const PORTFOLIO_TEAM_ROLES: PortfolioTeamRole[] = [
  "product_manager",
  "commercial_lead",
  "finance_partner",
  "supply_lead",
  "regulatory_lead",
  "quality_lead",
  "tech_services_lead",
  "launch_lead",
  "bd_lead",
  "srm_lead",
  "other",
];

export const PORTFOLIO_TEAM_ROLE_LABELS: Record<PortfolioTeamRole, string> = {
  product_manager: "Product Manager",
  commercial_lead: "Commercial Lead",
  finance_partner: "Finance Partner",
  supply_lead: "Supply Lead",
  regulatory_lead: "Regulatory Lead",
  quality_lead: "Quality Lead",
  tech_services_lead: "Tech Services Lead",
  launch_lead: "Launch Lead",
  bd_lead: "BD Lead",
  srm_lead: "SRM Lead",
  other: "Other",
};

export function portfolioTeamRoleLabel(role: string): string {
  return (
    PORTFOLIO_TEAM_ROLE_LABELS[role as PortfolioTeamRole] ??
    role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

export interface AdminPortfolioTeamMember {
  team_member_id: string;
  portfolio_item_id: string;
  organization_id: string;
  user_id: string;
  role: PortfolioTeamRole;
  display_name: string | null;
  email: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export function useAdminPortfolioTeam(portfolioItemId: string | null) {
  return useQuery({
    queryKey: ["admin-portfolio-team", portfolioItemId],
    enabled: !!portfolioItemId,
    queryFn: async (): Promise<AdminPortfolioTeamMember[]> => {
      if (!portfolioItemId) return [];
      const { data, error } = await supabase.rpc(
        "admin_list_portfolio_team_members",
        { _portfolio_item_id: portfolioItemId },
      );
      if (error) throw error;
      return (data as unknown as AdminPortfolioTeamMember[]) ?? [];
    },
  });
}

export function useAdminPortfolioTeamMutations(
  portfolioItemId: string | null,
  organizationId: string | undefined,
) {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin-portfolio-team", portfolioItemId] });
    qc.invalidateQueries({ queryKey: ["admin-portfolio-items", organizationId] });
  };

  const addMember = useMutation({
    mutationFn: async (input: { user_id: string; role: PortfolioTeamRole }) => {
      if (!portfolioItemId) throw new Error("Missing portfolio");
      const { error } = await supabase.rpc("admin_add_portfolio_team_member", {
        _portfolio_item_id: portfolioItemId,
        _user_id: input.user_id,
        _role: input.role,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Team member added");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message || "Failed to add team member"),
  });

  const updateRole = useMutation({
    mutationFn: async (input: { team_member_id: string; role: PortfolioTeamRole }) => {
      const { error } = await supabase.rpc(
        "admin_update_portfolio_team_member_role",
        { _team_member_id: input.team_member_id, _role: input.role },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Role updated");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message || "Failed to update role"),
  });

  const removeMember = useMutation({
    mutationFn: async (team_member_id: string) => {
      const { error } = await supabase.rpc(
        "admin_remove_portfolio_team_member",
        { _team_member_id: team_member_id },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Team member removed");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message || "Failed to remove team member"),
  });

  return { addMember, updateRole, removeMember };
}
