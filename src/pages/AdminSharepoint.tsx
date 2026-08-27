/**
 * Admin → SharePoint
 *
 * Org Admin-only canonical surface. Two distinct configuration tasks:
 *
 *   1. Organization SharePoint site — configured ONCE.
 *   2. Workspace library assignments — one library per workspace under that site.
 *
 * Workspace library assignment never re-asks for the site URL: the site is
 * derived from the organization-level connection.
 */

import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Info,
  PowerOff,
  RefreshCw,
  Search,
  Settings2,
  Globe,
  FolderTree,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useWorkspaceBindingsList } from "@/hooks/useSharepointBindings";
import { useDisableWorkspaceBinding } from "@/hooks/useSharepointWorkspaceBindingMutations";
import { useValidateWorkspaceBinding } from "@/hooks/useSharepointValidation";
import {
  useOrgSite,
  useValidateOrgSite,
} from "@/hooks/useSharepointOrgSite";
import { WorkspaceBindingDialog } from "@/components/sharepoint/WorkspaceBindingDialog";
import { SharepointWorkspaceBindingStatusBadge } from "@/components/sharepoint/SharepointWorkspaceBindingStatusBadge";
import { SharepointDiagnosticsPanel } from "@/components/sharepoint/SharepointDiagnosticsPanel";
import type { SharepointWorkspaceBinding } from "@/lib/sharepointBindingTypes";
import type {
  SharepointOrgSiteConnection,
  SharepointOrgSiteStatus,
} from "@/lib/sharepointOrgSiteService";
import { KnowledgeLink } from "@/components/knowledge/KnowledgeLink";

interface OutletCtx {
  organizationId: string;
}

interface WorkspaceRow {
  id: string;
  name: string;
}

function useOrgWorkspaces(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["admin-sharepoint-workspaces", organizationId],
    queryFn: async (): Promise<WorkspaceRow[]> => {
      if (!organizationId) return [];
      const { data, error } = await supabase
        .from("workspaces")
        .select("id, name")
        .eq("organization_id", organizationId)
        .eq("is_active", true)
        .eq("is_archived", false)
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as WorkspaceRow[];
    },
    enabled: !!organizationId,
  });
}

function OrgSiteStatusBadge({ status }: { status: SharepointOrgSiteStatus }) {
  const map: Record<SharepointOrgSiteStatus, { label: string; className: string }> = {
    validated: {
      label: "Validated",
      className: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30 dark:text-emerald-400",
    },
    configured_unvalidated: {
      label: "Not validated",
      className: "bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-400",
    },
    invalid: {
      label: "Invalid",
      className: "bg-destructive/10 text-destructive border-destructive/30",
    },
    disabled: {
      label: "Disconnected",
      className: "bg-muted text-muted-foreground border-border",
    },
  };
  const m = map[status] ?? {
    label: status ? String(status) : "Unknown",
    className: "bg-muted text-muted-foreground border-border",
  };
  return <Badge variant="outline" className={m.className}>{m.label}</Badge>;
}

export default function AdminSharepoint() {
  const { organizationId } = useOutletContext<OutletCtx>();
  const { data: orgSite, isLoading: siteLoading } = useOrgSite(organizationId);
  const { data: workspaces, isLoading: wsLoading } = useOrgWorkspaces(organizationId);
  const { data: bindings, isLoading: bLoading } = useWorkspaceBindingsList(organizationId);

  const validateOrgSiteMutation = useValidateOrgSite(organizationId);
  const validateWsMutation = useValidateWorkspaceBinding(undefined);
  const disableWsMutation = useDisableWorkspaceBinding(undefined);

  const [search, setSearch] = useState("");
  const [editTarget, setEditTarget] = useState<{
    workspaceId: string;
    workspaceName: string;
    binding?: SharepointWorkspaceBinding | null;
  } | null>(null);
  const [confirmDisable, setConfirmDisable] = useState<SharepointWorkspaceBinding | null>(null);
  const [diagOpenFor, setDiagOpenFor] = useState<string | null>(null);

  const hasActiveSite = !!orgSite && orgSite.connection_status !== "disabled";

  const bindingByWorkspace = useMemo(() => {
    const map = new Map<string, SharepointWorkspaceBinding>();
    (bindings ?? [])
      .filter((b) => b.binding_status !== "disabled")
      .forEach((b) => map.set(b.workspace_id, b));
    return map;
  }, [bindings]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (workspaces ?? []).filter((w) =>
      term ? w.name.toLowerCase().includes(term) : true,
    );
  }, [workspaces, search]);

  if (siteLoading || wsLoading || bLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold text-foreground">SharePoint integration</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Configure the organization SharePoint site once, then assign a library
          from that site to each workspace.
        </p>
        <div className="flex flex-wrap items-center gap-3 mt-2">
          <KnowledgeLink slug="sharepoint-file-management-placeholder" label="How SharePoint works in BTPM" />
          <KnowledgeLink slug="how-to-set-up-sharepoint-in-admin" label="How to set up SharePoint" />
        </div>
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>Org Admin only</AlertTitle>
        <AlertDescription className="text-xs">
          Only Org Admins can manage the SharePoint integration. Workspace and
          project pages have read-only visibility.
        </AlertDescription>
      </Alert>

      {/* ============================================================ */}
      {/* SECTION 1 — Organization SharePoint site                     */}
      {/* ============================================================ */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-primary" />
          <h3 className="text-base font-semibold text-foreground">
            1. Organization SharePoint site
          </h3>
        </div>
        <p className="text-xs text-muted-foreground">
          One site per organization. This is configured once and shared by all
          workspace library assignments.
        </p>

        {!hasActiveSite ? (
          <Card>
            <CardContent className="py-8 text-center space-y-3">
              <p className="font-medium text-foreground">No SharePoint site connected</p>
              <p className="text-sm text-muted-foreground">
                Configure and test the SharePoint integration in Tenant Integrations before assigning workspace libraries.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <CardTitle className="text-base">
                  {orgSite!.site_label_or_name || "Connected site"}
                </CardTitle>
                <OrgSiteStatusBadge status={orgSite!.connection_status} />
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <Alert className="py-2">
                <Info className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  This site is derived from the Tenant SharePoint integration
                  and is maintained automatically. To change it, update and
                  retest the SharePoint integration in Tenant Integrations.
                </AlertDescription>
              </Alert>

              {orgSite!.connection_status === "validated" && (
                <Alert className="border-emerald-500/30 py-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <AlertDescription className="text-xs">
                    {orgSite!.last_validation_note || "Validated against live SharePoint."}
                  </AlertDescription>
                </Alert>
              )}
              {orgSite!.connection_status === "invalid" && (
                <Alert variant="destructive" className="py-2">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription className="text-xs">
                    {orgSite!.last_validation_note || "Live validation failed."}
                  </AlertDescription>
                </Alert>
              )}
              {orgSite!.connection_status === "configured_unvalidated" && (
                <Alert className="py-2">
                  <Info className="h-4 w-4" />
                  <AlertDescription className="text-xs">
                    Configured but not validated. Run "Validate".
                  </AlertDescription>
                </Alert>
              )}

              <div className="grid gap-1 text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground w-20">Site:</span>
                  <a
                    href={orgSite!.site_web_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline break-all flex items-center gap-1"
                  >
                    {orgSite!.site_web_url}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
                {orgSite!.last_validated_at && (
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground w-20">Validated:</span>
                    <span className="text-muted-foreground">
                      {new Date(orgSite!.last_validated_at).toLocaleString()}
                    </span>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => validateOrgSiteMutation.mutate(orgSite!.id)}
                  disabled={validateOrgSiteMutation.isPending}
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 mr-1 ${
                      validateOrgSiteMutation.isPending ? "animate-spin" : ""
                    }`}
                  />
                  Validate
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </section>

      {/* ============================================================ */}
      {/* SECTION 2 — Workspace library assignments                    */}
      {/* ============================================================ */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <FolderTree className="h-4 w-4 text-primary" />
          <h3 className="text-base font-semibold text-foreground">
            2. Workspace library assignments
          </h3>
        </div>
        <p className="text-xs text-muted-foreground">
          One library per workspace, under the organization site above. Libraries
          are created in SharePoint outside BTPM.
        </p>

        {!hasActiveSite && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle>Site required</AlertTitle>
            <AlertDescription className="text-xs">
              Connect the organization SharePoint site first. Library
              assignments cannot be made without it.
            </AlertDescription>
          </Alert>
        )}

        {hasActiveSite && (
          <>
            <div className="relative max-w-sm">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search workspaces..."
                className="pl-9"
              />
            </div>

            <div className="space-y-3">
              {filtered.length === 0 && (
                <Card>
                  <CardContent className="py-8 text-center text-sm text-muted-foreground">
                    No workspaces found.
                  </CardContent>
                </Card>
              )}

              {filtered.map((ws) => {
                const binding = bindingByWorkspace.get(ws.id) ?? null;
                const isActive = !!binding;
                return (
                  <Card key={ws.id}>
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <CardTitle className="text-base">{ws.name}</CardTitle>
                        {binding ? (
                          <SharepointWorkspaceBindingStatusBadge status={binding.binding_status} />
                        ) : (
                          <span className="text-xs text-muted-foreground">No library assigned</span>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {binding && binding.binding_status === "validated" && (
                        <Alert className="border-emerald-500/30 py-2">
                          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                          <AlertDescription className="text-xs">
                            {binding.last_validation_note || "Validated against live SharePoint."}
                          </AlertDescription>
                        </Alert>
                      )}
                      {binding && binding.binding_status === "invalid" && (
                        <Alert variant="destructive" className="py-2">
                          <AlertTriangle className="h-4 w-4" />
                          <AlertDescription className="text-xs">
                            {binding.last_validation_note || "Live validation failed."}
                          </AlertDescription>
                        </Alert>
                      )}
                      {binding && binding.binding_status === "configured_unvalidated" && (
                        <Alert className="py-2">
                          <Info className="h-4 w-4" />
                          <AlertDescription className="text-xs">
                            Library assigned but not validated. Run "Validate".
                          </AlertDescription>
                        </Alert>
                      )}

                      {binding && (
                        <div className="grid gap-1 text-xs">
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground w-20">Library:</span>
                            <a
                              href={binding.library_web_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary hover:underline break-all flex items-center gap-1"
                            >
                              {binding.library_label_or_name || binding.library_web_url}
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          </div>
                          {binding.last_validated_at && (
                            <div className="flex items-center gap-2">
                              <span className="text-muted-foreground w-20">Validated:</span>
                              <span className="text-muted-foreground">
                                {new Date(binding.last_validated_at).toLocaleString()}
                              </span>
                            </div>
                          )}
                        </div>
                      )}

                      <div className="flex flex-wrap gap-2 pt-1">
                        {isActive && binding && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => validateWsMutation.mutate(binding.id)}
                            disabled={validateWsMutation.isPending}
                          >
                            <RefreshCw
                              className={`h-3.5 w-3.5 mr-1 ${
                                validateWsMutation.isPending ? "animate-spin" : ""
                              }`}
                            />
                            Validate
                          </Button>
                        )}
                        <Button
                          size="sm"
                          onClick={() =>
                            setEditTarget({
                              workspaceId: ws.id,
                              workspaceName: ws.name,
                              binding,
                            })
                          }
                        >
                          <Settings2 className="h-3.5 w-3.5 mr-1" />
                          {binding ? "Change library" : "Assign library"}
                        </Button>
                        {isActive && binding && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setConfirmDisable(binding)}
                          >
                            <PowerOff className="h-3.5 w-3.5 mr-1" />
                            Remove
                          </Button>
                        )}
                      </div>

                      {binding && (
                        <Collapsible
                          open={diagOpenFor === binding.id}
                          onOpenChange={(o) => setDiagOpenFor(o ? binding.id : null)}
                        >
                          <CollapsibleTrigger asChild>
                            <Button variant="ghost" size="sm" className="text-xs text-muted-foreground h-7">
                              {diagOpenFor === binding.id ? "Hide" : "Show"} diagnostics
                            </Button>
                          </CollapsibleTrigger>
                          <CollapsibleContent className="mt-2">
                            <SharepointDiagnosticsPanel bindingId={binding.id} />
                          </CollapsibleContent>
                        </Collapsible>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </>
        )}
      </section>

      {/* Dialogs */}
      {hasActiveSite && editTarget && (
        <WorkspaceBindingDialog
          open={!!editTarget}
          onOpenChange={(o) => !o && setEditTarget(null)}
          workspaceId={editTarget.workspaceId}
          workspaceName={editTarget.workspaceName}
          orgSite={orgSite as SharepointOrgSiteConnection}
          existing={editTarget.binding ?? undefined}
          onSaved={(b) => {
            validateWsMutation.mutate(b.id);
            setEditTarget(null);
          }}
        />
      )}


      <AlertDialog
        open={!!confirmDisable}
        onOpenChange={(o) => !o && setConfirmDisable(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove workspace library assignment?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the link between BTPM and the SharePoint library for
              this workspace. Existing projects will lose default-mode resolution.
              This does not change anything in SharePoint.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmDisable) disableWsMutation.mutate(confirmDisable.id);
                setConfirmDisable(null);
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
