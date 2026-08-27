// API-E.R3 — Shared Edge Authentication Middleware Foundation.
//
// Client and policy-acknowledgement authorization abstraction.
//
// Mirrors API-E.1 authorization semantics against:
//   - public.api_clients
//   - public.api_client_policy_versions
//   - public.api_user_policy_acknowledgements
//
// The store is dependency-injected so the middleware unit tests never
// require a live database, service-role credential, or network call.
//
// This file is the only approved non-migration server-runtime reader of
// the API-C substrate tables `public.api_clients`,
// `public.api_client_policy_versions`, and
// `public.api_user_policy_acknowledgements`. It never constructs a
// Supabase client, never reads `Deno.env`, and never references a
// service-role credential — a privileged server client is supplied by
// the caller. It never queries `public.api_capability_grants`.

import { ApiAuthenticationError } from "./apiErrors.ts";

// -----------------------------------------------------------------------------
// Data shapes (minimal projections; never full rows are exposed upward)
// -----------------------------------------------------------------------------

export interface ActiveApiClientRecord {
  /** Internal `public.api_clients.id`. */
  id: string;
  /** Signed OAuth `client_id` value on `public.api_clients.oauth_client_id`. */
  oauthClientId: string;
  /** `public.api_clients.lifecycle_status`. */
  lifecycleStatus: "draft" | "active" | "suspended" | "retired";
}

export interface ActivePolicyVersionRecord {
  /** Internal `public.api_client_policy_versions.id`. */
  id: string;
  /** `public.api_client_policy_versions.api_client_id`. */
  apiClientId: string;
  /** `public.api_client_policy_versions.lifecycle_status`. */
  lifecycleStatus: "draft" | "active" | "retired";
}

export interface PolicyAcknowledgementRecord {
  /** `public.api_user_policy_acknowledgements` primary key. */
  id: string;
  /** User the acknowledgement belongs to. */
  userId: string;
  /** API client the acknowledgement belongs to. */
  apiClientId: string;
  /** The exact policy version acknowledged. */
  policyVersionId: string;
  /** Revocation timestamp if revoked, else null. */
  revokedAt: string | null;
}

export interface ClientAuthorizationStore {
  /**
   * Return every `api_clients` row whose `oauth_client_id` equals the signed
   * client_id AND whose lifecycle_status is 'active'. Callers require
   * exactly one row; zero or multiple rows fail closed.
   */
  findActiveClientsByOauthClientId(
    oauthClientId: string,
  ): Promise<ActiveApiClientRecord[]>;

  /**
   * Return every `api_client_policy_versions` row for the given internal
   * client whose lifecycle_status is 'active'. Callers require exactly one
   * row; zero or multiple rows fail closed.
   */
  findActivePolicyVersionsForClient(
    apiClientId: string,
  ): Promise<ActivePolicyVersionRecord[]>;

  /**
   * Return the user's acknowledgement record for the exact (api client,
   * policy version) pair, or null if none exists. Multiple rows must fail
   * closed at the caller.
   */
  findUserAcknowledgement(
    userId: string,
    apiClientId: string,
    policyVersionId: string,
  ): Promise<PolicyAcknowledgementRecord | null>;
}

export interface AuthorizedClientContext {
  readonly userId: string;
  readonly apiClientId: string;
  readonly oauthClientId: string;
  readonly policyVersionId: string;
}

// -----------------------------------------------------------------------------
// Authorization flow
// -----------------------------------------------------------------------------

export async function authorizeClient(
  userId: string,
  signedClientId: string,
  store: ClientAuthorizationStore,
): Promise<AuthorizedClientContext> {
  // 1. Resolve the signed client_id against the platform client registry.
  let clients: ActiveApiClientRecord[];
  try {
    clients = await store.findActiveClientsByOauthClientId(signedClientId);
  } catch (cause) {
    throw new ApiAuthenticationError("authentication_internal_error", cause);
  }
  if (!Array.isArray(clients) || clients.length === 0) {
    throw new ApiAuthenticationError("client_disabled");
  }
  if (clients.length > 1) {
    throw new ApiAuthenticationError("client_record_ambiguous");
  }
  const client = clients[0];
  if (client.lifecycleStatus !== "active") {
    throw new ApiAuthenticationError("client_disabled");
  }
  if (client.oauthClientId !== signedClientId) {
    // The store must respect its contract; defensive fail-closed check.
    throw new ApiAuthenticationError("client_disabled");
  }

  // 2. Resolve the client's current active policy version.
  let versions: ActivePolicyVersionRecord[];
  try {
    versions = await store.findActivePolicyVersionsForClient(client.id);
  } catch (cause) {
    throw new ApiAuthenticationError("authentication_internal_error", cause);
  }
  if (!Array.isArray(versions) || versions.length === 0) {
    throw new ApiAuthenticationError("active_policy_missing");
  }
  if (versions.length > 1) {
    throw new ApiAuthenticationError("active_policy_ambiguous");
  }
  const version = versions[0];
  if (
    version.lifecycleStatus !== "active" ||
    version.apiClientId !== client.id
  ) {
    throw new ApiAuthenticationError("active_policy_missing");
  }

  // 3. Resolve the user's acknowledgement for the exact active version.
  let ack: PolicyAcknowledgementRecord | null;
  try {
    ack = await store.findUserAcknowledgement(userId, client.id, version.id);
  } catch (cause) {
    throw new ApiAuthenticationError("authentication_internal_error", cause);
  }
  if (ack === null || ack === undefined) {
    throw new ApiAuthenticationError("policy_acknowledgement_missing");
  }
  if (ack.userId !== userId) {
    throw new ApiAuthenticationError("policy_acknowledgement_missing");
  }
  if (ack.apiClientId !== client.id) {
    throw new ApiAuthenticationError("policy_acknowledgement_missing");
  }
  if (ack.policyVersionId !== version.id) {
    // Belongs to some other (older) version.
    throw new ApiAuthenticationError("policy_acknowledgement_stale");
  }
  if (ack.revokedAt !== null) {
    throw new ApiAuthenticationError("policy_acknowledgement_revoked");
  }

  return Object.freeze({
    userId,
    apiClientId: client.id,
    oauthClientId: client.oauthClientId,
    policyVersionId: version.id,
  });
}

// -----------------------------------------------------------------------------
// Supabase-backed authorization store (production adapter)
// -----------------------------------------------------------------------------
//
// Structural typing only — this file never imports, constructs or holds a
// Supabase client. Callers supply an already-created privileged server
// client (typically a service-role client) and this adapter maps snake_case
// rows to the minimal camelCase records above. Row-level projections are
// tight: no policy URI/digest/metadata or timestamps beyond `revoked_at`
// are ever pulled.

interface SupabaseQueryResult<T> {
  data: T[] | null;
  error: unknown;
}

interface SupabaseSelectBuilder<T> extends PromiseLike<SupabaseQueryResult<T>> {
  eq(column: string, value: unknown): SupabaseSelectBuilder<T>;
  limit(count: number): SupabaseSelectBuilder<T>;
}

interface SupabaseFromBuilder {
  select(columns: string): SupabaseSelectBuilder<Record<string, unknown>>;
}

/** Minimal structural surface required from the caller-supplied server client. */
export interface SupabaseAuthorizationServerClient {
  from(table: string): SupabaseFromBuilder;
}

function ensureRows(result: SupabaseQueryResult<Record<string, unknown>>): Record<string, unknown>[] {
  if (result.error) {
    throw new Error("supabase_query_error");
  }
  return Array.isArray(result.data) ? result.data : [];
}

function asStringField(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("malformed_row");
  }
  return value;
}

function asNullableStringField(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error("malformed_row");
  return value;
}

export function createSupabaseClientAuthorizationStore(
  serverClient: SupabaseAuthorizationServerClient,
): ClientAuthorizationStore {
  return {
    async findActiveClientsByOauthClientId(oauthClientId) {
      const result = await serverClient
        .from("api_clients")
        .select("id, oauth_client_id, lifecycle_status")
        .eq("oauth_client_id", oauthClientId)
        .eq("lifecycle_status", "active")
        .limit(2);
      const rows = ensureRows(result);
      return rows.map((row) => ({
        id: asStringField(row, "id"),
        oauthClientId: asStringField(row, "oauth_client_id"),
        lifecycleStatus: asStringField(
          row,
          "lifecycle_status",
        ) as ActiveApiClientRecord["lifecycleStatus"],
      }));
    },
    async findActivePolicyVersionsForClient(apiClientId) {
      const result = await serverClient
        .from("api_client_policy_versions")
        .select("id, api_client_id, lifecycle_status")
        .eq("api_client_id", apiClientId)
        .eq("lifecycle_status", "active")
        .limit(2);
      const rows = ensureRows(result);
      return rows.map((row) => ({
        id: asStringField(row, "id"),
        apiClientId: asStringField(row, "api_client_id"),
        lifecycleStatus: asStringField(
          row,
          "lifecycle_status",
        ) as ActivePolicyVersionRecord["lifecycleStatus"],
      }));
    },
    async findUserAcknowledgement(userId, apiClientId, policyVersionId) {
      const result = await serverClient
        .from("api_user_policy_acknowledgements")
        .select("id, user_id, api_client_id, policy_version_id, revoked_at")
        .eq("user_id", userId)
        .eq("api_client_id", apiClientId)
        .eq("policy_version_id", policyVersionId)
        .limit(2);
      const rows = ensureRows(result);
      if (rows.length === 0) return null;
      if (rows.length > 1) {
        // Duplicate acknowledgements must never happen (unique index); fail
        // safely rather than silently choosing a row.
        throw new Error("acknowledgement_ambiguous");
      }
      const row = rows[0];
      return {
        id: asStringField(row, "id"),
        userId: asStringField(row, "user_id"),
        apiClientId: asStringField(row, "api_client_id"),
        policyVersionId: asStringField(row, "policy_version_id"),
        revokedAt: asNullableStringField(row, "revoked_at"),
      };
    },
  };
}
