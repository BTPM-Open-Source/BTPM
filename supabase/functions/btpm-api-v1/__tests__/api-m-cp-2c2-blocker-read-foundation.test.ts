// API-M.CP.2C2 — Focused regression tests for the non-live Blocker HTTP read
// foundation:
//   GET /v1/projects/{projectId}/blockers
//   GET /v1/blockers/{blockerId}

import {
  assert,
  assertEquals,
  assertRejects,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { ApiHttpError } from "../../_shared/btpm-api/http.ts";
import {
  API_V1_BLOCKER_LIMIT_DEFAULT,
  API_V1_BLOCKER_LIMIT_MAX,
  BLOCKER_CREATE_ROUTE,
  BLOCKER_DETAIL_ROUTE,
  BLOCKER_PROJECT_COLLECTION_ROUTE,
  BLOCKER_UPDATE_ROUTE,
  decodeApiV1BlockerCursor,
  encodeApiV1BlockerCursor,
  parseApiV1BlockerDetailPath,
  parseApiV1BlockerUpdatePath,
  parseApiV1CreateBlockerBody,
  parseApiV1ProjectBlockersPath,
  parseApiV1ProjectBlockersQuery,
  parseApiV1UpdateBlockerBody,
} from "../routes/blockers.ts";
import {
  readApiV1Blocker,
  readApiV1ProjectBlockers,
} from "../../_shared/btpm-api/supabaseBlockerRead.ts";
import {
  createDelegatedApiV1BlockerReader,
  createDelegatedApiV1ProjectBlockersReader,
} from "../../_shared/btpm-api/supabaseDelegatedBlockerRead.ts";
import { API_V1_ROUTE_ALLOWLIST } from "../router.ts";

const PROJECT_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const BLOCKER_ID = "8f14e45f-ceea-467a-a4a7-2b4b0c7f4d21";
const TARGET_ID = "3b1e2c44-7a1f-4a02-9d5f-1c2b3a4d5e6f";
const USER_ID = "a1d2f3e4-5b6c-4d7e-8f90-112233445566";
const NIL = "00000000-0000-0000-0000-000000000000";
const TS = "2026-08-11T14:56:32.123456+00:00";
const OAUTH_CLIENT_ID = "btpm_client_cp2c2";

const CONTEXT = { client: { oauthClientId: OAUTH_CLIENT_ID } } as never;

function expectThrowsCode(fn: () => unknown, code: string): void {
  const err = assertThrows(fn, ApiHttpError) as ApiHttpError;
  assertEquals(err.code, code);
}

async function expectRejectsCode(
  fn: () => Promise<unknown>,
  code: string,
): Promise<void> {
  const err = await assertRejects(fn, ApiHttpError) as ApiHttpError;
  assertEquals(err.code, code);
}

function blockerRow(overrides: Record<string, unknown> = {}) {
  return {
    blockerId: BLOCKER_ID,
    projectId: PROJECT_ID,
    targetType: "phase",
    targetId: TARGET_ID,
    title: "Cutover environment unavailable",
    description: null,
    severity: "critical",
    status: "open",
    resolvedAt: null,
    updatedAt: TS,
    resolvedBy: null,
    ...overrides,
  };
}

interface RpcCall {
  readonly name: string;
  readonly args: Record<string, unknown>;
}

function recordingClient(result: unknown, calls: RpcCall[]) {
  return {
    rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return Promise.resolve(result);
    },
  };
}

// -----------------------------------------------------------------------------
// 1 — Route contracts
// -----------------------------------------------------------------------------

Deno.test("CP.2C2: the two Blocker GET route contracts are exact and frozen", () => {
  assertEquals(BLOCKER_PROJECT_COLLECTION_ROUTE.id, "blockers.get");
  assertEquals(BLOCKER_PROJECT_COLLECTION_ROUTE.method, "GET");
  assertEquals(
    BLOCKER_PROJECT_COLLECTION_ROUTE.path,
    "/v1/projects/:projectid/blockers",
  );
  assertEquals(BLOCKER_PROJECT_COLLECTION_ROUTE.operation, "read");
  assertEquals(Object.keys(BLOCKER_PROJECT_COLLECTION_ROUTE).length, 4);
  assert(Object.isFrozen(BLOCKER_PROJECT_COLLECTION_ROUTE));

  assertEquals(BLOCKER_DETAIL_ROUTE.id, "blockers.get_by_id");
  assertEquals(BLOCKER_DETAIL_ROUTE.method, "GET");
  assertEquals(BLOCKER_DETAIL_ROUTE.path, "/v1/blockers/:blockerid");
  assertEquals(BLOCKER_DETAIL_ROUTE.operation, "read");
  assertEquals(Object.keys(BLOCKER_DETAIL_ROUTE).length, 4);
  assert(Object.isFrozen(BLOCKER_DETAIL_ROUTE));
});

// API-M.CP.2C3 — the two Blocker GET reads are now registered exactly once
// each; the pre-activation negative expectation is superseded.
Deno.test("CP.2C2/CP.2C3: Blocker GET routes are registered exactly once", () => {
  const ids = API_V1_ROUTE_ALLOWLIST.map((r: { id: string }) => r.id);
  assertEquals(ids.filter((id: string) => id === "blockers.get").length, 1);
  assertEquals(
    ids.filter((id: string) => id === "blockers.get_by_id").length,
    1,
  );
  // Existing Blocker mutations remain registered and live.
  assert(ids.includes("blockers.create"));
  assert(ids.includes("blockers.update"));
});

// -----------------------------------------------------------------------------
// 2 — Path parsers
// -----------------------------------------------------------------------------

Deno.test("CP.2C2: collection path parser accepts only the exact shape", () => {
  assertEquals(
    parseApiV1ProjectBlockersPath(`/v1/projects/${PROJECT_ID}/blockers`)
      .projectId,
    PROJECT_ID,
  );

  for (
    const bad of [
      `/v1/projects/${PROJECT_ID}/blockers/`,
      `/v1/projects/${PROJECT_ID}/blockers/extra`,
      `/v1/projects/${NIL}/blockers`,
      "/v1/projects//blockers",
      `/v1/projects/${PROJECT_ID}/risks`,
      `/v1/projects/${PROJECT_ID}`,
      `/v1/projects/${PROJECT_ID};v=1/blockers`,
      `/v1/projects/%2e%2e/blockers`,
      `/v1/projects/ ${PROJECT_ID}/blockers`,
      `/v1/projects/${PROJECT_ID}/sub/blockers`,
    ]
  ) {
    expectThrowsCode(() => parseApiV1ProjectBlockersPath(bad), "invalid_request");
  }
});

Deno.test("CP.2C2: detail path parser accepts only a non-nil UUID", () => {
  assertEquals(
    parseApiV1BlockerDetailPath(`/v1/blockers/${BLOCKER_ID}`).blockerId,
    BLOCKER_ID,
  );

  for (
    const bad of [
      `/v1/blockers/${BLOCKER_ID}/`,
      `/v1/blockers/${BLOCKER_ID}/notes`,
      `/v1/blockers/${NIL}`,
      "/v1/blockers/",
      "/v1/blockers",
      `/v1/blockers/${BLOCKER_ID};a=1`,
      `/v1/blockers/%20${BLOCKER_ID}`,
      "/v1/blockers/not-a-uuid",
    ]
  ) {
    expectThrowsCode(() => parseApiV1BlockerDetailPath(bad), "invalid_request");
  }
});

// -----------------------------------------------------------------------------
// 3 — Collection query + cursor
// -----------------------------------------------------------------------------

Deno.test("CP.2C2: limit defaults to 100 and is bounded to 1..500", () => {
  assertEquals(parseApiV1ProjectBlockersQuery("").limit, 100);
  assertEquals(API_V1_BLOCKER_LIMIT_DEFAULT, 100);
  assertEquals(API_V1_BLOCKER_LIMIT_MAX, 500);
  assertEquals(parseApiV1ProjectBlockersQuery("").cursor, null);
  assertEquals(parseApiV1ProjectBlockersQuery("?").limit, 100);
  assertEquals(parseApiV1ProjectBlockersQuery("?limit=1").limit, 1);
  assertEquals(parseApiV1ProjectBlockersQuery("?limit=500").limit, 500);

  for (
    const bad of [
      "?limit=0",
      "?limit=501",
      "?limit=-1",
      "?limit=1.5",
      "?limit=abc",
      "?limit=",
      "?limit=10&limit=20",
      "?page=2",
      "?offset=10",
      "?limit=10#frag",
    ]
  ) {
    expectThrowsCode(
      () => parseApiV1ProjectBlockersQuery(bad),
      "invalid_request",
    );
  }
});

Deno.test("CP.2C2: opaque cursor round-trips and rejects malformed input", () => {
  const encoded = encodeApiV1BlockerCursor({ createdAt: TS, id: BLOCKER_ID });
  assert(/^[A-Za-z0-9_-]+$/.test(encoded), "cursor must be unpadded base64url");

  const decoded = decodeApiV1BlockerCursor(encoded);
  assertEquals(decoded.createdAt, TS);
  assertEquals(decoded.id, BLOCKER_ID);

  const payload = JSON.parse(
    atob(encoded.replace(/-/g, "+").replace(/_/g, "/")),
  );
  assertEquals(Object.keys(payload).sort(), ["createdAt", "id", "v"]);
  assertEquals(payload.v, 1);

  // Query parsing threads the cursor through unchanged.
  const q = parseApiV1ProjectBlockersQuery(`?limit=5&cursor=${encoded}`);
  assertEquals(q.limit, 5);
  assertEquals(q.cursor, { createdAt: TS, id: BLOCKER_ID });

  for (const bad of ["!!!", "e30", "", "a".repeat(600), btoa("{}")]) {
    expectThrowsCode(() => decodeApiV1BlockerCursor(bad), "invalid_request");
  }
  expectThrowsCode(
    () => parseApiV1ProjectBlockersQuery("?cursor=%%%"),
    "invalid_request",
  );
});

// -----------------------------------------------------------------------------
// 4 — RPC adapters
// -----------------------------------------------------------------------------

Deno.test("CP.2C2: collection adapter calls the exact wrapper with exact args", async () => {
  const calls: RpcCall[] = [];
  const client = recordingClient({
    data: {
      items: [blockerRow()],
      nextCursorCreatedAt: null,
      nextCursorId: null,
    },
    error: null,
  }, calls);

  const payload = await readApiV1ProjectBlockers(
    client,
    OAUTH_CLIENT_ID,
    PROJECT_ID,
    25,
    { createdAt: TS, id: BLOCKER_ID },
  );

  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, "api_v1_list_project_blockers");
  assertEquals(calls[0].args, {
    _expected_oauth_client_id: OAUTH_CLIENT_ID,
    _project_id: PROJECT_ID,
    _limit: 25,
    _after_created_at: TS,
    _after_id: BLOCKER_ID,
  });

  assertEquals(payload.nextCursor, null);
  assertEquals(Object.keys(payload).sort(), ["items", "nextCursor"]);
  assertEquals(Object.keys(payload.items[0]).sort(), [
    "blockerId",
    "description",
    "projectId",
    "resolvedAt",
    "resolvedBy",
    "severity",
    "status",
    "targetId",
    "targetType",
    "title",
    "updatedAt",
  ]);
});

Deno.test("CP.2C2: internal keyset pair becomes an external opaque nextCursor", async () => {
  const calls: RpcCall[] = [];
  const payload = await readApiV1ProjectBlockers(
    recordingClient({
      data: {
        items: [blockerRow()],
        nextCursorCreatedAt: TS,
        nextCursorId: BLOCKER_ID,
      },
      error: null,
    }, calls),
    OAUTH_CLIENT_ID,
    PROJECT_ID,
    100,
    null,
  );

  assertEquals(calls[0].args._after_created_at, null);
  assertEquals(calls[0].args._after_id, null);
  assert(typeof payload.nextCursor === "string");
  assertEquals(decodeApiV1BlockerCursor(payload.nextCursor as string), {
    createdAt: TS,
    id: BLOCKER_ID,
  });
  // The internal SQL cursor pair is never exposed.
  assert(!("nextCursorCreatedAt" in payload));
  assert(!("nextCursorId" in payload));

  // A partial server pair is a server defect.
  await expectRejectsCode(
    () =>
      readApiV1ProjectBlockers(
        recordingClient({
          data: {
            items: [],
            nextCursorCreatedAt: TS,
            nextCursorId: null,
          },
          error: null,
        }, []),
        OAUTH_CLIENT_ID,
        PROJECT_ID,
        100,
        null,
      ),
    "internal_error",
  );
});

Deno.test("CP.2C2: detail adapter calls the exact wrapper with exact args", async () => {
  const calls: RpcCall[] = [];
  const item = await readApiV1Blocker(
    recordingClient({ data: blockerRow(), error: null }, calls),
    OAUTH_CLIENT_ID,
    BLOCKER_ID,
  );

  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, "api_v1_get_blocker");
  assertEquals(calls[0].args, {
    _expected_oauth_client_id: OAUTH_CLIENT_ID,
    _blocker_id: BLOCKER_ID,
  });
  assertEquals(item.blockerId, BLOCKER_ID);
  assertEquals(Object.keys(item).length, 11);
});

Deno.test("CP.2C2: the 11-field Blocker shape is validated strictly", async () => {
  const missing = blockerRow();
  delete (missing as Record<string, unknown>).status;

  const cases: unknown[] = [
    missing,
    blockerRow({ extra: "nope" }),
    blockerRow({ title: null }),
    blockerRow({ severity: "blocker" }),
    blockerRow({ status: "closed" }),
    blockerRow({ targetType: "program" }),
    blockerRow({ updatedAt: null }),
    blockerRow({ blockerId: NIL }),
  ];

  for (const data of cases) {
    await expectRejectsCode(
      () =>
        readApiV1Blocker(
          recordingClient({ data, error: null }, []),
          OAUTH_CLIENT_ID,
          BLOCKER_ID,
        ),
      "internal_error",
    );
  }
});

Deno.test("CP.2C2: resolvedBy is exposed as the stored UUID or null only", async () => {
  const resolved = await readApiV1Blocker(
    recordingClient({
      data: blockerRow({
        status: "resolved",
        resolvedAt: TS,
        resolvedBy: USER_ID,
      }),
      error: null,
    }, []),
    OAUTH_CLIENT_ID,
    BLOCKER_ID,
  );
  assertEquals(resolved.resolvedBy, USER_ID);
  assertEquals(resolved.resolvedAt, TS);

  const open = await readApiV1Blocker(
    recordingClient({ data: blockerRow(), error: null }, []),
    OAUTH_CLIENT_ID,
    BLOCKER_ID,
  );
  assertEquals(open.resolvedBy, null);
  assertEquals(open.resolvedAt, null);

  // No identity attribute may substitute the canonical UUID.
  await expectRejectsCode(
    () =>
      readApiV1Blocker(
        recordingClient({
          data: blockerRow({ resolvedBy: "ops@example.com" }),
          error: null,
        }, []),
        OAUTH_CLIENT_ID,
        BLOCKER_ID,
      ),
    "internal_error",
  );
});

Deno.test("CP.2C2: SQLSTATE mapping is exact and never yields not_found", async () => {
  const map: ReadonlyArray<readonly [string, string]> = [
    ["42501", "not_authorized"],
    ["22023", "invalid_request"],
    ["P0001", "internal_error"],
    ["23505", "internal_error"],
  ];

  for (const [code, expected] of map) {
    await expectRejectsCode(
      () =>
        readApiV1Blocker(
          recordingClient({ data: null, error: { code } }, []),
          OAUTH_CLIENT_ID,
          BLOCKER_ID,
        ),
      expected,
    );
    await expectRejectsCode(
      () =>
        readApiV1ProjectBlockers(
          recordingClient({ data: null, error: { code } }, []),
          OAUTH_CLIENT_ID,
          PROJECT_ID,
          100,
          null,
        ),
      expected,
    );
  }
});

// -----------------------------------------------------------------------------
// 5 — Caller-bound delegated readers
// -----------------------------------------------------------------------------

Deno.test("CP.2C2: delegated readers build fresh bearer-bound anon clients", async () => {
  const ANON = "anon-key-cp2c2";
  const URL_ = "https://example.supabase.co";
  const constructions: Array<Record<string, unknown>> = [];
  const calls: RpcCall[] = [];

  const factory = (
    url: string,
    key: string,
    options: Record<string, unknown>,
  ) => {
    constructions.push({ url, key, options });
    return recordingClient({
      data: {
        items: [blockerRow()],
        nextCursorCreatedAt: null,
        nextCursorId: null,
      },
      error: null,
    }, calls);
  };

  const readProjectBlockers = createDelegatedApiV1ProjectBlockersReader(
    URL_,
    ANON,
    factory as never,
  );

  const request = new Request("https://edge.local/v1/projects/x/blockers", {
    headers: { Authorization: "Bearer caller-token-123" },
  });

  await readProjectBlockers(request, CONTEXT, PROJECT_ID, 10, null);
  await readProjectBlockers(request, CONTEXT, PROJECT_ID, 10, null);

  // A fresh client per invocation, anon key only, caller token bound.
  assertEquals(constructions.length, 2);
  for (const c of constructions) {
    assertEquals(c.url, URL_);
    assertEquals(c.key, ANON);
    const options = c.options as {
      auth: Record<string, boolean>;
      global: { headers: Record<string, string> };
    };
    assertEquals(options.auth, {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    });
    assertEquals(
      options.global.headers.Authorization,
      "Bearer caller-token-123",
    );
  }
  assertEquals(calls.map((c) => c.name), [
    "api_v1_list_project_blockers",
    "api_v1_list_project_blockers",
  ]);
  assertEquals(calls[0].args._expected_oauth_client_id, OAUTH_CLIENT_ID);

  const detailCalls: RpcCall[] = [];
  const readBlocker = createDelegatedApiV1BlockerReader(
    URL_,
    ANON,
    ((_u: string, _k: string, _o: unknown) =>
      recordingClient({ data: blockerRow(), error: null }, detailCalls)) as never,
  );
  const item = await readBlocker(request, CONTEXT, BLOCKER_ID);
  assertEquals(detailCalls[0].name, "api_v1_get_blocker");
  assertEquals(detailCalls[0].args._blocker_id, BLOCKER_ID);
  assertEquals(item.blockerId, BLOCKER_ID);
});

// -----------------------------------------------------------------------------
// 6 — Blocker mutation regression
// -----------------------------------------------------------------------------

Deno.test("CP.2C2: existing Blocker mutation contracts remain unchanged", () => {
  assertEquals(BLOCKER_CREATE_ROUTE.id, "blockers.create");
  assertEquals(BLOCKER_CREATE_ROUTE.method, "POST");
  assertEquals(BLOCKER_CREATE_ROUTE.path, "/v1/blockers");
  assertEquals(BLOCKER_UPDATE_ROUTE.id, "blockers.update");
  assertEquals(BLOCKER_UPDATE_ROUTE.method, "PATCH");
  assertEquals(BLOCKER_UPDATE_ROUTE.path, "/v1/blockers/:blockerid");

  assertEquals(
    parseApiV1BlockerUpdatePath(`/v1/blockers/${BLOCKER_ID}`).blockerId,
    BLOCKER_ID,
  );

  const created = parseApiV1CreateBlockerBody({
    targetType: "project",
    targetId: PROJECT_ID,
    title: "Access pending",
  });
  assertEquals(created.severity, "medium");
  assertEquals(created.status, "open");
  assertEquals(created.description, null);

  const updated = parseApiV1UpdateBlockerBody({
    expectedUpdatedAt: TS,
    title: "Access pending",
    description: null,
    severity: "high",
    status: "in_progress",
  });
  assertEquals(updated.status, "in_progress");
  expectThrowsCode(
    () =>
      parseApiV1UpdateBlockerBody({
        expectedUpdatedAt: TS,
        title: "x",
        description: null,
        severity: "high",
      }),
    "invalid_request",
  );
});
