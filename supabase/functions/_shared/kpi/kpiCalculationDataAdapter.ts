/**
 * BTPM — Wave C1, Step C1.6 (refactored in C1.6a)
 * Supabase-row → KpiCalculationInput adapter.
 *
 * Pure mapping. NO formula logic lives here — that stays in
 * src/lib/kpi/kpiCalculationEngine.ts.
 *
 * C1.6a refactor:
 *   - The adapter no longer imports the browser Supabase client. Instead it
 *     accepts a minimal `SupabaseLikeClient` so it can run from BOTH the
 *     Vite/TS app and a Supabase Edge Function (Deno) using the same source
 *     mapping. This unblocks the server-authoritative capture path.
 *   - Imports are relative `.ts` paths so Deno can resolve them.
 */

import type {
  KpiCalculationInput,
  KpiBlockerInput,
  KpiExecutionUpdateInput,
  KpiPhaseInput,
  KpiProjectInput,
  KpiRiskInput,
  KpiTaskInput,
} from "./kpiCalculationTypes.ts";

interface FetchOptions {
  /** ISO snapshot date the calculation will be anchored to. */
  snapshotDate: string;
}

/**
 * Minimal subset of @supabase/supabase-js we rely on. Both the browser
 * client and an Edge Function service-role client satisfy this shape.
 */
export interface SupabaseLikeClient {
  from(table: string): {
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): {
        // chainable for filter+single
        eq?: (c: string, v: string) => any;
        maybeSingle?: () => Promise<{ data: any; error: any }>;
        then?: any;
      } & PromiseLike<{ data: any; error: any }>;
    } & PromiseLike<{ data: any; error: any }>;
  };
}

export async function buildKpiCalculationInput(
  client: SupabaseLikeClient,
  projectId: string,
  options: FetchOptions,
): Promise<KpiCalculationInput> {
  const c = client as any;
  const [
    projectRes,
    phasesRes,
    tasksRes,
    blockersRes,
    risksRes,
    execRes,
  ] = await Promise.all([
    c
      .from("projects")
      .select("id,start_date,target_end_date,baseline_end_date,actual_end_date,status,is_archived")
      .eq("id", projectId)
      .maybeSingle(),
    c
      .from("phases")
      .select("id,project_id,status,is_archived")
      .eq("project_id", projectId),
    c
      .from("tasks")
      .select("id,project_id,phase_id,task_type,status,start_date,due_date,baseline_end_date,actual_end_date,is_archived")
      .eq("project_id", projectId),
    c
      .from("blockers")
      .select("id,target_type,target_id,status"),
    c
      .from("risks")
      .select("id,target_type,target_id,status,impact"),
    c
      .from("execution_updates")
      .select("id,target_type,target_id,update_date")
      .eq("target_type", "project")
      .eq("target_id", projectId),
  ]);

  if (projectRes.error) throw projectRes.error;
  if (!projectRes.data) throw new Error("Project not found or not visible");
  if (phasesRes.error) throw phasesRes.error;
  if (tasksRes.error) throw tasksRes.error;
  if (blockersRes.error) throw blockersRes.error;
  if (risksRes.error) throw risksRes.error;
  if (execRes.error) throw execRes.error;

  const p = projectRes.data as any;
  const project: KpiProjectInput = {
    id: p.id,
    plannedStartDate: p.start_date ?? null,
    targetEndDate: p.target_end_date ?? null,
    baselineEndDate: p.baseline_end_date ?? null,
    actualEndDate: p.actual_end_date ?? null,
    status: p.status ?? null,
    isArchived: !!p.is_archived,
  };

  const phases: KpiPhaseInput[] = ((phasesRes.data as any[]) ?? []).map((row) => ({
    id: row.id,
    projectId: row.project_id,
    status: row.status ?? null,
    isArchived: !!row.is_archived,
  }));

  const tasks: KpiTaskInput[] = ((tasksRes.data as any[]) ?? []).map((row) => ({
    id: row.id,
    projectId: row.project_id,
    phaseId: row.phase_id ?? null,
    taskType: row.task_type ?? null,
    status: row.status ?? null,
    plannedStartDate: row.start_date ?? null,
    dueDate: row.due_date ?? null,
    baselineEndDate: row.baseline_end_date ?? null,
    actualEndDate: row.actual_end_date ?? null,
    isArchived: !!row.is_archived,
  }));

  const phaseIds = new Set(phases.map((x) => x.id));
  const taskIds = new Set(tasks.map((x) => x.id));
  const inScope = (targetType: string, targetId: string) =>
    (targetType === "project" && targetId === projectId) ||
    (targetType === "phase" && phaseIds.has(targetId)) ||
    (targetType === "task" && taskIds.has(targetId));

  const blockers: KpiBlockerInput[] = ((blockersRes.data as any[]) ?? [])
    .filter((row) => inScope(row.target_type, row.target_id))
    .map((row) => ({
      id: row.id,
      targetType: row.target_type,
      targetId: row.target_id,
      status: row.status,
    }));

  const risks: KpiRiskInput[] = ((risksRes.data as any[]) ?? [])
    .filter((row) => inScope(row.target_type, row.target_id))
    .map((row) => ({
      id: row.id,
      targetType: row.target_type,
      targetId: row.target_id,
      status: row.status,
      impact: row.impact,
    }));

  const executionUpdates: KpiExecutionUpdateInput[] = ((execRes.data as any[]) ?? []).map((row) => ({
    id: row.id,
    targetType: row.target_type,
    targetId: row.target_id,
    updateDate: row.update_date,
  }));

  return {
    project,
    phases,
    tasks,
    blockers,
    risks,
    executionUpdates,
    reportingSummary: null,
    snapshotDate: options.snapshotDate,
  };
}
