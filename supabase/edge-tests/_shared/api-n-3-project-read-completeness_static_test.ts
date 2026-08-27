// Relocated out of supabase/functions/ (Edge deploy bundle size).
// Source-file reads stay anchored to the original module location.
const __BTPM_SELF_URL__ = import.meta.url;
const __BTPM_SRC_BASE__ = new URL('../../functions/_shared/api-n-3-project-read-completeness_static_test.ts', import.meta.url).href;
// API-N.3 — Permanent static guard for Project read completeness.
//
// Proves, without any network or database access, that:
//   * exactly one migration carries the API-N.3 marker and redefines both
//     existing protected Project read wrappers with unchanged signatures;
//   * the collection wrapper projects exactly the frozen 13 discovery
//     fields and exposes no Project narrative;
//   * the detail wrapper projects exactly the frozen 27 fields with every
//     narrative decrypted server-side through public.btpm_decrypt;
//   * the two strict TypeScript adapters expose exactly those key sets;
//   * no route, allowlist, capability or grant surface was widened.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = new URL("../../migrations/", __BTPM_SRC_BASE__);
const MARKER = /^-- API-N\.3 — Project read completeness$/m;

const COLLECTION_FIELDS = [
  "projectId",
  "organizationId",
  "workspaceId",
  "programId",
  "name",
  "status",
  "priority",
  "projectStage",
  "deliveryModel",
  "startDate",
  "targetEndDate",
  "agileEnabled",
  "updatedAt",
] as const;

const DETAIL_FIELDS = [
  "projectId",
  "organizationId",
  "workspaceId",
  "programId",
  "portfolioItemId",
  "name",
  "description",
  "status",
  "priority",
  "projectStage",
  "deliveryModel",
  "startDate",
  "targetEndDate",
  "actualStartDate",
  "actualEndDate",
  "agileEnabled",
  "updatedAt",
  "charter",
  "goals",
  "scopeIn",
  "scopeOut",
  "businessCase",
  "successCriteria",
  "completionCriteria",
  "budgetNarrative",
  "assumptions",
  "constraints",
] as const;

const NARRATIVE_FIELDS = DETAIL_FIELDS.slice(17);

async function readMigrationFiles(): Promise<{ name: string; sql: string }[]> {
  const files: { name: string; sql: string }[] = [];
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".sql")) continue;
    files.push({
      name: entry.name,
      sql: await Deno.readTextFile(new URL(entry.name, MIGRATIONS_DIR)),
    });
  }
  files.sort((a, b) => a.name.localeCompare(b.name));
  return files;
}

async function readN3Migration(): Promise<string> {
  const matches = (await readMigrationFiles()).filter((f) =>
    MARKER.test(f.sql)
  );
  assertEquals(matches.length, 1, "exactly one API-N.3 migration is expected");
  return matches[0].sql;
}

Deno.test("API-N.3 migration redefines both wrappers with unchanged signatures", async () => {
  const sql = await readN3Migration();

  assert(
    sql.includes(
      "CREATE OR REPLACE FUNCTION public.api_v1_list_projects(_expected_oauth_client_id text, _workspace_id uuid, _limit integer DEFAULT 50, _offset integer DEFAULT 0, _search text DEFAULT NULL::text)",
    ),
    "collection wrapper signature must be preserved exactly",
  );
  assert(
    /CREATE OR REPLACE FUNCTION public\.api_v1_get_project\(\s*_expected_oauth_client_id text,\s*_project_id uuid\s*\)/
      .test(sql),
    "detail wrapper signature must be preserved exactly",
  );

  // No replacement or duplicate reader wrappers.
  for (
    const forbidden of [
      "api_v1_list_projects_v2",
      "api_v1_get_project_v2",
      "api_v1_get_project_detail",
      "DROP FUNCTION",
    ]
  ) {
    assert(
      !sql.includes(forbidden),
      `migration must not contain ${forbidden}`,
    );
  }
});

Deno.test("API-N.3 migration keeps both wrappers protected and caller-bound", async () => {
  const sql = await readN3Migration();

  const definerCount = sql.match(/SECURITY DEFINER/g)?.length ?? 0;
  assertEquals(definerCount, 2, "both wrappers remain SECURITY DEFINER");

  assertEquals(
    sql.match(/SET search_path TO 'pg_catalog'/g)?.length ?? 0,
    2,
    "both wrappers keep the pinned search_path",
  );
  assertEquals(
    sql.match(/resolve_delegated_read_principal/g)?.length ?? 0,
    2,
    "both wrappers resolve the delegated read principal",
  );

  // Fail-closed SQLSTATE behavior is preserved.
  assert(sql.includes("api_v1_not_authorized"));
  assert(sql.includes("ERRCODE = '42501'"));
  assert(sql.includes("api_v1_invalid_request"));
  assert(sql.includes("ERRCODE = '22023'"));

  // Privileges reasserted, never widened.
  for (
    const fn of [
      "public.api_v1_list_projects(text, uuid, integer, integer, text)",
      "public.api_v1_get_project(text, uuid)",
    ]
  ) {
    assert(sql.includes(`REVOKE ALL ON FUNCTION ${fn} FROM PUBLIC;`));
    assert(sql.includes(`REVOKE ALL ON FUNCTION ${fn} FROM anon;`));
    assert(
      sql.includes(`GRANT EXECUTE ON FUNCTION ${fn} TO authenticated;`),
    );
  }
  assert(
    !/GRANT\s+EXECUTE[^;]*TO\s+(anon|service_role|PUBLIC)/i.test(sql),
    "execute privilege must not be widened beyond authenticated",
  );

  // No service-role business execution and no dynamic SQL.
  for (const forbidden of ["service_role", "EXECUTE format(", "EXECUTE '"]) {
    assert(!sql.includes(forbidden), `migration must not use ${forbidden}`);
  }
});

Deno.test("API-N.3 migration preserves collection authorization, search, ordering and pagination", async () => {
  const sql = await readN3Migration();
  const collection = sql.slice(
    sql.indexOf("FUNCTION public.api_v1_list_projects"),
    sql.indexOf("FUNCTION public.api_v1_get_project"),
  );

  assert(collection.includes("'projects:list'"));
  assert(collection.includes("api_organization_client_enablements"));
  assert(collection.includes("api_workspace_client_enablements"));
  assert(collection.includes("api_project_client_enablements"));
  assert(collection.includes("public.has_project_access(_uid, p.id)"));
  assert(collection.includes("p.is_archived = false"));
  assert(collection.includes("_limit < 1 OR _limit > 100"));
  assert(collection.includes("_offset > 10000"));
  assert(collection.includes("length(_search_trimmed) > 100"));
  assert(
    collection.includes("ORDER BY sub.name_lower, sub.project_id"),
    "deterministic collection ordering is preserved",
  );
});

Deno.test("API-N.3 collection wrapper projects exactly the frozen 13 fields and no narrative", async () => {
  const sql = await readN3Migration();
  const collection = sql.slice(
    sql.indexOf("FUNCTION public.api_v1_list_projects"),
    sql.indexOf("FUNCTION public.api_v1_get_project"),
  );
  const objectStart = collection.indexOf("'projectId', sub.project_id");
  assert(objectStart > 0);
  const projection = collection.slice(
    objectStart,
    collection.indexOf("ORDER BY sub.name_lower", objectStart),
  );

  const emitted = [...projection.matchAll(/'([A-Za-z]+)',/g)].map((m) => m[1]);
  assertEquals(emitted, [...COLLECTION_FIELDS]);

  for (const narrative of NARRATIVE_FIELDS) {
    assert(
      !collection.includes(`'${narrative}'`),
      `collection must not expose narrative field ${narrative}`,
    );
  }
  assert(
    !collection.includes("'description'"),
    "collection must not expose description",
  );
  assertEquals(
    collection.match(/public\.btpm_decrypt/g)?.length ?? 0,
    1,
    "collection decrypts only the Project name",
  );
});

Deno.test("API-N.3 detail wrapper projects exactly the frozen 27 fields with narratives decrypted", async () => {
  const sql = await readN3Migration();
  const detail = sql.slice(sql.indexOf("FUNCTION public.api_v1_get_project"));
  const projection = detail.slice(
    detail.indexOf("'projectId', p.id"),
    detail.indexOf("FROM public.projects p"),
  );

  const emitted = [...projection.matchAll(/'([A-Za-z]+)',\s/g)].map((m) =>
    m[1]
  );
  assertEquals(emitted, [...DETAIL_FIELDS]);

  for (const narrative of NARRATIVE_FIELDS) {
    assert(
      new RegExp(
        `'${narrative}', public\\.btpm_decrypt\\(p\\.[a-z_]+, p\\.organization_id\\)`,
      ).test(projection),
      `${narrative} must be decrypted server-side`,
    );
  }

  assert(detail.includes("'projects:read'"));
  assert(detail.includes("api_client_supported_capabilities"));
  assert(detail.includes("scope_level = 'project'"));
  assert(detail.includes("public.has_project_access(_uid, p.id)"));
});

Deno.test("API-N.3 adapters expose exactly the frozen key sets", async () => {
  const collectionSource = await Deno.readTextFile(
    new URL("./btpm-api/supabaseProjects.ts", __BTPM_SRC_BASE__),
  );
  const detailSource = await Deno.readTextFile(
    new URL("./btpm-api/supabaseProjectDetail.ts", __BTPM_SRC_BASE__),
  );

  function frozenKeyList(source: string, constName: string): string[] {
    const start = source.indexOf(`const ${constName}`);
    assert(start > 0, `${constName} must exist`);
    const block = source.slice(start, source.indexOf("]);", start));
    return [...block.matchAll(/"([A-Za-z]+)"/g)].map((m) => m[1]);
  }

  assertEquals(
    frozenKeyList(collectionSource, "EXPECTED_ITEM_KEYS"),
    [...COLLECTION_FIELDS],
  );
  assertEquals(
    frozenKeyList(detailSource, "EXPECTED_PAYLOAD_KEYS"),
    [...DETAIL_FIELDS],
  );

  // Strict exact-key validation is retained on both adapters.
  for (const source of [collectionSource, detailSource]) {
    assert(source.includes("keys.length !== "));
    for (
      const forbidden of [
        "Deno.env",
        "SUPABASE_SERVICE_ROLE_KEY",
        "service_role",
        "createClient(",
        "fetch(",
        "console.",
      ]
    ) {
      assert(
        !source.includes(forbidden),
        `adapter must not contain ${forbidden}`,
      );
    }
  }
});

Deno.test("API-N.3 changes no route, capability or wiring surface", async () => {
  const base = new URL("../btpm-api-v1/", __BTPM_SRC_BASE__);
  // API-N.6 superseded routes/projects.ts: the accepted external Project
  // metadata update command declares narrative fields in its own closed body
  // schema. The read/wiring surface remains narrative-free.
  for (const file of ["router.ts", "handler.ts", "index.ts"]) {
    const source = await Deno.readTextFile(new URL(file, base));
    for (const narrative of NARRATIVE_FIELDS) {
      assert(
        !source.includes(narrative),
        `${file} must not reference narrative field ${narrative}`,
      );
    }
  }

  const capabilities = await Deno.readTextFile(
    new URL("routes/capabilities.ts", base),
  );
  assert(capabilities.includes('"projects.get"'));
  assert(capabilities.includes('"projects.get_by_id"'));
  for (
    const forbidden of [
      "projects.get_narrative",
      "projects.get_detail",
      "projects.get_full",
    ]
  ) {
    assert(
      !capabilities.includes(forbidden),
      `capability surface must not gain ${forbidden}`,
    );
  }
});
