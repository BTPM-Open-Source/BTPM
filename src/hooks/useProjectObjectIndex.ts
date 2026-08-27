/**
 * Wave B.5+ — Project object-name index for the Traceability Sheet.
 *
 * Resolves names for every object that may appear inside a project's
 * activity_events stream so the Sheet can render meaningful rows like
 * `Task "SVS – Validate scope"` instead of a bare `Task` chip.
 *
 * Read-only. Sourced from the same decrypted RPCs the Planning surface
 * already uses — no new decryption surface, no new write path.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type ObjectIndexEntry = {
  type:
    | "project"
    | "phase"
    | "task"
    | "blocker"
    | "risk"
    | "kpi_definition"
    | "governance_cadence"
    | "governance_record";
  id: string;
  name: string;
};

export type ProjectObjectIndex = {
  byId: Record<string, ObjectIndexEntry>;
  /** Optional convenience: resolve `<type>:<id>` if you ever key that way. */
  resolve: (type: string, id: string | null | undefined) => string | null;
};

const EMPTY_INDEX: ProjectObjectIndex = {
  byId: {},
  resolve: () => null,
};

export function useProjectObjectIndex(
  projectId: string | undefined,
  projectName: string | undefined,
  enabled = true,
) {
  return useQuery<ProjectObjectIndex>({
    queryKey: ["project-object-index", projectId],
    queryFn: async () => {
      if (!projectId) return EMPTY_INDEX;

      const [phasesRes, tasksRes] = await Promise.all([
        supabase.rpc("list_decrypted_project_phases", { _project_id: projectId }),
        supabase.rpc("list_decrypted_project_tasks", { _project_id: projectId }),
      ]);
      if (phasesRes.error) throw phasesRes.error;
      if (tasksRes.error) throw tasksRes.error;

      const phases = (phasesRes.data as any[]) || [];
      const tasks = (tasksRes.data as any[]) || [];
      const phaseIds = phases.map((p) => p.id);
      const taskIds = tasks.map((t) => t.id);
      const allTargetTuples: Array<["project" | "phase" | "task", string]> = [
        ["project", projectId],
        ...phaseIds.map((id): ["phase", string] => ["phase", id]),
        ...taskIds.map((id): ["task", string] => ["task", id]),
      ];

      // Fetch derived objects (blockers / risks / KPIs) in one batch per type.
      // Governance cadences/records are project-scoped, fetched directly.
      const [blockersRes, risksRes, kpisRes, cadencesRes, gRecordsRes] = await Promise.all([
        supabase
          .from("blockers")
          .select("id, title, target_type, target_id")
          .or(buildAnchorFilter(allTargetTuples)),
        supabase
          .from("risks")
          .select("id, title, target_type, target_id")
          .or(buildAnchorFilter(allTargetTuples)),
        supabase
          .from("kpi_definitions")
          .select("id, name, target_type, target_id")
          .or(buildAnchorFilter(allTargetTuples)),
        supabase.rpc("list_project_governance_cadences", {
          _project_id: projectId,
          _include_archived: true,
        }),
        supabase.rpc("list_project_governance_records", {
          _project_id: projectId,
          _include_archived: true,
        }),
      ]);

      const blockers = (blockersRes.data as any[]) || [];
      const risks = (risksRes.data as any[]) || [];
      const kpis = (kpisRes.data as any[]) || [];
      const cadences = (cadencesRes.data as any[]) || [];
      const gRecords = (gRecordsRes.data as any[]) || [];

      const byId: Record<string, ObjectIndexEntry> = {};
      byId[projectId] = { type: "project", id: projectId, name: projectName ?? "Project" };
      for (const p of phases) byId[p.id] = { type: "phase", id: p.id, name: p.name ?? "Phase" };
      for (const t of tasks) byId[t.id] = { type: "task", id: t.id, name: t.name ?? "Task" };
      for (const b of blockers)
        byId[b.id] = { type: "blocker", id: b.id, name: b.title ?? "Blocker" };
      for (const r of risks) byId[r.id] = { type: "risk", id: r.id, name: r.title ?? "Risk" };
      for (const k of kpis)
        byId[k.id] = { type: "kpi_definition", id: k.id, name: k.name ?? "KPI" };
      for (const c of cadences) {
        const label = (c.event_name && String(c.event_name).trim())
          ? c.event_name
          : String(c.event_type ?? "Cadence").replace(/_/g, " ");
        byId[c.id] = { type: "governance_cadence", id: c.id, name: label };
      }
      for (const g of gRecords) {
        const base = (g.event_name && String(g.event_name).trim())
          ? g.event_name
          : String(g.event_type ?? "Record").replace(/_/g, " ");
        const datePart = g.actual_date_held ? ` (${g.actual_date_held})` : "";
        byId[g.id] = { type: "governance_record", id: g.id, name: `${base}${datePart}` };
      }

      return {
        byId,
        resolve: (_type: string, id: string | null | undefined) =>
          (id && byId[id]?.name) || null,
      };
    },
    enabled: !!projectId && enabled,
    staleTime: 30_000,
  });
}

/**
 * Build a PostgREST `or()` filter that matches rows whose
 * (target_type, target_id) is in the supplied list.
 *
 * Encodes each tuple as `and(target_type.eq.<t>,target_id.eq.<id>)`.
 */
function buildAnchorFilter(tuples: Array<[string, string]>): string {
  if (tuples.length === 0) return "id.eq.00000000-0000-0000-0000-000000000000";
  return tuples
    .map(([t, id]) => `and(target_type.eq.${t},target_id.eq.${id})`)
    .join(",");
}
