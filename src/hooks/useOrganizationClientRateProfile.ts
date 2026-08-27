/**
 * API-G.5.10D-2B — Typed Organization connected-app rate-profile client and hooks.
 *
 * Data access only. Reads and writes exclusively through the protected
 * Organization-scoped RPCs:
 *   - api_g_5_10_get_organization_client_rate_profile
 *   - api_g_5_10_set_organization_client_rate_profile
 *
 * No direct table access, no `any`, no logging, no context substitution, no
 * error-detail exposure.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface OrganizationClientRateProfile {
  readonly profileKey: string;
  readonly displayName: string;
  readonly description: string;
  readonly requestLimit: number;
  readonly windowSeconds: number;
  readonly isDefault: boolean;
  readonly isExplicit: boolean;
  readonly assignedAt: string | null;
}

export interface OrganizationClientRateProfileOptions {
  readonly organizationId: string | null;
  readonly apiClientId: string | null;
  readonly enabled?: boolean;
}

export interface SetOrganizationClientRateProfileInput {
  readonly profileKey: string;
}

export interface GetOrganizationClientRateProfileRpcArgs {
  readonly _organization_id: string;
  readonly _api_client_id: string;
}

export interface SetOrganizationClientRateProfileRpcArgs {
  readonly _organization_id: string;
  readonly _api_client_id: string;
  readonly _profile_key: string;
}

export interface OrganizationClientRateProfileRpcClient {
  rpc(
    functionName: "api_g_5_10_get_organization_client_rate_profile",
    args: GetOrganizationClientRateProfileRpcArgs,
  ): PromiseLike<{ data: unknown; error: unknown }>;
  rpc(
    functionName: "api_g_5_10_set_organization_client_rate_profile",
    args: SetOrganizationClientRateProfileRpcArgs,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}

export type OrganizationClientRateProfileReader = (
  options: OrganizationClientRateProfileOptions,
) => Promise<OrganizationClientRateProfile>;

export type OrganizationClientRateProfileSetter = (
  options: OrganizationClientRateProfileOptions,
  input: SetOrganizationClientRateProfileInput,
) => Promise<OrganizationClientRateProfile>;

const READ_ERROR = "rate_profile_unavailable";
const WRITE_ERROR = "rate_profile_update_unavailable";

const PROFILE_KEY_RE = /^[a-z][a-z0-9_]{0,63}$/;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function isBoundedInt(v: unknown, min: number, max: number): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
}

export function isOrganizationClientRateProfileRequestValid(
  options: OrganizationClientRateProfileOptions,
): boolean {
  return (
    isNonEmptyString(options.organizationId) && isNonEmptyString(options.apiClientId)
  );
}

/** Strict single-row parser. Returns null when the response is unacceptable. */
function parseSingleRow(raw: unknown): OrganizationClientRateProfile | null {
  if (!Array.isArray(raw)) return null;
  if (raw.length !== 1) return null;
  const row = raw[0];
  if (!isPlainObject(row)) return null;

  if (!isNonEmptyString(row.profile_key) || !PROFILE_KEY_RE.test(row.profile_key)) {
    return null;
  }
  if (!isNonEmptyString(row.display_name)) return null;
  if (!isNonEmptyString(row.description)) return null;
  if (!isBoundedInt(row.request_limit, 1, 1_000_000)) return null;
  if (!isBoundedInt(row.window_seconds, 1, 86_400)) return null;
  if (typeof row.is_default !== "boolean") return null;
  if (typeof row.is_explicit !== "boolean") return null;

  let assignedAt: string | null;
  if (row.is_explicit) {
    if (!isNonEmptyString(row.assigned_at)) return null;
    if (!Number.isFinite(Date.parse(row.assigned_at))) return null;
    assignedAt = row.assigned_at;
  } else {
    if (row.assigned_at !== null) return null;
    assignedAt = null;
  }

  return Object.freeze({
    profileKey: row.profile_key,
    displayName: row.display_name,
    description: row.description,
    requestLimit: row.request_limit,
    windowSeconds: row.window_seconds,
    isDefault: row.is_default,
    isExplicit: row.is_explicit,
    assignedAt,
  });
}

export function createOrganizationClientRateProfileReader(
  client: OrganizationClientRateProfileRpcClient =
    supabase as unknown as OrganizationClientRateProfileRpcClient,
): OrganizationClientRateProfileReader {
  return async (options) => {
    try {
      if (!isOrganizationClientRateProfileRequestValid(options)) {
        throw new Error(READ_ERROR);
      }
      const organizationId = options.organizationId as string;
      const apiClientId = options.apiClientId as string;

      const result = await client.rpc(
        "api_g_5_10_get_organization_client_rate_profile",
        {
          _organization_id: organizationId,
          _api_client_id: apiClientId,
        },
      );

      if (!isPlainObject(result)) throw new Error(READ_ERROR);
      if (result.error !== null && result.error !== undefined) {
        throw new Error(READ_ERROR);
      }
      const parsed = parseSingleRow(result.data);
      if (!parsed) throw new Error(READ_ERROR);
      return parsed;
    } catch {
      throw new Error(READ_ERROR);
    }
  };
}

export function createOrganizationClientRateProfileSetter(
  client: OrganizationClientRateProfileRpcClient =
    supabase as unknown as OrganizationClientRateProfileRpcClient,
): OrganizationClientRateProfileSetter {
  return async (options, input) => {
    try {
      if (!isOrganizationClientRateProfileRequestValid(options)) {
        throw new Error(WRITE_ERROR);
      }
      if (!isPlainObject(input as unknown)) throw new Error(WRITE_ERROR);
      if (!isNonEmptyString(input.profileKey) || !PROFILE_KEY_RE.test(input.profileKey)) {
        throw new Error(WRITE_ERROR);
      }
      const organizationId = options.organizationId as string;
      const apiClientId = options.apiClientId as string;

      const result = await client.rpc(
        "api_g_5_10_set_organization_client_rate_profile",
        {
          _organization_id: organizationId,
          _api_client_id: apiClientId,
          _profile_key: input.profileKey,
        },
      );

      if (!isPlainObject(result)) throw new Error(WRITE_ERROR);
      if (result.error !== null && result.error !== undefined) {
        throw new Error(WRITE_ERROR);
      }
      const parsed = parseSingleRow(result.data);
      if (!parsed) throw new Error(WRITE_ERROR);
      return parsed;
    } catch {
      throw new Error(WRITE_ERROR);
    }
  };
}

export function organizationClientRateProfileQueryKey(
  organizationId: string | null,
  apiClientId: string | null,
) {
  return [
    "organization-client-rate-profile",
    organizationId,
    apiClientId,
  ] as const;
}

export function buildOrganizationClientRateProfileQueryOptions(
  options: OrganizationClientRateProfileOptions,
  reader: OrganizationClientRateProfileReader = createOrganizationClientRateProfileReader(),
) {
  return {
    queryKey: organizationClientRateProfileQueryKey(
      options.organizationId,
      options.apiClientId,
    ),
    enabled:
      options.enabled !== false &&
      isOrganizationClientRateProfileRequestValid(options),
    staleTime: 30_000,
    retry: false as const,
    queryFn: () => reader(options),
  };
}

export function useOrganizationClientRateProfile(
  options: OrganizationClientRateProfileOptions,
  reader?: OrganizationClientRateProfileReader,
) {
  return useQuery(buildOrganizationClientRateProfileQueryOptions(options, reader));
}

export function buildSetOrganizationClientRateProfileMutationOptions(
  options: OrganizationClientRateProfileOptions,
  queryClient: {
    setQueryData(
      key: ReturnType<typeof organizationClientRateProfileQueryKey>,
      data: OrganizationClientRateProfile,
    ): unknown;
  },
  setter: OrganizationClientRateProfileSetter = createOrganizationClientRateProfileSetter(),
) {
  return {
    mutationKey: [
      "set-organization-client-rate-profile",
      options.organizationId,
      options.apiClientId,
    ] as const,
    retry: false as const,
    mutationFn: (input: SetOrganizationClientRateProfileInput) =>
      setter(options, input),
    onSuccess: (result: OrganizationClientRateProfile) => {
      queryClient.setQueryData(
        organizationClientRateProfileQueryKey(
          options.organizationId,
          options.apiClientId,
        ),
        result,
      );
    },
  };
}

export function useSetOrganizationClientRateProfile(
  options: OrganizationClientRateProfileOptions,
  setter?: OrganizationClientRateProfileSetter,
) {
  const queryClient = useQueryClient();
  return useMutation(
    buildSetOrganizationClientRateProfileMutationOptions(
      options,
      queryClient,
      setter,
    ),
  );
}
