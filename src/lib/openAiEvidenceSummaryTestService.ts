/**
 * AI.3 — Client wrapper for the admin-only Decision Case evidence reading
 * diagnostic. Calls the Edge Function; never calls the configured AI
 * provider directly.
 *
 * The internal service name is kept for now to avoid churn; user-facing
 * labels are product/outcome-oriented (no "Send to OpenAI" wording).
 */
import { supabase } from "@/integrations/supabase/client";

export type OpenAiEvidenceFileResultStatus =
  | "sent"
  | "unsupported_file_type"
  | "file_too_large"
  | "total_size_limit_exceeded"
  | "missing_identifiers"
  | "graph_token_unavailable"
  | "download_failed"
  | "model_does_not_support_image_input";

export type OpenAiEvidenceInputKind = "input_file" | "input_image" | "unsupported";

export interface OpenAiEvidenceFileResult {
  evidence_file_id: string;
  file_name: string | null;
  status: OpenAiEvidenceFileResultStatus;
  bytes_sent?: number;
  detail?: string;
  file_extension?: string | null;
  mime_type?: string | null;
  input_kind?: OpenAiEvidenceInputKind | null;
}

export interface OpenAiEvidenceSummaryTestResult {
  ok: true;
  model: string;
  provider?: "openai" | "azure_openai";
  model_source: "admin_setting";
  files_sent_count: number;
  files_skipped_count: number;
  total_bytes_sent: number;
  summary_text: string;
  file_results: OpenAiEvidenceFileResult[];
  generated_at: string;
  require_user_confirmation: boolean;
}

/** Backwards-compat alias preferred by AI.3 wording. */
export type DecisionCaseEvidenceDiagnosticResult = OpenAiEvidenceSummaryTestResult;

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * Extracts a governance record UUID from either a raw UUID or a Decision
 * Case URL containing one. Returns null when none found.
 */
export function extractDecisionCaseRecordId(input: string): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const m = trimmed.match(UUID_RE);
  if (!m) return null;
  // If multiple UUIDs (e.g. workspace/project/record), take the last —
  // governance record id is the deepest segment of the canonical URL.
  const all = trimmed.match(new RegExp(UUID_RE, "gi"));
  return (all && all[all.length - 1]) || m[0];
}

export async function runDecisionCaseEvidenceReadingDiagnostic(
  recordId: string,
): Promise<OpenAiEvidenceSummaryTestResult> {
  const { data, error } = await supabase.functions.invoke(
    "test-openai-decision-evidence-summary",
    { body: { recordId } },
  );

  if (error) {
    let payload: any = null;
    try {
      const ctx = (error as any).context;
      if (ctx?.json) payload = await ctx.json();
      else if (ctx?.body) payload = JSON.parse(ctx.body);
    } catch { /* ignore */ }
    throw new Error(mapErr(payload?.error, payload?.note ?? error.message));
  }

  const payload = data as any;
  if (!payload?.ok) {
    throw new Error(mapErr(payload?.error, payload?.note));
  }
  return payload as OpenAiEvidenceSummaryTestResult;
}

/** Legacy export kept so existing imports (if any) continue to work. */
export const testOpenAiDecisionEvidenceSummary = runDecisionCaseEvidenceReadingDiagnostic;

function mapErr(code: string | undefined, note?: string | undefined): string {
  switch (code) {
    case "ai_provider_not_selected":
      return "No AI provider is selected for this Tenant. Select OpenAI or Azure OpenAI in Admin AI Settings.";
    case "ai_provider_configuration_unavailable":
      return "AI provider configuration is temporarily unavailable. Try again later.";
    case "ai_model_mapping_missing":
      return "The selected AI model is not mapped for the active provider.";
    case "openai_not_configured":
      return "The OpenAI Tenant integration is not configured or is incomplete.";
    case "openai_access_blocked":
      return "OpenAI access is not allowed for this Organization or environment.";
    case "openai_configuration_unavailable":
      return "OpenAI configuration is temporarily unavailable. Try again later.";
    case "azure_openai_not_configured":
      return "The Azure OpenAI Tenant integration is not configured or is incomplete.";
    case "azure_openai_access_blocked":
      return "Azure OpenAI access is not allowed for this Organization or environment.";
    case "azure_openai_configuration_unavailable":
      return "Azure OpenAI configuration is temporarily unavailable. Try again later.";
    case "decision_case_ai_disabled":
      return "Decision Cases AI is disabled in Admin AI Settings.";
    case "decision_case_ai_not_configured":
      return "Decision Cases AI is not configured. Select a model and enable it in Admin AI Settings.";
    case "no_selected_sharepoint_evidence_files":
      return "No SharePoint evidence files are marked as included for this decision case.";
    case "no_supported_files_to_send":
      return "None of the selected evidence files could be sent (unsupported type, too large, or download failed).";
    case "graph_download_failed":
      return "Failed to download evidence files from SharePoint.";
    case "openai_request_failed":
      return note ? `Evidence reading request failed: ${note}` : "Evidence reading request failed.";
    case "credential_rejected":
    case "permission_denied":
    case "endpoint_not_found":
    case "rate_limited":
    case "timeout":
    case "network_error":
    case "service_unavailable":
    case "request_rejected":
    case "response_invalid":
      return "The configured AI provider request did not complete. Try again later.";
    case "payload_too_large":
      return "Selected files exceed the configured size limit.";
    case "not_admin":
      return "Only organization admins can run this diagnostic.";
    case "not_decision_case":
      return "This diagnostic is only available for decision cases.";
    case "record_not_found":
      return "Decision Case not found.";
    case "invalid_request":
      return "Provide a valid Decision Case URL or governance record ID.";
    default:
      return note || "Could not run the Decision Case evidence reading diagnostic.";
  }
}
