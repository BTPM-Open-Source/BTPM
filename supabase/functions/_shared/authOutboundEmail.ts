// Auth-flow outbound email helper.
//
// Phase 4D.14A.7H finalization: this helper is now an Organization-scoped
// Tenant SMTP wrapper. Every auth-adjacent email sent through `sendAuthEmail`
// requires a resolved Organization context and is delivered through
// `sendTenantEmail`. There is no Graph fallback and no platform fallback —
// callers that legitimately lack an Organization (e.g. password recovery for
// an ambiguous account) must route through Supabase Auth's native mail path
// directly, not through this helper.
//
// The helper does not:
//   - read Graph or SMTP credentials
//   - query Tenant / Organization context itself
//   - invoke Supabase Auth mail
//   - return raw provider errors

import {
  sendTenantEmail,
  type SendTenantEmailResult,
  type SendTenantEmailStatus,
} from "./tenantOutboundEmail.ts";

export interface SendAuthEmailInput {
  organizationId: string;
  recipientEmail: string;
  recipientUserId?: string | null;
  emailType: string;
  eventKey: string;
  subject: string;
  htmlBody: string;
  functionName: string;
  reason?: string;
}

export interface SendAuthEmailResult {
  ok: boolean;
  transport: "tenant_smtp";
  status: SendTenantEmailStatus;
  errorCode: string | null;
  errorMessage: string | null;
}

/**
 * Send an auth-adjacent email through the Organization's Tenant SMTP
 * integration. Requires a resolved `organizationId`. Tenant SMTP outcomes
 * (disabled, incomplete, environment-blocked, provider error) are surfaced
 * as safe error codes/messages — this helper never falls back to another
 * transport.
 */
export async function sendAuthEmail(
  input: SendAuthEmailInput,
): Promise<SendAuthEmailResult> {
  if (!input.organizationId || typeof input.organizationId !== "string") {
    return {
      ok: false,
      transport: "tenant_smtp",
      status: "failed_configuration",
      errorCode: "organization_context_missing",
      errorMessage: "Organization context is required for auth email.",
    };
  }

  const result: SendTenantEmailResult = await sendTenantEmail({
    organizationId: input.organizationId,
    recipientEmail: input.recipientEmail,
    recipientUserId: input.recipientUserId ?? null,
    emailType: input.emailType,
    eventKey: input.eventKey,
    subject: input.subject,
    htmlBody: input.htmlBody,
    reason: input.reason ?? input.functionName,
    functionName: input.functionName,
  });

  return {
    ok: result.status === "sent",
    transport: "tenant_smtp",
    status: result.status,
    errorCode: result.errorCode,
    errorMessage: result.safeErrorMessage,
  };
}
