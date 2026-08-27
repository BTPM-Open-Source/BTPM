/**
 * SP.3a — Mutation hooks for SharePoint project bindings.
 *
 * No Microsoft Graph calls. No live validation. All writes go through
 * the SP.2 SECURITY DEFINER RPCs which enforce authority server-side.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  disableProjectBinding,
  upsertProjectBinding,
} from "@/lib/sharepointBindingService";
import type {
  SharepointProjectBinding,
  UpsertProjectBindingInput,
} from "@/lib/sharepointBindingTypes";

export function useUpsertProjectBinding(projectId: string | undefined) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (input: UpsertProjectBindingInput): Promise<SharepointProjectBinding> => {
      return await upsertProjectBinding(input);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sharepoint-project-binding", projectId] });
      qc.invalidateQueries({ queryKey: ["sharepoint-project-binding-effective", projectId] });
      toast({
        title: "Folder linked",
        description: "Saved as not yet tenant-validated.",
      });
    },
    onError: (e: Error) => {
      toast({
        title: "Could not save link",
        description: e.message,
        variant: "destructive",
      });
    },
  });
}

export function useDisableProjectBinding(projectId: string | undefined) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (bindingId: string): Promise<SharepointProjectBinding> => {
      return await disableProjectBinding(bindingId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sharepoint-project-binding", projectId] });
      qc.invalidateQueries({ queryKey: ["sharepoint-project-binding-effective", projectId] });
      toast({
        title: "Link disabled",
        description: "The folder link has been disabled.",
      });
    },
    onError: (e: Error) => {
      toast({
        title: "Could not disable",
        description: e.message,
        variant: "destructive",
      });
    },
  });
}
