/**
 * Phase 6C — Step 6C.6 — Lessons Learned document metadata hooks.
 *
 * Non-visual data-access surface for Step 6C.7 UI. All access flows
 * through protected server-side paths:
 *   - read:    RPC `get_decrypted_project_lessons_learned_document`
 *   - create:  edge function `create-project-lessons-learned-document`
 *   - refresh: edge function `refresh-project-lessons-learned-document-metadata`
 *
 * No raw table selects; encrypted columns are never fetched client-side.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export type ProjectLessonsLearnedStatus =
  | "not_created"
  | "available"
  | "missing_folder"
  | "creation_failed"
  | "link_broken";

export interface ProjectLessonsLearnedDocument {
  id: string;
  organization_id: string;
  workspace_id: string;
  project_id: string;
  document_name: string | null;
  sharepoint_web_url: string | null;
  sharepoint_drive_id: string | null;
  sharepoint_item_id: string | null;
  created_in_sharepoint_at: string | null;
  last_modified_at: string | null;
  status: ProjectLessonsLearnedStatus;
  created_by: string | null;
  metadata_refreshed_at: string | null;
  created_at: string;
  updated_at: string;
}

export function useProjectLessonsLearnedDocument(projectId: string | undefined) {
  return useQuery({
    queryKey: ["project-lessons-learned-document", projectId],
    enabled: !!projectId,
    queryFn: async (): Promise<ProjectLessonsLearnedDocument | null> => {
      if (!projectId) return null;
      const { data, error } = await (supabase.rpc as any)(
        "get_decrypted_project_lessons_learned_document",
        { _project_id: projectId },
      );
      if (error) throw error;
      const rows = (data as ProjectLessonsLearnedDocument[] | null) ?? [];
      return rows.length > 0 ? rows[0] : null;
    },
    staleTime: 30_000,
  });
}

export interface LessonsLearnedActionResult {
  status: ProjectLessonsLearnedStatus;
  reused?: boolean;
  document?: {
    name: string;
    web_url: string;
    item_id: string;
    drive_id: string;
    last_modified_at: string | null;
  };
  error?: string;
  note?: string;
  // Phase 6D.7D — additive Portfolio provenance.
  project_portfolio?: {
    portfolio_item_id: string | null;
    portfolio_name: string | null;
    portfolio_code: string | null;
    portfolio_lifecycle_state: string | null;
    portfolio_is_archived: boolean | null;
    portfolio_label: string | null;
  };
}

export function useCreateProjectLessonsLearnedDocument(
  projectId: string | undefined,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<LessonsLearnedActionResult> => {
      if (!projectId) throw new Error("projectId required");
      const { data, error } = await supabase.functions.invoke(
        "create-project-lessons-learned-document",
        { body: { projectId } },
      );
      if (error) {
        // Try to surface the JSON body from a non-2xx response.
        let payload: any = null;
        try {
          const ctx = (error as any).context;
          if (ctx?.json) payload = await ctx.json();
          else if (ctx?.body) payload = JSON.parse(ctx.body);
        } catch { /* ignore */ }
        const message =
          payload?.note || payload?.error || (error as Error).message ||
          "Failed to create Lessons Learned document";
        throw new Error(message);
      }
      return data as LessonsLearnedActionResult;
    },
    onSuccess: (result) => {
      qc.invalidateQueries({
        queryKey: ["project-lessons-learned-document", projectId],
      });
      if (result.status === "available") {
        toast.success(
          result.reused
            ? "Lessons Learned document already exists — reusing it."
            : "Lessons Learned document created in SharePoint.",
        );
      } else if (result.status === "missing_folder") {
        toast.error(
          result.note ||
            "The project SharePoint folder is not linked or not validated.",
        );
      } else if (result.status === "creation_failed") {
        toast.error(result.note || "Could not create the Lessons Learned document.");
      }
    },
    onError: (err: any) => {
      toast.error(err?.message ?? "Failed to create Lessons Learned document");
    },
  });
}

export function useRefreshProjectLessonsLearnedDocumentMetadata(
  projectId: string | undefined,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<LessonsLearnedActionResult> => {
      if (!projectId) throw new Error("projectId required");
      const { data, error } = await supabase.functions.invoke(
        "refresh-project-lessons-learned-document-metadata",
        { body: { projectId } },
      );
      if (error) {
        let payload: any = null;
        try {
          const ctx = (error as any).context;
          if (ctx?.json) payload = await ctx.json();
          else if (ctx?.body) payload = JSON.parse(ctx.body);
        } catch { /* ignore */ }
        const message =
          payload?.note || payload?.error || (error as Error).message ||
          "Failed to refresh Lessons Learned metadata";
        throw new Error(message);
      }
      return data as LessonsLearnedActionResult;
    },
    onSuccess: (result) => {
      qc.invalidateQueries({
        queryKey: ["project-lessons-learned-document", projectId],
      });
      if (result.status === "link_broken") {
        toast.error("The linked Lessons Learned document could not be found in SharePoint.");
      } else if (result.status === "available") {
        toast.success("Lessons Learned metadata refreshed.");
      }
    },
    onError: (err: any) => {
      toast.error(err?.message ?? "Failed to refresh Lessons Learned metadata");
    },
  });
}
