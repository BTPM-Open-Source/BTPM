import { createClient } from "npm:@supabase/supabase-js@2";
import { sendAuthEmail } from "../_shared/authOutboundEmail.ts";
import {
  inviteEmailTemplate,
  inviteResendEmailTemplate,
  existingUserAccessEmailTemplate,
} from "../_shared/authMail.ts";
import { assertBrowserSessionOnly } from "../_shared/btpm-api/assertBrowserSessionOnly.ts";
import { createSupabaseTokenVerifier } from "../_shared/btpm-api/resolveTokenContext.ts";
import { toSafeErrorResponse } from "../_shared/btpm-api/apiErrors.ts";

function friendlyAuthEmailError(errorCode: string | null, errorMessage: string | null): string {
  if (errorCode === "smtp_integration_disabled" || errorCode === "smtp_not_configured") {
    return "Tenant SMTP is not enabled. Ask your Tenant Admin to enable the SMTP integration in Admin → Tenant → Integrations.";
  }
  if (errorCode === "smtp_secret_missing") {
    return "Tenant SMTP is missing a required secret. Ask your Tenant Admin to complete SMTP configuration.";
  }
  if (errorCode === "outbound_email_blocked") {
    return "Outbound email is disabled in non-production environments.";
  }
  if (errorCode === "provider_error") {
    return "Tenant SMTP rejected the send (authentication or provider error). Ask your Tenant Admin to verify SMTP credentials.";
  }
  return errorMessage || "Email send failed";
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Look up auth user by email via Admin API.
 * Returns the user if found, null otherwise.
 */
async function findAuthUserByEmail(adminClient: ReturnType<typeof createClient>, email: string) {
  // listUsers does not support direct email filter in v2 — but the admin endpoint
  // accepts a `filter` via query. Easiest portable path: paginate small page and match.
  // For BTPM scale this is acceptable; cap at first page.
  const { data, error } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) return null;
  const lower = email.toLowerCase();
  return data.users.find((u) => (u.email ?? "").toLowerCase() === lower) ?? null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Missing authorization" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!supabaseUrl || !serviceRoleKey || !anonKey) {
      return jsonResponse({ error: "Missing Supabase configuration" }, 500);
    }

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    try {
      const verifier = createSupabaseTokenVerifier(callerClient);
      await assertBrowserSessionOnly(req, verifier);
    } catch (guardError) {
      return toSafeErrorResponse(guardError, corsHeaders);
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await callerClient.auth.getClaims(token);
    const callerId = claimsData?.claims?.sub;

    if (claimsError || typeof callerId !== "string") {
      return jsonResponse({ error: "Not authenticated" }, 401);
    }

    const body = await req.json();
    const {
      action = "invite",
      email,
      organization_id,
      redirectTo,
      invitation_id,
    } = body ?? {};

    if (!email || !organization_id || !redirectTo) {
      return jsonResponse({ error: "Missing required fields: email, organization_id, redirectTo" }, 400);
    }

    let redirectUrl: URL;
    try {
      redirectUrl = new URL(redirectTo);
    } catch {
      return jsonResponse({ error: "Invalid redirectTo URL" }, 400);
    }

    const requestOrigin = req.headers.get("origin")
      ?? (req.headers.get("referer") ? new URL(req.headers.get("referer")!).origin : null);

    if (requestOrigin && redirectUrl.origin !== requestOrigin) {
      return jsonResponse({ error: "redirectTo must point to the same application origin" }, 400);
    }

    const { data: isAdmin } = await callerClient.rpc("is_org_admin", {
      _user_id: callerId,
      _organization_id: organization_id,
    });

    if (!isAdmin) {
      return jsonResponse({ error: "Only Organization Admins can invite users" }, 403);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const appOrigin = redirectUrl.origin;
    const signInUrl = `${appOrigin}/auth`;

    // ── RESEND ────────────────────────────────────────────────
    if (action === "resend") {
      if (!invitation_id) {
        return jsonResponse({ error: "Missing required field: invitation_id" }, 400);
      }

      const { error: resendError } = await callerClient.rpc("admin_resend_invitation", {
        _organization_id: organization_id,
        _invitation_id: invitation_id,
      });
      if (resendError) {
        console.error("Invitation resend error:", resendError.message);
        return jsonResponse({ error: resendError.message }, 400);
      }

      const existingUser = await findAuthUserByEmail(adminClient, email);

      if (existingUser) {
        // Existing account — send access-granted nudge
        const { subject, html } = existingUserAccessEmailTemplate(signInUrl);
        const r = await sendAuthEmail({
          organizationId: organization_id,
          recipientEmail: email,
          recipientUserId: existingUser.id,
          emailType: "invite_existing_user_resend",
          eventKey: `invite_existing:${organization_id}:${email.toLowerCase()}`,
          subject,
          htmlBody: html,
          functionName: "invite-user",
        });
        if (!r.ok) {
          return jsonResponse({ error: friendlyAuthEmailError(r.errorCode, r.errorMessage), code: r.errorCode }, 400);
        }
        return jsonResponse({
          success: true,
          note: "User already has an account. Sent access-granted email; invitation will activate on next sign-in.",
        });
      }

      // New user — generate a fresh invite action link and send
      const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
        type: "invite",
        email,
        options: {
          redirectTo: redirectUrl.toString(),
          data: { organization_id },
        },
      });
      if (linkError || !linkData?.properties?.action_link) {
        console.error("generateLink (invite resend) error:", linkError?.message);
        return jsonResponse({ error: linkError?.message ?? "Failed to generate invite link" }, 500);
      }

      const { subject, html } = inviteResendEmailTemplate(linkData.properties.action_link, email);
      const r = await sendAuthEmail({
        organizationId: organization_id,
        recipientEmail: email,
        emailType: "invite_resend",
        eventKey: `invite_resend:${organization_id}:${email.toLowerCase()}`,
        subject,
        htmlBody: html,
        functionName: "invite-user",
      });
      if (!r.ok) {
        return jsonResponse({ error: friendlyAuthEmailError(r.errorCode, r.errorMessage), code: r.errorCode }, 400);
      }

      console.log(`Invitation re-sent (${r.transport}) to`, email);
      return jsonResponse({ success: true });
    }

    // ── CREATE ────────────────────────────────────────────────
    const { data: invitationId, error: inviteRecordError } = await callerClient.rpc("admin_create_invitation", {
      _organization_id: organization_id,
      _email: email,
      _workspace_id: null,
      _role: "viewer",
    });

    if (inviteRecordError) {
      console.error("Invitation create error:", inviteRecordError.message);
      return jsonResponse({ error: inviteRecordError.message }, 400);
    }

    const existingUser = await findAuthUserByEmail(adminClient, email);

    if (existingUser) {
      const { subject, html } = existingUserAccessEmailTemplate(signInUrl);
      const r = await sendAuthEmail({
        organizationId: organization_id,
        recipientEmail: email,
        recipientUserId: existingUser.id,
        emailType: "invite_existing_user",
        eventKey: `invite_existing:${organization_id}:${email.toLowerCase()}`,
        subject,
        htmlBody: html,
        functionName: "invite-user",
      });
      if (!r.ok) {
        return jsonResponse({
          error: `Invitation created but email failed: ${friendlyAuthEmailError(r.errorCode, r.errorMessage)}`,
          code: r.errorCode,
          invitation_id: invitationId,
        }, 400);
      }
      return jsonResponse({
        success: true,
        invitation_id: invitationId,
        note: "User already has an account. Access-granted email sent; invitation will activate on next sign-in.",
      });
    }

    const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
      type: "invite",
      email,
      options: {
        redirectTo: redirectUrl.toString(),
        data: { invitation_id: invitationId, organization_id },
      },
    });

    if (linkError || !linkData?.properties?.action_link) {
      console.error("generateLink (invite) error:", linkError?.message);
      return jsonResponse({
        error: `Invitation record created but link generation failed: ${linkError?.message ?? "unknown"}`,
        invitation_id: invitationId,
      }, 500);
    }

    const { subject, html } = inviteEmailTemplate(linkData.properties.action_link, email);
    const r = await sendAuthEmail({
      organizationId: organization_id,
      recipientEmail: email,
      emailType: "invite_new_user",
      eventKey: `invite_new:${organization_id}:${email.toLowerCase()}`,
      subject,
      htmlBody: html,
      functionName: "invite-user",
    });
    if (!r.ok) {
      return jsonResponse({
        error: `Invitation record created but email failed: ${friendlyAuthEmailError(r.errorCode, r.errorMessage)}`,
        code: r.errorCode,
        invitation_id: invitationId,
      }, 400);
    }

    console.log(`Invitation sent (${r.transport}) to`, email);
    return jsonResponse({ success: true, invitation_id: invitationId });
  } catch (err) {
    console.error("Unexpected error:", err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Unexpected error" },
      500,
    );
  }
});
