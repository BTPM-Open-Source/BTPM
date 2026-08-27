import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Returns whether the given workspace is the BTPM Demo Workspace.
 * Server is the source of truth (workspaces.is_demo). UI uses this only
 * to badge and to hide mutation controls; RLS still enforces write protection.
 */
export function useIsDemoWorkspace(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["is-demo-workspace", workspaceId],
    enabled: !!workspaceId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      if (!workspaceId) return false;
      const { data, error } = await supabase
        .from("workspaces")
        .select("is_demo")
        .eq("id", workspaceId)
        .maybeSingle();
      if (error) return false;
      return !!data?.is_demo;
    },
  });
}
