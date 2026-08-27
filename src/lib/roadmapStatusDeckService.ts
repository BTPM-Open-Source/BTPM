// RM-PPT-2 — Client wrapper for the Roadmap Status Deck Edge Function.
// Source-of-truth: backend `generate-roadmap-status-deck` Edge Function and
// `generated_operational_documents` history. No local deck data stored.

import { supabase } from "@/integrations/supabase/client";
import { generatedFileUserMessage } from "@/lib/generatedFileErrorMessages";

export interface RoadmapDeckResult {
  ok: boolean;
  filename?: string;
  sharepoint_item_id?: string;
  sharepoint_web_url?: string;
  generated_at?: string;
  slide_count?: number;
  warnings?: string[];
  stages?: Record<string, boolean>;
  error?: string;
  note?: string;
  // Phase 6D.7B — additive Portfolio scope provenance.
  portfolio_scope?: {
    portfolio_item_ids: string[];
    include_no_portfolio: boolean;
    portfolio_count: number;
    portfolio_labels: string[];
    no_portfolio_project_count: number;
  };
}

export interface RoadmapDeckRequest {
  // Project-first scope: the exact list of projects visible in the
  // Roadmap result set after workspace/program/project filters have been
  // applied. The Edge Function re-validates per-project read access.
  projectIds: string[];
  calendarMode: "year" | "month";
  calendarStart?: string | null;
  calendarEnd?: string | null;
  // Phase 6D.7B — canonical Portfolio scope. Never contains "__none__".
  roadmapFilters?: {
    portfolio_item_ids?: string[];
    include_no_portfolio?: boolean;
  };
}

export async function generateRoadmapStatusDeck(
  req: RoadmapDeckRequest,
): Promise<RoadmapDeckResult> {
  const body: Record<string, unknown> = {
    projectIds: req.projectIds,
    calendarMode: req.calendarMode,
    calendarStart: req.calendarStart ?? null,
    calendarEnd: req.calendarEnd ?? null,
  };
  // Phase 6D.7B — canonical Portfolio scope. Sentinels are stripped
  // upstream; here we only forward real UUIDs and the boolean flag.
  const pfIds = (req.roadmapFilters?.portfolio_item_ids ?? [])
    .filter((x): x is string => typeof x === "string" && x.length > 0 && x !== "__none__");
  const includeNoPortfolio = req.roadmapFilters?.include_no_portfolio === true;
  if (pfIds.length > 0 || includeNoPortfolio) {
    body.roadmapFilters = {
      portfolio_item_ids: pfIds.length > 0 ? pfIds : undefined,
      include_no_portfolio: includeNoPortfolio,
    };
  }

  const { data, error } = await supabase.functions.invoke(
    "generate-roadmap-status-deck",
    { body },
  );
  if (error) {
    let payload: any = null;
    try {
      const ctx = (error as any).context;
      if (ctx?.json) payload = await ctx.json();
      else if (ctx?.body) payload = JSON.parse(ctx.body);
    } catch { /* ignore */ }
    if (payload && typeof payload === "object") return payload as RoadmapDeckResult;
    return { ok: false, error: error.message };
  }
  return data as RoadmapDeckResult;
}

export function mapRoadmapDeckError(result: RoadmapDeckResult): string {
  const code = result.error ?? "unknown_error";
  // Roadmap-specific overrides not covered by the shared helper.
  const overrides: Record<string, string> = {
    no_projects_in_scope:
      "There are no visible projects in the current Roadmap filters. Adjust filters and try again.",
    not_authorized_for_project_scope:
      "You don't have read access to one or more projects in the current Roadmap scope.",
    library_resolve_failed: "Could not resolve the workspace SharePoint library.",
  };
  if (overrides[code]) return overrides[code];
  return generatedFileUserMessage({ code, note: result.note ?? null });
}
