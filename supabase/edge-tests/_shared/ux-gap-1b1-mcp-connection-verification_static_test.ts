// UX-GAP.1B1 — Focused checks for the durable MCP connection-verification
// evidence: recorder adapter behavior, forward-migration contract and MCP
// runtime insertion-point wiring (static).

import {
  assert,
  assertEquals,
  assertStrictEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  createMcpConnectionVerificationRecorder,
  MCP_CONNECTION_VERIFICATION_RPC,
} from "../../functions/btpm-mcp/mcp/connectionVerificationRecorder.ts";

const CLIENT_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR_ID = "22222222-2222-4222-8222-222222222222";
const EVENT_ID = "33333333-3333-4333-8333-333333333333";
const REQUEST_ID = "44444444-4444-4444-8444-444444444444";

const MIGRATION_PATH = new URL(
  "../../migrations/20260817154921_7b7e44e0-1a8f-4122-a310-e075cf384e71.sql",
  import.meta.url,
);
const MCP_INDEX_PATH = new URL(
  "../../functions/btpm-mcp/index.ts",
  import.meta.url,
);

const migrationSql = await Deno.readTextFile(MIGRATION_PATH);
const mcpIndex = await Deno.readTextFile(MCP_INDEX_PATH);

interface Call {
  name: string;
  args: Record<string, unknown>;
}

function recorderWith(impl: (name: string, args: Record<string, unknown>) => unknown) {
  const calls: Call[] = [];
  const recorder = createMcpConnectionVerificationRecorder({
    rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return impl(name, args) as PromiseLike<unknown>;
    },
  });
  return { recorder, calls };
}

// ---------------------------------------------------------------------------
// Database contract (static, forward migration only)
// ---------------------------------------------------------------------------

Deno.test("source_channel accepts exactly btpm_api_v1 and mcp", () => {
  assert(
    migrationSql.includes(
      "CHECK (source_channel IN ('btpm_api_v1', 'mcp'))",
    ),
  );
  assert(!migrationSql.includes("DROP TABLE"));
  assert(!migrationSql.includes("ALTER COLUMN source_channel"));
});

Deno.test("recorder function pins route, status, method, version and channel", () => {
  assert(migrationSql.includes("api_g_5_10_record_mcp_connection_verification"));
  assert(migrationSql.includes("'mcp.connection_verified'"));
  assert(migrationSql.includes("SECURITY DEFINER"));
  assert(migrationSql.includes("SET search_path = public, pg_catalog"));
  // Fixed server-owned values in the INSERT VALUES list.
  const values = migrationSql.slice(
    migrationSql.indexOf("'v1',"),
    migrationSql.indexOf("$function$;"),
  );
  assert(values.includes("'POST',"));
  assert(values.includes("200,"));
  assert(values.includes("'mcp'"));
});

Deno.test("recorder is service_role only", () => {
  for (const role of ["PUBLIC", "anon", "authenticated"]) {
    assert(
      migrationSql.includes(
        `REVOKE ALL ON FUNCTION public.api_g_5_10_record_mcp_connection_verification(uuid, uuid, text) FROM ${role};`,
      ),
    );
  }
  assert(
    migrationSql.includes(
      "GRANT EXECUTE ON FUNCTION public.api_g_5_10_record_mcp_connection_verification(uuid, uuid, text) TO service_role;",
    ),
  );
});

Deno.test("recorder cannot persist token/audience/scope/capability inputs", () => {
  const signature = migrationSql.slice(
    migrationSql.indexOf("api_g_5_10_record_mcp_connection_verification("),
    migrationSql.indexOf("RETURNS uuid"),
  );
  for (
    const forbidden of [
      "audience",
      "token",
      "bearer",
      "email",
      "tenant",
      "organization",
      "workspace",
      "project",
      "capability",
      "policy",
      "role",
      "status",
      "route",
    ]
  ) {
    assert(
      !signature.toLowerCase().includes(forbidden),
      `recorder signature must not accept ${forbidden}`,
    );
  }
  // Scope columns are hard-wired to NULL.
  assert(migrationSql.includes("NULL,\n    NULL,\n    NULL,\n    NULL,"));
});

Deno.test("platform verification read is Platform-Super-Admin only and returns two fields", () => {
  assert(migrationSql.includes("api_g_5_10_get_mcp_connection_verification"));
  assert(migrationSql.includes("public.is_platform_super_admin(v_actor)"));
  const body = migrationSql.slice(
    migrationSql.indexOf("api_g_5_10_get_mcp_connection_verification("),
  );
  assert(body.includes("verified boolean"));
  assert(body.includes("last_successful_authentication_at timestamptz"));
  assert(body.includes("RETURN QUERY SELECT (v_last IS NOT NULL), v_last;"));
  for (const forbidden of ["actor_user_id,", "correlation_id,", "secret"]) {
    assert(!body.includes(forbidden), `read must not return ${forbidden}`);
  }
  assert(!body.includes("is_tenant_admin"));
  assert(!body.includes("is_org_admin"));
});

// ---------------------------------------------------------------------------
// Recorder adapter behavior
// ---------------------------------------------------------------------------

Deno.test("records one evidence event with the exact bounded RPC contract", async () => {
  const { recorder, calls } = recorderWith(() =>
    Promise.resolve({ data: EVENT_ID, error: null })
  );

  const result = await recorder.record({
    apiClientId: CLIENT_ID,
    actorUserId: ACTOR_ID,
    requestId: REQUEST_ID,
  });

  assertStrictEquals(result, true);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, MCP_CONNECTION_VERIFICATION_RPC);
  assertEquals(calls[0].args, {
    _api_client_id: CLIENT_ID,
    _actor_user_id: ACTOR_ID,
    _request_id: REQUEST_ID,
  });
  assertEquals(Object.keys(calls[0].args).length, 3);
});

Deno.test("rejects invalid input locally without calling the RPC", async () => {
  const base = {
    apiClientId: CLIENT_ID,
    actorUserId: ACTOR_ID,
    requestId: REQUEST_ID,
  };
  const invalid = [
    { ...base, apiClientId: "not-a-uuid" },
    { ...base, actorUserId: "" },
    { ...base, requestId: "invalid request id!" },
    { ...base, requestId: "a".repeat(65) },
  ];
  for (const input of invalid) {
    const { recorder, calls } = recorderWith(() => {
      throw new Error("rpc must not be called");
    });
    assertStrictEquals(await recorder.record(input), false);
    assertEquals(calls.length, 0);
  }
});

Deno.test("contains recorder failures without throwing or leaking detail", async () => {
  const SENSITIVE = "sensitive database failure detail";
  const cases: Array<() => unknown> = [
    () => {
      throw new Error(SENSITIVE);
    },
    () => Promise.reject(new Error(SENSITIVE)),
    () => Promise.resolve({ data: null, error: { message: SENSITIVE } }),
    () => Promise.resolve({ unexpected: SENSITIVE }),
    () => Promise.resolve(null),
    () => Promise.resolve({ data: "not-a-uuid", error: null }),
  ];
  for (const impl of cases) {
    const { recorder, calls } = recorderWith(impl);
    const result = await recorder.record({
      apiClientId: CLIENT_ID,
      actorUserId: ACTOR_ID,
      requestId: REQUEST_ID,
    });
    assertStrictEquals(result, false);
    assertEquals(calls.length, 1);
    assert(!JSON.stringify(result).includes(SENSITIVE));
  }
});

// ---------------------------------------------------------------------------
// MCP runtime insertion point (static)
// ---------------------------------------------------------------------------

Deno.test("MCP runtime records verification only after the full authorization chain and the MCP handler", () => {
  const authIndex = mcpIndex.indexOf("await authenticateMcpRequest(");
  const authorizeIndex = mcpIndex.indexOf("await authorizeMcpConnectedApp(");
  const contextIndex = mcpIndex.indexOf("buildMcpExecutionContext(authorized)");
  const handlerIndex = mcpIndex.lastIndexOf("createRequestHandler(");
  const okIndex = mcpIndex.indexOf("if (response.ok)");
  const recordIndex = mcpIndex.indexOf(
    "runtime.connectionVerificationRecorder",
  );

  assert(authIndex > 0 && authorizeIndex > authIndex);
  assert(contextIndex > authorizeIndex);
  assert(handlerIndex > contextIndex, "MCP handler runs after trusted context");
  assert(okIndex > handlerIndex, "verification decision follows the response");
  assert(recordIndex > okIndex, "recorder must never precede the MCP handler");
});

Deno.test("MCP runtime awaits the recorder once and never blocks the request", () => {
  const region = mcpIndex.slice(
    mcpIndex.indexOf("if (response.ok)"),
    mcpIndex.indexOf("return withRequestId(response, requestId);"),
  );
  assertEquals(
    region.split("connectionVerificationRecorder?.record(").length - 1,
    1,
    "recorder invoked exactly once",
  );
  assert(region.includes("await runtime.connectionVerificationRecorder"));
  assert(region.includes("catch"));
  assert(!region.includes("waitUntil"));
  assert(!region.includes("void runtime.connectionVerificationRecorder"));
  assert(!region.includes("return "), "recorder failure must not return early");
  // No token or Authorization header may be supplied to the recorder.
  const args = region.slice(region.indexOf(".record({"), region.indexOf("});"));
  assertEquals(
    args.match(/[a-zA-Z]+:/g)?.sort(),
    ["actorUserId:", "apiClientId:", "requestId:"],
  );
  for (
    const forbidden of [
      "Authorization",
      "Bearer",
      "token",
      "headers",
      "audience",
      "aud",
    ]
  ) {
    assert(!args.includes(forbidden), `recorder args must not carry ${forbidden}`);
  }
});


Deno.test("metadata GET, origin, method, auth, authorization and context failures return before the recorder", () => {
  const recordIndex = mcpIndex.indexOf(
    "runtime.connectionVerificationRecorder",
  );
  for (
    const earlyExit of [
      "return withRequestId(metadataResponse(runtime), requestId);",
      'new Response("Forbidden origin.", { status: 403 }),',
      'new Response("Method not allowed.", {',
      "return withRequestId(unauthorizedResponse(runtime), requestId);",
      "return withRequestId(connectedAppForbiddenResponse(), requestId);",
    ]
  ) {
    const at = mcpIndex.indexOf(earlyExit);
    assert(at > 0, `expected early exit: ${earlyExit}`);
    assert(at < recordIndex, `early exit must precede recorder: ${earlyExit}`);
  }
});

Deno.test("MCP runtime uses the protected recorder and never inserts activity rows directly", () => {
  assert(mcpIndex.includes("createMcpConnectionVerificationRecorder"));
  assert(!mcpIndex.includes("api_request_activity_events"));
  assert(!mcpIndex.includes(".from(\"api_request_activity_events\")"));
});
