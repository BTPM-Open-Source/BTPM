import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface TemplateSummaryCounts {
  phases?: number;
  tasks?: number;
  dependencies?: number;
  kpi_definitions?: number;
  workflow_states?: number;
  sprints?: number;
  backlog_items?: number;
}

export interface TemplateListRow {
  template_id: string;
  organization_id: string;
  workspace_id: string;
  source_project_id: string | null;
  name: string | null;
  description: string | null;
  blueprint_version: string;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
  schedule_mode: string | null;
  agile_enabled: boolean;
  summary_counts: TemplateSummaryCounts;
}

export interface TemplateDetail extends TemplateListRow {
  anchor_source?: string | null;
  project_summary?: {
    name?: string | null;
    description?: string | null;
    charter?: string | null;
    goals?: string | null;
    scope_in?: string | null;
    scope_out?: string | null;
    priority?: string | null;
    agile_enabled?: boolean;
  } | null;
}

export function useWorkspaceTemplates(workspaceId: string | undefined, includeArchived: boolean) {
  return useQuery({
    queryKey: ["workspace-templates", workspaceId, includeArchived],
    queryFn: async () => {
      if (!workspaceId) return [];
      const { data, error } = await supabase.rpc("list_project_templates", {
        _workspace_id: workspaceId,
        _include_archived: includeArchived,
      });
      if (error) throw error;
      return (data || []) as unknown as TemplateListRow[];
    },
    enabled: !!workspaceId,
  });
}

export function useProjectTemplateDetail(templateId: string | null) {
  return useQuery({
    queryKey: ["project-template-detail", templateId],
    queryFn: async () => {
      if (!templateId) return null;
      const { data, error } = await supabase.rpc("get_project_template_detail", {
        _template_id: templateId,
      });
      if (error) throw error;
      return data as unknown as TemplateDetail;
    },
    enabled: !!templateId,
  });
}

export function useTemplateMutations(workspaceId: string | undefined) {
  const qc = useQueryClient();

  const invalidate = (templateId?: string) => {
    qc.invalidateQueries({ queryKey: ["workspace-templates", workspaceId] });
    if (templateId) qc.invalidateQueries({ queryKey: ["project-template-detail", templateId] });
  };

  const renameTemplate = useMutation({
    mutationFn: async (input: { templateId: string; name: string; description: string | null }) => {
      const { data, error } = await supabase.rpc("update_project_template_metadata", {
        _template_id: input.templateId,
        _name: input.name,
        _description: input.description,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, vars) => invalidate(vars.templateId),
  });

  // Wave 5 Step 5.5 — route through canonical Step 5.3 lifecycle RPCs.
  // The legacy set_project_template_archived RPC is no longer used as a
  // runtime path; archive/unarchive flow through archive_project_template /
  // unarchive_project_template (PM+ authority, activity-logged).
  const setArchived = useMutation({
    mutationFn: async (input: { templateId: string; isArchived: boolean }) => {
      const rpc = input.isArchived ? "archive_project_template" : "unarchive_project_template";
      const { error } = await (supabase.rpc as any)(rpc, { _id: input.templateId });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => invalidate(vars.templateId),
  });

  return { renameTemplate, setArchived };
}
