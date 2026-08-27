/**
 * Phase 4D.14A.8A — Azure OpenAI Test Connection Edge Function.
 *
 * Read-only connectivity check against `GET {endpoint}/openai/v1/models`
 * using the effective Tenant/Organization Azure OpenAI API key. Never
 * generates content. Never returns model IDs, model lists, deployments,
 * endpoints, Tenant/Organization IDs, integration IDs, secret names,
 * raw Azure errors, response data, tokens, or resolver metadata.
 *
 * Authority (Phase 4D.14A.8A.1): Tenant Admin only.
 *   - active Tenant Owner/Admin for the owning Tenant is accepted
 *   - Organization Admin alone is NOT sufficient for the Azure OpenAI test
 *   - missing and unauthorized Organizations return the same 403
 *   - caller-supplied Tenant context is never trusted
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";
import {
  resolveTenantAzureOpenAiRuntimeConfig,
  TenantAzureOpenAiError,
} from "../_shared/tenantAzureOpenAi.ts";
import {
  testAzureOpenAiConnection,
} from "../_shared/azureOpenAiConnectionTestClient.ts";
import {
  type AzureOpenAiTestClassificationEntry,
  classifyAzureResolverError,
  classifyAzureTransportResult,
} from "../_shared/azureOpenAiTestConnectionHelpers.ts";
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

const FUNCTION_NAME = "azure-openai-test-connection";

const AUTHORITY_INFRA_MESSAGE =
  "Azure OpenAI authority could not be verified.";
const AUTHORITY_DENIED_MESSAGE =
  "Tenant Admin authority is required.";

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
      lk.includes("api-key") ||
      lk === "body" ||
      lk === "message" ||
      lk === "data" ||
      lk === "models" ||
      lk === "endpoint" ||
      lk === "base_url" ||
      lk.includes("tenant_id") ||
      lk.includes("organization_id") ||
      lk.includes("integration_id")
    ) continue;
    safe[k] = v;
  }
  console.log(`[${FUNCTION_NAME}] ${stage}`, JSON.stringify(safe));
}

function toCompactResponse(
  entry: AzureOpenAiTestClassificationEntry,
  opts: {
    credentialAccepted: boolean;
    apiAccessible: boolean;
    httpStatus: number | null;
  },
) {
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
    if (!authHeader) {
      return json(401, { error: "Missing Authorization header" });
    }

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
    // Phase 4D.14A.8A.1 — Tenant-Admin-only authority for Azure OpenAI test.
    // Organization Admin alone is not sufficient.
    if (authority.outcome !== "allowed_tenant_admin") {
      return json(403, { error: AUTHORITY_DENIED_MESSAGE });
    }

    safeLog("request", requestId, { role: "tenant_admin" });

    // Look up the azure_openai/default integration for the Organization's
    // Tenant so we can persist a test result even when the runtime resolver
    // fails before returning an integration id.
    let preresolvedIntegrationId: string | null = null;
    try {
      const { data: orgRow } = await service
        .from("organizations")
        .select("tenant_id")
        .eq("id", organizationId)
        .maybeSingle();
      const tenantIdForLookup =
        (orgRow?.tenant_id as string | null | undefined) ?? null;
      if (tenantIdForLookup) {
        const { data: intRow } = await service
          .from("tenant_integrations")
          .select("id")
          .eq("tenant_id", tenantIdForLookup)
          .eq("kind", "azure_openai")
          .eq("name", "default")
          .maybeSingle();
        preresolvedIntegrationId =
          (intRow?.id as string | null | undefined) ?? null;
      }
    } catch {
      // Non-fatal — persistence is best-effort.
    }

    // Resolve Azure OpenAI runtime configuration. Any failure produces a
    // safe classification without exposing internals.
    let runtimeApiKey: string;
    let runtimeBaseUrl: string;
    let runtimeIntegrationId: string;
    let runtimeOrgId: string;
    try {
      const runtime = await resolveTenantAzureOpenAiRuntimeConfig({
        organizationId,
        action: "real_integration",
        reason: "azure-openai-read-only-connection-test",
        functionName: FUNCTION_NAME,
        requestId,
      });
      runtimeApiKey = runtime.apiKey;
      runtimeBaseUrl = runtime.baseUrl;
      runtimeIntegrationId = runtime.integrationId;
      runtimeOrgId = runtime.organizationId;
    } catch (e) {
      const entry = classifyAzureResolverError(e);
      const internalCode = e instanceof TenantAzureOpenAiError
        ? e.code
        : "unknown";
      safeLog("runtime.resolve_failed", requestId, {
        classification: entry.classification,
        internal_code: internalCode,
      });
      // Phase 4D.14A.8A.1 — Persist resolver-failure test outcomes too, so
      // the Configure Secrets dialog surfaces the most recent test state.
      if (preresolvedIntegrationId) {
        const recFail = await recordTenantIntegrationTestResult(service, {
          integrationId: preresolvedIntegrationId,
          organizationId,
          actorUserId: userData.user.id,
          result: entry.recorderResult,
          safeErrorCode: entry.safeErrorCode,
          functionName: FUNCTION_NAME,
          requestId,
        });
        if (!recFail.ok) {
          safeLog("test_result_persistence_failed", requestId, {
            stage: "resolver_failure",
          });
        }
      }
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
    const transport = await testAzureOpenAiConnection({
      baseUrl: runtimeBaseUrl,
      apiKey: runtimeApiKey,
      requestId,
    });
    const entry = classifyAzureTransportResult(transport.category);
    const credentialAccepted = transport.category === "success" ||
      transport.category === "permission_denied" ||
      transport.category === "rate_limited";
    const apiAccessible = transport.category === "success";

    safeLog("test", requestId, {
      transport_category: transport.category,
      classification: entry.classification,
      http_status: transport.httpStatus,
      credential_accepted: credentialAccepted,
      api_accessible: apiAccessible,
    });

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
      error: "Azure OpenAI connection testing is temporarily unavailable.",
    });
  }
});
