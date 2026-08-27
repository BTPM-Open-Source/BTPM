// DC.14 — Generate Decision Case Data Package (JSON snapshot).
//
// Server-side assembly of a structured JSON data package for an already
// instructed Copilot / Decision Briefing Agent. BTPM stores the package
// (encrypted) versioned per decision case. BTPM does NOT send anything
// to Copilot.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";
import { assertBrowserSessionOnly } from "../_shared/btpm-api/assertBrowserSessionOnly.ts";
import { createSupabaseTokenVerifier } from "../_shared/btpm-api/resolveTokenContext.ts";
import { toSafeErrorResponse } from "../_shared/btpm-api/apiErrors.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function safeName(s: string): string {
  return (s || "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "untitled";
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Stable JSON.stringify with sorted keys for deterministic hashing.
function stableStringify(value: unknown): string {
  const seen = new WeakSet();
  const norm = (v: any): any => {
    if (v && typeof v === "object") {
      if (seen.has(v)) return null;
      seen.add(v);
      if (Array.isArray(v)) return v.map(norm);
      return Object.keys(v).sort().reduce((acc: any, k) => { acc[k] = norm(v[k]); return acc; }, {});
    }
    return v;
  };
  return JSON.stringify(norm(value), null, 2);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json(401, { ok: false, error: "missing_authorization" });

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    try {
      const verifier = createSupabaseTokenVerifier(userClient);
      await assertBrowserSessionOnly(req, verifier);
    } catch (guardError) {
      return toSafeErrorResponse(guardError, corsHeaders);
    }

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json(401, { ok: false, error: "not_authenticated" });

    const body = await req.json().catch(() => ({}));
    const recordId: string | undefined = body?.recordId;
    if (!recordId || typeof recordId !== "string") {
      return json(400, { ok: false, error: "invalid_request", note: "recordId required" });
    }

    // 1) Caller-scoped protected Decision Case resolution (C20C15).
    //    This protected RPC owns the governance_records lookup, the Decision
    //    Case kind check, and returns the authoritative scope IDs. It MUST
    //    precede any service-role business-table read. Browser-supplied
    //    scope identifiers are never trusted.
    const { data: projectSummary, error: summaryError } = await userClient.rpc(
      "get_governance_decision_case_project_summary",
      { _record_id: recordId },
    );
    if (summaryError) {
      const code = (summaryError as { code?: string } | null)?.code ?? "";
      if (code === "P0002") return json(404, { ok: false, error: "record_not_found" });
      if (code === "22023") return json(400, { ok: false, error: "not_decision_case" });
      return json(403, { ok: false, error: "not_authorized" });
    }
    const summary: any = (projectSummary as any) ?? {};
    const projectId: string | undefined = summary?.project_id;
    const organizationId: string | undefined = summary?.organization_id;
    const workspaceId: string | undefined = summary?.workspace_id;
    if (!projectId || !organizationId || !workspaceId) {
      return json(403, { ok: false, error: "not_authorized" });
    }

    // 2) Caller-scoped Project write / PM authority — required before any
    //    service-role client construction or business read/write.
    const { error: authErr } = await userClient.rpc("_gov_assert_project_write", {
      _project_id: projectId,
    });
    if (authErr) {
      return json(403, { ok: false, error: "not_authorized" });
    }

    // Service-role client is constructed ONLY after caller authority.
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE);

    // 3) Assemble canonical data via protected RPCs (caller-scoped)
    const [detailRes, evidenceRes, btpmRes, packagesRes, outcomeRes, stakeholdersRes] =
      await Promise.all([
        userClient.rpc("get_governance_record_detail", { _record_id: recordId }),
        userClient.rpc("list_governance_record_evidence_references", {
          _record_id: recordId, _include_archived: false,
        }),
        userClient.rpc("list_governance_record_btpm_context_links", {
          _record_id: recordId, _include_archived: false,
        }),
        userClient.rpc("list_governance_record_stakeholder_packages", { _record_id: recordId }),
        userClient.rpc("get_governance_record_decision_outcome", { _record_id: recordId }),
        adminClient.from("project_stakeholders").select("id, display_name, email, stakeholder_type")
          .eq("project_id", projectId),
      ]);

    for (const r of [detailRes, evidenceRes, btpmRes, packagesRes, outcomeRes]) {
      if (r.error) return json(500, { ok: false, error: "data_assembly_failed", note: r.error.message });
    }

    const detail: any = detailRes.data ?? {};
    const evidenceList: any[] = (evidenceRes.data as any[]) ?? [];
    const btpmList: any[] = (btpmRes.data as any[]) ?? [];
    const stakeholderPackages: any[] = (packagesRes.data as any[]) ?? [];
    const outcome: any = outcomeRes.data ?? null;
    const stakeholders: any[] = (stakeholdersRes.data as any[]) ?? [];

    // Compute source_project_ids = parent + all btpm context source projects (user has access via RPC)
    const sourceProjectIdSet = new Set<string>([projectId]);
    for (const l of btpmList) {
      if (l?.source_project_id) sourceProjectIdSet.add(l.source_project_id);
    }
    const sourceProjectIds = Array.from(sourceProjectIdSet);

    // Build decision_case section
    const ownerStakeholder = stakeholders.find(
      (s) => s.id === detail.decision_owner_stakeholder_id,
    ) ?? null;

    const decisionCase = {
      id: detail.id ?? recordId,
      title: detail.event_name ?? null,
      decision_question: detail.decision_question ?? null,
      background_summary: detail.summary ?? null,
      forum_event_type: detail.event_type ?? null,
      target_decision_date: detail.target_decision_date ?? null,
      decision_owner: {
        stakeholder_id: detail.decision_owner_stakeholder_id ?? null,
        name: ownerStakeholder?.display_name ?? null,
        email: ownerStakeholder?.email ?? null,
        type: ownerStakeholder?.stakeholder_type ?? null,
      },
      lifecycle_stage: detail.decision_stage ?? null,
      project: {
        id: summary.project_id ?? projectId,
        name: summary.project_name ?? null,
        workspace_id: summary.workspace_id ?? workspaceId,
        workspace_name: summary.workspace_name ?? null,
        program_id: summary.program_id ?? null,
        program_name: summary.program_name ?? null,
      },
    };

    // External evidence — included_in_package only
    const externalEvidence = evidenceList
      .filter((e) => e?.included_in_package === true && !e?.archived_at)
      .map((e) => ({
        evidence_id: e.id,
        evidence_type: e.evidence_type,
        title: e.title,
        summary: e.summary ?? null,
        evidence_date: e.evidence_date ?? null,
        relevance_level: e.relevance_level,
        included_in_package: true,
        owner: {
          stakeholder_id: e.owner_stakeholder_id ?? null,
          name: e.owner_stakeholder_id
            ? (stakeholders.find((s) => s.id === e.owner_stakeholder_id)?.display_name ?? null)
            : null,
          email: e.owner_stakeholder_id
            ? (stakeholders.find((s) => s.id === e.owner_stakeholder_id)?.email ?? null)
            : null,
        },
        source_url: e.external_url,
      }));

    // BTPM context — group by source project; per-object details fetched best-effort
    const includedLinks = btpmList.filter((l) => l?.included_in_package === true && !l?.archived_at);

    // Resolve object details per type using admin reads + helper decryption RPC where useful.
    const resolvedDetailsCache = new Map<string, any>();
    const unresolvedIds: string[] = [];

    async function decryptText(ciphertext: string | null, orgId: string): Promise<string | null> {
      if (!ciphertext) return null;
      try {
        const { data, error } = await adminClient.rpc("btpm_decrypt", {
          _ciphertext: ciphertext, _org_id: orgId,
        } as any);
        if (error) return null;
        return (data as unknown as string) ?? null;
      } catch { return null; }
    }

    async function resolveObject(l: any): Promise<any> {
      const cacheKey = `${l.object_type}:${l.object_id}`;
      if (resolvedDetailsCache.has(cacheKey)) return resolvedDetailsCache.get(cacheKey);
      let details: any = {};
      try {
        if (l.object_type === "project") {
          const { data } = await adminClient.from("projects")
            .select("id, name, status, priority, start_date, target_end_date, organization_id")
            .eq("id", l.object_id).maybeSingle();
          if (data) {
            details = {
              name: await decryptText((data as any).name, (data as any).organization_id),
              status: (data as any).status,
              priority: (data as any).priority,
              start_date: (data as any).start_date ?? null,
              target_end_date: (data as any).target_end_date ?? null,
            };
          }
        } else if (l.object_type === "phase") {
          const { data } = await adminClient.from("phases")
            .select("id, name, status, start_date, end_date, organization_id")
            .eq("id", l.object_id).maybeSingle();
          if (data) {
            details = {
              name: await decryptText((data as any).name, (data as any).organization_id),
              status: (data as any).status,
              start_date: (data as any).start_date ?? null,
              end_date: (data as any).end_date ?? null,
            };
          }
        } else if (l.object_type === "task") {
          const { data } = await adminClient.from("tasks")
            .select("id, name, status, priority, phase_id, start_date, due_date, completed_at, organization_id")
            .eq("id", l.object_id).maybeSingle();
          if (data) {
            const d: any = data;
            details = {
              title: await decryptText(d.name, d.organization_id),
              status: d.status,
              priority: d.priority,
              phase_id: d.phase_id,
              start_date: d.start_date ?? null,
              due_date: d.due_date ?? null,
              completed_at: d.completed_at ?? null,
              overdue: d.due_date && !d.completed_at ? (new Date(d.due_date) < new Date()) : false,
            };
          }
        } else if (l.object_type === "risk") {
          const { data } = await adminClient.from("risks")
            .select("id, title, status, impact, likelihood, mitigation, target_resolution_date, organization_id")
            .eq("id", l.object_id).maybeSingle();
          if (data) {
            const d: any = data;
            details = {
              title: await decryptText(d.title, d.organization_id),
              status: d.status,
              impact: d.impact,
              likelihood: d.likelihood,
              mitigation: await decryptText(d.mitigation, d.organization_id),
              target_resolution_date: d.target_resolution_date ?? null,
            };
          }
        } else if (l.object_type === "blocker") {
          const { data } = await adminClient.from("blockers")
            .select("id, title, status, impact, resolution_plan, target_resolution_date, organization_id, created_at")
            .eq("id", l.object_id).maybeSingle();
          if (data) {
            const d: any = data;
            const days = d.created_at ? Math.max(0, Math.floor((Date.now() - new Date(d.created_at).getTime()) / 86400000)) : null;
            details = {
              title: await decryptText(d.title, d.organization_id),
              status: d.status,
              impact: d.impact,
              resolution_plan: await decryptText(d.resolution_plan, d.organization_id),
              target_resolution_date: d.target_resolution_date ?? null,
              days_open: days,
            };
          }
        } else if (l.object_type === "kpi_definition") {
          const { data } = await adminClient.from("kpi_definitions")
            .select("id, name, description, unit, target_value")
            .eq("id", l.object_id).maybeSingle();
          if (data) {
            const d: any = data;
            details = {
              name: d.name,
              description: d.description,
              unit: d.unit,
              target_value: d.target_value,
            };
          }
        } else if (l.object_type === "kpi_update") {
          const { data } = await adminClient.from("kpi_updates")
            .select("id, kpi_definition_id, value, period_end, commentary, status")
            .eq("id", l.object_id).maybeSingle();
          if (data) {
            const d: any = data;
            details = {
              kpi_definition_id: d.kpi_definition_id,
              value: d.value,
              period_end: d.period_end ?? null,
              commentary: d.commentary ?? null,
              status: d.status ?? null,
            };
          }
        }
      } catch {
        unresolvedIds.push(`${l.object_type}:${l.object_id}`);
      }
      if (Object.keys(details).length === 0) unresolvedIds.push(`${l.object_type}:${l.object_id}`);
      resolvedDetailsCache.set(cacheKey, details);
      return details;
    }

    const groups = new Map<string, any>();
    for (const l of includedLinks) {
      const key = l.source_project_id;
      if (!groups.has(key)) {
        groups.set(key, {
          source_project: {
            id: l.source_project_id,
            name: l.source_project_name ?? null,
            workspace_id: l.source_workspace_id,
            workspace_name: l.source_workspace_name ?? null,
            program_id: l.source_program_id ?? null,
            program_name: l.source_program_name ?? null,
            status: l.source_project_status ?? null,
            priority: l.source_project_priority ?? null,
          },
          selected_objects: [] as any[],
        });
      }
    }

    for (const l of includedLinks) {
      const objDetails = await resolveObject(l);
      const group = groups.get(l.source_project_id);
      group.selected_objects.push({
        context_link_id: l.id,
        object_type: l.object_type,
        object_id: l.object_id,
        object_name: l.object_name ?? null,
        object_status: l.object_status ?? null,
        relationship_type: l.relationship_type,
        relevance_level: l.relevance_level,
        included_in_package: true,
        context_reason: l.context_reason ?? null,
        object_details: objDetails,
      });
    }

    const btpmContext = { sources: Array.from(groups.values()) };

    // Current stakeholder package
    const currentSP = stakeholderPackages.find((p) => p?.is_current) ?? null;
    const currentStakeholderPackage = currentSP ? {
      version_number: currentSP.version_number,
      status: currentSP.package_status,
      package_title: currentSP.package_title ?? null,
      audience: currentSP.audience_text ?? null,
      executive_summary: currentSP.executive_summary ?? null,
      decision_question: currentSP.decision_question_text ?? null,
      background_context: currentSP.background_context ?? null,
      options_summary: currentSP.options_summary ?? null,
      recommendation: currentSP.recommendation_text ?? null,
      decision_ask: currentSP.decision_ask_text ?? null,
      evidence_summary: currentSP.evidence_summary ?? null,
      guardrails: currentSP.guardrails_text ?? null,
      residual_risks: currentSP.residual_risks_text ?? null,
      next_steps: currentSP.next_steps_text ?? null,
    } : null;

    // Formal decision outcome
    const formalDecisionOutcome = outcome ? {
      decision_result: outcome.decision_result,
      final_decision_text: outcome.final_decision_text,
      decision_date: outcome.decision_date,
      decided_by: outcome.decided_by_text ?? null,
      approval_forum: outcome.approval_forum ?? null,
      decision_rationale: outcome.decision_rationale ?? null,
      conditions_guardrails: outcome.conditions_guardrails ?? null,
      residual_risks: outcome.residual_risks ?? null,
      follow_up_actions: outcome.follow_up_actions ?? null,
      signoff_status: outcome.signoff_status ?? null,
    } : null;

    // Data quality notes — factual only
    const notes: string[] = [];
    if (externalEvidence.length === 0) notes.push("No external evidence included in package.");
    else if (!externalEvidence.some((e) => e.relevance_level === "high"))
      notes.push("No high-relevance external evidence included.");
    if (includedLinks.length === 0) notes.push("No BTPM context objects included.");
    if (!currentStakeholderPackage) notes.push("No current stakeholder package exists.");
    if (!formalDecisionOutcome) notes.push("No formal decision outcome recorded yet.");
    if (unresolvedIds.length > 0)
      notes.push("Some linked BTPM objects could not be fully resolved and are included by id only.");

    const snapshotAt = new Date().toISOString();
    const payload = {
      schema_version: "1.0",
      package_type: "decision_case_data_package",
      generated_by: "BTPM",
      source_snapshot_at: snapshotAt,
      decision_case: decisionCase,
      external_evidence: externalEvidence,
      btpm_context: btpmContext,
      current_stakeholder_package: currentStakeholderPackage,
      formal_decision_outcome: formalDecisionOutcome,
      data_quality_notes: notes,
    };

    const canonicalJson = stableStringify(payload);
    const hash = await sha256Hex(canonicalJson);

    // Determine next version
    const { data: maxRow } = await adminClient
      .from("governance_record_copilot_data_packages")
      .select("version_number")
      .eq("governance_record_id", recordId)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextVersion = ((maxRow as any)?.version_number ?? 0) + 1;

    const projectName = decisionCase.project.name?.trim() || "Project";
    const titleSafe = safeName(decisionCase.title?.trim() || "Decision Case");
    const filename = `Decision Data Package - ${safeName(projectName)} - ${titleSafe} - v${nextVersion}.json`;

    // Demote prior currents
    await adminClient
      .from("governance_record_copilot_data_packages")
      .update({ is_current: false, package_status: "superseded" })
      .eq("governance_record_id", recordId)
      .eq("is_current", true);

    // Insert (trigger encrypts package_filename + package_json)
    const { data: inserted, error: insErr } = await adminClient
      .from("governance_record_copilot_data_packages")
      .insert({
        organization_id: organizationId,
        workspace_id: workspaceId,
        project_id: projectId,
        governance_record_id: recordId,
        version_number: nextVersion,
        is_current: true,
        package_status: "prepared",
        package_filename: filename,
        package_json: canonicalJson,
        package_hash: hash,
        source_project_ids: sourceProjectIds,
        source_snapshot_at: snapshotAt,
        created_by: userData.user.id,
      })
      .select("id, version_number")
      .single();
    if (insErr) return json(500, { ok: false, error: "insert_failed", note: insErr.message });

    // Activity log (no plaintext content)
    try {
      await adminClient.rpc("log_activity_event", {
        _organization_id: organizationId,
        _user_id: userData.user.id,
        _event_type: "governance_record_copilot_data_package_generated",
        _target_type: "governance_record",
        _target_id: recordId,
        _metadata: {
          project_id: projectId,
          data_package_id: (inserted as any).id,
          version_number: nextVersion,
          package_hash: hash,
          source_project_count: sourceProjectIds.length,
        },
        _workspace_id: workspaceId,
      } as any);
    } catch (_) { /* non-fatal */ }

    return json(200, {
      ok: true,
      package_id: (inserted as any).id,
      version_number: nextVersion,
      package_filename: filename,
      package_hash: hash,
      package_json: canonicalJson,
      source_snapshot_at: snapshotAt,
    });
  } catch (e) {
    return json(500, { ok: false, error: "unhandled", note: String((e as any)?.message ?? e) });
  }
});
