// Phase 6C.FILE-R1a — Latest generated Project Closure Report lookup.
// Source-of-truth: generated_operational_documents history (no separate
// closure-report table). Returns the latest successful generation event
// including SharePoint publish metadata so the card can offer "Open
// existing" without fetching file bytes.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface LatestProjectClosureReport {
  id: string;
  output_filename: string;
  generated_at: string;
  generated_by: string | null;
  generated_by_name: string | null;
  sharepoint_web_url: string | null;
  sharepoint_publish_status: string | null;
  generation_status: string;
}

export function useLatestProjectClosureReport(projectId: string | undefined) {
  return useQuery({
    queryKey: [
      "generated-operational-docs",
      projectId,
      "project_closure_report",
      "latest",
    ],
    enabled: !!projectId,
    queryFn: async (): Promise<LatestProjectClosureReport | null> => {
      const { data, error } = await supabase
        .from("generated_operational_documents")
        .select(
          "id, output_filename, generated_at, generated_by, sharepoint_web_url, sharepoint_publish_status, generation_status",
        )
        .eq("project_id", projectId!)
        .eq("document_type", "project_closure_report")
        .eq("generation_status", "generated_local")
        .order("generated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;

      let generatedByName: string | null = null;
      if (data.generated_by) {
        const { data: profile } = await supabase.rpc("get_decrypted_profile", {
          _user_id: data.generated_by,
        });
        const p = profile as
          | { display_name?: string | null; email?: string | null }
          | null;
        generatedByName = p?.display_name ?? p?.email ?? null;
      }

      return { ...(data as any), generated_by_name: generatedByName };
    },
  });
}
