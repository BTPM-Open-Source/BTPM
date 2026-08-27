// AI.7.3 — BTPM Context Snapshot Enrichment for Decision Case AI Briefs.
//
// Given the rows returned by `list_governance_record_btpm_context_links`
// (already filtered to non-archived links), this helper enriches each
// explicitly-selected BTPM context link with a bounded, plaintext object
// snapshot suitable for inclusion in the Decision Case AI input package.
//
// Permission model:
//   - For every distinct `source_project_id` referenced by a link, we
//     check the caller's access via `has_project_access` (service-role)
//     before fetching any object detail. Links pointing at projects the
//     caller cannot access degrade to metadata-only with
//     `resolution_status = "permission_denied"`.
//
// Encryption model:
//   - Object detail is read exclusively via existing protected RPCs that
//     already return decrypted plaintext (`get_decrypted_project`,
//     `list_decrypted_project_phases`, `list_decrypted_project_tasks`,
//     `list_decrypted_kpi_definitions`, `list_project_all_risks`,
//     `list_project_all_blockers`). We never emit ciphertext into the AI
//     package.
//
// Failure model:
//   - A failure to resolve a single linked object MUST NOT fail brief
//     generation. The corresponding entry degrades to metadata-only with
//     a data-quality note, and overall generation proceeds.
//
// Scope:
//   - Enriches only objects explicitly selected as BTPM context links
//     for this Decision Case. No project-wide dump of tasks/risks/etc.
//   - Recent updates/comments are intentionally out of scope for AI.7.3
//     (documented as a follow-up). The snapshot fields below are limited
//     to what is already exposed by the existing decrypted RPCs.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

type ResolutionStatus =
  | "resolved"
  | "metadata_only"
  | "unresolved"
  | "permission_denied"
  | "unsupported_type";

export interface EnrichedContextSource {
  context_link_id: string | null;
  relationship_type: string | null;
  relevance_level: string | null;
  context_reason: string | null;
  included_in_package: boolean;
  source_project: {
    project_id: string | null;
    project_name: string | null;
    workspace_id: string | null;
    workspace_name: string | null;
    program_id: string | null;
    program_name: string | null;
  };
  object: {
    object_type: string;
    object_id: string | null;
    object_name: string | null;
    object_status: string | null;
    resolution_status: ResolutionStatus;
    snapshot: Record<string, unknown>;
    data_quality_notes: string[];
  };
}

export interface BtpmContextSnapshotsResult {
  sources: EnrichedContextSource[];
  data_quality_notes: string[];
  resolved_count: number;
  sources_count: number;
}

const SUPPORTED_DEEP_TYPES = new Set([
  "project",
  "phase",
  "task",
  "risk",
  "blocker",
  "kpi_definition",
]);

/**
 * Build enriched BTPM context snapshots from the raw context-link rows.
 *
 * - `userClient`  — auth-scoped client (RLS enforced; used for all
 *                   decrypted-list RPCs so per-project access is
 *                   double-checked at the DB layer as well).
 * - `adminClient` — service-role client (used only for the explicit
 *                   `has_project_access` check up front).
 */
export async function buildDecisionCaseBtpmContextSnapshots(
  userClient: SupabaseClient,
  adminClient: SupabaseClient,
  callerUserId: string,
  ctxLinks: any[],
): Promise<BtpmContextSnapshotsResult> {
  const links = Array.isArray(ctxLinks) ? ctxLinks : [];
  const sourcesCount = links.length;
  if (sourcesCount === 0) {
    return { sources: [], data_quality_notes: [], resolved_count: 0, sources_count: 0 };
  }

  // 1) Determine project-access for every distinct source_project_id.
  const sourceProjectIds = Array.from(
    new Set(
      links
        .map((l) => (l?.source_project_id ? String(l.source_project_id) : null))
        .filter((id): id is string => !!id),
    ),
  );
  const accessBySourceProject = new Map<string, boolean>();
  await Promise.all(
    sourceProjectIds.map(async (pid) => {
      try {
        const { data, error } = await adminClient.rpc("has_project_access", {
          _user_id: callerUserId,
          _project_id: pid,
        });
        accessBySourceProject.set(pid, !error && data === true);
      } catch {
        accessBySourceProject.set(pid, false);
      }
    }),
  );

  // 2) For accessible projects, fetch decrypted object lists ONCE per
  //    project per object-type that appears in this link set.
  const neededByProject = new Map<string, Set<string>>();
  for (const l of links) {
    const pid = l?.source_project_id ? String(l.source_project_id) : null;
    const ot = l?.object_type ? String(l.object_type) : null;
    if (!pid || !ot) continue;
    if (!accessBySourceProject.get(pid)) continue;
    if (!SUPPORTED_DEEP_TYPES.has(ot)) continue;
    if (!neededByProject.has(pid)) neededByProject.set(pid, new Set());
    neededByProject.get(pid)!.add(ot);
  }

  type ObjMap = Map<string, any>;
  const projectIndex = new Map<
    string,
    {
      project?: any | null;
      phases?: ObjMap;
      tasks?: ObjMap;
      risks?: ObjMap;
      blockers?: ObjMap;
      kpi_definitions?: ObjMap;
    }
  >();

  await Promise.all(
    Array.from(neededByProject.entries()).map(async ([pid, types]) => {
      const bucket: any = {};
      const jobs: Array<Promise<void>> = [];
      if (types.has("project")) {
        jobs.push(
          (async () => {
            try {
              const { data } = await userClient.rpc("get_decrypted_project", {
                _project_id: pid,
              });
              bucket.project = data ?? null;
            } catch {
              bucket.project = null;
            }
          })(),
        );
      }
      if (types.has("phase")) {
        jobs.push(
          (async () => {
            try {
              const { data } = await userClient.rpc(
                "list_decrypted_project_phases",
                { _project_id: pid },
              );
              const m: ObjMap = new Map();
              for (const r of (data as any[]) ?? []) m.set(String(r.id), r);
              bucket.phases = m;
            } catch {
              bucket.phases = new Map();
            }
          })(),
        );
      }
      if (types.has("task")) {
        jobs.push(
          (async () => {
            try {
              const { data } = await userClient.rpc(
                "list_decrypted_project_tasks",
                { _project_id: pid },
              );
              const m: ObjMap = new Map();
              for (const r of (data as any[]) ?? []) m.set(String(r.id), r);
              bucket.tasks = m;
            } catch {
              bucket.tasks = new Map();
            }
          })(),
        );
      }
      if (types.has("risk")) {
        jobs.push(
          (async () => {
            try {
              const { data } = await userClient.rpc("list_project_all_risks", {
                _project_id: pid,
              });
              const m: ObjMap = new Map();
              for (const r of (data as any[]) ?? []) m.set(String(r.id), r);
              bucket.risks = m;
            } catch {
              bucket.risks = new Map();
            }
          })(),
        );
      }
      if (types.has("blocker")) {
        jobs.push(
          (async () => {
            try {
              const { data } = await userClient.rpc(
                "list_project_all_blockers",
                { _project_id: pid },
              );
              const m: ObjMap = new Map();
              for (const r of (data as any[]) ?? []) m.set(String(r.id), r);
              bucket.blockers = m;
            } catch {
              bucket.blockers = new Map();
            }
          })(),
        );
      }
      if (types.has("kpi_definition")) {
        jobs.push(
          (async () => {
            try {
              const { data } = await userClient.rpc(
                "list_decrypted_kpi_definitions",
                { _project_id: pid },
              );
              const m: ObjMap = new Map();
              for (const r of (data as any[]) ?? []) m.set(String(r.id), r);
              bucket.kpi_definitions = m;
            } catch {
              bucket.kpi_definitions = new Map();
            }
          })(),
        );
      }
      await Promise.all(jobs);
      projectIndex.set(pid, bucket);
    }),
  );

  // 3) Build enriched per-link entries.
  const sources: EnrichedContextSource[] = [];
  let resolvedCount = 0;
  let anyMetadataOnly = false;
  let anyPermissionDenied = false;

  for (const l of links) {
    const pid = l?.source_project_id ? String(l.source_project_id) : null;
    const objectType = l?.object_type ? String(l.object_type) : "other";
    const objectId = l?.object_id ? String(l.object_id) : null;
    const notes: string[] = [];

    const base: EnrichedContextSource = {
      context_link_id: l?.id ?? null,
      relationship_type: l?.relationship_type ?? null,
      relevance_level: l?.relevance_level ?? null,
      context_reason: l?.context_reason ?? null,
      included_in_package: l?.included_in_package === true,
      source_project: {
        project_id: pid,
        project_name: l?.source_project_name ?? null,
        workspace_id: l?.source_workspace_id ?? null,
        workspace_name: l?.source_workspace_name ?? null,
        program_id: l?.source_program_id ?? null,
        program_name: l?.source_program_name ?? null,
      },
      object: {
        object_type: objectType,
        object_id: objectId,
        object_name: l?.object_name ?? null,
        object_status: l?.object_status ?? null,
        resolution_status: "metadata_only",
        snapshot: {},
        data_quality_notes: notes,
      },
    };

    if (!pid) {
      notes.push("Link is missing source_project_id; cannot resolve object detail.");
      base.object.resolution_status = "unresolved";
      anyMetadataOnly = true;
      sources.push(base);
      continue;
    }
    if (!accessBySourceProject.get(pid)) {
      notes.push("Caller does not have access to the source project; metadata only.");
      base.object.resolution_status = "permission_denied";
      anyPermissionDenied = true;
      sources.push(base);
      continue;
    }
    if (!SUPPORTED_DEEP_TYPES.has(objectType)) {
      notes.push(`Object type "${objectType}" is not deeply enriched in this version.`);
      base.object.resolution_status = "unsupported_type";
      anyMetadataOnly = true;
      sources.push(base);
      continue;
    }
    if (!objectId) {
      notes.push("Link is missing object_id; cannot resolve object detail.");
      base.object.resolution_status = "unresolved";
      anyMetadataOnly = true;
      sources.push(base);
      continue;
    }

    const bucket = projectIndex.get(pid) ?? {};
    let snap: Record<string, unknown> | null = null;

    try {
      if (objectType === "project") {
        const p = bucket.project as any | null;
        if (p && (p.id === objectId || !p.id)) {
          snap = {
            project_name: p.name ?? null,
            status: p.status ?? null,
            priority: p.priority ?? null,
            description: p.description ?? null,
            start_date: p.start_date ?? null,
            target_end_date: p.target_end_date ?? p.end_date ?? null,
            actual_end_date: p.actual_end_date ?? null,
            stage: p.stage ?? null,
            delivery_model: p.delivery_model ?? null,
            project_manager_user_id: p.project_manager_user_id ?? null,
          };
        }
      } else if (objectType === "phase") {
        const r = bucket.phases?.get(objectId);
        if (r) {
          snap = {
            name: r.name ?? null,
            status: r.status ?? null,
            description: r.description ?? null,
            sort_order: r.sort_order ?? null,
            start_date: r.start_date ?? null,
            target_start_date: r.target_start_date ?? null,
            target_end_date: r.target_end_date ?? null,
            actual_end_date: r.actual_end_date ?? null,
            project_id: r.project_id ?? null,
            is_archived: r.is_archived ?? null,
          };
        }
      } else if (objectType === "task") {
        const r = bucket.tasks?.get(objectId);
        if (r) {
          snap = {
            name: r.name ?? null,
            status: r.status ?? null,
            task_type: r.task_type ?? null,
            priority: r.priority ?? null,
            description: r.description ?? null,
            start_date: r.start_date ?? null,
            due_date: r.due_date ?? null,
            target_end_date: r.target_end_date ?? null,
            actual_end_date: r.actual_end_date ?? null,
            phase_id: r.phase_id ?? null,
            project_id: r.project_id ?? null,
            is_archived: r.is_archived ?? null,
            updated_at: r.updated_at ?? null,
          };
        }
      } else if (objectType === "risk") {
        const r = bucket.risks?.get(objectId);
        if (r) {
          snap = {
            title: r.title ?? null,
            description: r.description ?? null,
            status: r.status ?? null,
            likelihood: r.likelihood ?? null,
            impact: r.impact ?? null,
            mitigation_plan: r.mitigation_plan ?? null,
            target_type: r.target_type ?? null,
            target_id: r.target_id ?? null,
            source_name: r.source_name ?? null,
            created_at: r.created_at ?? null,
            updated_at: r.updated_at ?? null,
          };
        }
      } else if (objectType === "blocker") {
        const r = bucket.blockers?.get(objectId);
        if (r) {
          snap = {
            title: r.title ?? null,
            description: r.description ?? null,
            status: r.status ?? null,
            severity: r.severity ?? null,
            target_type: r.target_type ?? null,
            target_id: r.target_id ?? null,
            source_name: r.source_name ?? null,
            resolved_at: r.resolved_at ?? null,
            created_at: r.created_at ?? null,
            updated_at: r.updated_at ?? null,
          };
        }
      } else if (objectType === "kpi_definition") {
        const r = bucket.kpi_definitions?.get(objectId);
        if (r) {
          snap = {
            name: r.name ?? null,
            description: r.description ?? null,
            unit: r.unit ?? null,
            target_value: r.target_value ?? null,
            target_direction: r.target_direction ?? null,
            cadence: r.cadence ?? null,
            source_mode: r.source_mode ?? null,
            target_type: r.target_type ?? null,
            target_id: r.target_id ?? null,
            is_archived: r.is_archived ?? null,
          };
        }
      }
    } catch {
      snap = null;
    }

    if (snap) {
      base.object.snapshot = snap;
      base.object.resolution_status = "resolved";
      resolvedCount++;
    } else {
      notes.push("Object not found via decrypted project RPCs; falling back to link metadata.");
      base.object.resolution_status = "unresolved";
      anyMetadataOnly = true;
    }

    sources.push(base);
  }

  const packageNotes: string[] = [];
  if (anyPermissionDenied) {
    packageNotes.push(
      "Some linked BTPM context objects belong to projects the requester cannot access and are included as metadata only.",
    );
  }
  if (anyMetadataOnly) {
    packageNotes.push(
      "Some linked BTPM context objects could not be deeply resolved and are included as metadata only.",
    );
  }

  return {
    sources,
    data_quality_notes: packageNotes,
    resolved_count: resolvedCount,
    sources_count: sourcesCount,
  };
}
