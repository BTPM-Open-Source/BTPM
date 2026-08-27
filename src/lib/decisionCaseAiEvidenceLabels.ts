/**
 * AI.7.4 — Shared Decision Case AI evidence label helpers.
 *
 * Used by both:
 *  - the production Decision Brief tab evidence summary, and
 *  - the Admin Decision Case evidence reading diagnostic,
 * so handling labels for document/file, image, and email evidence stay
 * consistent.
 *
 * The helpers infer display kind from existing backend fields (`status`,
 * `input_kind`, `file_extension`, `mime_type`) without surfacing any raw
 * file content, base64, SharePoint/Graph identifiers, or OpenAI payload.
 */

export type EvidenceFileStatusCode =
  | "sent"
  | "unsupported_file_type"
  | "file_too_large"
  | "total_size_limit_exceeded"
  | "missing_identifiers"
  | "graph_token_unavailable"
  | "download_failed"
  | "model_does_not_support_image_input"
  | "no_readable_email_body"
  // Permissive fallthrough for any future codes
  | (string & {});

export interface EvidenceFileLike {
  status: EvidenceFileStatusCode;
  input_kind?: string | null;
  file_extension?: string | null;
  mime_type?: string | null;
}

const EMAIL_EXTS = new Set(["eml"]);
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp", "gif"]);

function normalizeExt(ext: string | null | undefined): string {
  return (ext ?? "").toLowerCase().replace(/^\./, "");
}

export function isEmailTextResult(f: EvidenceFileLike): boolean {
  const ext = normalizeExt(f.file_extension);
  if (EMAIL_EXTS.has(ext)) return true;
  if ((f.mime_type ?? "").toLowerCase() === "message/rfc822") return true;
  return false;
}

export function isImageInputResult(f: EvidenceFileLike): boolean {
  if (f.input_kind === "input_image") return true;
  const ext = normalizeExt(f.file_extension);
  if (IMAGE_EXTS.has(ext)) return true;
  if ((f.mime_type ?? "").toLowerCase().startsWith("image/")) return true;
  return false;
}

/**
 * One-line label describing how an evidence file was handled — for use in
 * lists/tables. Covers both `sent` (file/image/email) and skip reasons.
 */
export function getEvidenceInputHandlingLabel(f: EvidenceFileLike): string {
  if (f.status === "sent") {
    if (isImageInputResult(f)) return "Sent as image input";
    if (isEmailTextResult(f)) return "Sent as email text";
    return "Sent as file input";
  }
  return getEvidenceSkipReasonLabel(f.status);
}

export function getEvidenceSkipReasonLabel(status: EvidenceFileStatusCode): string {
  switch (status) {
    case "unsupported_file_type":
      return "Skipped — unsupported file type";
    case "file_too_large":
      return "Skipped — file too large";
    case "total_size_limit_exceeded":
      return "Skipped — total size limit exceeded";
    case "missing_identifiers":
      return "Skipped — missing SharePoint identifiers";
    case "graph_token_unavailable":
      return "Skipped — SharePoint access token unavailable";
    case "download_failed":
      return "Skipped — download failed";
    case "model_does_not_support_image_input":
      return "Skipped — model does not support image input";
    case "no_readable_email_body":
      return "Skipped — no readable email body";
    case "sent":
      return "Sent";
    default:
      return `Skipped — ${status}`;
  }
}

export function getEvidenceHandlingCategory(
  f: EvidenceFileLike,
): "file_input" | "image_input" | "email_text" | "skipped" {
  if (f.status !== "sent") return "skipped";
  if (isImageInputResult(f)) return "image_input";
  if (isEmailTextResult(f)) return "email_text";
  return "file_input";
}

export function formatEvidenceBytes(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export interface EvidenceFileNameLike {
  file_name?: string | null;
  attachment_alias?: string | null;
}

/**
 * Safe display name for an evidence file row.
 * Falls back through file_name → attachment_alias → (unnamed evidence).
 * Never surfaces raw IDs, base64, or SharePoint/Graph identifiers.
 */
export function getEvidenceDisplayName(f: EvidenceFileNameLike): string {
  return f.file_name?.trim() || f.attachment_alias?.trim() || "(unnamed evidence)";
}
