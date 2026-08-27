// BTPM — C2-FIX.5
// Admin UI for downloading the KPI Automation Protocol as JSON.
//
// Read-only operational view. Calls the protected
// export-kpi-automation-protocol Edge Function and triggers a JSON
// download. No business logic, no submissions, no scheduler activation.

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Download, Info, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface Props {
  organizationId: string;
  workspaceId: string | null;
}

function isoDaysAgo(n: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

export function KpiAutomationProtocolPanel({ organizationId: _orgId, workspaceId }: Props) {
  const { toast } = useToast();
  const [periodStart, setPeriodStart] = useState<string>(isoDaysAgo(7));
  const [periodEnd, setPeriodEnd] = useState<string>(isoDaysAgo(0));
  const [externalKpiIdsRaw, setExternalKpiIdsRaw] = useState<string>("");
  const [includeSnap, setIncludeSnap] = useState(true);
  const [includeSubmit, setIncludeSubmit] = useState(true);
  const [includeOutbox, setIncludeOutbox] = useState(true);
  const [includeAttempts, setIncludeAttempts] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSummary, setLastSummary] = useState<Record<string, unknown> | null>(null);

  async function handleDownload() {
    setError(null);
    setLoading(true);
    setLastSummary(null);
    try {
      const ids = externalKpiIdsRaw
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => Number(s))
        .filter((n) => Number.isFinite(n));
      const body: Record<string, unknown> = {
        period_start: periodStart,
        period_end: periodEnd,
        include_snapshot_protocol: includeSnap,
        include_submit_protocol: includeSubmit,
        include_outbox_history: includeOutbox,
        include_attempts: includeAttempts,
      };
      if (workspaceId) body.workspace_id = workspaceId;
      if (ids.length) body.external_kpi_ids = ids;

      const { data, error: invokeErr } = await supabase.functions.invoke(
        "export-kpi-automation-protocol",
        { body },
      );
      if (invokeErr) throw new Error(invokeErr.message);
      if (!data || (data as any).ok !== true) {
        throw new Error((data as any)?.error ?? "Export failed");
      }

      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `btpm-kpi-automation-protocol-${periodStart}-to-${periodEnd}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setLastSummary((data as any).summary ?? null);
      toast({ title: "Protocol downloaded", description: "JSON file saved." });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setError(msg);
      toast({ title: "Download failed", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription className="text-xs">
          Download a read-only JSON protocol of automatic KPI snapshot capture and KPI App
          auto-submit activity for the selected period. The protocol references canonical rows
          (snapshots, outbox, attempts) and does not duplicate KPI values. Decrypted comments,
          action plans, and string values are <strong>not</strong> exported — only
          <code>*_present</code> indicators.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Automation Protocol Export</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor="ap-from">Period start</Label>
              <Input
                id="ap-from"
                type="date"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ap-to">Period end</Label>
              <Input
                id="ap-to"
                type="date"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="ap-ext">External KPI IDs (optional, comma-separated)</Label>
            <Input
              id="ap-ext"
              placeholder="e.g. 132, 134, 135, 138"
              value={externalKpiIdsRaw}
              onChange={(e) => setExternalKpiIdsRaw(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-2 text-sm">
            <label className="flex items-center gap-2">
              <Checkbox checked={includeSnap} onCheckedChange={(v) => setIncludeSnap(v === true)} />
              Include snapshot protocol
            </label>
            <label className="flex items-center gap-2">
              <Checkbox checked={includeSubmit} onCheckedChange={(v) => setIncludeSubmit(v === true)} />
              Include submission protocol
            </label>
            <label className="flex items-center gap-2">
              <Checkbox checked={includeOutbox} onCheckedChange={(v) => setIncludeOutbox(v === true)} />
              Include outbox history
            </label>
            <label className="flex items-center gap-2">
              <Checkbox checked={includeAttempts} onCheckedChange={(v) => setIncludeAttempts(v === true)} />
              Include submission attempts
            </label>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription className="text-xs">{error}</AlertDescription>
            </Alert>
          )}

          <Button onClick={handleDownload} disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Preparing…
              </>
            ) : (
              <>
                <Download className="h-4 w-4 mr-2" /> Download JSON
              </>
            )}
          </Button>

          {lastSummary && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Last export summary</CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="text-xs overflow-x-auto bg-muted/40 p-3 rounded">
                  {JSON.stringify(lastSummary, null, 2)}
                </pre>
              </CardContent>
            </Card>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
