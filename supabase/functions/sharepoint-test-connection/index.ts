/**
 * Phase 4D.14A.7A — SharePoint Test Connection Edge Function.
 *
 * Read-only. Resolves the effective Tenant SharePoint site configuration,
 * reuses the migrated Microsoft Graph Tenant credential for a single
 * application-token acquisition, then resolves the configured site and
 * lists accessible document libraries via Microsoft Graph.
 *
 * NEVER performs writes, uploads, deletions, file mutations, project or
 * workspace folder-binding validation, mailbox access, or OneNote access.
 * NEVER returns tokens, claims, IDs, secret names, Vault metadata, or
 * raw Microsoft error text.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";
import {
  resolveTenantSharePointRuntimeConfig,
  TenantSharePointError,
} from "../_shared/tenantSharePoint.ts";
import { resolveAndAcquireTenantMicrosoftGraph } from "../_shared/tenantMicrosoftGraphRuntime.ts";
import {
  listSharePointSiteDrives,
  resolveSharePointSiteById,
  resolveSharePointSiteByPath,
  type SharePointTransportCategory,
} from "../_shared/sharePointClient.ts";
import {
  classifyGraphDependencyPublicError,
  classifySharePointResolverError,
  evaluateSharePointTestOutcome,
  SHAREPOINT_TEST_ENTRIES,
  type SharePointTestClassificationEntry,
} from "../_shared/sharePointTestConnectionHelpers.ts";
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
const FUNCTION_NAME = "sharepoint-test-connection";
const REASON = "sharepoint-read-only-connection-test";

const AUTHORITY_INFRA_MESSAGE =
  "SharePoint authority could not be verified.";
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
      lk.includes("secret") || lk.includes("token") ||
      lk.includes("authorization") || lk.includes("client_id") ||
      lk.includes("tenant_id") || lk.includes("organization_id") ||
      lk.includes("integration_id") || lk.includes("site_id") ||
      lk.includes("site_url") || lk.includes("hostname") ||
      lk.includes("path") || lk.includes("library") ||
      lk === "body" || lk === "data" || lk === "message"
    ) continue;
    safe[k] = v;
  }
  console.log(`[${FUNCTION_NAME}] ${stage}`, JSON.stringify(safe));
}

interface CompactFacts {
  graphTokenAcquired: boolean;
  siteResolved: boolean;
  siteMatchesConfig: boolean;
  librariesAccessible: boolean;
  httpStatus: number | null;
}

function toCompactResponse(
  entry: SharePointTestClassificationEntry,
  facts: CompactFacts,
) {
  return {
    ok: entry.classification === "connection_successful",
    classification: entry.classification,
    recommended_next_action: entry.recommended_next_action,
    graph_token_acquired: facts.graphTokenAcquired,
    site_resolved: facts.siteResolved,
    site_matches_config: facts.siteMatchesConfig,
    libraries_accessible: facts.librariesAccessible,
    http_status: facts.httpStatus,
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
      safeLog("authority_check_failed", requestId);
      return json(403, { error: AUTHORITY_INFRA_MESSAGE });
    }
    if (authority.outcome === "denied") {
      return json(403, { error: AUTHORITY_DENIED_MESSAGE });
    }
    const provenRole: "org_admin" | "tenant_admin" =
      authority.outcome === "allowed_org_admin" ? "org_admin" : "tenant_admin";
    safeLog("request", requestId, { role: provenRole });

    // 1a. Metadata-only lookup for the SharePoint integration ID. This
    // does NOT read secret refs, Vault, or configuration values; it
    // only captures the integration ID for test-result persistence.
    // The full runtime resolver below remains authoritative for
    // enabled/active state and effective configuration.
    let metadataIntegrationId: string | null = null;
    {
      const { data: orgRow } = await service
        .from("organizations")
        .select("tenant_id")
        .eq("id", organizationId)
        .maybeSingle();
      const tenantId = (orgRow?.tenant_id as string | null | undefined) ??
        null;
      if (tenantId) {
        const { data: integRow } = await service
          .from("tenant_integrations")
          .select("id")
          .eq("tenant_id", tenantId)
          .eq("kind", "sharepoint")
          .eq("name", "default")
          .maybeSingle();
        const id = (integRow?.id as string | null | undefined) ?? null;
        if (id) metadataIntegrationId = id;
      }
    }

    // 1b. Resolve SharePoint runtime.
    let spRuntime;
    try {
      spRuntime = await resolveTenantSharePointRuntimeConfig({
        organizationId,
        action: "real_integration",
        reason: REASON,
        functionName: FUNCTION_NAME,
        requestId,
      });
    } catch (e) {
      const entry = classifySharePointResolverError(e);
      const internal = e instanceof TenantSharePointError ? e.code : "unknown";
      safeLog("sp_runtime.resolve_failed", requestId, {
        classification: entry.classification,
        internal_code: internal,
      });
      // Persist resolver failure only when the SharePoint integration
      // row exists. Never auto-create an integration row.
      if (metadataIntegrationId) {
        const rec = await recordTenantIntegrationTestResult(service, {
          integrationId: metadataIntegrationId,
          organizationId,
          actorUserId: userData.user.id,
          result: entry.recorderResult,
          safeErrorCode: entry.safeErrorCode,
          functionName: FUNCTION_NAME,
          requestId,
        });
        if (!rec.ok) safeLog("test_result_persistence_failed", requestId);
      }
      return json(200, toCompactResponse(entry, {
        graphTokenAcquired: false,
        siteResolved: false,
        siteMatchesConfig: false,
        librariesAccessible: false,
        httpStatus: null,
      }));
    }


    // 2. Resolve Graph runtime + token (single acquisition, same request id).
    const graphResult = await resolveAndAcquireTenantMicrosoftGraph({
      organizationId,
      functionName: FUNCTION_NAME,
      reason: REASON,
      requestId,
    });
    if (!graphResult.ok) {
      const entry = classifyGraphDependencyPublicError(graphResult.publicError.error);
      safeLog("graph_dependency_failed", requestId, {
        classification: entry.classification,
        graph_public_code: graphResult.publicError.error,
      });
      const rec = await recordTenantIntegrationTestResult(service, {
        integrationId: spRuntime.integrationId,
        organizationId: spRuntime.organizationId,
        actorUserId: userData.user.id,
        result: entry.recorderResult,
        safeErrorCode: entry.safeErrorCode,
        functionName: FUNCTION_NAME,
        requestId,
      });
      if (!rec.ok) safeLog("test_result_persistence_failed", requestId);
      return json(200, toCompactResponse(entry, {
        graphTokenAcquired: false,
        siteResolved: false,
        siteMatchesConfig: false,
        librariesAccessible: false,
        httpStatus: null,
      }));
    }

    // 3. Site resolution.
    const siteResolveResult = spRuntime.siteId
      ? await resolveSharePointSiteById({
        accessToken: graphResult.accessToken,
        requestId,
        siteId: spRuntime.siteId,
        configuredSiteUrl: spRuntime.siteUrl,
      })
      : await resolveSharePointSiteByPath({
        accessToken: graphResult.accessToken,
        requestId,
        configuredSiteUrl: spRuntime.siteUrl,
      });

    let librariesCategory: SharePointTransportCategory | null = null;
    let librariesHttpStatus: number | null = null;
    let libraryCount = 0;
    let resolvedSiteId: string | null = null;

    if (siteResolveResult.category === "success" && siteResolveResult.site) {
      resolvedSiteId = siteResolveResult.site.siteId;
      const drives = await listSharePointSiteDrives({
        accessToken: graphResult.accessToken,
        requestId,
        siteId: siteResolveResult.site.siteId,
      });
      librariesCategory = drives.category;
      librariesHttpStatus = drives.httpStatus;
      libraryCount = drives.libraryCount;
    }

    const entry = evaluateSharePointTestOutcome({
      siteCategory: siteResolveResult.category,
      librariesCategory,
    });

    const facts: CompactFacts = {
      graphTokenAcquired: true,
      siteResolved: siteResolveResult.category === "success" ||
        siteResolveResult.category === "site_mismatch",
      // Only true when returned webUrl matches configured URL AND site_id
      // matched (if configured). `site_mismatch` implies false.
      siteMatchesConfig: siteResolveResult.category === "success",
      librariesAccessible: librariesCategory === "success" && libraryCount > 0,
      httpStatus: librariesHttpStatus ?? siteResolveResult.httpStatus,
    };

    safeLog("test", requestId, {
      classification: entry.classification,
      graph_token_acquired: facts.graphTokenAcquired,
      site_resolved: facts.siteResolved,
      site_matches_config: facts.siteMatchesConfig,
      libraries_accessible: facts.librariesAccessible,
      library_count: libraryCount,
      http_status: facts.httpStatus,
    });

    const rec = await recordTenantIntegrationTestResult(service, {
      integrationId: spRuntime.integrationId,
      organizationId: spRuntime.organizationId,
      actorUserId: userData.user.id,
      result: entry.recorderResult,
      safeErrorCode: entry.safeErrorCode,
      functionName: FUNCTION_NAME,
      requestId,
    });
    if (!rec.ok) safeLog("test_result_persistence_failed", requestId);

    // 4. Synchronize the compatibility projection when the test succeeds
    //    end-to-end. Uses ONLY server-resolved Tenant runtime values +
    //    live Graph site ID — never browser-supplied coordinates.
    const isFullSuccess = entry.classification === "connection_successful" &&
      facts.graphTokenAcquired && facts.siteResolved &&
      facts.siteMatchesConfig && facts.librariesAccessible;
    if (isFullSuccess) {
      try {
        const { error: syncErr } = await service.rpc(
          "sync_sharepoint_org_site_projection",
          {
            _organization_id: spRuntime.organizationId,
            _site_web_url: spRuntime.siteUrl.href,
            _site_id: resolvedSiteId,
            _site_label_or_name: spRuntime.siteUrl.hostname,
            _validation_status: "validated",
            _validation_code: "ok",
            _validation_note:
              "Synchronized from Tenant SharePoint Test Connection.",
          },
        );
        if (syncErr) safeLog("sharepoint_projection_sync_failed", requestId);
      } catch {
        safeLog("sharepoint_projection_sync_failed", requestId);
      }
    }

    return json(200, toCompactResponse(entry, facts));
  } catch (_e) {
    safeLog("unexpected_failure", requestId);
    return json(500, {
      error: "SharePoint connection testing is temporarily unavailable.",
    });
  }
});

// Re-export to keep bundler happy about unused import in some tools.
export const _entries = SHAREPOINT_TEST_ENTRIES;
