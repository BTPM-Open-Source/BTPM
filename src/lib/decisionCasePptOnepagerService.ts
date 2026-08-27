// DC.11 — Decision Case PowerPoint one-pager client service.
// Calls the `generate-decision-case-ppt-onepager` edge function.

import { supabase } from "@/integrations/supabase/client";
import { generatedFileUserMessage } from "@/lib/generatedFileErrorMessages";

export interface GenerateOnepagerResult {
  ok: true;
  filename: string;
  sharepointItemId: string | null;
  sharepointWebUrl: string | null;
  generatedAt: string;
  sourceSnapshotAt: string;
  packageVersionNumber: number;
  outcomeIncluded: boolean;
}

export interface GenerateOnepagerError {
  ok: false;
  code: string;
  message: string;
  existing?: {
    generated_at: string;
    output_filename: string;
    sharepoint_web_url: string | null;
  } | null;
}

function userMessageForCode(code: string, note: string | null): string {
  switch (code) {
    case "existing_onepager_conflict":
      return "A Decision Brief one-pager already exists for this decision case. Confirm regeneration to overwrite it.";
    case "stakeholder_package_missing":
      return "Create a stakeholder package before generating the PowerPoint Decision Brief.";
    case "not_decision_case":
      return "PowerPoint one-pagers are only available for decision cases.";
    case "record_not_found":
      return "This decision case no longer exists.";
    default:
      return generatedFileUserMessage({ code, note });
  }
}

export async function generateDecisionCasePptOnepager(
  recordId: string,
  options: { overwriteExisting?: boolean } = {},
): Promise<GenerateOnepagerResult> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) {
    const err: GenerateOnepagerError = {
      ok: false,
      code: "not_authenticated",
      message: "You are not signed in.",
    };
    throw err;
  }

  const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  const url = `https://${projectRef}.supabase.co/functions/v1/generate-decision-case-ppt-onepager`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    },
    body: JSON.stringify({
      recordId,
      overwriteExisting: options.overwriteExisting === true,
    }),
  });

  let parsed: any = null;
  try {
    parsed = await res.json();
  } catch {
    /* non-JSON */
  }

  if (!res.ok || parsed?.ok === false) {
    const code = parsed?.error || `http_${res.status}`;
    const note = parsed?.note ?? null;
    const err: GenerateOnepagerError = {
      ok: false,
      code,
      message: userMessageForCode(code, note),
      existing: parsed?.existing ?? null,
    };
    throw err;
  }

  return {
    ok: true,
    filename: parsed?.filename ?? "Decision Brief One-pager.pptx",
    sharepointItemId: parsed?.sharepoint_item_id ?? null,
    sharepointWebUrl: parsed?.sharepoint_web_url ?? null,
    generatedAt: parsed?.generated_at ?? new Date().toISOString(),
    sourceSnapshotAt: parsed?.source_snapshot_at ?? parsed?.generated_at ?? new Date().toISOString(),
    packageVersionNumber: Number(parsed?.package_version_number ?? 1),
    outcomeIncluded: parsed?.outcome_included === true,
  };
}
