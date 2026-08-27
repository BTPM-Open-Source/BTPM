/**
 * API-G.5.10D-2C — Typed, read-only approved API rate-profile catalogue boundary.
 *
 * Reads exclusively through the protected zero-argument RPC:
 *   - api_g_5_10_list_rate_profile_catalogue
 *
 * Data access only. No table access, no `any`, no logging, no context
 * dependency, no error-detail exposure.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface RateProfileCatalogueItem {
  readonly profileKey: string;
  readonly displayName: string;
  readonly description: string;
  readonly requestLimit: number;
  readonly windowSeconds: number;
  readonly isDefault: boolean;
}

export interface RateProfileCatalogueOptions {
  readonly enabled?: boolean;
}

export interface RateProfileCatalogueRpcClient {
  rpc(
    functionName: "api_g_5_10_list_rate_profile_catalogue",
  ): PromiseLike<{ data: unknown; error: unknown }>;
}

export type RateProfileCatalogueReader = () => Promise<
  readonly RateProfileCatalogueItem[]
>;

const CATALOGUE_ERROR = "rate_profile_catalogue_unavailable";

const PROFILE_KEY_RE = /^[a-z][a-z0-9_]{0,63}$/;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function isBoundedString(v: unknown, max: number): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= max;
}

function isBoundedInt(v: unknown, min: number, max: number): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
}

function parseRow(raw: unknown): RateProfileCatalogueItem | null {
  if (!isPlainObject(raw)) return null;
  if (!isBoundedString(raw.profile_key, 64) || !PROFILE_KEY_RE.test(raw.profile_key)) {
    return null;
  }
  if (!isBoundedString(raw.display_name, 100)) return null;
  if (!isBoundedString(raw.description, 500)) return null;
  if (!isBoundedInt(raw.request_limit, 1, 1_000_000)) return null;
  if (!isBoundedInt(raw.window_seconds, 1, 86_400)) return null;
  if (typeof raw.is_default !== "boolean") return null;

  return Object.freeze({
    profileKey: raw.profile_key,
    displayName: raw.display_name,
    description: raw.description,
    requestLimit: raw.request_limit,
    windowSeconds: raw.window_seconds,
    isDefault: raw.is_default,
  });
}

function parseCatalogue(raw: unknown): readonly RateProfileCatalogueItem[] | null {
  if (!Array.isArray(raw)) return null;
  const items: RateProfileCatalogueItem[] = [];
  const seen = new Set<string>();
  let defaults = 0;
  for (const row of raw) {
    const parsed = parseRow(row);
    if (!parsed) return null;
    if (seen.has(parsed.profileKey)) return null;
    seen.add(parsed.profileKey);
    if (parsed.isDefault) defaults += 1;
    if (defaults > 1) return null;
    items.push(parsed);
  }
  return Object.freeze(items);
}

export function createRateProfileCatalogueReader(
  client: RateProfileCatalogueRpcClient =
    supabase as unknown as RateProfileCatalogueRpcClient,
): RateProfileCatalogueReader {
  return async () => {
    try {
      const result = await client.rpc("api_g_5_10_list_rate_profile_catalogue");
      if (!isPlainObject(result)) throw new Error(CATALOGUE_ERROR);
      if (result.error !== null && result.error !== undefined) {
        throw new Error(CATALOGUE_ERROR);
      }
      const parsed = parseCatalogue(result.data);
      if (!parsed) throw new Error(CATALOGUE_ERROR);
      return parsed;
    } catch {
      throw new Error(CATALOGUE_ERROR);
    }
  };
}

export function rateProfileCatalogueQueryKey() {
  return ["api-rate-profile-catalogue"] as const;
}

export function buildRateProfileCatalogueQueryOptions(
  options: RateProfileCatalogueOptions = {},
  reader: RateProfileCatalogueReader = createRateProfileCatalogueReader(),
) {
  return {
    queryKey: rateProfileCatalogueQueryKey(),
    enabled: options.enabled !== false,
    staleTime: 300_000,
    retry: false as const,
    queryFn: () => reader(),
  };
}

export function useRateProfileCatalogue(
  options: RateProfileCatalogueOptions = {},
  reader?: RateProfileCatalogueReader,
) {
  return useQuery(buildRateProfileCatalogueQueryOptions(options, reader));
}
