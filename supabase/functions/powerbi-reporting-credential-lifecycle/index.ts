// PBI 5.1B1A — Tenant Power BI reporting credential lifecycle Edge Function.
//
// Authenticated proxy in front of
//   public.service_manage_powerbi_reporting_identity(_tenant_id, _action, _actor_user_id)
//
// Strict rules:
//   * Accepts POST and OPTIONS only.
//   * Validates a Bearer user JWT via Supabase Auth.
//   * Only tenant_id (uuid) and action (enum) are accepted from the client.
//   * Any request whose top-level body includes forbidden keys is rejected —
//     not silently ignored.
//   * The one-time password produced by credential-issuing actions is returned
//     only in the HTTPS response with `Cache-Control: no-store, private`.
//   * Never logs the request body, RPC result, password, Authorization header,
//     or connection information.
import { createClient } from "npm:@supabase/supabase-js@2.50.0";
import { assertBrowserSessionOnly } from "../_shared/btpm-api/assertBrowserSessionOnly.ts";
import { createSupabaseTokenVerifier } from "../_shared/btpm-api/resolveTokenContext.ts";
import { toSafeErrorResponse } from "../_shared/btpm-api/apiErrors.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const secureJsonHeaders: Record<string, string> = {
  ...corsHeaders,
  "Content-Type": "application/json",
  "Cache-Control": "no-store, private",
  Pragma: "no-cache",
};

const ALLOWED_ACTIONS = new Set([
  "provision",
  "rotate",
  "disable",
  "enable",
  "activate",
  "revoke",
]);

const FORBIDDEN_BODY_KEYS = [
  "login_role_name",
  "role_name",
  "password",
  "one_time_password",
  "connection_string",
  "database_host",
  "project_ref",
  "mapping_state",
  "role_attributes",
];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function safeError(status: number, code: string) {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: secureJsonHeaders,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return safeError(405, "method_not_allowed");
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return safeError(401, "unauthorized");
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return safeError(500, "server_misconfigured");
  }

  // Validate caller identity via user JWT.
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  try {
    const verifier = createSupabaseTokenVerifier(userClient);
    await assertBrowserSessionOnly(req, verifier);
  } catch (guardError) {
    return toSafeErrorResponse(guardError, secureJsonHeaders);
  }

  const token = authHeader.slice("Bearer ".length).trim();
  const { data: claimsResp, error: claimsErr } =
    await userClient.auth.getClaims(token);
  if (claimsErr || !claimsResp?.claims?.sub) {
    return safeError(401, "unauthorized");
  }
  const actorUserId = String(claimsResp.claims.sub);

  // Parse and validate the request body.
  let body: unknown;
  try {
    body = await req.json();
  } catch (_e) {
    return safeError(400, "invalid_request");
  }
  const b = (body ?? {}) as Record<string, unknown>;

  // Reject — not ignore — forbidden top-level keys.
  for (const forbidden of FORBIDDEN_BODY_KEYS) {
    if (Object.prototype.hasOwnProperty.call(b, forbidden)) {
      return safeError(400, "forbidden_field");
    }
  }

  const tenantId = typeof b.tenant_id === "string" ? b.tenant_id : "";
  const actionRaw = typeof b.action === "string" ? b.action : "";
  const action = actionRaw.trim().toLowerCase();

  if (!UUID_RE.test(tenantId)) return safeError(400, "invalid_tenant_id");
  if (!ALLOWED_ACTIONS.has(action)) return safeError(400, "invalid_action");

  // Server-side privileged call.
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await admin.rpc(
    "service_manage_powerbi_reporting_identity",
    {
      _tenant_id: tenantId,
      _action: action,
      _actor_user_id: actorUserId,
    },
  );

  if (error) {
    // Deliberately do NOT log the RPC message body (may contain identifiers).
    return safeError(400, "lifecycle_error");
  }

  // Never log or persist `data` — it may contain the one-time password.
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: secureJsonHeaders,
  });
});
