// Relocated out of supabase/functions/ (Edge deploy bundle size).
// Source-file reads stay anchored to the original module location.
const __BTPM_SELF_URL__ = import.meta.url;
const __BTPM_SRC_BASE__ = new URL('../../../functions/btpm-mcp/mcp/api-q-2-mcp-tool-registry_test.ts', import.meta.url).href;
// API-Q.2 — Focused MCP tool-registry integrity test.
//
// Canonical operationIds are compared against the live API capabilities
// contract rather than a second independent topology list maintained here.

import {
  assert,
  assertEquals,
  assertStrictEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import type { ApiRouteDefinition } from "../../../functions/btpm-api-v1/router.ts";

import {
  canonicalOperationClass,
  canonicalOperationIds,
  exposedMcpTools,
  isCanonicalOperationId,
  isMcpOperationExposed,
  MCP_TOOL_REGISTRY,
  type McpToolMetadata,
  type McpToolRegistry,
  resolveCanonicalRouteClass,
  validateMcpRegistryCoverage,
  validateMcpToolRegistry,
} from "../../../functions/btpm-mcp/mcp/toolRegistry.ts";

/**
 * A registry entry for `organizations.get` declared as a read. Reused by the
 * API-Q.7A-C2 cardinality proofs so they can inject synthetic allowlists
 * without mutating the immutable production allowlist.
 */
const ORGANIZATIONS_READ_FIXTURE: McpToolMetadata = Object.freeze({
  operationId: "organizations.get",
  toolName: "btpm_list_organizations",
  title: "List BTPM Organizations",
  description: "Bounded, server-paginated list of BTPM Organizations.",
  operationClass: "read",
  exposure: "not_exposed",
  confirmation: "not_required",
  resultShape: "bounded_collection",
  concurrencyToken: "not_applicable",
});

/** A single canonical read route definition for `organizations.get`. */
const ORGANIZATIONS_ROUTE: ApiRouteDefinition = Object.freeze({
  id: "organizations.get",
  method: "GET",
  path: "/v1/organizations",
  operation: "read",
});

const READ_FIXTURE: McpToolMetadata = Object.freeze({
  operationId: "projects.get",
  toolName: "btpm_projects_list",
  title: "List projects",
  description: "Bounded, server-paginated Project list.",
  operationClass: "read",
  exposure: "not_exposed",
  confirmation: "not_required",
  resultShape: "bounded_collection",
  concurrencyToken: "not_applicable",
});

const MUTATION_FIXTURE: McpToolMetadata = Object.freeze({
  operationId: "projects.update",
  toolName: "btpm_projects_update",
  title: "Update project",
  description: "Updates Project metadata through the canonical API.",
  operationClass: "mutation",
  exposure: "not_exposed",
  confirmation: "required",
  resultShape: "single_object",
  concurrencyToken: "required",
});

Deno.test("MCP-HARDENING-C1: the live registry is structurally valid and canonically complete", () => {
  // (A) structural validity and (B) complete canonical coverage are proven by
  // the canonical validators, never by a manually maintained inventory.
  assertEquals(validateMcpToolRegistry(MCP_TOOL_REGISTRY), []);
  assertEquals(validateMcpRegistryCoverage(MCP_TOOL_REGISTRY), []);

  const exposed = exposedMcpTools();
  for (const entry of exposed) {
    // (C) every exposed operationId resolves to exactly one canonical API
    // route, and its declared MCP class equals the canonical API class.
    const resolution = resolveCanonicalRouteClass(entry.operationId);
    assertStrictEquals(resolution.status, "unique", entry.operationId);
    assertStrictEquals(
      canonicalOperationClass(entry.operationId),
      entry.operationClass,
      entry.operationId,
    );
    assertStrictEquals(isMcpOperationExposed(entry.operationId), true);
    if (entry.operationClass === "mutation") {
      assertStrictEquals(entry.confirmation, "required", entry.operationId);
    }
  }

  // Derived cardinality relationship: reads and mutations partition the
  // exposed inventory exactly. Both sides come from the registry authority.
  const reads = exposed.filter((e) => e.operationClass === "read").length;
  const mutations = exposed.filter((e) => e.operationClass === "mutation").length;
  assertStrictEquals(reads + mutations, exposed.length);
  assertStrictEquals(
    exposed.length,
    MCP_TOOL_REGISTRY.filter((e) => e.exposure === "exposed").length,
  );
});

Deno.test("MCP-HARDENING-C1: advertised tool names derive from the registry and stay unique", () => {
  const exposed = exposedMcpTools();
  const names = exposed.map((e) => e.toolName);
  assertStrictEquals(new Set(names).size, names.length);
  assertEquals(
    names,
    MCP_TOOL_REGISTRY.filter((e) => e.exposure === "exposed").map((e) =>
      e.toolName
    ),
  );
  for (const name of names) {
    assert(name.startsWith("btpm_"), `unexpected tool name ${name}`);
  }
});

Deno.test("API-Q.7E (Y/Z): version.get and capabilities.get keep their accepted non-exposed decisions", () => {
  // Capability-specific exposure decisions are owned by the declarative
  // registry and by each feature-specific exposure test. Only the two
  // permanently internal API operations are asserted globally here.
  const exposedIds = exposedMcpTools().map((e) => e.operationId as string);
  for (const forbidden of ["version.get", "capabilities.get"]) {
    assert(!exposedIds.includes(forbidden), `must not expose ${forbidden}`);
  }
});

Deno.test("API-Q.7B (T): the accepted organizations.get registry entry is unchanged", () => {
  const entry = MCP_TOOL_REGISTRY.find(
    (e) => e.operationId === "organizations.get",
  );
  assert(entry !== undefined);
  assertStrictEquals(entry.toolName, "btpm_list_organizations");
  assertStrictEquals(entry.title, "List BTPM Organizations");
  assertStrictEquals(entry.operationClass, "read");
  assertStrictEquals(entry.exposure, "exposed");
  assertStrictEquals(entry.confirmation, "not_required");
  assertStrictEquals(entry.resultShape, "bounded_collection");
  assertStrictEquals(entry.concurrencyToken, "not_applicable");
});

Deno.test("API-Q.7B (U): workspaces.get registry metadata matches the accepted read contract", () => {
  const entry = MCP_TOOL_REGISTRY.find(
    (e) => e.operationId === "workspaces.get",
  );
  assert(entry !== undefined);
  assertStrictEquals(entry.toolName, "btpm_list_workspaces");
  assertStrictEquals(entry.title, "List BTPM Workspaces");
  assertStrictEquals(entry.operationClass, "read");
  assertStrictEquals(entry.exposure, "exposed");
  assertStrictEquals(entry.confirmation, "not_required");
  assertStrictEquals(entry.resultShape, "bounded_collection");
  assertStrictEquals(entry.concurrencyToken, "not_applicable");
  assertStrictEquals(canonicalOperationClass("workspaces.get"), "read");
});

Deno.test("API-Q.7C: projects.get registry metadata matches the accepted read contract", () => {
  const entry = MCP_TOOL_REGISTRY.find((e) => e.operationId === "projects.get");
  assert(entry !== undefined);
  assertStrictEquals(entry.toolName, "btpm_list_projects");
  assertStrictEquals(entry.title, "List BTPM Projects");
  assertStrictEquals(entry.operationClass, "read");
  assertStrictEquals(entry.exposure, "exposed");
  assertStrictEquals(entry.confirmation, "not_required");
  assertStrictEquals(entry.resultShape, "bounded_collection");
  assertStrictEquals(entry.concurrencyToken, "not_applicable");
  assertStrictEquals(canonicalOperationClass("projects.get"), "read");
});

Deno.test("API-Q.2: registry operationIds are unique", () => {
  const dup: McpToolRegistry = [READ_FIXTURE, { ...READ_FIXTURE, toolName: "other" }];
  const violations = validateMcpToolRegistry(dup);
  assert(violations.some((v) => v.includes("duplicate operationId")));

  const liveIds = MCP_TOOL_REGISTRY.map((e) => e.operationId);
  assertStrictEquals(new Set(liveIds).size, liveIds.length);
});

Deno.test("API-Q.2: MCP tool names are unique", () => {
  const dup: McpToolRegistry = [
    READ_FIXTURE,
    { ...MUTATION_FIXTURE, toolName: READ_FIXTURE.toolName },
  ];
  const violations = validateMcpToolRegistry(dup);
  assert(violations.some((v) => v.includes("duplicate toolName")));

  const liveNames = MCP_TOOL_REGISTRY.map((e) => e.toolName);
  assertStrictEquals(new Set(liveNames).size, liveNames.length);
});

Deno.test("API-Q.2: unknown operations never become exposed implicitly", () => {
  assertEquals(isMcpOperationExposed("not.a.real.operation"), false);
  assertEquals(isMcpOperationExposed(undefined), false);
  assertEquals(isMcpOperationExposed({ operationId: "*" }), false);
  // Registered but not exposed stays closed.
  assertEquals(isMcpOperationExposed("projects.get", [READ_FIXTURE]), false);
  // Only an explicit "exposed" declaration opens the gate.
  assertEquals(
    isMcpOperationExposed("projects.get", [
      { ...READ_FIXTURE, exposure: "exposed" },
    ]),
    true,
  );
});

Deno.test("API-Q.2: mutation metadata requires confirmation", () => {
  const violations = validateMcpToolRegistry([
    { ...MUTATION_FIXTURE, confirmation: "not_required" },
  ]);
  assert(violations.some((v) => v.includes("must require confirmation")));
  assertEquals(validateMcpToolRegistry([MUTATION_FIXTURE]), []);
});

Deno.test("API-Q.2: concurrency-sensitive mutation can require a version token", () => {
  assertStrictEquals(MUTATION_FIXTURE.concurrencyToken, "required");
  assertEquals(validateMcpToolRegistry([MUTATION_FIXTURE]), []);
  const readViolations = validateMcpToolRegistry([
    { ...READ_FIXTURE, concurrencyToken: "required" },
  ]);
  assert(
    readViolations.some((v) => v.includes("must not require a concurrency token")),
  );
});

Deno.test("API-Q.2: registry uses only canonical BTPM operationIds", () => {
  // Derived from the canonical capabilities authority: no literal count.
  const canonical = canonicalOperationIds();
  assertEquals(
    [...MCP_TOOL_REGISTRY.map((e) => e.operationId as string)].sort(),
    [...canonical].sort(),
  );
  for (const entry of MCP_TOOL_REGISTRY) {
    assert(isCanonicalOperationId(entry.operationId));
  }
  assert(isCanonicalOperationId(READ_FIXTURE.operationId));
  assert(isCanonicalOperationId(MUTATION_FIXTURE.operationId));
  assertEquals(isCanonicalOperationId("projects.delete"), false);
});

Deno.test("API-Q.2: no wildcard/all-operations exposure exists", () => {
  const source = Deno.readTextFileSync(
    new URL("./toolRegistry.ts", __BTPM_SRC_BASE__),
  );
  for (const forbidden of ["\"*\"", "'*'", "exposeAll", "ALL_OPERATIONS", "wildcard"]) {
    assert(
      !source.includes(forbidden),
      `registry must not contain ${forbidden}`,
    );
  }
  assertEquals(isMcpOperationExposed("*"), false);
});

// API-Q.7A-C1 — operation-class parity with the authoritative REST route
// classification (`API_V1_ROUTE_ALLOWLIST[].operation`).

Deno.test("API-Q.7A-C1: organizations.get canonical operation is read", () => {
  assertStrictEquals(canonicalOperationClass("organizations.get"), "read");
});

Deno.test("API-Q.7A-C1: live registry remains valid under the parity guard", () => {
  // The current live organizations.get entry declares operationClass=read and
  // the canonical REST route classifies organizations.get as read.
  assertEquals(validateMcpToolRegistry(MCP_TOOL_REGISTRY), []);
  const live = MCP_TOOL_REGISTRY.find(
    (e) => e.operationId === "organizations.get",
  );
  assert(live !== undefined);
  assertStrictEquals(live.operationClass, "read");
  assertStrictEquals(canonicalOperationClass(live.operationId), "read");
});

Deno.test("API-Q.7A-C1: mutation operationId declared as read fails (registry=read canonical=mutation)", () => {
  // projects.update is a canonical mutation. Declaring it read must fail.
  const mismatched: McpToolRegistry = [
    {
      operationId: "projects.update",
      toolName: "btpm_projects_update_read",
      title: "Update project",
      description: "Incorrectly classified as read.",
      operationClass: "read",
      exposure: "not_exposed",
      confirmation: "not_required",
      resultShape: "single_object",
      concurrencyToken: "not_applicable",
    },
  ];
  const violations = validateMcpToolRegistry(mismatched);
  assertStrictEquals(canonicalOperationClass("projects.update"), "mutation");
  assert(
    violations.some((v) =>
      v === "operationClass mismatch for projects.update: registry=read canonical=mutation"
    ),
    `expected operationClass mismatch violation, got: ${JSON.stringify(violations)}`,
  );
});

Deno.test("API-Q.7A-C1: read operationId declared as mutation fails (registry=mutation canonical=read)", () => {
  // projects.get is a canonical read. Declaring it mutation must fail.
  const mismatched: McpToolRegistry = [
    {
      operationId: "projects.get",
      toolName: "btpm_projects_get_mutation",
      title: "List projects",
      description: "Incorrectly classified as mutation.",
      operationClass: "mutation",
      exposure: "not_exposed",
      confirmation: "required",
      resultShape: "bounded_collection",
      concurrencyToken: "required",
    },
  ];
  const violations = validateMcpToolRegistry(mismatched);
  assertStrictEquals(canonicalOperationClass("projects.get"), "read");
  assert(
    violations.some((v) =>
      v === "operationClass mismatch for projects.get: registry=mutation canonical=read"
    ),
    `expected operationClass mismatch violation, got: ${JSON.stringify(violations)}`,
  );
});

Deno.test("API-Q.7A-C1: correctly classified read and mutation fixtures remain valid", () => {
  // READ_FIXTURE (projects.get) is canonical read and declares read.
  assertStrictEquals(canonicalOperationClass(READ_FIXTURE.operationId), "read");
  assertEquals(validateMcpToolRegistry([READ_FIXTURE]), []);
  // MUTATION_FIXTURE (projects.update) is canonical mutation and declares mutation.
  assertStrictEquals(
    canonicalOperationClass(MUTATION_FIXTURE.operationId),
    "mutation",
  );
  assertEquals(validateMcpToolRegistry([MUTATION_FIXTURE]), []);
});

Deno.test("MCP-HARDENING-C1: every exposed entry is an explicit registry decision", () => {
  const exposed = exposedMcpTools();
  for (const entry of exposed) {
    assertStrictEquals(entry.exposure, "exposed", entry.operationId);
    assert(isCanonicalOperationId(entry.operationId), entry.operationId);
  }
});

Deno.test("MCP-HARDENING-C1: exposed mutations are confirmed and canonically classified", () => {
  const exposedMutations = exposedMcpTools().filter(
    (e) => e.operationClass === "mutation",
  );
  for (const entry of exposedMutations) {
    assertStrictEquals(entry.confirmation, "required", entry.operationId);
    assertStrictEquals(
      canonicalOperationClass(entry.operationId),
      "mutation",
      entry.operationId,
    );
  }
  assertStrictEquals(
    exposedMutations.length,
    MCP_TOOL_REGISTRY.filter((e) =>
      e.exposure === "exposed" && e.operationClass === "mutation"
    ).length,
  );
});


// API-Q.7A-C2 — Fail closed on duplicate canonical route definitions.
//
// The parity guard must resolve an operationId against
// `API_V1_ROUTE_ALLOWLIST` with bounded exact cardinality: zero, exactly one,
// or more than one. The previous `.find()`-based resolution detected zero but
// silently selected the first route when duplicates existed. These proofs
// exercise all three cardinalities using small pure allowlist fixtures so the
// immutable production allowlist is never mutated.

Deno.test("API-Q.7A-C2: organizations.get resolves uniquely to read (B)", () => {
  const resolution = resolveCanonicalRouteClass("organizations.get");
  assertStrictEquals(resolution.status, "unique");
  if (resolution.status === "unique") {
    assertStrictEquals(resolution.operationClass, "read");
  }
  // The convenience wrapper preserves the unique-class contract.
  assertStrictEquals(canonicalOperationClass("organizations.get"), "read");
});

Deno.test("API-Q.7A-C2: zero canonical route definitions fail closed (D)", () => {
  // Inject an allowlist that contains no route for organizations.get. The
  // operationId remains canonical per the capabilities contract, so the only
  // violation must be the missing-route cardinality failure.
  const emptyAllowlist: readonly ApiRouteDefinition[] = [];
  const resolution = resolveCanonicalRouteClass(
    "organizations.get",
    emptyAllowlist,
  );
  assertStrictEquals(resolution.status, "missing");

  const violations = validateMcpToolRegistry(
    [ORGANIZATIONS_READ_FIXTURE],
    emptyAllowlist,
  );
  assert(
    violations.some((v) =>
      v === "no canonical route definition for operationId: organizations.get"
    ),
    `expected missing-route violation, got: ${JSON.stringify(violations)}`,
  );
});

Deno.test("API-Q.7A-C2: duplicate canonical route definitions fail closed (E)", () => {
  // Inject an allowlist that defines the same route twice. The resolver must
  // never silently pick the first duplicate; it reports "duplicate" and the
  // validator emits the bounded duplicate violation.
  const duplicateAllowlist: readonly ApiRouteDefinition[] = [
    ORGANIZATIONS_ROUTE,
    ORGANIZATIONS_ROUTE,
  ];
  const resolution = resolveCanonicalRouteClass(
    "organizations.get",
    duplicateAllowlist,
  );
  assertStrictEquals(resolution.status, "duplicate");

  const violations = validateMcpToolRegistry(
    [ORGANIZATIONS_READ_FIXTURE],
    duplicateAllowlist,
  );
  assert(
    violations.some((v) =>
      v === "duplicate canonical route definitions for operationId: organizations.get"
    ),
    `expected duplicate-route violation, got: ${JSON.stringify(violations)}`,
  );
});

Deno.test("API-Q.7A-C2: live registry remains valid under exact-cardinality guard (A)", () => {
  // The production allowlist resolves each live operationId uniquely, so the
  // live registry must still produce zero violations.
  assertEquals(validateMcpToolRegistry(MCP_TOOL_REGISTRY), []);
  for (const entry of MCP_TOOL_REGISTRY) {
    const resolution = resolveCanonicalRouteClass(entry.operationId);
    assertStrictEquals(resolution.status, "unique");
  }
});

Deno.test("MCP-HARDENING-C1: exposed inventory resolves uniquely against the canonical allowlist", () => {
  const exposed = exposedMcpTools();
  for (const entry of exposed) {
    const resolution = resolveCanonicalRouteClass(entry.operationId);
    assertStrictEquals(resolution.status, "unique", entry.operationId);
    if (resolution.status === "unique") {
      assertStrictEquals(resolution.operationClass, entry.operationClass);
    }
  }
});

// =============================================================================
// API-Q.8 — Complete exposure registry invariants.
// =============================================================================


Deno.test("API-Q.8 (A/B/C): the registry covers every canonical operation exactly once", () => {
  assertEquals(validateMcpRegistryCoverage(MCP_TOOL_REGISTRY), []);
  assertEquals(validateMcpToolRegistry(MCP_TOOL_REGISTRY), []);

  const ids = MCP_TOOL_REGISTRY.map((e) => e.operationId as string);
  assertStrictEquals(new Set(ids).size, ids.length);
  assertStrictEquals(ids.length, canonicalOperationIds().length);
  assertEquals([...ids].sort(), [...canonicalOperationIds()].sort());
  for (const id of ids) {
    assertStrictEquals(resolveCanonicalRouteClass(id).status, "unique", id);
  }
});

Deno.test("API-Q.8 (D): operationClass parity is exact for every registry entry", () => {
  for (const entry of MCP_TOOL_REGISTRY) {
    assertStrictEquals(
      entry.operationClass,
      canonicalOperationClass(entry.operationId),
    );
  }
});

Deno.test("MCP-HARDENING-C1: reads and mutations partition the exposed inventory", () => {
  const exposed = exposedMcpTools();
  const reads = exposed.filter((e) => e.operationClass === "read");
  const mutations = exposed.filter((e) => e.operationClass === "mutation");
  assertStrictEquals(reads.length + mutations.length, exposed.length);
  for (const entry of reads) {
    assertStrictEquals(entry.concurrencyToken, "not_applicable", entry.operationId);
    assertStrictEquals(entry.confirmation, "not_required", entry.operationId);
  }
});

Deno.test("API-Q.8 (G/J): every mutation carries an explicit exposure decision and requires confirmation", () => {
  const mutations = MCP_TOOL_REGISTRY.filter(
    (e) => e.operationClass === "mutation",
  );
  assert(mutations.length > 0);
  for (const entry of mutations) {
    // Confirmation stays mandatory for every mutation, exposed or not.
    assertStrictEquals(entry.confirmation, "required", entry.operationId);
    assert(
      entry.exposure === "exposed" || entry.exposure === "not_exposed",
      `${entry.operationId} must carry an explicit exposure decision`,
    );
    // Exposure is resolved fail-closed from the declarative decision only.
    assertStrictEquals(
      isMcpOperationExposed(entry.operationId),
      entry.exposure === "exposed",
      entry.operationId,
    );
    assertStrictEquals(
      canonicalOperationClass(entry.operationId),
      "mutation",
      entry.operationId,
    );
  }
});

Deno.test("API-Q.8 (H): version.get and capabilities.get remain not_exposed", () => {
  for (const id of ["version.get", "capabilities.get"]) {
    const entry = MCP_TOOL_REGISTRY.find((e) => e.operationId === id);
    assert(entry !== undefined, `missing explicit decision for ${id}`);
    assertStrictEquals(entry.operationClass, "read");
    assertStrictEquals(entry.exposure, "not_exposed");
    assertStrictEquals(entry.confirmation, "not_required");
    assertStrictEquals(entry.concurrencyToken, "not_applicable");
    assertStrictEquals(isMcpOperationExposed(id), false);
  }
  assertEquals(
    MCP_TOOL_REGISTRY.filter((e) =>
      ["version.get", "capabilities.get", "me.get"].includes(
        e.operationId as string,
      )
    ).map((e) => e.toolName),
    ["btpm_get_version", "btpm_get_capabilities", "btpm_get_me"],
  );
});

Deno.test("API-Q.8 (I): tool names are unique across every registry entry", () => {
  const names = MCP_TOOL_REGISTRY.map((e) => e.toolName);
  assertStrictEquals(new Set(names).size, names.length);
  assertStrictEquals(names.length, MCP_TOOL_REGISTRY.length);
});

Deno.test("API-Q.8: coverage validator fails closed on undecided or non-canonical operations", () => {
  const partial = Object.freeze(
    MCP_TOOL_REGISTRY.filter((e) => e.operationId !== "tasks.create"),
  ) as McpToolRegistry;
  assert(validateMcpRegistryCoverage(partial).length > 0);
});

// ---------------------------------------------------------------------------
// API-Q WML-1B-C1 / WML-1C — explicit MCP exposure decision for the canonical
// Workspace-member read. WML-1C flipped exposure to `exposed`; all other
// metadata is unchanged.
// ---------------------------------------------------------------------------

Deno.test("API-Q WML-1C: workspace_members.get has an explicit exposed registry decision", () => {
  const entries = MCP_TOOL_REGISTRY.filter(
    (e) => (e.operationId as string) === "workspace_members.get",
  );
  assertStrictEquals(entries.length, 1);
  const entry = entries[0];
  assertStrictEquals(entry.toolName, "btpm_list_workspace_members");
  assertStrictEquals(entry.title, "List BTPM Workspace Members");
  assertStrictEquals(
    entry.description,
    "Bounded, server-paginated list of active members of one authorized BTPM Workspace, returning only user ID, display name and email.",
  );
  assertStrictEquals(entry.operationClass, "read");
  assertStrictEquals(entry.exposure, "exposed");
  assertStrictEquals(entry.confirmation, "not_required");
  assertStrictEquals(entry.resultShape, "bounded_collection");
  assertStrictEquals(entry.concurrencyToken, "not_applicable");

  assertStrictEquals(
    resolveCanonicalRouteClass("workspace_members.get").status,
    "unique",
  );
  assertStrictEquals(canonicalOperationClass("workspace_members.get"), "read");
  assertStrictEquals(isMcpOperationExposed("workspace_members.get"), true);
});

Deno.test("API-Q WML-1C: the Workspace-member tool is advertised exactly once", () => {
  const exposedIds = exposedMcpTools().map((e) => e.operationId as string);
  assert(exposedIds.includes("workspace_members.get"));
  const exposedNames = exposedMcpTools().map((e) => e.toolName);
  assertStrictEquals(
    exposedNames.filter((n) => n === "btpm_list_workspace_members").length,
    1,
  );
});

Deno.test("API-Q WML-1B-C1/WML-1C: registry coverage stays complete for every canonical operation", () => {
  assertEquals(validateMcpRegistryCoverage(MCP_TOOL_REGISTRY), []);
  assertEquals(validateMcpToolRegistry(MCP_TOOL_REGISTRY), []);
  assertEquals(
    MCP_TOOL_REGISTRY.map((e) => e.operationId as string).sort(),
    [...canonicalOperationIds()].sort(),
  );
});
