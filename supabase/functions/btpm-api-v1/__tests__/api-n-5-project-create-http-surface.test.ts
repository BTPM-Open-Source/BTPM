// API-N.5 — static + runtime guards for the single accepted external Project
// command: POST /v1/projects (projects:create).
//
// These guards assert exactly the accepted architecture: one dedicated
// transactional database wrapper, a delegated caller-bound anon-key executor,
// no generic mutation dispatcher, and no Project Connected App auto-enablement.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  API_V1_ROUTE_ALLOWLIST,
  matchApiRoute,
} from "../router.ts";
import { PROJECT_CREATE_ROUTE } from "../routes/projects.ts";
import { buildCapabilitiesPayload } from "../routes/capabilities.ts";

const UUID = "11111111-1111-4111-8111-111111111111";

// ---------------------------------------------------------------------------
// A. Route registration
// ---------------------------------------------------------------------------

Deno.test("API-N.5: PROJECT_CREATE_ROUTE is frozen and exactly specified", () => {
  assert(Object.isFrozen(PROJECT_CREATE_ROUTE));
  assertEquals(PROJECT_CREATE_ROUTE.id, "projects.create");
  assertEquals(PROJECT_CREATE_ROUTE.method, "POST");
  assertEquals(PROJECT_CREATE_ROUTE.path, "/v1/projects");
  assertEquals(PROJECT_CREATE_ROUTE.operation, "mutation");
});

Deno.test("API-N.5: the command is registered exactly once", () => {
  const byId = API_V1_ROUTE_ALLOWLIST.filter((r) => r.id === "projects.create");
  assertEquals(byId.length, 1);
  assertEquals(
    API_V1_ROUTE_ALLOWLIST.filter((r) => r === PROJECT_CREATE_ROUTE).length,
    1,
  );
  assertEquals(byId[0], PROJECT_CREATE_ROUTE);
});

Deno.test("API-N.5: only exact POST /v1/projects matches", () => {
  assertEquals(matchApiRoute("POST", "/v1/projects"), PROJECT_CREATE_ROUTE);
  for (const method of ["PUT", "PATCH", "DELETE", "HEAD", "post"]) {
    assertEquals(matchApiRoute(method, "/v1/projects"), null, method);
  }
  for (
    const path of [
      "/v1/projects/",
      "/v1/Projects",
      "/v1/projects/extra",
      `/v1/projects/${UUID}`,
    ]
  ) {
    assertEquals(matchApiRoute("POST", path), null, path);
  }
});

Deno.test("API-N.5: capabilities advertise projects.create exactly once", () => {
  const ops = buildCapabilitiesPayload().supportedOperations as
    readonly string[];
  assertEquals(ops.filter((o) => o === "projects.create").length, 1);
});


// ---------------------------------------------------------------------------
// B. Architecture guards (static source proofs)
// ---------------------------------------------------------------------------

async function readSource(relative: string): Promise<string> {
  return await Deno.readTextFile(new URL(relative, import.meta.url));
}

Deno.test("API-N.5: the delegated executor is caller-bound and anon-key only", async () => {
  const src = await readSource(
    "../../_shared/btpm-api/supabaseDelegatedProjectMutation.ts",
  );
  assert(!src.includes("SERVICE_ROLE"));
  assert(!src.includes("serviceRoleKey"));
  assert(!src.includes("supabaseServiceRoleKey"));
  // The caller bearer token is forwarded, never a privileged key.
  assert(src.includes("Authorization"));
});

Deno.test("API-N.5: the live runtime builds the executor with the anon key only", async () => {
  const src = await readSource("../index.ts");
  assert(
    src.includes(
      "createDelegatedApiV1CreateProjectExecutor(\n    supabaseUrl,\n    supabaseAnonKey,\n    (url, key, options) => createClient(url, key, options),\n  )",
    ),
    "Project create executor must be constructed with the anon key",
  );
  const at = src.indexOf("createDelegatedApiV1CreateProjectExecutor(");
  const block = src.slice(at, at + 300);
  assert(!block.includes("supabaseServiceRoleKey"));
  assert(!block.includes("privilegedClient"));
});

Deno.test("API-N.5: dispatch is exact-path, with no generic project dispatcher", async () => {
  const src = await readSource("../handler.ts");
  // API-N.6 appended a second exact Project mutation target to the same block;
  // the create dispatch condition itself is unchanged.
  assert(
    src.includes(
      'method === "POST" && url.pathname === PROJECT_CREATE_ROUTE.path',
    ),
    "Project create must dispatch on the exact static pathname",
  );
  assert(!src.includes('url.pathname.startsWith("/v1/projects")'));
});

Deno.test("API-N.5: no Connected App Project enablement write exists on this path", async () => {
  for (
    const file of [
      "../../_shared/btpm-api/supabaseProjectMutation.ts",
      "../../_shared/btpm-api/supabaseDelegatedProjectMutation.ts",
    ]
  ) {
    const src = await readSource(file);
    assert(!src.includes("api_project_client_enablements"), file);
    assert(!src.includes("insert("), file);
  }
});

// ---------------------------------------------------------------------------
// C. Live route-authorization registration
//
// API-N.RG2 — the exact Project route import syntax and the live
// `authorizeRoute` identity enumeration (including PROJECT_CREATE_ROUTE) are
// owned centrally by api-v1-live-authorization-registration.test.ts.
// Step-local behavioral authorization evidence lives in
// api-n-5-project-create-external-command.test.ts.
// ---------------------------------------------------------------------------

