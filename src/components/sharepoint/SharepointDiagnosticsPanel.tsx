/**
 * SP.3b — TEMPORARY admin-only diagnostics panel.
 *
 * Renders the result of `diagnose_workspace_binding`. No secrets/tokens are
 * shown — the server only returns scrubbed claims (audience, app id, roles).
 */

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle, CheckCircle2, Stethoscope, XCircle } from "lucide-react";
import {
  diagnoseWorkspaceBinding,
  type DiagnosticsResult,
} from "@/lib/sharepointDiagnosticsService";
import { useToast } from "@/hooks/use-toast";

interface Props {
  bindingId: string;
}

const CATEGORY_LABEL: Record<string, string> = {
  ok: "OK",
  missing_env_config: "Missing env config",
  token_acquisition_failed: "Token acquisition failed",
  token_not_app_only: "Token is not app-only",
  token_no_relevant_roles: "Token has no SharePoint app roles",
  site_lookup_denied: "Site lookup denied (401/403)",
  site_lookup_not_found: "Site lookup failed / not found",
  drives_enumeration_denied: "Drives enumeration denied (401/403)",
  drives_enumeration_failed: "Drives enumeration failed",
  drives_enumeration_empty: "Drives enumeration returned zero libraries",
  library_match_failed: "Library matching failed",
  library_match_ambiguous: "Library matching ambiguous",
  library_match_site_mismatch: "Library URL is on a different site",
};

export function SharepointDiagnosticsPanel({ bindingId }: Props) {
  const { toast } = useToast();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<DiagnosticsResult | null>(null);

  const run = async () => {
    setRunning(true);
    try {
      const r = await diagnoseWorkspaceBinding(bindingId);
      setResult(r);
    } catch (e) {
      toast({
        title: "Diagnostics error",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card className="border-dashed border-amber-500/40">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Stethoscope className="h-4 w-4 text-amber-600" />
            <CardTitle className="text-base">SharePoint diagnostics</CardTitle>
            <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
              temporary · admin-only
            </Badge>
          </div>
          <Button size="sm" variant="outline" onClick={run} disabled={running}>
            {running ? "Running…" : "Run SharePoint diagnostics"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Server-side, app-only Microsoft Graph check. No tokens or secrets are
          returned to the browser. Use this to determine why live validation is
          failing (token, app role, site access, drives, or library matching).
        </p>

        {result && (
          <>
            <Alert
              className={
                result.overall_category === "ok"
                  ? "border-emerald-500/30"
                  : "border-amber-500/40"
              }
            >
              {result.overall_category === "ok" ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-amber-600" />
              )}
              <AlertTitle>
                Overall: {CATEGORY_LABEL[result.overall_category] ?? result.overall_category}
              </AlertTitle>
              <AlertDescription className="text-xs">
                Access mode:{" "}
                <strong>
                  {result.is_app_only === true
                    ? "app-only (not user-delegated)"
                    : result.is_app_only === false
                      ? "NOT app-only (unexpected)"
                      : "unknown"}
                </strong>
              </AlertDescription>
            </Alert>

            <div className="space-y-2">
              {result.stages.map((s, i) => (
                <div
                  key={i}
                  className="rounded-md border bg-muted/30 p-3 text-xs space-y-1"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 font-medium text-foreground">
                      {s.ok ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5 text-destructive" />
                      )}
                      {s.name}
                    </div>
                    <Badge variant={s.ok ? "secondary" : "destructive"}>
                      {CATEGORY_LABEL[s.category] ?? s.category}
                    </Badge>
                  </div>
                  <pre className="overflow-x-auto whitespace-pre-wrap break-words text-[11px] text-muted-foreground bg-background/60 p-2 rounded">
                    {JSON.stringify(s.details, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
