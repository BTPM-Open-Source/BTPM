// API-N.RG1A — Central current-surface topology guard.
//
// This neutral test is the SOLE OWNER of the CURRENT global API v1 route
// cardinality, the current live operation-ID order, and the exact
// `/v1/capabilities` advertisement parity with the live route allowlist.
//
// Historical step tests (API-M.CP.*, API-N.*) must assert only their own local
// route contracts — exact-once registration, exact path matching, and their own
// behavior. They must NOT freeze later global totals or terminal/absolute
// positions, because doing so forces unrelated historical tests to change every
// time one new route is added.
//
// When a future API step adds an operation, update THIS topology test once
// (order + counts), plus the new operation's own focused tests. Nothing else.
//
// No authorization logic and no business assertions belong in this file.

import {
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { API_V1_ROUTE_ALLOWLIST } from "../router.ts";
import { buildCapabilitiesPayload } from "../routes/capabilities.ts";

/** The CURRENT accepted live operation-ID order, frozen exactly. */
const CURRENT_OPERATION_ID_ORDER: readonly string[] = Object.freeze([
  "version.get",
  "capabilities.get",
  "me.get",
  "organizations.get",
  "workspaces.get",
  "programs.get",
  "programs.get_by_id",
  "projects.get",
  "projects.get_by_id",
  "projects.planning.get",
  "execution_updates.append",
  "risks.create",
  "risks.update",
  "blockers.create",
  "blockers.update",
  "phases.create",
  "phases.update",
  "phases.reorder",
  "phases.plan",
  "tasks.create",
  "tasks.update",
  "tasks.reorder",
  "tasks.plan",
  "tasks.assign",
  "tasks.transition",
  "risks.get",
  "risks.get_by_id",
  "blockers.get",
  "blockers.get_by_id",
  "execution_updates.get",
  "phases.get_by_id",
  "tasks.get_by_id",
  "projects.create",
  "projects.update",
  "projects.transition",
  "programs.create",
  "programs.update",
  "workspace_members.get",
  "portfolios.get",
  "portfolios.get_by_id",
  "portfolios.projects.get",
  "portfolios.create",
  "portfolios.update",
  "portfolios.assign_project",
  "kpis.get",
  "kpis.get_by_id",
  "kpis.updates.get",
  "kpis.create",
  "kpis.update",
  "kpis.updates.append",
]);

Deno.test("API-N.RG1A: live allowlist operation IDs equal the current frozen order", () => {
  assertEquals(
    API_V1_ROUTE_ALLOWLIST.map((route) => route.id) as readonly string[],
    CURRENT_OPERATION_ID_ORDER,
  );
});

Deno.test("API-N.RG1A: current cardinality is 50 total / 24 reads / 26 mutations", () => {
  assertEquals(API_V1_ROUTE_ALLOWLIST.length, 50);
  assertEquals(
    API_V1_ROUTE_ALLOWLIST.filter((r) => r.operation === "read").length,
    24,
  );
  assertEquals(
    API_V1_ROUTE_ALLOWLIST.filter((r) => r.operation === "mutation").length,
    26,
  );
});

Deno.test("API-N.RG1A: the live allowlist contains no duplicate route IDs", () => {
  const ids = API_V1_ROUTE_ALLOWLIST.map((route) => route.id);
  assertEquals(new Set(ids).size, ids.length);
});

Deno.test("API-N.RG1A: /v1/capabilities advertises exactly the live order", () => {
  const advertised = buildCapabilitiesPayload()
    .supportedOperations as readonly string[];
  assertEquals(advertised, CURRENT_OPERATION_ID_ORDER);
  assertEquals(
    advertised,
    API_V1_ROUTE_ALLOWLIST.map((route) => route.id) as readonly string[],
  );
});

Deno.test("API-N.RG1A: no duplicate advertised operation IDs", () => {
  const advertised = buildCapabilitiesPayload()
    .supportedOperations as readonly string[];
  assertEquals(new Set(advertised).size, advertised.length);
});
