/**
 * Wave C3 — Step C3.6
 * AutoSnapshotCaptureStatus
 *
 * Read-only visibility of automatic KPI snapshot capture status.
 * Pure presentational component — does NOT call any backend, does
 * NOT toggle `auto_snapshot_enabled` (C3.7 will add the editor),
 * does NOT trigger the scheduler.
 *
 * States rendered:
 *   - Manual KPI                       → "Not applicable"
 *   - Automatic KPI not eligible       → "Not eligible" + reason
 *       (manual_only cadence, archived, missing calculation_key,
 *        schedule_signal excluded, unsupported cadence)
 *   - Automatic KPI eligible, disabled → "Off"
 *   - Automatic KPI eligible, enabled  → "On"
 */
import { Badge } from "@/components/ui/badge";
import type { Tables } from "@/integrations/supabase/types";

type KpiDef = Tables<"kpi_definitions">;

const SUPPORTED_CADENCES = new Set(["weekly", "monthly", "quarterly", "yearly"]);

type AutoSnapshotState =
  | { kind: "not_applicable"; reason: string }
  | { kind: "not_eligible"; reason: string }
  | { kind: "off"; reason: string }
  | { kind: "on"; reason: string };

export function evaluateAutoSnapshotCaptureState(kpi: KpiDef): AutoSnapshotState {
  if (kpi.source_mode !== "automatic") {
    return {
      kind: "not_applicable",
      reason: "Manual KPIs use manual updates and official snapshots.",
    };
  }
  if (kpi.is_archived) {
    return {
      kind: "not_eligible",
      reason: "KPI is archived.",
    };
  }
  if (!kpi.calculation_key) {
    return {
      kind: "not_eligible",
      reason: "Automatic KPI is missing a calculation key.",
    };
  }
  if (kpi.calculation_key === "schedule_signal") {
    return {
      kind: "not_eligible",
      reason:
        "schedule_signal is excluded from automatic snapshot capture.",
    };
  }
  if (!kpi.cadence || kpi.cadence === "manual_only") {
    return {
      kind: "not_eligible",
      reason:
        "manual_only cadence is excluded — automatic capture needs a recurring period.",
    };
  }
  if (!SUPPORTED_CADENCES.has(kpi.cadence)) {
    return {
      kind: "not_eligible",
      reason: `Unsupported cadence: ${kpi.cadence}.`,
    };
  }
  // Eligible — read flag from KPI definition.
  // `auto_snapshot_enabled` was added in C3.2; default false.
  const enabled = (kpi as KpiDef & { auto_snapshot_enabled?: boolean })
    .auto_snapshot_enabled === true;
  if (enabled) {
    return {
      kind: "on",
      reason:
        "BTPM can create official snapshots for completed reporting periods.",
    };
  }
  return {
    kind: "off",
    reason:
      "This KPI can be captured automatically, but automatic capture is not enabled.",
  };
}

const VARIANT_BY_KIND = {
  not_applicable: "secondary",
  not_eligible: "outline",
  off: "outline",
  on: "default",
} as const;

const LABEL_BY_KIND = {
  not_applicable: "Not applicable",
  not_eligible: "Not eligible",
  off: "Off",
  on: "On",
} as const;

export function AutoSnapshotCaptureStatus({
  kpi,
  compact = false,
}: {
  kpi: KpiDef;
  compact?: boolean;
}) {
  const state = evaluateAutoSnapshotCaptureState(kpi);
  const label = LABEL_BY_KIND[state.kind];
  const variant = VARIANT_BY_KIND[state.kind];
  const tooltip = `Automatic snapshot capture: ${label} — ${state.reason}`;
  if (compact) {
    return (
      <Badge variant={variant} className="text-[10px] py-0 h-5" title={tooltip}>
        Auto-capture: {label}
      </Badge>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-2 text-xs text-muted-foreground"
      title={tooltip}
    >
      <Badge variant={variant} className="text-[10px] py-0 h-5">
        Auto-capture: {label}
      </Badge>
      <span className="truncate">{state.reason}</span>
    </span>
  );
}
