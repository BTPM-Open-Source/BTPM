import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { mapDependencyError } from "@/lib/dependencyConflictEngine";
import { mapProjectGuardError } from "@/lib/projectCompletionGuard";
import { parsePmgCommandResult } from "@/lib/pmg/pmgContract";

import type { ProjectDeliveryModel } from "@/lib/projectDeliveryModel";

export interface ProjectUpdatePayload {
  name?: string;
  // status/date fields are excluded from this path (owned by dedicated PMG
  // commands: apply_project_status_transition and apply_project_planning_change).
  status?: string;
  priority?: string;
  start_date?: string | null;
  target_end_date?: string | null;
  description?: string | null;
  charter?: string | null;
  goals?: string | null;
  scope_in?: string | null;
  scope_out?: string | null;
  business_case?: string | null;
  success_criteria?: string | null;
  completion_criteria?: string | null;
  budget_narrative?: string | null;
  assumptions?: string | null;
  constraints?: string | null;
  program_id?: string | null;
  delivery_model?: ProjectDeliveryModel | null;
}

// Fields owned by apply_project_update (non-date, non-status).
const APPLY_PROJECT_UPDATE_FIELDS = [
  "name",
  "priority",
  "description",
  "charter",
  "goals",
  "scope_in",
  "scope_out",
  "business_case",
  "success_criteria",
  "completion_criteria",
  "budget_narrative",
  "assumptions",
  "constraints",
  "program_id",
  "delivery_model",
] as const;

type ApplyProjectUpdateField = (typeof APPLY_PROJECT_UPDATE_FIELDS)[number];

/**
 * PMG.2G — fetch the canonical fresh `updated_at` via the protected
 * `get_decrypted_project` read path. Used immediately before
 * apply_project_update so this call can never carry a stale timestamp when
 * earlier steps in the same user save (dates, ordinary status transition)
 * have already advanced `updated_at`.
 */
async function fetchFreshProjectUpdatedAt(
  projectId: string,
): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc("get_decrypted_project", {
      _project_id: projectId,
    } as any);
    if (error) return null;
    const row: any = Array.isArray(data) ? data[0] : data;
    const ts = row?.updated_at ?? null;
    return typeof ts === "string" ? ts : null;
  } catch {
    return null;
  }
}

export function useProjectUpdate(projectId: string | undefined) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (payload: ProjectUpdatePayload) => {
      if (!projectId) throw new Error("No project ID");

      // Strip fields not owned by this command. Status and dates have their
      // own PMG commands and are handled by ProjectEditDialog before we run.
      const anyPayload = payload as Record<string, unknown>;

      // Build set-flags + values for only the fields the caller included.
      const args: Record<string, unknown> = {
        _project_id: projectId,
      };
      let anyProvided = false;
      for (const field of APPLY_PROJECT_UPDATE_FIELDS) {
        const key = field as ApplyProjectUpdateField;
        if (key in anyPayload) {
          anyProvided = true;
          args[`_${key}`] = anyPayload[key] ?? null;
          args[`_set_${key}`] = true;
        }
      }
      if (!anyProvided) {
        return { status: "no_change" as const };
      }

      const fresh = await fetchFreshProjectUpdatedAt(projectId);
      if (!fresh) {
        throw new Error(
          "Could not read the latest project snapshot required to save safely. Please reload and try again.",
        );
      }
      args._expected_updated_at = fresh;

      const { data, error } = await supabase.rpc(
        "apply_project_update" as any,
        args as any,
      );
      if (error) throw error;

      const result = parsePmgCommandResult(data);
      switch (result.status) {
        case "applied":
        case "no_change":
          return { status: result.status };
        case "not_authorized":
          throw new Error(
            "You do not have permission to change this project.",
          );
        case "conflict": {
          throw new Error(
            "This project was updated by someone else. Reload and try your changes again.",
          );
        }
        case "invalid": {
          const reason = (result.data as any)?.reason;
          if (reason === "name_required") {
            throw new Error("Project name is required.");
          }
          if (reason === "invalid_program") {
            throw new Error(
              "Selected program is invalid, archived, or belongs to a different workspace.",
            );
          }
          throw new Error("Project changes could not be saved.");
        }
        default:
          throw new Error(`Unexpected result status: ${result.status}`);
      }
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      queryClient.invalidateQueries({ queryKey: ["workspace-projects"] });
      if (res?.status === "applied") {
        toast({ title: "Project updated" });
      }
    },
    onError: (err: any) => {
      const raw = err?.message || String(err);
      const friendly = mapProjectGuardError(raw) ?? mapDependencyError(err) ?? raw;
      toast({ title: "Error saving project", description: friendly, variant: "destructive" });
    },
  });
}

// ---------------------------------------------------------------------------
// PMG.2G.0 — Canonical Protected Project Status Transition (client side).
// ---------------------------------------------------------------------------

export type ProjectStatusTransitionStatus =
  | "applied"
  | "no_change"
  | "conflict"
  | "blocked"
  | "confirmation_required"
  | "not_authorized"
  | "invalid";

export interface ProjectStatusTransitionResult {
  status: ProjectStatusTransitionStatus;
  command: string;
  target_type: string;
  target_id: string | null;
  project_id: string | null;
  data?: any;
  warnings?: any[];
  confirmations?: any[];
  conflict?: any;
}

export interface ApplyProjectStatusTransitionInput {
  projectId: string;
  expectedUpdatedAt: string | null | undefined;
  targetStatus: string;
  confirmWarnings?: boolean;
  correlationId?: string | null;
  idempotencyKey?: string | null;
}

export async function applyProjectStatusTransition(
  input: ApplyProjectStatusTransitionInput,
): Promise<ProjectStatusTransitionResult> {
  if (!input.projectId) throw new Error("No project ID");
  if (!input.expectedUpdatedAt) {
    throw new Error(
      "Cannot change project status: local project snapshot is missing an updated_at value. Reload the project and try again.",
    );
  }
  const { data, error } = await supabase.rpc(
    "apply_project_status_transition" as any,
    {
      _project_id: input.projectId,
      _expected_updated_at: input.expectedUpdatedAt,
      _target_status: input.targetStatus,
      _confirm_warnings: input.confirmWarnings ?? false,
      _correlation_id: input.correlationId ?? null,
      _idempotency_key: input.idempotencyKey ?? null,
    } as any,
  );
  if (error) throw error;
  return data as unknown as ProjectStatusTransitionResult;
}

export function useProjectStatusTransition(projectId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      vars: Omit<ApplyProjectStatusTransitionInput, "projectId"> & {
        projectId?: string;
      },
    ) => {
      const pid = vars.projectId ?? projectId;
      if (!pid) throw new Error("No project ID");
      return applyProjectStatusTransition({ ...vars, projectId: pid });
    },
    onSuccess: (result) => {
      if (result.status === "applied") {
        queryClient.invalidateQueries({ queryKey: ["project", projectId] });
        queryClient.invalidateQueries({ queryKey: ["workspace-projects"] });
      }
    },
  });
}
