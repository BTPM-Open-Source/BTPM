// BTPM — Wave C3, Step C3.9j
// Admin → KPI App Integration → KPI Scheduling tab.
//
// Configuration UX only:
//   - Reads kpi_schedule_policies for the selected workspace.
//   - Lets Org Admin / Workspace Admin-or-higher edit:
//       is_active, delay_days_after_period_close, run_time_utc.
//   - process_type and cadence are fixed and never editable here.
//   - Optionally renders a due preview using the C3.9i dry_run Edge Function.
//
// Hard rules (matches C3.9j scope):
//   - Does NOT run automatic snapshot capture.
//   - Does NOT run KPI App auto-submit.
//   - Does NOT call Report Now / build / submit / test runners / MuleSoft.
//   - Does NOT create snapshots, outbox rows, attempt rows, or kpi_updates rows.
//   - Does NOT activate cron.
//   - RLS + DB validation trigger remain final authority.

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Info, AlertTriangle, Save, RefreshCw, CalendarClock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  useKpiSchedulePolicies,
  useKpiSchedulePoliciesDuePreview,
  useUpdateKpiSchedulePolicy,
  POLICY_CADENCES,
  POLICY_PROCESS_TYPES,
  type KpiSchedulePolicy,
  type SchedulePolicyCadence,
  type SchedulePolicyProcessType,
  type DuePreviewItem,
} from "@/hooks/useKpiSchedulePolicies";
import {
  useLatestSnapshotCaptureRun,
  useLatestScheduledAutoSubmitRow,
} from "@/hooks/useKpiScheduleMonitor";
import { KpiSchedulerDiagnosticsPanel } from "@/components/admin/KpiSchedulerDiagnosticsPanel";

interface Props {
  organizationId: string;
  workspaceId: string | null;
  workspaceName: string | null;
}

interface DraftRow {
  id: string;
  is_active: boolean;
  delay_days: string; // string in input; validate to int 0-31
  run_time_utc: string; // HH:MM
  // baseline for change detection
  base_is_active: boolean;
  base_delay_days: number;
  base_run_time_utc: string; // HH:MM
}

const PROCESS_LABEL: Record<SchedulePolicyProcessType, string> = {
  automatic_snapshot_capture: "Automatic Snapshot Capture",
  kpi_app_auto_submit: "KPI App Auto-submit official snapshots",
};

const PROCESS_HELPER: Record<SchedulePolicyProcessType, string> = {
  automatic_snapshot_capture:
    "Creates official KPI snapshots after the reporting period closes.",
  kpi_app_auto_submit:
    "Submits existing official snapshots to the external KPI App after the reporting period closes.",
};

const CADENCE_LABEL: Record<SchedulePolicyCadence, string> = {
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
};

function toHHMM(t: string | null | undefined): string {
  if (!t) return "00:00";
  // DB time may be "HH:MM:SS" or "HH:MM"
  const m = /^(\d{2}):(\d{2})/.exec(t);
  return m ? `${m[1]}:${m[2]}` : "00:00";
}

function isValidHHMM(t: string): boolean {
  const m = /^(\d{2}):(\d{2})$/.exec(t);
  if (!m) return false;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  return h >= 0 && h <= 23 && mi >= 0 && mi <= 59;
}

function isValidDelay(s: string): boolean {
  if (!/^\d+$/.test(s)) return false;
  const n = Number(s);
  return Number.isInteger(n) && n >= 0 && n <= 31;
}

// Compute "offset minutes" for ordering check between snapshot and auto-submit
// for the same workspace+cadence: delay_days * 1440 + (HH*60 + MM).
// Mirrors the DB validation trigger.
function offsetMinutes(delayDays: number, hhmm: string): number {
  const m = /^(\d{2}):(\d{2})/.exec(hhmm);
  const h = m ? Number(m[1]) : 0;
  const mi = m ? Number(m[2]) : 0;
  return delayDays * 1440 + h * 60 + mi;
}

function formatScheduleSummary(delayDays: number, hhmm: string): string {
  return `${delayDays} day${delayDays === 1 ? "" : "s"} after period close at ${hhmm} UTC`;
}

// C3.10e — local time UX. Backend remains UTC; we only translate for display.
function resolveLocalTimeZone(): string | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz && tz.length > 0 ? tz : null;
  } catch {
    return null;
  }
}

const CADENCE_PERIOD_DESCRIPTION: Record<SchedulePolicyCadence, string> = {
  weekly: "Weekly period: Monday–Sunday.",
  monthly: "Monthly period: calendar month.",
  quarterly: "Quarterly period: calendar quarter.",
  yearly: "Yearly period: calendar year.",
};

function formatLocalAndUtc(scheduledRunAtIso: string | null): {
  localLabel: string;
  utcLabel: string;
  available: boolean;
} {
  if (!scheduledRunAtIso) {
    return { localLabel: "", utcLabel: "", available: false };
  }
  const d = new Date(scheduledRunAtIso);
  if (Number.isNaN(d.getTime())) {
    return { localLabel: "", utcLabel: "", available: false };
  }
  const tz = resolveLocalTimeZone();
  const utcLabel =
    `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC` +
    ` on ${d.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })}`;
  if (!tz) {
    return { localLabel: "", utcLabel, available: false };
  }
  const localTime = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: tz,
  }).format(d);
  const localDay = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    timeZone: tz,
  }).format(d);
  return {
    localLabel: `${localTime} local time on ${localDay}`,
    utcLabel,
    available: true,
  };
}

// C3.10a — wording must distinguish "policy is due" from "scheduler actually ran".
// `lastRunIso` (when available) is the most recent SCHEDULED run start time
// for the same process+workspace; we compare it against the policy's
// scheduled_run_at to decide whether a run was recorded for this period.
function formatDueStatus(
  item: DuePreviewItem,
  lastRunIso: string | null,
): {
  label: string;
  variant: "default" | "secondary" | "outline" | "destructive";
} {
  switch (item.due_status) {
    case "due": {
      const scheduledIso = item.scheduled_run_at ?? null;
      if (lastRunIso && scheduledIso && lastRunIso >= scheduledIso) {
        return { label: "Due today — last run recorded", variant: "default" };
      }
      return {
        label: "Due now — waiting for scheduler invocation",
        variant: "default",
      };
    }
    case "inactive":
      return { label: "Inactive", variant: "secondary" };
    case "not_due_time_not_reached":
    case "not_due_scheduled_date_in_future":
      return { label: "Not due", variant: "outline" };
    case "not_due_scheduled_date_passed":
      if (lastRunIso && item.scheduled_run_at && lastRunIso >= item.scheduled_run_at) {
        return { label: "Scheduled date passed — last run recorded", variant: "outline" };
      }
      return {
        label: "Scheduled date passed — no run recorded",
        variant: "destructive",
      };
    case "invalid_policy":
      return { label: "Invalid policy", variant: "destructive" };
    default:
      return { label: item.due_status, variant: "outline" };
  }
}

export function KpiSchedulingTab({ organizationId, workspaceId, workspaceName }: Props) {
  const { toast } = useToast();

  const policiesQ = useKpiSchedulePolicies(organizationId, workspaceId);
  const previewQ = useKpiSchedulePoliciesDuePreview(organizationId, workspaceId);
  const updateMut = useUpdateKpiSchedulePolicy(organizationId, workspaceId);

  // Local edit drafts keyed by policy id.
  const [drafts, setDrafts] = useState<Record<string, DraftRow>>({});

  // Reset drafts whenever the policy set changes.
  useEffect(() => {
    const next: Record<string, DraftRow> = {};
    for (const p of policiesQ.data ?? []) {
      const hhmm = toHHMM(p.run_time_utc);
      next[p.id] = {
        id: p.id,
        is_active: p.is_active,
        delay_days: String(p.delay_days_after_period_close),
        run_time_utc: hhmm,
        base_is_active: p.is_active,
        base_delay_days: p.delay_days_after_period_close,
        base_run_time_utc: hhmm,
      };
    }
    setDrafts(next);
  }, [policiesQ.data]);

  // Index policies by (process_type, cadence) for cross-process lookups.
  const policyByKey = useMemo(() => {
    const map = new Map<string, KpiSchedulePolicy>();
    for (const p of policiesQ.data ?? []) {
      map.set(`${p.process_type}__${p.cadence}`, p);
    }
    return map;
  }, [policiesQ.data]);

  // Index due preview items by policy_id for display.
  const previewByPolicyId = useMemo(() => {
    const map = new Map<string, DuePreviewItem>();
    for (const it of previewQ.data?.items ?? []) {
      map.set(it.policy_id, it);
    }
    return map;
  }, [previewQ.data]);

  if (!workspaceId) {
    return (
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          Select a workspace above to manage KPI schedule policies.
        </AlertDescription>
      </Alert>
    );
  }

  if (policiesQ.isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  if (policiesQ.error) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          Failed to load schedule policies. You may not have admin authority for
          this workspace, or the policies have not been seeded.
        </AlertDescription>
      </Alert>
    );
  }

  const policies = policiesQ.data ?? [];
  const expectedTotal = POLICY_PROCESS_TYPES.length * POLICY_CADENCES.length; // 8
  const isMissingPolicies = policies.length < expectedTotal;

  // Build a draft validator that returns the appropriate error/warning per row.
  function getRowState(policy: KpiSchedulePolicy): {
    draft: DraftRow | undefined;
    fieldErrors: { delay?: string; runTime?: string };
    orderingError: string | null;
    inactivePairWarning: string | null;
    isDirty: boolean;
  } {
    const draft = drafts[policy.id];
    const fieldErrors: { delay?: string; runTime?: string } = {};
    if (!draft) {
      return {
        draft,
        fieldErrors,
        orderingError: null,
        inactivePairWarning: null,
        isDirty: false,
      };
    }
    if (!isValidDelay(draft.delay_days)) {
      fieldErrors.delay = "Must be a whole number between 0 and 31.";
    }
    if (!isValidHHMM(draft.run_time_utc)) {
      fieldErrors.runTime = "Must be HH:MM (00:00–23:59).";
    }

    // Cross-process ordering check: kpi_app_auto_submit must not run earlier
    // than automatic_snapshot_capture for the same workspace+cadence.
    let orderingError: string | null = null;
    let inactivePairWarning: string | null = null;

    if (!fieldErrors.delay && !fieldErrors.runTime) {
      const cadence = policy.cadence as SchedulePolicyCadence;
      const draftDelay = Number(draft.delay_days);

      // Resolve effective offsets for both processes in the same cadence,
      // using draft values for whichever side is being edited.
      const snapshotPolicy = policyByKey.get(
        `automatic_snapshot_capture__${cadence}`,
      );
      const autoSubmitPolicy = policyByKey.get(
        `kpi_app_auto_submit__${cadence}`,
      );

      function effective(p: KpiSchedulePolicy | undefined): {
        delay: number;
        time: string;
        active: boolean;
      } | null {
        if (!p) return null;
        const d = drafts[p.id];
        if (d) {
          // Only trust draft if its own fields are valid.
          if (isValidDelay(d.delay_days) && isValidHHMM(d.run_time_utc)) {
            return {
              delay: Number(d.delay_days),
              time: d.run_time_utc,
              active: d.is_active,
            };
          }
        }
        return {
          delay: p.delay_days_after_period_close,
          time: toHHMM(p.run_time_utc),
          active: p.is_active,
        };
      }

      const snap = effective(snapshotPolicy);
      const sub = effective(autoSubmitPolicy);

      if (snap && sub) {
        const snapOffset = offsetMinutes(snap.delay, snap.time);
        const subOffset = offsetMinutes(sub.delay, sub.time);
        if (subOffset < snapOffset) {
          orderingError =
            "KPI App auto-submit official snapshots cannot run before automatic snapshot capture for the same cadence.";
        }
        // Warn if auto-submit is/will-be active while snapshot capture is inactive.
        if (sub.active && !snap.active) {
          inactivePairWarning =
            "Automatic snapshot capture is inactive for this cadence. KPI App auto-submit will only submit snapshots that already exist.";
        }
      }
      // Suppress signals on cadences with no counterpart yet seeded.

      // Ignore self-irrelevant signals: if this policy is the snapshot side,
      // ordering message is shown on the auto-submit row only. If this policy
      // is the auto-submit side, inactive-pair warning is shown on auto-submit.
      const isSnapshot = policy.process_type === "automatic_snapshot_capture";
      if (isSnapshot) {
        // Show ordering error on snapshot row too (it usually means snapshot
        // moved later than auto-submit). It's the same shared violation.
        // Inactive-pair warning is auto-submit-side only.
        inactivePairWarning = null;
      }
      // For auto-submit row, both signals are relevant.
      // Drop draftDelay reference after use to satisfy TS noise; using here:
      void draftDelay;
    }

    const isDirty =
      draft.is_active !== draft.base_is_active ||
      draft.delay_days !== String(draft.base_delay_days) ||
      draft.run_time_utc !== draft.base_run_time_utc;

    return {
      draft,
      fieldErrors,
      orderingError,
      inactivePairWarning,
      isDirty,
    };
  }

  async function handleSave(policy: KpiSchedulePolicy) {
    const state = getRowState(policy);
    const draft = state.draft;
    if (!draft) return;
    if (state.fieldErrors.delay || state.fieldErrors.runTime) {
      toast({
        title: "Invalid values",
        description: "Fix delay days and run time before saving.",
        variant: "destructive",
      });
      return;
    }
    if (state.orderingError) {
      toast({
        title: "Save blocked",
        description: state.orderingError,
        variant: "destructive",
      });
      return;
    }
    try {
      await updateMut.mutateAsync({
        id: policy.id,
        is_active: draft.is_active,
        delay_days_after_period_close: Number(draft.delay_days),
        run_time_utc: draft.run_time_utc,
      });
      toast({
        title: "Schedule policy updated",
        description: `${PROCESS_LABEL[policy.process_type as SchedulePolicyProcessType]} · ${CADENCE_LABEL[policy.cadence as SchedulePolicyCadence]}`,
      });
    } catch (e: any) {
      toast({
        title: "Save failed",
        description: e?.message ?? "Could not update schedule policy.",
        variant: "destructive",
      });
    }
  }

  function renderRow(policy: KpiSchedulePolicy, lastRunIso: string | null) {
    const cadence = policy.cadence as SchedulePolicyCadence;
    const state = getRowState(policy);
    const draft = state.draft;
    if (!draft) return null;

    const preview = previewByPolicyId.get(policy.id);
    const dueStatus = preview ? formatDueStatus(preview, lastRunIso) : null;

    return (
      <div
        key={policy.id}
        className="grid grid-cols-1 md:grid-cols-12 gap-3 items-start py-3 border-b last:border-b-0"
      >
        <div className="md:col-span-2 flex flex-col">
          <span className="font-medium">{CADENCE_LABEL[cadence]}</span>
          <span className="text-xs text-muted-foreground">
            {formatScheduleSummary(
              isValidDelay(draft.delay_days) ? Number(draft.delay_days) : draft.base_delay_days,
              isValidHHMM(draft.run_time_utc) ? draft.run_time_utc : draft.base_run_time_utc,
            )}
          </span>
        </div>

        <div className="md:col-span-2 flex items-center gap-2">
          <Switch
            checked={draft.is_active}
            onCheckedChange={(v) =>
              setDrafts((prev) => ({
                ...prev,
                [policy.id]: { ...draft, is_active: v },
              }))
            }
          />
          <span className="text-sm">{draft.is_active ? "Active" : "Inactive"}</span>
        </div>

        <div className="md:col-span-2 flex flex-col">
          <label className="text-xs text-muted-foreground mb-1">Delay days (0–31)</label>
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            max={31}
            step={1}
            value={draft.delay_days}
            onChange={(e) =>
              setDrafts((prev) => ({
                ...prev,
                [policy.id]: { ...draft, delay_days: e.target.value },
              }))
            }
            className={state.fieldErrors.delay ? "border-destructive" : ""}
          />
          {state.fieldErrors.delay && (
            <span className="text-xs text-destructive mt-1">{state.fieldErrors.delay}</span>
          )}
        </div>

        <div className="md:col-span-2 flex flex-col">
          <label className="text-xs text-muted-foreground mb-1">Run time (UTC)</label>
          <Input
            type="time"
            value={draft.run_time_utc}
            onChange={(e) =>
              setDrafts((prev) => ({
                ...prev,
                [policy.id]: { ...draft, run_time_utc: e.target.value },
              }))
            }
            className={state.fieldErrors.runTime ? "border-destructive" : ""}
          />
          {state.fieldErrors.runTime && (
            <span className="text-xs text-destructive mt-1">{state.fieldErrors.runTime}</span>
          )}
        </div>

        <div className="md:col-span-3 flex flex-col text-xs">
          {preview ? (
            <>
              <div className="flex items-center gap-2">
                <Badge variant={dueStatus?.variant ?? "outline"}>
                  {dueStatus?.label ?? preview.due_status}
                </Badge>
              </div>
              <span className="text-muted-foreground mt-1">
                {CADENCE_PERIOD_DESCRIPTION[cadence]}
              </span>
              <span className="text-muted-foreground">
                Period: {preview.period_start ?? "—"} → {preview.period_end ?? "—"}
              </span>
              {(() => {
                const t = formatLocalAndUtc(preview.scheduled_run_at);
                if (!preview.scheduled_run_at) {
                  return (
                    <span className="text-muted-foreground">Scheduled run: —</span>
                  );
                }
                if (!t.available) {
                  return (
                    <span className="text-muted-foreground">
                      Scheduled run: {t.utcLabel} (local time unavailable; schedule shown in UTC)
                    </span>
                  );
                }
                return (
                  <span className="text-muted-foreground">
                    Scheduled run: {t.localLabel} / {t.utcLabel}
                  </span>
                );
              })()}
            </>
          ) : previewQ.isFetching ? (
            <span className="text-muted-foreground">Loading preview…</span>
          ) : (
            <span className="text-muted-foreground">No preview available.</span>
          )}
        </div>

        <div className="md:col-span-1 flex justify-end">
          <Button
            size="sm"
            onClick={() => handleSave(policy)}
            disabled={
              !state.isDirty ||
              !!state.fieldErrors.delay ||
              !!state.fieldErrors.runTime ||
              !!state.orderingError ||
              updateMut.isPending
            }
          >
            <Save className="h-3.5 w-3.5 mr-1" />
            Save
          </Button>
        </div>

        {(state.orderingError || state.inactivePairWarning) && (
          <div className="md:col-span-12 -mt-1 space-y-1">
            {state.orderingError && (
              <Alert variant="destructive" className="py-2">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  {state.orderingError}
                </AlertDescription>
              </Alert>
            )}
            {state.inactivePairWarning && (
              <Alert className="py-2">
                <Info className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  {state.inactivePairWarning}
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}
      </div>
    );
  }

  function renderSection(processType: SchedulePolicyProcessType) {
    const rows = POLICY_CADENCES.map((cadence) =>
      policyByKey.get(`${processType}__${cadence}`),
    ).filter((p): p is KpiSchedulePolicy => !!p);

    return (
      <ProcessSection
        processType={processType}
        organizationId={organizationId}
        workspaceId={workspaceId}
        rows={rows}
        renderRow={renderRow}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <CalendarClock className="h-5 w-5 text-primary" />
        <h3 className="text-lg font-semibold text-foreground">
          KPI Scheduling
          {workspaceName ? (
            <span className="text-muted-foreground font-normal"> — {workspaceName}</span>
          ) : null}
        </h3>
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          onClick={() => previewQ.refetch()}
          disabled={previewQ.isFetching}
        >
          <RefreshCw
            className={`h-3.5 w-3.5 mr-1 ${previewQ.isFetching ? "animate-spin" : ""}`}
          />
          Refresh due preview
        </Button>
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          <strong>Cadence</strong> defines the reporting period. <strong>Schedule</strong>{" "}
          defines when BTPM runs after that period closes. Schedule policies do{" "}
          <strong>not</strong> run anything by themselves — they only configure when the
          existing automatic snapshot capture and KPI App auto-submit jobs are considered
          due. Cron is not activated by this screen. Scheduler activation is configured
          through operations.
          <span className="block mt-1">
            <strong>Automatic Snapshot Capture</strong> creates official snapshots.{" "}
            <strong>KPI App Auto-submit</strong> submits existing official snapshots.
            These are separate scheduled processes.
          </span>
          <span className="block mt-1">
            Schedules are stored and executed in <strong>UTC</strong>. Each row also shows
            the equivalent in your browser's local time zone
            {(() => {
              const tz = resolveLocalTimeZone();
              return tz ? <> (<strong>{tz}</strong>)</> : <> (unavailable — UTC only)</>;
            })()}
            .
          </span>
        </AlertDescription>
      </Alert>

      {isMissingPolicies && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Schedule policies are missing for this workspace ({policies.length} of{" "}
            {expectedTotal}). Default seeding may not have run for this workspace. Contact
            the platform team — automatic creation of missing policies is deferred to a
            later step.
          </AlertDescription>
        </Alert>
      )}

      {previewQ.data && previewQ.data.ok === false && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            Due preview unavailable: {previewQ.data.error ?? "unknown error"}.
          </AlertDescription>
        </Alert>
      )}

      <KpiSchedulerDiagnosticsPanel />

      {renderSection("automatic_snapshot_capture")}
      {renderSection("kpi_app_auto_submit")}
    </div>
  );
}

// C3.10a — section wrapper: fetches the latest scheduled run for this process
// once and passes its ISO timestamp into renderRow so the due-status label can
// distinguish "scheduler ran" from "policy is due but no run recorded".
function ProcessSection({
  processType,
  organizationId,
  workspaceId,
  rows,
  renderRow,
}: {
  processType: SchedulePolicyProcessType;
  organizationId: string;
  workspaceId: string | null;
  rows: KpiSchedulePolicy[];
  renderRow: (p: KpiSchedulePolicy, lastRunIso: string | null) => JSX.Element | null;
}) {
  const snapQ = useLatestSnapshotCaptureRun(
    organizationId,
    workspaceId,
    "system",
  );
  const subQ = useLatestScheduledAutoSubmitRow(organizationId, workspaceId);

  const lastRunIso: string | null =
    processType === "automatic_snapshot_capture"
      ? snapQ.data?.started_at ?? null
      : subQ.data?.created_at ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{PROCESS_LABEL[processType]}</CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          {PROCESS_HELPER[processType]}
        </p>
      </CardHeader>
      <CardContent>
        <LastRunSummary
          processType={processType}
          workspaceId={workspaceId}
          organizationId={organizationId}
        />
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            No policies seeded for this process in this workspace.
          </p>
        ) : (
          rows.map((p) => renderRow(p, lastRunIso))
        )}
      </CardContent>
    </Card>
  );
}

// (sentinel — replaced original closing of file below) 

// ---------------------------------------------------------------------------
// C3.9m — Last run summary panel rendered at the top of each process section.
//
// Read-only audit reuse:
//   - Automatic Snapshot Capture: latest kpi_snapshot_capture_runs row for
//     this workspace (system invocation_source).
//   - KPI App Auto-submit: latest kpi_app_submission_outbox row with
//     submission_mode='scheduled' for this workspace.
// No sensitive fields. No scheduler execution. No writes.
// ---------------------------------------------------------------------------
function LastRunSummary({
  processType,
  workspaceId,
  organizationId,
}: {
  processType: SchedulePolicyProcessType;
  workspaceId: string | null;
  organizationId: string;
}) {
  if (processType === "automatic_snapshot_capture") {
    return (
      <SnapshotLastRun organizationId={organizationId} workspaceId={workspaceId} />
    );
  }
  return (
    <AutoSubmitLastRun organizationId={organizationId} workspaceId={workspaceId} />
  );
}

function SnapshotLastRun({
  organizationId,
  workspaceId,
}: {
  organizationId: string;
  workspaceId: string | null;
}) {
  const { data, isLoading } = useLatestSnapshotCaptureRun(
    organizationId,
    workspaceId,
    "system",
  );
  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2 mb-3 text-xs">
      <div className="font-medium text-foreground">Last scheduled run</div>
      {isLoading ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : !data ? (
        <div className="text-muted-foreground">
          No scheduled automatic snapshot capture runs recorded yet for this workspace.
        </div>
      ) : (
        <div className="text-muted-foreground space-y-0.5 mt-1">
          <div>
            Started: {new Date(data.started_at).toLocaleString()} ·{" "}
            Completed:{" "}
            {data.completed_at ? new Date(data.completed_at).toLocaleString() : "—"}
          </div>
          <div>
            Status: <Badge variant="outline">{data.status}</Badge>{" "}
            <span className="ml-2">
              Candidates: {data.candidate_count} · Created: {data.created_count} ·
              Skipped (existing): {data.skipped_existing_snapshot_count} ·
              Calc not ready: {data.calculation_not_ready_count} ·
              Failed: {data.failed_count}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function AutoSubmitLastRun({
  organizationId,
  workspaceId,
}: {
  organizationId: string;
  workspaceId: string | null;
}) {
  const { data, isLoading } = useLatestScheduledAutoSubmitRow(
    organizationId,
    workspaceId,
  );
  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2 mb-3 text-xs">
      <div className="font-medium text-foreground">Last scheduled run</div>
      {isLoading ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : !data ? (
        <div className="text-muted-foreground">
          No scheduled auto-submit runs recorded yet for this workspace. Manual
          Report Now submissions remain visible in the Submission Monitor.
        </div>
      ) : (
        <div className="text-muted-foreground space-y-0.5 mt-1">
          <div>
            Reporting period: {data.reporting_period_start} → {data.reporting_period_end}
          </div>
          <div>
            Status: <Badge variant="outline">{data.status}</Badge>{" "}
            <span className="ml-2">
              Submitted:{" "}
              {data.submitted_at ? new Date(data.submitted_at).toLocaleString() : "—"} ·
              Last attempt:{" "}
              {data.last_attempt_at
                ? new Date(data.last_attempt_at).toLocaleString()
                : "—"}{" "}
              · HTTP: {data.last_http_status ?? "—"} · Rows:{" "}
              {data.payload_row_count ?? "—"} · Retries: {data.retry_count}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
