/**
 * API-G.5.10B-3A — Reusable, read-only API-client activity panel.
 *
 * Data access is exclusively through the accepted `useApiClientActivity` hook.
 * No Supabase import, no RPC call, no direct table access, no loose typing,
 * no logging, and no raw error rendering.

 */
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useApiClientActivity,
  type ApiClientActivityMode,
  type ApiClientActivityRow,
} from "@/hooks/useApiClientActivity";
import { AdminEmptyState, AdminLoadingCards } from "./SaasAdminShell";

export interface ApiClientActivityPanelProps {
  readonly apiClientId: string;
  readonly mode: ApiClientActivityMode;
  readonly organizationId: string | null;
}

type StatusClass = ApiClientActivityRow["statusClass"];
type ScopeLevel = ApiClientActivityRow["scopeLevel"];
type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

const STATUS_LABELS: Readonly<Record<StatusClass, string>> = {
  informational: "Informational",
  success: "Success",
  redirect: "Redirect",
  client_error: "Client error",
  server_error: "Server error",
};

const STATUS_VARIANTS: Readonly<Record<StatusClass, BadgeVariant>> = {
  informational: "outline",
  success: "default",
  redirect: "secondary",
  client_error: "destructive",
  server_error: "destructive",
};

const SCOPE_LABELS: Readonly<Record<ScopeLevel, string>> = {
  unscoped: "Unscoped",
  tenant: "Tenant",
  organization: "Organization",
  workspace: "Workspace",
  project: "Project",
};

/** Safe local timestamp formatter: never throws, invalid input becomes an em dash. */
export function formatActivityTimestamp(value: string): string {
  try {
    const parsed = new Date(value);
    const time = parsed.getTime();
    if (!Number.isFinite(time)) return "—";
    return parsed.toLocaleString();
  } catch {
    return "—";
  }
}

/** Returns the safe scope identifier for a row, or null when not applicable. */
export function activityScopeIdentifier(row: ApiClientActivityRow): string | null {
  if (row.scopeLevel === "tenant") return row.tenantId;
  if (row.scopeLevel === "organization") return row.organizationId;
  if (row.scopeLevel === "workspace") return row.workspaceId;
  if (row.scopeLevel === "project") return row.projectId;
  return null;
}

export function ApiClientActivityPanel({
  apiClientId,
  mode,
  organizationId,
}: ApiClientActivityPanelProps) {
  const {
    data,
    isLoading,
    isError,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    fetchNextPage,
  } = useApiClientActivity({
    apiClientId,
    mode,
    organizationId,
    enabled: apiClientId.length > 0,
  });

  const rows = data?.pages.flatMap((page) => page.rows) ?? [];

  const description =
    mode === "organization"
      ? "Successful API requests attributed to this Organization."
      : "Successful API requests recorded for this client.";
  const emptyDescription =
    mode === "organization"
      ? "No successful API requests have been attributed to this Organization yet."
      : "No successful API requests have been recorded for this client yet.";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Recent activity</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading && <AdminLoadingCards count={3} />}

        {!isLoading && isError && rows.length === 0 && (
          <p className="text-sm text-muted-foreground">Could not load activity.</p>
        )}

        {!isLoading && !isError && rows.length === 0 && (
          <AdminEmptyState title="No activity recorded" description={emptyDescription} />
        )}


        {rows.length > 0 && (
          <>
            <div className="w-full overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Request</TableHead>
                    <TableHead>Result</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Scope</TableHead>
                    <TableHead>Request ID</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => {
                    const scopeIdentifier = activityScopeIdentifier(row);
                    return (
                      <TableRow key={row.eventId}>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {formatActivityTimestamp(row.eventAt)}
                        </TableCell>
                        <TableCell className="text-xs">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{row.httpMethod}</span>
                            <span className="break-words">{row.routeId}</span>
                          </div>
                          <span className="text-muted-foreground">{row.apiVersion}</span>
                        </TableCell>
                        <TableCell className="text-xs">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge
                              variant={STATUS_VARIANTS[row.statusClass]}
                              className="font-normal"
                            >
                              {STATUS_LABELS[row.statusClass]}
                            </Badge>
                            <span className="text-muted-foreground">{row.httpStatus}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs whitespace-nowrap">
                          {row.durationMs} ms
                        </TableCell>
                        <TableCell className="text-xs">
                          <span>{SCOPE_LABELS[row.scopeLevel]}</span>
                          {scopeIdentifier !== null && (
                            <span className="block font-mono text-muted-foreground break-all">
                              {scopeIdentifier}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground break-all">
                          {row.correlationId ?? "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {isFetchNextPageError && (
              <p className="text-xs text-muted-foreground">Could not load more activity.</p>
            )}

            {hasNextPage && (
              <Button
                variant="outline"
                size="sm"
                disabled={isFetchingNextPage}
                onClick={() => {
                  void fetchNextPage();
                }}
              >
                {isFetchingNextPage ? "Loading…" : "Load more"}
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
