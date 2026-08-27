// API-N.RG2 — Central live authorization-registration guard.
//
// This neutral test is the SOLE OWNER of the parity between
// `API_V1_ROUTE_ALLOWLIST` and the explicit fail-closed `authorizeRoute`
// route-object identity enumeration inside the live `index.ts` runtime.
//
// It intentionally does NOT own global operation order or the numeric
// 34 / 17 / 17 cardinality — those remain owned by
// `api-v1-current-surface-topology.test.ts`.
//
// Historical step tests must NOT freeze the authorization chain source text or
// route import formatting. When a route is added, update the production
// runtime, the central topology guard, this guard, and the new route's own
// focused tests — nothing else.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import { API_V1_ROUTE_ALLOWLIST } from "../router.ts";
import { VERSION_ROUTE } from "../routes/version.ts";
import { CAPABILITIES_ROUTE } from "../routes/capabilities.ts";
import { ME_ROUTE } from "../routes/me.ts";
import { ORGANIZATIONS_ROUTE } from "../routes/organizations.ts";
import { WORKSPACES_ROUTE } from "../routes/workspaces.ts";
import { WORKSPACE_MEMBERS_ROUTE } from "../routes/workspaceMembers.ts";
import {
  PORTFOLIOS_ROUTE,
  PORTFOLIO_ASSIGN_PROJECT_ROUTE,
  PORTFOLIO_CREATE_ROUTE,
  PORTFOLIO_DETAIL_ROUTE,
  PORTFOLIO_PROJECTS_ROUTE,
  PORTFOLIO_UPDATE_ROUTE,
} from "../routes/portfolios.ts";
import {
  PROGRAMS_ROUTE,
  PROGRAM_CREATE_ROUTE,
  PROGRAM_DETAIL_ROUTE,
  PROGRAM_UPDATE_ROUTE,
} from "../routes/programs.ts";
import {
  PROJECT_CREATE_ROUTE,
  PROJECT_UPDATE_ROUTE,
  PROJECT_TRANSITION_ROUTE,
  PROJECTS_ROUTE,
} from "../routes/projects.ts";
import { PROJECT_DETAIL_ROUTE } from "../routes/projectDetail.ts";
import { PROJECT_PLANNING_ROUTE } from "../routes/projectPlanning.ts";
import {
  EXECUTION_UPDATES_APPEND_ROUTE,
  EXECUTION_UPDATES_READ_ROUTE,
} from "../routes/executionUpdates.ts";
import {
  RISK_CREATE_ROUTE,
  RISK_DETAIL_ROUTE,
  RISK_PROJECT_COLLECTION_ROUTE,
  RISK_UPDATE_ROUTE,
} from "../routes/risks.ts";
import {
  BLOCKER_CREATE_ROUTE,
  BLOCKER_DETAIL_ROUTE,
  BLOCKER_PROJECT_COLLECTION_ROUTE,
  BLOCKER_UPDATE_ROUTE,
} from "../routes/blockers.ts";
import {
  PHASE_CREATE_ROUTE,
  PHASE_DETAIL_ROUTE,
  PHASE_PLANNING_ROUTE,
  PHASE_REORDER_ROUTE,
  PHASE_UPDATE_ROUTE,
} from "../routes/phases.ts";
import {
  TASK_ASSIGN_ROUTE,
  TASK_CREATE_ROUTE,
  TASK_DETAIL_ROUTE,
  TASK_PLANNING_ROUTE,
  TASK_REORDER_ROUTE,
  TASK_TRANSITION_ROUTE,
  TASK_UPDATE_ROUTE,
} from "../routes/tasks.ts";
// KPI-1B-C1 — accepted KPI route constant for the central authorization guard.
import {
  KPI_CREATE_ROUTE,
  KPI_UPDATE_ROUTE,
  KPI_DETAIL_ROUTE,
  KPI_PROJECT_COLLECTION_ROUTE,
  KPI_UPDATES_ROUTE,
  KPI_UPDATE_APPEND_ROUTE,
} from "../../_shared/btpm-api/routes/kpis.ts";

interface AuthorizationRegistryEntry {
  readonly symbol: string;
  readonly route: { readonly id: string };
}

/** The current accepted live authorization registry (order-irrelevant). */
const AUTHORIZATION_REGISTRY: readonly AuthorizationRegistryEntry[] = Object
  .freeze([
    { symbol: "VERSION_ROUTE", route: VERSION_ROUTE },
    { symbol: "CAPABILITIES_ROUTE", route: CAPABILITIES_ROUTE },
    { symbol: "ME_ROUTE", route: ME_ROUTE },
    { symbol: "ORGANIZATIONS_ROUTE", route: ORGANIZATIONS_ROUTE },
    { symbol: "WORKSPACES_ROUTE", route: WORKSPACES_ROUTE },
    {
      symbol: "WORKSPACE_MEMBERS_ROUTE",
      route: WORKSPACE_MEMBERS_ROUTE,
    },
    { symbol: "PROGRAMS_ROUTE", route: PROGRAMS_ROUTE },
    { symbol: "PROGRAM_DETAIL_ROUTE", route: PROGRAM_DETAIL_ROUTE },
    { symbol: "PROJECTS_ROUTE", route: PROJECTS_ROUTE },
    { symbol: "PROJECT_DETAIL_ROUTE", route: PROJECT_DETAIL_ROUTE },
    { symbol: "PROJECT_PLANNING_ROUTE", route: PROJECT_PLANNING_ROUTE },
    { symbol: "PROJECT_CREATE_ROUTE", route: PROJECT_CREATE_ROUTE },
    { symbol: "PROJECT_UPDATE_ROUTE", route: PROJECT_UPDATE_ROUTE },
    { symbol: "PROJECT_TRANSITION_ROUTE", route: PROJECT_TRANSITION_ROUTE },
    {
      symbol: "EXECUTION_UPDATES_APPEND_ROUTE",
      route: EXECUTION_UPDATES_APPEND_ROUTE,
    },
    { symbol: "RISK_CREATE_ROUTE", route: RISK_CREATE_ROUTE },
    { symbol: "RISK_UPDATE_ROUTE", route: RISK_UPDATE_ROUTE },
    { symbol: "BLOCKER_CREATE_ROUTE", route: BLOCKER_CREATE_ROUTE },
    { symbol: "BLOCKER_UPDATE_ROUTE", route: BLOCKER_UPDATE_ROUTE },
    { symbol: "PHASE_CREATE_ROUTE", route: PHASE_CREATE_ROUTE },
    { symbol: "PHASE_UPDATE_ROUTE", route: PHASE_UPDATE_ROUTE },
    { symbol: "PHASE_REORDER_ROUTE", route: PHASE_REORDER_ROUTE },
    { symbol: "PHASE_PLANNING_ROUTE", route: PHASE_PLANNING_ROUTE },
    { symbol: "TASK_CREATE_ROUTE", route: TASK_CREATE_ROUTE },
    { symbol: "TASK_UPDATE_ROUTE", route: TASK_UPDATE_ROUTE },
    { symbol: "TASK_REORDER_ROUTE", route: TASK_REORDER_ROUTE },
    { symbol: "TASK_PLANNING_ROUTE", route: TASK_PLANNING_ROUTE },
    { symbol: "TASK_ASSIGN_ROUTE", route: TASK_ASSIGN_ROUTE },
    { symbol: "TASK_TRANSITION_ROUTE", route: TASK_TRANSITION_ROUTE },
    {
      symbol: "RISK_PROJECT_COLLECTION_ROUTE",
      route: RISK_PROJECT_COLLECTION_ROUTE,
    },
    { symbol: "RISK_DETAIL_ROUTE", route: RISK_DETAIL_ROUTE },
    {
      symbol: "BLOCKER_PROJECT_COLLECTION_ROUTE",
      route: BLOCKER_PROJECT_COLLECTION_ROUTE,
    },
    { symbol: "BLOCKER_DETAIL_ROUTE", route: BLOCKER_DETAIL_ROUTE },
    {
      symbol: "EXECUTION_UPDATES_READ_ROUTE",
      route: EXECUTION_UPDATES_READ_ROUTE,
    },
    { symbol: "PHASE_DETAIL_ROUTE", route: PHASE_DETAIL_ROUTE },
    { symbol: "TASK_DETAIL_ROUTE", route: TASK_DETAIL_ROUTE },
    { symbol: "PROGRAM_CREATE_ROUTE", route: PROGRAM_CREATE_ROUTE },
    { symbol: "PROGRAM_UPDATE_ROUTE", route: PROGRAM_UPDATE_ROUTE },
    { symbol: "PORTFOLIOS_ROUTE", route: PORTFOLIOS_ROUTE },
    { symbol: "PORTFOLIO_DETAIL_ROUTE", route: PORTFOLIO_DETAIL_ROUTE },
    {
      symbol: "PORTFOLIO_PROJECTS_ROUTE",
      route: PORTFOLIO_PROJECTS_ROUTE,
    },
    { symbol: "PORTFOLIO_CREATE_ROUTE", route: PORTFOLIO_CREATE_ROUTE },
    { symbol: "PORTFOLIO_UPDATE_ROUTE", route: PORTFOLIO_UPDATE_ROUTE },
    {
      symbol: "PORTFOLIO_ASSIGN_PROJECT_ROUTE",
      route: PORTFOLIO_ASSIGN_PROJECT_ROUTE,
    },
    {
      symbol: "KPI_PROJECT_COLLECTION_ROUTE",
      route: KPI_PROJECT_COLLECTION_ROUTE,
    },
    // KPI-2B — accepted KPI detail route.
    { symbol: "KPI_DETAIL_ROUTE", route: KPI_DETAIL_ROUTE },
    // KPI-3B — accepted KPI update-history route.
    { symbol: "KPI_UPDATES_ROUTE", route: KPI_UPDATES_ROUTE },
    // KPI-4B — accepted KPI definition create route.
    { symbol: "KPI_CREATE_ROUTE", route: KPI_CREATE_ROUTE },
    // KPI-5B — accepted KPI definition update route.
    { symbol: "KPI_UPDATE_ROUTE", route: KPI_UPDATE_ROUTE },
    // KPI-6B — accepted KPI update-history append route.
    {
      symbol: "KPI_UPDATE_APPEND_ROUTE",
      route: KPI_UPDATE_APPEND_ROUTE,
    },
  ]);

// ---------------------------------------------------------------------------
// A. Registry hygiene
// ---------------------------------------------------------------------------

Deno.test("API-N.RG2: registry symbol names and route IDs are unique", () => {
  const symbols = AUTHORIZATION_REGISTRY.map((e) => e.symbol);
  assertEquals(new Set(symbols).size, symbols.length);
  const ids = AUTHORIZATION_REGISTRY.map((e) => e.route.id);
  assertEquals(new Set(ids).size, ids.length);
});

// ---------------------------------------------------------------------------
// B. Allowlist <-> authorization registry parity (identity, order-independent)
// ---------------------------------------------------------------------------

Deno.test("API-N.RG2: every live allowlist route appears exactly once in the registry", () => {
  for (const route of API_V1_ROUTE_ALLOWLIST) {
    const matches = AUTHORIZATION_REGISTRY.filter((e) =>
      e.route === (route as unknown as { readonly id: string })
    );
    assertEquals(matches.length, 1, route.id);
  }
});

Deno.test("API-N.RG2: every registry route appears exactly once in the live allowlist", () => {
  for (const entry of AUTHORIZATION_REGISTRY) {
    const matches = API_V1_ROUTE_ALLOWLIST.filter((route) =>
      (route as unknown as { readonly id: string }) === entry.route
    );
    assertEquals(matches.length, 1, entry.symbol);
  }
});

// ---------------------------------------------------------------------------
// C. Semantic extraction of the live authorizeRoute identity comparisons
// ---------------------------------------------------------------------------

async function readLiveAuthorizeRouteBlock(): Promise<string> {
  const src = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
  const start = src.indexOf("const authorizeRoute = async (");
  assert(start >= 0, "authorizeRoute must exist in the live runtime");
  const failClosed = src.indexOf(
    'throw new ApiHttpError("internal_error");',
    start,
  );
  assert(failClosed > start, "authorizeRoute must remain fail-closed");
  return src.slice(start, failClosed);
}

function extractComparedSymbols(block: string): string[] {
  const pattern = /route\s*!==\s*([A-Z][A-Z0-9_]*)/g;
  const found: string[] = [];
  for (const match of block.matchAll(pattern)) {
    found.push(match[1]);
  }
  return found;
}

Deno.test("API-N.RG2: authorizeRoute compares exactly the registry route symbols, once each", async () => {
  const block = await readLiveAuthorizeRouteBlock();
  const compared = extractComparedSymbols(block);

  // No duplicates.
  assertEquals(new Set(compared).size, compared.length);

  const expected = new Set(AUTHORIZATION_REGISTRY.map((e) => e.symbol));
  const actual = new Set(compared);

  for (const symbol of expected) {
    assert(actual.has(symbol), `missing authorization comparison: ${symbol}`);
  }
  for (const symbol of actual) {
    assert(expected.has(symbol), `unexpected authorization comparison: ${symbol}`);
  }
  assertEquals(actual.size, expected.size);
});

// ---------------------------------------------------------------------------
// D. Fail-closed architecture and forbidden generic authorization
// ---------------------------------------------------------------------------

Deno.test("API-N.RG2: authorizeRoute remains fail-closed with no generic authorization", async () => {
  const src = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
  const start = src.indexOf("const authorizeRoute = async (");
  const end = src.indexOf("};", src.indexOf(
    'throw new ApiHttpError("internal_error");',
    start,
  ));
  const full = src.slice(start, end);

  assert(full.includes('throw new ApiHttpError("internal_error");'));

  for (
    const forbidden of [
      "API_V1_ROUTE_ALLOWLIST",
      ".includes(",
      "startsWith",
      "route.id",
      "route.path",
      "route.method",
      "matchApiRoute",
    ]
  ) {
    assert(
      !full.includes(forbidden),
      `authorizeRoute must not use ${forbidden}`,
    );
  }
});
