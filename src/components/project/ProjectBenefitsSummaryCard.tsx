import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Target, ArrowRight, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useProjectBenefits, type ProjectBenefit } from "@/hooks/useProjectBenefits";

interface Props {
  workspaceId: string;
  projectId: string;
  canEdit?: boolean;
}

function normalizeCurrency(unit: string): string | null {
  const u = unit.trim().toUpperCase();
  if (u === "EUR" || u === "€") return "EUR";
  if (u === "USD" || u === "$") return "USD";
  return null;
}

function isSameUnit(unit: string, target: "FTE" | "HOURS"): boolean {
  const u = unit.trim().toLowerCase();
  if (target === "FTE") return u === "fte";
  if (target === "HOURS") return u === "hours" || u === "hour" || u === "hrs" || u === "hr";
  return false;
}

function isPercentUnit(unit: string): boolean {
  const u = unit.trim().toLowerCase();
  return u === "percent" || u === "%" || u === "pct";
}

function formatCurrency(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString()}`;
  }
}

function computeSummary(benefits: ProjectBenefit[]) {
  const active = benefits.filter((b) => !b.archived_at);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Financial totals per currency
  const financial = new Map<string, { target: number; actual: number; count: number }>();
  let fteActual = 0;
  let fteHasAny = false;
  let hoursActual = 0;
  let hoursHasAny = false;
  let actualsPending = 0;
  let overdue = 0;

  for (const b of active) {
    // Actuals pending
    if (b.actual_value === null && b.realization_status !== "not_applicable") {
      actualsPending += 1;
    }
    // Overdue
    if (
      b.expected_realization_date &&
      b.actual_value === null &&
      b.realization_status !== "realized" &&
      b.realization_status !== "not_applicable"
    ) {
      const exp = new Date(b.expected_realization_date);
      exp.setHours(0, 0, 0, 0);
      if (exp.getTime() < today.getTime()) overdue += 1;
    }

    if (b.benefit_type === "financial_value") {
      const cur = normalizeCurrency(b.unit_of_measure);
      if (cur) {
        const entry = financial.get(cur) ?? { target: 0, actual: 0, count: 0 };
        entry.target += Number(b.target_value) || 0;
        if (b.actual_value !== null) entry.actual += Number(b.actual_value) || 0;
        entry.count += 1;
        financial.set(cur, entry);
      }
    }

    if (isSameUnit(b.unit_of_measure, "FTE")) {
      fteHasAny = true;
      if (b.actual_value !== null) fteActual += Number(b.actual_value) || 0;
    }
    if (isSameUnit(b.unit_of_measure, "HOURS")) {
      hoursHasAny = true;
      if (b.actual_value !== null) hoursActual += Number(b.actual_value) || 0;
    }
    // percent: intentionally excluded from totals (§6.5)
    void isPercentUnit;
  }

  const financialEntries = Array.from(financial.entries());
  const singleCurrency = financialEntries.length === 1 ? financialEntries[0] : null;
  const mixedCurrencies = financialEntries.length > 1;

  let achievement: number | null = null;
  if (singleCurrency && singleCurrency[1].target > 0) {
    achievement = (singleCurrency[1].actual / singleCurrency[1].target) * 100;
  }

  return {
    total: active.length,
    financialSingle: singleCurrency
      ? { currency: singleCurrency[0], ...singleCurrency[1] }
      : null,
    mixedCurrencies,
    financialCount: financialEntries.reduce((n, [, v]) => n + v.count, 0),
    fte: fteHasAny ? fteActual : null,
    hours: hoursHasAny ? hoursActual : null,
    actualsPending,
    overdue,
    achievement,
  };
}

export function ProjectBenefitsSummaryCard({ workspaceId, projectId, canEdit }: Props) {
  const { data: benefits, isLoading, isError } = useProjectBenefits(projectId);
  const benefitsUrl = `/workspace/${workspaceId}/project/${projectId}/benefits`;

  const summary = useMemo(() => computeSummary(benefits ?? []), [benefits]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </CardContent>
      </Card>
    );
  }

  const Header = (
    <CardHeader className="pb-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <CardTitle className="text-base flex items-center gap-2">
          <Target className="h-4 w-4 text-primary" />
          Benefits Realization
          {summary.total > 0 && (
            <span className="text-sm font-normal text-muted-foreground">
              ({summary.total})
            </span>
          )}
        </CardTitle>
        <Button variant="link" size="sm" asChild className="text-xs">
          <Link to={benefitsUrl}>Manage →</Link>
        </Button>
      </div>
    </CardHeader>
  );

  if (isError) {
    return (
      <Card>
        {Header}
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <AlertCircle className="h-4 w-4" />
            Benefits summary unavailable.
            <Link to={benefitsUrl} className="underline underline-offset-2">
              Open Benefits Realization
            </Link>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (summary.total === 0) {
    return (
      <Card>
        {Header}
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            No benefits recorded yet. Track expected and realized project value for
            closure reporting and portfolio visibility.
          </p>
          <Button variant="outline" size="sm" asChild className="text-xs h-8">
            <Link to={benefitsUrl}>
              {canEdit ? "Add benefits" : "View benefits"}
              <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const rows: { label: string; value: string; tone?: "danger" | "muted" }[] = [];
  rows.push({ label: "Tracked", value: String(summary.total) });

  if (summary.financialSingle) {
    rows.push({
      label: "Financial target",
      value: formatCurrency(summary.financialSingle.target, summary.financialSingle.currency),
    });
    rows.push({
      label: "Financial realized",
      value: formatCurrency(summary.financialSingle.actual, summary.financialSingle.currency),
    });
  } else if (summary.mixedCurrencies) {
    rows.push({
      label: "Financial",
      value: `Mixed currencies (${summary.financialCount})`,
      tone: "muted",
    });
  }

  if (summary.achievement !== null) {
    rows.push({ label: "Achievement", value: `${Math.round(summary.achievement)}%` });
  }
  if (summary.fte !== null) {
    rows.push({ label: "FTE saved", value: summary.fte.toLocaleString() });
  }
  if (summary.hours !== null) {
    rows.push({ label: "Hours saved", value: summary.hours.toLocaleString() });
  }
  if (summary.actualsPending > 0) {
    rows.push({
      label: "Actuals pending",
      value: String(summary.actualsPending),
      tone: "muted",
    });
  }

  return (
    <Card>
      {Header}
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
          {rows.slice(0, 6).map((r) => (
            <div key={r.label}>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {r.label}
              </div>
              <div
                className={cn(
                  "text-sm font-medium",
                  r.tone === "danger" && "text-[hsl(var(--destructive))]",
                  r.tone === "muted" && "text-muted-foreground",
                  !r.tone && "text-foreground",
                )}
              >
                {r.value}
              </div>
            </div>
          ))}
        </div>

        {summary.overdue > 0 && (
          <Badge
            variant="outline"
            className="text-[11px] bg-[hsl(var(--warning))]/10 text-[hsl(var(--warning))] border-[hsl(var(--warning))]/30"
          >
            {summary.overdue} overdue realization {summary.overdue === 1 ? "update" : "updates"}
          </Badge>
        )}

        <div className="pt-1">
          <Button variant="outline" size="sm" asChild className="text-xs h-8">
            <Link to={benefitsUrl}>
              Open Benefits Realization
              <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
