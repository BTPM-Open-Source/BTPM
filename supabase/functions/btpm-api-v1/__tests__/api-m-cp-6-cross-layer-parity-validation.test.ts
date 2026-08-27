// API-M.CP.6 — Cross-layer parity validation (permanent regression guard).
//
// Proves the frozen parity model stays coherent across every layer:
//
//   external operation
//     -> live route
//     -> /v1/capabilities advertisement
//     -> caller-bound dedicated read adapter
//     -> dedicated database wrapper
//     -> exact read capability key
//
// for Risk, Blocker, Execution Update, Phase and Task.
//
// This guard is static and pure: no network, no database connection, no
// secrets, no live API and no browser. It deliberately does NOT duplicate the
// accepted CP.2–CP.4 field-validation or containment suites, which remain
// authoritative for wrapper enforcement details.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { buildCapabilitiesPayload } from "../routes/capabilities.ts";
import { API_V1_ROUTE_ALLOWLIST } from "../router.ts";

const SHARED_DIR = "supabase/functions/_shared/btpm-api";
const MIGRATIONS_DIR = "supabase/migrations";
const INDEX_PATH = "supabase/functions/btpm-api-v1/index.ts";

// -----------------------------------------------------------------------------
// Frozen models
// -----------------------------------------------------------------------------

/** Frozen five-object operation matrix. No DELETE, no generic CRUD. */
const DOMAIN_OPERATION_MATRIX: Readonly<Record<string, readonly string[]>> =
  Object.freeze({
    Risk: Object.freeze([
      "risks.get",
      "risks.get_by_id",
      "risks.create",
      "risks.update",
    ]),
    Blocker: Object.freeze([
      "blockers.get",
      "blockers.get_by_id",
      "blockers.create",
      "blockers.update",
    ]),
    "Execution Update": Object.freeze([
      "execution_updates.get",
      "execution_updates.append",
    ]),
    Phase: Object.freeze([
      "phases.get_by_id",
      "phases.create",
      "phases.update",
      "phases.reorder",
      "phases.plan",
    ]),
    Task: Object.freeze([
      "tasks.get_by_id",
      "tasks.create",
      "tasks.update",
      "tasks.reorder",
      "tasks.plan",
      "tasks.assign",
      "tasks.transition",
    ]),
  });

/** Operation-id prefixes owned by the five parity domains. */
const DOMAIN_ID_PREFIXES: readonly string[] = Object.freeze([
  "risks.",
  "blockers.",
  "execution_updates.",
  "phases.",
  "tasks.",
]);

/** The seven accepted external parity read routes. */
const PARITY_READ_ROUTES: readonly {
  readonly id: string;
  readonly method: "GET";
  readonly path: string;
}[] = Object.freeze([
  { id: "risks.get", method: "GET", path: "/v1/projects/:projectid/risks" },
  { id: "risks.get_by_id", method: "GET", path: "/v1/risks/:riskid" },
  {
    id: "blockers.get",
    method: "GET",
    path: "/v1/projects/:projectid/blockers",
  },
  { id: "blockers.get_by_id", method: "GET", path: "/v1/blockers/:blockerid" },
  { id: "execution_updates.get", method: "GET", path: "/v1/execution-updates" },
  { id: "phases.get_by_id", method: "GET", path: "/v1/phases/:phaseid" },
  { id: "tasks.get_by_id", method: "GET", path: "/v1/tasks/:taskid" },
]);

/** Frozen read operation -> capability key model. */
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

const READ_CAPABILITY_KEYS: readonly string[] = Object.freeze([
  "blockers:read",
  "execution_updates:read",
  "phases:read",
  "risks:read",
  "tasks:read",
]);

/** Dedicated database read wrappers — the complete accepted set. */
const DEDICATED_WRAPPERS: readonly string[] = Object.freeze([
  "api_v1_list_project_risks",
  "api_v1_get_risk",
  "api_v1_list_project_blockers",
  "api_v1_get_blocker",
  "api_v1_list_execution_updates",
  "api_v1_get_phase",
  "api_v1_get_task",
]);

/** Per-wrapper capability key + accepted decrypted column evidence. */
const WRAPPER_POSTURE: readonly {
  readonly wrapper: string;
  readonly capabilityKey: string;
}[] = Object.freeze([
  { wrapper: "api_v1_list_project_risks", capabilityKey: "risks:read" },
  { wrapper: "api_v1_get_risk", capabilityKey: "risks:read" },
  { wrapper: "api_v1_list_project_blockers", capabilityKey: "blockers:read" },
  { wrapper: "api_v1_get_blocker", capabilityKey: "blockers:read" },
  {
    wrapper: "api_v1_list_execution_updates",
    capabilityKey: "execution_updates:read",
  },
  { wrapper: "api_v1_get_phase", capabilityKey: "phases:read" },
  { wrapper: "api_v1_get_task", capabilityKey: "tasks:read" },
]);

/** Read adapter modules and the wrappers each is allowed to call. */
const READ_ADAPTERS: readonly {
  readonly file: string;
  readonly wrappers: readonly string[];
}[] = Object.freeze([
  {
    file: "supabaseRiskRead.ts",
    wrappers: ["api_v1_list_project_risks", "api_v1_get_risk"],
  },
  {
    file: "supabaseBlockerRead.ts",
    wrappers: ["api_v1_list_project_blockers", "api_v1_get_blocker"],
  },
  {
    file: "supabaseExecutionUpdateRead.ts",
    wrappers: ["api_v1_list_execution_updates"],
  },
  { file: "supabasePhaseRead.ts", wrappers: ["api_v1_get_phase"] },
  { file: "supabaseTaskRead.ts", wrappers: ["api_v1_get_task"] },
]);

const DELEGATED_READ_MODULES: readonly string[] = Object.freeze([
  "supabaseDelegatedRiskRead.ts",
  "supabaseDelegatedBlockerRead.ts",
  "supabaseDelegatedExecutionUpdateRead.ts",
  "supabaseDelegatedPhaseRead.ts",
  "supabaseDelegatedTaskRead.ts",
]);

const ALL_READ_MODULES: readonly string[] = Object.freeze([
  ...READ_ADAPTERS.map((a) => a.file),
  ...DELEGATED_READ_MODULES,
]);

/** Generic read-dispatch architecture is permanently forbidden. */
const FORBIDDEN_GENERIC_READ_TOKENS: readonly string[] = Object.freeze([
  "api_v1_get_object",
  "api_v1_list_objects",
  "execute_read",
]);

// -----------------------------------------------------------------------------
// Static sources
// -----------------------------------------------------------------------------

async function readShared(file: string): Promise<string> {
  return await Deno.readTextFile(`${SHARED_DIR}/${file}`);
}

const SHARED_SOURCES: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    await Promise.all(
      ALL_READ_MODULES.map(async (f) => [f, await readShared(f)] as const),
    ),
  ),
);

const INDEX_SOURCE = await Deno.readTextFile(INDEX_PATH);

async function migrationSources(): Promise<
  readonly { readonly name: string; readonly sql: string }[]
> {
  const out: { name: string; sql: string }[] = [];
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".sql")) continue;
    out.push({
      name: entry.name,
      sql: await Deno.readTextFile(`${MIGRATIONS_DIR}/${entry.name}`),
    });
  }
  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return out;
}

const MIGRATIONS = await migrationSources();

/** Effective (latest committed) definition body of a wrapper. */
function effectiveWrapperDefinition(wrapper: string): string | null {
  const marker = `CREATE OR REPLACE FUNCTION public.${wrapper}(`;
  for (let i = MIGRATIONS.length - 1; i >= 0; i -= 1) {
    const sql = MIGRATIONS[i].sql;
    const start = sql.lastIndexOf(marker);
    if (start === -1) continue;
    const rest = sql.slice(start + marker.length);
    const next = rest.indexOf("CREATE OR REPLACE FUNCTION public.");
    return marker + (next === -1 ? rest : rest.slice(0, next));
  }
  return null;
}

// -----------------------------------------------------------------------------
// 2. Frozen five-object operation matrix
// -----------------------------------------------------------------------------

Deno.test("API-M.CP.6: the five parity domains expose exactly the frozen operation matrix", () => {
  const liveIds = API_V1_ROUTE_ALLOWLIST.map((r) => r.id) as readonly string[];
  const expected = Object.values(DOMAIN_OPERATION_MATRIX).flat();
  for (const id of expected) {
    assertEquals(liveIds.filter((x) => x === id).length, 1, `not live: ${id}`);
  }
  const domainLiveIds = liveIds.filter((id) =>
    DOMAIN_ID_PREFIXES.some((p) => id.startsWith(p))
  );
  assertEquals([...domainLiveIds].sort(), [...expected].sort());
});

Deno.test("API-M.CP.6: no DELETE operation exists anywhere in the live surface", () => {
  for (const route of API_V1_ROUTE_ALLOWLIST) {
    assert(route.method !== ("DELETE" as unknown), route.id);
    assert(!route.id.includes("delete"), route.id);
    assert(!route.id.includes("destroy"), route.id);
  }
});

Deno.test("API-M.CP.6: projects.planning.get remains live and distinct", () => {
  const route = API_V1_ROUTE_ALLOWLIST.find(
    (r) => r.id === "projects.planning.get",
  );
  assert(route !== undefined);
  assertEquals(route.operation, "read");
  assertEquals(route.method, "GET");
  const all = Object.values(DOMAIN_OPERATION_MATRIX).flat();
  assert(!all.includes("projects.planning.get"));
});

// -----------------------------------------------------------------------------
// 3. Exact read routes
// -----------------------------------------------------------------------------
//
// API-N.RG1B — global runtime cardinality and whole-surface `/v1/capabilities`
// parity are owned solely by api-v1-current-surface-topology.test.ts.

Deno.test("API-M.CP.6: the seven parity reads have the exact accepted method and path", () => {
  assertEquals(PARITY_READ_ROUTES.length, 7);
  for (const expected of PARITY_READ_ROUTES) {
    const route = API_V1_ROUTE_ALLOWLIST.find((r) => r.id === expected.id);
    assert(route !== undefined, `not live: ${expected.id}`);
    assertEquals(route.method, expected.method, expected.id);
    assertEquals(route.path, expected.path, expected.id);
    assertEquals(route.operation, "read", expected.id);
  }
});

// -----------------------------------------------------------------------------
// 4. Capability advertisement parity (permanent, no deferral mechanism)
// -----------------------------------------------------------------------------

Deno.test("API-M.CP.6/API-N.RG1B: every five-domain operation is advertised exactly once", () => {
  const ops = buildCapabilitiesPayload().supportedOperations as
    readonly string[];
  for (const id of Object.values(DOMAIN_OPERATION_MATRIX).flat()) {
    assertEquals(ops.filter((o) => o === id).length, 1, id);
  }
});


Deno.test("API-M.CP.6: no capability-advertisement deferral mechanism exists", async () => {
  const capabilities = await Deno.readTextFile(
    "supabase/functions/btpm-api-v1/routes/capabilities.ts",
  );
  for (const token of [
    "CAPABILITY_DEFERRED_OPERATION_IDS",
    "deferredOperations",
    "DEFERRED_OPERATION",
  ]) {
    assert(!capabilities.includes(token), token);
  }
});

// -----------------------------------------------------------------------------
// 5. Operation -> capability key model
// -----------------------------------------------------------------------------

Deno.test("API-M.CP.6: read operation -> capability mapping is the frozen five-key model", () => {
  assertEquals(
    Object.keys(OPERATION_CAPABILITY_MODEL).sort(),
    PARITY_READ_ROUTES.map((r) => r.id).sort(),
  );
  assertEquals(
    [...new Set(Object.values(OPERATION_CAPABILITY_MODEL))].sort(),
    [...READ_CAPABILITY_KEYS],
  );
  // Risk and Blocker share one domain read capability across collection+detail.
  assertEquals(
    OPERATION_CAPABILITY_MODEL["risks.get"],
    OPERATION_CAPABILITY_MODEL["risks.get_by_id"],
  );
  assertEquals(
    OPERATION_CAPABILITY_MODEL["blockers.get"],
    OPERATION_CAPABILITY_MODEL["blockers.get_by_id"],
  );
});

Deno.test("API-M.CP.6: no split list/detail read capability key is registered", () => {
  const forbidden = [
    "risks:list",
    "risks:get",
    "blockers:list",
    "blockers:get",
  ];
  for (const key of forbidden) {
    assert(!Object.values(OPERATION_CAPABILITY_MODEL).includes(key), key);
    for (const migration of MIGRATIONS) {
      assert(
        !migration.sql.includes(`'${key}'`),
        `${key} in ${migration.name}`,
      );
    }
  }
});

// -----------------------------------------------------------------------------
// 6. Dedicated read architecture
// -----------------------------------------------------------------------------

Deno.test("API-M.CP.6: each read adapter maps only to its dedicated wrappers", () => {
  for (const adapter of READ_ADAPTERS) {
    const source = SHARED_SOURCES[adapter.file];
    for (const wrapper of adapter.wrappers) {
      assert(
        source.includes(`"${wrapper}"`),
        `${adapter.file} missing ${wrapper}`,
      );
    }
    const others = DEDICATED_WRAPPERS.filter(
      (w) => !adapter.wrappers.includes(w),
    );
    for (const other of others) {
      assert(
        !source.includes(`"${other}"`),
        `${adapter.file} must not call ${other}`,
      );
    }
  }
});

Deno.test("API-M.CP.6: no generic read dispatcher exists in the read modules", () => {
  for (const file of ALL_READ_MODULES) {
    const source = SHARED_SOURCES[file];
    for (const token of FORBIDDEN_GENERIC_READ_TOKENS) {
      assert(!source.includes(token), `${file}: ${token}`);
    }
    // No consumer-supplied table / RPC / function name.
    assert(!/\.rpc\(\s*functionName/.test(source), `${file}: dynamic rpc name`);
    assert(!/\.rpc\(\s*name/.test(source), `${file}: dynamic rpc name`);
    assert(!/\.rpc\(\s*table/.test(source), `${file}: dynamic rpc name`);
  }
});

// -----------------------------------------------------------------------------
// 7. Caller-bound business-read posture
// -----------------------------------------------------------------------------

Deno.test("API-M.CP.6: read modules use no service-role key, table read, fetch or env", () => {
  for (const file of ALL_READ_MODULES) {
    const source = SHARED_SOURCES[file];
    assert(!source.includes("SERVICE_ROLE"), `${file}: service role`);
    assert(!source.includes("service_role"), `${file}: service role`);
    assert(!source.includes("serviceRole"), `${file}: service role`);
    assert(!/\.from\(/.test(source), `${file}: direct table read`);
    assert(!/\bfetch\(/.test(source), `${file}: fetch`);
    assert(!source.includes("Deno.env"), `${file}: Deno.env`);
  }
});

Deno.test("API-M.CP.6: delegated readers stay bearer-bound and anon-key based", () => {
  for (const file of DELEGATED_READ_MODULES) {
    const source = SHARED_SOURCES[file];
    assert(source.includes("extractBearerToken"), `${file}: bearer binding`);
    assert(
      source.includes("`Bearer ${token}`"),
      `${file}: Authorization header`,
    );
    assert(source.includes("supabaseAnonKey"), `${file}: anon key parameter`);
    assert(source.includes("persistSession: false"), `${file}: session posture`);
  }
});

Deno.test("API-M.CP.6: index.ts wires all five domain readers with the anon key only", () => {
  const factories = [
    "createDelegatedApiV1ProjectRisksReader",
    "createDelegatedApiV1RiskReader",
    "createDelegatedApiV1ProjectBlockersReader",
    "createDelegatedApiV1BlockerReader",
    "createDelegatedApiV1ExecutionUpdatesReader",
    "createDelegatedApiV1PhaseReader",
    "createDelegatedApiV1TaskReader",
  ];
  for (const factory of factories) {
    const at = INDEX_SOURCE.indexOf(`${factory}(`, INDEX_SOURCE.indexOf(
      `= ${factory}(`,
    ) === -1
      ? INDEX_SOURCE.lastIndexOf(`${factory}(`)
      : INDEX_SOURCE.indexOf(`= ${factory}(`));
    assert(at !== -1, `${factory} not wired`);
    const call = INDEX_SOURCE.slice(at, INDEX_SOURCE.indexOf(");", at));
    assert(call.includes("supabaseUrl"), `${factory}: supabaseUrl`);
    assert(call.includes("supabaseAnonKey"), `${factory}: supabaseAnonKey`);
    assert(
      !call.includes("serviceRole") && !call.includes("SERVICE_ROLE"),
      `${factory}: privileged client`,
    );
  }
});

// -----------------------------------------------------------------------------
// 8. Final database wrapper posture (committed migration source only)
// -----------------------------------------------------------------------------

Deno.test("API-M.CP.6: every dedicated wrapper keeps the accepted security posture", () => {
  for (const row of WRAPPER_POSTURE) {
    const definition = effectiveWrapperDefinition(row.wrapper);
    assert(definition !== null, `missing wrapper: ${row.wrapper}`);
    assert(definition.includes("SECURITY DEFINER"), `${row.wrapper}: definer`);
    assert(/\bSTABLE\b/.test(definition), `${row.wrapper}: stable`);
    assert(
      definition.includes("SET search_path TO 'pg_catalog'"),
      `${row.wrapper}: search_path`,
    );
    assert(
      definition.includes(`'${row.capabilityKey}'`),
      `${row.wrapper}: capability key`,
    );
    assert(
      definition.includes("public.btpm_decrypt("),
      `${row.wrapper}: protected/decrypted read path`,
    );
  }
});

Deno.test("API-M.CP.6: wrappers grant EXECUTE to authenticated and never to service_role consumers", () => {
  for (const wrapper of DEDICATED_WRAPPERS) {
    const authenticated = MIGRATIONS.some((m) =>
      new RegExp(
        `GRANT EXECUTE ON FUNCTION public\\.${wrapper}\\([^)]*\\) TO authenticated;`,
      ).test(m.sql)
    );
    assert(authenticated, `${wrapper}: missing authenticated execute grant`);
    for (const migration of MIGRATIONS) {
      const serviceRole = new RegExp(
        `GRANT EXECUTE ON FUNCTION public\\.${wrapper}\\([^)]*\\)[^;]*service_role`,
        "i",
      ).test(migration.sql);
      assert(
        !serviceRole,
        `${wrapper}: service_role execute grant in ${migration.name}`,
      );
    }
  }
});

// -----------------------------------------------------------------------------
// 9. API-M.12 documentation deferral preserved
// -----------------------------------------------------------------------------

Deno.test("API-M.CP.6: the seven parity reads remain pending external documentation", async () => {
  const k9 = await Deno.readTextFile(
    "supabase/functions/btpm-api-v1/__tests__/api-k-9-external-contract-regression.test.ts",
  );
  const start = k9.indexOf("PENDING_DOCUMENTATION_OPERATION_IDS");
  assert(start !== -1);
  const block = k9.slice(start, k9.indexOf("]);", start));
  for (const route of PARITY_READ_ROUTES) {
    assert(block.includes(`"${route.id}"`), `not pending docs: ${route.id}`);
  }
  // Capability advertisement parity is closed; documentation parity is not.
  assert(!k9.includes("CAPABILITY_DEFERRED_OPERATION_IDS"));
});

// -----------------------------------------------------------------------------
// No auto-grant semantics
// -----------------------------------------------------------------------------

Deno.test("API-M.CP.6: advertisement implies no Connected App assignment", () => {
  // /v1/capabilities is version-scoped, never client-specific: the payload
  // builder takes no arguments and reads no grant/enablement state.
  assertEquals(buildCapabilitiesPayload.length, 0);
  const payload = buildCapabilitiesPayload() as unknown as
    Record<string, unknown>;
  assertEquals(Object.keys(payload).sort(), [
    "apiVersion",
    "service",
    "supportedOperations",
  ]);
});
