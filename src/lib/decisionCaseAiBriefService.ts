/**
 * AI.5/AI.6 — Client wrapper for production Decision Case AI brief
 * generation and the AI run audit trail.
 *
 * Calls the `generate-decision-case-ai-brief` edge function (one-time
 * file input to the configured AI provider). Audit-trail reads/writes
 * go through protected RPCs (no direct table writes from the client).
 */
import { supabase } from "@/integrations/supabase/client";

export type DecisionCaseAiBriefFileStatus =
  | "sent"
  | "unsupported_file_type"
  | "file_too_large"
  | "total_size_limit_exceeded"
  | "missing_identifiers"
  | "graph_token_unavailable"
  | "download_failed"
  | "model_does_not_support_image_input";

export type DecisionCaseAiBriefInputKind = "input_file" | "input_image" | "unsupported";

export interface DecisionCaseAiBriefFileResult {
  evidence_file_id: string;
  file_name: string | null;
  attachment_alias?: string;
  status: DecisionCaseAiBriefFileStatus;
  bytes_sent?: number;
  detail?: string;
  file_extension?: string | null;
  mime_type?: string | null;
  input_kind?: DecisionCaseAiBriefInputKind | null;
}

export interface DecisionCaseAiBriefStructuredFields {
  executive_intro_text: string | null;
  options_summary: string | null;
  recommendation_text: string | null;
  requested_decision_text: string | null;
  guardrails_text: string | null;
  residual_risks_text: string | null;
  open_questions_text: string | null;
  confidence_level: "high" | "medium" | "low" | null;
  decision_readiness:
    | "ready_for_decision"
    | "needs_clarification"
    | "not_ready"
    | null;
}

export const EMPTY_STRUCTURED_BRIEF: DecisionCaseAiBriefStructuredFields = {
  executive_intro_text: null,
  options_summary: null,
  recommendation_text: null,
  requested_decision_text: null,
  guardrails_text: null,
  residual_risks_text: null,
  open_questions_text: null,
  confidence_level: null,
  decision_readiness: null,
};

export interface DecisionCaseAiBriefQueued {
  ok: true;
  status: "queued";
  model: string;
  model_source: "admin_setting";
  template_id: string;
  template_version: number;
  files_sent_count: number;
  files_skipped_count: number;
  total_bytes_sent: number;
  file_results: DecisionCaseAiBriefFileResult[];
  generated_at: string;
  require_user_confirmation?: boolean;
  ai_run_id: string;
  openai_response_id: string | null;
}

export interface DecisionCaseAiBriefSuccess {
  ok: true;
  status?: "completed";
  draft_markdown: string;
  structured_fields?: DecisionCaseAiBriefStructuredFields;
  structured_parse_failed?: boolean;
  model: string;
  model_source: "admin_setting";
  template_id: string;
  template_version: number;
  files_sent_count: number;
  files_skipped_count: number;
  total_bytes_sent: number;
  file_results: DecisionCaseAiBriefFileResult[];
  generated_at: string;
  require_user_confirmation?: boolean;
  ai_run_id: string | null;
}

export interface DecisionCaseAiBriefInProgress {
  ok: true;
  status: "in_progress";
  ai_run_id: string;
  openai_status?: string;
}

export interface DecisionCaseAiBriefError {
  ok: false;
  error: string;
  note?: string;
  file_results?: DecisionCaseAiBriefFileResult[];
  ai_run_id?: string | null;
}

export type DecisionCaseAiBriefResult =
  | DecisionCaseAiBriefQueued
  | DecisionCaseAiBriefSuccess
  | DecisionCaseAiBriefError;

export type DecisionCaseAiBriefPollResult =
  | DecisionCaseAiBriefSuccess
  | DecisionCaseAiBriefInProgress
  | DecisionCaseAiBriefError;

async function unwrapInvokeError(error: any) {
  let payload: any = null;
  try {
    const ctx = error?.context;
    if (ctx?.json) payload = await ctx.json();
    else if (ctx?.body) payload = JSON.parse(ctx.body);
  } catch { /* ignore */ }
  return payload;
}

export async function generateDecisionCaseAiBrief(
  recordId: string,
): Promise<DecisionCaseAiBriefResult> {
  const { data, error } = await supabase.functions.invoke(
    "generate-decision-case-ai-brief",
    { body: { recordId } },
  );
  if (error) {
    const payload = await unwrapInvokeError(error);
    return {
      ok: false,
      error: payload?.error ?? "generation_failed",
      note: payload?.note ?? error.message,
      file_results: payload?.file_results,
      ai_run_id: payload?.ai_run_id ?? null,
    };
  }
  return data as DecisionCaseAiBriefResult;
}

export async function pollDecisionCaseAiBrief(
  aiRunId: string,
): Promise<DecisionCaseAiBriefPollResult> {
  const { data, error } = await supabase.functions.invoke(
    "poll-decision-case-ai-brief",
    { body: { aiRunId } },
  );
  if (error) {
    const payload = await unwrapInvokeError(error);
    return {
      ok: false,
      error: payload?.error ?? "generation_failed",
      note: payload?.note ?? error.message,
      ai_run_id: payload?.ai_run_id ?? aiRunId,
    };
  }
  return data as DecisionCaseAiBriefPollResult;
}

export async function runDecisionCaseAiBriefWithPolling(
  recordId: string,
  opts?: {
    onQueued?: (queued: DecisionCaseAiBriefQueued) => void;
    onProgress?: (elapsedMs: number) => void;
    pollIntervalMs?: number;
    maxWaitMs?: number;
    signal?: AbortSignal;
  },
): Promise<DecisionCaseAiBriefSuccess | DecisionCaseAiBriefError> {
  const intervalMs = opts?.pollIntervalMs ?? 4000;
  const maxWaitMs = opts?.maxWaitMs ?? 15 * 60 * 1000;

  const start = await generateDecisionCaseAiBrief(recordId);
  if (start.ok !== true) return start;
  if ((start as any).status !== "queued") {
    return start as DecisionCaseAiBriefSuccess;
  }
  const queued = start as DecisionCaseAiBriefQueued;
  opts?.onQueued?.(queued);

  const startedAt = Date.now();
  while (true) {
    if (opts?.signal?.aborted) {
      return { ok: false, error: "aborted", ai_run_id: queued.ai_run_id };
    }
    await new Promise((r) => setTimeout(r, intervalMs));
    opts?.onProgress?.(Date.now() - startedAt);

    const poll = await pollDecisionCaseAiBrief(queued.ai_run_id);
    if (poll.ok !== true) return poll;
    if (poll.status === "in_progress") {
      if (Date.now() - startedAt > maxWaitMs) {
        return {
          ok: false,
          error: "generation_timeout",
          note: "AI brief generation took longer than the polling window.",
          ai_run_id: queued.ai_run_id,
        };
      }
      continue;
    }
    return poll as DecisionCaseAiBriefSuccess;
  }
}

export function mapDecisionCaseAiBriefError(code: string): string {
  switch (code) {
    case "unauthorized":
      return "You do not have permission to generate an AI decision brief on this Decision Case.";
    case "not_decision_case":
      return "AI decision briefs are only available for decision cases.";
    case "decision_case_ai_disabled":
      return "Decision Cases AI is disabled in Admin AI Settings.";
    case "decision_case_ai_not_configured":
      return "Decision Cases AI is not configured correctly. Ask an admin to review AI Settings.";
    case "decision_case_ai_model_does_not_support_file_input":
      return "The configured Decision Cases model cannot read attached files. Ask an admin to select a file-capable model.";
    case "decision_brief_template_not_configured":
      return "The Decision Brief Assistant template is not configured. Ask an admin to review AI Settings.";
    case "openai_not_configured":
      return "The OpenAI Tenant integration is not configured or is incomplete.";
    case "openai_access_blocked":
      return "OpenAI access is not allowed for this Organization or environment.";
    case "openai_configuration_unavailable":
      return "OpenAI configuration is temporarily unavailable. Try again later.";
    case "no_selected_sharepoint_evidence_files":
      return "Select at least one SharePoint evidence file and mark it as included before generating.";
    case "no_supported_evidence_files_to_send":
      return "None of the included evidence files could be sent (unsupported type, too large, or download failed).";
    case "graph_download_failed":
      return "Could not download evidence files from SharePoint.";
    case "openai_request_failed":
      return "The AI provider could not process this request.";
    case "payload_too_large":
      return "The selected evidence files exceed the configured total size limit.";
    case "generation_timeout":
      return "The AI brief is taking longer than expected. Check the AI history shortly — it may still finish.";
    case "aborted":
      return "AI brief generation was cancelled.";
    default:
      return "Could not generate the AI decision brief.";
  }
}

// ---- AI.6 audit-trail RPC wrappers ----------------------------------

export interface DecisionCaseAiRun {
  id: string;
  status: "started" | "completed" | "failed" | "saved" | "discarded";
  run_type: string;
  model_provider: string;
  model_id: string;
  model_source: string;
  reasoning_effort: string | null;
  template_id: string | null;
  template_version: number | null;
  files_selected_count: number;
  files_sent_count: number;
  files_skipped_count: number;
  total_bytes_sent: number;
  error_code: string | null;
  brief_version_id: string | null;
  started_by: string | null;
  started_by_display: string | null;
  started_at: string;
  completed_at: string | null;
  saved_at: string | null;
  discarded_at: string | null;
}

export async function listDecisionCaseAiRuns(
  recordId: string,
): Promise<DecisionCaseAiRun[]> {
  const { data, error } = await supabase.rpc(
    "list_decision_case_ai_runs",
    { _record_id: recordId },
  );
  if (error) throw error;
  return (data as unknown as DecisionCaseAiRun[] | null) ?? [];
}

export async function saveAiDecisionBriefVersion(args: {
  recordId: string;
  aiRunId: string;
  editedBriefText: string;
  makeCurrent?: boolean;
  structuredFields?: Partial<DecisionCaseAiBriefStructuredFields> | null;
}): Promise<{ brief_version_id: string; version_number: number; ai_run_id: string }> {
  const sf = args.structuredFields ?? {};
  // AI.8.1a — route through v3 so executive_intro_text and options_summary persist.
  const { data, error } = await supabase.rpc(
    "save_decision_brief_version_v3" as any,
    {
      _record_id: args.recordId,
      _source_type: "btpm_generated",
      _edited_brief_text: args.editedBriefText,
      _make_current: args.makeCurrent ?? true,
      _ai_run_id: args.aiRunId,
      _executive_intro_text: sf.executive_intro_text ?? null,
      _options_summary: sf.options_summary ?? null,
      _requested_decision_text: sf.requested_decision_text ?? null,
      _recommendation_text: sf.recommendation_text ?? null,
      _guardrails_text: sf.guardrails_text ?? null,
      _residual_risks_text: sf.residual_risks_text ?? null,
      _open_questions_text: sf.open_questions_text ?? null,
      _confidence_level: sf.confidence_level ?? null,
      _decision_readiness: sf.decision_readiness ?? null,
    } as any,
  );
  if (error) throw error;
  return data as { brief_version_id: string; version_number: number; ai_run_id: string };
}

export async function saveManualDecisionBriefVersion(args: {
  recordId: string;
  editedBriefText?: string | null;
  makeCurrent?: boolean;
  fields: Partial<DecisionCaseAiBriefStructuredFields>;
}): Promise<{ brief_version_id: string; version_number: number }> {
  const f = args.fields;
  const { data, error } = await supabase.rpc(
    "save_decision_brief_version_v3" as any,
    {
      _record_id: args.recordId,
      _source_type: "manual_edit",
      _edited_brief_text: args.editedBriefText ?? null,
      _make_current: args.makeCurrent ?? true,
      _ai_run_id: null,
      _executive_intro_text: f.executive_intro_text ?? null,
      _options_summary: f.options_summary ?? null,
      _requested_decision_text: f.requested_decision_text ?? null,
      _recommendation_text: f.recommendation_text ?? null,
      _guardrails_text: f.guardrails_text ?? null,
      _residual_risks_text: f.residual_risks_text ?? null,
      _open_questions_text: f.open_questions_text ?? null,
      _confidence_level: f.confidence_level ?? null,
      _decision_readiness: f.decision_readiness ?? null,
    } as any,
  );
  if (error) throw error;
  return data as { brief_version_id: string; version_number: number };
}


export async function discardDecisionCaseAiRun(aiRunId: string): Promise<void> {
  const { error } = await supabase.rpc(
    "mark_decision_case_ai_run_discarded",
    { _ai_run_id: aiRunId },
  );
  if (error) throw error;
}
