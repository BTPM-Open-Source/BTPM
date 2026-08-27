/**
 * Phase 4D.14A.6A — Microsoft Graph Test Connection Edge Function.
 *
 * Read-only. Acquires one application/client-credentials token for the
 * effective Tenant Microsoft Graph integration, validates safe token claims
 * and application-role presence, and performs a bounded `GET
 * https://graph.microsoft.com/v1.0/$metadata` reachability probe.
 *
 * NEVER touches SharePoint content, files, mailboxes, OneNote, or any BTPM
 * business workflow. NEVER returns tokens, claims, IDs, secret names, Vault
 * metadata, or raw Microsoft error text.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";
import {
  resolveTenantMicrosoftGraphRuntimeConfig,
  TenantMicrosoftGraphError,
} from "../_shared/tenantMicrosoftGraph.ts";
import {
  acquireMicrosoftGraphToken,
  decodeJwtPayload,
  probeMicrosoftGraphApi,
  summarizeGraphTokenClaims,
} from "../_shared/microsoftGraphClient.ts";
import {
  classifyGraphResolverError,
  evaluateGraphTestOutcome,
  type MicrosoftGraphTestClassificationEntry,
} from "../_shared/microsoftGraphTestConnectionHelpers.ts";
import {
  type AuthorityCheckDeps,
  evaluateAuthority,
} from "../_shared/adminAuthority.ts";
import { recordTenantIntegrationTestResult } from "../_shared/tenantIntegrationTestResult.ts";
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
const FUNCTION_NAME = "microsoft-graph-test-connection";

const AUTHORITY_INFRA_MESSAGE =
  "Microsoft Graph authority could not be verified.";
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
      lk.includes("client_id") ||
      lk.includes("tenant_id") ||
      lk.includes("organization_id") ||
      lk.includes("integration_id") ||
      lk.includes("aud") ||
      lk.includes("appid") ||
      lk.includes("azp") ||
      lk.includes("roles") ||
      lk === "body" ||
      lk === "data" ||
      lk === "message"
    ) continue;
    safe[k] = v;
  }
  console.log(`[${FUNCTION_NAME}] ${stage}`, JSON.stringify(safe));
}

function toCompactResponse(
  entry: MicrosoftGraphTestClassificationEntry,
  opts: {
    tokenAcquired: boolean;
    tokenClaimsMatch: boolean;
    applicationPermissionsPresent: boolean;
    graphApiReachable: boolean;
    httpStatus: number | null;
  },
) {
  return {
    ok: entry.classification === "connection_successful",
    classification: entry.classification,
    recommended_next_action: entry.recommended_next_action,
    token_acquired: opts.tokenAcquired,
    token_claims_match: opts.tokenClaimsMatch,
    application_permissions_present: opts.applicationPermissionsPresent,
    graph_api_reachable: opts.graphApiReachable,
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
      return json(403, { error: AUTHORITY_DENIED_MESSAGE });
    }
    const provenRole: "org_admin" | "tenant_admin" =
      authority.outcome === "allowed_org_admin" ? "org_admin" : "tenant_admin";
    safeLog("request", requestId, { role: provenRole });

    // Resolve Microsoft Graph runtime configuration.
    let runtime;
    try {
      runtime = await resolveTenantMicrosoftGraphRuntimeConfig({
        organizationId,
        action: "real_integration",
        reason: "microsoft-graph-read-only-connection-test",
        functionName: FUNCTION_NAME,
        requestId,
      });
    } catch (e) {
      const entry = classifyGraphResolverError(e);
      const internalCode = e instanceof TenantMicrosoftGraphError
        ? e.code
        : "unknown";
      safeLog("runtime.resolve_failed", requestId, {
        classification: entry.classification,
        internal_code: internalCode,
      });
      return json(
        200,
        toCompactResponse(entry, {
          tokenAcquired: false,
          tokenClaimsMatch: false,
          applicationPermissionsPresent: false,
          graphApiReachable: false,
          httpStatus: null,
        }),
      );
    }

    // 1. Acquire token.
    const tokenResult = await acquireMicrosoftGraphToken({
      runtime,
      requestId,
    });

    // 2. Claim checks (only if token acquired).
    const claimChecks = tokenResult.accessToken
      ? summarizeGraphTokenClaims(
        decodeJwtPayload(tokenResult.accessToken),
        runtime,
      )
      : summarizeGraphTokenClaims(null, runtime);

    // 3. Probe (only if token acquired and claims match).
    let probeResult: Awaited<ReturnType<typeof probeMicrosoftGraphApi>> | null =
      null;
    const proceedToProbe = tokenResult.category === "success" &&
      tokenResult.accessToken &&
      claimChecks.aud_is_graph_api &&
      claimChecks.tenant_matches_config &&
      claimChecks.client_matches_config &&
      claimChecks.application_roles_present;
    if (proceedToProbe) {
      probeResult = await probeMicrosoftGraphApi({
        accessToken: tokenResult.accessToken as string,
        requestId,
      });
    }

    const entry = evaluateGraphTestOutcome({
      tokenCategory: tokenResult.category,
      claimChecks,
      probeCategory: probeResult?.category ?? null,
    });

    const compact = {
      tokenAcquired: tokenResult.category === "success" &&
        !!tokenResult.accessToken,
      tokenClaimsMatch: claimChecks.aud_is_graph_api &&
        claimChecks.tenant_matches_config &&
        claimChecks.client_matches_config,
      applicationPermissionsPresent: claimChecks.application_roles_present,
      graphApiReachable: probeResult?.category === "success",
      httpStatus: probeResult?.httpStatus ?? tokenResult.httpStatus,
    };

    safeLog("test", requestId, {
      classification: entry.classification,
      token_acquired: compact.tokenAcquired,
      token_claims_match: compact.tokenClaimsMatch,
      application_permissions_present: compact.applicationPermissionsPresent,
      graph_api_reachable: compact.graphApiReachable,
      http_status: compact.httpStatus,
    });

    const rec = await recordTenantIntegrationTestResult(service, {
      integrationId: runtime.integrationId,
      organizationId: runtime.organizationId,
      actorUserId: userData.user.id,
      result: entry.recorderResult,
      safeErrorCode: entry.safeErrorCode,
      functionName: FUNCTION_NAME,
      requestId,
    });
    if (!rec.ok) safeLog("test_result_persistence_failed", requestId, {});

    return json(200, toCompactResponse(entry, compact));
  } catch (_e) {
    safeLog("unexpected_failure", requestId, {});
    return json(500, {
      error: "Microsoft Graph connection testing is temporarily unavailable.",
    });
  }
});
