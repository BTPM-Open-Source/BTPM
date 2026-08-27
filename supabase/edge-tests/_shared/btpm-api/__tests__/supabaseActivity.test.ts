// API-G.5.10A-2 — Behavioral tests for the service-role durable activity adapter.

import {
  assert,
  assertEquals,
  assertStrictEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  type ApiActivityRecordInput,
  createSupabaseActivityRecorder,
} from "../../../../functions/_shared/btpm-api/supabaseActivity.ts";

const CLIENT_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR_ID = "22222222-2222-4222-8222-222222222222";
const TENANT_ID = "33333333-3333-4333-8333-333333333333";
const ORG_ID = "44444444-4444-4444-8444-444444444444";
const WS_ID = "55555555-5555-4555-8555-555555555555";
const PROJECT_ID = "66666666-6666-4666-8666-666666666666";
const EVENT_ID = "77777777-7777-4777-8777-777777777777";

const SENSITIVE = "sensitive backend failure detail";

interface Call {
  name: string;
  args: Record<string, unknown>;
}

function recorderWith(
  impl: (name: string, args: Record<string, unknown>) => unknown,
) {
  const calls: Call[] = [];
  const recorder = createSupabaseActivityRecorder({
    rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return impl(name, args) as PromiseLike<unknown>;
    },
  });
  return { recorder, calls };
}

function projectScopedInput(): ApiActivityRecordInput {
  return {
    apiClientId: CLIENT_ID,
    apiVersion: "v1",
    routeId: "v1.projects.read",
    method: "GET",
    status: 200,
    durationMs: 42,
    actorUserId: ACTOR_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    workspaceId: WS_ID,
    projectId: PROJECT_ID,
    correlationId: "corr-ABC_123",
  };
}

Deno.test("records a fully scoped activity event with the exact RPC contract", async () => {
  const { recorder, calls } = recorderWith(() =>
    Promise.resolve({ data: EVENT_ID, error: null })
  );

  const input = projectScopedInput();
  const snapshot = JSON.stringify(input);

  const result = await recorder.record(input);

  assertStrictEquals(result, true);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, "api_g_5_10_record_api_activity");
  assertEquals(calls[0].args, {
    _api_client_id: CLIENT_ID,
    _api_version: "v1",
    _route_id: "v1.projects.read",
    _http_method: "GET",
    _http_status: 200,
    _duration_ms: 42,
    _actor_user_id: ACTOR_ID,
    _tenant_id: TENANT_ID,
    _organization_id: ORG_ID,
    _workspace_id: WS_ID,
    _project_id: PROJECT_ID,
    _correlation_id: "corr-ABC_123",
  });
  assertEquals(Object.keys(calls[0].args).length, 12);
  assertEquals(JSON.stringify(input), snapshot);
});

Deno.test("records an unscoped activity event with explicit nulls", async () => {
  const { recorder, calls } = recorderWith(() =>
    Promise.resolve({ data: EVENT_ID, error: null })
  );

  const result = await recorder.record({
    apiClientId: CLIENT_ID,
    apiVersion: "v2",
    routeId: "v1.version",
    method: "OPTIONS",
    status: 204,
    durationMs: 0,
    actorUserId: ACTOR_ID,
    tenantId: null,
    organizationId: null,
    workspaceId: null,
    projectId: null,
    correlationId: null,
  });

  assertStrictEquals(result, true);
  assertEquals(calls.length, 1);
  const args = calls[0].args;
  assertStrictEquals(args._tenant_id, null);
  assertStrictEquals(args._organization_id, null);
  assertStrictEquals(args._workspace_id, null);
  assertStrictEquals(args._project_id, null);
  assertStrictEquals(args._correlation_id, null);
  assert("_tenant_id" in args);
  assert("_correlation_id" in args);
});

Deno.test("rejects invalid input locally without calling the RPC", async () => {
  const base = projectScopedInput();
  const invalidInputs: ApiActivityRecordInput[] = [
    { ...base, apiClientId: "not-a-uuid" },
    { ...base, apiVersion: "v0" },
    { ...base, routeId: "bad route id!" },
    { ...base, method: "TRACE" as unknown as ApiActivityRecordInput["method"] },
    { ...base, status: 99 },
    { ...base, durationMs: 3_600_001 },
    { ...base, correlationId: "invalid correlation id!" },
    // Workspace without Organization.
    { ...base, organizationId: null, projectId: null },
    // Project without the full parent chain.
    { ...base, workspaceId: null },
  ];

  for (const input of invalidInputs) {
    const { recorder, calls } = recorderWith(() => {
      throw new Error("rpc must not be called");
    });
    const result = await recorder.record(input);
    assertStrictEquals(result, false);
    assertEquals(calls.length, 0);
  }
});

Deno.test("contains RPC and response failures without throwing or leaking", async () => {
  const cases: Array<() => unknown> = [
    () => {
      throw new Error(SENSITIVE);
    },
    () => Promise.reject(new Error(SENSITIVE)),
    () => Promise.resolve({ data: null, error: { message: SENSITIVE } }),
    () => Promise.resolve({ unexpected: SENSITIVE }),
    () => Promise.resolve({ data: [EVENT_ID], error: null }),
    () => Promise.resolve({ data: "not-a-uuid", error: null }),
    () => Promise.resolve(null),
    () => Promise.resolve({ data: { id: EVENT_ID }, error: null }),
  ];

  for (const impl of cases) {
    const { recorder, calls } = recorderWith(impl);
    const result = await recorder.record(projectScopedInput());
    assertStrictEquals(result, false);
    assertEquals(calls.length, 1);
    assert(!JSON.stringify(result).includes(SENSITIVE));
  }
});
