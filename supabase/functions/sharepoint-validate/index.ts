/**
 * Phase 4D.14A.7C + 7C.1 — SharePoint binding validation.
 *
 * Uses the effective Tenant SharePoint integration and the canonical
 * Microsoft Graph Tenant runtime for all live validation. Never reads
 * Global M365_* / BTPM_SP_* env vars, never contains a local Graph token
 * acquirer, never returns raw Microsoft errors.
 *
 * 7C.1 additions:
 *   - Authority is proven BEFORE any SharePoint / Graph runtime resolution
 *     or external Microsoft request, for every action.
 *   - Missing rows, containment mismatches, and unauthorized callers all
 *     return the same fixed 403 response.
 *   - Org-site persistence uses the service-role admin client (the
 *     `apply_org_site_validation` RPC is service-role-only).
 *   - Unknown actions return a fixed message; client input is never echoed.
 */
// deno-lint-ignore-file no-explicit-any

import { createClient } from "npm:@supabase/supabase-js@2.50.0";
import { assertBrowserSessionOnly } from "../_shared/btpm-api/assertBrowserSessionOnly.ts";
import { createSupabaseTokenVerifier } from "../_shared/btpm-api/resolveTokenContext.ts";
import { toSafeErrorResponse } from "../_shared/btpm-api/apiErrors.ts";
import {
  resolveTenantSharePointRuntimeConfig,
  toSafeSharePointPublicError,
} from "../_shared/tenantSharePoint.ts";
import { resolveAndAcquireTenantMicrosoftGraph } from "../_shared/tenantMicrosoftGraphRuntime.ts";
import {
  diagnoseWorkspaceBindingAgainstRuntime,
  SHAREPOINT_BINDING_PUBLIC_NOTES,
  type SafeValidationOutcome,
  validateOrgSiteAgainstRuntime,
  validateProjectBindingAgainstRuntime,
  validateWorkspaceBindingAgainstRuntime,
} from "../_shared/sharePointBindingValidation.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const FUNCTION_NAME = "sharepoint-validate";

const SAFE_FORBIDDEN = { error: "Not authorized" };
const SAFE_UNKNOWN_ACTION = { error: "Unsupported SharePoint validation action." };

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function forbidden(): Response {
  return json(403, SAFE_FORBIDDEN);
}

function safeLog(operation: string, requestId: string, fields: Record<string, unknown> = {}) {
  const safe: Record<string, unknown> = {
    component: FUNCTION_NAME,
    operation,
    request_id: requestId,
  };
  for (const [k, v] of Object.entries(fields)) {
    const lk = k.toLowerCase();
    if (
      lk.includes("secret") || lk.includes("token") ||
      lk.includes("authorization") || lk.includes("site_id") ||
      lk.includes("site_url") || lk.includes("library") ||
      lk.includes("drive") || lk.includes("folder") ||
      lk.includes("path") || lk.includes("name") ||
      lk.includes("organization_id") || lk.includes("workspace_id") ||
      lk.includes("project_id") || lk.includes("binding_id") ||
      lk === "body" || lk === "data" || lk === "message"
    ) continue;
    safe[k] = v;
  }
  console.log(`[${FUNCTION_NAME}] ${operation}`, JSON.stringify(safe));
}

function outcomeFromSharePointError(err: unknown): SafeValidationOutcome {
  const pub = toSafeSharePointPublicError(err);
  const code = pub.error === "sharepoint_access_blocked"
    ? "sharepoint_access_blocked"
    : pub.error === "sharepoint_configuration_invalid"
      ? "sharepoint_configuration_invalid"
      : pub.error === "sharepoint_not_configured"
        ? "sharepoint_not_configured"
        : "sharepoint_unavailable";
  return {
    status: "invalid",
    code,
    note: SHAREPOINT_BINDING_PUBLIC_NOTES[code],
  };
}

function outcomeFromGraphError(pubCode: string): SafeValidationOutcome {
  const code = pubCode === "microsoft_graph_access_blocked"
    ? "sharepoint_access_blocked"
    : pubCode === "microsoft_graph_configuration_invalid" ||
        pubCode === "microsoft_graph_not_configured"
      ? "sharepoint_graph_not_configured"
      : "sharepoint_unavailable";
  return {
    status: "invalid",
    code,
    note: SHAREPOINT_BINDING_PUBLIC_NOTES[code],
  };
}

// -------- Authority helpers (pre-Graph, pre-runtime) --------

async function assertOrgAdmin(
  callerClient: ReturnType<typeof createClient>,
  userId: string,
  organizationId: string,
): Promise<boolean> {
  const { data, error } = await callerClient.rpc("is_org_admin", {
    _user_id: userId,
    _organization_id: organizationId,
  });
  if (error) return false;
  return !!data;
}

async function assertWorkspaceAdminOrHigher(
  callerClient: ReturnType<typeof createClient>,
  userId: string,
  workspaceId: string,
): Promise<boolean> {
  const { data, error } = await callerClient.rpc("is_workspace_admin_or_higher", {
    _user_id: userId,
    _workspace_id: workspaceId,
  });
  if (error) return false;
  return !!data;
}

async function assertProjectPmAuthority(
  callerClient: ReturnType<typeof createClient>,
  userId: string,
  projectId: string,
): Promise<boolean> {
  const { data, error } = await callerClient.rpc("has_project_pm_authority", {
    _user_id: userId,
    _project_id: projectId,
  });
  if (error) return false;
  return !!data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
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
    const { data: userData, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !userData?.user) return json(401, { error: "Not authenticated" });

    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const body = await req.json().catch(() => ({}));
    const action = body?.action as string | undefined;
    const bindingId = body?.binding_id as string | undefined;
    if (!action || !bindingId) {
      return json(400, { error: "action and binding_id are required" });
    }
    safeLog("request", requestId, { action });

    const userId = userData.user.id;
    if (action === "validate_org_site_connection") {
      return await handleValidateOrgSite(bindingId, requestId, adminClient, callerClient, userId);
    }
    if (action === "validate_workspace_binding") {
      return await handleValidateWorkspaceBinding(bindingId, requestId, adminClient, callerClient, userId);
    }
    if (action === "diagnose_workspace_binding") {
      return await handleDiagnoseWorkspaceBinding(bindingId, requestId, adminClient, callerClient, userId);
    }
    if (action === "validate_project_binding") {
      return await handleValidateProjectBinding(bindingId, requestId, adminClient, callerClient, userId);
    }
    return json(400, SAFE_UNKNOWN_ACTION);
  } catch (_e) {
    safeLog("unexpected_failure", requestId);
    return json(500, { error: "SharePoint validation is temporarily unavailable." });
  }
});

// ---------- Action handlers ----------

async function handleValidateOrgSite(
  bindingId: string,
  requestId: string,
  adminClient: ReturnType<typeof createClient>,
  callerClient: ReturnType<typeof createClient>,
  userId: string,
): Promise<Response> {
  const { data: conn, error } = await adminClient
    .from("sharepoint_org_site_connections")
    .select("id, organization_id, site_web_url, site_id, site_label_or_name")
    .eq("id", bindingId)
    .maybeSingle();
  // Missing rows and unauthorized callers must be indistinguishable.
  if (error || !conn) return forbidden();

  // AUTHORITY FIRST — before any Tenant runtime or Graph call.
  const isAdmin = await assertOrgAdmin(callerClient, userId, conn.organization_id as string);
  if (!isAdmin) return forbidden();

  // Resolve Tenant SharePoint runtime.
  let runtime;
  try {
    runtime = await resolveTenantSharePointRuntimeConfig({
      organizationId: conn.organization_id as string,
      action: "real_integration",
      reason: "sharepoint-org-site-validate",
      functionName: FUNCTION_NAME,
      requestId,
    });
  } catch (e) {
    const outcome = outcomeFromSharePointError(e);
    await persistOrgSite(adminClient, bindingId, outcome, null, null);
    return json(200, { result: outcome, connection: await fetchOrgSite(adminClient, bindingId) });
  }

  // Acquire Graph token.
  const g = await resolveAndAcquireTenantMicrosoftGraph({
    organizationId: conn.organization_id as string,
    functionName: FUNCTION_NAME,
    reason: "sharepoint-org-site-validate",
    requestId,
  });
  if (!g.ok) {
    const outcome = outcomeFromGraphError(g.publicError.error);
    await persistOrgSite(adminClient, bindingId, outcome, null, null);
    return json(200, { result: outcome, connection: await fetchOrgSite(adminClient, bindingId) });
  }

  const outcome = await validateOrgSiteAgainstRuntime({
    accessToken: g.accessToken,
    requestId,
    runtime,
  });
  safeLog("org_site.result", requestId, { classification: outcome.code });
  await persistOrgSite(
    adminClient,
    bindingId,
    outcome,
    outcome.site_id ?? null,
    outcome.site_label ?? null,
  );
  const conn2 = await fetchOrgSite(adminClient, bindingId);
  return json(200, { result: outcome, connection: conn2 });
}

async function handleValidateWorkspaceBinding(
  bindingId: string,
  requestId: string,
  adminClient: ReturnType<typeof createClient>,
  callerClient: ReturnType<typeof createClient>,
  userId: string,
): Promise<Response> {
  const { data: binding, error } = await adminClient
    .from("sharepoint_workspace_bindings")
    .select("id, organization_id, workspace_id, site_web_url, library_web_url, binding_status")
    .eq("id", bindingId)
    .maybeSingle();
  if (error || !binding) return forbidden();

  // Containment: workspace exists and shares the binding's Organization.
  const { data: ws } = await adminClient
    .from("workspaces")
    .select("id, organization_id")
    .eq("id", binding.workspace_id as string)
    .maybeSingle();
  if (!ws || ws.organization_id !== binding.organization_id) return forbidden();

  // AUTHORITY FIRST — the persistence RPC requires Org Admin; enforce it here
  // before any Tenant secret resolution or Microsoft Graph call.
  const isAdmin = await assertOrgAdmin(
    callerClient,
    userId,
    binding.organization_id as string,
  );
  if (!isAdmin) return forbidden();

  // Tenant runtime; failure short-circuits with persistence via apply_*.
  let runtime;
  try {
    runtime = await resolveTenantSharePointRuntimeConfig({
      organizationId: binding.organization_id as string,
      action: "real_integration",
      reason: "sharepoint-workspace-validate",
      functionName: FUNCTION_NAME,
      requestId,
    });
  } catch (e) {
    const outcome = outcomeFromSharePointError(e);
    const updated = await persistWorkspace(callerClient, bindingId, outcome);
    return json(200, { result: outcome, binding: updated });
  }

  const g = await resolveAndAcquireTenantMicrosoftGraph({
    organizationId: binding.organization_id as string,
    functionName: FUNCTION_NAME,
    reason: "sharepoint-workspace-validate",
    requestId,
  });
  if (!g.ok) {
    const outcome = outcomeFromGraphError(g.publicError.error);
    const updated = await persistWorkspace(callerClient, bindingId, outcome);
    return json(200, { result: outcome, binding: updated });
  }

  const outcome = await validateWorkspaceBindingAgainstRuntime({
    accessToken: g.accessToken,
    requestId,
    runtime,
    binding: { library_web_url: binding.library_web_url as string | null },
    bindingSiteWebUrl: binding.site_web_url as string | null,
  });
  safeLog("workspace.result", requestId, { classification: outcome.code });
  const updated = await persistWorkspace(callerClient, bindingId, outcome);
  return json(200, { result: outcome, binding: updated });
}

async function handleDiagnoseWorkspaceBinding(
  bindingId: string,
  requestId: string,
  adminClient: ReturnType<typeof createClient>,
  callerClient: ReturnType<typeof createClient>,
  userId: string,
): Promise<Response> {
  const { data: binding, error } = await adminClient
    .from("sharepoint_workspace_bindings")
    .select("id, organization_id, workspace_id, library_web_url")
    .eq("id", bindingId)
    .maybeSingle();
  if (error || !binding) return forbidden();

  // Containment: workspace exists and shares the binding's Organization.
  const { data: ws } = await adminClient
    .from("workspaces")
    .select("id, organization_id")
    .eq("id", binding.workspace_id as string)
    .maybeSingle();
  if (!ws || ws.organization_id !== binding.organization_id) return forbidden();

  // AUTHORITY FIRST — before any Tenant runtime or Graph call.
  const canManage = await assertWorkspaceAdminOrHigher(
    callerClient,
    userId,
    binding.workspace_id as string,
  );
  if (!canManage) return forbidden();

  let runtime;
  try {
    runtime = await resolveTenantSharePointRuntimeConfig({
      organizationId: binding.organization_id as string,
      action: "real_integration",
      reason: "sharepoint-workspace-diagnose",
      functionName: FUNCTION_NAME,
      requestId,
    });
  } catch (e) {
    const outcome = outcomeFromSharePointError(e);
    return json(200, {
      diagnostics: {
        overall_category: outcome.code,
        is_app_only: null,
        stages: [{
          name: "SharePoint runtime resolution",
          ok: false,
          category: outcome.code,
          details: {},
        }],
      },
    });
  }

  const g = await resolveAndAcquireTenantMicrosoftGraph({
    organizationId: binding.organization_id as string,
    functionName: FUNCTION_NAME,
    reason: "sharepoint-workspace-diagnose",
    requestId,
  });
  if (!g.ok) {
    const outcome = outcomeFromGraphError(g.publicError.error);
    return json(200, {
      diagnostics: {
        overall_category: outcome.code,
        is_app_only: null,
        stages: [{
          name: "Microsoft Graph token acquisition",
          ok: false,
          category: outcome.code,
          details: {},
        }],
      },
    });
  }

  const diagnostics = await diagnoseWorkspaceBindingAgainstRuntime({
    accessToken: g.accessToken,
    requestId,
    runtime,
    binding: { library_web_url: binding.library_web_url as string | null },
  });
  safeLog("workspace.diagnose", requestId, { overall: diagnostics.overall_category });
  return json(200, { diagnostics });
}

async function handleValidateProjectBinding(
  bindingId: string,
  requestId: string,
  adminClient: ReturnType<typeof createClient>,
  callerClient: ReturnType<typeof createClient>,
  userId: string,
): Promise<Response> {
  const { data: binding, error } = await adminClient
    .from("sharepoint_project_bindings")
    .select("id, organization_id, workspace_id, project_id, binding_mode, folder_web_url, resolved_site_web_url, resolved_library_web_url")
    .eq("id", bindingId)
    .maybeSingle();
  if (error || !binding) return forbidden();

  // Containment: project exists and matches binding workspace + Organization.
  const { data: proj } = await adminClient
    .from("projects")
    .select("id, workspace_id, organization_id")
    .eq("id", binding.project_id as string)
    .maybeSingle();
  if (
    !proj ||
    proj.workspace_id !== binding.workspace_id ||
    proj.organization_id !== binding.organization_id
  ) {
    return forbidden();
  }

  // AUTHORITY FIRST — project PM authority (Org Admin, workspace admin, or
  // active project_manager) before any runtime, token, or Graph call.
  const canManage = await assertProjectPmAuthority(
    callerClient,
    userId,
    binding.project_id as string,
  );
  if (!canManage) return forbidden();

  // Workspace binding (for default mode) — read-only lookup, no Graph.
  let wb: { binding_status: string | null; site_web_url: string | null; library_web_url: string | null } | null = null;
  if (binding.binding_mode === "workspace_library_default") {
    const { data } = await adminClient
      .from("sharepoint_workspace_bindings")
      .select("binding_status, site_web_url, library_web_url")
      .eq("workspace_id", binding.workspace_id as string)
      .neq("binding_status", "disabled")
      .maybeSingle();
    wb = (data as any) ?? null;
  }

  let runtime;
  try {
    runtime = await resolveTenantSharePointRuntimeConfig({
      organizationId: binding.organization_id as string,
      action: "real_integration",
      reason: "sharepoint-project-validate",
      functionName: FUNCTION_NAME,
      requestId,
    });
  } catch (e) {
    const outcome = outcomeFromSharePointError(e);
    const updated = await persistProject(callerClient, bindingId, outcome);
    return json(200, { result: outcome, binding: updated });
  }

  const g = await resolveAndAcquireTenantMicrosoftGraph({
    organizationId: binding.organization_id as string,
    functionName: FUNCTION_NAME,
    reason: "sharepoint-project-validate",
    requestId,
  });
  if (!g.ok) {
    const outcome = outcomeFromGraphError(g.publicError.error);
    const updated = await persistProject(callerClient, bindingId, outcome);
    return json(200, { result: outcome, binding: updated });
  }

  const outcome = await validateProjectBindingAgainstRuntime({
    accessToken: g.accessToken,
    requestId,
    runtime,
    binding: {
      binding_mode: binding.binding_mode as string | null,
      folder_web_url: binding.folder_web_url as string | null,
      resolved_site_web_url: binding.resolved_site_web_url as string | null,
      resolved_library_web_url: binding.resolved_library_web_url as string | null,
    },
    workspaceBinding: wb,
  });
  safeLog("project.result", requestId, { classification: outcome.code });
  const updated = await persistProject(callerClient, bindingId, outcome);
  return json(200, { result: outcome, binding: updated });
}

// ---------- Persistence helpers ----------

async function persistOrgSite(
  adminClient: ReturnType<typeof createClient>,
  connectionId: string,
  outcome: SafeValidationOutcome,
  siteId: string | null,
  siteLabel: string | null,
): Promise<unknown | null> {
  // apply_org_site_validation is service-role-only (Phase 4D.14A.7C.1);
  // the Edge Function has already proven Org Admin authority.
  const { data, error } = await adminClient.rpc("apply_org_site_validation", {
    _connection_id: connectionId,
    _status: outcome.status,
    _code: outcome.code,
    _note: outcome.note,
    _site_id: siteId,
    _site_label_or_name: siteLabel,
  });
  if (error) return null;
  return data;
}

async function fetchOrgSite(
  adminClient: ReturnType<typeof createClient>,
  connectionId: string,
): Promise<unknown | null> {
  const { data } = await adminClient
    .from("sharepoint_org_site_connections")
    .select("*")
    .eq("id", connectionId)
    .maybeSingle();
  return data;
}

async function persistWorkspace(
  callerClient: ReturnType<typeof createClient>,
  bindingId: string,
  outcome: SafeValidationOutcome,
): Promise<unknown | null> {
  const { data, error } = await callerClient.rpc("apply_workspace_binding_validation", {
    _binding_id: bindingId,
    _status: outcome.status,
    _site_id: outcome.site_id ?? null,
    _library_id_or_drive_id: outcome.drive_id ?? null,
    _site_label_or_name: outcome.site_label ?? null,
    _library_label_or_name: outcome.library_label ?? null,
    _validation_code: outcome.code,
    _validation_note: outcome.note,
  });
  if (error) return null;
  return data;
}

async function persistProject(
  callerClient: ReturnType<typeof createClient>,
  bindingId: string,
  outcome: SafeValidationOutcome,
): Promise<unknown | null> {
  const { data, error } = await callerClient.rpc("apply_project_binding_validation", {
    _binding_id: bindingId,
    _status: outcome.status,
    _folder_item_id: outcome.folder_item_id ?? null,
    _resolved_site_id: outcome.resolved_site_id ?? null,
    _resolved_site_web_url: outcome.resolved_site_web_url ?? null,
    _resolved_library_id_or_drive_id: outcome.resolved_drive_id ?? null,
    _resolved_library_web_url: outcome.resolved_library_web_url ?? null,
    _validation_code: outcome.code,
    _validation_note: outcome.note,
  });
  if (error) return null;
  return data;
}
