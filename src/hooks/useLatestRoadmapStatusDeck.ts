// RM-PPT-2 — Latest generated Roadmap Status Deck for a single workspace.
// Source-of-truth: generated_operational_documents.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface LatestRoadmapStatusDeck {
  id: string;
  output_filename: string;
  generated_at: string;
  sharepoint_web_url: string | null;
  sharepoint_publish_status: string | null;
  generation_status: string;
  workspace_id: string | null;
}

export function useLatestRoadmapStatusDeck(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["generated-operational-docs", "roadmap_status_deck", "latest", workspaceId ?? null],
    enabled: !!workspaceId,
    queryFn: async (): Promise<LatestRoadmapStatusDeck | null> => {
      const { data, error } = await supabase
        .from("generated_operational_documents")
        .select(
          "id, output_filename, generated_at, sharepoint_web_url, sharepoint_publish_status, generation_status, workspace_id",
        )
        .is("project_id", null)
        .eq("workspace_id", workspaceId!)
        .eq("document_type", "roadmap_status_deck")
        .order("generated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as LatestRoadmapStatusDeck | null) ?? null;
    },
  });
}
