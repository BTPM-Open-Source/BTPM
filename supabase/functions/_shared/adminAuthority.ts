// Provider-neutral Tenant Admin / Organization Admin authority evaluator.
//
// Shared by integration and KPI Edge Functions that accept either:
// - Organization Admin authority for the target Organization; or
// - active Tenant Owner/Admin authority for the owning Tenant.
//
// Organization non-existence is collapsed into denied to prevent disclosure.

export interface AuthorityCheckDeps {
  fetchOrgTenant: (
    orgId: string,
  ) => Promise<{ tenantId: string | null; error: boolean }>;
  isOrgAdmin: (userId: string, orgId: string) => Promise<
    { value: boolean | null; error: boolean }
  >;
  isTenantAdmin: (userId: string, tenantId: string) => Promise<
    { value: boolean | null; error: boolean }
  >;
}

export type AuthorityOutcome =
  | { outcome: "allowed_org_admin"; tenantId: string | null }
  | { outcome: "allowed_tenant_admin"; tenantId: string }
  | { outcome: "infra_failure" }
  | { outcome: "denied" };

export async function evaluateAuthority(
  userId: string,
  organizationId: string,
  deps: AuthorityCheckDeps,
): Promise<AuthorityOutcome> {
  const orgLookup = await deps.fetchOrgTenant(organizationId);
  if (orgLookup.error) return { outcome: "infra_failure" };
  const tenantId = orgLookup.tenantId;

  const orgAdminP = deps.isOrgAdmin(userId, organizationId);
  const tenantAdminP = tenantId
    ? deps.isTenantAdmin(userId, tenantId)
    : Promise.resolve({ value: false as boolean | null, error: false });
  const [orgAdmin, tenantAdmin] = await Promise.all([orgAdminP, tenantAdminP]);

  // A proven role wins over an unrelated failed role check.
  if (orgAdmin.value === true) {
    return { outcome: "allowed_org_admin", tenantId };
  }
  if (tenantId && tenantAdmin.value === true) {
    return { outcome: "allowed_tenant_admin", tenantId };
  }
  if (orgAdmin.error || tenantAdmin.error) {
    return { outcome: "infra_failure" };
  }
  return { outcome: "denied" };
}
