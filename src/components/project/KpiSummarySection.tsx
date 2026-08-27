import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp } from "lucide-react";

type KpiDef = {
  id: string;
  name: string;
  unit: string | null;
  target_value: number | null;
  current_value: number | null;
  target_direction: string;
  is_archived: boolean;
};

const directionLabel: Record<string, string> = {
  increase: "↑",
  decrease: "↓",
  maintain: "→",
  target_exact: "=",
};

export function KpiSummarySection({ kpis, isLoading }: { kpis: KpiDef[]; isLoading: boolean }) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">KPIs</CardTitle></CardHeader>
        <CardContent><p className="text-sm text-muted-foreground">Loading…</p></CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <TrendingUp className="h-4 w-4" />
          KPIs
          <span className="text-sm font-normal text-muted-foreground">({kpis.length})</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {kpis.length === 0 ? (
          <p className="text-sm text-muted-foreground">No KPIs defined.</p>
        ) : (
          <div className="space-y-3">
            {kpis.map((kpi) => (
              <div key={kpi.id} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-muted-foreground">{directionLabel[kpi.target_direction] || ""}</span>
                  <span className="truncate">{kpi.name}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-medium tabular-nums">
                    {kpi.current_value != null ? kpi.current_value : "—"}
                  </span>
                  {kpi.target_value != null && (
                    <Badge variant="outline" className="text-xs">
                      Target: {kpi.target_value}
                    </Badge>
                  )}
                  {kpi.unit && <span className="text-xs text-muted-foreground">{kpi.unit}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
