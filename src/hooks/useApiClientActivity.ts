/**
 * API-G.5.10B-2 — Typed activity reader and infinite-pagination hook.
 *
 * Data access only. Reads exclusively through the protected administrative RPC
 * `api_g_5_10_list_client_activity`. No direct table access, no logging, no
 * `any`, and no error detail exposure: every failure becomes
 * `new Error("activity_unavailable")`.
 */
import { useInfiniteQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type ApiClientActivityMode = "platform" | "organization";

export interface ApiClientActivityCursor {
  readonly eventAt: string;
  readonly eventId: string;
}

export interface ApiClientActivityRow {
  readonly eventId: string;
  readonly eventAt: string;
  readonly apiClientId: string;
  readonly actorUserId: string | null;
  readonly apiVersion: string;
  readonly routeId: string;
  readonly httpMethod: string;
  readonly httpStatus: number;
  readonly statusClass:
    | "informational"
    | "success"
    | "redirect"
    | "client_error"
    | "server_error";
  readonly durationMs: number;
  readonly tenantId: string | null;
  readonly organizationId: string | null;
  readonly workspaceId: string | null;
  readonly projectId: string | null;
  readonly scopeLevel:
    | "unscoped"
    | "tenant"
    | "organization"
    | "workspace"
    | "project";
  readonly correlationId: string | null;
  readonly sourceChannel: string;
}

export interface ApiClientActivityPage {
  readonly rows: readonly ApiClientActivityRow[];
  readonly nextCursor: ApiClientActivityCursor | null;
}

export interface ApiClientActivityOptions {
  readonly apiClientId: string | null;
  readonly mode: ApiClientActivityMode;
  readonly organizationId: string | null;
  readonly enabled?: boolean;
}

export const ACTIVITY_PAGE_SIZE = 50;

const ACTIVITY_ERROR = "activity_unavailable";

function fail(): never {
  throw new Error(ACTIVITY_ERROR);
}

export interface ApiClientActivityRpcArgs {
  _api_client_id: string;
  _organization_id: string | null;
  _limit: number;
  _before_event_at: string | null;
  _before_event_id: string | null;
}

export interface ApiClientActivityRpcClient {
  rpc(
    functionName: "api_g_5_10_list_client_activity",
    args: ApiClientActivityRpcArgs,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}

export type ApiClientActivityReader = (
  options: ApiClientActivityOptions,
  cursor: ApiClientActivityCursor | null,
) => Promise<ApiClientActivityPage>;

const STATUS_CLASSES: readonly ApiClientActivityRow["statusClass"][] = [
  "informational",
  "success",
  "redirect",
  "client_error",
  "server_error",
];

const SCOPE_LEVELS: readonly ApiClientActivityRow["scopeLevel"][] = [
  "unscoped",
  "tenant",
  "organization",
  "workspace",
  "project",
];

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function nonEmptyString(v: unknown): string {
  if (typeof v !== "string" || v.length === 0) fail();
  return v;
}

function nullableString(v: unknown): string | null {
  if (v === null) return null;
  if (typeof v !== "string" || v.length === 0) fail();
  return v;
}

function boundedInt(v: unknown, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < min || v > max) fail();
  return v;
}

function parseRow(raw: unknown): ApiClientActivityRow {
  if (!isPlainObject(raw)) fail();

  const statusClass = raw.status_class;
  if (
    typeof statusClass !== "string" ||
    !STATUS_CLASSES.includes(statusClass as ApiClientActivityRow["statusClass"])
  ) {
    fail();
  }
  const scopeLevel = raw.scope_level;
  if (
    typeof scopeLevel !== "string" ||
    !SCOPE_LEVELS.includes(scopeLevel as ApiClientActivityRow["scopeLevel"])
  ) {
    fail();
  }

  return Object.freeze({
    eventId: nonEmptyString(raw.event_id),
    eventAt: nonEmptyString(raw.event_at),
    apiClientId: nonEmptyString(raw.api_client_id),
    actorUserId: nullableString(raw.actor_user_id),
    apiVersion: nonEmptyString(raw.api_version),
    routeId: nonEmptyString(raw.route_id),
    httpMethod: nonEmptyString(raw.http_method),
    httpStatus: boundedInt(raw.http_status, 100, 599),
    statusClass: statusClass as ApiClientActivityRow["statusClass"],
    durationMs: boundedInt(raw.duration_ms, 0, 3_600_000),
    tenantId: nullableString(raw.tenant_id),
    organizationId: nullableString(raw.organization_id),
    workspaceId: nullableString(raw.workspace_id),
    projectId: nullableString(raw.project_id),
    scopeLevel: scopeLevel as ApiClientActivityRow["scopeLevel"],
    correlationId: nullableString(raw.correlation_id),
    sourceChannel: nonEmptyString(raw.source_channel),
  });
}

function parsePage(raw: unknown): ApiClientActivityPage {
  if (!Array.isArray(raw)) fail();
  const rows = raw.map(parseRow);
  const nextCursor =
    rows.length === ACTIVITY_PAGE_SIZE
      ? Object.freeze({
          eventAt: rows[rows.length - 1].eventAt,
          eventId: rows[rows.length - 1].eventId,
        })
      : null;
  return Object.freeze({ rows: Object.freeze(rows), nextCursor });
}

/** Returns the validated Organization argument, or throws activity_unavailable. */
function resolveOrganizationArg(options: ApiClientActivityOptions): string | null {
  if (options.mode === "platform") {
    if (options.organizationId !== null) fail();
    return null;
  }
  if (options.mode === "organization") {
    if (typeof options.organizationId !== "string" || options.organizationId.length === 0) {
      fail();
    }
    return options.organizationId;
  }
  return fail();
}

export function isApiClientActivityRequestValid(options: ApiClientActivityOptions): boolean {
  if (typeof options.apiClientId !== "string" || options.apiClientId.length === 0) return false;
  if (options.mode === "platform") return options.organizationId === null;
  if (options.mode === "organization") {
    return typeof options.organizationId === "string" && options.organizationId.length > 0;
  }
  return false;
}

function validateCursor(cursor: ApiClientActivityCursor | null): ApiClientActivityCursor | null {
  if (cursor === null) return null;
  if (!isPlainObject(cursor)) fail();
  if (typeof cursor.eventAt !== "string" || cursor.eventAt.length === 0) fail();
  if (typeof cursor.eventId !== "string" || cursor.eventId.length === 0) fail();
  return { eventAt: cursor.eventAt, eventId: cursor.eventId };
}

export function createApiClientActivityReader(
  client: ApiClientActivityRpcClient = supabase as unknown as ApiClientActivityRpcClient,
): ApiClientActivityReader {
  return async (options, cursor) => {
    try {
      const apiClientId = nonEmptyString(options.apiClientId);
      const organizationId = resolveOrganizationArg(options);
      const safeCursor = validateCursor(cursor);

      const result = await client.rpc("api_g_5_10_list_client_activity", {
        _api_client_id: apiClientId,
        _organization_id: organizationId,
        _limit: ACTIVITY_PAGE_SIZE,
        _before_event_at: safeCursor ? safeCursor.eventAt : null,
        _before_event_id: safeCursor ? safeCursor.eventId : null,
      });

      if (!isPlainObject(result)) fail();
      if (result.error !== null && result.error !== undefined) fail();
      return parsePage(result.data);
    } catch {
      throw new Error(ACTIVITY_ERROR);
    }
  };
}

export function buildApiClientActivityQueryOptions(
  options: ApiClientActivityOptions,
  reader: ApiClientActivityReader = createApiClientActivityReader(),
) {
  return {
    queryKey: [
      "api-client-activity",
      options.mode,
      options.organizationId,
      options.apiClientId,
    ] as const,
    enabled: options.enabled !== false && isApiClientActivityRequestValid(options),
    initialPageParam: null as ApiClientActivityCursor | null,
    staleTime: 30_000,
    retry: false as const,
    queryFn: ({ pageParam }: { pageParam: ApiClientActivityCursor | null }) =>
      reader(options, pageParam),
    getNextPageParam: (page: ApiClientActivityPage) => page.nextCursor ?? undefined,
  };
}

export function useApiClientActivity(
  options: ApiClientActivityOptions,
  reader?: ApiClientActivityReader,
) {
  return useInfiniteQuery(buildApiClientActivityQueryOptions(options, reader));
}
