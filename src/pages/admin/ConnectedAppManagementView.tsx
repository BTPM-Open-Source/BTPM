/**
 * API-ADM.4 — Reusable Connected App management shell.
 *
 * Presentation only, fully controlled by its caller. No ActiveContext, no
 * Supabase import, no admin-role inference, no persistence APIs, and no
 * Workspace / Project / capability mutation RPCs. Activity reads happen inside
 * the accepted `ApiClientActivityPanel`.
 */
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiClientActivityPanel } from "./ApiClientActivityPanel";
import ConnectedAppOrganizationPermissions from "./ConnectedAppOrganizationPermissions";
import ConnectedAppWorkspaceAccess from "./ConnectedAppWorkspaceAccess";



export type ConnectedAppAdminContext = "organization" | "tenant";

export type ConnectedAppManagementTab = "overview" | "access" | "activity";

export interface ConnectedAppManagementTabDefinition {
  readonly value: ConnectedAppManagementTab;
  readonly label: string;
}

export const CONNECTED_APP_MANAGEMENT_TABS: readonly ConnectedAppManagementTabDefinition[] =
  Object.freeze([
    Object.freeze({ value: "overview" as const, label: "Overview" }),
    Object.freeze({ value: "access" as const, label: "Access & permissions" }),
    Object.freeze({ value: "activity" as const, label: "API activity" }),
  ]);

export const DEFAULT_CONNECTED_APP_MANAGEMENT_TAB: ConnectedAppManagementTab = "overview";

/**
 * API-ADM-UX1 — Tenant administration owns Organization connections only.
 * Workspace / Project access and permissions are Organization-scope work, so the
 * Tenant surface never exposes the "Access & permissions" tab.
 */
export function connectedAppManagementTabsForContext(
  context: ConnectedAppAdminContext,
): readonly ConnectedAppManagementTabDefinition[] {
  return context === "tenant"
    ? CONNECTED_APP_MANAGEMENT_TABS.filter((tab) => tab.value !== "access")
    : CONNECTED_APP_MANAGEMENT_TABS;
}

/** Normalizes any untrusted input into an approved tab; anything else is `overview`. */
export function resolveConnectedAppManagementTab(
  value: unknown,
  context: ConnectedAppAdminContext = "organization",
): ConnectedAppManagementTab {
  if (typeof value !== "string") return DEFAULT_CONNECTED_APP_MANAGEMENT_TAB;
  const match = connectedAppManagementTabsForContext(context).find((tab) => tab.value === value);
  return match ? match.value : DEFAULT_CONNECTED_APP_MANAGEMENT_TAB;
}

export interface ConnectedAppManagementApp {
  readonly apiClientId: string;
  readonly clientKey: string;
  readonly displayName: string;
  readonly description: string | null;
  readonly clientLifecycleStatus: string;
  readonly organizationEnablementStatus: string | null;
  readonly activePolicyVersion: string | null;
  readonly enabledWorkspaceCount: number;
  readonly enabledProjectCount: number;
  readonly enabledCapabilityGrantCount: number;
}

export interface ConnectedAppManagementViewProps {
  readonly context: ConnectedAppAdminContext;
  readonly organizationId: string;
  readonly organizationName: string;
  readonly app: ConnectedAppManagementApp;
  readonly activeTab: ConnectedAppManagementTab;
  readonly onTabChange: (tab: ConnectedAppManagementTab) => void;
  /**
   * API-ADM.6A — optional caller-owned connection action. The shell only
   * invokes the callback; the caller owns confirmation and the mutation.
   */
  readonly onRequestDisconnect?: () => void;
  readonly connectionActionPending?: boolean;
  /**
   * API-ADM.7 — optional caller-owned parent summary query key, forwarded to the
   * access / permission children so a successful mutation refreshes the caller's
   * own Connected Apps list. Organization Admin and Tenant Admin both use this;
   * the shell never infers the caller's role.
   */
  readonly parentSummaryQueryKey?: readonly unknown[];
}

/** Friendly Organization connection label for the safe summary status field. */
export function connectedAppConnectionLabel(status: string | null): string {
  if (status === "enabled") return "Connected";
  if (status === "disabled") return "Disabled";
  return "Not connected";
}

function safeCount(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function SummaryRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 py-2 border-b border-border last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm text-foreground text-right">{value}</span>
    </div>
  );
}

export default function ConnectedAppManagementView({
  context,
  organizationId,
  organizationName,
  app,
  activeTab,
  onTabChange,
  onRequestDisconnect,
  connectionActionPending = false,
  parentSummaryQueryKey,
}: ConnectedAppManagementViewProps) {
  const connection = connectedAppConnectionLabel(app.organizationEnablementStatus);
  const workspaces = safeCount(app.enabledWorkspaceCount);
  const projects = safeCount(app.enabledProjectCount);
  const permissions = safeCount(app.enabledCapabilityGrantCount);
  // API-ADM-UX1 — Tenant administration shows connection state only.
  const isTenantContext = context === "tenant";
  const tabs = connectedAppManagementTabsForContext(context);
  const resolvedTab = resolveConnectedAppManagementTab(activeTab, context);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{app.displayName}</h2>
          <p className="text-xs text-muted-foreground">
            {context === "tenant" ? "Tenant administration" : "Organization administration"} ·{" "}
            {organizationName}
          </p>
        </div>
        <Badge variant="outline" className="font-normal">
          {connection}
        </Badge>
      </div>

      <Tabs
        value={resolvedTab}
        onValueChange={(next) => onTabChange(resolveConnectedAppManagementTab(next, context))}
        className="space-y-4"
      >
        <TabsList className="flex w-full flex-wrap justify-start h-auto">
          {tabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview" className="mt-0 space-y-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Application</CardTitle>
              <CardDescription>Summary of this application in {organizationName}.</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <SummaryRow label="Application" value={app.displayName} />
              {app.description !== null && app.description.length > 0 && (
                <SummaryRow label="Description" value={app.description} />
              )}
              <SummaryRow label="Application status" value={app.clientLifecycleStatus} />
              <SummaryRow label="Organization connection" value={connection} />
              <SummaryRow label="Active policy version" value={app.activePolicyVersion ?? "—"} />
              {!isTenantContext && <SummaryRow label="Workspaces enabled" value={workspaces} />}
              {!isTenantContext && <SummaryRow label="Projects enabled" value={projects} />}
              {!isTenantContext && (
                <SummaryRow label="Enabled permissions" value={permissions} />
              )}
              <SummaryRow label="Organization" value={organizationName} />
              <SummaryRow
                label="Application key"
                value={<span className="font-mono text-xs">{app.clientKey}</span>}
              />
            </CardContent>
          </Card>

          {app.organizationEnablementStatus === "enabled" && onRequestDisconnect && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Connection</CardTitle>
                <CardDescription>
                  Disconnecting blocks this application for {organizationName}. Existing Workspace,
                  Project, and permission selections are retained.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={connectionActionPending}
                  onClick={onRequestDisconnect}
                >
                  Disconnect
                </Button>
              </CardContent>
            </Card>
          )}
          {isTenantContext && (
            <p className="text-xs text-muted-foreground">
              Workspace access, Project access and permissions are administered by the Organization
              administrator.
            </p>
          )}
        </TabsContent>

        {!isTenantContext && (
          <TabsContent value="access" className="mt-0 space-y-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Access</CardTitle>
                <CardDescription>Where the application can operate.</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <SummaryRow label="Organization access" value={connection} />
                <SummaryRow label="Workspaces enabled" value={workspaces} />
                <SummaryRow label="Projects enabled" value={projects} />
              </CardContent>
            </Card>

            <ConnectedAppWorkspaceAccess
              organizationId={organizationId}
              apiClientId={app.apiClientId}
              clientLifecycleStatus={app.clientLifecycleStatus}
              organizationEnablementStatus={app.organizationEnablementStatus}
              parentSummaryQueryKey={parentSummaryQueryKey}
            />

            <ConnectedAppOrganizationPermissions
              organizationId={organizationId}
              apiClientId={app.apiClientId}
              clientLifecycleStatus={app.clientLifecycleStatus}
              organizationEnablementStatus={app.organizationEnablementStatus}
              parentSummaryQueryKey={parentSummaryQueryKey}
            />
          </TabsContent>
        )}



        <TabsContent value="activity" className="mt-0">
          <ApiClientActivityPanel
            apiClientId={app.apiClientId}
            mode="organization"
            organizationId={organizationId}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
