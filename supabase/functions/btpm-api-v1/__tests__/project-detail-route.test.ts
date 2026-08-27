// API-H.4A — Focused tests for the pure Project-detail route contract
// and path parser. Synthetic UUIDs only.

import {
  assert,
  assertEquals,
  assertNotStrictEquals,
  assertStrictEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { ApiHttpError } from "../../_shared/btpm-api/http.ts";
import {
  PROJECT_DETAIL_ROUTE,
  parseApiV1ProjectDetailPath,
} from "../routes/projectDetail.ts";

const UUID = "11111111-2222-4333-8444-555555555555";
const UUID_UPPER = "11111111-2222-4333-8444-55555555555A";
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

Deno.test("route contract is exact and frozen", () => {
  assertEquals(PROJECT_DETAIL_ROUTE, {
    id: "projects.get_by_id",
    method: "GET",
    path: "/v1/projects/:projectid",
    operation: "read",
  });
  assert(Object.isFrozen(PROJECT_DETAIL_ROUTE));
  assertThrows(() => {
    // deno-lint-ignore no-explicit-any
    (PROJECT_DETAIL_ROUTE as any).id = "projects.get";
  });
});

Deno.test("extracts a valid Project UUID", () => {
  const parsed = parseApiV1ProjectDetailPath(`/v1/projects/${UUID}`);
  assertEquals(parsed, { projectId: UUID });
  assertEquals(Object.keys(parsed), ["projectId"]);
});

Deno.test("UUID is preserved without normalization", () => {
  const parsed = parseApiV1ProjectDetailPath(`/v1/projects/${UUID_UPPER}`);
  assertStrictEquals(parsed.projectId, UUID_UPPER);
});

Deno.test("returned object is frozen", () => {
  const parsed = parseApiV1ProjectDetailPath(`/v1/projects/${UUID}`);
  assert(Object.isFrozen(parsed));
});

Deno.test("repeated valid calls return distinct objects", () => {
  const a = parseApiV1ProjectDetailPath(`/v1/projects/${UUID}`);
  const b = parseApiV1ProjectDetailPath(`/v1/projects/${UUID}`);
  assertEquals(a, b);
  assertNotStrictEquals(a, b);
});

Deno.test("non-string input maps to internal_error", () => {
  for (const bad of [undefined, null, 0, 1, true, false, {}, [], Symbol("x")]) {
    const err = assertThrows(
      () => parseApiV1ProjectDetailPath(bad as unknown as string),
      ApiHttpError,
    );
    assertEquals(err.code, "internal_error");
  }
});

function assertInvalid(pathname: string) {
  const err = assertThrows(
    () => parseApiV1ProjectDetailPath(pathname),
    ApiHttpError,
  );
  assertEquals(err.code, "invalid_request");
}

Deno.test("missing or malformed prefix maps to invalid_request", () => {
  for (
    const bad of [
      "",
      "/",
      "/v1/projects",
      "/v1/projects/",
      `v1/projects/${UUID}`,
      `/V1/projects/${UUID}`,
      `/v1/Projects/${UUID}`,
      `/v1/project/${UUID}`,
      `/v2/projects/${UUID}`,
      `/api/v1/projects/${UUID}`,
      `/v1/workspaces/${UUID}`,
    ]
  ) {
    assertInvalid(bad);
  }
});

Deno.test("invalid and nil UUIDs reject", () => {
  for (
    const bad of [
      "not-a-uuid",
      "11111111-2222-4333-8444-55555555555",
      "111111112222433384445555555555555",
      "11111111-2222-6333-8444-555555555555",
      "11111111-2222-4333-c444-555555555555",
      NIL_UUID,
    ]
  ) {
    assertInvalid(`/v1/projects/${bad}`);
  }
});

Deno.test("query, fragment, trailing slash and extra segments reject", () => {
  for (
    const bad of [
      `/v1/projects/${UUID}?x=1`,
      `/v1/projects/${UUID}#frag`,
      `/v1/projects/${UUID}/`,
      `/v1/projects/${UUID}/tasks`,
      `/v1/projects/${UUID}/${UUID}`,
    ]
  ) {
    assertInvalid(bad);
  }
});

Deno.test("whitespace, percent encoding, semicolon and backslash reject", () => {
  for (
    const bad of [
      `/v1/projects/ ${UUID}`,
      `/v1/projects/${UUID} `,
      `/v1/projects/${UUID}\t`,
      `/v1/projects/${UUID}\n`,
      "/v1/projects/11111111%2D2222-4333-8444-555555555555",
      `/v1/projects/${UUID};v=1`,
      `/v1/projects/${UUID}\\extra`,
    ]
  ) {
    assertInvalid(bad);
  }
});

Deno.test("duplicated slash rejects", () => {
  assertInvalid(`/v1//projects/${UUID}`);
  assertInvalid(`//v1/projects/${UUID}`);
  assertInvalid(`/v1/projects//${UUID}`);
});

Deno.test("source contains no runtime, network, env, db or registration behavior", async () => {
  const source = await Deno.readTextFile(
    new URL("../routes/projectDetail.ts", import.meta.url),
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
      `projectDetail.ts must not contain: ${needle}`,
    );
  }
});
