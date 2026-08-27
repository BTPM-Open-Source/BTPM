/**
 * PBI 5.1A — Power BI Direct-reporting readiness panel.
 *
 * Read-only surface for Tenant Admins. Never displays credentials, Vault IDs,
 * or fingerprints. Reports whether the Tenant's dedicated reporting login is
 * provisioned, hardened, verified, and mapped, plus safe Workspace-only
 * reporting coverage across the Tenant's Organizations.
 */
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Info,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Database,
  Copy,
  Ban,
  ShieldOff,
  Loader2,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import {
  getPowerBiReportingReadiness,
  type PowerBiReportingReadiness,
  type PowerBiReportingReadinessStatus,
} from "@/lib/admin/powerBiReportingReadinessService";
import {
  managePowerBiReportingIdentity,
  type PowerBiReportingLifecycleAction,
  type PowerBiReportingLifecycleResult,
} from "@/lib/admin/powerBiReportingCredentialLifecycleService";
import { PowerBiReportingCredentialDialog } from "./PowerBiReportingCredentialDialog";

interface Props {
  tenantId: string;
}

function StatusBadge({ status }: { status: PowerBiReportingReadinessStatus }) {
  switch (status) {
    case "ready":
      return (
        <Badge className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="mr-1 h-3 w-3" /> Ready
        </Badge>
      );
    case "disabled":
      return (
        <Badge variant="outline" className="border-muted-foreground/40 text-muted-foreground">
          <Ban className="mr-1 h-3 w-3" /> Disabled
        </Badge>
      );
    case "revoked":
      return (
        <Badge variant="outline" className="border-destructive/50 text-destructive">
          <ShieldOff className="mr-1 h-3 w-3" /> Revoked
        </Badge>
      );
    case "not_provisioned":
      return (
        <Badge variant="outline" className="border-muted-foreground/40 text-muted-foreground">
          <XCircle className="mr-1 h-3 w-3" /> Not provisioned
        </Badge>
      );
    case "attention_required":
    default:
      return (
        <Badge className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mr-1 h-3 w-3" /> Attention required
        </Badge>
      );
  }
}

function CheckRow({ label, ok, hint }: { label: string; ok: boolean; hint?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 text-xs">
      <div>
        <div className="font-medium">{label}</div>
        {hint && <div className="text-muted-foreground">{hint}</div>}
      </div>
      {ok ? (
        <Badge className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="mr-1 h-3 w-3" /> OK
        </Badge>
      ) : (
        <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mr-1 h-3 w-3" /> Pending
        </Badge>
      )}
    </div>
  );
}

function fmtWhen(iso: string | null): string {
  if (!iso) return "—";
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return iso;
  }
}

interface ActionMeta {
  label: string;
  description: string;
  destructive?: boolean;
  requiresAck?: boolean;
  ackText?: string;
  confirmLabel: string;
}

const ACTION_META: Record<PowerBiReportingLifecycleAction, ActionMeta> = {
  provision: {
    label: "Provision reporting credential",
    confirmLabel: "Provision",
    description:
      "Create a dedicated Tenant reporting credential. The password will be shown once. Tenant data remains unavailable until activation.",
  },
  rotate: {
    label: "Rotate password",
    confirmLabel: "Rotate",
    description:
      "The current password will stop working immediately. Reporting remains fail-closed until the new credential is verified and activated.",
  },
  disable: {
    label: "Disable reporting",
    confirmLabel: "Disable reporting",
    destructive: true,
    description:
      "Disable new logins and terminate active sessions for this Tenant reporting identity.",
  },
  enable: {
    label: "Re-enable reporting",
    confirmLabel: "Re-enable",
    description:
      "Generate a new one-time password. Reporting remains fail-closed until verification and activation.",
  },
  activate: {
    label: "Activate after verification",
    confirmLabel: "Activate",
    requiresAck: true,
    ackText:
      "I confirm that Power BI connected with the new credential while the mapping was disabled, returned zero governed reporting rows, and canonical source access remained denied.",
    description:
      "Activate the Tenant reporting mapping after out-of-band verification.",
  },
  revoke: {
    label: "Revoke reporting credential",
    confirmLabel: "Revoke",
    destructive: true,
    requiresAck: true,
    ackText:
      "I understand this action cannot be reversed in the current lifecycle.",
    description:
      "Permanently revoke this reporting credential, terminate active sessions, and remove its inherited reporting membership. This action cannot be reversed in the current lifecycle.",
  },
};

function computeAvailableActions(
  data: PowerBiReportingReadiness | undefined,
): PowerBiReportingLifecycleAction[] {
  if (!data) return [];
  const mapping = data.identity.mapping_state;
  const cred = data.identity.credential_state;
  if (!mapping || mapping === "not_provisioned") return ["provision"];
  if (mapping === "active") return ["rotate", "disable", "revoke"];
  if (mapping === "disabled") {
    if (cred === "pending_activation") return ["activate", "revoke"];
    if (cred === "disabled") return ["enable", "revoke"];
    return ["revoke"];
  }
  if (mapping === "revoked" || cred === "revoked") return [];
  return [];
}

export function PowerBiReportingReadinessPanel({ tenantId }: Props) {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery<PowerBiReportingReadiness>({
    queryKey: ["pbi-reporting-readiness", tenantId],
    queryFn: () => getPowerBiReportingReadiness(tenantId),
    enabled: !!tenantId,
    staleTime: 30_000,
  });

  const projectRef = (import.meta.env.VITE_SUPABASE_PROJECT_ID as string | undefined) ?? null;

  const suggestedUsername = useMemo(() => {
    const role = data?.identity.login_role_name;
    if (!role) return null;
    return projectRef ? `${role}.${projectRef}` : `${role}.<Supabase project reference>`;
  }, [data?.identity.login_role_name, projectRef]);

  const [selectedAction, setSelectedAction] =
    useState<PowerBiReportingLifecycleAction | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [inProgress, setInProgress] = useState(false);
  const [lifecycleResult, setLifecycleResult] =
    useState<PowerBiReportingLifecycleResult | null>(null);
  const [resultOpen, setResultOpen] = useState(false);

  const availableActions = computeAvailableActions(data);
  const isRevoked =
    data?.identity.mapping_state === "revoked" ||
    data?.identity.credential_state === "revoked";

  const openAction = (action: PowerBiReportingLifecycleAction) => {
    setSelectedAction(action);
    setAcknowledged(false);
    setConfirmOpen(true);
  };

  const closeConfirm = () => {
    if (inProgress) return;
    setConfirmOpen(false);
    setSelectedAction(null);
    setAcknowledged(false);
  };

  const runAction = async () => {
    if (!selectedAction || inProgress) return;
    setInProgress(true);
    try {
      const result = await managePowerBiReportingIdentity(
        tenantId,
        selectedAction,
      );
      setLifecycleResult(result);
      setConfirmOpen(false);
      setSelectedAction(null);
      setAcknowledged(false);
      setResultOpen(true);
    } catch {
      toast({
        title: "Reporting lifecycle action failed",
        description: "Please try again or review the readiness panel.",
        variant: "destructive",
      });
    } finally {
      setInProgress(false);
    }
  };

  const finishResult = () => {
    setLifecycleResult(null);
    setResultOpen(false);
    queryClient.invalidateQueries({
      queryKey: ["pbi-reporting-readiness", tenantId],
    });
  };

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: `${label} copied` });
    } catch {
      toast({ title: `Could not copy ${label.toLowerCase()}`, variant: "destructive" });
    }
  };

  const selectedMeta = selectedAction ? ACTION_META[selectedAction] : null;
  const confirmDisabled =
    inProgress || (selectedMeta?.requiresAck && !acknowledged);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Database className="h-4 w-4" /> Power BI reporting readiness
            </CardTitle>
            <CardDescription className="text-xs">
              Power BI reads BTPM data through a Tenant-bound PostgreSQL
              reporting identity. Tenant Admins can manage its lifecycle here.
              One-time passwords are shown only immediately after provision,
              rotation, or re-enablement and are never stored by BTPM.
            </CardDescription>
          </div>
          {data && <StatusBadge status={data.readiness_status} />}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && (
          <div className="space-y-2">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        )}
        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            Failed to load Power BI reporting readiness.
          </div>
        )}
        {data && (
          <>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-md border p-3">
                <div className="mb-2 text-sm font-medium">Tenant reporting identity</div>
                <CheckRow
                  label="Tenant mapping active"
                  ok={data.identity.mapping_state === "active"}
                  hint={`Current state: ${data.identity.mapping_state ?? "—"}`}
                />
                <CheckRow
                  label="PostgreSQL LOGIN enabled"
                  ok={data.identity.login_enabled}
                  hint={
                    data.identity.connection_limit != null
                      ? `Connection limit: ${data.identity.connection_limit}`
                      : undefined
                  }
                />
                <CheckRow
                  label="Least-privilege role attributes valid"
                  ok={data.identity.role_security_attributes_valid}
                  hint="No superuser, createdb, createrole, replication, or bypassrls. Inherits privileges. Connection limit = 8."
                />
                <CheckRow
                  label="Membership limited to btpm_pbi_reader"
                  ok={data.identity.membership_valid}
                  hint="Exact direct role membership: { btpm_pbi_reader }."
                />
                <CheckRow
                  label="Read-only session defaults valid"
                  ok={data.identity.session_defaults_valid}
                  hint="Locked search_path, read-only transactions, statement and idle timeouts."
                />
                <CheckRow
                  label="Session Pooler verified"
                  ok={data.identity.session_pooler_verified}
                />
                <CheckRow
                  label="session_user identity verified"
                  ok={data.identity.session_user_verified}
                />
                <CheckRow
                  label="Disabled-state fail-closed test verified"
                  ok={data.identity.fail_closed_verified}
                  hint="Non-Tenant sessions are denied all reporting rows."
                />
                <div className="mt-2 border-t pt-2 text-[11px] text-muted-foreground">
                  {data.identity.provisioned_at
                    ? <>Provisioned {fmtWhen(data.identity.provisioned_at)} · </>
                    : null}
                  Last verified {fmtWhen(data.identity.last_verified_at)}
                  {data.identity.last_rotated_at
                    ? ` · Last rotated ${fmtWhen(data.identity.last_rotated_at)}`
                    : ""}
                  {data.latest_safe_event.event_type
                    ? ` · Latest event: ${data.latest_safe_event.event_type} ${fmtWhen(data.latest_safe_event.event_at)}`
                    : ""}
                </div>
              </div>

              <div className="rounded-md border p-3">
                <div className="mb-2 text-sm font-medium">Connecting from Power BI</div>
                {data.identity.login_role_name && (
                  <div className="mb-3">
                    <div className="text-[11px] font-medium text-muted-foreground">
                      Reporting role
                    </div>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 truncate rounded bg-muted px-2 py-1 font-mono text-[11px]">
                        {data.identity.login_role_name}
                      </code>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7"
                        onClick={() => copy(data.identity.login_role_name!, "Role name")}
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                )}
                <ul className="space-y-2 text-xs">
                  <li className="flex gap-2">
                    <span className="font-medium min-w-[130px]">Connection method</span>
                    <span className="text-muted-foreground">{data.connection_guidance.connection_method}</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="font-medium min-w-[130px]">Host</span>
                    <span className="text-muted-foreground">{data.connection_guidance.host_hint}</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="font-medium min-w-[130px]">Port</span>
                    <span className="text-muted-foreground">{data.connection_guidance.port}</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="font-medium min-w-[130px]">Database</span>
                    <span className="text-muted-foreground">{data.connection_guidance.database}</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="font-medium min-w-[130px]">Connectivity mode</span>
                    <span className="text-muted-foreground">{data.connection_guidance.connectivity_mode}</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="font-medium min-w-[130px]">Username</span>
                    {suggestedUsername ? (
                      <span className="flex flex-1 items-center gap-2">
                        <code className="flex-1 truncate rounded bg-muted px-2 py-1 font-mono text-[11px]">
                          {suggestedUsername}
                        </code>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7"
                          onClick={() => copy(suggestedUsername, "Username")}
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">
                        Tenant reporting login not yet provisioned.
                      </span>
                    )}
                  </li>
                  <li className="flex gap-2">
                    <span className="font-medium min-w-[130px]">Password</span>
                    <span className="text-muted-foreground">
                      Generated during provision, rotation, or re-enablement and
                      displayed once in the credential result dialog. It is not
                      stored or recoverable.
                    </span>
                  </li>
                </ul>
                <div className="mt-3 flex items-start gap-2 rounded-md border bg-muted/40 p-2 text-[11px]">
                  <Info className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="text-muted-foreground">
                    Use the Tenant-specific reporting login shown above with the Supabase
                    Session Pooler. One-time passwords are generated by BTPM during provision,
                    rotation, or re-enablement, displayed once, and never stored or recoverable.
                  </span>
                </div>
              </div>
            </div>

            <div className="rounded-md border">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b p-3">
                <div>
                  <div className="text-sm font-medium">Organization reporting coverage</div>
                  <div className="text-xs text-muted-foreground">
                    Workspace inclusion is the sole outbound reporting control. Every
                    canonical Project inside an included Workspace is reportable, including
                    archived Projects.
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">
                  {data.coverage_summary.organizations_with_reporting_scope} /{" "}
                  {data.coverage_summary.organization_count} organization
                  {data.coverage_summary.organization_count === 1 ? "" : "s"} scoped ·{" "}
                  {data.coverage_summary.included_workspace_count} included ·{" "}
                  {data.coverage_summary.excluded_workspace_count} excluded ·{" "}
                  {data.coverage_summary.scoped_project_count} reportable project
                  {data.coverage_summary.scoped_project_count === 1 ? "" : "s"}
                </div>
              </div>
              {data.organizations.length === 0 ? (
                <div className="p-4 text-xs text-muted-foreground">
                  No Organizations exist for this Tenant.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Organization</TableHead>
                      <TableHead>Environment</TableHead>
                      <TableHead className="text-right">Workspaces</TableHead>
                      <TableHead className="text-right">Included</TableHead>
                      <TableHead className="text-right">Excluded</TableHead>
                      <TableHead className="text-right">Unconfigured</TableHead>
                      <TableHead className="text-right">Reportable projects</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.organizations.map((o) => (
                      <TableRow key={o.organization_id}>
                        <TableCell className="font-medium">
                          {o.organization_name}
                          {!o.scope_configured && (
                            <span className="ml-2 text-[10px] text-amber-700 dark:text-amber-400">
                              (no reporting scope)
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {o.environment_role ?? "—"}
                        </TableCell>
                        <TableCell className="text-right">{o.total_workspace_count}</TableCell>
                        <TableCell className="text-right">{o.included_workspace_count}</TableCell>
                        <TableCell className="text-right">{o.excluded_workspace_count}</TableCell>
                        <TableCell className="text-right">{o.unconfigured_workspace_count}</TableCell>
                        <TableCell className="text-right">{o.scoped_project_count}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>

            <div className="rounded-md border p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">
                    Reporting credential lifecycle
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Server-enforced actions. One-time passwords appear only in
                    the confirmation result dialog.
                  </div>
                </div>
              </div>
              {isRevoked ? (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
                  This reporting credential has been permanently revoked and
                  cannot be reprovisioned in the current lifecycle.
                </div>
              ) : availableActions.length === 0 ? (
                <div className="text-xs text-muted-foreground">
                  No lifecycle actions available in the current state.
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {availableActions.map((action) => {
                    const meta = ACTION_META[action];
                    const isThisRunning =
                      inProgress && selectedAction === action;
                    return (
                      <Button
                        key={action}
                        size="sm"
                        variant={meta.destructive ? "destructive" : "outline"}
                        disabled={inProgress}
                        onClick={() => openAction(action)}
                      >
                        {isThisRunning && (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        )}
                        {meta.label}
                      </Button>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(o) => {
          if (!o) closeConfirm();
          else setConfirmOpen(true);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{selectedMeta?.label}</AlertDialogTitle>
            <AlertDialogDescription>
              {selectedMeta?.description}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {selectedMeta?.requiresAck && (
            <div className="flex items-start gap-2 rounded border p-3">
              <Checkbox
                id="pbi-lifecycle-ack"
                checked={acknowledged}
                onCheckedChange={(v) => setAcknowledged(v === true)}
                disabled={inProgress}
              />
              <Label
                htmlFor="pbi-lifecycle-ack"
                className="text-xs font-normal leading-snug"
              >
                {selectedMeta.ackText}
              </Label>
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={inProgress}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={confirmDisabled}
              onClick={(e) => {
                e.preventDefault();
                runAction();
              }}
              className={
                selectedMeta?.destructive
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : undefined
              }
            >
              {inProgress && (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              )}
              {selectedMeta?.confirmLabel ?? "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <PowerBiReportingCredentialDialog
        open={resultOpen}
        onOpenChange={setResultOpen}
        result={lifecycleResult}
        onFinish={finishResult}
      />
    </Card>
  );
}
