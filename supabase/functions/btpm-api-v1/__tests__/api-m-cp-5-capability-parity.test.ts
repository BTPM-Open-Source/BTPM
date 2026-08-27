// API-M.CP.5 — Capability advertisement parity + permanent regression guard.
//
// Closes the deliberate `/v1/capabilities` advertisement deferral carried by
// CP.2B2 / CP.2C3 / CP.3C / CP.4C. After this step `/v1/capabilities` advertises
// every live route exactly once, in the accepted allowlist order.
//
// `supportedOperations` means "implemented by API v1". It never means "enabled
// for the calling client": Connected App assignment, capability grants, Project
// enablement and delegated user authority remain independent server-side gates.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { buildCapabilitiesPayload } from "../routes/capabilities.ts";
import { API_V1_ROUTE_ALLOWLIST } from "../router.ts";

const MIGRATIONS_DIR = "supabase/migrations";

/** The seven parity read operations newly advertised by CP.5. */
const PARITY_READ_OPERATION_IDS: readonly string[] = Object.freeze([
  "risks.get",
  "risks.get_by_id",
  "blockers.get",
  "blockers.get_by_id",
  "execution_updates.get",
  "phases.get_by_id",
  "tasks.get_by_id",
]);

/**
 * Frozen operation -> capability model. Risk and Blocker deliberately share a
 * single domain read capability across collection and detail operations; they
 * are never split into list/detail capability keys.
 */
const OPERATION_CAPABILITY_MODEL: Readonly<Record<string, string>> = Object
  .freeze({
    "risks.get": "risks:read",
    "risks.get_by_id": "risks:read",
    "blockers.get": "blockers:read",
    "blockers.get_by_id": "blockers:read",
    "execution_updates.get": "execution_updates:read",
    "phases.get_by_id": "phases:read",
    "tasks.get_by_id": "tasks:read",
  });

/** Accepted representative catalogue route metadata per capability key. */
const CATALOGUE_ROUTE_METADATA: readonly {
  readonly key: string;
  readonly routeId: string;
  readonly method: string;
  readonly path: string;
}[] = Object.freeze([
  {
    key: "risks:read",
    routeId: "risks.get_by_id",
    method: "GET",
    path: "/v1/risks/:riskid",
  },
  {
    key: "blockers:read",
    routeId: "blockers.get_by_id",
    method: "GET",
    path: "/v1/blockers/:blockerid",
  },
  {
    key: "execution_updates:read",
    routeId: "execution_updates.get",
    method: "GET",
    path: "/v1/execution-updates",
  },
  {
    key: "phases:read",
    routeId: "phases.get_by_id",
    method: "GET",
    path: "/v1/phases/:phaseid",
  },
  {
    key: "tasks:read",
    routeId: "tasks.get_by_id",
    method: "GET",
    path: "/v1/tasks/:taskid",
  },
]);

async function migrationSources(): Promise<readonly string[]> {
  const out: string[] = [];
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".sql")) continue;
    const text = await Deno.readTextFile(`${MIGRATIONS_DIR}/${entry.name}`);
    out.push(text.replace(/\s+/g, " "));
  }
  return out;
}

const MIGRATIONS = await migrationSources();

// -----------------------------------------------------------------------------
// 6.1 / 6.2 Parity read advertisement (local, position-independent)
// -----------------------------------------------------------------------------
//
// API-N.RG1B — global cardinality, whole-surface capabilities parity and
// absolute advertisement positions are owned solely by
// api-v1-current-surface-topology.test.ts. This historical CP.5 guard asserts
// only its own seven parity reads.

Deno.test("API-M.CP.5: the seven parity reads are advertised exactly once each", () => {
  const ops = buildCapabilitiesPayload().supportedOperations as
    readonly string[];
  assertEquals(PARITY_READ_OPERATION_IDS.length, 7);
  for (const id of PARITY_READ_OPERATION_IDS) {
    assertEquals(ops.filter((o) => o === id).length, 1, id);
  }
});

Deno.test("API-M.CP.5: all seven correspond to live read routes", () => {
  for (const id of PARITY_READ_OPERATION_IDS) {
    const route = API_V1_ROUTE_ALLOWLIST.find((r) => r.id === id);
    assert(route !== undefined, `not live: ${id}`);
    assertEquals(route.operation, "read", id);
    assertEquals(route.method, "GET", id);
  }
});

Deno.test("API-M.CP.5: the seven parity reads keep their accepted relative order", () => {
  const ops = buildCapabilitiesPayload().supportedOperations as
    readonly string[];
  assertEquals(
    ops.filter((o) => PARITY_READ_OPERATION_IDS.includes(o)),
    PARITY_READ_OPERATION_IDS,
  );
});


// -----------------------------------------------------------------------------
// 6.3 Frozen operation -> capability model
// -----------------------------------------------------------------------------

Deno.test("API-M.CP.5: operation -> capability mapping is the frozen accepted model", () => {
  assertEquals(
    Object.keys(OPERATION_CAPABILITY_MODEL).sort(),
    [...PARITY_READ_OPERATION_IDS].sort(),
  );
  // Risk and Blocker share one domain read capability across both operations.
  assertEquals(
    OPERATION_CAPABILITY_MODEL["risks.get"],
    OPERATION_CAPABILITY_MODEL["risks.get_by_id"],
  );
  assertEquals(
    OPERATION_CAPABILITY_MODEL["blockers.get"],
    OPERATION_CAPABILITY_MODEL["blockers.get_by_id"],
  );
  const keys = new Set(Object.values(OPERATION_CAPABILITY_MODEL));
  assertEquals(
    [...keys].sort(),
    [
      "blockers:read",
      "execution_updates:read",
      "phases:read",
      "risks:read",
      "tasks:read",
    ],
  );
  // No split list/detail capability keys exist anywhere in the model.
  for (const forbidden of [
    "risks:list",
    "risks:get",
    "blockers:list",
    "blockers:get",
  ]) {
    assert(!keys.has(forbidden), forbidden);
  }
});

// -----------------------------------------------------------------------------
// 6.4 Catalogue metadata presence (committed migration source only)
// -----------------------------------------------------------------------------

Deno.test("API-M.CP.5: each read capability key has accepted active catalogue metadata", () => {
  for (const row of CATALOGUE_ROUTE_METADATA) {
    const tuple =
      `('v1', 'read', '${row.key}', '${row.routeId}', '${row.method}', '${row.path}', 'project',`;
    const source = MIGRATIONS.find((sql) =>
      sql.includes(tuple) && sql.includes("public.api_capability_catalogue")
    );
    assert(source !== undefined, `missing catalogue metadata: ${row.key}`);
    // administrator_assignable = true, lifecycle_status = 'active'
    const afterTuple = source.slice(source.indexOf(tuple) + tuple.length);
    const rowText = afterTuple.slice(0, afterTuple.indexOf(")"));
    assert(rowText.includes("true, 'active'"), `not assignable+active: ${row.key}`);
  }
});

Deno.test("API-M.CP.5: no split Risk/Blocker read capability key is registered", () => {
  for (const sql of MIGRATIONS) {
    for (const forbidden of [
      "'risks:list'",
      "'risks:get'",
      "'blockers:list'",
      "'blockers:get'",
    ]) {
      assert(!sql.includes(forbidden), `forbidden capability key: ${forbidden}`);
    }
  }
});

// -----------------------------------------------------------------------------
// 6.5 Advertisement is not authorization
// -----------------------------------------------------------------------------

Deno.test("API-M.CP.5: the capabilities payload is not client-specific and grants nothing", () => {
  const a = buildCapabilitiesPayload();
  const b = buildCapabilitiesPayload();
  // Deterministic, caller-independent, frozen — no grant/enablement input.
  assertEquals(a, b);
  assert(Object.isFrozen(a));
  assert(Object.isFrozen(a.supportedOperations));
  assertEquals(Object.keys(a).sort(), [
    "apiVersion",
    "service",
    "supportedOperations",
  ]);
});

Deno.test("API-M.CP.5: the capability payload module references no grant or enablement surface", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/btpm-api-v1/routes/capabilities.ts",
  );
  for (const forbidden of [
    "api_capability_grants",
    "api_client_supported_capabilities",
    "api_organization_client_enablements",
    "api_workspace_client_enablements",
    "api_project_client_enablements",
    "createClient",
    "service_role",
    "Deno.env",
  ]) {
    assert(!source.includes(forbidden), `forbidden reference: ${forbidden}`);
  }
});
