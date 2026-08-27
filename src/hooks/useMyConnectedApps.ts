/**
 * API-G.5.9D — Current-user Connected Apps query and disconnect hooks.
 *
 * Uses only the two protected current-user RPC surfaces:
 *   - `api_g_5_9_list_my_connected_apps`      (read)
 *   - `api_g_5_9_disconnect_my_connected_app` (write)
 *
 * No direct table access, no OAuth activity, no browser persistence.
 * The user ID is used ONLY for browser query-cache separation and is never
 * sent to the backend. Every response is treated as untrusted JSON and is
 * strictly parsed; any malformation fails closed for the whole response.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { generateApiDCorrelationId } from "@/lib/apiDConsent";

export const MY_CONNECTED_APPS_PAGE_SIZE = 25;

export type MyConnectedAppStatus = "active" | "unavailable";

export type MyConnectedAppScopeLevel =
  | "organization"
  | "workspace"
  | "project";

export interface MyConnectedAppSummary {
  count: number;
  display_names: string[];
}

export interface MyConnectedAppCapability {
  api_version: string;
  display_name: string;
  description: string;
  scope_level: MyConnectedAppScopeLevel;
}

export interface MyConnectedAppPolicy {
  version: string;
  policy_uri: string;
  effective_at: string;
}

export interface MyConnectedApp {
  client_key: string;
  display_name: string;
  description: string;
  latest_acknowledged_at: string;
  connection_status: MyConnectedAppStatus;
  policy: MyConnectedAppPolicy | null;
  organizations: MyConnectedAppSummary;
  workspaces: MyConnectedAppSummary;
  capabilities: MyConnectedAppCapability[];
  total_count: number;
}

const CLIENT_KEY_RE = /^[a-z0-9][a-z0-9_.-]{1,62}[a-z0-9]$/;
const API_VERSION_RE = /^v[1-9][0-9]*$/;
const SCOPE_LEVELS: readonly MyConnectedAppScopeLevel[] = [
  "organization",
  "workspace",
  "project",
];

const LIST_ERROR = "connected_apps_unavailable";
const DISCONNECT_ERROR = "connected_app_disconnect_failed";

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function isNonNegInt(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && Number.isInteger(v) && v >= 0;
}

function isParseableDate(v: unknown): v is string {
  return isNonEmptyString(v) && Number.isFinite(Date.parse(v));
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function parseSummary(v: unknown): MyConnectedAppSummary | null {
  if (!isPlainObject(v)) return null;
  if (!isNonNegInt(v.count)) return null;
  if (!Array.isArray(v.display_names)) return null;
  const names: string[] = [];
  for (const n of v.display_names) {
    if (typeof n !== "string") return null;
    names.push(n);
  }
  return { count: v.count, display_names: names };
}

function parseCapabilities(v: unknown): MyConnectedAppCapability[] | null {
  if (!Array.isArray(v)) return null;
  const out: MyConnectedAppCapability[] = [];
  for (const item of v) {
    if (!isPlainObject(item)) return null;
    if (!isNonEmptyString(item.api_version) || !API_VERSION_RE.test(item.api_version)) {
      return null;
    }
    if (!isNonEmptyString(item.display_name)) return null;
    if (!isNonEmptyString(item.description)) return null;
    if (
      typeof item.scope_level !== "string" ||
      !SCOPE_LEVELS.includes(item.scope_level as MyConnectedAppScopeLevel)
    ) {
      return null;
    }
    out.push({
      api_version: item.api_version,
      display_name: item.display_name,
      description: item.description,
      scope_level: item.scope_level as MyConnectedAppScopeLevel,
    });
  }
  return out;
}

function parsePolicy(v: unknown): MyConnectedAppPolicy | null {
  if (!isPlainObject(v)) return null;
  if (!isNonEmptyString(v.version)) return null;
  if (typeof v.policy_uri !== "string") return null;
  if (!isParseableDate(v.effective_at)) return null;
  return {
    version: v.version,
    policy_uri: v.policy_uri,
    effective_at: v.effective_at,
  };
}

function parseRow(raw: unknown): MyConnectedApp | null {
  if (!isPlainObject(raw)) return null;
  if (!isNonEmptyString(raw.client_key) || !CLIENT_KEY_RE.test(raw.client_key)) return null;
  if (!isNonEmptyString(raw.display_name)) return null;

  let description: string;
  if (typeof raw.description === "string") {
    description = raw.description;
  } else if (raw.description === null) {
    description = "";
  } else {
    return null;
  }

  if (!isParseableDate(raw.latest_acknowledged_at)) return null;
  if (raw.connection_status !== "active" && raw.connection_status !== "unavailable") {
    return null;
  }
  if (!isNonNegInt(raw.total_count)) return null;

  const status = raw.connection_status as MyConnectedAppStatus;

  if (status === "active") {
    const policy = parsePolicy(raw.policy);
    if (!policy) return null;
    const organizations = parseSummary(raw.organizations);
    if (!organizations) return null;
    const workspaces = parseSummary(raw.workspaces);
    if (!workspaces) return null;
    const capabilities = parseCapabilities(raw.capabilities);
    if (!capabilities) return null;
    return {
      client_key: raw.client_key,
      display_name: raw.display_name,
      description,
      latest_acknowledged_at: raw.latest_acknowledged_at,
      connection_status: status,
      policy,
      organizations,
      workspaces,
      capabilities,
      total_count: raw.total_count,
    };
  }

  // Unavailable rows must be exactly empty.
  if (raw.policy !== null) return null;
  const organizations = parseSummary(raw.organizations);
  if (!organizations) return null;
  const workspaces = parseSummary(raw.workspaces);
  if (!workspaces) return null;
  const capabilities = parseCapabilities(raw.capabilities);
  if (!capabilities) return null;
  if (organizations.count !== 0 || organizations.display_names.length !== 0) return null;
  if (workspaces.count !== 0 || workspaces.display_names.length !== 0) return null;
  if (capabilities.length !== 0) return null;

  return {
    client_key: raw.client_key,
    display_name: raw.display_name,
    description,
    latest_acknowledged_at: raw.latest_acknowledged_at,
    connection_status: status,
    policy: null,
    organizations,
    workspaces,
    capabilities,
    total_count: raw.total_count,
  };
}

export function parseMyConnectedAppsResponse(raw: unknown): MyConnectedApp[] {
  if (!Array.isArray(raw)) throw new Error(LIST_ERROR);
  const rows: MyConnectedApp[] = [];
  for (const item of raw) {
    const parsed = parseRow(item);
    if (!parsed) throw new Error(LIST_ERROR);
    rows.push(parsed);
  }
  return rows;
}

export function useMyConnectedApps(userId: string | null, page: number) {
  const query = useQuery({
    queryKey: ["my-connected-apps", userId, page] as const,
    enabled: !!userId,
    staleTime: 30_000,
    retry: 1,
    queryFn: async (): Promise<MyConnectedApp[]> => {
      const { data, error } = await supabase.rpc("api_g_5_9_list_my_connected_apps", {
        _limit: MY_CONNECTED_APPS_PAGE_SIZE,
        _offset: page * MY_CONNECTED_APPS_PAGE_SIZE,
      });
      if (error) throw new Error(LIST_ERROR);
      return parseMyConnectedAppsResponse(data);
    },
  });

  const rows = query.data ?? [];
  const totalCount = rows.length > 0 ? rows[0].total_count : 0;

  return {
    rows,
    totalCount,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}

interface DisconnectResult {
  ok: true;
  changed: boolean;
  connected: false;
}

export function parseDisconnectResult(raw: unknown): DisconnectResult {
  if (!isPlainObject(raw)) throw new Error(DISCONNECT_ERROR);
  if (raw.ok !== true) throw new Error(DISCONNECT_ERROR);
  if (typeof raw.changed !== "boolean") throw new Error(DISCONNECT_ERROR);
  if (raw.connected !== false) throw new Error(DISCONNECT_ERROR);
  return { ok: true, changed: raw.changed, connected: false };
}

export function useDisconnectMyConnectedApp(userId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (clientKey: string): Promise<DisconnectResult> => {
      const { data, error } = await supabase.rpc("api_g_5_9_disconnect_my_connected_app", {
        _client_key: clientKey,
        _correlation_id: generateApiDCorrelationId(),
      });
      if (error) throw new Error(DISCONNECT_ERROR);
      return parseDisconnectResult(data);
    },
    onSuccess: async (_result, clientKey) => {
      await qc.invalidateQueries({ queryKey: ["my-connected-apps", userId] });
      await qc.invalidateQueries({ queryKey: ["api-d", "consent-context", clientKey] });
    },
  });
}
