// AI-GUIDE.V2-HISTORY.1
// Client hook for the user-facing BTPM Guide drawer running V2.
// Reuses the existing ai_help_* persistence backend (conversations,
// messages, RPCs) instead of introducing a new V2-specific store. V1
// architecture has been retired; we keep a single conversation history
// store shared with anything else that wrote to ai_help_messages.
//
// Persistence flow per send:
//   1) If no conversation yet, RPC ai_help_create_conversation -> id (+ set title from message).
//   2) RPC ai_help_append_message (role='user').
//   3) Invoke ai-guide-v2-chat (mode=validate_only).
//   4) Sanitize answer via presentNormalGuideAnswer (UX.1).
//   5) RPC ai_help_append_message (role='assistant', source_article_ids).
//   6) Invalidate conversations + messages queries.
//
// Diagnostics, raw chunks, trace metadata are never shown or stored —
// only the user-facing answer and KC source article ids.
import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { AiHelpMessage, AiHelpSource } from "@/hooks/useAiHelp";
import { aiHelpKeys } from "@/hooks/useAiHelp";
import { presentNormalGuideAnswer } from "@/lib/guideV2AnswerPresentation";

interface SendInput {
  message: string;
  context_route?: string | null;
  context_label?: string | null;
}

const SAFE_FALLBACK =
  "BTPM Guide could not answer this right now. Please try again or check the Knowledge Center.";

interface GuideV2ApiArticle {
  article_id: string;
  title: string;
  slug: string;
  related_route?: string | null;
}

function dedupeSources(arts: GuideV2ApiArticle[]): AiHelpSource[] {
  const seen = new Set<string>();
  const out: AiHelpSource[] = [];
  for (const a of arts) {
    if (!a?.article_id || seen.has(a.article_id)) continue;
    seen.add(a.article_id);
    out.push({
      id: a.article_id,
      title: a.title,
      slug: a.slug,
      related_route: a.related_route ?? null,
    });
  }
  return out;
}

function deriveTitle(message: string): string {
  const t = message.trim().replace(/\s+/g, " ");
  if (t.length <= 60) return t;
  return t.slice(0, 57) + "…";
}

export interface GuideV2MessageDiagnostics {
  request_id: string | null;
  version: string | null;
  answer_mode: string | null;
  workflow_id: string | null;
  fail_closed: boolean | null;
  regenerated: boolean | null;
  invariant_replacement_applied: boolean | null;
  final_source_titles: string[];
  response_source: "v2_pipeline_final" | "safe_fallback" | "edge_function_error";
}

export interface UseGuideV2ChatResult {
  conversationId: string | null;
  setConversationId: (id: string | null) => void;
  messages: AiHelpMessage[];
  isLoadingMessages: boolean;
  isPending: boolean;
  error: string | null;
  latestSources: Record<string, AiHelpSource[]>;
  diagnostics: Record<string, GuideV2MessageDiagnostics>;
  send: (input: SendInput) => void;
  reset: () => void;
}

export function useGuideV2Chat(): UseGuideV2ChatResult {
  const qc = useQueryClient();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [latestSources, setLatestSources] = useState<Record<string, AiHelpSource[]>>({});
  const [diagnostics, setDiagnostics] = useState<Record<string, GuideV2MessageDiagnostics>>({});

  const messagesQuery = useQuery({
    queryKey: aiHelpKeys.messages(conversationId),
    queryFn: async (): Promise<AiHelpMessage[]> => {
      if (!conversationId) return [];
      const { data, error: e } = await supabase.rpc("ai_help_list_messages", {
        _conversation_id: conversationId,
      });
      if (e) throw e;
      return (data ?? []) as AiHelpMessage[];
    },
    enabled: !!conversationId,
  });

  const sendMut = useMutation({
    mutationFn: async (input: SendInput) => {
      const trimmed = input.message.trim();
      if (!trimmed) throw new Error("Empty message");

      let convId = conversationId;
      if (!convId) {
        const { data: newId, error: createErr } = await supabase.rpc(
          "ai_help_create_conversation",
          {
            _context_route: input.context_route ?? null,
            _context_label: input.context_label ?? null,
            _title: deriveTitle(trimmed),
          },
        );
        if (createErr) throw createErr;
        convId = newId as string;
      }

      // 1. Persist user turn
      const { error: userErr } = await supabase.rpc("ai_help_append_message", {
        _conversation_id: convId,
        _role: "user",
        _content: trimmed,
        _context_route: input.context_route ?? null,
        _context_label: input.context_label ?? null,
        _source_article_ids: [],
      });
      if (userErr) throw userErr;

      // 2. Call V2 pipeline
      const { data, error: fnErr } = await supabase.functions.invoke("ai-guide-v2-chat", {
        body: {
          question: trimmed,
          context_route: input.context_route ?? null,
          context_label: input.context_label ?? null,
          mode: "validate_only",
        },
      });

      let answerText = SAFE_FALLBACK;
      let sources: AiHelpSource[] = [];
      let diag: GuideV2MessageDiagnostics = {
        request_id: null,
        version: null,
        answer_mode: null,
        workflow_id: null,
        fail_closed: null,
        regenerated: null,
        invariant_replacement_applied: null,
        final_source_titles: [],
        response_source: "edge_function_error",
      };
      if (!fnErr && data) {
        const payload = data as {
          ok?: boolean;
          version?: string | null;
          request_id?: string | null;
          final_answer?: string | null;
          fail_closed?: boolean | null;
          regenerated?: boolean | null;
          pipeline_invariants?: { hard_block_final_return?: boolean | null } | null;
          routing_result?: { answer_mode?: string | null; workflow_id?: string | null } | null;
          answer_plan?: { answer_mode?: string | null } | null;
          knowledge_pack_effective?: {
            primary_articles?: GuideV2ApiArticle[];
            supporting_articles?: GuideV2ApiArticle[];
          };
          knowledge_pack?: {
            primary_articles?: GuideV2ApiArticle[];
            supporting_articles?: GuideV2ApiArticle[];
          };
        };
        const hasFinal =
          typeof payload.final_answer === "string" && payload.final_answer.trim().length > 0;
        const raw = hasFinal ? (payload.final_answer as string) : SAFE_FALLBACK;
        answerText = presentNormalGuideAnswer({ question: trimmed, answer: raw });
        const pack = payload.knowledge_pack_effective ?? payload.knowledge_pack ?? {};
        sources = dedupeSources([
          ...(pack.primary_articles ?? []),
          ...(pack.supporting_articles ?? []),
        ]).slice(0, 6);
        diag = {
          request_id: payload.request_id ?? null,
          version: payload.version ?? null,
          answer_mode:
            payload.routing_result?.answer_mode ?? payload.answer_plan?.answer_mode ?? null,
          workflow_id: payload.routing_result?.workflow_id ?? null,
          fail_closed: payload.fail_closed ?? null,
          regenerated: payload.regenerated ?? null,
          invariant_replacement_applied:
            payload.pipeline_invariants?.hard_block_final_return ?? null,
          final_source_titles: sources.map((s) => s.title),
          response_source: hasFinal ? "v2_pipeline_final" : "safe_fallback",
        };
        // Admin-only correlation breadcrumb. Lets a sidecar answer be matched
        // back to the exact Admin Pipeline Trace request_id + version.
        // eslint-disable-next-line no-console
        console.debug("[BTPM Guide][sidecar]", diag);
      }

      // 3. Persist assistant turn — answer text and sources come from the
      // SAME response object above. They are written atomically here.
      const { data: assistantIdData, error: asstErr } = await supabase.rpc(
        "ai_help_append_message",
        {
          _conversation_id: convId,
          _role: "assistant",
          _content: answerText,
          _context_route: input.context_route ?? null,
          _context_label: input.context_label ?? null,
          _source_article_ids: sources.map((s) => s.id),
        },
      );
      if (asstErr) throw asstErr;

      return {
        conversation_id: convId,
        assistant_message_id: assistantIdData as string,
        sources,
        diagnostics: diag,
      };
    },
    onSuccess: (res) => {
      setConversationId(res.conversation_id);
      if (res.sources?.length) {
        setLatestSources((m) => ({ ...m, [res.assistant_message_id]: res.sources }));
      }
      setDiagnostics((m) => ({ ...m, [res.assistant_message_id]: res.diagnostics }));
      qc.invalidateQueries({ queryKey: aiHelpKeys.conversations });
      qc.invalidateQueries({ queryKey: aiHelpKeys.messages(res.conversation_id) });
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message : "BTPM Guide could not answer.";
      setError(msg);
    },
  });

  const send = useCallback(
    (input: SendInput) => {
      const trimmed = input.message.trim();
      if (!trimmed || sendMut.isPending) return;
      setError(null);
      sendMut.mutate(input);
    },
    [sendMut],
  );

  const reset = useCallback(() => {
    setConversationId(null);
    setError(null);
    setLatestSources({});
    setDiagnostics({});
  }, []);

  const messages = useMemo(() => messagesQuery.data ?? [], [messagesQuery.data]);

  return {
    conversationId,
    setConversationId,
    messages,
    isLoadingMessages: messagesQuery.isLoading,
    isPending: sendMut.isPending,
    error,
    latestSources,
    diagnostics,
    send,
    reset,
  };

}
