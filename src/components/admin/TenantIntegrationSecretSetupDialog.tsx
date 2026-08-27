/**
 * Phase 4D.10B — Secure Tenant Integration Secret Setup dialog.
 *
 * Write-only UX. Never displays secret values, Vault IDs, or fingerprints.
 * Secret input state is kept in local React state only, cleared after
 * submit/close, and never placed into React Query cache or browser storage.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAdminAccess } from "@/hooks/useAdminAccess";
import { useActiveContext } from "@/context/ActiveContextProvider";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import { Info, Lock, Loader2, ShieldAlert } from "lucide-react";
import { getCatalog, type SecretRequirement } from "@/lib/admin/integrationSecretCatalog";
import {
  OPENAI_CONNECTION_TEST_UNAVAILABLE_MESSAGE,
  runOpenAiConnectionTest,
  type OpenAiConnectionTestResult,
} from "@/lib/openAiConnectionTestService";
import {
  AZURE_OPENAI_CONNECTION_TEST_UNAVAILABLE_MESSAGE,
  runAzureOpenAiConnectionTest,
  type AzureOpenAiConnectionTestResult,
} from "@/lib/azureOpenAiConnectionTestService";
import {
  MICROSOFT_GRAPH_CONNECTION_TEST_UNAVAILABLE_MESSAGE,
  runMicrosoftGraphConnectionTest,
  type MicrosoftGraphConnectionTestResult,
} from "@/lib/microsoftGraphConnectionTestService";
import {
  SHAREPOINT_CONNECTION_TEST_UNAVAILABLE_MESSAGE,
  runSharePointConnectionTest,
  type SharePointConnectionTestResult,
} from "@/lib/sharePointConnectionTestService";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  integrationId: string | null;
  /** Optional preselected organization override scope. */
  initialOrganizationId?: string | null;
}

interface MetaRow {
  secret_name: string;
  secret_scope: "tenant" | "organization_override";
  status: string;
  organization_id: string | null;
  organization_name: string | null;
  rotated_at: string | null;
  disabled_at: string | null;
  updated_at: string | null;
  created_at: string | null;
}

interface OrgRow {
  organization_id: string;
  organization_name: string;
  environment_role: string;
  is_production: boolean;
}

interface IntegrationDetail {
  integration: {
    id: string; kind: string; name: string; status: string; is_enabled: boolean;
    tenant_id: string;
    config_metadata?: Record<string, unknown> | null;
  };
  organization_matrix: OrgRow[];
}

function statusBadge(status: string) {
  const cls =
    status === "active"
      ? "border-green-500/50 text-green-700 dark:text-green-400"
      : status === "disabled" || status === "revoked"
      ? "border-amber-500/50 text-amber-700 dark:text-amber-400"
      : "border-muted";
  return <Badge variant="outline" className={cls}>{status}</Badge>;
}

interface SecretRowState {
  value: string;
  reason: string;
  submitting: boolean;
}

function EmptyRow(): SecretRowState { return { value: "", reason: "", submitting: false }; }

function SecretEditor({
  req, meta, onSave, onDisable, disabled,
}: {
  req: SecretRequirement;
  meta: MetaRow | undefined;
  onSave: (name: string, value: string, reason: string) => Promise<void>;
  onDisable: (name: string, reason: string) => Promise<void>;
  disabled?: boolean;
}) {
  const [state, setState] = useState<SecretRowState>(EmptyRow);
  const configured = !!meta && meta.status === "active";
  const isDisabled = !!meta && (meta.status === "disabled" || meta.status === "revoked");

  const clear = () => setState(EmptyRow());

  return (
    <div className="rounded-md border p-3 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Label className="font-mono text-xs">{req.name}</Label>
            <span className="text-sm font-medium">{req.label}</span>
            {req.required ? (
              <Badge variant="outline" className="text-[10px]">Required</Badge>
            ) : (
              <Badge variant="secondary" className="text-[10px]">Optional</Badge>
            )}
          </div>
          {req.description && (
            <p className="text-xs text-muted-foreground mt-0.5">{req.description}</p>
          )}
        </div>
        <div className="text-right text-[11px] text-muted-foreground">
          <div className="flex items-center gap-1 justify-end">
            {configured && statusBadge("configured")}
            {isDisabled && statusBadge(meta!.status)}
            {!meta && <Badge variant="outline" className="border-destructive/50 text-destructive text-[10px]">Missing</Badge>}
          </div>
          {meta?.rotated_at && <div>Rotated {new Date(meta.rotated_at).toLocaleDateString()}</div>}
          {meta?.updated_at && !meta.rotated_at && <div>Updated {new Date(meta.updated_at).toLocaleDateString()}</div>}
        </div>
      </div>

      <div className="grid gap-2 md:grid-cols-[1fr_auto]">
        {req.multiline ? (
          <Textarea
            value={state.value}
            onChange={(e) => setState((s) => ({ ...s, value: e.target.value }))}
            placeholder={configured ? "Enter new value to rotate (existing value not shown)" : (req.placeholder ?? "New value")}
            autoComplete="off"
            spellCheck={false}
            disabled={disabled || state.submitting}
          />
        ) : (
          <Input
            type={req.inputType === "password" ? "password" : req.inputType}
            value={state.value}
            onChange={(e) => setState((s) => ({ ...s, value: e.target.value }))}
            placeholder={configured ? "Enter new value to rotate (existing value not shown)" : (req.placeholder ?? "New value")}
            autoComplete="off"
            spellCheck={false}
            disabled={disabled || state.submitting}
          />
        )}
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={disabled || state.submitting || state.value.length === 0}
            onClick={async () => {
              setState((s) => ({ ...s, submitting: true }));
              try {
                await onSave(req.name, state.value, state.reason);
                clear();
              } finally {
                setState((s) => ({ ...s, value: "", submitting: false }));
              }
            }}
          >
            {configured ? "Rotate" : "Save"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={disabled || state.submitting || !configured}
            onClick={async () => {
              setState((s) => ({ ...s, submitting: true }));
              try {
                await onDisable(req.name, state.reason);
              } finally {
                setState((s) => ({ ...s, submitting: false }));
              }
            }}
          >
            Disable
          </Button>
        </div>
      </div>
      <Input
        value={state.reason}
        onChange={(e) => setState((s) => ({ ...s, reason: e.target.value }))}
        placeholder="Reason (optional, audit only — do not include secret value)"
        className="h-8 text-xs"
        disabled={disabled || state.submitting}
      />
    </div>
  );
}

export function TenantIntegrationSecretSetupDialog({
  open, onOpenChange, integrationId, initialOrganizationId = null,
}: Props) {
  const ctx = useActiveContext();
  const admin = useAdminAccess();
  const qc = useQueryClient();

  const [scope, setScope] = useState<"tenant" | string>(initialOrganizationId ?? "tenant");
  // Increments after every successful secret save/rotation/disable so that
  // per-integration connection-test cards (OpenAI, Azure OpenAI, Microsoft
  // Graph, SharePoint) reset their stale results.
  const [secretMutationRevision, setSecretMutationRevision] = useState(0);

  useEffect(() => {
    if (open) {
      setScope(initialOrganizationId ?? "tenant");
      setSecretMutationRevision(0);
      // Ensure integration detail (status / is_enabled) reflects any changes
      // (enable/disable toggle, secret rotations) made outside this dialog
      // since the last fetch. Without this, Test Connection buttons can stay
      // disabled after enabling the integration from the parent list.
      if (integrationId) {
        qc.invalidateQueries({
          queryKey: ["tenant-admin-integration-detail", integrationId],
        });
        qc.invalidateQueries({
          queryKey: ["tenant-admin-integration-secret-metadata", integrationId],
        });
      }
    }
  }, [open, initialOrganizationId, integrationId, qc]);

  // Close side effects: nothing to clear here because per-row state resets on unmount.
  useEffect(() => {
    if (!open) {
      setScope("tenant");
      setSecretMutationRevision(0);
    }
  }, [open]);

  const detailQuery = useQuery({
    queryKey: ["tenant-admin-integration-detail", integrationId],
    enabled: !!open && !!integrationId,
    staleTime: 15_000,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("tenant_admin_get_integration_detail", {
        _integration_id: integrationId,
      });
      if (error) throw error;
      return data as IntegrationDetail;
    },
  });

  const metadataQuery = useQuery({
    queryKey: ["tenant-admin-integration-secret-metadata", integrationId],
    enabled: !!open && !!integrationId,
    staleTime: 5_000,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)(
        "tenant_admin_list_integration_secret_metadata",
        { _integration_id: integrationId, _organization_id: null },
      );
      if (error) throw error;
      return (data ?? []) as MetaRow[];
    },
  });

  // Phase 4D.14A.8A.1 — Safe read-back of the saved Azure OpenAI endpoint.
  // The generic integration detail RPC never returns config_metadata values,
  // so a dedicated Tenant-Admin-only reader is used here.
  const azureEndpointQuery = useQuery({
    queryKey: ["tenant-admin-azure-openai-endpoint", integrationId],
    enabled:
      !!open && !!integrationId && detailQuery.data?.integration.kind === "azure_openai",
    staleTime: 5_000,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)(
        "tenant_admin_get_azure_openai_endpoint",
        { _integration_id: integrationId },
      );
      if (error) throw error;
      const row = (data ?? {}) as { endpoint?: string | null };
      return (row.endpoint ?? null) as string | null;
    },
  });

  const integ = detailQuery.data?.integration;
  const catalog = integ ? getCatalog(integ.kind) : null;
  const tenantId = integ?.tenant_id ?? null;
  const isTenantAdmin = tenantId ? admin.isTenantAdminForTenant(tenantId) : false;

  const organizations = detailQuery.data?.organization_matrix ?? [];

  const activeOrgId = scope === "tenant" ? null : scope;
  const activeOrg = organizations.find((o) => o.organization_id === activeOrgId) ?? null;
  const isNonProd = activeOrg ? !activeOrg.is_production : false;

  const metaByName = useMemo(() => {
    const m = new Map<string, MetaRow>();
    const rows = metadataQuery.data ?? [];
    for (const r of rows) {
      const inScope =
        activeOrgId === null
          ? r.secret_scope === "tenant"
          : r.secret_scope === "organization_override" && r.organization_id === activeOrgId;
      if (inScope) m.set(r.secret_name, r);
    }
    return m;
  }, [metadataQuery.data, activeOrgId]);

  const storeMutation = useMutation({
    mutationFn: async (args: { name: string; value: string; reason: string; kind: string }) => {
      const { data, error } = await (supabase.rpc as any)("tenant_admin_store_integration_secret", {
        _integration_id: integrationId,
        _secret_name: args.name,
        _secret_value: args.value,
        _secret_kind: args.kind,
        _organization_id: activeOrgId,
        _reason: args.reason || null,
      });
      if (error) throw error;
      return data;
    },
  });

  const disableMutation = useMutation({
    mutationFn: async (args: { name: string; reason: string }) => {
      const { data, error } = await (supabase.rpc as any)("tenant_admin_disable_integration_secret", {
        _integration_id: integrationId,
        _secret_name: args.name,
        _organization_id: activeOrgId,
        _reason: args.reason || null,
      });
      if (error) throw error;
      return data;
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["tenant-admin-integration-secret-metadata", integrationId] });
    qc.invalidateQueries({ queryKey: ["tenant-admin-integration-detail", integrationId] });
    qc.invalidateQueries({ queryKey: ["tenant-admin-integrations", tenantId] });
  };

  const handleSave = async (name: string, value: string, reason: string) => {
    const req = catalog?.secrets.find((s) => s.name === name);
    try {
      await storeMutation.mutateAsync({ name, value, reason, kind: req?.secretKind ?? "text" });
      toast({ title: "Secret updated." });
      setSecretMutationRevision((n) => n + 1);
      invalidate();
    } catch (e: any) {
      toast({
        title: "Failed to save secret",
        description: e?.message ?? "Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleDisable = async (name: string, reason: string) => {
    try {
      await disableMutation.mutateAsync({ name, reason });
      toast({ title: "Secret disabled." });
      setSecretMutationRevision((n) => n + 1);
      invalidate();
    } catch (e: any) {
      toast({
        title: "Failed to disable secret",
        description: e?.message ?? "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-4 w-4" />
            Configure secrets — {catalog?.label ?? integ?.kind ?? "Integration"}
          </DialogTitle>
          <DialogDescription>
            {ctx.activeTenant?.name ? `Tenant: ${ctx.activeTenant.name}. ` : ""}
            Secret values are write-only. Existing values cannot be viewed, copied,
            or downloaded. Vault IDs and fingerprints are never displayed.
          </DialogDescription>
        </DialogHeader>

        {(detailQuery.isLoading || metadataQuery.isLoading) && (
          <div className="space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-40 w-full" /></div>
        )}

        {detailQuery.error && (
          <p className="text-sm text-destructive">Failed to load integration.</p>
        )}

        {integ && catalog && (
          <div className="space-y-4">
            {!isTenantAdmin && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/5 p-3 text-xs">
                <ShieldAlert className="h-4 w-4 shrink-0 text-destructive" />
                <div>
                  Only Tenant Admins for this tenant may configure integration secrets.
                  Platform Super Admin alone and Org Admin alone are not sufficient.
                </div>
              </div>
            )}

            <Tabs value={scope} onValueChange={setScope}>
              <TabsList className="flex flex-wrap h-auto">
                <TabsTrigger value="tenant">Tenant default</TabsTrigger>
                {organizations.map((o) => (
                  <TabsTrigger key={o.organization_id} value={o.organization_id}>
                    {o.organization_name}
                    {!o.is_production && (
                      <span className="ml-1 text-[10px] text-amber-600">(non-prod)</span>
                    )}
                  </TabsTrigger>
                ))}
              </TabsList>

              <TabsContent value={scope} className="mt-3">
                {isNonProd && (
                  <div className="mb-3 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
                    <Info className="h-4 w-4 shrink-0 text-amber-600" />
                    <div>
                      This organization is non-production. Real integrations are blocked
                      at runtime{integ.kind === "smtp" ? ", and outbound email is blocked" : ""}.
                      You may still store secrets here; runtime use remains gated.
                    </div>
                  </div>
                )}

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">
                      {activeOrgId ? "Organization override" : "Tenant-level secrets"}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {catalog.secrets.map((req) => (
                      <SecretEditor
                        key={req.name}
                        req={req}
                        meta={metaByName.get(req.name)}
                        disabled={!isTenantAdmin}
                        onSave={handleSave}
                        onDisable={handleDisable}
                      />
                    ))}
                  </CardContent>
                </Card>

                {integ.kind === "openai" ? (

                  <>
                    <div className="mt-3 flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-xs">
                      <Info className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div>
                        This read-only test validates that OpenAI accepts the
                        effective Tenant and Organization credential. It does
                        not generate content and does not verify every
                        configured AI model.
                      </div>
                    </div>
                    <OpenAiTestConnectionCard
                      resetKey={`${activeOrgId ?? "tenant"}:${integ.is_enabled ? "on" : "off"}:${integ.status}:rev${secretMutationRevision}`}
                      isEnabled={integ.is_enabled && integ.status === "active"}
                      isTenantAdmin={isTenantAdmin}
                      activeOverrideOrg={activeOrg}
                      organizations={organizations}
                      contextActiveOrgId={ctx.activeOrganization?.id ?? null}
                      integrationId={integ.id}
                      tenantId={tenantId}
                      onTested={invalidate}
                    />
                  </>
                ) : integ.kind === "mulesoft_kpi" ? (
                  <>
                    <div className="mt-3 flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-xs">
                      <Info className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div>
                        This read-only test reuses the existing MuleSoft KPI
                        endpoints (<code>/kpis</code> and <code>/dimensions</code>)
                        against the effective Tenant and Organization credential.
                        No data is written to BTPM or to the KPI App.
                      </div>
                    </div>
                    <MulesoftKpiTestConnectionCard
                      resetKey={`${activeOrgId ?? "tenant"}:${integ.is_enabled ? "on" : "off"}:${integ.status}:rev${secretMutationRevision}`}
                      isEnabled={integ.is_enabled && integ.status === "active"}
                      isTenantAdmin={isTenantAdmin}
                      activeOverrideOrg={activeOrg}
                      organizations={organizations}
                      contextActiveOrgId={ctx.activeOrganization?.id ?? null}
                    />
                  </>
                ) : integ.kind === "smtp" ? (
                  <>
                    <div className="mt-3 flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-xs">
                      <Info className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div>
                        This test sends a real email through the effective
                        Tenant and Organization SMTP configuration to the
                        signed-in admin's own email address. No other
                        recipient can be targeted from this surface.
                      </div>
                    </div>
                    <SmtpTestConnectionCard
                      resetKey={`${activeOrgId ?? "tenant"}:${integ.is_enabled ? "on" : "off"}:${integ.status}:rev${secretMutationRevision}`}
                      isEnabled={integ.is_enabled && integ.status === "active"}
                      isTenantAdmin={isTenantAdmin}
                      activeOverrideOrg={activeOrg}
                      organizations={organizations}
                      contextActiveOrgId={ctx.activeOrganization?.id ?? null}
                    />
                  </>
                ) : integ.kind === "microsoft_graph" ? (
                  <>
                    <div className="mt-3 flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-xs">
                      <Info className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div>
                        This read-only test validates the effective Microsoft
                        Graph credential, token claims, application-permission
                        presence, and Graph API reachability. It does not test
                        SharePoint site access or send email.
                      </div>
                    </div>
                    <MicrosoftGraphTestConnectionCard
                      resetKey={`${activeOrgId ?? "tenant"}:${integ.is_enabled ? "on" : "off"}:${integ.status}:rev${secretMutationRevision}`}
                      isEnabled={integ.is_enabled && integ.status === "active"}
                      isTenantAdmin={isTenantAdmin}
                      activeOverrideOrg={activeOrg}
                      organizations={organizations}
                      contextActiveOrgId={ctx.activeOrganization?.id ?? null}
                      onTested={invalidate}
                    />
                  </>
                ) : integ.kind === "sharepoint" ? (
                  <>
                    <div className="mt-3 flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-xs">
                      <Info className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div>
                        This read-only test validates the effective SharePoint
                        site configuration, reuses the Microsoft Graph Tenant
                        credential, and checks access to the site's document
                        libraries. It does not create, upload, change, or
                        delete files and does not validate project-folder
                        bindings.
                      </div>
                    </div>
                    <SharePointTestConnectionCard
                      resetKey={`${activeOrgId ?? "tenant"}:${integ.is_enabled ? "on" : "off"}:${integ.status}:rev${secretMutationRevision}`}
                      isEnabled={integ.is_enabled && integ.status === "active"}
                      isTenantAdmin={isTenantAdmin}
                      activeOverrideOrg={activeOrg}
                      organizations={organizations}
                      contextActiveOrgId={ctx.activeOrganization?.id ?? null}
                      onTested={invalidate}
                    />
                  </>
                ) : integ.kind === "azure_openai" ? (
                  <>
                    <div className="mt-3 flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-xs">
                      <Info className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div>
                        Azure OpenAI can be configured and tested here. BTPM will continue using the current OpenAI runtime until the Tenant AI provider migration is completed.
                      </div>
                    </div>
                    {activeOrgId === null ? (
                      <>
                        <AzureOpenAiEndpointCard
                          integrationId={integ.id}
                          currentEndpoint={azureEndpointQuery.data ?? null}
                          disabled={!isTenantAdmin}
                          onSaved={() => {
                            qc.invalidateQueries({
                              queryKey: ["tenant-admin-azure-openai-endpoint", integrationId],
                            });
                            setSecretMutationRevision((n) => n + 1);
                            invalidate();
                          }}
                        />
                        <AzureOpenAiDeploymentMappingsCard
                          integrationId={integ.id}
                          disabled={!isTenantAdmin}
                        />
                      </>
                    ) : (
                      <div className="mt-3 flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-xs">
                        <Info className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <div>
                          The Azure OpenAI endpoint and model deployment mappings are managed at <span className="font-medium">Tenant default</span>. This Organization may override the API key only.
                        </div>
                      </div>
                    )}
                    <AzureOpenAiTestConnectionCard
                      resetKey={`${activeOrgId ?? "tenant"}:${integ.is_enabled ? "on" : "off"}:${integ.status}:endpoint=${azureEndpointQuery.data ?? ""}:rev${secretMutationRevision}`}
                      isEnabled={integ.is_enabled && integ.status === "active"}
                      isTenantAdmin={isTenantAdmin}
                      activeOverrideOrg={activeOrg}
                      organizations={organizations}
                      contextActiveOrgId={ctx.activeOrganization?.id ?? null}
                      onTested={invalidate}
                    />
                  </>
                ) : (
                  <>
                    <div className="mt-3 flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-xs">
                      <Info className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div>
                        Secrets configured here are stored for this Tenant but
                        are not used by runtime integrations until the
                        corresponding integration migration is completed.
                        Connection testing is not available in this step.
                      </div>
                    </div>
                    <div className="mt-2">
                      <Button size="sm" variant="outline" disabled>
                        Test connection — later
                      </Button>
                    </div>
                  </>
                )}


              </TabsContent>
            </Tabs>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


/**
 * Phase 4D.14A.5A — OpenAI Test Connection card inside the Configure Secrets
 * dialog. Calls `openai-test-connection` (read-only GET /v1/models via the
 * effective Tenant/Organization OpenAI credential); never generates content
 * and never verifies specific AI models.
 *
 * Renders only a compact safe result — no model names/IDs, response data,
 * secret names, Vault metadata, Organization/Tenant identifiers, or raw
 * client-library errors.
 */
interface OpenAiTestOrg {
  organization_id: string;
  organization_name: string;
  environment_role: string;
  is_production: boolean;
}
function OpenAiTestConnectionCard({
  resetKey,
  isEnabled,
  isTenantAdmin,
  activeOverrideOrg,
  organizations,
  contextActiveOrgId,
  integrationId,
  tenantId,
  onTested,
}: {
  resetKey: string;
  isEnabled: boolean;
  isTenantAdmin: boolean;
  activeOverrideOrg: OpenAiTestOrg | null;
  organizations: OpenAiTestOrg[];
  contextActiveOrgId: string | null;
  integrationId: string;
  tenantId: string | null;
  onTested: () => void;
}) {
  const defaultTargetId = useMemo(() => {
    if (activeOverrideOrg) return activeOverrideOrg.organization_id;
    const activeInTenant = organizations.find(
      (o) => o.organization_id === contextActiveOrgId,
    );
    if (activeInTenant && activeInTenant.is_production) {
      return activeInTenant.organization_id;
    }
    const firstProd = organizations.find((o) => o.is_production);
    return firstProd?.organization_id ?? "";
  }, [activeOverrideOrg, organizations, contextActiveOrgId]);

  const [targetOrgId, setTargetOrgId] = useState<string>(defaultTargetId);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<OpenAiConnectionTestResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setResult(null);
    setErrorMessage(null);
    setTargetOrgId(defaultTargetId);
  }, [resetKey, defaultTargetId, isEnabled, isTenantAdmin]);

  const selectedOrg = activeOverrideOrg ??
    organizations.find((o) => o.organization_id === targetOrgId) ?? null;
  const isNonProd = selectedOrg ? !selectedOrg.is_production : false;
  const canRun = isEnabled && isTenantAdmin && !!selectedOrg && !isNonProd &&
    !running;

  // Suppress unused-var warnings for context values the card records for
  // invalidation but does not itself display.
  void integrationId; void tenantId;

  const onRun = async () => {
    if (!selectedOrg) return;
    setRunning(true);
    setResult(null);
    setErrorMessage(null);
    try {
      const r = await runOpenAiConnectionTest(selectedOrg.organization_id);
      setResult(r);
      // Refetch integration detail/list so persisted last_tested_at /
      // last_success_at / last_error_at / last_error_message surface
      // immediately in the UI.
      onTested();
    } catch {
      setErrorMessage(OPENAI_CONNECTION_TEST_UNAVAILABLE_MESSAGE);
    } finally {
      setRunning(false);
    }
  };

  const success = !!result && result.ok === true &&
    result.classification === "connection_successful";

  return (
    <Card className="mt-3">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">OpenAI test connection</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {activeOverrideOrg ? (
          <div className="text-xs text-muted-foreground">
            Testing against organization override: <span className="font-medium">
              {activeOverrideOrg.organization_name}
            </span>
          </div>
        ) : (
          <div className="grid gap-2 md:grid-cols-[1fr_auto] items-end">
            <div>
              <Label className="text-xs">Test against organization</Label>
              <select
                className="mt-1 w-full h-9 rounded-md border bg-background px-2 text-sm"
                value={targetOrgId}
                onChange={(e) => {
                  setTargetOrgId(e.target.value);
                  setResult(null);
                  setErrorMessage(null);
                }}
                disabled={running}
              >
                <option value="">Select an organization…</option>
                {organizations.map((o) => (
                  <option key={o.organization_id} value={o.organization_id}>
                    {o.organization_name}
                    {!o.is_production ? " (non-prod)" : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {isNonProd && (
          <div className="text-xs text-amber-700 dark:text-amber-400">
            Real integration testing is blocked for this non-production organization.
          </div>
        )}
        {!isTenantAdmin && (
          <div className="text-xs text-muted-foreground">
            Tenant Admin authority is required to run the OpenAI test
            connection.
          </div>
        )}

        <div>
          <Button size="sm" onClick={onRun} disabled={!canRun}>
            {running && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
            Test connection
          </Button>
        </div>

        {errorMessage && (
          <div className="rounded-md border border-destructive/50 bg-destructive/5 p-2 text-xs text-destructive">
            {errorMessage}
          </div>
        )}

        {result && (
          <div
            className={`rounded-md border p-2 text-xs ${
              success
                ? "border-green-500/40 bg-green-500/5 text-green-800 dark:text-green-300"
                : "border-amber-500/40 bg-amber-500/5"
            }`}
          >
            {success ? (
              <div>
                {"Connection successful. OpenAI accepted the Tenant credential."}
              </div>
            ) : (
              <div className="space-y-1">
                <div className="font-medium">
                  {result.classification.replace(/_/g, " ")}
                </div>
                <div>{result.recommended_next_action}</div>
                <div className="text-muted-foreground">
                  Credential accepted: {result.credential_accepted ? "yes" : "no"}
                  {" · "}
                  API accessible: {result.api_accessible ? "yes" : "no"}
                  {result.http_status ? ` · HTTP ${result.http_status}` : ""}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}


/**
 * MuleSoft KPI Test Connection card. Reuses the existing read-only
 * `read-kpi-app-catalog` and `read-kpi-app-dimensions` Edge Functions
 * (which resolve credentials from the Tenant integration for the
 * selected Organization). No data is persisted; no writes are made.
 */
interface MulesoftKpiTestOrg {
  organization_id: string;
  organization_name: string;
  environment_role: string;
  is_production: boolean;
}
function MulesoftKpiTestConnectionCard({
  resetKey,
  isEnabled,
  isTenantAdmin,
  activeOverrideOrg,
  organizations,
  contextActiveOrgId,
}: {
  resetKey: string;
  isEnabled: boolean;
  isTenantAdmin: boolean;
  activeOverrideOrg: MulesoftKpiTestOrg | null;
  organizations: MulesoftKpiTestOrg[];
  contextActiveOrgId: string | null;
}) {
  const defaultTargetId = useMemo(() => {
    if (activeOverrideOrg) return activeOverrideOrg.organization_id;
    const activeInTenant = organizations.find(
      (o) => o.organization_id === contextActiveOrgId,
    );
    if (activeInTenant && activeInTenant.is_production) {
      return activeInTenant.organization_id;
    }
    const firstProd = organizations.find((o) => o.is_production);
    return firstProd?.organization_id ?? "";
  }, [activeOverrideOrg, organizations, contextActiveOrgId]);

  const [targetOrgId, setTargetOrgId] = useState<string>(defaultTargetId);
  const [maintainerEmail, setMaintainerEmail] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<
    | null
    | {
        ok: boolean;
        catalog: { ok: boolean; code?: string; http_status?: number; row_count?: number; host?: string };
        dimensions: { ok: boolean; code?: string; http_status?: number; scenarios?: number; currencies?: number; host?: string };
      }
  >(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setResult(null);
    setErrorMessage(null);
    setTargetOrgId(defaultTargetId);
  }, [resetKey, defaultTargetId, isEnabled, isTenantAdmin]);

  useEffect(() => {
    (async () => {
      if (maintainerEmail) return;
      const { data } = await supabase.auth.getUser();
      if (data?.user?.email) setMaintainerEmail(data.user.email);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedOrg = activeOverrideOrg ??
    organizations.find((o) => o.organization_id === targetOrgId) ?? null;
  const isNonProd = selectedOrg ? !selectedOrg.is_production : false;
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(maintainerEmail.trim());
  const canRun = isEnabled && isTenantAdmin && !!selectedOrg && !isNonProd &&
    emailOk && !running;

  const onRun = async () => {
    if (!selectedOrg) return;
    setRunning(true);
    setResult(null);
    setErrorMessage(null);
    try {
      const [catalogRes, dimsRes] = await Promise.all([
        supabase.functions.invoke<any>("read-kpi-app-catalog", {
          body: {
            organization_id: selectedOrg.organization_id,
            maintainer_email: maintainerEmail.trim(),
          },
        }),
        supabase.functions.invoke<any>("read-kpi-app-dimensions", {
          body: { organization_id: selectedOrg.organization_id },
        }),
      ]);
      const cat = catalogRes.data ?? null;
      const dim = dimsRes.data ?? null;
      const catalog = {
        ok: !!cat?.ok,
        code: cat?.code,
        http_status: cat?.http_status,
        row_count: cat?.row_count,
        host: cat?.safe_endpoint_summary?.host,
      };
      const dimensions = {
        ok: !!dim?.ok,
        code: dim?.code,
        http_status: dim?.http_status,
        scenarios: Array.isArray(dim?.scenarios) ? dim.scenarios.length : undefined,
        currencies: Array.isArray(dim?.currencies) ? dim.currencies.length : undefined,
        host: dim?.safe_endpoint_summary?.host,
      };
      setResult({ ok: catalog.ok && dimensions.ok, catalog, dimensions });
    } catch {
      setErrorMessage("MuleSoft KPI connection testing is temporarily unavailable.");
    } finally {
      setRunning(false);
    }
  };

  const success = !!result?.ok;

  return (
    <Card className="mt-3">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">MuleSoft KPI test connection</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {activeOverrideOrg ? (
          <div className="text-xs text-muted-foreground">
            Testing against organization override: <span className="font-medium">
              {activeOverrideOrg.organization_name}
            </span>
          </div>
        ) : (
          <div>
            <Label className="text-xs">Test against organization</Label>
            <select
              className="mt-1 w-full h-9 rounded-md border bg-background px-2 text-sm"
              value={targetOrgId}
              onChange={(e) => {
                setTargetOrgId(e.target.value);
                setResult(null);
                setErrorMessage(null);
              }}
              disabled={running}
            >
              <option value="">Select an organization…</option>
              {organizations.map((o) => (
                <option key={o.organization_id} value={o.organization_id}>
                  {o.organization_name}
                  {!o.is_production ? " (non-prod)" : ""}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <Label className="text-xs">Maintainer email (used for /kpis)</Label>
          <Input
            type="email"
            value={maintainerEmail}
            onChange={(e) => {
              setMaintainerEmail(e.target.value);
              setResult(null);
              setErrorMessage(null);
            }}
            placeholder="user@company.com"
            autoComplete="off"
            spellCheck={false}
            disabled={running}
          />
        </div>

        {isNonProd && (
          <div className="text-xs text-amber-700 dark:text-amber-400">
            Real integration testing is blocked for this non-production organization.
          </div>
        )}
        {!isTenantAdmin && (
          <div className="text-xs text-muted-foreground">
            Tenant Admin authority is required to run the MuleSoft KPI test
            connection.
          </div>
        )}

        <div>
          <Button size="sm" onClick={onRun} disabled={!canRun}>
            {running && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
            Test connection
          </Button>
        </div>

        {errorMessage && (
          <div className="rounded-md border border-destructive/50 bg-destructive/5 p-2 text-xs text-destructive">
            {errorMessage}
          </div>
        )}

        {result && (
          <div
            className={`rounded-md border p-2 text-xs ${
              success
                ? "border-green-500/40 bg-green-500/5 text-green-800 dark:text-green-300"
                : "border-amber-500/40 bg-amber-500/5"
            }`}
          >
            {success ? (
              <div className="space-y-1">
                <div>
                  {"Connection successful. MuleSoft KPI accepted the Tenant credential."}
                </div>
                <div className="text-muted-foreground">
                  /kpis: {result.catalog.row_count ?? 0} row(s)
                  {" · "}
                  /dimensions: {result.dimensions.scenarios ?? 0} scenario(s),
                  {" "}
                  {result.dimensions.currencies ?? 0} currency/-ies
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                <div className="font-medium">Connection failed</div>
                <div className="text-muted-foreground">
                  /kpis: {result.catalog.ok ? "ok" : (result.catalog.code ?? "failed")}
                  {result.catalog.http_status ? ` (HTTP ${result.catalog.http_status})` : ""}
                </div>
                <div className="text-muted-foreground">
                  /dimensions: {result.dimensions.ok ? "ok" : (result.dimensions.code ?? "failed")}
                  {result.dimensions.http_status ? ` (HTTP ${result.dimensions.http_status})` : ""}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}


/**
 * SMTP Test Connection card. Reuses the existing `send-test-email` Edge
 * Function, which resolves credentials from the Tenant SMTP integration
 * (with any Organization override) and always sends to the signed-in
 * admin's own email address — the recipient is enforced server-side
 * and cannot be overridden from the UI.
 */
interface SmtpTestOrg {
  organization_id: string;
  organization_name: string;
  environment_role: string;
  is_production: boolean;
}
function SmtpTestConnectionCard({
  resetKey,
  isEnabled,
  isTenantAdmin,
  activeOverrideOrg,
  organizations,
  contextActiveOrgId,
}: {
  resetKey: string;
  isEnabled: boolean;
  isTenantAdmin: boolean;
  activeOverrideOrg: SmtpTestOrg | null;
  organizations: SmtpTestOrg[];
  contextActiveOrgId: string | null;
}) {
  const defaultTargetId = useMemo(() => {
    if (activeOverrideOrg) return activeOverrideOrg.organization_id;
    const activeInTenant = organizations.find(
      (o) => o.organization_id === contextActiveOrgId,
    );
    if (activeInTenant && activeInTenant.is_production) {
      return activeInTenant.organization_id;
    }
    const firstProd = organizations.find((o) => o.is_production);
    return firstProd?.organization_id ?? "";
  }, [activeOverrideOrg, organizations, contextActiveOrgId]);

  const [targetOrgId, setTargetOrgId] = useState<string>(defaultTargetId);
  const [callerEmail, setCallerEmail] = useState<string>("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<
    | null
    | {
        ok: boolean;
        status?: string;
        code?: string;
        error?: string;
        recipient?: string;
      }
  >(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setResult(null);
    setErrorMessage(null);
    setTargetOrgId(defaultTargetId);
  }, [resetKey, defaultTargetId, isEnabled, isTenantAdmin]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (data?.user?.email) setCallerEmail(data.user.email);
    })();
  }, []);

  const selectedOrg = activeOverrideOrg ??
    organizations.find((o) => o.organization_id === targetOrgId) ?? null;
  const isNonProd = selectedOrg ? !selectedOrg.is_production : false;
  const canRun = isEnabled && isTenantAdmin && !!selectedOrg && !isNonProd &&
    !running;

  const onRun = async () => {
    if (!selectedOrg) return;
    setRunning(true);
    setResult(null);
    setErrorMessage(null);
    try {
      const { data, error } = await supabase.functions.invoke<any>(
        "send-test-email",
        { body: { organization_id: selectedOrg.organization_id } },
      );
      if (error) {
        // Try to extract structured detail (e.g. FunctionsHttpError body).
        let detail: string | null = null;
        try {
          const anyErr = error as any;
          if (anyErr?.context?.text) {
            const txt = await anyErr.context.text();
            const parsed = JSON.parse(txt);
            detail = parsed?.error ?? parsed?.code ?? txt;
          }
        } catch { /* ignore */ }
        setResult({
          ok: false,
          error: detail ?? error.message ?? "Test email failed",
        });
        return;
      }
      const ok = !!data?.success;
      setResult({
        ok,
        status: data?.status,
        code: data?.code,
        error: data?.error,
        recipient: data?.recipient,
      });
    } catch {
      setErrorMessage("SMTP connection testing is temporarily unavailable.");
    } finally {
      setRunning(false);
    }
  };

  const success = !!result?.ok;

  return (
    <Card className="mt-3">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">SMTP test connection</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {activeOverrideOrg ? (
          <div className="text-xs text-muted-foreground">
            Testing against organization override: <span className="font-medium">
              {activeOverrideOrg.organization_name}
            </span>
          </div>
        ) : (
          <div>
            <Label className="text-xs">Test against organization</Label>
            <select
              className="mt-1 w-full h-9 rounded-md border bg-background px-2 text-sm"
              value={targetOrgId}
              onChange={(e) => {
                setTargetOrgId(e.target.value);
                setResult(null);
                setErrorMessage(null);
              }}
              disabled={running}
            >
              <option value="">Select an organization…</option>
              {organizations.map((o) => (
                <option key={o.organization_id} value={o.organization_id}>
                  {o.organization_name}
                  {!o.is_production ? " (non-prod)" : ""}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="rounded-md border bg-muted/30 p-2 text-xs text-muted-foreground">
          The test email will be sent to your signed-in address:{" "}
          <span className="font-medium text-foreground">
            {callerEmail || "(loading…)"}
          </span>
          . Arbitrary recipients are not permitted from this surface.
        </div>

        {isNonProd && (
          <div className="text-xs text-amber-700 dark:text-amber-400">
            Outbound email is blocked for this non-production organization.
          </div>
        )}
        {!isTenantAdmin && (
          <div className="text-xs text-muted-foreground">
            Tenant Admin authority is required to run the SMTP test connection.
          </div>
        )}

        <div>
          <Button size="sm" onClick={onRun} disabled={!canRun}>
            {running && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
            Send test email
          </Button>
        </div>

        {errorMessage && (
          <div className="rounded-md border border-destructive/50 bg-destructive/5 p-2 text-xs text-destructive">
            {errorMessage}
          </div>
        )}

        {result && (
          <div
            className={`rounded-md border p-2 text-xs ${
              success
                ? "border-green-500/40 bg-green-500/5 text-green-800 dark:text-green-300"
                : "border-amber-500/40 bg-amber-500/5"
            }`}
          >
            {success ? (
              <div>
                Test email sent successfully to{" "}
                <span className="font-medium">{result.recipient}</span>. Check
                your inbox (and spam folder).
              </div>
            ) : (
              <div className="space-y-1">
                <div className="font-medium">Test email failed</div>
                <div className="text-muted-foreground">
                  {result.status ? `status: ${result.status}` : null}
                  {result.status && result.code ? " · " : ""}
                  {result.code ? `code: ${result.code}` : null}
                </div>
                {result.error && (
                  <div className="text-muted-foreground break-words">
                    {result.error}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Microsoft Graph Test Connection card. Uses the read-only
 * `microsoft-graph-test-connection` Edge Function which resolves the
 * effective Tenant / Organization Microsoft Graph credential and performs
 * one token acquisition, safe token-claim checks, and a Graph metadata
 * reachability probe. It does NOT test SharePoint or send email.
 */
interface MicrosoftGraphTestOrg {
  organization_id: string;
  organization_name: string;
  environment_role: string;
  is_production: boolean;
}
function MicrosoftGraphTestConnectionCard({
  resetKey,
  isEnabled,
  isTenantAdmin,
  activeOverrideOrg,
  organizations,
  contextActiveOrgId,
  onTested,
}: {
  resetKey: string;
  isEnabled: boolean;
  isTenantAdmin: boolean;
  activeOverrideOrg: MicrosoftGraphTestOrg | null;
  organizations: MicrosoftGraphTestOrg[];
  contextActiveOrgId: string | null;
  onTested: () => void;
}) {
  const defaultTargetId = useMemo(() => {
    if (activeOverrideOrg) return activeOverrideOrg.organization_id;
    const activeInTenant = organizations.find(
      (o) => o.organization_id === contextActiveOrgId,
    );
    if (activeInTenant && activeInTenant.is_production) {
      return activeInTenant.organization_id;
    }
    const firstProd = organizations.find((o) => o.is_production);
    return firstProd?.organization_id ?? "";
  }, [activeOverrideOrg, organizations, contextActiveOrgId]);

  const [targetOrgId, setTargetOrgId] = useState<string>(defaultTargetId);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<MicrosoftGraphConnectionTestResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setResult(null);
    setErrorMessage(null);
    setTargetOrgId(defaultTargetId);
  }, [resetKey, defaultTargetId, isEnabled, isTenantAdmin]);

  const selectedOrg = activeOverrideOrg ??
    organizations.find((o) => o.organization_id === targetOrgId) ?? null;
  const isNonProd = selectedOrg ? !selectedOrg.is_production : false;
  const canRun = isEnabled && isTenantAdmin && !!selectedOrg && !isNonProd &&
    !running;

  const onRun = async () => {
    if (!selectedOrg) return;
    setRunning(true);
    setResult(null);
    setErrorMessage(null);
    try {
      const r = await runMicrosoftGraphConnectionTest(
        selectedOrg.organization_id,
      );
      setResult(r);
      onTested();
    } catch {
      setErrorMessage(MICROSOFT_GRAPH_CONNECTION_TEST_UNAVAILABLE_MESSAGE);
    } finally {
      setRunning(false);
    }
  };

  const success = !!result && result.ok === true &&
    result.classification === "connection_successful";

  return (
    <Card className="mt-3">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Microsoft Graph test connection</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {activeOverrideOrg ? (
          <div className="text-xs text-muted-foreground">
            Testing against organization override: <span className="font-medium">
              {activeOverrideOrg.organization_name}
            </span>
          </div>
        ) : (
          <div>
            <Label className="text-xs">Test against organization</Label>
            <select
              className="mt-1 w-full h-9 rounded-md border bg-background px-2 text-sm"
              value={targetOrgId}
              onChange={(e) => {
                setTargetOrgId(e.target.value);
                setResult(null);
                setErrorMessage(null);
              }}
              disabled={running}
            >
              <option value="">Select an organization…</option>
              {organizations.map((o) => (
                <option key={o.organization_id} value={o.organization_id}>
                  {o.organization_name}
                  {!o.is_production ? " (non-prod)" : ""}
                </option>
              ))}
            </select>
          </div>
        )}

        {isNonProd && (
          <div className="text-xs text-amber-700 dark:text-amber-400">
            Real integration testing is blocked for this non-production organization.
          </div>
        )}
        {!isTenantAdmin && (
          <div className="text-xs text-muted-foreground">
            Tenant Admin authority is required to run the Microsoft Graph test
            connection.
          </div>
        )}

        <div>
          <Button size="sm" onClick={onRun} disabled={!canRun}>
            {running && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
            Test connection
          </Button>
        </div>

        {errorMessage && (
          <div className="rounded-md border border-destructive/50 bg-destructive/5 p-2 text-xs text-destructive">
            {errorMessage}
          </div>
        )}

        {result && (
          <div
            className={`rounded-md border p-2 text-xs ${
              success
                ? "border-green-500/40 bg-green-500/5 text-green-800 dark:text-green-300"
                : "border-amber-500/40 bg-amber-500/5"
            }`}
          >
            {success ? (
              <div>
                {"Connection successful. Microsoft accepted the Tenant credential and the Microsoft Graph application token is valid."}
              </div>
            ) : (
              <div className="space-y-1">
                <div className="font-medium">
                  {result.classification.replace(/_/g, " ")}
                </div>
                <div>{result.recommended_next_action}</div>
                <div className="text-muted-foreground">
                  Token acquired: {result.token_acquired ? "yes" : "no"}
                  {" · "}
                  Token claims match: {result.token_claims_match ? "yes" : "no"}
                  {" · "}
                  Application permissions present: {result.application_permissions_present ? "yes" : "no"}
                  {" · "}
                  Graph API reachable: {result.graph_api_reachable ? "yes" : "no"}
                  {result.http_status ? ` · HTTP ${result.http_status}` : ""}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Phase 4D.14A.7A — SharePoint Test Connection card. Uses the read-only
 * `sharepoint-test-connection` Edge Function which resolves the effective
 * Tenant SharePoint config, reuses the migrated Microsoft Graph credential,
 * and checks site + document-library accessibility.
 */
interface SharePointTestOrg {
  organization_id: string;
  organization_name: string;
  environment_role: string;
  is_production: boolean;
}
function SharePointTestConnectionCard({
  resetKey,
  isEnabled,
  isTenantAdmin,
  activeOverrideOrg,
  organizations,
  contextActiveOrgId,
  onTested,
}: {
  resetKey: string;
  isEnabled: boolean;
  isTenantAdmin: boolean;
  activeOverrideOrg: SharePointTestOrg | null;
  organizations: SharePointTestOrg[];
  contextActiveOrgId: string | null;
  onTested: () => void;
}) {
  const defaultTargetId = useMemo(() => {
    if (activeOverrideOrg) return activeOverrideOrg.organization_id;
    const activeInTenant = organizations.find(
      (o) => o.organization_id === contextActiveOrgId,
    );
    if (activeInTenant && activeInTenant.is_production) {
      return activeInTenant.organization_id;
    }
    const firstProd = organizations.find((o) => o.is_production);
    return firstProd?.organization_id ?? "";
  }, [activeOverrideOrg, organizations, contextActiveOrgId]);

  const [targetOrgId, setTargetOrgId] = useState<string>(defaultTargetId);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SharePointConnectionTestResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setResult(null);
    setErrorMessage(null);
    setTargetOrgId(defaultTargetId);
  }, [resetKey, defaultTargetId, isEnabled, isTenantAdmin]);

  const selectedOrg = activeOverrideOrg ??
    organizations.find((o) => o.organization_id === targetOrgId) ?? null;
  const isNonProd = selectedOrg ? !selectedOrg.is_production : false;
  const canRun = isEnabled && isTenantAdmin && !!selectedOrg && !isNonProd &&
    !running;

  const onRun = async () => {
    if (!selectedOrg) return;
    setRunning(true);
    setResult(null);
    setErrorMessage(null);
    try {
      const r = await runSharePointConnectionTest(selectedOrg.organization_id);
      setResult(r);
      onTested();
    } catch {
      setErrorMessage(SHAREPOINT_CONNECTION_TEST_UNAVAILABLE_MESSAGE);
    } finally {
      setRunning(false);
    }
  };

  const success = !!result && result.ok === true &&
    result.classification === "connection_successful" &&
    result.graph_token_acquired === true &&
    result.site_resolved === true &&
    result.site_matches_config === true &&
    result.libraries_accessible === true;


  return (
    <Card className="mt-3">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">SharePoint test connection</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {activeOverrideOrg ? (
          <div className="text-xs text-muted-foreground">
            Testing against organization override: <span className="font-medium">
              {activeOverrideOrg.organization_name}
            </span>
          </div>
        ) : (
          <div>
            <Label className="text-xs">Test against organization</Label>
            <select
              className="mt-1 w-full h-9 rounded-md border bg-background px-2 text-sm"
              value={targetOrgId}
              onChange={(e) => {
                setTargetOrgId(e.target.value);
                setResult(null);
                setErrorMessage(null);
              }}
              disabled={running}
            >
              <option value="">Select an organization…</option>
              {organizations.map((o) => (
                <option key={o.organization_id} value={o.organization_id}>
                  {o.organization_name}
                  {!o.is_production ? " (non-prod)" : ""}
                </option>
              ))}
            </select>
          </div>
        )}

        {isNonProd && (
          <div className="text-xs text-amber-700 dark:text-amber-400">
            Real integration testing is blocked for this non-production organization.
          </div>
        )}
        {!isTenantAdmin && (
          <div className="text-xs text-muted-foreground">
            Tenant Admin authority is required to run the SharePoint test
            connection.
          </div>
        )}

        <div>
          <Button size="sm" onClick={onRun} disabled={!canRun}>
            {running && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
            Test connection
          </Button>
        </div>

        {errorMessage && (
          <div className="rounded-md border border-destructive/50 bg-destructive/5 p-2 text-xs text-destructive">
            {errorMessage}
          </div>
        )}

        {result && (
          <div
            className={`rounded-md border p-2 text-xs ${
              success
                ? "border-green-500/40 bg-green-500/5 text-green-800 dark:text-green-300"
                : "border-amber-500/40 bg-amber-500/5"
            }`}
          >
            {success ? (
              <div>
                {"Connection successful. The configured SharePoint site and its document libraries are accessible."}
              </div>
            ) : (
              <div className="space-y-1">
                <div className="font-medium">
                  {result.classification.replace(/_/g, " ")}
                </div>
                <div>{result.recommended_next_action}</div>
                <div className="text-muted-foreground">
                  Graph token acquired: {result.graph_token_acquired ? "yes" : "no"}
                  {" · "}
                  Site resolved: {result.site_resolved ? "yes" : "no"}
                  {" · "}
                  Site matches config: {result.site_matches_config ? "yes" : "no"}
                  {" · "}
                  Document libraries accessible: {result.libraries_accessible ? "yes" : "no"}
                  {result.http_status ? ` · HTTP ${result.http_status}` : ""}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}


/**
 * Phase 4D.14A.8A — Azure OpenAI endpoint configuration card.
 *
 * The Azure OpenAI resource endpoint is non-secret configuration metadata.
 * Tenant Admins may view and edit it; nothing here reveals the API key.
 * Persistence goes through the protected RPC
 * `tenant_admin_update_azure_openai_endpoint`, which validates the endpoint
 * server-side and writes an audit record.
 */
function AzureOpenAiEndpointCard({
  integrationId,
  currentEndpoint,
  disabled,
  onSaved,
}: {
  integrationId: string;
  currentEndpoint: string | null;
  disabled?: boolean;
  onSaved: () => void;
}) {
  const [value, setValue] = useState<string>(currentEndpoint ?? "");
  const [reason, setReason] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setValue(currentEndpoint ?? "");
  }, [currentEndpoint, integrationId]);

  const configured = !!currentEndpoint && currentEndpoint.length > 0;

  const onSave = async () => {
    setSaving(true);
    try {
      const { error } = await (supabase.rpc as any)(
        "tenant_admin_update_azure_openai_endpoint",
        {
          _integration_id: integrationId,
          _endpoint: value.trim(),
          _reason: reason.trim() || null,
        },
      );
      if (error) throw error;
      toast({ title: "Azure OpenAI endpoint saved." });
      setReason("");
      onSaved();
    } catch (e: any) {
      const msg = /azure_openai_endpoint_invalid/.test(String(e?.message ?? ""))
        ? "Endpoint must be an HTTPS URL under *.openai.azure.com or *.services.ai.azure.com."
        : "Failed to save Azure OpenAI endpoint.";
      toast({ title: msg, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="mt-3">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Azure OpenAI configuration</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div>
          <Label className="text-xs">Azure OpenAI endpoint</Label>
          <Input
            className="mt-1"
            type="url"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="https://<resource>.openai.azure.com"
            autoComplete="off"
            spellCheck={false}
            disabled={disabled || saving}
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            Non-secret. Must be HTTPS under <code>*.openai.azure.com</code> or{" "}
            <code>*.services.ai.azure.com</code>. Model deployments will be
            mapped in a later AI-provider step.
          </p>
        </div>
        <Input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (optional, audit only)"
          className="h-8 text-xs"
          disabled={disabled || saving}
        />
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={onSave}
            disabled={disabled || saving || value.trim().length === 0 ||
              value.trim() === (currentEndpoint ?? "")}
          >
            {saving && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
            {configured ? "Update endpoint" : "Save endpoint"}
          </Button>
          {configured && (
            <span className="text-[11px] text-muted-foreground">
              Current: <span className="font-mono">{currentEndpoint}</span>
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Phase 4D.14A.8A — Azure OpenAI Test Connection card.
 *
 * Read-only probe of `GET {endpoint}/openai/v1/models` via the
 * `azure-openai-test-connection` Edge Function. Never generates content and
 * never surfaces model names/IDs, deployments, endpoints, response bodies,
 * raw client-library errors, Tenant/Organization identifiers, or secret
 * material.
 */
interface AzureOpenAiTestOrg {
  organization_id: string;
  organization_name: string;
  environment_role: string;
  is_production: boolean;
}
function AzureOpenAiTestConnectionCard({
  resetKey,
  isEnabled,
  isTenantAdmin,
  activeOverrideOrg,
  organizations,
  contextActiveOrgId,
  onTested,
}: {
  resetKey: string;
  isEnabled: boolean;
  isTenantAdmin: boolean;
  activeOverrideOrg: AzureOpenAiTestOrg | null;
  organizations: AzureOpenAiTestOrg[];
  contextActiveOrgId: string | null;
  onTested: () => void;
}) {
  const defaultTargetId = useMemo(() => {
    if (activeOverrideOrg) return activeOverrideOrg.organization_id;
    const activeInTenant = organizations.find(
      (o) => o.organization_id === contextActiveOrgId,
    );
    if (activeInTenant && activeInTenant.is_production) {
      return activeInTenant.organization_id;
    }
    const firstProd = organizations.find((o) => o.is_production);
    return firstProd?.organization_id ?? "";
  }, [activeOverrideOrg, organizations, contextActiveOrgId]);

  const [targetOrgId, setTargetOrgId] = useState<string>(defaultTargetId);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AzureOpenAiConnectionTestResult | null>(
    null,
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setResult(null);
    setErrorMessage(null);
    setTargetOrgId(defaultTargetId);
  }, [resetKey, defaultTargetId, isEnabled, isTenantAdmin]);

  const selectedOrg = activeOverrideOrg ??
    organizations.find((o) => o.organization_id === targetOrgId) ?? null;
  const isNonProd = selectedOrg ? !selectedOrg.is_production : false;
  const canRun = isEnabled && isTenantAdmin && !!selectedOrg && !isNonProd &&
    !running;

  const onRun = async () => {
    if (!selectedOrg) return;
    setRunning(true);
    setResult(null);
    setErrorMessage(null);
    try {
      const r = await runAzureOpenAiConnectionTest(
        selectedOrg.organization_id,
      );
      setResult(r);
      onTested();
    } catch {
      setErrorMessage(AZURE_OPENAI_CONNECTION_TEST_UNAVAILABLE_MESSAGE);
    } finally {
      setRunning(false);
    }
  };

  const success = !!result && result.ok === true &&
    result.classification === "connection_successful";

  return (
    <Card className="mt-3">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Azure OpenAI test connection</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-[11px] text-muted-foreground">
          This read-only test validates the effective Azure OpenAI endpoint and
          API key. It does not generate content and does not verify the model
          deployments required by individual BTPM AI features.
        </p>
        {activeOverrideOrg ? (
          <div className="text-xs text-muted-foreground">
            Testing against organization override:{" "}
            <span className="font-medium">
              {activeOverrideOrg.organization_name}
            </span>
          </div>
        ) : (
          <div className="grid gap-2 md:grid-cols-[1fr_auto] items-end">
            <div>
              <Label className="text-xs">Test against organization</Label>
              <select
                className="mt-1 w-full h-9 rounded-md border bg-background px-2 text-sm"
                value={targetOrgId}
                onChange={(e) => {
                  setTargetOrgId(e.target.value);
                  setResult(null);
                  setErrorMessage(null);
                }}
                disabled={running}
              >
                <option value="">Select an organization…</option>
                {organizations.map((o) => (
                  <option key={o.organization_id} value={o.organization_id}>
                    {o.organization_name}
                    {!o.is_production ? " (non-prod)" : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {isNonProd && (
          <div className="text-xs text-amber-700 dark:text-amber-400">
            Real integration testing is blocked for this non-production
            organization.
          </div>
        )}
        {!isTenantAdmin && (
          <div className="text-xs text-muted-foreground">
            Tenant Admin authority is required to run the Azure OpenAI test
            connection.
          </div>
        )}

        <div>
          <Button size="sm" onClick={onRun} disabled={!canRun}>
            {running && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
            Test connection
          </Button>
        </div>

        {errorMessage && (
          <div className="rounded-md border border-destructive/50 bg-destructive/5 p-2 text-xs text-destructive">
            {errorMessage}
          </div>
        )}

        {result && (
          <div
            className={`rounded-md border p-2 text-xs ${
              success
                ? "border-green-500/40 bg-green-500/5 text-green-800 dark:text-green-300"
                : "border-amber-500/40 bg-amber-500/5"
            }`}
          >
            {success ? (
              <div>
                {"Connection successful. Azure OpenAI accepted the Tenant credential."}
              </div>
            ) : (
              <div className="space-y-1">
                <div className="font-medium">
                  {result.classification.replace(/_/g, " ")}
                </div>
                <div>{result.recommended_next_action}</div>
                <div className="text-muted-foreground">
                  Credential accepted:{" "}
                  {result.credential_accepted ? "yes" : "no"}
                  {" · "}
                  API accessible: {result.api_accessible ? "yes" : "no"}
                  {result.http_status ? ` · HTTP ${result.http_status}` : ""}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default TenantIntegrationSecretSetupDialog;

/**
 * Phase 4D.14A.8B.2A — Azure OpenAI deployment mapping card.
 *
 * Tenant-Admin-only editor for the BTPM model → Azure deployment mappings.
 * Reads/writes only via the protected RPCs. Never exposes secrets, endpoint,
 * or full config_metadata.
 */
interface AzureDeploymentMapping {
  model_key: string;
  display_label: string;
  usage: "text" | "embedding";
  deployment_name: string | null;
}

function AzureOpenAiDeploymentMappingsCard({
  integrationId,
  disabled,
}: {
  integrationId: string;
  disabled?: boolean;
}) {
  const qc = useQueryClient();
  const queryKey = ["tenant-admin-azure-openai-deployments", integrationId];

  const mappingsQuery = useQuery({
    queryKey,
    enabled: !!integrationId,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)(
        "tenant_admin_get_azure_openai_deployments",
        { _integration_id: integrationId },
      );
      if (error) throw error;
      const row = (data ?? {}) as {
        mappings?: AzureDeploymentMapping[];
        required_count?: number;
        configured_count?: number;
        complete?: boolean;
      };
      return {
        mappings: row.mappings ?? [],
        required: row.required_count ?? 0,
        configured: row.configured_count ?? 0,
        complete: !!row.complete,
      };
    },
  });

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const m of mappingsQuery.data?.mappings ?? []) {
      next[m.model_key] = m.deployment_name ?? "";
    }
    setDrafts(next);
  }, [mappingsQuery.data, integrationId]);

  const mappings = mappingsQuery.data?.mappings ?? [];
  const required = mappingsQuery.data?.required ?? 0;
  const configuredNow = Object.values(drafts).filter((v) => v.trim().length > 0).length;

  const allFilled = mappings.length > 0 &&
    mappings.every((m) => (drafts[m.model_key] ?? "").trim().length > 0);

  const dirty = mappings.some(
    (m) => (drafts[m.model_key] ?? "").trim() !== (m.deployment_name ?? ""),
  );

  const onSave = async () => {
    if (!allFilled) return;
    setSaving(true);
    try {
      const payload: Record<string, string> = {};
      for (const m of mappings) payload[m.model_key] = (drafts[m.model_key] ?? "").trim();
      const { error } = await (supabase.rpc as any)(
        "tenant_admin_update_azure_openai_deployments",
        {
          _integration_id: integrationId,
          _deployments: payload,
          _reason: reason.trim() || null,
        },
      );
      if (error) throw error;
      toast({ title: "Azure OpenAI model deployments saved." });
      setReason("");
      qc.invalidateQueries({ queryKey });
    } catch (e: any) {
      const msg = String(e?.message ?? "");
      let human = "Failed to save Azure OpenAI deployment mappings.";
      if (/azure_openai_deployments_unknown_key/.test(msg)) human = "One or more mapping keys are not recognized.";
      else if (/azure_openai_deployments_missing_key/.test(msg)) human = "All required model deployments must be provided.";
      else if (/azure_openai_deployments_invalid_value/.test(msg)) human = "Deployment names must be 1–128 characters and cannot contain control characters or / \\ ? #.";
      else if (/azure_openai_deployments_invalid/.test(msg)) human = "Invalid mapping payload.";
      toast({ title: human, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="mt-3">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Azure model deployments</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-[11px] text-muted-foreground">
          Azure OpenAI calls use deployment names. Map each BTPM model to the corresponding deployment created in your Azure OpenAI resource.
        </p>
        {mappingsQuery.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <>
            <div className="grid gap-2">
              {mappings.map((m) => (
                <div key={m.model_key}>
                  <Label className="text-xs">
                    {m.display_label}{" "}
                    <span className="text-muted-foreground">
                      ({m.usage === "embedding" ? "embedding" : "text"} · Azure deployment name)
                    </span>
                  </Label>
                  <Input
                    className="mt-1 font-mono text-xs"
                    value={drafts[m.model_key] ?? ""}
                    onChange={(e) =>
                      setDrafts((d) => ({ ...d, [m.model_key]: e.target.value }))
                    }
                    placeholder={`Deployment name for ${m.display_label}`}
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={128}
                    disabled={disabled || saving}
                  />
                </div>
              ))}
            </div>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason (optional, audit only)"
              className="h-8 text-xs"
              disabled={disabled || saving}
            />
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={onSave}
                disabled={disabled || saving || !allFilled || !dirty}
              >
                {saving && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
                Save mappings
              </Button>
              <span className="text-[11px] text-muted-foreground">
                {configuredNow} / {required} configured
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

