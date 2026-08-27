/**
 * Roadmap Status Pack — Governance / Decisions / Asks data hook (Phase 6A.10).
 *
 * Fans out the existing protected SECURITY DEFINER RPC
 *   - `list_project_governance_records(_project_id, _include_archived)`
 * one call per scoped project. This is the SAME safe read path already used
 * by `useProjectGovernanceRecords` (project detail surface) and by the legacy
 * roadmap deck Edge Function annex mapper.
 *
 * NO new RPCs. NO new Edge Functions. NO direct plaintext table reads. NO
 * decryption work in the client — the RPC returns server-decrypted rows.
 *
 * Scope filtering is applied BEFORE issuing queries (only authorized, scoped
 * projects from the Roadmap Status Pack preview).
 *
 * Decision/ask semantics:
 *  - `record_kind = 'decision_case'` rows are explicitly classified by
 *    `decision_stage` — they drive the Decisions Required / Recent Decisions
 *    presentation lists.
 *  - `record_kind = 'evidence_record'` rows are general governance records
 *    (cadence evidence, steerco notes, etc.) and are surfaced as such.
 *  - There is NO explicit "ask" object in the current data model. The
 *    presentation layer must therefore label asks as "not separately
 *    classified yet" rather than inferring them from narrative text.
 */

import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { rpcTyped } from "@/lib/entityLinks";
import type {
  DecisionStage,
  GovernanceRecordKind,
  GovernanceRecordRow,
} from "@/hooks/useProjectGovernance";

export interface RoadmapStatusPackGovernanceRow {
  id: string;
  project_id: string;
  cadence_event_type: string | null;
  cadence_event_name: string | null;
  event_type: string;
  event_name: string | null;
  actual_date_held: string;
  expected_date_snapshot: string | null;
  summary: string | null;
  decisions_summary: string | null;
  external_reference_url: string | null;
  record_kind: GovernanceRecordKind;
  decision_stage: DecisionStage | null;
  decision_question: string | null;
  target_decision_date: string | null;
  decision_count: number;
  link_count: number;
  has_sharepoint_evidence: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UseRoadmapStatusPackGovernanceResult {
  /** Governance records grouped by project id (authorized + scoped only). */
  rowsByProjectId: Map<string, RoadmapStatusPackGovernanceRow[]>;
  isLoading: boolean;
  isError: boolean;
  /** Per-project failure flags — used to mark partial coverage honestly. */
  failedProjectIds: string[];
  hasPartialLoading: boolean;
}

export function useRoadmapStatusPackGovernance(
  scopedProjectIds: readonly string[],
): UseRoadmapStatusPackGovernanceResult {
  const stableIds = useMemo(() => {
    const u = Array.from(new Set(scopedProjectIds));
    u.sort();
    return u;
  }, [scopedProjectIds]);

  const queries = useQueries({
    queries: stableIds.map((pid) => ({
      queryKey: ["status-pack", "governance", pid],
      enabled: !!pid,
      staleTime: 30_000,
      queryFn: async (): Promise<RoadmapStatusPackGovernanceRow[]> => {
        const { data, error } = await rpcTyped<GovernanceRecordRow[]>(
          "list_project_governance_records",
          { _project_id: pid, _include_archived: false },
        );
        if (error) throw new Error(error.message);
        const rows = data ?? [];
        return rows.map((r) => ({
          id: r.id,
          project_id: r.project_id,
          cadence_event_type: r.cadence_event_type,
          cadence_event_name: r.cadence_event_name,
          event_type: r.event_type,
          event_name: r.event_name,
          actual_date_held: r.actual_date_held,
          expected_date_snapshot: r.expected_date_snapshot,
          summary: r.summary,
          decisions_summary: r.decisions_summary,
          external_reference_url: r.external_reference_url,
          record_kind: r.record_kind,
          decision_stage: r.decision_stage,
          decision_question: r.decision_question,
          target_decision_date: r.target_decision_date,
          decision_count: r.decision_count,
          link_count: r.link_count,
          has_sharepoint_evidence: r.has_sharepoint_evidence,
          archived_at: r.archived_at,
          created_at: r.created_at,
          updated_at: r.updated_at,
        }));
      },
    })),
  });

  return useMemo(() => {
    const rowsByProjectId = new Map<string, RoadmapStatusPackGovernanceRow[]>();
    const failed = new Set<string>();
    let hasPartialLoading = false;

    stableIds.forEach((pid, i) => {
      const q = queries[i];
      if (q?.isLoading) hasPartialLoading = true;
      if (q?.isError) {
        failed.add(pid);
      } else if (q?.data) {
        rowsByProjectId.set(pid, q.data);
      }
    });

    const total = stableIds.length;
    const isError = total > 0 && failed.size === total;
    const anyResolved = rowsByProjectId.size > 0 || failed.size > 0;
    const isLoading = hasPartialLoading && !anyResolved;

    return {
      rowsByProjectId,
      isLoading,
      isError,
      failedProjectIds: Array.from(failed),
      hasPartialLoading,
    };
  }, [stableIds, queries]);
}
