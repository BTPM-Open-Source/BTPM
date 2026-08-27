import { createClient } from "npm:@supabase/supabase-js@2";
import { assertBrowserSessionOnly } from "../_shared/btpm-api/assertBrowserSessionOnly.ts";
import { createSupabaseTokenVerifier } from "../_shared/btpm-api/resolveTokenContext.ts";
import { toSafeErrorResponse } from "../_shared/btpm-api/apiErrors.ts";

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
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
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

    let invitationId: string | null = null;
    try {
      const body = await req.json();
      invitationId = typeof body?.invitation_id === "string" ? body.invitation_id : null;
    } catch {
      invitationId = null;
    }

    const { data: { user: caller }, error: authError } = await callerClient.auth.getUser();
    if (authError || !caller?.id || !caller.email) {
      return jsonResponse({ error: "Not authenticated" }, 401);
    }

    console.log(
      "Redeem invitations for",
      caller.id,
      caller.email,
      invitationId ? `(scoped: ${invitationId})` : "(fallback: email)",
    );

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Scoped mode: delegate to tenant-aware SQL function.
    if (invitationId) {
      // Friendly pre-checks (do not bypass SQL membership work; just improve UX).
      const { data: invitation, error: lookupError } = await adminClient
        .from("invitations")
        .select("id, email, status, expires_at, organization_id")
        .eq("id", invitationId)
        .maybeSingle();

      if (lookupError) {
        console.error("Scoped invitation lookup error:", lookupError.message);
        throw lookupError;
      }
      if (!invitation) {
        return jsonResponse({ error: "Invitation not found." }, 404);
      }

      if (invitation.status === "accepted") {
        return jsonResponse(
          { success: true, accepted: 0, invitation_id: invitation.id, status: "already_accepted" },
          200,
        );
      }

      if (
        invitation.status !== "pending" ||
        !invitation.expires_at ||
        new Date(invitation.expires_at).getTime() <= Date.now()
      ) {
        return jsonResponse({ error: "Invitation is expired, revoked, or already used." }, 400);
      }

      if (invitation.email.toLowerCase() !== caller.email.toLowerCase()) {
        return jsonResponse(
          { error: "Invitation email does not match the authenticated user." },
          403,
        );
      }

      const { data: acceptResult, error: acceptError } = await adminClient.rpc(
        "accept_pending_invitation_for_user",
        { _user_id: caller.id, _invitation_id: invitation.id },
      );

      if (acceptError) {
        console.error("accept_pending_invitation_for_user error:", acceptError.message);
        return jsonResponse({ error: acceptError.message }, 400);
      }

      return jsonResponse(
        {
          success: true,
          accepted: acceptResult ? 1 : 0,
          invitation_id: invitation.id,
          status: "scoped_redeemed",
        },
        200,
      );
    }

    // Fallback mode: email-based bulk redemption via tenant-aware SQL.
    const { data: accepted, error: rpcError } = await adminClient.rpc(
      "auto_accept_pending_invitations",
      { _user_id: caller.id },
    );

    if (rpcError) {
      console.error("auto_accept_pending_invitations error:", rpcError.message);
      throw rpcError;
    }

    const acceptedCount = accepted ?? 0;

    if (acceptedCount > 0) {
      console.log("Accepted", acceptedCount, "invitation(s) for", caller.id);
      return jsonResponse(
        { success: true, accepted: acceptedCount, status: "email_fallback_redeemed" },
        200,
      );
    }

    const { data: profile } = await adminClient
      .from("profiles")
      .select("organization_id")
      .eq("id", caller.id)
      .not("organization_id", "is", null)
      .maybeSingle();

    if (profile?.organization_id) {
      return jsonResponse({ success: true, accepted: 0, status: "already_reconciled" }, 200);
    }

    return jsonResponse(
      { error: "No pending invitations found for this email address." },
      404,
    );
  } catch (error) {
    console.error("Redeem invitation error:", error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      500,
    );
  }
});
