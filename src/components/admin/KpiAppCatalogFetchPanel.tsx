// BTPM — Step C2-READ.1
// Admin-only "Fetch from KPI App" panel for `/kpis?maintainerEmail=...`.
// Transient fetched-data only — does NOT persist into BTPM catalog.

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Download, RefreshCw, Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useKpiAppExternalCatalog } from "@/hooks/useKpiAppIntegration";

interface Props {
  organizationId: string;
}

interface FetchedKpi {
  external_kpi_id: number;
  external_kpi_name: string;
  category: string | null;
  value_type: string | null;
  description: string | null;
  update_frequency: string | null;
  is_corporate: boolean;
  is_top10: boolean;
  is_departmental: boolean;
  is_individual: boolean;
}

interface FetchedPayload {
  ok: boolean;
  request_id?: string;
  maintainer_email?: string;
  row_count?: number;
  rows?: FetchedKpi[];
  safe_endpoint_summary?: { host: string; pathname: string };
  code?: string;
  http_status?: number;
  error?: string;
}

export function KpiAppCatalogFetchPanel({ organizationId }: Props) {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<FetchedPayload | null>(null);
  const { data: btpmCatalog } = useKpiAppExternalCatalog(organizationId);

  const btpmIdSet = useMemo(
    () => new Set((btpmCatalog ?? []).map((c) => c.external_kpi_id)),
    [btpmCatalog],
  );

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (data?.user?.email && !email) setEmail(data.user.email);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleFetch() {
    setLoading(true);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke<FetchedPayload>(
        "read-kpi-app-catalog",
        { body: { organization_id: organizationId, maintainer_email: email.trim() } },
      );
      if (error) {
        toast({ title: "Fetch failed", description: error.message, variant: "destructive" });
        return;
      }
      setResult(data ?? null);
      if (data && !data.ok) {
        toast({
          title: "KPI App returned an error",
          description: data.code ?? data.error ?? "Unknown error",
          variant: "destructive",
        });
      }
    } catch (e: any) {
      toast({ title: "Fetch failed", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  function handleDownload() {
    if (!result) return;
    const payload = {
      generated_at: new Date().toISOString(),
      generated_by: email,
      maintainer_email: result.maintainer_email ?? email,
      row_count: result.row_count ?? result.rows?.length ?? 0,
      rows: result.rows ?? [],
      safe_endpoint_summary: result.safe_endpoint_summary ?? null,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    const date = new Date().toISOString().slice(0, 10);
    a.download = `btpm-kpi-app-catalog-maintainer-${date}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const rows = result?.rows ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Fetch from KPI App</CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Calls the KPI App <code>/kpis?maintainerEmail=…</code> endpoint via a protected Edge
          Function. Results are read-only and not stored in BTPM.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
          <div className="flex-1">
            <label className="text-xs text-muted-foreground">Maintainer email</label>
            <Input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@company.com"
              type="email"
            />
            <p className="text-xs text-muted-foreground mt-1">
              The KPI App returns KPIs maintained by this email. Default is your BTPM login email.
            </p>
          </div>
          <div className="flex gap-2">
            <Button onClick={handleFetch} disabled={loading || !email.trim()}>
              <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
              Fetch KPIs from KPI App
            </Button>
            <Button variant="outline" onClick={handleDownload} disabled={!result?.ok || rows.length === 0}>
              <Download className="h-4 w-4 mr-1" /> Download JSON
            </Button>
          </div>
        </div>

        {result && !result.ok && (
          <Alert variant="destructive">
            <Info className="h-4 w-4" />
            <AlertDescription>
              KPI App fetch failed: <code>{result.code ?? result.error ?? "unknown"}</code>
              {result.http_status ? ` (HTTP ${result.http_status})` : ""}
              {result.safe_endpoint_summary
                ? ` — endpoint ${result.safe_endpoint_summary.host}${result.safe_endpoint_summary.pathname}`
                : ""}
            </AlertDescription>
          </Alert>
        )}

        {result?.ok && (
          <div className="text-xs text-muted-foreground">
            Returned {rows.length} KPI{rows.length === 1 ? "" : "s"} for{" "}
            <strong>{result.maintainer_email}</strong>
            {result.safe_endpoint_summary
              ? ` — ${result.safe_endpoint_summary.host}${result.safe_endpoint_summary.pathname}`
              : ""}
          </div>
        )}

        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>External KPI ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Value type</TableHead>
                  <TableHead>Frequency</TableHead>
                  <TableHead>Flags</TableHead>
                  <TableHead>In BTPM catalog?</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.external_kpi_id}>
                    <TableCell className="font-mono">#{r.external_kpi_id}</TableCell>
                    <TableCell>{r.external_kpi_name}</TableCell>
                    <TableCell>{r.category ?? "—"}</TableCell>
                    <TableCell>{r.value_type ?? "—"}</TableCell>
                    <TableCell>{r.update_frequency ?? "—"}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {r.is_corporate && <Badge variant="outline" className="text-xs">Corporate</Badge>}
                        {r.is_top10 && <Badge variant="outline" className="text-xs">Top 10</Badge>}
                        {r.is_departmental && <Badge variant="outline" className="text-xs">Departmental</Badge>}
                        {r.is_individual && <Badge variant="outline" className="text-xs">Individual</Badge>}
                      </div>
                    </TableCell>
                    <TableCell>
                      {btpmIdSet.has(r.external_kpi_id) ? (
                        <Badge variant="default">Yes</Badge>
                      ) : (
                        <Badge variant="secondary">Not synced</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
