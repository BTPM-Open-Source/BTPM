// Wave 5 Step 5.5 — Attachment-safe hard-delete edge function.
//
// Flow:
//   1. Verify caller is authenticated (any active org member; the RPCs enforce
//      org_admin authority server-side).
//   2. Resolve target's organization_id.
//   3. Call list_lifecycle_target_attachments (org-admin scoped) to enumerate
//      every attachment file in the cascade tree.
//   4. Delete each storage file via service-role storage API.
//   5. Call purge_attachment_metadata to remove attachment rows.
//   6. Call the canonical hard_delete_<type> RPC. With attachments now gone,
//      the _assert_no_attachments_for_targets guard passes.
//   7. Return summary { storage_deleted, metadata_deleted, hard_delete_ok }.
//
// Authority model: only org admins may complete the chain (the SECURITY
// DEFINER RPCs raise 42501 otherwise). archived-first is enforced inside
// hard_delete_*.

import { createClient } from "npm:@supabase/supabase-js@2";
import { buildBrowserCorsHeaders } from "../_shared/browserCors.ts";
import { assertBrowserSessionOnly } from "../_shared/btpm-api/assertBrowserSessionOnly.ts";
import { createSupabaseTokenVerifier } from "../_shared/btpm-api/resolveTokenContext.ts";
import { toSafeErrorResponse } from "../_shared/btpm-api/apiErrors.ts";

function json(data: unknown, corsHeaders: Record<string, string>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Attachment substrate removed (SharePoint is now the file source-of-truth).

const HARD_DELETE_RPC: Record<string, string> = {
  program: "hard_delete_program",
  project: "hard_delete_project",
  phase: "hard_delete_phase",
  task: "hard_delete_task",
  project_template: "hard_delete_project_template",
  backlog_item: "hard_delete_backlog_item",
  sprint: "hard_delete_sprint",
  board_workflow_state: "hard_delete_board_workflow_state",
  kpi_definition: "hard_delete_kpi_definition",
};

const ORG_TABLE: Record<string, string> = {
  program: "programs",
  project: "projects",
  phase: "phases",
  task: "tasks",
  project_template: "project_templates",
  backlog_item: "backlog_items",
  sprint: "sprints",
  board_workflow_state: "board_workflow_states",
  kpi_definition: "kpi_definitions",
};

Deno.serve(async (req) => {
  const corsHeaders = buildBrowserCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) return json({ error: "Missing authorization" }, corsHeaders, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    try {
      const verifier = createSupabaseTokenVerifier(userClient);
      await assertBrowserSessionOnly(req, verifier);
    } catch (guardError) {
      return toSafeErrorResponse(guardError, corsHeaders);
    }

    const body = await req.json().catch(() => ({}));
    const targetType: string | undefined = body?.target_type;
    const targetId: string | undefined = body?.target_id;

    if (!targetType || !HARD_DELETE_RPC[targetType]) {
      return json({ error: "Invalid target_type" }, corsHeaders, 400);
    }
    if (!targetId || typeof targetId !== "string") {
      return json({ error: "target_id required" }, corsHeaders, 400);
    }

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: "Unauthorized" }, corsHeaders, 401);

    const serviceClient = createClient(supabaseUrl, serviceKey);

    // Resolve organization_id (service-role; RPCs enforce real authority).
    const tbl = ORG_TABLE[targetType];
    const { data: orgRow, error: orgErr } = await serviceClient
      .from(tbl)
      .select("organization_id, workspace_id")
      .eq("id", targetId)
      .maybeSingle();
    if (orgErr) return json({ error: orgErr.message }, corsHeaders, 500);
    if (!orgRow) return json({ error: "Target not found" }, corsHeaders, 404);

    // Attachment cascade removed: files now live in SharePoint, not Supabase Storage.
    // The hard_delete RPCs no longer have an attachment-blocking guard to satisfy.
    const storageDeleted = 0;
    const metadataDeleted = 0;

    // Call canonical hard_delete RPC.
    const rpcName = HARD_DELETE_RPC[targetType];
    const { error: hdErr } = await userClient.rpc(rpcName as any, { _id: targetId });
    if (hdErr) {
      const msg = hdErr.message || "Hard delete failed";
      let status = 500;
      if (msg.includes("Forbidden")) status = 403;
      else if (msg.includes("must be archived")) status = 409;
      else if (msg.includes("not found")) status = 404;
      return json({
        error: msg,
        storage_deleted: storageDeleted,
        metadata_deleted: metadataDeleted,
        hard_delete_ok: false,
      }, corsHeaders, status);
    }

    return json({
      success: true,
      target_type: targetType,
      target_id: targetId,
      storage_deleted: storageDeleted,
      metadata_deleted: metadataDeleted,
      hard_delete_ok: true,
    }, corsHeaders);
  } catch (e) {
    return json({ error: "Internal error: " + (e as Error).message }, corsHeaders, 500);
  }
});
