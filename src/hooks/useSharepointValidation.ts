/**
 * SP.3b — React Query mutations for live SharePoint validation.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  validateProjectBinding,
  validateWorkspaceBinding,
} from "@/lib/sharepointValidationService";

export function useValidateWorkspaceBinding(workspaceId: string | undefined) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: (bindingId: string) => validateWorkspaceBinding(bindingId),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["sharepoint-workspace-binding", workspaceId] });
      qc.invalidateQueries({ queryKey: ["sharepoint-workspace-bindings"] });
      qc.invalidateQueries({ queryKey: ["sharepoint-project-binding-effective"] });
      if (data.result.status === "validated") {
        toast({ title: "Validated", description: data.result.note });
      } else {
        toast({
          title: "Validation failed",
          description: data.result.note,
          variant: "destructive",
        });
      }
    },
    onError: (e: Error) => {
      toast({
        title: "Validation error",
        description: e.message,
        variant: "destructive",
      });
    },
  });
}

export function useValidateProjectBinding(projectId: string | undefined) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: (bindingId: string) => validateProjectBinding(bindingId),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["sharepoint-project-binding", projectId] });
      qc.invalidateQueries({ queryKey: ["sharepoint-project-binding-effective", projectId] });
      if (data.result.status === "validated") {
        toast({ title: "Validated", description: data.result.note });
      } else {
        toast({
          title: "Validation failed",
          description: data.result.note,
          variant: "destructive",
        });
      }
    },
    onError: (e: Error) => {
      toast({
        title: "Validation error",
        description: e.message,
        variant: "destructive",
      });
    },
  });
}
