// send-team-work-reminders
// Bulk task reminder emails from the Team Work Attention list.
// - JWT-validates caller
// - Loads tasks server-side (never trusts client-supplied names/emails)
// - Verifies caller has has_project_pm_authority on each task's project
// - Skips completed/cancelled/archived and unassigned tasks
// - Groups eligible tasks by assignee email → one branded email per assignee
// - Uses the BTPM tenant SMTP notification pipeline via `sendTenantEmail`
//   (Phase 4D.11 / 4D.11B). Respects the tenant `outbound_email` gate, writes
//   `outbound_email_events` audit rows, applies duplicate-suppression. Does
//   NOT use Microsoft Graph transport and does NOT fall back to global SMTP.
// - Persists one encrypted snapshot per grouped email via record_object_email_snapshot

import { createClient } from "npm:@supabase/supabase-js@2.50.0";
import { sendTenantEmail } from "../_shared/tenantOutboundEmail.ts";
import { renderBtpmEmail } from "../_shared/emailBrand.ts";
import { assertBrowserSessionOnly } from "../_shared/btpm-api/assertBrowserSessionOnly.ts";
import { createSupabaseTokenVerifier } from "../_shared/btpm-api/resolveTokenContext.ts";
import { toSafeErrorResponse } from "../_shared/btpm-api/apiErrors.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MAX_TASKS = 50;

interface ReqBody {
  task_ids: string[];
  message?: string;
}

interface SkipRecord {
  task_id: string;
  reason: string;
}

function escapeHtml(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return String(d);
  }
}

function reasonLabel(t: {
  due_date: string | null;
  status: string;
  priority: string | null;
  open_blocker_count: number;
}): string | null {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (t.open_blocker_count > 0) return "Blocked";
  if (t.due_date) {
    const d = new Date(t.due_date);
    d.setHours(0, 0, 0, 0);
    if (d.getTime() < today.getTime()) return "Overdue";
    if (d.getTime() === today.getTime()) return "Due today";
    return "Upcoming";
  }
  if (t.priority && ["high", "urgent", "critical"].includes(String(t.priority).toLowerCase())) {
    return "High priority";
  }
  return null;
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse(401, { error: "Unauthorized" });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return jsonResponse(500, { error: "Server misconfigured" });
    }

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
    const { data: claimsData, error: claimsErr } =
      await userClient.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims?.sub) {
      return jsonResponse(401, { error: "Unauthorized" });
    }
    const userId = claimsData.claims.sub as string;

    // Body
    let body: ReqBody;
    try {
      body = (await req.json()) as ReqBody;
    } catch {
      return jsonResponse(400, { error: "Invalid JSON body" });
    }
    if (!body || !Array.isArray(body.task_ids) || body.task_ids.length === 0) {
      return jsonResponse(400, { error: "task_ids is required" });
    }
    const rawIds = body.task_ids
      .map((x) => String(x || "").trim())
      .filter((x) => x.length > 0);
    const taskIds = Array.from(new Set(rawIds));
    if (taskIds.length === 0) {
      return jsonResponse(400, { error: "No valid task_ids" });
    }
    if (taskIds.length > MAX_TASKS) {
      return jsonResponse(400, {
        error: `Too many tasks (max ${MAX_TASKS})`,
      });
    }
    const userMessage = (body.message ?? "").toString().slice(0, 2000).trim();

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Verify caller is an active user
    const { data: callerProfile, error: callerErr } = await adminClient
      .from("profiles")
      .select("id, display_name, email, is_active, organization_id")
      .eq("id", userId)
      .maybeSingle();
    if (callerErr || !callerProfile || callerProfile.is_active !== true) {
      return jsonResponse(403, { error: "Caller is not an active BTPM user" });
    }

    // Helper: decrypt an encrypted display_name ciphertext with org scope
    async function decryptName(
      ciphertext: string | null | undefined,
      orgId: string | null | undefined,
    ): Promise<string | null> {
      if (!ciphertext || !orgId) return ciphertext ?? null;
      try {
        const { data } = await adminClient.rpc("btpm_decrypt", {
          _ciphertext: ciphertext,
          _org_id: orgId,
        });
        return (data as string) ?? ciphertext;
      } catch {
        return ciphertext;
      }
    }

    // Load tasks + relations (service-side; names are plaintext)
    const { data: tasksRaw, error: tasksErr } = await adminClient
      .from("tasks")
      .select(
        "id, name, status, priority, due_date, start_date, is_archived, project_id, phase_id, workspace_id, organization_id",
      )
      .in("id", taskIds);
    if (tasksErr) {
      console.error("tasks fetch failed:", tasksErr);
      return jsonResponse(500, { error: "Failed to load tasks" });
    }
    const foundIds = new Set((tasksRaw ?? []).map((t) => t.id));

    const skipped: SkipRecord[] = [];
    for (const id of taskIds) {
      if (!foundIds.has(id)) skipped.push({ task_id: id, reason: "not_found" });
    }

    // Prefetch project/phase names + open blocker counts + assignments
    const projectIds = Array.from(
      new Set((tasksRaw ?? []).map((t) => t.project_id).filter(Boolean)),
    );
    const phaseIds = Array.from(
      new Set((tasksRaw ?? []).map((t) => t.phase_id).filter(Boolean) as string[]),
    );
    const eligibleTaskIds = (tasksRaw ?? []).map((t) => t.id);

    const [projectsRes, phasesRes, assignmentsRes, blockersRes] = await Promise.all([
      projectIds.length
        ? adminClient
            .from("projects")
            .select("id, name, workspace_id, organization_id")
            .in("id", projectIds)
        : Promise.resolve({ data: [], error: null }),
      phaseIds.length
        ? adminClient.from("phases").select("id, name").in("id", phaseIds)
        : Promise.resolve({ data: [], error: null }),
      eligibleTaskIds.length
        ? adminClient
            .from("task_assignments")
            .select("task_id, assignee_id, updated_at, created_at")
            .in("task_id", eligibleTaskIds)
        : Promise.resolve({ data: [], error: null }),
      eligibleTaskIds.length
        ? adminClient
            .from("blockers")
            .select("task_id, status")
            .in("task_id", eligibleTaskIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    const projectMap = new Map<string, any>(
      ((projectsRes as any).data ?? []).map((p: any) => [p.id, p]),
    );
    const phaseMap = new Map<string, any>(
      ((phasesRes as any).data ?? []).map((p: any) => [p.id, p]),
    );
    const openBlockerCounts = new Map<string, number>();
    for (const b of ((blockersRes as any).data ?? []) as any[]) {
      const s = String(b.status || "").toLowerCase();
      if (s !== "resolved" && s !== "closed" && s !== "cancelled") {
        openBlockerCounts.set(b.task_id, (openBlockerCounts.get(b.task_id) ?? 0) + 1);
      }
    }
    // Latest assignment per task
    const latestAssignmentByTask = new Map<string, any>();
    for (const a of ((assignmentsRes as any).data ?? []) as any[]) {
      const cur = latestAssignmentByTask.get(a.task_id);
      const t = new Date(a.updated_at || a.created_at || 0).getTime();
      const ct = cur
        ? new Date(cur.updated_at || cur.created_at || 0).getTime()
        : -1;
      if (!cur || t > ct) latestAssignmentByTask.set(a.task_id, a);
    }

    // Per-task authorization + filtering
    interface Eligible {
      task_id: string;
      task_name: string;
      status: string;
      priority: string | null;
      due_date: string | null;
      project_id: string;
      project_name: string;
      workspace_id: string;
      organization_id: string;
      phase_name: string | null;
      assignee_id: string;
      open_blocker_count: number;
    }
    const eligible: Eligible[] = [];

    // Cache PM authority per project
    const authCache = new Map<string, boolean>();
    async function callerHasPm(projectId: string): Promise<boolean> {
      if (authCache.has(projectId)) return authCache.get(projectId)!;
      const { data, error } = await adminClient.rpc("has_project_pm_authority", {
        _user_id: userId,
        _project_id: projectId,
      });
      const ok = !error && data === true;
      authCache.set(projectId, ok);
      return ok;
    }

    for (const t of (tasksRaw ?? []) as any[]) {
      if (t.is_archived === true) {
        skipped.push({ task_id: t.id, reason: "archived" });
        continue;
      }
      const st = String(t.status || "").toLowerCase();
      if (st === "completed" || st === "cancelled") {
        skipped.push({ task_id: t.id, reason: `status_${st}` });
        continue;
      }
      const project = projectMap.get(t.project_id);
      if (!project) {
        skipped.push({ task_id: t.id, reason: "project_missing" });
        continue;
      }
      const ok = await callerHasPm(t.project_id);
      if (!ok) {
        skipped.push({ task_id: t.id, reason: "no_pm_authority" });
        continue;
      }
      const asg = latestAssignmentByTask.get(t.id);
      if (!asg || !asg.assignee_id) {
        skipped.push({ task_id: t.id, reason: "unassigned" });
        continue;
      }
      eligible.push({
        task_id: t.id,
        task_name: t.name ?? "(Untitled task)",
        status: t.status,
        priority: t.priority ?? null,
        due_date: t.due_date ?? null,
        project_id: t.project_id,
        project_name: project.name ?? "(Untitled project)",
        workspace_id: t.workspace_id || project.workspace_id,
        organization_id: t.organization_id || project.organization_id,
        phase_name: t.phase_id ? phaseMap.get(t.phase_id)?.name ?? null : null,
        assignee_id: asg.assignee_id,
        open_blocker_count: openBlockerCounts.get(t.id) ?? 0,
      });
    }

    // Resolve assignee profiles
    const assigneeIds = Array.from(new Set(eligible.map((e) => e.assignee_id)));
    const { data: profilesRaw } = assigneeIds.length
      ? await adminClient
          .from("profiles")
          .select("id, display_name, email, is_active")
          .in("id", assigneeIds)
      : { data: [] as any[] };
    const profileMap = new Map<string, any>(
      (profilesRaw ?? []).map((p: any) => [p.id, p]),
    );

    // Verify assignee active + has workspace access — group by email
    interface Group {
      email: string;
      name: string;
      tasks: Eligible[];
    }
    const groups = new Map<string, Group>();
    for (const e of eligible) {
      const prof = profileMap.get(e.assignee_id);
      if (!prof || prof.is_active !== true) {
        skipped.push({ task_id: e.task_id, reason: "assignee_inactive" });
        continue;
      }
      if (!prof.email) {
        skipped.push({ task_id: e.task_id, reason: "no_email" });
        continue;
      }
      // Workspace access check (via workspace_memberships)
      const { data: wm } = await adminClient
        .from("workspace_memberships")
        .select("user_id")
        .eq("user_id", e.assignee_id)
        .eq("workspace_id", e.workspace_id)
        .maybeSingle();
      if (!wm) {
        skipped.push({ task_id: e.task_id, reason: "assignee_no_workspace_access" });
        continue;
      }
      const key = String(prof.email).toLowerCase();
      let g = groups.get(key);
      if (!g) {
        const decrypted = await decryptName(prof.display_name, e.organization_id);
        g = { email: prof.email, name: decrypted || prof.email, tasks: [] };
        groups.set(key, g);
      }
      g.tasks.push(e);
    }

    // Sender identity — decrypt display_name (stored as ciphertext)
    const decryptedSenderName = await decryptName(
      callerProfile.display_name,
      callerProfile.organization_id,
    );
    const senderName =
      decryptedSenderName || callerProfile.email || "A BTPM user";

    const appUrl = Deno.env.get("APP_URL")?.trim();
    if (!appUrl) {
      throw new Error("APP_URL is required");
    }
    const errors: string[] = [];
    let sentEmailCount = 0;
    let failedEmailCount = 0;
    let skippedDuplicateCount = 0;
    let skippedNonProdCount = 0;

    for (const [, group] of groups) {
      const listHtml = group.tasks
        .map((t) => {
          const reason = reasonLabel({
            due_date: t.due_date,
            status: t.status,
            priority: t.priority,
            open_blocker_count: t.open_blocker_count,
          });
          const link = `${appUrl}/workspace/${t.workspace_id}/project/${t.project_id}/task/${t.task_id}?from=team-work-reminder`;
          const chips: string[] = [];
          if (reason) chips.push(reason);
          const chipsHtml = chips
            .map(
              (c) =>
                `<span style="display:inline-block; padding:2px 8px; background:#fef2f2; color:#b91c1c; font-size:11px; border-radius:10px; font-weight:600; margin-left:6px;">${escapeHtml(c)}</span>`,
            )
            .join("");
          return `
            <tr>
              <td style="padding:12px 0; border-bottom:1px solid #f1f5f9;">
                <div style="font-size:14px; font-weight:600; color:#111827;">
                  <a href="${link}" style="color:#111827; text-decoration:none;">${escapeHtml(t.task_name)}</a>${chipsHtml}
                </div>
                <div style="font-size:12px; color:#6b7280; margin-top:3px;">
                  ${escapeHtml(t.project_name)}${t.phase_name ? ` · ${escapeHtml(t.phase_name)}` : ""}
                </div>
                <div style="font-size:12px; color:#6b7280; margin-top:3px;">
                  Status: <strong style="color:#374151;">${escapeHtml(String(t.status).replace("_", " "))}</strong>
                  ${t.priority ? ` · Priority: <strong style="color:#374151;">${escapeHtml(t.priority)}</strong>` : ""}
                  · Due: <strong style="color:#374151;">${escapeHtml(fmtDate(t.due_date))}</strong>
                </div>
                <div style="font-size:12px; margin-top:6px;">
                  <a href="${link}" style="color:#ED1C24; text-decoration:underline; font-weight:600;">Open task ↗</a>
                </div>
              </td>
            </tr>`;
        })
        .join("");

      const intro: string[] = [
        `<strong>${escapeHtml(senderName)}</strong> sent you a BTPM task reminder for <strong>${group.tasks.length}</strong> open task${group.tasks.length === 1 ? "" : "s"}.`,
      ];
      if (userMessage) {
        const escapedMsg = escapeHtml(userMessage).replace(/\r?\n/g, "<br>");
        intro.push(
          `<div style="margin:8px 0 0 0; padding:12px 14px; background:#f9fafb; border-left:3px solid #ED1C24; border-radius:6px; font-size:14px; line-height:1.55; color:#374151; white-space:pre-wrap;">${escapedMsg}</div>`,
        );
      }
      intro.push(
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:12px; border-collapse:collapse;">${listHtml}</table>`,
      );
      intro.push(
        `<p style="margin:16px 0 0 0; font-size:12px; color:#6b7280;">You will need to sign in to BTPM. These links do not grant access on their own.</p>`,
      );

      const subject = `[BTPM] Task reminder: ${group.tasks.length} open task${group.tasks.length === 1 ? "" : "s"}`;
      const html = renderBtpmEmail({
        title: "Task reminder",
        intro,
        outro: [
          "This is a one-off reminder — replies will not be tracked in BTPM.",
        ],
      });

      // Route through the tenant SMTP resolver so the tenant "SMTP disabled"
      // integration flag is respected. First task in group carries org/workspace/project.
      const first = group.tasks[0];
      const dateKey = new Date().toISOString().slice(0, 10);
      const eventKey = `team_work_reminder:${first.organization_id}:${group.email.toLowerCase()}:${dateKey}`;

      const result = await sendTenantEmail({
        organizationId: first.organization_id,
        workspaceId: first.workspace_id,
        projectId: first.project_id,
        taskId: first.task_id,
        recipientUserId: first.assignee_id,
        recipientEmail: group.email,
        emailType: "team_work_reminder",
        eventKey,
        subject,
        htmlBody: html,
        reason: "send-team-work-reminders",
        functionName: "send-team-work-reminders",
        metadata: { task_count: group.tasks.length },
      });

      if (result.status === "sent") {
        sentEmailCount++;
      } else if (result.status === "skipped_duplicate") {
        skippedDuplicateCount++;
        errors.push(`${group.email}: recently sent — duplicate suppressed`);
      } else if (result.status === "skipped_non_production") {
        skippedNonProdCount++;
        errors.push(`${group.email}: outbound email disabled in non-production`);
      } else {
        failedEmailCount++;
        const code = result.errorCode ?? "send_failed";
        let friendly = result.safeErrorMessage || "send failed";
        if (code === "smtp_integration_disabled" || code === "smtp_not_configured") {
          friendly = "Tenant SMTP is not enabled. Ask your Tenant Admin to enable the SMTP integration.";
        } else if (code === "smtp_secret_missing") {
          friendly = "Tenant SMTP is missing a required secret. Ask your Tenant Admin to complete SMTP configuration.";
        } else if (code === "provider_error") {
          friendly = "Tenant SMTP rejected the send (authentication or provider error).";
        }
        errors.push(`${group.email}: ${friendly.slice(0, 300)}`);
      }

      // Best-effort audit snapshot — one row per assignee grouped email.
      // Attach to the first task in the group. Kept in addition to
      // outbound_email_events so per-object email history stays intact.
      if (result.status === "sent") {
        const snapshotPayload = JSON.stringify({
          v: 1,
          kind: "team-work-reminders",
          recipient_email: group.email,
          recipient_user_id: first.assignee_id,
          task_count: group.tasks.length,
          message: userMessage || null,
          sender: {
            user_id: userId,
            display_name: callerProfile.display_name,
            email: callerProfile.email,
          },
          tasks: group.tasks.map((t) => ({
            task_id: t.task_id,
            task_name: t.task_name,
            project_id: t.project_id,
            project_name: t.project_name,
            phase_name: t.phase_name,
            status: t.status,
            priority: t.priority,
            due_date: t.due_date,
          })),
          sent_at: new Date().toISOString(),
        });
        try {
          await adminClient.rpc("record_object_email_snapshot", {
            _organization_id: first.organization_id,
            _workspace_id: first.workspace_id,
            _target_type: "task",
            _target_id: first.task_id,
            _payload: snapshotPayload,
          });
        } catch (snapErr: any) {
          console.error("reminder snapshot failed:", snapErr?.message || snapErr);
        }
      }
    }

    return jsonResponse(200, {
      ok: failedEmailCount === 0 && sentEmailCount > 0,
      requested_task_count: taskIds.length,
      eligible_task_count: eligible.length,
      skipped_count: skipped.length,
      sent_email_count: sentEmailCount,
      failed_email_count: failedEmailCount,
      skipped_duplicate: skippedDuplicateCount,
      skipped_non_production: skippedNonProdCount,
      skipped,
      errors,
    });
  } catch (err: any) {
    console.error("send-team-work-reminders error:", err);
    return jsonResponse(500, { error: err?.message || "Internal error" });
  }
});
