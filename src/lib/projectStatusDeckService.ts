// PPT v1 — Client wrapper for the weekly status deck Edge Function.
// No production UI in this step (per PPT-1 scope). This wrapper exists so
// PPT-2 can wire the visible button without further service refactoring.

import { supabase } from "@/integrations/supabase/client";

export interface StatusDeckStages {
  auth_ok: boolean;
  authority_ok: boolean;
  workspace_binding_ok: boolean;
  project_binding_ok: boolean;
  data_collected_ok: boolean;
  graph_token_ok: boolean;
  folder_resolved_ok: boolean;
  pptx_generated_ok: boolean;
  upload_ok: boolean;
  history_recorded_ok: boolean;
}

export interface StatusDeckResult {
  ok: boolean;
  filename?: string;
  sharepoint_item_id?: string;
  sharepoint_web_url?: string;
  generated_at?: string;
  period_start?: string;
  period_end?: string;
  slide_count?: number;
  warnings?: string[];
  stages?: StatusDeckStages;
  error?: string;
  note?: string;
  // Phase 6D.7C — additive Portfolio provenance for the single-project deck.
  project_portfolio?: {
    portfolio_item_id: string | null;
    portfolio_name: string | null;
    portfolio_code: string | null;
    portfolio_lifecycle_state: string | null;
    portfolio_is_archived: boolean | null;
    portfolio_label: string | null;
  };
}

export async function generateProjectStatusDeck(
  projectId: string,
  opts?: { periodStart?: string; periodEnd?: string },
): Promise<StatusDeckResult> {
  const { data, error } = await supabase.functions.invoke(
    "generate-project-status-deck",
    {
      body: {
        projectId,
        periodStart: opts?.periodStart ?? null,
        periodEnd: opts?.periodEnd ?? null,
      },
    },
  );
  if (error) {
    let payload: any = null;
    try {
      const ctx = (error as any).context;
      if (ctx?.json) payload = await ctx.json();
      else if (ctx?.body) payload = JSON.parse(ctx.body);
    } catch { /* ignore */ }
    if (payload && typeof payload === "object") return payload as StatusDeckResult;
    return { ok: false, error: error.message };
  }
  return data as StatusDeckResult;
}
