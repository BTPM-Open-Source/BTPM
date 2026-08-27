import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  usePortfolioBenefitsRealization,
  type PortfolioBenefitsRealizationFilters,
  type PortfolioBenefitsFinancialEntry,
} from "@/hooks/usePortfolioBenefitsRealization";
import {
  PROJECT_BENEFIT_TYPE_OPTIONS,
  PROJECT_BENEFIT_REALIZATION_STATUS_OPTIONS,
} from "@/hooks/useProjectBenefits";
import { PageContainer } from "@/components/layout/PageContainer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  TrendingUp,
  ExternalLink,
  AlertCircle,
  Inbox,
  CheckCircle2,
} from "lucide-react";

const BENEFIT_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  PROJECT_BENEFIT_TYPE_OPTIONS.map((o) => [o.value, o.label]),
);

const REALIZATION_STATUS_LABELS: Record<string, string> = Object.fromEntries(
  PROJECT_BENEFIT_REALIZATION_STATUS_OPTIONS.map((o) => [o.value, o.label]),
);

const PROJECT_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "planning", label: "Planning" },
  { value: "active", label: "Active" },
  { value: "on_hold", label: "On Hold" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

function fmtNum(n: number | null | undefined, digits = 0) {
  if (n == null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n);
}

function fmtCurrency(amount: number, currency: string) {
  const symbol = currency === "EUR" ? "€" : currency === "USD" ? "$" : "";
  const abs = Math.abs(amount);
  if (abs >= 1_000_000) {
    return `${symbol}${(amount / 1_000_000).toFixed(1)}M`;
  }
  if (abs >= 1_000) {
    return `${symbol}${(amount / 1_000).toFixed(0)}k`;
  }
  return `${symbol}${amount.toFixed(0)}`;
}

function typeLabel(t: string, fallback?: string | null) {
  return BENEFIT_TYPE_LABELS[t] ?? fallback ?? t;
}

function realizationStatusLabel(status: string) {
  return REALIZATION_STATUS_LABELS[status] ?? status;
}

function FinancialCell({
  financial,
}: {
  financial: PortfolioBenefitsFinancialEntry[];
}) {
  const currencyEntries = financial.filter((f) =>
    ["EUR", "USD"].includes(f.unit),
  );
  if (currencyEntries.length === 0)
    return <span className="text-muted-foreground">—</span>;
  return (
    <div className="space-y-0.5 text-xs">
      {currencyEntries.map((f) => (
        <div key={f.unit}>
          <span className="font-medium">{f.unit}:</span>{" "}
          {fmtCurrency(f.target, f.unit)} target {" · "}
          {fmtCurrency(f.actual, f.unit)} actual
          {f.achievement_pct != null && (
            <span className="text-muted-foreground">
              {" "}
              ({f.achievement_pct.toFixed(0)}%)
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function uniqueOptions<T>(
  items: T[],
  getKey: (t: T) => string | null | undefined,
  getLabel: (t: T) => string | null | undefined,
): { value: string; label: string }[] {
  const map = new Map<string, string>();
  for (const it of items) {
    const k = getKey(it);
    if (!k) continue;
    if (!map.has(k)) map.set(k, getLabel(it) || k);
  }
  return Array.from(map.entries())
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

type MultiValue = string[];

function MultiSelect({
  label,
  options,
  value,
  onChange,
  placeholder = "All",
}: {
  label: string;
  options: { value: string; label: string }[];
  value: MultiValue;
  onChange: (v: MultiValue) => void;
  placeholder?: string;
}) {
  const current = value[0] ?? "__all";
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Select
        value={current}
        onValueChange={(v) => onChange(v === "__all" ? [] : [v])}
      >
        <SelectTrigger className="h-9">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all">All</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function EmptyPanel({
  icon: Icon = Inbox,
  message,
}: {
  icon?: typeof Inbox;
  message: string;
}) {
  return (
    <div className="py-10 flex flex-col items-center justify-center text-center">
      <Icon className="h-7 w-7 text-muted-foreground mb-2" />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

const NO_PORTFOLIO_VALUE = "__none__";

function formatPortfolioFromFields(
  id: string | null | undefined,
  name: string | null | undefined,
  code: string | null | undefined,
  isArchived: boolean | null | undefined,
): string | null {
  if (!id) return null;
  const base = code ? `${code} — ${name ?? "Unnamed Portfolio"}` : name ?? "Unnamed Portfolio";
  return isArchived ? `${base} (archived)` : base;
}

export default function BenefitsRealization() {
  const [portfolioIds, setPortfolioIds] = useState<string[]>([]);
  const [workspaceIds, setWorkspaceIds] = useState<string[]>([]);
  const [programIds, setProgramIds] = useState<string[]>([]);
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [projectStatuses, setProjectStatuses] = useState<string[]>([]);
  const [projectManagerIds, setProjectManagerIds] = useState<string[]>([]);
  const [benefitTypes, setBenefitTypes] = useState<string[]>([]);
  const [realizationStatuses, setRealizationStatuses] = useState<string[]>([]);
  const [expectedFrom, setExpectedFrom] = useState<string>("");
  const [expectedTo, setExpectedTo] = useState<string>("");
  const [activeTab, setActiveTab] = useState<string>("overview");

  const selectedRealPortfolioIds = portfolioIds.filter((id) => id !== NO_PORTFOLIO_VALUE);
  const includeNoPortfolio = portfolioIds.includes(NO_PORTFOLIO_VALUE);

  const filters: PortfolioBenefitsRealizationFilters = {
    workspaceIds,
    programIds,
    projectIds,
    projectStatuses,
    projectManagerIds,
    benefitTypes,
    realizationStatuses,
    expectedFrom: expectedFrom || null,
    expectedTo: expectedTo || null,
    includeArchived: false,
    portfolioItemIds: selectedRealPortfolioIds,
    includeNoPortfolio,
  };

  const { data, isLoading, error, refetch, isFetching } =
    usePortfolioBenefitsRealization(filters);

  const workspaceOptions = useMemo(
    () =>
      uniqueOptions(
        data?.benefits_by_project ?? [],
        (r) => r.workspace_id,
        (r) => r.workspace_name,
      ),
    [data],
  );
  const programOptions = useMemo(
    () =>
      uniqueOptions(
        data?.benefits_by_project ?? [],
        (r) => r.program_id,
        (r) => r.program_name,
      ),
    [data],
  );
  const projectOptions = useMemo(
    () =>
      uniqueOptions(
        data?.benefits_by_project ?? [],
        (r) => r.project_id,
        (r) => r.project_name,
      ),
    [data],
  );
  const pmOptions = useMemo(
    () =>
      uniqueOptions(
        data?.benefits_by_project ?? [],
        (r) => r.project_manager_id,
        (r) => r.project_manager_name,
      ),
    [data],
  );

  const portfolioOptions = useMemo(() => {
    const rows = data?.benefits_by_project ?? [];
    const map = new Map<string, { label: string }>();
    let hasNoPortfolio = false;
    for (const r of rows) {
      if (!r.portfolio_item_id) {
        hasNoPortfolio = true;
        continue;
      }
      if (!map.has(r.portfolio_item_id)) {
        const label =
          formatPortfolioFromFields(
            r.portfolio_item_id,
            r.portfolio_name,
            r.portfolio_code,
            r.portfolio_is_archived,
          ) ?? "Portfolio";
        map.set(r.portfolio_item_id, { label });
      }
    }
    const assigned = Array.from(map.entries())
      .map(([value, { label }]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
    if (hasNoPortfolio) {
      assigned.push({ value: NO_PORTFOLIO_VALUE, label: "No Portfolio" });
    }
    return assigned;
  }, [data]);

  const activeFilterCount = [
    portfolioIds,
    workspaceIds,
    programIds,
    projectIds,
    projectStatuses,
    projectManagerIds,
    benefitTypes,
    realizationStatuses,
  ].reduce((acc, arr) => acc + (arr.length > 0 ? 1 : 0), 0)
    + (expectedFrom ? 1 : 0)
    + (expectedTo ? 1 : 0);

  const clearFilters = () => {
    setPortfolioIds([]);
    setWorkspaceIds([]);
    setProgramIds([]);
    setProjectIds([]);
    setProjectStatuses([]);
    setProjectManagerIds([]);
    setBenefitTypes([]);
    setRealizationStatuses([]);
    setExpectedFrom("");
    setExpectedTo("");
  };

  const hasAnyBenefits = (data?.rows.length ?? 0) > 0;

  const workspaceByProject = useMemo(() => {
    const m = new Map<string, string | null>();
    (data?.benefits_by_project ?? []).forEach((p) =>
      m.set(p.project_id, p.workspace_id),
    );
    return m;
  }, [data]);

  // Overview previews
  const needsUpdatePreview = (data?.benefits_requiring_update ?? []).slice(0, 5);
  const topProjectsPreview = useMemo(() => {
    const list = [...(data?.benefits_by_project ?? [])];
    list.sort(
      (a, b) =>
        b.overdue_count - a.overdue_count || b.benefit_count - a.benefit_count,
    );
    return list.slice(0, 5);
  }, [data]);

  return (
    <PageContainer width="wide" className="py-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <TrendingUp className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-semibold tracking-tight">
              Benefits Realization
            </h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground max-w-3xl">
            Portfolio-wide visibility of expected and realized business value
            across accessible BTPM projects.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Benefits are maintained inside individual projects. This page is
            read-only and derived from project benefit records.
          </p>
        </div>
      </div>

      {error && (
        <Card className="border-destructive/50">
          <CardContent className="py-4 flex items-center justify-between gap-4">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-5 w-5 text-destructive shrink-0" />
              <div>
                <p className="font-medium">Unable to load portfolio benefits.</p>
                <p className="text-sm text-muted-foreground">
                  {(error as Error).message}
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Retry
            </Button>
          </CardContent>
        </Card>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {isLoading ? (
          Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))
        ) : (
          <>
            <KpiCard
              label="Projects with benefits"
              value={fmtNum(data?.summary.projects_with_benefits)}
            />
            <KpiCard
              label="Benefits tracked"
              value={fmtNum(data?.summary.benefits_tracked)}
            />
            <FinancialKpiCard financial={data?.summary.financial ?? []} />
            <KpiCard
              label="FTE saved"
              value={
                data?.summary.fte_saved
                  ? `${fmtNum(data.summary.fte_saved, 1)} FTE`
                  : "—"
              }
            />
            <KpiCard
              label="Hours saved"
              value={
                data?.summary.hours_saved
                  ? `${fmtNum(data.summary.hours_saved)} hrs`
                  : "—"
              }
            />
            <KpiCard
              label="Actuals pending"
              value={fmtNum(data?.summary.actuals_pending)}
            />
            <KpiCard
              label="Overdue for update"
              value={fmtNum(data?.summary.benefits_overdue_for_update)}
              accent={
                (data?.summary.benefits_overdue_for_update ?? 0) > 0
                  ? "warn"
                  : undefined
              }
            />
          </>
        )}
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base flex items-center gap-2">
            Filters
            {activeFilterCount > 0 && (
              <Badge variant="secondary" className="text-xs">
                {activeFilterCount} active
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <MultiSelect
            label="Portfolio"
            options={portfolioOptions}
            value={portfolioIds}
            onChange={setPortfolioIds}
          />
          <MultiSelect
            label="Workspace"
            options={workspaceOptions}
            value={workspaceIds}
            onChange={setWorkspaceIds}
          />
          <MultiSelect
            label="Program"
            options={programOptions}
            value={programIds}
            onChange={setProgramIds}
          />
          <MultiSelect
            label="Project"
            options={projectOptions}
            value={projectIds}
            onChange={setProjectIds}
          />
          <MultiSelect
            label="Project Status"
            options={PROJECT_STATUS_OPTIONS}
            value={projectStatuses}
            onChange={setProjectStatuses}
          />
          <MultiSelect
            label="Project Manager"
            options={pmOptions}
            value={projectManagerIds}
            onChange={setProjectManagerIds}
          />
          <MultiSelect
            label="Benefit Type"
            options={PROJECT_BENEFIT_TYPE_OPTIONS}
            value={benefitTypes}
            onChange={setBenefitTypes}
          />
          <MultiSelect
            label="Realization Status"
            options={PROJECT_BENEFIT_REALIZATION_STATUS_OPTIONS}
            value={realizationStatuses}
            onChange={setRealizationStatuses}
          />
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Expected From</Label>
            <Input
              type="date"
              className="h-9"
              value={expectedFrom}
              onChange={(e) => setExpectedFrom(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Expected To</Label>
            <Input
              type="date"
              className="h-9"
              value={expectedTo}
              onChange={(e) => setExpectedTo(e.target.value)}
            />
          </div>
          <div className="flex items-end">
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Global empty */}
      {!isLoading && !error && !hasAnyBenefits && (
        <Card>
          <CardContent className="py-12 flex flex-col items-center justify-center text-center">
            <Inbox className="h-8 w-8 text-muted-foreground mb-2" />
            <p className="font-medium">
              No benefits recorded for the current filters.
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              Benefits are created inside each project under Control → Benefits
              Realization.
            </p>
            <Button asChild variant="outline" size="sm" className="mt-4">
              <Link to="/projects">Open Projects</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Tabbed lenses */}
      {hasAnyBenefits && (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="by-type">By Type</TabsTrigger>
            <TabsTrigger value="by-project">By Project</TabsTrigger>
            <TabsTrigger value="needs-update">
              Needs Update
              {(data?.benefits_requiring_update.length ?? 0) > 0 && (
                <Badge variant="destructive" className="ml-2">
                  {data!.benefits_requiring_update.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="all">
              All Benefits
              <span className="ml-2 text-xs text-muted-foreground">
                ({data!.rows.length})
              </span>
            </TabsTrigger>
          </TabsList>

          {/* Overview */}
          <TabsContent value="overview" className="space-y-4 mt-4">
            <Card>
              <CardContent className="py-4 text-sm text-muted-foreground">
                This page is read-only. Benefits are maintained inside
                individual projects.
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-base">Needs attention</CardTitle>
                {(data?.benefits_requiring_update.length ?? 0) > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setActiveTab("needs-update")}
                  >
                    View all
                  </Button>
                )}
              </CardHeader>
              <CardContent className="p-0">
                {needsUpdatePreview.length === 0 ? (
                  <EmptyPanel
                    icon={CheckCircle2}
                    message="No benefits currently require update for the selected filters."
                  />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Metric</TableHead>
                        <TableHead>Project</TableHead>
                        <TableHead>Expected</TableHead>
                        <TableHead>Owner</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {needsUpdatePreview.map((r) => (
                        <TableRow key={r.benefit_id}>
                          <TableCell className="font-medium">
                            {r.metric_name ?? "—"}
                          </TableCell>
                          <TableCell>{r.project_name ?? "—"}</TableCell>
                          <TableCell>
                            {r.expected_realization_date ?? "—"}
                          </TableCell>
                          <TableCell>
                            {r.benefit_owner_name ?? "Unassigned"}
                          </TableCell>
                          <TableCell>
                            <Button asChild variant="ghost" size="sm">
                              <Link
                                to={`/workspace/${workspaceByProject.get(r.project_id) ?? ""}/project/${r.project_id}/benefits`}
                              >
                                Open <ExternalLink className="ml-1 h-3 w-3" />
                              </Link>
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-base">
                  Top projects by overdue &amp; volume
                </CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setActiveTab("by-project")}
                >
                  View all
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                {topProjectsPreview.length === 0 ? (
                  <EmptyPanel message="No project benefit summary is available for the current filters." />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Project</TableHead>
                        <TableHead>Workspace</TableHead>
                        <TableHead className="text-right">Benefits</TableHead>
                        <TableHead className="text-right">Overdue</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {topProjectsPreview.map((r) => (
                        <TableRow key={r.project_id}>
                          <TableCell className="font-medium">
                            <div>{r.project_name ?? "—"}</div>
                            {formatPortfolioFromFields(r.portfolio_item_id, r.portfolio_name, r.portfolio_code, r.portfolio_is_archived) && (
                              <div className="text-xs text-muted-foreground">
                                Portfolio: {formatPortfolioFromFields(r.portfolio_item_id, r.portfolio_name, r.portfolio_code, r.portfolio_is_archived)}
                              </div>
                            )}
                          </TableCell>
                          <TableCell>{r.workspace_name ?? "—"}</TableCell>
                          <TableCell className="text-right">
                            {r.benefit_count}
                          </TableCell>
                          <TableCell className="text-right">
                            {r.overdue_count > 0 ? (
                              <Badge variant="destructive">
                                {r.overdue_count}
                              </Badge>
                            ) : (
                              r.overdue_count
                            )}
                          </TableCell>
                          <TableCell>
                            {r.workspace_id && (
                              <Button asChild variant="ghost" size="sm">
                                <Link
                                  to={`/workspace/${r.workspace_id}/project/${r.project_id}/benefits`}
                                >
                                  Open{" "}
                                  <ExternalLink className="ml-1 h-3 w-3" />
                                </Link>
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* By Type */}
          <TabsContent value="by-type" className="mt-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Benefits by Type</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {data!.benefits_by_type.length === 0 ? (
                  <EmptyPanel message="No benefit type summary is available for the current filters." />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Benefit Type</TableHead>
                        <TableHead className="text-right">Benefits</TableHead>
                        <TableHead className="text-right">Projects</TableHead>
                        <TableHead>Financial</TableHead>
                        <TableHead className="text-right">FTE actual</TableHead>
                        <TableHead className="text-right">Hours actual</TableHead>
                        <TableHead className="text-right">Pending</TableHead>
                        <TableHead className="text-right">Overdue</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data!.benefits_by_type.map((r) => (
                        <TableRow key={r.benefit_type}>
                          <TableCell className="font-medium">
                            {typeLabel(r.benefit_type, r.benefit_type_label)}
                          </TableCell>
                          <TableCell className="text-right">
                            {r.benefit_count}
                          </TableCell>
                          <TableCell className="text-right">
                            {r.projects_count}
                          </TableCell>
                          <TableCell>
                            <FinancialCell financial={r.financial} />
                          </TableCell>
                          <TableCell className="text-right">
                            {r.fte_actual ? fmtNum(r.fte_actual, 1) : "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            {r.hours_actual ? fmtNum(r.hours_actual) : "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            {r.pending_count}
                          </TableCell>
                          <TableCell className="text-right">
                            {r.overdue_count > 0 ? (
                              <Badge variant="destructive">
                                {r.overdue_count}
                              </Badge>
                            ) : (
                              r.overdue_count
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* By Project */}
          <TabsContent value="by-project" className="mt-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Benefits by Project</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {data!.benefits_by_project.length === 0 ? (
                  <EmptyPanel message="No project benefit summary is available for the current filters." />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Project</TableHead>
                        <TableHead>Workspace</TableHead>
                        <TableHead>Program</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>PM</TableHead>
                        <TableHead className="text-right">Benefits</TableHead>
                        <TableHead>Financial</TableHead>
                        <TableHead className="text-right">FTE</TableHead>
                        <TableHead className="text-right">Hours</TableHead>
                        <TableHead className="text-right">Pending</TableHead>
                        <TableHead className="text-right">Overdue</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data!.benefits_by_project.map((r) => (
                        <TableRow key={r.project_id}>
                          <TableCell className="font-medium">
                            <div>{r.project_name ?? "—"}</div>
                            {formatPortfolioFromFields(r.portfolio_item_id, r.portfolio_name, r.portfolio_code, r.portfolio_is_archived) && (
                              <div className="text-xs text-muted-foreground">
                                Portfolio: {formatPortfolioFromFields(r.portfolio_item_id, r.portfolio_name, r.portfolio_code, r.portfolio_is_archived)}
                              </div>
                            )}
                          </TableCell>
                          <TableCell>{r.workspace_name ?? "—"}</TableCell>
                          <TableCell>{r.program_name ?? "—"}</TableCell>
                          <TableCell>
                            {r.project_status ? (
                              <Badge variant="secondary">
                                {r.project_status}
                              </Badge>
                            ) : (
                              "—"
                            )}
                          </TableCell>
                          <TableCell>
                            {r.project_manager_name ?? "Unassigned"}
                          </TableCell>
                          <TableCell className="text-right">
                            {r.benefit_count}
                          </TableCell>
                          <TableCell>
                            <FinancialCell financial={r.financial} />
                          </TableCell>
                          <TableCell className="text-right">
                            {r.fte_actual ? fmtNum(r.fte_actual, 1) : "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            {r.hours_actual ? fmtNum(r.hours_actual) : "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            {r.actuals_pending}
                          </TableCell>
                          <TableCell className="text-right">
                            {r.overdue_count > 0 ? (
                              <Badge variant="destructive">
                                {r.overdue_count}
                              </Badge>
                            ) : (
                              r.overdue_count
                            )}
                          </TableCell>
                          <TableCell>
                            {r.workspace_id && (
                              <Button asChild variant="ghost" size="sm">
                                <Link
                                  to={`/workspace/${r.workspace_id}/project/${r.project_id}/benefits`}
                                >
                                  Open{" "}
                                  <ExternalLink className="ml-1 h-3 w-3" />
                                </Link>
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Needs Update */}
          <TabsContent value="needs-update" className="mt-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  Benefits Requiring Update
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {data!.benefits_requiring_update.length === 0 ? (
                  <EmptyPanel
                    icon={CheckCircle2}
                    message="No benefits currently require update for the current filters."
                  />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Metric</TableHead>
                        <TableHead>Project</TableHead>
                        <TableHead>Workspace</TableHead>
                        <TableHead>Benefit Type</TableHead>
                        <TableHead className="text-right">Target</TableHead>
                        <TableHead className="text-right">Actual</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Expected Realization Date</TableHead>
                        <TableHead>Owner</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data!.benefits_requiring_update.map((r) => (
                        <TableRow key={r.benefit_id}>
                          <TableCell className="font-medium">
                            {r.metric_name ?? "—"}
                          </TableCell>
                          <TableCell>
                            <div>{r.project_name ?? "—"}</div>
                            {formatPortfolioFromFields(r.portfolio_item_id, r.portfolio_name, r.portfolio_code, r.portfolio_is_archived) && (
                              <div className="text-xs text-muted-foreground">
                                Portfolio: {formatPortfolioFromFields(r.portfolio_item_id, r.portfolio_name, r.portfolio_code, r.portfolio_is_archived)}
                              </div>
                            )}
                          </TableCell>
                          <TableCell>{r.workspace_name ?? "—"}</TableCell>
                          <TableCell>{typeLabel(r.benefit_type)}</TableCell>
                          <TableCell className="text-right">
                            {r.target_value != null
                              ? fmtNum(r.target_value, 1)
                              : "—"}
                            {r.unit_of_measure && (
                              <span className="text-muted-foreground text-xs ml-1">
                                {r.unit_of_measure}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {r.actual_value != null
                              ? fmtNum(r.actual_value, 1)
                              : "Pending"}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">
                              {realizationStatusLabel(r.realization_status)}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {r.expected_realization_date ?? "—"}
                          </TableCell>
                          <TableCell>
                            {r.benefit_owner_name ?? "Unassigned"}
                          </TableCell>
                          <TableCell>
                            <Button asChild variant="ghost" size="sm">
                              <Link
                                to={`/workspace/${workspaceByProject.get(r.project_id) ?? ""}/project/${r.project_id}/benefits`}
                              >
                                Open <ExternalLink className="ml-1 h-3 w-3" />
                              </Link>
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* All Benefits */}
          <TabsContent value="all" className="mt-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  All Benefits ({data!.rows.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {data!.rows.length === 0 ? (
                  <EmptyPanel message="No benefits recorded for the current filters." />
                ) : (
                  <div className="max-h-[600px] overflow-auto">
                    <Table>
                      <TableHeader className="sticky top-0 bg-background z-10">
                        <TableRow>
                          <TableHead>Metric</TableHead>
                          <TableHead>Project</TableHead>
                          <TableHead>Workspace</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Unit</TableHead>
                          <TableHead className="text-right">Target</TableHead>
                          <TableHead className="text-right">Actual</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Expected</TableHead>
                          <TableHead>Actual Date</TableHead>
                          <TableHead>Owner</TableHead>
                          <TableHead>Updated</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data!.rows.map((r) => (
                          <TableRow key={r.benefit_id}>
                            <TableCell className="font-medium">
                              {r.metric_name ?? "—"}
                            </TableCell>
                            <TableCell>
                              <div>{r.project_name ?? "—"}</div>
                              {formatPortfolioFromFields(r.portfolio_item_id, r.portfolio_name, r.portfolio_code, r.portfolio_is_archived) && (
                                <div className="text-xs text-muted-foreground">
                                  Portfolio: {formatPortfolioFromFields(r.portfolio_item_id, r.portfolio_name, r.portfolio_code, r.portfolio_is_archived)}
                                </div>
                              )}
                            </TableCell>
                            <TableCell>{r.workspace_name ?? "—"}</TableCell>
                            <TableCell>
                              {typeLabel(
                                r.benefit_type,
                                r.custom_benefit_type_label,
                              )}
                            </TableCell>
                            <TableCell>{r.unit_of_measure ?? "—"}</TableCell>
                            <TableCell className="text-right">
                              {r.target_value != null
                                ? fmtNum(r.target_value, 1)
                                : "—"}
                            </TableCell>
                            <TableCell className="text-right">
                              {r.actual_value != null
                                ? fmtNum(r.actual_value, 1)
                                : "Pending"}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline">
                                {realizationStatusLabel(r.realization_status)}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {r.expected_realization_date ?? "—"}
                            </TableCell>
                            <TableCell>
                              {r.actual_realization_date ?? "—"}
                            </TableCell>
                            <TableCell>
                              {r.benefit_owner_name ?? "Unassigned"}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {new Date(r.updated_at).toLocaleDateString()}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}

      {isFetching && !isLoading && (
        <p className="text-xs text-muted-foreground text-center">Refreshing…</p>
      )}
    </PageContainer>
  );
}

function KpiCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "warn";
}) {
  return (
    <Card>
      <CardContent className="py-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p
          className={
            "mt-1 text-2xl font-semibold " +
            (accent === "warn" ? "text-destructive" : "")
          }
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

function FinancialKpiCard({
  financial,
}: {
  financial: PortfolioBenefitsFinancialEntry[];
}) {
  const currencyEntries = financial.filter((f) =>
    ["EUR", "USD"].includes(f.unit),
  );
  return (
    <Card>
      <CardContent className="py-4">
        <p className="text-xs text-muted-foreground">
          Financial target / realized
        </p>
        {currencyEntries.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">
            No financial benefits
          </p>
        ) : (
          <div className="mt-1 space-y-0.5">
            {currencyEntries.map((f) => (
              <p key={f.unit} className="text-sm font-medium">
                <span className="text-muted-foreground text-xs mr-1">
                  {f.unit}:
                </span>
                {fmtCurrency(f.target, f.unit)} / {fmtCurrency(f.actual, f.unit)}
                {f.achievement_pct != null && (
                  <span className="text-muted-foreground text-xs ml-1">
                    ({f.achievement_pct.toFixed(0)}%)
                  </span>
                )}
              </p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
