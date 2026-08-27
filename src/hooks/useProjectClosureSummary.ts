/**
 * Phase 6C — Step 6C.5 — Project Closure Summary data access hooks.
 *
 * Backend contract: `project_closure_summaries` (one row per project).
 * All narrative fields are encrypted at rest; reads flow through the
 * SECURITY DEFINER RPC `get_decrypted_project_closure_summary`, and writes
 * flow through `upsert_project_closure_summary` (which enforces project-edit
 * authority via `has_project_pm_authority`).
 *
 * No raw table selects — the encrypted columns are never fetched client-side.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export interface ProjectClosureSummary {
  id: string;
  organization_id: string;
  workspace_id: string;
  project_id: string;
  outcome_summary: string | null;
  benefits_summary: string | null;
  achievements_summary: string | null;
  open_items_summary: string | null;
  transition_notes: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectClosureSummaryInput {
  outcome_summary?: string | null;
  benefits_summary?: string | null;
  achievements_summary?: string | null;
  open_items_summary?: string | null;
  transition_notes?: string | null;
}

export const PROJECT_CLOSURE_SUMMARY_MAX_LENGTH = 4000;

export function useProjectClosureSummary(projectId: string | undefined) {
  return useQuery({
    queryKey: ["project-closure-summary", projectId],
    enabled: !!projectId,
    queryFn: async (): Promise<ProjectClosureSummary | null> => {
      if (!projectId) return null;
      const { data, error } = await (supabase.rpc as any)(
        "get_decrypted_project_closure_summary",
        { _project_id: projectId },
      );
      if (error) throw error;
      const rows = (data as ProjectClosureSummary[] | null) ?? [];
      return rows.length > 0 ? rows[0] : null;
    },
    staleTime: 30_000,
  });
}

export function useUpsertProjectClosureSummary(projectId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ProjectClosureSummaryInput): Promise<string> => {
      if (!projectId) throw new Error("projectId is required");
      const payload = {
        _project_id: projectId,
        _outcome_summary: input.outcome_summary ?? null,
        _benefits_summary: input.benefits_summary ?? null,
        _achievements_summary: input.achievements_summary ?? null,
        _open_items_summary: input.open_items_summary ?? null,
        _transition_notes: input.transition_notes ?? null,
      };
      const { data, error } = await (supabase.rpc as any)(
        "upsert_project_closure_summary",
        payload,
      );
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-closure-summary", projectId] });
      toast.success("Closure summary saved");
    },
    onError: (err: any) => {
      toast.error(err?.message ?? "Failed to save closure summary");
    },
  });
}
