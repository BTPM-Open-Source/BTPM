// BTPM — Step C2-READ.1
// Admin-only Dimensions panel for `/dimensions`.

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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

interface Props {
  organizationId: string;
}

interface DimensionsPayload {
  ok: boolean;
  request_id?: string;
  scenarios?: { scenario_id: number; scenario_name: string }[];
  currencies?: { currency_id: number; currency_name: string; currency_code: string | null }[];
  raw_response_summary?: Record<string, unknown>;
  raw_response_sample?: unknown[];
  unrecognized_shape?: boolean;
  message?: string;
  safe_endpoint_summary?: { host: string; pathname: string };
  code?: string;
  http_status?: number;
  error?: string;
}

export function KpiAppDimensionsPanel({ organizationId }: Props) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DimensionsPayload | null>(null);

  async function handleFetch() {
    setLoading(true);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke<DimensionsPayload>(
        "read-kpi-app-dimensions",
        { body: { organization_id: organizationId } },
      );
      if (error) {
        toast({ title: "Fetch failed", description: error.message, variant: "destructive" });
        return;
      }
      setResult(data ?? null);
      if (data && !data.ok) {
        toast({
          title: "Dimensions fetch failed",
          description: data.code ?? data.error ?? "Unknown",
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
    const payload: Record<string, unknown> = {
      generated_at: new Date().toISOString(),
      scenarios: result.scenarios ?? [],
      currencies: result.currencies ?? [],
      raw_response_summary: result.raw_response_summary ?? null,
      safe_endpoint_summary: result.safe_endpoint_summary ?? null,
    };
    if (result.raw_response_sample !== undefined) {
      payload.raw_response_sample = result.raw_response_sample;
    }
    if (result.unrecognized_shape) payload.unrecognized_shape = true;
    if (result.code) payload.code = result.code;
    if (result.message) payload.message = result.message;
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    const date = new Date().toISOString().slice(0, 10);
    a.download = `btpm-kpi-app-dimensions-${date}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const scenarios = result?.scenarios ?? [];
  const currencies = result?.currencies ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">KPI App Dimensions</CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Calls the KPI App <code>/dimensions</code> endpoint via a protected Edge Function. Used to
          look up scenario and currency IDs for mapping configuration.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Button onClick={handleFetch} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Fetch dimensions
          </Button>
          <Button variant="outline" onClick={handleDownload} disabled={!result}>
            <Download className="h-4 w-4 mr-1" /> Download JSON
          </Button>
        </div>

        {result && !result.ok && (
          <Alert variant="destructive">
            <Info className="h-4 w-4" />
            <AlertDescription>
              Failed: <code>{result.code ?? result.error}</code>
              {result.http_status ? ` (HTTP ${result.http_status})` : ""}
            </AlertDescription>
          </Alert>
        )}

        {result?.unrecognized_shape && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              The KPI App returned a dimensions response shape BTPM does not yet recognize.
              Download JSON and send the <code>raw_response_sample</code> to confirm the parser.
              Summary: <code>{JSON.stringify(result.raw_response_summary)}</code>
            </AlertDescription>
          </Alert>
        )}

        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <h4 className="text-sm font-medium mb-2">Scenarios</h4>
            {scenarios.length === 0 ? (
              <p className="text-xs text-muted-foreground">No scenarios fetched.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Name</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {scenarios.map((s) => (
                    <TableRow key={s.scenario_id}>
                      <TableCell className="font-mono">{s.scenario_id}</TableCell>
                      <TableCell>{s.scenario_name}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
          <div>
            <h4 className="text-sm font-medium mb-2">Currencies</h4>
            {currencies.length === 0 ? (
              <p className="text-xs text-muted-foreground">No currencies fetched.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Name</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {currencies.map((c) => (
                    <TableRow key={c.currency_id}>
                      <TableCell className="font-mono">{c.currency_id}</TableCell>
                      <TableCell>{c.currency_code ?? "—"}</TableCell>
                      <TableCell>{c.currency_name}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
