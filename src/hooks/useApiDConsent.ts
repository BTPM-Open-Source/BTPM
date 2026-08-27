/**
 * API-D.4 — React Query wiring for the membership-aware consent UX.
 *
 * Uses only the three protected API-D RPC surfaces:
 *   - `get_api_d_consent_context`   (read, API-D.2)
 *   - `acknowledge_api_d_policy`    (write, API-D.3)
 *   - `revoke_api_d_policy`         (write, API-D.3)
 *
 * The database function returns these exact keys (API-D.2 effective shape):
 *   client:        { display_name, client_key }
 *   policy:        { version, policy_uri, policy_digest, effective_at }
 *   acknowledged:  boolean
 *   organizations: { count, display_names[] }
 *   workspaces:    { count, display_names[] }
 *   capabilities:  [{ api_version, display_name, description, scope_level }]
 *
 * No direct API-C/D table access, no OAuth activity, no browser storage
 * of the response, correlation ID, client key, or policy content.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  generateApiDCorrelationId,
  sanitizeApiDClientKey,
} from "@/lib/apiDConsent";

export interface ApiDConsentClient {
  display_name: string;
  client_key: string;
}

export interface ApiDConsentPolicy {
  version: string;
  policy_uri: string;
  policy_digest: string;
  effective_at: string;
}

export interface ApiDConsentSummary {
  count: number;
  display_names: string[];
}

export type ApiDConsentCapabilityScope =
  | "organization"
  | "workspace"
  | "project";

export interface ApiDConsentCapability {
  api_version: string;
  display_name: string;
  description: string;
  scope_level: ApiDConsentCapabilityScope;
}

export interface ApiDConsentContext {
  eligible: boolean;
  client?: ApiDConsentClient;
  policy?: ApiDConsentPolicy;
  acknowledged?: boolean;
  organizations?: ApiDConsentSummary;
  workspaces?: ApiDConsentSummary;
  capabilities?: ApiDConsentCapability[];
}

interface ApiDCommandResult {
  ok: boolean;
  changed?: boolean;
  acknowledged: boolean;
}

const queryKey = (clientKey: string | null) =>
  ["api-d", "consent-context", clientKey] as const;

// ---------------------------------------------------------------------------
// Strict safe parsers — copy only vetted primitives, drop everything else.
// Any missing/malformed/mismatched/wrong-typed field collapses to
// { eligible: false } so the UI shows its single generic unavailable state.
// ---------------------------------------------------------------------------

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function isFiniteNonNegInt(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && Number.isInteger(v) &&
    v >= 0;
}

function parseSummary(v: unknown): ApiDConsentSummary | null {
  if (!v || typeof v !== "object") return null;
  const obj = v as Record<string, unknown>;
  if (!isFiniteNonNegInt(obj.count)) return null;
  if (!Array.isArray(obj.display_names)) return null;
  const names: string[] = [];
  for (const n of obj.display_names) {
    if (typeof n !== "string") return null;
    names.push(n);
  }
  return { count: obj.count, display_names: names };
}

function parseClient(v: unknown): ApiDConsentClient | null {
  if (!v || typeof v !== "object") return null;
  const obj = v as Record<string, unknown>;
  if (!isNonEmptyString(obj.display_name)) return null;
  if (!isNonEmptyString(obj.client_key)) return null;
  return { display_name: obj.display_name, client_key: obj.client_key };
}

function parsePolicy(v: unknown): ApiDConsentPolicy | null {
  if (!v || typeof v !== "object") return null;
  const obj = v as Record<string, unknown>;
  if (
    !isNonEmptyString(obj.version) ||
    !isNonEmptyString(obj.policy_uri) ||
    !isNonEmptyString(obj.policy_digest) ||
    !isNonEmptyString(obj.effective_at)
  ) return null;
  return {
    version: obj.version,
    policy_uri: obj.policy_uri,
    policy_digest: obj.policy_digest,
    effective_at: obj.effective_at,
  };
}

const API_VERSION_RE = /^v[1-9][0-9]*$/;
const SCOPE_LEVELS: readonly ApiDConsentCapabilityScope[] = [
  "organization",
  "workspace",
  "project",
];

function parseCapabilities(v: unknown): ApiDConsentCapability[] | null {
  if (!Array.isArray(v)) return null;
  const out: ApiDConsentCapability[] = [];
  for (const item of v) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const obj = item as Record<string, unknown>;
    if (!isNonEmptyString(obj.api_version) || !API_VERSION_RE.test(obj.api_version)) {
      return null;
    }
    if (!isNonEmptyString(obj.display_name)) return null;
    if (!isNonEmptyString(obj.description)) return null;
    if (
      typeof obj.scope_level !== "string" ||
      !SCOPE_LEVELS.includes(obj.scope_level as ApiDConsentCapabilityScope)
    ) {
      return null;
    }
    out.push({
      api_version: obj.api_version,
      display_name: obj.display_name,
      description: obj.description,
      scope_level: obj.scope_level as ApiDConsentCapabilityScope,
    });
  }
  return out;
}

export function parseApiDConsentContext(
  raw: unknown,
  expectedClientKey: string,
): ApiDConsentContext {
  const unavailable: ApiDConsentContext = { eligible: false };
  if (!raw || typeof raw !== "object") return unavailable;
  const obj = raw as Record<string, unknown>;
  if (obj.eligible !== true) return unavailable;

  const client = parseClient(obj.client);
  if (!client) return unavailable;
  // Server-returned client_key MUST equal the validated requested key.
  if (client.client_key !== expectedClientKey) return unavailable;

  const policy = parsePolicy(obj.policy);
  if (!policy) return unavailable;

  if (typeof obj.acknowledged !== "boolean") return unavailable;

  const organizations = parseSummary(obj.organizations);
  if (!organizations) return unavailable;

  const workspaces = parseSummary(obj.workspaces);
  if (!workspaces) return unavailable;

  const capabilities = parseCapabilities(obj.capabilities);
  if (!capabilities) return unavailable;

  return {
    eligible: true,
    client,
    policy,
    acknowledged: obj.acknowledged,
    organizations,
    workspaces,
    capabilities,
  };
}

export function useApiDConsentContext(rawClientKey: string | null) {
  const clientKey = sanitizeApiDClientKey(rawClientKey);
  return useQuery({
    queryKey: queryKey(clientKey),
    enabled: !!clientKey,
    queryFn: async (): Promise<ApiDConsentContext> => {
      if (!clientKey) return { eligible: false };
      const { data, error } = await supabase.rpc("get_api_d_consent_context", {
        _client_key: clientKey,
      });
      if (error) return { eligible: false };
      return parseApiDConsentContext(data, clientKey);
    },
  });
}


function parseCommandResult(
  raw: unknown,
  expectedAcknowledged: boolean,
): ApiDCommandResult {
  if (!raw || typeof raw !== "object") {
    throw new Error("consent_unavailable");
  }
  const obj = raw as Record<string, unknown>;
  if (obj.ok !== true) throw new Error("consent_unavailable");
  if (obj.acknowledged !== expectedAcknowledged) {
    throw new Error("consent_unavailable");
  }
  return {
    ok: true,
    changed: typeof obj.changed === "boolean" ? obj.changed : undefined,
    acknowledged: expectedAcknowledged,
  };
}

export function useApiDAcknowledgeMutation(rawClientKey: string | null) {
  const qc = useQueryClient();
  const clientKey = sanitizeApiDClientKey(rawClientKey);
  return useMutation({
    mutationFn: async (): Promise<ApiDCommandResult> => {
      if (!clientKey) throw new Error("consent_unavailable");
      const correlationId = generateApiDCorrelationId();
      const { data, error } = await supabase.rpc("acknowledge_api_d_policy", {
        _client_key: clientKey,
        _correlation_id: correlationId,
      });
      if (error) throw new Error("consent_unavailable");
      return parseCommandResult(data, true);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKey(clientKey) });
    },
  });
}

export function useApiDRevokeMutation(rawClientKey: string | null) {
  const qc = useQueryClient();
  const clientKey = sanitizeApiDClientKey(rawClientKey);
  return useMutation({
    mutationFn: async (): Promise<ApiDCommandResult> => {
      if (!clientKey) throw new Error("consent_unavailable");
      const correlationId = generateApiDCorrelationId();
      const { data, error } = await supabase.rpc("revoke_api_d_policy", {
        _client_key: clientKey,
        _correlation_id: correlationId,
      });
      if (error) throw new Error("consent_unavailable");
      return parseCommandResult(data, false);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKey(clientKey) });
    },
  });
}
