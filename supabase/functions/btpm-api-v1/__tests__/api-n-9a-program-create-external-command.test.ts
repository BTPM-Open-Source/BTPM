// API-N.9A — static + behavioural guards for the single accepted external
// Program command: POST /v1/programs (programs.create).
//
// These guards assert exactly the accepted architecture: one dedicated
// transactional database wrapper, a delegated caller-bound anon-key executor,
// a strict closed-schema body parser whose normalization matches the canonical
// command, no generic mutation dispatcher, and no Connected App enablement
// write on this path.

import {
  assert,
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { API_V1_ROUTE_ALLOWLIST, matchApiRoute } from "../router.ts";
import {
  PROGRAM_CREATE_ROUTE,
  parseApiV1CreateProgramBody,
} from "../routes/programs.ts";
import { buildCapabilitiesPayload } from "../routes/capabilities.ts";
import { ApiHttpError } from "../../_shared/btpm-api/http.ts";
import {
  createApiV1Program,
  type ApiV1CreateProgramRpcArgs,
} from "../../_shared/btpm-api/supabaseProgramMutation.ts";

const UUID = "11111111-1111-4111-8111-111111111111";
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const HASH = "a".repeat(64);

// ---------------------------------------------------------------------------
// A. Route registration
// ---------------------------------------------------------------------------

Deno.test("API-N.9A: PROGRAM_CREATE_ROUTE is frozen and exactly specified", () => {
  assert(Object.isFrozen(PROGRAM_CREATE_ROUTE));
  assertEquals(PROGRAM_CREATE_ROUTE.id, "programs.create");
  assertEquals(PROGRAM_CREATE_ROUTE.method, "POST");
  assertEquals(PROGRAM_CREATE_ROUTE.path, "/v1/programs");
  assertEquals(PROGRAM_CREATE_ROUTE.operation, "mutation");
});

Deno.test("API-N.9A: the command is registered exactly once", () => {
  const byId = API_V1_ROUTE_ALLOWLIST.filter((r) => r.id === "programs.create");
  assertEquals(byId.length, 1);
  assertEquals(
    API_V1_ROUTE_ALLOWLIST.filter((r) => r === PROGRAM_CREATE_ROUTE).length,
    1,
  );
  assertEquals(byId[0], PROGRAM_CREATE_ROUTE);
});

Deno.test("API-N.9A: only exact POST /v1/programs matches", () => {
  assertEquals(matchApiRoute("POST", "/v1/programs"), PROGRAM_CREATE_ROUTE);
  for (const method of ["PUT", "PATCH", "DELETE", "HEAD", "post"]) {
    assertEquals(matchApiRoute(method, "/v1/programs"), null, method);
  }
  for (
    const path of [
      "/v1/programs/",
      "/v1/Programs",
      "/v1/programs/extra",
      `/v1/programs/${UUID}`,
    ]
  ) {
    assertEquals(matchApiRoute("POST", path), null, path);
  }
});

Deno.test("API-N.9A: the create surface never absorbs Program update semantics", () => {
  // API-N.9B activated `programs.update` as its OWN separate route; this
  // historical guard now asserts only that the create route stays distinct.
  assertEquals(
    matchApiRoute("PATCH", "/v1/programs"),
    null,
  );
  const patched = matchApiRoute("PATCH", `/v1/programs/${UUID}`);
  assert(patched !== null && patched !== PROGRAM_CREATE_ROUTE);
  assertEquals(patched.id, "programs.update");
});

Deno.test("API-N.9A: capabilities advertise programs.create exactly once", () => {
  const ops = buildCapabilitiesPayload().supportedOperations as
    readonly string[];
  assertEquals(ops.filter((o) => o === "programs.create").length, 1);
});

// ---------------------------------------------------------------------------
// B. Strict closed-schema body parsing and canonical normalization
// ---------------------------------------------------------------------------

Deno.test("API-N.9A: minimal accepted body normalizes description to null", () => {
  const parsed = parseApiV1CreateProgramBody({
    workspaceId: UUID,
    name: "Finance Transformation",
  });
  assertEquals(parsed, {
    workspaceId: UUID,
    name: "Finance Transformation",
    description: null,
  });
  assert(Object.isFrozen(parsed));
});

Deno.test("API-N.9A: name and description are btrim-normalized before execution", () => {
  const parsed = parseApiV1CreateProgramBody({
    workspaceId: UUID,
    name: "   S/4 Rollout   ",
    description: "  wave one  ",
  });
  assertEquals(parsed.name, "S/4 Rollout");
  assertEquals(parsed.description, "wave one");
});

Deno.test("API-N.9A: explicit null and blank descriptions both normalize to null", () => {
  assertEquals(
    parseApiV1CreateProgramBody({
      workspaceId: UUID,
      name: "P",
      description: null,
    }).description,
    null,
  );
  assertEquals(
    parseApiV1CreateProgramBody({
      workspaceId: UUID,
      name: "P",
      description: "     ",
    }).description,
    null,
  );
});

Deno.test("API-N.9A: unknown keys are rejected, including protected Program fields", () => {
  for (
    const extra of [
      { status: "active" },
      { organizationId: UUID },
      { tenantId: UUID },
      { isArchived: false },
      { programId: UUID },
      { workspace_id: UUID },
      { Name: "x" },
    ]
  ) {
    assertThrows(
      () =>
        parseApiV1CreateProgramBody({
          workspaceId: UUID,
          name: "P",
          ...extra,
        }),
      ApiHttpError,
    );
  }
});

Deno.test("API-N.9A: required fields, types and bounds are enforced", () => {
  const cases: unknown[] = [
    null,
    "string",
    42,
    [],
    {},
    { name: "P" },
    { workspaceId: UUID },
    { workspaceId: NIL_UUID, name: "P" },
    { workspaceId: "not-a-uuid", name: "P" },
    { workspaceId: UUID, name: "" },
    { workspaceId: UUID, name: "    " },
    { workspaceId: UUID, name: 1 },
    { workspaceId: UUID, name: null },
    { workspaceId: UUID, name: "a".repeat(201) },
    { workspaceId: UUID, name: "P", description: 5 },
    { workspaceId: UUID, name: "P", description: {} },
  ];
  for (const input of cases) {
    assertThrows(
      () => parseApiV1CreateProgramBody(input),
      ApiHttpError,
      undefined,
      JSON.stringify(input ?? null),
    );
  }
});

// ---------------------------------------------------------------------------
// C. RPC adapter behaviour (exact wrapper, exact arguments, bounded results)
// ---------------------------------------------------------------------------

interface RecordedCall {
  readonly functionName: string;
  readonly args: ApiV1CreateProgramRpcArgs;
}

function stubClient(
  response: unknown,
  recorded: RecordedCall[],
) {
  return {
    rpc(functionName: string, args: ApiV1CreateProgramRpcArgs) {
      recorded.push({ functionName, args });
      return Promise.resolve(response);
    },
  };
}

const VALID_INPUT = Object.freeze({
  expectedOauthClientId: "btpm-client-1",
  workspaceId: UUID,
  name: "S/4 Rollout",
  description: "wave one",
  requestId: "req-1",
  correlationId: "corr-1",
  idempotencyKey: "idem-1",
  payloadHash: HASH,
});

Deno.test("API-N.9A: adapter calls exactly api_v1_create_program with the fixed argument names", async () => {
  const recorded: RecordedCall[] = [];
  const client = stubClient(
    { data: { ok: true, outcome: "applied", programId: UUID }, error: null },
    recorded,
  );
  const result = await createApiV1Program(client, VALID_INPUT);
  assertEquals(result, { ok: true, outcome: "applied", programId: UUID });
  assertEquals(recorded.length, 1);
  assertEquals(recorded[0].functionName, "api_v1_create_program");
  assertEquals(Object.keys(recorded[0].args).sort(), [
    "_correlation_id",
    "_description",
    "_expected_oauth_client_id",
    "_idempotency_key",
    "_name",
    "_payload_hash",
    "_request_id",
    "_workspace_id",
  ]);
});

Deno.test("API-N.9A: replay is preserved as a distinct bounded outcome", async () => {
  const client = stubClient(
    { data: { ok: true, outcome: "replayed", programId: UUID }, error: null },
    [],
  );
  assertEquals(await createApiV1Program(client, VALID_INPUT), {
    ok: true,
    outcome: "replayed",
    programId: UUID,
  });
});

Deno.test("API-N.9A: every negative wrapper outcome is passed through unchanged", async () => {
  for (
    const outcome of [
      "invalid",
      "not_authorized",
      "idempotency_conflict",
      "idempotency_pending",
    ]
  ) {
    const client = stubClient({ data: { ok: false, outcome }, error: null }, []);
    assertEquals(
      await createApiV1Program(client, VALID_INPUT) as unknown,
      { ok: false, outcome },
    );
  }
});

Deno.test("API-N.9A: insufficient_privilege maps to not_authorized, other errors to internal_error", async () => {
  const denied = stubClient(
    { data: null, error: { code: "42501", message: "denied" } },
    [],
  );
  const deniedError = await createApiV1Program(denied, VALID_INPUT).then(
    () => null,
    (e) => e,
  );
  assert(deniedError instanceof ApiHttpError);
  assertEquals(deniedError.code, "not_authorized");

  const broken = stubClient(
    { data: null, error: { code: "XX000", message: "boom" } },
    [],
  );
  const brokenError = await createApiV1Program(broken, VALID_INPUT).then(
    () => null,
    (e) => e,
  );
  assert(brokenError instanceof ApiHttpError);
  assertEquals(brokenError.code, "internal_error");
});

Deno.test("API-N.9A: malformed or unbounded wrapper results fail closed", async () => {
  for (
    const data of [
      null,
      "applied",
      { ok: true, outcome: "applied" },
      { ok: true, outcome: "applied", programId: NIL_UUID },
      { ok: true, outcome: "applied", programId: UUID, name: "leak" },
      { ok: true, outcome: "surprise", programId: UUID },
      { ok: false, outcome: "applied" },
      { ok: false, outcome: "unknown" },
    ]
  ) {
    const client = stubClient({ data, error: null }, []);
    const error = await createApiV1Program(client, VALID_INPUT).then(
      () => null,
      (e) => e,
    );
    assert(
      error instanceof ApiHttpError,
      `expected failure for ${JSON.stringify(data)}`,
    );
    assertEquals(error.code, "internal_error", JSON.stringify(data));
  }
});

// ---------------------------------------------------------------------------
// D. Architecture guards (static source proofs)
// ---------------------------------------------------------------------------

async function readSource(relative: string): Promise<string> {
  return await Deno.readTextFile(new URL(relative, import.meta.url));
}

Deno.test("API-N.9A: the delegated executor is caller-bound and anon-key only", async () => {
  const src = await readSource(
    "../../_shared/btpm-api/supabaseDelegatedProgramMutation.ts",
  );
  assert(!src.includes("SERVICE_ROLE"));
  assert(!src.includes("serviceRoleKey"));
  assert(!src.includes("supabaseServiceRoleKey"));
  // The caller bearer token is forwarded, never a privileged key.
  assert(src.includes("Authorization"));
  assert(src.includes("extractBearerToken"));
});

Deno.test("API-N.9A: the live runtime builds the executor with the anon key only", async () => {
  const src = await readSource("../index.ts");
  assert(
    src.includes(
      "createDelegatedApiV1CreateProgramExecutor(\n    supabaseUrl,\n    supabaseAnonKey,\n    (url, key, options) => createClient(url, key, options),\n  )",
    ),
    "Program create executor must be constructed with the anon key",
  );
  const at = src.indexOf("createDelegatedApiV1CreateProgramExecutor(");
  const block = src.slice(at, at + 300);
  assert(!block.includes("supabaseServiceRoleKey"));
  assert(!block.includes("privilegedClient"));
});

Deno.test("API-N.9A: dispatch is exact-path, with no generic program dispatcher", async () => {
  const src = await readSource("../handler.ts");
  assert(
    src.includes(
      'method === "POST" && url.pathname === PROGRAM_CREATE_ROUTE.path',
    ),
    "Program create must dispatch on the exact static pathname",
  );
  assert(!src.includes('url.pathname.startsWith("/v1/programs")'));
});

Deno.test("API-N.9A: no Connected App enablement write exists on this path", async () => {
  for (
    const file of [
      "../../_shared/btpm-api/supabaseProgramMutation.ts",
      "../../_shared/btpm-api/supabaseDelegatedProgramMutation.ts",
    ]
  ) {
    const src = await readSource(file);
    for (
      const forbidden of [
        "api_organization_client_enablements",
        "api_workspace_client_enablements",
        "api_project_client_enablements",
        "api_capability_grants",
        "insert(",
      ]
    ) {
      assert(!src.includes(forbidden), `${file}: ${forbidden}`);
    }
  }
});

Deno.test("API-N.9A: only explicit accepted wrappers are reachable from the Program mutation modules", async () => {
  const src = await readSource(
    "../../_shared/btpm-api/supabaseProgramMutation.ts",
  );
  assert(src.includes('"api_v1_create_program"'));
  // API-N.9B added exactly one more explicit hardcoded wrapper name. No PMG
  // command, table access or generic dispatcher may ever appear here.
  for (
    const forbidden of [
      "apply_program_update",
      "apply_program_create",
      "public.programs",
      "from(",
    ]
  ) {
    assert(!src.includes(forbidden), forbidden);
  }
});
