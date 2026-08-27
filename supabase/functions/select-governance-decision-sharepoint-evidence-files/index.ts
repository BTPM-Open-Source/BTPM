/**
 * DC.15 — Select SharePoint files as Decision Case evidence.
 *
 * Validates each selected drive item against the project's connected
 * SharePoint folder boundary via Graph, then inserts encrypted file
 * references into `public.governance_record_evidence_files`. No file
 * bytes are stored.
 *
 * Phase 4D.14A.7B — Tenant runtime cutover:
 *  - SharePoint site comes from the effective Tenant SharePoint
 *    integration; Graph credentials come from the effective Tenant
 *    Microsoft Graph integration.
 *  - One Graph token is acquired and reused for every item metadata read.
 *  - No `M365_*` / `BTPM_SP_*` reads; no Global fallback.
 *  - Client-supplied `siteId` / `driveId` are only consistency asserts;
 *    stored and hashed identifiers come from the server-resolved
 *    project root and live Graph metadata.
 *  - If runtime resolution fails, no evidence rows are inserted and no
 *    selection activity event is emitted.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";
import {
  resolveTenantSharePointRuntimeConfig,
  toSafeSharePointPublicError,
  TenantSharePointError,
} from "../_shared/tenantSharePoint.ts";
import { resolveAndAcquireTenantMicrosoftGraph } from "../_shared/tenantMicrosoftGraphRuntime.ts";
import {
  isSharePointItemUnderProjectRoot,
  resolveSharePointProjectRoot,
  SHAREPOINT_PROJECT_BINDING_PUBLIC_NOTES,
} from "../_shared/sharePointProjectBindingRuntime.ts";
import { getSharePointDriveItemMetadata } from "../_shared/sharePointClient.ts";
import { assertBrowserSessionOnly } from "../_shared/btpm-api/assertBrowserSessionOnly.ts";
import { createSupabaseTokenVerifier } from "../_shared/btpm-api/resolveTokenContext.ts";
import { toSafeErrorResponse } from "../_shared/btpm-api/apiErrors.ts";

const FUNCTION_NAME = "select-governance-decision-sharepoint-evidence-files";
const MAX_ITEMS = 50;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function logSafe(event: string, fields: Record<string, unknown>) {
  console.log(`[${FUNCTION_NAME}] ${event}`, JSON.stringify({
    component: FUNCTION_NAME,
    ...fields,
  }));
}

function safePublic(
  code: keyof typeof SHAREPOINT_PROJECT_BINDING_PUBLIC_NOTES,
  status: number,
) {
  return json(status, {
    ok: false,
    error: code,
    note: SHAREPOINT_PROJECT_BINDING_PUBLIC_NOTES[code],
  });
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function fileExtensionOf(name: string): string | null {
  const ix = name.lastIndexOf(".");
  if (ix <= 0 || ix === name.length - 1) return null;
  return name.slice(ix + 1).toLowerCase();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const requestId = crypto.randomUUID();
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json(401, { ok: false, error: "missing_auth" });
    const caller = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    try {
      const verifier = createSupabaseTokenVerifier(caller);
      await assertBrowserSessionOnly(req, verifier);
    } catch (guardError) {
      return toSafeErrorResponse(guardError, corsHeaders);
    }
    const { data: userData, error: userErr } = await caller.auth.getUser();
    if (userErr || !userData?.user) {
      return json(401, { ok: false, error: "not_authenticated" });
    }

    const body = await req.json().catch(() => ({}));
    const recordId = body?.recordId as string | undefined;
    const items = Array.isArray(body?.items) ? body.items : [];
    if (!recordId) return json(400, { ok: false, error: "recordId is required" });
    if (items.length === 0) return json(400, { ok: false, error: "items is required" });
    if (items.length > MAX_ITEMS) {
      return json(400, {
        ok: false,
        error: "too_many_items",
        note: `Select at most ${MAX_ITEMS} files at a time.`,
      });
    }

    // 1. Caller-scoped protected Decision Case resolution.
    //    C20C7: this MUST precede any service-role business-table read.
    //    The protected RPC owns: governance_records lookup, Project read
    //    authority and Decision Case kind validation, and returns the
    //    authoritative scope IDs. Client-supplied scope is never trusted.
    const { data: projectSummary, error: summaryError } = await caller.rpc(
      "get_governance_decision_case_project_summary",
      { _record_id: recordId },
    );
    if (summaryError) {
      const code = (summaryError as { code?: string } | null)?.code ?? "";
      if (code === "P0002") return json(404, { ok: false, error: "record_not_found" });
      if (code === "22023") return json(400, { ok: false, error: "not_a_decision_case" });
      logSafe("record_resolution_denied", { request_id: requestId });
      return json(403, { ok: false, error: "forbidden" });
    }
    const summary = projectSummary as {
      project_id?: string;
      workspace_id?: string;
      organization_id?: string;
    } | null;
    const projectId = summary?.project_id;
    const workspaceId = summary?.workspace_id;
    const organizationId = summary?.organization_id;
    if (!projectId || !workspaceId || !organizationId) {
      logSafe("record_resolution_incomplete", { request_id: requestId });
      return json(403, { ok: false, error: "forbidden" });
    }

    // 2. Project write authority (before any service-role read, runtime
    //    resolution, insert or activity write).
    const { error: aErr } = await caller.rpc("_gov_assert_project_write", {
      _project_id: projectId,
    });
    if (aErr) {
      logSafe("authority_denied", { request_id: requestId, operation: "write" });
      return json(403, {
        ok: false,
        error: "forbidden",
        note: "You do not have permission to select SharePoint evidence on this project.",
      });
    }

    // Service-role client is only constructed AFTER caller write authority.
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);


    // 3. Validated binding.
    const { data: binding } = await admin
      .from("sharepoint_project_bindings")
      .select("binding_status, folder_web_url, resolved_library_web_url")
      .eq("project_id", projectId)
      .maybeSingle();
    if (!binding || binding.binding_status !== "validated") {
      return safePublic("project_sharepoint_folder_not_configured", 400);
    }

    // 4. Tenant runtimes — one resolution each per invocation.
    let runtime;
    try {
      runtime = await resolveTenantSharePointRuntimeConfig({
        organizationId: organizationId,
        action: "real_integration",
        functionName: FUNCTION_NAME,
        reason: "decision-case-sharepoint-select",
        requestId,
      });
    } catch (e) {
      const pub = toSafeSharePointPublicError(e);
      const code = e instanceof TenantSharePointError ? e.code : "configuration_unavailable";
      logSafe("sharepoint_runtime_failed", { request_id: requestId, result: code });
      return json(502, { ok: false, error: pub.error, note: pub.note });
    }

    const graph = await resolveAndAcquireTenantMicrosoftGraph({
      organizationId: organizationId,
      functionName: FUNCTION_NAME,
      reason: "decision-case-sharepoint-select",
      requestId,
    });
    if (!graph.ok) {
      logSafe("graph_runtime_failed", {
        request_id: requestId,
        result: graph.publicError.error,
      });
      return json(502, {
        ok: false,
        error: graph.publicError.error,
        note: graph.publicError.note,
      });
    }
    const accessToken = graph.accessToken;

    // 5. Project root — once.
    const rootRes = await resolveSharePointProjectRoot({
      accessToken,
      runtime,
      binding,
      requestId,
    });
    if (!rootRes.ok) {
      const pe = rootRes.publicError;
      logSafe("project_root_failed", {
        request_id: requestId,
        result: pe.body.error,
      });
      // Runtime failure => no evidence inserted, no activity event.
      return json(pe.status, pe.body);
    }
    const root = rootRes.root;

    let inserted = 0;
    let duplicates = 0;
    let failed = 0;
    const perItem: Array<{ itemId: string; status: string; reason?: string }> = [];

    for (const raw of items) {
      const itemId = String(raw?.itemId ?? "");
      const clientDriveId = raw?.driveId ? String(raw.driveId) : "";
      const clientSiteId = raw?.siteId ? String(raw.siteId) : "";
      if (!itemId) {
        failed++;
        perItem.push({ itemId, status: "failed", reason: "missing_ids" });
        continue;
      }
      // Client identifiers are never authoritative; they are only used
      // to reject payloads that assert an inconsistent server-owned
      // scope.
      if (clientDriveId && clientDriveId !== root.driveId) {
        failed++;
        perItem.push({ itemId, status: "failed", reason: "outside_project_scope" });
        continue;
      }
      if (clientSiteId && clientSiteId !== root.siteId) {
        failed++;
        perItem.push({ itemId, status: "failed", reason: "site_mismatch" });
        continue;
      }

      const siteId = root.siteId;
      const driveId = root.driveId;

      const meta = await getSharePointDriveItemMetadata({
        accessToken,
        requestId,
        driveId,
        itemId,
        operation: "read_selected_evidence_item",
      });
      if (meta.category === "item_not_found" || !meta.item) {
        failed++;
        perItem.push({ itemId, status: "failed", reason: "item_not_found" });
        continue;
      }
      if (meta.category !== "success") {
        failed++;
        perItem.push({ itemId, status: "failed", reason: "graph_lookup_failed" });
        continue;
      }
      const it = meta.item;
      if (it.folder) {
        failed++;
        perItem.push({ itemId, status: "failed", reason: "folders_not_selectable" });
        continue;
      }
      if (!isSharePointItemUnderProjectRoot(it, root.rootItem)) {
        failed++;
        perItem.push({ itemId, status: "failed", reason: "outside_project_scope" });
        continue;
      }

      // Canonical hash uses SERVER-resolved siteId/driveId only.
      const canonical = `${siteId}|${driveId}|${itemId}`;
      const refHash = await sha256Hex(canonical);

      const fileName = String(it.name ?? "");
      const evidenceTitleRaw = (raw?.evidenceTitle ?? "").toString().trim();
      const evidenceTitle = evidenceTitleRaw || fileName;
      const evidenceSummary = raw?.evidenceSummary
        ? String(raw.evidenceSummary).trim()
        : null;
      const evidenceDate = raw?.evidenceDate ? String(raw.evidenceDate) : null;
      const relevance = ["high", "medium", "low"].includes(raw?.relevanceLevel)
        ? raw.relevanceLevel
        : "medium";
      const includedInPackage = raw?.includedInPackage === false ? false : true;

      const { error: insErr } = await admin
        .from("governance_record_evidence_files")
        .insert({
          organization_id: organizationId,
          workspace_id: workspaceId,
          project_id: projectId,
          governance_record_id: recordId,
          source_system: "sharepoint",
          site_id: siteId,
          drive_id: driveId,
          item_id: itemId,
          item_reference_hash: refHash,
          file_name: fileName,
          file_extension: fileExtensionOf(fileName),
          mime_type: it.file?.mimeType ?? null,
          size_bytes: typeof it.size === "number" ? it.size : null,
          etag: it.eTag ?? null,
          ctag: it.cTag ?? null,
          sharepoint_last_modified_at: it.lastModifiedDateTime ?? null,
          sharepoint_created_at: it.createdDateTime ?? null,
          parent_path: it.parentReference?.path ?? null,
          sharepoint_web_url: it.webUrl ?? null,
          evidence_title: evidenceTitle,
          evidence_summary: evidenceSummary,
          evidence_date: evidenceDate,
          relevance_level: relevance,
          included_in_package: includedInPackage,
          selected_by: userData.user.id,
          created_by: userData.user.id,
          updated_by: userData.user.id,
        });
      if (insErr) {
        if ((insErr as any).code === "23505") {
          duplicates++;
          perItem.push({ itemId, status: "duplicate" });
        } else {
          failed++;
          perItem.push({ itemId, status: "failed", reason: "insert_failed" });
        }
        continue;
      }
      inserted++;
      perItem.push({ itemId, status: "inserted" });
    }

    // Sanitized activity event (no plaintext names / urls).
    try {
      await admin.rpc("log_activity_event", {
        _organization_id: organizationId,
        _actor_id: userData.user.id,
        _event_type: "governance_record_evidence_files_selected",
        _target_type: "governance_record",
        _target_id: recordId,
        _metadata: {
          project_id: projectId,
          inserted,
          duplicates,
          failed,
          total_requested: items.length,
        },
        _workspace_id: workspaceId,
      });
    } catch (_e) { /* non-fatal */ }

    return json(200, { ok: true, inserted, duplicates, failed, items: perItem });
  } catch (_e) {
    logSafe("unhandled", { request_id: requestId });
    return json(500, { ok: false, error: "unhandled" });
  }
});
