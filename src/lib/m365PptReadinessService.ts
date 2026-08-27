// Diagnostic-only client wrapper for m365-ppt-readiness-check.
// Narrow on purpose — do not expand into a generic PPT service.
//
// Phase 4D.14A.7G — Frontend safety hardening. This wrapper only returns
// the backend readiness payload when its shape matches the expected
// contract. Any transport/library failure surfaces a single safe
// message; raw FunctionsHttpError details, response URLs, or arbitrary
// exception text are never propagated to the UI.

import { supabase } from "@/integrations/supabase/client";

export interface PptReadinessStages {
  auth_ok: boolean;
  authority_ok: boolean;
  workspace_binding_ok: boolean;
  project_binding_ok: boolean;
  graph_token_ok: boolean;
  folder_resolved_ok: boolean;
  pptx_generated_ok: boolean;
  upload_ok: boolean;
}

export interface PptReadinessResult {
  ok: boolean;
  filename?: string;
  sharepoint_item_id?: string;
  sharepoint_web_url?: string;
  generated_at?: string;
  stages?: PptReadinessStages;
  error?: string;
  note?: string;
}

export const PPT_READINESS_UNAVAILABLE_MESSAGE =
  "PPT readiness checking is temporarily unavailable.";

function looksLikeReadinessResult(v: unknown): v is PptReadinessResult {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.ok === "boolean";
}

async function readErrorPayload(error: unknown): Promise<unknown> {
  try {
    // deno-lint-ignore no-explicit-any
    const ctx = (error as any)?.context;
    if (ctx?.json) return await ctx.json();
    if (ctx?.body) return JSON.parse(ctx.body);
  } catch { /* ignore */ }
  return null;
}

export async function runM365PptReadinessCheck(
  projectId: string,
): Promise<PptReadinessResult> {
  try {
    const { data, error } = await supabase.functions.invoke(
      "m365-ppt-readiness-check",
      { body: { projectId } },
    );
    if (error) {
      const payload = await readErrorPayload(error);
      if (looksLikeReadinessResult(payload)) return payload;
      return { ok: false, error: "unavailable", note: PPT_READINESS_UNAVAILABLE_MESSAGE };
    }
    if (looksLikeReadinessResult(data)) return data;
    return { ok: false, error: "unavailable", note: PPT_READINESS_UNAVAILABLE_MESSAGE };
  } catch {
    return { ok: false, error: "unavailable", note: PPT_READINESS_UNAVAILABLE_MESSAGE };
  }
}
