/**
 * SP UX correction — TEMPORARY admin-only diagnostics for picker delegated auth.
 *
 * Subscribes to the per-attempt MSAL trace published by `msalClient.ts`. Only
 * shows safe, scrubbed details (stage name, method, error category, redirect
 * URI). Never tokens or account secrets.
 */

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CheckCircle2, ShieldQuestion, XCircle } from "lucide-react";
import {
  getLastPickerAuthTrace,
  subscribePickerAuthTrace,
  type PickerAuthTrace,
} from "@/lib/msalClient";

const STAGE_LABEL: Record<string, string> = {
  config: "Config",
  account_detection: "Account detection",
  silent_token: "Silent token (cached account)",
  sso_silent: "SSO silent (existing MS session)",
  interactive_popup: "Interactive popup",
  picker_launch: "Picker launch",
};

export function PickerAuthDiagnosticsPanel() {
  const [trace, setTrace] = useState<PickerAuthTrace | null>(getLastPickerAuthTrace());

  useEffect(() => subscribePickerAuthTrace(setTrace), []);

  if (!trace) return null;

  const finalOk = trace.stages.every((s) => s.ok !== false) && !!trace.endedAt && !trace.finalCategory;

  return (
    <Card className="border-dashed border-amber-500/40">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <ShieldQuestion className="h-4 w-4 text-amber-600" />
          <CardTitle className="text-base">Picker sign-in diagnostics</CardTitle>
          <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
            temporary · admin-only
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Per-attempt trace of the Microsoft delegated-auth flow used by the
          folder picker. No tokens or secrets are recorded.
        </p>

        <Alert className={finalOk ? "border-emerald-500/30" : "border-amber-500/40"}>
          <AlertTitle className="text-sm">
            Last attempt: {trace.finalCategory ? `failed (${trace.finalCategory})` : finalOk ? "succeeded" : "in progress"}
          </AlertTitle>
          <AlertDescription className="text-xs">
            <div>Redirect URI: <code className="break-all">{trace.redirectUri}</code></div>
            {trace.finalMessage && <div className="mt-1">Detail: {trace.finalMessage}</div>}
          </AlertDescription>
        </Alert>

        <div className="space-y-2">
          {trace.stages.map((s, i) => (
            <div key={i} className="rounded-md border bg-muted/30 p-3 text-xs space-y-1">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 font-medium text-foreground">
                  {s.ok === true ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                  ) : s.ok === false ? (
                    <XCircle className="h-3.5 w-3.5 text-destructive" />
                  ) : (
                    <span className="h-3.5 w-3.5 rounded-full border border-muted-foreground" />
                  )}
                  {STAGE_LABEL[s.name] ?? s.name}
                  {s.method && (
                    <span className="text-muted-foreground font-normal">· {s.method}</span>
                  )}
                </div>
                {s.category && (
                  <Badge variant={s.ok ? "secondary" : "destructive"}>{s.category}</Badge>
                )}
              </div>
              {s.message && <div className="text-muted-foreground">{s.message}</div>}
              {s.details && (
                <pre className="overflow-x-auto whitespace-pre-wrap break-words text-[11px] text-muted-foreground bg-background/60 p-2 rounded">
                  {JSON.stringify(s.details, null, 2)}
                </pre>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
