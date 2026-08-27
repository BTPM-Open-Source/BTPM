// BTPM — Wave C2, Step C2.12a
// Frontend hooks for the Submission Monitor surface and the
// stale-submitting reconciliation action.
//
// Hard rules:
//   - Read-only outbox/attempt access only — never decrypted comments,
//     action plans, string values, upstream body, or error message.
//   - Workspace-scoped queries — RLS gates further by admin authority.
//   - Reconciliation goes through the protected Edge Function only.
//   - No MuleSoft credentials, no service-role key, no direct attempt writes.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type OutboxMonitorRow = {
  id: string;
  organization_id: string;
  workspace_id: string;
  project_id: string;
  mapping_id: string;
  kpi_definition_id: string;
  reporting_period_start: string;
  reporting_period_end: string;
  validity_date: string;
  submission_mode: string;
  status: string;
  carry_forward_used: boolean;
  payload_row_count: number | null;
  retry_count: number;
  last_attempt_at: string | null;
  submitted_at: string | null;
  last_http_status: number | null;
  created_at: string;
  updated_at: string;
  // Joined display labels (non-sensitive metadata only).
  project_name: string | null;
  kpi_name: string | null;
  external_kpi_id: number | null;
  external_kpi_name: string | null;
};

export type AttemptAuditRow = {
  id: string;
  outbox_id: string;
  attempt_number: number;
  attempted_at: string;
  status: string;
  elapsed_ms: number | null;
  http_status: number | null;
  upstream_status_text: string | null;
  payload_row_count: number | null;
  request_id: string | null;
  external_correlation_id: string | null;
};

const STALE_AFTER_MS = 30 * 60 * 1000;

export function isStaleSubmitting(row: Pick<OutboxMonitorRow, "status" | "last_attempt_at" | "updated_at">): boolean {
  if (row.status !== "submitting") return false;
  const ref = row.last_attempt_at ?? row.updated_at;
  if (!ref) return false;
  const t = new Date(ref).getTime();
  if (!Number.isFinite(t)) return false;
  return Date.now() - t >= STALE_AFTER_MS;
}

export function useKpiAppOutboxMonitor(
  organizationId: string | null | undefined,
  workspaceId: string | null | undefined,
) {
  return useQuery({
    queryKey: ["kpi-app-outbox-monitor", organizationId, workspaceId],
    enabled: !!organizationId && !!workspaceId,
    queryFn: async (): Promise<OutboxMonitorRow[]> => {
      // Non-sensitive fields only. RLS restricts visibility to org admins
      // and workspace admins-or-higher.
      const { data, error } = await supabase
        .from("kpi_app_submission_outbox")
        .select(
          [
            "id",
            "organization_id",
            "workspace_id",
            "project_id",
            "mapping_id",
            "kpi_definition_id",
            "reporting_period_start",
            "reporting_period_end",
            "validity_date",
            "submission_mode",
            "status",
            "carry_forward_used",
            "payload_row_count",
            "retry_count",
            "last_attempt_at",
            "submitted_at",
            "last_http_status",
            "created_at",
            "updated_at",
          ].join(", "),
        )
        .eq("organization_id", organizationId!)
        .eq("workspace_id", workspaceId!)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      const rows = (data ?? []) as unknown as OutboxMonitorRow[];

      // Join non-sensitive display labels in batches.
      const projectIds = Array.from(new Set(rows.map((r) => r.project_id)));
      const kpiIds = Array.from(new Set(rows.map((r) => r.kpi_definition_id)));
      const mappingIds = Array.from(new Set(rows.map((r) => r.mapping_id)));

      const [projectsRes, kpisRes, mappingsRes] = await Promise.all([
        projectIds.length
          ? supabase.from("projects").select("id, name").in("id", projectIds)
          : Promise.resolve({ data: [], error: null } as const),
        kpiIds.length
          ? supabase.from("kpi_definitions").select("id, name").in("id", kpiIds)
          : Promise.resolve({ data: [], error: null } as const),
        mappingIds.length
          ? supabase
              .from("kpi_app_mappings")
              .select("id, external_kpi_id")
              .in("id", mappingIds)
          : Promise.resolve({ data: [], error: null } as const),
      ]);

      const projectName = new Map<string, string>();
      ((projectsRes.data ?? []) as Array<{ id: string; name: string }>).forEach((p) =>
        projectName.set(p.id, p.name),
      );
      const kpiName = new Map<string, string>();
      ((kpisRes.data ?? []) as Array<{ id: string; name: string }>).forEach((k) =>
        kpiName.set(k.id, k.name),
      );
      const mappingExt = new Map<string, number>();
      ((mappingsRes.data ?? []) as Array<{ id: string; external_kpi_id: number }>).forEach(
        (m) => mappingExt.set(m.id, m.external_kpi_id),
      );

      // External KPI catalog labels (org-level reference data).
      const extIds = Array.from(new Set(Array.from(mappingExt.values())));
      const extNameById = new Map<number, string>();
      if (extIds.length && organizationId) {
        const { data: extData } = await supabase
          .from("kpi_app_external_kpis")
          .select("external_kpi_id, external_kpi_name")
          .eq("organization_id", organizationId)
          .in("external_kpi_id", extIds);
        ((extData ?? []) as Array<{ external_kpi_id: number; external_kpi_name: string }>).forEach(
          (e) => extNameById.set(e.external_kpi_id, e.external_kpi_name),
        );
      }

      return rows.map((r) => {
        const ext = mappingExt.get(r.mapping_id) ?? null;
        return {
          ...r,
          project_name: projectName.get(r.project_id) ?? null,
          kpi_name: kpiName.get(r.kpi_definition_id) ?? null,
          external_kpi_id: ext,
          external_kpi_name: ext != null ? (extNameById.get(ext) ?? null) : null,
        } satisfies OutboxMonitorRow;
      });
    },
  });
}

export function useKpiAppAttemptAudit(outboxId: string | null) {
  return useQuery({
    queryKey: ["kpi-app-attempt-audit", outboxId],
    enabled: !!outboxId,
    queryFn: async (): Promise<AttemptAuditRow[]> => {
      const { data, error } = await supabase
        .from("kpi_app_submission_attempts")
        .select(
          [
            "id",
            "outbox_id",
            "attempt_number",
            "attempted_at",
            "status",
            "elapsed_ms",
            "http_status",
            "upstream_status_text",
            "payload_row_count",
            "request_id",
            "external_correlation_id",
          ].join(", "),
        )
        .eq("outbox_id", outboxId!)
        .order("attempt_number", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as AttemptAuditRow[];
    },
  });
}

export type ReconcileAction = "mark_retry_pending" | "mark_failed";

export type ReconcileResult = {
  ok: boolean;
  request_id?: string;
  outbox_id?: string;
  action?: ReconcileAction;
  status?: string;
  error?: string;
};

export function useReconcileKpiAppSubmission(
  organizationId: string | null | undefined,
  workspaceId: string | null | undefined,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      outbox_id: string;
      action: ReconcileAction;
    }): Promise<ReconcileResult> => {
      const { data, error } = await supabase.functions.invoke(
        "reconcile-kpi-app-submission",
        { body: { outbox_id: vars.outbox_id, action: vars.action } },
      );
      if (error) {
        const payload = (data ?? {}) as Record<string, unknown>;
        const message =
          (payload.error as string | undefined) ||
          error.message ||
          "Reconciliation request failed";
        return { ...(payload as object), ok: false, error: message } as ReconcileResult;
      }
      return data as ReconcileResult;
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["kpi-app-outbox-monitor", organizationId, workspaceId],
      });
      qc.invalidateQueries({ queryKey: ["kpi-app-mappings", organizationId, workspaceId] });
    },
  });
}
