// BTPM — Wave C2, Step C2.7
// Read/write hooks for the Admin KPI App Integration UX.
//
// Hard rules:
//   - Reads only kpi_app_external_kpis, kpi_app_mappings, kpi_definitions,
//     projects, and (read-only) latest kpi_app_submission_outbox metadata.
//   - Writes only to kpi_app_mappings (insert / update). Never to outbox,
//     never to attempts, never to kpi_snapshots / kpi_updates / kpi_definitions
//     / kpi_app_external_kpis.
//   - Never invokes build-kpi-app-payload or submit-kpi-app-payload.
//   - Never reads MuleSoft secrets / env vars.
//   - Backend RLS + C2.3 validation trigger remain authoritative.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type ExternalKpi = Database["public"]["Tables"]["kpi_app_external_kpis"]["Row"];
type MappingRow = Database["public"]["Tables"]["kpi_app_mappings"]["Row"];
type MappingInsert = Database["public"]["Tables"]["kpi_app_mappings"]["Insert"];
type MappingUpdate = Database["public"]["Tables"]["kpi_app_mappings"]["Update"];

export type KpiAppExternalKpi = ExternalKpi;
export type KpiAppMapping = MappingRow;

export interface MappingWithJoin extends MappingRow {
  project_name: string | null;
  kpi_name: string | null;
  kpi_value_type: string | null;
  kpi_calculation_key: string | null;
  external_kpi_name: string | null;
  external_value_type: string | null;
  latest_outbox?: LatestOutboxState | null;
}

export interface LatestOutboxState {
  id: string;
  status: string;
  reporting_period_start: string;
  reporting_period_end: string;
  validity_date: string;
  submitted_at: string | null;
  last_attempt_at: string | null;
  payload_row_count: number | null;
  carry_forward_used: boolean;
  last_http_status: number | null;
  updated_at: string;
  /** C2-FIX.1: when set, the row has been superseded via reset and no longer blocks. */
  superseded_at: string | null;
}

export interface ProjectKpiOption {
  id: string;
  name: string;
  value_type: string;
  calculation_key: string | null;
  is_archived: boolean;
}

export interface ProjectOption {
  id: string;
  name: string;
  workspace_id: string;
  organization_id: string;
}

// -----------------------------------------------------------------------------
// External KPI catalog (read-only)
// -----------------------------------------------------------------------------

export function useKpiAppExternalCatalog(organizationId: string | null | undefined) {
  return useQuery({
    queryKey: ["kpi-app-external-catalog", organizationId],
    enabled: !!organizationId,
    queryFn: async (): Promise<ExternalKpi[]> => {
      const { data, error } = await supabase
        .from("kpi_app_external_kpis")
        .select("*")
        .eq("organization_id", organizationId!)
        .order("external_kpi_id", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

// -----------------------------------------------------------------------------
// Workspaces visible to the org admin (for the workspace scope selector).
// -----------------------------------------------------------------------------

export interface AdminWorkspaceOption {
  id: string;
  name: string;
}

export function useAdminKpiAppWorkspaces(organizationId: string | null | undefined) {
  return useQuery({
    queryKey: ["kpi-app-admin-workspaces", organizationId],
    enabled: !!organizationId,
    queryFn: async (): Promise<AdminWorkspaceOption[]> => {
      const { data, error } = await supabase
        .from("workspaces")
        .select("id, name")
        .eq("organization_id", organizationId!)
        .eq("is_active", true)
        .eq("is_archived", false)
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as AdminWorkspaceOption[];
    },
  });
}

// -----------------------------------------------------------------------------
// Mappings list (admin-scoped via RLS, filtered by selected workspace)
// -----------------------------------------------------------------------------

export function useKpiAppMappings(
  organizationId: string | null | undefined,
  workspaceId: string | null | undefined,
) {
  return useQuery({
    queryKey: ["kpi-app-mappings", organizationId, workspaceId],
    enabled: !!organizationId && !!workspaceId,
    queryFn: async (): Promise<MappingWithJoin[]> => {
      const { data: mappings, error } = await supabase
        .from("kpi_app_mappings")
        .select("*")
        .eq("organization_id", organizationId!)
        .eq("workspace_id", workspaceId!)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      const rows = mappings ?? [];
      if (rows.length === 0) return [];

      const projectIds = Array.from(new Set(rows.map((r) => r.project_id)));
      const kpiIds = Array.from(new Set(rows.map((r) => r.kpi_definition_id)));
      const externalKeyPairs = rows.map((r) => r.external_kpi_id);

      const [{ data: projects }, { data: kpis }, { data: catalog }, { data: latestOutbox }] =
        await Promise.all([
          supabase.from("projects").select("id, name").in("id", projectIds),
          supabase
            .from("kpi_definitions")
            .select("id, name, value_type, calculation_key")
            .in("id", kpiIds),
          supabase
            .from("kpi_app_external_kpis")
            .select("external_kpi_id, external_kpi_name, value_type")
            .eq("organization_id", organizationId!)
            .in("external_kpi_id", externalKeyPairs),
          supabase
            .from("kpi_app_submission_outbox")
            .select(
              "id, mapping_id, status, reporting_period_start, reporting_period_end, validity_date, submitted_at, last_attempt_at, payload_row_count, carry_forward_used, last_http_status, updated_at, superseded_at",
            )
            .in("mapping_id", rows.map((r) => r.id))
            .order("updated_at", { ascending: false }),
        ]);

      const projectMap = new Map(projects?.map((p) => [p.id, p.name]) ?? []);
      const kpiMap = new Map(
        kpis?.map((k) => [
          k.id,
          { name: k.name, value_type: k.value_type, calculation_key: k.calculation_key },
        ]) ?? [],
      );
      const catalogMap = new Map(
        catalog?.map((c) => [c.external_kpi_id, c]) ?? [],
      );

      // Pick the most recent outbox row per mapping_id (already ordered desc).
      const latestByMapping = new Map<string, LatestOutboxState>();
      for (const row of latestOutbox ?? []) {
        if (!latestByMapping.has(row.mapping_id)) {
          latestByMapping.set(row.mapping_id, {
            id: row.id,
            status: row.status,
            reporting_period_start: row.reporting_period_start,
            reporting_period_end: row.reporting_period_end,
            validity_date: row.validity_date,
            submitted_at: row.submitted_at,
            last_attempt_at: row.last_attempt_at,
            payload_row_count: row.payload_row_count,
            carry_forward_used: row.carry_forward_used,
            last_http_status: row.last_http_status,
            updated_at: row.updated_at,
            superseded_at: (row as { superseded_at: string | null }).superseded_at ?? null,
          });
        }
      }

      return rows.map((r) => {
        const kpi = kpiMap.get(r.kpi_definition_id);
        const ext = catalogMap.get(r.external_kpi_id);
        return {
          ...r,
          project_name: projectMap.get(r.project_id) ?? null,
          kpi_name: kpi?.name ?? null,
          kpi_value_type: kpi?.value_type ?? null,
          kpi_calculation_key: kpi?.calculation_key ?? null,
          external_kpi_name: ext?.external_kpi_name ?? null,
          external_value_type: ext?.value_type ?? null,
          latest_outbox: latestByMapping.get(r.id) ?? null,
        };
      });
    },
  });
}

// -----------------------------------------------------------------------------
// Project + KPI options for the create/edit dialog
// -----------------------------------------------------------------------------

export function useAdminAccessibleProjects(
  organizationId: string | null | undefined,
  workspaceId: string | null | undefined,
) {
  return useQuery({
    queryKey: ["kpi-app-admin-projects", organizationId, workspaceId],
    enabled: !!organizationId && !!workspaceId,
    queryFn: async (): Promise<ProjectOption[]> => {
      const { data, error } = await supabase
        .from("projects")
        .select("id, name, workspace_id, organization_id, is_archived")
        .eq("organization_id", organizationId!)
        .eq("workspace_id", workspaceId!)
        .eq("is_archived", false)
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        workspace_id: p.workspace_id,
        organization_id: p.organization_id,
      }));
    },
  });
}

export function useProjectMappableKpis(projectId: string | null | undefined) {
  return useQuery({
    queryKey: ["kpi-app-project-kpis", projectId],
    enabled: !!projectId,
    queryFn: async (): Promise<ProjectKpiOption[]> => {
      const { data, error } = await supabase
        .from("kpi_definitions")
        .select("id, name, value_type, calculation_key, is_archived, target_type, target_id")
        .eq("target_type", "project")
        .eq("target_id", projectId!)
        .eq("is_archived", false)
        .order("name", { ascending: true });
      if (error) throw error;
      // schedule_signal is non-mappable by C2.1 / outbox validator — exclude in UI.
      return (data ?? [])
        .filter((k) => k.calculation_key !== "schedule_signal")
        .map((k) => ({
          id: k.id,
          name: k.name,
          value_type: k.value_type,
          calculation_key: k.calculation_key,
          is_archived: k.is_archived,
        }));
    },
  });
}

// Workspace members for the "configured user" selector.
//
// C3.10c — use the canonical decrypted ws_list_members RPC (same source as
// Admin → Users / workspace member listings). The previous direct query
// against workspace_memberships + profiles returned no rows in this
// environment because profile fields are encrypted and only the RPC
// decrypts them. We additionally filter to active members so we never
// configure an entered-by email belonging to a deactivated user.
export function useWorkspaceMembersForSelect(workspaceId: string | null | undefined) {
  return useQuery({
    queryKey: ["kpi-app-ws-members", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("ws_list_members", {
        _workspace_id: workspaceId!,
      });
      if (error) throw error;
      return (data ?? [])
        .filter((m: any) => m.is_active !== false)
        .map((m: any) => ({
          id: m.user_id as string,
          display_name:
            (m.display_name as string | null) ||
            (m.email as string | null) ||
            "Unnamed user",
        }))
        .sort((a, b) => a.display_name.localeCompare(b.display_name));
    },
  });
}

// -----------------------------------------------------------------------------
// Mutations: kpi_app_mappings only
// -----------------------------------------------------------------------------

export function useCreateKpiAppMapping(organizationId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: MappingInsert) => {
      const { data, error } = await supabase
        .from("kpi_app_mappings")
        .insert(input)
        .select("id")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kpi-app-mappings", organizationId] });
    },
  });
}

export function useUpdateKpiAppMapping(organizationId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { id: string; patch: MappingUpdate }) => {
      const { error } = await supabase
        .from("kpi_app_mappings")
        .update(params.patch)
        .eq("id", params.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kpi-app-mappings", organizationId] });
    },
  });
}

export function useToggleKpiAppMappingActive(organizationId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { id: string; is_active: boolean }) => {
      const { error } = await supabase
        .from("kpi_app_mappings")
        .update({ is_active: params.is_active })
        .eq("id", params.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kpi-app-mappings", organizationId] });
    },
  });
}
