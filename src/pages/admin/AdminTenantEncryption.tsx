import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useActiveContext } from "@/context/ActiveContextProvider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import { SaasAdminShell, AdminLoadingCards, AdminEmptyState } from "./SaasAdminShell";

interface OrgPosture {
  organization_id: string;
  tenant_id: string;
  organization_name: string;
  environment_role: string | null;
  is_production: boolean;
  legacy_org_key_name_present: boolean;
  key_status: string | null;
  key_scope: string | null;
  encryption_model: string | null;
  last_rotated_at: string | null;
  warnings: string[] | null;
}

interface TenantPosture {
  tenant_id: string;
  tenant_name: string;
  tenant_key_status: string | null;
  tenant_key_scope: string | null;
  tenant_key_provider: string | null;
  tenant_key_version: number | null;
  tenant_last_rotated_at: string | null;
  organization_count: number;
  organizations_with_metadata: number;
  organizations_missing_metadata: number;
  production_org_count: number;
  non_production_org_count: number;
  model_status: string | null;
  runtime_model: string | null;
  tenant_key_v1_status: string | null;
  tenant_key_v1_imported: boolean | null;
  tenant_key_v1_import_blocked: boolean | null;
  tenant_key_v1_block_reason_code: string | null;
  active_tenant_key_version: number | null;
  active_tenant_key_status: string | null;
  tenant_key_payload_format_ready: boolean | null;
  runtime_caller_migration_active: boolean | null;
  business_record_reencryption_performed: boolean | null;
  warning_count: number;
  high_gap_count: number;
  updated_at: string | null;
  final_verification_passed?: boolean | null;
  final_legacy_remaining?: number | null;
  final_malformed_remaining?: number | null;
  final_tenant_versioned_unreadable?: number | null;
  final_fields_scanned?: number | null;
  final_tenant_versioned_populated?: number | null;
  legacy_org_keys_retained?: boolean | null;
  retained_legacy_org_key_count?: number | null;
  legacy_key_retirement_readiness?: string | null;
  legacy_key_retirement_action_status?: string | null;
}

interface TenantKeyV1 {
  tenant_id: string;
  key_scope: string | null;
  key_version: number | null;
  key_status: string | null;
  key_provider: string | null;
  legacy_material_imported: boolean;
  legacy_material_equivalence_verified: boolean;
  runtime_caller_migration_active: boolean;
  business_record_reencryption_performed: boolean;
  payload_format_ready: boolean;
  legacy_org_keys_retained: boolean;
  updated_at: string | null;
}

interface PostureResponse {
  tenant: TenantPosture;
  organizations: OrgPosture[];
  tenant_key_v1?: TenantKeyV1 | null;
}

function useEncryptionPosture(tenantId: string | null) {
  return useQuery({
    queryKey: ["tenant-admin-encryption-posture", tenantId],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)(
        "tenant_admin_get_encryption_posture",
        { _tenant_id: tenantId },
      );
      if (error) throw error;
      return data as PostureResponse;
    },
    enabled: !!tenantId,
    staleTime: 30_000,
  });
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold text-foreground mt-1">{value}</p>
    </div>
  );
}

function normalizeOrgEncryptionModel(model: string | null | undefined): string {
  if (!model) return "Unknown";
  if (model === "legacy_org_key") return "Legacy Organization key";
  if (model === "missing_metadata") return "Missing metadata";
  return model.replace(/_/g, " ");
}

function normalizeKeyStatus(status: string | null | undefined): {
  label: string;
  warn: boolean;
} {
  if (!status) return { label: "Unknown", warn: true };
  if (status === "active_legacy_org_key")
    return { label: "Active legacy metadata", warn: false };
  if (status === "missing_metadata") return { label: "Missing metadata", warn: true };
  return { label: status.replace(/_/g, " "), warn: false };
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "Not recorded";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return "Not recorded";
  }
}

function tenantV1StatusLabel(v1: TenantKeyV1 | null | undefined): string {
  if (!v1 || !v1.key_status) return "Not prepared";
  if (v1.key_status === "active_for_encrypt") return "Prepared from legacy material";
  if (v1.key_status === "import_blocked") return "Import blocked";
  return v1.key_status.replace(/_/g, " ");
}

function runtimeModelLabel(model: string | null | undefined): string {
  if (model === "tenant_versioned_runtime") return "Tenant-versioned runtime";
  if (model === "legacy_org_key_model") return "Legacy Organization-key runtime";
  return "Unknown";
}

export default function AdminTenantEncryption() {
  const ctx = useActiveContext();
  const tenantId = ctx.activeTenant?.id ?? null;
  const { data, isLoading, error } = useEncryptionPosture(tenantId);

  const tenant = data?.tenant;
  const orgs = data?.organizations ?? [];
  const v1 = data?.tenant_key_v1 ?? null;
  const v1Blocked = v1?.key_status === "import_blocked";
  const missing = tenant?.organizations_missing_metadata ?? 0;
  const highGaps = tenant?.high_gap_count ?? 0;

  const tenantVersionedActive = tenant?.runtime_model === "tenant_versioned_runtime";
  const businessMigrated = tenant?.business_record_reencryption_performed === true;
  const callersMigrated = tenant?.runtime_caller_migration_active === true;
  const finalPassed = tenant?.final_verification_passed === true;
  const legacyRemaining = tenant?.final_legacy_remaining ?? null;
  const legacyKeysRetained = tenant?.legacy_org_keys_retained !== false;
  const postMigrationGreen =
    tenantVersionedActive && businessMigrated && callersMigrated && finalPassed;

  return (
    <SaasAdminShell
      title="Encryption"
      scope="tenant"
      contextLabel={ctx.activeTenant?.name ?? null}
      crumbs={[{ label: "Tenant", to: "/admin/tenant" }, { label: "Encryption" }]}
    >
      <p className="text-xs text-muted-foreground">
        Read-only tenant encryption posture. Key values, Vault identifiers, and key
        material are never shown.
      </p>

      <Card
        className={
          postMigrationGreen
            ? "border-emerald-500/40 bg-emerald-500/5"
            : "border-primary/40 bg-primary/5"
        }
      >
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <ShieldCheck
              className={
                postMigrationGreen ? "h-5 w-5 text-emerald-500" : "h-5 w-5 text-primary"
              }
            />
            <CardTitle className="text-base">Tenant encryption status</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground space-y-1.5">
          {postMigrationGreen ? (
            <>
              <p className="text-foreground font-medium">
                Tenant-versioned encryption is active.
              </p>
              <p>Business records have been migrated to Tenant-versioned ciphertext.</p>
              <p>Runtime callers have been switched to Tenant-versioned writes.</p>
              <p>
                Final verification found zero legacy encrypted values across{" "}
                {tenant?.final_fields_scanned ?? 0} encrypted fields.
              </p>
              <p>
                Legacy Organization keys are retained for rollback and read
                compatibility pending a separate retirement readiness review.
              </p>
              {v1Blocked && (
                <p className="text-muted-foreground">
                  Tenant key v1 import remains blocked because Organizations use
                  distinct legacy encryption keys. This is expected and does not
                  affect the active Tenant-versioned runtime.
                </p>
              )}
            </>
          ) : (
            <>
              {tenant?.active_tenant_key_version != null ? (
                <p>
                  Tenant key v{tenant.active_tenant_key_version} is available for
                  Tenant-versioned encryption.
                </p>
              ) : (
                <p>Tenant key versioning is not prepared yet.</p>
              )}
              <p>Runtime encryption is not yet on Tenant-versioned writes.</p>
              <p>Business records have not been fully migrated.</p>
              <p>Legacy Organization keys are retained for compatibility.</p>
            </>
          )}
        </CardContent>
      </Card>

      {isLoading && <AdminLoadingCards count={4} />}
      {error && (
        <Card>
          <CardContent className="py-6 text-sm text-destructive">
            Failed to load encryption posture.
          </CardContent>
        </Card>
      )}

      {tenant && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{tenant.tenant_name}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-4">
              <Stat label="Runtime model" value={runtimeModelLabel(tenant.runtime_model)} />
              <Stat label="Tenant key v1" value={tenantV1StatusLabel(v1)} />
              <Stat
                label="Active Tenant key"
                value={
                  tenant.active_tenant_key_version != null
                    ? `v${tenant.active_tenant_key_version} active`
                    : "Not prepared"
                }
              />
              <Stat
                label="Payload format"
                value={tenantVersionedActive ? "Tenant-versioned" : "Legacy"}
              />
              <Stat
                label="Business records migrated"
                value={businessMigrated ? "Yes" : "No"}
              />
              <Stat
                label="Runtime callers migrated"
                value={callersMigrated ? "Yes" : "No"}
              />
              <Stat
                label="Final verification"
                value={finalPassed ? "Passed" : "Pending"}
              />
              <Stat
                label="Legacy values remaining"
                value={legacyRemaining ?? "—"}
              />
              <Stat label="Legacy keys" value={legacyKeysRetained ? "Retained" : "Retired"} />
              <Stat
                label="Retirement readiness"
                value={
                  tenant.legacy_key_retirement_readiness === "ready_for_review"
                    ? "Ready for review"
                    : "Pending migration"
                }
              />
              <Stat label="Retirement action" value="Not approved / Not performed" />
              <Stat label="Organizations" value={tenant.organization_count ?? 0} />
              <Stat label="Organizations with metadata" value={tenant.organizations_with_metadata ?? 0} />
              <Stat label="Missing metadata" value={tenant.organizations_missing_metadata ?? 0} />
              <Stat label="Production environments" value={tenant.production_org_count ?? 0} />
              <Stat label="Non-production environments" value={tenant.non_production_org_count ?? 0} />
              <Stat label="Warnings" value={tenant.warning_count ?? 0} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Metadata coverage</CardTitle>
            </CardHeader>
            <CardContent className="text-xs space-y-2">
              {missing === 0 && highGaps === 0 && (
                <p className="text-foreground">
                  Metadata coverage is complete for current Organizations.
                </p>
              )}
              {missing > 0 && (
                <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-foreground">
                  <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5" />
                  <span>
                    Some Organizations are missing encryption metadata. Address
                    coverage before proceeding with any migration step.
                  </span>
                </div>
              )}
              {highGaps > 0 && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/5 p-2 text-foreground">
                  <AlertTriangle className="h-4 w-4 text-destructive mt-0.5" />
                  <span>
                    Tenant encryption metadata has high-severity gaps.
                  </span>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Organizations / Environments</CardTitle>
            </CardHeader>
            <CardContent>
              {orgs.length === 0 ? (
                <AdminEmptyState
                  title="No Organizations"
                  description="No Organizations were returned for this tenant."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Organization</TableHead>
                      <TableHead>Environment</TableHead>
                      <TableHead>Encryption model</TableHead>
                      <TableHead>Metadata status</TableHead>
                      <TableHead>Isolation status</TableHead>
                      <TableHead>Last rotated</TableHead>
                      <TableHead>Warnings</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orgs.map((o) => {
                      const ks = normalizeKeyStatus(o.key_status);
                      const warnings = o.warnings ?? [];
                      return (
                        <TableRow key={o.organization_id}>
                          <TableCell className="font-medium">{o.organization_name}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <Badge variant={o.is_production ? "default" : "outline"}>
                                {o.is_production ? "Production" : "Non-production"}
                              </Badge>
                              {o.environment_role && (
                                <span className="text-xs text-muted-foreground">
                                  {o.environment_role}
                                </span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-xs">
                            {normalizeOrgEncryptionModel(o.encryption_model)}
                          </TableCell>
                          <TableCell className="text-xs">
                            {ks.warn ? (
                              <Badge variant="destructive">{ks.label}</Badge>
                            ) : (
                              <span>{ks.label}</span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs">
                            {o.legacy_org_key_name_present ? (
                              <span>Organization-isolated</span>
                            ) : (
                              <Badge variant="destructive">Isolation metadata missing</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {formatDate(o.last_rotated_at)}
                          </TableCell>
                          <TableCell>
                            {warnings.length === 0 ? (
                              <span className="text-xs text-muted-foreground">None</span>
                            ) : (
                              <div className="flex gap-1 flex-wrap">
                                {warnings.map((w) => (
                                  <Badge key={w} variant="outline" className="text-xs">
                                    {w.replace(/_/g, " ")}
                                  </Badge>
                                ))}
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </SaasAdminShell>
  );
}
