// BTPM — Wave C2, Step C2.8
// Read-only project-level KPI App linkage hook.
//
// Hard rules:
//   - Reads only kpi_app_mappings, kpi_app_external_kpis, and (best-effort)
//     non-sensitive kpi_app_submission_outbox metadata.
//   - Writes nothing. Calls no Edge Functions. Reads no MuleSoft secrets.
//   - Outbox RLS failure (e.g. non-admin project user) is swallowed and
//     surfaced as `outboxAccessible = false` so the page still renders.
//   - Never reads or returns: source_string_value, source_comment,
//     source_action_plan, last_upstream_body_summary, last_error_message,
//     attempt rows, full payloads, or any decrypted column.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type MappingRow = Database["public"]["Tables"]["kpi_app_mappings"]["Row"];

export interface ProjectLinkageOutbox {
  status: string;
  reporting_period_start: string;
  reporting_period_end: string;
  submitted_at: string | null;
  last_attempt_at: string | null;
  payload_row_count: number | null;
  carry_forward_used: boolean;
  last_http_status: number | null;
}

export interface ProjectKpiLinkage {
  mapping: MappingRow;
  external_kpi_name: string | null;
  external_value_type: string | null;
  latest_outbox: ProjectLinkageOutbox | null;
}

export interface ProjectKpiLinkageResult {
  /** Map of kpi_definition_id -> linkage. Missing entry = not mapped. */
  byKpiId: Map<string, ProjectKpiLinkage>;
  /** False if outbox RLS denied the read (non-admin project user). */
  outboxAccessible: boolean;
}

const EMPTY: ProjectKpiLinkageResult = {
  byKpiId: new Map(),
  outboxAccessible: false,
};

export function useProjectKpiAppLinkage(
  projectId: string | null | undefined,
  organizationId: string | null | undefined,
  /**
   * Whether the current user is authorized to read outbox metadata
   * (org admin OR workspace admin-or-higher). Computed by
   * `useCanReadKpiAppOutboxMetadata` and passed in explicitly so we do
   * NOT silently misinterpret RLS-filtered zero-row reads as
   * "no submissions yet".
   */
  canReadOutboxMetadata: boolean,
) {
  return useQuery({
    queryKey: [
      "project-kpi-app-linkage",
      projectId,
      organizationId,
      canReadOutboxMetadata,
    ],
    enabled: !!projectId && !!organizationId,
    queryFn: async (): Promise<ProjectKpiLinkageResult> => {
      // 1) Mappings for this project (RLS: workspace member or org admin)
      const { data: mappings, error: mErr } = await supabase
        .from("kpi_app_mappings")
        .select("*")
        .eq("project_id", projectId!)
        .eq("organization_id", organizationId!);
      if (mErr) {
        // Mapping read denied — treat as "no visible mappings" rather than failing the page.
        return EMPTY;
      }
      const rows = mappings ?? [];
      if (rows.length === 0) {
        return { byKpiId: new Map(), outboxAccessible: canReadOutboxMetadata };
      }

      const externalIds = Array.from(new Set(rows.map((r) => r.external_kpi_id)));
      const mappingIds = rows.map((r) => r.id);

      // 2) External catalog labels (RLS: org member SELECT) — required for display
      const { data: catalog } = await supabase
        .from("kpi_app_external_kpis")
        .select("external_kpi_id, external_kpi_name, value_type")
        .eq("organization_id", organizationId!)
        .in("external_kpi_id", externalIds);

      const catalogMap = new Map(
        (catalog ?? []).map((c) => [c.external_kpi_id, c]),
      );

      // 3) Latest non-sensitive outbox metadata (RLS: admin-read only by C2.4).
      //    C2.8a: do NOT query outbox at all when caller is not authorized to
      //    read it. Inferring access from a zero-row SELECT is unsafe because
      //    Postgres/Supabase RLS filters denied rows silently — that path
      //    would mislead non-admin users with "no submissions yet".
      let outboxAccessible = canReadOutboxMetadata;
      const latestByMapping = new Map<string, ProjectLinkageOutbox>();
      if (canReadOutboxMetadata) {
        try {
          const { data: outbox, error: oErr } = await supabase
            .from("kpi_app_submission_outbox")
            .select(
              "mapping_id, status, reporting_period_start, reporting_period_end, submitted_at, last_attempt_at, payload_row_count, carry_forward_used, last_http_status, updated_at",
            )
            .in("mapping_id", mappingIds)
            .order("updated_at", { ascending: false });
          if (oErr) {
            // Authorization said yes but query errored — fail closed: keep
            // mapping visibility but mark outbox as not accessible so the UI
            // does not show a misleading "no submissions yet".
            outboxAccessible = false;
          } else {
            for (const o of outbox ?? []) {
              if (!latestByMapping.has(o.mapping_id)) {
                latestByMapping.set(o.mapping_id, {
                  status: o.status,
                  reporting_period_start: o.reporting_period_start,
                  reporting_period_end: o.reporting_period_end,
                  submitted_at: o.submitted_at,
                  last_attempt_at: o.last_attempt_at,
                  payload_row_count: o.payload_row_count,
                  carry_forward_used: o.carry_forward_used,
                  last_http_status: o.last_http_status,
                });
              }
            }
          }
        } catch {
          outboxAccessible = false;
        }
      }

      const byKpiId = new Map<string, ProjectKpiLinkage>();
      for (const r of rows) {
        const ext = catalogMap.get(r.external_kpi_id);
        byKpiId.set(r.kpi_definition_id, {
          mapping: r,
          external_kpi_name: ext?.external_kpi_name ?? null,
          external_value_type: ext?.value_type ?? null,
          latest_outbox: latestByMapping.get(r.id) ?? null,
        });
      }

      return { byKpiId, outboxAccessible };
    },
  });
}
