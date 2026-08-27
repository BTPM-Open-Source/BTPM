// Roadmap Status Deck v2 — per-project annex data mapper.
//
// For each project in scope, fetches a compact set of canonical BTPM
// signals used by the annex slides: latest progress/execution updates,
// governance summary, top open blockers and risks.
//
// All data is read live via decryption-aware RPCs. Nothing is cached and
// no duplicate reporting truth is created. Missing data => empty-state
// fields (never fabricated).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import type { RoadmapDeckProject } from "./roadmapDeckDataMapper.ts";

export interface AnnexProgressEntry {
  date: string | null;
  title: string;
  detail: string | null;
}
export interface AnnexGovernanceEntry {
  date: string | null;
  title: string;
  status: string | null;
}
export interface AnnexRiskOrBlocker {
  title: string;
  severity: string | null;
  status: string | null;
}
export interface AnnexProjectData {
  projectId: string;
  pmNames: string[];
  ownerNames: string[];
  progressEntries: AnnexProgressEntry[];
  progressMore: number;
  governanceEntries: AnnexGovernanceEntry[];
  governanceMore: number;
  governanceCadence: string | null;
  governanceNextExpected: string | null;
  openBlockersCount: number;
  topBlockers: AnnexRiskOrBlocker[];
  highImpactRisksCount: number;
  topRisks: AnnexRiskOrBlocker[];
}

const MAX_PROGRESS = 4;
const MAX_GOVERNANCE = 3;
const MAX_BLOCKERS = 2;
const MAX_RISKS = 2;

function safeStr(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  try { return String(v); } catch { return ""; }
}
function safeDate(v: unknown): string | null {
  const s = safeStr(v);
  return s ? s.slice(0, 10) : null;
}

async function fetchOne(
  supabase: SupabaseClient,
  project: RoadmapDeckProject,
): Promise<AnnexProjectData> {
  const out: AnnexProjectData = {
    projectId: project.id,
    pmNames: [],
    ownerNames: project.ownerNames ?? [],
    progressEntries: [],
    progressMore: 0,
    governanceEntries: [],
    governanceMore: 0,
    governanceCadence: null,
    governanceNextExpected: null,
    openBlockersCount: 0,
    topBlockers: [],
    highImpactRisksCount: 0,
    topRisks: [],
  };

  // ---- Execution updates (project-level only for annex compactness) ----
  try {
    const { data: euJson } = await supabase.rpc("list_decrypted_execution_updates", {
      _target_type: "project",
      _target_id: project.id,
    });
    const rows = (euJson as any[]) ?? [];
    const sorted = rows
      .map((r) => ({
        date: safeDate(r.update_date ?? r.created_at),
        title: safeStr(r.title ?? r.summary ?? "Execution update").slice(0, 90),
        detail: (() => {
          const d = safeStr(r.detail ?? r.notes ?? r.description ?? "");
          return d ? (d.length > 180 ? d.slice(0, 179) + "…" : d) : null;
        })(),
        _sortKey: r.update_date ?? r.created_at ?? "",
      }))
      .sort((a, b) => String(b._sortKey).localeCompare(String(a._sortKey)));
    out.progressEntries = sorted.slice(0, MAX_PROGRESS).map((x) => ({
      date: x.date, title: x.title, detail: x.detail,
    }));
    out.progressMore = Math.max(0, sorted.length - out.progressEntries.length);
  } catch { /* tolerate */ }

  // ---- Governance summary + recent records ----
  try {
    const { data: gs } = await supabase.rpc("get_project_governance_summary", {
      _project_id: project.id,
    });
    const g = gs as any;
    if (g && typeof g === "object") {
      out.governanceCadence = safeStr(g.next_cadence_label ?? g.cadence_label ?? g.cadence ?? "") || null;
      out.governanceNextExpected = safeDate(g.next_expected_date ?? g.next_due_date);
    }
  } catch { /* tolerate */ }
  try {
    const { data: gr } = await supabase.rpc("list_project_governance_records", {
      _project_id: project.id, _include_archived: false,
    });
    const rows = (gr as any[]) ?? [];
    const sorted = rows
      .map((r) => ({
        date: safeDate(r.event_date ?? r.occurred_at ?? r.created_at),
        title: safeStr(r.title ?? r.event_type ?? r.kind ?? "Governance record").slice(0, 80),
        status: safeStr(r.status ?? r.outcome ?? r.evidence_status ?? "") || null,
        _sortKey: r.event_date ?? r.occurred_at ?? r.created_at ?? "",
      }))
      .sort((a, b) => String(b._sortKey).localeCompare(String(a._sortKey)));
    out.governanceEntries = sorted.slice(0, MAX_GOVERNANCE).map((x) => ({
      date: x.date, title: x.title, status: x.status,
    }));
    out.governanceMore = Math.max(0, sorted.length - out.governanceEntries.length);
  } catch { /* tolerate */ }

  // ---- Blockers (open) ----
  try {
    const { data: bl } = await supabase.rpc("list_project_all_blockers", { _project_id: project.id });
    const rows = ((bl as any[]) ?? []).filter((r) => {
      const s = safeStr(r.status ?? r.lifecycle_status).toLowerCase();
      return s !== "resolved" && s !== "closed" && s !== "cancelled" && s !== "archived";
    });
    out.openBlockersCount = rows.length;
    const sorted = [...rows].sort((a, b) =>
      String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
    out.topBlockers = sorted.slice(0, MAX_BLOCKERS).map((r) => ({
      title: safeStr(r.title ?? r.summary ?? "Blocker").slice(0, 70),
      severity: safeStr(r.severity ?? r.impact ?? "") || null,
      status: safeStr(r.status ?? r.lifecycle_status ?? "") || null,
    }));
  } catch { /* tolerate */ }

  // ---- Risks (open + high-impact) ----
  try {
    const { data: rk } = await supabase.rpc("list_project_all_risks", { _project_id: project.id });
    const rows = ((rk as any[]) ?? []).filter((r) => {
      const s = safeStr(r.status ?? r.lifecycle_status).toLowerCase();
      return s !== "closed" && s !== "mitigated" && s !== "accepted_closed" && s !== "cancelled" && s !== "archived";
    });
    const isHigh = (r: any) => {
      const sev = safeStr(r.severity ?? r.impact ?? r.risk_level).toLowerCase();
      return sev === "high" || sev === "critical" || sev === "severe";
    };
    out.highImpactRisksCount = rows.filter(isHigh).length;
    const sorted = [...rows].sort((a, b) => {
      const ha = isHigh(a) ? 0 : 1, hb = isHigh(b) ? 0 : 1;
      if (ha !== hb) return ha - hb;
      return String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""));
    });
    out.topRisks = sorted.slice(0, MAX_RISKS).map((r) => ({
      title: safeStr(r.title ?? r.summary ?? "Risk").slice(0, 70),
      severity: safeStr(r.severity ?? r.impact ?? r.risk_level ?? "") || null,
      status: safeStr(r.status ?? r.lifecycle_status ?? "") || null,
    }));
  } catch { /* tolerate */ }

  return out;
}

export async function mapRoadmapAnnexData(
  supabase: SupabaseClient,
  projects: RoadmapDeckProject[],
): Promise<Map<string, AnnexProjectData>> {
  const out = new Map<string, AnnexProjectData>();
  // Sequential to keep RPC pressure modest. Projects-per-deck is bounded
  // by Roadmap UI scope and the dashboard already chunks at 9/slide.
  for (const p of projects) {
    try {
      const data = await fetchOne(supabase, p);
      out.set(p.id, data);
    } catch {
      out.set(p.id, {
        projectId: p.id, pmNames: [], ownerNames: p.ownerNames ?? [],
        progressEntries: [], progressMore: 0,
        governanceEntries: [], governanceMore: 0,
        governanceCadence: null, governanceNextExpected: null,
        openBlockersCount: 0, topBlockers: [],
        highImpactRisksCount: 0, topRisks: [],
      });
    }
  }
  return out;
}
