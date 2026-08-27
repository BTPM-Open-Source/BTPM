// Phase 6B.6d — Canonical AI file-context builder shared between
// Decision Case and Roadmap Story Pack generation paths.
//
// Given a set of file references (drive_id, item_id, metadata), this
// helper:
//   - downloads bytes server-side using a Graph application token;
//   - classifies each file by extension;
//   - enforces per-file, total-bytes, and file-count limits;
//   - returns OpenAI Responses-API `input` content items;
//   - returns a per-file audit list suitable for persistence.
//
// Callers MUST have already authorized the user's access to each file
// (via DB-side ownership/RLS checks). This helper does no auth itself.

import {
  classifyEvidenceInputKind,
  isSupportedDocumentEvidenceType,
  isSupportedImageEvidenceType,
  mimeFromExtension,
  buildDataUrl,
} from "./decision-case-ai/evidence-input-types.ts";
import { extractEmlAsText } from "./decision-case-ai/eml-text.ts";
import { bytesToBase64, sha256Hex } from "./bytes.ts";
import { downloadDriveItemBytes } from "./graph-client.ts";

export interface AiFileContextLimits {
  maxFiles: number;
  maxBytesPerFile: number;
  maxTotalBytes: number;
}

export const DEFAULT_STORY_FILE_LIMITS: AiFileContextLimits = {
  maxFiles: 5,
  maxBytesPerFile: 10 * 1024 * 1024,
  maxTotalBytes: 25 * 1024 * 1024,
};

export interface AiFileRef {
  id?: string | null;             // external_file_id (for audit linkage)
  driveId: string | null;
  itemId: string | null;
  displayName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
}

export type AiFileAuditStatus =
  | "sent"
  | "unsupported_file_type"
  | "file_too_large"
  | "total_size_limit_exceeded"
  | "missing_identifiers"
  | "graph_token_unavailable"
  | "download_failed"
  | "not_included"
  | "skipped"
  | "over_file_count_limit";

export interface AiFileAudit {
  external_file_id: string | null;
  attachment_alias: string;
  status: AiFileAuditStatus;
  input_kind: "input_file" | "input_image" | "input_text" | "unsupported" | "none";
  file_extension: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  sha256: string | null;
  skip_reason: string | null;
  display_name: string | null; // not persisted; for client manifest only
}

export type OpenAiInputItem =
  | { type: "input_text"; text: string }
  | { type: "input_file"; filename: string; file_data: string }
  | { type: "input_image"; image_url: string; detail?: "auto" | "low" | "high" };

export interface BuildAiFileContextResult {
  items: OpenAiInputItem[];
  audits: AiFileAudit[];
  totalBytesSent: number;
  sentCount: number;
  skippedCount: number;
  selectedCount: number;
}

function fileExtension(name: string | null, mime: string | null): string {
  const fromName = (name ?? "").toLowerCase().split(".").pop() ?? "";
  if (fromName && fromName.length <= 6 && /^[a-z0-9]+$/.test(fromName)) return fromName;
  const fromMime = (mime ?? "").split("/").pop() ?? "";
  return (fromMime || "").toLowerCase();
}

export async function buildAiFileContext(args: {
  graphToken: string | null;
  files: AiFileRef[];
  limits?: AiFileContextLimits;
  /** Whether the chosen model can accept input_image content. */
  modelSupportsImages?: boolean;
}): Promise<BuildAiFileContextResult> {
  const limits = args.limits ?? DEFAULT_STORY_FILE_LIMITS;
  const audits: AiFileAudit[] = [];
  const items: OpenAiInputItem[] = [];
  let totalBytes = 0;
  let sent = 0;
  let skipped = 0;
  let aliasIdx = 0;

  const selected = args.files.slice(0, Math.max(0, limits.maxFiles + args.files.length));
  // Apply file-count cap, but record the overflow as audits too.
  for (let i = 0; i < args.files.length; i++) {
    const f = args.files[i];
    aliasIdx += 1;
    const alias = `file_${String(aliasIdx).padStart(3, "0")}`;
    const ext = fileExtension(f.displayName, f.mimeType);

    const base: AiFileAudit = {
      external_file_id: f.id ?? null,
      attachment_alias: alias,
      status: "skipped",
      input_kind: "none",
      file_extension: ext || null,
      mime_type: f.mimeType ?? null,
      size_bytes: typeof f.sizeBytes === "number" ? f.sizeBytes : null,
      sha256: null,
      skip_reason: null,
      display_name: f.displayName ?? null,
    };

    if (i >= limits.maxFiles) {
      audits.push({ ...base, status: "over_file_count_limit", skip_reason: `Only first ${limits.maxFiles} files are sent.` });
      skipped += 1;
      continue;
    }
    if (!f.driveId || !f.itemId) {
      audits.push({ ...base, status: "missing_identifiers", skip_reason: "SharePoint driveId/itemId missing." });
      skipped += 1;
      continue;
    }
    const kind = classifyEvidenceInputKind(ext);
    if (kind === "unsupported") {
      audits.push({ ...base, status: "unsupported_file_type", input_kind: "unsupported", skip_reason: `Unsupported file type: ${ext || "unknown"}` });
      skipped += 1;
      continue;
    }
    if (typeof f.sizeBytes === "number" && f.sizeBytes > limits.maxBytesPerFile) {
      audits.push({ ...base, status: "file_too_large", skip_reason: `File exceeds per-file limit of ${limits.maxBytesPerFile} bytes.` });
      skipped += 1;
      continue;
    }
    if (kind === "input_image" && args.modelSupportsImages === false) {
      audits.push({ ...base, status: "unsupported_file_type", input_kind: "unsupported", skip_reason: "Selected model does not support image input." });
      skipped += 1;
      continue;
    }
    if (!args.graphToken) {
      audits.push({ ...base, status: "graph_token_unavailable", skip_reason: "SharePoint token unavailable for this request." });
      skipped += 1;
      continue;
    }

    const dl = await downloadDriveItemBytes(args.graphToken, f.driveId, f.itemId);
    if (!dl.ok) {
      audits.push({ ...base, status: "download_failed", skip_reason: `Graph download failed (HTTP ${dl.status}).` });
      skipped += 1;
      continue;
    }
    const bytes = dl.bytes;
    if (bytes.byteLength > limits.maxBytesPerFile) {
      audits.push({ ...base, status: "file_too_large", size_bytes: bytes.byteLength, skip_reason: `Downloaded bytes exceed per-file limit.` });
      skipped += 1;
      continue;
    }
    if (totalBytes + bytes.byteLength > limits.maxTotalBytes) {
      audits.push({ ...base, status: "total_size_limit_exceeded", size_bytes: bytes.byteLength, skip_reason: `Adding this file would exceed total file-context budget.` });
      skipped += 1;
      continue;
    }
    const sha = await sha256Hex(bytes);

    if (ext === "eml") {
      const text = extractEmlAsText(bytes, f.displayName ?? `${alias}.eml`, 60000);
      items.push({
        type: "input_text",
        text: `--- BEGIN EVIDENCE FILE [${alias}] (${f.displayName ?? "email.eml"}) ---\n${text.text}\n--- END EVIDENCE FILE [${alias}] ---`,
      });
      audits.push({ ...base, status: "sent", input_kind: "input_text", size_bytes: bytes.byteLength, sha256: sha });
      totalBytes += bytes.byteLength;
      sent += 1;
      continue;
    }

    const mime = mimeFromExtension(ext, f.mimeType ?? null);
    const b64 = bytesToBase64(bytes);
    if (isSupportedDocumentEvidenceType(ext)) {
      items.push({
        type: "input_file",
        filename: `${alias}__${(f.displayName ?? "file").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80)}`,
        file_data: buildDataUrl(mime, b64),
      });
      audits.push({ ...base, status: "sent", input_kind: "input_file", size_bytes: bytes.byteLength, sha256: sha });
      totalBytes += bytes.byteLength;
      sent += 1;
    } else if (isSupportedImageEvidenceType(ext)) {
      items.push({
        type: "input_image",
        image_url: buildDataUrl(mime, b64),
        detail: "auto",
      });
      audits.push({ ...base, status: "sent", input_kind: "input_image", size_bytes: bytes.byteLength, sha256: sha });
      totalBytes += bytes.byteLength;
      sent += 1;
    } else {
      audits.push({ ...base, status: "unsupported_file_type", input_kind: "unsupported", skip_reason: `Unsupported file type: ${ext}` });
      skipped += 1;
    }
  }

  return {
    items,
    audits,
    totalBytesSent: totalBytes,
    sentCount: sent,
    skippedCount: skipped,
    selectedCount: args.files.length,
  };
}

/** Strip UI-only fields (display_name) before persisting audits via RPC. */
export function auditsForPersistence(audits: AiFileAudit[]): Record<string, unknown>[] {
  return audits.map((a) => ({
    external_file_id: a.external_file_id,
    attachment_alias: a.attachment_alias,
    status: a.status,
    input_kind: a.input_kind,
    file_extension: a.file_extension,
    mime_type: a.mime_type,
    size_bytes: a.size_bytes,
    sha256: a.sha256,
    skip_reason: a.skip_reason,
  }));
}
