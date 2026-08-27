// API-N.10B — Project + Program cross-layer parity regression guard.
//
// This is a PERMANENT regression guard. It changes no production behavior and
// adds no migration. It proves that the frozen API-N Project + Program
// operation family is coherent across every accepted external layer:
//
//   route allowlist -> capability catalogue -> dedicated database wrapper
//   -> canonical PMG function -> caller-bound delegated adapter
//
// It also proves read/write field parity, the containment model, and that the
// idempotency / optimistic-concurrency / confirmation contracts are uniform.
//
// No authorization decision, business rule or HTTP behavior is implemented
// here. Static assertions read repository source text; the few functional
// assertions use pure injected stubs (no environment, network or Supabase).

import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { API_V1_ROUTE_ALLOWLIST } from "../router.ts";
import { buildCapabilitiesPayload } from "../routes/capabilities.ts";
import {
  PROGRAM_CREATE_ROUTE,
  PROGRAM_DETAIL_ROUTE,
  PROGRAM_UPDATE_ROUTE,
  PROGRAMS_ROUTE,
} from "../routes/programs.ts";
import {
  PROJECT_CREATE_ROUTE,
  PROJECT_TRANSITION_ROUTE,
  PROJECT_UPDATE_NARRATIVE_FIELDS,
  PROJECT_UPDATE_ROUTE,
  PROJECTS_ROUTE,
} from "../routes/projects.ts";
import { PROJECT_DETAIL_ROUTE } from "../routes/projectDetail.ts";
import { createDelegatedApiV1UpdateProgramExecutor } from "../../_shared/btpm-api/supabaseDelegatedProgramMutation.ts";
import { createDelegatedApiV1UpdateProjectExecutor } from "../../_shared/btpm-api/supabaseDelegatedProjectMutation.ts";

// -----------------------------------------------------------------------------
// 1. The frozen API-N Project + Program operation family
// -----------------------------------------------------------------------------

interface FamilyOperation {
  readonly id: string;
  readonly method: "GET" | "POST" | "PATCH";
  readonly path: string;
  readonly operation: "read" | "mutation";
  readonly capabilityKey: string;
  readonly scopeLevel: "workspace" | "project";
}

const FAMILY: ReadonlyArray<FamilyOperation> = Object.freeze([
  {
    id: "programs.get",
    method: "GET",
    path: "/v1/programs",
    operation: "read",
    capabilityKey: "programs:list",
    scopeLevel: "workspace",
  },
  {
    id: "programs.get_by_id",
    method: "GET",
    path: "/v1/programs/:programid",
    operation: "read",
    capabilityKey: "programs:read",
    scopeLevel: "workspace",
  },
  {
    id: "programs.create",
    method: "POST",
    path: "/v1/programs",
    operation: "mutation",
    capabilityKey: "programs:create",
    scopeLevel: "workspace",
  },
  {
    id: "programs.update",
    method: "PATCH",
    path: "/v1/programs/:programid",
    operation: "mutation",
    capabilityKey: "programs:update",
    scopeLevel: "workspace",
  },
  {
    id: "projects.get",
    method: "GET",
    path: "/v1/projects",
    operation: "read",
    capabilityKey: "projects:list",
    scopeLevel: "workspace",
  },
  {
    id: "projects.get_by_id",
    method: "GET",
    path: "/v1/projects/:projectid",
    operation: "read",
    capabilityKey: "projects:read",
    scopeLevel: "project",
  },
  {
    id: "projects.create",
    method: "POST",
    path: "/v1/projects",
    operation: "mutation",
    capabilityKey: "projects:create",
    scopeLevel: "workspace",
  },
  {
    id: "projects.update",
    method: "PATCH",
    path: "/v1/projects/:projectid",
    operation: "mutation",
    capabilityKey: "projects:update",
    scopeLevel: "workspace",
  },
  {
    id: "projects.transition",
    method: "POST",
    path: "/v1/projects/:projectid/transition",
    operation: "mutation",
    capabilityKey: "projects:transition",
    scopeLevel: "workspace",
  },
]);

/** Command -> dedicated API-F wrapper -> canonical PMG function. */
const COMMAND_EXECUTION_CHAIN: ReadonlyArray<{
  readonly id: string;
  readonly wrapper: string;
  readonly pmg: string;
  readonly capabilityKey: string;
  readonly optimisticConcurrency: boolean;
  readonly confirmation: boolean;
}> = Object.freeze([
  {
    id: "projects.create",
    wrapper: "api_v1_create_project",
    pmg: "apply_project_create_blank",
    capabilityKey: "projects:create",
    optimisticConcurrency: false,
    confirmation: false,
  },
  {
    id: "projects.update",
    wrapper: "api_v1_update_project",
    pmg: "apply_project_update",
    capabilityKey: "projects:update",
    optimisticConcurrency: true,
    confirmation: false,
  },
  {
    id: "projects.transition",
    wrapper: "api_v1_transition_project",
    pmg: "apply_project_status_transition",
    capabilityKey: "projects:transition",
    optimisticConcurrency: true,
    confirmation: true,
  },
  {
    id: "programs.create",
    wrapper: "api_v1_create_program",
    pmg: "apply_program_create",
    capabilityKey: "programs:create",
    optimisticConcurrency: false,
    confirmation: false,
  },
  {
    id: "programs.update",
    wrapper: "api_v1_update_program",
    pmg: "apply_program_update",
    capabilityKey: "programs:update",
    optimisticConcurrency: true,
    confirmation: false,
  },
]);

const MIGRATIONS_DIR = "supabase/migrations";
const SHARED_DIR = "supabase/functions/_shared/btpm-api";

// -----------------------------------------------------------------------------
// Source helpers (repository text only; no network, no environment)
// -----------------------------------------------------------------------------

async function readMigrationNames(): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (entry.isFile && entry.name.endsWith(".sql")) names.push(entry.name);
  }
  return names.sort();
}

let migrationCache: Map<string, string> | null = null;

async function readMigrations(): Promise<Map<string, string>> {
  if (migrationCache !== null) return migrationCache;
  const map = new Map<string, string>();
  for (const name of await readMigrationNames()) {
    map.set(name, await Deno.readTextFile(`${MIGRATIONS_DIR}/${name}`));
  }
  migrationCache = map;
  return map;
}

/** Latest migration text that defines the given public function. */
async function readLatestWrapperSource(wrapper: string): Promise<string> {
  const migrations = await readMigrations();
  let latest: string | null = null;
  for (const [, source] of migrations) {
    if (source.includes(`CREATE OR REPLACE FUNCTION public.${wrapper}(`)) {
      latest = source;
    }
  }
  assert(latest !== null, `no migration defines public.${wrapper}`);
  return latest as string;
}

/** The exact definition body of the given wrapper, from its latest migration. */
async function readLatestWrapperBody(wrapper: string): Promise<string> {
  const source = await readLatestWrapperSource(wrapper);
  const start = source.lastIndexOf(
    `CREATE OR REPLACE FUNCTION public.${wrapper}(`,
  );
  assert(start !== -1);
  const end = source.indexOf("$function$;", start);
  assert(end !== -1, `unterminated body for public.${wrapper}`);
  return source.slice(start, end);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// -----------------------------------------------------------------------------
// 2. Route matrix parity
// -----------------------------------------------------------------------------

Deno.test("API-N.10B: every family operation is live exactly once with its exact route contract", () => {
  for (const op of FAMILY) {
    const matches = API_V1_ROUTE_ALLOWLIST.filter((r) => r.id === op.id);
    assertEquals(matches.length, 1, `not registered exactly once: ${op.id}`);
    const route = matches[0];
    assertEquals(route.method, op.method, op.id);
    assertEquals(route.path, op.path, op.id);
    assertEquals(route.operation, op.operation, op.id);
  }
});

Deno.test("API-N.10B: exported route constants are identical to the live allowlist entries", () => {
  const constants = [
    PROGRAMS_ROUTE,
    PROGRAM_DETAIL_ROUTE,
    PROGRAM_CREATE_ROUTE,
    PROGRAM_UPDATE_ROUTE,
    PROJECTS_ROUTE,
    PROJECT_DETAIL_ROUTE,
    PROJECT_CREATE_ROUTE,
    PROJECT_UPDATE_ROUTE,
    PROJECT_TRANSITION_ROUTE,
  ] as ReadonlyArray<{
    id: string;
    method: string;
    path: string;
    operation: string;
  }>;
  assertEquals(constants.length, FAMILY.length);
  for (const constant of constants) {
    const op = FAMILY.find((o) => o.id === constant.id);
    assert(op !== undefined, `unknown family route constant: ${constant.id}`);
    assertEquals(constant.method, op.method, constant.id);
    assertEquals(constant.path, op.path, constant.id);
    assertEquals(constant.operation, op.operation, constant.id);
    assert(Object.isFrozen(constant), `not frozen: ${constant.id}`);
  }
});

Deno.test("API-N.10B: every family operation is advertised exactly once by /v1/capabilities", () => {
  const advertised = buildCapabilitiesPayload()
    .supportedOperations as readonly string[];
  for (const op of FAMILY) {
    assertEquals(
      advertised.filter((id) => id === op.id).length,
      1,
      `not advertised exactly once: ${op.id}`,
    );
  }
});

Deno.test("API-N.10B: the family contributes 4 reads and 5 mutations and no other Project/Program route exists", () => {
  assertEquals(FAMILY.filter((o) => o.operation === "read").length, 4);
  assertEquals(FAMILY.filter((o) => o.operation === "mutation").length, 5);

  const familyIds = new Set(FAMILY.map((o) => o.id));
  const strays = API_V1_ROUTE_ALLOWLIST.filter((route) =>
    (route.id.startsWith("projects.") || route.id.startsWith("programs.")) &&
    !familyIds.has(route.id)
  ).map((route) => route.id);
  // `projects.planning.get` is the single accepted non-API-N Project read.
  assertEquals(strays, ["projects.planning.get"]);
});

// -----------------------------------------------------------------------------
// 3. Capability model parity
// -----------------------------------------------------------------------------

Deno.test("API-N.10B: each family operation has exactly one catalogue capability with the exact scope", async () => {
  const migrations = await readMigrations();
  for (const op of FAMILY) {
    const pattern = new RegExp(
      [
        "'v1',\\s*",
        `'(read|command)',\\s*`,
        `'${escapeRegExp(op.capabilityKey)}',\\s*`,
        `'${escapeRegExp(op.id)}',\\s*`,
        `'${op.method}',\\s*`,
        `'${escapeRegExp(op.path)}',\\s*`,
        "'(\\w+)'",
      ].join(""),
    );
    const rows: string[][] = [];
    for (const [, source] of migrations) {
      const match = pattern.exec(source);
      if (match !== null) rows.push([match[1], match[2]]);
    }
    assertEquals(
      rows.length,
      1,
      `expected exactly one catalogue row for ${op.capabilityKey}`,
    );
    assertEquals(
      rows[0][0],
      op.operation === "read" ? "read" : "command",
      op.capabilityKey,
    );
    assertEquals(rows[0][1], op.scopeLevel, op.capabilityKey);
  }
});

Deno.test("API-N.10B: each command wrapper pins its capability key as an immutable constant", async () => {
  for (const command of COMMAND_EXECUTION_CHAIN) {
    const body = await readLatestWrapperBody(command.wrapper);
    assert(
      body.includes(
        `c_capability_key  constant text := '${command.capabilityKey}'`,
      ) ||
        body.includes(
          `c_capability_key constant text := '${command.capabilityKey}'`,
        ),
      `${command.wrapper} does not pin ${command.capabilityKey}`,
    );
    // No other family capability key may appear in the wrapper.
    for (const other of COMMAND_EXECUTION_CHAIN) {
      if (other.capabilityKey === command.capabilityKey) continue;
      assert(
        !body.includes(`'${other.capabilityKey}'`),
        `${command.wrapper} references foreign capability ${other.capabilityKey}`,
      );
    }
  }
});

Deno.test("API-N.10B: no family capability is caller-supplied or wildcard-derived", async () => {
  const files = [
    "supabaseProgramMutation.ts",
    "supabaseProjectMutation.ts",
    "supabaseDelegatedProgramMutation.ts",
    "supabaseDelegatedProjectMutation.ts",
    "supabaseProgramRead.ts",
    "supabaseProjects.ts",
    "supabaseProjectDetail.ts",
  ];
  for (const file of files) {
    const source = await Deno.readTextFile(`${SHARED_DIR}/${file}`);
    assert(!/capabilityKey/.test(source), `${file} accepts a capability key`);
    assert(!source.includes("programs:*"), file);
    assert(!source.includes("projects:*"), file);
  }
});

// -----------------------------------------------------------------------------
// 4. Dedicated database surface parity
// -----------------------------------------------------------------------------

Deno.test("API-N.10B: every command has a dedicated SECURITY DEFINER wrapper with a pinned search_path", async () => {
  for (const command of COMMAND_EXECUTION_CHAIN) {
    const body = await readLatestWrapperBody(command.wrapper);
    assert(body.includes("SECURITY DEFINER"), command.wrapper);
    assert(
      /SET search_path TO 'pg_catalog', 'public'/.test(body),
      `${command.wrapper} lacks the pinned search_path`,
    );
    assert(body.includes("LANGUAGE plpgsql"), command.wrapper);
  }
});

Deno.test("API-N.10B: every command wrapper delegates to exactly its canonical PMG function", async () => {
  const allPmg = COMMAND_EXECUTION_CHAIN.map((c) => c.pmg);
  for (const command of COMMAND_EXECUTION_CHAIN) {
    const body = await readLatestWrapperBody(command.wrapper);
    assert(
      body.includes(`public.${command.pmg}(`),
      `${command.wrapper} does not call public.${command.pmg}`,
    );
    for (const pmg of allPmg) {
      if (pmg === command.pmg) continue;
      assert(
        !body.includes(`public.${pmg}(`),
        `${command.wrapper} also calls public.${pmg}`,
      );
    }
  }
});

Deno.test("API-N.10B: no command wrapper uses dynamic SQL or a generic dispatcher", async () => {
  for (const command of COMMAND_EXECUTION_CHAIN) {
    const body = await readLatestWrapperBody(command.wrapper);
    assert(!/\bEXECUTE\s+format\b/i.test(body), command.wrapper);
    assert(!/\bEXECUTE\s+'/i.test(body), command.wrapper);
    assert(!/quote_ident\s*\(/i.test(body), command.wrapper);
  }
});

Deno.test("API-N.10B: RPC adapters bind exactly one hardcoded wrapper name each and never touch tables", async () => {
  const adapters: ReadonlyArray<[string, readonly string[]]> = [
    ["supabaseProjectMutation.ts", [
      "api_v1_create_project",
      "api_v1_update_project",
      "api_v1_transition_project",
    ]],
    ["supabaseProgramMutation.ts", [
      "api_v1_create_program",
      "api_v1_update_program",
    ]],
  ];
  for (const [file, wrappers] of adapters) {
    const source = await Deno.readTextFile(`${SHARED_DIR}/${file}`);
    assert(!source.includes(".from("), `${file} performs a table operation`);
    assert(
      !source.includes("service_role") &&
        !source.includes("SERVICE_ROLE"),
      `${file} references the service-role key`,
    );
    for (const wrapper of wrappers) {
      assert(
        source.includes(`= "${wrapper}"`),
        `${file} missing pinned wrapper constant ${wrapper}`,
      );
    }
  }
});

// -----------------------------------------------------------------------------
// 5. Caller-bound delegated adapter architecture
// -----------------------------------------------------------------------------

Deno.test("API-N.10B: delegated family adapters are anon-key, caller-token bound and per-invocation", async () => {
  const files = [
    "supabaseDelegatedProgramRead.ts",
    "supabaseDelegatedProgramMutation.ts",
    "supabaseDelegatedProjects.ts",
    "supabaseDelegatedProjectDetail.ts",
    "supabaseDelegatedProjectMutation.ts",
  ];
  for (const file of files) {
    const source = await Deno.readTextFile(`${SHARED_DIR}/${file}`);
    assert(source.includes("supabaseAnonKey"), file);
    assert(source.includes("Authorization: `Bearer ${token}`"), file);
    assert(source.includes("extractBearerToken(request)"), file);
    assert(source.includes("persistSession: false"), file);
    assert(!source.includes("Deno.env"), `${file} reads the environment`);
    assert(
      !source.includes("service_role") && !source.includes("SERVICE_ROLE"),
      `${file} references the service-role key`,
    );
    assert(!source.includes("createClient from"), file);
  }
});

const IDENTITY_USER = "11111111-1111-4111-8111-111111111111";
const IDENTITY_CLIENT = "22222222-2222-4222-8222-222222222222";
const IDENTITY_POLICY = "33333333-3333-4333-8333-333333333333";
const OAUTH_CLIENT_ID = "oauth-client-n10b";
const TARGET_ID = "dddddddd-4444-4444-8444-444444444444";

const IDENTITY_CONTEXT = Object.freeze({
  token: Object.freeze({ userId: IDENTITY_USER, clientId: OAUTH_CLIENT_ID }),
  client: Object.freeze({
    userId: IDENTITY_USER,
    apiClientId: IDENTITY_CLIENT,
    policyVersionId: IDENTITY_POLICY,
    oauthClientId: OAUTH_CLIENT_ID,
  }),
});

const EXECUTION_CONTEXT = Object.freeze({
  requestedUserId: IDENTITY_USER,
  executingUserId: IDENTITY_USER,
  apiClientId: IDENTITY_CLIENT,
  oauthClientId: OAUTH_CLIENT_ID,
  policyVersionId: IDENTITY_POLICY,
  sourceChannel: "external_api",
  delegationMode: "delegated_user",
  requestId: "req-n10b-0001",
  correlationId: "req-n10b-0001",
  idempotencyKey: "idem-n10b-0001",
  payloadHash: "a".repeat(64),
});

function bearerRequest(): Request {
  return new Request("https://api.example.test/v1/programs/x", {
    method: "PATCH",
    headers: new Headers({ Authorization: "Bearer caller-token-n10b" }),
  });
}

Deno.test("API-N.10B: delegated Program update fails closed on identity inconsistency before any client is built", async () => {
  let built = 0;
  const executor = createDelegatedApiV1UpdateProgramExecutor(
    "https://project.supabase.co",
    "anon-key",
    () => {
      built += 1;
      return { rpc: () => Promise.resolve({ data: null, error: null }) };
    },
  );
  await assertRejects(() =>
    executor(
      bearerRequest(),
      IDENTITY_CONTEXT as never,
      TARGET_ID,
      { expectedUpdatedAt: "2026-08-12T10:00:00+00:00" } as never,
      {
        ...EXECUTION_CONTEXT,
        executingUserId: "99999999-9999-4999-8999-999999999999",
      } as never,
    )
  );
  assertEquals(built, 0);
});

Deno.test("API-N.10B: delegated Project update fails closed when the source channel is not external_api", async () => {
  let built = 0;
  const executor = createDelegatedApiV1UpdateProjectExecutor(
    "https://project.supabase.co",
    "anon-key",
    () => {
      built += 1;
      return { rpc: () => Promise.resolve({ data: null, error: null }) };
    },
  );
  await assertRejects(() =>
    executor(
      bearerRequest(),
      IDENTITY_CONTEXT as never,
      TARGET_ID,
      { expectedUpdatedAt: "2026-08-12T10:00:00+00:00" } as never,
      { ...EXECUTION_CONTEXT, sourceChannel: "browser" } as never,
    )
  );
  assertEquals(built, 0);
});

// -----------------------------------------------------------------------------
// 6. Read / write field parity
// -----------------------------------------------------------------------------

async function readFrozenKeyBlock(
  file: string,
  constant: string,
): Promise<string[]> {
  const source = await Deno.readTextFile(`${SHARED_DIR}/${file}`);
  const start = source.indexOf(`const ${constant}`);
  assert(start !== -1, `${file} has no ${constant}`);
  const open = source.indexOf("[", start);
  const close = source.indexOf("]", open);
  assert(open !== -1 && close !== -1);
  return source.slice(open + 1, close)
    .split(",")
    .map((raw) => raw.trim().replace(/^"|"$/g, ""))
    .filter((value) => value.length > 0);
}

Deno.test("API-N.10B: Program reads expose exactly the accepted field sets", async () => {
  assertEquals(
    await readFrozenKeyBlock("supabaseProgramRead.ts", "EXPECTED_ITEM_KEYS"),
    [
      "programId",
      "organizationId",
      "workspaceId",
      "name",
      "status",
      "createdAt",
      "updatedAt",
    ],
  );
  assertEquals(
    await readFrozenKeyBlock("supabaseProgramRead.ts", "EXPECTED_DETAIL_KEYS"),
    [
      "programId",
      "organizationId",
      "workspaceId",
      "name",
      "description",
      "status",
      "createdAt",
      "updatedAt",
    ],
  );
});

Deno.test("API-N.10B: every externally mutable Program field is externally readable", async () => {
  const detail = new Set(
    await readFrozenKeyBlock("supabaseProgramRead.ts", "EXPECTED_DETAIL_KEYS"),
  );
  for (const field of ["name", "status", "description", "updatedAt"]) {
    assert(detail.has(field), `Program detail read omits ${field}`);
  }
});

Deno.test("API-N.10B: every externally mutable Project field is externally readable", async () => {
  const detail = new Set(
    await readFrozenKeyBlock("supabaseProjectDetail.ts", "EXPECTED_PAYLOAD_KEYS"),
  );
  const mutable = [
    "name",
    "priority",
    "programId",
    "deliveryModel",
    "status",
    "updatedAt",
    ...PROJECT_UPDATE_NARRATIVE_FIELDS,
  ];
  for (const field of mutable) {
    assert(detail.has(field), `Project detail read omits ${field}`);
  }
});

Deno.test("API-N.10B: no family read module writes and no family command module reads", async () => {
  for (
    const file of [
      "supabaseProgramRead.ts",
      "supabaseProjects.ts",
      "supabaseProjectDetail.ts",
    ]
  ) {
    const source = await Deno.readTextFile(`${SHARED_DIR}/${file}`);
    assert(!source.includes("api_v1_create_"), file);
    assert(!source.includes("api_v1_update_"), file);
    assert(!source.includes("api_v1_transition_"), file);
    assert(!source.includes("idempotencyKey"), `${file} carries mutation state`);
  }
  for (
    const file of ["supabaseProgramMutation.ts", "supabaseProjectMutation.ts"]
  ) {
    const source = await Deno.readTextFile(`${SHARED_DIR}/${file}`);
    assert(!source.includes("api_v1_list_"), file);
    assert(!source.includes("api_v1_get_"), file);
  }
});

// -----------------------------------------------------------------------------
// 7. Containment model
// -----------------------------------------------------------------------------

Deno.test("API-N.10B: no Program layer invents a Program-level Connected App enablement", async () => {
  for (
    const wrapper of ["api_v1_create_program", "api_v1_update_program"]
  ) {
    const body = await readLatestWrapperBody(wrapper);
    assert(
      !body.includes("api_program_client_enablements"),
      `${wrapper} references a non-existent Program enablement table`,
    );
  }
  for (
    const file of [
      "supabaseProgramRead.ts",
      "supabaseProgramMutation.ts",
      "supabaseDelegatedProgramRead.ts",
      "supabaseDelegatedProgramMutation.ts",
    ]
  ) {
    const source = await Deno.readTextFile(`${SHARED_DIR}/${file}`);
    assert(!source.includes("api_program_client_enablements"), file);
  }
});

Deno.test("API-N.10B: Project commands consume Project enablement and never grant it", async () => {
  for (
    const wrapper of [
      "api_v1_update_project",
      "api_v1_transition_project",
    ]
  ) {
    const body = await readLatestWrapperBody(wrapper);
    assert(
      body.includes("api_project_client_enablements"),
      `${wrapper} does not consult Project Connected App enablement`,
    );
    assert(
      !/INSERT\s+INTO\s+(public\.)?api_project_client_enablements/i.test(body),
      `${wrapper} writes Project enablement`,
    );
    assert(
      !/UPDATE\s+(public\.)?api_project_client_enablements/i.test(body),
      `${wrapper} writes Project enablement`,
    );
  }
});

Deno.test("API-N.10B: family commands never accept caller-supplied tenant or organization scope", async () => {
  for (
    const file of ["supabaseProgramMutation.ts", "supabaseProjectMutation.ts"]
  ) {
    const source = await Deno.readTextFile(`${SHARED_DIR}/${file}`);
    assert(!source.includes("_tenant_id"), `${file} sends a tenant argument`);
    assert(
      !source.includes("_organization_id"),
      `${file} sends an organization argument`,
    );
  }
});

// -----------------------------------------------------------------------------
// 8. Idempotency, optimistic concurrency and confirmation parity
// -----------------------------------------------------------------------------

Deno.test("API-N.10B: every family command wrapper takes the exact idempotency argument pair", async () => {
  for (const command of COMMAND_EXECUTION_CHAIN) {
    const body = await readLatestWrapperBody(command.wrapper);
    const signature = body.slice(0, body.indexOf(")"));
    assert(signature.includes("_idempotency_key text"), command.wrapper);
    assert(signature.includes("_payload_hash text"), command.wrapper);
    assert(signature.includes("_request_id text"), command.wrapper);
    assert(signature.includes("_correlation_id text"), command.wrapper);
    assert(
      signature.includes("_expected_oauth_client_id text"),
      command.wrapper,
    );
    assert(
      body.includes("api_e_private.claim_idempotency("),
      `${command.wrapper} does not claim idempotency`,
    );
  }
});

Deno.test("API-N.10B: optimistic concurrency and confirmation are present exactly where accepted", async () => {
  for (const command of COMMAND_EXECUTION_CHAIN) {
    const body = await readLatestWrapperBody(command.wrapper);
    const signature = body.slice(0, body.indexOf(")"));
    assertEquals(
      signature.includes("_expected_updated_at timestamptz"),
      command.optimisticConcurrency,
      `${command.wrapper} optimistic-concurrency mismatch`,
    );
    assertEquals(
      signature.includes("_confirm_warnings boolean"),
      command.confirmation,
      `${command.wrapper} confirmation mismatch`,
    );
  }
});

Deno.test("API-N.10B: the five family commands are registered in the central API-F wrapper allowlist", async () => {
  const guard = await Deno.readTextFile(
    "supabase/functions/_shared/api-f-3-database-execution-wrapper_static_test.ts",
  );
  const start = guard.indexOf("APPROVED_IDEMPOTENCY_WRAPPERS = new Set([");
  assert(start !== -1);
  const block = guard.slice(start, guard.indexOf("]);", start));
  for (const command of COMMAND_EXECUTION_CHAIN) {
    assert(
      block.includes(`"${command.wrapper}"`),
      `not centrally approved: ${command.wrapper}`,
    );
  }
});

// -----------------------------------------------------------------------------
// 9. Documentation deferral posture (tracking mechanism preserved)
// -----------------------------------------------------------------------------

Deno.test("API-N.10B: the seven API-N family operations remain tracked as pending external documentation", async () => {
  const k9 = await Deno.readTextFile(
    "supabase/functions/btpm-api-v1/__tests__/api-k-9-external-contract-regression.test.ts",
  );
  const start = k9.indexOf("PENDING_DOCUMENTATION_OPERATION_IDS");
  assert(start !== -1);
  const block = k9.slice(start, k9.indexOf("]);", start));
  for (
    const id of [
      "programs.get",
      "programs.get_by_id",
      "programs.create",
      "programs.update",
      "projects.create",
      "projects.update",
      "projects.transition",
    ]
  ) {
    assert(block.includes(`"${id}"`), `not tracked as pending docs: ${id}`);
  }
  // The two pre-API-N Project reads are already externally documented.
  assert(!block.includes('"projects.get"'), "projects.get is documented");
  assert(
    !block.includes('"projects.get_by_id"'),
    "projects.get_by_id is documented",
  );
});

// -----------------------------------------------------------------------------
// 10. API-N.10B-C1 — Dedicated protected read-wrapper parity
// -----------------------------------------------------------------------------

/** Read operation -> dedicated protected read wrapper -> capability key. */
const READ_EXECUTION_CHAIN: ReadonlyArray<{
  readonly id: string;
  readonly wrapper: string;
  readonly capabilityKey: string;
}> = Object.freeze([
  {
    id: "programs.get",
    wrapper: "api_v1_list_programs",
    capabilityKey: "programs:list",
  },
  {
    id: "programs.get_by_id",
    wrapper: "api_v1_get_program",
    capabilityKey: "programs:read",
  },
  {
    id: "projects.get",
    wrapper: "api_v1_list_projects",
    capabilityKey: "projects:list",
  },
  {
    id: "projects.get_by_id",
    wrapper: "api_v1_get_project",
    capabilityKey: "projects:read",
  },
]);

Deno.test("API-N.10B-C1: every family read has a committed dedicated SECURITY DEFINER wrapper with a pinned search_path", async () => {
  for (const read of READ_EXECUTION_CHAIN) {
    const body = await readLatestWrapperBody(read.wrapper);
    assert(body.includes("SECURITY DEFINER"), read.wrapper);
    assert(
      /SET search_path TO 'pg_catalog'/.test(body),
      `${read.wrapper} lacks the pinned search_path`,
    );
  }
});

Deno.test("API-N.10B-C1: every family read wrapper hardcodes exactly its accepted capability key", async () => {
  const allKeys = READ_EXECUTION_CHAIN.map((r) => r.capabilityKey);
  for (const read of READ_EXECUTION_CHAIN) {
    const body = await readLatestWrapperBody(read.wrapper);
    assert(
      body.includes(`'${read.capabilityKey}'`),
      `${read.wrapper} does not hardcode ${read.capabilityKey}`,
    );
    for (const other of allKeys) {
      if (other === read.capabilityKey) continue;
      assert(
        !body.includes(`'${other}'`),
        `${read.wrapper} references foreign capability ${other}`,
      );
    }
    for (const command of COMMAND_EXECUTION_CHAIN) {
      assert(
        !body.includes(`'${command.capabilityKey}'`),
        `${read.wrapper} references command capability ${command.capabilityKey}`,
      );
    }
  }
});

Deno.test("API-N.10B-C1: no family read wrapper uses dynamic SQL, dynamic dispatch or a caller-controlled capability", async () => {
  for (const read of READ_EXECUTION_CHAIN) {
    const body = await readLatestWrapperBody(read.wrapper);
    assert(!/\bEXECUTE\s+format\b/i.test(body), read.wrapper);
    assert(!/\bEXECUTE\s+'/i.test(body), read.wrapper);
    assert(!/\bEXECUTE\s+\w+_sql\b/i.test(body), read.wrapper);
    assert(!/quote_ident\s*\(/i.test(body), read.wrapper);
    const signature = body.slice(0, body.indexOf(")"));
    assert(
      !/capability/i.test(signature),
      `${read.wrapper} accepts a caller-supplied capability argument`,
    );
    assert(
      !/capability_key\s*(:?=)\s*_/i.test(body),
      `${read.wrapper} derives its capability from a parameter`,
    );
  }
});

Deno.test("API-N.10B-C1: family reads never invoke a family PMG command function", async () => {
  for (const read of READ_EXECUTION_CHAIN) {
    const body = await readLatestWrapperBody(read.wrapper);
    for (const command of COMMAND_EXECUTION_CHAIN) {
      assert(
        !body.includes(`public.${command.pmg}(`),
        `${read.wrapper} invokes public.${command.pmg}`,
      );
    }
  }
});

// -----------------------------------------------------------------------------
// 11. API-N.10B-C1 — Exactly-one canonical PMG invocation per command wrapper
// -----------------------------------------------------------------------------

/** Removes block and line comments so declarations/comments are not counted. */
function stripSqlComments(body: string): string {
  return body
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => {
      const index = line.indexOf("--");
      return index === -1 ? line : line.slice(0, index);
    })
    .join("\n");
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

Deno.test("API-N.10B-C1: each command wrapper invokes its canonical PMG function exactly once", async () => {
  const allPmg = COMMAND_EXECUTION_CHAIN.map((c) => c.pmg);
  for (const command of COMMAND_EXECUTION_CHAIN) {
    const executable = stripSqlComments(
      await readLatestWrapperBody(command.wrapper),
    );
    assertEquals(
      countOccurrences(executable, `public.${command.pmg}(`),
      1,
      `${command.wrapper} must invoke public.${command.pmg} exactly once`,
    );
    for (const pmg of allPmg) {
      if (pmg === command.pmg) continue;
      assertEquals(
        countOccurrences(executable, `public.${pmg}(`),
        0,
        `${command.wrapper} also invokes public.${pmg}`,
      );
    }
  }
});

// -----------------------------------------------------------------------------
// 12. API-N.10B-C1 — Project create never auto-enables the Connected App
// -----------------------------------------------------------------------------

Deno.test("API-N.10B-C1: api_v1_create_project never writes or enables a Project enablement row", async () => {
  const executable = stripSqlComments(
    await readLatestWrapperBody("api_v1_create_project"),
  );
  assert(
    !/INSERT\s+INTO\s+(public\.)?api_project_client_enablements/i.test(
      executable,
    ),
    "api_v1_create_project inserts Project enablement",
  );
  assert(
    !/UPDATE\s+(public\.)?api_project_client_enablements/i.test(executable),
    "api_v1_create_project updates Project enablement",
  );
  assert(
    !/UPSERT|ON\s+CONFLICT[\s\S]{0,200}api_project_client_enablements/i.test(
      executable,
    ),
    "api_v1_create_project upserts Project enablement",
  );
  // Project creation must not require pre-existing Project enablement either.
  assert(
    !executable.includes("api_project_client_enablements"),
    "api_v1_create_project depends on Project Connected App enablement",
  );
});

Deno.test("API-N.10B-C1: no family layer treats api_program_client_enablements as valid architecture", async () => {
  for (const command of COMMAND_EXECUTION_CHAIN) {
    const body = await readLatestWrapperBody(command.wrapper);
    assert(
      !body.includes("api_program_client_enablements"),
      `${command.wrapper} references a Program enablement table`,
    );
  }
  for (const read of READ_EXECUTION_CHAIN) {
    const body = await readLatestWrapperBody(read.wrapper);
    assert(
      !body.includes("api_program_client_enablements"),
      `${read.wrapper} references a Program enablement table`,
    );
  }
});
