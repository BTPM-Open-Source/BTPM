// ME-2 — Focused static tests for the enriched `me.get` REST activation.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  ME_ROUTE,
  parseApiV1MeQuery,
} from "../../functions/_shared/btpm-api/routes/me.ts";
import { ApiHttpError } from "../../functions/_shared/btpm-api/http.ts";

const ORG_ID = "1d2a3b4c-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

function expectInvalid(rawSearch: string): void {
  try {
    parseApiV1MeQuery(rawSearch);
  } catch (err) {
    assert(err instanceof ApiHttpError, `expected ApiHttpError for ${rawSearch}`);
    assertEquals(err.code, "invalid_request", `for ${rawSearch}`);
    return;
  }
  throw new Error(`expected invalid_request for ${rawSearch}`);
}

Deno.test("ME_ROUTE contract is unchanged", () => {
  assertEquals(ME_ROUTE, {
    id: "me.get",
    method: "GET",
    path: "/v1/me",
    operation: "read",
  });
});

Deno.test("no query yields null/null context", () => {
  for (const raw of ["", "?"]) {
    assertEquals(parseApiV1MeQuery(raw), {
      contextType: null,
      contextId: null,
    });
  }
});

Deno.test("valid context queries parse to exact type and UUID", () => {
  for (const type of ["organization", "workspace", "project"] as const) {
    assertEquals(
      parseApiV1MeQuery(`?contextType=${type}&contextId=${ORG_ID}`),
      { contextType: type, contextId: ORG_ID },
    );
    assertEquals(
      parseApiV1MeQuery(`?contextId=${ORG_ID}&contextType=${type}`),
      { contextType: type, contextId: ORG_ID },
    );
  }
});

Deno.test("malformed, partial, duplicated and unknown query input fails closed", () => {
  const invalid = [
    "?contextType=organization",
    `?contextId=${ORG_ID}`,
    "?contextType=&contextId=",
    `?contextType=organization&contextId=`,
    `?contextType=&contextId=${ORG_ID}`,
    `?contextType=tenant&contextId=${ORG_ID}`,
    `?contextType=Organization&contextId=${ORG_ID}`,
    `?contextType=org&contextId=${ORG_ID}`,
    `?contexttype=organization&contextId=${ORG_ID}`,
    `?contextType=organization&contextId=${ORG_ID}&limit=1`,
    `?contextType=organization&contextType=workspace&contextId=${ORG_ID}`,
    `?contextType=organization&contextId=${ORG_ID}&contextId=${ORG_ID}`,
    "?contextType=organization&contextId=not-a-uuid",
    "?contextType=organization&contextId=00000000-0000-0000-0000-000000000000",
    `?contextType=organization&contextId= ${ORG_ID}`,
    `?contextType=organization&contextId=${ORG_ID} `,
    "?contextType=organization&contextId=%E0%A4%A",
    "contextType=organization",
  ];
  for (const raw of invalid) expectInvalid(raw);
});

Deno.test("new REST wrapper migration has the required posture and no duplicated logic", async () => {
  const sql = await Deno.readTextFile(
    new URL(
      "../../migrations/20260821120759_dfc4973b-7a9d-416e-9964-3100759afead.sql",
      import.meta.url,
    ),
  );
  assert(
    sql.includes(
      "CREATE OR REPLACE FUNCTION public.api_v1_get_me_context(",
    ),
  );
  assert(sql.includes("RETURNS jsonb"));
  assert(sql.includes("STABLE"));
  assert(sql.includes("SECURITY DEFINER"));
  assert(sql.includes("SET search_path = pg_catalog"));
  assert(sql.includes("api_e_private.resolve_me_context("));
  assert(
    sql.includes(
      "REVOKE ALL ON FUNCTION public.api_v1_get_me_context(text, text, uuid) FROM PUBLIC;",
    ),
  );
  assert(
    sql.includes(
      "REVOKE ALL ON FUNCTION public.api_v1_get_me_context(text, text, uuid) FROM anon;",
    ),
  );
  assert(
    sql.includes(
      "GRANT EXECUTE ON FUNCTION public.api_v1_get_me_context(text, text, uuid) TO authenticated;",
    ),
  );
  // Exactly one business action; no duplicated identity/access/encryption logic.
  assertEquals(sql.split("resolve_me_context(").length - 1, 2);
  for (
    const forbidden of [
      "btpm_decrypt",
      "has_project_access",
      "organization_memberships",
      "workspace_members",
      "api_project_client_enablements",
      "me:read",
      "DROP FUNCTION",
      "CREATE OR REPLACE FUNCTION public.api_v1_get_me(",
    ]
  ) {
    assert(!sql.includes(forbidden), `migration must not contain: ${forbidden}`);
  }
});

Deno.test("router preserves authentication and rate-limit order before the me read", async () => {
  const source = await Deno.readTextFile(
    new URL("../../functions/btpm-api-v1/router.ts", import.meta.url),
  );
  const queryIdx = source.indexOf("meQuery = parseApiV1MeQuery(url.search)");
  const authIdx = source.indexOf("authenticated = await dependencies.authenticate(request)");
  const rateIdx = source.indexOf("await enforceApiRateLimit(");
  const readIdx = source.indexOf(
    "dependencies.readMe(request, authenticated, meQuery!)",
  );
  assert(queryIdx > 0 && authIdx > 0 && rateIdx > 0 && readIdx > 0);
  assert(queryIdx < authIdx, "query parsing must precede authentication");
  assert(authIdx < rateIdx, "authentication must precede rate limiting");
  assert(rateIdx < readIdx, "rate limiting must precede the me read");
});

Deno.test("MCP surface and legacy one-argument wrapper remain unchanged", async () => {
  const registry = await Deno.readTextFile(
    new URL("../../functions/btpm-mcp/mcp/toolRegistry.ts", import.meta.url),
  );
  for (
    const forbidden of [
      "api_v1_get_me_context",
      "resolve_me_context",
      "contextType",
    ]
  ) {
    assert(!registry.includes(forbidden), `MCP registry must not contain: ${forbidden}`);
  }
  // The me.get entry keeps its reserved tool name; ME-3 later flipped its MCP
  // exposure decision to `exposed` without changing the REST capability.
  const meEntry = registry.slice(registry.indexOf('operationId: "me.get"'));
  assert(meEntry.includes('toolName: "btpm_get_me"'));
  assert(meEntry.slice(0, 400).includes('exposure: "exposed"'));

  const legacy = await Deno.readTextFile(
    new URL(
      "../../migrations/20260727072808_fd501015-22e8-44d1-8136-d8603fde3d6b.sql",
      import.meta.url,
    ),
  );
  assert(
    legacy.includes("CREATE OR REPLACE FUNCTION public.api_v1_get_me("),
    "legacy one-argument wrapper migration must remain present",
  );
});
