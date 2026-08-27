// Phase 4D.14A.7E — Shared generated-document SharePoint publisher.
//
// Canonical runtime used by every direct generated-report Edge Function
// to publish Word/PowerPoint bytes into SharePoint via the effective
// Organization-aware Tenant SharePoint + Microsoft Graph integrations.
//
// This module NEVER:
//   - queries Supabase or Vault
//   - resolves its own credentials
//   - reads `M365_*` / `BTPM_SP_*` env vars
//   - acquires its own Graph token (uses the canonical shared resolver)
//   - falls back to Global configuration
//   - logs filenames, IDs, tokens, URLs, or raw provider bodies
//
// Callers MUST prove caller authority BEFORE calling
// `createTenantSharePointPublishSession`. Session creation is the first
// point at which any Tenant secret or Graph token is resolved.

// deno-lint-ignore-file no-explicit-any

import {
  resolveTenantSharePointRuntimeConfig,
  toSafeSharePointPublicError,
  type SharePointRuntimeConfig,
} from "./tenantSharePoint.ts";
import { resolveAndAcquireTenantMicrosoftGraph } from "./tenantMicrosoftGraphRuntime.ts";
import {
  getSharePointSiteDefaultDrive,
  resolveSharePointSiteById,
  resolveSharePointSiteByPath,
  uploadSharePointFileBytes,
  type SharePointPublishOperation,
  type SharePointUploadContentType,
} from "./sharePointClient.ts";
import {
  resolveSharePointProjectRoot,
  type ProjectBindingInput,
} from "./sharePointProjectBindingRuntime.ts";
import {
  resolveSharePointWorkspaceLibraryRoot,
  type WorkspaceBindingInput,
} from "./sharePointWorkspaceBindingRuntime.ts";
import { normalizeGraphPublishError } from "./sharepointPublishErrors.ts";

// ---------- Public safe error contract ----------

export type GeneratedDocumentPublishErrorCode =
  // Preserved publish-error semantics
  | "sharepoint_file_locked"
  | "sharepoint_throttled"
  | "sharepoint_name_conflict"
  | "publish_access_denied"
  | "publish_target_missing"
  | "publish_failed"
  // Tenant runtime + configuration semantics
  | "sharepoint_not_configured"
  | "sharepoint_access_blocked"
  | "sharepoint_configuration_invalid"
  | "sharepoint_configuration_unavailable"
  | "microsoft_graph_not_configured"
  | "microsoft_graph_access_blocked"
  | "microsoft_graph_configuration_invalid"
  | "microsoft_graph_configuration_unavailable"
  // Binding / scope semantics
  | "project_folder_not_validated"
  | "workspace_library_not_validated"
  | "cross_organization_scope_not_supported";

export interface GeneratedDocumentPublicError {
  error: GeneratedDocumentPublishErrorCode;
  note: string;
  /** Safe audit note — HTTP status, graph code, request-id class. Never
   *  contains raw Microsoft body, tokens, or IDs. */
  auditNote: string;
}

const NOTES: Record<GeneratedDocumentPublishErrorCode, string> = {
  sharepoint_file_locked:
    "The existing generated file is currently open or locked in SharePoint/Office. " +
    "Close it in PowerPoint, Word, or the browser, wait a minute for Microsoft 365 " +
    "to release the lock, then try again. BTPM did not replace the existing file.",
  sharepoint_throttled:
    "SharePoint is temporarily throttling the request. Wait a moment and try again.",
  sharepoint_name_conflict:
    "SharePoint reported a name conflict for this file. Try again in a moment.",
  publish_access_denied:
    "BTPM does not have permission to write to the linked SharePoint folder.",
  publish_target_missing:
    "The linked SharePoint folder or file no longer exists. Please re-link the project folder.",
  publish_failed: "Publishing to SharePoint failed. Please try again in a moment.",
  sharepoint_not_configured:
    "The SharePoint Tenant integration is not configured or is incomplete.",
  sharepoint_access_blocked:
    "SharePoint access is not allowed for this Organization or environment.",
  sharepoint_configuration_invalid:
    "The SharePoint Tenant integration configuration is invalid.",
  sharepoint_configuration_unavailable:
    "SharePoint configuration is temporarily unavailable.",
  microsoft_graph_not_configured:
    "The Microsoft Graph Tenant integration is not configured or is incomplete.",
  microsoft_graph_access_blocked:
    "Microsoft Graph access is not allowed for this Organization or environment.",
  microsoft_graph_configuration_invalid:
    "The Microsoft Graph Tenant integration configuration is invalid.",
  microsoft_graph_configuration_unavailable:
    "Microsoft Graph configuration is temporarily unavailable.",
  project_folder_not_validated:
    "The project SharePoint folder is not linked or not validated.",
  workspace_library_not_validated:
    "The workspace SharePoint library is not linked or not validated.",
  cross_organization_scope_not_supported:
    "A generated report can include projects from only one Organization.",
};

function pubErr(
  code: GeneratedDocumentPublishErrorCode,
  auditNote?: string,
): GeneratedDocumentPublicError {
  return { error: code, note: NOTES[code], auditNote: auditNote ?? code };
}

// ---------- Publish session ----------

export interface PublishSessionArgs {
  organizationId: string;
  functionName: string;
  reason: string;
  requestId?: string;
}

export interface TenantSharePointPublishSession {
  organizationId: string;
  functionName: string;
  requestId: string;
  runtime: SharePointRuntimeConfig;
  accessToken: string;
}

export type CreatePublishSessionResult =
  | { ok: true; session: TenantSharePointPublishSession }
  | { ok: false; publicError: GeneratedDocumentPublicError };

/**
 * Resolve the effective SharePoint runtime + acquire ONE Microsoft
 * Graph app-only access token for a single invocation. Both resolvers
 * fail closed — no Global fallback. The returned session is
 * Edge-internal only and MUST NOT be returned to browser code.
 */
export async function createTenantSharePointPublishSession(
  args: PublishSessionArgs,
): Promise<CreatePublishSessionResult> {
  const requestId = args.requestId ?? crypto.randomUUID();
  let runtime: SharePointRuntimeConfig;
  try {
    runtime = await resolveTenantSharePointRuntimeConfig({
      organizationId: args.organizationId,
      action: "real_integration",
      functionName: args.functionName,
      reason: args.reason,
      requestId,
    });
  } catch (e) {
    const pub = toSafeSharePointPublicError(e);
    return {
      ok: false,
      publicError: {
        error: pub.error as GeneratedDocumentPublishErrorCode,
        note: pub.note,
        auditNote: pub.error,
      },
    };
  }
  const graph = await resolveAndAcquireTenantMicrosoftGraph({
    organizationId: args.organizationId,
    functionName: args.functionName,
    reason: args.reason,
    requestId,
  });
  if (!graph.ok) {
    return {
      ok: false,
      publicError: {
        error: graph.publicError.error as GeneratedDocumentPublishErrorCode,
        note: graph.publicError.note,
        auditNote: graph.publicError.error,
      },
    };
  }
  return {
    ok: true,
    session: {
      organizationId: args.organizationId,
      functionName: args.functionName,
      requestId,
      runtime,
      accessToken: graph.accessToken,
    },
  };
}

// ---------- Publish targets ----------

export interface PublishTarget {
  driveId: string;
  parentItemId: string;
}

export type ResolvePublishTargetResult =
  | { ok: true; target: PublishTarget }
  | { ok: false; publicError: GeneratedDocumentPublicError };

/**
 * Resolve the publish target for a project-bound report. Requires a
 * validated project binding, live folder resolution within the
 * effective Tenant SharePoint site, and returns only the internal
 * drive/folder identifiers used by the transport upload.
 */
export async function resolveProjectDocumentPublishTarget(args: {
  session: TenantSharePointPublishSession;
  projectBinding: ProjectBindingInput;
}): Promise<ResolvePublishTargetResult> {
  const res = await resolveSharePointProjectRoot({
    accessToken: args.session.accessToken,
    runtime: args.session.runtime,
    binding: args.projectBinding,
    requestId: args.session.requestId,
  });
  if (!res.ok) {
    return { ok: false, publicError: mapProjectRootError(res.publicError.body.error) };
  }
  return {
    ok: true,
    target: { driveId: res.root.driveId, parentItemId: res.root.rootItem.id },
  };
}

/**
 * Resolve the publish target for a workspace-scoped report (Roadmap
 * Status Deck when a single workspace is selected). Requires a
 * validated workspace binding whose site matches the effective Tenant
 * SharePoint site.
 */
export async function resolveWorkspaceDocumentPublishTarget(args: {
  session: TenantSharePointPublishSession;
  workspaceBinding: WorkspaceBindingInput;
}): Promise<ResolvePublishTargetResult> {
  const res = await resolveSharePointWorkspaceLibraryRoot({
    accessToken: args.session.accessToken,
    sharePointRuntime: args.session.runtime,
    workspaceBinding: args.workspaceBinding,
    requestId: args.session.requestId,
  });
  if (!res.ok) {
    return { ok: false, publicError: mapWorkspaceRootError(res.publicError.body.error) };
  }
  return {
    ok: true,
    target: { driveId: res.root.driveId, parentItemId: res.root.rootItem.id },
  };
}

/**
 * Resolve the effective Tenant SharePoint site's default document
 * library root as a publish target. Roadmap Status Deck fallback only.
 * Never uses an arbitrary first drive.
 */
export async function resolveDefaultSiteDocumentPublishTarget(args: {
  session: TenantSharePointPublishSession;
}): Promise<ResolvePublishTargetResult> {
  const { session } = args;
  const runtime = session.runtime;
  const siteRes = runtime.siteId
    ? await resolveSharePointSiteById({
      accessToken: session.accessToken,
      requestId: session.requestId,
      siteId: runtime.siteId,
      configuredSiteUrl: runtime.siteUrl,
    })
    : await resolveSharePointSiteByPath({
      accessToken: session.accessToken,
      requestId: session.requestId,
      configuredSiteUrl: runtime.siteUrl,
    });
  if (siteRes.category !== "success" || !siteRes.site) {
    return { ok: false, publicError: mapTransportToPublish(siteRes.category) };
  }
  const driveRes = await getSharePointSiteDefaultDrive({
    accessToken: session.accessToken,
    requestId: session.requestId,
    siteId: siteRes.site.siteId,
  });
  if (driveRes.category !== "success" || !driveRes.drive) {
    return { ok: false, publicError: mapTransportToPublish(driveRes.category) };
  }
  // Live root resolution via the drive-root helper on the client, using
  // the transport-only helper that already lives in sharePointClient.
  // We inline via a small local call to avoid another shared helper.
  const rootUrl =
    `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(driveRes.drive.id)}/root?$select=id`;
  let rootResp: Response | null = null;
  try {
    rootResp = await fetch(rootUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        Accept: "application/json",
      },
    });
  } catch {
    return { ok: false, publicError: pubErr("publish_failed", "network_error") };
  }
  if (!rootResp.ok) {
    return { ok: false, publicError: mapTransportToPublish("graph_unavailable") };
  }
  let rj: any = null;
  try { rj = await rootResp.json(); } catch { /* ignore */ }
  const parentItemId = typeof rj?.id === "string" ? rj.id : "";
  if (!parentItemId) {
    return { ok: false, publicError: pubErr("publish_failed", "response_invalid") };
  }
  return { ok: true, target: { driveId: driveRes.drive.id, parentItemId } };
}

// ---------- Publish (upload) ----------

export interface PublishedDocument {
  itemId: string;
  webUrl: string;
}

export type PublishGeneratedDocumentResult =
  | { ok: true; item: PublishedDocument }
  | { ok: false; publicError: GeneratedDocumentPublicError };

export async function publishGeneratedDocumentBytes(args: {
  session: TenantSharePointPublishSession;
  target: PublishTarget;
  fileName: string;
  bytes: Uint8Array;
  contentType: SharePointUploadContentType;
  operation: SharePointPublishOperation;
  /**
   * Defaults to "replace" (used by the six 7E generated-report
   * publishers). Lessons Learned (7F) sets "fail" so a 409 remains a
   * safe, distinguishable name-conflict.
   */
  conflictBehavior?: "replace" | "fail";
}): Promise<PublishGeneratedDocumentResult> {
  const res = await uploadSharePointFileBytes({
    accessToken: args.session.accessToken,
    requestId: args.session.requestId,
    driveId: args.target.driveId,
    parentItemId: args.target.parentItemId,
    fileName: args.fileName,
    bytes: args.bytes,
    contentType: args.contentType,
    operation: args.operation,
    conflictBehavior: args.conflictBehavior ?? "replace",
  });
  if (res.ok) {
    return { ok: true, item: { itemId: res.itemId, webUrl: res.webUrl } };
  }
  // Transport-level failure (never got a response).
  if (res.transport !== null || res.httpStatus === null) {
    return {
      ok: false,
      publicError: pubErr(
        "publish_failed",
        `publish_failed transport=${res.transport ?? "unknown"}`,
      ),
    };
  }
  // Provider-relayed failure. Normalize via shared publish-error mapper.
  const norm = normalizeGraphPublishError({
    httpStatus: res.httpStatus,
    body: res.body,
    retryAfter: res.retryAfter,
  });
  return {
    ok: false,
    publicError: {
      error: norm.code as GeneratedDocumentPublishErrorCode,
      note: norm.userNote,
      auditNote: norm.auditNote,
    },
  };
}

// ---------- Internal error mappers ----------

function mapProjectRootError(
  code:
    | "sharepoint_not_configured"
    | "sharepoint_access_blocked"
    | "sharepoint_configuration_invalid"
    | "sharepoint_configuration_unavailable"
    | "microsoft_graph_not_configured"
    | "microsoft_graph_access_blocked"
    | "microsoft_graph_configuration_invalid"
    | "microsoft_graph_configuration_unavailable"
    | "sharepoint_permission_denied"
    | "sharepoint_site_unavailable"
    | "sharepoint_temporarily_unavailable"
    | "project_sharepoint_folder_not_configured"
    | "project_sharepoint_binding_invalid"
    | "bound_library_not_found"
    | "project_folder_not_found"
    | "item_not_found"
    | "outside_project_scope",
): GeneratedDocumentPublicError {
  switch (code) {
    case "sharepoint_not_configured":
    case "sharepoint_access_blocked":
    case "sharepoint_configuration_invalid":
    case "sharepoint_configuration_unavailable":
    case "microsoft_graph_not_configured":
    case "microsoft_graph_access_blocked":
    case "microsoft_graph_configuration_invalid":
    case "microsoft_graph_configuration_unavailable":
      return pubErr(code, code);
    case "sharepoint_permission_denied":
      return pubErr("publish_access_denied", `publish_access_denied ${code}`);
    case "project_sharepoint_folder_not_configured":
    case "project_sharepoint_binding_invalid":
      return pubErr("project_folder_not_validated", `project_folder_not_validated ${code}`);
    case "bound_library_not_found":
    case "project_folder_not_found":
    case "item_not_found":
    case "outside_project_scope":
      return pubErr("publish_target_missing", `publish_target_missing ${code}`);
    case "sharepoint_site_unavailable":
    case "sharepoint_temporarily_unavailable":
    default:
      return pubErr("publish_failed", `publish_failed ${code}`);
  }
}

function mapWorkspaceRootError(
  code:
    | "workspace_binding_not_validated"
    | "workspace_binding_site_mismatch"
    | "workspace_binding_organization_mismatch"
    | "sharepoint_permission_denied"
    | "sharepoint_site_unavailable"
    | "sharepoint_temporarily_unavailable"
    | "library_not_found"
    | "workspace_folder_not_found",
): GeneratedDocumentPublicError {
  switch (code) {
    case "workspace_binding_not_validated":
    case "workspace_binding_site_mismatch":
    case "workspace_binding_organization_mismatch":
      return pubErr("workspace_library_not_validated", `workspace_library_not_validated ${code}`);
    case "sharepoint_permission_denied":
      return pubErr("publish_access_denied", `publish_access_denied ${code}`);
    case "library_not_found":
    case "workspace_folder_not_found":
      return pubErr("publish_target_missing", `publish_target_missing ${code}`);
    case "sharepoint_site_unavailable":
    case "sharepoint_temporarily_unavailable":
    default:
      return pubErr("publish_failed", `publish_failed ${code}`);
  }
}

function mapTransportToPublish(
  category: string,
): GeneratedDocumentPublicError {
  switch (category) {
    case "permission_denied":
      return pubErr("publish_access_denied", "publish_access_denied");
    case "site_not_found":
    case "site_mismatch":
    case "libraries_not_found":
    case "item_not_found":
      return pubErr("publish_target_missing", `publish_target_missing ${category}`);
    case "rate_limited":
      return pubErr("sharepoint_throttled", "sharepoint_throttled");
    case "token_rejected":
      return pubErr("microsoft_graph_configuration_unavailable", "token_rejected");
    default:
      return pubErr("publish_failed", `publish_failed ${category}`);
  }
}
