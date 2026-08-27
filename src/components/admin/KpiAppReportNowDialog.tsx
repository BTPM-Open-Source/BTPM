// BTPM — Wave C2, Step C2.9b
// Admin Manual Report Now dialog.
//
// Stages:
//   A. Period — collect reporting_period_start / reporting_period_end / validity_date
//   B. Preview — non-sensitive snapshot metadata via prepare-kpi-app-report-now (preview)
//   C. Outbox  — create or reuse via prepare-kpi-app-report-now (create)
//   D. Payload — dry_run + prepare via build-kpi-app-payload
//   E. Submit  — submit-kpi-app-payload, with explicit confirmation
//
// Hard rules:
//   - No client-side payload construction.
//   - No display of decrypted comments / action_plans / string values.
//   - No display of full payload body or full upstream response body.
//   - No retry, no scheduler controls.
//   - No direct DB writes to outbox / attempts / mappings.last_*.
//   - No MuleSoft secret references.

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { AlertTriangle, Info, Loader2, Send } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useKpiAppReportNow } from "@/hooks/useKpiAppReportNow";
import { KpiAppRetryButton } from "@/components/admin/KpiAppRetryButton";
import type { MappingWithJoin } from "@/hooks/useKpiAppIntegration";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  mapping: MappingWithJoin | null;
}

type Stage = "period" | "preview" | "outbox" | "payload" | "confirm" | "result";

function isoToday(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function defaultPeriod(frequency: string | null | undefined): {
  start: string;
  end: string;
  validity: string;
} {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  const fmt = (dt: Date) => dt.toISOString().slice(0, 10);

  switch (frequency) {
    case "weekly": {
      const day = now.getUTCDay(); // 0 Sun..6 Sat
      const monOffset = (day + 6) % 7;
      const start = new Date(Date.UTC(y, m, d - monOffset));
      const end = new Date(Date.UTC(y, m, d - monOffset + 6));
      return { start: fmt(start), end: fmt(end), validity: fmt(end) };
    }
    case "quarterly": {
      const qStartMonth = Math.floor(m / 3) * 3;
      const start = new Date(Date.UTC(y, qStartMonth, 1));
      const end = new Date(Date.UTC(y, qStartMonth + 3, 0));
      return { start: fmt(start), end: fmt(end), validity: fmt(end) };
    }
    case "yearly": {
      const start = new Date(Date.UTC(y, 0, 1));
      const end = new Date(Date.UTC(y, 11, 31));
      return { start: fmt(start), end: fmt(end), validity: fmt(end) };
    }
    case "manual_only": {
      const t = isoToday(now);
      return { start: t, end: t, validity: t };
    }
    case "monthly":
    default: {
      const start = new Date(Date.UTC(y, m, 1));
      const end = new Date(Date.UTC(y, m + 1, 0));
      return { start: fmt(start), end: fmt(end), validity: fmt(end) };
    }
  }
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export function KpiAppReportNowDialog({ open, onOpenChange, organizationId, mapping }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const fns = useKpiAppReportNow();

  const initial = useMemo(() => defaultPeriod(mapping?.reporting_frequency), [mapping]);

  const [stage, setStage] = useState<Stage>("period");
  const [periodStart, setPeriodStart] = useState(initial.start);
  const [periodEnd, setPeriodEnd] = useState(initial.end);
  const [validityDate, setValidityDate] = useState(initial.validity);

  const [busy, setBusy] = useState(false);
  const [previewData, setPreviewData] = useState<any>(null);
  const [outboxId, setOutboxId] = useState<string | null>(null);
  const [outboxReused, setOutboxReused] = useState(false);
  const [dryRun, setDryRun] = useState<any>(null);
  const [prepared, setPrepared] = useState<any>(null);
  const [submitResult, setSubmitResult] = useState<any>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Reset whenever the dialog opens for a different mapping.
  useEffect(() => {
    if (!open) return;
    setStage("period");
    setPeriodStart(initial.start);
    setPeriodEnd(initial.end);
    setValidityDate(initial.validity);
    setPreviewData(null);
    setOutboxId(null);
    setOutboxReused(false);
    setDryRun(null);
    setPrepared(null);
    setSubmitResult(null);
    setErrorMsg(null);
    setBusy(false);
  }, [open, mapping?.id, initial.start, initial.end, initial.validity]);

  if (!mapping) return null;

  const datesValid =
    ISO_RE.test(periodStart) &&
    ISO_RE.test(periodEnd) &&
    ISO_RE.test(validityDate) &&
    periodEnd >= periodStart;

  function refreshMappings() {
    qc.invalidateQueries({ queryKey: ["kpi-app-mappings", organizationId] });
  }

  async function handlePreview() {
    if (!datesValid) {
      toast({ title: "Invalid dates", variant: "destructive" });
      return;
    }
    setBusy(true);
    setErrorMsg(null);
    const res = await fns.preview({
      mapping_id: mapping.id,
      reporting_period_start: periodStart,
      reporting_period_end: periodEnd,
      validity_date: validityDate,
    });
    setBusy(false);
    if (!res.ok) {
      setErrorMsg(res.error || "Preview failed");
      return;
    }
    setPreviewData(res);
    setStage("preview");
  }

  async function handleCreateOutbox() {
    setBusy(true);
    setErrorMsg(null);
    const res = await fns.createOutbox({
      mapping_id: mapping.id,
      reporting_period_start: periodStart,
      reporting_period_end: periodEnd,
      validity_date: validityDate,
    });
    setBusy(false);
    if (!res.ok || !res.outbox_id) {
      const code = (res as unknown as { code?: string }).code;
      const raw = res.error || "Could not create outbox row";
      let friendly = raw;
      if (code === "OUTBOX_NOT_REUSABLE" || code === "OUTBOX_BLOCKING_ATTEMPT") {
        friendly =
          "A previous attempt is blocking this mapping. Close this dialog and click Reset on the mapping row to clear it, then try Report Now again. The original attempt is preserved in history.";
      } else if (code === "PERIOD_ALREADY_SUBMITTED") {
        friendly =
          "This period was already submitted. Duplicate submission is blocked.";
      } else if (code === "OUTBOX_IN_PROGRESS") {
        friendly = "A submission is already in progress for this mapping and period.";
      } else if (code === "OUTBOX_UNIQUE_INDEX_MISMATCH") {
        friendly =
          "Outbox unique index is out of sync with the supersede contract. Ask an admin to verify the active-period unique index excludes superseded rows.";
      } else if (raw.includes("non-reusable state")) {
        friendly =
          "A previous attempt is blocking this mapping. Use Reset on the mapping row to clear it, then try again.";
      }
      setErrorMsg(friendly);
      return;
    }
    setOutboxId(res.outbox_id);
    setOutboxReused(!!res.reused_existing_outbox);
    setStage("outbox");
  }

  async function handleDryRun() {
    if (!outboxId) return;
    setBusy(true);
    setErrorMsg(null);
    const res = await fns.dryRun(outboxId);
    setBusy(false);
    if (!res.ok) {
      setErrorMsg(res.error || res.errors?.join("; ") || "Dry-run failed");
      return;
    }
    setDryRun(res);
    setStage("payload");
  }

  async function handlePrepare() {
    if (!outboxId) return;
    setBusy(true);
    setErrorMsg(null);
    const res = await fns.prepare(outboxId);
    setBusy(false);
    if (!res.ok) {
      setErrorMsg(res.error || res.errors?.join("; ") || "Prepare failed");
      return;
    }
    setPrepared(res);
    setStage("confirm");
  }

  async function handleSubmit() {
    if (!outboxId) return;
    setBusy(true);
    setErrorMsg(null);
    const res = await fns.submit(outboxId);
    setBusy(false);
    setSubmitResult(res);
    setStage("result");
    refreshMappings();
    if (res.ok) {
      toast({ title: "Submitted to external KPI App" });
    } else {
      const code = (res as unknown as { code?: string }).code;
      let description = res.error || "See result for details";
      if (code === "KPI_API_ENDPOINT_NOT_FOUND") {
        description =
          "The KPI API endpoint returned 404 Not Found. Check the MuleSoft KPI Tenant integration API URL.";
      } else if (code === "KPI_API_AUTH_FAILED") {
        description =
          "The upstream service rejected the configured MuleSoft KPI credentials.";
      } else if (code === "UPSTREAM_TRANSPORT_ERROR") {
        description = "Could not reach the KPI App. Submission was not delivered.";
      } else if (typeof code === "string" && code.startsWith("MULESOFT_KPI_")) {
        description =
          res.error ||
          "The MuleSoft KPI Tenant integration is disabled or incomplete.";
      }
      toast({ title: "Submission failed", description, variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-4 w-4" /> Report Now
          </DialogTitle>
          <DialogDescription>
            This sends the selected official KPI snapshot to the external KPI App through the
            protected MuleSoft connector.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="rounded border p-3 bg-muted/30">
            <div className="font-medium">{mapping.project_name ?? "—"}</div>
            <div className="text-muted-foreground">
              {mapping.kpi_name ?? "—"} → #{mapping.external_kpi_id} {mapping.external_kpi_name ?? ""}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Frequency: {mapping.reporting_frequency} · Scenario {mapping.scenario_id} / Currency{" "}
              {mapping.currency_id}
            </div>
          </div>

          {errorMsg && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{errorMsg}</AlertDescription>
            </Alert>
          )}

          {/* Stage A — Period */}
          {(stage === "period" || stage === "preview") && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label htmlFor="ps">Period start</Label>
                  <Input
                    id="ps"
                    type="date"
                    value={periodStart}
                    onChange={(e) => setPeriodStart(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="pe">Period end</Label>
                  <Input
                    id="pe"
                    type="date"
                    value={periodEnd}
                    onChange={(e) => setPeriodEnd(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="vd">Validity date</Label>
                  <Input
                    id="vd"
                    type="date"
                    value={validityDate}
                    onChange={(e) => setValidityDate(e.target.value)}
                  />
                </div>
              </div>
              {!datesValid && (
                <p className="text-xs text-destructive">
                  Dates must be valid ISO and end ≥ start.
                </p>
              )}
            </div>
          )}

          {/* Stage B — Preview result */}
          {previewData && (stage === "preview" || stage === "outbox" || stage === "payload" || stage === "confirm") && (
            <div className="rounded border p-3 space-y-2">
              <div className="font-medium text-sm">Preview</div>
              {previewData.reportable === false ? (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    Not reportable: <strong>{previewData.reason ?? "unknown"}</strong>
                    {previewData.reason === "snapshot_created_by_email_unavailable" && (
                      <div className="mt-1 text-xs">
                        The selected official snapshot was system-generated (no creator email),
                        but this mapping's <em>Manual Report Now entered-by source</em> is set to
                        <strong> Snapshot creator</strong>. Open the mapping and switch the
                        entered-by source to <strong>Submitting user</strong> or
                        <strong> Configured user</strong>, then try again.
                      </div>
                    )}
                  </AlertDescription>
                </Alert>
              ) : (
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>Snapshot ID</div>
                  <div className="font-mono">{previewData.source_snapshot_id}</div>
                  <div>Snapshot period</div>
                  <div>
                    {previewData.source_snapshot_period_start} →{" "}
                    {previewData.source_snapshot_period_end}
                  </div>
                  <div>Carry-forward used</div>
                  <div>{previewData.carry_forward_used ? "yes" : "no"}</div>
                  <div>Source value type</div>
                  <div>{previewData.source_value_type}</div>
                  {previewData.source_value_type !== "text" && (
                    <>
                      <div>Numeric value</div>
                      <div>{previewData.source_value_amount ?? "—"}</div>
                    </>
                  )}
                  {previewData.source_value_type === "text" && (
                    <>
                      <div>Text value present</div>
                      <div>{previewData.text_value_present ? "yes" : "no"}</div>
                    </>
                  )}
                  <div>Comment present</div>
                  <div>{previewData.comment_present ? "yes" : "no"}</div>
                  <div>Action plan present</div>
                  <div>{previewData.action_plan_present ? "yes" : "no"}</div>
                  <div>External KPI</div>
                  <div>
                    #{previewData.external_kpi_id} {previewData.external_kpi_name ?? ""}
                  </div>
                  <div>Scenario / Currency</div>
                  <div>
                    {previewData.scenario_id} / {previewData.currency_id}
                  </div>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Decrypted comments, action plans, and text values are intentionally not shown.
              </p>
            </div>
          )}

          {/* Stage C — Outbox */}
          {outboxId && (stage === "outbox" || stage === "payload" || stage === "confirm") && (
            <div className="rounded border p-3 space-y-1 text-xs">
              <div className="font-medium text-sm">Outbox row</div>
              <div className="font-mono">{outboxId}</div>
              {outboxReused && (
                <Badge variant="outline">Reused existing queued/payload_ready row</Badge>
              )}
            </div>
          )}

          {/* Stage D — Payload summary (dry-run + prepare) */}
          {dryRun && (stage === "payload" || stage === "confirm") && (
            <div className="rounded border p-3 space-y-2">
              <div className="font-medium text-sm">Payload summary (dry-run)</div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>Row count</div>
                <div>{dryRun.payload_row_count ?? "—"}</div>
                <div>Payload hash</div>
                <div className="font-mono break-all">{dryRun.payload_hash ?? "—"}</div>
                <div>Carry-forward used</div>
                <div>{dryRun.carry_forward_used ? "yes" : "no"}</div>
              </div>
              {dryRun.payload_summary && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground">
                    Show non-sensitive summary
                  </summary>
                  <pre className="mt-2 p-2 bg-muted rounded overflow-x-auto">
                    {JSON.stringify(dryRun.payload_summary, null, 2)}
                  </pre>
                </details>
              )}
              <p className="text-xs text-muted-foreground">
                Full payload body, decrypted source fields, and credentials are intentionally not
                shown.
              </p>
            </div>
          )}

          {/* Stage E — Confirm + Result */}
          {stage === "confirm" && prepared && (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                Payload is prepared. Submitting will trigger an <strong>external side effect</strong>{" "}
                — the KPI App will receive this submission.
              </AlertDescription>
            </Alert>
          )}

          {stage === "result" && submitResult && (
            <div className="rounded border p-3 space-y-2">
              <div className="font-medium text-sm flex items-center gap-2">
                Result{" "}
                <Badge variant={submitResult.ok ? "default" : "destructive"}>
                  {submitResult.status ?? (submitResult.ok ? "submitted" : "failed")}
                </Badge>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>Outbox ID</div>
                <div className="font-mono break-all">{submitResult.outbox_id ?? outboxId}</div>
                <div>Request ID</div>
                <div className="font-mono break-all">{submitResult.request_id ?? "—"}</div>
                {submitResult.upstream && (
                  <>
                    <div>Upstream HTTP</div>
                    <div>
                      {submitResult.upstream.status ?? "—"}{" "}
                      {submitResult.upstream.status_text ?? ""}
                    </div>
                  </>
                )}
                <div>Row count</div>
                <div>{submitResult.payload_row_count ?? "—"}</div>
              </div>
              {!submitResult.ok && submitResult.error && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>{submitResult.error}</AlertDescription>
                </Alert>
              )}
              {!submitResult.ok &&
                (submitResult.status === "failed" ||
                  submitResult.status === "retry_pending") &&
                (submitResult.outbox_id ?? outboxId) && (
                  <div className="pt-1">
                    <KpiAppRetryButton
                      outboxId={(submitResult.outbox_id ?? outboxId) as string}
                      organizationId={organizationId}
                      latestStatus={submitResult.status ?? "failed"}
                    />
                  </div>
                )}
              <p className="text-xs text-muted-foreground">
                Retry is manual only. No automatic retry or scheduler runs here.
              </p>
            </div>
          )}
        </div>

        <Separator />

        <DialogFooter className="flex-wrap gap-2">
          {stage === "period" && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={handlePreview} disabled={busy || !datesValid}>
                {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                Preview
              </Button>
            </>
          )}

          {stage === "preview" && (
            <>
              <Button variant="outline" onClick={() => setStage("period")} disabled={busy}>
                Back
              </Button>
              <Button
                onClick={handleCreateOutbox}
                disabled={busy || previewData?.reportable === false}
              >
                {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                Continue — create / reuse outbox
              </Button>
            </>
          )}

          {stage === "outbox" && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                Close
              </Button>
              <Button onClick={handleDryRun} disabled={busy}>
                {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                Run payload dry-run
              </Button>
            </>
          )}

          {stage === "payload" && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                Close
              </Button>
              <Button onClick={handlePrepare} disabled={busy}>
                {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                Prepare payload for submission
              </Button>
            </>
          )}

          {stage === "confirm" && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={busy} variant="destructive">
                {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                Submit to external KPI App
              </Button>
            </>
          )}

          {stage === "result" && (
            <Button onClick={() => onOpenChange(false)}>Close</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
