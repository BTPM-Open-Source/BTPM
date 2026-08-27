// deno-lint-ignore-file no-explicit-any
/**
 * BTPM Import — Commit (Phase 6.3C)
 *
 * Transactionally commits an approved dry-run batch to canonical PM tables:
 * programs, projects, phases, tasks, project_team_members, task_assignments.
 *
 * Risks, blockers, and execution_updates are NOT committed in this step and
 * MUST be empty in the payload.
 *
 * The actual commit runs inside the SECURITY DEFINER RPC
 * `public.commit_btpm_import_v1_core`, invoked with the caller's JWT so
 * `auth.uid()` remains the importer. All inserts are atomic; any failure
 * rolls the whole commit back.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { assertBrowserSessionOnly } from "../_shared/btpm-api/assertBrowserSessionOnly.ts";
import { createSupabaseTokenVerifier } from "../_shared/btpm-api/resolveTokenContext.ts";
import { toSafeErrorResponse } from "../_shared/btpm-api/apiErrors.ts";
import { runContainmentValidation } from "../_shared/btpmImportContainment.ts";

/* -------------------------------------------------------------------------- */

interface Issue {
  severity: "error" | "warning";
  code: string;
  family?: string;
  index?: number;
  external_key?: string;
  field?: string;
  message: string;
}

function jsonResp(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function canonicalStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonicalStringify).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys
    .map((k) => JSON.stringify(k) + ":" + canonicalStringify((v as any)[k]))
    .join(",") + "}";
}

async function sha256Hex(text: string): Promise<string> {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Parse `code: detail` style messages coming from RAISE EXCEPTION in the RPC.
function parseRpcError(err: any): Issue {
  const raw =
    (err && typeof err === "object" && (err.message || err.details || err.hint)) ||
    String(err ?? "unknown_error");
  const msg = String(raw);
  const colonIdx = msg.indexOf(":");
  const code = colonIdx > 0 ? msg.slice(0, colonIdx).trim() : msg.trim();
  const detail = colonIdx > 0 ? msg.slice(colonIdx + 1).trim() : "";
  return {
    severity: "error",
    code: /^[a-z_][a-z0-9_]*$/i.test(code) ? code : "transaction_failed",
    message: detail ? `${code}: ${detail}` : code,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResp(405, { ok: false, error: "method_not_allowed" });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonResp(401, { ok: false, error: "not_authenticated" });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  try {
    const verifier = createSupabaseTokenVerifier(userClient);
    await assertBrowserSessionOnly(req, verifier);
  } catch (guardError) {
    return toSafeErrorResponse(guardError, corsHeaders);
  }

  const token = authHeader.replace("Bearer ", "");
  const claimsRes = await userClient.auth.getClaims(token);
  if (claimsRes.error || !claimsRes.data?.claims?.sub) {
    return jsonResp(401, { ok: false, error: "not_authenticated" });
  }
  const userId = claimsRes.data.claims.sub as string;

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // -------- Body ---------------------------------------------------------
  let body: any;
  try { body = await req.json(); } catch { return jsonResp(400, { ok: false, error: "invalid_json_body" }); }

  const organizationId = typeof body?.organizationId === "string" ? body.organizationId : null;
  const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : null;
  const dryRunBatchId = typeof body?.dryRunBatchId === "string" ? body.dryRunBatchId : null;
  const payload = body?.payload;

  if (!organizationId || !workspaceId || !dryRunBatchId || !isPlainObject(payload)) {
    return jsonResp(400, {
      ok: false,
      error: "invalid_request_shape",
      message: "organizationId, workspaceId, dryRunBatchId, and payload are required.",
    });
  }

  // TAE.11B — v2 payloads are now accepted by the transactional RPC. Both
  // `btpm_import_v1` and `btpm_import_v2` are committed through the same
  // atomic path in `commit_btpm_import_v1_core`.



  // -------- Authority pre-checks (mirror dry-run) ------------------------
  const { data: profile } = await admin
    .from("profiles")
    .select("id, is_active")
    .eq("id", userId)
    .maybeSingle();
  if (!profile) return jsonResp(401, { ok: false, error: "not_authenticated" });
  if (profile.is_active === false) return jsonResp(403, { ok: false, error: "inactive_user" });

  const { data: activeCtx } = await userClient.rpc("get_my_active_context");
  const activeOrgId = activeCtx && typeof activeCtx === "object"
    ? (activeCtx as any).organization_id ?? null
    : null;
  if (activeOrgId && activeOrgId !== organizationId) {
    return jsonResp(403, { ok: false, error: "active_org_mismatch" });
  }

  const { data: isOrgAdmin } = await admin.rpc("is_org_admin", {
    _user_id: userId,
    _organization_id: organizationId,
  });
  if (!isOrgAdmin) return jsonResp(403, { ok: false, error: "org_admin_required" });

  const { data: ws } = await admin
    .from("workspaces")
    .select("id, name, organization_id, is_archived, is_active")
    .eq("id", workspaceId)
    .maybeSingle();
  if (!ws) return jsonResp(404, { ok: false, error: "workspace_not_found" });
  if (ws.organization_id !== organizationId) return jsonResp(403, { ok: false, error: "workspace_not_in_org" });
  if (ws.is_archived || ws.is_active === false) return jsonResp(403, { ok: false, error: "workspace_archived_or_inactive" });

  // -------- Batch pre-checks --------------------------------------------
  const { data: batch } = await admin
    .from("btpm_import_batches")
    .select("*")
    .eq("id", dryRunBatchId)
    .maybeSingle();
  if (!batch) return jsonResp(404, { ok: false, error: "dry_run_batch_not_found" });
  if (batch.organization_id !== organizationId || batch.workspace_id !== workspaceId) {
    return jsonResp(403, { ok: false, error: "dry_run_batch_not_valid" });
  }
  if (batch.requested_by !== userId) {
    return jsonResp(403, { ok: false, error: "dry_run_batch_not_valid" });
  }
  if (batch.committed_at) {
    return jsonResp(409, { ok: false, error: "dry_run_already_committed" });
  }
  if (batch.status !== "dry_run_valid") {
    return jsonResp(409, { ok: false, error: "dry_run_batch_not_valid" });
  }

  const payloadHash = await sha256Hex(canonicalStringify(payload));
  if (batch.payload_hash !== payloadHash) {
    return jsonResp(409, { ok: false, error: "dry_run_payload_mismatch" });
  }

  // -------- Warnings for unsupported/ignored fields ---------------------
  const warnings: Issue[] = [];
  const phases = Array.isArray((payload as any).phases) ? (payload as any).phases : [];
  phases.forEach((p: any, i: number) => {
    if (p?.phase_type) {
      warnings.push({
        severity: "warning",
        code: "phase_type_not_persisted",
        family: "phases",
        index: i,
        external_key: p.external_key,
        field: "phase_type",
        message: "phase_type is currently not persisted by the commit path and was ignored.",
      });
    }
  });
  const team = Array.isArray((payload as any).project_team_members) ? (payload as any).project_team_members : [];
  team.forEach((m: any, i: number) => {
    if (m?.canonical_role_key) {
      warnings.push({
        severity: "warning",
        code: "canonical_role_key_not_persisted",
        family: "project_team_members",
        index: i,
        external_key: m.external_key,
        field: "canonical_role_key",
        message: "canonical_role_key is currently not persisted; only role_label was written.",
      });
    }
  });
  const risks = Array.isArray((payload as any).risks) ? (payload as any).risks : [];
  risks.forEach((r: any, i: number) => {
    if (r?.owner_email) {
      warnings.push({
        severity: "warning",
        code: "owner_email_not_persisted",
        family: "risks",
        index: i,
        external_key: r.external_key,
        field: "owner_email",
        message: "risks table has no owner column; owner_email was validated but not stored.",
      });
    }
  });
  const blockers = Array.isArray((payload as any).blockers) ? (payload as any).blockers : [];
  blockers.forEach((b: any, i: number) => {
    if (b?.owner_email) {
      warnings.push({
        severity: "warning",
        code: "owner_email_not_persisted",
        family: "blockers",
        index: i,
        external_key: b.external_key,
        field: "owner_email",
        message: "blockers table has no owner column; owner_email was validated but not stored.",
      });
    }
  });

  // -------- Re-run containment validation (Step 6.3F) -------------------
  // Guarantees a stale or bypassed dry-run cannot slip an invalid payload
  // into a raw DB constraint failure at commit time.
  {
    const c = runContainmentValidation(payload);
    for (const w of c.warnings) warnings.push(w as Issue);
    if (c.errors.length > 0) {
      return jsonResp(400, {
        ok: false,
        batch_id: dryRunBatchId,
        errors: c.errors as Issue[],
        warnings,
        message:
          "Import blocked by validation re-check at commit. No records were committed.",
      });
    }
  }

  // -------- Run the transactional RPC as the caller ---------------------
  const { data: rpcData, error: rpcError } = await userClient.rpc("commit_btpm_import_v1_core", {
    _organization_id: organizationId,
    _workspace_id: workspaceId,
    _dry_run_batch_id: dryRunBatchId,
    _payload: payload,
    _payload_hash: payloadHash,
  });

  if (rpcError) {
    const issue = parseRpcError(rpcError);
    return jsonResp(400, {
      ok: false,
      batch_id: dryRunBatchId,
      errors: [issue],
      warnings,
      message: "No records were committed; the entire import was rolled back.",
    });
  }

  const summary = (rpcData as any)?.summary ?? {};
  const created = (rpcData as any)?.created ?? {};

  return jsonResp(200, {
    ok: true,
    batch_id: dryRunBatchId,
    summary,
    created,
    warnings,
    errors: [] as Issue[],
  });
});
