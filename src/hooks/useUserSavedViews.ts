/**
 * useUserSavedViews — server-backed private saved views (per-user).
 *
 * Mirrors the local `useSavedViews` contract so existing UIs (SavedViewsControl)
 * can switch to a server-backed source without code changes. Saved views live
 * in `public.user_saved_views` (encrypted name + state_payload), accessed only
 * through SECURITY DEFINER RPCs scoped to the authenticated user.
 *
 * Saved views captured here:
 *   - persist across logout/login
 *   - are private to the authenticated user (never shared)
 *   - never duplicate reporting truth — they store filter/view state only
 */
import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { SavedView } from "@/hooks/useSavedViews";

export interface UseUserSavedViewsOptions<T> {
  surfaceKey: string;
  scopeKey?: string;
  /** Optional client-side validation of the decoded state payload. */
  validate?: (raw: unknown) => raw is T;
  enabled?: boolean;
}

export interface UseUserSavedViewsReturn<T> {
  views: SavedView<T>[];
  isLoading: boolean;
  isError: boolean;
  saveView: (name: string, state: T) => Promise<SavedView<T> | null>;
  applyView: (id: string) => SavedView<T> | null;
  renameView: (id: string, name: string) => Promise<void>;
  deleteView: (id: string) => Promise<void>;
  refetch: () => Promise<unknown>;
}

interface RpcRow {
  id: string;
  name: string;
  state: unknown;
  created_at: string;
  updated_at: string;
}

const buildKey = (surface: string, scope: string) => [
  "user-saved-views",
  surface,
  scope,
] as const;

export function useUserSavedViews<T>(
  options: UseUserSavedViewsOptions<T>,
): UseUserSavedViewsReturn<T> {
  const { surfaceKey, scopeKey = "global", validate, enabled = true } = options;
  const qc = useQueryClient();
  const queryKey = buildKey(surfaceKey, scopeKey);

  const query = useQuery({
    queryKey,
    enabled,
    queryFn: async (): Promise<SavedView<T>[]> => {
      const { data, error } = await supabase.rpc("list_user_saved_views", {
        _surface_key: surfaceKey,
        _scope_key: scopeKey,
      });
      if (error) throw error;
      const rows = (Array.isArray(data) ? data : []) as unknown as RpcRow[];
      return rows
        .filter((r) => (validate ? validate(r.state) : true))
        .map((r) => ({
          id: r.id,
          name: r.name,
          state: r.state as T,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        }));
    },
  });

  const upsertMutation = useMutation({
    mutationFn: async (input: { id: string | null; name: string; state: T }) => {
      const { data, error } = await supabase.rpc("upsert_user_saved_view", {
        _id: input.id,
        _surface_key: surfaceKey,
        _scope_key: scopeKey,
        _name: input.name,
        _state: input.state as never,
      });
      if (error) throw error;
      const r = data as unknown as RpcRow;
      const view: SavedView<T> = {
        id: r.id,
        name: r.name,
        state: r.state as T,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      };
      return view;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("delete_user_saved_view", { _id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
    },
  });

  const views = query.data ?? [];

  const saveView = useCallback(
    async (name: string, state: T) => {
      const trimmed = name.trim();
      if (!trimmed) return null;
      try {
        return await upsertMutation.mutateAsync({ id: null, name: trimmed, state });
      } catch {
        return null;
      }
    },
    [upsertMutation],
  );

  const applyView = useCallback(
    (id: string) => views.find((v) => v.id === id) ?? null,
    [views],
  );

  const renameView = useCallback(
    async (id: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const existing = views.find((v) => v.id === id);
      if (!existing) return;
      await upsertMutation.mutateAsync({ id, name: trimmed, state: existing.state });
    },
    [views, upsertMutation],
  );

  const deleteView = useCallback(
    async (id: string) => {
      await deleteMutation.mutateAsync(id);
    },
    [deleteMutation],
  );

  return useMemo(
    () => ({
      views,
      isLoading: query.isLoading,
      isError: query.isError,
      saveView,
      applyView,
      renameView,
      deleteView,
      refetch: query.refetch,
    }),
    [views, query.isLoading, query.isError, query.refetch, saveView, applyView, renameView, deleteView],
  );
}
