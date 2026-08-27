const DEFAULT_ALLOWED_HEADERS = "authorization, x-client-info, apikey, content-type";

function normalizeOrigin(raw: string): string | null {
  const value = raw.trim();
  if (!value || value.includes(",")) return null;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (url.pathname !== "" && url.pathname !== "/") return null;
  if (url.search || url.hash) return null;
  return url.origin;
}

export function parseBrowserAllowedOrigins(
  raw: string | undefined,
): ReadonlySet<string> {
  if (!raw?.trim()) return new Set<string>();

  const origins = new Set<string>();
  for (const part of raw.split(",")) {
    const value = part.trim();
    if (!value) continue;
    if (value.includes("*")) {
      throw new Error("BTPM_BROWSER_ALLOWED_ORIGINS must use exact origins; wildcards are not allowed.");
    }
    const normalized = normalizeOrigin(value);
    if (!normalized) {
      throw new Error("BTPM_BROWSER_ALLOWED_ORIGINS contains an invalid origin.");
    }
    origins.add(normalized);
  }
  return origins;
}

export function buildBrowserCorsHeaders(
  req: Request,
  options: {
    allowedOrigins?: ReadonlySet<string>;
    allowedMethods?: string;
    allowedHeaders?: string;
  } = {},
): Record<string, string> {
  const allowedOrigins = options.allowedOrigins ?? parseBrowserAllowedOrigins(
    Deno.env.get("BTPM_BROWSER_ALLOWED_ORIGINS"),
  );
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": options.allowedHeaders ?? DEFAULT_ALLOWED_HEADERS,
    "Access-Control-Allow-Methods": options.allowedMethods ?? "POST, OPTIONS",
    "Vary": "Origin",
  };

  const rawOrigin = req.headers.get("origin");
  if (!rawOrigin) return headers;

  const normalized = normalizeOrigin(rawOrigin);
  if (normalized && allowedOrigins.has(normalized)) {
    headers["Access-Control-Allow-Origin"] = normalized;
  }
  return headers;
}
