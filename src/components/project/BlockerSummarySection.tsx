import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Ban } from "lucide-react";

type Blocker = {
  id: string;
  title: string;
  status: string;
  severity: string;
};

const severityColor: Record<string, string> = {
  low: "bg-muted text-muted-foreground",
  medium: "bg-[#F59E0B]/10 text-[#F59E0B]",
  high: "bg-[#F97316]/10 text-[#F97316]",
  critical: "bg-destructive/10 text-destructive",
};

export function BlockerSummarySection({ blockers, isLoading }: { blockers: Blocker[]; isLoading: boolean }) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">Blockers</CardTitle></CardHeader>
        <CardContent><p className="text-sm text-muted-foreground">Loading…</p></CardContent>
      </Card>
    );
  }

  const openBlockers = blockers.filter((b) => b.status !== "resolved");

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Ban className="h-4 w-4" />
          Blockers
          {openBlockers.length > 0 && (
            <Badge variant="destructive" className="ml-1">{openBlockers.length} open</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {blockers.length === 0 ? (
          <p className="text-sm text-muted-foreground">No blockers recorded.</p>
        ) : (
          <div className="space-y-2">
            {openBlockers.slice(0, 5).map((b) => (
              <div key={b.id} className="flex items-center justify-between text-sm">
                <span className="truncate mr-2">{b.title}</span>
                <Badge className={severityColor[b.severity] || ""}>{b.severity}</Badge>
              </div>
            ))}
            {openBlockers.length > 5 && (
              <p className="text-xs text-muted-foreground">+{openBlockers.length - 5} more</p>
            )}
            {openBlockers.length === 0 && blockers.length > 0 && (
              <p className="text-sm text-muted-foreground">All blockers resolved.</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
