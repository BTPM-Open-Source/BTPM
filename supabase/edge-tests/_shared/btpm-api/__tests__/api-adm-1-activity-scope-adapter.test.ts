// Relocated out of supabase/functions/ (Edge deploy bundle size).
// Source-file reads stay anchored to the original module location.
const __BTPM_SELF_URL__ = import.meta.url;
const __BTPM_SRC_BASE__ = new URL('../../../../functions/_shared/btpm-api/__tests__/api-adm-1-activity-scope-adapter.test.ts', import.meta.url).href;
// API-ADM.1 — B. Shared service-role activity-scope adapter behavior tests.

import {
  assert,
  assertEquals,
  assertStrictEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  createSupabaseActivityScopeResolver,
  type ApiActivityScope,
} from "../../../../functions/_shared/btpm-api/supabaseActivityScope.ts";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const WS_ID = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID = "44444444-4444-4444-8444-444444444444";
const TASK_ID = "55555555-5555-4555-8555-555555555555";
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

const SENSITIVE = "sensitive backend failure detail";

interface Call {
  name: string;
  args: Record<string, unknown>;
}

function resolverWith(
  impl: (name: string, args: Record<string, unknown>) => unknown,
) {
  const calls: Call[] = [];
  const resolver = createSupabaseActivityScopeResolver({
    rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return impl(name, args) as PromiseLike<unknown>;
    },
  });
  return { resolver, calls };
}

function okRow() {
  return {
    data: [
      {
        tenant_id: TENANT_ID,
        organization_id: ORG_ID,
        workspace_id: WS_ID,
        project_id: PROJECT_ID,
      },
    ],
    error: null,
  };
}

Deno.test("B — calls exactly api_g_5_10_resolve_target_activity_scope", async () => {
  const { resolver, calls } = resolverWith(() => Promise.resolve(okRow()));

  const scope = await resolver.resolve("task", TASK_ID);

  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, "api_g_5_10_resolve_target_activity_scope");
  assertEquals(calls[0].args, {
    _target_type: "task",
    _target_id: TASK_ID,
  });
  assertEquals(Object.keys(calls[0].args).length, 2);

  const expected: ApiActivityScope = {
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    workspaceId: WS_ID,
    projectId: PROJECT_ID,
  };
  assertEquals(scope, expected);
  assertEquals(Object.keys(scope!).length, 4);
  assert(Object.isFrozen(scope));
});

Deno.test("B — accepts exactly project, phase and task", async () => {
  for (const targetType of ["project", "phase", "task"]) {
    const { resolver, calls } = resolverWith(() => Promise.resolve(okRow()));
    const scope = await resolver.resolve(targetType, PROJECT_ID);
    assert(scope !== null);
    assertEquals(calls[0].args._target_type, targetType);
  }
});

Deno.test("B — rejects unsupported target types and invalid ids locally", async () => {
  const invalid: Array<[string, string]> = [
    ["risk", PROJECT_ID],
    ["blocker", PROJECT_ID],
    ["tenant", PROJECT_ID],
    ["organization", PROJECT_ID],
    ["workspace", PROJECT_ID],
    ["", PROJECT_ID],
    ["Task", PROJECT_ID],
    ["task", NIL_UUID],
    ["task", "not-a-uuid"],
    ["task", ""],
  ];

  for (const [targetType, targetId] of invalid) {
    const { resolver, calls } = resolverWith(() => {
      throw new Error("rpc must not be called");
    });
    const scope = await resolver.resolve(targetType, targetId);
    assertStrictEquals(scope, null);
    assertEquals(calls.length, 0);
  }
});

Deno.test("B — malformed, missing or extra result shapes fail closed", async () => {
  const cases: Array<() => unknown> = [
    () => {
      throw new Error(SENSITIVE);
    },
    () => Promise.reject(new Error(SENSITIVE)),
    () => Promise.resolve({ data: null, error: { message: SENSITIVE } }),
    () => Promise.resolve({ data: [], error: null }),
    () => Promise.resolve({ data: [okRow().data[0], okRow().data[0]], error: null }),
    () => Promise.resolve({ data: okRow().data[0], error: null }),
    () => Promise.resolve(null),
    () => Promise.resolve({ unexpected: SENSITIVE }),
    // Extra field present.
    () =>
      Promise.resolve({
        data: [{ ...okRow().data[0], title: "leaked title" }],
        error: null,
      }),
    // Missing field.
    () =>
      Promise.resolve({
        data: [{
          tenant_id: TENANT_ID,
          organization_id: ORG_ID,
          workspace_id: WS_ID,
        }],
        error: null,
      }),
    // Null hierarchy value.
    () =>
      Promise.resolve({
        data: [{ ...okRow().data[0], organization_id: null }],
        error: null,
      }),
    // Nil UUID hierarchy value.
    () =>
      Promise.resolve({
        data: [{ ...okRow().data[0], workspace_id: NIL_UUID }],
        error: null,
      }),
  ];

  for (const impl of cases) {
    const { resolver } = resolverWith(impl);
    const scope = await resolver.resolve("task", TASK_ID);
    assertStrictEquals(scope, null);
  }
});

Deno.test("B — module exposes no generic RPC executor, logging or token handling", async () => {
  const source = await Deno.readTextFile(
    new URL("../supabaseActivityScope.ts", __BTPM_SRC_BASE__),
  );
  for (
    const forbidden of [
      "createClient",
      "Deno.env",
      "console.log",
      "console.error",
      "console.warn",
      "fetch(",
      "setTimeout",
      "setInterval",
      "headers.get(",
      "Authorization",

      "service_role_key",
      ".from(",
      "SUPABASE_SERVICE_ROLE_KEY",
    ]
  ) {
    assert(!source.includes(forbidden), `unexpected: ${forbidden}`);
  }
  // Exactly one hard-coded function name; no dynamic selection.
  assertEquals(
    source.split("api_g_5_10_resolve_target_activity_scope").length - 1,
    2,
  );
});
