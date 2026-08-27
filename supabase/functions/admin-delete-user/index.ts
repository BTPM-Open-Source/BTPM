import { createClient } from "npm:@supabase/supabase-js@2";
import { assertBrowserSessionOnly } from "../_shared/btpm-api/assertBrowserSessionOnly.ts";
import { createSupabaseTokenVerifier } from "../_shared/btpm-api/resolveTokenContext.ts";
import { toSafeErrorResponse } from "../_shared/btpm-api/apiErrors.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function jsonResponse(body: Record<string, unknown>, status = 200, cors: Record<string, string> = corsHeaders) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function parseRequiredString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

Deno.serve(async (req: Request) => {

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Missing authorization" }, 401, corsHeaders);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return jsonResponse({ error: "Missing Supabase configuration" }, 500, corsHeaders);
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

    const { data: { user: caller }, error: authError } = await callerClient.auth.getUser();
    if (authError || !caller?.id) {
      console.error("Delete user auth error:", authError?.message);
      return jsonResponse({ error: "Not authenticated" }, 401, corsHeaders);
    }

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const organizationId = parseRequiredString(body.organization_id);
    const targetUserId = parseRequiredString(body.target_user_id);

    if (!organizationId || !targetUserId) {
      return jsonResponse({ error: "organization_id and target_user_id are required" }, 400, corsHeaders);
    }

    if (caller.id === targetUserId) {
      return jsonResponse({ error: "Cannot delete your own account" }, 400, corsHeaders);
    }

    const { data: isAdmin, error: adminCheckError } = await callerClient.rpc("is_org_admin", {
      _organization_id: organizationId,
      _user_id: caller.id,
    });

    if (adminCheckError) {
      throw adminCheckError;
    }

    if (!isAdmin) {
      return jsonResponse({ error: "Insufficient permissions" }, 403, corsHeaders);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: targetProfile, error: targetProfileError } = await adminClient
      .from("profiles")
      .select("email")
      .eq("id", targetUserId)
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (targetProfileError) {
      throw targetProfileError;
    }

    const targetEmail = targetProfile?.email?.trim().toLowerCase() ?? null;

    const { error: cleanupError } = await callerClient.rpc("admin_delete_user", {
      _organization_id: organizationId,
      _target_user_id: targetUserId,
    });

    if (cleanupError) {
      throw cleanupError;
    }

    if (targetEmail) {
      const { data: invitations, error: invitationsError } = await adminClient
        .from("invitations")
        .select("id, email")
        .eq("organization_id", organizationId);

      if (invitationsError) {
        throw invitationsError;
      }

      const invitationIds = (invitations ?? [])
        .filter((invitation) => invitation.email?.trim().toLowerCase() === targetEmail)
        .map((invitation) => invitation.id);

      if (invitationIds.length > 0) {
        const { error: deleteInvitationsError } = await adminClient
          .from("invitations")
          .delete()
          .in("id", invitationIds);

        if (deleteInvitationsError) {
          throw deleteInvitationsError;
        }
      }
    }

    const { error: deleteAuthError } = await adminClient.auth.admin.deleteUser(targetUserId, false);
    if (deleteAuthError && !deleteAuthError.message.toLowerCase().includes("not found")) {
      throw deleteAuthError;
    }

    console.log("Deleted user from organization and auth", JSON.stringify({
      callerId: caller.id,
      organizationId,
      targetUserId,
    }));

    return jsonResponse({ success: true }, 200, corsHeaders);
  } catch (error) {
    console.error("Delete user error:", error);
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : "Unexpected error",
      },
      500,
    );
  }
});
