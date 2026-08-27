/**
 * Hooks for the organization-level SharePoint site connection.
 *
 * Phase 4D.14A.7C — the org site row is now a system-maintained
 * compatibility projection derived from the effective Tenant SharePoint
 * integration. Manual upsert/disable hooks have been retired; the
 * projection is synchronized by the SharePoint Test Connection edge
 * function.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  getOrgSite,
  validateOrgSite,
} from "@/lib/sharepointOrgSiteService";

export function useOrgSite(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["sharepoint-org-site", organizationId],
    queryFn: () => getOrgSite(organizationId as string),
    enabled: !!organizationId,
  });
}

export function useValidateOrgSite(organizationId: string | undefined) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: (connectionId: string) => validateOrgSite(connectionId),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["sharepoint-org-site", organizationId] });
      const ok = data.result.status === "validated";
      toast({
        title: ok ? "Site validated" : "Validation failed",
        description: data.result.note,
        variant: ok ? "default" : "destructive",
      });
    },
    onError: (e: Error) => {
      toast({ title: "Validation failed", description: e.message, variant: "destructive" });
    },
  });
}
