/**
 * Admin → Power BI → Data scope.
 *
 * Org-admin only. PBI 4.1B: outbound scope is Workspace-only. All Projects
 * in an included Workspace are included automatically. Power BI handles any
 * downstream Project-level report filtering.
 */

import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import {
  getPowerBiDataScope,
  setPowerBiWorkspaceScope,
  type PbiDataScopeResult,
  type PbiDataScopeWorkspace,
} from "@/lib/powerBiDataScopeService";
import { useToast } from "@/hooks/use-toast";

export interface PowerBiDataScopePanelProps {
  organizationId: string;
  onScopeChanged?: () => void;
}

export default function PowerBiDataScopePanel({
  organizationId,
  onScopeChanged,
}: PowerBiDataScopePanelProps) {
  const [data, setData] = useState<PbiDataScopeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const { toast } = useToast();

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await getPowerBiDataScope(organizationId);
      setData(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (organizationId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  const onToggleWorkspace = async (
    ws: PbiDataScopeWorkspace,
    mode: "included" | "excluded",
  ) => {
    setSavingId(ws.workspace_id);
    try {
      await setPowerBiWorkspaceScope(organizationId, ws.workspace_id, mode);
      await load();
      onScopeChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingId(null);
    }
  };

  const summary = data?.summary;

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold text-foreground">
          Power BI data scope
        </h2>
        <p className="text-sm text-muted-foreground">
          Choose which BTPM Workspaces are allowed to be published to Power BI.
          All Projects in an included Workspace are included automatically.
          Power BI handles any Project-level report filtering downstream.
        </p>
      </div>

      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Scope changes apply immediately</AlertTitle>
        <AlertDescription>
          Scope changes apply immediately to the governed BTPM reporting views.
          Power BI reflects the updated scope after its next Import refresh.
        </AlertDescription>
      </Alert>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Could not load or save scope</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between gap-2 flex-wrap">
            <span>Scope summary</span>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={load}
                disabled={loading}
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                Refresh
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {!summary ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <SummaryStat
                  label="Scope configured"
                  value={summary.scope_configured ? "Yes" : "No"}
                  warn={!summary.scope_configured}
                />
                <SummaryStat
                  label="Included workspaces"
                  value={String(summary.included_workspace_count ?? 0)}
                />
                <SummaryStat
                  label="Included projects"
                  value={String(summary.included_project_count ?? 0)}
                />
                <SummaryStat
                  label="Excluded workspaces"
                  value={String(summary.excluded_workspace_count)}
                />
              </div>
              {summary.warning_no_inclusion && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>No workspace is included</AlertTitle>
                  <AlertDescription>
                    Include at least one workspace to allow Power BI reporting.
                  </AlertDescription>
                </Alert>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Workspaces</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {(data?.workspaces ?? []).length === 0 && !loading && (
            <p className="text-muted-foreground">
              No workspaces in this organization.
            </p>
          )}
          <div className="divide-y divide-border">
            {(data?.workspaces ?? []).map((ws) => {
              const saving = savingId === ws.workspace_id;
              return (
                <div key={ws.workspace_id} className="py-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{ws.workspace_name}</span>
                    {ws.is_demo && <Badge variant="outline">Demo</Badge>}
                    <Badge
                      variant={ws.effective_included ? "default" : "secondary"}
                    >
                      {ws.effective_included ? "Included" : "Excluded"}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      Mode: {ws.workspace_scope_mode}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Projects: {ws.project_count_total}
                    </span>
                    <div className="ml-auto flex gap-2">
                      <Button
                        size="sm"
                        variant={
                          ws.workspace_scope_mode === "included"
                            ? "default"
                            : "outline"
                        }
                        disabled={saving}
                        onClick={() => onToggleWorkspace(ws, "included")}
                      >
                        Include
                      </Button>
                      <Button
                        size="sm"
                        variant={
                          ws.workspace_scope_mode === "excluded"
                            ? "destructive"
                            : "outline"
                        }
                        disabled={saving}
                        onClick={() => onToggleWorkspace(ws, "excluded")}
                      >
                        Exclude
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryStat({
  label,
  value,
  warn,
}: {
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div className="border border-border rounded-md p-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={`text-sm font-medium ${
          warn ? "text-destructive" : "text-foreground"
        }`}
      >
        {value}
      </div>
    </div>
  );
}
