// Phase 4D.11 — Tenant-scoped outbound email transport with gate/dedupe/audit.
//
// Pipeline:
//   1. Resolve tenant SMTP runtime config (also enforces outbound_email gate).
//   2. Duplicate-suppression check by (tenant_id, event_key, recipient_email)
//      within a short window.
//   3. Send via SMTP (nodemailer).
//   4. Record outbound_email_events row (sent / failed_provider / skipped_*).
//
// Never logs secret values, Vault IDs, or fingerprints. All errors returned
// to the caller are safe strings; underlying provider errors are truncated.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "npm:@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6.9.14";
import {
  resolveTenantSmtpRuntimeConfig,
  TenantSmtpError,
} from "./tenantSmtp.ts";

const DEFAULT_DEDUPE_WINDOW_SECONDS = 300;

function requireEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function serviceClient() {
  return createClient(
    requireEnv("SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export interface SendTenantEmailInput {
  organizationId: string;
  workspaceId?: string | null;
  projectId?: string | null;
  taskId?: string | null;
  recipientUserId?: string | null;
  recipientEmail: string;
  emailType: string;   // e.g. 'test_email', 'object_context'
  eventKey: string;    // e.g. 'test_email:<org>:<email>', 'object_context:task:<id>:<recipient>'
  subject: string;
  htmlBody: string;
  dedupeWindowSeconds?: number;
  metadata?: Record<string, unknown>;
  reason?: string;
  functionName?: string;
  requestId?: string;
}

export type SendTenantEmailStatus =
  | "sent"
  | "skipped_duplicate"
  | "skipped_non_production"
  | "failed_configuration"
  | "failed_provider";

export interface SendTenantEmailResult {
  status: SendTenantEmailStatus;
  eventId: string | null;
  providerMessageId: string | null;
  errorCode: string | null;
  safeErrorMessage: string | null;
}

async function recordEvent(
  tenantId: string | null,
  input: SendTenantEmailInput,
  status: SendTenantEmailStatus,
  extras: {
    providerMessageId?: string | null;
    errorCode?: string | null;
    safeErrorMessage?: string | null;
  } = {},
): Promise<string | null> {
  if (!tenantId) return null;
  const supabase = serviceClient();
  const { data, error } = await supabase.rpc("record_outbound_email_event", {
    _tenant_id: tenantId,
    _organization_id: input.organizationId,
    _workspace_id: input.workspaceId ?? null,
    _project_id: input.projectId ?? null,
    _task_id: input.taskId ?? null,
    _recipient_user_id: input.recipientUserId ?? null,
    _recipient_email: input.recipientEmail,
    _email_type: input.emailType,
    _event_key: input.eventKey,
    _status: status,
    _provider_message_id: extras.providerMessageId ?? null,
    _error_code: extras.errorCode ?? null,
    _safe_error_message: extras.safeErrorMessage ?? null,
    _metadata: input.metadata ?? {},
  });
  if (error) {
    console.error("record_outbound_email_event failed:", error.message);
    return null;
  }
  return (data as string) ?? null;
}

/**
 * Send a tenant-scoped outbound email through the full BTPM pipeline.
 * Returns a structured result — never throws for expected skip/failure paths.
 */
export async function sendTenantEmail(
  input: SendTenantEmailInput,
): Promise<SendTenantEmailResult> {
  const supabase = serviceClient();

  // Resolve tenant early via organization for audit rows on gate-block.
  let tenantIdForAudit: string | null = null;
  try {
    const { data: org } = await supabase
      .from("organizations")
      .select("tenant_id")
      .eq("id", input.organizationId)
      .maybeSingle();
    tenantIdForAudit = (org?.tenant_id as string) ?? null;
  } catch { /* ignore */ }

  // 1. Resolve SMTP config (this also runs the outbound_email gate).
  let cfg;
  try {
    cfg = await resolveTenantSmtpRuntimeConfig({
      organizationId: input.organizationId,
      reason: input.reason,
      functionName: input.functionName,
      requestId: input.requestId,
    });
  } catch (err: any) {
    if (err instanceof TenantSmtpError) {
      const status: SendTenantEmailStatus =
        err.code === "outbound_email_blocked"
          ? "skipped_non_production"
          : "failed_configuration";
      const eventId = await recordEvent(tenantIdForAudit, input, status, {
        errorCode: err.code,
        safeErrorMessage: err.message,
      });
      return {
        status,
        eventId,
        providerMessageId: null,
        errorCode: err.code,
        safeErrorMessage: err.message,
      };
    }
    throw err;
  }

  // 2. Duplicate suppression.
  const windowSec = input.dedupeWindowSeconds ?? DEFAULT_DEDUPE_WINDOW_SECONDS;
  try {
    const { data: isDup } = await supabase.rpc(
      "check_outbound_email_recent_duplicate",
      {
        _tenant_id: cfg.tenantId,
        _event_key: input.eventKey,
        _recipient_email: input.recipientEmail,
        _window_seconds: windowSec,
      },
    );
    if (isDup === true) {
      const eventId = await recordEvent(cfg.tenantId, input, "skipped_duplicate");
      return {
        status: "skipped_duplicate",
        eventId,
        providerMessageId: null,
        errorCode: "duplicate",
        safeErrorMessage: `Duplicate suppressed (window ${windowSec}s).`,
      };
    }
  } catch (e: any) {
    console.warn("dedupe check failed (non-fatal):", e?.message || e);
  }

  // 3. Send via SMTP.
  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 465,
    auth: cfg.username
      ? { user: cfg.username, pass: cfg.password }
      : undefined,
  });

  const fromHeader = cfg.fromName
    ? `"${cfg.fromName.replace(/"/g, "'")}" <${cfg.fromEmail}>`
    : cfg.fromEmail;

  try {
    const info = await transporter.sendMail({
      from: fromHeader,
      to: input.recipientEmail,
      subject: input.subject,
      html: input.htmlBody,
    });
    const providerMessageId = (info as any)?.messageId ?? null;
    const eventId = await recordEvent(cfg.tenantId, input, "sent", {
      providerMessageId,
    });
    return {
      status: "sent",
      eventId,
      providerMessageId,
      errorCode: null,
      safeErrorMessage: null,
    };
  } catch (e: any) {
    // Truncate provider error; never include credentials.
    const safeMsg = String(e?.message ?? "SMTP send failed").slice(0, 300);
    console.error("SMTP send failed:", safeMsg);
    const eventId = await recordEvent(cfg.tenantId, input, "failed_provider", {
      errorCode: "provider_error",
      safeErrorMessage: safeMsg,
    });
    return {
      status: "failed_provider",
      eventId,
      providerMessageId: null,
      errorCode: "provider_error",
      safeErrorMessage: safeMsg,
    };
  }
}
