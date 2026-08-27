// Focused tests for API-G.1H runtime-control contract.

import {
  assert,
  assertEquals,
  assertStrictEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ApiOperationKind,
  ApiRuntimeControlEnvironment,
  ApiRuntimeControls,
  isApiOperationEnabled,
  parseApiRuntimeControls,
} from "../router.ts";
import { ApiHttpError } from "../../_shared/btpm-api/http.ts";

const ALL_FALSE = { apiEnabled: false, readsEnabled: false, mutationsEnabled: false };
const ALL_TRUE = { apiEnabled: true, readsEnabled: true, mutationsEnabled: true };

Deno.test("undefined environment returns secure default", () => {
  assertEquals({ ...parseApiRuntimeControls(undefined) }, ALL_FALSE);
});

Deno.test("empty environment returns all switches false", () => {
  assertEquals({ ...parseApiRuntimeControls({}) }, ALL_FALSE);
});

Deno.test("exact 'false' values return all switches false", () => {
  const r = parseApiRuntimeControls({
    BTPM_API_ENABLED: "false",
    BTPM_API_READS_ENABLED: "false",
    BTPM_API_MUTATIONS_ENABLED: "false",
  });
  assertEquals({ ...r }, ALL_FALSE);
});

Deno.test("exact 'true' values enable all three effective switches", () => {
  const r = parseApiRuntimeControls({
    BTPM_API_ENABLED: "true",
    BTPM_API_READS_ENABLED: "true",
    BTPM_API_MUTATIONS_ENABLED: "true",
  });
  assertEquals({ ...r }, ALL_TRUE);
});

Deno.test("global false overrides read and mutation values set to true", () => {
  const r = parseApiRuntimeControls({
    BTPM_API_ENABLED: "false",
    BTPM_API_READS_ENABLED: "true",
    BTPM_API_MUTATIONS_ENABLED: "true",
  });
  assertEquals({ ...r }, ALL_FALSE);
});

Deno.test("reads can be enabled while mutations remain disabled", () => {
  const r = parseApiRuntimeControls({
    BTPM_API_ENABLED: "true",
    BTPM_API_READS_ENABLED: "true",
    BTPM_API_MUTATIONS_ENABLED: "false",
  });
  assertEquals({ ...r }, { apiEnabled: true, readsEnabled: true, mutationsEnabled: false });
});

Deno.test("mutations can be enabled while reads remain disabled", () => {
  const r = parseApiRuntimeControls({
    BTPM_API_ENABLED: "true",
    BTPM_API_READS_ENABLED: "false",
    BTPM_API_MUTATIONS_ENABLED: "true",
  });
  assertEquals({ ...r }, { apiEnabled: true, readsEnabled: false, mutationsEnabled: true });
});

Deno.test("missing child switches remain disabled when global is enabled", () => {
  const r = parseApiRuntimeControls({ BTPM_API_ENABLED: "true" });
  assertEquals({ ...r }, { apiEnabled: true, readsEnabled: false, mutationsEnabled: false });
});

Deno.test("unknown environment properties are ignored", () => {
  const r = parseApiRuntimeControls(
    { BTPM_API_ENABLED: "true", extra: "true", other: "yes" } as never,
  );
  assertEquals({ ...r }, { apiEnabled: true, readsEnabled: false, mutationsEnabled: false });
});

Deno.test("output contains exactly the three declared keys", () => {
  const r = parseApiRuntimeControls({ BTPM_API_ENABLED: "true" });
  assertEquals(Object.keys(r).sort(), ["apiEnabled", "mutationsEnabled", "readsEnabled"]);
});

Deno.test("output is frozen", () => {
  const r = parseApiRuntimeControls({ BTPM_API_ENABLED: "true" });
  assert(Object.isFrozen(r));
  assertThrows(() => {
    (r as unknown as { apiEnabled: boolean }).apiEnabled = false;
  });
});

Deno.test("input environment is not mutated", () => {
  const env = { BTPM_API_ENABLED: "true", BTPM_API_READS_ENABLED: "true" };
  const snapshot = { ...env };
  parseApiRuntimeControls(env);
  assertEquals(env, snapshot);
});

const REJECTED_SWITCH_VALUES: unknown[] = [
  "",
  " ",
  " true",
  "true ",
  "TRUE",
  "True",
  "FALSE",
  "1",
  "0",
  "yes",
  "no",
  true,
  false,
  0,
  1,
  null,
  {},
  [],
];

for (const bad of REJECTED_SWITCH_VALUES) {
  Deno.test(
    `rejects switch value ${JSON.stringify(bad) ?? String(bad)}`,
    () => {
      assertThrows(
        () =>
          parseApiRuntimeControls(
            { BTPM_API_ENABLED: bad } as unknown as ApiRuntimeControlEnvironment,
          ),
        ApiHttpError,
      );
    },
  );
}

const REJECTED_ENV_INPUTS: unknown[] = [null, [], "x", 1, true, false];
for (const bad of REJECTED_ENV_INPUTS) {
  Deno.test(
    `rejects environment input ${JSON.stringify(bad) ?? String(bad)}`,
    () => {
      assertThrows(
        () => parseApiRuntimeControls(bad as never),
        ApiHttpError,
      );
    },
  );
}

Deno.test("isApiOperationEnabled returns true for enabled read", () => {
  assertStrictEquals(
    isApiOperationEnabled(
      { apiEnabled: true, readsEnabled: true, mutationsEnabled: false },
      "read",
    ),
    true,
  );
});

Deno.test("isApiOperationEnabled returns true for enabled mutation", () => {
  assertStrictEquals(
    isApiOperationEnabled(
      { apiEnabled: true, readsEnabled: false, mutationsEnabled: true },
      "mutation",
    ),
    true,
  );
});

Deno.test("isApiOperationEnabled returns false when global disabled", () => {
  // Cannot construct invariant-violating controls; simulate with all false.
  assertStrictEquals(isApiOperationEnabled(ALL_FALSE, "read"), false);
  assertStrictEquals(isApiOperationEnabled(ALL_FALSE, "mutation"), false);
});

Deno.test("isApiOperationEnabled returns false when child switch disabled", () => {
  assertStrictEquals(
    isApiOperationEnabled(
      { apiEnabled: true, readsEnabled: false, mutationsEnabled: false },
      "read",
    ),
    false,
  );
  assertStrictEquals(
    isApiOperationEnabled(
      { apiEnabled: true, readsEnabled: false, mutationsEnabled: false },
      "mutation",
    ),
    false,
  );
});

Deno.test("malformed controls throw internal_error", () => {
  const badControls: unknown[] = [
    null,
    [],
    "x",
    1,
    {},
    { apiEnabled: true, readsEnabled: true, mutationsEnabled: "false" },
    { apiEnabled: "true", readsEnabled: false, mutationsEnabled: false },
    // Invariant violation: children true while global false.
    { apiEnabled: false, readsEnabled: true, mutationsEnabled: false },
    { apiEnabled: false, readsEnabled: false, mutationsEnabled: true },
  ];
  for (const c of badControls) {
    assertThrows(
      () => isApiOperationEnabled(c as ApiRuntimeControls, "read"),
      ApiHttpError,
    );
  }
});

Deno.test("invalid operation strings throw internal_error", () => {
  const bad: unknown[] = ["", "READ", "reads", "write", "mutations", null, undefined, 1, {}];
  for (const op of bad) {
    assertThrows(
      () => isApiOperationEnabled(ALL_TRUE, op as ApiOperationKind),
      ApiHttpError,
    );
  }
});

Deno.test("controls object is not mutated by isApiOperationEnabled", () => {
  const controls = Object.freeze({
    apiEnabled: true,
    readsEnabled: true,
    mutationsEnabled: true,
  });
  isApiOperationEnabled(controls, "read");
  assertEquals({ ...controls }, ALL_TRUE);
});

Deno.test("malformed configuration serialization exposes no supplied value", () => {
  try {
    parseApiRuntimeControls({ BTPM_API_ENABLED: "super-secret-value" } as never);
    throw new Error("expected throw");
  } catch (err) {
    assert(err instanceof ApiHttpError);
    const serialized = JSON.stringify(err.toSafeJSON("00000000-0000-0000-0000-000000000000"));
    assert(!serialized.includes("super-secret-value"));
    assert(!serialized.includes("BTPM_API_ENABLED"));
  }
});

// ---------------------------------------------------------------------------
// API-G.5.10A-3 — durable-activity identity propagation
// ---------------------------------------------------------------------------

import { executeApiProtectedRoute } from "../router.ts";
import { VERSION_ROUTE, buildVersionPayload } from "../routes/version.ts";
import type { AuthenticatedApiContext } from "../../_shared/btpm-api/authenticateApiRequest.ts";

Deno.test("successful protected route exposes only the activity identity", async () => {
  const userId = "11111111-1111-4111-8111-111111111111";
  const apiClientId = "22222222-2222-4222-8222-222222222222";
  const policyVersionId = "33333333-3333-4333-8333-333333333333";
  const oauthClientId = "oauth-client-abc";

  const context = Object.freeze({
    token: Object.freeze({ userId, clientId: oauthClientId }),
    client: Object.freeze({
      userId,
      apiClientId,
      policyVersionId,
      oauthClientId,
    }),
  }) as unknown as AuthenticatedApiContext;

  const result = await executeApiProtectedRoute(
    new Request("http://localhost/v1/version", { method: "GET" }),
    "/v1/version",
    { apiEnabled: true, readsEnabled: true, mutationsEnabled: false },
    {
      authenticate: () => Promise.resolve(context),
      authorizeRoute: () => Promise.resolve(),
      resolveRateLimitProfile: () =>
        Promise.resolve({ limit: 100, windowSeconds: 60 }),
      rateLimit: {
        store: {
          consume: () =>
            Promise.resolve({
              allowed: true,
              remaining: 9,
              resetAtEpochMs: 1_700_000_000_000,
            }),
        },
        now: () => 1_600_000_000_000,
      },
      readMe: () => Promise.reject(new ApiHttpError("internal_error")),
      readOrganizations: () => Promise.reject(new ApiHttpError("internal_error")),
      readWorkspaces: () => Promise.reject(new ApiHttpError("internal_error")),
      readProjects: () => Promise.reject(new ApiHttpError("internal_error")),
      readProjectDetail: () =>
        Promise.reject(new ApiHttpError("internal_error")),
      readProjectPlanning: () =>
        Promise.reject(new ApiHttpError("internal_error")),
    },
  );

  // Identity is derived strictly from the authenticated context.
  assertStrictEquals(result.activityIdentity.apiClientId, apiClientId);
  assertStrictEquals(result.activityIdentity.actorUserId, userId);
  assertEquals(
    Object.keys(result.activityIdentity).sort(),
    ["actorUserId", "apiClientId"],
  );
  assert(Object.isFrozen(result.activityIdentity));

  // No OAuth client ID or policy-version ID leaks into the identity.
  const serializedIdentity = JSON.stringify(result.activityIdentity);
  assert(!serializedIdentity.includes(oauthClientId));
  assert(!serializedIdentity.includes(policyVersionId));

  // Route and payload remain exactly unchanged.
  assertStrictEquals(result.route, VERSION_ROUTE);
  assertEquals(result.payload, buildVersionPayload());
});
