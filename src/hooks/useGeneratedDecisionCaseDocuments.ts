// DC.10 — Decision Case generated documents history hook.
// Uses the protected list_generated_decision_case_documents RPC. No direct
// table access for Decision Case generated document history.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type DecisionCaseGeneratedDocType =
  | "decision_case_word_brief"
  | "decision_case_ppt_onepager";

export interface GeneratedDecisionCaseDocument {
  id: string;
  document_type: DecisionCaseGeneratedDocType | string;
  generation_status: "generated_local" | "generation_failed" | string;
  output_filename: string;
  generated_at: string;
  generated_by: string | null;
  source_snapshot_at: string;
  sharepoint_publish_status: "not_published" | "published" | "publish_failed" | null | string;
  sharepoint_item_id: string | null;
  sharepoint_web_url: string | null;
  error_note: string | null;
}

export function useGeneratedDecisionCaseDocuments(
  recordId: string | null | undefined,
  documentType?: DecisionCaseGeneratedDocType,
) {
  return useQuery({
    queryKey: [
      "generated-decision-case-documents",
      recordId ?? "",
      documentType ?? "all",
    ],
    enabled: !!recordId,
    queryFn: async (): Promise<GeneratedDecisionCaseDocument[]> => {
      if (!recordId) return [];
      const { data, error } = await supabase.rpc(
        "list_generated_decision_case_documents" as any,
        {
          _record_id: recordId,
          ...(documentType ? { _document_type: documentType } : {}),
        } as any,
      );
      if (error) throw error;
      return ((data as unknown as GeneratedDecisionCaseDocument[]) ?? []) || [];
    },
  });
}
