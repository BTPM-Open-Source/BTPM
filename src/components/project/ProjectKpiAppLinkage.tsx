// BTPM — Wave C2, Step C2.8
// Read-only Project KPI ↔ External KPI App linkage badge/panel.
//
// Hard rules:
//   - Renders only non-sensitive linkage and outbox metadata.
//   - No mapping editor controls. No Report Now. No retry. No scheduler.
//   - No call to build-kpi-app-payload or submit-kpi-app-payload.
//   - schedule_signal KPIs are explicitly shown as "Not eligible".

import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, Link2, Link2Off, AlertTriangle } from "lucide-react";
import type { ProjectKpiLinkage } from "@/hooks/useProjectKpiAppLinkage";

interface Props {
  /** KPI calculation_key — used to detect non-eligible schedule_signal KPIs. */
  calculationKey: string | null;
  /** Linkage row for this KPI; undefined = not mapped. */
  linkage: ProjectKpiLinkage | undefined;
  /** Whether outbox metadata could be read at all (RLS gate). */
  outboxAccessible: boolean;
  /** True if current user is an authorized org admin (controls Manage link). */
  isAdmin: boolean;
}

const FREQUENCY_LABELS: Record<string, string> = {
  manual_only: "Manual only",
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
};

export function ProjectKpiAppLinkage({
  calculationKey,
  linkage,
  outboxAccessible,
  isAdmin,
}: Props) {
  // schedule_signal: explicitly excluded by C2.1 / outbox validator.
  if (calculationKey === "schedule_signal") {
    return (
      <div
        className="flex items-center gap-1.5 mt-1 text-[11px] text-muted-foreground"
        onClick={(e) => e.stopPropagation()}
      >
        <Badge variant="outline" className="gap-1 text-[10px] py-0 h-5">
          <AlertTriangle className="h-3 w-3" />
          KPI App: Not eligible (schedule_signal)
        </Badge>
      </div>
    );
  }

  if (!linkage) {
    return (
      <div
        className="flex items-center gap-1.5 mt-1 text-[11px] text-muted-foreground flex-wrap"
        onClick={(e) => e.stopPropagation()}
      >
        <Badge variant="outline" className="gap-1 text-[10px] py-0 h-5">
          <Link2Off className="h-3 w-3" />
          KPI App: Not mapped
        </Badge>
        {isAdmin && (
          <Link
            to="/admin/kpi-app"
            className="inline-flex items-center gap-0.5 text-[11px] text-primary hover:underline"
          >
            Manage <ExternalLink className="h-3 w-3" />
          </Link>
        )}
      </div>
    );
  }

  const m = linkage.mapping;
  const ob = linkage.latest_outbox;
  const inactive = !m.is_active;

  return (
    <div
      className="flex items-center gap-1.5 mt-1 text-[11px] text-muted-foreground flex-wrap"
      onClick={(e) => e.stopPropagation()}
    >
      <Badge
        variant={inactive ? "outline" : "default"}
        className="gap-1 text-[10px] py-0 h-5"
        title={
          linkage.external_kpi_name
            ? `External KPI #${m.external_kpi_id} — ${linkage.external_kpi_name}`
            : `External KPI #${m.external_kpi_id}`
        }
      >
        <Link2 className="h-3 w-3" />
        {inactive ? "Mapping inactive" : "Mapped"}
        {" · #"}
        {m.external_kpi_id}
      </Badge>
      {linkage.external_kpi_name && (
        <span className="truncate max-w-[16rem]" title={linkage.external_kpi_name}>
          {linkage.external_kpi_name}
        </span>
      )}
      {linkage.external_value_type && (
        <Badge variant="outline" className="text-[10px] py-0 h-5">
          {linkage.external_value_type}
        </Badge>
      )}
      <Badge variant="outline" className="text-[10px] py-0 h-5">
        {FREQUENCY_LABELS[m.reporting_frequency] ?? m.reporting_frequency}
      </Badge>
      <Badge
        variant="outline"
        className="text-[10px] py-0 h-5"
        title="Auto-submit official snapshots: submits existing official snapshots to the KPI App. It does not create snapshots."
      >
        {m.auto_submit_enabled
          ? "Auto-submit official snapshots: on"
          : "Auto-submit official snapshots: off"}
      </Badge>
      {m.carry_forward_allowed && (
        <Badge variant="outline" className="text-[10px] py-0 h-5">
          Carry-forward
        </Badge>
      )}
      <Badge variant="outline" className="text-[10px] py-0 h-5" title="Entered-by source">
        by: {m.entered_by_email_source}
      </Badge>
      <Badge variant="outline" className="text-[10px] py-0 h-5" title="Comment source">
        cmt: {m.comment_source}
      </Badge>
      <Badge variant="outline" className="text-[10px] py-0 h-5" title="Action plan source">
        act: {m.action_plan_source}
      </Badge>

      {/* Latest non-sensitive submission metadata — only when RLS allows. */}
      {outboxAccessible ? (
        ob ? (
          <span className="text-[11px]">
            · last:{" "}
            <span className="text-foreground">{ob.status}</span>
            {ob.reporting_period_start && ob.reporting_period_end && (
              <>
                {" "}
                <span className="text-muted-foreground">
                  ({ob.reporting_period_start}→{ob.reporting_period_end})
                </span>
              </>
            )}
            {ob.payload_row_count != null && (
              <> · {ob.payload_row_count} rows</>
            )}
            {ob.carry_forward_used && <> · carry-fwd</>}
            {ob.last_http_status != null && <> · http {ob.last_http_status}</>}
            {ob.submitted_at && (
              <> · {new Date(ob.submitted_at).toLocaleDateString()}</>
            )}
          </span>
        ) : (
          <span className="text-[11px]">· no submissions yet</span>
        )
      ) : (
        <span className="text-[11px] italic">
          · submission status visible to admins only
        </span>
      )}

      {isAdmin && (
        <Link
          to="/admin/kpi-app"
          className="inline-flex items-center gap-0.5 text-[11px] text-primary hover:underline ml-1"
        >
          Manage <ExternalLink className="h-3 w-3" />
        </Link>
      )}
    </div>
  );
}
