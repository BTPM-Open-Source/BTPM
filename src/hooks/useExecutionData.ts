import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { rpcTyped } from "@/lib/entityLinks";
import type { Tables } from "@/integrations/supabase/types";
import { parsePmgCommandResult } from "@/lib/pmg/pmgContract";

// --- Comment References (structured cross-object references) ---
export type CommentReferenceTargetType = "project" | "phase" | "task";

export type CommentReferenceInput = {
  referenced_type: CommentReferenceTargetType;
  referenced_id: string;
  sort_order?: number;
};

export type CommentReference = {
  id: string;
  referenced_type: CommentReferenceTargetType;
  referenced_id: string;
  workspace_id: string;
  project_id: string | null;
  phase_id: string | null;
  display_label: string | null;
  context_label: string | null;
  sort_order: number;
};

export type CommentWithReferences = {
  id: string;
  target_type: string;
  target_id: string;
  author_id: string;
  is_edited: boolean;
  organization_id: string;
  workspace_id: string;
  created_at: string;
  updated_at: string;
  body: string;
  references: CommentReference[];
};

export type ReferenceTargetSearchResult = {
  target_type: CommentReferenceTargetType;
  target_id: string;
  workspace_id: string;
  project_id: string | null;
  phase_id: string | null;
  display_label: string;
  context_label: string | null;
};

// --- Comments (reads via decrypted RPC, writes via atomic protected RPCs) ---
export function useComments(targetType: string, targetId: string | undefined) {
  return useQuery<CommentWithReferences[]>({
    queryKey: ["comments", targetType, targetId],
    queryFn: async () => {
      if (!targetId) throw new Error("No target ID");
      const { data, error } = await rpcTyped<CommentWithReferences[]>(
        "list_decrypted_comments",
        { _target_type: targetType, _target_id: targetId },
      );
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    enabled: !!targetId,
  });
}

export function useCreateComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: {
      body: string;
      target_type: string;
      target_id: string;
      organization_id: string;
      workspace_id: string;
      author_id: string;
      references?: CommentReferenceInput[];
    }) => {
      const { error } = await rpcTyped<{ id: string }>("create_comment_with_references", {
        _body: values.body,
        _target_type: values.target_type,
        _target_id: values.target_id,
        _organization_id: values.organization_id,
        _workspace_id: values.workspace_id,
        _references: values.references ?? [],
      });
      if (error) throw new Error(error.message);
      return { target_type: values.target_type, target_id: values.target_id };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["comments", data.target_type, data.target_id] });
      qc.invalidateQueries({ queryKey: ["comment-mention-email-status", data.target_type, data.target_id] });
    },
  });
}

export function useUpdateComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id, body, target_type, target_id, references,
    }: {
      id: string;
      body: string;
      target_type: string;
      target_id: string;
      references?: CommentReferenceInput[];
    }) => {
      const { error } = await rpcTyped<null>("update_comment_with_references", {
        _comment_id: id,
        _body: body,
        _references: references ?? [],
      });
      if (error) throw new Error(error.message);
      return { id, target_type, target_id };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["comments", data.target_type, data.target_id] });
    },
  });
}

// --- Reference target search (same-workspace, decrypted) ---
export function useReferenceTargetSearch(workspaceId: string | undefined, query: string, enabled: boolean) {
  return useQuery<ReferenceTargetSearchResult[]>({
    queryKey: ["reference-target-search", workspaceId, query],
    queryFn: async () => {
      if (!workspaceId) return [];
      const { data, error } = await rpcTyped<ReferenceTargetSearchResult[]>(
        "search_workspace_reference_targets",
        { _workspace_id: workspaceId, _query: query },
      );
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    enabled: !!workspaceId && enabled,
    staleTime: 15_000,
  });
}

// --- Mention email status per comment (author-only, server-aggregated) ---
export type CommentMentionEmailStatus = {
  comment_id: string;
  status: "queued" | "sent" | "partial" | "failed";
  total_count: number;
  sent_count: number;
  pending_count: number;
  failed_count: number;
  skipped_count: number;
};

export function useCommentMentionEmailStatus(targetType: string, targetId: string | undefined) {
  return useQuery<Record<string, CommentMentionEmailStatus>>({
    queryKey: ["comment-mention-email-status", targetType, targetId],
    queryFn: async () => {
      if (!targetId) return {};
      const { data, error } = await rpcTyped<CommentMentionEmailStatus[]>(
        "get_comment_mention_email_status",
        { _target_type: targetType, _target_id: targetId },
      );
      if (error) throw new Error(error.message);
      const map: Record<string, CommentMentionEmailStatus> = {};
      for (const row of data ?? []) {
        map[row.comment_id] = row;
      }
      return map;
    },
    enabled: !!targetId,
    refetchInterval: 30_000,
  });
}

// --- Execution Updates (reads via decrypted RPC) ---
export interface ExecutionUpdateRow {
  id: string;
  target_type: string;
  target_id: string;
  author_id: string;
  organization_id: string;
  workspace_id: string;
  summary: string;
  status_label: string | null;
  update_date: string;
  created_at: string;
}

export function useExecutionUpdates(targetType: string, targetId: string | undefined) {
  return useQuery<ExecutionUpdateRow[]>({
    queryKey: ["execution-updates", targetType, targetId],
    queryFn: async () => {
      if (!targetId) throw new Error("No target ID");
      const { data, error } = await rpcTyped<ExecutionUpdateRow[]>(
        "list_decrypted_execution_updates",
        { _target_type: targetType, _target_id: targetId },
      );
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    enabled: !!targetId,
  });
}

export function useCreateExecutionUpdate() {
  const qc = useQueryClient();
  return useMutation({
    // NOTE: `organization_id`, `workspace_id`, and `author_id` in this input
    // shape are IGNORED for provenance/authority — the PMG command derives them
    // server-side from the target (phase/task) and `auth.uid()`. The fields are
    // retained here only to preserve the existing caller shape without churn.
    mutationFn: async (values: {
      summary: string;
      status_label?: string | null;
      update_date: string;
      target_type: string;
      target_id: string;
      organization_id?: string;
      workspace_id?: string;
      author_id?: string;
    }) => {
      const { data, error } = await supabase.rpc("append_execution_update", {
        _target_type: values.target_type,
        _target_id: values.target_id,
        _summary: values.summary,
        _update_date: values.update_date,
        _status_label: values.status_label ?? undefined,
      });
      if (error) throw error;
      const result = parsePmgCommandResult(data);
      if (result.status === "applied") {
        return {
          target_type: values.target_type,
          target_id: values.target_id,
        };
      }
      if (result.status === "not_authorized") {
        throw new Error("You do not have permission to record progress here.");
      }
      const reason =
        (result.data as { reason?: string } | null | undefined)?.reason ?? "";
      if (reason === "summary_required") {
        throw new Error("Please enter a summary before saving.");
      }
      if (reason === "invalid_update_date") {
        throw new Error("Please choose a valid update date.");
      }
      if (reason === "invalid_target") {
        throw new Error("This target cannot receive progress entries.");
      }
      throw new Error("Could not save progress entry. Please review and try again.");
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["execution-updates", data.target_type, data.target_id] });
    },
  });
}

// --- Blockers (reads via decrypted RPC) ---
export type BlockerRow = Tables<"blockers">;

export function useBlockers(targetType: string, targetId: string | undefined) {
  return useQuery<BlockerRow[]>({
    queryKey: ["blockers", targetType, targetId],
    queryFn: async () => {
      if (!targetId) throw new Error("No target ID");
      const { data, error } = await rpcTyped<BlockerRow[]>(
        "list_decrypted_blockers",
        { _target_type: targetType, _target_id: targetId },
      );
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    enabled: !!targetId,
  });
}



// --- Activity Events (reads via decrypted RPC) ---
export interface ActivityEventRow {
  id: string;
  event_type: string;
  target_type: string;
  target_id: string;
  actor_id: string | null;
  organization_id: string;
  workspace_id: string | null;
  metadata: string | null;
  created_at: string;
}

export function useActivityEvents(targetType: string, targetId: string | undefined) {
  return useQuery<ActivityEventRow[]>({
    queryKey: ["activity-events", targetType, targetId],
    queryFn: async () => {
      if (!targetId) throw new Error("No target ID");
      const { data, error } = await rpcTyped<ActivityEventRow[]>(
        "list_decrypted_activity_events",
        { _target_type: targetType, _target_id: targetId },
      );
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    enabled: !!targetId,
  });
}
