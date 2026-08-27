// API-M.4 — Focused tests for the pure Project-planning route contract,
// path parser and router matching. Synthetic UUIDs only.

import {
  assert,
  assertEquals,
  assertNotStrictEquals,
  assertStrictEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { ApiHttpError } from "../../_shared/btpm-api/http.ts";
import {
  PROJECT_PLANNING_ROUTE,
  parseApiV1ProjectPlanningPath,
} from "../routes/projectPlanning.ts";
import { PROJECT_DETAIL_ROUTE } from "../routes/projectDetail.ts";
import { API_V1_ROUTE_ALLOWLIST, matchApiRoute } from "../router.ts";
import { buildCapabilitiesPayload } from "../routes/capabilities.ts";

const UUID = "11111111-2222-4333-8444-555555555555";
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const PATH = `/v1/projects/${UUID}/planning`;

Deno.test("API-M.4: route contract is exact and frozen", () => {
  assertEquals(PROJECT_PLANNING_ROUTE, {
    id: "projects.planning.get",
    method: "GET",
    path: "/v1/projects/:projectid/planning",
    operation: "read",
  });
  assert(Object.isFrozen(PROJECT_PLANNING_ROUTE));
  assertThrows(() => {
    // deno-lint-ignore no-explicit-any
    (PROJECT_PLANNING_ROUTE as any).id = "projects.planning";
  });
});

Deno.test("API-M.4: route is the eighth allowlist entry and a read", () => {
  assertStrictEquals(API_V1_ROUTE_ALLOWLIST[9], PROJECT_PLANNING_ROUTE);
  assertEquals(PROJECT_PLANNING_ROUTE.operation, "read");
});

Deno.test("API-M.4: capabilities advertise the planning operation exactly once", () => {
  const ops = buildCapabilitiesPayload().supportedOperations;
  assertEquals(
    ops.filter((o) => o === "projects.planning.get").length,
    1,
  );
});

Deno.test("API-M.4: extracts a valid Project UUID", () => {
  const parsed = parseApiV1ProjectPlanningPath(PATH);
  assertEquals(parsed, { projectId: UUID });
  assertEquals(Object.keys(parsed), ["projectId"]);
  assert(Object.isFrozen(parsed));
});

Deno.test("API-M.4: repeated valid calls return distinct equal objects", () => {
  const a = parseApiV1ProjectPlanningPath(PATH);
  const b = parseApiV1ProjectPlanningPath(PATH);
  assertEquals(a, b);
  assertNotStrictEquals(a, b);
});

Deno.test("API-M.4: non-string input maps to internal_error", () => {
  for (const bad of [undefined, null, 0, 1, true, false, {}, [], Symbol("x")]) {
    const err = assertThrows(
      () => parseApiV1ProjectPlanningPath(bad as unknown as string),
      ApiHttpError,
    );
    assertEquals(err.code, "internal_error");
  }
});

function assertInvalid(pathname: string) {
  const err = assertThrows(
    () => parseApiV1ProjectPlanningPath(pathname),
    ApiHttpError,
  );
  assertEquals(err.code, "invalid_request");
}

Deno.test("API-M.4: malformed prefixes and suffixes reject", () => {
  for (
    const bad of [
      "",
      "/",
      "/v1/projects",
      "/v1/projects/planning",
      `/v1/projects/${UUID}`,
      `/v1/projects/${UUID}/planning/`,
      `/v1/projects/${UUID}/planning/tasks`,
      `/v1/projects/${UUID}/Planning`,
      `/v1/projects/${UUID}/plan`,
      `v1/projects/${UUID}/planning`,
      `/V1/projects/${UUID}/planning`,
      `/v2/projects/${UUID}/planning`,
      `/api/v1/projects/${UUID}/planning`,
      `/v1/workspaces/${UUID}/planning`,
      `/v1//projects/${UUID}/planning`,
      `/v1/projects//${UUID}/planning`,
    ]
  ) {
    assertInvalid(bad);
  }
});

Deno.test("API-M.4: invalid and nil UUIDs reject", () => {
  for (
    const bad of [
      "not-a-uuid",
      "11111111-2222-4333-8444-55555555555",
      "11111111-2222-6333-8444-555555555555",
      "11111111-2222-4333-c444-555555555555",
      NIL_UUID,
    ]
  ) {
    assertInvalid(`/v1/projects/${bad}/planning`);
  }
});

Deno.test("API-M.4: query, fragment, encoding and whitespace reject", () => {
  for (
    const bad of [
      `/v1/projects/${UUID}/planning?x=1`,
      `/v1/projects/${UUID}/planning#frag`,
      `/v1/projects/ ${UUID}/planning`,
      `/v1/projects/${UUID}\t/planning`,
      "/v1/projects/11111111%2D2222-4333-8444-555555555555/planning",
      `/v1/projects/${UUID};v=1/planning`,
      `/v1/projects/${UUID}\\extra/planning`,
    ]
  ) {
    assertInvalid(bad);
  }
});

Deno.test("API-M.4: router matches planning before Project detail", () => {
  assertStrictEquals(matchApiRoute("GET", PATH), PROJECT_PLANNING_ROUTE);
  assertStrictEquals(
    matchApiRoute("GET", `/v1/projects/${UUID}`),
    PROJECT_DETAIL_ROUTE,
  );
  assertEquals(matchApiRoute("POST", PATH), null);
  assertEquals(matchApiRoute("PATCH", PATH), null);
  assertEquals(matchApiRoute("DELETE", PATH), null);
  assertEquals(matchApiRoute("GET", `/v1/projects/${UUID}/planning/x`), null);
});

Deno.test("API-M.4: source contains no runtime, network, env or db behavior", async () => {
  const source = await Deno.readTextFile(
    new URL("../routes/projectPlanning.ts", import.meta.url),
  );
  const forbidden = [
    "Deno.env",
    "createClient",
    "supabase",
    "SERVICE_ROLE",
    "service_role",
    "fetch(",
    "rpc(",
    "Authorization",
    "Bearer",
    "console.log",
    "console.warn",
    "console.error",
    "setTimeout",
    "setInterval",
    "Deno.serve",
    "decodeURIComponent",
    "new Map(",
    "cache",
    "let ",
    "var ",
  ];
  for (const needle of forbidden) {
    assert(
      !source.includes(needle),
      `projectPlanning.ts must not contain: ${needle}`,
    );
  }
});
