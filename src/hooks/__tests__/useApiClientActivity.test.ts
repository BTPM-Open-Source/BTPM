/**
 * API-G.5.10B-2 — behavioral tests for the typed activity reader and hook options.
 * Exactly four test cases.
 */
import { describe, it, expect, vi } from "vitest";
import {
  ACTIVITY_PAGE_SIZE,
  buildApiClientActivityQueryOptions,
  createApiClientActivityReader,
  type ApiClientActivityOptions,
  type ApiClientActivityPage,
  type ApiClientActivityRpcArgs,
  type ApiClientActivityRpcClient,
} from "../useApiClientActivity";

const CLIENT_ID = "11111111-1111-1111-1111-111111111111";
const ORG_ID = "22222222-2222-2222-2222-222222222222";

function rawRow(i: number, overrides: Record<string, unknown> = {}) {
  return {
    event_id: `event-${i}`,
    event_at: `2026-08-05T10:00:${String(i).padStart(2, "0")}.000Z`,
    api_client_id: CLIENT_ID,
    actor_user_id: null,
    api_version: "v1",
    route_id: "GET /v1/me",
    http_method: "GET",
    http_status: 200,
    status_class: "success",
    duration_ms: 12,
    tenant_id: null,
    organization_id: null,
    workspace_id: null,
    project_id: null,
    scope_level: "unscoped",
    correlation_id: null,
    source_channel: "external_api",
    ...overrides,
  };
}

function stubClient(impl: (args: ApiClientActivityRpcArgs) => unknown) {
  const calls: ApiClientActivityRpcArgs[] = [];
  const client: ApiClientActivityRpcClient = {
    rpc: (_fn, args) => {
      calls.push(args);
      const out = impl(args);
      return out as PromiseLike<{ data: unknown; error: unknown }>;
    },
  };
  return { client, calls };
}

const platform: ApiClientActivityOptions = {
  apiClientId: CLIENT_ID,
  mode: "platform",
  organizationId: null,
};
const organization: ApiClientActivityOptions = {
  apiClientId: CLIENT_ID,
  mode: "organization",
  organizationId: ORG_ID,
};

describe("API-G.5.10B-2 typed activity reader", () => {
  it("sends exact first-page arguments per mode and refuses invalid combinations", async () => {
    const { client, calls } = stubClient(() => Promise.resolve({ data: [], error: null }));
    const read = createApiClientActivityReader(client);

    await read(platform, null);
    await read(organization, null);

    expect(calls).toEqual([
      {
        _api_client_id: CLIENT_ID,
        _organization_id: null,
        _limit: 50,
        _before_event_at: null,
        _before_event_id: null,
      },
      {
        _api_client_id: CLIENT_ID,
        _organization_id: ORG_ID,
        _limit: 50,
        _before_event_at: null,
        _before_event_id: null,
      },
    ]);
    expect(ACTIVITY_PAGE_SIZE).toBe(50);

    const invalid: ApiClientActivityOptions[] = [
      { apiClientId: CLIENT_ID, mode: "platform", organizationId: ORG_ID },
      { apiClientId: CLIENT_ID, mode: "organization", organizationId: null },
      { apiClientId: CLIENT_ID, mode: "organization", organizationId: "" },
      { apiClientId: "", mode: "platform", organizationId: null },
      { apiClientId: null, mode: "platform", organizationId: null },
    ];
    for (const options of invalid) {
      await expect(read(options, null)).rejects.toThrow("activity_unavailable");
    }
    // still only the two valid calls
    expect(calls).toHaveLength(2);

    // Malformed cursor shape also refuses.
    await expect(
      read(platform, { eventAt: "", eventId: "x" } as never),
    ).rejects.toThrow("activity_unavailable");
    expect(calls).toHaveLength(2);
  });

  it("maps a full page, sends cursor arguments and derives the final-row cursor", async () => {
    const rows = Array.from({ length: 50 }, (_, i) =>
      rawRow(i, i === 0
        ? {
            actor_user_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            tenant_id: "tttttttt-tttt-tttt-tttt-tttttttttttt",
            organization_id: ORG_ID,
            workspace_id: "wwwwwwww-wwww-wwww-wwww-wwwwwwwwwwww",
            project_id: "pppppppp-pppp-pppp-pppp-pppppppppppp",
            scope_level: "project",
            status_class: "client_error",
            http_status: 404,
            correlation_id: "corr-1",
          }
        : {}),
    );
    const frozenSnapshot = JSON.parse(JSON.stringify(rows));
    const { client, calls } = stubClient(() => Promise.resolve({ data: rows, error: null }));
    const read = createApiClientActivityReader(client);

    const cursor = { eventAt: "2026-08-05T09:00:00.000Z", eventId: "event-prev" };
    const page = await read(organization, cursor);

    expect(calls[0]).toEqual({
      _api_client_id: CLIENT_ID,
      _organization_id: ORG_ID,
      _limit: 50,
      _before_event_at: cursor.eventAt,
      _before_event_id: cursor.eventId,
    });

    expect(page.rows[0]).toEqual({
      eventId: "event-0",
      eventAt: rows[0].event_at,
      apiClientId: CLIENT_ID,
      actorUserId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      apiVersion: "v1",
      routeId: "GET /v1/me",
      httpMethod: "GET",
      httpStatus: 404,
      statusClass: "client_error",
      durationMs: 12,
      tenantId: "tttttttt-tttt-tttt-tttt-tttttttttttt",
      organizationId: ORG_ID,
      workspaceId: "wwwwwwww-wwww-wwww-wwww-wwwwwwwwwwww",
      projectId: "pppppppp-pppp-pppp-pppp-pppppppppppp",
      scopeLevel: "project",
      correlationId: "corr-1",
      sourceChannel: "external_api",
    });
    expect(page.rows[1].actorUserId).toBeNull();
    expect(page.rows[1].tenantId).toBeNull();
    expect(page.rows[1].correlationId).toBeNull();
    expect(page.rows).toHaveLength(50);
    expect(page.nextCursor).toEqual({
      eventAt: rows[49].event_at,
      eventId: "event-49",
    });

    // No mutation of inputs or RPC rows.
    expect(rows).toEqual(frozenSnapshot);
    expect(cursor).toEqual({ eventAt: "2026-08-05T09:00:00.000Z", eventId: "event-prev" });
  });

  it("terminates pagination on a short page and an empty page", async () => {
    const short = [rawRow(1), rawRow(2), rawRow(3)];
    const { client, calls } = stubClient((args) =>
      Promise.resolve({ data: args._before_event_at === null ? short : [], error: null }),
    );
    const read = createApiClientActivityReader(client);

    const first = await read(platform, null);
    expect(first.rows.map((r) => r.eventId)).toEqual(["event-1", "event-2", "event-3"]);
    expect(first.nextCursor).toBeNull();

    const empty = await read(platform, { eventAt: "2026-08-05T08:00:00.000Z", eventId: "e" });
    expect(empty.rows).toEqual([]);
    expect(empty.nextCursor).toBeNull();

    for (const args of calls) {
      expect(args._limit).toBe(50);
      expect(Object.keys(args).sort()).toEqual([
        "_api_client_id",
        "_before_event_at",
        "_before_event_id",
        "_limit",
        "_organization_id",
      ]);
    }
  });

  it("builds query options and contains every failure as activity_unavailable", async () => {
    const noop = createApiClientActivityReader(
      stubClient(() => Promise.resolve({ data: [], error: null })).client,
    );

    const platformOptions = buildApiClientActivityQueryOptions(platform, noop);
    expect(platformOptions.queryKey).toEqual([
      "api-client-activity",
      "platform",
      null,
      CLIENT_ID,
    ]);
    expect(platformOptions.initialPageParam).toBeNull();
    expect(platformOptions.staleTime).toBe(30_000);
    expect(platformOptions.retry).toBe(false);
    expect(platformOptions.enabled).toBe(true);

    const orgOptions = buildApiClientActivityQueryOptions(organization, noop);
    expect(orgOptions.queryKey).toEqual([
      "api-client-activity",
      "organization",
      ORG_ID,
      CLIENT_ID,
    ]);
    expect(orgOptions.enabled).toBe(true);
    expect(
      buildApiClientActivityQueryOptions({ ...organization, enabled: false }, noop).enabled,
    ).toBe(false);
    expect(
      buildApiClientActivityQueryOptions({ ...organization, organizationId: null }, noop).enabled,
    ).toBe(false);
    expect(
      buildApiClientActivityQueryOptions({ ...platform, organizationId: ORG_ID }, noop).enabled,
    ).toBe(false);
    expect(
      buildApiClientActivityQueryOptions({ ...platform, apiClientId: "" }, noop).enabled,
    ).toBe(false);

    const withCursor: ApiClientActivityPage = {
      rows: [],
      nextCursor: { eventAt: "2026-08-05T10:00:00.000Z", eventId: "event-9" },
    };
    expect(platformOptions.getNextPageParam(withCursor)).toEqual(withCursor.nextCursor);
    expect(platformOptions.getNextPageParam({ rows: [], nextCursor: null })).toBeUndefined();

    const secret = "password=hunter2 SQLSTATE 42501";
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const failures: ApiClientActivityRpcClient[] = [
      { rpc: () => { throw new Error(secret); } },
      { rpc: () => Promise.reject(new Error(secret)) },
      { rpc: () => Promise.resolve({ data: null, error: { message: secret } }) },
      { rpc: () => Promise.resolve({ data: { rows: [] }, error: null }) },
      { rpc: () => Promise.resolve({ data: [rawRow(1, { http_status: 700 })], error: null }) },
      { rpc: () => Promise.resolve({ data: [rawRow(1, { status_class: "weird" })], error: null }) },
      { rpc: () => Promise.resolve({ data: [rawRow(1, { duration_ms: -1 })], error: null }) },
      { rpc: () => Promise.resolve({ data: [rawRow(1, { scope_level: "global" })], error: null }) },
      { rpc: () => Promise.resolve({ data: [rawRow(1, { event_id: "" })], error: null }) },
    ];

    for (const client of failures) {
      const read = createApiClientActivityReader(client);
      await expect(read(platform, null)).rejects.toThrow(/^activity_unavailable$/);
    }

    expect(errorSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
