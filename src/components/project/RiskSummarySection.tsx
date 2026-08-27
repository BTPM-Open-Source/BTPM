import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle } from "lucide-react";
import {
  riskStatusLabel,
  riskStatusBadgeClass,
  isActiveRiskStatus,
  isRealizedRiskStatus,
} from "@/lib/riskLifecycle";

type Risk = {
  id: string;
  title: string;
  status: string;
  likelihood: string;
  impact: string;
};

const impactColor: Record<string, string> = {
  low: "bg-muted text-muted-foreground",
  medium: "bg-[#F59E0B]/10 text-[#F59E0B]",
  high: "bg-[#F97316]/10 text-[#F97316]",
  critical: "bg-destructive/10 text-destructive",
};

export function RiskSummarySection({ risks, isLoading }: { risks: Risk[]; isLoading: boolean }) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">Risks</CardTitle></CardHeader>
        <CardContent><p className="text-sm text-muted-foreground">Loading…</p></CardContent>
      </Card>
    );
  }

  // "Open" here = anything not in terminal closed state. Realized stays visible
  // because it's the strongest active signal.
  const openRisks = risks.filter((r) => r.status !== "closed");
  const counts = {
    open: openRisks.filter((r) => r.status === "open" || r.status === "identified").length,
    under_mitigation: openRisks.filter(
      (r) => r.status === "under_mitigation" || r.status === "mitigating",
    ).length,
    monitoring: openRisks.filter((r) => r.status === "monitoring" || r.status === "accepted").length,
    realized: openRisks.filter((r) => isRealizedRiskStatus(r.status)).length,
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" />
          Risks
          {openRisks.length > 0 && (
            <Badge variant="secondary" className="ml-1">{openRisks.length} open</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {risks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No risks recorded.</p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {counts.open > 0 && <span>Open: {counts.open}</span>}
              {counts.under_mitigation > 0 && <span>Under Mitigation: {counts.under_mitigation}</span>}
              {counts.monitoring > 0 && <span>Monitoring: {counts.monitoring}</span>}
              {counts.realized > 0 && (
                <span className="text-destructive font-medium">Realized: {counts.realized}</span>
              )}
            </div>
            <div className="space-y-2">
              {openRisks.slice(0, 5).map((risk) => (
                <div key={risk.id} className="flex items-center justify-between text-sm">
                  <span className="truncate mr-2">{risk.title}</span>
                  <div className="flex gap-1 shrink-0">
                    <Badge className={riskStatusBadgeClass(risk.status)}>
                      {riskStatusLabel(risk.status)}
                    </Badge>
                    <Badge className={impactColor[risk.impact] || ""}>{risk.impact}</Badge>
                  </div>
                </div>
              ))}
              {openRisks.length > 5 && (
                <p className="text-xs text-muted-foreground">+{openRisks.length - 5} more</p>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
