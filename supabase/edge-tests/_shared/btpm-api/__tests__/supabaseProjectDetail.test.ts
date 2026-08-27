// Relocated out of supabase/functions/ (Edge deploy bundle size).
// Source-file reads stay anchored to the original module location.
const __BTPM_SELF_URL__ = import.meta.url;
const __BTPM_SRC_BASE__ = new URL('../../../../functions/_shared/btpm-api/__tests__/supabaseProjectDetail.test.ts', import.meta.url).href;
// API-H.4C — Focused tests for the strict Project-detail RPC adapter.

import {
  assert,
  assertEquals,
  assertNotStrictEquals,
  assertRejects,
  assertStrictEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { ApiHttpError } from "../../../../functions/_shared/btpm-api/http.ts";
import {
  readApiV1ProjectDetail,
  type ApiV1ProjectDetailRpcClient,
} from "../../../../functions/_shared/btpm-api/supabaseProjectDetail.ts";

const CLIENT_ID = "btpm-test-client";
const PROJECT_ID = "8f14e45f-ceea-467a-a4a7-2b4b0c7f4d21";
const ORG_ID = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
const WS_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const PROGRAM_ID = "6ba7b810-9dad-41d1-80b4-00c04fd430c8";
const PORTFOLIO_ID = "6ba7b811-9dad-41d1-80b4-00c04fd430c8";
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

function fullPayload(overrides: Record<string, unknown> = {}) {
  return {
    projectId: PROJECT_ID,
    organizationId: ORG_ID,
    workspaceId: WS_ID,
    programId: PROGRAM_ID,
    portfolioItemId: PORTFOLIO_ID,
    name: "Synthetic Project",
    description: "Synthetic description",
    status: "active",
    priority: "high",
    projectStage: "execution",
    deliveryModel: "waterfall",
    startDate: "2026-02-01",
    targetEndDate: "2026-12-31",
    actualStartDate: "2026-02-03",
    actualEndDate: "2026-11-30",
    agileEnabled: true,
    updatedAt: "2026-08-06T07:00:00.000Z",
    charter: "Synthetic charter",
    goals: "Synthetic goals",
    scopeIn: "Synthetic scope in",
    scopeOut: "Synthetic scope out",
    businessCase: "Synthetic business case",
    successCriteria: "Synthetic success criteria",
    completionCriteria: "Synthetic completion criteria",
    budgetNarrative: "Synthetic budget narrative",
    assumptions: "Synthetic assumptions",
    constraints: "Synthetic constraints",
    ...overrides,
  };
}

interface Call {
  functionName: string;
  args: unknown;
}

function makeClient(
  result: unknown,
  calls: Call[] = [],
): ApiV1ProjectDetailRpcClient {
  return {
    rpc(functionName: string, args: never) {
      calls.push({ functionName, args });
      return Promise.resolve(result);
    },
  } as unknown as ApiV1ProjectDetailRpcClient;
}

function okClient(data: unknown, calls: Call[] = []) {
  return makeClient({ data, error: null }, calls);
}

async function expectCode(
  code: string,
  fn: () => Promise<unknown>,
): Promise<void> {
  const err = await assertRejects(fn, ApiHttpError);
  assertEquals(err.code, code);
}

Deno.test("calls exactly the accepted RPC with exact arguments once", async () => {
  const calls: Call[] = [];
  await readApiV1ProjectDetail(
    okClient(fullPayload(), calls),
    CLIENT_ID,
    PROJECT_ID,
  );
  assertEquals(calls.length, 1);
  assertEquals(calls[0].functionName, "api_v1_get_project");
  assertEquals(calls[0].args, {
    _expected_oauth_client_id: CLIENT_ID,
    _project_id: PROJECT_ID,
  });
});

Deno.test("returns the exact validated payload for a complete result", async () => {
  const payload = await readApiV1ProjectDetail(
    okClient(fullPayload()),
    CLIENT_ID,
    PROJECT_ID,
  );
  assertEquals(payload, fullPayload() as unknown as typeof payload);
});

Deno.test("payload is newly reconstructed, frozen and distinct per call", async () => {
  const raw = fullPayload();
  const client = okClient(raw);
  const first = await readApiV1ProjectDetail(client, CLIENT_ID, PROJECT_ID);
  const second = await readApiV1ProjectDetail(client, CLIENT_ID, PROJECT_ID);
  assert(Object.isFrozen(first));
  assertNotStrictEquals(first, raw as unknown as typeof first);
  assertNotStrictEquals(first, second);
  assertEquals(first, second);
});

Deno.test("accepts valid nullable fields", async () => {
  const payload = await readApiV1ProjectDetail(
    okClient(fullPayload({
      programId: null,
      portfolioItemId: null,
      description: null,
      projectStage: null,
      deliveryModel: null,
      startDate: null,
      targetEndDate: null,
      actualStartDate: null,
      actualEndDate: null,
      agileEnabled: false,
    })),
    CLIENT_ID,
    PROJECT_ID,
  );
  assertStrictEquals(payload.programId, null);
  assertStrictEquals(payload.portfolioItemId, null);
  assertStrictEquals(payload.description, null);
  assertStrictEquals(payload.projectStage, null);
  assertStrictEquals(payload.deliveryModel, null);
  assertStrictEquals(payload.startDate, null);
  assertStrictEquals(payload.targetEndDate, null);
  assertStrictEquals(payload.actualStartDate, null);
  assertStrictEquals(payload.actualEndDate, null);
  assertStrictEquals(payload.agileEnabled, false);
});

Deno.test("empty-string nullable narrative is preserved, not nulled", async () => {
  const payload = await readApiV1ProjectDetail(
    okClient(fullPayload({ description: "" })),
    CLIENT_ID,
    PROJECT_ID,
  );
  assertStrictEquals(payload.description, "");
});

Deno.test("malformed clients fail with internal_error before any RPC", async () => {
  for (const bad of [null, undefined, 0, "x", true, [], {}, { rpc: 1 }]) {
    await expectCode(
      "internal_error",
      () =>
        readApiV1ProjectDetail(
          bad as unknown as ApiV1ProjectDetailRpcClient,
          CLIENT_ID,
          PROJECT_ID,
        ),
    );
  }
});

Deno.test("malformed OAuth client IDs fail before the RPC", async () => {
  const calls: Call[] = [];
  const client = okClient(fullPayload(), calls);
  for (
    const bad of [
      "",
      "a".repeat(256),
      "has space",
      "bad#char",
      "quote'",
      null,
      undefined,
      1,
      {},
    ]
  ) {
    await expectCode(
      "internal_error",
      () =>
        readApiV1ProjectDetail(client, bad as unknown as string, PROJECT_ID),
    );
  }
  assertEquals(calls.length, 0);
});

Deno.test("invalid and nil project IDs fail with invalid_request before the RPC", async () => {
  const calls: Call[] = [];
  const client = okClient(fullPayload(), calls);
  for (
    const bad of [
      NIL_UUID,
      "",
      "not-a-uuid",
      ` ${PROJECT_ID} `,
      `${PROJECT_ID}\n`,
      null,
      undefined,
      1,
      {},
      [PROJECT_ID],
    ]
  ) {
    await expectCode(
      "invalid_request",
      () => readApiV1ProjectDetail(client, CLIENT_ID, bad as unknown as string),
    );
  }
  assertEquals(calls.length, 0);
});

Deno.test("project ID is preserved exactly, including uppercase", async () => {
  const upper = PROJECT_ID.toUpperCase();
  const calls: Call[] = [];
  const payload = await readApiV1ProjectDetail(
    okClient(fullPayload({ projectId: upper }), calls),
    CLIENT_ID,
    upper,
  );
  assertStrictEquals(payload.projectId, upper);
  assertEquals(
    (calls[0].args as { _project_id: string })._project_id,
    upper,
  );
});

Deno.test("project ID mismatch rejects with internal_error", async () => {
  await expectCode(
    "internal_error",
    () =>
      readApiV1ProjectDetail(
        okClient(fullPayload({ projectId: ORG_ID })),
        CLIENT_ID,
        PROJECT_ID,
      ),
  );
});

Deno.test("42501 maps to not_authorized", async () => {
  await expectCode(
    "not_authorized",
    () =>
      readApiV1ProjectDetail(
        makeClient({ data: null, error: { code: "42501", message: "denied" } }),
        CLIENT_ID,
        PROJECT_ID,
      ),
  );
});

Deno.test("22023 maps to invalid_request", async () => {
  await expectCode(
    "invalid_request",
    () =>
      readApiV1ProjectDetail(
        makeClient({ data: null, error: { code: "22023", message: "bad" } }),
        CLIENT_ID,
        PROJECT_ID,
      ),
  );
});

Deno.test("unknown RPC errors map to internal_error", async () => {
  for (
    const error of [
      { code: "23505", message: "x" },
      { code: "P0001" },
      "string error",
      42,
      {},
    ]
  ) {
    await expectCode(
      "internal_error",
      () =>
        readApiV1ProjectDetail(
          makeClient({ data: null, error }),
          CLIENT_ID,
          PROJECT_ID,
        ),
    );
  }
});

Deno.test("rejected RPC promise maps to internal_error", async () => {
  const client = {
    rpc() {
      return Promise.reject(new Error("network down"));
    },
  } as unknown as ApiV1ProjectDetailRpcClient;
  await expectCode(
    "internal_error",
    () => readApiV1ProjectDetail(client, CLIENT_ID, PROJECT_ID),
  );
});

Deno.test("malformed RPC envelopes map to internal_error", async () => {
  for (
    const result of [
      null,
      undefined,
      0,
      "x",
      true,
      [],
      [{ data: {}, error: null }],
      {},
      { data: fullPayload() },
      { error: null },
      { data: fullPayload(), error: undefined },
    ]
  ) {
    await expectCode(
      "internal_error",
      () =>
        readApiV1ProjectDetail(makeClient(result), CLIENT_ID, PROJECT_ID),
    );
  }
});

Deno.test("missing or additional payload keys map to internal_error", async () => {
  const missing = fullPayload();
  delete (missing as Record<string, unknown>).priority;
  const extra = fullPayload({ extraField: "x" });
  for (const data of [missing, extra, {}, null, [], "x", 1]) {
    await expectCode(
      "internal_error",
      () => readApiV1ProjectDetail(okClient(data), CLIENT_ID, PROJECT_ID),
    );
  }
});

Deno.test("invalid required UUIDs map to internal_error", async () => {
  for (const key of ["organizationId", "workspaceId"]) {
    for (const bad of [NIL_UUID, "nope", "", null, 1, {}]) {
      await expectCode(
        "internal_error",
        () =>
          readApiV1ProjectDetail(
            okClient(fullPayload({ [key]: bad })),
            CLIENT_ID,
            PROJECT_ID,
          ),
      );
    }
  }
});

Deno.test("invalid nullable UUIDs map to internal_error", async () => {
  for (const key of ["programId", "portfolioItemId"]) {
    for (const bad of [NIL_UUID, "nope", "", 1, {}, undefined]) {
      await expectCode(
        "internal_error",
        () =>
          readApiV1ProjectDetail(
            okClient(fullPayload({ [key]: bad })),
            CLIENT_ID,
            PROJECT_ID,
          ),
      );
    }
  }
});

Deno.test("invalid required text fields map to internal_error", async () => {
  for (const key of ["name", "status", "priority"]) {
    for (const bad of ["", null, 1, true, {}, []]) {
      await expectCode(
        "internal_error",
        () =>
          readApiV1ProjectDetail(
            okClient(fullPayload({ [key]: bad })),
            CLIENT_ID,
            PROJECT_ID,
          ),
      );
    }
  }
});

Deno.test("invalid nullable text fields map to internal_error", async () => {
  for (const key of ["projectStage", "deliveryModel"]) {
    for (const bad of ["", 1, true, {}]) {
      await expectCode(
        "internal_error",
        () =>
          readApiV1ProjectDetail(
            okClient(fullPayload({ [key]: bad })),
            CLIENT_ID,
            PROJECT_ID,
          ),
      );
    }
  }
  for (const bad of [1, true, {}, []]) {
    await expectCode(
      "internal_error",
      () =>
        readApiV1ProjectDetail(
          okClient(fullPayload({ description: bad })),
          CLIENT_ID,
          PROJECT_ID,
        ),
    );
  }
});

Deno.test("text values are preserved exactly, untrimmed", async () => {
  const payload = await readApiV1ProjectDetail(
    okClient(fullPayload({ name: "  Padded Name  " })),
    CLIENT_ID,
    PROJECT_ID,
  );
  assertStrictEquals(payload.name, "  Padded Name  ");
});

Deno.test("invalid date formats and impossible dates map to internal_error", async () => {
  const bads = [
    "2026-2-01",
    "01-02-2026",
    "2026-02-30",
    "2026-13-01",
    "2026-00-10",
    "2026-02-00",
    "2025-02-29",
    "2026-08-06T07:00:00Z",
    " 2026-08-06",
    "2026-08-06 ",
    "",
    20260806,
    true,
    {},
    undefined,
  ];
  for (
    const key of [
      "startDate",
      "targetEndDate",
      "actualStartDate",
      "actualEndDate",
    ]
  ) {
    for (const bad of bads) {
      await expectCode(
        "internal_error",
        () =>
          readApiV1ProjectDetail(
            okClient(fullPayload({ [key]: bad })),
            CLIENT_ID,
            PROJECT_ID,
          ),
      );
    }
  }
});

Deno.test("valid dates are preserved exactly and order is not enforced", async () => {
  const payload = await readApiV1ProjectDetail(
    okClient(fullPayload({
      startDate: "2026-12-31",
      targetEndDate: "2026-01-01",
      actualStartDate: "2024-02-29",
      actualEndDate: "2026-02-28",
    })),
    CLIENT_ID,
    PROJECT_ID,
  );
  assertStrictEquals(payload.startDate, "2026-12-31");
  assertStrictEquals(payload.targetEndDate, "2026-01-01");
  assertStrictEquals(payload.actualStartDate, "2024-02-29");
  assertStrictEquals(payload.actualEndDate, "2026-02-28");
});

Deno.test("invalid agileEnabled maps to internal_error", async () => {
  for (const bad of ["true", 1, 0, null, undefined, {}, []]) {
    await expectCode(
      "internal_error",
      () =>
        readApiV1ProjectDetail(
          okClient(fullPayload({ agileEnabled: bad })),
          CLIENT_ID,
          PROJECT_ID,
        ),
    );
  }
});

Deno.test("invalid or empty updatedAt maps to internal_error", async () => {
  for (const bad of ["", "   ", "not-a-timestamp", null, 0, 1, true, {}, []]) {
    await expectCode(
      "internal_error",
      () =>
        readApiV1ProjectDetail(
          okClient(fullPayload({ updatedAt: bad })),
          CLIENT_ID,
          PROJECT_ID,
        ),
    );
  }
});

Deno.test("updatedAt is preserved exactly without normalization", async () => {
  const raw = "2026-08-06T09:34:00+02:00";
  const payload = await readApiV1ProjectDetail(
    okClient(fullPayload({ updatedAt: raw })),
    CLIENT_ID,
    PROJECT_ID,
  );
  assertStrictEquals(payload.updatedAt, raw);
  assertStrictEquals(typeof payload.updatedAt, "string");
});

Deno.test("raw RPC data object is not mutated or frozen by the adapter", async () => {
  const raw = fullPayload();
  const snapshot = { ...raw };
  await readApiV1ProjectDetail(okClient(raw), CLIENT_ID, PROJECT_ID);
  assertEquals(raw, snapshot);
  assert(!Object.isFrozen(raw));
});

Deno.test("source contains no runtime, network, credential or transport behavior", async () => {
  const source = await Deno.readTextFile(
    new URL("../supabaseProjectDetail.ts", __BTPM_SRC_BASE__),
  );
  const forbidden = [
    "Deno.env",
    "createClient",
    "SERVICE_ROLE",
    "service_role",
    "SUPABASE_URL",
    "ANON_KEY",
    "fetch(",
    "Authorization",
    "extractBearerToken",
    "console.log",
    "console.warn",
    "console.error",
    "setTimeout",
    "setInterval",
    "new Map(",
    "URLPattern",
    "Deno.serve",
    "from(",
  ];
  for (const needle of forbidden) {
    assert(!source.includes(needle), `must not contain: ${needle}`);
  }
  assert(source.includes(`const API_V1_GET_PROJECT_FUNCTION_NAME = "api_v1_get_project"`));
  assertEquals(source.match(/client\.rpc\(/g)?.length, 1);
  assertEquals(
    source.match(/^import .*$/gm),
    [
      `import { ApiHttpError } from "./http.ts";`,
      `import { apiUuidSchema } from "./schemas.ts";`,
    ],
  );
});
