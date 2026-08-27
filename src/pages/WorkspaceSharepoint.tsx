/**
 * Workspace SharePoint surface — read-only operational view.
 *
 * Workspace ↔ library binding configuration is Org-Admin-only and lives in
 * Admin → SharePoint. This page only shows the connection state and links.
 */

import { useOutletContext } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Info,
  Shield,
} from "lucide-react";
import { useWorkspaceBinding } from "@/hooks/useSharepointBindings";
import { SharepointWorkspaceBindingStatusBadge } from "@/components/sharepoint/SharepointWorkspaceBindingStatusBadge";
import { KnowledgeLink } from "@/components/knowledge/KnowledgeLink";

interface OutletCtx {
  workspace?: { id: string; organization_id: string; name: string };
}

export default function WorkspaceSharepoint({ workspaceId: workspaceIdProp }: { workspaceId?: string } = {}) {
  const ctx = (useOutletContext<OutletCtx>() as OutletCtx | undefined) ?? {};
  const ctxWorkspace = ctx.workspace;
  const effectiveWorkspaceId = workspaceIdProp ?? ctxWorkspace?.id;

  const { data: fetched } = useQuery({
    queryKey: ["workspace-decrypted", effectiveWorkspaceId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_decrypted_workspace", { _workspace_id: effectiveWorkspaceId! });
      if (error) throw error;
      return data as any;
    },
    enabled: !!effectiveWorkspaceId && !ctxWorkspace,
  });
  const workspace = ctxWorkspace ?? fetched;
  const workspaceId = workspace?.id ?? effectiveWorkspaceId;

  const { data: binding, isLoading } = useWorkspaceBinding(workspaceId);
  const isActive = !!binding && binding.binding_status !== "disabled";

  if (isLoading || !workspace) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">SharePoint</h2>
        <p className="text-sm text-muted-foreground mt-1">
          This workspace's connected SharePoint document library on the BTPM site.
        </p>
        <div className="mt-2">
          <KnowledgeLink slug="sharepoint-file-management-placeholder" label="How SharePoint works in BTPM" />
        </div>
      </div>

      <Alert>
        <Shield className="h-4 w-4" />
        <AlertTitle>Managed by Org Admin</AlertTitle>
        <AlertDescription className="text-xs">
          The SharePoint library connection for this workspace is configured by an
          Org Admin in <span className="font-medium">Admin → SharePoint</span>. Ask
          an Org Admin if changes are needed.
        </AlertDescription>
      </Alert>

      {!isActive && (
        <Card>
          <CardContent className="py-10 text-center space-y-2">
            <p className="font-medium text-foreground">No SharePoint library connected</p>
            <p className="text-sm text-muted-foreground">
              An Org Admin can connect this workspace to a SharePoint library from
              Admin → SharePoint.
            </p>
          </CardContent>
        </Card>
      )}

      {binding && isActive && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <CardTitle className="text-base">Connected library</CardTitle>
              <SharepointWorkspaceBindingStatusBadge status={binding.binding_status} />
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {binding.binding_status === "validated" && (
              <Alert className="border-emerald-500/30">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <AlertDescription className="text-xs">
                  {binding.last_validation_note ||
                    "Validated against live SharePoint."}
                </AlertDescription>
              </Alert>
            )}
            {binding.binding_status === "invalid" && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Validation failed</AlertTitle>
                <AlertDescription className="text-xs">
                  {binding.last_validation_note ||
                    "Live validation failed. Contact your Org Admin."}
                </AlertDescription>
              </Alert>
            )}
            {binding.binding_status === "configured_unvalidated" && (
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  Configured but not yet validated. An Org Admin can validate it from
                  Admin → SharePoint.
                </AlertDescription>
              </Alert>
            )}

            <div className="grid gap-3 text-sm">
              <Row label="Site">
                <span className="text-foreground">
                  {binding.site_label_or_name || binding.site_web_url}
                </span>
              </Row>
              <Row label="Library">
                <span className="text-foreground">
                  {binding.library_label_or_name || binding.library_web_url}
                </span>
              </Row>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <a
                  href={binding.library_web_url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open library in SharePoint
                  <ExternalLink className="h-3.5 w-3.5 ml-1" />
                </a>
              </Button>
              <Button asChild variant="ghost" size="sm">
                <a
                  href={binding.site_web_url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open site
                  <ExternalLink className="h-3.5 w-3.5 ml-1" />
                </a>
              </Button>
            </div>

            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription className="text-xs">
                SharePoint permissions are managed outside BTPM. If users can't open
                a folder, contact your SharePoint administrator.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-2">
      <span className="text-muted-foreground">{label}</span>
      <div>{children}</div>
    </div>
  );
}
