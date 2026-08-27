/**
 * SP.3b — Mutation hooks for SharePoint *workspace* bindings.
 *
 * All authority is enforced server-side via SP.2 SECURITY DEFINER RPCs.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  disableWorkspaceBinding,
  upsertWorkspaceBinding,
} from "@/lib/sharepointBindingService";
import type {
  SharepointWorkspaceBinding,
  UpsertWorkspaceBindingInput,
} from "@/lib/sharepointBindingTypes";

export function useUpsertWorkspaceBinding(workspaceId: string | undefined) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: (input: UpsertWorkspaceBindingInput): Promise<SharepointWorkspaceBinding> =>
      upsertWorkspaceBinding(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sharepoint-workspace-binding", workspaceId] });
      qc.invalidateQueries({ queryKey: ["sharepoint-workspace-bindings"] });
      toast({
        title: "Saved",
        description: "Saved as not yet tenant-validated. Run Validate to confirm.",
      });
    },
    onError: (e: Error) => {
      toast({ title: "Could not save", description: e.message, variant: "destructive" });
    },
  });
}

export function useDisableWorkspaceBinding(workspaceId: string | undefined) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: (bindingId: string) => disableWorkspaceBinding(bindingId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sharepoint-workspace-binding", workspaceId] });
      qc.invalidateQueries({ queryKey: ["sharepoint-workspace-bindings"] });
      toast({ title: "Binding disabled" });
    },
    onError: (e: Error) => {
      toast({ title: "Could not disable", description: e.message, variant: "destructive" });
    },
  });
}
