/**
 * UX-GAP.1A / UX-GAP.1B2 / UX-MCP-ADMIN.2 — Platform Admin surface for the
 * BTPM MCP connection of one registered API client.
 *
 * The card presents three deliberately separate concerns:
 *   1. Protected resource configuration — the per-client administrative state
 *      `api_clients.protected_resource_type` (none | btpm_mcp), persisted only
 *      through the accepted Edge Function `platform-api-client-protected-resource`.
 *      The browser never submits, derives or edits an audience URI.
 *   2. OAuth / protected-resource technical details — the client's OAuth client
 *      ID, the persisted resolved audience, and the canonical platform MCP
 *      protected-resource metadata (read-only).
 *   3. Connection verification — durable historical evidence from the accepted
 *      verification RPC. It is never inferred from configuration, OAuth client
 *      ID, redirect URIs, lifecycle status, capabilities or metadata
 *      availability. Inability to read evidence is shown as "unavailable",
 *      never as negative evidence.
 *
 * Configuration and verification are distinct: a client may legitimately be
 * "Configured for BTPM MCP" and "Not yet verified".
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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
import { AlertTriangle, Copy } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { fetchMcpProtectedResourceMetadata } from "@/lib/mcpProtectedResourceMetadata";
import { getMcpConnectionVerification } from "@/lib/admin/mcpConnectionVerificationService";
import {
  type ApiClientProtectedResourceType,
  normalizeProtectedResourceType,
  setApiClientProtectedResource,
} from "@/lib/admin/apiClientProtectedResourceService";

const SUPABASE_BASE_URL = import.meta.env.VITE_SUPABASE_URL ?? "";

const RESOURCE_LABELS: Record<ApiClientProtectedResourceType, string> = {
  none: "None",
  btpm_mcp: "BTPM MCP",
};

async function copyValue(value: string, label: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast({ title: `${label} copied` });
  } catch {
    // A clipboard failure must never disclose errors or affect the page.
  }
}

function formatTimestamp(value: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function TechnicalValue({
  label,
  value,
  copyable,
}: {
  label: string;
  value: string;
  copyable?: boolean;
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="flex items-start gap-2">
        <span className="select-all break-all font-mono text-xs">{value}</span>
        {copyable && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            aria-label={`Copy ${label}`}
            onClick={() => void copyValue(value, label)}
          >
            <Copy className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

function AttentionNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="space-y-1 text-xs text-muted-foreground">
        <p className="font-medium text-foreground">Attention required</p>
        {children}
      </div>
    </div>
  );
}

function ConnectionVerificationSection({ apiClientId }: { apiClientId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["ux-gap-1b2", "mcp-connection-verification", apiClientId],
    queryFn: () => getMcpConnectionVerification(apiClientId),
    enabled: apiClientId.length > 0,
    staleTime: 60 * 1000,
    retry: false,
  });

  return (
    <div className="space-y-2 border-t pt-4" role="group" aria-label="Connection verification">
      <p className="text-sm font-medium">Connection verification</p>
      {isLoading ? (
        <div className="h-4 w-40 animate-pulse rounded bg-muted" />
      ) : isError || !data ? (
        <Badge variant="outline">Verification status unavailable</Badge>
      ) : data.verified ? (
        <div className="space-y-2">
          <Badge variant="secondary">Verified</Badge>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Last successful MCP authentication</p>
            <p className="font-mono text-xs">
              {formatTimestamp(data.lastSuccessfulAuthenticationAt ?? "")}
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            Verified from a successful authenticated and authorized MCP request. This is historical
            connection evidence, not a live health check.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <Badge variant="outline">Not yet verified</Badge>
          <p className="text-xs text-muted-foreground">
            No successful MCP authentication has been recorded for this API client yet.
          </p>
        </div>
      )}
    </div>
  );
}

export interface McpConnectionCardProps {
  apiClientId: string;
  oauthClientId?: string | null;
  lifecycleStatus?: string | null;
  /** Persisted administrative state from api_g_5_6_platform_get_client. */
  protectedResourceType?: string | null;
  /** Persisted server-resolved audience. Never editable in the browser. */
  oauthResourceAudience?: string | null;
}

export function McpConnectionCard({
  apiClientId,
  oauthClientId = null,
  lifecycleStatus = null,
  protectedResourceType = null,
  oauthResourceAudience = null,
}: McpConnectionCardProps) {
  const queryClient = useQueryClient();

  const persisted = normalizeProtectedResourceType(protectedResourceType);
  const isRetired = lifecycleStatus === "retired";
  const isActive = lifecycleStatus === "active";
  const hasOauthBinding = typeof oauthClientId === "string" && oauthClientId.trim().length > 0;

  const [selected, setSelected] = useState<ApiClientProtectedResourceType>(persisted);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmIsReconcile, setConfirmIsReconcile] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // The persisted backend read remains the source of truth for the selector.
  useEffect(() => {
    setSelected(persisted);
  }, [persisted]);

  const { data: metadata, isLoading: metadataLoading } = useQuery({
    queryKey: ["ux-gap-1a", "mcp-protected-resource-metadata"],
    queryFn: () => fetchMcpProtectedResourceMetadata(SUPABASE_BASE_URL),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const saveMutation = useMutation({
    mutationFn: (resourceType: ApiClientProtectedResourceType) =>
      setApiClientProtectedResource(apiClientId, resourceType),
    onSuccess: async () => {
      setSaveError(null);
      setConfirmOpen(false);
      await queryClient.invalidateQueries({
        queryKey: ["platform-admin-api-client", apiClientId],
      });
      toast({ title: "Protected resource saved" });
    },
    onError: () => {
      setConfirmOpen(false);
      setSaveError("Protected resource could not be saved.");
      setSelected(persisted);
      toast({
        title: "Protected resource could not be saved.",
        variant: "destructive",
      });
    },
  });

  const pending = saveMutation.isPending;
  const selectionInvalid = selected === "btpm_mcp" && !hasOauthBinding;
  const inconsistentBinding = persisted === "btpm_mcp" && !hasOauthBinding;
  const audienceMismatch =
    persisted === "btpm_mcp" &&
    !!metadata?.resource &&
    typeof oauthResourceAudience === "string" &&
    oauthResourceAudience.length > 0 &&
    oauthResourceAudience !== metadata.resource;
  // UX-MCP-ADMIN.2-C1 — a canonical audience mismatch is itself a legitimate
  // reconciliation mutation even though the selected resource is unchanged.
  const canonicalReconciliation = audienceMismatch && selected === "btpm_mcp";
  const canSave =
    !isRetired && (selected !== persisted || canonicalReconciliation) && !selectionInvalid;

  function handleSaveClick() {
    if (!canSave || pending) return;
    if (isActive) {
      setConfirmIsReconcile(canonicalReconciliation);
      setConfirmOpen(true);
      return;
    }
    saveMutation.mutate(selected);
  }

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="text-base">BTPM MCP connection</CardTitle>
        <p className="text-sm text-muted-foreground">
          Configure whether this registered application targets the BTPM MCP protected resource, and
          review its OAuth connection details.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Section 1 — Protected resource configuration */}
        <div className="space-y-3" role="group" aria-label="Protected resource">
          <div className="space-y-1">
            <p className="text-sm font-medium">Protected resource</p>
            <p className="text-xs text-muted-foreground">
              Select whether OAuth access tokens issued for this registered application are intended
              for the BTPM MCP protected resource.
            </p>
          </div>

          <Badge variant={persisted === "btpm_mcp" ? "secondary" : "outline"}>
            {persisted === "btpm_mcp" ? "Configured for BTPM MCP" : "MCP not configured"}
          </Badge>

          <RadioGroup
            value={selected}
            onValueChange={(value) =>
              setSelected(normalizeProtectedResourceType(value))
            }
            disabled={isRetired || pending}
            className="gap-2"
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem value="none" id={`protected-resource-none-${apiClientId}`} />
              <Label htmlFor={`protected-resource-none-${apiClientId}`} className="text-sm">
                None
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem
                value="btpm_mcp"
                id={`protected-resource-mcp-${apiClientId}`}
                disabled={isRetired || pending || (!hasOauthBinding && persisted !== "btpm_mcp")}
              />
              <Label htmlFor={`protected-resource-mcp-${apiClientId}`} className="text-sm">
                BTPM MCP
              </Label>
            </div>
          </RadioGroup>

          {isRetired && (
            <p className="text-xs text-muted-foreground">
              Retired API clients cannot be reconfigured.
            </p>
          )}

          {!isRetired && !hasOauthBinding && (
            <p className="text-xs text-muted-foreground">
              Bind an OAuth client ID before configuring this application for BTPM MCP.
            </p>
          )}

          {inconsistentBinding && (
            <AttentionNotice>
              <p>
                This application is configured for BTPM MCP but has no bound OAuth client ID. Select
                None, or bind an OAuth client ID.
              </p>
            </AttentionNotice>
          )}

          {audienceMismatch && (
            <AttentionNotice>
              <p>
                The stored OAuth audience does not match the current BTPM MCP protected resource.
                Save BTPM MCP again to reconcile it with the canonical server configuration.
              </p>
            </AttentionNotice>
          )}

          {saveError && <p className="text-xs text-destructive">{saveError}</p>}

          {canSave && (
            <Button type="button" size="sm" onClick={handleSaveClick} disabled={pending}>
              {pending
                ? "Saving…"
                : canonicalReconciliation
                  ? "Reconcile BTPM MCP audience"
                  : "Save protected resource"}
            </Button>
          )}
        </div>

        {/* Section 2 — OAuth / protected-resource technical details */}
        <div className="space-y-3 border-t pt-4">
          <p className="text-sm font-medium">OAuth and protected-resource details</p>
          <div className="grid gap-4 md:grid-cols-2">
            <TechnicalValue
              label="OAuth client ID"
              value={hasOauthBinding ? (oauthClientId as string) : "Not bound"}
              copyable={hasOauthBinding}
            />
            <TechnicalValue
              label="Resolved audience"
              value={
                persisted === "btpm_mcp" && oauthResourceAudience
                  ? oauthResourceAudience
                  : "Not configured"
              }
              copyable={persisted === "btpm_mcp" && !!oauthResourceAudience}
            />
            {metadataLoading ? (
              <div className="space-y-2">
                <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
                <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
              </div>
            ) : metadata ? (
              <>
                <TechnicalValue
                  label="Required audience / protected resource"
                  value={metadata.resource}
                  copyable
                />
                <TechnicalValue
                  label="Authorization server"
                  value={metadata.authorizationServer}
                  copyable
                />
                <TechnicalValue
                  label="Authentication method"
                  value="Bearer token in Authorization header"
                />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                BTPM MCP connection details are temporarily unavailable.
              </p>
            )}
          </div>
        </div>

        {/* Section 3 — Connection verification */}
        <ConnectionVerificationSection apiClientId={apiClientId} />
      </CardContent>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmIsReconcile ? "Reconcile BTPM MCP audience?" : "Change protected resource?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmIsReconcile
                ? "This updates the audience applied to newly issued OAuth access tokens to the current canonical BTPM MCP protected resource. Existing access tokens are not revoked and remain valid until they expire."
                : "This changes the audience added to newly issued OAuth access tokens. Existing access tokens are not revoked and remain valid until they expire."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {confirmIsReconcile ? (
            <div className="space-y-1 text-sm">
              <p>The protected resource remains BTPM MCP.</p>
              {oauthResourceAudience && (
                <p className="break-all font-mono text-xs">
                  Stored audience: {oauthResourceAudience}
                </p>
              )}
              {metadata?.resource && (
                <p className="break-all font-mono text-xs">
                  Canonical audience: {metadata.resource}
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-1 text-sm">
              <p>Current: {RESOURCE_LABELS[persisted]}</p>
              <p>New: {RESOURCE_LABELS[selected]}</p>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(event) => {
                event.preventDefault();
                if (pending) return;
                saveMutation.mutate(selected);
              }}
            >
              {confirmIsReconcile ? "Reconcile BTPM MCP audience" : "Change protected resource"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
