// API-M.CP.3B — Focused tests for the non-live Execution Update HTTP read
// foundation: frozen GET route contract, strict query parser, dedicated cursor,
// fixed RPC adapter and caller-bound delegated reader.

import {
  assert,
  assertEquals,
  assertRejects,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { ApiHttpError } from "../../_shared/btpm-api/http.ts";
import {
  decodeApiV1ExecutionUpdateCursor,
  encodeApiV1ExecutionUpdateCursor,
  EXECUTION_UPDATES_APPEND_ROUTE,
  EXECUTION_UPDATES_READ_ROUTE,
  parseApiV1AppendExecutionUpdateBody,
  parseApiV1ExecutionUpdatesReadQuery,
} from "../routes/executionUpdates.ts";
import {
  readApiV1ExecutionUpdates,
  type ApiV1ExecutionUpdateReadRpcClient,
} from "../../_shared/btpm-api/supabaseExecutionUpdateRead.ts";
import { createDelegatedApiV1ExecutionUpdatesReader } from "../../_shared/btpm-api/supabaseDelegatedExecutionUpdateRead.ts";
import { API_V1_ROUTE_ALLOWLIST } from "../router.ts";

const TARGET_ID = "8f14e45f-ceea-467a-a4a7-2b4b0c7f4d21";
const UPDATE_ID = "1b4e28ba-2fa1-4d1b-a0f4-4b5d6c7e8f90";
const AUTHOR_ID = "3c9e6f2a-1b2c-4d3e-8f4a-5b6c7d8e9f01";
const NIL = "00000000-0000-0000-0000-000000000000";
const CLIENT_ID = "btpm-test-client";

function query(overrides: Record<string, string | null> = {}) {
  const base: Record<string, string | null> = {
    targetType: "phase",
    targetId: TARGET_ID,
    ...overrides,
  };
  const parts: string[] = [];
  for (const [k, v] of Object.entries(base)) {
    if (v !== null) parts.push(`${k}=${v}`);
  }
  return `?${parts.join("&")}`;
}

function assertInvalidQuery(search: string) {
  const err = assertThrows(
    () => parseApiV1ExecutionUpdatesReadQuery(search),
    ApiHttpError,
  );
  assertEquals(err.code, "invalid_request");
}

function item(overrides: Record<string, unknown> = {}) {
  return {
    executionUpdateId: UPDATE_ID,
    targetType: "phase",
    targetId: TARGET_ID,
    authorId: AUTHOR_ID,
    summary: "  Narrative kept verbatim  ",
    statusLabel: null,
    updateDate: "2026-08-07",
    createdAt: "2026-08-07T10:11:12.000Z",
    ...overrides,
  };
}

function rpcClient(
  result: unknown,
  calls: Array<{ name: string; args: Record<string, unknown> }>,
): ApiV1ExecutionUpdateReadRpcClient {
  return {
    rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return Promise.resolve(result);
    },
  };
}

// -----------------------------------------------------------------------------
// Route contracts
// -----------------------------------------------------------------------------

Deno.test("API-M.CP.3B: GET route contract is frozen and exact", () => {
  assertEquals(EXECUTION_UPDATES_READ_ROUTE.id, "execution_updates.get");
  assertEquals(EXECUTION_UPDATES_READ_ROUTE.method, "GET");
  assertEquals(EXECUTION_UPDATES_READ_ROUTE.path, "/v1/execution-updates");
  assertEquals(EXECUTION_UPDATES_READ_ROUTE.operation, "read");
  assertEquals(Object.keys(EXECUTION_UPDATES_READ_ROUTE).length, 4);
  assert(Object.isFrozen(EXECUTION_UPDATES_READ_ROUTE));
});

Deno.test("API-M.CP.3B: existing POST append contract is unchanged", () => {
  assertEquals(EXECUTION_UPDATES_APPEND_ROUTE.id, "execution_updates.append");
  assertEquals(EXECUTION_UPDATES_APPEND_ROUTE.method, "POST");
  assertEquals(EXECUTION_UPDATES_APPEND_ROUTE.path, "/v1/execution-updates");
  assertEquals(EXECUTION_UPDATES_APPEND_ROUTE.operation, "mutation");
  const parsed = parseApiV1AppendExecutionUpdateBody({
    targetType: "task",
    targetId: TARGET_ID,
    summary: "Progress narrative.",
    updateDate: "2026-08-07",
  });
  assertEquals(parsed, {
    targetType: "task",
    targetId: TARGET_ID,
    summary: "Progress narrative.",
    updateDate: "2026-08-07",
    statusLabel: null,
  });
});

// API-M.CP.3C superseded the CP.3B non-live expectation: the frozen read is now
// registered in the live allowlist exactly once.
// API-N.RG1A — current global cardinality is owned by
// api-v1-current-surface-topology.test.ts.
Deno.test("API-M.CP.3B/API-M.CP.3C: execution_updates.get is registered exactly once", () => {
  assertEquals(
    API_V1_ROUTE_ALLOWLIST.filter((r) =>
      (r.id as string) === "execution_updates.get"
    ).length,
    1,
  );
});

// -----------------------------------------------------------------------------
// Query parser
// -----------------------------------------------------------------------------

Deno.test("API-M.CP.3B: minimal valid query yields frozen four-key result", () => {
  const parsed = parseApiV1ExecutionUpdatesReadQuery(query());
  assertEquals(parsed, {
    targetType: "phase",
    targetId: TARGET_ID,
    limit: 100,
    cursor: null,
  });
  assertEquals(Object.keys(parsed).length, 4);
  assert(Object.isFrozen(parsed));
});

Deno.test("API-M.CP.3B: targetType and targetId are mandatory", () => {
  assertInvalidQuery("");
  assertInvalidQuery("?");
  assertInvalidQuery(query({ targetType: null }));
  assertInvalidQuery(query({ targetId: null }));
  assertInvalidQuery(query({ targetType: "" }));
  assertInvalidQuery(query({ targetId: "" }));
});

Deno.test("API-M.CP.3B: targetType is strict phase|task with no normalization", () => {
  assertEquals(
    parseApiV1ExecutionUpdatesReadQuery(query({ targetType: "task" }))
      .targetType,
    "task",
  );
  for (const bad of ["project", "Phase", "TASK", "%20phase", "task%20"]) {
    assertInvalidQuery(query({ targetType: bad }));
  }
});

Deno.test("API-M.CP.3B: targetId must be a non-nil canonical UUID", () => {
  for (const bad of [NIL, "nope", TARGET_ID.replace(/-/g, ""), "123"]) {
    assertInvalidQuery(query({ targetId: bad }));
  }
});

Deno.test("API-M.CP.3B: limit defaults to 100 and is bounded 1..500", () => {
  assertEquals(parseApiV1ExecutionUpdatesReadQuery(query()).limit, 100);
  assertEquals(
    parseApiV1ExecutionUpdatesReadQuery(query({ limit: "1" })).limit,
    1,
  );
  assertEquals(
    parseApiV1ExecutionUpdatesReadQuery(query({ limit: "500" })).limit,
    500,
  );
  for (const bad of ["0", "501", "-1", "1.5", "1e2", "abc", "+5", " 5", ""]) {
    assertInvalidQuery(query({ limit: bad }));
  }
});

Deno.test("API-M.CP.3B: duplicates, unknown params, fragments and bad encoding rejected", () => {
  assertInvalidQuery(`?targetType=phase&targetType=task&targetId=${TARGET_ID}`);
  assertInvalidQuery(
    `?targetType=phase&targetId=${TARGET_ID}&targetId=${TARGET_ID}`,
  );
  assertInvalidQuery(`?targetType=phase&targetId=${TARGET_ID}&projectId=x`);
  assertInvalidQuery(`?targetType=phase&targetId=${TARGET_ID}&target_type=x`);
  assertInvalidQuery(`?targetType=phase&targetId=${TARGET_ID}#frag`);
  assertInvalidQuery(`?targetType=phase&targetId=${TARGET_ID}&limit=%ZZ`);
  assertInvalidQuery(`targetType=phase&targetId=${TARGET_ID}`);
});

// -----------------------------------------------------------------------------
// Cursor
// -----------------------------------------------------------------------------

Deno.test("API-M.CP.3B: cursor round-trips and carries only keyset position", () => {
  const encoded = encodeApiV1ExecutionUpdateCursor({
    createdAt: "2026-08-07T10:11:12.000Z",
    id: UPDATE_ID,
  });
  assert(/^[A-Za-z0-9_-]+$/.test(encoded));
  const decoded = decodeApiV1ExecutionUpdateCursor(encoded);
  assertEquals(decoded, {
    createdAt: "2026-08-07T10:11:12.000Z",
    id: UPDATE_ID,
  });
  const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const json = JSON.parse(
    atob(normalized + "=".repeat((4 - (normalized.length % 4)) % 4)),
  );
  assertEquals(Object.keys(json).sort(), ["createdAt", "id", "v"]);
  assertEquals(json.v, 1);

  const viaQuery = parseApiV1ExecutionUpdatesReadQuery(
    query({ cursor: encoded }),
  );
  assertEquals(viaQuery.cursor, decoded);
});

Deno.test("API-M.CP.3B: malformed external cursors are invalid_request", () => {
  const bad = [
    "!!!",
    "",
    btoa(JSON.stringify({ v: 2, createdAt: "2026-08-07T00:00:00Z", id: UPDATE_ID }))
      .replace(/=+$/, ""),
    btoa(JSON.stringify({ v: 1, createdAt: "nope", id: UPDATE_ID })).replace(
      /=+$/,
      "",
    ),
    btoa(
      JSON.stringify({
        v: 1,
        createdAt: "2026-08-07T00:00:00Z",
        id: UPDATE_ID,
        targetId: TARGET_ID,
      }),
    ).replace(/=+$/, ""),
    btoa(JSON.stringify({ v: 1, createdAt: "2026-08-07T00:00:00Z", id: NIL }))
      .replace(/=+$/, ""),
  ];
  for (const raw of bad) {
    const err = assertThrows(
      () => decodeApiV1ExecutionUpdateCursor(raw),
      ApiHttpError,
    );
    assertEquals(err.code, "invalid_request");
  }
});

Deno.test("API-M.CP.3B: internal cursor encoding failure is internal_error", () => {
  const err = assertThrows(
    () =>
      encodeApiV1ExecutionUpdateCursor(
        { createdAt: "not-a-timestamp", id: UPDATE_ID },
      ),
    ApiHttpError,
  );
  assertEquals(err.code, "internal_error");
});

// -----------------------------------------------------------------------------
// RPC adapter
// -----------------------------------------------------------------------------

Deno.test("API-M.CP.3B: adapter calls the exact wrapper with exact arguments", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = rpcClient(
    { data: { items: [], nextCursorCreatedAt: null, nextCursorId: null }, error: null },
    calls,
  );
  await readApiV1ExecutionUpdates(client, CLIENT_ID, "task", TARGET_ID, 25, null);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, "api_v1_list_execution_updates");
  assertEquals(Object.keys(calls[0].args).sort(), [
    "_after_created_at",
    "_after_id",
    "_expected_oauth_client_id",
    "_limit",
    "_target_id",
    "_target_type",
  ]);
  assertEquals(calls[0].args, {
    _expected_oauth_client_id: CLIENT_ID,
    _target_type: "task",
    _target_id: TARGET_ID,
    _limit: 25,
    _after_created_at: null,
    _after_id: null,
  });

  calls.length = 0;
  await readApiV1ExecutionUpdates(client, CLIENT_ID, "phase", TARGET_ID, 10, {
    createdAt: "2026-08-07T10:11:12.000Z",
    id: UPDATE_ID,
  });
  assertEquals(calls[0].args._after_created_at, "2026-08-07T10:11:12.000Z");
  assertEquals(calls[0].args._after_id, UPDATE_ID);
});

Deno.test("API-M.CP.3B: item validation exposes exactly the eight external fields", async () => {
  const payload = await readApiV1ExecutionUpdates(
    rpcClient(
      { data: { items: [item()], nextCursorCreatedAt: null, nextCursorId: null }, error: null },
      [],
    ),
    CLIENT_ID,
    "phase",
    TARGET_ID,
    100,
    null,
  );
  assertEquals(Object.keys(payload).sort(), ["items", "nextCursor"]);
  assertEquals(payload.nextCursor, null);
  assertEquals(Object.keys(payload.items[0]), [
    "executionUpdateId",
    "targetType",
    "targetId",
    "authorId",
    "summary",
    "statusLabel",
    "updateDate",
    "createdAt",
  ]);
  // authorId is the raw stored UUID — no enrichment.
  assertEquals(payload.items[0].authorId, AUTHOR_ID);
  assertEquals(payload.items[0].summary, "  Narrative kept verbatim  ");
});

Deno.test("API-M.CP.3B: missing or extra item fields are internal_error", async () => {
  const variants: unknown[] = [
    item({ updatedAt: "2026-08-07T00:00:00Z" }),
    item({ projectId: TARGET_ID }),
    item({ organizationId: TARGET_ID }),
    (() => {
      const v = item();
      delete (v as Record<string, unknown>).authorId;
      return v;
    })(),
    item({ targetType: "project" }),
    item({ executionUpdateId: NIL }),
    item({ updateDate: "2026-02-30" }),
    item({ createdAt: "nope" }),
    item({ summary: 5 }),
  ];
  for (const bad of variants) {
    const err = await assertRejects(
      () =>
        readApiV1ExecutionUpdates(
          rpcClient(
            { data: { items: [bad], nextCursorCreatedAt: null, nextCursorId: null }, error: null },
            [],
          ),
          CLIENT_ID,
          "phase",
          TARGET_ID,
          100,
          null,
        ),
      ApiHttpError,
    );
    assertEquals(err.code, "internal_error");
  }
});

Deno.test("API-M.CP.3B: internal keyset pair translates to one opaque external cursor", async () => {
  const payload = await readApiV1ExecutionUpdates(
    rpcClient(
      {
        data: {
          items: [item()],
          nextCursorCreatedAt: "2026-08-07T10:11:12.000Z",
          nextCursorId: UPDATE_ID,
        },
        error: null,
      },
      [],
    ),
    CLIENT_ID,
    "phase",
    TARGET_ID,
    100,
    null,
  );
  assertEquals(typeof payload.nextCursor, "string");
  assertEquals(decodeApiV1ExecutionUpdateCursor(payload.nextCursor as string), {
    createdAt: "2026-08-07T10:11:12.000Z",
    id: UPDATE_ID,
  });
  assert(!("nextCursorCreatedAt" in payload));
  assert(!("nextCursorId" in payload));
});

Deno.test("API-M.CP.3B: partial or malformed keyset pair is internal_error", async () => {
  const variants = [
    { nextCursorCreatedAt: "2026-08-07T10:11:12.000Z", nextCursorId: null },
    { nextCursorCreatedAt: null, nextCursorId: UPDATE_ID },
    { nextCursorCreatedAt: "nope", nextCursorId: UPDATE_ID },
    { nextCursorCreatedAt: "2026-08-07T10:11:12.000Z", nextCursorId: NIL },
  ];
  for (const v of variants) {
    const err = await assertRejects(
      () =>
        readApiV1ExecutionUpdates(
          rpcClient({ data: { items: [], ...v }, error: null }, []),
          CLIENT_ID,
          "phase",
          TARGET_ID,
          100,
          null,
        ),
      ApiHttpError,
    );
    assertEquals(err.code, "internal_error");
  }
});

Deno.test("API-M.CP.3B: SQLSTATE mapping is exact and introduces no not_found", async () => {
  const cases: Array<[unknown, string]> = [
    [{ code: "42501" }, "not_authorized"],
    [{ code: "22023" }, "invalid_request"],
    [{ code: "P0001" }, "internal_error"],
    [{ code: "23505" }, "internal_error"],
    [{ message: "boom" }, "internal_error"],
  ];
  for (const [error, expected] of cases) {
    const err = await assertRejects(
      () =>
        readApiV1ExecutionUpdates(
          rpcClient({ data: null, error }, []),
          CLIENT_ID,
          "phase",
          TARGET_ID,
          100,
          null,
        ),
      ApiHttpError,
    );
    assertEquals(err.code, expected);
  }
});

// -----------------------------------------------------------------------------
// Delegated caller-bound reader
// -----------------------------------------------------------------------------

Deno.test("API-M.CP.3B: delegated reader builds a fresh caller-bearer-bound anon client", async () => {
  const constructions: Array<
    { url: string; key: string; options: Record<string, unknown> }
  > = [];
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];

  const reader = createDelegatedApiV1ExecutionUpdatesReader(
    "https://project.example.co",
    "anon-key",
    (url, key, options) => {
      constructions.push({
        url,
        key,
        options: options as unknown as Record<string, unknown>,
      });
      return rpcClient(
        { data: { items: [item()], nextCursorCreatedAt: null, nextCursorId: null }, error: null },
        calls,
      );
    },
  );

  const request = new Request("https://edge.example.co/v1/execution-updates", {
    headers: { Authorization: "Bearer caller-token" },
  });
  const context = {
    token: {},
    client: { oauthClientId: CLIENT_ID },
  } as unknown as Parameters<typeof reader>[1];

  const first = await reader(request, context, "phase", TARGET_ID, 100, null);
  assertEquals(first.items.length, 1);
  await reader(request, context, "phase", TARGET_ID, 100, null);

  // Fresh client per invocation, anon key only, caller bearer forwarded.
  assertEquals(constructions.length, 2);
  for (const c of constructions) {
    assertEquals(c.url, "https://project.example.co");
    assertEquals(c.key, "anon-key");
    assertEquals(
      (c.options as {
        global: { headers: { Authorization: string } };
      }).global.headers.Authorization,
      "Bearer caller-token",
    );
    assertEquals(
      (c.options as { auth: { persistSession: boolean } }).auth.persistSession,
      false,
    );
  }
  for (const call of calls) {
    assertEquals(call.name, "api_v1_list_execution_updates");
    assertEquals(call.args._expected_oauth_client_id, CLIENT_ID);
  }
});

Deno.test("API-M.CP.3B: no service-role key or generic read path exists in the read modules", async () => {
  for (
    const path of [
      "../../_shared/btpm-api/supabaseExecutionUpdateRead.ts",
      "../../_shared/btpm-api/supabaseDelegatedExecutionUpdateRead.ts",
    ]
  ) {
    const source = await Deno.readTextFile(new URL(path, import.meta.url));
    for (
      const needle of [
        "SERVICE_ROLE",
        "service_role",
        "Deno.env",
        "fetch(",
        "from(",
        "execute_sql",
        "console.log",
        "setTimeout",
      ]
    ) {
      assert(!source.includes(needle), `${path} must not contain: ${needle}`);
    }
    assertEquals(
      (source.match(/\.rpc\(/g) ?? []).length <= 1,
      true,
      `${path} must not expose a generic read executor`,
    );
  }
});
