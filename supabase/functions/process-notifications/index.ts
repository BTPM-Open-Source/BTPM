// process-notifications
// Notification outbox worker. Drains pending rows from `notification_outbox`
// and sends one branded email per item through the BTPM tenant SMTP
// notification pipeline via `sendTenantEmail` (Phase 4D.11 / 4D.11B).
//
// Runtime rules:
// - Uses tenant SMTP resolved from each item's `organization_id`.
// - Respects the tenant `outbound_email` gate (non-production orgs are
//   fail-closed, marked `skipped`).
// - Writes `outbound_email_events` audit rows and applies dedupe.
// - Terminal skip for `skipped_duplicate` / `skipped_non_production` /
//   `failed_configuration` — the outbox row is marked `skipped` so retries
//   do not hammer a disabled tenant SMTP.
// - `failed_provider` is retryable up to 3 attempts.
// - Never falls back to Microsoft Graph or any global SMTP transport.
//
// Scheduler authority (Notification Pipeline Correction Step 1):
// - pg_cron/pg_net authenticates with the dedicated scheduler secret header
//   `x-notification-worker-secret`, compared constant-time against
//   NOTIFICATION_WORKER_SCHEDULER_SECRET. Fail-closed 401 otherwise.
// - SUPABASE_SERVICE_ROLE_KEY is an internal backend credential only and is
//   never accepted from the caller.
import { createClient } from "npm:@supabase/supabase-js@2.50.0";

async function secureSecretEqual(
  provided: string,
  expected: string,
): Promise<boolean> {
  const encoder = new TextEncoder();

  const [providedDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);

  const providedBytes = new Uint8Array(providedDigest);
  const expectedBytes = new Uint8Array(expectedDigest);

  let difference = 0;
  for (let i = 0; i < providedBytes.length; i += 1) {
    difference |= providedBytes[i] ^ expectedBytes[i];
  }

  return difference === 0;
}
import { sendTenantEmail } from "../_shared/tenantOutboundEmail.ts";
import { renderBtpmEmail } from "../_shared/emailBrand.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-notification-worker-secret",
};

function buildDeepLink(
  appUrl: string,
  workspaceId: string,
  projectId: string,
  targetType: string,
  targetId: string
): string {
  return `${appUrl}/workspace/${workspaceId}/project/${projectId}/${targetType}/${targetId}`;
}

function buildEmailHtml(
  eventType: string,
  actorName: string,
  payload: Record<string, string>,
  deepLink: string
): { subject: string; html: string } {
  const projectCtx = payload.project_name ? ` in <strong>${payload.project_name}</strong>` : "";
  const taskName = payload.task_name || "a task";
  const blockerTitle = payload.blocker_title || "";
  const targetName = payload.target_name || (payload.target_type === "phase" ? "a phase" : "a task");

  let subject = "";
  let title = "";
  let intro: string[] = [];

  switch (eventType) {
    case "task_assigned":
      subject = `Task assigned: ${payload.task_name || "Untitled"}`;
      title = "You've been assigned a task";
      intro = [`<strong>${actorName}</strong> assigned you to <strong>${taskName}</strong>${projectCtx}.`];
      break;
    case "blocker_created":
      subject = `Blocker raised on: ${payload.task_name || "Untitled"}`;
      title = "A blocker was raised on your task";
      intro = [`<strong>${actorName}</strong> raised a blocker "<strong>${blockerTitle}</strong>" on <strong>${taskName}</strong>${projectCtx}.`];
      break;
    case "blocker_resolved":
      subject = `Blocker resolved: ${blockerTitle || "Untitled"}`;
      title = "Your reported blocker was resolved";
      intro = [`<strong>${actorName}</strong> resolved the blocker "<strong>${blockerTitle}</strong>" on <strong>${taskName}</strong>${projectCtx}.`];
      break;
    case "mention":
      subject = `You were mentioned in ${payload.target_type === "phase" ? "a phase" : "a task"} discussion`;
      title = "You were mentioned in a discussion";
      intro = [`<strong>${actorName}</strong> mentioned you in a discussion on <strong>${targetName}</strong>${projectCtx}.`];
      break;
    default:
      subject = "BTPM Notification";
      title = "Notification";
      intro = ["You have a new notification."];
  }

  const html = renderBtpmEmail({
    title,
    intro,
    cta: { label: "Open in BTPM", url: deepLink },
  });

  return { subject, html };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Notification Pipeline Correction Step 1 — Secure Scheduler Authentication.
    // The incoming credential is the dedicated scheduler secret carried in
    // `x-notification-worker-secret`. The service-role key is NEVER accepted
    // as an incoming caller credential; it stays internal to this function and
    // is only read AFTER the scheduler secret has been verified.
    const schedulerSecret = Deno.env.get("NOTIFICATION_WORKER_SCHEDULER_SECRET");
    if (!schedulerSecret) {
      // Fail closed: without a configured scheduler secret nothing is authorized.
      return new Response(JSON.stringify({ error: "Server misconfigured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const unauthorizedResponse = () =>
      new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    const presentedSecret = req.headers.get("x-notification-worker-secret");
    if (!presentedSecret) {
      return unauthorizedResponse();
    }
    if (!(await secureSecretEqual(presentedSecret, schedulerSecret))) {
      return unauthorizedResponse();
    }

    // Scheduler authority established — now (and only now) acquire the internal
    // backend credential and construct the privileged client.
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!serviceRoleKey) {
      return new Response(JSON.stringify({ error: "Server misconfigured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);


    const { data: pending, error: fetchErr } = await adminClient
      .from("notification_outbox")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(20);

    if (fetchErr) throw fetchErr;
    if (!pending || pending.length === 0) {
      return new Response(JSON.stringify({ processed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const appUrl = Deno.env.get("APP_URL")?.trim();
    if (!appUrl) {
      throw new Error("APP_URL is required");
    }
    let sent = 0;
    let failed = 0;

    for (const item of pending) {
      try {
        const { data: hasAccess } = await adminClient.rpc("is_workspace_member", {
          _user_id: item.recipient_id,
          _workspace_id: item.workspace_id,
        });

        if (!hasAccess) {
          await adminClient
            .from("notification_outbox")
            .update({ status: "skipped", error_message: "Recipient no longer has workspace access" })
            .eq("id", item.id);
          continue;
        }

        const { data: profile } = await adminClient
          .from("profiles")
          .select("email")
          .eq("id", item.recipient_id)
          .single();

        if (!profile?.email) {
          await adminClient
            .from("notification_outbox")
            .update({ status: "skipped", error_message: "No recipient email" })
            .eq("id", item.id);
          continue;
        }

        let actorName = "Someone";
        if (item.actor_id) {
          // Cron context has no auth.uid(), so we cannot call get_decrypted_profile
          // (which enforces is_active_user(auth.uid())). Read + decrypt directly with
          // the service-role client instead.
          const { data: actorRow } = await adminClient
            .from("profiles")
            .select("display_name, email, organization_id")
            .eq("id", item.actor_id)
            .maybeSingle();
          if (actorRow) {
            let displayName: string | null = null;
            if (actorRow.display_name && actorRow.organization_id) {
              const { data: dec } = await adminClient.rpc("btpm_decrypt", {
                _ciphertext: actorRow.display_name,
                _org_id: actorRow.organization_id,
              });
              displayName = (dec as string | null) ?? null;
            }
            actorName = displayName || actorRow.email || "Someone";
          }
        }

        let payload: Record<string, string> = {};
        if (item.payload) {
          const { data: decrypted } = await adminClient.rpc("btpm_decrypt", {
            _ciphertext: item.payload,
            _org_id: item.organization_id,
          });
          if (decrypted) {
            try { payload = JSON.parse(decrypted); } catch { payload = {}; }
          }
        }

        const deepLink = buildDeepLink(
          appUrl,
          item.workspace_id,
          payload.project_id || "",
          item.target_type,
          item.target_id
        );

        const { subject, html } = buildEmailHtml(item.event_type, actorName, payload, deepLink);

        // Route through tenant SMTP resolver so tenant "SMTP disabled" is respected.
        const result = await sendTenantEmail({
          organizationId: item.organization_id,
          workspaceId: item.workspace_id,
          projectId: payload.project_id || null,
          taskId: item.target_type === "task" ? item.target_id : null,
          recipientUserId: item.recipient_id,
          recipientEmail: profile.email,
          emailType: `notification_${item.event_type}`,
          eventKey: `notification:${item.id}`,
          subject,
          htmlBody: html,
          reason: "process-notifications",
          functionName: "process-notifications",
          metadata: { event_type: item.event_type, target_type: item.target_type },
        });

        if (result.status === "sent") {
          await adminClient
            .from("notification_outbox")
            .update({ status: "sent", sent_at: new Date().toISOString() })
            .eq("id", item.id);
          sent++;
        } else if (
          result.status === "skipped_duplicate" ||
          result.status === "skipped_non_production" ||
          result.status === "failed_configuration"
        ) {
          // Terminal — do not retry. Tenant has SMTP off / not configured, or
          // outbound-email gate blocked us. Retrying won't change anything.
          await adminClient
            .from("notification_outbox")
            .update({
              status: "skipped",
              error_message: (result.safeErrorMessage || result.errorCode || result.status).slice(0, 500),
            })
            .eq("id", item.id);
        } else {
          // failed_provider — retryable up to 3x
          const retries = (item.retry_count || 0) + 1;
          const newStatus = retries >= 3 ? "failed" : "pending";
          await adminClient
            .from("notification_outbox")
            .update({
              status: newStatus,
              retry_count: retries,
              error_message: (result.safeErrorMessage || "provider error").slice(0, 500),
            })
            .eq("id", item.id);
          failed++;
        }
      } catch (sendErr: any) {
        const retries = (item.retry_count || 0) + 1;
        const newStatus = retries >= 3 ? "failed" : "pending";
        await adminClient
          .from("notification_outbox")
          .update({
            status: newStatus,
            retry_count: retries,
            error_message: sendErr?.message?.slice(0, 500) || "Unknown error",
          })
          .eq("id", item.id);
        failed++;
      }
    }

    return new Response(JSON.stringify({ processed: pending.length, sent, failed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("process-notifications error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
