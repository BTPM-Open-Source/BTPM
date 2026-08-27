import { useActiveContext } from "@/context/ActiveContextProvider";
import { SaasAdminShell, AdminEmptyState } from "./SaasAdminShell";
import ConnectedAppsOrganizationSurface from "./ConnectedAppsOrganizationSurface";

/**
 * Step API-ADM.8 — Organization Admin Connected Apps caller.
 *
 * Organization-context responsibilities only: the active Organization from
 * ActiveContext, the admin shell, and the caller-owned parent summary key.
 * All list / connect / reconnect / manage / disconnect orchestration lives in
 * the shared `ConnectedAppsOrganizationSurface`.
 */
export default function AdminConnectedApps() {
  const ctx = useActiveContext();
  const organizationId = ctx.activeOrganization?.id ?? null;
  const organizationName = ctx.activeOrganization?.name ?? null;

  return (
    <SaasAdminShell
      title="Connected Apps"
      scope="organization"
      contextLabel={organizationName}
      crumbs={[{ label: "Connected Apps" }]}
    >
      <p className="text-xs text-muted-foreground">
        Control which registered applications are connected to the active Organization.
      </p>

      {organizationId ? (
        <ConnectedAppsOrganizationSurface
          context="organization"
          organizationId={organizationId}
          organizationName={organizationName ?? ""}
          parentSummaryQueryKey={["connected-apps", organizationId]}
        />
      ) : (
        <AdminEmptyState
          title="No active Organization"
          description="Select an Organization from the context selector to administer its Connected Apps."
        />
      )}
    </SaasAdminShell>
  );
}
