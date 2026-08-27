// Phase 4D.14A.7F — Lessons Learned pure SharePoint helpers.
//
// This module is intentionally I/O-free. It contains ONLY:
//   - pure filename derivation for the deterministic Lessons Learned doc
//   - fixed safe-error codes + user-safe notes returned by the Lessons
//     Learned create/refresh Edge Functions
//
// This module NEVER:
//   - reads environment credentials or configuration
//   - resolves Tenant SharePoint or Microsoft Graph runtime
//   - acquires Graph tokens
//   - queries Supabase or Vault
//   - performs template-copy or polling
//   - logs filenames, IDs, URLs, tokens, or response bodies

/**
 * SharePoint disallowed characters: \ / : * ? " < > | # %
 * Multi-space collapsed to a single space and trimmed. Behavior is
 * preserved exactly from the legacy helper so filenames remain stable
 * across the 7F cutover.
 */
export function sanitizeLessonsLearnedFileName(raw: string): string {
  return (raw ?? "")
    .replace(/[\\/:*?"<>|#%]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Deterministic Lessons Learned filename.
 * `Lessons Learned - {sanitized project name}.docx`
 * Falls back to `Project` if the input is empty/whitespace-only.
 */
export function buildLessonsLearnedFileName(projectName: string): string {
  const clean = sanitizeLessonsLearnedFileName(projectName);
  const safe = clean.length > 0 ? clean : "Project";
  return `Lessons Learned - ${safe}.docx`;
}

// ------------- Fixed safe public error contract ---------------

export type LessonsLearnedPublicErrorCode =
  // Tenant runtime + configuration semantics (mirrors the 7E publisher)
  | "sharepoint_not_configured"
  | "sharepoint_access_blocked"
  | "sharepoint_configuration_invalid"
  | "sharepoint_configuration_unavailable"
  | "microsoft_graph_not_configured"
  | "microsoft_graph_access_blocked"
  | "microsoft_graph_configuration_invalid"
  | "microsoft_graph_configuration_unavailable"
  // Project binding semantics
  | "project_sharepoint_folder_not_configured"
  | "project_sharepoint_binding_invalid"
  | "project_folder_not_found"
  // Transport / provider semantics
  | "sharepoint_permission_denied"
  | "sharepoint_timeout"
  | "sharepoint_unavailable"
  | "sharepoint_response_invalid"
  // Lessons Learned specific
  | "document_name_conflict"
  | "document_upload_failed"
  | "document_metadata_unavailable"
  | "metadata_upsert_failed"
  | "template_build_failed";

export const LESSONS_LEARNED_PUBLIC_NOTES: Record<
  LessonsLearnedPublicErrorCode,
  string
> = {
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
  project_sharepoint_folder_not_configured:
    "This project is not linked to a validated SharePoint folder yet.",
  project_sharepoint_binding_invalid:
    "This project's SharePoint folder binding is not valid.",
  project_folder_not_found:
    "The project's SharePoint folder could not be found.",
  sharepoint_permission_denied:
    "SharePoint denied access to the Lessons Learned folder.",
  sharepoint_timeout:
    "SharePoint did not respond in time. Please try again shortly.",
  sharepoint_unavailable:
    "SharePoint is temporarily unavailable. Please try again shortly.",
  sharepoint_response_invalid:
    "SharePoint returned an unexpected response. Please try again shortly.",
  document_name_conflict:
    "An item with the Lessons Learned filename already exists but is not a Word document. BTPM did not replace it.",
  document_upload_failed:
    "The Lessons Learned document could not be uploaded to SharePoint.",
  document_metadata_unavailable:
    "The Lessons Learned document metadata could not be read from SharePoint.",
  metadata_upsert_failed:
    "The Lessons Learned metadata could not be saved.",
  template_build_failed:
    "The Lessons Learned starter document could not be generated.",
};

export interface LessonsLearnedPublicError {
  code: LessonsLearnedPublicErrorCode;
  note: string;
}

export function lessonsLearnedPublicError(
  code: LessonsLearnedPublicErrorCode,
): LessonsLearnedPublicError {
  return { code, note: LESSONS_LEARNED_PUBLIC_NOTES[code] };
}
