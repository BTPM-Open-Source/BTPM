// BTPM — Wave C3, Step C3.10d
// Admin-gated read-only endpoint that returns ONLY the configured
// scheduled-auto-submit system email used by run-kpi-app-scheduler
// (system mode). The frontend cannot read Edge Function secrets directly.
//
// Hard rules:
//   - Org Admin OR Workspace Admin (workspace_id required for the latter).
//   - Returns ONLY { system_entered_by_email, configured }.
//   - NEVER returns secret names, env vars, hashes, credentials, or
//     service-role keys.
//   - If KPI_APP_SYSTEM_ENTERED_BY_EMAIL is unset/invalid, returns
//     { configured: false, system_entered_by_email: null } so the UI
//     can render the operations-action message.

import { createClient } from "npm:@supabase/supabase-js@2.50.0";
import { assertBrowserSessionOnly } from "../_shared/btpm-api/assertBrowserSessionOnly.ts";
import { createSupabaseTokenVerifier } from "../_shared/btpm-api/resolveTokenContext.ts";
import { toSafeErrorResponse } from "../_shared/btpm-api/apiErrors.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function respond(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function parseRequiredString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return respond({ ok: false, error: "Method not allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return respond({ ok: false, error: "Not authenticated" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !anonKey) {
      return respond({ ok: false, error: "Missing Supabase configuration" }, 500);
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

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const organizationId = parseRequiredString(body.organization_id);
    const workspaceId = parseRequiredString(body.workspace_id); // optional
    if (!organizationId) {
      return respond({ ok: false, error: "organization_id is required" }, 400);
    }

    const { data: { user: caller }, error: authError } =
      await callerClient.auth.getUser();
    if (authError || !caller?.id) {
      return respond({ ok: false, error: "Not authenticated" }, 401);
    }

    // Authority gate: Org Admin OR Workspace Admin (when workspace given).
    const { data: isOrgAdmin } = await callerClient.rpc("is_org_admin", {
      _organization_id: organizationId,
      _user_id: caller.id,
    });

    let authorized = !!isOrgAdmin;
    if (!authorized && workspaceId) {
      const { data: wsRole } = await callerClient
        .from("workspace_memberships")
        .select("role")
        .eq("workspace_id", workspaceId)
        .eq("user_id", caller.id)
        .maybeSingle();
      authorized = wsRole?.role === "workspace_admin";
    }

    if (!authorized) {
      return respond({ ok: false, error: "Admin access required" }, 403);
    }

    // Resolve and validate the configured system email.
    const raw = (Deno.env.get("KPI_APP_SYSTEM_ENTERED_BY_EMAIL") ?? "").trim();
    const valid =
      raw.length > 0 &&
      raw.length <= 254 &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw);

    if (!valid) {
      return respond({
        ok: true,
        configured: false,
        system_entered_by_email: null,
      });
    }

    return respond({
      ok: true,
      configured: true,
      system_entered_by_email: raw,
    });
  } catch (e) {
    // Never echo secret values in errors.
    return respond({ ok: false, error: "Internal error" }, 500);
  }
});
