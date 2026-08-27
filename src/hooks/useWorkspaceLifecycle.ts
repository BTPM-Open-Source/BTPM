// Wave 5 Step 5.9 — Workspace lifecycle UX hook.
//
// Wraps the Step 5.4 SECURITY DEFINER RPCs `deactivate_workspace` and
// `reactivate_workspace`. Both are Org-Admin-only on the server; the UI
// also gates visibility via `useIsOrgAdmin`.
//
// There is intentionally NO workspace hard-delete RPC — boundary objects
// are never permanently deleted from this UI in Wave 5.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

function invalidateWorkspaceCaches(qc: ReturnType<typeof useQueryClient>, workspaceId: string) {
  qc.invalidateQueries({ queryKey: ["workspace-decrypted", workspaceId] });
  qc.invalidateQueries({ queryKey: ["workspaces"] });
  qc.invalidateQueries({ queryKey: ["roadmap-projects"] });
  qc.invalidateQueries({ queryKey: ["workspace-projects", workspaceId] });
}

export function useDeactivateWorkspace() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (workspaceId: string) => {
      const { error } = await supabase.rpc("deactivate_workspace", {
        _workspace_id: workspaceId,
      });
      if (error) throw error;
      return workspaceId;
    },
    onSuccess: (workspaceId) => {
      toast({
        title: "Workspace deactivated",
        description: "The workspace is now read-only. You can reactivate it at any time.",
      });
      invalidateWorkspaceCaches(qc, workspaceId);
    },
    onError: (err: any) => {
      toast({
        title: "Could not deactivate workspace",
        description: err?.message ?? "Unknown error",
        variant: "destructive",
      });
    },
  });
}

export function useReactivateWorkspace() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (workspaceId: string) => {
      const { error } = await supabase.rpc("reactivate_workspace", {
        _workspace_id: workspaceId,
      });
      if (error) throw error;
      return workspaceId;
    },
    onSuccess: (workspaceId) => {
      toast({
        title: "Workspace reactivated",
        description: "Full read/write access has been restored.",
      });
      invalidateWorkspaceCaches(qc, workspaceId);
    },
    onError: (err: any) => {
      toast({
        title: "Could not reactivate workspace",
        description: err?.message ?? "Unknown error",
        variant: "destructive",
      });
    },
  });
}
