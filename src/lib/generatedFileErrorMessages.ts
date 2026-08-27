// Shared, UI-friendly mapping for generated Office file publish errors.
//
// Used by every generated-doc client wrapper (charter, project status deck,
// roadmap status deck, M365 readiness check) so users never see raw
// Microsoft Graph JSON in toasts/alerts.

export interface GeneratedFileError {
  code?: string | null;
  /** Optional server-supplied note. If it looks like raw JSON, it is ignored. */
  note?: string | null;
}

const KNOWN: Record<string, string> = {
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
  publish_target_locked:
    "The existing generated file is currently open or locked in SharePoint/Office. " +
    "Close it in PowerPoint, Word, or the browser, wait a minute for Microsoft 365 " +
    "to release the lock, then try again. BTPM did not replace the existing file.",
  publish_failed: "Publishing to SharePoint failed. Please try again in a moment.",
  graph_token_failed:
    "BTPM could not authenticate to SharePoint. Please contact your administrator.",
  site_unreachable: "BTPM could not reach the linked SharePoint site.",
  drives_failed: "BTPM could not list the SharePoint libraries.",
  library_not_found: "The linked SharePoint library could not be found.",
  library_resolve_failed: "The SharePoint library could not be resolved.",
  folder_outside_library: "The linked folder is outside the SharePoint library.",
  folder_not_found: "The linked SharePoint folder could not be found.",
  folder_resolve_failed: "Could not resolve the linked SharePoint folder.",
  pptx_generation_failed: "PowerPoint generation failed on the server.",
  generation_failed: "BTPM could not assemble the generated document.",
  data_collection_failed: "Could not collect data for the document.",
  authority_check_failed: "Could not verify your permission. Try again.",
  not_authorized: "You do not have permission to generate this document.",
  forbidden: "You do not have permission to generate this document.",
  not_authenticated: "You are not signed in.",
  missing_authorization: "You are not signed in.",
  unauthorized: "You are not signed in.",
  workspace_library_missing:
    "This workspace is not linked to a SharePoint document library.",
  workspace_library_not_validated:
    "The workspace SharePoint library link is not validated yet.",
  project_folder_missing:
    "Link this project to a SharePoint folder before generating the document.",
  project_folder_disabled:
    "The SharePoint folder link for this project is disabled. Re-link it first.",
  project_folder_not_validated:
    "The SharePoint folder link for this project is not validated yet.",
};

const GENERIC = "Something went wrong while generating the document. Please try again.";

/** True if the string is or contains a raw JSON-looking payload. */
export function looksLikeJsonNote(note: string | null | undefined): boolean {
  if (!note) return false;
  const trimmed = note.trim();
  if (!trimmed) return false;
  if (/^[\{\[]/.test(trimmed)) return true;
  // Common Graph artefact substrings that should never be shown raw.
  return /"innerError"|"client-request-id"|"request-id"|\bresourceLocked\b/i.test(trimmed);
}

/**
 * Map a generated-doc edge function error into a clean user-facing message.
 * Never returns raw JSON. If `code` is unknown and `note` looks like JSON,
 * a generic safe message is returned instead.
 */
export function generatedFileUserMessage(err: GeneratedFileError): string {
  const code = (err.code ?? "").trim();
  if (code && KNOWN[code]) return KNOWN[code];
  const note = (err.note ?? "").trim();
  if (note && !looksLikeJsonNote(note)) return note;
  return GENERIC;
}

export function isFileLockedCode(code: string | null | undefined): boolean {
  if (!code) return false;
  return code === "sharepoint_file_locked" || code === "publish_target_locked";
}
