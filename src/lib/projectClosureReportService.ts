// Phase 6C.FILE-R1a — Client service for generate-project-closure-report.
//
// SharePoint-publish version. Mirrors the Project Charter service contract:
//   - authenticates via the current Supabase session,
//   - POSTs to /functions/v1/generate-project-closure-report,
//   - parses JSON metadata (filename + SharePoint URL/item id),
//   - the caller (card) refreshes latest history and offers "Open existing".
//
// No browser-download-only success path. The Edge Function publishes the
// .docx to the project's SharePoint folder and records the SharePoint URL
// in generated_operational_documents via
// record_generated_operational_document. This client MUST NOT insert
// history rows directly and MUST NOT persist the .docx bytes in BTPM.

import { supabase } from "@/integrations/supabase/client";

export interface GenerateClosureReportResult {
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

export interface GenerateClosureReportError {
  ok: false;
  code: string;
  message: string;
}

function friendlyMessage(code: string, note: string | null): string {
  switch (code) {
    case "not_authenticated":
      return "You are not signed in.";
    case "not_authorized":
      return "You do not have authority to generate the Project Closure Report for this project.";
    case "project_not_accessible":
      return "You do not have access to this project, or it no longer exists.";
    case "workspace_library_missing":
    case "workspace_library_not_validated":
      return "This workspace is not linked to a validated SharePoint library. Configure the workspace SharePoint library first.";
    case "project_folder_missing":
    case "project_folder_disabled":
    case "project_folder_not_validated":
      return "Project SharePoint folder is not linked or validated. Link and validate the project folder before generating the Closure Report.";
    case "generation_failed":
      return note || "Could not build the Project Closure Report document.";
    default:
      return note || "Could not generate the Project Closure Report.";
  }
}

export async function generateProjectClosureReport(
  projectId: string,
): Promise<GenerateClosureReportResult> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) {
    const err: GenerateClosureReportError = {
      ok: false,
      code: "not_authenticated",
      message: friendlyMessage("not_authenticated", null),
    };
    throw err;
  }

  const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  const url =
    `https://${projectRef}.supabase.co/functions/v1/generate-project-closure-report`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    },
    body: JSON.stringify({ projectId }),
  });

  let parsed: any = null;
  try {
    parsed = await res.json();
  } catch {
    /* non-JSON */
  }

  if (!res.ok) {
    const code = parsed?.error || `http_${res.status}`;
    const note = parsed?.note ?? null;
    const err: GenerateClosureReportError = {
      ok: false,
      code,
      message: friendlyMessage(code, note),
    };
    throw err;
  }

  return {
    ok: true,
    filename: parsed?.filename ?? "Project Closure Report.docx",
    sharepointItemId: parsed?.sharepoint_item_id ?? null,
    sharepointWebUrl: parsed?.sharepoint_web_url ?? null,
    generatedAt: parsed?.generated_at ?? new Date().toISOString(),
    project_portfolio: parsed?.project_portfolio ?? undefined,
  };
}
