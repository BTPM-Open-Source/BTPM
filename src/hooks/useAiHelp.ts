import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface AiHelpConversation {
  id: string;
  title: string | null;
  context_route: string | null;
  context_label: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface AiHelpMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  context_route: string | null;
  context_label: string | null;
  source_article_ids: string[];
  created_at: string;
}

export interface AiHelpSource {
  id: string;
  title: string;
  slug: string;
  related_route: string | null;
}

export interface AiHelpChatResult {
  ok: boolean;
  conversation_id: string;
  assistant_message?: { id: string; content: string; source_article_ids: string[] };
  sources?: AiHelpSource[];
  error?: string;
}

export const aiHelpKeys = {
  conversations: ["ai-help", "conversations"] as const,
  messages: (id: string | null) => ["ai-help", "messages", id ?? "none"] as const,
};

export function useAiHelpConversations(enabled = true) {
  return useQuery({
    queryKey: aiHelpKeys.conversations,
    queryFn: async (): Promise<AiHelpConversation[]> => {
      const { data, error } = await supabase.rpc("ai_help_list_conversations", { _include_archived: false });
      if (error) throw error;
      return (data ?? []) as AiHelpConversation[];
    },
    enabled,
  });
}

export function useAiHelpMessages(conversationId: string | null) {
  return useQuery({
    queryKey: aiHelpKeys.messages(conversationId),
    queryFn: async (): Promise<AiHelpMessage[]> => {
      if (!conversationId) return [];
      const { data, error } = await supabase.rpc("ai_help_list_messages", { _conversation_id: conversationId });
      if (error) throw error;
      return (data ?? []) as AiHelpMessage[];
    },
    enabled: !!conversationId,
  });
}

export function useSendAiHelpMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      conversation_id?: string | null;
      message: string;
      context_route?: string | null;
      context_label?: string | null;
    }): Promise<AiHelpChatResult> => {
      const { data, error } = await supabase.functions.invoke("ai-help-chat", {
        body: {
          conversation_id: input.conversation_id || undefined,
          message: input.message,
          context_route: input.context_route || undefined,
          context_label: input.context_label || undefined,
        },
      });
      if (error) {
        const fallback = (data as AiHelpChatResult | null)?.error || error.message || "BTPM Guide could not answer.";
        return { ok: false, conversation_id: input.conversation_id || "", error: fallback };
      }
      return data as AiHelpChatResult;
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: aiHelpKeys.conversations });
      if (res?.conversation_id) {
        qc.invalidateQueries({ queryKey: aiHelpKeys.messages(res.conversation_id) });
      }
    },
  });
}

export function useArchiveAiHelpConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("ai_help_archive_conversation", { _conversation_id: id });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: aiHelpKeys.conversations }),
  });
}
