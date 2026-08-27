import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Phase 6C Step 6C.10 — Portfolio Benefits Realization data hook.
 *
 * Read-only. Calls the protected SECURITY DEFINER RPC
 * `get_portfolio_benefits_realization` which enforces per-project access
 * before any aggregation. This hook performs NO raw table selects and
 * introduces no write path.
 */

export interface PortfolioBenefitsRealizationFilters {
  workspaceIds?: string[] | null;
  programIds?: string[] | null;
  projectIds?: string[] | null;
  projectStatuses?: string[] | null;
  projectManagerIds?: string[] | null;
  benefitTypes?: string[] | null;
  realizationStatuses?: string[] | null;
  expectedFrom?: string | null; // YYYY-MM-DD
  expectedTo?: string | null;   // YYYY-MM-DD
  includeArchived?: boolean;
  portfolioItemIds?: string[] | null;
  includeNoPortfolio?: boolean;
}

export interface PortfolioContextFields {
  portfolio_item_id: string | null;
  portfolio_name: string | null;
  portfolio_code: string | null;
  portfolio_lifecycle_state: string | null;
  portfolio_is_archived: boolean | null;
}

export interface PortfolioBenefitsFinancialEntry {
  unit: string;
  target: number;
  actual: number;
  achievement_pct: number | null;
}

export interface PortfolioBenefitsSummary {
  projects_with_benefits: number;
  benefits_tracked: number;
  financial: PortfolioBenefitsFinancialEntry[];
  fte_saved: number;
  hours_saved: number;
  actuals_pending: number;
  benefits_overdue_for_update: number;
}

export interface PortfolioBenefitsByType {
  benefit_type: string;
  benefit_type_label: string;
  benefit_count: number;
  projects_count: number;
  financial: PortfolioBenefitsFinancialEntry[];
  fte_actual: number;
  hours_actual: number;
  pending_count: number;
  overdue_count: number;
}

export interface PortfolioBenefitsByProject extends PortfolioContextFields {
  project_id: string;
  project_name: string | null;
  workspace_id: string | null;
  workspace_name: string | null;
  program_id: string | null;
  program_name: string | null;
  project_status: string | null;
  project_manager_id: string | null;
  project_manager_name: string | null;
  benefit_count: number;
  financial: PortfolioBenefitsFinancialEntry[];
  fte_actual: number;
  hours_actual: number;
  actuals_pending: number;
  overdue_count: number;
}

export interface PortfolioBenefitRequiringUpdate extends PortfolioContextFields {
  benefit_id: string;
  project_id: string;
  project_name: string | null;
  workspace_name: string | null;
  benefit_type: string;
  metric_name: string | null;
  unit_of_measure: string | null;
  target_value: number | null;
  actual_value: number | null;
  realization_status: string;
  expected_realization_date: string | null;
  benefit_owner_id: string | null;
  benefit_owner_name: string | null;
}

export interface PortfolioBenefitRow extends PortfolioContextFields {
  benefit_id: string;
  project_id: string;
  project_name: string | null;
  workspace_id: string | null;
  workspace_name: string | null;
  program_id: string | null;
  program_name: string | null;
  project_status: string | null;
  project_manager_id: string | null;
  project_manager_name: string | null;
  benefit_type: string;
  custom_benefit_type_label: string | null;
  metric_name: string | null;
  unit_of_measure: string | null;
  baseline_value: number | null;
  target_value: number | null;
  actual_value: number | null;
  realization_status: string;
  expected_realization_date: string | null;
  actual_realization_date: string | null;
  benefit_owner_id: string | null;
  benefit_owner_name: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PortfolioBenefitsRealizationData {
  summary: PortfolioBenefitsSummary;
  benefits_by_type: PortfolioBenefitsByType[];
  benefits_by_project: PortfolioBenefitsByProject[];
  benefits_requiring_update: PortfolioBenefitRequiringUpdate[];
  rows: PortfolioBenefitRow[];
  meta: {
    filters_applied: Record<string, unknown>;
    generated_at: string;
    include_archived: boolean;
  };
}

const nullIfEmpty = <T,>(v: T[] | null | undefined): T[] | null =>
  v && v.length > 0 ? v : null;

export function usePortfolioBenefitsRealization(
  filters: PortfolioBenefitsRealizationFilters = {},
  options: { enabled?: boolean } = {},
) {
  const {
    workspaceIds = null,
    programIds = null,
    projectIds = null,
    projectStatuses = null,
    projectManagerIds = null,
    benefitTypes = null,
    realizationStatuses = null,
    expectedFrom = null,
    expectedTo = null,
    includeArchived = false,
    portfolioItemIds = null,
    includeNoPortfolio = false,
  } = filters;

  const queryKey = [
    "portfolio-benefits-realization",
    {
      workspaceIds: nullIfEmpty(workspaceIds),
      programIds: nullIfEmpty(programIds),
      projectIds: nullIfEmpty(projectIds),
      projectStatuses: nullIfEmpty(projectStatuses),
      projectManagerIds: nullIfEmpty(projectManagerIds),
      benefitTypes: nullIfEmpty(benefitTypes),
      realizationStatuses: nullIfEmpty(realizationStatuses),
      expectedFrom,
      expectedTo,
      includeArchived,
      portfolioItemIds: nullIfEmpty(portfolioItemIds),
      includeNoPortfolio,
    },
  ] as const;

  return useQuery({
    queryKey,
    enabled: options.enabled ?? true,
    queryFn: async (): Promise<PortfolioBenefitsRealizationData> => {
      const { data, error } = await supabase.rpc(
        "get_portfolio_benefits_realization",
        {
          _workspace_ids: nullIfEmpty(workspaceIds),
          _program_ids: nullIfEmpty(programIds),
          _project_ids: nullIfEmpty(projectIds),
          _project_statuses: nullIfEmpty(projectStatuses),
          _project_manager_ids: nullIfEmpty(projectManagerIds),
          _benefit_types: nullIfEmpty(benefitTypes),
          _realization_statuses: nullIfEmpty(realizationStatuses),
          _expected_from: expectedFrom,
          _expected_to: expectedTo,
          _include_archived: includeArchived,
          _portfolio_item_ids: nullIfEmpty(portfolioItemIds),
          _include_no_portfolio: includeNoPortfolio,
        },
      );

      if (error) throw error;
      return data as unknown as PortfolioBenefitsRealizationData;
    },
  });
}
