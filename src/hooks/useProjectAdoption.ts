import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * CM.4 — Frontend hook around the CM.2 / CM.3 Adoption Plan RPCs.
 *
 * The Adoption Plan is a structure and lens over normal BTPM execution objects.
 * Phases/tasks remain the canonical execution truth. No new tables, no new
 * persisted summary state — the UI derives counts from canonical data at read
 * time.
 */

// ---------- Types (loose, tolerant of jsonb/null shapes) ----------

export type AdoptionPlan = {
  id: string;
  project_id: string;
  organization_id: string;
  workspace_id: string;
  objective: string | null;
  impacted_audience_summary: string | null;
  approach_summary: string | null;
  adoption_owner_id: string | null;
  readiness_status: string | null;
  enabled: boolean;
  created_from_template: boolean;
  is_archived: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type AdoptionInitiative = {
  id: string;
  adoption_plan_id: string;
  project_id: string;
  name: string | null;
  summary: string | null;
  readiness_area: string | null;
  owner_id: string | null;
  status: string | null;
  priority: string | null;
  target_date: string | null;
  sort_order: number;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
};

export type AdoptionObjectLink = {
  id: string;
  adoption_initiative_id: string | null;
  object_type: string;
  object_id: string;
  created_at: string;
};

export type AdoptionSubstrate = {
  adoptionPlan: AdoptionPlan | null;
  initiatives: AdoptionInitiative[];
  linkedTaskCounts: Record<string, number>;
  linkedObjectCounts: Record<string, number>;
  linkedObjects: AdoptionObjectLink[];
  hasAdoptionPlan: boolean;
};

export type AdoptionTemplateTask = {
  key: string;
  title: string;
  description: string | null;
  default_selected: boolean;
};

export type AdoptionTemplateInitiative = {
  key: string;
  name: string;
  readiness_area: string;
  sort_order: number;
  summary: string;
  default_selected: boolean;
  tasks: AdoptionTemplateTask[];
};

export type AdoptionTemplatePreview = {
  project_id: string;
  template_key: string;
  template_name: string;
  recommended_phase_name: string;
  creates_normal_phase: boolean;
  creates_normal_tasks: boolean;
  dates_auto_populated: boolean;
  suggested_phase_start_date: string | null;
  suggested_phase_end_date: string | null;
  date_source: "project_dates" | "phase_dates" | "task_dates" | "none";
  initiative_count: number;
  task_count: number;
  initiatives: AdoptionTemplateInitiative[];
};

export type AdoptionCustomTaskInput = {
  initiativeKey: string;
  title: string;
  description?: string | null;
};

export type GenerateAdoptionPlanArgs = {
  phaseName: string;
  phaseStartDate?: string | null;
  phaseEndDate?: string | null;
  selectedTaskKeys: string[];
  customTasks: AdoptionCustomTaskInput[];
};

// ---------- Substrate (CM.2 read) ----------

export function useProjectAdoptionSubstrate(projectId: string | undefined) {
  return useQuery({
    queryKey: ["project-adoption-substrate", projectId],
    enabled: !!projectId,
    queryFn: async (): Promise<AdoptionSubstrate> => {
      if (!projectId) throw new Error("No project ID");
      const { data, error } = await supabase.rpc("list_project_adoption_substrate", {
        _project_id: projectId,
      });
      if (error) throw error;
      const raw = (data ?? {}) as any;
      const plan = (raw.adoption_plan ?? null) as AdoptionPlan | null;
      return {
        adoptionPlan: plan,
        initiatives: (raw.initiatives ?? []) as AdoptionInitiative[],
        linkedTaskCounts: (raw.linked_task_counts ?? {}) as Record<string, number>,
        linkedObjectCounts: (raw.linked_object_counts ?? {}) as Record<string, number>,
        linkedObjects: (raw.linked_objects ?? []) as AdoptionObjectLink[],
        hasAdoptionPlan: !!plan,
      };
    },
  });
}

// ---------- Template preview (CM.3 read) ----------

export function useProjectAdoptionTemplatePreview(
  projectId: string | undefined,
  options?: { enabled?: boolean },
) {
  const enabled = !!projectId && (options?.enabled ?? true);
  return useQuery({
    queryKey: ["project-adoption-template-preview", projectId],
    enabled,
    queryFn: async (): Promise<AdoptionTemplatePreview> => {
      if (!projectId) throw new Error("No project ID");
      const { data, error } = await supabase.rpc("preview_project_adoption_template", {
        _project_id: projectId,
      });
      if (error) throw error;
      return data as unknown as AdoptionTemplatePreview;
    },
  });
}

// ---------- Generate (CM.3 mutating RPC) ----------

function mapGenerateError(raw: string): string {
  const msg = (raw || "").toLowerCase();
  if (msg.includes("adoption_phase_dates_required_for_baselined_project")) {
    return "This project is baselined, so generated adoption tasks need planned dates. Set the Adoption phase start and end dates before generating.";
  }
  if (msg.includes("adoption_phase_end_before_start")) {
    return "Phase end date cannot be before phase start date.";
  }
  if (msg.includes("adoption_template_selection_empty")) {
    return "Select at least one adoption task before generating the plan.";
  }
  if (msg.includes("adoption_template_selection_invalid")) {
    return "The selected template items are no longer valid. Refresh and try again.";
  }
  if (msg.includes("adoption_plan_already_exists")) {
    return "This project already has an Adoption Plan.";
  }
  if (msg.includes("phase_required_for_task_generation")) {
    return "A phase is required because BTPM tasks cannot exist outside a phase.";
  }

  if (
    msg.includes("duplicate key") ||
    msg.includes("unique constraint") ||
    msg.includes("phases_project_id_name") ||
    msg.includes("already exists")
  ) {
    return "A phase with this name already exists. Choose a different phase name.";
  }
  if (msg.includes("forbidden")) {
    return "You do not have permission to generate an Adoption Plan for this project.";
  }
  if (msg.includes("not_authenticated")) {
    return "Your session is no longer active. Please sign in again.";
  }
  return "Could not generate the Adoption Plan. Please try again or contact an administrator if the issue persists.";
}

export function useGenerateProjectAdoptionPlan(projectId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: GenerateAdoptionPlanArgs) => {
      if (!projectId) throw new Error("No project ID");
      const phaseName = (args.phaseName || "Adoption & Readiness").trim();
      const customTasks = (args.customTasks ?? [])
        .map((c) => ({
          initiative_key: c.initiativeKey,
          title: (c.title ?? "").trim(),
          description: c.description?.trim() || null,
        }))
        .filter((c) => c.title.length > 0 && c.initiative_key);
      const selection = {
        selected_task_keys: args.selectedTaskKeys ?? [],
        custom_tasks: customTasks,
      };
      const { data, error } = await supabase.rpc(
        "generate_project_adoption_plan_from_template",
        {
          _project_id: projectId,
          _create_phase: true,
          _phase_name: phaseName,
          _selection: selection as any,
          _phase_start_date: args.phaseStartDate ?? null,
          _phase_end_date: args.phaseEndDate ?? null,
        } as any,
      );
      if (error) {
        const friendly = mapGenerateError(error.message);
        const e = new Error(friendly);
        (e as any).original = error;
        throw e;
      }
      return data;
    },
    onSuccess: () => {
      if (!projectId) return;
      qc.invalidateQueries({ queryKey: ["project-adoption-substrate", projectId] });
      qc.invalidateQueries({ queryKey: ["project-adoption-template-preview", projectId] });
      qc.invalidateQueries({ queryKey: ["project-phases", projectId] });
      qc.invalidateQueries({ queryKey: ["project-tasks", projectId] });
      qc.invalidateQueries({ queryKey: ["project-activity-events", projectId] });
      qc.invalidateQueries({ queryKey: ["project", projectId] });
    },
  });
}

// ---------- CM.5 — Adoption link mutations ----------

export type AdoptionObjectType = "risk" | "blocker" | "kpi";

function mapTaskLinkError(raw: string): string {
  const msg = (raw || "").toLowerCase();
  if (msg.includes("invalid_task")) return "This task could not be found.";
  if (msg.includes("adoption_plan_required") || msg.includes("invalid_adoption_plan")) {
    return "This project does not have an active Adoption Plan.";
  }
  if (msg.includes("initiative_plan_mismatch")) {
    return "The selected initiative does not belong to this Adoption Plan.";
  }
  if (msg.includes("invalid_initiative")) return "The selected initiative could not be found.";
  if (msg.includes("forbidden") || msg.includes("permission") || msg.includes("row-level")) {
    return "You do not have permission to update adoption links for this task.";
  }
  if (msg.includes("not_authenticated")) {
    return "Your session is no longer active. Please sign in again.";
  }
  return "Could not link this task to the Adoption Plan.";
}

function mapTaskUnlinkError(raw: string): string {
  const msg = (raw || "").toLowerCase();
  if (msg.includes("invalid_task")) return "This task could not be found.";
  if (msg.includes("forbidden") || msg.includes("permission") || msg.includes("row-level")) {
    return "You do not have permission to update adoption links for this task.";
  }
  if (msg.includes("not_authenticated")) {
    return "Your session is no longer active. Please sign in again.";
  }
  return "Could not remove this task from the Adoption Plan.";
}

function mapObjectLinkError(raw: string): string {
  const msg = (raw || "").toLowerCase();
  if (msg.includes("object_project_mismatch")) return "This item does not belong to the current project.";
  if (msg.includes("invalid_object_reference")) return "This item could not be found.";
  if (msg.includes("initiative_plan_mismatch")) return "The selected initiative does not belong to this Adoption Plan.";
  if (msg.includes("duplicate key") || msg.includes("unique constraint") || msg.includes("already")) {
    return "This item is already linked to the Adoption Plan.";
  }
  if (msg.includes("forbidden") || msg.includes("permission")) {
    return "You do not have permission to link this item to the Adoption Plan.";
  }
  if (msg.includes("not_authenticated")) return "Your session is no longer active. Please sign in again.";
  return "Could not link this item to the Adoption Plan.";
}

function mapObjectUnlinkError(raw: string): string {
  const msg = (raw || "").toLowerCase();
  if (msg.includes("forbidden") || msg.includes("permission")) {
    return "You do not have permission to remove this adoption link.";
  }
  if (msg.includes("invalid_link") || msg.includes("not found")) {
    return "This adoption link no longer exists.";
  }
  return "Could not remove this adoption link.";
}

function invalidateAdoptionLinkQueries(qc: ReturnType<typeof useQueryClient>, projectId: string) {
  qc.invalidateQueries({ queryKey: ["project-adoption-substrate", projectId] });
  qc.invalidateQueries({ queryKey: ["project-tasks", projectId] });
  qc.invalidateQueries({ queryKey: ["project-all-risks", projectId] });
  qc.invalidateQueries({ queryKey: ["project-all-blockers", projectId] });
  qc.invalidateQueries({ queryKey: ["kpi-definitions", projectId] });
  qc.invalidateQueries({ queryKey: ["project-activity-events", projectId] });
}

export function useLinkTaskToAdoption(projectId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { taskId: string; adoptionInitiativeId?: string | null }) => {
      if (!projectId) throw new Error("No project ID");
      const { error } = await supabase.rpc("link_task_to_adoption", {
        _task_id: args.taskId,
        _adoption_initiative_id: args.adoptionInitiativeId ?? null,
      });
      if (error) throw new Error(mapTaskLinkError(error.message));
    },
    onSuccess: () => {
      if (projectId) invalidateAdoptionLinkQueries(qc, projectId);
    },
  });
}

export function useUnlinkTaskFromAdoption(projectId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { taskId: string }) => {
      if (!projectId) throw new Error("No project ID");
      const { error } = await supabase.rpc("unlink_task_from_adoption", {
        _task_id: args.taskId,
      });
      if (error) throw new Error(mapTaskUnlinkError(error.message));
    },
    onSuccess: () => {
      if (projectId) invalidateAdoptionLinkQueries(qc, projectId);
    },
  });
}

export function useLinkAdoptionObject(projectId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      adoptionPlanId: string;
      objectType: AdoptionObjectType;
      objectId: string;
      adoptionInitiativeId?: string | null;
    }) => {
      if (!projectId) throw new Error("No project ID");
      const { data, error } = await supabase.rpc("link_adoption_object", {
        _adoption_plan_id: args.adoptionPlanId,
        _object_type: args.objectType,
        _object_id: args.objectId,
        _adoption_initiative_id: args.adoptionInitiativeId ?? null,
      });
      if (error) throw new Error(mapObjectLinkError(error.message));
      return data;
    },
    onSuccess: () => {
      if (projectId) invalidateAdoptionLinkQueries(qc, projectId);
    },
  });
}

export function useUnlinkAdoptionObject(projectId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { linkId: string }) => {
      if (!projectId) throw new Error("No project ID");
      const { error } = await supabase.rpc("unlink_adoption_object", {
        _link_id: args.linkId,
      });
      if (error) throw new Error(mapObjectUnlinkError(error.message));
    },
    onSuccess: () => {
      if (projectId) invalidateAdoptionLinkQueries(qc, projectId);
    },
  });
}


// =====================================================================
// CM.7B — Adoption Template Library
// =====================================================================

export type AdoptionTemplateListItem = {
  template_id: string | null;
  template_key: string | null;
  name: string;
  description: string | null;
  is_system: boolean;
  scope: string;
  source_template_key: string | null;
  is_archived: boolean;
  updated_at: string | null;
  created_by: string | null;
  initiative_count: number;
  task_count: number;
};

export type AdoptionSavedTemplateTask = {
  key: string;
  title: string;
  description: string | null;
  default_selected: boolean;
  is_custom: boolean;
};

export type AdoptionSavedTemplateInitiative = {
  key: string;
  name: string;
  readiness_area: string;
  sort_order: number;
  summary: string | null;
  default_selected: boolean;
  tasks: AdoptionSavedTemplateTask[];
};

export type AdoptionSavedTemplatePreview = {
  template_id: string | null;
  template_key: string | null;
  name: string;
  description: string | null;
  is_system: boolean;
  editable: boolean;
  scope: string;
  source_template_key: string | null;
  initiatives: AdoptionSavedTemplateInitiative[];
};

export function useWorkspaceAdoptionTemplates(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["workspace-adoption-templates", workspaceId],
    enabled: !!workspaceId,
    queryFn: async (): Promise<AdoptionTemplateListItem[]> => {
      const { data, error } = await supabase.rpc("list_adoption_templates", {
        _workspace_id: workspaceId!,
      } as any);
      if (error) throw error;
      return (data ?? []) as unknown as AdoptionTemplateListItem[];
    },
  });
}

export function useAdoptionTemplatePreview(
  workspaceId: string | undefined,
  templateId: string | null | undefined,
  templateKey: string = "btpm_standard_adoption",
) {
  return useQuery({
    queryKey: ["adoption-template-preview", workspaceId, templateId ?? `key:${templateKey}`],
    enabled: !!workspaceId,
    queryFn: async (): Promise<AdoptionSavedTemplatePreview> => {
      const { data, error } = await supabase.rpc("preview_adoption_template", {
        _workspace_id: workspaceId!,
        _template_id: templateId ?? null,
        _template_key: templateKey,
      } as any);
      if (error) throw error;
      return data as unknown as AdoptionSavedTemplatePreview;
    },
  });
}

export type AdoptionTemplatePayloadTask = {
  key: string;
  title: string;
  description?: string | null;
  default_selected?: boolean;
  is_custom?: boolean;
  sort_order?: number;
};
export type AdoptionTemplatePayloadInitiative = {
  key: string;
  name: string;
  readiness_area: string;
  summary?: string | null;
  default_selected?: boolean;
  sort_order?: number;
  tasks: AdoptionTemplatePayloadTask[];
};
export type AdoptionTemplatePayload = {
  source_template_key?: string | null;
  initiatives: AdoptionTemplatePayloadInitiative[];
};

function mapTemplateError(raw: string): string {
  const m = (raw || "").toLowerCase();
  if (m.includes("template_name_required")) return "Template name is required.";
  if (m.includes("system_template_read_only")) return "The BTPM Standard Template is read-only.";
  if (m.includes("invalid_template_payload")) return "Template payload is invalid.";
  if (m.includes("duplicate_initiative_key")) return "Initiative keys must be unique within a template.";
  if (m.includes("duplicate_task_key")) return "Task keys must be unique within an initiative.";
  if (m.includes("initiative_requires_task")) return "Each initiative needs at least one task.";
  if (m.includes("invalid_readiness_area")) return "An initiative has an invalid readiness area.";
  if (m.includes("task_title_required")) return "Every task needs a title.";
  if (m.includes("invalid_template")) return "Template not found.";
  if (m.includes("template_workspace_mismatch")) return "This template does not belong to this workspace.";
  if (m.includes("forbidden")) return "You do not have permission to perform this action.";
  if (m.includes("not_authenticated")) return "Your session is no longer active. Please sign in again.";
  return "Template action failed.";
}

export function useCreateAdoptionTemplate(workspaceId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { name: string; description?: string | null; payload: AdoptionTemplatePayload }) => {
      const { data, error } = await supabase.rpc("create_adoption_template_from_payload", {
        _workspace_id: workspaceId!,
        _name: args.name,
        _description: args.description ?? null,
        _payload: args.payload as any,
      } as any);
      if (error) throw new Error(mapTemplateError(error.message));
      return data as unknown as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workspace-adoption-templates", workspaceId] });
    },
  });
}

export function useUpdateAdoptionTemplate(workspaceId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      templateId: string;
      name: string;
      description?: string | null;
      payload: AdoptionTemplatePayload;
    }) => {
      const { data, error } = await supabase.rpc("update_adoption_template_from_payload", {
        _template_id: args.templateId,
        _name: args.name,
        _description: args.description ?? null,
        _payload: args.payload as any,
      } as any);
      if (error) throw new Error(mapTemplateError(error.message));
      return data as unknown as string;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["workspace-adoption-templates", workspaceId] });
      qc.invalidateQueries({ queryKey: ["adoption-template-preview", workspaceId, vars.templateId] });
    },
  });
}

export function useArchiveAdoptionTemplate(workspaceId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { templateId: string }) => {
      const { error } = await supabase.rpc("archive_adoption_template", { _template_id: args.templateId } as any);
      if (error) throw new Error(mapTemplateError(error.message));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workspace-adoption-templates", workspaceId] });
    },
  });
}

export type GenerateFromSavedArgs = {
  templateId: string | null;
  templateKey?: string;
  phaseName: string;
  phaseStartDate?: string | null;
  phaseEndDate?: string | null;
  selectedTaskKeys: string[];
  customTasks: AdoptionCustomTaskInput[];
};

export function useGenerateProjectAdoptionPlanFromSavedTemplate(projectId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: GenerateFromSavedArgs) => {
      if (!projectId) throw new Error("No project ID");
      const phaseName = (args.phaseName || "Adoption & Readiness").trim();
      const customTasks = (args.customTasks ?? [])
        .map((c) => ({
          initiative_key: c.initiativeKey,
          title: (c.title ?? "").trim(),
          description: c.description?.trim() || null,
        }))
        .filter((c) => c.title.length > 0 && c.initiative_key);
      const selection = {
        selected_task_keys: args.selectedTaskKeys ?? [],
        custom_tasks: customTasks,
      };
      const { data, error } = await supabase.rpc(
        "generate_project_adoption_plan_from_saved_template",
        {
          _project_id: projectId,
          _template_id: args.templateId ?? null,
          _template_key: args.templateKey ?? "btpm_standard_adoption",
          _phase_name: phaseName,
          _phase_start_date: args.phaseStartDate ?? null,
          _phase_end_date: args.phaseEndDate ?? null,
          _selection: selection as any,
        } as any,
      );
      if (error) {
        const friendly = mapGenerateError(error.message);
        const e = new Error(friendly);
        (e as any).original = error;
        throw e;
      }
      return data;
    },
    onSuccess: () => {
      if (!projectId) return;
      qc.invalidateQueries({ queryKey: ["project-adoption-substrate", projectId] });
      qc.invalidateQueries({ queryKey: ["project-adoption-template-preview", projectId] });
      qc.invalidateQueries({ queryKey: ["project-phases", projectId] });
      qc.invalidateQueries({ queryKey: ["project-tasks", projectId] });
      qc.invalidateQueries({ queryKey: ["project-activity-events", projectId] });
      qc.invalidateQueries({ queryKey: ["project", projectId] });
    },
  });
}

// =====================================================================
// CM.7D — Add tasks from template into an existing Adoption Plan
// =====================================================================

export type AddAdoptionTemplateTasksArgs = {
  templateId: string | null;
  templateKey?: string;
  selectedTaskKeys: string[];
};

export type AddAdoptionTemplateTasksResult = {
  project_id: string;
  adoption_plan_id: string;
  phase_id: string;
  template_id: string | null;
  template_key: string | null;
  created_initiative_count: number;
  created_task_count: number;
  skipped_duplicate_count: number;
};

function mapAddTasksError(raw: string): string {
  const m = (raw || "").toLowerCase();
  if (m.includes("adoption_plan_required")) return "This project does not have an active Adoption Plan.";
  if (m.includes("adoption_phase_not_found"))
    return "Could not find this project's Adoption phase. Add the Adoption phase in Planning before adding tasks.";
  if (m.includes("adoption_phase_dates_required_for_baselined_project"))
    return "This project is baselined, so added Adoption tasks need planned dates. Set dates on the Adoption phase in Planning before adding tasks.";
  if (m.includes("adoption_template_selection_empty")) return "Select at least one task to add.";
  if (m.includes("invalid_template")) return "Template not found.";
  if (m.includes("invalid_template_key")) return "Unknown template.";
  if (m.includes("forbidden")) return "You do not have permission to add Adoption tasks for this project.";
  if (m.includes("not_authenticated")) return "Your session is no longer active. Please sign in again.";
  return "Could not add the selected tasks to the Adoption Plan.";
}

export function useAddAdoptionTemplateTasksToExistingPlan(projectId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: AddAdoptionTemplateTasksArgs): Promise<AddAdoptionTemplateTasksResult> => {
      if (!projectId) throw new Error("No project ID");
      const { data, error } = await supabase.rpc("add_adoption_template_tasks_to_existing_plan", {
        _project_id: projectId,
        _template_id: args.templateId ?? null,
        _template_key: args.templateKey ?? "btpm_standard_adoption",
        _selected_task_keys: args.selectedTaskKeys ?? [],
      } as any);
      if (error) throw new Error(mapAddTasksError(error.message));
      return data as unknown as AddAdoptionTemplateTasksResult;
    },
    onSuccess: () => {
      if (!projectId) return;
      qc.invalidateQueries({ queryKey: ["project-adoption-substrate", projectId] });
      qc.invalidateQueries({ queryKey: ["project-tasks", projectId] });
      qc.invalidateQueries({ queryKey: ["project-phases", projectId] });
      qc.invalidateQueries({ queryKey: ["project-activity-events", projectId] });
    },
  });
}
