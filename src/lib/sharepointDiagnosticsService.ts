/**
 * SP.3b — TEMPORARY admin-only diagnostics for workspace SharePoint binding.
 *
 * Calls the `diagnose_workspace_binding` action on the existing
 * sharepoint-validate edge function. App-only Microsoft Graph runs server-side.
 * No tokens or secrets are returned to the client.
 */

import { supabase } from "@/integrations/supabase/client";

export interface DiagnosticStage {
  name: string;
  ok: boolean;
  category: string;
  details: Record<string, unknown>;
}

export interface DiagnosticsResult {
  overall_category: string;
  is_app_only: boolean | null;
  stages: DiagnosticStage[];
}

export async function diagnoseWorkspaceBinding(
  bindingId: string,
): Promise<DiagnosticsResult> {
  const { data, error } = await supabase.functions.invoke("sharepoint-validate", {
    body: { action: "diagnose_workspace_binding", binding_id: bindingId },
  });
  if (error) throw new Error(error.message);
  return (data as { diagnostics: DiagnosticsResult }).diagnostics;
}
