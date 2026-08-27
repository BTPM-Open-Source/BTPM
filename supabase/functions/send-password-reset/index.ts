import { createClient } from "npm:@supabase/supabase-js@2";
import { sendAuthEmail } from "../_shared/authOutboundEmail.ts";
import { passwordResetEmailTemplate } from "../_shared/authMail.ts";
import { resolvePasswordResetOrganization } from "../_shared/passwordResetOrganizationResolver.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function safeLog(component: string, requestId: string, route: string, category: string) {
  console.log(
    `[${component}] request_id=${requestId} route=${route} result=${category}`,
  );
}

/**
 * Public endpoint (no JWT required) — same threat surface as
 * supabase.auth.resetPasswordForEmail. Always returns success-shaped
 * response to avoid email enumeration.
 *
 * Phase 4D.14A.7H: routes through Tenant SMTP when a canonical Organization
 * can be resolved for the user; otherwise falls back to Supabase Auth native
 * password-recovery delivery. No Microsoft Graph mail path remains.
 *
 * Body: { email: string, redirectTo: string }
 */
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const requestId =
    req.headers.get("x-request-id") ??
    (globalThis.crypto?.randomUUID?.() ?? String(Date.now()));

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !serviceRoleKey || !anonKey) {
      return jsonResponse({ error: "Missing Supabase configuration" }, 500);
    }

    const body = await req.json().catch(() => ({}));
    const { email, redirectTo } = body ?? {};

    if (!email || typeof email !== "string") {
      return jsonResponse({ error: "email required" }, 400);
    }
    if (!redirectTo || typeof redirectTo !== "string") {
      return jsonResponse({ error: "redirectTo required" }, 400);
    }

    let redirectUrl: URL;
    try {
      redirectUrl = new URL(redirectTo);
    } catch {
      return jsonResponse({ error: "Invalid redirectTo URL" }, 400);
    }

    // Open-redirect guard: redirectTo must match the request origin.
    const requestOrigin =
      req.headers.get("origin") ??
      (req.headers.get("referer")
        ? new URL(req.headers.get("referer")!).origin
        : null);
    if (requestOrigin && redirectUrl.origin !== requestOrigin) {
      return jsonResponse(
        { error: "redirectTo must point to the same application origin" },
        400,
      );
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Resolve the auth user id by normalized email via profiles (server authority).
    // Anti-enumeration: if the user cannot be resolved we still return success
    // and fall through to the platform Auth route (which itself is safe against
    // enumeration).
    let userId: string | null = null;
    try {
      const { data: prof } = await adminClient
        .from("profiles")
        .select("id")
        .eq("email", email.toLowerCase())
        .maybeSingle();
      userId = (prof?.id as string) ?? null;
    } catch (_) {
      userId = null;
    }

    // Resolve canonical routing.
    let route: Awaited<ReturnType<typeof resolvePasswordResetOrganization>>;
    if (userId) {
      try {
        route = await resolvePasswordResetOrganization(adminClient, userId);
      } catch (_) {
        safeLog(
          "send-password-reset",
          requestId,
          "platform_auth",
          "password_reset_resolution_failed",
        );
        route = { kind: "platform_auth" };
      }
    } else {
      route = { kind: "platform_auth" };
    }

    // Route A — Tenant SMTP (unambiguous Organization).
    if (route.kind === "tenant") {
      const { data: linkData, error: linkError } =
        await adminClient.auth.admin.generateLink({
          type: "recovery",
          email,
          options: { redirectTo: redirectUrl.toString() },
        });
      if (linkError || !linkData?.properties?.action_link) {
        safeLog(
          "send-password-reset",
          requestId,
          "tenant_smtp",
          "password_reset_link_generation_failed",
        );
        return jsonResponse({ success: true });
      }
      const { subject, html } = passwordResetEmailTemplate(
        linkData.properties.action_link,
      );
      const r = await sendAuthEmail({
        organizationId: route.organizationId,
        recipientEmail: email,
        recipientUserId: userId,
        emailType: "password_reset",
        eventKey: `password_reset:${email.toLowerCase()}:${new Date()
          .toISOString()
          .slice(0, 10)}`,
        subject,
        htmlBody: html,
        functionName: "send-password-reset",
      });
      safeLog(
        "send-password-reset",
        requestId,
        "tenant_smtp",
        r.ok ? "password_reset_tenant_smtp_sent" : "password_reset_tenant_smtp_failed",
      );
      // Anti-enumeration: always success-shaped for valid inputs.
      return jsonResponse({ success: true });
    }

    // Route B — Supabase Auth native recovery (ambiguous / no Organization).
    // Uses a client configured only for this native Auth action; never
    // generates a separate action link and never invokes Tenant SMTP.
    const platformClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    try {
      await platformClient.auth.resetPasswordForEmail(email, {
        redirectTo: redirectUrl.toString(),
      });
      safeLog(
        "send-password-reset",
        requestId,
        "platform_auth",
        "password_reset_platform_auth_dispatched",
      );
    } catch (_) {
      safeLog(
        "send-password-reset",
        requestId,
        "platform_auth",
        "password_reset_platform_auth_failed",
      );
    }
    return jsonResponse({ success: true });
  } catch (_err) {
    safeLog(
      "send-password-reset",
      requestId,
      "unknown",
      "password_reset_unexpected_error",
    );
    // Do not surface raw error messages.
    return jsonResponse({ error: "Unexpected error" }, 500);
  }
});
