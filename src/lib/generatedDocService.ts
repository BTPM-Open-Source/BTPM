// SP.6b — Generated operational document client service.
// Calls the `generate-project-charter` edge function. The server generates
// the .docx, publishes it to the linked SharePoint project folder, and
// returns the SharePoint URL. No binaries are stored in BTPM/Supabase.

import { supabase } from "@/integrations/supabase/client";
import { generatedFileUserMessage } from "@/lib/generatedFileErrorMessages";

export type GeneratedDocType = "project_overview_charter";

export interface GenerateCharterResult {
  ok: true;
  filename: string;
  sharepointItemId: string | null;
  sharepointWebUrl: string | null;
  generatedAt: string;
  // Phase 6D.7D — additive Portfolio provenance.
  project_portfolio?: {
    portfolio_item_id: string | null;
    portfolio_name: string | null;
    portfolio_code: string | null;
    portfolio_lifecycle_state: string | null;
    portfolio_is_archived: boolean | null;
    portfolio_label: string | null;
  };
}

export interface GenerateCharterError {
  ok: false;
  code: string;
  message: string;
}

/**
 * Map a server error code into a clean, non-technical user message.
 * Uses the shared generatedFileUserMessage helper plus charter-specific
 * overrides that the shared map does not cover.
 */
function userMessageForCode(code: string, note: string | null): string {
  switch (code) {
    case "existing_charter_conflict":
      return "A Project Charter already exists for this project. Confirm regeneration to overwrite it.";
    case "project_not_accessible":
      return "You do not have access to this project, or it no longer exists.";
    default:
      return generatedFileUserMessage({ code, note });
  }
}

export async function generateProjectCharter(
  projectId: string,
  options: { overwriteExisting?: boolean } = {},
): Promise<GenerateCharterResult> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) {
    const err: GenerateCharterError = {
      ok: false,
      code: "not_authenticated",
      message: "You are not signed in.",
    };
    throw err;
  }

  const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  const url = `https://${projectRef}.supabase.co/functions/v1/generate-project-charter`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    },
    body: JSON.stringify({
      projectId,
      overwriteExisting: options.overwriteExisting === true,
    }),
  });

  let parsed: any = null;
  try { parsed = await res.json(); } catch { /* non-JSON */ }

  if (!res.ok || parsed?.ok === false) {
    const code = parsed?.error || `http_${res.status}`;
    const note = parsed?.note ?? null;
    const err: GenerateCharterError = {
      ok: false,
      code,
      message: userMessageForCode(code, note),
    };
    throw err;
  }

  return {
    ok: true,
    filename: parsed?.filename ?? "Project Overview.docx",
    sharepointItemId: parsed?.sharepoint_item_id ?? null,
    sharepointWebUrl: parsed?.sharepoint_web_url ?? null,
    generatedAt: parsed?.generated_at ?? new Date().toISOString(),
    project_portfolio: parsed?.project_portfolio ?? undefined,
  };
}
