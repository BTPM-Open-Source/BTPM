// PPT-2 — Latest generated Weekly Project Status Deck lookup.
// Source-of-truth: generated_operational_documents (no separate deck table).

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface LatestProjectStatusDeck {
  id: string;
  output_filename: string;
  generated_at: string;
  sharepoint_web_url: string | null;
  sharepoint_publish_status: string | null;
  generation_status: string;
}

export function useLatestProjectStatusDeck(projectId: string | undefined) {
  return useQuery({
    queryKey: ["generated-operational-docs", projectId, "weekly_project_status_deck", "latest"],
    enabled: !!projectId,
    queryFn: async (): Promise<LatestProjectStatusDeck | null> => {
      const { data, error } = await supabase
        .from("generated_operational_documents")
        .select(
          "id, output_filename, generated_at, sharepoint_web_url, sharepoint_publish_status, generation_status",
        )
        .eq("project_id", projectId!)
        .eq("document_type", "weekly_project_status_deck")
        .order("generated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as LatestProjectStatusDeck | null) ?? null;
    },
  });
}
