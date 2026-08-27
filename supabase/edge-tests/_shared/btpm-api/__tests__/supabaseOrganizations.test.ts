// Relocated out of supabase/functions/ (Edge deploy bundle size).
// Source-file reads stay anchored to the original module location.
const __BTPM_SELF_URL__ = import.meta.url;
const __BTPM_SRC_BASE__ = new URL('../../../../functions/_shared/btpm-api/__tests__/supabaseOrganizations.test.ts', import.meta.url).href;
// API-G.2E — Focused tests for the explicit `/v1/organizations` adapter.

import {
  assert,
  assertEquals,
  assertNotStrictEquals,
  assertStrictEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { ApiHttpError, toSafeHttpErrorResponse } from "../../../../functions/_shared/btpm-api/http.ts";
import {
  type ApiV1OrganizationItem,
  type ApiV1OrganizationsPayload,
  type ApiV1OrganizationsQuery,
  type ApiV1OrganizationsRpcClient,
  readApiV1Organizations,
} from "../../../../functions/_shared/btpm-api/supabaseOrganizations.ts";

const CLIENT_ID = "btpm-external-client_1.0~test:a@b/c";
const UUID_A = "8f14e45f-ceea-467a-a4a7-2b4b0c7f4d21";
const UUID_B = "3f47ac10-58cc-4372-a567-0e02b2c3d479";

const OK_QUERY: ApiV1OrganizationsQuery = Object.freeze({
  limit: 25,
  offset: 0,
  search: null,
}) as ApiV1OrganizationsQuery;

interface Call {
  functionName: string;
  args: unknown;
}

function makeClient(
  result: unknown,
  calls: Call[] = [],
  mode: "resolve" | "reject" = "resolve",
): ApiV1OrganizationsRpcClient & { calls: Call[] } {
  return {
    calls,
    rpc(functionName: string, args: unknown) {
      calls.push({ functionName, args });
      return mode === "resolve"
        ? Promise.resolve(result)
        : Promise.reject(result);
    },
  } as ApiV1OrganizationsRpcClient & { calls: Call[] };
}

function okResult(
  items: ApiV1OrganizationItem[],
  pagination: {
    limit: number;
    offset: number;
    returned: number;
    total: number;
  },
): { data: unknown; error: null } {
  return { data: { items, pagination }, error: null };
}

async function expectApiHttpError(
  fn: () => Promise<unknown>,
): Promise<ApiHttpError> {
  try {
    await fn();
  } catch (err) {
    assert(err instanceof ApiHttpError, "expected ApiHttpError");
    return err;
  }
  throw new Error("expected throw");
}

const goodItem = (id: string, name = "Acme"): ApiV1OrganizationItem =>
  ({ organizationId: id, name, role: "org_admin" }) as ApiV1OrganizationItem;

Deno.test("calls exactly api_v1_list_organizations with the exact argument object", async () => {
  const calls: Call[] = [];
  const client = makeClient(
    okResult([goodItem(UUID_A)], { limit: 25, offset: 0, returned: 1, total: 1 }),
    calls,
  );
  await readApiV1Organizations(client, CLIENT_ID, {
    limit: 25,
    offset: 0,
    search: "acme",
  });
  assertEquals(calls.length, 1);
  assertEquals(calls[0].functionName, "api_v1_list_organizations");
  assertEquals(calls[0].args, {
    _expected_oauth_client_id: CLIENT_ID,
    _limit: 25,
    _offset: 0,
    _search: "acme",
  });
  assertEquals(Object.keys(calls[0].args as object), [
    "_expected_oauth_client_id",
    "_limit",
    "_offset",
    "_search",
  ]);
});

Deno.test("null search is passed through as null", async () => {
  const calls: Call[] = [];
  const client = makeClient(
    okResult([], { limit: 1, offset: 0, returned: 0, total: 0 }),
    calls,
  );
  await readApiV1Organizations(client, CLIENT_ID, {
    limit: 1,
    offset: 0,
    search: null,
  });
  assertEquals((calls[0].args as { _search: unknown })._search, null);
});

Deno.test("valid payload returned as newly-constructed frozen structures", async () => {
  const rawItems = [goodItem(UUID_A), goodItem(UUID_B, "Beta")];
  const rawPagination = { limit: 25, offset: 0, returned: 2, total: 5 };
  const client = makeClient(okResult(rawItems, rawPagination));
  const payload: ApiV1OrganizationsPayload = await readApiV1Organizations(
    client,
    CLIENT_ID,
    OK_QUERY,
  );
  assertEquals(payload.items.length, 2);
  assertEquals(payload.items[0], {
    organizationId: UUID_A,
    name: "Acme",
    role: "org_admin",
  });
  assertEquals(payload.pagination, rawPagination);
  assert(Object.isFrozen(payload));
  assert(Object.isFrozen(payload.items));
  assert(Object.isFrozen(payload.items[0]));
  assert(Object.isFrozen(payload.pagination));
  assertNotStrictEquals(payload.items as unknown, rawItems as unknown);
  assertNotStrictEquals(payload.pagination as unknown, rawPagination as unknown);
  assertNotStrictEquals(payload.items[0] as unknown, rawItems[0] as unknown);
});

Deno.test("does not mutate input client, query or rpc result", async () => {
  const rawItems = [goodItem(UUID_A)];
  const rawPagination = { limit: 25, offset: 0, returned: 1, total: 1 };
  const result = okResult(rawItems, rawPagination);
  const client = makeClient(result);
  const clientKeysBefore = Object.keys(client);
  const query = { limit: 25, offset: 0, search: null };
  await readApiV1Organizations(client, CLIENT_ID, query);
  assertEquals(query, { limit: 25, offset: 0, search: null });
  assertEquals(rawItems.length, 1);
  assertEquals(rawPagination, { limit: 25, offset: 0, returned: 1, total: 1 });
  assertEquals(Object.keys(client), clientKeysBefore);
});

Deno.test("invalid expected OAuth client IDs fail before RPC (internal_error)", async () => {
  const invalid: unknown[] = [
    "",
    " ",
    ` ${CLIENT_ID}`,
    `${CLIENT_ID} `,
    "has space",
    "bad#char",
    "x".repeat(256),
    undefined,
    null,
    0,
    true,
    {},
    [],
  ];
  for (const bad of invalid) {
    const calls: Call[] = [];
    const client = makeClient(
      okResult([], { limit: 25, offset: 0, returned: 0, total: 0 }),
      calls,
    );
    const err = await expectApiHttpError(() =>
      readApiV1Organizations(client, bad as string, OK_QUERY)
    );
    assertEquals(err.code, "internal_error");
    assertEquals(calls.length, 0);
  }
});

Deno.test("invalid client object fails closed with internal_error", async () => {
  for (const bad of [null, undefined, 0, "x", [], {}, { rpc: 1 }]) {
    const err = await expectApiHttpError(() =>
      readApiV1Organizations(
        bad as unknown as ApiV1OrganizationsRpcClient,
        CLIENT_ID,
        OK_QUERY,
      )
    );
    assertEquals(err.code, "internal_error");
  }
});

Deno.test("invalid query rejected before RPC as invalid_request", async () => {
  const badQueries: unknown[] = [
    null,
    undefined,
    "x",
    [],
    { limit: 25, offset: 0 }, // missing search
    { limit: 25, offset: 0, search: null, extra: 1 },
    { limit: 0, offset: 0, search: null },
    { limit: 101, offset: 0, search: null },
    { limit: 1.5, offset: 0, search: null },
    { limit: "25", offset: 0, search: null },
    { limit: 25, offset: -1, search: null },
    { limit: 25, offset: 10001, search: null },
    { limit: 25, offset: 0.5, search: null },
    { limit: 25, offset: 0, search: 0 },
    { limit: 25, offset: 0, search: {} },
    { limit: 25, offset: 0, search: "x".repeat(101) },
    { limit: Number.NaN, offset: 0, search: null },
    { limit: Infinity, offset: 0, search: null },
  ];
  for (const q of badQueries) {
    const calls: Call[] = [];
    const client = makeClient(
      okResult([], { limit: 25, offset: 0, returned: 0, total: 0 }),
      calls,
    );
    const err = await expectApiHttpError(() =>
      readApiV1Organizations(
        client,
        CLIENT_ID,
        q as unknown as ApiV1OrganizationsQuery,
      )
    );
    assertEquals(err.code, "invalid_request");
    assertEquals(calls.length, 0);
  }
});

Deno.test("boundary limit/offset values are accepted", async () => {
  const calls: Call[] = [];
  const client = makeClient(
    okResult([], { limit: 1, offset: 10000, returned: 0, total: 0 }),
    calls,
  );
  await readApiV1Organizations(client, CLIENT_ID, {
    limit: 1,
    offset: 10000,
    search: null,
  });
  const calls2: Call[] = [];
  const client2 = makeClient(
    okResult([], { limit: 100, offset: 0, returned: 0, total: 0 }),
    calls2,
  );
  await readApiV1Organizations(client2, CLIENT_ID, {
    limit: 100,
    offset: 0,
    search: null,
  });
});

Deno.test("SQLSTATE 42501 maps to not_authorized / 403", async () => {
  const client = makeClient({
    data: null,
    error: { code: "42501", message: "permission denied", details: "d", hint: "h" },
  });
  const err = await expectApiHttpError(() =>
    readApiV1Organizations(client, CLIENT_ID, OK_QUERY)
  );
  assertEquals(err.code, "not_authorized");
  assertEquals(err.status, 403);
});

Deno.test("SQLSTATE 22023 maps to invalid_request / 400", async () => {
  const client = makeClient({
    data: null,
    error: { code: "22023", message: "invalid parameter" },
  });
  const err = await expectApiHttpError(() =>
    readApiV1Organizations(client, CLIENT_ID, OK_QUERY)
  );
  assertEquals(err.code, "invalid_request");
  assertEquals(err.status, 400);
});

Deno.test("every other RPC error maps to internal_error / 500", async () => {
  const errors: unknown[] = [
    { code: "42P01", message: "relation does not exist" },
    { code: "PGRST202" },
    { code: 42501 },
    { code: " 42501" },
    { code: "42501 " },
    { code: 22023 },
    { message: "no code" },
    {},
    "string error",
    123,
    true,
    [],
  ];
  for (const e of errors) {
    const client = makeClient({ data: null, error: e });
    const err = await expectApiHttpError(() =>
      readApiV1Organizations(client, CLIENT_ID, OK_QUERY)
    );
    assertEquals(err.code, "internal_error");
    assertEquals(err.status, 500);
  }
});

Deno.test("rejected RPC promise maps to internal_error", async () => {
  const client = makeClient(new Error("boom"), [], "reject");
  const err = await expectApiHttpError(() =>
    readApiV1Organizations(client, CLIENT_ID, OK_QUERY)
  );
  assertEquals(err.code, "internal_error");
});

Deno.test("malformed RPC result shapes fail closed", async () => {
  const bad: unknown[] = [
    undefined,
    null,
    0,
    "",
    "ok",
    true,
    [],
    [okResult([], { limit: 25, offset: 0, returned: 0, total: 0 })],
    {},
    { data: {} },
    { error: null },
    {
      data: { items: [], pagination: { limit: 25, offset: 0, returned: 0, total: 0 } },
      error: undefined,
    },
  ];
  for (const r of bad) {
    const client = makeClient(r);
    const err = await expectApiHttpError(() =>
      readApiV1Organizations(client, CLIENT_ID, OK_QUERY)
    );
    assertEquals(err.code, "internal_error");
  }
});

Deno.test("malformed payload rejected: bad items and pagination", async () => {
  const badDatas: unknown[] = [
    null,
    "x",
    [],
    {},
    { items: [] }, // missing pagination
    { pagination: { limit: 25, offset: 0, returned: 0, total: 0 } }, // missing items
    { items: {}, pagination: { limit: 25, offset: 0, returned: 0, total: 0 } },
    {
      items: [],
      pagination: { limit: 25, offset: 0, returned: 0, total: 0 },
      extra: 1,
    },
    // pagination mismatches submitted query
    { items: [], pagination: { limit: 26, offset: 0, returned: 0, total: 0 } },
    { items: [], pagination: { limit: 25, offset: 1, returned: 0, total: 0 } },
    // returned mismatches items.length
    { items: [goodItem(UUID_A)], pagination: { limit: 25, offset: 0, returned: 0, total: 0 } },
    { items: [], pagination: { limit: 25, offset: 0, returned: 1, total: 1 } },
    // returned > limit not possible here, but total < returned
    { items: [goodItem(UUID_A)], pagination: { limit: 25, offset: 0, returned: 1, total: 0 } },
    // negative values
    { items: [], pagination: { limit: 25, offset: 0, returned: -0.5, total: 0 } },
    { items: [], pagination: { limit: 25, offset: 0, returned: 0, total: -1 } },
    // extra pagination field
    {
      items: [],
      pagination: { limit: 25, offset: 0, returned: 0, total: 0, extra: 1 },
    },
    // duplicate organizationId
    {
      items: [goodItem(UUID_A), goodItem(UUID_A, "Dup")],
      pagination: { limit: 25, offset: 0, returned: 2, total: 2 },
    },
    // bad item shape
    {
      items: [{ organizationId: UUID_A, name: "Acme" }],
      pagination: { limit: 25, offset: 0, returned: 1, total: 1 },
    },
    {
      items: [{ organizationId: UUID_A, name: "Acme", role: "org_admin", extra: 1 }],
      pagination: { limit: 25, offset: 0, returned: 1, total: 1 },
    },
    // invalid UUID
    {
      items: [{ organizationId: "not-a-uuid", name: "Acme", role: "org_admin" }],
      pagination: { limit: 25, offset: 0, returned: 1, total: 1 },
    },
    // nil UUID
    {
      items: [{ organizationId: "00000000-0000-0000-0000-000000000000", name: "Acme", role: "org_admin" }],
      pagination: { limit: 25, offset: 0, returned: 1, total: 1 },
    },
    // empty name
    {
      items: [{ organizationId: UUID_A, name: "", role: "org_admin" }],
      pagination: { limit: 25, offset: 0, returned: 1, total: 1 },
    },
    // non-string name
    {
      items: [{ organizationId: UUID_A, name: 1, role: "org_admin" }],
      pagination: { limit: 25, offset: 0, returned: 1, total: 1 },
    },
    // invalid role
    {
      items: [{ organizationId: UUID_A, name: "Acme", role: "owner" }],
      pagination: { limit: 25, offset: 0, returned: 1, total: 1 },
    },
    // snake_case keys rejected
    {
      items: [{ organization_id: UUID_A, name: "Acme", role: "org_admin" }],
      pagination: { limit: 25, offset: 0, returned: 1, total: 1 },
    },
  ];
  for (const d of badDatas) {
    const client = makeClient({ data: d, error: null });
    const err = await expectApiHttpError(() =>
      readApiV1Organizations(client, CLIENT_ID, OK_QUERY)
    );
    assertEquals(err.code, "internal_error");
  }
});

Deno.test("returned > limit is rejected", async () => {
  const client = makeClient({
    data: {
      items: Array.from({ length: 2 }, (_, i) =>
        goodItem(i === 0 ? UUID_A : UUID_B)),
      pagination: { limit: 1, offset: 0, returned: 2, total: 2 },
    },
    error: null,
  });
  const err = await expectApiHttpError(() =>
    readApiV1Organizations(client, CLIENT_ID, {
      limit: 1,
      offset: 0,
      search: null,
    })
  );
  assertEquals(err.code, "internal_error");
});

Deno.test("safe HTTP serialization never leaks internal details", async () => {
  const protectedTableName = [
    "api",
    "user",
    "policy",
    "acknowledgements",
  ].join("_");
  const client = makeClient({
    data: null,
    error: {
      code: "42501",
      message: "permission denied for function api_v1_list_organizations",
      details: `row 12 of ${protectedTableName}`,
      hint: "grant execute",
    },
  });
  const err = await expectApiHttpError(() =>
    readApiV1Organizations(client, CLIENT_ID, OK_QUERY)
  );
  const response = toSafeHttpErrorResponse(err, "req-1");
  assertEquals(response.status, 403);
  const body = await response.json();
  assertEquals(body, {
    error: { code: "not_authorized", message: "Not authorized." },
    requestId: "req-1",
  });
  const text = JSON.stringify(body);
  for (
    const needle of [
      "permission denied",
      protectedTableName,
      "grant execute",
      "42501",
      CLIENT_ID,
      "api_v1_list_organizations",
    ]
  ) {
    assert(!text.includes(needle), `must not leak: ${needle}`);
  }
});

Deno.test("internal cause is retained non-enumerably only", async () => {
  const dbError = { code: "42501", message: "permission denied" };
  const client = makeClient({ data: null, error: dbError });
  const err = await expectApiHttpError(() =>
    readApiV1Organizations(client, CLIENT_ID, OK_QUERY)
  );
  assertStrictEquals(
    (err as unknown as { internalCause?: unknown }).internalCause,
    dbError,
  );
  assertEquals(Object.keys(err).includes("internalCause"), false);
});

Deno.test("adapter source exposes no dynamic dispatch, env, service role, fetch or server surface", async () => {
  const source = await Deno.readTextFile(
    new URL("../supabaseOrganizations.ts", __BTPM_SRC_BASE__),
  );
  const forbidden = [
    "Deno.env",
    "createClient",
    "SERVICE_ROLE",
    "service_role",
    "fetch(",
    "Deno.serve",
    "serve(",
    "SUPABASE_URL",
    "Authorization",
    "eval(",
    "new Function",
    "execute_sql",
  ];
  for (const needle of forbidden) {
    assert(!source.includes(needle), `must not contain: ${needle}`);
  }
  assert(source.includes(`"api_v1_list_organizations"`));
  assert(!source.includes("client.rpc(functionName"));
  assert(!/rpc\(\s*`/.test(source));
});
