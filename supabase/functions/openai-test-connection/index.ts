/**
 * Phase 4D.14A.5A — OpenAI Test Connection Edge Function.
 *
 * Read-only connectivity check against `GET https://api.openai.com/v1/models`
 * using the effective Tenant/Organization OpenAI API key. Never generates
 * content. Never returns model IDs, model lists, Tenant/Organization IDs,
 * integration IDs, secret names, raw OpenAI errors, response data, tokens,
 * headers, or resolver metadata.
 *
 * Authority reuses the Power BI authority model:
 *   - Org Admin for the target Organization is accepted
 *   - active Tenant Owner/Admin for the owning Tenant is accepted
 *   - missing and unauthorized Organizations return the same 403
 *   - caller-supplied Tenant context is never trusted
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";
import {
  resolveTenantOpenAiRuntimeConfig,
  TenantOpenAiError,
} from "../_shared/tenantOpenAi.ts";
import {
  testOpenAiConnection,
} from "../_shared/openAiConnectionTestClient.ts";
import {
  classifyOpenAiResolverError,
  classifyOpenAiTransportResult,
  type OpenAiTestClassificationEntry,
} from "../_shared/openAiTestConnectionHelpers.ts";
import {
  type AuthorityCheckDeps,
  evaluateAuthority,
} from "../_shared/adminAuthority.ts";
import {
  recordTenantIntegrationTestResult,
} from "../_shared/tenantIntegrationTestResult.ts";
import { assertBrowserSessionOnly } from "../_shared/btpm-api/assertBrowserSessionOnly.ts";
import { createSupabaseTokenVerifier } from "../_shared/btpm-api/resolveTokenContext.ts";
import { toSafeErrorResponse } from "../_shared/btpm-api/apiErrors.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const FUNCTION_NAME = "openai-test-connection";

const AUTHORITY_INFRA_MESSAGE = "OpenAI authority could not be verified.";
const AUTHORITY_DENIED_MESSAGE =
  "Tenant Admin or Organization Admin authority is required.";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function safeLog(
  stage: string,
  requestId: string,
  payload: Record<string, unknown> = {},
) {
  const safe: Record<string, unknown> = { request_id: requestId };
  for (const [k, v] of Object.entries(payload)) {
    const lk = k.toLowerCase();
    if (
      lk.includes("secret") ||
      lk.includes("token") ||
      lk.includes("authorization") ||
      lk.includes("api_key") ||
      lk === "body" ||
      lk === "message" ||
      lk === "data" ||
      lk === "models" ||
      lk.includes("tenant_id") ||
      lk.includes("organization_id") ||
      lk.includes("integration_id")
    ) continue;
    safe[k] = v;
  }
  console.log(`[${FUNCTION_NAME}] ${stage}`, JSON.stringify(safe));
}

/** Compact browser-safe response shape. */
function toCompactResponse(entry: OpenAiTestClassificationEntry, opts: {
  credentialAccepted: boolean;
  apiAccessible: boolean;
  httpStatus: number | null;
}) {
  return {
    ok: entry.classification === "connection_successful",
    classification: entry.classification,
    recommended_next_action: entry.recommended_next_action,
    credential_accepted: opts.credentialAccepted,
    api_accessible: opts.apiAccessible,
    http_status: opts.httpStatus,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const requestId = crypto.randomUUID();
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json(401, { error: "Missing Authorization header" });

    const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    try {
      const verifier = createSupabaseTokenVerifier(callerClient);
      await assertBrowserSessionOnly(req, verifier);
    } catch (guardError) {
      return toSafeErrorResponse(guardError, corsHeaders);
    }

    const { data: userData, error: userErr } = await callerClient.auth
      .getUser();
    if (userErr || !userData?.user) {
      return json(401, { error: "Not authenticated" });
    }

    const body = await req.json().catch(() => ({}));
    const organizationId = body?.organization_id as string | undefined;
    if (!organizationId || typeof organizationId !== "string") {
      return json(400, { error: "organization_id is required" });
    }

    const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const deps: AuthorityCheckDeps = {
      fetchOrgTenant: async (orgId) => {
        const { data, error } = await service
          .from("organizations")
          .select("id, tenant_id")
          .eq("id", orgId)
          .maybeSingle();
        if (error) return { tenantId: null, error: true };
        return {
          tenantId: (data?.tenant_id as string | null | undefined) ?? null,
          error: false,
        };
      },
      isOrgAdmin: async (uid, oid) => {
        const { data, error } = await service.rpc("is_org_admin", {
          _user_id: uid,
          _organization_id: oid,
        });
        if (error) return { value: null, error: true };
        return { value: !!data, error: false };
      },
      isTenantAdmin: async (uid, tid) => {
        const { data, error } = await service.rpc("is_tenant_admin", {
          _tenant_id: tid,
          _user_id: uid,
        });
        if (error) return { value: null, error: true };
        return { value: !!data, error: false };
      },
    };

    const authority = await evaluateAuthority(
      userData.user.id,
      organizationId,
      deps,
    );
    if (authority.outcome === "infra_failure") {
      safeLog("authority_check_failed", requestId, {});
      return json(403, { error: AUTHORITY_INFRA_MESSAGE });
    }
    if (authority.outcome === "denied") {
      // Missing and unauthorized Organizations return the same 403.
      return json(403, { error: AUTHORITY_DENIED_MESSAGE });
    }

    const provenRole: "org_admin" | "tenant_admin" =
      authority.outcome === "allowed_org_admin" ? "org_admin" : "tenant_admin";
    safeLog("request", requestId, { role: provenRole });

    // Resolve OpenAI runtime configuration for the Organization. This applies
    // the environment safety gate and Vault resolution; any failure produces
    // a safe classification without exposing internals.
    let runtimeApiKey: string;
    let runtimeIntegrationId: string;
    let runtimeOrgId: string;
    try {
      const runtime = await resolveTenantOpenAiRuntimeConfig({
        organizationId,
        action: "real_integration",
        reason: "openai-read-only-connection-test",
        functionName: FUNCTION_NAME,
        requestId,
      });
      runtimeApiKey = runtime.apiKey;
      runtimeIntegrationId = runtime.integrationId;
      runtimeOrgId = runtime.organizationId;
    } catch (e) {
      const entry = classifyOpenAiResolverError(e);
      const internalCode = e instanceof TenantOpenAiError ? e.code : "unknown";
      safeLog("runtime.resolve_failed", requestId, {
        classification: entry.classification,
        internal_code: internalCode,
      });
      return json(
        200,
        toCompactResponse(entry, {
          credentialAccepted: false,
          apiAccessible: false,
          httpStatus: null,
        }),
      );
    }

    // Transport-only connectivity probe.
    const transport = await testOpenAiConnection({
      apiKey: runtimeApiKey,
      requestId,
    });
    const entry = classifyOpenAiTransportResult(transport.category);
    const credentialAccepted = transport.category === "success" ||
      transport.category === "access_forbidden" ||
      transport.category === "rate_limited";
    const apiAccessible = transport.category === "success";

    safeLog("test", requestId, {
      transport_category: transport.category,
      classification: entry.classification,
      http_status: transport.httpStatus,
      credential_accepted: credentialAccepted,
      api_accessible: apiAccessible,
    });

    // Persist canonical test result. Failure to persist is a soft error; it
    // must never replace the real test outcome.
    const rec = await recordTenantIntegrationTestResult(service, {
      integrationId: runtimeIntegrationId,
      organizationId: runtimeOrgId,
      actorUserId: userData.user.id,
      result: entry.recorderResult,
      safeErrorCode: entry.safeErrorCode,
      functionName: FUNCTION_NAME,
      requestId,
    });
    if (!rec.ok) {
      safeLog("test_result_persistence_failed", requestId, {});
    }

    return json(
      200,
      toCompactResponse(entry, {
        credentialAccepted,
        apiAccessible,
        httpStatus: transport.httpStatus,
      }),
    );
  } catch (_e) {
    safeLog("unexpected_failure", requestId, {});
    return json(500, {
      error: "OpenAI connection testing is temporarily unavailable.",
    });
  }
});
