/**
 * Roadmap Status Pack — KPI data hook (Phase 6A.9, corrected in 6A.9a, 6A.17).
 *
 * Reads project-level KPI definitions, their recent update history, AND the
 * canonical official KPI snapshots through existing RLS-protected paths.
 *
 * Step 6A.17 correction:
 *  - The Status Pack previously only consumed `kpi_definitions.current_value`
 *    and `kpi_updates`. Project KPIs that have an official automatic snapshot
 *    (e.g. a calculated 100% for a completed project) but no manual update
 *    history rendered as "blank Current" / "No history" / red attention.
 *  - The project KPI surface uses the same `list_decrypted_kpi_snapshots`
 *    SECURITY DEFINER RPC + `evaluateKpiReadiness` precedence: official
 *    snapshot is treated as a canonical latest KPI reading.
 *  - This hook now fans out the same RPC per scoped project and exposes the
 *    raw snapshots keyed by KPI definition id. Derivation picks the most
 *    recent value across snapshot and manual update streams.
 *
 * Authorization paths used (unchanged):
 *  - `kpi_definitions` (policy `kpi_def_select_scoped`):
 *      gated by `can_read_project_by_target(auth.uid(), target_type, target_id)`.
 *  - `kpi_updates` (policy `kpi_upd_select_scoped`):
 *      gated by `has_project_access_by_kpi_def(auth.uid(), kpi_definition_id)`.
 *  - `list_decrypted_kpi_snapshots(_project_id)` (SECURITY DEFINER):
 *      strict `can_read_project(auth.uid(), _project_id)` check; same RPC used
 *      by the project KPI detail surface (`useKpiSnapshots`).
 *
 * Scope:
 *  - Only `target_type = 'project'` KPI definitions are read at Roadmap scope.
 *  - The update-history fetch is hard-capped by `KPI_UPDATE_PREVIEW_LIMIT`.
 *  - Snapshot reads are per-project (no cap), matching the project KPI surface
 *    behaviour. Per-project failures surface via `snapshotsPartial`.
 *
 * NO new RPCs, NO new Edge Functions, NO schema. Read-only.
 */

/**
 * Hard cap on the number of KPI update rows fetched for the Roadmap
 * Status Pack preview. Reaching this cap implies the preview is showing
 * a bounded slice of update history, not the full series, and must
 * surface a coverage note.
 */
export const KPI_UPDATE_PREVIEW_LIMIT = 2000;
import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface RoadmapStatusPackKpiDefinitionRow {
  id: string;
  name: string;
  /** 6B.6a — Plain-text KPI description (kpi_definitions.description). */
  description: string | null;
  unit: string | null;
  target_value: number | null;
  target_direction: string | null;
  current_value: number | null;
  target_type: string;
  target_id: string;
  workspace_id: string;
  updated_at: string;
}

export interface RoadmapStatusPackKpiUpdateRow {
  kpi_definition_id: string;
  value: number;
  update_date: string;
  author_id: string | null;
  created_at: string;
}

/**
 * Subset of `list_decrypted_kpi_snapshots` rows used by Status Pack KPI
 * derivation. Kept narrow on purpose — narrative fields are not surfaced
 * here, only what the latest-value precedence and freshness need.
 *
 * 6A.17a: `calculation_status` is exposed so the deriver can evaluate
 * reportability AFTER selecting the latest snapshot, matching the project
 * KPI surface (`evaluateKpiReadiness`). Pre-filtering by reportability in
 * the hook would silently bypass a non-reportable latest snapshot with an
 * older reportable one — which the project KPI surface never does.
 */
export interface RoadmapStatusPackKpiSnapshotRow {
  id: string;
  kpi_definition_id: string;
  project_id: string;
  snapshot_date: string;
  value_amount: number | null;
  value_type: string;
  source_mode: string;
  calculation_status: string;
  generated_by: string;
  created_at: string;
}

export interface UseRoadmapStatusPackKpisResult {
  definitions: readonly RoadmapStatusPackKpiDefinitionRow[];
  /** Up to two most-recent updates per definition (latest first). */
  recentUpdatesByDefinitionId: ReadonlyMap<
    string,
    readonly RoadmapStatusPackKpiUpdateRow[]
  >;
  /**
   * Up to two most-recent OFFICIAL snapshots per definition (latest first),
   * ordered by `snapshot_date DESC, created_at DESC`. NOT pre-filtered by
   * reportability — the deriver evaluates the latest snapshot's
   * `calculation_status` / `value_amount` itself, mirroring the project
   * KPI surface (`evaluateKpiReadiness`).
   */
  recentSnapshotsByDefinitionId: ReadonlyMap<
    string,
    readonly RoadmapStatusPackKpiSnapshotRow[]
  >;
  isLoading: boolean;
  isError: boolean;
  /**
   * True when EITHER update history OR snapshot reads may be incomplete:
   * an upstream query errored, hit the bounded cap, or at least one of the
   * per-project snapshot fan-out calls failed.
   */
  updatesPartial: boolean;
  /** True when the update-history fetch itself errored. */
  updatesErrored: boolean;
  /** True when the update-history fetch returned exactly the preview cap. */
  updatesLimitReached: boolean;
  /** True when at least one per-project snapshot RPC failed. */
  snapshotsPartial: boolean;
  isEmptyScope: boolean;
}


/**
 * Fetch project-level KPI definitions touching the scoped Roadmap project
 * set, plus their RLS-visible recent update rows, plus the canonical
 * official snapshots via the same SECURITY DEFINER RPC used by the project
 * KPI detail surface.
 */
export function useRoadmapStatusPackKpis(
  scopedProjectIds: readonly string[],
): UseRoadmapStatusPackKpisResult {
  const stableProjectIds = useMemo(
    () => Array.from(new Set(scopedProjectIds)).sort(),
    [scopedProjectIds],
  );

  const definitionsQuery = useQuery({
    queryKey: ["roadmap-status-pack-kpis-defs", stableProjectIds],
    enabled: stableProjectIds.length > 0,
    queryFn: async () => {
      if (stableProjectIds.length === 0) return [];
      const { data, error } = await supabase
        .from("kpi_definitions")
        .select(
          "id, name, description, unit, target_value, target_direction, current_value, target_type, target_id, workspace_id, updated_at",
        )
        .eq("target_type", "project")
        .in("target_id", stableProjectIds)
        .eq("is_archived", false);
      if (error) throw error;
      return (data || []) as RoadmapStatusPackKpiDefinitionRow[];
    },
  });

  const definitionIds = useMemo(
    () =>
      Array.from(new Set((definitionsQuery.data ?? []).map((d) => d.id))).sort(),
    [definitionsQuery.data],
  );

  const updatesQuery = useQuery({
    queryKey: ["roadmap-status-pack-kpis-updates", definitionIds],
    enabled: definitionIds.length > 0,
    queryFn: async () => {
      if (definitionIds.length === 0) return [];
      const { data, error } = await supabase
        .from("kpi_updates")
        .select("kpi_definition_id, value, update_date, author_id, created_at")
        .in("kpi_definition_id", definitionIds)
        .order("update_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(KPI_UPDATE_PREVIEW_LIMIT);
      if (error) throw error;
      return (data || []) as RoadmapStatusPackKpiUpdateRow[];
    },
  });

  // Step 6A.17 — Snapshot fan-out. Same SECURITY DEFINER RPC used by the
  // project KPI detail surface (`useKpiSnapshots`). One call per scoped
  // project so authorization is enforced exactly as in that surface.
  const snapshotQueries = useQueries({
    queries: stableProjectIds.map((pid) => ({
      queryKey: ["roadmap-status-pack-kpi-snapshots", pid],
      enabled: !!pid,
      staleTime: 30_000,
      queryFn: async (): Promise<RoadmapStatusPackKpiSnapshotRow[]> => {
        const { data, error } = await supabase.rpc(
          "list_decrypted_kpi_snapshots",
          { _project_id: pid, _kpi_definition_id: null },
        );
        if (error) throw error;
        const rows = (data as any[]) ?? [];
        return rows.map((r) => ({
          id: r.id,
          kpi_definition_id: r.kpi_definition_id,
          project_id: r.project_id,
          snapshot_date: r.snapshot_date,
          value_amount:
            typeof r.value_amount === "number" ? r.value_amount : null,
          value_type: r.value_type,
          source_mode: r.source_mode,
          calculation_status: r.calculation_status,
          generated_by: r.generated_by,
          created_at: r.created_at,
        }));
      },
    })),
  });

  const recentUpdatesByDefinitionId = useMemo(() => {
    const map = new Map<string, RoadmapStatusPackKpiUpdateRow[]>();
    for (const row of updatesQuery.data ?? []) {
      const bucket = map.get(row.kpi_definition_id);
      if (!bucket) {
        map.set(row.kpi_definition_id, [row]);
      } else if (bucket.length < 2) {
        bucket.push(row);
      }
    }
    return map as ReadonlyMap<string, readonly RoadmapStatusPackKpiUpdateRow[]>;
  }, [updatesQuery.data]);

  const snapshotsAggregate = useMemo(() => {
    // 6A.17a — flatten + sort by latest-official ordering, then bucket the
    // two most recent per KPI. Do NOT pre-filter by reportability or
    // missing value: the deriver evaluates the latest snapshot itself,
    // matching the project KPI surface (`evaluateKpiReadiness`).
    const all: RoadmapStatusPackKpiSnapshotRow[] = [];
    let anyFailed = false;
    let anyLoading = false;
    snapshotQueries.forEach((q) => {
      if (q.isError) anyFailed = true;
      if (q.isLoading) anyLoading = true;
      if (q.data) {
        for (const row of q.data) {
          all.push(row);
        }
      }
    });
    all.sort((a, b) => {
      if (a.snapshot_date !== b.snapshot_date) {
        return a.snapshot_date > b.snapshot_date ? -1 : 1;
      }
      if (a.created_at !== b.created_at) {
        return a.created_at > b.created_at ? -1 : 1;
      }
      return 0;
    });
    const byDef = new Map<string, RoadmapStatusPackKpiSnapshotRow[]>();
    for (const row of all) {
      const bucket = byDef.get(row.kpi_definition_id);
      if (!bucket) {
        byDef.set(row.kpi_definition_id, [row]);
      } else if (bucket.length < 2) {
        bucket.push(row);
      }
    }
    return { byDef, anyFailed, anyLoading };
  }, [snapshotQueries]);


  const definitionsLoading =
    stableProjectIds.length > 0 && definitionsQuery.isLoading;
  const updatesLoading = definitionIds.length > 0 && updatesQuery.isLoading;
  // 6A.17a — Snapshots loading must stay TRUE while ANY per-project RPC is
  // still in flight, not just until the first one resolves. Otherwise the
  // KPI section can render mid fan-out with values from only some projects
  // in scope, silently looking complete. Partial *failures* still surface
  // via `snapshotsPartial`; this gate is strictly about in-flight loading.
  const snapshotsLoadingGate =
    stableProjectIds.length > 0 && snapshotsAggregate.anyLoading;


  const isLoading =
    definitionsLoading || updatesLoading || snapshotsLoadingGate;

  const updatesErrored = updatesQuery.isError;
  const updatesLimitReached =
    !updatesErrored &&
    Array.isArray(updatesQuery.data) &&
    updatesQuery.data.length >= KPI_UPDATE_PREVIEW_LIMIT;
  const snapshotsPartial = snapshotsAggregate.anyFailed;

  return {
    definitions: (definitionsQuery.data ?? []) as readonly RoadmapStatusPackKpiDefinitionRow[],
    recentUpdatesByDefinitionId,
    recentSnapshotsByDefinitionId: snapshotsAggregate.byDef as ReadonlyMap<
      string,
      readonly RoadmapStatusPackKpiSnapshotRow[]
    >,
    isLoading,
    isError: definitionsQuery.isError,
    updatesPartial: Boolean(
      updatesErrored || updatesLimitReached || snapshotsPartial,
    ),
    updatesErrored,
    updatesLimitReached,
    snapshotsPartial,
    isEmptyScope: stableProjectIds.length === 0,
  };
}
