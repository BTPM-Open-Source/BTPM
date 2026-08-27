// AI.6b — Shared evidence file type classification for Decision Case AI.
//
// Used by both the production AI brief generator
// (generate-decision-case-ai-brief) and the Admin evidence-reading
// diagnostic (test-openai-decision-evidence-summary) so file type rules
// stay consistent.

export const DOCUMENT_EXTS = new Set([
  "pdf", "txt", "md", "json", "html", "xml",
  "doc", "docx", "rtf", "odt",
  "ppt", "pptx",
  "csv", "xls", "xlsx",
  "eml",
]);

export const IMAGE_EXTS = new Set([
  "png", "jpg", "jpeg", "webp", "gif",
]);

export const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  json: "application/json",
  html: "text/html",
  xml: "application/xml",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  rtf: "application/rtf",
  odt: "application/vnd.oasis.opendocument.text",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  csv: "text/csv",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  eml: "message/rfc822",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

export type EvidenceInputKind = "input_file" | "input_image";

export function isSupportedDocumentEvidenceType(ext: string): boolean {
  return DOCUMENT_EXTS.has(ext);
}

export function isSupportedImageEvidenceType(ext: string): boolean {
  return IMAGE_EXTS.has(ext);
}

export function isSupportedEvidenceType(ext: string): boolean {
  return DOCUMENT_EXTS.has(ext) || IMAGE_EXTS.has(ext);
}

export function classifyEvidenceInputKind(
  ext: string,
): EvidenceInputKind | "unsupported" {
  if (DOCUMENT_EXTS.has(ext)) return "input_file";
  if (IMAGE_EXTS.has(ext)) return "input_image";
  return "unsupported";
}

export function mimeFromExtension(ext: string, fallbackMime?: string | null): string {
  return MIME_BY_EXT[ext] || fallbackMime || "application/octet-stream";
}

export function buildDataUrl(mime: string, base64: string): string {
  return `data:${mime};base64,${base64}`;
}
