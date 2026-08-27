/**
 * PBI 5.1B2A — One-time Power BI reporting credential result dialog.
 *
 * Renders the sensitive one-time password ONLY inside this dialog. The value
 * is never logged, persisted, copied into toasts, or written to any browser
 * storage. Closing the dialog must call `onFinish` so the parent discards the
 * result from memory.
 */
import { useEffect, useState } from "react";
import { Copy, ShieldAlert, CheckCircle2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "@/hooks/use-toast";
import type { PowerBiReportingLifecycleResult } from "@/lib/admin/powerBiReportingCredentialLifecycleService";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  result: PowerBiReportingLifecycleResult | null;
  onFinish: () => void;
}

function buildUsername(loginRole: string | null): string {
  const role = loginRole ?? "";
  const projectId =
    (import.meta.env.VITE_SUPABASE_PROJECT_ID as string | undefined) ??
    "<Supabase project reference>";
  return `${role}.${projectId}`;
}

async function copyValue(value: string, label: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast({ title: `${label} copied` });
  } catch {
    toast({
      title: `Could not copy ${label.toLowerCase()}`,
      variant: "destructive",
    });
  }
}

export function PowerBiReportingCredentialDialog({
  open,
  onOpenChange,
  result,
  onFinish,
}: Props) {
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    if (!open) setAcknowledged(false);
  }, [open]);

  const handleFinish = () => {
    setAcknowledged(false);
    onFinish();
    onOpenChange(false);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setAcknowledged(false);
      onFinish();
    }
    onOpenChange(next);
  };

  if (!result) return null;

  const hasPassword = Boolean(result.one_time_password);
  const username = buildUsername(result.login_role_name);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        {hasPassword ? (
          <>
            <DialogHeader>
              <DialogTitle>Reporting credential ready</DialogTitle>
              <DialogDescription>
                This password is shown once and cannot be recovered. Save it
                in your secure vault before finishing.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">
                  Reporting username
                </Label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded bg-muted px-2 py-1.5 text-xs font-mono break-all">
                    {username}
                  </code>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => copyValue(username, "Username")}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">
                  One-time password
                </Label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded bg-muted px-2 py-1.5 text-xs font-mono break-all">
                    {result.one_time_password}
                  </code>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      copyValue(result.one_time_password ?? "", "Password")
                    }
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 text-xs rounded border p-3">
                <div>
                  <div className="text-muted-foreground">Port</div>
                  <div className="font-medium">5432</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Database</div>
                  <div className="font-medium">postgres</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Connectivity</div>
                  <div className="font-medium">Import</div>
                </div>
              </div>

              {result.security_drift_detected && (
                <Alert variant="destructive">
                  <ShieldAlert className="h-4 w-4" />
                  <AlertTitle>Security drift detected</AlertTitle>
                  <AlertDescription>
                    The reporting substrate reported drift during this action.
                    Review the readiness panel after finishing.
                  </AlertDescription>
                </Alert>
              )}

              <div className="flex items-start gap-2 pt-1">
                <Checkbox
                  id="ack-saved-credential"
                  checked={acknowledged}
                  onCheckedChange={(v) => setAcknowledged(v === true)}
                />
                <Label
                  htmlFor="ack-saved-credential"
                  className="text-sm font-normal leading-tight"
                >
                  I have saved this credential securely
                </Label>
              </div>
            </div>

            <DialogFooter>
              <Button onClick={handleFinish} disabled={!acknowledged}>
                Finish
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-primary" />
                Action completed
              </DialogTitle>
              <DialogDescription>
                {result.action === "disable" && "Reporting login disabled."}
                {result.action === "revoke" && "Reporting credential revoked."}
                {result.action === "activate" && "Reporting mapping activated."}
                {!["disable", "revoke", "activate"].includes(result.action) &&
                  "Action completed."}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2 text-sm">
              <div className="rounded border p-3 space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Mapping state</span>
                  <span className="font-medium">
                    {result.mapping_state ?? "—"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Credential state</span>
                  <span className="font-medium">
                    {result.credential_state ?? "—"}
                  </span>
                </div>
                {typeof result.terminated_session_count === "number" && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      Terminated sessions
                    </span>
                    <span className="font-medium">
                      {result.terminated_session_count}
                    </span>
                  </div>
                )}
              </div>

              {result.security_drift_detected && (
                <Alert variant="destructive">
                  <ShieldAlert className="h-4 w-4" />
                  <AlertTitle>Security drift detected</AlertTitle>
                  <AlertDescription>
                    The action completed but the reporting substrate reported
                    drift. Review the readiness panel.
                  </AlertDescription>
                </Alert>
              )}
            </div>

            <DialogFooter>
              <Button onClick={handleFinish}>Close</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
