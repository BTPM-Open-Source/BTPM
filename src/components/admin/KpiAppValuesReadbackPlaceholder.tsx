// BTPM — Step C2-READ.1
// Placeholder tab for "KPI DB Values Readback". No API call is made. No fake
// data is shown. This exists to document the future capability and the
// remaining IT dependency.

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Clock, Info } from "lucide-react";

export function KpiAppValuesReadbackPlaceholder() {
  return (
    <div className="space-y-4">
      <Alert>
        <Clock className="h-4 w-4" />
        <AlertDescription>
          Submitted KPI values readback is <strong>not available yet</strong> because the KPI App
          API does not currently expose a values endpoint. Use the <strong>API Read Test</strong>{" "}
          tab to test the available <code>/kpis</code> and <code>/dimensions</code> endpoints.
          Once IT provides a values endpoint, this tab will show values from the external KPI DB
          and reconcile them with BTPM outbox submissions.
        </AlertDescription>
      </Alert>

      <Card className="opacity-70">
        <CardHeader>
          <CardTitle className="text-base">KPI DB Values Readback (disabled)</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Controls below are disabled previews of the future UX.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Date from</label>
              <Input type="date" disabled />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Date to</label>
              <Input type="date" disabled />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">External KPI</label>
              <Select disabled>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent><SelectItem value="x">—</SelectItem></SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Scenario</label>
              <Select disabled>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent><SelectItem value="x">—</SelectItem></SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Currency</label>
              <Select disabled>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent><SelectItem value="x">—</SelectItem></SelectContent>
              </Select>
            </div>
          </div>
          <Button disabled>Fetch values</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Needed from IT</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="text-sm list-disc pl-5 space-y-1">
            <li>Values read endpoint path (e.g. <code>/values</code>)</li>
            <li>HTTP method (GET / POST)</li>
            <li>Request parameters (date range, external KPI ID, scenario, currency, paging)</li>
            <li>Response JSON structure (one row per period? per submission? aggregated?)</li>
            <li>Whether values are sourced from approved submissions only or include drafts</li>
          </ul>
          <Alert className="mt-3">
            <Info className="h-4 w-4" />
            <AlertDescription>
              No fake KPI DB values will ever be displayed here. This tab stays disabled until the
              endpoint is provided.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    </div>
  );
}
