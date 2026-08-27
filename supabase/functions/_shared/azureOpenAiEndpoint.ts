// Phase 4D.14A.8A — Azure OpenAI endpoint normalizer/validator (Edge/shared).
//
// Pure, dependency-free. Mirrors the semantics of the SQL function
// `public._normalize_azure_openai_endpoint`.
//
// Accepts only HTTPS URLs whose host ends with `.openai.azure.com` or
// `.services.ai.azure.com`. Rejects HTTP, other hosts, IPs, embedded
// credentials, query strings, fragments, ports, deceptive suffixes, and
// non-canonical paths. An optional trailing `/openai/v1` suffix is stripped;
// any other path is rejected.
//
// Returns the normalized string (e.g. `https://acme.openai.azure.com`) or
// `null` if the input is not acceptable.

const AZURE_HOST_SUFFIXES = [
  ".openai.azure.com",
  ".services.ai.azure.com",
];

export function normalizeAzureOpenAiEndpoint(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  if (!/^https:\/\//i.test(trimmed)) return null;

  const rest = trimmed.slice("https://".length);
  if (rest.includes("?") || rest.includes("#")) return null;

  const slashIdx = rest.indexOf("/");
  const authority = slashIdx === -1 ? rest : rest.slice(0, slashIdx);
  if (authority.includes("@")) return null;
  if (authority.length === 0) return null;

  const host = authority.toLowerCase();
  if (host.includes(":")) return null;
  if (/^[0-9]+(\.[0-9]+){3}$/.test(host)) return null;
  if (/^[0-9.]+$/.test(host)) return null;
  if (host.startsWith("[")) return null;

  const hostOk = AZURE_HOST_SUFFIXES.some(
    (suf) => host.endsWith(suf) && host.length > suf.length,
  );
  if (!hostOk) return null;

  let path = slashIdx === -1 ? "" : rest.slice(slashIdx);
  path = path.replace(/\/+$/, "");
  path = path.replace(/\/openai\/v1$/i, "");
  if (path !== "") return null;

  return `https://${host}`;
}

/** Compose the canonical Azure OpenAI v1 base URL from a normalized endpoint. */
export function azureOpenAiV1BaseUrl(normalizedEndpoint: string): string {
  return `${normalizedEndpoint}/openai/v1`;
}
