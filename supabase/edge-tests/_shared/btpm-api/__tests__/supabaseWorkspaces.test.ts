// Relocated out of supabase/functions/ (Edge deploy bundle size).
// Source-file reads stay anchored to the original module location.
const __BTPM_SELF_URL__ = import.meta.url;
const __BTPM_SRC_BASE__ = new URL('../../../../functions/_shared/btpm-api/__tests__/supabaseWorkspaces.test.ts', import.meta.url).href;
// API-H.2C — Focused tests for the caller-scoped `/v1/workspaces` adapter.

import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  type ApiV1WorkspacesQuery,
  readApiV1Workspaces,
} from "../../../../functions/_shared/btpm-api/supabaseWorkspaces.ts";
import { ApiHttpError } from "../../../../functions/_shared/btpm-api/http.ts";

const CLIENT_ID = "btpm-test-client";
const ORG_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const OTHER_ORG_ID = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
const WS_ID = "11111111-2222-4333-8444-555555555555";
const WS_ID_2 = "22222222-3333-4444-8555-666666666666";
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

const QUERY: ApiV1WorkspacesQuery = Object.freeze({
  organizationId: ORG_ID,
  limit: 25,
  offset: 0,
  search: null,
}) as ApiV1WorkspacesQuery;

interface RpcCall {
  fn: string;
  args: unknown;
}

function makeClient(
  response: unknown | (() => Promise<unknown>),
  calls: RpcCall[] = [],
) {
  return {
    calls,
    rpc(fn: string, args: unknown) {
      calls.push({ fn, args });
      if (typeof response === "function") {
        return (response as () => Promise<unknown>)();
      }
      return Promise.resolve(response);
    },
  };
}

function okPayload(overrides?: {
  items?: unknown;
  pagination?: unknown;
}) {
  return {
    data: {
      items: overrides?.items ?? [
        { workspaceId: WS_ID, organizationId: ORG_ID, name: "Delivery" },
      ],
      pagination: overrides?.pagination ??
        { limit: 25, offset: 0, returned: 1, total: 1 },
    },
    error: null,
  };
}

Deno.test("calls exactly api_v1_list_workspaces with the exact five args and null search", async () => {
  const calls: RpcCall[] = [];
  const client = makeClient(okPayload(), calls);
  await readApiV1Workspaces(client, CLIENT_ID, QUERY);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].fn, "api_v1_list_workspaces");
  assertEquals(calls[0].args, {
    _expected_oauth_client_id: CLIENT_ID,
    _organization_id: ORG_ID,
    _limit: 25,
    _offset: 0,
    _search: null,
  });
});

Deno.test("returns newly constructed frozen structures and mutates nothing", async () => {
  const rawItem = {
    workspaceId: WS_ID,
    organizationId: ORG_ID,
    name: "Delivery",
  };
  const rawPagination = { limit: 25, offset: 0, returned: 1, total: 3 };
  const result = { data: { items: [rawItem], pagination: rawPagination }, error: null };
  const client = makeClient(result);

  const payload = await readApiV1Workspaces(client, CLIENT_ID, QUERY);

  assertEquals(payload, {
    items: [{ workspaceId: WS_ID, organizationId: ORG_ID, name: "Delivery" }],
    pagination: { limit: 25, offset: 0, returned: 1, total: 3 },
  });
  assert(Object.isFrozen(payload));
  assert(Object.isFrozen(payload.items));
  assert(Object.isFrozen(payload.items[0]));
  assert(Object.isFrozen(payload.pagination));

  assert(payload.items[0] !== rawItem);
  assert(payload.pagination !== rawPagination);
  assert(!Object.isFrozen(rawItem));
  assert(!Object.isFrozen(rawPagination));
  assertEquals(rawItem, { workspaceId: WS_ID, organizationId: ORG_ID, name: "Delivery" });
  assertEquals(rawPagination, { limit: 25, offset: 0, returned: 1, total: 3 });
  assertEquals(QUERY, {
    organizationId: ORG_ID,
    limit: 25,
    offset: 0,
    search: null,
  });
  assertEquals(typeof client.rpc, "function");

  const second = await readApiV1Workspaces(client, CLIENT_ID, QUERY);
  assert(second !== payload);
});

Deno.test("invalid expected OAuth client IDs fail before the RPC call as internal_error", async () => {
  const bad = ["", " abc", "abc ", "a b", "bad#id", "x".repeat(256)];
  for (const value of bad) {
    const calls: RpcCall[] = [];
    const client = makeClient(okPayload(), calls);
    const err = await assertRejects(
      () => readApiV1Workspaces(client, value, QUERY),
      ApiHttpError,
    );
    assertEquals(err.code, "internal_error");
    assertEquals(calls.length, 0);
  }
  const calls: RpcCall[] = [];
  const client = makeClient(okPayload(), calls);
  const err = await assertRejects(
    () =>
      readApiV1Workspaces(
        client,
        123 as unknown as string,
        QUERY,
      ),
    ApiHttpError,
  );
  assertEquals(err.code, "internal_error");
  assertEquals(calls.length, 0);
});

Deno.test("invalid RPC clients fail as internal_error", async () => {
  const bad: unknown[] = [null, undefined, 42, "client", [], {}, { rpc: 1 }];
  for (const client of bad) {
    const err = await assertRejects(
      () =>
        readApiV1Workspaces(
          client as never,
          CLIENT_ID,
          QUERY,
        ),
      ApiHttpError,
    );
    assertEquals(err.code, "internal_error");
  }
});

Deno.test("invalid query shapes fail before the RPC call as invalid_request", async () => {
  const bad: unknown[] = [
    null,
    [],
    "query",
    { organizationId: ORG_ID, limit: 25, offset: 0 },
    { organizationId: ORG_ID, limit: 25, offset: 0, search: null, extra: 1 },
    { organizationId: ORG_ID, limit: 0, offset: 0, search: null },
    { organizationId: ORG_ID, limit: 101, offset: 0, search: null },
    { organizationId: ORG_ID, limit: 1.5, offset: 0, search: null },
    { organizationId: ORG_ID, limit: Number.NaN, offset: 0, search: null },
    { organizationId: ORG_ID, limit: 25, offset: -1, search: null },
    { organizationId: ORG_ID, limit: 25, offset: 10001, search: null },
    { organizationId: ORG_ID, limit: 25, offset: Infinity, search: null },
    { organizationId: ORG_ID, limit: 25, offset: 0, search: 5 },
    { organizationId: ORG_ID, limit: 25, offset: 0, search: "x".repeat(101) },
  ];
  for (const query of bad) {
    const calls: RpcCall[] = [];
    const client = makeClient(okPayload(), calls);
    const err = await assertRejects(
      () => readApiV1Workspaces(client, CLIENT_ID, query as never),
      ApiHttpError,
    );
    assertEquals(err.code, "invalid_request");
    assertEquals(calls.length, 0);
  }
});

Deno.test("invalid or nil organizationId fails before the RPC call", async () => {
  const bad: unknown[] = [NIL_UUID, "not-a-uuid", "", 1, null, ` ${ORG_ID} `];
  for (const organizationId of bad) {
    const calls: RpcCall[] = [];
    const client = makeClient(okPayload(), calls);
    const err = await assertRejects(
      () =>
        readApiV1Workspaces(
          client,
          CLIENT_ID,
          { organizationId, limit: 25, offset: 0, search: null } as never,
        ),
      ApiHttpError,
    );
    assertEquals(err.code, "invalid_request");
    assertEquals(calls.length, 0);
  }
});

Deno.test("boundary pagination values are accepted", async () => {
  const query = Object.freeze({
    organizationId: ORG_ID,
    limit: 1,
    offset: 10000,
    search: "x".repeat(100),
  }) as ApiV1WorkspacesQuery;
  const calls: RpcCall[] = [];
  const client = makeClient(
    {
      data: {
        items: [],
        pagination: { limit: 1, offset: 10000, returned: 0, total: 0 },
      },
      error: null,
    },
    calls,
  );
  const payload = await readApiV1Workspaces(client, CLIENT_ID, query);
  assertEquals(payload.items.length, 0);
  assertEquals(calls[0].args, {
    _expected_oauth_client_id: CLIENT_ID,
    _organization_id: ORG_ID,
    _limit: 1,
    _offset: 10000,
    _search: "x".repeat(100),
  });

  const maxQuery = Object.freeze({
    organizationId: ORG_ID,
    limit: 100,
    offset: 0,
    search: null,
  }) as ApiV1WorkspacesQuery;
  const okClient = makeClient({
    data: {
      items: [{ workspaceId: WS_ID, organizationId: ORG_ID, name: "A" }],
      pagination: { limit: 100, offset: 0, returned: 1, total: 1 },
    },
    error: null,
  });
  const maxPayload = await readApiV1Workspaces(okClient, CLIENT_ID, maxQuery);
  assertEquals(maxPayload.pagination.limit, 100);
});

Deno.test("database error mapping: 42501 -> not_authorized, 22023 -> invalid_request, others -> internal_error", async () => {
  const denied = await assertRejects(
    () =>
      readApiV1Workspaces(
        makeClient({ data: null, error: { code: "42501", message: "denied" } }),
        CLIENT_ID,
        QUERY,
      ),
    ApiHttpError,
  );
  assertEquals(denied.code, "not_authorized");
  assertEquals(denied.status, 403);
  assert(!String(denied.publicMessage).includes("denied"));

  const invalid = await assertRejects(
    () =>
      readApiV1Workspaces(
        makeClient({ data: null, error: { code: "22023", message: "bad param" } }),
        CLIENT_ID,
        QUERY,
      ),
    ApiHttpError,
  );
  assertEquals(invalid.code, "invalid_request");
  assertEquals(invalid.status, 400);
  assert(!String(invalid.publicMessage).includes("bad param"));

  for (
    const error of [
      { code: "23505", message: "secret detail" },
      { message: "no code" },
      "string-error",
      42,
    ]
  ) {
    const err = await assertRejects(
      () =>
        readApiV1Workspaces(
          makeClient({ data: null, error }),
          CLIENT_ID,
          QUERY,
        ),
      ApiHttpError,
    );
    assertEquals(err.code, "internal_error");
    assertEquals(err.status, 500);
    assert(!String(err.publicMessage).includes("secret detail"));
  }
});

Deno.test("rejected RPC promise maps to internal_error", async () => {
  const err = await assertRejects(
    () =>
      readApiV1Workspaces(
        makeClient(() => Promise.reject(new Error("boom"))),
        CLIENT_ID,
        QUERY,
      ),
    ApiHttpError,
  );
  assertEquals(err.code, "internal_error");
});

Deno.test("malformed RPC envelopes fail closed", async () => {
  const bad: unknown[] = [
    null,
    undefined,
    [],
    "result",
    {},
    { data: {} },
    { error: null },
    { data: { items: [], pagination: {} }, error: undefined },
  ];
  for (const response of bad) {
    const err = await assertRejects(
      () => readApiV1Workspaces(makeClient(response), CLIENT_ID, QUERY),
      ApiHttpError,
    );
    assertEquals(err.code, "internal_error");
  }
});

Deno.test("payload key, item and pagination violations fail closed", async () => {
  const badData: unknown[] = [
    // missing / additional top-level keys
    null,
    [],
    { items: [] },
    { pagination: { limit: 25, offset: 0, returned: 0, total: 0 } },
    { items: [], pagination: { limit: 25, offset: 0, returned: 0, total: 0 }, extra: 1 },
    // items not an array
    { items: {}, pagination: { limit: 25, offset: 0, returned: 0, total: 0 } },
    // invalid workspace uuid
    {
      items: [{ workspaceId: "nope", organizationId: ORG_ID, name: "A" }],
      pagination: { limit: 25, offset: 0, returned: 1, total: 1 },
    },
    {
      items: [{ workspaceId: NIL_UUID, organizationId: ORG_ID, name: "A" }],
      pagination: { limit: 25, offset: 0, returned: 1, total: 1 },
    },
    // invalid organization uuid
    {
      items: [{ workspaceId: WS_ID, organizationId: "nope", name: "A" }],
      pagination: { limit: 25, offset: 0, returned: 1, total: 1 },
    },
    // organization mismatch
    {
      items: [{ workspaceId: WS_ID, organizationId: OTHER_ORG_ID, name: "A" }],
      pagination: { limit: 25, offset: 0, returned: 1, total: 1 },
    },
    // duplicate workspace ids
    {
      items: [
        { workspaceId: WS_ID, organizationId: ORG_ID, name: "A" },
        { workspaceId: WS_ID, organizationId: ORG_ID, name: "B" },
      ],
      pagination: { limit: 25, offset: 0, returned: 2, total: 2 },
    },
    // empty / non-string name
    {
      items: [{ workspaceId: WS_ID, organizationId: ORG_ID, name: "" }],
      pagination: { limit: 25, offset: 0, returned: 1, total: 1 },
    },
    {
      items: [{ workspaceId: WS_ID, organizationId: ORG_ID, name: 5 }],
      pagination: { limit: 25, offset: 0, returned: 1, total: 1 },
    },
    // additional / missing item field
    {
      items: [
        { workspaceId: WS_ID, organizationId: ORG_ID, name: "A", extra: 1 },
      ],
      pagination: { limit: 25, offset: 0, returned: 1, total: 1 },
    },
    {
      items: [{ workspaceId: WS_ID, organizationId: ORG_ID }],
      pagination: { limit: 25, offset: 0, returned: 1, total: 1 },
    },
    { items: [null], pagination: { limit: 25, offset: 0, returned: 1, total: 1 } },
    // pagination mismatch against query
    { items: [], pagination: { limit: 10, offset: 0, returned: 0, total: 0 } },
    { items: [], pagination: { limit: 25, offset: 5, returned: 0, total: 0 } },
    // returned mismatch against item count
    {
      items: [{ workspaceId: WS_ID, organizationId: ORG_ID, name: "A" }],
      pagination: { limit: 25, offset: 0, returned: 2, total: 2 },
    },
    // returned above limit
    { items: [], pagination: { limit: 25, offset: 0, returned: 26, total: 26 } },
    // negative / fractional / non-finite / inconsistent pagination
    { items: [], pagination: { limit: 25, offset: 0, returned: -1, total: 0 } },
    { items: [], pagination: { limit: 25, offset: 0, returned: 0, total: -1 } },
    { items: [], pagination: { limit: 25, offset: 0, returned: 0.5, total: 1 } },
    { items: [], pagination: { limit: 25, offset: 0, returned: 0, total: Infinity } },
    { items: [], pagination: { limit: 25, offset: 0, returned: 0, total: "0" } },
    {
      items: [
        { workspaceId: WS_ID, organizationId: ORG_ID, name: "A" },
        { workspaceId: WS_ID_2, organizationId: ORG_ID, name: "B" },
      ],
      pagination: { limit: 25, offset: 0, returned: 2, total: 1 },
    },
    // pagination shape violations
    { items: [], pagination: [] },
    { items: [], pagination: { limit: 25, offset: 0, returned: 0 } },
    {
      items: [],
      pagination: { limit: 25, offset: 0, returned: 0, total: 0, extra: 1 },
    },
  ];
  for (const data of badData) {
    const err = await assertRejects(
      () =>
        readApiV1Workspaces(
          makeClient({ data, error: null }),
          CLIENT_ID,
          QUERY,
        ),
      ApiHttpError,
      undefined,
      `expected failure for ${JSON.stringify(data)}`,
    );
    assertEquals(err.code, "internal_error");
  }
});

Deno.test("adapter source contains no environment, token, service-role, client-construction, fetch, logging or generic RPC behavior", async () => {
  const source = await Deno.readTextFile(
    new URL("../supabaseWorkspaces.ts", __BTPM_SRC_BASE__),
  );
  for (
    const forbidden of [
      "Deno.env",
      "SUPABASE_",
      "SERVICE_ROLE",
      "service_role",
      "createClient",
      "fetch(",
      "Authorization",
      "Bearer",
      "console.",
      ".from(",
    ]
  ) {
    assert(
      !source.includes(forbidden),
      `adapter must not contain ${forbidden}`,
    );
  }
  const rpcNames = source.match(/"api_v1_[a-z_]+"/g) ?? [];
  assertEquals(rpcNames, ['"api_v1_list_workspaces"']);
});
