/**
 * Sanitize a returnTo value to prevent open-redirect attacks.
 * Only allows in-app relative paths starting with "/" (and not "//" or "/\").
 * Returns "/" as a safe fallback.
 */
export function sanitizeReturnTo(value: string | null | undefined): string {
  if (!value || typeof value !== "string") return "/";
  // Reject protocol-relative (//host) and backslash tricks
  if (!value.startsWith("/")) return "/";
  if (value.startsWith("//") || value.startsWith("/\\")) return "/";
  // Reject anything that looks like an absolute URL
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return "/";
  return value;
}
