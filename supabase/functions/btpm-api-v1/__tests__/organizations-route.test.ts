// API-G.2G — Focused tests for the pure `/v1/organizations` route and query parser.

import {
  assert,
  assertEquals,
  assertStrictEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { ApiHttpError } from "../../_shared/btpm-api/http.ts";
import {
  ORGANIZATIONS_ROUTE,
  parseApiV1OrganizationsQuery,
} from "../routes/organizations.ts";

Deno.test("ORGANIZATIONS_ROUTE contract and parseApiV1OrganizationsQuery valid queries", () => {
  assertStrictEquals(ORGANIZATIONS_ROUTE.id, "organizations.get");
  assertStrictEquals(ORGANIZATIONS_ROUTE.method, "GET");
  assertStrictEquals(ORGANIZATIONS_ROUTE.path, "/v1/organizations");
  assertStrictEquals(ORGANIZATIONS_ROUTE.operation, "read");
  assert(Object.isFrozen(ORGANIZATIONS_ROUTE));

  const defaults = parseApiV1OrganizationsQuery("");
  assertEquals(defaults, { limit: 50, offset: 0, search: null });
  assert(Object.isFrozen(defaults));

  const populated = parseApiV1OrganizationsQuery(
    "?limit=25&offset=10&search=hello+world%21",
  );
  assertEquals(populated, {
    limit: 25,
    offset: 10,
    search: "hello world!",
  });
  assert(Object.isFrozen(populated));
});

Deno.test("parseApiV1OrganizationsQuery invalid inputs map to invalid_request or internal_error", () => {
  assertThrows(
    () => parseApiV1OrganizationsQuery("?unknown=1"),
    ApiHttpError,
    "Request validation failed.",
  );

  assertThrows(
    () => parseApiV1OrganizationsQuery("?limit=10&limit=10"),
    ApiHttpError,
    "Request validation failed.",
  );

  assertThrows(
    () => parseApiV1OrganizationsQuery("?limit=abc"),
    ApiHttpError,
    "Request validation failed.",
  );

  assertThrows(
    () => parseApiV1OrganizationsQuery("?limit=101"),
    ApiHttpError,
    "Request validation failed.",
  );

  assertThrows(
    () => parseApiV1OrganizationsQuery("?search=" + "a".repeat(101)),
    ApiHttpError,
    "Request validation failed.",
  );

  assertThrows(
    () => parseApiV1OrganizationsQuery("?search=%ZZ"),
    ApiHttpError,
    "Request validation failed.",
  );

  assertThrows(
    () => parseApiV1OrganizationsQuery("?#fragment"),
    ApiHttpError,
    "Request validation failed.",
  );

  assertThrows(
    () => parseApiV1OrganizationsQuery(123 as unknown as string),
    ApiHttpError,
    "Internal server error.",
  );
});
