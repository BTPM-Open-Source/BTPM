// API-G.1I focused tests for the explicit route allowlist and payload contracts.

import {
  assert,
  assertEquals,
  assertNotStrictEquals,
  assertStrictEquals,
  assertRejects,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  API_V1_ROUTE_ALLOWLIST,
  ApiRouteDefinition,
  ApiRuntimeControls,
  dispatchApiRoutePayload,
  executeApiProtectedRoute,
  matchApiRoute,
  parseApiRuntimeControls,
  isApiOperationEnabled,
  resolveApiRouteAccess,
  type ApiProtectedRouteDependencies,
} from "../router.ts";
import {
  VERSION_ROUTE,
  buildVersionPayload,
} from "../routes/version.ts";
import {
  CAPABILITIES_ROUTE,
  buildCapabilitiesPayload,
} from "../routes/capabilities.ts";
import { ME_ROUTE } from "../routes/me.ts";
import { ORGANIZATIONS_ROUTE } from "../routes/organizations.ts";
import { WORKSPACES_ROUTE } from "../routes/workspaces.ts";
import { PROJECTS_ROUTE } from "../routes/projects.ts";
import { PROJECT_DETAIL_ROUTE } from "../routes/projectDetail.ts";
import { PROJECT_PLANNING_ROUTE } from "../routes/projectPlanning.ts";
import { EXECUTION_UPDATES_APPEND_ROUTE } from "../routes/executionUpdates.ts";
import type { ApiV1OrganizationsPayload } from "../../_shared/btpm-api/supabaseOrganizations.ts";
import type { ApiV1WorkspacesPayload } from "../../_shared/btpm-api/supabaseWorkspaces.ts";
import type { ApiV1ProjectsPayload } from "../../_shared/btpm-api/supabaseProjects.ts";
import type { ApiV1ProjectDetailPayload } from "../../_shared/btpm-api/supabaseProjectDetail.ts";
import type { ApiV1ProjectPlanningPayload } from "../../_shared/btpm-api/supabaseProjectPlanning.ts";

import { ApiHttpError } from "../../_shared/btpm-api/http.ts";
import { ApiAuthenticationError } from "../../_shared/btpm-api/apiErrors.ts";
import type { AuthenticatedApiContext } from "../../_shared/btpm-api/authenticateApiRequest.ts";
import type {
  ApiRateLimitDependencies,
  ApiRateLimitProfile,
  ApiRateLimitStoreInput,
  ApiRateLimitStoreResult,
} from "../../_shared/btpm-api/rateLimit.ts";

Deno.test("VERSION_ROUTE has exact contract", () => {
  assertEquals(VERSION_ROUTE.id, "version.get");
  assertEquals(VERSION_ROUTE.method, "GET");
  assertEquals(VERSION_ROUTE.path, "/v1/version");
  assertEquals(VERSION_ROUTE.operation, "read");
});

Deno.test("CAPABILITIES_ROUTE has exact contract", () => {
  assertEquals(CAPABILITIES_ROUTE.id, "capabilities.get");
  assertEquals(CAPABILITIES_ROUTE.method, "GET");
  assertEquals(CAPABILITIES_ROUTE.path, "/v1/capabilities");
  assertEquals(CAPABILITIES_ROUTE.operation, "read");
});

Deno.test("ME_ROUTE has exact contract", () => {
  assertEquals(ME_ROUTE.id, "me.get");
  assertEquals(ME_ROUTE.method, "GET");
  assertEquals(ME_ROUTE.path, "/v1/me");
  assertEquals(ME_ROUTE.operation, "read");
  assertEquals(Object.keys(ME_ROUTE).sort(), [
    "id",
    "method",
    "operation",
    "path",
  ]);
});

Deno.test("WORKSPACES_ROUTE has exact contract", () => {
  assertEquals(WORKSPACES_ROUTE.id, "workspaces.get");
  assertEquals(WORKSPACES_ROUTE.method, "GET");
  assertEquals(WORKSPACES_ROUTE.path, "/v1/workspaces");
  assertEquals(WORKSPACES_ROUTE.operation, "read");
  assertEquals(Object.keys(WORKSPACES_ROUTE).sort(), [
    "id",
    "method",
    "operation",
    "path",
  ]);
});

Deno.test("route constants are frozen", () => {
  assert(Object.isFrozen(VERSION_ROUTE));
  assert(Object.isFrozen(CAPABILITIES_ROUTE));
  assert(Object.isFrozen(ME_ROUTE));
  assert(Object.isFrozen(WORKSPACES_ROUTE));
});

Deno.test("PROJECTS_ROUTE has exact frozen contract", () => {
  assertEquals(PROJECTS_ROUTE.id, "projects.get");
  assertEquals(PROJECTS_ROUTE.method, "GET");
  assertEquals(PROJECTS_ROUTE.path, "/v1/projects");
  assertEquals(PROJECTS_ROUTE.operation, "read");
  assertEquals(Object.keys(PROJECTS_ROUTE).sort(), [
    "id",
    "method",
    "operation",
    "path",
  ]);
  assert(Object.isFrozen(PROJECTS_ROUTE));
});

// API-N.RG1B — this historical guard no longer snapshots the whole current
// allowlist. Global route order, cardinality and `/v1/capabilities` parity are
// owned solely by api-v1-current-surface-topology.test.ts. What remains here is
// a local exact-once registration guard by route-object identity for the
// foundation routes this file actually owns.
Deno.test("API-G.1I/API-N.RG1B: each foundation route object is registered exactly once", () => {
  const foundationRoutes = [
    VERSION_ROUTE,
    CAPABILITIES_ROUTE,
    ME_ROUTE,
    ORGANIZATIONS_ROUTE,
    WORKSPACES_ROUTE,
    PROJECTS_ROUTE,
    PROJECT_DETAIL_ROUTE,
    PROJECT_PLANNING_ROUTE,
    EXECUTION_UPDATES_APPEND_ROUTE,
  ] as const;
  for (const route of foundationRoutes) {
    assertEquals(
      API_V1_ROUTE_ALLOWLIST.filter((entry) => entry === route).length,
      1,
      route.id,
    );
    assert(Object.isFrozen(route), route.id);
  }
});


// ---------------------------------------------------------------------------
// API-I.8 — Independent mutation route runtime gate.
// ---------------------------------------------------------------------------

Deno.test("API-I.8: exact POST /v1/execution-updates matches the frozen route", () => {
  assertStrictEquals(
    matchApiRoute("POST", "/v1/execution-updates"),
    EXECUTION_UPDATES_APPEND_ROUTE,
  );
  assertEquals(EXECUTION_UPDATES_APPEND_ROUTE.id, "execution_updates.append");
  assertEquals(EXECUTION_UPDATES_APPEND_ROUTE.method, "POST");
  assertEquals(EXECUTION_UPDATES_APPEND_ROUTE.path, "/v1/execution-updates");
  assertEquals(EXECUTION_UPDATES_APPEND_ROUTE.operation, "mutation");
  assertEquals(Object.keys(EXECUTION_UPDATES_APPEND_ROUTE).sort(), [
    "id",
    "method",
    "operation",
    "path",
  ]);
});

// API-M.CP.3C — GET /v1/execution-updates is now the activated Execution
// Update history read, so it is asserted separately below and is no longer part
// of the rejected-method set for the append path.
Deno.test("API-I.8/API-M.CP.3C: append path rejects every method except POST and the activated GET read", () => {
  assertEquals(
    matchApiRoute("GET", "/v1/execution-updates")?.id,
    "execution_updates.get",
  );
  for (
    const m of ["PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "post", "Post", ""]
  ) {
    assertStrictEquals(
      matchApiRoute(m, "/v1/execution-updates"),
      null,
      `${m} must not match`,
    );
  }
});

Deno.test("API-I.8: mutation route rejects path, case, slash, query and fragment variants", () => {
  for (
    const p of [
      "/v1/execution-updates/",
      "//v1/execution-updates",
      "/v1/Execution-Updates",
      "/v1/EXECUTION-UPDATES",
      "/v1/execution_updates",
      "/v1/executionupdates",
      "/v1/execution-updates/extra",
      "/v1/execution-updates?target=1",
      "/v1/execution-updates#frag",
      " /v1/execution-updates",
      "/v1/execution-updates ",
      "/v1/execution-updates\t",
      "v1/execution-updates",
      "/v2/execution-updates",
    ]
  ) {
    assertStrictEquals(matchApiRoute("POST", p), null, p);
  }
});

Deno.test("API-I.8: mutation disabled → api_unavailable", () => {
  for (
    const controls of [
      parseApiRuntimeControls({
        BTPM_API_ENABLED: "true",
        BTPM_API_READS_ENABLED: "true",
        BTPM_API_MUTATIONS_ENABLED: "false",
      }),
      parseApiRuntimeControls({
        BTPM_API_ENABLED: "true",
        BTPM_API_READS_ENABLED: "false",
        BTPM_API_MUTATIONS_ENABLED: "false",
      }),
      parseApiRuntimeControls(undefined),
    ]
  ) {
    const error = assertThrows(
      () => resolveApiRouteAccess("POST", "/v1/execution-updates", controls),
      Error,
    ) as { code?: string };
    assertEquals(error.code, "api_unavailable");
  }
});

Deno.test("API-I.8: mutations ON + reads OFF resolves mutation and blocks reads", () => {
  const controls = parseApiRuntimeControls({
    BTPM_API_ENABLED: "true",
    BTPM_API_READS_ENABLED: "false",
    BTPM_API_MUTATIONS_ENABLED: "true",
  });
  assertStrictEquals(
    resolveApiRouteAccess("POST", "/v1/execution-updates", controls),
    EXECUTION_UPDATES_APPEND_ROUTE,
  );
  for (
    const path of [
      "/v1/version",
      "/v1/capabilities",
      "/v1/me",
      "/v1/organizations",
      "/v1/workspaces",
      "/v1/projects",
    ]
  ) {
    const error = assertThrows(
      () => resolveApiRouteAccess("GET", path, controls),
      Error,
    ) as { code?: string };
    assertEquals(error.code, "api_unavailable");
  }
});

Deno.test("API-I.8: reads ON + mutations OFF resolves reads only", () => {
  const controls = parseApiRuntimeControls({
    BTPM_API_ENABLED: "true",
    BTPM_API_READS_ENABLED: "true",
    BTPM_API_MUTATIONS_ENABLED: "false",
  });
  assertStrictEquals(
    resolveApiRouteAccess("GET", "/v1/version", controls),
    VERSION_ROUTE,
  );
  assertStrictEquals(
    resolveApiRouteAccess("GET", "/v1/projects", controls),
    PROJECTS_ROUTE,
  );
  const error = assertThrows(
    () => resolveApiRouteAccess("POST", "/v1/execution-updates", controls),
    Error,
  ) as { code?: string };
  assertEquals(error.code, "api_unavailable");
});

Deno.test("API-I.8: both ON resolves both route classes", () => {
  const controls = parseApiRuntimeControls({
    BTPM_API_ENABLED: "true",
    BTPM_API_READS_ENABLED: "true",
    BTPM_API_MUTATIONS_ENABLED: "true",
  });
  assertStrictEquals(
    resolveApiRouteAccess("GET", "/v1/me", controls),
    ME_ROUTE,
  );
  assertStrictEquals(
    resolveApiRouteAccess("POST", "/v1/execution-updates", controls),
    EXECUTION_UPDATES_APPEND_ROUTE,
  );
});

Deno.test("API-I.8: global API disabled blocks reads and mutations", () => {
  const controls = parseApiRuntimeControls({
    BTPM_API_ENABLED: "false",
    BTPM_API_READS_ENABLED: "true",
    BTPM_API_MUTATIONS_ENABLED: "true",
  });
  assertEquals(controls.readsEnabled, false);
  assertEquals(controls.mutationsEnabled, false);
  for (const [m, p] of [["GET", "/v1/version"], ["POST", "/v1/execution-updates"]]) {
    const error = assertThrows(
      () => resolveApiRouteAccess(m, p, controls),
      Error,
    ) as { code?: string };
    assertEquals(error.code, "api_unavailable");
  }
});

// API-I.9A superseded the API-I.8 router-containment guard: the protected
// mutation pipeline now lives in `router.ts` by design. Containment is asserted
// where it still holds — the router never constructs a Supabase client, never
// touches the service role, and never invokes the wrapper name directly.
Deno.test("API-I.9A: router mutation pipeline stays transport- and client-free", async () => {
  const source = await Deno.readTextFile(
    new URL("../router.ts", import.meta.url),
  );
  for (
    const needle of [
      "createDelegatedApiV1AppendExecutionUpdateExecutor",
      "appendApiV1ExecutionUpdate",
      "readBoundedJson",
      "api_v1_append_execution_update",
      "createClient",
      "service_role",
      "SERVICE_ROLE",
      "Deno.env",
      ".from(",
    ]
  ) {
    assert(!source.includes(needle), `router.ts must not contain: ${needle}`);
  }
});


Deno.test("API-I.9B/API-K.7: live handler dispatches mutations for exactly the accepted routes", async () => {
  const handler = await Deno.readTextFile(
    new URL("../handler.ts", import.meta.url),
  );
  assert(
    handler.includes(
      'method !== "GET" &&\n      method !== "POST" &&\n      method !== "PATCH" &&',
    ) &&
      handler.includes('method !== "PUT" &&') &&
      handler.includes('method !== "OPTIONS"'),
    "handler must allow exactly GET, POST, PATCH, PUT and OPTIONS",
  );
  // API-K.7 — PATCH is reachable only for the validated Risk update path.
  assert(handler.includes("parseApiV1RiskUpdatePath(url.pathname)"));
  assert(
    handler.includes(
      "if (url.pathname !== EXECUTION_UPDATES_APPEND_ROUTE.path) {",
    ),
    "POST must be restricted to the exact frozen mutation path",
  );
  assert(!handler.includes("EXECUTION_UPDATES_APPEND_ROUTE.method"));
});


Deno.test("exact GET /v1/projects matches PROJECTS_ROUTE", () => {
  assertStrictEquals(matchApiRoute("GET", "/v1/projects"), PROJECTS_ROUTE);
});

Deno.test("GET /v1/projects rejects other methods, case, slash, and extra segments", () => {
  for (
    // API-N.5 — POST /v1/projects is the accepted Project create command.
    const m of ["PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "get"]
  ) {
    assertStrictEquals(matchApiRoute(m, "/v1/projects"), null);
  }
  for (
    const p of [
      "/v1/Projects",
      "/V1/projects",
      "/v1/projects/",
      "/v1/projects/extra",
      "/v1/projects/123",
      " /v1/projects",
      "/v1/projects ",
      "/v1/projects?workspace_id=x",
      "//v1/projects",
      "/v1//projects",
      "/projects",
    ]
  ) {
    assertStrictEquals(matchApiRoute("GET", p), null);
  }
});

Deno.test("exact GET /v1/workspaces matches WORKSPACES_ROUTE", () => {
  assertStrictEquals(matchApiRoute("GET", "/v1/workspaces"), WORKSPACES_ROUTE);
});

Deno.test("GET /v1/workspaces rejects other methods, case, slash, segments, whitespace, query text", () => {
  for (const m of ["POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "get"]) {
    assertStrictEquals(matchApiRoute(m, "/v1/workspaces"), null);
  }
  for (
    const p of [
      "/v1/Workspaces",
      "/V1/workspaces",
      "/v1/workspaces/",
      "/v1/workspaces/extra",
      "/v1/workspaces/123",
      " /v1/workspaces",
      "/v1/workspaces ",
      "/v1/workspaces?organization_id=x",
      "//v1/workspaces",
      "/v1//workspaces",
      "/workspaces",
    ]
  ) {
    assertStrictEquals(matchApiRoute("GET", p), null);
  }
});

Deno.test("allowlist is frozen", () => {
  assert(Object.isFrozen(API_V1_ROUTE_ALLOWLIST));
  assertThrows(() => {
    (API_V1_ROUTE_ALLOWLIST as ApiRouteDefinition[]).push(VERSION_ROUTE);
  });
});

Deno.test("route IDs are unique", () => {
  const ids = API_V1_ROUTE_ALLOWLIST.map((r) => r.id);
  assertEquals(new Set(ids).size, ids.length);
});

Deno.test("method/path pairs are unique", () => {
  const pairs = API_V1_ROUTE_ALLOWLIST.map((r) => `${r.method} ${r.path}`);
  assertEquals(new Set(pairs).size, pairs.length);
});

Deno.test("exact GET /v1/version matches", () => {
  assertStrictEquals(matchApiRoute("GET", "/v1/version"), VERSION_ROUTE);
});

Deno.test("exact GET /v1/capabilities matches", () => {
  assertStrictEquals(
    matchApiRoute("GET", "/v1/capabilities"),
    CAPABILITIES_ROUTE,
  );
});

Deno.test("exact GET /v1/me matches", () => {
  assertStrictEquals(matchApiRoute("GET", "/v1/me"), ME_ROUTE);
});

Deno.test("GET /v1/me rejects case, slash, query, fragment, prefix, whitespace", () => {
  for (
    const p of [
      "/v1/ME",
      "/V1/me",
      "/v1/Me",
      "/v1/me/",
      "/v1/me?x=1",
      "/v1/me#f",
      "/v1/me/extra",
      " /v1/me",
      "/v1/me ",
    ]
  ) {
    assertStrictEquals(matchApiRoute("GET", p), null);
  }
  for (const m of ["POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "get"]) {
    assertStrictEquals(matchApiRoute(m, "/v1/me"), null);
  }
});

Deno.test("returned definitions are the frozen allowlist instances", () => {
  assertStrictEquals(matchApiRoute("GET", "/v1/version"), API_V1_ROUTE_ALLOWLIST[0]);
  assertStrictEquals(
    matchApiRoute("GET", "/v1/capabilities"),
    API_V1_ROUTE_ALLOWLIST[1],
  );
});

Deno.test("unsupported methods return null", () => {
  for (const m of ["POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"]) {
    assertStrictEquals(matchApiRoute(m, "/v1/version"), null);
    assertStrictEquals(matchApiRoute(m, "/v1/capabilities"), null);
  }
});

Deno.test("unsupported paths return null", () => {
  for (
    const p of [
      "/v1",
      "/v1/",
      "/v1/unknown",
      "/v2/version",
      "/version",
      "",
      "/",
    ]
  ) {
    assertStrictEquals(matchApiRoute("GET", p), null);
  }
});

Deno.test("no normalization: case, trailing slash, query, prefix, whitespace", () => {
  const rejected: Array<[string, string]> = [
    ["get", "/v1/version"],
    ["Get", "/v1/version"],
    ["GET ", "/v1/version"],
    [" GET", "/v1/version"],
    ["GET", "/V1/version"],
    ["GET", "/v1/Version"],
    ["GET", "/v1/version/"],
    ["GET", "/v1/version?x=1"],
    ["GET", "/v1/version#frag"],
    ["GET", " /v1/version"],
    ["GET", "/v1/version "],
    ["GET", "/v1/capabilities/"],
    ["GET", "/v1/capabilities?"],
    ["GET", "/v1/version/extra"],
  ];
  for (const [m, p] of rejected) {
    assertStrictEquals(matchApiRoute(m, p), null, `${m} ${p}`);
  }
});

Deno.test("non-string runtime inputs throw internal_error", () => {
  const bad: unknown[] = [null, undefined, 1, {}, [], true, false];
  for (const v of bad) {
    assertThrows(
      () => matchApiRoute(v as string, "/v1/version"),
      ApiHttpError,
    );
    assertThrows(
      () => matchApiRoute("GET", v as string),
      ApiHttpError,
    );
  }
});

Deno.test("buildVersionPayload returns exact two fields", () => {
  const p = buildVersionPayload();
  assertEquals(p, { service: "btpm-api", apiVersion: "v1" });
  assertEquals(Object.keys(p).sort(), ["apiVersion", "service"]);
});

Deno.test("version payloads are frozen and newly constructed per call", () => {
  const a = buildVersionPayload();
  const b = buildVersionPayload();
  assert(Object.isFrozen(a));
  assert(Object.isFrozen(b));
  assertNotStrictEquals(a, b);
  assertThrows(() => {
    (a as unknown as { service: string }).service = "other";
  });
});

// API-N.6-C1 — this historical foundation test asserts ONLY the stable
// capabilities envelope. The complete current operation order, cardinality and
// allowlist parity are owned solely by
// `__tests__/api-v1-current-surface-topology.test.ts`.
Deno.test("buildCapabilitiesPayload returns the exact stable envelope shape", () => {
  const p = buildCapabilitiesPayload();
  assertEquals(p.service, "btpm-api");
  assertEquals(p.apiVersion, "v1");
  assert(Array.isArray(p.supportedOperations));
  assert(p.supportedOperations.length > 0);
  assertEquals(Object.keys(p).sort(), [
    "apiVersion",
    "service",
    "supportedOperations",
  ]);
});


Deno.test("capabilities payloads and operation arrays are frozen", () => {
  const p = buildCapabilitiesPayload();
  assert(Object.isFrozen(p));
  assert(Object.isFrozen(p.supportedOperations));
  assertThrows(() => {
    (p.supportedOperations as unknown as string[]).push("x");
  });
});

Deno.test("capabilities payloads are newly constructed per call", () => {
  const a = buildCapabilitiesPayload();
  const b = buildCapabilitiesPayload();
  assertNotStrictEquals(a, b);
  assertNotStrictEquals(a.supportedOperations, b.supportedOperations);
});

Deno.test("payloads contain no forbidden fields", () => {
  const forbidden = [
    "releaseVersion",
    "release",
    "buildTimestamp",
    "commit",
    "commitSha",
    "environment",
    "user",
    "userId",
    "client",
    "clientId",
    "organizationId",
    "workspaceId",
    "grants",
    "rateLimit",
    "secret",
    "databaseId",
    "timestamp",
  ];
  const v = buildVersionPayload() as unknown as Record<string, unknown>;
  const c = buildCapabilitiesPayload() as unknown as Record<string, unknown>;
  for (const k of forbidden) {
    assert(!(k in v), `version contains ${k}`);
    assert(!(k in c), `capabilities contains ${k}`);
  }
});

Deno.test("runtime-control parsing remains unchanged", () => {
  assertEquals({ ...parseApiRuntimeControls(undefined) }, {
    apiEnabled: false,
    readsEnabled: false,
    mutationsEnabled: false,
  });
  const r = parseApiRuntimeControls({
    BTPM_API_ENABLED: "true",
    BTPM_API_READS_ENABLED: "true",
    BTPM_API_MUTATIONS_ENABLED: "true",
  });
  assertEquals({ ...r }, {
    apiEnabled: true,
    readsEnabled: true,
    mutationsEnabled: true,
  });
  assertStrictEquals(isApiOperationEnabled(r, "read"), true);
  assertStrictEquals(isApiOperationEnabled(r, "mutation"), true);
});

Deno.test("implementation files contain no forbidden runtime surface", async () => {
  const files = [
    new URL("../routes/version.ts", import.meta.url),
    new URL("../routes/capabilities.ts", import.meta.url),
    new URL("../routes/me.ts", import.meta.url),
    new URL("../routes/organizations.ts", import.meta.url),
    new URL("../routes/workspaces.ts", import.meta.url),
    new URL("../router.ts", import.meta.url),
  ];
  const forbidden = [
    "Deno.env",
    "process.env",
    "Deno.serve",
    "fetch(",
    "createClient",
    "service_role",
    "SERVICE_ROLE",
    "setTimeout",
    "setInterval",
    "console.log",
    "console.error",
    "console.warn",
  ];
  for (const url of files) {
    const src = await Deno.readTextFile(url);
    for (const needle of forbidden) {
      assert(!src.includes(needle), `${url.pathname} contains ${needle}`);
    }
  }
});

// -----------------------------------------------------------------------------
// API-G.1J — Fail-closed route access and payload dispatch.
// -----------------------------------------------------------------------------

const ALL_ENABLED: ApiRuntimeControls = parseApiRuntimeControls({
  BTPM_API_ENABLED: "true",
  BTPM_API_READS_ENABLED: "true",
  BTPM_API_MUTATIONS_ENABLED: "true",
});
const READS_ONLY: ApiRuntimeControls = parseApiRuntimeControls({
  BTPM_API_ENABLED: "true",
  BTPM_API_READS_ENABLED: "true",
  BTPM_API_MUTATIONS_ENABLED: "false",
});
const MUTATIONS_ONLY: ApiRuntimeControls = parseApiRuntimeControls({
  BTPM_API_ENABLED: "true",
  BTPM_API_READS_ENABLED: "false",
  BTPM_API_MUTATIONS_ENABLED: "true",
});
const GLOBAL_DISABLED: ApiRuntimeControls = parseApiRuntimeControls({
  BTPM_API_ENABLED: "false",
  BTPM_API_READS_ENABLED: "false",
  BTPM_API_MUTATIONS_ENABLED: "false",
});

Deno.test("resolveApiRouteAccess returns exact VERSION_ROUTE when reads enabled", () => {
  assertStrictEquals(
    resolveApiRouteAccess("GET", "/v1/version", ALL_ENABLED),
    API_V1_ROUTE_ALLOWLIST[0],
  );
});

Deno.test("resolveApiRouteAccess returns exact CAPABILITIES_ROUTE when reads enabled", () => {
  assertStrictEquals(
    resolveApiRouteAccess("GET", "/v1/capabilities", ALL_ENABLED),
    API_V1_ROUTE_ALLOWLIST[1],
  );
});

Deno.test("resolveApiRouteAccess returns exact ME_ROUTE when reads enabled", () => {
  assertStrictEquals(resolveApiRouteAccess("GET", "/v1/me", ALL_ENABLED), ME_ROUTE);
  assertStrictEquals(resolveApiRouteAccess("GET", "/v1/me", READS_ONLY), ME_ROUTE);
});

Deno.test("read switches govern me.get identically to other reads", () => {
  for (const ctls of [MUTATIONS_ONLY, GLOBAL_DISABLED]) {
    for (const path of ["/v1/version", "/v1/capabilities", "/v1/me"]) {
      const e = assertThrows(
        () => resolveApiRouteAccess("GET", path, ctls),
        ApiHttpError,
      ) as ApiHttpError;
      assertEquals(e.code, "api_unavailable");
    }
  }
});

Deno.test("resolveApiRouteAccess allows reads when only reads enabled", () => {
  assertStrictEquals(
    resolveApiRouteAccess("GET", "/v1/version", READS_ONLY),
    API_V1_ROUTE_ALLOWLIST[0],
  );
  assertStrictEquals(
    resolveApiRouteAccess("GET", "/v1/capabilities", READS_ONLY),
    API_V1_ROUTE_ALLOWLIST[1],
  );
});

Deno.test("resolveApiRouteAccess throws api_unavailable when global API disabled", () => {
  for (const path of ["/v1/version", "/v1/capabilities"]) {
    try {
      resolveApiRouteAccess("GET", path, GLOBAL_DISABLED);
      throw new Error("expected throw");
    } catch (e) {
      assert(e instanceof ApiHttpError);
      assertEquals(e.code, "api_unavailable");
      assertEquals(e.status, 503);
    }
  }
});

Deno.test("resolveApiRouteAccess throws api_unavailable when reads disabled", () => {
  for (const path of ["/v1/version", "/v1/capabilities"]) {
    try {
      resolveApiRouteAccess("GET", path, MUTATIONS_ONLY);
      throw new Error("expected throw");
    } catch (e) {
      assert(e instanceof ApiHttpError);
      assertEquals(e.code, "api_unavailable");
    }
  }
});

Deno.test("resolveApiRouteAccess: mutation switch does not block enabled reads", () => {
  assertStrictEquals(
    resolveApiRouteAccess("GET", "/v1/version", READS_ONLY),
    API_V1_ROUTE_ALLOWLIST[0],
  );
});

Deno.test("resolveApiRouteAccess throws route_not_found for unsupported methods", () => {
  for (const m of ["POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
    try {
      resolveApiRouteAccess(m, "/v1/version", ALL_ENABLED);
      throw new Error("expected throw");
    } catch (e) {
      assert(e instanceof ApiHttpError);
      assertEquals(e.code, "route_not_found");
      assertEquals(e.status, 404);
    }
  }
});

Deno.test("resolveApiRouteAccess throws route_not_found for unsupported paths", () => {
  for (const p of ["/v1", "/v1/", "/v1/unknown", "/v2/version", "/version", "", "/"]) {
    try {
      resolveApiRouteAccess("GET", p, ALL_ENABLED);
      throw new Error("expected throw");
    } catch (e) {
      assert(e instanceof ApiHttpError);
      assertEquals(e.code, "route_not_found");
    }
  }
});

Deno.test("resolveApiRouteAccess: no normalization of case, slashes, query, whitespace", () => {
  const rejected: Array<[string, string]> = [
    ["get", "/v1/version"],
    ["GET", "/V1/version"],
    ["GET", "/v1/version/"],
    ["GET", "/v1/version?x=1"],
    ["GET", " /v1/version"],
    ["GET", "/v1/version "],
    ["GET", "/v1/capabilities/"],
    ["GET", "/v1/version/extra"],
  ];
  for (const [m, p] of rejected) {
    try {
      resolveApiRouteAccess(m, p, ALL_ENABLED);
      throw new Error(`expected throw for ${m} ${p}`);
    } catch (e) {
      assert(e instanceof ApiHttpError);
      assertEquals(e.code, "route_not_found");
    }
  }
});

Deno.test("resolveApiRouteAccess: non-string runtime inputs retain internal_error", () => {
  const bad: unknown[] = [null, undefined, 1, {}, [], true, false];
  for (const v of bad) {
    assertThrows(
      () => resolveApiRouteAccess(v as string, "/v1/version", ALL_ENABLED),
      ApiHttpError,
    );
    assertThrows(
      () => resolveApiRouteAccess("GET", v as string, ALL_ENABLED),
      ApiHttpError,
    );
  }
});

Deno.test("resolveApiRouteAccess: malformed controls retain internal_error", () => {
  const bad: unknown[] = [
    null,
    [],
    "x",
    1,
    {},
    { apiEnabled: true, readsEnabled: true, mutationsEnabled: "false" },
    { apiEnabled: false, readsEnabled: true, mutationsEnabled: false },
  ];
  for (const c of bad) {
    try {
      resolveApiRouteAccess("GET", "/v1/version", c as ApiRuntimeControls);
      throw new Error("expected throw");
    } catch (e) {
      assert(e instanceof ApiHttpError);
      assertEquals(e.code, "internal_error");
    }
  }
});

Deno.test("resolveApiRouteAccess errors expose no supplied method, path, or switches", () => {
  const secretPath = "/v1/SECRET-PATH-VALUE";
  const secretMethod = "SECRETMETHOD";
  try {
    resolveApiRouteAccess(secretMethod, secretPath, ALL_ENABLED);
  } catch (e) {
    assert(e instanceof ApiHttpError);
    const s = JSON.stringify(e.toSafeJSON("req-1"));
    assert(!s.includes("SECRET-PATH-VALUE"));
    assert(!s.includes("SECRETMETHOD"));
  }
  try {
    resolveApiRouteAccess("GET", "/v1/version", GLOBAL_DISABLED);
  } catch (e) {
    assert(e instanceof ApiHttpError);
    const s = JSON.stringify(e.toSafeJSON("req-2"));
    assert(!s.includes("apiEnabled"));
    assert(!s.includes("readsEnabled"));
    assert(!s.includes("true"));
    assert(!s.includes("false"));
  }
});

Deno.test("dispatchApiRoutePayload(VERSION_ROUTE) returns approved version payload", () => {
  const p = dispatchApiRoutePayload(VERSION_ROUTE);
  assertEquals(p, { service: "btpm-api", apiVersion: "v1" });
  assert(Object.isFrozen(p));
});

// API-N.7 — global operation order and cardinality are owned solely by
// `api-v1-current-surface-topology.test.ts`. This test asserts only the local
// dispatch contract: the capabilities route returns the frozen capabilities
// payload for the live route allowlist.
Deno.test("dispatchApiRoutePayload(CAPABILITIES_ROUTE) returns the approved capabilities payload", () => {
  const p = dispatchApiRoutePayload(CAPABILITIES_ROUTE) as {
    service: string;
    apiVersion: string;
    supportedOperations: readonly string[];
  };
  assertEquals(p.service, "btpm-api");
  assertEquals(p.apiVersion, "v1");
  assertEquals(p.supportedOperations, buildCapabilitiesPayload()
    .supportedOperations as readonly string[]);
  assert(Object.isFrozen(p));
});


Deno.test("dispatchApiRoutePayload returns distinct frozen objects per call", () => {
  const a = dispatchApiRoutePayload(VERSION_ROUTE);
  const b = dispatchApiRoutePayload(VERSION_ROUTE);
  assertNotStrictEquals(a, b);
  const c = dispatchApiRoutePayload(CAPABILITIES_ROUTE);
  const d = dispatchApiRoutePayload(CAPABILITIES_ROUTE);
  assertNotStrictEquals(c, d);
  assertNotStrictEquals(
    (c as { supportedOperations: readonly string[] }).supportedOperations,
    (d as { supportedOperations: readonly string[] }).supportedOperations,
  );
});

Deno.test("dispatchApiRoutePayload rejects copied VERSION_ROUTE with identical fields", () => {
  const copy = { ...VERSION_ROUTE } as unknown as ApiRouteDefinition;
  assertThrows(
    () => dispatchApiRoutePayload(copy),
    ApiHttpError,
  );
});

Deno.test("dispatchApiRoutePayload rejects copied CAPABILITIES_ROUTE with identical fields", () => {
  const copy = { ...CAPABILITIES_ROUTE } as unknown as ApiRouteDefinition;
  assertThrows(
    () => dispatchApiRoutePayload(copy),
    ApiHttpError,
  );
});

Deno.test("dispatchApiRoutePayload rejects null, arrays, primitives, and unknown route objects", () => {
  const bad: unknown[] = [
    null,
    undefined,
    [],
    {},
    "version.get",
    1,
    true,
    { id: "version.get", method: "GET", path: "/v1/version", operation: "read" },
    { id: "unknown.get", method: "GET", path: "/v1/unknown", operation: "read" },
    Object.freeze({
      id: "version.get",
      method: "GET",
      path: "/v1/version",
      operation: "read",
    }),
  ];
  for (const v of bad) {
    try {
      dispatchApiRoutePayload(v as ApiRouteDefinition);
      throw new Error("expected throw");
    } catch (e) {
      assert(e instanceof ApiHttpError);
      assertEquals(e.code, "internal_error");
    }
  }
});

Deno.test("resolveApiRouteAccess does not mutate allowlist, route constants, or controls", () => {
  const controlsSnapshot = { ...ALL_ENABLED };
  const versionSnapshot = { ...VERSION_ROUTE };
  const capsSnapshot = { ...CAPABILITIES_ROUTE };
  const listLength = API_V1_ROUTE_ALLOWLIST.length;
  resolveApiRouteAccess("GET", "/v1/version", ALL_ENABLED);
  resolveApiRouteAccess("GET", "/v1/capabilities", ALL_ENABLED);
  dispatchApiRoutePayload(VERSION_ROUTE);
  dispatchApiRoutePayload(CAPABILITIES_ROUTE);
  assertEquals({ ...ALL_ENABLED }, controlsSnapshot);
  assertEquals({ ...VERSION_ROUTE }, versionSnapshot);
  assertEquals({ ...CAPABILITIES_ROUTE }, capsSnapshot);
  assertEquals(API_V1_ROUTE_ALLOWLIST.length, listLength);
});


// -----------------------------------------------------------------------------
// API-G.1K — Protected route authentication and rate-limit pipeline.
// -----------------------------------------------------------------------------

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const UUID_C = "33333333-3333-4333-8333-333333333333";
const UUID_BAD = "not-a-uuid";
const OAUTH_ID = "oauth-client-abc";

function makeContext(overrides: Partial<{
  tokenUserId: string;
  tokenClientId: string;
  clientUserId: string;
  apiClientId: string;
  policyVersionId: string;
  oauthClientId: string;
  missingToken: boolean;
  missingClient: boolean;
  nullCtx: boolean;
}> = {}): AuthenticatedApiContext {
  if (overrides.nullCtx) return null as unknown as AuthenticatedApiContext;
  const token = overrides.missingToken
    ? undefined
    : {
        userId: overrides.tokenUserId ?? UUID_A,
        clientId: overrides.tokenClientId ?? OAUTH_ID,
      };
  const client = overrides.missingClient
    ? undefined
    : {
        userId: overrides.clientUserId ?? UUID_A,
        apiClientId: overrides.apiClientId ?? UUID_B,
        oauthClientId: overrides.oauthClientId ?? OAUTH_ID,
        policyVersionId: overrides.policyVersionId ?? UUID_C,
      };
  return { token, client } as unknown as AuthenticatedApiContext;
}

interface Trace {
  order: string[];
  authRequest: Request | null;
  authorizeArgs: { ctx: AuthenticatedApiContext; route: ApiRouteDefinition } | null;
  profileArgs: { ctx: AuthenticatedApiContext; route: ApiRouteDefinition } | null;
  storeInputs: ApiRateLimitStoreInput[];
  authCalls: number;
  authorizeCalls: number;
  profileCalls: number;
  clockCalls: number;
  readMeCalls: number;
  readMeArgs: { request: Request; context: AuthenticatedApiContext } | null;
  readWorkspacesCalls: number;
  readWorkspacesArgs: {
    request: Request;
    context: AuthenticatedApiContext;
    query: unknown;
  } | null;
  readProjectsCalls: number;
  readProjectsArgs: {
    request: Request;
    context: AuthenticatedApiContext;
    query: unknown;
  } | null;
  readProjectDetailCalls: number;
  readProjectDetailArgs: {
    request: Request;
    context: AuthenticatedApiContext;
    projectId: unknown;
  } | null;
  readProjectPlanningCalls: number;
  readProjectPlanningArgs: {
    request: Request;
    context: AuthenticatedApiContext;
    projectId: unknown;
  } | null;
}


function newTrace(): Trace {
  return {
    order: [],
    authRequest: null,
    authorizeArgs: null,
    profileArgs: null,
    storeInputs: [],
    authCalls: 0,
    authorizeCalls: 0,
    profileCalls: 0,
    clockCalls: 0,
    readMeCalls: 0,
    readMeArgs: null,
    readWorkspacesCalls: 0,
    readWorkspacesArgs: null,
    readProjectsCalls: 0,
    readProjectsArgs: null,
    readProjectDetailCalls: 0,
    readProjectDetailArgs: null,
    readProjectPlanningCalls: 0,
    readProjectPlanningArgs: null,

  };
}

interface FakeOptions {
  context?: AuthenticatedApiContext;
  authError?: unknown;
  authorizeError?: unknown;
  profile?: ApiRateLimitProfile;
  profileError?: unknown;
  storeResult?: ApiRateLimitStoreResult;
  storeError?: unknown;
  nowMs?: number;
  readMeError?: unknown;
  mePayload?: { readonly userId: string };
  readWorkspacesError?: unknown;
  workspacesPayload?: ApiV1WorkspacesPayload;
  readProjectsError?: unknown;
  projectsPayload?: ApiV1ProjectsPayload;
  readProjectDetailError?: unknown;
  projectDetailPayload?: ApiV1ProjectDetailPayload;
  readProjectPlanningError?: unknown;
  projectPlanningPayload?: ApiV1ProjectPlanningPayload;

}

const ME_PAYLOAD = Object.freeze({ userId: UUID_A });

const WORKSPACES_PAYLOAD: ApiV1WorkspacesPayload = Object.freeze({
  items: Object.freeze([
    Object.freeze({
      workspaceId: UUID_B,
      organizationId: UUID_C,
      name: "Delivery",
    }),
  ]),
  pagination: Object.freeze({ limit: 50, offset: 0, returned: 1, total: 1 }),
}) as ApiV1WorkspacesPayload;

const PROJECTS_PAYLOAD: ApiV1ProjectsPayload = Object.freeze({
  items: Object.freeze([
    Object.freeze({
      projectId: UUID_A,
      organizationId: UUID_C,
      workspaceId: UUID_B,
      name: "Migration",
      status: "active",
    }),
  ]),
  pagination: Object.freeze({ limit: 50, offset: 0, returned: 1, total: 1 }),
}) as unknown as ApiV1ProjectsPayload;

// API-H.4E — Synthetic 17-field Project-detail payload.
const PROJECT_DETAIL_PAYLOAD: ApiV1ProjectDetailPayload = Object.freeze({
  projectId: UUID_A,
  organizationId: UUID_C,
  workspaceId: UUID_B,
  programId: null,
  portfolioItemId: null,
  name: "Migration",
  description: null,
  status: "active",
  priority: "high",
  projectStage: null,
  deliveryModel: null,
  startDate: "2026-01-01",
  targetEndDate: "2026-06-30",
  actualStartDate: null,
  actualEndDate: null,
  agileEnabled: false,
  updatedAt: "2026-01-02T03:04:05.000Z",
}) as ApiV1ProjectDetailPayload;

const PROJECT_PLANNING_PAYLOAD: ApiV1ProjectPlanningPayload = Object.freeze({
  project: Object.freeze({
    projectId: UUID_A,
    name: "Migration",
    startDate: "2026-01-01",
    targetEndDate: "2026-06-30",
    actualStartDate: null,
    actualEndDate: null,
    isBaselined: false,
  }),
  phases: Object.freeze([]),
  tasks: Object.freeze([]),
  dependencies: Object.freeze([]),
}) as ApiV1ProjectPlanningPayload;


function makeDeps(
  trace: Trace,
  opts: FakeOptions = {},
): ApiProtectedRouteDependencies {
  const profile = opts.profile ?? { limit: 100, windowSeconds: 60 };
  const nowMs = opts.nowMs ?? 1_700_000_000_000;
  const storeResult = opts.storeResult ??
    { allowed: true, remaining: 99, resetAtEpochMs: nowMs + 60_000 };

  const rateLimit: ApiRateLimitDependencies = {
    store: {
      // deno-lint-ignore require-await
      async consume(input) {
        trace.order.push("store");
        trace.storeInputs.push(input);
        if (opts.storeError) throw opts.storeError;
        return storeResult;
      },
    },
    now() {
      trace.clockCalls++;
      return nowMs;
    },
  };

  return {
    // deno-lint-ignore require-await
    async authenticate(request) {
      trace.order.push("auth");
      trace.authCalls++;
      trace.authRequest = request;
      if (opts.authError) throw opts.authError;
      return ("context" in opts ? opts.context : makeContext()) as AuthenticatedApiContext;
    },
    // deno-lint-ignore require-await
    async authorizeRoute(ctx, route) {
      trace.order.push("authorize");
      trace.authorizeCalls++;
      trace.authorizeArgs = { ctx, route };
      if (opts.authorizeError) throw opts.authorizeError;
    },
    // deno-lint-ignore require-await
    async resolveRateLimitProfile(ctx, route) {
      trace.order.push("profile");
      trace.profileCalls++;
      trace.profileArgs = { ctx, route };
      if (opts.profileError) throw opts.profileError;
      return profile;
    },
    rateLimit,
    // deno-lint-ignore require-await
    async readMe(request, context) {
      trace.order.push("readMe");
      trace.readMeCalls++;
      trace.readMeArgs = { request, context };
      if (opts.readMeError) throw opts.readMeError;
      return (opts.mePayload ?? ME_PAYLOAD);
    },
    // deno-lint-ignore require-await
    async readOrganizations(_request, _context, _query) {
      trace.order.push("readOrganizations");
      throw new ApiHttpError("internal_error");
    },
    // deno-lint-ignore require-await
    async readWorkspaces(request, context, query) {
      trace.order.push("readWorkspaces");
      trace.readWorkspacesCalls++;
      trace.readWorkspacesArgs = { request, context, query };
      if (opts.readWorkspacesError) throw opts.readWorkspacesError;
      return (opts.workspacesPayload ?? WORKSPACES_PAYLOAD);
    },
    // deno-lint-ignore require-await
    async readProjects(request, context, query) {
      trace.order.push("readProjects");
      trace.readProjectsCalls++;
      trace.readProjectsArgs = { request, context, query };
      if (opts.readProjectsError) throw opts.readProjectsError;
      return (opts.projectsPayload ?? PROJECTS_PAYLOAD);
    },
    // deno-lint-ignore require-await
    async readProjectDetail(request, context, projectId) {
      trace.order.push("readProjectDetail");
      trace.readProjectDetailCalls++;
      trace.readProjectDetailArgs = { request, context, projectId };
      if (opts.readProjectDetailError) throw opts.readProjectDetailError;
      return (opts.projectDetailPayload ?? PROJECT_DETAIL_PAYLOAD);
    },
    // deno-lint-ignore require-await
    async readProjectPlanning(request, context, projectId) {
      trace.order.push("readProjectPlanning");
      trace.readProjectPlanningCalls++;
      trace.readProjectPlanningArgs = { request, context, projectId };
      if (opts.readProjectPlanningError) throw opts.readProjectPlanningError;
      return (opts.projectPlanningPayload ?? PROJECT_PLANNING_PAYLOAD);
    },
  };

}

const CTLS_ALL: ApiRuntimeControls = parseApiRuntimeControls({
  BTPM_API_ENABLED: "true",
  BTPM_API_READS_ENABLED: "true",
  BTPM_API_MUTATIONS_ENABLED: "true",
});
const CTLS_OFF: ApiRuntimeControls = parseApiRuntimeControls({
  BTPM_API_ENABLED: "false",
  BTPM_API_READS_ENABLED: "false",
  BTPM_API_MUTATIONS_ENABLED: "false",
});

function req(method: string, path: string): Request {
  return new Request(`https://example.test${path}`, { method });
}

Deno.test("executeApiProtectedRoute: successful version returns exact route and approved payload", async () => {
  const trace = newTrace();
  const deps = makeDeps(trace);
  const r = req("GET", "/v1/version");
  const result = await executeApiProtectedRoute(r, "/v1/version", CTLS_ALL, deps);
  assertStrictEquals(result.route, VERSION_ROUTE);
  assertEquals(result.payload, buildVersionPayload());
});

Deno.test("executeApiProtectedRoute: successful capabilities returns exact route and approved payload", async () => {
  const trace = newTrace();
  const deps = makeDeps(trace);
  const r = req("GET", "/v1/capabilities");
  const result = await executeApiProtectedRoute(r, "/v1/capabilities", CTLS_ALL, deps);
  assertStrictEquals(result.route, CAPABILITIES_ROUTE);
  assertEquals(result.payload, buildCapabilitiesPayload());
});

Deno.test("executeApiProtectedRoute: result and payload are frozen", async () => {
  const trace = newTrace();
  const deps = makeDeps(trace);
  const result = await executeApiProtectedRoute(
    req("GET", "/v1/capabilities"),
    "/v1/capabilities",
    CTLS_ALL,
    deps,
  );
  assert(Object.isFrozen(result));
  assert(Object.isFrozen(result.payload));
});

Deno.test("executeApiProtectedRoute: repeated calls return distinct result and payload objects", async () => {
  const trace = newTrace();
  const deps = makeDeps(trace);
  const a = await executeApiProtectedRoute(
    req("GET", "/v1/version"), "/v1/version", CTLS_ALL, deps,
  );
  const b = await executeApiProtectedRoute(
    req("GET", "/v1/version"), "/v1/version", CTLS_ALL, deps,
  );
  assertNotStrictEquals(a, b);
  assertNotStrictEquals(a.payload, b.payload);
});

Deno.test("executeApiProtectedRoute: dependency call order is auth → authorize → profile → store", async () => {
  const trace = newTrace();
  const deps = makeDeps(trace);
  await executeApiProtectedRoute(
    req("GET", "/v1/version"), "/v1/version", CTLS_ALL, deps,
  );
  assertEquals(trace.order, ["auth", "authorize", "profile", "store"]);
});

Deno.test("executeApiProtectedRoute: authenticate is called exactly once with the exact Request", async () => {
  const trace = newTrace();
  const deps = makeDeps(trace);
  const r = req("GET", "/v1/version");
  await executeApiProtectedRoute(r, "/v1/version", CTLS_ALL, deps);
  assertEquals(trace.authCalls, 1);
  assertStrictEquals(trace.authRequest, r);
});

Deno.test("executeApiProtectedRoute: authorize/profile receive exact context and route instances", async () => {
  const trace = newTrace();
  const ctx = makeContext();
  const deps = makeDeps(trace, { context: ctx });
  await executeApiProtectedRoute(
    req("GET", "/v1/version"), "/v1/version", CTLS_ALL, deps,
  );
  assertEquals(trace.authorizeCalls, 1);
  assertEquals(trace.profileCalls, 1);
  assertStrictEquals(trace.authorizeArgs!.ctx, ctx);
  assertStrictEquals(trace.authorizeArgs!.route, VERSION_ROUTE);
  assertStrictEquals(trace.profileArgs!.ctx, ctx);
  assertStrictEquals(trace.profileArgs!.route, VERSION_ROUTE);
});

Deno.test("executeApiProtectedRoute: store receives exact ids, profile and clock value", async () => {
  const trace = newTrace();
  const ctx = makeContext();
  const profile = { limit: 42, windowSeconds: 15 };
  const nowMs = 1_800_000_000_000;
  const deps = makeDeps(trace, {
    context: ctx,
    profile,
    nowMs,
    storeResult: { allowed: true, remaining: 41, resetAtEpochMs: nowMs + 15_000 },
  });
  await executeApiProtectedRoute(
    req("GET", "/v1/capabilities"), "/v1/capabilities", CTLS_ALL, deps,
  );
  assertEquals(trace.storeInputs.length, 1);
  const input = trace.storeInputs[0];
  assertEquals(input.apiClientId, ctx.client.apiClientId);
  assertEquals(input.userId, ctx.token.userId);
  assertEquals(input.routeId, "capabilities.get");
  assertEquals(input.limit, 42);
  assertEquals(input.windowSeconds, 15);
  assertEquals(input.nowEpochMs, nowMs);
});

Deno.test("executeApiProtectedRoute: unsupported route fails before dependencies", async () => {
  const trace = newTrace();
  const deps = makeDeps(trace);
  try {
    await executeApiProtectedRoute(
      req("POST", "/v1/version"), "/v1/version", CTLS_ALL, deps,
    );
    throw new Error("expected throw");
  } catch (e) {
    assert(e instanceof ApiHttpError);
    assertEquals(e.code, "route_not_found");
  }
  assertEquals(trace.order, []);
});

Deno.test("executeApiProtectedRoute: disabled API fails before dependencies", async () => {
  const trace = newTrace();
  const deps = makeDeps(trace);
  try {
    await executeApiProtectedRoute(
      req("GET", "/v1/version"), "/v1/version", CTLS_OFF, deps,
    );
    throw new Error("expected throw");
  } catch (e) {
    assert(e instanceof ApiHttpError);
    assertEquals(e.code, "api_unavailable");
  }
  assertEquals(trace.order, []);
});

Deno.test("executeApiProtectedRoute: preserves ApiAuthenticationError from authenticate", async () => {
  const trace = newTrace();
  const authError = new ApiAuthenticationError("invalid_token");
  const deps = makeDeps(trace, { authError });
  try {
    await executeApiProtectedRoute(
      req("GET", "/v1/version"), "/v1/version", CTLS_ALL, deps,
    );
    throw new Error("expected throw");
  } catch (e) {
    assertStrictEquals(e, authError);
  }
  assertEquals(trace.authorizeCalls, 0);
});

Deno.test("executeApiProtectedRoute: preserves ApiHttpError from authenticate", async () => {
  const trace = newTrace();
  const err = new ApiHttpError("invalid_request");
  const deps = makeDeps(trace, { authError: err });
  try {
    await executeApiProtectedRoute(
      req("GET", "/v1/version"), "/v1/version", CTLS_ALL, deps,
    );
    throw new Error("expected throw");
  } catch (e) {
    assertStrictEquals(e, err);
  }
});

Deno.test("executeApiProtectedRoute: unknown authenticate failure maps to internal_error", async () => {
  const trace = newTrace();
  const deps = makeDeps(trace, { authError: new Error("boom") });
  try {
    await executeApiProtectedRoute(
      req("GET", "/v1/version"), "/v1/version", CTLS_ALL, deps,
    );
    throw new Error("expected throw");
  } catch (e) {
    assert(e instanceof ApiHttpError);
    assertEquals(e.code, "internal_error");
  }
});

const MALFORMED_CONTEXTS: Array<[string, AuthenticatedApiContext]> = [
  ["null", makeContext({ nullCtx: true })],
  ["missing token", makeContext({ missingToken: true })],
  ["missing client", makeContext({ missingClient: true })],
  ["malformed user UUID", makeContext({ tokenUserId: UUID_BAD, clientUserId: UUID_BAD })],
  ["mismatched token/client user", makeContext({ tokenUserId: UUID_A, clientUserId: UUID_B })],
  ["malformed api client UUID", makeContext({ apiClientId: UUID_BAD })],
  ["malformed policy version UUID", makeContext({ policyVersionId: UUID_BAD })],
  ["malformed oauth client id", makeContext({ tokenClientId: "", oauthClientId: "" })],
  ["mismatched oauth client ids", makeContext({ tokenClientId: "oauth-a", oauthClientId: "oauth-b" })],
];

for (const [label, ctx] of MALFORMED_CONTEXTS) {
  Deno.test(`executeApiProtectedRoute: malformed context (${label}) fails before authorize/profile/store`, async () => {
    const trace = newTrace();
    const deps = makeDeps(trace, { context: ctx });
    try {
      await executeApiProtectedRoute(
        req("GET", "/v1/version"), "/v1/version", CTLS_ALL, deps,
      );
      throw new Error("expected throw");
    } catch (e) {
      assert(e instanceof ApiHttpError);
      assertEquals(e.code, "internal_error");
    }
    assertEquals(trace.authorizeCalls, 0);
    assertEquals(trace.profileCalls, 0);
    assertEquals(trace.storeInputs.length, 0);
  });
}

Deno.test("executeApiProtectedRoute: preserves authorize ApiAuthenticationError", async () => {
  const trace = newTrace();
  const err = new ApiAuthenticationError("client_disabled");
  const deps = makeDeps(trace, { authorizeError: err });
  try {
    await executeApiProtectedRoute(
      req("GET", "/v1/version"), "/v1/version", CTLS_ALL, deps,
    );
    throw new Error("expected throw");
  } catch (e) {
    assertStrictEquals(e, err);
  }
  assertEquals(trace.profileCalls, 0);
  assertEquals(trace.storeInputs.length, 0);
});

Deno.test("executeApiProtectedRoute: preserves authorize ApiHttpError", async () => {
  const trace = newTrace();
  const err = new ApiHttpError("api_unavailable");
  const deps = makeDeps(trace, { authorizeError: err });
  try {
    await executeApiProtectedRoute(
      req("GET", "/v1/version"), "/v1/version", CTLS_ALL, deps,
    );
    throw new Error("expected throw");
  } catch (e) {
    assertStrictEquals(e, err);
  }
});

Deno.test("executeApiProtectedRoute: unknown authorize failure maps to internal_error", async () => {
  const trace = newTrace();
  const deps = makeDeps(trace, { authorizeError: new Error("nope") });
  try {
    await executeApiProtectedRoute(
      req("GET", "/v1/version"), "/v1/version", CTLS_ALL, deps,
    );
    throw new Error("expected throw");
  } catch (e) {
    assert(e instanceof ApiHttpError);
    assertEquals(e.code, "internal_error");
  }
  assertEquals(trace.profileCalls, 0);
  assertEquals(trace.storeInputs.length, 0);
});

Deno.test("executeApiProtectedRoute: preserves profile ApiHttpError; maps unknown to internal_error", async () => {
  const trace1 = newTrace();
  const httpErr = new ApiHttpError("internal_error");
  await (async () => {
    try {
      await executeApiProtectedRoute(
        req("GET", "/v1/version"), "/v1/version", CTLS_ALL,
        makeDeps(trace1, { profileError: httpErr }),
      );
      throw new Error("expected throw");
    } catch (e) {
      assertStrictEquals(e, httpErr);
    }
  })();
  assertEquals(trace1.storeInputs.length, 0);

  const trace2 = newTrace();
  try {
    await executeApiProtectedRoute(
      req("GET", "/v1/version"), "/v1/version", CTLS_ALL,
      makeDeps(trace2, { profileError: new Error("x") }),
    );
    throw new Error("expected throw");
  } catch (e) {
    assert(e instanceof ApiHttpError);
    assertEquals(e.code, "internal_error");
  }
  assertEquals(trace2.storeInputs.length, 0);
});

Deno.test("executeApiProtectedRoute: malformed resolved profile fails before store consumption", async () => {
  const trace = newTrace();
  const deps = makeDeps(trace, {
    profile: { limit: -1, windowSeconds: 60 } as unknown as ApiRateLimitProfile,
  });
  try {
    await executeApiProtectedRoute(
      req("GET", "/v1/version"), "/v1/version", CTLS_ALL, deps,
    );
    throw new Error("expected throw");
  } catch (e) {
    assert(e instanceof ApiHttpError);
    assertEquals(e.code, "internal_error");
  }
  assertEquals(trace.storeInputs.length, 0);
});

Deno.test("executeApiProtectedRoute: rate-limit denial propagates rate_limit_exceeded", async () => {
  const trace = newTrace();
  const deps = makeDeps(trace, {
    storeResult: { allowed: false, remaining: 0, resetAtEpochMs: 1_800_000_060_000 },
    nowMs: 1_800_000_000_000,
  });
  try {
    await executeApiProtectedRoute(
      req("GET", "/v1/version"), "/v1/version", CTLS_ALL, deps,
    );
    throw new Error("expected throw");
  } catch (e) {
    assert(e instanceof ApiHttpError);
    assertEquals(e.code, "rate_limit_exceeded");
  }
});

Deno.test("executeApiProtectedRoute: rate-limit store failure wraps to internal_error", async () => {
  const trace = newTrace();
  const deps = makeDeps(trace, { storeError: new Error("db-down") });
  try {
    await executeApiProtectedRoute(
      req("GET", "/v1/version"), "/v1/version", CTLS_ALL, deps,
    );
    throw new Error("expected throw");
  } catch (e) {
    assert(e instanceof ApiHttpError);
    assertEquals(e.code, "internal_error");
  }
});

Deno.test("executeApiProtectedRoute: result contains no rate counters or reset timestamps", async () => {
  const trace = newTrace();
  const deps = makeDeps(trace);
  const result = await executeApiProtectedRoute(
    req("GET", "/v1/version"), "/v1/version", CTLS_ALL, deps,
  );
  assertEquals(Object.keys(result).sort(), ["activityIdentity", "payload", "route"]);
  assertEquals(Object.keys(result.activityIdentity).sort(), ["actorUserId", "apiClientId"]);
  const s = JSON.stringify(result);
  assert(!s.includes("remaining"));
  assert(!s.includes("resetAt"));
});

Deno.test("executeApiProtectedRoute: does not mutate controls, deps, route or context", async () => {
  const trace = newTrace();
  const ctx = makeContext();
  const ctxSnap = JSON.stringify(ctx);
  const deps = makeDeps(trace, { context: ctx });
  const depsKeys = Object.keys(deps).sort();
  const controlsSnap = { ...CTLS_ALL };
  const routeSnap = { ...VERSION_ROUTE };
  await executeApiProtectedRoute(
    req("GET", "/v1/version"), "/v1/version", CTLS_ALL, deps,
  );
  assertEquals(JSON.stringify(ctx), ctxSnap);
  assertEquals({ ...CTLS_ALL }, controlsSnap);
  assertEquals({ ...VERSION_ROUTE }, routeSnap);
  assertEquals(Object.keys(deps).sort(), depsKeys);
});

Deno.test("executeApiProtectedRoute: malformed dependency objects fail with internal_error", async () => {
  const trace = newTrace();
  const good = makeDeps(trace);
  const bad: unknown[] = [
    null,
    undefined,
    [],
    "x",
    1,
    {},
    { ...good, authenticate: "no" },
    { ...good, authorizeRoute: null },
    { ...good, resolveRateLimitProfile: 5 },
    { ...good, rateLimit: null },
    { ...good, rateLimit: "x" },
    { ...good, readMe: null },
    { ...good, readMe: "x" },
    { ...good, readWorkspaces: null },
    { ...good, readWorkspaces: "x" },
    { ...good, readWorkspaces: undefined },
    { ...good, readProjects: null },
    { ...good, readProjects: "x" },
    { ...good, readProjects: undefined },
    { ...good, readProjectDetail: null },
    { ...good, readProjectDetail: "x" },
    { ...good, readProjectDetail: undefined },
    { ...good, readProjectPlanning: null },
    { ...good, readProjectPlanning: "x" },
    { ...good, readProjectPlanning: undefined },

  ];
  for (const d of bad) {
    try {
      await executeApiProtectedRoute(
        req("GET", "/v1/version"),
        "/v1/version",
        CTLS_ALL,
        d as ApiProtectedRouteDependencies,
      );
      throw new Error("expected throw");
    } catch (e) {
      assert(e instanceof ApiHttpError);
      assertEquals(e.code, "internal_error");
    }
  }
});

Deno.test("executeApiProtectedRoute: malformed request or pathname throws internal_error", async () => {
  const trace = newTrace();
  const deps = makeDeps(trace);
  const badReqs: unknown[] = [null, undefined, {}, "GET", 1];
  for (const r of badReqs) {
    try {
      await executeApiProtectedRoute(
        r as Request, "/v1/version", CTLS_ALL, deps,
      );
      throw new Error("expected throw");
    } catch (e) {
      assert(e instanceof ApiHttpError);
      assertEquals(e.code, "internal_error");
    }
  }
  for (const p of [null, undefined, 1, {}, []]) {
    try {
      await executeApiProtectedRoute(
        req("GET", "/v1/version"), p as string, CTLS_ALL, deps,
      );
      throw new Error("expected throw");
    } catch (e) {
      assert(e instanceof ApiHttpError);
      assertEquals(e.code, "internal_error");
    }
  }
});


// -----------------------------------------------------------------------------
// API-G.2D — Protected GET /v1/me route.
// -----------------------------------------------------------------------------

Deno.test("executeApiProtectedRoute: /v1/me returns exact ME_ROUTE and reader payload", async () => {
  const trace = newTrace();
  const deps = makeDeps(trace);
  const result = await executeApiProtectedRoute(
    req("GET", "/v1/me"), "/v1/me", CTLS_ALL, deps,
  );
  assertStrictEquals(result.route, ME_ROUTE);
  assertStrictEquals(result.payload, ME_PAYLOAD);
  assertEquals(result.payload, { userId: UUID_A });
  assert(Object.isFrozen(result));
});

Deno.test("executeApiProtectedRoute: /v1/me order is auth → authorize → profile → store → readMe", async () => {
  const trace = newTrace();
  const deps = makeDeps(trace);
  await executeApiProtectedRoute(req("GET", "/v1/me"), "/v1/me", CTLS_ALL, deps);
  assertEquals(trace.order, ["auth", "authorize", "profile", "store", "readMe"]);
  assertEquals(trace.readMeCalls, 1);
  assertEquals(trace.storeInputs[0].routeId, "me.get");
});

Deno.test("executeApiProtectedRoute: readMe receives exact Request and authenticated context", async () => {
  const trace = newTrace();
  const ctx = makeContext();
  const deps = makeDeps(trace, { context: ctx });
  const r = req("GET", "/v1/me");
  await executeApiProtectedRoute(r, "/v1/me", CTLS_ALL, deps);
  assertStrictEquals(trace.readMeArgs!.request, r);
  assertStrictEquals(trace.readMeArgs!.context, ctx);
});

Deno.test("executeApiProtectedRoute: metadata routes never call readMe", async () => {
  const trace = newTrace();
  const deps = makeDeps(trace);
  await executeApiProtectedRoute(req("GET", "/v1/version"), "/v1/version", CTLS_ALL, deps);
  await executeApiProtectedRoute(
    req("GET", "/v1/capabilities"), "/v1/capabilities", CTLS_ALL, deps,
  );
  assertEquals(trace.readMeCalls, 0);
  assert(!trace.order.includes("readMe"));
});

Deno.test("executeApiProtectedRoute: readMe errors are preserved or fail closed", async () => {
  const cases: Array<[unknown, string, unknown]> = [
    [new ApiAuthenticationError("invalid_token"), "invalid_token", ApiAuthenticationError],
    [new ApiHttpError("not_authorized"), "not_authorized", ApiHttpError],
    [new ApiHttpError("internal_error"), "internal_error", ApiHttpError],
    ["boom", "internal_error", ApiHttpError],
    [{ weird: true }, "internal_error", ApiHttpError],
  ];
  for (const [thrown, code, ctor] of cases) {
    const trace = newTrace();
    const deps = makeDeps(trace, { readMeError: thrown });
    try {
      await executeApiProtectedRoute(req("GET", "/v1/me"), "/v1/me", CTLS_ALL, deps);
      throw new Error("expected throw");
    } catch (e) {
      assert(e instanceof (ctor as new () => Error));
      assertEquals((e as ApiHttpError).code, code);
    }
  }
});

Deno.test("executeApiProtectedRoute: no read occurs when a prior stage fails", async () => {
  const failures: FakeOptions[] = [
    { authError: new ApiAuthenticationError("invalid_token") },
    { authorizeError: new ApiHttpError("not_authorized") },
    { profileError: new ApiHttpError("internal_error") },
    { storeResult: { allowed: false, remaining: 0, resetAtEpochMs: 1 } },
    { storeError: new Error("db down") },
  ];
  for (const opts of failures) {
    const trace = newTrace();
    const deps = makeDeps(trace, opts);
    try {
      await executeApiProtectedRoute(req("GET", "/v1/me"), "/v1/me", CTLS_ALL, deps);
      throw new Error("expected throw");
    } catch (e) {
      assert(e instanceof ApiHttpError || e instanceof ApiAuthenticationError);
    }
    assertEquals(trace.readMeCalls, 0);
  }
});

Deno.test("executeApiProtectedRoute: /v1/me does not mutate context or payload", async () => {
  const trace = newTrace();
  const ctx = makeContext();
  const snap = JSON.stringify(ctx);
  const deps = makeDeps(trace, { context: ctx });
  const result = await executeApiProtectedRoute(
    req("GET", "/v1/me"), "/v1/me", CTLS_ALL, deps,
  );
  assertEquals(JSON.stringify(ctx), snap);
  assert(Object.isFrozen(result.payload));
  assertEquals(ME_PAYLOAD, { userId: UUID_A });
});

const WS_PATH = "/v1/workspaces";
const WS_QS = `?organization_id=${UUID_C}`;

Deno.test("executeApiProtectedRoute: /v1/workspaces succeeds and passes parsed query", async () => {
  const trace = newTrace();
  const deps = makeDeps(trace);
  const result = await executeApiProtectedRoute(
    req("GET", `${WS_PATH}${WS_QS}&limit=50`),
    WS_PATH,
    CTLS_ALL,
    deps,
  );
  assertStrictEquals(result.route, WORKSPACES_ROUTE);
  assertStrictEquals(result.payload, WORKSPACES_PAYLOAD);
  assertEquals(trace.readWorkspacesCalls, 1);
  assertEquals(trace.readWorkspacesArgs?.query, {
    organizationId: UUID_C,
    limit: 50,
    offset: 0,
    search: null,
  });
  assertEquals(trace.order, [
    "auth",
    "authorize",
    "profile",
    "store",
    "readWorkspaces",
  ]);
  assert(Object.isFrozen(result));
});

Deno.test("executeApiProtectedRoute: /v1/workspaces rejects malformed query before authentication", async () => {
  for (
    const qs of [
      "",
      "?organization_id=not-a-uuid",
      `?organization_id=${UUID_C}&organization_id=${UUID_C}`,
      `?organization_id=${UUID_C}&unknown=1`,
      `?organization_id=${UUID_C}&limit=0`,
      `?organization_id=${UUID_C}&limit=101`,
      `?organization_id=${UUID_C}&offset=-1`,
    ]
  ) {
    const trace = newTrace();
    const deps = makeDeps(trace);
    await assertRejects(
      () =>
        executeApiProtectedRoute(
          req("GET", `${WS_PATH}${qs}`),
          WS_PATH,
          CTLS_ALL,
          deps,
        ),
      ApiHttpError,
    );
    assertEquals(trace.authCalls, 0);
    assertEquals(trace.readWorkspacesCalls, 0);
  }
});

Deno.test("executeApiProtectedRoute: /v1/workspaces preserves reader failures", async () => {
  for (
    const err of [
      new ApiHttpError("not_authorized"),
      new ApiHttpError("invalid_request"),
      new Error("boom"),
    ]
  ) {
    const trace = newTrace();
    const deps = makeDeps(trace, { readWorkspacesError: err });
    await assertRejects(
      () =>
        executeApiProtectedRoute(
          req("GET", `${WS_PATH}${WS_QS}`),
          WS_PATH,
          CTLS_ALL,
          deps,
        ),
      ApiHttpError,
    );
    assertEquals(trace.readWorkspacesCalls, 1);
  }
});

Deno.test("executeApiProtectedRoute: /v1/workspaces does not call reader when earlier stages fail", async () => {
  const failures: FakeOptions[] = [
    { authError: new ApiHttpError("not_authorized") },
    { authorizeError: new ApiHttpError("not_authorized") },
    { profileError: new Error("no profile") },
    { storeError: new Error("db down") },
  ];
  for (const opts of failures) {
    const trace = newTrace();
    const deps = makeDeps(trace, opts);
    try {
      await executeApiProtectedRoute(
        req("GET", `${WS_PATH}${WS_QS}`),
        WS_PATH,
        CTLS_ALL,
        deps,
      );
      throw new Error("expected throw");
    } catch (e) {
      assert(e instanceof ApiHttpError || e instanceof ApiAuthenticationError);
    }
    assertEquals(trace.readWorkspacesCalls, 0);
  }
});

const PJ_PATH = "/v1/projects";
const PJ_QS = `?workspace_id=${UUID_B}`;

Deno.test("executeApiProtectedRoute: readProjects is a required dependency", async () => {
  const trace = newTrace();
  const good = makeDeps(trace);
  for (const bad of [null, "x", undefined, 1, {}]) {
    try {
      await executeApiProtectedRoute(
        req("GET", `${PJ_PATH}${PJ_QS}`),
        PJ_PATH,
        CTLS_ALL,
        { ...good, readProjects: bad } as unknown as
          ApiProtectedRouteDependencies,
      );
      throw new Error("expected throw");
    } catch (e) {
      assert(e instanceof ApiHttpError);
      assertEquals(e.code, "internal_error");
    }
  }
});

Deno.test("executeApiProtectedRoute: /v1/projects succeeds and passes parsed query", async () => {
  const trace = newTrace();
  const deps = makeDeps(trace);
  const result = await executeApiProtectedRoute(
    req("GET", `${PJ_PATH}${PJ_QS}&limit=25&offset=5&search=mig`),
    PJ_PATH,
    CTLS_ALL,
    deps,
  );
  assertStrictEquals(result.route, PROJECTS_ROUTE);
  assertStrictEquals(result.payload, PROJECTS_PAYLOAD);
  assertEquals(trace.readProjectsCalls, 1);
  assertEquals(trace.readProjectsArgs?.query, {
    workspaceId: UUID_B,
    limit: 25,
    offset: 5,
    search: "mig",
  });
  assertEquals(trace.order, [
    "auth",
    "authorize",
    "profile",
    "store",
    "readProjects",
  ]);
  assert(Object.isFrozen(result));
});

Deno.test("executeApiProtectedRoute: /v1/projects rejects malformed query before authentication", async () => {
  for (
    const qs of [
      "",
      "?workspace_id=not-a-uuid",
      `?workspace_id=${UUID_B}&workspace_id=${UUID_B}`,
      `?workspace_id=${UUID_B}&unknown=1`,
      `?workspace_id=${UUID_B}&limit=0`,
      `?workspace_id=${UUID_B}&limit=101`,
      `?workspace_id=${UUID_B}&offset=-1`,
    ]
  ) {
    const trace = newTrace();
    const deps = makeDeps(trace);
    await assertRejects(
      () =>
        executeApiProtectedRoute(
          req("GET", `${PJ_PATH}${qs}`),
          PJ_PATH,
          CTLS_ALL,
          deps,
        ),
      ApiHttpError,
    );
    assertEquals(trace.authCalls, 0);
    assertEquals(trace.readProjectsCalls, 0);
  }
});

Deno.test("executeApiProtectedRoute: /v1/projects preserves safe reader failures", async () => {
  for (
    const err of [
      new ApiHttpError("not_authorized"),
      new ApiHttpError("invalid_request"),
      new Error("boom"),
    ]
  ) {
    const trace = newTrace();
    const deps = makeDeps(trace, { readProjectsError: err });
    await assertRejects(
      () =>
        executeApiProtectedRoute(
          req("GET", `${PJ_PATH}${PJ_QS}`),
          PJ_PATH,
          CTLS_ALL,
          deps,
        ),
      ApiHttpError,
    );
    assertEquals(trace.readProjectsCalls, 1);
  }
});

Deno.test("executeApiProtectedRoute: /v1/projects does not call reader when earlier stages fail", async () => {
  const failures: FakeOptions[] = [
    { authError: new ApiHttpError("not_authorized") },
    { authorizeError: new ApiHttpError("not_authorized") },
    { profileError: new Error("no profile") },
    { storeError: new Error("db down") },
  ];
  for (const opts of failures) {
    const trace = newTrace();
    const deps = makeDeps(trace, opts);
    try {
      await executeApiProtectedRoute(
        req("GET", `${PJ_PATH}${PJ_QS}`),
        PJ_PATH,
        CTLS_ALL,
        deps,
      );
      throw new Error("expected throw");
    } catch (e) {
      assert(e instanceof ApiHttpError || e instanceof ApiAuthenticationError);
    }
    assertEquals(trace.readProjectsCalls, 0);
  }
});

// API-M.CP.5 — superseded assertion: global operation order and cardinality
// are owned solely by `api-v1-current-surface-topology.test.ts`. This test
// keeps only the local parity contract between the advertised operations and
// the live route allowlist.
Deno.test("API-M.CP.5: capabilities response advertises exactly the live allowlist order", () => {
  const p = buildCapabilitiesPayload();
  assertEquals(
    p.supportedOperations as readonly string[],
    API_V1_ROUTE_ALLOWLIST.map((r) => r.id) as readonly string[],
  );
});


// ===== API-H.4E — Project-detail route activation =====

const PD_UUID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const PD_PATH = `/v1/projects/${PD_UUID}`;

Deno.test("API-H.4E: PROJECT_DETAIL_ROUTE is the seventh frozen allowlist route", () => {
  assertStrictEquals(API_V1_ROUTE_ALLOWLIST[8], PROJECT_DETAIL_ROUTE);
  assertEquals(PROJECT_DETAIL_ROUTE.id, "projects.get_by_id");
  assertEquals(PROJECT_DETAIL_ROUTE.method, "GET");
  assertEquals(PROJECT_DETAIL_ROUTE.path, "/v1/projects/:projectid");
  assertEquals(PROJECT_DETAIL_ROUTE.operation, "read");
  assert(Object.isFrozen(PROJECT_DETAIL_ROUTE));
});

Deno.test("API-H.4E: valid Project-detail pathname matches the exact allowlist instance", () => {
  const matched = matchApiRoute("GET", PD_PATH);
  assertStrictEquals(matched, PROJECT_DETAIL_ROUTE);
  assertStrictEquals(matched, API_V1_ROUTE_ALLOWLIST[8]);
});

Deno.test("API-H.4E: malformed Project-detail paths and non-GET methods return null", () => {
  for (
    const p of [
      "/v1/projects/not-a-uuid",
      "/v1/projects/00000000-0000-0000-0000-000000000000",
      `${PD_PATH}/`,
      `${PD_PATH}/tasks`,
      `${PD_PATH}?x=1`,
      `${PD_PATH}#frag`,
      "/v1/projects/aaaaaaaa%2Dbbbb-4ccc-8ddd-eeeeeeeeeeee",
      `/V1/projects/${PD_UUID}`,
      `/v1/Projects/${PD_UUID}`,
      `${PD_PATH} `,
      ` ${PD_PATH}`,
      `/v1//projects/${PD_UUID}`,
      `/v1/projects//${PD_UUID}`,
    ]
  ) {
    assertStrictEquals(matchApiRoute("GET", p), null);
  }
  // API-N.6 superseded PATCH: it now resolves to the accepted Project update
  // command route, which the API-N.6 owner test asserts.
  for (
    const m of ["POST", "PUT", "DELETE", "HEAD", "OPTIONS", "get"]
  ) {
    assertStrictEquals(matchApiRoute(m, PD_PATH), null);
  }
});

Deno.test("API-H.4E: readProjectDetail is a required dependency", async () => {
  const trace = newTrace();
  const good = makeDeps(trace);
  for (const bad of [null, "x", undefined, 1, {}]) {
    try {
      await executeApiProtectedRoute(
        req("GET", PD_PATH),
        PD_PATH,
        CTLS_ALL,
        { ...good, readProjectDetail: bad } as unknown as
          ApiProtectedRouteDependencies,
      );
      throw new Error("expected throw");
    } catch (e) {
      assert(e instanceof ApiHttpError);
      assertEquals(e.code, "internal_error");
    }
  }
});

Deno.test("API-H.4E: Project path is parsed before authentication", async () => {
  for (const bad of [`${PD_PATH}?x=1`, `${PD_PATH}#frag`]) {
    const trace = newTrace();
    const deps = makeDeps(trace);
    await assertRejects(
      () =>
        executeApiProtectedRoute(
          req("GET", bad),
          PD_PATH,
          CTLS_ALL,
          deps,
        ),
      ApiHttpError,
    );
    assertEquals(trace.authCalls, 0);
    assertEquals(trace.readProjectDetailCalls, 0);
  }
});

Deno.test("API-H.4E: valid path dispatches the exact Project ID after authorization and rate limiting", async () => {
  const trace = newTrace();
  const deps = makeDeps(trace);
  const result = await executeApiProtectedRoute(
    req("GET", PD_PATH),
    PD_PATH,
    CTLS_ALL,
    deps,
  );
  assertStrictEquals(result.route, PROJECT_DETAIL_ROUTE);
  assertStrictEquals(result.payload, PROJECT_DETAIL_PAYLOAD);
  assertEquals(trace.readProjectDetailCalls, 1);
  assertStrictEquals(trace.readProjectDetailArgs?.projectId, PD_UUID);
  assertEquals(trace.order, [
    "auth",
    "authorize",
    "profile",
    "store",
    "readProjectDetail",
  ]);
  assert(Object.isFrozen(result));
  assertEquals(Object.keys(result).sort(), [
    "activityIdentity",
    "payload",
    "route",
  ]);
});

Deno.test("API-H.4E: Project-detail reader failures preserve safe mapping", async () => {
  for (
    const err of [
      new ApiHttpError("not_authorized"),
      new ApiHttpError("invalid_request"),
      new ApiHttpError("internal_error"),
      new Error("boom"),
    ]
  ) {
    const trace = newTrace();
    const deps = makeDeps(trace, { readProjectDetailError: err });
    await assertRejects(
      () =>
        executeApiProtectedRoute(
          req("GET", PD_PATH),
          PD_PATH,
          CTLS_ALL,
          deps,
        ),
      ApiHttpError,
    );
    assertEquals(trace.readProjectDetailCalls, 1);
  }
  const trace = newTrace();
  const authErr = new ApiAuthenticationError("invalid_token");
  const deps = makeDeps(trace, { readProjectDetailError: authErr });
  await assertRejects(
    () =>
      executeApiProtectedRoute(req("GET", PD_PATH), PD_PATH, CTLS_ALL, deps),
    ApiAuthenticationError,
  );
});

Deno.test("API-H.4E: Project-detail reader is not called when earlier stages fail", async () => {
  const failures: FakeOptions[] = [
    { authError: new ApiHttpError("not_authorized") },
    { authorizeError: new ApiHttpError("not_authorized") },
    { profileError: new Error("no profile") },
    { storeError: new Error("db down") },
  ];
  for (const opts of failures) {
    const trace = newTrace();
    const deps = makeDeps(trace, opts);
    try {
      await executeApiProtectedRoute(
        req("GET", PD_PATH),
        PD_PATH,
        CTLS_ALL,
        deps,
      );
      throw new Error("expected throw");
    } catch (e) {
      assert(e instanceof ApiHttpError || e instanceof ApiAuthenticationError);
    }
    assertEquals(trace.readProjectDetailCalls, 0);
  }
});



Deno.test("router.ts contains no forbidden runtime surface", async () => {
  const src = await Deno.readTextFile(new URL("../router.ts", import.meta.url));
  const forbidden = [
    "Deno.env",
    "process.env",
    "Deno.serve",
    "fetch(",
    "createClient",
    "service_role",
    "SERVICE_ROLE",
    "setTimeout",
    "setInterval",
    "console.log",
    "console.error",
    "console.warn",
    "new Response",
  ];
  for (const n of forbidden) {
    assert(!src.includes(n), `router.ts contains ${n}`);
  }
});
