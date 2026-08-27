// Phase 4D.11A — /send-test-email hardened.
//
// Backend authentication + authorization:
//   - Requires Authorization: Bearer <jwt>.
//   - Resolves authenticated user via getClaims().
//   - Requires caller to be Tenant Admin (Organization's Tenant) OR Org Admin
//     of the target Organization. Platform Super Admin alone is NOT sufficient.
//   - Recipient is always the authenticated user's own auth email — arbitrary
//     recipientEmail values are ignored/rejected. This intentionally reduces
//     the attack surface: this endpoint only ever probes SMTP against the
//     signed-in admin's own mailbox.
//
// Tenant SMTP resolver + outbound_email gate are enforced inside sendTenantEmail.
// No global SMTP fallback. No secret material is logged or returned.

import { createClient } from "npm:@supabase/supabase-js@2.50.0";
import { sendTenantEmail } from "../_shared/tenantOutboundEmail.ts";
import { renderBtpmEmail } from "../_shared/emailBrand.ts";
import { assertBrowserSessionOnly } from "../_shared/btpm-api/assertBrowserSessionOnly.ts";
import { createSupabaseTokenVerifier } from "../_shared/btpm-api/resolveTokenContext.ts";
import { toSafeErrorResponse } from "../_shared/btpm-api/apiErrors.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function requireEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ---------- 1. Authenticate ----------
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return jsonResponse(401, { error: "unauthorized", code: "unauthorized" });
    }
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) {
      return jsonResponse(401, { error: "unauthorized", code: "unauthorized" });
    }

    const supabaseUrl = requireEnv("SUPABASE_URL");
    const anonKey = requireEnv("SUPABASE_ANON_KEY");

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    try {
      const verifier = createSupabaseTokenVerifier(userClient);
      await assertBrowserSessionOnly(req, verifier);
    } catch (guardError) {
      return toSafeErrorResponse(guardError, corsHeaders);
    }

    const { data: claimsData, error: claimsErr } =
      await userClient.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims?.sub) {
      return jsonResponse(401, { error: "unauthorized", code: "unauthorized" });
    }
    const callerUserId = claimsData.claims.sub as string;
    const callerEmailFromClaims =
      (claimsData.claims.email as string | undefined) ?? null;

    // ---------- 2. Validate body ----------
    const body = await req.json().catch(() => ({} as any));
    const organizationId = String(body?.organization_id ?? "").trim();
    if (!organizationId) {
      return jsonResponse(400, {
        error: "organization_id required",
        code: "organization_context_missing",
      });
    }

    // ---------- 3. Resolve tenant + authorize ----------
    const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
    const serviceSupabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: orgRow, error: orgErr } = await serviceSupabase
      .from("organizations")
      .select("id, tenant_id")
      .eq("id", organizationId)
      .maybeSingle();
    if (orgErr || !orgRow?.tenant_id) {
      return jsonResponse(404, {
        error: "organization not found",
        code: "organization_context_missing",
      });
    }
    const tenantId = orgRow.tenant_id as string;

    const [{ data: isTenantAdmin }, { data: isOrgAdmin }] = await Promise.all([
      serviceSupabase.rpc("is_tenant_admin", {
        _tenant_id: tenantId,
        _user_id: callerUserId,
      }),
      serviceSupabase.rpc("is_user_org_admin", {
        _user_id: callerUserId,
        _organization_id: organizationId,
      }),
    ]);

    if (!isTenantAdmin && !isOrgAdmin) {
      return jsonResponse(403, { error: "forbidden", code: "forbidden" });
    }

    // ---------- 4. Resolve safe recipient (always caller's own email) ----------
    let recipientEmail = callerEmailFromClaims;
    if (!recipientEmail) {
      const { data: adminUser } = await serviceSupabase.auth.admin.getUserById(
        callerUserId,
      );
      recipientEmail = adminUser?.user?.email ?? null;
    }
    if (!recipientEmail) {
      return jsonResponse(400, {
        error: "caller has no email",
        code: "unauthorized",
      });
    }

    // If a recipientEmail was passed in the body, require it to match the caller.
    const requestedRecipient = String(body?.recipientEmail ?? "")
      .trim()
      .toLowerCase();
    if (requestedRecipient && requestedRecipient !== recipientEmail.toLowerCase()) {
      return jsonResponse(403, {
        error:
          "test email can only be sent to the signed-in admin's own address",
        code: "forbidden",
      });
    }

    // ---------- 5. Send via tenant SMTP pipeline ----------
    const html = renderBtpmEmail({
      title: "BTPM Test Email",
      intro: [
        "If you are reading this, the <strong>BTPM tenant SMTP</strong> configuration is working correctly.",
        `Sent at <strong>${new Date().toISOString()}</strong>.`,
      ],
    });

    const result = await sendTenantEmail({
      organizationId,
      recipientEmail,
      recipientUserId: callerUserId,
      emailType: "test_email",
      eventKey: `test_email:${organizationId}:${recipientEmail.toLowerCase()}`,
      subject: "BTPM Test Email",
      htmlBody: html,
      reason: "test-email UI send",
      functionName: "send-test-email",
      dedupeWindowSeconds: 30,
      metadata: { source: "test-email-ui", actor_user_id: callerUserId },
    });

    if (result.status === "sent") {
      return jsonResponse(200, {
        success: true,
        status: result.status,
        event_id: result.eventId,
        recipient: recipientEmail,
      });
    }

    const httpStatus =
      result.status === "skipped_non_production" ? 409 :
      result.status === "skipped_duplicate" ? 429 :
      result.status === "failed_configuration" ? 412 :
      502;

    return jsonResponse(httpStatus, {
      success: false,
      status: result.status,
      error: result.safeErrorMessage,
      code: result.errorCode ?? "provider_error",
      event_id: result.eventId,
    });
  } catch (err: any) {
    // Never leak provider/secret details.
    console.error("send-test-email error:", err?.message || err);
    return jsonResponse(500, {
      error: "internal error",
      code: "provider_error",
    });
  }
});
