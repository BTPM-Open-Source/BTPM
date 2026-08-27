// API-M.CP.2B1 — Focused regression tests for the non-live Risk HTTP read
// foundation:
//   GET /v1/projects/{projectId}/risks
//   GET /v1/risks/{riskId}

import {
  assert,
  assertEquals,
  assertRejects,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { ApiHttpError } from "../../_shared/btpm-api/http.ts";
import {
  API_V1_RISK_LIMIT_DEFAULT,
  API_V1_RISK_LIMIT_MAX,
  RISK_CREATE_ROUTE,
  RISK_DETAIL_ROUTE,
  RISK_PROJECT_COLLECTION_ROUTE,
  RISK_UPDATE_ROUTE,
  decodeApiV1RiskCursor,
  encodeApiV1RiskCursor,
  parseApiV1CreateRiskBody,
  parseApiV1ProjectRisksPath,
  parseApiV1ProjectRisksQuery,
  parseApiV1RiskDetailPath,
  parseApiV1RiskUpdatePath,
} from "../routes/risks.ts";
import {
  readApiV1ProjectRisks,
  readApiV1Risk,
} from "../../_shared/btpm-api/supabaseRiskRead.ts";
import {
  createDelegatedApiV1ProjectRisksReader,
  createDelegatedApiV1RiskReader,
} from "../../_shared/btpm-api/supabaseDelegatedRiskRead.ts";
import { API_V1_ROUTE_ALLOWLIST } from "../router.ts";

const PROJECT_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const RISK_ID = "8f14e45f-ceea-467a-a4a7-2b4b0c7f4d21";
const TARGET_ID = "3b1e2c44-7a1f-4a02-9d5f-1c2b3a4d5e6f";
const NIL = "00000000-0000-0000-0000-000000000000";
const TS = "2026-08-08T14:56:32.123456+00:00";
const OAUTH_CLIENT_ID = "btpm_client_cp2b1";

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

function riskRow(overrides: Record<string, unknown> = {}) {
  return {
    riskId: RISK_ID,
    projectId: PROJECT_ID,
    targetType: "project",
    targetId: TARGET_ID,
    title: "Integration slippage",
    description: null,
    mitigationPlan: null,
    likelihood: "high",
    impact: "critical",
    status: "open",
    updatedAt: TS,
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

Deno.test("CP.2B1: the two Risk GET route contracts are exact and frozen", () => {
  assertEquals(RISK_PROJECT_COLLECTION_ROUTE.id, "risks.get");
  assertEquals(RISK_PROJECT_COLLECTION_ROUTE.method, "GET");
  assertEquals(
    RISK_PROJECT_COLLECTION_ROUTE.path,
    "/v1/projects/:projectid/risks",
  );
  assertEquals(RISK_PROJECT_COLLECTION_ROUTE.operation, "read");
  assertEquals(Object.keys(RISK_PROJECT_COLLECTION_ROUTE).length, 4);
  assert(Object.isFrozen(RISK_PROJECT_COLLECTION_ROUTE));

  assertEquals(RISK_DETAIL_ROUTE.id, "risks.get_by_id");
  assertEquals(RISK_DETAIL_ROUTE.method, "GET");
  assertEquals(RISK_DETAIL_ROUTE.path, "/v1/risks/:riskid");
  assertEquals(RISK_DETAIL_ROUTE.operation, "read");
  assertEquals(Object.keys(RISK_DETAIL_ROUTE).length, 4);
  assert(Object.isFrozen(RISK_DETAIL_ROUTE));
});

// API-M.CP.2B2 — the two Risk GET reads are now live; the pre-activation
// negative expectation is superseded and each is registered exactly once.
Deno.test("CP.2B1/CP.2B2: Risk GET routes are registered exactly once", () => {
  const ids = API_V1_ROUTE_ALLOWLIST.map((r: { id: string }) => r.id);
  assertEquals(ids.filter((id: string) => id === "risks.get").length, 1);
  assertEquals(ids.filter((id: string) => id === "risks.get_by_id").length, 1);
  // Existing Risk mutations remain registered.
  assert(ids.includes("risks.create"));
  assert(ids.includes("risks.update"));
});

// -----------------------------------------------------------------------------
// 2 — Path parsers
// -----------------------------------------------------------------------------

Deno.test("CP.2B1: collection path parser accepts and rejects strictly", () => {
  assertEquals(
    parseApiV1ProjectRisksPath(`/v1/projects/${PROJECT_ID}/risks`).projectId,
    PROJECT_ID,
  );

  for (
    const bad of [
      `/v1/projects/${PROJECT_ID}/risks/`,
      `/v1/projects/${PROJECT_ID}/risks/extra`,
      `/v1/projects/${NIL}/risks`,
      "/v1/projects//risks",
      "/v1/projects/not-a-uuid/risks",
      `/v1/projects/${PROJECT_ID} /risks`,
      `/v1/projects/${PROJECT_ID};v=1/risks`,
      `/v1/projects/%2e%2e/risks`,
      `/v1/projects/${PROJECT_ID}/blockers`,
      `/v1/risks/${RISK_ID}`,
    ]
  ) {
    expectThrowsCode(() => parseApiV1ProjectRisksPath(bad), "invalid_request");
  }
});

Deno.test("CP.2B1: detail path parser accepts and rejects strictly", () => {
  assertEquals(parseApiV1RiskDetailPath(`/v1/risks/${RISK_ID}`).riskId, RISK_ID);

  for (
    const bad of [
      `/v1/risks/${RISK_ID}/`,
      `/v1/risks/${RISK_ID}/history`,
      `/v1/risks/${NIL}`,
      "/v1/risks/",
      "/v1/risks/abc",
      `/v1/risks/${RISK_ID}%2f`,
      `/v1/risks/${RISK_ID};a=b`,
    ]
  ) {
    expectThrowsCode(() => parseApiV1RiskDetailPath(bad), "invalid_request");
  }
});

// -----------------------------------------------------------------------------
// 3 — Collection query
// -----------------------------------------------------------------------------

Deno.test("CP.2B1: collection query limit defaults and bounds", () => {
  assertEquals(parseApiV1ProjectRisksQuery(""), {
    limit: API_V1_RISK_LIMIT_DEFAULT,
    cursor: null,
  });
  assertEquals(parseApiV1ProjectRisksQuery("?").limit, 100);
  assertEquals(parseApiV1ProjectRisksQuery("?limit=1").limit, 1);
  assertEquals(
    parseApiV1ProjectRisksQuery("?limit=500").limit,
    API_V1_RISK_LIMIT_MAX,
  );

  for (
    const bad of [
      "?limit=0",
      "?limit=501",
      "?limit=-1",
      "?limit=abc",
      "?limit=",
      "?limit=10&limit=20",
      "?offset=10",
      "?cursor=!!!",
    ]
  ) {
    expectThrowsCode(() => parseApiV1ProjectRisksQuery(bad), "invalid_request");
  }
});

// -----------------------------------------------------------------------------
// 4 — Opaque cursor
// -----------------------------------------------------------------------------

Deno.test("CP.2B1: cursor round-trips and stays opaque and narrow", () => {
  const encoded = encodeApiV1RiskCursor({ createdAt: TS, id: RISK_ID });
  assert(/^[A-Za-z0-9_-]+$/.test(encoded));
  assert(!encoded.includes("="));

  const decoded = decodeApiV1RiskCursor(encoded);
  assertEquals(decoded.createdAt, TS);
  assertEquals(decoded.id, RISK_ID);
  assertEquals(Object.keys(decoded).sort(), ["createdAt", "id"]);

  const payload = JSON.parse(atob(encoded.replace(/-/g, "+").replace(/_/g, "/")));
  assertEquals(Object.keys(payload).sort(), ["createdAt", "id", "v"]);
  assertEquals(payload.v, 1);

  // Malformed / rejected cursors.
  const badPayloads = [
    btoa(JSON.stringify({ v: 2, createdAt: TS, id: RISK_ID })),
    btoa(JSON.stringify({ v: 1, createdAt: "nope", id: RISK_ID })),
    btoa(JSON.stringify({ v: 1, createdAt: TS, id: NIL })),
    btoa(JSON.stringify({ v: 1, createdAt: TS, id: RISK_ID, tenantId: NIL })),
  ].map((s) => s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""));

  for (const bad of [...badPayloads, "", "***", "bm90LWpzb24"]) {
    expectThrowsCode(() => decodeApiV1RiskCursor(bad), "invalid_request");
  }

  // Query parser accepts a valid cursor and maps it to keyset inputs.
  const q = parseApiV1ProjectRisksQuery(`?cursor=${encoded}`);
  assertEquals(q.cursor?.createdAt, TS);
  assertEquals(q.cursor?.id, RISK_ID);
});

// -----------------------------------------------------------------------------
// 5 — Collection adapter
// -----------------------------------------------------------------------------

Deno.test("CP.2B1: collection adapter calls the exact RPC with exact args", async () => {
  const calls: RpcCall[] = [];
  const client = recordingClient({
    data: { items: [riskRow()], nextCursorCreatedAt: null, nextCursorId: null },
    error: null,
  }, calls);

  const cursor = { createdAt: TS, id: TARGET_ID };
  const payload = await readApiV1ProjectRisks(
    client,
    OAUTH_CLIENT_ID,
    PROJECT_ID,
    250,
    cursor,
  );

  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, "api_v1_list_project_risks");
  assertEquals(calls[0].args, {
    _expected_oauth_client_id: OAUTH_CLIENT_ID,
    _project_id: PROJECT_ID,
    _limit: 250,
    _after_created_at: TS,
    _after_id: TARGET_ID,
  });

  assertEquals(Object.keys(payload).sort(), ["items", "nextCursor"]);
  assertEquals(payload.nextCursor, null);
  assertEquals(Object.keys(payload.items[0]).sort(), [
    "description",
    "impact",
    "likelihood",
    "mitigationPlan",
    "projectId",
    "riskId",
    "status",
    "targetId",
    "targetType",
    "title",
    "updatedAt",
  ]);
});

Deno.test("CP.2B1: collection converts internal keyset pair to external nextCursor", async () => {
  const calls: RpcCall[] = [];
  const payload = await readApiV1ProjectRisks(
    recordingClient({
      data: {
        items: [],
        nextCursorCreatedAt: TS,
        nextCursorId: RISK_ID,
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
  assertEquals(decodeApiV1RiskCursor(payload.nextCursor as string), {
    createdAt: TS,
    id: RISK_ID,
  });

  // A partial server pair is a server defect.
  await expectRejectsCode(() =>
      readApiV1ProjectRisks(
        recordingClient({
          data: { items: [], nextCursorCreatedAt: TS, nextCursorId: null },
          error: null,
        }, []),
        OAUTH_CLIENT_ID,
        PROJECT_ID,
        100,
        null,
      ), "internal_error");
});

Deno.test("CP.2B1: collection rejects unexpected internal item fields", async () => {
  await expectRejectsCode(() =>
      readApiV1ProjectRisks(
        recordingClient({
          data: {
            items: [riskRow({ organizationId: NIL })],
            nextCursorCreatedAt: null,
            nextCursorId: null,
          },
          error: null,
        }, []),
        OAUTH_CLIENT_ID,
        PROJECT_ID,
        100,
        null,
      ), "internal_error");
});

// -----------------------------------------------------------------------------
// 6 — Detail adapter
// -----------------------------------------------------------------------------

Deno.test("CP.2B1: detail adapter calls the exact RPC with exact args", async () => {
  const calls: RpcCall[] = [];
  const item = await readApiV1Risk(
    recordingClient({ data: riskRow(), error: null }, calls),
    OAUTH_CLIENT_ID,
    RISK_ID,
  );

  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, "api_v1_get_risk");
  assertEquals(calls[0].args, {
    _expected_oauth_client_id: OAUTH_CLIENT_ID,
    _risk_id: RISK_ID,
  });
  assertEquals(Object.keys(item).length, 11);
  assertEquals(item.riskId, RISK_ID);
});

// -----------------------------------------------------------------------------
// 7 — Error mapping
// -----------------------------------------------------------------------------

Deno.test("CP.2B1: wrapper SQLSTATE mapping is exact for both readers", async () => {
  const cases: ReadonlyArray<[string, string]> = [
    ["42501", "not_authorized"],
    ["22023", "invalid_request"],
    ["P0001", "internal_error"],
  ];

  for (const [code, expected] of cases) {
    await expectRejectsCode(
      () =>
        readApiV1ProjectRisks(
          recordingClient({ data: null, error: { code } }, []),
          OAUTH_CLIENT_ID,
          PROJECT_ID,
          100,
          null,
        ),
      expected,
    );
    await expectRejectsCode(
      () =>
        readApiV1Risk(
          recordingClient({ data: null, error: { code } }, []),
          OAUTH_CLIENT_ID,
          RISK_ID,
        ),
      expected,
    );
  }
});


// -----------------------------------------------------------------------------
// 8 — Delegated readers
// -----------------------------------------------------------------------------

Deno.test("CP.2B1: delegated readers bind the bearer token to a fresh anon client", async () => {
  const constructions: Array<
    { url: string; key: string; auth: string }
  > = [];
  const calls: RpcCall[] = [];

  const factory = (url: string, key: string, options: never) => {
    const opts = options as unknown as {
      global: { headers: { Authorization: string } };
    };
    constructions.push({
      url,
      key,
      auth: opts.global.headers.Authorization,
    });
    return recordingClient({
      data: { items: [], nextCursorCreatedAt: null, nextCursorId: null },
      error: null,
    }, calls);
  };

  const readCollection = createDelegatedApiV1ProjectRisksReader(
    "https://example.supabase.co",
    "anon-key",
    factory as never,
  );

  const request = new Request("https://api.example/v1", {
    headers: { Authorization: "Bearer token-abc" },
  });

  await readCollection(request, CONTEXT, PROJECT_ID, 100, null);
  await readCollection(request, CONTEXT, PROJECT_ID, 100, null);

  // Fresh caller-scoped client per invocation, anon key, bearer-bound.
  assertEquals(constructions.length, 2);
  for (const c of constructions) {
    assertEquals(c.key, "anon-key");
    assertEquals(c.auth, "Bearer token-abc");
  }
  assertEquals(calls[0].args._expected_oauth_client_id, OAUTH_CLIENT_ID);

  const detailCalls: RpcCall[] = [];
  const readDetail = createDelegatedApiV1RiskReader(
    "https://example.supabase.co",
    "anon-key",
    (() =>
      recordingClient({ data: riskRow(), error: null }, detailCalls)) as never,
  );
  const item = await readDetail(request, CONTEXT, RISK_ID);
  assertEquals(item.riskId, RISK_ID);
  assertEquals(detailCalls[0].name, "api_v1_get_risk");

  // Missing bearer credentials fail before any client is constructed.
  await assertRejects(() =>
    readDetail(new Request("https://api.example/v1"), CONTEXT, RISK_ID)
  );
});

// -----------------------------------------------------------------------------
// 9 — Risk mutation surface unchanged
// -----------------------------------------------------------------------------

Deno.test("CP.2B1: Risk mutation route contracts and parsers are unchanged", () => {
  assertEquals(RISK_CREATE_ROUTE.id, "risks.create");
  assertEquals(RISK_CREATE_ROUTE.path, "/v1/risks");
  assertEquals(RISK_UPDATE_ROUTE.id, "risks.update");
  assertEquals(RISK_UPDATE_ROUTE.path, "/v1/risks/:riskid");

  assertEquals(
    parseApiV1RiskUpdatePath(`/v1/risks/${RISK_ID}`).riskId,
    RISK_ID,
  );
  const body = parseApiV1CreateRiskBody({
    targetType: "project",
    targetId: TARGET_ID,
    title: "Integration slippage",
  });
  assertEquals(body.likelihood, "medium");
  assertEquals(body.impact, "medium");
  assertEquals(body.status, "open");
});
