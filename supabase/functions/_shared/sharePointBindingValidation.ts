// Phase 4D.14A.7C — Shared SharePoint binding-validation helpers.
//
// Centralizes the logic used by `sharepoint-validate` (org-site,
// workspace-binding, project-binding, diagnostics) around the effective
// Tenant SharePoint runtime and canonical Microsoft Graph transport.
//
// NEVER:
//   - reads M365_* / BTPM_SP_* env vars
//   - acquires Graph tokens itself (caller passes an already-acquired token)
//   - resolves SharePoint credentials directly (caller passes runtime)
//   - logs site URLs, IDs, drive/library IDs or names, folder names, paths,
//     tokens, or raw provider errors
//   - trusts client-supplied identifiers as authoritative
//
// All output values are safe-classified codes/notes; identifiers returned
// to persistence come only from live Graph responses via the transport
// module (not stored client data).

// deno-lint-ignore-file no-explicit-any

import type { SharePointRuntimeConfig } from "./tenantSharePoint.ts";
import {
  classifyDriveItemHttpStatus,
  classifyDrivesHttpStatus,
  classifySiteHttpStatus,
  getSharePointDriveItemByPath,
  getSharePointDriveRoot,
  listSharePointSiteDrivesDetailed,
  resolveSharePointSiteById,
  resolveSharePointSiteByPath,
  type SharePointDriveInfo,
  type SharePointTransportCategory,
} from "./sharePointClient.ts";
import {
  computeFolderRelativePathWithinDrive,
  matchProjectBindingLibrary,
  normalizeSharePointUrlForComparison,
} from "./sharePointProjectBindingRuntime.ts";

// -- classification helpers so the file compiles even if the client file
//    changes its export surface.
export { classifyDriveItemHttpStatus, classifyDrivesHttpStatus, classifySiteHttpStatus };

// ---------- Safe outcome contract ----------

export type SharePointBindingValidationCode =
  | "ok"
  | "sharepoint_not_configured"
  | "sharepoint_graph_not_configured"
  | "sharepoint_access_blocked"
  | "sharepoint_configuration_invalid"
  | "sharepoint_permission_denied"
  | "sharepoint_site_not_found"
  | "sharepoint_site_mismatch"
  | "sharepoint_libraries_unavailable"
  | "workspace_library_not_found"
  | "workspace_library_ambiguous"
  | "workspace_binding_not_validated"
  | "project_folder_not_found"
  | "project_folder_outside_library"
  | "restricted_site_outside_tenant_sharepoint"
  | "sharepoint_timeout"
  | "sharepoint_unavailable"
  | "sharepoint_response_invalid";

export const SHAREPOINT_BINDING_PUBLIC_NOTES: Record<
  SharePointBindingValidationCode,
  string
> = {
  ok: "Validated against the configured SharePoint site.",
  sharepoint_not_configured:
    "The SharePoint Tenant integration is not configured or is incomplete.",
  sharepoint_graph_not_configured:
    "The Microsoft Graph Tenant integration is not configured or is incomplete.",
  sharepoint_access_blocked:
    "SharePoint access is not allowed for this Organization or environment.",
  sharepoint_configuration_invalid:
    "The SharePoint Tenant integration configuration is invalid.",
  sharepoint_permission_denied:
    "SharePoint denied access to the requested resource.",
  sharepoint_site_not_found:
    "The configured SharePoint site could not be found.",
  sharepoint_site_mismatch:
    "The binding site does not match the configured Tenant SharePoint site.",
  sharepoint_libraries_unavailable:
    "No document libraries are accessible on the configured SharePoint site.",
  workspace_library_not_found:
    "The configured workspace library could not be found on the SharePoint site.",
  workspace_library_ambiguous:
    "Multiple libraries match the configured workspace library URL.",
  workspace_binding_not_validated:
    "Validate the workspace SharePoint library binding before validating the project folder.",
  project_folder_not_found:
    "The project's SharePoint folder could not be found.",
  project_folder_outside_library:
    "The project folder is not inside the workspace's SharePoint library.",
  restricted_site_outside_tenant_sharepoint:
    "The project SharePoint site is outside the configured Tenant SharePoint integration.",
  sharepoint_timeout: "SharePoint did not respond in time.",
  sharepoint_unavailable: "SharePoint is temporarily unavailable.",
  sharepoint_response_invalid:
    "Microsoft Graph returned an unexpected SharePoint response.",
};

export interface SafeValidationOutcome {
  status: "validated" | "invalid";
  code: SharePointBindingValidationCode;
  note: string;
  // Server-resolved (never client-supplied) identifiers.
  site_id?: string | null;
  site_label?: string | null;
  drive_id?: string | null;
  library_label?: string | null;
  folder_item_id?: string | null;
  resolved_site_id?: string | null;
  resolved_site_web_url?: string | null;
  resolved_drive_id?: string | null;
  resolved_library_web_url?: string | null;
}

function invalid(
  code: SharePointBindingValidationCode,
): SafeValidationOutcome {
  return { status: "invalid", code, note: SHAREPOINT_BINDING_PUBLIC_NOTES[code] };
}

/** Map a transport category to a safe binding-validation code. */
export function transportToBindingCode(
  category: SharePointTransportCategory,
  ctx: "site" | "libraries" | "folder",
): SharePointBindingValidationCode {
  switch (category) {
    case "success":
      return "ok";
    case "permission_denied":
      return "sharepoint_permission_denied";
    case "token_rejected":
      return "sharepoint_graph_not_configured";
    case "site_not_found":
      return "sharepoint_site_not_found";
    case "site_mismatch":
      return "sharepoint_site_mismatch";
    case "libraries_not_found":
      return ctx === "folder" ? "project_folder_not_found"
        : ctx === "libraries" ? "sharepoint_libraries_unavailable"
        : "sharepoint_libraries_unavailable";
    case "item_not_found":
      return ctx === "folder" ? "project_folder_not_found"
        : "workspace_library_not_found";
    case "rate_limited":
    case "graph_unavailable":
    case "network_error":
      return "sharepoint_unavailable";
    case "timeout":
      return "sharepoint_timeout";
    case "response_invalid":
      return "sharepoint_response_invalid";
  }
}

// ---------- Site helpers ----------

export interface CommonArgs {
  accessToken: string;
  requestId: string;
  runtime: SharePointRuntimeConfig;
  fetchImpl?: typeof fetch;
}

export interface SiteResolveResult {
  ok: boolean;
  siteId: string | null;
  siteWebUrl: string | null;
  category: SharePointTransportCategory;
}

/** Resolve the effective Tenant SharePoint site. Uses siteId when available. */
export async function resolveConfiguredSharePointSite(
  args: CommonArgs,
): Promise<SiteResolveResult> {
  const { accessToken, requestId, runtime, fetchImpl } = args;
  const r = runtime.siteId
    ? await resolveSharePointSiteById({
      accessToken,
      requestId,
      siteId: runtime.siteId,
      configuredSiteUrl: runtime.siteUrl,
      fetchImpl,
    })
    : await resolveSharePointSiteByPath({
      accessToken,
      requestId,
      configuredSiteUrl: runtime.siteUrl,
      fetchImpl,
    });
  if (r.category === "success" && r.site) {
    return {
      ok: true,
      siteId: r.site.siteId,
      siteWebUrl: r.site.webUrl,
      category: "success",
    };
  }
  return {
    ok: false,
    siteId: null,
    siteWebUrl: null,
    category: r.category,
  };
}

// ---------- Org site validation ----------

/**
 * Validate the org-site projection: the projection URL is ignored; site is
 * resolved live from the effective Tenant runtime. Also verifies at least
 * one accessible library.
 */
export async function validateOrgSiteAgainstRuntime(
  args: CommonArgs,
): Promise<SafeValidationOutcome> {
  const site = await resolveConfiguredSharePointSite(args);
  if (!site.ok || !site.siteId || !site.siteWebUrl) {
    return invalid(transportToBindingCode(site.category, "site"));
  }
  const drives = await listSharePointSiteDrivesDetailed({
    accessToken: args.accessToken,
    requestId: args.requestId,
    siteId: site.siteId,
    operation: "resolve_project_root",
    fetchImpl: args.fetchImpl,
  });
  if (drives.category !== "success" || drives.drives.length === 0) {
    return invalid(transportToBindingCode(drives.category, "libraries"));
  }
  return {
    status: "validated",
    code: "ok",
    note: SHAREPOINT_BINDING_PUBLIC_NOTES.ok,
    site_id: site.siteId,
    site_label: args.runtime.siteUrl.hostname,
  };
}

// ---------- Workspace binding validation ----------

export interface WorkspaceBindingInput {
  library_web_url: string | null;
}

/** Result of a workspace library match. */
export interface WorkspaceLibraryMatch {
  status: "ok" | "not_found" | "ambiguous";
  drive: SharePointDriveInfo | null;
}

/** Deterministic library matcher: exact match wins; else prefix container. */
export function matchWorkspaceLibrary(
  drives: SharePointDriveInfo[],
  libraryWebUrl: string | null | undefined,
): WorkspaceLibraryMatch {
  if (!libraryWebUrl) return { status: "not_found", drive: null };
  const target = normalizeSharePointUrlForComparison(libraryWebUrl);
  if (!target) return { status: "not_found", drive: null };
  const exact = drives.filter(
    (d) => normalizeSharePointUrlForComparison(d.webUrl) === target,
  );
  if (exact.length === 1) return { status: "ok", drive: exact[0] };
  if (exact.length > 1) return { status: "ambiguous", drive: null };
  const containers = drives.filter(
    (d) => target.startsWith(normalizeSharePointUrlForComparison(d.webUrl) + "/"),
  );
  if (containers.length === 1) return { status: "ok", drive: containers[0] };
  if (containers.length > 1) return { status: "ambiguous", drive: null };
  return { status: "not_found", drive: null };
}

export async function validateWorkspaceBindingAgainstRuntime(
  args: CommonArgs & { binding: WorkspaceBindingInput; bindingSiteWebUrl: string | null },
): Promise<SafeValidationOutcome> {
  // Binding site must equal the configured Tenant site (case-insensitive).
  const bindingSiteN = normalizeSharePointUrlForComparison(
    args.bindingSiteWebUrl ?? "",
  );
  const runtimeSiteN = args.runtime.siteUrl.href.toLowerCase();
  if (!bindingSiteN || bindingSiteN !== runtimeSiteN) {
    return invalid("sharepoint_site_mismatch");
  }

  const site = await resolveConfiguredSharePointSite(args);
  if (!site.ok || !site.siteId || !site.siteWebUrl) {
    return invalid(transportToBindingCode(site.category, "site"));
  }

  const drives = await listSharePointSiteDrivesDetailed({
    accessToken: args.accessToken,
    requestId: args.requestId,
    siteId: site.siteId,
    operation: "resolve_project_root",
    fetchImpl: args.fetchImpl,
  });
  if (drives.category !== "success" || drives.drives.length === 0) {
    return invalid(transportToBindingCode(drives.category, "libraries"));
  }

  const m = matchWorkspaceLibrary(drives.drives, args.binding.library_web_url);
  if (m.status === "ambiguous") return invalid("workspace_library_ambiguous");
  if (m.status !== "ok" || !m.drive) return invalid("workspace_library_not_found");

  return {
    status: "validated",
    code: "ok",
    note: SHAREPOINT_BINDING_PUBLIC_NOTES.ok,
    site_id: site.siteId,
    site_label: args.runtime.siteUrl.hostname,
    drive_id: m.drive.id,
    library_label: null,
  };
}

// ---------- Project binding validation ----------

export interface ProjectBindingInput {
  binding_mode: string | null;
  folder_web_url: string | null;
  resolved_site_web_url: string | null;
  resolved_library_web_url: string | null;
}

export interface WorkspaceBindingForProject {
  binding_status: string | null;
  site_web_url: string | null;
  library_web_url: string | null;
}

export async function validateProjectBindingAgainstRuntime(
  args: CommonArgs & {
    binding: ProjectBindingInput;
    workspaceBinding: WorkspaceBindingForProject | null;
  },
): Promise<SafeValidationOutcome> {
  const mode = args.binding.binding_mode;
  const folderUrl = args.binding.folder_web_url;
  if (!folderUrl) return invalid("sharepoint_configuration_invalid");

  // Compute effective site + library.
  let effSiteUrl: string | null = null;
  let effLibraryUrl: string | null = null;

  if (mode === "workspace_library_default") {
    const wb = args.workspaceBinding;
    if (
      !wb ||
      wb.binding_status !== "validated" ||
      !wb.site_web_url ||
      !wb.library_web_url
    ) {
      return invalid("workspace_binding_not_validated");
    }
    effSiteUrl = wb.site_web_url;
    effLibraryUrl = wb.library_web_url;
  } else if (mode === "restricted_library_override") {
    effSiteUrl = args.binding.resolved_site_web_url;
    effLibraryUrl = args.binding.resolved_library_web_url;
    if (!effSiteUrl || !effLibraryUrl) {
      return invalid("sharepoint_configuration_invalid");
    }
  } else if (mode === "restricted_site_override") {
    effSiteUrl = args.binding.resolved_site_web_url;
    effLibraryUrl = args.binding.resolved_library_web_url;
    if (!effSiteUrl || !effLibraryUrl) {
      return invalid("sharepoint_configuration_invalid");
    }
    // Single Tenant SharePoint site: reject anything else.
    const eff = normalizeSharePointUrlForComparison(effSiteUrl);
    if (eff !== args.runtime.siteUrl.href.toLowerCase()) {
      return invalid("restricted_site_outside_tenant_sharepoint");
    }
  } else {
    return invalid("sharepoint_configuration_invalid");
  }

  // The effective site must equal the configured Tenant site.
  const effN = normalizeSharePointUrlForComparison(effSiteUrl ?? "");
  if (effN !== args.runtime.siteUrl.href.toLowerCase()) {
    return invalid(
      mode === "restricted_site_override"
        ? "restricted_site_outside_tenant_sharepoint"
        : "sharepoint_site_mismatch",
    );
  }

  // Live site + drive resolution.
  const site = await resolveConfiguredSharePointSite(args);
  if (!site.ok || !site.siteId || !site.siteWebUrl) {
    return invalid(transportToBindingCode(site.category, "site"));
  }

  const drives = await listSharePointSiteDrivesDetailed({
    accessToken: args.accessToken,
    requestId: args.requestId,
    siteId: site.siteId,
    operation: "resolve_project_root",
    fetchImpl: args.fetchImpl,
  });
  if (drives.category !== "success" || drives.drives.length === 0) {
    return invalid(transportToBindingCode(drives.category, "libraries"));
  }

  const drive = matchProjectBindingLibrary(drives.drives, effLibraryUrl);
  if (!drive) return invalid("workspace_library_not_found");

  const relative = computeFolderRelativePathWithinDrive(drive.webUrl, folderUrl);
  if (relative === null) return invalid("project_folder_outside_library");

  const item = relative === "" || relative === "/"
    ? await getSharePointDriveRoot({
      accessToken: args.accessToken,
      requestId: args.requestId,
      driveId: drive.id,
      operation: "resolve_project_root",
      fetchImpl: args.fetchImpl,
    })
    : await getSharePointDriveItemByPath({
      accessToken: args.accessToken,
      requestId: args.requestId,
      driveId: drive.id,
      relativePath: relative,
      operation: "resolve_project_folder",
      fetchImpl: args.fetchImpl,
    });
  if (item.category !== "success" || !item.item) {
    return invalid(transportToBindingCode(item.category, "folder"));
  }

  return {
    status: "validated",
    code: "ok",
    note: SHAREPOINT_BINDING_PUBLIC_NOTES.ok,
    folder_item_id: item.item.id,
    resolved_site_id: site.siteId,
    resolved_site_web_url: site.siteWebUrl,
    resolved_drive_id: drive.id,
    resolved_library_web_url: drive.webUrl,
  };
}

// ---------- Diagnostics ----------

export interface DiagnosticStage {
  name: string;
  ok: boolean;
  category: string;
  details: Record<string, unknown>;
}

export interface DiagnosticsResult {
  overall_category: string;
  is_app_only: boolean | null;
  stages: DiagnosticStage[];
}

/**
 * Sanitized diagnostics for a workspace binding. Reveals only stage
 * name/success/category/http_status/counts — no URLs, IDs, names, tokens,
 * or raw Microsoft errors.
 */
export async function diagnoseWorkspaceBindingAgainstRuntime(
  args: CommonArgs & { binding: WorkspaceBindingInput },
): Promise<DiagnosticsResult> {
  const stages: DiagnosticStage[] = [];

  stages.push({
    name: "Token acquisition",
    ok: true,
    category: "ok",
    details: { app_token_present: true },
  });

  const site = await resolveConfiguredSharePointSite(args);
  const siteCat = site.ok ? "ok" : transportToBindingCode(site.category, "site");
  stages.push({
    name: "Site resolution",
    ok: site.ok,
    category: siteCat,
    details: { site_resolved: site.ok },
  });
  if (!site.ok || !site.siteId) {
    return {
      overall_category: siteCat,
      is_app_only: true,
      stages,
    };
  }

  const drives = await listSharePointSiteDrivesDetailed({
    accessToken: args.accessToken,
    requestId: args.requestId,
    siteId: site.siteId,
    operation: "resolve_project_root",
    fetchImpl: args.fetchImpl,
  });
  const drivesOk = drives.category === "success" && drives.drives.length > 0;
  const drivesCat = drivesOk ? "ok"
    : transportToBindingCode(drives.category, "libraries");
  stages.push({
    name: "Drives enumeration",
    ok: drivesOk,
    category: drivesCat,
    details: {
      http_status: drives.httpStatus,
      library_count: drives.drives.length,
    },
  });
  if (!drivesOk) {
    return { overall_category: drivesCat, is_app_only: true, stages };
  }

  const m = matchWorkspaceLibrary(drives.drives, args.binding.library_web_url);
  const matchCat = m.status === "ok" ? "ok"
    : m.status === "ambiguous" ? "workspace_library_ambiguous"
    : "workspace_library_not_found";
  stages.push({
    name: "Library matching",
    ok: m.status === "ok",
    category: matchCat,
    details: {
      library_matched: m.status === "ok",
    },
  });
  return {
    overall_category: m.status === "ok" ? "ok" : matchCat,
    is_app_only: true,
    stages,
  };
}
