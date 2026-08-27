// send-object-email
// Canonical backend path for Phase 5.3 "send-email-with-object-context".
// - Authenticates the caller via JWT
// - Verifies the caller has project-level PM authority on the object's project
//   (NOT workspace-level — a project PM without workspace-level PM authority
//   is still authorized to send context emails for their project's objects).
// - Loads the object via the existing decrypted RPCs (project / phase / task)
// - Builds a concise summary + deep link
// - Renders the branded BTPM email shell
// - Sends via the tenant SMTP notification pipeline (Phase 4D.11) —
//   not Microsoft Graph, not Supabase Auth SMTP.
// - Persists an encrypted snapshot in email_payload_snapshots (service-side RPC)

import { createClient } from "npm:@supabase/supabase-js@2.50.0";
import { renderBtpmEmail } from "../_shared/emailBrand.ts";
import { sendTenantEmail } from "../_shared/tenantOutboundEmail.ts";
import { assertBrowserSessionOnly } from "../_shared/btpm-api/assertBrowserSessionOnly.ts";
import { createSupabaseTokenVerifier } from "../_shared/btpm-api/resolveTokenContext.ts";
import { toSafeErrorResponse } from "../_shared/btpm-api/apiErrors.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type TargetType = "project" | "phase" | "task";

interface SendBody {
  target_type: TargetType;
  target_id: string;
  recipients: string[]; // 1..n email addresses
  subject?: string;
  message?: string; // optional user-written body
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function escapeHtml(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fmtDate(d: string | null | undefined): string | null {
  if (!d) return null;
  return d;
}

function summaryRowsHtml(rows: Array<[string, string | null | undefined]>): string {
  const visible = rows.filter(([, v]) => v && String(v).trim().length > 0);
  if (visible.length === 0) return "";
  const items = visible
    .map(
      ([k, v]) =>
        `<tr>
          <td style="padding:6px 12px 6px 0; font-size:13px; color:#6b7280; vertical-align:top; white-space:nowrap;">${escapeHtml(k)}</td>
          <td style="padding:6px 0; font-size:13px; color:#111827; vertical-align:top;"><strong>${escapeHtml(String(v))}</strong></td>
        </tr>`,
    )
    .join("");
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 16px 0; border-collapse:collapse;">
      ${items}
    </table>`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!serviceRoleKey || !anonKey) {
      return new Response(JSON.stringify({ error: "Server misconfigured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // User-scoped client (validates JWT + respects RLS for any direct reads).
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    try {
      const verifier = createSupabaseTokenVerifier(userClient);
      await assertBrowserSessionOnly(req, verifier);
    } catch (guardError) {
      return toSafeErrorResponse(guardError, corsHeaders);
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims?.sub) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claimsData.claims.sub as string;

    // ---- input parsing & validation ----
    let body: SendBody;
    try {
      body = (await req.json()) as SendBody;
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { target_type, target_id, recipients, subject: subjectIn, message } = body || ({} as SendBody);

    if (!["project", "phase", "task"].includes(target_type)) {
      return new Response(JSON.stringify({ error: "Invalid target_type" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!target_id || typeof target_id !== "string") {
      return new Response(JSON.stringify({ error: "Missing target_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!Array.isArray(recipients) || recipients.length === 0) {
      return new Response(JSON.stringify({ error: "At least one recipient is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const cleanRecipients = Array.from(
      new Set(
        recipients
          .map((r) => String(r || "").trim())
          .filter((r) => r.length > 0),
      ),
    );
    const invalid = cleanRecipients.filter((r) => !EMAIL_RE.test(r));
    if (invalid.length > 0 || cleanRecipients.length === 0) {
      return new Response(
        JSON.stringify({ error: `Invalid email address(es): ${invalid.join(", ") || "(none)"}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (cleanRecipients.length > 20) {
      return new Response(JSON.stringify({ error: "Too many recipients (max 20)" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userMessage = (message ?? "").toString().slice(0, 4000).trim();

    // ---- load object (decrypted) via existing RPCs (service-side) ----
    let objectName = "";
    let workspaceId = "";
    let organizationId = "";
    let projectId = "";
    let projectName = "";
    let phaseName: string | null = null;
    let summaryRows: Array<[string, string | null | undefined]> = [];

    if (target_type === "project") {
      const { data, error } = await userClient.rpc("get_decrypted_project", { _project_id: target_id });
      if (error || !data) {
        return new Response(JSON.stringify({ error: "Project not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const p: any = typeof data === "string" ? JSON.parse(data) : data;
      objectName = p.name;
      workspaceId = p.workspace_id;
      organizationId = p.organization_id;
      projectId = p.id;
      projectName = p.name;

      // Resolve workspace + program names (best-effort, decrypted RPCs).
      let workspaceName = "";
      let programName: string | null = null;
      try {
        const { data: ws } = await userClient.rpc("get_decrypted_workspace", { _workspace_id: workspaceId });
        const w: any = ws ? (typeof ws === "string" ? JSON.parse(ws) : ws) : null;
        workspaceName = w?.name || "";
      } catch { /* ignore */ }
      if (p.program_id) {
        try {
          const { data: prog } = await userClient
            .from("programs")
            .select("name")
            .eq("id", p.program_id)
            .single();
          programName = prog?.name ?? null;
        } catch { /* ignore */ }
      }

      summaryRows = [
        ["Project", p.name],
        ["Workspace", workspaceName],
        ["Program", programName],
        ["Status", String(p.status || "").replace("_", " ")],
        ["Priority", p.priority],
        ["Start", fmtDate(p.start_date)],
        ["Target end", fmtDate(p.target_end_date)],
      ];
    } else if (target_type === "phase") {
      const { data, error } = await userClient.rpc("get_decrypted_phase", { _phase_id: target_id });
      if (error || !data) {
        return new Response(JSON.stringify({ error: "Phase not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const ph: any = typeof data === "string" ? JSON.parse(data) : data;
      objectName = ph.name;
      workspaceId = ph.workspace_id;
      organizationId = ph.organization_id;
      projectId = ph.project_id;
      phaseName = ph.name;

      try {
        const { data: pj } = await userClient.rpc("get_decrypted_project", { _project_id: ph.project_id });
        const p: any = pj ? (typeof pj === "string" ? JSON.parse(pj) : pj) : null;
        projectName = p?.name || "";
      } catch { /* ignore */ }

      summaryRows = [
        ["Project", projectName],
        ["Phase", ph.name],
        ["Status", String(ph.status || "").replace("_", " ")],
        ["Start", fmtDate(ph.start_date)],
        ["Target end", fmtDate(ph.target_end_date)],
      ];
    } else {
      // task
      const { data, error } = await userClient.rpc("get_decrypted_task", { _task_id: target_id });
      if (error || !data) {
        return new Response(JSON.stringify({ error: "Task not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t: any = typeof data === "string" ? JSON.parse(data) : data;
      objectName = t.name;
      workspaceId = t.workspace_id;
      organizationId = t.organization_id;
      projectId = t.project_id;
      phaseName = t.phase_name || null;

      try {
        const { data: pj } = await userClient.rpc("get_decrypted_project", { _project_id: t.project_id });
        const p: any = pj ? (typeof pj === "string" ? JSON.parse(pj) : pj) : null;
        projectName = p?.name || "";
      } catch { /* ignore */ }

      // Resolve assignee name (single, best-effort).
      let assigneeName: string | null = null;
      const assigneeId = t.task_assignments?.[0]?.assignee_id;
      if (assigneeId) {
        try {
          const { data: ap } = await userClient.rpc("get_decrypted_profile", { _user_id: assigneeId });
          const prof: any = ap ? (typeof ap === "string" ? JSON.parse(ap) : ap) : null;
          assigneeName = prof?.display_name || prof?.email || null;
        } catch { /* ignore */ }
      }

      summaryRows = [
        ["Project", projectName],
        ["Phase", phaseName],
        ["Task", t.name],
        ["Status", String(t.status || "").replace("_", " ")],
        ["Priority", t.priority],
        ["Assignee", assigneeName],
        ["Start", fmtDate(t.start_date)],
        ["Due", fmtDate(t.due_date)],
      ];
    }

    // ---- authority: caller must have project-level PM authority on the object's project ----
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: authorized, error: authErr } = await adminClient.rpc("has_project_pm_authority", {
      _user_id: userId,
      _project_id: projectId,
    });
    if (authErr || !authorized) {
      return new Response(
        JSON.stringify({ error: "You do not have permission to send emails for this object" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ---- sender display name (for the email body, not the From header) ----
    let senderName = "A BTPM user";
    let senderEmail: string | null = null;
    try {
      const { data: me } = await userClient.rpc("get_decrypted_profile", { _user_id: userId });
      const meP: any = me ? (typeof me === "string" ? JSON.parse(me) : me) : null;
      senderName = meP?.display_name || meP?.email || senderName;
      senderEmail = meP?.email || null;
    } catch { /* ignore */ }

    // ---- build deep link + branded email ----
    const appUrl = Deno.env.get("APP_URL")?.trim();
    if (!appUrl) {
      throw new Error("APP_URL is required");
    }
    let deepLink = `${appUrl}`;
    if (target_type === "project") {
      deepLink = `${appUrl}/workspace/${workspaceId}/project/${projectId}`;
    } else if (target_type === "phase") {
      deepLink = `${appUrl}/workspace/${workspaceId}/project/${projectId}/phase/${target_id}`;
    } else {
      deepLink = `${appUrl}/workspace/${workspaceId}/project/${projectId}/task/${target_id}`;
    }

    const typeLabel = target_type.charAt(0).toUpperCase() + target_type.slice(1);
    const defaultSubject = `[BTPM] ${typeLabel}: ${objectName}`;
    const finalSubject =
      typeof subjectIn === "string" && subjectIn.trim().length > 0
        ? subjectIn.trim().slice(0, 200)
        : defaultSubject;

    const intro: string[] = [
      `<strong>${escapeHtml(senderName)}</strong> shared a ${escapeHtml(target_type)} from BTPM with you.`,
    ];
    if (userMessage.length > 0) {
      // Preserve newlines as <br>, escape everything else.
      const escapedMsg = escapeHtml(userMessage).replace(/\r?\n/g, "<br>");
      intro.push(
        `<div style="margin:8px 0 0 0; padding:12px 14px; background:#f9fafb; border-left:3px solid #ED1C24; border-radius:6px; font-size:14px; line-height:1.55; color:#374151; white-space:pre-wrap;">${escapedMsg}</div>`,
      );
    }
    intro.push(
      `<div style="margin-top:18px; font-size:13px; color:#6b7280; text-transform:uppercase; letter-spacing:0.04em; font-weight:700;">${escapeHtml(typeLabel)} summary</div>${summaryRowsHtml(summaryRows)}`,
    );

    const html = renderBtpmEmail({
      title: `${typeLabel}: ${objectName}`,
      intro,
      cta: {
        label: `Open ${target_type} in BTPM`,
        url: deepLink,
        note: "You will need to sign in with your BTPM account. This link does not grant access on its own.",
      },
      outro: [
        "This is a one-off context email — replies will not be tracked in BTPM.",
      ],
    });

    // ---- send via tenant SMTP resolver (Phase 4D.11) ----
    // Per-recipient: enforces outbound_email gate, dedupe (per-recipient event
    // key within 5 minutes), tenant SMTP secret resolution, and audit logging.
    const sendErrors: string[] = [];
    const failureCodes: string[] = [];
    let sentCount = 0;
    let skippedNonProd = 0;
    let skippedDuplicate = 0;
    for (const to of cleanRecipients) {
      const eventKey = `object_context:${target_type}:${target_id}:${to.toLowerCase()}`;
      const result = await sendTenantEmail({
        organizationId,
        workspaceId,
        projectId,
        taskId: target_type === "task" ? target_id : null,
        recipientEmail: to,
        emailType: `object_context_${target_type}`,
        eventKey,
        subject: finalSubject,
        htmlBody: html,
        reason: "send-object-email",
        functionName: "send-object-email",
        metadata: { target_type, target_id },
      });
      if (result.status === "sent") sentCount++;
      else if (result.status === "skipped_non_production") skippedNonProd++;
      else if (result.status === "skipped_duplicate") skippedDuplicate++;
      else {
        if (result.errorCode) failureCodes.push(result.errorCode);
        sendErrors.push(`${to}: ${(result.safeErrorMessage || result.errorCode || "send failed").slice(0, 200)}`);
      }
    }


    // ---- persist encrypted snapshot (service-side RPC; trigger encrypts payload) ----
    const snapshotPayload = JSON.stringify({
      v: 1,
      target_type,
      target_id,
      object_name: objectName,
      project_id: projectId,
      project_name: projectName,
      phase_name: phaseName,
      workspace_id: workspaceId,
      deep_link: deepLink,
      subject: finalSubject,
      sender: { user_id: userId, display_name: senderName, email: senderEmail },
      message: userMessage || null,
      summary: summaryRows
        .filter(([, v]) => v && String(v).trim().length > 0)
        .map(([k, v]) => ({ k, v: String(v) })),
      recipients: cleanRecipients,
      sent_count: sentCount,
      skipped_non_production: skippedNonProd,
      skipped_duplicate: skippedDuplicate,
      failed_count: sendErrors.length,
      errors: sendErrors,
      sent_at: new Date().toISOString(),
    });

    let snapshotId: string | null = null;
    try {
      const { data: snapId, error: snapErr } = await adminClient.rpc("record_object_email_snapshot", {
        _organization_id: organizationId,
        _workspace_id: workspaceId,
        _target_type: target_type,
        _target_id: target_id,
        _payload: snapshotPayload,
      });
      if (snapErr) throw snapErr;
      snapshotId = (snapId as string) ?? null;
    } catch (e: any) {
      console.error("snapshot persist failed:", e?.message || e);
    }

    if (sentCount === 0) {
      const allSkippedNonProd =
        skippedNonProd > 0 && sendErrors.length === 0 && skippedDuplicate === 0;
      const allSkippedDuplicate =
        skippedDuplicate > 0 && sendErrors.length === 0 && skippedNonProd === 0;

      // Pick a friendly, app-level error message + code from the dominant
      // failure so the UI can show a clear toast instead of a generic
      // "non-2xx status" runtime error.
      const dominantCode = failureCodes[0] ?? null;
      let friendlyMessage = "Email send failed. Please try again.";
      let responseCode: string = "send_failed";

      if (allSkippedNonProd) {
        friendlyMessage = "Outbound email is disabled in non-production environments.";
        responseCode = "outbound_email_blocked";
      } else if (allSkippedDuplicate) {
        friendlyMessage = "This email was recently sent — duplicate suppressed.";
        responseCode = "skipped_duplicate";
      } else if (dominantCode === "smtp_integration_disabled" || dominantCode === "smtp_not_configured") {
        friendlyMessage =
          "Tenant SMTP is not enabled. Ask your Tenant Admin to enable the SMTP integration in Admin → Tenant → Integrations.";
        responseCode = dominantCode;
      } else if (dominantCode === "smtp_secret_missing") {
        friendlyMessage =
          "Tenant SMTP is missing a required secret. Ask your Tenant Admin to complete SMTP configuration.";
        responseCode = dominantCode;
      } else if (dominantCode === "outbound_email_blocked") {
        friendlyMessage = "Outbound email is disabled in non-production environments.";
        responseCode = dominantCode;
      } else if (dominantCode === "provider_error") {
        friendlyMessage =
          "Tenant SMTP rejected the send (authentication or provider error). Ask your Tenant Admin to verify SMTP credentials.";
        responseCode = dominantCode;
      }

      // IMPORTANT: return HTTP 200 with ok:false so supabase-js does not raise
      // a generic non-2xx runtime error. The client checks data.ok and shows
      // the friendly `error` string.
      return new Response(
        JSON.stringify({
          ok: false,
          error: friendlyMessage,
          code: responseCode,
          details: sendErrors,
          skipped_non_production: skippedNonProd,
          skipped_duplicate: skippedDuplicate,
          snapshot_id: snapshotId,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }


    return new Response(
      JSON.stringify({
        ok: true,
        sent_count: sentCount,
        skipped_non_production: skippedNonProd,
        skipped_duplicate: skippedDuplicate,
        failed_count: sendErrors.length,
        errors: sendErrors,
        snapshot_id: snapshotId,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("send-object-email error:", err);
    return new Response(JSON.stringify({ error: err?.message || "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
