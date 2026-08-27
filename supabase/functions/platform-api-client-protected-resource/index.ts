// UX-MCP-ADMIN.1 — Protected Resource Administration Backend (Platform only).
//
// One narrowly scoped protected Platform-Super-Admin operation that configures
// public.api_clients.oauth_resource_audience through a BOUNDED resource
// selection. The browser submits only:
//
//   { api_client_id: uuid, resource_type: "none" | "btpm_mcp" }
//
// The browser NEVER submits or controls the audience URL. For "btpm_mcp" the
// canonical audience is resolved server-side from BTPM_MCP_RESOURCE_URI and
// validated with the accepted MCP protected-resource normalization logic
// (`_shared/btpm-api/mcpResourceUri.ts`) — no duplicate canonical URI and
// no duplicated validation rules are introduced here.
//
// This function performs NO Organization / Tenant / Workspace / Project
// authority evaluation, touches no capability grant, no OAuth redirect, no
// policy/consent state and no secret.

import { createClient } from "npm:@supabase/supabase-js@2";
import { assertBrowserSessionOnly } from "../_shared/btpm-api/assertBrowserSessionOnly.ts";
import { createSupabaseTokenVerifier } from "../_shared/btpm-api/resolveTokenContext.ts";
import { toSafeErrorResponse } from "../_shared/btpm-api/apiErrors.ts";
import {
  McpResourceConfigurationError,
  normalizeMcpResourceUri,
} from "../_shared/btpm-api/mcpResourceUri.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/** The exact administrative resource vocabulary. Closed set. */
const RESOURCE_TYPES = ["none", "btpm_mcp"] as const;
type ResourceType = (typeof RESOURCE_TYPES)[number];

/** The exact accepted request body keys. Anything else fails closed. */
const ALLOWED_BODY_KEYS = ["api_client_id", "resource_type"] as const;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
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

    // 1. Authenticate the human caller. A service-role identity is never
    //    accepted as proof of authorization.
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    try {
      const verifier = createSupabaseTokenVerifier(callerClient);
      await assertBrowserSessionOnly(req, verifier);
    } catch (guardError) {
      return toSafeErrorResponse(guardError, corsHeaders);
    }

    const { data: { user: caller }, error: authError } = await callerClient.auth
      .getUser();
    if (authError || !caller?.id) {
      return jsonResponse({ error: "Not authenticated" }, 401);
    }

    // 2. Authorize: Platform Super Admin only. Fail closed otherwise.
    const { data: isSuperAdmin, error: superAdminError } = await callerClient
      .rpc("is_platform_super_admin", { _user_id: caller.id });
    if (superAdminError) {
      return jsonResponse({ error: "Not authorized" }, 403);
    }
    if (isSuperAdmin !== true) {
      return jsonResponse({ error: "Not authorized" }, 403);
    }

    // 3. Bounded input. No audience URL parameter exists in this contract.
    const body = await req.json().catch(() => null) as
      | Record<string, unknown>
      | null;
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return jsonResponse({ error: "Invalid request body" }, 400);
    }
    for (const key of Object.keys(body)) {
      if (!(ALLOWED_BODY_KEYS as readonly string[]).includes(key)) {
        return jsonResponse({ error: "Unsupported request parameter" }, 400);
      }
    }

    const apiClientId = typeof body.api_client_id === "string"
      ? body.api_client_id.trim()
      : "";
    if (!UUID_PATTERN.test(apiClientId)) {
      return jsonResponse({ error: "api_client_id is required" }, 400);
    }

    const rawResourceType = typeof body.resource_type === "string"
      ? body.resource_type.trim()
      : "";
    if (!(RESOURCE_TYPES as readonly string[]).includes(rawResourceType)) {
      return jsonResponse({ error: "Unsupported resource_type" }, 400);
    }
    const resourceType = rawResourceType as ResourceType;

    // 4. Resolve the canonical MCP resource server-side, or NULL for "none".
    let resolvedAudience: string | null = null;
    if (resourceType === "btpm_mcp") {
      try {
        resolvedAudience = normalizeMcpResourceUri(
          Deno.env.get("BTPM_MCP_RESOURCE_URI"),
        );
      } catch (configError) {
        if (configError instanceof McpResourceConfigurationError) {
          return jsonResponse(
            { error: "MCP protected resource is not configured" },
            503,
          );
        }
        throw configError;
      }
    }

    // 5. Protected persistence + atomic audit evidence.
    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await serviceClient.rpc(
      "api_ux_mcp_admin_1_platform_set_client_protected_resource",
      {
        _actor_user_id: caller.id,
        _api_client_id: apiClientId,
        _resource_type: resourceType,
        _resolved_resource_audience: resolvedAudience,
      },
    );

    if (error) {
      const code = error.code === "42501"
        ? 403
        : error.code === "22023" || error.code === "23514"
        ? 400
        : 500;
      return jsonResponse({ error: error.message }, code);
    }

    return jsonResponse({ result: data }, 200);
  } catch (unexpected) {
    console.error(
      "platform-api-client-protected-resource failed:",
      unexpected instanceof Error ? unexpected.message : "unknown error",
    );
    return jsonResponse({ error: "Unexpected error" }, 500);
  }
});
