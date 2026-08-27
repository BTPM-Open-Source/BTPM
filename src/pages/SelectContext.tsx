import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  useActiveContext,
  useAvailableOrganizations,
  useAvailableTenants,
} from "@/context/ActiveContextProvider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check } from "lucide-react";
import { toast } from "sonner";

/**
 * Phase 4D.3 / 4D.3B / 4D.3C — Tenant / Organization switcher.
 *
 * Switches Tenant + Organization/Environment only. Workspace scope is
 * controlled by the sidebar Workspace selector. When only one Tenant and one
 * Organization are accessible, the page renders as a calm read-only current
 * context confirmation rather than a selectable form. Selected/current cards
 * use neutral styling — red/destructive styling is reserved for true errors.
 */
export default function SelectContext() {
  const navigate = useNavigate();
  const {
    activeTenant,
    activeOrganization,
    setActiveContext,
    refresh,
  } = useActiveContext();

  const { data: tenants = [], isLoading: tenantsLoading } = useAvailableTenants();
  const [tenantId, setTenantId] = useState<string | null>(activeTenant?.id ?? null);
  const [orgId, setOrgId] = useState<string | null>(activeOrganization?.id ?? null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!tenantId && tenants.length === 1) setTenantId(tenants[0].tenant_id);
  }, [tenants, tenantId]);

  const { data: orgs = [], isLoading: orgsLoading } = useAvailableOrganizations(tenantId);
  useEffect(() => {
    if (tenantId && !orgs.find((o) => o.organization_id === orgId)) {
      setOrgId(orgs.length === 1 ? orgs[0].organization_id : null);
    }
  }, [orgs, tenantId, orgId]);

  const noAccess = !tenantsLoading && tenants.length === 0;

  // Single-choice mode: exactly one tenant and one organization accessible.
  const singleChoice =
    tenants.length === 1 && orgs.length === 1 && !tenantsLoading && !orgsLoading;

  const isCurrent =
    !!tenantId &&
    !!orgId &&
    tenantId === activeTenant?.id &&
    orgId === activeOrganization?.id;
  const canSwitch = !!tenantId && !!orgId && !isCurrent;

  const goBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate("/");
  };

  const onSwitch = async () => {
    if (!tenantId || !orgId) return;
    setSaving(true);
    try {
      await setActiveContext({
        tenantId,
        organizationId: orgId,
        workspaceId: null,
        isAllWorkspaces: true,
      });
      await refresh();
      toast.success("Organization switched");
      goBack();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to switch organization");
    } finally {
      setSaving(false);
    }
  };

  // Neutral card styling helpers — never destructive.
  const cardBase =
    "rounded-md border p-3 text-left transition-colors";
  const cardIdle = "border-border hover:bg-muted/50";
  const cardSelected = "border-foreground/30 bg-muted/60 ring-1 ring-foreground/10";

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle>Switch organization</CardTitle>
          <p className="text-sm text-muted-foreground pt-1">
            Choose the tenant and organization/environment you want to work in.
            Workspace scope is selected separately from the sidebar.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          {noAccess && (
            <p className="text-sm text-muted-foreground">
              No accessible tenants found. Contact your administrator.
            </p>
          )}

          {/* ---------- Single-choice (read-only) mode ---------- */}
          {singleChoice && (
            <>
              <section className="rounded-md border border-border bg-muted/30 p-4">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Current context
                </h3>
                <div className="grid gap-2 text-sm">
                  <div className="flex items-baseline gap-2">
                    <span className="w-32 shrink-0 text-muted-foreground">Tenant</span>
                    <span className="font-medium">{tenants[0].name}</span>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="w-32 shrink-0 text-muted-foreground">Organization</span>
                    <span className="font-medium">{orgs[0].name}</span>
                    {orgs[0].environment_role === "non_production" && (
                      <Badge
                        variant="outline"
                        className="border-amber-500/70 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                      >
                        {(orgs[0].organization_kind ?? "").toUpperCase() || "NON-PROD"}
                      </Badge>
                    )}
                  </div>
                </div>
              </section>
              <p className="text-xs text-muted-foreground">
                You currently have access to one tenant and one organization.
                Workspace scope is selected separately from the sidebar.
              </p>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="secondary" onClick={goBack}>
                  Done
                </Button>
              </div>
            </>
          )}

          {/* ---------- Multi-choice mode ---------- */}
          {!singleChoice && !noAccess && (
            <>
              {(activeTenant || activeOrganization) && (
                <section className="rounded-md border border-border bg-muted/30 p-3">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Current context
                  </h3>
                  <div className="grid gap-1 text-sm">
                    <div>
                      <span className="text-muted-foreground">Tenant: </span>
                      <span className="font-medium">{activeTenant?.name ?? "—"}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Organization: </span>
                      <span className="font-medium">{activeOrganization?.name ?? "—"}</span>
                    </div>
                  </div>
                </section>
              )}

              {tenants.length > 0 && (
                <section>
                  <h3 className="mb-2 text-sm font-semibold">Tenant</h3>
                  <div className="grid gap-2">
                    {tenants.map((t) => {
                      const selected = tenantId === t.tenant_id;
                      const current = activeTenant?.id === t.tenant_id;
                      return (
                        <button
                          key={t.tenant_id}
                          onClick={() => setTenantId(t.tenant_id)}
                          className={`${cardBase} ${selected ? cardSelected : cardIdle}`}
                        >
                          <div className="flex items-center gap-2">
                            {selected && <Check className="h-4 w-4 text-foreground/70" />}
                            <span className="font-medium">{t.name}</span>
                            {current && (
                              <Badge variant="secondary" className="ml-1 text-[10px]">
                                Current
                              </Badge>
                            )}
                            {selected && !current && (
                              <Badge variant="outline" className="ml-1 text-[10px]">
                                Selected
                              </Badge>
                            )}
                          </div>
                          <div className="ml-6 text-xs text-muted-foreground">{t.slug}</div>
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}

              {tenantId && (
                <section>
                  <h3 className="mb-2 text-sm font-semibold">Organization / Environment</h3>
                  {orgsLoading ? (
                    <p className="text-xs text-muted-foreground">Loading…</p>
                  ) : orgs.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No organizations accessible in this tenant.
                    </p>
                  ) : (
                    <div className="grid gap-2">
                      {orgs.map((o) => {
                        const selected = orgId === o.organization_id;
                        const current = activeOrganization?.id === o.organization_id;
                        return (
                          <button
                            key={o.organization_id}
                            onClick={() => setOrgId(o.organization_id)}
                            className={`${cardBase} ${selected ? cardSelected : cardIdle}`}
                          >
                            <div className="flex items-center gap-2">
                              {selected && <Check className="h-4 w-4 text-foreground/70" />}
                              <span className="font-medium">{o.name}</span>
                              {o.environment_role === "non_production" && (
                                <Badge
                                  variant="outline"
                                  className="border-amber-500/70 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                                >
                                  {(o.organization_kind ?? "").toUpperCase() || "NON-PROD"}
                                </Badge>
                              )}
                              {current && (
                                <Badge variant="secondary" className="ml-1 text-[10px]">
                                  Current
                                </Badge>
                              )}
                              {selected && !current && (
                                <Badge variant="outline" className="ml-1 text-[10px]">
                                  Selected
                                </Badge>
                              )}
                            </div>
                            <div className="ml-6 text-xs text-muted-foreground">{o.slug}</div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </section>
              )}

              <p className="text-xs text-muted-foreground">
                Switching organization will reset workspace scope to All workspaces.
                Use the sidebar Workspace selector to narrow the scope.
              </p>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={goBack}>
                  Cancel
                </Button>
                <Button
                  variant="secondary"
                  disabled={!canSwitch || saving}
                  onClick={onSwitch}
                  title={isCurrent ? "Already the current organization" : undefined}
                >
                  {isCurrent
                    ? "Current organization"
                    : saving
                      ? "Switching…"
                      : "Switch organization"}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
