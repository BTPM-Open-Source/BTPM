// DC.16 — Issue a short-lived signed URL to download a Decision Case
// Data Package ZIP bundle. The bundle lives in the private btpm-exports
// bucket.
//
// C20C17 — Browser / Service-Role read authority boundary:
//   browser-session guard → authenticated caller → request validation
//   → caller-scoped protected Decision Case resolution
//   → caller-scoped Project READ authority → service-role client
//   → package lookup → package/parent/scope correlation
//   → caller-scoped source-project READ authority → bundle state checks
//   → filename decrypt → signed URL → download metadata → response

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";
import { assertBrowserSessionOnly } from "../_shared/btpm-api/assertBrowserSessionOnly.ts";
import { createSupabaseTokenVerifier } from "../_shared/btpm-api/resolveTokenContext.ts";
import { toSafeErrorResponse } from "../_shared/btpm-api/apiErrors.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json(401, { ok: false, error: "missing_authorization" });

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    try {
      const verifier = createSupabaseTokenVerifier(userClient);
      await assertBrowserSessionOnly(req, verifier);
    } catch (guardError) {
      return toSafeErrorResponse(guardError, corsHeaders);
    }

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json(401, { ok: false, error: "not_authenticated" });
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const recordId: string | undefined = body?.recordId;
    const packageId: string | undefined = body?.packageId;
    if (!recordId || typeof recordId !== "string") {
      return json(400, { ok: false, error: "invalid_request", note: "recordId required" });
    }
    if (!packageId || typeof packageId !== "string") {
      return json(400, { ok: false, error: "invalid_request", note: "packageId required" });
    }

    // ---- Caller-scoped protected Decision Case resolution (C20C17) --------
    const { data: projectSummary, error: summaryError } = await userClient.rpc(
      "get_governance_decision_case_project_summary",
      { _record_id: recordId },
    );
    if (summaryError) {
      const code = (summaryError as { code?: string } | null)?.code ?? "";
      if (code === "P0002") return json(404, { ok: false, error: "record_not_found" });
      if (code === "22023") return json(400, { ok: false, error: "not_decision_case" });
      return json(403, { ok: false, error: "not_authorized" });
    }
    const summary: any = (projectSummary as any) ?? {};
    const projectId: string | undefined = summary?.project_id;
    const organizationId: string | undefined = summary?.organization_id;
    const workspaceId: string | undefined = summary?.workspace_id;
    if (!projectId || !organizationId || !workspaceId) {
      return json(403, { ok: false, error: "not_authorized" });
    }

    // ---- Caller-scoped parent Project READ authority ----------------------
    const { error: readAuthErr } = await userClient.rpc("_gov_assert_project_read", {
      _project_id: projectId,
    });
    if (readAuthErr) return json(403, { ok: false, error: "not_authorized" });

    // Service-role client is constructed ONLY after caller authority.
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // ---- Package lookup ---------------------------------------------------
    const { data: pkg, error: pkgErr } = await admin
      .from("governance_record_copilot_data_packages")
      .select(
        "id, organization_id, workspace_id, project_id, governance_record_id, " +
        "source_project_ids, package_format, bundle_status, bundle_storage_bucket, " +
        "bundle_storage_path, bundle_size_bytes, bundle_filename",
      )
      .eq("id", packageId)
      .maybeSingle();
    if (pkgErr) return json(500, { ok: false, error: "lookup_failed", note: pkgErr.message });
    if (!pkg) return json(404, { ok: false, error: "package_not_found" });

    // ---- Package / parent / scope correlation (non-disclosing) ------------
    const p: any = pkg;
    if (
      p.governance_record_id !== recordId ||
      p.project_id !== projectId ||
      p.organization_id !== organizationId ||
      p.workspace_id !== workspaceId
    ) {
      return json(404, { ok: false, error: "package_not_found" });
    }

    // ---- Source-project containment (caller-scoped) -----------------------
    const sourceIds: string[] = p.source_project_ids ?? [];
    for (const sp of sourceIds) {
      const { error: spErr } = await userClient.rpc("_gov_assert_project_read", {
        _project_id: sp,
      });
      if (spErr) return json(403, { ok: false, error: "not_authorized_source_project" });
    }

    // ---- Bundle state validation (post-authority only) --------------------
    if (p.package_format !== "zip_bundle") {
      return json(400, { ok: false, error: "not_a_zip_bundle" });
    }
    if (!["generated", "partial"].includes(p.bundle_status)) {
      return json(400, { ok: false, error: "bundle_not_available" });
    }
    const bucket = p.bundle_storage_bucket as string;
    const path = p.bundle_storage_path as string;
    const encryptedFilename = p.bundle_filename as string | null;
    if (!bucket || !path) return json(400, { ok: false, error: "bundle_storage_missing" });

    // Decrypt bundle_filename (stored encrypted via trigger)
    let bundleFilename: string | null = null;
    if (encryptedFilename) {
      const { data: dec, error: decErr } = await admin.rpc("btpm_decrypt", {
        _ciphertext: encryptedFilename,
        _org_id: p.organization_id,
      });
      if (decErr) {
        return json(500, { ok: false, error: "decrypt_failed", note: decErr.message });
      }
      bundleFilename = (dec as string) ?? null;
    }
    const safeFilename = bundleFilename ?? "decision-data-bundle.zip";

    const expiresIn = 300;
    const { data: signed, error: signErr } = await admin.storage
      .from(bucket)
      .createSignedUrl(path, expiresIn, {
        download: safeFilename,
      });
    if (signErr || !signed?.signedUrl) {
      return json(500, { ok: false, error: "signed_url_failed", note: signErr?.message ?? "unknown" });
    }

    const nowIso = new Date().toISOString();
    await admin
      .from("governance_record_copilot_data_packages")
      .update({ bundle_downloaded_at: nowIso, bundle_downloaded_by: userId })
      .eq("id", packageId);

    return json(200, {
      ok: true,
      signed_url: signed.signedUrl,
      bundle_filename: bundleFilename,
      bundle_size_bytes: p.bundle_size_bytes ?? null,
      expires_in_seconds: expiresIn,
    });
  } catch (e) {
    return json(500, { ok: false, error: "unhandled", note: String((e as any)?.message ?? e) });
  }
});
