// API-H.3A — Focused tests for the pure `/v1/projects` route and query parser.

import {
  assert,
  assertEquals,
  assertNotStrictEquals,
  assertStrictEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { ApiHttpError } from "../../_shared/btpm-api/http.ts";
import {
  parseApiV1ProjectsQuery,
  PROJECTS_ROUTE,
} from "../routes/projects.ts";

const UUID = "8f14e45f-ceea-467a-a4a7-2b4b0c7f4d21";

Deno.test("PROJECTS_ROUTE contract is exact and frozen", () => {
  assertStrictEquals(PROJECTS_ROUTE.id, "projects.get");
  assertStrictEquals(PROJECTS_ROUTE.method, "GET");
  assertStrictEquals(PROJECTS_ROUTE.path, "/v1/projects");
  assertStrictEquals(PROJECTS_ROUTE.operation, "read");
  assertEquals(Object.keys(PROJECTS_ROUTE).sort(), [
    "id",
    "method",
    "operation",
    "path",
  ]);
  assert(Object.isFrozen(PROJECTS_ROUTE));
});

Deno.test("minimal valid query parses with defaults and is frozen", () => {
  const parsed = parseApiV1ProjectsQuery(`?workspace_id=${UUID}`);
  assertEquals(parsed, {
    workspaceId: UUID,
    limit: 50,
    offset: 0,
    search: null,
  });
  assert(Object.isFrozen(parsed));
});

Deno.test("explicit limit, offset and search parse correctly", () => {
  const parsed = parseApiV1ProjectsQuery(
    `?workspace_id=${UUID}&limit=25&offset=10&search=hello+world%21`,
  );
  assertEquals(parsed, {
    workspaceId: UUID,
    limit: 25,
    offset: 10,
    search: "hello world!",
  });
});

Deno.test("separate valid calls return separate objects", () => {
  const a = parseApiV1ProjectsQuery(`?workspace_id=${UUID}`);
  const b = parseApiV1ProjectsQuery(`?workspace_id=${UUID}`);
  assertEquals(a, b);
  assertNotStrictEquals(a, b);
});

Deno.test("workspace_id is preserved without normalization", () => {
  const upper = UUID.toUpperCase();
  const parsed = parseApiV1ProjectsQuery(`?workspace_id=${upper}`);
  assertStrictEquals(parsed.workspaceId, upper);
});

Deno.test("workspace_id problems are rejected", () => {
  for (
    const raw of [
      "?limit=10",
      "?workspace_id=",
      "?workspace_id=not-a-uuid",
      `?workspace_id=%20${UUID}`,
      `?workspace_id=${UUID}%20`,
      `?workspace_id=${UUID}&workspace_id=${UUID}`,
      "?workspace_id=00000000-0000-0000-0000-000000000000",
    ]
  ) {
    assertThrows(
      () => parseApiV1ProjectsQuery(raw),
      ApiHttpError,
      "Request validation failed.",
    );
  }
});

Deno.test("unknown and duplicate parameters are rejected", () => {
  for (
    const raw of [
      `?workspace_id=${UUID}&unknown=1`,
      `?workspace_id=${UUID}&organization_id=${UUID}`,
      `?workspace_id=${UUID}&limit=10&limit=10`,
      `?workspace_id=${UUID}&offset=0&offset=0`,
      `?workspace_id=${UUID}&search=a&search=a`,
    ]
  ) {
    assertThrows(
      () => parseApiV1ProjectsQuery(raw),
      ApiHttpError,
      "Request validation failed.",
    );
  }
});

Deno.test("invalid pagination formats and ranges are rejected", () => {
  for (
    const raw of [
      "limit=abc",
      "limit=+1",
      "limit=-1",
      "limit=1.5",
      "limit=1e2",
      "limit=0x10",
      "limit=%201",
      "limit=0",
      "limit=101",
      "offset=-1",
      "offset=10001",
      "offset=1.0",
    ]
  ) {
    assertThrows(
      () => parseApiV1ProjectsQuery(`?workspace_id=${UUID}&${raw}`),
      ApiHttpError,
      "Request validation failed.",
    );
  }
  const boundary = parseApiV1ProjectsQuery(
    `?workspace_id=${UUID}&limit=1&offset=10000`,
  );
  assertEquals(boundary.limit, 1);
  assertEquals(boundary.offset, 10000);
  assertEquals(
    parseApiV1ProjectsQuery(`?workspace_id=${UUID}&limit=100&offset=0`).limit,
    100,
  );
});

Deno.test("search is trimmed, blank becomes null, over-length rejected", () => {
  assertStrictEquals(
    parseApiV1ProjectsQuery(
      `?workspace_id=${UUID}&search=%20%20alpha%20%20`,
    ).search,
    "alpha",
  );
  assertStrictEquals(
    parseApiV1ProjectsQuery(`?workspace_id=${UUID}&search=`).search,
    null,
  );
  assertStrictEquals(
    parseApiV1ProjectsQuery(`?workspace_id=${UUID}&search=+++`).search,
    null,
  );
  assertStrictEquals(
    parseApiV1ProjectsQuery(
      `?workspace_id=${UUID}&search=${"a".repeat(100)}`,
    ).search,
    "a".repeat(100),
  );
  assertThrows(
    () =>
      parseApiV1ProjectsQuery(
        `?workspace_id=${UUID}&search=${"a".repeat(101)}`,
      ),
    ApiHttpError,
    "Request validation failed.",
  );
});

Deno.test("raw query shape violations are rejected", () => {
  for (
    const raw of [
      "",
      `workspace_id=${UUID}`,
      `?workspace_id=${UUID}#fragment`,
      "?search=%ZZ&workspace_id=" + UUID,
    ]
  ) {
    assertThrows(
      () => parseApiV1ProjectsQuery(raw),
      ApiHttpError,
      "Request validation failed.",
    );
  }
});

Deno.test("non-string parser inputs throw internal_error", () => {
  for (const bad of [undefined, null, 123, {}, [], true]) {
    assertThrows(
      () => parseApiV1ProjectsQuery(bad as unknown as string),
      ApiHttpError,
      "Internal server error.",
    );
  }
});

Deno.test("projects.ts introduces no runtime, network, env, db or logging behavior", async () => {
  const source = await Deno.readTextFile(
    new URL("../routes/projects.ts", import.meta.url),
  );
  const forbidden = [
    "Deno.env",
    "createClient",
    "supabase",
    "SERVICE_ROLE",
    "service_role",
    "fetch(",
    "console.log",
    "console.warn",
    "console.error",
    "Deno.serve",
    "setTimeout",
    "setInterval",
    "router",
  ];
  for (const needle of forbidden) {
    assert(!source.includes(needle), `projects.ts must not contain: ${needle}`);
  }
});
