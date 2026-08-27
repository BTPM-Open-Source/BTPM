import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Lifecycle stages (product lifecycle) — Phase 6E.1
// ---------------------------------------------------------------------------
export type PortfolioLifecycleState =
  | "opportunity_candidate"
  | "business_case_approved"
  | "contracted"
  | "development"
  | "submission_approval"
  | "launch_preparation"
  | "launched_commercial"
  | "lcm_optimization"
  | "on_hold"
  | "discontinuation"
  | "retired";

export const PORTFOLIO_LIFECYCLE_STATES: PortfolioLifecycleState[] = [
  "opportunity_candidate",
  "business_case_approved",
  "contracted",
  "development",
  "submission_approval",
  "launch_preparation",
  "launched_commercial",
  "lcm_optimization",
  "on_hold",
  "discontinuation",
  "retired",
];

export const PORTFOLIO_LIFECYCLE_LABELS: Record<PortfolioLifecycleState, string> = {
  opportunity_candidate: "Opportunity / Candidate",
  business_case_approved: "Business Case Approved",
  contracted: "Contracted",
  development: "Development",
  submission_approval: "Submission / Approval",
  launch_preparation: "Launch Preparation",
  launched_commercial: "Launched / Commercial",
  lcm_optimization: "LCM / Optimization",
  on_hold: "On Hold",
  discontinuation: "Discontinuation",
  retired: "Retired",
};

export function portfolioLifecycleLabel(s: string): string {
  return (
    PORTFOLIO_LIFECYCLE_LABELS[s as PortfolioLifecycleState] ??
    s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

// ---------------------------------------------------------------------------
// Strategic priority — Phase 6E.1
// ---------------------------------------------------------------------------
export type PortfolioStrategicPriority =
  | "critical"
  | "high"
  | "medium"
  | "low"
  | "watchlist";

export const PORTFOLIO_STRATEGIC_PRIORITIES: PortfolioStrategicPriority[] = [
  "critical",
  "high",
  "medium",
  "low",
  "watchlist",
];

export const PORTFOLIO_STRATEGIC_PRIORITY_LABELS: Record<PortfolioStrategicPriority, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  watchlist: "Watchlist",
};

export function portfolioStrategicPriorityLabel(s: string): string {
  return (
    PORTFOLIO_STRATEGIC_PRIORITY_LABELS[s as PortfolioStrategicPriority] ??
    s.replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

// ---------------------------------------------------------------------------

export interface AdminPortfolioItem {
  id: string;
  organization_id: string;
  name: string;
  code: string | null;
  description: string | null;
  lifecycle_state: PortfolioLifecycleState;
  strategic_priority: PortfolioStrategicPriority;
  owner_id: string | null;
  is_archived: boolean;
  archived_at: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  project_count: number;
  active_project_count: number;
  workspace_count: number;
  active_team_member_count: number;
}

export interface PortfolioMembershipProject {
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
  updated_at: string;
}

export function useAdminPortfolioItems(
  organizationId: string | undefined,
  includeArchived: boolean,
) {
  return useQuery({
    queryKey: ["admin-portfolio-items", organizationId, { includeArchived }],
    enabled: !!organizationId,
    queryFn: async (): Promise<AdminPortfolioItem[]> => {
      if (!organizationId) return [];
      const { data, error } = await supabase.rpc("admin_list_portfolio_items", {
        _organization_id: organizationId,
        _include_archived: includeArchived,
      });
      if (error) throw error;
      return (data as unknown as AdminPortfolioItem[]) ?? [];
    },
  });
}

export function usePortfolioItemProjectMembership(
  portfolioItemId: string | null,
  includeArchivedProjects: boolean,
) {
  return useQuery({
    queryKey: [
      "admin-portfolio-membership",
      portfolioItemId,
      { includeArchivedProjects },
    ],
    enabled: !!portfolioItemId,
    queryFn: async (): Promise<PortfolioMembershipProject[]> => {
      if (!portfolioItemId) return [];
      const { data, error } = await supabase.rpc(
        "get_portfolio_item_project_membership_summary",
        {
          _portfolio_item_id: portfolioItemId,
          _include_archived_projects: includeArchivedProjects,
        },
      );
      if (error) throw error;
      return (data as unknown as PortfolioMembershipProject[]) ?? [];
    },
  });
}

export interface PortfolioMutationInput {
  name: string;
  code: string | null;
  description: string | null;
  lifecycle_state: PortfolioLifecycleState;
  strategic_priority: PortfolioStrategicPriority;
  owner_id: string | null;
}

export function useAdminPortfolioMutations(organizationId: string | undefined) {
  const qc = useQueryClient();

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin-portfolio-items", organizationId] });
  };

  const createPortfolioItem = useMutation({
    mutationFn: async (input: PortfolioMutationInput) => {
      if (!organizationId) throw new Error("Missing organization");
      const { data, error } = await supabase.rpc("admin_create_portfolio_item", {
        _organization_id: organizationId,
        _name: input.name,
        _code: input.code,
        _description: input.description,
        _lifecycle_state: input.lifecycle_state,
        _owner_id: input.owner_id,
        _strategic_priority: input.strategic_priority,
      });
      if (error) throw error;
      return data as unknown as string;
    },
    onSuccess: () => {
      toast.success("Portfolio created");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message || "Failed to create Portfolio"),
  });

  const updatePortfolioItem = useMutation({
    mutationFn: async (input: PortfolioMutationInput & { id: string }) => {
      const { error } = await supabase.rpc("admin_update_portfolio_item", {
        _portfolio_item_id: input.id,
        _name: input.name,
        _code: input.code,
        _description: input.description,
        _lifecycle_state: input.lifecycle_state,
        _owner_id: input.owner_id,
        _strategic_priority: input.strategic_priority,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Portfolio updated");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message || "Failed to update Portfolio"),
  });

  const archivePortfolioItem = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("admin_archive_portfolio_item", {
        _portfolio_item_id: id,
        _is_archived: true,
      });
      if (error) throw error;
    },
    onSuccess: (_data, id) => {
      toast.success("Portfolio archived");
      qc.invalidateQueries({ queryKey: ["admin-portfolio-items", organizationId] });
      qc.invalidateQueries({ queryKey: ["admin-portfolio-membership", id] });
    },
    onError: (e: Error) => toast.error(e.message || "Failed to archive Portfolio"),
  });

  const unarchivePortfolioItem = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("admin_archive_portfolio_item", {
        _portfolio_item_id: id,
        _is_archived: false,
      });
      if (error) throw error;
    },
    onSuccess: (_data, id) => {
      toast.success("Portfolio unarchived");
      qc.invalidateQueries({ queryKey: ["admin-portfolio-items", organizationId] });
      qc.invalidateQueries({ queryKey: ["admin-portfolio-membership", id] });
    },
    onError: (e: Error) => toast.error(e.message || "Failed to unarchive Portfolio"),
  });

  return {
    createPortfolioItem,
    updatePortfolioItem,
    archivePortfolioItem,
    unarchivePortfolioItem,
  };
}
