// AI-GUIDE.V2-FB.1
// Step 0.9A — user-side hooks for BTPM Guide message feedback.
// Reuses existing ai_help_* substrate; feedback lives in
// public.ai_help_message_feedback and is linked to assistant messages.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type GuideFeedbackRating = "helpful" | "not_helpful";

export interface GuideFeedbackRow {
  id: string;
  assistant_message_id: string;
  rating: GuideFeedbackRating;
  reason_code: string | null;
  comment: string | null;
  created_at: string;
  updated_at: string;
}

export const aiHelpFeedbackKeys = {
  forConversation: (id: string | null) =>
    ["ai-help", "feedback", id ?? "none"] as const,
};

export function useAiHelpMessageFeedback(conversationId: string | null) {
  return useQuery({
    queryKey: aiHelpFeedbackKeys.forConversation(conversationId),
    queryFn: async (): Promise<Record<string, GuideFeedbackRow>> => {
      if (!conversationId) return {};
      const { data, error } = await supabase.rpc(
        "ai_help_list_my_feedback_for_conversation",
        { _conversation_id: conversationId },
      );
      if (error) throw error;
      const map: Record<string, GuideFeedbackRow> = {};
      for (const row of (data ?? []) as GuideFeedbackRow[]) {
        map[row.assistant_message_id] = row;
      }
      return map;
    },
    enabled: !!conversationId,
  });
}

export function useUpsertAiHelpMessageFeedback(conversationId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      assistant_message_id: string;
      rating: GuideFeedbackRating;
      reason_code?: string | null;
      comment?: string | null;
    }): Promise<GuideFeedbackRow | null> => {
      const { data, error } = await supabase.rpc(
        "ai_help_upsert_message_feedback",
        {
          _assistant_message_id: input.assistant_message_id,
          _rating: input.rating,
          _reason_code: input.reason_code ?? null,
          _comment: input.comment ?? null,
        },
      );
      if (error) throw error;
      const rows = (data ?? []) as GuideFeedbackRow[];
      return rows[0] ?? null;
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: aiHelpFeedbackKeys.forConversation(conversationId),
      });
    },
  });
}
