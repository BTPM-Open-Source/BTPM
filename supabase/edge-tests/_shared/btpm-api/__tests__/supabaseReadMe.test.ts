// Relocated out of supabase/functions/ (Edge deploy bundle size).
// Source-file reads stay anchored to the original module location.
const __BTPM_SRC_BASE__ = new URL('../../../../functions/_shared/btpm-api/__tests__/supabaseReadMe.test.ts', import.meta.url).href;
// API-G.2B / ME-2 — Focused tests for the `/v1/me` delegated RPC adapter.

import {
  assert,
  assertEquals,
  assertStrictEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { ApiHttpError, toSafeHttpErrorResponse } from "../../../../functions/_shared/btpm-api/http.ts";
import {
  type ApiV1MePayload,
  type ApiV1MeRpcClient,
  readApiV1Me,
} from "../../../../functions/_shared/btpm-api/supabaseReadMe.ts";
import type { ApiV1MeQuery } from "../../../../functions/_shared/btpm-api/routes/me.ts";

const VALID_UUID = "8f14e45f-ceea-467a-a4a7-2b4b0c7f4d21";
const ORG_ID = "1d2a3b4c-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const WS_ID = "2d2a3b4c-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const PROJECT_ID = "3d2a3b4c-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const TENANT_ID = "4d2a3b4c-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const CLIENT_ID = "btpm-external-client_1.0~test:a@b/c";

const NO_CONTEXT: ApiV1MeQuery = Object.freeze({
  contextType: null,
  contextId: null,
}) as ApiV1MeQuery;

function identity(context: unknown = null) {
  return {
    userId: VALID_UUID,
    displayName: "Example User",
    email: "vit@example.com",
    isActive: true,
    platformSuperAdmin: false,
    context,
  };
}

function orgContext(overrides: Record<string, unknown> = {}) {
  return {
    type: "organization",
    contextId: ORG_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    workspaceId: null,
    projectId: null,
    tenantRole: "member",
    organizationRole: "admin",
    workspaceRole: null,
    projectRole: null,
    effectiveRole: "org_admin",
    ...overrides,
  };
}

function query(type: "organization" | "workspace" | "project", id: string) {
  return { contextType: type, contextId: id } as ApiV1MeQuery;
}

const ORG_QUERY = query("organization", ORG_ID);
const WS_QUERY = query("workspace", WS_ID);
const PROJECT_QUERY = query("project", PROJECT_ID);

interface Call {
  functionName: string;
  args: unknown;
}

function makeClient(
  result: unknown,
  calls: Call[] = [],
  mode: "resolve" | "reject" = "resolve",
): ApiV1MeRpcClient & { calls: Call[] } {
  return {
    calls,
    rpc(functionName: string, args: unknown) {
      calls.push({ functionName, args });
      return mode === "resolve"
        ? Promise.resolve(result)
        : Promise.reject(result);
    },
  } as ApiV1MeRpcClient & { calls: Call[] };
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

Deno.test("calls exactly api_v1_get_me_context with null context args", async () => {
  const calls: Call[] = [];
  const client = makeClient({ data: identity(), error: null }, calls);
  await readApiV1Me(client, CLIENT_ID, NO_CONTEXT);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].functionName, "api_v1_get_me_context");
  assertEquals(calls[0].args, {
    _expected_oauth_client_id: CLIENT_ID,
    _context_type: null,
    _context_id: null,
  });
});

const WS_CONTEXT = orgContext({
  type: "workspace",
  contextId: WS_ID,
  workspaceId: WS_ID,
  workspaceRole: "ws_admin",
  effectiveRole: "ws_admin",
});

const PROJECT_CONTEXT = orgContext({
  type: "project",
  contextId: PROJECT_ID,
  workspaceId: WS_ID,
  projectId: PROJECT_ID,
  projectRole: "member",
  effectiveRole: "member",
});

Deno.test("passes the exact parsed context type and UUID", async () => {
  for (
    const [type, id, ctx] of [
      ["organization", ORG_ID, orgContext()],
      ["workspace", WS_ID, WS_CONTEXT],
      ["project", PROJECT_ID, PROJECT_CONTEXT],
    ] as const
  ) {
    const calls: Call[] = [];
    const client = makeClient({ data: identity(ctx), error: null }, calls);
    await readApiV1Me(client, CLIENT_ID, {
      contextType: type,
      contextId: id,
    } as ApiV1MeQuery);
    assertEquals(calls[0].args, {
      _expected_oauth_client_id: CLIENT_ID,
      _context_type: type,
      _context_id: id,
    });
  }
});

Deno.test("enriched no-context payload returned frozen and exact", async () => {
  const client = makeClient({ data: identity(), error: null });
  const payload: ApiV1MePayload = await readApiV1Me(client, CLIENT_ID, NO_CONTEXT);
  assertEquals(payload, {
    userId: VALID_UUID,
    displayName: "Example User",
    email: "vit@example.com",
    isActive: true,
    platformSuperAdmin: false,
    context: null,
  });
  assert(Object.isFrozen(payload));
});

Deno.test("null displayName and email are accepted", async () => {
  const client = makeClient({
    data: { ...identity(), displayName: null, email: null },
    error: null,
  });
  const payload = await readApiV1Me(client, CLIENT_ID, NO_CONTEXT);
  assertStrictEquals(payload.displayName, null);
  assertStrictEquals(payload.email, null);
});

Deno.test("exact requested organization, workspace and project contexts are accepted", async () => {
  const cases = [
    [ORG_QUERY, orgContext()],
    [WS_QUERY, WS_CONTEXT],
    [PROJECT_QUERY, PROJECT_CONTEXT],
  ] as const;
  for (const [q, ctx] of cases) {
    const client = makeClient({ data: identity(ctx), error: null });
    const payload = await readApiV1Me(client, CLIENT_ID, q);
    assertEquals(payload.context, ctx as unknown as typeof payload.context);
    assert(Object.isFrozen(payload.context));
  }
});

Deno.test("no-context request accepts only a null context", async () => {
  const ok = makeClient({ data: identity(), error: null });
  assertStrictEquals(
    (await readApiV1Me(ok, CLIENT_ID, NO_CONTEXT)).context,
    null,
  );

  for (const ctx of [orgContext(), WS_CONTEXT, PROJECT_CONTEXT]) {
    const client = makeClient({ data: identity(ctx), error: null });
    const err = await expectApiHttpError(() =>
      readApiV1Me(client, CLIENT_ID, NO_CONTEXT)
    );
    assertEquals(err.code, "internal_error");
  }
});

Deno.test("contextual request rejects a null or mismatched returned context", async () => {
  const OTHER_PROJECT_ID = "5d2a3b4c-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
  const cases: [ApiV1MeQuery, unknown][] = [
    [ORG_QUERY, null],
    [WS_QUERY, null],
    [PROJECT_QUERY, null],
    [
      query("project", OTHER_PROJECT_ID),
      PROJECT_CONTEXT,
    ],
    [PROJECT_QUERY, WS_CONTEXT],
    [WS_QUERY, orgContext()],
    [ORG_QUERY, WS_CONTEXT],
  ];
  for (const [q, ctx] of cases) {
    const client = makeClient({ data: identity(ctx), error: null });
    const err = await expectApiHttpError(() => readApiV1Me(client, CLIENT_ID, q));
    assertEquals(err.code, "internal_error");
    assertEquals(err.status, 500);
  }
});

Deno.test("context hierarchy violations fail closed", async () => {
  const bad: Record<string, unknown>[] = [
    orgContext({ workspaceId: WS_ID }),
    orgContext({ projectId: PROJECT_ID }),
    orgContext({ contextId: WS_ID }),
    orgContext({ type: "workspace", contextId: WS_ID, workspaceId: null }),
    orgContext({ type: "workspace", contextId: ORG_ID, workspaceId: WS_ID }),
    orgContext({
      type: "workspace",
      contextId: WS_ID,
      workspaceId: WS_ID,
      projectId: PROJECT_ID,
    }),
    orgContext({ type: "project", contextId: PROJECT_ID, projectId: PROJECT_ID }),
    orgContext({
      type: "project",
      contextId: WS_ID,
      workspaceId: WS_ID,
      projectId: PROJECT_ID,
    }),
    orgContext({ type: "tenant" }),
    orgContext({ extra: 1 }),
  ];
  for (const ctx of bad) {
    const client = makeClient({ data: identity(ctx), error: null });
    const type = ctx.type;
    const q = typeof type === "string" &&
        (type === "organization" || type === "workspace" || type === "project")
      ? query(type, ctx.contextId as string)
      : ORG_QUERY;
    const err = await expectApiHttpError(() => readApiV1Me(client, CLIENT_ID, q));
    assertEquals(err.code, "internal_error");
  }
});

Deno.test("malformed identity payloads fail closed", async () => {
  const bad: unknown[] = [
    null,
    undefined,
    0,
    "",
    [],
    {},
    { ...identity(), extra: 1 },
    { ...identity(), isActive: false },
    { ...identity(), isActive: "true" },
    { ...identity(), platformSuperAdmin: "false" },
    { ...identity(), userId: "not-a-uuid" },
    { ...identity(), displayName: 1 },
    { ...identity(), email: {} },
    { ...identity(), context: 1 },
    (() => {
      const p = identity() as Record<string, unknown>;
      delete p.context;
      return p;
    })(),
  ];
  for (const d of bad) {
    const client = makeClient({ data: d, error: null });
    const err = await expectApiHttpError(() =>
      readApiV1Me(client, CLIENT_ID, NO_CONTEXT)
    );
    assertEquals(err.code, "internal_error");
    assertEquals(err.status, 500);
  }
});

Deno.test("invalid expected OAuth client IDs fail before RPC", async () => {
  const invalid: unknown[] = [
    "",
    " ",
    ` ${CLIENT_ID}`,
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
    const client = makeClient({ data: identity(), error: null }, calls);
    const err = await expectApiHttpError(() =>
      readApiV1Me(client, bad as string, NO_CONTEXT)
    );
    assertEquals(err.code, "internal_error");
    assertEquals(calls.length, 0, "RPC must not be called");
  }
});

Deno.test("invalid query objects fail before RPC", async () => {
  const invalid: unknown[] = [
    null,
    undefined,
    "organization",
    { contextType: "organization", contextId: null },
    { contextType: null, contextId: ORG_ID },
    { contextType: "tenant", contextId: ORG_ID },
    { contextType: "organization", contextId: "not-a-uuid" },
  ];
  for (const bad of invalid) {
    const calls: Call[] = [];
    const client = makeClient({ data: identity(), error: null }, calls);
    const err = await expectApiHttpError(() =>
      readApiV1Me(client, CLIENT_ID, bad as ApiV1MeQuery)
    );
    assertEquals(err.code, "internal_error");
    assertEquals(calls.length, 0);
  }
});

Deno.test("invalid client object fails closed", async () => {
  for (const bad of [null, undefined, 0, "x", [], {}, { rpc: 1 }]) {
    const err = await expectApiHttpError(() =>
      readApiV1Me(bad as unknown as ApiV1MeRpcClient, CLIENT_ID, NO_CONTEXT)
    );
    assertEquals(err.code, "internal_error");
  }
});

Deno.test("SQLSTATE 42501 maps to not_authorized and 22023 to invalid_request", async () => {
  const denied = makeClient({
    data: null,
    error: { code: "42501", message: "permission denied", hint: "h" },
  });
  const deniedErr = await expectApiHttpError(() =>
    readApiV1Me(denied, CLIENT_ID, NO_CONTEXT)
  );
  assertEquals(deniedErr.code, "not_authorized");
  assertEquals(deniedErr.status, 403);

  const invalid = makeClient({
    data: null,
    error: { code: "22023", message: "invalid context" },
  });
  const invalidErr = await expectApiHttpError(() =>
    readApiV1Me(invalid, CLIENT_ID, NO_CONTEXT)
  );
  assertEquals(invalidErr.code, "invalid_request");
  assertEquals(invalidErr.status, 400);
});

Deno.test("every other RPC error maps to internal_error / 500", async () => {
  const errors: unknown[] = [
    { code: "42P01" },
    { code: "PGRST202" },
    { code: 42501 },
    { code: " 42501" },
    { code: "22023 " },
    {},
    "string error",
    123,
    [],
  ];
  for (const e of errors) {
    const client = makeClient({ data: null, error: e });
    const err = await expectApiHttpError(() =>
      readApiV1Me(client, CLIENT_ID, NO_CONTEXT)
    );
    assertEquals(err.code, "internal_error");
    assertEquals(err.status, 500);
  }
});

Deno.test("rejected RPC promise and malformed results map to internal_error", async () => {
  const rejected = makeClient(new Error("boom"), [], "reject");
  assertEquals(
    (await expectApiHttpError(() => readApiV1Me(rejected, CLIENT_ID, NO_CONTEXT)))
      .code,
    "internal_error",
  );

  for (
    const r of [
      undefined,
      null,
      "ok",
      [],
      {},
      { data: identity() },
      { error: null },
      { data: identity(), error: undefined },
    ]
  ) {
    const client = makeClient(r);
    const err = await expectApiHttpError(() =>
      readApiV1Me(client, CLIENT_ID, NO_CONTEXT)
    );
    assertEquals(err.code, "internal_error");
  }
});

Deno.test("database error fields never appear in safe serialization", async () => {
  const client = makeClient({
    data: null,
    error: {
      code: "42501",
      message: "permission denied for function api_v1_get_me_context",
      details: "row 12 of api_user_policy_acknowledgements",
      hint: "grant execute",
    },
  });
  const err = await expectApiHttpError(() =>
    readApiV1Me(client, CLIENT_ID, NO_CONTEXT)
  );
  const response = toSafeHttpErrorResponse(err, "req-1");
  assertEquals(response.status, 403);
  const body = await response.json();
  const text = JSON.stringify(body);
  for (
    const needle of [
      "permission denied",
      "grant execute",
      "42501",
      CLIENT_ID,
      "api_v1_get_me_context",
    ]
  ) {
    assert(!text.includes(needle), `must not leak: ${needle}`);
  }
});

Deno.test("adapter source exposes no dynamic dispatch, env, service role, fetch, decryption or server surface", async () => {
  const source = await Deno.readTextFile(
    new URL("../supabaseReadMe.ts", __BTPM_SRC_BASE__),
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
    "btpm_decrypt",
    "resolve_me_context",
    "from(",
  ];
  for (const needle of forbidden) {
    assert(!source.includes(needle), `must not contain: ${needle}`);
  }
  assert(source.includes(`"api_v1_get_me_context"`));
  assert(!source.includes(`"api_v1_get_me"`));
  assert(!/rpc\(\s*`/.test(source));
});
