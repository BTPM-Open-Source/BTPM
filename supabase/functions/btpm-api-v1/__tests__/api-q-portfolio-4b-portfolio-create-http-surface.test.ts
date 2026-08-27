// API-Q Portfolio-4B — Focused HTTP-activation tests for the single accepted
// external Portfolio command: POST /v1/portfolios (portfolios.create).
//
// These tests assert only this step's local contracts: exact-once route
// registration, exact path/method matching, strict closed-schema body parsing
// with canonical defaults, and capability-advertisement parity for the new
// operation. Global cardinality and terminal ordering remain owned by
// api-v1-current-surface-topology.test.ts.

import {
  assert,
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { API_V1_ROUTE_ALLOWLIST } from "../router.ts";
import { buildCapabilitiesPayload } from "../routes/capabilities.ts";
import {
  PORTFOLIO_CREATE_ROUTE,
  parseApiV1CreatePortfolioBody,
} from "../routes/portfolios.ts";
import { ApiHttpError } from "../../_shared/btpm-api/http.ts";

const ORG = "11111111-1111-4111-8111-111111111111";
const OWNER = "22222222-2222-4222-8222-222222222222";
const NIL = "00000000-0000-0000-0000-000000000000";

Deno.test("Portfolio-4B: portfolios.create is registered exactly once as a POST mutation", () => {
  const matches = API_V1_ROUTE_ALLOWLIST.filter(
    (route) => route.id === "portfolios.create",
  );
  assertEquals(matches.length, 1);
  assertEquals(matches[0], PORTFOLIO_CREATE_ROUTE);
  assertEquals(matches[0].method, "POST");
  assertEquals(matches[0].path, "/v1/portfolios");
  assertEquals(matches[0].operation, "mutation");
});

Deno.test("Portfolio-4B: no other POST Portfolio surface exists", () => {
  const postPortfolioRoutes = API_V1_ROUTE_ALLOWLIST.filter(
    (route) =>
      route.path.startsWith("/v1/portfolios") && route.method === "POST",
  );
  assertEquals(postPortfolioRoutes.length, 1);
  assertEquals(postPortfolioRoutes[0].id, "portfolios.create");
});

Deno.test("Portfolio-4B: /v1/capabilities advertises portfolios.create exactly once", () => {
  const advertised = buildCapabilitiesPayload()
    .supportedOperations as readonly string[];
  assertEquals(
    advertised.filter((id) => id === "portfolios.create").length,
    1,
  );
});

Deno.test("Portfolio-4B: minimal body materializes canonical defaults", () => {
  const body = parseApiV1CreatePortfolioBody({
    organizationId: ORG,
    name: "  Growth Portfolio  ",
  });
  assertEquals(body, {
    organizationId: ORG,
    name: "Growth Portfolio",
    code: null,
    description: null,
    lifecycleState: "opportunity_candidate",
    strategicPriority: "medium",
    ownerId: null,
  });
  assert(Object.isFrozen(body));
});

Deno.test("Portfolio-4B: explicit nulls are canonicalized to null", () => {
  const body = parseApiV1CreatePortfolioBody({
    organizationId: ORG,
    name: "P",
    code: null,
    description: null,
    ownerId: null,
  });
  assertEquals(body.code, null);
  assertEquals(body.description, null);
  assertEquals(body.ownerId, null);
});

Deno.test("Portfolio-4B: code and description are preserved exactly", () => {
  const body = parseApiV1CreatePortfolioBody({
    organizationId: ORG,
    name: "P",
    code: "  gRoWtH-01  ",
    description: "  line one\n line two  ",
    lifecycleState: "development",
    strategicPriority: "critical",
    ownerId: OWNER,
  });
  assertEquals(body.code, "  gRoWtH-01  ");
  assertEquals(body.description, "  line one\n line two  ");
  assertEquals(body.lifecycleState, "development");
  assertEquals(body.strategicPriority, "critical");
  assertEquals(body.ownerId, OWNER);
});

Deno.test("Portfolio-4B: unknown keys and snake_case aliases are rejected", () => {
  for (
    const extra of [
      { organization_id: ORG },
      { archived: true },
      { tenantId: ORG },
      { workspaceId: ORG },
      { projectIds: [] },
      { lifecycle_state: "development" },
    ]
  ) {
    assertThrows(
      () =>
        parseApiV1CreatePortfolioBody({
          organizationId: ORG,
          name: "P",
          ...extra,
        }),
      ApiHttpError,
    );
  }
});

Deno.test("Portfolio-4B: required fields and identity values are validated", () => {
  const invalidBodies: unknown[] = [
    null,
    [],
    "x",
    {},
    { organizationId: ORG },
    { name: "P" },
    { organizationId: NIL, name: "P" },
    { organizationId: "not-a-uuid", name: "P" },
    { organizationId: ORG, name: "   " },
    { organizationId: ORG, name: "" },
    { organizationId: ORG, name: 5 },
    { organizationId: ORG, name: null },
    { organizationId: ORG, name: "x".repeat(201) },
    { organizationId: ORG, name: "P", code: "c".repeat(81) },
    { organizationId: ORG, name: "P", description: "d".repeat(4001) },
    { organizationId: ORG, name: "P", lifecycleState: "archived" },
    { organizationId: ORG, name: "P", lifecycleState: null },
    { organizationId: ORG, name: "P", strategicPriority: "urgent" },
    { organizationId: ORG, name: "P", strategicPriority: null },
    { organizationId: ORG, name: "P", ownerId: NIL },
    { organizationId: ORG, name: "P", ownerId: "nope" },
  ];
  for (const raw of invalidBodies) {
    assertThrows(
      () => parseApiV1CreatePortfolioBody(raw),
      ApiHttpError,
    );
  }
});

Deno.test("Portfolio-4B: every accepted lifecycle and priority value round-trips", () => {
  for (
    const lifecycleState of [
      "opportunity_candidate",
      "business_case_approved",
      "contracted",
      "development",
      "submission_approval",
      "launch_preparation",
      "launched_commercial",
      "lcm_optimization",
      "on_hold",
      "discontinuation",
      "retired",
    ]
  ) {
    assertEquals(
      parseApiV1CreatePortfolioBody({
        organizationId: ORG,
        name: "P",
        lifecycleState,
      }).lifecycleState,
      lifecycleState,
    );
  }
  for (
    const strategicPriority of [
      "critical",
      "high",
      "medium",
      "low",
      "watchlist",
    ]
  ) {
    assertEquals(
      parseApiV1CreatePortfolioBody({
        organizationId: ORG,
        name: "P",
        strategicPriority,
      }).strategicPriority,
      strategicPriority,
    );
  }
});
